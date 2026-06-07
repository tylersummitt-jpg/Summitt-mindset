/**
 * P0 Step C — block premature commitment adjustment proposals after a single miss.
 * Server truth: ask blocker/recovery first unless evidence supports adjustment.
 */

import type { InboundMeaningFacts } from "@/lib/inbound-relationship-meaning";
import type { SmsGoalAdjustmentSignalResult } from "@/lib/sms-goal-adjustment-signal";
import type { SmsPatternSignalResult } from "@/lib/sms-pattern-signal";
import type { InboundV3RoutePurpose } from "@/lib/v3-inbound-relationship-lane";
import type { V2EventRowForAi } from "@/lib/v2-commitment";

export const PREMATURE_ADJUSTMENT_PROPOSAL_NO_SEND =
  "premature_adjustment_proposal_blocked" as const;

export type AdjustmentEvidenceReason =
  | "user_requested_adjustment"
  | "repeated_miss_pattern"
  | "active_adaptive_proposal"
  | "pending_resolution"
  | "commitment_change_route"
  | "goal_adjustment_mention_allowed"
  | "not_allowed_single_miss"
  | "not_a_miss_turn";

export type MissAdjustmentPolicyResult = {
  adjustment_proposal_allowed_by_evidence: boolean;
  adjustment_evidence_reason: AdjustmentEvidenceReason;
  single_miss_recovery_required: boolean;
};

const MS_DAY = 86400000;

const USER_REQUESTED_ADJUSTMENT_RE =
  /\b(change\s+my\s+goal|new\s+goal|different\s+goal|replace\s+(my\s+)?goal|switch\s+(my\s+)?goal|goal\s+is\s+wrong|need to change the goal|want to change the goal|adjust the goal|lower the goal|increase the goal|make it (easier|harder|smaller|bigger))\b/i;

const REFLECTIVE_RECOVERY_PHRASE_RES: ReadonlyArray<RegExp> = [
  /\bwhat got in the way\b/i,
  /\bwhat blocked\b/i,
  /\bwhat led to that\b/i,
  /\bwhat happened\b/i,
  /\bwhat would help you recover\b/i,
  /\bnext honest step\b/i,
  /\bbefore (we |changing|adjust)/i,
  /\bbefore changing anything\b/i,
  /\bwhether the plan needs adjustment later\b/i,
  /\bunderstand what got in the way\b/i,
];

const PREMATURE_COMMITMENT_PROPOSAL_RES: ReadonlyArray<RegExp> = [
  /\badjust our approach\b/i,
  /\blet'?s adjust our approach\b/i,
  /\bhow does committing to\b/i,
  /\bhow do you feel about committing\b/i,
  /\bwhat do you think about committing\b/i,
  /\bwould you like to adjust\b/i,
  /\bshould we adjust\b/i,
  /\bchange the (goal|plan|commitment)\b/i,
  /\bchange (your|the) (goal|plan|commitment)\b/i,
  /\bnew commitment\b/i,
  /\btry committing to\b/i,
  /\badjust your commitment\b/i,
  /\bdoes this new plan work\b/i,
  /\bhow does this new target sound\b/i,
  /\bdoes (this|that|it) adjustment work\b/i,
  /\bhow does\b.*\bsound\b/i,
  /\bdoes (this|that)\b.*\b(plan|approach) work\b/i,
  /\bcommitting to\b.*\b(per day|per week|hour|minute|day|week)\b/i,
];

const COMMITMENT_CHANGE_ROUTE_PURPOSES = new Set<InboundV3RoutePurpose>([
  "commitment_change_handoff",
  "commitment_change_context",
  "adaptive_proposal_consent_accept",
  "adaptive_proposal_consent_decline",
  "adaptive_proposal_consent_noop_ack",
  "adaptive_proposal_consent_clarification",
]);

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

export function inboundUserRequestedGoalAdjustment(rawInbound: string): boolean {
  const t = rawInbound.trim();
  if (!t) return false;
  return USER_REQUESTED_ADJUSTMENT_RE.test(t);
}

export function isMissRecoveryTurn(args: {
  inboundMeaning?: InboundMeaningFacts | null;
  finalEventType?: string | null;
}): boolean {
  const m = args.inboundMeaning;
  if (m?.relationship_meaning === "miss") return true;
  if (m?.relationship_meaning === "partial_attempt") return true;
  if (m?.persistence_decision === "write_user_no") return true;
  if (m?.persistence_decision === "write_user_partial") return true;
  if (m?.sms_response_intent === "tell_truth_and_recover") return true;
  if (m?.sms_response_intent === "identify_blocker_or_next_move") return true;
  if (args.finalEventType === "user_no" || args.finalEventType === "user_partial") return true;
  return false;
}

