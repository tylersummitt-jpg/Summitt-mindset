/**
 * Builds {@link WeeklyV3OutboundFacts} for the fully-on-V2 weekly proof cron branch.
 * Proof pack + legacy weekly proof writers supply facts/previews only — not final SMS voice.
 */

import { deriveLatestCoachAuthorityFromTranscript } from "@/lib/north-star-sms-context-packet";
import {
  buildWeeklyThreadMemoryFromPacket,
  type SlimSmsRelationshipMemoryPacketForFacts,
} from "@/lib/sms-relationship-memory-packet";
import { isV2AdaptiveOverlayActive, isV2PendingProposalValid } from "@/lib/v2-adaptive-contract";
import {
  deriveSmsGoalAdjustmentSignal,
  type SmsGoalAdjustmentSignalResult,
} from "@/lib/sms-goal-adjustment-signal";
import type { SmsPlannedInterruptionSignalRow } from "@/lib/sms-planned-interruption";
import { evaluateCommitmentEvolutionV1 } from "@/lib/v2-commitment-evolution-engine-v1";
import { getPendingResolutionOrNull } from "@/lib/v2-guided-resolution";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { V2SmsConversationContextPack } from "@/lib/v2-sms-conversation-context";
import type { V2WeeklyProofPack } from "@/lib/v2-weekly-proof-sms";
import { getDateKeyInTimezone } from "@/lib/timezone";
import { deriveSmsPatternSignal } from "@/lib/sms-pattern-signal";
import type { V3VictoryBackgroundFacts } from "@/lib/sms-victory-background-context";
import type { WeeklyV3OutboundFacts, WeeklyV3ThreadFacts } from "@/lib/v3-weekly-outbound-relationship-lane";
import type { V2EventRowForAi } from "@/lib/v2-commitment";

const MAX_WEEKLY_PROOF_MOMENT_HINTS = 2;

function formatPlannedInterruptionEngagementSummary(planned: {
  reasonCategory?: string | null;
  resumeHint?: string | null;
}): string {
  const reason =
    planned.reasonCategory && planned.reasonCategory !== "pause"
      ? ` (${planned.reasonCategory.replace(/_/g, " ")})`
      : "";
  if (planned.resumeHint?.trim()) {
    return `Replies may be sparse this week${reason}; resume around ${planned.resumeHint.trim()}`;
  }
  return `Replies may be sparse this week${reason} — keep reflection grounded without a normal weekly push`;
}

function buildLegacyWeeklyThreadFacts(args: {
  conv: V2SmsConversationContextPack | null;
  weeklySmsThreadAppend: string | null;
  pack: V2WeeklyProofPack;
}): WeeklyV3ThreadFacts {
  const lines = args.conv?.recentTranscriptLines?.slice(-20) ?? [];
  const auth = deriveLatestCoachAuthorityFromTranscript(lines);

  const hints: string[] = [];
  if (args.conv?.recentBlockerPattern?.trim()) {
    hints.push(`blocker_pattern:${args.conv.recentBlockerPattern.trim().slice(0, 120)}`);
  }
  if (args.weeklySmsThreadAppend?.trim()) {
    hints.push("thread_append_used_in_weekly_proof_prompt");
  }

  return {
    latest_outbound_preview: args.conv?.lastOutboundPreview ?? null,
    latest_inbound_preview: args.conv?.lastInboundPreview ?? null,
    recent_transcript_lines: lines.slice(-12),
    recent_exact_thread_text: null,
    last_outbound_full_body: null,
    last_inbound_full_body: null,
    last_5_coach_questions: [],
    last_5_user_answers: [],
    latest_open_question: auth.latestOpenQuestion,
    latest_answer_after_open_question: null,
    open_question_pending: false,
    open_question_source: null,
    answer_source: null,
    projection_used: false,
    memory_packet_used: false,
    recent_exact_message_count: null,
    do_not_repeat_hints: hints,
    coaching_memory_snippet: args.pack.coaching_summary_short,
    memory_priority_rules: [],
  };
}

