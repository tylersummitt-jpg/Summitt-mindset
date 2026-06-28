import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import type { BriefThreadBuildTelemetry } from "@/lib/sms-recent-exact-thread-72h";
import {
  INBOUND_NOTEBOOK_OBSERVABILITY_KEYS,
  buildInboundNotebookTelemetry,
  resolveInboundNotebookFailureReason,
} from "@/lib/sms-inbound-notebook-telemetry";

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

const healthySourceBreakdown = {
  recentExactThread72hMessages: [
    {
      at: "2026-06-24T12:00:00.000Z",
      at_local: "2026-06-24T08:00:00",
      at_local_timezone: "America/New_York",
      local_day_key: "2026-06-24",
      role: "user" as const,
      body: "leash",
      message_kind: null,
      source_table: "sms_inbound_messages",
      message_sid: "SM1",
      delivery_status: "sent" as const,
      is_exact_body: true,
    },
    {
      at: "2026-06-24T13:00:00.000Z",
      at_local: "2026-06-24T09:00:00",
      at_local_timezone: "America/New_York",
      local_day_key: "2026-06-24",
      role: "coach" as const,
      body: "Good — keep that image.",
      message_kind: "coach",
      source_table: "sms_send_events",
      message_sid: "SM2",
      delivery_status: "sent" as const,
      is_exact_body: true,
    },
    {
      at: "2026-06-26T12:00:00.000Z",
      at_local: "2026-06-26T08:00:00",
      at_local_timezone: "America/New_York",
      local_day_key: "2026-06-26",
      role: "user" as const,
      body: "I need help staying focused.",
      message_kind: null,
      source_table: "sms_inbound_messages",
      message_sid: "SM3",
      delivery_status: "sent" as const,
      is_exact_body: true,
    },
  ],
  recentTranscriptLineCount: 0,
  includedThreadMessageCount: 4,
  threadFallbackUsedInPacket: false,
  legacyFallbackSourceInPacket: null,
  hasRecentExactThreadText: true,
};

const healthyArgs = {
  buildTelemetry: sampleBuildTelemetry(),
  contextPacketUsed: true,
  contextPacketBuildFailed: false,
  includedThreadMessageCount: 4,
  writerInvoked: true,
  sourceBreakdown: healthySourceBreakdown,
};

