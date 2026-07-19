import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";
import {
  clampAccountDeletionAdminLimit,
  parseAccountDeletionAdminStatusFilter,
} from "@/lib/account-deletion/admin-observability";
import { listAccountDeletionRequestsForAdmin } from "@/lib/account-deletion/list-account-deletion-admin";

import AccountDeletionsDashboard from "./account-deletions-dashboard";

/** Never cache admin deletion observability across sessions/users. */
export const dynamic = "force-dynamic";

/**
 * APP-041E4a — Tyler-only read-only account deletion observability.
 * No create / retry / unlock / process actions.
 */
export default async function AdminAccountDeletionsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireTylerAdmin();

  const resolved = searchParams ? await searchParams : {};
  const statusRaw = Array.isArray(resolved.status)
    ? resolved.status[0]
    : resolved.status;
  const limitRaw = Array.isArray(resolved.limit)
    ? resolved.limit[0]
    : resolved.limit;

  const status = parseAccountDeletionAdminStatusFilter(statusRaw);
  const parsedLimit =
    limitRaw != null && limitRaw !== "" ? Number(limitRaw) : undefined;
  const limit = clampAccountDeletionAdminLimit(
    Number.isFinite(parsedLimit) ? parsedLimit : undefined
  );

  const result = await listAccountDeletionRequestsForAdmin({
    status,
    limit,
  });

  if (!result.ok) {
    throw Object.assign(new Error("ACCOUNT_DELETION_ADMIN_LIST_FAILED"), {
      status: 500,
    });
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          Account Deletion Operations
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Sanitized observability only. Discoverable does not mean safe to
          process automatically.
        </p>
      </div>

      <AccountDeletionsDashboard
        rows={result.value.rows}
        summary={result.value.summary}
        appliedStatus={result.value.appliedStatus}
        appliedLimit={result.value.appliedLimit}
      />
    </div>
  );
}
