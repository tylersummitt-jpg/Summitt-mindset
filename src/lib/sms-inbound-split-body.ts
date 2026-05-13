/** Pure merge for rapid multi-segment inbound SMS (no Supabase). */
export function mergeSplitInboundRawBodies(parts: string[]): string {
  return parts
    .map((p) => (p || "").trim())
    .filter(Boolean)
    .join("\n");
}
