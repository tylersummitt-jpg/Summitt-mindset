/**
 * Daily C1 notebook verification observability (parity with weekly Pat Pause notebook telemetry).
 */

import type { BriefThreadBuildTelemetry } from "@/lib/sms-recent-exact-thread-72h";
import type { DailyWritingBriefBuildStatus } from "@/lib/sms-daily-writing-brief-v1";

export type DailyNotebookFailureReason =
  | "none"
  | "writer_not_invoked"
  | "daily_brief_not_used"
  | "primary_fetch_not_succeeded"
  | "fetch_error"
  | "schema_fallback_used"
  | "no_source_candidates"
  | "source_candidates_no_exact_messages"
  | "source_candidates_filtered_out_empty_body"
  | "source_candidates_filtered_out_not_truly_sent"
  | "source_candidates_filtered_out_timestamp_outside_window"
  | "source_candidates_filtered_out_unknown"
  | "exact_thread_too_thin"
  | "last_outbound_or_packet_fallback_used"
  | "message_count_without_source_candidates"
  | "telemetry_missing"
  | "unclassified_notebook_failure";

export type DailyNotebookTelemetry = {
  daily_thread_correct_notebook_verified: boolean;
  daily_thread_notebook_failure_reason: DailyNotebookFailureReason;
  daily_thread_message_source_breakdown: string;
  daily_thread_exact_source_message_count: number;
  daily_thread_last_outbound_fallback_message_count: number;
  daily_thread_filtered_out_count: number;
  daily_thread_filtered_out_reason_top: string | null;
  daily_thread_source_tables_present: string;
};

export function formatDailyThreadMessageSourceBreakdown(args: {
  exactSourceMessageCount: number;
  lastOutboundFallbackMessageCount: number;
}): string {
  return `exact:${args.exactSourceMessageCount}|last_outbound:${args.lastOutboundFallbackMessageCount}`;
}

export function mapDailyFilteredOutReasonTopToFailureReason(
  top: BriefThreadBuildTelemetry["daily_brief_thread_filtered_out_reason_top"],
  filteredOutCount: number
): DailyNotebookFailureReason | null {
  if (filteredOutCount <= 0 || top == null) return null;
  switch (top) {
    case "empty_body":
      return "source_candidates_filtered_out_empty_body";
    case "not_truly_sent":
      return "source_candidates_filtered_out_not_truly_sent";
    case "timestamp_outside_window":
      return "source_candidates_filtered_out_timestamp_outside_window";
    case "preview_or_skipped":
      return "source_candidates_filtered_out_unknown";
    case "compliance_inbound":
      return "source_candidates_filtered_out_unknown";
    default:
      return "source_candidates_filtered_out_unknown";
  }
}

export function resolveDailyNotebookFailureReason(args: {
  correctNotebookVerified: boolean;
  writerInvoked: boolean;
  briefBuildStatus: DailyWritingBriefBuildStatus | string | null | undefined;
  buildTelemetry: BriefThreadBuildTelemetry | null;
  primaryFetchSucceeded: boolean;
  fetchErrorCount: number;
  schemaFallbackUsed: boolean;
  sourceCandidateCount: number;
  exactSourceMessageCount: number;
  messageCount: number;
  threadFallbackUsed: boolean;
  filteredOutCount: number;
  filteredOutReasonTop: BriefThreadBuildTelemetry["daily_brief_thread_filtered_out_reason_top"];
}): DailyNotebookFailureReason {
  if (args.correctNotebookVerified) return "none";

  if (!args.writerInvoked) return "writer_not_invoked";
  if (args.briefBuildStatus !== "used") return "daily_brief_not_used";
  if (!args.buildTelemetry) return "telemetry_missing";
  if (!args.primaryFetchSucceeded) return "primary_fetch_not_succeeded";
  if (args.fetchErrorCount > 0) return "fetch_error";
  if (args.schemaFallbackUsed) return "schema_fallback_used";

  if (args.threadFallbackUsed) return "last_outbound_or_packet_fallback_used";
  if (args.messageCount > 0 && args.sourceCandidateCount === 0) {
    return "message_count_without_source_candidates";
  }
  if (args.sourceCandidateCount === 0) return "no_source_candidates";

  if (args.sourceCandidateCount > 0 && args.exactSourceMessageCount === 0) {
    const filteredReason = mapDailyFilteredOutReasonTopToFailureReason(
      args.filteredOutReasonTop,
      args.filteredOutCount
    );
    if (filteredReason) return filteredReason;
    return "source_candidates_no_exact_messages";
  }

  if (args.exactSourceMessageCount > 0 && args.messageCount <= 1) return "exact_thread_too_thin";

  return "unclassified_notebook_failure";
}

export function buildDailyNotebookTelemetry(args: {
  buildTelemetry: BriefThreadBuildTelemetry | null;
  briefBuildStatus: DailyWritingBriefBuildStatus | string | null | undefined;
  messageCount: number;
  exactSourceMessageCount: number;
  lastOutboundFallbackMessageCount: number;
  writerInvoked: boolean;
}): DailyNotebookTelemetry {
  const build = args.buildTelemetry;
  const sourceCandidateCount = build?.daily_brief_thread_source_candidate_count ?? 0;
  const threadFallbackUsed = build?.daily_brief_thread_fallback_used === true;
  const filteredOutCount = build?.daily_brief_thread_filtered_out_count ?? 0;
  const filteredOutReasonTop = build?.daily_brief_thread_filtered_out_reason_top ?? null;

  const correctNotebookVerified =
    args.writerInvoked &&
    args.briefBuildStatus === "used" &&
    build != null &&
    build.daily_brief_thread_primary_fetch_succeeded &&
    build.daily_brief_thread_fetch_error_count === 0 &&
    !build.daily_brief_thread_schema_fallback_used &&
    sourceCandidateCount > 0 &&
    args.exactSourceMessageCount > 0 &&
    args.messageCount > 1 &&
    !threadFallbackUsed;

  const notebookFailureReason = resolveDailyNotebookFailureReason({
    correctNotebookVerified,
    writerInvoked: args.writerInvoked,
    briefBuildStatus: args.briefBuildStatus,
    buildTelemetry: build,
    primaryFetchSucceeded: build?.daily_brief_thread_primary_fetch_succeeded ?? false,
    fetchErrorCount: build?.daily_brief_thread_fetch_error_count ?? 0,
    schemaFallbackUsed: build?.daily_brief_thread_schema_fallback_used ?? false,
    sourceCandidateCount,
    exactSourceMessageCount: args.exactSourceMessageCount,
    messageCount: args.messageCount,
    threadFallbackUsed,
    filteredOutCount,
    filteredOutReasonTop,
  });

  return {
    daily_thread_correct_notebook_verified: correctNotebookVerified,
    daily_thread_notebook_failure_reason: notebookFailureReason,
    daily_thread_message_source_breakdown: formatDailyThreadMessageSourceBreakdown({
      exactSourceMessageCount: args.exactSourceMessageCount,
      lastOutboundFallbackMessageCount: args.lastOutboundFallbackMessageCount,
    }),
    daily_thread_exact_source_message_count: args.exactSourceMessageCount,
    daily_thread_last_outbound_fallback_message_count: args.lastOutboundFallbackMessageCount,
    daily_thread_filtered_out_count: filteredOutCount,
    daily_thread_filtered_out_reason_top: filteredOutReasonTop,
    daily_thread_source_tables_present: build?.daily_brief_thread_source_tables_present ?? "",
  };
}
