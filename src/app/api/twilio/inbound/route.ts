// src/app/api/twilio/inbound/route.ts

import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseServer } from "@/lib/supabase-server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { completeDay } from "@/lib/complete-day";
import { generateCoachReply } from "@/lib/coach-reply-generator";
import { getOrCreateDailyPracticeVersion } from "@/lib/get-or-create-daily-practice-version";
import { trainingCampPromptId } from "@/lib/prompt-ids";
import { inSeasonPromptId } from "@/lib/in-season-selector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

/* -------------------------------------------------- */
/* Utilities */
/* -------------------------------------------------- */

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
  // Twilio signature expects the exact webhook URL (including query string if present)
  return `${proto}://${host}${url.pathname}${url.search}`;
}

function twiml(message: string) {
  return new Response(`<Response><Message>${message}</Message></Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

function safeDayNumber(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return null;
  return value;
}

function appendReflection(existing: string | null, incoming: string): string {
  const a = normalizeBody(existing || "");
  const b = normalizeBody(incoming || "");
  const combined = normalizeBody([a, b].filter(Boolean).join(" "));
  return combined.slice(0, 1200);
}

/* -------------------------------------------------- */
/* Main */
/* -------------------------------------------------- */

export async function POST(req: Request) {
  try {
    const signature = req.headers.get("x-twilio-signature");
    const rawBody = await req.text();
    const params = new URLSearchParams(rawBody);
    const fullUrl = buildFullUrl(req);

    if (!fullUrl) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    // If TWILIO_AUTH_TOKEN is set, enforce signature validation
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

    const { data: identity } = await supabaseServer
      .from("sms_identities")
      .select("phone_number, clerk_user_id, sms_enabled, stopped_at")
      .eq("phone_number", from)
      .maybeSingle();

    if (!identity?.clerk_user_id) {
      // Unknown number -> ignore quietly (Twilio expects 200s)
      return NextResponse.json({ ok: true });
    }

    const userId = identity.clerk_user_id;

    // --------------------------------------------------
    // STOP / HELP / START flows
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

    if (isHelpCommand(body)) {
      return twiml(
        "Summitt Mindset daily training. Reply with one honest sentence to complete today. Reply STOP to opt out."
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

    // Hard stop if identity says opted out
    if (identity.sms_enabled !== true || typeof identity.stopped_at === "string") {
      return NextResponse.json({ ok: true });
    }

    const md = await getClerkPublicMetadata(userId);
    if (md.smsEnabled !== true) {
      return NextResponse.json({ ok: true });
    }

    const currentDay = safeDayNumber(md.currentDay);
    if (!currentDay) {
      return NextResponse.json({ ok: true });
    }

    // --------------------------------------------------
    // NORMAL REFLECTION MESSAGE
    // Rule: ANY reply completes the day (no DONE keyword)
    // --------------------------------------------------

    // Keep a record of the inbound message
    await supabaseServer.from("coach_conversations").insert({
      clerk_user_id: userId,
      day_number: currentDay,
      role: "user",
      content: body,
      metadata: { source: "sms" },
    });

    const version = await getOrCreateDailyPracticeVersion({
      userId,
      dayNumber: currentDay,
    });

    const promptId =
      currentDay <= 30
        ? trainingCampPromptId(currentDay)
        : inSeasonPromptId(currentDay);

    const { data: existingRow } = await supabaseServer
      .from("journal_entries")
      .select("content")
      .eq("clerk_user_id", userId)
      .eq("day_number", currentDay)
      .maybeSingle();

    const nextContent = appendReflection(
      normalizeBody((existingRow as any)?.content ?? ""),
      body
    );

    await supabaseServer.from("journal_entries").upsert(
      {
        clerk_user_id: userId,
        day_number: currentDay,
        content: nextContent,
        prompt_id: promptId,
        action_item: version.actionItem,
        reflection_prompt: version.reflectionPrompt,
        source: "sms",
      },
      { onConflict: "clerk_user_id,day_number" }
    );

    // ✅ Canonical rule: reply = complete (same as app button)
    const result = await completeDay({
      userId,
      source: "sms",
    });

    // If they already completed today, still store message but do not spam a coach reply
    if (!result.ok && result.reason === "already_completed_today") {
      return twiml("Got it. You’re already complete for today. See you tomorrow.");
    }

    if (!result.ok) {
      return twiml("Something didn’t go through. Try again in a minute.");
    }

    // One coach reply on successful completion (mirrors app post-completion feel)
    const coachReply = await generateCoachReply({
      userId,
      dayNumber: currentDay,
      userMessage: nextContent,
    });

    await supabaseServer.from("coach_conversations").insert({
      clerk_user_id: userId,
      day_number: currentDay,
      role: "coach",
      content: coachReply.text,
      metadata: coachReply.meta,
    });

    return twiml(coachReply.text);
  } catch (err) {
    console.error("[TWILIO INBOUND ERROR]", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}