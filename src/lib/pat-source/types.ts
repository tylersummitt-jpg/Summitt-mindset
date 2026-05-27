export const PAT_SOURCE_INGESTION_VERSION = "pat_source_ingest_v1" as const;
export const PAT_SOURCE_CHUNK_SCHEMA_VERSION = "pat_source_chunk_v1" as const;
export const PAT_SOURCE_MANIFEST_SCHEMA_VERSION = "pat_source_manifest_v1" as const;
export const PAT_SOURCE_REPORT_SCHEMA_VERSION = "pat_source_ingest_report_v1" as const;

export type PatSourceBookId = "reach_for_the_summit" | "sum_it_up";

export type PatSourceBookConfig = {
  book_id: PatSourceBookId;
  book_title: string;
  chunk_id_prefix: "rfs" | "siu";
  expected_filename: string;
};

export const PAT_SOURCE_BOOKS: readonly PatSourceBookConfig[] = [
  {
    book_id: "reach_for_the_summit",
    book_title: "Reach for the Summit",
    chunk_id_prefix: "rfs",
    expected_filename: "reach_for_the_summit.docx",
  },
  {
    book_id: "sum_it_up",
    book_title: "Sum It Up",
    chunk_id_prefix: "siu",
    expected_filename: "sum_it_up.docx",
  },
] as const;

export function getPatSourceBookConfig(bookId: PatSourceBookId): PatSourceBookConfig {
  const found = PAT_SOURCE_BOOKS.find((b) => b.book_id === bookId);
  if (!found) throw new Error(`unknown_pat_source_book:${bookId}`);
  return found;
}

export type PatSourceChunkV1 = {
  schema_version: typeof PAT_SOURCE_CHUNK_SCHEMA_VERSION;
  chunk_id: string;
  book_id: PatSourceBookId;
  book_title: string;
  chapter_index: number;
  chapter_title: string | null;
  section_title: string | null;
  paragraph_start: number;
  paragraph_end: number;
  source_location: string;
  chunk_order: number;
  cleaned_text: string;
  raw_text?: string;
  word_count: number;
  source_file_ref: string;
  source_file_sha256: string;
  ingestion_version: typeof PAT_SOURCE_INGESTION_VERSION;
  ingested_at: string;
};

export type ParsedParagraph = {
  paragraph_index: number;
  text: string;
  raw_text: string;
  chapter_index: number;
  chapter_title: string | null;
  section_title: string | null;
};

export type PatSourceManifestV1 = {
  schema_version: typeof PAT_SOURCE_MANIFEST_SCHEMA_VERSION;
  ingestion_version: typeof PAT_SOURCE_INGESTION_VERSION;
  ingested_at: string;
  parser: { name: string; version: string };
  books: PatSourceManifestBookEntry[];
  excluded_books: Array<{ book_id: string; reason: string }>;
  aggregate: {
    total_chunks: number;
    total_words: number;
  };
};

export type PatSourceManifestBookEntry = {
  book_id: PatSourceBookId;
  book_title: string;
  source_file_ref: string;
  source_file_sha256: string;
  source_file_bytes: number;
  included_in_slice: boolean;
  chapter_count: number;
  paragraph_count: number;
  chunk_count: number;
  total_word_count: number;
  chunk_id_prefix: string;
  warnings_count: number;
  complete: boolean;
};

export type TermSearchHit = {
  chunk_id: string;
  source_location: string;
  excerpt: string;
};

export type PatSourceIngestReportV1 = {
  schema_version: typeof PAT_SOURCE_REPORT_SCHEMA_VERSION;
  generated_at: string;
  ingestion_version: typeof PAT_SOURCE_INGESTION_VERSION;
  books: Record<
    PatSourceBookId,
    {
      chunk_count: number;
      word_count: number;
      chapters_detected: Array<{
        chapter_index: number;
        title: string | null;
        paragraph_count: number;
      }>;
      chunk_word_count_histogram: {
        under_50: number;
        between_50_200: number;
        between_200_450: number;
        over_450: number;
      };
      suspicious_ocr_patterns: Record<string, number>;
      duplicate_chunk_ids: string[];
      missing_chapter_titles: number;
      very_short_chunks: string[];
      very_long_chunks: string[];
      top_warnings: string[];
      sample_chunks_for_review: Array<{
        chunk_id: string;
        source_location: string;
        excerpt: string;
      }>;
      term_search_hits: Record<string, TermSearchHit[]>;
    }
  >;
};
