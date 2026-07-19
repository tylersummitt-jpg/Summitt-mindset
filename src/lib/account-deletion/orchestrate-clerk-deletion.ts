/**
 * APP-041D1 — server-only Clerk deletion-last orchestrator (no public API).
 *
 * Advances a deletion request:
 *   app_data_purged → deleting_clerk → completed
 *
 * Clerk deletion is irreversible and must occur LAST. The orchestrator calls
 * only an injected ClerkDeletionAdapter. APP-041D1 does not call the real
 * Clerk API, create routes/workers, or expose public initiation.
 *
 * Version pins:
 * - Pre-adapter start/resume CAS may honor caller `expectedOrchestrationVersion`
 *   (fail closed on mismatch before irreversible work).
 * - After a durable Clerk success marker exists (or adapter just succeeded),
 *   final completed CAS always uses freshly reloaded `row.orchestration_version`
 *   and ignores a stale caller pin. Marker-first reconciliation skips resume CAS.
 *
 * Residual crash window: if the process dies after adapter success but before
 * the leased marker write, the next invocation may call the adapter again and
 * recover via `already_absent`. Marker + final CAS are not one DB txn.
 * Do not claim exactly-once.
 */

import "server-only";

import type {
  ClerkDeletionAdapter,
  ClerkDeletionOutcome,
} from "./clerk-deletion-adapter";
import {
  readAppDataPurgeRpcMarker,
  stepsLookNonPii,
} from "./orchestrate-app-data-purge";
import {
  DEFAULT_ACCOUNT_DELETION_LEASE_MS,
  acquireAccountDeletionLease,
  getAccountDeletionRequestById,
  markAccountDeletionCompleted,
  patchAccountDeletionRequestWhileLeased,
  recordAccountDeletionFailure,
  releaseAccountDeletionLease,
  transitionAccountDeletionRequest,
  type AccountDeletionRepoResult,
} from "./repository";
import type {
  AccountDeletionRequestRow,
  AccountDeletionStepResult,
  AccountDeletionStepsJson,
} from "./types";

const FINAL_CAS_MAX_ATTEMPTS = 3;

/** Durable, non-PII marker written after adapter success, before final CAS. */
export const CLERK_DELETE_RPC_STEP = "clerk_delete_rpc" as const;

/**
 * Hard cap for compact marker detail. Marker encoding MUST NOT use
 * sanitizeAccountDeletionErrorDetail (truncation/redaction can corrupt it).
 */
export const CLERK_DELETE_RPC_MARKER_DETAIL_MAX = 32;

/** Exact detail grammar for durable Clerk success markers. */
export const CLERK_DELETE_RPC_MARKER_DETAIL = "provider:clerk" as const;

/** Allowlisted durable failure codes (never adapter-supplied strings). */
export const CLERK_DELETE_ERROR_RETRYABLE = "clerk_delete_retryable_error" as const;
export const CLERK_DELETE_ERROR_TERMINAL_RETRYABLE =
  "clerk_delete_terminal_error_retryable" as const;
export const CLERK_DELETE_ERROR_INTERNAL = "clerk_delete_internal_error" as const;

const SUCCESSFUL_STEP_RESULTS: ReadonlySet<AccountDeletionStepResult> = new Set([
  "ok",
  "skipped",
  "already_done",
]);

const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const MARKER_ALLOWED_KEYS = new Set(["at", "ok", "code", "detail"]);

export type OrchestrateClerkDeletionInput = {
  requestId: string;
  clerkUserId: string;
  lockOwner: string;
  leaseMs?: number;
  now?: Date;
  /**
   * Optional CAS version pin for pre-adapter start/resume transitions only.
   * Ignored when a durable Clerk success marker already exists, and ignored
   * for post-adapter finalization (fresh repository version is used).
   */
  expectedOrchestrationVersion?: number;
  /** Required injected adapter. Production Clerk is not wired in D1. */
  adapter: ClerkDeletionAdapter;
};

export type OrchestrateClerkDeletionOutcome = "completed" | "already_done";

export type OrchestrateClerkDeletionValue = {
  row: AccountDeletionRequestRow;
  outcome: OrchestrateClerkDeletionOutcome;
  clerkResult: AccountDeletionStepResult;
};

