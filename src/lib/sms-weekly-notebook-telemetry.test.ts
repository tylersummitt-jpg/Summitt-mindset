import { describe, expect, it } from "vitest";

import type {
  BriefThreadBuildTelemetry,
  RecentExactThread72hMessage,
} from "@/lib/sms-recent-exact-thread-72h";
import {
  WEEKLY_NOTEBOOK_PAYLOAD_VERSION,
  attachWeeklyNotebookVerdictToMetadata,
  buildWeeklyNotebookTelemetry,
  buildWeeklyThreadSourceBreakdownInputFromFacts,
  finalizeWeeklyNotebookVerdict,
  mapBriefThreadBuildTelemetryToWeeklyNotebookFields,
  readIncludedThreadMessageCountFromWeeklyLaneMetadata,
} from "@/lib/sms-weekly-notebook-telemetry";

function sampleBuildTelemetry(
  overrides: Partial<BriefThreadBuildTelemetry> = {}
): BriefThreadBuildTelemetry {
  return {
    daily_brief_thread_source_candidate_count: 5,
    daily_brief_thread_visible_send_candidate_count: 3,
    daily_brief_thread_user_inbound_candidate_count: 2,
    daily_brief_thread_weekly_candidate_count: 1,
    daily_brief_thread_filtered_out_count: 0,
    daily_brief_thread_filtered_out_reason_top: null,
    daily_brief_thread_effective_timestamp_rescue_count: 0,
    daily_brief_thread_source_tables_present: "sms_send_events|sms_inbound_messages",
    daily_brief_thread_fetch_error_count: 0,
    daily_brief_thread_fetch_error_sources: "",
    daily_brief_thread_fetch_error_top: null,
    daily_brief_thread_schema_fallback_used: false,
    daily_brief_thread_schema_fallback_sources: "",
    daily_brief_thread_fallback_used: false,
    daily_brief_thread_fallback_source_count: 0,
    daily_brief_thread_primary_fetch_strategy: "select_star",
    daily_brief_thread_primary_fetch_succeeded: true,
    daily_brief_thread_recovered_source_rows: 5,
    ...overrides,
  };
}

function exactSourceMessage(
  overrides: Partial<RecentExactThread72hMessage> = {}
): RecentExactThread72hMessage {
  return {
    at: "2026-06-01T12:00:00.000Z",
    at_local: "2026-06-01T08:00:00",
    at_local_timezone: "America/New_York",
    local_day_key: "2026-06-01",
    role: "coach",
    body: "Coach line",
    message_kind: "daily",
    source_table: "sms_send_events",
    message_sid: "SM1",
    delivery_status: "sent",
    is_exact_body: true,
    ...overrides,
  };
}

const exactSourceBreakdown = {
  recentExactThread72hMessages: [
    exactSourceMessage({ role: "coach", source_table: "sms_send_events" }),
    exactSourceMessage({ role: "user", source_table: "sms_inbound_messages", body: "User line" }),
    exactSourceMessage({ role: "coach", source_table: "sms_weekly_send_events", body: "Weekly coach" }),
  ],
  recentTranscriptLineCount: 0,
  includedThreadMessageCount: 3,
  threadFallbackUsedInPacket: false,
  legacyFallbackSourceInPacket: null,
};

