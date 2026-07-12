/**
 * Daily SMS content builder — extracted from daily-sms cron route.
 * mode "send" preserves production side effects; mode "draft" is side-effect free for Tyler Text Overview.
 */
import { supabaseServer } from "@/lib/supabase-server";
import { SMS_DAILY_PRODUCTION_SEND_SLOT, type SmsDailySendSlot } from "@/lib/tyler-text-overview-types";
import { resolveSmsUserTimezone } from "@/lib/timezone";
import {
  deriveSmsGoalAdjustmentSignal,
  smsGoalAdjustmentShrinkOverlayEligible,
  type SmsGoalAdjustmentSignalResult,
} from "@/lib/sms-goal-adjustment-signal";
import {
  deriveSmsPatternSignal,
  smsPatternRecurrenceEligibleForDailyPurpose,
} from "@/lib/sms-pattern-signal";
import {
  dailyServerStrategyDuringPlannedInterruption,
  loadRecentPlannedInterruptionSignalForCommitment,
} from "@/lib/sms-planned-interruption";
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
  parseRefreshSession,
  shouldAbandonStaleIdentityStep,
  type V2RefreshOutboundPlan,
} from "@/lib/v2-refresh-session";
import { reconcileCheckSentPostSendBookkeepingForCommitment } from "@/lib/v2-outbound-check-sent";
import { loadV2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory";
import { parseCadenceLevelFromCheckSentPayload } from "@/lib/v2-reactivation";
import {
  buildSilenceCadenceNoSendLaneMeta,
  resolveSilenceCadenceForDailyUser,
  silenceCadenceOverridesOldSilenceRouting,
  toDailySilenceCadenceFacts,
} from "@/lib/sms-silence-cadence-v1";
import {
  deriveV2CadencePayload,
  shouldSendV2CadenceToday,
  type V2CadencePayload,
} from "@/lib/v2-cadence";
import {
  getActiveCommitment,
  getLastNV2CheckSentPayloads,
  getLastV2CheckSentForCommitment,
  getLatestBlockerCapturedAfter,
  getLatestV2AccountabilityOutcome,
  getRecentV2EventsForAi,
  type ActiveV2CommitmentRow,
  type V2EventRowForAi,
} from "@/lib/v2-commitment";
import {
  fetchV2UserSendTimeProfile,
  formatReachabilityContextLine,
} from "@/lib/v2-send-time-profile";
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
import { enrichDailyFactsCoreWithPendingPlanProof } from "@/lib/pending-plan-proof";
import { buildTimingAnchorBrainMetadata } from "@/lib/timing-anchor-memory";
import {
  buildCoachingBriefV1FromDailyFacts,
  compactCoachingBriefV1ForV3Brain,
} from "@/lib/coaching-brief-v1";
import {
  loadSmsVictoryBackgroundContext,
  mapSmsVictoryBackgroundToFacts,
  type V3VictoryBackgroundFacts,
} from "@/lib/sms-victory-background-context";
import { relationshipObservabilityFromLaneMetadata } from "@/lib/sms-relationship-packet-v1";
import {
  evaluateCommitmentEvolutionForSms,
  pickWave7DailyEvolutionAction,
  shouldSurfaceWave7EvolutionDailyPurpose,
} from "@/lib/v2-sms-evolution-signal";
import {
  buildCoachGoalEvolutionInviteTelemetry,
  countYesOutcomes7dForCoachInvite,
  evaluateCoachInitiatedGoalEvolutionInvite,
  mapCoachGoalEvolutionInviteToDailyFacts,
} from "@/lib/sms-coach-initiated-goal-evolution-invite";
import {
  buildPendingResolutionDailyReminderSms,
  clearPendingResolutionIfExpired,
  getPendingResolutionOrNull,
  isPendingResolutionExpired,
  shouldSkipPendingResolutionDailyReminderDueToRecentConfirmation,
  type V2SmsPendingResolutionPayload,
} from "@/lib/v2-guided-resolution";
import {
  deriveRecommitSameVisibleContractRoutePolicy,
  resolveDailySatisfiedAskContext,
  slimDailySatisfiedAskContextForTelemetry,
  type DailySatisfiedAskContext,
} from "@/lib/daily-satisfied-ask-context";
import { attachDailyNotebookVerdictToMetadata } from "@/lib/sms-daily-notebook-telemetry";
import { V3_BRAIN_VERSION } from "@/lib/v3-sms-brain";
import {
  buildDailyOutboundUnifiedGuardCtx,
  type DailyOutboundUnifiedGuardCtx,
} from "@/lib/daily-outbound-final-guard-evidence";
import {
  DAILY_SEMANTIC_CONTRACT_PROPOSAL_VERSION,
  DEFAULT_SEMANTIC_DAILY_CONTRACT_FORBIDDEN_PHRASES,
  type DailySemanticContractProposalFactsPacket,
} from "@/lib/v3-daily-contract-proposal-semantic";
import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";
import type { TylerTextOverviewWriterOpenAiCapture } from "@/lib/tyler-text-overview-writer-capture";
import type { DailySmsWritingBriefOverrides } from "@/lib/sms-daily-writing-brief-v1";

export type DailySmsBuildMode = "send" | "draft";

export type BuildDailySmsContentOptions = {
  mode?: DailySmsBuildMode;
  /**
   * Tyler Text Overview Phase 5: when main accountability lane returns no-send,
   * use this body for a guardable DailySmsBuilt shell (Tyler edit over machine no-send).
   */
  tylerTextOverviewOverrideBody?: string | null;
  /** Slot/daypart + morning anchor overrides for evening TTO preview (Phase 2B). */
  writingBriefOverrides?: DailySmsWritingBriefOverrides;
};

function dailyV3LaneInput(
  facts: Parameters<typeof produceDailyV3RelationshipSms>[0]["facts"],
  commitmentRow: Parameters<typeof produceDailyV3RelationshipSms>[0]["commitmentRow"],
  telemetry_fact_sources: string[],
  options?: BuildDailySmsContentOptions
): Parameters<typeof produceDailyV3RelationshipSms>[0] {
  return {
    facts,
    commitmentRow,
    telemetry_fact_sources,
    writing_brief_overrides: options?.writingBriefOverrides,
  };
}

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

export type DailySmsBuilt =
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
      /** Lane-built praise policy context for Final Voice Gate parity. */
      v3PraisePolicyContext?: Record<string, unknown>;
      /** Satisfied-ask truth fed into daily lane + post-FVG stale guard. */
      dailySatisfiedAskContext?: DailySatisfiedAskContext | null;
      /** Phase 2.3-C1 unified final guard evidence (main + reactivation only). */
      dailyUnifiedGuardCtx?: DailyOutboundUnifiedGuardCtx | null;
      /** Exact OpenAI writer notebook when V3 lane invoked (Tyler Text Overview capture). */
      writerOpenAiCapture?: TylerTextOverviewWriterOpenAiCapture | null;
    }
  | {
      ok: false;
      error: string;
      adaptiveProposalWithheldMeta?: Record<string, unknown>;
      dailyLaneMeta?: Record<string, unknown>;
      writerOpenAiCapture?: TylerTextOverviewWriterOpenAiCapture | null;
    };

