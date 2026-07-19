/**
 * APP-041E1 — trusted one-request / one-stage account-deletion reconciler.
 *
 * Server-only internal foundation. Not a public HTTP entrypoint, background
 * job, queue consumer, or user-facing API.
 * Callers must inject stage functions; this module never instantiates Stripe,
 * Clerk, or Supabase clients and never defaults to live orchestrators.
 *
 * SMS (`suppressSmsForDeletion`) is not DI-safe today (hard-wires Supabase RPC +
 * Clerk metadata). Wire a test/fake stage or a future DI-safe wrapper — do not
 * default-call the production SMS orchestrator from here.
 */

import "server-only";

import type { ClerkDeletionAdapter } from "./clerk-deletion-adapter";
import type {
  CancelStripeSubscriptionsForDeletionInput,
  CancelStripeSubscriptionsForDeletionValue,
  DeletionStripeClient,
} from "./cancel-subscription";
import type {
  OrchestrateAppDataPurgeInput,
  OrchestrateAppDataPurgeValue,
} from "./orchestrate-app-data-purge";
import type {
  OrchestrateClerkDeletionInput,
  OrchestrateClerkDeletionValue,
} from "./orchestrate-clerk-deletion";
import {
  DEFAULT_ACCOUNT_DELETION_LEASE_MS,
  getAccountDeletionRequestById,
  type AccountDeletionRepoResult,
} from "./repository";
import type {
  SuppressSmsForDeletionInput,
  SuppressSmsForDeletionValue,
} from "./suppress-sms";
import { isProcessingAccountDeletionStatus } from "./transitions";
import {
  toAccountDeletionSafeStatusProjection,
  type AccountDeletionErrorCode,
  type AccountDeletionRequestRow,
  type AccountDeletionSafeStatusProjection,
  type AccountDeletionStatus,
  type AccountDeletionStep,
} from "./types";
import type {
  PurgeAppDataForDeletionInput,
  PurgeAppDataForDeletionValue,
} from "./purge-app-data";

/** Matches CAS / lease RPC bounds (1s … 1h). */
export const ACCOUNT_DELETION_MIN_LEASE_MS = 1000;
export const ACCOUNT_DELETION_MAX_LEASE_MS = 3_600_000;

export type AccountDeletionReconcileStage =
  | "sms"
  | "stripe"
  | "purge"
  | "clerk";

export type AccountDeletionReconcileResult =
  | {
      outcome: "advanced";
      stage: AccountDeletionReconcileStage;
      request: AccountDeletionSafeStatusProjection;
    }
  | {
      outcome: "already_done";
      request: AccountDeletionSafeStatusProjection;
    }
  | {
      outcome: "no_action";
      reason: string;
      request?: AccountDeletionSafeStatusProjection;
    }
  | {
      outcome: "retryable_failure";
      stage?: AccountDeletionReconcileStage;
      code: string;
    }
  | {
      outcome: "conflict";
      stage?: AccountDeletionReconcileStage;
      code: string;
    }
  | { outcome: "not_found" };

export type SuppressSmsStageFn = (
  input: SuppressSmsForDeletionInput
) => Promise<AccountDeletionRepoResult<SuppressSmsForDeletionValue>>;

export type CancelStripeStageFn = (
  input: CancelStripeSubscriptionsForDeletionInput
) => Promise<AccountDeletionRepoResult<CancelStripeSubscriptionsForDeletionValue>>;

export type PurgeAppDataStageFn = (
  input: OrchestrateAppDataPurgeInput
) => Promise<AccountDeletionRepoResult<OrchestrateAppDataPurgeValue>>;

export type DeleteClerkStageFn = (
  input: OrchestrateClerkDeletionInput
) => Promise<AccountDeletionRepoResult<OrchestrateClerkDeletionValue>>;

