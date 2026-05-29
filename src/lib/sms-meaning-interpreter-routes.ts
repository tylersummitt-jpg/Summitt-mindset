import {
  buildMeaningShadowScheduleArgs,
  type MeaningInterpreterDeterministicFacts,
  type MeaningInterpreterShadowScheduleArgs,
} from "@/lib/sms-meaning-interpreter-shadow";

/** Canonical deterministic_route values for shadow telemetry. */
export const MEANING_INTERPRETER_ROUTES = {
  normal_accountability: "normal_accountability",
  open_question_answer: "open_question_answer",
  blocker_capture: "blocker_capture",
  pending_resolution_commitment_replace: "pending_resolution_commitment_replace",
  pending_resolution_commitment_tighten: "pending_resolution_commitment_tighten",
  pending_resolution_rejected: "pending_resolution_rejected",
  season_goal_change_confirmation: "season_goal_change_confirmation",
  contract_consent: "contract_consent",
  contract_ambiguous_consent: "contract_ambiguous_consent",
  coaching_refresh: "coaching_refresh",
  memory_confirmation: "memory_confirmation",
  memory_clarification: "memory_clarification",
  comms_preference_applied: "comms_preference_applied",
  planned_interruption: "planned_interruption",
  relationship_exit_integrity: "relationship_exit_integrity",
  identity_edit_integrity: "identity_edit_integrity",
  commitment_change_handoff: "commitment_change_handoff",
  clarify_reply: "clarify_reply",
  repair_reply_only: "repair_reply_only",
  soft_opt_out_reply: "soft_opt_out_reply",
  central_brain_pivot: "central_brain_pivot",
  arc_clarify: "arc_clarify",
  future_stretch_or_raise_bar: "future_stretch_or_raise_bar",
  conversation_brain_legacy_fallback: "conversation_brain_legacy_fallback",
  safety_short_circuit_skipped: "safety_short_circuit_skipped",
  compliance_skipped: "compliance_skipped",
  suppressed_tapback: "suppressed_tapback",
  suppressed_no_send: "suppressed_no_send",
  suppressed_empty: "suppressed_empty",
  send_failed: "send_failed",
  contract_consent_gate_miss: "contract_consent_gate_miss",
} as const;

export type MeaningInterpreterRoute =
  (typeof MEANING_INTERPRETER_ROUTES)[keyof typeof MEANING_INTERPRETER_ROUTES];

export function resolveNormalInboundMeaningShadowRoute(args: {
  mainInboundLaneRoutePurpose?: string;
  gatedMode: string;
  plannedInterruptionActive?: boolean;
  forcedFutureStretchActive?: boolean;
  commsPreferenceAction?: string | null;
}): string {
  if (args.commsPreferenceAction && args.commsPreferenceAction !== "none") {
    return MEANING_INTERPRETER_ROUTES.comms_preference_applied;
  }
  if (args.plannedInterruptionActive) {
    return MEANING_INTERPRETER_ROUTES.planned_interruption;
  }
  if (args.forcedFutureStretchActive) {
    return MEANING_INTERPRETER_ROUTES.future_stretch_or_raise_bar;
  }
  if (args.mainInboundLaneRoutePurpose === "relationship_exit_integrity") {
    return MEANING_INTERPRETER_ROUTES.relationship_exit_integrity;
  }
  if (args.mainInboundLaneRoutePurpose === "identity_edit_integrity") {
    return MEANING_INTERPRETER_ROUTES.identity_edit_integrity;
  }
  if (args.mainInboundLaneRoutePurpose === "commitment_change_context") {
    return MEANING_INTERPRETER_ROUTES.commitment_change_handoff;
  }
  if (args.gatedMode === "commitment_change_handoff") {
    return MEANING_INTERPRETER_ROUTES.commitment_change_handoff;
  }
  if (args.gatedMode === "clarify") return MEANING_INTERPRETER_ROUTES.clarify_reply;
  if (args.gatedMode === "repair_reply_only") return MEANING_INTERPRETER_ROUTES.repair_reply_only;
  if (args.gatedMode === "soft_opt_out_reply") return MEANING_INTERPRETER_ROUTES.soft_opt_out_reply;
  if (args.gatedMode === "relationship_exit_integrity") {
    return MEANING_INTERPRETER_ROUTES.relationship_exit_integrity;
  }
  if (args.gatedMode === "identity_edit_integrity") {
    return MEANING_INTERPRETER_ROUTES.identity_edit_integrity;
  }
  return MEANING_INTERPRETER_ROUTES.normal_accountability;
}

