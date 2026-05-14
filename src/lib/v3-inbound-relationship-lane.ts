/**
 * Inbound Central V3 Relationship Lane — Phase 3A/3B (normal active-commitment inbound) + 3D-a/3D-b
 * (central_brain_pivot, arc_clarify_ambiguous_short, central_brain_blocker_pivot, blocker_capture_ack)
 * + 3C (open_question_answer) + 3E (refresh, pending_resolution, memory confirmation).
 * OpenAI authors the visible inbound reply; V2 / brain / templates are facts only (no seed prose).
 */

import OpenAI from "openai";

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { V2InboundGatedDecision } from "@/lib/v2-ai-inbound";
import type { V2SmsCommitmentIntentPack } from "@/lib/v2-sms-commitment-change";
import type { NorthStarSmsContextPacket } from "@/lib/north-star-coach-sms";
import { detectFinalVoiceBlockedReasons } from "@/lib/v3-sms-voice-ownership";
import { V3_BRAIN_VERSION } from "@/lib/v3-sms-brain";

const INBOUND_LANE_MAX_CHARS = 320;

export type InboundV3RoutePurpose =
  | "normal_inbound_reply"
  | "central_brain_pivot"
  | "arc_clarify_ambiguous_short"
  | "central_brain_blocker_pivot"
  | "blocker_capture_ack"
  | "open_question_answer"
  | "refresh"
  | "refresh_identity"
  | "refresh_commitment"
  | "refresh_confirmation"
  | "refresh_clarification"
  | "pending_resolution"
  | "memory_confirmation"
  | "memory_decline"
  | "memory_clarification"
  | "adaptive_proposal_consent_accept"
  | "adaptive_proposal_consent_decline"
  | "adaptive_proposal_consent_noop_ack"
  | "adaptive_proposal_consent_clarification"
  | "commitment_change_handoff";

/** Pending adaptive proposal — user has not given clear YES/NO; server has taken no consent action. */
export type InboundV3AdaptiveConsentClarificationFacts = {
  latest_outbound_was_proposal: boolean;
  pending_proposal_valid: boolean;
  proposal_kind: string;
  proposal_text_digest: string;
  inbound_parse: "ambiguous" | "question" | "explanation_request" | "consent_adjacent";
  server_action_taken: "none";
  state_remains_pending: true;
  required_meaning_summary: string;
  /** Non-speakable deterministic stub — metadata only. */
  legacy_clarification_preview: string;
  inbound_message_sid: string;
};

export type InboundV3CommitmentChangeFacts = {
  detected_intent_type: V2SmsCommitmentIntentPack["intent"];
  current_commitment_snapshot: string;
  requested_change_summary: string;
  pending_resolution_created: boolean;
  pending_resolution_type: "commitment_tighten" | "commitment_replace" | null;
  pending_resolution_skip_reason: string | null;
  /** Populated when `applyWave4SmsCommitmentPendingResolution` threw before returning a result. */
  pending_resolution_apply_exception: string | null;
  existing_pending_resolution: boolean;
  candidate_tightened_bar_preview: string | null;
  candidate_new_bar_preview: string | null;
  server_state_transition_summary: string;
  required_verbatim_substrings?: string[];
  required_meaning_summary: string;
  /** Non-speakable legacy Wave4 coach string — metadata only. */
  legacy_commitment_change_reply_preview: string;
  /** Non-speakable note that would have been merged in the old path — metadata only. */
  append_note_preview: string | null;
  inbound_message_sid: string;
};

export type Wave4SmsPendingApplyResult = {
  pendingApplied: boolean;
  pendingKind: import("@/lib/v2-guided-resolution").V2PendingResolutionKind | null;
  skipReason: import("@/lib/v2-sms-commitment-change").Wave4PendingSkipReason | null;
};

const INBOUND_COMMITMENT_CHANGE_EXISTING_PENDING_NOTE =
  "You already have a commitment update in progress—reply here to finish it before starting another.";

/**
 * Server-only facts for commitment_change_handoff inbound lane (no user-visible prose authority).
 */
export function buildCommitmentChangeInboundFactsFromWave4(args: {
  intentPack: V2SmsCommitmentIntentPack;
  commitment: ActiveV2CommitmentRow;
  effectiveAsk: string;
  userMessage: string;
  messageSid: string;
  wave4: Wave4SmsPendingApplyResult;
  pendingResolutionApplyException: string | null;
  /** Non-speakable legacy Wave4 coach string — pass from `buildSmsCommitmentChangeCoachReply` at the route layer. */
  legacyCommitmentChangeReplyPreview: string;
}): InboundV3CommitmentChangeFacts {
  const legacy = args.legacyCommitmentChangeReplyPreview.trim();
  const legacyPreview = legacy.length > 500 ? `${legacy.slice(0, 497)}...` : legacy;
  const existingPending = args.wave4.skipReason === "existing_pending";
  const appendPreview = existingPending ? INBOUND_COMMITMENT_CHANGE_EXISTING_PENDING_NOTE : null;

  const pendingCreated = args.wave4.pendingApplied === true;
  const pk = args.wave4.pendingKind;
  const pendingType: "commitment_tighten" | "commitment_replace" | null =
    pendingCreated && (pk === "commitment_tighten" || pk === "commitment_replace") ? pk : null;

  let serverSummary: string;
  if (args.pendingResolutionApplyException?.trim()) {
    serverSummary = `pending_resolution_apply_failed:${args.pendingResolutionApplyException.trim().slice(0, 160)}`;
  } else if (pendingCreated && pendingType === "commitment_tighten") {
    serverSummary = "pending_resolution_upserted:commitment_tighten";
  } else if (pendingCreated && pendingType === "commitment_replace") {
    serverSummary = "pending_resolution_upserted:commitment_replace";
  } else if (args.wave4.skipReason === "soft_quit") {
    serverSummary = "pending_resolution_skipped:soft_quit";
  } else if (args.wave4.skipReason === "paused_reactivation") {
    serverSummary = "pending_resolution_skipped:paused_reactivation";
  } else if (args.wave4.skipReason === "refresh_session_active") {
    serverSummary = "pending_resolution_skipped:refresh_session_active";
  } else if (args.wave4.skipReason === "existing_pending") {
    serverSummary = "pending_resolution_skipped:existing_pending";
  } else {
    serverSummary = "pending_resolution_unchanged";
  }

  const snapParts = [
    `title:${args.commitment.title?.trim().slice(0, 80) ?? ""}`,
    `behavior:${(args.commitment.behavior_statement ?? "").trim().replace(/\s+/g, " ").slice(0, 200)}`,
    `effective_ask:${args.effectiveAsk.trim().replace(/\s+/g, " ").slice(0, 200)}`,
  ];
  const currentCommitmentSnapshot = snapParts.join(" | ");

  const reqLines: string[] = [
    "Server state is already decided from facts — do not invent commitment terms or claim the written commitment row already changed.",
    "If pending_resolution_created is true: an SMS update flow was started — explain the honest next step without claiming the commitment is permanently rewritten or locked in.",
    "If pending_resolution_created is false: do not imply a new pending SMS update was created; do not promise a DB commitment mutation occurred.",
    "If existing_pending_resolution is true: communicate that the user should finish the current in-flight commitment update before starting another (meaning may paraphrase; do not quote legacy preview).",
    "legacy_commitment_change_reply_preview and append_note_preview are NON-SPEAKABLE metadata — do not quote, imitate, paste, or treat them as your voice.",
  ];
  if (appendPreview) {
    reqLines.push(
      `Honor the meaning of the in-flight update constraint (same intent as append_note_preview) without pasting that text verbatim unless it appears in constraints.required_verbatim_substrings.`
    );
  }

  const requiredVerbatim =
    appendPreview && appendPreview.length > 0 ? [appendPreview] : undefined;

  return {
    detected_intent_type: args.intentPack.intent,
    current_commitment_snapshot: currentCommitmentSnapshot,
    requested_change_summary: args.userMessage.trim().replace(/\s+/g, " ").slice(0, 320),
    pending_resolution_created: pendingCreated,
    pending_resolution_type: pendingType,
    pending_resolution_skip_reason: args.wave4.skipReason,
    pending_resolution_apply_exception: args.pendingResolutionApplyException?.trim() || null,
    existing_pending_resolution: Boolean(existingPending),
    candidate_tightened_bar_preview: args.intentPack.candidateTightenedBar?.trim()
      ? args.intentPack.candidateTightenedBar.trim().replace(/\s+/g, " ").slice(0, 200)
      : null,
    candidate_new_bar_preview: args.intentPack.candidateNewBar?.trim()
      ? args.intentPack.candidateNewBar.trim().replace(/\s+/g, " ").slice(0, 200)
      : null,
    server_state_transition_summary: serverSummary,
    ...(requiredVerbatim ? { required_verbatim_substrings: requiredVerbatim } : {}),
    required_meaning_summary: reqLines.join(" "),
    legacy_commitment_change_reply_preview: legacyPreview,
    append_note_preview: appendPreview,
    inbound_message_sid: args.messageSid,
  };
}