export type ReconcileAccountDeletionRequestInput = {
  requestId: string;
  lockOwner: string;
  leaseMs?: number;
  now?: Date;
  /** Required. Never defaults to production suppressSmsForDeletion. */
  suppressSms: SuppressSmsStageFn;
  /** Required. Never defaults to production cancelStripeSubscriptionsForDeletion. */
  cancelStripe: CancelStripeStageFn;
  /** Required. Never defaults to production orchestrateAppDataPurge. */
  purgeAppData: PurgeAppDataStageFn;
  /** Required. Never defaults to production orchestrateClerkDeletion. */
  deleteClerk: DeleteClerkStageFn;
  /**
   * Passed only into `deleteClerk`. Worker never invokes the adapter itself.
   */
  clerkAdapter: ClerkDeletionAdapter;
  /** Optional passthrough when wiring a Stripe-capable cancelStripe stage. */
  stripe?: DeletionStripeClient;
  getPublicMetadata?: CancelStripeSubscriptionsForDeletionInput["getPublicMetadata"];
  recognizedPriceIds?: Set<string>;
  /** Optional passthrough when wiring a purge-capable purgeAppData stage. */
  purgeFn?: (
    input: PurgeAppDataForDeletionInput
  ) => Promise<AccountDeletionRepoResult<PurgeAppDataForDeletionValue>>;
};

type RoutedStage = AccountDeletionReconcileStage;

function project(row: AccountDeletionRequestRow): AccountDeletionSafeStatusProjection {
  return toAccountDeletionSafeStatusProjection(row);
}

function isValidLeaseMs(leaseMs: number): boolean {
  return (
    Number.isFinite(leaseMs) &&
    Number.isInteger(leaseMs) &&
    leaseMs >= ACCOUNT_DELETION_MIN_LEASE_MS &&
    leaseMs <= ACCOUNT_DELETION_MAX_LEASE_MS
  );
}

/**
 * Happy-path rows keep status === current_step.
 * failed_retryable resumes only from a processing current_step.
 * completed / failed_terminal are terminal for routing (handled before this).
 */
export function isConsistentAccountDeletionRoutingRow(
  row: AccountDeletionRequestRow
): boolean {
  if (row.status === "failed_retryable") {
    return isProcessingAccountDeletionStatus(row.current_step);
  }
  if (row.status === "completed" || row.status === "failed_terminal") {
    return true;
  }
  return row.status === row.current_step;
}

function routeStage(
  status: AccountDeletionStatus,
  currentStep: AccountDeletionStep
): RoutedStage | "already_done" | "terminal" | "fail_closed" {
  switch (status) {
    case "requested":
    case "suppressing_sms":
      return "sms";
    case "sms_suppressed":
    case "canceling_subscription":
      return "stripe";
    case "subscription_canceled":
    case "purging_app_data":
      return "purge";
    case "app_data_purged":
    case "deleting_clerk":
      return "clerk";
    case "completed":
      return "already_done";
    case "failed_terminal":
      return "terminal";
    case "failed_retryable":
      switch (currentStep) {
        case "suppressing_sms":
          return "sms";
        case "canceling_subscription":
          return "stripe";
        case "purging_app_data":
          return "purge";
        case "deleting_clerk":
          return "clerk";
        default:
          return "fail_closed";
      }
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return "fail_closed";
    }
  }
}

function mapRepoFailure(
  code: AccountDeletionErrorCode,
  stage: RoutedStage
): AccountDeletionReconcileResult {
  if (code === "not_found") {
    return { outcome: "not_found" };
  }
  if (code === "internal_error") {
    return { outcome: "retryable_failure", stage, code };
  }
  // cas_conflict, lease_held, lease_not_held, illegal_transition,
  // invalid_argument, unsupported_orchestration_version, conflict_unresolved_exists
  return { outcome: "conflict", stage, code };
}

function mapStageSuccess(args: {
  stage: RoutedStage;
  row: AccountDeletionRequestRow;
  alreadyDoneOutcome?: boolean;
}): AccountDeletionReconcileResult {
  const { stage, row, alreadyDoneOutcome } = args;
  if (row.status === "completed" && alreadyDoneOutcome) {
    return { outcome: "already_done", request: project(row) };
  }
  // Stage success or nonterminal already_done → advanced (one stage progressed
  // or confirmed). Whole-deletion already_done only when durable completed was
  // observed without claiming completion from a non-Clerk stage alone.
  return { outcome: "advanced", stage, request: project(row) };
}

