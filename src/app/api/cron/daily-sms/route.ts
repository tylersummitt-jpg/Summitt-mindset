/**
 * Daily SMS cron: V2 accountability outbound only (PR6). Reservation + `sms_send_events` unchanged.
 */
import crypto from "crypto";
import { NextResponse } from "next/server";
import { getClerkUser } from "@/lib/clerk-rest";
import { syncSmsAudience } from "@/lib/sms-audience-sync";
import { supabaseServer } from "@/lib/supabase-server";
import { smsTimePreferenceFromClerkMetadata } from "@/lib/sms-daily-delivery-body";
import { resolveUserTimezone, getDateKeyInTimezone } from "@/lib/timezone";
import { sendSMS, isTwilioReady } from "@/lib/twilio";
import {
  deriveSmsGoalAdjustmentSignal,
  smsGoalAdjustmentShrinkOverlayEligible,
} from "@/lib/sms-goal-adjustment-signal";
import {
  deriveSmsPatternSignal,
  smsPatternRecurrenceEligibleForDailyPurpose,
} from "@/lib/sms-pattern-signal";
import {
  dailyServerStrategyDuringPlannedInterruption,
  loadRecentPlannedInterruptionSignalForCommitment,
} from "@/lib/sms-planned-interruption";
import type { SmsGoalAdjustmentSignalResult } from "@/lib/sms-goal-adjustment-signal";
import {
  buildCheckSentAiPayload,
  deriveV2CoachingState,
  deriveV2DailyMessagePurpose,
  deriveV2NextMove,
  deriveV2ReentryContext,
  deriveV2SilenceContext,
  pickV2OutboundStrategy,
  resolveV2OutboundStrategyAfterBase,
  templateFamilyForStrategy,
  V2_OUTBOUND_AI_MODEL,
  V2_OUTBOUND_AI_PROMPT_VERSION,
  computeCanonicalShrinkProposalAskFromBehavior,
} from "@/lib/v2-ai-outbound";
import {
  buildV2OutboundAccountabilitySmsForStrategy,
  buildV2RecommitProposalOutboundSms,
  buildV2ShrinkProposalOutboundSms,
  type V2NextMoveKind,
} from "@/lib/v2-sms-accountability";
import {
  clearStaleAdaptiveContractColumns,
  getEffectiveCoachingAsk,
  isV2AdaptiveOverlayActive,
  isV2PendingProposalValid,
  type V2AdaptiveContractKind,
  V2_ADAPTIVE_PROPOSAL_TTL_MS,
} from "@/lib/v2-adaptive-contract";
import {
  computeIdentityReferenceAllowed,
  isIdentityRefreshDue,
  isQuotableIdentitySource,
  markIdentityAnchorReferencedIfPresentInBody,
  parseIsoMs,
  V2_IDENTITY_REFRESH_INTERVAL_MS,
} from "@/lib/v2-identity-anchor";
import {
  abandonRefreshSessionTimeout,
  reconcileRefreshPostSendBookkeepingForCommitment,
  buildRefreshStepCommitmentSms,
  buildRefreshStepIdentitySms,
  computeWave1ColdStartRefreshEligible,
  isRefreshSessionActive,
  newRefreshSessionIdentityStep,
  onV2RefreshOutboundSendSuccess,
  parseRefreshSession,
  shouldAbandonStaleIdentityStep,
  type V2RefreshOutboundPlan,
} from "@/lib/v2-refresh-session";
import {
  onV2StandardCheckSentOutboundSendSuccess,
  reconcileCheckSentPostSendBookkeepingForCommitment,
  type V2CheckSentExpectedReplySemantics,
  type V2CheckSentPromptKind,
} from "@/lib/v2-outbound-check-sent";
import { loadV2CoachingMemoryForPrompt, recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import {
  isReactivationNudgeDue,
  parseCadenceLevelFromCheckSentPayload,
  shouldEnterLowPressureReactivation,
  V2_REACTIVATION_ENTRY_REASON,
} from "@/lib/v2-reactivation";
import {
  deriveV2CadencePayload,
  shouldSendV2CadenceToday,
  type V2CadencePayload,
} from "@/lib/v2-cadence";
import {
  enterLowPressureReactivationMode,
  getActiveCommitment,
  hasRecentInboundAccountabilityExchange,
  getLastNV2CheckSentPayloads,
  getLastV2CheckSentForCommitment,
  getLatestBlockerCapturedAfter,
  getLatestV2AccountabilityOutcome,
  getRecentV2EventsForAi,
  updateReactivationLastSentAt,
} from "@/lib/v2-commitment";
import { maybeRecordV2WeakNoReplyFromPriorAccountabilityDay } from "@/lib/v2-send-time-weak-no-reply";
import {
  fetchV2UserSendTimeProfile,
  formatReachabilityContextLine,
  isV2LearnedSendWindowAllowed,
  localHourToSendWindow,
  shouldUseLearnedSendTimeGate,
} from "@/lib/v2-send-time-profile";
import {
  fetchV2UserSmsCommsPreferences,
  isPauseActive,
  resolveDailySendWindowPolicy,
  shouldApplyUserCadenceOverride,
  shouldSkipDailyForCommsPrefs,
} from "@/lib/v2-sms-comms-preferences";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";
import { fetchPendingEvolutionRecommendation } from "@/lib/v2-commitment-evolution-recommendation";
import {
  buildV2SmsConversationContextPack,
  type V2SmsConversationContextPack,
} from "@/lib/v2-sms-conversation-context";
import {
  buildCoachingMemorySnippetForDailyLane,
  deriveDoNotRepeatHintsFromCoachingMemory,
  deriveSuggestedCoachingMoveForDailyFacts,
  produceDailyV3RelationshipSms,
  type DailyV3RelationshipFacts,
  type DailyV3RelationshipFactsForMove,
  type DailyV3RouteKind,
} from "@/lib/v3-daily-relationship-lane";
import {
  buildDailyThreadMemoryFromPacket,
  buildSmsRelationshipMemoryPacket,
  type SmsRelationshipMemoryPacket,
} from "@/lib/sms-relationship-memory-packet";
import {
  loadSmsVictoryBackgroundContext,
  mapSmsVictoryBackgroundToFacts,
  type V3VictoryBackgroundFacts,
} from "@/lib/sms-victory-background-context";
import { upsertCommitmentSmsThreadMemoryFromOutbound } from "@/lib/v2-commitment-sms-thread-memory";
import {
  evaluateCommitmentEvolutionForSms,
  pickWave7DailyEvolutionAction,
  shouldSurfaceWave7EvolutionDailyPurpose,
} from "@/lib/v2-sms-evolution-signal";
import {
  buildPendingResolutionDailyReminderSms,
  clearPendingResolutionIfExpired,
  getPendingResolutionOrNull,
  isPendingResolutionExpired,
  shouldSkipPendingResolutionDailyReminderDueToRecentConfirmation,
  type V2SmsPendingResolutionPayload,
} from "@/lib/v2-guided-resolution";
import { pickNorthStarWriterAttributionFields, type NorthStarCoachChannel } from "@/lib/north-star-coach-sms";
import { dailySmsVoiceSkipEventPatch, isDailySmsWithheldByFinalVoiceGate } from "@/lib/daily-sms-voice-skip";
import { buildDailyOutboundNorthStarContextPacket } from "@/lib/north-star-sms-context-packet";
import { finalizeNorthStarCoachSmsAsync } from "@/lib/north-star-coach-sms-openai";
import { V3_BRAIN_VERSION } from "@/lib/v3-sms-brain";
import { applyFinalVoiceOwnershipGate } from "@/lib/v3-sms-voice-ownership";
import {
  DAILY_SEMANTIC_CONTRACT_PROPOSAL_VERSION,
  DEFAULT_SEMANTIC_DAILY_CONTRACT_FORBIDDEN_PHRASES,
  type DailySemanticContractProposalFactsPacket,
} from "@/lib/v3-daily-contract-proposal-semantic";
import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;
const ENV_SMS_DRY_RUN = process.env.SMS_DRY_RUN === "true";

function assembleDailyThreadMemoryFromRelationshipPacket(
  packet: SmsRelationshipMemoryPacket,
  args: {
    convLatestOutbound?: string | null;
    convLatestInbound?: string | null;
    recentTranscriptOrContextBlock?: string | null;
    coachingMemorySnippet?: string;
    extraDoNotRepeatHints?: string[];
    recentPatternHints?: string | null;
  }
): DailyV3RelationshipFacts["thread_memory"] {
  return {
    ...buildDailyThreadMemoryFromPacket({
      packet,
      convLatestOutbound: args.convLatestOutbound,
      convLatestInbound: args.convLatestInbound,
      recentTranscriptOrContextBlock: args.recentTranscriptOrContextBlock,
      coachingMemorySnippet: args.coachingMemorySnippet,
      extraDoNotRepeatHints: args.extraDoNotRepeatHints,
    }),
    recent_pattern_hints: args.recentPatternHints ?? null,
  };
}

async function shouldSkipDailyForActiveInboundThread(clerkUserId: string): Promise<boolean> {
  const ac = await getActiveCommitment(clerkUserId);
  if (!ac?.id) return false;
  return hasRecentInboundAccountabilityExchange(ac.id);
}

function timeOfDayForOutboundContext(md: Record<string, unknown>): "morning" | "evening" {
  const pref = smsTimePreferenceFromClerkMetadata(md).toLowerCase().trim();
  if (pref === "midday" || pref === "evening") return "evening";
  return "morning";
}

type DailySmsBuilt =
  | {
      ok: true;
      smsBody: string;
      deliveryStateSnapshot: null;
      day2SpecialUsed: boolean;
      sentPatQuoteId?: string;
      sentRespondQuestionId?: string;
      v2Accountability: boolean;
      v2CommitmentId?: string;
      v2TemplateId?: number;
      v2TemplateFamily?: "standard" | "recovery" | "reactivation";
      v2PriorOutcome?: string | null;
      v2BlockerPreview?: string | null;
      v2AiPayload?: Record<string, unknown> | null;
      v2SilencePayload?: Record<string, unknown> | null;
      v2ReentryPayload?: Record<string, unknown> | null;
      v2NextMovePayload?: Record<string, unknown> | null;
      v2CadencePayload?: V2CadencePayload | null;
      /** True when sending shrink_ask or recommit_same overlay proposal SMS. */
      v2ContractProposalMode?: boolean;
      v2ContractProposalKind?: V2AdaptiveContractKind | null;
      v2ProposalBindingText?: string | null;
      v2ContractProposalPayload?: Record<string, unknown> | null;
      /** Canonical anchor from user_profiles for post-send reference tracking only. */
      v2IdentityAnchorText?: string | null;
      /** When set, post-Twilio success runs refresh session + `coaching_refresh_prompted` side effects. */
      v2RefreshOutboundPlan?: V2RefreshOutboundPlan | null;
      /** Guided-resolution pending nudge — not a normal YES/NO accountability check. */
      v2PendingResolutionReminder?: boolean;
      /** Weekly low-pressure nudge while paused (no check_sent row). */
      v2ReactivationNudge?: boolean;
      /** Effective ask context at send time for deterministic post-send snapshot. */
      v2EffectiveAskText?: string | null;
      /** Daily body drafted by V3 SMS Brain (North Star deterministic guard still applies). */
      v3DailySms?: boolean;
      /** True when visible line came from deterministic V3 fallback (no successful OpenAI daily draft). */
      v3DailyDeterministicFallback?: boolean;
      /** Central V3 daily relationship lane (Phase 2 — all daily branches). */
      v3DailyRelationshipLane?: boolean;
    }
  | {
      ok: false;
      error: string;
      adaptiveProposalWithheldMeta?: Record<string, unknown>;
      dailyLaneMeta?: Record<string, unknown>;
    };

async function withNorthStarDailyGate(
  built: DailySmsBuilt,
  opts?: { localHour?: number }
): Promise<DailySmsBuilt> {
  if (!built.ok) return built;
  const channel: NorthStarCoachChannel = built.v2PendingResolutionReminder
    ? "pending_resolution"
    : built.v2RefreshOutboundPlan
      ? "refresh"
      : built.v2ReactivationNudge
        ? "reactivation"
        : built.v2ContractProposalMode
          ? "contract_prompt"
          : "daily_outbound";
  const ns = await finalizeNorthStarCoachSmsAsync({
    proposedBody: built.smsBody,
    channel,
    behaviorStatement: built.v2EffectiveAskText ?? undefined,
    effectiveAskText: built.v2EffectiveAskText ?? undefined,
    localHour: opts?.localHour,
    replySource:
      built.v3DailyRelationshipLane === true
        ? "v3_daily_relationship_lane"
        : built.v3DailySms === true
          ? built.v3DailyDeterministicFallback === true
            ? "v3_daily_deterministic_fallback"
            : "v3_daily_check_in"
          : undefined,
    metadata: {
      v2TemplateFamily: built.v2TemplateFamily,
      v2CommitmentId: built.v2CommitmentId,
    },
    contextPacket:
      built.v2Accountability && (built.v2CommitmentId || built.v2PriorOutcome != null || built.v2BlockerPreview)
        ? buildDailyOutboundNorthStarContextPacket({
            commitmentId: built.v2CommitmentId ?? null,
            effectiveAskText: built.v2EffectiveAskText ?? null,
            priorOutcome: built.v2PriorOutcome ?? null,
            blockerPreview: built.v2BlockerPreview ?? null,
          })
        : undefined,
  });
  const voiceGate = await applyFinalVoiceOwnershipGate({
    proposedBody: ns.visibleBody,
    replySource:
      built.v3DailyRelationshipLane === true
        ? "v3_daily_relationship_lane"
        : built.v3DailySms === true
          ? built.v3DailyDeterministicFallback === true
            ? "v3_daily_deterministic_fallback"
            : "v3_daily_check_in"
          : undefined,
    channel,
    activeCommitmentId: built.v2CommitmentId ?? null,
    effectiveAsk: built.v2EffectiveAskText ?? null,
    behaviorStatement: built.v2EffectiveAskText ?? null,
    contextPacket:
      built.v2Accountability && (built.v2CommitmentId || built.v2PriorOutcome != null || built.v2BlockerPreview)
        ? buildDailyOutboundNorthStarContextPacket({
            commitmentId: built.v2CommitmentId ?? null,
            effectiveAskText: built.v2EffectiveAskText ?? null,
            priorOutcome: built.v2PriorOutcome ?? null,
            blockerPreview: built.v2BlockerPreview ?? null,
          })
        : undefined,
    northStarMeta: ns.meta,
    normalCoaching:
      built.v2Accountability === true &&
      Boolean(built.v2CommitmentId),
    /** Daily adaptive proposals route through semantic relationship wording — no pasted server binding verbatim. */
    bindingVerbatim: null,
  });
  const out: Extract<DailySmsBuilt, { ok: true }> = {
    ...built,
    smsBody: voiceGate.shouldSend ? voiceGate.body : "",
  };
  out.v2AiPayload = {
    ...(built.v2AiPayload && typeof built.v2AiPayload === "object" ? built.v2AiPayload : {}),
    north_star_gate: {
      original_body: ns.meta.originalBody,
      body_after_north_star: ns.visibleBody,
      final_body: voiceGate.shouldSend ? voiceGate.body : ns.visibleBody,
      north_star_gate_source: ns.meta.source,
      north_star_gate_reasons: ns.meta.blockedReasons,
      openai_attempted: ns.meta.openaiAttempted,
      openai_failed_reason: ns.meta.openaiFailedReason ?? null,
      context_packet_used: ns.meta.contextPacketUsed,
      finalizer_version: ns.meta.finalizerVersion,
      ...pickNorthStarWriterAttributionFields(ns.meta),
    },
    final_voice_gate: voiceGate.metadata,
    voice_send_decision: {
      should_send: voiceGate.shouldSend,
      skip_reason: voiceGate.skipReason ?? null,
      voice_channel: channel,
      north_star_visible_body: ns.visibleBody,
      blocked_reasons: voiceGate.blockedReasons,
      ...(voiceGate.shouldSend ? {} : { twilio_send_attempted: false }),
    },
  };
  return out;
}

function dailySmsSentEventVoiceMetadata(
  built: Extract<DailySmsBuilt, { ok: true }>
): Record<string, unknown> {
  const p = built.v2AiPayload;
  if (!p || typeof p !== "object" || !p.final_voice_gate || typeof p.final_voice_gate !== "object") {
    return {};
  }
  const fvg = p.final_voice_gate as Record<string, unknown>;
  const vsd = p.voice_send_decision as { should_send?: boolean } | undefined;
  return {
    final_voice_gate: fvg,
    north_star_gate: p.north_star_gate,
    voice_send_decision: vsd,
    voice_owner: fvg.voice_owner,
    should_send: fvg.should_send,
    skip_reason: fvg.skip_reason ?? null,
    voice_decision: vsd?.should_send === false ? "skipped_no_safe_v3_voice" : "accepted_post_final_voice_gate",
    final_voice_source: fvg.final_voice_source,
    final_voice_blocked_reasons: fvg.final_voice_blocked_reasons,
  };
}

async function resolveV2BlockerPreviewForOutbound(args: {
  commitmentId: string;
  latestOutcome: Awaited<ReturnType<typeof getLatestV2AccountabilityOutcome>>;
  recentEvents: import("@/lib/v2-commitment").V2EventRowForAi[];
}): Promise<string | null> {
  let blockerPreview: string | null = null;
  if (
    args.latestOutcome &&
    (args.latestOutcome.type === "user_no" || args.latestOutcome.type === "user_partial")
  ) {
    const blocker = await getLatestBlockerCapturedAfter(
      args.commitmentId,
      args.latestOutcome.occurred_at
    );
    if (blocker?.message) {
      blockerPreview = blocker.message.slice(0, 80);
    }
  }
  if (!blockerPreview) {
    const blockerEv = args.recentEvents.find((e) => e.event_type === "blocker_captured");
    const rawMsg = blockerEv?.payload_json?.message;
    if (typeof rawMsg === "string" && rawMsg.trim()) {
      blockerPreview = rawMsg.trim().slice(0, 80);
    }
  }
  return blockerPreview && blockerPreview.trim().length > 0 ? blockerPreview : null;
}

function buildStandardCheckSentPayload(args: {
  priorOutcome?: string | null;
  blockerPreview?: string | null;
  silence?: Record<string, unknown> | null;
  reentry?: Record<string, unknown> | null;
  nextMove?: Record<string, unknown> | null;
  ai?: Record<string, unknown> | null;
  cadence?: V2CadencePayload | null;
  contractProposal?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return {
    ...(args.priorOutcome != null ? { prior_outcome: args.priorOutcome } : {}),
    ...(args.blockerPreview != null && args.blockerPreview.length > 0
      ? { blocker_preview: args.blockerPreview }
      : {}),
    ...(args.silence ? { silence: args.silence } : {}),
    ...(args.reentry ? { reentry: args.reentry } : {}),
    ...(args.nextMove ? { next_move: args.nextMove } : {}),
    ...(args.ai ? { ai: args.ai } : {}),
    ...(args.cadence ? { cadence: args.cadence } : {}),
    ...(args.contractProposal ? { contract_proposal: args.contractProposal } : {}),
  };
}

/** Adds audited visible SMS fingerprint to contract snapshot payload immediately before DB snapshot write. */
function withPresentedDailyContractProposalAuditFields(
  contractProposal: Record<string, unknown> | null | undefined,
  presentedBody: string
): Record<string, unknown> | null {
  if (!contractProposal || typeof contractProposal !== "object" || Array.isArray(contractProposal)) {
    return null;
  }
  const trimmed = presentedBody.trim();
  return {
    ...contractProposal,
    proposal_presented_body: trimmed,
    proposal_presented_body_hash: hashSmsSnippet(trimmed),
  };
}

/** M2B-2: persist durable thread memory after Twilio accepted a V3 daily relationship lane SMS. */
async function writeV2SmsThreadMemoryAfterDailyV3Outbound(args: {
  built: Extract<DailySmsBuilt, { ok: true }>;
  clerkUserId: string;
  sentBody: string;
  messageSid: string | null;
  sentAt?: Date;
}): Promise<void> {
  if (!args.built.v3DailyRelationshipLane || !args.built.v2CommitmentId) return;

  let expectedAnswerType: string | null = null;
  if (args.built.v2ContractProposalMode) {
    expectedAnswerType = "proposal_yes_no";
  } else if (
    !args.built.v2ReactivationNudge &&
    !args.built.v2PendingResolutionReminder &&
    args.built.v2Accountability
  ) {
    expectedAnswerType = "yes_no_partial";
  }

  const result = await upsertCommitmentSmsThreadMemoryFromOutbound({
    commitmentId: args.built.v2CommitmentId,
    clerkUserId: args.clerkUserId,
    sentBody: args.sentBody,
    sentAt: args.sentAt ?? new Date(),
    messageSid: args.messageSid,
    source: "daily_sms",
    expectedAnswerType,
  });

  if (!result.ok) {
    console.warn("[daily-sms] v2_sms_thread_memory_outbound_upsert_failed", {
      commitment_id: args.built.v2CommitmentId,
      clerk_user_id: args.clerkUserId,
      error: result.error,
    });
  }
}

async function insertV2CheckSentEventBestEffort(args: {
  commitmentId: string;
  clerkUserId: string;
  dayKey: string;
  templateId: number;
  messageSid: string;
  bodyPreview: string;
  templateFamily: "standard" | "recovery";
  priorOutcome?: string | null;
  blockerPreview?: string | null;
  silence?: Record<string, unknown> | null;
  reentry?: Record<string, unknown> | null;
  nextMove?: Record<string, unknown> | null;
  ai?: Record<string, unknown> | null;
  cadence?: V2CadencePayload | null;
  contractProposal?: Record<string, unknown> | null;
  coachingRefresh?: Record<string, unknown> | null;
}): Promise<void> {
  const { error } = await supabaseServer.from("v2_commitment_event").insert({
    commitment_id: args.commitmentId,
    clerk_user_id: args.clerkUserId,
    event_type: "check_sent",
    source: "sms_v2_accountability",
    payload_json: {
      day_key: args.dayKey,
      template_id: args.templateId,
      template_family: args.templateFamily,
      channel: "sms",
      message_sid: args.messageSid,
      body_preview: args.bodyPreview,
      ...(args.priorOutcome != null ? { prior_outcome: args.priorOutcome } : {}),
      ...(args.blockerPreview != null && args.blockerPreview.length > 0
        ? { blocker_preview: args.blockerPreview }
        : {}),
      ...(args.silence ? { silence: args.silence } : {}),
      ...(args.reentry ? { reentry: args.reentry } : {}),
      ...(args.nextMove ? { next_move: args.nextMove } : {}),
      ...(args.ai ? { ai: args.ai } : {}),
      ...(args.cadence ? { cadence: args.cadence } : {}),
      ...(args.contractProposal ? { contract_proposal: args.contractProposal } : {}),
      ...(args.coachingRefresh ? { coaching_refresh: args.coachingRefresh } : {}),
    },
    idempotency_key: `v2_check_sent:${args.commitmentId}:${args.dayKey}`,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") return;
    console.error("[daily-sms] v2 check_sent insert failed", {
      clerk_user_id: args.clerkUserId,
      message: error.message,
    });
  }
}

/**
 * V2: active commitment → accountability templates (no legacy delivery-state body).
 * Legacy: existing delivery engine unchanged.
 */
async function buildDailySmsContent(
  clerkUserId: string,
  md: Record<string, unknown>,
  accountabilityDayKey: string
): Promise<DailySmsBuilt> {
  let active = await getActiveCommitment(clerkUserId);
  if (active?.behavior_statement?.trim()) {
    const timezone = resolveUserTimezone(md.timezone);
    await clearStaleAdaptiveContractColumns(active.id);
    try {
      const checkSentReconcile = await reconcileCheckSentPostSendBookkeepingForCommitment({
        commitmentId: active.id,
        clerkUserId,
      });
      if (checkSentReconcile.failures > 0) {
        console.warn("[daily-sms] check_sent reconcile unresolved", {
          clerk_user_id: clerkUserId,
          commitment_id: active.id,
          attempted: checkSentReconcile.attempted,
          recovered: checkSentReconcile.recovered,
          failures: checkSentReconcile.failures,
          snapshot_candidates_found: checkSentReconcile.snapshotCandidatesFound,
          snapshot_replay_attempted: checkSentReconcile.snapshotReplayAttempted,
          snapshot_replay_applied: checkSentReconcile.snapshotReplayApplied,
          heuristic_fallback_attempted: checkSentReconcile.heuristicFallbackAttempted,
          heuristic_fallback_applied: checkSentReconcile.heuristicFallbackApplied,
          unresolved_after_both: checkSentReconcile.unresolvedAfterBoth,
        });
      }
    } catch (e) {
      console.error("[daily-sms] check_sent post-send reconcile failed", {
        clerk_user_id: clerkUserId,
        commitment_id: active.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
    try {
      const reconcile = await reconcileRefreshPostSendBookkeepingForCommitment({
        commitmentId: active.id,
        clerkUserId,
      });
      if (reconcile.failures > 0) {
        console.warn("[daily-sms] refresh reconcile unresolved", {
          clerk_user_id: clerkUserId,
          commitment_id: active.id,
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
    } catch (e) {
      console.error("[daily-sms] refresh post-send reconcile failed", {
        clerk_user_id: clerkUserId,
        commitment_id: active.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }
    const refreshed = await getActiveCommitment(clerkUserId);
    if (refreshed?.behavior_statement?.trim()) {
      active = refreshed;
    }

    const sendTimeProfileRow = await fetchV2UserSendTimeProfile(clerkUserId);
    const reachabilityContextLine = formatReachabilityContextLine(sendTimeProfileRow);

    const now = new Date();
    let victoryBackgroundFacts: V3VictoryBackgroundFacts | null = null;
    try {
      victoryBackgroundFacts = mapSmsVictoryBackgroundToFacts(
        await loadSmsVictoryBackgroundContext({
          clerkUserId,
          commitmentId: active.id,
          timezone,
        })
      );
    } catch (e) {
      console.warn("[daily-sms] victory_background_load_failed", {
        clerk_user_id: clerkUserId,
        commitment_id: active.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }

    if (active.accountability_phase === "low_pressure_reactivation") {
      if (
        !isReactivationNudgeDue({
          reactivationEnteredAt: active.reactivation_entered_at,
          reactivationLastSentAt: active.reactivation_last_sent_at,
          nowMs: now.getTime(),
        })
      ) {
        return { ok: false, error: "v2_reactivation_not_due" };
      }

      const recentEvents = await getRecentV2EventsForAi(active.id);
      const serverState = deriveV2CoachingState(recentEvents);
      const silenceCtx = deriveV2SilenceContext(recentEvents, now);
      const reentryCtx = deriveV2ReentryContext(recentEvents, now);
      const pausedCadence = {
        level: "every_3_days" as const,
        reason_code: "paused_low_pressure_reactivation",
        version: 1 as const,
      };
      const holdNextMove = {
        type: "hold_standard" as const,
        reason_code: "hold_while_reactivation",
        version: 1 as const,
      };

      const { data: profileRowRe } = await supabaseServer
        .from("user_profiles")
        .select("preferred_name")
        .eq("clerk_user_id", clerkUserId)
        .maybeSingle();

      const preferredNameRe =
        typeof profileRowRe?.preferred_name === "string" ? profileRowRe.preferred_name : null;

      const coachingMemoryRe = await loadV2CoachingMemoryForPrompt(active.id);

      const overlayActiveRe = isV2AdaptiveOverlayActive(active, now.getTime());

      let recentSmsContextBlock: string | null = null;
      let reactConvPack: V2SmsConversationContextPack | null = null;
      try {
        reactConvPack = await buildV2SmsConversationContextPack({
          clerkUserId,
          commitmentId: active.id,
          commitment: active,
          timezone,
          preloadedCoachingMemory: coachingMemoryRe,
          preloadedEventsNewestFirst: recentEvents,
        });
        recentSmsContextBlock = reactConvPack.promptBlock;
      } catch (e) {
        console.warn("[daily-sms] sms_conversation_context_pack_failed", {
          commitment_id: active.id,
          message: e instanceof Error ? e.message : String(e),
        });
      }

      const dailyPurposeRe = deriveV2DailyMessagePurpose({
        contractProposalMode: false,
        serverStrategy: "reactivation_nudge",
        reentry: reentryCtx,
        silence: silenceCtx,
        serverState,
        overlayActive: overlayActiveRe,
        hasBlockerPreview: false,
        eventsNewestFirst: recentEvents,
        coachingMemory: coachingMemoryRe,
        commitmentStartedAt: active.started_at,
        nowMs: now.getTime(),
        wave7SurfaceEvolution: false,
      });

      const stratRe = buildV2OutboundAccountabilitySmsForStrategy({
        clerkUserId,
        dayKey: accountabilityDayKey,
        behaviorStatement: active.behavior_statement,
        serverStrategy: "reactivation_nudge",
        nextMove: "hold_standard",
      });
      const templateIdRe = stratRe.templateId;

      const patternHintsRe = [
        reactConvPack?.proofHighlight,
        reactConvPack?.comebackSignal,
        reactConvPack?.recentBlockerPattern,
      ]
        .filter((x): x is string => Boolean(x && typeof x === "string"))
        .join(" | ");
      const relationshipToneSummaryRe =
        coachingMemoryRe?.sms_relationship_profile != null
          ? JSON.stringify(coachingMemoryRe.sms_relationship_profile).slice(0, 240)
          : null;

      const relationshipMemoryPacketRe = await buildSmsRelationshipMemoryPacket({
        clerkUserId,
        commitmentId: active.id,
      });

      const factsCoreRe: DailyV3RelationshipFactsForMove = {
        route_kind: "low_pressure_reactivation",
        accountability_day_key: accountabilityDayKey,
        user: {
          clerk_user_id: clerkUserId,
          preferred_name: preferredNameRe,
          timezone,
          local_time_iso: new Date(now.toLocaleString("en-US", { timeZone: timezone })).toISOString(),
          relationship_profile_summary: relationshipToneSummaryRe,
        },
        commitment: {
          id: active.id,
          title: active.title,
          behavior_statement: active.behavior_statement,
          effective_ask: active.behavior_statement.trim(),
          accountability_phase: active.accountability_phase,
          identity_anchor_allowed: false,
          identity_anchor_short: null,
        },
        thread_memory: assembleDailyThreadMemoryFromRelationshipPacket(relationshipMemoryPacketRe, {
          convLatestOutbound: reactConvPack?.lastOutboundPreview ?? null,
          convLatestInbound: reactConvPack?.lastInboundPreview ?? null,
          recentTranscriptOrContextBlock: recentSmsContextBlock,
          coachingMemorySnippet: buildCoachingMemorySnippetForDailyLane(coachingMemoryRe),
          extraDoNotRepeatHints: deriveDoNotRepeatHintsFromCoachingMemory(coachingMemoryRe),
          recentPatternHints: patternHintsRe.length > 0 ? patternHintsRe.slice(0, 480) : null,
        }),
        accountability: {
          daily_purpose: dailyPurposeRe,
          server_strategy: "reactivation_nudge",
          next_move_type: "hold_standard",
          prior_outcome: null,
          yes_streak_14d: coachingMemoryRe?.yes_streak_14d ?? null,
          no_count_14d: coachingMemoryRe?.no_count_14d ?? null,
          partial_count_14d: coachingMemoryRe?.partial_count_14d ?? null,
          blocker_preview: null,
          proof_or_milestone_signal: null,
          silence_tier: silenceCtx.tier,
          unanswered_checks: silenceCtx.unanswered_checks,
          days_since_last_user_outcome: silenceCtx.days_since_last_user_outcome,
          reentry_active: reentryCtx.active,
          overlay_active: overlayActiveRe,
          evolution_pattern_hint: null,
          contract_proposal_mode: false,
        },
        ...(victoryBackgroundFacts ? { victory_background: victoryBackgroundFacts } : {}),
      };
      const suggestedMoveRe = deriveSuggestedCoachingMoveForDailyFacts(factsCoreRe);
      const factsRe: DailyV3RelationshipFacts = {
        ...factsCoreRe,
        suggested_coaching_move: suggestedMoveRe,
        constraints: {
          max_chars: 300,
          one_sms: true,
          no_raw_title_or_behavior_paste: true,
          no_generic_motivation: true,
          if_unsafe_return_no_send: true,
        },
      };
      const laneRe = await produceDailyV3RelationshipSms({
        facts: factsRe,
        telemetry_fact_sources: [
          "deriveV2CoachingState",
          "deriveV2SilenceContext",
          "deriveV2ReentryContext",
          "deriveV2DailyMessagePurpose",
          "getRecentV2EventsForAi",
          "loadV2CoachingMemoryForPrompt",
          "buildV2SmsConversationContextPack",
          "buildV2OutboundAccountabilitySmsForStrategy",
        ],
      });
      if (!laneRe.shouldSend || !laneRe.body.trim()) {
        return {
          ok: false,
          error: "daily_v3_lane_no_send",
          dailyLaneMeta: { ...laneRe.metadata, no_send_reason: laneRe.noSendReason },
        };
      }
      const smsBodyRe = laneRe.body;
      const aiPayloadRe = {
        ...buildCheckSentAiPayload({
          model: V2_OUTBOUND_AI_MODEL,
          promptVersion: V2_OUTBOUND_AI_PROMPT_VERSION,
          serverState,
          serverStrategy: "reactivation_nudge",
          message: smsBodyRe,
          confidence: laneRe.voiceConfidence,
          fallbackUsed: false,
        }),
        reply_source: "v3_daily_relationship_lane",
        v3_brain: {
          v3_brain_version: V3_BRAIN_VERSION,
          v3_coach_reply_source: "v3_daily_relationship_lane",
          v3_memory_used: true,
          v3_daily_purpose: dailyPurposeRe,
          v3_deterministic_fallback_used: false,
          daily_v3_lane_used: true,
          v3_lane_reply_source: "v3_daily_relationship_lane",
          v3_lane_turn_purpose: laneRe.turnPurpose,
          v3_candidate_body: (laneRe.metadata.v3_candidate_body as string | undefined) ?? laneRe.body,
          old_daily_writer_used_as_voice: false,
          old_daily_writer_fact_sources: laneRe.metadata.old_daily_writer_fact_sources,
          daily_facts_summary: laneRe.metadata.daily_facts_summary,
          suggested_coaching_move: laneRe.metadata.suggested_coaching_move,
          route_purpose: "low_pressure_reactivation",
          voice_writer_chain: ["v3_daily_relationship_lane", "north_star_validator", "final_voice_gate"],
        },
      };

      const silencePayloadRe = {
        tier: silenceCtx.tier,
        unanswered_checks: silenceCtx.unanswered_checks,
        days_since_last_user_outcome: silenceCtx.days_since_last_user_outcome,
      };

      return {
        ok: true,
        smsBody: smsBodyRe,
        deliveryStateSnapshot: null,
        day2SpecialUsed: false,
        v2Accountability: true,
        v2ReactivationNudge: true,
        v2CommitmentId: active.id,
        v2TemplateId: templateIdRe,
        v2TemplateFamily: "reactivation",
        v2PriorOutcome: null,
        v2BlockerPreview: null,
        v2AiPayload: aiPayloadRe,
        v2SilencePayload: silencePayloadRe,
        v2ReentryPayload: { active: reentryCtx.active },
        v2NextMovePayload: {
          type: holdNextMove.type,
          reason_code: holdNextMove.reason_code,
          version: holdNextMove.version,
        },
        v2CadencePayload: pausedCadence,
        v2ContractProposalMode: false,
        v2ContractProposalKind: null,
        v2ProposalBindingText: null,
        v2ContractProposalPayload: null,
        v2EffectiveAskText: active.behavior_statement.trim(),
        v3DailySms: true,
        v3DailyDeterministicFallback: false,
        v3DailyRelationshipLane: true,
      };
    }

    const [latestOutcome, recentEvents] = await Promise.all([
      getLatestV2AccountabilityOutcome(active.id),
      getRecentV2EventsForAi(active.id),
    ]);

    let refreshSessionParsed = parseRefreshSession(active.refresh_session);
    if (
      refreshSessionParsed &&
      shouldAbandonStaleIdentityStep(refreshSessionParsed, now.getTime())
    ) {
      await abandonRefreshSessionTimeout({
        commitmentId: active.id,
        clerkUserId,
        session: refreshSessionParsed,
      });
      const reloadedActive = await getActiveCommitment(clerkUserId);
      if (reloadedActive?.behavior_statement?.trim()) {
        active = reloadedActive;
      }
      refreshSessionParsed = parseRefreshSession(active.refresh_session);
    }

    if (refreshSessionParsed?.step === "identity") {
      return { ok: false, error: "v2_refresh_identity_await_reply" };
    }

    const clearedPending = await clearPendingResolutionIfExpired(active.id, active, now.getTime());
    if (clearedPending) {
      const reloadedAfterPending = await getActiveCommitment(clerkUserId);
      if (reloadedAfterPending?.behavior_statement?.trim()) {
        active = reloadedAfterPending;
      }
    }

    if (
      active.accountability_phase === "active_accountability" &&
      getPendingResolutionOrNull(active) &&
      !isPendingResolutionExpired(active, now.getTime())
    ) {
      const recentConfirm = shouldSkipPendingResolutionDailyReminderDueToRecentConfirmation({
        row: active,
        nowMs: now.getTime(),
      });
      if (recentConfirm.skip) {
        console.info("[pending-resolution-reminder] skipped_recent_confirmation_prompt", {
          commitment_id: active.id,
          sms_state: recentConfirm.smsState,
          confirmation_prompt_age_minutes: recentConfirm.confirmationPromptAgeMinutes,
          candidate_present: recentConfirm.candidatePresent,
        });
        return { ok: false, error: "v2_pending_resolution_recent_confirmation_skip" };
      }
      const serverStatePr = deriveV2CoachingState(recentEvents);
      const pr = getPendingResolutionOrNull(active);
      const effectiveAskPr = getEffectiveCoachingAsk(active, now.getTime());
      const { data: prProf } = await supabaseServer
        .from("user_profiles")
        .select("preferred_name")
        .eq("clerk_user_id", clerkUserId)
        .maybeSingle();
      const preferredNamePr =
        typeof prProf?.preferred_name === "string" ? prProf.preferred_name : null;
      const coachingMemoryPr = await loadV2CoachingMemoryForPrompt(active.id);
      let prConvPack: V2SmsConversationContextPack | null = null;
      let prCtxBlock: string | null = null;
      try {
        prConvPack = await buildV2SmsConversationContextPack({
          clerkUserId,
          commitmentId: active.id,
          commitment: active,
          timezone,
          preloadedCoachingMemory: coachingMemoryPr,
          preloadedEventsNewestFirst: recentEvents,
        });
        prCtxBlock = prConvPack.promptBlock;
      } catch (e) {
        console.warn("[daily-sms] pending_resolution_context_pack_failed", {
          commitment_id: active.id,
          message: e instanceof Error ? e.message : String(e),
        });
      }

      let smsStatePr: string | null = null;
      let detectedIntentPr: string | null = null;
      let candidateSnippetPr: string | null = null;
      if (
        pr?.payload &&
        typeof pr.payload === "object" &&
        "source" in pr.payload &&
        pr.payload.source === "sms_inbound"
      ) {
        const smsPl = pr.payload as V2SmsPendingResolutionPayload;
        smsStatePr = smsPl.sms_state ?? null;
        detectedIntentPr = smsPl.detected_intent;
        const candRaw = (
          smsPl.candidate_behavior_statement?.trim() ||
          smsPl.candidate_tightened_bar?.trim() ||
          smsPl.candidate_new_bar?.trim() ||
          ""
        ).slice(0, 160);
        candidateSnippetPr = candRaw.length > 0 ? candRaw : null;
      }
      const payloadSourcePr =
        pr?.payload && typeof pr.payload === "object" && "source" in pr.payload
          ? String((pr.payload as { source?: string }).source ?? "").trim() || null
          : null;
      const awaitingConfirmationPr =
        smsStatePr === "awaiting_confirmation" && Boolean(candidateSnippetPr);
      const verbatimPr: string[] = [];
      if (awaitingConfirmationPr && candidateSnippetPr) verbatimPr.push(candidateSnippetPr);

      const patternHintsPr = [
        prConvPack?.proofHighlight,
        prConvPack?.comebackSignal,
        prConvPack?.recentBlockerPattern,
      ]
        .filter((x): x is string => Boolean(x && typeof x === "string"))
        .join(" | ");

      const relationshipMemoryPacketPr = await buildSmsRelationshipMemoryPacket({
        clerkUserId,
        commitmentId: active.id,
      });

      const factsCorePr: DailyV3RelationshipFactsForMove = {
        route_kind: "pending_resolution",
        accountability_day_key: accountabilityDayKey,
        user: {
          clerk_user_id: clerkUserId,
          preferred_name: preferredNamePr,
          timezone,
          local_time_iso: new Date(now.toLocaleString("en-US", { timeZone: timezone })).toISOString(),
          relationship_profile_summary:
            coachingMemoryPr?.sms_relationship_profile != null
              ? JSON.stringify(coachingMemoryPr.sms_relationship_profile).slice(0, 240)
              : null,
        },
        commitment: {
          id: active.id,
          title: active.title,
          behavior_statement: active.behavior_statement,
          effective_ask: effectiveAskPr,
          accountability_phase: active.accountability_phase,
          identity_anchor_allowed: false,
          identity_anchor_short: null,
        },
        thread_memory: assembleDailyThreadMemoryFromRelationshipPacket(relationshipMemoryPacketPr, {
          convLatestOutbound: prConvPack?.lastOutboundPreview ?? null,
          convLatestInbound: prConvPack?.lastInboundPreview ?? null,
          recentTranscriptOrContextBlock: prCtxBlock,
          coachingMemorySnippet: buildCoachingMemorySnippetForDailyLane(coachingMemoryPr),
          extraDoNotRepeatHints: deriveDoNotRepeatHintsFromCoachingMemory(coachingMemoryPr),
          recentPatternHints: patternHintsPr.length > 0 ? patternHintsPr.slice(0, 480) : null,
        }),
        accountability: {
          daily_purpose: "fallback_standard",
          server_strategy: "standard_check",
          next_move_type: "hold_standard",
          prior_outcome: latestOutcome?.type ?? null,
          yes_streak_14d: coachingMemoryPr?.yes_streak_14d ?? null,
          no_count_14d: coachingMemoryPr?.no_count_14d ?? null,
          partial_count_14d: coachingMemoryPr?.partial_count_14d ?? null,
          blocker_preview: null,
          proof_or_milestone_signal: null,
          silence_tier: "none",
          unanswered_checks: 0,
          days_since_last_user_outcome: 0,
          reentry_active: false,
          overlay_active: isV2AdaptiveOverlayActive(active, now.getTime()),
          evolution_pattern_hint: null,
          contract_proposal_mode: false,
        },
        pending_resolution: {
          resolution_kind: pr?.kind ?? null,
          expires_at: pr?.expiresAt ?? null,
          payload_source: payloadSourcePr,
          sms_state: smsStatePr,
          detected_intent: detectedIntentPr,
          candidate_behavior_snippet: candidateSnippetPr,
          awaiting_user_confirmation: awaitingConfirmationPr,
        },
        ...(victoryBackgroundFacts ? { victory_background: victoryBackgroundFacts } : {}),
      };
      const suggestedPr = deriveSuggestedCoachingMoveForDailyFacts(factsCorePr);
      const factsPr: DailyV3RelationshipFacts = {
        ...factsCorePr,
        suggested_coaching_move: suggestedPr,
        constraints: {
          max_chars: 300,
          one_sms: true,
          no_raw_title_or_behavior_paste: true,
          no_generic_motivation: true,
          if_unsafe_return_no_send: true,
          ...(verbatimPr.length ? { required_verbatim_substrings: verbatimPr } : {}),
        },
      };
      const remTemplate = buildPendingResolutionDailyReminderSms(active);
      const lanePr = await produceDailyV3RelationshipSms({
        facts: factsPr,
        telemetry_fact_sources: [
          "getPendingResolutionOrNull",
          "getEffectiveCoachingAsk",
          "loadV2CoachingMemoryForPrompt",
          "buildV2SmsConversationContextPack",
          "buildPendingResolutionDailyReminderSms",
        ],
      });
      if (!lanePr.shouldSend || !lanePr.body.trim()) {
        return {
          ok: false,
          error: "daily_v3_lane_no_send",
          dailyLaneMeta: { ...lanePr.metadata, no_send_reason: lanePr.noSendReason },
        };
      }
      console.info("[daily-sms] pending_resolution_reminder_selected", {
        clerk_user_id: clerkUserId,
        commitment_id: active.id,
      });
      return {
        ok: true,
        smsBody: lanePr.body,
        deliveryStateSnapshot: null,
        day2SpecialUsed: false,
        v2Accountability: true,
        v2CommitmentId: active.id,
        v2TemplateId: remTemplate.templateId,
        v2TemplateFamily: "standard",
        v2PriorOutcome: latestOutcome?.type ?? null,
        v2BlockerPreview: null,
        v2AiPayload: {
          ...buildCheckSentAiPayload({
            model: V2_OUTBOUND_AI_MODEL,
            promptVersion: V2_OUTBOUND_AI_PROMPT_VERSION,
            serverState: serverStatePr,
            serverStrategy: "standard_check",
            message: lanePr.body,
            confidence: lanePr.voiceConfidence,
            fallbackUsed: false,
          }),
          reply_source: "v3_daily_relationship_lane",
          v3_brain: {
            v3_brain_version: V3_BRAIN_VERSION,
            v3_coach_reply_source: "v3_daily_relationship_lane",
            v3_memory_used: true,
            v3_daily_purpose: "fallback_standard",
            v3_contract_proposal_mode: false,
            v3_evolution_pattern_day: false,
            v3_deterministic_fallback_used: false,
            daily_v3_lane_used: true,
            v3_lane_reply_source: "v3_daily_relationship_lane",
            v3_lane_turn_purpose: lanePr.turnPurpose,
            v3_candidate_body: (lanePr.metadata.v3_candidate_body as string | undefined) ?? lanePr.body,
            old_daily_writer_used_as_voice: false,
            old_daily_writer_fact_sources: lanePr.metadata.old_daily_writer_fact_sources,
            daily_facts_summary: lanePr.metadata.daily_facts_summary,
            suggested_coaching_move: lanePr.metadata.suggested_coaching_move,
            route_purpose: "pending_resolution",
            voice_writer_chain: ["v3_daily_relationship_lane", "north_star_validator", "final_voice_gate"],
          },
        },
        v2SilencePayload: null,
        v2ReentryPayload: null,
        v2NextMovePayload: null,
        v2CadencePayload: null,
        v2ContractProposalMode: false,
        v2ContractProposalKind: null,
        v2ProposalBindingText: null,
        v2ContractProposalPayload: null,
        v2IdentityAnchorText: null,
        v2RefreshOutboundPlan: null,
        v2PendingResolutionReminder: true,
        v2EffectiveAskText: effectiveAskPr,
        v3DailySms: true,
        v3DailyDeterministicFallback: false,
        v3DailyRelationshipLane: true,
      };
    }

    const { data: refreshProfileRow } = await supabaseServer
      .from("user_profiles")
      .select(
        "identity_anchor_text, identity_refresh_due_at, identity_refresh_last_prompted_at, identity_source"
      )
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();

    const identityAnchorForRefresh =
      typeof refreshProfileRow?.identity_anchor_text === "string"
        ? refreshProfileRow.identity_anchor_text.trim()
        : "";
    const identitySourceForRefresh =
      typeof refreshProfileRow?.identity_source === "string"
        ? refreshProfileRow.identity_source.trim()
        : null;

    if (active.accountability_phase === "active_accountability") {
      const identityDueAt =
        typeof refreshProfileRow?.identity_refresh_due_at === "string"
          ? refreshProfileRow.identity_refresh_due_at
          : null;
      const identityLastPrompted =
        typeof refreshProfileRow?.identity_refresh_last_prompted_at === "string"
          ? refreshProfileRow.identity_refresh_last_prompted_at
          : null;

      const wave1Cold = computeWave1ColdStartRefreshEligible({
        nowMs: now.getTime(),
        commitment: active,
        identityAnchorText: identityAnchorForRefresh,
        identitySource: identitySourceForRefresh,
        identityRefreshDueAt: identityDueAt,
        identityRefreshLastPromptedAt: identityLastPrompted,
        commitmentRefreshLastPromptedAt: active.commitment_refresh_last_prompted_at,
      });

      if (!wave1Cold.ok) {
        const lastCommitMs = parseIsoMs(active.commitment_refresh_last_prompted_at ?? null);
        const commitmentDue =
          lastCommitMs != null &&
          now.getTime() - lastCommitMs >= V2_IDENTITY_REFRESH_INTERVAL_MS;
        const identityDue = isIdentityRefreshDue(identityDueAt, now.getTime());
        if (commitmentDue && !identityDue && !refreshSessionParsed) {
          console.info("[daily-sms] v2_refresh_wave1_suppressed", {
            reason: "identity_not_due_commitment_only",
            clerk_user_id: clerkUserId,
            commitment_id: active.id,
          });
        }
        if (wave1Cold.reason === "below_maturity") {
          console.info("[daily-sms] v2_refresh_wave1_suppressed", {
            reason: "below_maturity",
            clerk_user_id: clerkUserId,
            commitment_id: active.id,
          });
        }
        if (wave1Cold.reason === "anchor_not_quotable") {
          console.info("[daily-sms] v2_refresh_wave1_suppressed", {
            reason: "anchor_not_quotable",
            clerk_user_id: clerkUserId,
            commitment_id: active.id,
          });
        }
        if (wave1Cold.reason === "identity_not_due") {
          console.info("[daily-sms] v2_refresh_wave1_suppressed", {
            reason: "identity_not_due",
            clerk_user_id: clerkUserId,
            commitment_id: active.id,
          });
        }
      }

      if (!refreshSessionParsed && wave1Cold.ok) {
        const newSession = newRefreshSessionIdentityStep(now.toISOString());
        const refreshTid = buildRefreshStepIdentitySms({
          identityAnchorText: identityAnchorForRefresh,
        }).templateId;

        const serverStateR = deriveV2CoachingState(recentEvents);
        const silenceCtxR = deriveV2SilenceContext(recentEvents, now);
        const reentryCtxR = deriveV2ReentryContext(recentEvents, now);
        const blockerPreviewR = await resolveV2BlockerPreviewForOutbound({
          commitmentId: active.id,
          latestOutcome,
          recentEvents,
        });
        const hasBpR = Boolean(blockerPreviewR && blockerPreviewR.trim().length > 0);
        const nextMoveR = deriveV2NextMove({
          eventsNewestFirst: recentEvents,
          now,
          silence: silenceCtxR,
          reentry: reentryCtxR,
          behaviorStatement: active.behavior_statement,
        });
        const cadencePayloadR = deriveV2CadencePayload({
          eventsNewestFirst: recentEvents,
          now,
          hasBlockerPreview: hasBpR,
        });
        const baseStrR = pickV2OutboundStrategy(serverStateR, hasBpR);
        const stratR = resolveV2OutboundStrategyAfterBase({
          baseStrategy: baseStrR,
          silence: silenceCtxR,
          reentry: reentryCtxR,
        });

        const effectiveAskRf = getEffectiveCoachingAsk(active, now.getTime());
        const { data: idProf } = await supabaseServer
          .from("user_profiles")
          .select("preferred_name")
          .eq("clerk_user_id", clerkUserId)
          .maybeSingle();
        const preferredNameRf =
          typeof idProf?.preferred_name === "string" ? idProf.preferred_name : null;
        const coachingMemoryRf = await loadV2CoachingMemoryForPrompt(active.id);
        let idConv: V2SmsConversationContextPack | null = null;
        let idCtx: string | null = null;
        try {
          idConv = await buildV2SmsConversationContextPack({
            clerkUserId,
            commitmentId: active.id,
            commitment: active,
            timezone,
            preloadedCoachingMemory: coachingMemoryRf,
            preloadedEventsNewestFirst: recentEvents,
          });
          idCtx = idConv.promptBlock;
        } catch (e) {
          console.warn("[daily-sms] refresh_identity_context_pack_failed", {
            commitment_id: active.id,
            message: e instanceof Error ? e.message : String(e),
          });
        }
        const anchorTrim = identityAnchorForRefresh.trim();
        const verbatimRf = anchorTrim.length > 0 ? [anchorTrim] : [];
        const patternHintsRf = [
          idConv?.proofHighlight,
          idConv?.comebackSignal,
          idConv?.recentBlockerPattern,
        ]
          .filter((x): x is string => Boolean(x && typeof x === "string"))
          .join(" | ");

        const relationshipMemoryPacketRf = await buildSmsRelationshipMemoryPacket({
          clerkUserId,
          commitmentId: active.id,
        });

        const factsCoreRf: DailyV3RelationshipFactsForMove = {
          route_kind: "refresh_identity",
          accountability_day_key: accountabilityDayKey,
          user: {
            clerk_user_id: clerkUserId,
            preferred_name: preferredNameRf,
            timezone,
            local_time_iso: new Date(now.toLocaleString("en-US", { timeZone: timezone })).toISOString(),
            relationship_profile_summary:
              coachingMemoryRf?.sms_relationship_profile != null
                ? JSON.stringify(coachingMemoryRf.sms_relationship_profile).slice(0, 240)
                : null,
          },
          commitment: {
            id: active.id,
            title: active.title,
            behavior_statement: active.behavior_statement,
            effective_ask: effectiveAskRf,
            accountability_phase: active.accountability_phase,
            identity_anchor_allowed: isQuotableIdentitySource(identitySourceForRefresh),
            identity_anchor_short: anchorTrim ? anchorTrim.slice(0, 100) : null,
          },
          thread_memory: assembleDailyThreadMemoryFromRelationshipPacket(relationshipMemoryPacketRf, {
            convLatestOutbound: idConv?.lastOutboundPreview ?? null,
            convLatestInbound: idConv?.lastInboundPreview ?? null,
            recentTranscriptOrContextBlock: idCtx,
            coachingMemorySnippet: buildCoachingMemorySnippetForDailyLane(coachingMemoryRf),
            extraDoNotRepeatHints: deriveDoNotRepeatHintsFromCoachingMemory(coachingMemoryRf),
            recentPatternHints: patternHintsRf.length > 0 ? patternHintsRf.slice(0, 480) : null,
          }),
          accountability: {
            daily_purpose: "fallback_standard",
            server_strategy: stratR,
            next_move_type: nextMoveR.type,
            prior_outcome: latestOutcome?.type ?? null,
            yes_streak_14d: coachingMemoryRf?.yes_streak_14d ?? null,
            no_count_14d: coachingMemoryRf?.no_count_14d ?? null,
            partial_count_14d: coachingMemoryRf?.partial_count_14d ?? null,
            blocker_preview: blockerPreviewR,
            proof_or_milestone_signal: null,
            silence_tier: silenceCtxR.tier,
            unanswered_checks: silenceCtxR.unanswered_checks,
            days_since_last_user_outcome: silenceCtxR.days_since_last_user_outcome,
            reentry_active: reentryCtxR.active,
            overlay_active: isV2AdaptiveOverlayActive(active, now.getTime()),
            evolution_pattern_hint: null,
            contract_proposal_mode: false,
          },
          refresh: {
            refresh_step: "identity_first",
            identity_anchor_text: anchorTrim || null,
          },
          ...(victoryBackgroundFacts ? { victory_background: victoryBackgroundFacts } : {}),
        };
        const suggestedRf = deriveSuggestedCoachingMoveForDailyFacts(factsCoreRf);
        const factsRf: DailyV3RelationshipFacts = {
          ...factsCoreRf,
          suggested_coaching_move: suggestedRf,
          constraints: {
            max_chars: 300,
            one_sms: true,
            no_raw_title_or_behavior_paste: true,
            no_generic_motivation: true,
            if_unsafe_return_no_send: true,
            ...(verbatimRf.length ? { required_verbatim_substrings: verbatimRf } : {}),
          },
        };
        const laneRf = await produceDailyV3RelationshipSms({
          facts: factsRf,
          telemetry_fact_sources: [
            "computeWave1ColdStartRefreshEligible",
            "buildRefreshStepIdentitySms",
            "loadV2CoachingMemoryForPrompt",
            "buildV2SmsConversationContextPack",
            "deriveV2CoachingState",
            "deriveV2SilenceContext",
            "deriveV2ReentryContext",
          ],
        });
        if (!laneRf.shouldSend || !laneRf.body.trim()) {
          return {
            ok: false,
            error: "daily_v3_lane_no_send",
            dailyLaneMeta: { ...laneRf.metadata, no_send_reason: laneRf.noSendReason },
          };
        }

        return {
          ok: true,
          smsBody: laneRf.body,
          deliveryStateSnapshot: null,
          day2SpecialUsed: false,
          v2Accountability: true,
          v2CommitmentId: active.id,
          v2TemplateId: refreshTid,
          v2TemplateFamily: templateFamilyForStrategy(stratR),
          v2PriorOutcome: latestOutcome?.type ?? null,
          v2BlockerPreview: blockerPreviewR,
          v2AiPayload: {
            ...buildCheckSentAiPayload({
              model: V2_OUTBOUND_AI_MODEL,
              promptVersion: V2_OUTBOUND_AI_PROMPT_VERSION,
              serverState: serverStateR,
              serverStrategy: stratR,
              message: laneRf.body,
              confidence: laneRf.voiceConfidence,
              fallbackUsed: false,
            }),
            reply_source: "v3_daily_relationship_lane",
            v3_brain: {
              v3_brain_version: V3_BRAIN_VERSION,
              v3_coach_reply_source: "v3_daily_relationship_lane",
              v3_memory_used: true,
              v3_daily_purpose: "fallback_standard",
              v3_contract_proposal_mode: false,
              v3_evolution_pattern_day: false,
              v3_deterministic_fallback_used: false,
              daily_v3_lane_used: true,
              v3_lane_reply_source: "v3_daily_relationship_lane",
              v3_lane_turn_purpose: laneRf.turnPurpose,
              v3_candidate_body: (laneRf.metadata.v3_candidate_body as string | undefined) ?? laneRf.body,
              old_daily_writer_used_as_voice: false,
              old_daily_writer_fact_sources: laneRf.metadata.old_daily_writer_fact_sources,
              daily_facts_summary: laneRf.metadata.daily_facts_summary,
              suggested_coaching_move: laneRf.metadata.suggested_coaching_move,
              route_purpose: "refresh_identity",
              voice_writer_chain: ["v3_daily_relationship_lane", "north_star_validator", "final_voice_gate"],
            },
          },
          v2SilencePayload: {
            tier: silenceCtxR.tier,
            unanswered_checks: silenceCtxR.unanswered_checks,
            days_since_last_user_outcome: silenceCtxR.days_since_last_user_outcome,
          },
          v2ReentryPayload: { active: reentryCtxR.active },
          v2NextMovePayload: {
            type: nextMoveR.type,
            reason_code: nextMoveR.reason_code,
            version: nextMoveR.version,
            ...(nextMoveR.type === "shrink_ask" && nextMoveR.shrunk_ask_text
              ? { shrunk_ask_text: nextMoveR.shrunk_ask_text }
              : {}),
          },
          v2CadencePayload: cadencePayloadR,
          v2ContractProposalMode: false,
          v2ContractProposalKind: null,
          v2ProposalBindingText: null,
          v2ContractProposalPayload: null,
          v2IdentityAnchorText: identityAnchorForRefresh,
          v2RefreshOutboundPlan: { kind: "identity_first", session: newSession },
          v2EffectiveAskText: effectiveAskRf,
          v3DailySms: true,
          v3DailyDeterministicFallback: false,
          v3DailyRelationshipLane: true,
        };
      }

      if (
        refreshSessionParsed?.step === "commitment" &&
        !refreshSessionParsed.commitment_prompt_delivered
      ) {
        const effectiveAskR = getEffectiveCoachingAsk(active, now.getTime());
        const refreshCommitTid = buildRefreshStepCommitmentSms({ effectiveAsk: effectiveAskR }).templateId;

        const serverStateC = deriveV2CoachingState(recentEvents);
        const silenceCtxC = deriveV2SilenceContext(recentEvents, now);
        const reentryCtxC = deriveV2ReentryContext(recentEvents, now);
        const blockerPreviewC = await resolveV2BlockerPreviewForOutbound({
          commitmentId: active.id,
          latestOutcome,
          recentEvents,
        });
        const hasBpC = Boolean(blockerPreviewC && blockerPreviewC.trim().length > 0);
        const nextMoveC = deriveV2NextMove({
          eventsNewestFirst: recentEvents,
          now,
          silence: silenceCtxC,
          reentry: reentryCtxC,
          behaviorStatement: active.behavior_statement,
        });
        const cadencePayloadC = deriveV2CadencePayload({
          eventsNewestFirst: recentEvents,
          now,
          hasBlockerPreview: hasBpC,
        });
        const baseStrC = pickV2OutboundStrategy(serverStateC, hasBpC);
        const stratC = resolveV2OutboundStrategyAfterBase({
          baseStrategy: baseStrC,
          silence: silenceCtxC,
          reentry: reentryCtxC,
        });

        const planSession = {
          ...refreshSessionParsed,
          commitment_prompt_delivered: true,
        };

        const askTrim = effectiveAskR.trim();
        const verbatimC = askTrim.length > 0 ? [askTrim] : [];
        const { data: cmtProf } = await supabaseServer
          .from("user_profiles")
          .select("preferred_name")
          .eq("clerk_user_id", clerkUserId)
          .maybeSingle();
        const preferredNameC =
          typeof cmtProf?.preferred_name === "string" ? cmtProf.preferred_name : null;
        const coachingMemoryC = await loadV2CoachingMemoryForPrompt(active.id);
        let cConv: V2SmsConversationContextPack | null = null;
        let cCtx: string | null = null;
        try {
          cConv = await buildV2SmsConversationContextPack({
            clerkUserId,
            commitmentId: active.id,
            commitment: active,
            timezone,
            preloadedCoachingMemory: coachingMemoryC,
            preloadedEventsNewestFirst: recentEvents,
          });
          cCtx = cConv.promptBlock;
        } catch (e) {
          console.warn("[daily-sms] refresh_commitment_context_pack_failed", {
            commitment_id: active.id,
            message: e instanceof Error ? e.message : String(e),
          });
        }
        const patternHintsC = [
          cConv?.proofHighlight,
          cConv?.comebackSignal,
          cConv?.recentBlockerPattern,
        ]
          .filter((x): x is string => Boolean(x && typeof x === "string"))
          .join(" | ");

        const relationshipMemoryPacketC = await buildSmsRelationshipMemoryPacket({
          clerkUserId,
          commitmentId: active.id,
        });

        const factsCoreC: DailyV3RelationshipFactsForMove = {
          route_kind: "refresh_commitment",
          accountability_day_key: accountabilityDayKey,
          user: {
            clerk_user_id: clerkUserId,
            preferred_name: preferredNameC,
            timezone,
            local_time_iso: new Date(now.toLocaleString("en-US", { timeZone: timezone })).toISOString(),
            relationship_profile_summary:
              coachingMemoryC?.sms_relationship_profile != null
                ? JSON.stringify(coachingMemoryC.sms_relationship_profile).slice(0, 240)
                : null,
          },
          commitment: {
            id: active.id,
            title: active.title,
            behavior_statement: active.behavior_statement,
            effective_ask: askTrim,
            accountability_phase: active.accountability_phase,
            identity_anchor_allowed: false,
            identity_anchor_short: null,
          },
          thread_memory: assembleDailyThreadMemoryFromRelationshipPacket(relationshipMemoryPacketC, {
            convLatestOutbound: cConv?.lastOutboundPreview ?? null,
            convLatestInbound: cConv?.lastInboundPreview ?? null,
            recentTranscriptOrContextBlock: cCtx,
            coachingMemorySnippet: buildCoachingMemorySnippetForDailyLane(coachingMemoryC),
            extraDoNotRepeatHints: deriveDoNotRepeatHintsFromCoachingMemory(coachingMemoryC),
            recentPatternHints: patternHintsC.length > 0 ? patternHintsC.slice(0, 480) : null,
          }),
          accountability: {
            daily_purpose: "fallback_standard",
            server_strategy: stratC,
            next_move_type: nextMoveC.type,
            prior_outcome: latestOutcome?.type ?? null,
            yes_streak_14d: coachingMemoryC?.yes_streak_14d ?? null,
            no_count_14d: coachingMemoryC?.no_count_14d ?? null,
            partial_count_14d: coachingMemoryC?.partial_count_14d ?? null,
            blocker_preview: blockerPreviewC,
            proof_or_milestone_signal: null,
            silence_tier: silenceCtxC.tier,
            unanswered_checks: silenceCtxC.unanswered_checks,
            days_since_last_user_outcome: silenceCtxC.days_since_last_user_outcome,
            reentry_active: reentryCtxC.active,
            overlay_active: isV2AdaptiveOverlayActive(active, now.getTime()),
            evolution_pattern_hint: null,
            contract_proposal_mode: false,
          },
          refresh: {
            refresh_step: "commitment_daily",
            effective_ask_for_bar: askTrim || null,
          },
          ...(victoryBackgroundFacts ? { victory_background: victoryBackgroundFacts } : {}),
        };
        const suggestedC = deriveSuggestedCoachingMoveForDailyFacts(factsCoreC);
        const factsC: DailyV3RelationshipFacts = {
          ...factsCoreC,
          suggested_coaching_move: suggestedC,
          constraints: {
            max_chars: 300,
            one_sms: true,
            no_raw_title_or_behavior_paste: true,
            no_generic_motivation: true,
            if_unsafe_return_no_send: true,
            ...(verbatimC.length ? { required_verbatim_substrings: verbatimC } : {}),
          },
        };
        const laneC = await produceDailyV3RelationshipSms({
          facts: factsC,
          telemetry_fact_sources: [
            "buildRefreshStepCommitmentSms",
            "getEffectiveCoachingAsk",
            "loadV2CoachingMemoryForPrompt",
            "buildV2SmsConversationContextPack",
            "deriveV2CoachingState",
            "deriveV2SilenceContext",
            "deriveV2ReentryContext",
          ],
        });
        if (!laneC.shouldSend || !laneC.body.trim()) {
          return {
            ok: false,
            error: "daily_v3_lane_no_send",
            dailyLaneMeta: { ...laneC.metadata, no_send_reason: laneC.noSendReason },
          };
        }

        return {
          ok: true,
          smsBody: laneC.body,
          deliveryStateSnapshot: null,
          day2SpecialUsed: false,
          v2Accountability: true,
          v2CommitmentId: active.id,
          v2TemplateId: refreshCommitTid,
          v2TemplateFamily: templateFamilyForStrategy(stratC),
          v2PriorOutcome: latestOutcome?.type ?? null,
          v2BlockerPreview: blockerPreviewC,
          v2AiPayload: {
            ...buildCheckSentAiPayload({
              model: V2_OUTBOUND_AI_MODEL,
              promptVersion: V2_OUTBOUND_AI_PROMPT_VERSION,
              serverState: serverStateC,
              serverStrategy: stratC,
              message: laneC.body,
              confidence: laneC.voiceConfidence,
              fallbackUsed: false,
            }),
            reply_source: "v3_daily_relationship_lane",
            v3_brain: {
              v3_brain_version: V3_BRAIN_VERSION,
              v3_coach_reply_source: "v3_daily_relationship_lane",
              v3_memory_used: true,
              v3_daily_purpose: "fallback_standard",
              v3_contract_proposal_mode: false,
              v3_evolution_pattern_day: false,
              v3_deterministic_fallback_used: false,
              daily_v3_lane_used: true,
              v3_lane_reply_source: "v3_daily_relationship_lane",
              v3_lane_turn_purpose: laneC.turnPurpose,
              v3_candidate_body: (laneC.metadata.v3_candidate_body as string | undefined) ?? laneC.body,
              old_daily_writer_used_as_voice: false,
              old_daily_writer_fact_sources: laneC.metadata.old_daily_writer_fact_sources,
              daily_facts_summary: laneC.metadata.daily_facts_summary,
              suggested_coaching_move: laneC.metadata.suggested_coaching_move,
              route_purpose: "refresh_commitment",
              voice_writer_chain: ["v3_daily_relationship_lane", "north_star_validator", "final_voice_gate"],
            },
          },
          v2SilencePayload: {
            tier: silenceCtxC.tier,
            unanswered_checks: silenceCtxC.unanswered_checks,
            days_since_last_user_outcome: silenceCtxC.days_since_last_user_outcome,
          },
          v2ReentryPayload: { active: reentryCtxC.active },
          v2NextMovePayload: {
            type: nextMoveC.type,
            reason_code: nextMoveC.reason_code,
            version: nextMoveC.version,
            ...(nextMoveC.type === "shrink_ask" && nextMoveC.shrunk_ask_text
              ? { shrunk_ask_text: nextMoveC.shrunk_ask_text }
              : {}),
          },
          v2CadencePayload: cadencePayloadC,
          v2ContractProposalMode: false,
          v2ContractProposalKind: null,
          v2ProposalBindingText: null,
          v2ContractProposalPayload: null,
          v2IdentityAnchorText: null,
          v2RefreshOutboundPlan: { kind: "commitment_daily", session: planSession },
          v2EffectiveAskText: effectiveAskR,
          v3DailySms: true,
          v3DailyDeterministicFallback: false,
          v3DailyRelationshipLane: true,
        };
      }
    }

    const coachingMemoryRow = await loadV2CoachingMemoryForPrompt(active.id);

    const serverState = deriveV2CoachingState(recentEvents);
    const silenceCtx = deriveV2SilenceContext(recentEvents, now);
    const reentryCtx = deriveV2ReentryContext(recentEvents, now);
    const nextMove = deriveV2NextMove({
      eventsNewestFirst: recentEvents,
      now,
      silence: silenceCtx,
      reentry: reentryCtx,
      behaviorStatement: active.behavior_statement,
    });

    const blockerPreview = await resolveV2BlockerPreviewForOutbound({
      commitmentId: active.id,
      latestOutcome,
      recentEvents,
    });

    const hasBlockerPreview = Boolean(blockerPreview && blockerPreview.trim().length > 0);
    const cadencePayload = deriveV2CadencePayload({
      eventsNewestFirst: recentEvents,
      now,
      hasBlockerPreview,
    });
    const baseStrategy = pickV2OutboundStrategy(serverState, hasBlockerPreview);
    const plannedInterruptionRow = await loadRecentPlannedInterruptionSignalForCommitment({
      commitmentId: active.id,
      clerkUserId,
      now,
    });
    const plannedInterruptionActive = plannedInterruptionRow != null;
    const plannedReasonCategory =
      typeof plannedInterruptionRow?.memorySignal.reason_category === "string"
        ? plannedInterruptionRow.memorySignal.reason_category
        : null;
    const plannedResumeHint =
      typeof plannedInterruptionRow?.memorySignal.resume_hint === "string"
        ? plannedInterruptionRow.memorySignal.resume_hint
        : null;

    let serverStrategy = resolveV2OutboundStrategyAfterBase({
      baseStrategy,
      silence: silenceCtx,
      reentry: reentryCtx,
    });
    if (plannedInterruptionActive) {
      serverStrategy = dailyServerStrategyDuringPlannedInterruption(
        serverStrategy
      ) as typeof serverStrategy;
    }
    const templateFamily = templateFamilyForStrategy(serverStrategy);

    const effectiveAsk = getEffectiveCoachingAsk(active, now.getTime());
    const refreshSessionActive = isRefreshSessionActive(active);
    const overlayActiveForGate = isV2AdaptiveOverlayActive(active, now.getTime());
    const proposalPendingForGate = isV2PendingProposalValid(active, now.getTime());
    const pendingResolutionForGate = getPendingResolutionOrNull(active);
    const patternSignal = deriveSmsPatternSignal({
      eventsNewestFirst: recentEvents,
      coachingMemory: coachingMemoryRow,
      patRead: victoryBackgroundFacts?.pat_read_pattern
        ? {
            pattern_text: victoryBackgroundFacts.pat_read_pattern,
            pattern_confidence: null,
          }
        : null,
      nowMs: now.getTime(),
    });
    const evolutionEvaluationForGate = evaluateCommitmentEvolutionForSms({
      commitment: active,
      eventsNewestFirst: recentEvents,
      nowMs: now.getTime(),
    });
    let goalAdjustmentSignal: SmsGoalAdjustmentSignalResult = deriveSmsGoalAdjustmentSignal({
      eventsNewestFirst: recentEvents,
      coachingMemory: coachingMemoryRow,
      patternSignal,
      overlayState: {
        proposalPending: proposalPendingForGate,
        overlayActive: overlayActiveForGate,
        effectiveAskDiffers: effectiveAsk.trim() !== active.behavior_statement.trim(),
        shrinkMeaningful:
          nextMove.type === "shrink_ask" ? Boolean(nextMove.shrunk_ask_text?.trim()) : true,
      },
      pendingResolution: pendingResolutionForGate
        ? {
            kind: pendingResolutionForGate.kind,
            sms_state:
              pendingResolutionForGate.payload?.source === "sms_inbound"
                ? (pendingResolutionForGate.payload.sms_state ?? null)
                : null,
          }
        : null,
      evolutionEval: { recommended_action: evolutionEvaluationForGate.recommended_action },
      silenceContext: {
        isReentry: reentryCtx.active,
        silenceDays: silenceCtx.days_since_last_user_outcome,
        phase: active.accountability_phase,
      },
      nowMs: now.getTime(),
    });
    if (plannedInterruptionActive) {
      goalAdjustmentSignal = {
        move: "pause_cadence",
        confidence: "high",
        mentionAllowed: true,
        internalHint: "planned_interruption_active: do not score silence as failure",
        requiresUserConfirmation: true,
        compatibleFlow: "none",
        doNotRepeatKey: "goal_adjustment_pause_cadence_prompt",
      };
    }
    const shrinkProposalMode =
      nextMove.type === "shrink_ask" &&
      !overlayActiveForGate &&
      !proposalPendingForGate &&
      !refreshSessionActive &&
      smsGoalAdjustmentShrinkOverlayEligible(goalAdjustmentSignal);

    const recommitProposalMode =
      nextMove.type === "recommit_same" &&
      !isV2AdaptiveOverlayActive(active, now.getTime()) &&
      !isV2PendingProposalValid(active, now.getTime()) &&
      !refreshSessionActive;

    const contractProposalMode = shrinkProposalMode || recommitProposalMode;
    const contractProposalKind: V2AdaptiveContractKind | null = shrinkProposalMode
      ? "shrink_ask"
      : recommitProposalMode
        ? "recommit_same"
        : null;

    const canonicalDailyProposalAsk: string | null =
      contractProposalMode && contractProposalKind === "shrink_ask"
        ? (computeCanonicalShrinkProposalAskFromBehavior(active.behavior_statement) ??
            active.behavior_statement.trim()).trim()
        : contractProposalMode && contractProposalKind === "recommit_same"
          ? active.behavior_statement.trim()
          : null;

    const outboundNextMove: V2NextMoveKind =
      (nextMove.type === "shrink_ask" && !shrinkProposalMode) ||
      (nextMove.type === "recommit_same" && !recommitProposalMode)
        ? "hold_standard"
        : nextMove.type;

    let templateId: number;
    if (contractProposalMode && canonicalDailyProposalAsk && contractProposalKind === "shrink_ask") {
      const pack = await buildV2ShrinkProposalOutboundSms({
        clerkUserId,
        dayKey: accountabilityDayKey,
        proposalBindingText: canonicalDailyProposalAsk,
        originalBehaviorStatement: active.behavior_statement,
        v3Refine: { commitment: active, timezone },
      });
      if (pack.adaptiveProposalVoiceWithheld) {
        return {
          ok: false,
          error: "adaptive_proposal_finalizer_no_safe_voice",
          adaptiveProposalWithheldMeta: pack.adaptiveProposalOutboundMeta,
        };
      }
      templateId = pack.templateId;
    } else if (contractProposalMode && canonicalDailyProposalAsk && contractProposalKind === "recommit_same") {
      const pack = await buildV2RecommitProposalOutboundSms({
        clerkUserId,
        dayKey: accountabilityDayKey,
        proposalBindingText: canonicalDailyProposalAsk,
        originalBehaviorStatement: active.behavior_statement,
        v3Refine: { commitment: active, timezone },
      });
      if (pack.adaptiveProposalVoiceWithheld) {
        return {
          ok: false,
          error: "adaptive_proposal_finalizer_no_safe_voice",
          adaptiveProposalWithheldMeta: pack.adaptiveProposalOutboundMeta,
        };
      }
      templateId = pack.templateId;
    } else {
      const strat = buildV2OutboundAccountabilitySmsForStrategy({
        clerkUserId,
        dayKey: accountabilityDayKey,
        behaviorStatement: effectiveAsk,
        serverStrategy,
        nextMove: outboundNextMove,
        shrunkAskText:
          outboundNextMove === "shrink_ask" ? (nextMove.shrunk_ask_text ?? null) : null,
      });
      templateId = strat.templateId;
    }

    const { data: profileRow } = await supabaseServer
      .from("user_profiles")
      .select(
        "preferred_name, people_summary, responsibility, identity_anchor_text, identity_source, identity_refresh_due_at, identity_last_referenced_at"
      )
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();

    const preferredName =
      typeof profileRow?.preferred_name === "string" ? profileRow.preferred_name : null;
    const peopleSummary =
      typeof profileRow?.people_summary === "string" && profileRow.people_summary.trim()
        ? profileRow.people_summary.trim()
        : null;
    const responsibility =
      typeof profileRow?.responsibility === "string" && profileRow.responsibility.trim()
        ? profileRow.responsibility.trim()
        : null;
    const identityAnchorText =
      typeof profileRow?.identity_anchor_text === "string"
        ? profileRow.identity_anchor_text.trim()
        : null;
    const identityRefreshDue = isIdentityRefreshDue(
      typeof profileRow?.identity_refresh_due_at === "string"
        ? profileRow.identity_refresh_due_at
        : null,
      now.getTime()
    );
    const profileIdentitySource =
      typeof profileRow?.identity_source === "string" ? profileRow.identity_source : null;
    const identityReferenceAllowed = computeIdentityReferenceAllowed({
      nowMs: now.getTime(),
      identityAnchorText: profileRow?.identity_anchor_text,
      identitySource: profileIdentitySource,
      identityRefreshDueAt:
        typeof profileRow?.identity_refresh_due_at === "string"
          ? profileRow.identity_refresh_due_at
          : null,
      identityLastReferencedAt:
        typeof profileRow?.identity_last_referenced_at === "string"
          ? profileRow.identity_last_referenced_at
          : null,
      accountabilityPhase: active.accountability_phase,
      contractProposalMode,
      refreshSessionActive,
      serverStrategy,
    });

    let recentSmsContextBlock: string | null = null;
    let mainConvPack: V2SmsConversationContextPack | null = null;
    try {
      mainConvPack = await buildV2SmsConversationContextPack({
        clerkUserId,
        commitmentId: active.id,
        commitment: active,
        timezone,
        preloadedCoachingMemory: coachingMemoryRow,
        preloadedEventsNewestFirst: recentEvents,
      });
      recentSmsContextBlock = mainConvPack.promptBlock;
    } catch (e) {
      console.warn("[daily-sms] sms_conversation_context_pack_failed", {
        commitment_id: active.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }

    const overlayActive = isV2AdaptiveOverlayActive(active, now.getTime());

    const pendingEvolutionRec = await fetchPendingEvolutionRecommendation(active.id);
    const evolutionEvaluation = evolutionEvaluationForGate;
    const wave7Pick = pickWave7DailyEvolutionAction({
      commitment: active,
      pendingRow: pendingEvolutionRec,
      evaluation: evolutionEvaluation,
      nowMs: now.getTime(),
    });
    const wave7Surface = shouldSurfaceWave7EvolutionDailyPurpose({
      pick: wave7Pick,
      commitment: active,
      eventsNewestFirst: recentEvents,
      nowMs: now.getTime(),
      reentryActive: reentryCtx.active,
      silenceTier: silenceCtx.tier,
      serverStrategy,
      adaptiveProposalPending: isV2PendingProposalValid(active, now.getTime()),
      pendingRow: pendingEvolutionRec,
    });

    const dailyPurpose = deriveV2DailyMessagePurpose({
      contractProposalMode,
      serverStrategy,
      reentry: reentryCtx,
      silence: silenceCtx,
      serverState,
      overlayActive,
      hasBlockerPreview,
      eventsNewestFirst: recentEvents,
      coachingMemory: coachingMemoryRow,
      commitmentStartedAt: active.started_at,
      nowMs: now.getTime(),
      wave7SurfaceEvolution: wave7Surface,
      patternRecurrenceEligible: smsPatternRecurrenceEligibleForDailyPurpose(patternSignal),
    });

    const evolutionHint =
      dailyPurpose === "evolution_pattern_check" && wave7Pick
        ? `${wave7Pick.action}:${wave7Pick.evidenceSummary ?? ""}`.slice(0, 280)
        : null;

    const routeKind: DailyV3RouteKind = contractProposalMode ? "contract_prompt" : "main_active_accountability";
    const canonicalProposalAskTrim = typeof canonicalDailyProposalAsk === "string" ? canonicalDailyProposalAsk.trim() : "";
    const requiredVerbatimMain: string[] = [];

    const contractSemanticFacts: DailySemanticContractProposalFactsPacket | null =
      contractProposalMode && contractProposalKind && canonicalProposalAskTrim
        ? {
            proposal_kind: contractProposalKind,
            duration_days: 7,
            base_behavior_statement: active.behavior_statement.trim(),
            proposed_overlay_ask: contractProposalKind === "shrink_ask" ? canonicalProposalAskTrim : null,
            proposed_behavior_preview: canonicalProposalAskTrim,
            desired_response_semantics: "natural_confirmation_or_decline_or_adjustment",
            must_not_claim_goal_updated: true,
            forbidden_phrases: [...DEFAULT_SEMANTIC_DAILY_CONTRACT_FORBIDDEN_PHRASES],
          }
        : null;

    let smsBody: string;
    let v3DailySms: boolean;
    let v3DailyDeterministicFallback: boolean;
    let v3DailyRelationshipLane: boolean;
    let aiPayload: Record<string, unknown>;

    const patternHintParts: string[] = [];
    if (mainConvPack?.proofHighlight?.trim()) patternHintParts.push(mainConvPack.proofHighlight.trim());
    if (mainConvPack?.comebackSignal?.trim()) patternHintParts.push(mainConvPack.comebackSignal.trim());
    if (patternSignal.mentionAllowed && patternSignal.gentleUserLine?.trim()) {
      patternHintParts.push(patternSignal.gentleUserLine.trim());
    }
    const patternHints = patternHintParts.join(" | ");
    const relationshipToneSummary =
      coachingMemoryRow?.sms_relationship_profile != null
        ? JSON.stringify(coachingMemoryRow.sms_relationship_profile).slice(0, 240)
        : null;

    const relationshipMemoryPacketMain = await buildSmsRelationshipMemoryPacket({
      clerkUserId,
      commitmentId: active.id,
    });

    const factsCoreUnified: DailyV3RelationshipFactsForMove = {
      route_kind: routeKind,
      accountability_day_key: accountabilityDayKey,
      user: {
        clerk_user_id: clerkUserId,
        preferred_name: preferredName,
        timezone,
        local_time_iso: new Date(now.toLocaleString("en-US", { timeZone: timezone })).toISOString(),
        relationship_profile_summary: relationshipToneSummary,
      },
      commitment: {
        id: active.id,
        title: active.title,
        behavior_statement: active.behavior_statement,
        effective_ask: effectiveAsk,
        accountability_phase: active.accountability_phase,
        identity_anchor_allowed: identityReferenceAllowed,
        identity_anchor_short: identityAnchorText ? identityAnchorText.slice(0, 100) : null,
      },
      thread_memory: assembleDailyThreadMemoryFromRelationshipPacket(relationshipMemoryPacketMain, {
        convLatestOutbound: mainConvPack?.lastOutboundPreview ?? null,
        convLatestInbound: mainConvPack?.lastInboundPreview ?? null,
        recentTranscriptOrContextBlock: recentSmsContextBlock,
        coachingMemorySnippet: buildCoachingMemorySnippetForDailyLane(coachingMemoryRow),
        extraDoNotRepeatHints: deriveDoNotRepeatHintsFromCoachingMemory(coachingMemoryRow),
        recentPatternHints: patternHints.length > 0 ? patternHints.slice(0, 480) : null,
      }),
      accountability: {
        daily_purpose: dailyPurpose,
        server_strategy: serverStrategy,
        next_move_type: outboundNextMove,
        prior_outcome: latestOutcome?.type ?? null,
        yes_streak_14d: coachingMemoryRow?.yes_streak_14d ?? null,
        no_count_14d: coachingMemoryRow?.no_count_14d ?? null,
        partial_count_14d: coachingMemoryRow?.partial_count_14d ?? null,
        blocker_preview: hasBlockerPreview ? blockerPreview : null,
        proof_or_milestone_signal:
          dailyPurpose === "proof_milestone_light"
            ? `yes_streak_14d=${coachingMemoryRow?.yes_streak_14d ?? 0}`
            : null,
        silence_tier: silenceCtx.tier,
        unanswered_checks: silenceCtx.unanswered_checks,
        days_since_last_user_outcome: silenceCtx.days_since_last_user_outcome,
        reentry_active: reentryCtx.active,
        overlay_active: overlayActive,
        evolution_pattern_hint: evolutionHint,
        contract_proposal_mode: contractProposalMode,
        goal_adjustment_move: goalAdjustmentSignal.move,
        goal_adjustment_confidence: goalAdjustmentSignal.confidence,
        goal_adjustment_mention_allowed: goalAdjustmentSignal.mentionAllowed,
        goal_adjustment_internal_hint: goalAdjustmentSignal.internalHint,
        goal_adjustment_requires_confirmation: goalAdjustmentSignal.requiresUserConfirmation,
        goal_adjustment_compatible_flow: goalAdjustmentSignal.compatibleFlow,
        ...(plannedInterruptionActive
          ? {
              planned_interruption_active: true,
              planned_interruption_reason_category: plannedReasonCategory,
              planned_interruption_resume_hint: plannedResumeHint,
            }
          : {}),
      },
      ...(contractProposalMode && canonicalProposalAskTrim && contractProposalKind && contractSemanticFacts
        ? {
            contract_proposal: {
              contract_kind: contractProposalKind,
              required_reply_semantics: "yes_no_binding_only" as const,
              semantic_daily_contract_v1: true as const,
              daily_contract_semantic_facts: contractSemanticFacts,
            },
          }
        : {}),
      ...(victoryBackgroundFacts ? { victory_background: victoryBackgroundFacts } : {}),
    };
    const suggestedUnified = deriveSuggestedCoachingMoveForDailyFacts(factsCoreUnified);
    const factsUnified: DailyV3RelationshipFacts = {
      ...factsCoreUnified,
      suggested_coaching_move: suggestedUnified,
      constraints: {
        max_chars: 300,
        one_sms: true,
        no_raw_title_or_behavior_paste: true,
        no_generic_motivation: true,
        if_unsafe_return_no_send: true,
        ...(requiredVerbatimMain.length ? { required_verbatim_substrings: requiredVerbatimMain } : {}),
      },
    };
    const telemetryUnified: string[] = [
      "deriveV2CoachingState",
      "deriveV2SilenceContext",
      "deriveV2ReentryContext",
      "deriveV2NextMove",
      "deriveV2CadencePayload",
      "pickV2OutboundStrategy",
      "resolveV2OutboundStrategyAfterBase",
      "getEffectiveCoachingAsk",
      "deriveV2DailyMessagePurpose",
      "getLatestV2AccountabilityOutcome",
      "getRecentV2EventsForAi",
      "loadV2CoachingMemoryForPrompt",
      "buildV2SmsConversationContextPack",
      "computeIdentityReferenceAllowed",
      "evaluateCommitmentEvolutionForSms",
      "pickWave7DailyEvolutionAction",
      "shouldSurfaceWave7EvolutionDailyPurpose",
      "loadSmsVictoryBackgroundContext",
    ];
    if (contractProposalMode && contractProposalKind === "shrink_ask") {
      telemetryUnified.push("buildV2ShrinkProposalOutboundSms");
    } else if (contractProposalMode && contractProposalKind === "recommit_same") {
      telemetryUnified.push("buildV2RecommitProposalOutboundSms");
    } else {
      telemetryUnified.push("buildV2OutboundAccountabilitySmsForStrategy");
    }

    const laneUnified = await produceDailyV3RelationshipSms({
      facts: factsUnified,
      telemetry_fact_sources: telemetryUnified,
    });
    if (!laneUnified.shouldSend || !laneUnified.body.trim()) {
      return {
        ok: false,
        error: "daily_v3_lane_no_send",
        dailyLaneMeta: { ...laneUnified.metadata, no_send_reason: laneUnified.noSendReason },
      };
    }
    smsBody = laneUnified.body;
    v3DailySms = true;
    v3DailyDeterministicFallback = false;
    v3DailyRelationshipLane = true;
    aiPayload = {
      ...buildCheckSentAiPayload({
        model: V2_OUTBOUND_AI_MODEL,
        promptVersion: V2_OUTBOUND_AI_PROMPT_VERSION,
        serverState,
        serverStrategy,
        message: smsBody,
        confidence: laneUnified.voiceConfidence,
        fallbackUsed: false,
      }),
      reply_source: "v3_daily_relationship_lane",
      v3_brain: {
        v3_brain_version: V3_BRAIN_VERSION,
        v3_coach_reply_source: "v3_daily_relationship_lane",
        v3_memory_used: true,
        v3_daily_purpose: dailyPurpose,
        v3_contract_proposal_mode: contractProposalMode,
        v3_evolution_pattern_day: dailyPurpose === "evolution_pattern_check",
        v3_deterministic_fallback_used: false,
        daily_v3_lane_used: true,
        v3_lane_reply_source: "v3_daily_relationship_lane",
        v3_lane_turn_purpose: laneUnified.turnPurpose,
        v3_candidate_body: (laneUnified.metadata.v3_candidate_body as string | undefined) ?? laneUnified.body,
        old_daily_writer_used_as_voice: false,
        old_daily_writer_fact_sources: laneUnified.metadata.old_daily_writer_fact_sources,
        daily_facts_summary: laneUnified.metadata.daily_facts_summary,
        suggested_coaching_move: laneUnified.metadata.suggested_coaching_move,
        route_purpose: routeKind,
        voice_writer_chain: ["v3_daily_relationship_lane", "north_star_validator", "final_voice_gate"],
      },
    };

    const silencePayload = {
      tier: silenceCtx.tier,
      unanswered_checks: silenceCtx.unanswered_checks,
      days_since_last_user_outcome: silenceCtx.days_since_last_user_outcome,
    };
    const reentryPayload = { active: reentryCtx.active };

    const nextMovePayload: Record<string, unknown> = {
      type: nextMove.type,
      reason_code: nextMove.reason_code,
      version: nextMove.version,
    };
    if (nextMove.type === "shrink_ask" && nextMove.shrunk_ask_text) {
      nextMovePayload.shrunk_ask_text = shrinkProposalMode
        ? canonicalProposalAskTrim
        : nextMove.shrunk_ask_text;
    }
    if (contractProposalMode && contractProposalKind) {
      nextMovePayload.contract_proposal_pending = true;
      nextMovePayload.contract_kind = contractProposalKind;
    }

    const proposalExpiresAt = new Date(now.getTime() + V2_ADAPTIVE_PROPOSAL_TTL_MS).toISOString();
    const contractProposalMeta =
      contractProposalMode && canonicalProposalAskTrim && contractProposalKind && contractSemanticFacts
        ? {
            active: true,
            contract_kind: contractProposalKind,
            proposal_text: canonicalProposalAskTrim,
            proposal_semantic_version: DAILY_SEMANTIC_CONTRACT_PROPOSAL_VERSION,
            expected_reply_semantics: "proposal_yes_no" as const,
            duration_days: 7,
            proposal_overlay_ask: contractSemanticFacts.proposed_overlay_ask,
            proposed_behavior_preview: contractSemanticFacts.proposed_behavior_preview,
            proposal_ttl_ms: V2_ADAPTIVE_PROPOSAL_TTL_MS,
            proposal_expires_at: proposalExpiresAt,
            overlay_if_yes_days: 7,
          }
        : null;

    return {
      ok: true,
      smsBody,
      deliveryStateSnapshot: null,
      day2SpecialUsed: false,
      v2Accountability: true,
      v2CommitmentId: active.id,
      v2TemplateId: templateId,
      v2TemplateFamily: templateFamily,
      v2PriorOutcome: latestOutcome?.type ?? null,
      v2BlockerPreview: blockerPreview,
      v2AiPayload: aiPayload,
      v2SilencePayload: silencePayload,
      v2ReentryPayload: reentryPayload,
      v2NextMovePayload: nextMovePayload,
      v2CadencePayload: cadencePayload,
      v2ContractProposalMode: contractProposalMode,
      v2ContractProposalKind: contractProposalKind,
      v2ProposalBindingText: contractProposalMode ? canonicalProposalAskTrim : null,
      v2ContractProposalPayload: contractProposalMeta,
      v2IdentityAnchorText: isQuotableIdentitySource(profileIdentitySource)
        ? identityAnchorText
        : null,
      v2EffectiveAskText: effectiveAsk,
      v3DailySms,
      v3DailyDeterministicFallback,
      v3DailyRelationshipLane,
    };
  }

  console.warn("[daily-sms][v2-only] build_daily_sms_not_fully_on_v2", {
    clerk_user_id: clerkUserId,
    day_key: accountabilityDayKey,
    note: "legacy_daily_sms_removed_pr6",
  });
  return { ok: false, error: "not_fully_on_v2_daily_sms" };
}

/**
 * ======================================================
 * CRON AUTH
 * ======================================================
 * Valid CRON_SECRET required. Accept either:
 * - x-cron-secret: <CRON_SECRET>
 * - Authorization: Bearer <CRON_SECRET> (Vercel scheduled crons)
 */
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

  if (!hasXCronHeader && !hasAuthorizationHeader) {
    if (req.method === "GET") {
      try {
        const url = new URL(req.url);
        if (url.pathname.startsWith("/api/cron/")) {
          const qSecret = url.searchParams.get("cron_secret");
          if (qSecret && timingSafeEqualUtf8(qSecret, CRON_SECRET)) {
            console.log("[daily-sms] allowed via query cron_secret fallback");
            return true;
          }
        }
      } catch {
        // ignore invalid URL
      }
    }
  }

  return false;
}

function logDailySmsCronAuthFailure(req: Request) {
  console.error("[daily-sms] cron auth failed", {
    cronSecretConfigured: Boolean(CRON_SECRET),
    hasXCronSecretHeader: Boolean(req.headers.get("x-cron-secret")),
    hasAuthorizationHeader: Boolean(req.headers.get("authorization")),
  });
}

/**
 * ======================================================
 * PREFERENCE-BASED SEND WINDOW
 * ======================================================
 *
 * Goal:
 * - Each user receives at most ONE SMS per local day.
 * - Send time is based on Clerk public_metadata.smsTimePreference (early_morning/morning=7 local, midday/evening=19 local).
 * - Users are eligible for the entire preferred local hour (not only the first minutes).
 * - Cron runs every 5 minutes and may attempt multiple times within that hour; reservation
 *   (unique clerk_user_id + day_key) ensures only one SMS is sent.
 */
const SEND_HOUR_BY_PREFERENCE = {
  early_morning: 7,
  morning: 7,
  midday: 19,
  evening: 19,
} as const;

const FIRST_14_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const CATCHUP_START_HOUR_LOCAL = 19;
const SAFE_LOCAL_CUTOFF_HOUR = 22;

function isInSendWindow(local: Date, sendHour: number): boolean {
  return local.getHours() === sendHour;
}

function isWithinFirst14Days(activationAt: string | null, now: Date): boolean {
  if (!activationAt) return false;
  const t = new Date(activationAt).getTime();
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t < FIRST_14_DAYS_MS;
}

function isLocalCatchupWindow(local: Date): boolean {
  const h = local.getHours();
  return h >= CATCHUP_START_HOUR_LOCAL && h < SAFE_LOCAL_CUTOFF_HOUR;
}

async function resolveActiveV2CommitmentActivationAt(clerkUserId: string): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("v2_commitment")
    .select("started_at, created_at")
    .eq("clerk_user_id", clerkUserId)
    .eq("status", "active")
    .maybeSingle();
  if (error || !data) return null;
  if (typeof data.started_at === "string" && data.started_at.trim().length > 0) {
    return data.started_at;
  }
  if (typeof data.created_at === "string" && data.created_at.trim().length > 0) {
    return data.created_at;
  }
  return null;
}

/**
 * ======================================================
 * Helper: try to reserve today's send slot
 * ======================================================
 *
 * We rely on your unique index: (clerk_user_id, day_key)
 * - If insert succeeds: this run owns the send attempt.
 * - If insert fails due to unique violation: SMS already reserved/sent today, skip safely.
 */
async function reserveTodaySendOrSkip({
  userId,
  todayKey,
}: {
  userId: string;
  todayKey: string;
}): Promise<{ reserved: boolean; reason?: string }> {
  const { error } = await supabaseServer.from("sms_send_events").insert({
    clerk_user_id: userId,
    day_key: todayKey,
    status: "reserved",
    metadata: { note: "reserved_by_cron" },
  });

  if (!error) return { reserved: true };

  // Postgres unique violation is usually 23505; Supabase error "code" often contains it.
  // If we can't detect it perfectly, we still treat any insert error as "not reserved"
  // to avoid double-sending. This favors safety over aggressive retries.
  const errorObj = error as { code?: string; message?: string } | null;
  const code = errorObj?.code;
  const message = errorObj?.message || String(error);

  if (code === "23505" || message.toLowerCase().includes("duplicate")) {
    return { reserved: false, reason: "already_reserved_or_sent_today" };
  }

  // Ambiguous insert failures: read-after-fail to avoid both duplicates and silent misses.
  const { data: existingAfterFail } = await supabaseServer
    .from("sms_send_events")
    .select("id")
    .eq("clerk_user_id", userId)
    .eq("day_key", todayKey)
    .maybeSingle();
  if (existingAfterFail?.id) {
    console.warn("[daily-sms] reservation insert failed but row already exists", {
      clerk_user_id: userId,
      day_key: todayKey,
      code,
      message,
    });
    return { reserved: false, reason: "already_reserved_or_sent_today" };
  }

  return { reserved: false, reason: "reservation_insert_failed" };
}

type SmsAudienceCronRow = {
  clerk_user_id: string;
  phone_number: string;
  sms_enabled: boolean;
  stopped_at: string | null;
  timezone: string | null;
  summitt_subscribed: boolean;
};

/**
 * Users who should get daily SMS can be missing from sms_audience if prior sync used
 * update-only or failed. Merge in Clerk-eligible rows from sms_identities and upsert via syncSmsAudience.
 */
async function mergeEligibleAudienceFromIdentities(
  baseRows: SmsAudienceCronRow[]
): Promise<{ rows: SmsAudienceCronRow[]; mergedCount: number }> {
  const seen = new Set(baseRows.map((r) => r.clerk_user_id));
  const result = [...baseRows];
  let mergedCount = 0;

  const { data: identities, error: idErr } = await supabaseServer
    .from("sms_identities")
    .select("clerk_user_id, phone_number")
    .eq("sms_enabled", true)
    .is("stopped_at", null);

  if (idErr) {
    console.error(
      "[daily-sms] sms_identities list for audience self-heal failed:",
      idErr
    );
    return { rows: result, mergedCount: 0 };
  }

  for (const row of identities ?? []) {
    const uid = row.clerk_user_id;
    const phone = row.phone_number;
    if (!uid || typeof phone !== "string" || !phone.trim()) continue;
    if (seen.has(uid)) continue;

    let user;
    try {
      user = await getClerkUser(uid);
    } catch (e) {
      console.error("[daily-sms] audience self-heal getClerkUser failed", uid, e);
      continue;
    }

    const md = user.public_metadata || {};
    if (md.summittSubscribed !== true) continue;
    if (md.smsEnabled !== true) continue;

    await syncSmsAudience({
      userId: uid,
      phoneNumber: phone.trim(),
      smsEnabled: true,
      stoppedAt: null,
      timezone: typeof md.timezone === "string" ? md.timezone : null,
      smsTimePreference:
        typeof md.smsTimePreference === "string" ? md.smsTimePreference : null,
      summittSubscribed: true,
    });

    mergedCount += 1;
    seen.add(uid);
    result.push({
      clerk_user_id: uid,
      phone_number: phone.trim(),
      sms_enabled: true,
      stopped_at: null,
      timezone: typeof md.timezone === "string" ? md.timezone : null,
      summitt_subscribed: true,
    });
  }

  return { rows: result, mergedCount };
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  if (!validateCronSecret(req)) {
    logDailySmsCronAuthFailure(req);
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const force = url.searchParams.get("force") === "1";
  const dryRunOverride = url.searchParams.get("dryRun") === "1";
  const SMS_DRY_RUN = ENV_SMS_DRY_RUN || dryRunOverride;

  const stats = {
    ok: true,
    scanned: 0,
    eligible: 0,
    reserved: 0,
    alreadyReservedOrSentToday: 0,
    sent: 0,
    retried: 0,
    dryRun: 0,
    skippedNotTime: 0,
    skippedMissingIdentity: 0,
    skippedOptedOut: 0,
    skippedAlreadyCompleted: 0,
    skippedCadence: 0,
    skippedActiveInboundThread: 0,
    skippedReactivationCooldown: 0,
    skippedRefreshIdentityAwaiting: 0,
    skippedPendingResolutionRecentConfirmation: 0,
    skippedNotFullyOnV2Daily: 0,
    skippedMissingTwilio: 0,
    failed: 0,
    sendFailed: 0,
    reservationErrors: 0,
    userLoopErrors: 0,
    recoveredReserved: 0,
    audienceSelfHealMerged: 0,
    expectedDailyAttemptUsers: 0,
    expectedNewActiveUsers: 0,
    expectedNormalActiveUsers: 0,
    skippedIntentional: 0,
    skippedUnexpected: 0,
    catchupEligible: 0,
    catchupAttempted: 0,
    skippedPreferredWindowWaiting: 0,
    skippedPastSafeLocalCutoff: 0,
    skippedUserPause: 0,
    skippedUserWeekendPolicy: 0,
    twilioAccepted: 0,
    skippedNoSafeV3Voice: 0,
  };

  const { data: audienceQueryRows } = await supabaseServer
    .from("sms_audience")
    .select("clerk_user_id, phone_number, sms_enabled, stopped_at, timezone, summitt_subscribed")
    .eq("summitt_subscribed", true)
    .eq("sms_enabled", true);

  let audienceUsers = (audienceQueryRows ?? []) as SmsAudienceCronRow[];

  if (audienceUsers.length === 0) {
    const healedEmpty = await mergeEligibleAudienceFromIdentities([]);
    audienceUsers = healedEmpty.rows;
    stats.audienceSelfHealMerged = healedEmpty.mergedCount;
    if (audienceUsers.length === 0) {
      return NextResponse.json(stats);
    }
  } else {
    const healed = await mergeEligibleAudienceFromIdentities(audienceUsers);
    audienceUsers = healed.rows;
    stats.audienceSelfHealMerged = healed.mergedCount;
  }

  for (const audienceUser of audienceUsers) {
      stats.scanned += 1;

      let stage = "getClerkUser";
      try {
      const user = await getClerkUser(audienceUser.clerk_user_id);
      const md = user.public_metadata || {};

      if (typeof audienceUser.stopped_at === "string") {
        stats.skippedOptedOut += 1;
        continue;
      }

      const commsPrefs = await fetchV2UserSmsCommsPreferences(audienceUser.clerk_user_id);

      const timezone = resolveUserTimezone(md.timezone ?? audienceUser.timezone);
      const now = new Date();

      // localNow = "now" interpreted in that user's timezone
      const localNow = new Date(now.toLocaleString("en-US", { timeZone: timezone }));

      const commsSkip = shouldSkipDailyForCommsPrefs(commsPrefs, localNow, now);
      if (commsSkip.skip && commsSkip.reason === "user_pause") {
        stats.skippedUserPause += 1;
        stats.skippedIntentional += 1;
        continue;
      }
      if (commsSkip.skip && commsSkip.reason === "weekend_policy") {
        stats.skippedUserWeekendPolicy += 1;
        stats.skippedIntentional += 1;
        continue;
      }

      // Key used for dedupe
      const todayKey = getDateKeyInTimezone(now, timezone);

      await maybeRecordV2WeakNoReplyFromPriorAccountabilityDay({
        clerkUserId: audienceUser.clerk_user_id,
        timezone,
        now,
      });

      const v2CutoverStatus = await resolveUserFullyOnV2ForCutoverMessaging(
        audienceUser.clerk_user_id
      );
      const skipLegacyDailyCompletionCheck = v2CutoverStatus.fullyOnV2;
      const activeForPolicy = v2CutoverStatus.fullyOnV2
        ? await getActiveCommitment(audienceUser.clerk_user_id)
        : null;
      const hasActiveBehavior = Boolean(activeForPolicy?.behavior_statement?.trim());
      const activationAt =
        v2CutoverStatus.fullyOnV2 && hasActiveBehavior
          ? await resolveActiveV2CommitmentActivationAt(audienceUser.clerk_user_id)
          : null;
      const isNewActive14Days = Boolean(
        v2CutoverStatus.fullyOnV2 && hasActiveBehavior && isWithinFirst14Days(activationAt, now)
      );
      const isExpectedDailyAttemptUser = Boolean(v2CutoverStatus.fullyOnV2 && hasActiveBehavior);
      if (isExpectedDailyAttemptUser) {
        stats.expectedDailyAttemptUsers += 1;
        if (isNewActive14Days) stats.expectedNewActiveUsers += 1;
        else stats.expectedNormalActiveUsers += 1;
      }

      const learnedProfForWindow = hasActiveBehavior
        ? await fetchV2UserSendTimeProfile(audienceUser.clerk_user_id)
        : null;

      const pref = smsTimePreferenceFromClerkMetadata(md as Record<string, unknown>);
      const sendHour =
        SEND_HOUR_BY_PREFERENCE[pref as keyof typeof SEND_HOUR_BY_PREFERENCE] ?? 7;

      const sendWindowPolicy = resolveDailySendWindowPolicy({
        prefs: commsPrefs,
        learnedProfile: learnedProfForWindow,
        clerkSmsTimePreference: pref,
      });

      // STEP 1: Read existing event before reserve (and before window check)
      stage = "query_send_events";
      const { data: existingRow } = await supabaseServer
        .from("sms_send_events")
        .select("id, status, metadata, message_sid")
        .eq("clerk_user_id", audienceUser.clerk_user_id)
        .eq("day_key", todayKey)
        .maybeSingle();

      let existingEvent = existingRow;

      // Retries bypass send window; first-time sends require it.
      let sendTimeWindowOk = isInSendWindow(localNow, sendHour);
      if (!existingEvent && !force) {
        if (sendWindowPolicy.useExplicitHour && sendWindowPolicy.explicitHour != null) {
          sendTimeWindowOk = localNow.getHours() === sendWindowPolicy.explicitHour;
        } else if (sendWindowPolicy.useExplicitWindow && sendWindowPolicy.explicitWindow) {
          sendTimeWindowOk = isV2LearnedSendWindowAllowed(localNow, sendWindowPolicy.explicitWindow);
        } else if (
          sendWindowPolicy.useLearnedProfile &&
          sendWindowPolicy.learnedProfile &&
          shouldUseLearnedSendTimeGate(sendWindowPolicy.learnedProfile)
        ) {
          sendTimeWindowOk = isV2LearnedSendWindowAllowed(
            localNow,
            sendWindowPolicy.learnedProfile.preferred_window
          );
        }
      }

      if (!existingEvent && !force && !sendTimeWindowOk) {
        const localHour = localNow.getHours();
        const canCatchupNow =
          isExpectedDailyAttemptUser && isLocalCatchupWindow(localNow);
        if (canCatchupNow) {
          stats.catchupEligible += 1;
          stats.catchupAttempted += 1;
          sendTimeWindowOk = true;
        } else {
          if (isExpectedDailyAttemptUser && localHour >= SAFE_LOCAL_CUTOFF_HOUR) {
            stats.skippedPastSafeLocalCutoff += 1;
          } else {
            stats.skippedPreferredWindowWaiting += 1;
          }
          stats.skippedIntentional += 1;
          stats.skippedNotTime += 1;
          continue;
        }
      }

      if (!existingEvent && !force && !sendTimeWindowOk) {
        stats.skippedNotTime += 1;
        continue;
      }

      stats.eligible += 1;

      // STEP 2 & 3: Handle existing row or proceed to reserve
      if (existingEvent) {
        const messageSidRaw = existingEvent.message_sid;
        const hasMessageSid =
          typeof messageSidRaw === "string" && messageSidRaw.trim().length > 0;

        // Unsent stuck "reserved" (insert succeeded, send/update never completed)
        if (existingEvent.status === "reserved" && !hasMessageSid) {
          const priorStatus = existingEvent.status;
          const reservedMeta = (existingEvent.metadata || {}) as Record<
            string,
            unknown
          >;
          const recoveredMeta = {
            ...reservedMeta,
            retry_count: 0,
            note: "recovered_stuck_reserved",
            recovered_at: new Date().toISOString(),
          };

          console.log("[daily-sms] recovered stuck reserved row", {
            clerk_user_id: audienceUser.clerk_user_id,
            priorStatus,
            messageSidPresent: hasMessageSid,
          });

          stats.recoveredReserved += 1;

          await supabaseServer
            .from("sms_send_events")
            .update({
              status: "send_failed",
              metadata: recoveredMeta,
            })
            .eq("clerk_user_id", audienceUser.clerk_user_id)
            .eq("day_key", todayKey);

          existingEvent = {
            ...existingEvent,
            status: "send_failed",
            metadata: recoveredMeta,
          };
        }

        // CASE A: send_failed with retries left
        if (existingEvent.status === "send_failed") {
          const existingMeta = (existingEvent.metadata || {}) as Record<string, unknown>;
          const retryCount = typeof existingMeta.retry_count === "number" ? existingMeta.retry_count : 0;

          if (retryCount < 3) {
            // Legacy app completion only; V2 accountability does not use daily_completion_events.
            if (!skipLegacyDailyCompletionCheck) {
              const { data: completed } = await supabaseServer
                .from("daily_completion_events")
                .select("id")
                .eq("clerk_user_id", audienceUser.clerk_user_id)
                .eq("day_key", todayKey)
                .limit(1);

              if (completed && completed.length > 0) {
                await supabaseServer
                  .from("sms_send_events")
                  .update({
                    status: "skipped_already_completed",
                    metadata: { ...existingMeta, note: "user_completed_today" },
                  })
                  .eq("clerk_user_id", audienceUser.clerk_user_id)
                  .eq("day_key", todayKey);
                stats.skippedAlreadyCompleted += 1;
                stats.skippedIntentional += 1;
                continue;
              }
            }

            stage = "active_inbound_thread_gate";
            if (await shouldSkipDailyForActiveInboundThread(audienceUser.clerk_user_id)) {
              await supabaseServer
                .from("sms_send_events")
                .update({
                  status: "skipped_active_inbound_thread",
                  metadata: {
                    note: "recent_inbound_accountability_exchange",
                    window_ms: 3 * 60 * 60 * 1000,
                    timezone,
                    local_time: localNow.toISOString(),
                  },
                })
                .eq("clerk_user_id", audienceUser.clerk_user_id)
                .eq("day_key", todayKey);

              stats.skippedActiveInboundThread += 1;
              stats.skippedIntentional += 1;
              continue;
            }

            stage = "build_content";
            const builtRaw = await buildDailySmsContent(
              audienceUser.clerk_user_id,
              md as Record<string, unknown>,
              todayKey
            );
            const built = builtRaw.ok
              ? await withNorthStarDailyGate(builtRaw, { localHour: localNow.getHours() })
              : builtRaw;
            if (!built.ok) {
              if (built.error === "v2_reactivation_not_due") {
                await supabaseServer
                  .from("sms_send_events")
                  .update({
                    status: "skipped_reactivation_cooldown",
                    metadata: {
                      ...existingMeta,
                      note: "v2_reactivation_not_due",
                      timezone,
                      local_time: localNow.toISOString(),
                    },
                  })
                  .eq("clerk_user_id", audienceUser.clerk_user_id)
                  .eq("day_key", todayKey);
                stats.skippedReactivationCooldown += 1;
                stats.skippedIntentional += 1;
                continue;
              }
              if (built.error === "v2_refresh_identity_await_reply") {
                await supabaseServer
                  .from("sms_send_events")
                  .update({
                    status: "skipped_v2_refresh_identity_pending",
                    metadata: {
                      ...existingMeta,
                      note: "v2_refresh_identity_await_reply",
                      timezone,
                      local_time: localNow.toISOString(),
                    },
                  })
                  .eq("clerk_user_id", audienceUser.clerk_user_id)
                  .eq("day_key", todayKey);
                stats.skippedRefreshIdentityAwaiting += 1;
                stats.skippedIntentional += 1;
                continue;
              }
              if (built.error === "v2_pending_resolution_recent_confirmation_skip") {
                await supabaseServer
                  .from("sms_send_events")
                  .update({
                    status: "skipped_pending_resolution_recent_confirm",
                    metadata: {
                      ...existingMeta,
                      note: "v2_pending_resolution_recent_confirmation_skip",
                      timezone,
                      local_time: localNow.toISOString(),
                    },
                  })
                  .eq("clerk_user_id", audienceUser.clerk_user_id)
                  .eq("day_key", todayKey);
                stats.skippedPendingResolutionRecentConfirmation += 1;
                stats.skippedIntentional += 1;
                continue;
              }
              if (built.error === "not_fully_on_v2_daily_sms") {
                await supabaseServer
                  .from("sms_send_events")
                  .update({
                    status: "skipped_not_fully_on_v2",
                    metadata: {
                      ...existingMeta,
                      note: "v2_only_daily_sms",
                      cutover_reason: v2CutoverStatus.reason,
                      timezone,
                      local_time: localNow.toISOString(),
                    },
                  })
                  .eq("clerk_user_id", audienceUser.clerk_user_id)
                  .eq("day_key", todayKey);
                stats.skippedNotFullyOnV2Daily += 1;
                stats.skippedIntentional += 1;
                continue;
              }
              if (built.error === "adaptive_proposal_finalizer_no_safe_voice") {
                await supabaseServer
                  .from("sms_send_events")
                  .update({
                    status: "skipped_no_safe_v3_voice",
                    metadata: {
                      ...existingMeta,
                      note: "adaptive_proposal_finalizer_no_safe_voice",
                      voice_decision: "skipped_adaptive_proposal_validator_fail_closed",
                      twilio_send_attempted: false,
                      timezone,
                      local_time: localNow.toISOString(),
                      ...(built.adaptiveProposalWithheldMeta
                        ? { adaptive_proposal_outbound: built.adaptiveProposalWithheldMeta }
                        : {}),
                    },
                  })
                  .eq("clerk_user_id", audienceUser.clerk_user_id)
                  .eq("day_key", todayKey);
                stats.skippedNoSafeV3Voice += 1;
                stats.skippedIntentional += 1;
                continue;
              }
              if (built.error === "daily_v3_lane_no_send") {
                await supabaseServer
                  .from("sms_send_events")
                  .update({
                    status: "skipped_no_safe_v3_voice",
                    metadata: {
                      ...existingMeta,
                      note: "daily_v3_lane_no_send",
                      voice_decision: "skipped_no_safe_v3_voice",
                      twilio_send_attempted: false,
                      timezone,
                      local_time: localNow.toISOString(),
                      ...(built.dailyLaneMeta ? { daily_v3_lane: built.dailyLaneMeta } : {}),
                    },
                  })
                  .eq("clerk_user_id", audienceUser.clerk_user_id)
                  .eq("day_key", todayKey);
                stats.skippedNoSafeV3Voice += 1;
                stats.skippedIntentional += 1;
                continue;
              }
              await supabaseServer
                .from("sms_send_events")
                .update({
                  status: "send_failed",
                  metadata: {
                    ...existingMeta,
                    note: "new_delivery_body_failed",
                    error: built.error,
                    timezone,
                    local_time: localNow.toISOString(),
                  },
                })
                .eq("clerk_user_id", audienceUser.clerk_user_id)
                .eq("day_key", todayKey);
              stats.failed += 1;
              stats.sendFailed += 1;
              stats.skippedUnexpected += 1;
              continue;
            }
            const smsBody = built.smsBody;
            const v2AccountabilityRetry = built.v2Accountability;

            if (isDailySmsWithheldByFinalVoiceGate(built)) {
              const voiceSendDecisionRetry = built.v2AiPayload?.voice_send_decision as
                | {
                    should_send?: boolean;
                    voice_channel?: NorthStarCoachChannel;
                    blocked_reasons?: string[];
                    north_star_visible_body?: string;
                  }
                | undefined;
              const northStarGateR = (built.v2AiPayload?.north_star_gate ?? {}) as Record<string, unknown>;
              const finalVoiceGateR = (built.v2AiPayload?.final_voice_gate ?? {}) as Record<string, unknown>;
              const patchR = dailySmsVoiceSkipEventPatch({
                existingMeta: existingMeta,
                northStarGate: northStarGateR,
                finalVoiceGate: finalVoiceGateR,
                channel: voiceSendDecisionRetry?.voice_channel ?? "daily_outbound",
                timezone,
                localTimeIso: localNow.toISOString(),
                blockedReasons: voiceSendDecisionRetry?.blocked_reasons ?? [],
                northStarVisibleBody: voiceSendDecisionRetry?.north_star_visible_body,
              });
              await supabaseServer
                .from("sms_send_events")
                .update(patchR)
                .eq("clerk_user_id", audienceUser.clerk_user_id)
                .eq("day_key", todayKey);
              stats.skippedNoSafeV3Voice += 1;
              stats.skippedIntentional += 1;
              continue;
            }

            stage = "twilio_send_or_skip";
            if (!isTwilioReady() || SMS_DRY_RUN) {
              stats.alreadyReservedOrSentToday += 1;
              continue;
            }

            let retryMessage;
            try {
              retryMessage = await sendSMS({
                to: audienceUser.phone_number,
                body: smsBody,
                lastOutbound: {
                  clerkUserId: audienceUser.clerk_user_id,
                  messageKind: "question",
                  timeOfDay: timeOfDayForOutboundContext(md as Record<string, unknown>),
                  questionPosition: null,
                  skipLastOutboundContextUpsert: true,
                },
              });
              stats.twilioAccepted += 1;
            } catch (err) {
              const newRetryCount = retryCount + 1;
              await supabaseServer
                .from("sms_send_events")
                .update({
                  status: "send_failed",
                  metadata: {
                    ...existingMeta,
                    retry_count: newRetryCount,
                    error: String(err),
                    note: "retry_failed",
                    timezone,
                    local_time: localNow.toISOString(),
                  },
                })
                .eq("clerk_user_id", audienceUser.clerk_user_id)
                .eq("day_key", todayKey);
              stats.failed += 1;
              stats.sendFailed += 1;
              stats.skippedUnexpected += 1;
              continue;
            }

            const retrySendWindow = localHourToSendWindow(localNow.getHours());
            const retrySuccessPayload = {
              message_sid: retryMessage.sid,
              status: retryMessage.status,
              sms_body: smsBody,
              metadata: {
                ...existingMeta,
                retry_count: retryCount + 1,
                note: "retry_success",
                timezone,
                local_time: localNow.toISOString(),
                v2_accountability: v2AccountabilityRetry,
                ...(built.v2ReactivationNudge ? { v2_reactivation_nudge: true } : {}),
                ...(v2AccountabilityRetry && !built.v2ReactivationNudge && retrySendWindow
                  ? { v2_send_window: retrySendWindow }
                  : {}),
                ...(typeof built.v2TemplateId === "number"
                  ? { v2_template_id: built.v2TemplateId }
                  : {}),
                ...(typeof built.v2CommitmentId === "string"
                  ? { v2_commitment_id: built.v2CommitmentId }
                  : {}),
                ...(typeof built.v2TemplateFamily === "string"
                  ? { v2_template_family: built.v2TemplateFamily }
                  : {}),
                ...(built.v2PendingResolutionReminder
                  ? { pending_resolution_reminder: true, non_accountability_outbound: true }
                  : {}),
                ...dailySmsSentEventVoiceMetadata(built),
              },
            };
            let recordOk = false;
            const { error: retryUpdErr } = await supabaseServer
              .from("sms_send_events")
              .update(retrySuccessPayload)
              .eq("clerk_user_id", audienceUser.clerk_user_id)
              .eq("day_key", todayKey);
            if (!retryUpdErr) {
              recordOk = true;
            } else {
              console.error(
                "[daily-sms] sms_send_events update failed after Twilio success (retry path)",
                {
                  clerk_user_id: audienceUser.clerk_user_id,
                  todayKey,
                  message_sid: retryMessage.sid,
                  error: retryUpdErr,
                }
              );
              const { error: retryUpdErr2 } = await supabaseServer
                .from("sms_send_events")
                .update(retrySuccessPayload)
                .eq("clerk_user_id", audienceUser.clerk_user_id)
                .eq("day_key", todayKey);
              if (!retryUpdErr2) {
                recordOk = true;
              } else {
                console.error(
                  "[daily-sms] sms_send_events second update failed after Twilio success (retry path)",
                  {
                    clerk_user_id: audienceUser.clerk_user_id,
                    todayKey,
                    message_sid: retryMessage.sid,
                    error: retryUpdErr2,
                  }
                );
              }
            }
            if (recordOk) {
              await writeV2SmsThreadMemoryAfterDailyV3Outbound({
                built,
                clerkUserId: audienceUser.clerk_user_id,
                sentBody: smsBody,
                messageSid: retryMessage.sid,
                sentAt: new Date(),
              });
              stats.sent += 1;
              stats.retried += 1;
              if (built.v2ReactivationNudge && built.v2CommitmentId) {
                await updateReactivationLastSentAt(built.v2CommitmentId);
                await recomputeV2CoachingMemory(built.v2CommitmentId, {
                  reasonCode: "daily_sms_reactivation_nudge_sent",
                });
              } else if (
                v2AccountabilityRetry &&
                !built.v2ReactivationNudge &&
                built.v2CommitmentId &&
                typeof built.v2TemplateId === "number" &&
                built.v2PendingResolutionReminder
              ) {
                await recomputeV2CoachingMemory(built.v2CommitmentId, {
                  reasonCode: "daily_sms_pending_resolution_reminder",
                });
              } else if (
                v2AccountabilityRetry &&
                !built.v2ReactivationNudge &&
                built.v2CommitmentId &&
                typeof built.v2TemplateId === "number"
              ) {
                if (built.v2RefreshOutboundPlan && built.v2CommitmentId) {
                  await insertV2CheckSentEventBestEffort({
                    commitmentId: built.v2CommitmentId,
                    clerkUserId: audienceUser.clerk_user_id,
                    dayKey: todayKey,
                    templateId: built.v2TemplateId,
                    messageSid: retryMessage.sid,
                    bodyPreview: smsBody.slice(0, 160),
                    templateFamily:
                      built.v2TemplateFamily === "recovery" ? "recovery" : "standard",
                    priorOutcome: built.v2PriorOutcome ?? null,
                    blockerPreview: built.v2BlockerPreview ?? null,
                    silence: built.v2SilencePayload ?? null,
                    reentry: built.v2ReentryPayload ?? null,
                    nextMove: built.v2NextMovePayload ?? null,
                    ai: built.v2AiPayload ?? null,
                    cadence: built.v2CadencePayload ?? null,
                    coachingRefresh: {
                      session_id: built.v2RefreshOutboundPlan.session.session_id,
                      step: built.v2RefreshOutboundPlan.session.step,
                      outbound_kind: built.v2RefreshOutboundPlan.kind,
                    },
                  });
                  await onV2RefreshOutboundSendSuccess({
                    commitmentId: built.v2CommitmentId,
                    clerkUserId: audienceUser.clerk_user_id,
                    messageSid: retryMessage.sid,
                    smsBody,
                    plan: built.v2RefreshOutboundPlan,
                  });
                } else {
                  const promptKind: V2CheckSentPromptKind = built.v2ContractProposalMode
                    ? "contract_overlay_proposal"
                    : "standard_accountability";
                  const expectedReplySemantics: V2CheckSentExpectedReplySemantics =
                    built.v2ContractProposalMode ? "proposal_yes_no" : "yes_no_partial";
                  await onV2StandardCheckSentOutboundSendSuccess({
                    commitmentId: built.v2CommitmentId,
                    clerkUserId: audienceUser.clerk_user_id,
                    dayKey: todayKey,
                    templateId: built.v2TemplateId,
                    templateFamily:
                      built.v2TemplateFamily === "recovery" ? "recovery" : "standard",
                    messageSid: retryMessage.sid,
                    smsBody,
                    effectiveAskText: built.v2EffectiveAskText ?? smsBody,
                    promptKind,
                    expectedReplySemantics,
                    checkPayloadJson: buildStandardCheckSentPayload({
                      priorOutcome: built.v2PriorOutcome ?? null,
                      blockerPreview: built.v2BlockerPreview ?? null,
                      silence: built.v2SilencePayload ?? null,
                      reentry: built.v2ReentryPayload ?? null,
                      nextMove: built.v2NextMovePayload ?? null,
                      ai: built.v2AiPayload ?? null,
                      cadence: built.v2CadencePayload ?? null,
                      contractProposal: withPresentedDailyContractProposalAuditFields(
                        built.v2ContractProposalPayload ?? null,
                        smsBody
                      ),
                    }),
                    contractOverlayProposal:
                      built.v2ContractProposalMode &&
                      built.v2ProposalBindingText &&
                      built.v2ContractProposalKind
                        ? {
                            text: built.v2ProposalBindingText,
                            contractKind: built.v2ContractProposalKind,
                          }
                        : null,
                  });
                }

                if (built.v2RefreshOutboundPlan && built.v2ContractProposalMode) {
                  // no-op guard: refresh and proposal mode should not coincide
                }
                await recomputeV2CoachingMemory(built.v2CommitmentId, {
                  reasonCode: "daily_sms_check_sent",
                });
                if (!built.v2RefreshOutboundPlan) {
                  await markIdentityAnchorReferencedIfPresentInBody({
                    clerkUserId: audienceUser.clerk_user_id,
                    sentBody: smsBody,
                    identityAnchorText: built.v2IdentityAnchorText ?? null,
                  });
                }
              }
            } else {
              console.error(
                "[daily-sms] Twilio sent but failed to record sms_send_events",
                {
                  clerkUserId: audienceUser.clerk_user_id,
                  dayKey: todayKey,
                  messageSid: retryMessage.sid,
                }
              );
              stats.failed += 1;
              stats.sendFailed += 1;
              stats.skippedUnexpected += 1;
            }
            continue;
          }
        }
        // CASE B: any other status - skip
        stats.alreadyReservedOrSentToday += 1;
        stats.skippedIntentional += 1;
        continue;
      }

      // V2: optional transition into low-pressure reactivation + cadence gate (cadence suspended while paused).
      stage = "v2_cadence_gate";
      let activeCadence = await getActiveCommitment(audienceUser.clerk_user_id);
      if (activeCadence?.behavior_statement?.trim()) {
        await clearStaleAdaptiveContractColumns(activeCadence.id);
        const refreshedCadence = await getActiveCommitment(audienceUser.clerk_user_id);
        if (refreshedCadence?.behavior_statement?.trim()) {
          activeCadence = refreshedCadence;
        }
        const nowCadence = new Date();
        const nowMsGate = nowCadence.getTime();

        const recentForPhase = await getRecentV2EventsForAi(activeCadence.id);
        const silenceForPhase = deriveV2SilenceContext(recentForPhase, nowCadence);
        const plannedForPhase = await loadRecentPlannedInterruptionSignalForCommitment({
          commitmentId: activeCadence.id,
          clerkUserId: audienceUser.clerk_user_id,
          now: nowCadence,
        });

        const userCadenceOverride = shouldApplyUserCadenceOverride(commsPrefs, nowCadence);

        if (activeCadence.accountability_phase === "active_accountability") {
          if (!isNewActive14Days) {
            const lastTwoRows = await getLastNV2CheckSentPayloads(activeCadence.id, 2);
            const lastTwoLevels = lastTwoRows.map((r) =>
              parseCadenceLevelFromCheckSentPayload(r.payload_json)
            );
            if (
              plannedForPhase == null &&
              !isPauseActive(commsPrefs, nowCadence) &&
              shouldEnterLowPressureReactivation({
                phase: activeCadence.accountability_phase,
                commitment: activeCadence,
                nowMs: nowMsGate,
                silence: silenceForPhase,
                lastTwoCheckSentCadenceLevels: lastTwoLevels,
                recentEventsNewestFirst: recentForPhase,
              })
            ) {
              await enterLowPressureReactivationMode(activeCadence.id, V2_REACTIVATION_ENTRY_REASON);
              await recomputeV2CoachingMemory(activeCadence.id, {
                reasonCode: "daily_sms_enter_reactivation",
              });
              const reloadedAfterEnter = await getActiveCommitment(audienceUser.clerk_user_id);
              if (reloadedAfterEnter?.behavior_statement?.trim()) {
                activeCadence = reloadedAfterEnter;
              }
            }
          }
        }

        if (activeCadence.accountability_phase === "low_pressure_reactivation") {
          if (
            !isReactivationNudgeDue({
              reactivationEnteredAt: activeCadence.reactivation_entered_at,
              reactivationLastSentAt: activeCadence.reactivation_last_sent_at,
              nowMs: nowMsGate,
            })
          ) {
            stats.skippedReactivationCooldown += 1;
            stats.skippedIntentional += 1;
            continue;
          }
        } else {
          const [recentCadence, lastCheckCadence, latestOutcomeCadence] = await Promise.all([
            getRecentV2EventsForAi(activeCadence.id),
            getLastV2CheckSentForCommitment(activeCadence.id),
            getLatestV2AccountabilityOutcome(activeCadence.id),
          ]);
          const blockerPreviewCadence = await resolveV2BlockerPreviewForOutbound({
            commitmentId: activeCadence.id,
            latestOutcome: latestOutcomeCadence,
            recentEvents: recentCadence,
          });
          const hasBlockerPreviewCadence = Boolean(
            blockerPreviewCadence && blockerPreviewCadence.trim().length > 0
          );
          // Phase 1A product policy:
          // - expected daily-attempt V2 users (new + normal active) should not be skipped by relax cadence.
          // - reduced-contact skipping is preserved via low_pressure_reactivation branch above.
          // - user cadence_override (Slice C) applies even for expected daily-attempt users.
          const cadencePayloadGate = deriveV2CadencePayload({
            eventsNewestFirst: recentCadence,
            now: nowCadence,
            hasBlockerPreview: hasBlockerPreviewCadence,
          });
          const cadenceLevelForGate = userCadenceOverride ?? cadencePayloadGate.level;
          if (!isExpectedDailyAttemptUser || userCadenceOverride != null) {
            if (
              !shouldSendV2CadenceToday({
                lastSuccessfulCheckSentDayKey: lastCheckCadence?.day_key ?? null,
                todayLocalDayKey: todayKey,
                cadenceLevel: cadenceLevelForGate,
              })
            ) {
              stats.skippedCadence += 1;
              stats.skippedIntentional += 1;
              continue;
            }
          }
        }
      }

      // STEP 3: Only reserve if no row exists
      stage = "reserve";
      const reservation = await reserveTodaySendOrSkip({
        userId: audienceUser.clerk_user_id,
        todayKey,
      });

      if (!reservation.reserved) {
        if (reservation.reason === "already_reserved_or_sent_today") {
          stats.alreadyReservedOrSentToday += 1;
          stats.skippedIntentional += 1;
        } else {
          stats.reservationErrors += 1;
          stats.skippedUnexpected += 1;
        }
        continue;
      }

      stats.reserved += 1;

      // Legacy: skip send if old app completion row exists for today. Not used for full V2 path.
      if (!skipLegacyDailyCompletionCheck) {
        const { data: completed } = await supabaseServer
          .from("daily_completion_events")
          .select("id")
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey)
          .limit(1);

        if (completed && completed.length > 0) {
          await supabaseServer
            .from("sms_send_events")
            .update({
              status: "skipped_already_completed",
              metadata: { note: "user_completed_today" },
            })
            .eq("clerk_user_id", audienceUser.clerk_user_id)
            .eq("day_key", todayKey);

          stats.skippedAlreadyCompleted += 1;
          stats.skippedIntentional += 1;
          continue;
        }
      }

      stage = "active_inbound_thread_gate";
      if (await shouldSkipDailyForActiveInboundThread(audienceUser.clerk_user_id)) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: "skipped_active_inbound_thread",
            metadata: {
              note: "recent_inbound_accountability_exchange",
              window_ms: 3 * 60 * 60 * 1000,
              timezone,
              local_time: localNow.toISOString(),
            },
          })
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey);

        stats.skippedActiveInboundThread += 1;
        stats.skippedIntentional += 1;
        continue;
      }

      stage = "build_content";
      const builtMainRaw = await buildDailySmsContent(
        audienceUser.clerk_user_id,
        md as Record<string, unknown>,
        todayKey
      );
      const builtMain = builtMainRaw.ok
        ? await withNorthStarDailyGate(builtMainRaw, { localHour: localNow.getHours() })
        : builtMainRaw;
      if (!builtMain.ok) {
        if (builtMain.error === "v2_reactivation_not_due") {
          await supabaseServer
            .from("sms_send_events")
            .update({
              status: "skipped_reactivation_cooldown",
              metadata: {
                note: "v2_reactivation_not_due",
                timezone,
                local_time: localNow.toISOString(),
              },
            })
            .eq("clerk_user_id", audienceUser.clerk_user_id)
            .eq("day_key", todayKey);
          stats.skippedReactivationCooldown += 1;
          stats.skippedIntentional += 1;
          continue;
        }
        if (builtMain.error === "v2_refresh_identity_await_reply") {
          await supabaseServer
            .from("sms_send_events")
            .update({
              status: "skipped_v2_refresh_identity_pending",
              metadata: {
                note: "v2_refresh_identity_await_reply",
                timezone,
                local_time: localNow.toISOString(),
              },
            })
            .eq("clerk_user_id", audienceUser.clerk_user_id)
            .eq("day_key", todayKey);
          stats.skippedRefreshIdentityAwaiting += 1;
          stats.skippedIntentional += 1;
          continue;
        }
        if (builtMain.error === "v2_pending_resolution_recent_confirmation_skip") {
          await supabaseServer
            .from("sms_send_events")
            .update({
              status: "skipped_pending_resolution_recent_confirm",
              metadata: {
                note: "v2_pending_resolution_recent_confirmation_skip",
                timezone,
                local_time: localNow.toISOString(),
              },
            })
            .eq("clerk_user_id", audienceUser.clerk_user_id)
            .eq("day_key", todayKey);
          stats.skippedPendingResolutionRecentConfirmation += 1;
          stats.skippedIntentional += 1;
          continue;
        }
        if (builtMain.error === "not_fully_on_v2_daily_sms") {
          await supabaseServer
            .from("sms_send_events")
            .update({
              status: "skipped_not_fully_on_v2",
              metadata: {
                note: "v2_only_daily_sms",
                cutover_reason: v2CutoverStatus.reason,
                timezone,
                local_time: localNow.toISOString(),
              },
            })
            .eq("clerk_user_id", audienceUser.clerk_user_id)
            .eq("day_key", todayKey);
          stats.skippedNotFullyOnV2Daily += 1;
          stats.skippedIntentional += 1;
          continue;
        }
        if (builtMain.error === "adaptive_proposal_finalizer_no_safe_voice") {
          await supabaseServer
            .from("sms_send_events")
            .update({
              status: "skipped_no_safe_v3_voice",
              metadata: {
                note: "adaptive_proposal_finalizer_no_safe_voice",
                voice_decision: "skipped_adaptive_proposal_validator_fail_closed",
                twilio_send_attempted: false,
                timezone,
                local_time: localNow.toISOString(),
                ...(builtMain.adaptiveProposalWithheldMeta
                  ? { adaptive_proposal_outbound: builtMain.adaptiveProposalWithheldMeta }
                  : {}),
              },
            })
            .eq("clerk_user_id", audienceUser.clerk_user_id)
            .eq("day_key", todayKey);
          stats.skippedNoSafeV3Voice += 1;
          stats.skippedIntentional += 1;
          continue;
        }
        if (builtMain.error === "daily_v3_lane_no_send") {
          await supabaseServer
            .from("sms_send_events")
            .update({
              status: "skipped_no_safe_v3_voice",
              metadata: {
                note: "daily_v3_lane_no_send",
                voice_decision: "skipped_no_safe_v3_voice",
                twilio_send_attempted: false,
                timezone,
                local_time: localNow.toISOString(),
                ...(builtMain.dailyLaneMeta ? { daily_v3_lane: builtMain.dailyLaneMeta } : {}),
              },
            })
            .eq("clerk_user_id", audienceUser.clerk_user_id)
            .eq("day_key", todayKey);
          stats.skippedNoSafeV3Voice += 1;
          stats.skippedIntentional += 1;
          continue;
        }
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: "send_failed",
            metadata: {
              note: "new_delivery_body_failed",
              error: builtMain.error,
              timezone,
              local_time: localNow.toISOString(),
            },
          })
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey);
        stats.failed += 1;
        stats.sendFailed += 1;
        stats.skippedUnexpected += 1;
        continue;
      }
      const smsBody = builtMain.smsBody;
      const v2AccountabilityMain = builtMain.v2Accountability;

      if (isDailySmsWithheldByFinalVoiceGate(builtMain)) {
        const voiceSendDecision = builtMain.v2AiPayload?.voice_send_decision as
          | {
              should_send?: boolean;
              voice_channel?: NorthStarCoachChannel;
              blocked_reasons?: string[];
              north_star_visible_body?: string;
            }
          | undefined;
        const northStarGate = (builtMain.v2AiPayload?.north_star_gate ?? {}) as Record<string, unknown>;
        const finalVoiceGate = (builtMain.v2AiPayload?.final_voice_gate ?? {}) as Record<string, unknown>;
        const patch = dailySmsVoiceSkipEventPatch({
          existingMeta: { note: "reserved_by_cron" },
          northStarGate,
          finalVoiceGate,
          channel: voiceSendDecision?.voice_channel ?? "daily_outbound",
          timezone,
          localTimeIso: localNow.toISOString(),
          blockedReasons: voiceSendDecision?.blocked_reasons ?? [],
          northStarVisibleBody: voiceSendDecision?.north_star_visible_body,
        });
        await supabaseServer
          .from("sms_send_events")
          .update(patch)
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey);
        stats.skippedNoSafeV3Voice += 1;
        stats.skippedIntentional += 1;
        continue;
      }

      // Twilio readiness + dry run
      stage = "twilio_send_or_skip";
      if (!isTwilioReady() || SMS_DRY_RUN) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: SMS_DRY_RUN ? "dry_run" : "skipped_missing_twilio",
            metadata: {
              note: SMS_DRY_RUN ? "dry_run_enabled" : "twilio_not_ready",
              timezone,
              local_time: localNow.toISOString(),
            },
          })
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey);

        if (SMS_DRY_RUN) stats.dryRun += 1;
        else {
          stats.skippedMissingTwilio += 1;
          stats.skippedUnexpected += 1;
        }

        continue;
      }

      let mainMessage;
      try {
        mainMessage = await sendSMS({
          to: audienceUser.phone_number,
          body: smsBody,
          lastOutbound: {
            clerkUserId: audienceUser.clerk_user_id,
            messageKind: "question",
            timeOfDay: timeOfDayForOutboundContext(md as Record<string, unknown>),
            questionPosition: null,
            skipLastOutboundContextUpsert: true,
          },
        });
        stats.twilioAccepted += 1;
      } catch (err) {
        await supabaseServer
          .from("sms_send_events")
          .update({
            status: "send_failed",
            metadata: {
              error: String(err),
              retry_count: 0,
              timezone,
              local_time: localNow.toISOString(),
            },
          })
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey);

        stats.failed += 1;
        stats.sendFailed += 1;
        stats.skippedUnexpected += 1;
      }

      if (mainMessage) {
        const mainSendWindow = localHourToSendWindow(localNow.getHours());
        const mainSuccessPayload = {
          message_sid: mainMessage.sid,
          status: mainMessage.status,
          sms_body: smsBody,
          metadata: {
            note: "sent_to_twilio",
            timezone,
            local_time: localNow.toISOString(),
            v2_accountability: v2AccountabilityMain,
            ...(builtMain.v2ReactivationNudge ? { v2_reactivation_nudge: true } : {}),
            ...(v2AccountabilityMain && !builtMain.v2ReactivationNudge && mainSendWindow
              ? { v2_send_window: mainSendWindow }
              : {}),
            ...(typeof builtMain.v2TemplateId === "number"
              ? { v2_template_id: builtMain.v2TemplateId }
              : {}),
            ...(typeof builtMain.v2CommitmentId === "string"
              ? { v2_commitment_id: builtMain.v2CommitmentId }
              : {}),
            ...(typeof builtMain.v2TemplateFamily === "string"
              ? { v2_template_family: builtMain.v2TemplateFamily }
              : {}),
            ...(builtMain.v2PendingResolutionReminder
              ? { pending_resolution_reminder: true, non_accountability_outbound: true }
              : {}),
            ...dailySmsSentEventVoiceMetadata(builtMain),
          },
        };
        let recordOk = false;
        const { error: mainUpdErr } = await supabaseServer
          .from("sms_send_events")
          .update(mainSuccessPayload)
          .eq("clerk_user_id", audienceUser.clerk_user_id)
          .eq("day_key", todayKey);
        if (!mainUpdErr) {
          recordOk = true;
        } else {
          console.error(
            "[daily-sms] sms_send_events update failed after Twilio success (main path)",
            {
              clerk_user_id: audienceUser.clerk_user_id,
              todayKey,
              message_sid: mainMessage.sid,
              error: mainUpdErr,
            }
          );
          const { error: mainUpdErr2 } = await supabaseServer
            .from("sms_send_events")
            .update(mainSuccessPayload)
            .eq("clerk_user_id", audienceUser.clerk_user_id)
            .eq("day_key", todayKey);
          if (!mainUpdErr2) {
            recordOk = true;
          } else {
            console.error(
              "[daily-sms] sms_send_events second update failed after Twilio success (main path)",
              {
                clerk_user_id: audienceUser.clerk_user_id,
                todayKey,
                message_sid: mainMessage.sid,
                error: mainUpdErr2,
              }
            );
          }
        }
        if (recordOk) {
          await writeV2SmsThreadMemoryAfterDailyV3Outbound({
            built: builtMain,
            clerkUserId: audienceUser.clerk_user_id,
            sentBody: smsBody,
            messageSid: mainMessage.sid,
            sentAt: new Date(),
          });
          stats.sent += 1;
          if (builtMain.v2ReactivationNudge && builtMain.v2CommitmentId) {
            await updateReactivationLastSentAt(builtMain.v2CommitmentId);
            await recomputeV2CoachingMemory(builtMain.v2CommitmentId, {
              reasonCode: "daily_sms_reactivation_nudge_sent",
            });
          } else if (
            v2AccountabilityMain &&
            !builtMain.v2ReactivationNudge &&
            builtMain.v2CommitmentId &&
            typeof builtMain.v2TemplateId === "number" &&
            builtMain.v2PendingResolutionReminder
          ) {
            await recomputeV2CoachingMemory(builtMain.v2CommitmentId, {
              reasonCode: "daily_sms_pending_resolution_reminder",
            });
          } else if (
            v2AccountabilityMain &&
            !builtMain.v2ReactivationNudge &&
            builtMain.v2CommitmentId &&
            typeof builtMain.v2TemplateId === "number"
          ) {
            if (builtMain.v2RefreshOutboundPlan && builtMain.v2CommitmentId) {
              await insertV2CheckSentEventBestEffort({
                commitmentId: builtMain.v2CommitmentId,
                clerkUserId: audienceUser.clerk_user_id,
                dayKey: todayKey,
                templateId: builtMain.v2TemplateId,
                messageSid: mainMessage.sid,
                bodyPreview: smsBody.slice(0, 160),
                templateFamily:
                  builtMain.v2TemplateFamily === "recovery" ? "recovery" : "standard",
                priorOutcome: builtMain.v2PriorOutcome ?? null,
                blockerPreview: builtMain.v2BlockerPreview ?? null,
                silence: builtMain.v2SilencePayload ?? null,
                reentry: builtMain.v2ReentryPayload ?? null,
                nextMove: builtMain.v2NextMovePayload ?? null,
                ai: builtMain.v2AiPayload ?? null,
                cadence: builtMain.v2CadencePayload ?? null,
                coachingRefresh: {
                  session_id: builtMain.v2RefreshOutboundPlan.session.session_id,
                  step: builtMain.v2RefreshOutboundPlan.session.step,
                  outbound_kind: builtMain.v2RefreshOutboundPlan.kind,
                },
              });
              await onV2RefreshOutboundSendSuccess({
                commitmentId: builtMain.v2CommitmentId,
                clerkUserId: audienceUser.clerk_user_id,
                messageSid: mainMessage.sid,
                smsBody,
                plan: builtMain.v2RefreshOutboundPlan,
              });
            } else {
              const promptKind: V2CheckSentPromptKind = builtMain.v2ContractProposalMode
                ? "contract_overlay_proposal"
                : "standard_accountability";
              const expectedReplySemantics: V2CheckSentExpectedReplySemantics =
                builtMain.v2ContractProposalMode ? "proposal_yes_no" : "yes_no_partial";
              await onV2StandardCheckSentOutboundSendSuccess({
                commitmentId: builtMain.v2CommitmentId,
                clerkUserId: audienceUser.clerk_user_id,
                dayKey: todayKey,
                templateId: builtMain.v2TemplateId,
                templateFamily:
                  builtMain.v2TemplateFamily === "recovery" ? "recovery" : "standard",
                messageSid: mainMessage.sid,
                smsBody,
                effectiveAskText: builtMain.v2EffectiveAskText ?? smsBody,
                promptKind,
                expectedReplySemantics,
                checkPayloadJson: buildStandardCheckSentPayload({
                  priorOutcome: builtMain.v2PriorOutcome ?? null,
                  blockerPreview: builtMain.v2BlockerPreview ?? null,
                  silence: builtMain.v2SilencePayload ?? null,
                  reentry: builtMain.v2ReentryPayload ?? null,
                  nextMove: builtMain.v2NextMovePayload ?? null,
                  ai: builtMain.v2AiPayload ?? null,
                  cadence: builtMain.v2CadencePayload ?? null,
                  contractProposal: withPresentedDailyContractProposalAuditFields(
                    builtMain.v2ContractProposalPayload ?? null,
                    smsBody
                  ),
                }),
                contractOverlayProposal:
                  builtMain.v2ContractProposalMode &&
                  builtMain.v2ProposalBindingText &&
                  builtMain.v2ContractProposalKind
                    ? {
                        text: builtMain.v2ProposalBindingText,
                        contractKind: builtMain.v2ContractProposalKind,
                      }
                    : null,
              });
            }

            if (builtMain.v2RefreshOutboundPlan && builtMain.v2ContractProposalMode) {
              // no-op guard: refresh and proposal mode should not coincide
            }
            await recomputeV2CoachingMemory(builtMain.v2CommitmentId, {
              reasonCode: "daily_sms_check_sent",
            });
            if (!builtMain.v2RefreshOutboundPlan) {
              await markIdentityAnchorReferencedIfPresentInBody({
                clerkUserId: audienceUser.clerk_user_id,
                sentBody: smsBody,
                identityAnchorText: builtMain.v2IdentityAnchorText ?? null,
              });
            }
          }
        } else {
          console.error(
            "[daily-sms] Twilio sent but failed to record sms_send_events",
            {
              clerkUserId: audienceUser.clerk_user_id,
              dayKey: todayKey,
              messageSid: mainMessage.sid,
            }
          );
          stats.failed += 1;
          stats.sendFailed += 1;
          stats.skippedUnexpected += 1;
        }
      }
      } catch (userErr: unknown) {
        const message =
          userErr instanceof Error ? userErr.message : String(userErr);
        console.error("[daily-sms] user processing error", {
          clerk_user_id: audienceUser.clerk_user_id,
          stage,
          message,
        });
        stats.userLoopErrors += 1;
        stats.skippedUnexpected += 1;
        continue;
      }
  }

  // Persist daily summary for observability (do not block cron success)
  const dayKey = getDateKeyInTimezone(new Date(), "UTC");
  try {
    await supabaseServer.from("sms_daily_stats").upsert(
      {
        day_key: dayKey,
        total_users: stats.scanned,
        eligible: stats.eligible,
        sent: stats.sent,
        failed: stats.failed,
        retried: stats.retried,
        skipped_not_time: stats.skippedNotTime,
        skipped_missing_identity: stats.skippedMissingIdentity,
        skipped_already_completed: stats.skippedAlreadyCompleted,
        skipped_not_fully_on_v2: stats.skippedNotFullyOnV2Daily,
        user_loop_errors: stats.userLoopErrors,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "day_key" }
    );
  } catch (err) {
    console.error("[daily-sms] sms_daily_stats upsert failed:", err);
  }

  console.log("[daily-sms] run summary", {
    scanned: stats.scanned,
    audienceSelfHealMerged: stats.audienceSelfHealMerged,
    eligible: stats.eligible,
    reserved: stats.reserved,
    sent: stats.sent,
    skippedAlreadyCompleted: stats.skippedAlreadyCompleted,
    skippedOutOfWindow: stats.skippedNotTime,
    skippedPreferredWindowWaiting: stats.skippedPreferredWindowWaiting,
    skippedPastSafeLocalCutoff: stats.skippedPastSafeLocalCutoff,
    skippedAlreadySent: stats.alreadyReservedOrSentToday,
    skippedOptedOut: stats.skippedOptedOut,
    skippedCadence: stats.skippedCadence,
    skippedActiveInboundThread: stats.skippedActiveInboundThread,
    skippedNotFullyOnV2Daily: stats.skippedNotFullyOnV2Daily,
    failed: stats.failed,
    reservationErrors: stats.reservationErrors,
    userLoopErrors: stats.userLoopErrors,
    recoveredReserved: stats.recoveredReserved,
    expectedDailyAttemptUsers: stats.expectedDailyAttemptUsers,
    expectedNewActiveUsers: stats.expectedNewActiveUsers,
    expectedNormalActiveUsers: stats.expectedNormalActiveUsers,
    skippedIntentional: stats.skippedIntentional,
    skippedUnexpected: stats.skippedUnexpected,
    catchupEligible: stats.catchupEligible,
    catchupAttempted: stats.catchupAttempted,
    sendFailed: stats.sendFailed,
    twilioAccepted: stats.twilioAccepted,
  });
  console.log(
    JSON.stringify({
      event: "daily_sms_alert_metrics",
      day_key: dayKey,
      skipped_not_fully_on_v2: stats.skippedNotFullyOnV2Daily,
      user_loop_errors: stats.userLoopErrors,
      sent: stats.sent,
      failed: stats.failed,
      expected_daily_attempt_users: stats.expectedDailyAttemptUsers,
      expected_new_active_users: stats.expectedNewActiveUsers,
      expected_normal_active_users: stats.expectedNormalActiveUsers,
      catchup_eligible: stats.catchupEligible,
      catchup_attempted: stats.catchupAttempted,
      skipped_preferred_window_waiting: stats.skippedPreferredWindowWaiting,
      skipped_past_safe_local_cutoff: stats.skippedPastSafeLocalCutoff,
      skipped_intentional: stats.skippedIntentional,
      skipped_unexpected: stats.skippedUnexpected,
      twilio_accepted: stats.twilioAccepted,
    })
  );

  return NextResponse.json(stats);
}