/** Adaptive overlay proposal consent — server already applied/declined; legacy ACK is preview only. */
export type InboundV3ContractConsentFacts = {
  consent_parse: "user_yes" | "user_no";
  latest_outbound_was_proposal: boolean;
  proposal_kind: string;
  /** Short digest for facts JSON (not full binding when long). */
  proposal_text_digest: string;
  overlay_action:
    | "activated"
    | "declined"
    | "noop_already_applied"
    | "noop_not_found"
    | "noop_state_conflict";
  rpc_result: string;
  server_state_transition_summary: string;
  required_verbatim_substrings?: string[];
  required_meaning_summary?: string | null;
  /** Non-speakable legacy template / prior-writer preview — metadata only. */
  legacy_contract_ack_preview: string;
  inbound_message_sid: string;
  proposal_expires_at: string | null;
};

/** Refresh session — machine/template preview is metadata only. */
export type InboundV3RefreshFacts = {
  refresh_step: string;
  expected_answer: string;
  user_answer_type: string;
  state_transition_summary: string;
  updated_identity_anchor?: string | null;
  updated_commitment_bar?: string | null;
  /** Non-speakable legacy refresh machine/template copy. */
  legacy_refresh_reply_preview: string;
  required_verbatim_substrings?: string[];
  required_meaning_summary?: string | null;
};

export type InboundV3PendingResolutionFacts = {
  resolution_type: string;
  pending_action: string;
  user_answer_type: string;
  state_transition_summary: string;
  updated_commitment_snapshot: string;
  /** Non-speakable legacy pending-resolution reply body. */
  legacy_pending_reply_preview: string;
  required_verbatim_substrings?: string[];
  required_meaning_summary?: string | null;
};

export type InboundV3MemoryConfirmationFacts = {
  pending_memory_kind: string;
  candidate_memory_fields: string;
  user_confirmation_parse: string;
  memory_applied: boolean;
  memory_declined: boolean;
  ambiguous: boolean;
  /** Non-speakable legacy fixed/refined reply preview. */
  legacy_memory_reply_preview: string;
  required_verbatim_substrings?: string[];
  required_meaning_summary?: string | null;
  /** Structured proof hint for telemetry — not copyable SMS append. */
  memory_proof_structured_hint?: string | null;
};

/** Semantic resolution + legacy writer preview only (not speakable coach voice). */
export type InboundV3OpenQuestionFacts = {
  latest_open_question: string | null;
  expected_reply_semantics: string;
  resolution_subkind: string;
  extracted_answer: string | null;
  answer_kind: string | null;
  /** Non-speakable legacy OpenAI/deterministic writer preview — metadata only. */
  old_open_question_reply_preview: string;
  deterministic_fallback_used: boolean;
  deterministic_fallback_reason: string | null;
  legacy_open_question_reply_source: "openai" | "deterministic_fallback";
  latest_outbound_preview: string | null;
};

/** Facts-only payload when central brain blocks outcome scoring (pivot path). */
export type InboundV3CentralBrainPivotFacts = {
  blocked_outcome_scoring: boolean;
  central_turn_purpose: string | null;
  confidence: number | null;
  reason: string;
  suggested_move: string;
  /** Non-speakable legacy tether preview (metadata only). */
  legacy_tether_text_preview: string;
};

/** Facts-only payload when ARC forces ambiguous-short clarification. */
export type InboundV3ArcClarificationFacts = {
  ambiguous_short_reply: boolean;
  tentative_outcome: "user_yes" | "user_no" | "user_partial";
  clarification_reason: string | null;
  context_age: {
    accountability_prompt_age_minutes: number | null;
    accountability_prompt_sent_at: string | null;
    latest_outcome_at: string | null;
  };
  latest_question: string | null;
  /** Non-speakable legacy clarification template preview (metadata only). */
  legacy_clarification_text_preview: string;
};

/** Central brain blocked blocker capture — tether preview is facts only. */
export type InboundV3CentralBrainBlockerPivotFacts = {
  blocked_blocker_capture: boolean;
  central_turn_purpose: string | null;
  confidence: number | null;
  reason: string;
  suggested_move: string;
  blocker_text: string;
  /** Non-speakable legacy tether preview (metadata only). */
  legacy_tether_text_preview: string;
};

/** Blocker capture ACK — legacy AI/template ack is facts only. */
export type InboundV3BlockerFacts = {
  blocker_text: string;
  blocker_category: string | null;
  repeated_blocker_signal: boolean;
  following_event_type: string;
  /** Minutes until blocker capture window expires, if known. */
  blocker_pending_age_minutes_remaining: number | null;
  suggested_next_move: string | null;
  /** Non-speakable legacy ack (AI or template) preview (metadata only). */
  legacy_blocker_ack_preview: string;
};

export type InboundV3ConversationBrainFacts = {
  enabled: boolean;
  model?: string | null;
  guardrail_status?: string | null;
  turn_kind?: string | null;
  outcome_confidence?: number | null;
  reply_strategy?: string | null;
  needs_clarification?: boolean | null;
  repeated_clarification_risk?: boolean | null;
  /** Server outcome type the brain approved — not prose. */
  final_event_type?: string | null;
} | null;

export type InboundV3CentralBrainFacts = {
  shadow_stored: boolean;
  central_turn_purpose?: string | null;
  confidence?: number | null;
  /** When true, outbound outcome scoring was blocked (pivot path) — main lane path only receives shadow summary. */
  blocked_outcome_scoring?: boolean | null;
} | null;

export type InboundV3ArcFacts = {
  ambiguous_short_reply?: boolean | null;
  /** When true, ARC would have forced clarification — user stays on main path only if false. */
  clarification_required?: boolean | null;
} | null;

