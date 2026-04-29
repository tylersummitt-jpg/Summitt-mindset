import OpenAI from "openai";

import type { ActiveV2CommitmentRow, V2EventRowForAi } from "@/lib/v2-commitment";
import { identityAnchorLeakDetected } from "@/lib/v2-identity-anchor";
import {
  formatCoachingMemoryPromptBlock,
  type V2CoachingMemoryForPrompt,
} from "@/lib/v2-coaching-memory-prompt";
import type { V2OutboundTemplateFamily } from "@/lib/v2-sms-accountability";
import { formatRelationshipFitOutboundHints } from "@/lib/v2-sms-relationship-profile";

export const V2_OUTBOUND_AI_PROMPT_VERSION = "v2_outbound_v1";

/** House style: small fast model for bounded SMS copy. */
export const V2_OUTBOUND_AI_MODEL = "gpt-4o-mini";

const SMS_MAX_LEN = 300;
const SEVEN_D_MS = 7 * 24 * 60 * 60 * 1000;
const MS_DAY = 86400000;

/** Calendar-ish day delta from timestamps (fixed thresholds; no timezone engine in this PR). */
function wholeDaysBetween(fromMs: number, toMs: number): number {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return 0;
  return Math.floor((toMs - fromMs) / MS_DAY);
}

function eventTimeMs(iso: string): number {
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : 0;
}

function sortedEventsAsc(eventsNewestFirst: V2EventRowForAi[]): V2EventRowForAi[] {
  return [...eventsNewestFirst].sort(
    (a, b) => eventTimeMs(a.occurred_at) - eventTimeMs(b.occurred_at)
  );
}

const USER_OUTCOMES = new Set(["user_yes", "user_no", "user_partial"]);

export type V2SilenceTier = "none" | "quiet" | "nudge";

export type V2SilenceContext = {
  tier: V2SilenceTier;
  unanswered_checks: number;
  days_since_last_user_outcome: number;
};

export type V2ReentryContext = {
  active: boolean;
};

/**
 * Derived silence tier from recent V2 events (same spine as AI; typically newest-first input).
 * - quiet: 1–2 unanswered checks OR 4–9 days since last user outcome
 * - nudge: 3+ unanswered checks OR 10+ days since last user outcome
 */
export function deriveV2SilenceContext(
  eventsNewestFirst: V2EventRowForAi[],
  now: Date
): V2SilenceContext {
  const asc = sortedEventsAsc(eventsNewestFirst);
  const nowMs = now.getTime();

  let lastUserMs = 0;
  for (const e of asc) {
    if (USER_OUTCOMES.has(e.event_type)) {
      const t = eventTimeMs(e.occurred_at);
      if (t > lastUserMs) lastUserMs = t;
    }
  }

  let unanswered = 0;
  for (const e of asc) {
    if (e.event_type !== "check_sent") continue;
    const t = eventTimeMs(e.occurred_at);
    if (lastUserMs === 0 || t > lastUserMs) unanswered += 1;
  }

  const daysSinceUser =
    lastUserMs > 0 ? wholeDaysBetween(lastUserMs, nowMs) : unanswered > 0 ? 999 : 0;

  let tier: V2SilenceTier = "none";
  if (unanswered >= 3 || daysSinceUser >= 10) tier = "nudge";
  else if (unanswered >= 1 && unanswered <= 2) tier = "quiet";
  else if (daysSinceUser >= 4 && daysSinceUser < 10) tier = "quiet";

  return {
    tier,
    unanswered_checks: unanswered,
    days_since_last_user_outcome: lastUserMs > 0 ? daysSinceUser : unanswered > 0 ? 999 : 0,
  };
}

const REENTRY_MAX_HOURS_AFTER_REPLY = 72;
const REENTRY_MAX_CHECKS_AFTER_REPLY = 2;
const QUALIFY_MIN_CHECKS_BETWEEN_USER = 2;
const QUALIFY_MIN_GAP_DAYS = 7;
const QUALIFY_FIRST_USER_MIN_DAYS = 10;
const QUALIFY_FIRST_USER_MIN_CHECKS = 2;

/**
 * Short-lived re-entry: user recently replied after qualifying silence; at most 2 outbound
 * check_sent rows may use reentry_check (derived from events only).
 */
export function deriveV2ReentryContext(
  eventsNewestFirst: V2EventRowForAi[],
  now: Date
): V2ReentryContext {
  const asc = sortedEventsAsc(eventsNewestFirst);
  const nowMs = now.getTime();

  const userHits: { t: number }[] = [];
  for (const e of asc) {
    if (USER_OUTCOMES.has(e.event_type)) {
      userHits.push({ t: eventTimeMs(e.occurred_at) });
    }
  }
  if (userHits.length === 0) return { active: false };

  const tReply = userHits[userHits.length - 1]!.t;
  const hoursSinceReply = (nowMs - tReply) / (60 * 60 * 1000);
  if (hoursSinceReply > REENTRY_MAX_HOURS_AFTER_REPLY || hoursSinceReply < 0) {
    return { active: false };
  }

  let checksAfterReply = 0;
  for (const e of asc) {
    if (e.event_type === "check_sent" && eventTimeMs(e.occurred_at) > tReply) checksAfterReply += 1;
  }
  if (checksAfterReply >= REENTRY_MAX_CHECKS_AFTER_REPLY) return { active: false };

  const tPrev = userHits.length >= 2 ? userHits[userHits.length - 2]!.t : 0;

  let checksBetween = 0;
  for (const e of asc) {
    if (e.event_type !== "check_sent") continue;
    const t = eventTimeMs(e.occurred_at);
    if (tPrev > 0) {
      if (t > tPrev && t < tReply) checksBetween += 1;
    } else if (t < tReply) {
      checksBetween += 1;
    }
  }

  const gapDays =
    tPrev > 0 ? wholeDaysBetween(tPrev, tReply) : asc.length ? wholeDaysBetween(eventTimeMs(asc[0]!.occurred_at), tReply) : 0;

  let qualifying = false;
  if (tPrev > 0) {
    qualifying = checksBetween >= QUALIFY_MIN_CHECKS_BETWEEN_USER || gapDays >= QUALIFY_MIN_GAP_DAYS;
  } else {
    qualifying =
      checksBetween >= QUALIFY_FIRST_USER_MIN_CHECKS || gapDays >= QUALIFY_FIRST_USER_MIN_DAYS;
  }

  return { active: qualifying };
}

