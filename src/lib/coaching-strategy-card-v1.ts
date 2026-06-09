/**
 * Phase 4.1 — Coaching Strategy Card v1 (inbound normal only).
 * Server-built coaching move envelope; writer-facing after validation/repair.
 * Does not route, mutate state, send SMS, or replace Relationship Snapshot.
 */

import type { MissAdjustmentPolicyResult } from "@/lib/inbound-miss-adjustment-policy";
import {
  inboundUserRequestedGoalAdjustment,
  isMissRecoveryTurn,
} from "@/lib/inbound-miss-adjustment-policy";
import type { InboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import type { ReconciledTurnUnderstanding } from "@/lib/openai-relationship-turn-understanding-v1";
import type { ProofAndPraisePermissionV2Data } from "@/lib/sms-proof-praise-permission-v2";
import type { OpenLoopsAndDoNotRepeatData } from "@/lib/sms-open-loops-and-do-not-repeat";
import type { NoSendAndSilenceHistoryV2Data } from "@/lib/sms-no-send-and-silence-history-v2";
import type { ActivePendingState } from "@/lib/sms-active-pending-state";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";

export const STRATEGY_CARD_V1_VERSION = "1.0" as const;

export type StrategyCardSurface = "inbound";
export type StrategyCardRouteKind = "normal_inbound_reply";

export type StrategyCardOutcome = "completed" | "missed" | "partial" | "none" | "unclear";

export type StrategyCardMoveType =
  | "ask_blocker"
  | "ack_completion"
  | "ack_partial"
  | "recover_today"
  | "clarify"
  | "close_loop"
  | "protect_existing_plan"
  | "propose_adjustment"
  | "evaluate_commitment"
  | "raise_standard"
  | "reactivate_gently"
  | "handoff"
  | "other";

export type StrategyCardTonePosture =
  | "direct"
  | "warm_direct"
  | "gentle_reentry"
  | "celebrate_earned"
  | "low_pressure"
  | "clarifying";

export type StrategyCardV1 = {
  version: typeof STRATEGY_CARD_V1_VERSION;
  generated_at: string;
  surface: StrategyCardSurface;
  route_kind: StrategyCardRouteKind;
  turn_kind: string;
  server_truth_summary: {
    outcome: StrategyCardOutcome;
    explicit_user_truth: boolean;
    persistence_decision?: string | null;
    active_pending_kinds: string[];
    answered_last_question?: boolean | null;
    satisfied_ask_fingerprints: string[];
  };
  move: {
    type: StrategyCardMoveType;
    priority: "low" | "normal" | "high";
    confidence: "low" | "medium" | "high";
    reason: string;
  };
  must_do: string[];
  must_not_do: string[];
  allowed_claims: {
    completion: boolean;
    miss: boolean;
    partial: boolean;
    proof: boolean;
    victory_room: boolean;
    state_changed: boolean;
    proposal_active: boolean;
  };
  writer_constraints: {
    max_questions: number;
    avoid_repeating: string[];
    tone_posture: StrategyCardTonePosture;
  };
  meta: {
    generation_source: "server_strategy_card_v1";
    legacy_suggested_coaching_move?: string | null;
    legacy_coaching_move_source?: string | null;
    legacy_hint_used?: boolean;
    legacy_hint_replaced?: boolean;
  };
};

export type StrategyCardValidationStatus = "valid" | "repaired";

export type StrategyCardBuildContext = {
  facts: InboundV3RelationshipFacts;
  proofPermission: ProofAndPraisePermissionV2Data;
  openLoops: OpenLoopsAndDoNotRepeatData;
  activePending: ActivePendingState;
  noSendSilence: NoSendAndSilenceHistoryV2Data | null;
  shortAnswerPlanAck?: boolean;
};

export type StrategyCardValidationResult = {
  card: StrategyCardV1;
  validation_status: StrategyCardValidationStatus;
  validation_reasons: string[];
};

const MAX_REASON_CHARS = 200;
const MAX_MUST_DO = 5;
const MAX_MUST_NOT_DO = 8;
const MAX_AVOID_REPEATING = 10;
const MAX_FINGERPRINT_CHARS = 120;

const SINGLE_MISS_FORBIDDEN_MOVES: StrategyCardMoveType[] = [
  "propose_adjustment",
  "evaluate_commitment",
  "raise_standard",
];

const SMS_COPY_RE = /\b(hey|hi|thanks|thank you|great job|you've got this)\b/i;

export function isInboundNormalStrategyCardEligible(facts: InboundV3RelationshipFacts): boolean {
  if (facts.route_purpose !== "normal_inbound_reply") return false;
  if (facts.blocker_facts) return false;
  if (facts.refresh_facts) return false;
  if (facts.pending_resolution_facts) return false;
  if (facts.memory_confirmation_facts) return false;
  if (facts.contract_consent_facts) return false;
  if (facts.adaptive_consent_clarification_facts) return false;
  if (facts.commitment_change_facts) return false;
  if (facts.commitment_change_context_facts) return false;
  if (facts.central_brain_pivot_facts) return false;
  if (facts.central_brain_blocker_pivot_facts) return false;
  if (facts.arc_clarification_facts) return false;
  if (facts.open_question_facts) return false;
  if (facts.pending_replacement_facts?.pending_resolution_active === true) return false;
  if (facts.identity_edit) return false;
  if (facts.relationship_exit) return false;
  return true;
}

function truncateText(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function fingerprintAsk(text: string): string {
  return truncateText(text, MAX_FINGERPRINT_CHARS);
}

function deriveOutcome(facts: InboundV3RelationshipFacts): StrategyCardOutcome {
  const meaning = facts.inbound_meaning;
  const ft = facts.v2_accountability.final_event_type;
  if (ft === "user_yes" || meaning?.persistence_decision === "write_user_yes_today") return "completed";
  if (ft === "user_no" || meaning?.persistence_decision === "write_user_no") return "missed";
  if (ft === "user_partial" || meaning?.persistence_decision === "write_user_partial") return "partial";
  const rm = meaning?.relationship_meaning;
  if (rm === "reported_completion") return "completed";
  if (rm === "miss") return "missed";
  if (rm === "partial_attempt") return "partial";
  return "unclear";
}

function isPlanAckTurn(args: {
  facts: InboundV3RelationshipFacts;
  tu: ReconciledTurnUnderstanding | null | undefined;
  shortAnswerPlanAck?: boolean;
}): boolean {
  if (args.shortAnswerPlanAck === true) return true;
  const intent = args.tu?.reconciled_response_intent;
  if (intent === "reinforce_plan_without_proof") return true;
  const smsIntent = args.facts.inbound_meaning?.sms_response_intent;
  return smsIntent === "reinforce_plan_and_choose_first_step";
}

function blockerAlreadyKnown(facts: InboundV3RelationshipFacts): boolean {
  if (facts.v2_accountability.blocker_signal === true) return true;
  const rm = facts.inbound_meaning?.relationship_meaning;
  if (rm === "miss" || rm === "partial_attempt") {
    const raw = facts.thread.coalesced_inbound_text.trim();
    if (raw.length >= 20 && /\b(because|blocked|couldn't|could not|kid|meeting|travel|sick)\b/i.test(raw)) {
      return true;
    }
  }
  const tu = facts.turn_understanding;
  if (tu?.reconciled_response_intent === "identify_blocker" && tu.confidence >= 0.6) {
    const raw = facts.thread.coalesced_inbound_text.trim();
    if (raw.length >= 15) return true;
  }
  return false;
}

function mapLegacyMoveToType(legacy: string | null | undefined): StrategyCardMoveType | null {
  const m = legacy?.trim();
  if (!m) return null;
  if (m === "name_blocker" || m === "narrow_blocker") return "ask_blocker";
  if (m === "acknowledge_completion" || m === "acknowledge_result_and_next_standard") return "ack_completion";
  if (m === "clarify_intent" || m === "clarify_ambiguous_short_natural_sms") return "clarify";
  if (m === "close_loop_no_new_action" || m === "acknowledge_prior_ask_satisfied") return "close_loop";
  if (m === "next_first_step" || m === "reinforce_plan_without_proof") return "protect_existing_plan";
  if (m === "respond_commitment_change_context_without_pending_resolution") return "evaluate_commitment";
  if (m === "commitment_change_handoff_respond_with_server_owned_next_steps") return "handoff";
  if (m === "ask_accountability") return "other";
  if (m.includes("adjust") || m.includes("proposal")) return "propose_adjustment";
  return "other";
}

function resolveTonePosture(args: {
  moveType: StrategyCardMoveType;
  noSendSilence: NoSendAndSilenceHistoryV2Data | null;
  canCelebrate: boolean;
}): StrategyCardTonePosture {
  const hint = args.noSendSilence?.silence_context?.writer_tone_hint?.toLowerCase() ?? "";
  if (hint.includes("gentle re-entry")) return "gentle_reentry";
  if (hint.includes("low-pressure")) return "low_pressure";
  if (args.moveType === "clarify") return "clarifying";
  if (args.moveType === "ack_completion" && args.canCelebrate) return "celebrate_earned";
  if (args.moveType === "ack_completion" || args.moveType === "ack_partial") return "warm_direct";
  return "direct";
}

function collectAvoidRepeating(ctx: StrategyCardBuildContext): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    const f = fingerprintAsk(t);
    const key = f.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };
  for (const s of ctx.openLoops.satisfied_asks ?? []) {
    if (s.ask_text?.trim()) push(s.ask_text);
  }
  for (const a of ctx.openLoops.do_not_repeat_asks ?? []) push(a);
  for (const a of ctx.facts.turn_understanding?.reconciled_do_not_repeat_asks ?? []) push(a);
  for (const p of ctx.openLoops.do_not_repeat_phrases ?? []) push(p);
  return out.slice(0, MAX_AVOID_REPEATING);
}

function activePendingKinds(activePending: ActivePendingState): string[] {
  return activePending.items.filter((i) => i.active).map((i) => i.kind);
}

function proposalActive(activePending: ActivePendingState, facts: InboundV3RelationshipFacts): boolean {
  const kinds = activePendingKinds(activePending);
  if (kinds.some((k) => k === "contract_proposal" || k === "adaptive_proposal")) return true;
  return Boolean(facts.v2_accountability.goal_adjustment_mention_allowed);
}

function selectMoveType(ctx: StrategyCardBuildContext): {
  type: StrategyCardMoveType;
  reason: string;
  confidence: "low" | "medium" | "high";
} {
  const { facts } = ctx;
  const policy = facts.miss_adjustment_policy;
  const tu = facts.turn_understanding;
  const outcome = deriveOutcome(facts);
  const planAck = isPlanAckTurn({ facts, tu, shortAnswerPlanAck: ctx.shortAnswerPlanAck });
  const blockerKnown = blockerAlreadyKnown(facts);
  const adjustmentRequested = inboundUserRequestedGoalAdjustment(facts.thread.coalesced_inbound_text);
  const adjustmentAllowed = policy?.adjustment_proposal_allowed_by_evidence === true;

  if (planAck) {
    return {
      type: tu?.last_ask_satisfied === "yes" ? "close_loop" : "protect_existing_plan",
      reason: "User acknowledged a forward plan — protect the plan, not an outcome triad.",
      confidence: "high",
    };
  }

  if (policy?.single_miss_recovery_required === true) {
    if (blockerKnown) {
      return {
        type: "recover_today",
        reason: "Single miss with blocker context — recover today without changing the commitment.",
        confidence: "high",
      };
    }
    return {
      type: "ask_blocker",
      reason: "Single miss recovery — ask what got in the way before any adjustment talk.",
      confidence: "high",
    };
  }

  if (outcome === "completed") {
    return {
      type: "ack_completion",
      reason: "Server truth shows explicit completion on this turn.",
      confidence: "high",
    };
  }

  if (outcome === "partial") {
    return {
      type: blockerKnown ? "recover_today" : "ack_partial",
      reason: blockerKnown
        ? "Partial with blocker detail — acknowledge partial and recover forward."
        : "Server truth shows partial — acknowledge honestly without calling it full completion.",
      confidence: "medium",
    };
  }

  if (outcome === "missed") {
    if (blockerKnown) {
      return {
        type: "recover_today",
        reason: "Miss with blocker detail already present — recover, do not re-ask what blocked.",
        confidence: "high",
      };
    }
    return {
      type: "ask_blocker",
      reason: "Miss turn — identify what got in the way.",
      confidence: "high",
    };
  }

  if (adjustmentRequested) {
    if (adjustmentAllowed) {
      return {
        type: "evaluate_commitment",
        reason: "User asked to change the bar — evaluate with confirmation, not a unilateral change.",
        confidence: "medium",
      };
    }
    return {
      type: "clarify",
      reason: "Adjustment language without evidence permission — clarify intent without proposing a new commitment.",
      confidence: "medium",
    };
  }

  const tuIntent = tu?.reconciled_response_intent;
  if (tuIntent === "unclear_clarify") {
    return { type: "clarify", reason: "Turn understanding requests gentle clarification.", confidence: "medium" };
  }
  if (tuIntent === "close_loop_no_new_action" || tuIntent === "acknowledge_prior_ask_satisfied") {
    return { type: "close_loop", reason: "Prior ask satisfied — close the loop.", confidence: "high" };
  }
  if (tuIntent === "acknowledge_completion") {
    return { type: "ack_completion", reason: "Turn understanding acknowledges completion.", confidence: "high" };
  }
  if (tuIntent === "tell_truth_and_recover" || tuIntent === "identify_blocker") {
    return {
      type: blockerKnown ? "recover_today" : "ask_blocker",
      reason: "Recovery or blocker intent from turn understanding.",
      confidence: "medium",
    };
  }

  const legacyType = mapLegacyMoveToType(facts.suggested_coaching_move);
  if (legacyType) {
    return {
      type: legacyType,
      reason: `Consolidated from legacy suggested_coaching_move (${facts.suggested_coaching_move}).`,
      confidence: "medium",
    };
  }

  if (facts.v2_accountability.gated_mode === "clarify") {
    return { type: "clarify", reason: "Classifier gated to clarify.", confidence: "medium" };
  }

  return { type: "other", reason: "Default accountability continuity for this turn.", confidence: "low" };
}

function buildMustDoMustNotDo(args: {
  moveType: StrategyCardMoveType;
  ctx: StrategyCardBuildContext;
  policy: MissAdjustmentPolicyResult | null | undefined;
  planAck: boolean;
  blockerKnown: boolean;
}): { must_do: string[]; must_not_do: string[] } {
  const must_do: string[] = [];
  const must_not_do: string[] = [];
  const pendingKinds = activePendingKinds(args.ctx.activePending);

  if (args.policy?.single_miss_recovery_required) {
    must_do.push("Ask one honest recovery or blocker question.");
    must_not_do.push("Do not propose changing the commitment or offer a new commitment target.");
  }

  if (args.planAck) {
    must_do.push("Acknowledge the plan confirmation briefly.");
    must_not_do.push("Do not treat plan acknowledgment as completion, miss, partial, or proof.");
    must_not_do.push("Do not ask what got in the way as if this were a miss.");
  }

  if (args.moveType === "ack_completion") {
    must_do.push("Acknowledge the reported completion honestly.");
    must_not_do.push("Do not call it proof or Victory Room unless allowed_claims permit.");
  }

  if (args.moveType === "ack_partial") {
    must_do.push("Acknowledge partial honestly.");
    must_not_do.push("Do not call it full completion.");
  }

  if (args.blockerKnown && args.moveType === "recover_today") {
    must_not_do.push("Do not ask again what got in the way — user already named it.");
  }

  if (pendingKinds.length > 0) {
    must_not_do.push("Do not claim pending items are resolved, applied, or closed.");
  }

  if (args.ctx.openLoops.satisfied_asks?.length) {
    must_not_do.push("Do not re-ask satisfied asks from open_loops.");
  }

  return {
    must_do: must_do.slice(0, MAX_MUST_DO),
    must_not_do: [...new Set(must_not_do)].slice(0, MAX_MUST_NOT_DO),
  };
}

function buildAllowedClaims(ctx: StrategyCardBuildContext, outcome: StrategyCardOutcome): StrategyCardV1["allowed_claims"] {
  const p = ctx.proofPermission;
  const planAck = isPlanAckTurn({
    facts: ctx.facts,
    tu: ctx.facts.turn_understanding,
    shortAnswerPlanAck: ctx.shortAnswerPlanAck,
  });

  if (planAck) {
    return {
      completion: false,
      miss: false,
      partial: false,
      proof: false,
      victory_room: false,
      state_changed: false,
      proposal_active: proposalActive(ctx.activePending, ctx.facts),
    };
  }

  return {
    completion: outcome === "completed" && p.can_claim_completion,
    miss: outcome === "missed" && p.can_claim_miss,
    partial: outcome === "partial" && p.can_claim_partial,
    proof: p.can_claim_proof,
    victory_room: p.can_reference_victory_room,
    state_changed: false,
    proposal_active: proposalActive(ctx.activePending, ctx.facts),
  };
}

export function buildInboundNormalStrategyCardV1(args: {
  ctx: StrategyCardBuildContext;
  generatedAt?: string;
}): StrategyCardV1 {
  const { ctx } = args;
  const { facts } = ctx;
  const outcome = deriveOutcome(facts);
  const planAck = isPlanAckTurn({ facts, tu: facts.turn_understanding, shortAnswerPlanAck: ctx.shortAnswerPlanAck });
  const blockerKnown = blockerAlreadyKnown(facts);
  const selected = selectMoveType(ctx);
  const legacyType = mapLegacyMoveToType(facts.suggested_coaching_move);
  const legacyUsed =
    legacyType != null && legacyType === selected.type && !SINGLE_MISS_FORBIDDEN_MOVES.includes(selected.type);
  const legacyReplaced =
    legacyType != null && legacyType !== selected.type && facts.suggested_coaching_move?.trim();

  const { must_do, must_not_do } = buildMustDoMustNotDo({
    moveType: selected.type,
    ctx,
    policy: facts.miss_adjustment_policy,
    planAck,
    blockerKnown,
  });

  const avoid_repeating = collectAvoidRepeating(ctx);
  const satisfiedFingerprints = (ctx.openLoops.satisfied_asks ?? []).map((s) =>
    fingerprintAsk(s.ask_text ?? "")
  );

  const allowed = buildAllowedClaims(ctx, outcome);
  const canCelebrate = allowed.completion && ctx.proofPermission.can_praise_consistency;

  const turnKind =
    facts.v2_accountability.final_event_type ??
    facts.inbound_meaning?.relationship_meaning ??
    facts.turn_understanding?.reconciled_response_intent ??
    "unknown";

  return {
    version: STRATEGY_CARD_V1_VERSION,
    generated_at: args.generatedAt ?? new Date().toISOString(),
    surface: "inbound",
    route_kind: "normal_inbound_reply",
    turn_kind: String(turnKind),
    server_truth_summary: {
      outcome,
      explicit_user_truth: outcome !== "unclear" && outcome !== "none",
      persistence_decision: facts.inbound_meaning?.persistence_decision ?? null,
      active_pending_kinds: activePendingKinds(ctx.activePending),
      answered_last_question:
        facts.turn_understanding?.last_ask_satisfied === "yes" ||
        facts.thread.short_ack_should_not_reask_question ||
        null,
      satisfied_ask_fingerprints: satisfiedFingerprints.filter(Boolean).slice(0, MAX_AVOID_REPEATING),
    },
    move: {
      type: selected.type,
      priority: selected.confidence === "high" ? "high" : "normal",
      confidence: selected.confidence,
      reason: truncateText(selected.reason, MAX_REASON_CHARS),
    },
    must_do,
    must_not_do,
    allowed_claims: allowed,
    writer_constraints: {
      max_questions: selected.type === "clarify" ? 1 : 1,
      avoid_repeating,
      tone_posture: resolveTonePosture({
        moveType: selected.type,
        noSendSilence: ctx.noSendSilence,
        canCelebrate,
      }),
    },
    meta: {
      generation_source: "server_strategy_card_v1",
      legacy_suggested_coaching_move: facts.suggested_coaching_move ?? null,
      legacy_coaching_move_source: facts.coaching_move_source ?? null,
      legacy_hint_used: legacyUsed || undefined,
      legacy_hint_replaced: legacyReplaced ? true : undefined,
    },
  };
}

export function validateInboundNormalStrategyCardV1(
  card: StrategyCardV1,
  ctx: StrategyCardBuildContext
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const policy = ctx.facts.miss_adjustment_policy;
  const outcome = card.server_truth_summary.outcome;

  if (policy?.single_miss_recovery_required && SINGLE_MISS_FORBIDDEN_MOVES.includes(card.move.type)) {
    reasons.push("single_miss_forbidden_move");
  }

  if (!policy?.adjustment_proposal_allowed_by_evidence && card.move.type === "propose_adjustment") {
    reasons.push("adjustment_not_allowed");
  }

  if (!policy?.adjustment_proposal_allowed_by_evidence && card.move.type === "evaluate_commitment") {
    const requested = inboundUserRequestedGoalAdjustment(ctx.facts.thread.coalesced_inbound_text);
    if (!requested) reasons.push("evaluate_without_permission");
  }

  if (card.allowed_claims.proof && !ctx.proofPermission.can_claim_proof) {
    reasons.push("proof_not_permitted");
  }
  if (card.allowed_claims.victory_room && !ctx.proofPermission.can_reference_victory_room) {
    reasons.push("victory_room_not_permitted");
  }
  if (card.allowed_claims.completion && !ctx.proofPermission.can_claim_completion && outcome !== "completed") {
    reasons.push("completion_claim_mismatch");
  }
  if (card.allowed_claims.completion && outcome !== "completed") {
    reasons.push("completion_without_outcome");
  }
  if (card.allowed_claims.miss && outcome !== "missed") {
    reasons.push("miss_without_outcome");
  }
  if (card.allowed_claims.partial && outcome !== "partial") {
    reasons.push("partial_without_outcome");
  }

  if (card.allowed_claims.state_changed) {
    reasons.push("state_changed_not_supported_v1");
  }

  for (const item of card.must_do) {
    if (SMS_COPY_RE.test(item) && item.length > 80) {
      reasons.push("sms_copy_in_must_do");
    }
  }

  if (card.move.reason.length > MAX_REASON_CHARS) {
    reasons.push("reason_too_long");
  }

  if (card.writer_constraints.max_questions > 1 && card.move.type !== "clarify") {
    reasons.push("max_questions_exceeded");
  }

  const pendingKinds = activePendingKinds(ctx.activePending);
  if (
    pendingKinds.length > 0 &&
    !card.must_not_do.some((m) => /pending|resolved|applied/i.test(m))
  ) {
    reasons.push("missing_pending_must_not_do");
  }

  for (const ask of card.server_truth_summary.satisfied_ask_fingerprints) {
    if (card.must_do.some((m) => m.toLowerCase().includes(ask.toLowerCase().slice(0, 20)))) {
      reasons.push("reask_satisfied_in_must_do");
    }
  }

  return { valid: reasons.length === 0, reasons };
}

function repairCard(card: StrategyCardV1, ctx: StrategyCardBuildContext, reasons: string[]): StrategyCardV1 {
  const rebuilt = buildInboundNormalStrategyCardV1({ ctx, generatedAt: card.generated_at });
  let moveType = rebuilt.move.type;
  let reason = rebuilt.move.reason;

  if (reasons.includes("single_miss_forbidden_move")) {
    moveType = blockerAlreadyKnown(ctx.facts) ? "recover_today" : "ask_blocker";
    reason = "Repaired: single miss recovery — blocker question only, no adjustment.";
  } else if (reasons.some((r) => r.includes("proof") || r.includes("victory"))) {
    moveType = rebuilt.move.type === "propose_adjustment" ? "clarify" : rebuilt.move.type;
    reason = "Repaired: claims aligned to server proof permission.";
  } else if (reasons.includes("adjustment_not_allowed") || reasons.includes("evaluate_without_permission")) {
    moveType = "clarify";
    reason = "Repaired: clarify intent without commitment change.";
  }

  const allowed = buildAllowedClaims(ctx, rebuilt.server_truth_summary.outcome);
  const { must_do, must_not_do } = buildMustDoMustNotDo({
    moveType,
    ctx,
    policy: ctx.facts.miss_adjustment_policy,
    planAck: isPlanAckTurn({
      facts: ctx.facts,
      tu: ctx.facts.turn_understanding,
      shortAnswerPlanAck: ctx.shortAnswerPlanAck,
    }),
    blockerKnown: blockerAlreadyKnown(ctx.facts),
  });

  return {
    ...rebuilt,
    move: {
      type: moveType,
      priority: "normal",
      confidence: "medium",
      reason: truncateText(reason, MAX_REASON_CHARS),
    },
    must_do,
    must_not_do,
    allowed_claims: allowed,
    writer_constraints: {
      ...rebuilt.writer_constraints,
      max_questions: moveType === "clarify" ? 1 : 1,
      tone_posture:
        moveType === "clarify" ? "clarifying" : rebuilt.writer_constraints.tone_posture,
    },
    meta: {
      ...rebuilt.meta,
      legacy_hint_replaced: true,
    },
  };
}

export function validateAndRepairInboundNormalStrategyCardV1(
  card: StrategyCardV1,
  ctx: StrategyCardBuildContext
): StrategyCardValidationResult {
  const first = validateInboundNormalStrategyCardV1(card, ctx);
  if (first.valid) {
    return { card, validation_status: "valid", validation_reasons: [] };
  }
  const repaired = repairCard(card, ctx, first.reasons);
  const second = validateInboundNormalStrategyCardV1(repaired, ctx);
  return {
    card: repaired,
    validation_status: "repaired",
    validation_reasons: [...first.reasons, ...second.reasons.filter((r) => !first.reasons.includes(r))],
  };
}

export function buildStrategyCardV1PromptGuidance(): string {
  return `
STRATEGY_CARD_V1 (primary coaching move when present):
- Follow strategy_card_v1 for the coaching move — do not invent a different move.
- Use RELATIONSHIP_SNAPSHOT_V2 and RELATIONSHIP_PACKET_V1 for relationship context only — not as permission to override the card.
- Respect allowed_claims — do not claim completion, miss, partial, proof, or Victory Room beyond what the card allows.
- Honor must_do and must_not_do exactly.
- Honor writer_constraints.avoid_repeating — do not re-ask those questions.
- Match writer_constraints.tone_posture in voice, without quoting internal labels.
- Server final guard still validates the final SMS separately.`;
}

export function strategyCardV1UserPromptAppendix(card: StrategyCardV1): string {
  return `STRATEGY_CARD_V1 (primary coaching move — follow exactly; do not invent a different move):
${JSON.stringify(card)}`;
}

export function strategyCardV1MetaForTelemetry(
  result: StrategyCardValidationResult
): Record<string, unknown> {
  const c = result.card;
  return {
    strategy_card_version: c.version,
    strategy_card_surface: c.surface,
    strategy_card_route_kind: c.route_kind,
    strategy_card_move_type: c.move.type,
    strategy_card_move_confidence: c.move.confidence,
    strategy_card_validation_status: result.validation_status,
    strategy_card_validation_reasons: result.validation_reasons.slice(0, 8),
    strategy_card_legacy_suggested_coaching_move: c.meta.legacy_suggested_coaching_move ?? null,
    strategy_card_legacy_coaching_move_source: c.meta.legacy_coaching_move_source ?? null,
    strategy_card_legacy_hint_used: c.meta.legacy_hint_used === true,
    strategy_card_legacy_hint_replaced: c.meta.legacy_hint_replaced === true,
    strategy_card_allowed_claims: c.allowed_claims,
    strategy_card_tone_posture: c.writer_constraints.tone_posture,
  };
}

export function buildStrategyCardContextFromSnapshot(args: {
  facts: InboundV3RelationshipFacts;
  snapshot: {
    proof_and_praise_permission: { data: ProofAndPraisePermissionV2Data };
    open_loops_and_do_not_repeat: { data: OpenLoopsAndDoNotRepeatData };
    active_pending_state: ActivePendingState;
    no_send_and_silence_history?: { data: NoSendAndSilenceHistoryV2Data } | null;
  };
  shortAnswerPlanAck?: boolean;
}): StrategyCardBuildContext {
  return {
    facts: args.facts,
    proofPermission: args.snapshot.proof_and_praise_permission.data,
    openLoops: args.snapshot.open_loops_and_do_not_repeat.data,
    activePending: args.snapshot.active_pending_state,
    noSendSilence: args.snapshot.no_send_and_silence_history?.data ?? null,
    shortAnswerPlanAck: args.shortAnswerPlanAck,
  };
}

/** @internal test helper */
export function isMissRecoveryTurnForCard(facts: InboundV3RelationshipFacts): boolean {
  return isMissRecoveryTurn({
    inboundMeaning: facts.inbound_meaning,
    finalEventType: facts.v2_accountability.final_event_type,
  });
}

/** @internal test helper */
export function deriveAdjustmentPolicyForCard(
  facts: InboundV3RelationshipFacts
): MissAdjustmentPolicyResult | null | undefined {
  return facts.miss_adjustment_policy;
}