export type InboundV3RelationshipFacts = {
  route_purpose: InboundV3RoutePurpose;
  branch_name?: string | null;
  branch_migrated_to_lane?: boolean;
  central_brain_pivot_facts?: InboundV3CentralBrainPivotFacts | null;
  arc_clarification_facts?: InboundV3ArcClarificationFacts | null;
  central_brain_blocker_pivot_facts?: InboundV3CentralBrainBlockerPivotFacts | null;
  blocker_facts?: InboundV3BlockerFacts | null;
  open_question_facts?: InboundV3OpenQuestionFacts | null;
  refresh_facts?: InboundV3RefreshFacts | null;
  pending_resolution_facts?: InboundV3PendingResolutionFacts | null;
  memory_confirmation_facts?: InboundV3MemoryConfirmationFacts | null;
  contract_consent_facts?: InboundV3ContractConsentFacts | null;
  adaptive_consent_clarification_facts?: InboundV3AdaptiveConsentClarificationFacts | null;
  commitment_change_facts?: InboundV3CommitmentChangeFacts | null;
  user: {
    clerk_user_id: string;
    preferred_name: string | null;
    timezone: string;
    local_time_iso: string;
    relationship_profile_summary: string | null;
  };
  commitment: {
    id: string;
    title: string;
    behavior_statement: string;
    effective_ask: string;
    accountability_phase: string;
  };
  thread: {
    latest_inbound_raw: string;
    /** After rapid-split coalescing when applied upstream; else same as raw. */
    coalesced_inbound_text: string;
    suppressed_message_sids: string[];
    recent_transcript_lines: string[];
    latest_outbound_coach_sms: string | null;
    latest_open_question: string | null;
    expected_reply_semantics: string | null;
    do_not_repeat_hints: string[];
    rejected_time_candidates: string[];
    unavailable_windows: string[];
  };
  v2_accountability: {
    deterministic_classifier_event: "user_yes" | "user_no" | "user_partial";
    gated_mode: string;
    final_event_type: string | null;
    should_write_outcome_event: boolean;
    reply_style: string | null;
    /** Structured only — not prior SMS drafts. */
    proof_signal: boolean;
    miss_signal: boolean;
    blocker_signal: boolean;
    today_completed: boolean;
    future_intent_hint: string | null;
    supplement_commitment_change_guidance: boolean;
  };
  legacy_suggestions: {
    conversation_brain: InboundV3ConversationBrainFacts;
    central_brain: InboundV3CentralBrainFacts;
    arc: InboundV3ArcFacts;
    phase5a: {
      central_tether_brain_enabled: boolean;
      arc_clarify_brain_enabled: boolean;
      inbound_stitched_final_enabled: boolean;
    };
    forced_future_stretch_intent_active: boolean;
    wave11_memory_confirmation_pending: boolean;
    /** Proof / victory structured hints — not appended marketing copy. */
    accountability_proof_hint: string | null;
  };
  suggested_coaching_move: string;
  constraints: {
    max_chars: number;
    one_sms: true;
    no_generic_motivation: true;
    no_quoted_or_truncated_echo_of_inbound: true;
    if_unsafe_return_no_send: true;
    /** Substrings that must NOT appear in body (e.g. rejected times). */
    forbidden_substrings?: string[];
    /** Each substring MUST appear verbatim in body when non-empty (transactional accuracy). */
    required_verbatim_substrings?: string[];
    /** Coach must satisfy this meaning without contradicting server-owned state. */
    required_meaning_summary?: string | null;
  };
};

export type InboundV3RelationshipLaneInput = {
  facts: InboundV3RelationshipFacts;
  telemetry_fact_sources: string[];
};

export type InboundV3RelationshipLaneReplySource = "v3_inbound_relationship_lane";

export type InboundV3RelationshipLaneResult = {
  body: string;
  shouldSend: boolean;
  noSendReason: string | null;
  replySource: InboundV3RelationshipLaneReplySource;
  turnPurpose: string;
  voiceConfidence: number | null;
  usedFacts: string[];
  safetyNotes: string[];
  metadata: Record<string, unknown>;
  openAiOk: boolean;
};

type LaneModelJson = {
  should_send?: unknown;
  body?: unknown;
  no_send_reason?: unknown;
  turn_purpose?: unknown;
  voice_confidence?: unknown;
  used_facts?: unknown;
  safety_notes?: unknown;
  rejected_times_obeyed?: unknown;
  split_messages_handled?: unknown;
};

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean);
}

function safeJsonParse(raw: string): LaneModelJson | null {
  try {
    return JSON.parse(raw) as LaneModelJson;
  } catch {
    return null;
  }
}

function summarizeInboundFacts(f: InboundV3RelationshipFacts): string {
  const slim = {
    route_purpose: f.route_purpose,
    branch_migrated: f.branch_migrated_to_lane === true,
    branch_name: f.branch_migrated_to_lane === true ? f.branch_name ?? null : null,
    pivot_facts: f.central_brain_pivot_facts != null,
    blocker_pivot_facts: f.central_brain_blocker_pivot_facts != null,
    blocker_ack_facts: f.blocker_facts != null,
    arc_clarify_facts: f.arc_clarification_facts != null,
    open_question_facts: f.open_question_facts != null,
    refresh_facts: f.refresh_facts != null,
    pending_resolution_facts: f.pending_resolution_facts != null,
    memory_confirmation_facts: f.memory_confirmation_facts != null,
    contract_consent_facts: f.contract_consent_facts != null,
    adaptive_consent_clarification_facts: f.adaptive_consent_clarification_facts != null,
    commitment_change_facts: f.commitment_change_facts != null,
    gated_mode: f.v2_accountability.gated_mode,
    final_event_type: f.v2_accountability.final_event_type,
    classifier: f.v2_accountability.deterministic_classifier_event,
    suggested_move: f.suggested_coaching_move,
    proof: f.v2_accountability.proof_signal,
    miss: f.v2_accountability.miss_signal,
    wave11_pending: f.legacy_suggestions.wave11_memory_confirmation_pending,
    conversation_brain_on: f.legacy_suggestions.conversation_brain?.enabled ?? false,
    central_shadow: f.legacy_suggestions.central_brain?.shadow_stored ?? false,
  };
  const s = JSON.stringify(slim);
  return s.length > 1200 ? `${s.slice(0, 1199)}…` : s;
}

export function slimCentralBrainPivotFactsForTelemetry(
  f: InboundV3CentralBrainPivotFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    blocked_outcome_scoring: f.blocked_outcome_scoring,
    central_turn_purpose: f.central_turn_purpose,
    confidence: f.confidence,
    reason: f.reason,
    suggested_move: f.suggested_move,
    legacy_tether_text_preview_len: f.legacy_tether_text_preview.length,
  };
}

export function slimArcClarificationFactsForTelemetry(
  f: InboundV3ArcClarificationFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    ambiguous_short_reply: f.ambiguous_short_reply,
    tentative_outcome: f.tentative_outcome,
    clarification_reason: f.clarification_reason,
    context_age: f.context_age,
    latest_question_len: f.latest_question != null ? f.latest_question.length : 0,
    legacy_clarification_text_preview_len: f.legacy_clarification_text_preview.length,
  };
}

export function slimCentralBrainBlockerPivotFactsForTelemetry(
  f: InboundV3CentralBrainBlockerPivotFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    blocked_blocker_capture: f.blocked_blocker_capture,
    central_turn_purpose: f.central_turn_purpose,
    confidence: f.confidence,
    reason: f.reason,
    suggested_move: f.suggested_move,
    blocker_text_len: f.blocker_text.length,
    legacy_tether_text_preview_len: f.legacy_tether_text_preview.length,
  };
}

