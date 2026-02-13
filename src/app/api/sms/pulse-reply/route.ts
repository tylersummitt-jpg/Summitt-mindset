import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { verifyPulseToken } from "@/lib/pulse-token";

export const runtime = "nodejs";

/**
 * ======================================================
 * Day 4–5 SMS Pulse Reply Intake (CANONICAL)
 * ======================================================
 */

function normalizeText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().replace(/\s+/g, " ");
  return t.length ? t : null;
}

function classifyPulseWord(raw: string): "positive" | "negative" | "neutral" {
  const t = raw.toLowerCase();

  const positive = new Set([
    "good","great","amazing","helpful","calm","easy","clear","strong",
    "solid","needed","perfect","better","love","loving","powerful",
    "steady","focused","motivating",
  ]);

  const negative = new Set([
    "hard","busy","confusing","overwhelming","tough","stressful",
    "heavy","unclear","frustrating","annoying","inconsistent",
    "impossible","lost","stuck","bad",
  ]);

  if (t.includes("too busy")) return "negative";
  if (t.includes("so good")) return "positive";

  const first = t.split(" ")[0];

  if (positive.has(first)) return "positive";
  if (negative.has(first)) return "negative";

  return "neutral";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const token = normalizeText(body?.token);
    const message = normalizeText(body?.message);

    if (!token || !message) {
      return NextResponse.json(
        { ok: false, reason: "missing_fields" },
        { status: 200 }
      );
    }

    const verified = verifyPulseToken(token);

    // Explicit type narrowing
    if (!verified || verified.ok !== true) {
      return NextResponse.json(
        { ok: false, reason: "invalid_token" },
        { status: 200 }
      );
    }

    const clerk_user_id = verified.clerk_user_id;
    const day_number = verified.day_number;

    const wordCount = message.split(" ").filter(Boolean).length;

    if (wordCount > 3) {
      return NextResponse.json(
        { ok: false, reason: "too_many_words" },
        { status: 200 }
      );
    }

    const sentimentClass = classifyPulseWord(message);

    // Idempotency check
    const { data: existing } = await supabaseServer
      .from("feedback_events")
      .select("id")
      .eq("clerk_user_id", clerk_user_id)
      .eq("moment", "day4_5_sms_pulse_reply")
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
    }

    await supabaseServer.from("feedback_events").insert({
      clerk_user_id,
      source: "sms",
      moment: "day4_5_sms_pulse_reply",
      type: "friction",
      day_number,
      rating: null,
      sentiment: null,
      reason_code: "sms_pulse_fit_language",
      message,
      share_permission: false,
      metadata: {
        canonical: true,
        sentimentClass,
        wordCount,
      },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[PULSE REPLY] SERVER ERROR:", err);

    return NextResponse.json(
      { ok: false, reason: "server_error" },
      { status: 500 }
    );
  }
}
