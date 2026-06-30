import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { attachDailyNotebookVerdictToMetadata } from "@/lib/sms-daily-notebook-telemetry";
import { relationshipObservabilityFromLaneMetadata } from "@/lib/sms-relationship-packet-v1";

/** Mirrors daily-sms/route.ts enrichDailyLaneNoSendMeta (telemetry only). */
function enrichDailyLaneNoSendMeta(
  metadata: Record<string, unknown>,
  noSendReason: string | null
): Record<string, unknown> {
  return attachDailyNotebookVerdictToMetadata({
    ...metadata,
    no_send_reason: noSendReason,
    skip_source: "memory_repeat_no_send",
  });
}

function expectCanonicalVerdict(meta: Record<string, unknown>) {
  expect(typeof meta.notebook_verdict).toBe("string");
  expect((meta.notebook_verdict as string).length).toBeGreaterThan(0);
  expect(typeof meta.notebook_verdict_reason).toBe("string");
  expect((meta.notebook_verdict_reason as string).length).toBeGreaterThan(0);
}

describe("daily V3 notebook verdict wire", () => {
  const healthyBriefMeta = attachDailyNotebookVerdictToMetadata({
    daily_thread_correct_notebook_verified: true,
    daily_thread_notebook_failure_reason: "none",
    daily_brief_thread_source_candidate_count: 8,
    daily_thread_exact_source_message_count: 4,
    daily_brief_thread_message_count: 4,
    daily_brief_thread_filtered_out_reason_top: null,
    daily_brief_thread_fallback_used: false,
    writer_prompt_path: "daily_writing_brief_v1",
    daily_writing_brief_used: true,
    daily_writer_invoked: true,
  });

  it("accepted daily V3 metadata includes notebook_verdict", () => {
    expectCanonicalVerdict(healthyBriefMeta);
    expect(healthyBriefMeta.notebook_verdict).toBe("verified");
  });

  it("skipped_no_safe_v3_voice lane no-send metadata includes notebook_verdict", () => {
    const dailyLaneMeta = enrichDailyLaneNoSendMeta(
      {
        ...healthyBriefMeta,
        lane_stage: "daily_thread_memory_repeat_guard_failed",
        v3_candidate_body: "Repeated candidate body",
      },
      "thread_memory_repeat_blocked"
    );
    expectCanonicalVerdict(dailyLaneMeta);
    expect(dailyLaneMeta.notebook_verdict).toBe("verified");
    const obs = relationshipObservabilityFromLaneMetadata(dailyLaneMeta);
    expect(obs.notebook_verdict).toBe("verified");
    expect(obs.daily_thread_correct_notebook_verified).toBe(true);
  });

  it("thread_memory_repeat_blocked metadata includes notebook_verdict", () => {
    const meta = enrichDailyLaneNoSendMeta(
      {
        daily_thread_correct_notebook_verified: false,
        daily_thread_notebook_failure_reason: "exact_thread_too_thin",
        daily_brief_thread_source_candidate_count: 17,
        daily_thread_exact_source_message_count: 1,
        daily_brief_thread_message_count: 1,
        writer_prompt_path: "daily_writing_brief_v1",
        daily_writer_invoked: true,
        lane_stage: "daily_thread_memory_repeat_guard_failed",
      },
      "thread_memory_repeat_blocked"
    );
    expect(meta.notebook_verdict).toBe("failed");
    expect(meta.notebook_verdict_reason).toBe("exact_thread_too_thin");
  });

  it("lane_post_validate_blocked metadata includes notebook_verdict", () => {
    const meta = attachDailyNotebookVerdictToMetadata({
      daily_thread_correct_notebook_verified: true,
      daily_thread_notebook_failure_reason: "none",
      daily_brief_thread_source_candidate_count: 6,
      daily_brief_thread_message_count: 3,
      writer_prompt_path: "daily_writing_brief_v1",
      daily_writer_invoked: true,
      lane_stage: "post_validate_blocked",
      no_send_reason: "lane_post_validate_blocked",
    });
    expectCanonicalVerdict(meta);
    expect(meta.notebook_verdict).toBe("verified");
  });

  it("missing_required_verbatim metadata uses not_applicable reason", () => {
    const meta = attachDailyNotebookVerdictToMetadata({
      daily_writing_brief_build_status: "skipped_required_verbatim",
      daily_writing_brief_skip_reason: "skipped_required_verbatim",
      daily_writer_invoked: true,
      writer_prompt_path: "legacy_packet_v1",
    });
    expect(meta.notebook_verdict).toBe("not_applicable");
    expect(meta.notebook_verdict_reason).toBe("missing_required_verbatim_before_writer");
  });

  it("relationship_packet_observability mirrors canonical fields on no-send shape", () => {
    const dailyLaneMeta = enrichDailyLaneNoSendMeta(healthyBriefMeta, "thread_memory_repeat_blocked");
    const obs = relationshipObservabilityFromLaneMetadata(dailyLaneMeta);
    expect(obs.notebook_verdict).toBe("verified");
    expect(obs.notebook_source_candidate_count).toBe(8);
    expect(obs.daily_brief_thread_source_candidate_count).toBe(8);
    expect(obs.daily_thread_exact_source_message_count).toBe(4);
    expect(obs.daily_brief_thread_message_count).toBe(4);
  });
});
