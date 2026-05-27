import { readFileSync, existsSync } from "fs";
import { join } from "path";

import type { PatSourceBookId, PatSourceChunkV1 } from "@/lib/pat-source/types";

import {
  PAT_CANDIDATE_SOURCE_JSONL_BY_BOOK,
  type PatCandidateBookId,
} from "@/lib/pat-candidates/types";

export type PatSourceChunkIndex = {
  byChunkId: Map<string, PatSourceChunkV1>;
  byBookId: Map<PatCandidateBookId, Map<string, PatSourceChunkV1>>;
  sourceDir: string;
  loaded: boolean;
};

function parseJsonlFile(path: string): PatSourceChunkV1[] {
  const raw = readFileSync(path, "utf8");
  const chunks: PatSourceChunkV1[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    chunks.push(JSON.parse(trimmed) as PatSourceChunkV1);
  }
  return chunks;
}

/**
 * Load all source chunks from a Pat Source Library directory into an index.
 * Missing files are skipped; `loaded` is true when at least one book file was read.
 */
export function loadPatSourceChunkIndex(sourceDir: string): PatSourceChunkIndex {
  const byChunkId = new Map<string, PatSourceChunkV1>();
  const byBookId = new Map<PatCandidateBookId, Map<string, PatSourceChunkV1>>();
  let loaded = false;

  for (const bookId of Object.keys(PAT_CANDIDATE_SOURCE_JSONL_BY_BOOK) as PatCandidateBookId[]) {
    const filename = PAT_CANDIDATE_SOURCE_JSONL_BY_BOOK[bookId];
    const path = join(sourceDir, filename);
    if (!existsSync(path)) continue;

    const bookMap = new Map<string, PatSourceChunkV1>();
    for (const chunk of parseJsonlFile(path)) {
      byChunkId.set(chunk.chunk_id, chunk);
      bookMap.set(chunk.chunk_id, chunk);
    }
    byBookId.set(bookId, bookMap);
    loaded = true;
  }

  return { byChunkId, byBookId, sourceDir, loaded };
}

export function getSourceChunk(
  index: PatSourceChunkIndex,
  bookId: PatSourceBookId,
  chunkId: string
): PatSourceChunkV1 | undefined {
  return index.byBookId.get(bookId)?.get(chunkId) ?? index.byChunkId.get(chunkId);
}
