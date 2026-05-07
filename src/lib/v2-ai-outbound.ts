import OpenAI from "openai";

import type { ActiveV2CommitmentRow, V2EventRowForAi } from "@/lib/v2-commitment";
import { identityAnchorLeakDetected } from "@/lib/v2-identity-anchor";
import {
  formatCoachingMemoryPromptBlock,
  type V2CoachingMemoryForPrompt,
} from "@/lib/v2-coaching-memory-prompt";
import { parseIsoMs } from "@/lib/v2-identity-anchor";
import {
  getShortCommitmentPhraseForSms,
  naturalizeCommitmentForSms,
  type V2OutboundTemplateFamily,
} from "@/lib/v2-sms-accountability";
import { formatRelationshipFitOutboundHints } from "@/lib/v2-sms-relationship-profile";
import type { Wave7DailyEvolutionPick } from "@/lib/v2-sms-evolution-signal";
import {
  deriveDailyOutboundBrainCase,
  finalizeDailyOutboundHumanSms,
} from "@/lib/v2-human-sms-brain/finalize-daily-outbound-human-sms";
import { shouldApplyPhase4DailyOutboundPolish, shouldApplyPhase5aReactivationOutboundPolish } from "@/lib/v2-human-sms-brain/flags";
import { finalizePhase5aReactivationOutboundHumanSms } from "@/lib/v2-human-sms-brain/finalize-phase5a-human-sms";
import {
  internalCoachJargonFailReason,
  weakGenericMotivationalPhraseFailReason,
} from "@/lib/v2-sms-quality-copy";

export const V2_OUTBOUND_AI_PROMPT_VERSION = "v2_outbound_wave3";

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
  if (!t) return "Today only: one honest step on the commitment.";

  // Only shrink when we can confidently shrink time-based asks.
  // Otherwise we keep the caller from proposing a fake "smaller" version.
  const mh = t.match(/\b(\d+)\s*(hour|hours)\b/i);
  if (mh) {
    const n = Number(mh[1]);
    if (Number.isFinite(n) && n >= 1) {
      const replacement =
        n === 1 ? "30 minutes" : `${Math.max(1, Math.floor(n / 2))} hour${Math.max(1, Math.floor(n / 2)) === 1 ? "" : "s"}`;
      const replaced = t.replace(mh[0], replacement);
      return `Today only: ${replaced}`;
    }
  }
  const mm = t.match(/\b(\d+)\s*(minute|minutes)\b/i);
  if (mm) {
    const n = Number(mm[1]);
    if (Number.isFinite(n) && n >= 15) {
      const replacement = `${Math.max(10, Math.floor(n / 2))} minutes`;
      const replaced = t.replace(mm[0], replacement);
      return `Today only: ${replaced}`;
    }
  }

  return "";
}

