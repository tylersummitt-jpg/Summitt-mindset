/** How a post was produced. Unknown is the default. Nothing is inferred from the writing. */

export const CONTENT_PRODUCTIONS = [
  { id: "brooke", label: "Brooke-created" },
  { id: "ai", label: "AI-assisted" },
  { id: "hybrid", label: "Hybrid" },
  { id: "unknown", label: "Unknown" },
] as const;

export type ContentProductionId = (typeof CONTENT_PRODUCTIONS)[number]["id"];

export function parseContentProduction(raw: unknown): Exclude<ContentProductionId, "unknown"> | null {
  if (raw === "brooke" || raw === "ai" || raw === "hybrid") return raw;
  return null;
}

export function contentProductionLabel(raw: unknown): string {
  const id = parseContentProduction(raw);
  return CONTENT_PRODUCTIONS.find((row) => row.id === id)?.label ?? "Unknown";
}
