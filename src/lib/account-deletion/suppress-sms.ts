/**
 * APP-041B2a — atomic SMS suppression for account deletion (no public API).
 *
 * Evidence model:
 * - Unlink proof lives on account_deletion_requests (status/sms_result/steps).
 * - Real STOP proof remains in existing sms_inbound_messages (never invented here).
 * - Live eligibility is removed by deleting sms_identities + sms_audience.
 * - `sms_binding_removed` is written inside the suppress RPC transaction.
 *
 * Clerk metadata cleanup is best-effort. Failure does not recreate identity.
 */

import "server-only";

import { updateClerkPublicMetadata } from "@/lib/clerk-public-metadata";
import { supabaseServer } from "@/lib/supabase-server";

import {
  DEFAULT_ACCOUNT_DELETION_LEASE_MS,
  SUPPRESS_SMS_FOR_ACCOUNT_DELETION_RPC,
  acquireAccountDeletionLease,
  getAccountDeletionRequestById,
  releaseAccountDeletionLease,
  transitionAccountDeletionRequest,
  type AccountDeletionRepoResult,
} from "./repository";
import type { AccountDeletionRequestRow } from "./types";

/** Durable, phone-free marker written by suppress_sms_for_account_deletion RPC. */
export const SMS_BINDING_REMOVED_STEP = "sms_binding_removed" as const;

/** Atomic SMS unlink (RPC). Trusted stages inject this; production uses default. */
export type SuppressSmsDataFn = (input: {
  clerkUserId: string;
  requestId: string;
}) => Promise<"removed" | "already_absent">;

/**
 * Best-effort Clerk SMS metadata cleanup.
 * Returns true on success; false on soft-fail (must not recreate identity).
 */
export type ClearClerkDeletionMetadataFn = (
  clerkUserId: string
) => Promise<boolean>;

export type SuppressSmsForDeletionInput = {
  requestId: string;
  clerkUserId: string;
  lockOwner: string;
  leaseMs?: number;
  now?: Date;
  /**
   * Optional injection for tests / trusted scheduler wiring.
   * When omitted, production uses the live Supabase suppress RPC.
   */
  suppressSmsData?: SuppressSmsDataFn;
  /**
   * Optional injection for tests / trusted scheduler wiring.
   * When omitted, production uses best-effort Clerk metadata clear.
   */
  clearClerkDeletionMetadata?: ClearClerkDeletionMetadataFn;
};

export type SuppressSmsForDeletionValue = {
  row: AccountDeletionRequestRow;
  suppressResult: "removed" | "already_absent";
  clerkMetadataWarning: boolean;
};

function firstRpcResult(data: unknown): string | null {
  if (Array.isArray(data) && data[0]) {
    const row = data[0] as { result?: unknown };
    return typeof row.result === "string" ? row.result : null;
  }
  if (data && typeof data === "object" && "result" in data) {
    const r = (data as { result?: unknown }).result;
    return typeof r === "string" ? r : null;
  }
  return null;
}

function hadPriorBindingRemoval(row: AccountDeletionRequestRow): boolean {
  return row.steps?.[SMS_BINDING_REMOVED_STEP]?.ok === true;
}

async function callSuppressSmsRpc(input: {
  clerkUserId: string;
  requestId: string;
}): Promise<"removed" | "already_absent"> {
  const { data, error } = await supabaseServer.rpc(
    SUPPRESS_SMS_FOR_ACCOUNT_DELETION_RPC,
    {
      p_clerk_user_id: input.clerkUserId,
      p_deletion_request_id: input.requestId,
    }
  );
  if (error) {
    throw error;
  }
  const result = firstRpcResult(data);
  if (result === "removed" || result === "already_absent") {
    return result;
  }
  throw new Error(`unexpected_suppress_sms_result:${String(result)}`);
}

async function bestEffortClearClerkSmsMetadata(
  clerkUserId: string
): Promise<boolean> {
  try {
    await updateClerkPublicMetadata(
      clerkUserId,
      { smsEnabled: false },
      ["phoneNumber"]
    );
    return true;
  } catch {
    // Soft-fail only — never log durable user ids, PII, body, or raw error.
    console.error(
      "[suppressSmsForDeletion] Clerk SMS metadata cleanup failed (soft)",
      { code: "clerk_sms_metadata_cleanup_failed" }
    );
    return false;
  }
}

/**
 * Explicit production SMS deps for trusted scheduler wiring.
 * Captures the live RPC + soft-fail metadata clearer without ambient defaults
 * inside createProductionAccountDeletionReconcilerDependencies.
 */
export function getProductionAccountDeletionSmsDependencies(): {
  suppressSmsData: SuppressSmsDataFn;
  clearClerkDeletionMetadata: ClearClerkDeletionMetadataFn;
} {
  return {
    suppressSmsData: callSuppressSmsRpc,
    clearClerkDeletionMetadata: bestEffortClearClerkSmsMetadata,
  };
}

/**
 * Suppress live SMS binding for an account-deletion request.
 * Requires a valid lockOwner; acquires/releases the B1 lease around the work.
 */