/**
 * Inspect one durable account-deletion request and invoke exactly one injected
 * stage orchestrator for its current state. Idempotent; lease/CAS remain inside
 * the stage functions.
 */
export async function reconcileAccountDeletionRequest(
  input: ReconcileAccountDeletionRequestInput
): Promise<AccountDeletionReconcileResult> {
  const requestId = input.requestId.trim();
  const lockOwner = input.lockOwner.trim();
  if (!requestId) {
    return {
      outcome: "conflict",
      code: "invalid_argument",
    };
  }
  if (!lockOwner) {
    return {
      outcome: "conflict",
      code: "invalid_argument",
    };
  }

  const leaseMs = input.leaseMs ?? DEFAULT_ACCOUNT_DELETION_LEASE_MS;
  if (!isValidLeaseMs(leaseMs)) {
    return {
      outcome: "conflict",
      code: "invalid_argument",
    };
  }

  if (
    typeof input.suppressSms !== "function" ||
    typeof input.cancelStripe !== "function" ||
    typeof input.purgeAppData !== "function" ||
    typeof input.deleteClerk !== "function"
  ) {
    return {
      outcome: "conflict",
      code: "invalid_argument",
    };
  }

  if (
    !input.clerkAdapter ||
    typeof input.clerkAdapter.deleteUser !== "function"
  ) {
    return {
      outcome: "conflict",
      code: "invalid_argument",
    };
  }

  const row = await getAccountDeletionRequestById(requestId);
  if (!row) {
    return { outcome: "not_found" };
  }

  if (!isConsistentAccountDeletionRoutingRow(row)) {
    return {
      outcome: "no_action",
      reason: "illegal_status_current_step",
      request: project(row),
    };
  }

  const routed = routeStage(row.status, row.current_step);
  if (routed === "already_done") {
    return { outcome: "already_done", request: project(row) };
  }
  if (routed === "terminal") {
    return {
      outcome: "no_action",
      reason: "failed_terminal",
      request: project(row),
    };
  }
  if (routed === "fail_closed") {
    return {
      outcome: "no_action",
      reason: "illegal_failed_retryable_current_step",
      request: project(row),
    };
  }

  const clerkUserId = row.clerk_user_id;
  const now = input.now;
  const expectedOrchestrationVersion = row.orchestration_version;
  const stage = routed;

  if (stage === "sms") {
    const result = await input.suppressSms({
      requestId,
      clerkUserId,
      lockOwner,
      leaseMs,
      now,
    });
    if (!result.ok) return mapRepoFailure(result.code, stage);
    return mapStageSuccess({ stage, row: result.value.row });
  }

  if (stage === "stripe") {
    const result = await input.cancelStripe({
      requestId,
      clerkUserId,
      lockOwner,
      leaseMs,
      now,
      expectedOrchestrationVersion,
      stripe: input.stripe,
      getPublicMetadata: input.getPublicMetadata,
      recognizedPriceIds: input.recognizedPriceIds,
    });
    if (!result.ok) return mapRepoFailure(result.code, stage);
    return mapStageSuccess({ stage, row: result.value.row });
  }

  if (stage === "purge") {
    const result = await input.purgeAppData({
      requestId,
      clerkUserId,
      lockOwner,
      leaseMs,
      now,
      expectedOrchestrationVersion,
      purgeFn: input.purgeFn,
    });
    if (!result.ok) return mapRepoFailure(result.code, stage);
    return mapStageSuccess({
      stage,
      row: result.value.row,
      alreadyDoneOutcome: result.value.outcome === "already_done",
    });
  }

  // stage === "clerk"
  const result = await input.deleteClerk({
    requestId,
    clerkUserId,
    lockOwner,
    leaseMs,
    now,
    expectedOrchestrationVersion,
    adapter: input.clerkAdapter,
  });
  if (!result.ok) return mapRepoFailure(result.code, stage);
  return mapStageSuccess({
    stage,
    row: result.value.row,
    alreadyDoneOutcome: result.value.outcome === "already_done",
  });
}
