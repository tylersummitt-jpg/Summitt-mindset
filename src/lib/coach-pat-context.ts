// src/lib/coach-pat-context.ts

import { supabaseServer } from "@/lib/supabase-server";
import { currentUser } from "@clerk/nextjs/server";

/**
 * ======================================================
 * CoachPatContext (LOCKED SHAPE)
 * ======================================================
 *
 * This context is the ONLY input to Coach Pat daily note.
 *
 * Goals:
 * - Make the note deeply personal
 * - Ground in memory without "memory talk"
 * - Respect staleness (reentry mode disables memory)
 * - Keep the shape stable
 *
 * ======================================================
 * 2026-02 UPDATE:
 * We now support the new onboarding model:
 * - Arena + Outcome
 * - Schedule + Reset Plan
 * - Training Themes (3)
 * - SMS consent (not used in coaching, but stored)
 *
 * Coach Pat MUST be able to reference these subtly.
 */

export type StalenessMode = "fresh" | "normal" | "reentry";

export type CoachPatContext = {
  identity: {
    preferred_name?: string;

    /**
     * "primary_goal" is legacy from old onboarding (summittGoal).
     * We keep it for backwards compatibility.
     */
    primary_goal?: string;

    coach_tone?: string;

    // Optional future fields
    spouse_name?: string;
    kids_summary?: string;

    /**
     * "values" is a merged set of anchors.
     * We keep it short and stable.
     */
    values?: string[];

    /**
     * ======================================================
     * NEW: Onboarding identity seed
     * ======================================================
     *
     * This is the user's stated arena + outcome.
     * This is the core personalization hook for Training Camp.
     */
    onboarding?: {
      arena?: string;
      outcome?: string;

      /**
       * Scheduling + reset plan.
       * These help Coach Pat reinforce the system.
       */
      practice_time_of_day?: string; // morning | midday | evening
      practice_time_exact?: string; // "7:00 AM" etc
      miss_plan?: string;

      /**
       * Training themes are skill targets.
       */
      training_themes?: string[];
    };
  };

  patterns: string[];

  recent_summary: {
    available: boolean;
    summary_text?: string;
  };

  today_context: {
    day_number: number;
    phase: "Training Camp" | "In-Season";
    staleness_mode: StalenessMode;
    days_since_last_completion: number | null;
  };

  today_practice: {
    practice_summary: string;
  };
};

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

function phaseFromDay(dayNumber: number): "Training Camp" | "In-Season" {
  return dayNumber <= 30 ? "Training Camp" : "In-Season";
}

function computeStalenessMode(daysSince: number | null): StalenessMode {
  if (daysSince === null) return "normal";
  if (daysSince <= 1) return "fresh";
  if (daysSince <= 3) return "normal";
  return "reentry";
}

/**
 * Keep this short and "coachable".
 * We do NOT want the practice summary to be generic.
 * It should hint at the real actionItem without restating it verbatim.
 */
function summarizePractice(actionItem: string): string {
  const cleaned = normalizeText(actionItem);

  if (!cleaned) {
    return "A focused daily practice followed by honest reflection.";
  }

  // Lightweight heuristic:
  // turn the action item into a short coaching category
  const lower = cleaned.toLowerCase();

  if (lower.includes("write") || lower.includes("journal")) {
    return "A writing-based practice designed to build clarity through honesty.";
  }

  if (lower.includes("lead") || lower.includes("team")) {
    return "A leadership practice designed to raise your standard in real moments.";
  }

  if (lower.includes("discipline") || lower.includes("standard")) {
    return "A discipline practice designed to hold the standard even when it’s small.";
  }

  if (lower.includes("gratitude") || lower.includes("thank")) {
    return "A reflection practice designed to build steadiness and perspective.";
  }

  if (lower.includes("focus") || lower.includes("attention")) {
    return "A focus practice designed to strengthen your ability to stay present.";
  }

  // Default: use a short trimmed version of the actionItem
  // without copying it word-for-word.
  const clipped =
    cleaned.length > 90 ? `${cleaned.slice(0, 90).trim()}…` : cleaned;

  return `A practice built around: ${clipped}`;
}

