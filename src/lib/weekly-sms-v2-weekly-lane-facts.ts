/**
 * Builds {@link WeeklyV3OutboundFacts} for the fully-on-V2 weekly proof cron branch.
 * Proof pack + legacy weekly proof writers supply facts/previews only — not final SMS voice.
 */

import { deriveLatestCoachAuthorityFromTranscript } from "@/lib/north-star-sms-context-packet";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { V2SmsConversationContextPack } from "@/lib/v2-sms-conversation-context";
import type { V2WeeklyProofPack } from "@/lib/v2-weekly-proof-sms";
import { getDateKeyInTimezone } from "@/lib/timezone";
import type { WeeklyV3OutboundFacts } from "@/lib/v3-weekly-outbound-relationship-lane";

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
}): WeeklyV3OutboundFacts {
  const lines = args.conv?.recentTranscriptLines?.slice(-20) ?? [];
  const auth = deriveLatestCoachAuthorityFromTranscript(lines);
  const effectiveAsk = args.effectiveAsk.trim();

  const y = args.pack.yes_count;
  const neg = args.pack.no_count + args.pack.partial_count;
  const roughWeek =
    args.pack.silent_week ||
    (args.pack.response_count > 0 && neg > y && !(args.pack.comeback_after_miss && y >= 1));
  const strongWeek = y >= 3 && y > neg;

  const winHints = [...args.pack.proof_moment_hints];
  if (y > neg && y >= 1) {
    winHints.push("net_positive_week_on_responses");
  }
  const comebackHints = args.pack.comeback_after_miss ? ["comeback_after_user_miss"] : [];
  const repeatedBlockerHints =
    args.pack.blocker_count >= 2 && args.pack.blocker_preview_short
      ? [args.pack.blocker_preview_short.slice(0, 120)]
      : [];
  const notablePattern =
    args.pack.weekly_evolution_coaching_line?.trim() ||
    (args.pack.blocker_preview_short ? "named_blockers_this_week" : null);

  const localDate = getDateKeyInTimezone(args.localNow, args.timezone);
  const localTime = new Intl.DateTimeFormat("en-US", {
    timeZone: args.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(args.localNow);

  const smsEngagementSummary =
    args.pack.response_count > 0
      ? `${args.pack.response_count} outcome replies this week`
      : args.pack.check_sent_count >= 1
        ? "Checks went out; replies were sparse"
        : null;

  const hints: string[] = [];
  if (args.conv?.recentBlockerPattern?.trim()) {
    hints.push(`blocker_pattern:${args.conv.recentBlockerPattern.trim().slice(0, 120)}`);
  }
  if (args.weeklySmsThreadAppend?.trim()) {
    hints.push("thread_append_used_in_weekly_proof_prompt");
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
    commitment: {
      active_commitment_id: args.commitment.id,
      behavior_statement: args.commitment.behavior_statement,
      effective_ask: effectiveAsk,
      commitment_state: args.commitment.accountability_phase,
      identity_anchor: args.pack.identity_anchor_short ?? null,
    },
    thread: {
      latest_outbound_preview: args.conv?.lastOutboundPreview ?? null,
      latest_inbound_preview: args.conv?.lastInboundPreview ?? null,
      recent_transcript_lines: lines.slice(-12),
      latest_open_question: auth.latestOpenQuestion,
      do_not_repeat_hints: hints,
      coaching_memory_snippet: args.pack.coaching_summary_short,
    },
    weekly_proof: {
      week_start: args.pack.week_start,
      week_end: args.pack.week_end,
      completed_count: args.pack.yes_count,
      missed_count: args.pack.no_count,
      partial_count: args.pack.partial_count,
      blocker_count: args.pack.blocker_count,
      proof_moment_hints: args.pack.proof_moment_hints,
      win_hints: winHints,
      comeback_hints: comebackHints,
      repeated_blocker_hints: repeatedBlockerHints,
      notable_pattern: notablePattern,
      silent_week: args.pack.silent_week,
      rough_week: roughWeek,
      strong_week: strongWeek,
      old_weekly_proof_body_preview: args.oldWeeklyProofBodyPreview.trim().slice(0, 400) || null,
      deterministic_weekly_body_preview: args.deterministicWeeklyBodyPreview.trim().slice(0, 400) || null,
      legacy_reflection_preview: null,
      legacy_template_preview: null,
    },
    route: {
      route_purpose: "weekly_proof_v2",
      fully_on_v2: true,
      reason_for_send: "sunday_weekly_touchpoint",
      legacy_weekly_branch: false,
    },
  };
}
