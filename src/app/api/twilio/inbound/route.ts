// src/app/api/twilio/inbound/route.ts

import { NextResponse, after } from "next/server";
import crypto from "crypto";
import { supabaseServer } from "@/lib/supabase-server";
import { syncSmsAudience } from "@/lib/sms-audience-sync";
import { hasUnresolvedAccountDeletionRequest } from "@/lib/account-deletion/deletion-guards";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { splitIntoChunks, buildTwimlResponse } from "@/lib/twilio";
import {
  buildInboundSmsSafetyReplyBody,
  classifyInboundSmsSafetyTier,
} from "@/lib/sms-inbound-safety";
import { clearCommsPreferencesOnSmsResume } from "@/lib/v2-sms-comms-preferences";
import { enqueueNormalCoachJobWithBurstQuiet } from "@/lib/sms-inbound-burst-pace";
import {
  evaluateTwilioInboundTransportGate,
  parseTwilioInboundNumMedia,
} from "@/lib/twilio-inbound-transport";
import { maybeEnqueueInboundMediaJobsFromTwilioParams } from "@/lib/victory-media/enqueue-inbound-media-jobs";
import { canEnqueueInboundMedia } from "@/lib/victory-media/mms-ingest-eligibility";
import { isInboundMediaEnqueueAllowedByAccountDeletion } from "@/lib/victory-media/mms-ingest-deletion-gate";
import { kickInboundMediaPipeline } from "@/lib/victory-media/kick-inbound-media-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

/* =====================================================
   Utilities
===================================================== */

function normalizePhone(phone: string) {
  return (phone || "").trim().replace(/[^\d+]/g, "");
}

function normalizeBody(input: string) {
  return (input || "").trim().replace(/\s+/g, " ");
}

function isStopCommand(text: string) {
  const t = normalizeBody(text).toLowerCase();
  return ["stop", "unsubscribe", "cancel", "end"].includes(t);
}

function isStartCommand(text: string) {
  const t = normalizeBody(text).toLowerCase();
  return ["start", "unstop"].includes(t);
}

function isHelpCommand(text: string) {
  const t = normalizeBody(text).toLowerCase();
  return ["help", "info"].includes(t);
}

function verifyTwilioSignature({
  fullUrl,
  params,
  signature,
}: {
  fullUrl: string;
  params: URLSearchParams;
  signature: string | null;
}) {
  if (!TWILIO_AUTH_TOKEN || !signature) return false;

  const sorted = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + value)
    .join("");

  const data = fullUrl + sorted;

  const expected = crypto
    .createHmac("sha1", TWILIO_AUTH_TOKEN)
    .update(data)
    .digest("base64");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

function buildFullUrl(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host");
  if (!host) return null;

  const url = new URL(req.url);
  return `${proto}://${host}${url.pathname}${url.search}`;
}

function twiml(message: string) {
  const chunks = splitIntoChunks(message);
  const xml = buildTwimlResponse(chunks);
  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

function fastAckTwiml() {
  const xml = buildTwimlResponse([]);
  return new Response(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

/**
 * Same host Twilio POSTed to (prod/staging). Fallbacks for odd server contexts.
 */
function originForInternalCronKick(req: Request): string | null {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host");
  if (host) return `${proto}://${host}`;

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const bare = vercel.replace(/^https?:\/\//, "");
    return `https://${bare}`;
  }

  const app = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (app) return app.replace(/\/$/, "");

  return null;
}

/** Non-blocking: runs after the TwiML response via Next `after` (cron remains fallback). */
function scheduleSmsInboundCoachWorkerKick(req: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn(
      "[twilio/inbound] sms-inbound-coach worker kick skipped: CRON_SECRET unset"
    );
    return;
  }

  const origin = originForInternalCronKick(req);
  if (!origin) {
    console.warn(
      "[twilio/inbound] sms-inbound-coach worker kick skipped: origin unresolved"
    );
    return;
  }

  const url = `${origin}/api/cron/sms-inbound-coach`;
  console.log("[twilio/inbound] scheduling sms-inbound-coach worker kick");

  after(() => {
    void fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
    })
      .then((res) => {
        if (!res.ok) {
          console.error(
            "[twilio/inbound] sms-inbound-coach worker kick failed",
            res.status
          );
        }
      })
      .catch((err) => {
        console.error("[twilio/inbound] sms-inbound-coach worker kick error", err);
      });
  });
}

