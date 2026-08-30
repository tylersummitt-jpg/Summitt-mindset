import { describe, expect, it, vi } from "vitest";
import { getPatChunks, getTopRelevantChunks, type ScoredChunk } from "@/lib/ask-pat/chunks";
import {
  PAT_SMS_EMBEDDING_MODEL,
  PAT_SMS_TOP_K,
  assemblePatSmsEvidence,
  getPatEvidenceForSms,
  normalizePatSmsQuery,
} from "@/lib/inbound-pat-source-evidence";

function chunk(args: {
  globalId: string;
  bookId: string;
  order: number;
  text: string;
  sectionTitle?: string;
  score?: number;
  id?: string;
}): ScoredChunk {
  return {
    id: args.id ?? `RFTS_sec01_chunk${String(args.order).padStart(3, "0")}`,
    text: args.text,
    embedding: [1],
    bookId: args.bookId,
    sectionTitle: args.sectionTitle ?? "CHAPTER 1",
    globalId: args.globalId,
    order: args.order,
    score: args.score ?? 0.9,
  };
}

const LONG = (n: number, ch = "a") => ch.repeat(n);

describe("normalizePatSmsQuery (fixture — Ask Pat formula, no live embed)", () => {
  it("matches Ask Pat: (text || '').trim().replace(/\\s+/g, ' ')", () => {
    const formula = (text: string) => (text || "").trim().replace(/\s+/g, " ");
    expect(normalizePatSmsQuery("Were you nervous?")).toBe("Were you nervous?");
    expect(normalizePatSmsQuery("  Were   you\nnervous?  ")).toBe("Were you nervous?");
    expect(normalizePatSmsQuery("\tHow  did\thaving Tyler\nchange? ")).toBe(
      "How did having Tyler change?"
    );
    expect(normalizePatSmsQuery("")).toBe("");
    expect(normalizePatSmsQuery("   \n\t  ")).toBe("");
    expect(normalizePatSmsQuery("Were you nervous?")).toBe(
      formula("Were you nervous?")
    );
    expect(normalizePatSmsQuery("  Were   you\nnervous?  ")).toBe(
      formula("  Were   you\nnervous?  ")
    );
  });

  it("does not append direct_question_or_need", () => {
    const inbound = "That one.";
    const need = "How did Tyler change your coaching?";
    expect(normalizePatSmsQuery(inbound)).toBe("That one.");
    expect(normalizePatSmsQuery(inbound)).not.toContain(need);
    expect(normalizePatSmsQuery(inbound)).not.toContain("\n");
  });
});

