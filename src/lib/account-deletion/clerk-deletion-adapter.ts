/**
 * APP-041D1 — Clerk deletion adapter contract (server-only).
 *
 * Narrow boundary for irreversible Clerk user deletion LAST in the deletion
 * pipeline. APP-041D1 ships the contract + injected fakes only.
 *
 * Do NOT wire a real Clerk SDK client, users.deleteUser production call,
 * Clerk REST endpoint, production adapter, or expose email/phone/metadata/
 * sessions/tokens/raw bodies in this slice.
 */

import "server-only";

export type ClerkDeletionOutcome =
  | "deleted"
  | "already_absent"
  | "retryable_error"
  | "terminal_error";

export type ClerkDeletionResult = {
  outcome: ClerkDeletionOutcome;
  /** Short internal operational code only (never PII / raw provider text). */
  code?: string;
};

export type ClerkDeletionAdapter = {
  deleteUser(input: { clerkUserId: string }): Promise<ClerkDeletionResult>;
};

/** Test helper: build an injected adapter with a fixed outcome. */
export function createFixedClerkDeletionAdapter(
  result: ClerkDeletionResult
): ClerkDeletionAdapter {
  return {
    async deleteUser() {
      return result;
    },
  };
}
