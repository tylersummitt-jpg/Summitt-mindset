/**
 * Bounded SMS goal-adjustment ladder signal — facts only, no mutation (Slice 1).
 */

import type { V2EventRowForAi } from "@/lib/v2-commitment";
import {
  detectSmsPlannedInterruption,
  isPlannedInterruptionActionable,
} from "@/lib/sms-planned-interruption";
import { SMS_SUBSCRIPTION_BILLING_INTEGRITY_RE } from "@/lib/sms-relationship-exit-intent";

export type SmsGoalAdjustmentMove =
  | "keep"
  | "shrink_temporary"
  | "upstream"
  | "tighten_durable"
  | "replace"
  | "raise_bar"
  | "pause_cadence"
  | "resume_after_silence"
  | "subscription_integrity";

export type SmsGoalAdjustmentConfidence = "low" | "medium" | "high";

export type SmsGoalAdjustmentCompatibleFlow =
  | "overlay"
  | "pending_replace"
  | "pending_tighten"
  | "evolution_hint"
  | "none";

export type SmsGoalAdjustmentSignalResult = {
  move: SmsGoalAdjustmentMove;
  confidence: SmsGoalAdjustmentConfidence;
  mentionAllowed: boolean;
  internalHint: string | null;
  requiresUserConfirmation: boolean;
  compatibleFlow: SmsGoalAdjustmentCompatibleFlow;
  doNotRepeatKey: string | null;
};

const MS_DAY = 86400000;

const SHRINK_PATTERN_CANONICALS = new Set([
  "avoidance_getting_started",
  "time_pressure",
  "work_pressure",
  "late_bedtime_upstream",
  "phone_pull",
]);

const UPSTREAM_PATTERN_CANONICALS = new Set([
  "late_bedtime_upstream",
  "avoidance_getting_started",
  "phone_pull",
]);

const REPLACE_EXPLICIT_RE =
  /\b(change\s+my\s+goal|new\s+goal|different\s+goal|this\s+goal\s+is\s+wrong|replace\s+(my\s+)?goal|switch\s+(my\s+)?goal|goal\s+is\s+wrong)\b/i;

const TIGHTEN_DURABLE_RE =
  /\b(make\s+it\s+tighter|tighten\s+(the\s+)?goal|make\s+it\s+clearer|clearer\s+goal|smaller\s+permanently|permanently\s+smaller|permanent(ly)?\s+(smaller|lower|tighter))\b/i;

const RAISE_BAR_RE =
  /\b(too\s+easy|want\s+more|raise\s+the\s+bar|make\s+it\s+harder|ready\s+for\s+more|increase\s+the\s+bar|harder\s+bar|bigger\s+challenge)\b/i;

const PAUSE_CADENCE_RE =
  /\b(vacation|on\s+a\s+trip|traveling|travelling|family\s+emergency|pause\s+texts|stop\s+for\s+a\s+few\s+days|text\s+me\s+less|next\s+week)\b/i;

const PAUSE_SICK_TRAVEL_RE = /\b(sick|illness|ill\b|flu|fever)\b/i;

const STOP_COMPLIANCE_ONLY_RE = /^\s*(stop|unsubscribe|cancel|end|quit)\s*$/i;

export type DeriveSmsGoalAdjustmentSignalArgs = {
  eventsNewestFirst: V2EventRowForAi[];
  coachingMemory?: {
    latest_blocker_preview?: string | null;
    blocker_tags?: string[] | null;
    do_not_repeat_phrases?: Array<string | { phrase?: string }> | null;
    coaching_summary?: string | null;
    yes_streak_14d?: number | null;
  } | null;
  patternSignal?: {
    canonical?: string | null;
    confidence?: "low" | "medium" | "high" | null;
    mentionAllowed?: boolean | null;
    count14d?: number | null;
    count21d?: number | null;
  } | null;
  overlayState?: {
    proposalPending?: boolean;
    overlayActive?: boolean;
    effectiveAskDiffers?: boolean;
    shrinkMeaningful?: boolean;
  } | null;
  pendingResolution?: {
    kind?: string | null;
    sms_state?: string | null;
  } | null;
  evolutionEval?: {
    recommended_action?: string | null;
  } | null;
  silenceContext?: {
    isReentry?: boolean;
    silenceDays?: number | null;
    phase?: string | null;
  } | null;
  inboundRaw?: string | null;
  nowMs?: number;
};

