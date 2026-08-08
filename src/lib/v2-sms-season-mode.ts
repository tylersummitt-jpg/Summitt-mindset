/**
 * Season-mode helpers for SMS/app/guided saved Current Goal replacement.
 *
 * Product law: saved Current Goal change always starts a new season (new_chapter).
 * Legacy `same_season_sync` remains parseable for backwards-compatible payloads only.
 */

export type SmsSeasonMode = "same_season_sync" | "new_chapter";

export type DeriveSeasonModeResult = {
  mode: SmsSeasonMode;
  reason: string;
};

export function isSmsSeasonMode(value: unknown): value is SmsSeasonMode {
  return value === "same_season_sync" || value === "new_chapter";
}

/**
 * Saved Current Goal replacement always opens a new season.
 * Heuristics that formerly chose same_season_sync are retired.
 */
export function deriveSeasonModeForSmsGoalChange(_args?: {
  rawBody?: string;
  candidateBar?: string | null;
  currentBehaviorStatement?: string | null;
}): DeriveSeasonModeResult {
  return { mode: "new_chapter", reason: "saved_goal_change_always_new_chapter" };
}

export type SeasonModePendingContext = {
  raw_user_text: string;
  season_mode?: SmsSeasonMode;
  candidate_behavior_statement?: string | null;
  candidate_new_bar?: string | null;
};

/**
 * Confirm-time season mode for pending replace.
 * Stored payload season_mode is ignored for mutation authority.
 */
export function resolveSeasonModeForPendingReplace(_args: {
  payload: SeasonModePendingContext;
  candidateBar: string;
  currentBehaviorStatement: string | null;
}): DeriveSeasonModeResult {
  return deriveSeasonModeForSmsGoalChange();
}

/**
 * Guided-resolution commitment save: always new chapter for saved bar replacement.
 */
export function resolveSeasonModeForGuidedCommitmentReplace(_args: {
  behaviorStatement: string;
  currentBehaviorStatement: string | null;
  pendingPayload: SeasonModePendingContext | null;
  refreshResolution?: "change" | "new" | "tighten" | null;
}): DeriveSeasonModeResult {
  return deriveSeasonModeForSmsGoalChange();
}