function mapPlannedInterruptionFromRow(
  row: SmsPlannedInterruptionSignalRow | null | undefined
): {
  active: boolean;
  reasonCategory: string | null;
  resumeHint: string | null;
} {
  if (!row) {
    return { active: false, reasonCategory: null, resumeHint: null };
  }
  const ms = row.memorySignal;
  const reasonCategory =
    typeof ms.reason_category === "string" && ms.reason_category.trim()
      ? ms.reason_category.trim()
      : null;
  const resumeHint =
    typeof ms.resume_hint === "string" && ms.resume_hint.trim() ? ms.resume_hint.trim() : null;
  return { active: true, reasonCategory, resumeHint };
}

function plannedInterruptionPauseCadenceSignal(): SmsGoalAdjustmentSignalResult {
  return {
    move: "pause_cadence",
    confidence: "high",
    mentionAllowed: true,
    internalHint: "planned_interruption_active: honor pause before other goal adjustments",
    requiresUserConfirmation: true,
    compatibleFlow: "none",
    doNotRepeatKey: "goal_adjustment_pause_cadence_prompt",
  };
}

function applyWeeklyGoalAdjustmentProofPriority(
  signal: SmsGoalAdjustmentSignalResult,
  proofMomentHintCount: number
): SmsGoalAdjustmentSignalResult {
  if (proofMomentHintCount > 0 && signal.mentionAllowed) {
    return { ...signal, mentionAllowed: false };
  }
  return signal;
}

function shouldExposeGoalAdjustmentOnCommitment(signal: SmsGoalAdjustmentSignalResult): boolean {
  return (
    signal.move !== "keep" ||
    signal.mentionAllowed ||
    Boolean(signal.internalHint?.trim())
  );
}

function attachGoalAdjustmentToCommitment(
  commitment: WeeklyV3OutboundFacts["commitment"],
  signal: SmsGoalAdjustmentSignalResult
): void {
  commitment.goal_adjustment_move = signal.move;
  commitment.goal_adjustment_confidence = signal.confidence;
  commitment.goal_adjustment_mention_allowed = signal.mentionAllowed;
  commitment.goal_adjustment_internal_hint = signal.internalHint;
  commitment.goal_adjustment_requires_confirmation = signal.requiresUserConfirmation;
  commitment.goal_adjustment_compatible_flow = signal.compatibleFlow;
}

