#!/usr/bin/env node
/**
 * Keyword search over Pat source chunk JSONL (manual authoring helper).
 *
 * Usage (from repo root):
 *   npm run pat:search-source -- --query "ACL Olympics" --book sum_it_up --limit 15
 *   npm run pat:search-source -- --query "hard work" --any --limit 10
 */

import { existsSync } from "fs";
import { join, resolve } from "path";

import { loadPatSourceChunkIndex } from "../../src/lib/pat-candidates/load-source-index.ts";
import {
  searchSourceChunks,
  type SourceSearchMatchMode,
} from "../../src/lib/pat-candidates/search-source.ts";
import type { PatSourceBookId, PatSourceChunkV1 } from "../../src/lib/pat-source/types.ts";

function parseArgs(argv: string[]) {
  let query = "";
  let sourceDir = "./data/pat/source";
  let book: PatSourceBookId | null = null;
  let limit = 15;
  let mode: SourceSearchMatchMode = "and";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--query" && argv[i + 1]) {
      query = argv[++i]!;
    } else if (a === "--source-dir" && argv[i + 1]) {
      sourceDir = argv[++i]!;
    } else if (a === "--book" && argv[i + 1]) {
      book = argv[++i] as PatSourceBookId;
    } else if (a === "--limit" && argv[i + 1]) {
      limit = Number.parseInt(argv[++i]!, 10);
    } else if (a === "--any") {
      mode = "or";
    }
  }

  return {
    query,
    sourceDir: resolve(process.cwd(), sourceDir),
    book,
    limit: Number.isFinite(limit) ? limit : 15,
    mode,
  };
}

function collectChunks(
  index: ReturnType<typeof loadPatSourceChunkIndex>,
  book: PatSourceBookId | null
): PatSourceChunkV1[] {
  if (book) {
    const bookMap = index.byBookId.get(book);
    return bookMap ? [...bookMap.values()] : [];
  }
  return [...index.byChunkId.values()];
}

function main() {
  const { query, sourceDir, book, limit, mode } = parseArgs(process.argv.slice(2));

  if (!query.trim()) {
    console.error("Missing --query");
    process.exit(1);
  }

  if (!existsSync(sourceDir)) {
    console.error(`Source directory not found: ${sourceDir}`);
    process.exit(1);
  }

  const index = loadPatSourceChunkIndex(sourceDir);
  if (!index.loaded) {
    console.error(`No source JSONL files found in ${sourceDir}`);
    process.exit(1);
  }

  const chunks = collectChunks(index, book);
  const results = searchSourceChunks(chunks, query, { mode, limit });

  console.log(`Query: "${query}" (${mode.toUpperCase()})`);
  console.log(`Book: ${book ?? "all"}`);
  console.log(`Matches: ${results.length}\n`);

  for (const r of results) {
    console.log(`${r.chunk_id}`);
    console.log(`  book_id: ${r.book_id}`);
    console.log(`  source_location: ${r.source_location}`);
    console.log(`  word_count: ${r.word_count}`);
    console.log(`  match_count: ${r.match_count}`);
    console.log(`  excerpt: ${r.excerpt}`);
    console.log("");
  }
}

main();
