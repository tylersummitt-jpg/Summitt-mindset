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
import { shouldConsumeInboundAsContractProposalConsent } from "@/lib/v2-contract-consent-routing";
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
  activateAdaptiveOverlayFromProposal,
  clearStaleAdaptiveContractColumns,
  declineAdaptiveProposal,
  getEffectiveCoachingAsk,
  isV2PendingProposalValid,
  resolvePendingProposalContractKind,
} from "@/lib/v2-adaptive-contract";
import { formatCoachingMemoryPromptBlock } from "@/lib/v2-coaching-memory-prompt";
import { loadV2CoachingMemoryForPrompt, recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import { recordV2SendTimeProfileInboundEngagement } from "@/lib/v2-send-time-profile";
import {
  buildBlockerAckSms,
  buildV2ContractOverlayNoAckSms,
  buildV2ContractOverlayYesAckSms,
  buildV2InboundReplySms,
  classifyV2InboundReply,
  isStrongV2YesNoOutcome,
  v2UserReplyIdempotencyKey,
} from "@/lib/v2-sms-accountability";
import {
  buildBlockerAckAiPayload,
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
  type V2InboundGatedDecision,
  strategyForInboundEventType,
  tryGenerateV2ContractConsentAckMessage,
  tryGenerateV2InboundMessage,
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
  appendSmsParagraphIfUnderCap,
  buildProofMomentForAccountabilityOutcome,
  buildProofMomentForBlockerCaptured,
  buildProofMomentForMemoryUpdated,
  decideVictoryRoomSmsCallout,
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
  appendWhenExistingPendingResolution,
  applyWave4SmsCommitmentPendingResolution,
  buildSmsCommitmentChangeCoachReply,
  deriveSmsCommitmentChangeIntent,
} from "@/lib/v2-sms-commitment-change";
import { tryHandleSmsInboundPendingResolution } from "@/lib/v2-sms-pending-resolution-complete";
import { finalizePhase1HumanSms } from "@/lib/v2-human-sms-brain/finalize-phase1-human-sms";
import { shouldRunHumanSmsPipelineForContractConsent } from "@/lib/v2-human-sms-brain/flags";
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
  type NorthStarSmsContextPacket,
} from "@/lib/north-star-coach-sms";
import {
  finalizeNorthStarCoachSmsAsync,
  finalizeNorthStarInboundCoachReplyAsync,
} from "@/lib/north-star-coach-sms-openai";
import {
  buildInboundNorthStarContextPacket,
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
  produceV3InboundCoachDraft,
  recoverV3InboundCoachDraftFromArgs,
  tryGenerateV3OpenQuestionCoachReply,
  type V3SmsBrainResult,
} from "@/lib/v3-sms-brain";
import {
  buildV1ExtraNotebookAppend,
  buildV3LearningNotebookLine,
  deriveV3LearningSignalsFromContext,
} from "@/lib/v3-sms-learning";
import {
  refineMachineSmsBodyWithV3RefineLane,
  V3_REFINE_ONLY_GATED,
} from "@/lib/v3-sms-machine-refine";
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

/** V3 refine-only lane for transactional / guided SMS machine bodies (refresh, memory confirm, contract consent). */
async function refineInboundSmsMachineDraft(args: {
  job: JobRow;
  userId: string;
  commitment: ActiveV2CommitmentRow;
  timezone: string;
  inboundRaw: string;
  machineBody: string;
  hintSource: string;
  ownedReplySource: string;
}): Promise<{ body: string; replySource?: string; contextPacket?: NorthStarSmsContextPacket }> {
  return refineMachineSmsBodyWithV3RefineLane({
    clerkUserId: args.userId,
    messageSid: args.job.message_sid,
    commitment: args.commitment,
    timezone: args.timezone,
    inboundRaw: args.inboundRaw,
    machineBody: args.machineBody,
    hintSource: args.hintSource,
    ownedReplySource: args.ownedReplySource,
  });
}

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
  }
): Promise<{ northStarVisibleBody: string; voice: VoiceOwnershipResult }> {
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
    northStarMeta: r.meta,
    normalCoaching:
      args.normalCoaching ?? Boolean(args.activeCommitmentId ?? args.contextPacket?.activeCommitmentId),
  });
  return { northStarVisibleBody: r.visibleBody, voice };
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
}

