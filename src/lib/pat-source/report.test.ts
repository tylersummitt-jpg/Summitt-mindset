import { describe, expect, it } from "vitest";

import { buildPatSourceManifest, type BookIngestResult } from "@/lib/pat-source/manifest";
import {
  buildPatSourceIngestReport,
  buildTermSearchHits,
  searchChunksForTerm,
  validatePatSourceChunk,
} from "@/lib/pat-source/report";
import type { PatSourceChunkV1 } from "@/lib/pat-source/types";
import { getPatSourceBookConfig } from "@/lib/pat-source/types";

function syntheticChunk(overrides?: Partial<PatSourceChunkV1>): PatSourceChunkV1 {
  const book = getPatSourceBookConfig("sum_it_up");
  return {
    schema_version: "pat_source_chunk_v1",
    chunk_id: "siu|ch01|p001",
    book_id: book.book_id,
    book_title: book.book_title,
    chapter_index: 1,
    chapter_title: "CHAPTER ONE",
    section_title: null,
    paragraph_start: 1,
    paragraph_end: 1,
    source_location: "ch1/p1",
    chunk_order: 1,
    cleaned_text:
      "Pat Summitt spoke about discipline, responsibility, and hard work with her team.",
    word_count: 12,
    source_file_ref: "sum_it_up.docx",
    source_file_sha256: "sha",
    ingestion_version: "pat_source_ingest_v1",
    ingested_at: "2026-05-26T00:00:00.000Z",
    ...overrides,
  };
}

describe("pat-source manifest and report", () => {
  it("builds manifest with both books", () => {
    const book = getPatSourceBookConfig("reach_for_the_summit");
    const result: BookIngestResult = {
      book,
      chunks: [syntheticChunk({ book_id: "reach_for_the_summit", chunk_id: "rfs|ch01|p001" })],
      warnings: [],
      source_file_sha256: "a",
      source_file_bytes: 100,
      paragraph_count: 5,
    };
    const manifest = buildPatSourceManifest({
      ingested_at: "2026-05-26T00:00:00.000Z",
      parser: { name: "mammoth", version: "1.9.0" },
      bookResults: [result],
    });
    expect(manifest.books).toHaveLength(1);
    expect(manifest.excluded_books.some((e) => e.book_id === "raise_the_roof")).toBe(true);
  });

  it("term search returns hits without full thread text", () => {
    const chunk = syntheticChunk();
    const hits = searchChunksForTerm([chunk], "discipline");
    expect(hits.length).toBe(1);
    expect(hits[0]?.excerpt.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(hits)).not.toContain("a".repeat(500));
  });

  it("buildTermSearchHits includes expected keys", () => {
    const hits = buildTermSearchHits([syntheticChunk()]);
    expect(hits.discipline?.length).toBeGreaterThan(0);
    expect(Array.isArray(hits["left foot"])).toBe(true);
  });

  it("ingest report shape includes per-book stats", () => {
    const chunk = syntheticChunk();
    const report = buildPatSourceIngestReport({
      generated_at: "2026-05-26T00:00:00.000Z",
      results: {
        sum_it_up: { chunks: [chunk], warnings: [] },
        reach_for_the_summit: { chunks: [], warnings: ["zero_chunks_produced"] },
      },
    });
    expect(report.books.sum_it_up.chunk_count).toBe(1);
    expect(report.books.sum_it_up.term_search_hits.discipline?.length).toBeGreaterThan(0);
    expect(validatePatSourceChunk(chunk)).toEqual([]);
    expect(validatePatSourceChunk({ ...chunk, cleaned_text: "" })).toContain(
      "empty_cleaned_text"
    );
  });
});
