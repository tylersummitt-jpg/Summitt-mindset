/**
 * Inbound reply notebook verification observability (parity with daily / weekly).
 */

import type {
  BriefThreadBuildTelemetry,
  RecentExactThread72hMessage,
} from "@/lib/sms-recent-exact-thread-72h";
import {
  WEEKLY_EXACT_THREAD_SOURCE_TABLES,
  computeWeeklyLegacyTranscriptMessageCount,
  countWeeklyExactAndLastOutboundFrom72h,
  inferWeeklyLegacyFallbackSourceInPacket,
  mapWeeklyFilteredOutReasonTopToFailureReason,
  readThreadFallbackUsedFromWeeklyLaneMetadata,
} from "@/lib/sms-weekly-notebook-telemetry";

import type { SlimSmsRelationshipMemoryPacketForFacts } from "@/lib/sms-relationship-memory-packet";

export const INBOUND_NOTEBOOK_PAYLOAD_VERSION = "inbound_notebook_v1";

export type InboundNotebookFailureReason =
  | "none"
  | "writer_not_invoked"
  | "context_packet_build_failed"
  | "context_packet_not_used"
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
  | "unclassified_notebook_failure";

export type InboundNotebookTelemetry = {
  inbound_context_packet_used: boolean;
  inbound_context_packet_build_failed: boolean;
  inbound_thread_primary_fetch_strategy: string | null;
  inbound_thread_primary_fetch_succeeded: boolean;
  inbound_thread_fetch_error_count: number;
  inbound_thread_fetch_error_sources: string;
  inbound_thread_fetch_error_top: string | null;
  inbound_thread_schema_fallback_used: boolean;
  inbound_thread_schema_fallback_sources: string;
  inbound_thread_source_candidate_count: number;
  inbound_thread_visible_send_candidate_count: number;
  inbound_thread_message_count: number | null;
  inbound_thread_exact_source_message_count: number;
  inbound_thread_last_outbound_fallback_message_count: number;
  inbound_thread_fallback_used: boolean;
  inbound_thread_recovered_source_rows: number;
  inbound_thread_filtered_out_count: number;
  inbound_thread_filtered_out_reason_top: string | null;
  inbound_thread_source_tables_present: string;
  inbound_thread_message_source_breakdown: string;
  inbound_thread_legacy_transcript_fallback_used: boolean;
  inbound_thread_legacy_transcript_message_count: number;
  inbound_thread_correct_notebook_verified: boolean;
  inbound_thread_notebook_failure_reason: InboundNotebookFailureReason;
  inbound_notebook_payload_version: typeof INBOUND_NOTEBOOK_PAYLOAD_VERSION;
};

export type InboundThreadSourceBreakdownInput = {
  recentExactThread72hMessages?: RecentExactThread72hMessage[] | null;
  recentTranscriptLineCount: number;
  includedThreadMessageCount: number | null;
  threadFallbackUsedInPacket: boolean;
  legacyFallbackSourceInPacket: string | null;
  hasRecentExactThreadText: boolean;
};

export const INBOUND_NOTEBOOK_OBSERVABILITY_KEYS = [
  "inbound_context_packet_used",
  "inbound_context_packet_build_failed",
  "inbound_thread_primary_fetch_strategy",
  "inbound_thread_primary_fetch_succeeded",
  "inbound_thread_fetch_error_count",
  "inbound_thread_fetch_error_sources",
  "inbound_thread_fetch_error_top",
  "inbound_thread_schema_fallback_used",
  "inbound_thread_schema_fallback_sources",
  "inbound_thread_source_candidate_count",
  "inbound_thread_visible_send_candidate_count",
  "inbound_thread_message_count",
  "inbound_thread_exact_source_message_count",
  "inbound_thread_last_outbound_fallback_message_count",
  "inbound_thread_fallback_used",
  "inbound_thread_recovered_source_rows",
  "inbound_thread_filtered_out_count",
  "inbound_thread_filtered_out_reason_top",
  "inbound_thread_source_tables_present",
  "inbound_thread_message_source_breakdown",
  "inbound_thread_legacy_transcript_fallback_used",
  "inbound_thread_legacy_transcript_message_count",
  "inbound_thread_correct_notebook_verified",
  "inbound_thread_notebook_failure_reason",
  "inbound_notebook_payload_version",
] as const;

