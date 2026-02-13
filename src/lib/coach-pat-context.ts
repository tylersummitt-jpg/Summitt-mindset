// src/lib/coach-pat-context.ts

import { supabaseServer } from "@/lib/supabase-server";
import { currentUser } from "@clerk/nextjs/server";
import { extractWeeklyPatternsFromMemoryAtoms } from "@/lib/memory/pattern-extractor";

export type StalenessMode = "fresh" | "normal" | "reentry";

export type CoachPatContext = {
  identity: {
    preferred_name?: string;
    primary_goal?: string;
    coach_tone?: string;

    spouse_name?: string;
    kids_summary?: string;

    values?: string[];

    onboarding?: {
      arena?: string;
      outcome?: string;
      practice_time_of_day?: string;
      practice_time_exact?: string;
      miss_plan?: string;
      training_themes?: string[];
    };
  };

  /**
   * 1–2 slow pattern handles, deterministic.
   * (Later: comes from pattern_insights table)
   */
  patterns: string[];

  /**
   * Single safe "most recent" memory atom.
   * Not weekly concatenation. Not day-prefixed.
   */
  recent_summary: {
    available: boolean;
    summary_text?: string;
  };

  today_context: {
    day_number: number;
    phase: "Training Camp" | "In-Season";
    staleness_mode: StalenessMode;
    hours_since_last_completion: number | null;
  };

  today_practice: {
    practice_summary: string;
  };
};

/* -------------------------------------------------- */
/* Utilities */
/* -------------------------------------------------- */

function normalizeText(input: string): string {
  return (input || "").trim().replace(/\s+/g, " ");
}

function phaseFromDay(dayNumber: number): "Training Camp" | "In-Season" {
  return dayNumber <= 30 ? "Training Camp" : "In-Season";
}

/**
 * MASTER STALENESS RULE (HOUR-BASED)
 *
 * ≤36h   → fresh (can say "yesterday/last practice" if desired)
 * 36–96h → normal ("recently/lately")
 * >96h   → reentry (no continuity references; welcome > continuity)
 */
function computeStalenessMode(hours: number | null): StalenessMode {
  if (hours === null) return "normal";
  if (hours <= 36) return "fresh";
  if (hours <= 96) return "normal";
  return "reentry";
}

/* -------------------------------------------------- */
/* Identity */
/* -------------------------------------------------- */

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

async function getIdentityFromClerk(): Promise<CoachPatContext["identity"]> {
  const user = await currentUser();

  if (!user) {
    return { coach_tone: "calm, steady, direct" };
  }

  const pm: any = user.publicMetadata ?? {};

  const preferredName = safeString(pm.preferred_name) || safeString(user.firstName);

  const primaryGoal = safeString(pm.summittGoal) || safeString(pm.primary_goal);

  const spouseName = safeString(pm.spouse_name);
  const kidsSummary = safeString(pm.kids_summary);

  const trainingThemes = safeStringArray(pm.trainingThemes);

  return {
    preferred_name: preferredName,
    primary_goal: primaryGoal,
    coach_tone: "calm, steady, direct",
    spouse_name: spouseName,
    kids_summary: kidsSummary,

    // Keep values minimal: use themes only (avoid noisy merges for now)
    values: trainingThemes,

    onboarding: {
      arena: safeString(pm.onboardingArena),
      outcome: safeString(pm.onboardingOutcome),
      practice_time_of_day: safeString(pm.onboardingPracticeTimeOfDay),
      practice_time_exact: safeString(pm.onboardingPracticeTimeExact),
      miss_plan: safeString(pm.onboardingMissPlan),
      training_themes: trainingThemes,
    },
  };
}

/* -------------------------------------------------- */
/* Staleness — canonical source: Clerk metadata */
/* -------------------------------------------------- */

async function getHoursSinceLastCompletion(): Promise<number | null> {
  const user = await currentUser();
  if (!user) return null;

  const pm: any = user.publicMetadata ?? {};
  const stamp = pm.lastCompletedAt;

  if (typeof stamp !== "string") return null;

  const last = new Date(stamp);
  if (Number.isNaN(last.getTime())) return null;

  const diffMs = Date.now() - last.getTime();
  const hours = diffMs / (1000 * 60 * 60);

  return Number.isFinite(hours) ? Math.max(hours, 0) : null;
}

/* -------------------------------------------------- */
/* Memory (safe atoms only) */
/* -------------------------------------------------- */

async function getMostRecentDailyAtom(userId: string): Promise<string | null> {
  const { data } = await supabaseServer
    .from("daily_summaries")
    .select("daily_summaries")
    .eq("clerk_user_id", userId)
    .order("day_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const atom = normalizeText((data as any)?.daily_summaries ?? "");
  return atom || null;
}

async function getRecentAtoms(userId: string, limit: number): Promise<string[]> {
  const { data } = await supabaseServer
    .from("daily_summaries")
    .select("daily_summaries")
    .eq("clerk_user_id", userId)
    .order("day_number", { ascending: false })
    .limit(limit);

  if (!data) return [];

  return data
    .map((row: any) => normalizeText(row?.daily_summaries ?? ""))
    .filter(Boolean);
}

/* -------------------------------------------------- */
/* Practice Summary (keep minimal; do not restate actionItem) */
/* -------------------------------------------------- */

function summarizePractice(actionItem: string): string {
  const cleaned = normalizeText(actionItem).toLowerCase();

  if (!cleaned) return "A short daily practice with a calm standard.";

  if (cleaned.includes("focus") || cleaned.includes("attention"))
    return "A focus practice designed to keep it simple and present.";
  if (cleaned.includes("discipline") || cleaned.includes("standard") || cleaned.includes("commit"))
    return "A discipline practice designed to hold a small standard.";
  if (cleaned.includes("lead") || cleaned.includes("team"))
    return "A leadership practice designed to raise the standard in real moments.";
  if (cleaned.includes("gratitude") || cleaned.includes("thank"))
    return "A perspective practice designed to steady your mind and widen the lens.";
  if (cleaned.includes("confidence") || cleaned.includes("self-belief"))
    return "A confidence practice designed to build trust through action.";
  if (cleaned.includes("stress") || cleaned.includes("overwhelm") || cleaned.includes("anx"))
    return "A steadiness practice designed to settle and choose the next step.";

  return "A daily practice designed to build steadiness and follow-through.";
}

/* -------------------------------------------------- */
/* Main Builder */
/* -------------------------------------------------- */

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

  const identity = await getIdentityFromClerk();

  const hoursSinceLastCompletion = await getHoursSinceLastCompletion();
  const staleness_mode = computeStalenessMode(hoursSinceLastCompletion);

  // Recent single atom (Layer 3) — disable entirely on reentry
  let recentSummaryAvailable = true;
  let recentSummaryText: string | undefined;

  if (staleness_mode === "reentry") {
    recentSummaryAvailable = false;
  } else {
    const atom = await getMostRecentDailyAtom(userId);
    if (atom) recentSummaryText = atom;
    else recentSummaryAvailable = false;
  }

  // Patterns (Layer 2) — deterministic from safe atoms; disable on reentry
  const patterns =
    staleness_mode === "reentry"
      ? []
      : extractWeeklyPatternsFromMemoryAtoms(await getRecentAtoms(userId, 10));

  return {
    identity,
    patterns,
    recent_summary: {
      available: recentSummaryAvailable,
      summary_text: recentSummaryText,
    },
    today_context: {
      day_number: dayNumber,
      phase,
      staleness_mode,
      hours_since_last_completion: hoursSinceLastCompletion,
    },
    today_practice: {
      practice_summary: summarizePractice(actionItem),
    },
  };
}
