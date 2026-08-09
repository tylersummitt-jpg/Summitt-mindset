import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  buildAccountabilityWinIdempotencyKey,
  buildAccountabilityV2WinInsertRow,
  persistRecognizedWins,
  persistInboundWinsWithAccountability,
} from "@/lib/v2-win-persist";
import { buildStructuralAccountabilityWinPresentation } from "@/lib/v2-win-accountability-merge";
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

describe("accountability user_yes Win persistence", () => {
  beforeEach(() => {
    insertMaybeSingle.mockReset();
    existingMaybeSingle.mockReset();
    fromMock.mockReset();
    fromMock.mockImplementation((table: string) => {
      if (table === "v2_commitment_event") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "evt-yes-1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "sms_inbound_messages") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
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
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            maybeSingle: async () => {
              insertMaybeSingle(row);
              return { data: { id: `w-${String(row.idempotency_key)}` }, error: null };
            },
          }),
        }),
        select: () => ({
          eq: () => ({
            maybeSingle: existingMaybeSingle,
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: async () => ({ error: null }),
          }),
        }),
      };
    });
  });

  it("builds accountability row with acc_yes key, ordinal 0, commitment, source_event_id", () => {
    const row = buildAccountabilityV2WinInsertRow({
      clerkUserId: "user_1",
      messageSid: "SMyes",
      sourceMessageId: "msg-1",
      sourceEventId: "evt-1",
      commitmentId: "c1",
      occurredAtIso: "2026-08-08T12:00:00.000Z",
      presentation: buildStructuralAccountabilityWinPresentation({
        effectiveAsk: "Lift weights for 30 minutes a day",
      }),
    });
    expect(row.idempotency_key).toBe("win_v1:acc_yes:SMyes");
    expect(row.idempotency_key).not.toBe(buildWinIdempotencyKey({
      sourceType: "sms_inbound",
      messageSid: "SMyes",
      ordinal: 0,
    }));
    expect(buildAccountabilityWinIdempotencyKey("SMyes")).toBe(row.idempotency_key);
    expect(row.candidate_ordinal).toBe(0);
    expect(row.commitment_id).toBe("c1");
    expect(row.source_event_id).toBe("evt-1");
    expect(row.relationship_type).toBe("goal");
    expect(row.source_type).toBe("sms_inbound");
  });

  it("confirmed user_yes + goal recognition → exactly one durable completion Win", async () => {
    existingMaybeSingle.mockResolvedValue({ data: null, error: null });
    const r = await persistInboundWinsWithAccountability({
      clerkUserId: "user_1",
      messageSid: "SMyep",
      sourceMessageId: null,
      userYesEventId: "evt-yes-1",
      commitmentId: "c1",
      occurredAtIso: "2026-08-08T12:00:00.000Z",
      effectiveAsk: "Lift weights for 30 minutes a day",
      recognition: recognition([
        candidate({
          relationship_type: "goal",
          suggested_title: "Lifted today",
          suggested_body: "You protected the bar.",
        }),
      ]),
      equivalenceByOrdinal: { 0: "same" },
    });
    expect(r.attempted).toBe(1);
    expect(r.persisted).toBe(1);
    expect(r.wins).toHaveLength(1);
    expect(r.wins[0]?.ordinal).toBe(0);
    expect(r.wins[0]?.idempotency_key).toBe("win_v1:acc_yes:SMyep");
    const insertedRow = insertMaybeSingle.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedRow.display_title).toBe("Lifted today");
    expect(insertedRow.source_event_id).toBe("evt-yes-1");
    expect(insertedRow.commitment_id).toBe("c1");
  });

  it("retry same MessageSid → existing accountability Win, no duplicate insert success path", async () => {
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
            maybeSingle: async () => ({
              data: null,
              error: { code: "23505", message: "duplicate key" },
            }),
          }),
        }),
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "existing-acc", status: "active" },
              error: null,
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: async () => ({ error: null }),
          }),
        }),
      };
    });

    const r = await persistInboundWinsWithAccountability({
      clerkUserId: "user_1",
      messageSid: "SMretry",
      sourceMessageId: null,
      userYesEventId: "evt-1",
      commitmentId: "c1",
      occurredAtIso: "2026-08-08T12:00:00.000Z",
      effectiveAsk: "Lift weights for 30 minutes a day",
      recognition: null,
      equivalenceByOrdinal: {},
    });
    expect(r.conflicts).toBe(1);
    expect(r.persisted).toBe(0);
    expect(r.wins[0]?.status).toBe("existing");
    expect(r.wins[0]?.id).toBe("existing-acc");
    expect(r.allDurable).toBe(true);
  });

  it("user_yes + workout goal + promotion → two Wins with normalized ordinals/keys", async () => {
    existingMaybeSingle.mockResolvedValue({ data: null, error: null });
    const r = await persistInboundWinsWithAccountability({
      clerkUserId: "user_1",
      messageSid: "SMtwo",
      sourceMessageId: null,
      userYesEventId: "evt-yes-2",
      commitmentId: "c1",
      occurredAtIso: "2026-08-08T12:00:00.000Z",
      effectiveAsk: "Lift weights for 30 minutes a day",
      recognition: recognition([
        candidate({ ordinal: 0, relationship_type: "goal", suggested_title: "Workout done" }),
        candidate({
          ordinal: 1,
          relationship_type: "whole_life",
          grounded_action: "Got promoted",
          suggested_title: "Promotion",
          suggested_body: "You earned the promotion.",
          evidence_quote: "got promoted",
        }),
      ]),
      equivalenceByOrdinal: { 0: "same", 1: "distinct" },
    });
    expect(r.attempted).toBe(2);
    expect(r.persisted).toBe(2);
    expect(r.wins[0]?.idempotency_key).toBe("win_v1:acc_yes:SMtwo");
    expect(r.wins[1]?.idempotency_key).toBe("win_v1:SMtwo:1");
    expect(r.wins[1]?.ordinal).toBe(1);
    const indRow = insertMaybeSingle.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(indRow.commitment_id).toBeNull();
    expect(indRow.relationship_type).toBe("whole_life");
    expect(indRow.candidate_ordinal).toBe(1);
  });

  it("user_yes + workout + distinct 300lb deadlift → two goal-linked durable Wins", async () => {
    existingMaybeSingle.mockResolvedValue({ data: null, error: null });
    const r = await persistInboundWinsWithAccountability({
      clerkUserId: "user_1",
      messageSid: "SMdl",
      sourceMessageId: null,
      userYesEventId: "evt-dl",
      commitmentId: "c1",
      occurredAtIso: "2026-08-08T12:00:00.000Z",
      effectiveAsk: "Lift weights for 30 minutes",
      inboundMessage: "Yes, did my workout. I also deadlifted 300 pounds for the first time.",
      recognition: recognition([
        candidate({
          ordinal: 0,
          relationship_type: "goal",
          suggested_title: "Workout done",
          grounded_action: "Completed the workout",
        }),
        candidate({
          ordinal: 1,
          relationship_type: "goal",
          grounded_action: "Deadlifted 300 pounds for the first time",
          suggested_title: "First 300 deadlift",
          suggested_body: "You hit a first-time 300-pound deadlift.",
          evidence_quote: "deadlifted 300",
        }),
      ]),
      equivalenceByOrdinal: { 0: "same", 1: "distinct" },
    });
    expect(r.persisted).toBe(2);
    expect(r.wins[0]?.idempotency_key).toBe("win_v1:acc_yes:SMdl");
    expect(r.wins[1]?.idempotency_key).toBe("win_v1:SMdl:1");
    const second = insertMaybeSingle.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(second.relationship_type).toBe("goal");
    expect(second.display_title).toBe("First 300 deadlift");
    expect(second.candidate_ordinal).toBe(1);
    expect(second.commitment_id).toBe("c1");
  });

  it("user_yes without recognition still creates structural accountability Win", async () => {
    existingMaybeSingle.mockResolvedValue({ data: null, error: null });
    const r = await persistInboundWinsWithAccountability({
      clerkUserId: "user_1",
      messageSid: "SMbare",
      sourceMessageId: null,
      userYesEventId: "evt-bare",
      commitmentId: "c1",
      occurredAtIso: "2026-08-08T12:00:00.000Z",
      effectiveAsk: "Lift weights for 30 minutes a day",
      recognition: null,
      equivalenceByOrdinal: {},
    });
    expect(r.persisted).toBe(1);
    const row = insertMaybeSingle.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.idempotency_key).toBe("win_v1:acc_yes:SMbare");
    expect(String(row.display_title)).toContain("Lift weights");
    expect(String(row.display_title)).not.toMatch(/win detected/i);
  });

  it("hides stale recognition :0 goal Win when ensuring acc_yes for same MessageSid", async () => {
    const updateEq2 = vi.fn(async () => ({ error: null }));
    existingMaybeSingle.mockResolvedValue({
      data: {
        id: "stale-0",
        status: "active",
        relationship_type: "goal",
        commitment_id: "c1",
        clerk_user_id: "user_1",
      },
      error: null,
    });
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
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            maybeSingle: async () => {
              insertMaybeSingle(row);
              return { data: { id: `w-${String(row.idempotency_key)}` }, error: null };
            },
          }),
        }),
        select: () => ({
          eq: () => ({
            maybeSingle: existingMaybeSingle,
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: updateEq2,
          }),
        }),
      };
    });

    const r = await persistInboundWinsWithAccountability({
      clerkUserId: "user_1",
      messageSid: "SMstale",
      sourceMessageId: null,
      userYesEventId: "evt-stale",
      commitmentId: "c1",
      occurredAtIso: "2026-08-08T12:00:00.000Z",
      effectiveAsk: "Lift weights for 30 minutes",
      recognition: null,
      equivalenceByOrdinal: {},
    });
    expect(updateEq2).toHaveBeenCalled();
    expect(r.persisted).toBe(1);
    expect(r.wins[0]?.idempotency_key).toBe("win_v1:acc_yes:SMstale");
  });

  it("duplicate recognition/accountability paths never UPDATE display presentation fields", () => {
    const persistSrc = readFileSync(join(process.cwd(), "src/lib/v2-win-persist.ts"), "utf8");
    // Only UPDATE in this module is stale-hide (status/hidden_*), not presentation.
    const updateBlocks = [...persistSrc.matchAll(/\.update\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
    expect(updateBlocks.length).toBeGreaterThanOrEqual(1);
    for (const block of updateBlocks) {
      expect(block).not.toMatch(/display_title|display_body|action_fact|supporting_quote|occurred_at/);
      expect(block).toMatch(/status|hidden_at|hidden_reason/);
    }
    expect(persistSrc).toContain('status: "existing"');
    expect(persistSrc).toContain("lookupExistingWinByKey");
  });
});