export function slimBlockerFactsForTelemetry(f: InboundV3BlockerFacts | null | undefined): Record<string, unknown> | null {
  if (!f) return null;
  return {
    following_event_type: f.following_event_type,
    blocker_category: f.blocker_category,
    repeated_blocker_signal: f.repeated_blocker_signal,
    blocker_pending_age_minutes_remaining: f.blocker_pending_age_minutes_remaining,
    blocker_text_len: f.blocker_text.length,
    legacy_blocker_ack_preview_len: f.legacy_blocker_ack_preview.length,
    has_suggested_next_move: f.suggested_next_move != null && f.suggested_next_move.trim().length > 0,
  };
}

export function slimOpenQuestionFactsForTelemetry(
  f: InboundV3OpenQuestionFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    resolution_subkind: f.resolution_subkind,
    answer_kind: f.answer_kind,
    extracted_answer_len: f.extracted_answer?.trim().length ?? 0,
    old_open_question_reply_preview_len: f.old_open_question_reply_preview.length,
    deterministic_fallback_used: f.deterministic_fallback_used,
    legacy_open_question_reply_source: f.legacy_open_question_reply_source,
    latest_outbound_preview_len: f.latest_outbound_preview?.trim().length ?? 0,
  };
}

export function slimRefreshFactsForTelemetry(f: InboundV3RefreshFacts | null | undefined): Record<string, unknown> | null {
  if (!f) return null;
  return {
    refresh_step: f.refresh_step,
    user_answer_type: f.user_answer_type,
    expected_answer_len: f.expected_answer?.length ?? 0,
    legacy_refresh_reply_preview_len: f.legacy_refresh_reply_preview.length,
    required_verbatim_count: f.required_verbatim_substrings?.length ?? 0,
    has_required_meaning: Boolean(f.required_meaning_summary?.trim()),
  };
}

export function slimPendingResolutionFactsForTelemetry(
  f: InboundV3PendingResolutionFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    resolution_type: f.resolution_type,
    pending_action: f.pending_action,
    user_answer_type: f.user_answer_type,
    legacy_pending_reply_preview_len: f.legacy_pending_reply_preview.length,
    updated_commitment_snapshot_len: f.updated_commitment_snapshot.length,
    required_verbatim_count: f.required_verbatim_substrings?.length ?? 0,
    has_required_meaning: Boolean(f.required_meaning_summary?.trim()),
  };
}

export function slimMemoryConfirmationFactsForTelemetry(
  f: InboundV3MemoryConfirmationFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    pending_memory_kind: f.pending_memory_kind,
    user_confirmation_parse: f.user_confirmation_parse,
    memory_applied: f.memory_applied,
    memory_declined: f.memory_declined,
    ambiguous: f.ambiguous,
    legacy_memory_reply_preview_len: f.legacy_memory_reply_preview.length,
    required_verbatim_count: f.required_verbatim_substrings?.length ?? 0,
    has_required_meaning: Boolean(f.required_meaning_summary?.trim()),
    has_proof_hint: Boolean(f.memory_proof_structured_hint?.trim()),
  };
}

export function slimContractConsentFactsForTelemetry(
  f: InboundV3ContractConsentFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    consent_parse: f.consent_parse,
    proposal_kind: f.proposal_kind,
    overlay_action: f.overlay_action,
    rpc_result: f.rpc_result,
    proposal_text_digest_len: f.proposal_text_digest.length,
    legacy_contract_ack_preview_len: f.legacy_contract_ack_preview.length,
    required_verbatim_count: f.required_verbatim_substrings?.length ?? 0,
    has_required_meaning: Boolean(f.required_meaning_summary?.trim()),
    latest_outbound_was_proposal: f.latest_outbound_was_proposal,
  };
}

export function slimAdaptiveConsentClarificationFactsForTelemetry(
  f: InboundV3AdaptiveConsentClarificationFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    pending_proposal_valid: f.pending_proposal_valid,
    latest_outbound_was_proposal: f.latest_outbound_was_proposal,
    proposal_kind: f.proposal_kind,
    inbound_parse: f.inbound_parse,
    server_action_taken: f.server_action_taken,
    state_remains_pending: f.state_remains_pending,
    proposal_text_digest_len: f.proposal_text_digest.length,
    legacy_clarification_preview_len: f.legacy_clarification_preview.length,
    has_required_meaning: Boolean(f.required_meaning_summary?.trim()),
  };
}

export function slimCommitmentChangeFactsForTelemetry(
  f: InboundV3CommitmentChangeFacts | null | undefined
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    detected_intent_type: f.detected_intent_type,
    pending_resolution_created: f.pending_resolution_created,
    pending_resolution_type: f.pending_resolution_type,
    pending_resolution_skip_reason: f.pending_resolution_skip_reason,
    pending_resolution_apply_exception: f.pending_resolution_apply_exception,
    existing_pending_resolution: f.existing_pending_resolution,
    server_state_transition_summary: f.server_state_transition_summary,
    legacy_preview_len: f.legacy_commitment_change_reply_preview.length,
    append_note_preview_len: f.append_note_preview?.length ?? 0,
    required_verbatim_count: f.required_verbatim_substrings?.length ?? 0,
    has_required_meaning: Boolean(f.required_meaning_summary?.trim()),
    inbound_message_sid: f.inbound_message_sid,
  };
}

export function deriveSuggestedCoachingMoveForInboundFacts(f: InboundV3RelationshipFacts): string {
  if (f.central_brain_pivot_facts) {
    const m = f.central_brain_pivot_facts.suggested_move?.trim();
    return m && m.length > 0 ? m : "pivot_respond_humanely";
  }
  if (f.central_brain_blocker_pivot_facts) {
    const m = f.central_brain_blocker_pivot_facts.suggested_move?.trim();
    return m && m.length > 0 ? m : "blocker_pivot_respond_humanely";
  }
  if (f.arc_clarification_facts) {
    return "clarify_ambiguous_short_natural_sms";
  }
  if (f.blocker_facts) {
    return "acknowledge_blocker_capture";
  }
  if (f.adaptive_consent_clarification_facts) {
    return "ask_clear_yes_or_no_for_pending_adaptive_proposal";
  }
  if (f.commitment_change_facts) {
    return "commitment_change_handoff_respond_with_server_owned_next_steps";
  }
  if (f.contract_consent_facts) {
    if (f.route_purpose === "adaptive_proposal_consent_decline") {
      return "acknowledge_adaptive_overlay_declined";
    }
    if (f.route_purpose === "adaptive_proposal_consent_noop_ack") {
      return "acknowledge_adaptive_proposal_noop";
    }
    return "acknowledge_adaptive_overlay_accepted";
  }
  if (f.refresh_facts) {
    return "continue_refresh_coach_sms";
  }
  if (f.pending_resolution_facts) {
    return "continue_pending_resolution_coach_sms";
  }
  if (f.memory_confirmation_facts) {
    if (f.route_purpose === "memory_decline") return "acknowledge_memory_declined";
    if (f.route_purpose === "memory_clarification") return "clarify_memory_confirmation_reply";
    return "acknowledge_memory_update_outcome";
  }
  if (f.open_question_facts) {
    return "respond_to_open_question_answer_natural";
  }
  const ft = f.v2_accountability.final_event_type;
  if (ft === "user_yes") return "acknowledge_completion";
  if (ft === "user_no") return "name_blocker";
  if (ft === "user_partial") return "narrow_blocker";
  if (f.v2_accountability.gated_mode === "clarify") return "clarify_intent";
  return "ask_accountability";
}

