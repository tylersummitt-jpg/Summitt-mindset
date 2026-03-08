// src/lib/coach-pat-context.ts

import { supabaseServer } from "@/lib/supabase-server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import {
  buildProfileContextForCoachNote,
  type ProfileContext,
} from "@/lib/profile-context";

export type StalenessMode = "fresh" | "normal" | "reentry";

export type CoachPatContext = {
  patterns: string[];
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
    practice_action_signal: string;
  };
  profile_context: {
    available: boolean;
    identity?: string;
    relationships?: string;
    work?: string;
    health?: string;
    pressure?: string;
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

function computeStalenessMode(hours: number | null): StalenessMode {
  if (hours === null) return "normal";
  if (hours <= 36) return "fresh";
  if (hours <= 96) return "normal";
  return "reentry";
}

/**
 * NOTE TO SELF:
 * getOrCreateDailyPracticeVersion() can append a tone line to actionItem,
 * so do not summarize the whole string blindly. We only want the core
 * action signal, not the extra "fresh angle today" coaching line.
 */
function getPrimaryActionSignal(actionItem: string): string {
  const cleaned = normalizeText(actionItem);
  if (!cleaned) return "";

  const splitters = [
    "Fresh angle today:",
    "If today gets crowded,",
    "If the day gets crowded,",
    "Today’s standard:",
    "Today's standard:",
  ];

  for (const marker of splitters) {
    const idx = cleaned.indexOf(marker);
    if (idx > 0) {
      return normalizeText(cleaned.slice(0, idx));
    }
  }

  return cleaned;
}

function summarizePractice(actionItem: string): string {
  const core = getPrimaryActionSignal(actionItem).toLowerCase();

  if (!core) return "A short daily practice with a calm standard.";

  if (
    core.includes("focus") ||
    core.includes("present") ||
    core.includes("attention")
  ) {
    return "A focus practice to stay present in one real moment.";
  }

  if (
    core.includes("discipline") ||
    core.includes("standard") ||
    core.includes("follow through") ||
    core.includes("follow-through")
  ) {
    return "A discipline practice to hold a small standard and follow through.";
  }

  if (
    core.includes("lead") ||
    core.includes("leadership") ||
    core.includes("example")
  ) {
    return "A leadership practice in the way they carry themselves today.";
  }

  if (
    core.includes("gratitude") ||
    core.includes("perspective") ||
    core.includes("thankful")
  ) {
    return "A perspective practice to steady the mind and widen the view.";
  }

  if (
    core.includes("confidence") ||
    core.includes("courage") ||
    core.includes("bold")
  ) {
    return "A courage practice through one clear action.";
  }

  if (
    core.includes("stress") ||
    core.includes("calm") ||
    core.includes("steady") ||
    core.includes("pressure")
  ) {
    return "A steadiness practice for handling pressure with calm.";
  }

  if (
    core.includes("conversation") ||
    core.includes("honest") ||
    core.includes("truth") ||
    core.includes("speak")
  ) {
    return "A practice in being clear and honest in a real conversation.";
  }

  if (
    core.includes("health") ||
    core.includes("energy") ||
    core.includes("rest") ||
    core.includes("body")
  ) {
    return "A practice in taking care of the body with intention.";
  }

  return "A daily practice to stay steady and take the next right step.";
}

function hasAnyProfileContext(profile: ProfileContext): boolean {
  return Boolean(
    profile.identity ||
      profile.relationships ||
      profile.work ||
      profile.health ||
      profile.pressure
  );
}

/* -------------------------------------------------- */
/* Memory */
/* -------------------------------------------------- */

async function getRecentSummary(userId: string): Promise<string | null> {
  const { data } = await supabaseServer
    .from("recent_summary")
    .select("summary_text")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  const text = normalizeText((data as any)?.summary_text ?? "");
  return text || null;
}

async function getTopPatterns(userId: string): Promise<string[]> {
  const { data } = await supabaseServer
    .from("pattern_insights")
    .select("pattern_key")
    .eq("clerk_user_id", userId)
    .order("confidence", { ascending: false })
    .limit(2);

  if (!data) return [];

  return data
    .map((p: any) => normalizeText(p?.pattern_key ?? ""))
    .filter(Boolean);
}

/* -------------------------------------------------- */
/* Staleness (CRON-SAFE) */
/* -------------------------------------------------- */

function computeHoursSinceLastCompletion(stamp?: string): number | null {
  if (!stamp) return null;

  const last = new Date(stamp);
  if (Number.isNaN(last.getTime())) return null;

  const diffMs = Date.now() - last.getTime();
  const hours = diffMs / (1000 * 60 * 60);

  return Number.isFinite(hours) ? Math.max(hours, 0) : null;
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
  const metadata = await getClerkPublicMetadata(userId);

  const hoursSinceLastCompletion = computeHoursSinceLastCompletion(
    metadata?.lastCompletedAt
  );

  const staleness_mode = computeStalenessMode(hoursSinceLastCompletion);
  const phase = phaseFromDay(dayNumber);

  let recentSummaryAvailable = true;
  let recentSummaryText: string | undefined;

  if (staleness_mode === "reentry") {
    recentSummaryAvailable = false;
  } else {
    const summary = await getRecentSummary(userId);
    if (summary) {
      recentSummaryText = summary;
    } else {
      recentSummaryAvailable = false;
    }
  }

  const patterns =
    staleness_mode === "reentry" ? [] : await getTopPatterns(userId);

  const profile = await buildProfileContextForCoachNote(userId);

  return {
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
      practice_action_signal: getPrimaryActionSignal(actionItem),
    },
    profile_context: {
      available: hasAnyProfileContext(profile),
      identity: profile.identity,
      relationships: profile.relationships,
      work: profile.work,
      health: profile.health,
      pressure: profile.pressure,
    },
  };
}