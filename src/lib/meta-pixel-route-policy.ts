/**
 * Route policy for Meta PageView — public marketing paths only; default deny.
 */

export type MetaPageViewDecision =
  | { action: "allow"; pagePath: string }
  | { action: "block"; reason: string };

/** Query keys that always block PageView, even on allowed pathnames. */
export const META_DENYLISTED_QUERY_KEYS = [
  "session_id",
  "t",
  "token",
  "userId",
  "user_id",
  "phone",
  "email",
  "stripe",
  "checkout",
  "subscription",
  "clerk",
] as const;

const BLOCKED_PATH_PREFIXES = [
  "/subscribe/success",
  "/onboarding",
  "/dashboard",
  "/ask-pat/",
  "/film-room/",
  "/user",
  "/internal",
  "/pulse",
  "/winback",
  "/post-sign-in",
  "/coach/setup",
] as const;

const BLOCKED_EXACT_PATHS = new Set([
  "/ask-pat",
  "/film-room",
  "/pulse",
  "/winback",
  "/post-sign-in",
  "/coach/setup",
]);

const SENSITIVE_REDIRECT_PATH_PREFIXES = [
  "/internal",
  "/dashboard",
  "/onboarding",
  "/subscribe/success",
  "/pulse",
  "/winback",
  "/coach/setup",
] as const;

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "") return "/";
  const withoutQuery = pathname.split("?")[0] ?? pathname;
  if (withoutQuery.length > 1 && withoutQuery.endsWith("/")) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery;
}

function parseSearchParams(search: string): URLSearchParams {
  if (!search.trim()) return new URLSearchParams();
  const raw = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(raw);
}

function hasDenylistedQueryKey(params: URLSearchParams): string | null {
  for (const key of META_DENYLISTED_QUERY_KEYS) {
    if (params.has(key)) return key;
  }
  return null;
}

function isSensitiveRedirectUrl(value: string): boolean {
  try {
    const decoded = decodeURIComponent(value.trim());
    if (!decoded) return false;
    if (/session_id|(?:^|[?&])t=|(?:^|[?&])token=/i.test(decoded)) {
      return true;
    }
    let path = decoded;
    if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
      path = new URL(decoded).pathname;
    } else if (decoded.startsWith("/")) {
      path = decoded.split("?")[0] ?? decoded;
    } else {
      path = `/${decoded.split("?")[0] ?? decoded}`;
    }
    const normalized = normalizePathname(path);
    for (const prefix of SENSITIVE_REDIRECT_PATH_PREFIXES) {
      if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
        return true;
      }
    }
  } catch {
    return true;
  }
  return false;
}

function hasSensitiveRedirectQuery(params: URLSearchParams): boolean {
  const redirect = params.get("redirect_url");
  if (!redirect) return false;
  return isSensitiveRedirectUrl(redirect);
}

function isBlockedPathname(pathname: string): string | null {
  const path = normalizePathname(pathname);

  if (BLOCKED_EXACT_PATHS.has(path)) {
    return `blocked_path:${path}`;
  }

  for (const prefix of BLOCKED_PATH_PREFIXES) {
    if (path === prefix || path.startsWith(prefix)) {
      return `blocked_prefix:${prefix}`;
    }
  }

  if (
    path === "/ask-pat" ||
    (path.startsWith("/ask-pat/") && !path.startsWith("/ask-pat-preview"))
  ) {
    return "blocked_prefix:/ask-pat";
  }
  if (
    path === "/film-room" ||
    (path.startsWith("/film-room/") && !path.startsWith("/film-room-preview"))
  ) {
    return "blocked_prefix:/film-room";
  }

  return null;
}

function isAllowedMarketingPath(pathname: string): boolean {
  const path = normalizePathname(pathname);

  if (path === "/") return true;
  if (path === "/about") return true;
  if (path === "/subscribe") return true;
  if (path === "/sign-in" || path.startsWith("/sign-in/")) return true;
  if (path === "/sign-up" || path.startsWith("/sign-up/")) return true;
  if (path === "/coach-leadership-kit" || path.startsWith("/coach-leadership-kit/")) {
    return true;
  }
  if (path.startsWith("/pat-summitt")) return true;
  if (path === "/ask-pat-preview" || path.startsWith("/ask-pat-preview/")) {
    return true;
  }
  if (path === "/film-room-preview" || path.startsWith("/film-room-preview/")) {
    return true;
  }
  if (path === "/privacy" || path === "/terms" || path === "/sms") return true;

  return false;
}

/**
 * Whether Meta PageView may fire for this browser route.
 */
export function getMetaPageViewDecision(
  pathname: string,
  search: string = ""
): MetaPageViewDecision {
  const pagePath = normalizePathname(pathname);
  const params = parseSearchParams(search);

  const deniedKey = hasDenylistedQueryKey(params);
  if (deniedKey) {
    return { action: "block", reason: `denylisted_query:${deniedKey}` };
  }

  if (hasSensitiveRedirectQuery(params)) {
    return { action: "block", reason: "sensitive_redirect_url" };
  }

  const blocked = isBlockedPathname(pagePath);
  if (blocked) {
    return { action: "block", reason: blocked };
  }

  if (!isAllowedMarketingPath(pagePath)) {
    return { action: "block", reason: "unknown_route" };
  }

  return { action: "allow", pagePath };
}