// --- Next move (rule-derived; orthogonal to outbound strategy) ---

export type V2NextMoveType = "hold_standard" | "recommit_same" | "shrink_ask" | "reset_day";

export type V2NextMoveDecision = {
  type: V2NextMoveType;
  reason_code: string;
  version: 1;
  shrunk_ask_text?: string;
};

const NEXT_MOVE_VERSION = 1 as const;

const SHRINK_BLOCKER_KEYWORDS = [
  "time",
  "overwhelmed",
  "overwhelm",
  "chaos",
  "kids",
  "travel",
  "sick",
  "slammed",
  "too much",
  "can't",
  "cant",
] as const;

/** Deterministic smaller ask tied to the same commitment (no DB mutation). */
export function computeShrunkAskText(behaviorStatement: string): string {
  const t = behaviorStatement.trim().replace(/\s+/g, " ");
  if (!t) return "Just for today—one honest step on the same commitment.";
  const cap = 72;
  const slice = t.length <= cap ? t : `${t.slice(0, cap - 1)}…`;
  return `Just for today—smaller window: ${slice}`;
}

function countUserOutcomesSince(
  asc: V2EventRowForAi[],
  nowMs: number,
  days: number,
  eventType: string
): number {
  const cutoff = nowMs - days * MS_DAY;
  let n = 0;
  for (const e of asc) {
    if (e.event_type !== eventType) continue;
    const te = eventTimeMs(e.occurred_at);
    if (te >= cutoff && te <= nowMs) n += 1;
  }
  return n;
}

function latestUserNoTimestamp(asc: V2EventRowForAi[]): number | null {
  let best: number | null = null;
  for (const e of asc) {
    if (e.event_type !== "user_no") continue;
    const t = eventTimeMs(e.occurred_at);
    if (best == null || t > best) best = t;
  }
  return best;
}

function hasBlockerCapturedAfter(asc: V2EventRowForAi[], afterMs: number): boolean {
  for (const e of asc) {
    if (e.event_type !== "blocker_captured") continue;
    if (eventTimeMs(e.occurred_at) > afterMs) return true;
  }
  return false;
}

function latestBlockerMessageLower(eventsNewestFirst: V2EventRowForAi[]): string | null {
  const b = eventsNewestFirst.find((e) => e.event_type === "blocker_captured");
  const raw = b?.payload_json && typeof (b.payload_json as { message?: unknown }).message === "string"
    ? String((b.payload_json as { message: string }).message)
    : null;
  return raw ? raw.toLowerCase() : null;
}

function latestBlockerHasShrinkKeyword(eventsNewestFirst: V2EventRowForAi[]): boolean {
  const m = latestBlockerMessageLower(eventsNewestFirst);
  if (!m) return false;
  return SHRINK_BLOCKER_KEYWORDS.some((k) => m.includes(k));
}

/** Latest user_yes | user_no | user_partial in timeline (newest first scan). */
function latestUserOutcomeType(eventsNewestFirst: V2EventRowForAi[]): string | null {
  const e = eventsNewestFirst.find((x) => USER_OUTCOMES.has(x.event_type));
  return e ? e.event_type : null;
}

function firstAccountabilitySignalType(eventsNewestFirst: V2EventRowForAi[]): string | null {
  const e = eventsNewestFirst.find((x) =>
    ["user_yes", "user_no", "user_partial", "blocker_captured"].includes(x.event_type)
  );
  return e ? e.event_type : null;
}

/**
 * Reads latest check_sent payload_json.next_move.type if present (for recommit_same triggers).
 */
export function parseLatestCheckSentNextMoveType(
  eventsNewestFirst: V2EventRowForAi[]
): V2NextMoveType | null {
  const cs = eventsNewestFirst.find((e) => e.event_type === "check_sent");
  const p = cs?.payload_json;
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const nm = (p as { next_move?: unknown }).next_move;
  if (!nm || typeof nm !== "object" || Array.isArray(nm)) return null;
  const t = (nm as { type?: unknown }).type;
  if (t === "hold_standard" || t === "recommit_same" || t === "shrink_ask" || t === "reset_day") {
    return t;
  }
  return null;
}

/**
 * Rule priority: reset_day → shrink_ask → recommit_same → hold_standard.
 */
