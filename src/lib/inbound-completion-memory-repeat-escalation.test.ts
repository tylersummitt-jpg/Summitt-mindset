import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(),
  },
}));

import {
  buildPriorMemoryRepeatNoSendContextFromJob,
  normalizeInboundTextForEscalation,
  parseInboundLaneNoSendLastError,
} from "@/lib/inbound-completion-memory-repeat-escalation";

describe("inbound completion memory repeat escalation", () => {
  it("normalizes inbound text for duplicate matching", () => {
    expect(normalizeInboundTextForEscalation("  I did my 10,000 steps yesterday!  ")).toBe(
      "i did my 10,000 steps yesterday!"
    );
  });

  it("parses prior thread_memory_repeat_blocked last_error", () => {
    const parsed = parseInboundLaneNoSendLastError(
      JSON.stringify({
        tag: "inbound_v3_lane_no_send",
        no_send_reason: "thread_memory_repeat_blocked",
        lane_metadata: { repeated_question: "Have you started steps today?" },
      })
    );
    expect(parsed?.noSendReason).toBe("thread_memory_repeat_blocked");
    expect(parsed?.repeatedQuestion).toContain("steps");
  });

  it("builds escalation context for matching normalized inbound", () => {
    const normalized = normalizeInboundTextForEscalation("I did my 10,000 steps yesterday!");
    const ctx = buildPriorMemoryRepeatNoSendContextFromJob({
      messageSid: "SM_prior",
      lastError: JSON.stringify({
        tag: "inbound_v3_lane_no_send",
        no_send_reason: "thread_memory_repeat_blocked",
        lane_metadata: { repeated_question: "Have you started?" },
      }),
      cancelledAt: "2026-06-01T12:00:00.000Z",
      normalizedInboundText: normalized,
    });
    expect(ctx?.escalation_attempt).toBe(true);
    expect(ctx?.normalized_inbound_text).toBe(normalized);
  });
});
