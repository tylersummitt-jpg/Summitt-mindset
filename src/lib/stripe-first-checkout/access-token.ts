import { createHmac, timingSafeEqual } from "node:crypto";

export function signHostedTestAccess(expiresAtMs: number, secret: string): string {
  const payload = String(expiresAtMs);
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function hostedTestAccessIsValid(
  token: string | undefined,
  secret: string,
  nowMs: number
): boolean {
  if (!token || !secret) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!/^\d+$/.test(payload) || !mac) return false;
  const expiresAtMs = Number(payload);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function hostedTestAccessCookieIsValid(
  token: string | undefined,
  secret: string
): boolean {
  return hostedTestAccessIsValid(token, secret, Date.now());
}