async function getDaysSinceLastCompletion(userId: string): Promise<number | null> {
  const { data } = await supabaseServer
    .from("daily_summaries")
    .select("updated_at, created_at")
    .eq("clerk_user_id", userId)
    .order("day_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const stampRaw = (data as any).updated_at || (data as any).created_at;
  if (!stampRaw) return null;

  const diffMs = Date.now() - new Date(stampRaw).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return Number.isFinite(days) ? Math.max(days, 0) : null;
}

async function getLatestWeeklySummary(userId: string): Promise<string | null> {
  const { data } = await supabaseServer
    .from("weekly_summaries")
    .select("weekly_summary")
    .eq("clerk_user_id", userId)
    .order("week_end_day", { ascending: false })
    .limit(1)
    .maybeSingle();

  const txt = normalizeText(data?.weekly_summary ?? "");
  return txt || null;
}

async function getLastDailySummaries(
  userId: string,
  limit: number
): Promise<string[]> {
  const { data } = await supabaseServer
    .from("daily_summaries")
    .select("day_number, daily_summaries")
    .eq("clerk_user_id", userId)
    .order("day_number", { ascending: false })
    .limit(limit);

  if (!data || !Array.isArray(data)) return [];

  const cleaned = data
    .map((row: any) => {
      const txt = normalizeText(row?.daily_summaries ?? "");
      const dayNum =
        typeof row?.day_number === "number" ? row.day_number : null;

      if (!txt) return null;

      // We prefix with day number so the model can sense continuity,
      // without ever referencing dates.
      return dayNum ? `Day ${dayNum}: ${txt}` : txt;
    })
    .filter(Boolean) as string[];

  return cleaned;
}

/**
 * ======================================================
 * Pattern extraction (NO AI)
 * ======================================================
 *
 * We keep patterns short, coachable, and non-therapist-y.
 * The goal is to give the model a few "handles".
 */
function extractPatternsFromText(text: string): string[] {
  const t = normalizeText(text).toLowerCase();
  if (!t) return [];

  const patterns: string[] = [];

  // These are deliberately broad and non-judgmental.
  if (t.includes("overthink") || t.includes("stuck") || t.includes("spiral")) {
    patterns.push("You tend to get stuck in your head before taking action.");
  }

  if (t.includes("tired") || t.includes("exhaust") || t.includes("burnout")) {
    patterns.push("Energy has been a real factor — you’re learning to show up anyway.");
  }

  if (t.includes("avoid") || t.includes("procrast")) {
    patterns.push("Avoidance shows up sometimes — but you’re getting more honest about it.");
  }

  if (t.includes("consistent") || t.includes("showed up") || t.includes("daily")) {
    patterns.push("You’re building consistency through small wins.");
  }

  if (t.includes("confidence") || t.includes("self-belief")) {
    patterns.push("Confidence is growing when you keep promises to yourself.");
  }

  if (t.includes("control") || t.includes("perfection")) {
    patterns.push("Perfectionism tries to creep in — your job is to stay simple and execute.");
  }

  if (t.includes("family") || t.includes("kids") || t.includes("spouse")) {
    patterns.push("Family is a major motivator — and also a real source of pressure.");
  }

  // Keep max 4 patterns
  return patterns.slice(0, 4);
}

function uniqueStrings(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of list) {
    const cleaned = normalizeText(item);
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }

  return out;
}

function safeString(x: any): string | undefined {
  const txt = typeof x === "string" ? normalizeText(x) : "";
  return txt ? txt : undefined;
}

function safeStringArray(x: any): string[] | undefined {
  if (!Array.isArray(x)) return undefined;

  const cleaned = x
    .map((v) => (typeof v === "string" ? normalizeText(v) : ""))
    .filter(Boolean);

  return cleaned.length ? cleaned : undefined;
}

function safeLowercaseSlugArray(x: any): string[] | undefined {
  if (!Array.isArray(x)) return undefined;

  const cleaned = x
    .map((v) => (typeof v === "string" ? normalizeText(v).toLowerCase() : ""))
    .filter(Boolean);

  return cleaned.length ? cleaned : undefined;
}

/**
 * ======================================================
 * Identity builder (Clerk publicMetadata)
 * ======================================================
 *
 * This is the ONLY place Coach Pat is allowed to learn
 * onboarding identity.
 */