export function resolvePendingResolutionMeaningRoute(args: {
  pendingKind: string | null;
  userAnswerType: string;
  pendingReplaceApplied: boolean;
  pendingCleared: boolean;
  seasonTransitionApplied?: boolean;
}): string {
  if (args.seasonTransitionApplied) {
    return MEANING_INTERPRETER_ROUTES.season_goal_change_confirmation;
  }
  if (args.userAnswerType === "user_no" && !args.pendingReplaceApplied) {
    return MEANING_INTERPRETER_ROUTES.pending_resolution_rejected;
  }
  if (args.pendingKind === "commitment_tighten") {
    return MEANING_INTERPRETER_ROUTES.pending_resolution_commitment_tighten;
  }
  if (args.pendingKind === "commitment_replace") {
    return MEANING_INTERPRETER_ROUTES.pending_resolution_commitment_replace;
  }
  if (args.userAnswerType === "user_no") {
    return MEANING_INTERPRETER_ROUTES.pending_resolution_rejected;
  }
  return MEANING_INTERPRETER_ROUTES.pending_resolution_commitment_replace;
}

function previewText(text: string | null | undefined, max: number): string | null {
  if (!text?.trim()) return null;
  return text.trim().replace(/\s+/g, " ").slice(0, max);
}

export function buildTransactionalMeaningShadow(args: {
  route: string;
  commitmentId: string;
  facts: MeaningInterpreterDeterministicFacts;
}): MeaningInterpreterShadowScheduleArgs {
  return buildMeaningShadowScheduleArgs({
    deterministicRoute: args.route,
    commitmentId: args.commitmentId,
    deterministicFacts: args.facts,
  });
}

export function buildOpenQuestionMeaningShadow(args: {
  commitmentId: string;
  classifierEventType: string;
  classifierNormalizedHint: string | null;
  openQuestionText: string | null;
  expectedReplySemantics?: string | null;
  resolutionSubkind?: string | null;
  pendingResolutionKind?: string | null;
  lastOutboundPreview?: string | null;
  behaviorStatement?: string | null;
}): MeaningInterpreterShadowScheduleArgs {
  return buildTransactionalMeaningShadow({
    route: MEANING_INTERPRETER_ROUTES.open_question_answer,
    commitmentId: args.commitmentId,
    facts: {
      classifier_event_type: args.classifierEventType,
      classifier_normalized_hint: args.classifierNormalizedHint,
      open_question_text: args.openQuestionText,
      expected_reply_semantics: args.expectedReplySemantics ?? null,
      resolution_subkind: args.resolutionSubkind ?? null,
      pending_resolution_kind: args.pendingResolutionKind ?? null,
      last_outbound_preview: args.lastOutboundPreview ?? null,
      behavior_statement: args.behaviorStatement ?? null,
    },
  });
}

export function buildBlockerCaptureMeaningShadow(args: {
  commitmentId: string;
  classifierEventType: string;
  blockerCaptureAfterEvent: string;
  blockerTextPreview: string;
  lastOutboundPreview?: string | null;
  behaviorStatement?: string | null;
}): MeaningInterpreterShadowScheduleArgs {
  return buildTransactionalMeaningShadow({
    route: MEANING_INTERPRETER_ROUTES.blocker_capture,
    commitmentId: args.commitmentId,
    facts: {
      classifier_event_type: args.classifierEventType,
      blocker_capture_after_event: args.blockerCaptureAfterEvent,
      blocker_text_preview: previewText(args.blockerTextPreview, 120),
      last_outbound_preview: args.lastOutboundPreview ?? null,
      behavior_statement: args.behaviorStatement ?? null,
    },
  });
}

