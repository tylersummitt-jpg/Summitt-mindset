/**
 * Daily SMS cron: V2 accountability outbound only (PR6).
 * sms_send_events reservation is one row per (user, day_key, send_slot); Phase 1 writes morning only.
 */
import crypto from "crypto";
import { NextResponse } from "next/server";
import { getClerkUser } from "@/lib/clerk-rest";
import { syncSmsAudience } from "@/lib/sms-audience-sync";
import { supabaseServer } from "@/lib/supabase-server";
import { smsTimePreferenceFromClerkMetadata } from "@/lib/sms-daily-delivery-body";
import { resolveUserTimezone, getDateKeyInTimezone, resolveSmsUserTimezone } from "@/lib/timezone";
import { slimTemporalContractForTelemetry } from "@/lib/sms-temporal-contract-v1";
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
  checkSentIdempotencyKey,
  onV2StandardCheckSentOutboundSendSuccess,
  reconcileCheckSentPostSendBookkeepingForCommitment,
  type V2CheckSentExpectedReplySemantics,
  type V2CheckSentPromptKind,
} from "@/lib/v2-outbound-check-sent";
import { loadV2CoachingMemoryForPrompt, recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import {
  deriveV2CadencePayload,
  shouldSendV2CadenceToday,
  type V2CadencePayload,
} from "@/lib/v2-cadence";
import { resolveSilenceCadenceForDailyUser } from "@/lib/sms-silence-cadence-v1";
import {
  getActiveCommitment,
  hasRecentInboundAccountabilityExchange,
  getLastNV2CheckSentPayloads,
  getLastV2CheckSentForCommitment,
  getLatestBlockerCapturedAfter,
  getLatestV2AccountabilityOutcome,
  getRecentV2EventsForAi,
  updateReactivationLastSentAt,
  type ActiveV2CommitmentRow,
  type V2EventRowForAi,
} from "@/lib/v2-commitment";
import { maybeRecordV2WeakNoReplyFromPriorAccountabilityDay } from "@/lib/v2-send-time-weak-no-reply";
import {
  buildDailySchedulingTelemetry,
  evaluateDailySendTimeWindow,
  isLocalCatchupHour,
} from "@/lib/daily-sms-scheduling";
import {
  fetchV2UserSendTimeProfile,
  formatReachabilityContextLine,
  localHourToSendWindow,
} from "@/lib/v2-send-time-profile";
import {
  fetchV2UserSmsCommsPreferences,
  isPauseActive,
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
import { upsertCommitmentSmsThreadMemoryFromOutbound } from "@/lib/v2-commitment-sms-thread-memory";
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
import { pickNorthStarWriterAttributionFields, type NorthStarCoachChannel } from "@/lib/north-star-coach-sms";
import { dailySmsVoiceSkipEventPatch, isDailySmsWithheldByFinalVoiceGate } from "@/lib/daily-sms-voice-skip";
import {
  deriveRecommitSameVisibleContractRoutePolicy,
  resolveDailySatisfiedAskContext,
  slimDailySatisfiedAskContextForTelemetry,
  type DailySatisfiedAskContext,
} from "@/lib/daily-satisfied-ask-context";
import {
  applyDailyPostFvgStaleAskDetectOnly,
  DAILY_POST_FVG_STALE_ASK_BLOCKED,
  DAILY_STALE_ASK_BLOCKED,
} from "@/lib/daily-stale-ask-guard";
import {
  buildSundayWeeklyPauseSkipMetadata,
  isSundayWeeklyPatPauseEligible,
  shouldSuppressDailyForSundayWeeklyPause,
  SUNDAY_WEEKLY_PAUSE_SKIP_STATUS,
} from "@/lib/sms-sunday-weekly-pause-eligibility";
import { applySundayWeeklyPauseBeforeWriterIfNeeded } from "@/lib/sms-daily-sunday-before-writer";
import { attachDailyNotebookVerdictToMetadata } from "@/lib/sms-daily-notebook-telemetry";
import type { V2UserSmsCommsPreferencesRow } from "@/lib/v2-sms-comms-preferences";
import { buildDailyOutboundNorthStarContextPacket } from "@/lib/north-star-sms-context-packet";
import { finalizeNorthStarCoachSmsAsync } from "@/lib/north-star-coach-sms-openai";
import { V3_BRAIN_VERSION } from "@/lib/v3-sms-brain";
import { applyFinalVoiceOwnershipGate } from "@/lib/v3-sms-voice-ownership";
import {
  applyUnifiedSmsFinalProductLawGuard,
  compactUnifiedFinalGuardForTelemetry,
  UNIFIED_FINAL_BODY_AUTHORITY,
} from "@/lib/sms-final-product-law-guard";
import {
  buildDailyOutboundOcegEvidence,
  buildDailyOutboundUnifiedGuardCtx,
  isOutboundDailyWiredRoutePurpose,
  resolveDailyBuiltRouteKind,
  type DailyOutboundUnifiedGuardCtx,
} from "@/lib/daily-outbound-final-guard-evidence";
import {
  DAILY_SEMANTIC_CONTRACT_PROPOSAL_VERSION,
  DEFAULT_SEMANTIC_DAILY_CONTRACT_FORBIDDEN_PHRASES,
  type DailySemanticContractProposalFactsPacket,
} from "@/lib/v3-daily-contract-proposal-semantic";
import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";
import {
  buildDailySmsContent,
  buildStandardCheckSentPayload,
  resolveV2BlockerPreviewForOutbound,
  withPresentedDailyContractProposalAuditFields,
  type DailySmsBuilt,
} from "@/lib/daily-sms-build";
import {
  applyDailySmsBuiltWithTtoPostWriterBypass,
  applyTtoDraftRevalidationSuccess,
  assertTtoCurrentDraftBodyMatches,
  buildTylerTextOverviewRouteConflictMetadata,
  buildTylerTextOverviewSendMetadata,
  finalizeTylerTextOverviewDraftAfterSend,
  markTylerTextOverviewDraftSkippedAfterGuard,
  markTylerTextOverviewDraftSkippedAfterLiveFallback,
  mergeTylerTextOverviewSendMetadata,
  prepareTylerTextOverviewDailyBuild,
  revalidateCurrentTtoDraftBodyBeforeSend,
  resolveTtoCurrentDraftSendConflict,
  shouldRevalidateTtoCurrentDraftBeforeSend,
  withTylerTextOverviewFinalBodyOnContext,
  withTylerTextOverviewPostWriterBypassOnContext,
  type TylerTextOverviewSendContext,
} from "@/lib/tyler-text-overview-send";
import { SMS_DAILY_PRODUCTION_SEND_SLOT } from "@/lib/tyler-text-overview-types";

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
    v3BrainMetadata: built.v3PraisePolicyContext
      ? { praise_policy_context: built.v3PraisePolicyContext }
      : undefined,
  });
  let finalReplyBody = voiceGate.shouldSend ? voiceGate.body : "";
  let finalShouldSend = voiceGate.shouldSend;
  let finalSkipReason = voiceGate.skipReason ?? null;
  let finalBlockedReasons = voiceGate.blockedReasons;
  let postFvgStaleMeta: Record<string, unknown> = {};

  if (built.dailySatisfiedAskContext?.has_satisfied_recent_ask && finalShouldSend && finalReplyBody.trim() && !built.v2ContractProposalMode) {
    const stalePostFvg = applyDailyPostFvgStaleAskDetectOnly({
      body: finalReplyBody,
      satisfiedAskContext: built.dailySatisfiedAskContext,
      routePurpose: built.v2ReactivationNudge
        ? "low_pressure_reactivation"
        : built.v2PendingResolutionReminder
          ? "pending_resolution"
          : built.v2RefreshOutboundPlan
            ? "refresh"
            : "main_active_accountability",
      stage: "daily_post_final_voice_gate",
    });
    if (stalePostFvg.outcome === "no_send") {
      postFvgStaleMeta = {
        ...stalePostFvg.metadata,
        no_send_reason: stalePostFvg.noSendReason,
      };
      finalShouldSend = false;
      finalSkipReason = "final_voice_blocked";
      finalReplyBody = "";
      finalBlockedReasons = [...(finalBlockedReasons ?? []), DAILY_POST_FVG_STALE_ASK_BLOCKED];
    } else {
      postFvgStaleMeta = stalePostFvg.metadata;
    }
  }

  let unifiedGuardTelemetry: Record<string, unknown> | null = null;
  let unifiedGuardNoSendReason: string | null = null;
  const dailyRouteKind = resolveDailyBuiltRouteKind(built);

  if (
    finalShouldSend &&
    finalReplyBody.trim() &&
    built.dailyUnifiedGuardCtx &&
    isOutboundDailyWiredRoutePurpose(built.dailyUnifiedGuardCtx.routeKind)
  ) {
    const ocegEvidence = buildDailyOutboundOcegEvidence(built.dailyUnifiedGuardCtx);
    const unifiedGuard = await applyUnifiedSmsFinalProductLawGuard({
      mode: "outbound_daily",
      surface: "daily",
      routePurpose: built.dailyUnifiedGuardCtx.routeKind,
      branchName: built.dailyUnifiedGuardCtx.routeKind,
      preGuardBodyPreview: finalReplyBody,
      outboundDaily: {
        body: finalReplyBody,
        evidence: ocegEvidence,
        dailyGuardCtx: built.dailyUnifiedGuardCtx,
        priorCoachBody: built.dailyUnifiedGuardCtx.priorCoachBody,
        priorCoachSentAt: built.dailyUnifiedGuardCtx.priorCoachSentAt,
        routePurpose: built.dailyUnifiedGuardCtx.routeKind,
      },
    });
    unifiedGuardTelemetry = compactUnifiedFinalGuardForTelemetry(unifiedGuard);
    if (!unifiedGuard.shouldSend) {
      unifiedGuardNoSendReason = unifiedGuard.noSendReason;
      finalShouldSend = false;
      finalReplyBody = "";
      finalSkipReason = "final_voice_blocked";
      finalBlockedReasons = [...(finalBlockedReasons ?? []), "unified_final_product_law_guard"];
    } else {
      finalReplyBody = unifiedGuard.body;
    }
  }

  const skipSource =
    !finalShouldSend && unifiedGuardNoSendReason
      ? "unified_final_guard_no_send"
      : !finalShouldSend && finalBlockedReasons?.includes(DAILY_POST_FVG_STALE_ASK_BLOCKED)
        ? "daily_post_fvg_stale_ask_no_send"
        : !finalShouldSend && finalBlockedReasons?.includes(DAILY_STALE_ASK_BLOCKED)
          ? "stale_ask_no_send"
          : !finalShouldSend
            ? "FVG_no_send"
            : null;

  const out: Extract<DailySmsBuilt, { ok: true }> = {
    ...built,
    smsBody: finalShouldSend ? finalReplyBody : "",
  };
  out.v2AiPayload = {
    ...(built.v2AiPayload && typeof built.v2AiPayload === "object" ? built.v2AiPayload : {}),
    north_star_gate: {
      original_body: ns.meta.originalBody,
      body_after_north_star: ns.visibleBody,
      final_body: finalShouldSend ? finalReplyBody : ns.visibleBody,
      north_star_gate_source: ns.meta.source,
      north_star_gate_reasons: ns.meta.blockedReasons,
      openai_attempted: ns.meta.openaiAttempted,
      openai_failed_reason: ns.meta.openaiFailedReason ?? null,
      context_packet_used: ns.meta.contextPacketUsed,
      finalizer_version: ns.meta.finalizerVersion,
      ...pickNorthStarWriterAttributionFields(ns.meta),
    },
    final_voice_gate: {
      ...(voiceGate.metadata as Record<string, unknown>),
      ...postFvgStaleMeta,
    },
    voice_send_decision: {
      should_send: finalShouldSend,
      skip_reason: finalSkipReason,
      voice_channel: channel,
      north_star_visible_body: ns.visibleBody,
      blocked_reasons: finalBlockedReasons,
      ...(skipSource ? { skip_source: skipSource } : {}),
      ...(postFvgStaleMeta),
      ...(slimDailySatisfiedAskContextForTelemetry(built.dailySatisfiedAskContext) ?? {}),
      ...(finalShouldSend
        ? {
            ...(unifiedGuardTelemetry
              ? {
                  final_body_authority: UNIFIED_FINAL_BODY_AUTHORITY,
                  sent_body_equals_guard_body: true,
                  unified_final_product_law_guard: unifiedGuardTelemetry,
                }
              : {}),
          }
        : {
            visible_sent: false,
            twilio_send_attempted: false,
            ...(unifiedGuardTelemetry
              ? {
                  final_body_authority: UNIFIED_FINAL_BODY_AUTHORITY,
                  unified_final_product_law_guard: unifiedGuardTelemetry,
                  no_send_reason: unifiedGuardNoSendReason,
                  ...(built.v2ContractProposalMode
                    ? {
                        v2_contract_proposal_kind: built.v2ContractProposalKind ?? null,
                        proposal_state_written_before_sms: false,
                        proposal_state_written_after_sms: false,
                        proposal_no_send_reason: unifiedGuardNoSendReason,
                      }
                    : {}),
                  ...(built.v2PendingResolutionReminder
                    ? {
                        pending_state_written_before_sms: false,
                        ...(built.dailyUnifiedGuardCtx?.pendingResolutionFacts
                          ?.pendingExpiredClearedBeforeBuild
                          ? { pending_expired_cleared_before_build: true }
                          : {}),
                        pending_reminder_no_send_reason: unifiedGuardNoSendReason,
                        ...(built.dailyUnifiedGuardCtx?.pendingResolutionFacts?.resolutionKind
                          ? {
                              v2_pending_resolution_kind:
                                built.dailyUnifiedGuardCtx.pendingResolutionFacts.resolutionKind,
                            }
                          : {}),
                        ...(built.dailyUnifiedGuardCtx?.pendingResolutionFacts?.candidateSnippet
                          ? {
                              pending_candidate_preview:
                                built.dailyUnifiedGuardCtx.pendingResolutionFacts.candidateSnippet.slice(
                                  0,
                                  80
                                ),
                            }
                          : {}),
                      }
                    : {}),
                  ...(built.v2RefreshOutboundPlan
                    ? {
                        refresh_session_written_before_sms: false,
                        ...(built.dailyUnifiedGuardCtx?.refreshGuardFacts
                          ?.refreshStaleSessionAbandonedBeforeBuild
                          ? { refresh_stale_session_abandoned_before_build: true }
                          : {}),
                        refresh_no_send_reason: unifiedGuardNoSendReason,
                        refresh_step:
                          built.dailyUnifiedGuardCtx?.refreshGuardFacts?.refreshStep ??
                          built.v2RefreshOutboundPlan.kind,
                      }
                    : {}),
                }
              : {}),
          }),
      daily_route_kind: dailyRouteKind,
    },
  };
  return out;
}

