import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseServer } from "@/lib/supabase-server";

import { pauseFeedbackAfterText } from "@/lib/feedback-state";

type FeedbackPayload = {
  source: "app" | "sms" | "email" | "cancel_flow";

  moment: string; // day1_completion, day7_nps, ask_pat, cancel
  type: "ces" | "nps" | "friction" | "churn" | "testimonial_seed";

  dayNumber?: number | null;

  rating?: number | null;
  reasonCode?: string | null;
  message?: string | null;

  sharePermission?: boolean | null;
  metadata?: Record<string, any> | null;
};

function normalizeText(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().replace(/\s+/g, " ");
  return t.length ? t : null;
}

function intOrNull(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  return Math.floor(value);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function sentimentFromNps(rating: number): "promoter" | "passive" | "detractor" {
  if (rating >= 9) return "promoter";
  if (rating >= 7) return "passive";
  return "detractor";
}

/**
 * ======================================================
 * Unified Feedback Event Intake (CANONICAL)
 * ======================================================
 *
 * ALL feedback streams enter through here.
 *
 * - Stream A: friction + effort
 * - Stream B: testimonial seeds (air-gapped)
 * - Stream C: churn truth
 */

export async function POST(req: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(
      { ok: false, reason: "unauthorized" },
      { status: 401 }
    );
  }

  let body: FeedbackPayload;

  try {
    body = (await req.json()) as FeedbackPayload;
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_json" },
      { status: 400 }
    );
  }

  const source = body.source;
  const moment = normalizeText(body.moment);
  const type = body.type;

  if (!source || !moment || !type) {
    return NextResponse.json(
      { ok: false, reason: "missing_fields" },
      { status: 400 }
    );
  }

  const dayNumber = body.dayNumber ?? null;

  // ----------------------------
  // Normalize rating by type
  // ----------------------------
  let rating: number | null = intOrNull(body.rating);

  if (type === "nps" && rating !== null) {
    rating = clamp(rating, 0, 10);
  }

  if (type === "ces" && rating !== null) {
    rating = clamp(rating, 0, 1); // 1 = clear, 0 = unclear
  }

  const reason_code = normalizeText(body.reasonCode);
  const message = normalizeText(body.message);

  const share_permission = body.sharePermission === true;
  const metadata = body.metadata ?? {};

  // ----------------------------
  // Sentiment routing (NPS only)
  // ----------------------------
  let sentiment: string | null = null;

  if (type === "nps" && rating !== null) {
    sentiment = sentimentFromNps(rating);
  }

  // ======================================================
  // 1. Write Canonical Feedback Event Ledger
  // ======================================================
  const { error: insertError } = await supabaseServer
    .from("feedback_events")
    .insert({
      clerk_user_id: userId,
      source,
      moment,
      type,
      day_number: dayNumber,
      rating,
      sentiment,
      reason_code,
      message,
      share_permission,
      metadata,
    });

  // ✅ Duplicate inserts are allowed silently (idempotent UX)
  if (insertError) {
    const msg = insertError.message.toLowerCase();

    const isDuplicate =
      msg.includes("duplicate") ||
      msg.includes("unique") ||
      msg.includes("feedback_events_unique");

    if (!isDuplicate) {
      return NextResponse.json(
        { ok: false, reason: "db_insert_failed" },
        { status: 500 }
      );
    }
  }

  // ======================================================
  // 2. Air-Gapped Testimonial Lane
  // ======================================================
  if (share_permission && type === "testimonial_seed" && message) {
    await supabaseServer.from("testimonials").insert({
      clerk_user_id: userId,
      day_number: dayNumber ?? 0,
      quote: message.slice(0, 400),
      approved: false,
      tags: [],
    });
  }

  // ======================================================
  // 3. Anti-Spam Rule: Text pauses prompts for 3 days
  // ======================================================
  if (message && message.length > 0) {
    await pauseFeedbackAfterText(userId);
  }

  return NextResponse.json({ ok: true });
}
