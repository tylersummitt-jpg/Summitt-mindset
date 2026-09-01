/**
 * Pure first-touch attribution, marketing route allowlist, and cookie payload
 * helpers. No I/O. Safe to import from middleware, client, and tests.
 */

export const SM_VISITOR_COOKIE = "sm_visitor";
export const SM_ACQ_COOKIE = "sm_acq";
export const SM_COOKIE_MAX_AGE_SEC = 90 * 24 * 60 * 60;
export const SM_ACQ_VERSION = 1 as const;

export type SourceNormalized =
  | "direct"
  | "organic_social"
  | "meta"
  | "google"
  | "referral";

export type SourceDetail = "coach" | null;

export type AcquisitionTouch = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  gclid_present: boolean;
  fbclid_present: boolean;
  referrer_host: string | null;
  source_normalized: SourceNormalized;
  is_paid_acquisition: boolean;
  source_detail: SourceDetail;
};

export type AcquisitionCookiePayload = AcquisitionTouch & {
  v: typeof SM_ACQ_VERSION;
  first_touch_at: string;
};

export const CTA_SURFACES = [
  "navbar",
  "hero",
  "preview",
  "gate",
  "quote_page",
  "film_card",
  "coach",
  "other",
] as const;

export type CtaSurface = (typeof CTA_SURFACES)[number];

const PAID_MEDIUMS = new Set([
  "cpc",
  "ppc",
  "paid",
  "ads",
  "paidsocial",
  "paid_social",
  "cpm",
  "cpa",
  "display",
]);

const META_SOURCES = new Set([
  "fb",
  "facebook",
  "ig",
  "instagram",
  "meta",
  "an",
  "facebook_ads",
  "ig_ads",
  "meta_ads",
]);

const ORGANIC_SOCIAL_HOSTS = new Set([
  "instagram.com",
  "facebook.com",
  "l.facebook.com",
  "lm.facebook.com",
  "m.facebook.com",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "t.co",
  "linkedin.com",
  "lnkd.in",
  "youtube.com",
  "youtu.be",
  "m.youtube.com",
]);

const SELF_HOST_EXACT = new Set([
  "summittmindset.com",
  "www.summittmindset.com",
  "localhost",
  "127.0.0.1",
]);

export function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "") return "/";
  const withoutQuery = pathname.split("?")[0] ?? pathname;
  if (withoutQuery.length > 1 && withoutQuery.endsWith("/")) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery;
}

export function isMarketingPageViewPath(pathname: string): boolean {
  const path = normalizePathname(pathname);

  if (path === "/subscribe/success" || path.startsWith("/subscribe/success/")) {
    return false;
  }
  if (path === "/sign-in" || path.startsWith("/sign-in/")) return false;
  if (path === "/sign-up" || path.startsWith("/sign-up/")) return false;
  if (path === "/app/sign-in" || path.startsWith("/app/sign-in/")) return false;
  if (path === "/onboarding" || path.startsWith("/onboarding/")) return false;
  if (path === "/dashboard" || path.startsWith("/dashboard/")) return false;
  if (path === "/ask-pat" || (path.startsWith("/ask-pat/") && !path.startsWith("/ask-pat-preview"))) {
    return false;
  }
  if (
    path === "/film-room" ||
    (path.startsWith("/film-room/") && !path.startsWith("/film-room-preview"))
  ) {
    return false;
  }
  if (path === "/user" || path.startsWith("/user/")) return false;
  if (path === "/admin" || path.startsWith("/admin/")) return false;
  if (path === "/internal" || path.startsWith("/internal/")) return false;
  if (path === "/post-sign-in" || path.startsWith("/post-sign-in/")) return false;
  if (path === "/pulse" || path.startsWith("/pulse/")) return false;
  if (path === "/winback" || path.startsWith("/winback/")) return false;
  if (path === "/cancel" || path.startsWith("/cancel/")) return false;
  if (path === "/rescue" || path.startsWith("/rescue/")) return false;
  if (path === "/privacy" || path === "/terms" || path === "/data-deletion") return false;
  if (path === "/sms" || path === "/twilio" || path === "/support") return false;
  if (path === "/app/membership" || path.startsWith("/app/membership/")) return false;

  if (path === "/") return true;
  if (path === "/about") return true;
  if (path === "/daily-practice") return true;
  if (path === "/ask-pat-preview" || path.startsWith("/ask-pat-preview/")) return true;
  if (path === "/film-room-preview" || path.startsWith("/film-room-preview/")) return true;
  if (path === "/subscribe") return true;
  if (path === "/coach-leadership-kit" || path.startsWith("/coach-leadership-kit/")) {
    return true;
  }
  if (path.startsWith("/pat-summitt")) return true;
  if (path === "/challenge" || path.startsWith("/challenge/")) return true;
  return false;
}

