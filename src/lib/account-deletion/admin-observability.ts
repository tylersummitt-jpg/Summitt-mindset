/**
 * APP-041E4a — pure admin observability helpers (sanitized view model).
 *
 * Read-only. No mutations, leases, providers, or reconciler calls.
 * Never put full clerk_user_id, steps JSON, or last_error_detail in the view model.
 *
 * Structural consistency priority (first match wins):
 * 1. unsupported_version
 * 2. malformed_lease
 * 3. completed_at_mismatch (completed missing completed_at, or non-completed with completed_at)
 * 4. missing_clerk_marker (completed without canonical valid Clerk marker)
 * 5. illegal_status_step
 * 6. missing_purge_marker (statuses that require a canonical valid purge marker,
 *    including completed — production finalize requires purge transitively)
 */

import {
  ACCOUNT_DELETION_DISCOVERY_DEFAULT_LEASE_MS,
  isAccountDeletionRequestDiscoverable,
  isLegalDiscoveryRoutingPair,
} from "./discover-account-deletion-requests";
import { readAppDataPurgeRpcMarker } from "./orchestrate-app-data-purge";
import { readClerkDeleteRpcMarker } from "./orchestrate-clerk-deletion";
import { isProcessingAccountDeletionStatus } from "./transitions";
import {
  ACCOUNT_DELETION_ORCHESTRATION_VERSION,
  type AccountDeletionRequestRow,
  type AccountDeletionStatus,
  type AccountDeletionStepResult,
  isAccountDeletionStatus,
} from "./types";

export const ACCOUNT_DELETION_ADMIN_DEFAULT_LIMIT = 50;
export const ACCOUNT_DELETION_ADMIN_MAX_LIMIT = 100;
export const ACCOUNT_DELETION_ADMIN_LEASE_MS =
  ACCOUNT_DELETION_DISCOVERY_DEFAULT_LEASE_MS;

export type AccountDeletionAdminLeaseState =
  | "free"
  | "active"
  | "expired"
  | "malformed";

export type AccountDeletionAdminStageState =
  | "pending"
  | "succeeded"
  | "already_absent"
  | "skipped"
  | "retryable_failure"
  | "terminal_failure"
  | "malformed"
  | "unavailable";

export type AccountDeletionAdminInconsistencyCode =
  | "none"
  | "unsupported_version"
  | "illegal_status_step"
  | "missing_purge_marker"
  | "missing_clerk_marker"
  | "completed_at_mismatch"
  | "malformed_lease";

export type AccountDeletionAdminViewRow = {
  requestId: string;
  maskedClerkUserId: string;
  orchestrationVersion: number;
  status: AccountDeletionStatus;
  currentStep: AccountDeletionStatus;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastRetryAt: string | null;
  lastErrorCode: string | null;
  leaseState: AccountDeletionAdminLeaseState;
  leaseAgeSeconds: number | null;
  leaseExpiresAt: string | null;
  smsState: AccountDeletionAdminStageState;
  stripeState: AccountDeletionAdminStageState;
  purgeState: AccountDeletionAdminStageState;
  clerkState: AccountDeletionAdminStageState;
  structurallyConsistent: boolean;
  inconsistencyCode: AccountDeletionAdminInconsistencyCode;
  currentlyDiscoverable: boolean;
};

export type AccountDeletionAdminSummary = {
  totalVisible: number;
  inProgress: number;
  failedRetryable: number;
  failedTerminal: number;
  completed: number;
  structurallyInconsistent: number;
  currentlyDiscoverable: number;
};

const IN_PROGRESS_STATUSES: ReadonlySet<AccountDeletionStatus> = new Set([
  "requested",
  "suppressing_sms",
  "sms_suppressed",
  "canceling_subscription",
  "subscription_canceled",
  "purging_app_data",
  "app_data_purged",
  "deleting_clerk",
]);

/**
 * Mask Clerk user ids for admin HTML. Never return the full id.
 */
export function maskClerkUserIdForAdmin(clerkUserId: string): string {
  if (typeof clerkUserId !== "string") return "[redacted]";
  const trimmed = clerkUserId.trim();
  if (trimmed.length < 10) return "[redacted]";
  return `${trimmed.slice(0, 5)}…${trimmed.slice(-4)}`;
}