export function buildWeeklyV3OutboundFactsForV2WeeklyProof(args: {
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
  /** Server-resolved effective ask (same as outbound SMS uses). */
  effectiveAsk: string;
  pack: V2WeeklyProofPack;
  timezone: string;
  localNow: Date;
  conv: V2SmsConversationContextPack | null;
  weeklySmsThreadAppend: string | null;
  oldWeeklyProofBodyPreview: string;
  deterministicWeeklyBodyPreview: string;
  relationshipMemoryPacket?: SlimSmsRelationshipMemoryPacketForFacts | null;
  victoryBackground?: V3VictoryBackgroundFacts | null;
  plannedInterruption?: SmsPlannedInterruptionSignalRow | null;
}): WeeklyV3OutboundFacts {
  const lines = args.conv?.recentTranscriptLines?.slice(-20) ?? [];
  const effectiveAsk = args.effectiveAsk.trim();

  const planned = mapPlannedInterruptionFromRow(args.plannedInterruption);
  const plannedInterruptionActive = planned.active;
  const nowMs = args.localNow.getTime();

  const y = args.pack.yes_count;
  const neg = args.pack.no_count + args.pack.partial_count;
  const roughWeekFromCounts =
    args.pack.silent_week ||
    (args.pack.response_count > 0 && neg > y && !(args.pack.comeback_after_miss && y >= 1));
  const roughWeek = plannedInterruptionActive ? false : roughWeekFromCounts;
  const strongWeek = y >= 3 && y > neg;

  const proofMomentHints = args.pack.proof_moment_hints.slice(0, MAX_WEEKLY_PROOF_MOMENT_HINTS);

  const winHints: string[] = [];
  if (y > neg && y >= 1) {
    winHints.push("net_positive_week_on_responses");
  }
  const comebackHints = args.pack.comeback_after_miss ? ["comeback_after_user_miss"] : [];

  const patternEvents = (args.pack.pattern_events_newest_first ?? []) as V2EventRowForAi[];
  const patternSignal = deriveSmsPatternSignal({
    eventsNewestFirst: patternEvents,
    coachingMemory: {
      latest_blocker_preview: args.pack.blocker_preview_short,
      coaching_summary: args.pack.coaching_summary_short,
      do_not_repeat_phrases: args.relationshipMemoryPacket?.do_not_repeat_phrases ?? null,
    },
    patRead: args.victoryBackground?.pat_read_pattern
      ? {
          pattern_text: args.victoryBackground.pat_read_pattern,
          pattern_confidence: null,
        }
      : null,
    nowMs,
  });

  const pendingResolution = getPendingResolutionOrNull(args.commitment);
  const overlayActive = isV2AdaptiveOverlayActive(args.commitment, nowMs);
  const proposalPending = isV2PendingProposalValid(args.commitment, nowMs);
  const evolutionEvaluation = evaluateCommitmentEvolutionV1({
    commitment: args.commitment,
    eventsNewestFirst: patternEvents,
    nowMs,
  });

  let goalAdjustmentSignal = deriveSmsGoalAdjustmentSignal({
    eventsNewestFirst: patternEvents,
    coachingMemory: {
      latest_blocker_preview: args.pack.blocker_preview_short,
      coaching_summary: args.pack.coaching_summary_short,
      do_not_repeat_phrases: args.relationshipMemoryPacket?.do_not_repeat_phrases ?? null,
    },
    patternSignal: {
      canonical: patternSignal.canonical,
      confidence: patternSignal.confidence,
      mentionAllowed: patternSignal.mentionAllowed,
      count14d: patternSignal.count14d,
      count21d: patternSignal.count21d,
    },
    overlayState: {
      proposalPending,
      overlayActive,
      effectiveAskDiffers:
        effectiveAsk.trim() !== (args.commitment.behavior_statement ?? "").trim(),
      shrinkMeaningful: true,
    },
    pendingResolution: pendingResolution
      ? {
          kind: pendingResolution.kind,
          sms_state:
            pendingResolution.payload?.source === "sms_inbound"
              ? (pendingResolution.payload.sms_state ?? null)
              : null,
        }
      : null,
    evolutionEval: { recommended_action: evolutionEvaluation.recommended_action },
    silenceContext: {
      isReentry: false,
      silenceDays: args.pack.silent_week ? 7 : null,
      phase: args.commitment.accountability_phase,
    },
    inboundRaw: null,
    nowMs,
  });

  if (plannedInterruptionActive) {
    goalAdjustmentSignal = plannedInterruptionPauseCadenceSignal();
  }
  goalAdjustmentSignal = applyWeeklyGoalAdjustmentProofPriority(
    goalAdjustmentSignal,
    proofMomentHints.length
  );

  const notablePattern =
    patternSignal.mentionAllowed && patternSignal.gentleUserLine
      ? patternSignal.gentleUserLine
      : null;

  const localDate = getDateKeyInTimezone(args.localNow, args.timezone);
  const localTime = new Intl.DateTimeFormat("en-US", {
    timeZone: args.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(args.localNow);

  const smsEngagementSummary = plannedInterruptionActive
    ? formatPlannedInterruptionEngagementSummary(planned)
    : args.pack.response_count > 0
      ? `${args.pack.response_count} outcome replies this week`
      : args.pack.check_sent_count >= 1
        ? "Checks went out; replies were sparse"
        : null;

  const legacyHints: string[] = [];
  if (args.conv?.recentBlockerPattern?.trim()) {
    legacyHints.push(`blocker_pattern:${args.conv.recentBlockerPattern.trim().slice(0, 120)}`);
  }
  if (args.weeklySmsThreadAppend?.trim()) {
    legacyHints.push("thread_append_used_in_weekly_proof_prompt");
  }

  const thread: WeeklyV3ThreadFacts = args.relationshipMemoryPacket
    ? buildWeeklyThreadMemoryFromPacket({
        packet: args.relationshipMemoryPacket,
        convLatestOutbound: args.conv?.lastOutboundPreview ?? null,
        convLatestInbound: args.conv?.lastInboundPreview ?? null,
        recentTranscriptLines: lines,
        coachingMemorySnippet: args.pack.coaching_summary_short ?? undefined,
        extraDoNotRepeatHints: legacyHints,
      })
    : buildLegacyWeeklyThreadFacts({
        conv: args.conv,
        weeklySmsThreadAppend: args.weeklySmsThreadAppend,
        pack: args.pack,
      });

  const commitmentFacts: WeeklyV3OutboundFacts["commitment"] = {
    active_commitment_id: args.commitment.id,
    behavior_statement: args.commitment.behavior_statement,
    effective_ask: effectiveAsk,
    commitment_state: args.commitment.accountability_phase,
    identity_anchor: args.pack.identity_anchor_short ?? null,
  };
  if (plannedInterruptionActive) {
    commitmentFacts.planned_interruption_active = true;
    commitmentFacts.planned_interruption_reason_category = planned.reasonCategory;
    commitmentFacts.planned_interruption_resume_hint = planned.resumeHint;
  }
  if (shouldExposeGoalAdjustmentOnCommitment(goalAdjustmentSignal)) {
    attachGoalAdjustmentToCommitment(commitmentFacts, goalAdjustmentSignal);
  }

  const weeklyProof: WeeklyV3OutboundFacts["weekly_proof"] = {
    week_start: args.pack.week_start,
    week_end: args.pack.week_end,
    completed_count: args.pack.yes_count,
    missed_count: args.pack.distinct_user_no_day_count,
    raw_missed_count: args.pack.raw_user_no_count,
    distinct_missed_day_count: args.pack.distinct_user_no_day_count,
    false_or_suspect_missed_count: args.pack.false_or_suspect_user_no_count,
    unknown_day_missed_count: args.pack.unknown_day_user_no_count,
    exact_miss_day_count_reliable: args.pack.exact_miss_day_count_reliable,
    partial_count: args.pack.partial_count,
    blocker_count: args.pack.blocker_count,
    proof_moment_hints: proofMomentHints,
    win_hints: winHints,
    comeback_hints: comebackHints,
    repeated_blocker_hints: [],
    notable_pattern: notablePattern,
    silent_week: args.pack.silent_week,
    rough_week: roughWeek,
    strong_week: strongWeek,
    old_weekly_proof_body_preview: args.oldWeeklyProofBodyPreview.trim().slice(0, 400) || null,
    deterministic_weekly_body_preview: args.deterministicWeeklyBodyPreview.trim().slice(0, 400) || null,
    legacy_reflection_preview: null,
    legacy_template_preview: null,
  };
  if (plannedInterruptionActive) {
    weeklyProof.planned_pause_week = true;
  }

  return {
    user: {
      clerk_user_id: args.clerkUserId,
      preferred_name: args.pack.preferred_name,
      timezone: args.timezone,
      local_date: localDate,
      local_time: localTime,
      sms_engagement_summary: smsEngagementSummary,
    },
    commitment: commitmentFacts,
    thread,
    weekly_proof: weeklyProof,
    route: {
      route_purpose: "weekly_proof_v2",
      fully_on_v2: true,
      reason_for_send: "sunday_weekly_touchpoint",
      legacy_weekly_branch: false,
    },
    ...(args.victoryBackground != null ? { victory_background: args.victoryBackground } : {}),
  };
}
