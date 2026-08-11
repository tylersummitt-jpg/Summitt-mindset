/**
 * APP-041E3b — bounded ID-only discovery selection (pure + shared with in-memory).
 *
 * No leases acquired, no state mutation, no provider calls.
 * SQL source of truth: list_account_deletion_requests_for_reconcile.
 *
 * Victory Media token barrier: happy-path `app_data_purged` is eligible only after
 * created_at + VICTORY_MEDIA_ACCOUNT_DELETION_BARRIER_MS (2h + 5m).
 */

import { VICTORY_MEDIA_ACCOUNT_DELETION_BARRIER_MS } from "@/lib/victory-media/constants";
import type {
  AccountDeletionRequestRow,
  AccountDeletionStatus,
} from "./types";
import { ACCOUNT_DELETION_ORCHESTRATION_VERSION } from "./types";

export const ACCOUNT_DELETION_DISCOVERY_DEFAULT_LIMIT = 1;
export const ACCOUNT_DELETION_DISCOVERY_MAX_LIMIT = 10;
export const ACCOUNT_DELETION_DISCOVERY_MIN_LEASE_MS = 1000;
export const ACCOUNT_DELETION_DISCOVERY_MAX_LEASE_MS = 3_600_000;
export const ACCOUNT_DELETION_DISCOVERY_DEFAULT_LEASE_MS = 120_000;

/** Mirror of SQL `INTERVAL '2 hours 5 minutes'` for app_data_purged eligibility. */
export const ACCOUNT_DELETION_VICTORY_MEDIA_TOKEN_BARRIER_MS =
  VICTORY_MEDIA_ACCOUNT_DELETION_BARRIER_MS;

const HAPPY_PATH_STATUSES: ReadonlySet<AccountDeletionStatus> = new Set([
  "requested",
  "suppressing_sms",
  "sms_suppressed",
  "canceling_subscription",
  "subscription_canceled",
  "purging_app_data",
  "app_data_purged",
  "deleting_clerk",
]);

const FAILED_RETRYABLE_STEPS: ReadonlySet<AccountDeletionStatus> = new Set([
  "suppressing_sms",
  "canceling_subscription",
  "purging_app_data",
  "deleting_clerk",
]);

export type DiscoverAccountDeletionRequestIdsInput = {
  limit: number | null | undefined;
  leaseMs: number | null | undefined;
  now: Date;
};

/**
 * V1 failed_retryable backoff delay in milliseconds.
 * Base time is GREATEST(COALESCE(last_retry_at, updated_at), updated_at):
 * the later of retry-start and most recent row activity / failure timestamp.
 */
export function accountDeletionRetryBackoffMs(attemptCount: number): number {
  if (attemptCount < 3) return 5 * 60 * 1000;
  if (attemptCount <= 5) return 15 * 60 * 1000;
  if (attemptCount <= 9) return 30 * 60 * 1000;
  return 60 * 60 * 1000;
}

export function isLegalDiscoveryRoutingPair(
  status: AccountDeletionStatus,
  currentStep: AccountDeletionStatus
): boolean {
  if (!status || !currentStep) return false;
  if (status === "failed_retryable") {
    return FAILED_RETRYABLE_STEPS.has(currentStep);
  }
  return status === currentStep && HAPPY_PATH_STATUSES.has(status);
}

/**
 * Match acquire_account_deletion_lease freshness (without same-owner refresh):
 * free when lock_owner IS NULL OR locked_at IS NULL OR locked_at < now - lease_ms.
 * Boundary equality is still active (not eligible).
 */
export function isLeaseFreeForDiscovery(
  row: Pick<AccountDeletionRequestRow, "lock_owner" | "locked_at">,
  now: Date,
  leaseMs: number
): boolean {
  if (row.lock_owner == null) return true;
  if (row.locked_at == null) return true;
  const lockedMs = Date.parse(row.locked_at);
  if (Number.isNaN(lockedMs)) return true;
  return lockedMs < now.getTime() - leaseMs;
}