/** Post-Twilio success fields for sms_send_events — metadata.sent_at for notebook thread timestamps. */
function tylerTextOverviewMetadataForSend(
  ctx: TylerTextOverviewSendContext | null,
  finalBodySent: string | null
) {
  return withTylerTextOverviewFinalBodyOnContext(ctx, finalBodySent)?.metadataBlock ?? null;
}

async function applyDailySmsBuiltAfterTylerTextOverview(args: {
  builtRaw: DailySmsBuilt;
  tylerTextOverviewCtx: TylerTextOverviewSendContext | null;
  tylerDraftBodyUsed: boolean;
  localHour: number;
}): Promise<{ built: DailySmsBuilt; tylerTextOverviewCtx: TylerTextOverviewSendContext | null }> {
  const gated = await applyDailySmsBuiltWithTtoPostWriterBypass({
    builtRaw: args.builtRaw,
    lookup: args.tylerTextOverviewCtx?.lookup,
    draftBodyUsed: args.tylerDraftBodyUsed,
    applyNorthStarGate: (built) => withNorthStarDailyGate(built, { localHour: args.localHour }),
  });
  return {
    built: gated.built,
    tylerTextOverviewCtx: withTylerTextOverviewPostWriterBypassOnContext(
      args.tylerTextOverviewCtx,
      gated.postTtoWritersBypassed,
      gated.built.ok ? gated.built.smsBody : null
    ),
  };
}

