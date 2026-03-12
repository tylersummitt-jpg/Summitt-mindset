// src/lib/coach-engine.ts

import { supabaseServer } from "@/lib/supabase-server";
import { resolveDailyPracticeForUser } from "@/lib/resolve-daily-practice";
import { generateCoachReply } from "@/lib/coach-reply-generator";

type CoachEngineSource = "app" | "sms";

type CoachEngineParams = {
  userId: string;
  dayNumber: number;
  userMessage: string;
  source: CoachEngineSource;

  /**
   * If provided, we will use this exact UTC day key for rate limiting.
   * If omitted, we compute from now().
   */
  rateLimitDayKeyUTC?: string;

  /**
   * Default matches your current behavior for the app route.
   * You can raise/lower later.
   */
  maxCoachRepliesPerDay?: number;
};

export type CoachEngineResult = {
  ok: true;
  coachText: string;
  meta: {
    dayKeyUTC: string;
    limitPerDay: number;
    usedCountBeforeInsert: number;
    source: CoachEngineSource;
  };
  thread: { id: string; role: string; content: string; created_at: string }[];
};

export type CoachEngineError =
  | {
      ok: false;
      reason: "rate_limited";
      error: string;
      limitPerDay: number;
      dayKeyUTC: string;
    }
  | {
      ok: false;
      reason:
        | "usage_check_failed"
        | "usage_insert_failed"
        | "user_message_save_failed"
        | "coach_message_save_failed"
        | "thread_load_failed"
        | "invalid_input";
      error: string;
    };

function todayKeyUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

function safePositiveInt(n: unknown): number | null {
  if (typeof n !== "number") return null;
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return Math.floor(n);
}

/**
 * ======================================================
 * coachEngine (CANONICAL)
 * ======================================================
 *
 * Responsibilities:
 * 1) Rate limit
 * 2) Save user message to coach_conversations
 * 3) Generate coach reply
 * 4) Save coach reply to coach_conversations
 * 5) Return full thread
 *
 * Notes:
 * - Uses the existing "count rows per day_key" pattern to match your current app route.
 * - Returns 200-style domain errors to the caller to keep routes consistent with your API philosophy.
 */
export async function coachEngine(
  params: CoachEngineParams
): Promise<CoachEngineResult | CoachEngineError> {
  const userId = normalizeText(params.userId);
  const userMessage = normalizeText(params.userMessage);
  const dayNumber = safePositiveInt(params.dayNumber);
  const source: CoachEngineSource = params.source;

  if (!userId || !dayNumber || !userMessage) {
    return {
      ok: false,
      reason: "invalid_input",
      error: "Invalid coaching payload.",
    };
  }

  const limitPerDay =
    typeof params.maxCoachRepliesPerDay === "number" &&
    Number.isFinite(params.maxCoachRepliesPerDay) &&
    params.maxCoachRepliesPerDay > 0
      ? Math.floor(params.maxCoachRepliesPerDay)
      : 20;

  const dayKeyUTC = params.rateLimitDayKeyUTC || todayKeyUTC();

  // ================================
  // 1) Rate Limit (UTC)
  // ================================
  const { data: usageRows, error: usageErr } = await supabaseServer
    .from("coach_reply_usage")
    .select("id")
    .eq("clerk_user_id", userId)
    .eq("day_key", dayKeyUTC);

  if (usageErr) {
    console.error("Coach reply usage lookup failed:", usageErr.message);
    return {
      ok: false,
      reason: "usage_check_failed",
      error: "Coach Pat is temporarily unavailable. Please try again later.",
    };
  }

  const usedCount = usageRows?.length ?? 0;

  if (usedCount >= limitPerDay) {
    return {
      ok: false,
      reason: "rate_limited",
      error:
        "You’ve hit today’s Coach Pat limit. Sit with what you wrote — that’s where growth happens.",
      limitPerDay,
      dayKeyUTC,
    };
  }

  const { error: usageInsertErr } = await supabaseServer
    .from("coach_reply_usage")
    .insert({
      clerk_user_id: userId,
      day_key: dayKeyUTC,
    });

  if (usageInsertErr) {
    console.error("Coach reply usage insert failed:", usageInsertErr);
    return {
      ok: false,
      reason: "usage_insert_failed",
      error: "Coach Pat is temporarily unavailable. Please try again later.",
    };
  }

  // ================================
  // 2) Save USER message
  // ================================
  const { error: userInsertErr } = await supabaseServer
    .from("coach_conversations")
    .insert({
      clerk_user_id: userId,
      day_number: dayNumber,
      role: "user",
      content: userMessage,
      metadata: { source },
    });

  if (userInsertErr) {
    console.error("Coach conversation user insert failed:", userInsertErr);
    return {
      ok: false,
      reason: "user_message_save_failed",
      error: "Coach Pat is temporarily unavailable. Please try again later.",
    };
  }

  // ================================
  // 3) Generate coach reply
  // ================================
  // Fetch today's practice action item
  let actionItem = "";

  try {
    const practice = await resolveDailyPracticeForUser(userId, dayNumber);
    actionItem = practice?.actionItem ?? "";
  } catch (err) {
    console.error("Coach reply: could not resolve action item:", err);
  }

  const coachReply = await generateCoachReply({
    userId,
    dayNumber,
    userMessage,
    actionItem,
    source,
  });

  // ================================
  // 4) Save COACH reply
  // ================================
  const { error: coachInsertErr } = await supabaseServer
    .from("coach_conversations")
    .insert({
      clerk_user_id: userId,
      day_number: dayNumber,
      role: "coach",
      content: coachReply.text,
      metadata: {
        ...coachReply.meta,
        source,
      },
    });

  if (coachInsertErr) {
    console.error("Coach conversation coach insert failed:", coachInsertErr);
    return {
      ok: false,
      reason: "coach_message_save_failed",
      error: "Coach Pat is temporarily unavailable. Please try again later.",
    };
  }

  // ================================
  // 5) Return full thread
  // ================================
  const { data: thread, error: threadErr } = await supabaseServer
    .from("coach_conversations")
    .select("id, role, content, created_at")
    .eq("clerk_user_id", userId)
    .eq("day_number", dayNumber)
    .order("created_at", { ascending: true });

  if (threadErr) {
    console.error("Coach thread load failed:", threadErr);
    return {
      ok: false,
      reason: "thread_load_failed",
      error: "Coach Pat is temporarily unavailable. Please try again later.",
    };
  }

  return {
    ok: true,
    coachText: coachReply.text,
    meta: {
      dayKeyUTC,
      limitPerDay,
      usedCountBeforeInsert: usedCount,
      source,
    },
    thread: (thread ?? []) as any,
  };
}