// src/app/api/twilio/inbound/route.ts

import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseServer } from "@/lib/supabase-server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { completeDay } from "@/lib/complete-day";
import { getOrCreateDailyPracticeVersion } from "@/lib/get-or-create-daily-practice-version";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { coachEngine } from "@/lib/coach-engine";
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

function safeDayNumber(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return null;
  return Math.floor(value);
}

/* =====================================================
   COMPLETION CONFIRMATION + SIGNATURE (DETERMINISTIC)
===================================================== */

function getCompletionConfirmation(dayNumber: number): string {
  const options = [
    `Day ${dayNumber} is complete.`,
    `You completed Day ${dayNumber}.`,
    `That locks in Day ${dayNumber}.`,
    `Day ${dayNumber} — done.`,
    `You’re building something real. Day ${dayNumber} complete.`,
  ];
  return options[dayNumber % options.length];
}

function getSignature(dayNumber: number): string {
  const options = ["— Coach", "— Coach Pat", "— Your Coach"];
  return options[dayNumber % options.length];
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

    if (TWILIO_AUTH_TOKEN) {
      const ok = verifyTwilioSignature({ fullUrl, params, signature });
      if (!ok) return NextResponse.json({ ok: false }, { status: 403 });
    }

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
      const code = (sidInsertError as any)?.code;
      if (code === "23505") {
        return NextResponse.json({ ok: true });
      }
      return NextResponse.json({ ok: false }, { status: 500 });
    }

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

    if (isHelpCommand(body)) {
      return twiml(
        "Summitt Mindset daily training. Reply with at least one honest sentence to complete today. Reply STOP to opt out."
      );
    }

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

    if (identity.sms_enabled !== true || typeof identity.stopped_at === "string") {
      return NextResponse.json({ ok: true });
    }

    const md = await getClerkPublicMetadata(userId);
    if (md.smsEnabled !== true) return NextResponse.json({ ok: true });

    const currentDay = safeDayNumber(md.currentDay);
    if (!currentDay) return NextResponse.json({ ok: true });

    const timezone = resolveUserTimezone(md.timezone);
    const todayKey = getDateKeyInTimezone(new Date(), timezone);

    const { data: existingCompletion } = await supabaseServer
      .from("daily_completion_events")
      .select("id")
      .eq("clerk_user_id", userId)
      .eq("day_key", todayKey)
      .maybeSingle();

    const alreadyCompleted = !!existingCompletion;

    let dayForThread = currentDay;

    if (
      typeof md.activeCoachDay === "number" &&
      Number.isFinite(md.activeCoachDay) &&
      md.activeCoachDay > 0 &&
      typeof md.activeCoachDayKey === "string" &&
      md.activeCoachDayKey === todayKey
    ) {
      dayForThread = Math.floor(md.activeCoachDay);
    }

    let didCompleteToday = false;

    if (!alreadyCompleted) {
      const version = await getOrCreateDailyPracticeVersion({
        userId,
        dayNumber: dayForThread,
      });

      await supabaseServer.from("journal_entries").upsert(
        {
          clerk_user_id: userId,
          day_number: dayForThread,
          content: body,
          action_item: version.actionItem,
          reflection_prompt: version.reflectionPrompt,
          source: "sms",
        },
        { onConflict: "clerk_user_id,day_number" }
      );

      const completionResult = await completeDay({
        userId,
        source: "sms",
      });

      if (completionResult.ok) {
        didCompleteToday = true;
      }
    }

    const coachResult = await coachEngine({
      userId,
      dayNumber: dayForThread,
      userMessage: body,
      source: "sms",
    });

    if (!coachResult.ok) {
      return twiml("Good. Stay steady. We’ll keep building.");
    }

    if (didCompleteToday) {
      const confirmation = getCompletionConfirmation(dayForThread);
      const signature = getSignature(dayForThread);

      const wrapped =
        `${confirmation}\n\n` +
        `${coachResult.coachText}\n\n` +
        `${signature}`;

      return twiml(wrapped);
    }

    return twiml(coachResult.coachText);
  } catch (err) {
    console.error("[TWILIO INBOUND ERROR]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}