/**
 * APP-041C2 — server-only app-data purge foundation (no public API).
 *
 * Invokes purge_app_data_for_account_deletion via service-role Supabase.
 * Does NOT: CAS to app_data_purged, delete Clerk, call Stripe/Twilio,
 * or expose HTTP. C3 orchestrator owns CAS after successful purge and MUST
 * refuse app_data_purged when outcome is incomplete or conflict.
 * Success outcomes (purged / already_absent) require empty limitations.
 */

import "server-only";

import { supabaseServer } from "@/lib/supabase-server";

import {
  DEFAULT_ACCOUNT_DELETION_LEASE_MS,
  PURGE_APP_DATA_FOR_ACCOUNT_DELETION_RPC,
  type AccountDeletionRepoResult,
} from "./repository";
import { sanitizeAccountDeletionErrorDetail } from "./sanitize";

export type PurgeAppDataOutcome =
  | "purged"
  | "already_absent"
  | "conflict"
  | "incomplete";

/** Outcomes that must never advance to app_data_purged. */
export const PURGE_OUTCOMES_BLOCKING_APP_DATA_PURGED: readonly PurgeAppDataOutcome[] =
  ["conflict", "incomplete"] as const;

export type PurgeAppDataForDeletionInput = {
  requestId: string;
  clerkUserId: string;
  expectedOrchestrationVersion: number;
  lockOwner: string;
  leaseMs?: number;
};

export type PurgeAppDataForDeletionValue = {
  outcome: PurgeAppDataOutcome;
  counts: Record<string, number>;
  limitations: string[];
};

function firstPurgeRpcRow(data: unknown): {
  outcome?: unknown;
  counts?: unknown;
  limitations?: unknown;
} | null {
  if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
    return data[0] as {
      outcome?: unknown;
      counts?: unknown;
      limitations?: unknown;
    };
  }
  if (data && typeof data === "object" && "outcome" in data) {
    return data as {
      outcome?: unknown;
      counts?: unknown;
      limitations?: unknown;
    };
  }
  return null;
}

function parseCounts(raw: unknown): Record<string, number> | null {
  if (raw == null) return {};
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof k !== "string" || k.length === 0 || k.length > 120) return null;
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v < 0 ||
      v > 1_000_000_000
    ) {
      return null;
    }
    out[k] = Math.floor(v);
  }
  return out;
}

function parseLimitations(raw: unknown): string[] | null {
  if (raw == null) return [];
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item !== "string" || item.length === 0 || item.length > 120) {
      return null;
    }
    if (!/^[a-z0-9_]+$/.test(item)) return null;
    out.push(item);
  }
  return out;
}

function isPurgeOutcome(value: unknown): value is PurgeAppDataOutcome {
  return (
    value === "purged" ||
    value === "already_absent" ||
    value === "conflict" ||
    value === "incomplete"
  );
}

/**
 * True when C3 must not CAS to app_data_purged for this purge result.
 */
export function purgeOutcomeBlocksAppDataPurged(
  outcome: PurgeAppDataOutcome
): boolean {
  return (
    PURGE_OUTCOMES_BLOCKING_APP_DATA_PURGED as readonly string[]
  ).includes(outcome);
}

/**
 * Run the allowlisted app-data purge RPC for a deletion request.
 * Caller must already hold an active lease and have status purging_app_data
 * (enforced again inside SQL). Does not advance the state machine.
 */
export async function purgeAppDataForDeletion(
  input: PurgeAppDataForDeletionInput
): Promise<AccountDeletionRepoResult<PurgeAppDataForDeletionValue>> {
  const requestId = input.requestId.trim();
  const clerkUserId = input.clerkUserId.trim();
  const lockOwner = input.lockOwner.trim();

  if (!requestId || !clerkUserId || !lockOwner) {
    return {
      ok: false,
      code: "invalid_argument",
      message: "requestId, clerkUserId, and lockOwner are required",
    };
  }
  if (
    !Number.isInteger(input.expectedOrchestrationVersion) ||
    input.expectedOrchestrationVersion < 1
  ) {
    return {
      ok: false,
      code: "invalid_argument",
      message: "expectedOrchestrationVersion is required",
    };
  }

  const leaseMs = input.leaseMs ?? DEFAULT_ACCOUNT_DELETION_LEASE_MS;

  try {
    const { data, error } = await supabaseServer.rpc(
      PURGE_APP_DATA_FOR_ACCOUNT_DELETION_RPC,
      {
        p_request_id: requestId,
        p_clerk_user_id: clerkUserId,
        p_expected_orchestration_version: input.expectedOrchestrationVersion,
        p_lock_owner: lockOwner,
        p_lease_ms: leaseMs,
      }
    );

    if (error) {
      console.error("[purgeAppDataForDeletion] RPC failed", {
        requestId,
        code: (error as { code?: string }).code ?? "unknown",
      });
      return {
        ok: false,
        code: "internal_error",
        message:
          sanitizeAccountDeletionErrorDetail(error.message) ??
          "purge_rpc_failed",
      };
    }

    const row = firstPurgeRpcRow(data);
    if (!row || !isPurgeOutcome(row.outcome)) {
      return {
        ok: false,
        code: "internal_error",
        message: "purge_rpc_malformed_response",
      };
    }

    const counts = parseCounts(row.counts);
    const limitations = parseLimitations(row.limitations);
    if (counts == null || limitations == null) {
      return {
        ok: false,
        code: "internal_error",
        message: "purge_rpc_malformed_counts",
      };
    }

    // Contract: purged/already_absent must never carry limitations.
    if (
      (row.outcome === "purged" || row.outcome === "already_absent") &&
      limitations.length > 0
    ) {
      return {
        ok: false,
        code: "internal_error",
        message: "purge_rpc_invalid_success_with_limitations",
      };
    }

    if (row.outcome === "conflict") {
      return {
        ok: false,
        code: "cas_conflict",
        message: "purge_conflict_or_lease",
      };
    }

    // incomplete is a successful RPC with residual deferred work — ok:true so
    // callers can read limitations, but C3 must not CAS app_data_purged.
    return {
      ok: true,
      value: {
        outcome: row.outcome,
        counts,
        limitations,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "purge_rpc_exception";
    console.error("[purgeAppDataForDeletion] unexpected failure", {
      requestId,
    });
    return {
      ok: false,
      code: "internal_error",
      message: sanitizeAccountDeletionErrorDetail(msg) ?? "purge_rpc_failed",
    };
  }
}
