import {
  cleanParagraphText,
  countWords,
  isNoiseParagraph,
  splitOnSentences,
} from "@/lib/pat-source/clean";
import type { PatSourceBookConfig, PatSourceChunkV1 } from "@/lib/pat-source/types";
import {
  PAT_SOURCE_CHUNK_SCHEMA_VERSION,
  PAT_SOURCE_INGESTION_VERSION,
} from "@/lib/pat-source/types";

export type ChunkBuildOptions = {
  targetMinWords?: number;
  targetMaxWords?: number;
  hardMaxWords?: number;
};

const DEFAULT_OPTS: Required<ChunkBuildOptions> = {
  targetMinWords: 150,
  targetMaxWords: 450,
  hardMaxWords: 500,
};

export function formatChunkId(
  prefix: string,
  chapterIndex: number,
  paragraphStart: number,
  paragraphEnd: number,
  segmentIndex = 0
): string {
  const ch = String(chapterIndex).padStart(2, "0");
  const pStart = String(paragraphStart).padStart(3, "0");
  const seg =
    segmentIndex > 0 ? `~${String(segmentIndex).padStart(2, "0")}` : "";
  if (paragraphEnd === paragraphStart) {
    return `${prefix}|ch${ch}|p${pStart}${seg}`;
  }
  const pEnd = String(paragraphEnd).padStart(3, "0");
  return `${prefix}|ch${ch}|p${pStart}-${pEnd}${seg}`;
}

export function formatSourceLocation(
  chapterIndex: number,
  paragraphStart: number,
  paragraphEnd: number
): string {
  if (paragraphEnd === paragraphStart) {
    return `ch${chapterIndex}/p${paragraphStart}`;
  }
  return `ch${chapterIndex}/p${paragraphStart}-${paragraphEnd}`;
}

type ParagraphInput = {
  paragraph_index: number;
  raw_text: string;
  chapter_index: number;
  chapter_title: string | null;
  section_title: string | null;
  /** When a single paragraph is split into multiple chunks, distinguishes stable IDs. */
  segment_index?: number;
};

export function paragraphsFromRawBlocks(
  blocks: Array<{ type: "heading" | "paragraph"; text: string; level?: number }>
): ParagraphInput[] {
  let chapterIndex = 0;
  let chapterTitle: string | null = null;
  let sectionTitle: string | null = null;
  let paragraphIndex = 0;
  const out: ParagraphInput[] = [];

  for (const block of blocks) {
    const raw = block.text;
    if (block.type === "heading") {
      const cleaned = cleanParagraphText(raw);
      if (!cleaned) continue;
      const isChapter = isChapterHeading(cleaned, block.level ?? 1);
      if (isChapter) {
        chapterIndex += 1;
        chapterTitle = cleaned;
        sectionTitle = null;
      } else {
        sectionTitle = cleaned;
      }
      continue;
    }

    const cleaned = cleanParagraphText(raw);
    if (!cleaned || isNoiseParagraph(cleaned)) continue;
    if (chapterIndex === 0) {
      chapterIndex = 1;
      chapterTitle = chapterTitle ?? "Untitled Section";
    }
    paragraphIndex += 1;
    out.push({
      paragraph_index: paragraphIndex,
      raw_text: raw,
      chapter_index: chapterIndex,
      chapter_title: chapterTitle,
      section_title: sectionTitle,
    });
  }

  return out;
}

export function isChapterHeading(text: string, level: number): boolean {
  const t = text.trim();
  if (level <= 2) {
    if (/^(chapter|foreword|introduction|prologue|epilogue|afterword)\b/i.test(t)) return true;
    if (/^chapter\s+[0-9ivxlc]+/i.test(t)) return true;
    if (t.length < 120 && t === t.toUpperCase() && /[A-Z]/.test(t)) return true;
  }
  return false;
}

