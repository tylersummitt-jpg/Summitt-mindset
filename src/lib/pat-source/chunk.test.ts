import { describe, expect, it } from "vitest";

import {
  buildChunksFromParagraphs,
  formatChunkId,
  findDuplicateChunkIds,
  paragraphsFromRawBlocks,
} from "@/lib/pat-source/chunk";
import { getPatSourceBookConfig } from "@/lib/pat-source/types";

const book = getPatSourceBookConfig("reach_for_the_summit");

describe("pat-source chunk", () => {
  it("formats stable chunk IDs", () => {
    expect(formatChunkId("rfs", 2, 14, 14)).toBe("rfs|ch02|p014");
    expect(formatChunkId("rfs", 2, 14, 16)).toBe("rfs|ch02|p014-016");
    expect(formatChunkId("rfs", 2, 14, 14, 2)).toBe("rfs|ch02|p014~02");
  });

  it("builds chunks from synthetic blocks with required fields", () => {
    const paragraphs = paragraphsFromRawBlocks([
      { type: "heading", text: "CHAPTER ONE - DISCIPLINE", level: 1 },
      {
        type: "paragraph",
        text: "Discipline is doing what you should do when you should do it. ".repeat(8),
      },
      {
        type: "paragraph",
        text: "Hard work and responsibility matter every single day on the court. ".repeat(8),
      },
    ]);

    const { chunks } = buildChunksFromParagraphs({
      book,
      paragraphs,
      source_file_ref: "reach_for_the_summit.docx",
      source_file_sha256: "abc123",
      ingested_at: "2026-05-26T00:00:00.000Z",
      options: { targetMinWords: 50, targetMaxWords: 200 },
    });

    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.schema_version).toBe("pat_source_chunk_v1");
      expect(c.book_id).toBe("reach_for_the_summit");
      expect(c.cleaned_text.trim().length).toBeGreaterThan(0);
      expect(c.word_count).toBeGreaterThan(0);
      expect(c.source_location).toMatch(/^ch\d+\/p\d+/);
    }
    expect(findDuplicateChunkIds(chunks)).toEqual([]);
  });

  it("produces stable chunk IDs across identical runs", () => {
    const blocks = [
      { type: "heading" as const, text: "FOREWORD", level: 1 },
      {
        type: "paragraph" as const,
        text: "Pat Summitt taught standards and discipline to every player she coached. ".repeat(
          10
        ),
      },
    ];
    const run = () =>
      buildChunksFromParagraphs({
        book,
        paragraphs: paragraphsFromRawBlocks(blocks),
        source_file_ref: "reach_for_the_summit.docx",
        source_file_sha256: "same",
        ingested_at: "2026-05-26T00:00:00.000Z",
        options: { targetMinWords: 40, targetMaxWords: 120 },
      }).chunks.map((c) => c.chunk_id);

    expect(run()).toEqual(run());
  });

  it("returns no chunks when given no paragraphs", () => {
    const { chunks } = buildChunksFromParagraphs({
      book,
      paragraphs: [],
      source_file_ref: "reach_for_the_summit.docx",
      source_file_sha256: "x",
      ingested_at: "2026-05-26T00:00:00.000Z",
    });
    expect(chunks).toEqual([]);
  });
});
