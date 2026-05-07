/**
 * Server-side guardrails for SMS Conversation Brain proposals.
 * Pure: no I/O, no OpenAI, no DB, no Twilio.
 */

import type { SmsConversationBrainProposalV1 } from "@/lib/v2-sms-turn-contract";
import { weakGenericMotivationalPhraseFailReason } from "@/lib/v2-sms-quality-copy";

export type SmsTurnServerContext = {
  clerk_user_id: string;
  commitment_id: string;
  message_sid: string;
  subscription_ok: boolean;
  sms_eligible: boolean;
  has_active_commitment: boolean;
  pending_resolution_active: boolean;
  contract_overlay_active: boolean;
  /** Who should own turn routing; used to block cross-branch writes. */
  branch_owner: "normal_accountability" | "pending_resolution" | "contract_overlay" | "compliance";
  recent_clarification_count_heuristic: number;
  opt_out_or_compliance_turn: boolean;
  allowed_event_types: ReadonlyArray<"user_yes" | "user_no" | "user_partial">;
  confidence_floor: number;
  max_clarify_per_window: number;
  /** If true, same message_sid / turn might already have an outcome (server hint). */
  duplicate_outcome_write_risk?: boolean;
};

export type GuardrailResult = {
  status: "approved" | "overridden" | "blocked";
  final_event_type: "user_yes" | "user_no" | "user_partial" | null;
  should_write_event: boolean;
  final_sms_draft: string | null;
  guardrail_reason: string;
  details?: Record<string, unknown>;
};

const DEFAULT_INTERNAL_DENY = /\b(supabase|postgres|sql\b|twilio|schema_version|payload_json|cron job|webhook|openapi|api key)\b/i;

/** Minimal coarse lists — tuned for coach-safe SMS; avoid rejecting honest accountability language. */
const SLUR_OR_TOXIC_FRAGMENTS = [
  /\bf\s*u\s*c\s*k\b/i,
  /\b(sh[iy]t|b[iy]tch|bastard|slut|whore)\b/i,
  /\b(retard|faggot|n[iy]gg[aer])\b/i,
];

const PROFANE_CORE = [
  /\bsex\b/i,
  /\bporn\b/i,
  /\bmasturb/i,
  /\bnude\b/i,
  /\berotic\b/i,
  /\b(blowjob|handjob)\b/i,
];