function validateForbiddenSubstrings(body: string, forbidden: string[] | undefined): string | null {
  if (!forbidden?.length) return null;
  const lower = body.toLowerCase();
  for (const sub of forbidden) {
    const t = sub.trim();
    if (!t) continue;
    if (lower.includes(t.toLowerCase())) return t;
  }
  return null;
}

/** Returns first required substring missing from body, or null if all present. */
function validateRequiredVerbatimSubstrings(body: string, required: string[] | undefined): string | null {
  if (!required?.length) return null;
  for (const sub of required) {
    const t = sub.trim();
    if (!t) continue;
    if (!body.includes(t)) return t;
  }
  return null;
}

export type RequiredVerbatimAssertionStage = "lane" | "post_north_star" | "post_final_voice_gate";

/**
 * Multi-stage binding survival check for contract consent (and similar).
 * Empty required list → ok.
 */
export function assertRequiredVerbatimSubstringsPresent(
  stage: RequiredVerbatimAssertionStage,
  body: string,
  requiredSubstrings: string[] | undefined | null
): { ok: boolean; missing: string[]; stage: RequiredVerbatimAssertionStage } {
  const missing: string[] = [];
  if (requiredSubstrings?.length) {
    for (const sub of requiredSubstrings) {
      const t = sub.trim();
      if (!t) continue;
      if (!body.includes(t)) missing.push(t);
    }
  }
  return { ok: missing.length === 0, missing, stage };
}

/** YES-path binding substring — exact characters from proposal head (≤28) for lane verbatim match. */
export function contractConsentYesBindingVerbatimSubstring(proposalText: string): string | null {
  const t = proposalText.trim();
  if (!t) return null;
  if (t.length > 28) return t.slice(0, 28);
  return t;
}

function validateNoRejectedTimeRepeat(body: string, rejected: string[]): string | null {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const b = norm(body);
  for (const r of rejected) {
    const t = r.trim();
    if (t.length < 2) continue;
    if (b.includes(norm(t))) return t;
  }
  return null;
}

function buildRoutePurposeAux(f: InboundV3RelationshipFacts): string {
  const rp = f.route_purpose;
  if (rp === "central_brain_pivot") {
    return `
ROUTE (central_brain_pivot): Outcome scoring was blocked by central brain for this turn. Use central_brain_pivot_facts for central_turn_purpose, confidence, reason, and suggested_move. The field legacy_tether_text_preview is NON-SPEAKABLE legacy machine/coached copy — do not quote it, imitate it, paste it, or treat it as your voice. Write one fresh humane SMS as the coach for this pivot.`;
  }
  if (rp === "central_brain_blocker_pivot") {
    return `
ROUTE (central_brain_blocker_pivot): Blocker capture was blocked by central brain for this turn. Use central_brain_blocker_pivot_facts (central_turn_purpose, confidence, reason, suggested_move, blocker_text). The field legacy_tether_text_preview is NON-SPEAKABLE legacy machine/coached copy — do not quote it, imitate it, paste it, or treat it as your voice. Write one fresh humane SMS as the coach for this pivot.`;
  }
  if (rp === "blocker_capture_ack") {
    return `
ROUTE (blocker_capture_ack): The user submitted blocker text after a miss; server already owns state. Use blocker_facts (blocker_text, following_event_type, repeated_blocker_signal, blocker_pending_age_minutes_remaining, suggested_next_move). The field legacy_blocker_ack_preview is NON-SPEAKABLE legacy AI/template copy — do not quote it, imitate it, paste it, or treat it as your voice. Write one short SMS acknowledging the blocker and holding the standard, as the coach.`;
  }
  if (rp === "arc_clarify_ambiguous_short") {
    return `
ROUTE (arc_clarify_ambiguous_short): The user's latest reply is ambiguous relative to accountability context. Use arc_clarification_facts (tentative_outcome, clarification_reason, context_age, latest_question). The field legacy_clarification_text_preview is NON-SPEAKABLE legacy template copy — do not quote it, imitate it, paste it, or treat it as your voice. Write one natural clarifying SMS as the coach.`;
  }
  if (rp === "open_question_answer") {
    return `
ROUTE (open_question_answer): The user is answering the coach's latest question in-thread. Use open_question_facts (latest_open_question, expected_reply_semantics, resolution_subkind, extracted_answer, answer_kind) plus thread and commitment facts. The field old_open_question_reply_preview is NON-SPEAKABLE legacy machine copy from an old writer path — do not quote it, imitate it, paste it, or treat it as your voice. Write the NEXT SMS as the coach responding naturally to the user's answer.`;
  }
  if (rp === "refresh" || rp.startsWith("refresh_")) {
    return `
ROUTE (${rp}): Guided refresh-session SMS. Server already applied refresh_state / transitions in facts — do NOT invent, undo, or alter commitments or identity from prose. Use refresh_facts (refresh_step, user_answer_type, expected_answer, state_transition_summary, updated_identity_anchor, updated_commitment_bar). legacy_refresh_reply_preview is NON-SPEAKABLE machine/template copy — do not quote, imitate, or paste it. If constraints.required_verbatim_substrings is non-empty, include EVERY listed substring exactly in body. If constraints.required_meaning_summary is set, satisfy it accurately. Write ONE SMS as the coach continuing the thread.`;
  }
  if (rp === "pending_resolution") {
    return `
ROUTE (pending_resolution): SMS pending guided-resolution completion. Server already applied the pending action — do NOT invent a different commitment state. Use pending_resolution_facts (resolution_type, pending_action, user_answer_type, state_transition_summary, updated_commitment_snapshot). legacy_pending_reply_preview is NON-SPEAKABLE machine copy — do not quote, imitate, or paste it. Honor required_verbatim_substrings / required_meaning_summary in constraints when present. Write ONE SMS as the coach acknowledging the outcome and next thread move.`;
  }
  if (rp === "memory_confirmation" || rp === "memory_decline" || rp === "memory_clarification") {
    return `
ROUTE (${rp}): Wave 11 memory confirmation / decline / ambiguity. Server already decided memory_applied / memory_declined / ambiguous flags — do NOT contradict them or claim updates that did not occur. Use memory_confirmation_facts (pending_memory_kind, candidate_memory_fields, user_confirmation_parse, flags). legacy_memory_reply_preview is NON-SPEAKABLE fixed/refined copy — do not quote, imitate, or paste it. memory_proof_structured_hint is structured telemetry only — do not paste it verbatim. Honor required_verbatim_substrings / required_meaning_summary when present. Write ONE SMS as the coach.`;
  }
  if (rp === "adaptive_proposal_consent_clarification") {
    return `
ROUTE (adaptive_proposal_consent_clarification): A pending adaptive overlay proposal is on the table; the user has NOT clearly accepted or declined (server_action_taken none; state_remains_pending true). Use adaptive_consent_clarification_facts (inbound_parse, proposal_kind, proposal_text_digest, latest_outbound_was_proposal). legacy_clarification_preview is NON-SPEAKABLE stub copy — do not quote, imitate, or paste it. Do NOT treat this as today's accountability check outcome. Do NOT imply the overlay was accepted or declined. Ask for an explicit YES or NO about the proposal only. Honor constraints.required_meaning_summary. One short SMS; if unsafe or uncertain, return should_send false.`;
  }
  if (rp === "commitment_change_handoff") {
    return `
ROUTE (commitment_change_handoff): User signaled a commitment change without a clear accountability score for today. Server already ran pending-resolution logic — use commitment_change_facts only (pending_resolution_created, pending_resolution_skip_reason, existing_pending_resolution, server_state_transition_summary, candidate previews). Do NOT claim the written commitment row already changed unless facts explicitly say so (they do not here). pending_resolution_created true means an SMS update flow was started, not that the commitment is finalized. legacy_commitment_change_reply_preview and append_note_preview are NON-SPEAKABLE metadata — do not quote, imitate, or paste them. Honor constraints.required_verbatim_substrings and constraints.required_meaning_summary when present. One short SMS; if unsafe or uncertain, return should_send false.`;
  }
  if (
    rp === "adaptive_proposal_consent_accept" ||
    rp === "adaptive_proposal_consent_decline" ||
    rp === "adaptive_proposal_consent_noop_ack"
  ) {
    return `
ROUTE (${rp}): Adaptive overlay proposal consent. Server already decided overlay_action / rpc_result — do NOT invent YES/NO, do NOT activate/decline overlays from prose, do NOT invent contract terms. Use contract_consent_facts (consent_parse, overlay_action, proposal_kind, proposal_text_digest, server_state_transition_summary, inbound_message_sid). legacy_contract_ack_preview is NON-SPEAKABLE legacy template preview — do not quote, imitate, or paste it. If constraints.required_verbatim_substrings is non-empty, include EVERY substring exactly. If constraints.required_meaning_summary is set, satisfy it without contradicting server flags. One short SMS.`;
  }
  return "";
}

