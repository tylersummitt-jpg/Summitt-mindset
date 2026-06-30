// src/app/api/cron/weekly-sms/route.ts

import crypto from "crypto";
import { NextResponse } from "next/server";
import { listClerkUsers } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { resolveUserTimezone } from "@/lib/timezone";
import { generateWeeklySmsReflection } from "@/lib/weekly-sms-reflection-shadow";
import { getWeekKey } from "@/lib/weekly-sms-week-key";
import { sendSMS, isTwilioReady } from "@/lib/twilio";
import { resolveUserFullyOnV2ForCutoverMessaging } from "@/lib/v2-cutover-gates";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { getActiveCommitment } from "@/lib/v2-commitment";
import { isSmsInboundPendingResolutionActionable } from "@/lib/v2-guided-resolution";
import {
  buildDeterministicWeeklyProofBody,
  buildV2WeeklyProofPack,
  generateV2WeeklyProofSmsBody,
  V2_WEEKLY_PROOF_PROMPT_VERSION,
} from "@/lib/v2-weekly-proof-sms";
import {
  buildV2SmsConversationContextPack,
  type V2SmsConversationContextPack,
} from "@/lib/v2-sms-conversation-context";
import { NORTH_STAR_SMS_LONG_FORM_MAX_LEN, pickNorthStarWriterAttributionFields } from "@/lib/north-star-coach-sms";
import { buildWeeklySmsNorthStarContextPacket } from "@/lib/north-star-sms-context-packet";
import { finalizeNorthStarCoachSmsAsync } from "@/lib/north-star-coach-sms-openai";
import { appendPreservedSmsSuffix, applyFinalVoiceOwnershipGate } from "@/lib/v3-sms-voice-ownership";
import {
  applyUnifiedSmsFinalProductLawGuard,
  compactUnifiedFinalGuardForTelemetry,
  UNIFIED_FINAL_BODY_AUTHORITY,
} from "@/lib/sms-final-product-law-guard";
import {
  buildWeeklyOutboundOcegEvidence,
  buildWeeklyOutboundUnifiedGuardCtx,
} from "@/lib/weekly-outbound-final-guard-evidence";
import {
  buildSmsRelationshipMemoryPacket,
  slimMemoryPacketForFacts,
} from "@/lib/sms-relationship-memory-packet";
import {
  loadSmsVictoryBackgroundContext,
  mapSmsVictoryBackgroundToFacts,
} from "@/lib/sms-victory-background-context";
import { loadRecentPlannedInterruptionSignalForCommitment } from "@/lib/sms-planned-interruption";
import {
  fetchV2UserSmsCommsPreferences,
  shouldSkipWeeklyForCommsPrefs,
} from "@/lib/v2-sms-comms-preferences";
import { produceWeeklyV3RelationshipSms } from "@/lib/v3-weekly-outbound-relationship-lane";
import { buildWeeklyV3OutboundFactsForV2WeeklyProof } from "@/lib/weekly-sms-v2-weekly-lane-facts";
import { upsertCommitmentSmsThreadMemoryFromOutbound } from "@/lib/v2-commitment-sms-thread-memory";
import { relationshipObservabilityFromLaneMetadata } from "@/lib/sms-relationship-packet-v1";
import {
  buildWeeklyNotebookTelemetry,
  buildWeeklyThreadSourceBreakdownInputFromFacts,
  readIncludedThreadMessageCountFromWeeklyLaneMetadata,
  attachWeeklyNotebookVerdictToMetadata,
} from "@/lib/sms-weekly-notebook-telemetry";
import type { BriefThreadBuildTelemetry } from "@/lib/sms-recent-exact-thread-72h";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON_SECRET = process.env.CRON_SECRET;
const ENV_SMS_DRY_RUN = process.env.SMS_DRY_RUN === "true";

const WEEKLY_SMS_COMPLIANCE_FOOTER =
  "Reply STOP to opt out. Reply HELP for help.";

function weeklyWriterInvokedFromLane(metadata: Record<string, unknown>): boolean {
  const laneStage = metadata.lane_stage;
  if (laneStage === "no_client") return false;
  return laneStage != null && typeof laneStage === "string";
}

