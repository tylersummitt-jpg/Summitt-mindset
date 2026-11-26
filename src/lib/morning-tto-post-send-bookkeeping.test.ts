import { beforeEach, describe, expect, it, vi } from "vitest";

const planThreadMemoryMock = vi.hoisted(() => vi.fn());
const reconcileCheckSentMock = vi.hoisted(() => vi.fn());
const reconcileRefreshMock = vi.hoisted(() => vi.fn());
const hasCheckSentMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/v2-commitment-sms-thread-memory", () => ({
  planCommitmentSmsThreadMemoryFromOutbound: planThreadMemoryMock,
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { rpc: rpcMock },
}));

vi.mock("@/lib/v2-outbound-check-sent", () => ({
  reconcileCheckSentPostSendBookkeepingForCommitment: reconcileCheckSentMock,
  reconcileRefreshPostSendBookkeepingForCommitment: undefined,
  hasCheckSentForCommitmentDaySlot: hasCheckSentMock,
  onV2StandardCheckSentOutboundSendSuccess: vi.fn(async () => {
    throw new Error("onV2StandardCheckSentOutboundSendSuccess must not be called");
  }),
}));

vi.mock("@/lib/v2-refresh-session", () => ({
  reconcileRefreshPostSendBookkeepingForCommitment: reconcileRefreshMock,
}));

vi.mock("@/lib/v2-coaching-memory", () => ({
  recomputeV2CoachingMemory: vi.fn(async () => {
    throw new Error("recomputeV2CoachingMemory must not be called from Morning post-send");
  }),
}));

import { runMorningTtoPostSendBookkeeping } from "@/lib/morning-tto-post-send-bookkeeping";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("runMorningTtoPostSendBookkeeping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reconcileCheckSentMock.mockResolvedValue({});
    reconcileRefreshMock.mockResolvedValue({});
    hasCheckSentMock.mockResolvedValue(false);
    planThreadMemoryMock.mockResolvedValue({ ok: true, ops: [{ op: "insert", row: { last_outbound_full_body: "body" } }] });
    rpcMock.mockResolvedValue({ data: [{ outcome: "recorded", reason: null }], error: null });
  });

  it("source module has no OpenAI or coaching-memory recompute dependency", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/morning-tto-post-send-bookkeeping.ts"),
      "utf8"
    );
    expect(src).not.toContain("recomputeV2CoachingMemory");
    expect(src).not.toContain("openai");
    expect(src).not.toContain("OpenAI");
    expect(src).toContain("tto_record_scheduled_post_send_bookkeeping");
    expect(src).toContain("scheduledDeletionFence: true");
    expect(src).not.toContain("insertV2CheckSentEventBestEffort");
    expect(src).not.toContain("upsertCommitmentSmsThreadMemoryFromOutbound");
    expect(src).not.toContain("onV2StandardCheckSentOutboundSendSuccess");
    expect(src).not.toContain("yes_no_partial");
    expect(src).not.toContain("relationship_profile");
    expect(src).not.toContain("next_move");
    expect(src).not.toContain("silence_tier");
  });

  it("passes exact sent body to thread memory without inventing expected-answer type", async () => {
    const body = "Proud of how you showed up yesterday.";
    const result = await runMorningTtoPostSendBookkeeping({
      commitmentId: "c1",
      clerkUserId: "u1",
      dayKey: "2026-07-31",
      sentBody: `  ${body}  `,
      messageSid: "SM1",
      sentAt: new Date("2026-07-31T12:00:00.000Z"),
    });
    expect(result).toEqual({ ok: true });
    expect(planThreadMemoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        commitmentId: "c1",
        clerkUserId: "u1",
        sentBody: body,
        messageSid: "SM1",
        source: "daily_sms",
        clearBindingOpenQuestion: true,
        sentAt: new Date("2026-07-31T12:00:00.000Z"),
      })
    );
    const call = planThreadMemoryMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("expectedAnswerType");
    expect(rpcMock).toHaveBeenCalledWith(
      "tto_record_scheduled_post_send_bookkeeping",
      expect.objectContaining({
        p_commitment_id: "c1",
        p_day_key: "2026-07-31",
        p_send_slot: "morning",
        p_message_sid: "SM1",
        p_sent_at: "2026-07-31T12:00:00.000Z",
        p_record_check_sent: true,
        p_body_preview: body.slice(0, 160),
      })
    );
  });

  it("does not invent yes_no_partial for statement, open question, or encouragement bodies", async () => {
    for (const sentBody of [
      "Glad you rested.",
      "How did dinner with Brooke go?",
      "You've got this.",
    ]) {
      vi.clearAllMocks();
      hasCheckSentMock.mockResolvedValue(false);
      planThreadMemoryMock.mockResolvedValue({ ok: true, ops: [] });
      rpcMock.mockResolvedValue({ data: [{ outcome: "recorded", reason: null }], error: null });
      reconcileCheckSentMock.mockResolvedValue({});
      reconcileRefreshMock.mockResolvedValue({});

      await runMorningTtoPostSendBookkeeping({
        commitmentId: "c1",
        clerkUserId: "u1",
        dayKey: "2026-07-31",
        sentBody,
        messageSid: "SM-x",
      });

      expect(planThreadMemoryMock.mock.calls[0]?.[0]).not.toHaveProperty("expectedAnswerType");
      expect(rpcMock).toHaveBeenCalledWith(
        "tto_record_scheduled_post_send_bookkeeping",
        expect.objectContaining({
          p_body_preview: sentBody.slice(0, 160),
          p_message_sid: "SM-x",
          p_record_check_sent: true,
          p_replay: null,
        })
      );
      const payload = rpcMock.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(payload).not.toHaveProperty("promptKind");
      expect(payload).not.toHaveProperty("expectedReplySemantics");
      expect(JSON.stringify(payload)).not.toContain("yes_no_partial");
    }
  });

  it("skips operational check_sent insert when day slot already has check_sent", async () => {
    hasCheckSentMock.mockResolvedValue(true);
    await runMorningTtoPostSendBookkeeping({
      commitmentId: "c1",
      clerkUserId: "u1",
      dayKey: "2026-07-31",
      sentBody: "Hello",
      messageSid: "SM2",
    });
    expect(rpcMock).toHaveBeenCalledWith(
      "tto_record_scheduled_post_send_bookkeeping",
      expect.objectContaining({ p_record_check_sent: false })
    );
  });

  it("returns controlled failure when operational check_sent insert throws", async () => {
    rpcMock.mockRejectedValue(new Error("insert_failed"));
    const result = await runMorningTtoPostSendBookkeeping({
      commitmentId: "c1",
      clerkUserId: "u1",
      dayKey: "2026-07-31",
      sentBody: "Hello",
      messageSid: "SM3",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("insert_failed");
  });

  it("does not invoke recomputeV2CoachingMemory", async () => {
    const { recomputeV2CoachingMemory } = await import("@/lib/v2-coaching-memory");
    await runMorningTtoPostSendBookkeeping({
      commitmentId: "c1",
      clerkUserId: "u1",
      dayKey: "2026-07-31",
      sentBody: "Hello",
      messageSid: "SM4",
    });
    expect(recomputeV2CoachingMemory).not.toHaveBeenCalled();
  });

  it("rejects missing required fields without side effects", async () => {
    const result = await runMorningTtoPostSendBookkeeping({
      commitmentId: "",
      clerkUserId: "u1",
      dayKey: "2026-07-31",
      sentBody: "Hello",
      messageSid: "SM5",
    });
    expect(result).toEqual({ ok: false, error: "missing_required_fields" });
    expect(planThreadMemoryMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