/**
 * Non-blocking MMS pipeline kick after successful media job insert.
 * Failure must never affect Twilio TwiML. No new cron / env.
 * after() MUST await the kick so Vercel waitUntil holds the pipeline promise.
 */
function scheduleInboundMediaPipelineKick(insertedCount: number): void {
  if (!Number.isFinite(insertedCount) || insertedCount <= 0) return;
  after(async () => {
    try {
      const result = await kickInboundMediaPipeline();
      console.info("[twilio/inbound] mms-pipeline kick done", result);
    } catch (err) {
      console.error("[twilio/inbound] mms-pipeline kick error", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

/** HELP / duplicate-HELP TwiML: SMS-first accountability; not day/progression framing. */
const HELP_TWIML_BODY =
  "Summitt Mindset: Pat texts you about your commitment—reply honestly to those check-ins. Reply STOP to opt out.";

/** START TwiML after opt-in is restored. */
const START_TWIML_BODY =
  "Welcome back. Text check-ins are on; Pat will text you about your commitment. Reply STOP to opt out anytime.";

/**
 * Coach-path durability: after sms_inbound_messages is stored, a job row MUST exist
 * before we return 200 TwiML. Uses burst quiet window for normal coach replies.
 */
async function ensureCoachJobPresent(args: {
  messageSid: string;
  clerkUserId: string;
  fromPhone: string;
  rawBody: string;
}): Promise<void> {
  await enqueueNormalCoachJobWithBurstQuiet(args);
}

async function runStopFlow(userId: string, from: string) {
  await supabaseServer
    .from("sms_identities")
    .update({
      sms_enabled: false,
      stopped_at: new Date().toISOString(),
    })
    .eq("phone_number", from);

  await updateClerkPublicMetadata(userId, {
    smsEnabled: false,
    smsStoppedAt: new Date().toISOString(),
  });

  await syncSmsAudience({
    userId,
    phoneNumber: from,
    smsEnabled: false,
    stoppedAt: new Date().toISOString(),
    timezone: null,
    smsTimePreference: null,
    summittSubscribed: null,
  });
}

function inboundSafetyTwimlResponse(body: string, fromPhone: string, messageSid: string) {
  const safety = classifyInboundSmsSafetyTier(body, { fromPhone, messageSid });
  if (safety.tier === "safe") return null;

  const reply = buildInboundSmsSafetyReplyBody(safety);
  if (!reply) return null;

  return twiml(reply);
}

async function runStartFlow(
  userId: string,
  from: string
): Promise<"restarted" | "blocked_account_deleting"> {
  // APP-041B2a: do not revive SMS while account deletion is unresolved.
  if (await hasUnresolvedAccountDeletionRequest(userId)) {
    console.warn(
      "[twilio/inbound] START ignored: unresolved account deletion",
      { clerk_user_id: userId }
    );
    return "blocked_account_deleting";
  }

  await supabaseServer
    .from("sms_identities")
    .update({
      sms_enabled: true,
      stopped_at: null,
    })
    .eq("phone_number", from);

  await updateClerkPublicMetadata(userId, {
    smsEnabled: true,
    smsRestartedAt: new Date().toISOString(),
  });

  await clearCommsPreferencesOnSmsResume(userId);

  await syncSmsAudience({
    userId,
    phoneNumber: from,
    smsEnabled: true,
    stoppedAt: null,
    timezone: null,
    smsTimePreference: null,
    summittSubscribed: null,
  });
  return "restarted";
}

/* =====================================================
   Main
===================================================== */

export async function POST(req: Request) {
  try {
    const signature = req.headers.get("x-twilio-signature");
    const rawBody = await req.text();
    const params = new URLSearchParams(rawBody);
    const fullUrl = buildFullUrl(req);

    if (!fullUrl) return NextResponse.json({ ok: false }, { status: 400 });

    if (!TWILIO_AUTH_TOKEN) {
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    const ok = verifyTwilioSignature({ fullUrl, params, signature });
    if (!ok) return NextResponse.json({ ok: false }, { status: 403 });

    const messageSid = params.get("MessageSid");
    const from = normalizePhone(params.get("From") || "");
    const body = normalizeBody(params.get("Body") || "");
    const numMedia = parseTwilioInboundNumMedia(params.get("NumMedia"));
    const transport = evaluateTwilioInboundTransportGate({
      messageSid,
      from,
      body,
      numMedia,
    });

    if (!transport.accept || !messageSid) {
      return NextResponse.json({ ok: true });
    }

    const { data: identity } = await supabaseServer
      .from("sms_identities")
      .select("phone_number, clerk_user_id, sms_enabled, stopped_at")
      .eq("phone_number", from)
      .maybeSingle();

    if (!identity?.clerk_user_id) {
      // Image-only: still return valid empty TwiML (A1). No orphan media jobs.
      if (transport.imageOnly) {
        return fastAckTwiml();
      }
      return NextResponse.json({ ok: true });
    }

    const userId = identity.clerk_user_id;

    // Image-only MMS: ownership + shared media eligibility → optional enqueue → TwiML.
    // No fabricated Body, no sms_inbound_messages, no coach job (A1 + A2).
    if (transport.imageOnly) {
      if (identity.sms_enabled === true && typeof identity.stopped_at !== "string") {
        const imageOnlyMd = await getClerkPublicMetadata(userId);
        if (
          canEnqueueInboundMedia({
            identitySmsEnabled: identity.sms_enabled,
            identityStoppedAt: identity.stopped_at,
            clerkSmsEnabled: imageOnlyMd.smsEnabled,
          }) &&
          (await isInboundMediaEnqueueAllowedByAccountDeletion(userId))
        ) {
          const enqueueResult = await maybeEnqueueInboundMediaJobsFromTwilioParams({
            clerkUserId: userId,
            messageSid,
            params,
            numMedia,
          });
          scheduleInboundMediaPipelineKick(enqueueResult?.inserted ?? 0);
        }
      }
      return fastAckTwiml();
    }

    const { error: sidInsertError } = await supabaseServer
      .from("sms_inbound_messages")
      .insert({
        message_sid: messageSid,
        clerk_user_id: userId,
        phone_number: from,
        raw_body: body,
      });

    if (sidInsertError) {
      const code = (sidInsertError as { code?: string })?.code;
      if (code === "23505") {
        if (isStopCommand(body)) {
          await runStopFlow(userId, from);
          return twiml("You have been unsubscribed. Reply START to rejoin.");
        }

        if (isHelpCommand(body)) {
          return twiml(HELP_TWIML_BODY);
        }

        if (isStartCommand(body)) {
          const startOutcome = await runStartFlow(userId, from);
          if (startOutcome === "blocked_account_deleting") {
            return fastAckTwiml();
          }
          return twiml(START_TWIML_BODY);
        }

        const dupSafety = inboundSafetyTwimlResponse(body, from, messageSid);
        if (dupSafety) {
          return fastAckTwiml();
        }

        if (identity.sms_enabled !== true || typeof identity.stopped_at === "string") {
          console.warn("[twilio/inbound] coach job skipped (duplicate webhook): identity opted out", {
            clerk_user_id: userId,
            message_sid: messageSid,
          });
          return NextResponse.json({ ok: true });
        }

        const dupMd = await getClerkPublicMetadata(userId);
        if (
          !canEnqueueInboundMedia({
            identitySmsEnabled: identity.sms_enabled,
            identityStoppedAt: identity.stopped_at,
            clerkSmsEnabled: dupMd.smsEnabled,
          })
        ) {
          console.warn("[twilio/inbound] coach job skipped (duplicate webhook): Clerk smsEnabled not true", {
            clerk_user_id: userId,
            message_sid: messageSid,
          });
          return NextResponse.json({ ok: true });
        }

        // Media enqueue is additive / non-blocking; never gates coach durability.
        // Unresolved account deletion suppresses media only (text/coach unchanged).
        if (await isInboundMediaEnqueueAllowedByAccountDeletion(userId)) {
          const enqueueResult = await maybeEnqueueInboundMediaJobsFromTwilioParams({
            clerkUserId: userId,
            messageSid,
            params,
            numMedia,
          });
          scheduleInboundMediaPipelineKick(enqueueResult?.inserted ?? 0);
        }

        await ensureCoachJobPresent({
          messageSid,
          clerkUserId: userId,
          fromPhone: from,
          rawBody: body,
        });
        scheduleSmsInboundCoachWorkerKick(req);
        return fastAckTwiml();
      }
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    if (isStopCommand(body)) {
      await runStopFlow(userId, from);
      return twiml("You have been unsubscribed. Reply START to rejoin.");
    }

    if (isHelpCommand(body)) {
      return twiml(HELP_TWIML_BODY);
    }

    if (isStartCommand(body)) {
      const startOutcome = await runStartFlow(userId, from);
      if (startOutcome === "blocked_account_deleting") {
        return fastAckTwiml();
      }
      return twiml(START_TWIML_BODY);
    }

    const safetyTwiml = inboundSafetyTwimlResponse(body, from, messageSid);
    if (safetyTwiml) {
      const safetyMeta = classifyInboundSmsSafetyTier(body, { fromPhone: from, messageSid });
      console.info("[twilio/inbound] inbound_safety_short_circuit", {
        clerk_user_id: userId,
        ...safetyMeta.logSafe,
      });
      return safetyTwiml;
    }

    if (identity.sms_enabled !== true || typeof identity.stopped_at === "string") {
      console.warn("[twilio/inbound] coach job skipped: identity opted out or stopped", {
        clerk_user_id: userId,
        message_sid: messageSid,
      });
      return NextResponse.json({ ok: true });
    }

    const md = await getClerkPublicMetadata(userId);
    if (
      !canEnqueueInboundMedia({
        identitySmsEnabled: identity.sms_enabled,
        identityStoppedAt: identity.stopped_at,
        clerkSmsEnabled: md.smsEnabled,
      })
    ) {
      console.warn("[twilio/inbound] coach job skipped: Clerk smsEnabled not true", {
        clerk_user_id: userId,
        message_sid: messageSid,
      });
      return NextResponse.json({ ok: true });
    }

    // Media enqueue is additive / non-blocking; never gates coach durability.
    // Same opt-out + deletion law as image-only (deletion suppresses media only).
    if (await isInboundMediaEnqueueAllowedByAccountDeletion(userId)) {
      const enqueueResult = await maybeEnqueueInboundMediaJobsFromTwilioParams({
        clerkUserId: userId,
        messageSid,
        params,
        numMedia,
      });
      scheduleInboundMediaPipelineKick(enqueueResult?.inserted ?? 0);
    }

    await ensureCoachJobPresent({
      messageSid,
      clerkUserId: userId,
      fromPhone: from,
      rawBody: body,
    });

    scheduleSmsInboundCoachWorkerKick(req);
    return fastAckTwiml();
  } catch (err) {
    console.error("[TWILIO INBOUND ERROR]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
