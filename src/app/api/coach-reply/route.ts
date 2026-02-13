// src/app/api/coach-reply/route.ts

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { supabaseServer } from "@/lib/supabase-server";
import { generateCoachReply } from "@/lib/coach-reply-generator";

/**
 * ======================================================
 * POST /api/coach-reply
 * ======================================================
 *
 * Body:
 *   { day: number, message: string }
 *
 * Saves:
 *   - user message → coach_conversations
 *   - coach reply  → coach_conversations
 *
 * Returns:
 *   { ok: true, thread: Message[] }
 */

export const runtime = "nodejs";

const MAX_COACH_REPLIES_PER_DAY = 20;

function todayKeyUTC() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { ok: false, reason: "unauthenticated" },
        { status: 200 }
      );
    }

    // ======================================================
    // ✅ Rate Limit (CANONICAL COST GUARD)
    // ======================================================
    const dayKey = todayKeyUTC();

    const { data: usageRows, error: usageErr } = await supabaseServer
      .from("coach_reply_usage")
      .select("id")
      .eq("clerk_user_id", userId)
      .eq("day_key", dayKey);

    if (usageErr) {
      console.error("Coach reply usage lookup failed:", usageErr.message);

      // Fail closed (protect costs)
      return NextResponse.json(
        {
          ok: false,
          reason: "usage_check_failed",
          error:
            "Coach Pat is temporarily unavailable. Please try again later.",
        },
        { status: 200 }
      );
    }

    const usedCount = usageRows?.length ?? 0;

    if (usedCount >= MAX_COACH_REPLIES_PER_DAY) {
      return NextResponse.json(
        {
          ok: false,
          reason: "rate_limited",
          error:
            "You’ve hit today’s Coach Pat limit. Sit with what you wrote — that’s where growth happens.",
          limitPerDay: MAX_COACH_REPLIES_PER_DAY,
        },
        { status: 200 }
      );
    }

    // Record usage immediately
    const { error: insertUsageErr } = await supabaseServer
      .from("coach_reply_usage")
      .insert({
        clerk_user_id: userId,
        day_key: dayKey,
      });

    if (insertUsageErr) {
      console.error("Coach reply usage insert failed:", insertUsageErr.message);

      return NextResponse.json(
        {
          ok: false,
          reason: "usage_insert_failed",
          error:
            "Coach Pat is temporarily unavailable. Please try again later.",
        },
        { status: 200 }
      );
    }

    // ======================================================
    // Body parse
    // ======================================================
    const body = await req.json();

    const day = Number(body?.day);
    const message =
      typeof body?.message === "string" ? body.message.trim() : "";

    if (!Number.isFinite(day) || day < 1 || message.length === 0) {
      return NextResponse.json(
        { ok: false, reason: "invalid_body" },
        { status: 200 }
      );
    }

    // --------------------------------------------------
    // 1. Save USER message
    // --------------------------------------------------
    const { error: insertUserErr } = await supabaseServer
      .from("coach_conversations")
      .insert({
        clerk_user_id: userId,
        day_number: day,
        role: "user",
        content: message,
      });

    if (insertUserErr) {
      console.error("Coach conversation user insert failed:", insertUserErr);
      return NextResponse.json(
        { ok: false, reason: "thread_insert_failed" },
        { status: 200 }
      );
    }

    // --------------------------------------------------
    // 2. Generate Coach Reply (≤4 sentences HARD)
    // --------------------------------------------------
    const coachReply = await generateCoachReply({
      userId,
      dayNumber: day,
      userMessage: message,
    });

    // --------------------------------------------------
    // 3. Save COACH reply
    // --------------------------------------------------
    const { error: insertCoachErr } = await supabaseServer
      .from("coach_conversations")
      .insert({
        clerk_user_id: userId,
        day_number: day,
        role: "coach",
        content: coachReply,
      });

    if (insertCoachErr) {
      console.error("Coach conversation coach insert failed:", insertCoachErr);
      return NextResponse.json(
        { ok: false, reason: "thread_insert_failed" },
        { status: 200 }
      );
    }

    // --------------------------------------------------
    // 4. Return Full Thread
    // --------------------------------------------------
    const { data: thread, error: threadErr } = await supabaseServer
      .from("coach_conversations")
      .select("id, role, content, created_at")
      .eq("clerk_user_id", userId)
      .eq("day_number", day)
      .order("created_at", { ascending: true });

    if (threadErr) {
      console.error("Coach conversation thread load failed:", threadErr);
      return NextResponse.json(
        { ok: false, reason: "thread_load_failed" },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { ok: true, thread: thread ?? [] },
      { status: 200 }
    );
  } catch (err) {
    console.error("[COACH REPLY ERROR]", err);

    return NextResponse.json(
      { ok: false, reason: "server_error" },
      { status: 500 }
    );
  }
}
