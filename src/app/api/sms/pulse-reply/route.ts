import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { verifyPulseToken } from "@/lib/pulse-token";

export const runtime = "nodejs";

/**
 * ======================================================
 * POST /api/sms/pulse-reply (CANONICAL)
 * ======================================================
 *
 * Accepts:
 * - token (signed)
 * - message (1 word, 2-3 allowed)
 *
 * Writes to:
 * - feedback_events
 *
 * Stream:
 * - Stream A (private truth)
 *
 * IMPORTANT:
 * - No auth required (token is identity)
 * - Must never allow cross-user submission
 */

function normalizeText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().replace(/\s+/g, " ");
  return t.length ? t : null;
}

function countWords(text: string) {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return 0;
  return t.split(" ").length;
}

function classifyPulseWord(word: string): {
  reason_code: string;
  pulse_sentiment: "positive" | "negative" | "neutral";
} {
  const w = word.toLowerCase();

  // We keep this intentionally small and calm.
  // The point is trend detection, not NLP perfection.
  const negative = [
    "hard",
    "busy",
    "confusing",
    "unclear",
    "overwhelming",
    "stressful",
    "frustrating",
    "tough",
    "difficult",
  ];

  const positive = [
    "good",
    "great",
    "steady",
    "helpful",
    "clear",
    "calm",
    "better",
    "strong",
    "easy",
  ];

  if (negative.some((x) => w.includes(x))) {
    return { reason_code: "pulse_negative", pulse_sentiment: "negative" };
  }

  if (positive.some((x) => w.includes(x))) {
    return { reason_code: "pulse_positive", pulse_sentiment: "positive" };
  }

  return { reason_code: "pulse_neutral", pulse_sentiment: "neutral" };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const token = normalizeText(body?.token);
    const message = normalizeText(body?.message);

    if (!token || !message) {
      return NextResponse.json(
        { ok: false, reason: "missing_fields" },
        { status: 400 }
      );
    }

    // Guard: one word, but allow 2–3
    const words = countWords(message);
    if (words > 3) {
      return NextResponse.json(
        { ok: false, reason: "too_many_words" },
        { status: 400 }
      );
    }

    // Verify token → gives us clerk_user_id + day_number
    const verified = verifyPulseToken(token);

    if (!verified.ok) {
      return NextResponse.json(
        { ok: false, reason: "invalid_token" },
        { status: 400 }
      );
    }

    const { clerk_user_id, day_number } = verified.payload;

    const { reason_code, pulse_sentiment } = classifyPulseWord(message);

    // Once guard: never allow duplicates for this user
    // (even if they reload and resubmit)
    const { data: existing } = await supabaseServer
      .from("feedback_events")
      .select("id")
      .eq("clerk_user_id", clerk_user_id)
      .eq("moment", "day4_5_sms_pulse_reply")
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
    }

    // Write reply
    await supabaseServer.from("feedback_events").insert({
      clerk_user_id,
      source: "sms",
      moment: "day4_5_sms_pulse_reply",
      type: "friction",
      day_number,
      rating: null,
      sentiment: null,
      reason_code,
      message: message.slice(0, 80),
      share_permission: false,
      metadata: {
        canonical: true,
        pulse_sentiment,
      },
    });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("[PULSE REPLY] SERVER ERROR:", err);

    return NextResponse.json(
      { ok: false, reason: "server_error" },
      { status: 500 }
    );
  }
}
