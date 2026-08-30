/**
 * Inbound Sol main coaching turn — packet → interpreter → persist → writer → block-only.
 * Cron owns job CAS + send. This module does not send SMS.
 */

import type { ActiveV2CommitmentRow, V2EventRowForAi } from "@/lib/v2-commitment";
import type { V2InboundGatedDecision } from "@/lib/v2-ai-inbound";
import type { V2InboundEventType } from "@/lib/v2-sms-accountability";
import { buildProofMomentForAccountabilityOutcome } from "@/lib/v2-proof-moment";
import {
  persistInboundAccountabilityOutcomeEvent,
  type InboundOutcomePersistResult,
  type InboundOutcomePersistSkipReason,
} from "@/lib/v2-inbound-accountability-outcome-persist";
import type { PersistRecognizedWinsResult } from "@/lib/v2-win-persist";
import {
  hashInboundRelationshipThread,
  hashInboundText,
  loadInboundRelationshipPacket,
  previewInboundText,
  type InboundRelationshipPacket,
} from "@/lib/inbound-relationship-packet";
import {
  compactInboundSolBriefForTelemetry,
  type InboundCoachingBriefV1,
} from "@/lib/inbound-sol-coaching-brief";
import {
  INBOUND_SOL_INTERPRETER_MODEL,
  INBOUND_SOL_INTERPRETER_REASONING_EFFORT,
  runInboundSolBriefInterpreter,
} from "@/lib/inbound-sol-brief-interpreter";
import {
  INBOUND_SOL_WRITER_MODEL,
  INBOUND_SOL_WRITER_REASONING_EFFORT,
  writeInboundSolBody,
} from "@/lib/inbound-sol-writer";
import { shouldPersistSolInboundAccountabilityOutcome } from "@/lib/inbound-sol-persist-advice";
import { persistSolInboundWins } from "@/lib/inbound-sol-wins";
import { persistSolInboundUserEvidence } from "@/lib/inbound-sol-user-evidence";
import { applySolInboundOutcomeSideEffects } from "@/lib/inbound-sol-outcome-side-effects";
import { evaluateInboundSolBlockOnlyReply } from "@/lib/inbound-sol-reply-validate";
import { applySolAnsweredOpenCoachQuestion } from "@/lib/v2-commitment-sms-thread-memory";
import { scheduleInboundMmsD1SemanticClaim } from "@/lib/victory-media/inbound-mms-d1-claim";
import { scheduleInboundMmsD2cSemanticClaim } from "@/lib/victory-media/inbound-mms-d2c-claim";
import { isInboundMmsPendingClarificationContext } from "@/lib/victory-media/inbound-mms-d2c-pending-context";
import {
  getPatEvidenceForSms,
  skippedPatSourceEvidenceForensics,
  type PatSourceEvidencePacketV1,
} from "@/lib/inbound-pat-source-evidence";

export function isInboundSolMainCoachingBranch(args: {
  normalInboundV3OwnershipEligible: boolean;
  relationshipExitLaneActive: boolean;
  identityEditLaneActive: boolean;
  commitmentChangeHeuristicContext: boolean;
  conversationBrainControlTurnActive: boolean;
}): boolean {
  return (
    args.normalInboundV3OwnershipEligible &&
    !args.relationshipExitLaneActive &&
    !args.identityEditLaneActive &&
    !args.commitmentChangeHeuristicContext &&
    !args.conversationBrainControlTurnActive
  );
}

export function isLikelyInboundSolMainBeforeHandoff(args: {
  relationshipExitLaneActive: boolean;
  identityEditLaneActive: boolean;
  commitmentChangeIntentLikely: boolean;
  conversationBrainControlTurnActive: boolean;
}): boolean {
  return (
    !args.relationshipExitLaneActive &&
    !args.identityEditLaneActive &&
    !args.commitmentChangeIntentLikely &&
    !args.conversationBrainControlTurnActive
  );
}

export type InboundSolRelationshipTurnResult = {
  shouldSend: boolean;
  noSendReason: string | null;
  body: string | null;
  packet: InboundRelationshipPacket | null;
  brief: InboundCoachingBriefV1 | null;
  persistResult: InboundOutcomePersistResult;
  winResult: PersistRecognizedWinsResult | null;
  forensics: Record<string, unknown>;
};

function skippedPersist(skipReason: InboundOutcomePersistSkipReason): InboundOutcomePersistResult {
  return { status: "skipped", skipReason };
}

