/**
 * APP-041E1/E2/E3a — trusted one-request / one-stage account-deletion reconciler.
 *
 * Server-only internal foundation. Not a public HTTP entrypoint, background
 * job, queue consumer, or user-facing API.
 *
 * E1: one request, one stage, required injected stage functions.
 * E2: thrown/malformed stage normalization; explicit trusted dependency bundle;
 *     executeTrustedAccountDeletionReconcile execution boundary.
 * E3a: unreachable production stage wiring lives in separate modules; this file
 *     still never constructs live Stripe/Clerk/Supabase clients.
 *
 * Entrypoint clarity:
 * - Future production/scheduler callers MUST use executeTrustedAccountDeletionReconcile.
 * - reconcileAccountDeletionRequest remains lower-level internal/test compatibility.
 *
 * Never defaults to live orchestrators. Never constructs Stripe/Clerk/Supabase
 * clients. SMS production orchestrator is not auto-wired here.
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
  isAccountDeletionStatus,
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

export const STAGE_THREW_CODES = {
  sms: "sms_stage_threw",
  stripe: "stripe_stage_threw",
  purge: "purge_stage_threw",
  clerk: "clerk_stage_threw",
} as const;

export const STAGE_INVALID_RESULT_CODES = {
  sms: "sms_stage_invalid_result",
  stripe: "stripe_stage_invalid_result",
  purge: "purge_stage_invalid_result",
  clerk: "clerk_stage_invalid_result",
} as const;

const RECOGNIZED_ERROR_CODES: ReadonlySet<string> = new Set<AccountDeletionErrorCode>([
  "conflict_unresolved_exists",
  "not_found",
  "illegal_transition",
  "unsupported_orchestration_version",
  "lease_held",
  "lease_not_held",
  "cas_conflict",
  "invalid_argument",
  "internal_error",
]);

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

/**
 * Explicit trusted dependency bundle. No live provider defaults.
 * Construct only via createTrustedAccountDeletionReconcilerDependencies.
 */
export type AccountDeletionReconcilerDependencies = Readonly<{
  suppressSms: SuppressSmsStageFn;
  cancelStripe: CancelStripeStageFn;
  purgeAppData: PurgeAppDataStageFn;
  deleteClerk: DeleteClerkStageFn;
  clerkAdapter: ClerkDeletionAdapter;
}>;

export type CreateTrustedAccountDeletionReconcilerDependenciesInput = {
  suppressSms: SuppressSmsStageFn;
  cancelStripe: CancelStripeStageFn;
  purgeAppData: PurgeAppDataStageFn;
  deleteClerk: DeleteClerkStageFn;
  clerkAdapter: ClerkDeletionAdapter;
};

export type ReconcileAccountDeletionRequestInput = {
  requestId: string;
  lockOwner: string;
  leaseMs?: number;
  now?: Date;
  /** Required validated bundle — never defaults to live orchestrators. */
  dependencies: AccountDeletionReconcilerDependencies;
  /** Optional passthrough when wiring a Stripe-capable cancelStripe stage. */
  stripe?: DeletionStripeClient;
  getPublicMetadata?: CancelStripeSubscriptionsForDeletionInput["getPublicMetadata"];
  recognizedPriceIds?: Set<string>;
  /** Optional passthrough when wiring a purge-capable purgeAppData stage. */
  purgeFn?: (
    input: PurgeAppDataForDeletionInput
  ) => Promise<AccountDeletionRepoResult<PurgeAppDataForDeletionValue>>;
};

/**
 * Narrow internal execution boundary for a future trusted scheduler.
 * One request, one stage, required dependency bundle — no HTTP/cron objects.
 */
export type ExecuteTrustedAccountDeletionReconcileInput =
  ReconcileAccountDeletionRequestInput;

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
 * Build a frozen trusted dependency bundle. Rejects missing/invalid deps.
 * No live provider construction or environment auto-wiring.
 *
 * clerkAdapter is copied: the deleteUser function reference is captured at
 * construction so later mutation of the caller's adapter object cannot change
 * the trusted bundle's behavior.
 */
export function createTrustedAccountDeletionReconcilerDependencies(
  input: CreateTrustedAccountDeletionReconcilerDependenciesInput
): AccountDeletionReconcilerDependencies {
  if (!input || typeof input !== "object") {
    throw new Error("invalid_reconciler_dependencies");
  }
  if (typeof input.suppressSms !== "function") {
    throw new Error("invalid_reconciler_dependencies");
  }
  if (typeof input.cancelStripe !== "function") {
    throw new Error("invalid_reconciler_dependencies");
  }
  if (typeof input.purgeAppData !== "function") {
    throw new Error("invalid_reconciler_dependencies");
  }
  if (typeof input.deleteClerk !== "function") {
    throw new Error("invalid_reconciler_dependencies");
  }
  if (
    !input.clerkAdapter ||
    typeof input.clerkAdapter !== "object" ||
    typeof input.clerkAdapter.deleteUser !== "function"
  ) {
    throw new Error("invalid_reconciler_dependencies");
  }

  // Capture function refs now — do not retain a mutable shared adapter object.
  const deleteUserFn = input.clerkAdapter.deleteUser;
  const clerkAdapter: ClerkDeletionAdapter = Object.freeze({
    deleteUser: (args: { clerkUserId: string }) => deleteUserFn(args),
  });

  return Object.freeze({
    suppressSms: input.suppressSms,
    cancelStripe: input.cancelStripe,
    purgeAppData: input.purgeAppData,
    deleteClerk: input.deleteClerk,
    clerkAdapter,
  });
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
  return { outcome: "advanced", stage, request: project(row) };
}

