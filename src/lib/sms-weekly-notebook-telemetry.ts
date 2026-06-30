/**
 * Weekly / Pat Pause notebook fetch observability (parity with daily brief thread telemetry).
 */

import type {
  BriefThreadBuildTelemetry,
  RecentExactThread72hMessage,
} from "@/lib/sms-recent-exact-thread-72h";

export const WEEKLY_NOTEBOOK_PAYLOAD_VERSION = "weekly_notebook_v1";

export const WEEKLY_EXACT_THREAD_SOURCE_TABLES = new Set([
  "sms_send_events",
  "sms_weekly_send_events",
  "sms_inbound_messages",
  "sms_inbound_coach_jobs",
]);

export type WeeklyNotebookFailureReason =
  | "none"
  | "writer_not_invoked"
  | "memory_packet_build_failed"
  | "memory_packet_not_used"
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
  | "legacy_transcript_fallback_used"
  | "last_outbound_or_packet_fallback_used"
  | "message_count_without_source_candidates"
  | "telemetry_missing"
  | "send_not_visible_or_skipped"
  | "unclassified_notebook_failure";

export type WeeklyNotebookVerdict = "verified" | "failed" | "not_applicable";

export type WeeklyNotebookVerdictReason =
  | "none"
  | "exact_thread_too_thin"
  | "source_candidates_filtered_out_empty_body"
  | "no_source_candidates"
  | "fetch_error"
  | "schema_fallback_used"
  | "memory_packet_build_failed"
  | "memory_packet_not_used"
  | "legacy_transcript_fallback_used"
  | "brief_not_used"
  | "writer_not_invoked"
  | "lane_failed_before_writer"
  | "no_history_expected"
  | "unknown_missing_telemetry";

export type WeeklyNotebookCanonicalTelemetry = {
  weekly_notebook_verdict: WeeklyNotebookVerdict;
  weekly_notebook_verdict_reason: WeeklyNotebookVerdictReason;
  weekly_notebook_source_candidate_count: number | null;
  weekly_notebook_exact_source_message_count: number | null;
  weekly_notebook_thread_message_count: number | null;
  weekly_notebook_filtered_out_reason_top: string | null;
  weekly_notebook_memory_packet_used: boolean | null;
  weekly_notebook_memory_packet_build_failed: boolean | null;
  weekly_notebook_legacy_transcript_fallback_used: boolean | null;
  weekly_notebook_writer_payload_included: boolean | null;
};

export type WeeklyNotebookTelemetry = {
  weekly_writer_invoked: boolean;
  weekly_thread_primary_fetch_strategy: string | null;
  weekly_thread_primary_fetch_succeeded: boolean;
  weekly_thread_fetch_error_count: number;
  weekly_thread_fetch_error_sources: string;
  weekly_thread_fetch_error_top: string | null;
  weekly_thread_schema_fallback_used: boolean;
  weekly_thread_schema_fallback_sources: string;
  weekly_thread_source_candidate_count: number;
  weekly_thread_visible_send_candidate_count: number;
  weekly_thread_message_count: number | null;
  weekly_thread_fallback_used: boolean;
  weekly_thread_recovered_source_rows: number;
  weekly_memory_packet_used: boolean;
  weekly_memory_packet_build_failed: boolean;
  weekly_notebook_payload_version: typeof WEEKLY_NOTEBOOK_PAYLOAD_VERSION;
  weekly_thread_message_source_breakdown: string;
  weekly_thread_exact_source_message_count: number;
  weekly_thread_legacy_transcript_message_count: number;
  weekly_thread_last_outbound_fallback_message_count: number;
  weekly_thread_legacy_transcript_fallback_used: boolean;
  weekly_thread_correct_notebook_verified: boolean;
  weekly_thread_notebook_failure_reason: WeeklyNotebookFailureReason;
  weekly_thread_filtered_out_count: number;
  weekly_thread_filtered_out_reason_top: string | null;
  weekly_thread_source_tables_present: string;
};

