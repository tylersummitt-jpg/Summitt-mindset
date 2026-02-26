// src/lib/coach-pat-context.ts

import { supabaseServer } from "@/lib/supabase-server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { resolveUserTimezone } from "@/lib/timezone";

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

function summarizePractice(actionItem: string): string {
  const cleaned = normalizeText(actionItem).toLowerCase();

  if (!cleaned) return "A short daily practice with a calm standard.";
  if (cleaned.includes("focus")) return "A focus practice to stay present.";
  if (cleaned.includes("discipline")) return "A discipline practice to hold a small standard.";
  if (cleaned.includes("lead")) return "A leadership practice in real moments.";
  if (cleaned.includes("gratitude")) return "A perspective practice to steady your mind.";
  if (cleaned.includes("confidence")) return "A confidence practice through action.";
  if (cleaned.includes("stress")) return "A steadiness practice for the next step.";

  return "A daily practice to build steadiness.";
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
    if (summary) recentSummaryText = summary;
    else recentSummaryAvailable = false;
  }

  const patterns =
    staleness_mode === "reentry"
      ? []
      : await getTopPatterns(userId);

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
    },
  };
}