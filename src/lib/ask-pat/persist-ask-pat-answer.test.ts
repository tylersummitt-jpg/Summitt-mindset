import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(),
  },
}));

import { supabaseServer } from "@/lib/supabase-server";
import { persistAskPatAnswerWithRetries } from "./persist-ask-pat-answer";

describe("persistAskPatAnswerWithRetries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok true when questionRowId is null (no Supabase call)", async () => {
    const r = await persistAskPatAnswerWithRetries({
      questionRowId: null,
      answerText: "hi",
      model: "gpt-4.1-mini",
      safetyStatus: "ok",
      answerMetadata: {},
    });
    expect(r).toEqual({ ok: true });
    expect(supabaseServer.from).not.toHaveBeenCalled();
  });

  it("returns ok true on first successful update", async () => {
    vi.mocked(supabaseServer.from).mockReturnValue({
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    } as never);

    const r = await persistAskPatAnswerWithRetries({
      questionRowId: "abc-123",
      answerText: "Full coach answer here.",
      model: "gpt-4.1-mini",
      safetyStatus: "ok",
      answerMetadata: { chunk_ids: ["c1"], chunk_count: 1 },
    });

    expect(r).toEqual({ ok: true });
    expect(supabaseServer.from).toHaveBeenCalledWith("ask_pat_questions");
  });

  it("after 3 failed updates returns ok false and logs structured persistence failure", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(supabaseServer.from).mockReturnValue({
      update: () => ({
        eq: () =>
          Promise.resolve({
            error: { message: "connection reset", code: "PGRST301" },
          }),
      }),
    } as never);

    const body = "x".repeat(420);
    const r = await persistAskPatAnswerWithRetries({
      questionRowId: "row-uuid",
      answerText: body,
      model: "gpt-4.1-mini",
      safetyStatus: "ok",
      answerMetadata: { chunk_ids: [], chunk_count: 0 },
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.lastMessage).toBe("connection reset");
      expect(r.lastCode).toBe("PGRST301");
    }

    expect(consoleSpy).toHaveBeenCalled();
    const payload = consoleSpy.mock.calls[0]?.[0] as string;
    expect(payload).toContain("ask_pat_answer_persistence_failed");
    expect(payload).toContain("answer_persistence_failed");
    expect(payload).toContain('"question_row_id":"row-uuid"');
    expect(payload).toContain('"answer_length":420');
    expect(payload).not.toContain(body);
  });

  it("succeeds on third attempt after transient errors", async () => {
    let calls = 0;
    vi.mocked(supabaseServer.from).mockReturnValue({
      update: () => ({
        eq: () => {
          calls += 1;
          return Promise.resolve({
            error: calls < 3 ? { message: "timeout", code: "T" } : null,
          });
        },
      }),
    } as never);

    const r = await persistAskPatAnswerWithRetries({
      questionRowId: "id",
      answerText: "a",
      model: "gpt-4.1-mini",
      safetyStatus: "ok",
      answerMetadata: {},
    });

    expect(r).toEqual({ ok: true });
    expect(calls).toBe(3);
  });
});