describe("sms-inbound-notebook-telemetry", () => {
  it("rich inbound context with exact source messages is verified with reason none", () => {
    const telemetry = buildInboundNotebookTelemetry(healthyArgs);
    expect(telemetry.inbound_thread_correct_notebook_verified).toBe(true);
    expect(telemetry.inbound_thread_notebook_failure_reason).toBe("none");
    expect(telemetry.inbound_thread_message_source_breakdown).toBe("exact:3|last_outbound:0");
    expect(telemetry.inbound_thread_exact_source_message_count).toBe(3);
    expect(telemetry.inbound_context_packet_used).toBe(true);
  });

  it("fetch_error_count > 0 yields fetch_error", () => {
    const telemetry = buildInboundNotebookTelemetry({
      ...healthyArgs,
      buildTelemetry: sampleBuildTelemetry({ daily_brief_thread_fetch_error_count: 2 }),
    });
    expect(telemetry.inbound_thread_correct_notebook_verified).toBe(false);
    expect(telemetry.inbound_thread_notebook_failure_reason).toBe("fetch_error");
  });

  it("schema_fallback_used yields schema_fallback_used", () => {
    const telemetry = buildInboundNotebookTelemetry({
      ...healthyArgs,
      buildTelemetry: sampleBuildTelemetry({
        daily_brief_thread_schema_fallback_used: true,
        daily_brief_thread_schema_fallback_sources: "sms_send_events",
      }),
    });
    expect(telemetry.inbound_thread_correct_notebook_verified).toBe(false);
    expect(telemetry.inbound_thread_notebook_failure_reason).toBe("schema_fallback_used");
  });

  it("source_candidate_count = 0 yields no_source_candidates", () => {
    const telemetry = buildInboundNotebookTelemetry({
      ...healthyArgs,
      includedThreadMessageCount: 0,
      sourceBreakdown: {
        ...healthySourceBreakdown,
        recentExactThread72hMessages: [],
        includedThreadMessageCount: 0,
      },
      buildTelemetry: sampleBuildTelemetry({ daily_brief_thread_source_candidate_count: 0 }),
    });
    expect(telemetry.inbound_thread_correct_notebook_verified).toBe(false);
    expect(telemetry.inbound_thread_notebook_failure_reason).toBe("no_source_candidates");
  });

  it("source candidates without exact messages yields named filtered failure", () => {
    const telemetry = buildInboundNotebookTelemetry({
      ...healthyArgs,
      sourceBreakdown: {
        ...healthySourceBreakdown,
        recentExactThread72hMessages: [],
      },
      buildTelemetry: sampleBuildTelemetry({
        daily_brief_thread_source_candidate_count: 3,
        daily_brief_thread_filtered_out_count: 3,
        daily_brief_thread_filtered_out_reason_top: "empty_body",
      }),
    });
    expect(telemetry.inbound_thread_correct_notebook_verified).toBe(false);
    expect(telemetry.inbound_thread_notebook_failure_reason).toBe(
      "source_candidates_filtered_out_empty_body"
    );
  });

  it("fallback-only context yields last_outbound_or_packet_fallback_used", () => {
    const telemetry = buildInboundNotebookTelemetry({
      ...healthyArgs,
      buildTelemetry: sampleBuildTelemetry({
        daily_brief_thread_source_candidate_count: 0,
        daily_brief_thread_fallback_used: true,
      }),
      sourceBreakdown: {
        ...healthySourceBreakdown,
        recentExactThread72hMessages: [],
        threadFallbackUsedInPacket: true,
      },
    });
    expect(telemetry.inbound_thread_correct_notebook_verified).toBe(false);
    expect(telemetry.inbound_thread_notebook_failure_reason).toBe(
      "last_outbound_or_packet_fallback_used"
    );
  });

  it("exact thread too thin yields exact_thread_too_thin", () => {
    const telemetry = buildInboundNotebookTelemetry({
      ...healthyArgs,
      includedThreadMessageCount: 1,
      sourceBreakdown: {
        ...healthySourceBreakdown,
        includedThreadMessageCount: 1,
        recentExactThread72hMessages: healthySourceBreakdown.recentExactThread72hMessages?.slice(0, 1),
      },
    });
    expect(telemetry.inbound_thread_correct_notebook_verified).toBe(false);
    expect(telemetry.inbound_thread_notebook_failure_reason).toBe("exact_thread_too_thin");
  });

  it("notebook telemetry exposes all observability keys for turn/SQL payloads", () => {
    const telemetry = buildInboundNotebookTelemetry(healthyArgs) as Record<string, unknown>;
    for (const key of INBOUND_NOTEBOOK_OBSERVABILITY_KEYS) {
      expect(telemetry[key]).toBeDefined();
    }
    expect(telemetry.inbound_thread_correct_notebook_verified).toBe(true);
  });

  it("unclassified is only resolver fallback", () => {
    const reason = resolveInboundNotebookFailureReason({
      correctNotebookVerified: false,
      writerInvoked: true,
      contextPacketUsed: true,
      contextPacketBuildFailed: false,
      buildTelemetry: sampleBuildTelemetry(),
      primaryFetchSucceeded: true,
      fetchErrorCount: 0,
      schemaFallbackUsed: false,
      sourceCandidateCount: 5,
      exactSourceMessageCount: 3,
      messageCount: 4,
      legacyTranscriptFallbackUsed: false,
      inboundThreadFallbackUsed: false,
      filteredOutCount: 0,
      filteredOutReasonTop: null,
    });
    expect(reason).toBe("unclassified_notebook_failure");
  });
});

const SQL_PATH = "supabase/manual/sms_inbound_notebook_health_check.sql";

describe("sms_inbound_notebook_health_check.sql", () => {
  it("is read-only and includes exhaustive inbound notebook health diagnostics", async () => {
    const sql = await readFile(SQL_PATH, "utf8");
    const upper = sql.toUpperCase();

    expect(upper).not.toMatch(/\bINSERT\s+INTO\b/);
    expect(upper).not.toMatch(/^\s*UPDATE\s+\w/m);
    expect(upper).not.toMatch(/\bDELETE\s+FROM\b/);

    expect(sql).toContain("inbound_thread_notebook_failure_reason");
    expect(sql).toContain("inbound_thread_correct_notebook_verified");
    expect(sql).toContain("inbound_context_packet_used");
    expect(sql).toContain("inbound_context_packet_build_failed");
    expect(sql).toContain("inbound_thread_message_source_breakdown");
    expect(sql).toContain("inbound_notebook_health");
    expect(sql).toContain("correct_notebook_verified");
    expect(sql).toContain("unclassified_notebook_failure");
    expect(sql).toContain("schema_fallback_used");
    expect(sql).not.toMatch(/ELSE\s+'needs_review'/);
  });
});
