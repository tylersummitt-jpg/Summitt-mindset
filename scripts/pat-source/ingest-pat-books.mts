#!/usr/bin/env node
/**
 * Ingest Pat Summitt source books (Reach for the Summit, Sum It Up) from local .docx files.
 * Does not touch Ask Pat, SMS, or embeddings.
 *
 * Usage (from repo root):
 *   npm run pat:ingest-source -- --input-dir ./private/pat-books --output-dir ./data/pat/source
 */

import { accessSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";

import { ingestPatSourceBookFromDocx } from "../../src/lib/pat-source/ingest-book.ts";
import { buildPatSourceManifest } from "../../src/lib/pat-source/manifest.ts";
import { buildPatSourceIngestReport } from "../../src/lib/pat-source/report.ts";
import { getMammothVersionLabel } from "../../src/lib/pat-source/parse-docx.ts";
import {
  PAT_SOURCE_BOOKS,
  type PatSourceBookId,
  type PatSourceChunkV1,
} from "../../src/lib/pat-source/types.ts";

function parseArgs(argv: string[]) {
  let inputDir = "./private/pat-books";
  let outputDir = "./data/pat/source";
  let booksFilter: PatSourceBookId[] | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input-dir" && argv[i + 1]) {
      inputDir = argv[++i]!;
    } else if (a === "--output-dir" && argv[i + 1]) {
      outputDir = argv[++i]!;
    } else if (a === "--books" && argv[i + 1]) {
      booksFilter = argv[++i]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) as PatSourceBookId[];
    }
  }

  return {
    inputDir: resolve(process.cwd(), inputDir),
    outputDir: resolve(process.cwd(), outputDir),
    booksFilter,
  };
}

function writeJson(path: string, data: unknown) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeJsonl(path: string, chunks: PatSourceChunkV1[]) {
  const lines = chunks.map((c) => JSON.stringify(c));
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const { inputDir, outputDir, booksFilter } = parseArgs(process.argv.slice(2));
  const ingested_at = new Date().toISOString();
  const books = booksFilter
    ? PAT_SOURCE_BOOKS.filter((b) => booksFilter.includes(b.book_id))
    : [...PAT_SOURCE_BOOKS];

  const missing: string[] = [];
  for (const book of books) {
    const docxPath = join(inputDir, book.expected_filename);
    try {
      accessSync(docxPath);
    } catch {
      missing.push(docxPath);
    }
  }

  if (missing.length) {
    console.error("[pat:ingest-source] Missing required .docx files:");
    for (const p of missing) console.error(`  - ${p}`);
    console.error("\nExpected:");
    console.error("  private/pat-books/reach_for_the_summit.docx");
    console.error("  private/pat-books/sum_it_up.docx");
    process.exit(1);
  }

  mkdirSync(outputDir, { recursive: true });

  const bookResults = [];
  const reportResults: Record<
    PatSourceBookId,
    { chunks: PatSourceChunkV1[]; warnings: string[] }
  > = {} as Record<PatSourceBookId, { chunks: PatSourceChunkV1[]; warnings: string[] }>;

  for (const book of books) {
    const docxPath = join(inputDir, book.expected_filename);
    console.log(`[pat:ingest-source] Ingesting ${book.book_title}…`);
    const result = await ingestPatSourceBookFromDocx({
      book,
      docxPath,
      ingested_at,
    });
    bookResults.push(result);
    reportResults[book.book_id] = { chunks: result.chunks, warnings: result.warnings };

    const outPath = join(outputDir, `${book.book_id}.source_chunks.jsonl`);
    writeJsonl(outPath, result.chunks);
    console.log(
      `  → ${result.chunks.length} chunks, ${result.paragraph_count} paragraphs, ${result.warnings.length} warnings`
    );
    console.log(`  → wrote ${outPath}`);
  }

  const manifest = buildPatSourceManifest({
    ingested_at,
    parser: { name: "mammoth", version: getMammothVersionLabel() },
    bookResults,
  });
  writeJson(join(outputDir, "books.manifest.json"), manifest);

  const report = buildPatSourceIngestReport({
    generated_at: ingested_at,
    results: reportResults,
  });
  writeJson(join(outputDir, "source_ingest_report.json"), report);

  console.log("\n[pat:ingest-source] Summary");
  console.log(`  output: ${outputDir}`);
  console.log(`  total chunks: ${manifest.aggregate.total_chunks}`);
  console.log(`  total words: ${manifest.aggregate.total_words}`);
  for (const b of manifest.books) {
    console.log(
      `  ${b.book_id}: ${b.chunk_count} chunks, ${b.chapter_count} chapters, ${b.total_word_count} words`
    );
  }

  if (manifest.aggregate.total_chunks === 0) {
    console.error("[pat:ingest-source] No chunks produced — aborting.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[pat:ingest-source] Failed:", err);
  process.exit(1);
});
