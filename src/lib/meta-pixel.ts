/**
 * Meta Pixel helpers — PageView + coach-funnel events, no PII, safe SSR/no-op.
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

function callFbq(...args: unknown[]): void {
  if (getMetaPixelId() === null) return;
  if (typeof window === "undefined") return;
  const fbq = (window as Window & { fbq?: (...args: unknown[]) => void }).fbq;
  if (typeof fbq !== "function") return;
  try {
    (fbq as (...a: unknown[]) => void)(...args);
  } catch {
    /* ignore — pixel must never break the app */
  }
}

/**
 * Fires a standard PageView event. No custom parameters (no user data).
 */
export function trackPageView(): void {
  callFbq("track", "PageView");
}

export type CoachCtaPlacement = "hero" | "kit_section" | "footer";

/**
 * Custom: coach landing CTA clicks. No PII.
 */
export function trackCoachCtaClicked(cta: CoachCtaPlacement): void {
  callFbq("trackCustom", "coach_cta_clicked", {
    source: "coach",
    funnel: "coach_leadership_kit",
    cta,
  });
}

export type CoachCheckoutPlan = "monthly" | "annual";

/**
 * Standard InitiateCheckout — coach subscribe flow only (caller must enforce isCoachSrc).
 */
export function trackCoachInitiateCheckout(plan: CoachCheckoutPlan): void {
  callFbq("track", "InitiateCheckout", {
    source: "coach",
    funnel: "coach_leadership_kit",
    plan,
  });
}

/**
 * Custom: coach shipping form successfully saved. No PII.
 */
export function trackCoachShippingSubmitted(): void {
  callFbq("trackCustom", "coach_shipping_submitted", {
    source: "coach",
    funnel: "coach_leadership_kit",
    status: "success",
  });
}
