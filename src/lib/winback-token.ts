import crypto from "crypto";

type WinbackTokenPayload = {
  clerk_user_id: string;
  exp: number; // unix seconds
};

function getSecret(): string {
  const s = process.env.WINBACK_TOKEN_SECRET;
  if (!s) {
    throw new Error("Missing WINBACK_TOKEN_SECRET");
  }
  return s;
}

function base64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecode(input: string): Buffer {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, "base64");
}

function sign(data: string, secret: string): string {
  return base64urlEncode(crypto.createHmac("sha256", secret).update(data).digest());
}

export function createWinbackToken(args: {
  clerk_user_id: string;
  ttlDays?: number;
}): string {
  const ttlDays = typeof args.ttlDays === "number" ? args.ttlDays : 21; // generous
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60;

  const payload: WinbackTokenPayload = {
    clerk_user_id: args.clerk_user_id,
    exp,
  };

  const payloadStr = JSON.stringify(payload);
  const payloadB64 = base64urlEncode(Buffer.from(payloadStr, "utf8"));

  const secret = getSecret();
  const sig = sign(payloadB64, secret);

  // token format: <payloadB64>.<sig>
  return `${payloadB64}.${sig}`;
}

export function verifyWinbackToken(token: string): {
  ok: true;
  clerk_user_id: string;
} | { ok: false; reason: string } {
  try {
    const secret = getSecret();

    const parts = token.split(".");
    if (parts.length !== 2) return { ok: false, reason: "bad_format" };

    const [payloadB64, sig] = parts;

    const expected = sign(payloadB64, secret);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);

    // constant-time compare
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: "bad_signature" };
    }

    const payloadJson = base64urlDecode(payloadB64).toString("utf8");
    const payload = JSON.parse(payloadJson) as WinbackTokenPayload;

    if (!payload?.clerk_user_id || typeof payload.clerk_user_id !== "string") {
      return { ok: false, reason: "missing_user" };
    }

    if (!payload?.exp || typeof payload.exp !== "number") {
      return { ok: false, reason: "missing_exp" };
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return { ok: false, reason: "expired" };
    }

    return { ok: true, clerk_user_id: payload.clerk_user_id };
  } catch (e: any) {
    return { ok: false, reason: e?.message || "verify_failed" };
  }
}