export function effectiveDiscoveryEligibilityMs(
  row: Pick<
    AccountDeletionRequestRow,
    | "status"
    | "attempt_count"
    | "last_retry_at"
    | "updated_at"
    | "created_at"
  >
): number | null {
  const updatedMs = Date.parse(row.updated_at);
  if (Number.isNaN(updatedMs)) return null;

  if (row.status === "failed_retryable") {
    // Match SQL: GREATEST(COALESCE(last_retry_at, updated_at), updated_at).
    let lastRetryMs: number | null = null;
    if (row.last_retry_at) {
      lastRetryMs = Date.parse(row.last_retry_at);
      if (Number.isNaN(lastRetryMs)) return null;
    }
    const baseMs =
      lastRetryMs == null ? updatedMs : Math.max(lastRetryMs, updatedMs);
    return baseMs + accountDeletionRetryBackoffMs(row.attempt_count);
  }

  // Happy-path app_data_purged: wait Victory Media signed-upload token barrier.
  // Do not apply this to failed_retryable / deleting_clerk.
  if (row.status === "app_data_purged") {
    const createdMs = Date.parse(row.created_at);
    if (Number.isNaN(createdMs)) return null;
    return createdMs + ACCOUNT_DELETION_VICTORY_MEDIA_TOKEN_BARRIER_MS;
  }

  return updatedMs;
}

/**
 * Single-row discoverability using the same eligibility rules as the selector/SQL.
 * Does not mutate, acquire leases, or call providers.
 */
export function isAccountDeletionRequestDiscoverable(
  row: AccountDeletionRequestRow,
  now: Date,
  leaseMs: number = ACCOUNT_DELETION_DISCOVERY_DEFAULT_LEASE_MS
): boolean {
  return (
    selectAccountDeletionRequestIdsForReconcile([row], {
      limit: 1,
      leaseMs,
      now,
    }).length === 1
  );
}

/**
 * Pure mirror of list_account_deletion_requests_for_reconcile eligibility + order.
 * Returns request IDs only. Invalid limit/lease → empty array (SQL-compatible).
 */
export function selectAccountDeletionRequestIdsForReconcile(
  rows: readonly AccountDeletionRequestRow[],
  input: DiscoverAccountDeletionRequestIdsInput
): string[] {
  const leaseMs =
    input.leaseMs == null
      ? ACCOUNT_DELETION_DISCOVERY_DEFAULT_LEASE_MS
      : input.leaseMs;
  if (
    !Number.isFinite(leaseMs) ||
    !Number.isInteger(leaseMs) ||
    leaseMs < ACCOUNT_DELETION_DISCOVERY_MIN_LEASE_MS ||
    leaseMs > ACCOUNT_DELETION_DISCOVERY_MAX_LEASE_MS
  ) {
    return [];
  }

  let limit: number;
  if (input.limit == null) {
    limit = ACCOUNT_DELETION_DISCOVERY_DEFAULT_LIMIT;
  } else if (
    !Number.isFinite(input.limit) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1
  ) {
    return [];
  } else if (input.limit > ACCOUNT_DELETION_DISCOVERY_MAX_LIMIT) {
    limit = ACCOUNT_DELETION_DISCOVERY_MAX_LIMIT;
  } else {
    limit = input.limit;
  }

  const nowMs = input.now.getTime();
  const eligible: Array<{
    id: string;
    effectiveMs: number;
    updatedMs: number;
  }> = [];

  for (const row of rows) {
    if (row.orchestration_version !== ACCOUNT_DELETION_ORCHESTRATION_VERSION) {
      continue;
    }
    if (!isLegalDiscoveryRoutingPair(row.status, row.current_step)) {
      continue;
    }
    if (!isLeaseFreeForDiscovery(row, input.now, leaseMs)) {
      continue;
    }
    const effectiveMs = effectiveDiscoveryEligibilityMs(row);
    if (effectiveMs == null || effectiveMs > nowMs) {
      continue;
    }
    const updatedMs = Date.parse(row.updated_at);
    if (Number.isNaN(updatedMs)) continue;
    eligible.push({ id: row.id, effectiveMs, updatedMs });
  }

  eligible.sort((a, b) => {
    if (a.effectiveMs !== b.effectiveMs) return a.effectiveMs - b.effectiveMs;
    if (a.updatedMs !== b.updatedMs) return a.updatedMs - b.updatedMs;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  return eligible.slice(0, limit).map((e) => e.id);
}
