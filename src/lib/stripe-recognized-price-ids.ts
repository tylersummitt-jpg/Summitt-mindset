/**
 * Server-only helpers for recognizing Summitt Mindset Stripe Price IDs.
 * Used by Checkout Path B and related matching — never expose via NEXT_PUBLIC_*.
 */

/**
 * Parse a comma-separated Stripe Price ID list.
 * Trims whitespace, drops empty entries, dedupes (first-seen order).
 */
export function parseStripePriceIdList(
  raw: string | undefined | null
): string[] {
  if (raw == null || typeof raw !== "string") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export type RecognizedPriceIdSources = {
  monthly?: string | null;
  annual?: string | null;
  /** Raw STRIPE_LEGACY_PRICE_IDS value (comma-separated). */
  legacyCsv?: string | null;
};

/**
 * Final recognized allowlist: current monthly + annual env IDs plus legacy CSV.
 * Missing / empty STRIPE_LEGACY_PRICE_IDS is fine (no throw).
 */
export function getRecognizedSummittPriceIds(
  sources: RecognizedPriceIdSources = {
    monthly: process.env.STRIPE_PRICE_ID_MONTHLY,
    annual: process.env.STRIPE_PRICE_ID_ANNUAL,
    legacyCsv: process.env.STRIPE_LEGACY_PRICE_IDS,
  }
): Set<string> {
  const ids = new Set<string>();
  for (const raw of [sources.monthly, sources.annual]) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (id) ids.add(id);
  }
  for (const id of parseStripePriceIdList(sources.legacyCsv)) {
    ids.add(id);
  }
  return ids;
}

export function isRecognizedSummittPriceId(
  priceId: string | undefined | null,
  recognized: Set<string>
): boolean {
  return typeof priceId === "string" && priceId.length > 0 && recognized.has(priceId);
}