export function buildPendingResolutionMeaningShadow(args: {
  commitmentId: string;
  pendingKind: string | null;
  userAnswerType: string;
  pendingApplied: boolean;
  pendingCleared: boolean;
  seasonMutationKind?: string | null;
  behaviorStatement?: string | null;
}): MeaningInterpreterShadowScheduleArgs {
  const seasonApplied = Boolean(args.seasonMutationKind);
  const route = resolvePendingResolutionMeaningRoute({
    pendingKind: args.pendingKind,
    userAnswerType: args.userAnswerType,
    pendingReplaceApplied: args.pendingApplied,
    pendingCleared: args.pendingCleared,
    seasonTransitionApplied: seasonApplied,
  });
  return buildTransactionalMeaningShadow({
    route,
    commitmentId: args.commitmentId,
    facts: {
      pending_resolution_kind: args.pendingKind,
      user_answer_type: args.userAnswerType,
      pending_applied: args.pendingApplied,
      pending_cleared: args.pendingCleared,
      season_mutation_kind: args.seasonMutationKind ?? null,
      behavior_statement: args.behaviorStatement ?? null,
    },
  });
}

export function buildContractConsentMeaningShadow(args: {
  commitmentId: string;
  classifierEventType: string;
  overlayAction: string;
  rpcResult: string;
  proposalKindDigest: string;
}): MeaningInterpreterShadowScheduleArgs {
  return buildTransactionalMeaningShadow({
    route: MEANING_INTERPRETER_ROUTES.contract_consent,
    commitmentId: args.commitmentId,
    facts: {
      classifier_event_type: args.classifierEventType,
      overlay_action: args.overlayAction,
      rpc_result: args.rpcResult,
      proposal_kind_digest: previewText(args.proposalKindDigest, 180),
    },
  });
}

export function buildContractAmbiguousConsentMeaningShadow(args: {
  commitmentId: string;
  classifierEventType: string;
  inboundParse: string;
  proposalKindDigest: string;
}): MeaningInterpreterShadowScheduleArgs {
  return buildTransactionalMeaningShadow({
    route: MEANING_INTERPRETER_ROUTES.contract_ambiguous_consent,
    commitmentId: args.commitmentId,
    facts: {
      classifier_event_type: args.classifierEventType,
      inbound_parse: args.inboundParse,
      proposal_kind_digest: previewText(args.proposalKindDigest, 180),
      overlay_consent_pending: true,
    },
  });
}

export function buildCoachingRefreshMeaningShadow(args: {
  commitmentId: string;
  refreshStep: string;
  userAnswerToken: string;
  classifierEventType?: string | null;
}): MeaningInterpreterShadowScheduleArgs {
  return buildTransactionalMeaningShadow({
    route: MEANING_INTERPRETER_ROUTES.coaching_refresh,
    commitmentId: args.commitmentId,
    facts: {
      refresh_step: args.refreshStep,
      user_answer_token: args.userAnswerToken,
      classifier_event_type: args.classifierEventType ?? null,
    },
  });
}

export function buildMemoryConfirmationMeaningShadow(args: {
  commitmentId: string;
  route: typeof MEANING_INTERPRETER_ROUTES.memory_confirmation | typeof MEANING_INTERPRETER_ROUTES.memory_clarification;
  memoryPendingKind: string;
  confirmationParse: string;
  memoryApplied: boolean;
  classifierEventType?: string | null;
}): MeaningInterpreterShadowScheduleArgs {
  return buildTransactionalMeaningShadow({
    route: args.route,
    commitmentId: args.commitmentId,
    facts: {
      memory_pending_kind: args.memoryPendingKind,
      confirmation_parse: args.confirmationParse,
      memory_applied: args.memoryApplied,
      classifier_event_type: args.classifierEventType ?? null,
    },
  });
}

export function buildCommsPreferenceMeaningShadow(args: {
  commitmentId: string;
  classifierEventType: string;
  commsPreferenceAction: string;
  pauseActive: boolean;
  cadenceOverride: string | null;
  weekendSendPolicy: string | null;
}): MeaningInterpreterShadowScheduleArgs {
  return buildTransactionalMeaningShadow({
    route: MEANING_INTERPRETER_ROUTES.comms_preference_applied,
    commitmentId: args.commitmentId,
    facts: {
      classifier_event_type: args.classifierEventType,
      comms_preference_action: args.commsPreferenceAction,
      pause_active: args.pauseActive,
      cadence_override: args.cadenceOverride,
      weekend_send_policy: args.weekendSendPolicy,
    },
  });
}

