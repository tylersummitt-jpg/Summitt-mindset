import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { ensureDailyPrompt } from "@/lib/ensure-daily-prompt";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";

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
 *
 * ======================================================
 * 2026-02 Upgrade:
 * - Daily summary is now more human + coachable (still deterministic)
 * - Weekly summary is now framed with onboarding outcome when available
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

function isValidDate(d: Date): boolean {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function safeString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length ? t : null;
}

/**
 * ======================================================
 * Deterministic memory sentence (atomic)
 * ======================================================
 *
 * Goal:
 * - human
 * - coachable
 * - short
 * - time-agnostic
 *
 * This is the unit used by:
 * - Coach Pat
 * - Ask Pat grounding
 * - Weekly summary
 */
function buildContextualizedReflection({
  actionItem,
  journalContent,
}: {
  actionItem: string | null;
  journalContent: string;
}): string {
  const answer = normalizeText(journalContent);
  if (!answer) return "";

  const action = normalizeText(actionItem || "");

  // We do NOT want to quote prompts.
  // Prompts are for the user, not for memory.
  //
  // We also want to avoid awkward phrasing like:
  // "you practiced by ..."
  //
  // We keep it clean:
  // "Today you practiced: X. You noticed: Y."
  if (action) {
    return `Today you practiced: ${action}. You noticed: ${answer}.`;
  }

  return `Today you practiced with intention. You noticed: ${answer}.`;
}

/**
 * Weekly framing:
 * This is the identity anchor that makes summaries meaningful.
 */
function buildWeeklyFraming({
  onboardingOutcome,
  onboardingArena,
}: {
  onboardingOutcome: string | null;
  onboardingArena: string | null;
}): string | null {
  if (onboardingOutcome) return `Training toward: ${onboardingOutcome}.`;
  if (onboardingArena) return `Training in: ${onboardingArena}.`;
  return null;
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
  // --------------------------------------------------
  // 🔑 Read current metadata (REST, fresh)
  // --------------------------------------------------
  const metadata = await getClerkPublicMetadata(userId);

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

    // ✅ Guard against invalid date strings
    if (isValidDate(last)) {
      const lastKey = getDateKeyInTimezone(last, timezone);

      if (lastKey === todayKey) {
        return { ok: false, reason: "already_completed_today" };
      }
    }
  }

  // --------------------------------------------------
  // 🧠 ENSURE DAILY PROMPT (CURRENT DAY ONLY)
  // --------------------------------------------------
  // IMPORTANT:
  // This ensures daily_prompts is populated for BOTH:
  // - Training Camp (deterministic)
  // - In-Season (generated once, then immutable)
  //
  // This is critical because past days must always load from daily_prompts.
  const trainingCampTrack =
    metadata.trainingCampTrack === "women" ? "women" : "standard";

  const primaryGoal =
    typeof metadata.summittGoal === "string" ? metadata.summittGoal : undefined;

  const ensuredPrompt = await ensureDailyPrompt({
    userId,
    dayNumber: currentDay,
    trainingCampTrack,
    primaryGoal,
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
  // 🧠 BUILD CONTEXTUALIZED DAILY MEMORY (DETERMINISTIC)
  // --------------------------------------------------
  // We prefer the stored journal action_item, but fall back to ensuredPrompt.
  const actionItem =
    normalizeText(journalRow?.action_item ?? "") ||
    normalizeText(ensuredPrompt?.actionItem ?? "") ||
    null;

  const contextualizedReflection = buildContextualizedReflection({
    actionItem,
    journalContent: normalizedJournal,
  });

  if (!contextualizedReflection) {
    return { ok: false, reason: "memory_build_failed" };
  }

  // --------------------------------------------------
  // 📌 DAILY SUMMARY (MEANINGFUL MEMORY)
  // --------------------------------------------------
  const { error: dailySummaryError } = await supabaseServer
    .from("daily_summaries")
    .upsert(
      {
        clerk_user_id: userId,
        day_number: currentDay,
        daily_summaries: contextualizedReflection.slice(0, 300),
      },
      { onConflict: "clerk_user_id,day_number" }
    );

  // ✅ Fail-closed: memory is part of the OS
  if (dailySummaryError) {
    console.error("DAILY SUMMARY UPSERT ERROR:", dailySummaryError);
    return { ok: false, reason: "daily_summary_upsert_failed" };
  }

  // --------------------------------------------------
  // 📅 WEEKLY SUMMARY (EVERY 7 DAYS)
  // --------------------------------------------------
  if (currentDay % 7 === 0) {
    const weekEnd = currentDay;
    const weekStart = currentDay - 6;

    const { data: summaries, error: weeklyLoadError } = await supabaseServer
      .from("daily_summaries")
      .select("daily_summaries")
      .eq("clerk_user_id", userId)
      .gte("day_number", weekStart)
      .lte("day_number", weekEnd)
      .order("day_number");

    if (weeklyLoadError) {
      console.error("WEEKLY SUMMARY LOAD ERROR:", weeklyLoadError);
      return { ok: false, reason: "weekly_summary_load_failed" };
    }

    if (summaries?.length) {
      const text = summaries.map((s) => s.daily_summaries || "").join(" ");

      // ======================================================
      // NEW: Weekly framing (onboarding identity anchor)
      // ======================================================
      const onboardingOutcome = safeString(metadata.onboardingOutcome);
      const onboardingArena = safeString(metadata.onboardingArena);

      const framing = buildWeeklyFraming({
        onboardingOutcome,
        onboardingArena,
      });

      const combined = framing ? `${framing} ${text}` : text;

      const { error: weeklyUpsertError } = await supabaseServer
        .from("weekly_summaries")
        .upsert(
          {
            clerk_user_id: userId,
            week_start_day: weekStart,
            week_end_day: weekEnd,
            weekly_summary: combined.slice(0, 600),
          },
          { onConflict: "clerk_user_id,week_start_day" }
        );

      if (weeklyUpsertError) {
        console.error("WEEKLY SUMMARY UPSERT ERROR:", weeklyUpsertError);
        return { ok: false, reason: "weekly_summary_upsert_failed" };
      }
    }
  }

  // --------------------------------------------------
  // 🎥 TRACK SHOWN VIDEO IDS (APP ONLY)
  // --------------------------------------------------
  const shownVideoIdsRaw = Array.isArray(metadata.shownVideoIds)
    ? metadata.shownVideoIds
    : [];

  // ✅ Ensure only strings get stored
  const shownVideoIds = shownVideoIdsRaw.filter(
    (v: unknown) => typeof v === "string" && v.trim().length > 0
  );

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
  // 🔐 UPDATE CLERK METADATA (CANONICAL MERGE PATCH)
  // --------------------------------------------------
  await updateClerkPublicMetadata(userId, {
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
  });

  return {
    ok: true,
    completedDay: currentDay,
    nextDay: currentDay + 1,
  };
}
