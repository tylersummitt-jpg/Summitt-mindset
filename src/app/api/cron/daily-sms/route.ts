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
  buildCheckSentAiPayload,
  deriveV2CoachingState,
  deriveV2DailyMessagePurpose,
  deriveV2NextMove,
  deriveV2ReentryContext,
  deriveV2SilenceContext,
  pickV2OutboundStrategy,
  resolveV2DailyOutboundSmsBody,
  resolveV2OutboundStrategyAfterBase,
  templateFamilyForStrategy,
  V2_OUTBOUND_AI_MODEL,
  V2_OUTBOUND_AI_PROMPT_VERSION,
} from "@/lib/v2-ai-outbound";
import {
  buildV2OutboundAccountabilitySmsForStrategy,
  buildV2RecommitProposalOutboundSms,
  buildV2ShrinkProposalOutboundSms,
  type V2NextMoveKind,
} from "@/lib/v2-sms-accountability";
import {
  clearStaleAdaptiveContractColumns,
  computeRecommitBindingText,
  computeShrinkProposalText,
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
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";
import { fetchPendingEvolutionRecommendation } from "@/lib/v2-commitment-evolution-recommendation";
import { buildV2SmsConversationContextPack } from "@/lib/v2-sms-conversation-context";
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
} from "@/lib/v2-guided-resolution";
import type { NorthStarCoachChannel } from "@/lib/north-star-coach-sms";
import { buildDailyOutboundNorthStarContextPacket } from "@/lib/north-star-sms-context-packet";
import { finalizeNorthStarCoachSmsAsync } from "@/lib/north-star-coach-sms-openai";
import {
  generateV3DailyCheckIn,
  generateV3DailyDeterministicFallback,
  V3_BRAIN_VERSION,
} from "@/lib/v3-sms-brain";
import { applyFinalVoiceOwnershipGate } from "@/lib/v3-sms-voice-ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;
const ENV_SMS_DRY_RUN = process.env.SMS_DRY_RUN === "true";

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
    }
  | { ok: false; error: string };

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
      built.v3DailySms === true
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
      built.v3DailySms === true
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
  });
  const out: Extract<DailySmsBuilt, { ok: true }> = {
    ...built,
    smsBody: voiceGate.body,
  };
  out.v2AiPayload = {
    ...(built.v2AiPayload && typeof built.v2AiPayload === "object" ? built.v2AiPayload : {}),
    north_star_gate: {
      original_body: ns.meta.originalBody,
      final_body: voiceGate.body,
      north_star_gate_source: ns.meta.source,
      north_star_gate_reasons: ns.meta.blockedReasons,
      openai_attempted: ns.meta.openaiAttempted,
      openai_failed_reason: ns.meta.openaiFailedReason ?? null,
      context_packet_used: ns.meta.contextPacketUsed,
      finalizer_version: ns.meta.finalizerVersion,
    },
    final_voice_gate: voiceGate.metadata,
  };
  return out;
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
        .select("preferred_name, life_desires")
        .eq("clerk_user_id", clerkUserId)
        .maybeSingle();

      const preferredNameRe =
        typeof profileRowRe?.preferred_name === "string" ? profileRowRe.preferred_name : null;
      const lifeDesiresRe =
        typeof profileRowRe?.life_desires === "string" ? profileRowRe.life_desires : null;

      const coachingMemoryRe = await loadV2CoachingMemoryForPrompt(active.id);

      let recentSmsContextBlock: string | null = null;
      try {
        const convPack = await buildV2SmsConversationContextPack({
          clerkUserId,
          commitmentId: active.id,
          commitment: active,
          timezone,
          preloadedCoachingMemory: coachingMemoryRe,
          preloadedEventsNewestFirst: recentEvents,
        });
        recentSmsContextBlock = convPack.promptBlock;
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
        overlayActive: isV2AdaptiveOverlayActive(active, now.getTime()),
        hasBlockerPreview: false,
        eventsNewestFirst: recentEvents,
        coachingMemory: coachingMemoryRe,
        commitmentStartedAt: active.started_at,
        nowMs: now.getTime(),
        wave7SurfaceEvolution: false,
      });

      const { body: templateBodyRe, templateId: templateIdRe } =
        buildV2OutboundAccountabilitySmsForStrategy({
          clerkUserId,
          dayKey: accountabilityDayKey,
          behaviorStatement: active.behavior_statement,
          serverStrategy: "reactivation_nudge",
          nextMove: "hold_standard",
        });

      const resolvedRe = await resolveV2DailyOutboundSmsBody({
        ctx: {
          commitment: active,
          eventsNewestFirst: recentEvents,
          blockerPreview: null,
          serverState,
          serverStrategy: "reactivation_nudge",
          templateFamily: "reactivation",
          silence: silenceCtx,
          reentry: reentryCtx,
          nextMove: holdNextMove,
          cadence: pausedCadence,
          effectiveCoachingAsk: active.behavior_statement.trim(),
          contractProposalMode: false,
          contractProposalBindingText: null,
          coachingMemory: coachingMemoryRe,
          preferredName: preferredNameRe,
          lifeDesires: lifeDesiresRe,
          identityAnchorText: null,
          identityRefreshDue: false,
          identityReferenceAllowed: false,
          reachabilityContextLine,
          dailyMessagePurpose: dailyPurposeRe,
          recentSmsContextBlock,
        },
        contractProposalMode: false,
        purpose: dailyPurposeRe,
        templateBody: templateBodyRe,
        effectiveAsk: active.behavior_statement.trim(),
        behaviorStatement: active.behavior_statement,
        nextMoveType: "hold_standard",
        shrunkAskText: null,
      });

      let smsBodyRe = resolvedRe.smsBody;
      let v3DailySmsRe = false;
      let v3DailyDeterministicFallbackRe = false;
      const dailyCheckArgsRe = {
        commitmentId: active.id,
        effectiveAsk: active.behavior_statement.trim(),
        behaviorStatement: active.behavior_statement ?? "",
        priorOutcome: null,
        coachingMemory: coachingMemoryRe,
        serverStrategy: "reactivation_nudge",
        silenceTier: silenceCtx.tier,
        blockerPreview: null,
        recentSmsContextBlock,
        preferredName: preferredNameRe,
        identityAnchor: null,
        recentEventsNewestFirst: recentEvents,
        dailyPurpose: dailyPurposeRe,
        contractProposalKind: undefined,
        contractBindingText: undefined,
        evolutionPatternHint: undefined,
        resolvedTemplateFallback: resolvedRe.smsBody,
      };
      try {
        const v3dRe = await generateV3DailyCheckIn(dailyCheckArgsRe);
        smsBodyRe = v3dRe.text;
        v3DailySmsRe = true;
        v3DailyDeterministicFallbackRe = !v3dRe.openAiOk;
      } catch (e) {
        console.warn("[v3-sms-brain] reactivation_daily_check_failed", {
          commitment_id: active.id,
          message: e instanceof Error ? e.message : String(e),
        });
        smsBodyRe = generateV3DailyDeterministicFallback(dailyCheckArgsRe);
        v3DailySmsRe = true;
        v3DailyDeterministicFallbackRe = true;
      }
      const aiTryRe = resolvedRe.aiTry;
      const aiPayloadRe = {
        ...buildCheckSentAiPayload({
          model: V2_OUTBOUND_AI_MODEL,
          promptVersion: V2_OUTBOUND_AI_PROMPT_VERSION,
          serverState,
          serverStrategy: "reactivation_nudge",
          message: smsBodyRe,
          confidence: aiTryRe.ok ? aiTryRe.confidence : null,
          fallbackUsed: !aiTryRe.ok,
          ...(!aiTryRe.ok ? { fallbackReason: aiTryRe.reason } : {}),
          dailyResolution: resolvedRe.resolution,
        }),
        reply_source: v3DailyDeterministicFallbackRe
          ? "v3_daily_deterministic_fallback"
          : "v3_daily_check_in",
        v3_brain: {
          v3_brain_version: V3_BRAIN_VERSION,
          v3_coach_reply_source: v3DailyDeterministicFallbackRe
            ? "v3_daily_deterministic_fallback"
            : "v3_daily_check_in",
          v3_memory_used: true,
          v3_daily_purpose: dailyPurposeRe,
          v3_deterministic_fallback_used: v3DailyDeterministicFallbackRe,
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
        v3DailySms: v3DailySmsRe,
        v3DailyDeterministicFallback: v3DailyDeterministicFallbackRe,
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
      const rem = buildPendingResolutionDailyReminderSms(active);
      console.info("[daily-sms] pending_resolution_reminder_selected", {
        clerk_user_id: clerkUserId,
        commitment_id: active.id,
      });
      return {
        ok: true,
        smsBody: rem.body,
        deliveryStateSnapshot: null,
        day2SpecialUsed: false,
        v2Accountability: true,
        v2CommitmentId: active.id,
        v2TemplateId: rem.templateId,
        v2TemplateFamily: "standard",
        v2PriorOutcome: latestOutcome?.type ?? null,
        v2BlockerPreview: null,
        v2AiPayload: null,
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
        v2EffectiveAskText: null,
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
        const { body: refreshIdentityBody, templateId: refreshTid } =
          buildRefreshStepIdentitySms({ identityAnchorText: identityAnchorForRefresh });

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

        return {
          ok: true,
          smsBody: refreshIdentityBody,
          deliveryStateSnapshot: null,
          day2SpecialUsed: false,
          v2Accountability: true,
          v2CommitmentId: active.id,
          v2TemplateId: refreshTid,
          v2TemplateFamily: templateFamilyForStrategy(stratR),
          v2PriorOutcome: latestOutcome?.type ?? null,
          v2BlockerPreview: blockerPreviewR,
          v2AiPayload: null,
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
        };
      }

      if (
        refreshSessionParsed?.step === "commitment" &&
        !refreshSessionParsed.commitment_prompt_delivered
      ) {
        const effectiveAskR = getEffectiveCoachingAsk(active, now.getTime());
        const { body: refreshCommitBody, templateId: refreshCommitTid } =
          buildRefreshStepCommitmentSms({ effectiveAsk: effectiveAskR });

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

        return {
          ok: true,
          smsBody: refreshCommitBody,
          deliveryStateSnapshot: null,
          day2SpecialUsed: false,
          v2Accountability: true,
          v2CommitmentId: active.id,
          v2TemplateId: refreshCommitTid,
          v2TemplateFamily: templateFamilyForStrategy(stratC),
          v2PriorOutcome: latestOutcome?.type ?? null,
          v2BlockerPreview: blockerPreviewC,
          v2AiPayload: null,
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
        };
      }
    }

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
    const serverStrategy = resolveV2OutboundStrategyAfterBase({
      baseStrategy,
      silence: silenceCtx,
      reentry: reentryCtx,
    });
    const templateFamily = templateFamilyForStrategy(serverStrategy);

    const effectiveAsk = getEffectiveCoachingAsk(active, now.getTime());
    const refreshSessionActive = isRefreshSessionActive(active);
    const shrinkProposalMode =
      nextMove.type === "shrink_ask" &&
      !isV2AdaptiveOverlayActive(active, now.getTime()) &&
      !isV2PendingProposalValid(active, now.getTime()) &&
      !refreshSessionActive;

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

    const proposalBindingText =
      contractProposalMode && contractProposalKind === "shrink_ask"
        ? computeShrinkProposalText(active.behavior_statement)
        : contractProposalMode && contractProposalKind === "recommit_same"
          ? computeRecommitBindingText(active.behavior_statement)
          : null;

    const outboundNextMove: V2NextMoveKind =
      (nextMove.type === "shrink_ask" && !shrinkProposalMode) ||
      (nextMove.type === "recommit_same" && !recommitProposalMode)
        ? "hold_standard"
        : nextMove.type;

    const { body: templateBody, templateId } =
      contractProposalMode && proposalBindingText && contractProposalKind === "shrink_ask"
        ? await buildV2ShrinkProposalOutboundSms({
            clerkUserId,
            dayKey: accountabilityDayKey,
            proposalBindingText,
            originalBehaviorStatement: active.behavior_statement,
            v3Refine: { commitment: active, timezone },
          })
        : contractProposalMode && proposalBindingText && contractProposalKind === "recommit_same"
          ? await buildV2RecommitProposalOutboundSms({
              clerkUserId,
              dayKey: accountabilityDayKey,
              proposalBindingText,
              originalBehaviorStatement: active.behavior_statement,
              v3Refine: { commitment: active, timezone },
            })
          : buildV2OutboundAccountabilitySmsForStrategy({
              clerkUserId,
              dayKey: accountabilityDayKey,
              behaviorStatement: effectiveAsk,
              serverStrategy,
              nextMove: outboundNextMove,
              shrunkAskText:
                outboundNextMove === "shrink_ask" ? (nextMove.shrunk_ask_text ?? null) : null,
            });

    const { data: profileRow } = await supabaseServer
      .from("user_profiles")
      .select(
        "preferred_name, life_desires, people_summary, responsibility, identity_anchor_text, identity_source, identity_refresh_due_at, identity_last_referenced_at"
      )
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();

    const preferredName =
      typeof profileRow?.preferred_name === "string" ? profileRow.preferred_name : null;
    const lifeDesires =
      typeof profileRow?.life_desires === "string" ? profileRow.life_desires : null;
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

    const aiNextMove =
      contractProposalMode && proposalBindingText && contractProposalKind === "shrink_ask"
        ? {
            type: "shrink_ask" as const,
            reason_code: nextMove.reason_code,
            version: nextMove.version,
            shrunk_ask_text: proposalBindingText,
          }
        : contractProposalMode && proposalBindingText && contractProposalKind === "recommit_same"
          ? {
              type: "recommit_same" as const,
              reason_code: nextMove.reason_code,
              version: nextMove.version,
            }
          : nextMove;

    const coachingMemoryRow = await loadV2CoachingMemoryForPrompt(active.id);

    let recentSmsContextBlock: string | null = null;
    try {
      const convPack = await buildV2SmsConversationContextPack({
        clerkUserId,
        commitmentId: active.id,
        commitment: active,
        timezone,
        preloadedCoachingMemory: coachingMemoryRow,
        preloadedEventsNewestFirst: recentEvents,
      });
      recentSmsContextBlock = convPack.promptBlock;
    } catch (e) {
      console.warn("[daily-sms] sms_conversation_context_pack_failed", {
        commitment_id: active.id,
        message: e instanceof Error ? e.message : String(e),
      });
    }

    const overlayActive = isV2AdaptiveOverlayActive(active, now.getTime());

    const pendingEvolutionRec = await fetchPendingEvolutionRecommendation(active.id);
    const evolutionEvaluation = evaluateCommitmentEvolutionForSms({
      commitment: active,
      eventsNewestFirst: recentEvents,
      nowMs: now.getTime(),
    });
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
    });

    const resolvedDaily = await resolveV2DailyOutboundSmsBody({
      ctx: {
        commitment: active,
        eventsNewestFirst: recentEvents,
        blockerPreview: hasBlockerPreview ? blockerPreview : null,
        serverState,
        serverStrategy,
        templateFamily,
        silence: silenceCtx,
        reentry: reentryCtx,
        nextMove: aiNextMove,
        cadence: cadencePayload,
        effectiveCoachingAsk: effectiveAsk,
        contractProposalMode,
        contractProposalKind,
        contractProposalBindingText: contractProposalMode ? proposalBindingText : null,
        coachingMemory: coachingMemoryRow,
        preferredName,
        lifeDesires,
        peopleSummary,
        responsibility,
        identityAnchorText,
        identityRefreshDue,
        identityReferenceAllowed,
        reachabilityContextLine,
        dailyMessagePurpose: dailyPurpose,
        recentSmsContextBlock,
        wave7EvolutionPick:
          dailyPurpose === "evolution_pattern_check" && wave7Pick ? wave7Pick : null,
      },
      contractProposalMode,
      purpose: dailyPurpose,
      templateBody,
      effectiveAsk,
      behaviorStatement: active.behavior_statement,
      nextMoveType: outboundNextMove,
      shrunkAskText:
        outboundNextMove === "shrink_ask" ? (nextMove.shrunk_ask_text ?? null) : null,
    });

    let smsBody = resolvedDaily.smsBody;
    let v3DailySms = false;
    let v3DailyDeterministicFallback = false;
    const evolutionHint =
      dailyPurpose === "evolution_pattern_check" && wave7Pick
        ? `${wave7Pick.action}:${wave7Pick.evidenceSummary ?? ""}`.slice(0, 280)
        : null;
    const dailyCheckArgs = {
      commitmentId: active.id,
      effectiveAsk,
      behaviorStatement: active.behavior_statement ?? "",
      priorOutcome: latestOutcome?.type ?? null,
      coachingMemory: coachingMemoryRow,
      serverStrategy,
      silenceTier: silenceCtx.tier,
      blockerPreview: hasBlockerPreview ? blockerPreview : null,
      recentSmsContextBlock,
      preferredName,
      identityAnchor: identityAnchorText,
      recentEventsNewestFirst: recentEvents,
      dailyPurpose,
      contractProposalKind: contractProposalKind ?? undefined,
      contractBindingText: contractProposalMode ? proposalBindingText ?? undefined : undefined,
      evolutionPatternHint: evolutionHint ?? undefined,
      resolvedTemplateFallback: resolvedDaily.smsBody,
    };
    try {
      const v3d = await generateV3DailyCheckIn(dailyCheckArgs);
      smsBody = v3d.text;
      v3DailySms = true;
      v3DailyDeterministicFallback = !v3d.openAiOk;
    } catch (e) {
      console.warn("[v3-sms-brain] daily_check_failed", {
        commitment_id: active.id,
        message: e instanceof Error ? e.message : String(e),
      });
      smsBody = generateV3DailyDeterministicFallback(dailyCheckArgs);
      v3DailySms = true;
      v3DailyDeterministicFallback = true;
    }

    const aiTry = resolvedDaily.aiTry;
    const aiPayload = {
      ...buildCheckSentAiPayload({
        model: V2_OUTBOUND_AI_MODEL,
        promptVersion: V2_OUTBOUND_AI_PROMPT_VERSION,
        serverState,
        serverStrategy,
        message: smsBody,
        confidence: aiTry.ok ? aiTry.confidence : null,
        fallbackUsed: !aiTry.ok,
        ...(!aiTry.ok ? { fallbackReason: aiTry.reason } : {}),
        dailyResolution: resolvedDaily.resolution,
      }),
      ...(v3DailySms
        ? {
            reply_source: v3DailyDeterministicFallback
              ? "v3_daily_deterministic_fallback"
              : "v3_daily_check_in",
            v3_brain: {
              v3_brain_version: V3_BRAIN_VERSION,
              v3_coach_reply_source: v3DailyDeterministicFallback
                ? "v3_daily_deterministic_fallback"
                : "v3_daily_check_in",
              v3_memory_used: true,
              v3_daily_purpose: dailyPurpose,
              v3_contract_proposal_mode: contractProposalMode,
              v3_evolution_pattern_day: dailyPurpose === "evolution_pattern_check",
              v3_deterministic_fallback_used: v3DailyDeterministicFallback,
            },
          }
        : {}),
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
        ? proposalBindingText
        : nextMove.shrunk_ask_text;
    }
    if (contractProposalMode && contractProposalKind) {
      nextMovePayload.contract_proposal_pending = true;
      nextMovePayload.contract_kind = contractProposalKind;
    }

    const proposalExpiresAt = new Date(now.getTime() + V2_ADAPTIVE_PROPOSAL_TTL_MS).toISOString();
    const contractProposalMeta =
      contractProposalMode && proposalBindingText && contractProposalKind
        ? {
            active: true,
            contract_kind: contractProposalKind,
            proposal_text: proposalBindingText,
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
      v2ProposalBindingText: contractProposalMode ? proposalBindingText : null,
      v2ContractProposalPayload: contractProposalMeta,
      v2IdentityAnchorText: isQuotableIdentitySource(profileIdentitySource)
        ? identityAnchorText
        : null,
      v2EffectiveAskText: effectiveAsk,
      v3DailySms,
      v3DailyDeterministicFallback,
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
    twilioAccepted: 0,
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

      const timezone = resolveUserTimezone(md.timezone ?? audienceUser.timezone);
      const now = new Date();

      // localNow = "now" interpreted in that user's timezone
      const localNow = new Date(now.toLocaleString("en-US", { timeZone: timezone }));

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

      const pref = smsTimePreferenceFromClerkMetadata(md as Record<string, unknown>);
      const sendHour =
        SEND_HOUR_BY_PREFERENCE[pref as keyof typeof SEND_HOUR_BY_PREFERENCE] ?? 7;

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
        if (hasActiveBehavior) {
          const learnedProf = await fetchV2UserSendTimeProfile(audienceUser.clerk_user_id);
          if (learnedProf && shouldUseLearnedSendTimeGate(learnedProf)) {
            sendTimeWindowOk = isV2LearnedSendWindowAllowed(localNow, learnedProf.preferred_window);
          }
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
                      contractProposal: built.v2ContractProposalPayload ?? null,
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

        if (activeCadence.accountability_phase === "active_accountability") {
          if (!isNewActive14Days) {
            const lastTwoRows = await getLastNV2CheckSentPayloads(activeCadence.id, 2);
            const lastTwoLevels = lastTwoRows.map((r) =>
              parseCadenceLevelFromCheckSentPayload(r.payload_json)
            );
            if (
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
          if (!isExpectedDailyAttemptUser) {
            const cadencePayloadGate = deriveV2CadencePayload({
              eventsNewestFirst: recentCadence,
              now: nowCadence,
              hasBlockerPreview: hasBlockerPreviewCadence,
            });
            if (
              !shouldSendV2CadenceToday({
                lastSuccessfulCheckSentDayKey: lastCheckCadence?.day_key ?? null,
                todayLocalDayKey: todayKey,
                cadenceLevel: cadencePayloadGate.level,
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
                  contractProposal: builtMain.v2ContractProposalPayload ?? null,
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