async function blockSendOnTtoCurrentDraftRouteConflict(args: {
  builtRaw: DailySmsBuilt;
  tylerTextOverviewCtx: TylerTextOverviewSendContext | null;
  tylerDraftBodyUsed: boolean;
  clerkUserId: string;
  todayKey: string;
  existingMeta: Record<string, unknown>;
  timezone: string;
  localNow: Date;
}): Promise<boolean> {
  const conflict = resolveTtoCurrentDraftSendConflict({
    lookup: args.tylerTextOverviewCtx?.lookup,
    builtRaw: args.builtRaw,
    draftBodyUsed: args.tylerDraftBodyUsed,
  });
  if (!conflict || !args.tylerTextOverviewCtx?.lookup.draft_id) {
    return false;
  }

  console.error("[daily-sms] tto_current_draft_route_conflict", {
    clerk_user_id: args.clerkUserId,
    day_key: args.todayKey,
    draft_id: args.tylerTextOverviewCtx.lookup.draft_id,
    conflict_reason: conflict.reason,
    built_ok: args.builtRaw.ok,
    built_error: args.builtRaw.ok ? null : args.builtRaw.error,
    draft_body_used: args.tylerDraftBodyUsed,
    send_source: args.tylerTextOverviewCtx.lookup.send_source,
    route_kind: args.tylerTextOverviewCtx.lookup.route_kind,
  });

  const conflictMetadata = buildTylerTextOverviewRouteConflictMetadata({
    lookup: args.tylerTextOverviewCtx.lookup,
    builtRaw: args.builtRaw,
    draftBodyUsed: args.tylerDraftBodyUsed,
    conflict,
  });

  await supabaseServer
    .from("sms_send_events")
    .update({
      status: conflict.status,
      metadata: mergeTylerTextOverviewSendMetadata(
        {
          ...args.existingMeta,
          note: conflict.reason,
          timezone: args.timezone,
          local_time: args.localNow.toISOString(),
          twilio_send_attempted: false,
        },
        conflictMetadata
      ),
    })
    .eq("clerk_user_id", args.clerkUserId)
    .eq("day_key", args.todayKey)
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

  await markTylerTextOverviewDraftSkippedAfterGuard({
    draftId: args.tylerTextOverviewCtx.lookup.draft_id,
    clerkUserId: args.clerkUserId,
    dayKey: args.todayKey,
  });

  return true;
}

async function applyTtoCurrentDraftRevalidationBeforeTwilio(args: {
  built: DailySmsBuilt;
  tylerTextOverviewCtx: TylerTextOverviewSendContext | null;
  tylerDraftBodyUsed: boolean;
  clerkUserId: string;
  todayKey: string;
  existingMeta: Record<string, unknown>;
  timezone: string;
  localNow: Date;
}): Promise<{
  built: DailySmsBuilt;
  tylerTextOverviewCtx: TylerTextOverviewSendContext | null;
  blocked: boolean;
}> {
  if (
    !shouldRevalidateTtoCurrentDraftBeforeSend({
      tylerTextOverviewCtx: args.tylerTextOverviewCtx,
      tylerDraftBodyUsed: args.tylerDraftBodyUsed,
      built: args.built,
    }) ||
    !args.built.ok ||
    !args.tylerTextOverviewCtx
  ) {
    return {
      built: args.built,
      tylerTextOverviewCtx: args.tylerTextOverviewCtx,
      blocked: false,
    };
  }

  const pinnedBody = args.built.smsBody;
  const revalidation = await revalidateCurrentTtoDraftBodyBeforeSend({
    lookup: args.tylerTextOverviewCtx.lookup,
    pinnedBody,
    clerkUserId: args.clerkUserId,
    draftForDayKey: args.todayKey,
  });

  if (!revalidation.ok) {
    console.error("[daily-sms] tto_current_draft_revalidation_failed", {
      clerk_user_id: args.clerkUserId,
      day_key: args.todayKey,
      draft_id: args.tylerTextOverviewCtx.lookup.draft_id,
      revalidation_reason: revalidation.reason,
      skip_status: revalidation.skipStatus,
    });

    const failureMetadata = buildTylerTextOverviewSendMetadata({
      lookup: args.tylerTextOverviewCtx.lookup,
      effectiveSendSource: args.tylerTextOverviewCtx.lookup.send_source,
      finalBodySent: null,
      postTtoWritersBypassed: true,
    });

    await supabaseServer
      .from("sms_send_events")
      .update({
        status: revalidation.skipStatus,
        metadata: mergeTylerTextOverviewSendMetadata(
          {
            ...args.existingMeta,
            note: revalidation.reason,
            timezone: args.timezone,
            local_time: args.localNow.toISOString(),
            twilio_send_attempted: false,
          },
          {
            ...failureMetadata,
            ...revalidation.metadataExtras,
          }
        ),
      })
      .eq("clerk_user_id", args.clerkUserId)
      .eq("day_key", args.todayKey)
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

    if (args.tylerTextOverviewCtx.lookup.draft_id) {
      await markTylerTextOverviewDraftSkippedAfterGuard({
        draftId: args.tylerTextOverviewCtx.lookup.draft_id,
        clerkUserId: args.clerkUserId,
        dayKey: args.todayKey,
      });
    }

    return {
      built: args.built,
      tylerTextOverviewCtx: args.tylerTextOverviewCtx,
      blocked: true,
    };
  }

  const applied = applyTtoDraftRevalidationSuccess({
    built: args.built,
    tylerTextOverviewCtx: args.tylerTextOverviewCtx,
    revalidation,
  });

  return {
    built: applied.built,
    tylerTextOverviewCtx: applied.tylerTextOverviewCtx,
    blocked: false,
  };
}

async function blockSendOnTtoCurrentDraftBodyMismatch(args: {
  built: DailySmsBuilt;
  tylerTextOverviewCtx: TylerTextOverviewSendContext | null;
  tylerDraftBodyUsed: boolean;
  clerkUserId: string;
  todayKey: string;
  existingMeta: Record<string, unknown>;
  timezone: string;
  localNow: Date;
}): Promise<boolean> {
  if (
    !args.tylerTextOverviewCtx?.postTtoWritersBypassed ||
    !args.tylerDraftBodyUsed ||
    !args.built.ok ||
    !args.tylerTextOverviewCtx.lookup.current_body_to_send
  ) {
    return false;
  }

  const assertion = assertTtoCurrentDraftBodyMatches({
    smsBody: args.built.smsBody,
    currentBodyToSend: args.tylerTextOverviewCtx.lookup.current_body_to_send,
  });
  if (assertion.ok) {
    return false;
  }

  console.error("[daily-sms] tto_current_draft_body_mismatch", {
    clerk_user_id: args.clerkUserId,
    day_key: args.todayKey,
    draft_id: args.tylerTextOverviewCtx.lookup.draft_id,
    current_body_hash: args.tylerTextOverviewCtx.lookup.current_body_hash,
    sms_body_hash_preview: args.built.smsBody.slice(0, 40),
    current_body_preview: args.tylerTextOverviewCtx.lookup.current_body_to_send.slice(0, 40),
  });

  await supabaseServer
    .from("sms_send_events")
    .update({
      status: "skipped_tto_current_draft_body_mismatch",
      metadata: mergeTylerTextOverviewSendMetadata(
        {
          ...args.existingMeta,
          note: "tto_current_draft_body_mismatch",
          timezone: args.timezone,
          local_time: args.localNow.toISOString(),
        },
        tylerTextOverviewMetadataForSend(args.tylerTextOverviewCtx, null)
      ),
    })
    .eq("clerk_user_id", args.clerkUserId)
    .eq("day_key", args.todayKey)
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

  if (args.tylerTextOverviewCtx.lookup.draft_id) {
    await markTylerTextOverviewDraftSkippedAfterGuard({
      draftId: args.tylerTextOverviewCtx.lookup.draft_id,
      clerkUserId: args.clerkUserId,
      dayKey: args.todayKey,
    });
  }

  return true;
}