function resolveDailySatisfiedAskFromPacket(args: {
  recentEvents: V2EventRowForAi[];
  packet: SmsRelationshipMemoryPacket;
}): DailySatisfiedAskContext | null {
  return resolveDailySatisfiedAskContext({
    eventsNewestFirst: args.recentEvents,
    latestOpenQuestion: args.packet.latest_open_question,
    latestAnswerAfterOpenQuestion: args.packet.latest_answer_after_open_question,
    openQuestionPending: args.packet.open_question_pending,
    doNotRepeatPhrases: args.packet.do_not_repeat_phrases.map((p) => p.phrase),
    lastInboundFullBody: args.packet.last_inbound_full_body,
    openQuestionExpectedAnswerType: args.packet.open_question_expected_answer_type,
  });
}

function attachDailySatisfiedAskToFacts(
  facts: DailyV3RelationshipFacts,
  args: { recentEvents: V2EventRowForAi[]; packet: SmsRelationshipMemoryPacket }
): DailyV3RelationshipFacts {
  return {
    ...facts,
    daily_satisfied_ask_context: resolveDailySatisfiedAskFromPacket(args),
  };
}

function inferDailyLaneSkipSource(metadata: Record<string, unknown>): string {
  if (typeof metadata.skip_source === "string" && metadata.skip_source.trim()) {
    return metadata.skip_source.trim();
  }
  if (metadata.lane_stage === "daily_stale_ask_guard_failed") return "stale_ask_no_send";
  if (metadata.lane_stage === "daily_thread_memory_repeat_guard_failed") {
    return "memory_repeat_no_send";
  }
  if (metadata.lane_stage === "post_validate_repair_failed") return "post_validate_repair_failed";
  if (metadata.skip_source === "unified_final_guard_no_send") return "unified_final_guard_no_send";
  return "lane_no_send";
}