describe("sms-weekly-notebook-telemetry", () => {
  it("maps thread build telemetry to weekly notebook fields", () => {
    const mapped = mapBriefThreadBuildTelemetryToWeeklyNotebookFields(sampleBuildTelemetry());
    expect(mapped.weekly_thread_primary_fetch_succeeded).toBe(true);
    expect(mapped.weekly_thread_source_candidate_count).toBe(5);
    expect(mapped.weekly_thread_filtered_out_count).toBe(0);
    expect(mapped.weekly_thread_source_tables_present).toContain("sms_send_events");
  });

  it("verified notebook -> failure reason none and canonical verdict", () => {
    const telemetry = buildWeeklyNotebookTelemetry({
      buildTelemetry: sampleBuildTelemetry(),
      memoryPacketUsed: true,
      memoryPacketBuildFailed: false,
      includedThreadMessageCount: 3,
      writerInvoked: true,
      sourceBreakdown: exactSourceBreakdown,
    });
    expect(telemetry.weekly_thread_correct_notebook_verified).toBe(true);
    expect(telemetry.weekly_thread_notebook_failure_reason).toBe("none");
    expect(telemetry.weekly_notebook_verdict).toBe("verified");
    expect(telemetry.weekly_notebook_verdict_reason).toBe("none");
  });

  it("exact source rows yield correct_notebook_verified=true", () => {
    const telemetry = buildWeeklyNotebookTelemetry({
      buildTelemetry: sampleBuildTelemetry(),
      memoryPacketUsed: true,
      memoryPacketBuildFailed: false,
      includedThreadMessageCount: 3,
      writerInvoked: true,
      sourceBreakdown: exactSourceBreakdown,
    });
    expect(telemetry.weekly_thread_exact_source_message_count).toBe(3);
    expect(telemetry.weekly_thread_legacy_transcript_fallback_used).toBe(false);
    expect(telemetry.weekly_thread_correct_notebook_verified).toBe(true);
  });

  it("memory packet build failed -> memory_packet_build_failed", () => {
    const telemetry = buildWeeklyNotebookTelemetry({
      buildTelemetry: null,
      memoryPacketUsed: false,
      memoryPacketBuildFailed: true,
      includedThreadMessageCount: 0,
      writerInvoked: true,
    });
    expect(telemetry.weekly_thread_notebook_failure_reason).toBe("memory_packet_build_failed");
  });

  it("memory_packet_used false -> memory_packet_not_used", () => {
    const telemetry = buildWeeklyNotebookTelemetry({
      buildTelemetry: sampleBuildTelemetry(),
      memoryPacketUsed: false,
      memoryPacketBuildFailed: false,
      includedThreadMessageCount: 2,
      writerInvoked: true,
    });
    expect(telemetry.weekly_thread_notebook_failure_reason).toBe("memory_packet_not_used");
  });

  it("source_candidate_count = 0 -> no_source_candidates", () => {
    const telemetry = buildWeeklyNotebookTelemetry({
      buildTelemetry: sampleBuildTelemetry({ daily_brief_thread_source_candidate_count: 0 }),
      memoryPacketUsed: true,
      memoryPacketBuildFailed: false,
      includedThreadMessageCount: 0,
      writerInvoked: true,
      sourceBreakdown: {
        recentExactThread72hMessages: [],
        recentTranscriptLineCount: 0,
        includedThreadMessageCount: 0,
        threadFallbackUsedInPacket: false,
        legacyFallbackSourceInPacket: null,
      },
    });
    expect(telemetry.weekly_thread_notebook_failure_reason).toBe("no_source_candidates");
  });

  it("source_candidate_count>0 with no exact messages -> source_candidates_no_exact_messages", () => {
    const telemetry = buildWeeklyNotebookTelemetry({
      buildTelemetry: sampleBuildTelemetry({ daily_brief_thread_source_candidate_count: 4 }),
      memoryPacketUsed: true,
      memoryPacketBuildFailed: false,
      includedThreadMessageCount: 0,
      writerInvoked: true,
      sourceBreakdown: {
        recentExactThread72hMessages: [],
        recentTranscriptLineCount: 0,
        includedThreadMessageCount: 0,
        threadFallbackUsedInPacket: false,
        legacyFallbackSourceInPacket: null,
      },
    });
    expect(telemetry.weekly_thread_notebook_failure_reason).toBe("source_candidates_no_exact_messages");
  });

  it("filtered_out_reason_top empty_body -> source_candidates_filtered_out_empty_body", () => {
    const telemetry = buildWeeklyNotebookTelemetry({
      buildTelemetry: sampleBuildTelemetry({
        daily_brief_thread_source_candidate_count: 3,
        daily_brief_thread_filtered_out_count: 2,
        daily_brief_thread_filtered_out_reason_top: "empty_body",
      }),
      memoryPacketUsed: true,
      memoryPacketBuildFailed: false,
      includedThreadMessageCount: 0,
      writerInvoked: true,
      sourceBreakdown: {
        recentExactThread72hMessages: [],
        recentTranscriptLineCount: 0,
        includedThreadMessageCount: 0,
        threadFallbackUsedInPacket: false,
        legacyFallbackSourceInPacket: null,
      },
    });
    expect(telemetry.weekly_thread_filtered_out_count).toBe(2);
    expect(telemetry.weekly_thread_filtered_out_reason_top).toBe("empty_body");
    expect(telemetry.weekly_thread_notebook_failure_reason).toBe(
      "source_candidates_filtered_out_empty_body"
    );
  });

  it("legacy transcript fallback -> legacy_transcript_fallback_used", () => {
    const telemetry = buildWeeklyNotebookTelemetry({
      buildTelemetry: sampleBuildTelemetry({ daily_brief_thread_source_candidate_count: 0 }),
      memoryPacketUsed: true,
      memoryPacketBuildFailed: false,
      includedThreadMessageCount: 2,
      writerInvoked: true,
      sourceBreakdown: buildWeeklyThreadSourceBreakdownInputFromFacts({
        recentExactThread72hMessages: [],
        recentTranscriptLineCount: 2,
        hasRecentExactThreadText: false,
        includedThreadMessageCount: 2,
        laneMetadata: { thread_fallback_used: true },
      }),
    });
    expect(telemetry.weekly_thread_notebook_failure_reason).toBe("legacy_transcript_fallback_used");
  });

  it("message_count>0 with source_candidate_count=0 without legacy -> message_count_without_source_candidates", () => {
    const telemetry = buildWeeklyNotebookTelemetry({
      buildTelemetry: sampleBuildTelemetry({ daily_brief_thread_source_candidate_count: 0 }),
      memoryPacketUsed: true,
      memoryPacketBuildFailed: false,
      includedThreadMessageCount: 2,
      writerInvoked: true,
      sourceBreakdown: {
        recentExactThread72hMessages: [],
        recentTranscriptLineCount: 0,
        includedThreadMessageCount: 2,
        threadFallbackUsedInPacket: false,
        legacyFallbackSourceInPacket: null,
      },
    });
    expect(telemetry.weekly_thread_notebook_failure_reason).toBe(
      "message_count_without_source_candidates"
    );
  });

  it("last outbound fallback -> last_outbound_or_packet_fallback_used", () => {
    const telemetry = buildWeeklyNotebookTelemetry({
      buildTelemetry: sampleBuildTelemetry({
        daily_brief_thread_source_candidate_count: 2,
        daily_brief_thread_fallback_used: false,
      }),
      memoryPacketUsed: true,
      memoryPacketBuildFailed: false,
      includedThreadMessageCount: 1,
      writerInvoked: true,
      sourceBreakdown: {
        recentExactThread72hMessages: [
          exactSourceMessage({ source_table: "sms_last_outbound_context", body: "Last outbound only" }),
        ],
        recentTranscriptLineCount: 0,
        includedThreadMessageCount: 1,
        threadFallbackUsedInPacket: false,
        legacyFallbackSourceInPacket: null,
      },
    });
    expect(telemetry.weekly_thread_notebook_failure_reason).toBe(
      "last_outbound_or_packet_fallback_used"
    );
  });

  it("fetch error -> fetch_error", () => {
    const telemetry = buildWeeklyNotebookTelemetry({
      buildTelemetry: sampleBuildTelemetry({
        daily_brief_thread_fetch_error_count: 2,
        daily_brief_thread_fetch_error_sources: "sms_send_events:select_star_primary",
      }),
      memoryPacketUsed: true,
      memoryPacketBuildFailed: false,
      includedThreadMessageCount: 2,
      writerInvoked: true,
    });
    expect(telemetry.weekly_thread_notebook_failure_reason).toBe("fetch_error");
  });

  it("schema_fallback_used prevents correct_notebook_verified", () => {
    const telemetry = buildWeeklyNotebookTelemetry({
      buildTelemetry: sampleBuildTelemetry({
        daily_brief_thread_schema_fallback_used: true,
        daily_brief_thread_schema_fallback_sources: "sms_send_events",
      }),
      memoryPacketUsed: true,
      memoryPacketBuildFailed: false,
      includedThreadMessageCount: 3,
      writerInvoked: true,
      sourceBreakdown: {
        recentExactThread72hMessages: [
          exactSourceMessage(),
          exactSourceMessage({ role: "user", source_table: "sms_inbound_messages" }),
          exactSourceMessage({ source_table: "sms_weekly_send_events" }),
        ],
        recentTranscriptLineCount: 0,
        includedThreadMessageCount: 3,
        threadFallbackUsedInPacket: false,
        legacyFallbackSourceInPacket: null,
      },
    });
    expect(telemetry.weekly_thread_correct_notebook_verified).toBe(false);
    expect(telemetry.weekly_thread_notebook_failure_reason).toBe("schema_fallback_used");
  });

  it("memory packet success writes weekly_thread_message_count and source candidates", () => {
    const telemetry = buildWeeklyNotebookTelemetry({
      buildTelemetry: sampleBuildTelemetry(),
      memoryPacketUsed: true,
      memoryPacketBuildFailed: false,
      includedThreadMessageCount: 4,
      writerInvoked: true,
    });
    expect(telemetry.weekly_thread_message_count).toBe(4);
    expect(telemetry.weekly_memory_packet_used).toBe(true);
    expect(telemetry.weekly_notebook_payload_version).toBe(WEEKLY_NOTEBOOK_PAYLOAD_VERSION);
  });

  it("fallback-only packet is distinguishable from real source thread", () => {
    const real = buildWeeklyNotebookTelemetry({
      buildTelemetry: sampleBuildTelemetry({ daily_brief_thread_source_candidate_count: 3 }),
      memoryPacketUsed: true,
      memoryPacketBuildFailed: false,
      includedThreadMessageCount: 3,
      writerInvoked: true,
      sourceBreakdown: exactSourceBreakdown,
    });
    const fallbackOnly = buildWeeklyNotebookTelemetry({
      buildTelemetry: sampleBuildTelemetry({
        daily_brief_thread_source_candidate_count: 0,
        daily_brief_thread_fallback_used: true,
        daily_brief_thread_fallback_source_count: 1,
      }),
      memoryPacketUsed: true,
      memoryPacketBuildFailed: false,
      includedThreadMessageCount: 1,
      writerInvoked: true,
      sourceBreakdown: {
        recentExactThread72hMessages: [
          exactSourceMessage({ source_table: "sms_last_outbound_context", body: "Last outbound only" }),
        ],
        recentTranscriptLineCount: 0,
        includedThreadMessageCount: 1,
        threadFallbackUsedInPacket: false,
        legacyFallbackSourceInPacket: null,
      },
    });
    expect(real.weekly_thread_fallback_used).toBe(false);
    expect(real.weekly_thread_notebook_failure_reason).toBe("none");
    expect(fallbackOnly.weekly_thread_fallback_used).toBe(true);
    expect(fallbackOnly.weekly_thread_notebook_failure_reason).toBe(
      "last_outbound_or_packet_fallback_used"
    );
  });

  it("reads included_thread_message_count from weekly lane metadata", () => {
    expect(
      readIncludedThreadMessageCountFromWeeklyLaneMetadata({ included_thread_message_count: 6 })
    ).toBe(6);
    expect(readIncludedThreadMessageCountFromWeeklyLaneMetadata({})).toBeNull();
  });
});