export function deriveV2NextMove(args: {
  eventsNewestFirst: V2EventRowForAi[];
  now: Date;
  silence: V2SilenceContext;
  reentry: V2ReentryContext;
  behaviorStatement: string;
}): V2NextMoveDecision {
  const { eventsNewestFirst, now, silence, reentry } = args;
  const asc = sortedEventsAsc(eventsNewestFirst);
  const nowMs = now.getTime();

  const no14 = countUserOutcomesSince(asc, nowMs, 14, "user_no");
  const tLatestNo = latestUserNoTimestamp(asc);
  const noBlockerAfterLatestNo =
    tLatestNo != null ? !hasBlockerCapturedAfter(asc, tLatestNo) : false;
  const totalNoInWindow = asc.filter((e) => e.event_type === "user_no").length;

  const latestUserSig = latestUserOutcomeType(eventsNewestFirst);
  const firstSig = firstAccountabilitySignalType(eventsNewestFirst);

  if (no14 >= 3) {
    return { type: "reset_day", reason_code: "reset_three_no_14d", version: NEXT_MOVE_VERSION };
  }
  if (totalNoInWindow >= 2 && tLatestNo != null && noBlockerAfterLatestNo) {
    return {
      type: "reset_day",
      reason_code: "reset_two_plus_no_no_blocker_after_latest_no",
      version: NEXT_MOVE_VERSION,
    };
  }
  if (silence.tier === "nudge" && (latestUserSig === "user_no" || latestUserSig === "user_partial")) {
    return { type: "reset_day", reason_code: "reset_nudge_latest_miss", version: NEXT_MOVE_VERSION };
  }

  const no7 = countUserOutcomesSince(asc, nowMs, 7, "user_no");
  const partial7 = countUserOutcomesSince(asc, nowMs, 7, "user_partial");
  const shrunkBase = args.behaviorStatement.trim();

  if (no7 >= 2) {
    return {
      type: "shrink_ask",
      reason_code: "shrink_two_no_7d",
      version: NEXT_MOVE_VERSION,
      shrunk_ask_text: computeShrunkAskText(shrunkBase),
    };
  }
  if (partial7 >= 2) {
    return {
      type: "shrink_ask",
      reason_code: "shrink_partials_7d",
      version: NEXT_MOVE_VERSION,
      shrunk_ask_text: computeShrunkAskText(shrunkBase),
    };
  }
  if (latestBlockerHasShrinkKeyword(eventsNewestFirst)) {
    return {
      type: "shrink_ask",
      reason_code: "shrink_blocker_keywords",
      version: NEXT_MOVE_VERSION,
      shrunk_ask_text: computeShrunkAskText(shrunkBase),
    };
  }

  const prevNext = parseLatestCheckSentNextMoveType(eventsNewestFirst);
  if (
    latestUserSig === "user_yes" &&
    (reentry.active ||
      prevNext === "reset_day" ||
      prevNext === "shrink_ask" ||
      prevNext === "recommit_same")
  ) {
    return { type: "recommit_same", reason_code: "recommit_after_yes_post_move", version: NEXT_MOVE_VERSION };
  }
  if (firstSig === "blocker_captured" && !latestBlockerHasShrinkKeyword(eventsNewestFirst)) {
    return { type: "recommit_same", reason_code: "recommit_after_blocker", version: NEXT_MOVE_VERSION };
  }

  return { type: "hold_standard", reason_code: "hold_default", version: NEXT_MOVE_VERSION };
}

export type V2CoachingState =
  | "stable"
  | "slipping"
  | "blocked"
  | "rebuilding"
  | "recommitted";

export type V2OutboundStrategy =
  | "standard_check"
  | "recovery_check"
  | "blocker_followup"
  | "silence_nudge"
  | "reentry_check"
  | "reactivation_nudge";

export type V2AiOutboundAttempt =
  | {
      ok: true;
      message: string;
      confidence: number | null;
      fallbackUsed: false;
    }
  | { ok: false; fallbackUsed: true; reason: string };

function getOpenAIClientOrNull(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return null;
  return new OpenAI({ apiKey });
}

export function isV2AiOutboundEnabled(): boolean {
  return process.env.V2_AI_OUTBOUND_ENABLED === "true";
}

/**
 * Rule-based coaching state from recent V2 events (newest first).
 */
export function deriveV2CoachingState(eventsNewestFirst: V2EventRowForAi[]): V2CoachingState {
  const t = (iso: string) => new Date(iso).getTime();

  const firstSignal = eventsNewestFirst.find((e) =>
    ["user_yes", "user_no", "user_partial", "blocker_captured"].includes(e.event_type)
  );

  if (!firstSignal) return "stable";

  if (firstSignal.event_type === "blocker_captured") return "blocked";

  if (firstSignal.event_type === "user_partial") return "slipping";

  if (firstSignal.event_type === "user_no") {
    const tNo = t(firstSignal.occurred_at);
    const blockerAfter = eventsNewestFirst.some(
      (e) => e.event_type === "blocker_captured" && t(e.occurred_at) > tNo
    );
    return blockerAfter ? "blocked" : "rebuilding";
  }

  // Latest signal is user_yes
  const tYes = t(firstSignal.occurred_at);
  const missWithin7dBeforeYes = eventsNewestFirst.some((e) => {
    if (e.event_type !== "user_no" && e.event_type !== "user_partial") return false;
    const te = t(e.occurred_at);
    return te < tYes && tYes - te <= SEVEN_D_MS;
  });

  return missWithin7dBeforeYes ? "recommitted" : "stable";
}

export function pickV2OutboundStrategy(
  state: V2CoachingState,
  hasBlockerPreview: boolean
): V2OutboundStrategy {
  if (state === "blocked") {
    return hasBlockerPreview ? "blocker_followup" : "recovery_check";
  }
  if (state === "stable" || state === "recommitted") return "standard_check";
  return "recovery_check";
}

/**
 * Blocker/recovery strategies win; then re-entry; then silence nudge; else base (standard_check).
 */