export function deriveAdjustmentProposalAllowedByEvidence(args: {
  inboundMeaning?: InboundMeaningFacts | null;
  inboundRaw?: string | null;
  finalEventType?: string | null;
  routePurpose?: InboundV3RoutePurpose | string | null;
  goalAdjustmentSignal?: SmsGoalAdjustmentSignalResult | null;
  patternSignal?: SmsPatternSignalResult | null;
  eventsNewestFirst?: V2EventRowForAi[];
  adaptiveProposalPending?: boolean;
  pendingResolutionActive?: boolean;
  commitmentChangeRouteActive?: boolean;
  nowMs?: number;
}): MissAdjustmentPolicyResult {
  const raw = (args.inboundRaw ?? "").trim();

  if (inboundUserRequestedGoalAdjustment(raw)) {
    return {
      adjustment_proposal_allowed_by_evidence: true,
      adjustment_evidence_reason: "user_requested_adjustment",
      single_miss_recovery_required: false,
    };
  }

  const missTurn = isMissRecoveryTurn({
    inboundMeaning: args.inboundMeaning,
    finalEventType: args.finalEventType,
  });

  if (!missTurn) {
    return {
      adjustment_proposal_allowed_by_evidence: false,
      adjustment_evidence_reason: "not_a_miss_turn",
      single_miss_recovery_required: false,
    };
  }

  const route = (args.routePurpose ?? "").toString();

  if (args.commitmentChangeRouteActive === true) {
    return {
      adjustment_proposal_allowed_by_evidence: true,
      adjustment_evidence_reason: "commitment_change_route",
      single_miss_recovery_required: false,
    };
  }

  if (COMMITMENT_CHANGE_ROUTE_PURPOSES.has(route as InboundV3RoutePurpose)) {
    return {
      adjustment_proposal_allowed_by_evidence: true,
      adjustment_evidence_reason: "commitment_change_route",
      single_miss_recovery_required: false,
    };
  }

  if (args.adaptiveProposalPending === true) {
    return {
      adjustment_proposal_allowed_by_evidence: true,
      adjustment_evidence_reason: "active_adaptive_proposal",
      single_miss_recovery_required: false,
    };
  }

  if (args.pendingResolutionActive === true) {
    return {
      adjustment_proposal_allowed_by_evidence: true,
      adjustment_evidence_reason: "pending_resolution",
      single_miss_recovery_required: false,
    };
  }

  if (args.goalAdjustmentSignal?.mentionAllowed === true) {
    return {
      adjustment_proposal_allowed_by_evidence: true,
      adjustment_evidence_reason: "goal_adjustment_mention_allowed",
      single_miss_recovery_required: false,
    };
  }

  const nowMs = args.nowMs ?? Date.now();
  const neg14 = countNegOutcomes14d(args.eventsNewestFirst ?? [], nowMs);
  const pattern = args.patternSignal;
  const repeatedMiss =
    neg14 >= 2 &&
    (pattern?.mentionAllowed === true ||
      pattern?.confidence === "medium" ||
      pattern?.confidence === "high" ||
      args.goalAdjustmentSignal?.move === "shrink_temporary");

  if (repeatedMiss) {
    return {
      adjustment_proposal_allowed_by_evidence: true,
      adjustment_evidence_reason: "repeated_miss_pattern",
      single_miss_recovery_required: false,
    };
  }

  return {
    adjustment_proposal_allowed_by_evidence: false,
    adjustment_evidence_reason: "not_allowed_single_miss",
    single_miss_recovery_required: true,
  };
}

export function detectPrematureCommitmentAdjustmentProposal(body: string): boolean {
  const t = body.trim();
  if (!t) return false;

  if (REFLECTIVE_RECOVERY_PHRASE_RES.some((rx) => rx.test(t))) {
    return false;
  }

  return PREMATURE_COMMITMENT_PROPOSAL_RES.some((rx) => rx.test(t));
}

export function buildSingleMissRecoveryLaneGuardrails(
  policy: MissAdjustmentPolicyResult | null | undefined
): string {
  if (!policy?.single_miss_recovery_required) return "";

  return `
SINGLE_MISS_RECOVERY (authoritative — current_turn / miss_adjustment_policy):
- The user reported a miss or partial without repeated-miss evidence to change the commitment.
- adjustment_proposal_allowed_by_evidence is false — do NOT propose a new commitment, temporary shrink overlay, or plan-confirmation ask (no "how does committing to X sound", no "let's adjust our approach").
- Ask ONE honest blocker/recovery question first: what got in the way, what blocked it, what happened, or what would help recover today.
- Honor suggested_coaching_move when present (name_blocker / narrow_blocker).
- Reflective mention of future adjustment is OK only after asking what blocked them — not a new commitment proposal this turn.`;
}