function enrichDailyLaneNoSendMeta(
  metadata: Record<string, unknown>,
  noSendReason: string | null
): Record<string, unknown> {
  const merged = attachDailyNotebookVerdictToMetadata({
    ...metadata,
    no_send_reason: noSendReason,
    skip_source: inferDailyLaneSkipSource(metadata),
  });
  return merged;
}

function praisePolicyContextFromLaneMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> | undefined {
  const ctx = metadata.praise_policy_context;
  if (ctx && typeof ctx === "object" && !Array.isArray(ctx)) {
    return ctx as Record<string, unknown>;
  }
  return undefined;
}

export async function resolveV2BlockerPreviewForOutbound(args: {
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

export function buildStandardCheckSentPayload(args: {
  sendSlot?: SmsDailySendSlot;
  priorOutcome?: string | null;
  blockerPreview?: string | null;
  silence?: Record<string, unknown> | null;
  reentry?: Record<string, unknown> | null;
  nextMove?: Record<string, unknown> | null;
  ai?: Record<string, unknown> | null;
  cadence?: V2CadencePayload | null;
  contractProposal?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const sendSlot = args.sendSlot ?? SMS_DAILY_PRODUCTION_SEND_SLOT;
  return {
    send_slot: sendSlot,
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
export function withPresentedDailyContractProposalAuditFields(
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

export async function buildDailySmsContent(
  clerkUserId: string,
  md: Record<string, unknown>,
  accountabilityDayKey: string,
  audienceTimezone?: string | null,
  options?: BuildDailySmsContentOptions
): Promise<DailySmsBuilt> {
  const mode: DailySmsBuildMode = options?.mode ?? "send";
  const isDraftMode = mode === "draft";
  let active = await getActiveCommitment(clerkUserId);
  if (active?.behavior_statement?.trim()) {
    const tzResolved = resolveSmsUserTimezone({
      clerkMetadataTimezone: md.timezone,
      audienceTimezone,
    });
        const timezone = tzResolved.timezone;
    if (!isDraftMode) {
      await clearStaleAdaptiveContractColumns(active.id);
      try {
        const checkSentReconcile = await reconcileCheckSentPostSendBookkeepingForCommitment({
          commitmentId: active.id,
          clerkUserId,
        });
        if (checkSentReconcile.failures > 0) {
          console.warn("[daily-sms-build] check_sent reconcile unresolved", {
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
        console.error("[daily-sms-build] check_sent post-send reconcile failed", {
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
          console.warn("[daily-sms-build] refresh reconcile unresolved", {
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
        console.error("[daily-sms-build] refresh post-send reconcile failed", {
          clerk_user_id: clerkUserId,
          commitment_id: active.id,
          message: e instanceof Error ? e.message : String(e),
        });
      }
      const refreshed = await getActiveCommitment(clerkUserId);
      if (refreshed?.behavior_statement?.trim()) {
        active = refreshed;
      }
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

    const silenceCadenceResult = await resolveSilenceCadenceForDailyUser({
      clerkUserId,
      commitmentId: active.id,
      commitmentStartedAt: active.started_at,
      todayLocalDayKey: accountabilityDayKey,
      timezone,
    });
    const silenceCadenceFacts = toDailySilenceCadenceFacts(silenceCadenceResult);

    if (!silenceCadenceResult.send_today) {
      return {
        ok: false,
        error: "silence_cadence_no_send",
        dailyLaneMeta: buildSilenceCadenceNoSendLaneMeta(silenceCadenceResult),
      };
    }

    const [latestOutcome, recentEvents] = await Promise.all([
      getLatestV2AccountabilityOutcome(active.id),
      getRecentV2EventsForAi(active.id),
    ]);

    let refreshSessionParsed = parseRefreshSession(active.refresh_session);
    let refreshStaleSessionAbandonedBeforeBuild = false;
    let pendingExpiredClearedBeforeBuild = false;
    if (
      refreshSessionParsed &&
      shouldAbandonStaleIdentityStep(refreshSessionParsed, now.getTime())
    ) {
      refreshStaleSessionAbandonedBeforeBuild = true;
      if (!isDraftMode) {
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
    }

    if (refreshSessionParsed?.step === "identity") {
      return { ok: false, error: "v2_refresh_identity_await_reply" };
    }

    let clearedPending = false;
    if (!isDraftMode) {
      clearedPending = await clearPendingResolutionIfExpired(active.id, active, now.getTime());
      if (clearedPending) {
        pendingExpiredClearedBeforeBuild = true;
        const reloadedAfterPending = await getActiveCommitment(clerkUserId);
        if (reloadedAfterPending?.behavior_statement?.trim()) {
          active = reloadedAfterPending;
        }
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
      exactThreadPath: "daily",
        clerkUserId,
        commitmentId: active.id,
        timezone,
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
        relationship_anchor_sources: relationshipMemoryPacketPr.relationship_anchor_sources,
      };
      const suggestedPr = deriveSuggestedCoachingMoveForDailyFacts(factsCorePr);
      const factsPr: DailyV3RelationshipFacts = attachDailySatisfiedAskToFacts(
        {
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
        },
        { recentEvents, packet: relationshipMemoryPacketPr }
      );
      const remTemplate = buildPendingResolutionDailyReminderSms(active);
      const lanePr = await produceDailyV3RelationshipSms(
        dailyV3LaneInput(factsPr, active, [
          "getPendingResolutionOrNull",
          "getEffectiveCoachingAsk",
          "loadV2CoachingMemoryForPrompt",
          "buildV2SmsConversationContextPack",
          "buildPendingResolutionDailyReminderSms",
        ], options)
      );
      if (!lanePr.shouldSend || !lanePr.body.trim()) {
        return {
          ok: false,
          error: "daily_v3_lane_no_send",
          dailyLaneMeta: enrichDailyLaneNoSendMeta(lanePr.metadata, lanePr.noSendReason),
          writerOpenAiCapture: lanePr.writerOpenAiCapture ?? null,
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
            ...relationshipObservabilityFromLaneMetadata(lanePr.metadata),
            v3_candidate_body: (lanePr.metadata.v3_candidate_body as string | undefined) ?? lanePr.body,
            old_daily_writer_used_as_voice: false,
            old_daily_writer_fact_sources: lanePr.metadata.old_daily_writer_fact_sources,
            daily_facts_summary: lanePr.metadata.daily_facts_summary,
            suggested_coaching_move: lanePr.metadata.suggested_coaching_move,
            route_purpose: "pending_resolution",
            voice_writer_chain: ["v3_daily_relationship_lane", "north_star_validator", "final_voice_gate"],
            coaching_brief_v1: compactCoachingBriefV1ForV3Brain(
              buildCoachingBriefV1FromDailyFacts(factsPr)
            ),
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
        v3PraisePolicyContext: praisePolicyContextFromLaneMetadata(lanePr.metadata),
        dailySatisfiedAskContext: factsPr.daily_satisfied_ask_context ?? null,
        dailyUnifiedGuardCtx: buildDailyOutboundUnifiedGuardCtx({
          routeKind: "pending_resolution",
          clerkUserId,
          commitmentId: active.id,
          priorCoachBody: relationshipMemoryPacketPr.last_outbound_full_body,
          priorCoachSentAt: null,
          lastInboundBody: relationshipMemoryPacketPr.last_inbound_full_body,
          priorOutcome: latestOutcome?.type ?? null,
          pendingPlanProof: null,
          proofOrMilestoneSignal: null,
          pendingResolutionFacts: {
            resolutionKind: pr?.kind ?? null,
            smsState: smsStatePr,
            candidateSnippet: candidateSnippetPr,
            awaitingUserConfirmation: awaitingConfirmationPr,
            canonicalBehaviorStatement: active.behavior_statement.trim(),
            requiredVerbatimSubstrings: verbatimPr,
            pendingExpiredClearedBeforeBuild,
          },
        }),
        writerOpenAiCapture: lanePr.writerOpenAiCapture ?? null,
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
      exactThreadPath: "daily",
          clerkUserId,
          commitmentId: active.id,
          timezone,
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
          relationship_anchor_sources: relationshipMemoryPacketRf.relationship_anchor_sources,
        };
        const suggestedRf = deriveSuggestedCoachingMoveForDailyFacts(factsCoreRf);
        const factsRf: DailyV3RelationshipFacts = attachDailySatisfiedAskToFacts(
          {
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
          },
          { recentEvents, packet: relationshipMemoryPacketRf }
        );
        const laneRf = await produceDailyV3RelationshipSms(
          dailyV3LaneInput(factsRf, active, [
            "computeWave1ColdStartRefreshEligible",
            "buildRefreshStepIdentitySms",
            "loadV2CoachingMemoryForPrompt",
            "buildV2SmsConversationContextPack",
            "deriveV2CoachingState",
            "deriveV2SilenceContext",
            "deriveV2ReentryContext",
          ], options)
        );
        if (!laneRf.shouldSend || !laneRf.body.trim()) {
          return {
            ok: false,
            error: "daily_v3_lane_no_send",
            dailyLaneMeta: enrichDailyLaneNoSendMeta(laneRf.metadata, laneRf.noSendReason),
            writerOpenAiCapture: laneRf.writerOpenAiCapture ?? null,
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
              ...relationshipObservabilityFromLaneMetadata(laneRf.metadata),
              v3_candidate_body: (laneRf.metadata.v3_candidate_body as string | undefined) ?? laneRf.body,
              old_daily_writer_used_as_voice: false,
              old_daily_writer_fact_sources: laneRf.metadata.old_daily_writer_fact_sources,
              daily_facts_summary: laneRf.metadata.daily_facts_summary,
              suggested_coaching_move: laneRf.metadata.suggested_coaching_move,
              route_purpose: "refresh_identity",
              voice_writer_chain: ["v3_daily_relationship_lane", "north_star_validator", "final_voice_gate"],
              coaching_brief_v1: compactCoachingBriefV1ForV3Brain(
                buildCoachingBriefV1FromDailyFacts(factsRf)
              ),
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
          v3PraisePolicyContext: praisePolicyContextFromLaneMetadata(laneRf.metadata),
          dailySatisfiedAskContext: factsRf.daily_satisfied_ask_context ?? null,
          dailyUnifiedGuardCtx: buildDailyOutboundUnifiedGuardCtx({
            routeKind: "refresh_identity",
            clerkUserId,
            commitmentId: active.id,
            priorCoachBody: relationshipMemoryPacketRf.last_outbound_full_body,
            priorCoachSentAt: null,
            lastInboundBody: relationshipMemoryPacketRf.last_inbound_full_body,
            priorOutcome: latestOutcome?.type ?? null,
            pendingPlanProof: null,
            proofOrMilestoneSignal: null,
            refreshGuardFacts: {
              refreshStep: "identity_first",
              identityAnchorText: anchorTrim || null,
              requiredVerbatimSubstrings: verbatimRf,
              refreshStaleSessionAbandonedBeforeBuild,
            },
          }),
          writerOpenAiCapture: laneRf.writerOpenAiCapture ?? null,
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
      exactThreadPath: "daily",
          clerkUserId,
          commitmentId: active.id,
          timezone,
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
          relationship_anchor_sources: relationshipMemoryPacketC.relationship_anchor_sources,
        };
        const suggestedC = deriveSuggestedCoachingMoveForDailyFacts(factsCoreC);
        const factsC: DailyV3RelationshipFacts = attachDailySatisfiedAskToFacts(
          {
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
          },
          { recentEvents, packet: relationshipMemoryPacketC }
        );
        const laneC = await produceDailyV3RelationshipSms(
          dailyV3LaneInput(factsC, active, [
            "buildRefreshStepCommitmentSms",
            "getEffectiveCoachingAsk",
            "loadV2CoachingMemoryForPrompt",
            "buildV2SmsConversationContextPack",
            "deriveV2CoachingState",
            "deriveV2SilenceContext",
            "deriveV2ReentryContext",
          ], options)
        );
        if (!laneC.shouldSend || !laneC.body.trim()) {
          return {
            ok: false,
            error: "daily_v3_lane_no_send",
            dailyLaneMeta: enrichDailyLaneNoSendMeta(laneC.metadata, laneC.noSendReason),
            writerOpenAiCapture: laneC.writerOpenAiCapture ?? null,
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
              ...relationshipObservabilityFromLaneMetadata(laneC.metadata),
              v3_candidate_body: (laneC.metadata.v3_candidate_body as string | undefined) ?? laneC.body,
              old_daily_writer_used_as_voice: false,
              old_daily_writer_fact_sources: laneC.metadata.old_daily_writer_fact_sources,
              daily_facts_summary: laneC.metadata.daily_facts_summary,
              suggested_coaching_move: laneC.metadata.suggested_coaching_move,
              route_purpose: "refresh_commitment",
              voice_writer_chain: ["v3_daily_relationship_lane", "north_star_validator", "final_voice_gate"],
              coaching_brief_v1: compactCoachingBriefV1ForV3Brain(
                buildCoachingBriefV1FromDailyFacts(factsC)
              ),
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
          v3PraisePolicyContext: praisePolicyContextFromLaneMetadata(laneC.metadata),
          dailySatisfiedAskContext: factsC.daily_satisfied_ask_context ?? null,
          dailyUnifiedGuardCtx: buildDailyOutboundUnifiedGuardCtx({
            routeKind: "refresh_commitment",
            clerkUserId,
            commitmentId: active.id,
            priorCoachBody: relationshipMemoryPacketC.last_outbound_full_body,
            priorCoachSentAt: null,
            lastInboundBody: relationshipMemoryPacketC.last_inbound_full_body,
            priorOutcome: latestOutcome?.type ?? null,
            pendingPlanProof: null,
            proofOrMilestoneSignal: null,
            refreshGuardFacts: {
              refreshStep: "commitment_daily",
              effectiveAskForBar: askTrim || null,
              requiredVerbatimSubstrings: verbatimC,
              refreshStaleSessionAbandonedBeforeBuild,
            },
          }),
          writerOpenAiCapture: laneC.writerOpenAiCapture ?? null,
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

    const relationshipMemoryPacketMain = await buildSmsRelationshipMemoryPacket({
      exactThreadPath: "daily",
      clerkUserId,
      commitmentId: active.id,
      timezone,
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
    if (silenceCadenceOverridesOldSilenceRouting(silenceCadenceFacts)) {
      serverStrategy = baseStrategy;
    }
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

    const sameBaseRecommitBarText = active.behavior_statement.trim();
    const earlySatisfiedAskContext = resolveDailySatisfiedAskFromPacket({
      recentEvents,
      packet: relationshipMemoryPacketMain,
    });
    const recommitRoutePolicy = deriveRecommitSameVisibleContractRoutePolicy({
      nextMoveType: nextMove.type,
      satisfiedAskContext: earlySatisfiedAskContext,
      proposedBarText: sameBaseRecommitBarText,
      baseBehaviorStatement: sameBaseRecommitBarText,
    });
    const recommitProposalMode = recommitRoutePolicy.recommitProposalMode;
    const recommitSameSuppressedForSatisfiedPlan =
      recommitRoutePolicy.recommitSameSuppressedForSatisfiedPlan;
    const recommitSameSuppressionReason = recommitRoutePolicy.recommitSameSuppressionReason;
    const recommitSameVisibleContractSuppressed =
      recommitRoutePolicy.recommitSameVisibleContractSuppressed;
    const recommitSameVisibleContractSuppressionReason =
      recommitRoutePolicy.recommitSameVisibleContractSuppressionReason;

    const contractProposalMode = shrinkProposalMode || recommitProposalMode;
    const contractProposalKind: V2AdaptiveContractKind | null = shrinkProposalMode
      ? "shrink_ask"
      : null;

    const canonicalDailyProposalAsk: string | null =
      contractProposalMode && contractProposalKind === "shrink_ask"
        ? (computeCanonicalShrinkProposalAskFromBehavior(active.behavior_statement) ??
            active.behavior_statement.trim()).trim()
        : null;

    const outboundNextMove: V2NextMoveKind =
      (nextMove.type === "shrink_ask" && !shrinkProposalMode) ||
      recommitRoutePolicy.useHoldStandardOutboundNextMove
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

    const dailyPurposeRaw = deriveV2DailyMessagePurpose({
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
    const dailyPurpose = silenceCadenceOverridesOldSilenceRouting(silenceCadenceFacts)
      ? ("standard_accountability_check" as const)
      : dailyPurposeRaw;

    const evolutionHint =
      dailyPurpose === "evolution_pattern_check" && wave7Pick
        ? `${wave7Pick.action}:${wave7Pick.evidenceSummary ?? ""}`.slice(0, 280)
        : null;

    const routeKind: DailyV3RouteKind = contractProposalMode ? "contract_prompt" : "main_active_accountability";
    const canonicalProposalAskTrim = typeof canonicalDailyProposalAsk === "string" ? canonicalDailyProposalAsk.trim() : "";
    const requiredVerbatimMain: string[] = [];

    const coachGoalEvolutionInviteEvalRaw = evaluateCoachInitiatedGoalEvolutionInvite({
      commitment: active,
      routeKind,
      yesStreak14d: coachingMemoryRow?.yes_streak_14d ?? null,
      yesCount7d: countYesOutcomes7dForCoachInvite(recentEvents, now.getTime()),
      negativeOutcomes14d:
        (coachingMemoryRow?.no_count_14d ?? 0) + (coachingMemoryRow?.partial_count_14d ?? 0),
      goalAdjustmentSignal,
      patternSignal,
      evolutionEvaluation: evolutionEvaluationForGate,
      plannedInterruptionActive,
      refreshSessionActive,
      overlayActive: overlayActiveForGate,
      adaptiveProposalPending: proposalPendingForGate,
      contractProposalMode,
      shrinkOverlayEligible: shrinkProposalMode,
      nextMoveShrinkAsk: outboundNextMove === "shrink_ask",
      eventsNewestFirst: recentEvents,
      nowMs: now.getTime(),
    });
    const coachGoalEvolutionInviteEval =
      dailyPurpose === "evolution_pattern_check" && coachGoalEvolutionInviteEvalRaw.should_invite
        ? {
            ...coachGoalEvolutionInviteEvalRaw,
            invite_detected: false,
            invite_kind: "none" as const,
            invite_source: "none" as const,
            should_invite: false,
            coach_goal_evolution_action: "defer" as const,
            hold_standard_reason: "evolution_pattern_check_day",
            evidence_summary: null,
          }
        : coachGoalEvolutionInviteEvalRaw;
    const coachGoalEvolutionInviteFacts = mapCoachGoalEvolutionInviteToDailyFacts(
      coachGoalEvolutionInviteEval
    );
    const coachGoalEvolutionInviteTelemetry =
      buildCoachGoalEvolutionInviteTelemetry(coachGoalEvolutionInviteEval);

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
        coach_goal_evolution_invite: coachGoalEvolutionInviteFacts,
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
      relationship_anchor_sources: relationshipMemoryPacketMain.relationship_anchor_sources,
      silence_cadence: silenceCadenceFacts,
    };
    const factsCoreWithPlanProof = enrichDailyFactsCoreWithPendingPlanProof(factsCoreUnified, {
      eventsNewestFirst: recentEvents,
      openQuestionAnsweredAt: relationshipMemoryPacketMain.open_question_answered_at,
      userAnswersNewestFirst: relationshipMemoryPacketMain.last_5_user_answers.map((a) => ({
        text: a.text,
        answered_at: a.answered_at,
      })),
    });
    const suggestedUnified = deriveSuggestedCoachingMoveForDailyFacts(factsCoreWithPlanProof);
    const factsUnified: DailyV3RelationshipFacts = attachDailySatisfiedAskToFacts(
      {
        ...factsCoreWithPlanProof,
        suggested_coaching_move: suggestedUnified,
        constraints: {
          max_chars: 300,
          one_sms: true,
          no_raw_title_or_behavior_paste: true,
          no_generic_motivation: true,
          if_unsafe_return_no_send: true,
          ...(requiredVerbatimMain.length ? { required_verbatim_substrings: requiredVerbatimMain } : {}),
        },
      },
      { recentEvents, packet: relationshipMemoryPacketMain }
    );
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
      "evaluateCoachInitiatedGoalEvolutionInvite",
    ];
    if (contractProposalMode && contractProposalKind === "shrink_ask") {
      telemetryUnified.push("buildV2ShrinkProposalOutboundSms");
    } else {
      telemetryUnified.push("buildV2OutboundAccountabilitySmsForStrategy");
    }

    const laneUnified = await produceDailyV3RelationshipSms(
      dailyV3LaneInput(factsUnified, active, telemetryUnified, options)
    );
    if (!laneUnified.shouldSend || !laneUnified.body.trim()) {
      const tylerOverrideBody = options?.tylerTextOverviewOverrideBody?.trim();
      if (
        tylerOverrideBody &&
        routeKind === "main_active_accountability" &&
        !contractProposalMode
      ) {
        smsBody = tylerOverrideBody;
      } else {
        return {
          ok: false,
          error: "daily_v3_lane_no_send",
          dailyLaneMeta: enrichDailyLaneNoSendMeta(laneUnified.metadata, laneUnified.noSendReason),
          writerOpenAiCapture: laneUnified.writerOpenAiCapture ?? null,
        };
      }
    } else {
      smsBody = laneUnified.body;
    }
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
        ...relationshipObservabilityFromLaneMetadata(laneUnified.metadata),
        v3_candidate_body: (laneUnified.metadata.v3_candidate_body as string | undefined) ?? laneUnified.body,
        old_daily_writer_used_as_voice: false,
        old_daily_writer_fact_sources: laneUnified.metadata.old_daily_writer_fact_sources,
        daily_facts_summary: laneUnified.metadata.daily_facts_summary,
        suggested_coaching_move: laneUnified.metadata.suggested_coaching_move,
        route_purpose: routeKind,
        voice_writer_chain: ["v3_daily_relationship_lane", "north_star_validator", "final_voice_gate"],
        ...buildTimingAnchorBrainMetadata(
          factsUnified.accountability.timing_anchor_memory,
          factsUnified.accountability.pending_plan_proof
        ),
        coaching_brief_v1: compactCoachingBriefV1ForV3Brain(
          buildCoachingBriefV1FromDailyFacts(factsUnified)
        ),
        silence_cadence_route: silenceCadenceFacts.route,
        silence_day: silenceCadenceFacts.silence_day,
        send_today: silenceCadenceFacts.send_today,
        ...coachGoalEvolutionInviteTelemetry,
        ...(recommitSameVisibleContractSuppressed
          ? {
              recommit_same_visible_contract_suppressed: true,
              recommit_same_visible_contract_suppression_reason:
                recommitSameVisibleContractSuppressionReason,
              ...(recommitSameSuppressedForSatisfiedPlan
                ? {
                    recommit_same_suppressed_for_satisfied_plan: true,
                    recommit_same_suppression_reason: recommitSameSuppressionReason,
                  }
                : {}),
            }
          : {}),
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
    if (recommitSameVisibleContractSuppressed) {
      nextMovePayload.recommit_same_visible_contract_suppressed = true;
      nextMovePayload.recommit_same_visible_contract_suppression_reason =
        recommitSameVisibleContractSuppressionReason;
      if (recommitSameSuppressedForSatisfiedPlan) {
        nextMovePayload.recommit_same_suppressed_for_satisfied_plan = true;
        nextMovePayload.recommit_same_suppression_reason = recommitSameSuppressionReason;
      }
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
      v3PraisePolicyContext: praisePolicyContextFromLaneMetadata(laneUnified.metadata),
      dailySatisfiedAskContext: factsUnified.daily_satisfied_ask_context ?? null,
      dailyUnifiedGuardCtx:
        routeKind === "main_active_accountability"
          ? buildDailyOutboundUnifiedGuardCtx({
              routeKind: "main_active_accountability",
              clerkUserId,
              commitmentId: active.id,
              priorCoachBody: relationshipMemoryPacketMain.last_outbound_full_body,
              priorCoachSentAt: null,
              lastInboundBody: relationshipMemoryPacketMain.last_inbound_full_body,
              priorOutcome: latestOutcome?.type ?? null,
              pendingPlanProof: factsUnified.accountability.pending_plan_proof ?? null,
              proofOrMilestoneSignal: factsUnified.accountability.proof_or_milestone_signal ?? null,
            })
          : routeKind === "contract_prompt" &&
              contractProposalKind &&
              contractSemanticFacts &&
              canonicalProposalAskTrim
            ? buildDailyOutboundUnifiedGuardCtx({
                routeKind: "contract_prompt",
                clerkUserId,
                commitmentId: active.id,
                priorCoachBody: relationshipMemoryPacketMain.last_outbound_full_body,
                priorCoachSentAt: null,
                lastInboundBody: relationshipMemoryPacketMain.last_inbound_full_body,
                priorOutcome: latestOutcome?.type ?? null,
                pendingPlanProof: factsUnified.accountability.pending_plan_proof ?? null,
                proofOrMilestoneSignal: factsUnified.accountability.proof_or_milestone_signal ?? null,
                proposalKind: contractProposalKind,
                contractSemanticFacts,
                canonicalProposalAskTrim,
                baseBehaviorStatement: active.behavior_statement.trim(),
                proposalPending: false,
              })
            : null,
      writerOpenAiCapture: laneUnified.writerOpenAiCapture ?? null,
    };
  }

  console.warn("[daily-sms][v2-only] build_daily_sms_not_fully_on_v2", {
    clerk_user_id: clerkUserId,
    day_key: accountabilityDayKey,
    note: "legacy_daily_sms_removed_pr6",
  });
  return { ok: false, error: "not_fully_on_v2_daily_sms" };
}