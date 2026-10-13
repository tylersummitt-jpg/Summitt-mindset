import { createHash, randomBytes } from "node:crypto";

export function newCheckoutBinding(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  return { secret, hash: hashCheckoutBinding(secret) };
}

export function hashCheckoutBinding(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * The browser cookie, the stored checkout, and the retrieved Stripe session
 * must all name the same intent. A copied success URL has no cookie.
 * A swapped session id fails this check.
 */
export function checkoutSessionBindingMatches(args: {
  requestedSessionId: string;
  storedSessionId: string | null;
  retrievedSessionId: string;
  retrievedIntentId: string | null;
  intentId: string;
}): boolean {
  if (!args.requestedSessionId || !args.storedSessionId) return false;
  if (args.requestedSessionId !== args.storedSessionId) return false;
  if (args.retrievedSessionId !== args.storedSessionId) return false;
  if (!args.retrievedIntentId) return false;
  return args.retrievedIntentId === args.intentId;
}
