import { excerptText } from "@/lib/pat-source/clean";
import { findDuplicateChunkIds } from "@/lib/pat-source/chunk";
import type {
  PatSourceBookId,
  PatSourceChunkV1,
  PatSourceIngestReportV1,
  TermSearchHit,
} from "@/lib/pat-source/types";
import { PAT_SOURCE_INGESTION_VERSION, PAT_SOURCE_REPORT_SCHEMA_VERSION } from "@/lib/pat-source/types";

export const PAT_SOURCE_QA_SEARCH_TERMS = [
  "ACL",
  "Olympics",
  "responsibility",
  "discipline",
  "hard work",
  "success",
  "failure",
  "compete",
  "team",
  "standards",
  "no excuses",
  "left foot",
  "right foot",
  "breathe",
] as const;

export function searchChunksForTerm(
  chunks: PatSourceChunkV1[],
  term: string,
  maxHits = 8
): TermSearchHit[] {
  const needle = term.toLowerCase();
  const hits: TermSearchHit[] = [];
  for (const c of chunks) {
    if (!c.cleaned_text.toLowerCase().includes(needle)) continue;
    hits.push({
      chunk_id: c.chunk_id,
      source_location: c.source_location,
      excerpt: excerptText(c.cleaned_text, 200),
    });
    if (hits.length >= maxHits) break;
  }
  return hits;
}

export function buildTermSearchHits(
  chunks: PatSourceChunkV1[]
): Record<string, TermSearchHit[]> {
  const out: Record<string, TermSearchHit[]> = {};
  for (const term of PAT_SOURCE_QA_SEARCH_TERMS) {
    out[term] = searchChunksForTerm(chunks, term);
  }
  return out;
}

function wordCountHistogram(chunks: PatSourceChunkV1[]) {
  const hist = {
    under_50: 0,
    between_50_200: 0,
    between_200_450: 0,
    over_450: 0,
  };
  for (const c of chunks) {
    const w = c.word_count;
    if (w < 50) hist.under_50 += 1;
    else if (w < 200) hist.between_50_200 += 1;
    else if (w <= 450) hist.between_200_450 += 1;
    else hist.over_450 += 1;
  }
  return hist;
}

function detectSuspiciousOcr(chunks: PatSourceChunkV1[]): Record<string, number> {
  const counts: Record<string, number> = {
    mid_word_spaces: 0,
    repeated_short_lines: 0,
  };
  for (const c of chunks) {
    if (/\w\s+\w\s+\w/.test(c.cleaned_text) && /\b[a-z]\s+[a-z]\s+[a-z]\b/i.test(c.cleaned_text)) {
      counts.mid_word_spaces = (counts.mid_word_spaces ?? 0) + 1;
    }
  }
  return counts;
}

function chaptersFromChunks(chunks: PatSourceChunkV1[]) {
  const map = new Map<number, { title: string | null; paragraph_count: number }>();
  for (const c of chunks) {
    const existing = map.get(c.chapter_index);
    const paraSpan = c.paragraph_end - c.paragraph_start + 1;
    if (!existing) {
      map.set(c.chapter_index, {
        title: c.chapter_title,
        paragraph_count: paraSpan,
      });
    } else {
      existing.paragraph_count += paraSpan;
      if (!existing.title && c.chapter_title) existing.title = c.chapter_title;
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([chapter_index, v]) => ({
      chapter_index,
      title: v.title,
      paragraph_count: v.paragraph_count,
    }));
}

export function buildPatSourceIngestReport(args: {
  generated_at: string;
  results: Record<PatSourceBookId, { chunks: PatSourceChunkV1[]; warnings: string[] }>;
}): PatSourceIngestReportV1 {
  const books = {} as PatSourceIngestReportV1["books"];

  for (const bookId of Object.keys(args.results) as PatSourceBookId[]) {
    const { chunks, warnings } = args.results[bookId]!;
    const duplicate_chunk_ids = findDuplicateChunkIds(chunks);
    const very_short_chunks = chunks.filter((c) => c.word_count < 30).map((c) => c.chunk_id);
    const very_long_chunks = chunks.filter((c) => c.word_count > 500).map((c) => c.chunk_id);
    const missing_chapter_titles = new Set(
      chunks.filter((c) => !c.chapter_title?.trim()).map((c) => c.chapter_index)
    ).size;

    const sample_stride = Math.max(1, Math.floor(chunks.length / 5));
    const sample_chunks_for_review = chunks
      .filter((_, idx) => idx % sample_stride === 0)
      .slice(0, 5)
      .map((c) => ({
        chunk_id: c.chunk_id,
        source_location: c.source_location,
        excerpt: excerptText(c.cleaned_text, 200),
      }));

    const top_warnings = [
      ...warnings.slice(0, 10),
      ...(duplicate_chunk_ids.length
        ? [`duplicate_chunk_ids:${duplicate_chunk_ids.length}`]
        : []),
      ...(very_long_chunks.length ? [`very_long_chunks:${very_long_chunks.length}`] : []),
    ].slice(0, 15);

    books[bookId] = {
      chunk_count: chunks.length,
      word_count: chunks.reduce((s, c) => s + c.word_count, 0),
      chapters_detected: chaptersFromChunks(chunks),
      chunk_word_count_histogram: wordCountHistogram(chunks),
      suspicious_ocr_patterns: detectSuspiciousOcr(chunks),
      duplicate_chunk_ids,
      missing_chapter_titles,
      very_short_chunks: very_short_chunks.slice(0, 20),
      very_long_chunks: very_long_chunks.slice(0, 20),
      top_warnings,
      sample_chunks_for_review,
      term_search_hits: buildTermSearchHits(chunks),
    };
  }

  return {
    schema_version: PAT_SOURCE_REPORT_SCHEMA_VERSION,
    generated_at: args.generated_at,
    ingestion_version: PAT_SOURCE_INGESTION_VERSION,
    books,
  };
}

export function validatePatSourceChunk(chunk: PatSourceChunkV1): string[] {
  const errors: string[] = [];
  if (!chunk.cleaned_text?.trim()) errors.push("empty_cleaned_text");
  if (chunk.word_count <= 0) errors.push("invalid_word_count");
  if (!chunk.chunk_id) errors.push("missing_chunk_id");
  if (!chunk.source_location) errors.push("missing_source_location");
  return errors;
}
