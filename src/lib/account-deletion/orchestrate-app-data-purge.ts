/**
 * APP-041C3 — server-only app-data purge orchestrator (no public API).
 *
 * Advances a deletion request:
 *   subscription_canceled → purging_app_data → app_data_purged
 *
 * Calls the validated C2 helper `purgeAppDataForDeletion` (service-role RPC).
 * Does NOT: delete Clerk, call Stripe/Twilio, expose HTTP, create cron/worker,
 * or invent STOP evidence. Lease acquire/release mirrors B2a/B3a.
 *
 * Version pins:
 * - Pre-purge start/resume CAS may honor caller `expectedOrchestrationVersion`
 *   (fail closed on mismatch before destructive work).
 * - After successful purge RPC (or when a durable post-RPC marker exists),
 *   final app_data_purged CAS always uses freshly reloaded
 *   `row.orchestration_version` and ignores a stale caller pin.
 *
 * Residual crash window: if the process dies after purge RPC success but
 * before the leased marker write, the next invocation may call purge again
 * and recover via `already_absent`. Marker + final CAS are not one DB txn.
 */

import "server-only";

import {
  purgeAppDataForDeletion,
  type PurgeAppDataForDeletionInput,
  type PurgeAppDataForDeletionValue,
  type PurgeAppDataOutcome,
} from "./purge-app-data";
import { sanitizeAccountDeletionErrorDetail } from "./sanitize";
import {
  DEFAULT_ACCOUNT_DELETION_LEASE_MS,
  acquireAccountDeletionLease,
  getAccountDeletionRequestById,
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

/** Durable, non-PII marker written after purge RPC success, before final CAS. */
export const APP_DATA_PURGE_RPC_STEP = "app_data_purge_rpc" as const;

/**
 * Hard cap for compact marker detail. Intentionally far below sanitize's 500
 * truncate and any jsonb practical limits. Marker encoding MUST NOT use
 * sanitizeAccountDeletionErrorDetail (truncation/redaction can corrupt it).
 */
export const APP_DATA_PURGE_RPC_MARKER_DETAIL_MAX = 120;

const SUCCESSFUL_STEP_RESULTS: ReadonlySet<AccountDeletionStepResult> = new Set([
  "ok",
  "skipped",
  "already_done",
]);

const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export type OrchestrateAppDataPurgeInput = {
  requestId: string;
  clerkUserId: string;
  lockOwner: string;
  leaseMs?: number;
  now?: Date;
  /**
   * Optional CAS version pin for pre-purge start/resume transitions only.
   * Ignored for post-purge finalization (fresh repository version is used).
   */
  expectedOrchestrationVersion?: number;
  /** Test injection; production uses purgeAppDataForDeletion. */
  purgeFn?: (
    input: PurgeAppDataForDeletionInput
  ) => Promise<AccountDeletionRepoResult<PurgeAppDataForDeletionValue>>;
};

export type OrchestrateAppDataPurgeOutcome =
  | "app_data_purged"
  | "already_done";

export type OrchestrateAppDataPurgeValue = {
  row: AccountDeletionRequestRow;
  outcome: OrchestrateAppDataPurgeOutcome;
  purgeResult: AccountDeletionStepResult;
  counts: Record<string, number>;
};

export type PurgeCountsAggregate = {
  categoryCount: number;
  deletedTotal: number;
};

export type ValidAppDataPurgeRpcMarker = {
  outcome: Extract<PurgeAppDataOutcome, "purged" | "already_absent">;
  categoryCount: number;
  deletedTotal: number;
  at: string;
};

export type AppDataPurgeRpcMarkerRead =
  | { kind: "absent" }
  | { kind: "valid"; marker: ValidAppDataPurgeRpcMarker }
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

/**
 * Validate purge count map in memory. Does not persist individual keys.
 * Fail closed on non-integer / negative / unsafe / overflow.
 */
export function summarizePurgeCounts(
  counts: unknown
): PurgeCountsAggregate | null {
  if (counts == null || typeof counts !== "object" || Array.isArray(counts)) {
    return null;
  }
  let categoryCount = 0;
  let deletedTotal = 0;
  for (const [key, value] of Object.entries(
    counts as Record<string, unknown>
  )) {
    if (
      typeof key !== "string" ||
      key.length === 0 ||
      key.length > 80 ||
      !/^[a-z0-9_]+$/i.test(key)
    ) {
      return null;
    }
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0 ||
      !Number.isSafeInteger(value)
    ) {
      return null;
    }
    categoryCount += 1;
    if (deletedTotal > Number.MAX_SAFE_INTEGER - value) {
      return null;
    }
    deletedTotal += value;
  }
  if (
    !Number.isSafeInteger(categoryCount) ||
    !Number.isSafeInteger(deletedTotal)
  ) {
    return null;
  }
  return { categoryCount, deletedTotal };
}