export function buildNormalLaneMeaningShadow(args: {
  commitmentId: string;
  route: string;
  classifierEventType: string;
  classifierNormalizedHint: string | null;
  gatedMode?: string | null;
  openQuestionText?: string | null;
  pendingResolutionKind?: string | null;
  lastOutboundPreview?: string | null;
  behaviorStatement?: string | null;
  plannedInterruptionCategory?: string | null;
}): MeaningInterpreterShadowScheduleArgs {
  return buildTransactionalMeaningShadow({
    route: args.route,
    commitmentId: args.commitmentId,
    facts: {
      classifier_event_type: args.classifierEventType,
      classifier_normalized_hint: args.classifierNormalizedHint,
      gated_mode: args.gatedMode ?? null,
      open_question_text: args.openQuestionText ?? null,
      pending_resolution_kind: args.pendingResolutionKind ?? null,
      last_outbound_preview: args.lastOutboundPreview ?? null,
      behavior_statement: args.behaviorStatement ?? null,
      planned_interruption_category: args.plannedInterruptionCategory ?? null,
    },
  });
}

export function buildSkippedMeaningShadowFacts(args: {
  skipReason: string;
  jobFinalStatus?: string | null;
  lastErrorTag?: string | null;
  safetyTier?: string | null;
}): MeaningInterpreterDeterministicFacts {
  return {
    skip_reason: args.skipReason,
    job_final_status: args.jobFinalStatus ?? null,
    last_error_tag: args.lastErrorTag ?? null,
    safety_tier: args.safetyTier ?? null,
  };
}

export function buildEnrichedMeaningShadowFacts(args: {
  routePurpose?: string | null;
  branchName?: string | null;
  openQuestionText?: string | null;
  expectedReplySemantics?: string | null;
  openQuestionPending?: boolean;
  openQuestionRoutingMiss?: boolean;
  openQuestionAnswerText?: string | null;
  lastOutboundPreview?: string | null;
  lastOutboundFullBodyPreview?: string | null;
  recentTranscriptPreview?: string | null;
  behaviorStatement?: string | null;
  effectiveAskPreview?: string | null;
  adaptiveProposalPending?: boolean;
  overlayConsentPending?: boolean;
  pendingResolutionKind?: string | null;
  gatedOutcome?: string | null;
  v3NoSendReason?: string | null;
  v3LaneStage?: string | null;
  gateReason?: string | null;
  gateDetails?: Record<string, unknown> | null;
  contractConsentGateMiss?: boolean;
}): Partial<MeaningInterpreterDeterministicFacts> {
  return {
    route_purpose: args.routePurpose ?? null,
    branch_name: args.branchName ?? null,
    latest_coach_question: args.openQuestionText ?? null,
    open_question_text: args.openQuestionText ?? null,
    expected_reply_semantics: args.expectedReplySemantics ?? null,
    open_question_pending: args.openQuestionPending ?? null,
    open_question_routing_miss: args.openQuestionRoutingMiss ?? null,
    open_question_answer_text: args.openQuestionAnswerText ?? null,
    last_outbound_preview: args.lastOutboundPreview ?? null,
    last_outbound_full_body_preview: args.lastOutboundFullBodyPreview ?? null,
    recent_transcript_preview: args.recentTranscriptPreview ?? null,
    behavior_statement: args.behaviorStatement ?? null,
    effective_ask_preview: args.effectiveAskPreview ?? null,
    adaptive_proposal_pending: args.adaptiveProposalPending ?? null,
    overlay_consent_pending: args.overlayConsentPending ?? null,
    pending_resolution_kind: args.pendingResolutionKind ?? null,
    gated_outcome: args.gatedOutcome ?? null,
    v3_no_send_reason: args.v3NoSendReason ?? null,
    v3_lane_stage: args.v3LaneStage ?? null,
    gate_reason: args.gateReason ?? null,
    gate_details: args.gateDetails ?? null,
    contract_consent_gate_miss: args.contractConsentGateMiss ?? null,
  };
}