/**
 * Normal accountability inbound: one relationship turn, JSON-only model output, fail-closed.
 */
export async function produceInboundV3RelationshipSms(
  args: InboundV3RelationshipLaneInput
): Promise<InboundV3RelationshipLaneResult> {
  const baseMeta: Record<string, unknown> = {
    v3_brain_version: V3_BRAIN_VERSION,
    inbound_v3_lane_used: true,
    v3_lane_reply_source: "v3_inbound_relationship_lane" satisfies InboundV3RelationshipLaneReplySource,
    old_inbound_writer_used_as_voice: false,
    old_inbound_writer_fact_sources: args.telemetry_fact_sources,
    inbound_facts_summary: summarizeInboundFacts(args.facts),
    suggested_coaching_move: args.facts.suggested_coaching_move,
    route_purpose: args.facts.route_purpose,
    ...(args.facts.branch_migrated_to_lane === true
      ? {
          branch_migrated_to_lane: true as const,
          branch_name: args.facts.branch_name ?? null,
        }
      : {}),
    ...(args.facts.central_brain_pivot_facts != null
      ? {
          central_brain_pivot_facts_summary: slimCentralBrainPivotFactsForTelemetry(
            args.facts.central_brain_pivot_facts
          ),
        }
      : {}),
    ...(args.facts.arc_clarification_facts != null
      ? {
          arc_clarification_facts_summary: slimArcClarificationFactsForTelemetry(
            args.facts.arc_clarification_facts
          ),
        }
      : {}),
    ...(args.facts.central_brain_blocker_pivot_facts != null
      ? {
          central_brain_blocker_pivot_facts_summary: slimCentralBrainBlockerPivotFactsForTelemetry(
            args.facts.central_brain_blocker_pivot_facts
          ),
        }
      : {}),
    ...(args.facts.blocker_facts != null
      ? { blocker_facts_summary: slimBlockerFactsForTelemetry(args.facts.blocker_facts) }
      : {}),
    ...(args.facts.open_question_facts != null
      ? {
          open_question_facts_summary: slimOpenQuestionFactsForTelemetry(args.facts.open_question_facts),
        }
      : {}),
    ...(args.facts.refresh_facts != null
      ? { refresh_facts_summary: slimRefreshFactsForTelemetry(args.facts.refresh_facts) }
      : {}),
    ...(args.facts.pending_resolution_facts != null
      ? {
          pending_resolution_facts_summary: slimPendingResolutionFactsForTelemetry(
            args.facts.pending_resolution_facts
          ),
        }
      : {}),
    ...(args.facts.memory_confirmation_facts != null
      ? {
          memory_confirmation_facts_summary: slimMemoryConfirmationFactsForTelemetry(
            args.facts.memory_confirmation_facts
          ),
        }
      : {}),
    ...(args.facts.contract_consent_facts != null
      ? {
          contract_consent_facts_summary: slimContractConsentFactsForTelemetry(
            args.facts.contract_consent_facts
          ),
        }
      : {}),
    ...(args.facts.adaptive_consent_clarification_facts != null
      ? {
          adaptive_consent_clarification_facts_summary: slimAdaptiveConsentClarificationFactsForTelemetry(
            args.facts.adaptive_consent_clarification_facts
          ),
        }
      : {}),
    ...(args.facts.commitment_change_facts != null
      ? {
          commitment_change_facts_summary: slimCommitmentChangeFactsForTelemetry(
            args.facts.commitment_change_facts
          ),
        }
      : {}),
    ...(args.facts.constraints.required_verbatim_substrings?.length
      ? { required_verbatim_substrings: args.facts.constraints.required_verbatim_substrings }
      : {}),
    ...(args.facts.constraints.required_meaning_summary?.trim()
      ? { required_meaning_summary: args.facts.constraints.required_meaning_summary }
      : {}),
    coalesced_inbound_body: args.facts.thread.coalesced_inbound_text,
    suppressed_message_sids: args.facts.thread.suppressed_message_sids,
    rejected_time_candidates: args.facts.thread.rejected_time_candidates,
    unavailable_windows: args.facts.thread.unavailable_windows,
    voice_writer_chain: ["v3_inbound_relationship_lane", "north_star_validator", "final_voice_gate"],
  };

  const empty = (reason: string, openAiOk: boolean, extra?: Record<string, unknown>): InboundV3RelationshipLaneResult => ({
    body: "",
    shouldSend: false,
    noSendReason: reason,
    replySource: "v3_inbound_relationship_lane",
    turnPurpose: "no_send",
    voiceConfidence: null,
    usedFacts: [],
    safetyNotes: [],
    metadata: { ...baseMeta, ...extra },
    openAiOk,
  });

  const client = getOpenAIClient();
  if (!client) {
    return empty("openai_unavailable", false, { lane_stage: "no_client" });
  }

  const factsJson = JSON.stringify(args.facts);
  const routePurposeAux = buildRoutePurposeAux(args.facts);

  const system = `You are writing the NEXT SMS in one long coaching relationship (months of thread). This is not an isolated ticket, form submission, or chatbot reset.

RULES:
- Use INBOUND_ACCOUNTABILITY_FACTS_JSON only as facts — never copy labeled machine drafts, template banks, or "prior hint" wording as your voice.
- Read the thread: latest inbound, latest outbound coach SMS, transcript lines, and open-question semantics.
- Anchor to the active commitment (effective ask + state). Do not paste raw title or behavior_statement as a quoted check.
- If the user corrected or rejected something in facts, do not repeat it. If rejected_time_candidates or forbidden_substrings list times or phrases, do not include them in your body.
- If constraints.required_verbatim_substrings is non-empty, the body MUST contain every listed substring exactly (verbatim substring match).
- If constraints.required_meaning_summary is set, the body MUST satisfy that meaning without contradicting server-owned flags in facts.
- If multiple recent lines reflect one combined intent, answer the combined meaning (facts may set split_messages_handled).
- One short SMS, max ${INBOUND_LANE_MAX_CHARS} characters, no newlines, one clear coach move.
- No generic motivation ("great job", "keep momentum", "you've got this", "make today count", "hope your", "checking in" as filler).
- Do not use: "what's the next concrete move", "Say it straight", or "Let's confirm" plus a rejected time.
- Do not quote or echo long user text; no truncated quotes.
- If unsafe, uncertain, or facts conflict badly, return should_send false.${routePurposeAux}

OUTPUT: strict JSON only with keys:
should_send (boolean), body (string, empty if should_send false), no_send_reason (string|null),
turn_purpose (string), voice_confidence (number 0-1 or null),
used_facts (string[]), safety_notes (string[]),
rejected_times_obeyed (boolean), split_messages_handled (boolean)`;

  const user = `INBOUND_ACCOUNTABILITY_FACTS_JSON (facts only; not copyable prose):
${factsJson.slice(0, 12000)}

Write JSON only.`;

  let raw = "";
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.35,
      max_tokens: 220,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    raw = completion.choices[0]?.message?.content?.trim() ?? "";
  } catch (e) {
    return empty("openai_request_failed", true, {
      lane_stage: "openai_error",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const parsed = safeJsonParse(raw);
  if (!parsed) {
    return empty("invalid_json", true, { lane_stage: "parse", raw_preview: raw.slice(0, 200) });
  }

  const shouldSend = parsed.should_send === true;
  let body = typeof parsed.body === "string" ? parsed.body.replace(/\r?\n/g, " ").trim() : "";
  const noSendReason = typeof parsed.no_send_reason === "string" ? parsed.no_send_reason.trim() : null;
  const turnPurpose = typeof parsed.turn_purpose === "string" ? parsed.turn_purpose.trim() : "inbound_turn";
  const voiceConfidence =
    typeof parsed.voice_confidence === "number" && Number.isFinite(parsed.voice_confidence)
      ? Math.max(0, Math.min(1, parsed.voice_confidence))
      : null;
  const usedFacts = asStringArray(parsed.used_facts);
  const safetyNotes = asStringArray(parsed.safety_notes);

  if (!shouldSend) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: noSendReason || "model_no_send",
      replySource: "v3_inbound_relationship_lane",
      turnPurpose: turnPurpose || "no_send",
      voiceConfidence,
      usedFacts,
      safetyNotes,
      metadata: {
        ...baseMeta,
        lane_stage: "model_no_send",
        v3_candidate_body: "",
      },
      openAiOk: true,
    };
  }

  if (!body) {
    return empty("empty_body_after_should_send", true, { lane_stage: "empty_body" });
  }
  body = body.replace(/^["']|["']$/g, "").trim();
  if (!body) {
    return empty("empty_body_after_should_send", true, { lane_stage: "trim_empty" });
  }

  if (body.length > args.facts.constraints.max_chars) {
    return empty("over_max_chars", true, { lane_stage: "length", v3_candidate_body: body });
  }

  const rt = args.facts.thread.rejected_time_candidates;
  if (rt.length > 0) {
    const hit = validateNoRejectedTimeRepeat(body, rt);
    if (hit != null) {
      return {
        body: "",
        shouldSend: false,
        noSendReason: "rejected_time_repeated",
        replySource: "v3_inbound_relationship_lane",
        turnPurpose: turnPurpose || "no_send",
        voiceConfidence,
        usedFacts,
        safetyNotes: [...safetyNotes, `rejected_time_repeat:${hit.slice(0, 80)}`],
        metadata: {
          ...baseMeta,
          lane_stage: "rejected_time_validation_failed",
          v3_candidate_body: body,
        },
        openAiOk: true,
      };
    }
  }

  const blocked = detectFinalVoiceBlockedReasons(body);
  if (blocked.length > 0) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: "lane_post_validate_blocked",
      replySource: "v3_inbound_relationship_lane",
      turnPurpose: turnPurpose || "no_send",
      voiceConfidence,
      usedFacts,
      safetyNotes: [...safetyNotes, ...blocked.map((b) => `blocked:${b}`)],
      metadata: {
        ...baseMeta,
        lane_stage: "post_validate_blocked",
        v3_candidate_body: body,
        blocked_reasons: blocked,
      },
      openAiOk: true,
    };
  }

  const badSub = validateForbiddenSubstrings(body, args.facts.constraints.forbidden_substrings);
  if (badSub != null) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: "forbidden_substring_violation",
      replySource: "v3_inbound_relationship_lane",
      turnPurpose: turnPurpose || "no_send",
      voiceConfidence,
      usedFacts,
      safetyNotes: [...safetyNotes, `forbidden_hit:${badSub.slice(0, 80)}`],
      metadata: {
        ...baseMeta,
        lane_stage: "forbidden_substring",
        v3_candidate_body: body,
        forbidden_hit: badSub.slice(0, 120),
      },
      openAiOk: true,
    };
  }

  const missReq = validateRequiredVerbatimSubstrings(body, args.facts.constraints.required_verbatim_substrings);
  if (missReq != null) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: "required_verbatim_missing",
      replySource: "v3_inbound_relationship_lane",
      turnPurpose: turnPurpose || "no_send",
      voiceConfidence,
      usedFacts,
      safetyNotes: [...safetyNotes, `required_verbatim_missing:${missReq.slice(0, 80)}`],
      metadata: {
        ...baseMeta,
        lane_stage: "required_verbatim_failed",
        v3_candidate_body: body,
        missing_required_substring: missReq.slice(0, 120),
      },
      openAiOk: true,
    };
  }

  return {
    body,
    shouldSend: true,
    noSendReason: null,
    replySource: "v3_inbound_relationship_lane",
    turnPurpose,
    voiceConfidence,
    usedFacts,
    safetyNotes,
    metadata: {
      ...baseMeta,
      lane_stage: "ok",
      v3_candidate_body: body,
      v3_lane_turn_purpose: turnPurpose,
      should_send: true,
    },
    openAiOk: true,
  };
}