export function resolveV2OutboundStrategyAfterBase(args: {
  baseStrategy: V2OutboundStrategy;
  silence: V2SilenceContext;
  reentry: V2ReentryContext;
}): V2OutboundStrategy {
  if (args.baseStrategy === "blocker_followup" || args.baseStrategy === "recovery_check") {
    return args.baseStrategy;
  }
  if (args.reentry.active) return "reentry_check";
  if (args.silence.tier === "quiet" || args.silence.tier === "nudge") return "silence_nudge";
  return args.baseStrategy;
}

/** Template family for deterministic fallback SMS / AI hint. */
export function templateFamilyForStrategy(strategy: V2OutboundStrategy): V2OutboundTemplateFamily {
  if (strategy === "reactivation_nudge") return "reactivation";
  return strategy === "standard_check" ? "standard" : "recovery";
}

function truncateOneLine(s: string, max: number): string {
  const x = s.trim().replace(/\s+/g, " ");
  if (x.length <= max) return x;
  return `${x.slice(0, max - 1)}…`;
}

function summarizeEventForPrompt(e: V2EventRowForAi): string {
  const p = e.payload_json || {};
  const preview =
    typeof p.message === "string"
      ? truncateOneLine(p.message, 120)
      : typeof p.body_preview === "string"
        ? truncateOneLine(p.body_preview, 80)
        : "";
  const tail = preview ? ` text="${preview}"` : "";
  return `${e.occurred_at} ${e.event_type}${tail}`;
}

const BANNED_SUBSTRINGS = [
  "therapy",
  "therapist",
  "trauma",
  "diagnos",
  "disorder",
  "ashamed",
  "disappointed in you",
  "you should feel guilty",
  "openai",
  "chatgpt",
  " language model",
  "as an ai",
  "i'm an ai",
  "guarantee you will",
  "promise you will",
];

function passesLexicalGuards(message: string): boolean {
  const lower = message.toLowerCase();
  for (const b of BANNED_SUBSTRINGS) {
    if (lower.includes(b)) return false;
  }
  if (/\bai\b/i.test(message)) return false;
  return true;
}

function passesAccountabilityShape(message: string): boolean {
  if (!message.includes("?")) return false;
  const lower = message.toLowerCase();
  const asksReply =
    lower.includes("yes") ||
    lower.includes("no") ||
    lower.includes("partial") ||
    lower.includes("reply");
  return asksReply;
}

function passesReactivationNudgeShape(message: string): boolean {
  const lower = message.toLowerCase();
  if ((message.match(/\?/g) ?? []).length > 1) return false;
  if (lower.includes("yes / no") || lower.includes("yes/no")) return false;
  if (/\byes\b.*\bno\b.*\bpartial\b/i.test(lower)) return false;
  if (/\breply\s+(yes|no|partial)\b/i.test(lower)) return false;
  if (!message.includes("?")) return false;
  return true;
}