export function formatInboundThreadMessageSourceBreakdown(args: {
  exactSourceMessageCount: number;
  lastOutboundFallbackMessageCount: number;
}): string {
  return `exact:${args.exactSourceMessageCount}|last_outbound:${args.lastOutboundFallbackMessageCount}`;
}

function mapFilteredOutReasonTopToInboundFailureReason(
  top: BriefThreadBuildTelemetry["daily_brief_thread_filtered_out_reason_top"],
  filteredOutCount: number
): InboundNotebookFailureReason | null {
  const weekly = mapWeeklyFilteredOutReasonTopToFailureReason(top, filteredOutCount);
  if (weekly == null) return null;
  if (weekly === "send_not_visible_or_skipped") return "source_candidates_filtered_out_unknown";
  return weekly as InboundNotebookFailureReason;
}

export function resolveInboundNotebookFailureReason(args: {
  correctNotebookVerified: boolean;
  writerInvoked: boolean;
  contextPacketUsed: boolean;
  contextPacketBuildFailed: boolean;
  buildTelemetry: BriefThreadBuildTelemetry | null;
  primaryFetchSucceeded: boolean;
  fetchErrorCount: number;
  schemaFallbackUsed: boolean;
  sourceCandidateCount: number;
  exactSourceMessageCount: number;
  messageCount: number | null;
  legacyTranscriptFallbackUsed: boolean;
  inboundThreadFallbackUsed: boolean;
  filteredOutCount: number;
  filteredOutReasonTop: BriefThreadBuildTelemetry["daily_brief_thread_filtered_out_reason_top"];
}): InboundNotebookFailureReason {
  if (args.correctNotebookVerified) return "none";

  if (!args.writerInvoked) return "writer_not_invoked";
  if (args.contextPacketBuildFailed) return "context_packet_build_failed";
  if (!args.contextPacketUsed) return "context_packet_not_used";
  if (!args.buildTelemetry) return "telemetry_missing";
  if (!args.primaryFetchSucceeded) return "primary_fetch_not_succeeded";
  if (args.fetchErrorCount > 0) return "fetch_error";
  if (args.schemaFallbackUsed) return "schema_fallback_used";

  const msgCount = args.messageCount ?? 0;

  if (args.legacyTranscriptFallbackUsed) return "legacy_transcript_fallback_used";
  if (args.inboundThreadFallbackUsed) return "last_outbound_or_packet_fallback_used";
  if (msgCount > 0 && args.sourceCandidateCount === 0) {
    return "message_count_without_source_candidates";
  }
  if (args.sourceCandidateCount === 0) return "no_source_candidates";

  if (args.sourceCandidateCount > 0 && args.exactSourceMessageCount === 0) {
    const filteredReason = mapFilteredOutReasonTopToInboundFailureReason(
      args.filteredOutReasonTop,
      args.filteredOutCount
    );
    if (filteredReason) return filteredReason;
    return "source_candidates_no_exact_messages";
  }

  if (args.exactSourceMessageCount > 0 && msgCount <= 1) return "exact_thread_too_thin";

  return "unclassified_notebook_failure";
}

function mapBriefThreadBuildTelemetryToInboundNotebookFields(
  build: BriefThreadBuildTelemetry
): Pick<
  InboundNotebookTelemetry,
  | "inbound_thread_primary_fetch_strategy"
  | "inbound_thread_primary_fetch_succeeded"
  | "inbound_thread_fetch_error_count"
  | "inbound_thread_fetch_error_sources"
  | "inbound_thread_fetch_error_top"
  | "inbound_thread_schema_fallback_used"
  | "inbound_thread_schema_fallback_sources"
  | "inbound_thread_source_candidate_count"
  | "inbound_thread_visible_send_candidate_count"
  | "inbound_thread_recovered_source_rows"
  | "inbound_thread_filtered_out_count"
  | "inbound_thread_filtered_out_reason_top"
  | "inbound_thread_source_tables_present"