/** Structured last_error JSON when the inbound V3 relationship lane returns no-send. */
export function formatInboundV3LaneNoSendLastError(
  lane: InboundV3RelationshipLaneResult,
  extras?: Record<string, unknown> | null
): string {
  try {
    return JSON.stringify({
      tag: "inbound_v3_lane_no_send",
      no_send_reason: lane.noSendReason,
      lane_metadata: lane.metadata,
      open_ai_ok: lane.openAiOk,
      ...(extras ?? {}),
    }).slice(0, 1900);
  } catch {
    return "inbound_v3_lane_no_send";
  }
}

export type BuildInboundV3RelationshipFactsArgs = {
  clerkUserId: string;
  preferredName: string | null;
  timezone: string;
  localTimeIso: string;
  commitment: ActiveV2CommitmentRow;
  effectiveAsk: string;
  userMessageRaw: string;
  coalescedInboundText: string;
  suppressedMessageSids: string[];
  transcriptLines: string[];
  northStarPacket: NorthStarSmsContextPacket;
  gatedDecision: V2InboundGatedDecision;
  deterministicEventType: "user_yes" | "user_no" | "user_partial";
  doNotRepeatHints: string[];
  relationshipProfileSummary: string | null;
  conversationBrain: InboundV3ConversationBrainFacts;
  centralBrain: InboundV3CentralBrainFacts;
  arc: InboundV3ArcFacts;
  phase5a: InboundV3RelationshipFacts["legacy_suggestions"]["phase5a"];
  forcedFutureStretchIntentActive: boolean;
  wave11MemoryConfirmationPending: boolean;
  accountabilityProofHint: string | null;
  rejectedTimeCandidates: string[];
  unavailableWindows: string[];
  routePurpose?: InboundV3RoutePurpose;
  branchName?: string | null;
  branchMigratedToLane?: boolean;
  centralBrainPivotFacts?: InboundV3CentralBrainPivotFacts | null;
  arcClarificationFacts?: InboundV3ArcClarificationFacts | null;
  centralBrainBlockerPivotFacts?: InboundV3CentralBrainBlockerPivotFacts | null;
  blockerFacts?: InboundV3BlockerFacts | null;
  openQuestionFacts?: InboundV3OpenQuestionFacts | null;
  refreshFacts?: InboundV3RefreshFacts | null;
  pendingResolutionFacts?: InboundV3PendingResolutionFacts | null;
  memoryConfirmationFacts?: InboundV3MemoryConfirmationFacts | null;
  contractConsentFacts?: InboundV3ContractConsentFacts | null;
  adaptiveConsentClarificationFacts?: InboundV3AdaptiveConsentClarificationFacts | null;
  commitmentChangeFacts?: InboundV3CommitmentChangeFacts | null;
};