export type WeeklyNotebookTelemetryWithVerdict = WeeklyNotebookTelemetry &
  WeeklyNotebookCanonicalTelemetry;

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

export function mapLegacyWeeklyNotebookFailureToVerdictReason(
  legacy: string | null | undefined
): WeeklyNotebookVerdictReason {
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
    case "memory_packet_build_failed":
      return "memory_packet_build_failed";
    case "memory_packet_not_used":
      return "memory_packet_not_used";
    case "legacy_transcript_fallback_used":
      return "legacy_transcript_fallback_used";
    case "writer_not_invoked":
      return "writer_not_invoked";
    case "telemetry_missing":
      return "brief_not_used";
    default:
      return "unknown_missing_telemetry";
  }
}

function weeklyNotebookCountsFromMetadata(metadata: Record<string, unknown>): Pick<
  WeeklyNotebookCanonicalTelemetry,
  | "weekly_notebook_source_candidate_count"
  | "weekly_notebook_exact_source_message_count"
  | "weekly_notebook_thread_message_count"
  | "weekly_notebook_filtered_out_reason_top"
  | "weekly_notebook_memory_packet_used"
  | "weekly_notebook_memory_packet_build_failed"
  | "weekly_notebook_legacy_transcript_fallback_used"
  | "weekly_notebook_writer_payload_included"
> {
  const memoryPacketUsed = readMetadataBoolean(metadata, "weekly_memory_packet_used");
  const writerInvoked = readMetadataBoolean(metadata, "weekly_writer_invoked");

  return {
    weekly_notebook_source_candidate_count: readMetadataNumber(
      metadata,
      "weekly_thread_source_candidate_count"
    ),
    weekly_notebook_exact_source_message_count: readMetadataNumber(
      metadata,
      "weekly_thread_exact_source_message_count"
    ),
    weekly_notebook_thread_message_count: readMetadataNumber(metadata, "weekly_thread_message_count"),
    weekly_notebook_filtered_out_reason_top:
      readMetadataString(metadata, "weekly_thread_filtered_out_reason_top"),
    weekly_notebook_memory_packet_used: memoryPacketUsed,
    weekly_notebook_memory_packet_build_failed: readMetadataBoolean(
      metadata,
      "weekly_memory_packet_build_failed"
    ),
    weekly_notebook_legacy_transcript_fallback_used: readMetadataBoolean(
      metadata,
      "weekly_thread_legacy_transcript_fallback_used"
    ),
    weekly_notebook_writer_payload_included:
      memoryPacketUsed === true && writerInvoked === true
        ? true
        : memoryPacketUsed === false || writerInvoked === false
          ? false
          : null,
  };
}

function hasWeeklyNotebookThreadCounts(metadata: Record<string, unknown>): boolean {
  return (
    readMetadataNumber(metadata, "weekly_thread_source_candidate_count") != null ||
    readMetadataNumber(metadata, "weekly_thread_exact_source_message_count") != null ||
    readMetadataNumber(metadata, "weekly_thread_message_count") != null
  );
}

function isWeeklyNoHistoryExpected(metadata: Record<string, unknown>): boolean {
  if (readMetadataBoolean(metadata, "weekly_no_history_expected") === true) return true;
  const historyClass = readMetadataString(metadata, "weekly_notebook_history_class");
  return historyClass === "no_history_expected";
}

