import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  attachWeeklyNotebookVerdictToMetadata,
  buildWeeklyNotebookTelemetry,
} from "@/lib/sms-weekly-notebook-telemetry";
import { relationshipObservabilityFromLaneMetadata } from "@/lib/sms-relationship-packet-v1";
import type { BriefThreadBuildTelemetry } from "@/lib/sms-recent-exact-thread-72h";

function sampleBuildTelemetry(): BriefThreadBuildTelemetry {
  return {
    daily_brief_thread_source_candidate_count: 8,
    daily_brief_thread_visible_send_candidate_count: 4,
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
    daily_brief_thread_recovered_source_rows: 8,
  };
}

function expectCanonicalWeeklyVerdict(meta: Record<string, unknown>) {
  expect(typeof meta.weekly_notebook_verdict).toBe("string");
  expect((meta.weekly_notebook_verdict as string).length).toBeGreaterThan(0);
  expect(typeof meta.weekly_notebook_verdict_reason).toBe("string");
  expect((meta.weekly_notebook_verdict_reason as string).length).toBeGreaterThan(0);
}

/** Mirrors weekly-sms/route.ts enrichWeeklyPersistenceMetadata (telemetry only). */
function enrichWeeklyPersistenceMetadata(
  base: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return attachWeeklyNotebookVerdictToMetadata({ ...base, ...extra });
}

