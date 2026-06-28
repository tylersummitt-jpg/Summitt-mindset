import { describe, expect, it } from "vitest";

import type { BriefThreadBuildTelemetry } from "@/lib/sms-recent-exact-thread-72h";
import {
  buildDailyNotebookTelemetry,
  resolveDailyNotebookFailureReason,
} from "@/lib/sms-daily-notebook-telemetry";

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

const healthyArgs = {
  buildTelemetry: sampleBuildTelemetry(),
  briefBuildStatus: "used" as const,
  messageCount: 4,
  exactSourceMessageCount: 3,
  lastOutboundFallbackMessageCount: 0,
  writerInvoked: true,
};

describe("sms-daily-notebook-telemetry", () => {
  it("healthy daily thread with exact source messages is verified with reason none", () => {
    const telemetry = buildDailyNotebookTelemetry(healthyArgs);
    expect(telemetry.daily_thread_correct_notebook_verified).toBe(true);
    expect(telemetry.daily_thread_notebook_failure_reason).toBe("none");
    expect(telemetry.daily_thread_message_source_breakdown).toBe("exact:3|last_outbound:0");
    expect(telemetry.daily_thread_exact_source_message_count).toBe(3);
  });

  it("fetch_error_count > 0 yields fetch_error", () => {
    const telemetry = buildDailyNotebookTelemetry({
      ...healthyArgs,
      buildTelemetry: sampleBuildTelemetry({ daily_brief_thread_fetch_error_count: 2 }),
    });
    expect(telemetry.daily_thread_correct_notebook_verified).toBe(false);
    expect(telemetry.daily_thread_notebook_failure_reason).toBe("fetch_error");
  });

  it("schema_fallback_used yields schema_fallback_used", () => {
    const telemetry = buildDailyNotebookTelemetry({
      ...healthyArgs,
      buildTelemetry: sampleBuildTelemetry({
        daily_brief_thread_schema_fallback_used: true,
        daily_brief_thread_schema_fallback_sources: "sms_send_events",
      }),
    });
    expect(telemetry.daily_thread_correct_notebook_verified).toBe(false);
    expect(telemetry.daily_thread_notebook_failure_reason).toBe("schema_fallback_used");
  });

  it("source_candidate_count = 0 yields no_source_candidates", () => {
    const telemetry = buildDailyNotebookTelemetry({
      ...healthyArgs,
      messageCount: 0,
      exactSourceMessageCount: 0,
      buildTelemetry: sampleBuildTelemetry({ daily_brief_thread_source_candidate_count: 0 }),
    });
    expect(telemetry.daily_thread_notebook_failure_reason).toBe("no_source_candidates");
  });

  it("source_candidate_count > 0 but exact_source_message_count = 0 yields source_candidates_no_exact_messages", () => {
    const telemetry = buildDailyNotebookTelemetry({
      ...healthyArgs,
      messageCount: 0,
      exactSourceMessageCount: 0,
    });
    expect(telemetry.daily_thread_notebook_failure_reason).toBe("source_candidates_no_exact_messages");
  });

  it("fallback_used yields last_outbound_or_packet_fallback_used", () => {
    const telemetry = buildDailyNotebookTelemetry({
      ...healthyArgs,
      buildTelemetry: sampleBuildTelemetry({ daily_brief_thread_fallback_used: true }),
    });
    expect(telemetry.daily_thread_notebook_failure_reason).toBe(
      "last_outbound_or_packet_fallback_used"
    );
  });

  it("message_count <= 1 yields exact_thread_too_thin", () => {
    const telemetry = buildDailyNotebookTelemetry({
      ...healthyArgs,
      messageCount: 1,
      exactSourceMessageCount: 1,
    });
    expect(telemetry.daily_thread_notebook_failure_reason).toBe("exact_thread_too_thin");
  });

  it("maps filtered_out_reason_top to specific failure reasons", () => {
    expect(
      resolveDailyNotebookFailureReason({
        correctNotebookVerified: false,
        writerInvoked: true,
        briefBuildStatus: "used",
        buildTelemetry: sampleBuildTelemetry({
          daily_brief_thread_filtered_out_count: 3,
          daily_brief_thread_filtered_out_reason_top: "empty_body",
        }),
        primaryFetchSucceeded: true,
        fetchErrorCount: 0,
        schemaFallbackUsed: false,
        sourceCandidateCount: 4,
        exactSourceMessageCount: 0,
        messageCount: 0,
        threadFallbackUsed: false,
        filteredOutCount: 3,
        filteredOutReasonTop: "empty_body",
      })
    ).toBe("source_candidates_filtered_out_empty_body");

    expect(
      buildDailyNotebookTelemetry({
        ...healthyArgs,
        messageCount: 0,
        exactSourceMessageCount: 0,
        buildTelemetry: sampleBuildTelemetry({
          daily_brief_thread_filtered_out_count: 2,
          daily_brief_thread_filtered_out_reason_top: "not_truly_sent",
        }),
      }).daily_thread_notebook_failure_reason
    ).toBe("source_candidates_filtered_out_not_truly_sent");

    expect(
      buildDailyNotebookTelemetry({
        ...healthyArgs,
        messageCount: 0,
        exactSourceMessageCount: 0,
        buildTelemetry: sampleBuildTelemetry({
          daily_brief_thread_filtered_out_count: 1,
          daily_brief_thread_filtered_out_reason_top: "timestamp_outside_window",
        }),
      }).daily_thread_notebook_failure_reason
    ).toBe("source_candidates_filtered_out_timestamp_outside_window");
  });

  it("brief not used yields daily_brief_not_used", () => {
    const telemetry = buildDailyNotebookTelemetry({
      ...healthyArgs,
      briefBuildStatus: "skipped_missing_strategy_card",
    });
    expect(telemetry.daily_thread_notebook_failure_reason).toBe("daily_brief_not_used");
  });
});