describe("assemblePatSmsEvidence (fixture ranked hits — no live retrieval)", () => {
  it("keeps ranked top-6 in order and does not add neighbors", () => {
    const hits = [
      chunk({ globalId: "PAT_0245", bookId: "reach_for_the_summit", order: 245, text: LONG(100, "a"), score: 0.99 }),
      chunk({ globalId: "PAT_0246", bookId: "reach_for_the_summit", order: 246, text: LONG(100, "b"), score: 0.98 }),
      chunk({ globalId: "PAT_0244", bookId: "reach_for_the_summit", order: 244, text: LONG(100, "n"), score: 0.5 }),
    ];
    const assembled = assemblePatSmsEvidence({ scoredHits: hits.slice(0, 2) });
    expect(assembled.globalIds).toEqual(["PAT_0245", "PAT_0246"]);
    expect(assembled.globalIds).not.toContain("PAT_0244");
    expect(assembled.globalIds).not.toContain("PAT_0247");
  });

  it("preserves rank order across distant books and does not collapse to top 2", () => {
    const hits = [
      chunk({ globalId: "PAT_0457", bookId: "sum_it_up", order: 209, text: LONG(1800, "a"), score: 0.99 }),
      chunk({ globalId: "PAT_0526", bookId: "sum_it_up", order: 278, text: LONG(1700, "b"), score: 0.98 }),
      chunk({ globalId: "PAT_0499", bookId: "sum_it_up", order: 251, text: LONG(1800, "c"), score: 0.97 }),
      chunk({ globalId: "PAT_0459", bookId: "sum_it_up", order: 211, text: LONG(2200, "d"), score: 0.96 }),
      chunk({ globalId: "PAT_0528", bookId: "sum_it_up", order: 280, text: LONG(1700, "e"), score: 0.95 }),
      chunk({ globalId: "PAT_0432", bookId: "sum_it_up", order: 184, text: LONG(2300, "f"), score: 0.94 }),
    ];
    const assembled = assemblePatSmsEvidence({ scoredHits: hits });
    expect(assembled.globalIds).toEqual([
      "PAT_0457",
      "PAT_0526",
      "PAT_0499",
      "PAT_0459",
      "PAT_0528",
      "PAT_0432",
    ]);
    expect(assembled.excerpts).toHaveLength(6);
    const total = assembled.excerpts.reduce((n, e) => n + e.text.length, 0);
    expect(total).toBeGreaterThan(4500);
  });

  it("keeps all six ranked hits with no max-4 cut and no total-char cap", () => {
    const hits = Array.from({ length: 6 }, (_, i) =>
      chunk({
        globalId: `PAT_${String(i + 1).padStart(4, "0")}`,
        bookId: "sum_it_up",
        order: i + 1,
        text: LONG(2000, String(i)),
        score: 0.99 - i * 0.01,
      })
    );
    const assembled = assemblePatSmsEvidence({ scoredHits: hits });
    expect(assembled.globalIds).toHaveLength(6);
    expect(assembled.excerpts).toHaveLength(6);
    expect(assembled.excerpts.reduce((n, e) => n + e.text.length, 0)).toBe(12000);
  });

  it("does not drop a 52-char chunk", () => {
    const tiny = chunk({
      globalId: "PAT_0116",
      bookId: "reach_for_the_summit",
      order: 116,
      text: "x".repeat(52),
      score: 0.99,
    });
    const assembled = assemblePatSmsEvidence({ scoredHits: [tiny] });
    expect(assembled.globalIds).toEqual(["PAT_0116"]);
    expect(assembled.excerpts[0]?.text).toHaveLength(52);
  });

  it("does not drop a 10k-char chunk", () => {
    const huge = chunk({
      globalId: "PAT_HUGE",
      bookId: "sum_it_up",
      order: 1,
      text: LONG(10_000, "h"),
      score: 0.99,
    });
    const assembled = assemblePatSmsEvidence({ scoredHits: [huge] });
    expect(assembled.globalIds).toEqual(["PAT_HUGE"]);
    expect(assembled.excerpts[0]?.text).toHaveLength(10_000);
  });

  it("retains PAT_0017 when it ranks inside top 6 instead of replacing it with neighbors of PAT_0245/0246", () => {
    const hits = [
      chunk({ globalId: "PAT_0245", bookId: "reach_for_the_summit", order: 245, text: LONG(1900, "m"), score: 0.99 }),
      chunk({ globalId: "PAT_0246", bookId: "reach_for_the_summit", order: 246, text: LONG(1800, "m"), score: 0.98 }),
      chunk({ globalId: "PAT_0100", bookId: "sum_it_up", order: 100, text: LONG(1000, "x"), score: 0.9 }),
      chunk({ globalId: "PAT_0200", bookId: "sum_it_up", order: 200, text: LONG(1000, "y"), score: 0.89 }),
      chunk({ globalId: "PAT_0300", bookId: "reach_for_the_summit", order: 50, text: LONG(1000, "z"), score: 0.88 }),
      chunk({
        globalId: "PAT_0017",
        bookId: "reach_for_the_summit",
        order: 17,
        text: LONG(1800, "n"),
        score: 0.87,
        sectionTitle: "CHAPTER 2 - TAKE FULL RESPONSIBILITY",
      }),
    ];
    const assembled = assemblePatSmsEvidence({ scoredHits: hits });
    expect(assembled.globalIds).toContain("PAT_0017");
    expect(assembled.globalIds).toHaveLength(6);
    expect(assembled.globalIds).not.toContain("PAT_0244");
    expect(assembled.globalIds).not.toContain("PAT_0247");
  });

  it("retains PAT_0339 when it ranks inside top 6", () => {
    const hits = [
      chunk({ globalId: "PAT_0245", bookId: "reach_for_the_summit", order: 245, text: LONG(1000, "a"), score: 0.99 }),
      chunk({ globalId: "PAT_A", bookId: "sum_it_up", order: 1, text: LONG(1000, "b"), score: 0.98 }),
      chunk({ globalId: "PAT_B", bookId: "sum_it_up", order: 40, text: LONG(1000, "c"), score: 0.97 }),
      chunk({ globalId: "PAT_C", bookId: "reach_for_the_summit", order: 80, text: LONG(1000, "d"), score: 0.96 }),
      chunk({
        globalId: "PAT_0339",
        bookId: "sum_it_up",
        order: 91,
        text: LONG(1800, "i"),
        score: 0.95,
        sectionTitle: "SUM IT UP CHAPTER 4",
      }),
      chunk({ globalId: "PAT_D", bookId: "reach_for_the_summit", order: 12, text: LONG(1000, "e"), score: 0.94 }),
    ];
    const assembled = assemblePatSmsEvidence({ scoredHits: hits });
    expect(assembled.globalIds).toContain("PAT_0339");
    expect(assembled.globalIds).toHaveLength(6);
  });

  it("dedupes by globalId without changing rank of first occurrence", () => {
    const a = chunk({ globalId: "PAT_OK", bookId: "sum_it_up", order: 1, text: LONG(100, "k"), score: 0.99 });
    const dup = { ...a, score: 0.5 };
    const b = chunk({ globalId: "PAT_NEXT", bookId: "sum_it_up", order: 9, text: LONG(100, "n"), score: 0.8 });
    const assembled = assemblePatSmsEvidence({ scoredHits: [a, dup, b] });
    expect(assembled.globalIds).toEqual(["PAT_OK", "PAT_NEXT"]);
  });

  it("does not put scores on writer excerpts", () => {
    const hit = chunk({
      globalId: "PAT_OK",
      bookId: "sum_it_up",
      order: 1,
      text: LONG(100, "k"),
    });
    const assembled = assemblePatSmsEvidence({ scoredHits: [hit] });
    expect(assembled.excerpts[0]).toEqual({
      book_id: "sum_it_up",
      section_title: "CHAPTER 1",
      text: LONG(100, "k"),
    });
    expect(assembled.excerpts[0]).not.toHaveProperty("score");
    expect(assembled.excerpts[0]).not.toHaveProperty("global_id");
  });
});

