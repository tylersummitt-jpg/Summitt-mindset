// src/lib/complete-day.ts

import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { compressReflectionToMemoryAtom } from "@/lib/memory/compress-reflection";
import { extractWeeklyPatternsFromMemoryAtoms } from "@/lib/memory/pattern-extractor";
import { awardAchievementsIfEligible } from "@/lib/achievements/award";
import { getOrCreateDailyPracticeVersion } from "@/lib/get-or-create-daily-practice-version";

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

async function tryInsertCompletionLock({
  userId,
  dayKey,
  source,
  dayNumber,
  timezone,
}: {
  userId: string;
  dayKey: string;
  source: CompleteDaySource;
  dayNumber: number;
  timezone: string;
}): Promise<
  { ok: true } | { ok: false; reason: "already_completed_today" | "lock_failed" }
> {
  const { error } = await supabaseServer.from("daily_completion_events").insert({
    clerk_user_id: userId,
    day_key: dayKey,
    source,
    day_number: dayNumber,
    timezone,
  });

  if (!error) return { ok: true };

  const code = (error as any)?.code;
  if (code === "23505") {
    return { ok: false, reason: "already_completed_today" };
  }

  console.error("COMPLETION LOCK INSERT ERROR:", error);
  return { ok: false, reason: "lock_failed" };
}

/* ======================================================
   Pattern + Identity Functions
====================================================== */

async function updatePatternInsights({
  userId,
  weekNumber,
  weeklyPatterns,
}: {
  userId: string;
  weekNumber: number;
  weeklyPatterns: { key: string; text: string }[];
}) {
  for (const p of weeklyPatterns) {
    const { data: existing } = await supabaseServer
      .from("pattern_insights")
      .select("confidence")
      .eq("clerk_user_id", userId)
      .eq("pattern_key", p.key)
      .maybeSingle();

    if (!existing) {
      await supabaseServer.from("pattern_insights").insert({
        clerk_user_id: userId,
        pattern_key: p.key,
        pattern_text: p.text,
        confidence: 1,
        first_seen_week: weekNumber,
        last_seen_week: weekNumber,
      });
    } else {
      await supabaseServer
        .from("pattern_insights")
        .update({
          confidence: existing.confidence + 1,
          last_seen_week: weekNumber,
          updated_at: new Date().toISOString(),
        })
        .eq("clerk_user_id", userId)
        .eq("pattern_key", p.key);
    }
  }
}

/**
 * Improved phrasing for recent summary
 * Uses top patterns but converts them into natural coaching language.
 */
async function updateRecentSummary({ userId }: { userId: string }) {
  const { data: patterns } = await supabaseServer
    .from("pattern_insights")
    .select("pattern_key, confidence")
    .eq("clerk_user_id", userId)
    .order("confidence", { ascending: false })
    .limit(2);

  if (!patterns || patterns.length === 0) return;

  const keys = patterns.map((p) => p.pattern_key);

  function phrase(key: string): string {
    switch (key) {
      case "follow-through":
        return "finishing what matters";
      case "focus":
        return "protecting your attention";
      case "discipline":
        return "holding your standard";
      case "calm under pressure":
        return "staying steady under pressure";
      case "communication":
        return "speaking clearly";
      case "clarity":
        return "getting clear on priorities";
      case "leadership":
        return "leading yourself better";
      case "confidence":
        return "building confidence through action";
      case "courage":
        return "moving toward hard things";
      case "respect":
        return "raising your standard with people";
      case "gratitude":
        return "keeping perspective";
      case "trust":
        return "being dependable";
      case "health":
        return "taking care of your energy";
      case "family":
        return "showing up for family";
      case "energy":
        return "showing up even when energy dips";
      case "avoidance":
        return "moving past hesitation";
      default:
        return key;
    }
  }

  const summary =
    keys.length === 1
      ? `You are getting stronger at ${phrase(keys[0])}.`
      : `You are getting stronger at ${phrase(keys[0])} and ${phrase(keys[1])}.`;

  await supabaseServer.from("recent_summary").upsert({
    clerk_user_id: userId,
    summary_text: summary,
    updated_at: new Date().toISOString(),
  });
}

/* ======================================================
   COMPLETE DAY
====================================================== */

