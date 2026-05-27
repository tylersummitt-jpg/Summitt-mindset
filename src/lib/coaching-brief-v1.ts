/**
 * Coaching Brief v1 — server-owned strategy derived from V3 lane facts (Slice 1).
 * No DB writes; no prompt consumption yet; Pat candidates empty until later slices.
 */

import { createHash } from "crypto";

import type { DailyV3RelationshipFacts, DailyV3RouteKind } from "@/lib/v3-daily-relationship-lane";
import type { InboundV3RelationshipFacts, InboundV3RoutePurpose } from "@/lib/v3-inbound-relationship-lane";

export type CoachingBriefSurface = "daily_sms" | "inbound_sms";

export type CoachingBriefConfidence = "low" | "medium" | "high";

export type CoachingBriefMessageWeight = "light" | "standard" | "story_punch" | "special";

export type PatCandidateV1 =
  | {
      type: "principle";
      id: string;
      display_line: string;
      principle_id: string;
    }
  | {
      type: "exact_quote";
      id: string;
      verbatim: string;
      max_chars?: number;
    }
  | {
      type: "story_capsule";
      id: string;
      capsule_text: string;
      lesson?: string;
      must_not_expand: true;
    }
  | {
      type: "ask_pat_bridge";
      id: string;
      teaser_line: string;
      topic_hint: string;
    };

export type CoachingBriefReplyTarget =
  | "close_plan_loop"
  | "one_honest_move"
  | "acknowledge"
  | "clarify"
  | "transactional"
  | null;

export type CoachingBriefV1 = {
  version: "coaching_brief_v1";
  surface: CoachingBriefSurface;

  move: string;
  move_source: "rule_derived" | "route_override";
  confidence: CoachingBriefConfidence;

  message_weight: CoachingBriefMessageWeight;

  current_goal: {
    goal_id: string | null;
    effective_ask: string;
    behavior_statement: string;
    title?: string | null;
  };

  identity_hint: string | null;

  evidence_source: string;
  evidence_preview: string | null;
  evidence_preview_hash?: string | null;

  memory_state: {
    pending_plan_proof_active: boolean;
    timing_anchor_active: boolean;
    timing_anchor_confidence: string | null;
    open_question_pending: boolean;
    prior_outcome: string | null;
    recent_exact_thread_available: boolean;
    projection_used: boolean;

    inbound_event_type?: string | null;
    memory_correction_active?: boolean;
    pending_goal_replacement_active?: boolean;
  };

  tactical_advice_allowed: boolean;
  explicit_pat_content_allowed: boolean;
  pat_voice_level: "none" | "subtle" | "explicit";
  pat_candidates: PatCandidateV1[];

  reply_target: CoachingBriefReplyTarget;

  must_not_say: string[];
  guardrail_context: string[];

  logging_summary: {
    move: string;
    gates_closed: string[];
    candidate_ids_offered: string[];
  };
};

/** Compact telemetry object for v3_brain — no full thread text. */
export type CoachingBriefV1Log = {
  version: "coaching_brief_v1";
  surface: CoachingBriefSurface;
  move: string;
  confidence: CoachingBriefConfidence;
  message_weight: CoachingBriefMessageWeight;
  evidence_source: string;
  pending_plan_proof_active: boolean;
  timing_anchor_confidence: string | null;
  tactical_advice_allowed: boolean;
  explicit_pat_content_allowed: boolean;
  pat_candidates_offered: string[];
  guardrail_context: string[];
  reply_target: CoachingBriefReplyTarget;
};

const PLAN_PROOF_MUST_NOT_SAY = [
  "great to see you focused",
  "back on track",
  "you followed through",
  "you made it happen",
  "goal updated",
] as const;

const TRANSACTIONAL_DAILY_ROUTES = new Set<DailyV3RouteKind>([
  "pending_resolution",
  "refresh_identity",
  "refresh_commitment",
  "contract_prompt",
]);

const TRANSACTIONAL_INBOUND_PURPOSES = new Set<InboundV3RoutePurpose>([
  "refresh",
  "refresh_identity",
  "refresh_commitment",
  "refresh_confirmation",
  "refresh_clarification",
  "pending_resolution",
  "memory_confirmation",
  "memory_decline",
  "memory_clarification",
  "adaptive_proposal_consent_accept",
  "adaptive_proposal_consent_decline",
  "adaptive_proposal_consent_noop_ack",
  "adaptive_proposal_consent_clarification",
  "commitment_change_handoff",
  "relationship_exit_integrity",
  "identity_edit_integrity",
]);