describe("weekly V3 notebook verdict wire", () => {
  const healthyWeeklyNotebook = buildWeeklyNotebookTelemetry({
    buildTelemetry: sampleBuildTelemetry(),
    memoryPacketUsed: true,
    memoryPacketBuildFailed: false,
    includedThreadMessageCount: 4,
    writerInvoked: true,
    sourceBreakdown: {
      recentExactThread72hMessages: [
        {
          at: "2026-06-01T12:00:00.000Z",
          at_local: "Jun 1",
          at_local_timezone: "America/New_York",
          local_day_key: "2026-06-01",
          role: "coach",
          body: "Coach line one",
          message_kind: "daily",
          source_table: "sms_send_events",
          message_sid: "SM1",
          delivery_status: "sent",
          is_exact_body: true,
        },
        {
          at: "2026-06-01T12:05:00.000Z",
          at_local: "Jun 1",
          at_local_timezone: "America/New_York",
          local_day_key: "2026-06-01",
          role: "user",
          body: "User line one",
          message_kind: null,
          source_table: "sms_inbound_messages",
          message_sid: "SM2",
          delivery_status: "sent",
          is_exact_body: true,
        },
        {
          at: "2026-06-01T12:10:00.000Z",
          at_local: "Jun 1",
          at_local_timezone: "America/New_York",
          local_day_key: "2026-06-01",
          role: "coach",
          body: "Coach line two",
          message_kind: "weekly",
          source_table: "sms_weekly_send_events",
          message_sid: "SM3",
          delivery_status: "sent",
          is_exact_body: true,
        },
      ],
      recentTranscriptLineCount: 0,
      includedThreadMessageCount: 4,
      threadFallbackUsedInPacket: false,
      legacyFallbackSourceInPacket: null,
    },
  });

  const weeklyV3MetaBase = enrichWeeklyPersistenceMetadata({
    weekly_v3_lane_used: true,
    lane_stage: "ok",
    ...healthyWeeklyNotebook,
  });
  weeklyV3MetaBase.relationship_packet_observability = relationshipObservabilityFromLaneMetadata(
    weeklyV3MetaBase
  );

  it("accepted weekly V3 metadata includes weekly_notebook_verdict", () => {
    const accepted = enrichWeeklyPersistenceMetadata(weeklyV3MetaBase, {
      visible_sent: true,
      no_send_reason: null,
    });
    expectCanonicalWeeklyVerdict(accepted);
    expect(accepted.weekly_notebook_verdict).toBe("verified");
    expect(accepted.weekly_thread_correct_notebook_verified).toBe(true);
  });

  it("skipped_no_safe_v3_voice metadata includes weekly_notebook_verdict", () => {
    const skipped = enrichWeeklyPersistenceMetadata(weeklyV3MetaBase, {
      no_send_tag: "weekly_v3_lane_no_send",
      no_send_reason: "lane_post_validate_blocked",
      voice_decision: "skipped_no_safe_v3_voice",
    });
    expectCanonicalWeeklyVerdict(skipped);
    expect(skipped.weekly_notebook_verdict).toBe("verified");
  });

  it("weekly_thread_memory_repeat_blocked metadata includes weekly_notebook_verdict", () => {
    const repeatBlocked = enrichWeeklyPersistenceMetadata(weeklyV3MetaBase, {
      no_send_reason: "weekly_thread_memory_repeat_blocked",
      lane_stage: "weekly_thread_memory_repeat_guard_failed",
    });
    expectCanonicalWeeklyVerdict(repeatBlocked);
    expect(repeatBlocked.weekly_notebook_verdict).toBe("verified");
  });

  it("FVG-blocked weekly metadata includes weekly_notebook_verdict", () => {
    const fvgBlocked = enrichWeeklyPersistenceMetadata(weeklyV3MetaBase, {
      no_send_tag: "final_voice_gate_no_send",
      no_send_reason: "generic_future_recommitment_question_blocked",
      voice_decision: "skipped_no_safe_v3_voice",
    });
    expectCanonicalWeeklyVerdict(fvgBlocked);
    expect(fvgBlocked.weekly_notebook_verdict).toBe("verified");
  });

  it("legacy transcript fallback metadata maps to failed verdict", () => {
    const legacyFallbackNotebook = buildWeeklyNotebookTelemetry({
      buildTelemetry: sampleBuildTelemetry({ daily_brief_thread_source_candidate_count: 0 }),
      memoryPacketUsed: true,
      memoryPacketBuildFailed: false,
      includedThreadMessageCount: 2,
      writerInvoked: true,
      sourceBreakdown: {
        recentExactThread72hMessages: [],
        recentTranscriptLineCount: 2,
        includedThreadMessageCount: 2,
        threadFallbackUsedInPacket: true,
        legacyFallbackSourceInPacket: "recent_transcript_lines",
      },
    });
    const meta = enrichWeeklyPersistenceMetadata({
      weekly_v3_lane_used: true,
      lane_stage: "ok",
      ...legacyFallbackNotebook,
    });
    expect(meta.weekly_notebook_verdict).toBe("failed");
    expect(meta.weekly_notebook_verdict_reason).toBe("legacy_transcript_fallback_used");
    expect(meta.weekly_thread_legacy_transcript_fallback_used).toBe(true);
  });

  it("relationship_packet_observability mirrors canonical weekly fields", () => {
    const obs = relationshipObservabilityFromLaneMetadata(weeklyV3MetaBase);
    expect(obs.weekly_notebook_verdict).toBe("verified");
    expect(obs.weekly_notebook_verdict_reason).toBe("none");
    expect(obs.weekly_notebook_source_candidate_count).toBe(8);
    expect(obs.weekly_thread_correct_notebook_verified).toBe(true);
    expect(obs.weekly_thread_source_candidate_count).toBe(8);
  });

  it("old weekly fields still emitted alongside canonical verdict", () => {
    expect(weeklyV3MetaBase.weekly_thread_correct_notebook_verified).toBe(true);
    expect(weeklyV3MetaBase.weekly_thread_notebook_failure_reason).toBe("none");
    expect(weeklyV3MetaBase.weekly_memory_packet_used).toBe(true);
    expect(weeklyV3MetaBase.weekly_thread_source_candidate_count).toBe(8);
    expect(weeklyV3MetaBase.weekly_notebook_verdict).toBe("verified");
  });
});