> {
  return {
    inbound_thread_primary_fetch_strategy: build.daily_brief_thread_primary_fetch_strategy,
    inbound_thread_primary_fetch_succeeded: build.daily_brief_thread_primary_fetch_succeeded,
    inbound_thread_fetch_error_count: build.daily_brief_thread_fetch_error_count,
    inbound_thread_fetch_error_sources: build.daily_brief_thread_fetch_error_sources,
    inbound_thread_fetch_error_top: build.daily_brief_thread_fetch_error_top,
    inbound_thread_schema_fallback_used: build.daily_brief_thread_schema_fallback_used,
    inbound_thread_schema_fallback_sources: build.daily_brief_thread_schema_fallback_sources,
    inbound_thread_source_candidate_count: build.daily_brief_thread_source_candidate_count,
    inbound_thread_visible_send_candidate_count: build.daily_brief_thread_visible_send_candidate_count,
    inbound_thread_recovered_source_rows: build.daily_brief_thread_recovered_source_rows,
    inbound_thread_filtered_out_count: build.daily_brief_thread_filtered_out_count,
    inbound_thread_filtered_out_reason_top: build.daily_brief_thread_filtered_out_reason_top,
    inbound_thread_source_tables_present: build.daily_brief_thread_source_tables_present,
  };
}

