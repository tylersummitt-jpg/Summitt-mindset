/**
 * Thin SMS Pat-source retrieval. Reuses Ask Pat's JSONL loader and cosine helper.
 * Does not call Ask Pat GPT. Does not change Ask Pat topK/prompt/route.
 */

import OpenAI from "openai";
import {
  getPatChunks,
  getTopRelevantChunks,
  type PatChunk,
  type ScoredChunk,
} from "@/lib/ask-pat/chunks";

export const PAT_SMS_EMBEDDING_MODEL = "text-embedding-3-small" as const;
export const PAT_SMS_CANDIDATE_POOL = 8 as const;
export const PAT_SMS_MIN_CHUNK_CHARS = 80 as const;
export const PAT_SMS_MAX_CHUNK_CHARS = 2800 as const;
export const PAT_SMS_MAX_EXCERPTS = 4 as const;
export const PAT_SMS_MAX_TOTAL_CHARS = 4500 as const;

export type PatSourceEvidenceExcerpt = {
  book_id: string;
  section_title: string;
  text: string;
};

export type PatSourceEvidenceRetrievalStatus = "ok" | "empty" | "error";

export type PatSourceEvidencePacketV1 = {
  required: true;
  retrieval_status: PatSourceEvidenceRetrievalStatus;
  excerpts: PatSourceEvidenceExcerpt[];
};

export type PatSourceEvidenceForensics = {
  inbound_sol_pat_retrieval_attempted: boolean;
  inbound_sol_pat_evidence_present: boolean;
  inbound_sol_pat_source_count: number;
  inbound_sol_pat_retrieval_error: string | null;
  inbound_sol_pat_global_ids: string;
};

export type GetPatEvidenceForSmsDeps = {
  embedQuery?: (query: string) => Promise<number[]>;
  scoreChunks?: (queryEmbedding: number[], topK?: number) => ScoredChunk[];
  loadChunks?: () => PatChunk[];
  client?: OpenAI | null;
};

function unusedPatSmsText(text: string): boolean {
  const n = text.length;
  return n < PAT_SMS_MIN_CHUNK_CHARS || n > PAT_SMS_MAX_CHUNK_CHARS;
}

function skippedPatRetrievalForensics(): PatSourceEvidenceForensics {
  return {
    inbound_sol_pat_retrieval_attempted: false,
    inbound_sol_pat_evidence_present: false,
    inbound_sol_pat_source_count: 0,
    inbound_sol_pat_retrieval_error: null,
    inbound_sol_pat_global_ids: "",
  };
}

export function skippedPatSourceEvidenceForensics(): PatSourceEvidenceForensics {
  return skippedPatRetrievalForensics();
}

function forensicsFromPacket(
  packet: PatSourceEvidencePacketV1,
  globalIds: string[],
  error: string | null
): PatSourceEvidenceForensics {
  return {
    inbound_sol_pat_retrieval_attempted: true,
    inbound_sol_pat_evidence_present: packet.excerpts.length > 0,
    inbound_sol_pat_source_count: packet.excerpts.length,
    inbound_sol_pat_retrieval_error: error,
    inbound_sol_pat_global_ids: globalIds.slice(0, PAT_SMS_MAX_EXCERPTS).join(","),
  };
}

function errorPacket(error: string): {
  packet: PatSourceEvidencePacketV1;
  forensics: PatSourceEvidenceForensics;
} {
  const packet: PatSourceEvidencePacketV1 = {
    required: true,
    retrieval_status: "error",
    excerpts: [],
  };
  return { packet, forensics: forensicsFromPacket(packet, [], error) };
}

export function buildPatSmsEmbeddingQuery(args: {
  latestInboundText: string;
  directQuestionOrNeed?: string | null;
}): string {
  const latest = args.latestInboundText.trim();
  const need =
    typeof args.directQuestionOrNeed === "string" ? args.directQuestionOrNeed.trim() : "";
  if (!need || need === "unknown") return latest;
  if (need.toLowerCase() === latest.toLowerCase()) return latest;
  if (latest.includes(need) || need.includes(latest)) {
    return latest.length >= need.length ? latest : need;
  }
  return `${latest}\n${need}`;
}