export async function completeDay({
  userId,
  source,
}: {
  userId: string;
  source: CompleteDaySource;
}): Promise<CompleteDayResult> {
  try {
    const metadata = await getClerkPublicMetadata(userId);

    const currentDay =
      typeof metadata.currentDay === "number" && metadata.currentDay > 0
        ? metadata.currentDay
        : null;

    if (!currentDay) return { ok: false, reason: "no_current_day" };

    const totalDaysCompleted = numberOrZero(metadata.totalDaysCompleted);
    const daysInRow = numberOrZero(metadata.daysInRow);

    const timezone = resolveUserTimezone(metadata.timezone);
    const now = new Date();
    const todayKey = getDateKeyInTimezone(now, timezone);

    const lock = await tryInsertCompletionLock({
      userId,
      dayKey: todayKey,
      source,
      dayNumber: currentDay,
      timezone,
    });

    if (!lock.ok) return { ok: false, reason: lock.reason };

    const version = await getOrCreateDailyPracticeVersion({
      userId,
      dayNumber: currentDay,
    });

    /* --------------------------------------------------
       JOURNAL LOOKUP (with retry to avoid SMS race)
    -------------------------------------------------- */

    const { data: journalRow, error: journalError } = await supabaseServer
      .from("journal_entries")
      .select("content")
      .eq("clerk_user_id", userId)
      .eq("day_number", currentDay)
      .maybeSingle();

    if (journalError) {
      console.error("JOURNAL LOOKUP ERROR:", journalError);
      return { ok: false, reason: "journal_lookup_failed" };
    }

    let rawJournal = normalizeText(journalRow?.content ?? "");

    if (!rawJournal) {
      const { data: retryRow } = await supabaseServer
        .from("journal_entries")
        .select("content")
        .eq("clerk_user_id", userId)
        .eq("day_number", currentDay)
        .maybeSingle();

      rawJournal = normalizeText(retryRow?.content ?? "");
    }

    if (!rawJournal) {
      console.warn("Journal still empty after retry.");
      return { ok: false, reason: "journal_required" };
    }

    /* --------------------------------------------------
       MEMORY BUILD
    -------------------------------------------------- */

    const memoryAtom = compressReflectionToMemoryAtom({
      actionItem: version.actionItem,
      journalContent: rawJournal,
      maxChars: 300,
    });

    if (!memoryAtom) {
      console.error("Memory atom build failed.");
      return { ok: false, reason: "memory_build_failed" };
    }

    /* --------------------------------------------------
       ARCHIVE DAILY PROMPT
    -------------------------------------------------- */

    const { error: archiveError } = await supabaseServer
      .from("daily_prompts")
      .upsert(
        {
          clerk_user_id: userId,
          day_number: currentDay,
          action_item: version.actionItem,
          reflection_prompt: version.reflectionPrompt,
          source: version.source,
        },
        { onConflict: "clerk_user_id,day_number" }
      );

    if (archiveError) {
      console.error("DAILY PROMPT ARCHIVE ERROR:", archiveError);
      return { ok: false, reason: "daily_prompt_archive_failed" };
    }

    /* --------------------------------------------------
       DAILY SUMMARY UPSERT
    -------------------------------------------------- */

    const { error: dailySummaryError } = await supabaseServer
      .from("daily_summaries")
      .upsert(
        {
          clerk_user_id: userId,
          day_number: currentDay,
          daily_summaries: memoryAtom,
        },
        { onConflict: "clerk_user_id,day_number" }
      );

    if (dailySummaryError) {
      console.error("DAILY SUMMARY UPSERT ERROR:", dailySummaryError);
      return { ok: false, reason: "daily_summary_upsert_failed" };
    }

    /* --------------------------------------------------
       WEEKLY LOGIC
    -------------------------------------------------- */

    if (currentDay % 7 === 0) {
      const weekEnd = currentDay;
      const weekStart = currentDay - 6;

      const { data: summaries, error: weeklyLoadError } =
        await supabaseServer
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

      const atoms =
        summaries
          ?.map((s: any) => normalizeText(s?.daily_summaries ?? ""))
          .filter(Boolean) ?? [];

      if (atoms.length) {
        const weekly = extractWeeklyPatternsFromMemoryAtoms(atoms);

        await updatePatternInsights({
          userId,
          weekNumber: weekStart,
          weeklyPatterns: weekly.patterns,
        });

        await updateRecentSummary({ userId });

        const formatted =
          `${weekly.identity}\n` +
          weekly.patterns.map((p) => `• ${p.text}`).join("\n") +
          `\n${weekly.encouragement}`;

        const { error: weeklyUpsertError } = await supabaseServer
          .from("weekly_summaries")
          .upsert(
            {
              clerk_user_id: userId,
              week_start_day: weekStart,
              week_end_day: weekEnd,
              weekly_summary: formatted,
            },
            { onConflict: "clerk_user_id,week_start_day" }
          );

        if (weeklyUpsertError) {
          console.error("WEEKLY SUMMARY UPSERT ERROR:", weeklyUpsertError);
          return { ok: false, reason: "weekly_summary_upsert_failed" };
        }
      }
    }

    /* --------------------------------------------------
       CLERK METADATA UPDATE
    -------------------------------------------------- */

    const newTotalDaysCompleted = totalDaysCompleted + 1;

    try {
      await updateClerkPublicMetadata(userId, {
        currentDay: currentDay + 1,
        totalDaysCompleted: newTotalDaysCompleted,
        daysInRow: daysInRow + 1,
        lastCompletedAt: now.toISOString(),

        activeCoachDay: currentDay,
        activeCoachDayKey: todayKey,
      });
    } catch (err) {
      console.error("CLERK METADATA UPDATE FAILED:", err);
    }

    /* --------------------------------------------------
       ACHIEVEMENTS
    -------------------------------------------------- */

    try {
      await awardAchievementsIfEligible({
        userId,
        totalDaysCompleted: newTotalDaysCompleted,
      });
    } catch (err) {
      console.error("[Achievement award error]", err);
    }

    return {
      ok: true,
      completedDay: currentDay,
      nextDay: currentDay + 1,
    };
  } catch (err) {
    console.error("COMPLETE DAY FATAL ERROR:", err);
    return { ok: false, reason: "unexpected_error" };
  }
}