/**
 * Compact operational step detail (no per-table names). Safe under 120 chars.
 * Used for app_data_purged / incomplete step notes — not the durable marker.
 */
export function formatPurgeCountsDetail(
  counts: Record<string, number>
): string {
  const agg = summarizePurgeCounts(counts);
  if (!agg) return "categories:0;deleted_total:0";
  return `categories:${agg.categoryCount};deleted_total:${agg.deletedTotal}`;
}

/**
 * Dedicated compact marker encoder. Never uses sanitizeAccountDeletionErrorDetail.
 * Grammar: limitations:0;categories:<n>;deleted_total:<n>
 */
export function encodeAppDataPurgeRpcMarkerDetail(
  agg: PurgeCountsAggregate
): string | null {
  if (
    !Number.isSafeInteger(agg.categoryCount) ||
    agg.categoryCount < 0 ||
    !Number.isSafeInteger(agg.deletedTotal) ||
    agg.deletedTotal < 0
  ) {
    return null;
  }
  const detail = `limitations:0;categories:${agg.categoryCount};deleted_total:${agg.deletedTotal}`;
  if (detail.length > APP_DATA_PURGE_RPC_MARKER_DETAIL_MAX) {
    return null;
  }
  return detail;
}

/**
 * Strict compact marker detail parser. Exact tokens; no whitespace; no unknown keys.
 */
export function parseAppDataPurgeRpcMarkerDetail(
  detail: string | undefined
): PurgeCountsAggregate | null {
  if (typeof detail !== "string") return null;
  if (detail.length === 0 || detail.length > APP_DATA_PURGE_RPC_MARKER_DETAIL_MAX) {
    return null;
  }
  if (/\s/.test(detail)) return null;

  if (detail === "limitations:0") {
    return { categoryCount: 0, deletedTotal: 0 };
  }

  const parts = detail.split(";");
  if (parts.length !== 3) return null;

  const seen = new Set<string>();
  let limitations: number | null = null;
  let categoryCount: number | null = null;
  let deletedTotal: number | null = null;

  for (const part of parts) {
    if (!part) return null;
    const colon = part.indexOf(":");
    if (colon <= 0 || colon !== part.lastIndexOf(":")) return null;
    const key = part.slice(0, colon);
    const raw = part.slice(colon + 1);
    if (seen.has(key)) return null;
    seen.add(key);
    if (!/^\d{1,16}$/.test(raw)) return null;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 0) return null;
    if (key === "limitations") limitations = n;
    else if (key === "categories") categoryCount = n;
    else if (key === "deleted_total") deletedTotal = n;
    else return null;
  }

  if (limitations !== 0) return null;
  if (categoryCount == null || deletedTotal == null) return null;
  if (seen.size !== 3) return null;
  if (!seen.has("limitations") || !seen.has("categories") || !seen.has("deleted_total")) {
    return null;
  }
  // Exact key order required for the three-field form.
  if (
    parts[0] !== `limitations:0` ||
    !parts[1]!.startsWith("categories:") ||
    !parts[2]!.startsWith("deleted_total:")
  ) {
    return null;
  }

  return { categoryCount, deletedTotal };
}

/**
 * Read durable post-RPC marker from repository steps.
 * Malformed / contradictory markers fail closed (never treated as absent).
 */