export function readIncludedThreadMessageCountFromInboundLaneMetadata(
  metadata: Record<string, unknown>
): number | null {
  const raw =
    metadata.inbound_thread_message_count ?? metadata.included_thread_message_count;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function buildInboundThreadSourceBreakdownInputFromFacts(args: {
  recentExactThread72hMessages?: RecentExactThread72hMessage[] | null;
  recentTranscriptLineCount: number;
  hasRecentExactThreadText: boolean;
  includedThreadMessageCount: number | null;
  laneMetadata: Record<string, unknown>;
}): InboundThreadSourceBreakdownInput {
  const threadFallbackUsedInPacket = readThreadFallbackUsedFromWeeklyLaneMetadata(args.laneMetadata);
  return {
    recentExactThread72hMessages: args.recentExactThread72hMessages,
    recentTranscriptLineCount: args.recentTranscriptLineCount,
    includedThreadMessageCount: args.includedThreadMessageCount,
    threadFallbackUsedInPacket,
    hasRecentExactThreadText: args.hasRecentExactThreadText,
    legacyFallbackSourceInPacket: inferWeeklyLegacyFallbackSourceInPacket({
      threadFallbackUsedInPacket,
      recentExactThread72hMessageCount: args.recentExactThread72hMessages?.length ?? 0,
      recentTranscriptLineCount: args.recentTranscriptLineCount,
      hasRecentExactThreadText: args.hasRecentExactThreadText,
    }),
  };
}

export function buildInboundNotebookTelemetry(args: {
  buildTelemetry: BriefThreadBuildTelemetry | null;
  contextPacketUsed: boolean;
  contextPacketBuildFailed: boolean;
  includedThreadMessageCount: number | null;
  writerInvoked: boolean;
  sourceBreakdown?: InboundThreadSourceBreakdownInput;
}): InboundNotebookTelemetry {
  const threadFields = args.buildTelemetry
    ? mapBriefThreadBuildTelemetryToInboundNotebookFields(args.buildTelemetry)
    : {
        inbound_thread_primary_fetch_strategy: null,
        inbound_thread_primary_fetch_succeeded: false,
        inbound_thread_fetch_error_count: 0,
        inbound_thread_fetch_error_sources: "",
        inbound_thread_fetch_error_top: null,
        inbound_thread_schema_fallback_used: false,
        inbound_thread_schema_fallback_sources: "",
        inbound_thread_source_candidate_count: 0,
        inbound_thread_visible_send_candidate_count: 0,
        inbound_thread_recovered_source_rows: 0,
        inbound_thread_filtered_out_count: 0,
        inbound_thread_filtered_out_reason_top: null,
        inbound_thread_source_tables_present: "",
      };

  const sourceCandidates = threadFields.inbound_thread_source_candidate_count;
  const filteredOutCount = threadFields.inbound_thread_filtered_out_count;
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
    args.contextPacketBuildFailed ||
    !args.contextPacketUsed ||
    (args.contextPacketUsed && sourceCandidates === 0 && lastOutboundOnlySupplement);

  const lastOutboundOnlyThread =
    lastOutboundFallbackMessageCount > 0 && exactSourceMessageCount === 0;

  const inboundThreadFallbackUsed = packetOrLastOutboundFallback || lastOutboundOnlyThread;

  const messageCount = args.includedThreadMessageCount;
  const correctNotebookVerified =
    args.writerInvoked &&
    args.contextPacketUsed &&
    !args.contextPacketBuildFailed &&
    threadFields.inbound_thread_primary_fetch_succeeded &&
    threadFields.inbound_thread_fetch_error_count === 0 &&
    !threadFields.inbound_thread_schema_fallback_used &&
    sourceCandidates > 0 &&
    exactSourceMessageCount > 0 &&
    (messageCount ?? 0) > 1 &&
    !inboundThreadFallbackUsed &&
    !legacyTranscriptFallbackUsed;

  const notebookFailureReason = resolveInboundNotebookFailureReason({
    correctNotebookVerified,
    writerInvoked: args.writerInvoked,
    contextPacketUsed: args.contextPacketUsed,
    contextPacketBuildFailed: args.contextPacketBuildFailed,
    buildTelemetry: args.buildTelemetry,
    primaryFetchSucceeded: threadFields.inbound_thread_primary_fetch_succeeded,
    fetchErrorCount: threadFields.inbound_thread_fetch_error_count,
    schemaFallbackUsed: threadFields.inbound_thread_schema_fallback_used,
    sourceCandidateCount: sourceCandidates,
    exactSourceMessageCount,
    messageCount,
    legacyTranscriptFallbackUsed,
    inboundThreadFallbackUsed,
    filteredOutCount,
    filteredOutReasonTop: args.buildTelemetry?.daily_brief_thread_filtered_out_reason_top ?? null,
  });

  return {
    inbound_context_packet_used: args.contextPacketUsed,
    inbound_context_packet_build_failed: args.contextPacketBuildFailed,
    ...threadFields,
    inbound_thread_message_count: messageCount,
    inbound_thread_exact_source_message_count: exactSourceMessageCount,
    inbound_thread_last_outbound_fallback_message_count: lastOutboundFallbackMessageCount,
    inbound_thread_fallback_used: inboundThreadFallbackUsed,
    inbound_thread_message_source_breakdown: formatInboundThreadMessageSourceBreakdown({
      exactSourceMessageCount,
      lastOutboundFallbackMessageCount,
    }),
    inbound_thread_legacy_transcript_fallback_used: legacyTranscriptFallbackUsed,
    inbound_thread_legacy_transcript_message_count: legacyTranscriptMessageCount,
    inbound_thread_correct_notebook_verified: correctNotebookVerified,
    inbound_thread_notebook_failure_reason: notebookFailureReason,
    inbound_notebook_payload_version: INBOUND_NOTEBOOK_PAYLOAD_VERSION,
  };
}

/** Re-export for tests documenting exact-source tables. */
export { WEEKLY_EXACT_THREAD_SOURCE_TABLES as INBOUND_EXACT_THREAD_SOURCE_TABLES };

export function attachInboundNotebookTelemetryToLaneMetadata(args: {
  laneMetadata: Record<string, unknown>;
  buildTelemetry: BriefThreadBuildTelemetry | null;
  contextPacketUsed: boolean;
  contextPacketBuildFailed: boolean;
  memoryPacket: SlimSmsRelationshipMemoryPacketForFacts;
  transcriptLines: string[];
  writerInvoked: boolean;
}): InboundNotebookTelemetry {
  const includedThreadMessageCount = readIncludedThreadMessageCountFromInboundLaneMetadata(
    args.laneMetadata
  );
  const telemetry = buildInboundNotebookTelemetry({
    buildTelemetry: args.buildTelemetry,
    contextPacketUsed: args.contextPacketUsed,
    contextPacketBuildFailed: args.contextPacketBuildFailed,
    includedThreadMessageCount,
    writerInvoked: args.writerInvoked,
    sourceBreakdown: buildInboundThreadSourceBreakdownInputFromFacts({
      recentExactThread72hMessages: args.memoryPacket.recent_exact_thread_72h?.messages,
      recentTranscriptLineCount: args.transcriptLines.length,
      hasRecentExactThreadText: Boolean(args.memoryPacket.recent_exact_thread_text?.trim()),
      includedThreadMessageCount,
      laneMetadata: args.laneMetadata,
    }),
  });
  Object.assign(args.laneMetadata, telemetry);
  return telemetry;
}
