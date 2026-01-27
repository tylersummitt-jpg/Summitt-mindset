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
 * DOMAIN CONTRACT
 * ------------------------------------------------------
 * This function NEVER throws for expected domain states.
 * All failures are returned as:
 *   { ok: false, reason: string }
 *
 * Transport layers (API routes, SMS handlers, etc.)
 * must NOT encode domain failures in HTTP status codes.
 *
 * Completion must NEVER write to journal_entries.
 * Journaling is autosave-only and canonical.
 *
 * Safe, idempotent, timezone-aware.
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
  // ✍️ JOURNAL REQUIRED (VERIFY EXISTENCE ONLY)
  // --------------------------------------------------
  const { data: journalRow, error: journalError } = await supabaseServer
    .from("journal_entries")
    .select("content")
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
  // 📌 DAILY SUMMARY
  // --------------------------------------------------
  await supabaseServer.from("daily_summaries").upsert(
    {
      clerk_user_id: userId,
      day_number: currentDay,
      daily_summaries: normalizedJournal.slice(0, 240),
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
          weekly_summary: text.slice(0, 500),
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
  // 🔐 UPDATE CLERK METADATA (SINGLE WRITE)
  // --------------------------------------------------
  await client.users.updateUserMetadata(userId, {
    publicMetadata: {
      ...metadata,
      currentDay: currentDay + 1,
      totalDaysCompleted: totalDaysCompleted + 1,
      daysInRow: daysInRow + 1,
      lastCompletedAt: now.toISOString(),
      shownVideoIds: nextShownVideoIds,
    },
  });

  return {
    ok: true,
    completedDay: currentDay,
    nextDay: currentDay + 1,
  };
}