/** Re-finalize weekly notebook verdict after no-send / FVG metadata is merged (telemetry only). */
function enrichWeeklyPersistenceMetadata(
  base: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return attachWeeklyNotebookVerdictToMetadata({ ...base, ...extra });
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

  return false;
}

/**
 * ======================================================
 * Sunday 12PM (noon) Local Logic
 * ======================================================
 */
function shouldSendNow(local: Date) {
  return (
    local.getDay() === 0 && // Sunday
    local.getHours() === 12 &&
    local.getMinutes() < 15
  );
}

/** M2B-2: persist durable thread memory after Twilio accepted a V3 weekly relationship lane SMS. */
async function writeV2SmsThreadMemoryAfterWeeklyV3Outbound(args: {
  commitmentId: string;
  clerkUserId: string;
  coachBodyForMemory: string;
  messageSid: string | null;
  sentAt?: Date;
}): Promise<{ ok: true; error: null } | { ok: false; error: string }> {
  const coachBodyForMemory = args.coachBodyForMemory.trim();
  if (!coachBodyForMemory) {
    console.warn("[weekly-sms] v2_sms_thread_memory_outbound_upsert_failed", {
      clerk_user_id: args.clerkUserId,
      commitment_id: args.commitmentId,
      message_sid: args.messageSid,
      error: "empty_weekly_body",
    });
    return { ok: false, error: "empty_weekly_body" };
  }

  const result = await upsertCommitmentSmsThreadMemoryFromOutbound({
    commitmentId: args.commitmentId,
    clerkUserId: args.clerkUserId,
    sentBody: coachBodyForMemory,
    sentAt: args.sentAt ?? new Date(),
    messageSid: args.messageSid,
    source: "weekly_sms",
    expectedAnswerType: null,
  });

  if (!result.ok) {
    console.warn("[weekly-sms] v2_sms_thread_memory_outbound_upsert_failed", {
      clerk_user_id: args.clerkUserId,
      commitment_id: args.commitmentId,
      message_sid: args.messageSid,
      error: result.error,
    });
    return { ok: false, error: result.error };
  }

  return { ok: true, error: null };
}

