/**
 * APP-041E4b/E4c — injectable account-deletion scheduler invocation core.
 *
 * Fail-closed order (testable):
 * 1. kill switch (caller evaluates exact "true")
 * 2. discover IDs (limit 1)
 * 3. require zero or one ID
 * 4. construct dependencies only for exactly one ID
 * 5. invoke trusted reconciler exactly once
 * 6. sanitize response
 *
 * Does not authenticate (route wrapper owns cron auth).
 * Does not read environment. Does not construct providers itself.
 *
 * Response counts (APP-041E4c):
 * - discovered: number of request IDs selected for attempted reconciliation
 * - attempted: number of reconciler invocations completed (any outcome)
 *   Does NOT mean a stage advanced unless code === "advanced".
 */

import "server-only";

import { randomUUID } from "node:crypto";

import type {
  AccountDeletionReconcileResult,
  AccountDeletionReconcilerDependencies,
} from "./reconcile-account-deletion";

export const ACCOUNT_DELETION_SCHEDULER_BATCH_SIZE = 1;
export const ACCOUNT_DELETION_SCHEDULER_LEASE_MS = 120_000;
export const ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV =
  "ACCOUNT_DELETION_SCHEDULER_ENABLED" as const;

export const ACCOUNT_DELETION_SCHEDULER_DISABLED_CODE =
  "account_deletion_scheduler_disabled" as const;

/** Exact-string kill switch: only the literal "true" enables. */
export function isAccountDeletionSchedulerEnabled(
  raw: string | undefined | null
): boolean {
  return raw === "true";
}

export type AccountDeletionSchedulerDiscoverResult =
  | { ok: true; requestIds: string[] }
  | { ok: false };

export type AccountDeletionSchedulerBody = {
  ok: boolean;
  enabled: boolean;
  code: string;
  discovered?: number;
  attempted?: number;
};

export type AccountDeletionSchedulerInvocationResult = {
  httpStatus: number;
  body: AccountDeletionSchedulerBody;
};

export type RunAccountDeletionSchedulerInvocationInput = {
  enabled: boolean;
  discover: () => Promise<AccountDeletionSchedulerDiscoverResult>;
  createDependencies: () => AccountDeletionReconcilerDependencies;
  reconcile: (input: {
    requestId: string;
    lockOwner: string;
    leaseMs: number;
    dependencies: AccountDeletionReconcilerDependencies;
  }) => Promise<AccountDeletionReconcileResult>;
  createWorkerId?: () => string;
};

const ALLOWLISTED_OUTCOME_CODES = new Set([
  "advanced",
  "already_done",
  "no_action",
  "retryable_failure",
  "conflict",
  "not_found",
]);

function defaultWorkerId(): string {
  return `account-deletion-cron:${randomUUID()}`;
}

function sanitizeReconcileOutcome(
  result: AccountDeletionReconcileResult
): string {
  if (!result || typeof result !== "object") return "internal_error";
  const outcome = (result as { outcome?: unknown }).outcome;
  if (typeof outcome !== "string") return "internal_error";
  if (ALLOWLISTED_OUTCOME_CODES.has(outcome)) return outcome;
  return "internal_error";
}

function disabledResult(): AccountDeletionSchedulerInvocationResult {
  return {
    httpStatus: 200,
    body: {
      ok: true,
      enabled: false,
      code: ACCOUNT_DELETION_SCHEDULER_DISABLED_CODE,
    },
  };
}

function noWorkResult(): AccountDeletionSchedulerInvocationResult {
  return {
    httpStatus: 200,
    body: {
      ok: true,
      enabled: true,
      code: "no_work",
      discovered: 0,
      attempted: 0,
    },
  };
}

function internalError(args: {
  discovered: number;
  attempted: number;
}): AccountDeletionSchedulerInvocationResult {
  return {
    httpStatus: 500,
    body: {
      ok: false,
      enabled: true,
      code: "internal_error",
      discovered: args.discovered,
      attempted: args.attempted,
    },
  };
}

/**
 * One discovery → at most one dependency construction → at most one reconcile.
 * Never loops, never retries within the same invocation.
 */
export async function runAccountDeletionSchedulerInvocation(
  input: RunAccountDeletionSchedulerInvocationInput
): Promise<AccountDeletionSchedulerInvocationResult> {
  if (!input.enabled) {
    return disabledResult();
  }

  let discovered: AccountDeletionSchedulerDiscoverResult;
  try {
    discovered = await input.discover();
  } catch {
    return internalError({ discovered: 0, attempted: 0 });
  }

  if (!discovered.ok) {
    return internalError({ discovered: 0, attempted: 0 });
  }

  const ids = discovered.requestIds;
  if (!Array.isArray(ids)) {
    return internalError({ discovered: 0, attempted: 0 });
  }
  if (ids.length === 0) {
    return noWorkResult();
  }
  if (ids.length !== 1) {
    // Fail closed — never process when discovery violates batch=1.
    return internalError({ discovered: 0, attempted: 0 });
  }

  const requestId = ids[0];
  if (typeof requestId !== "string" || requestId.length < 1) {
    return internalError({ discovered: 0, attempted: 0 });
  }

  let dependencies: AccountDeletionReconcilerDependencies;
  try {
    dependencies = input.createDependencies();
  } catch {
    return internalError({ discovered: 1, attempted: 0 });
  }

  const lockOwner = (input.createWorkerId ?? defaultWorkerId)();
  if (
    typeof lockOwner !== "string" ||
    !lockOwner.startsWith("account-deletion-cron:") ||
    lockOwner.includes(requestId)
  ) {
    return internalError({ discovered: 1, attempted: 0 });
  }

  let reconcileResult: AccountDeletionReconcileResult;
  try {
    reconcileResult = await input.reconcile({
      requestId,
      lockOwner,
      leaseMs: ACCOUNT_DELETION_SCHEDULER_LEASE_MS,
      dependencies,
    });
  } catch {
    return internalError({ discovered: 1, attempted: 1 });
  }

  const code = sanitizeReconcileOutcome(reconcileResult);
  if (code === "internal_error") {
    return internalError({ discovered: 1, attempted: 1 });
  }

  return {
    httpStatus: 200,
    body: {
      ok: true,
      enabled: true,
      code,
      discovered: 1,
      attempted: 1,
    },
  };
}
