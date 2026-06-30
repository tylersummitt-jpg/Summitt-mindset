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

export type DailyNotebookVerdict = "verified" | "failed" | "not_applicable";

export type DailyNotebookVerdictReason =
  | "none"
  | "exact_thread_too_thin"
  | "source_candidates_filtered_out_empty_body"
  | "no_source_candidates"
  | "fetch_error"
  | "schema_fallback_used"
  | "brief_not_used"
  | "writer_not_invoked"
  | "legacy_path"
  | "lane_failed_before_writer"
  | "missing_required_verbatim_before_writer"
  | "unknown_missing_telemetry";

export type DailyNotebookCanonicalTelemetry = {
  notebook_verdict: DailyNotebookVerdict;
  notebook_verdict_reason: DailyNotebookVerdictReason;
  notebook_source_candidate_count: number | null;
  notebook_exact_source_message_count: number | null;
  notebook_brief_thread_message_count: number | null;
  notebook_filtered_out_reason_top: string | null;
  notebook_fallback_used: boolean | null;
  notebook_writer_payload_included: boolean | null;
};

const LANE_FAILED_BEFORE_WRITER_STAGES = new Set([
  "no_client",
  "openai_error",
  "parse",
]);

function readMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const raw = metadata[key];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

function readMetadataBoolean(metadata: Record<string, unknown>, key: string): boolean | null {
  const raw = metadata[key];
  if (raw === true) return true;
  if (raw === false) return false;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function readMetadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const raw = metadata[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function mapLegacyNotebookFailureToVerdictReason(
  legacy: string | null | undefined
): DailyNotebookVerdictReason {
  if (!legacy || legacy === "none") return "none";
  switch (legacy) {
    case "exact_thread_too_thin":
      return "exact_thread_too_thin";
    case "source_candidates_filtered_out_empty_body":
      return "source_candidates_filtered_out_empty_body";
    case "no_source_candidates":
      return "no_source_candidates";
    case "fetch_error":
    case "primary_fetch_not_succeeded":
      return "fetch_error";
    case "schema_fallback_used":
      return "schema_fallback_used";
    case "daily_brief_not_used":
      return "brief_not_used";
    case "writer_not_invoked":
      return "writer_not_invoked";
    default:
      return "unknown_missing_telemetry";
  }
}

function notebookCountsFromMetadata(metadata: Record<string, unknown>): Pick<
  DailyNotebookCanonicalTelemetry,
  | "notebook_source_candidate_count"
  | "notebook_exact_source_message_count"
  | "notebook_brief_thread_message_count"
  | "notebook_filtered_out_reason_top"
  | "notebook_fallback_used"
  | "notebook_writer_payload_included"
> {
  const writerPromptPath = readMetadataString(metadata, "writer_prompt_path");
  const dailyWritingBriefUsed = readMetadataBoolean(metadata, "daily_writing_brief_used");

  return {
    notebook_source_candidate_count: readMetadataNumber(
      metadata,
      "daily_brief_thread_source_candidate_count"
    ),
    notebook_exact_source_message_count: readMetadataNumber(
      metadata,
      "daily_thread_exact_source_message_count"
    ),
    notebook_brief_thread_message_count: readMetadataNumber(
      metadata,
      "daily_brief_thread_message_count"
    ),
    notebook_filtered_out_reason_top:
      readMetadataString(metadata, "daily_brief_thread_filtered_out_reason_top") ??
      readMetadataString(metadata, "daily_thread_filtered_out_reason_top"),
    notebook_fallback_used: readMetadataBoolean(metadata, "daily_brief_thread_fallback_used"),
    notebook_writer_payload_included:
      writerPromptPath === "daily_writing_brief_v1" || dailyWritingBriefUsed === true
        ? true
        : writerPromptPath === "legacy_packet_v1" || dailyWritingBriefUsed === false
          ? false
          : null,
  };
}

function hasNotebookThreadCounts(metadata: Record<string, unknown>): boolean {
  return (
    readMetadataNumber(metadata, "daily_brief_thread_source_candidate_count") != null ||
    readMetadataNumber(metadata, "daily_thread_exact_source_message_count") != null ||
    readMetadataNumber(metadata, "daily_brief_thread_message_count") != null
  );
}

/** Derive canonical notebook verdict fields from lane / send-event metadata (telemetry only). */
export function finalizeDailyNotebookVerdict(
  metadata: Record<string, unknown>
): DailyNotebookCanonicalTelemetry {
  const counts = notebookCountsFromMetadata(metadata);
  const verified = readMetadataBoolean(metadata, "daily_thread_correct_notebook_verified");
  const failureReason = readMetadataString(metadata, "daily_thread_notebook_failure_reason");
  const writerPromptPath = readMetadataString(metadata, "writer_prompt_path");
  const dailyWritingBriefUsed = readMetadataBoolean(metadata, "daily_writing_brief_used");
  const briefBuildStatus = readMetadataString(metadata, "daily_writing_brief_build_status");
  const briefSkipReason = readMetadataString(metadata, "daily_writing_brief_skip_reason");
  const writerInvoked = readMetadataBoolean(metadata, "daily_writer_invoked");
  const laneStage = readMetadataString(metadata, "lane_stage");
  const noSendReason = readMetadataString(metadata, "no_send_reason");

  if (verified === true) {
    return {
      notebook_verdict: "verified",
      notebook_verdict_reason: "none",
      ...counts,
    };
  }

  if (verified === false && failureReason && failureReason !== "none") {
    return {
      notebook_verdict: "failed",
      notebook_verdict_reason: mapLegacyNotebookFailureToVerdictReason(failureReason),
      ...counts,
    };
  }

  if (hasNotebookThreadCounts(metadata)) {
    return {
      notebook_verdict: "failed",
      notebook_verdict_reason: "unknown_missing_telemetry",
      ...counts,
    };
  }

  if (
    briefSkipReason === "skipped_required_verbatim" ||
    briefBuildStatus === "skipped_required_verbatim"
  ) {
    return {
      notebook_verdict: "not_applicable",
      notebook_verdict_reason: "missing_required_verbatim_before_writer",
      ...counts,
    };
  }

  if (writerPromptPath === "legacy_packet_v1") {
    return {
      notebook_verdict: "not_applicable",
      notebook_verdict_reason: "legacy_path",
      ...counts,
    };
  }

  if (
    dailyWritingBriefUsed === false ||
    briefBuildStatus === "legacy_not_applicable" ||
    (briefBuildStatus != null && briefBuildStatus.startsWith("skipped_"))
  ) {
    return {
      notebook_verdict: "not_applicable",
      notebook_verdict_reason: "brief_not_used",
      ...counts,
    };
  }

  if (writerInvoked === false) {
    return {
      notebook_verdict: "not_applicable",
      notebook_verdict_reason: "writer_not_invoked",
      ...counts,
    };
  }

  if (laneStage != null && LANE_FAILED_BEFORE_WRITER_STAGES.has(laneStage)) {
    return {
      notebook_verdict: "not_applicable",
      notebook_verdict_reason: "lane_failed_before_writer",
      ...counts,
    };
  }

  if (noSendReason === "missing_required_verbatim" && counts.notebook_writer_payload_included !== true) {
    return {
      notebook_verdict: "not_applicable",
      notebook_verdict_reason: "missing_required_verbatim_before_writer",
      ...counts,
    };
  }

  return {
    notebook_verdict: writerInvoked === true ? "failed" : "not_applicable",
    notebook_verdict_reason: "unknown_missing_telemetry",
    ...counts,
  };
}

/** Merge canonical notebook verdict onto daily V3 metadata (idempotent telemetry). */
export function attachDailyNotebookVerdictToMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...metadata,
    ...finalizeDailyNotebookVerdict(metadata),
  };
}

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

