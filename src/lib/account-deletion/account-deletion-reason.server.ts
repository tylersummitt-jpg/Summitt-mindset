/**
 * Best-effort calls to the deletion-reason database contract.
 * Contract: 2026-11-05-deletion-reason-v1
 * (`account-deletion-reason.contract.sql`).
 * Missing objects and RPC failures are logged and swallowed.
 * These functions do not write account_deletion_requests.
 */

import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import {
  ACCOUNT_DELETION_REASON_REPORT_VIEW,
  ACCOUNT_DELETION_REASON_SETTLE_LIMIT,
  RECORD_ACCOUNT_DELETION_REASON_RPC,
  SETTLE_ACCOUNT_DELETION_REASONS_RPC,
  type DeletionReasonCode,
} from "@/lib/account-deletion/account-deletion-reason-contract";
import {
  deletionReasonsUnavailable,
  parseDeletionReasonReportRows,
  type DeletionReasonReport,
} from "@/lib/account-deletion/deletion-reason-facts";

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) return code;
  }
  return "deletion_reason_failed";
}

export async function recordAccountDeletionReason(
  clerkUserId: string,
  reasonCode: DeletionReasonCode
): Promise<void> {
  try {
    const result = await supabaseServer.rpc(RECORD_ACCOUNT_DELETION_REASON_RPC, {
      p_clerk_user_id: clerkUserId,
      p_reason_code: reasonCode,
    });
    if (result?.error) {
      console.warn("[account-deletion] reason record failed", { code: errorCode(result.error) });
    }
  } catch (err) {
    console.warn("[account-deletion] reason record failed", {
      code: err instanceof Error ? err.name : "deletion_reason_failed",
    });
  }
}

export async function settleAccountDeletionReasons(): Promise<void> {
  try {
    const result = await supabaseServer.rpc(SETTLE_ACCOUNT_DELETION_REASONS_RPC, {
      p_limit: ACCOUNT_DELETION_REASON_SETTLE_LIMIT,
    });
    if (result?.error) {
      console.warn("[account-deletion] reason settle failed", { code: errorCode(result.error) });
    }
  } catch (err) {
    console.warn("[account-deletion] reason settle failed", {
      code: err instanceof Error ? err.name : "deletion_reason_failed",
    });
  }
}

export async function loadDeletionReasonReport(): Promise<DeletionReasonReport> {
  try {
    const { data, error } = await supabaseServer
      .from(ACCOUNT_DELETION_REASON_REPORT_VIEW)
      .select(
        "reason_code, completed_total, recorded_total, missing_total, reason_count, breakdown_withheld"
      );
    if (error) {
      console.warn("[retention] deletion reason report failed", { code: errorCode(error) });
      return deletionReasonsUnavailable();
    }
    return parseDeletionReasonReportRows(data);
  } catch (err) {
    console.warn("[retention] deletion reason report failed", {
      code: err instanceof Error ? err.name : "deletion_reason_failed",
    });
    return deletionReasonsUnavailable();
  }
}
