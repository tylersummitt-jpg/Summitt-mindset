import { describe, expect, it, vi } from "vitest";
import { getPatChunks, getTopRelevantChunks, type PatChunk, type ScoredChunk } from "@/lib/ask-pat/chunks";
import {
  PAT_SMS_CANDIDATE_POOL,
  PAT_SMS_EMBEDDING_MODEL,
  assemblePatSmsEvidence,
  buildPatSmsEmbeddingQuery,
  getPatEvidenceForSms,
} from "@/lib/inbound-pat-source-evidence";

function chunk(args: {
  globalId: string;
  bookId: string;
  order: number;
  text: string;
  sectionTitle?: string;
  score?: number;
}): ScoredChunk {
  return {
    id: `RFTS_sec01_chunk${String(args.order).padStart(3, "0")}`,
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

describe("buildPatSmsEmbeddingQuery", () => {
  it("uses newest inbound alone when need is missing, unknown, or duplicate", () => {
    expect(
      buildPatSmsEmbeddingQuery({
        latestInboundText: "How did having Tyler change your coaching?",
        directQuestionOrNeed: null,
      })
    ).toBe("How did having Tyler change your coaching?");
    expect(
      buildPatSmsEmbeddingQuery({
        latestInboundText: "Were you nervous?",
        directQuestionOrNeed: "unknown",
      })
    ).toBe("Were you nervous?");
    expect(
      buildPatSmsEmbeddingQuery({
        latestInboundText: "Were you nervous?",
        directQuestionOrNeed: "Were you nervous?",
      })
    ).toBe("Were you nervous?");
  });

  it("appends a distinct direct_question_or_need", () => {
    expect(
      buildPatSmsEmbeddingQuery({
        latestInboundText: "That one.",
        directQuestionOrNeed: "How did Tyler change your coaching?",
      })
    ).toBe("That one.\nHow did Tyler change your coaching?");
  });
});

describe("assemblePatSmsEvidence", () => {
  it("keeps top 2 hits and same-book order neighbors, deduped by globalId", () => {
    const all: PatChunk[] = [
      chunk({ globalId: "PAT_A4", bookId: "sum_it_up", order: 4, text: LONG(100, "w") }),
      chunk({ globalId: "PAT_A5", bookId: "sum_it_up", order: 5, text: LONG(100, "x") }),
      chunk({ globalId: "PAT_A6", bookId: "sum_it_up", order: 6, text: LONG(100, "y") }),
      chunk({ globalId: "PAT_A7", bookId: "sum_it_up", order: 7, text: LONG(100, "z") }),
    ];
    const hits: ScoredChunk[] = [
      { ...all[1]!, score: 0.99 },
      { ...all[2]!, score: 0.98 },
    ];
    const assembled = assemblePatSmsEvidence({ scoredHits: hits, allChunks: all });
    expect(assembled.globalIds).toHaveLength(4);
    expect(new Set(assembled.globalIds)).toEqual(
      new Set(["PAT_A4", "PAT_A5", "PAT_A6", "PAT_A7"])
    );
    expect(assembled.excerpts.every((e) => e.book_id === "sum_it_up")).toBe(true);
  });

  it("keeps both semantic hits when neighbors would otherwise exceed the cap", () => {
    const all = [
      chunk({ globalId: "PAT_0", bookId: "sum_it_up", order: 0, text: LONG(100, "a") }),
      chunk({ globalId: "PAT_1", bookId: "sum_it_up", order: 1, text: LONG(100, "b") }),
      chunk({ globalId: "PAT_2", bookId: "sum_it_up", order: 2, text: LONG(100, "c") }),
      chunk({ globalId: "PAT_10", bookId: "sum_it_up", order: 10, text: LONG(100, "d") }),
      chunk({ globalId: "PAT_11", bookId: "sum_it_up", order: 11, text: LONG(100, "e") }),
      chunk({ globalId: "PAT_12", bookId: "sum_it_up", order: 12, text: LONG(100, "f") }),
    ];
    const assembled = assemblePatSmsEvidence({
      scoredHits: [
        { ...all[1]!, score: 0.99 },
        { ...all[4]!, score: 0.98 },
      ],
      allChunks: all,
    });
    expect(assembled.excerpts).toHaveLength(4);
    expect(assembled.globalIds).toContain("PAT_1");
    expect(assembled.globalIds).toContain("PAT_11");
  });

  it("does not attach a neighbor from a different book", () => {
    const hit = chunk({
      globalId: "PAT_SIU_10",
      bookId: "sum_it_up",
      order: 10,
      text: LONG(120, "s"),
      score: 0.95,
    });
    const all: PatChunk[] = [
      hit,
      chunk({
        globalId: "PAT_RFTS_9",
        bookId: "reach_for_the_summit",
        order: 9,
        text: LONG(120, "r"),
      }),
      chunk({
        globalId: "PAT_RFTS_11",
        bookId: "reach_for_the_summit",
        order: 11,
        text: LONG(120, "t"),
      }),
    ];
    const assembled = assemblePatSmsEvidence({ scoredHits: [hit], allChunks: all });
    expect(assembled.globalIds).toEqual(["PAT_SIU_10"]);
  });

  it("allows top hits from different books", () => {
    const a = chunk({
      globalId: "PAT_R1",
      bookId: "reach_for_the_summit",
      order: 1,
      text: LONG(100, "r"),
      score: 0.99,
    });
    const b = chunk({
      globalId: "PAT_S1",
      bookId: "sum_it_up",
      order: 1,
      text: LONG(100, "s"),
      score: 0.98,
    });
    const assembled = assemblePatSmsEvidence({
      scoredHits: [a, b],
      allChunks: [a, b],
    });
    expect(assembled.globalIds.sort()).toEqual(["PAT_R1", "PAT_S1"]);
  });

  it("filters fragments under 80 chars and outliers over 2800", () => {
    const tiny = chunk({
      globalId: "PAT_TINY",
      bookId: "sum_it_up",
      order: 1,
      text: "short",
      score: 0.99,
    });
    const huge = chunk({
      globalId: "PAT_HUGE",
      bookId: "sum_it_up",
      order: 2,
      text: LONG(2801),
      score: 0.98,
    });
    const ok = chunk({
      globalId: "PAT_OK",
      bookId: "sum_it_up",
      order: 3,
      text: LONG(100, "k"),
      score: 0.97,
    });
    const assembled = assemblePatSmsEvidence({
      scoredHits: [tiny, huge, ok],
      allChunks: [tiny, huge, ok],
    });
    expect(assembled.globalIds).toEqual(["PAT_OK"]);
  });

  it("caps at 4 excerpts and about 4500 characters", () => {
    const all = Array.from({ length: 6 }, (_, i) =>
      chunk({
        globalId: `PAT_${i}`,
        bookId: "sum_it_up",
        order: i,
        text: LONG(1200, "m"),
        score: 1 - i * 0.01,
      })
    );
    const assembled = assemblePatSmsEvidence({
      scoredHits: [all[2]!, all[3]!],
      allChunks: all,
    });
    expect(assembled.excerpts.length).toBeLessThanOrEqual(4);
    const total = assembled.excerpts.reduce((n, e) => n + e.text.length, 0);
    expect(total).toBeLessThanOrEqual(4500);
  });

  it("does not put scores on writer excerpts", () => {
    const hit = chunk({
      globalId: "PAT_OK",
      bookId: "sum_it_up",
      order: 1,
      text: LONG(100, "k"),
    });
    const assembled = assemblePatSmsEvidence({ scoredHits: [hit], allChunks: [hit] });
    expect(assembled.excerpts[0]).toEqual({
      book_id: "sum_it_up",
      section_title: "CHAPTER 1",
      text: LONG(100, "k"),
    });
    expect(assembled.excerpts[0]).not.toHaveProperty("score");
    expect(assembled.excerpts[0]).not.toHaveProperty("global_id");
  });
});

describe("getPatEvidenceForSms", () => {
  it("embeds exactly once and returns ok packet", async () => {
    const embedQuery = vi.fn(async () => [0.1, 0.2]);
    const hit = chunk({
      globalId: "PAT_OK",
      bookId: "sum_it_up",
      order: 1,
      text: LONG(100, "k"),
      score: 0.9,
    });
    const scoreChunks = vi.fn(() => [hit]);
    const loadChunks = vi.fn(() => [hit]);
    const result = await getPatEvidenceForSms({
      query: "How did having Tyler change your coaching?",
      deps: { embedQuery, scoreChunks, loadChunks },
    });
    expect(embedQuery).toHaveBeenCalledTimes(1);
    expect(scoreChunks).toHaveBeenCalledWith([0.1, 0.2], PAT_SMS_CANDIDATE_POOL);
    expect(result.packet.required).toBe(true);
    expect(result.packet.retrieval_status).toBe("ok");
    expect(result.packet.excerpts).toHaveLength(1);
    expect(result.forensics.inbound_sol_pat_retrieval_attempted).toBe(true);
    expect(result.forensics.inbound_sol_pat_global_ids).toBe("PAT_OK");
  });

  it("returns empty packet when all hits filter out", async () => {
    const tiny = chunk({
      globalId: "PAT_TINY",
      bookId: "sum_it_up",
      order: 1,
      text: "x",
      score: 0.9,
    });
    const result = await getPatEvidenceForSms({
      query: "favorite championship team",
      deps: {
        embedQuery: async () => [1],
        scoreChunks: () => [tiny],
        loadChunks: () => [tiny],
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

describe("live Pat corpus wiring", () => {
  it("PAT_0457 retrieves same-book neighbors from the 588-row library", () => {
    const all = getPatChunks();
    expect(all).toHaveLength(588);
    const seed = all.find((c) => c.globalId === "PAT_0457");
    expect(seed).toBeDefined();
    expect(seed!.text).toMatch(/Ty-man|Tyler/);
    const scored = getTopRelevantChunks(seed!.embedding, PAT_SMS_CANDIDATE_POOL);
    expect(scored[0]?.globalId).toBe("PAT_0457");
    const assembled = assemblePatSmsEvidence({ scoredHits: scored, allChunks: all });
    expect(assembled.globalIds).toContain("PAT_0457");
    expect(assembled.excerpts.length).toBeGreaterThan(0);
    expect(assembled.excerpts.length).toBeLessThanOrEqual(4);
    const total = assembled.excerpts.reduce((n, e) => n + e.text.length, 0);
    expect(total).toBeLessThanOrEqual(4500);
    for (const excerpt of assembled.excerpts) {
      expect(excerpt).not.toHaveProperty("score");
      expect(excerpt).not.toHaveProperty("global_id");
    }
  });
});