export type DailyNotebookTelemetryWithVerdict = DailyNotebookTelemetry &
  DailyNotebookCanonicalTelemetry;

export function buildDailyNotebookTelemetry(args: {
  buildTelemetry: BriefThreadBuildTelemetry | null;
  briefBuildStatus: DailyWritingBriefBuildStatus | string | null | undefined;
  messageCount: number;
  exactSourceMessageCount: number;
  lastOutboundFallbackMessageCount: number;
  writerInvoked: boolean;
}): DailyNotebookTelemetryWithVerdict {
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

  const legacyTelemetry: DailyNotebookTelemetry = {
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

  return {
    ...legacyTelemetry,
    ...finalizeDailyNotebookVerdict({
      ...legacyTelemetry,
      daily_brief_thread_source_candidate_count: sourceCandidateCount,
      daily_brief_thread_message_count: args.messageCount,
      daily_brief_thread_filtered_out_reason_top: filteredOutReasonTop,
      daily_brief_thread_fallback_used: threadFallbackUsed,
      daily_writing_brief_used: args.briefBuildStatus === "used",
      daily_writer_invoked: args.writerInvoked,
      ...(args.briefBuildStatus === "used"
        ? { writer_prompt_path: "daily_writing_brief_v1" as const }
        : {}),
    }),
  };
}
