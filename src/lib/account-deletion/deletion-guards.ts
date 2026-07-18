/**
 * APP-041B2a — narrow deletion-aware guards for SMS resurrection paths.
 * Unresolved account_deletion_requests (status <> completed) block SMS re-enable.
 */

import "server-only";

import { getUnresolvedAccountDeletionRequestForUser } from "./repository";

export async function hasUnresolvedAccountDeletionRequest(
  clerkUserId: string
): Promise<boolean> {
  const trimmed = clerkUserId.trim();
  if (!trimmed) return false;
  const row = await getUnresolvedAccountDeletionRequestForUser(trimmed);
  return row != null;
}
