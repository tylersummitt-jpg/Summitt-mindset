/**
 * APP-041E4a — Tyler admin read-only list (sanitized view model).
 *
 * Kept separate from repository.ts so admin-observability can import canonical
 * production marker readers without a repository ↔ observability cycle.
 *
 * No mutation, lease acquire, provider, or reconciler calls.
 */

import "server-only";

import {
  ACCOUNT_DELETION_ADMIN_LEASE_MS,
  clampAccountDeletionAdminLimit,
  parseAccountDeletionAdminStatusFilter,
  summarizeAccountDeletionAdminRows,
  toAccountDeletionAdminViewRow,
  type AccountDeletionAdminSummary,
  type AccountDeletionAdminViewRow,
} from "./admin-observability";
import {
  listAccountDeletionRequestRowsForAdmin,
  type AccountDeletionRepoResult,
} from "./repository";
import type { AccountDeletionStatus } from "./types";

export type ListAccountDeletionRequestsForAdminInput = {
  limit?: number | null;
  status?: AccountDeletionStatus | "all" | string | null;
  /** Authoritative clock for lease/discoverability; defaults to server now. */
  now?: Date;
};

export async function listAccountDeletionRequestsForAdmin(
  input: ListAccountDeletionRequestsForAdminInput = {}
): Promise<
  AccountDeletionRepoResult<{
    rows: AccountDeletionAdminViewRow[];
    summary: AccountDeletionAdminSummary;
    appliedLimit: number;
    appliedStatus: AccountDeletionStatus | "all";
  }>
> {
  try {
    const appliedLimit = clampAccountDeletionAdminLimit(input.limit);
    const appliedStatus = parseAccountDeletionAdminStatusFilter(
      typeof input.status === "string" || input.status == null
        ? input.status
        : "all"
    );
    const now = input.now ?? new Date();

    const rawRows = await listAccountDeletionRequestRowsForAdmin({
      limit: appliedLimit,
      status: appliedStatus,
    });

    const rows = rawRows.map((row) =>
      toAccountDeletionAdminViewRow(row, now, ACCOUNT_DELETION_ADMIN_LEASE_MS)
    );
    const summary = summarizeAccountDeletionAdminRows(rows);

    return {
      ok: true,
      value: { rows, summary, appliedLimit, appliedStatus },
    };
  } catch {
    return {
      ok: false,
      code: "internal_error",
      message: "Account deletion admin list failed",
    };
  }
}
