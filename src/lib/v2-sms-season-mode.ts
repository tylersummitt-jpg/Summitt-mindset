/**
 * Deterministic season-mode selection for SMS goal-change pending (server-owned).
 * OpenAI is not authoritative for chapter vs same-drill decisions.
 */

export type SmsSeasonMode = "same_season_sync" | "new_chapter";

export type DeriveSeasonModeResult = {
  mode: SmsSeasonMode;
  reason: string;
};

/** Explicit chapter language — excludes ambiguous "start fresh" / "fresh start" alone. */
const EXPLICIT_NEW_CHAPTER_RE =
  /\b(new chapter|new season|start a new season|this season is over|that chapter is done|close this season)\b/i;

const SWITCH_FROM_TO_RE = /\bswitch from .+ to\b/i;

const DOMAIN_BUCKETS: readonly { id: string; re: RegExp }[] = [
  { id: "phone_discipline", re: /\b(phone|scroll|screen|device|tiktok|social media)\b/i },
  { id: "walking_health", re: /\b(walk|walking|steps|exercise|gym|run|workout)\b/i },
  { id: "bedtime_sleep", re: /\b(bed|bedtime|sleep|asleep|upstairs)\b/i },
  { id: "leadership_work", re: /\b(leadership|team|staff|work|meeting|boss)\b/i },
  { id: "faith_prayer", re: /\b(pray|prayer|bible|scripture|devotion|faith)\b/i },
  { id: "family_presence", re: /\b(family|kids|child|spouse|wife|husband|presence)\b/i },
];

function normalizeText(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function detectDomainBuckets(text: string): Set<string> {
  const out = new Set<string>();
  for (const b of DOMAIN_BUCKETS) {
    if (b.re.test(text)) out.add(b.id);
  }
  return out;
}

function domainsClearlyDifferent(current: string, candidate: string): boolean {
  const a = detectDomainBuckets(current);
  const b = detectDomainBuckets(candidate);
  if (a.size === 0 || b.size === 0) return false;
  for (const id of a) {
    if (b.has(id)) return false;
  }
  return true;
}

export function isSmsSeasonMode(value: unknown): value is SmsSeasonMode {
  return value === "same_season_sync" || value === "new_chapter";
}

export function deriveSeasonModeForSmsGoalChange(args: {
  rawBody: string;
  candidateBar?: string | null;
  currentBehaviorStatement?: string | null;
}): DeriveSeasonModeResult {
  const raw = (args.rawBody ?? "").trim();
  const candidate = (args.candidateBar ?? "").trim();
  const current = (args.currentBehaviorStatement ?? "").trim();

  if (EXPLICIT_NEW_CHAPTER_RE.test(raw)) {
    return { mode: "new_chapter", reason: "explicit_chapter_language" };
  }
  if (SWITCH_FROM_TO_RE.test(raw)) {
    return { mode: "new_chapter", reason: "switch_from_to" };
  }

  const combined = `${raw} ${candidate}`.trim();
  if (candidate && current && domainsClearlyDifferent(current, candidate)) {
    return { mode: "new_chapter", reason: "different_life_area_heuristic" };
  }
  if (candidate && domainsClearlyDifferent(current || raw, combined)) {
    return { mode: "new_chapter", reason: "different_life_area_heuristic" };
  }

  return { mode: "same_season_sync", reason: "default_same_drill" };
}

export type SeasonModePendingContext = {
  raw_user_text: string;
  season_mode?: SmsSeasonMode;
  candidate_behavior_statement?: string | null;
  candidate_new_bar?: string | null;
};

function storedCandidateBar(payload: SeasonModePendingContext): string {
  return (
    payload.candidate_behavior_statement?.trim() ||
    payload.candidate_new_bar?.trim() ||
    ""
  );
}

/**
 * Confirm-time season mode: always re-derive from final candidate + current bar.
 * Stored payload season_mode is a hint only — not authority when candidate or mode differs.
 */
export function resolveSeasonModeForPendingReplace(args: {
  payload: SeasonModePendingContext;
  candidateBar: string;
  currentBehaviorStatement: string | null;
}): DeriveSeasonModeResult {
  const derived = deriveSeasonModeForSmsGoalChange({
    rawBody: args.payload.raw_user_text,
    candidateBar: args.candidateBar,
    currentBehaviorStatement: args.currentBehaviorStatement,
  });

  const storedCandidate = storedCandidateBar(args.payload);
  const candidateChanged =
    storedCandidate.length > 0 &&
    normalizeText(storedCandidate) !== normalizeText(args.candidateBar);

  if (candidateChanged || !isSmsSeasonMode(args.payload.season_mode)) {
    return derived;
  }

  if (args.payload.season_mode !== derived.mode) {
    return derived;
  }

  return derived;
}

/**
 * Guided-resolution commitment save: deterministic season mode (no OpenAI).
 * Refresh NEW → new chapter; SMS/app pending uses resolveSeasonModeForPendingReplace when possible.
 */
export function resolveSeasonModeForGuidedCommitmentReplace(args: {
  behaviorStatement: string;
  currentBehaviorStatement: string | null;
  pendingPayload: SeasonModePendingContext | null;
  refreshResolution?: "change" | "new" | "tighten" | null;
}): DeriveSeasonModeResult {
  if (args.refreshResolution === "new") {
    return { mode: "new_chapter", reason: "coaching_refresh_new" };
  }

  if (args.pendingPayload) {
    return resolveSeasonModeForPendingReplace({
      payload: args.pendingPayload,
      candidateBar: args.behaviorStatement,
      currentBehaviorStatement: args.currentBehaviorStatement,
    });
  }

  return deriveSeasonModeForSmsGoalChange({
    rawBody: args.behaviorStatement,
    candidateBar: args.behaviorStatement,
    currentBehaviorStatement: args.currentBehaviorStatement,
  });
}