export function clampAccountDeletionAdminLimit(
  limit: number | null | undefined
): number {
  if (
    limit == null ||
    !Number.isFinite(limit) ||
    !Number.isInteger(limit) ||
    limit < 1
  ) {
    return ACCOUNT_DELETION_ADMIN_DEFAULT_LIMIT;
  }
  if (limit > ACCOUNT_DELETION_ADMIN_MAX_LIMIT) {
    return ACCOUNT_DELETION_ADMIN_MAX_LIMIT;
  }
  return limit;
}

export function parseAccountDeletionAdminStatusFilter(
  value: string | null | undefined
): AccountDeletionStatus | "all" {
  if (value == null || value === "" || value === "all") return "all";
  if (isAccountDeletionStatus(value)) return value;
  return "all";
}

export function mapAccountDeletionStepResultToAdminState(
  result: AccountDeletionStepResult | null | undefined,
  rowStatus?: AccountDeletionStatus
): AccountDeletionAdminStageState {
  if (result == null) return "unavailable";
  switch (result) {
    case "pending":
      return "pending";
    case "ok":
      return "succeeded";
    case "already_done":
      return "already_absent";
    case "skipped":
      return "skipped";
    case "failed":
      return rowStatus === "failed_terminal"
        ? "terminal_failure"
        : "retryable_failure";
    default:
      return "malformed";
  }
}

/** Canonical purge success: production reader kind === "valid" only. */
function hasCanonicalPurgeSuccessMarker(
  row: Pick<AccountDeletionRequestRow, "steps">
): boolean {
  return readAppDataPurgeRpcMarker(row).kind === "valid";
}

/** Canonical Clerk success: production reader kind === "valid" only. */
function hasCanonicalClerkSuccessMarker(
  row: Pick<AccountDeletionRequestRow, "steps">
): boolean {
  return readClerkDeleteRpcMarker(row).kind === "valid";
}

export function evaluateAccountDeletionAdminLease(
  row: Pick<AccountDeletionRequestRow, "lock_owner" | "locked_at">,
  now: Date,
  leaseMs: number = ACCOUNT_DELETION_ADMIN_LEASE_MS
): {
  leaseState: AccountDeletionAdminLeaseState;
  leaseAgeSeconds: number | null;
  leaseExpiresAt: string | null;
} {
  const owner = row.lock_owner;
  const lockedAt = row.locked_at;

  if (owner == null && lockedAt == null) {
    return { leaseState: "free", leaseAgeSeconds: null, leaseExpiresAt: null };
  }

  if ((owner == null) !== (lockedAt == null)) {
    return {
      leaseState: "malformed",
      leaseAgeSeconds: null,
      leaseExpiresAt: null,
    };
  }

  const lockedMs = Date.parse(lockedAt!);
  if (Number.isNaN(lockedMs)) {
    return {
      leaseState: "malformed",
      leaseAgeSeconds: null,
      leaseExpiresAt: null,
    };
  }

  const ageSeconds = Math.max(
    0,
    Math.floor((now.getTime() - lockedMs) / 1000)
  );
  const expiresAt = new Date(lockedMs + leaseMs).toISOString();
  // Strict < expiry matches discovery/acquire SQL; exact boundary is still active.
  const expired = lockedMs < now.getTime() - leaseMs;

  return {
    leaseState: expired ? "expired" : "active",
    leaseAgeSeconds: ageSeconds,
    leaseExpiresAt: expiresAt,
  };
}