export function isCoachMarketingPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return path === "/coach-leadership-kit" || path.startsWith("/coach-leadership-kit/");
}

function trimToNull(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 ? t.slice(0, 200) : null;
}

function lower(raw: string | null | undefined): string | null {
  const t = trimToNull(raw);
  return t ? t.toLowerCase() : null;
}

export function referrerHostFromHeader(referrer: string | null | undefined): string | null {
  const raw = trimToNull(referrer);
  if (!raw) return null;
  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

export function isSelfReferrerHost(host: string | null): boolean {
  if (!host) return false;
  if (SELF_HOST_EXACT.has(host)) return true;
  if (host.endsWith(".summittmindset.com")) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  return false;
}

function isPaidMedium(medium: string | null): boolean {
  if (!medium) return false;
  return PAID_MEDIUMS.has(medium);
}

function isMetaSource(source: string | null): boolean {
  if (!source) return false;
  return META_SOURCES.has(source);
}

function isGoogleSource(source: string | null): boolean {
  if (!source) return false;
  return source === "google" || source === "googleads" || source === "adwords";
}

function isGoogleHost(host: string | null): boolean {
  if (!host) return false;
  return host === "google.com" || host.startsWith("google.") || host.endsWith(".google.com");
}

function isOrganicSocialHost(host: string | null): boolean {
  if (!host) return false;
  if (ORGANIC_SOCIAL_HOSTS.has(host)) return true;
  for (const known of ORGANIC_SOCIAL_HOSTS) {
    if (host.endsWith(`.${known}`)) return true;
  }
  return false;
}

export type NormalizeAcquisitionInput = {
  pathname?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
  referrer?: string | null;
  coachCookie?: string | null;
};

export function normalizeAcquisition(input: NormalizeAcquisitionInput): AcquisitionTouch {
  const utm_source = lower(input.utm_source);
  const utm_medium = lower(input.utm_medium);
  const utm_campaign = trimToNull(input.utm_campaign);
  const utm_content = trimToNull(input.utm_content);
  const gclid_present = Boolean(trimToNull(input.gclid));
  const fbclid_present = Boolean(trimToNull(input.fbclid));
  const rawHost = referrerHostFromHeader(input.referrer);
  const referrer_host = rawHost && !isSelfReferrerHost(rawHost) ? rawHost : null;
  const coachCookie = trimToNull(input.coachCookie)?.toLowerCase() === "coach";
  const coachPath = isCoachMarketingPath(input.pathname ?? "");

  if (coachCookie || coachPath) {
    return {
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      gclid_present,
      fbclid_present,
      referrer_host,
      source_normalized: "referral",
      is_paid_acquisition: false,
      source_detail: "coach",
    };
  }

  const metaPaid =
    fbclid_present ||
    (utm_source != null &&
      (utm_source === "facebook_ads" ||
        utm_source === "ig_ads" ||
        utm_source === "meta_ads" ||
        utm_source === "an")) ||
    (isMetaSource(utm_source) && isPaidMedium(utm_medium));

  if (metaPaid) {
    return {
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      gclid_present,
      fbclid_present,
      referrer_host,
      source_normalized: "meta",
      is_paid_acquisition: true,
      source_detail: null,
    };
  }

  const googlePaid =
    gclid_present ||
    (isGoogleSource(utm_source) && isPaidMedium(utm_medium)) ||
    (utm_medium === "cpc" && (isGoogleSource(utm_source) || !utm_source));

  if (googlePaid) {
    return {
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      gclid_present,
      fbclid_present,
      referrer_host,
      source_normalized: "google",
      is_paid_acquisition: true,
      source_detail: null,
    };
  }

  if (
    isOrganicSocialHost(referrer_host) ||
    (utm_source &&
      ["instagram", "facebook", "ig", "fb", "tiktok", "twitter", "x", "linkedin", "youtube"].includes(
        utm_source
      ) &&
      !isPaidMedium(utm_medium))
  ) {
    return {
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      gclid_present,
      fbclid_present,
      referrer_host,
      source_normalized: "organic_social",
      is_paid_acquisition: false,
      source_detail: null,
    };
  }

  if (isGoogleHost(referrer_host) || (utm_source === "google" && !isPaidMedium(utm_medium))) {
    return {
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      gclid_present,
      fbclid_present,
      referrer_host,
      source_normalized: "google",
      is_paid_acquisition: false,
      source_detail: null,
    };
  }

  if (referrer_host) {
    return {
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      gclid_present,
      fbclid_present,
      referrer_host,
      source_normalized: "referral",
      is_paid_acquisition: false,
      source_detail: null,
    };
  }

  return {
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    gclid_present,
    fbclid_present,
    referrer_host,
    source_normalized: "direct",
    is_paid_acquisition: false,
    source_detail: null,
  };
}

export function isPureDirectTouch(touch: AcquisitionTouch): boolean {
  return (
    touch.source_normalized === "direct" &&
    !touch.is_paid_acquisition &&
    touch.source_detail == null &&
    !touch.utm_source &&
    !touch.utm_medium &&
    !touch.utm_campaign &&
    !touch.utm_content &&
    !touch.gclid_present &&
    !touch.fbclid_present &&
    !touch.referrer_host
  );
}

export function isMeaningfulTouch(touch: AcquisitionTouch): boolean {
  return !isPureDirectTouch(touch);
}

/**
 * First-touch merge. Existing meaningful attribution is never overwritten.
 * Pure Direct may upgrade to a later qualifying source before account linkage.
 */
export function mergeFirstTouch(
  existing: AcquisitionCookiePayload | null,
  incoming: AcquisitionTouch,
  nowIso: string
): AcquisitionCookiePayload {
  if (!existing) {
    return { v: SM_ACQ_VERSION, first_touch_at: nowIso, ...incoming };
  }
  if (isPureDirectTouch(existing) && isMeaningfulTouch(incoming)) {
    return { v: SM_ACQ_VERSION, first_touch_at: nowIso, ...incoming };
  }
  return existing;
}

export function parseAcquisitionCookie(
  raw: string | null | undefined
): AcquisitionCookiePayload | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded) as Partial<AcquisitionCookiePayload>;
    if (parsed.v !== 1) return null;
    if (
      parsed.source_normalized !== "direct" &&
      parsed.source_normalized !== "organic_social" &&
      parsed.source_normalized !== "meta" &&
      parsed.source_normalized !== "google" &&
      parsed.source_normalized !== "referral"
    ) {
      return null;
    }
    if (typeof parsed.first_touch_at !== "string") return null;
    return {
      v: 1,
      first_touch_at: parsed.first_touch_at,
      utm_source: parsed.utm_source ?? null,
      utm_medium: parsed.utm_medium ?? null,
      utm_campaign: parsed.utm_campaign ?? null,
      utm_content: parsed.utm_content ?? null,
      gclid_present: parsed.gclid_present === true,
      fbclid_present: parsed.fbclid_present === true,
      referrer_host: parsed.referrer_host ?? null,
      source_normalized: parsed.source_normalized,
      is_paid_acquisition: parsed.is_paid_acquisition === true,
      source_detail: parsed.source_detail === "coach" ? "coach" : null,
    };
  } catch {
    return null;
  }
}