export function readAppDataPurgeRpcMarker(
  row: Pick<AccountDeletionRequestRow, "steps">
): AppDataPurgeRpcMarkerRead {
  const step = row.steps?.[APP_DATA_PURGE_RPC_STEP];
  if (step == null) return { kind: "absent" };

  if (step.ok !== true) {
    return { kind: "malformed", reason: "ok_not_true" };
  }
  if (typeof step.at !== "string" || !isValidIsoTimestamp(step.at)) {
    return { kind: "malformed", reason: "invalid_at" };
  }
  if (step.code !== "purged" && step.code !== "already_absent") {
    return { kind: "malformed", reason: "invalid_outcome" };
  }

  const agg = parseAppDataPurgeRpcMarkerDetail(step.detail);
  if (agg == null) {
    return { kind: "malformed", reason: "malformed_detail" };
  }

  if (!stepsLookNonPii({ [APP_DATA_PURGE_RPC_STEP]: step })) {
    return { kind: "malformed", reason: "pii_shape" };
  }

  return {
    kind: "valid",
    marker: {
      outcome: step.code,
      categoryCount: agg.categoryCount,
      deletedTotal: agg.deletedTotal,
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

function mapPurgeOutcomeToResult(
  outcome: Extract<PurgeAppDataOutcome, "purged" | "already_absent">
): AccountDeletionStepResult {
  return outcome === "purged" ? "ok" : "already_done";
}

function mapPurgeOutcomeToOrchestratorOutcome(
  outcome: Extract<PurgeAppDataOutcome, "purged" | "already_absent">
): OrchestrateAppDataPurgeOutcome {
  return outcome === "already_absent" ? "already_done" : "app_data_purged";
}

async function persistAppDataPurgeRpcMarker(input: {
  requestId: string;
  lockOwner: string;
  leaseMs: number;
  now: Date;
  rpcOutcome: "purged" | "already_absent";
  aggregate: PurgeCountsAggregate;
}): Promise<AccountDeletionRepoResult<AccountDeletionRequestRow>> {
  const fresh = await getAccountDeletionRequestById(input.requestId);
  if (!fresh) {
    return { ok: false, code: "not_found", message: "Request not found" };
  }
  if (fresh.status !== "purging_app_data") {
    return {
      ok: false,
      code: "cas_conflict",
      message: `Cannot persist purge RPC marker from status ${fresh.status}`,
    };
  }

  const detail = encodeAppDataPurgeRpcMarkerDetail(input.aggregate);
  if (detail == null) {
    return {
      ok: false,
      code: "internal_error",
      message: "Compact purge RPC marker detail could not be encoded",
    };
  }

  const steps: AccountDeletionStepsJson = {
    ...fresh.steps,
    [APP_DATA_PURGE_RPC_STEP]: {
      at: input.now.toISOString(),
      ok: true,
      code: input.rpcOutcome,
      detail,
    },
  };

  return patchAccountDeletionRequestWhileLeased({
    requestId: input.requestId,
    expectedStatus: "purging_app_data",
    lockOwner: input.lockOwner,
    steps,
    leaseMs: input.leaseMs,
    now: input.now,
    // Always use repository truth for marker write.
    expectedOrchestrationVersion: fresh.orchestration_version,
  });
}

/**
 * Bounded final CAS. Always reloads and uses fresh.orchestration_version.
 * Caller pin must not override post-purge reconciliation.
 * Step detail uses compact aggregates only (not per-table names).
 */
async function finalizeAppDataPurged(input: {
  requestId: string;
  lockOwner: string;
  leaseMs: number;
  now: Date;
  purgeResult: AccountDeletionStepResult;
  aggregate: PurgeCountsAggregate;
  rpcOutcome: "purged" | "already_absent";
}): Promise<AccountDeletionRepoResult<AccountDeletionRequestRow>> {
  const detail = `limitations:0;categories:${input.aggregate.categoryCount};deleted_total:${input.aggregate.deletedTotal}`;
  let lastConflict: AccountDeletionRepoResult<AccountDeletionRequestRow> | null =
    null;

  for (let attempt = 0; attempt < FINAL_CAS_MAX_ATTEMPTS; attempt += 1) {
    const fresh = await getAccountDeletionRequestById(input.requestId);
    if (!fresh) {
      return { ok: false, code: "not_found", message: "Request not found" };
    }
    if (fresh.status === "app_data_purged") {
      return { ok: true, value: fresh };
    }
    if (fresh.status !== "purging_app_data") {
      return {
        ok: false,
        code: "cas_conflict",
        message: `Unexpected status after purge: ${fresh.status}`,
      };
    }

    // Preserve successful RPC marker; merge into steps via transition helper.
    const cas = await transitionAccountDeletionRequest({
      requestId: input.requestId,
      fromStatus: "purging_app_data",
      toStatus: "app_data_purged",
      lockOwner: input.lockOwner,
      leaseMs: input.leaseMs,
      now: input.now,
      expectedOrchestrationVersion: fresh.orchestration_version,
      purgeResult: input.purgeResult,
      stepNote: {
        ok: true,
        code:
          input.rpcOutcome === "purged"
            ? "app_data_purged"
            : "app_data_already_absent",
        detail,
      },
    });

    if (cas.ok) return cas;
    lastConflict = cas;
    if (cas.code !== "cas_conflict") return cas;
  }

  const again = await getAccountDeletionRequestById(input.requestId);
  if (again?.status === "app_data_purged") {
    return { ok: true, value: again };
  }
  return (
    lastConflict ?? {
      ok: false,
      code: "cas_conflict",
      message: "Final app_data_purged CAS could not be reconciled",
    }
  );
}

async function completeFromSuccessfulRpc(input: {
  requestId: string;
  lockOwner: string;
  leaseMs: number;
  now: Date;
  rpcOutcome: "purged" | "already_absent";
  aggregate: PurgeCountsAggregate;
  /** Original counts when available (empty when reconciling from marker only). */
  counts: Record<string, number>;
  /** When true, marker already exists; skip persistence. */
  markerAlreadyPresent: boolean;
}): Promise<
  | {
      ok: true;
      row: AccountDeletionRequestRow;
      outcome: OrchestrateAppDataPurgeOutcome;
      purgeResult: AccountDeletionStepResult;
      counts: Record<string, number>;
    }
  | { ok: false; failure: AccountDeletionRepoResult<OrchestrateAppDataPurgeValue> }
> {
  if (!input.markerAlreadyPresent) {
    const marked = await persistAppDataPurgeRpcMarker({
      requestId: input.requestId,
      lockOwner: input.lockOwner,
      leaseMs: input.leaseMs,
      now: input.now,
      rpcOutcome: input.rpcOutcome,
      aggregate: input.aggregate,
    });
    if (!marked.ok) {
      // Residual window: purge already ran; marker write failed. Do not claim
      // app_data_purged. Leave marker absent so next call may re-purge → already_absent.
      return {
        ok: false,
        failure: {
          ok: false,
          code:
            marked.code === "cas_conflict" || marked.code === "lease_not_held"
              ? "cas_conflict"
              : "internal_error",
          message:
            "Purge RPC succeeded but durable marker could not be persisted",
        },
      };
    }
  }

  const mapped = mapPurgeOutcomeToResult(input.rpcOutcome);
  const finalized = await finalizeAppDataPurged({
    requestId: input.requestId,
    lockOwner: input.lockOwner,
    leaseMs: input.leaseMs,
    now: input.now,
    purgeResult: mapped,
    aggregate: input.aggregate,
    rpcOutcome: input.rpcOutcome,
  });

  if (!finalized.ok) {
    // Marker remains intact; do not recordFailure / set purge_result=failed.
    return { ok: false, failure: finalized };
  }

  return {
    ok: true,
    row: finalized.value,
    outcome: mapPurgeOutcomeToOrchestratorOutcome(input.rpcOutcome),
    purgeResult: finalized.value.purge_result ?? mapped,
    counts: input.counts,
  };
}

/**
 * Orchestrate app-data purge for an account-deletion request.
 * Requires lockOwner; acquires/releases the B1 lease around the work.
 */
export async function orchestrateAppDataPurge(
  input: OrchestrateAppDataPurgeInput
): Promise<AccountDeletionRepoResult<OrchestrateAppDataPurgeValue>> {
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

  const leaseMs = input.leaseMs ?? DEFAULT_ACCOUNT_DELETION_LEASE_MS;
  const now = input.now ?? new Date();
  const expectedOrchestrationVersion = input.expectedOrchestrationVersion;
  const purgeFn = input.purgeFn ?? purgeAppDataForDeletion;

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

  if (
    existing.status === "completed" ||
    existing.status === "failed_terminal"
  ) {
    return {
      ok: false,
      code: "illegal_transition",
      message: `Cannot purge app data from status ${existing.status}`,
    };
  }

  // Idempotent milestone: ownership already verified; skip lease bump.
  if (existing.status === "app_data_purged") {
    return {
      ok: true,
      value: {
        row: existing,
        outcome: "already_done",
        purgeResult: existing.purge_result ?? "already_done",
        counts: {},
      },
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
  let earlyFailure: AccountDeletionRepoResult<OrchestrateAppDataPurgeValue> | null =
    null;
  let successOutcome: OrchestrateAppDataPurgeOutcome | null = null;
  let successPurgeResult: AccountDeletionStepResult | null = null;
  let successCounts: Record<string, number> = {};
  let leaseAlreadyReleased = false;

  try {
    if (row.status === "subscription_canceled") {
      if (!smsStageComplete(row)) {
        earlyFailure = {
          ok: false,
          code: "illegal_transition",
          message: "SMS stage incomplete; cannot begin app-data purge",
        };
      } else if (!stripeStageComplete(row)) {
        earlyFailure = {
          ok: false,
          code: "illegal_transition",
          message: "Stripe cancellation incomplete; cannot begin app-data purge",
        };
      } else {
        const toPurging = await transitionAccountDeletionRequest({
          requestId,
          fromStatus: "subscription_canceled",
          toStatus: "purging_app_data",
          lockOwner,
          leaseMs,
          now,
          expectedOrchestrationVersion,
          purgeResult: "pending",
          stepNote: { ok: true, code: "app_data_purge_begin" },
        });
        if (!toPurging.ok) {
          earlyFailure = toPurging;
        } else {
          row = toPurging.value;
        }
      }
    } else if (row.status === "failed_retryable") {
      if (row.current_step !== "purging_app_data") {
        earlyFailure = {
          ok: false,
          code: "illegal_transition",
          message: `Cannot resume purge from current_step ${row.current_step}`,
        };
      } else if (!smsStageComplete(row) || !stripeStageComplete(row)) {
        earlyFailure = {
          ok: false,
          code: "illegal_transition",
          message: "SMS/Stripe prerequisites incomplete for purge retry",
        };
      } else {
        const resume = await transitionAccountDeletionRequest({
          requestId,
          fromStatus: "failed_retryable",
          toStatus: "purging_app_data",
          lockOwner,
          leaseMs,
          now,
          expectedOrchestrationVersion,
          purgeResult: "pending",
          stepNote: { ok: true, code: "app_data_purge_retry" },
        });
        if (!resume.ok) {
          earlyFailure = resume;
        } else {
          row = resume.value;
        }
      }
    } else if (row.status === "purging_app_data") {
      if (
        row.purge_result != null &&
        row.purge_result !== "pending" &&
        row.purge_result !== "failed"
      ) {
        earlyFailure = {
          ok: false,
          code: "illegal_transition",
          message: `Unexpected purge_result while purging_app_data: ${row.purge_result}`,
        };
      } else if (!smsStageComplete(row) || !stripeStageComplete(row)) {
        earlyFailure = {
          ok: false,
          code: "illegal_transition",
          message: "SMS/Stripe prerequisites incomplete while purging_app_data",
        };
      }
      // else: pending or failed → inspect marker / retry under lease
    } else if (row.status === "app_data_purged") {
      finalRow = row;
      successOutcome = "already_done";
      successPurgeResult = row.purge_result ?? "already_done";
      successCounts = {};
    } else {
      earlyFailure = {
        ok: false,
        code: "illegal_transition",
        message: `Cannot purge app data from status ${row.status}`,
      };
    }

    if (!earlyFailure && !finalRow) {
      if (
        row.status !== "purging_app_data" ||
        row.current_step !== "purging_app_data"
      ) {
        earlyFailure = {
          ok: false,
          code: "cas_conflict",
          message: "Expected purging_app_data before purge RPC",
        };
      }
    }

    if (!earlyFailure && !finalRow) {
      const markerRead = readAppDataPurgeRpcMarker(row);

      if (markerRead.kind === "malformed") {
        earlyFailure = {
          ok: false,
          code: "cas_conflict",
          message: `Durable purge RPC marker is malformed: ${markerRead.reason}`,
        };
      } else if (markerRead.kind === "valid") {
        // CAS-only reconciliation; do not re-call purge RPC.
        const completed = await completeFromSuccessfulRpc({
          requestId,
          lockOwner,
          leaseMs,
          now,
          rpcOutcome: markerRead.marker.outcome,
          aggregate: {
            categoryCount: markerRead.marker.categoryCount,
            deletedTotal: markerRead.marker.deletedTotal,
          },
          counts: {},
          markerAlreadyPresent: true,
        });
        if (!completed.ok) {
          earlyFailure = completed.failure;
        } else {
          finalRow = completed.row;
          successOutcome = completed.outcome;
          successPurgeResult = completed.purgeResult;
          successCounts = completed.counts;
        }
      } else {
        // No marker → call idempotent purge RPC.
        const purge = await purgeFn({
          requestId,
          clerkUserId,
          expectedOrchestrationVersion: row.orchestration_version,
          lockOwner,
          leaseMs,
        });

        if (!purge.ok) {
          if (purge.code === "cas_conflict") {
            const reloaded = await getAccountDeletionRequestById(requestId);
            if (reloaded?.status === "app_data_purged") {
              finalRow = reloaded;
              successOutcome = "already_done";
              successPurgeResult = reloaded.purge_result ?? "already_done";
            } else {
              earlyFailure = {
                ok: false,
                code: "cas_conflict",
                message: "Purge RPC conflict (lease/status/version)",
              };
            }
          } else {
            const failed = await recordAccountDeletionFailure({
              requestId,
              fromStatus: "purging_app_data",
              terminal: false,
              errorCode: "app_data_purge_rpc_failed",
              errorDetail: sanitizeAccountDeletionErrorDetail(purge.message),
              lockOwner,
              leaseMs,
              now,
              expectedOrchestrationVersion:
                expectedOrchestrationVersion ?? row.orchestration_version,
              purgeResult: "failed",
            });
            leaseAlreadyReleased = failed.ok;
            earlyFailure = failed.ok
              ? {
                  ok: false,
                  code: "internal_error",
                  message:
                    "App-data purge failed; request is failed_retryable",
                }
              : failed;
          }
        } else if (
          purge.value.limitations.length > 0 ||
          purge.value.outcome === "incomplete"
        ) {
          // Fail closed: nonempty limitations never advance / never write success marker.
          const lim = purge.value.limitations.slice(0, 8).join(",");
          const failed = await recordAccountDeletionFailure({
            requestId,
            fromStatus: "purging_app_data",
            terminal: false,
            errorCode: "app_data_purge_incomplete",
            errorDetail: sanitizeAccountDeletionErrorDetail(
              lim ? `limitations:${lim}` : "incomplete"
            ),
            lockOwner,
            leaseMs,
            now,
            expectedOrchestrationVersion:
              expectedOrchestrationVersion ?? row.orchestration_version,
            purgeResult: "failed",
            stepDetail: formatPurgeCountsDetail(purge.value.counts),
          });
          leaseAlreadyReleased = failed.ok;
          earlyFailure = failed.ok
            ? {
                ok: false,
                code: "internal_error",
                message:
                  "App-data purge incomplete; request is failed_retryable",
              }
            : failed;
        } else if (
          purge.value.outcome === "purged" ||
          purge.value.outcome === "already_absent"
        ) {
          const aggregate = summarizePurgeCounts(purge.value.counts);
          if (aggregate == null) {
            earlyFailure = {
              ok: false,
              code: "internal_error",
              message: "Malformed purge success counts; marker not written",
            };
          } else {
            const completed = await completeFromSuccessfulRpc({
              requestId,
              lockOwner,
              leaseMs,
              now,
              rpcOutcome: purge.value.outcome,
              aggregate,
              counts: purge.value.counts,
              markerAlreadyPresent: false,
            });
            if (!completed.ok) {
              earlyFailure = completed.failure;
            } else {
              finalRow = completed.row;
              successOutcome = completed.outcome;
              successPurgeResult = completed.purgeResult;
              successCounts = completed.counts;
            }
          }
        } else {
          earlyFailure = {
            ok: false,
            code: "internal_error",
            message: "Unexpected purge outcome",
          };
        }
      }
    }
  } finally {
    if (!leaseAlreadyReleased) {
      const release = await releaseAccountDeletionLease({
        requestId,
        lockOwner,
        now,
      });
      if (!release.ok) {
        console.error(
          "[orchestrateAppDataPurge] lease release failed",
          release
        );
      } else if (finalRow) {
        finalRow = release.value;
      }
    }
  }

  if (earlyFailure) return earlyFailure;

  if (!finalRow || !successOutcome || !successPurgeResult) {
    return {
      ok: false,
      code: "internal_error",
      message: "App-data purge orchestration did not complete",
    };
  }

  return {
    ok: true,
    value: {
      row: finalRow,
      outcome: successOutcome,
      purgeResult: successPurgeResult,
      counts: successCounts,
    },
  };
}

/** Test helper: expose eligibility predicates without importing internals. */
export function isEligibleSmsAndStripeForPurge(
  row: Pick<AccountDeletionRequestRow, "sms_result" | "stripe_result">
): boolean {
  return (
    isSuccessfulStepResult(row.sms_result) &&
    isSuccessfulStepResult(row.stripe_result)
  );
}

/** Ensures steps JSON never embeds forbidden PII shapes (best-effort). */
export function stepsLookNonPii(steps: AccountDeletionStepsJson): boolean {
  const blob = JSON.stringify(steps);
  if (/\buser_[A-Za-z0-9]+\b/.test(blob)) return false;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(blob)) return false;
  // E.164-ish phones only (avoid matching ISO timestamps).
  if (/\+\d{10,15}\b/.test(blob)) return false;
  return true;
}
