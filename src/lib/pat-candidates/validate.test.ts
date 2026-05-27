import { describe, expect, it } from "vitest";

import type { PatSourceChunkIndex } from "@/lib/pat-candidates/load-source-index";
import {
  chunkMatchesSearchQuery,
  excerptAroundFirstMatch,
  searchSourceChunks,
  tokenizeSearchQuery,
} from "@/lib/pat-candidates/search-source";
import {
  PAT_CANDIDATES_CATALOG_SCHEMA_VERSION,
  type PatCandidateRecordV1,
  type PatCandidatesCatalogV1,
} from "@/lib/pat-candidates/types";
import { validatePatCandidatesCatalog } from "@/lib/pat-candidates/validate";
import type { PatSourceChunkV1 } from "@/lib/pat-source/types";

function emptyCatalog(): PatCandidatesCatalogV1 {
  return {
    schema_version: PAT_CANDIDATES_CATALOG_SCHEMA_VERSION,
    catalog_version: 1,
    updated_at: "2026-05-27T00:00:00.000Z",
    source_library_ref: {
      ingestion_version: "pat_source_ingest_v1",
      manifest_path: "data/pat/source/books.manifest.json",
    },
    candidates: [],
  };
}

function syntheticChunk(overrides?: Partial<PatSourceChunkV1>): PatSourceChunkV1 {
  return {
    schema_version: "pat_source_chunk_v1",
    chunk_id: "siu|ch01|p001",
    book_id: "sum_it_up",
    book_title: "Sum It Up",
    chapter_index: 1,
    chapter_title: "Section",
    section_title: null,
    paragraph_start: 1,
    paragraph_end: 1,
    source_location: "ch1/p1",
    chunk_order: 1,
    cleaned_text: "She spoke about discipline and responsibility after the injury.",
    word_count: 10,
    source_file_ref: "sum_it_up.docx",
    source_file_sha256: "sha",
    ingestion_version: "pat_source_ingest_v1",
    ingested_at: "2026-05-27T00:00:00.000Z",
    ...overrides,
  };
}

function syntheticIndex(chunks: PatSourceChunkV1[]): PatSourceChunkIndex {
  const byChunkId = new Map(chunks.map((c) => [c.chunk_id, c]));
  const byBookId = new Map<"sum_it_up" | "reach_for_the_summit", Map<string, PatSourceChunkV1>>();
  for (const c of chunks) {
    let bookMap = byBookId.get(c.book_id);
    if (!bookMap) {
      bookMap = new Map();
      byBookId.set(c.book_id, bookMap);
    }
    bookMap.set(c.chunk_id, c);
  }
  return { byChunkId, byBookId, sourceDir: "/tmp", loaded: true };
}

function baseCandidate(overrides: Partial<PatCandidateRecordV1>): PatCandidateRecordV1 {
  return {
    candidate_id: "test_lesson_v1",
    type: "lesson_capsule",
    status: "draft",
    title: "Test lesson",
    source_book_id: "sum_it_up",
    source_book_title: "Sum It Up",
    source_chunk_ids: ["siu|ch01|p001"],
    source_locations: ["ch1/p1"],
    source_excerpt_preview: "discipline and responsibility",
    capsule_text: "Own the next honest move after a miss.",
    lesson_short: "Own the next move.",
    sms_allowed: false,
    ask_pat_allowed: true,
    film_room_allowed: false,
    victory_room_allowed: false,
    best_for_moves: ["one_honest_move"],
    best_for_patterns: ["after_miss"],
    goal_areas: ["general"],
    emotional_intensity: "low",
    do_not_use_contexts: [],
    cooldown_days: 14,
    must_not_expand_beyond_capsule: true,
    quote_attribution_allowed: false,
    message_weight: "light",
    capsule_max_chars: 180,
    suggested_sms_use: "never",
    one_sentence_version: "Name the next honest move.",
    created_at: "2026-05-27T00:00:00.000Z",
    updated_at: "2026-05-27T00:00:00.000Z",
    ...overrides,
  };
}