export function serializeAcquisitionCookie(payload: AcquisitionCookiePayload): string {
  return encodeURIComponent(JSON.stringify(payload));
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isVisitorId(raw: string | null | undefined): raw is string {
  return typeof raw === "string" && UUID_RE.test(raw);
}

export function parseSearchParamsRecord(
  search: string | URLSearchParams
): {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  gclid: string | null;
  fbclid: string | null;
} {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search;
  return {
    utm_source: params.get("utm_source"),
    utm_medium: params.get("utm_medium"),
    utm_campaign: params.get("utm_campaign"),
    utm_content: params.get("utm_content"),
    gclid: params.get("gclid"),
    fbclid: params.get("fbclid"),
  };
}

export function allowlistedCtaSurface(raw: unknown): CtaSurface | null {
  if (typeof raw !== "string") return null;
  return (CTA_SURFACES as readonly string[]).includes(raw) ? (raw as CtaSurface) : null;
}

export function isTrialAcquisitionHref(href: string): boolean {
  if (!href || typeof href !== "string") return false;
  try {
    const url = href.startsWith("http://") || href.startsWith("https://")
      ? new URL(href)
      : new URL(href, "https://summittmindset.com");
    const path = normalizePathname(url.pathname);
    if (path === "/app/sign-in" || path.startsWith("/app/sign-in/")) return false;
    if (path === "/app/membership" || path.startsWith("/app/membership/")) return false;
    if (path === "/sign-in" || path.startsWith("/sign-in/")) return false;
    if (path === "/subscribe/success") return false;
    if (path === "/subscribe") return true;
    if (path === "/sign-up" || path.startsWith("/sign-up/")) {
      const redirect = url.searchParams.get("redirect_url");
      if (!redirect) return false;
      let decoded = redirect;
      try {
        decoded = decodeURIComponent(redirect);
      } catch {
        decoded = redirect;
      }
      const inner = decoded.startsWith("http://") || decoded.startsWith("https://")
        ? new URL(decoded)
        : new URL(decoded.startsWith("/") ? decoded : `/${decoded}`, "https://summittmindset.com");
      return normalizePathname(inner.pathname) === "/subscribe";
    }
    return false;
  } catch {
    return false;
  }
}

export function trialCtaSurfaceFromHref(
  href: string,
  pathname: string | null
): CtaSurface {
  if (isCoachMarketingPath(pathname ?? "") || href.includes("src=coach")) {
    return "coach";
  }
  const path = normalizePathname(pathname ?? "");
  if (path === "/") return "hero";
  if (path.startsWith("/ask-pat-preview") || path.startsWith("/film-room-preview")) {
    return "preview";
  }
  if (path.startsWith("/pat-summitt")) return "quote_page";
  return "other";
}

export function marketingCookieOptions(isProduction: boolean): {
  path: string;
  maxAge: number;
  sameSite: "lax";
  secure: boolean;
  httpOnly: boolean;
} {
  return {
    path: "/",
    maxAge: SM_COOKIE_MAX_AGE_SEC,
    sameSite: "lax",
    secure: isProduction,
    httpOnly: true,
  };
}

/**
 * Resolve sm_visitor + sm_acq for an allowlisted marketing request.
 * Returns null when the path is not a marketing observation page (no cookies).
 */
export function resolveMarketingCookies(args: {
  pathname: string;
  search?: string;
  referrer?: string | null;
  coachCookie?: string | null;
  existingVisitor?: string | null;
  existingAcqRaw?: string | null;
  nowIso: string;
  generatedVisitorId: string;
}): { visitorId: string; payload: AcquisitionCookiePayload } | null {
  if (!isMarketingPageViewPath(args.pathname)) return null;
  const visitorId = isVisitorId(args.existingVisitor)
    ? args.existingVisitor
    : args.generatedVisitorId;
  if (!isVisitorId(visitorId)) return null;
  const params = parseSearchParamsRecord(args.search ?? "");
  const incoming = normalizeAcquisition({
    pathname: args.pathname,
    utm_source: params.utm_source,
    utm_medium: params.utm_medium,
    utm_campaign: params.utm_campaign,
    utm_content: params.utm_content,
    gclid: params.gclid,
    fbclid: params.fbclid,
    referrer: args.referrer ?? null,
    coachCookie: args.coachCookie ?? null,
  });
  const existing = parseAcquisitionCookie(args.existingAcqRaw);
  return {
    visitorId,
    payload: mergeFirstTouch(existing, incoming, args.nowIso),
  };
}

export type DashboardTrafficSource =
  | "all"
  | "direct"
  | "organic_social"
  | "meta_ads"
  | "google"
  | "referral";

export function dashboardSourceToNormalized(
  source: DashboardTrafficSource
): SourceNormalized | "all" {
  if (source === "all") return "all";
  if (source === "meta_ads") return "meta";
  return source;
}

export function attributionMatchesDashboardSource(
  sourceNormalized: string | null | undefined,
  filter: DashboardTrafficSource
): boolean {
  if (filter === "all") return true;
  const wanted = dashboardSourceToNormalized(filter);
  return sourceNormalized === wanted;
}