async function getIdentityFromClerk(): Promise<CoachPatContext["identity"]> {
  const user = await currentUser();

  if (!user) {
    return {
      coach_tone: "calm, steady, direct",
    };
  }

  const pm: any = user.publicMetadata ?? {};

  // Preferred name
  const preferredName =
    safeString(pm.preferred_name) ||
    safeString(pm.firstName) ||
    safeString(user.firstName) ||
    undefined;

  /**
   * ======================================================
   * Legacy goal
   * ======================================================
   *
   * We keep this because old users might still have it.
   * But new onboarding should rely on arena + outcome.
   */
  const primaryGoal =
    safeString(pm.summittGoal) || safeString(pm.primary_goal) || undefined;

  // Values (optional)
  const values = safeStringArray(pm.values);

  // Optional future fields
  const spouseName = safeString(pm.spouse_name);
  const kidsSummary = safeString(pm.kids_summary);

  // Training themes (new onboarding is 3, old was 5)
  const trainingThemes = safeLowercaseSlugArray(pm.trainingThemes);

  // NEW onboarding seed
  const onboardingArena = safeString(pm.onboardingArena);
  const onboardingOutcome = safeString(pm.onboardingOutcome);
  const onboardingMissPlan = safeString(pm.onboardingMissPlan);

  const onboardingPracticeTimeOfDay = safeString(pm.onboardingPracticeTimeOfDay);
  const onboardingPracticeTimeExact = safeString(pm.onboardingPracticeTimeExact);

  /**
   * ======================================================
   * Values merging strategy
   * ======================================================
   *
   * We do NOT want to stuff arena/outcome into values.
   * That becomes noisy and the model over-uses it.
   *
   * But we DO want trainingThemes to influence tone.
   */
  const mergedValues = uniqueStrings([
    ...(values ?? []),
    ...(trainingThemes ?? []),
  ]);

  return {
    preferred_name: preferredName,
    primary_goal: primaryGoal,
    coach_tone: "calm, steady, direct",
    spouse_name: spouseName,
    kids_summary: kidsSummary,
    values: mergedValues.length ? mergedValues : undefined,

    onboarding: {
      arena: onboardingArena,
      outcome: onboardingOutcome,
      practice_time_of_day: onboardingPracticeTimeOfDay,
      practice_time_exact: onboardingPracticeTimeExact,
      miss_plan: onboardingMissPlan,
      training_themes: trainingThemes,
    },
  };
}

function buildRecentSummaryBundle({
  weekly,
  dailyList,
}: {
  weekly: string | null;
  dailyList: string[];
}): string | null {
  const parts: string[] = [];

  if (weekly) {
    parts.push("WEEKLY SUMMARY:");
    parts.push(weekly);
  }

  if (dailyList.length) {
    parts.push("RECENT DAILY SUMMARIES (most recent first):");
    parts.push(dailyList.join("\n"));
  }

  const combined = normalizeText(parts.join("\n\n"));
  return combined || null;
}

export async function buildCoachPatContext({
  userId,
  dayNumber,
  actionItem,
}: {
  userId: string;
  dayNumber: number;
  actionItem: string;
}): Promise<CoachPatContext> {
  const phase = phaseFromDay(dayNumber);

  // Identity (Clerk publicMetadata)
  const identity = await getIdentityFromClerk();

  // Staleness logic (from summaries)
  const daysSinceLastCompletion = await getDaysSinceLastCompletion(userId);
  const staleness_mode = computeStalenessMode(daysSinceLastCompletion);

  // Memory pulls
  const weekly = await getLatestWeeklySummary(userId);
  const last7 = await getLastDailySummaries(userId, 7);

  // ======================================================
  // Memory policy
  // - reentry: disable memory entirely (welcome > continuity)
  // - otherwise: use weekly + last 7
  // ======================================================
  let recent_summary_available = true;
  let recent_summary_text: string | undefined;

  if (staleness_mode === "reentry") {
    recent_summary_available = false;
  } else {
    const bundle = buildRecentSummaryBundle({ weekly, dailyList: last7 });
    if (bundle) {
      recent_summary_text = bundle;
    } else {
      recent_summary_available = false;
    }
  }

  // ======================================================
  // Patterns
  // ======================================================
  const patternSeed = normalizeText(
    [weekly ?? "", ...last7].filter(Boolean).join("\n")
  );

  const patterns =
    staleness_mode === "reentry" ? [] : extractPatternsFromText(patternSeed);

  return {
    identity,
    patterns,
    recent_summary: {
      available: recent_summary_available,
      summary_text: recent_summary_text,
    },
    today_context: {
      day_number: dayNumber,
      phase,
      staleness_mode,
      days_since_last_completion: daysSinceLastCompletion,
    },
    today_practice: {
      practice_summary: summarizePractice(actionItem),
    },
  };
}