describe("getPatEvidenceForSms (mocked embed/score — no live OpenAI)", () => {
  it("embeds the normalized latest inbound exactly once and scores topK=6", async () => {
    const embedQuery = vi.fn(async () => [0.1, 0.2]);
    const hit = chunk({
      globalId: "PAT_OK",
      bookId: "sum_it_up",
      order: 1,
      text: LONG(100, "k"),
      score: 0.9,
    });
    const scoreChunks = vi.fn(() => [hit]);
    const result = await getPatEvidenceForSms({
      query: "  How   did\thaving Tyler  change?  ",
      deps: { embedQuery, scoreChunks },
    });
    expect(embedQuery).toHaveBeenCalledTimes(1);
    expect(embedQuery).toHaveBeenCalledWith("How did having Tyler change?");
    expect(scoreChunks).toHaveBeenCalledTimes(1);
    expect(scoreChunks).toHaveBeenCalledWith([0.1, 0.2], 6);
    expect(PAT_SMS_TOP_K).toBe(6);
    expect(result.packet.required).toBe(true);
    expect(result.packet.retrieval_status).toBe("ok");
    expect(result.packet.excerpts).toHaveLength(1);
    expect(result.forensics.inbound_sol_pat_retrieval_attempted).toBe(true);
    expect(result.forensics.inbound_sol_pat_global_ids).toBe("PAT_OK");
  });

  it("preserves all six ranked hits including a 52-char and a 10k-char chunk", async () => {
    const hits = [
      chunk({ globalId: "PAT_TINY", bookId: "sum_it_up", order: 1, text: "x".repeat(52), score: 0.99 }),
      chunk({ globalId: "PAT_HUGE", bookId: "sum_it_up", order: 2, text: LONG(10_000), score: 0.98 }),
      chunk({ globalId: "PAT_A", bookId: "sum_it_up", order: 3, text: LONG(100, "a"), score: 0.97 }),
      chunk({ globalId: "PAT_B", bookId: "sum_it_up", order: 4, text: LONG(100, "b"), score: 0.96 }),
      chunk({ globalId: "PAT_C", bookId: "sum_it_up", order: 5, text: LONG(100, "c"), score: 0.95 }),
      chunk({ globalId: "PAT_D", bookId: "sum_it_up", order: 6, text: LONG(100, "d"), score: 0.94 }),
    ];
    const scoreChunks = vi.fn(() => hits);
    const result = await getPatEvidenceForSms({
      query: "Were you nervous?",
      deps: { embedQuery: async () => [1], scoreChunks },
    });
    expect(scoreChunks).toHaveBeenCalledWith([1], 6);
    expect(result.packet.retrieval_status).toBe("ok");
    expect(result.packet.excerpts).toHaveLength(6);
    expect(result.packet.excerpts[0]?.text).toHaveLength(52);
    expect(result.packet.excerpts[1]?.text).toHaveLength(10_000);
    expect(result.forensics.inbound_sol_pat_global_ids).toBe(
      "PAT_TINY,PAT_HUGE,PAT_A,PAT_B,PAT_C,PAT_D"
    );
  });

  it("returns empty packet when scoreChunks returns no hits", async () => {
    const result = await getPatEvidenceForSms({
      query: "favorite championship team",
      deps: {
        embedQuery: async () => [1],
        scoreChunks: () => [],
      },
    });
    expect(result.packet.retrieval_status).toBe("empty");
    expect(result.packet.excerpts).toEqual([]);
    expect(result.forensics.inbound_sol_pat_retrieval_error).toBeNull();
  });

  it("returns error packet with no excerpts when embedding fails", async () => {
    const result = await getPatEvidenceForSms({
      query: "Were you nervous?",
      deps: {
        embedQuery: async () => {
          throw new Error("boom");
        },
      },
    });
    expect(result.packet.required).toBe(true);
    expect(result.packet.retrieval_status).toBe("error");
    expect(result.packet.excerpts).toEqual([]);
    expect(result.forensics.inbound_sol_pat_retrieval_error).toBe("boom");
  });

  it("uses text-embedding-3-small constant", () => {
    expect(PAT_SMS_EMBEDDING_MODEL).toBe("text-embedding-3-small");
  });
});

describe("live Pat corpus wiring (local JSONL cosine — no OpenAI embed)", () => {
  it("PAT_0457 query embedding keeps ranked top-6 without neighbor substitution", () => {
    const all = getPatChunks();
    expect(all).toHaveLength(588);
    const seed = all.find((c) => c.globalId === "PAT_0457");
    expect(seed).toBeDefined();
    expect(seed!.text).toMatch(/Ty-man|Tyler/);
    const scored = getTopRelevantChunks(seed!.embedding, PAT_SMS_TOP_K);
    expect(scored).toHaveLength(6);
    expect(scored[0]?.globalId).toBe("PAT_0457");
    const assembled = assemblePatSmsEvidence({ scoredHits: scored });
    expect(assembled.globalIds).toHaveLength(6);
    expect(assembled.globalIds[0]).toBe("PAT_0457");
    expect(assembled.globalIds).toEqual(scored.map((c) => c.globalId));
    for (const excerpt of assembled.excerpts) {
      expect(excerpt).not.toHaveProperty("score");
      expect(excerpt).not.toHaveProperty("global_id");
    }
  });
});