export function buildSingleMissRecoveryRequiredMeaningSummary(
  policy: MissAdjustmentPolicyResult
): string | null {
  if (!policy.single_miss_recovery_required) return null;
  return (
    "The user reported a miss. Ask what got in the way or what blocked the plan. " +
    "Do not propose changing the commitment or offer a new commitment target unless adjustment_proposal_allowed_by_evidence is true."
  );
}

export type ApplyPrematureAdjustmentProposalGuardArgs = {
  body: string;
  policy: MissAdjustmentPolicyResult | null | undefined;
  inboundMeaning?: InboundMeaningFacts | null;
  finalEventType?: string | null;
  routePurpose?: string | null;
  factsJson?: Record<string, unknown> | null;
  repairSnapshot?: import("@/lib/sms-relationship-repair-snapshot-v1").RepairRelationshipSnapshotV1 | null;
  stage?: string;
};

export type PrematureAdjustmentProposalGuardResult = {
  body: string;
  shouldSend: boolean;
  noSendReason: typeof PREMATURE_ADJUSTMENT_PROPOSAL_NO_SEND | null;
  metadata: Record<string, unknown>;
};

export async function applyPrematureAdjustmentProposalGuard(
  args: ApplyPrematureAdjustmentProposalGuardArgs
): Promise<PrematureAdjustmentProposalGuardResult> {
  const stage = args.stage ?? "premature_adjustment_guard";
  const baseMeta: Record<string, unknown> = {
    premature_adjustment_proposal_guard_ran: true,
    premature_adjustment_proposal_guard_stage: stage,
  };

  const policy =
    args.policy ??
    deriveAdjustmentProposalAllowedByEvidence({
      inboundMeaning: args.inboundMeaning,
      finalEventType: args.finalEventType,
    });

  baseMeta.miss_adjustment_policy = policy;

  const missTurn = isMissRecoveryTurn({
    inboundMeaning: args.inboundMeaning,
    finalEventType: args.finalEventType,
  });

  if (!missTurn || policy.adjustment_proposal_allowed_by_evidence) {
    return {
      body: args.body,
      shouldSend: true,
      noSendReason: null,
      metadata: {
        ...baseMeta,
        premature_adjustment_proposal_violation_detected: false,
        premature_adjustment_proposal_guard_inactive: !missTurn,
      },
    };
  }

  const violation = detectPrematureCommitmentAdjustmentProposal(args.body);
  if (!violation) {
    return {
      body: args.body,
      shouldSend: true,
      noSendReason: null,
      metadata: {
        ...baseMeta,
        premature_adjustment_proposal_violation_detected: false,
      },
    };
  }

  const { repairV3RelationshipLaneBodyWithOpenAI } = await import("@/lib/v3-sms-voice-ownership");
  const repair = await repairV3RelationshipLaneBodyWithOpenAI({
    routeKind: "inbound",
    routePurpose: "premature_adjustment_proposal_guard",
    originalBody: args.body,
    blockedReasons: ["premature_commitment_adjustment_proposal"],
    factsJson: args.factsJson ?? null,
    repairSnapshot: args.repairSnapshot ?? null,
    systemInstruction:
      "PREMATURE ADJUSTMENT GUARD: The user reported a miss. Do not propose changing the commitment yet. " +
      "Do not ask how a new commitment target sounds. Ask what got in the way, what blocked the plan, " +
      "or what would help recover today. No fake proof. No hard-coded templates. One short SMS.",
  });

  if (repair?.body?.trim()) {
    const repaired = repair.body.trim();
    if (!detectPrematureCommitmentAdjustmentProposal(repaired)) {
      return {
        body: repaired,
        shouldSend: true,
        noSendReason: null,
        metadata: {
          ...baseMeta,
          premature_adjustment_proposal_violation_detected: true,
          premature_adjustment_proposal_repair_attempted: true,
          premature_adjustment_proposal_repair_succeeded: true,
          premature_adjustment_proposal_repair_metadata: repair.metadata,
        },
      };
    }
  }

  return {
    body: "",
    shouldSend: false,
    noSendReason: PREMATURE_ADJUSTMENT_PROPOSAL_NO_SEND,
    metadata: {
      ...baseMeta,
      premature_adjustment_proposal_violation_detected: true,
      premature_adjustment_proposal_repair_attempted: Boolean(repair),
      premature_adjustment_proposal_repair_succeeded: false,
      premature_adjustment_proposal_no_send_reason: PREMATURE_ADJUSTMENT_PROPOSAL_NO_SEND,
    },
  };
}
