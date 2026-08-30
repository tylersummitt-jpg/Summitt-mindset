/**
 * Thin SMS Pat-source retrieval. Reuses Ask Pat's JSONL loader and cosine helper.
 * YES path: same query normalize + ranked top-6 as Ask Pat. Does not call Ask Pat GPT.
 * Does not change Ask Pat topK/prompt/route.
 */

import OpenAI from "openai";
import {
  getTopRelevantChunks,
  type PatChunk,
  type ScoredChunk,
} from "@/lib/ask-pat/chunks";

export const PAT_SMS_EMBEDDING_MODEL = "text-embedding-3-small" as const;
export const PAT_SMS_TOP_K = 6 as const;
export const PAT_SMS_MAX_EXCERPTS = 6 as const;

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

/** Same formula as Ask Pat's private normalizeText. Do not import Ask Pat. */
export function normalizePatSmsQuery(text: string): string {
  return (text || "").trim().replace(/\s+/g, " ");
}

/**
 * Format Ask Pat's ranked top-K hits for the SMS writer.
 * Preserves rank order. No neighbor expansion. No length filter.
 */
export function assemblePatSmsEvidence(args: {
  scoredHits: ScoredChunk[];
}): { excerpts: PatSourceEvidenceExcerpt[]; globalIds: string[] } {
  const seen = new Set<string>();
  const excerpts: PatSourceEvidenceExcerpt[] = [];
  const globalIds: string[] = [];

  for (const hit of args.scoredHits) {
    if (excerpts.length >= PAT_SMS_MAX_EXCERPTS) break;
    if (!hit.globalId) continue;
    if (seen.has(hit.globalId)) continue;
    seen.add(hit.globalId);
    excerpts.push({
      book_id: hit.bookId,
      section_title: hit.sectionTitle,
      text: hit.text,
    });
    globalIds.push(hit.globalId);
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
  const query = normalizePatSmsQuery(args.query);
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
    const scoredHits = scoreChunks(queryEmbedding, PAT_SMS_TOP_K);
    const assembled = assemblePatSmsEvidence({ scoredHits });

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