/** Derive canonical weekly notebook verdict fields from lane / send-event metadata (telemetry only). */
export function finalizeWeeklyNotebookVerdict(
  metadata: Record<string, unknown>
): WeeklyNotebookCanonicalTelemetry {
  const counts = weeklyNotebookCountsFromMetadata(metadata);
  const verified = readMetadataBoolean(metadata, "weekly_thread_correct_notebook_verified");
  const failureReason = readMetadataString(metadata, "weekly_thread_notebook_failure_reason");
  const writerInvoked = readMetadataBoolean(metadata, "weekly_writer_invoked");
  const laneStage = readMetadataString(metadata, "lane_stage");
  const legacyTranscriptFallback = readMetadataBoolean(
    metadata,
    "weekly_thread_legacy_transcript_fallback_used"
  );
  const memoryPacketBuildFailed = readMetadataBoolean(metadata, "weekly_memory_packet_build_failed");
  const memoryPacketUsed = readMetadataBoolean(metadata, "weekly_memory_packet_used");

  if (verified === true) {
    return {
      weekly_notebook_verdict: "verified",
      weekly_notebook_verdict_reason: "none",
      ...counts,
    };
  }

  if (isWeeklyNoHistoryExpected(metadata)) {
    return {
      weekly_notebook_verdict: "not_applicable",
      weekly_notebook_verdict_reason: "no_history_expected",
      ...counts,
    };
  }

  if (writerInvoked === false) {
    return {
      weekly_notebook_verdict: "not_applicable",
      weekly_notebook_verdict_reason: "writer_not_invoked",
      ...counts,
    };
  }

  if (laneStage != null && LANE_FAILED_BEFORE_WRITER_STAGES.has(laneStage)) {
    return {
      weekly_notebook_verdict: "not_applicable",
      weekly_notebook_verdict_reason: "lane_failed_before_writer",
      ...counts,
    };
  }

  if (memoryPacketBuildFailed === true) {
    return {
      weekly_notebook_verdict: "failed",
      weekly_notebook_verdict_reason: "memory_packet_build_failed",
      ...counts,
    };
  }

  if (memoryPacketUsed === false) {
    return {
      weekly_notebook_verdict: "failed",
      weekly_notebook_verdict_reason: "memory_packet_not_used",
      ...counts,
    };
  }

  if (legacyTranscriptFallback === true) {
    return {
      weekly_notebook_verdict: "failed",
      weekly_notebook_verdict_reason: "legacy_transcript_fallback_used",
      ...counts,
    };
  }

  if (verified === false && failureReason && failureReason !== "none") {
    return {
      weekly_notebook_verdict: "failed",
      weekly_notebook_verdict_reason: mapLegacyWeeklyNotebookFailureToVerdictReason(failureReason),
      ...counts,
    };
  }

  if (hasWeeklyNotebookThreadCounts(metadata)) {
    return {
      weekly_notebook_verdict: "failed",
      weekly_notebook_verdict_reason: "unknown_missing_telemetry",
      ...counts,
    };
  }

  return {
    weekly_notebook_verdict: writerInvoked === true ? "failed" : "not_applicable",
    weekly_notebook_verdict_reason: "unknown_missing_telemetry",
    ...counts,
  };
}

/** Merge canonical weekly notebook verdict onto weekly V3 metadata (idempotent telemetry). */
export function attachWeeklyNotebookVerdictToMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...metadata,
    ...finalizeWeeklyNotebookVerdict(metadata),
  };
}

export type WeeklyThreadSourceBreakdownInput = {
  recentExactThread72hMessages?: RecentExactThread72hMessage[] | null;
  recentTranscriptLineCount: number;
  includedThreadMessageCount: number | null;
  threadFallbackUsedInPacket: boolean;
  legacyFallbackSourceInPacket: string | null;
};

/** Count coach/user messages by source_table from 72h thread (writer-facing pool). */
export function countWeeklyExactAndLastOutboundFrom72h(
  messages: RecentExactThread72hMessage[] | undefined | null
): {
  exactSourceMessageCount: number;
  lastOutboundFallbackMessageCount: number;
} {
  const coachUser = (messages ?? []).filter((m) => m.role === "coach" || m.role === "user");
  return {
    exactSourceMessageCount: coachUser.filter((m) =>
      WEEKLY_EXACT_THREAD_SOURCE_TABLES.has(m.source_table)
    ).length,
    lastOutboundFallbackMessageCount: coachUser.filter(
      (m) => m.source_table === "sms_last_outbound_context"
    ).length,
  };
}

/**
 * Legacy transcript lines contribute when packet falls back to conv/transcript text
 * while exact DB source rows are absent (source_candidate_count=0 or exact count=0).
 */