function computeMeaningfulShrunkAskText(behaviorStatement: string): string | null {
  const s = computeShrunkAskText(behaviorStatement).trim();
  if (!s) return null;
  const base = behaviorStatement.trim().replace(/\s+/g, " ");
  if (!base) return null;
  // If our "shrink" is basically just re-stating the same ask, don't use it.
  const strip = (x: string) => x.toLowerCase().replace(/today only:\s*/i, "").replace(/\s+/g, " ").trim();
  if (strip(s) === strip(base)) return null;
  return s;
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
    const shrunk = computeMeaningfulShrunkAskText(shrunkBase);
    if (!shrunk) {
      return { type: "hold_standard", reason_code: "shrink_rejected_not_smaller", version: NEXT_MOVE_VERSION };
    }
    return {
      type: "shrink_ask",
      reason_code: "shrink_two_no_7d",
      version: NEXT_MOVE_VERSION,
      shrunk_ask_text: shrunk,
    };
  }
  if (partial7 >= 2) {
    const shrunk = computeMeaningfulShrunkAskText(shrunkBase);
    if (!shrunk) {
      return { type: "hold_standard", reason_code: "shrink_rejected_not_smaller", version: NEXT_MOVE_VERSION };
    }
    return {
      type: "shrink_ask",
      reason_code: "shrink_partials_7d",
      version: NEXT_MOVE_VERSION,
      shrunk_ask_text: shrunk,
    };
  }
  if (latestBlockerHasShrinkKeyword(eventsNewestFirst)) {
    const shrunk = computeMeaningfulShrunkAskText(shrunkBase);
    if (!shrunk) {
      return { type: "hold_standard", reason_code: "shrink_rejected_not_smaller", version: NEXT_MOVE_VERSION };
    }
    return {
      type: "shrink_ask",
      reason_code: "shrink_blocker_keywords",
      version: NEXT_MOVE_VERSION,
      shrunk_ask_text: shrunk,
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

/** Wave 3: human-facing daily accountability purpose (copy tone only; server strategy stays authoritative). */
export type V2DailyMessagePurpose =
  | "standard_accountability_check"
  | "comeback_after_silence"
  | "after_yes_streak"
  | "after_no_or_partial"
  | "repeated_blocker_pattern"
  | "low_pressure_reactivation"
  | "adaptive_overlay_active"
  | "first_week_simple_check"
  | "proof_milestone_light"
  | "contract_overlay_proposal"
  | "fallback_standard"
  /** Wave 7: commitment may need clarity / adjustment — advisory only; server does not mutate here. */
  | "evolution_pattern_check";

function newestOutcomeOnly(eventsNewestFirst: V2EventRowForAi[]): string | null {
  const e = eventsNewestFirst.find((x) => USER_OUTCOMES.has(x.event_type));
  return e ? e.event_type : null;
}

function consecutiveYesStreakFromNewest(eventsNewestFirst: V2EventRowForAi[]): number {
  let n = 0;
  for (const e of eventsNewestFirst) {
    if (e.event_type === "user_yes") n += 1;
    else if (USER_OUTCOMES.has(e.event_type)) break;
  }
  return n;
}

function blockerCaptureCount14d(eventsNewestFirst: V2EventRowForAi[], nowMs: number): number {
  const cutoff = nowMs - 14 * MS_DAY;
  let n = 0;
  for (const e of eventsNewestFirst) {
    if (e.event_type !== "blocker_captured") continue;
    const t = eventTimeMs(e.occurred_at);
    if (t >= cutoff && t <= nowMs) n += 1;
  }
  return n;
}

/**
 * Rule-derived daily copy purpose for Wave 3 prompts + deterministic fallback (bounded; does not replace strategy).
 */
export function deriveV2DailyMessagePurpose(args: {
  contractProposalMode: boolean;
  serverStrategy: V2OutboundStrategy;
  reentry: V2ReentryContext;
  silence: V2SilenceContext;
  serverState: V2CoachingState;
  overlayActive: boolean;
  hasBlockerPreview: boolean;
  eventsNewestFirst: V2EventRowForAi[];
  coachingMemory: V2CoachingMemoryForPrompt | null;
  commitmentStartedAt: string | null;
  nowMs: number;
  /** When true, Wave 7 evolution signal applies (caller computed gates). */
  wave7SurfaceEvolution?: boolean;
}): V2DailyMessagePurpose {
  if (args.contractProposalMode) return "contract_overlay_proposal";
  if (args.serverStrategy === "reactivation_nudge") return "low_pressure_reactivation";
  if (args.overlayActive) return "adaptive_overlay_active";
  if (args.wave7SurfaceEvolution) return "evolution_pattern_check";
  if (args.reentry.active || args.serverStrategy === "reentry_check") return "comeback_after_silence";
  if (args.serverStrategy === "silence_nudge") return "comeback_after_silence";

  const latest = newestOutcomeOnly(args.eventsNewestFirst);
  if (latest === "user_no" || latest === "user_partial") return "after_no_or_partial";

  const startedMs = parseIsoMs(args.commitmentStartedAt);
  if (startedMs != null && args.nowMs - startedMs <= SEVEN_D_MS) {
    return "first_week_simple_check";
  }

  const yesStreak = consecutiveYesStreakFromNewest(args.eventsNewestFirst);
  if (yesStreak >= 2) return "after_yes_streak";

  const blockers14 = blockerCaptureCount14d(args.eventsNewestFirst, args.nowMs);
  if (
    args.serverState === "blocked" &&
    args.hasBlockerPreview &&
    (args.serverStrategy === "blocker_followup" || blockers14 >= 2)
  ) {
    return "repeated_blocker_pattern";
  }

  const ys = args.coachingMemory?.yes_streak_14d ?? 0;
  if (ys >= 5) return "proof_milestone_light";

  return "standard_accountability_check";
}

export type V2DailyOutboundResolution = {
  daily_reply_source: "ai_generated" | "deterministic_human" | "fallback";
  daily_message_purpose: V2DailyMessagePurpose;
  ai_rejected_reason: string | null;
  short_commitment_phrase_used: boolean;
  identity_reference_used: boolean;
  proof_reference_used: boolean;
  evolution_recommendation_used?: boolean;
  evolution_recommended_action?: string | null;
  blocker_pattern_coaching_used?: boolean;
};

export function buildV2HumanDailyFallbackSms(args: {
  purpose: V2DailyMessagePurpose;
  effectiveAsk: string;
  behaviorStatement: string;
  nextMoveType: V2NextMoveType;
  shrunkAskText?: string | null;
  wave7EvolutionPick?: Wave7DailyEvolutionPick | null;
}): string {
  const eff = args.effectiveAsk?.trim() || args.behaviorStatement?.trim() || "";
  const short = getShortCommitmentPhraseForSms({
    effectiveAsk: args.effectiveAsk,
    behaviorStatement: args.behaviorStatement,
  });
  const usePhrase = short !== "the bar" && short.length < 36;

  if (
    args.nextMoveType === "shrink_ask" &&
    args.shrunkAskText?.trim() &&
    args.purpose !== "contract_overlay_proposal"
  ) {
    const s = naturalizeCommitmentForSms(args.shrunkAskText, 72);
    return `Today is simple: ${s}. Did it happen?`;
  }

  switch (args.purpose) {
    case "comeback_after_silence":
      return "Good to check in again. Did you do the commitment today?";
    case "after_no_or_partial":
      return "Back to the bar today. Did you get it done?";
    case "repeated_blocker_pattern": {
      const flip =
        (args.effectiveAsk?.length ?? 0) + (args.behaviorStatement?.length ?? 0) > 0
          ? (args.behaviorStatement?.length ?? 0) % 2 === 0
          : true;
      return flip
        ? "Time keeps showing up as the blocker. Today's win is starting before the day gets away. Did it happen?"
        : "You've named the same obstacle more than once. That usually means the bar needs to get clearer. Did today's bar happen?";
    }
    case "adaptive_overlay_active": {
      const bar = naturalizeCommitmentForSms(eff, 72);
      return `Today is simple: ${bar}. Did it happen?`;
    }
    case "low_pressure_reactivation":
      return "No speech—just one honest check-in: did you do it today?";
    case "first_week_simple_check":
      return usePhrase ? `Quick check: did you get ${short} done today?` : "Did you do the commitment today?";
    case "after_yes_streak":
      return usePhrase
        ? `You're building proof on this. Did you get ${short} done again today?`
        : "You're building proof on this. Did you follow through again today?";
    case "proof_milestone_light":
      return "That's real consistency. Did you follow through again today?";
    case "evolution_pattern_check": {
      const a = args.wave7EvolutionPick?.action ?? "tighten_commitment";
      if (a === "tighten_commitment") {
        return "I'm seeing the same fight repeat. This may need a clearer bar—not more guilt. Did today happen, or should we tighten it?";
      }
      if (a === "refresh_commitment_only") {
        return "This may be a good moment to reset the bar. Did today's commitment still fit, or does it need adjusting?";
      }
      if (a === "reframe_commitment") {
        return "I'm not sure the bar is aimed at the real fight anymore. Did it still fit today?";
      }
      if (a === "replace_commitment") {
        return "This may be pointing to a new commitment. I won't change it without you. Does the current one still fit?";
      }
      if (a === "adapt_commitment_temporary") {
        return "The temporary bar may need a clearer edge. Did today's commitment still work, or does it need tweaking?";
      }
      return "Something may need to shift—not guilt, clarity. Did today's bar happen as written?";
    }
    case "fallback_standard":
    case "standard_accountability_check":
    default:
      return usePhrase ? `Did you get ${short} done today?` : "Did you do the commitment today?";
  }
}

/** Wave 3 outbound copy safety for daily accountability (not contract proposals). */
export function validateV2DailyOutboundHumanSafety(
  message: string,
  opts: { contractProposalMode: boolean; serverStrategy: V2OutboundStrategy }
): { ok: true } | { ok: false; reason: string } {
  if (opts.contractProposalMode) return { ok: true };
  const msg = (message || "").trim();
  if (!msg) return { ok: false, reason: "empty_message" };
  if (msg.length > SMS_MAX_LEN) return { ok: false, reason: "too_long" };
  const lower = msg.toLowerCase();
  if (/\breply\s+stop\b/i.test(lower)) return { ok: false, reason: "wave3_stop_footer" };
  if (/\breply\s+start\b/i.test(lower)) return { ok: false, reason: "wave3_start_footer" };
  if (/\breply\s+help\b/i.test(lower)) return { ok: false, reason: "wave3_help_footer" };
  if (/\btext\s+stop\b/i.test(lower)) return { ok: false, reason: "wave3_text_stop" };
  if (/\b(stop|unsubscribe)\s+to\s+/i.test(lower)) return { ok: false, reason: "wave3_compliance_footer" };
  if (/\breply\s+(yes|no|partial)\b/i.test(lower)) return { ok: false, reason: "wave3_reply_yes_no_partial_menu" };
  if (/\breply\s+(still|change|keep|tighten|new)\b/i.test(lower)) {
    return { ok: false, reason: "wave3_refresh_command_menu" };
  }
  if (/\{[\s\S]*"[\s\S]*\}/.test(msg)) return { ok: false, reason: "wave3_json_like" };
  if (/\b(commitment|bar|standard)\s+(is\s+now|has\s+been\s+updated|changed permanently|was\s+updated)\b/i.test(msg)) {
    return { ok: false, reason: "wave3_commitment_mutation_claim" };
  }
  return { ok: true };
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
      : typeof p.message_preview === "string"
        ? truncateOneLine(p.message_preview, 100)
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

/** Accountability SMS must invite an honest reply — natural coaching questions count without YES/NO menus. */
function passesAccountabilityShape(message: string, contractProposalMode: boolean): boolean {
  if (contractProposalMode) {
    const lower = message.toLowerCase();
    return Boolean(lower.includes("yes") && lower.includes("no"));
  }
  const lower = message.toLowerCase();
  const asksLexicalReplyMenu =
    /\breply\s+(yes|no|partial)\b/i.test(lower) ||
    /\breply\s+(still|change|keep|tighten|new)\b/i.test(lower);
  if (asksLexicalReplyMenu) return false;
  const invitesAnyReply =
    message.includes("?") ||
    /\b(tell me|text me|send me|drop me|give me)\b/i.test(message) ||
    /\bwhat'?s the honest answer\b/i.test(message);
  if (!invitesAnyReply) return false;
  const asksReplyKeyword =
    /(^|[^a-z])yes([^a-z]|$)/i.test(lower) ||
    /(^|[^a-z])no([^a-z]|$)/i.test(lower) ||
    /\bpartial\b/.test(lower) ||
    /\breply\b/.test(lower);
  const naturalAccountabilityAsk =
    /\b(did you|did it|did that|what happened|how did|where did|happen today|happen,|follow through|get it done|get that done|get it|make the|honest|straight|protect|landed|real version|real answer|pull you off|bar today|check-in|check in|still on|what landed)\b/i.test(
      message
    );
  const strongNonQuestionPrompts =
    /\b(tell me straight|tell me the truth|give me the real version)\b/i.test(message);
  return Boolean(asksReplyKeyword || naturalAccountabilityAsk || strongNonQuestionPrompts);
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

  const wave3Re = validateV2DailyOutboundHumanSafety(msg, {
    contractProposalMode: false,
    serverStrategy: "reactivation_nudge",
  });
  if (!wave3Re.ok) return wave3Re;

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
  const wgRe = weakGenericMotivationalPhraseFailReason(msg);
  if (wgRe) return { ok: false, reason: wgRe };
  const ijRe = internalCoachJargonFailReason(msg);
  if (ijRe) return { ok: false, reason: ijRe };
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
  if (!passesAccountabilityShape(msg, Boolean(args.contractProposalMode))) {
    return { ok: false, reason: "missing_accountability_ask" };
  }

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

  if (!args.contractProposalMode) {
    const wave3 = validateV2DailyOutboundHumanSafety(msg, {
      contractProposalMode: false,
      serverStrategy: args.serverStrategy,
    });
    if (!wave3.ok) return wave3;
  }

  const wgOut = weakGenericMotivationalPhraseFailReason(msg);
  if (wgOut) return { ok: false, reason: wgOut };
  const ijOut = internalCoachJargonFailReason(msg);
  if (ijOut) return { ok: false, reason: ijOut };

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
  /** Server-derived daily copy purpose (Wave 3 tone hint; not exposed to the user). */
  dailyMessagePurpose?: V2DailyMessagePurpose;
  /** Wave 6: bounded RECENT_SMS_CONTEXT from `buildV2SmsConversationContextPack`. */
  recentSmsContextBlock?: string | null;
  /** Wave 7: populated when daily purpose is evolution_pattern_check. */
  wave7EvolutionPick?: Wave7DailyEvolutionPick | null;
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
  if (ctx.recentSmsContextBlock?.trim()) {
    lines.push(ctx.recentSmsContextBlock.trim());
    lines.push("");
  }
  if (ctx.preferredName?.trim()) {
    lines.push(
      `Preferred name is available for context (${truncateOneLine(ctx.preferredName, 40)}). Do not overuse it. Avoid starting with their name—the server may add a short greeting.`
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
  lines.push("- No STOP/START/HELP compliance footer; no \"Reply YES/NO/PARTIAL\" menus.");
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
  if (ctx.dailyMessagePurpose) {
    lines.push(
      `DAILY_MESSAGE_PURPOSE (tone hint only; never echo this label in the SMS; strategy + next_move stay authoritative): ${ctx.dailyMessagePurpose}`
    );
  }
  lines.push("");
  lines.push("PRODUCT:");
  lines.push("- Summitt Mindset is SMS-first and retention-first; this text may be their main touch with the product.");
  lines.push("- Aim for a human accountability relationship, not a workflow bot or checklist.");
  lines.push(
    "- Daily SMS should feel like the next beat in a long coaching thread — not a standalone reminder. Use RECENT_EVENTS, RECENT_SMS_CONTEXT, COACHING_MEMORY, blocker preview, silence/reentry numbers, and identity context when present to avoid robotic repetition."
  );
  lines.push(
    "- Pat Summitt principles shape voice (direct, accountable, honest) — do not name-drop Pat as decoration."
  );
  lines.push(
    "- Long-horizon relationship: onboarding profile fields may be older; RECENT_SMS_CONTEXT / COACHING_MEMORY / RECENT_EVENTS can be more current—do not treat USER_ONBOARDING as permanent truth or quote sensitive lines verbatim."
  );
  lines.push(
    "- If context conflicts, prefer recent confirmed SMS patterns over stale onboarding; ask briefly rather than assume."
  );
  lines.push("");
  lines.push("SILENCE_CONTEXT (rule-derived, authoritative numbers):");
  lines.push(
    `tier=${ctx.silence.tier}, unanswered_checks=${ctx.silence.unanswered_checks}, days_since_last_user_outcome=${ctx.silence.days_since_last_user_outcome}`
  );
  lines.push("");
  lines.push("REENTRY_CONTEXT (rule-derived):");
  lines.push(`reentry_active=${ctx.reentry.active}`);
  lines.push("");
  if (ctx.recentSmsContextBlock?.trim()) {
    lines.push(ctx.recentSmsContextBlock.trim());
    lines.push("");
  }
  if (ctx.dailyMessagePurpose === "evolution_pattern_check" && ctx.wave7EvolutionPick) {
    lines.push("EVOLUTION_SIGNAL (advisory only — commitment row is unchanged; you do not apply mutations):");
    lines.push(
      `recommended_direction=${ctx.wave7EvolutionPick.action} (source=${ctx.wave7EvolutionPick.source})`
    );
    if (ctx.wave7EvolutionPick.evidenceSummary?.trim()) {
      lines.push(`evidence_hint: ${truncateOneLine(ctx.wave7EvolutionPick.evidenceSummary, 200)}`);
    }
    lines.push(
      "- Write one short human SMS: invite an honest answer about whether today's bar still fits or needs clarity—no menus, no claim that the commitment was already changed."
    );
    lines.push(
      "- If they want a smaller bar, new goal, or replace: keep it natural; the product routes SMS tighten/replace when they say so—do not output command keywords like STILL/CHANGE/NEW."
    );
    lines.push("");
  }
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
        "This SMS asks whether to keep the same bar steady for about a week; yes accepts, no leaves things as they are; original_behavior_statement stays the anchor."
      );
    } else {
      lines.push(
        "This SMS proposes a smaller temporary ask for 7 days when they accept with yes; saying no keeps the current bar (original_behavior_statement)."
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
      `Preferred name is available for context (${truncateOneLine(ctx.preferredName, 40)}). Do not overuse it. Avoid starting with their name—the server may add a short greeting.`
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
      "USER_ONBOARDING (answered in app at signup/onboarding; may be older—wording and empathy only—never changes cadence, strategy, or commitment rules):"
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
  lines.push("- Clear beats clever. Serious beats hype. Proof beats praise — lightly, when it helps.");
  lines.push("- Hold the standard without shame. Keep it short.");
  lines.push("- This SMS may be the user's primary product experience.");
  lines.push("- Brief, direct, human: no fake hype, no therapy-speak, no robotic command menus.");
  lines.push("- Never instruct with all-caps command tokens (no STILL/CHANGE/KEEP/TIGHTEN/NEW menus).");
  lines.push("- Do not paste raw database phrasing or the full formal behavior_statement when a short natural ask is clearer.");
  lines.push("- Do not include STOP/START/HELP or unsubscribe footer language (consent lives elsewhere).");
  lines.push("- Do not say \"Reply YES\", \"Reply NO\", \"Reply PARTIAL\", or \"Reply STILL/CHANGE\" — invite a natural answer.");
  lines.push("- Sensitive onboarding lines (people_summary, responsibility, family pressure): never quote verbatim; tone only.");
  lines.push(
    "- USER_ONBOARDING may be stale months later—prefer RECENT_EVENTS / COACHING_MEMORY when they clearly contradict onboarding hints."
  );
  lines.push("- Identity anchor: quote verbatim only when identity_reference_allowed_this_send is yes; otherwise do not quote or closely paraphrase.");
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
  lines.push('- standard_check: "Did you get one focused session in today?"');
  lines.push('- recovery_check: "Back to the bar today—did it happen?"');
  lines.push('- silence_nudge: "Good to see you in the thread. Did you protect today\'s commitment?"');
  lines.push('- reentry_check: "You came back yesterday. Same bar today—did it happen?"');
  lines.push('- blocker_followup: "Time keeps showing up as the fight—did you start before it got away?"');
  lines.push('- reactivation_nudge: "No pressure note: if today is a good day to restart <ask>, send a short line."');
  lines.push(
    '- evolution_pattern_check: "Same fight keeps showing up—did today\'s bar happen, or does it need to get clearer?"'
  );

  return lines.join("\n");
}

const SYSTEM_PROMPT = `You are Pat Summitt AI for Summitt Mindset SMS accountability.
Summitt Mindset is SMS-first: this message may be the user's core product experience.
Voice: brief, direct, human, calm — like a sharp coach who remembers yesterday's text and the thread, not a calendar reminder bot.
Sound like the next message in a months-long relationship: reference momentum, blockers, identity, or emotional context when the developer prompt gives it — without inventing facts.
No therapy-speak, no shame, no fake hype, no weak filler ("great job", "keep pushing", "you've got this", "let's aim for", "that's progress").
No compliance footers, no all-caps reply menus, no internal jargon (V2, overlay, event spine, commitment event).
Hold the standard without inventing facts. Output strict JSON only.`;

export async function resolveV2DailyOutboundSmsBody(args: {
  ctx: V2AiOutboundContext;
  contractProposalMode: boolean;
  purpose: V2DailyMessagePurpose;
  templateBody: string;
  effectiveAsk: string;
  behaviorStatement: string;
  nextMoveType: V2NextMoveType;
  shrunkAskText?: string | null;
}): Promise<{
  smsBody: string;
  aiTry: V2AiOutboundAttempt;
  resolution: V2DailyOutboundResolution;
}> {
  const aiTry = await tryGenerateV2OutboundMessage(args.ctx);

  let smsBody: string;
  let source: V2DailyOutboundResolution["daily_reply_source"];
  let aiRejectedReason: string | null = null;

  if (args.contractProposalMode) {
    smsBody = aiTry.ok ? aiTry.message : args.templateBody;
    source = aiTry.ok ? "ai_generated" : "deterministic_human";
    if (!aiTry.ok) aiRejectedReason = aiTry.reason;
  } else if (aiTry.ok) {
    smsBody = aiTry.message;
    source = "ai_generated";
  } else {
    aiRejectedReason = aiTry.reason;
    let human = buildV2HumanDailyFallbackSms({
      purpose: args.purpose,
      effectiveAsk: args.effectiveAsk,
      behaviorStatement: args.behaviorStatement,
      nextMoveType: args.nextMoveType,
      shrunkAskText: args.shrunkAskText ?? null,
      wave7EvolutionPick: args.ctx.wave7EvolutionPick ?? null,
    });
    const safety = validateV2DailyOutboundHumanSafety(human, {
      contractProposalMode: false,
      serverStrategy: args.ctx.serverStrategy,
    });
    if (!safety.ok) {
      human = "Did you do the commitment today?";
      source = "fallback";
    } else {
      source = "deterministic_human";
    }
    smsBody = human;
  }

  if (shouldApplyPhase4DailyOutboundPolish(args.contractProposalMode, args.ctx.serverStrategy)) {
    const memBlock = formatCoachingMemoryPromptBlock(args.ctx.coachingMemory);
    const coachingMemoryPreview =
      memBlock.trim().length > 0 ? truncateOneLine(memBlock.trim(), 480) : undefined;
    const recentSmsContextPreview =
      args.ctx.recentSmsContextBlock?.trim().length
        ? truncateOneLine(args.ctx.recentSmsContextBlock.trim(), 400)
        : undefined;
    const identityAnchorPreview =
      args.ctx.identityReferenceAllowed && args.ctx.identityAnchorText?.trim()
        ? truncateOneLine(args.ctx.identityAnchorText.trim(), 120)
        : undefined;

    const finalized = await finalizeDailyOutboundHumanSms({
      machineDraft: smsBody,
      brainCase: deriveDailyOutboundBrainCase(args.ctx.serverStrategy),
      dailyPurpose: args.purpose,
      serverStrategy: args.ctx.serverStrategy,
      effectiveAskPreview: truncateOneLine(args.effectiveAsk, 120),
      behaviorStatementPreview: truncateOneLine(args.behaviorStatement, 200),
      dailyReplySourcePre: source,
      identityAnchorPreview,
      coachingMemoryPreview,
      recentSmsContextPreview,
      effectiveAskForFallback: args.effectiveAsk.trim(),
      behaviorStatementForFallback: args.behaviorStatement.trim(),
      maxChars: SMS_MAX_LEN,
    });
    smsBody = finalized.message;
  }

  if (shouldApplyPhase5aReactivationOutboundPolish(args.ctx.serverStrategy)) {
    const memBlock5 = formatCoachingMemoryPromptBlock(args.ctx.coachingMemory);
    const coachingMemoryPreview5 =
      memBlock5.trim().length > 0 ? truncateOneLine(memBlock5.trim(), 480) : undefined;
    const recentSmsContextPreview5 =
      args.ctx.recentSmsContextBlock?.trim().length
        ? truncateOneLine(args.ctx.recentSmsContextBlock.trim(), 400)
        : undefined;
    const identityAnchorPreview5 =
      args.ctx.identityReferenceAllowed && args.ctx.identityAnchorText?.trim()
        ? truncateOneLine(args.ctx.identityAnchorText.trim(), 120)
        : undefined;

    const finalized5 = await finalizePhase5aReactivationOutboundHumanSms({
      machineDraft: smsBody,
      dailyPurpose: args.purpose,
      dailyReplySourcePre: source,
      effectiveAskPreview: truncateOneLine(args.effectiveAsk, 120),
      behaviorStatementPreview: truncateOneLine(args.behaviorStatement, 200),
      identityAnchorPreview: identityAnchorPreview5,
      coachingMemoryPreview: coachingMemoryPreview5,
      recentSmsContextPreview: recentSmsContextPreview5,
      effectiveAskForFallback: args.effectiveAsk.trim(),
      behaviorStatementForFallback: args.behaviorStatement.trim(),
      maxChars: SMS_MAX_LEN,
    });
    smsBody = finalized5.message;
  }

  const shortPhrase = getShortCommitmentPhraseForSms({
    effectiveAsk: args.effectiveAsk,
    behaviorStatement: args.behaviorStatement,
  });
  const short_commitment_phrase_used =
    shortPhrase !== "the bar" &&
    smsBody.toLowerCase().includes(shortPhrase.toLowerCase());

  const anchor = args.ctx.identityAnchorText?.trim() ?? "";
  const identity_reference_used = Boolean(
    anchor && args.ctx.identityReferenceAllowed && smsBody.includes(anchor)
  );

  const proof_reference_used =
    args.purpose === "proof_milestone_light" || args.purpose === "after_yes_streak";

  return {
    smsBody,
    aiTry,
    resolution: {
      daily_reply_source: source,
      daily_message_purpose: args.purpose,
      ai_rejected_reason: source === "ai_generated" ? null : aiRejectedReason,
      short_commitment_phrase_used,
      identity_reference_used,
      proof_reference_used,
      evolution_recommendation_used: args.purpose === "evolution_pattern_check",
      evolution_recommended_action:
        args.purpose === "evolution_pattern_check"
          ? args.ctx.wave7EvolutionPick?.action ?? null
          : null,
      blocker_pattern_coaching_used: args.purpose === "repeated_blocker_pattern",
    },
  };
}

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
  dailyResolution?: V2DailyOutboundResolution;
}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    model: args.model,
    prompt_version: args.promptVersion,
    server_state: args.serverState,
    server_strategy: args.serverStrategy,
    message: args.message,
    ...(args.confidence != null ? { confidence: args.confidence } : {}),
    fallback_used: args.fallbackUsed,
    ...(args.fallbackReason && args.fallbackUsed ? { fallback_reason: args.fallbackReason } : {}),
  };
  if (args.dailyResolution) {
    base.daily_reply_source = args.dailyResolution.daily_reply_source;
    base.daily_message_purpose = args.dailyResolution.daily_message_purpose;
    if (args.dailyResolution.ai_rejected_reason) {
      base.ai_rejected_reason = args.dailyResolution.ai_rejected_reason;
    }
    base.short_commitment_phrase_used = args.dailyResolution.short_commitment_phrase_used;
    base.identity_reference_used = args.dailyResolution.identity_reference_used;
    base.proof_reference_used = args.dailyResolution.proof_reference_used;
    if (args.dailyResolution.evolution_recommendation_used != null) {
      base.evolution_recommendation_used = args.dailyResolution.evolution_recommendation_used;
    }
    if (args.dailyResolution.evolution_recommended_action != null) {
      base.evolution_recommended_action = args.dailyResolution.evolution_recommended_action;
    }
    if (args.dailyResolution.blocker_pattern_coaching_used != null) {
      base.blocker_pattern_coaching_used = args.dailyResolution.blocker_pattern_coaching_used;
    }
  }
  return base;
}
