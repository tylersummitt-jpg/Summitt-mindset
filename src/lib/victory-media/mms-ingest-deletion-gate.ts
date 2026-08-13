/**
 * Account-deletion gate for MMS media enqueue only.
 * Reuses hasUnresolvedAccountDeletionRequest (same helper as web Victory Media).
 *
 * Fail closed for MEDIA when lookup throws — does not affect text/coach paths.
 */

import { hasUnresolvedAccountDeletionRequest } from "@/lib/account-deletion/deletion-guards";

/**
 * True when media jobs may be inserted (no unresolved deletion row).
 * False when deletion is in progress OR deletion lookup fails.
 */
export async function isInboundMediaEnqueueAllowedByAccountDeletion(
  clerkUserId: string
): Promise<boolean> {
  const id = clerkUserId.trim();
  if (!id) return false;
  try {
    const deleting = await hasUnresolvedAccountDeletionRequest(id);
    return !deleting;
  } catch {
    return false;
  }
}
