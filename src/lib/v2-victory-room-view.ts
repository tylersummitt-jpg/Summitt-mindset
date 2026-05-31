/**
 * Victory Room (V1): read-only view model from existing tables only.
 *
 * Source of truth (do not let projection override spine):
 * - `user_profiles`: canonical identity (`preferred_name`, `identity_anchor_text`)
 * - `v2_commitment`: canonical active commitment + inputs to the effective ask
 * - `v2_commitment_event`: canonical proof moments (append-only spine)
 * - `v2_commitment_coaching_memory`: optional projection only (via loadV2CoachingMemoryForPrompt)
 *
 * Lifetime archive (`archiveMoments`): same spine-backed moment shapes, derived from up to
 * `ARCHIVE_EVENT_LIMIT` newest events for the active commitment, curated and capped (`VICTORY_ARCHIVE_MAX_ITEMS`);
 * excludes rows already shown in recent `moments`.
 *
 * Earlier seasons (`priorChapters`): read-only chapters from prior `v2_commitment` rows (canonical list)
 * + per-commitment `v2_commitment_event` proof (canonical). No cross-commitment stitching.
 *
 * Cornerstone moments (`cornerstoneMoments`): max 3 high-salience rows chosen by fixed rules from the union of
 * recent `moments`, `archiveMoments`, and prior chapter moments only — no raw events, no AI.
 */

import { supabaseServer } from "@/lib/supabase-server";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { isQuotableIdentitySource } from "@/lib/v2-identity-anchor";

/** Default Victory Room page load: newest spine rows for the active commitment. */
export const ACTIVE_EVENT_FETCH_LIMIT = 400;

/**
 * Max events used for proof-moment + evidence derivation (matches fetch cap).
 * Display caps (e.g. RECENT_PROOF_DISPLAY_LIMIT) may show fewer cards than derived moments.
 */
export const PROOF_DERIVATION_EVENT_LIMIT = ACTIVE_EVENT_FETCH_LIMIT;

/** Max recent proof cards on the Victory Room page. */
export const RECENT_PROOF_DISPLAY_LIMIT = 5;

/** Max proof cards on a lazy season detail page. */
export const SEASON_PROOF_DISPLAY_LIMIT = 20;

/**
 * Legacy archive path cap (prior chapters / full archive). Not used on default page load.
 */
const ARCHIVE_EVENT_LIMIT = 2500;

/** Max items shown in the Lifetime proof section (curated, capped). */
export const VICTORY_ARCHIVE_MAX_ITEMS = 18;

/** Max standalone `user_yes` moments in the archive after time-spread sampling. */
const ARCHIVE_MAX_STANDALONE_YES = 6;

/** Max `user_yes` after reactivation entry sampled for archive comeback rows. */
const ARCHIVE_MAX_REACTIVATION_YES = 4;

/** Max prior commitments surfaced as chapters (excluding active). */
const PRIOR_CHAPTER_LIMIT = 3;

/** Max curated proof rows per prior chapter (smaller than lifetime archive on active). */
const CHAPTER_ARCHIVE_MAX_ITEMS = 6;
const CHAPTER_MAX_STANDALONE_YES = 3;
const CHAPTER_MAX_REACTIVATION_YES = 2;

/** Prior chapter statuses: calm, terminal-ish; excludes `paused` and `proposed` as ambiguous / not a season. */
const PRIOR_CHAPTER_STATUSES = ["completed", "abandoned", "superseded"] as const;

export type VictoryRoomProfileIdentity = {
  preferred_name: string | null;
  identity_anchor_text: string | null;
};

export type VictoryMoment = {
  id: string;
  occurredAt: string;
  headline: string;
  /** Legacy display surface — equals meaning when quote/meaning split is present. */
  body: string;
  /** Verbatim user reply when available (never invented). */
  quote?: string | null;
  /** One short meaning line beneath the quote. */
  meaning?: string | null;
  /** Spine event types this moment is explicitly grounded in. */
  groundedInEventTypes: string[];
};

export type VictoryChapterRecord = {
  /**
   * Commitment activation time if available (`v2_commitment.started_at`), otherwise earliest spine event date.
   * Null when both are missing or invalid.
   */
  openedAt: string | null;
  /** Earliest proof moment date across the derived proof pools (recent/archive/cornerstone). */
  firstProofAt: string | null;
  /** Latest proof moment date across the derived proof pools (recent/archive/cornerstone). */
  latestProofAt: string | null;
  /**
   * Presence-only, human-facing proof forms (no counts; no internal enums).
   * Max 5 labels.
   */
  proofCategoryLabels: string[];
  /** Soft signal only; derived from priorChapters.length. */
  earlierSeasonCount: number;
};

type RecentProofCategory =
  | "came_back"
  | "told_the_truth"
  | "adjusted_wisely"
  | "raised_the_bar"
  | "finished_a_chapter"
  | "showed_up"
  | "kept_the_thread_alive";

export type VictoryRoomActiveSeason = {
  season_name: string;
  started_at: string;
};

export type VictoryPastSeason = {
  season_name: string;
  started_at: string;
  ended_at: string | null;
  status: string;
};

export type VictoryEvidenceCounts = {
  keptTheGoal: number;
  toldTheTruth: number;
  gotBackOnTrack: number;
  adjustedWisely: number;
  raisedTheBar: number;
  seasonsCompleted: number;
};

export const EMPTY_VICTORY_EVIDENCE_COUNTS: VictoryEvidenceCounts = {
  keptTheGoal: 0,
  toldTheTruth: 0,
  gotBackOnTrack: 0,
  adjustedWisely: 0,
  raisedTheBar: 0,
  seasonsCompleted: 0,
};

export type VictoryRoomViewData = {
  hasActiveV2Commitment: boolean;
  profile: VictoryRoomProfileIdentity;
  commitment: { id: string; title: string; behavior_statement: string | null } | null;
  activeSeason: VictoryRoomActiveSeason | null;
  effectiveCoachingAsk: string | null;
  chapterRecord: VictoryChapterRecord;
  moments: VictoryMoment[];
  comebackLines: string[];
  /** True when commitment is active but visible proof is still thin (day-zero / early chapter). */
  isDayZeroUser: boolean;
  hasSparseProof: boolean;
  evidenceCounts: VictoryEvidenceCounts;
  pastSeasons: VictoryPastSeason[];
  /**
   * Optional single line from coaching memory (user-authored blocker preview only).
   * Not primary proof; omitted if unavailable.
   */
  optionalMemoryProjectionLine: string | null;
  /**
   * Curated proof across the active commitment timeline (same spine rules as recent, wider window).
   * Excludes ids already shown in `moments` to reduce repetition.
   */
  archiveMoments: VictoryMoment[];
  /**
   * Prior commitment seasons (canonical `v2_commitment` rows + spine-backed moments per chapter).
   * Empty when user has no qualifying prior rows.
   */
  priorChapters: VictoryPriorChapterView[];
  /**
   * Up to 3 rule-ranked `VictoryMoment` rows from the union of recent, archive, and prior-chapter pools.
   * Empty when nothing qualifies.
   */
  cornerstoneMoments: VictoryMoment[];
};

export type VictoryPriorChapterView = {
  commitmentId: string;
  chapterTitle: string;
  rangeLabel: string;
  statusLabel: string;
  moments: VictoryMoment[];
};

type EventRow = {
  id: string;
  event_type: string;
  occurred_at: string;
  payload_json: Record<string, unknown>;
};

function truncateOneLine(s: string, max: number): string {
  const x = s.trim().replace(/\s+/g, " ");
  if (x.length <= max) return x;
  return `${x.slice(0, max - 1)}…`;
}