export function assemblePatSmsEvidence(args: {
  scoredHits: ScoredChunk[];
  allChunks: PatChunk[];
}): { excerpts: PatSourceEvidenceExcerpt[]; globalIds: string[] } {
  const byBookOrder = new Map<string, PatChunk>();
  for (const chunk of args.allChunks) {
    if (!chunk.globalId) continue;
    byBookOrder.set(`${chunk.bookId}:${chunk.order}`, chunk);
  }

  const usableHits = args.scoredHits.filter(
    (hit) => hit.globalId && !unusedPatSmsText(hit.text)
  );
  const topHits = usableHits.slice(0, 2);

  const selected = new Map<string, PatChunk>();
  const addChunk = (chunk: PatChunk | undefined) => {
    if (!chunk?.globalId) return;
    if (unusedPatSmsText(chunk.text)) return;
    if (selected.has(chunk.globalId)) return;
    selected.set(chunk.globalId, chunk);
  };

  for (const hit of topHits) {
    addChunk(hit);
    addChunk(byBookOrder.get(`${hit.bookId}:${hit.order - 1}`));
    addChunk(byBookOrder.get(`${hit.bookId}:${hit.order + 1}`));
  }

  const hitIds = new Set(topHits.map((hit) => hit.globalId));
  const ordered = [...selected.values()].sort((a, b) => {
    const aHit = hitIds.has(a.globalId) ? 0 : 1;
    const bHit = hitIds.has(b.globalId) ? 0 : 1;
    if (aHit !== bHit) return aHit - bHit;
    if (a.bookId !== b.bookId) return a.bookId.localeCompare(b.bookId);
    return a.order - b.order;
  });

  const excerpts: PatSourceEvidenceExcerpt[] = [];
  const globalIds: string[] = [];
  let totalChars = 0;
  for (const chunk of ordered) {
    if (excerpts.length >= PAT_SMS_MAX_EXCERPTS) break;
    if (totalChars + chunk.text.length > PAT_SMS_MAX_TOTAL_CHARS) break;
    excerpts.push({
      book_id: chunk.bookId,
      section_title: chunk.sectionTitle,
      text: chunk.text,
    });
    globalIds.push(chunk.globalId);
    totalChars += chunk.text.length;
  }

  return { excerpts, globalIds };
}

async function defaultEmbedQuery(query: string, client: OpenAI): Promise<number[]> {
  const embed = await client.embeddings.create({
    model: PAT_SMS_EMBEDDING_MODEL,
    input: query,
  });
  const vector = embed.data[0]?.embedding;
  if (!vector?.length) throw new Error("empty_embedding");
  return vector;
}

export async function getPatEvidenceForSms(args: {
  query: string;
  deps?: GetPatEvidenceForSmsDeps;
}): Promise<{
  packet: PatSourceEvidencePacketV1;
  forensics: PatSourceEvidenceForensics;
}> {
  const query = args.query.trim();
  if (!query) return errorPacket("empty_query");

  try {
    let embedQuery = args.deps?.embedQuery;
    if (!embedQuery) {
      const apiKey = process.env.OPENAI_API_KEY?.trim();
      const client =
        args.deps?.client === undefined
          ? apiKey
            ? new OpenAI({ apiKey })
            : null
          : args.deps.client;
      if (!client) return errorPacket("openai_unavailable");
      embedQuery = (q) => defaultEmbedQuery(q, client);
    }

    const queryEmbedding = await embedQuery(query);
    if (!queryEmbedding.length) return errorPacket("empty_embedding");

    const scoreChunks = args.deps?.scoreChunks ?? getTopRelevantChunks;
    const loadChunks = args.deps?.loadChunks ?? getPatChunks;
    const scoredHits = scoreChunks(queryEmbedding, PAT_SMS_CANDIDATE_POOL);
    const assembled = assemblePatSmsEvidence({
      scoredHits,
      allChunks: loadChunks(),
    });

    if (assembled.excerpts.length === 0) {
      const packet: PatSourceEvidencePacketV1 = {
        required: true,
        retrieval_status: "empty",
        excerpts: [],
      };
      return { packet, forensics: forensicsFromPacket(packet, [], null) };
    }

    const packet: PatSourceEvidencePacketV1 = {
      required: true,
      retrieval_status: "ok",
      excerpts: assembled.excerpts,
    };
    return { packet, forensics: forensicsFromPacket(packet, assembled.globalIds, null) };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 80) : "retrieval_failed";
    return errorPacket(message || "retrieval_failed");
  }
}