describe("pat-candidates validate", () => {
  it("valid minimal empty catalog passes", () => {
    const result = validatePatCandidatesCatalog(emptyCatalog(), null);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("duplicate candidate_id fails", () => {
    const c = baseCandidate({ candidate_id: "dup_v1" });
    const catalog = emptyCatalog();
    catalog.candidates = [c, { ...c }];
    const index = syntheticIndex([syntheticChunk()]);
    const result = validatePatCandidatesCatalog(catalog, index);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === "duplicate_candidate_id")).toBe(true);
  });

  it("exact_quote requires substring in source chunk", () => {
    const chunk = syntheticChunk({
      cleaned_text: "To be successful, you must accept full responsibility.",
    });
    const catalog = emptyCatalog();
    catalog.candidates = [
      baseCandidate({
        candidate_id: "quote_ok_v1",
        type: "exact_quote",
        exact_quote_text: "To be successful, you must accept full responsibility.",
        quote_attribution_allowed: true,
        capsule_text: "",
        one_sentence_version: "To be successful, you must accept full responsibility.",
      }),
      baseCandidate({
        candidate_id: "quote_bad_v1",
        type: "exact_quote",
        exact_quote_text: "This text is not in the source.",
        quote_attribution_allowed: true,
        capsule_text: "",
        one_sentence_version: "This text is not in the source.",
      }),
    ];
    const result = validatePatCandidatesCatalog(catalog, syntheticIndex([chunk]));
    expect(result.errors.some((e) => e.code === "quote_not_in_source")).toBe(true);
  });

  it("quote_attribution_allowed fails on story capsule", () => {
    const catalog = emptyCatalog();
    catalog.candidates = [
      baseCandidate({
        candidate_id: "story_bad_attr_v1",
        type: "story_capsule",
        quote_attribution_allowed: true,
      }),
    ];
    const result = validatePatCandidatesCatalog(catalog, syntheticIndex([syntheticChunk()]));
    expect(result.errors.some((e) => e.code === "quote_attribution_only_exact_quote")).toBe(true);
  });

  it('story capsule with "Pat said" fails', () => {
    const catalog = emptyCatalog();
    catalog.candidates = [
      baseCandidate({
        candidate_id: "story_pat_said_v1",
        type: "story_capsule",
        capsule_text: "Pat said you must own the next move.",
      }),
    ];
    const result = validatePatCandidatesCatalog(catalog, syntheticIndex([syntheticChunk()]));
    expect(result.errors.some((e) => e.code === "pat_said_not_allowed")).toBe(true);
  });

  it("banned left foot phrase fails", () => {
    const catalog = emptyCatalog();
    catalog.candidates = [
      baseCandidate({
        candidate_id: "banned_phrase_v1",
        capsule_text: "Remember left foot, right foot, breathe before the rep.",
      }),
    ];
    const result = validatePatCandidatesCatalog(catalog, syntheticIndex([syntheticChunk()]));
    expect(result.errors.some((e) => e.code === "banned_source_phrase")).toBe(true);
  });

  it("missing source chunk ID fails when index loaded", () => {
    const catalog = emptyCatalog();
    catalog.candidates = [
      baseCandidate({
        candidate_id: "missing_chunk_v1",
        source_chunk_ids: ["siu|ch01|p999"],
      }),
    ];
    const result = validatePatCandidatesCatalog(catalog, syntheticIndex([syntheticChunk()]));
    expect(result.errors.some((e) => e.code === "unknown_source_chunk")).toBe(true);
  });

  it("one_sentence_version over capsule_max_chars fails", () => {
    const catalog = emptyCatalog();
    catalog.candidates = [
      baseCandidate({
        candidate_id: "long_sentence_v1",
        capsule_max_chars: 20,
        one_sentence_version: "This one sentence version is definitely too long.",
      }),
    ];
    const result = validatePatCandidatesCatalog(catalog, syntheticIndex([syntheticChunk()]));
    expect(result.errors.some((e) => e.code === "one_sentence_too_long")).toBe(true);
  });

  it("q_and_a_insight requires qa_speaker", () => {
    const catalog = emptyCatalog();
    catalog.candidates = [
      baseCandidate({
        candidate_id: "qa_missing_speaker_v1",
        type: "q_and_a_insight",
        capsule_text: "Insight from Q&A section.",
      }),
    ];
    const result = validatePatCandidatesCatalog(catalog, syntheticIndex([syntheticChunk()]));
    expect(result.errors.some((e) => e.code === "missing_qa_speaker")).toBe(true);
  });

  it("sms_allowed requires approved status", () => {
    const catalog = emptyCatalog();
    catalog.candidates = [
      baseCandidate({
        candidate_id: "sms_draft_v1",
        status: "draft",
        sms_allowed: true,
      }),
    ];
    const result = validatePatCandidatesCatalog(catalog, syntheticIndex([syntheticChunk()]));
    expect(result.errors.some((e) => e.code === "sms_allowed_requires_approved")).toBe(true);
  });
});

describe("pat-candidates search-source", () => {
  it("tokenizes query", () => {
    expect(tokenizeSearchQuery("  ACL   Olympics  ")).toEqual(["acl", "olympics"]);
  });

  it("AND vs OR matching", () => {
    const text = "acl injury olympics";
    expect(chunkMatchesSearchQuery(text, ["acl", "injury"], "and")).toBe(true);
    expect(chunkMatchesSearchQuery(text, ["acl", "missing"], "and")).toBe(false);
    expect(chunkMatchesSearchQuery(text, ["acl", "missing"], "or")).toBe(true);
  });

  it("searchSourceChunks ranks by match count", () => {
    const chunks = [
      syntheticChunk({
        chunk_id: "siu|ch01|p001",
        cleaned_text: "acl injury",
      }),
      syntheticChunk({
        chunk_id: "siu|ch01|p002",
        cleaned_text: "acl injury olympics training",
      }),
    ];
    const results = searchSourceChunks(chunks, "acl olympics", { mode: "and", limit: 5 });
    expect(results).toHaveLength(1);
    expect(results[0]!.chunk_id).toBe("siu|ch01|p002");
  });

  it("excerptAroundFirstMatch includes match neighborhood", () => {
    const text = "aaaa discipline bbbb";
    const excerpt = excerptAroundFirstMatch(text, ["discipline"], 5);
    expect(excerpt).toContain("discipline");
  });
});
