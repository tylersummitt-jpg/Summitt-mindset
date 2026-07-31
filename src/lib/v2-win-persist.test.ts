import { beforeEach, describe, expect, it, vi } from "vitest";

const { insertMaybeSingle, existingMaybeSingle, fromMock } = vi.hoisted(() => {
  const insertMaybeSingle = vi.fn();
  const existingMaybeSingle = vi.fn();
  const fromMock = vi.fn();
  return { insertMaybeSingle, existingMaybeSingle, fromMock };
});

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: fromMock,
  },
}));

import {
  buildWinIdempotencyKey,
  buildV2WinInsertRow,
  persistRecognizedWins,
} from "@/lib/v2-win-persist";
import {
  WIN_RECOGNITION_VERSION,
  type WinCandidateV1,
  type WinRecognitionResultV1,
} from "@/lib/openai-win-recognition-v1";

function candidate(overrides: Partial<WinCandidateV1> = {}): WinCandidateV1 {
  return {
    ordinal: 0,
    grounded_action: "Apologized to my wife",
    why_meaningful: "Repaired the relationship",
    suggested_title: "Apology",
    suggested_body: "You owned it and apologized.",
    evidence_quote: "apologized to my wife",
    relationship_type: "whole_life",
    recognition_mode: "coach_recognized",
    user_expressed_pride: false,
    identity_related: false,
    sensitivity_caution: false,
    celebration_appropriate: true,
    model_confidence: 0.9,
    ...overrides,
  };
}

function recognition(wins: WinCandidateV1[]): WinRecognitionResultV1 {
  return {
    version: WIN_RECOGNITION_VERSION,
    has_win: wins.length > 0,
    wins,
  };
}

describe("v2-win-persist keys and row construction", () => {
  it("builds sms and system idempotency keys", () => {
    expect(buildWinIdempotencyKey({ sourceType: "sms_inbound", messageSid: "SM1", ordinal: 0 })).toBe(
      "win_v1:SM1:0"
    );
    expect(buildWinIdempotencyKey({ sourceType: "sms_inbound", messageSid: "SM1", ordinal: 1 })).toBe(
      "win_v1:SM1:1"
    );
    expect(
      buildWinIdempotencyKey({ sourceType: "system_event", sourceEventId: "evt-1", ordinal: 0 })
    ).toBe("win_v1:system:evt-1:0");
  });

  it("allows nullable commitment for whole_life and attaches owned goal commitment", () => {
    const whole = buildV2WinInsertRow({
      clerkUserId: "user_1",
      sourceType: "sms_inbound",
      sourceMessageSid: "SM1",
      sourceMessageId: "msg-uuid",
      sourceEventId: null,
      activeCommitmentId: "c1",
      activeCommitmentClerkUserId: "user_1",
      occurredAtIso: "2026-07-31T12:00:00.000Z",
      candidate: candidate({ relationship_type: "whole_life" }),
    });
    expect(whole.commitment_id).toBeNull();

    const goal = buildV2WinInsertRow({
      clerkUserId: "user_1",
      sourceType: "sms_inbound",
      sourceMessageSid: "SM1",
      sourceMessageId: null,
      sourceEventId: null,
      activeCommitmentId: "c1",
      activeCommitmentClerkUserId: "user_1",
      occurredAtIso: "2026-07-31T12:00:00.000Z",
      candidate: candidate({ relationship_type: "goal" }),
    });
    expect(goal.commitment_id).toBe("c1");

    const wrongOwner = buildV2WinInsertRow({
      clerkUserId: "user_1",
      sourceType: "sms_inbound",
      sourceMessageSid: "SM1",
      sourceMessageId: null,
      sourceEventId: null,
      activeCommitmentId: "c1",
      activeCommitmentClerkUserId: "user_other",
      occurredAtIso: "2026-07-31T12:00:00.000Z",
      candidate: candidate({ relationship_type: "goal" }),
    });
    expect(wrongOwner.commitment_id).toBeNull();
  });

  it("omits supporting quote when sensitivity_caution", () => {
    const row = buildV2WinInsertRow({
      clerkUserId: "user_1",
      sourceType: "sms_inbound",
      sourceMessageSid: "SM1",
      sourceMessageId: null,
      sourceEventId: null,
      activeCommitmentId: null,
      activeCommitmentClerkUserId: null,
      occurredAtIso: "2026-07-31T12:00:00.000Z",
      candidate: candidate({ sensitivity_caution: true, evidence_quote: "secret detail" }),
    });
    expect(row.supporting_quote).toBeNull();
  });

  it("uses provided occurred_at and ordinal key", () => {
    const row = buildV2WinInsertRow({
      clerkUserId: "user_1",
      sourceType: "sms_inbound",
      sourceMessageSid: "SMx",
      sourceMessageId: null,
      sourceEventId: null,
      activeCommitmentId: null,
      activeCommitmentClerkUserId: null,
      occurredAtIso: "2026-01-02T03:04:05.000Z",
      candidate: candidate({ ordinal: 1 }),
    });
    expect(row.occurred_at).toBe("2026-01-02T03:04:05.000Z");
    expect(row.idempotency_key).toBe("win_v1:SMx:1");
    expect(row.candidate_ordinal).toBe(1);
  });

  it("rejects sms persist without message sid / clerk", () => {
    expect(() =>
      buildV2WinInsertRow({
        clerkUserId: "",
        sourceType: "sms_inbound",
        sourceMessageSid: "SM1",
        sourceMessageId: null,
        sourceEventId: null,
        activeCommitmentId: null,
        activeCommitmentClerkUserId: null,
        occurredAtIso: "2026-07-31T12:00:00.000Z",
        candidate: candidate(),
      })
    ).toThrow(/clerk_user_id/);
    expect(() =>
      buildV2WinInsertRow({
        clerkUserId: "user_1",
        sourceType: "sms_inbound",
        sourceMessageSid: null,
        sourceMessageId: null,
        sourceEventId: null,
        activeCommitmentId: null,
        activeCommitmentClerkUserId: null,
        occurredAtIso: "2026-07-31T12:00:00.000Z",
        candidate: candidate(),
      })
    ).toThrow(/message_sid/);
  });
});

