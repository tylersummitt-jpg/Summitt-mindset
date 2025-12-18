import fs from "fs";
import path from "path";

export interface PatChunk {
  id: string;
  text: string;
  embedding: number[];
  bookId: string;
  sectionTitle: string;
}

let cachedChunks: PatChunk[] | null = null;

export function getPatChunks(): PatChunk[] {
  if (cachedChunks) return cachedChunks;

  const filePath = path.join(
    process.cwd(),
    "src",
    "lib",
    "ask-pat",
    "pat_library_with_embeddings.jsonl"
  );

  const fileContents = fs.readFileSync(filePath, "utf8");
  const chunks: PatChunk[] = [];

  for (const line of fileContents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const obj = JSON.parse(trimmed);

    chunks.push({
      id: obj.id,
      text: obj.text,
      embedding: obj.embedding,
      bookId: obj.book_id,
      sectionTitle: obj.section_title,
    });
  }

  cachedChunks = chunks;
  return chunks;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export interface ScoredChunk extends PatChunk {
  score: number;
}

export function getTopRelevantChunks(
  queryEmbedding: number[],
  topK = 6
): ScoredChunk[] {
  const chunks = getPatChunks();

  const scored = chunks.map((chunk) => ({
    ...chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
