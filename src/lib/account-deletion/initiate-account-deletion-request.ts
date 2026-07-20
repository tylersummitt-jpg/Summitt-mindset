/**
 * APP-041F2 — narrow idempotent initiation wrapper over createAccountDeletionRequest.
 *
 * Server-derived idempotency key only:
 *   account-delete:v1:${clerkUserId}
 *
 * Returns sanitized outcomes for the initiation route — never raw rows, IDs,
 * or Supabase errors.
 *
 * APP-041F4a: existing-row classification reuses canonical structural
 * consistency (admin/orchestrator invariants). Incoherent rows → conflict.
 */

import "server-only";

import { evaluateAccountDeletionStructuralConsistency } from "./admin-observability";
import {
  createAccountDeletionRequest,
  getUnresolvedAccountDeletionRequestForUser,
} from "./repository";
import type { AccountDeletionInitiationCreateOutcome } from "./run-account-deletion-initiation";
import {
  ACCOUNT_DELETION_ORCHESTRATION_VERSION,
  type AccountDeletionRequestRow,
} from "./types";

export function accountDeletionInitiationIdempotencyKey(
  clerkUserId: string
): string {
  return `account-delete:v1:${clerkUserId}`;
}

/**
 * Structural coherence for initiation classification.
 * Delegates to evaluateAccountDeletionStructuralConsistency (canonical):
 * version, lease shape, status/step pairs, completed_at, purge/Clerk markers.
 * Does not mutate or repair incoherent rows.
 */
export function isCoherentAccountDeletionInitiationRow(
  row: AccountDeletionRequestRow
): boolean {
  return evaluateAccountDeletionStructuralConsistency(row)
    .structurallyConsistent;
}

function classifyExistingRow(
  row: AccountDeletionRequestRow,
  expectedClerkUserId: string
): AccountDeletionInitiationCreateOutcome {
  if (row.clerk_user_id !== expectedClerkUserId) {
    return "conflict";
  }
  if (!isCoherentAccountDeletionInitiationRow(row)) {
    return "conflict";
  }
  if (row.status === "completed") {
    return "already_completed";
  }
  if (row.status === "failed_terminal") {
    return "failed_terminal";
  }
  return "existing_active";
}

/**
 * Create or return the durable initiation request for the authenticated user.
 * Never accepts a client idempotency key.
 */
export async function initiateAccountDeletionRequestForUser(
  clerkUserId: string
): Promise<AccountDeletionInitiationCreateOutcome> {
  const trimmed = clerkUserId.trim();
  if (!trimmed) {
    return "internal_error";
  }

  const idempotencyKey = accountDeletionInitiationIdempotencyKey(trimmed);

  let result: Awaited<ReturnType<typeof createAccountDeletionRequest>>;
  try {
    result = await createAccountDeletionRequest({
      clerkUserId: trimmed,
      idempotencyKey,
      orchestrationVersion: ACCOUNT_DELETION_ORCHESTRATION_VERSION,
    });
  } catch {
    return "internal_error";
  }

  if (result.ok) {
    if (result.value.created) {
      const row = result.value.row;
      if (
        row.clerk_user_id !== trimmed ||
        !isCoherentAccountDeletionInitiationRow(row) ||
        row.status !== "requested" ||
        row.current_step !== "requested"
      ) {
        return "conflict";
      }
      return "created_new";
    }
    return classifyExistingRow(result.value.row, trimmed);
  }

  if (result.code === "conflict_unresolved_exists") {
    let unresolved: AccountDeletionRequestRow | null;
    try {
      unresolved = await getUnresolvedAccountDeletionRequestForUser(trimmed);
    } catch {
      return "internal_error";
    }
    if (!unresolved) {
      return "internal_error";
    }
    return classifyExistingRow(unresolved, trimmed);
  }

  if (result.code === "unsupported_orchestration_version") {
    return "conflict";
  }

  return "internal_error";
}