export async function suppressSmsForDeletion(
  input: SuppressSmsForDeletionInput
): Promise<AccountDeletionRepoResult<SuppressSmsForDeletionValue>> {
  const clerkUserId = input.clerkUserId.trim();
  const lockOwner = input.lockOwner.trim();
  if (!clerkUserId || !lockOwner || !input.requestId.trim()) {
    return {
      ok: false,
      code: "invalid_argument",
      message: "requestId, clerkUserId, and lockOwner are required",
    };
  }

  const leaseMs = input.leaseMs ?? DEFAULT_ACCOUNT_DELETION_LEASE_MS;
  const now = input.now ?? new Date();
  const suppressSmsData = input.suppressSmsData ?? callSuppressSmsRpc;
  const clearClerkDeletionMetadata =
    input.clearClerkDeletionMetadata ?? bestEffortClearClerkSmsMetadata;

  const existing = await getAccountDeletionRequestById(input.requestId);
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

  const lease = await acquireAccountDeletionLease({
    requestId: input.requestId,
    lockOwner,
    leaseMs,
    now,
  });
  if (!lease.ok) return lease;

  let row = lease.value;
  let clerkMetadataWarning = false;
  let suppressResult: "removed" | "already_absent" | null = null;
  let finalRow: AccountDeletionRequestRow | null = null;
  let earlyFailure: AccountDeletionRepoResult<SuppressSmsForDeletionValue> | null =
    null;

  try {
    if (row.status === "sms_suppressed") {
      finalRow = row;
      suppressResult =
        row.sms_result === "already_done" ? "already_absent" : "removed";
    } else if (row.status === "requested") {
      const toSuppressing = await transitionAccountDeletionRequest({
        requestId: input.requestId,
        fromStatus: "requested",
        toStatus: "suppressing_sms",
        lockOwner,
        leaseMs,
        now,
        smsResult: "pending",
        stepNote: { ok: true, code: "suppress_sms_begin" },
      });
      if (!toSuppressing.ok) {
        earlyFailure = toSuppressing;
      } else {
        row = toSuppressing.value;
      }
    } else if (row.status === "failed_retryable") {
      const resume = await transitionAccountDeletionRequest({
        requestId: input.requestId,
        fromStatus: "failed_retryable",
        toStatus: "suppressing_sms",
        lockOwner,
        leaseMs,
        now,
        smsResult: "pending",
        stepNote: { ok: true, code: "suppress_sms_retry" },
      });
      if (!resume.ok) {
        earlyFailure = resume;
      } else {
        row = resume.value;
      }
    } else if (row.status !== "suppressing_sms") {
      earlyFailure = {
        ok: false,
        code: "illegal_transition",
        message: `Cannot suppress SMS from status ${row.status}`,
      };
    }

    if (!earlyFailure && !finalRow) {
      const fresh = await getAccountDeletionRequestById(input.requestId);
      if (
        !fresh ||
        fresh.status !== "suppressing_sms" ||
        fresh.current_step !== "suppressing_sms"
      ) {
        earlyFailure = {
          ok: false,
          code: "cas_conflict",
          message: "Expected suppressing_sms before SMS suppress RPC",
        };
      } else {
        row = fresh;
        try {
          suppressResult = await suppressSmsData({
            clerkUserId,
            requestId: input.requestId,
          });
          // Reload so sms_binding_removed written inside the RPC is visible.
          const afterRpc = await getAccountDeletionRequestById(input.requestId);
          if (afterRpc) row = afterRpc;
        } catch {
          // Never log raw provider error, durable user ids, PII, or body.
          console.error("[suppressSmsForDeletion] RPC failed", {
            code: "sms_suppress_rpc_failed",
          });
          earlyFailure = {
            ok: false,
            code: "internal_error",
            message: "SMS suppress RPC failed",
          };
        }
      }
    }

    if (!earlyFailure && !finalRow && suppressResult) {
      const clerkOk = await clearClerkDeletionMetadata(clerkUserId);
      clerkMetadataWarning = !clerkOk;

      const priorRemoved = hadPriorBindingRemoval(row);
      const smsResult =
        suppressResult === "removed" || priorRemoved
          ? ("ok" as const)
          : ("already_done" as const);

      const toSuppressed = await transitionAccountDeletionRequest({
        requestId: input.requestId,
        fromStatus: "suppressing_sms",
        toStatus: "sms_suppressed",
        lockOwner,
        leaseMs,
        now,
        smsResult,
        stepNote: {
          ok: true,
          code:
            smsResult === "ok"
              ? clerkMetadataWarning
                ? "identity_removed_clerk_metadata_pending"
                : "identity_removed"
              : clerkMetadataWarning
                ? "no_identity_clerk_metadata_pending"
                : "no_identity",
        },
      });
      if (!toSuppressed.ok) {
        earlyFailure = toSuppressed;
      } else {
        finalRow = toSuppressed.value;
      }
    }
  } finally {
    const release = await releaseAccountDeletionLease({
      requestId: input.requestId,
      lockOwner,
      now,
    });
    if (!release.ok) {
      console.error("[suppressSmsForDeletion] lease release failed", release);
    } else if (finalRow) {
      finalRow = release.value;
    }
  }

  if (earlyFailure) return earlyFailure;

  if (!finalRow || !suppressResult) {
    return {
      ok: false,
      code: "internal_error",
      message: "SMS suppress did not complete",
    };
  }

  return {
    ok: true,
    value: {
      row: finalRow,
      suppressResult,
      clerkMetadataWarning,
    },
  };
}
