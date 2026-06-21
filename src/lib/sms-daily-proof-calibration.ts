/**
 * Daily proof calibration — server-owned praise truth for daily SMS (no DB writes).
 */

import type { RelationshipMemory7dResult } from "@/lib/sms-relationship-memory-7d";

export type DailyProofPraiseAllowedLevel =
  | "none"
  | "capability_only"
  | "specific_recent_proof"
  | "measured_progress"
  | "consistency"
  | "streak";

export type DailyRecentProofStrength =
  | "none"
  | "weak_stale"
  | "weak_recent"
  | "some_recent"
  | "consistent"
  | "streak";

export type DailyProofCalibration = {
  wins_7d: number;
  misses_7d: number;
  partials_7d: number;
  misses_partials_14d: number;
  yes_streak_14d: number;
  last_user_yes_at: string | null;
  last_user_yes_local_day: string | null;
  proof_age_days: number | null;
  recent_proof_strength: DailyRecentProofStrength;
  praise_allowed_level: DailyProofPraiseAllowedLevel;
  consistency_claim_allowed: boolean;
  strong_commitment_claim_allowed: boolean;
  recent_completion_claim_allowed: boolean;
  stale_proof_warning: string | null;
  truth_summary_for_writer: string;
};

export type DeriveDailyProofCalibrationArgs = {
  facts: {
    accountability: {
      prior_outcome: string | null;
      yes_streak_14d: number | null;
      no_count_14d: number | null;
      partial_count_14d: number | null;
      days_since_last_user_outcome: number;
    };
    thread_memory: {
      relationship_memory_7d?: RelationshipMemory7dResult;
    };
  };
};

function wins7dFromMemory(memory7d: RelationshipMemory7dResult | null | undefined): {
  wins: number;
  misses: number;
  partials: number;
} {
  const c = memory7d?.outcome_counts;
  return {
    wins: c?.yes ?? 0,
    misses: c?.no ?? 0,
    partials: c?.partial ?? 0,
  };
}

function resolveLastUserYes(
  memory7d: RelationshipMemory7dResult | null | undefined,
  priorOutcome: string | null,
  daysSinceLastOutcome: number
): { at: string | null; localDay: string | null; proofAgeDays: number | null } {
  const win = memory7d?.wins?.[0];
  if (win?.at) {
    const age =
      typeof memory7d?.context_flags?.days_since_last_user_outcome === "number"
        ? memory7d.context_flags.days_since_last_user_outcome
        : priorOutcome === "user_yes"
          ? daysSinceLastOutcome
          : null;
    return {
      at: win.at,
      localDay: win.local_day_key?.trim() || null,
      proofAgeDays: age,
    };
  }
  if (priorOutcome === "user_yes") {
    return {
      at: null,
      localDay: null,
      proofAgeDays: daysSinceLastOutcome,
    };
  }
  return { at: null, localDay: null, proofAgeDays: null };
}

function deriveRecentProofStrength(args: {
  wins7d: number;
  proofAgeDays: number | null;
  yesStreak14d: number;
}): DailyRecentProofStrength {
  if (args.wins7d <= 0) return "none";
  if (args.yesStreak14d >= 5) return "streak";
  if (args.wins7d >= 3 && args.proofAgeDays != null && args.proofAgeDays <= 1) return "consistent";
  if (args.wins7d <= 2 && args.proofAgeDays != null && args.proofAgeDays >= 2) return "weak_stale";
  if (args.wins7d <= 2 && args.proofAgeDays != null && args.proofAgeDays <= 1) return "weak_recent";
  if (args.wins7d >= 1) return "some_recent";
  return "none";
}

function buildTruthSummary(args: {
  wins7d: number;
  proofAgeDays: number | null;
  praiseLevel: DailyProofPraiseAllowedLevel;
  yesStreak14d: number;
  misses7d: number;
  partials7d: number;
}): { summary: string; staleWarning: string | null } {
  const age =
    args.proofAgeDays != null && Number.isFinite(args.proofAgeDays)
      ? `${args.proofAgeDays} local day(s) ago`
      : "unknown recency";
  let staleWarning: string | null = null;

  if (args.praiseLevel === "none") {
    return {
      summary:
        "No wins recorded in the last 7 days. Do not praise proof, consistency, or commitment. Hold the standard and ask for one honest rep today.",
      staleWarning: null,
    };
  }

  if (args.praiseLevel === "capability_only") {
    staleWarning = `Only ${args.wins7d} win(s) in the last 7 days; last proof was ${age}.`;
    return {
      summary: `${staleWarning} Do not praise consistency or great commitment. You may say the user has shown they can do it, but the current job is one honest win today.`,
      staleWarning,
    };
  }

  if (args.praiseLevel === "specific_recent_proof") {
    return {
      summary: `${args.wins7d} win(s) in 7d with recent proof (${age}). Acknowledge that specific rep only — do not imply consistency or a streak.`,
      staleWarning: null,
    };
  }

  if (args.praiseLevel === "measured_progress") {
    return {
      summary: `${args.wins7d} wins in 7d with fresh proof (${age}). Measured progress praise is allowed; do not exaggerate into domination or habit language.`,
      staleWarning: null,
    };
  }

  if (args.praiseLevel === "consistency") {
    return {
      summary: `Multiple recent wins (${args.wins7d} in 7d; proof ${age}). Consistency language is allowed if tied to actual behavior — not generic hype.`,
      staleWarning: null,
    };
  }

  return {
    summary: `Strong streak signal (${args.wins7d} wins in 7d; yes_streak_14d ${args.yesStreak14d}). Streak-true praise is allowed when specific.`,
    staleWarning: null,
  };
}