export function computeWeeklyLegacyTranscriptMessageCount(args: {
  sourceCandidateCount: number;
  exactSourceMessageCount: number;
  legacyTranscriptLineCount: number;
  includedThreadMessageCount: number | null;
  threadFallbackUsedInPacket: boolean;
  legacyFallbackSourceInPacket: string | null;
}): number {
  const legacySources = new Set([
    "recent_transcript_lines",
    "recent_transcript_or_context_block",
    "recent_exact_thread_text",
  ]);
  const usesLegacySource =
    args.threadFallbackUsedInPacket &&
    args.legacyFallbackSourceInPacket != null &&
    legacySources.has(args.legacyFallbackSourceInPacket);

  const thinExactPool =
    args.sourceCandidateCount === 0 || args.exactSourceMessageCount === 0;
  if (!thinExactPool || args.legacyTranscriptLineCount === 0) {
    return 0;
  }

  const msgCount = args.includedThreadMessageCount ?? 0;
  if (msgCount <= 0 && !usesLegacySource) {
    return 0;
  }

  if (usesLegacySource || (msgCount > 0 && args.legacyTranscriptLineCount > 0)) {
    return Math.min(args.legacyTranscriptLineCount, msgCount > 0 ? msgCount : args.legacyTranscriptLineCount);
  }

  return 0;
}

export function formatWeeklyThreadMessageSourceBreakdown(args: {
  exactSourceMessageCount: number;
  legacyTranscriptMessageCount: number;
  lastOutboundFallbackMessageCount: number;
}): string {
  return `exact:${args.exactSourceMessageCount}|legacy_transcript:${args.legacyTranscriptMessageCount}|last_outbound:${args.lastOutboundFallbackMessageCount}`;
}

export function inferWeeklyLegacyFallbackSourceInPacket(args: {
  threadFallbackUsedInPacket: boolean;
  recentExactThread72hMessageCount: number;
  recentTranscriptLineCount: number;
  hasRecentExactThreadText: boolean;
}): string | null {
  if (!args.threadFallbackUsedInPacket) return null;
  if (args.recentExactThread72hMessageCount > 0) return null;
  if (args.recentTranscriptLineCount > 0) return "recent_transcript_lines";
  if (args.hasRecentExactThreadText) return "recent_exact_thread_text";
  return "legacy_transcript_unknown";
}

/** Map thread-build filter reason to weekly notebook failure reason when sources exist but no exact messages. */
export function mapWeeklyFilteredOutReasonTopToFailureReason(
  top: BriefThreadBuildTelemetry["daily_brief_thread_filtered_out_reason_top"],
  filteredOutCount: number
): WeeklyNotebookFailureReason | null {
  if (filteredOutCount <= 0 || top == null) return null;
  switch (top) {
    case "empty_body":
      return "source_candidates_filtered_out_empty_body";
    case "not_truly_sent":
      return "source_candidates_filtered_out_not_truly_sent";
    case "timestamp_outside_window":
      return "source_candidates_filtered_out_timestamp_outside_window";
    case "preview_or_skipped":
      return "send_not_visible_or_skipped";
    case "compliance_inbound":
      return "source_candidates_filtered_out_unknown";
    default:
      return "source_candidates_filtered_out_unknown";
  }
}