export async function runInboundSolRelationshipTurn(args: {
  clerkUserId: string;
  timezone: string;
  commitment: ActiveV2CommitmentRow;
  latestInboundText: string;
  messageSid: string;
  recentEventsNewestFirst: V2EventRowForAi[];
  gatedDecision: V2InboundGatedDecision;
  classifierEventType: V2InboundEventType;
  classifierNormalizedHint: string | null;
  exclusiveLaneOwnsTurn: boolean;
  pendingConfirmationConflict: boolean;
  /** Webhook enqueue time (job.created_at). Authoritative product day. */
  receivedAt?: Date | string | null;
  /** Current coalesced turn SIDs: split-suppressed + newest claimed job. */
  currentTurnMessageSids?: string[];
}): Promise<InboundSolRelationshipTurnResult> {
  const baseForensics: Record<string, unknown> = {
    inbound_sol_interpreter_model: INBOUND_SOL_INTERPRETER_MODEL,
    inbound_sol_writer_model: INBOUND_SOL_WRITER_MODEL,
    inbound_sol_reasoning_effort: INBOUND_SOL_INTERPRETER_REASONING_EFFORT,
    inbound_sol_inbound_preview: previewInboundText(args.latestInboundText),
    inbound_sol_inbound_hash: hashInboundText(args.latestInboundText),
    reply_source: "inbound_sol_relationship_turn",
    v3_lane_reply_source: "inbound_sol_relationship_turn",
    branch_name: "inbound_sol_main",
    route_purpose: "normal_inbound_reply",
  };

  const noSend = (
    noSendReason: string,
    extras?: Partial<InboundSolRelationshipTurnResult>
  ): InboundSolRelationshipTurnResult => ({
    shouldSend: false,
    noSendReason,
    body: null,
    packet: extras?.packet ?? null,
    brief: extras?.brief ?? null,
    persistResult: extras?.persistResult ?? skippedPersist("sol_not_applicable"),
    winResult: extras?.winResult ?? null,
    forensics: {
      ...baseForensics,
      ...(extras?.forensics ?? {}),
      inbound_sol_no_send_reason: noSendReason,
      no_send_reason: noSendReason,
    },
  });

  const loaded = await loadInboundRelationshipPacket({
    clerkUserId: args.clerkUserId,
    timezone: args.timezone,
    commitment: args.commitment,
    latestInboundText: args.latestInboundText,
    latestInboundMessageSid: args.messageSid,
    receivedAt: args.receivedAt,
    currentTurnMessageSids: args.currentTurnMessageSids,
  });

  if (!loaded.ok) {
    return noSend(`packet_${loaded.error}`);
  }

  const packet = loaded.packet;
  const threadHash = hashInboundRelationshipThread(packet.exact_thread.messages);
  baseForensics.inbound_sol_thread_hash = threadHash;
  baseForensics.inbound_sol_historical_evidence_count = packet.historical_evidence.length;

  const interpreted = await runInboundSolBriefInterpreter({ packet });
  baseForensics.inbound_sol_retry_interpreter = interpreted.capture.retry_occurred;
  if (!interpreted.ok) {
    return noSend(`interpreter_${interpreted.error}`, {
      packet,
      persistResult: skippedPersist("sol_not_applicable"),
      forensics: { inbound_sol_retry_interpreter: interpreted.capture.retry_occurred },
    });
  }

  const brief = interpreted.brief;
  Object.assign(baseForensics, compactInboundSolBriefForTelemetry(brief));

  try {
    const openQuestionApply = await applySolAnsweredOpenCoachQuestion({
      commitmentId: args.commitment.id,
      clerkUserId: args.clerkUserId,
      messageSid: args.messageSid,
      expectedOpenQuestion: packet.hard_state.open_coach_question,
      answeredQuestion: brief.conversation_continuity.answered_question,
      canonicalHumanTurnText: packet.latest_inbound_text,
    });
    if (openQuestionApply.ok && openQuestionApply.applied) {
      baseForensics.inbound_sol_open_question_apply = "applied";
    } else if (openQuestionApply.ok) {
      baseForensics.inbound_sol_open_question_apply = openQuestionApply.reason;
    } else {
      baseForensics.inbound_sol_open_question_apply = `error:${openQuestionApply.error}`;
    }
  } catch (err) {
    console.warn("[inbound-sol-open-question-apply-failed]", {
      message_sid: args.messageSid,
      error: err instanceof Error ? err.message.slice(0, 120) : "unknown",
    });
    baseForensics.inbound_sol_open_question_apply = "error";
  }

  const advice = shouldPersistSolInboundAccountabilityOutcome({
    inbound: brief.inbound,
    messageSid: args.messageSid,
    commitmentId: args.commitment.id,
    hasActiveCommitment: true,
    exclusiveLaneOwnsTurn: args.exclusiveLaneOwnsTurn,
    pendingConfirmationConflict: args.pendingConfirmationConflict,
    recentEventsNewestFirst: args.recentEventsNewestFirst,
    timezone: packet.message_for.timezone,
    localDayKey: packet.message_for.local_date,
    classifierEventType: args.classifierEventType,
  });

  let persistResult: InboundOutcomePersistResult;
  if (!advice.persist) {
    persistResult = skippedPersist(advice.skipReason);
  } else {
    const proofMeta = buildProofMomentForAccountabilityOutcome({
      finalEventType: advice.resolvedEventType,
      eventsNewestFirst: args.recentEventsNewestFirst,
      isRepairOutcome: false,
      userMessageCharCount: args.latestInboundText.trim().length,
      rawBody: args.latestInboundText,
    });
    persistResult = await persistInboundAccountabilityOutcomeEvent({
      commitmentId: args.commitment.id,
      clerkUserId: args.clerkUserId,
      messageSid: args.messageSid,
      rawBody: args.latestInboundText,
      eventType: advice.resolvedEventType,
      branch: "main",
      classifierEventType: args.classifierEventType,
      classifierNormalizedHint: args.classifierNormalizedHint,
      gatedDecision: args.gatedDecision,
      liveAccountabilityPromptDetected: false,
      overrideGatedNoWrite: args.gatedDecision.should_write_outcome_event === false,
      proofMeta,
      payloadJson: {
        source_path: "sms_inbound_sol",
        sol_accountability_interpretation: brief.inbound.accountability_interpretation,
        sol_classifier_event_type_unused: args.classifierEventType,
      },
    });
  }

  baseForensics.inbound_sol_persist_status = persistResult.status;
  if (persistResult.status === "skipped") {
    baseForensics.inbound_sol_persist_skip_reason = persistResult.skipReason;
  } else if (persistResult.status === "inserted" || persistResult.status === "duplicate") {
    baseForensics.inbound_sol_persist_event_type = persistResult.eventType;
    baseForensics.inbound_truth_persist_event_type = persistResult.eventType;
    baseForensics.inbound_truth_persist_succeeded_before_writer = true;
    if (persistResult.eventType === "user_yes") {
      baseForensics.proof_persisted_before_writer = true;
      baseForensics.proof_persisted_event_type = "user_yes";
    }
  } else {
    baseForensics.inbound_truth_persist_succeeded_before_writer = false;
  }

  const sideEffects = await applySolInboundOutcomeSideEffects({
    commitmentId: args.commitment.id,
    persistResult,
  });
  baseForensics.inbound_sol_memory_recomputed = sideEffects.recomputed;
  baseForensics.inbound_sol_blocker_capture_pending = sideEffects.blockerCaptureSet;

  let winResult: PersistRecognizedWinsResult | null = null;
  const persistedUserYes =
    (persistResult.status === "inserted" || persistResult.status === "duplicate") &&
    persistResult.eventType === "user_yes";

  try {
    winResult = await persistSolInboundWins({
      persistResult,
      inbound: brief.inbound,
      inboundText: args.latestInboundText,
      clerkUserId: args.clerkUserId,
      messageSid: args.messageSid,
      commitmentId: args.commitment.id,
      occurredAtIso: loaded.receivedAt.toISOString(),
      effectiveAsk: packet.current_goal.text,
      behaviorStatement: args.commitment.behavior_statement,
    });
    if (winResult) {
      baseForensics.inbound_sol_win_persisted = winResult.persisted;
      baseForensics.inbound_sol_win_attempted = winResult.attempted;
    } else {
      baseForensics.inbound_sol_win_persisted = 0;
    }
  } catch (err) {
    console.warn("[inbound-sol-win-persist-failed]", {
      message_sid: args.messageSid,
      error: err instanceof Error ? err.message.slice(0, 120) : "unknown",
    });
    baseForensics.inbound_sol_win_persisted = 0;
  }

  try {
    const evidencePersist = await persistSolInboundUserEvidence({
      clerkUserId: args.clerkUserId,
      messageSid: args.messageSid,
      latestInboundText: packet.latest_inbound_text,
      occurredAtIso: loaded.receivedAt.toISOString(),
      durableUserEvidence: brief.inbound.durable_user_evidence,
    });
    baseForensics.inbound_sol_durable_user_evidence_persist_status = evidencePersist.status;
  } catch (err) {
    console.warn("[inbound-sol-user-evidence-persist-failed]", {
      message_sid: args.messageSid,
      error: err instanceof Error ? err.message.slice(0, 120) : "unknown",
    });
    baseForensics.inbound_sol_durable_user_evidence_persist_status = "failed";
  }

  try {
    if (isInboundMmsPendingClarificationContext(packet.pending_media_context)) {
      const d2cTarget = scheduleInboundMmsD2cSemanticClaim({
        clerkUserId: args.clerkUserId,
        currentMessageSid: args.messageSid,
        context: packet.pending_media_context,
        relation: brief.inbound.pending_photo_relation,
        winResult,
      });
      baseForensics.inbound_sol_d2c_claim_scheduled = d2cTarget != null;
      baseForensics.inbound_sol_d1_claim_scheduled = false;
    } else {
      const d1Target = scheduleInboundMmsD1SemanticClaim({
        clerkUserId: args.clerkUserId,
        currentMessageSid: args.messageSid,
        context: packet.pending_media_context,
        relation: brief.inbound.pending_photo_relation,
        winResult,
      });
      baseForensics.inbound_sol_d1_claim_scheduled = d1Target != null;
      baseForensics.inbound_sol_d2c_claim_scheduled = false;
    }
  } catch {
    baseForensics.inbound_sol_d1_claim_scheduled = false;
    baseForensics.inbound_sol_d2c_claim_scheduled = false;
  }

  let patSourceEvidence: PatSourceEvidencePacketV1 | null = null;
  if (brief.inbound.requires_pat_personal_knowledge === "yes") {
    const evidence = await getPatEvidenceForSms({
      query: packet.latest_inbound_text,
    });
    patSourceEvidence = evidence.packet;
    Object.assign(baseForensics, evidence.forensics);
  } else {
    Object.assign(baseForensics, skippedPatSourceEvidenceForensics());
  }

  const written = await writeInboundSolBody({ packet, brief, patSourceEvidence });
  baseForensics.inbound_sol_retry_writer = written.capture.retry_occurred;
  baseForensics.writer_model = INBOUND_SOL_WRITER_MODEL;
  if (!written.ok) {
    return noSend(`writer_${written.error}`, {
      packet,
      brief,
      persistResult,
      winResult,
      forensics: baseForensics,
    });
  }

  if (written.needs_manual_pat_answer) {
    if (brief.inbound.requires_pat_personal_knowledge !== "yes") {
      return noSend("writer_manual_pat_flag_without_yes", {
        packet,
        brief,
        persistResult,
        winResult,
        forensics: {
          ...baseForensics,
          inbound_sol_needs_manual_pat_answer: false,
        },
      });
    }
    return noSend("manual_pat_answer_needed", {
      packet,
      brief,
      persistResult,
      winResult,
      forensics: {
        ...baseForensics,
        inbound_sol_needs_manual_pat_answer: true,
      },
    });
  }

  const blocked = evaluateInboundSolBlockOnlyReply({
    body: written.body,
    persistedUserYes,
    pendingPhotoNotCanonicallyAttached:
      packet.pending_media_context.candidate_count > 0,
  });
  if (!blocked.ok) {
    return noSend(`blocked_${blocked.reason}`, {
      packet,
      brief,
      persistResult,
      winResult,
      forensics: {
        ...baseForensics,
        inbound_sol_body_preview: previewInboundText(written.body),
        inbound_sol_body_hash: hashInboundText(written.body),
      },
    });
  }

  return {
    shouldSend: true,
    noSendReason: null,
    body: written.body,
    packet,
    brief,
    persistResult,
    winResult,
    forensics: {
      ...baseForensics,
      inbound_sol_body_preview: previewInboundText(written.body),
      inbound_sol_body_hash: hashInboundText(written.body),
      inbound_sol_reasoning_effort: INBOUND_SOL_WRITER_REASONING_EFFORT,
    },
  };
}