async function finalizeTylerTextOverviewAfterOutboundBestEffort(args: {
  ctx: TylerTextOverviewSendContext | null;
  draftBodyUsed: boolean;
  clerkUserId: string;
  dayKey: string;
  smsBody: string;
  messageSid: string;
}): Promise<void> {
  if (!args.ctx?.lookup.draft_id) return;
  try {
    if (args.draftBodyUsed) {
      await finalizeTylerTextOverviewDraftAfterSend({
        draftId: args.ctx.lookup.draft_id,
        clerkUserId: args.clerkUserId,
        dayKey: args.dayKey,
        twilioMessageSid: args.messageSid,
        finalBodySent: args.smsBody,
      });
      return;
    }
    if (args.ctx.lookup.send_source !== "live_fallback_no_draft") {
      await markTylerTextOverviewDraftSkippedAfterLiveFallback({
        draftId: args.ctx.lookup.draft_id,
        clerkUserId: args.clerkUserId,
        dayKey: args.dayKey,
        finalBodySent: args.smsBody,
      });
    }
  } catch (err) {
    console.error("[daily-sms] tyler_text_overview draft finalize failed (non-blocking)", {
      clerk_user_id: args.clerkUserId,
      day_key: args.dayKey,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

function dailySmsTwilioSuccessSendEventFields(args: {
  messageSid: string;
  twilioStatus: string;
  smsBody: string;
  metadata: Record<string, unknown>;
}): {
  message_sid: string;
  status: string;
  sms_body: string;
  metadata: Record<string, unknown>;
} {
  const sentAtIso = new Date().toISOString();
  return {
    message_sid: args.messageSid,
    status: args.twilioStatus,
    sms_body: args.smsBody,
    metadata: {
      ...args.metadata,
      sent_at: sentAtIso,
      twilio_send_attempted: true,
      twilio_message_sid: args.messageSid,
      message_sid: args.messageSid,
      sms_body: args.smsBody,
      final_sms_body: args.smsBody,
      twilio_status: args.twilioStatus,
    },
  };
}

function compactSupabaseErrorMessage(err: unknown): string {
  if (!err || typeof err !== "object") return String(err).slice(0, 500);
  const e = err as { message?: string; code?: string };
  return [e.code, e.message].filter(Boolean).join(": ").slice(0, 500);
}

/** True when Twilio SID is persisted top-level or in metadata (post-send idempotency guard). */
function hasAnyTwilioSidOnSendEvent(row: {
  message_sid?: unknown;
  metadata?: unknown;
}): boolean {
  const topSid = row.message_sid;
  if (typeof topSid === "string" && topSid.trim().length > 0) return true;
  const meta =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;
  if (!meta) return false;
  for (const key of ["message_sid", "twilio_message_sid", "outbound_message_sid"] as const) {
    const v = meta[key];
    if (typeof v === "string" && v.trim().length > 0) return true;
  }
  return false;
}

type RecordDailyTwilioSuccessResult = {
  recordOk: boolean;
  usedFallback: boolean;
  orphanLogged: boolean;
};

async function recordDailyTwilioSuccessOrFallback(args: {
  clerkUserId: string;
  dayKey: string;
  pathLabel: "main" | "retry";
  primaryPayload: ReturnType<typeof dailySmsTwilioSuccessSendEventFields>;
  messageSid: string;
  smsBody: string;
  twilioStatus: string;
}): Promise<RecordDailyTwilioSuccessResult> {
  const { error: primaryErr } = await supabaseServer
    .from("sms_send_events")
    .update(args.primaryPayload)
    .eq("clerk_user_id", args.clerkUserId)
    .eq("day_key", args.dayKey)
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

  if (!primaryErr) {
    return { recordOk: true, usedFallback: false, orphanLogged: false };
  }

  const primaryErrorStr = compactSupabaseErrorMessage(primaryErr);
  console.error(
    `[daily-sms] sms_send_events primary update failed after Twilio success (${args.pathLabel} path)`,
    {
      clerk_user_id: args.clerkUserId,
      day_key: args.dayKey,
      message_sid: args.messageSid,
      error: primaryErr,
    }
  );

  const baseMeta = args.primaryPayload.metadata;
  const fallbackMetadata: Record<string, unknown> = {
    ...baseMeta,
    sent_at:
      typeof baseMeta.sent_at === "string" && baseMeta.sent_at.trim()
        ? baseMeta.sent_at
        : new Date().toISOString(),
    twilio_message_sid: args.messageSid,
    message_sid: args.messageSid,
    sms_body: args.smsBody,
    final_sms_body: args.smsBody,
    twilio_status: args.twilioStatus,
    twilio_send_attempted: true,
    twilio_db_primary_update_failed: true,
    twilio_db_primary_update_error: primaryErrorStr,
    twilio_db_fallback_update_attempted: true,
    note: "sent_to_twilio_db_update_recovered",
  };

  const { error: fallbackErr } = await supabaseServer
    .from("sms_send_events")
    .update({
      status: args.twilioStatus,
      metadata: fallbackMetadata,
    })
    .eq("clerk_user_id", args.clerkUserId)
    .eq("day_key", args.dayKey)
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

  if (!fallbackErr) {
    console.warn("[daily-sms] Twilio success recorded via metadata-only fallback", {
      clerk_user_id: args.clerkUserId,
      day_key: args.dayKey,
      message_sid: args.messageSid,
      path: args.pathLabel,
    });
    return { recordOk: true, usedFallback: true, orphanLogged: false };
  }

  const fallbackErrorStr = compactSupabaseErrorMessage(fallbackErr);
  console.error("[daily-sms] CRITICAL orphan Twilio send — primary and fallback DB updates failed", {
    clerk_user_id: args.clerkUserId,
    day_key: args.dayKey,
    message_sid: args.messageSid,
    sms_body_preview: args.smsBody.slice(0, 160),
    twilio_status: args.twilioStatus,
    path: args.pathLabel,
    primary_error: primaryErrorStr,
    fallback_error: fallbackErrorStr,
  });
  return { recordOk: false, usedFallback: true, orphanLogged: true };
}

function dailySmsSentEventVoiceMetadata(
  built: Extract<DailySmsBuilt, { ok: true }>
): Record<string, unknown> {
  const p = built.v2AiPayload;
  if (!p || typeof p !== "object" || !p.final_voice_gate || typeof p.final_voice_gate !== "object") {
    return {};
  }
  const fvg = p.final_voice_gate as Record<string, unknown>;
  const vsd = p.voice_send_decision as Record<string, unknown> | undefined;
  const v3Brain =
    p.v3_brain != null && typeof p.v3_brain === "object"
      ? (p.v3_brain as Record<string, unknown>)
      : null;
  const packetObservability =
    v3Brain != null ? relationshipObservabilityFromLaneMetadata(v3Brain) : {};
  const unifiedGuard =
    vsd?.unified_final_product_law_guard != null &&
    typeof vsd.unified_final_product_law_guard === "object"
      ? (vsd.unified_final_product_law_guard as Record<string, unknown>)
      : null;
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
    v3_repair_attempted: fvg.v3_repair_attempted ?? null,
    v3_repair_succeeded: fvg.v3_repair_succeeded ?? null,
    ...(vsd?.final_body_authority ? { final_body_authority: vsd.final_body_authority } : {}),
    ...(vsd?.sent_body_equals_guard_body === true ? { sent_body_equals_guard_body: true } : {}),
    ...(unifiedGuard ? { unified_final_product_law_guard: unifiedGuard } : {}),
    ...(Object.keys(packetObservability).length > 0
      ? { relationship_packet_observability: packetObservability }
      : {}),
  };
}

function withRelationshipPacketObservabilityOnVoiceSkipPatch(
  patch: ReturnType<typeof dailySmsVoiceSkipEventPatch>,
  v3Brain: unknown
): ReturnType<typeof dailySmsVoiceSkipEventPatch> {
  const packetObs = relationshipObservabilityFromLaneMetadata(
    v3Brain != null && typeof v3Brain === "object" ? (v3Brain as Record<string, unknown>) : undefined
  );
  if (Object.keys(packetObs).length === 0) return patch;
  return {
    ...patch,
    metadata: {
      ...patch.metadata,
      relationship_packet_observability: packetObs,
    },
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
  sendSlot?: typeof SMS_DAILY_PRODUCTION_SEND_SLOT;
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
  const sendSlot = args.sendSlot ?? SMS_DAILY_PRODUCTION_SEND_SLOT;
  const { error } = await supabaseServer.from("v2_commitment_event").insert({
    commitment_id: args.commitmentId,
    clerk_user_id: args.clerkUserId,
    event_type: "check_sent",
    source: "sms_v2_accountability",
    payload_json: {
      day_key: args.dayKey,
      send_slot: sendSlot,
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
    idempotency_key: checkSentIdempotencyKey(args.commitmentId, args.dayKey, sendSlot),
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
const FIRST_14_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const SAFE_LOCAL_CUTOFF_HOUR = 22;

function isWithinFirst14Days(activationAt: string | null, now: Date): boolean {
  if (!activationAt) return false;
  const t = new Date(activationAt).getTime();
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t < FIRST_14_DAYS_MS;
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

async function applySundayWeeklyPauseSuppressionIfNeeded(args: {
  built: Extract<DailySmsBuilt, { ok: true }>;
  clerkUserId: string;
  todayKey: string;
  localNow: Date;
  timezone: string;
  now: Date;
  force: boolean;
  fullyOnV2: boolean;
  commitment: ActiveV2CommitmentRow | null;
  commsPrefs: V2UserSmsCommsPreferencesRow | null;
  existingMeta?: Record<string, unknown>;
}): Promise<boolean> {
  const routeKind = resolveDailyBuiltRouteKind(args.built);
  const eligible = isSundayWeeklyPatPauseEligible({
    localNow: args.localNow,
    now: args.now,
    fullyOnV2: args.fullyOnV2,
    commitment: args.commitment,
    commsPrefs: args.commsPrefs,
  });
  if (
    !shouldSuppressDailyForSundayWeeklyPause({
      routeKind,
      eligible,
      force: args.force,
    })
  ) {
    return false;
  }

  await supabaseServer
    .from("sms_send_events")
    .update({
      status: SUNDAY_WEEKLY_PAUSE_SKIP_STATUS,
      sms_body: "",
      metadata: buildSundayWeeklyPauseSkipMetadata({
        routeKind,
        todayKey: args.todayKey,
        localNow: args.localNow,
        timezone: args.timezone,
        existingMeta: args.existingMeta,
        beforeWriter: false,
        writerInvoked: true,
      }),
    })
    .eq("clerk_user_id", args.clerkUserId)
    .eq("day_key", args.todayKey)
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

  return true;
}

/**
 * ======================================================
 * Helper: try to reserve today's send slot
 * ======================================================
 *
 * We rely on unique index: (clerk_user_id, day_key, send_slot)
 * Phase 1 production writes send_slot = morning only.
 * - If insert succeeds: this run owns the send attempt.
 * - If insert fails due to unique violation: SMS already reserved/sent for this slot, skip safely.
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
    send_slot: SMS_DAILY_PRODUCTION_SEND_SLOT,
    status: "reserved",
    metadata: { note: "reserved_by_cron", send_slot: SMS_DAILY_PRODUCTION_SEND_SLOT },
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
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT)
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
    skippedSilenceCadenceSpace: 0,
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
    skippedSundayWeeklyPause: 0,
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

      const tzResolved = resolveSmsUserTimezone({
        clerkMetadataTimezone: md.timezone,
        audienceTimezone: audienceUser.timezone,
      });
      const timezone = tzResolved.timezone;
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

      // STEP 1: Read existing event before reserve (and before window check)
      stage = "query_send_events";
      const { data: existingRow } = await supabaseServer
        .from("sms_send_events")
        .select("id, status, metadata, message_sid")
        .eq("clerk_user_id", audienceUser.clerk_user_id)
        .eq("day_key", todayKey)
        .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT)
        .maybeSingle();

      let existingEvent = existingRow;
      const bypassWindowGate = Boolean(existingEvent) || force;

      const sendWindowEval = evaluateDailySendTimeWindow({
        now,
        timezone,
        clerkSmsTimePreference: pref,
        commsPrefs,
        learnedProfile: learnedProfForWindow,
        bypassWindowGate,
      });
      const computedLocalHour = sendWindowEval.computedLocalHour;

      // Retries bypass send window; first-time sends require it (+ 7AM product floor).
      let sendTimeWindowOk = sendWindowEval.sendTimeWindowOk;

      if (!existingEvent && !force && !sendTimeWindowOk) {
        const canCatchupNow =
          isExpectedDailyAttemptUser && isLocalCatchupHour(computedLocalHour);
        if (canCatchupNow) {
          stats.catchupEligible += 1;
          stats.catchupAttempted += 1;
          sendTimeWindowOk = true;
        } else {
          if (isExpectedDailyAttemptUser && computedLocalHour >= SAFE_LOCAL_CUTOFF_HOUR) {
            stats.skippedPastSafeLocalCutoff += 1;
          } else if (sendWindowEval.productFloorBlockedWithoutBypass) {
            stats.skippedPreferredWindowWaiting += 1;
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

      const retryOutsideWindow =
        bypassWindowGate &&
        !force &&
        (!sendWindowEval.sendTimeWindowOkWithoutBypass ||
          sendWindowEval.productFloorBlockedWithoutBypass);
      const schedulingTelemetry = buildDailySchedulingTelemetry({
        timezone,
        evaluation: sendWindowEval,
        retryOutsideWindow,
      });

      stats.eligible += 1;

      // STEP 2 & 3: Handle existing row or proceed to reserve
      if (existingEvent) {
        const hasMessageSid = hasAnyTwilioSidOnSendEvent(existingEvent);

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
            .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

          existingEvent = {
            ...existingEvent,
            status: "send_failed",
            metadata: recoveredMeta,
          };
        }

        // CASE A: send_failed with retries left (never retry after Twilio SID is known)
        if (existingEvent.status === "send_failed") {
          if (hasMessageSid) {
            stats.alreadyReservedOrSentToday += 1;
            stats.skippedIntentional += 1;
            continue;
          }

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
                  .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
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
                .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

              stats.skippedActiveInboundThread += 1;
              stats.skippedIntentional += 1;
              continue;
            }

            if (
              await applySundayWeeklyPauseBeforeWriterIfNeeded({
                clerkUserId: audienceUser.clerk_user_id,
                todayKey,
                localNow,
                timezone,
                now,
                force,
                fullyOnV2: skipLegacyDailyCompletionCheck,
                commitment: activeForPolicy,
                commsPrefs,
                existingMeta,
              })
            ) {
              stats.skippedSundayWeeklyPause += 1;
              stats.skippedIntentional += 1;
              continue;
            }

            stage = "build_content";
            const tylerTextOverviewBuild = await prepareTylerTextOverviewDailyBuild({
              clerkUserId: audienceUser.clerk_user_id,
              draftForDayKey: todayKey,
              now,
              build: (overrideBody) =>
                buildDailySmsContent(
                  audienceUser.clerk_user_id,
                  md as Record<string, unknown>,
                  todayKey,
                  audienceUser.timezone,
                  overrideBody ? { tylerTextOverviewOverrideBody: overrideBody } : undefined
                ),
            });
            const builtRaw = tylerTextOverviewBuild.builtMainRaw;
            let tylerTextOverviewCtx = tylerTextOverviewBuild.sendContext;
            const tylerDraftBodyUsed = tylerTextOverviewBuild.draftBodyUsed;
            if (
              await blockSendOnTtoCurrentDraftRouteConflict({
                builtRaw,
                tylerTextOverviewCtx,
                tylerDraftBodyUsed,
                clerkUserId: audienceUser.clerk_user_id,
                todayKey,
                existingMeta,
                timezone,
                localNow,
              })
            ) {
              stats.skippedUnexpected += 1;
              stats.skippedIntentional += 1;
              continue;
            }
            const gatedBuild = await applyDailySmsBuiltAfterTylerTextOverview({
              builtRaw,
              tylerTextOverviewCtx,
              tylerDraftBodyUsed,
              localHour: computedLocalHour,
            });
            const built = gatedBuild.built;
            tylerTextOverviewCtx = gatedBuild.tylerTextOverviewCtx;
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
                  .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
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
                  .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
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
                  .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
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
                  .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
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
                  .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
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
                      ...(built.dailyLaneMeta?.skip_source
                        ? { skip_source: built.dailyLaneMeta.skip_source }
                        : { skip_source: "lane_no_send" }),
                      ...(built.dailyLaneMeta
                        ? {
                            relationship_packet_observability:
                              relationshipObservabilityFromLaneMetadata(built.dailyLaneMeta),
                          }
                        : {}),
                    },
                  })
                  .eq("clerk_user_id", audienceUser.clerk_user_id)
                  .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
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
                .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
              stats.failed += 1;
              stats.sendFailed += 1;
              stats.skippedUnexpected += 1;
              continue;
            }
            if (
              await applySundayWeeklyPauseSuppressionIfNeeded({
                built,
                clerkUserId: audienceUser.clerk_user_id,
                todayKey,
                localNow,
                timezone,
                now,
                force,
                fullyOnV2: skipLegacyDailyCompletionCheck,
                commitment: activeForPolicy,
                commsPrefs,
                existingMeta,
              })
            ) {
              stats.skippedSundayWeeklyPause += 1;
              stats.skippedIntentional += 1;
              continue;
            }
            const revalidatedRetry = await applyTtoCurrentDraftRevalidationBeforeTwilio({
              built,
              tylerTextOverviewCtx,
              tylerDraftBodyUsed,
              clerkUserId: audienceUser.clerk_user_id,
              todayKey,
              existingMeta,
              timezone,
              localNow,
            });
            if (revalidatedRetry.blocked) {
              stats.skippedUnexpected += 1;
              stats.skippedIntentional += 1;
              continue;
            }
            const builtAfterRevalidation = revalidatedRetry.built;
            tylerTextOverviewCtx = revalidatedRetry.tylerTextOverviewCtx;
            if (
              await blockSendOnTtoCurrentDraftBodyMismatch({
                built: builtAfterRevalidation,
                tylerTextOverviewCtx,
                tylerDraftBodyUsed,
                clerkUserId: audienceUser.clerk_user_id,
                todayKey,
                existingMeta,
                timezone,
                localNow,
              })
            ) {
              stats.skippedUnexpected += 1;
              stats.skippedIntentional += 1;
              continue;
            }
            const smsBody = builtAfterRevalidation.ok ? builtAfterRevalidation.smsBody : "";
            const v2AccountabilityRetry = builtAfterRevalidation.ok
              ? builtAfterRevalidation.v2Accountability
              : undefined;

            if (isDailySmsWithheldByFinalVoiceGate(built)) {
              const voiceSendDecisionRetry = built.v2AiPayload?.voice_send_decision as
                | Record<string, unknown>
                | undefined;
              const northStarGateR = (built.v2AiPayload?.north_star_gate ?? {}) as Record<string, unknown>;
              const finalVoiceGateR = (built.v2AiPayload?.final_voice_gate ?? {}) as Record<string, unknown>;
              const patchR = withRelationshipPacketObservabilityOnVoiceSkipPatch(
                dailySmsVoiceSkipEventPatch({
                existingMeta: mergeTylerTextOverviewSendMetadata(
                  existingMeta,
                  tylerTextOverviewMetadataForSend(tylerTextOverviewCtx, null)
                ),
                northStarGate: northStarGateR,
                finalVoiceGate: finalVoiceGateR,
                channel: (voiceSendDecisionRetry?.voice_channel as NorthStarCoachChannel | undefined) ?? "daily_outbound",
                timezone,
                localTimeIso: localNow.toISOString(),
                blockedReasons: (voiceSendDecisionRetry?.blocked_reasons as string[] | undefined) ?? [],
                northStarVisibleBody: voiceSendDecisionRetry?.north_star_visible_body as string | undefined,
                skipSource: voiceSendDecisionRetry?.skip_source as string | undefined,
                unifiedFinalGuard:
                  voiceSendDecisionRetry?.unified_final_product_law_guard != null &&
                  typeof voiceSendDecisionRetry.unified_final_product_law_guard === "object"
                    ? (voiceSendDecisionRetry.unified_final_product_law_guard as Record<string, unknown>)
                    : null,
                routeKind: (voiceSendDecisionRetry?.daily_route_kind as string | undefined) ?? null,
                noSendReason:
                  (voiceSendDecisionRetry?.no_send_reason as string | undefined) ??
                  (voiceSendDecisionRetry?.skip_reason as string | undefined) ??
                  null,
                contractProposalKind: built.v2ContractProposalMode
                  ? (built.v2ContractProposalKind ?? null)
                  : null,
                proposalNoSendReason: built.v2ContractProposalMode
                  ? ((voiceSendDecisionRetry?.proposal_no_send_reason as string | undefined) ??
                    (voiceSendDecisionRetry?.no_send_reason as string | undefined) ??
                    null)
                  : null,
                pendingReminderNoSendReason: built.v2PendingResolutionReminder
                  ? ((voiceSendDecisionRetry?.pending_reminder_no_send_reason as string | undefined) ??
                    (voiceSendDecisionRetry?.no_send_reason as string | undefined) ??
                    null)
                  : null,
                pendingResolutionKind: built.v2PendingResolutionReminder
                  ? (built.dailyUnifiedGuardCtx?.pendingResolutionFacts?.resolutionKind ?? null)
                  : null,
                pendingExpiredClearedBeforeBuild: built.v2PendingResolutionReminder
                  ? Boolean(
                      built.dailyUnifiedGuardCtx?.pendingResolutionFacts
                        ?.pendingExpiredClearedBeforeBuild
                    )
                  : undefined,
                refreshNoSendReason: built.v2RefreshOutboundPlan
                  ? ((voiceSendDecisionRetry?.refresh_no_send_reason as string | undefined) ??
                    (voiceSendDecisionRetry?.no_send_reason as string | undefined) ??
                    null)
                  : null,
                refreshStep: built.v2RefreshOutboundPlan
                  ? ((voiceSendDecisionRetry?.refresh_step as string | undefined) ??
                    built.dailyUnifiedGuardCtx?.refreshGuardFacts?.refreshStep ??
                    built.v2RefreshOutboundPlan.kind)
                  : null,
                refreshStaleSessionAbandonedBeforeBuild: built.v2RefreshOutboundPlan
                  ? Boolean(
                      built.dailyUnifiedGuardCtx?.refreshGuardFacts
                        ?.refreshStaleSessionAbandonedBeforeBuild
                    )
                  : undefined,
              }),
                built.v2AiPayload?.v3_brain
              );
              await supabaseServer
                .from("sms_send_events")
                .update(patchR)
                .eq("clerk_user_id", audienceUser.clerk_user_id)
                .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
              if (tylerDraftBodyUsed && tylerTextOverviewCtx?.lookup.draft_id) {
                await markTylerTextOverviewDraftSkippedAfterGuard({
                  draftId: tylerTextOverviewCtx.lookup.draft_id,
                  clerkUserId: audienceUser.clerk_user_id,
                  dayKey: todayKey,
                });
              }
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
                .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
              stats.failed += 1;
              stats.sendFailed += 1;
              stats.skippedUnexpected += 1;
              continue;
            }

            const retrySendWindow = localHourToSendWindow(computedLocalHour);
            const retrySuccessPayload = dailySmsTwilioSuccessSendEventFields({
              messageSid: retryMessage.sid,
              twilioStatus: retryMessage.status,
              smsBody,
              metadata: {
                ...existingMeta,
                ...schedulingTelemetry,
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
                ...mergeTylerTextOverviewSendMetadata(
                  {},
                  tylerTextOverviewMetadataForSend(tylerTextOverviewCtx, smsBody)
                ),
              },
            });
            const recordResult = await recordDailyTwilioSuccessOrFallback({
              clerkUserId: audienceUser.clerk_user_id,
              dayKey: todayKey,
              pathLabel: "retry",
              primaryPayload: retrySuccessPayload,
              messageSid: retryMessage.sid,
              smsBody,
              twilioStatus: retryMessage.status,
            });
            if (recordResult.recordOk) {
              if (!recordResult.usedFallback) {
                await writeV2SmsThreadMemoryAfterDailyV3Outbound({
                  built,
                  clerkUserId: audienceUser.clerk_user_id,
                  sentBody: smsBody,
                  messageSid: retryMessage.sid,
                  sentAt: new Date(),
                });
              }
              stats.sent += 1;
              stats.retried += 1;
              await finalizeTylerTextOverviewAfterOutboundBestEffort({
                ctx: tylerTextOverviewCtx,
                draftBodyUsed: tylerDraftBodyUsed,
                clerkUserId: audienceUser.clerk_user_id,
                dayKey: todayKey,
                smsBody,
                messageSid: retryMessage.sid,
              });
              if (!recordResult.usedFallback && built.v2ReactivationNudge && built.v2CommitmentId) {
                await updateReactivationLastSentAt(built.v2CommitmentId);
                await recomputeV2CoachingMemory(built.v2CommitmentId, {
                  reasonCode: "daily_sms_reactivation_nudge_sent",
                });
              } else if (
                !recordResult.usedFallback &&
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
                !recordResult.usedFallback &&
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
            } else if (recordResult.orphanLogged) {
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

      // Silence Cadence V1 gate + optional v2 cadence (normal_daily only).
      stage = "silence_cadence_gate";
      let activeCadence = await getActiveCommitment(audienceUser.clerk_user_id);
      if (activeCadence?.behavior_statement?.trim()) {
        await clearStaleAdaptiveContractColumns(activeCadence.id);
        const refreshedCadence = await getActiveCommitment(audienceUser.clerk_user_id);
        if (refreshedCadence?.behavior_statement?.trim()) {
          activeCadence = refreshedCadence;
        }
        const nowCadence = new Date();

        const silenceCadence = await resolveSilenceCadenceForDailyUser({
          clerkUserId: audienceUser.clerk_user_id,
          commitmentId: activeCadence.id,
          commitmentStartedAt: activeCadence.started_at,
          todayLocalDayKey: todayKey,
          timezone,
        });

        if (!silenceCadence.send_today) {
          stats.skippedSilenceCadenceSpace += 1;
          stats.skippedIntentional += 1;
          continue;
        }

        const userCadenceOverride = shouldApplyUserCadenceOverride(commsPrefs, nowCadence);

        if (silenceCadence.route === "normal_daily") {
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
            .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

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
                  .eq("day_key", todayKey)
                  .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

        stats.skippedActiveInboundThread += 1;
        stats.skippedIntentional += 1;
        continue;
      }

      if (
        await applySundayWeeklyPauseBeforeWriterIfNeeded({
          clerkUserId: audienceUser.clerk_user_id,
          todayKey,
          localNow,
          timezone,
          now,
          force,
          fullyOnV2: skipLegacyDailyCompletionCheck,
          commitment: activeForPolicy,
          commsPrefs,
        })
      ) {
        stats.skippedSundayWeeklyPause += 1;
        stats.skippedIntentional += 1;
        continue;
      }

      stage = "build_content";
      const tylerTextOverviewBuild = await prepareTylerTextOverviewDailyBuild({
        clerkUserId: audienceUser.clerk_user_id,
        draftForDayKey: todayKey,
        now,
        build: (overrideBody) =>
          buildDailySmsContent(
            audienceUser.clerk_user_id,
            md as Record<string, unknown>,
            todayKey,
            audienceUser.timezone,
            overrideBody ? { tylerTextOverviewOverrideBody: overrideBody } : undefined
          ),
      });
      const builtMainRaw = tylerTextOverviewBuild.builtMainRaw;
      let tylerTextOverviewCtx = tylerTextOverviewBuild.sendContext;
      const tylerDraftBodyUsed = tylerTextOverviewBuild.draftBodyUsed;
      if (
        await blockSendOnTtoCurrentDraftRouteConflict({
          builtRaw: builtMainRaw,
          tylerTextOverviewCtx,
          tylerDraftBodyUsed,
          clerkUserId: audienceUser.clerk_user_id,
          todayKey,
          existingMeta: { note: "reserved_by_cron" },
          timezone,
          localNow,
        })
      ) {
        stats.skippedUnexpected += 1;
        stats.skippedIntentional += 1;
        continue;
      }
      const gatedMainBuild = await applyDailySmsBuiltAfterTylerTextOverview({
        builtRaw: builtMainRaw,
        tylerTextOverviewCtx,
        tylerDraftBodyUsed,
        localHour: computedLocalHour,
      });
      const builtMain = gatedMainBuild.built;
      tylerTextOverviewCtx = gatedMainBuild.tylerTextOverviewCtx;
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
            .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
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
            .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
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
            .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
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
            .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
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
            .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
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
                ...(builtMain.dailyLaneMeta?.skip_source
                  ? { skip_source: builtMain.dailyLaneMeta.skip_source }
                  : { skip_source: "lane_no_send" }),
                ...(builtMain.dailyLaneMeta
                  ? {
                      relationship_packet_observability: relationshipObservabilityFromLaneMetadata(
                        builtMain.dailyLaneMeta
                      ),
                    }
                  : {}),
              },
            })
            .eq("clerk_user_id", audienceUser.clerk_user_id)
            .eq("day_key", todayKey)
            .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
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
                  .eq("day_key", todayKey)
                  .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
        stats.failed += 1;
        stats.sendFailed += 1;
        stats.skippedUnexpected += 1;
        continue;
      }
      if (
        await applySundayWeeklyPauseSuppressionIfNeeded({
          built: builtMain,
          clerkUserId: audienceUser.clerk_user_id,
          todayKey,
          localNow,
          timezone,
          now,
          force,
          fullyOnV2: skipLegacyDailyCompletionCheck,
          commitment: activeForPolicy,
          commsPrefs,
        })
      ) {
        stats.skippedSundayWeeklyPause += 1;
        stats.skippedIntentional += 1;
        continue;
      }
      const revalidatedMain = await applyTtoCurrentDraftRevalidationBeforeTwilio({
        built: builtMain,
        tylerTextOverviewCtx,
        tylerDraftBodyUsed,
        clerkUserId: audienceUser.clerk_user_id,
        todayKey,
        existingMeta: { note: "reserved_by_cron" },
        timezone,
        localNow,
      });
      if (revalidatedMain.blocked) {
        stats.skippedUnexpected += 1;
        stats.skippedIntentional += 1;
        continue;
      }
      const builtMainAfterRevalidation = revalidatedMain.built;
      tylerTextOverviewCtx = revalidatedMain.tylerTextOverviewCtx;
      if (
        await blockSendOnTtoCurrentDraftBodyMismatch({
          built: builtMainAfterRevalidation,
          tylerTextOverviewCtx,
          tylerDraftBodyUsed,
          clerkUserId: audienceUser.clerk_user_id,
          todayKey,
          existingMeta: { note: "reserved_by_cron" },
          timezone,
          localNow,
        })
      ) {
        stats.skippedUnexpected += 1;
        stats.skippedIntentional += 1;
        continue;
      }
      const smsBody = builtMainAfterRevalidation.ok ? builtMainAfterRevalidation.smsBody : "";
      const v2AccountabilityMain = builtMainAfterRevalidation.ok
        ? builtMainAfterRevalidation.v2Accountability
        : undefined;

      if (isDailySmsWithheldByFinalVoiceGate(builtMain)) {
        const voiceSendDecision = builtMain.v2AiPayload?.voice_send_decision as
          | Record<string, unknown>
          | undefined;
        const northStarGate = (builtMain.v2AiPayload?.north_star_gate ?? {}) as Record<string, unknown>;
        const finalVoiceGate = (builtMain.v2AiPayload?.final_voice_gate ?? {}) as Record<string, unknown>;
        const patch = withRelationshipPacketObservabilityOnVoiceSkipPatch(
          dailySmsVoiceSkipEventPatch({
          existingMeta: mergeTylerTextOverviewSendMetadata(
            { note: "reserved_by_cron" },
            tylerTextOverviewMetadataForSend(tylerTextOverviewCtx, null)
          ),
          northStarGate,
          finalVoiceGate,
          channel: (voiceSendDecision?.voice_channel as NorthStarCoachChannel | undefined) ?? "daily_outbound",
          timezone,
          localTimeIso: localNow.toISOString(),
          blockedReasons: (voiceSendDecision?.blocked_reasons as string[] | undefined) ?? [],
          northStarVisibleBody: voiceSendDecision?.north_star_visible_body as string | undefined,
          skipSource: voiceSendDecision?.skip_source as string | undefined,
          unifiedFinalGuard:
            voiceSendDecision?.unified_final_product_law_guard != null &&
            typeof voiceSendDecision.unified_final_product_law_guard === "object"
              ? (voiceSendDecision.unified_final_product_law_guard as Record<string, unknown>)
              : null,
          routeKind: (voiceSendDecision?.daily_route_kind as string | undefined) ?? null,
          noSendReason:
            (voiceSendDecision?.no_send_reason as string | undefined) ??
            (voiceSendDecision?.skip_reason as string | undefined) ??
            null,
          contractProposalKind: builtMain.v2ContractProposalMode
            ? (builtMain.v2ContractProposalKind ?? null)
            : null,
          proposalNoSendReason: builtMain.v2ContractProposalMode
            ? ((voiceSendDecision?.proposal_no_send_reason as string | undefined) ??
              (voiceSendDecision?.no_send_reason as string | undefined) ??
              null)
            : null,
          pendingReminderNoSendReason: builtMain.v2PendingResolutionReminder
            ? ((voiceSendDecision?.pending_reminder_no_send_reason as string | undefined) ??
              (voiceSendDecision?.no_send_reason as string | undefined) ??
              null)
            : null,
          pendingResolutionKind: builtMain.v2PendingResolutionReminder
            ? (builtMain.dailyUnifiedGuardCtx?.pendingResolutionFacts?.resolutionKind ?? null)
            : null,
          pendingExpiredClearedBeforeBuild: builtMain.v2PendingResolutionReminder
            ? Boolean(
                builtMain.dailyUnifiedGuardCtx?.pendingResolutionFacts?.pendingExpiredClearedBeforeBuild
              )
            : undefined,
          refreshNoSendReason: builtMain.v2RefreshOutboundPlan
            ? ((voiceSendDecision?.refresh_no_send_reason as string | undefined) ??
              (voiceSendDecision?.no_send_reason as string | undefined) ??
              null)
            : null,
          refreshStep: builtMain.v2RefreshOutboundPlan
            ? ((voiceSendDecision?.refresh_step as string | undefined) ??
              builtMain.dailyUnifiedGuardCtx?.refreshGuardFacts?.refreshStep ??
              builtMain.v2RefreshOutboundPlan.kind)
            : null,
          refreshStaleSessionAbandonedBeforeBuild: builtMain.v2RefreshOutboundPlan
            ? Boolean(
                builtMain.dailyUnifiedGuardCtx?.refreshGuardFacts?.refreshStaleSessionAbandonedBeforeBuild
              )
            : undefined,
        }),
          builtMain.v2AiPayload?.v3_brain
        );
        await supabaseServer
          .from("sms_send_events")
          .update(patch)
          .eq("clerk_user_id", audienceUser.clerk_user_id)
                  .eq("day_key", todayKey)
                  .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);
        if (tylerDraftBodyUsed && tylerTextOverviewCtx?.lookup.draft_id) {
          await markTylerTextOverviewDraftSkippedAfterGuard({
            draftId: tylerTextOverviewCtx.lookup.draft_id,
            clerkUserId: audienceUser.clerk_user_id,
            dayKey: todayKey,
          });
        }
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
                  .eq("day_key", todayKey)
                  .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

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
                  .eq("day_key", todayKey)
                  .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT);

        stats.failed += 1;
        stats.sendFailed += 1;
        stats.skippedUnexpected += 1;
      }

      if (mainMessage) {
        const mainSendWindow = localHourToSendWindow(computedLocalHour);
        const mainSuccessPayload = dailySmsTwilioSuccessSendEventFields({
          messageSid: mainMessage.sid,
          twilioStatus: mainMessage.status,
          smsBody,
          metadata: {
            ...schedulingTelemetry,
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
            ...mergeTylerTextOverviewSendMetadata(
              {},
              tylerTextOverviewMetadataForSend(tylerTextOverviewCtx, smsBody)
            ),
          },
        });
        const recordResult = await recordDailyTwilioSuccessOrFallback({
          clerkUserId: audienceUser.clerk_user_id,
          dayKey: todayKey,
          pathLabel: "main",
          primaryPayload: mainSuccessPayload,
          messageSid: mainMessage.sid,
          smsBody,
          twilioStatus: mainMessage.status,
        });
        if (recordResult.recordOk) {
          if (!recordResult.usedFallback) {
            await writeV2SmsThreadMemoryAfterDailyV3Outbound({
              built: builtMain,
              clerkUserId: audienceUser.clerk_user_id,
              sentBody: smsBody,
              messageSid: mainMessage.sid,
              sentAt: new Date(),
            });
          }
          stats.sent += 1;
          await finalizeTylerTextOverviewAfterOutboundBestEffort({
            ctx: tylerTextOverviewCtx,
            draftBodyUsed: tylerDraftBodyUsed,
            clerkUserId: audienceUser.clerk_user_id,
            dayKey: todayKey,
            smsBody,
            messageSid: mainMessage.sid,
          });
          if (!recordResult.usedFallback && builtMain.v2ReactivationNudge && builtMain.v2CommitmentId) {
            await updateReactivationLastSentAt(builtMain.v2CommitmentId);
            await recomputeV2CoachingMemory(builtMain.v2CommitmentId, {
              reasonCode: "daily_sms_reactivation_nudge_sent",
            });
          } else if (
            !recordResult.usedFallback &&
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
            !recordResult.usedFallback &&
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
        } else if (recordResult.orphanLogged) {
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