export function resolveWeeklyNotebookFailureReason(args: {
  correctNotebookVerified: boolean;
  writerInvoked: boolean;
  memoryPacketUsed: boolean;
  memoryPacketBuildFailed: boolean;
  buildTelemetry: BriefThreadBuildTelemetry | null;
  primaryFetchSucceeded: boolean;
  fetchErrorCount: number;
  schemaFallbackUsed: boolean;
  sourceCandidateCount: number;
  exactSourceMessageCount: number;
  messageCount: number | null;
  legacyTranscriptFallbackUsed: boolean;
  weeklyThreadFallbackUsed: boolean;
  filteredOutCount: number;
  filteredOutReasonTop: BriefThreadBuildTelemetry["daily_brief_thread_filtered_out_reason_top"];
}): WeeklyNotebookFailureReason {
  if (args.correctNotebookVerified) return "none";

  if (!args.writerInvoked) return "writer_not_invoked";
  if (args.memoryPacketBuildFailed) return "memory_packet_build_failed";
  if (!args.memoryPacketUsed) return "memory_packet_not_used";
  if (!args.buildTelemetry) return "telemetry_missing";
  if (!args.primaryFetchSucceeded) return "primary_fetch_not_succeeded";
  if (args.fetchErrorCount > 0) return "fetch_error";
  if (args.schemaFallbackUsed) return "schema_fallback_used";

  const msgCount = args.messageCount ?? 0;

  if (args.legacyTranscriptFallbackUsed) return "legacy_transcript_fallback_used";
  if (args.weeklyThreadFallbackUsed) return "last_outbound_or_packet_fallback_used";
  if (msgCount > 0 && args.sourceCandidateCount === 0) {
    return "message_count_without_source_candidates";
  }
  if (args.sourceCandidateCount === 0) return "no_source_candidates";

  if (args.sourceCandidateCount > 0 && args.exactSourceMessageCount === 0) {
    const filteredReason = mapWeeklyFilteredOutReasonTopToFailureReason(
      args.filteredOutReasonTop,
      args.filteredOutCount
    );
    if (filteredReason) return filteredReason;
    return "source_candidates_no_exact_messages";
  }

  if (args.exactSourceMessageCount > 0 && msgCount <= 1) return "exact_thread_too_thin";

  if (
    args.filteredOutReasonTop === "preview_or_skipped" &&
    args.filteredOutCount > 0
  ) {
    return "send_not_visible_or_skipped";
  }

  return "unclassified_notebook_failure";
}

export function mapBriefThreadBuildTelemetryToWeeklyNotebookFields(
  build: BriefThreadBuildTelemetry
): Pick<
  WeeklyNotebookTelemetry,
  | "weekly_thread_primary_fetch_strategy"
  | "weekly_thread_primary_fetch_succeeded"
  | "weekly_thread_fetch_error_count"
  | "weekly_thread_fetch_error_sources"
  | "weekly_thread_fetch_error_top"
  | "weekly_thread_schema_fallback_used"
  | "weekly_thread_schema_fallback_sources"
  | "weekly_thread_source_candidate_count"
  | "weekly_thread_visible_send_candidate_count"
  | "weekly_thread_recovered_source_rows"
  | "weekly_thread_filtered_out_count"
  | "weekly_thread_filtered_out_reason_top"
  | "weekly_thread_source_tables_present"
> {
  return {
    weekly_thread_primary_fetch_strategy: build.daily_brief_thread_primary_fetch_strategy,
    weekly_thread_primary_fetch_succeeded: build.daily_brief_thread_primary_fetch_succeeded,
    weekly_thread_fetch_error_count: build.daily_brief_thread_fetch_error_count,
    weekly_thread_fetch_error_sources: build.daily_brief_thread_fetch_error_sources,
    weekly_thread_fetch_error_top: build.daily_brief_thread_fetch_error_top,
    weekly_thread_schema_fallback_used: build.daily_brief_thread_schema_fallback_used,
    weekly_thread_schema_fallback_sources: build.daily_brief_thread_schema_fallback_sources,
    weekly_thread_source_candidate_count: build.daily_brief_thread_source_candidate_count,
    weekly_thread_visible_send_candidate_count: build.daily_brief_thread_visible_send_candidate_count,
    weekly_thread_recovered_source_rows: build.daily_brief_thread_recovered_source_rows,
    weekly_thread_filtered_out_count: build.daily_brief_thread_filtered_out_count,
    weekly_thread_filtered_out_reason_top: build.daily_brief_thread_filtered_out_reason_top,
    weekly_thread_source_tables_present: build.daily_brief_thread_source_tables_present,
  };
}

