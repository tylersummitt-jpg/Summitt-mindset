/**
 * Meta Pixel helpers — V1: PageView only, no PII, safe SSR/no-op.
 */

export function getMetaPixelId(): string | null {
  const raw = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();
  if (!raw) return null;
  /** Meta pixel IDs are numeric; reject unexpected values to avoid XSS in any future inline use. */
  if (!/^\d+$/.test(raw)) return null;
  return raw;
}

export function isMetaPixelConfigured(): boolean {
  return getMetaPixelId() !== null;
}

/**
 * Fires a standard PageView event. No custom parameters (no user data).
 */
export function trackPageView(): void {
  if (typeof window === "undefined") return;
  const fbq = (window as Window & { fbq?: (...args: unknown[]) => void }).fbq;
  if (typeof fbq !== "function") return;
  try {
    fbq("track", "PageView");
  } catch {
    /* ignore — pixel must never break the app */
  }
}