export async function GET(req: Request) {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const dryRunOverride = url.searchParams.get("dryRun") === "1";
  const SMS_DRY_RUN = ENV_SMS_DRY_RUN || dryRunOverride;

  const stats = {
    scanned: 0,
    eligible: 0,
    reserved: 0,
    sent: 0,
    dryRun: 0,
    skippedNotTime: 0,
    skippedOptedOut: 0,
    skippedMissingIdentity: 0,
    skippedMissingTwilio: 0,
    /** Legacy-only counter retained at 0 — V2 weekly proof ships separately below. */
    skippedV2WeeklyDeferred: 0,
    v2WeeklyEligible: 0,
    skippedV2WeeklyPendingResolution: 0,
    skippedV2WeeklyDuplicate: 0,
    skippedV2WeeklyUserPause: 0,
    sentV2WeeklyProof: 0,
    skippedNoSafeV3Voice: 0,
    skippedLegacyWeeklyDeprecated: 0,
    failed: 0,
  };

  const pageLimit = 200;
  let offset = 0;

  while (true) {
    const users = await listClerkUsers({ limit: pageLimit, offset });
    if (!users || users.length === 0) break;

    for (const user of users) {
      stats.scanned++;

      const md = user.public_metadata || {};

      if (md.summittSubscribed !== true) continue;
      if (md.smsEnabled !== true) continue;

      const { data: identity } = await supabaseServer
        .from("sms_identities")
        .select("phone_number, sms_enabled, stopped_at")
        .eq("clerk_user_id", user.id)
        .maybeSingle();

      if (!identity?.phone_number) {
        stats.skippedMissingIdentity++;
        continue;
      }

      if (identity.sms_enabled !== true || identity.stopped_at) {
        stats.skippedOptedOut++;
        continue;
      }

      const timezone = resolveUserTimezone(md.timezone);
      const now = new Date();

      const localNow = new Date(
        now.toLocaleString("en-US", { timeZone: timezone })
      );

      if (!force && !shouldSendNow(localNow)) {
        stats.skippedNotTime++;
        continue;
      }

      const v2Gate = await resolveUserFullyOnV2ForCutoverMessaging(user.id);
      if (v2Gate.fullyOnV2) {
        stats.v2WeeklyEligible += 1;
        const weekKeyV2 = getWeekKey(localNow);
        const commitment = await getActiveCommitment(user.id);
        if (!commitment?.id) {
          continue;
        }
        if (isSmsInboundPendingResolutionActionable(commitment)) {
          stats.skippedV2WeeklyPendingResolution += 1;
          continue;
        }

        const weeklyCommsPrefs = await fetchV2UserSmsCommsPreferences(user.id);
        if (shouldSkipWeeklyForCommsPrefs(weeklyCommsPrefs, now)) {
          stats.skippedV2WeeklyUserPause += 1;
          continue;
        }

        const { error: v2ResErr } = await supabaseServer
          .from("sms_weekly_send_events")
          .insert({
            clerk_user_id: user.id,
            week_key: weekKeyV2,
            status: "reserved",
          });

        if (v2ResErr) {
          stats.skippedV2WeeklyDuplicate += 1;
          continue;
        }

        const pack = await buildV2WeeklyProofPack({
          clerkUserId: user.id,
          commitment,
          localNow,
          timezone,
        });
        let weeklySmsThreadAppend: string | null = null;
        let convForNorthStar: V2SmsConversationContextPack | null = null;
        try {
          const conv = await buildV2SmsConversationContextPack({
            clerkUserId: user.id,
            commitmentId: commitment.id,
            commitment,
            timezone,
          });
          convForNorthStar = conv;
          weeklySmsThreadAppend = conv.recentTranscriptLines.slice(-5).join(" | ").slice(0, 700);
        } catch (e) {
          console.warn("[weekly-sms] sms_conversation_context_pack_failed", {
            commitment_id: commitment.id,
            message: e instanceof Error ? e.message : String(e),
          });
        }
        const { body: oldProofPreviewBody, aiUsed } = await generateV2WeeklyProofSmsBody(pack, {
          recentSmsThreadAppend: weeklySmsThreadAppend,
        });
        const deterministicPreviewBody = buildDeterministicWeeklyProofBody(pack);
        let relationshipMemoryPacket = null;
        let weeklyMemoryPacketBuildFailed = false;
        let weeklyMemoryPacketThreadTelemetry: BriefThreadBuildTelemetry | null = null;
        try {
          const memoryPacket = await buildSmsRelationshipMemoryPacket({
            clerkUserId: user.id,
            commitmentId: commitment.id,
            now: localNow,
          });
          weeklyMemoryPacketThreadTelemetry =
            memoryPacket.meta.thread_build_telemetry ??
            memoryPacket.recent_exact_thread_72h.build_telemetry ??
            null;
          relationshipMemoryPacket = slimMemoryPacketForFacts(memoryPacket);
        } catch (e) {
          weeklyMemoryPacketBuildFailed = true;
          console.warn("[weekly-sms] relationship_memory_packet_failed", {
            commitment_id: commitment.id,
            clerk_user_id: user.id,
            message: e instanceof Error ? e.message : String(e),
          });
        }
        let victoryBackgroundFacts = null;
        try {
          victoryBackgroundFacts = mapSmsVictoryBackgroundToFacts(
            await loadSmsVictoryBackgroundContext({
              clerkUserId: user.id,
              commitmentId: commitment.id,
              timezone,
            })
          );
        } catch (e) {
          console.warn("[weekly-sms] victory_background_load_failed", {
            clerk_user_id: user.id,
            commitment_id: commitment.id,
            message: e instanceof Error ? e.message : String(e),
          });
        }

        let plannedInterruptionRow = null;
        try {
          plannedInterruptionRow = await loadRecentPlannedInterruptionSignalForCommitment({
            commitmentId: commitment.id,
            clerkUserId: user.id,
            now: localNow,
          });
        } catch (e) {
          console.warn("[weekly-sms] planned_interruption_load_failed", {
            clerk_user_id: user.id,
            commitment_id: commitment.id,
            message: e instanceof Error ? e.message : String(e),
          });
        }

        const weeklyV3TelemetryFactSources = [
          "v2_weekly_proof_pack",
          aiUsed ? "v2_weekly_proof_openai_preview" : "v2_weekly_proof_preview_no_openai",
          "v2_weekly_proof_deterministic_preview",
          ...(convForNorthStar ? (["v2_sms_conversation_context_pack"] as const) : []),
          ...(relationshipMemoryPacket ? (["sms_relationship_memory_packet"] as const) : []),
          ...(victoryBackgroundFacts ? (["loadSmsVictoryBackgroundContext"] as const) : []),
          ...(plannedInterruptionRow
            ? (["loadRecentPlannedInterruptionSignalForCommitment"] as const)
            : []),
          "deriveSmsGoalAdjustmentSignal",
        ];
        const weeklyFacts = buildWeeklyV3OutboundFactsForV2WeeklyProof({
          clerkUserId: user.id,
          commitment,
          effectiveAsk: getEffectiveCoachingAsk(commitment, Date.now()),
          pack,
          timezone,
          localNow,
          conv: convForNorthStar,
          weeklySmsThreadAppend,
          oldWeeklyProofBodyPreview: oldProofPreviewBody,
          deterministicWeeklyBodyPreview: deterministicPreviewBody,
          relationshipMemoryPacket,
          victoryBackground: victoryBackgroundFacts,
          plannedInterruption: plannedInterruptionRow,
        });
        const weeklyLane = await produceWeeklyV3RelationshipSms({
          facts: weeklyFacts,
          commitmentRow: commitment,
          telemetry_fact_sources: weeklyV3TelemetryFactSources,
        });

        const includedThreadMessageCount = readIncludedThreadMessageCountFromWeeklyLaneMetadata(
          weeklyLane.metadata
        );
        const weeklyWriterInvoked = weeklyWriterInvokedFromLane(weeklyLane.metadata);
        const weeklyNotebookTelemetry = buildWeeklyNotebookTelemetry({
          buildTelemetry: weeklyMemoryPacketThreadTelemetry,
          memoryPacketUsed: relationshipMemoryPacket != null,
          memoryPacketBuildFailed: weeklyMemoryPacketBuildFailed,
          includedThreadMessageCount,
          writerInvoked: weeklyWriterInvoked,
          sourceBreakdown: buildWeeklyThreadSourceBreakdownInputFromFacts({
            recentExactThread72hMessages: weeklyFacts.thread.recent_exact_thread_72h?.messages,
            recentTranscriptLineCount: weeklyFacts.thread.recent_transcript_lines.length,
            hasRecentExactThreadText: Boolean(weeklyFacts.thread.recent_exact_thread_text?.trim()),
            includedThreadMessageCount,
            laneMetadata: weeklyLane.metadata,
          }),
        });

        const weeklyNorthStarCtx = buildWeeklySmsNorthStarContextPacket({
          commitmentId: commitment.id,
          behaviorStatement: commitment.behavior_statement,
          transcriptSnippet: weeklySmsThreadAppend,
          transcriptLines: convForNorthStar?.recentTranscriptLines.slice(-8),
        });

        const packTelemetryBase = {
          v2_weekly_proof_sms: true,
          commitment_id: commitment.id,
          week_start: pack.week_start,
          week_end: pack.week_end,
          yes_count: pack.yes_count,
          no_count: pack.no_count,
          partial_count: pack.partial_count,
          blocker_count: pack.blocker_count,
          check_sent_count: pack.check_sent_count,
          response_count: pack.response_count,
          silent_week: pack.silent_week,
          comeback_after_miss: pack.comeback_after_miss,
          ai_used: aiUsed,
          message_purpose: "weekly_proof_reflection",
          prompt_version: V2_WEEKLY_PROOF_PROMPT_VERSION,
          sms_context_pack_thread_used: Boolean(weeklySmsThreadAppend?.trim()),
          weekly_evolution_note_used: Boolean(pack.weekly_evolution_coaching_line?.trim()),
        };

        const weeklyV3MetaBase = enrichWeeklyPersistenceMetadata({
          weekly_v3_lane_used: true,
          secondary_v3_lane_used: true,
          route_purpose: "weekly_proof_v2" as const,
          v3_lane_reply_source: "v3_weekly_relationship_lane",
          v3_candidate_body: weeklyLane.metadata.v3_candidate_body ?? "",
          old_weekly_writer_used_as_voice: false,
          old_weekly_writer_fact_sources: weeklyV3TelemetryFactSources,
          weekly_facts_summary: weeklyLane.metadata.weekly_facts_summary,
          fully_on_v2: true,
          legacy_weekly_branch: false,
          weekly_lane_no_send_reason: weeklyLane.noSendReason,
          weekly_lane_openai_ok: weeklyLane.openAiOk,
          lane_stage: weeklyLane.metadata.lane_stage,
          weekly_lane_metadata: {
            ...weeklyLane.metadata,
            ...weeklyNotebookTelemetry,
          },
          ...weeklyNotebookTelemetry,
        });
        weeklyV3MetaBase.relationship_packet_observability = {
          ...relationshipObservabilityFromLaneMetadata({
            ...weeklyLane.metadata,
            ...weeklyV3MetaBase,
          }),
        };

        if (!weeklyLane.shouldSend) {
          await supabaseServer
            .from("sms_weekly_send_events")
            .update({
              status: "skipped_no_safe_v3_voice",
              metadata: enrichWeeklyPersistenceMetadata(packTelemetryBase, {
                ...weeklyV3MetaBase,
                no_send_tag: "weekly_v3_lane_no_send",
                no_send_reason: weeklyLane.noSendReason,
                voice_decision: "skipped_no_safe_v3_voice",
                twilio_send_attempted: false,
                compliance_suffix_preserved: false,
                compliance_footer_appended_after_fvg: false,
                fvg_policy_classification: "relationship_coaching",
                normal_coaching_policy_source: "phase4_2b_weekly_v2_lane_fail_closed",
              }),
            })
            .eq("clerk_user_id", user.id)
            .eq("week_key", weekKeyV2);
          stats.skippedNoSafeV3Voice += 1;
          continue;
        }

        const gatedWeeklyV2 = await finalizeNorthStarCoachSmsAsync({
          proposedBody: weeklyLane.body.trim(),
          channel: "weekly_sms",
          preserveNewlines: true,
          maxLen: NORTH_STAR_SMS_LONG_FORM_MAX_LEN,
          behaviorStatement: commitment.behavior_statement,
          effectiveAskText: commitment.behavior_statement?.trim() ?? undefined,
          contextPacket: weeklyNorthStarCtx,
          replySource: "v3_weekly_relationship_lane",
        });
        const voiceWeeklyV2 = await applyFinalVoiceOwnershipGate({
          proposedBody: gatedWeeklyV2.visibleBody,
          replySource: "v3_weekly_relationship_lane",
          channel: "weekly_sms",
          activeCommitmentId: commitment.id,
          effectiveAsk: commitment.behavior_statement,
          behaviorStatement: commitment.behavior_statement,
          contextPacket: weeklyNorthStarCtx,
          northStarMeta: gatedWeeklyV2.meta,
          v3BrainMetadata:
            weeklyLane.metadata.praise_policy_context &&
            typeof weeklyLane.metadata.praise_policy_context === "object"
              ? { praise_policy_context: weeklyLane.metadata.praise_policy_context }
              : undefined,
          /** Phase 4.1: weekly proof is relationship/coaching — always fail-closed FVG (never implicit missing-commitment bypass). */
          normalCoaching: true,
        });

        if (!voiceWeeklyV2.shouldSend) {
          await supabaseServer
            .from("sms_weekly_send_events")
            .update({
              status: "skipped_no_safe_v3_voice",
              metadata: enrichWeeklyPersistenceMetadata(packTelemetryBase, {
                ...weeklyV3MetaBase,
                no_send_tag: "final_voice_gate_no_send",
                no_send_reason: voiceWeeklyV2.skipReason ?? null,
                voice_decision: "skipped_no_safe_v3_voice",
                twilio_send_attempted: false,
                visible_sent: false,
                compliance_suffix_preserved: false,
                compliance_footer_appended_after_fvg: false,
                compliance_footer_appended: false,
                fvg_policy_classification: "relationship_coaching",
                normal_coaching_policy_source: "phase4_2b_weekly_v2_lane_fail_closed",
                north_star_gate: {
                  original_body: gatedWeeklyV2.meta.originalBody,
                  final_body: "",
                  north_star_gate_source: gatedWeeklyV2.meta.source,
                  north_star_gate_reasons: gatedWeeklyV2.meta.blockedReasons,
                  openai_attempted: gatedWeeklyV2.meta.openaiAttempted,
                  openai_failed_reason: gatedWeeklyV2.meta.openaiFailedReason ?? null,
                  context_packet_used: gatedWeeklyV2.meta.contextPacketUsed,
                  finalizer_version: gatedWeeklyV2.meta.finalizerVersion,
                  ...pickNorthStarWriterAttributionFields(gatedWeeklyV2.meta),
                },
                final_voice_gate: voiceWeeklyV2.metadata,
                voice_send_decision: {
                  should_send: false,
                  skip_reason: voiceWeeklyV2.skipReason ?? null,
                  blocked_reasons: voiceWeeklyV2.blockedReasons,
                  twilio_send_attempted: false,
                },
              }),
            })
            .eq("clerk_user_id", user.id)
            .eq("week_key", weekKeyV2);
          stats.skippedNoSafeV3Voice += 1;
          continue;
        }

        const weeklyUnifiedGuardCtx = buildWeeklyOutboundUnifiedGuardCtx({
          routeKind: "weekly_proof_v2",
          clerkUserId: user.id,
          commitmentId: commitment.id,
          pack,
          priorCoachBody: convForNorthStar?.lastOutboundPreview ?? null,
          priorCoachSentAt: null,
          effectiveAsk: getEffectiveCoachingAsk(commitment, Date.now()),
          identityAnchor: pack.identity_anchor_short,
          roughWeek: weeklyFacts.weekly_proof.rough_week,
        });
        const weeklyOcegEvidence = buildWeeklyOutboundOcegEvidence(weeklyUnifiedGuardCtx);
        const unifiedGuard = await applyUnifiedSmsFinalProductLawGuard({
          mode: "outbound_weekly",
          surface: "weekly",
          routePurpose: "weekly_proof_v2",
          branchName: "weekly_proof_v2",
          preGuardBodyPreview: voiceWeeklyV2.body,
          outboundWeekly: {
            body: voiceWeeklyV2.body,
            evidence: weeklyOcegEvidence,
            weeklyGuardCtx: weeklyUnifiedGuardCtx,
            priorCoachBody: weeklyUnifiedGuardCtx.priorCoachBody,
            priorCoachSentAt: null,
            routePurpose: "weekly_proof_v2",
          },
        });
        const unifiedGuardTelemetry = compactUnifiedFinalGuardForTelemetry(unifiedGuard);

        if (!unifiedGuard.shouldSend) {
          await supabaseServer
            .from("sms_weekly_send_events")
            .update({
              status: "skipped_no_safe_v3_voice",
              metadata: enrichWeeklyPersistenceMetadata(packTelemetryBase, {
                ...weeklyV3MetaBase,
                no_send_tag: "unified_final_guard_no_send",
                no_send_reason: unifiedGuard.noSendReason,
                voice_decision: "skipped_no_safe_v3_voice",
                visible_sent: false,
                twilio_send_attempted: false,
                skip_source: "unified_final_guard_no_send",
                final_body_authority: UNIFIED_FINAL_BODY_AUTHORITY,
                unified_final_guard_mode: "outbound_weekly",
                weekly_route_kind: "weekly_proof_v2",
                weekly_guard_mode: "outbound_weekly",
                weekly_proof_counts: {
                  completed_count: pack.yes_count,
                  missed_count: pack.no_count,
                  partial_count: pack.partial_count,
                  silent_week: pack.silent_week,
                },
                proof_state_written_before_sms: false,
                compliance_suffix_preserved: false,
                compliance_footer_appended_after_fvg: false,
                compliance_footer_appended: false,
                fvg_policy_classification: "relationship_coaching",
                normal_coaching_policy_source: "phase4_2b_weekly_v2_lane_fail_closed",
                north_star_gate: {
                  original_body: gatedWeeklyV2.meta.originalBody,
                  final_body: "",
                  north_star_gate_source: gatedWeeklyV2.meta.source,
                  north_star_gate_reasons: gatedWeeklyV2.meta.blockedReasons,
                  openai_attempted: gatedWeeklyV2.meta.openaiAttempted,
                  openai_failed_reason: gatedWeeklyV2.meta.openaiFailedReason ?? null,
                  context_packet_used: gatedWeeklyV2.meta.contextPacketUsed,
                  finalizer_version: gatedWeeklyV2.meta.finalizerVersion,
                  ...pickNorthStarWriterAttributionFields(gatedWeeklyV2.meta),
                },
                final_voice_gate: voiceWeeklyV2.metadata,
                unified_final_product_law_guard: unifiedGuardTelemetry,
                voice_send_decision: {
                  should_send: false,
                  skip_reason: unifiedGuard.noSendReason,
                  blocked_reasons: voiceWeeklyV2.blockedReasons,
                  twilio_send_attempted: false,
                },
              }),
            })
            .eq("clerk_user_id", user.id)
            .eq("week_key", weekKeyV2);
          stats.skippedNoSafeV3Voice += 1;
          continue;
        }

        const guardedWeeklyBody = unifiedGuard.body;
        const finalBodyV2 = appendPreservedSmsSuffix(guardedWeeklyBody, WEEKLY_SMS_COMPLIANCE_FOOTER);

        const v2Metadata = enrichWeeklyPersistenceMetadata(packTelemetryBase, {
          ...weeklyV3MetaBase,
          no_send_tag: null,
          no_send_reason: null,
          visible_sent: true,
          final_body_authority: UNIFIED_FINAL_BODY_AUTHORITY,
          unified_final_guard_mode: "outbound_weekly",
          weekly_route_kind: "weekly_proof_v2",
          weekly_guard_mode: "outbound_weekly",
          proof_state_written_before_sms: false,
          sent_body_equals_guard_body_pre_footer: true,
          sent_body_equals_guard_body: false,
          north_star_gate: {
            original_body: gatedWeeklyV2.meta.originalBody,
            final_body: finalBodyV2,
            north_star_gate_source: gatedWeeklyV2.meta.source,
            north_star_gate_reasons: gatedWeeklyV2.meta.blockedReasons,
            openai_attempted: gatedWeeklyV2.meta.openaiAttempted,
            openai_failed_reason: gatedWeeklyV2.meta.openaiFailedReason ?? null,
            context_packet_used: gatedWeeklyV2.meta.contextPacketUsed,
            finalizer_version: gatedWeeklyV2.meta.finalizerVersion,
            ...pickNorthStarWriterAttributionFields(gatedWeeklyV2.meta),
          },
          final_voice_gate: voiceWeeklyV2.metadata,
          unified_final_product_law_guard: {
            ...unifiedGuardTelemetry,
            compliance_footer_appended_after_guard: true,
          },
          voice_send_decision: {
            should_send: true,
            skip_reason: null,
            blocked_reasons: voiceWeeklyV2.blockedReasons,
            twilio_send_attempted: false,
          },
          compliance_suffix_preserved: true,
          compliance_footer_appended_after_fvg: true,
          compliance_footer_appended_after_guard: true,
          fvg_policy_classification: "relationship_coaching",
          normal_coaching_policy_source: "phase4_2b_weekly_v2_lane_fail_closed",
        });
        v2Metadata.relationship_packet_observability = relationshipObservabilityFromLaneMetadata(
          v2Metadata as Record<string, unknown>
        );

        if (!isTwilioReady() || SMS_DRY_RUN) {
          await supabaseServer
            .from("sms_weekly_send_events")
            .update({
              status: SMS_DRY_RUN ? "dry_run" : "skipped_missing_twilio",
              metadata: v2Metadata,
            })
            .eq("clerk_user_id", user.id)
            .eq("week_key", weekKeyV2);

          if (SMS_DRY_RUN) stats.dryRun++;
          else stats.skippedMissingTwilio++;
          continue;
        }

        try {
          const messageV2 = await sendSMS({
            to: identity.phone_number,
            body: finalBodyV2,
            lastOutbound: {
              clerkUserId: user.id,
              messageKind: "weekly",
            },
          });

          const sentAt = new Date();
          const sentAtIso = sentAt.toISOString();

          const mem = await writeV2SmsThreadMemoryAfterWeeklyV3Outbound({
            commitmentId: commitment.id,
            clerkUserId: user.id,
            coachBodyForMemory: guardedWeeklyBody,
            messageSid: messageV2.sid,
            sentAt,
          });

          await supabaseServer
            .from("sms_weekly_send_events")
            .update({
              message_sid: messageV2.sid,
              status: messageV2.status,
              metadata: enrichWeeklyPersistenceMetadata(v2Metadata as Record<string, unknown>, {
                sent_at: sentAtIso,
                sms_body: finalBodyV2,
                voice_send_decision: {
                  ...(v2Metadata.voice_send_decision as Record<string, unknown>),
                  twilio_send_attempted: true,
                },
                thread_memory_projection_written: mem.ok,
                thread_memory_projection_error: mem.ok ? null : mem.error,
                thread_memory_projection_source: "weekly_sms",
                stripped_compliance_footer: true,
              }),
            })
            .eq("clerk_user_id", user.id)
            .eq("week_key", weekKeyV2);

          stats.sentV2WeeklyProof += 1;
        } catch (err) {
          await supabaseServer
            .from("sms_weekly_send_events")
            .update({
              status: "send_failed",
              metadata: enrichWeeklyPersistenceMetadata(v2Metadata as Record<string, unknown>, {
                error: String(err),
              }),
            })
            .eq("clerk_user_id", user.id)
            .eq("week_key", weekKeyV2);

          stats.failed++;
        }
        continue;
      }

      try {
        await generateWeeklySmsReflection(user.id, timezone, localNow);
      } catch (e) {
        console.error("[weekly-sms-shadow] failed", {
          userId: user.id,
          error: String(e),
        });
      }

      const weekKey = getWeekKey(localNow);

      const { error: reservationError } = await supabaseServer
        .from("sms_weekly_send_events")
        .insert({
          clerk_user_id: user.id,
          week_key: weekKey,
          status: "reserved",
        });

      if (reservationError) continue;

      stats.reserved++;

      const legacyDeprecatedMetadata: Record<string, unknown> = {
        legacy_weekly_branch: true,
        fully_on_v2: false,
        weekly_v3_lane_used: false,
        secondary_v3_lane_used: false,
        old_weekly_writer_used_as_voice: false,
        twilio_send_attempted: false,
        no_send_tag: "legacy_weekly_deprecated_until_v2",
        skip_reason: "user_not_fully_on_v2",
        relationship_lane_policy: "weekly_sms_requires_v2_commitment_and_v3_weekly_lane",
        deprecated_legacy_weekly_sms: true,
        legacy_weekly_sms_visible_body_generated: false,
        ...(SMS_DRY_RUN ? { sms_dry_run: true } : {}),
      };

      await supabaseServer
        .from("sms_weekly_send_events")
        .update({
          status: "skipped_legacy_weekly_deprecated",
          metadata: legacyDeprecatedMetadata,
        })
        .eq("clerk_user_id", user.id)
        .eq("week_key", weekKey);

      stats.skippedLegacyWeeklyDeprecated += 1;
      if (SMS_DRY_RUN) stats.dryRun++;
      continue;
    }

    offset += users.length;
    if (users.length < pageLimit) break;
  }

  return NextResponse.json(stats);
}