function looksLikeRequestRow(value: unknown): value is AccountDeletionRequestRow {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    r.id.length > 0 &&
    typeof r.clerk_user_id === "string" &&
    typeof r.orchestration_version === "number" &&
    isAccountDeletionStatus(r.status) &&
    isAccountDeletionStatus(r.current_step)
  );
}

type ParsedStageOk = {
  kind: "ok";
  row: AccountDeletionRequestRow;
  alreadyDoneOutcome: boolean;
};

type ParsedStageResult =
  | ParsedStageOk
  | { kind: "fail"; code: AccountDeletionErrorCode }
  | { kind: "invalid" };

function parseStageResult(
  raw: unknown,
  stage: RoutedStage
): ParsedStageResult {
  if (raw == null || typeof raw !== "object") {
    return { kind: "invalid" };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.ok !== "boolean") {
    return { kind: "invalid" };
  }

  if (obj.ok === false) {
    if (
      typeof obj.code !== "string" ||
      !RECOGNIZED_ERROR_CODES.has(obj.code)
    ) {
      return { kind: "invalid" };
    }
    return { kind: "fail", code: obj.code as AccountDeletionErrorCode };
  }

  const value = obj.value;
  if (!value || typeof value !== "object") {
    return { kind: "invalid" };
  }
  const v = value as Record<string, unknown>;
  if (!looksLikeRequestRow(v.row)) {
    return { kind: "invalid" };
  }

  if (stage === "purge") {
    if (v.outcome !== "app_data_purged" && v.outcome !== "already_done") {
      return { kind: "invalid" };
    }
    return {
      kind: "ok",
      row: v.row,
      alreadyDoneOutcome: v.outcome === "already_done",
    };
  }

  if (stage === "clerk") {
    if (v.outcome !== "completed" && v.outcome !== "already_done") {
      return { kind: "invalid" };
    }
    return {
      kind: "ok",
      row: v.row,
      alreadyDoneOutcome: v.outcome === "already_done",
    };
  }

  // sms / stripe — row is enough for reconciler mapping
  return { kind: "ok", row: v.row, alreadyDoneOutcome: false };
}

function stageThrewResult(
  stage: RoutedStage
): AccountDeletionReconcileResult {
  return {
    outcome: "retryable_failure",
    stage,
    code: STAGE_THREW_CODES[stage],
  };
}

function stageInvalidResult(
  stage: RoutedStage
): AccountDeletionReconcileResult {
  return {
    outcome: "retryable_failure",
    stage,
    code: STAGE_INVALID_RESULT_CODES[stage],
  };
}

async function invokeStageSafely(
  stage: RoutedStage,
  invoke: () => Promise<unknown>
): Promise<AccountDeletionReconcileResult> {
  let raw: unknown;
  try {
    raw = await invoke();
  } catch {
    // Never expose thrown value, message, or stack.
    return stageThrewResult(stage);
  }

  const parsed = parseStageResult(raw, stage);
  if (parsed.kind === "invalid") {
    return stageInvalidResult(stage);
  }
  if (parsed.kind === "fail") {
    return mapRepoFailure(parsed.code, stage);
  }
  return mapStageSuccess({
    stage,
    row: parsed.row,
    alreadyDoneOutcome: parsed.alreadyDoneOutcome,
  });
}

/**
 * Inspect one durable account-deletion request and invoke exactly one injected
 * stage orchestrator for its current state. Idempotent; lease/CAS remain inside
 * the stage functions. Thrown/malformed stage outputs become retryable_failure.
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

  let dependencies: AccountDeletionReconcilerDependencies;
  try {
    dependencies = createTrustedAccountDeletionReconcilerDependencies(
      input.dependencies
    );
  } catch {
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
    return invokeStageSafely(stage, () =>
      dependencies.suppressSms({
        requestId,
        clerkUserId,
        lockOwner,
        leaseMs,
        now,
      })
    );
  }

  if (stage === "stripe") {
    return invokeStageSafely(stage, () =>
      dependencies.cancelStripe({
        requestId,
        clerkUserId,
        lockOwner,
        leaseMs,
        now,
        expectedOrchestrationVersion,
        stripe: input.stripe,
        getPublicMetadata: input.getPublicMetadata,
        recognizedPriceIds: input.recognizedPriceIds,
      })
    );
  }

  if (stage === "purge") {
    return invokeStageSafely(stage, () =>
      dependencies.purgeAppData({
        requestId,
        clerkUserId,
        lockOwner,
        leaseMs,
        now,
        expectedOrchestrationVersion,
        purgeFn: input.purgeFn,
      })
    );
  }

  // stage === "clerk"
  return invokeStageSafely(stage, () =>
    dependencies.deleteClerk({
      requestId,
      clerkUserId,
      lockOwner,
      leaseMs,
      now,
      expectedOrchestrationVersion,
      adapter: dependencies.clerkAdapter,
    })
  );
}

/**
 * Trusted one-request execution boundary for future scheduler/admin callers.
 *
 * Preferred production/scheduler entrypoint. Re-validates the dependency
 * bundle, then delegates to reconcileAccountDeletionRequest (lower-level
 * internal/test compatibility only — schedulers must not call it directly).
 *
 * Does not scan, schedule, or mutate durable state itself.
 */
export async function executeTrustedAccountDeletionReconcile(
  input: ExecuteTrustedAccountDeletionReconcileInput
): Promise<AccountDeletionReconcileResult> {
  return reconcileAccountDeletionRequest(input);
}
