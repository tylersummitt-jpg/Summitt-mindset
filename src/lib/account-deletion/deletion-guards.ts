/**
 * APP-041 deletion-aware guards.
 *
 * B2a: unresolved rows (status <> completed) block SMS re-enable.
 * B3b: any deletion row (including completed) blocks entitlement restoration
 * so late webhooks cannot unlock a user who still exists after deletion
 * finished or while deletion is in progress.
 *
 * Completed rows intentionally block late restoration. Failed/stuck rows can
 * also block membership management until a future admin recovery/cleanup path
 * exists (out of scope for B3b).
 */

import "server-only";

import {
  getAnyAccountDeletionRequestForUser,
  getUnresolvedAccountDeletionRequestForUser,
} from "./repository";

export async function hasUnresolvedAccountDeletionRequest(
  clerkUserId: string
): Promise<boolean> {
  const trimmed = clerkUserId.trim();
  if (!trimmed) return false;
  const row = await getUnresolvedAccountDeletionRequestForUser(trimmed);
  return row != null;
}

/** Neutral user-facing conflict body for HTTP routes (no internals). */
export const ACCOUNT_DELETION_IN_PROGRESS_BODY = {
  error: "account_deletion_in_progress",
  message: "This action is unavailable.",
} as const;

export type EntitlementRestorationDecision =
  | { decision: "allowed" }
  | {
      decision: "blocked_due_to_deletion";
      /** unresolved includes failed_retryable / failed_terminal / in-flight steps */
      scope: "unresolved" | "completed";
    }
  | { decision: "lookup_failed" };

/**
 * Whether Clerk entitlement / checkout / resume unlock writes are allowed.
 * Fail closed on lookup errors (decision: lookup_failed).
 */
export async function evaluateEntitlementRestorationForAccountDeletion(
  clerkUserId: string
): Promise<EntitlementRestorationDecision> {
  const trimmed = clerkUserId.trim();
  if (!trimmed) {
    return { decision: "allowed" };
  }
  try {
    const row = await getAnyAccountDeletionRequestForUser(trimmed);
    if (!row) return { decision: "allowed" };
    if (row.status === "completed") {
      return { decision: "blocked_due_to_deletion", scope: "completed" };
    }
    return { decision: "blocked_due_to_deletion", scope: "unresolved" };
  } catch {
    return { decision: "lookup_failed" };
  }
}

/**
 * HTTP unlock paths (checkout / confirm / resume / pause / cancel):
 * - blocked → 409 account_deletion_in_progress
 * - lookup_failed → fail closed (caller maps to 500)
 */
export async function assertEntitlementMutationAllowedForAccountDeletion(
  clerkUserId: string
): Promise<
  | { ok: true }
  | { ok: false; code: "account_deletion_in_progress" | "lookup_failed" }
> {
  const result =
    await evaluateEntitlementRestorationForAccountDeletion(clerkUserId);
  if (result.decision === "allowed") return { ok: true };
  if (result.decision === "lookup_failed") {
    return { ok: false, code: "lookup_failed" };
  }
  return { ok: false, code: "account_deletion_in_progress" };
}

/**
 * Webhook entitlement-increasing writes.
 *
 * Three outcomes (do not collapse lookup_failed into deletion):
 * - allowed → proceed with unlock
 * - blocked_due_to_deletion → intentional no-op (caller keeps dedupe, returns 200)
 * - lookup_failed → retryable (caller must release current event dedupe and return 500)
 *
 * Postgres/Stripe/Clerk are not one atomic transaction; a second check may still
 * race with deletion. Fail closed on unlock paths.
 */
export async function evaluateEntitlementIncreasingWebhookWrite(
  clerkUserId: string
): Promise<EntitlementRestorationDecision> {
  return evaluateEntitlementRestorationForAccountDeletion(clerkUserId);
}

/**
 * @deprecated Prefer evaluateEntitlementIncreasingWebhookWrite for exhaustive
 * three-way handling. Kept for callers that only need skip vs proceed when they
 * already treat lookup_failed separately.
 */
export async function shouldSkipEntitlementIncreasingWrite(
  clerkUserId: string
): Promise<{ skip: boolean; reason: "none" | "deletion" | "lookup_failed" }> {
  const result =
    await evaluateEntitlementRestorationForAccountDeletion(clerkUserId);
  if (result.decision === "allowed") {
    return { skip: false, reason: "none" };
  }
  if (result.decision === "lookup_failed") {
    return { skip: true, reason: "lookup_failed" };
  }
  return { skip: true, reason: "deletion" };
}
