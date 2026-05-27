/**
 * Meta Pixel helpers — allowlisted events only, no PII, safe SSR/no-op.
 */

import { getMetaPageViewDecision } from "@/lib/meta-pixel-route-policy";

export function getMetaPixelId(): string | null {
  const raw = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();
  if (!raw) return null;
  /** Meta pixel IDs are numeric; reject unexpected values to avoid XSS in any future inline use. */
  if (!/^\d+$/.test(raw)) return null;
  return raw;
}

export function isMetaPixelEnabled(): boolean {
  if (getMetaPixelId() === null) return false;
  const flag = process.env.NEXT_PUBLIC_META_PIXEL_ENABLED?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function isMetaPixelConfigured(): boolean {
  return isMetaPixelEnabled();
}

const ALLOWED_PAYLOAD_KEYS = new Set([
  "source",
  "funnel",
  "cta",
  "plan",
  "status",
  "page_path",
]);

const DISALLOWED_KEY_PATTERN =
  /email|phone|e164|name|identity|goal|journal|proof|sms|message|token|session|user_?id|clerk|stripe|subscription|commitment|victory|pat_/i;

const PHONE_LIKE_PATTERN = /^\+?[\d\s().-]{10,}$/;
const STRIPE_LIKE_PATTERN = /^(cs_|sub_|sess_|pi_|ch_|evt_)/i;

type MetaStandardEvent = "PageView" | "InitiateCheckout";
type MetaCustomEvent =
  | "coach_cta_clicked"
  | "coach_how_it_works_nav"
  | "coach_shipping_submitted";

export type MetaSafePayload = Record<string, string | number | boolean>;

function isDev(): boolean {
  return process.env.NODE_ENV === "development";
}

function warnBlocked(reason: string, detail?: unknown): void {
  if (!isDev()) return;
  console.warn("[meta-pixel]", reason, detail ?? "");
}

function isSafeScalar(value: unknown): value is string | number | boolean {
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean";
}

function isSafeStringValue(value: string): boolean {
  if (value.length > 64) return false;
  if (value.includes("@")) return false;
  if (PHONE_LIKE_PATTERN.test(value)) return false;
  if (STRIPE_LIKE_PATTERN.test(value)) return false;
  if (/^user_[a-zA-Z0-9]+/.test(value)) return false;
  return true;
}

function isSafePagePath(value: string): boolean {
  if (!value.startsWith("/") || value.includes("?")) return false;
  return isSafeStringValue(value);
}

/**
 * Sanitize event payload — drops unsafe keys/values; returns null if nothing safe remains.
 */
export function sanitizeMetaPayload(
  payload: Record<string, unknown> | undefined
): MetaSafePayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const safe: MetaSafePayload = {};

  for (const [key, raw] of Object.entries(payload)) {
    if (!ALLOWED_PAYLOAD_KEYS.has(key)) {
      warnBlocked("dropped_unknown_key", key);
      continue;
    }
    if (DISALLOWED_KEY_PATTERN.test(key)) {
      warnBlocked("dropped_disallowed_key", key);
      continue;
    }
    if (!isSafeScalar(raw)) {
      warnBlocked("dropped_non_scalar", key);
      continue;
    }

    if (typeof raw === "string") {
      if (key === "page_path") {
        if (!isSafePagePath(raw)) {
          warnBlocked("dropped_unsafe_page_path", raw);
          continue;
        }
      } else if (!isSafeStringValue(raw)) {
        warnBlocked("dropped_unsafe_string", { key, raw });
        continue;
      }
    }

    safe[key] = raw;
  }

  return Object.keys(safe).length > 0 ? safe : null;
}

function callFbq(...args: unknown[]): void {
  if (!isMetaPixelEnabled()) return;
  if (typeof window === "undefined") return;
  const fbq = (window as Window & { fbq?: (...args: unknown[]) => void }).fbq;
  if (typeof fbq !== "function") return;
  try {
    (fbq as (...a: unknown[]) => void)(...args);
  } catch {
    /* ignore — pixel must never break the app */
  }
}