describe("finalizeWeeklyNotebookVerdict", () => {
  it("verified old keys → weekly_notebook_verdict verified / reason none", () => {
    const verdict = finalizeWeeklyNotebookVerdict({
      weekly_thread_correct_notebook_verified: true,
      weekly_thread_notebook_failure_reason: "none",
      weekly_thread_source_candidate_count: 5,
      weekly_thread_exact_source_message_count: 3,
      weekly_thread_message_count: 4,
      weekly_memory_packet_used: true,
      weekly_writer_invoked: true,
    });
    expect(verdict.weekly_notebook_verdict).toBe("verified");
    expect(verdict.weekly_notebook_verdict_reason).toBe("none");
    expect(verdict.weekly_notebook_source_candidate_count).toBe(5);
    expect(verdict.weekly_notebook_writer_payload_included).toBe(true);
  });

  it("false old keys with legacy_transcript_fallback_used → failed / legacy_transcript_fallback_used", () => {
    const verdict = finalizeWeeklyNotebookVerdict({
      weekly_thread_correct_notebook_verified: false,
      weekly_thread_notebook_failure_reason: "legacy_transcript_fallback_used",
      weekly_thread_legacy_transcript_fallback_used: true,
      weekly_memory_packet_used: true,
      weekly_thread_source_candidate_count: 0,
      weekly_thread_exact_source_message_count: 0,
      weekly_writer_invoked: true,
    });
    expect(verdict.weekly_notebook_verdict).toBe("failed");
    expect(verdict.weekly_notebook_verdict_reason).toBe("legacy_transcript_fallback_used");
  });

  it("false old keys with exact_thread_too_thin → failed / exact_thread_too_thin", () => {
    const verdict = finalizeWeeklyNotebookVerdict({
      weekly_thread_correct_notebook_verified: false,
      weekly_thread_notebook_failure_reason: "exact_thread_too_thin",
      weekly_thread_source_candidate_count: 17,
      weekly_thread_exact_source_message_count: 1,
      weekly_thread_message_count: 1,
      weekly_memory_packet_used: true,
      weekly_writer_invoked: true,
    });
    expect(verdict.weekly_notebook_verdict).toBe("failed");
    expect(verdict.weekly_notebook_verdict_reason).toBe("exact_thread_too_thin");
  });

  it("memory_packet_build_failed → failed / memory_packet_build_failed", () => {
    const verdict = finalizeWeeklyNotebookVerdict({
      weekly_memory_packet_build_failed: true,
      weekly_memory_packet_used: false,
      weekly_writer_invoked: true,
    });
    expect(verdict.weekly_notebook_verdict).toBe("failed");
    expect(verdict.weekly_notebook_verdict_reason).toBe("memory_packet_build_failed");
  });

  it("memory_packet_used false → failed / memory_packet_not_used", () => {
    const verdict = finalizeWeeklyNotebookVerdict({
      weekly_memory_packet_used: false,
      weekly_memory_packet_build_failed: false,
      weekly_writer_invoked: true,
    });
    expect(verdict.weekly_notebook_verdict).toBe("failed");
    expect(verdict.weekly_notebook_verdict_reason).toBe("memory_packet_not_used");
  });

  it("counts exist but no old verdict → failed / unknown_missing_telemetry", () => {
    const verdict = finalizeWeeklyNotebookVerdict({
      weekly_thread_source_candidate_count: 22,
      weekly_thread_message_count: 15,
      weekly_memory_packet_used: true,
      weekly_writer_invoked: true,
    });
    expect(verdict.weekly_notebook_verdict).toBe("failed");
    expect(verdict.weekly_notebook_verdict_reason).toBe("unknown_missing_telemetry");
    expect(verdict.weekly_notebook_source_candidate_count).toBe(22);
    expect(verdict.weekly_notebook_thread_message_count).toBe(15);
  });

  it("writer not invoked → not_applicable / writer_not_invoked", () => {
    const verdict = finalizeWeeklyNotebookVerdict({
      weekly_writer_invoked: false,
    });
    expect(verdict.weekly_notebook_verdict).toBe("not_applicable");
    expect(verdict.weekly_notebook_verdict_reason).toBe("writer_not_invoked");
  });

  it("no_history_expected → not_applicable / no_history_expected", () => {
    const verdict = finalizeWeeklyNotebookVerdict({
      weekly_no_history_expected: true,
      weekly_thread_legacy_transcript_fallback_used: true,
      weekly_writer_invoked: true,
    });
    expect(verdict.weekly_notebook_verdict).toBe("not_applicable");
    expect(verdict.weekly_notebook_verdict_reason).toBe("no_history_expected");
  });

  it("attachWeeklyNotebookVerdictToMetadata never leaves blank verdict", () => {
    const cases: Record<string, unknown>[] = [
      {},
      { weekly_thread_correct_notebook_verified: true },
      { weekly_thread_source_candidate_count: 3 },
      { lane_stage: "no_client", weekly_writer_invoked: false },
      {
        weekly_thread_correct_notebook_verified: false,
        weekly_thread_notebook_failure_reason: "legacy_transcript_fallback_used",
        weekly_thread_legacy_transcript_fallback_used: true,
        weekly_memory_packet_used: true,
      },
    ];
    for (const meta of cases) {
      const out = attachWeeklyNotebookVerdictToMetadata(meta);
      expect(typeof out.weekly_notebook_verdict).toBe("string");
      expect((out.weekly_notebook_verdict as string).length).toBeGreaterThan(0);
      expect(typeof out.weekly_notebook_verdict_reason).toBe("string");
      expect((out.weekly_notebook_verdict_reason as string).length).toBeGreaterThan(0);
    }
  });
});
