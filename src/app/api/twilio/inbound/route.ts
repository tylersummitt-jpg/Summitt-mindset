// src/app/api/twilio/inbound/route.ts

import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseServer } from "@/lib/supabase-server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { ensureDailyPrompt } from "@/lib/ensure-daily-prompt";
import { completeDay } from "@/lib/complete-day";
import { sendSMS, isTwilioReady } from "@/lib/twilio";
import { generateCoachReply } from "@/lib/coach-reply-generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ======================================================
 * TWILIO INBOUND WEBHOOK (CANONICAL)
 * ======================================================
 *
 * Uses Supabase table sms_identities:
 * - phone_number (pk)
 * - clerk_user_id
 * - sms_enabled
 * - stopped_at
 *
 * Handles:
 * - STOP / START / HELP compliance
 * - Saves inbound ONLY into coach_conversations
 * - Writes journal_entries ONLY on DONE
 * - Completes day ONLY on DONE
 *
 * SECURITY:
 * - Twilio signature verification enabled when TWILIO_AUTH_TOKEN exists
 */

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

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

function isDoneCommand(text: string) {
  const t = normalizeBody(text).toLowerCase();
  return ["done", "complete", "completed", "finish"].includes(t);
}

/**
 * Twilio signature verification.
 */
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
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

function buildFullUrl(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host");
  if (!host) return null;

  const url = new URL(req.url);
  return `${proto}://${host}${url.pathname}`;
}

function twiml(message: string) {
  return new Response(
    `<Response><Message>${message}</Message></Response>`,
    { status: 200, headers: { "Content-Type": "text/xml" } }
  );
}

async function getLastNonDoneUserMessage({
  userId,
  dayNumber,
}: {
  userId: string;
  dayNumber: number;
}): Promise<string | null> {
  const { data } = await supabaseServer
    .from("coach_conversations")
    .select("content")
    .eq("clerk_user_id", userId)
    .eq("day_number", dayNumber)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(15);

  const rows = Array.isArray(data) ? data : [];

  for (const row of rows) {
    const content = normalizeBody(row?.content ?? "");
    if (!content) continue;
    if (isDoneCommand(content)) continue;
    return content;
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const signature = req.headers.get("x-twilio-signature");
    const rawBody = await req.text();
    const params = new URLSearchParams(rawBody);
    const fullUrl = buildFullUrl(req);

    if (!fullUrl) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    if (TWILIO_AUTH_TOKEN) {
      const ok = verifyTwilioSignature({
        fullUrl,
        params,
        signature,
      });

      if (!ok) {
        return NextResponse.json({ ok: false }, { status: 403 });
      }
    }

    const from = normalizePhone(params.get("From") || "");
    const body = normalizeBody(params.get("Body") || "");

    if (!from || !body) {
      return NextResponse.json({ ok: true });
    }

    // --------------------------------------------------
    // Map phone → identity
    // --------------------------------------------------
    const { data: identity } = await supabaseServer
      .from("sms_identities")
      .select("phone_number, clerk_user_id, sms_enabled, stopped_at")
      .eq("phone_number", from)
      .maybeSingle();

    if (!identity?.clerk_user_id) {
      return NextResponse.json({ ok: true });
    }

    const userId = identity.clerk_user_id;

    // --------------------------------------------------
    // STOP
    // --------------------------------------------------
    if (isStopCommand(body)) {
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

      return twiml("You have been unsubscribed. Reply START to rejoin.");
    }

    // --------------------------------------------------
    // HELP
    // --------------------------------------------------
    if (isHelpCommand(body)) {
      return twiml(
        "Summitt Mindset daily training. Reply DONE to complete. Reply STOP to cancel."
      );
    }

    // --------------------------------------------------
    // START
    // --------------------------------------------------
    if (isStartCommand(body)) {
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

      return twiml("You’re back in training.");
    }

    // If identity disabled, ignore everything except START
    if (identity.sms_enabled !== true || typeof identity.stopped_at === "string") {
      return NextResponse.json({ ok: true });
    }

    // --------------------------------------------------
    // Pull metadata
    // --------------------------------------------------
    const md = await getClerkPublicMetadata(userId);

    if (md.smsEnabled !== true) {
      return NextResponse.json({ ok: true });
    }

    const currentDay =
      typeof md.currentDay === "number" && md.currentDay > 0
        ? md.currentDay
        : null;

    if (!currentDay) {
      return NextResponse.json({ ok: true });
    }

    // --------------------------------------------------
    // Always store inbound in thread ONLY
    // --------------------------------------------------
    await supabaseServer.from("coach_conversations").insert({
      clerk_user_id: userId,
      day_number: currentDay,
      role: "user",
      content: body,
      source: "sms",
    });

    // --------------------------------------------------
    // If not DONE → just acknowledgment
    // --------------------------------------------------
    if (!isDoneCommand(body)) {
      return twiml(
        "Got it. When you’re ready, text DONE and I’ll mark today complete."
      );
    }

    // --------------------------------------------------
    // DONE → Create journal entry from last NON-DONE message
    // --------------------------------------------------
    const reflection = await getLastNonDoneUserMessage({
      userId,
      dayNumber: currentDay,
    });

    if (!reflection) {
      return twiml("Send one honest sentence first. Then text DONE.");
    }

    const trainingCampTrack =
      md.trainingCampTrack === "women" ? "women" : "standard";

    const { promptId, actionItem, reflectionPrompt } =
      await ensureDailyPrompt({
        userId,
        dayNumber: currentDay,
        trainingCampTrack,
      });

    await supabaseServer.from("journal_entries").upsert(
      {
        clerk_user_id: userId,
        day_number: currentDay,
        content: reflection,
        prompt_id: promptId,
        action_item: actionItem,
        reflection_prompt: reflectionPrompt,
        source: "sms",
      },
      { onConflict: "clerk_user_id,day_number" }
    );

    const result = await completeDay({
      userId,
      source: "sms",
    });

    if (!result.ok) {
      return twiml("Something didn’t go through. Try again in a minute.");
    }

    const coachReplyText = await generateCoachReply({
      userId,
      dayNumber: currentDay,
      userMessage: reflection,
    });

    await supabaseServer.from("coach_conversations").insert({
      clerk_user_id: userId,
      day_number: currentDay,
      role: "coach",
      content: coachReplyText,
      source: "sms",
    });

    if (isTwilioReady()) {
      await sendSMS({ to: from, body: coachReplyText });
    }

    return twiml("Day complete. Proud of you. See you tomorrow.");
  } catch (err) {
    console.error("[TWILIO INBOUND ERROR]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