export function deriveDailyProofCalibration(
  args: DeriveDailyProofCalibrationArgs
): DailyProofCalibration {
  const { accountability: a, thread_memory: tm } = args.facts;
  const memory7d = tm.relationship_memory_7d;
  const counts = wins7dFromMemory(memory7d);
  const wins7d = counts.wins;
  const misses7d = counts.misses;
  const partials7d = counts.partials;
  const yesStreak14d = a.yes_streak_14d ?? 0;
  const no14 = a.no_count_14d ?? 0;
  const partial14 = a.partial_count_14d ?? 0;
  const missesPartials14d = no14 + partial14;

  const lastYes = resolveLastUserYes(memory7d, a.prior_outcome, a.days_since_last_user_outcome);
  const proofAgeDays = lastYes.proofAgeDays;

  const recentProofStrength = deriveRecentProofStrength({
    wins7d,
    proofAgeDays,
    yesStreak14d,
  });

  let praise_allowed_level: DailyProofPraiseAllowedLevel = "none";
  let consistency_claim_allowed = false;
  let strong_commitment_claim_allowed = false;
  let recent_completion_claim_allowed = false;

  if (yesStreak14d >= 5 || (wins7d >= 5 && proofAgeDays != null && proofAgeDays <= 1)) {
    praise_allowed_level = "streak";
    consistency_claim_allowed = true;
    strong_commitment_claim_allowed = true;
    recent_completion_claim_allowed = proofAgeDays != null && proofAgeDays <= 1;
  } else if (wins7d <= 0) {
    praise_allowed_level = "none";
  } else if (wins7d <= 2 && proofAgeDays != null && proofAgeDays >= 2) {
    praise_allowed_level = "capability_only";
  } else if (wins7d >= 1 && wins7d <= 2 && proofAgeDays != null && proofAgeDays <= 1) {
    praise_allowed_level = "specific_recent_proof";
    recent_completion_claim_allowed = true;
  } else if (wins7d >= 3 && proofAgeDays != null && proofAgeDays <= 1) {
    praise_allowed_level = "measured_progress";
    recent_completion_claim_allowed = true;
    if (yesStreak14d >= 3) {
      consistency_claim_allowed = true;
      praise_allowed_level = "consistency";
    }
  } else if (wins7d >= 3) {
    praise_allowed_level = "capability_only";
  } else {
    praise_allowed_level = "capability_only";
  }

  const { summary, staleWarning } = buildTruthSummary({
    wins7d,
    proofAgeDays,
    praiseLevel: praise_allowed_level,
    yesStreak14d,
    misses7d,
    partials7d,
  });

  return {
    wins_7d: wins7d,
    misses_7d: misses7d,
    partials_7d: partials7d,
    misses_partials_14d: missesPartials14d,
    yes_streak_14d: yesStreak14d,
    last_user_yes_at: lastYes.at,
    last_user_yes_local_day: lastYes.localDay,
    proof_age_days: proofAgeDays,
    recent_proof_strength: recentProofStrength,
    praise_allowed_level,
    consistency_claim_allowed,
    strong_commitment_claim_allowed,
    recent_completion_claim_allowed,
    stale_proof_warning: staleWarning,
    truth_summary_for_writer: summary,
  };
}

export function dailyProofCalibrationTelemetry(
  cal: DailyProofCalibration
): Record<string, unknown> {
  return {
    daily_proof_wins_7d: cal.wins_7d,
    daily_proof_misses_7d: cal.misses_7d,
    daily_proof_partials_7d: cal.partials_7d,
    daily_proof_last_user_yes_age_days: cal.proof_age_days,
    daily_proof_recent_strength: cal.recent_proof_strength,
    daily_praise_allowed_level: cal.praise_allowed_level,
    daily_consistency_claim_allowed: cal.consistency_claim_allowed,
    daily_strong_commitment_claim_allowed: cal.strong_commitment_claim_allowed,
    daily_stale_proof_warning: cal.stale_proof_warning,
  };
}

export function buildDailyProofCalibrationPromptBlock(cal: DailyProofCalibration): string {
  return [
    "",
    "DAILY PROOF CALIBRATION — authoritative server truth (beats coaching summaries and old memory):",
    `- wins_7d: ${cal.wins_7d}; misses_7d: ${cal.misses_7d}; partials_7d: ${cal.partials_7d}`,
    `- proof_age_days: ${cal.proof_age_days ?? "unknown"}`,
    `- praise_allowed_level: ${cal.praise_allowed_level}`,
    `- consistency_claim_allowed: ${cal.consistency_claim_allowed}`,
    `- strong_commitment_claim_allowed: ${cal.strong_commitment_claim_allowed}`,
    ...(cal.stale_proof_warning ? [`- stale_proof_warning: ${cal.stale_proof_warning}`] : []),
    `- truth_summary: ${cal.truth_summary_for_writer}`,
    "- Do not turn old or weak proof into consistency praise.",
    "- If consistency_claim_allowed is false, do not write great commitment, strong commitment, consistent, on a roll, dominating, kept showing up, or recently completed unless proof_age_days <= 1 and wording is precise.",
    "- Exact recent thread + this calibration beat summaries and coaching_memory_snippet.",
  ].join("\n");
}
