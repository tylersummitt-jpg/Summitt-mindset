/**
 * APP-041F2 — server-side account-deletion reauthentication boundary.
 *
 * Production uses Clerk session `has({ reverification: "strict" })`.
 * Tests inject allow/deny verifiers into the initiation core.
 *
 * Fail-closed: missing `has`, thrown errors, or failed checks never allow
 * initiation. Does not invent password/OTP flows.
 */

import "server-only";

import type { AccountDeletionReauthVerificationResult } from "./run-account-deletion-initiation";

/** Clerk-compatible minimal shape used by the production verifier. */
export type AccountDeletionClerkReverificationHas = (params: {
  reverification: "strict";
}) => boolean;

/**
 * Production verifier: require Clerk strict reverification on the session.
 * Never defaults to allow.
 */
export function verifyAccountDeletionReauthenticationWithClerk(
  has: AccountDeletionClerkReverificationHas | null | undefined
): AccountDeletionReauthVerificationResult {
  if (typeof has !== "function") {
    return { ok: false, code: "reauth_unavailable" };
  }
  try {
    if (has({ reverification: "strict" })) {
      return { ok: true };
    }
    return { ok: false, code: "reauth_required" };
  } catch {
    return { ok: false, code: "reauth_unavailable" };
  }
}
