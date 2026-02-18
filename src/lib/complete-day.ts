// src/lib/complete-day.ts

import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { ensureDailyPrompt } from "@/lib/ensure-daily-prompt";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { compressReflectionToMemoryAtom } from "@/lib/memory/compress-reflection";
import { extractWeeklyPatternsFromMemoryAtoms } from "@/lib/memory/pattern-extractor";
import { sendSMS, isTwilioReady } from "@/lib/twilio";

/**
 * ======================================================
 * Complete Day (CANONICAL)
 * ======================================================
 *
 * The ONLY place where day progression happens.
 *
 * Completion responsibilities:
 * - verify journal exists
 * - generate coach-safe daily memory (deterministic, non-verbatim)
 * - update weekly summary safely (identity + patterns, not diary glue)
 * - advance progression safely
 *
 * Raw journal entries are NEVER modified here.
 *
 * ======================================================
 * Memory Safety Rules (non-negotiable)
 * - Never store verbatim journaling
 * - Never store quotes
 * - Never mention journaling / entries
 * - Never store timestamps (today/yesterday/etc.)
 */

export type CompleteDaySource = "app" | "sms";

export type CompleteDayResult =
  | { ok: true; completedDay: number; nextDay: number }
  | { ok: false; reason: string };

const MILESTONES = [7, 14, 30, 50, 100, 180, 365];

function milestoneMessage(days: number): string {
  if (days === 7)
    return `7 days.\n\nYou're building consistency.\n\nKeep going.`;

  if (days === 14)
    return `14 days.\n\nMomentum is forming.\n\nStay steady.`;

  if (days === 30)
    return `30 days.\n\nThis is no longer a streak.\nIt's who you're becoming.`;

  if (days === 50)
    return `50 days.\n\nQuiet discipline compounds.\n\nKeep showing up.`;

  if (days === 100)
    return `100 days.\n\nMost people quit.\n\nYou didn't.`;

  if (days === 180)
    return `180 days.\n\nThis is identity now.\n\nKeep leading yourself.`;

  if (days === 365)
    return `365 days.\n\nA full year.\n\nYou built something real.`;

  return "";
}

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length ? t : null;
}