const SHAME_HEAVY = [
  /\byou('?re| are)\s+(worthless|pathetic|garbage|useless)\b/i,
  /\bwhat('?s|\s+is)\s+wrong\s+with\s+you\b/i,
  /\byou\s+should\s+be\s+ashamed\b/i,
];

function normalizeDraft(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

export function validateCoachSmsDraftLanguage(draft: string): { ok: true } | { ok: false; reason: string } {
  const t = normalizeDraft(draft);
  if (!t) return { ok: false, reason: "empty_draft" };
  if (t.length > 480) return { ok: false, reason: "draft_too_long" };

  for (const rx of SLUR_OR_TOXIC_FRAGMENTS) {
    if (rx.test(t)) return { ok: false, reason: "slur_or_severe_profanity" };
  }
  for (const rx of PROFANE_CORE) {
    if (rx.test(t)) return { ok: false, reason: "profanity_or_sexual" };
  }
  for (const rx of SHAME_HEAVY) {
    if (rx.test(t)) return { ok: false, reason: "shame_heavy" };
  }

  if (DEFAULT_INTERNAL_DENY.test(t)) {
    return { ok: false, reason: "internal_or_system_jargon" };
  }

  /** Repeated edgy ALL CAPS shouting */
  if (/[A-Z]{12,}/.test(t)) return { ok: false, reason: "edgy_formatting" };

  return { ok: true };
}

function alignmentBetweenProposalAndEvent(
  proposal: SmsConversationBrainProposalV1
): { ok: true } | { ok: false; reason: string } {
  if (!proposal.should_write_outcome_event) {
    if (proposal.proposed_event_type != null) {
      return { ok: false, reason: "event_type_with_write_disabled" };
    }
    return { ok: true };
  }
  if (proposal.proposed_event_type == null) {
    return { ok: false, reason: "write_requires_proposed_event_type" };
  }
  if (proposal.accountability_outcome_candidate === "none") {
    return { ok: false, reason: "outcome_none_with_write" };
  }
  return { ok: true };
}

export function applySmsConversationBrainGuardrails(
  proposal: SmsConversationBrainProposalV1,
  serverContext: SmsTurnServerContext
): GuardrailResult {
  if (serverContext.opt_out_or_compliance_turn) {
    return {
      status: "blocked",
      final_event_type: null,
      should_write_event: false,
      final_sms_draft: null,
      guardrail_reason: "compliance_or_opt_out_branch",
    };
  }

  if (serverContext.branch_owner !== "normal_accountability") {
    return {
      status: "blocked",
      final_event_type: null,
      should_write_event: false,
      final_sms_draft: null,
      guardrail_reason: "non_normal_branch_owner",
      details: { branch: serverContext.branch_owner },
    };
  }

  if (!serverContext.has_active_commitment) {
    return {
      status: "blocked",
      final_event_type: null,
      should_write_event: false,
      final_sms_draft: null,
      guardrail_reason: "no_active_commitment",
    };
  }

  if (!serverContext.subscription_ok || !serverContext.sms_eligible) {
    return {
      status: "blocked",
      final_event_type: null,
      should_write_event: false,
      final_sms_draft: null,
      guardrail_reason: "subscription_or_sms_ineligible",
    };
  }

  if (serverContext.pending_resolution_active || serverContext.contract_overlay_active) {
    return {
      status: "blocked",
      final_event_type: null,
      should_write_event: false,
      final_sms_draft: null,
      guardrail_reason: "pending_resolution_or_contract_overlay_active",
    };
  }

  const lang = validateCoachSmsDraftLanguage(proposal.final_sms_draft);
  if (!lang.ok) {
    return {
      status: "blocked",
      final_event_type: null,
      should_write_event: false,
      final_sms_draft: null,
      guardrail_reason: `draft_language:${lang.reason}`,
    };
  }

  const weakMotivation = weakGenericMotivationalPhraseFailReason(proposal.final_sms_draft);
  if (weakMotivation && proposal.should_write_outcome_event) {
    return {
      status: "blocked",
      final_event_type: null,
      should_write_event: false,
      final_sms_draft: null,
      guardrail_reason: `weak_generic_motivation:${weakMotivation}`,
    };
  }

  const align = alignmentBetweenProposalAndEvent(proposal);
  if (!align.ok) {
    return {
      status: "blocked",
      final_event_type: null,
      should_write_event: false,
      final_sms_draft: null,
      guardrail_reason: align.reason,
    };
  }

  if (proposal.turn_kind === "commitment_change_intent" && proposal.should_write_outcome_event) {
    return {
      status: "blocked",
      final_event_type: null,
      should_write_event: false,
      final_sms_draft: null,
      guardrail_reason: "commitment_change_event_write_blocked",
    };
  }

  let finalType: "user_yes" | "user_no" | "user_partial" | null = proposal.proposed_event_type;

  if (proposal.should_write_outcome_event && finalType != null) {
    if (!serverContext.allowed_event_types.includes(finalType)) {
      return {
        status: "blocked",
        final_event_type: null,
        should_write_event: false,
        final_sms_draft: null,
        guardrail_reason: "event_type_not_allowed",
        details: { attempted: finalType },
      };
    }
    if (proposal.outcome_confidence < serverContext.confidence_floor) {
      return {
        status: "blocked",
        final_event_type: null,
        should_write_event: false,
        final_sms_draft: null,
        guardrail_reason: "below_confidence_floor",
        details: { confidence: proposal.outcome_confidence, floor: serverContext.confidence_floor },
      };
    }
  }

  if (serverContext.duplicate_outcome_write_risk && proposal.should_write_outcome_event) {
    return {
      status: "blocked",
      final_event_type: null,
      should_write_event: false,
      final_sms_draft: null,
      guardrail_reason: "duplicate_outcome_write_risk",
    };
  }

  /** Clarification saturation — prefer blocking clarification-heavy replies when window exhausted. */
  if (
    proposal.needs_clarification &&
    serverContext.recent_clarification_count_heuristic >= serverContext.max_clarify_per_window
  ) {
    return {
      status: "overridden",
      final_event_type: null,
      should_write_event: false,
      final_sms_draft: null,
      guardrail_reason: "clarification_saturation_no_safe_override_text",
      details: {
        recent_clarifications: serverContext.recent_clarification_count_heuristic,
        max: serverContext.max_clarify_per_window,
      },
    };
  }

  if (!proposal.should_write_outcome_event) {
    /** Non-scoring turns still allow an informational SMS if language-clean (caller may fallback). */
    return {
      status: "approved",
      final_event_type: null,
      should_write_event: false,
      final_sms_draft: proposal.final_sms_draft.trim(),
      guardrail_reason: "approved_non_outcome_reply",
    };
  }

  return {
    status: "approved",
    final_event_type: finalType,
    should_write_event: true,
    final_sms_draft: proposal.final_sms_draft.trim(),
    guardrail_reason: "approved_outcome_write",
  };
}