function truncatePreview(text: string | null | undefined, max = 120): string | null {
  const t = (text ?? "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function hashEvidencePreview(preview: string | null): string | null {
  if (!preview?.trim()) return null;
  return createHash("sha256").update(preview.trim()).digest("hex").slice(0, 16);
}

function deriveDailyConfidence(facts: DailyV3RelationshipFacts): CoachingBriefConfidence {
  if (facts.accountability.pending_plan_proof?.active === true) return "high";
  if (facts.accountability.reentry_active || facts.accountability.silence_tier === "high") {
    return "low";
  }
  if (facts.accountability.prior_outcome || facts.accountability.blocker_preview) return "medium";
  return "medium";
}

function deriveDailyEvidenceSource(facts: DailyV3RelationshipFacts): string {
  if (facts.accountability.pending_plan_proof?.active === true) return "pending_plan_proof";
  if (facts.accountability.prior_outcome) return `prior_outcome:${facts.accountability.prior_outcome}`;
  if (facts.accountability.blocker_preview) return "blocker_preview";
  return facts.accountability.daily_purpose || facts.route_kind;
}

function deriveDailyEvidencePreview(facts: DailyV3RelationshipFacts): string | null {
  const pending = facts.accountability.pending_plan_proof;
  if (pending?.active === true) {
    return truncatePreview(pending.source_answer_preview ?? pending.plan_summary_hint);
  }
  return truncatePreview(facts.accountability.blocker_preview);
}

function deriveDailyReplyTarget(facts: DailyV3RelationshipFacts): CoachingBriefReplyTarget {
  if (facts.accountability.pending_plan_proof?.active === true) return "close_plan_loop";
  if (TRANSACTIONAL_DAILY_ROUTES.has(facts.route_kind)) return "transactional";
  if (
    facts.route_kind === "main_active_accountability" ||
    facts.route_kind === "low_pressure_reactivation"
  ) {
    return "one_honest_move";
  }
  return null;
}

function deriveDailyTacticalAdviceAllowed(facts: DailyV3RelationshipFacts): boolean {
  if (facts.accountability.pending_plan_proof?.active === true) return false;
  if (TRANSACTIONAL_DAILY_ROUTES.has(facts.route_kind)) return false;
  if (facts.accountability.contract_proposal_mode) return false;
  if (facts.suggested_coaching_move === "close_prior_plan_loop") return false;
  if (facts.accountability.blocker_preview?.trim()) return true;
  if (facts.suggested_coaching_move === "invite_smaller_rep") return true;
  if (facts.accountability.next_move_type === "shrink_ask") return true;
  if (facts.suggested_coaching_move === "ask_blocker") return true;
  return false;
}

function deriveDailyPatVoiceLevel(facts: DailyV3RelationshipFacts): "none" | "subtle" | "explicit" {
  if (TRANSACTIONAL_DAILY_ROUTES.has(facts.route_kind)) return "none";
  return "subtle";
}

function buildDailyGuardrailContext(facts: DailyV3RelationshipFacts): string[] {
  const codes: string[] = ["no_explicit_pat_content"];
  if (facts.accountability.pending_plan_proof?.active === true) {
    codes.push("pending_plan_proof");
  }
  const timing = facts.accountability.timing_anchor_memory;
  if (timing?.active === true) {
    const low =
      timing.recurrence_confidence === "low" ||
      timing.confidence_level === "mentioned_once";
    if (low) codes.push("timing_anchor_low_confidence");
  }
  if (!deriveDailyTacticalAdviceAllowed(facts)) {
    codes.push("no_tactical_advice");
  }
  return codes;
}

function buildDailyMustNotSay(facts: DailyV3RelationshipFacts): string[] {
  const list: string[] = [];
  if (facts.accountability.pending_plan_proof?.active === true) {
    list.push(...PLAN_PROOF_MUST_NOT_SAY);
  }
  return list;
}

function buildDailyGatesClosed(facts: DailyV3RelationshipFacts): string[] {
  const gates: string[] = ["explicit_pat_content"];
  if (facts.accountability.pending_plan_proof?.active === true) {
    gates.push("pending_plan_proof");
  }
  if (!deriveDailyTacticalAdviceAllowed(facts)) {
    gates.push("tactical_advice");
  }
  return gates;
}

export function buildCoachingBriefV1FromDailyFacts(facts: DailyV3RelationshipFacts): CoachingBriefV1 {
  const evidencePreview = deriveDailyEvidencePreview(facts);
  const timing = facts.accountability.timing_anchor_memory;
  const pendingPlanActive = facts.accountability.pending_plan_proof?.active === true;

  return {
    version: "coaching_brief_v1",
    surface: "daily_sms",
    move: facts.suggested_coaching_move?.trim() || "ask_completion",
    move_source: "rule_derived",
    confidence: deriveDailyConfidence(facts),
    message_weight: "standard",
    current_goal: {
      goal_id: facts.commitment.id?.trim() || null,
      effective_ask: facts.commitment.effective_ask?.trim() || "",
      behavior_statement: facts.commitment.behavior_statement?.trim() || "",
      title: facts.commitment.title?.trim() || null,
    },
    identity_hint:
      facts.commitment.identity_anchor_allowed && facts.commitment.identity_anchor_short?.trim()
        ? facts.commitment.identity_anchor_short.trim()
        : null,
    evidence_source: deriveDailyEvidenceSource(facts),
    evidence_preview: evidencePreview,
    evidence_preview_hash: hashEvidencePreview(evidencePreview),
    memory_state: {
      pending_plan_proof_active: pendingPlanActive,
      timing_anchor_active: timing?.active === true,
      timing_anchor_confidence: timing?.confidence_level ?? timing?.recurrence_confidence ?? null,
      open_question_pending: facts.thread_memory.open_question_pending === true,
      prior_outcome: facts.accountability.prior_outcome ?? null,
      recent_exact_thread_available: Boolean(facts.thread_memory.recent_exact_thread_text?.trim()),
      projection_used: facts.thread_memory.projection_used === true,
    },
    tactical_advice_allowed: deriveDailyTacticalAdviceAllowed(facts),
    explicit_pat_content_allowed: false,
    pat_voice_level: deriveDailyPatVoiceLevel(facts),
    pat_candidates: [],
    reply_target: deriveDailyReplyTarget(facts),
    must_not_say: buildDailyMustNotSay(facts),
    guardrail_context: buildDailyGuardrailContext(facts),
    logging_summary: {
      move: facts.suggested_coaching_move?.trim() || "ask_completion",
      gates_closed: buildDailyGatesClosed(facts),
      candidate_ids_offered: [],
    },
  };
}

function deriveInboundConfidence(facts: InboundV3RelationshipFacts): CoachingBriefConfidence {
  if (facts.v2_accountability.gated_mode === "clarify") return "low";
  if (facts.thread.memory_correction_should_use_prior_user_answer) return "medium";
  const ft = facts.v2_accountability.final_event_type;
  if (ft === "user_yes" || ft === "user_no" || ft === "user_partial") return "medium";
  return "medium";
}

function deriveInboundEvidenceSource(facts: InboundV3RelationshipFacts): string {
  const ft = facts.v2_accountability.final_event_type;
  if (ft) return `inbound_event:${ft}`;
  if (facts.v2_accountability.blocker_signal) return "blocker_signal";
  if (facts.pending_replacement_facts?.pending_resolution_active) return "pending_goal_replacement";
  return facts.route_purpose;
}

function deriveInboundEvidencePreview(facts: InboundV3RelationshipFacts): string | null {
  if (facts.v2_accountability.blocker_signal) {
    return truncatePreview(facts.thread.coalesced_inbound_text);
  }
  return truncatePreview(facts.thread.latest_answer_after_open_question);
}

function isInboundTransactional(facts: InboundV3RelationshipFacts): boolean {
  if (TRANSACTIONAL_INBOUND_PURPOSES.has(facts.route_purpose)) return true;
  if (facts.contract_consent_facts != null) return true;
  if (facts.commitment_change_facts != null) return true;
  if (
    facts.pending_replacement_facts?.pending_resolution_active === true &&
    facts.pending_replacement_facts.pending_resolution_applied !== true
  ) {
    return true;
  }
  return false;
}

function deriveInboundReplyTarget(facts: InboundV3RelationshipFacts): CoachingBriefReplyTarget {
  if (isInboundTransactional(facts)) return "transactional";
  const move = facts.suggested_coaching_move;
  const ft = facts.v2_accountability.final_event_type;
  if (
    ft === "user_yes" ||
    move === "acknowledge_completion" ||
    facts.v2_accountability.proof_signal === true
  ) {
    return "acknowledge";
  }
  if (facts.v2_accountability.gated_mode === "clarify" || move === "clarify_intent") {
    return "clarify";
  }
  return "one_honest_move";
}

function deriveInboundTacticalAdviceAllowed(facts: InboundV3RelationshipFacts): boolean {
  if (isInboundTransactional(facts)) return false;
  if (
    facts.pending_replacement_facts?.pending_resolution_active === true &&
    facts.pending_replacement_facts.pending_resolution_applied !== true
  ) {
    return false;
  }
  if (facts.v2_accountability.blocker_signal) return true;
  if (facts.suggested_coaching_move === "name_blocker" || facts.suggested_coaching_move === "narrow_blocker") {
    return true;
  }
  return false;
}

function deriveInboundPatVoiceLevel(facts: InboundV3RelationshipFacts): "none" | "subtle" | "explicit" {
  if (isInboundTransactional(facts)) return "none";
  return "subtle";
}

function buildInboundGuardrailContext(facts: InboundV3RelationshipFacts): string[] {
  const codes: string[] = ["no_explicit_pat_content"];
  if (
    facts.pending_replacement_facts?.pending_resolution_active === true &&
    facts.pending_replacement_facts.pending_resolution_applied !== true
  ) {
    codes.push("pending_goal_replacement");
  }
  if (facts.thread.memory_correction_should_use_prior_user_answer) {
    codes.push("memory_correction_active");
  }
  if (!deriveInboundTacticalAdviceAllowed(facts)) {
    codes.push("no_tactical_advice");
  }
  return codes;
}

function buildInboundGatesClosed(facts: InboundV3RelationshipFacts): string[] {
  const gates: string[] = ["explicit_pat_content"];
  if (!deriveInboundTacticalAdviceAllowed(facts)) {
    gates.push("tactical_advice");
  }
  if (
    facts.pending_replacement_facts?.pending_resolution_active === true &&
    facts.pending_replacement_facts.pending_resolution_applied !== true
  ) {
    gates.push("pending_goal_replacement");
  }
  return gates;
}

export function buildCoachingBriefV1FromInboundFacts(
  facts: InboundV3RelationshipFacts
): CoachingBriefV1 {
  const evidencePreview = deriveInboundEvidencePreview(facts);
  const mp = facts.thread.memory_packet;
  const openQuestionPending =
    mp?.open_question_pending === true || facts.thread.latest_open_question != null;
  const pendingReplacementActive =
    facts.pending_replacement_facts?.pending_resolution_active === true &&
    facts.pending_replacement_facts.pending_resolution_applied !== true;

  return {
    version: "coaching_brief_v1",
    surface: "inbound_sms",
    move: facts.suggested_coaching_move?.trim() || "ask_accountability",
    move_source: "rule_derived",
    confidence: deriveInboundConfidence(facts),
    message_weight: "standard",
    current_goal: {
      goal_id: facts.commitment.id?.trim() || null,
      effective_ask: facts.commitment.effective_ask?.trim() || "",
      behavior_statement: facts.commitment.behavior_statement?.trim() || "",
      title: facts.commitment.title?.trim() || null,
    },
    identity_hint: null,
    evidence_source: deriveInboundEvidenceSource(facts),
    evidence_preview: evidencePreview,
    evidence_preview_hash: hashEvidencePreview(evidencePreview),
    memory_state: {
      pending_plan_proof_active: false,
      timing_anchor_active: false,
      timing_anchor_confidence: null,
      open_question_pending: openQuestionPending,
      prior_outcome: null,
      recent_exact_thread_available: Boolean(
        mp?.recent_exact_thread_text?.trim() || facts.thread.recent_transcript_lines.length > 0
      ),
      projection_used:
        facts.thread.memory_authority.projection_used === true || mp?.projection_used === true,
      inbound_event_type:
        facts.v2_accountability.final_event_type ??
        facts.v2_accountability.deterministic_classifier_event ??
        null,
      memory_correction_active: facts.thread.memory_correction_should_use_prior_user_answer === true,
      pending_goal_replacement_active: pendingReplacementActive,
    },
    tactical_advice_allowed: deriveInboundTacticalAdviceAllowed(facts),
    explicit_pat_content_allowed: false,
    pat_voice_level: deriveInboundPatVoiceLevel(facts),
    pat_candidates: [],
    reply_target: deriveInboundReplyTarget(facts),
    must_not_say: [],
    guardrail_context: buildInboundGuardrailContext(facts),
    logging_summary: {
      move: facts.suggested_coaching_move?.trim() || "ask_accountability",
      gates_closed: buildInboundGatesClosed(facts),
      candidate_ids_offered: [],
    },
  };
}

export function compactCoachingBriefV1ForV3Brain(brief: CoachingBriefV1): CoachingBriefV1Log {
  return {
    version: brief.version,
    surface: brief.surface,
    move: brief.move,
    confidence: brief.confidence,
    message_weight: brief.message_weight,
    evidence_source: brief.evidence_source,
    pending_plan_proof_active: brief.memory_state.pending_plan_proof_active,
    timing_anchor_confidence: brief.memory_state.timing_anchor_confidence,
    tactical_advice_allowed: brief.tactical_advice_allowed,
    explicit_pat_content_allowed: brief.explicit_pat_content_allowed,
    pat_candidates_offered: brief.logging_summary.candidate_ids_offered,
    guardrail_context: brief.guardrail_context,
    reply_target: brief.reply_target,
  };
}