/** Assembles JSON-safe facts for {@link produceInboundV3RelationshipSms} (no upstream prose). */
export function buildInboundV3RelationshipFacts(args: BuildInboundV3RelationshipFactsArgs): InboundV3RelationshipFacts {
  const reqVerb: string[] = [
    ...(args.refreshFacts?.required_verbatim_substrings ?? []),
    ...(args.pendingResolutionFacts?.required_verbatim_substrings ?? []),
    ...(args.memoryConfirmationFacts?.required_verbatim_substrings ?? []),
    ...(args.contractConsentFacts?.required_verbatim_substrings ?? []),
    ...(args.commitmentChangeFacts?.required_verbatim_substrings ?? []),
  ].filter((s) => typeof s === "string" && s.trim().length > 0);
  const reqMeanRaw =
    args.refreshFacts?.required_meaning_summary?.trim() ||
    args.pendingResolutionFacts?.required_meaning_summary?.trim() ||
    args.memoryConfirmationFacts?.required_meaning_summary?.trim() ||
    args.contractConsentFacts?.required_meaning_summary?.trim() ||
    args.adaptiveConsentClarificationFacts?.required_meaning_summary?.trim() ||
    args.commitmentChangeFacts?.required_meaning_summary?.trim() ||
    null;

  const facts: InboundV3RelationshipFacts = {
    route_purpose: args.routePurpose ?? "normal_inbound_reply",
    branch_name: args.branchName ?? null,
    branch_migrated_to_lane: args.branchMigratedToLane === true,
    ...(args.centralBrainPivotFacts != null ? { central_brain_pivot_facts: args.centralBrainPivotFacts } : {}),
    ...(args.arcClarificationFacts != null ? { arc_clarification_facts: args.arcClarificationFacts } : {}),
    ...(args.centralBrainBlockerPivotFacts != null
      ? { central_brain_blocker_pivot_facts: args.centralBrainBlockerPivotFacts }
      : {}),
    ...(args.blockerFacts != null ? { blocker_facts: args.blockerFacts } : {}),
    ...(args.openQuestionFacts != null ? { open_question_facts: args.openQuestionFacts } : {}),
    ...(args.refreshFacts != null ? { refresh_facts: args.refreshFacts } : {}),
    ...(args.pendingResolutionFacts != null ? { pending_resolution_facts: args.pendingResolutionFacts } : {}),
    ...(args.memoryConfirmationFacts != null ? { memory_confirmation_facts: args.memoryConfirmationFacts } : {}),
    ...(args.contractConsentFacts != null ? { contract_consent_facts: args.contractConsentFacts } : {}),
    ...(args.adaptiveConsentClarificationFacts != null
      ? { adaptive_consent_clarification_facts: args.adaptiveConsentClarificationFacts }
      : {}),
    ...(args.commitmentChangeFacts != null ? { commitment_change_facts: args.commitmentChangeFacts } : {}),
    user: {
      clerk_user_id: args.clerkUserId,
      preferred_name: args.preferredName,
      timezone: args.timezone,
      local_time_iso: args.localTimeIso,
      relationship_profile_summary: args.relationshipProfileSummary,
    },
    commitment: {
      id: args.commitment.id,
      title: args.commitment.title,
      behavior_statement: args.commitment.behavior_statement ?? "",
      effective_ask: args.effectiveAsk,
      accountability_phase: args.commitment.accountability_phase,
    },
    thread: {
      latest_inbound_raw: args.userMessageRaw,
      coalesced_inbound_text: args.coalescedInboundText,
      suppressed_message_sids: args.suppressedMessageSids,
      recent_transcript_lines: args.transcriptLines,
      latest_outbound_coach_sms: args.northStarPacket.latestOutboundBody ?? null,
      latest_open_question: args.northStarPacket.latestOpenQuestion ?? null,
      expected_reply_semantics: args.northStarPacket.expectedReplySemantics ?? null,
      do_not_repeat_hints: args.doNotRepeatHints,
      rejected_time_candidates: args.rejectedTimeCandidates,
      unavailable_windows: args.unavailableWindows,
    },
    v2_accountability: {
      deterministic_classifier_event: args.deterministicEventType,
      gated_mode: args.gatedDecision.mode,
      final_event_type: args.gatedDecision.final_event_type ?? null,
      should_write_outcome_event: args.gatedDecision.should_write_outcome_event,
      reply_style: args.gatedDecision.reply_style ?? null,
      proof_signal: args.northStarPacket.proofSignal === true,
      miss_signal: args.northStarPacket.missSignal === true,
      blocker_signal: args.northStarPacket.blockerSignal === true,
      today_completed: args.northStarPacket.todayCompleted === true,
      future_intent_hint: args.northStarPacket.futureIntentHint ?? null,
      supplement_commitment_change_guidance: args.gatedDecision.supplement_commitment_change_guidance === true,
    },
    legacy_suggestions: {
      conversation_brain: args.conversationBrain,
      central_brain: args.centralBrain,
      arc: args.arc,
      phase5a: args.phase5a,
      forced_future_stretch_intent_active: args.forcedFutureStretchIntentActive,
      wave11_memory_confirmation_pending: args.wave11MemoryConfirmationPending,
      accountability_proof_hint: args.accountabilityProofHint,
    },
    suggested_coaching_move: "",
    constraints: {
      max_chars: INBOUND_LANE_MAX_CHARS,
      one_sms: true,
      no_generic_motivation: true,
      no_quoted_or_truncated_echo_of_inbound: true,
      if_unsafe_return_no_send: true,
      forbidden_substrings: [
        "what's the next concrete move",
        "what’s the next concrete move",
        "Say it straight",
        "Let's confirm",
      ],
    },
  };
  if (reqVerb.length > 0) {
    facts.constraints.required_verbatim_substrings = reqVerb;
  }
  if (reqMeanRaw) {
    facts.constraints.required_meaning_summary = reqMeanRaw;
  }
  facts.suggested_coaching_move = deriveSuggestedCoachingMoveForInboundFacts(facts);
  return facts;
}
