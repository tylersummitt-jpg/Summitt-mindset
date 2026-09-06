/**
 * Safe redirect helpers for Clerk afterSignInUrl / afterSignUpUrl.
 * Prevents open redirects while allowing known internal paths.
 */

const SUBSCRIBE_PATH = "/subscribe";

const ALLOWED_FROM = new Set(["onboarding", "post-sign-in", "ask-pat"]);

const INTERNAL_PATH_ALLOWLIST = new Set([
  "/post-sign-in",
  "/onboarding",
  "/onboarding/identity",
  "/onboarding/commitment",
  "/onboarding/review",
  "/onboarding/sms",
  "/onboarding/complete",
  "/subscribe/success",
  "/checkout/start",
  "/ask-pat",
  "/film-room",
  "/dashboard",
  "/dashboard/victory-room",
  "/coach/setup",
  "/coach/complete",
]);

function trimAndRejectSchemes(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("javascript:")
  ) {
    return null;
  }
  if (s.startsWith("//")) return null;
  return s;
}

function parseAsSameOriginPath(s: string): URL | null {
  if (!s.startsWith("/")) return null;
  try {
    const u = new URL(s, "http://local.invalid");
    if (u.username || u.password) return null;
    if (u.pathname.includes("..")) return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * Allows only /subscribe with optional whitelisted query (src=coach, from=*).
 */
export function sanitizeSubscribeRedirectUrl(
  raw: string | null | undefined
): string | null {
  if (raw == null || raw === "") return null;
  const s = trimAndRejectSchemes(raw);
  if (s == null) return null;

  let decoded = s;
  try {
    decoded = decodeURIComponent(s);
  } catch {
    return null;
  }

  const u = parseAsSameOriginPath(decoded);
  if (!u || u.pathname !== SUBSCRIBE_PATH) return null;

  const params = u.searchParams;
  const keys = [...new Set([...params.keys()])].sort();

  for (const key of keys) {
    if (key !== "src" && key !== "from") return null;
  }

  if (params.has("src")) {
    if (params.get("src") !== "coach") return null;
  }
  if (params.has("from")) {
    const v = params.get("from");
    if (!v || !ALLOWED_FROM.has(v)) return null;
  }

  if (keys.length === 0) return SUBSCRIBE_PATH;

  const out = new URLSearchParams();
  if (params.has("from")) out.set("from", params.get("from")!);
  if (params.has("src")) out.set("src", params.get("src")!);
  const q = out.toString();
  return q ? `${SUBSCRIBE_PATH}?${q}` : SUBSCRIBE_PATH;
}

/**
 * True when redirect_url sanitizes to /subscribe with src=coach (coach funnel sign-up/sign-in).
 */
export function isCoachSubscribeRedirectUrl(raw: string | null | undefined): boolean {
  const safe = sanitizeSubscribeRedirectUrl(raw);
  if (!safe || !safe.startsWith("/subscribe")) return false;
  try {
    return new URL(safe, "http://local.invalid").searchParams.get("src") === "coach";
  } catch {
    return false;
  }
}

/**
 * Subscribe-safe URLs plus a tight allowlist of other internal paths (no query).
 */
export function sanitizeInternalRedirectUrl(
  raw: string | null | undefined
): string | null {
  const sub = sanitizeSubscribeRedirectUrl(raw);
  if (sub != null) return sub;

  if (raw == null || raw === "") return null;
  const s = trimAndRejectSchemes(raw);
  if (s == null) return null;

  let decoded = s;
  try {
    decoded = decodeURIComponent(s);
  } catch {
    return null;
  }

  const u = parseAsSameOriginPath(decoded);
  if (!u) return null;

  if (u.search !== "" && u.search !== "?") return null;

  const path = u.pathname;
  if (!INTERNAL_PATH_ALLOWLIST.has(path)) return null;

  return path;
}

/** Sign-up href that keeps a sanitized internal redirect_url (coach, hop, etc.). */
export function signUpUrlPreservingInternalRedirect(
  raw: string | null | undefined
): string {
  const dest = sanitizeInternalRedirectUrl(raw);
  if (!dest) return "/sign-up";
  return `/sign-up?redirect_url=${encodeURIComponent(dest)}`;
}

/** Sign-in href that keeps a sanitized internal redirect_url. */
export function signInUrlPreservingInternalRedirect(
  raw: string | null | undefined
): string {
  const dest = sanitizeInternalRedirectUrl(raw);
  if (!dest) return "/sign-in";
  return `/sign-in?redirect_url=${encodeURIComponent(dest)}`;
}