export function buildWeeklyNotebookTelemetry(args: {
  buildTelemetry: BriefThreadBuildTelemetry | null;
  memoryPacketUsed: boolean;
  memoryPacketBuildFailed: boolean;
  includedThreadMessageCount: number | null;
  writerInvoked: boolean;
  sourceBreakdown?: WeeklyThreadSourceBreakdownInput;
}): WeeklyNotebookTelemetryWithVerdict {
  const threadFields = args.buildTelemetry
    ? mapBriefThreadBuildTelemetryToWeeklyNotebookFields(args.buildTelemetry)
    : {
        weekly_thread_primary_fetch_strategy: null,
        weekly_thread_primary_fetch_succeeded: false,
        weekly_thread_fetch_error_count: 0,
        weekly_thread_fetch_error_sources: "",
        weekly_thread_fetch_error_top: null,
        weekly_thread_schema_fallback_used: false,
        weekly_thread_schema_fallback_sources: "",
        weekly_thread_source_candidate_count: 0,
        weekly_thread_visible_send_candidate_count: 0,
        weekly_thread_recovered_source_rows: 0,
        weekly_thread_filtered_out_count: 0,
        weekly_thread_filtered_out_reason_top: null,
        weekly_thread_source_tables_present: "",
      };

  const sourceCandidates = threadFields.weekly_thread_source_candidate_count;
  const filteredOutCount = threadFields.weekly_thread_filtered_out_count;
  const { exactSourceMessageCount, lastOutboundFallbackMessageCount } =
    countWeeklyExactAndLastOutboundFrom72h(args.sourceBreakdown?.recentExactThread72hMessages);

  const legacyTranscriptLineCount = args.sourceBreakdown?.recentTranscriptLineCount ?? 0;
  const legacyTranscriptMessageCount = computeWeeklyLegacyTranscriptMessageCount({
    sourceCandidateCount: sourceCandidates,
    exactSourceMessageCount,
    legacyTranscriptLineCount,
    includedThreadMessageCount: args.includedThreadMessageCount,
    threadFallbackUsedInPacket: args.sourceBreakdown?.threadFallbackUsedInPacket ?? false,
    legacyFallbackSourceInPacket: args.sourceBreakdown?.legacyFallbackSourceInPacket ?? null,
  });

  const legacyTranscriptFallbackUsed =
    legacyTranscriptMessageCount > 0 &&
    (sourceCandidates === 0 || exactSourceMessageCount === 0);

  const lastOutboundOnlySupplement =
    args.buildTelemetry?.daily_brief_thread_fallback_used === true && sourceCandidates === 0;

  const packetOrLastOutboundFallback =
    args.memoryPacketBuildFailed ||
    !args.memoryPacketUsed ||
    (args.memoryPacketUsed && sourceCandidates === 0 && lastOutboundOnlySupplement);

  const lastOutboundOnlyThread =
    lastOutboundFallbackMessageCount > 0 && exactSourceMessageCount === 0;

  const weeklyThreadFallbackUsed = packetOrLastOutboundFallback || lastOutboundOnlyThread;

  const messageCount = args.includedThreadMessageCount;
  const correctNotebookVerified =
    args.writerInvoked &&
    threadFields.weekly_thread_primary_fetch_succeeded &&
    threadFields.weekly_thread_fetch_error_count === 0 &&
    !threadFields.weekly_thread_schema_fallback_used &&
    sourceCandidates > 0 &&
    exactSourceMessageCount > 0 &&
    (messageCount ?? 0) > 1 &&
    !weeklyThreadFallbackUsed &&
    !legacyTranscriptFallbackUsed &&
    args.memoryPacketUsed &&
    !args.memoryPacketBuildFailed;

  const notebookFailureReason = resolveWeeklyNotebookFailureReason({
    correctNotebookVerified,
    writerInvoked: args.writerInvoked,
    memoryPacketUsed: args.memoryPacketUsed,
    memoryPacketBuildFailed: args.memoryPacketBuildFailed,
    buildTelemetry: args.buildTelemetry,
    primaryFetchSucceeded: threadFields.weekly_thread_primary_fetch_succeeded,
    fetchErrorCount: threadFields.weekly_thread_fetch_error_count,
    schemaFallbackUsed: threadFields.weekly_thread_schema_fallback_used,
    sourceCandidateCount: sourceCandidates,
    exactSourceMessageCount,
    messageCount,
    legacyTranscriptFallbackUsed,
    weeklyThreadFallbackUsed,
    filteredOutCount,
    filteredOutReasonTop: args.buildTelemetry?.daily_brief_thread_filtered_out_reason_top ?? null,
  });

  const legacyTelemetry: WeeklyNotebookTelemetry = {
    weekly_writer_invoked: args.writerInvoked,
    ...threadFields,
    weekly_thread_message_count: messageCount,
    weekly_thread_fallback_used: weeklyThreadFallbackUsed,
    weekly_memory_packet_used: args.memoryPacketUsed,
    weekly_memory_packet_build_failed: args.memoryPacketBuildFailed,
    weekly_notebook_payload_version: WEEKLY_NOTEBOOK_PAYLOAD_VERSION,
    weekly_thread_message_source_breakdown: formatWeeklyThreadMessageSourceBreakdown({
      exactSourceMessageCount,
      legacyTranscriptMessageCount,
      lastOutboundFallbackMessageCount,
    }),
    weekly_thread_exact_source_message_count: exactSourceMessageCount,
    weekly_thread_legacy_transcript_message_count: legacyTranscriptMessageCount,
    weekly_thread_last_outbound_fallback_message_count: lastOutboundFallbackMessageCount,
    weekly_thread_legacy_transcript_fallback_used: legacyTranscriptFallbackUsed,
    weekly_thread_correct_notebook_verified: correctNotebookVerified,
    weekly_thread_notebook_failure_reason: notebookFailureReason,
  };

  return {
    ...legacyTelemetry,
    ...finalizeWeeklyNotebookVerdict({
      ...legacyTelemetry,
      weekly_thread_filtered_out_count: filteredOutCount,
      weekly_thread_filtered_out_reason_top:
        args.buildTelemetry?.daily_brief_thread_filtered_out_reason_top ?? null,
      weekly_thread_source_tables_present:
        threadFields.weekly_thread_source_tables_present,
    }),
  };
}

