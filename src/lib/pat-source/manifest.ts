import type {
  PatSourceBookConfig,
  PatSourceChunkV1,
  PatSourceManifestBookEntry,
  PatSourceManifestV1,
} from "@/lib/pat-source/types";
import {
  PAT_SOURCE_INGESTION_VERSION,
  PAT_SOURCE_MANIFEST_SCHEMA_VERSION,
} from "@/lib/pat-source/types";

export type BookIngestResult = {
  book: PatSourceBookConfig;
  chunks: PatSourceChunkV1[];
  warnings: string[];
  source_file_sha256: string;
  source_file_bytes: number;
  paragraph_count: number;
};

export function buildPatSourceManifest(args: {
  ingested_at: string;
  parser: { name: string; version: string };
  bookResults: BookIngestResult[];
}): PatSourceManifestV1 {
  const books: PatSourceManifestBookEntry[] = args.bookResults.map((r) => {
    const chapterIndices = new Set(r.chunks.map((c) => c.chapter_index));
    const totalWords = r.chunks.reduce((sum, c) => sum + c.word_count, 0);
    return {
      book_id: r.book.book_id,
      book_title: r.book.book_title,
      source_file_ref: r.book.expected_filename,
      source_file_sha256: r.source_file_sha256,
      source_file_bytes: r.source_file_bytes,
      included_in_slice: true,
      chapter_count: chapterIndices.size,
      paragraph_count: r.paragraph_count,
      chunk_count: r.chunks.length,
      total_word_count: totalWords,
      chunk_id_prefix: r.book.chunk_id_prefix,
      warnings_count: r.warnings.length,
      complete: r.chunks.length > 0,
    };
  });

  const aggregate = books.reduce(
    (acc, b) => ({
      total_chunks: acc.total_chunks + b.chunk_count,
      total_words: acc.total_words + b.total_word_count,
    }),
    { total_chunks: 0, total_words: 0 }
  );

  return {
    schema_version: PAT_SOURCE_MANIFEST_SCHEMA_VERSION,
    ingestion_version: PAT_SOURCE_INGESTION_VERSION,
    ingested_at: args.ingested_at,
    parser: args.parser,
    books,
    excluded_books: [{ book_id: "raise_the_roof", reason: "out_of_scope_slice_1" }],
    aggregate,
  };
}
