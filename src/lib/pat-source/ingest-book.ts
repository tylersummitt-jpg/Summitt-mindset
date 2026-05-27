import { createHash } from "crypto";
import { readFileSync, statSync } from "fs";

import {
  buildChunksFromParagraphs,
  paragraphsFromRawBlocks,
} from "@/lib/pat-source/chunk";
import type { BookIngestResult } from "@/lib/pat-source/manifest";
import { parseDocxFileToBlocks } from "@/lib/pat-source/parse-docx";
import { validatePatSourceChunk } from "@/lib/pat-source/report";
import type { PatSourceBookConfig } from "@/lib/pat-source/types";

export function sha256File(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

export async function ingestPatSourceBookFromDocx(args: {
  book: PatSourceBookConfig;
  docxPath: string;
  ingested_at: string;
}): Promise<BookIngestResult> {
  const stat = statSync(args.docxPath);
  const sha256 = sha256File(args.docxPath);
  const blocks = await parseDocxFileToBlocks(args.docxPath);
  const paragraphs = paragraphsFromRawBlocks(blocks);
  const { chunks, warnings } = buildChunksFromParagraphs({
    book: args.book,
    paragraphs,
    source_file_ref: args.book.expected_filename,
    source_file_sha256: sha256,
    ingested_at: args.ingested_at,
  });

  for (const chunk of chunks) {
    const errs = validatePatSourceChunk(chunk);
    if (errs.length) {
      warnings.push(`invalid_chunk:${chunk.chunk_id}:${errs.join(",")}`);
    }
  }

  if (chunks.length === 0) {
    warnings.push("zero_chunks_produced");
  }

  return {
    book: args.book,
    chunks,
    warnings,
    source_file_sha256: sha256,
    source_file_bytes: stat.size,
    paragraph_count: paragraphs.length,
  };
}