function validateV2AiReactivationNudgeMessage(args: {
  message: string;
  modelStrategy: unknown;
  behaviorStatement: string;
  identityAnchorText?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  const msg = (args.message || "").trim().replace(/\s+/g, " ");
  if (!msg) return { ok: false, reason: "empty_message" };
  if (msg.length > SMS_MAX_LEN) return { ok: false, reason: "too_long" };
  if (typeof args.modelStrategy !== "string" || args.modelStrategy !== "reactivation_nudge") {
    return { ok: false, reason: "strategy_mismatch" };
  }
  if (!passesLexicalGuards(msg)) return { ok: false, reason: "lexical_guard" };
  if (!passesReactivationNudgeShape(msg)) return { ok: false, reason: "reactivation_shape" };

  const anchor = typeof args.identityAnchorText === "string" ? args.identityAnchorText.trim() : "";
  if (anchor) {
    if (msg.includes(anchor)) {
      return { ok: false, reason: "identity_anchor_in_reactivation" };
    }
    if (identityAnchorLeakDetected(msg, anchor)) {
      return { ok: false, reason: "identity_anchor_partial_in_reactivation" };
    }
  }

  const ml = msg.toLowerCase();
  const words = args.behaviorStatement
    .toLowerCase()
    .split(/\s+/)
    .map((w: string) => w.replace(/[^a-z0-9']/g, ""))
    .filter((w: string) => w.length >= 3)
    .slice(0, 8);
  if (words.length > 0 && !words.some((w: string) => ml.includes(w))) {
    return { ok: false, reason: "missing_behavior_anchor" };
  }
  return { ok: true };
}

export function validateV2AiOutboundMessage(args: {
  message: string;
  serverStrategy: V2OutboundStrategy;
  modelStrategy: unknown;
  behaviorStatement: string;
  nextMove?: V2NextMoveDecision;
  contractProposalMode?: boolean;
  contractProposalBindingText?: string | null;
  identityReferenceAllowed?: boolean;
  identityAnchorText?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  if (args.serverStrategy === "reactivation_nudge") {
    return validateV2AiReactivationNudgeMessage({
      message: args.message,
      modelStrategy: args.modelStrategy,
      behaviorStatement: args.behaviorStatement,
      identityAnchorText: args.identityAnchorText ?? null,
    });
  }

  const msg = (args.message || "").trim().replace(/\s+/g, " ");
  if (!msg) return { ok: false, reason: "empty_message" };
  if (msg.length > SMS_MAX_LEN) return { ok: false, reason: "too_long" };
  if (typeof args.modelStrategy !== "string" || args.modelStrategy !== args.serverStrategy) {
    return { ok: false, reason: "strategy_mismatch" };
  }
  if (!passesLexicalGuards(msg)) return { ok: false, reason: "lexical_guard" };
  if (!passesAccountabilityShape(msg)) return { ok: false, reason: "missing_accountability_ask" };

  const binding =
    args.contractProposalMode && args.contractProposalBindingText?.trim()
      ? args.contractProposalBindingText.trim()
      : null;

  const nm = args.nextMove;
  if (binding) {
    const lower = msg.toLowerCase();
    const needle = binding.toLowerCase().slice(0, 28);
    if (needle.length >= 12 && !lower.includes(needle)) {
      return { ok: false, reason: "missing_contract_proposal_anchor" };
    }
    if (!/\byes\b/.test(lower) || !/\bno\b/.test(lower)) {
      return { ok: false, reason: "missing_contract_consent_yes_no" };
    }
  } else if (nm?.type === "shrink_ask" && nm.shrunk_ask_text?.trim()) {
    const needle = nm.shrunk_ask_text.trim().toLowerCase().slice(0, 28);
    if (needle.length >= 12 && !msg.toLowerCase().includes(needle)) {
      return { ok: false, reason: "missing_shrunk_ask_anchor" };
    }
  }

  const anchor = typeof args.identityAnchorText === "string" ? args.identityAnchorText.trim() : "";
  if (anchor) {
    const allowed = Boolean(args.identityReferenceAllowed);
    if (allowed) {
      if (identityAnchorLeakDetected(msg, anchor)) {
        return { ok: false, reason: "identity_anchor_partial_leak" };
      }
    } else {
      if (msg.includes(anchor)) {
        return { ok: false, reason: "identity_anchor_when_disallowed" };
      }
      if (identityAnchorLeakDetected(msg, anchor)) {
        return { ok: false, reason: "identity_anchor_partial_when_disallowed" };
      }
    }
  }

  const ml = msg.toLowerCase();
  const words = args.behaviorStatement
    .toLowerCase()
    .split(/\s+/)
    .map((w: string) => w.replace(/[^a-z0-9']/g, ""))
    .filter((w: string) => w.length >= 3)
    .slice(0, 8);
  if (words.length > 0 && !words.some((w: string) => ml.includes(w))) {
    return { ok: false, reason: "missing_behavior_anchor" };
  }

  return { ok: true };
}

/** Rule-derived cadence for copy rhythm; AI must not choose or override cadence. */
export type V2AiCadenceContext = {
  level: "daily" | "every_other_day" | "every_3_days";
  reason_code: string;
  version: 1;
};

export type V2AiOutboundContext = {
  commitment: ActiveV2CommitmentRow;
  eventsNewestFirst: V2EventRowForAi[];
  blockerPreview: string | null;
  serverState: V2CoachingState;
  serverStrategy: V2OutboundStrategy;
  templateFamily: V2OutboundTemplateFamily;
  silence: V2SilenceContext;
  reentry: V2ReentryContext;
  nextMove: V2NextMoveDecision;
  /** Authoritative cadence from v2-cadence rules (not model-chosen). */
  cadence: V2AiCadenceContext;
  /** Effective coaching ask (overlay when active, else base behavior_statement). */
  effectiveCoachingAsk: string;
  /** Shrink / recommit overlay explicit consent proposal (server binding text; AI packages only). */
  contractProposalMode?: boolean;
  /** When contractProposalMode: which overlay contract is being proposed (authoritative). */
  contractProposalKind?: "shrink_ask" | "recommit_same" | null;
  contractProposalBindingText?: string | null;
  /** Prior recompute snapshot for long-horizon context (optional). */
  coachingMemory: V2CoachingMemoryForPrompt | null;
  preferredName: string | null;
  lifeDesires: string | null;
  /** Optional one-line mirror of `user_profiles.people_summary` (wording context only). */
  peopleSummary?: string | null;
  /** Optional one-line mirror of `user_profiles.responsibility` (wording context only). */
  responsibility?: string | null;
  /** Canonical short identity line from `user_profiles` (never AI-written). */
  identityAnchorText?: string | null;
  /** Informational: refresh window per profile timestamps. */
  identityRefreshDue?: boolean;
  /** Server gate: when true, model may optionally quote anchor verbatim once. */
  identityReferenceAllowed?: boolean;
  /** Optional one-line reachability (rule-derived); never changes send gating here. */
  reachabilityContextLine?: string | null;
};

function buildDeveloperPromptReactivation(ctx: V2AiOutboundContext): string {
  const lines: string[] = [];
  lines.push(
    "You write ONE optional re-engagement SMS (low-pressure reactivation). This is NOT a daily accountability check."
  );
  lines.push("Return ONLY valid JSON with keys: state, strategy, message, confidence (0-1 number or null).");
  lines.push(`server_state (authoritative): ${ctx.serverState}`);
  lines.push(`server_strategy (authoritative): reactivation_nudge`);
  lines.push("strategy in your JSON MUST exactly equal: reactivation_nudge");
  lines.push("state in your JSON should echo server_state.");
  lines.push("");
  lines.push("COMMITMENT (anchor; use behavior_statement wording lightly—no binary check):");
  lines.push(`title: ${truncateOneLine(ctx.commitment.title, 80)}`);
  lines.push(`behavior_statement: ${truncateOneLine(ctx.commitment.behavior_statement, 200)}`);
  if (ctx.commitment.success_criteria?.trim()) {
    lines.push(`success_criteria: ${truncateOneLine(ctx.commitment.success_criteria, 160)}`);
  }
  lines.push("");
  if (ctx.preferredName?.trim()) {
    lines.push(
      `Preferred name Coach Pat should use: ${truncateOneLine(ctx.preferredName, 40)}`
    );
  }
  lines.push("");
  if (ctx.reachabilityContextLine?.trim()) {
    lines.push(ctx.reachabilityContextLine.trim());
    lines.push("(Reachability is contextual only; do not change strategy or cadence rules.)");
    lines.push("");
  }
  const memBlock = formatCoachingMemoryPromptBlock(ctx.coachingMemory);
  if (memBlock) {
    lines.push(memBlock);
    lines.push("");
  }
  const relHints = formatRelationshipFitOutboundHints(ctx.coachingMemory?.sms_relationship_profile);
  if (relHints.length > 0) {
    lines.push(...relHints);
    lines.push("");
  }
  lines.push(
    "LOW_PRESSURE_REACTIVATION: do not lean on identity framing or life_desires; keep copy optional and light."
  );
  lines.push(
    "- If COACHING_MEMORY includes identity_anchor, ignore it for this send—no quoting or paraphrase."
  );
  const eventSlice = ctx.coachingMemory ? 8 : 15;
  lines.push("RECENT_EVENTS (newest first, truncated):");
  for (const e of ctx.eventsNewestFirst.slice(0, eventSlice)) {
    lines.push(summarizeEventForPrompt(e));
  }
  lines.push("");
  lines.push("RULES:");
  lines.push("VOICE_DOCTRINE:");
  lines.push("- Speak like Pat Summitt AI for accountability: direct, specific, tactical, human.");
  lines.push("- Hold the standard without shame. Keep it short.");
  lines.push("- This SMS may be the user's primary product experience.");
  lines.push(`- Max ${SMS_MAX_LEN} characters. One SMS. No newlines.`);
  lines.push("- This is low-pressure reactivation, not a form-style check.");
  lines.push("- At most one question mark total.");
  lines.push("- No fake hype, no therapy tone, no abusive or shaming language.");
  lines.push("- No invented facts; ground in RECENT_EVENTS and COACHING_MEMORY only.");
  if (ctx.coachingMemory) {
    lines.push("- If COACHING_MEMORY conflicts with RECENT_EVENTS tail, trust COACHING_MEMORY structured lines.");
  }
  lines.push("- Keep commitment scope unchanged; do not add new goals.");
  lines.push("- Do not claim unsupported personal or historical memory.");
  lines.push("- strategy field MUST be exactly: reactivation_nudge");
  lines.push("EXAMPLES (style only, do not copy verbatim):");
  lines.push('- "No pressure note: if today is a good day to restart <ask>, send a short line."');
  lines.push('- "Door is open when you are ready to re-enter <ask>. One line is enough."');

  return lines.join("\n");
}

function buildDeveloperPrompt(ctx: V2AiOutboundContext): string {
  if (ctx.serverStrategy === "reactivation_nudge") {
    return buildDeveloperPromptReactivation(ctx);
  }
  const lines: string[] = [];
  lines.push("You write ONE outbound SMS for daily accountability.");
  lines.push("Return ONLY valid JSON with keys: state, strategy, message, confidence (0-1 number or null).");
  lines.push(`server_state (authoritative): ${ctx.serverState}`);
  lines.push(`server_strategy (authoritative): ${ctx.serverStrategy}`);
  lines.push("strategy in your JSON MUST exactly equal server_strategy.");
  lines.push(`state in your JSON should echo server_state: ${ctx.serverState}`);
  lines.push(`template_family hint: ${ctx.templateFamily}`);
  lines.push("");
  lines.push("SILENCE_CONTEXT (rule-derived, authoritative numbers):");
  lines.push(
    `tier=${ctx.silence.tier}, unanswered_checks=${ctx.silence.unanswered_checks}, days_since_last_user_outcome=${ctx.silence.days_since_last_user_outcome}`
  );
  lines.push("");
  lines.push("REENTRY_CONTEXT (rule-derived):");
  lines.push(`reentry_active=${ctx.reentry.active}`);
  lines.push("");
  lines.push("NEXT_MOVE (server-derived, authoritative):");
  lines.push(`type=${ctx.nextMove.type}, reason_code=${ctx.nextMove.reason_code}, version=${ctx.nextMove.version}`);
  if (ctx.nextMove.type === "shrink_ask" && ctx.nextMove.shrunk_ask_text?.trim()) {
    lines.push(`SHRUNK_ASK_TEXT (include verbatim as a substring in message): ${truncateOneLine(ctx.nextMove.shrunk_ask_text, 160)}`);
  }
  if (ctx.nextMove.type === "recommit_same") {
    lines.push("Move intent: same commitment—clean recommit line, no new goal.");
  }
  if (ctx.nextMove.type === "reset_day") {
    lines.push("Move intent: forgiving reset for today—no backlog scorekeeping, still one honest check.");
  }
  if (ctx.nextMove.type === "hold_standard") {
    lines.push("Move intent: hold the standard—normal accountability.");
  }
  lines.push("");
  lines.push("CADENCE (server-derived, authoritative — do not change cadence):");
  lines.push(
    `level=${ctx.cadence.level}, reason_code=${ctx.cadence.reason_code}, version=${ctx.cadence.version}`
  );
  lines.push(
    "Match tone to cadence: daily = normal daily check-in; every_other_day = you are on a lighter earned rhythm (still one clear ask); every_3_days = lightest earned rhythm, still accountable, not apologetic about spacing."
  );
  lines.push("");
  lines.push("COMMITMENT:");
  lines.push(`title: ${truncateOneLine(ctx.commitment.title, 80)}`);
  lines.push(
    `effective_coaching_ask (authoritative for daily checks): ${truncateOneLine(ctx.effectiveCoachingAsk, 200)}`
  );
  lines.push(
    `original_behavior_statement (long-term anchor; never replace): ${truncateOneLine(ctx.commitment.behavior_statement, 200)}`
  );
  if (ctx.commitment.success_criteria?.trim()) {
    lines.push(`success_criteria: ${truncateOneLine(ctx.commitment.success_criteria, 160)}`);
  }
  if (ctx.contractProposalMode && ctx.contractProposalBindingText?.trim()) {
    const k = ctx.contractProposalKind ?? "shrink_ask";
    lines.push("");
    lines.push("CONTRACT_PROPOSAL_MODE (server-controlled):");
    lines.push(`contract_kind (authoritative): ${k}`);
    lines.push(
      `PROPOSAL_BINDING_TEXT must appear verbatim as a substring in message: ${truncateOneLine(ctx.contractProposalBindingText, 200)}`
    );
    if (k === "recommit_same") {
      lines.push(
        "This SMS proposes an explicit temporary recommit to the SAME bar for 7 days if the user replies YES. Reply NO skips this lock-in; original_behavior_statement is unchanged."
      );
    } else {
      lines.push(
        "This SMS proposes a smaller temporary ask for 7 days if the user replies YES. Reply NO keeps the current bar (original_behavior_statement)."
      );
    }
    lines.push(
      "Message must clearly ask for YES or NO to adopt the proposal—not a daily YES/NO/PARTIAL accountability check."
    );
    lines.push("Do not invent different binding text; do not activate anything; packaging only.");
  }
  lines.push("");
  if (ctx.preferredName?.trim()) {
    lines.push(
      `Preferred name Coach Pat should use: ${truncateOneLine(ctx.preferredName, 40)}`
    );
  }
  if (ctx.lifeDesires?.trim()) {
    lines.push(
      `Legacy onboarding—what they said they want out of life right now: ${truncateOneLine(ctx.lifeDesires, 120)}`
    );
  }
  const showUpFor = ctx.peopleSummary?.trim() ?? "";
  const responsibilityText = ctx.responsibility?.trim() ?? "";
  if (showUpFor || responsibilityText) {
    lines.push("");
    lines.push(
      "USER_ONBOARDING (answered in app; wording and empathy only—never changes cadence, strategy, or commitment rules):"
    );
  }
  if (showUpFor) {
    lines.push(
      `User said they are trying to show up for right now: ${truncateOneLine(showUpFor, 200)}`
    );
  }
  if (responsibilityText) {
    lines.push(
      `Additional context they want Coach Pat to know (family, team, responsibilities): ${truncateOneLine(responsibilityText, 160)}`
    );
  }
  if (showUpFor || responsibilityText) {
    lines.push(
      "Use the above naturally when it helps the message feel personal and grounded. Do not force into every SMS. Do not guilt-trip. Do not invent details. effective_coaching_ask and authoritative server fields stay primary."
    );
    if (showUpFor && ctx.identityAnchorText?.trim()) {
      lines.push(
        "(IDENTITY_CONTEXT below may mirror this 'show up for' answer as the stored identity line—at most one grounded tie, not redundant repetition.)"
      );
    }
  }
  if (ctx.identityAnchorText?.trim()) {
    lines.push("");
    lines.push("IDENTITY_CONTEXT (user_profiles is authoritative; never invent or edit anchor):");
    lines.push(
      `Stored identity anchor for this user: ${truncateOneLine(ctx.identityAnchorText, 200)}`
    );
    lines.push(`identity_refresh_due (informational): ${ctx.identityRefreshDue ? "yes" : "no"}`);
    lines.push(
      `identity_reference_allowed_this_send (authoritative): ${ctx.identityReferenceAllowed ? "yes" : "no"}`
    );
    lines.push(
      "- If identity_reference_allowed_this_send is no: do not quote or closely paraphrase the stored identity anchor above; center on effective_coaching_ask."
    );
    lines.push(
      "- If yes: you MAY add at most one short grounding clause that includes the stored identity anchor verbatim as a substring; effective_coaching_ask stays primary; no guilt, no vague inspiration, no therapy tone."
    );
    lines.push(
      "- Never rewrite the stored identity anchor; never add facts not in RECENT_EVENTS, COACHING_MEMORY, or optional USER_ONBOARDING lines when present."
    );
  }
  lines.push("");
  if (ctx.reachabilityContextLine?.trim()) {
    lines.push(ctx.reachabilityContextLine.trim());
    lines.push("(Reachability is contextual only; do not change strategy or cadence rules.)");
    lines.push("");
  }
  if (ctx.blockerPreview?.trim()) {
    lines.push(`latest_blocker_preview: ${truncateOneLine(ctx.blockerPreview, 160)}`);
  }
  lines.push("");
  const memBlock = formatCoachingMemoryPromptBlock(ctx.coachingMemory);
  if (memBlock) {
    lines.push(memBlock);
    lines.push("");
  }
  const relHints = formatRelationshipFitOutboundHints(ctx.coachingMemory?.sms_relationship_profile);
  if (relHints.length > 0) {
    lines.push(...relHints);
    lines.push("");
  }
  const eventSlice = ctx.coachingMemory ? 12 : 25;
  lines.push("RECENT_EVENTS (newest first, truncated):");
  for (const e of ctx.eventsNewestFirst.slice(0, eventSlice)) {
    lines.push(summarizeEventForPrompt(e));
  }
  lines.push("");
  lines.push("RULES:");
  lines.push("VOICE_DOCTRINE:");
  lines.push("- Speak like Pat Summitt AI for daily accountability: direct, specific, tactical, human.");
  lines.push("- Clear beats clever. Serious beats hype. Proof beats praise.");
  lines.push("- Hold the standard without shame. Keep it short.");
  lines.push("- This SMS may be the user's primary product experience.");
  lines.push(`- Max ${SMS_MAX_LEN} characters. One SMS. No newlines.`);
  lines.push("- Keep server strategy exactly. Do not change cadence, commitment, or state.");
  lines.push("- No fake hype, no therapy tone, no abusive or shaming language.");
  lines.push("- No invented facts; use RECENT_EVENTS, COACHING_MEMORY, blocker preview, and optional USER_ONBOARDING context.");
  if (ctx.coachingMemory) {
    lines.push("- If COACHING_MEMORY conflicts with RECENT_EVENTS tail, trust COACHING_MEMORY structured lines for long-horizon state.");
  }
  lines.push("- Keep commitment scope unchanged; do not add new goals.");
  lines.push("- Do not claim unsupported personal or historical memory.");
  lines.push("- You may paraphrase the ask lightly to stay concise, but preserve anchor words from effective_coaching_ask.");
  lines.push("- Avoid repeating the full formal behavior_statement every time when a shorter anchored version is clear.");
  lines.push("- If server_strategy is silence_nudge: easy re-entry, no absence policing, ask plainly for the honest outcome.");
  lines.push("- If server_strategy is reentry_check: welcome back, no punishment, one accountability ask.");
  lines.push("- If next_move is shrink_ask and NOT contract proposal mode: include SHRUNK_ASK_TEXT verbatim as a substring.");
  lines.push("- If CONTRACT_PROPOSAL_MODE: follow CONTRACT_PROPOSAL_MODE rules above (verbatim binding + explicit consent YES/NO).");
  lines.push("- If next_move is reset_day: calm reset for today.");
  lines.push("- If next_move is recommit_same: same commitment, clear recommit.");
  lines.push("- Do not contradict next_move intent or server-provided ask.");
  if (ctx.contractProposalMode) {
    lines.push(
      "- CONTRACT PROPOSAL: end with explicit yes or no to adopt the temporary overlay (not a normal daily check)."
    );
  } else {
    lines.push("- End with a plain accountability question that invites an honest response.");
  }
  lines.push("- strategy field MUST be exactly: " + ctx.serverStrategy);
  lines.push("EXAMPLES (style only, do not copy verbatim):");
  lines.push('- standard_check: "I’m asking it plain: did <ask> happen today?"');
  lines.push('- recovery_check: "No shame, don\'t waste the miss. Did <ask> happen today?"');
  lines.push('- silence_nudge: "No backlog lecture. Just today on <ask>: what happened?"');
  lines.push('- reentry_check: "Good return. Same bar today: <ask>. Tell me straight."');
  lines.push('- reactivation_nudge: "No pressure note: if today is a good day to restart <ask>, send a short line."');

  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are Pat Summitt AI for daily accountability SMS.
Voice: direct, specific, tactical, human, calm.
Hold the standard without shame.
Output strict JSON only.`;

export async function tryGenerateV2OutboundMessage(
  ctx: V2AiOutboundContext
): Promise<V2AiOutboundAttempt> {
  if (!isV2AiOutboundEnabled()) {
    return { ok: false, fallbackUsed: true, reason: "ai_disabled" };
  }

  const client = getOpenAIClientOrNull();
  if (!client) {
    return { ok: false, fallbackUsed: true, reason: "no_openai_key" };
  }

  try {
    const completion = await client.chat.completions.create({
      model: V2_OUTBOUND_AI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildDeveloperPrompt(ctx) },
      ],
      temperature: 0.55,
      max_tokens: 220,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!raw) {
      return { ok: false, fallbackUsed: true, reason: "empty_model_output" };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ok: false, fallbackUsed: true, reason: "invalid_json" };
    }

    const message = typeof parsed.message === "string" ? parsed.message.trim().replace(/\n+/g, " ") : "";
    const modelStrategy = parsed.strategy;
    const validated = validateV2AiOutboundMessage({
      message,
      serverStrategy: ctx.serverStrategy,
      modelStrategy,
      behaviorStatement: ctx.commitment.behavior_statement,
      nextMove: ctx.nextMove,
      contractProposalMode: ctx.contractProposalMode,
      contractProposalBindingText: ctx.contractProposalBindingText ?? null,
      identityReferenceAllowed: ctx.identityReferenceAllowed,
      identityAnchorText: ctx.identityAnchorText ?? null,
    });
    if (!validated.ok) {
      return { ok: false, fallbackUsed: true, reason: validated.reason };
    }

    let confidence: number | null = null;
    if (typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)) {
      const c = parsed.confidence;
      if (c >= 0 && c <= 1) confidence = c;
    }

    return { ok: true, message, confidence, fallbackUsed: false };
  } catch (err) {
    console.error("[v2-ai-outbound] OpenAI call failed", err);
    return { ok: false, fallbackUsed: true, reason: "openai_error" };
  }
}

export function buildCheckSentAiPayload(args: {
  model: string;
  promptVersion: string;
  serverState: V2CoachingState;
  serverStrategy: V2OutboundStrategy;
  message: string;
  confidence: number | null;
  fallbackUsed: boolean;
  fallbackReason?: string;
}): Record<string, unknown> {
  return {
    model: args.model,
    prompt_version: args.promptVersion,
    server_state: args.serverState,
    server_strategy: args.serverStrategy,
    message: args.message,
    ...(args.confidence != null ? { confidence: args.confidence } : {}),
    fallback_used: args.fallbackUsed,
    ...(args.fallbackReason && args.fallbackUsed ? { fallback_reason: args.fallbackReason } : {}),
  };
}
