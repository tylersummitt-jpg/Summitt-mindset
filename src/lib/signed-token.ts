import crypto from "crypto";

/**
 * ======================================================
 * Signed Token Utilities (CANONICAL)
 * ======================================================
 *
 * Used for:
 * - winback links
 * - rescue links
 * - day4-5 pulse links
 *
 * We do NOT use JWT libs.
 * We use a compact signed JSON payload.
 */

function base64urlEncode(input: Buffer | string) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return b
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64urlDecode(input: string) {
  const pad = input.length % 4;
  const padded = input + (pad ? "=".repeat(4 - pad) : "");
  const base64 = padded.replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

function hmac(secret: string, data: string) {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

export function signToken(payload: Record<string, any>, secret: string): string {
  const json = JSON.stringify(payload);
  const body = base64urlEncode(json);
  const sig = hmac(secret, body);
  return `${body}.${sig}`;
}

export function verifyToken<T = any>(
  token: string,
  secret: string
): { ok: true; payload: T } | { ok: false; reason: string } {
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "missing_token" };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { ok: false, reason: "invalid_format" };
  }

  const [body, sig] = parts;

  const expected = hmac(secret, body);

  // timing-safe compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);

  if (a.length !== b.length) {
    return { ok: false, reason: "bad_signature" };
  }

  if (!crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  try {
    const decoded = base64urlDecode(body);
    const payload = JSON.parse(decoded);
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }
}
