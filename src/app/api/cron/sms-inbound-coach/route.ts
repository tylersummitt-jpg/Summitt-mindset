import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import {
  isLikelyCommitmentChangeIntentTurn,
  isLikelySmsComplianceOrOptOutTurn,
  shouldUseSmsConversationBrainControl,
  countRecentClarifyStyleHeuristic,
} from "@/lib/v2-sms-conversation-brain-eligibility";
import { tryBuildForcedInboundCoachSms } from "@/lib/v2-sms-future-stretch-intent";
import {
  applySmsConversationBrainGuardrails,
  type GuardrailResult,
} from "@/lib/v2-sms-turn-guardrails";
import type { SmsConversationBrainProposalV1 } from "@/lib/v2-sms-turn-contract";
import {
  shouldConsumeInboundAsContractProposalConsentAsync,
  outboundSupportsPendingAdaptiveProposalContextAsync,
  diagnoseContractConsentOutboundGateAsync,
} from "@/lib/v2-contract-consent-routing";
import { prepareContractConsentHumanVoiceAckForSend } from "@/lib/v2-contract-consent-ack-send";
import { evaluateAdaptiveProposalAmbiguousConsentGate } from "@/lib/v2-adaptive-proposal-ambiguous-consent-gate";
import {
  isV2SmsConversationBrainAllowedForUser,
  isV2SmsConversationBrainControlEnabled,
  isV2SmsConversationBrainLegacyFallbackEnabled,
  proposeNormalAccountabilityTurnControl,
  getConversationBrainConfidenceFloor,
  V2_SMS_CONVERSATION_BRAIN_PROMPT_VERSION,
} from "@/lib/v2-sms-conversation-brain";
import { getDateKeyInTimezone, resolveUserTimezone } from "@/lib/timezone";
import { sendSMSChunked, isTwilioReady } from "@/lib/twilio";
import {
  buildInboundSmsSafetyReplyBody,
  classifyInboundSmsSafetyTier,
  inboundSmsSafetyLastErrorPayload,
} from "@/lib/sms-inbound-safety";
import {
  activateAdaptiveOverlayFromProposal,
  clearStaleAdaptiveContractColumns,
  declineAdaptiveProposal,
  getEffectiveCoachingAsk,
  isV2AdaptiveOverlayActive,
  isV2PendingProposalValid,
  resolvePendingProposalContractKind,
} from "@/lib/v2-adaptive-contract";
import { formatCoachingMemoryPromptBlock } from "@/lib/v2-coaching-memory-prompt";
import { loadV2CoachingMemoryForPrompt, recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import { recordV2SendTimeProfileInboundEngagement } from "@/lib/v2-send-time-profile";
import {
  buildMeaningShadowScheduleArgs,
  finalizeMeaningInterpreterShadowForInboundJob,
  registerMeaningInterpreterShadowPending,
  enrichMeaningInterpreterShadowPending,
  takeMeaningInterpreterShadowPending,
  scheduleFinalizeMeaningInterpreterShadowForInboundJob,
  type MeaningInterpreterDeterministicFacts,
  type MeaningInterpreterShadowScheduleArgs,
} from "@/lib/sms-meaning-interpreter-shadow";
import {
  buildMeaningInterpreterShadowFinalizeFromSchedule,
  mergeMeaningInterpreterDeterministicFacts,
  parseMeaningInterpreterLastErrorTag,
  type MeaningInterpreterShadowFinalizeInput,
} from "@/lib/sms-meaning-interpreter-context";
import {
  buildBlockerCaptureMeaningShadow,
  buildCommsPreferenceMeaningShadow,
  buildContractAmbiguousConsentMeaningShadow,
  buildContractConsentMeaningShadow,
  buildCoachingRefreshMeaningShadow,
  buildEnrichedMeaningShadowFacts,
  buildMemoryConfirmationMeaningShadow,
  buildNormalLaneMeaningShadow,
  buildOpenQuestionMeaningShadow,
  buildPendingResolutionMeaningShadow,
  buildSkippedMeaningShadowFacts,
  MEANING_INTERPRETER_ROUTES,
  resolveNormalInboundMeaningShadowRoute,
} from "@/lib/sms-meaning-interpreter-routes";
import {
  buildBlockerAckSms,
  buildV2ContractOverlayNoAckSms,
  buildV2ContractOverlayYesAckSms,
  buildV2InboundReplySms,
  classifyV2InboundReply,
  isStrongV2YesNoOutcome,
  v2UserReplyIdempotencyKey,
  type V2ContractOverlayKind,
  type V2InboundEventType,
} from "@/lib/v2-sms-accountability";
import {
  buildBlockerAckAiPayload,
  buildBlockerCapturedAckObservability,
  tryGenerateV2BlockerAckMessage,
  V2_BLOCKER_ACK_AI_MODEL,
  V2_BLOCKER_ACK_PROMPT_VERSION,
} from "@/lib/v2-ai-blocker-ack";
import {
  deriveNormalInboundBrainCase,
  finalizeNormalInboundHumanSms,
  shouldSkipPhase2BrainForUnknownOutcomeEvent,
} from "@/lib/v2-human-sms-brain/finalize-normal-inbound-human-sms";
import {
  isV2HumanSmsPhase2NormalInboundEnabled,
  shouldRunPhase5aArcClarifyBrain,
  shouldRunPhase5aCentralTetherBrain,
  shouldRunPhase5aInboundStitchedFinalBrain,
  warnIfPhase2BrainWithoutValidatorEnforce,
} from "@/lib/v2-human-sms-brain/flags";
import {
  finalizePhase5aArcClarifyHumanSms,
  finalizePhase5aCentralTetherHumanSms,
  finalizePhase5aInboundStitchedFinalHumanSms,
} from "@/lib/v2-human-sms-brain/finalize-phase5a-human-sms";
import {
  appendCommitmentChangeNoteIfNeeded,
  COMMITMENT_APPEND_FOR_SCORED,
  buildAiGatedDecisionPayload,
  buildStoredShadowInterpretationPayload,
  buildUserReplyAiPayload,
  type V2InboundGatedMode,
  defaultGatedDecision,
  deterministicEventTypeToProposedKey,
  interpretV2InboundAccountabilityReply,
  isV2AiInboundGatedOutcomesEnabled,
  isV2InboundInterpretationRequested,
  resolveV2InboundCoachReplyBody,
  resolveV2InboundGatedDecision,
  strategyForInboundEventType,
  tryGenerateV2InboundMessage,
  type V2InboundGatedDecision,
  V2_INBOUND_AI_MODEL,
  V2_INBOUND_AI_PROMPT_VERSION,
} from "@/lib/v2-ai-inbound";
import {
  buildStoredMemorySignalPayload,
  insertV2SmsMemorySignalEvent,
  interpretV2InboundMemorySignals,
  isV2InboundMemorySignalsEnabled,
  pickBoundedMemorySnapshotForPending,
  shouldAttemptInboundMemorySignalInterpretation,
  type V2InboundMemorySignalsInput,
} from "@/lib/v2-inbound-memory-signals";
import { deriveV2SilenceContext, parseLatestCheckSentNextMoveType } from "@/lib/v2-ai-outbound";
import {
  buildV2SmsConversationContextPack,
  type V2SmsConversationContextPack,
} from "@/lib/v2-sms-conversation-context";
import {
  bumpIdentityRefreshCycleAfterRefreshStillReply,
  computeIdentityReferenceAllowedInbound,
  isIdentityRefreshDue,
  isQuotableIdentitySource,
  validateOnboardingIdentityAnchorInput,
} from "@/lib/v2-identity-anchor";
import {
  applyWave11ConfirmedProfileUpdates,
  buildWave11MemoryConfirmationQuestion,
  conservativeRelationshipCandidate,
  fetchLatestAwaitingMemoryConfirmation,
  insertWave11MemoryResolutionEvent,
  parseMemoryConfirmationReply,
  wave11AppendConfirmationIfFits,
  wave11ShouldOfferConfirmationOffer,
  WAVE11_MEMORY_CONFIRMATION_TTL_MS,
  type Wave11PendingMemoryKind,
} from "@/lib/v2-memory-confirmation-sms";
import {
  buildInboundProofCalloutHint,
  buildProofMomentForAccountabilityOutcome,
  buildProofMomentForBlockerCaptured,
  buildProofMomentForMemoryUpdated,
  patchVictoryCalloutOnSpineEventBestEffort,
  proofMomentPayloadFields,
  proofMomentToPromptHint,
} from "@/lib/v2-proof-moment";
import {
  buildGuidedResolutionChangeHandoffSms,
  buildGuidedResolutionNewHandoffSms,
  buildGuidedTightenHandoffSms,
  getPendingResolutionOrNull,
  isSmsInboundPendingResolutionActionable,
  mergeSmsPendingResolutionPayload,
} from "@/lib/v2-guided-resolution";
import {
  applyWave4SmsCommitmentPendingResolution,
  buildSmsCommitmentChangeCoachReply,
  deriveSmsCommitmentChangeIntent,
  shouldOpenCommitmentChangeHandoff,
  type V2SmsCommitmentIntentPack,
} from "@/lib/v2-sms-commitment-change";
import {
  bootstrapSmsPendingConfirmationFromInbound,
  tryHandleSmsInboundPendingResolution,
} from "@/lib/v2-sms-pending-resolution-complete";
import {
  applyRefreshCommitmentStepResolutionMutation,
  applyRefreshIdentityStepResolutionMutation,
  applyRefreshPromptedPostSendBookkeepingMutation,
  reconcileRefreshPostSendBookkeepingForCommitment,
  advanceSessionToCommitment,
  buildRefreshClarifyCommitmentSms,
  buildRefreshClarifyIdentitySms,
  buildRefreshKeepAckSms,
  buildRefreshStepCommitmentSms,
  isRefreshSessionActive,
  parseRefreshInboundWithNaturalLanguage,
  parseRefreshInboundToken,
  parseRefreshSession,
  persistRefreshSession,
  touchCommitmentRefreshPromptedTimestamp,
  type V2RefreshSessionState,
} from "@/lib/v2-refresh-session";
import {
  buildCentralBrainHumanTetherReply,
  interpretV2CentralSmsTurn,
  isV2CentralSmsBrainControlEnabled,
  maybeLogCentralBrainDisagreement,
  shouldCentralBrainBlockBlockerCapture,
  shouldCentralBrainBlockOutcomeScoring,
} from "@/lib/v2-central-sms-brain";
import {
  buildActiveReplyContextClarificationSms,
  buildV2ActiveReplyContext,
  isV2ActiveReplyContextEnabled,
} from "@/lib/v2-active-reply-context";
import {
  buildInboundMeaningFacts,
} from "@/lib/inbound-relationship-meaning";
import {
  inboundMeaningPayloadForOutcomePersist,
  isClearAccountabilityCompletionReply,
  laneExclusionFromGatedMode,
  logInboundOutcomePersistAttempt,
  persistInboundAccountabilityOutcomeEvent,
  shouldPersistInboundAccountabilityOutcome,
  type InboundOutcomePersistBranch,
  type InboundOutcomePersistLaneExclusion,
  type InboundOutcomePersistResult,
} from "@/lib/v2-inbound-accountability-outcome-persist";
import {
  loadPriorInboundMemoryRepeatNoSendContext,
  normalizeInboundTextForEscalation,
} from "@/lib/inbound-completion-memory-repeat-escalation";
import {
  clearBlockerCapturePending,
  exitLowPressureReactivationOnInbound,
  getActiveCommitment,
  getRecentV2EventsForAi,
  isBlockerCapturePendingActive,
  isBlockerCapturePendingExpired,
  setBlockerCapturePending,
  type ActiveV2CommitmentRow,
  type V2AccountabilityOutcome,
} from "@/lib/v2-commitment";
import {
  inboundSignalsCompletion,
  pickNorthStarWriterAttributionFields,
  type NorthStarCoachChannel,
  type NorthStarCoachSmsMeta,
  type NorthStarSmsContextPacket,
} from "@/lib/north-star-coach-sms";
import {
  finalizeNorthStarCoachSmsAsync,
  finalizeNorthStarInboundCoachReplyAsync,
} from "@/lib/north-star-coach-sms-openai";
import {
  buildInboundNorthStarContextPacket,
  mergeInboundOpenQuestionAuthority,
  recentEventsIncludeUserYesOnLocalDay,
  type ExpectedReplySemanticsV3,
} from "@/lib/north-star-sms-context-packet";
import { tryResolveAnswerToOpenQuestionTurn } from "@/lib/v3-sms-turn";
import {
  buildAnswerToOpenQuestionV3BrainPackage,
  buildMinimalInboundTranscriptLines,
  buildV3BrainMetadata,
  guaranteeV3InboundCoachDraft,
  inferV3InboundReplySource,
  isV3OwnedInboundReplySource,
  mapOutcomeToPurpose,
  produceV3InboundCoachDraft,
  recoverV3InboundCoachDraftFromArgs,
  tryGenerateV3OpenQuestionCoachReply,
  type V3SmsBrainResult,
} from "@/lib/v3-sms-brain";
import {
  buildCoachingBriefV1FromInboundFacts,
  compactCoachingBriefV1ForV3Brain,
} from "@/lib/coaching-brief-v1";
import {
  assertRequiredVerbatimSubstringsPresent,
  buildCommitmentChangeContextFactsForHeuristicInbound,
  buildCommitmentChangeInboundFactsFromWave4,
  buildConversationBrainFallbackFacts,
  buildInboundV3RelationshipFacts,
  contractConsentYesBindingVerbatimSubstring,
  formatInboundV3LaneNoSendLastError,
  produceInboundV3RelationshipSms,
  slimAdaptiveConsentClarificationFactsForTelemetry,
  slimArcClarificationFactsForTelemetry,
  slimBlockerFactsForTelemetry,
  slimCentralBrainBlockerPivotFactsForTelemetry,
  slimCentralBrainPivotFactsForTelemetry,
  slimCommitmentChangeFactsForTelemetry,
  slimContractConsentFactsForTelemetry,
  slimConversationBrainFallbackFactsForTelemetry,
  slimMemoryConfirmationFactsForTelemetry,
  slimOpenQuestionFactsForTelemetry,
  slimPendingResolutionFactsForTelemetry,
  slimRefreshFactsForTelemetry,
  type InboundV3AdaptiveConsentClarificationFacts,
  type InboundV3ArcFacts,
  type InboundV3CentralBrainFacts,
  type InboundV3CommitmentChangeFacts,
  type InboundV3ContractConsentFacts,
  type InboundV3ConversationBrainFacts,
  type InboundV3MemoryConfirmationFacts,
  type InboundV3OpenQuestionFacts,
  type InboundV3PendingResolutionFacts,
  type InboundV3RefreshFacts,
  type InboundV3CommsPreferencesFacts,
  type InboundV3RelationshipFacts,
  type InboundV3RelationshipLaneResult,
  type InboundV3RoutePurpose,
} from "@/lib/v3-inbound-relationship-lane";
import {
  applyInboundSmsCommsPreferencesFromMessage,
  buildInboundCommsPreferenceV3Facts,
  type InboundSmsCommsPreferenceTurnSnapshot,
} from "@/lib/v2-sms-comms-preferences";
import { computePendingCommitmentReplaceApplied } from "@/lib/v3-inbound-pending-replacement-truth";
import { buildInboundSeasonTransitionFacts } from "@/lib/v2-sms-goal-season-mutation";
import { deriveDoNotRepeatHintsFromCoachingMemory } from "@/lib/v3-daily-relationship-lane";
import {
  buildSmsRelationshipMemoryPacket,
  slimMemoryPacketForFacts,
} from "@/lib/sms-relationship-memory-packet";
import { relationshipObservabilityFromLaneMetadata } from "@/lib/sms-relationship-packet-v1";
import {
  loadSmsVictoryBackgroundContext,
  mapSmsVictoryBackgroundToFacts,
  type V3VictoryBackgroundFacts,
} from "@/lib/sms-victory-background-context";
import { deriveSmsGoalAdjustmentSignal } from "@/lib/sms-goal-adjustment-signal";
import { deriveSmsPatternSignal } from "@/lib/sms-pattern-signal";
import {
  applyPlannedInterruptionGatedOverride,
  buildPlannedInterruptionMemorySignalPayload,
  detectSmsPlannedInterruption,
  insertSmsPlannedInterruptionMemorySignal,
  isPlannedInterruptionActionable,
} from "@/lib/sms-planned-interruption";
import {
  applyRelationshipExitGatedOverride,
  buildInboundV3RelationshipExitFacts,
  detectSmsRelationshipExitIntent,
  isRelationshipExitLaneActive,
  shouldDeferRelationshipExitToGoalHandoff,
} from "@/lib/sms-relationship-exit-intent";
import {
  applyIdentityEditGatedOverride,
  buildInboundV3IdentityEditFacts,
  detectSmsIdentityEditIntent,
  isIdentityEditLaneActive,
  shouldSuppressCommitmentChangeHandoffForIdentity,
} from "@/lib/sms-identity-edit-intent";
import { evaluateCommitmentEvolutionForSms } from "@/lib/v2-sms-evolution-signal";
import {
  upsertCommitmentSmsThreadMemoryFromInbound,
  upsertCommitmentSmsThreadMemoryFromOutbound,
} from "@/lib/v2-commitment-sms-thread-memory";
import {
  buildCommitmentChangeHandoffThreadMemoryContext,
  deriveCommitmentChangeHandoffSmsStateFromFacts,
  resolveAdaptiveClarificationExpectedAnswerType,
  resolveContractConsentAckExpectedAnswerType,
  shouldClearBindingOpenQuestionOnContractAck,
} from "@/lib/inbound-deferred-thread-memory-projection";
import {
  buildV1ExtraNotebookAppend,
  buildV3LearningNotebookLine,
  deriveV3LearningSignalsFromContext,
} from "@/lib/v3-sms-learning";
import { V3_REFINE_ONLY_GATED } from "@/lib/v3-sms-machine-refine";
import { coalesceOlderPendingSplitJobsForClaimedJob } from "@/lib/sms-inbound-split-coalesce";
import { applyFinalVoiceOwnershipGate, type VoiceOwnershipResult } from "@/lib/v3-sms-voice-ownership";
import { isAppleMessengerTapbackLine } from "@/lib/sms-imessage-reaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Job status (text column):
 * pending → claimed → processing → generating_reply → reply_ready → sending → sent
 * failed: retriable; needs_manual_review: operator must reset (e.g. to pending) or verify Twilio
 * cancelled: user ineligible
 */
const CRON_SECRET = process.env.CRON_SECRET;

const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 25;
const STALE_PROCESSING_MINUTES = 15;

const farFutureIso = () =>
  new Date(Date.now() + 86400 * 365 * 10 * 1000).toISOString();

function timingSafeEqualUtf8(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function validateCronSecret(req: Request): boolean {
  if (!CRON_SECRET) return false;

  const xCron = req.headers.get("x-cron-secret");
  if (xCron && timingSafeEqualUtf8(xCron, CRON_SECRET)) return true;

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token && timingSafeEqualUtf8(token, CRON_SECRET)) return true;
  }

  const hasXCronHeader = req.headers.get("x-cron-secret") != null;
  const hasAuthorizationHeader = req.headers.get("authorization") != null;

  if (!hasXCronHeader && !hasAuthorizationHeader && req.method === "GET") {
    try {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/api/cron/")) {
        const qSecret = url.searchParams.get("cron_secret");
        if (qSecret && timingSafeEqualUtf8(qSecret, CRON_SECRET)) {
          console.log("[sms-inbound-coach] allowed via query cron_secret fallback");
          return true;
        }
      }
    } catch {
      // ignore
    }
  }

  return false;
}

function computeNextRetryIso(attempt: number): string {
  const sec = Math.min(600, 30 * Math.max(1, attempt));
  return new Date(Date.now() + sec * 1000).toISOString();
}

type JobRow = {
  message_sid: string;
  clerk_user_id: string;
  from_phone: string;
  raw_body: string;
  status: string;
  attempt_count: number;
  next_retry_at: string;
  reply_body: string | null;
  sent_at: string | null;
  last_error: string | null;
  outbound_message_sid: string | null;
  created_at?: string;
};

async function northStarGatePersistBodyAsync(
  replyBody: string,
  args: {
    job: JobRow;
    channel: NorthStarCoachChannel;
    lastOutboundBody?: string | null;
    effectiveAsk?: string | null;
    behaviorStatement?: string | null;
    finalEventType?: string | null;
    replySource?: string | null;
    contextPacket?: NorthStarSmsContextPacket;
    activeCommitmentId?: string | null;
    normalCoaching?: boolean;
    v3BrainMetadata?: Record<string, unknown> | null;
  }
): Promise<{ northStarVisibleBody: string; northStarMeta: NorthStarCoachSmsMeta; voice: VoiceOwnershipResult }> {
  const r = await finalizeNorthStarCoachSmsAsync({
    proposedBody: replyBody,
    channel: args.channel,
    latestInboundRaw: args.job.raw_body ?? "",
    latestOutboundBody: args.lastOutboundBody ?? null,
    effectiveAskText: args.effectiveAsk ?? undefined,
    behaviorStatement: args.behaviorStatement ?? undefined,
    finalEventType: args.finalEventType ?? undefined,
    replySource: args.replySource ?? undefined,
    alreadyCompletedToday:
      args.finalEventType === "user_yes" || inboundSignalsCompletion(args.job.raw_body),
    contextPacket: args.contextPacket,
  });
  const voice = await applyFinalVoiceOwnershipGate({
    proposedBody: r.visibleBody,
    replySource: args.replySource ?? undefined,
    channel: args.channel,
    activeCommitmentId: args.activeCommitmentId ?? args.contextPacket?.activeCommitmentId ?? null,
    effectiveAsk: args.effectiveAsk ?? args.contextPacket?.effectiveAskText ?? null,
    behaviorStatement: args.behaviorStatement ?? args.contextPacket?.behaviorStatement ?? null,
    latestInboundRaw: args.job.raw_body ?? "",
    latestOutboundBody: args.lastOutboundBody ?? args.contextPacket?.latestOutboundBody ?? null,
    latestOpenQuestion: args.contextPacket?.latestOpenQuestion ?? null,
    contextPacket: args.contextPacket,
    todayCompleted: args.contextPacket?.todayCompleted ?? null,
    finalEventType: args.finalEventType ?? args.contextPacket?.finalEventType ?? null,
    v3BrainMetadata: args.v3BrainMetadata ?? null,
    northStarMeta: r.meta,
    normalCoaching:
      args.normalCoaching ?? Boolean(args.activeCommitmentId ?? args.contextPacket?.activeCommitmentId),
  });
  return { northStarVisibleBody: r.visibleBody, northStarMeta: r.meta, voice };
}

/**
 * Phase 3F-2 — adaptive contract YES/NO/noop visible ACK via inbound V3 relationship lane.
 * Runs North Star and Final Voice Gate with required-verbatim survival checks between stages (binding-critical YES only).
 * Phase A — if V3 ack no-sends after state mutation, fall back to deterministic contract templates + FVG (not V3 lane).
 */
async function persistContractConsentAckReplyReadyAndSend(args: {
  job: JobRow;
  userId: string;
  commitment: ActiveV2CommitmentRow;
  gatedBody: string;
  routePurpose: InboundV3RoutePurpose;
  contractConsentFacts: InboundV3ContractConsentFacts;
  stateMutationCompletedBeforeSms: boolean;
  sendTelemetry: Record<string, unknown>;
}): Promise<{ ok: true; sentBody: string } | { ok: false }> {
  const proposalStillValid = isV2PendingProposalValid(args.commitment);
  const contractConsentMeaningShadow = buildContractConsentMeaningShadow({
    commitmentId: args.commitment.id,
    classifierEventType:
      args.contractConsentFacts.consent_parse === "user_yes" ? "user_yes" : "user_no",
    overlayAction: args.contractConsentFacts.overlay_action,
    rpcResult: args.contractConsentFacts.rpc_result,
    proposalKindDigest: args.contractConsentFacts.proposal_text_digest,
  });
  const contractAckThreadMemoryCtx = {
    commitmentId: args.commitment.id,
    expectedAnswerType: resolveContractConsentAckExpectedAnswerType({
      overlayAction: args.contractConsentFacts.overlay_action,
      rpcResult: args.contractConsentFacts.rpc_result,
      proposalStillValid,
    }),
    clearBindingOpenQuestion: shouldClearBindingOpenQuestionOnContractAck({
      overlayAction: args.contractConsentFacts.overlay_action,
      rpcResult: args.contractConsentFacts.rpc_result,
      proposalStillValid,
    }),
    meaningShadow: contractConsentMeaningShadow,
  };
  const now = new Date().toISOString();
  const { data: persistedLane } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      reply_body: args.gatedBody,
      status: "reply_ready",
      next_retry_at: now,
      updated_at: now,
      last_error: null,
    })
    .eq("message_sid", args.job.message_sid)
    .eq("status", "processing")
    .select()
    .maybeSingle();

  if (!persistedLane) {
    const j2 = await loadJob(args.job.message_sid);
    if (j2?.reply_body?.trim()) {
      await commitAndSendInboundRelationshipCoachReply(j2, args.userId, contractAckThreadMemoryCtx);
      return { ok: true, sentBody: j2.reply_body.trim() };
    }
    throw new Error("contract_consent_ack_reply_ready_persist_failed");
  }

  const fresh = (await loadJob(args.job.message_sid)) ?? args.job;
  await commitAndSendInboundRelationshipCoachReply(fresh, args.userId, contractAckThreadMemoryCtx);
  console.info("[sms-inbound-coach] contract_consent_ack_lane_sent", {
    message_sid: args.job.message_sid,
    commitment_id: args.commitment.id,
    ...args.sendTelemetry,
    should_send: true,
    contract_consent_facts_summary: slimContractConsentFactsForTelemetry(args.contractConsentFacts),
    state_mutation_completed_before_sms: args.stateMutationCompletedBeforeSms,
  });
  return { ok: true, sentBody: args.gatedBody };
}

async function persistContractConsentInboundLaneAckAndSend(args: {
  job: JobRow;
  userId: string;
  commitment: ActiveV2CommitmentRow;
  timezone: string;
  inboundRaw: string;
  routePurpose: InboundV3RoutePurpose;
  contractConsentFacts: InboundV3ContractConsentFacts;
  stateMutationCompletedBeforeSms: boolean;
  proposalText: string;
  contractKind: V2ContractOverlayKind;
}): Promise<{ ok: true; sentBody: string } | { ok: false }> {
  const wave11MemoryPending = (await fetchLatestAwaitingMemoryConfirmation(args.commitment.id)) != null;
  const { facts, contextPacket } = await buildTransactionalInboundLaneFactsPackage({
    job: args.job,
    userId: args.userId,
    commitment: args.commitment,
    timezone: args.timezone,
    inboundRaw: args.inboundRaw,
    splitSuppressedMessageSids: [],
    routePurpose: args.routePurpose,
    branchName: "contract_consent_ack",
    wave11MemoryConfirmationPending: wave11MemoryPending,
    contractConsentFacts: args.contractConsentFacts,
  });

  const telemetry_fact_sources = [
    "shouldConsumeInboundAsContractProposalConsentAsync",
    "classifyV2InboundReply",
    "v2_overlay_consent_rpc",
    "legacy_contract_ack_template_preview_only",
    "buildTransactionalInboundLaneFactsPackage",
  ];

  const baseTelemetry = () => ({
    route_purpose: args.routePurpose,
    branch_name: "contract_consent_ack",
    branch_migrated_to_lane: true,
    contract_consent_facts_summary: slimContractConsentFactsForTelemetry(args.contractConsentFacts),
    state_mutation_completed_before_sms: args.stateMutationCompletedBeforeSms,
    overlay_action: args.contractConsentFacts.overlay_action,
    rpc_result: args.contractConsentFacts.rpc_result,
  });

  let v3FailureTag: string | null = null;
  let v3FailureDetail: Record<string, unknown> | null = null;

  const lane = await produceInboundV3RelationshipSms({
    facts,
    telemetry_fact_sources,
  });

  let gatedBody: string | null = null;
  const lanePacketObs = relationshipObservabilityFromLaneMetadata(lane.metadata);
  let v3SendTelemetry: Record<string, unknown> = {
    inbound_v3_lane_used: true,
    branch_migrated_to_lane: true,
    branch_name: "contract_consent_ack",
    v3_lane_reply_source: "v3_inbound_relationship_lane",
    ...(Object.keys(lanePacketObs).length > 0
      ? { relationship_packet_observability: lanePacketObs }
      : {}),
  };

  if (!lane.shouldSend || !lane.body.trim()) {
    v3FailureTag = "contract_consent_ack_lane_no_send";
    v3FailureDetail = {
      reason: lane.noSendReason,
      lane_metadata: lane.metadata,
      ...(Object.keys(lanePacketObs).length > 0
        ? { relationship_packet_observability: lanePacketObs }
        : {}),
    };
    console.warn("[sms-inbound-coach] contract_consent_ack_inbound_lane_no_send", {
      message_sid: args.job.message_sid,
      commitment_id: args.commitment.id,
      reason: lane.noSendReason,
    });
  } else {
    const bindingCritical =
      Array.isArray(args.contractConsentFacts.required_verbatim_substrings) &&
      args.contractConsentFacts.required_verbatim_substrings.length > 0;

    const v3BrainMetadata: Record<string, unknown> = {
      ...lane.metadata,
      inbound_v3_relationship_lane: true,
      inbound_v3_lane_used: true,
      v3_lane_turn_purpose: lane.turnPurpose,
      route_purpose: facts.route_purpose,
      branch_migrated_to_lane: true,
      branch_name: "contract_consent_ack",
      v3_lane_reply_source: "v3_inbound_relationship_lane",
      v3_candidate_body: lane.body,
      old_inbound_writer_used_as_voice: false,
      old_inbound_writer_fact_sources: telemetry_fact_sources,
      required_verbatim_substrings: args.contractConsentFacts.required_verbatim_substrings ?? null,
      required_meaning_summary: args.contractConsentFacts.required_meaning_summary ?? null,
      server_state_transition_summary: args.contractConsentFacts.server_state_transition_summary,
      contract_consent_facts_summary: slimContractConsentFactsForTelemetry(args.contractConsentFacts),
      state_mutation_completed_before_sms: args.stateMutationCompletedBeforeSms,
      overlay_action: args.contractConsentFacts.overlay_action,
      rpc_result: args.contractConsentFacts.rpc_result,
    };

    const nsr = await finalizeNorthStarCoachSmsAsync({
      proposedBody: lane.body,
      channel: "contract_ack",
      latestInboundRaw: args.job.raw_body ?? "",
      latestOutboundBody: contextPacket.latestOutboundBody ?? null,
      effectiveAskText: getEffectiveCoachingAsk(args.commitment, Date.now()) ?? undefined,
      behaviorStatement: args.commitment.behavior_statement ?? undefined,
      finalEventType: contextPacket.finalEventType ?? undefined,
      replySource: "v3_inbound_relationship_lane",
      alreadyCompletedToday:
        contextPacket.finalEventType === "user_yes" || inboundSignalsCompletion(args.job.raw_body),
      contextPacket,
    });

    if (bindingCritical) {
      const postNs = assertRequiredVerbatimSubstringsPresent(
        "post_north_star",
        nsr.visibleBody,
        args.contractConsentFacts.required_verbatim_substrings
      );
      if (!postNs.ok) {
        v3FailureTag = "contract_required_verbatim_missing_post_north_star";
        v3FailureDetail = { missing: postNs.missing, body_preview: nsr.visibleBody.slice(0, 280) };
        console.warn("[sms-inbound-coach] contract_consent_ack_verbatim_missing_post_north_star", {
          message_sid: args.job.message_sid,
          missing: postNs.missing,
        });
      }
    }

    if (!v3FailureTag) {
      const voice = await applyFinalVoiceOwnershipGate({
        proposedBody: nsr.visibleBody,
        replySource: "v3_inbound_relationship_lane",
        channel: "contract_ack",
        activeCommitmentId: args.commitment.id,
        effectiveAsk: getEffectiveCoachingAsk(args.commitment, Date.now()),
        behaviorStatement: args.commitment.behavior_statement ?? null,
        latestInboundRaw: args.job.raw_body ?? "",
        latestOutboundBody: contextPacket.latestOutboundBody ?? null,
        latestOpenQuestion: contextPacket.latestOpenQuestion ?? null,
        contextPacket,
        todayCompleted: contextPacket.todayCompleted ?? null,
        finalEventType: contextPacket.finalEventType ?? null,
        v3BrainMetadata,
        northStarMeta: nsr.meta,
        normalCoaching: true,
      });

      if (!voice.shouldSend) {
        v3FailureTag = "contract_consent_ack_final_voice_suppressed";
        v3FailureDetail = {
          skip_reason: voice.skipReason,
          final_voice_gate: voice.metadata,
        };
        console.warn("[sms-inbound-coach] contract_consent_ack_final_voice_suppressed", {
          message_sid: args.job.message_sid,
        });
      } else if (bindingCritical) {
        const postFvg = assertRequiredVerbatimSubstringsPresent(
          "post_final_voice_gate",
          voice.body,
          args.contractConsentFacts.required_verbatim_substrings
        );
        if (!postFvg.ok) {
          v3FailureTag = "contract_required_verbatim_missing_post_final_voice_gate";
          v3FailureDetail = { missing: postFvg.missing, body_preview: voice.body.slice(0, 280) };
          console.warn("[sms-inbound-coach] contract_consent_ack_verbatim_missing_post_final_voice_gate", {
            message_sid: args.job.message_sid,
            missing: postFvg.missing,
          });
        } else {
          gatedBody = voice.body;
          v3SendTelemetry = {
            ...v3SendTelemetry,
            route_purpose: facts.route_purpose,
            v3_candidate_body: gatedBody.slice(0, 500),
            north_star_gate: {
              original_body: nsr.meta.originalBody,
              final_body: nsr.visibleBody,
              north_star_gate_source: nsr.meta.source,
              north_star_gate_reasons: nsr.meta.blockedReasons,
              ...pickNorthStarWriterAttributionFields(nsr.meta),
            },
            final_voice_gate: voice.metadata,
          };
        }
      } else {
        gatedBody = voice.body;
        v3SendTelemetry = {
          ...v3SendTelemetry,
          route_purpose: facts.route_purpose,
          v3_candidate_body: gatedBody.slice(0, 500),
          north_star_gate: {
            original_body: nsr.meta.originalBody,
            final_body: nsr.visibleBody,
            north_star_gate_source: nsr.meta.source,
            north_star_gate_reasons: nsr.meta.blockedReasons,
            ...pickNorthStarWriterAttributionFields(nsr.meta),
          },
          final_voice_gate: voice.metadata,
        };
      }
    }
  }

  if (gatedBody?.trim()) {
    return persistContractConsentAckReplyReadyAndSend({
      job: args.job,
      userId: args.userId,
      commitment: args.commitment,
      gatedBody: gatedBody.trim(),
      routePurpose: args.routePurpose,
      contractConsentFacts: args.contractConsentFacts,
      stateMutationCompletedBeforeSms: args.stateMutationCompletedBeforeSms,
      sendTelemetry: v3SendTelemetry,
    });
  }

  const consentParse =
    args.contractConsentFacts.consent_parse === "user_yes" ? ("user_yes" as const) : ("user_no" as const);
  const optionalBinding =
    args.contractConsentFacts.required_verbatim_substrings?.find((s) => s.trim().length > 0)?.trim() ??
    null;
  const humanVoiceAck = await prepareContractConsentHumanVoiceAckForSend({
    buildArgs: {
      consentParse,
      messageSid: args.job.message_sid,
      proposalText: args.proposalText,
      contractKind: args.contractKind,
      behaviorStatement: args.commitment.behavior_statement ?? "",
      effectiveAsk: getEffectiveCoachingAsk(args.commitment, Date.now()) ?? "",
      contractConsentFacts: {
        overlay_action: args.contractConsentFacts.overlay_action,
        rpc_result: args.contractConsentFacts.rpc_result,
        proposal_text_digest: args.contractConsentFacts.proposal_text_digest,
        required_meaning_summary: args.contractConsentFacts.required_meaning_summary ?? null,
      },
      optionalBindingHint: optionalBinding,
    },
    optionalBindingSubstring: optionalBinding,
    voiceArgs: {
      commitmentId: args.commitment.id,
      effectiveAsk: getEffectiveCoachingAsk(args.commitment, Date.now()),
      behaviorStatement: args.commitment.behavior_statement ?? null,
      latestInboundRaw: args.job.raw_body ?? "",
      latestOutboundBody: contextPacket.latestOutboundBody ?? null,
      latestOpenQuestion: contextPacket.latestOpenQuestion ?? null,
      contextPacket,
      todayCompleted: contextPacket.todayCompleted ?? null,
      finalEventType: contextPacket.finalEventType ?? null,
    },
  });

  if (humanVoiceAck.ok) {
    console.info("[sms-inbound-coach] contract_consent_human_voice_ack_sent", {
      message_sid: args.job.message_sid,
      commitment_id: args.commitment.id,
      v3_failure_tag: v3FailureTag,
      contract_consent_human_voice_ack: true,
      generation_source: humanVoiceAck.generation_source,
      overlay_action: args.contractConsentFacts.overlay_action,
      rpc_result: args.contractConsentFacts.rpc_result,
    });
    return persistContractConsentAckReplyReadyAndSend({
      job: args.job,
      userId: args.userId,
      commitment: args.commitment,
      gatedBody: humanVoiceAck.body,
      routePurpose: args.routePurpose,
      contractConsentFacts: args.contractConsentFacts,
      stateMutationCompletedBeforeSms: args.stateMutationCompletedBeforeSms,
      sendTelemetry: {
        inbound_v3_lane_used: false,
        contract_consent_human_voice_ack: true,
        contract_consent_ack_fallback: true,
        generation_source: humanVoiceAck.generation_source,
        v3_failure_tag: v3FailureTag,
        final_voice_gate: humanVoiceAck.voice.metadata,
      },
    });
  }

  recordInboundMeaningShadowSuppressedNoSend({
    job: args.job,
    userId: args.userId,
    commitmentId: args.commitment.id,
    skipReason: v3FailureTag ?? "contract_consent_ack_failed",
    rawBody: args.inboundRaw,
    lastErrorTag: "contract_consent_ack_v3_and_human_voice_failed",
    routeOverride: MEANING_INTERPRETER_ROUTES.suppressed_no_send,
  });
  await markJobFinal({
    messageSid: args.job.message_sid,
    status: "cancelled",
    lastError: JSON.stringify({
      tag: "contract_consent_ack_v3_and_human_voice_failed",
      v3_failure_tag: v3FailureTag,
      v3_failure_detail: v3FailureDetail,
      human_voice_failure_reason: humanVoiceAck.reason,
      human_voice_failure_detail: humanVoiceAck.detail,
      ...baseTelemetry(),
    }).slice(0, 1900),
    nextRetry: farFutureIso(),
  });
  console.warn("[sms-inbound-coach] contract_consent_ack_v3_and_human_voice_failed", {
    message_sid: args.job.message_sid,
    commitment_id: args.commitment.id,
    v3_failure_tag: v3FailureTag,
    human_voice_reason: humanVoiceAck.reason,
  });
  return { ok: false };
}

/**
 * Phase 3F-3 — pending adaptive proposal + consent-adjacent ambiguous inbound: V3 clarification only.
 * No overlay RPC, no accountability outcome event, no blocker capture pending.
 */
async function persistAdaptiveProposalConsentClarificationAndSend(args: {
  job: JobRow;
  userId: string;
  commitment: ActiveV2CommitmentRow;
  timezone: string;
  inboundRaw: string;
  adaptiveConsentClarificationFacts: InboundV3AdaptiveConsentClarificationFacts;
}): Promise<{ ok: true; sentBody: string } | { ok: false }> {
  const wave11MemoryPending = (await fetchLatestAwaitingMemoryConfirmation(args.commitment.id)) != null;
  const { facts, contextPacket } = await buildTransactionalInboundLaneFactsPackage({
    job: args.job,
    userId: args.userId,
    commitment: args.commitment,
    timezone: args.timezone,
    inboundRaw: args.inboundRaw,
    splitSuppressedMessageSids: [],
    routePurpose: "adaptive_proposal_consent_clarification",
    branchName: "adaptive_proposal_consent_clarification",
    wave11MemoryConfirmationPending: wave11MemoryPending,
    adaptiveConsentClarificationFacts: args.adaptiveConsentClarificationFacts,
  });

  const telemetry_fact_sources = [
    "latestOutboundBodyContainsAdaptiveProposalBindingNeedle",
    "evaluateAdaptiveProposalAmbiguousConsentGate",
    "buildTransactionalInboundLaneFactsPackage",
  ];

  const lane = await produceInboundV3RelationshipSms({
    facts,
    telemetry_fact_sources,
  });

  const baseTelemetry = () => ({
    route_purpose: "adaptive_proposal_consent_clarification" as const,
    branch_name: "adaptive_proposal_consent_clarification",
    branch_migrated_to_lane: true,
    adaptive_consent_clarification_facts_summary: slimAdaptiveConsentClarificationFactsForTelemetry(
      args.adaptiveConsentClarificationFacts
    ),
    server_action_taken: "none" as const,
    state_remains_pending: true as const,
  });

  if (!lane.shouldSend || !lane.body.trim()) {
    await markJobFinal({
      messageSid: args.job.message_sid,
      status: "cancelled",
      lastError: formatInboundV3LaneNoSendLastError(lane, baseTelemetry()),
      nextRetry: farFutureIso(),
    });
    console.warn("[sms-inbound-coach] adaptive_proposal_consent_clarification_lane_no_send", {
      message_sid: args.job.message_sid,
      commitment_id: args.commitment.id,
      reason: lane.noSendReason,
    });
    return { ok: false };
  }

  const v3BrainMetadata: Record<string, unknown> = {
    ...lane.metadata,
    inbound_v3_relationship_lane: true,
    inbound_v3_lane_used: true,
    v3_lane_turn_purpose: lane.turnPurpose,
    route_purpose: facts.route_purpose,
    branch_migrated_to_lane: true,
    branch_name: "adaptive_proposal_consent_clarification",
    v3_lane_reply_source: "v3_inbound_relationship_lane",
    v3_candidate_body: lane.body,
    old_inbound_writer_used_as_voice: false,
    old_inbound_writer_fact_sources: telemetry_fact_sources,
    required_meaning_summary: args.adaptiveConsentClarificationFacts.required_meaning_summary,
    server_action_taken: "none",
    state_remains_pending: true,
    adaptive_consent_clarification_facts_summary: slimAdaptiveConsentClarificationFactsForTelemetry(
      args.adaptiveConsentClarificationFacts
    ),
  };

  const voicePack = await northStarGatePersistBodyAsync(lane.body, {
    job: args.job,
    channel: "clarification",
    lastOutboundBody: contextPacket.latestOutboundBody ?? null,
    effectiveAsk: getEffectiveCoachingAsk(args.commitment, Date.now()),
    behaviorStatement: args.commitment.behavior_statement,
    finalEventType: contextPacket.finalEventType ?? null,
    replySource: "v3_inbound_relationship_lane",
    contextPacket,
    activeCommitmentId: args.commitment.id,
    normalCoaching: true,
    v3BrainMetadata,
  });

  if (!voicePack.voice.shouldSend) {
    await markJobFinal({
      messageSid: args.job.message_sid,
      status: "cancelled",
      lastError: finalVoiceSkipLastError(voicePack.voice, {
        ...baseTelemetry(),
        v3_lane_reply_source: "v3_inbound_relationship_lane",
        v3_candidate_body: lane.body.slice(0, 500),
        lane_metadata: lane.metadata,
        north_star_gate: {
          original_body: voicePack.northStarMeta.originalBody,
          final_body: voicePack.northStarVisibleBody,
          north_star_gate_source: voicePack.northStarMeta.source,
          north_star_gate_reasons: voicePack.northStarMeta.blockedReasons,
          ...pickNorthStarWriterAttributionFields(voicePack.northStarMeta),
        },
        final_voice_gate: voicePack.voice.metadata,
        should_send: false,
      }),
      nextRetry: farFutureIso(),
    });
    console.warn("[sms-inbound-coach] adaptive_proposal_consent_clarification_final_voice_suppressed", {
      message_sid: args.job.message_sid,
    });
    return { ok: false };
  }

  const gatedBody = voicePack.voice.body;
  const adaptiveConsentClassification = classifyV2InboundReply(args.inboundRaw.trim());
  const adaptiveClarificationThreadMemoryCtx = {
    commitmentId: args.commitment.id,
    expectedAnswerType: resolveAdaptiveClarificationExpectedAnswerType({
      stateRemainsPending: args.adaptiveConsentClarificationFacts.state_remains_pending,
      gatedBody,
    }),
    meaningShadow: buildContractAmbiguousConsentMeaningShadow({
      commitmentId: args.commitment.id,
      classifierEventType: adaptiveConsentClassification.eventType,
      inboundParse: args.adaptiveConsentClarificationFacts.inbound_parse,
      proposalKindDigest: args.adaptiveConsentClarificationFacts.proposal_text_digest,
    }),
  };
  const now = new Date().toISOString();
  const { data: persistedLane } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      reply_body: gatedBody,
      status: "reply_ready",
      next_retry_at: now,
      updated_at: now,
      last_error: null,
    })
    .eq("message_sid", args.job.message_sid)
    .eq("status", "processing")
    .select()
    .maybeSingle();

  if (!persistedLane) {
    const j2 = await loadJob(args.job.message_sid);
    if (j2?.reply_body?.trim()) {
      await commitAndSendInboundRelationshipCoachReply(
        j2,
        args.userId,
        adaptiveClarificationThreadMemoryCtx
      );
      return { ok: true, sentBody: j2.reply_body.trim() };
    }
    throw new Error("adaptive_proposal_consent_clarification_reply_ready_persist_failed");
  }

  const fresh = (await loadJob(args.job.message_sid)) ?? args.job;
  await commitAndSendInboundRelationshipCoachReply(
    fresh,
    args.userId,
    adaptiveClarificationThreadMemoryCtx
  );
  console.info("[sms-inbound-coach] adaptive_proposal_consent_clarification_lane_sent", {
    message_sid: args.job.message_sid,
    commitment_id: args.commitment.id,
    inbound_v3_lane_used: true,
    route_purpose: facts.route_purpose,
    branch_migrated_to_lane: true,
    branch_name: "adaptive_proposal_consent_clarification",
    v3_lane_reply_source: "v3_inbound_relationship_lane",
    v3_candidate_body: gatedBody.slice(0, 500),
    should_send: true,
    server_action_taken: "none",
    state_remains_pending: true,
    adaptive_consent_clarification_facts_summary: slimAdaptiveConsentClarificationFactsForTelemetry(
      args.adaptiveConsentClarificationFacts
    ),
    north_star_gate: {
      original_body: voicePack.northStarMeta.originalBody,
      final_body: voicePack.northStarVisibleBody,
      north_star_gate_source: voicePack.northStarMeta.source,
      north_star_gate_reasons: voicePack.northStarMeta.blockedReasons,
      ...pickNorthStarWriterAttributionFields(voicePack.northStarMeta),
    },
    final_voice_gate: voicePack.voice.metadata,
  });
  return { ok: true, sentBody: gatedBody };
}

/**
 * Phase 3F-4 Slice 1 — commitment_change_handoff: visible SMS from inbound V3 relationship lane only.
 * Server-owned Wave4 pending resolution runs upstream; no deterministic/V3-refine fallback as final body.
 */
async function persistCommitmentChangeHandoffLaneAndSend(args: {
  job: JobRow;
  userId: string;
  commitment: ActiveV2CommitmentRow;
  timezone: string;
  inboundRaw: string;
  splitSuppressedMessageSids: string[];
  gatedDecision: V2InboundGatedDecision;
  deterministicEventType: "user_yes" | "user_no" | "user_partial";
  commitmentChangeFacts: InboundV3CommitmentChangeFacts;
  wave4PendingResult: Awaited<ReturnType<typeof applyWave4SmsCommitmentPendingResolution>>;
  shouldPersistNonOutcomeMemoryEvent: boolean;
  memorySignalStored: ReturnType<typeof buildStoredMemorySignalPayload> | null;
}): Promise<{ ok: true; sentBody: string } | { ok: false }> {
  const wave11MemoryPending = (await fetchLatestAwaitingMemoryConfirmation(args.commitment.id)) != null;
  const { facts, contextPacket } = await buildTransactionalInboundLaneFactsPackage({
    job: args.job,
    userId: args.userId,
    commitment: args.commitment,
    timezone: args.timezone,
    inboundRaw: args.inboundRaw,
    splitSuppressedMessageSids: args.splitSuppressedMessageSids,
    routePurpose: "commitment_change_handoff",
    branchName: "commitment_change_handoff",
    wave11MemoryConfirmationPending: wave11MemoryPending,
    commitmentChangeFacts: args.commitmentChangeFacts,
    gatedDecisionOverride: args.gatedDecision,
    deterministicClassifierOverride: args.deterministicEventType,
  });

  const telemetry_fact_sources = [
    "deriveSmsCommitmentChangeIntent",
    "applyWave4SmsCommitmentPendingResolution",
    "buildCommitmentChangeInboundFactsFromWave4",
    "buildTransactionalInboundLaneFactsPackage",
  ];

  const lane = await produceInboundV3RelationshipSms({
    facts,
    telemetry_fact_sources,
  });

  const baseTelemetry = () => ({
    route_purpose: "commitment_change_handoff" as const,
    branch_name: "commitment_change_handoff",
    branch_migrated_to_lane: true,
    commitment_change_facts_summary: slimCommitmentChangeFactsForTelemetry(args.commitmentChangeFacts),
    pending_resolution_created: args.commitmentChangeFacts.pending_resolution_created,
    pending_resolution_type: args.commitmentChangeFacts.pending_resolution_type,
    pending_resolution_skip_reason: args.commitmentChangeFacts.pending_resolution_skip_reason,
    existing_pending_resolution: args.commitmentChangeFacts.existing_pending_resolution,
    server_state_transition_summary: args.commitmentChangeFacts.server_state_transition_summary,
    required_meaning_summary: args.commitmentChangeFacts.required_meaning_summary,
    required_verbatim_substrings: args.commitmentChangeFacts.required_verbatim_substrings ?? null,
  });

  if (!lane.shouldSend || !lane.body.trim()) {
    await markJobFinal({
      messageSid: args.job.message_sid,
      status: "cancelled",
      lastError: formatInboundV3LaneNoSendLastError(lane, {
        ...baseTelemetry(),
      }),
      nextRetry: farFutureIso(),
    });
    console.warn("[sms-inbound-coach] commitment_change_handoff_lane_no_send", {
      message_sid: args.job.message_sid,
      commitment_id: args.commitment.id,
      reason: lane.noSendReason,
    });
    return { ok: false };
  }

  const v3BrainMetadata: Record<string, unknown> = {
    ...lane.metadata,
    inbound_v3_relationship_lane: true,
    inbound_v3_lane_used: true,
    v3_lane_turn_purpose: lane.turnPurpose,
    v3_lane_reply_source: "v3_inbound_relationship_lane",
    v3_candidate_body: lane.body,
    old_inbound_writer_used_as_voice: false,
    old_inbound_writer_fact_sources: telemetry_fact_sources,
    ...baseTelemetry(),
  };

  const voicePack = await northStarGatePersistBodyAsync(lane.body, {
    job: args.job,
    channel: "inbound_coach_reply",
    lastOutboundBody: contextPacket.latestOutboundBody ?? null,
    effectiveAsk: getEffectiveCoachingAsk(args.commitment, Date.now()),
    behaviorStatement: args.commitment.behavior_statement,
    finalEventType: contextPacket.finalEventType ?? null,
    replySource: "v3_inbound_relationship_lane",
    contextPacket,
    activeCommitmentId: args.commitment.id,
    normalCoaching: true,
    v3BrainMetadata,
  });

  const runRecordedSideEffects = async () => {
    if (
      args.wave4PendingResult.pendingApplied &&
      args.memorySignalStored != null &&
      args.memorySignalStored.memory_signal_detected === true &&
      args.gatedDecision.mode === "commitment_change_handoff"
    ) {
      const mergedPr = await mergeSmsPendingResolutionPayload({
        commitmentId: args.commitment.id,
        merge: (prev) => ({
          ...prev,
          memory_signal_snapshot: pickBoundedMemorySnapshotForPending(args.memorySignalStored!),
          last_inbound_memory_signal_at: new Date().toISOString(),
        }),
      });
      if (!mergedPr.ok) {
        console.warn("[v9.1-memory-signals] pending_payload_merge_failed", {
          commitment_id: args.commitment.id,
          error: mergedPr.error,
        });
      }
    }
    if (args.shouldPersistNonOutcomeMemoryEvent && args.memorySignalStored != null) {
      await insertV2SmsMemorySignalEvent({
        commitmentId: args.commitment.id,
        clerkUserId: args.userId,
        messageSid: args.job.message_sid,
        messagePreview: args.inboundRaw,
        gatedMode: args.gatedDecision.mode,
        memorySignal: args.memorySignalStored,
      });
    }
    await recordV2SendTimeProfileInboundEngagement(args.userId, args.timezone, new Date());
  };

  await runRecordedSideEffects();

  if (!voicePack.voice.shouldSend) {
    await markJobFinal({
      messageSid: args.job.message_sid,
      status: "cancelled",
      lastError: finalVoiceSkipLastError(voicePack.voice, {
        ...baseTelemetry(),
        v3_lane_reply_source: "v3_inbound_relationship_lane",
        v3_candidate_body: lane.body.slice(0, 500),
        lane_metadata: lane.metadata,
        north_star_gate: {
          original_body: voicePack.northStarMeta.originalBody,
          final_body: voicePack.northStarVisibleBody,
          north_star_gate_source: voicePack.northStarMeta.source,
          north_star_gate_reasons: voicePack.northStarMeta.blockedReasons,
          ...pickNorthStarWriterAttributionFields(voicePack.northStarMeta),
        },
        final_voice_gate: voicePack.voice.metadata,
        should_send: false,
      }),
      nextRetry: farFutureIso(),
    });
    console.warn("[sms-inbound-coach] commitment_change_handoff_final_voice_suppressed", {
      message_sid: args.job.message_sid,
    });
    return { ok: false };
  }

  const gatedBody = voicePack.voice.body;
  const handoffSmsState = deriveCommitmentChangeHandoffSmsStateFromFacts({
    pendingResolutionCreated: args.commitmentChangeFacts.pending_resolution_created,
    serverStateTransitionSummary: args.commitmentChangeFacts.server_state_transition_summary,
  });
  const commitmentChangeHandoffThreadMemoryCtx = {
    ...buildCommitmentChangeHandoffThreadMemoryContext({
      commitmentId: args.commitment.id,
      smsState: handoffSmsState,
      pendingKind: args.commitmentChangeFacts.pending_resolution_type,
      gatedBody,
    }),
    meaningShadow: buildNormalLaneMeaningShadow({
      commitmentId: args.commitment.id,
      route: MEANING_INTERPRETER_ROUTES.commitment_change_handoff,
      classifierEventType: classifyV2InboundReply(args.inboundRaw.trim()).eventType,
      classifierNormalizedHint:
        classifyV2InboundReply(args.inboundRaw.trim()).normalizedHint ?? null,
      gatedMode: "commitment_change_handoff",
      pendingResolutionKind: args.commitmentChangeFacts.pending_resolution_type,
      behaviorStatement: args.commitment.behavior_statement ?? null,
    }),
  };
  const now = new Date().toISOString();
  const { data: persistedLane } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      reply_body: gatedBody,
      status: "reply_ready",
      next_retry_at: now,
      updated_at: now,
      last_error: null,
    })
    .eq("message_sid", args.job.message_sid)
    .eq("status", "processing")
    .select()
    .maybeSingle();

  if (!persistedLane) {
    const j2 = await loadJob(args.job.message_sid);
    if (j2?.reply_body?.trim()) {
      await commitAndSendInboundRelationshipCoachReply(
        j2,
        args.userId,
        commitmentChangeHandoffThreadMemoryCtx
      );
      return { ok: true, sentBody: j2.reply_body.trim() };
    }
    throw new Error("commitment_change_handoff_reply_ready_persist_failed");
  }

  const fresh = (await loadJob(args.job.message_sid)) ?? args.job;
  await commitAndSendInboundRelationshipCoachReply(
    fresh,
    args.userId,
    commitmentChangeHandoffThreadMemoryCtx
  );
  console.info("[sms-inbound-coach] commitment_change_handoff_lane_sent", {
    message_sid: args.job.message_sid,
    commitment_id: args.commitment.id,
    inbound_v3_lane_used: true,
    v3_lane_reply_source: "v3_inbound_relationship_lane",
    v3_candidate_body: gatedBody.slice(0, 500),
    should_send: true,
    twilio_send_attempted: true,
    ...baseTelemetry(),
    north_star_gate: {
      original_body: voicePack.northStarMeta.originalBody,
      final_body: voicePack.northStarVisibleBody,
      north_star_gate_source: voicePack.northStarMeta.source,
      north_star_gate_reasons: voicePack.northStarMeta.blockedReasons,
      ...pickNorthStarWriterAttributionFields(voicePack.northStarMeta),
    },
    final_voice_gate: voicePack.voice.metadata,
  });
  return { ok: true, sentBody: gatedBody };
}

async function handleAdaptiveProposalConsentAmbiguousInbound(
  job: JobRow,
  userId: string,
  commitment: ActiveV2CommitmentRow,
  timezone: string
): Promise<boolean> {
  if (!isV2PendingProposalValid(commitment)) return false;
  const proposalText = commitment.adaptive_proposal_text?.trim();
  if (!proposalText) return false;

  const { data: lastCtx } = await supabaseServer
    .from("sms_last_outbound_context")
    .select("full_body,twilio_message_sid")
    .eq("clerk_user_id", userId)
    .maybeSingle();
  const lastBody = typeof lastCtx?.full_body === "string" ? lastCtx.full_body : "";
  const lastSid =
    typeof lastCtx?.twilio_message_sid === "string" ? lastCtx.twilio_message_sid.trim() : null;

  const outboundStillProposalPrompt = await outboundSupportsPendingAdaptiveProposalContextAsync({
    commitmentId: commitment.id,
    clerkUserId: userId,
    canonicalProposalText: proposalText,
    latestOutboundBody: lastBody,
    lastTwilioMessageSid: lastSid,
  });
  if (!outboundStillProposalPrompt) return false;

  const raw = (job.raw_body || "").trim();
  const classification = classifyV2InboundReply(raw);
  if (classification.eventType === "user_yes" || classification.eventType === "user_no") return false;

  if (isLikelySmsComplianceOrOptOutTurn(raw)) return false;
  if (isLikelyCommitmentChangeIntentTurn(raw)) return false;

  const gate = evaluateAdaptiveProposalAmbiguousConsentGate({ inboundBody: raw, classification });
  if (!gate.shouldRoute) return false;

  const contractKind = await resolvePendingProposalContractKind({
    commitmentId: commitment.id,
    proposalText,
  });
  const digest = proposalText.length > 180 ? `${proposalText.slice(0, 177)}...` : proposalText;
  const legacyPreview =
    "Reply YES or NO if you want this adjusted ask, or NO to keep your current bar.".slice(0, 500);
  const requiredMeaning =
    "Ask the user to reply with a clear YES or NO about the pending adaptive proposal only before any change. Do not imply they already accepted or declined. Do not treat this as answering today's accountability check.";

  const adaptiveConsentClarificationFacts: InboundV3AdaptiveConsentClarificationFacts = {
    latest_outbound_was_proposal: true,
    pending_proposal_valid: true,
    proposal_kind: String(contractKind),
    proposal_text_digest: digest,
    inbound_parse: gate.inboundParse,
    server_action_taken: "none",
    state_remains_pending: true,
    required_meaning_summary: requiredMeaning,
    legacy_clarification_preview: legacyPreview,
    inbound_message_sid: job.message_sid,
  };

  const r = await persistAdaptiveProposalConsentClarificationAndSend({
    job,
    userId,
    commitment,
    timezone,
    inboundRaw: raw,
    adaptiveConsentClarificationFacts,
  });
  if (r.ok) {
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
  }
  return true;
}

function recordInboundMeaningShadowSuppressedNoSend(args: {
  job: JobRow;
  userId: string;
  commitmentId: string;
  skipReason: string;
  rawBody?: string;
  lastErrorTag?: string | null;
  routeOverride?: string;
  schedule?: MeaningInterpreterShadowScheduleArgs | null;
  extraFacts?: Partial<MeaningInterpreterDeterministicFacts>;
}): void {
  const schedule =
    args.schedule ??
    buildMeaningShadowScheduleArgs({
      deterministicRoute: args.routeOverride ?? MEANING_INTERPRETER_ROUTES.suppressed_no_send,
      commitmentId: args.commitmentId,
      deterministicFacts: buildSkippedMeaningShadowFacts({
        skipReason: args.skipReason,
        jobFinalStatus: "cancelled",
        lastErrorTag: args.lastErrorTag ?? null,
      }),
    });

  registerMeaningInterpreterShadowPending(
    buildMeaningInterpreterShadowFinalizeFromSchedule({
      clerkUserId: args.userId,
      inboundMessageSid: args.job.message_sid,
      coachJobMessageSid: args.job.message_sid,
      commitmentId: args.commitmentId,
      rawBody: args.rawBody ?? args.job.raw_body ?? "",
      outcomeSent: false,
      jobStatus: "cancelled",
      deterministicRoute: schedule.deterministicRoute,
      deterministicFacts: mergeMeaningInterpreterDeterministicFacts(
        schedule.deterministicFacts,
        mergeMeaningInterpreterDeterministicFacts(
          buildSkippedMeaningShadowFacts({
            skipReason: args.skipReason,
            jobFinalStatus: "cancelled",
            lastErrorTag: args.lastErrorTag ?? null,
          }),
          args.extraFacts ?? {}
        )
      ),
      skipReason: schedule.skipReason,
    })
  );
}

function registerInboundMeaningShadowPending(args: {
  job: JobRow;
  userId: string;
  schedule: MeaningInterpreterShadowScheduleArgs;
  rawBody?: string;
  outcomeSent?: boolean;
  extraFacts?: Partial<MeaningInterpreterDeterministicFacts>;
}): void {
  registerMeaningInterpreterShadowPending(
    buildMeaningInterpreterShadowFinalizeFromSchedule({
      clerkUserId: args.userId,
      inboundMessageSid: args.job.message_sid,
      coachJobMessageSid: args.job.message_sid,
      commitmentId: args.schedule.commitmentId ?? null,
      rawBody: args.rawBody ?? args.job.raw_body ?? "",
      outcomeSent: args.outcomeSent ?? false,
      deterministicRoute: args.schedule.deterministicRoute,
      deterministicFacts: mergeMeaningInterpreterDeterministicFacts(
        args.schedule.deterministicFacts,
        args.extraFacts ?? {}
      ),
      skipReason: args.schedule.skipReason,
    })
  );
}

async function finalizeMeaningShadowAfterJobTerminal(args: {
  messageSid: string;
  jobStatus: string;
  lastError?: string | null;
}): Promise<void> {
  const taken = takeMeaningInterpreterShadowPending(args.messageSid);
  const job = await loadJob(args.messageSid);
  if (!job?.clerk_user_id) return;

  const lastError = args.lastError ?? job.last_error ?? null;
  const lastErrorTag = parseMeaningInterpreterLastErrorTag(lastError);
  const base: MeaningInterpreterShadowFinalizeInput =
    taken ??
    buildMeaningInterpreterShadowFinalizeFromSchedule({
      clerkUserId: job.clerk_user_id,
      inboundMessageSid: args.messageSid,
      coachJobMessageSid: args.messageSid,
      rawBody: job.raw_body ?? "",
      outcomeSent: args.jobStatus === "sent" && Boolean(job.sent_at ?? job.outbound_message_sid),
      jobStatus: args.jobStatus,
      lastError,
      deterministicRoute: MEANING_INTERPRETER_ROUTES.suppressed_no_send,
      deterministicFacts: buildSkippedMeaningShadowFacts({
        skipReason: lastErrorTag ?? "terminal_no_pending",
        jobFinalStatus: args.jobStatus,
        lastErrorTag,
      }),
    });

  await finalizeMeaningInterpreterShadowForInboundJob({
    ...base,
    jobStatus: args.jobStatus,
    lastError,
    outcomeSent: args.jobStatus === "sent" && Boolean(job.sent_at ?? job.outbound_message_sid),
  });
}

async function markJobFinal(args: {
  messageSid: string;
  status: string;
  lastError?: string | null;
  attemptCount?: number;
  nextRetry?: string;
}) {
  const patch: Record<string, unknown> = {
    status: args.status,
    updated_at: new Date().toISOString(),
  };
  if (args.lastError !== undefined) {
    patch.last_error = args.lastError;
  }
  if (args.nextRetry !== undefined) {
    patch.next_retry_at = args.nextRetry;
  }
  if (typeof args.attemptCount === "number") {
    patch.attempt_count = args.attemptCount;
  }

  await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update(patch)
    .eq("message_sid", args.messageSid);

  await finalizeMeaningShadowAfterJobTerminal({
    messageSid: args.messageSid,
    jobStatus: args.status,
    lastError: args.lastError ?? null,
  });
}

function finalVoiceSkipLastError(
  voice: VoiceOwnershipResult,
  extras?: Record<string, unknown> | null
): string {
  try {
    return JSON.stringify({
      tag: "final_voice_gate_no_send",
      final_voice_gate: voice.metadata,
      skip_reason: voice.skipReason ?? null,
      blocked_reasons: voice.blockedReasons,
      ...(extras ?? {}),
    }).slice(0, 1900);
  } catch {
    return "final_voice_gate_no_send";
  }
}

async function repairOutboundSidWithoutSentAt(): Promise<number> {
  const { data: rows, error } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("message_sid")
    .not("outbound_message_sid", "is", null)
    .is("sent_at", null)
    .limit(25);

  if (error || !rows?.length) return 0;

  let n = 0;
  for (const r of rows) {
    const { error: upErr } = await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("message_sid", r.message_sid);
    if (!upErr) n += 1;
  }
  if (n > 0) {
    console.log("[sms-inbound-coach] repaired partial send finalization", { count: n });
  }
  return n;
}

async function reclaimStaleJobs(nowIso: string): Promise<void> {
  const staleCutoff = new Date(
    Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000
  ).toISOString();

  const { error: e1 } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "failed",
      last_error: "stale_processing_reclaimed",
      next_retry_at: nowIso,
      updated_at: nowIso,
    })
    .eq("status", "processing")
    .is("sent_at", null)
    .is("outbound_message_sid", null)
    .lt("updated_at", staleCutoff);

  if (e1) {
    console.error("[sms-inbound-coach] stale processing reclaim error", e1);
  }

  const { error: e2 } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "needs_manual_review",
      last_error:
        "stale_generating_reply: coach step did not persist reply_body; operator verify coach_conversations / may reset to pending after fix",
      next_retry_at: farFutureIso(),
      updated_at: nowIso,
    })
    .eq("status", "generating_reply")
    .is("reply_body", null)
    .lt("updated_at", staleCutoff);

  if (e2) {
    console.error("[sms-inbound-coach] stale generating_reply reclaim error", e2);
  }

  const { error: e3 } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "needs_manual_review",
      last_error:
        "stale_sending_no_outbound_sid: possible Twilio delivery unknown; operator verify before resetting",
      next_retry_at: farFutureIso(),
      updated_at: nowIso,
    })
    .eq("status", "sending")
    .is("outbound_message_sid", null)
    .is("sent_at", null)
    .lt("updated_at", staleCutoff);

  if (e3) {
    console.error("[sms-inbound-coach] stale sending reclaim error", e3);
  }
}

async function loadJob(messageSid: string): Promise<JobRow | null> {
  const { data } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("*")
    .eq("message_sid", messageSid)
    .maybeSingle();
  return data as JobRow | null;
}

/** M2B-3: durable inbound projection — best-effort; never fails the coach reply path. */
async function persistInboundSmsThreadMemoryProjectionBestEffort(args: {
  commitmentId: string;
  clerkUserId: string;
  inboundBody: string;
  messageSid: string;
  classification?: string | null;
  routePurpose?: string | null;
}): Promise<void> {
  const body = args.inboundBody.trim();
  if (!body || isLikelySmsComplianceOrOptOutTurn(body)) return;

  const result = await upsertCommitmentSmsThreadMemoryFromInbound({
    commitmentId: args.commitmentId,
    clerkUserId: args.clerkUserId,
    inboundBody: body,
    inboundAt: new Date(),
    messageSid: args.messageSid,
    classification: args.classification ?? null,
    routePurpose: args.routePurpose ?? null,
  });

  if (!result.ok) {
    console.warn("[sms-inbound-coach] v2_sms_thread_memory_inbound_upsert_failed", {
      commitment_id: args.commitmentId,
      message_sid: args.messageSid,
      route_purpose: args.routePurpose ?? null,
      classification: args.classification ?? null,
      error: result.error,
    });
  }
}

type InboundOutcomePersistOrchestrationArgs = {
  branch: InboundOutcomePersistBranch;
  laneExclusion?: InboundOutcomePersistLaneExclusion;
  job: JobRow;
  userId: string;
  commitment: ActiveV2CommitmentRow;
  userMessage: string;
  eventType: V2InboundEventType;
  normalizedHint: string | null;
  gatedDecision: V2InboundGatedDecision;
  recentEvents: Awaited<ReturnType<typeof getRecentV2EventsForAi>>;
  effectiveBehavior: string;
  proofMeta?: ReturnType<typeof buildProofMomentForAccountabilityOutcome> | null;
  payloadJson?: Record<string, unknown>;
  throwOnPersistError?: boolean;
};

async function tryPersistInboundAccountabilityOutcomeBeforeSend(
  args: InboundOutcomePersistOrchestrationArgs
): Promise<InboundOutcomePersistResult> {
  const laneExclusion =
    args.laneExclusion ?? laneExclusionFromGatedMode(args.gatedDecision.mode);

  const activeReplyContext = buildV2ActiveReplyContext({
    inboundText: args.userMessage,
    eventsNewestFirst: args.recentEvents,
    commitmentTitle: args.commitment.title,
    behaviorStatement: args.commitment.behavior_statement,
    effectiveAsk: args.effectiveBehavior,
  });

  const inboundMeaning = buildInboundMeaningFacts({
    rawInbound: args.userMessage,
    classifierEventType: args.eventType,
    classifierNormalizedHint: args.normalizedHint,
  });

  const should = shouldPersistInboundAccountabilityOutcome({
    messageSid: args.job.message_sid,
    commitmentId: args.commitment.id,
    rawBody: args.userMessage,
    classifierEventType: args.eventType,
    classifierNormalizedHint: args.normalizedHint,
    gatedDecision: args.gatedDecision,
    laneExclusion,
    activeReplyContext,
    inboundMeaning,
  });

  logInboundOutcomePersistAttempt({
    messageSid: args.job.message_sid,
    commitmentId: args.commitment.id,
    branch: args.branch,
    classifierEventType: args.eventType,
    classifierNormalizedHint: args.normalizedHint,
    gatedDecision: args.gatedDecision,
    liveAccountabilityPromptDetected: activeReplyContext.has_live_accountability_prompt,
    result: should,
  });

  if (!should.persist) {
    return { status: "skipped", skipReason: should.skipReason };
  }

  const finalOutcomeType = should.resolvedEventType;
  const proofMeta =
    args.proofMeta ??
    buildProofMomentForAccountabilityOutcome({
      finalEventType: finalOutcomeType,
      eventsNewestFirst: args.recentEvents,
      isRepairOutcome: false,
      userMessageCharCount: args.userMessage.length,
    });

  const idempotencyKey = v2UserReplyIdempotencyKey(finalOutcomeType, args.job.message_sid);

  const result = await persistInboundAccountabilityOutcomeEvent({
    commitmentId: args.commitment.id,
    clerkUserId: args.userId,
    messageSid: args.job.message_sid,
    rawBody: args.userMessage,
    eventType: finalOutcomeType,
    branch: args.branch,
    classifierEventType: args.eventType,
    classifierNormalizedHint: args.normalizedHint,
    gatedDecision: args.gatedDecision,
    liveAccountabilityPromptDetected: should.liveAccountabilityPromptDetected,
    overrideGatedNoWrite: should.overrideGatedNoWrite,
    proofMeta,
    payloadJson: {
      ...(args.payloadJson ?? {}),
      ...inboundMeaningPayloadForOutcomePersist(inboundMeaning),
    },
    idempotencyKey,
  });

  logInboundOutcomePersistAttempt({
    messageSid: args.job.message_sid,
    commitmentId: args.commitment.id,
    branch: args.branch,
    classifierEventType: args.eventType,
    classifierNormalizedHint: args.normalizedHint,
    gatedDecision: args.gatedDecision,
    resolvedEventType: finalOutcomeType,
    liveAccountabilityPromptDetected: should.liveAccountabilityPromptDetected,
    result,
    idempotencyKey,
  });

  if (result.status === "error" && args.throwOnPersistError) {
    throw new Error(`v2_commitment_event_insert_failed: ${result.message}`);
  }

  return result;
}

async function processV2NormalInboundOutcome(
  job: JobRow,
  userId: string,
  commitment: ActiveV2CommitmentRow,
  classification: ReturnType<typeof classifyV2InboundReply>,
  timezone: string,
  splitSuppressedMessageSids: string[] = [],
  commsPrefsTurn: InboundSmsCommsPreferenceTurnSnapshot | null = null
): Promise<void> {
  // 1) Classification is rule-based at call sites; event_type is server-controlled here.
  const { eventType, normalizedHint } = classification;
  const effectiveBehavior = getEffectiveCoachingAsk(commitment);
  const userMessage = (job.raw_body || "").trim();
  const plannedInterruptionDetection = detectSmsPlannedInterruption(userMessage);
  const plannedInterruptionActionable = isPlannedInterruptionActionable(plannedInterruptionDetection);

  const relationshipExitDetection = detectSmsRelationshipExitIntent(userMessage);
  const deferRelationshipExitToGoalHandoff = shouldDeferRelationshipExitToGoalHandoff({
    detection: relationshipExitDetection,
    commitmentChangeIntentLikely: isLikelyCommitmentChangeIntentTurn(userMessage),
    plannedInterruptionActionable,
  });
  const relationshipExitLaneActiveEarly = isRelationshipExitLaneActive({
    detection: relationshipExitDetection,
    deferToGoalHandoff: deferRelationshipExitToGoalHandoff,
  });
  const identityEditDetection = detectSmsIdentityEditIntent(userMessage);
  const identityEditLaneActiveEarly = isIdentityEditLaneActive({
    detection: identityEditDetection,
    relationshipExitLaneActive: relationshipExitLaneActiveEarly,
  });
  const inboundThreadRoutePurpose: InboundV3RoutePurpose = relationshipExitLaneActiveEarly
    ? "relationship_exit_integrity"
    : identityEditLaneActiveEarly
      ? "identity_edit_integrity"
      : "normal_inbound_reply";

  await persistInboundSmsThreadMemoryProjectionBestEffort({
    commitmentId: commitment.id,
    clerkUserId: userId,
    inboundBody: userMessage,
    messageSid: job.message_sid,
    classification: eventType,
    routePurpose: inboundThreadRoutePurpose,
  });

  const recentEvents = await getRecentV2EventsForAi(commitment.id);
  const inboundRelationshipMemoryPacket = slimMemoryPacketForFacts(
    await buildSmsRelationshipMemoryPacket({
      clerkUserId: userId,
      commitmentId: commitment.id,
      timezone,
    })
  );

  let victoryBackgroundFacts: V3VictoryBackgroundFacts | null = null;
  try {
    victoryBackgroundFacts = mapSmsVictoryBackgroundToFacts(
      await loadSmsVictoryBackgroundContext({
        clerkUserId: userId,
        commitmentId: commitment.id,
        timezone,
      })
    );
  } catch (e) {
    console.warn("[sms-inbound-coach] victory_background_load_failed", {
      clerk_user_id: userId,
      commitment_id: commitment.id,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const brokePause = commitment.accountability_phase === "low_pressure_reactivation";
  if (brokePause && !plannedInterruptionActionable) {
    await exitLowPressureReactivationOnInbound(commitment.id);
    await recomputeV2CoachingMemory(commitment.id, {
      reasonCode: "inbound_exit_reactivation_before_outcome",
    });
  }

  const { data: inboundProfileRow } = await supabaseServer
    .from("user_profiles")
    .select(
      "preferred_name, people_summary, responsibility, identity_anchor_text, identity_source, identity_refresh_due_at, identity_last_referenced_at"
    )
    .eq("clerk_user_id", userId)
    .maybeSingle();

  const preferredName =
    typeof inboundProfileRow?.preferred_name === "string"
      ? inboundProfileRow.preferred_name
      : null;
  const peopleSummary =
    typeof inboundProfileRow?.people_summary === "string" && inboundProfileRow.people_summary.trim()
      ? inboundProfileRow.people_summary.trim()
      : null;
  const responsibility =
    typeof inboundProfileRow?.responsibility === "string" && inboundProfileRow.responsibility.trim()
      ? inboundProfileRow.responsibility.trim()
      : null;
  const identityAnchorText =
    typeof inboundProfileRow?.identity_anchor_text === "string"
      ? inboundProfileRow.identity_anchor_text.trim()
      : null;
  const identityRefreshDue = isIdentityRefreshDue(
    typeof inboundProfileRow?.identity_refresh_due_at === "string"
      ? inboundProfileRow.identity_refresh_due_at
      : null,
    Date.now()
  );
  const identityReferenceAllowed = computeIdentityReferenceAllowedInbound({
    nowMs: Date.now(),
    identityAnchorText: inboundProfileRow?.identity_anchor_text,
    identitySource:
      typeof inboundProfileRow?.identity_source === "string"
        ? inboundProfileRow.identity_source
        : null,
    identityRefreshDueAt:
      typeof inboundProfileRow?.identity_refresh_due_at === "string"
        ? inboundProfileRow.identity_refresh_due_at
        : null,
    identityLastReferencedAt:
      typeof inboundProfileRow?.identity_last_referenced_at === "string"
        ? inboundProfileRow.identity_last_referenced_at
        : null,
    accountabilityPhase: commitment.accountability_phase,
    refreshSessionActive: isRefreshSessionActive(commitment),
    brokePause,
  });

  const silenceCtx = deriveV2SilenceContext(recentEvents, new Date());
  const afterSilence = silenceCtx.tier !== "none";
  const lastOutboundNextMove = parseLatestCheckSentNextMoveType(recentEvents);

  const coachingMemoryRow = await loadV2CoachingMemoryForPrompt(commitment.id);
  const pendingAwaitingMemoryConfirmation = await fetchLatestAwaitingMemoryConfirmation(commitment.id);

  let smsConvPackBlock: string | null = null;
  let smsConvPackMeta: V2SmsConversationContextPack["meta"] | null = null;
  let convPackFull: V2SmsConversationContextPack | null = null;
  try {
    const convPack = await buildV2SmsConversationContextPack({
      clerkUserId: userId,
      commitmentId: commitment.id,
      commitment,
      timezone,
      currentInboundText: userMessage,
      preloadedCoachingMemory: coachingMemoryRow,
      preloadedEventsNewestFirst: recentEvents,
    });
    convPackFull = convPack;
    smsConvPackBlock = convPack.promptBlock;
    smsConvPackMeta = convPack.meta;
  } catch (e) {
    console.warn("[sms-inbound-coach] sms_conversation_context_pack_failed", {
      commitment_id: commitment.id,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const adaptiveProposalPending = isV2PendingProposalValid(commitment);
  const latestCheckEv = recentEvents.find((e) => e.event_type === "check_sent");
  const checkPayload = latestCheckEv?.payload_json ?? {};
  const lastOutboundSmsPreview =
    typeof checkPayload.body_preview === "string" && checkPayload.body_preview.trim().length > 0
      ? checkPayload.body_preview.trim().slice(0, 260)
      : null;

  const blockerEv = recentEvents.find((e) => e.event_type === "blocker_captured");
  const blockerPayload = blockerEv?.payload_json;
  const latestBlockerPreview =
    blockerPayload &&
    typeof blockerPayload.message === "string" &&
    blockerPayload.message.trim().length > 0
      ? blockerPayload.message.trim().slice(0, 140)
      : null;

  if (
    !isLikelySmsComplianceOrOptOutTurn(userMessage) &&
    !isLikelyCommitmentChangeIntentTurn(userMessage)
  ) {
    const priorYesToday = recentEventsIncludeUserYesOnLocalDay(
      recentEvents,
      timezone,
      getDateKeyInTimezone(new Date(), timezone)
    );

    const minimalLinesEarly = buildMinimalInboundTranscriptLines(
      convPackFull,
      userMessage,
      lastOutboundSmsPreview
    );

    const northStarPktEarly = buildInboundNorthStarContextPacket({
      commitmentId: commitment.id,
      behaviorStatement: commitment.behavior_statement ?? "",
      effectiveAskText: effectiveBehavior,
      timezone,
      userMessage,
      lastOutboundSmsPreview,
      checkPayload: (checkPayload ?? {}) as Record<string, unknown>,
      recentEvents,
      convPack: convPackFull,
      coachingMemory: coachingMemoryRow,
      finalEventType: null,
      lifeDesires: null,
      peopleSummary,
      identityAnchorText,
      latestBlockerPreview,
    });

    const openQuestionAuthority = mergeInboundOpenQuestionAuthority({
      northStarLatestOpenQuestion: northStarPktEarly.latestOpenQuestion ?? null,
      northStarExpectedSemantics: northStarPktEarly.expectedReplySemantics as ExpectedReplySemanticsV3,
      threadLatestOpenQuestion: inboundRelationshipMemoryPacket.latest_open_question,
      threadOpenQuestionPending: inboundRelationshipMemoryPacket.open_question_pending,
      threadOpenQuestionExpectedAnswerType:
        inboundRelationshipMemoryPacket.open_question_expected_answer_type,
    });
    const northStarPktOpenQuestion = {
      ...northStarPktEarly,
      latestOpenQuestion: openQuestionAuthority.latestOpenQuestion,
      expectedReplySemantics: openQuestionAuthority.expectedReplySemantics,
    };

    const v3Resolution = tryResolveAnswerToOpenQuestionTurn({
      inboundRaw: userMessage,
      latestOpenQuestion: northStarPktOpenQuestion.latestOpenQuestion ?? null,
      expectedReplySemantics: northStarPktOpenQuestion.expectedReplySemantics as ExpectedReplySemanticsV3,
      recentTranscriptLines: minimalLinesEarly,
      todayCompleted: priorYesToday,
      effectiveAsk: effectiveBehavior,
      behaviorStatement: commitment.behavior_statement ?? "",
    });

    if (!v3Resolution && northStarPktOpenQuestion.latestOpenQuestion?.trim()) {
      registerInboundMeaningShadowPending({
        job,
        userId,
        rawBody: userMessage,
        schedule: buildNormalLaneMeaningShadow({
          commitmentId: commitment.id,
          route: MEANING_INTERPRETER_ROUTES.normal_accountability,
          classifierEventType: eventType,
          classifierNormalizedHint: normalizedHint,
          openQuestionText: northStarPktOpenQuestion.latestOpenQuestion.trim(),
          pendingResolutionKind: commitment.pending_resolution_kind,
          lastOutboundPreview: lastOutboundSmsPreview,
          behaviorStatement: commitment.behavior_statement ?? null,
        }),
        extraFacts: buildEnrichedMeaningShadowFacts({
          openQuestionText: northStarPktOpenQuestion.latestOpenQuestion.trim(),
          expectedReplySemantics:
            typeof northStarPktOpenQuestion.expectedReplySemantics === "string"
              ? northStarPktOpenQuestion.expectedReplySemantics
              : null,
          openQuestionPending: inboundRelationshipMemoryPacket.open_question_pending,
          openQuestionRoutingMiss: true,
          recentTranscriptPreview: minimalLinesEarly.slice(-4).join(" | ").slice(0, 280),
          lastOutboundPreview: lastOutboundSmsPreview,
          lastOutboundFullBodyPreview: northStarPktOpenQuestion.latestOutboundBody?.slice(0, 280) ?? null,
          effectiveAskPreview: effectiveBehavior,
          behaviorStatement: commitment.behavior_statement ?? null,
          gatedOutcome: eventType,
        }),
      });
    }

    if (v3Resolution) {
      await persistInboundSmsThreadMemoryProjectionBestEffort({
        commitmentId: commitment.id,
        clerkUserId: userId,
        inboundBody: userMessage,
        messageSid: job.message_sid,
        classification: eventType,
        routePurpose: "open_question_answer",
      });

      const learningOpen = deriveV3LearningSignalsFromContext({
        recentEventsNewestFirst: recentEvents,
        coachingMemory: coachingMemoryRow,
        latestInbound: userMessage,
      });
      const openBrain = buildAnswerToOpenQuestionV3BrainPackage({
        resolution: v3Resolution,
        learning: learningOpen,
        latestOpenQuestion: northStarPktOpenQuestion.latestOpenQuestion ?? null,
        expectedSemantics:
          typeof northStarPktOpenQuestion.expectedReplySemantics === "string"
            ? northStarPktOpenQuestion.expectedReplySemantics
            : String(northStarPktOpenQuestion.expectedReplySemantics ?? ""),
      });

      /** Legacy writer — facts / preview only; never used as final visible SMS body. */
      const openDraftLegacy = await tryGenerateV3OpenQuestionCoachReply({
        resolution: v3Resolution,
        inboundRaw: userMessage,
        messageSid: job.message_sid,
        todayCompleted: priorYesToday,
        effectiveAsk: effectiveBehavior,
        behaviorStatement: commitment.behavior_statement ?? "",
        northStarPacket: northStarPktOpenQuestion,
        coachingMemory: coachingMemoryRow,
        latestOpenQuestion: northStarPktOpenQuestion.latestOpenQuestion ?? null,
        expectedReplySemantics: northStarPktOpenQuestion.expectedReplySemantics as ExpectedReplySemanticsV3,
        learningSignal: learningOpen,
      });

      const openBrainWithSource: V3SmsBrainResult = {
        ...openBrain,
        metadata: {
          ...openBrain.metadata,
          open_question_reply_source: openDraftLegacy.openQuestionReplySource,
          deterministic_fallback_reason: openDraftLegacy.deterministicFallbackReason ?? null,
          deterministic_fallback_used: openDraftLegacy.openQuestionReplySource === "deterministic_fallback",
        },
      };

      const expectedSemanticsStr =
        typeof northStarPktOpenQuestion.expectedReplySemantics === "string"
          ? northStarPktOpenQuestion.expectedReplySemantics
          : String(northStarPktOpenQuestion.expectedReplySemantics ?? "unknown");

      const openQuestionFactsPayload: InboundV3OpenQuestionFacts = {
        latest_open_question: northStarPktOpenQuestion.latestOpenQuestion ?? null,
        expected_reply_semantics: expectedSemanticsStr,
        resolution_subkind: v3Resolution.subkind,
        extracted_answer: v3Resolution.extractedAnswer ?? null,
        answer_kind: v3Resolution.subkind,
        old_open_question_reply_preview: openDraftLegacy.text.trim().slice(0, 500),
        deterministic_fallback_used: openDraftLegacy.openQuestionReplySource === "deterministic_fallback",
        deterministic_fallback_reason: openDraftLegacy.deterministicFallbackReason ?? null,
        legacy_open_question_reply_source: openDraftLegacy.openQuestionReplySource,
        latest_outbound_preview: lastOutboundSmsPreview,
      };

      const forcedCoachSmsOq =
        convPackFull &&
        !isLikelySmsComplianceOrOptOutTurn(userMessage) &&
        !isLikelyCommitmentChangeIntentTurn(userMessage) &&
        !adaptiveProposalPending
          ? tryBuildForcedInboundCoachSms({
              userMessage,
              gatedDecision: V3_REFINE_ONLY_GATED,
              lastOutboundSmsPreview,
              eventsNewestFirst: recentEvents,
              effectiveAskFloor: effectiveBehavior,
              messageSid: job.message_sid,
            })
          : null;

      const relationshipToneOq =
        coachingMemoryRow?.sms_relationship_profile != null
          ? JSON.stringify(coachingMemoryRow.sms_relationship_profile).slice(0, 240)
          : null;

      const conversationBrainFactsOq: InboundV3ConversationBrainFacts = { enabled: false };
      const centralBrainFactsOq: InboundV3CentralBrainFacts = { shadow_stored: false };
      const arcFactsOq: InboundV3ArcFacts = {
        ambiguous_short_reply: false,
        clarification_required: false,
      };

      const openQuestionMemoryPacket = slimMemoryPacketForFacts(
        await buildSmsRelationshipMemoryPacket({
          clerkUserId: userId,
          commitmentId: commitment.id,
          timezone,
        })
      );

      const oqInboundFacts = buildInboundV3RelationshipFacts({
        clerkUserId: userId,
        preferredName,
        timezone,
        localTimeIso: new Date(new Date().toLocaleString("en-US", { timeZone: timezone })).toISOString(),
        commitment,
        effectiveAsk: effectiveBehavior,
        userMessageRaw: userMessage,
        coalescedInboundText: userMessage,
        suppressedMessageSids: splitSuppressedMessageSids,
        transcriptLines: minimalLinesEarly,
        northStarPacket: northStarPktOpenQuestion,
        gatedDecision: V3_REFINE_ONLY_GATED,
        deterministicEventType: eventType,
        doNotRepeatHints: deriveDoNotRepeatHintsFromCoachingMemory(coachingMemoryRow),
        relationshipProfileSummary: relationshipToneOq,
        conversationBrain: conversationBrainFactsOq,
        centralBrain: centralBrainFactsOq,
        arc: arcFactsOq,
        phase5a: {
          central_tether_brain_enabled: shouldRunPhase5aCentralTetherBrain(),
          arc_clarify_brain_enabled: shouldRunPhase5aArcClarifyBrain(),
          inbound_stitched_final_enabled: shouldRunPhase5aInboundStitchedFinalBrain(),
        },
        forcedFutureStretchIntentActive: Boolean(forcedCoachSmsOq),
        wave11MemoryConfirmationPending: pendingAwaitingMemoryConfirmation != null,
        accountabilityProofHint: null,
        rejectedTimeCandidates: [],
        unavailableWindows: [],
        routePurpose: "open_question_answer",
        branchName: "open_question_answer",
        branchMigratedToLane: true,
        openQuestionFacts: openQuestionFactsPayload,
        victoryBackground: victoryBackgroundFacts,
        relationshipMemoryPacket: openQuestionMemoryPacket,
      });

      const openLaneRes = await produceInboundV3RelationshipSms({
        facts: oqInboundFacts,
        telemetry_fact_sources: [
          "classifyV2InboundReply",
          "buildInboundNorthStarContextPacket",
          "buildMinimalInboundTranscriptLines",
          "tryResolveAnswerToOpenQuestionTurn",
          "deriveV3LearningSignalsFromContext",
          "buildAnswerToOpenQuestionV3BrainPackage",
          "tryGenerateV3OpenQuestionCoachReply_legacy_preview_only",
        ],
      });

      if (!openLaneRes.shouldSend || !openLaneRes.body.trim()) {
        registerInboundMeaningShadowPending({
          job,
          userId,
          rawBody: userMessage,
          schedule: buildOpenQuestionMeaningShadow({
            commitmentId: commitment.id,
            classifierEventType: eventType,
            classifierNormalizedHint: normalizedHint,
            openQuestionText: northStarPktOpenQuestion.latestOpenQuestion?.trim() || null,
            expectedReplySemantics:
              typeof northStarPktOpenQuestion.expectedReplySemantics === "string"
                ? northStarPktOpenQuestion.expectedReplySemantics
                : null,
            pendingResolutionKind: commitment.pending_resolution_kind,
            lastOutboundPreview: lastOutboundSmsPreview,
            behaviorStatement: commitment.behavior_statement ?? null,
          }),
          extraFacts: buildEnrichedMeaningShadowFacts({
            openQuestionText: northStarPktOpenQuestion.latestOpenQuestion?.trim() || null,
            expectedReplySemantics:
              typeof northStarPktOpenQuestion.expectedReplySemantics === "string"
                ? northStarPktOpenQuestion.expectedReplySemantics
                : null,
            openQuestionPending: inboundRelationshipMemoryPacket.open_question_pending,
            openQuestionRoutingMiss: true,
            lastOutboundPreview: lastOutboundSmsPreview,
            lastOutboundFullBodyPreview: northStarPktOpenQuestion.latestOutboundBody?.slice(0, 280) ?? null,
            v3NoSendReason: openLaneRes.noSendReason ?? null,
            routePurpose: "open_question_answer",
            branchName: "open_question_answer",
            recentTranscriptPreview: minimalLinesEarly.slice(-4).join(" | ").slice(0, 280),
          }),
        });
        await markJobFinal({
          messageSid: job.message_sid,
          status: "cancelled",
          lastError: formatInboundV3LaneNoSendLastError(openLaneRes, {
            route_purpose: "open_question_answer",
            branch_name: "open_question_answer",
            branch_migrated_to_lane: true,
          }),
          nextRetry: farFutureIso(),
        });
        console.warn("[sms-inbound-coach] open_question_inbound_relationship_lane_no_send", {
          message_sid: job.message_sid,
          commitment_id: commitment.id,
          reason: openLaneRes.noSendReason,
        });
        return;
      }

      const contextPacketV3: NorthStarSmsContextPacket = {
        ...northStarPktOpenQuestion,
        v3AnswerToOpenQuestion: true,
        v3TurnSubkind: v3Resolution.subkind,
        debug: {
          ...(northStarPktOpenQuestion.debug ?? {}),
          v3_turn_purpose: "answer_to_open_question",
          v3_turn_subkind: v3Resolution.subkind,
          answered_open_question: true,
          extracted_open_question_answer: v3Resolution.extractedAnswer,
          v3_brain: {
            ...buildV3BrainMetadata({
              brain: openBrainWithSource,
              latestOpenQuestion: northStarPktOpenQuestion.latestOpenQuestion ?? null,
              expectedSemantics:
                typeof northStarPktOpenQuestion.expectedReplySemantics === "string"
                  ? northStarPktOpenQuestion.expectedReplySemantics
                  : null,
              coachReplySource: "v3_inbound_relationship_lane",
            }),
            coaching_brief_v1: compactCoachingBriefV1ForV3Brain(
              buildCoachingBriefV1FromInboundFacts(oqInboundFacts)
            ),
          },
        },
      };

      const oqV3BrainMetadata: Record<string, unknown> = {
        ...openLaneRes.metadata,
        inbound_v3_relationship_lane: true,
        v3_lane_turn_purpose: openLaneRes.turnPurpose,
        route_purpose: "open_question_answer",
        branch_migrated_to_lane: true,
        branch_name: "open_question_answer",
        v3_candidate_body: openLaneRes.body,
        open_question_facts_summary: slimOpenQuestionFactsForTelemetry(openQuestionFactsPayload),
        v3_open_question_resolution_subkind: v3Resolution.subkind,
        legacy_try_generate_open_question_meta: {
          open_question_reply_source: openDraftLegacy.openQuestionReplySource,
          deterministic_fallback_reason: openDraftLegacy.deterministicFallbackReason ?? null,
        },
      };

      const openVoicePack = await northStarGatePersistBodyAsync(openLaneRes.body, {
        job,
        channel: "inbound_coach_reply",
        lastOutboundBody: contextPacketV3.latestOutboundBody ?? lastOutboundSmsPreview,
        effectiveAsk: effectiveBehavior,
        behaviorStatement: commitment.behavior_statement,
        finalEventType: null,
        replySource: "v3_inbound_relationship_lane",
        contextPacket: contextPacketV3,
        activeCommitmentId: commitment.id,
        normalCoaching: true,
        v3BrainMetadata: oqV3BrainMetadata,
      });

      if (!openVoicePack.voice.shouldSend) {
        await markJobFinal({
          messageSid: job.message_sid,
          status: "cancelled",
          lastError: finalVoiceSkipLastError(openVoicePack.voice, {
            route_purpose: "open_question_answer",
            branch_name: "open_question_answer",
            branch_migrated_to_lane: true,
            v3_lane_reply_source: "v3_inbound_relationship_lane",
            v3_candidate_body: openLaneRes.body.slice(0, 500),
            lane_metadata: openLaneRes.metadata,
            north_star_gate: {
              original_body: openVoicePack.northStarMeta.originalBody,
              final_body: openVoicePack.northStarVisibleBody,
              north_star_gate_source: openVoicePack.northStarMeta.source,
              north_star_gate_reasons: openVoicePack.northStarMeta.blockedReasons,
              ...pickNorthStarWriterAttributionFields(openVoicePack.northStarMeta),
            },
            final_voice_gate: openVoicePack.voice.metadata,
            should_send: false,
          }),
          nextRetry: farFutureIso(),
        });
        console.warn("[sms-inbound-coach] v3_open_question_final_voice_suppressed", {
          message_sid: job.message_sid,
        });
        return;
      }

      const gatedOqBody = openVoicePack.voice.body;
      const nowV3 = new Date().toISOString();
      const { data: persistedV3 } = await supabaseServer
        .from("sms_inbound_coach_jobs")
        .update({
          reply_body: gatedOqBody,
          status: "reply_ready",
          next_retry_at: nowV3,
          updated_at: nowV3,
          last_error: null,
        })
        .eq("message_sid", job.message_sid)
        .eq("status", "processing")
        .select()
        .maybeSingle();

      const openQuestionThreadMemoryCtx = {
        commitmentId: commitment.id,
        expectedAnswerType:
          typeof northStarPktOpenQuestion.expectedReplySemantics === "string"
            ? northStarPktOpenQuestion.expectedReplySemantics
            : null,
        meaningShadow: buildOpenQuestionMeaningShadow({
          commitmentId: commitment.id,
          classifierEventType: eventType,
          classifierNormalizedHint: normalizedHint,
          openQuestionText: northStarPktOpenQuestion.latestOpenQuestion?.trim() || null,
          expectedReplySemantics:
            typeof northStarPktOpenQuestion.expectedReplySemantics === "string"
              ? northStarPktOpenQuestion.expectedReplySemantics
              : null,
          pendingResolutionKind: commitment.pending_resolution_kind,
          lastOutboundPreview: lastOutboundSmsPreview,
          behaviorStatement: commitment.behavior_statement ?? null,
        }),
      };

      if (!persistedV3) {
        const j3 = await loadJob(job.message_sid);
        if (j3?.reply_body?.trim()) {
          await tryPersistInboundAccountabilityOutcomeBeforeSend({
            branch: "open_question",
            job,
            userId,
            commitment,
            userMessage,
            eventType,
            normalizedHint,
            gatedDecision: V3_REFINE_ONLY_GATED,
            recentEvents,
            effectiveBehavior,
          });
          await commitAndSendInboundRelationshipCoachReply(j3, userId, openQuestionThreadMemoryCtx);
          return;
        }
        throw new Error("v3_open_question_reply_ready_persist_failed");
      }

      await tryPersistInboundAccountabilityOutcomeBeforeSend({
        branch: "open_question",
        job,
        userId,
        commitment,
        userMessage,
        eventType,
        normalizedHint,
        gatedDecision: V3_REFINE_ONLY_GATED,
        recentEvents,
        effectiveBehavior,
      });
      const freshV3 = (await loadJob(job.message_sid)) ?? job;
      await commitAndSendInboundRelationshipCoachReply(freshV3, userId, openQuestionThreadMemoryCtx);
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      console.info("[sms-inbound-coach] open_question_answer_lane_sent", {
        message_sid: job.message_sid,
        commitment_id: commitment.id,
        inbound_v3_lane_used: true,
        route_purpose: "open_question_answer",
        branch_migrated_to_lane: true,
        branch_name: "open_question_answer",
        v3_lane_reply_source: "v3_inbound_relationship_lane",
        v3_candidate_body: gatedOqBody.slice(0, 500),
        open_question_facts_summary: slimOpenQuestionFactsForTelemetry(openQuestionFactsPayload),
        coalesced_inbound_body: userMessage,
        suppressed_message_sids: splitSuppressedMessageSids,
        rejected_time_candidates: oqInboundFacts.thread.rejected_time_candidates,
        north_star_gate: {
          original_body: openVoicePack.northStarMeta.originalBody,
          final_body: openVoicePack.northStarVisibleBody,
          north_star_gate_source: openVoicePack.northStarMeta.source,
          north_star_gate_reasons: openVoicePack.northStarMeta.blockedReasons,
          ...pickNorthStarWriterAttributionFields(openVoicePack.northStarMeta),
        },
        final_voice_gate: openVoicePack.voice.metadata,
        should_send: true,
        twilio_send_attempted: true,
      });
      const nbLine =
        learningOpen.confidence != null && learningOpen.confidence >= 0.4
          ? buildV3LearningNotebookLine(learningOpen, userMessage)
          : null;
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "v3_answer_to_open_question",
        ...(nbLine ? { v3LearningNotebookAppend: nbLine } : {}),
      });
      return;
    }
  }

  const shadowRelParts = [peopleSummary, responsibility].filter(
    (x): x is string => typeof x === "string" && Boolean(x.trim())
  );
  const relationshipContextTruncated =
    shadowRelParts.length > 0
      ? shadowRelParts
          .map((x) => x.trim().replace(/\s+/g, " ").slice(0, 80))
          .join(" · ")
          .slice(0, 200)
      : null;

  let conversationBrainControlTurn: {
    proposal: SmsConversationBrainProposalV1;
    guard: GuardrailResult;
    model: string;
  } | null = null;

  const interpretationRequested = isV2InboundInterpretationRequested();
  const commitmentChangeIntentLikely = isLikelyCommitmentChangeIntentTurn(userMessage);
  const brainGateComplianceOrOptOut = isLikelySmsComplianceOrOptOutTurn(userMessage);
  const brainControlGate = shouldUseSmsConversationBrainControl({
    controlEnabled: isV2SmsConversationBrainControlEnabled(),
    allowlisted: isV2SmsConversationBrainAllowedForUser(userId),
    pendingResolutionActive: isSmsInboundPendingResolutionActionable(commitment),
    contractOverlayActive: adaptiveProposalPending,
    optOutOrComplianceTurn: brainGateComplianceOrOptOut,
    commitmentChangeIntentLikely,
  });

  if (
    isV2SmsConversationBrainControlEnabled() &&
    isV2SmsConversationBrainAllowedForUser(userId)
  ) {
    if (commitmentChangeIntentLikely) {
      console.info("[v2-sms-conversation-brain]", {
        reason_code: "brain_gate_skipped_commitment_change_intent",
        commitment_id: commitment.id,
        message_sid: job.message_sid,
      });
    } else if (brainGateComplianceOrOptOut) {
      console.info("[v2-sms-conversation-brain]", {
        reason_code: "brain_gate_skipped_compliance_or_opt_out",
        commitment_id: commitment.id,
        message_sid: job.message_sid,
      });
    }
  }

  if (brainControlGate) {
    let subscriptionOk = true;
    let smsEligible = true;
    try {
      const md = await getClerkPublicMetadata(userId);
      subscriptionOk = md.summittSubscribed === true;
      smsEligible = md.smsEnabled === true;
    } catch {
      subscriptionOk = false;
      smsEligible = false;
    }

    const brainTry = await proposeNormalAccountabilityTurnControl({
      commitmentTitle: commitment.title,
      behaviorStatement: commitment.behavior_statement,
      effectiveCoachingAsk: effectiveBehavior,
      latestUserSms: userMessage,
      lastCoachSmsExact: convPackFull?.lastOutboundPreview ?? lastOutboundSmsPreview,
      recentSmsTranscriptBlock: smsConvPackBlock,
      eventsNewestFirst: recentEvents,
      coachingMemory: coachingMemoryRow,
      identityAnchorPreview: identityAnchorText,
      liveAccountabilityPromptStatus: lastOutboundSmsPreview
        ? "last_outbound_check_preview_available"
        : null,
      blockerPendingSummary: isBlockerCapturePendingActive(commitment)
        ? `blocker_capture_active:after=${String(commitment.blocker_capture_after_event ?? "unknown")}`
        : null,
      deterministicClassifierEventType: eventType,
      deterministicClassifierNormalizedHint: normalizedHint ?? null,
    });

    if (brainTry.ok) {
      const gr = applySmsConversationBrainGuardrails(brainTry.proposal, {
        clerk_user_id: userId,
        commitment_id: commitment.id,
        message_sid: job.message_sid,
        subscription_ok: subscriptionOk,
        sms_eligible: smsEligible,
        has_active_commitment: true,
        pending_resolution_active: isSmsInboundPendingResolutionActionable(commitment),
        contract_overlay_active: adaptiveProposalPending,
        branch_owner: "normal_accountability",
        recent_clarification_count_heuristic: countRecentClarifyStyleHeuristic(recentEvents),
        opt_out_or_compliance_turn: brainGateComplianceOrOptOut,
        allowed_event_types: ["user_yes", "user_no", "user_partial"],
        confidence_floor: getConversationBrainConfidenceFloor(),
        max_clarify_per_window: 2,
      });

      const approvedOutcome =
        gr.status === "approved" &&
        gr.should_write_event &&
        gr.final_event_type != null &&
        typeof gr.final_sms_draft === "string" &&
        gr.final_sms_draft.trim().length > 0;

      if (approvedOutcome) {
        conversationBrainControlTurn = {
          proposal: brainTry.proposal,
          guard: gr,
          model: brainTry.model,
        };
        if (process.env.NODE_ENV === "production") {
          console.log("[v2-sms-conversation-brain] control_turn", {
            commitment_id: commitment.id,
            message_sid: job.message_sid,
            model: brainTry.model,
            guardrail_status: gr.status,
            guardrail_reason: gr.guardrail_reason,
            turn_kind: brainTry.proposal.turn_kind,
            short_log: brainTry.proposal.short_reason_for_logs,
          });
        } else {
          console.log("[v2-sms-conversation-brain] control_turn", {
            commitment_id: commitment.id,
            message_sid: job.message_sid,
            model: brainTry.model,
            guardrail_status: gr.status,
            reply_strategy: brainTry.proposal.reply_strategy,
          });
        }
      }
    }

    if (conversationBrainControlTurn == null && !isV2SmsConversationBrainLegacyFallbackEnabled()) {
      const gdFallback = defaultGatedDecision(eventType, "conversation_brain_legacy_fallback_disabled");
      const tmpl = buildV2InboundReplySms({
        behaviorStatement: effectiveBehavior,
        messageSid: job.message_sid,
        eventType: gdFallback.final_event_type ?? eventType,
        preferredName,
      });

      const finalFb = gdFallback.final_event_type ?? eventType;
      const accountabilityProofMomentFb =
        gdFallback.should_write_outcome_event &&
        (finalFb === "user_yes" || finalFb === "user_no" || finalFb === "user_partial")
          ? buildProofMomentForAccountabilityOutcome({
              finalEventType: finalFb,
              eventsNewestFirst: recentEvents,
              isRepairOutcome: false,
              userMessageCharCount: userMessage.length,
            })
          : null;

      const northStarPktCb = buildInboundNorthStarContextPacket({
        commitmentId: commitment.id,
        behaviorStatement: commitment.behavior_statement ?? "",
        effectiveAskText: effectiveBehavior,
        timezone,
        userMessage,
        lastOutboundSmsPreview,
        checkPayload: (checkPayload ?? {}) as Record<string, unknown>,
        recentEvents,
        convPack: convPackFull,
        coachingMemory: coachingMemoryRow,
        finalEventType: gdFallback.final_event_type ?? eventType,
        lifeDesires: null,
        peopleSummary,
        identityAnchorText,
        latestBlockerPreview,
        proofDisplayedOrMoment: Boolean(accountabilityProofMomentFb),
      });

      const minimalLinesCb = buildMinimalInboundTranscriptLines(
        convPackFull,
        userMessage,
        lastOutboundSmsPreview
      );

      const forcedCoachSmsCb =
        convPackFull &&
        !isLikelySmsComplianceOrOptOutTurn(userMessage) &&
        !isLikelyCommitmentChangeIntentTurn(userMessage) &&
        !adaptiveProposalPending
          ? tryBuildForcedInboundCoachSms({
              userMessage,
              gatedDecision: gdFallback,
              lastOutboundSmsPreview,
              eventsNewestFirst: recentEvents,
              effectiveAskFloor: effectiveBehavior,
              messageSid: job.message_sid,
            })
          : null;

      const relationshipToneCb =
        coachingMemoryRow?.sms_relationship_profile != null
          ? JSON.stringify(coachingMemoryRow.sms_relationship_profile).slice(0, 240)
          : null;

      const proofPromptHintFb = proofMomentToPromptHint(accountabilityProofMomentFb);

      const cbFallbackFacts = buildConversationBrainFallbackFacts({
        legacyFallbackReason: gdFallback.decision_reason,
        deterministicTemplateBody: tmpl.body,
        classifierResult: eventType,
        gatedEventType: gdFallback.final_event_type,
        shouldWriteOutcomeEvent: gdFallback.should_write_outcome_event,
        gatedMode: gdFallback.mode,
        commitment,
        effectiveAsk: effectiveBehavior,
        inboundMessageSid: job.message_sid,
      });

      const cbInboundFacts = buildInboundV3RelationshipFacts({
        clerkUserId: userId,
        preferredName,
        timezone,
        localTimeIso: new Date(new Date().toLocaleString("en-US", { timeZone: timezone })).toISOString(),
        commitment,
        effectiveAsk: effectiveBehavior,
        userMessageRaw: userMessage,
        coalescedInboundText: userMessage,
        suppressedMessageSids: splitSuppressedMessageSids,
        transcriptLines: minimalLinesCb,
        northStarPacket: northStarPktCb,
        gatedDecision: gdFallback,
        deterministicEventType: eventType,
        doNotRepeatHints: deriveDoNotRepeatHintsFromCoachingMemory(coachingMemoryRow),
        relationshipProfileSummary: relationshipToneCb,
        conversationBrain: { enabled: false },
        centralBrain: { shadow_stored: false },
        arc: { ambiguous_short_reply: false, clarification_required: false },
        phase5a: {
          central_tether_brain_enabled: shouldRunPhase5aCentralTetherBrain(),
          arc_clarify_brain_enabled: shouldRunPhase5aArcClarifyBrain(),
          inbound_stitched_final_enabled: shouldRunPhase5aInboundStitchedFinalBrain(),
        },
        forcedFutureStretchIntentActive: Boolean(forcedCoachSmsCb),
        wave11MemoryConfirmationPending: pendingAwaitingMemoryConfirmation != null,
        accountabilityProofHint: proofPromptHintFb != null ? JSON.stringify(proofPromptHintFb) : null,
        rejectedTimeCandidates: [],
        unavailableWindows: [],
        routePurpose: "conversation_brain_unavailable",
        branchName: "conversation_brain_legacy_disabled_lane",
        branchMigratedToLane: true,
        conversationBrainFallbackFacts: cbFallbackFacts,
        victoryBackground: victoryBackgroundFacts,
        relationshipMemoryPacket: inboundRelationshipMemoryPacket,
      });

      const cbLaneRes = await produceInboundV3RelationshipSms({
        facts: cbInboundFacts,
        telemetry_fact_sources: [
          "classifyV2InboundReply",
          "defaultGatedDecision_conversation_brain_legacy_fallback_disabled",
          "buildV2InboundReplySms_deterministic_template_preview_only",
          "buildInboundNorthStarContextPacket",
          "buildMinimalInboundTranscriptLines",
          "buildConversationBrainFallbackFacts",
          "buildInboundV3RelationshipFacts",
        ],
      });

      const cbSlimFactsSummary = slimConversationBrainFallbackFactsForTelemetry(cbFallbackFacts);

      const persistConversationBrainLegacyDisabledServerOutcome = async (
        aiMessage: string,
        fallbackReason: string,
        laneNoSendExtras?: Record<string, unknown> | null
      ) => {
        const legacyPersistResult = await tryPersistInboundAccountabilityOutcomeBeforeSend({
          branch: "conversation_brain_legacy_fallback",
          job,
          userId,
          commitment,
          userMessage,
          eventType,
          normalizedHint,
          gatedDecision: gdFallback,
          recentEvents,
          effectiveBehavior,
          payloadJson: {
            ai: {
              model: V2_INBOUND_AI_MODEL,
              prompt_version: V2_INBOUND_AI_PROMPT_VERSION,
              server_strategy: strategyForInboundEventType(gdFallback.final_event_type ?? eventType),
              message: aiMessage,
              confidence: null,
              fallback_used: true,
              fallback_reason: fallbackReason,
              ...(laneNoSendExtras ?? {}),
            },
            conversation_brain_v1: {
              enabled: false,
              legacy_fallback_disabled_deterministic: true,
            },
          },
          throwOnPersistError: gdFallback.should_write_outcome_event,
        });

        if (legacyPersistResult.status === "inserted") {
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
        }

        await recomputeV2CoachingMemory(commitment.id, {
          reasonCode: "inbound_user_outcome",
        });

        if (gdFallback.should_open_blocker_capture) {
          await setBlockerCapturePending(
            commitment.id,
            gdFallback.final_event_type as V2AccountabilityOutcome
          );
        }
      };

      if (!cbLaneRes.shouldSend || !cbLaneRes.body.trim()) {
        await persistConversationBrainLegacyDisabledServerOutcome(
          "",
          "conversation_brain_legacy_fallback_disabled_inbound_v3_lane_no_send",
          {
            inbound_v3_relationship_lane_no_send: {
              no_send_reason: cbLaneRes.noSendReason,
              lane_metadata_preview: JSON.stringify(cbLaneRes.metadata).slice(0, 900),
            },
          }
        );
        await markJobFinal({
          messageSid: job.message_sid,
          status: "cancelled",
          lastError: formatInboundV3LaneNoSendLastError(cbLaneRes, {
            route_purpose: "conversation_brain_unavailable",
            branch_name: "conversation_brain_legacy_disabled_lane",
            branch_migrated_to_lane: true,
            conversation_brain_fallback_facts_summary: cbSlimFactsSummary,
          }),
          nextRetry: farFutureIso(),
        });
        console.warn("[sms-inbound-coach] conversation_brain_legacy_disabled_lane_no_send", {
          message_sid: job.message_sid,
          commitment_id: commitment.id,
          reason: cbLaneRes.noSendReason,
        });
        return;
      }

      const cbV3BrainMetadata: Record<string, unknown> = {
        ...cbLaneRes.metadata,
        inbound_v3_relationship_lane: true,
        v3_lane_turn_purpose: cbLaneRes.turnPurpose,
        route_purpose: "conversation_brain_unavailable",
        branch_migrated_to_lane: true,
        branch_name: "conversation_brain_legacy_disabled_lane",
        conversation_brain_fallback_facts_summary: cbSlimFactsSummary,
        v3_candidate_body: cbLaneRes.body,
      };

      const cbVoicePack = await northStarGatePersistBodyAsync(cbLaneRes.body, {
        job,
        channel: "inbound_coach_reply",
        lastOutboundBody: lastOutboundSmsPreview,
        effectiveAsk: effectiveBehavior,
        behaviorStatement: commitment.behavior_statement,
        finalEventType: gdFallback.final_event_type ?? eventType,
        replySource: "v3_inbound_relationship_lane",
        contextPacket: northStarPktCb,
        activeCommitmentId: commitment.id,
        normalCoaching: true,
        v3BrainMetadata: cbV3BrainMetadata,
      });

      if (!cbVoicePack.voice.shouldSend) {
        await persistConversationBrainLegacyDisabledServerOutcome(
          "",
          "conversation_brain_legacy_fallback_disabled_final_voice_no_send",
          {
            final_voice_gate: cbVoicePack.voice.metadata,
          }
        );
        await markJobFinal({
          messageSid: job.message_sid,
          status: "cancelled",
          lastError: finalVoiceSkipLastError(cbVoicePack.voice, {
            route_purpose: "conversation_brain_unavailable",
            branch_name: "conversation_brain_legacy_disabled_lane",
            branch_migrated_to_lane: true,
            v3_lane_reply_source: "v3_inbound_relationship_lane",
            v3_candidate_body: cbLaneRes.body.slice(0, 500),
            lane_metadata: cbLaneRes.metadata,
            north_star_gate: {
              original_body: cbVoicePack.northStarMeta.originalBody,
              final_body: cbVoicePack.northStarVisibleBody,
              north_star_gate_source: cbVoicePack.northStarMeta.source,
              north_star_gate_reasons: cbVoicePack.northStarMeta.blockedReasons,
              ...pickNorthStarWriterAttributionFields(cbVoicePack.northStarMeta),
            },
            final_voice_gate: cbVoicePack.voice.metadata,
            should_send: false,
            conversation_brain_fallback_facts_summary: cbSlimFactsSummary,
          }),
          nextRetry: farFutureIso(),
        });
        console.warn("[sms-inbound-coach] legacy_fallback_final_voice_suppressed", {
          message_sid: job.message_sid,
          skip_reason: cbVoicePack.voice.skipReason ?? null,
        });
        return;
      }

      await persistConversationBrainLegacyDisabledServerOutcome(
        cbVoicePack.voice.body,
        "conversation_brain_legacy_fallback_disabled"
      );

      const nowFb = new Date().toISOString();
      const { data: persistedFb } = await supabaseServer
        .from("sms_inbound_coach_jobs")
        .update({
          reply_body: cbVoicePack.voice.body,
          status: "reply_ready",
          next_retry_at: nowFb,
          updated_at: nowFb,
          last_error: null,
        })
        .eq("message_sid", job.message_sid)
        .eq("status", "processing")
        .select()
        .maybeSingle();

      const legacyFallbackThreadMemoryCtx = {
        commitmentId: commitment.id,
        expectedAnswerType:
          typeof northStarPktCb.expectedReplySemantics === "string"
            ? northStarPktCb.expectedReplySemantics
            : null,
        meaningShadow: buildNormalLaneMeaningShadow({
          commitmentId: commitment.id,
          route: MEANING_INTERPRETER_ROUTES.conversation_brain_legacy_fallback,
          classifierEventType: eventType,
          classifierNormalizedHint: normalizedHint,
          openQuestionText: northStarPktCb.latestOpenQuestion?.trim() || null,
          lastOutboundPreview: lastOutboundSmsPreview,
          behaviorStatement: commitment.behavior_statement ?? null,
        }),
      };

      if (!persistedFb) {
        const jfb = await loadJob(job.message_sid);
        if (jfb?.reply_body?.trim()) {
          await commitAndSendInboundRelationshipCoachReply(jfb, userId, legacyFallbackThreadMemoryCtx);
          return;
        }
        throw new Error("v2_reply_ready_persist_failed");
      }

      const freshFb = (await loadJob(job.message_sid)) ?? job;
      await commitAndSendInboundRelationshipCoachReply(freshFb, userId, legacyFallbackThreadMemoryCtx);
      return;
    }
  }

  const needInterpretation = interpretationRequested && conversationBrainControlTurn == null;
  const prForShadow = getPendingResolutionOrNull(commitment);
  const smsPayloadForShadow =
    prForShadow?.payload?.source === "sms_inbound" ? prForShadow.payload : null;
  const shadowInterpretArgs = {
    commitment,
    userMessage,
    deterministicEventType: eventType,
    deterministicNormalizedHint: normalizedHint ?? null,
    effectiveAsk: effectiveBehavior,
    eventsNewestFirst: recentEvents,
    coachingMemory: coachingMemoryRow,
    preferredName,
    lastOutboundSmsPreview,
    lastOutboundNextMove,
    latestBlockerPreview,
    adaptiveProposalPending,
    pendingResolutionKind: commitment.pending_resolution_kind,
    pendingResolutionExpiresAt: commitment.pending_resolution_expires_at,
    pendingResolutionSmsState: smsPayloadForShadow?.sms_state ?? null,
    pendingResolutionSmsInbound: Boolean(smsPayloadForShadow),
    refreshSessionActive: isRefreshSessionActive(commitment),
    afterSilence,
    ...(brokePause ? { brokePause: true as const } : {}),
    relationshipContextTruncated,
    recentSmsContextBlock: smsConvPackBlock,
  };

  const profileIdentitySource =
    typeof inboundProfileRow?.identity_source === "string"
      ? inboundProfileRow.identity_source.trim()
      : null;

  const memorySignalArgs: V2InboundMemorySignalsInput = {
    userMessage,
    commitment,
    coachingMemory: coachingMemoryRow,
    preferredName,
    peopleSummaryToneHint: peopleSummary,
    responsibilityToneHint: responsibility,
    identityAnchorQuotablePreview:
      identityAnchorText && isQuotableIdentitySource(profileIdentitySource)
        ? identityAnchorText.slice(0, 200)
        : null,
    identitySource: profileIdentitySource,
    recentSmsContextBlock: smsConvPackBlock,
    effectiveAsk: effectiveBehavior,
  };

  const memorySignalsEnabled = isV2InboundMemorySignalsEnabled();
  const memoryInterpretAttempt =
    memorySignalsEnabled &&
    shouldAttemptInboundMemorySignalInterpretation(userMessage, {
      forceBecauseInterpretation: interpretationRequested,
    });

  // 4) Shadow / gated interpretation + Wave 9 memory signals (parallel when both on).
  let shadowInterpretationRaw: Awaited<ReturnType<typeof interpretV2InboundAccountabilityReply>> | null =
    null;
  let memorySignalResult: Awaited<ReturnType<typeof interpretV2InboundMemorySignals>> | null = null;

  if (needInterpretation && memoryInterpretAttempt) {
    const [shadowRes, memRes] = await Promise.all([
      interpretV2InboundAccountabilityReply(shadowInterpretArgs),
      interpretV2InboundMemorySignals(memorySignalArgs),
    ]);
    shadowInterpretationRaw = shadowRes;
    memorySignalResult = memRes;
  } else if (needInterpretation) {
    shadowInterpretationRaw = await interpretV2InboundAccountabilityReply(shadowInterpretArgs);
  } else if (memoryInterpretAttempt) {
    memorySignalResult = await interpretV2InboundMemorySignals(memorySignalArgs);
  }

  const gatedEnabled = isV2AiInboundGatedOutcomesEnabled();
  let gatedDecision: V2InboundGatedDecision;
  if (conversationBrainControlTurn != null) {
    const ft = conversationBrainControlTurn.guard.final_event_type!;
    const prop = conversationBrainControlTurn.proposal;
    gatedDecision = {
      mode: "use_ai_outcome",
      final_event_type: ft,
      decision_reason: "conversation_brain_v1",
      confidence_used: prop.outcome_confidence,
      should_write_outcome_event: true,
      should_open_blocker_capture: ft === "user_no" || ft === "user_partial",
      reply_style: "normal_outcome",
      overrode_deterministic: ft !== eventType,
    };
  } else {
    gatedDecision = resolveV2InboundGatedDecision({
      gatedEnabled,
      interpretation: shadowInterpretationRaw,
      deterministicEventType: eventType,
      deterministicNormalizedHint: normalizedHint ?? null,
      rawInboundBody: userMessage,
    });
  }

  if (plannedInterruptionActionable && plannedInterruptionDetection.reasonCategory) {
    await insertSmsPlannedInterruptionMemorySignal({
      commitmentId: commitment.id,
      clerkUserId: userId,
      messageSid: job.message_sid,
      messagePreview: userMessage,
      gatedMode: gatedDecision.mode,
      memorySignal: buildPlannedInterruptionMemorySignalPayload({
        raw: userMessage,
        messageSid: job.message_sid,
        reasonCategory: plannedInterruptionDetection.reasonCategory,
        resumeHint: plannedInterruptionDetection.resumeHint,
        confidence: plannedInterruptionDetection.confidence,
        sourcePath: "sms_inbound_coach_main",
      }),
    });
    gatedDecision = applyPlannedInterruptionGatedOverride(gatedDecision);
  }

  const relationshipExitLaneActive = isRelationshipExitLaneActive({
    detection: relationshipExitDetection,
    deferToGoalHandoff: deferRelationshipExitToGoalHandoff,
  });
  if (relationshipExitLaneActive) {
    gatedDecision = applyRelationshipExitGatedOverride(relationshipExitDetection);
  }

  const identityEditLaneActive = isIdentityEditLaneActive({
    detection: identityEditDetection,
    relationshipExitLaneActive,
  });
  if (identityEditLaneActive) {
    gatedDecision = applyIdentityEditGatedOverride(identityEditDetection);
  }

  let shadowInterpretationStored: Record<string, unknown> | undefined;
  if (needInterpretation && shadowInterpretationRaw != null) {
    shadowInterpretationStored = buildStoredShadowInterpretationPayload({
      interpretationResult: shadowInterpretationRaw,
      deterministicEventType: eventType,
      deterministicNormalizedHint: normalizedHint ?? null,
      smsContextPackMeta: smsConvPackMeta,
    });

    if (shadowInterpretationStored.shadow_ai_failed === true) {
      console.warn("[v2-inbound-shadow] shadow_ai_failed", {
        commitment_id: commitment.id,
        reason: shadowInterpretationStored.failure_reason,
      });
    } else {
      console.log("[v2-inbound-shadow] success", {
        commitment_id: commitment.id,
        classifier: eventType,
        ai_intent: shadowInterpretationStored.ai_intent,
        ai_agrees_with_classifier: shadowInterpretationStored.ai_agrees_with_classifier,
      });
      const detKey = deterministicEventTypeToProposedKey(eventType);
      const aiOutcome = shadowInterpretationStored.ai_proposed_outcome;
      if (
        typeof aiOutcome === "string" &&
        (aiOutcome === "yes" || aiOutcome === "no" || aiOutcome === "partial") &&
        aiOutcome !== detKey
      ) {
        console.warn("[v2-inbound-shadow] disagreement", {
          commitment_id: commitment.id,
          deterministic_outcome_key: detKey,
          ai_proposed_outcome: aiOutcome,
        });
      }
      if (shadowInterpretationStored.ai_would_have_asked_clarification === true) {
        console.log("[v2-inbound-shadow] suggested_clarification", {
          commitment_id: commitment.id,
        });
      }
      if (shadowInterpretationStored.ai_is_repair === true) {
        console.log("[v2-inbound-shadow] detected_repair", {
          commitment_id: commitment.id,
          repair_of: shadowInterpretationStored.ai_repair_of,
        });
      }
      if (shadowInterpretationStored.ai_suggests_commitment_change === true) {
        console.log("[v2-inbound-shadow] commitment_change_intent", {
          commitment_id: commitment.id,
        });
      }
      if (shadowInterpretationStored.ai_substitution_counts === true) {
        console.log("[v2-inbound-shadow] substitution_counts", {
          commitment_id: commitment.id,
        });
      }
    }
  }

  if (gatedEnabled) {
    console.log("[v2-inbound-gated] decision", {
      commitment_id: commitment.id,
      mode: gatedDecision.mode,
      final_event_type: gatedDecision.final_event_type,
      writes_outcome: gatedDecision.should_write_outcome_event,
      overrode: gatedDecision.overrode_deterministic,
    });
  }

  const finalOutcomeType = gatedDecision.final_event_type ?? eventType;
  const isRepairProof =
    gatedDecision.should_write_outcome_event &&
    gatedDecision.reply_style === "repair" &&
    gatedDecision.mode === "use_ai_outcome";

  const accountabilityProofMoment =
    gatedDecision.should_write_outcome_event &&
    (finalOutcomeType === "user_yes" ||
      finalOutcomeType === "user_no" ||
      finalOutcomeType === "user_partial")
      ? buildProofMomentForAccountabilityOutcome({
          finalEventType: finalOutcomeType,
          eventsNewestFirst: recentEvents,
          isRepairOutcome: isRepairProof,
          userMessageCharCount: userMessage.length,
        })
      : null;

  const proofPromptHint = proofMomentToPromptHint(accountabilityProofMoment);

  const proofCalloutHint = buildInboundProofCalloutHint({
    proofMeta: accountabilityProofMoment,
    eventsNewestFirst: recentEvents,
    shouldWriteOutcomeEvent: gatedDecision.should_write_outcome_event,
  });

  let v3BrainPayload: V3SmsBrainResult | null = null;
  let v3DraftAttempt: Awaited<ReturnType<typeof produceV3InboundCoachDraft>> | null = null;
  let inboundCoachingBriefV1Log: ReturnType<typeof compactCoachingBriefV1ForV3Brain> | null =
    null;

  const northStarPktForV3 = buildInboundNorthStarContextPacket({
    commitmentId: commitment.id,
    behaviorStatement: commitment.behavior_statement ?? "",
    effectiveAskText: effectiveBehavior,
    timezone,
    userMessage,
    lastOutboundSmsPreview,
    checkPayload: (checkPayload ?? {}) as Record<string, unknown>,
    recentEvents,
    convPack: convPackFull,
    coachingMemory: coachingMemoryRow,
    finalEventType: gatedDecision.final_event_type ?? eventType,
    lifeDesires: null,
    peopleSummary,
    identityAnchorText,
    latestBlockerPreview,
    proofDisplayedOrMoment: Boolean(accountabilityProofMoment),
  });

  const priorYesForV3 = recentEventsIncludeUserYesOnLocalDay(
    recentEvents,
    timezone,
    getDateKeyInTimezone(new Date(), timezone)
  );

  const normalCoachingV3Eligible =
    !isLikelySmsComplianceOrOptOutTurn(userMessage) &&
    !isLikelyCommitmentChangeIntentTurn(userMessage);

  /** Phase 3G-1: soft opt-out phrases use V3 integrity lane, not legacy transactional composer. */
  const isInboundTransactionalException =
    isLikelySmsComplianceOrOptOutTurn(userMessage) && !relationshipExitLaneActive;

  const pendingResolutionPreHandoff = getPendingResolutionOrNull(commitment);
  const patternSignalPreHandoff = deriveSmsPatternSignal({
    eventsNewestFirst: recentEvents,
    coachingMemory: coachingMemoryRow,
    patRead: victoryBackgroundFacts?.pat_read_pattern
      ? {
          pattern_text: victoryBackgroundFacts.pat_read_pattern,
          pattern_confidence: null,
        }
      : null,
    inboundRaw: userMessage,
    nowMs: Date.now(),
  });
  const goalAdjustmentSignalPreHandoff = deriveSmsGoalAdjustmentSignal({
    eventsNewestFirst: recentEvents,
    coachingMemory: coachingMemoryRow,
    patternSignal: patternSignalPreHandoff,
    overlayState: {
      proposalPending: isV2PendingProposalValid(commitment, Date.now()),
      overlayActive: isV2AdaptiveOverlayActive(commitment, Date.now()),
      effectiveAskDiffers:
        effectiveBehavior.trim() !== (commitment.behavior_statement ?? "").trim(),
    },
    pendingResolution: pendingResolutionPreHandoff
      ? {
          kind: pendingResolutionPreHandoff.kind,
          sms_state:
            pendingResolutionPreHandoff.payload?.source === "sms_inbound"
              ? (pendingResolutionPreHandoff.payload.sms_state ?? null)
              : null,
        }
      : null,
    evolutionEval: {
      recommended_action: evaluateCommitmentEvolutionForSms({
        commitment,
        eventsNewestFirst: recentEvents,
        nowMs: Date.now(),
      }).recommended_action,
    },
    inboundRaw: userMessage,
    nowMs: Date.now(),
  });

  const openCommitmentChangeHandoff =
    shouldOpenCommitmentChangeHandoff({
      gatedMode: gatedDecision.mode,
      userMessage,
      plannedInterruptionActionable,
      classificationEventType: eventType,
    }) &&
    !shouldSuppressCommitmentChangeHandoffForIdentity({
      detection: identityEditDetection,
      identityLaneActive: identityEditLaneActive,
    });

  /** Wave-4 handoff uses its own lane entrypoint; main lane skips duplicate produce. */
  const normalInboundV3OwnershipEligible =
    !isInboundTransactionalException && !openCommitmentChangeHandoff;

  const centralSmsTurnShadowStored =
    conversationBrainControlTurn != null
      ? null
      : await interpretV2CentralSmsTurn({
          clerkUserId: userId,
          commitmentId: commitment.id,
          commitment,
          effectiveAsk: effectiveBehavior,
          inboundText: userMessage,
          lastOutboundPromptPreview: lastOutboundSmsPreview,
          recentSmsContextBlock: smsConvPackBlock,
          blockerCapturePending: isBlockerCapturePendingActive(commitment),
          refreshSessionActive: isRefreshSessionActive(commitment),
          smsPendingResolutionActive: isSmsInboundPendingResolutionActionable(commitment),
          contractOverlayProposalActive: isV2PendingProposalValid(commitment),
          memoryConfirmationPending: pendingAwaitingMemoryConfirmation != null,
          activeCommitmentPresent: true,
          deterministicClassifierEventType: eventType,
          deterministicNormalizedHint: normalizedHint ?? null,
          gatedSummary: {
            mode: gatedDecision.mode,
            final_event_type: gatedDecision.final_event_type,
            should_write_outcome_event: gatedDecision.should_write_outcome_event,
            reply_style: gatedDecision.reply_style,
          },
          shadowInterpretationRaw,
          routeContext: "normal_accountability",
        });

  const arcWriteOutcomeType = gatedDecision.final_event_type ?? eventType;
  const arcWouldWriteOutcomeEvent =
    gatedDecision.should_write_outcome_event &&
    (arcWriteOutcomeType === "user_yes" ||
      arcWriteOutcomeType === "user_no" ||
      arcWriteOutcomeType === "user_partial");

  const smsBrainControlEnabled = isV2CentralSmsBrainControlEnabled();
  if (
    smsBrainControlEnabled &&
    gatedDecision.should_write_outcome_event &&
    centralSmsTurnShadowStored != null &&
    shouldCentralBrainBlockOutcomeScoring({
      stored: centralSmsTurnShadowStored,
      controlEnabled: smsBrainControlEnabled,
    })
  ) {
    const pivotTetherMachine = buildCentralBrainHumanTetherReply({
      turnPurpose: centralSmsTurnShadowStored.central_turn_purpose,
      inboundText: userMessage,
      effectiveAskSnippet: effectiveBehavior,
      lastOutboundPromptPreview: lastOutboundSmsPreview,
      route: "normal_accountability",
    });
    let pivotLegacyPreview = pivotTetherMachine;
    if (shouldRunPhase5aCentralTetherBrain()) {
      pivotLegacyPreview = (
        await finalizePhase5aCentralTetherHumanSms({
          machineDraft: pivotTetherMachine,
          tetherRoute: "normal_accountability",
          centralTurnPurpose: centralSmsTurnShadowStored.central_turn_purpose,
        })
      ).message;
    }
    const wouldHave =
      gatedDecision.final_event_type != null
        ? `outcome:${gatedDecision.final_event_type}`
        : `mode:${gatedDecision.mode}`;
    console.log(
      "[central-sms-brain/control]",
      JSON.stringify({
        wave: "14.2",
        commitment_id: commitment.id,
        control_action: "blocked_outcome_scoring",
        no_event_reason: "central_brain_human_or_meta",
        reply_source: "central_brain_deterministic_v14_2",
        central_purpose: centralSmsTurnShadowStored.central_turn_purpose,
        central_confidence: centralSmsTurnShadowStored.confidence,
        old_path_that_would_have_run: wouldHave,
      })
    );

    const pivotLines = buildMinimalInboundTranscriptLines(
      convPackFull,
      userMessage,
      lastOutboundSmsPreview
    );
    const forcedCoachSmsPivot =
      conversationBrainControlTurn == null
        ? tryBuildForcedInboundCoachSms({
            userMessage,
            gatedDecision,
            lastOutboundSmsPreview,
            eventsNewestFirst: recentEvents,
            effectiveAskFloor: effectiveBehavior,
            messageSid: job.message_sid,
          })
        : null;
    const relationshipTonePivot =
      coachingMemoryRow?.sms_relationship_profile != null
        ? JSON.stringify(coachingMemoryRow.sms_relationship_profile).slice(0, 240)
        : null;

    const conversationBrainFactsPivot: InboundV3ConversationBrainFacts =
      conversationBrainControlTurn != null
        ? {
            enabled: true,
            model: conversationBrainControlTurn.model,
            guardrail_status: conversationBrainControlTurn.guard.status,
            turn_kind: conversationBrainControlTurn.proposal.turn_kind,
            outcome_confidence: conversationBrainControlTurn.proposal.outcome_confidence,
            reply_strategy: conversationBrainControlTurn.proposal.reply_strategy,
            needs_clarification: conversationBrainControlTurn.proposal.needs_clarification,
            repeated_clarification_risk: conversationBrainControlTurn.proposal.repeated_clarification_risk,
            final_event_type: conversationBrainControlTurn.guard.final_event_type ?? null,
          }
        : { enabled: false };

    const centralBrainFactsPivot: InboundV3CentralBrainFacts = {
      shadow_stored: true,
      central_turn_purpose: centralSmsTurnShadowStored.central_turn_purpose ?? null,
      confidence: centralSmsTurnShadowStored.confidence ?? null,
      blocked_outcome_scoring: true,
    };

    let arcFactsPivot: InboundV3ArcFacts = {
      ambiguous_short_reply: false,
      clarification_required: false,
    };
    if (isV2ActiveReplyContextEnabled() && arcWouldWriteOutcomeEvent && conversationBrainControlTurn == null) {
      const activeReplyCtxPivot = buildV2ActiveReplyContext({
        inboundText: userMessage,
        eventsNewestFirst: recentEvents,
        commitmentTitle: commitment.title,
        behaviorStatement: commitment.behavior_statement,
        effectiveAsk: effectiveBehavior,
      });
      arcFactsPivot = {
        ambiguous_short_reply: Boolean(activeReplyCtxPivot.ambiguous_short_reply),
        clarification_required: Boolean(activeReplyCtxPivot.should_force_clarification_for_ambiguous_short_reply),
      };
    }

    const pivotFacts = buildInboundV3RelationshipFacts({
      clerkUserId: userId,
      preferredName,
      timezone,
      localTimeIso: new Date(new Date().toLocaleString("en-US", { timeZone: timezone })).toISOString(),
      commitment,
      effectiveAsk: effectiveBehavior,
      userMessageRaw: userMessage,
      coalescedInboundText: userMessage,
      suppressedMessageSids: splitSuppressedMessageSids,
      transcriptLines: pivotLines,
      northStarPacket: northStarPktForV3,
      gatedDecision,
      deterministicEventType: eventType,
      doNotRepeatHints: deriveDoNotRepeatHintsFromCoachingMemory(coachingMemoryRow),
      relationshipProfileSummary: relationshipTonePivot,
      conversationBrain: conversationBrainFactsPivot,
      centralBrain: centralBrainFactsPivot,
      arc: arcFactsPivot,
      phase5a: {
        central_tether_brain_enabled: shouldRunPhase5aCentralTetherBrain(),
        arc_clarify_brain_enabled: shouldRunPhase5aArcClarifyBrain(),
        inbound_stitched_final_enabled: shouldRunPhase5aInboundStitchedFinalBrain(),
      },
      forcedFutureStretchIntentActive: Boolean(forcedCoachSmsPivot),
      wave11MemoryConfirmationPending: pendingAwaitingMemoryConfirmation != null,
      accountabilityProofHint: proofPromptHint != null ? JSON.stringify(proofPromptHint) : null,
      rejectedTimeCandidates: [],
      unavailableWindows: [],
      routePurpose: "central_brain_pivot",
      branchName: "central_brain_outcome_blocking_pivot",
      branchMigratedToLane: true,
      centralBrainPivotFacts: {
        blocked_outcome_scoring: true,
        central_turn_purpose: centralSmsTurnShadowStored.central_turn_purpose ?? null,
        confidence:
          typeof centralSmsTurnShadowStored.confidence === "number" &&
          Number.isFinite(centralSmsTurnShadowStored.confidence)
            ? centralSmsTurnShadowStored.confidence
            : null,
        reason: "central_brain_human_or_meta",
        suggested_move: String(centralSmsTurnShadowStored.central_turn_purpose ?? "respond_to_thread").slice(0, 120),
        legacy_tether_text_preview: pivotLegacyPreview.slice(0, 500),
      },
      victoryBackground: victoryBackgroundFacts,
      relationshipMemoryPacket: inboundRelationshipMemoryPacket,
    });

    const pivotLaneRes = await produceInboundV3RelationshipSms({
      facts: pivotFacts,
      telemetry_fact_sources: [
        "classifyV2InboundReply",
        "resolveV2InboundGatedDecision",
        "buildInboundNorthStarContextPacket",
        "buildMinimalInboundTranscriptLines",
        "interpretV2CentralSmsTurn",
        "buildV2ActiveReplyContext",
        "deriveDoNotRepeatHintsFromCoachingMemory",
        "buildCentralBrainHumanTetherReply_legacy_preview_only",
        "finalizePhase5aCentralTetherHumanSms_legacy_preview_only",
      ],
    });

    if (!pivotLaneRes.shouldSend || !pivotLaneRes.body.trim()) {
      await markJobFinal({
        messageSid: job.message_sid,
        status: "cancelled",
        lastError: formatInboundV3LaneNoSendLastError(pivotLaneRes, {
          route_purpose: "central_brain_pivot",
          branch_name: "central_brain_outcome_blocking_pivot",
          branch_migrated_to_lane: true,
        }),
        nextRetry: farFutureIso(),
      });
      console.warn("[sms-inbound-coach] pivot_inbound_relationship_lane_no_send", {
        message_sid: job.message_sid,
        commitment_id: commitment.id,
        reason: pivotLaneRes.noSendReason,
      });
      return;
    }

    const pivotV3BrainMetadata: Record<string, unknown> = {
      ...pivotLaneRes.metadata,
      inbound_v3_relationship_lane: true,
      v3_lane_turn_purpose: pivotLaneRes.turnPurpose,
      route_purpose: "central_brain_pivot",
      branch_migrated_to_lane: true,
      branch_name: "central_brain_outcome_blocking_pivot",
      central_brain_pivot_facts_summary: slimCentralBrainPivotFactsForTelemetry(pivotFacts.central_brain_pivot_facts),
      v3_candidate_body: pivotLaneRes.body,
    };

    const pivotVoicePack = await northStarGatePersistBodyAsync(pivotLaneRes.body, {
      job,
      channel: "central_brain_pivot",
      lastOutboundBody: lastOutboundSmsPreview,
      effectiveAsk: effectiveBehavior,
      behaviorStatement: commitment.behavior_statement,
      finalEventType: gatedDecision.final_event_type ?? eventType,
      replySource: "v3_inbound_relationship_lane",
      contextPacket: northStarPktForV3,
      activeCommitmentId: commitment.id,
      normalCoaching: true,
      v3BrainMetadata: pivotV3BrainMetadata,
    });
    if (!pivotVoicePack.voice.shouldSend) {
      await markJobFinal({
        messageSid: job.message_sid,
        status: "cancelled",
        lastError: finalVoiceSkipLastError(pivotVoicePack.voice, {
          route_purpose: "central_brain_pivot",
          branch_name: "central_brain_outcome_blocking_pivot",
          branch_migrated_to_lane: true,
          v3_lane_reply_source: "v3_inbound_relationship_lane",
          v3_candidate_body: pivotLaneRes.body.slice(0, 500),
          lane_metadata: pivotLaneRes.metadata,
          north_star_gate: {
            original_body: pivotVoicePack.northStarMeta.originalBody,
            final_body: pivotVoicePack.northStarVisibleBody,
            north_star_gate_source: pivotVoicePack.northStarMeta.source,
            north_star_gate_reasons: pivotVoicePack.northStarMeta.blockedReasons,
            ...pickNorthStarWriterAttributionFields(pivotVoicePack.northStarMeta),
          },
          final_voice_gate: pivotVoicePack.voice.metadata,
          should_send: false,
        }),
        nextRetry: farFutureIso(),
      });
      console.warn("[sms-inbound-coach] pivot_final_voice_suppressed", {
        message_sid: job.message_sid,
      });
      return;
    }
    const gatedPivot = pivotVoicePack.voice.body;
    const nowPivot = new Date().toISOString();
    const { data: persistedPivot } = await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        reply_body: gatedPivot,
        status: "reply_ready",
        next_retry_at: nowPivot,
        updated_at: nowPivot,
        last_error: null,
      })
      .eq("message_sid", job.message_sid)
      .eq("status", "processing")
      .select()
      .maybeSingle();

    const centralBrainPivotThreadMemoryCtx = {
      commitmentId: commitment.id,
      expectedAnswerType:
        typeof northStarPktForV3.expectedReplySemantics === "string"
          ? northStarPktForV3.expectedReplySemantics
          : null,
      meaningShadow: buildNormalLaneMeaningShadow({
        commitmentId: commitment.id,
        route: MEANING_INTERPRETER_ROUTES.central_brain_pivot,
        classifierEventType: eventType,
        classifierNormalizedHint: normalizedHint,
        gatedMode: gatedDecision.mode,
        openQuestionText: northStarPktForV3.latestOpenQuestion?.trim() || null,
        lastOutboundPreview: lastOutboundSmsPreview,
        behaviorStatement: commitment.behavior_statement ?? null,
      }),
    };

    if (!persistedPivot) {
      const j2 = await loadJob(job.message_sid);
      if (j2?.reply_body?.trim()) {
        await tryPersistInboundAccountabilityOutcomeBeforeSend({
          branch: "central_pivot",
          job,
          userId,
          commitment,
          userMessage,
          eventType,
          normalizedHint,
          gatedDecision,
          recentEvents,
          effectiveBehavior,
          proofMeta: accountabilityProofMoment,
        });
        await commitAndSendInboundRelationshipCoachReply(j2, userId, centralBrainPivotThreadMemoryCtx);
        return;
      }
      throw new Error("v2_reply_ready_persist_failed");
    }

    await tryPersistInboundAccountabilityOutcomeBeforeSend({
      branch: "central_pivot",
      job,
      userId,
      commitment,
      userMessage,
      eventType,
      normalizedHint,
      gatedDecision,
      recentEvents,
      effectiveBehavior,
      proofMeta: accountabilityProofMoment,
    });
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    const freshPivot = (await loadJob(job.message_sid)) ?? job;
    await commitAndSendInboundRelationshipCoachReply(freshPivot, userId, centralBrainPivotThreadMemoryCtx);
    return;
  }

  if (
    isV2ActiveReplyContextEnabled() &&
    arcWouldWriteOutcomeEvent &&
    conversationBrainControlTurn == null
  ) {
    const activeReplyCtx = buildV2ActiveReplyContext({
      inboundText: userMessage,
      eventsNewestFirst: recentEvents,
      commitmentTitle: commitment.title,
      behaviorStatement: commitment.behavior_statement,
      effectiveAsk: effectiveBehavior,
    });
    if (activeReplyCtx.should_force_clarification_for_ambiguous_short_reply) {
      const clarificationMachine = buildActiveReplyContextClarificationSms({
        inboundText: userMessage,
        tentativeOutcomeType: arcWriteOutcomeType,
      });
      let arcLegacyPreview = clarificationMachine;
      if (shouldRunPhase5aArcClarifyBrain()) {
        arcLegacyPreview = (
          await finalizePhase5aArcClarifyHumanSms({
            machineDraft: clarificationMachine,
            tentativeOutcomeLabel: arcWriteOutcomeType,
          })
        ).message;
      }
      console.info(
        "[active-reply-context] clarification",
        JSON.stringify({
          wave: "14.3a",
          message_sid: job.message_sid,
          commitment_id: commitment.id,
          ambiguous_short_reply: activeReplyCtx.ambiguous_short_reply,
          no_event_reason:
            activeReplyCtx.clarification_reason ?? "ambiguous_short_reply_clarification",
          accountability_prompt_age_minutes: activeReplyCtx.accountability_prompt_age_minutes,
          accountability_prompt_sent_at: activeReplyCtx.accountability_prompt_sent_at,
          latest_outcome_at: activeReplyCtx.latest_outcome_at,
          tentative_outcome: arcWriteOutcomeType,
        })
      );

      const arcLines = buildMinimalInboundTranscriptLines(
        convPackFull,
        userMessage,
        lastOutboundSmsPreview
      );
      const forcedCoachSmsArc = tryBuildForcedInboundCoachSms({
        userMessage,
        gatedDecision,
        lastOutboundSmsPreview,
        eventsNewestFirst: recentEvents,
        effectiveAskFloor: effectiveBehavior,
        messageSid: job.message_sid,
      });
      const relationshipToneArc =
        coachingMemoryRow?.sms_relationship_profile != null
          ? JSON.stringify(coachingMemoryRow.sms_relationship_profile).slice(0, 240)
          : null;

      const conversationBrainFactsArc: InboundV3ConversationBrainFacts = { enabled: false };

      const centralBrainFactsArc: InboundV3CentralBrainFacts =
        centralSmsTurnShadowStored != null
          ? {
              shadow_stored: true,
              central_turn_purpose: centralSmsTurnShadowStored.central_turn_purpose ?? null,
              confidence: centralSmsTurnShadowStored.confidence ?? null,
              blocked_outcome_scoring: false,
            }
          : { shadow_stored: false };

      const arcFactsArc: InboundV3ArcFacts = {
        ambiguous_short_reply: true,
        clarification_required: true,
      };

      const latestCheckQuestion =
        (lastOutboundSmsPreview != null && lastOutboundSmsPreview.trim().length > 0
          ? lastOutboundSmsPreview.trim()
          : null) ??
        (northStarPktForV3.latestOpenQuestion != null && northStarPktForV3.latestOpenQuestion.trim().length > 0
          ? northStarPktForV3.latestOpenQuestion.trim()
          : null);

      const arcInboundFacts = buildInboundV3RelationshipFacts({
        clerkUserId: userId,
        preferredName,
        timezone,
        localTimeIso: new Date(new Date().toLocaleString("en-US", { timeZone: timezone })).toISOString(),
        commitment,
        effectiveAsk: effectiveBehavior,
        userMessageRaw: userMessage,
        coalescedInboundText: userMessage,
        suppressedMessageSids: splitSuppressedMessageSids,
        transcriptLines: arcLines,
        northStarPacket: northStarPktForV3,
        gatedDecision,
        deterministicEventType: eventType,
        doNotRepeatHints: deriveDoNotRepeatHintsFromCoachingMemory(coachingMemoryRow),
        relationshipProfileSummary: relationshipToneArc,
        conversationBrain: conversationBrainFactsArc,
        centralBrain: centralBrainFactsArc,
        arc: arcFactsArc,
        phase5a: {
          central_tether_brain_enabled: shouldRunPhase5aCentralTetherBrain(),
          arc_clarify_brain_enabled: shouldRunPhase5aArcClarifyBrain(),
          inbound_stitched_final_enabled: shouldRunPhase5aInboundStitchedFinalBrain(),
        },
        forcedFutureStretchIntentActive: Boolean(forcedCoachSmsArc),
        wave11MemoryConfirmationPending: pendingAwaitingMemoryConfirmation != null,
        accountabilityProofHint: proofPromptHint != null ? JSON.stringify(proofPromptHint) : null,
        rejectedTimeCandidates: [],
        unavailableWindows: [],
        routePurpose: "arc_clarify_ambiguous_short",
        branchName: "arc_ambiguous_short_clarify",
        branchMigratedToLane: true,
        arcClarificationFacts: {
          ambiguous_short_reply: true,
          tentative_outcome: arcWriteOutcomeType,
          clarification_reason: activeReplyCtx.clarification_reason,
          context_age: {
            accountability_prompt_age_minutes: activeReplyCtx.accountability_prompt_age_minutes,
            accountability_prompt_sent_at: activeReplyCtx.accountability_prompt_sent_at,
            latest_outcome_at: activeReplyCtx.latest_outcome_at,
          },
          latest_question: latestCheckQuestion,
          legacy_clarification_text_preview: arcLegacyPreview.slice(0, 500),
        },
        victoryBackground: victoryBackgroundFacts,
        relationshipMemoryPacket: inboundRelationshipMemoryPacket,
      });

      const arcLaneRes = await produceInboundV3RelationshipSms({
        facts: arcInboundFacts,
        telemetry_fact_sources: [
          "classifyV2InboundReply",
          "resolveV2InboundGatedDecision",
          "buildInboundNorthStarContextPacket",
          "buildMinimalInboundTranscriptLines",
          "interpretV2CentralSmsTurn",
          "buildV2ActiveReplyContext",
          "deriveDoNotRepeatHintsFromCoachingMemory",
          "buildActiveReplyContextClarificationSms_legacy_preview_only",
          "finalizePhase5aArcClarifyHumanSms_legacy_preview_only",
        ],
      });

      if (!arcLaneRes.shouldSend || !arcLaneRes.body.trim()) {
        await markJobFinal({
          messageSid: job.message_sid,
          status: "cancelled",
          lastError: formatInboundV3LaneNoSendLastError(arcLaneRes, {
            route_purpose: "arc_clarify_ambiguous_short",
            branch_name: "arc_ambiguous_short_clarify",
            branch_migrated_to_lane: true,
          }),
          nextRetry: farFutureIso(),
        });
        console.warn("[sms-inbound-coach] arc_inbound_relationship_lane_no_send", {
          message_sid: job.message_sid,
          commitment_id: commitment.id,
          reason: arcLaneRes.noSendReason,
        });
        return;
      }

      const arcV3BrainMetadata: Record<string, unknown> = {
        ...arcLaneRes.metadata,
        inbound_v3_relationship_lane: true,
        v3_lane_turn_purpose: arcLaneRes.turnPurpose,
        route_purpose: "arc_clarify_ambiguous_short",
        branch_migrated_to_lane: true,
        branch_name: "arc_ambiguous_short_clarify",
        arc_clarification_facts_summary: slimArcClarificationFactsForTelemetry(arcInboundFacts.arc_clarification_facts),
        v3_candidate_body: arcLaneRes.body,
      };

      const clarifyVoicePack = await northStarGatePersistBodyAsync(arcLaneRes.body, {
        job,
        channel: "clarification",
        lastOutboundBody: lastOutboundSmsPreview,
        effectiveAsk: effectiveBehavior,
        behaviorStatement: commitment.behavior_statement,
        finalEventType: arcWriteOutcomeType,
        replySource: "v3_inbound_relationship_lane",
        contextPacket: northStarPktForV3,
        activeCommitmentId: commitment.id,
        normalCoaching: true,
        v3BrainMetadata: arcV3BrainMetadata,
      });
      if (!clarifyVoicePack.voice.shouldSend) {
        await markJobFinal({
          messageSid: job.message_sid,
          status: "cancelled",
          lastError: finalVoiceSkipLastError(clarifyVoicePack.voice, {
            route_purpose: "arc_clarify_ambiguous_short",
            branch_name: "arc_ambiguous_short_clarify",
            branch_migrated_to_lane: true,
            v3_lane_reply_source: "v3_inbound_relationship_lane",
            v3_candidate_body: arcLaneRes.body.slice(0, 500),
            lane_metadata: arcLaneRes.metadata,
            north_star_gate: {
              original_body: clarifyVoicePack.northStarMeta.originalBody,
              final_body: clarifyVoicePack.northStarVisibleBody,
              north_star_gate_source: clarifyVoicePack.northStarMeta.source,
              north_star_gate_reasons: clarifyVoicePack.northStarMeta.blockedReasons,
              ...pickNorthStarWriterAttributionFields(clarifyVoicePack.northStarMeta),
            },
            final_voice_gate: clarifyVoicePack.voice.metadata,
            should_send: false,
          }),
          nextRetry: farFutureIso(),
        });
        console.warn("[sms-inbound-coach] arc_clarify_final_voice_suppressed", {
          message_sid: job.message_sid,
        });
        return;
      }
      const gatedClarify = clarifyVoicePack.voice.body;
      const nowArc = new Date().toISOString();
      const { data: persistedArc } = await supabaseServer
        .from("sms_inbound_coach_jobs")
        .update({
          reply_body: gatedClarify,
          status: "reply_ready",
          next_retry_at: nowArc,
          updated_at: nowArc,
          last_error: null,
        })
        .eq("message_sid", job.message_sid)
        .eq("status", "processing")
        .select()
        .maybeSingle();

      const arcClarifyThreadMemoryCtx = {
        commitmentId: commitment.id,
        expectedAnswerType:
          typeof northStarPktForV3.expectedReplySemantics === "string"
            ? northStarPktForV3.expectedReplySemantics
            : null,
        meaningShadow: buildNormalLaneMeaningShadow({
          commitmentId: commitment.id,
          route: MEANING_INTERPRETER_ROUTES.arc_clarify,
          classifierEventType: eventType,
          classifierNormalizedHint: normalizedHint,
          gatedMode: gatedDecision.mode,
          openQuestionText: northStarPktForV3.latestOpenQuestion?.trim() || null,
          lastOutboundPreview: lastOutboundSmsPreview,
          behaviorStatement: commitment.behavior_statement ?? null,
        }),
      };

      const arcClarifyLaneExclusion: InboundOutcomePersistLaneExclusion =
        isClearAccountabilityCompletionReply(userMessage) ? "none" : "arc_clarify_only";

      if (!persistedArc) {
        const j2 = await loadJob(job.message_sid);
        if (j2?.reply_body?.trim()) {
          await tryPersistInboundAccountabilityOutcomeBeforeSend({
            branch: "arc_clarify",
            laneExclusion: arcClarifyLaneExclusion,
            job,
            userId,
            commitment,
            userMessage,
            eventType,
            normalizedHint,
            gatedDecision,
            recentEvents,
            effectiveBehavior,
            proofMeta: accountabilityProofMoment,
          });
          await commitAndSendInboundRelationshipCoachReply(j2, userId, arcClarifyThreadMemoryCtx);
          return;
        }
        throw new Error("v2_reply_ready_persist_failed");
      }

      await tryPersistInboundAccountabilityOutcomeBeforeSend({
        branch: "arc_clarify",
        laneExclusion: arcClarifyLaneExclusion,
        job,
        userId,
        commitment,
        userMessage,
        eventType,
        normalizedHint,
        gatedDecision,
        recentEvents,
        effectiveBehavior,
        proofMeta: accountabilityProofMoment,
      });
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      const freshArc = (await loadJob(job.message_sid)) ?? job;
      await commitAndSendInboundRelationshipCoachReply(freshArc, userId, arcClarifyThreadMemoryCtx);
      return;
    }
  }

  let wave4PendingResult: Awaited<ReturnType<typeof applyWave4SmsCommitmentPendingResolution>> | null = null;
  let handoffCommitmentIntentPack: V2SmsCommitmentIntentPack | null = null;
  let wave4PendingResolutionApplyException: string | null = null;
  let commitmentChangeBootstrapResult: Awaited<
    ReturnType<typeof bootstrapSmsPendingConfirmationFromInbound>
  > | null = null;

  if (openCommitmentChangeHandoff && !plannedInterruptionActionable) {
    handoffCommitmentIntentPack = deriveSmsCommitmentChangeIntent({
      rawBody: userMessage,
      interpretation: shadowInterpretationRaw,
      goalAdjustmentMove: goalAdjustmentSignalPreHandoff.move,
      plannedInterruptionActionable: false,
    });
    if (handoffCommitmentIntentPack.intent !== "sms_soft_quit_or_frustration") {
      try {
        const prWave = await applyWave4SmsCommitmentPendingResolution({
          commitmentId: commitment.id,
          clerkUserId: job.clerk_user_id,
          commitment,
          messageSid: job.message_sid,
          rawBody: userMessage,
          intentPack: handoffCommitmentIntentPack,
        });
        wave4PendingResult = prWave;
        if (prWave.pendingApplied) {
          await recomputeV2CoachingMemory(commitment.id, {
            reasonCode: "wave4_sms_pending_resolution",
          });
          const reloadedForBootstrap = (await getActiveCommitment(userId)) ?? commitment;
          commitmentChangeBootstrapResult = await bootstrapSmsPendingConfirmationFromInbound({
            commitment: reloadedForBootstrap,
            rawBody: userMessage,
          });
        }
        console.info("[wave4-sms-commitment] pending_resolution", {
          commitment_id: commitment.id,
          intent: handoffCommitmentIntentPack.intent,
          pending_applied: prWave.pendingApplied,
          pending_kind: prWave.pendingKind,
          skip: prWave.skipReason,
          bootstrap_promoted: commitmentChangeBootstrapResult?.promoted ?? false,
        });
      } catch (e) {
        wave4PendingResolutionApplyException = e instanceof Error ? e.message : String(e);
        console.error("[wave4-sms-commitment] pending_resolution_failed", {
          commitment_id: commitment.id,
          message: wave4PendingResolutionApplyException,
        });
        wave4PendingResult = {
          pendingApplied: false,
          pendingKind: null,
          skipReason: null,
        };
      }
    }
  }

  let inboundRelationshipLane: InboundV3RelationshipLaneResult | null = null;
  if (normalInboundV3OwnershipEligible) {
    const forcedCoachSmsForFacts =
      conversationBrainControlTurn == null
        ? tryBuildForcedInboundCoachSms({
            userMessage,
            gatedDecision,
            lastOutboundSmsPreview,
            eventsNewestFirst: recentEvents,
            effectiveAskFloor: effectiveBehavior,
            messageSid: job.message_sid,
          })
        : null;

    const relationshipToneSummaryInbound =
      coachingMemoryRow?.sms_relationship_profile != null
        ? JSON.stringify(coachingMemoryRow.sms_relationship_profile).slice(0, 240)
        : null;

    const conversationBrainFacts: InboundV3ConversationBrainFacts =
      conversationBrainControlTurn != null
        ? {
            enabled: true,
            model: conversationBrainControlTurn.model,
            guardrail_status: conversationBrainControlTurn.guard.status,
            turn_kind: conversationBrainControlTurn.proposal.turn_kind,
            outcome_confidence: conversationBrainControlTurn.proposal.outcome_confidence,
            reply_strategy: conversationBrainControlTurn.proposal.reply_strategy,
            needs_clarification: conversationBrainControlTurn.proposal.needs_clarification,
            repeated_clarification_risk: conversationBrainControlTurn.proposal.repeated_clarification_risk,
            final_event_type: conversationBrainControlTurn.guard.final_event_type ?? null,
          }
        : { enabled: false };

    const centralBrainFacts: InboundV3CentralBrainFacts =
      centralSmsTurnShadowStored != null
        ? {
            shadow_stored: true,
            central_turn_purpose: centralSmsTurnShadowStored.central_turn_purpose ?? null,
            confidence: centralSmsTurnShadowStored.confidence ?? null,
            blocked_outcome_scoring: plannedInterruptionActionable,
          }
        : { shadow_stored: false };

    let arcFactsLane: InboundV3ArcFacts = {
      ambiguous_short_reply: false,
      clarification_required: false,
    };
    if (isV2ActiveReplyContextEnabled() && arcWouldWriteOutcomeEvent && conversationBrainControlTurn == null) {
      const activeReplyCtxLane = buildV2ActiveReplyContext({
        inboundText: userMessage,
        eventsNewestFirst: recentEvents,
        commitmentTitle: commitment.title,
        behaviorStatement: commitment.behavior_statement,
        effectiveAsk: effectiveBehavior,
      });
      arcFactsLane = {
        ambiguous_short_reply: Boolean(activeReplyCtxLane.ambiguous_short_reply),
        clarification_required: Boolean(activeReplyCtxLane.should_force_clarification_for_ambiguous_short_reply),
      };
    }

    const mainTranscriptLines = buildMinimalInboundTranscriptLines(
      convPackFull,
      userMessage,
      lastOutboundSmsPreview
    );

    const commitmentChangeHeuristicContext =
      isLikelyCommitmentChangeIntentTurn(userMessage) && !openCommitmentChangeHandoff;
    const commitmentChangeContextFactsForLane = commitmentChangeHeuristicContext
      ? buildCommitmentChangeContextFactsForHeuristicInbound({
          commitment,
          userMessage,
          messageSid: job.message_sid,
          gatedMode: gatedDecision.mode,
          shadowInterpretation: shadowInterpretationRaw,
        })
      : undefined;
    const mainInboundLaneRoutePurpose: InboundV3RoutePurpose | undefined = relationshipExitLaneActive
      ? "relationship_exit_integrity"
      : identityEditLaneActive
        ? "identity_edit_integrity"
        : commitmentChangeHeuristicContext
          ? "commitment_change_context"
          : undefined;

    const relationshipExitFactsForLane = relationshipExitLaneActive
      ? buildInboundV3RelationshipExitFacts({
          detection: relationshipExitDetection,
          goalAbandonmentDeferredToHandoff: deferRelationshipExitToGoalHandoff,
        })
      : null;

    const identityEditFactsForLane = identityEditLaneActive
      ? buildInboundV3IdentityEditFacts({
          detection: identityEditDetection,
          identityAnchorPreview: identityAnchorText,
        })
      : null;

    const patternSignalMain = deriveSmsPatternSignal({
      eventsNewestFirst: recentEvents,
      coachingMemory: coachingMemoryRow,
      patRead: victoryBackgroundFacts?.pat_read_pattern
        ? {
            pattern_text: victoryBackgroundFacts.pat_read_pattern,
            pattern_confidence: null,
          }
        : null,
      inboundRaw: userMessage,
      nowMs: Date.now(),
    });
    const pendingResolutionMain = getPendingResolutionOrNull(commitment);
    const goalAdjustmentSignalMain = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: recentEvents,
      coachingMemory: coachingMemoryRow,
      patternSignal: patternSignalMain,
      overlayState: {
        proposalPending: isV2PendingProposalValid(commitment, Date.now()),
        overlayActive: isV2AdaptiveOverlayActive(commitment, Date.now()),
        effectiveAskDiffers:
          effectiveBehavior.trim() !== (commitment.behavior_statement ?? "").trim(),
      },
      pendingResolution: pendingResolutionMain
        ? {
            kind: pendingResolutionMain.kind,
            sms_state:
              pendingResolutionMain.payload?.source === "sms_inbound"
                ? (pendingResolutionMain.payload.sms_state ?? null)
                : null,
          }
        : null,
      evolutionEval: {
        recommended_action: evaluateCommitmentEvolutionForSms({
          commitment,
          eventsNewestFirst: recentEvents,
          nowMs: Date.now(),
        }).recommended_action,
      },
      inboundRaw: userMessage,
      nowMs: Date.now(),
    });

    let commsPreferencesFactsForLane: InboundV3CommsPreferencesFacts | null = null;
    if (commsPrefsTurn && commsPrefsTurn.parse.action !== "none") {
      const commsBuilt = buildInboundCommsPreferenceV3Facts({
        snapshot: commsPrefsTurn,
        row: commsPrefsTurn.rowAfter,
      });
      commsPreferencesFactsForLane = {
        comms_preference_action: commsBuilt.comms_preference_action,
        preference_write_ok: commsBuilt.preference_write_ok,
        pause_active: commsBuilt.pause_active,
        pause_until_iso: commsBuilt.pause_until_iso,
        pause_reason_category: commsBuilt.pause_reason_category,
        cadence_override: commsBuilt.cadence_override,
        weekend_send_policy: commsBuilt.weekend_send_policy,
        preferred_send_window: commsBuilt.preferred_send_window,
        preferred_local_hour: commsBuilt.preferred_local_hour,
        needs_cadence_clarification: commsBuilt.needs_cadence_clarification,
        required_meaning_summary: commsBuilt.required_meaning_lines.join(" "),
      };
    }

    const priorMemoryRepeatNoSend = await loadPriorInboundMemoryRepeatNoSendContext({
      clerkUserId: userId,
      commitmentId: commitment.id,
      normalizedInboundText: normalizeInboundTextForEscalation(userMessage),
      excludeMessageSid: job.message_sid,
    });

    const inboundFacts = buildInboundV3RelationshipFacts({
      clerkUserId: userId,
      preferredName,
      timezone,
      localTimeIso: new Date(new Date().toLocaleString("en-US", { timeZone: timezone })).toISOString(),
      commitment,
      effectiveAsk: effectiveBehavior,
      userMessageRaw: userMessage,
      coalescedInboundText: userMessage,
      suppressedMessageSids: splitSuppressedMessageSids,
      transcriptLines: mainTranscriptLines,
      northStarPacket: northStarPktForV3,
      gatedDecision,
      deterministicEventType: eventType,
      doNotRepeatHints: deriveDoNotRepeatHintsFromCoachingMemory(coachingMemoryRow),
      relationshipProfileSummary: relationshipToneSummaryInbound,
      conversationBrain: conversationBrainFacts,
      centralBrain: centralBrainFacts,
      arc: arcFactsLane,
      phase5a: {
        central_tether_brain_enabled: shouldRunPhase5aCentralTetherBrain(),
        arc_clarify_brain_enabled: shouldRunPhase5aArcClarifyBrain(),
        inbound_stitched_final_enabled: shouldRunPhase5aInboundStitchedFinalBrain(),
      },
      forcedFutureStretchIntentActive: Boolean(forcedCoachSmsForFacts),
      wave11MemoryConfirmationPending: pendingAwaitingMemoryConfirmation != null,
      accountabilityProofHint: proofPromptHint != null ? JSON.stringify(proofPromptHint) : null,
      rejectedTimeCandidates: [],
      unavailableWindows: [],
      ...(mainInboundLaneRoutePurpose != null ? { routePurpose: mainInboundLaneRoutePurpose } : {}),
      ...(commitmentChangeHeuristicContext
        ? { branchName: "commitment_change_context_heuristic", branchMigratedToLane: true as const }
        : {}),
      ...(commitmentChangeContextFactsForLane != null
        ? { commitmentChangeContextFacts: commitmentChangeContextFactsForLane }
        : {}),
      victoryBackground: victoryBackgroundFacts,
      relationshipMemoryPacket: inboundRelationshipMemoryPacket,
      patternSignal: patternSignalMain,
      goalAdjustmentSignal: goalAdjustmentSignalMain,
      ...(commsPreferencesFactsForLane != null
        ? { commsPreferencesFacts: commsPreferencesFactsForLane }
        : {}),
      plannedInterruption: plannedInterruptionActionable
        ? {
            active: true,
            reasonCategory: plannedInterruptionDetection.reasonCategory,
            resumeHint: plannedInterruptionDetection.resumeHint,
          }
        : null,
      proofCalloutHint,
      ...(relationshipExitFactsForLane != null ? { relationshipExitFacts: relationshipExitFactsForLane } : {}),
      ...(identityEditFactsForLane != null ? { identityEditFacts: identityEditFactsForLane } : {}),
      ...(priorMemoryRepeatNoSend != null ? { priorMemoryRepeatNoSend: priorMemoryRepeatNoSend } : {}),
    });
    inboundCoachingBriefV1Log = compactCoachingBriefV1ForV3Brain(
      buildCoachingBriefV1FromInboundFacts(inboundFacts)
    );

    const laneTelemetryFactSources = [
      "classifyV2InboundReply",
      "detectSmsRelationshipExitIntent",
      "detectSmsIdentityEditIntent",
      "resolveV2InboundGatedDecision",
      ...(commsPreferencesFactsForLane != null ? (["v2_sms_comms_preferences"] as const) : []),
      ...(proofCalloutHint ? (["buildInboundProofCalloutHint"] as const) : []),
      ...(plannedInterruptionActionable ? (["detectSmsPlannedInterruption"] as const) : []),
      "buildInboundNorthStarContextPacket",
      "buildMinimalInboundTranscriptLines",
      "interpretV2CentralSmsTurn",
      "buildV2ActiveReplyContext",
      "deriveDoNotRepeatHintsFromCoachingMemory",
      ...(commitmentChangeHeuristicContext ? (["buildCommitmentChangeContextFactsForHeuristicInbound"] as const) : []),
    ];

    const commsPrefActionLane = commsPrefsTurn?.parse.action ?? "none";
    const meaningShadowRouteEarly = resolveNormalInboundMeaningShadowRoute({
      mainInboundLaneRoutePurpose: relationshipExitLaneActive
        ? "relationship_exit_integrity"
        : identityEditLaneActive
          ? "identity_edit_integrity"
          : undefined,
      gatedMode: gatedDecision.mode,
      plannedInterruptionActive: plannedInterruptionActionable,
      forcedFutureStretchActive: Boolean(forcedCoachSmsForFacts),
      commsPreferenceAction: commsPrefActionLane,
    });
    registerInboundMeaningShadowPending({
      job,
      userId,
      rawBody: userMessage,
      schedule: buildNormalLaneMeaningShadow({
        commitmentId: commitment.id,
        route: meaningShadowRouteEarly,
        classifierEventType: eventType,
        classifierNormalizedHint: normalizedHint,
        gatedMode: gatedDecision.mode,
        openQuestionText: northStarPktForV3.latestOpenQuestion?.trim() || null,
        pendingResolutionKind: commitment.pending_resolution_kind,
        lastOutboundPreview: lastOutboundSmsPreview,
        behaviorStatement: commitment.behavior_statement ?? null,
        plannedInterruptionCategory: plannedInterruptionDetection.reasonCategory ?? null,
      }),
      extraFacts: buildEnrichedMeaningShadowFacts({
        routePurpose: mainInboundLaneRoutePurpose ?? null,
        branchName: commitmentChangeHeuristicContext
          ? "commitment_change_context_heuristic"
          : null,
        openQuestionText: northStarPktForV3.latestOpenQuestion?.trim() || null,
        expectedReplySemantics:
          typeof northStarPktForV3.expectedReplySemantics === "string"
            ? northStarPktForV3.expectedReplySemantics
            : null,
        openQuestionPending: Boolean(northStarPktForV3.latestOpenQuestion?.trim()),
        lastOutboundFullBodyPreview:
          northStarPktForV3.latestOutboundBody?.slice(0, 280) ?? lastOutboundSmsPreview,
        recentTranscriptPreview: mainTranscriptLines.slice(-4).join(" | ").slice(0, 280),
        effectiveAskPreview: effectiveBehavior,
        adaptiveProposalPending: adaptiveProposalPending,
        overlayConsentPending: isV2PendingProposalValid(commitment),
        gatedOutcome: gatedDecision.final_event_type ?? eventType,
      }),
    });

    const laneRes = await produceInboundV3RelationshipSms({
      facts: inboundFacts,
      telemetry_fact_sources: laneTelemetryFactSources,
    });

    if (!laneRes.shouldSend || !laneRes.body.trim()) {
      enrichMeaningInterpreterShadowPending(job.message_sid, {
        deterministicFacts: buildEnrichedMeaningShadowFacts({
          openQuestionText: northStarPktForV3.latestOpenQuestion?.trim() || null,
          expectedReplySemantics:
            typeof northStarPktForV3.expectedReplySemantics === "string"
              ? northStarPktForV3.expectedReplySemantics
              : null,
          openQuestionPending: inboundRelationshipMemoryPacket.open_question_pending,
          openQuestionRoutingMiss: Boolean(northStarPktForV3.latestOpenQuestion?.trim()),
          lastOutboundPreview: lastOutboundSmsPreview,
          lastOutboundFullBodyPreview:
            northStarPktForV3.latestOutboundBody?.slice(0, 280) ?? lastOutboundSmsPreview,
          v3NoSendReason: laneRes.noSendReason ?? null,
          routePurpose: mainInboundLaneRoutePurpose ?? "normal_inbound_reply",
        }),
      });
      await markJobFinal({
        messageSid: job.message_sid,
        status: "cancelled",
        lastError: formatInboundV3LaneNoSendLastError(laneRes),
        nextRetry: farFutureIso(),
      });
      console.warn("[sms-inbound-coach] inbound_relationship_lane_no_send", {
        message_sid: job.message_sid,
        commitment_id: commitment.id,
        reason: laneRes.noSendReason,
      });
      return;
    }

    inboundRelationshipLane = laneRes;

    const ftForBrain = gatedDecision.final_event_type ?? eventType;
    v3BrainPayload = {
      turnPurpose: mapOutcomeToPurpose(ftForBrain),
      confidence:
        laneRes.voiceConfidence != null && laneRes.voiceConfidence >= 0.72 ? "high" : "medium",
      accountabilityEventCandidate: gatedDecision.should_write_outcome_event ? ftForBrain : null,
      shouldWriteOutcomeEvent: gatedDecision.should_write_outcome_event,
      coachReplyDraft: "",
      proofSignal: northStarPktForV3.proofSignal === true,
      learningSignal: deriveV3LearningSignalsFromContext({
        recentEventsNewestFirst: recentEvents,
        coachingMemory: coachingMemoryRow,
        latestInbound: userMessage,
      }),
      metadata: {
        ...laneRes.metadata,
        inbound_v3_relationship_lane: true,
        v3_lane_turn_purpose: laneRes.turnPurpose,
      },
    };
  }

  const priorDraftFromConversationBrain =
    conversationBrainControlTurn != null &&
    typeof conversationBrainControlTurn.guard.final_sms_draft === "string" &&
    conversationBrainControlTurn.guard.final_sms_draft.trim().length > 0
      ? {
          source: "conversation_brain_v1",
          text: conversationBrainControlTurn.guard.final_sms_draft.trim(),
        }
      : null;

  const memorySignalStored =
    memorySignalsEnabled && memorySignalResult != null
      ? buildStoredMemorySignalPayload({ result: memorySignalResult })
      : null;

  if (memorySignalStored != null) {
    if (memorySignalStored.memory_signal_failed === true) {
      console.warn("[v9-memory-signals] failed", {
        commitment_id: commitment.id,
        reason: memorySignalStored.failure_reason,
      });
    } else if (memorySignalStored.memory_signal_detected === true) {
      console.log("[v9-memory-signals] detected", {
        commitment_id: commitment.id,
        type: memorySignalStored.memory_signal_type,
        confidence: memorySignalStored.memory_signal_confidence,
        requires_confirmation: memorySignalStored.requires_user_confirmation,
        sensitive: memorySignalStored.sensitive,
      });
    }
  }

  const nonOutcomeMemoryModes: V2InboundGatedMode[] = [
    "clarify",
    "repair_reply_only",
    "commitment_change_handoff",
    "soft_opt_out_reply",
    "relationship_exit_integrity",
    "identity_edit_integrity",
  ];
  const shouldPersistNonOutcomeMemoryEvent =
    memorySignalStored != null &&
    memorySignalStored.memory_signal_detected === true &&
    !gatedDecision.should_write_outcome_event &&
    nonOutcomeMemoryModes.includes(gatedDecision.mode) &&
    !(openCommitmentChangeHandoff && wave4PendingResult?.pendingApplied === true);

  if (openCommitmentChangeHandoff && handoffCommitmentIntentPack != null) {
    const w4 =
      wave4PendingResult ??
      ({
        pendingApplied: false,
        pendingKind: null,
        skipReason: null,
      } as Awaited<ReturnType<typeof applyWave4SmsCommitmentPendingResolution>>);
    const commitmentChangeFacts = buildCommitmentChangeInboundFactsFromWave4({
      intentPack: handoffCommitmentIntentPack,
      commitment,
      effectiveAsk: effectiveBehavior,
      userMessage,
      messageSid: job.message_sid,
      wave4: w4,
      pendingResolutionApplyException: wave4PendingResolutionApplyException,
      legacyCommitmentChangeReplyPreview: buildSmsCommitmentChangeCoachReply(handoffCommitmentIntentPack),
      bootstrapResult: commitmentChangeBootstrapResult
        ? {
            promoted: commitmentChangeBootstrapResult.promoted,
            candidatePreview: commitmentChangeBootstrapResult.candidate,
          }
        : null,
    });
    await persistCommitmentChangeHandoffLaneAndSend({
      job,
      userId,
      commitment,
      timezone,
      inboundRaw: userMessage,
      splitSuppressedMessageSids,
      gatedDecision,
      deterministicEventType: eventType,
      commitmentChangeFacts,
      wave4PendingResult: w4,
      shouldPersistNonOutcomeMemoryEvent,
      memorySignalStored,
    });
    return;
  }

  let usedLegacyResolveHint = false;

  let resolved;
  let replyBody: string;
  let effectiveInboundReplySource: string;
  let forcedCoachSms: string | null = null;
  let wave11SnippetForPreserve: string | null = null;
  let wave11ConfirmationPayload:
    | {
        memory_confirmation_pending: true;
        pending_memory_kind: Wave11PendingMemoryKind;
        candidate_identity_anchor_text?: string | null;
        candidate_people_summary?: string | null;
        candidate_responsibility?: string | null;
        confirmation_question: string;
        expires_at: string;
        source_message_sid: string;
        status: "awaiting_confirmation";
      }
    | undefined;
  let finalReplyBody: string;

  if (inboundRelationshipLane) {
    const lane = inboundRelationshipLane;
    resolved = {
      replyBody: lane.body,
      meta: {
        reply_source: "v3_inbound_relationship_lane",
        reply_mode: gatedDecision.mode,
        suggested_reply_used: false,
        suggested_reply_rejected_reason: null,
        final_event_type: gatedDecision.final_event_type ?? eventType,
        gated_mode: gatedDecision.mode,
      },
      aiTry: lane.openAiOk
        ? {
            ok: true as const,
            message: lane.body,
            confidence: lane.voiceConfidence,
            fallbackUsed: false as const,
          }
        : {
            ok: false as const,
            fallbackUsed: true as const,
            reason: "inbound_v3_lane",
          },
      replyTemplateId: undefined,
    };
    forcedCoachSms = null;
    replyBody = lane.body;
    effectiveInboundReplySource = "v3_inbound_relationship_lane";
    finalReplyBody = replyBody;
  } else {
    /**
     * DOCUMENTED EXCEPTION — Phase 3G-1: legacy inbound composer is allowed only for
     * `isInboundTransactionalException` (compliance / STOP / HELP style turns).
     * Active-commitment coaching must use `produceInboundV3RelationshipSms` above.
     */
    if (!isInboundTransactionalException) {
      await markJobFinal({
        messageSid: job.message_sid,
        status: "cancelled",
        lastError: JSON.stringify({
          tag: "inbound_active_coaching_legacy_else_invariant",
          detail:
            "non_transactional_inbound_reached_legacy_else_without_inboundRelationshipLane; expected main inbound V3 relationship lane",
          commitment_id: commitment.id,
          gated_mode: gatedDecision.mode,
          heuristic_commitment_change_intent: isLikelyCommitmentChangeIntentTurn(userMessage),
        }).slice(0, 1900),
        nextRetry: farFutureIso(),
      });
      console.error("[sms-inbound-coach] inbound_active_coaching_legacy_else_invariant", {
        message_sid: job.message_sid,
        commitment_id: commitment.id,
        gated_mode: gatedDecision.mode,
      });
      return;
    }

  if (v3DraftAttempt == null && normalCoachingV3Eligible) {
    const legacyResolved = await resolveV2InboundCoachReplyBody({
      gatedEnabled,
      gatedDecision,
      interpretation: shadowInterpretationRaw,
      deterministicEventType: eventType,
      userMessage,
      preferredName,
      messageSid: job.message_sid,
      effectiveAsk: effectiveBehavior,
      behaviorStatement: commitment.behavior_statement,
      trySuggestedWhenAgrees: needInterpretation && !gatedEnabled,
      commitmentChangeWave4Body: undefined,
      buildOutcomeAi: async () => {
        const finalEventType = gatedDecision.final_event_type ?? eventType;
        const serverStrategy = strategyForInboundEventType(finalEventType);
        return tryGenerateV2InboundMessage({
          commitment,
          eventType: finalEventType,
          serverStrategy,
          userMessage,
          normalizedHint,
          eventsNewestFirst: recentEvents,
          coachingMemory: coachingMemoryRow,
          preferredName,
          lifeDesires: null,
          peopleSummary,
          responsibility,
          identityAnchorText,
          identityRefreshDue,
          identityReferenceAllowed,
          afterSilence,
          lastOutboundNextMove,
          ...(brokePause ? { brokePause: true } : {}),
          ...(afterSilence
            ? {
                unansweredChecks: silenceCtx.unanswered_checks,
                daysIdle: silenceCtx.days_since_last_user_outcome,
              }
            : {}),
          recentSmsContextBlock: smsConvPackBlock,
          proofMomentForPrompt: proofPromptHint,
        });
      },
      buildTemplate: (finalType) =>
        buildV2InboundReplySms({
          behaviorStatement: effectiveBehavior,
          messageSid: job.message_sid,
          eventType: finalType,
          preferredName,
        }),
    });
    try {
      const linesLegacy = buildMinimalInboundTranscriptLines(
        convPackFull,
        userMessage,
        lastOutboundSmsPreview
      );
      const rec = await recoverV3InboundCoachDraftFromArgs({
        userMessage,
        messageSid: job.message_sid,
        commitment,
        effectiveAsk: effectiveBehavior,
        timezone,
        northStarPacket: northStarPktForV3,
        convPackRecentLines: linesLegacy,
        expectedReplySemantics: northStarPktForV3.expectedReplySemantics as ExpectedReplySemanticsV3,
        latestOpenQuestion: northStarPktForV3.latestOpenQuestion ?? null,
        todayCompleted: priorYesForV3,
        coachingMemory: coachingMemoryRow,
        recentEvents,
        gatedDecision,
        deterministicEventType: eventType,
        priorDraftHint: { source: "legacy_resolve_hint", text: legacyResolved.replyBody },
      });
      v3DraftAttempt = rec;
      v3BrainPayload = rec.brain;
      usedLegacyResolveHint = true;
    } catch (eL) {
      console.error("[v3-sms-brain] legacy_hint_recovery_failed", {
        commitment_id: commitment.id,
        message: eL instanceof Error ? eL.message : String(eL),
      });
    }
  }

  if (v3DraftAttempt == null && normalCoachingV3Eligible) {
    try {
      const linesBare = buildMinimalInboundTranscriptLines(
        convPackFull,
        userMessage,
        lastOutboundSmsPreview
      );
      const bare = await recoverV3InboundCoachDraftFromArgs({
        userMessage,
        messageSid: job.message_sid,
        commitment,
        effectiveAsk: effectiveBehavior,
        timezone,
        northStarPacket: northStarPktForV3,
        convPackRecentLines: linesBare,
        expectedReplySemantics: northStarPktForV3.expectedReplySemantics as ExpectedReplySemanticsV3,
        latestOpenQuestion: northStarPktForV3.latestOpenQuestion ?? null,
        todayCompleted: priorYesForV3,
        coachingMemory: coachingMemoryRow,
        recentEvents,
        gatedDecision,
        deterministicEventType: eventType,
        priorDraftHint: undefined,
      });
      v3DraftAttempt = bare;
      v3BrainPayload = bare.brain;
    } catch (eBare) {
      console.error("[v3-sms-brain] bare_deterministic_recovery_failed", {
        commitment_id: commitment.id,
        message: eBare instanceof Error ? eBare.message : String(eBare),
      });
    }
  }

  if (v3DraftAttempt == null && normalCoachingV3Eligible) {
    const linesGuaranteed = buildMinimalInboundTranscriptLines(
      convPackFull,
      userMessage,
      lastOutboundSmsPreview
    );
    const syn = guaranteeV3InboundCoachDraft({
      userMessage,
      messageSid: job.message_sid,
      commitment,
      effectiveAsk: effectiveBehavior,
      timezone,
      northStarPacket: northStarPktForV3,
      convPackRecentLines: linesGuaranteed,
      expectedReplySemantics: northStarPktForV3.expectedReplySemantics as ExpectedReplySemanticsV3,
      latestOpenQuestion: northStarPktForV3.latestOpenQuestion ?? null,
      todayCompleted: priorYesForV3,
      coachingMemory: coachingMemoryRow,
      recentEvents,
      gatedDecision,
      deterministicEventType: eventType,
      priorDraftHint: undefined,
    });
    v3DraftAttempt = syn;
    v3BrainPayload = syn.brain;
  }

  const hadPriorHintForSource = Boolean(priorDraftFromConversationBrain || usedLegacyResolveHint);

  // 5) Final SMS body — legacy banks only when not normal coaching (compliance / pure transactional slices).
  const trySuggestedWhenAgrees = needInterpretation && !gatedEnabled;
  resolved =
    v3DraftAttempt != null
      ? {
          replyBody: v3DraftAttempt.draft,
          meta: {
            reply_source: inferV3InboundReplySource(
              v3DraftAttempt.brain,
              v3DraftAttempt.openAiOk,
              hadPriorHintForSource
            ),
            reply_mode: gatedDecision.mode,
            suggested_reply_used: false,
            suggested_reply_rejected_reason: null,
            final_event_type: gatedDecision.final_event_type ?? eventType,
            gated_mode: gatedDecision.mode,
          },
          aiTry: v3DraftAttempt.openAiOk
            ? {
                ok: true as const,
                message: v3DraftAttempt.draft,
                confidence: null,
                fallbackUsed: false as const,
              }
            : {
                ok: false as const,
                fallbackUsed: true as const,
                reason: "v3_brain_fallback",
              },
          replyTemplateId: undefined,
        }
      : await resolveV2InboundCoachReplyBody({
          gatedEnabled,
          gatedDecision,
          interpretation: shadowInterpretationRaw,
          deterministicEventType: eventType,
          userMessage,
          preferredName,
          messageSid: job.message_sid,
          effectiveAsk: effectiveBehavior,
          behaviorStatement: commitment.behavior_statement,
          trySuggestedWhenAgrees,
          commitmentChangeWave4Body: undefined,
          buildOutcomeAi: async () => {
            const finalEventType = gatedDecision.final_event_type ?? eventType;
            const serverStrategy = strategyForInboundEventType(finalEventType);
            return tryGenerateV2InboundMessage({
              commitment,
              eventType: finalEventType,
              serverStrategy,
              userMessage,
              normalizedHint,
              eventsNewestFirst: recentEvents,
              coachingMemory: coachingMemoryRow,
              preferredName,
              lifeDesires: null,
              peopleSummary,
              responsibility,
              identityAnchorText,
              identityRefreshDue,
              identityReferenceAllowed,
              afterSilence,
              lastOutboundNextMove,
              ...(brokePause ? { brokePause: true } : {}),
              ...(afterSilence
                ? {
                    unansweredChecks: silenceCtx.unanswered_checks,
                    daysIdle: silenceCtx.days_since_last_user_outcome,
                  }
                : {}),
              recentSmsContextBlock: smsConvPackBlock,
              proofMomentForPrompt: proofPromptHint,
            });
          },
          buildTemplate: (finalType) =>
            buildV2InboundReplySms({
              behaviorStatement: effectiveBehavior,
              messageSid: job.message_sid,
              eventType: finalType,
              preferredName,
            }),
        });

  forcedCoachSms =
    conversationBrainControlTurn == null
      ? tryBuildForcedInboundCoachSms({
          userMessage,
          gatedDecision,
          lastOutboundSmsPreview,
          eventsNewestFirst: recentEvents,
          effectiveAskFloor: effectiveBehavior,
          messageSid: job.message_sid,
        })
      : null;

  if (forcedCoachSms) {
    console.info("[v2-inbound-coach] forced_future_stretch_coach_sms", {
      commitment_id: commitment.id,
      message_sid: job.message_sid,
      decision_reason: gatedDecision.decision_reason,
    });
  }

  replyBody = forcedCoachSms ?? resolved.replyBody;
  effectiveInboundReplySource = resolved.meta.reply_source;

  if (forcedCoachSms && normalCoachingV3Eligible) {
    const linesForcedStretch = buildMinimalInboundTranscriptLines(
      convPackFull,
      userMessage,
      lastOutboundSmsPreview
    );
    try {
      const fr = await produceV3InboundCoachDraft({
        userMessage,
        messageSid: job.message_sid,
        commitment,
        effectiveAsk: effectiveBehavior,
        timezone,
        northStarPacket: northStarPktForV3,
        convPackRecentLines: linesForcedStretch,
        expectedReplySemantics: northStarPktForV3.expectedReplySemantics as ExpectedReplySemanticsV3,
        latestOpenQuestion: northStarPktForV3.latestOpenQuestion ?? null,
        todayCompleted: priorYesForV3,
        coachingMemory: coachingMemoryRow,
        recentEvents,
        gatedDecision,
        deterministicEventType: eventType,
        priorDraftHint: { source: "forced_future_stretch_intent", text: forcedCoachSms },
      });
      replyBody = fr.draft;
      effectiveInboundReplySource = inferV3InboundReplySource(fr.brain, fr.openAiOk, true);
    } catch (e) {
      console.warn("[v3-sms-brain] forced_stretch_refine_failed", {
        commitment_id: commitment.id,
        message: e instanceof Error ? e.message : String(e),
      });
      try {
        const fr = await recoverV3InboundCoachDraftFromArgs({
          userMessage,
          messageSid: job.message_sid,
          commitment,
          effectiveAsk: effectiveBehavior,
          timezone,
          northStarPacket: northStarPktForV3,
          convPackRecentLines: linesForcedStretch,
          expectedReplySemantics: northStarPktForV3.expectedReplySemantics as ExpectedReplySemanticsV3,
          latestOpenQuestion: northStarPktForV3.latestOpenQuestion ?? null,
          todayCompleted: priorYesForV3,
          coachingMemory: coachingMemoryRow,
          recentEvents,
          gatedDecision,
          deterministicEventType: eventType,
          priorDraftHint: { source: "forced_future_stretch_intent", text: forcedCoachSms },
        });
        replyBody = fr.draft;
        effectiveInboundReplySource = inferV3InboundReplySource(fr.brain, fr.openAiOk, true);
      } catch (e2) {
        console.warn("[v3-sms-brain] forced_stretch_recover_failed", {
          commitment_id: commitment.id,
          message: e2 instanceof Error ? e2.message : String(e2),
        });
      }
    }
  }

  if (
    isV2HumanSmsPhase2NormalInboundEnabled() &&
    !normalCoachingV3Eligible &&
    !isV3OwnedInboundReplySource(effectiveInboundReplySource) &&
    conversationBrainControlTurn == null &&
    v3DraftAttempt == null
  ) {
    warnIfPhase2BrainWithoutValidatorEnforce();
    const unknownOutcome = shouldSkipPhase2BrainForUnknownOutcomeEvent({
      gatedDecision,
      deterministicEventType: eventType,
    });
    if (unknownOutcome.skip) {
      console.info("[human_visible_sms_pipeline]", {
        event: "human_visible_sms_pipeline",
        path: "normal_inbound",
        brain_skipped_reason: "unknown_outcome_event_type",
        outcome_type_key_hash: unknownOutcome.outcomeTypeKeyHash,
        phase2_flag: true,
      });
    } else {
      const brainCase = deriveNormalInboundBrainCase({
        gatedDecision,
        deterministicEventType: eventType,
        replyMode: resolved.meta.reply_mode ?? gatedDecision.mode,
      });
      const outcomeKeyForLog = `${gatedDecision.mode}:${String(resolved.meta.final_event_type ?? "none")}:${resolved.meta.reply_mode ?? gatedDecision.mode}`;
      const serverStrategyForBrain =
        resolved.meta.final_event_type != null
          ? strategyForInboundEventType(resolved.meta.final_event_type)
          : "non_outcome";

      const finalized = await finalizeNormalInboundHumanSms({
        machineDraft: replyBody,
        brainCase,
        outcomeKeyForLog,
        userInboundRaw: userMessage,
        skipBrainRewrite: forcedCoachSms != null,
        brainContext: {
          normalInbound: {
            userReplyPreview: userMessage.slice(0, 280),
            effectiveAskPreview: effectiveBehavior.slice(0, 200),
            behaviorStatementPreview: commitment.behavior_statement?.trim().slice(0, 200) ?? null,
            finalEventType: resolved.meta.final_event_type,
            serverStrategy: serverStrategyForBrain,
            gatedMode: gatedDecision.mode,
            replySource: resolved.meta.reply_source,
            replyMode: resolved.meta.reply_mode ?? gatedDecision.mode,
            latestBlockerPreview,
            recentSmsContextPreview: smsConvPackBlock?.slice(0, 1200) ?? null,
            coachingMemoryPreview: formatCoachingMemoryPromptBlock(coachingMemoryRow).slice(0, 1200),
            identityAnchorPreview:
              identityReferenceAllowed && identityAnchorText
                ? identityAnchorText.slice(0, 160)
                : null,
          },
        },
      });
      replyBody = finalized.message;
    }
  }

  replyBody = appendCommitmentChangeNoteIfNeeded(replyBody, gatedDecision);

  finalReplyBody = replyBody;
  wave11SnippetForPreserve = null;
  wave11ConfirmationPayload = undefined;

  const parsedMem = memorySignalResult?.ok === true ? memorySignalResult.data : null;

  if (shouldPersistNonOutcomeMemoryEvent && parsedMem != null && memorySignalStored != null) {
    const identityCand = parsedMem.candidate_profile_updates.identity_anchor_text;
    const idVal = identityCand != null ? validateOnboardingIdentityAnchorInput(identityCand) : null;
    const identityOk = idVal?.ok === true;
    const identityNormalized = idVal?.ok === true ? idVal.normalized : null;

    const relPeople = conservativeRelationshipCandidate(parsedMem.candidate_profile_updates.people_summary);
    const relResp = conservativeRelationshipCandidate(parsedMem.candidate_profile_updates.responsibility);
    const relationshipOk = Boolean(relPeople || relResp);

    const signalType =
      typeof memorySignalStored.memory_signal_type === "string" ? memorySignalStored.memory_signal_type : "none";
    const conf =
      typeof memorySignalStored.memory_signal_confidence === "number"
        ? memorySignalStored.memory_signal_confidence
        : 0;

    const pendingKind: Wave11PendingMemoryKind | null =
      signalType === "identity_shift"
        ? "identity_anchor_update"
        : signalType === "relationship_context_changed"
          ? "relationship_context_update"
          : null;

    const qtext =
      pendingKind != null
        ? buildWave11MemoryConfirmationQuestion({
            pendingKind,
            confirmationQuestionPreview: parsedMem.confirmation_question,
            sensitive: parsedMem.sensitive,
            shouldNotQuoteDirectly: parsedMem.should_not_quote_directly,
            candidateIdentityAnchor: identityCand,
          })
        : null;

    const offer =
      qtext != null &&
      pendingKind != null &&
      wave11ShouldOfferConfirmationOffer({
        memoryDetected: memorySignalStored.memory_signal_detected === true,
        requiresConfirmation: memorySignalStored.requires_user_confirmation === true,
        confidence: conf,
        signalType,
        shouldWriteOutcome: gatedDecision.should_write_outcome_event,
        gatedMode: gatedDecision.mode,
        identityCandidateOk: pendingKind === "identity_anchor_update" ? identityOk : false,
        relationshipCandidateOk: pendingKind === "relationship_context_update" ? relationshipOk : false,
        hasAwaitingPending: pendingAwaitingMemoryConfirmation != null,
      });

    if (offer) {
      const appended = wave11AppendConfirmationIfFits(replyBody, qtext);
      if (appended) {
        finalReplyBody = appended;
        wave11SnippetForPreserve = qtext;
        wave11ConfirmationPayload = {
          memory_confirmation_pending: true,
          pending_memory_kind: pendingKind,
          candidate_identity_anchor_text:
            pendingKind === "identity_anchor_update" ? identityNormalized : null,
          candidate_people_summary: pendingKind === "relationship_context_update" ? relPeople : null,
          candidate_responsibility: pendingKind === "relationship_context_update" ? relResp : null,
          confirmation_question: qtext,
          expires_at: new Date(Date.now() + WAVE11_MEMORY_CONFIRMATION_TTL_MS).toISOString(),
          source_message_sid: job.message_sid,
          status: "awaiting_confirmation",
        };
      }
    }
  }

  if (
    shouldRunPhase5aInboundStitchedFinalBrain() &&
    !normalCoachingV3Eligible &&
    !isV3OwnedInboundReplySource(effectiveInboundReplySource) &&
    conversationBrainControlTurn == null &&
    v3DraftAttempt == null
  ) {
    const preservationSnippets: string[] = [];
    if (gatedDecision.supplement_commitment_change_guidance) {
      preservationSnippets.push(COMMITMENT_APPEND_FOR_SCORED);
    }
    if (wave11SnippetForPreserve?.trim()) {
      preservationSnippets.push(wave11SnippetForPreserve.trim());
    }
    const stitchedFin = await finalizePhase5aInboundStitchedFinalHumanSms({
      machineDraft: finalReplyBody,
      preservationSnippets,
      appendSegments: {
        wave11: wave11SnippetForPreserve != null,
        victory: false,
        commitment_note: Boolean(gatedDecision.supplement_commitment_change_guidance),
      },
      allowVictoryRoomPhrase: false,
      maxChars: 320,
    });
    finalReplyBody = stitchedFin.message;
  }

  }

  if (v3BrainPayload?.learningSignal && normalCoachingV3Eligible) {
    const nbExtra = buildV1ExtraNotebookAppend({
      learning: v3BrainPayload.learningSignal,
      outcomeHint:
        gatedDecision.final_event_type === "user_yes"
          ? "user_yes"
          : gatedDecision.final_event_type === "user_no"
            ? "user_no"
            : gatedDecision.final_event_type === "user_partial"
              ? "user_partial"
              : null,
      inboundRaw: userMessage,
    });
    if (nbExtra?.trim()) {
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "v3_v1_learning_signals",
        v3LearningNotebookAppend: nbExtra,
      });
    }
  }

  const northStarInboundContextPacket = buildInboundNorthStarContextPacket({
    commitmentId: commitment.id,
    behaviorStatement: commitment.behavior_statement ?? "",
    effectiveAskText: effectiveBehavior,
    timezone,
    userMessage,
    lastOutboundSmsPreview,
    checkPayload: (checkPayload ?? {}) as Record<string, unknown>,
    recentEvents,
    convPack: convPackFull,
    coachingMemory: coachingMemoryRow,
    finalEventType: resolved.meta.final_event_type ?? null,
    lifeDesires: null,
    peopleSummary,
    identityAnchorText,
    latestBlockerPreview,
    proofDisplayedOrMoment: Boolean(accountabilityProofMoment),
  });

  const northStarInboundPack = await finalizeNorthStarInboundCoachReplyAsync({
    proposedBody: finalReplyBody,
    ctx: {
      userMessage,
      lastOutboundSmsPreview,
      effectiveBehavior,
      behaviorStatement: commitment.behavior_statement,
      finalEventType: resolved.meta.final_event_type ?? null,
      replySource: effectiveInboundReplySource,
      contextPacket: northStarInboundContextPacket,
    },
  });
  finalReplyBody = northStarInboundPack.visibleBody;

  const finalVoiceGate = await applyFinalVoiceOwnershipGate({
    proposedBody: finalReplyBody,
    replySource: effectiveInboundReplySource ?? resolved.meta.reply_source,
    channel: "inbound_coach_reply",
    activeCommitmentId: commitment.id,
    effectiveAsk: effectiveBehavior,
    behaviorStatement: commitment.behavior_statement,
    latestInboundRaw: userMessage,
    latestOutboundBody: lastOutboundSmsPreview,
    latestOpenQuestion: northStarInboundContextPacket.latestOpenQuestion ?? null,
    contextPacket: northStarInboundContextPacket,
    todayCompleted: northStarInboundContextPacket.todayCompleted ?? null,
    finalEventType: resolved.meta.final_event_type ?? null,
    v3BrainMetadata: v3BrainPayload?.metadata ?? null,
    northStarMeta: northStarInboundPack.meta,
    normalCoaching: true,
  });
  finalReplyBody = finalVoiceGate.body;

  const aiTry = resolved.aiTry;
  const replyTemplateId = resolved.replyTemplateId;
  const replyResolutionMeta = resolved.meta;

  const inboundAiModelUsed =
    conversationBrainControlTurn != null && v3DraftAttempt == null
      ? conversationBrainControlTurn.model
      : V2_INBOUND_AI_MODEL;
  const inboundAiPromptVersionUsed =
    conversationBrainControlTurn != null && v3DraftAttempt == null
      ? V2_SMS_CONVERSATION_BRAIN_PROMPT_VERSION
      : V2_INBOUND_AI_PROMPT_VERSION;

  const conversationBrainSpineMeta =
    conversationBrainControlTurn != null
      ? {
          enabled: true as const,
          model: conversationBrainControlTurn.model,
          guardrail_status: conversationBrainControlTurn.guard.status,
          guardrail_reason: conversationBrainControlTurn.guard.guardrail_reason,
          turn_kind: conversationBrainControlTurn.proposal.turn_kind,
          outcome_confidence: conversationBrainControlTurn.proposal.outcome_confidence,
          reply_strategy: conversationBrainControlTurn.proposal.reply_strategy,
          needs_clarification: conversationBrainControlTurn.proposal.needs_clarification,
          repeated_clarification_risk: conversationBrainControlTurn.proposal.repeated_clarification_risk,
          short_reason_for_logs: conversationBrainControlTurn.proposal.short_reason_for_logs,
        }
      : null;

  const repairPayload =
    gatedDecision.should_write_outcome_event &&
    gatedDecision.reply_style === "repair" &&
    gatedDecision.mode === "use_ai_outcome"
      ? {
          source: "ai_gated_repair_v1",
          ai_repair_of:
            shadowInterpretationRaw?.ok === true ? shadowInterpretationRaw.data.repair_of : null,
          note: gatedDecision.repair_note ?? null,
        }
      : null;

  const gatedPayloadRecord = buildAiGatedDecisionPayload({
    enabled: gatedEnabled,
    decision: gatedDecision,
    deterministicEventType: eventType,
    deterministicNormalizedHint: normalizedHint ?? null,
    repairContext: repairPayload,
  });

  const replyResolutionPayload = {
    reply_source: replyResolutionMeta.reply_source,
    reply_mode: replyResolutionMeta.reply_mode,
    suggested_reply_used: replyResolutionMeta.suggested_reply_used,
    suggested_reply_rejected_reason: replyResolutionMeta.suggested_reply_rejected_reason,
    final_event_type: replyResolutionMeta.final_event_type,
    gated_mode: replyResolutionMeta.gated_mode,
  };

  const northStarGateTelemetry: Record<string, unknown> = {
    original_body: northStarInboundPack.meta.originalBody,
    final_body: northStarInboundPack.visibleBody,
    north_star_gate_source: northStarInboundPack.meta.source,
    north_star_gate_reasons: northStarInboundPack.meta.blockedReasons,
    ...pickNorthStarWriterAttributionFields(northStarInboundPack.meta),
    ...(northStarInboundPack.meta.north_star_structural_replacement
      ? { north_star_structural_replacement: true }
      : {}),
    ...(northStarInboundPack.meta.repeated_question_guard_fired
      ? {
          repeated_question_guard_fired: northStarInboundPack.meta.repeated_question_guard_fired,
          repeated_question_original: northStarInboundPack.meta.repeated_question_original,
          repeated_question_replacement: northStarInboundPack.meta.repeated_question_replacement,
        }
      : {}),
    final_voice_gate: finalVoiceGate.metadata,
  };

  const inboundPacketObservability =
    v3BrainPayload?.metadata != null && typeof v3BrainPayload.metadata === "object"
      ? relationshipObservabilityFromLaneMetadata(v3BrainPayload.metadata)
      : inboundRelationshipLane?.metadata != null
        ? relationshipObservabilityFromLaneMetadata(inboundRelationshipLane.metadata)
        : {};

  const v3BrainEventMeta =
    v3BrainPayload != null
      ? {
          ...buildV3BrainMetadata({
            brain: v3BrainPayload,
            latestOpenQuestion: northStarPktForV3.latestOpenQuestion ?? null,
            expectedSemantics:
              typeof northStarPktForV3.expectedReplySemantics === "string"
                ? northStarPktForV3.expectedReplySemantics
                : null,
            coachReplySource:
              effectiveInboundReplySource ?? replyResolutionMeta.reply_source ?? "v3_sms_brain",
            northStarGate: northStarGateTelemetry,
            priorDraftSource: priorDraftFromConversationBrain?.source ?? null,
          }),
          ...(Object.keys(inboundPacketObservability).length > 0
            ? { relationship_packet_observability: inboundPacketObservability }
            : {}),
          ...(inboundCoachingBriefV1Log != null
            ? { coaching_brief_v1: inboundCoachingBriefV1Log }
            : {}),
        }
      : null;

  const aiPayload =
    gatedDecision.should_write_outcome_event && gatedDecision.final_event_type
      ? {
          ...buildUserReplyAiPayload({
            model: inboundAiModelUsed,
            promptVersion: inboundAiPromptVersionUsed,
            serverStrategy: strategyForInboundEventType(gatedDecision.final_event_type),
            message: finalReplyBody,
            confidence: aiTry.ok ? aiTry.confidence : null,
            fallbackUsed: !aiTry.ok,
            fallbackReason: !aiTry.ok ? aiTry.reason : null,
            smsContextPackMeta: smsConvPackMeta ?? undefined,
          }),
          reply_resolution: replyResolutionPayload,
          north_star_gate: northStarGateTelemetry,
          final_voice_gate: finalVoiceGate.metadata,
          ...(Object.keys(inboundPacketObservability).length > 0
            ? { relationship_packet_observability: inboundPacketObservability }
            : {}),
        }
      : {
          model: inboundAiModelUsed,
          prompt_version: inboundAiPromptVersionUsed,
          server_strategy: "gated_non_outcome",
          message: finalReplyBody,
          confidence: null,
          fallback_used: true,
          fallback_reason: gatedDecision.mode,
          reply_resolution: replyResolutionPayload,
          north_star_gate: northStarGateTelemetry,
          final_voice_gate: finalVoiceGate.metadata,
          ...(Object.keys(inboundPacketObservability).length > 0
            ? { relationship_packet_observability: inboundPacketObservability }
            : {}),
        };

  if (
    wave4PendingResult?.pendingApplied &&
    memorySignalStored != null &&
    memorySignalStored.memory_signal_detected === true &&
    gatedDecision.mode === "commitment_change_handoff"
  ) {
    const mergedPr = await mergeSmsPendingResolutionPayload({
      commitmentId: commitment.id,
      merge: (prev) => ({
        ...prev,
        memory_signal_snapshot: pickBoundedMemorySnapshotForPending(memorySignalStored),
        last_inbound_memory_signal_at: new Date().toISOString(),
      }),
    });
    if (!mergedPr.ok) {
      console.warn("[v9.1-memory-signals] pending_payload_merge_failed", {
        commitment_id: commitment.id,
        error: mergedPr.error,
      });
    }
  }

  // Wave 9.2: sms_memory_signal rows require migration 20260430120000; insert is additive / non-blocking.
  if (shouldPersistNonOutcomeMemoryEvent && memorySignalStored != null) {
    await insertV2SmsMemorySignalEvent({
      commitmentId: commitment.id,
      clerkUserId: userId,
      messageSid: job.message_sid,
      messagePreview: userMessage,
      gatedMode: gatedDecision.mode,
      memorySignal: memorySignalStored,
      ...(wave11ConfirmationPayload != null
        ? { wave11ConfirmationPending: wave11ConfirmationPayload }
        : {}),
    });
  }

  // 6) Accountability event spine — persist before send when appropriate.
  const spinePayloadExtras: Record<string, unknown> = {
    ...(!aiTry.ok && replyTemplateId != null ? { reply_template_id: replyTemplateId } : {}),
    ...(afterSilence
      ? {
          reentry_context: {
            after_silence: true,
            unanswered_checks: silenceCtx.unanswered_checks,
            days_idle: silenceCtx.days_since_last_user_outcome,
          },
        }
      : {}),
    ...(shadowInterpretationStored != null ? { shadow_interpretation: shadowInterpretationStored } : {}),
    ...(gatedPayloadRecord != null ? { ai_gated_decision: gatedPayloadRecord } : {}),
    ...(repairPayload != null ? { repair_context: repairPayload } : {}),
    ...(memorySignalStored != null ? { memory_signal: memorySignalStored } : {}),
    ...(centralSmsTurnShadowStored != null ? { central_sms_turn_shadow: centralSmsTurnShadowStored } : {}),
    ...(v3BrainEventMeta != null ? { v3_brain: v3BrainEventMeta } : {}),
    ai: aiPayload,
    ...(conversationBrainSpineMeta != null ? { conversation_brain_v1: conversationBrainSpineMeta } : {}),
  };

  const persistResult = await tryPersistInboundAccountabilityOutcomeBeforeSend({
    branch: "main",
    job,
    userId,
    commitment,
    userMessage,
    eventType,
    normalizedHint,
    gatedDecision,
    recentEvents,
    effectiveBehavior,
    proofMeta: accountabilityProofMoment,
    payloadJson: spinePayloadExtras,
    throwOnPersistError: gatedDecision.should_write_outcome_event,
  });

  const spineInsertSucceeded = persistResult.status === "inserted";
  const resolvedSpineEventType =
    persistResult.status === "inserted" || persistResult.status === "duplicate"
      ? persistResult.eventType
      : (gatedDecision.final_event_type ?? eventType);

  if (spineInsertSucceeded) {
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    maybeLogCentralBrainDisagreement({
      commitmentId: commitment.id,
      stored: centralSmsTurnShadowStored ?? undefined,
      spineEventType: resolvedSpineEventType,
      shouldWriteOutcome: gatedDecision.should_write_outcome_event,
    });
  }

  if (spineInsertSucceeded && proofCalloutHint?.eligible) {
    const idempotencyKey = v2UserReplyIdempotencyKey(
      resolvedSpineEventType as V2AccountabilityOutcome,
      job.message_sid
    );
    await patchVictoryCalloutOnSpineEventBestEffort({
      idempotencyKey,
      spineExtras: {
        proof_callout_hint_offered_to_model: true,
        proof_callout_reason: proofCalloutHint.reason,
      },
    });
  }

  const outcomeNotebook =
    v3BrainPayload?.learningSignal?.confidence != null &&
    v3BrainPayload.learningSignal.confidence >= 0.48 &&
    (v3BrainPayload.learningSignal.blockerPattern ||
      v3BrainPayload.learningSignal.workingCondition ||
      v3BrainPayload.learningSignal.currentExperiment)
      ? buildV3LearningNotebookLine(v3BrainPayload.learningSignal!, userMessage)
      : null;

  if (gatedDecision.should_write_outcome_event || spineInsertSucceeded) {
    await recomputeV2CoachingMemory(commitment.id, {
      reasonCode: "inbound_user_outcome",
      ...(outcomeNotebook ? { v3LearningNotebookAppend: outcomeNotebook } : {}),
    });

    if (gatedDecision.should_open_blocker_capture) {
      await setBlockerCapturePending(
        commitment.id,
        (gatedDecision.final_event_type ?? eventType) as V2AccountabilityOutcome
      );
    }
  } else {
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    const nonOutcomeNotebook =
      !gatedDecision.should_write_outcome_event &&
      v3BrainPayload?.learningSignal?.confidence != null &&
      v3BrainPayload.learningSignal.confidence >= 0.48 &&
      (v3BrainPayload.learningSignal.blockerPattern ||
        v3BrainPayload.learningSignal.workingCondition ||
        v3BrainPayload.learningSignal.currentExperiment)
        ? buildV3LearningNotebookLine(v3BrainPayload.learningSignal!, userMessage)
        : null;
    if (nonOutcomeNotebook) {
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "v3_non_outcome_learning_notebook",
        v3LearningNotebookAppend: nonOutcomeNotebook,
      });
    }
  }

  // 7) Job reply → shared send pipeline.
  if (!finalVoiceGate.shouldSend) {
    await markJobFinal({
      messageSid: job.message_sid,
      status: "cancelled",
      lastError: finalVoiceSkipLastError(
        finalVoiceGate,
        inboundRelationshipLane != null ? { inbound_v3_lane_metadata: inboundRelationshipLane.metadata } : null
      ),
      nextRetry: farFutureIso(),
    });
    console.warn("[sms-inbound-coach] normal_inbound_final_voice_suppressed", {
      message_sid: job.message_sid,
      commitment_id: commitment.id,
      skip_reason: finalVoiceGate.skipReason ?? null,
    });
    return;
  }

  const now = new Date().toISOString();
  const { data: persisted } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      reply_body: finalReplyBody,
      status: "reply_ready",
      next_retry_at: now,
      updated_at: now,
      last_error: null,
    })
    .eq("message_sid", job.message_sid)
    .eq("status", "processing")
    .select()
    .maybeSingle();

  const commsPrefAction = commsPrefsTurn?.parse.action ?? "none";
  let meaningShadow: MeaningInterpreterShadowScheduleArgs;
  if (commsPrefAction !== "none" && commsPrefAction !== "clarify" && commsPrefsTurn) {
    const commsBuilt = buildInboundCommsPreferenceV3Facts({
      snapshot: commsPrefsTurn,
      row: commsPrefsTurn.rowAfter,
    });
    meaningShadow = buildCommsPreferenceMeaningShadow({
      commitmentId: commitment.id,
      classifierEventType: eventType,
      commsPreferenceAction: commsPrefAction,
      pauseActive: commsBuilt.pause_active,
      cadenceOverride: commsBuilt.cadence_override,
      weekendSendPolicy: commsBuilt.weekend_send_policy,
    });
  } else {
    const meaningShadowRoute = resolveNormalInboundMeaningShadowRoute({
      mainInboundLaneRoutePurpose: relationshipExitLaneActive
        ? "relationship_exit_integrity"
        : identityEditLaneActive
          ? "identity_edit_integrity"
          : undefined,
      gatedMode: gatedDecision.mode,
      plannedInterruptionActive: plannedInterruptionActionable,
      forcedFutureStretchActive: Boolean(forcedCoachSms),
      commsPreferenceAction: commsPrefAction,
    });
    meaningShadow = buildNormalLaneMeaningShadow({
      commitmentId: commitment.id,
      route: meaningShadowRoute,
      classifierEventType: eventType,
      classifierNormalizedHint: normalizedHint,
      gatedMode: gatedDecision.mode,
      openQuestionText: northStarPktForV3.latestOpenQuestion?.trim() || null,
      pendingResolutionKind: commitment.pending_resolution_kind,
      lastOutboundPreview: lastOutboundSmsPreview,
      behaviorStatement: commitment.behavior_statement ?? null,
      plannedInterruptionCategory: plannedInterruptionDetection.reasonCategory ?? null,
    });
  }

  const inboundV3ThreadMemory: InboundCoachReplyThreadMemoryContext = {
    commitmentId: commitment.id,
    expectedAnswerType:
      inboundRelationshipLane != null
        ? identityEditLaneActive
          ? null
          : northStarPktForV3.expectedReplySemantics ?? null
        : null,
    meaningShadow,
  };

  if (!persisted) {
    const j2 = await loadJob(job.message_sid);
    if (j2?.reply_body?.trim()) {
      await commitAndSendInboundCoachReply(j2, userId, inboundV3ThreadMemory);
      return;
    }
    throw new Error("v2_reply_ready_persist_failed");
  }

  const fresh = (await loadJob(job.message_sid)) ?? job;
  await commitAndSendInboundCoachReply(fresh, userId, inboundV3ThreadMemory);
}

async function processV2BlockerCapture(
  job: JobRow,
  userId: string,
  commitment: ActiveV2CommitmentRow,
  blockerText: string,
  timezone: string
): Promise<void> {
  const following =
    commitment.blocker_capture_after_event === "user_no" ||
    commitment.blocker_capture_after_event === "user_partial"
      ? commitment.blocker_capture_after_event
      : ("user_partial" as const);

  const { data: blockerProfileRow } = await supabaseServer
    .from("user_profiles")
    .select(
      "preferred_name, people_summary, responsibility, identity_anchor_text, identity_source"
    )
    .eq("clerk_user_id", userId)
    .maybeSingle();

  const blockerPreferredName =
    typeof blockerProfileRow?.preferred_name === "string"
      ? blockerProfileRow.preferred_name
      : null;
  const blockerPeopleSummary =
    typeof blockerProfileRow?.people_summary === "string" &&
    blockerProfileRow.people_summary.trim()
      ? blockerProfileRow.people_summary.trim()
      : null;
  const blockerResponsibility =
    typeof blockerProfileRow?.responsibility === "string" &&
    blockerProfileRow.responsibility.trim()
      ? blockerProfileRow.responsibility.trim()
      : null;
  const blockerIdentityAnchorText =
    typeof blockerProfileRow?.identity_anchor_text === "string"
      ? blockerProfileRow.identity_anchor_text.trim()
      : null;
  const blockerIdentitySource =
    typeof blockerProfileRow?.identity_source === "string"
      ? blockerProfileRow.identity_source.trim()
      : null;
  const blockerIdentityForPrompt = isQuotableIdentitySource(blockerIdentitySource)
    ? blockerIdentityAnchorText
    : null;

  const { body: templateAckBody, ackTemplateId } = buildBlockerAckSms(job.message_sid, {
    preferredName: blockerPreferredName,
  });

  const brokePause = commitment.accountability_phase === "low_pressure_reactivation";
  if (brokePause) {
    await exitLowPressureReactivationOnInbound(commitment.id);
    await recomputeV2CoachingMemory(commitment.id, {
      reasonCode: "inbound_exit_reactivation_before_blocker",
    });
  }

  const blockerCoachingMemory = await loadV2CoachingMemoryForPrompt(commitment.id);
  const blockerRelationshipMemoryPacket = slimMemoryPacketForFacts(
    await buildSmsRelationshipMemoryPacket({
      clerkUserId: userId,
      commitmentId: commitment.id,
      timezone,
    })
  );

  let blockerVictoryBackgroundFacts: V3VictoryBackgroundFacts | null = null;
  try {
    blockerVictoryBackgroundFacts = mapSmsVictoryBackgroundToFacts(
      await loadSmsVictoryBackgroundContext({
        clerkUserId: userId,
        commitmentId: commitment.id,
        timezone,
      })
    );
  } catch (e) {
    console.warn("[sms-inbound-coach] victory_background_load_failed_blocker", {
      clerk_user_id: userId,
      commitment_id: commitment.id,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const blockerMemoryTry =
    isV2InboundMemorySignalsEnabled() &&
    shouldAttemptInboundMemorySignalInterpretation(blockerText, {
      forceBecauseInterpretation: false,
    });

  const effectiveBlockerAsk = getEffectiveCoachingAsk(commitment);
  const blockerClassification = classifyV2InboundReply(blockerText.trim());
  const [convPackBlocker, recentEventsForCentral, pendingMemCentral] = await Promise.all([
    blockerMemoryTry
      ? buildV2SmsConversationContextPack({
          clerkUserId: userId,
          commitmentId: commitment.id,
          commitment,
          timezone,
          currentInboundText: blockerText,
          preloadedCoachingMemory: blockerCoachingMemory,
        })
      : Promise.resolve(null as V2SmsConversationContextPack | null),
    getRecentV2EventsForAi(commitment.id),
    fetchLatestAwaitingMemoryConfirmation(commitment.id),
  ]);

  const latestCheckEvBlock = recentEventsForCentral.find((e) => e.event_type === "check_sent");
  const checkPayloadBlock = latestCheckEvBlock?.payload_json ?? {};
  const lastOutboundBlockPreview =
    typeof checkPayloadBlock.body_preview === "string" && checkPayloadBlock.body_preview.trim().length > 0
      ? checkPayloadBlock.body_preview.trim().slice(0, 260)
      : null;

  let blockerMemoryStored: Record<string, unknown> | null = null;
  if (blockerMemoryTry && convPackBlocker) {
    const memRes = await interpretV2InboundMemorySignals({
      userMessage: blockerText,
      commitment,
      coachingMemory: blockerCoachingMemory,
      preferredName: blockerPreferredName,
      peopleSummaryToneHint: blockerPeopleSummary,
      responsibilityToneHint: blockerResponsibility,
      identityAnchorQuotablePreview: blockerIdentityForPrompt
        ? blockerIdentityForPrompt.slice(0, 200)
        : null,
      identitySource: blockerIdentitySource,
      recentSmsContextBlock: convPackBlocker.promptBlock,
      effectiveAsk: effectiveBlockerAsk,
    });
    blockerMemoryStored = buildStoredMemorySignalPayload({ result: memRes });
    if (blockerMemoryStored?.memory_signal_detected === true) {
      console.log("[v9.1-memory-signals] blocker_detected", {
        commitment_id: commitment.id,
        type: blockerMemoryStored?.memory_signal_type,
      });
    }
  }

  const northStarBlockerPkt = buildInboundNorthStarContextPacket({
    commitmentId: commitment.id,
    behaviorStatement: commitment.behavior_statement ?? "",
    effectiveAskText: effectiveBlockerAsk,
    timezone,
    userMessage: blockerText,
    lastOutboundSmsPreview: lastOutboundBlockPreview,
    checkPayload: checkPayloadBlock as Record<string, unknown>,
    recentEvents: recentEventsForCentral,
    convPack: convPackBlocker,
    coachingMemory: blockerCoachingMemory,
    finalEventType: blockerClassification.eventType,
    lifeDesires: null,
    peopleSummary: blockerPeopleSummary,
    identityAnchorText: blockerIdentityForPrompt,
    latestBlockerPreview: null,
  });

  const centralBlockerShadowStored = await interpretV2CentralSmsTurn({
    clerkUserId: userId,
    commitmentId: commitment.id,
    commitment,
    effectiveAsk: effectiveBlockerAsk,
    inboundText: blockerText,
    lastOutboundPromptPreview: lastOutboundBlockPreview,
    recentSmsContextBlock: convPackBlocker?.promptBlock ?? null,
    blockerCapturePending: true,
    refreshSessionActive: isRefreshSessionActive(commitment),
    smsPendingResolutionActive: isSmsInboundPendingResolutionActionable(commitment),
    contractOverlayProposalActive: isV2PendingProposalValid(commitment),
    memoryConfirmationPending: pendingMemCentral != null,
    activeCommitmentPresent: true,
    deterministicClassifierEventType: blockerClassification.eventType,
    deterministicNormalizedHint: blockerClassification.normalizedHint ?? null,
    gatedSummary: null,
    shadowInterpretationRaw: null,
    routeContext: "blocker_capture",
  });

  const blockerBrainControlEnabled = isV2CentralSmsBrainControlEnabled();
  if (
    blockerBrainControlEnabled &&
    shouldCentralBrainBlockBlockerCapture({
      stored: centralBlockerShadowStored,
      controlEnabled: blockerBrainControlEnabled,
    }) &&
    centralBlockerShadowStored != null
  ) {
    await clearBlockerCapturePending(commitment.id);
    const pivotTetherMachine = buildCentralBrainHumanTetherReply({
      turnPurpose: centralBlockerShadowStored.central_turn_purpose,
      inboundText: blockerText,
      effectiveAskSnippet: effectiveBlockerAsk,
      lastOutboundPromptPreview: lastOutboundBlockPreview,
      route: "blocker_capture",
    });
    let pivotLegacyPreview = pivotTetherMachine;
    if (shouldRunPhase5aCentralTetherBrain()) {
      pivotLegacyPreview = (
        await finalizePhase5aCentralTetherHumanSms({
          machineDraft: pivotTetherMachine,
          tetherRoute: "blocker_capture",
          centralTurnPurpose: centralBlockerShadowStored.central_turn_purpose,
        })
      ).message;
    }
    console.log(
      "[central-sms-brain/control]",
      JSON.stringify({
        wave: "14.2",
        commitment_id: commitment.id,
        control_action: "blocked_blocker_capture",
        no_event_reason: "central_brain_human_or_meta",
        reply_source: "central_brain_deterministic_v14_2",
        central_purpose: centralBlockerShadowStored.central_turn_purpose,
        central_confidence: centralBlockerShadowStored.confidence,
        old_path_that_would_have_run: "blocker_captured",
      })
    );

    const blockerPivotLines = buildMinimalInboundTranscriptLines(
      convPackBlocker,
      blockerText,
      lastOutboundBlockPreview
    );
    const forcedCoachSmsBlkPv =
      convPackBlocker &&
      !isLikelySmsComplianceOrOptOutTurn(blockerText) &&
      !isLikelyCommitmentChangeIntentTurn(blockerText) &&
      !isV2PendingProposalValid(commitment)
        ? tryBuildForcedInboundCoachSms({
            userMessage: blockerText,
            gatedDecision: V3_REFINE_ONLY_GATED,
            lastOutboundSmsPreview: lastOutboundBlockPreview,
            eventsNewestFirst: recentEventsForCentral,
            effectiveAskFloor: effectiveBlockerAsk,
            messageSid: job.message_sid,
          })
        : null;
    const relationshipToneBlk =
      blockerCoachingMemory?.sms_relationship_profile != null
        ? JSON.stringify(blockerCoachingMemory.sms_relationship_profile).slice(0, 240)
        : null;

    const conversationBrainFactsBlk: InboundV3ConversationBrainFacts = { enabled: false };
    const centralBrainFactsBlk: InboundV3CentralBrainFacts = {
      shadow_stored: true,
      central_turn_purpose: centralBlockerShadowStored.central_turn_purpose ?? null,
      confidence: centralBlockerShadowStored.confidence ?? null,
      blocked_outcome_scoring: false,
    };
    const arcFactsBlk: InboundV3ArcFacts = {
      ambiguous_short_reply: false,
      clarification_required: false,
    };

    const blkPivotFacts = buildInboundV3RelationshipFacts({
      clerkUserId: userId,
      preferredName: blockerPreferredName,
      timezone,
      localTimeIso: new Date(new Date().toLocaleString("en-US", { timeZone: timezone })).toISOString(),
      commitment,
      effectiveAsk: effectiveBlockerAsk,
      userMessageRaw: blockerText,
      coalescedInboundText: blockerText,
      suppressedMessageSids: [],
      transcriptLines: blockerPivotLines,
      northStarPacket: northStarBlockerPkt,
      gatedDecision: V3_REFINE_ONLY_GATED,
      deterministicEventType: blockerClassification.eventType,
      doNotRepeatHints: deriveDoNotRepeatHintsFromCoachingMemory(blockerCoachingMemory),
      relationshipProfileSummary: relationshipToneBlk,
      conversationBrain: conversationBrainFactsBlk,
      centralBrain: centralBrainFactsBlk,
      arc: arcFactsBlk,
      phase5a: {
        central_tether_brain_enabled: shouldRunPhase5aCentralTetherBrain(),
        arc_clarify_brain_enabled: shouldRunPhase5aArcClarifyBrain(),
        inbound_stitched_final_enabled: shouldRunPhase5aInboundStitchedFinalBrain(),
      },
      forcedFutureStretchIntentActive: Boolean(forcedCoachSmsBlkPv),
      wave11MemoryConfirmationPending: pendingMemCentral != null,
      accountabilityProofHint: null,
      rejectedTimeCandidates: [],
      unavailableWindows: [],
      routePurpose: "central_brain_blocker_pivot",
      branchName: "central_brain_blocker_capture_pivot",
      branchMigratedToLane: true,
      centralBrainBlockerPivotFacts: {
        blocked_blocker_capture: true,
        central_turn_purpose: centralBlockerShadowStored.central_turn_purpose ?? null,
        confidence:
          typeof centralBlockerShadowStored.confidence === "number" &&
          Number.isFinite(centralBlockerShadowStored.confidence)
            ? centralBlockerShadowStored.confidence
            : null,
        reason: "central_brain_human_or_meta",
        suggested_move: String(
          centralBlockerShadowStored.central_turn_purpose ?? "respond_to_blocker_context"
        ).slice(0, 120),
        blocker_text: blockerText.trim().slice(0, 2000),
        legacy_tether_text_preview: pivotLegacyPreview.slice(0, 500),
      },
      victoryBackground: blockerVictoryBackgroundFacts,
      relationshipMemoryPacket: blockerRelationshipMemoryPacket,
    });

    const blkPivotLaneRes = await produceInboundV3RelationshipSms({
      facts: blkPivotFacts,
      telemetry_fact_sources: [
        "buildInboundNorthStarContextPacket",
        "buildMinimalInboundTranscriptLines",
        "interpretV2CentralSmsTurn",
        "deriveDoNotRepeatHintsFromCoachingMemory",
        "buildCentralBrainHumanTetherReply_legacy_preview_only",
        "finalizePhase5aCentralTetherHumanSms_legacy_preview_only",
      ],
    });

    if (!blkPivotLaneRes.shouldSend || !blkPivotLaneRes.body.trim()) {
      await markJobFinal({
        messageSid: job.message_sid,
        status: "cancelled",
        lastError: formatInboundV3LaneNoSendLastError(blkPivotLaneRes, {
          route_purpose: "central_brain_blocker_pivot",
          branch_name: "central_brain_blocker_capture_pivot",
          branch_migrated_to_lane: true,
        }),
        nextRetry: farFutureIso(),
      });
      console.warn("[sms-inbound-coach] blocker_pivot_inbound_relationship_lane_no_send", {
        message_sid: job.message_sid,
        commitment_id: commitment.id,
        reason: blkPivotLaneRes.noSendReason,
      });
      return;
    }

    const blkPivotV3BrainMetadata: Record<string, unknown> = {
      ...blkPivotLaneRes.metadata,
      inbound_v3_relationship_lane: true,
      v3_lane_turn_purpose: blkPivotLaneRes.turnPurpose,
      route_purpose: "central_brain_blocker_pivot",
      branch_migrated_to_lane: true,
      branch_name: "central_brain_blocker_capture_pivot",
      central_brain_blocker_pivot_facts_summary: slimCentralBrainBlockerPivotFactsForTelemetry(
        blkPivotFacts.central_brain_blocker_pivot_facts
      ),
      v3_candidate_body: blkPivotLaneRes.body,
    };

    const blockerPivotVoicePack = await northStarGatePersistBodyAsync(blkPivotLaneRes.body, {
      job,
      channel: "central_brain_pivot",
      lastOutboundBody: lastOutboundBlockPreview,
      effectiveAsk: effectiveBlockerAsk,
      behaviorStatement: commitment.behavior_statement,
      finalEventType: blockerClassification.eventType,
      replySource: "v3_inbound_relationship_lane",
      contextPacket: northStarBlockerPkt,
      activeCommitmentId: commitment.id,
      normalCoaching: true,
      v3BrainMetadata: blkPivotV3BrainMetadata,
    });
    if (!blockerPivotVoicePack.voice.shouldSend) {
      await markJobFinal({
        messageSid: job.message_sid,
        status: "cancelled",
        lastError: finalVoiceSkipLastError(blockerPivotVoicePack.voice, {
          route_purpose: "central_brain_blocker_pivot",
          branch_name: "central_brain_blocker_capture_pivot",
          branch_migrated_to_lane: true,
          v3_lane_reply_source: "v3_inbound_relationship_lane",
          v3_candidate_body: blkPivotLaneRes.body.slice(0, 500),
          lane_metadata: blkPivotLaneRes.metadata,
          north_star_gate: {
            original_body: blockerPivotVoicePack.northStarMeta.originalBody,
            final_body: blockerPivotVoicePack.northStarVisibleBody,
            north_star_gate_source: blockerPivotVoicePack.northStarMeta.source,
            north_star_gate_reasons: blockerPivotVoicePack.northStarMeta.blockedReasons,
            ...pickNorthStarWriterAttributionFields(blockerPivotVoicePack.northStarMeta),
          },
          final_voice_gate: blockerPivotVoicePack.voice.metadata,
          should_send: false,
        }),
        nextRetry: farFutureIso(),
      });
      console.warn("[sms-inbound-coach] blocker_pivot_final_voice_suppressed", {
        message_sid: job.message_sid,
      });
      return;
    }
    const gatedBlockerPivot = blockerPivotVoicePack.voice.body;
    const pivotNow = new Date().toISOString();
    const { data: persistedPivot } = await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        reply_body: gatedBlockerPivot,
        status: "reply_ready",
        next_retry_at: pivotNow,
        updated_at: pivotNow,
        last_error: null,
      })
      .eq("message_sid", job.message_sid)
      .eq("status", "processing")
      .select()
      .maybeSingle();
    const blockerPivotThreadMemoryCtx = {
      commitmentId: commitment.id,
      expectedAnswerType:
        typeof northStarBlockerPkt.expectedReplySemantics === "string"
          ? northStarBlockerPkt.expectedReplySemantics
          : null,
      meaningShadow: buildBlockerCaptureMeaningShadow({
        commitmentId: commitment.id,
        classifierEventType: blockerClassification.eventType,
        blockerCaptureAfterEvent: following,
        blockerTextPreview: blockerText,
        lastOutboundPreview: lastOutboundBlockPreview,
        behaviorStatement: commitment.behavior_statement ?? null,
      }),
    };

    if (!persistedPivot) {
      const j2 = await loadJob(job.message_sid);
      if (j2?.reply_body?.trim()) {
        await commitAndSendInboundRelationshipCoachReply(j2, userId, blockerPivotThreadMemoryCtx);
        return;
      }
      throw new Error("v2_blocker_human_pivot_reply_ready_failed");
    }
    const freshPv = (await loadJob(job.message_sid)) ?? job;
    await commitAndSendInboundRelationshipCoachReply(freshPv, userId, blockerPivotThreadMemoryCtx);
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    return;
  }

  const blockerAckTry = await tryGenerateV2BlockerAckMessage({
    commitment,
    followingEventType: following,
    blockerText,
    preferredName: blockerPreferredName,
    lifeDesires: null,
    peopleSummary: blockerPeopleSummary,
    responsibility: blockerResponsibility,
    identityAnchorText: blockerIdentityForPrompt,
    coachingMemory: blockerCoachingMemory,
    ...(brokePause ? { brokePause: true } : {}),
  });

  const ackMachineBody = blockerAckTry.ok ? blockerAckTry.message : templateAckBody;

  const repeatedBlockerSignal = recentEventsForCentral.some((e) => e.event_type === "blocker_captured");
  let blockerPendingAgeMinRemaining: number | null = null;
  if (commitment.blocker_capture_expires_at) {
    const expMs = new Date(commitment.blocker_capture_expires_at).getTime();
    blockerPendingAgeMinRemaining = Math.max(0, Math.floor((expMs - Date.now()) / 60000));
  }
  const suggestedNextMove =
    effectiveBlockerAsk.trim().length > 0 ? effectiveBlockerAsk.trim().slice(0, 260) : null;
  const blockerCategoryLabel =
    blockerClassification.normalizedHint != null && blockerClassification.normalizedHint.length > 0
      ? `${blockerClassification.eventType}:${blockerClassification.normalizedHint}`
      : blockerClassification.eventType;

  const blockerAckLines = buildMinimalInboundTranscriptLines(
    convPackBlocker,
    blockerText,
    lastOutboundBlockPreview
  );
  const forcedCoachSmsAck = tryBuildForcedInboundCoachSms({
    userMessage: blockerText,
    gatedDecision: V3_REFINE_ONLY_GATED,
    lastOutboundSmsPreview: lastOutboundBlockPreview,
    eventsNewestFirst: recentEventsForCentral,
    effectiveAskFloor: effectiveBlockerAsk,
    messageSid: job.message_sid,
  });

  const ackInboundFacts = buildInboundV3RelationshipFacts({
    clerkUserId: userId,
    preferredName: blockerPreferredName,
    timezone,
    localTimeIso: new Date(new Date().toLocaleString("en-US", { timeZone: timezone })).toISOString(),
    commitment,
    effectiveAsk: effectiveBlockerAsk,
    userMessageRaw: blockerText,
    coalescedInboundText: blockerText,
    suppressedMessageSids: [],
    transcriptLines: blockerAckLines,
    northStarPacket: northStarBlockerPkt,
    gatedDecision: V3_REFINE_ONLY_GATED,
    deterministicEventType: blockerClassification.eventType,
    doNotRepeatHints: deriveDoNotRepeatHintsFromCoachingMemory(blockerCoachingMemory),
    relationshipProfileSummary:
      blockerCoachingMemory?.sms_relationship_profile != null
        ? JSON.stringify(blockerCoachingMemory.sms_relationship_profile).slice(0, 240)
        : null,
    conversationBrain: { enabled: false },
    centralBrain:
      centralBlockerShadowStored != null
        ? {
            shadow_stored: true,
            central_turn_purpose: centralBlockerShadowStored.central_turn_purpose ?? null,
            confidence: centralBlockerShadowStored.confidence ?? null,
            blocked_outcome_scoring: false,
          }
        : { shadow_stored: false },
    arc: { ambiguous_short_reply: false, clarification_required: false },
    phase5a: {
      central_tether_brain_enabled: shouldRunPhase5aCentralTetherBrain(),
      arc_clarify_brain_enabled: shouldRunPhase5aArcClarifyBrain(),
      inbound_stitched_final_enabled: shouldRunPhase5aInboundStitchedFinalBrain(),
    },
    forcedFutureStretchIntentActive: Boolean(forcedCoachSmsAck),
    wave11MemoryConfirmationPending: pendingMemCentral != null,
    accountabilityProofHint: null,
    rejectedTimeCandidates: [],
    unavailableWindows: [],
    routePurpose: "blocker_capture_ack",
    branchName: "blocker_capture_ack",
    branchMigratedToLane: true,
    blockerFacts: {
      blocker_text: blockerText.trim().slice(0, 2000),
      blocker_category: blockerCategoryLabel,
      repeated_blocker_signal: repeatedBlockerSignal,
      following_event_type: following,
      blocker_pending_age_minutes_remaining: blockerPendingAgeMinRemaining,
      suggested_next_move: suggestedNextMove,
      legacy_blocker_ack_preview: ackMachineBody.slice(0, 500),
    },
    victoryBackground: blockerVictoryBackgroundFacts,
    relationshipMemoryPacket: blockerRelationshipMemoryPacket,
  });

  const ackLaneRes = await produceInboundV3RelationshipSms({
    facts: ackInboundFacts,
    telemetry_fact_sources: [
      "tryGenerateV2BlockerAckMessage_legacy_preview_only",
      "buildBlockerAckSms_legacy_preview_only",
      "buildInboundNorthStarContextPacket",
      "buildMinimalInboundTranscriptLines",
      "interpretV2CentralSmsTurn",
      "deriveDoNotRepeatHintsFromCoachingMemory",
    ],
  });

  let gatedAckBody = "";
  let ackVoicePackForPayload: Awaited<ReturnType<typeof northStarGatePersistBodyAsync>> | null = null;
  let visibleSent = false;
  let ackSid: string | null = null;

  if (!ackLaneRes.shouldSend || !ackLaneRes.body.trim()) {
    await markJobFinal({
      messageSid: job.message_sid,
      status: "cancelled",
      lastError: formatInboundV3LaneNoSendLastError(ackLaneRes, {
        route_purpose: "blocker_capture_ack",
        branch_name: "blocker_capture_ack",
        branch_migrated_to_lane: true,
      }),
      nextRetry: farFutureIso(),
    });
    console.warn("[sms-inbound-coach] blocker_ack_inbound_relationship_lane_no_send", {
      message_sid: job.message_sid,
      commitment_id: commitment.id,
      reason: ackLaneRes.noSendReason,
    });
  } else {
    const ackV3BrainMetadata: Record<string, unknown> = {
      ...ackLaneRes.metadata,
      inbound_v3_relationship_lane: true,
      v3_lane_turn_purpose: ackLaneRes.turnPurpose,
      route_purpose: "blocker_capture_ack",
      branch_migrated_to_lane: true,
      branch_name: "blocker_capture_ack",
      blocker_facts_summary: slimBlockerFactsForTelemetry(ackInboundFacts.blocker_facts),
      v3_candidate_body: ackLaneRes.body,
    };
    const ackVoicePack = await northStarGatePersistBodyAsync(ackLaneRes.body, {
      job,
      channel: "blocker_followup",
      lastOutboundBody: lastOutboundBlockPreview,
      effectiveAsk: effectiveBlockerAsk,
      behaviorStatement: commitment.behavior_statement,
      finalEventType: blockerClassification.eventType,
      replySource: "v3_inbound_relationship_lane",
      contextPacket: northStarBlockerPkt,
      activeCommitmentId: commitment.id,
      normalCoaching: true,
      v3BrainMetadata: ackV3BrainMetadata,
    });
    ackVoicePackForPayload = ackVoicePack;
    if (!ackVoicePack.voice.shouldSend) {
      await markJobFinal({
        messageSid: job.message_sid,
        status: "cancelled",
        lastError: finalVoiceSkipLastError(ackVoicePack.voice, {
          route_purpose: "blocker_capture_ack",
          branch_name: "blocker_capture_ack",
          branch_migrated_to_lane: true,
          v3_lane_reply_source: "v3_inbound_relationship_lane",
          v3_candidate_body: ackLaneRes.body.slice(0, 500),
          lane_metadata: ackLaneRes.metadata,
          north_star_gate: {
            original_body: ackVoicePack.northStarMeta.originalBody,
            final_body: ackVoicePack.northStarVisibleBody,
            north_star_gate_source: ackVoicePack.northStarMeta.source,
            north_star_gate_reasons: ackVoicePack.northStarMeta.blockedReasons,
            ...pickNorthStarWriterAttributionFields(ackVoicePack.northStarMeta),
          },
          final_voice_gate: ackVoicePack.voice.metadata,
          should_send: false,
        }),
        nextRetry: farFutureIso(),
      });
      console.warn("[sms-inbound-coach] blocker_ack_final_voice_suppressed", {
        message_sid: job.message_sid,
      });
    } else {
      gatedAckBody = ackVoicePack.voice.body;
      visibleSent = true;
      const now = new Date().toISOString();

      const { data: persisted } = await supabaseServer
        .from("sms_inbound_coach_jobs")
        .update({
          reply_body: gatedAckBody,
          status: "reply_ready",
          next_retry_at: now,
          updated_at: now,
          last_error: null,
        })
        .eq("message_sid", job.message_sid)
        .eq("status", "processing")
        .select()
        .maybeSingle();

      const blockerAckThreadMemoryCtx = {
        commitmentId: commitment.id,
        expectedAnswerType:
          typeof northStarBlockerPkt.expectedReplySemantics === "string"
            ? northStarBlockerPkt.expectedReplySemantics
            : null,
        meaningShadow: buildBlockerCaptureMeaningShadow({
          commitmentId: commitment.id,
          classifierEventType: blockerClassification.eventType,
          blockerCaptureAfterEvent: following,
          blockerTextPreview: blockerText,
          lastOutboundPreview: lastOutboundBlockPreview,
          behaviorStatement: commitment.behavior_statement ?? null,
        }),
      };

      if (!persisted) {
        const j2 = await loadJob(job.message_sid);
        if (j2?.reply_body?.trim()) {
          await commitAndSendInboundRelationshipCoachReply(j2, userId, blockerAckThreadMemoryCtx);
        } else {
          throw new Error("v2_blocker_ack_reply_ready_persist_failed");
        }
      } else {
        const fresh = (await loadJob(job.message_sid)) ?? job;
        await commitAndSendInboundRelationshipCoachReply(fresh, userId, blockerAckThreadMemoryCtx);
      }

      const afterSend = (await loadJob(job.message_sid)) ?? job;
      ackSid =
        typeof afterSend.outbound_message_sid === "string" && afterSend.outbound_message_sid.length > 0
          ? afterSend.outbound_message_sid
          : null;
    }
  }

  let blockerAckFallbackReason: string | null = null;
  if (!blockerAckTry.ok) blockerAckFallbackReason = blockerAckTry.reason;
  else if (!ackLaneRes.shouldSend || !ackLaneRes.body.trim()) {
    blockerAckFallbackReason = ackLaneRes.noSendReason ?? "inbound_v3_lane_no_send";
  } else if (ackVoicePackForPayload && !ackVoicePackForPayload.voice.shouldSend) {
    blockerAckFallbackReason = "final_voice_gate_no_send";
  }

  const blockerAiPayload = {
    ...buildBlockerAckAiPayload({
      model: V2_BLOCKER_ACK_AI_MODEL,
      promptVersion: V2_BLOCKER_ACK_PROMPT_VERSION,
      message: visibleSent ? gatedAckBody : "",
      confidence: blockerAckTry.ok ? blockerAckTry.confidence : null,
      fallbackUsed: blockerAckFallbackReason != null,
      fallbackReason: blockerAckFallbackReason,
    }),
    old_inbound_writer_used_as_voice: false,
    ...(ackVoicePackForPayload != null ? { final_voice_gate: ackVoicePackForPayload.voice.metadata } : {}),
    ...(visibleSent && ackVoicePackForPayload != null
      ? {
          north_star_gate: {
            original_body: ackVoicePackForPayload.northStarMeta.originalBody,
            final_body: ackVoicePackForPayload.northStarVisibleBody,
            north_star_gate_source: ackVoicePackForPayload.northStarMeta.source,
            north_star_gate_reasons: ackVoicePackForPayload.northStarMeta.blockedReasons,
            ...pickNorthStarWriterAttributionFields(ackVoicePackForPayload.northStarMeta),
          },
        }
      : {}),
  };

  const blockerProofMoment = buildProofMomentForBlockerCaptured({
    blockerMessageCharCount: blockerText.trim().length,
  });

  const blockerAckObservability = buildBlockerCapturedAckObservability({
    jobMessageSid: job.message_sid,
    ackLaneRes: ackLaneRes,
    visibleSent,
    ackVoicePackForPayload,
    gatedAckBody,
  });

  const { error: evErr } = await supabaseServer.from("v2_commitment_event").insert({
    commitment_id: commitment.id,
    clerk_user_id: userId,
    event_type: "blocker_captured",
    source: "sms_v2_accountability",
    payload_json: {
      message: blockerText,
      following_event_type: following,
      captured_at_context: "post_miss_question",
      ...blockerAckObservability,
      ...(!blockerAckTry.ok ? { ack_template_id: ackTemplateId } : {}),
      ...(ackSid ? { ack_message_sid: ackSid } : {}),
      ...(blockerMemoryStored != null ? { memory_signal: blockerMemoryStored } : {}),
      ...proofMomentPayloadFields(blockerProofMoment, blockerText),
      ...(centralBlockerShadowStored != null ? { central_sms_turn_shadow: centralBlockerShadowStored } : {}),
      ai: blockerAiPayload,
    },
    idempotency_key: `v2_blocker_captured:${job.message_sid}`,
  });

  if (evErr) {
    const code = (evErr as { code?: string }).code;
    if (code === "23505") {
      await clearBlockerCapturePending(commitment.id);
      return;
    }
    console.error("[sms-inbound-coach] blocker_captured insert failed", {
      message_sid: job.message_sid,
      message: evErr.message,
    });
    return;
  }

  maybeLogCentralBrainDisagreement({
    commitmentId: commitment.id,
    stored: centralBlockerShadowStored ?? undefined,
    spineEventType: "blocker_captured",
    shouldWriteOutcome: true,
  });

  await clearBlockerCapturePending(commitment.id);
  await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
  await recomputeV2CoachingMemory(commitment.id, {
    reasonCode: "inbound_blocker_captured",
  });
}

async function processV2ContractProposalConsent(
  job: JobRow,
  userId: string,
  commitment: ActiveV2CommitmentRow,
  timezone: string
): Promise<boolean> {
  let workingCommitment = commitment;
  if (!isV2PendingProposalValid(workingCommitment)) return false;

  const proposalText = workingCommitment.adaptive_proposal_text?.trim();
  if (!proposalText) return false;

  const classification = classifyV2InboundReply((job.raw_body || "").trim());
  if (classification.eventType !== "user_yes" && classification.eventType !== "user_no") return false;

  // Critical: only consume YES/NO as proposal consent if outbound context still indicates
  // we are inside the proposal consent prompt (semantic daily snapshot match OR legacy needle).
  const outboundOk = await shouldConsumeInboundAsContractProposalConsentAsync({
    commitmentId: workingCommitment.id,
    clerkUserId: userId,
    inboundBody: (job.raw_body || "").trim(),
    proposalText,
  });
  if (!outboundOk) {
    const gateDiagnosis = await diagnoseContractConsentOutboundGateAsync({
      commitmentId: workingCommitment.id,
      clerkUserId: userId,
      inboundBody: (job.raw_body || "").trim(),
      proposalText,
    });
    console.warn("[sms-inbound-coach] contract_consent_outbound_gate_miss", {
      message_sid: job.message_sid,
      commitment_id: workingCommitment.id,
      clerk_user_id: userId,
      inbound_event_type: gateDiagnosis.details.inbound_event_type,
      gate_reason: gateDiagnosis.reason,
      gate_details: gateDiagnosis.details,
    });
    registerInboundMeaningShadowPending({
      job,
      userId,
      rawBody: (job.raw_body || "").trim(),
      schedule: buildMeaningShadowScheduleArgs({
        deterministicRoute: MEANING_INTERPRETER_ROUTES.contract_consent_gate_miss,
        commitmentId: workingCommitment.id,
        deterministicFacts: {
          classifier_event_type: classification.eventType,
          overlay_consent_pending: true,
          adaptive_proposal_pending: true,
        },
      }),
      extraFacts: buildEnrichedMeaningShadowFacts({
        contractConsentGateMiss: true,
        gateReason: gateDiagnosis.reason,
        gateDetails: gateDiagnosis.details as Record<string, unknown>,
        adaptiveProposalPending: true,
        overlayConsentPending: true,
      }),
    });
    return false;
  }

  if (
    workingCommitment.accountability_phase === "low_pressure_reactivation" &&
    (classification.eventType === "user_yes" || classification.eventType === "user_no")
  ) {
    await exitLowPressureReactivationOnInbound(workingCommitment.id);
    await recomputeV2CoachingMemory(workingCommitment.id, {
      reasonCode: "inbound_exit_reactivation_before_contract_consent",
    });
    const refreshed = await getActiveCommitment(userId);
    if (!refreshed?.id) {
      throw new Error("contract_consent_commitment_missing_after_reactivation_exit");
    }
    workingCommitment = refreshed;
  }

  const inboundRawTrim = (job.raw_body || "").trim();
  const proposalDigest =
    proposalText.length > 180 ? `${proposalText.slice(0, 177)}...` : proposalText;
  const proposalExpiresAt = workingCommitment.adaptive_proposal_expires_at ?? null;

  const stateMutationCompleted = (overlay: InboundV3ContractConsentFacts["overlay_action"]) =>
    overlay === "activated" ||
    overlay === "declined" ||
    overlay === "noop_already_applied";

  if (classification.eventType === "user_yes") {
    const contractKind = await resolvePendingProposalContractKind({
      commitmentId: commitment.id,
      proposalText,
    });
    const act = await activateAdaptiveOverlayFromProposal({
      commitmentId: workingCommitment.id,
      clerkUserId: userId,
      proposalText,
      inboundMessageSid: job.message_sid,
      contractKind,
      expectedProposalExpiresAt: workingCommitment.adaptive_proposal_expires_at,
      expectedUpdatedAt: workingCommitment.updated_at,
    });

    const yesTmplPreview = () =>
      buildV2ContractOverlayYesAckSms({
        messageSid: job.message_sid,
        adoptedAskText: proposalText,
        contractKind,
      }).body.slice(0, 500);

    if (act.result === "already_applied") {
      await persistContractConsentInboundLaneAckAndSend({
        job,
        userId,
        commitment: workingCommitment,
        timezone,
        inboundRaw: inboundRawTrim,
        routePurpose: "adaptive_proposal_consent_noop_ack",
        contractConsentFacts: {
          consent_parse: "user_yes",
          latest_outbound_was_proposal: true,
          proposal_kind: String(contractKind),
          proposal_text_digest: proposalDigest,
          overlay_action: "noop_already_applied",
          rpc_result: "already_applied",
          server_state_transition_summary:
            "RPC returned already_applied for overlay accept; commitment overlay state was already applied before this inbound.",
          required_meaning_summary:
            "Thread already recorded their acceptance; reassure daily accountability continues; do not claim a fresh activation.",
          legacy_contract_ack_preview: yesTmplPreview(),
          inbound_message_sid: job.message_sid,
          proposal_expires_at: proposalExpiresAt,
        },
        stateMutationCompletedBeforeSms: stateMutationCompleted("noop_already_applied"),
        proposalText,
        contractKind,
      });
      return true;
    }
    if (act.result === "state_conflict" || act.result === "not_found") {
      const overlayAction = act.result === "not_found" ? "noop_not_found" : "noop_state_conflict";
      await persistContractConsentInboundLaneAckAndSend({
        job,
        userId,
        commitment: workingCommitment,
        timezone,
        inboundRaw: inboundRawTrim,
        routePurpose: "adaptive_proposal_consent_noop_ack",
        contractConsentFacts: {
          consent_parse: "user_yes",
          latest_outbound_was_proposal: true,
          proposal_kind: String(contractKind),
          proposal_text_digest: proposalDigest,
          overlay_action: overlayAction,
          rpc_result: act.result,
          server_state_transition_summary: `RPC returned ${act.result}; no pending overlay proposal matched for this YES.`,
          required_meaning_summary:
            "No active pending proposal matched this YES reply; daily checks continue unchanged; do not invent a new commitment or overlay.",
          legacy_contract_ack_preview: yesTmplPreview(),
          inbound_message_sid: job.message_sid,
          proposal_expires_at: proposalExpiresAt,
        },
        stateMutationCompletedBeforeSms: stateMutationCompleted(overlayAction),
        proposalText,
        contractKind,
      });
      return true;
    }
    if (!act.ok) {
      throw new Error(`contract_overlay_activate_failed:${act.error}`);
    }
    await recomputeV2CoachingMemory(workingCommitment.id, {
      reasonCode: "inbound_contract_overlay_accepted",
    });

    const bindingSlice = contractConsentYesBindingVerbatimSubstring(proposalText);
    const requiredVerb = bindingSlice ? [bindingSlice] : undefined;

    await persistContractConsentInboundLaneAckAndSend({
      job,
      userId,
      commitment: workingCommitment,
      timezone,
      inboundRaw: inboundRawTrim,
      routePurpose: "adaptive_proposal_consent_accept",
      contractConsentFacts: {
        consent_parse: "user_yes",
        latest_outbound_was_proposal: true,
        proposal_kind: String(contractKind),
        proposal_text_digest: proposalDigest,
        overlay_action: "activated",
        rpc_result: "applied",
        server_state_transition_summary:
          "RPC applied adaptive overlay from pending proposal; tighter ask is now active per server row.",
        required_verbatim_substrings: requiredVerb,
        required_meaning_summary:
          "Acknowledge the adaptive proposal was accepted and the new ask from facts is now in effect; honor verbatim binding substring(s) exactly.",
        legacy_contract_ack_preview: yesTmplPreview(),
        inbound_message_sid: job.message_sid,
        proposal_expires_at: proposalExpiresAt,
      },
      stateMutationCompletedBeforeSms: true,
      proposalText,
      contractKind,
    });
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    return true;
  }

  if (classification.eventType === "user_no") {
    const contractKind = await resolvePendingProposalContractKind({
      commitmentId: commitment.id,
      proposalText,
    });
    const dec = await declineAdaptiveProposal({
      commitmentId: workingCommitment.id,
      clerkUserId: userId,
      proposalText,
      inboundMessageSid: job.message_sid,
      contractKind,
      expectedProposalExpiresAt: workingCommitment.adaptive_proposal_expires_at,
      expectedUpdatedAt: workingCommitment.updated_at,
    });

    const noTmplPreview = () =>
      buildV2ContractOverlayNoAckSms({
        messageSid: job.message_sid,
        originalBehaviorStatement: workingCommitment.behavior_statement,
      }).body.slice(0, 500);

    if (dec.result === "already_applied") {
      await persistContractConsentInboundLaneAckAndSend({
        job,
        userId,
        commitment: workingCommitment,
        timezone,
        inboundRaw: inboundRawTrim,
        routePurpose: "adaptive_proposal_consent_noop_ack",
        contractConsentFacts: {
          consent_parse: "user_no",
          latest_outbound_was_proposal: true,
          proposal_kind: String(contractKind),
          proposal_text_digest: proposalDigest,
          overlay_action: "noop_already_applied",
          rpc_result: "already_applied",
          server_state_transition_summary:
            "RPC returned already_applied for overlay decline; decline state was already applied before this inbound.",
          required_meaning_summary:
            "This thread already recorded their decline of the proposal; reassure daily checks continue without implying acceptance.",
          legacy_contract_ack_preview: noTmplPreview(),
          inbound_message_sid: job.message_sid,
          proposal_expires_at: proposalExpiresAt,
        },
        stateMutationCompletedBeforeSms: stateMutationCompleted("noop_already_applied"),
        proposalText,
        contractKind,
      });
      return true;
    }
    if (dec.result === "state_conflict" || dec.result === "not_found") {
      const overlayAction = dec.result === "not_found" ? "noop_not_found" : "noop_state_conflict";
      await persistContractConsentInboundLaneAckAndSend({
        job,
        userId,
        commitment: workingCommitment,
        timezone,
        inboundRaw: inboundRawTrim,
        routePurpose: "adaptive_proposal_consent_noop_ack",
        contractConsentFacts: {
          consent_parse: "user_no",
          latest_outbound_was_proposal: true,
          proposal_kind: String(contractKind),
          proposal_text_digest: proposalDigest,
          overlay_action: overlayAction,
          rpc_result: dec.result,
          server_state_transition_summary: `RPC returned ${dec.result}; no pending overlay proposal matched for this NO.`,
          required_meaning_summary:
            "No active pending proposal matched this NO; current written commitment remains the anchor; do not imply an overlay was active or accepted.",
          legacy_contract_ack_preview: noTmplPreview(),
          inbound_message_sid: job.message_sid,
          proposal_expires_at: proposalExpiresAt,
        },
        stateMutationCompletedBeforeSms: stateMutationCompleted(overlayAction),
        proposalText,
        contractKind,
      });
      return true;
    }
    if (!dec.ok) {
      throw new Error(`contract_overlay_decline_failed:${dec.error}`);
    }
    await recomputeV2CoachingMemory(workingCommitment.id, {
      reasonCode: "inbound_contract_overlay_declined",
    });

    await persistContractConsentInboundLaneAckAndSend({
      job,
      userId,
      commitment: workingCommitment,
      timezone,
      inboundRaw: inboundRawTrim,
      routePurpose: "adaptive_proposal_consent_decline",
      contractConsentFacts: {
        consent_parse: "user_no",
        latest_outbound_was_proposal: true,
        proposal_kind: String(contractKind),
        proposal_text_digest: proposalDigest,
        overlay_action: "declined",
        rpc_result: "applied",
        server_state_transition_summary:
          "RPC recorded decline of pending adaptive overlay proposal; base written commitment remains per server row.",
        required_meaning_summary:
          "Acknowledge the pending adaptive proposal was declined clearly—they keep their existing written commitment as the standard. Neutral tone; do not shame; do not imply the tighter overlay was adopted.",
        legacy_contract_ack_preview: noTmplPreview(),
        inbound_message_sid: job.message_sid,
        proposal_expires_at: proposalExpiresAt,
      },
      stateMutationCompletedBeforeSms: true,
      proposalText,
      contractKind,
    });
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    return true;
  }

  return false;
}

async function fetchPreferredNameForInboundLane(clerkUserId: string): Promise<string | null> {
  const { data } = await supabaseServer
    .from("user_profiles")
    .select("preferred_name")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  return typeof data?.preferred_name === "string" ? data.preferred_name : null;
}

async function buildTransactionalInboundLaneFactsPackage(args: {
  job: JobRow;
  userId: string;
  commitment: ActiveV2CommitmentRow;
  timezone: string;
  inboundRaw: string;
  splitSuppressedMessageSids: string[];
  routePurpose: InboundV3RoutePurpose;
  branchName: string;
  wave11MemoryConfirmationPending: boolean;
  refreshFacts?: InboundV3RefreshFacts | null;
  pendingResolutionFacts?: InboundV3PendingResolutionFacts | null;
  seasonTransitionFacts?: import("@/lib/v3-inbound-pending-replacement-truth").InboundV3SeasonTransitionFacts | null;
  memoryConfirmationFacts?: InboundV3MemoryConfirmationFacts | null;
  contractConsentFacts?: InboundV3ContractConsentFacts | null;
  adaptiveConsentClarificationFacts?: InboundV3AdaptiveConsentClarificationFacts | null;
  commitmentChangeFacts?: InboundV3CommitmentChangeFacts | null;
  pendingResolutionAppliedOverride?: boolean;
  gatedDecisionOverride?: V2InboundGatedDecision | null;
  deterministicClassifierOverride?: "user_yes" | "user_no" | "user_partial" | null;
}): Promise<{ facts: InboundV3RelationshipFacts; contextPacket: NorthStarSmsContextPacket }> {
  const coachingMemoryRow = await loadV2CoachingMemoryForPrompt(args.commitment.id);
  const recentEvents = await getRecentV2EventsForAi(args.commitment.id);

  await persistInboundSmsThreadMemoryProjectionBestEffort({
    commitmentId: args.commitment.id,
    clerkUserId: args.userId,
    inboundBody: args.inboundRaw,
    messageSid: args.job.message_sid,
    classification:
      args.deterministicClassifierOverride ??
      classifyV2InboundReply(args.inboundRaw.trim()).eventType,
    routePurpose: args.routePurpose,
  });

  const relationshipMemoryPacket = slimMemoryPacketForFacts(
    await buildSmsRelationshipMemoryPacket({
      clerkUserId: args.userId,
      commitmentId: args.commitment.id,
      timezone: args.timezone,
    })
  );
  let transactionalVictoryBackgroundFacts: V3VictoryBackgroundFacts | null = null;
  try {
    transactionalVictoryBackgroundFacts = mapSmsVictoryBackgroundToFacts(
      await loadSmsVictoryBackgroundContext({
        clerkUserId: args.userId,
        commitmentId: args.commitment.id,
        timezone: args.timezone,
      })
    );
  } catch (e) {
    console.warn("[sms-inbound-coach] victory_background_load_failed_transactional", {
      clerk_user_id: args.userId,
      commitment_id: args.commitment.id,
      message: e instanceof Error ? e.message : String(e),
    });
  }
  const convPack = await buildV2SmsConversationContextPack({
    clerkUserId: args.userId,
    commitmentId: args.commitment.id,
    commitment: args.commitment,
    timezone: args.timezone,
    currentInboundText: args.inboundRaw,
    preloadedCoachingMemory: coachingMemoryRow,
    preloadedEventsNewestFirst: recentEvents,
  });
  const classification = classifyV2InboundReply(args.inboundRaw.trim());
  const latestCheckEv = recentEvents.find((e) => e.event_type === "check_sent");
  const checkPayload = (latestCheckEv?.payload_json ?? {}) as Record<string, unknown>;
  const lastOut =
    typeof checkPayload.body_preview === "string" && checkPayload.body_preview.trim().length > 0
      ? checkPayload.body_preview.trim().slice(0, 260)
      : null;
  const preferredName = await fetchPreferredNameForInboundLane(args.userId);
  const northStarFinalEventType =
    args.gatedDecisionOverride != null
      ? args.gatedDecisionOverride.final_event_type ?? null
      : classification.eventType;
  const northStarPkt = buildInboundNorthStarContextPacket({
    commitmentId: args.commitment.id,
    behaviorStatement: args.commitment.behavior_statement ?? "",
    effectiveAskText: getEffectiveCoachingAsk(args.commitment, Date.now()),
    timezone: args.timezone,
    userMessage: args.inboundRaw,
    lastOutboundSmsPreview: lastOut,
    checkPayload,
    recentEvents,
    convPack,
    coachingMemory: coachingMemoryRow,
    finalEventType: northStarFinalEventType,
    lifeDesires: null,
    peopleSummary: null,
    identityAnchorText: null,
    latestBlockerPreview: null,
  });
  const minimalLines = buildMinimalInboundTranscriptLines(convPack, args.inboundRaw, lastOut);
  const relationshipTone =
    coachingMemoryRow?.sms_relationship_profile != null
      ? JSON.stringify(coachingMemoryRow.sms_relationship_profile).slice(0, 240)
      : null;
  const forcedCoachSms =
    convPack &&
    !isLikelySmsComplianceOrOptOutTurn(args.inboundRaw) &&
    !isLikelyCommitmentChangeIntentTurn(args.inboundRaw) &&
    !isV2PendingProposalValid(args.commitment)
      ? tryBuildForcedInboundCoachSms({
          userMessage: args.inboundRaw,
          gatedDecision: V3_REFINE_ONLY_GATED,
          lastOutboundSmsPreview: lastOut,
          eventsNewestFirst: recentEvents,
          effectiveAskFloor: getEffectiveCoachingAsk(args.commitment, Date.now()),
          messageSid: args.job.message_sid,
        })
      : null;

  const patternSignal = deriveSmsPatternSignal({
    eventsNewestFirst: recentEvents,
    coachingMemory: coachingMemoryRow,
    patRead: transactionalVictoryBackgroundFacts?.pat_read_pattern
      ? {
          pattern_text: transactionalVictoryBackgroundFacts.pat_read_pattern,
          pattern_confidence: null,
        }
      : null,
    inboundRaw: args.inboundRaw,
    nowMs: Date.now(),
  });

  const pendingResolutionInbound = getPendingResolutionOrNull(args.commitment);
  const goalAdjustmentSignal = deriveSmsGoalAdjustmentSignal({
    eventsNewestFirst: recentEvents,
    coachingMemory: coachingMemoryRow,
    patternSignal,
    overlayState: {
      proposalPending: isV2PendingProposalValid(args.commitment, Date.now()),
      overlayActive: isV2AdaptiveOverlayActive(args.commitment, Date.now()),
      effectiveAskDiffers:
        getEffectiveCoachingAsk(args.commitment, Date.now()).trim() !==
        args.commitment.behavior_statement.trim(),
    },
    pendingResolution: pendingResolutionInbound
      ? {
          kind: pendingResolutionInbound.kind,
          sms_state:
            pendingResolutionInbound.payload?.source === "sms_inbound"
              ? (pendingResolutionInbound.payload.sms_state ?? null)
              : null,
        }
      : null,
    evolutionEval: {
      recommended_action: evaluateCommitmentEvolutionForSms({
        commitment: args.commitment,
        eventsNewestFirst: recentEvents,
        nowMs: Date.now(),
      }).recommended_action,
    },
    inboundRaw: args.inboundRaw,
    nowMs: Date.now(),
  });

  const facts = buildInboundV3RelationshipFacts({
    clerkUserId: args.userId,
    preferredName,
    timezone: args.timezone,
    localTimeIso: new Date(new Date().toLocaleString("en-US", { timeZone: args.timezone })).toISOString(),
    commitment: args.commitment,
    effectiveAsk: getEffectiveCoachingAsk(args.commitment, Date.now()),
    userMessageRaw: args.inboundRaw,
    coalescedInboundText: args.inboundRaw,
    suppressedMessageSids: args.splitSuppressedMessageSids,
    transcriptLines: minimalLines,
    northStarPacket: northStarPkt,
    gatedDecision: args.gatedDecisionOverride ?? V3_REFINE_ONLY_GATED,
    deterministicEventType: args.deterministicClassifierOverride ?? classification.eventType,
    doNotRepeatHints: deriveDoNotRepeatHintsFromCoachingMemory(coachingMemoryRow),
    relationshipProfileSummary: relationshipTone,
    conversationBrain: { enabled: false },
    centralBrain: { shadow_stored: false },
    arc: { ambiguous_short_reply: false, clarification_required: false },
    phase5a: {
      central_tether_brain_enabled: shouldRunPhase5aCentralTetherBrain(),
      arc_clarify_brain_enabled: shouldRunPhase5aArcClarifyBrain(),
      inbound_stitched_final_enabled: shouldRunPhase5aInboundStitchedFinalBrain(),
    },
    forcedFutureStretchIntentActive: Boolean(forcedCoachSms),
    wave11MemoryConfirmationPending: args.wave11MemoryConfirmationPending,
    accountabilityProofHint: null,
    rejectedTimeCandidates: [],
    unavailableWindows: [],
    routePurpose: args.routePurpose,
    branchName: args.branchName,
    branchMigratedToLane: true,
    refreshFacts: args.refreshFacts ?? undefined,
    pendingResolutionFacts: args.pendingResolutionFacts ?? undefined,
    seasonTransitionFacts: args.seasonTransitionFacts ?? undefined,
    memoryConfirmationFacts: args.memoryConfirmationFacts ?? undefined,
    contractConsentFacts: args.contractConsentFacts ?? undefined,
    adaptiveConsentClarificationFacts: args.adaptiveConsentClarificationFacts ?? undefined,
    commitmentChangeFacts: args.commitmentChangeFacts ?? undefined,
    ...(args.pendingResolutionAppliedOverride !== undefined
      ? { pendingResolutionAppliedOverride: args.pendingResolutionAppliedOverride }
      : {}),
    victoryBackground: transactionalVictoryBackgroundFacts,
    relationshipMemoryPacket,
    patternSignal,
    goalAdjustmentSignal,
  });
  return { facts, contextPacket: northStarPkt };
}

async function persistInboundV3RelationshipLaneReplyReadyAndSend(args: {
  job: JobRow;
  userId: string;
  commitment: ActiveV2CommitmentRow;
  timezone: string;
  splitSuppressedMessageSids: string[];
  inboundRaw: string;
  relationshipFacts: InboundV3RelationshipFacts;
  telemetry_fact_sources: string[];
  northStarChannel: NorthStarCoachChannel;
  contextPacket: NorthStarSmsContextPacket;
  branchName: string;
  logTag: string;
  meaningShadow?: MeaningInterpreterShadowScheduleArgs | null;
}): Promise<{ ok: true; sentBody: string } | { ok: false }> {
  const lane = await produceInboundV3RelationshipSms({
    facts: args.relationshipFacts,
    telemetry_fact_sources: args.telemetry_fact_sources,
  });
  if (!lane.shouldSend || !lane.body.trim()) {
    if (args.meaningShadow) {
      registerInboundMeaningShadowPending({
        job: args.job,
        userId: args.userId,
        rawBody: args.inboundRaw,
        schedule: args.meaningShadow,
        extraFacts: buildEnrichedMeaningShadowFacts({
          routePurpose: args.relationshipFacts.route_purpose ?? null,
          branchName: args.branchName,
          v3NoSendReason: lane.noSendReason ?? null,
        }),
      });
    }
    await markJobFinal({
      messageSid: args.job.message_sid,
      status: "cancelled",
      lastError: formatInboundV3LaneNoSendLastError(lane, {
        route_purpose: args.relationshipFacts.route_purpose,
        branch_name: args.branchName,
        branch_migrated_to_lane: true,
      }),
      nextRetry: farFutureIso(),
    });
    console.warn(`[sms-inbound-coach] ${args.logTag}_inbound_lane_no_send`, {
      message_sid: args.job.message_sid,
      commitment_id: args.commitment.id,
      reason: lane.noSendReason,
    });
    return { ok: false };
  }
  const v3BrainMetadata: Record<string, unknown> = {
    ...lane.metadata,
    inbound_v3_relationship_lane: true,
    v3_lane_turn_purpose: lane.turnPurpose,
    route_purpose: args.relationshipFacts.route_purpose,
    branch_migrated_to_lane: true,
    branch_name: args.branchName,
    v3_candidate_body: lane.body,
    coaching_brief_v1: compactCoachingBriefV1ForV3Brain(
      buildCoachingBriefV1FromInboundFacts(args.relationshipFacts)
    ),
  };
  const voicePack = await northStarGatePersistBodyAsync(lane.body, {
    job: args.job,
    channel: args.northStarChannel,
    lastOutboundBody: args.contextPacket.latestOutboundBody ?? null,
    effectiveAsk: getEffectiveCoachingAsk(args.commitment, Date.now()),
    behaviorStatement: args.commitment.behavior_statement,
    finalEventType: args.contextPacket.finalEventType ?? null,
    replySource: "v3_inbound_relationship_lane",
    contextPacket: args.contextPacket,
    activeCommitmentId: args.commitment.id,
    normalCoaching: true,
    v3BrainMetadata,
  });
  if (!voicePack.voice.shouldSend) {
    if (args.meaningShadow) {
      registerInboundMeaningShadowPending({
        job: args.job,
        userId: args.userId,
        rawBody: args.inboundRaw,
        schedule: args.meaningShadow,
        extraFacts: buildEnrichedMeaningShadowFacts({
          routePurpose: args.relationshipFacts.route_purpose ?? null,
          branchName: args.branchName,
          v3NoSendReason: voicePack.voice.skipReason ?? "final_voice_gate_no_send",
        }),
      });
    }
    await markJobFinal({
      messageSid: args.job.message_sid,
      status: "cancelled",
      lastError: finalVoiceSkipLastError(voicePack.voice, {
        route_purpose: args.relationshipFacts.route_purpose,
        branch_name: args.branchName,
        branch_migrated_to_lane: true,
        v3_lane_reply_source: "v3_inbound_relationship_lane",
        v3_candidate_body: lane.body.slice(0, 500),
        lane_metadata: lane.metadata,
        north_star_gate: {
          original_body: voicePack.northStarMeta.originalBody,
          final_body: voicePack.northStarVisibleBody,
          north_star_gate_source: voicePack.northStarMeta.source,
          north_star_gate_reasons: voicePack.northStarMeta.blockedReasons,
          ...pickNorthStarWriterAttributionFields(voicePack.northStarMeta),
        },
        final_voice_gate: voicePack.voice.metadata,
        should_send: false,
      }),
      nextRetry: farFutureIso(),
    });
    console.warn(`[sms-inbound-coach] ${args.logTag}_final_voice_suppressed`, {
      message_sid: args.job.message_sid,
    });
    return { ok: false };
  }
  const gatedBody = voicePack.voice.body;
  const threadMemoryCtx: InboundCoachReplyThreadMemoryContext = {
    commitmentId: args.commitment.id,
    expectedAnswerType: args.relationshipFacts.thread.expected_reply_semantics,
    meaningShadow: args.meaningShadow ?? null,
  };
  const now = new Date().toISOString();
  const { data: persistedLane } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      reply_body: gatedBody,
      status: "reply_ready",
      next_retry_at: now,
      updated_at: now,
      last_error: null,
    })
    .eq("message_sid", args.job.message_sid)
    .eq("status", "processing")
    .select()
    .maybeSingle();

  if (!persistedLane) {
    const j2 = await loadJob(args.job.message_sid);
    if (j2?.reply_body?.trim()) {
      await commitAndSendInboundCoachReply(j2, args.userId, threadMemoryCtx);
      return { ok: true, sentBody: j2.reply_body.trim() };
    }
    throw new Error(`${args.logTag}_reply_ready_persist_failed`);
  }
  const fresh = (await loadJob(args.job.message_sid)) ?? args.job;
  await commitAndSendInboundCoachReply(fresh, args.userId, threadMemoryCtx);
  console.info(`[sms-inbound-coach] ${args.logTag}_lane_sent`, {
    message_sid: args.job.message_sid,
    commitment_id: args.commitment.id,
    inbound_v3_lane_used: true,
    route_purpose: args.relationshipFacts.route_purpose,
    branch_migrated_to_lane: true,
    branch_name: args.branchName,
    v3_lane_reply_source: "v3_inbound_relationship_lane",
    v3_candidate_body: gatedBody.slice(0, 500),
    refresh_facts_summary: slimRefreshFactsForTelemetry(args.relationshipFacts.refresh_facts ?? null),
    pending_resolution_facts_summary: slimPendingResolutionFactsForTelemetry(
      args.relationshipFacts.pending_resolution_facts ?? null
    ),
    memory_confirmation_facts_summary: slimMemoryConfirmationFactsForTelemetry(
      args.relationshipFacts.memory_confirmation_facts ?? null
    ),
    required_verbatim_substrings: args.relationshipFacts.constraints.required_verbatim_substrings ?? null,
    required_meaning_summary: args.relationshipFacts.constraints.required_meaning_summary ?? null,
    north_star_gate: {
      original_body: voicePack.northStarMeta.originalBody,
      final_body: voicePack.northStarVisibleBody,
      north_star_gate_source: voicePack.northStarMeta.source,
      north_star_gate_reasons: voicePack.northStarMeta.blockedReasons,
      ...pickNorthStarWriterAttributionFields(voicePack.northStarMeta),
    },
    final_voice_gate: voicePack.voice.metadata,
    should_send: true,
    twilio_send_attempted: true,
  });
  return { ok: true, sentBody: gatedBody };
}

const REFRESH_LANE_SUMMARY = {
  alreadyApplied: "Server reports this refresh inbound was already applied for the active step.",
  inactiveIdentity: "No active identity refresh step matched this reply.",
  inactiveCommitment: "No active commitment refresh step matched this reply.",
  identityStillAdvance: "User confirmed identity still fits; server advanced refresh session toward commitment alignment.",
  identityChangeHandoff: "User chose to change identity context; server opened guided resolution handoff.",
  identityClarify: "Ambiguous identity refresh reply; server consumed a clarification turn and re-prompted.",
  identityAborted: "Identity refresh clarifications exhausted; server closed the step without saving ambiguous context.",
  commitmentKeep: "User chose to keep the current daily commitment bar; server recorded keep.",
  commitmentTightenHandoff: "User chose to tighten the bar; server opened guided tighten flow.",
  commitmentNewHandoff: "User chose a new daily bar; server opened guided replace flow.",
  commitmentClarify: "Ambiguous commitment refresh reply; server consumed a clarification turn and re-prompted.",
  commitmentAborted: "Commitment refresh clarifications exhausted; server closed the step without overwriting the bar.",
} as const;

const REFRESH_LANE_INTENTS = {
  identity_already_applied: {
    routePurpose: "refresh_identity" as const,
    branchName: "refresh_identity_already_applied",
    summary: REFRESH_LANE_SUMMARY.alreadyApplied,
  },
  identity_inactive_step: {
    routePurpose: "refresh_identity" as const,
    branchName: "refresh_identity_inactive_step",
    summary: REFRESH_LANE_SUMMARY.inactiveIdentity,
  },
  identity_still_commitment_prompt: {
    routePurpose: "refresh_commitment" as const,
    branchName: "refresh_identity_still_commitment_prompt",
    summary: REFRESH_LANE_SUMMARY.identityStillAdvance,
  },
  identity_change_handoff: {
    routePurpose: "refresh_identity" as const,
    branchName: "refresh_identity_change_guided_handoff",
    summary: REFRESH_LANE_SUMMARY.identityChangeHandoff,
  },
  identity_clarify_prompt: {
    routePurpose: "refresh_clarification" as const,
    branchName: "refresh_identity_clarify_reprompt",
    summary: REFRESH_LANE_SUMMARY.identityClarify,
  },
  identity_aborted_unclear: {
    routePurpose: "refresh_identity" as const,
    branchName: "refresh_identity_aborted_unclear",
    summary: REFRESH_LANE_SUMMARY.identityAborted,
  },
  commitment_already_applied: {
    routePurpose: "refresh_commitment" as const,
    branchName: "refresh_commitment_already_applied",
    summary: REFRESH_LANE_SUMMARY.alreadyApplied,
  },
  commitment_inactive_step: {
    routePurpose: "refresh_commitment" as const,
    branchName: "refresh_commitment_inactive_step",
    summary: REFRESH_LANE_SUMMARY.inactiveCommitment,
  },
  commitment_keep_ack: {
    routePurpose: "refresh_confirmation" as const,
    branchName: "refresh_commitment_keep_ack",
    summary: REFRESH_LANE_SUMMARY.commitmentKeep,
  },
  commitment_tighten_handoff: {
    routePurpose: "refresh_commitment" as const,
    branchName: "refresh_commitment_tighten_handoff",
    summary: REFRESH_LANE_SUMMARY.commitmentTightenHandoff,
  },
  commitment_new_handoff: {
    routePurpose: "refresh_commitment" as const,
    branchName: "refresh_commitment_new_handoff",
    summary: REFRESH_LANE_SUMMARY.commitmentNewHandoff,
  },
  commitment_clarify_prompt: {
    routePurpose: "refresh_clarification" as const,
    branchName: "refresh_commitment_clarify_reprompt",
    summary: REFRESH_LANE_SUMMARY.commitmentClarify,
  },
  commitment_aborted_unclear: {
    routePurpose: "refresh_commitment" as const,
    branchName: "refresh_commitment_aborted_unclear",
    summary: REFRESH_LANE_SUMMARY.commitmentAborted,
  },
} as const;

type RefreshLaneIntent = keyof typeof REFRESH_LANE_INTENTS;

async function persistRefreshSmsLaneAndSend(args: {
  job: JobRow;
  userId: string;
  commitment: ActiveV2CommitmentRow;
  timezone: string;
  machineBody: string;
  inboundRaw: string;
  laneIntent: RefreshLaneIntent;
}): Promise<{ ok: true; sentBody: string } | { ok: false }> {
  const meta = REFRESH_LANE_INTENTS[args.laneIntent];
  const session = parseRefreshSession(args.commitment.refresh_session);
  const token =
    session != null
      ? parseRefreshInboundWithNaturalLanguage(args.inboundRaw.trim(), session.step)
      : "UNKNOWN";
  const exactToken = parseRefreshInboundToken(args.inboundRaw.trim());
  const refreshFacts: InboundV3RefreshFacts = {
    refresh_step: session?.step ?? "unknown",
    expected_answer: exactToken !== "UNKNOWN" ? exactToken : String(token),
    user_answer_type: String(token),
    state_transition_summary: meta.summary,
    legacy_refresh_reply_preview: args.machineBody.trim().slice(0, 500),
  };
  const { facts, contextPacket } = await buildTransactionalInboundLaneFactsPackage({
    job: args.job,
    userId: args.userId,
    commitment: args.commitment,
    timezone: args.timezone,
    inboundRaw: args.inboundRaw,
    splitSuppressedMessageSids: [],
    routePurpose: meta.routePurpose,
    branchName: meta.branchName,
    wave11MemoryConfirmationPending: false,
    refreshFacts,
  });
  return persistInboundV3RelationshipLaneReplyReadyAndSend({
    job: args.job,
    userId: args.userId,
    commitment: args.commitment,
    timezone: args.timezone,
    splitSuppressedMessageSids: [],
    inboundRaw: args.inboundRaw,
    relationshipFacts: facts,
    telemetry_fact_sources: [
      "parseRefreshSession",
      "classifyV2InboundReply",
      "buildInboundNorthStarContextPacket",
      "buildMinimalInboundTranscriptLines",
      "v2_refresh_machine_body_legacy_preview_only",
    ],
    northStarChannel: "refresh",
    contextPacket,
    branchName: meta.branchName,
    logTag: "refresh",
    meaningShadow: buildCoachingRefreshMeaningShadow({
      commitmentId: args.commitment.id,
      refreshStep: session?.step ?? "unknown",
      userAnswerToken: exactToken !== "UNKNOWN" ? exactToken : String(token),
      classifierEventType: classifyV2InboundReply(args.inboundRaw.trim()).eventType,
    }),
  });
}

/**
 * Wave 9.1 — After SMS pending-resolution handler runs, merge bounded memory snapshot into payload (CAS).
 */
async function mergeInboundMemoryIntoSmsPendingResolution(args: {
  job: JobRow;
  userId: string;
  commitmentAfterHandle: ActiveV2CommitmentRow;
  timezone: string;
}): Promise<void> {
  if (!isV2InboundMemorySignalsEnabled()) return;
  const raw = (args.job.raw_body || "").trim();
  if (!shouldAttemptInboundMemorySignalInterpretation(raw, { forceBecauseInterpretation: false })) return;

  const c = (await getActiveCommitment(args.userId)) ?? args.commitmentAfterHandle;
  if (!isSmsInboundPendingResolutionActionable(c)) return;
  const pend = getPendingResolutionOrNull(c);
  if (!pend?.payload || pend.payload.source !== "sms_inbound") return;

  const { data: pr } = await supabaseServer
    .from("user_profiles")
    .select("preferred_name, people_summary, responsibility, identity_anchor_text, identity_source")
    .eq("clerk_user_id", args.userId)
    .maybeSingle();

  const preferredName =
    typeof pr?.preferred_name === "string" ? pr.preferred_name : null;
  const peopleSummary =
    typeof pr?.people_summary === "string" && pr.people_summary.trim()
      ? pr.people_summary.trim()
      : null;
  const responsibility =
    typeof pr?.responsibility === "string" && pr.responsibility.trim()
      ? pr.responsibility.trim()
      : null;
  const identityAnchorText =
    typeof pr?.identity_anchor_text === "string" ? pr.identity_anchor_text.trim() : null;
  const profileIdentitySource =
    typeof pr?.identity_source === "string" ? pr.identity_source.trim() : null;

  const coachingMemory = await loadV2CoachingMemoryForPrompt(c.id);
  const recentEvents = await getRecentV2EventsForAi(c.id);
  const convPack = await buildV2SmsConversationContextPack({
    clerkUserId: args.userId,
    commitmentId: c.id,
    commitment: c,
    timezone: args.timezone,
    currentInboundText: raw,
    preloadedCoachingMemory: coachingMemory,
    preloadedEventsNewestFirst: recentEvents,
  });

  const memRes = await interpretV2InboundMemorySignals({
    userMessage: raw,
    commitment: c,
    coachingMemory,
    preferredName,
    peopleSummaryToneHint: peopleSummary,
    responsibilityToneHint: responsibility,
    identityAnchorQuotablePreview:
      identityAnchorText && isQuotableIdentitySource(profileIdentitySource)
        ? identityAnchorText.slice(0, 200)
        : null,
    identitySource: profileIdentitySource,
    recentSmsContextBlock: convPack.promptBlock,
    effectiveAsk: getEffectiveCoachingAsk(c),
  });

  const stored = buildStoredMemorySignalPayload({ result: memRes });
  if (stored.memory_signal_detected !== true) return;

  const merged = await mergeSmsPendingResolutionPayload({
    commitmentId: c.id,
    merge: (prev) => ({
      ...prev,
      memory_signal_snapshot: pickBoundedMemorySnapshotForPending(stored),
      last_inbound_memory_signal_at: new Date().toISOString(),
    }),
  });

  if (!merged.ok) {
    console.warn("[v9.1-memory-signals] sms_pending_merge_failed", {
      commitment_id: c.id,
      error: merged.error,
    });
  }
}

/**
 * Wave 11 — Reply to pending memory confirmation (identity / relationship) before normal accountability.
 * Does not consume strong yes/no/partial accountability classifications.
 */
async function processV2MemoryConfirmationInbound(
  job: JobRow,
  userId: string,
  commitment: ActiveV2CommitmentRow,
  timezone: string,
  classification: ReturnType<typeof classifyV2InboundReply>
): Promise<boolean> {
  if (!isV2InboundMemorySignalsEnabled()) return false;
  const raw = (job.raw_body || "").trim();
  if (!raw) return false;

  const lowSys = raw.trim().toLowerCase();
  if (/^(stop|start|help|unstop|cancel)$/i.test(lowSys)) {
    return false;
  }

  if (isStrongV2YesNoOutcome(classification.eventType)) {
    return false;
  }

  const pending = await fetchLatestAwaitingMemoryConfirmation(commitment.id);
  if (!pending) return false;

  const replyKind = parseMemoryConfirmationReply(raw);

  const candidateSummary = JSON.stringify({
    pending_kind: pending.pendingKind,
    has_identity_candidate: Boolean(pending.candidateIdentityAnchorText?.trim()),
    has_people_candidate: Boolean(pending.candidatePeopleSummary?.trim()),
    has_responsibility_candidate: Boolean(pending.candidateResponsibility?.trim()),
  }).slice(0, 400);

  if (replyKind === "ambiguous") {
    const legacyMachine =
      "Should I remember that going forward, or leave the current profile as-is?";
    const memFacts: InboundV3MemoryConfirmationFacts = {
      pending_memory_kind: pending.pendingKind,
      candidate_memory_fields: candidateSummary,
      user_confirmation_parse: "ambiguous",
      memory_applied: false,
      memory_declined: false,
      ambiguous: true,
      legacy_memory_reply_preview: legacyMachine,
      memory_proof_structured_hint: null,
    };
    const { facts, contextPacket } = await buildTransactionalInboundLaneFactsPackage({
      job,
      userId,
      commitment,
      timezone,
      inboundRaw: raw,
      splitSuppressedMessageSids: [],
      routePurpose: "memory_clarification",
      branchName: "wave11_memory_ambiguous",
      wave11MemoryConfirmationPending: true,
      memoryConfirmationFacts: memFacts,
    });
    const sendAmb = await persistInboundV3RelationshipLaneReplyReadyAndSend({
      job,
      userId,
      commitment,
      timezone,
      splitSuppressedMessageSids: [],
      inboundRaw: raw,
      relationshipFacts: facts,
      telemetry_fact_sources: [
        "fetchLatestAwaitingMemoryConfirmation",
        "parseMemoryConfirmationReply",
        "v2_memory_confirmation_machine_legacy_preview_only",
      ],
      northStarChannel: "memory_confirmation",
      contextPacket,
      branchName: "wave11_memory_ambiguous",
      logTag: "memory_clarification",
      meaningShadow: buildMemoryConfirmationMeaningShadow({
        commitmentId: commitment.id,
        route: MEANING_INTERPRETER_ROUTES.memory_clarification,
        memoryPendingKind: pending.pendingKind,
        confirmationParse: "ambiguous",
        memoryApplied: false,
        classifierEventType: classification.eventType,
      }),
    });
    if (!sendAmb.ok) {
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      return true;
    }
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    await insertWave11MemoryResolutionEvent({
      commitmentId: commitment.id,
      clerkUserId: userId,
      inboundMessageSid: job.message_sid,
      resolvedPendingSourceMessageSid: pending.sourceMessageSid,
      outcome: "ambiguous_clarify",
      priorEventId: pending.eventId,
      appliedIdentity: false,
      appliedPeopleSummary: false,
      appliedResponsibility: false,
    });
    return true;
  }

  if (replyKind === "no") {
    const legacyDecline = "Got it — I won’t save that. We’ll keep the current context.";
    const memFacts: InboundV3MemoryConfirmationFacts = {
      pending_memory_kind: pending.pendingKind,
      candidate_memory_fields: candidateSummary,
      user_confirmation_parse: "no",
      memory_applied: false,
      memory_declined: true,
      ambiguous: false,
      legacy_memory_reply_preview: legacyDecline,
      memory_proof_structured_hint: null,
    };
    const { facts, contextPacket } = await buildTransactionalInboundLaneFactsPackage({
      job,
      userId,
      commitment,
      timezone,
      inboundRaw: raw,
      splitSuppressedMessageSids: [],
      routePurpose: "memory_decline",
      branchName: "wave11_memory_declined",
      wave11MemoryConfirmationPending: true,
      memoryConfirmationFacts: memFacts,
    });
    const sendDecl = await persistInboundV3RelationshipLaneReplyReadyAndSend({
      job,
      userId,
      commitment,
      timezone,
      splitSuppressedMessageSids: [],
      inboundRaw: raw,
      relationshipFacts: facts,
      telemetry_fact_sources: [
        "fetchLatestAwaitingMemoryConfirmation",
        "parseMemoryConfirmationReply",
        "v2_memory_confirmation_machine_legacy_preview_only",
      ],
      northStarChannel: "memory_confirmation",
      contextPacket,
      branchName: "wave11_memory_declined",
      logTag: "memory_decline",
      meaningShadow: buildMemoryConfirmationMeaningShadow({
        commitmentId: commitment.id,
        route: MEANING_INTERPRETER_ROUTES.memory_confirmation,
        memoryPendingKind: pending.pendingKind,
        confirmationParse: "no",
        memoryApplied: false,
        classifierEventType: classification.eventType,
      }),
    });
    if (!sendDecl.ok) {
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      return true;
    }
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    await insertWave11MemoryResolutionEvent({
      commitmentId: commitment.id,
      clerkUserId: userId,
      inboundMessageSid: job.message_sid,
      resolvedPendingSourceMessageSid: pending.sourceMessageSid,
      outcome: "declined",
      priorEventId: pending.eventId,
      appliedIdentity: false,
      appliedPeopleSummary: false,
      appliedResponsibility: false,
    });
    return true;
  }

  const applied = await applyWave11ConfirmedProfileUpdates({ clerkUserId: userId, pending });
  const anyApplied = applied.appliedIdentity || applied.appliedPeopleSummary || applied.appliedResponsibility;

  const legacyAck = anyApplied
    ? "Got it. I’ll remember that going forward."
    : "I couldn’t safely save that from what we have on file. We’ll keep your current profile as-is.";

  const memProofMeta = anyApplied
    ? buildProofMomentForMemoryUpdated({
        appliedIdentity: applied.appliedIdentity,
        appliedPeopleSummary: applied.appliedPeopleSummary,
        appliedResponsibility: applied.appliedResponsibility,
      })
    : null;
  const proofHint =
    memProofMeta != null ? JSON.stringify(proofMomentPayloadFields(memProofMeta)).slice(0, 500) : null;

  const memFacts: InboundV3MemoryConfirmationFacts = {
    pending_memory_kind: pending.pendingKind,
    candidate_memory_fields: candidateSummary,
    user_confirmation_parse: "yes",
    memory_applied: anyApplied,
    memory_declined: false,
    ambiguous: false,
    legacy_memory_reply_preview: legacyAck,
    memory_proof_structured_hint: proofHint,
  };
  const { facts, contextPacket } = await buildTransactionalInboundLaneFactsPackage({
    job,
    userId,
    commitment,
    timezone,
    inboundRaw: raw,
    splitSuppressedMessageSids: [],
    routePurpose: "memory_confirmation",
    branchName: "wave11_memory_confirmed",
    wave11MemoryConfirmationPending: true,
    memoryConfirmationFacts: memFacts,
  });
  const sendYes = await persistInboundV3RelationshipLaneReplyReadyAndSend({
    job,
    userId,
    commitment,
    timezone,
    splitSuppressedMessageSids: [],
    inboundRaw: raw,
    relationshipFacts: facts,
    telemetry_fact_sources: [
      "fetchLatestAwaitingMemoryConfirmation",
      "parseMemoryConfirmationReply",
      "applyWave11ConfirmedProfileUpdates",
      "v2_memory_confirmation_machine_legacy_preview_only",
    ],
    northStarChannel: "memory_confirmation",
    contextPacket,
    branchName: "wave11_memory_confirmed",
    logTag: "memory_confirmation",
    meaningShadow: buildMemoryConfirmationMeaningShadow({
      commitmentId: commitment.id,
      route: MEANING_INTERPRETER_ROUTES.memory_confirmation,
      memoryPendingKind: pending.pendingKind,
      confirmationParse: "yes",
      memoryApplied: anyApplied,
      classifierEventType: classification.eventType,
    }),
  });
  if (!sendYes.ok) {
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    return true;
  }
  await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
  if (anyApplied) {
    await recomputeV2CoachingMemory(commitment.id, {
      reasonCode: "wave11_sms_memory_confirmation",
    });
  }
  await insertWave11MemoryResolutionEvent({
    commitmentId: commitment.id,
    clerkUserId: userId,
    inboundMessageSid: job.message_sid,
    resolvedPendingSourceMessageSid: pending.sourceMessageSid,
    outcome: "confirmed",
    priorEventId: pending.eventId,
    appliedIdentity: applied.appliedIdentity,
    appliedPeopleSummary: applied.appliedPeopleSummary,
    appliedResponsibility: applied.appliedResponsibility,
  });
  return true;
}

/**
 * Wave 4.1 — SMS pending tighten/replace completion before accountability scoring or overlay consent.
 */
async function processV2SmsInboundPendingResolution(
  job: JobRow,
  userId: string,
  commitment: ActiveV2CommitmentRow,
  timezone: string
): Promise<boolean> {
  let c = commitment;
  const reloaded = await getActiveCommitment(userId);
  if (reloaded) c = reloaded;

  if (!isSmsInboundPendingResolutionActionable(c)) {
    return false;
  }

  const pendBefore = getPendingResolutionOrNull(c);
  const result = await tryHandleSmsInboundPendingResolution({
    job: { message_sid: job.message_sid, raw_body: job.raw_body },
    clerkUserId: userId,
    commitment: c,
  });

  if (!result.handled) {
    return false;
  }

  const rawPr = (job.raw_body || "").trim();
  const cAfter = (await getActiveCommitment(userId)) ?? c;
  const classificationPr = classifyV2InboundReply(rawPr);
  const pendingVisible = result.replyBody.trim();
  const snapshot = JSON.stringify({
    title: cAfter.title,
    behavior_preview: (cAfter.behavior_statement ?? "").slice(0, 160),
    effective_ask: getEffectiveCoachingAsk(cAfter, Date.now()).slice(0, 200),
    pending_cleared: !isSmsInboundPendingResolutionActionable(cAfter),
    pending_kind_after: getPendingResolutionOrNull(cAfter)?.kind ?? null,
  }).slice(0, 900);

  const pendingCleared = !isSmsInboundPendingResolutionActionable(cAfter);
  const pendingReplaceApplied =
    pendBefore != null &&
    pendBefore.kind === "commitment_replace" &&
    computePendingCommitmentReplaceApplied({
      commitmentBefore: c,
      commitmentAfter: cAfter,
    });

  const pendingFacts: InboundV3PendingResolutionFacts = {
    resolution_type: pendBefore?.kind ?? "unknown",
    pending_action: pendBefore?.kind ?? "unknown",
    user_answer_type: classificationPr.eventType,
    state_transition_summary: pendingReplaceApplied
      ? `SMS pending-resolution replace applied; canonical commitment updated (pending_cleared=${pendingCleared}).`
      : `SMS pending-resolution handler finished for ${pendBefore?.kind ?? "unknown"}; pending still active or unchanged (pending_cleared=${pendingCleared}).`,
    updated_commitment_snapshot: snapshot,
    legacy_pending_reply_preview: pendingVisible.slice(0, 500),
  };
  const seasonTransitionFacts = buildInboundSeasonTransitionFacts(result.seasonMutation);

  const wave11MemoryPending =
    (await fetchLatestAwaitingMemoryConfirmation(cAfter.id)) != null;

  const { facts, contextPacket } = await buildTransactionalInboundLaneFactsPackage({
    job,
    userId,
    commitment: cAfter,
    timezone,
    inboundRaw: rawPr,
    splitSuppressedMessageSids: [],
    routePurpose: "pending_resolution",
    branchName: "sms_pending_resolution_complete",
    wave11MemoryConfirmationPending: wave11MemoryPending,
    pendingResolutionFacts: pendingFacts,
    seasonTransitionFacts,
    pendingResolutionAppliedOverride: pendingReplaceApplied,
  });

  const sendStill = await persistInboundV3RelationshipLaneReplyReadyAndSend({
    job,
    userId,
    commitment: cAfter,
    timezone,
    splitSuppressedMessageSids: [],
    inboundRaw: rawPr,
    relationshipFacts: facts,
    telemetry_fact_sources: [
      "getPendingResolutionOrNull",
      "tryHandleSmsInboundPendingResolution",
      "classifyV2InboundReply",
      "v2_pending_resolution_legacy_reply_preview_only",
    ],
    northStarChannel: "pending_resolution",
    contextPacket,
    branchName: "sms_pending_resolution_complete",
    logTag: "pending_resolution",
    meaningShadow: buildPendingResolutionMeaningShadow({
      commitmentId: cAfter.id,
      pendingKind: pendBefore?.kind ?? null,
      userAnswerType: classificationPr.eventType,
      pendingApplied: pendingReplaceApplied,
      pendingCleared,
      seasonMutationKind: result.seasonMutation?.ok
        ? result.seasonMutation.seasonTransitionApplied
          ? "season_transition"
          : result.seasonMutation.sameSeasonGoalSnapshotSynced
            ? "same_season_sync"
            : "mutation_ok"
        : null,
      behaviorStatement: cAfter.behavior_statement ?? null,
    }),
  });

  if (!sendStill.ok) {
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    return true;
  }

  await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
  await mergeInboundMemoryIntoSmsPendingResolution({
    job,
    userId,
    commitmentAfterHandle: cAfter,
    timezone,
  });
  return true;
}

/**
 * Strict refresh-session SMS flow (no AI interpretation of tokens).
 * Returns true when this inbound was fully handled as refresh traffic.
 */
async function processV2CoachingRefreshInbound(
  job: JobRow,
  userId: string,
  commitment: ActiveV2CommitmentRow,
  timezone: string
): Promise<boolean> {
  const session = parseRefreshSession(commitment.refresh_session);
  if (!session) return false;
  let expectedCommitmentUpdatedAt = commitment.updated_at;

  const rawTrimmed = (job.raw_body || "").trim();
  const exactToken = parseRefreshInboundToken(rawTrimmed);
  const token = parseRefreshInboundWithNaturalLanguage(rawTrimmed, session.step);
  if (exactToken === "UNKNOWN" && token !== "UNKNOWN") {
    console.info("[sms-inbound-coach] refresh_natural_language_mapped", {
      step: session.step,
      resolved: token,
    });
  }
  if (exactToken === "UNKNOWN" && token === "UNKNOWN") {
    console.info("[sms-inbound-coach] refresh_natural_language_unknown", { step: session.step });
  }

  if (session.step === "identity") {
    if (token === "STILL") {
      await bumpIdentityRefreshCycleAfterRefreshStillReply({ clerkUserId: userId });
      const still = await applyRefreshIdentityStepResolutionMutation({
        commitmentId: commitment.id,
        clerkUserId: userId,
        inboundMessageSid: job.message_sid,
        resolution: "still",
        expectedSessionId: session.session_id,
        expectedUpdatedAt: commitment.updated_at,
      });
      if (!still.ok) {
        if (still.result === "already_applied") {
          await persistRefreshSmsLaneAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "Already recorded from a prior reply in this thread. Normal checks continue.",
            laneIntent: "identity_already_applied",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (still.result === "state_conflict" || still.result === "not_found") {
          await persistRefreshSmsLaneAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "No active identity refresh step to update from this reply. Normal checks continue.",
            laneIntent: "identity_inactive_step",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        throw new Error(`refresh_identity_still_failed:${still.error}`);
      }
      const advanced = advanceSessionToCommitment(session, new Date().toISOString());
      expectedCommitmentUpdatedAt = typeof still.updatedAt === "string" ? still.updatedAt : null;
      const effectiveAsk = getEffectiveCoachingAsk(commitment, Date.now());
      const { body: stepB } = buildRefreshStepCommitmentSms({ effectiveAsk });
      const sendStill = await persistRefreshSmsLaneAndSend({
        job,
        userId,
        commitment,
        timezone,
        inboundRaw: rawTrimmed,
        machineBody: stepB,
        laneIntent: "identity_still_commitment_prompt",
      });
      if (!sendStill.ok) {
        await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
        return true;
      }
      const delivered: V2RefreshSessionState = {
        ...advanced,
        commitment_prompt_delivered: true,
      };
      const after = (await loadJob(job.message_sid)) ?? job;
      const outSid =
        typeof after.outbound_message_sid === "string" && after.outbound_message_sid.length > 0
          ? after.outbound_message_sid
          : null;
      if (outSid) {
        const booked = await applyRefreshPromptedPostSendBookkeepingMutation({
          commitmentId: commitment.id,
          clerkUserId: userId,
          messageSid: outSid,
          promptStep: "commitment",
          promptKind: "commitment_daily",
          bodyPreview: sendStill.sentBody.slice(0, 260),
          nextRefreshSession: delivered,
          expectedSessionId: delivered.session_id,
          expectedUpdatedAt: expectedCommitmentUpdatedAt,
        });
        if (!booked.ok) {
          throw new Error(`refresh_still_step_b_bookkeeping_failed:${booked.error}`);
        }
      }
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "inbound_refresh_still",
      });
      return true;
    }

    if (token === "CHANGE") {
      const change = await applyRefreshIdentityStepResolutionMutation({
        commitmentId: commitment.id,
        clerkUserId: userId,
        inboundMessageSid: job.message_sid,
        resolution: "change",
        expectedSessionId: session.session_id,
        expectedUpdatedAt: commitment.updated_at,
      });
      if (!change.ok) {
        if (change.result === "already_applied") {
          await persistRefreshSmsLaneAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "Already recorded from a prior reply in this thread. Normal checks continue.",
            laneIntent: "identity_already_applied",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (change.result === "state_conflict" || change.result === "not_found") {
          await persistRefreshSmsLaneAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "No active identity refresh step to update from this reply. Normal checks continue.",
            laneIntent: "identity_inactive_step",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        throw new Error(`refresh_identity_change_failed:${change.error}`);
      }
      const { body } = buildGuidedResolutionChangeHandoffSms();
      await persistRefreshSmsLaneAndSend({
        job,
        userId,
        commitment,
        timezone,
        inboundRaw: rawTrimmed,
        machineBody: body,
        laneIntent: "identity_change_handoff",
      });
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "inbound_refresh_change",
      });
      return true;
    }

    if (session.clarifications_remaining > 0) {
      const clarify = await applyRefreshIdentityStepResolutionMutation({
        commitmentId: commitment.id,
        clerkUserId: userId,
        inboundMessageSid: job.message_sid,
        resolution: "clarify_identity",
        expectedSessionId: session.session_id,
        expectedUpdatedAt: commitment.updated_at,
      });
      if (!clarify.ok) {
        if (clarify.result === "already_applied") {
          await persistRefreshSmsLaneAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "Already recorded from a prior reply in this thread. Normal checks continue.",
            laneIntent: "identity_already_applied",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (clarify.result === "state_conflict" || clarify.result === "not_found") {
          await persistRefreshSmsLaneAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "No active identity refresh step to update from this reply. Normal checks continue.",
            laneIntent: "identity_inactive_step",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        throw new Error(`refresh_identity_clarify_failed:${clarify.error}`);
      }
      const { body } = buildRefreshClarifyIdentitySms();
      await persistRefreshSmsLaneAndSend({
        job,
        userId,
        commitment,
        timezone,
        inboundRaw: rawTrimmed,
        machineBody: body,
        laneIntent: "identity_clarify_prompt",
      });
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "inbound_refresh_identity_clarify",
      });
      return true;
    }

    const abortIdentity = await applyRefreshIdentityStepResolutionMutation({
      commitmentId: commitment.id,
      clerkUserId: userId,
      inboundMessageSid: job.message_sid,
      resolution: "aborted_unclear",
      expectedSessionId: session.session_id,
      expectedUpdatedAt: commitment.updated_at,
    });
    if (!abortIdentity.ok) {
      if (abortIdentity.result === "already_applied") {
        await persistRefreshSmsLaneAndSend({
          job,
          userId,
          commitment,
          timezone,
          inboundRaw: rawTrimmed,
          machineBody:
            "Already recorded from a prior reply in this thread. Normal checks continue.",
          laneIntent: "identity_already_applied",
        });
        await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
        return true;
      }
      if (abortIdentity.result === "state_conflict" || abortIdentity.result === "not_found") {
        await persistRefreshSmsLaneAndSend({
          job,
          userId,
          commitment,
          timezone,
          inboundRaw: rawTrimmed,
          machineBody:
            "No active identity refresh step to update from this reply. Normal checks continue.",
          laneIntent: "identity_inactive_step",
        });
        await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
        return true;
      }
      throw new Error(`refresh_identity_aborted_unclear_failed:${abortIdentity.error}`);
    }
    await persistRefreshSmsLaneAndSend({
      job,
      userId,
      commitment,
      timezone,
      inboundRaw: rawTrimmed,
      machineBody:
        "Closing that alignment check for now—no changes saved from this thread. Normal checks continue.",
      laneIntent: "identity_aborted_unclear",
    });
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    await recomputeV2CoachingMemory(commitment.id, {
      reasonCode: "inbound_refresh_identity_aborted_unclear",
    });
    return true;
  }

  if (session.step === "commitment") {
    if (token === "KEEP") {
      const keep = await applyRefreshCommitmentStepResolutionMutation({
        commitmentId: commitment.id,
        clerkUserId: userId,
        inboundMessageSid: job.message_sid,
        resolution: "keep",
        expectedSessionId: session.session_id,
        expectedUpdatedAt: commitment.updated_at,
      });
      if (!keep.ok) {
        if (keep.result === "already_applied") {
          await persistRefreshSmsLaneAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "Already recorded from a prior reply in this thread. Normal checks continue.",
            laneIntent: "commitment_already_applied",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (keep.result === "state_conflict" || keep.result === "not_found") {
          await persistRefreshSmsLaneAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "No active commitment refresh step to update from this reply. Normal checks continue.",
            laneIntent: "commitment_inactive_step",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        throw new Error(`refresh_commitment_keep_failed:${keep.error}`);
      }
      await touchCommitmentRefreshPromptedTimestamp(commitment.id);
      const { body } = buildRefreshKeepAckSms();
      await persistRefreshSmsLaneAndSend({
        job,
        userId,
        commitment,
        timezone,
        inboundRaw: rawTrimmed,
        machineBody: body,
        laneIntent: "commitment_keep_ack",
      });
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "inbound_refresh_keep",
      });
      return true;
    }

    if (token === "TIGHTEN") {
      const tighten = await applyRefreshCommitmentStepResolutionMutation({
        commitmentId: commitment.id,
        clerkUserId: userId,
        inboundMessageSid: job.message_sid,
        resolution: "tighten",
        expectedSessionId: session.session_id,
        expectedUpdatedAt: commitment.updated_at,
      });
      if (!tighten.ok) {
        if (tighten.result === "already_applied") {
          await persistRefreshSmsLaneAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "Already recorded from a prior reply in this thread. Normal checks continue.",
            laneIntent: "commitment_already_applied",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (tighten.result === "state_conflict" || tighten.result === "not_found") {
          await persistRefreshSmsLaneAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "No active commitment refresh step to update from this reply. Normal checks continue.",
            laneIntent: "commitment_inactive_step",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        throw new Error(`refresh_commitment_tighten_failed:${tighten.error}`);
      }
      const { body } = buildGuidedTightenHandoffSms();
      await persistRefreshSmsLaneAndSend({
        job,
        userId,
        commitment,
        timezone,
        inboundRaw: rawTrimmed,
        machineBody: body,
        laneIntent: "commitment_tighten_handoff",
      });
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "inbound_refresh_tighten",
      });
      return true;
    }

    if (token === "NEW") {
      const replace = await applyRefreshCommitmentStepResolutionMutation({
        commitmentId: commitment.id,
        clerkUserId: userId,
        inboundMessageSid: job.message_sid,
        resolution: "new",
        expectedSessionId: session.session_id,
        expectedUpdatedAt: commitment.updated_at,
      });
      if (!replace.ok) {
        if (replace.result === "already_applied") {
          await persistRefreshSmsLaneAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "Already recorded from a prior reply in this thread. Normal checks continue.",
            laneIntent: "commitment_already_applied",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (replace.result === "state_conflict" || replace.result === "not_found") {
          await persistRefreshSmsLaneAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "No active commitment refresh step to update from this reply. Normal checks continue.",
            laneIntent: "commitment_inactive_step",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        throw new Error(`refresh_commitment_new_failed:${replace.error}`);
      }
      const { body } = buildGuidedResolutionNewHandoffSms();
      await persistRefreshSmsLaneAndSend({
        job,
        userId,
        commitment,
        timezone,
        inboundRaw: rawTrimmed,
        machineBody: body,
        laneIntent: "commitment_new_handoff",
      });
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "inbound_refresh_new",
      });
      return true;
    }

    if (session.clarifications_remaining > 0) {
      const nextSess = {
        ...session,
        clarifications_remaining: session.clarifications_remaining - 1,
      };
      expectedCommitmentUpdatedAt = await persistRefreshSession(commitment.id, nextSess, {
        expectedUpdatedAt: expectedCommitmentUpdatedAt,
      });
      const { body } = buildRefreshClarifyCommitmentSms();
      await persistRefreshSmsLaneAndSend({
        job,
        userId,
        commitment,
        timezone,
        inboundRaw: rawTrimmed,
        machineBody: body,
        laneIntent: "commitment_clarify_prompt",
      });
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "inbound_refresh_commitment_clarify",
      });
      return true;
    }

    const aborted = await applyRefreshCommitmentStepResolutionMutation({
      commitmentId: commitment.id,
      clerkUserId: userId,
      inboundMessageSid: job.message_sid,
      resolution: "aborted_unclear",
      expectedSessionId: session.session_id,
      expectedUpdatedAt: commitment.updated_at,
    });
    if (!aborted.ok) {
      if (aborted.result === "already_applied") {
        await persistRefreshSmsLaneAndSend({
          job,
          userId,
          commitment,
          timezone,
          inboundRaw: rawTrimmed,
          machineBody:
            "Already recorded from a prior reply in this thread. Normal checks continue.",
          laneIntent: "commitment_already_applied",
        });
        await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
        return true;
      }
      if (aborted.result === "state_conflict" || aborted.result === "not_found") {
        await persistRefreshSmsLaneAndSend({
          job,
          userId,
          commitment,
          timezone,
          inboundRaw: rawTrimmed,
          machineBody:
            "No active commitment refresh step to update from this reply. Normal checks continue.",
          laneIntent: "commitment_inactive_step",
        });
        await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
        return true;
      }
      throw new Error(`refresh_commitment_aborted_unclear_failed:${aborted.error}`);
    }
    await persistRefreshSmsLaneAndSend({
      job,
      userId,
      commitment,
      timezone,
      inboundRaw: rawTrimmed,
      machineBody:
        "Didn’t catch a clear answer on that. Normal checks continue—update the commitment in the app when you’re ready.",
      laneIntent: "commitment_aborted_unclear",
    });
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    await recomputeV2CoachingMemory(commitment.id, {
      reasonCode: "inbound_refresh_commitment_aborted_unclear",
    });
    return true;
  }

  return false;
}

async function processInboundSmsSafetyShortCircuit(
  job: JobRow,
  userId: string,
  commitmentId?: string | null
): Promise<boolean> {
  const raw = (job.raw_body || "").trim();
  if (!raw) return false;

  const safety = classifyInboundSmsSafetyTier(raw, {
    fromPhone: job.from_phone,
    messageSid: job.message_sid,
  });
  if (safety.tier === "safe") return false;

  const safetyBody = buildInboundSmsSafetyReplyBody(safety);
  let outboundSid: string | null = null;

  if (
    safety.shouldSendSafetyReply &&
    safetyBody &&
    !job.sent_at &&
    !job.outbound_message_sid
  ) {
    if (isTwilioReady()) {
      try {
        const sendResult = await sendSMSChunked({
          to: job.from_phone,
          body: safetyBody,
          lastOutbound: {
            clerkUserId: userId,
            messageKind: "coach",
          },
        });
        outboundSid =
          sendResult.firstSid && sendResult.firstSid.length > 0
            ? sendResult.firstSid
            : null;
      } catch (e) {
        console.error("[sms-inbound-coach] inbound_safety_send_failed", {
          message_sid: job.message_sid,
          reason_code: safety.reasonCode,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  recordInboundMeaningShadowSuppressedNoSend({
    job,
    userId,
    commitmentId: commitmentId ?? "",
    skipReason: "safety_turn",
    rawBody: raw,
    lastErrorTag: "inbound_safety_cron_short_circuit",
    routeOverride: MEANING_INTERPRETER_ROUTES.safety_short_circuit_skipped,
    extraFacts: buildSkippedMeaningShadowFacts({
      skipReason: "safety_turn",
      jobFinalStatus: "cancelled",
      lastErrorTag: "inbound_safety_cron_short_circuit",
      safetyTier: safety.tier,
    }),
  });
  await markJobFinal({
    messageSid: job.message_sid,
    status: "cancelled",
    lastError: inboundSmsSafetyLastErrorPayload(safety, "inbound_safety_cron_short_circuit", {
      safety_reply_sent: Boolean(outboundSid),
      outbound_message_sid: outboundSid,
    }),
    nextRetry: farFutureIso(),
  });

  console.info("[sms-inbound-coach] inbound_safety_cron_short_circuit", {
    ...safety.logSafe,
    clerk_user_id: userId,
    safety_reply_sent: Boolean(outboundSid),
  });

  return true;
}

async function handleV2SmsInboundCoachJob(
  job: JobRow,
  userId: string,
  commitment: ActiveV2CommitmentRow,
  timezone: string,
  splitSuppressedMessageSids: string[] = []
): Promise<void> {
  let c = commitment;

  try {
    const reconcile = await reconcileRefreshPostSendBookkeepingForCommitment({
      commitmentId: c.id,
      clerkUserId: userId,
    });
    if (reconcile.failures > 0) {
      console.warn("[sms-inbound-coach] refresh reconcile unresolved", {
        clerk_user_id: userId,
        commitment_id: c.id,
        attempted: reconcile.attempted,
        recovered: reconcile.recovered,
        failures: reconcile.failures,
        state_conflicts: reconcile.stateConflicts,
        rpc_failures: reconcile.rpcFailures,
        repeated_likely: reconcile.repeatedLikely,
        snapshot_candidates_found: reconcile.snapshotCandidatesFound,
        snapshot_replay_attempted: reconcile.snapshotReplayAttempted,
        snapshot_replay_applied: reconcile.snapshotReplayApplied,
        heuristic_fallback_attempted: reconcile.heuristicFallbackAttempted,
        heuristic_fallback_applied: reconcile.heuristicFallbackApplied,
        unresolved_after_both: reconcile.unresolvedAfterBoth,
      });
    }
    const refreshedAfterReconcile = await getActiveCommitment(userId);
    if (refreshedAfterReconcile) {
      c = refreshedAfterReconcile;
    }
  } catch (e) {
    console.error("[sms-inbound-coach] refresh post-send reconcile failed", {
      clerk_user_id: userId,
      commitment_id: c.id,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  if (isBlockerCapturePendingExpired(c)) {
    await clearBlockerCapturePending(c.id);
    c = { ...c, blocker_capture_expires_at: null, blocker_capture_after_event: null };
  }

  const rawInboundEarly = (job.raw_body || "").trim();
  if (isAppleMessengerTapbackLine(rawInboundEarly)) {
    recordInboundMeaningShadowSuppressedNoSend({
      job,
      userId,
      commitmentId: c.id,
      skipReason: "tapback_suppressed",
      rawBody: rawInboundEarly,
      lastErrorTag: "imessage_tapback_suppressed",
      routeOverride: MEANING_INTERPRETER_ROUTES.suppressed_tapback,
    });
    await markJobFinal({
      messageSid: job.message_sid,
      status: "cancelled",
      lastError: "imessage_tapback_suppressed",
      nextRetry: farFutureIso(),
    });
    console.log("[sms-inbound-coach] suppressed_apple_tapback_inbound", job.message_sid);
    return;
  }

  if (await processInboundSmsSafetyShortCircuit(job, userId, c.id)) {
    return;
  }

  const commsPrefsTurn = await applyInboundSmsCommsPreferencesFromMessage({
    clerkUserId: userId,
    messageSid: job.message_sid,
    body: rawInboundEarly || (job.raw_body || "").trim(),
    timezone,
  });

  if (isBlockerCapturePendingActive(c)) {
    const original = (job.raw_body || "").trim();
    if (!original) {
      await clearBlockerCapturePending(c.id);
      const cleared: ActiveV2CommitmentRow = {
        ...c,
        blocker_capture_expires_at: null,
        blocker_capture_after_event: null,
      };
      await processV2NormalInboundOutcome(
        job,
        userId,
        cleared,
        classifyV2InboundReply(""),
        timezone,
        splitSuppressedMessageSids,
        commsPrefsTurn
      );
      return;
    }

    const classification = classifyV2InboundReply(original);
    if (isStrongV2YesNoOutcome(classification.eventType)) {
      await clearBlockerCapturePending(c.id);
      const cleared: ActiveV2CommitmentRow = {
        ...c,
        blocker_capture_expires_at: null,
        blocker_capture_after_event: null,
      };
      await processV2NormalInboundOutcome(
        job,
        userId,
        cleared,
        classification,
        timezone,
        splitSuppressedMessageSids,
        commsPrefsTurn
      );
      return;
    }

    await processV2BlockerCapture(job, userId, c, original, timezone);
    return;
  }

  await clearStaleAdaptiveContractColumns(c.id);
  const reloadedCommitment = await getActiveCommitment(userId);
  if (reloadedCommitment) {
    c = reloadedCommitment;
  }

  if (await processV2CoachingRefreshInbound(job, userId, c, timezone)) {
    return;
  }

  if (await processV2SmsInboundPendingResolution(job, userId, c, timezone)) {
    return;
  }

  if (await processV2ContractProposalConsent(job, userId, c, timezone)) {
    return;
  }

  if (await handleAdaptiveProposalConsentAmbiguousInbound(job, userId, c, timezone)) {
    return;
  }

  const inboundClassification = classifyV2InboundReply((job.raw_body || "").trim());
  if (await processV2MemoryConfirmationInbound(job, userId, c, timezone, inboundClassification)) {
    return;
  }

  await processV2NormalInboundOutcome(
    job,
    userId,
    c,
    inboundClassification,
    timezone,
    splitSuppressedMessageSids,
    commsPrefsTurn
  );
}

type InboundCoachReplyThreadMemoryContext = {
  commitmentId: string;
  expectedAnswerType?: string | null;
  clearBindingOpenQuestion?: boolean;
  meaningShadow?: MeaningInterpreterShadowScheduleArgs | null;
};

/** Relationship/coaching inbound sends — always pass durable thread memory context (Slice 1+). */
async function commitAndSendInboundRelationshipCoachReply(
  job: JobRow,
  userId: string,
  ctx: {
    commitmentId: string;
    expectedAnswerType?: string | null;
    clearBindingOpenQuestion?: boolean;
    meaningShadow?: MeaningInterpreterShadowScheduleArgs | null;
  }
): Promise<void> {
  await commitAndSendInboundCoachReply(job, userId, {
    commitmentId: ctx.commitmentId,
    expectedAnswerType: ctx.expectedAnswerType ?? null,
    clearBindingOpenQuestion: ctx.clearBindingOpenQuestion === true,
    meaningShadow: ctx.meaningShadow ?? null,
  });
}

/** Finalize job: reply_ready → Twilio send → sent (shared by legacy coach path + V2). */
async function commitAndSendInboundCoachReply(
  job: JobRow,
  userId: string,
  threadMemory?: InboundCoachReplyThreadMemoryContext | null
): Promise<void> {
  const replyBody = (job.reply_body || "").trim();
  if (!replyBody) {
    throw new Error("missing_reply_body_before_send");
  }

  if (job.sent_at || job.outbound_message_sid) {
    if (job.outbound_message_sid && !job.sent_at) {
      await supabaseServer
        .from("sms_inbound_coach_jobs")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("message_sid", job.message_sid);
    }
    return;
  }

  const { data: sendClaim } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "sending",
      updated_at: new Date().toISOString(),
    })
    .eq("message_sid", job.message_sid)
    .eq("status", "reply_ready")
    .select()
    .maybeSingle();

  if (!sendClaim) {
    const j = (await loadJob(job.message_sid)) ?? job;
    if (j.status === "sending" && j.outbound_message_sid) {
      await supabaseServer
        .from("sms_inbound_coach_jobs")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("message_sid", j.message_sid);
      return;
    }
    if (j.sent_at) return;
    throw new Error("send_claim_lost: could not move reply_ready → sending");
  }

  if (!isTwilioReady()) {
    await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        status: "reply_ready",
        next_retry_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: "twilio_not_configured_reverted_to_reply_ready",
      })
      .eq("message_sid", job.message_sid)
      .eq("status", "sending");
    throw new Error("twilio_not_configured");
  }

  const latestForSend = (await loadJob(job.message_sid)) ?? job;
  const toPhone = latestForSend.from_phone;
  const bodyToSend = (latestForSend.reply_body || "").trim() || replyBody;

  console.log("[sms-inbound-coach] sending sms", job.message_sid);
  const sendResult = await sendSMSChunked({
    to: toPhone,
    body: bodyToSend,
    lastOutbound: {
      clerkUserId: userId,
      messageKind: "coach",
    },
  });

  const sid =
    sendResult.firstSid && sendResult.firstSid.length > 0
      ? sendResult.firstSid
      : null;

  const { error: sidErr } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      outbound_message_sid: sid,
      updated_at: new Date().toISOString(),
    })
    .eq("message_sid", job.message_sid)
    .eq("status", "sending");

  if (sidErr) {
    throw new Error(`outbound_message_sid persist failed: ${sidErr.message}`);
  }

  const { error: finalErr } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("message_sid", job.message_sid)
    .eq("status", "sending");

  if (finalErr) {
    throw new Error(`sent_at finalization failed: ${finalErr.message}`);
  }

  console.log("[sms-inbound-coach] sms sent", job.message_sid, {
    chunkCount: sendResult.chunkCount,
    firstSid: sendResult.firstSid,
  });

  if (threadMemory?.commitmentId && sid && bodyToSend) {
    const mem = await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: threadMemory.commitmentId,
      clerkUserId: userId,
      sentBody: bodyToSend,
      sentAt: new Date(),
      messageSid: sid,
      source: "inbound_coach_reply",
      expectedAnswerType: threadMemory.expectedAnswerType ?? null,
      clearBindingOpenQuestion: threadMemory.clearBindingOpenQuestion === true,
    });
    if (!mem.ok) {
      console.warn("[sms-inbound-coach] v2_sms_thread_memory_outbound_upsert_failed", {
        message_sid: job.message_sid,
        commitment_id: threadMemory.commitmentId,
        error: mem.error,
      });
    }
  }

  if (threadMemory?.meaningShadow) {
    const pending = takeMeaningInterpreterShadowPending(job.message_sid);
    const finalizeInput =
      pending ??
      buildMeaningInterpreterShadowFinalizeFromSchedule({
        clerkUserId: userId,
        inboundMessageSid: job.message_sid,
        coachJobMessageSid: job.message_sid,
        commitmentId: threadMemory.meaningShadow.commitmentId ?? threadMemory.commitmentId ?? null,
        rawBody: latestForSend.raw_body ?? job.raw_body ?? "",
        replyBody: bodyToSend,
        outcomeSent: true,
        jobStatus: "sent",
        deterministicRoute: threadMemory.meaningShadow.deterministicRoute,
        deterministicFacts: threadMemory.meaningShadow.deterministicFacts,
        skipReason: threadMemory.meaningShadow.skipReason,
      });
    scheduleFinalizeMeaningInterpreterShadowForInboundJob({
      ...finalizeInput,
      outcomeSent: true,
      jobStatus: "sent",
      replyBody: bodyToSend,
    });
  }
}

async function processJob(claimedJob: JobRow): Promise<void> {
  const fresh = await loadJob(claimedJob.message_sid);
  if (!fresh) {
    throw new Error("job_missing");
  }

  let job = fresh;

  let splitSuppressedMessageSids: string[] = [];

  if (job.status === "processing" && typeof job.created_at === "string" && job.created_at.trim()) {
    const { mergedRawBody, cancelledMessageSids } = await coalesceOlderPendingSplitJobsForClaimedJob({
      message_sid: job.message_sid,
      clerk_user_id: job.clerk_user_id,
      created_at: job.created_at,
      raw_body: job.raw_body || "",
    });
    if (cancelledMessageSids.length > 0) {
      splitSuppressedMessageSids = cancelledMessageSids;
      console.info("[sms-inbound-coach] split_inbound_coalesced", {
        kept_message_sid: job.message_sid,
        cancelled_message_sids: cancelledMessageSids,
      });
      job = { ...job, raw_body: mergedRawBody };
    }
  }

  if (job.outbound_message_sid && !job.sent_at) {
    console.log("[sms-inbound-coach] repair sent_at from outbound sid", job.message_sid);
    await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("message_sid", job.message_sid);
    return;
  }

  if (job.sent_at) {
    await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        status: "sent",
        updated_at: new Date().toISOString(),
      })
      .eq("message_sid", job.message_sid);
    return;
  }

  const userId = job.clerk_user_id;

  const { data: identity } = await supabaseServer
    .from("sms_identities")
    .select("phone_number, clerk_user_id, sms_enabled, stopped_at")
    .eq("phone_number", job.from_phone)
    .maybeSingle();

  if (!identity?.clerk_user_id || identity.clerk_user_id !== userId) {
    console.log("[sms-inbound-coach] cancelled: identity missing", job.message_sid);
    await markJobFinal({
      messageSid: job.message_sid,
      status: "cancelled",
      lastError: "identity_missing",
      nextRetry: farFutureIso(),
    });
    return;
  }

  if (identity.sms_enabled !== true || typeof identity.stopped_at === "string") {
    console.log("[sms-inbound-coach] cancelled: sms disabled", job.message_sid);
    await markJobFinal({
      messageSid: job.message_sid,
      status: "cancelled",
      lastError: "sms_disabled",
      nextRetry: farFutureIso(),
    });
    return;
  }

  const md = await getClerkPublicMetadata(userId);
  if (md.smsEnabled !== true) {
    console.log("[sms-inbound-coach] cancelled: clerk sms off", job.message_sid);
    await markJobFinal({
      messageSid: job.message_sid,
      status: "cancelled",
      lastError: "clerk_sms_disabled",
      nextRetry: farFutureIso(),
    });
    return;
  }

  const activeV2Commitment = await getActiveCommitment(userId);
  if (activeV2Commitment) {
    const v2Timezone = resolveUserTimezone(md.timezone);
    await handleV2SmsInboundCoachJob(job, userId, activeV2Commitment, v2Timezone, splitSuppressedMessageSids);
    return;
  }

  // PR6: Inbound accountability is V2-only (active commitment handled above). No legacy completeDay / coachEngine.
  console.warn("[sms-inbound-coach][v2-only] inbound_cancelled_no_active_commitment", {
    clerk_user_id: userId,
    message_sid: job.message_sid,
    note: "legacy_inbound_accountability_removed_pr6",
  });
  await markJobFinal({
    messageSid: job.message_sid,
    status: "cancelled",
    lastError: "v2_only_no_active_commitment",
    nextRetry: farFutureIso(),
  });
  return;
}

export async function GET(req: Request) {
  if (!validateCronSecret(req)) {
    console.error("[sms-inbound-coach] unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const stats = {
    ok: true as boolean,
    scanned: 0,
    claimed: 0,
    completed: 0,
    errors: 0,
    repairedPartialSends: 0,
  };

  const nowIso = new Date().toISOString();

  stats.repairedPartialSends = await repairOutboundSidWithoutSentAt();
  await reclaimStaleJobs(nowIso);

  const { data: candidates, error: listErr } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("*")
    .in("status", ["pending", "failed", "reply_ready"])
    .lte("next_retry_at", nowIso)
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("next_retry_at", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(BATCH_SIZE);

  if (listErr) {
    console.error("[sms-inbound-coach] list error", listErr);
    return NextResponse.json(
      { ok: false, error: listErr.message },
      { status: 500 }
    );
  }

  stats.scanned = candidates?.length ?? 0;

  for (const row of candidates ?? []) {
    const job = row as JobRow;

    const { data: claimed } = await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        status: "processing",
        updated_at: new Date().toISOString(),
      })
      .eq("message_sid", job.message_sid)
      .in("status", ["pending", "failed", "reply_ready"])
      .select()
      .maybeSingle();

    if (!claimed) {
      continue;
    }

    stats.claimed += 1;
    const claimedJob = claimed as JobRow;

    try {
      await processJob(claimedJob);
      stats.completed += 1;
    } catch (err) {
      stats.errors += 1;
      const msg =
        err instanceof Error ? err.message : typeof err === "string" ? err : "unknown_error";

      console.error("[sms-inbound-coach] job failed", claimedJob.message_sid, err);

      const nextAttempt = claimedJob.attempt_count + 1;
      const terminal = nextAttempt >= MAX_ATTEMPTS;

      const failState = await loadJob(claimedJob.message_sid);
      const orphanedCoach =
        failState?.status === "generating_reply" &&
        !(failState.reply_body || "").trim();

      if (orphanedCoach) {
        await supabaseServer
          .from("sms_inbound_coach_jobs")
          .update({
            status: "needs_manual_review",
            attempt_count: nextAttempt,
            last_error: `coach_step_failed_or_incomplete_persist (no_auto_retry): ${msg.slice(
              0,
              1700
            )}`,
            next_retry_at: farFutureIso(),
            updated_at: new Date().toISOString(),
          })
          .eq("message_sid", claimedJob.message_sid);
        console.error(
          "[sms-inbound-coach] needs_manual_review orphan generating_reply",
          claimedJob.message_sid
        );
        continue;
      }

      await supabaseServer
        .from("sms_inbound_coach_jobs")
        .update({
          status: terminal ? "needs_manual_review" : "failed",
          attempt_count: nextAttempt,
          last_error: terminal
            ? `max_attempts_exceeded_no_auto_retry (attempts=${nextAttempt}): ${msg.slice(0, 1500)}`
            : msg.slice(0, 2000),
          next_retry_at: terminal
            ? farFutureIso()
            : computeNextRetryIso(nextAttempt),
          updated_at: new Date().toISOString(),
        })
        .eq("message_sid", claimedJob.message_sid);

      if (terminal) {
        console.error(
          "[sms-inbound-coach] needs_manual_review (max attempts)",
          claimedJob.message_sid,
          { attempts: nextAttempt }
        );
      }
    }
  }

  return NextResponse.json(stats);
}
