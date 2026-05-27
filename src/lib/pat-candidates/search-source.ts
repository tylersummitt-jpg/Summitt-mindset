import type { PatSourceChunkV1 } from "@/lib/pat-source/types";

export type SourceSearchMatchMode = "and" | "or";

export function tokenizeSearchQuery(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export function countTokenMatches(text: string, tokens: string[]): number {
  const hay = text.toLowerCase();
  let count = 0;
  for (const token of tokens) {
    if (hay.includes(token)) count += 1;
  }
  return count;
}

export function chunkMatchesSearchQuery(
  text: string,
  tokens: string[],
  mode: SourceSearchMatchMode
): boolean {
  if (tokens.length === 0) return false;
  const hay = text.toLowerCase();
  if (mode === "and") {
    return tokens.every((t) => hay.includes(t));
  }
  return tokens.some((t) => hay.includes(t));
}

export function excerptAroundFirstMatch(
  text: string,
  tokens: string[],
  radius = 100
): string {
  const hay = text.toLowerCase();
  let index = -1;
  let matchEnd = 0;
  for (const token of tokens) {
    const i = hay.indexOf(token);
    if (i >= 0 && (index < 0 || i < index)) {
      index = i;
      matchEnd = i + token.length;
    }
  }
  if (index < 0) {
    return text.length <= radius * 2 ? text : `${text.slice(0, radius * 2)}…`;
  }
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, matchEnd + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}

export type SourceSearchResult = {
  chunk_id: string;
  book_id: string;
  source_location: string;
  word_count: number;
  match_count: number;
  excerpt: string;
};

export function searchSourceChunks(
  chunks: PatSourceChunkV1[],
  query: string,
  options?: { mode?: SourceSearchMatchMode; limit?: number }
): SourceSearchResult[] {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return [];

  const mode = options?.mode ?? "and";
  const limit = options?.limit ?? 15;

  const scored: SourceSearchResult[] = [];
  for (const chunk of chunks) {
    if (!chunkMatchesSearchQuery(chunk.cleaned_text, tokens, mode)) continue;
    const match_count = countTokenMatches(chunk.cleaned_text, tokens);
    scored.push({
      chunk_id: chunk.chunk_id,
      book_id: chunk.book_id,
      source_location: chunk.source_location,
      word_count: chunk.word_count,
      match_count,
      excerpt: excerptAroundFirstMatch(chunk.cleaned_text, tokens),
    });
  }

  scored.sort((a, b) => b.match_count - a.match_count || a.chunk_id.localeCompare(b.chunk_id));
  return scored.slice(0, limit);
}