export function readIncludedThreadMessageCountFromWeeklyLaneMetadata(
  metadata: Record<string, unknown>
): number | null {
  const raw = metadata.included_thread_message_count;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function readThreadFallbackUsedFromWeeklyLaneMetadata(
  metadata: Record<string, unknown>
): boolean {
  const raw = metadata.thread_fallback_used;
  if (raw === true) return true;
  if (typeof raw === "string" && raw.toLowerCase() === "true") return true;
  return false;
}

export function buildWeeklyThreadSourceBreakdownInputFromFacts(args: {
  recentExactThread72hMessages?: RecentExactThread72hMessage[] | null;
  recentTranscriptLineCount: number;
  hasRecentExactThreadText: boolean;
  includedThreadMessageCount: number | null;
  laneMetadata: Record<string, unknown>;
}): WeeklyThreadSourceBreakdownInput {
  const threadFallbackUsedInPacket = readThreadFallbackUsedFromWeeklyLaneMetadata(args.laneMetadata);
  return {
    recentExactThread72hMessages: args.recentExactThread72hMessages,
    recentTranscriptLineCount: args.recentTranscriptLineCount,
    includedThreadMessageCount: args.includedThreadMessageCount,
    threadFallbackUsedInPacket,
    legacyFallbackSourceInPacket: inferWeeklyLegacyFallbackSourceInPacket({
      threadFallbackUsedInPacket,
      recentExactThread72hMessageCount: args.recentExactThread72hMessages?.length ?? 0,
      recentTranscriptLineCount: args.recentTranscriptLineCount,
      hasRecentExactThreadText: args.hasRecentExactThreadText,
    }),
  };
}