function parseEventMs(occurredAt?: string | null, createdAt?: string | null): number {
  const raw = (occurredAt ?? createdAt ?? "").trim();
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function countNegOutcomes14d(events: V2EventRowForAi[], nowMs: number): number {
  const cutoff = nowMs - 14 * MS_DAY;
  let n = 0;
  for (const e of events) {
    if (e.event_type !== "user_no" && e.event_type !== "user_partial") continue;
    const t = parseEventMs(
      e.occurred_at,
      "created_at" in e ? (e as { created_at?: string }).created_at : null
    );
    if (t >= cutoff && t <= nowMs) n += 1;
  }
  return n;
}

function countYesOutcomes7d(events: V2EventRowForAi[], nowMs: number): number {
  const cutoff = nowMs - 7 * MS_DAY;
  let n = 0;
  for (const e of events) {
    if (e.event_type !== "user_yes") continue;
    const t = parseEventMs(
      e.occurred_at,
      "created_at" in e ? (e as { created_at?: string }).created_at : null
    );
    if (t >= cutoff && t <= nowMs) n += 1;
  }
  return n;
}

function collectDoNotRepeatStrings(args: DeriveSmsGoalAdjustmentSignalArgs): string {
  const parts: string[] = [];
  const raw = args.coachingMemory?.do_not_repeat_phrases;
  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (typeof p === "string" && p.trim()) parts.push(p.trim());
      else if (p && typeof p === "object" && "phrase" in p) {
        const phrase = (p as { phrase?: unknown }).phrase;
        if (typeof phrase === "string" && phrase.trim()) parts.push(phrase.trim());
      }
    }
  }
  const summary = (args.coachingMemory?.coaching_summary ?? "").trim();
  if (summary) parts.push(summary);
  return parts.join(" ").toLowerCase();
}

function isMentionSuppressed(doNotRepeatKey: string | null, combinedLower: string): boolean {
  if (!doNotRepeatKey) return false;
  if (combinedLower.includes(doNotRepeatKey.toLowerCase())) return true;
  if (combinedLower.includes("goal_adjustment_mention")) return true;
  return false;
}

function patternMediumPlus(
  pattern: DeriveSmsGoalAdjustmentSignalArgs["patternSignal"],
  canonicals?: Set<string>
): boolean {
  if (!pattern?.canonical) return false;
  if (canonicals && !canonicals.has(pattern.canonical)) return false;
  return pattern.confidence === "medium" || pattern.confidence === "high";
}

function defaultResult(): SmsGoalAdjustmentSignalResult {
  return {
    move: "keep",
    confidence: "low",
    mentionAllowed: false,
    internalHint: null,
    requiresUserConfirmation: false,
    compatibleFlow: "none",
    doNotRepeatKey: null,
  };
}

function finalize(
  partial: Omit<SmsGoalAdjustmentSignalResult, "doNotRepeatKey"> & { doNotRepeatKey?: string | null },
  args: DeriveSmsGoalAdjustmentSignalArgs
): SmsGoalAdjustmentSignalResult {
  const doNotRepeatKey =
    partial.doNotRepeatKey ?? (partial.move !== "keep" ? `goal_adjustment_${partial.move}_prompt` : null);
  let mentionAllowed = partial.mentionAllowed;
  if (isMentionSuppressed(doNotRepeatKey, collectDoNotRepeatStrings(args))) {
    mentionAllowed = false;
  }
  return { ...partial, doNotRepeatKey, mentionAllowed };
}

