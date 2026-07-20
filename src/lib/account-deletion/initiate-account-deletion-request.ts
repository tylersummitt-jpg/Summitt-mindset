/**
 * APP-041F2 — narrow idempotent initiation wrapper over createAccountDeletionRequest.
 *
 * Server-derived idempotency key only:
 *   account-delete:v1:${clerkUserId}
 *
 * Returns sanitized outcomes for the initiation route — never raw rows, IDs,
 * or Supabase errors.
 */

import "server-only";

import {
  createAccountDeletionRequest,
  getUnresolvedAccountDeletionRequestForUser,
} from "./repository";
import type { AccountDeletionInitiationCreateOutcome } from "./run-account-deletion-initiation";
import {
  ACCOUNT_DELETION_ORCHESTRATION_VERSION,
  ACCOUNT_DELETION_SUPPORTED_ORCHESTRATION_VERSIONS,
  isAccountDeletionStatus,
  type AccountDeletionRequestRow,
} from "./types";

export function accountDeletionInitiationIdempotencyKey(
  clerkUserId: string
): string {
  return `account-delete:v1:${clerkUserId}`;
}

function isSupportedOrchestrationVersion(version: number): boolean {
  return (
    ACCOUNT_DELETION_SUPPORTED_ORCHESTRATION_VERSIONS as readonly number[]
  ).includes(version);
}

/**
 * Structural coherence for initiation classification.
 * Status and current_step must be known vocabulary; version must be supported.
 * failed_retryable intentionally may have status ≠ current_step.
 */
export function isCoherentAccountDeletionInitiationRow(
  row: AccountDeletionRequestRow
): boolean {
  if (!isSupportedOrchestrationVersion(row.orchestration_version)) {
    return false;
  }
  if (!isAccountDeletionStatus(row.status)) return false;
  if (!isAccountDeletionStatus(row.current_step)) return false;
  if (row.status === "completed" && row.current_step !== "completed") {
    return false;
  }
  return true;
}

function classifyExistingRow(
  row: AccountDeletionRequestRow
): AccountDeletionInitiationCreateOutcome {
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
        !isCoherentAccountDeletionInitiationRow(row) ||
        row.status !== "requested" ||
        row.current_step !== "requested"
      ) {
        return "conflict";
      }
      return "created_new";
    }
    return classifyExistingRow(result.value.row);
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
    return classifyExistingRow(unresolved);
  }

  if (result.code === "unsupported_orchestration_version") {
    return "conflict";
  }

  return "internal_error";
}