export type ValidClerkDeleteRpcMarker = {
  outcome: Extract<ClerkDeletionOutcome, "deleted" | "already_absent">;
  at: string;
};

export type ClerkDeleteRpcMarkerRead =
  | { kind: "absent" }
  | { kind: "valid"; marker: ValidClerkDeleteRpcMarker }
  | { kind: "malformed"; reason: string };

function isSuccessfulStepResult(
  value: AccountDeletionStepResult | null
): boolean {
  return value != null && SUCCESSFUL_STEP_RESULTS.has(value);
}

export function isValidIsoTimestamp(value: string): boolean {
  if (!ISO_TIMESTAMP_RE.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

export function encodeClerkDeleteRpcMarkerDetail(): string {
  return CLERK_DELETE_RPC_MARKER_DETAIL;
}

export function parseClerkDeleteRpcMarkerDetail(
  detail: string | undefined
): boolean {
  if (typeof detail !== "string") return false;
  if (
    detail.length === 0 ||
    detail.length > CLERK_DELETE_RPC_MARKER_DETAIL_MAX
  ) {
    return false;
  }
  if (/\s/.test(detail)) return false;
  return detail === CLERK_DELETE_RPC_MARKER_DETAIL;
}

/**
 * Read durable post-adapter marker from repository steps.
 * Malformed / contradictory markers fail closed (never treated as absent).
 */
export function readClerkDeleteRpcMarker(
  row: Pick<AccountDeletionRequestRow, "steps">
): ClerkDeleteRpcMarkerRead {
  const step = row.steps?.[CLERK_DELETE_RPC_STEP];
  if (step == null) return { kind: "absent" };

  if (typeof step !== "object" || Array.isArray(step)) {
    return { kind: "malformed", reason: "not_object" };
  }

  for (const key of Object.keys(step)) {
    if (!MARKER_ALLOWED_KEYS.has(key)) {
      return { kind: "malformed", reason: "unknown_fields" };
    }
  }

  if (step.ok !== true) {
    return { kind: "malformed", reason: "ok_not_true" };
  }
  if (typeof step.at !== "string" || !isValidIsoTimestamp(step.at)) {
    return { kind: "malformed", reason: "invalid_at" };
  }
  if (step.code !== "deleted" && step.code !== "already_absent") {
    return { kind: "malformed", reason: "invalid_outcome" };
  }
  if (!parseClerkDeleteRpcMarkerDetail(step.detail)) {
    return { kind: "malformed", reason: "malformed_detail" };
  }
  if (!stepsLookNonPii({ [CLERK_DELETE_RPC_STEP]: step })) {
    return { kind: "malformed", reason: "pii_shape" };
  }

  return {
    kind: "valid",
    marker: {
      outcome: step.code,
      at: step.at,
    },
  };
}

function smsStageComplete(row: AccountDeletionRequestRow): boolean {
  return isSuccessfulStepResult(row.sms_result);
}

function stripeStageComplete(row: AccountDeletionRequestRow): boolean {
  return isSuccessfulStepResult(row.stripe_result);
}

function purgeStageComplete(row: AccountDeletionRequestRow): boolean {
  return isSuccessfulStepResult(row.purge_result);
}

/** SMS + Stripe + purge enums complete AND strict C3 purge marker valid. */
function priorStagesAndPurgeMarkerReady(
  row: AccountDeletionRequestRow
):
  | { ok: true }
  | { ok: false; code: "illegal_transition" | "cas_conflict"; message: string } {
  if (
    !smsStageComplete(row) ||
    !stripeStageComplete(row) ||
    !purgeStageComplete(row)
  ) {
    return {
      ok: false,
      code: "illegal_transition",
      message: "SMS/Stripe/purge stages incomplete; cannot delete Clerk",
    };
  }
  const purgeMarker = readAppDataPurgeRpcMarker(row);
  if (purgeMarker.kind === "absent") {
    return {
      ok: false,
      code: "illegal_transition",
      message: "Durable app_data_purge_rpc marker required before Clerk deletion",
    };
  }
  if (purgeMarker.kind === "malformed") {
    return {
      ok: false,
      code: "cas_conflict",
      message: `Durable app_data_purge_rpc marker is malformed: ${purgeMarker.reason}`,
    };
  }
  return { ok: true };
}

function mapAdapterOutcomeToClerkResult(
  outcome: Extract<ClerkDeletionOutcome, "deleted" | "already_absent">
): AccountDeletionStepResult {
  return outcome === "deleted" ? "ok" : "already_done";
}

function mapAdapterOutcomeToOrchestratorOutcome(
  outcome: Extract<ClerkDeletionOutcome, "deleted" | "already_absent">
): OrchestrateClerkDeletionOutcome {
  return outcome === "already_absent" ? "already_done" : "completed";
}

function hasContradictoryClerkResult(
  row: AccountDeletionRequestRow
): boolean {
  if (row.status === "completed") return false;
  if (
    row.clerk_result === "ok" ||
    row.clerk_result === "already_done" ||
    row.clerk_result === "skipped"
  ) {
    const marker = readClerkDeleteRpcMarker(row);
    if (marker.kind !== "valid") return true;
  }
  return false;
}

function internalFailureCode(
  outcome: Extract<ClerkDeletionOutcome, "retryable_error" | "terminal_error">
): string {
  return outcome === "terminal_error"
    ? CLERK_DELETE_ERROR_TERMINAL_RETRYABLE
    : CLERK_DELETE_ERROR_RETRYABLE;
}

async function persistClerkDeleteRpcMarker(input: {
  requestId: string;
  lockOwner: string;
  leaseMs: number;
  now: Date;
  rpcOutcome: "deleted" | "already_absent";
}): Promise<AccountDeletionRepoResult<AccountDeletionRequestRow>> {
  const fresh = await getAccountDeletionRequestById(input.requestId);
  if (!fresh) {
    return { ok: false, code: "not_found", message: "Request not found" };
  }
  if (fresh.status !== "deleting_clerk") {
    return {
      ok: false,
      code: "cas_conflict",
      message: `Cannot persist clerk delete marker from status ${fresh.status}`,
    };
  }

  const detail = encodeClerkDeleteRpcMarkerDetail();
  if (detail.length > CLERK_DELETE_RPC_MARKER_DETAIL_MAX) {
    return {
      ok: false,
      code: "internal_error",
      message: "Compact clerk delete marker detail could not be encoded",
    };
  }

  const steps: AccountDeletionStepsJson = {
    ...fresh.steps,
    [CLERK_DELETE_RPC_STEP]: {
      at: input.now.toISOString(),
      ok: true,
      code: input.rpcOutcome,
      detail,
    },
  };

  return patchAccountDeletionRequestWhileLeased({
    requestId: input.requestId,
    expectedStatus: "deleting_clerk",
    lockOwner: input.lockOwner,
    steps,
    leaseMs: input.leaseMs,
    now: input.now,
    expectedOrchestrationVersion: fresh.orchestration_version,
  });
}

/**
 * Bounded final CAS to completed. Always reloads and uses fresh.orchestration_version.
 * Requires ownership, prior stages, valid C3 purge marker, and valid Clerk marker.
 */
async function finalizeClerkDeletionCompleted(input: {
  requestId: string;
  expectedClerkUserId: string;
  lockOwner: string;
  leaseMs: number;
  now: Date;
  clerkResult: AccountDeletionStepResult;
}): Promise<AccountDeletionRepoResult<AccountDeletionRequestRow>> {
  let lastConflict: AccountDeletionRepoResult<AccountDeletionRequestRow> | null =
    null;

  for (let attempt = 0; attempt < FINAL_CAS_MAX_ATTEMPTS; attempt += 1) {
    const fresh = await getAccountDeletionRequestById(input.requestId);
    if (!fresh) {
      return { ok: false, code: "not_found", message: "Request not found" };
    }
    if (fresh.clerk_user_id !== input.expectedClerkUserId) {
      return {
        ok: false,
        code: "invalid_argument",
        message: "clerkUserId does not own this deletion request",
      };
    }
    if (fresh.status === "completed") {
      return { ok: true, value: fresh };
    }
    if (fresh.status !== "deleting_clerk") {
      return {
        ok: false,
        code: "cas_conflict",
        message: `Unexpected status after clerk delete: ${fresh.status}`,
      };
    }
    const prior = priorStagesAndPurgeMarkerReady(fresh);
    if (!prior.ok) {
      return {
        ok: false,
        code: prior.code,
        message: prior.message,
      };
    }
    const marker = readClerkDeleteRpcMarker(fresh);
    if (marker.kind !== "valid") {
      return {
        ok: false,
        code: "cas_conflict",
        message:
          marker.kind === "malformed"
            ? `Durable clerk delete marker is malformed: ${marker.reason}`
            : "Durable clerk delete marker required before completed",
      };
    }

    const cas = await markAccountDeletionCompleted({
      requestId: input.requestId,
      fromStatus: "deleting_clerk",
      lockOwner: input.lockOwner,
      leaseMs: input.leaseMs,
      now: input.now,
      expectedOrchestrationVersion: fresh.orchestration_version,
      clerkResult: input.clerkResult,
    });

    if (cas.ok) return cas;
    lastConflict = cas;
    if (cas.code !== "cas_conflict") return cas;
  }

  const again = await getAccountDeletionRequestById(input.requestId);
  if (again?.status === "completed") {
    return { ok: true, value: again };
  }
  return (
    lastConflict ?? {
      ok: false,
      code: "cas_conflict",
      message: "Final completed CAS could not be reconciled",
    }
  );
}

async function completeFromSuccessfulAdapter(input: {
  requestId: string;
  expectedClerkUserId: string;
  lockOwner: string;
  leaseMs: number;
  now: Date;
  rpcOutcome: "deleted" | "already_absent";
  markerAlreadyPresent: boolean;
}): Promise<
  | {
      ok: true;
      row: AccountDeletionRequestRow;
      outcome: OrchestrateClerkDeletionOutcome;
      clerkResult: AccountDeletionStepResult;
      leaseReleasedByCompletedCas: boolean;
    }
  | {
      ok: false;
      failure: AccountDeletionRepoResult<OrchestrateClerkDeletionValue>;
    }
> {
  if (!input.markerAlreadyPresent) {
    const marked = await persistClerkDeleteRpcMarker({
      requestId: input.requestId,
      lockOwner: input.lockOwner,
      leaseMs: input.leaseMs,
      now: input.now,
      rpcOutcome: input.rpcOutcome,
    });
    if (!marked.ok) {
      return {
        ok: false,
        failure: {
          ok: false,
          code:
            marked.code === "cas_conflict" || marked.code === "lease_not_held"
              ? "cas_conflict"
              : "internal_error",
          message:
            "Clerk delete adapter succeeded but durable marker could not be persisted",
        },
      };
    }
  }

  const mapped = mapAdapterOutcomeToClerkResult(input.rpcOutcome);
  const finalized = await finalizeClerkDeletionCompleted({
    requestId: input.requestId,
    expectedClerkUserId: input.expectedClerkUserId,
    lockOwner: input.lockOwner,
    leaseMs: input.leaseMs,
    now: input.now,
    clerkResult: mapped,
  });

  if (!finalized.ok) {
    return { ok: false, failure: finalized };
  }

  return {
    ok: true,
    row: finalized.value,
    outcome: mapAdapterOutcomeToOrchestratorOutcome(input.rpcOutcome),
    clerkResult: finalized.value.clerk_result ?? mapped,
    leaseReleasedByCompletedCas: finalized.value.status === "completed",
  };
}

async function recordClerkDeleteFailure(input: {
  requestId: string;
  lockOwner: string;
  leaseMs: number;
  now: Date;
  expectedOrchestrationVersion?: number;
  errorCode: string;
  errorDetail: string;
}): Promise<{
  failure: AccountDeletionRepoResult<OrchestrateClerkDeletionValue>;
  leaseAlreadyReleased: boolean;
}> {
  const failed = await recordAccountDeletionFailure({
    requestId: input.requestId,
    fromStatus: "deleting_clerk",
    terminal: false,
    errorCode: input.errorCode,
    errorDetail: input.errorDetail,
    lockOwner: input.lockOwner,
    leaseMs: input.leaseMs,
    now: input.now,
    expectedOrchestrationVersion: input.expectedOrchestrationVersion,
    clerkResult: "failed",
  });

  if (failed.ok) {
    return {
      leaseAlreadyReleased: true,
      failure: {
        ok: false,
        code: "internal_error",
        message: "Clerk deletion failed; request is failed_retryable",
      },
    };
  }
  return { leaseAlreadyReleased: false, failure: failed };
}

/**
 * Orchestrate Clerk deletion LAST for an account-deletion request.
 * Requires lockOwner and an injected adapter; acquires/releases the B1 lease.
 */
export async function orchestrateClerkDeletion(
  input: OrchestrateClerkDeletionInput
): Promise<AccountDeletionRepoResult<OrchestrateClerkDeletionValue>> {
  const clerkUserId = input.clerkUserId.trim();
  const lockOwner = input.lockOwner.trim();
  const requestId = input.requestId.trim();
  if (!clerkUserId || !lockOwner || !requestId) {
    return {
      ok: false,
      code: "invalid_argument",
      message: "requestId, clerkUserId, and lockOwner are required",
    };
  }
  if (!input.adapter || typeof input.adapter.deleteUser !== "function") {
    return {
      ok: false,
      code: "invalid_argument",
      message: "Injected ClerkDeletionAdapter is required",
    };
  }

  const leaseMs = input.leaseMs ?? DEFAULT_ACCOUNT_DELETION_LEASE_MS;
  const now = input.now ?? new Date();
  const expectedOrchestrationVersion = input.expectedOrchestrationVersion;
  const adapter = input.adapter;

  const existing = await getAccountDeletionRequestById(requestId);
  if (!existing) {
    return { ok: false, code: "not_found", message: "Request not found" };
  }
  if (existing.clerk_user_id !== clerkUserId) {
    return {
      ok: false,
      code: "invalid_argument",
      message: "clerkUserId does not own this deletion request",
    };
  }

  if (existing.status === "failed_terminal") {
    return {
      ok: false,
      code: "illegal_transition",
      message: `Cannot delete Clerk from status ${existing.status}`,
    };
  }

  if (existing.status === "completed") {
    return {
      ok: true,
      value: {
        row: existing,
        outcome: "already_done",
        clerkResult: existing.clerk_result ?? "already_done",
      },
    };
  }

  if (hasContradictoryClerkResult(existing)) {
    return {
      ok: false,
      code: "illegal_transition",
      message: "Contradictory clerk_result without durable success marker",
    };
  }

  const preLeaseClerkMarker = readClerkDeleteRpcMarker(existing);
  if (preLeaseClerkMarker.kind === "malformed") {
    return {
      ok: false,
      code: "cas_conflict",
      message: `Durable clerk delete marker is malformed: ${preLeaseClerkMarker.reason}`,
    };
  }

  const lease = await acquireAccountDeletionLease({
    requestId,
    lockOwner,
    leaseMs,
    now,
  });
  if (!lease.ok) return lease;

  let row = lease.value;
  let finalRow: AccountDeletionRequestRow | null = null;
  let earlyFailure: AccountDeletionRepoResult<OrchestrateClerkDeletionValue> | null =
    null;
  let successOutcome: OrchestrateClerkDeletionOutcome | null = null;
  let successClerkResult: AccountDeletionStepResult | null = null;
  let leaseAlreadyReleased = false;

  try {
    const reloaded = await getAccountDeletionRequestById(requestId);
    if (!reloaded) {
      earlyFailure = {
        ok: false,
        code: "not_found",
        message: "Request not found after lease",
      };
    } else if (reloaded.clerk_user_id !== clerkUserId) {
      earlyFailure = {
        ok: false,
        code: "invalid_argument",
        message: "clerkUserId does not own this deletion request",
      };
    } else {
      row = reloaded;
    }

    // Marker-first: valid Clerk success marker → CAS-only (ignore caller version).
    if (!earlyFailure && !finalRow) {
      const clerkMarker = readClerkDeleteRpcMarker(row);
      if (clerkMarker.kind === "malformed") {
        earlyFailure = {
          ok: false,
          code: "cas_conflict",
          message: `Durable clerk delete marker is malformed: ${clerkMarker.reason}`,
        };
      } else if (clerkMarker.kind === "valid") {
        if (row.status === "completed") {
          finalRow = row;
          successOutcome = "already_done";
          successClerkResult = row.clerk_result ?? "already_done";
        } else if (
          row.status === "deleting_clerk" ||
          (row.status === "failed_retryable" &&
            row.current_step === "deleting_clerk")
        ) {
          // Bring failed_retryable back to deleting_clerk without caller version pin.
          if (row.status === "failed_retryable") {
            const prior = priorStagesAndPurgeMarkerReady(row);
            if (!prior.ok) {
              earlyFailure = {
                ok: false,
                code: prior.code,
                message: prior.message,
              };
            } else {
              const resume = await transitionAccountDeletionRequest({
                requestId,
                fromStatus: "failed_retryable",
                toStatus: "deleting_clerk",
                lockOwner,
                leaseMs,
                now,
                // Fresh durable version only — ignore stale caller pin.
                expectedOrchestrationVersion: row.orchestration_version,
                clerkResult: "pending",
                stepNote: { ok: true, code: "clerk_delete_marker_reconcile" },
              });
              if (!resume.ok) {
                earlyFailure = resume;
              } else {
                row = resume.value;
              }
            }
          }

          if (!earlyFailure) {
            const completed = await completeFromSuccessfulAdapter({
              requestId,
              expectedClerkUserId: clerkUserId,
              lockOwner,
              leaseMs,
              now,
              rpcOutcome: clerkMarker.marker.outcome,
              markerAlreadyPresent: true,
            });
            if (!completed.ok) {
              earlyFailure = completed.failure;
            } else {
              finalRow = completed.row;
              successOutcome = completed.outcome;
              successClerkResult = completed.clerkResult;
              if (completed.leaseReleasedByCompletedCas) {
                leaseAlreadyReleased = true;
              }
            }
          }
        } else {
          earlyFailure = {
            ok: false,
            code: "illegal_transition",
            message: `Valid clerk delete marker present but status ${row.status} is not reconciliable`,
          };
        }
      }
    }

    // No valid Clerk marker yet → normal start/resume then adapter.
    if (!earlyFailure && !finalRow) {
      if (row.status === "completed") {
        finalRow = row;
        successOutcome = "already_done";
        successClerkResult = row.clerk_result ?? "already_done";
      } else if (row.status === "app_data_purged") {
        const prior = priorStagesAndPurgeMarkerReady(row);
        if (!prior.ok) {
          earlyFailure = {
            ok: false,
            code: prior.code,
            message: prior.message,
          };
        } else {
          const toDeleting = await transitionAccountDeletionRequest({
            requestId,
            fromStatus: "app_data_purged",
            toStatus: "deleting_clerk",
            lockOwner,
            leaseMs,
            now,
            expectedOrchestrationVersion,
            clerkResult: "pending",
            stepNote: { ok: true, code: "clerk_delete_begin" },
          });
          if (!toDeleting.ok) {
            earlyFailure = toDeleting;
          } else {
            row = toDeleting.value;
          }
        }
      } else if (row.status === "failed_retryable") {
        if (row.current_step !== "deleting_clerk") {
          earlyFailure = {
            ok: false,
            code: "illegal_transition",
            message: `Cannot resume Clerk deletion from current_step ${row.current_step}`,
          };
        } else {
          const prior = priorStagesAndPurgeMarkerReady(row);
          if (!prior.ok) {
            earlyFailure = {
              ok: false,
              code: prior.code,
              message: prior.message,
            };
          } else {
            const resume = await transitionAccountDeletionRequest({
              requestId,
              fromStatus: "failed_retryable",
              toStatus: "deleting_clerk",
              lockOwner,
              leaseMs,
              now,
              expectedOrchestrationVersion,
              clerkResult: "pending",
              stepNote: { ok: true, code: "clerk_delete_retry" },
            });
            if (!resume.ok) {
              earlyFailure = resume;
            } else {
              row = resume.value;
            }
          }
        }
      } else if (row.status === "deleting_clerk") {
        if (
          row.clerk_result != null &&
          row.clerk_result !== "pending" &&
          row.clerk_result !== "failed"
        ) {
          earlyFailure = {
            ok: false,
            code: "illegal_transition",
            message: `Unexpected clerk_result while deleting_clerk: ${row.clerk_result}`,
          };
        } else {
          const prior = priorStagesAndPurgeMarkerReady(row);
          if (!prior.ok) {
            earlyFailure = {
              ok: false,
              code: prior.code,
              message: prior.message,
            };
          }
        }
      } else {
        earlyFailure = {
          ok: false,
          code: "illegal_transition",
          message: `Cannot delete Clerk from status ${row.status}`,
        };
      }
    }

    if (!earlyFailure && !finalRow) {
      if (
        row.status !== "deleting_clerk" ||
        row.current_step !== "deleting_clerk"
      ) {
        earlyFailure = {
          ok: false,
          code: "cas_conflict",
          message: "Expected deleting_clerk before Clerk adapter",
        };
      }
    }

    if (!earlyFailure && !finalRow) {
      // Re-assert C3 purge marker immediately before irreversible adapter.
      const prior = priorStagesAndPurgeMarkerReady(row);
      if (!prior.ok) {
        earlyFailure = {
          ok: false,
          code: prior.code,
          message: prior.message,
        };
      } else {
        let adapterResult;
        try {
          // Defense-in-depth: always pass durable row ownership id.
          adapterResult = await adapter.deleteUser({
            clerkUserId: row.clerk_user_id,
          });
        } catch {
          const recorded = await recordClerkDeleteFailure({
            requestId,
            lockOwner,
            leaseMs,
            now,
            expectedOrchestrationVersion:
              expectedOrchestrationVersion ?? row.orchestration_version,
            errorCode: CLERK_DELETE_ERROR_INTERNAL,
            errorDetail: "adapter_threw",
          });
          leaseAlreadyReleased = recorded.leaseAlreadyReleased;
          earlyFailure = recorded.failure;
          adapterResult = null;
        }

        if (adapterResult) {
          if (
            adapterResult.outcome === "deleted" ||
            adapterResult.outcome === "already_absent"
          ) {
            const completed = await completeFromSuccessfulAdapter({
              requestId,
              expectedClerkUserId: clerkUserId,
              lockOwner,
              leaseMs,
              now,
              rpcOutcome: adapterResult.outcome,
              markerAlreadyPresent: false,
            });
            if (!completed.ok) {
              earlyFailure = completed.failure;
            } else {
              finalRow = completed.row;
              successOutcome = completed.outcome;
              successClerkResult = completed.clerkResult;
              if (completed.leaseReleasedByCompletedCas) {
                leaseAlreadyReleased = true;
              }
            }
          } else {
            // Discard adapterResult.code entirely; allowlisted internal codes only.
            const recorded = await recordClerkDeleteFailure({
              requestId,
              lockOwner,
              leaseMs,
              now,
              expectedOrchestrationVersion:
                expectedOrchestrationVersion ?? row.orchestration_version,
              errorCode: internalFailureCode(adapterResult.outcome),
              errorDetail: adapterResult.outcome,
            });
            leaseAlreadyReleased = recorded.leaseAlreadyReleased;
            earlyFailure = recorded.failure;
          }
        }
      }
    }
  } finally {
    if (!leaseAlreadyReleased) {
      const current = await getAccountDeletionRequestById(requestId);
      if (current?.lock_owner === lockOwner) {
        const release = await releaseAccountDeletionLease({
          requestId,
          lockOwner,
          now,
        });
        if (!release.ok) {
          console.error(
            "[orchestrateClerkDeletion] lease release failed",
            release
          );
        } else if (finalRow) {
          finalRow = release.value;
        }
      } else if (current && finalRow) {
        finalRow = current;
      }
    }
  }

  if (earlyFailure) return earlyFailure;

  if (!finalRow || !successOutcome || !successClerkResult) {
    return {
      ok: false,
      code: "internal_error",
      message: "Clerk deletion orchestration did not complete",
    };
  }

  const latest = await getAccountDeletionRequestById(requestId);
  const outRow = latest ?? finalRow;

  return {
    ok: true,
    value: {
      row: outRow,
      outcome: successOutcome,
      clerkResult: outRow.clerk_result ?? successClerkResult,
    },
  };
}

/** Test helper: expose eligibility without importing internals. */
export function isEligiblePriorStagesForClerkDeletion(
  row: Pick<
    AccountDeletionRequestRow,
    "sms_result" | "stripe_result" | "purge_result" | "steps"
  >
): boolean {
  if (
    !isSuccessfulStepResult(row.sms_result) ||
    !isSuccessfulStepResult(row.stripe_result) ||
    !isSuccessfulStepResult(row.purge_result)
  ) {
    return false;
  }
  return readAppDataPurgeRpcMarker(row).kind === "valid";
}