function earliestIsoFromEventRows(eventRowsFull: EventRow[]): string | null {
  let bestMs = Number.POSITIVE_INFINITY;
  let bestIso: string | null = null;
  for (const r of eventRowsFull) {
    const t = new Date(r.occurred_at).getTime();
    if (!Number.isFinite(t)) continue;
    if (t < bestMs) {
      bestMs = t;
      bestIso = r.occurred_at;
    }
  }
  return bestIso;
}

function dedupeMomentsById(moments: VictoryMoment[]): VictoryMoment[] {
  const seen = new Set<string>();
  const out: VictoryMoment[] = [];
  for (const m of moments) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

function minMaxProofIso(moments: VictoryMoment[]): { firstProofAt: string | null; latestProofAt: string | null } {
  let minMs = Number.POSITIVE_INFINITY;
  let maxMs = 0;
  let minIso: string | null = null;
  let maxIso: string | null = null;
  for (const m of moments) {
    const t = new Date(m.occurredAt).getTime();
    if (!Number.isFinite(t)) continue;
    if (t < minMs) {
      minMs = t;
      minIso = m.occurredAt;
    }
    if (t > maxMs) {
      maxMs = t;
      maxIso = m.occurredAt;
    }
  }
  return { firstProofAt: minIso, latestProofAt: maxIso };
}

export function buildChapterRecord(args: {
  commitmentStartedAt: string | null;
  eventRowsFull: EventRow[];
  moments: VictoryMoment[];
  archiveMoments: VictoryMoment[];
  cornerstoneMoments: VictoryMoment[];
  earlierSeasonCount: number;
}): VictoryChapterRecord {
  const openedAt =
    args.commitmentStartedAt?.trim() ||
    earliestIsoFromEventRows(args.eventRowsFull) ||
    null;

  const allProofMoments = dedupeMomentsById([
    ...args.moments,
    ...args.archiveMoments,
    ...args.cornerstoneMoments,
  ]);

  const { firstProofAt, latestProofAt } = minMaxProofIso(allProofMoments);

  // Presence-only: pick up to 5 distinct proof forms, highest-meaning first.
  const winnerByCategory = new Map<RecentProofCategory, VictoryMoment>();
  for (const m of allProofMoments) {
    const cat = inferRecentProofCategory(m);
    const prev = winnerByCategory.get(cat);
    if (!prev || occurredMs(m) > occurredMs(prev)) {
      winnerByCategory.set(cat, m);
    }
  }
  const labels = [...winnerByCategory.entries()]
    .map(([cat, moment]) => ({
      cat,
      label: getRecentProofCategoryLabel(moment),
      priority: getRecentProofCategoryPriority(cat),
      t: occurredMs(moment),
    }))
    .sort((a, b) => {
      const dp = b.priority - a.priority;
      if (dp !== 0) return dp;
      return b.t - a.t;
    })
    .map((x) => x.label)
    .filter((x, i, arr) => arr.indexOf(x) === i)
    .slice(0, 5);

  return {
    openedAt: openedAt && Number.isFinite(new Date(openedAt).getTime()) ? openedAt : null,
    firstProofAt,
    latestProofAt,
    proofCategoryLabels: labels,
    earlierSeasonCount: Math.max(0, args.earlierSeasonCount || 0),
  };
}

export function normalizeMomentText(input: string): string {
  return input.trim().replace(/\s+/g, " ").toLowerCase();
}

export function getRecentProofDedupeKey(moment: VictoryMoment): string {
  return `${normalizeMomentText(moment.headline)}||${normalizeMomentText(moment.body)}`;
}

export function inferRecentProofCategory(moment: VictoryMoment): RecentProofCategory {
  const id = moment.id;
  if (id.startsWith("composite:reactivation_yes:")) return "came_back";
  if (id.startsWith("composite:honesty:")) return "told_the_truth";
  if (id.startsWith("composite:decline_activate:")) return "adjusted_wisely";
  if (id.startsWith("merged:w12_2_tighten_display:")) return "adjusted_wisely";

  const h = moment.headline.trim();
  if (h === "Comeback") return "came_back";
  if (h === "Honesty") return "told_the_truth";
  if (h === "Named the blocker") return "told_the_truth";
  if (h === "Honest miss") return "told_the_truth";
  if (h === "Bar adjusted") return "raised_the_bar";
  if (
    h === "Honest adjustment" ||
    h === "Clean recommitment" ||
    h === "Alignment" ||
    h === "Coaching context updated"
  ) {
    return "adjusted_wisely";
  }
  if (h === "New chapter") return "finished_a_chapter";
  if (h === "Kept your word" || h === "Proof in the thread") return "showed_up";
  if (h === "Stayed engaged") return "kept_the_thread_alive";
  return "showed_up";
}

export function getRecentProofCategoryPriority(category: RecentProofCategory): number {
  switch (category) {
    case "came_back":
      return 600;
    case "told_the_truth":
      return 500;
    case "adjusted_wisely":
      return 400;
    case "raised_the_bar":
      return 350;
    case "finished_a_chapter":
      return 300;
    case "showed_up":
      return 200;
    case "kept_the_thread_alive":
      return 100;
  }
}

export function getRecentProofCategoryLabel(moment: VictoryMoment): string {
  const cat = inferRecentProofCategory(moment);
  switch (cat) {
    case "came_back":
      return "Got back on track";
    case "told_the_truth":
      return "Told the truth";
    case "adjusted_wisely":
      return "Adjusted wisely";
    case "raised_the_bar":
      return "Raised the bar";
    case "finished_a_chapter":
      return "Named the next goal";
    case "showed_up":
    case "kept_the_thread_alive":
      return "Kept the goal";
    default:
      return "Proof";
  }
}

/** Proof timestamp for sort/display — same `occurredAt` shown on Victory Room cards (`formatVictoryRoomDate`). */
export function victoryMomentProofTimeMs(m: VictoryMoment): number {
  const t = new Date(m.occurredAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Newest-first; tie-break on moment id for deterministic order. */
export function compareVictoryMomentsByProofTimeDesc(a: VictoryMoment, b: VictoryMoment): number {
  const dt = victoryMomentProofTimeMs(b) - victoryMomentProofTimeMs(a);
  if (dt !== 0) return dt;
  return b.id.localeCompare(a.id);
}

function occurredMs(m: VictoryMoment): number {
  return victoryMomentProofTimeMs(m);
}

export function curateRecentProofMoments(
  moments: VictoryMoment[],
  max: number = RECENT_PROOF_DISPLAY_LIMIT
): VictoryMoment[] {
  const input = [...moments]; // do not mutate caller array
  if (input.length === 0 || max <= 0) return [];

  // 1) Exact dedupe by (normalized headline + body); keep the most recent duplicate.
  const byKey = new Map<string, VictoryMoment>();
  for (const m of input) {
    const key = getRecentProofDedupeKey(m);
    const prev = byKey.get(key);
    if (!prev || occurredMs(m) > occurredMs(prev)) {
      byKey.set(key, m);
    }
  }
  const deduped = [...byKey.values()];
  if (deduped.length === 0) return [];

  // 2) Newest winner per category.
  const winnerByCategory = new Map<RecentProofCategory, VictoryMoment>();
  for (const m of deduped) {
    const cat = inferRecentProofCategory(m);
    const prev = winnerByCategory.get(cat);
    if (!prev || occurredMs(m) > occurredMs(prev)) {
      winnerByCategory.set(cat, m);
    }
  }

  // 3) Newest-first among category winners (matches card date); take up to max.
  const winners = [...winnerByCategory.values()];

  winners.sort(compareVictoryMomentsByProofTimeDesc);

  const selected = winners.slice(0, max);

  // 4) Safety: never return empty if there were candidates.
  if (selected.length === 0) {
    const newest = [...deduped].sort(compareVictoryMomentsByProofTimeDesc)[0];
    return newest ? [newest] : [];
  }

  return selected;
}

function parsePayload(row: EventRow): Record<string, unknown> {
  const p = row.payload_json;
  return p && typeof p === "object" && !Array.isArray(p) ? p : {};
}

function overlayActivatedCopy(contractKind: unknown): { headline: string; body: string } {
  if (contractKind === "shrink_ask") {
    return {
      headline: "Honest adjustment",
      body: "You tightened the bar with wisdom instead of disappearing.",
    };
  }
  if (contractKind === "recommit_same") {
    return {
      headline: "Clean recommitment",
      body: "You recommitted honestly — same bar, renewed choice.",
    };
  }
  return {
    headline: "Contract clarified",
    body: "You said yes to a clearer coaching agreement.",
  };
}

function proofBackedBody(payload: Record<string, unknown>, fallback: string): string {
  if (typeof payload.proof_meaning_line === "string" && payload.proof_meaning_line.trim()) {
    return truncateOneLine(String(payload.proof_meaning_line), 220);
  }
  if (
    payload.proof_moment === true &&
    typeof payload.user_visible_proof_line === "string" &&
    payload.user_visible_proof_line.trim()
  ) {
    return truncateOneLine(String(payload.user_visible_proof_line), 220);
  }
  return fallback;
}

const VISUAL_TEST_PREFIX = /^\[visual test\]\s*/i;
const WRAP_QUOTES_RE = /^[\s"'""''«»]+|[\s"'""''«»]+$/g;

/** Display-only: strip test scaffolding prefix from proof copy (does not mutate DB). */
export function sanitizeProofDisplayText(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, " ");
  if (!collapsed) return collapsed;
  return collapsed.replace(VISUAL_TEST_PREFIX, "").trim();
}

/** Normalize quote vs meaning for duplicate detection (not for display). */
export function normalizeProofTextForComparison(text: string): string {
  let s = text.trim().toLowerCase();
  s = s.replace(WRAP_QUOTES_RE, "");
  s = s.replace(VISUAL_TEST_PREFIX, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/\.+$/, "");
  return s;
}

function proofTextsAreDuplicate(quote: string, meaning: string): boolean {
  const q = normalizeProofTextForComparison(quote);
  const m = normalizeProofTextForComparison(meaning);
  if (!q || !m) return false;
  return q === m;
}

/** Category/event deterministic meaning when quote would duplicate meaning or meaning is missing. */
export function deterministicMeaningForProofDisplay(args: {
  groundedInEventTypes: string[];
  headline: string;
  proofMomentType?: string | null;
  momentId?: string;
}): string {
  const pt = args.proofMomentType?.trim() ?? "";
  const types = args.groundedInEventTypes;
  const h = args.headline.trim();
  const id = args.momentId?.trim() ?? "";

  if (
    id.startsWith("composite:reactivation_yes:") ||
    h === "Comeback" ||
    pt === "comeback_after_miss"
  ) {
    return "You came back after the miss.";
  }
  if (
    id.startsWith("composite:honesty:") ||
    (h === "Honesty" && (types.includes("user_no") || types.includes("user_partial")))
  ) {
    return "You told the truth instead of disappearing.";
  }
  if (types.includes("user_no") || h === "Honest miss" || pt === "honest_miss") {
    return "You told the truth instead of disappearing.";
  }
  if (
    types.includes("user_partial") ||
    h === "Stayed engaged" ||
    pt === "partial_but_stayed_engaged"
  ) {
    return "You stayed honest and adjusted wisely.";
  }
  if (types.includes("blocker_captured") || pt === "blocker_named") {
    return "You stayed honest and adjusted wisely.";
  }
  if (h === "New chapter" || pt === "commitment_replaced") {
    return "You named the next honest commitment.";
  }
  if (
    h === "Bar adjusted" ||
    h === "Honest adjustment" ||
    pt === "commitment_tightened" ||
    id.startsWith("merged:w12_2_tighten_display:")
  ) {
    return "You stayed honest and adjusted wisely.";
  }
  if (types.includes("user_yes") || h === "Kept your word" || h === "Proof in the thread") {
    return "You followed through when it counted.";
  }
  if (pt === "meaningful_streak" || pt === "streak_continued" || pt === "followed_through") {
    return "You followed through when it counted.";
  }
  if (pt === "first_completion") {
    return "You followed through when it counted.";
  }
  return "You gave the check-in something honest to work with.";
}

function finalizeVictoryMomentProofDisplay(args: {
  quote: string | null;
  meaning: string;
  groundedInEventTypes: string[];
  headline: string;
  proofMomentType?: string | null;
  momentId?: string;
}): Pick<VictoryMoment, "quote" | "meaning" | "body"> {
  const quoteOut = args.quote ? sanitizeProofDisplayText(args.quote) : null;
  let meaningOut = sanitizeProofDisplayText(args.meaning);

  if (quoteOut) {
    if (!meaningOut.trim() || proofTextsAreDuplicate(quoteOut, meaningOut)) {
      meaningOut = deterministicMeaningForProofDisplay({
        groundedInEventTypes: args.groundedInEventTypes,
        headline: args.headline,
        proofMomentType: args.proofMomentType,
        momentId: args.momentId,
      });
    }
  }

  return {
    quote: quoteOut,
    meaning: meaningOut,
    body: meaningOut,
  };
}

function extractProofQuoteFromPayload(payload: Record<string, unknown>): string | null {
  if (typeof payload.proof_quote === "string" && payload.proof_quote.trim()) {
    return truncateOneLine(String(payload.proof_quote), 220);
  }
  if (typeof payload.message === "string" && payload.message.trim()) {
    return truncateOneLine(String(payload.message), 220);
  }
  if (typeof payload.message_preview === "string" && payload.message_preview.trim()) {
    return truncateOneLine(String(payload.message_preview), 220);
  }
  return null;
}

function hasPersistedProofLine(payload: Record<string, unknown>): boolean {
  if (payload.proof_moment !== true) return false;
  if (typeof payload.proof_meaning_line === "string" && payload.proof_meaning_line.trim()) return true;
  if (typeof payload.user_visible_proof_line === "string" && payload.user_visible_proof_line.trim()) return true;
  return false;
}

function victoryMomentDisplayFromPayload(
  payload: Record<string, unknown>,
  fallbackMeaning: string,
  displayContext: {
    groundedInEventTypes: string[];
    headline: string;
    momentId?: string;
  }
): Pick<VictoryMoment, "quote" | "meaning" | "body"> {
  const quote = extractProofQuoteFromPayload(payload);
  const meaning = proofBackedBody(payload, fallbackMeaning);
  const proofMomentType =
    typeof payload.proof_moment_type === "string" ? payload.proof_moment_type : null;
  return finalizeVictoryMomentProofDisplay({
    quote,
    meaning,
    groundedInEventTypes: displayContext.groundedInEventTypes,
    headline: displayContext.headline,
    proofMomentType,
    momentId: displayContext.momentId,
  });
}

function withMeaningOnly(body: string): Pick<VictoryMoment, "quote" | "meaning" | "body"> {
  const meaning = sanitizeProofDisplayText(body);
  return { quote: null, meaning, body: meaning };
}

/** Wave 12.2 — display-only: pair shrink_ask overlay + supplemental tighten proof within this window. */
const TIGHTEN_OVERLAY_SMS_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const MERGED_TIGHTEN_DISPLAY_ID_PREFIX = "merged:w12_2_tighten_display:";

function isShrinkAskOverlayRow(row: EventRow): boolean {
  if (row.event_type !== "contract_overlay_activated") return false;
  return parsePayload(row).contract_kind === "shrink_ask";
}

function isWave12CommitmentTightenProofRow(row: EventRow): boolean {
  if (row.event_type !== "sms_memory_signal") return false;
  const payload = parsePayload(row);
  const ms = payload.memory_signal;
  const msObj =
    ms && typeof ms === "object" && !Array.isArray(ms) ? (ms as Record<string, unknown>) : null;
  if (msObj?.wave12_commitment_change_proof !== true) return false;
  return payload.proof_moment_type === "commitment_tightened";
}

function overlayIdFromMergedW122TightenDisplayId(momentId: string): string | null {
  if (!momentId.startsWith(MERGED_TIGHTEN_DISPLAY_ID_PREFIX)) return null;
  const rest = momentId.slice(MERGED_TIGHTEN_DISPLAY_ID_PREFIX.length);
  const i = rest.indexOf(":");
  if (i <= 0) return null;
  return rest.slice(0, i);
}

/**
 * Victory Room display only: one card for shrink_ask overlay + Wave 12.1 tighten proof when paired in time.
 * Keeps both spine rows; prefers proof-backed body from the sms row; headline "Honest adjustment".
 */
function dedupeTightenOverlayDisplayMoments(eventRows: EventRow[], moments: VictoryMoment[]): VictoryMoment[] {
  const overlays = eventRows.filter(isShrinkAskOverlayRow);
  const tightenSms = eventRows.filter(isWave12CommitmentTightenProofRow);
  if (overlays.length === 0 || tightenSms.length === 0) return moments;

  const pairedOverlay = new Set<string>();
  const pairedSms = new Set<string>();
  const merged: VictoryMoment[] = [];

  const byTime = (a: EventRow, b: EventRow) =>
    new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime();
  const sortedOverlays = [...overlays].sort(byTime);
  const sortedSms = [...tightenSms].sort(byTime);

  for (const o of sortedOverlays) {
    if (pairedOverlay.has(o.id)) continue;
    const t0 = new Date(o.occurred_at).getTime();
    if (!Number.isFinite(t0)) continue;
    let best: EventRow | null = null;
    let bestDt = TIGHTEN_OVERLAY_SMS_DEDUPE_WINDOW_MS + 1;
    for (const s of sortedSms) {
      if (pairedSms.has(s.id)) continue;
      const t1 = new Date(s.occurred_at).getTime();
      if (!Number.isFinite(t1)) continue;
      const dt = Math.abs(t1 - t0);
      if (dt <= TIGHTEN_OVERLAY_SMS_DEDUPE_WINDOW_MS && dt < bestDt) {
        best = s;
        bestDt = dt;
      }
    }
    if (!best) continue;
    pairedOverlay.add(o.id);
    pairedSms.add(best.id);
    const smsPayload = parsePayload(best);
    const display = victoryMomentDisplayFromPayload(smsPayload, overlayActivatedCopy("shrink_ask").body, {
      groundedInEventTypes: ["contract_overlay_activated", "sms_memory_signal"],
      headline: "Honest adjustment",
      momentId: `${MERGED_TIGHTEN_DISPLAY_ID_PREFIX}${o.id}:${best.id}`,
    });
    const tOverlay = new Date(o.occurred_at).getTime();
    const tSms = new Date(best.occurred_at).getTime();
    const occurredAt =
      Number.isFinite(tOverlay) && Number.isFinite(tSms)
        ? new Date(Math.max(tOverlay, tSms)).toISOString()
        : o.occurred_at;
    merged.push({
      id: `${MERGED_TIGHTEN_DISPLAY_ID_PREFIX}${o.id}:${best.id}`,
      occurredAt,
      headline: "Honest adjustment",
      body: display.body,
      quote: display.quote,
      meaning: display.meaning,
      groundedInEventTypes: ["contract_overlay_activated", "sms_memory_signal"],
    });
  }

  if (merged.length === 0) return moments;
  const suppress = new Set<string>();
  for (const o of overlays) {
    if (pairedOverlay.has(o.id)) suppress.add(o.id);
  }
  for (const s of tightenSms) {
    if (pairedSms.has(s.id)) suppress.add(s.id);
  }
  const kept = moments.filter((m) => !suppress.has(m.id));
  return dedupeMomentsById([...kept, ...merged]);
}

function buildSingleEventMoments(rows: EventRow[]): VictoryMoment[] {
  const out: VictoryMoment[] = [];
  for (const row of rows) {
    const payload = parsePayload(row);
    if (row.event_type === "user_yes") {
      const headline = payload.proof_moment === true ? "Proof in the thread" : "Kept your word";
      const display = victoryMomentDisplayFromPayload(payload, "You followed through when it counted.", {
        groundedInEventTypes: ["user_yes"],
        headline,
        momentId: row.id,
      });
      out.push({
        id: row.id,
        occurredAt: row.occurred_at,
        headline,
        ...display,
        groundedInEventTypes: ["user_yes"],
      });
      continue;
    }
    if (row.event_type === "user_no" || row.event_type === "user_partial") {
      if (hasPersistedProofLine(payload)) {
        const headline = row.event_type === "user_no" ? "Honest miss" : "Stayed engaged";
        const fallback =
          row.event_type === "user_no"
            ? "You told the truth about the miss — that matters."
            : "You stayed in the conversation instead of disappearing.";
        const display = victoryMomentDisplayFromPayload(payload, fallback, {
          groundedInEventTypes: [row.event_type],
          headline,
          momentId: row.id,
        });
        out.push({
          id: row.id,
          occurredAt: row.occurred_at,
          headline,
          ...display,
          groundedInEventTypes: [row.event_type],
        });
      }
      continue;
    }
    if (row.event_type === "sms_memory_signal") {
      if (
        payload.season_lifecycle === true ||
        payload.exclude_from_proof_curation === true
      ) {
        continue;
      }
      const ms = payload.memory_signal;
      const msObj =
        ms && typeof ms === "object" && !Array.isArray(ms) ? (ms as Record<string, unknown>) : null;
      const wave12CommitProof = msObj?.wave12_commitment_change_proof === true;
      const proofTy = typeof payload.proof_moment_type === "string" ? payload.proof_moment_type : "";

      if (
        payload.wave11_memory_resolution === true &&
        hasPersistedProofLine(payload)
      ) {
        const headline = "Coaching context updated";
        const display = victoryMomentDisplayFromPayload(
          payload,
          "You gave the check-in something honest to work with.",
          { groundedInEventTypes: ["sms_memory_signal"], headline, momentId: row.id }
        );
        out.push({
          id: row.id,
          occurredAt: row.occurred_at,
          headline,
          ...display,
          groundedInEventTypes: ["sms_memory_signal"],
        });
      } else if (wave12CommitProof && hasPersistedProofLine(payload)) {
        const headline = proofTy === "commitment_replaced" ? "New chapter" : "Bar adjusted";
        const fallback =
          proofTy === "commitment_replaced"
            ? "You named the next honest commitment."
            : "You adjusted the bar with honesty instead of quitting.";
        const display = victoryMomentDisplayFromPayload(payload, fallback, {
          groundedInEventTypes: ["sms_memory_signal"],
          headline,
          momentId: row.id,
        });
        out.push({
          id: row.id,
          occurredAt: row.occurred_at,
          headline,
          ...display,
          groundedInEventTypes: ["sms_memory_signal"],
        });
      }
      continue;
    }
    if (row.event_type === "contract_overlay_activated") {
      const { headline, body } = overlayActivatedCopy(payload.contract_kind);
      out.push({
        id: row.id,
        occurredAt: row.occurred_at,
        headline,
        ...withMeaningOnly(body),
        groundedInEventTypes: ["contract_overlay_activated"],
      });
      continue;
    }
    if (row.event_type === "blocker_captured") {
      if (hasPersistedProofLine(payload)) {
        const headline = "Honesty";
        const display = victoryMomentDisplayFromPayload(
          payload,
          "You named what got in the way so we can work it.",
          { groundedInEventTypes: ["blocker_captured"], headline, momentId: row.id }
        );
        out.push({
          id: row.id,
          occurredAt: row.occurred_at,
          headline,
          ...display,
          groundedInEventTypes: ["blocker_captured"],
        });
      }
      continue;
    }
    if (row.event_type === "coaching_refresh_resolved") {
      const resolution = typeof payload.resolution === "string" ? payload.resolution : "";
      if (resolution === "still" || resolution === "keep") {
        out.push({
          id: row.id,
          occurredAt: row.occurred_at,
          headline: "Alignment",
          ...withMeaningOnly("You clarified what still fits."),
          groundedInEventTypes: ["coaching_refresh_resolved"],
        });
      }
    }
  }
  return out;
}

/** Newest first */
function sortDesc(a: EventRow, b: EventRow): number {
  return new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
}

/** Oldest first */
function sortAsc(a: EventRow, b: EventRow): number {
  return new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime();
}

function findHonestyComebackMoment(rowsAsc: EventRow[]): VictoryMoment | null {
  let lastPair: { yes: EventRow; prior: EventRow } | null = null;
  for (let i = 0; i < rowsAsc.length; i++) {
    const ev = rowsAsc[i];
    if (ev.event_type !== "user_yes") continue;
    for (let j = i - 1; j >= 0; j--) {
      const prev = rowsAsc[j];
      if (prev.event_type === "user_no" || prev.event_type === "user_partial") {
        lastPair = { yes: ev, prior: prev };
        break;
      }
      if (prev.event_type === "user_yes") break;
    }
  }
  if (!lastPair) return null;
  return {
    id: `composite:honesty:${lastPair.yes.id}`,
    occurredAt: lastPair.yes.occurred_at,
    headline: "Honesty",
    body: "You got honest and stayed in it.",
    groundedInEventTypes: [lastPair.prior.event_type, "user_yes"],
  };
}

function findDeclineThenActivateMoment(rowsAsc: EventRow[]): VictoryMoment | null {
  let last: VictoryMoment | null = null;
  for (let i = 0; i < rowsAsc.length; i++) {
    if (rowsAsc[i].event_type !== "contract_overlay_declined") continue;
    for (let j = i + 1; j < rowsAsc.length; j++) {
      if (rowsAsc[j].event_type === "contract_overlay_activated") {
        last = {
          id: `composite:decline_activate:${rowsAsc[j].id}`,
          occurredAt: rowsAsc[j].occurred_at,
          headline: "Stayed in it",
          body: "You pushed back on one option, then said yes to a cleaner next step instead of quitting.",
          groundedInEventTypes: ["contract_overlay_declined", "contract_overlay_activated"],
        };
        break;
      }
    }
  }
  return last;
}

function findReactivationYesMoment(
  rowsAsc: EventRow[],
  reactivationEnteredAt: string | null
): VictoryMoment | null {
  if (!reactivationEnteredAt?.trim()) return null;
  const t0 = new Date(reactivationEnteredAt).getTime();
  if (!Number.isFinite(t0)) return null;
  for (const ev of rowsAsc) {
    if (ev.event_type !== "user_yes") continue;
    const t = new Date(ev.occurred_at).getTime();
    if (Number.isFinite(t) && t > t0) {
      return {
        id: `composite:reactivation_yes:${ev.id}`,
        occurredAt: ev.occurred_at,
        headline: "Comeback",
        body: "You came back here.",
        groundedInEventTypes: ["user_yes"],
      };
    }
  }
  return null;
}

/** All honesty episodes (each `user_yes` that follows a prior `user_no` / `user_partial` without crossing another yes). */
function findAllHonestyMoments(rowsAsc: EventRow[]): VictoryMoment[] {
  const out: VictoryMoment[] = [];
  for (let i = 0; i < rowsAsc.length; i++) {
    const ev = rowsAsc[i];
    if (ev.event_type !== "user_yes") continue;
    for (let j = i - 1; j >= 0; j--) {
      const prev = rowsAsc[j];
      if (prev.event_type === "user_no" || prev.event_type === "user_partial") {
        out.push({
          id: `composite:honesty:${ev.id}`,
          occurredAt: ev.occurred_at,
          headline: "Honesty",
          body: "You got honest and stayed in it.",
          groundedInEventTypes: [prev.event_type, "user_yes"],
        });
        break;
      }
      if (prev.event_type === "user_yes") break;
    }
  }
  return out;
}

/** Each decline followed by a later activate (episode per activated event id). */
function findAllDeclineActivateMoments(rowsAsc: EventRow[]): VictoryMoment[] {
  const usedActivated = new Set<string>();
  const out: VictoryMoment[] = [];
  for (let i = 0; i < rowsAsc.length; i++) {
    if (rowsAsc[i].event_type !== "contract_overlay_declined") continue;
    for (let j = i + 1; j < rowsAsc.length; j++) {
      if (rowsAsc[j].event_type !== "contract_overlay_activated") continue;
      const act = rowsAsc[j];
      if (usedActivated.has(act.id)) break;
      usedActivated.add(act.id);
      out.push({
        id: `composite:decline_activate:${act.id}`,
        occurredAt: act.occurred_at,
        headline: "Stayed in it",
        body: "You pushed back on one option, then said yes to a cleaner next step instead of quitting.",
        groundedInEventTypes: ["contract_overlay_declined", "contract_overlay_activated"],
      });
      break;
    }
  }
  return out;
}

/** Evenly sample rows across their timeline (oldest → newest order in `rows`). */
function sampleEventRowsEvenly(rows: EventRow[], max: number): EventRow[] {
  if (rows.length === 0 || max <= 0) return [];
  const sorted = [...rows].sort(
    (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );
  if (sorted.length <= max) return sorted;
  const out: EventRow[] = [];
  for (let k = 0; k < max; k++) {
    const idx = Math.round((k * (sorted.length - 1)) / Math.max(max - 1, 1));
    out.push(sorted[idx]);
  }
  const seen = new Set<string>();
  return out.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

function findReactivationYesMomentsArchived(
  rowsAsc: EventRow[],
  reactivationEnteredAt: string | null,
  max: number
): VictoryMoment[] {
  if (!reactivationEnteredAt?.trim()) return [];
  const t0 = new Date(reactivationEnteredAt).getTime();
  if (!Number.isFinite(t0)) return [];
  const yeses = rowsAsc.filter((ev) => {
    if (ev.event_type !== "user_yes") return false;
    const t = new Date(ev.occurred_at).getTime();
    return Number.isFinite(t) && t > t0;
  });
  const sampled = sampleEventRowsEvenly(yeses, max);
  return sampled.map((ev) => ({
    id: `composite:reactivation_yes:${ev.id}`,
    occurredAt: ev.occurred_at,
    headline: "Comeback",
    body: "You came back here.",
    groundedInEventTypes: ["user_yes"],
  }));
}

/**
 * Lifetime archive: same grounded types as recent proof, wider event window, time-sampled yes rows,
 * excludes operational noise (`check_sent`, etc. — never passed through moment builders).
 */
type ArchiveCuratorOptions = {
  maxResults?: number;
  maxStandaloneYes?: number;
  maxReactivationYes?: number;
};

/**
 * Curated archive moments for one commitment's event window.
 * `recentMomentIds`: exclude these ids (e.g. recent proof on active commitment); use empty set for prior chapters.
 */
function buildArchiveMomentsFromEvents(
  eventRowsFull: EventRow[],
  reactivationEnteredAt: string | null,
  recentMomentIds: Set<string>,
  opts?: ArchiveCuratorOptions
): VictoryMoment[] {
  if (eventRowsFull.length === 0) return [];

  const maxResults = opts?.maxResults ?? VICTORY_ARCHIVE_MAX_ITEMS;
  const maxStandaloneYes = opts?.maxStandaloneYes ?? ARCHIVE_MAX_STANDALONE_YES;
  const maxReactivationYes = opts?.maxReactivationYes ?? ARCHIVE_MAX_REACTIVATION_YES;

  const rowsAsc = [...eventRowsFull].sort(sortAsc);
  const rowsDesc = [...eventRowsFull].sort(sortDesc);

  const honestyAll = findAllHonestyMoments(rowsAsc);
  const declineAll = findAllDeclineActivateMoments(rowsAsc);
  const declineActivatedIds = new Set(
    declineAll.map((m) => m.id.replace("composite:decline_activate:", ""))
  );

  const reactArchived = findReactivationYesMomentsArchived(
    rowsAsc,
    reactivationEnteredAt,
    maxReactivationYes
  );

  const excludeYesIds = new Set<string>();
  for (const h of honestyAll) {
    if (h.id.startsWith("composite:honesty:")) {
      excludeYesIds.add(h.id.slice("composite:honesty:".length));
    }
  }
  for (const r of reactArchived) {
    if (r.id.startsWith("composite:reactivation_yes:")) {
      excludeYesIds.add(r.id.slice("composite:reactivation_yes:".length));
    }
  }

  const overlayRefresh = dedupeTightenOverlayDisplayMoments(eventRowsFull, buildSingleEventMoments(rowsDesc)).filter(
    (m) => {
      const t0 = m.groundedInEventTypes[0];
      if (t0 === "user_yes") return false;
      if (t0 === "contract_overlay_activated" && declineActivatedIds.has(m.id)) return false;
      const emb = overlayIdFromMergedW122TightenDisplayId(m.id);
      if (emb && declineActivatedIds.has(emb)) return false;
      return true;
    }
  );

  const yesCandidates = rowsAsc.filter((r) => r.event_type === "user_yes" && !excludeYesIds.has(r.id));
  const yesSampled = sampleEventRowsEvenly(yesCandidates, maxStandaloneYes);
  const yesMoments: VictoryMoment[] = yesSampled.map((row) => {
    const headline = "Kept your word";
    const display = victoryMomentDisplayFromPayload(
      parsePayload(row),
      "You followed through when it counted.",
      { groundedInEventTypes: ["user_yes"], headline, momentId: row.id }
    );
    return {
      id: row.id,
      occurredAt: row.occurred_at,
      headline,
      ...display,
      groundedInEventTypes: ["user_yes"],
    };
  });

  const merged = dedupeMomentsById([
    ...honestyAll,
    ...declineAll,
    ...reactArchived,
    ...overlayRefresh,
    ...yesMoments,
  ]);

  const notRecent = merged.filter((m) => !recentMomentIds.has(m.id));
  const sorted = [...notRecent].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );
  return sorted.slice(0, maxResults);
}

export function mapVictoryCommitmentEventRows(rows: unknown): EventRow[] {
  return (rows as Record<string, unknown>[])
    .filter(
      (r) =>
        typeof r.id === "string" && typeof r.event_type === "string" && typeof r.occurred_at === "string"
    )
    .map((r) => ({
      id: String(r.id),
      event_type: String(r.event_type),
      occurred_at: String(r.occurred_at),
      payload_json:
        r.payload_json != null && typeof r.payload_json === "object" && !Array.isArray(r.payload_json)
          ? (r.payload_json as Record<string, unknown>)
          : {},
    }));
}

function statusToChapterLabel(status: string): string {
  if (status === "completed") return "Completed";
  if (status === "abandoned") return "Ended";
  if (status === "superseded") return "Superseded";
  return status;
}

function formatChapterRangeLabel(
  startedAt: string | null,
  endedAt: string | null,
  updatedAt: string | null
): string {
  const start = startedAt?.trim();
  if (!start) return "Dates unavailable";
  const startFmt = formatVictoryRoomDate(start, undefined);
  const end = endedAt?.trim();
  if (end) {
    return `${startFmt} — ${formatVictoryRoomDate(end, undefined)}`;
  }
  const upd = updatedAt?.trim();
  if (upd) {
    return `Started ${startFmt} · last activity ${formatVictoryRoomDate(upd, undefined)}`;
  }
  return `Started ${startFmt}`;
}

function chapterTitleFromRow(row: Record<string, unknown>): string {
  const t = typeof row.title === "string" ? row.title.trim() : "";
  if (t) return truncateOneLine(t, 120);
  const b = typeof row.behavior_statement === "string" ? row.behavior_statement.trim() : "";
  if (b) return truncateOneLine(b, 100);
  return "Earlier commitment";
}

function parseReactivationFromPriorRow(row: Record<string, unknown>): string | null {
  const v = row.reactivation_entered_at;
  return v != null && typeof v === "string" && v.trim() ? v : null;
}

async function fetchEventRowsForCommitment(commitmentId: string): Promise<EventRow[]> {
  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("id, event_type, occurred_at, payload_json")
    .eq("commitment_id", commitmentId)
    .order("occurred_at", { ascending: false })
    .limit(ARCHIVE_EVENT_LIMIT);

  if (error) {
    console.error("[v2-victory-room] prior chapter events load failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
    return [];
  }
  return mapVictoryCommitmentEventRows(data ?? []);
}

/**
 * Prior `v2_commitment` chapters only (status in `PRIOR_CHAPTER_STATUSES`), newest first, capped.
 */
async function loadPriorChaptersView(
  clerkUserId: string,
  activeCommitmentId: string
): Promise<VictoryPriorChapterView[]> {
  const { data, error } = await supabaseServer
    .from("v2_commitment")
    .select("id, title, behavior_statement, status, started_at, ended_at, updated_at, reactivation_entered_at")
    .eq("clerk_user_id", clerkUserId)
    .neq("id", activeCommitmentId)
    .in("status", [...PRIOR_CHAPTER_STATUSES])
    .order("started_at", { ascending: false })
    .limit(PRIOR_CHAPTER_LIMIT);

  if (error) {
    console.error("[v2-victory-room] prior commitments load failed", {
      clerk_user_id: clerkUserId,
      message: error.message,
    });
    return [];
  }

  const rows = (data ?? []) as Record<string, unknown>[];
  const chapters: VictoryPriorChapterView[] = [];

  for (const row of rows) {
    if (typeof row.id !== "string") continue;
    const commitmentId = row.id;
    const eventRows = await fetchEventRowsForCommitment(commitmentId);
    const reAt = parseReactivationFromPriorRow(row);
    const moments = buildArchiveMomentsFromEvents(eventRows, reAt, new Set(), {
      maxResults: CHAPTER_ARCHIVE_MAX_ITEMS,
      maxStandaloneYes: CHAPTER_MAX_STANDALONE_YES,
      maxReactivationYes: CHAPTER_MAX_REACTIVATION_YES,
    });
    const startedAt = typeof row.started_at === "string" ? row.started_at : null;
    const endedAt = typeof row.ended_at === "string" ? row.ended_at : null;
    const updatedAt = typeof row.updated_at === "string" ? row.updated_at : null;
    chapters.push({
      commitmentId,
      chapterTitle: chapterTitleFromRow(row),
      rangeLabel: formatChapterRangeLabel(startedAt, endedAt, updatedAt),
      statusLabel: statusToChapterLabel(typeof row.status === "string" ? row.status : ""),
      moments,
    });
  }

  return chapters;
}

/**
 * Prefer variety: cap standalone `user_yes` spine rows (not composites) at 2 (most recent).
 * Overall cap 5 moments.
 */
function capMoments(moments: VictoryMoment[]): VictoryMoment[] {
  const sorted = [...moments].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );
  const out: VictoryMoment[] = [];
  let yesSpineCount = 0;
  for (const m of sorted) {
    if (out.length >= 5) break;
    const isStandaloneYes =
      m.groundedInEventTypes.length === 1 && m.groundedInEventTypes[0] === "user_yes" && !m.id.startsWith("composite:");
    if (isStandaloneYes) {
      yesSpineCount += 1;
      if (yesSpineCount > 2) continue;
    }
    out.push(m);
  }
  return out.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

function buildComebackLines(args: {
  rowsAsc: EventRow[];
  reactivationEnteredAt: string | null;
  honesty: VictoryMoment | null;
  declineActivate: VictoryMoment | null;
  reactivationYes: VictoryMoment | null;
}): string[] {
  const lines: string[] = [];
  if (args.reactivationYes) {
    lines.push("You came back after a quieter stretch and stayed in the conversation.");
  }
  if (args.honesty) {
    lines.push("You told the truth on a hard day and kept answering.");
  }
  if (args.declineActivate) {
    lines.push("You pushed back once, then chose a cleaner yes instead of quitting.");
  }
  return lines;
}

/** Max cornerstone rows (hard cap). */
const CORNERSTONE_MAX = 3;

/** Prefer picks at least this far apart in time when the pool allows (ms). */
const CORNERSTONE_MIN_GAP_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Deterministic salience score for cornerstone ranking. Only types we already surface as `VictoryMoment`.
 * Higher = more cornerstone-worthy.
 */
function cornerstoneScore(m: VictoryMoment): number {
  if (m.id.startsWith("composite:decline_activate:")) return 100;
  if (m.headline === "Honest adjustment") return 95;
  if (m.headline === "Clean recommitment") return 90;
  if (m.groundedInEventTypes.includes("contract_overlay_activated")) return 88;
  if (m.id.startsWith("composite:reactivation_yes:")) return 85;
  if (m.groundedInEventTypes.includes("coaching_refresh_resolved")) return 80;
  if (m.headline === "Honesty" || m.id.startsWith("composite:honesty:")) return 75;
  if (
    m.groundedInEventTypes.length === 1 &&
    m.groundedInEventTypes[0] === "user_yes" &&
    !m.id.startsWith("composite:")
  ) {
    return 30;
  }
  return 0;
}

function isStandaloneYesMoment(m: VictoryMoment): boolean {
  return (
    m.groundedInEventTypes.length === 1 &&
    m.groundedInEventTypes[0] === "user_yes" &&
    !m.id.startsWith("composite:")
  );
}

function isHonestyCornerstone(m: VictoryMoment): boolean {
  return m.headline === "Honesty" || m.id.startsWith("composite:honesty:");
}

// occurredMs is defined above (used for recent curation + cornerstone selection).

/**
 * Union of recent, archive, and prior-chapter moments; deduped; max 3 picks; rule-ranked; time-spread when possible.
 * Exported for tests — same logic powers `cornerstoneMoments` on the view.
 */
export function selectCornerstoneMoments(args: {
  moments: VictoryMoment[];
  archiveMoments: VictoryMoment[];
  priorChapters: VictoryPriorChapterView[];
}): VictoryMoment[] {
  const pool = dedupeMomentsById([
    ...args.moments,
    ...args.archiveMoments,
    ...args.priorChapters.flatMap((ch) => ch.moments),
  ]);

  const candidates = pool.filter((m) => cornerstoneScore(m) > 0);
  if (candidates.length === 0) return [];

  const sorted = [...candidates].sort((a, b) => {
    const ds = cornerstoneScore(b) - cornerstoneScore(a);
    if (ds !== 0) return ds;
    return occurredMs(b) - occurredMs(a);
  });

  const picked: VictoryMoment[] = [];
  const used = new Set<string>();

  const canAdd = (c: VictoryMoment, requireGap: boolean, allowSecondHonesty: boolean): boolean => {
    if (used.has(c.id)) return false;
    if (isStandaloneYesMoment(c) && picked.filter(isStandaloneYesMoment).length >= 1) return false;
    if (isHonestyCornerstone(c)) {
      const h = picked.filter(isHonestyCornerstone).length;
      if (h >= 1 && !allowSecondHonesty) return false;
      if (h >= 2) return false;
    }
    if (requireGap && picked.some((p) => Math.abs(occurredMs(c) - occurredMs(p)) < CORNERSTONE_MIN_GAP_MS)) {
      return false;
    }
    return true;
  };

  for (const c of sorted) {
    if (picked.length >= CORNERSTONE_MAX) break;
    if (canAdd(c, true, false)) {
      picked.push(c);
      used.add(c.id);
    }
  }
  for (const c of sorted) {
    if (picked.length >= CORNERSTONE_MAX) break;
    if (canAdd(c, false, false)) {
      picked.push(c);
      used.add(c.id);
    }
  }
  for (const c of sorted) {
    if (picked.length >= CORNERSTONE_MAX) break;
    if (canAdd(c, false, true)) {
      picked.push(c);
      used.add(c.id);
    }
  }

  return [...picked].sort((a, b) => {
    const ds = cornerstoneScore(b) - cornerstoneScore(a);
    if (ds !== 0) return ds;
    return occurredMs(b) - occurredMs(a);
  });
}

/**
 * Build merged proof moments from the bounded active-commitment event window (up to 400 rows).
 */
export function deriveMergedProofMomentsFromEventWindow(args: {
  eventRowsFull: EventRow[];
  reactivationEnteredAt: string | null;
}): { merged: VictoryMoment[]; comebackLines: string[] } {
  const eventRowsRecent = args.eventRowsFull.slice(0, PROOF_DERIVATION_EVENT_LIMIT);
  const rowsAsc = [...eventRowsRecent].sort(sortAsc);
  const rowsDesc = [...eventRowsRecent].sort(sortDesc);

  const honestyMoment = findHonestyComebackMoment(rowsAsc);
  const declineActivateMoment = findDeclineThenActivateMoment(rowsAsc);
  const reactivationYesMoment = findReactivationYesMoment(rowsAsc, args.reactivationEnteredAt);

  const singlesRaw = buildSingleEventMoments(rowsDesc);
  const singlesDeduped = dedupeTightenOverlayDisplayMoments(eventRowsRecent, singlesRaw);
  const excludeEventIds = new Set<string>();
  if (honestyMoment?.id.startsWith("composite:honesty:")) {
    excludeEventIds.add(honestyMoment.id.slice("composite:honesty:".length));
  }
  if (reactivationYesMoment?.id.startsWith("composite:reactivation_yes:")) {
    excludeEventIds.add(reactivationYesMoment.id.slice("composite:reactivation_yes:".length));
  }
  if (declineActivateMoment?.id.startsWith("composite:decline_activate:")) {
    excludeEventIds.add(declineActivateMoment.id.slice("composite:decline_activate:".length));
  }
  const singles = singlesDeduped.filter((m) => {
    if (excludeEventIds.has(m.id)) return false;
    const emb = overlayIdFromMergedW122TightenDisplayId(m.id);
    if (emb && excludeEventIds.has(emb)) return false;
    return true;
  });

  const merged = dedupeMomentsById([
    ...singles,
    ...(honestyMoment ? [honestyMoment] : []),
    ...(declineActivateMoment ? [declineActivateMoment] : []),
    ...(reactivationYesMoment ? [reactivationYesMoment] : []),
  ]);

  const comebackLines = buildComebackLines({
    rowsAsc,
    reactivationEnteredAt: args.reactivationEnteredAt,
    honesty: honestyMoment,
    declineActivate: declineActivateMoment,
    reactivationYes: reactivationYesMoment,
  }).filter((line, i, arr) => arr.indexOf(line) === i);

  return { merged, comebackLines };
}

/** Count proof forms from derived moments (bounded active-commitment window, up to 400 events). */
export function buildVictoryEvidenceCounts(
  mergedMoments: VictoryMoment[],
  seasonsCompleted: number
): VictoryEvidenceCounts {
  const counts: VictoryEvidenceCounts = {
    ...EMPTY_VICTORY_EVIDENCE_COUNTS,
    seasonsCompleted: Math.max(0, seasonsCompleted),
  };

  for (const m of mergedMoments) {
    const cat = inferRecentProofCategory(m);
    switch (cat) {
      case "showed_up":
      case "kept_the_thread_alive":
        counts.keptTheGoal += 1;
        break;
      case "told_the_truth":
        counts.toldTheTruth += 1;
        break;
      case "came_back":
        counts.gotBackOnTrack += 1;
        break;
      case "adjusted_wisely":
        counts.adjustedWisely += 1;
        break;
      case "raised_the_bar":
        counts.raisedTheBar += 1;
        break;
      case "finished_a_chapter":
        break;
      default:
        break;
    }
  }

  return counts;
}

export function computeHasSparseProof(args: {
  moments: VictoryMoment[];
  comebackLines: string[];
}): boolean {
  return args.moments.length === 0 && args.comebackLines.length === 0;
}

async function loadPastAccountabilitySeasons(clerkUserId: string): Promise<{
  pastSeasons: VictoryPastSeason[];
  seasonsCompleted: number;
}> {
  const { data: pastRows, error: pastErr } = await supabaseServer
    .from("user_accountability_season")
    .select("season_name, started_at, ended_at, status")
    .eq("clerk_user_id", clerkUserId)
    .in("status", ["completed", "archived"])
    .order("started_at", { ascending: false })
    .limit(5);

  if (pastErr) {
    console.error("[v2-victory-room] past seasons load failed", {
      clerk_user_id: clerkUserId,
      message: pastErr.message,
    });
    return { pastSeasons: [], seasonsCompleted: 0 };
  }

  const pastSeasons: VictoryPastSeason[] = (pastRows ?? [])
    .filter((r) => typeof r.season_name === "string" && r.season_name.trim())
    .map((r) => ({
      season_name: String(r.season_name).trim(),
      started_at: String(r.started_at),
      ended_at: r.ended_at != null ? String(r.ended_at) : null,
      status: typeof r.status === "string" ? r.status : "",
    }));

  const { count, error: countErr } = await supabaseServer
    .from("user_accountability_season")
    .select("id", { count: "exact", head: true })
    .eq("clerk_user_id", clerkUserId)
    .in("status", ["completed", "archived"]);

  if (countErr) {
    console.error("[v2-victory-room] seasons completed count failed", {
      clerk_user_id: clerkUserId,
      message: countErr.message,
    });
  }

  return {
    pastSeasons,
    seasonsCompleted: typeof count === "number" ? count : pastSeasons.length,
  };
}

export async function loadVictoryRoomView(
  clerkUserId: string
): Promise<VictoryRoomViewData> {
  const { data: prof, error: profErr } = await supabaseServer
    .from("user_profiles")
    .select("preferred_name, identity_anchor_text, identity_source")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (profErr) {
    console.error("[v2-victory-room] profile load failed", { clerk_user_id: clerkUserId, message: profErr.message });
  }

  const anchorRaw =
    typeof prof?.identity_anchor_text === "string" ? prof.identity_anchor_text.trim() : null;
  const idSrc = typeof prof?.identity_source === "string" ? prof.identity_source.trim() : null;
  const profile: VictoryRoomProfileIdentity = {
    preferred_name: typeof prof?.preferred_name === "string" ? prof.preferred_name : null,
    identity_anchor_text:
      anchorRaw && anchorRaw.length > 0 && isQuotableIdentitySource(idSrc) ? anchorRaw : null,
  };

  const commitment = await getActiveCommitment(clerkUserId);

  let activeSeason: VictoryRoomActiveSeason | null = null;
  if (commitment?.id) {
    const { data: seasonRow, error: seasonErr } = await supabaseServer
      .from("user_accountability_season")
      .select("season_name, started_at")
      .eq("clerk_user_id", clerkUserId)
      .eq("status", "active")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (seasonErr) {
      console.error("[v2-victory-room] active season load failed", {
        clerk_user_id: clerkUserId,
        message: seasonErr.message,
      });
    } else if (seasonRow?.season_name) {
      activeSeason = {
        season_name: seasonRow.season_name,
        started_at: seasonRow.started_at,
      };
    }
  }

  if (!commitment) {
    return {
      hasActiveV2Commitment: false,
      profile,
      commitment: null,
      activeSeason: null,
      effectiveCoachingAsk: null,
      chapterRecord: {
        openedAt: null,
        firstProofAt: null,
        latestProofAt: null,
        proofCategoryLabels: [],
        earlierSeasonCount: 0,
      },
      moments: [],
      comebackLines: [],
      isDayZeroUser: false,
      hasSparseProof: false,
      evidenceCounts: { ...EMPTY_VICTORY_EVIDENCE_COUNTS, seasonsCompleted: 0 },
      pastSeasons: [],
      optionalMemoryProjectionLine: null,
      archiveMoments: [],
      priorChapters: [],
      cornerstoneMoments: [],
    };
  }

  const { pastSeasons, seasonsCompleted } = await loadPastAccountabilitySeasons(clerkUserId);

  const { data: events, error: evErr } = await supabaseServer
    .from("v2_commitment_event")
    .select("id, event_type, occurred_at, payload_json")
    .eq("commitment_id", commitment.id)
    .order("occurred_at", { ascending: false })
    .limit(ACTIVE_EVENT_FETCH_LIMIT);

  if (evErr) {
    console.error("[v2-victory-room] events load failed", {
      commitment_id: commitment.id,
      message: evErr.message,
    });
  }

  const eventRowsFull: EventRow[] = mapVictoryCommitmentEventRows(events ?? []);

  const { merged, comebackLines } = deriveMergedProofMomentsFromEventWindow({
    eventRowsFull,
    reactivationEnteredAt: commitment.reactivation_entered_at,
  });

  const moments = curateRecentProofMoments(merged, RECENT_PROOF_DISPLAY_LIMIT);
  const evidenceCounts = buildVictoryEvidenceCounts(merged, seasonsCompleted);
  const hasSparseProof = computeHasSparseProof({ moments, comebackLines });
  const isDayZeroUser = hasSparseProof;

  const chapterRecord = buildChapterRecord({
    commitmentStartedAt: commitment.started_at,
    eventRowsFull,
    moments,
    archiveMoments: [],
    cornerstoneMoments: [],
    earlierSeasonCount: pastSeasons.length,
  });

  return {
    hasActiveV2Commitment: true,
    profile,
    commitment: {
      id: commitment.id,
      title: commitment.title,
      behavior_statement: commitment.behavior_statement,
    },
    activeSeason,
    effectiveCoachingAsk: getEffectiveCoachingAsk(commitment, Date.now()),
    chapterRecord,
    moments,
    comebackLines,
    isDayZeroUser,
    hasSparseProof,
    evidenceCounts,
    pastSeasons,
    optionalMemoryProjectionLine: null,
    archiveMoments: [],
    priorChapters: [],
    cornerstoneMoments: [],
  };
}

export function formatVictoryRoomDate(iso: string, timeZone: string | undefined): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: timeZone && timeZone.trim() ? timeZone : "UTC",
    }).format(t);
  } catch {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
      t
    );
  }
}
