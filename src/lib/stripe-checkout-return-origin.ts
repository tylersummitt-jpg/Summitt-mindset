/**
 * Trusted origin for Stripe Checkout success_url / cancel_url.
 * Never interpolates an unallowlisted hostname into Stripe return URLs.
 */

export const CHECKOUT_RETURN_FALLBACK_ORIGIN = "https://summittmindset.com";

const PRODUCTION_ORIGINS = new Set([
  "https://summittmindset.com",
  "https://www.summittmindset.com",
]);

const DEVELOPMENT_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function previewAllowlistedOrigin(): string | null {
  if (process.env.VERCEL_ENV !== "preview") return null;
  const raw = process.env.VERCEL_URL?.trim() ?? "";
  if (!raw) return null;
  if (/[/,\s@]/.test(raw)) return null;
  return `https://${raw}`;
}

export function isAllowedCheckoutReturnOrigin(origin: string): boolean {
  if (PRODUCTION_ORIGINS.has(origin)) return true;
  if (process.env.NODE_ENV !== "production" && DEVELOPMENT_ORIGINS.has(origin)) {
    return true;
  }
  const preview = previewAllowlistedOrigin();
  return preview != null && origin === preview;
}

function forwardedHostCandidate(raw: string | null): string | null {
  if (raw == null) return null;
  const host = raw.trim();
  if (!host) return null;
  if (host.includes(",") || host.includes("/") || host.includes("@") || /\s/.test(host)) {
    return null;
  }
  return host;
}

function forwardedProtoCandidate(raw: string | null): "http" | "https" | null {
  if (raw == null || raw.trim() === "") {
    if (process.env.NODE_ENV === "production") return "https";
    return null;
  }
  const proto = raw.trim().toLowerCase();
  if (proto === "http" || proto === "https") return proto;
  return null;
}

function originFromParts(proto: string, host: string): string | null {
  try {
    const url = new URL(`${proto}://${host}`);
    if (url.username || url.password) return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function originFromAppUrlEnv(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.username || url.password) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    if (url.search || url.hash) return null;
    if (!isAllowedCheckoutReturnOrigin(url.origin)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Resolve the Stripe return origin from the Checkout create request.
 * Prefers allowlisted x-forwarded-host + proto; never uses raw Origin.
 */
export function resolveStripeCheckoutReturnOrigin(req: Request): string {
  const host = forwardedHostCandidate(req.headers.get("x-forwarded-host"));
  const proto = forwardedProtoCandidate(req.headers.get("x-forwarded-proto"));
  if (host && proto) {
    const candidate = originFromParts(proto, host);
    if (candidate && isAllowedCheckoutReturnOrigin(candidate)) {
      return candidate;
    }
  }

  try {
    const fromUrl = new URL(req.url).origin;
    if (isAllowedCheckoutReturnOrigin(fromUrl)) return fromUrl;
  } catch {
    // ignore invalid request URL
  }

  const fromEnv = originFromAppUrlEnv(process.env.NEXT_PUBLIC_APP_URL);
  if (fromEnv) return fromEnv;

  return CHECKOUT_RETURN_FALLBACK_ORIGIN;
}
