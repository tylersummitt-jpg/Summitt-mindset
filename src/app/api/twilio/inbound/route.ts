// src/app/api/twilio/inbound/route.ts

import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseServer } from "@/lib/supabase-server";
import { syncSmsAudience } from "@/lib/sms-audience-sync";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { splitIntoChunks, buildTwimlResponse } from "@/lib/twilio";

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

function safeDayNumber(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return null;
  return Math.floor(value);
}

/**
 * Coach-path durability: after sms_inbound_messages is stored, a job row MUST exist
 * before we return 200 TwiML. Inserts with retry + explicit SELECT verify; throws if
 * still missing so Twilio can retry the webhook.
 */
async function ensureCoachJobPresent(args: {
  messageSid: string;
  clerkUserId: string;
  fromPhone: string;
  rawBody: string;
}): Promise<void> {
  const row = {
    message_sid: args.messageSid,
    clerk_user_id: args.clerkUserId,
    from_phone: args.fromPhone,
    raw_body: args.rawBody,
  };

  const jobRowExists = async (): Promise<boolean> => {
    const { data } = await supabaseServer
      .from("sms_inbound_coach_jobs")
      .select("message_sid")
      .eq("message_sid", args.messageSid)
      .maybeSingle();
    return Boolean(data?.message_sid);
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabaseServer.from("sms_inbound_coach_jobs").insert(row);
    if (!error) break;
    const code = (error as { code?: string })?.code;
    if (code === "23505") break;
    if (attempt === 1) throw error;
  }

  if (await jobRowExists()) return;

  {
    const { error } = await supabaseServer.from("sms_inbound_coach_jobs").insert(row);
    if (error) {
      const code = (error as { code?: string })?.code;
      if (code !== "23505") throw error;
    }
  }

  if (await jobRowExists()) return;

  {
    const { error } = await supabaseServer.from("sms_inbound_coach_jobs").insert(row);
    if (error) {
      const code = (error as { code?: string })?.code;
      if (code !== "23505") throw error;
    }
  }

  if (!(await jobRowExists())) {
    throw new Error("sms_inbound_coach_jobs_missing_after_enqueue_and_verify");
  }
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
    userId: userId,
    phoneNumber: from,
    smsEnabled: false,
    stoppedAt: new Date().toISOString(),
    timezone: null,
    smsTimePreference: null,
    summittSubscribed: null,
  });
}

async function runStartFlow(userId: string, from: string) {
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

  await syncSmsAudience({
    userId: userId,
    phoneNumber: from,
    smsEnabled: true,
    stoppedAt: null,
    timezone: null,
    smsTimePreference: null,
    summittSubscribed: null,
  });
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

    if (!messageSid || !from || !body) {
      return NextResponse.json({ ok: true });
    }

    const { data: identity } = await supabaseServer
      .from("sms_identities")
      .select("phone_number, clerk_user_id, sms_enabled, stopped_at")
      .eq("phone_number", from)
      .maybeSingle();

    if (!identity?.clerk_user_id) {
      return NextResponse.json({ ok: true });
    }

    const userId = identity.clerk_user_id;

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
          return twiml(
            "Summitt Mindset daily training. Reply with at least one honest sentence to complete today. Reply STOP to opt out."
          );
        }

        if (isStartCommand(body)) {
          await runStartFlow(userId, from);
          return twiml("You’re back in training.");
        }

        if (identity.sms_enabled !== true || typeof identity.stopped_at === "string") {
          return NextResponse.json({ ok: true });
        }

        const dupMd = await getClerkPublicMetadata(userId);
        if (dupMd.smsEnabled !== true) return NextResponse.json({ ok: true });

        const dupCurrentDay = safeDayNumber(dupMd.currentDay);
        if (!dupCurrentDay) return NextResponse.json({ ok: true });

        await ensureCoachJobPresent({
          messageSid,
          clerkUserId: userId,
          fromPhone: from,
          rawBody: body,
        });
        return fastAckTwiml();
      }
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    if (isStopCommand(body)) {
      await runStopFlow(userId, from);
      return twiml("You have been unsubscribed. Reply START to rejoin.");
    }

    if (isHelpCommand(body)) {
      return twiml(
        "Summitt Mindset daily training. Reply with at least one honest sentence to complete today. Reply STOP to opt out."
      );
    }

    if (isStartCommand(body)) {
      await runStartFlow(userId, from);
      return twiml("You’re back in training.");
    }

    if (identity.sms_enabled !== true || typeof identity.stopped_at === "string") {
      return NextResponse.json({ ok: true });
    }

    const md = await getClerkPublicMetadata(userId);
    if (md.smsEnabled !== true) return NextResponse.json({ ok: true });

    const currentDay = safeDayNumber(md.currentDay);
    if (!currentDay) return NextResponse.json({ ok: true });

    await ensureCoachJobPresent({
      messageSid,
      clerkUserId: userId,
      fromPhone: from,
      rawBody: body,
    });

    return fastAckTwiml();
  } catch (err) {
    console.error("[TWILIO INBOUND ERROR]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