describe("persistRecognizedWins", () => {
  beforeEach(() => {
    insertMaybeSingle.mockReset();
    existingMaybeSingle.mockReset();
    fromMock.mockReset();
    fromMock.mockImplementation((table: string) => {
      if (table !== "v2_win") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      return {
        insert: () => ({
          select: () => ({
            maybeSingle: insertMaybeSingle,
          }),
        }),
        select: () => ({
          eq: () => ({
            maybeSingle: existingMaybeSingle,
          }),
        }),
      };
    });
  });

  it("inserts nothing for zero wins", async () => {
    const r = await persistRecognizedWins({
      clerkUserId: "user_1",
      sourceType: "sms_inbound",
      sourceMessageSid: "SM1",
      sourceMessageId: null,
      sourceEventId: null,
      activeCommitmentId: null,
      activeCommitmentClerkUserId: null,
      occurredAtIso: "2026-07-31T12:00:00.000Z",
      recognition: recognition([]),
    });
    expect(r.attempted).toBe(0);
    expect(insertMaybeSingle).not.toHaveBeenCalled();
  });

  it("inserts one and two wins", async () => {
    insertMaybeSingle.mockResolvedValue({ data: { id: "w1" }, error: null });
    const one = await persistRecognizedWins({
      clerkUserId: "user_1",
      sourceType: "sms_inbound",
      sourceMessageSid: "SM1",
      sourceMessageId: "mid",
      sourceEventId: null,
      activeCommitmentId: "c1",
      activeCommitmentClerkUserId: "user_1",
      occurredAtIso: "2026-07-31T12:00:00.000Z",
      recognition: recognition([candidate()]),
    });
    expect(one.persisted).toBe(1);
    expect(one.wins[0]?.status).toBe("inserted");

    insertMaybeSingle
      .mockResolvedValueOnce({ data: { id: "w1" }, error: null })
      .mockResolvedValueOnce({ data: { id: "w2" }, error: null });
    const two = await persistRecognizedWins({
      clerkUserId: "user_1",
      sourceType: "sms_inbound",
      sourceMessageSid: "SM2",
      sourceMessageId: null,
      sourceEventId: null,
      activeCommitmentId: null,
      activeCommitmentClerkUserId: null,
      occurredAtIso: "2026-07-31T12:00:00.000Z",
      recognition: recognition([candidate(), candidate({ ordinal: 1 })]),
    });
    expect(two.persisted).toBe(2);
  });

  it("treats unique conflict as existing success and does not restore hidden", async () => {
    insertMaybeSingle.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    existingMaybeSingle.mockResolvedValue({
      data: { id: "existing-hidden", status: "hidden" },
      error: null,
    });
    const r = await persistRecognizedWins({
      clerkUserId: "user_1",
      sourceType: "sms_inbound",
      sourceMessageSid: "SM3",
      sourceMessageId: null,
      sourceEventId: null,
      activeCommitmentId: null,
      activeCommitmentClerkUserId: null,
      occurredAtIso: "2026-07-31T12:00:00.000Z",
      recognition: recognition([candidate()]),
    });
    expect(r.conflicts).toBe(1);
    expect(r.wins[0]?.status).toBe("existing");
    expect(r.wins[0]?.id).toBe("existing-hidden");
    expect(r.allDurable).toBe(true);
  });

  it("marks failed when insert errors without unique conflict", async () => {
    insertMaybeSingle.mockResolvedValue({
      data: null,
      error: { code: "42P01", message: "missing table" },
    });
    const r = await persistRecognizedWins({
      clerkUserId: "user_1",
      sourceType: "sms_inbound",
      sourceMessageSid: "SM4",
      sourceMessageId: null,
      sourceEventId: null,
      activeCommitmentId: null,
      activeCommitmentClerkUserId: null,
      occurredAtIso: "2026-07-31T12:00:00.000Z",
      recognition: recognition([candidate()]),
    });
    expect(r.failed).toBe(1);
    expect(r.allDurable).toBe(false);
  });

  it("fails safely when sms source message sid missing", async () => {
    const r = await persistRecognizedWins({
      clerkUserId: "user_1",
      sourceType: "sms_inbound",
      sourceMessageSid: null,
      sourceMessageId: null,
      sourceEventId: null,
      activeCommitmentId: null,
      activeCommitmentClerkUserId: null,
      occurredAtIso: "2026-07-31T12:00:00.000Z",
      recognition: recognition([candidate()]),
    });
    expect(r.failed).toBe(1);
    expect(insertMaybeSingle).not.toHaveBeenCalled();
  });
});
