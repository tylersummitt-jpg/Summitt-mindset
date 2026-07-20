/**
 * APP-041E4b/E4c — private Node route foundation for future scheduled reconciliation.
 *
 * Deployed does not mean activated:
 * - ACCOUNT_DELETION_SCHEDULER_ENABLED must be exactly "true"
 * - No Vercel Cron schedule is configured for this path
 * - Unauthorized requests are blocked before any work
 *
 * When disabled or unauthorized: no discovery, no dependency construction,
 * no reconciler, no providers, no mutations.
 *
 * Production discovery omits caller clock so PostgreSQL DEFAULT now() applies.
 */

import { NextResponse } from "next/server";

import { validateCronSecretRequest } from "@/lib/cron-auth";
import { buildProductionAccountDeletionSchedulerDependencies } from "@/lib/account-deletion/build-production-account-deletion-scheduler-dependencies";
import {
  ACCOUNT_DELETION_SCHEDULER_BATCH_SIZE,
  ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV,
  ACCOUNT_DELETION_SCHEDULER_LEASE_MS,
  isAccountDeletionSchedulerEnabled,
  runAccountDeletionSchedulerInvocation,
} from "@/lib/account-deletion/run-account-deletion-scheduler";
import { executeTrustedAccountDeletionReconcile } from "@/lib/account-deletion/reconcile-account-deletion";
import { listAccountDeletionRequestIdsForReconcile } from "@/lib/account-deletion/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function jsonResponse(
  body: unknown,
  status: number
): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function GET(req: Request) {
  // 1. Cron auth first — never reveal kill-switch state on failure.
  if (!validateCronSecretRequest(req)) {
    return jsonResponse({ ok: false }, 401);
  }

  const enabled = isAccountDeletionSchedulerEnabled(
    process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV]
  );

  const result = await runAccountDeletionSchedulerInvocation({
    enabled,
    discover: async () => {
      // Production: limit + leaseMs only. No now → RPC omits p_now → Postgres now().
      const discovery = await listAccountDeletionRequestIdsForReconcile({
        limit: ACCOUNT_DELETION_SCHEDULER_BATCH_SIZE,
        leaseMs: ACCOUNT_DELETION_SCHEDULER_LEASE_MS,
      });
      if (!discovery.ok) return { ok: false };
      return { ok: true, requestIds: discovery.value.requestIds };
    },
    createDependencies: () =>
      buildProductionAccountDeletionSchedulerDependencies(),
    reconcile: (input) =>
      executeTrustedAccountDeletionReconcile({
        requestId: input.requestId,
        lockOwner: input.lockOwner,
        leaseMs: input.leaseMs,
        dependencies: input.dependencies,
      }),
  });

  return jsonResponse(result.body, result.httpStatus);
}