function finalVoiceSkipLastError(voice: VoiceOwnershipResult): string {
  try {
    return JSON.stringify({
      tag: "final_voice_gate_no_send",
      final_voice_gate: voice.metadata,
      skip_reason: voice.skipReason ?? null,
      blocked_reasons: voice.blockedReasons,
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

async function processV2NormalInboundOutcome(
  job: JobRow,
  userId: string,
  commitment: ActiveV2CommitmentRow,
  classification: ReturnType<typeof classifyV2InboundReply>,
  timezone: string
): Promise<void> {
  // 1) Classification is rule-based at call sites; event_type is server-controlled here.
  const { eventType, normalizedHint } = classification;
  const effectiveBehavior = getEffectiveCoachingAsk(commitment);
  const userMessage = (job.raw_body || "").trim();
  const recentEvents = await getRecentV2EventsForAi(commitment.id);

  const brokePause = commitment.accountability_phase === "low_pressure_reactivation";
  if (brokePause) {
    await exitLowPressureReactivationOnInbound(commitment.id);
    await recomputeV2CoachingMemory(commitment.id, {
      reasonCode: "inbound_exit_reactivation_before_outcome",
    });
  }

  const { data: inboundProfileRow } = await supabaseServer
    .from("user_profiles")
    .select(
      "preferred_name, life_desires, people_summary, responsibility, identity_anchor_text, identity_source, identity_refresh_due_at, identity_last_referenced_at"
    )
    .eq("clerk_user_id", userId)
    .maybeSingle();

  const preferredName =
    typeof inboundProfileRow?.preferred_name === "string"
      ? inboundProfileRow.preferred_name
      : null;
  const lifeDesires =
    typeof inboundProfileRow?.life_desires === "string" ? inboundProfileRow.life_desires : null;
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
      lifeDesires,
      peopleSummary,
      identityAnchorText,
      latestBlockerPreview,
    });

    const v3Resolution = tryResolveAnswerToOpenQuestionTurn({
      inboundRaw: userMessage,
      latestOpenQuestion: northStarPktEarly.latestOpenQuestion ?? null,
      expectedReplySemantics: northStarPktEarly.expectedReplySemantics as ExpectedReplySemanticsV3,
      recentTranscriptLines: minimalLinesEarly,
      todayCompleted: priorYesToday,
      effectiveAsk: effectiveBehavior,
      behaviorStatement: commitment.behavior_statement ?? "",
    });

    if (v3Resolution) {
      const learningOpen = deriveV3LearningSignalsFromContext({
        recentEventsNewestFirst: recentEvents,
        coachingMemory: coachingMemoryRow,
        latestInbound: userMessage,
      });
      const openBrain = buildAnswerToOpenQuestionV3BrainPackage({
        resolution: v3Resolution,
        learning: learningOpen,
        latestOpenQuestion: northStarPktEarly.latestOpenQuestion ?? null,
        expectedSemantics:
          typeof northStarPktEarly.expectedReplySemantics === "string"
            ? northStarPktEarly.expectedReplySemantics
            : String(northStarPktEarly.expectedReplySemantics ?? ""),
      });

      const openDraft = await tryGenerateV3OpenQuestionCoachReply({
        resolution: v3Resolution,
        inboundRaw: userMessage,
        messageSid: job.message_sid,
        todayCompleted: priorYesToday,
        effectiveAsk: effectiveBehavior,
        behaviorStatement: commitment.behavior_statement ?? "",
        northStarPacket: northStarPktEarly,
        coachingMemory: coachingMemoryRow,
        latestOpenQuestion: northStarPktEarly.latestOpenQuestion ?? null,
        expectedReplySemantics: northStarPktEarly.expectedReplySemantics as ExpectedReplySemanticsV3,
        learningSignal: learningOpen,
      });

      const openBrainWithSource: V3SmsBrainResult = {
        ...openBrain,
        metadata: {
          ...openBrain.metadata,
          open_question_reply_source: openDraft.openQuestionReplySource,
          deterministic_fallback_reason: openDraft.deterministicFallbackReason ?? null,
          deterministic_fallback_used: openDraft.openQuestionReplySource === "deterministic_fallback",
        },
      };

      const contextPacketV3: NorthStarSmsContextPacket = {
        ...northStarPktEarly,
        v3AnswerToOpenQuestion: true,
        v3TurnSubkind: v3Resolution.subkind,
        debug: {
          ...(northStarPktEarly.debug ?? {}),
          v3_turn_purpose: "answer_to_open_question",
          v3_turn_subkind: v3Resolution.subkind,
          answered_open_question: true,
          extracted_open_question_answer: v3Resolution.extractedAnswer,
          v3_brain: buildV3BrainMetadata({
            brain: openBrainWithSource,
            latestOpenQuestion: northStarPktEarly.latestOpenQuestion ?? null,
            expectedSemantics:
              typeof northStarPktEarly.expectedReplySemantics === "string"
                ? northStarPktEarly.expectedReplySemantics
                : null,
            coachReplySource: "v3_answer_to_open_question",
          }),
        },
      };

      const gated = await finalizeNorthStarInboundCoachReplyAsync({
        proposedBody: openDraft.text,
        ctx: {
          userMessage,
          lastOutboundSmsPreview: contextPacketV3.latestOutboundBody ?? lastOutboundSmsPreview,
          effectiveBehavior,
          behaviorStatement: commitment.behavior_statement ?? "",
          finalEventType: null,
          replySource: "v3_answer_to_open_question",
          alreadyCompletedToday: priorYesToday,
          contextPacket: contextPacketV3,
        },
      });
      const openVoice = await applyFinalVoiceOwnershipGate({
        proposedBody: gated.visibleBody,
        replySource: "v3_answer_to_open_question",
        channel: "inbound_coach_reply",
        activeCommitmentId: commitment.id,
        effectiveAsk: effectiveBehavior,
        behaviorStatement: commitment.behavior_statement ?? "",
        latestInboundRaw: userMessage,
        latestOutboundBody: contextPacketV3.latestOutboundBody ?? lastOutboundSmsPreview,
        latestOpenQuestion: contextPacketV3.latestOpenQuestion ?? null,
        contextPacket: contextPacketV3,
        todayCompleted: priorYesToday,
        finalEventType: null,
        v3BrainMetadata: openBrainWithSource.metadata ?? null,
        northStarMeta: gated.meta,
        normalCoaching: true,
      });

      if (!openVoice.shouldSend) {
        await markJobFinal({
          messageSid: job.message_sid,
          status: "cancelled",
          lastError: finalVoiceSkipLastError(openVoice),
          nextRetry: farFutureIso(),
        });
        console.warn("[sms-inbound-coach] v3_open_question_final_voice_suppressed", {
          message_sid: job.message_sid,
        });
        return;
      }

      const nowV3 = new Date().toISOString();
      const { data: persistedV3 } = await supabaseServer
        .from("sms_inbound_coach_jobs")
        .update({
          reply_body: openVoice.body,
          status: "reply_ready",
          next_retry_at: nowV3,
          updated_at: nowV3,
          last_error: null,
        })
        .eq("message_sid", job.message_sid)
        .eq("status", "processing")
        .select()
        .maybeSingle();

      if (!persistedV3) {
        const j3 = await loadJob(job.message_sid);
        if (j3?.reply_body?.trim()) {
          await commitAndSendInboundCoachReply(j3, userId);
          return;
        }
        throw new Error("v3_open_question_reply_ready_persist_failed");
      }

      const freshV3 = (await loadJob(job.message_sid)) ?? job;
      await commitAndSendInboundCoachReply(freshV3, userId);
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
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

  const shadowRelParts = [lifeDesires, peopleSummary, responsibility].filter(
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
      const legacyVoicePack = await northStarGatePersistBodyAsync(tmpl.body, {
        job,
        channel: "inbound_coach_reply",
        lastOutboundBody: lastOutboundSmsPreview,
        effectiveAsk: effectiveBehavior,
        behaviorStatement: commitment.behavior_statement,
        finalEventType: gdFallback.final_event_type ?? eventType,
        replySource: "deterministic_template_fallback",
        activeCommitmentId: commitment.id,
        normalCoaching: true,
      });
      const idempotencyKey = v2UserReplyIdempotencyKey(
        gdFallback.final_event_type ?? eventType,
        job.message_sid
      );
      const { error: evInsErr } = await supabaseServer.from("v2_commitment_event").insert({
        commitment_id: commitment.id,
        clerk_user_id: userId,
        event_type: gdFallback.final_event_type ?? eventType,
        source: "sms_v2_accountability",
        payload_json: {
          message: userMessage,
          ...(normalizedHint != null ? { normalized_hint: normalizedHint } : {}),
          ai: {
            model: V2_INBOUND_AI_MODEL,
            prompt_version: V2_INBOUND_AI_PROMPT_VERSION,
            server_strategy: strategyForInboundEventType(gdFallback.final_event_type ?? eventType),
            message: legacyVoicePack.voice.shouldSend ? legacyVoicePack.voice.body : "",
            confidence: null,
            fallback_used: true,
            fallback_reason: !legacyVoicePack.voice.shouldSend
              ? "conversation_brain_legacy_fallback_disabled_final_voice_no_send"
              : "conversation_brain_legacy_fallback_disabled",
            ...(!legacyVoicePack.voice.shouldSend
              ? { final_voice_gate: legacyVoicePack.voice.metadata }
              : {}),
          },
          conversation_brain_v1: {
            enabled: false,
            legacy_fallback_disabled_deterministic: true,
          },
        },
        idempotency_key: idempotencyKey,
      });

      if (evInsErr) {
        const code = (evInsErr as { code?: string }).code;
        if (code !== "23505") {
          throw new Error(`v2_commitment_event_insert_failed: ${evInsErr.message}`);
        }
      } else {
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

      if (!legacyVoicePack.voice.shouldSend) {
        await markJobFinal({
          messageSid: job.message_sid,
          status: "cancelled",
          lastError: finalVoiceSkipLastError(legacyVoicePack.voice),
          nextRetry: farFutureIso(),
        });
        console.warn("[sms-inbound-coach] legacy_fallback_final_voice_suppressed", {
          message_sid: job.message_sid,
          skip_reason: legacyVoicePack.voice.skipReason ?? null,
        });
        return;
      }

      const nowFb = new Date().toISOString();
      const { data: persistedFb } = await supabaseServer
        .from("sms_inbound_coach_jobs")
        .update({
          reply_body: legacyVoicePack.voice.body,
          status: "reply_ready",
          next_retry_at: nowFb,
          updated_at: nowFb,
          last_error: null,
        })
        .eq("message_sid", job.message_sid)
        .eq("status", "processing")
        .select()
        .maybeSingle();

      if (!persistedFb) {
        const jfb = await loadJob(job.message_sid);
        if (jfb?.reply_body?.trim()) {
          await commitAndSendInboundCoachReply(jfb, userId);
          return;
        }
        throw new Error("v2_reply_ready_persist_failed");
      }

      const freshFb = (await loadJob(job.message_sid)) ?? job;
      await commitAndSendInboundCoachReply(freshFb, userId);
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

  let v3BrainPayload: V3SmsBrainResult | null = null;
  let v3DraftAttempt: Awaited<ReturnType<typeof produceV3InboundCoachDraft>> | null = null;

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
    lifeDesires,
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

  /** Wave-4 handoff copy is refined in its own block; main lane skips duplicate produce. */
  const normalInboundV3OwnershipEligible =
    normalCoachingV3Eligible && gatedDecision.mode !== "commitment_change_handoff";

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
    let pivotBody = buildCentralBrainHumanTetherReply({
      turnPurpose: centralSmsTurnShadowStored.central_turn_purpose,
      inboundText: userMessage,
      effectiveAskSnippet: effectiveBehavior,
      lastOutboundPromptPreview: lastOutboundSmsPreview,
      route: "normal_accountability",
    });
    if (shouldRunPhase5aCentralTetherBrain()) {
      pivotBody = (
        await finalizePhase5aCentralTetherHumanSms({
          machineDraft: pivotBody,
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

    let pivotVisible = pivotBody;
    /** Truthful when V3 refine block skipped (central brain + optional Phase 5a only). */
    let pivotReplySource = "central_brain_pivot_visible";
    if (normalCoachingV3Eligible) {
      const linesPivot = buildMinimalInboundTranscriptLines(
        convPackFull,
        userMessage,
        lastOutboundSmsPreview
      );
      try {
        const v3Pivot = await produceV3InboundCoachDraft({
          userMessage,
          messageSid: job.message_sid,
          commitment,
          effectiveAsk: effectiveBehavior,
          timezone,
          northStarPacket: northStarPktForV3,
          convPackRecentLines: linesPivot,
          expectedReplySemantics: northStarPktForV3.expectedReplySemantics as ExpectedReplySemanticsV3,
          latestOpenQuestion: northStarPktForV3.latestOpenQuestion ?? null,
          todayCompleted: priorYesForV3,
          coachingMemory: coachingMemoryRow,
          recentEvents,
          gatedDecision,
          deterministicEventType: eventType,
          priorDraftHint: { source: "central_brain_pivot", text: pivotBody },
        });
        pivotVisible = v3Pivot.draft;
        pivotReplySource = inferV3InboundReplySource(v3Pivot.brain, v3Pivot.openAiOk, true);
      } catch (e) {
        console.warn("[v3-sms-brain] pivot_refine_failed", {
          commitment_id: commitment.id,
          message: e instanceof Error ? e.message : String(e),
        });
        const rec = await recoverV3InboundCoachDraftFromArgs({
          userMessage,
          messageSid: job.message_sid,
          commitment,
          effectiveAsk: effectiveBehavior,
          timezone,
          northStarPacket: northStarPktForV3,
          convPackRecentLines: linesPivot,
          expectedReplySemantics: northStarPktForV3.expectedReplySemantics as ExpectedReplySemanticsV3,
          latestOpenQuestion: northStarPktForV3.latestOpenQuestion ?? null,
          todayCompleted: priorYesForV3,
          coachingMemory: coachingMemoryRow,
          recentEvents,
          gatedDecision,
          deterministicEventType: eventType,
          priorDraftHint: { source: "central_brain_pivot", text: pivotBody },
        });
        pivotVisible = rec.draft;
        pivotReplySource = inferV3InboundReplySource(rec.brain, rec.openAiOk, true);
      }
    }

    const pivotVoicePack = await northStarGatePersistBodyAsync(pivotVisible, {
      job,
      channel: "central_brain_pivot",
      lastOutboundBody: lastOutboundSmsPreview,
      effectiveAsk: effectiveBehavior,
      behaviorStatement: commitment.behavior_statement,
      finalEventType: gatedDecision.final_event_type ?? eventType,
      replySource: pivotReplySource,
      contextPacket: northStarPktForV3,
      activeCommitmentId: commitment.id,
      normalCoaching: true,
    });
    if (!pivotVoicePack.voice.shouldSend) {
      await markJobFinal({
        messageSid: job.message_sid,
        status: "cancelled",
        lastError: finalVoiceSkipLastError(pivotVoicePack.voice),
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

    if (!persistedPivot) {
      const j2 = await loadJob(job.message_sid);
      if (j2?.reply_body?.trim()) {
        await commitAndSendInboundCoachReply(j2, userId);
        return;
      }
      throw new Error("v2_reply_ready_persist_failed");
    }

    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    const freshPivot = (await loadJob(job.message_sid)) ?? job;
    await commitAndSendInboundCoachReply(freshPivot, userId);
    return;
  }

  /** Wave 14.3a — ambiguous short inbound cannot attach to accountability without live fresh prompt or self-contained grounding. */
  const arcWriteOutcomeType = gatedDecision.final_event_type ?? eventType;
  const arcWouldWriteOutcomeEvent =
    gatedDecision.should_write_outcome_event &&
    (arcWriteOutcomeType === "user_yes" ||
      arcWriteOutcomeType === "user_no" ||
      arcWriteOutcomeType === "user_partial");

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
      let clarificationBody = buildActiveReplyContextClarificationSms({
        inboundText: userMessage,
        tentativeOutcomeType: arcWriteOutcomeType,
      });
      if (shouldRunPhase5aArcClarifyBrain()) {
        clarificationBody = (
          await finalizePhase5aArcClarifyHumanSms({
            machineDraft: clarificationBody,
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

      let clarifyVisible = clarificationBody;
      /** Truthful when V3 refine block skipped (ARC clarify + optional Phase 5a only). */
      let clarifyReplySource = "arc_clarify_ambiguous_short_visible";
      if (normalCoachingV3Eligible) {
        const linesArc = buildMinimalInboundTranscriptLines(
          convPackFull,
          userMessage,
          lastOutboundSmsPreview
        );
        try {
          const v3Arc = await produceV3InboundCoachDraft({
            userMessage,
            messageSid: job.message_sid,
            commitment,
            effectiveAsk: effectiveBehavior,
            timezone,
            northStarPacket: northStarPktForV3,
            convPackRecentLines: linesArc,
            expectedReplySemantics: northStarPktForV3.expectedReplySemantics as ExpectedReplySemanticsV3,
            latestOpenQuestion: northStarPktForV3.latestOpenQuestion ?? null,
            todayCompleted: priorYesForV3,
            coachingMemory: coachingMemoryRow,
            recentEvents,
            gatedDecision,
            deterministicEventType: eventType,
            priorDraftHint: { source: "arc_clarify_ambiguous_short", text: clarificationBody },
          });
          clarifyVisible = v3Arc.draft;
          clarifyReplySource = inferV3InboundReplySource(v3Arc.brain, v3Arc.openAiOk, true);
        } catch (e) {
          console.warn("[v3-sms-brain] arc_clarify_refine_failed", {
            commitment_id: commitment.id,
            message: e instanceof Error ? e.message : String(e),
          });
          const rec = await recoverV3InboundCoachDraftFromArgs({
            userMessage,
            messageSid: job.message_sid,
            commitment,
            effectiveAsk: effectiveBehavior,
            timezone,
            northStarPacket: northStarPktForV3,
            convPackRecentLines: linesArc,
            expectedReplySemantics: northStarPktForV3.expectedReplySemantics as ExpectedReplySemanticsV3,
            latestOpenQuestion: northStarPktForV3.latestOpenQuestion ?? null,
            todayCompleted: priorYesForV3,
            coachingMemory: coachingMemoryRow,
            recentEvents,
            gatedDecision,
            deterministicEventType: eventType,
            priorDraftHint: { source: "arc_clarify_ambiguous_short", text: clarificationBody },
          });
          clarifyVisible = rec.draft;
          clarifyReplySource = inferV3InboundReplySource(rec.brain, rec.openAiOk, true);
        }
      }

      const clarifyVoicePack = await northStarGatePersistBodyAsync(clarifyVisible, {
        job,
        channel: "clarification",
        lastOutboundBody: lastOutboundSmsPreview,
        effectiveAsk: effectiveBehavior,
        behaviorStatement: commitment.behavior_statement,
        finalEventType: arcWriteOutcomeType,
        replySource: clarifyReplySource,
        contextPacket: northStarPktForV3,
        activeCommitmentId: commitment.id,
        normalCoaching: true,
      });
      if (!clarifyVoicePack.voice.shouldSend) {
        await markJobFinal({
          messageSid: job.message_sid,
          status: "cancelled",
          lastError: finalVoiceSkipLastError(clarifyVoicePack.voice),
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

      if (!persistedArc) {
        const j2 = await loadJob(job.message_sid);
        if (j2?.reply_body?.trim()) {
          await commitAndSendInboundCoachReply(j2, userId);
          return;
        }
        throw new Error("v2_reply_ready_persist_failed");
      }

      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      const freshArc = (await loadJob(job.message_sid)) ?? job;
      await commitAndSendInboundCoachReply(freshArc, userId);
      return;
    }
  }

  let commitmentChangeWave4Body: string | null = null;
  let wave4PendingResult: Awaited<ReturnType<typeof applyWave4SmsCommitmentPendingResolution>> | null =
    null;
  if (gatedDecision.mode === "commitment_change_handoff") {
    const intentPack = deriveSmsCommitmentChangeIntent({
      rawBody: userMessage,
      interpretation: shadowInterpretationRaw,
    });
    let wave4Reply = buildSmsCommitmentChangeCoachReply(intentPack);
    try {
      const prWave = await applyWave4SmsCommitmentPendingResolution({
        commitmentId: commitment.id,
        clerkUserId: job.clerk_user_id,
        commitment,
        messageSid: job.message_sid,
        rawBody: userMessage,
        intentPack,
      });
      wave4PendingResult = prWave;
      if (prWave.skipReason === "existing_pending") {
        wave4Reply = appendWhenExistingPendingResolution(wave4Reply);
      }
      if (prWave.pendingApplied) {
        await recomputeV2CoachingMemory(commitment.id, {
          reasonCode: "wave4_sms_pending_resolution",
        });
      }
      console.info("[wave4-sms-commitment] pending_resolution", {
        commitment_id: commitment.id,
        intent: intentPack.intent,
        pending_applied: prWave.pendingApplied,
        pending_kind: prWave.pendingKind,
        skip: prWave.skipReason,
      });
    } catch (e) {
      console.error("[wave4-sms-commitment] pending_resolution_failed", {
        commitment_id: commitment.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
    commitmentChangeWave4Body = wave4Reply;
  }

  if (
    gatedDecision.mode === "commitment_change_handoff" &&
    commitmentChangeWave4Body?.trim() &&
    normalCoachingV3Eligible
  ) {
    const linesHandoff = buildMinimalInboundTranscriptLines(
      convPackFull,
      userMessage,
      lastOutboundSmsPreview
    );
    try {
      const wh = await produceV3InboundCoachDraft({
        userMessage,
        messageSid: job.message_sid,
        commitment,
        effectiveAsk: effectiveBehavior,
        timezone,
        northStarPacket: northStarPktForV3,
        convPackRecentLines: linesHandoff,
        expectedReplySemantics: northStarPktForV3.expectedReplySemantics as ExpectedReplySemanticsV3,
        latestOpenQuestion: northStarPktForV3.latestOpenQuestion ?? null,
        todayCompleted: priorYesForV3,
        coachingMemory: coachingMemoryRow,
        recentEvents,
        gatedDecision,
        deterministicEventType: eventType,
        priorDraftHint: { source: "wave4_commitment_handoff", text: commitmentChangeWave4Body.trim() },
      });
      v3DraftAttempt = wh;
      v3BrainPayload = wh.brain;
    } catch (e) {
      console.warn("[v3-sms-brain] wave4_handoff_refine_failed", {
        commitment_id: commitment.id,
        message: e instanceof Error ? e.message : String(e),
      });
      try {
        const rec = await recoverV3InboundCoachDraftFromArgs({
          userMessage,
          messageSid: job.message_sid,
          commitment,
          effectiveAsk: effectiveBehavior,
          timezone,
          northStarPacket: northStarPktForV3,
          convPackRecentLines: linesHandoff,
          expectedReplySemantics: northStarPktForV3.expectedReplySemantics as ExpectedReplySemanticsV3,
          latestOpenQuestion: northStarPktForV3.latestOpenQuestion ?? null,
          todayCompleted: priorYesForV3,
          coachingMemory: coachingMemoryRow,
          recentEvents,
          gatedDecision,
          deterministicEventType: eventType,
          priorDraftHint: { source: "wave4_commitment_handoff", text: commitmentChangeWave4Body.trim() },
        });
        v3DraftAttempt = rec;
        v3BrainPayload = rec.brain;
      } catch (e2) {
        console.warn("[v3-sms-brain] wave4_handoff_recover_failed", {
          commitment_id: commitment.id,
          message: e2 instanceof Error ? e2.message : String(e2),
        });
      }
    }
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

  if (normalInboundV3OwnershipEligible) {
    const linesMain = buildMinimalInboundTranscriptLines(
      convPackFull,
      userMessage,
      lastOutboundSmsPreview
    );
    try {
      const produced = await produceV3InboundCoachDraft({
        userMessage,
        messageSid: job.message_sid,
        commitment,
        effectiveAsk: effectiveBehavior,
        timezone,
        northStarPacket: northStarPktForV3,
        convPackRecentLines: linesMain,
        expectedReplySemantics: northStarPktForV3.expectedReplySemantics as ExpectedReplySemanticsV3,
        latestOpenQuestion: northStarPktForV3.latestOpenQuestion ?? null,
        todayCompleted: priorYesForV3,
        coachingMemory: coachingMemoryRow,
        recentEvents,
        gatedDecision,
        deterministicEventType: eventType,
        priorDraftHint: priorDraftFromConversationBrain,
      });
      v3DraftAttempt = produced;
      v3BrainPayload = produced.brain;
    } catch (e) {
      console.warn("[v3-sms-brain] produce_failed", {
        commitment_id: commitment.id,
        message: e instanceof Error ? e.message : String(e),
      });
      try {
        const recovered = await recoverV3InboundCoachDraftFromArgs({
          userMessage,
          messageSid: job.message_sid,
          commitment,
          effectiveAsk: effectiveBehavior,
          timezone,
          northStarPacket: northStarPktForV3,
          convPackRecentLines: linesMain,
          expectedReplySemantics: northStarPktForV3.expectedReplySemantics as ExpectedReplySemanticsV3,
          latestOpenQuestion: northStarPktForV3.latestOpenQuestion ?? null,
          todayCompleted: priorYesForV3,
          coachingMemory: coachingMemoryRow,
          recentEvents,
          gatedDecision,
          deterministicEventType: eventType,
          priorDraftHint: priorDraftFromConversationBrain,
        });
        v3DraftAttempt = recovered;
        v3BrainPayload = recovered.brain;
      } catch (e2) {
        console.warn("[v3-sms-brain] recover_after_produce_failed", {
          commitment_id: commitment.id,
          message: e2 instanceof Error ? e2.message : String(e2),
        });
      }
    }
    if (v3DraftAttempt == null) {
      try {
        const recovered = await recoverV3InboundCoachDraftFromArgs({
          userMessage,
          messageSid: job.message_sid,
          commitment,
          effectiveAsk: effectiveBehavior,
          timezone,
          northStarPacket: northStarPktForV3,
          convPackRecentLines: linesMain,
          expectedReplySemantics: northStarPktForV3.expectedReplySemantics as ExpectedReplySemanticsV3,
          latestOpenQuestion: northStarPktForV3.latestOpenQuestion ?? null,
          todayCompleted: priorYesForV3,
          coachingMemory: coachingMemoryRow,
          recentEvents,
          gatedDecision,
          deterministicEventType: eventType,
          priorDraftHint: priorDraftFromConversationBrain,
        });
        v3DraftAttempt = recovered;
        v3BrainPayload = recovered.brain;
      } catch (e3) {
        console.error("[v3-sms-brain] inbound_v3_ownership_unrecoverable", {
          commitment_id: commitment.id,
          message: e3 instanceof Error ? e3.message : String(e3),
        });
      }
    }
  }

  let usedLegacyResolveHint = false;
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
      commitmentChangeWave4Body,
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
          lifeDesires,
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

  const hadPriorHintForSource = Boolean(priorDraftFromConversationBrain || usedLegacyResolveHint);

  // 5) Final SMS body — legacy banks only when not normal coaching (compliance / pure transactional slices).
  const trySuggestedWhenAgrees = needInterpretation && !gatedEnabled;
  const resolved =
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
          commitmentChangeWave4Body,
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
              lifeDesires,
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

  const forcedCoachSms =
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

  let replyBody = forcedCoachSms ?? resolved.replyBody;
  let effectiveInboundReplySource = resolved.meta.reply_source;

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
        replyMode: resolved.meta.reply_mode,
      });
      const outcomeKeyForLog = `${gatedDecision.mode}:${String(resolved.meta.final_event_type ?? "none")}:${resolved.meta.reply_mode}`;
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
            replyMode: resolved.meta.reply_mode,
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
  ];
  const shouldPersistNonOutcomeMemoryEvent =
    memorySignalStored != null &&
    memorySignalStored.memory_signal_detected === true &&
    !gatedDecision.should_write_outcome_event &&
    nonOutcomeMemoryModes.includes(gatedDecision.mode) &&
    !(gatedDecision.mode === "commitment_change_handoff" && wave4PendingResult?.pendingApplied === true);

  let finalReplyBody = replyBody;
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

  const victorySmsCallout = decideVictoryRoomSmsCallout({
    proofMeta: accountabilityProofMoment,
    eventsNewestFirst: recentEvents,
  });
  const beforeVictoryLine = finalReplyBody;
  finalReplyBody = appendSmsParagraphIfUnderCap(finalReplyBody, victorySmsCallout.appendToReply);
  const victoryCalloutDisplayed =
    victorySmsCallout.appendToReply != null && finalReplyBody !== beforeVictoryLine;
  const victoryExtrasForSpine = victoryCalloutDisplayed ? victorySmsCallout.eventPayloadExtras : {};

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
    if (victorySmsCallout.appendToReply?.trim()) {
      preservationSnippets.push(victorySmsCallout.appendToReply.trim());
    }
    const stitchedFin = await finalizePhase5aInboundStitchedFinalHumanSms({
      machineDraft: finalReplyBody,
      preservationSnippets,
      appendSegments: {
        wave11: wave11SnippetForPreserve != null,
        victory: victoryCalloutDisplayed,
        commitment_note: Boolean(gatedDecision.supplement_commitment_change_guidance),
      },
      allowVictoryRoomPhrase: victoryCalloutDisplayed,
      maxChars: 320,
    });
    finalReplyBody = stitchedFin.message;
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
    lifeDesires,
    peopleSummary,
    identityAnchorText,
    latestBlockerPreview,
    proofDisplayedOrMoment: victoryCalloutDisplayed,
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

  const v3BrainEventMeta =
    v3BrainPayload != null
      ? buildV3BrainMetadata({
          brain: v3BrainPayload,
          latestOpenQuestion: northStarPktForV3.latestOpenQuestion ?? null,
          expectedSemantics:
            typeof northStarPktForV3.expectedReplySemantics === "string"
              ? northStarPktForV3.expectedReplySemantics
              : null,
          coachReplySource: effectiveInboundReplySource ?? replyResolutionMeta.reply_source ?? "v3_sms_brain",
          northStarGate: northStarGateTelemetry,
          priorDraftSource: priorDraftFromConversationBrain?.source ?? null,
        })
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

  // 6) Accountability event spine (only when scoring this turn).
  if (gatedDecision.should_write_outcome_event) {
    const finalEventType = gatedDecision.final_event_type ?? eventType;
    const idempotencyKey = v2UserReplyIdempotencyKey(finalEventType, job.message_sid);
    const { error: evErr } = await supabaseServer.from("v2_commitment_event").insert({
      commitment_id: commitment.id,
      clerk_user_id: userId,
      event_type: finalEventType,
      source: "sms_v2_accountability",
      payload_json: {
        message: userMessage,
        ...(normalizedHint != null ? { normalized_hint: normalizedHint } : {}),
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
        ...proofMomentPayloadFields(accountabilityProofMoment),
        ...(gatedDecision.should_write_outcome_event ? victoryExtrasForSpine : {}),
        ...(centralSmsTurnShadowStored != null ? { central_sms_turn_shadow: centralSmsTurnShadowStored } : {}),
        ...(v3BrainEventMeta != null ? { v3_brain: v3BrainEventMeta } : {}),
        ai: aiPayload,
        ...(conversationBrainSpineMeta != null ? { conversation_brain_v1: conversationBrainSpineMeta } : {}),
      },
      idempotency_key: idempotencyKey,
    });

    if (evErr) {
      const code = (evErr as { code?: string }).code;
      if (code !== "23505") {
        throw new Error(`v2_commitment_event_insert_failed: ${evErr.message}`);
      }
    } else {
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      maybeLogCentralBrainDisagreement({
        commitmentId: commitment.id,
        stored: centralSmsTurnShadowStored ?? undefined,
        spineEventType: finalEventType,
        shouldWriteOutcome: gatedDecision.should_write_outcome_event,
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
      lastError: finalVoiceSkipLastError(finalVoiceGate),
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

  if (!persisted) {
    const j2 = await loadJob(job.message_sid);
    if (j2?.reply_body?.trim()) {
      await commitAndSendInboundCoachReply(j2, userId);
      return;
    }
    throw new Error("v2_reply_ready_persist_failed");
  }

  const fresh = (await loadJob(job.message_sid)) ?? job;
  await commitAndSendInboundCoachReply(fresh, userId);
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
      "preferred_name, life_desires, people_summary, responsibility, identity_anchor_text, identity_source"
    )
    .eq("clerk_user_id", userId)
    .maybeSingle();

  const blockerPreferredName =
    typeof blockerProfileRow?.preferred_name === "string"
      ? blockerProfileRow.preferred_name
      : null;
  const blockerLifeDesires =
    typeof blockerProfileRow?.life_desires === "string" ? blockerProfileRow.life_desires : null;
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
    lifeDesires: blockerLifeDesires,
    peopleSummary: blockerPeopleSummary,
    identityAnchorText: blockerIdentityForPrompt,
    latestBlockerPreview: null,
  });
  const blockerPriorYes = recentEventsIncludeUserYesOnLocalDay(
    recentEventsForCentral,
    timezone,
    getDateKeyInTimezone(new Date(), timezone)
  );

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
    let pivotBody = buildCentralBrainHumanTetherReply({
      turnPurpose: centralBlockerShadowStored.central_turn_purpose,
      inboundText: blockerText,
      effectiveAskSnippet: effectiveBlockerAsk,
      lastOutboundPromptPreview: lastOutboundBlockPreview,
      route: "blocker_capture",
    });
    if (shouldRunPhase5aCentralTetherBrain()) {
      pivotBody = (
        await finalizePhase5aCentralTetherHumanSms({
          machineDraft: pivotBody,
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
    let blockerPivotVisible = pivotBody;
    /** Truthful when V3 blocker pivot refine block skipped. */
    let blockerPivotReplySource = "central_brain_blocker_pivot_visible";
    if (
      convPackBlocker &&
      !isLikelySmsComplianceOrOptOutTurn(blockerText) &&
      !isLikelyCommitmentChangeIntentTurn(blockerText) &&
      !isV2PendingProposalValid(commitment)
    ) {
      try {
        const v3BlkPv = await produceV3InboundCoachDraft({
          userMessage: blockerText,
          messageSid: job.message_sid,
          commitment,
          effectiveAsk: effectiveBlockerAsk,
          timezone,
          northStarPacket: northStarBlockerPkt,
          convPackRecentLines: convPackBlocker.recentTranscriptLines ?? [],
          expectedReplySemantics: northStarBlockerPkt.expectedReplySemantics as ExpectedReplySemanticsV3,
          latestOpenQuestion: northStarBlockerPkt.latestOpenQuestion ?? null,
          todayCompleted: blockerPriorYes,
          coachingMemory: blockerCoachingMemory,
          recentEvents: recentEventsForCentral,
          gatedDecision: V3_REFINE_ONLY_GATED,
          deterministicEventType: blockerClassification.eventType,
          priorDraftHint: { source: "central_brain_pivot_blocker", text: pivotBody },
        });
        blockerPivotVisible = v3BlkPv.draft;
        blockerPivotReplySource = inferV3InboundReplySource(v3BlkPv.brain, v3BlkPv.openAiOk, true);
      } catch (e) {
        console.warn("[v3-sms-brain] blocker_pivot_refine_failed", {
          commitment_id: commitment.id,
          message: e instanceof Error ? e.message : String(e),
        });
        const rec = await recoverV3InboundCoachDraftFromArgs({
          userMessage: blockerText,
          messageSid: job.message_sid,
          commitment,
          effectiveAsk: effectiveBlockerAsk,
          timezone,
          northStarPacket: northStarBlockerPkt,
          convPackRecentLines: convPackBlocker.recentTranscriptLines ?? [],
          expectedReplySemantics: northStarBlockerPkt.expectedReplySemantics as ExpectedReplySemanticsV3,
          latestOpenQuestion: northStarBlockerPkt.latestOpenQuestion ?? null,
          todayCompleted: blockerPriorYes,
          coachingMemory: blockerCoachingMemory,
          recentEvents: recentEventsForCentral,
          gatedDecision: V3_REFINE_ONLY_GATED,
          deterministicEventType: blockerClassification.eventType,
          priorDraftHint: { source: "central_brain_pivot_blocker", text: pivotBody },
        });
        blockerPivotVisible = rec.draft;
        blockerPivotReplySource = inferV3InboundReplySource(rec.brain, rec.openAiOk, true);
      }
    }
    const blockerPivotVoicePack = await northStarGatePersistBodyAsync(blockerPivotVisible, {
      job,
      channel: "central_brain_pivot",
      lastOutboundBody: lastOutboundBlockPreview,
      effectiveAsk: effectiveBlockerAsk,
      behaviorStatement: commitment.behavior_statement,
      finalEventType: blockerClassification.eventType,
      replySource: blockerPivotReplySource,
      contextPacket: northStarBlockerPkt,
      activeCommitmentId: commitment.id,
      normalCoaching: true,
    });
    if (!blockerPivotVoicePack.voice.shouldSend) {
      await markJobFinal({
        messageSid: job.message_sid,
        status: "cancelled",
        lastError: finalVoiceSkipLastError(blockerPivotVoicePack.voice),
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
    if (!persistedPivot) {
      const j2 = await loadJob(job.message_sid);
      if (j2?.reply_body?.trim()) {
        await commitAndSendInboundCoachReply(j2, userId);
        return;
      }
      throw new Error("v2_blocker_human_pivot_reply_ready_failed");
    }
    const freshPv = (await loadJob(job.message_sid)) ?? job;
    await commitAndSendInboundCoachReply(freshPv, userId);
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    return;
  }

  const blockerAckTry = await tryGenerateV2BlockerAckMessage({
    commitment,
    followingEventType: following,
    blockerText,
    preferredName: blockerPreferredName,
    lifeDesires: blockerLifeDesires,
    peopleSummary: blockerPeopleSummary,
    responsibility: blockerResponsibility,
    identityAnchorText: blockerIdentityForPrompt,
    coachingMemory: blockerCoachingMemory,
    ...(brokePause ? { brokePause: true } : {}),
  });

  const ackBody = blockerAckTry.ok ? blockerAckTry.message : templateAckBody;
  let ackVisible = ackBody;
  /** Truthful when V3 blocker-ack refine block skipped (AI/template ack only). */
  let ackReplySource = "blocker_ack_visible_non_v3";
  if (
    convPackBlocker &&
    !isLikelySmsComplianceOrOptOutTurn(blockerText) &&
    !isLikelyCommitmentChangeIntentTurn(blockerText) &&
    !isV2PendingProposalValid(commitment)
  ) {
    try {
      const v3Ack = await produceV3InboundCoachDraft({
        userMessage: blockerText,
        messageSid: job.message_sid,
        commitment,
        effectiveAsk: effectiveBlockerAsk,
        timezone,
        northStarPacket: northStarBlockerPkt,
        convPackRecentLines: convPackBlocker.recentTranscriptLines ?? [],
        expectedReplySemantics: northStarBlockerPkt.expectedReplySemantics as ExpectedReplySemanticsV3,
        latestOpenQuestion: northStarBlockerPkt.latestOpenQuestion ?? null,
        todayCompleted: blockerPriorYes,
        coachingMemory: blockerCoachingMemory,
        recentEvents: recentEventsForCentral,
        gatedDecision: V3_REFINE_ONLY_GATED,
        deterministicEventType: blockerClassification.eventType,
        priorDraftHint: { source: "blocker_ack", text: ackBody },
      });
      ackVisible = v3Ack.draft;
      ackReplySource = inferV3InboundReplySource(v3Ack.brain, v3Ack.openAiOk, true);
    } catch (e) {
      console.warn("[v3-sms-brain] blocker_ack_refine_failed", {
        commitment_id: commitment.id,
        message: e instanceof Error ? e.message : String(e),
      });
      const rec = await recoverV3InboundCoachDraftFromArgs({
        userMessage: blockerText,
        messageSid: job.message_sid,
        commitment,
        effectiveAsk: effectiveBlockerAsk,
        timezone,
        northStarPacket: northStarBlockerPkt,
        convPackRecentLines: convPackBlocker.recentTranscriptLines ?? [],
        expectedReplySemantics: northStarBlockerPkt.expectedReplySemantics as ExpectedReplySemanticsV3,
        latestOpenQuestion: northStarBlockerPkt.latestOpenQuestion ?? null,
        todayCompleted: blockerPriorYes,
        coachingMemory: blockerCoachingMemory,
        recentEvents: recentEventsForCentral,
        gatedDecision: V3_REFINE_ONLY_GATED,
        deterministicEventType: blockerClassification.eventType,
        priorDraftHint: { source: "blocker_ack", text: ackBody },
      });
      ackVisible = rec.draft;
      ackReplySource = inferV3InboundReplySource(rec.brain, rec.openAiOk, true);
    }
  }
  const ackVoicePack = await northStarGatePersistBodyAsync(ackVisible, {
    job,
    channel: "blocker_followup",
    lastOutboundBody: lastOutboundBlockPreview,
    effectiveAsk: effectiveBlockerAsk,
    behaviorStatement: commitment.behavior_statement,
    finalEventType: blockerClassification.eventType,
    replySource: ackReplySource,
    contextPacket: northStarBlockerPkt,
    activeCommitmentId: commitment.id,
    normalCoaching: true,
  });
  const gatedAckBody = ackVoicePack.voice.body;
  const blockerAiPayload = {
    ...buildBlockerAckAiPayload({
      model: V2_BLOCKER_ACK_AI_MODEL,
      promptVersion: V2_BLOCKER_ACK_PROMPT_VERSION,
      message: ackVoicePack.voice.shouldSend ? ackVoicePack.voice.body : "",
      confidence: blockerAckTry.ok ? blockerAckTry.confidence : null,
      fallbackUsed: !blockerAckTry.ok || !ackVoicePack.voice.shouldSend,
      fallbackReason: !ackVoicePack.voice.shouldSend
        ? "final_voice_gate_no_send"
        : !blockerAckTry.ok
          ? blockerAckTry.reason
          : null,
    }),
    ...(!ackVoicePack.voice.shouldSend ? { final_voice_gate: ackVoicePack.voice.metadata } : {}),
  };

  let ackSid: string | null = null;
  if (!ackVoicePack.voice.shouldSend) {
    await markJobFinal({
      messageSid: job.message_sid,
      status: "cancelled",
      lastError: finalVoiceSkipLastError(ackVoicePack.voice),
      nextRetry: farFutureIso(),
    });
    console.warn("[sms-inbound-coach] blocker_ack_final_voice_suppressed", {
      message_sid: job.message_sid,
    });
  } else {
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

    if (!persisted) {
      const j2 = await loadJob(job.message_sid);
      if (j2?.reply_body?.trim()) {
        await commitAndSendInboundCoachReply(j2, userId);
      } else {
        throw new Error("v2_blocker_ack_reply_ready_persist_failed");
      }
    } else {
      const fresh = (await loadJob(job.message_sid)) ?? job;
      await commitAndSendInboundCoachReply(fresh, userId);
    }

    const afterSend = (await loadJob(job.message_sid)) ?? job;
    ackSid =
      typeof afterSend.outbound_message_sid === "string" && afterSend.outbound_message_sid.length > 0
        ? afterSend.outbound_message_sid
        : null;
  }

  const blockerProofMoment = buildProofMomentForBlockerCaptured({
    blockerMessageCharCount: blockerText.trim().length,
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
      ...(!blockerAckTry.ok ? { ack_template_id: ackTemplateId } : {}),
      ...(ackSid ? { ack_message_sid: ackSid } : {}),
      ...(blockerMemoryStored != null ? { memory_signal: blockerMemoryStored } : {}),
      ...proofMomentPayloadFields(blockerProofMoment),
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

  // Critical: only consume a bare YES/NO as proposal consent if the latest outbound SMS
  // was actually the proposal prompt (prevents stale proposals hijacking later turns).
  const { data: lastCtx } = await supabaseServer
    .from("sms_last_outbound_context")
    .select("full_body, sent_at")
    .eq("clerk_user_id", userId)
    .maybeSingle();
  const lastBody = typeof lastCtx?.full_body === "string" ? lastCtx.full_body : "";
  if (
    !shouldConsumeInboundAsContractProposalConsent({
      inboundBody: (job.raw_body || "").trim(),
      proposalText,
      latestOutboundBody: lastBody,
    })
  ) {
    return false;
  }

  const classification = classifyV2InboundReply((job.raw_body || "").trim());

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

  const { data: consentProfileRow } = await supabaseServer
    .from("user_profiles")
    .select("preferred_name")
    .eq("clerk_user_id", userId)
    .maybeSingle();
  const consentPreferredName =
    typeof consentProfileRow?.preferred_name === "string" ? consentProfileRow.preferred_name : null;

  const persistReplyAndSend = async (replyBody: string): Promise<void> => {
    const r = await refineInboundSmsMachineDraft({
      job,
      userId,
      commitment: workingCommitment,
      timezone,
      inboundRaw: (job.raw_body || "").trim(),
      machineBody: replyBody,
      hintSource: "contract_consent_ack",
      ownedReplySource: "v3_contract_consent_refined",
    });
    const contractVoicePack = await northStarGatePersistBodyAsync(r.body, {
      job,
      channel: "contract_ack",
      lastOutboundBody: lastBody,
      behaviorStatement: workingCommitment.behavior_statement,
      effectiveAsk: getEffectiveCoachingAsk(workingCommitment, Date.now()),
      replySource: r.replySource ?? undefined,
      contextPacket: r.contextPacket,
      activeCommitmentId: workingCommitment.id,
      normalCoaching: true,
    });
    if (!contractVoicePack.voice.shouldSend) {
      await markJobFinal({
        messageSid: job.message_sid,
        status: "cancelled",
        lastError: finalVoiceSkipLastError(contractVoicePack.voice),
        nextRetry: farFutureIso(),
      });
      console.warn("[sms-inbound-coach] contract_consent_ack_final_voice_suppressed", {
        message_sid: job.message_sid,
      });
      return;
    }
    const gated = contractVoicePack.voice.body;
    const now = new Date().toISOString();
    const { data: persisted } = await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        reply_body: gated,
        status: "reply_ready",
        next_retry_at: now,
        updated_at: now,
        last_error: null,
      })
      .eq("message_sid", job.message_sid)
      .eq("status", "processing")
      .select()
      .maybeSingle();

    if (!persisted) {
      const j2 = await loadJob(job.message_sid);
      if (j2?.reply_body?.trim()) {
        await commitAndSendInboundCoachReply(j2, userId);
        return;
      }
      throw new Error("v2_contract_consent_reply_ready_persist_failed");
    }

    const fresh = (await loadJob(job.message_sid)) ?? job;
    await commitAndSendInboundCoachReply(fresh, userId);
  };

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
    if (act.result === "already_applied") {
      await persistReplyAndSend(
        "Already recorded from a prior reply in this thread. Daily checks continue."
      );
      return true;
    }
    if (act.result === "state_conflict" || act.result === "not_found") {
      await persistReplyAndSend(
        "No active pending proposal to update from this reply. Daily checks continue."
      );
      return true;
    }
    if (!act.ok) {
      throw new Error(`contract_overlay_activate_failed:${act.error}`);
    }
    await recomputeV2CoachingMemory(workingCommitment.id, {
      reasonCode: "inbound_contract_overlay_accepted",
    });
    const tmpl = buildV2ContractOverlayYesAckSms({
      messageSid: job.message_sid,
      adoptedAskText: proposalText,
      contractKind,
    });
    const aiTry = await tryGenerateV2ContractConsentAckMessage({
      kind: "overlay_activated_ack",
      bindingText: proposalText,
      overlayContractKind: contractKind,
      originalBehaviorStatement: workingCommitment.behavior_statement,
      commitmentTitle: workingCommitment.title,
      preferredName: consentPreferredName,
    });
    let replyBody = aiTry.ok ? aiTry.message : tmpl.body;
    if (shouldRunHumanSmsPipelineForContractConsent()) {
      replyBody = (
        await finalizePhase1HumanSms({
          path: "contract_consent",
          brainCase: "contract_consent_overlay_yes_ack",
          machineDraft: replyBody,
          channel: "contract_consent_ack",
          allowVictoryRoomPhrase: false,
          brainContext: {
            proposalSummary: proposalText,
            contractKindHint: contractKind,
            preferredName: consentPreferredName,
          },
          safeFallback: tmpl.body,
        })
      ).message;
    }
    await persistReplyAndSend(replyBody);
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
    if (dec.result === "already_applied") {
      await persistReplyAndSend(
        "Already recorded from a prior reply in this thread. Daily checks continue."
      );
      return true;
    }
    if (dec.result === "state_conflict" || dec.result === "not_found") {
      await persistReplyAndSend(
        "No active pending proposal to update from this reply. Daily checks continue."
      );
      return true;
    }
    if (!dec.ok) {
      throw new Error(`contract_overlay_decline_failed:${dec.error}`);
    }
    await recomputeV2CoachingMemory(workingCommitment.id, {
      reasonCode: "inbound_contract_overlay_declined",
    });
    const tmpl = buildV2ContractOverlayNoAckSms({
      messageSid: job.message_sid,
      originalBehaviorStatement: workingCommitment.behavior_statement,
    });
    const aiTry = await tryGenerateV2ContractConsentAckMessage({
      kind: "overlay_declined_ack",
      bindingText: null,
      overlayContractKind: contractKind,
      originalBehaviorStatement: workingCommitment.behavior_statement,
      commitmentTitle: workingCommitment.title,
      preferredName: consentPreferredName,
    });
    let replyBody = aiTry.ok ? aiTry.message : tmpl.body;
    if (shouldRunHumanSmsPipelineForContractConsent()) {
      replyBody = (
        await finalizePhase1HumanSms({
          path: "contract_consent",
          brainCase: "contract_consent_overlay_no_ack",
          machineDraft: replyBody,
          channel: "contract_consent_ack",
          allowVictoryRoomPhrase: false,
          brainContext: {
            proposalSummary: proposalText,
            contractKindHint: contractKind,
            preferredName: consentPreferredName,
          },
          safeFallback: tmpl.body,
        })
      ).message;
    }
    await persistReplyAndSend(replyBody);
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    return true;
  }

  return false;
}

async function persistV2JobReplyReadyAndSend(
  job: JobRow,
  userId: string,
  replyBody: string,
  northStar?: {
    channel?: NorthStarCoachChannel;
    lastOutboundBody?: string | null;
    effectiveAsk?: string | null;
    behaviorStatement?: string | null;
    finalEventType?: string | null;
    contextPacket?: NorthStarSmsContextPacket;
    activeCommitmentId?: string | null;
    /** When set, North Star OpenAI finalizer is skipped (deterministic guard still runs). */
    replySource?: string | null;
  }
): Promise<void> {
  const northStarPack = await finalizeNorthStarCoachSmsAsync({
    proposedBody: replyBody,
    channel: northStar?.channel ?? "other_coaching",
    latestInboundRaw: job.raw_body ?? "",
    latestOutboundBody: northStar?.lastOutboundBody ?? null,
    effectiveAskText: northStar?.effectiveAsk ?? undefined,
    behaviorStatement: northStar?.behaviorStatement ?? undefined,
    finalEventType: northStar?.finalEventType ?? undefined,
    replySource: northStar?.replySource ?? undefined,
    alreadyCompletedToday:
      northStar?.finalEventType === "user_yes" || inboundSignalsCompletion(job.raw_body),
    contextPacket: northStar?.contextPacket,
  });
  const voiceGate = await applyFinalVoiceOwnershipGate({
    proposedBody: northStarPack.visibleBody,
    replySource: northStar?.replySource ?? undefined,
    channel: northStar?.channel ?? "other_coaching",
    activeCommitmentId: northStar?.activeCommitmentId ?? northStar?.contextPacket?.activeCommitmentId ?? null,
    effectiveAsk: northStar?.effectiveAsk ?? northStar?.contextPacket?.effectiveAskText ?? null,
    behaviorStatement: northStar?.behaviorStatement ?? northStar?.contextPacket?.behaviorStatement ?? null,
    latestInboundRaw: job.raw_body ?? "",
    latestOutboundBody: northStar?.lastOutboundBody ?? northStar?.contextPacket?.latestOutboundBody ?? null,
    latestOpenQuestion: northStar?.contextPacket?.latestOpenQuestion ?? null,
    contextPacket: northStar?.contextPacket,
    finalEventType: northStar?.finalEventType ?? northStar?.contextPacket?.finalEventType ?? null,
    northStarMeta: northStarPack.meta,
    normalCoaching: Boolean(northStar?.activeCommitmentId ?? northStar?.contextPacket?.activeCommitmentId),
  });
  console.info("[final-voice-gate] inbound_job_reply_ready", {
    message_sid: job.message_sid,
    voice_owner: voiceGate.voiceOwner,
    source: voiceGate.source,
    blocked_reasons: voiceGate.blockedReasons,
    emergency_fallback_used: voiceGate.emergencyFallbackUsed,
  });
  if (!voiceGate.shouldSend) {
    await markJobFinal({
      messageSid: job.message_sid,
      status: "cancelled",
      lastError: finalVoiceSkipLastError(voiceGate),
      nextRetry: farFutureIso(),
    });
    console.warn("[final-voice-gate] inbound_refresh_suppressed", {
      message_sid: job.message_sid,
      skip_reason: voiceGate.skipReason ?? null,
    });
    return;
  }
  const now = new Date().toISOString();
  const { data: persisted } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      reply_body: voiceGate.body,
      status: "reply_ready",
      next_retry_at: now,
      updated_at: now,
      last_error: null,
    })
    .eq("message_sid", job.message_sid)
    .eq("status", "processing")
    .select()
    .maybeSingle();

  if (!persisted) {
    const j2 = await loadJob(job.message_sid);
    if (j2?.reply_body?.trim()) {
      await commitAndSendInboundCoachReply(j2, userId);
      return;
    }
    throw new Error("v2_refresh_reply_ready_persist_failed");
  }

  const fresh = (await loadJob(job.message_sid)) ?? job;
  await commitAndSendInboundCoachReply(fresh, userId);
}

async function persistRefreshSmsRefinedAndSend(args: {
  job: JobRow;
  userId: string;
  commitment: ActiveV2CommitmentRow;
  timezone: string;
  machineBody: string;
  inboundRaw: string;
}): Promise<void> {
  const r = await refineInboundSmsMachineDraft({
    job: args.job,
    userId: args.userId,
    commitment: args.commitment,
    timezone: args.timezone,
    inboundRaw: args.inboundRaw,
    machineBody: args.machineBody,
    hintSource: "refresh_session_step",
    ownedReplySource: "v3_refresh_refined",
  });
  const classification = classifyV2InboundReply(args.inboundRaw.trim());
  await persistV2JobReplyReadyAndSend(args.job, args.userId, r.body, {
    channel: "refresh",
    effectiveAsk: getEffectiveCoachingAsk(args.commitment, Date.now()),
    behaviorStatement: args.commitment.behavior_statement ?? null,
    finalEventType: classification.eventType,
    contextPacket: r.contextPacket,
    replySource: r.replySource,
    activeCommitmentId: args.commitment.id,
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

  if (replyKind === "ambiguous") {
    const amb = await refineInboundSmsMachineDraft({
      job,
      userId,
      commitment,
      timezone,
      inboundRaw: raw,
      machineBody:
        "Should I remember that going forward, or leave the current profile as-is?",
      hintSource: "memory_confirmation",
      ownedReplySource: "v3_memory_confirmation_refined",
    });
    await persistV2JobReplyReadyAndSend(job, userId, amb.body, {
      channel: "memory_confirmation",
      replySource: amb.replySource,
      contextPacket: amb.contextPacket,
      activeCommitmentId: commitment.id,
    });
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
    const decline = await refineInboundSmsMachineDraft({
      job,
      userId,
      commitment,
      timezone,
      inboundRaw: raw,
      machineBody: "Got it — I won’t save that. We’ll keep the current context.",
      hintSource: "memory_confirmation",
      ownedReplySource: "v3_memory_confirmation_refined",
    });
    await persistV2JobReplyReadyAndSend(job, userId, decline.body, {
      channel: "memory_confirmation",
      replySource: decline.replySource,
      contextPacket: decline.contextPacket,
      activeCommitmentId: commitment.id,
    });
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

  let replyText = anyApplied
    ? "Got it. I’ll remember that going forward."
    : "I couldn’t safely save that from what we have on file. We’ll keep your current profile as-is.";

  const memProofMeta = anyApplied
    ? buildProofMomentForMemoryUpdated({
        appliedIdentity: applied.appliedIdentity,
        appliedPeopleSummary: applied.appliedPeopleSummary,
        appliedResponsibility: applied.appliedResponsibility,
      })
    : null;
  const recentMemEvents = await getRecentV2EventsForAi(commitment.id);
  const memVictory = decideVictoryRoomSmsCallout({
    proofMeta: memProofMeta,
    eventsNewestFirst: recentMemEvents,
  });
  const beforeMemVictory = replyText;
  replyText = appendSmsParagraphIfUnderCap(replyText, memVictory.appendToReply);
  const memVictoryShown = memVictory.appendToReply != null && replyText !== beforeMemVictory;

  const memRefined = await refineInboundSmsMachineDraft({
    job,
    userId,
    commitment,
    timezone,
    inboundRaw: raw,
    machineBody: replyText,
    hintSource: "memory_confirmation",
    ownedReplySource: "v3_memory_confirmation_refined",
  });
  await persistV2JobReplyReadyAndSend(job, userId, memRefined.body, {
    channel: "memory_confirmation",
    replySource: memRefined.replySource,
    contextPacket: memRefined.contextPacket,
    activeCommitmentId: commitment.id,
  });
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
    victoryCalloutExtras: memVictoryShown ? memVictory.eventPayloadExtras : undefined,
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

  const result = await tryHandleSmsInboundPendingResolution({
    job: { message_sid: job.message_sid, raw_body: job.raw_body },
    clerkUserId: userId,
    commitment: c,
  });

  if (!result.handled) {
    return false;
  }

  let pendingVisible = result.replyBody;
  let pendingReplySource: string | undefined;
  try {
    const rawPr = (job.raw_body || "").trim();
    if (
      rawPr &&
      !isLikelySmsComplianceOrOptOutTurn(rawPr) &&
      !isLikelyCommitmentChangeIntentTurn(rawPr) &&
      !isV2PendingProposalValid(c)
    ) {
      const coachingMemoryPr = await loadV2CoachingMemoryForPrompt(c.id);
      const recentEventsPr = await getRecentV2EventsForAi(c.id);
      const convPackPr = await buildV2SmsConversationContextPack({
        clerkUserId: userId,
        commitmentId: c.id,
        commitment: c,
        timezone,
        currentInboundText: rawPr,
        preloadedCoachingMemory: coachingMemoryPr,
        preloadedEventsNewestFirst: recentEventsPr,
      });
      const effectiveAskPr = getEffectiveCoachingAsk(c);
      const classificationPr = classifyV2InboundReply(rawPr);
      const latestCheckPr = recentEventsPr.find((e) => e.event_type === "check_sent");
      const checkPayloadPr = (latestCheckPr?.payload_json ?? {}) as Record<string, unknown>;
      const lastOutPr =
        typeof checkPayloadPr.body_preview === "string" && checkPayloadPr.body_preview.trim()
          ? checkPayloadPr.body_preview.trim().slice(0, 260)
          : null;
      const northStarPktPr = buildInboundNorthStarContextPacket({
        commitmentId: c.id,
        behaviorStatement: c.behavior_statement ?? "",
        effectiveAskText: effectiveAskPr,
        timezone,
        userMessage: rawPr,
        lastOutboundSmsPreview: lastOutPr,
        checkPayload: checkPayloadPr,
        recentEvents: recentEventsPr,
        convPack: convPackPr,
        coachingMemory: coachingMemoryPr,
        finalEventType: classificationPr.eventType,
        lifeDesires: null,
        peopleSummary: null,
        identityAnchorText: null,
        latestBlockerPreview: null,
      });
      const priorYesPr = recentEventsIncludeUserYesOnLocalDay(
        recentEventsPr,
        timezone,
        getDateKeyInTimezone(new Date(), timezone)
      );
      try {
        const refinedPr = await produceV3InboundCoachDraft({
          userMessage: rawPr,
          messageSid: job.message_sid,
          commitment: c,
          effectiveAsk: effectiveAskPr,
          timezone,
          northStarPacket: northStarPktPr,
          convPackRecentLines: convPackPr.recentTranscriptLines ?? [],
          expectedReplySemantics: northStarPktPr.expectedReplySemantics as ExpectedReplySemanticsV3,
          latestOpenQuestion: northStarPktPr.latestOpenQuestion ?? null,
          todayCompleted: priorYesPr,
          coachingMemory: coachingMemoryPr,
          recentEvents: recentEventsPr,
          gatedDecision: V3_REFINE_ONLY_GATED,
          deterministicEventType: classificationPr.eventType,
          priorDraftHint: { source: "sms_pending_resolution", text: pendingVisible },
        });
        pendingVisible = refinedPr.draft;
        pendingReplySource = inferV3InboundReplySource(refinedPr.brain, refinedPr.openAiOk, true);
      } catch (e0) {
        const rec = await recoverV3InboundCoachDraftFromArgs({
          userMessage: rawPr,
          messageSid: job.message_sid,
          commitment: c,
          effectiveAsk: effectiveAskPr,
          timezone,
          northStarPacket: northStarPktPr,
          convPackRecentLines: convPackPr.recentTranscriptLines ?? [],
          expectedReplySemantics: northStarPktPr.expectedReplySemantics as ExpectedReplySemanticsV3,
          latestOpenQuestion: northStarPktPr.latestOpenQuestion ?? null,
          todayCompleted: priorYesPr,
          coachingMemory: coachingMemoryPr,
          recentEvents: recentEventsPr,
          gatedDecision: V3_REFINE_ONLY_GATED,
          deterministicEventType: classificationPr.eventType,
          priorDraftHint: { source: "sms_pending_resolution", text: pendingVisible },
        });
        pendingVisible = rec.draft;
        pendingReplySource = inferV3InboundReplySource(rec.brain, rec.openAiOk, true);
      }
    }
  } catch (e) {
    console.warn("[v3-sms-brain] pending_resolution_refine_failed", {
      commitment_id: c.id,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  await persistV2JobReplyReadyAndSend(job, userId, pendingVisible, {
    channel: "pending_resolution",
    replySource: pendingReplySource,
    activeCommitmentId: c.id,
    effectiveAsk: getEffectiveCoachingAsk(c, Date.now()),
    behaviorStatement: c.behavior_statement ?? null,
  });
  await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
  await mergeInboundMemoryIntoSmsPendingResolution({
    job,
    userId,
    commitmentAfterHandle: c,
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
          await persistRefreshSmsRefinedAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "Already recorded from a prior reply in this thread. Normal checks continue.",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (still.result === "state_conflict" || still.result === "not_found") {
          await persistRefreshSmsRefinedAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "No active identity refresh step to update from this reply. Normal checks continue.",
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
      await persistRefreshSmsRefinedAndSend({
        job,
        userId,
        commitment,
        timezone,
        inboundRaw: rawTrimmed,
        machineBody: stepB,
      });
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
          bodyPreview: stepB,
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
          await persistRefreshSmsRefinedAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "Already recorded from a prior reply in this thread. Normal checks continue.",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (change.result === "state_conflict" || change.result === "not_found") {
          await persistRefreshSmsRefinedAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "No active identity refresh step to update from this reply. Normal checks continue.",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        throw new Error(`refresh_identity_change_failed:${change.error}`);
      }
      const { body } = buildGuidedResolutionChangeHandoffSms();
      await persistRefreshSmsRefinedAndSend({
        job,
        userId,
        commitment,
        timezone,
        inboundRaw: rawTrimmed,
        machineBody: body,
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
          await persistRefreshSmsRefinedAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "Already recorded from a prior reply in this thread. Normal checks continue.",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (clarify.result === "state_conflict" || clarify.result === "not_found") {
          await persistRefreshSmsRefinedAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "No active identity refresh step to update from this reply. Normal checks continue.",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        throw new Error(`refresh_identity_clarify_failed:${clarify.error}`);
      }
      const { body } = buildRefreshClarifyIdentitySms();
      await persistRefreshSmsRefinedAndSend({
        job,
        userId,
        commitment,
        timezone,
        inboundRaw: rawTrimmed,
        machineBody: body,
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
        await persistRefreshSmsRefinedAndSend({
          job,
          userId,
          commitment,
          timezone,
          inboundRaw: rawTrimmed,
          machineBody:
            "Already recorded from a prior reply in this thread. Normal checks continue.",
        });
        await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
        return true;
      }
      if (abortIdentity.result === "state_conflict" || abortIdentity.result === "not_found") {
        await persistRefreshSmsRefinedAndSend({
          job,
          userId,
          commitment,
          timezone,
          inboundRaw: rawTrimmed,
          machineBody:
            "No active identity refresh step to update from this reply. Normal checks continue.",
        });
        await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
        return true;
      }
      throw new Error(`refresh_identity_aborted_unclear_failed:${abortIdentity.error}`);
    }
    await persistRefreshSmsRefinedAndSend({
      job,
      userId,
      commitment,
      timezone,
      inboundRaw: rawTrimmed,
      machineBody:
        "Closing that alignment check for now—no changes saved from this thread. Normal checks continue.",
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
          await persistRefreshSmsRefinedAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "Already recorded from a prior reply in this thread. Normal checks continue.",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (keep.result === "state_conflict" || keep.result === "not_found") {
          await persistRefreshSmsRefinedAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "No active commitment refresh step to update from this reply. Normal checks continue.",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        throw new Error(`refresh_commitment_keep_failed:${keep.error}`);
      }
      await touchCommitmentRefreshPromptedTimestamp(commitment.id);
      const { body } = buildRefreshKeepAckSms();
      await persistRefreshSmsRefinedAndSend({
        job,
        userId,
        commitment,
        timezone,
        inboundRaw: rawTrimmed,
        machineBody: body,
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
          await persistRefreshSmsRefinedAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "Already recorded from a prior reply in this thread. Normal checks continue.",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (tighten.result === "state_conflict" || tighten.result === "not_found") {
          await persistRefreshSmsRefinedAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "No active commitment refresh step to update from this reply. Normal checks continue.",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        throw new Error(`refresh_commitment_tighten_failed:${tighten.error}`);
      }
      const { body } = buildGuidedTightenHandoffSms();
      await persistRefreshSmsRefinedAndSend({
        job,
        userId,
        commitment,
        timezone,
        inboundRaw: rawTrimmed,
        machineBody: body,
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
          await persistRefreshSmsRefinedAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "Already recorded from a prior reply in this thread. Normal checks continue.",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (replace.result === "state_conflict" || replace.result === "not_found") {
          await persistRefreshSmsRefinedAndSend({
            job,
            userId,
            commitment,
            timezone,
            inboundRaw: rawTrimmed,
            machineBody:
              "No active commitment refresh step to update from this reply. Normal checks continue.",
          });
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        throw new Error(`refresh_commitment_new_failed:${replace.error}`);
      }
      const { body } = buildGuidedResolutionNewHandoffSms();
      await persistRefreshSmsRefinedAndSend({
        job,
        userId,
        commitment,
        timezone,
        inboundRaw: rawTrimmed,
        machineBody: body,
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
      await persistRefreshSmsRefinedAndSend({
        job,
        userId,
        commitment,
        timezone,
        inboundRaw: rawTrimmed,
        machineBody: body,
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
        await persistRefreshSmsRefinedAndSend({
          job,
          userId,
          commitment,
          timezone,
          inboundRaw: rawTrimmed,
          machineBody:
            "Already recorded from a prior reply in this thread. Normal checks continue.",
        });
        await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
        return true;
      }
      if (aborted.result === "state_conflict" || aborted.result === "not_found") {
        await persistRefreshSmsRefinedAndSend({
          job,
          userId,
          commitment,
          timezone,
          inboundRaw: rawTrimmed,
          machineBody:
            "No active commitment refresh step to update from this reply. Normal checks continue.",
        });
        await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
        return true;
      }
      throw new Error(`refresh_commitment_aborted_unclear_failed:${aborted.error}`);
    }
    await persistRefreshSmsRefinedAndSend({
      job,
      userId,
      commitment,
      timezone,
      inboundRaw: rawTrimmed,
      machineBody:
        "Didn’t catch a clear answer on that. Normal checks continue—update the commitment in the app when you’re ready.",
    });
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    await recomputeV2CoachingMemory(commitment.id, {
      reasonCode: "inbound_refresh_commitment_aborted_unclear",
    });
    return true;
  }

  return false;
}

async function handleV2SmsInboundCoachJob(
  job: JobRow,
  userId: string,
  commitment: ActiveV2CommitmentRow,
  timezone: string
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
    await markJobFinal({
      messageSid: job.message_sid,
      status: "cancelled",
      lastError: "imessage_tapback_suppressed",
      nextRetry: farFutureIso(),
    });
    console.log("[sms-inbound-coach] suppressed_apple_tapback_inbound", job.message_sid);
    return;
  }

  if (isBlockerCapturePendingActive(c)) {
    const original = (job.raw_body || "").trim();
    if (!original) {
      await clearBlockerCapturePending(c.id);
      const cleared: ActiveV2CommitmentRow = {
        ...c,
        blocker_capture_expires_at: null,
        blocker_capture_after_event: null,
      };
      await processV2NormalInboundOutcome(job, userId, cleared, classifyV2InboundReply(""), timezone);
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
      await processV2NormalInboundOutcome(job, userId, cleared, classification, timezone);
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

  const inboundClassification = classifyV2InboundReply((job.raw_body || "").trim());
  if (await processV2MemoryConfirmationInbound(job, userId, c, timezone, inboundClassification)) {
    return;
  }

  await processV2NormalInboundOutcome(job, userId, c, inboundClassification, timezone);
}

/** Finalize job: reply_ready → Twilio send → sent (shared by legacy coach path + V2). */
async function commitAndSendInboundCoachReply(job: JobRow, userId: string): Promise<void> {
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
}

async function processJob(claimedJob: JobRow): Promise<void> {
  const fresh = await loadJob(claimedJob.message_sid);
  if (!fresh) {
    throw new Error("job_missing");
  }

  let job = fresh;

  if (job.status === "processing" && typeof job.created_at === "string" && job.created_at.trim()) {
    const { mergedRawBody, cancelledMessageSids } = await coalesceOlderPendingSplitJobsForClaimedJob({
      message_sid: job.message_sid,
      clerk_user_id: job.clerk_user_id,
      created_at: job.created_at,
      raw_body: job.raw_body || "",
    });
    if (cancelledMessageSids.length > 0) {
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
    await handleV2SmsInboundCoachJob(job, userId, activeV2Commitment, v2Timezone);
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
