import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { clerkClient } from "@clerk/nextjs/server";
import { ensureDailyPrompt } from "@/lib/ensure-daily-prompt";

/**
 * ======================================================
 * Complete Day (CANONICAL)
 * ======================================================
 *
 * The ONLY place where day progression happens.
 *
 * Completion responsibilities:
 * - verify journal exists
 * - generate contextualized daily memory
 * - advance progression safely
 *
 * Raw journal entries are NEVER modified here.
 */

export type CompleteDaySource = "app" | "sms";

export type CompleteDayResult =
  | { ok: true; completedDay: number; nextDay: number }
  | { ok: false; reason: string };

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Builds a single contextualized reflection sentence.
 * This is the atomic memory unit used by Coach Pat / SMS / Ask Pat.
 */
function buildContextualizedReflection({
  reflectionPrompt,
  actionItem,
  journalContent,
}: {
  reflectionPrompt: string | null;
  actionItem: string | null;
  journalContent: string;
}): string {
  const answer = normalizeText(journalContent);
  if (!answer) return "";

  const prompt = normalizeText(reflectionPrompt || "");
  const action = normalizeText(actionItem || "");

  // Gentle, coach-style synthesis (second person, time-agnostic)
  if (prompt && action) {
    return `You reflected on "${prompt.toLowerCase()}", and today you practiced by ${answer.toLowerCase()}.`;
  }

  if (prompt) {
    return `You reflected on "${prompt.toLowerCase()}", and noted that ${answer.toLowerCase()}.`;
  }

  if (action) {
    return `You focused on ${action.toLowerCase()}, and today you noticed that ${answer.toLowerCase()}.`;
  }

  return `Today, you reflected and noted that ${answer.toLowerCase()}.`;
}

export async function completeDay({
  userId,
  source,
  videoIdShown = null,
}: {
  userId: string;
  source: CompleteDaySource;
  videoIdShown?: string | null;
}): Promise<CompleteDayResult> {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const metadata = user.publicMetadata || {};

  const currentDay =
    typeof metadata.currentDay === "number" && metadata.currentDay > 0
      ? metadata.currentDay
      : null;

  if (!currentDay) {
    return { ok: false, reason: "no_current_day" };
  }

  const totalDaysCompleted = numberOrZero(metadata.totalDaysCompleted);
  const daysInRow = numberOrZero(metadata.daysInRow);

  // --------------------------------------------------
  // 🗓️ TIMEZONE-SAFE TODAY CHECK
  // --------------------------------------------------
  const timezone = resolveUserTimezone(metadata.timezone);
  const now = new Date();
  const todayKey = getDateKeyInTimezone(now, timezone);

  if (typeof metadata.lastCompletedAt === "string") {
    const last = new Date(metadata.lastCompletedAt);
    const lastKey = getDateKeyInTimezone(last, timezone);

    if (lastKey === todayKey) {
      return { ok: false, reason: "already_completed_today" };
    }
  }

  // --------------------------------------------------
  // 🧠 ENSURE DAILY PROMPT (CURRENT DAY ONLY)
  // --------------------------------------------------
  const trainingCampTrack =
    metadata.trainingCampTrack === "women" ? "women" : "standard";

  await ensureDailyPrompt({
    userId,
    dayNumber: currentDay,
    trainingCampTrack,
  });

  // --------------------------------------------------
  // ✍️ LOAD JOURNAL + CONTEXT
  // --------------------------------------------------
  const { data: journalRow, error: journalError } = await supabaseServer
    .from("journal_entries")
    .select("content, reflection_prompt, action_item")
    .eq("clerk_user_id", userId)
    .eq("day_number", currentDay)
    .maybeSingle();

  if (journalError) {
    return { ok: false, reason: "journal_lookup_failed" };
  }

  const normalizedJournal = normalizeText(journalRow?.content ?? "");

  if (!normalizedJournal) {
    return { ok: false, reason: "journal_required" };
  }

  // --------------------------------------------------
  // 🧠 BUILD CONTEXTUALIZED DAILY MEMORY
  // --------------------------------------------------
  const contextualizedReflection = buildContextualizedReflection({
    reflectionPrompt: journalRow?.reflection_prompt ?? null,
    actionItem: journalRow?.action_item ?? null,
    journalContent: normalizedJournal,
  });

  if (!contextualizedReflection) {
    return { ok: false, reason: "memory_build_failed" };
  }

  // --------------------------------------------------
  // 📌 DAILY SUMMARY (MEANINGFUL MEMORY)
  // --------------------------------------------------
  await supabaseServer.from("daily_summaries").upsert(
    {
      clerk_user_id: userId,
      day_number: currentDay,
      daily_summaries: contextualizedReflection.slice(0, 300),
    },
    { onConflict: "clerk_user_id,day_number" }
  );

  // --------------------------------------------------
  // 📅 WEEKLY SUMMARY (EVERY 7 DAYS)
  // --------------------------------------------------
  if (currentDay % 7 === 0) {
    const weekEnd = currentDay;
    const weekStart = currentDay - 6;

    const { data: summaries } = await supabaseServer
      .from("daily_summaries")
      .select("daily_summaries")
      .eq("clerk_user_id", userId)
      .gte("day_number", weekStart)
      .lte("day_number", weekEnd)
      .order("day_number");

    if (summaries?.length) {
      const text = summaries.map((s) => s.daily_summaries || "").join(" ");

      await supabaseServer.from("weekly_summaries").upsert(
        {
          clerk_user_id: userId,
          week_start_day: weekStart,
          week_end_day: weekEnd,
          weekly_summary: text.slice(0, 600),
        },
        { onConflict: "clerk_user_id,week_start_day" }
      );
    }
  }

  // --------------------------------------------------
  // 🎥 TRACK SHOWN VIDEO IDS (APP ONLY)
  // --------------------------------------------------
  const shownVideoIds = Array.isArray(metadata.shownVideoIds)
    ? metadata.shownVideoIds
    : [];

  const nextShownVideoIds =
    source === "app" && videoIdShown
      ? [...new Set([...shownVideoIds, videoIdShown])].slice(0, 80)
      : shownVideoIds;

  // --------------------------------------------------
  // 🏆 TRAINING CAMP START BADGE (DAY 1 ONLY)
  // --------------------------------------------------
  const earnedTrainingCampStart =
    currentDay === 1 && metadata.trainingCampStarted !== true;

  // --------------------------------------------------
  // 🔐 UPDATE CLERK METADATA (SINGLE WRITE)
  // --------------------------------------------------
  await client.users.updateUserMetadata(userId, {
    publicMetadata: {
      ...metadata,

      // ✅ Progression
      currentDay: currentDay + 1,
      totalDaysCompleted: totalDaysCompleted + 1,
      daysInRow: daysInRow + 1,
      lastCompletedAt: now.toISOString(),

      // ✅ Video tracking
      shownVideoIds: nextShownVideoIds,

      // ✅ Achievement Anchor (earned once)
      trainingCampStarted:
        metadata.trainingCampStarted === true ? true : earnedTrainingCampStart,

      trainingCampStartedAt:
        metadata.trainingCampStartedAt ??
        (earnedTrainingCampStart ? now.toISOString() : null),
    },
  });

  return {
    ok: true,
    completedDay: currentDay,
    nextDay: currentDay + 1,
  };
}