function stripTimeWords(text: string): string {
  return (text || "")
    .replace(
      /\b(today|yesterday|tomorrow|this week|last week|this month|last month)\b/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Weekly framing:
 * This is the identity anchor that makes weekly summaries meaningful.
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

function buildWeeklySummaryText({
  framing,
  patterns,
  atoms,
}: {
  framing: string | null;
  patterns: string[];
  atoms: string[];
}): string {
  const parts: string[] = [];

  if (framing) parts.push(framing);

  // Patterns are the moat. Keep these early in the string.
  for (const p of patterns.slice(0, 2)) {
    parts.push(p);
  }

  // Add a short recap without becoming diary-like.
  if (atoms.length) {
    const recap = atoms.slice(0, 3).join(" ");
    parts.push(recap);
  }

  // Hard sanitize
  let combined = normalizeText(parts.join(" "))
    .replace(/["']/g, "")
    .replace(/\b(journal|journaling|entry|wrote|writing)\b/gi, "")
    .trim();

  combined = stripTimeWords(combined);

  return normalizeText(combined);
}

/**
 * ======================================================
 * Completion Lock
 * ======================================================
 *
 * Prevents double completion in same local day,
 * even under race conditions / double taps / SMS spam.
 *
 * Uses Supabase unique index:
 * (clerk_user_id, day_key)
 */
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

  // Postgres unique violation = 23505
  // Supabase error shape usually includes `code`
  const code = (error as any)?.code;

  if (code === "23505") {
    return { ok: false, reason: "already_completed_today" };
  }

  console.error("COMPLETION LOCK INSERT ERROR:", error);
  return { ok: false, reason: "lock_failed" };
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
  // 🗓️ TIMEZONE-SAFE TODAY KEY
  // --------------------------------------------------
  const timezone = resolveUserTimezone(metadata.timezone);
  const now = new Date();
  const todayKey = getDateKeyInTimezone(now, timezone);

  // --------------------------------------------------
  // 🔒 HARD LOCK (race-safe)
  // --------------------------------------------------
  const lock = await tryInsertCompletionLock({
    userId,
    dayKey: todayKey,
    source,
    dayNumber: currentDay,
    timezone,
  });

  if (!lock.ok) {
    return { ok: false, reason: lock.reason };
  }

  // --------------------------------------------------
  // 🧠 ENSURE DAILY PROMPT (CURRENT DAY ONLY)
  // --------------------------------------------------
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
  // ✍️ LOAD JOURNAL (REQUIRED)
  // --------------------------------------------------
  const { data: journalRow, error: journalError } = await supabaseServer
    .from("journal_entries")
    .select("content, action_item")
    .eq("clerk_user_id", userId)
    .eq("day_number", currentDay)
    .maybeSingle();

  if (journalError) {
    return { ok: false, reason: "journal_lookup_failed" };
  }

  const rawJournal = normalizeText(journalRow?.content ?? "");
  if (!rawJournal) {
    return { ok: false, reason: "journal_required" };
  }

  // --------------------------------------------------
  // 🧠 DAILY MEMORY ATOM (DETERMINISTIC, SAFE)
  // --------------------------------------------------
  const actionItem =
    normalizeText(journalRow?.action_item ?? "") ||
    normalizeText(ensuredPrompt?.actionItem ?? "") ||
    null;

  const memoryAtom = compressReflectionToMemoryAtom({
    actionItem,
    journalContent: rawJournal,
    maxChars: 300,
  });

  if (!memoryAtom) {
    return { ok: false, reason: "memory_build_failed" };
  }

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

  // Fail-closed: memory is part of the OS
  if (dailySummaryError) {
    console.error("DAILY SUMMARY UPSERT ERROR:", dailySummaryError);
    return { ok: false, reason: "daily_summary_upsert_failed" };
  }

  // --------------------------------------------------
  // 📅 WEEKLY SUMMARY (EVERY 7 DAYS) — SAFE + PATTERNED
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

    const atoms =
      summaries
        ?.map((s: any) => normalizeText(s?.daily_summaries ?? ""))
        .filter(Boolean) ?? [];

    if (atoms.length) {
      const onboardingOutcome = safeString(metadata.onboardingOutcome);
      const onboardingArena = safeString(metadata.onboardingArena);

      const framing = buildWeeklyFraming({
        onboardingOutcome,
        onboardingArena,
      });

      const patterns = extractWeeklyPatternsFromMemoryAtoms(atoms);

      const weeklySummary = buildWeeklySummaryText({
        framing,
        patterns,
        atoms,
      }).slice(0, 600);

      const { error: weeklyUpsertError } = await supabaseServer
        .from("weekly_summaries")
        .upsert(
          {
            clerk_user_id: userId,
            week_start_day: weekStart,
            week_end_day: weekEnd,
            weekly_summary: weeklySummary,
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
    currentDay: currentDay + 1,
    totalDaysCompleted: totalDaysCompleted + 1,
    daysInRow: daysInRow + 1,
    lastCompletedAt: now.toISOString(),

    shownVideoIds: nextShownVideoIds,

    trainingCampStarted:
      metadata.trainingCampStarted === true ? true : earnedTrainingCampStart,

    trainingCampStartedAt:
      metadata.trainingCampStartedAt ??
      (earnedTrainingCampStart ? now.toISOString() : null),
  });

  // --------------------------------------------------
  // 🏆 MILESTONE SMS (RETENTION MODE)
  // --------------------------------------------------

  const newTotal = totalDaysCompleted + 1;

  if (MILESTONES.includes(newTotal) && metadata.smsEnabled === true) {
    const message = milestoneMessage(newTotal);

    const { data: identity } = await supabaseServer
      .from("sms_identities")
      .select("phone_number")
      .eq("clerk_user_id", userId)
      .maybeSingle();

    if (identity?.phone_number && isTwilioReady()) {
      try {
        const sms = await sendSMS({
          to: identity.phone_number,
          body: message,
        });

        await supabaseServer.from("sms_send_events").insert({
          clerk_user_id: userId,
          day_key: todayKey,
          message_sid: sms.sid,
          status: sms.status,
          metadata: {
            milestone: true,
            milestone_day: newTotal,
          },
        });
      } catch (err) {
        console.error("MILESTONE SMS ERROR:", err);
      }
    }
  }

  return {
    ok: true,
    completedDay: currentDay,
    nextDay: currentDay + 1,
  };
}