function buildSanitizedEventSourceUrl(pagePath: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return `${window.location.origin}${pagePath}`;
  } catch {
    return undefined;
  }
}

function hasDisallowedPayloadKey(payload: Record<string, unknown>): boolean {
  return Object.keys(payload).some(
    (key) => !ALLOWED_PAYLOAD_KEYS.has(key) || DISALLOWED_KEY_PATTERN.test(key)
  );
}

/**
 * Standard Meta events with allowlisted payload only.
 */
export function trackMetaStandard(
  event: MetaStandardEvent,
  payload?: Record<string, unknown>
): void {
  if (payload) {
    if (hasDisallowedPayloadKey(payload)) {
      warnBlocked("event_noop_unsafe_payload", event);
      return;
    }
    const safe = sanitizeMetaPayload(payload);
    if (!safe) {
      warnBlocked("event_noop_unsafe_payload", event);
      return;
    }
    callFbq("track", event, safe);
    return;
  }
  callFbq("track", event);
}

/**
 * Custom Meta events with allowlisted payload only.
 */
export function trackMetaCustom(
  event: MetaCustomEvent,
  payload: Record<string, unknown>
): void {
  if (hasDisallowedPayloadKey(payload)) {
    warnBlocked("custom_event_noop_unsafe_payload", event);
    return;
  }
  const safe = sanitizeMetaPayload(payload);
  if (!safe) {
    warnBlocked("custom_event_noop_unsafe_payload", event);
    return;
  }
  callFbq("trackCustom", event, safe);
}

/**
 * PageView on allowed marketing routes only; pathname-only payload.
 *
 * Meta may still attach the browser document URL unless event_source_url override is
 * honored — sensitive routes are blocked entirely so query tokens are not tracked.
 */
export function trackSafePageView(pathname: string, search: string = ""): void {
  const decision = getMetaPageViewDecision(pathname, search);
  if (decision.action === "block") {
    warnBlocked("pageview_blocked", decision.reason);
    return;
  }

  const payload = sanitizeMetaPayload({ page_path: decision.pagePath });
  if (!payload) return;

  const eventSourceUrl = buildSanitizedEventSourceUrl(decision.pagePath);
  if (eventSourceUrl) {
    // Meta Pixel options bag — may reduce full-URL leakage when supported by fbevents.js.
    callFbq("track", "PageView", payload, { event_source_url: eventSourceUrl });
  } else {
    callFbq("track", "PageView", payload);
  }
}

/** @deprecated Use trackSafePageView via MetaPixelRoot route policy */
export function trackPageView(): void {
  if (typeof window === "undefined") return;
  trackSafePageView(window.location.pathname, window.location.search.replace(/^\?/, ""));
}

export type CoachCtaPlacement =
  | "hero"
  | "kit_section"
  | "footer"
  | "video_page_top"
  | "video_page_bottom";

export function trackCoachCtaClicked(cta: CoachCtaPlacement): void {
  trackMetaCustom("coach_cta_clicked", {
    source: "coach",
    funnel: "coach_leadership_kit",
    cta,
  });
}

export function trackCoachHowItWorksNav(): void {
  trackMetaCustom("coach_how_it_works_nav", {
    source: "coach",
    funnel: "coach_leadership_kit",
  });
}

export type CoachCheckoutPlan = "monthly" | "annual";

export function trackCoachInitiateCheckout(plan: CoachCheckoutPlan): void {
  trackMetaStandard("InitiateCheckout", {
    source: "coach",
    funnel: "coach_leadership_kit",
    plan,
  });
}

export function trackCoachShippingSubmitted(): void {
  trackMetaCustom("coach_shipping_submitted", {
    source: "coach",
    funnel: "coach_leadership_kit",
    status: "success",
  });
}
