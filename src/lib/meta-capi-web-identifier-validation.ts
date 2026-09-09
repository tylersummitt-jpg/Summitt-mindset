/**
 * Untrusted visitor-input sanitizers for Meta CAPI match identifiers.
 * Pure. No I/O. Never log the values.
 */

export const META_FBCLID_MAX_LEN = 512;
export const META_FBC_MAX_LEN = 640;
export const META_FBP_MAX_LEN = 128;
export const META_CLIENT_UA_MAX_LEN = 1024;
export const META_CLIENT_IP_MAX_LEN = 45;

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export function sanitizeMetaFbclid(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > META_FBCLID_MAX_LEN) return null;
  if (CONTROL_CHARS.test(trimmed)) return null;
  if (trimmed.includes("@") || trimmed.includes(" ")) return null;
  if (!/^[A-Za-z0-9._~-]+$/.test(trimmed)) return null;
  return trimmed;
}

export function sanitizeMetaFbc(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > META_FBC_MAX_LEN) return null;
  if (CONTROL_CHARS.test(trimmed)) return null;
  const match = /^fb\.([0-9]+)\.([0-9]+)\.(.+)$/.exec(trimmed);
  if (!match) return null;
  const creationTime = match[2];
  const fbclid = sanitizeMetaFbclid(match[3]);
  if (!creationTime || !/^[0-9]+$/.test(creationTime) || !fbclid) return null;
  return `fb.${match[1]}.${creationTime}.${fbclid}`;
}

export function sanitizeMetaFbp(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > META_FBP_MAX_LEN) return null;
  if (CONTROL_CHARS.test(trimmed)) return null;
  if (!/^fb\.[0-9]+\.[0-9]+\.[0-9]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Meta-documented fbc construction from a REAL fbclid:
 * fb.{subdomainIndex}.{creationTimeMs}.{fbclid}
 * Server-side without saving _fbc uses subdomainIndex 1.
 * creationTime is the unix ms when that fbclid was first observed — never webhook now.
 */
export function constructFbcFromRealFbclid(
  fbclid: string,
  observedAtIso: string
): string | null {
  const id = sanitizeMetaFbclid(fbclid);
  if (!id) return null;
  if (typeof observedAtIso !== "string" || !observedAtIso.trim()) return null;
  const ms = Date.parse(observedAtIso);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return sanitizeMetaFbc(`fb.1.${Math.floor(ms)}.${id}`);
}

export function sanitizeMetaClientUserAgent(
  raw: string | null | undefined
): string | null {
  if (typeof raw !== "string") return null;
  let out = "";
  for (let i = 0; i < raw.length && out.length < META_CLIENT_UA_MAX_LEN; i += 1) {
    const code = raw.charCodeAt(i);
    if (code === 9 || code === 32 || (code > 31 && code !== 127)) {
      out += raw[i];
    }
  }
  const trimmed = out.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function ipv4Octets(raw: string): number[] | null {
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    if (part.length > 1 && part.startsWith("0")) return null;
    octets.push(n);
  }
  return octets;
}

function isPublicIpv4(raw: string): boolean {
  const o = ipv4Octets(raw);
  if (!o) return false;
  if (o[0] === 0 || o[0] === 127 || o[0] === 10) return false;
  if (o[0] === 169 && o[1] === 254) return false;
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return false;
  if (o[0] === 192 && o[1] === 168) return false;
  if (o[0] === 255 && o[1] === 255 && o[2] === 255 && o[3] === 255) return false;
  if (o[0] >= 224) return false;
  return true;
}

function expandIpv6(raw: string): number[] | null {
  const lower = raw.trim().toLowerCase();
  if (!lower || lower.length > META_CLIENT_IP_MAX_LEN) return null;
  if (lower.includes(".")) {
    const lastColon = lower.lastIndexOf(":");
    if (lastColon < 0) return null;
    const v4 = lower.slice(lastColon + 1);
    const v4o = ipv4Octets(v4);
    if (!v4o) return null;
    const head = lower.slice(0, lastColon + 1);
    const mapped = `${head}${((v4o[0] << 8) | v4o[1]).toString(16)}:${((v4o[2] << 8) | v4o[3]).toString(16)}`;
    return expandIpv6(mapped);
  }
  if ((lower.match(/::/g) || []).length > 1) return null;
  const halves = lower.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1) {
    if (left.length !== 8) return null;
  } else {
    if (left.length + right.length >= 8) return null;
  }
  const groups = halves.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8) return null;
  const nums: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    nums.push(parseInt(g, 16));
  }
  return nums;
}

function isPublicIpv6(raw: string): boolean {
  const n = expandIpv6(raw);
  if (!n) return false;
  const allZero = n.every((x) => x === 0);
  if (allZero) return false;
  if (n[0] === 0 && n[1] === 0 && n[2] === 0 && n[3] === 0 && n[4] === 0 && n[5] === 0 && n[6] === 0 && n[7] === 1) {
    return false;
  }
  // IPv4-mapped / translated
  if (n[0] === 0 && n[1] === 0 && n[2] === 0 && n[3] === 0 && n[4] === 0 && (n[5] === 0xffff || n[5] === 0)) {
    const a = (n[6] >> 8) & 0xff;
    const b = n[6] & 0xff;
    const c = (n[7] >> 8) & 0xff;
    const d = n[7] & 0xff;
    return isPublicIpv4(`${a}.${b}.${c}.${d}`);
  }
  const top = n[0];
  if ((top & 0xfe00) === 0xfc00) return false; // unique local
  if ((top & 0xffc0) === 0xfe80) return false; // link-local
  if ((top & 0xff00) === 0xff00) return false; // multicast
  return true;
}

export function sanitizeMetaClientIp(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > META_CLIENT_IP_MAX_LEN) return null;
  if (CONTROL_CHARS.test(trimmed) || trimmed.includes(" ")) return null;
  if (isPublicIpv4(trimmed) || isPublicIpv6(trimmed)) return trimmed;
  return null;
}

function firstHeaderValue(raw: string | null): string | null {
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim() ?? "";
  return first || null;
}

/**
 * Vercel-trusted client IP. Prefer platform headers, then first public
 * X-Forwarded-For hop. Never returns loopback/private/link-local.
 */
export function clientIpFromRequestHeaders(headers: {
  get(name: string): string | null;
}): string | null {
  const vercelForwarded = sanitizeMetaClientIp(
    firstHeaderValue(headers.get("x-vercel-forwarded-for"))
  );
  if (vercelForwarded) return vercelForwarded;

  const realIp = sanitizeMetaClientIp(firstHeaderValue(headers.get("x-real-ip")));
  if (realIp) return realIp;

  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;
  for (const part of forwarded.split(",")) {
    const candidate = sanitizeMetaClientIp(part.trim());
    if (candidate) return candidate;
  }
  return null;
}

export function parseCookieMap(cookieHeader: string | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!cookieHeader) return map;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    let value = part.slice(idx + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep raw */
    }
    if (key) map.set(key, value);
  }
  return map;
}