export function evaluateAccountDeletionStructuralConsistency(
  row: AccountDeletionRequestRow
): {
  structurallyConsistent: boolean;
  inconsistencyCode: AccountDeletionAdminInconsistencyCode;
} {
  if (row.orchestration_version !== ACCOUNT_DELETION_ORCHESTRATION_VERSION) {
    return {
      structurallyConsistent: false,
      inconsistencyCode: "unsupported_version",
    };
  }

  const owner = row.lock_owner;
  const lockedAt = row.locked_at;
  if ((owner == null) !== (lockedAt == null)) {
    return {
      structurallyConsistent: false,
      inconsistencyCode: "malformed_lease",
    };
  }
  if (lockedAt != null && Number.isNaN(Date.parse(lockedAt))) {
    return {
      structurallyConsistent: false,
      inconsistencyCode: "malformed_lease",
    };
  }

  if (row.status === "completed") {
    if (row.completed_at == null) {
      return {
        structurallyConsistent: false,
        inconsistencyCode: "completed_at_mismatch",
      };
    }
    // Absent or malformed → same safe code (do not expose parser reason/detail).
    if (!hasCanonicalClerkSuccessMarker(row)) {
      return {
        structurallyConsistent: false,
        inconsistencyCode: "missing_clerk_marker",
      };
    }
  } else if (row.completed_at != null) {
    return {
      structurallyConsistent: false,
      inconsistencyCode: "completed_at_mismatch",
    };
  }

  if (row.status === "failed_retryable") {
    if (!isProcessingAccountDeletionStatus(row.current_step)) {
      return {
        structurallyConsistent: false,
        inconsistencyCode: "illegal_status_step",
      };
    }
  } else if (
    row.status !== "failed_terminal" &&
    row.status !== row.current_step
  ) {
    return {
      structurallyConsistent: false,
      inconsistencyCode: "illegal_status_step",
    };
  }

  // Production finalizeClerkDeletionCompleted requires a valid purge marker
  // before completed; surface the same invariant for admin consistency.
  if (
    row.status === "app_data_purged" ||
    row.status === "deleting_clerk" ||
    row.status === "completed" ||
    (row.status === "failed_retryable" &&
      row.current_step === "deleting_clerk")
  ) {
    if (!hasCanonicalPurgeSuccessMarker(row)) {
      return {
        structurallyConsistent: false,
        inconsistencyCode: "missing_purge_marker",
      };
    }
  }

  return { structurallyConsistent: true, inconsistencyCode: "none" };
}

export function toAccountDeletionAdminViewRow(
  row: AccountDeletionRequestRow,
  now: Date,
  leaseMs: number = ACCOUNT_DELETION_ADMIN_LEASE_MS
): AccountDeletionAdminViewRow {
  const lease = evaluateAccountDeletionAdminLease(row, now, leaseMs);
  const consistency = evaluateAccountDeletionStructuralConsistency(row);
  const discoverable = isAccountDeletionRequestDiscoverable(row, now, leaseMs);

  return {
    requestId: row.id,
    maskedClerkUserId: maskClerkUserIdForAdmin(row.clerk_user_id),
    orchestrationVersion: row.orchestration_version,
    status: row.status,
    currentStep: row.current_step,
    attemptCount: row.attempt_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    lastRetryAt: row.last_retry_at,
    lastErrorCode: row.last_error_code,
    leaseState: lease.leaseState,
    leaseAgeSeconds: lease.leaseAgeSeconds,
    leaseExpiresAt: lease.leaseExpiresAt,
    smsState: mapAccountDeletionStepResultToAdminState(
      row.sms_result,
      row.status
    ),
    stripeState: mapAccountDeletionStepResultToAdminState(
      row.stripe_result,
      row.status
    ),
    purgeState: mapAccountDeletionStepResultToAdminState(
      row.purge_result,
      row.status
    ),
    clerkState: mapAccountDeletionStepResultToAdminState(
      row.clerk_result,
      row.status
    ),
    structurallyConsistent: consistency.structurallyConsistent,
    inconsistencyCode: consistency.inconsistencyCode,
    currentlyDiscoverable: discoverable,
  };
}

export function summarizeAccountDeletionAdminRows(
  rows: readonly AccountDeletionAdminViewRow[]
): AccountDeletionAdminSummary {
  let inProgress = 0;
  let failedRetryable = 0;
  let failedTerminal = 0;
  let completed = 0;
  let structurallyInconsistent = 0;
  let currentlyDiscoverable = 0;

  for (const row of rows) {
    if (IN_PROGRESS_STATUSES.has(row.status)) inProgress += 1;
    if (row.status === "failed_retryable") failedRetryable += 1;
    if (row.status === "failed_terminal") failedTerminal += 1;
    if (row.status === "completed") completed += 1;
    if (!row.structurallyConsistent) structurallyInconsistent += 1;
    if (row.currentlyDiscoverable) currentlyDiscoverable += 1;
  }

  return {
    totalVisible: rows.length,
    inProgress,
    failedRetryable,
    failedTerminal,
    completed,
    structurallyInconsistent,
    currentlyDiscoverable,
  };
}

/** Test/helper: legal routing pair alias for admin docs/tests. */
export function isAdminLegalStatusStepPair(
  status: AccountDeletionStatus,
  currentStep: AccountDeletionStatus
): boolean {
  if (status === "completed" || status === "failed_terminal") {
    return true;
  }
  return isLegalDiscoveryRoutingPair(status, currentStep);
}
