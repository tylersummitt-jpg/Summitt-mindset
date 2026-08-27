import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from },
}));

import {
  persistSolInboundUserEvidence,
  persistableExactUserEvidence,
} from "@/lib/inbound-sol-user-evidence";

const TEXT =
  "I like when you challenge me directly. Don't sugarcoat it.";

describe("persistableExactUserEvidence", () => {
  it("null capture is not persistable", () => {
    expect(persistableExactUserEvidence(null, TEXT)).toEqual({
      ok: false,
      reason: "null_capture",
    });
  });

  it("empty excerpt is rejected", () => {
    expect(persistableExactUserEvidence({ exact_user_evidence: "" }, TEXT)).toEqual({
      ok: false,
      reason: "empty_excerpt",
    });
  });

  it(">400 excerpt is rejected without truncation", () => {
    const tooLong = "x".repeat(401);
    const haystack = `${tooLong} trailing`;
    expect(persistableExactUserEvidence({ exact_user_evidence: tooLong }, haystack)).toEqual({
      ok: false,
      reason: "excerpt_too_long",
    });
  });

  it("exact contiguous substring is persistable", () => {
    expect(
      persistableExactUserEvidence(
        { exact_user_evidence: "Don't sugarcoat it." },
        TEXT
      )
    ).toEqual({ ok: true, exact_user_evidence: "Don't sugarcoat it." });
  });

  it("paraphrase that is not a substring is rejected", () => {
    expect(
      persistableExactUserEvidence(
        { exact_user_evidence: "User prefers direct coaching." },
        TEXT
      )
    ).toEqual({ ok: false, reason: "not_latest_inbound_substring" });
  });

  it("smart-quote mismatch is rejected (no quote normalization)", () => {
    expect(
      persistableExactUserEvidence(
        { exact_user_evidence: "Don’t sugarcoat it." },
        TEXT
      )
    ).toEqual({ ok: false, reason: "not_latest_inbound_substring" });
  });

  it("excerpt from older thread rather than latest inbound is rejected", () => {
    expect(
      persistableExactUserEvidence(
        {
          exact_user_evidence:
            "Being present with my kids matters more than squeezing in another hour of work.",
        },
        TEXT
      )
    ).toEqual({ ok: false, reason: "not_latest_inbound_substring" });
  });
});

describe("persistSolInboundUserEvidence", () => {
  beforeEach(() => {
    insert.mockReset();
    from.mockReset();
    from.mockImplementation((table: string) => {
      expect(table).toBe("v2_durable_user_evidence");
      return { insert };
    });
  });

  it("null capture does not insert", async () => {
    const r = await persistSolInboundUserEvidence({
      clerkUserId: "user_1",
      messageSid: "SMone",
      latestInboundText: TEXT,
      occurredAtIso: "2026-08-18T16:00:00.000Z",
      durableUserEvidence: null,
    });
    expect(r.status).toBe("none");
    expect(insert).not.toHaveBeenCalled();
  });

  it("empty excerpt does not insert", async () => {
    const r = await persistSolInboundUserEvidence({
      clerkUserId: "user_1",
      messageSid: "SMone",
      latestInboundText: TEXT,
      occurredAtIso: "2026-08-18T16:00:00.000Z",
      durableUserEvidence: { exact_user_evidence: "" },
    });
    expect(r).toEqual({ status: "validation_rejected", reason: "empty_excerpt" });
    expect(insert).not.toHaveBeenCalled();
  });

  it(">400 excerpt does not insert", async () => {
    const tooLong = "a".repeat(401);
    const r = await persistSolInboundUserEvidence({
      clerkUserId: "user_1",
      messageSid: "SMone",
      latestInboundText: tooLong,
      occurredAtIso: "2026-08-18T16:00:00.000Z",
      durableUserEvidence: { exact_user_evidence: tooLong },
    });
    expect(r.status).toBe("validation_rejected");
    expect(r.reason).toBe("excerpt_too_long");
    expect(insert).not.toHaveBeenCalled();
  });

  it("exact substring inserts with occurred_at from caller ISO", async () => {
    insert.mockResolvedValue({ error: null });
    const r = await persistSolInboundUserEvidence({
      clerkUserId: "user_1",
      messageSid: "SMone",
      latestInboundText: TEXT,
      occurredAtIso: "2026-08-18T16:00:00.000Z",
      durableUserEvidence: { exact_user_evidence: "Don't sugarcoat it." },
    });
    expect(r.status).toBe("inserted");
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0]?.[0]).toEqual({
      clerk_user_id: "user_1",
      occurred_at: "2026-08-18T16:00:00.000Z",
      source_message_sid: "SMone",
      exact_user_evidence: "Don't sugarcoat it.",
      status: "active",
    });
  });

  it("paraphrase is rejected and does not insert", async () => {
    const r = await persistSolInboundUserEvidence({
      clerkUserId: "user_1",
      messageSid: "SMone",
      latestInboundText: TEXT,
      occurredAtIso: "2026-08-18T16:00:00.000Z",
      durableUserEvidence: { exact_user_evidence: "User prefers direct coaching." },
    });
    expect(r.status).toBe("validation_rejected");
    expect(insert).not.toHaveBeenCalled();
  });

  it("23505 is existing and does not overwrite", async () => {
    insert.mockResolvedValue({
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    const r = await persistSolInboundUserEvidence({
      clerkUserId: "user_1",
      messageSid: "SMone",
      latestInboundText: TEXT,
      occurredAtIso: "2026-08-18T16:00:00.000Z",
      durableUserEvidence: { exact_user_evidence: "Don't sugarcoat it." },
    });
    expect(r).toEqual({ status: "existing", reason: "source_message_sid" });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("other DB errors are failed", async () => {
    insert.mockResolvedValue({
      error: { code: "42P01", message: "relation does not exist" },
    });
    const r = await persistSolInboundUserEvidence({
      clerkUserId: "user_1",
      messageSid: "SMone",
      latestInboundText: TEXT,
      occurredAtIso: "2026-08-18T16:00:00.000Z",
      durableUserEvidence: { exact_user_evidence: "Don't sugarcoat it." },
    });
    expect(r.status).toBe("failed");
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("one SID is the insert idempotency key", async () => {
    insert.mockResolvedValue({ error: null });
    await persistSolInboundUserEvidence({
      clerkUserId: "user_1",
      messageSid: "  SMone  ",
      latestInboundText: TEXT,
      occurredAtIso: "2026-08-18T16:00:00.000Z",
      durableUserEvidence: { exact_user_evidence: "Don't sugarcoat it." },
    });
    expect(insert.mock.calls[0]?.[0]?.source_message_sid).toBe("SMone");
  });
});