export function deriveSmsGoalAdjustmentSignal(
  args: DeriveSmsGoalAdjustmentSignalArgs
): SmsGoalAdjustmentSignalResult {
  const nowMs = args.nowMs ?? Date.now();
  const inbound = (args.inboundRaw ?? "").trim();
  const overlay = args.overlayState ?? {};
  const pending = args.pendingResolution ?? {};
  const evolutionAction = (args.evolutionEval?.recommended_action ?? "").trim();
  const pattern = args.patternSignal ?? null;
  const neg14 = countNegOutcomes14d(args.eventsNewestFirst, nowMs);
  const yes7 = countYesOutcomes7d(args.eventsNewestFirst, nowMs);
  const yesStreak14 = args.coachingMemory?.yes_streak_14d ?? 0;

  const pendingActive =
    Boolean(pending.kind) &&
    pending.sms_state !== "confirmed" &&
    pending.sms_state !== "cancelled";

  if (overlay.overlayActive) {
    return finalize(
      {
        move: "keep",
        confidence: "low",
        mentionAllowed: false,
        internalHint: "active adaptive overlay; hold standard on base commitment",
        requiresUserConfirmation: false,
        compatibleFlow: "none",
      },
      args
    );
  }

  if (pendingActive) {
    const flow: SmsGoalAdjustmentCompatibleFlow =
      pending.kind === "commitment_replace"
        ? "pending_replace"
        : pending.kind === "commitment_tighten"
          ? "pending_tighten"
          : "none";
    return finalize(
      {
        move: "keep",
        confidence: "medium",
        mentionAllowed: false,
        internalHint: `pending_resolution_active:${pending.kind ?? "unknown"}`,
        requiresUserConfirmation: false,
        compatibleFlow: flow,
      },
      args
    );
  }

  if (inbound && STOP_COMPLIANCE_ONLY_RE.test(inbound)) {
    return defaultResult();
  }

  if (inbound && SMS_SUBSCRIPTION_BILLING_INTEGRITY_RE.test(inbound)) {
    return finalize(
      {
        move: "subscription_integrity",
        confidence: "high",
        mentionAllowed: true,
        internalHint: "subscription_integrity: billing/cancel language (not SMS STOP)",
        requiresUserConfirmation: false,
        compatibleFlow: "none",
      },
      args
    );
  }

  if (inbound) {
    const planned = detectSmsPlannedInterruption(inbound);
    if (isPlannedInterruptionActionable(planned)) {
      return finalize(
        {
          move: "pause_cadence",
          confidence: planned.confidence === "high" ? "high" : "medium",
          mentionAllowed: true,
          internalHint: "planned_interruption: do not score as failure",
          requiresUserConfirmation: true,
          compatibleFlow: "none",
        },
        args
      );
    }
  }

  if (inbound && (PAUSE_CADENCE_RE.test(inbound) || PAUSE_SICK_TRAVEL_RE.test(inbound))) {
    return finalize(
      {
        move: "pause_cadence",
        confidence: "high",
        mentionAllowed: true,
        internalHint: "planned_interruption: do not score as failure",
        requiresUserConfirmation: true,
        compatibleFlow: "none",
      },
      args
    );
  }

  const silenceDays = args.silenceContext?.silenceDays ?? 0;
  if (args.silenceContext?.isReentry === true || silenceDays >= 7) {
    return finalize(
      {
        move: "resume_after_silence",
        confidence: silenceDays >= 7 ? "medium" : "low",
        mentionAllowed: args.silenceContext?.isReentry === true,
        internalHint: "resume_after_silence: comeback framing, not failure",
        requiresUserConfirmation: false,
        compatibleFlow: "none",
      },
      args
    );
  }

  const explicitReplace = inbound ? REPLACE_EXPLICIT_RE.test(inbound) : false;
  const explicitTighten = inbound ? TIGHTEN_DURABLE_RE.test(inbound) : false;
  const explicitRaise = inbound ? RAISE_BAR_RE.test(inbound) : false;

  if (explicitReplace || evolutionAction === "replace_commitment") {
    const conf: SmsGoalAdjustmentConfidence =
      explicitReplace || evolutionAction === "replace_commitment" ? "high" : "medium";
    return finalize(
      {
        move: "replace",
        confidence: conf,
        mentionAllowed: explicitReplace,
        internalHint: explicitReplace
          ? "replace: explicit user goal-change language"
          : "replace: evolution_hint replace_commitment (no auto mutation)",
        requiresUserConfirmation: true,
        compatibleFlow: explicitReplace ? "pending_replace" : "evolution_hint",
      },
      args
    );
  }

  if (explicitTighten || evolutionAction === "tighten_commitment") {
    return finalize(
      {
        move: "tighten_durable",
        confidence: explicitTighten ? "high" : "medium",
        mentionAllowed: explicitTighten || evolutionAction === "tighten_commitment",
        internalHint: explicitTighten
          ? "tighten_durable: explicit durable bar language"
          : "tighten_durable: evolution_hint tighten_commitment",
        requiresUserConfirmation: true,
        compatibleFlow: explicitTighten ? "pending_tighten" : "evolution_hint",
      },
      args
    );
  }

  const raiseEvidence = yes7 >= 5 || yesStreak14 >= 5;
  if (raiseEvidence && explicitRaise) {
    return finalize(
      {
        move: "raise_bar",
        confidence: "high",
        mentionAllowed: true,
        internalHint: `raise_bar: success streak (yes7=${yes7}, streak14=${yesStreak14}) + user ready for more`,
        requiresUserConfirmation: true,
        compatibleFlow: "pending_replace",
      },
      args
    );
  }

  if (patternMediumPlus(pattern, UPSTREAM_PATTERN_CANONICALS)) {
    return finalize(
      {
        move: "upstream",
        confidence: pattern!.confidence === "high" ? "high" : "medium",
        mentionAllowed: true,
        internalHint: `upstream: pattern ${pattern!.canonical} recurrence`,
        requiresUserConfirmation: true,
        compatibleFlow: "evolution_hint",
      },
      args
    );
  }

  const shrinkPatternOk = patternMediumPlus(pattern, SHRINK_PATTERN_CANONICALS);
  const shrinkMissOk = neg14 >= 2;
  const proposalBlocked = overlay.proposalPending === true;
  const shrinkMeaningful = overlay.shrinkMeaningful !== false;

  if (!proposalBlocked && shrinkMeaningful && (shrinkMissOk || shrinkPatternOk)) {
    const mediumPlus = shrinkPatternOk || (shrinkMissOk && shrinkPatternOk);
    let conf: SmsGoalAdjustmentConfidence = "low";
    if (mediumPlus && shrinkPatternOk && pattern?.confidence === "high") conf = "high";
    else if (mediumPlus) conf = "medium";

    return finalize(
      {
        move: "shrink_temporary",
        confidence: conf,
        mentionAllowed: conf !== "low",
        internalHint: `shrink_temporary: neg14=${neg14} pattern=${pattern?.canonical ?? "none"}`,
        requiresUserConfirmation: true,
        compatibleFlow: "overlay",
      },
      args
    );
  }

  return defaultResult();
}

/** Daily overlay proposal gate: shrink only when ladder agrees medium+ temporary shrink. */
export function smsGoalAdjustmentShrinkOverlayEligible(
  signal: SmsGoalAdjustmentSignalResult
): boolean {
  return (
    signal.move === "shrink_temporary" &&
    (signal.confidence === "medium" || signal.confidence === "high") &&
    signal.compatibleFlow === "overlay"
  );
}

export function buildSmsGoalAdjustmentLaneGuardrails(): string {
  return `
GOAL_ADJUSTMENT (when goal_adjustment_* present): background ladder guidance only — not permission to mutate.
- When goal_adjustment_mention_allowed is false, do NOT propose changing the commitment or offer a new commitment target.
- After a miss, ask what got in the way or what blocked the plan before any adjustment language.
- Do not say the goal changed unless existing server state already shows it changed.
- Mutating moves require user confirmation through existing flows (overlay YES/NO, pending resolution, guided app).
- If goal_adjustment_move is pause_cadence, do not shame planned interruption as failure.
- If goal_adjustment_move is raise_bar, frame as an invitation to discuss raising the bar — not a command to change the goal.
- Current Goal / effective ask remains primary; do not add extra YES/NO menus beyond what the route already requires.`;
}