export function buildChunksFromParagraphs(args: {
  book: PatSourceBookConfig;
  paragraphs: ParagraphInput[];
  source_file_ref: string;
  source_file_sha256: string;
  ingested_at: string;
  options?: ChunkBuildOptions;
}): { chunks: PatSourceChunkV1[]; warnings: string[] } {
  const opts = { ...DEFAULT_OPTS, ...args.options };
  const warnings: string[] = [];
  const expanded: ParagraphInput[] = [];

  for (const p of args.paragraphs) {
    const cleaned = cleanParagraphText(p.raw_text);
    if (!cleaned) continue;
    const wc = countWords(cleaned);
    if (wc > opts.hardMaxWords) {
      const parts = splitOnSentences(cleaned, opts.targetMaxWords);
      if (parts.length > 1) {
        warnings.push(
          `split_long_paragraph:p${p.paragraph_index}:words=${wc}:parts=${parts.length}`
        );
        parts.forEach((part, segIdx) => {
          expanded.push({
            ...p,
            raw_text: part,
            paragraph_index: p.paragraph_index,
            segment_index: segIdx + 1,
          });
        });
        continue;
      }
    }
    expanded.push(p);
  }

  const chunks: PatSourceChunkV1[] = [];
  let chunkOrder = 0;

  const pushChunk = (
    p: ParagraphInput,
    cleanedText: string,
    rawText: string,
    paraStart: number,
    paraEnd: number,
    segmentIndex: number
  ) => {
    if (!cleanedText.trim() || isNoiseParagraph(cleanedText)) return;
    chunkOrder += 1;
    const chunk: PatSourceChunkV1 = {
      schema_version: PAT_SOURCE_CHUNK_SCHEMA_VERSION,
      chunk_id: formatChunkId(
        args.book.chunk_id_prefix,
        p.chapter_index,
        paraStart,
        paraEnd,
        segmentIndex
      ),
      book_id: args.book.book_id,
      book_title: args.book.book_title,
      chapter_index: p.chapter_index,
      chapter_title: p.chapter_title,
      section_title: p.section_title,
      paragraph_start: paraStart,
      paragraph_end: paraEnd,
      source_location: formatSourceLocation(p.chapter_index, paraStart, paraEnd),
      chunk_order: chunkOrder,
      cleaned_text: cleanedText,
      word_count: countWords(cleanedText),
      source_file_ref: args.source_file_ref,
      source_file_sha256: args.source_file_sha256,
      ingestion_version: PAT_SOURCE_INGESTION_VERSION,
      ingested_at: args.ingested_at,
    };
    const rawCleaned = cleanParagraphText(rawText);
    if (rawCleaned && rawCleaned !== cleanedText) {
      chunk.raw_text = rawCleaned;
    }
    chunks.push(chunk);
  };

  for (let i = 0; i < expanded.length; i++) {
    const start = expanded[i]!;
    if ((start.segment_index ?? 0) > 0) {
      const cleaned = cleanParagraphText(start.raw_text);
      pushChunk(
        start,
        cleaned,
        start.raw_text,
        start.paragraph_index,
        start.paragraph_index,
        start.segment_index ?? 0
      );
      continue;
    }

    let buf = "";
    let rawBuf = "";
    let paraStart = start.paragraph_index;
    let paraEnd = paraStart;
    const chapterIndex = start.chapter_index;
    let j = i;

    while (j < expanded.length) {
      const p = expanded[j]!;
      if (p.chapter_index !== chapterIndex) break;
      if ((p.segment_index ?? 0) > 0) break;

      const cleaned = cleanParagraphText(p.raw_text);
      if (!cleaned) {
        j += 1;
        continue;
      }

      const candidate = buf ? `${buf} ${cleaned}` : cleaned;
      const wc = countWords(candidate);

      if (wc > opts.hardMaxWords && buf) break;

      buf = candidate;
      rawBuf = rawBuf ? `${rawBuf}\n${p.raw_text}` : p.raw_text;
      paraEnd = p.paragraph_index;
      j += 1;

      if (wc >= opts.targetMinWords) break;
      if (wc >= opts.targetMaxWords) break;

      if (j < expanded.length) {
        const next = expanded[j]!;
        if (next.chapter_index !== chapterIndex || (next.segment_index ?? 0) > 0) break;
        const nextCleaned = cleanParagraphText(next.raw_text);
        if (countWords(buf) + countWords(nextCleaned) > opts.targetMaxWords) break;
        if (countWords(buf) >= 80 && countWords(nextCleaned) >= 80) break;
      }
    }

    if (buf.trim()) {
      pushChunk(start, cleanParagraphText(buf), rawBuf, paraStart, paraEnd, 0);
    }
    i = j - 1;
  }

  return { chunks, warnings };
}

export function findDuplicateChunkIds(chunks: PatSourceChunkV1[]): string[] {
  const seen = new Map<string, number>();
  const dups: string[] = [];
  for (const c of chunks) {
    const n = (seen.get(c.chunk_id) ?? 0) + 1;
    seen.set(c.chunk_id, n);
    if (n === 2) dups.push(c.chunk_id);
  }
  return dups;
}
