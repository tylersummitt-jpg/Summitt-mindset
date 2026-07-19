import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import {
  ACQUIRE_ACCOUNT_DELETION_LEASE_RPC,
  CAS_ACCOUNT_DELETION_REQUEST_RPC,
  acquireAccountDeletionLease,
  createAccountDeletionRequest,
  getAccountDeletionRequestById,
  markAccountDeletionCompleted,
  patchAccountDeletionRequestWhileLeased,
  recordAccountDeletionFailure,
  releaseAccountDeletionLease,
  transitionAccountDeletionRequest,
  useAccountDeletionStoreForTests,
  useInMemoryAccountDeletionStoreForTests,
  useSupabaseAccountDeletionStoreForTests,
  type AccountDeletionStore,
} from "./repository";
import { sanitizeAccountDeletionErrorDetail } from "./sanitize";
import { isLegalAccountDeletionTransition } from "./transitions";
import {
  toAccountDeletionSafeStatusProjection,
  type AccountDeletionRequestRow,
  type AccountDeletionStatus,
} from "./types";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260718120000_account_deletion_requests.sql"
);
const D0_CAS_MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260719130000_account_deletion_cas_clerk_result.sql"
);
const C2_CAS_MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260719120000_account_deletion_cas_purge_result.sql"
);

async function createAndLease(opts: {
  clerkUserId: string;
  idempotencyKey: string;
  lockOwner: string;
  now?: Date;
  leaseMs?: number;
}) {
  const created = await createAccountDeletionRequest({
    clerkUserId: opts.clerkUserId,
    idempotencyKey: opts.idempotencyKey,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("create failed");
  const lease = await acquireAccountDeletionLease({
    requestId: created.value.row.id,
    lockOwner: opts.lockOwner,
    now: opts.now,
    leaseMs: opts.leaseMs,
  });
  expect(lease.ok).toBe(true);
  if (!lease.ok) throw new Error("lease failed");
  return { id: created.value.row.id, row: lease.value };
}

describe("account deletion migration foundation", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("creates only the additive account_deletion_requests table with RLS revoke", () => {
    expect(sql).toMatch(/CREATE TABLE account_deletion_requests/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE account_deletion_requests FROM anon/);
    expect(sql).toMatch(
      /REVOKE ALL ON TABLE account_deletion_requests FROM authenticated/
    );
    expect(sql).toMatch(
      /account_deletion_requests_one_unresolved_per_user/
    );
    expect(sql).toMatch(/WHERE status <> 'completed'/);
    expect(sql).toMatch(/account_deletion_requests_user_idempotency/);
    expect(sql).not.toMatch(/ALTER TABLE sms_/);
    expect(sql).not.toMatch(/^\s*DROP TABLE/m);
    expect(sql).not.toMatch(/^\s*DROP FUNCTION/m);
  });

  it("defines atomic lease/CAS RPCs using database now() with service-role-only execute", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.acquire_account_deletion_lease");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.cas_account_deletion_request");
    expect(sql).toMatch(/locked_at < \(now\(\) - \(v_lease_ms::double precision \* INTERVAL '1 millisecond'\)\)/);
    expect(sql).toMatch(/locked_at >= \(now\(\) - \(v_lease_ms::double precision \* INTERVAL '1 millisecond'\)\)/);
    expect(sql).toContain("SET search_path = public");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.acquire_account_deletion_lease(UUID, TEXT, INTEGER) FROM PUBLIC"
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.acquire_account_deletion_lease(UUID, TEXT, INTEGER) FROM anon"
    );
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.acquire_account_deletion_lease(UUID, TEXT, INTEGER) FROM authenticated"
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.acquire_account_deletion_lease(UUID, TEXT, INTEGER) TO service_role"
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN) TO service_role"
    );
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.acquire_account_deletion_lease");
  });
});

describe("account deletion transitions", () => {
  it("allows only legal forward steps", () => {
    expect(
      isLegalAccountDeletionTransition("requested", "suppressing_sms")
    ).toBe(true);
    expect(
      isLegalAccountDeletionTransition("deleting_clerk", "completed")
    ).toBe(true);
  });

  it("rejects skipped and backward transitions", () => {
    expect(
      isLegalAccountDeletionTransition("requested", "sms_suppressed")
    ).toBe(false);
    expect(
      isLegalAccountDeletionTransition("completed", "requested")
    ).toBe(false);
  });

  it("binds failed_retryable resume to persisted current_step only", () => {
    expect(
      isLegalAccountDeletionTransition("failed_retryable", "suppressing_sms", {
        persistedCurrentStep: "suppressing_sms",
      })
    ).toBe(true);
    expect(
      isLegalAccountDeletionTransition("failed_retryable", "deleting_clerk", {
        persistedCurrentStep: "suppressing_sms",
      })
    ).toBe(false);
    expect(
      isLegalAccountDeletionTransition("failed_retryable", "purging_app_data", {
        persistedCurrentStep: "canceling_subscription",
      })
    ).toBe(false);
    expect(
      isLegalAccountDeletionTransition("failed_terminal", "suppressing_sms", {
        persistedCurrentStep: "suppressing_sms",
      })
    ).toBe(false);
  });
});

describe("sanitizeAccountDeletionErrorDetail (best-effort)", () => {
  it("redacts common shapes including Clerk IDs and query tokens; truncates", () => {
    const long = "x".repeat(600);
    expect(sanitizeAccountDeletionErrorDetail(long)?.length).toBe(500);
    expect(
      sanitizeAccountDeletionErrorDetail(
        "fail user@example.com +15551234567 cus_ABC sub_XYZ sk_live_abc token eyJhbGciOiJIUzI1NiJ9.aa.bb"
      )
    ).toBe(
      "fail [redacted] [redacted] [redacted] [redacted] [redacted] token [redacted]"
    );
    expect(
      sanitizeAccountDeletionErrorDetail("Clerk user_2abcXYZ1234567890")
    ).toBe("Clerk [redacted]");
    expect(
      sanitizeAccountDeletionErrorDetail(
        "url https://x.com/?token=secret123&api_key=abc&a=1"
      )
    ).toBe("url https://x.com/?token=[redacted]&api_key=[redacted]&a=1");
  });
});

describe("account deletion repository (in-memory)", () => {
  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
    fromMock.mockImplementation(() => {
      throw new Error("supabase.from should not be called in in-memory tests");
    });
    rpcMock.mockImplementation(() => {
      throw new Error("supabase.rpc should not be called in in-memory tests");
    });
  });

  it("1. creates the first request without a lease", async () => {
    const result = await createAccountDeletionRequest({
      clerkUserId: "user_a",
      idempotencyKey: "key-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toBe(true);
    expect(result.value.row.status).toBe("requested");
  });

  it("2. same user + same idempotency key returns the same request", async () => {
    const first = await createAccountDeletionRequest({
      clerkUserId: "user_a",
      idempotencyKey: "key-1",
    });
    const second = await createAccountDeletionRequest({
      clerkUserId: "user_a",
      idempotencyKey: "key-1",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.created).toBe(false);
    expect(second.value.row.id).toBe(first.value.row.id);
  });

  it("3. same user + different idempotency key while unresolved conflicts", async () => {
    await createAccountDeletionRequest({
      clerkUserId: "user_a",
      idempotencyKey: "key-1",
    });
    const second = await createAccountDeletionRequest({
      clerkUserId: "user_a",
      idempotencyKey: "key-2",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe("conflict_unresolved_exists");
  });

  it("4–5. failed_retryable and failed_terminal still block a second request", async () => {
    const { id } = await createAndLease({
      clerkUserId: "user_fail_retry",
      idempotencyKey: "k1",
      lockOwner: "w1",
    });
    await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "requested",
      toStatus: "suppressing_sms",
      lockOwner: "w1",
    });
    const failedRetry = await recordAccountDeletionFailure({
      requestId: id,
      fromStatus: "suppressing_sms",
      terminal: false,
      errorCode: "sms_timeout",
      errorDetail: "temporary",
      lockOwner: "w1",
    });
    expect(failedRetry.ok).toBe(true);

    const blockedRetry = await createAccountDeletionRequest({
      clerkUserId: "user_fail_retry",
      idempotencyKey: "k2",
    });
    expect(blockedRetry.ok).toBe(false);
    if (blockedRetry.ok) return;
    expect(blockedRetry.code).toBe("conflict_unresolved_exists");

    const { id: termId } = await createAndLease({
      clerkUserId: "user_fail_term",
      idempotencyKey: "t1",
      lockOwner: "w1",
    });
    await transitionAccountDeletionRequest({
      requestId: termId,
      fromStatus: "requested",
      toStatus: "suppressing_sms",
      lockOwner: "w1",
    });
    await recordAccountDeletionFailure({
      requestId: termId,
      fromStatus: "suppressing_sms",
      terminal: true,
      errorCode: "fatal",
      lockOwner: "w1",
    });
    const blockedTerm = await createAccountDeletionRequest({
      clerkUserId: "user_fail_term",
      idempotencyKey: "t2",
    });
    expect(blockedTerm.ok).toBe(false);
  });

  it("6. completed permits a later new request; same key returns historical completed", async () => {
    const { id } = await createAndLease({
      clerkUserId: "user_done",
      idempotencyKey: "c1",
      lockOwner: "worker",
    });
    const path: Array<[AccountDeletionStatus, AccountDeletionStatus]> = [
      ["requested", "suppressing_sms"],
      ["suppressing_sms", "sms_suppressed"],
      ["sms_suppressed", "canceling_subscription"],
      ["canceling_subscription", "subscription_canceled"],
      ["subscription_canceled", "purging_app_data"],
      ["purging_app_data", "app_data_purged"],
      ["app_data_purged", "deleting_clerk"],
      ["deleting_clerk", "completed"],
    ];
    for (const [from, to] of path) {
      const t = await transitionAccountDeletionRequest({
        requestId: id,
        fromStatus: from,
        toStatus: to,
        lockOwner: "worker",
      });
      expect(t.ok).toBe(true);
    }

    const sameKey = await createAccountDeletionRequest({
      clerkUserId: "user_done",
      idempotencyKey: "c1",
    });
    expect(sameKey.ok).toBe(true);
    if (!sameKey.ok) return;
    expect(sameKey.value.created).toBe(false);
    expect(sameKey.value.row.id).toBe(id);
    expect(sameKey.value.row.status).toBe("completed");

    const again = await createAccountDeletionRequest({
      clerkUserId: "user_done",
      idempotencyKey: "c2",
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.created).toBe(true);
    expect(again.value.row.id).not.toBe(id);
  });

  it("7–8. different users are independent; idempotency keys do not cross users", async () => {
    const a = await createAccountDeletionRequest({
      clerkUserId: "user_x",
      idempotencyKey: "shared-key",
    });
    const b = await createAccountDeletionRequest({
      clerkUserId: "user_y",
      idempotencyKey: "shared-key",
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.row.id).not.toBe(b.value.row.id);
  });

  it("9–11. legal forward transitions succeed; skipped/backward fail", async () => {
    const { id } = await createAndLease({
      clerkUserId: "user_trans",
      idempotencyKey: "t",
      lockOwner: "w",
    });

    const ok = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "requested",
      toStatus: "suppressing_sms",
      lockOwner: "w",
    });
    expect(ok.ok).toBe(true);

    const skip = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "suppressing_sms",
      toStatus: "canceling_subscription",
      lockOwner: "w",
    });
    expect(skip.ok).toBe(false);
    if (skip.ok) return;
    expect(skip.code).toBe("illegal_transition");
  });

  it("12–14. lease acquisition is conditional; expired may reacquire; active may not be stolen", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_lease",
      idempotencyKey: "l1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.row.id;
    const t0 = new Date("2026-07-18T12:00:00.000Z");

    const lease1 = await acquireAccountDeletionLease({
      requestId: id,
      lockOwner: "worker-a",
      now: t0,
      leaseMs: 60_000,
    });
    expect(lease1.ok).toBe(true);
    if (!lease1.ok) return;
    expect(lease1.value.lock_owner).toBe("worker-a");

    const steal = await acquireAccountDeletionLease({
      requestId: id,
      lockOwner: "worker-b",
      now: new Date(t0.getTime() + 1_000),
      leaseMs: 60_000,
    });
    expect(steal.ok).toBe(false);
    if (steal.ok) return;
    expect(steal.code).toBe("lease_held");

    const reacquire = await acquireAccountDeletionLease({
      requestId: id,
      lockOwner: "worker-b",
      now: new Date(t0.getTime() + 61_000),
      leaseMs: 60_000,
    });
    expect(reacquire.ok).toBe(true);
    if (!reacquire.ok) return;
    expect(reacquire.value.lock_owner).toBe("worker-b");

    const wrongRelease = await releaseAccountDeletionLease({
      requestId: id,
      lockOwner: "worker-a",
    });
    expect(wrongRelease.ok).toBe(false);
    if (wrongRelease.ok) return;
    expect(wrongRelease.code).toBe("lease_not_held");

    const released = await releaseAccountDeletionLease({
      requestId: id,
      lockOwner: "worker-b",
    });
    expect(released.ok).toBe(true);
  });

  it("15. unknown orchestration version is rejected", async () => {
    const bad = await createAccountDeletionRequest({
      clerkUserId: "user_ver",
      idempotencyKey: "v1",
      orchestrationVersion: 99,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.code).toBe("unsupported_orchestration_version");
  });

  it("16. retryable error recording sanitizes details and sets resume step", async () => {
    const { id } = await createAndLease({
      clerkUserId: "user_err",
      idempotencyKey: "e1",
      lockOwner: "w",
    });
    await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "requested",
      toStatus: "suppressing_sms",
      lockOwner: "w",
    });
    const failed = await recordAccountDeletionFailure({
      requestId: id,
      fromStatus: "suppressing_sms",
      terminal: false,
      errorCode: "sms_failed",
      errorDetail: `boom user@x.com ${"z".repeat(600)}`,
      lockOwner: "w",
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.value.status).toBe("failed_retryable");
    expect(failed.value.current_step).toBe("suppressing_sms");
    expect(failed.value.last_error_detail).not.toContain("user@x.com");
    expect(failed.value.last_error_detail!.length).toBeLessThanOrEqual(500);
  });

  it("17. safe projection excludes private/internal fields", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_proj",
      idempotencyKey: "p1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const row = (await getAccountDeletionRequestById(
      created.value.row.id
    )) as AccountDeletionRequestRow;
    const projection = toAccountDeletionSafeStatusProjection(row);
    expect(projection.requestId).toBe(row.id);
    expect(projection).not.toHaveProperty("clerk_user_id");
    expect(projection).not.toHaveProperty("lock_owner");
    expect(projection).not.toHaveProperty("last_error_detail");
    expect(JSON.stringify(projection)).not.toContain("user_proj");
  });

  it("18. no external SMS/Stripe/Clerk/purge modules are imported by this slice", async () => {
    const repoSource = readFileSync(
      join(process.cwd(), "src/lib/account-deletion/repository.ts"),
      "utf8"
    );
    expect(repoSource).not.toMatch(/syncSmsAudience|stripe\.|deleteClerkUser|twilio/i);
    expect(repoSource).toMatch(/No HTTP routes in this slice/);
  });

  it("19. resume is bound to persisted current_step; skip-ahead fails closed", async () => {
    const { id } = await createAndLease({
      clerkUserId: "user_resume",
      idempotencyKey: "r1",
      lockOwner: "w",
    });
    await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "requested",
      toStatus: "suppressing_sms",
      lockOwner: "w",
    });
    await recordAccountDeletionFailure({
      requestId: id,
      fromStatus: "suppressing_sms",
      terminal: false,
      errorCode: "tmp",
      lockOwner: "w",
    });

    const skip = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "failed_retryable",
      toStatus: "deleting_clerk",
      lockOwner: "w",
    });
    expect(skip.ok).toBe(false);
    if (skip.ok) return;
    expect(skip.code).toBe("illegal_transition");

    // Must reacquire lease after failure released it.
    const lease = await acquireAccountDeletionLease({
      requestId: id,
      lockOwner: "w",
    });
    expect(lease.ok).toBe(true);

    const ok = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "failed_retryable",
      toStatus: "suppressing_sms",
      lockOwner: "w",
    });
    expect(ok.ok).toBe(true);
  });

  it("20. failed at canceling_subscription cannot resume at purging_app_data", async () => {
    const { id } = await createAndLease({
      clerkUserId: "user_resume2",
      idempotencyKey: "r2",
      lockOwner: "w",
    });
    for (const [from, to] of [
      ["requested", "suppressing_sms"],
      ["suppressing_sms", "sms_suppressed"],
      ["sms_suppressed", "canceling_subscription"],
    ] as const) {
      const t = await transitionAccountDeletionRequest({
        requestId: id,
        fromStatus: from,
        toStatus: to,
        lockOwner: "w",
      });
      expect(t.ok).toBe(true);
    }
    await recordAccountDeletionFailure({
      requestId: id,
      fromStatus: "canceling_subscription",
      terminal: false,
      errorCode: "stripe_tmp",
      lockOwner: "w",
    });
    await acquireAccountDeletionLease({ requestId: id, lockOwner: "w" });
    const skip = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "failed_retryable",
      toStatus: "purging_app_data",
      lockOwner: "w",
    });
    expect(skip.ok).toBe(false);
  });

  it("21. failed_terminal and completed cannot resume", async () => {
    const { id: termId } = await createAndLease({
      clerkUserId: "user_term",
      idempotencyKey: "ft",
      lockOwner: "w",
    });
    await transitionAccountDeletionRequest({
      requestId: termId,
      fromStatus: "requested",
      toStatus: "suppressing_sms",
      lockOwner: "w",
    });
    await recordAccountDeletionFailure({
      requestId: termId,
      fromStatus: "suppressing_sms",
      terminal: true,
      errorCode: "fatal",
      lockOwner: "w",
    });
    const termResume = await transitionAccountDeletionRequest({
      requestId: termId,
      fromStatus: "failed_terminal",
      toStatus: "suppressing_sms",
      lockOwner: "w",
    });
    expect(termResume.ok).toBe(false);

    const { id } = await createAndLease({
      clerkUserId: "user_complete",
      idempotencyKey: "done",
      lockOwner: "w",
    });
    for (const [from, to] of [
      ["requested", "suppressing_sms"],
      ["suppressing_sms", "sms_suppressed"],
      ["sms_suppressed", "canceling_subscription"],
      ["canceling_subscription", "subscription_canceled"],
      ["subscription_canceled", "purging_app_data"],
      ["purging_app_data", "app_data_purged"],
      ["app_data_purged", "deleting_clerk"],
      ["deleting_clerk", "completed"],
    ] as const) {
      expect(
        (
          await transitionAccountDeletionRequest({
            requestId: id,
            fromStatus: from,
            toStatus: to,
            lockOwner: "w",
          })
        ).ok
      ).toBe(true);
    }
    const doneResume = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "completed",
      toStatus: "suppressing_sms",
      lockOwner: "w",
    });
    expect(doneResume.ok).toBe(false);
  });

  it("22. transition/failure require lockOwner; wrong owner and stale lease fail", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_lock",
      idempotencyKey: "lk",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value.row.id;

    const noOwner = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "requested",
      toStatus: "suppressing_sms",
      lockOwner: "",
    });
    expect(noOwner.ok).toBe(false);
    if (!noOwner.ok) expect(noOwner.code).toBe("invalid_argument");

    const t0 = new Date("2026-07-18T12:00:00.000Z");
    await acquireAccountDeletionLease({
      requestId: id,
      lockOwner: "owner-a",
      now: t0,
      leaseMs: 60_000,
    });

    const wrong = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "requested",
      toStatus: "suppressing_sms",
      lockOwner: "owner-b",
      now: t0,
      leaseMs: 60_000,
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.code).toBe("lease_not_held");

    const failNoOwner = await recordAccountDeletionFailure({
      requestId: id,
      fromStatus: "requested",
      terminal: false,
      errorCode: "x",
      lockOwner: "   ",
    });
    expect(failNoOwner.ok).toBe(false);

    const failWrong = await recordAccountDeletionFailure({
      requestId: id,
      fromStatus: "requested",
      terminal: false,
      errorCode: "x",
      lockOwner: "owner-b",
      now: t0,
      leaseMs: 60_000,
    });
    expect(failWrong.ok).toBe(false);
    if (!failWrong.ok) expect(failWrong.code).toBe("lease_not_held");

    const stale = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "requested",
      toStatus: "suppressing_sms",
      lockOwner: "owner-a",
      now: new Date(t0.getTime() + 61_000),
      leaseMs: 60_000,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe("cas_conflict");

    const fresh = await acquireAccountDeletionLease({
      requestId: id,
      lockOwner: "owner-a",
      now: new Date(t0.getTime() + 62_000),
      leaseMs: 60_000,
    });
    expect(fresh.ok).toBe(true);
    const ok = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "requested",
      toStatus: "suppressing_sms",
      lockOwner: "owner-a",
      now: new Date(t0.getTime() + 62_000),
      leaseMs: 60_000,
    });
    expect(ok.ok).toBe(true);
  });

  it("23. simulated unique-violation recovery returns existing same-key row", async () => {
    useInMemoryAccountDeletionStoreForTests();
    const first = await createAccountDeletionRequest({
      clerkUserId: "user_race",
      idempotencyKey: "same",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const base = {
      async findById() {
        return null;
      },
      async findUnresolvedByUser() {
        return null;
      },
      async findAnyByUser() {
        return null;
      },
      async acquireLease() {
        return null;
      },
      async casWithActiveLease() {
        return null;
      },
      async releaseLease() {
        return null;
      },
      async listIdsForReconcile() {
        return [];
      },
      async seedForTests(row: AccountDeletionRequestRow) {
        return row;
      },
      async findByUserAndIdempotency(clerkUserId: string, key: string) {
        if (clerkUserId === "user_race" && key === "same") {
          return first.value.row;
        }
        return null;
      },
      async insert() {
        throw Object.assign(new Error("unique_violation"), { code: "23505" });
      },
    } as unknown as AccountDeletionStore;

    // First lookup misses (race window), insert throws 23505, recovery finds row.
    let lookups = 0;
    useAccountDeletionStoreForTests({
      ...base,
      async findByUserAndIdempotency(clerkUserId, key) {
        lookups += 1;
        if (lookups === 1) return null;
        return base.findByUserAndIdempotency(clerkUserId, key);
      },
    });

    const raced = await createAccountDeletionRequest({
      clerkUserId: "user_race",
      idempotencyKey: "same",
    });
    expect(raced.ok).toBe(true);
    if (!raced.ok) return;
    expect(raced.value.created).toBe(false);
    expect(raced.value.row.id).toBe(first.value.row.id);
  });

  it("24. zero-row CAS returns cas_conflict", async () => {
    const { id } = await createAndLease({
      clerkUserId: "user_cas",
      idempotencyKey: "z",
      lockOwner: "w",
    });
    // Wrong expected status → CAS filter misses.
    const missed = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "suppressing_sms",
      toStatus: "sms_suppressed",
      lockOwner: "w",
    });
    expect(missed.ok).toBe(false);
    if (!missed.ok) expect(missed.code).toBe("cas_conflict");
  });

  it("25. CAS sms_result: omit preserves; valid sets; null rejects", async () => {
    const { patchAccountDeletionRequestWhileLeased } = await import(
      "./repository"
    );
    const { id } = await createAndLease({
      clerkUserId: "user_sms_cas",
      idempotencyKey: "sms_cas",
      lockOwner: "w",
    });

    const noSet = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "requested",
      toStatus: "suppressing_sms",
      lockOwner: "w",
    });
    expect(noSet.ok).toBe(true);
    if (!noSet.ok) return;
    expect(noSet.value.sms_result).toBeNull();

    const setOk = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "suppressing_sms",
      toStatus: "sms_suppressed",
      lockOwner: "w",
      smsResult: "ok",
    });
    expect(setOk.ok).toBe(true);
    if (!setOk.ok) return;
    expect(setOk.value.sms_result).toBe("ok");

    const preserve = await patchAccountDeletionRequestWhileLeased({
      requestId: id,
      expectedStatus: "sms_suppressed",
      lockOwner: "w",
      steps: {
        ...setOk.value.steps,
        marker: { at: new Date().toISOString(), ok: true, code: "noop" },
      },
    });
    expect(preserve.ok).toBe(true);
    if (!preserve.ok) return;
    expect(preserve.value.sms_result).toBe("ok");

    const nullReject = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "sms_suppressed",
      toStatus: "canceling_subscription",
      lockOwner: "w",
      smsResult: null as unknown as "ok",
    });
    expect(nullReject.ok).toBe(false);
    if (!nullReject.ok) expect(nullReject.code).toBe("invalid_argument");

    const afterReject = await getAccountDeletionRequestById(id);
    expect(afterReject?.sms_result).toBe("ok");
    expect(afterReject?.status).toBe("sms_suppressed");
  });
});

describe("account deletion Supabase RPC construction", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
    useSupabaseAccountDeletionStoreForTests();
  });

  it("acquireLease calls acquire_account_deletion_lease RPC with fixed args", async () => {
    const row = {
      id: "11111111-1111-1111-1111-111111111111",
      clerk_user_id: "user_rpc",
      orchestration_version: 1,
      status: "requested",
      current_step: "requested",
      steps: {},
      attempt_count: 1,
      locked_at: "2026-07-18T12:00:00.000Z",
      lock_owner: "worker-rpc",
      created_at: "2026-07-18T12:00:00.000Z",
      updated_at: "2026-07-18T12:00:00.000Z",
      completed_at: null,
      last_retry_at: null,
      last_error_code: null,
      last_error_detail: null,
      sms_result: null,
      stripe_result: null,
      purge_result: null,
      clerk_result: null,
      idempotency_key: "k",
    };

    fromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
    }));

    rpcMock.mockResolvedValue({ data: [row], error: null });

    const result = await acquireAccountDeletionLease({
      requestId: row.id,
      lockOwner: "worker-rpc",
      leaseMs: 120000,
    });

    expect(result.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith(ACQUIRE_ACCOUNT_DELETION_LEASE_RPC, {
      p_request_id: row.id,
      p_lock_owner: "worker-rpc",
      p_lease_ms: 120000,
    });
  });

  it("casWithActiveLease omits clerkResult → p_clerk_result null and p_set_clerk_result false", async () => {
    const row = {
      id: "22222222-2222-2222-2222-222222222222",
      clerk_user_id: "user_rpc2",
      orchestration_version: 1,
      status: "requested",
      current_step: "requested",
      steps: { requested: { at: "t", ok: true } },
      attempt_count: 1,
      locked_at: "2026-07-18T12:00:00.000Z",
      lock_owner: "worker-rpc",
      created_at: "2026-07-18T12:00:00.000Z",
      updated_at: "2026-07-18T12:00:00.000Z",
      completed_at: null,
      last_retry_at: null,
      last_error_code: null,
      last_error_detail: null,
      sms_result: null,
      stripe_result: null,
      purge_result: null,
      clerk_result: null,
      idempotency_key: "k2",
    };
    const updated = {
      ...row,
      status: "suppressing_sms",
      current_step: "suppressing_sms",
    };

    fromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
    }));
    rpcMock.mockResolvedValue({ data: [updated], error: null });

    const result = await transitionAccountDeletionRequest({
      requestId: row.id,
      fromStatus: "requested",
      toStatus: "suppressing_sms",
      lockOwner: "worker-rpc",
      leaseMs: 120000,
    });

    expect(result.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith(
      CAS_ACCOUNT_DELETION_REQUEST_RPC,
      expect.objectContaining({
        p_request_id: row.id,
        p_expected_status: "requested",
        p_expected_orchestration_version: 1,
        p_lock_owner: "worker-rpc",
        p_lease_ms: 120000,
        p_new_status: "suppressing_sms",
        p_new_current_step: "suppressing_sms",
        p_clear_errors: true,
        p_release_lock: false,
        p_sms_result: null,
        p_set_sms_result: false,
        p_stripe_result: null,
        p_set_stripe_result: false,
        p_purge_result: null,
        p_set_purge_result: false,
        p_clerk_result: null,
        p_set_clerk_result: false,
      })
    );
  });

  it("zero-row RPC acquire surfaces lease_held or cas_conflict", async () => {
    const row = {
      id: "33333333-3333-3333-3333-333333333333",
      clerk_user_id: "user_rpc3",
      orchestration_version: 1,
      status: "requested",
      current_step: "requested",
      steps: {},
      attempt_count: 1,
      locked_at: new Date().toISOString(),
      lock_owner: "other",
      created_at: "2026-07-18T12:00:00.000Z",
      updated_at: "2026-07-18T12:00:00.000Z",
      completed_at: null,
      last_retry_at: null,
      last_error_code: null,
      last_error_detail: null,
      sms_result: null,
      stripe_result: null,
      purge_result: null,
      clerk_result: null,
      idempotency_key: "k3",
    };
    fromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
    }));
    rpcMock.mockResolvedValue({ data: [], error: null });

    const result = await acquireAccountDeletionLease({
      requestId: row.id,
      lockOwner: "me",
      leaseMs: 120000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("lease_held");
  });
});

describe("APP-041D0 clerk_result CAS migration (static)", () => {
  const sql = readFileSync(D0_CAS_MIGRATION, "utf8");
  const c2 = readFileSync(C2_CAS_MIGRATION, "utf8");
  const SIG20 =
    "UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN";
  const SIG22 = `${SIG20}, TEXT, BOOLEAN`;

  it("drops 20-arg and defensive 22-arg signatures; creates one 22-arg function", () => {
    expect(sql).toContain(
      `DROP FUNCTION IF EXISTS public.cas_account_deletion_request(\n  ${SIG20}\n)`
    );
    expect(sql).toContain(
      `DROP FUNCTION IF EXISTS public.cas_account_deletion_request(\n  ${SIG22}\n)`
    );
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.cas_account_deletion_request");
    expect(sql).toContain("p_purge_result TEXT DEFAULT NULL");
    expect(sql).toContain("p_set_purge_result BOOLEAN DEFAULT false");
    expect(sql).toContain("p_clerk_result TEXT DEFAULT NULL");
    expect(sql).toContain("p_set_clerk_result BOOLEAN DEFAULT false");
    // clerk args appended after purge args
    const purgeIdx = sql.indexOf("p_set_purge_result BOOLEAN DEFAULT false");
    const clerkIdx = sql.indexOf("p_clerk_result TEXT DEFAULT NULL");
    expect(purgeIdx).toBeGreaterThan(0);
    expect(clerkIdx).toBeGreaterThan(purgeIdx);
  });

  it("preserves SECURITY INVOKER, search_path, and service_role-only grants", () => {
    expect(sql).toContain("SECURITY INVOKER");
    expect(sql).toContain("SET search_path = public");
    expect(sql).toContain(
      `REVOKE ALL ON FUNCTION public.cas_account_deletion_request(${SIG22}) FROM PUBLIC`
    );
    expect(sql).toContain(
      `REVOKE ALL ON FUNCTION public.cas_account_deletion_request(${SIG22}) FROM anon`
    );
    expect(sql).toContain(
      `REVOKE ALL ON FUNCTION public.cas_account_deletion_request(${SIG22}) FROM authenticated`
    );
    expect(sql).toContain(
      `GRANT EXECUTE ON FUNCTION public.cas_account_deletion_request(${SIG22}) TO service_role`
    );
  });

  it("validates clerk_result enums and preserves when set=false", () => {
    expect(sql).toMatch(
      /IF p_set_clerk_result THEN[\s\S]*p_clerk_result NOT IN \('pending', 'ok', 'skipped', 'already_done', 'failed'\)/
    );
    expect(sql).toContain(
      "clerk_result = CASE\n      WHEN p_set_clerk_result THEN p_clerk_result\n      ELSE r.clerk_result\n    END"
    );
    // SMS/Stripe/purge semantics remain
    expect(sql).toContain("p_set_sms_result");
    expect(sql).toContain("p_set_stripe_result");
    expect(sql).toContain("p_set_purge_result");
    for (const pred of [
      "r.id = p_request_id",
      "r.status = p_expected_status",
      "r.orchestration_version = p_expected_orchestration_version",
      "r.lock_owner = v_owner",
    ]) {
      expect(sql).toContain(pred);
      expect(c2).toContain(pred);
    }
  });

  it("orders after C2 purge_result CAS migration", () => {
    expect(
      "20260719130000_account_deletion_cas_clerk_result.sql" >
        "20260719120000_account_deletion_cas_purge_result.sql"
    ).toBe(true);
  });
});

describe("APP-041D0 clerk_result repository wiring", () => {
  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
  });

  it("undefined clerkResult preserves; pending sets; null rejects; completion sets ok", async () => {
    const { id } = await createAndLease({
      clerkUserId: "user_d0_3",
      idempotencyKey: "kd03",
      lockOwner: "w",
    });
    const path: Array<{
      from: AccountDeletionStatus;
      to: AccountDeletionStatus;
      sms?: AccountDeletionRequestRow["sms_result"];
      stripe?: AccountDeletionRequestRow["stripe_result"];
      purge?: AccountDeletionRequestRow["purge_result"];
      clerk?: AccountDeletionRequestRow["clerk_result"];
    }> = [
      { from: "requested", to: "suppressing_sms", sms: "pending" },
      { from: "suppressing_sms", to: "sms_suppressed", sms: "ok" },
      { from: "sms_suppressed", to: "canceling_subscription", stripe: "pending" },
      {
        from: "canceling_subscription",
        to: "subscription_canceled",
        stripe: "ok",
      },
      { from: "subscription_canceled", to: "purging_app_data", purge: "pending" },
      { from: "purging_app_data", to: "app_data_purged", purge: "ok" },
      {
        from: "app_data_purged",
        to: "deleting_clerk",
        clerk: "pending",
      },
    ];
    for (const s of path) {
      const t = await transitionAccountDeletionRequest({
        requestId: id,
        fromStatus: s.from,
        toStatus: s.to,
        lockOwner: "w",
        ...(s.sms !== undefined ? { smsResult: s.sms } : {}),
        ...(s.stripe !== undefined ? { stripeResult: s.stripe } : {}),
        ...(s.purge !== undefined ? { purgeResult: s.purge } : {}),
        ...(s.clerk !== undefined ? { clerkResult: s.clerk } : {}),
      });
      expect(t.ok).toBe(true);
    }
    const pending = await getAccountDeletionRequestById(id);
    expect(pending?.status).toBe("deleting_clerk");
    expect(pending?.clerk_result).toBe("pending");
    expect(pending?.sms_result).toBe("ok");
    expect(pending?.stripe_result).toBe("ok");
    expect(pending?.purge_result).toBe("ok");

    const preserve = await patchAccountDeletionRequestWhileLeased({
      requestId: id,
      expectedStatus: "deleting_clerk",
      lockOwner: "w",
      steps: {
        ...pending!.steps,
        marker: { at: new Date().toISOString(), ok: true, code: "noop" },
      },
    });
    expect(preserve.ok).toBe(true);
    if (!preserve.ok) return;
    expect(preserve.value.clerk_result).toBe("pending");

    const nullReject = await transitionAccountDeletionRequest({
      requestId: id,
      fromStatus: "deleting_clerk",
      toStatus: "completed",
      lockOwner: "w",
      clerkResult: null as unknown as "ok",
    });
    expect(nullReject.ok).toBe(false);
    if (!nullReject.ok) expect(nullReject.code).toBe("invalid_argument");
    expect((await getAccountDeletionRequestById(id))?.clerk_result).toBe(
      "pending"
    );

    const completedOk = await markAccountDeletionCompleted({
      requestId: id,
      fromStatus: "deleting_clerk",
      lockOwner: "w",
      clerkResult: "ok",
    });
    expect(completedOk.ok).toBe(true);
    if (!completedOk.ok) return;
    expect(completedOk.value.status).toBe("completed");
    expect(completedOk.value.clerk_result).toBe("ok");
    expect(completedOk.value.sms_result).toBe("ok");
    expect(completedOk.value.purge_result).toBe("ok");
  });

  it("failure recorder sets clerk_result=failed without overwriting SMS/Stripe/purge", async () => {
    useInMemoryAccountDeletionStoreForTests();
    const { id } = await createAndLease({
      clerkUserId: "user_d0_fail",
      idempotencyKey: "kd0f",
      lockOwner: "w",
    });
    const path: Array<{
      from: AccountDeletionStatus;
      to: AccountDeletionStatus;
      sms?: AccountDeletionRequestRow["sms_result"];
      stripe?: AccountDeletionRequestRow["stripe_result"];
      purge?: AccountDeletionRequestRow["purge_result"];
      clerk?: AccountDeletionRequestRow["clerk_result"];
    }> = [
      { from: "requested", to: "suppressing_sms", sms: "pending" },
      { from: "suppressing_sms", to: "sms_suppressed", sms: "ok" },
      { from: "sms_suppressed", to: "canceling_subscription", stripe: "pending" },
      {
        from: "canceling_subscription",
        to: "subscription_canceled",
        stripe: "already_done",
      },
      { from: "subscription_canceled", to: "purging_app_data", purge: "pending" },
      { from: "purging_app_data", to: "app_data_purged", purge: "already_done" },
      { from: "app_data_purged", to: "deleting_clerk", clerk: "pending" },
    ];
    for (const s of path) {
      const t = await transitionAccountDeletionRequest({
        requestId: id,
        fromStatus: s.from,
        toStatus: s.to,
        lockOwner: "w",
        ...(s.sms !== undefined ? { smsResult: s.sms } : {}),
        ...(s.stripe !== undefined ? { stripeResult: s.stripe } : {}),
        ...(s.purge !== undefined ? { purgeResult: s.purge } : {}),
        ...(s.clerk !== undefined ? { clerkResult: s.clerk } : {}),
      });
      expect(t.ok).toBe(true);
    }

    const failed = await recordAccountDeletionFailure({
      requestId: id,
      fromStatus: "deleting_clerk",
      terminal: false,
      errorCode: "clerk_delete_retryable",
      errorDetail: "transient",
      lockOwner: "w",
      clerkResult: "failed",
    });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.value.status).toBe("failed_retryable");
    expect(failed.value.current_step).toBe("deleting_clerk");
    expect(failed.value.clerk_result).toBe("failed");
    expect(failed.value.sms_result).toBe("ok");
    expect(failed.value.stripe_result).toBe("already_done");
    expect(failed.value.purge_result).toBe("already_done");
  });

  it("completion can set clerk_result=already_done", async () => {
    useInMemoryAccountDeletionStoreForTests();
    const { id } = await createAndLease({
      clerkUserId: "user_d0_ad",
      idempotencyKey: "kd0ad",
      lockOwner: "w",
    });
    const path: Array<{
      from: AccountDeletionStatus;
      to: AccountDeletionStatus;
      sms?: AccountDeletionRequestRow["sms_result"];
      stripe?: AccountDeletionRequestRow["stripe_result"];
      purge?: AccountDeletionRequestRow["purge_result"];
      clerk?: AccountDeletionRequestRow["clerk_result"];
    }> = [
      { from: "requested", to: "suppressing_sms", sms: "pending" },
      { from: "suppressing_sms", to: "sms_suppressed", sms: "ok" },
      { from: "sms_suppressed", to: "canceling_subscription", stripe: "pending" },
      {
        from: "canceling_subscription",
        to: "subscription_canceled",
        stripe: "ok",
      },
      { from: "subscription_canceled", to: "purging_app_data", purge: "pending" },
      { from: "purging_app_data", to: "app_data_purged", purge: "ok" },
      { from: "app_data_purged", to: "deleting_clerk", clerk: "pending" },
    ];
    for (const s of path) {
      const t = await transitionAccountDeletionRequest({
        requestId: id,
        fromStatus: s.from,
        toStatus: s.to,
        lockOwner: "w",
        ...(s.sms !== undefined ? { smsResult: s.sms } : {}),
        ...(s.stripe !== undefined ? { stripeResult: s.stripe } : {}),
        ...(s.purge !== undefined ? { purgeResult: s.purge } : {}),
        ...(s.clerk !== undefined ? { clerkResult: s.clerk } : {}),
      });
      expect(t.ok).toBe(true);
    }

    const done = await markAccountDeletionCompleted({
      requestId: id,
      fromStatus: "deleting_clerk",
      lockOwner: "w",
      clerkResult: "already_done",
    });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.clerk_result).toBe("already_done");
    expect(done.value.status).toBe("completed");
  });

  it("RPC transition with clerkResult=pending sends set=true and exact clerk args", async () => {
    useSupabaseAccountDeletionStoreForTests();
    rpcMock.mockReset();
    fromMock.mockReset();
    const row = {
      id: "44444444-4444-4444-4444-444444444444",
      clerk_user_id: "user_rpc4",
      orchestration_version: 1,
      status: "app_data_purged",
      current_step: "app_data_purged",
      steps: {},
      attempt_count: 1,
      locked_at: "2026-07-19T12:00:00.000Z",
      lock_owner: "worker-rpc",
      created_at: "2026-07-19T12:00:00.000Z",
      updated_at: "2026-07-19T12:00:00.000Z",
      completed_at: null,
      last_retry_at: null,
      last_error_code: null,
      last_error_detail: null,
      sms_result: "ok",
      stripe_result: "ok",
      purge_result: "ok",
      clerk_result: null,
      idempotency_key: "k4",
    };
    const updated = {
      ...row,
      status: "deleting_clerk",
      current_step: "deleting_clerk",
      clerk_result: "pending",
    };
    fromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
    }));
    rpcMock.mockResolvedValue({ data: [updated], error: null });

    const withPending = await transitionAccountDeletionRequest({
      requestId: row.id,
      fromStatus: "app_data_purged",
      toStatus: "deleting_clerk",
      lockOwner: "worker-rpc",
      clerkResult: "pending",
    });
    expect(withPending.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith(
      CAS_ACCOUNT_DELETION_REQUEST_RPC,
      expect.objectContaining({
        p_clerk_result: "pending",
        p_set_clerk_result: true,
        p_set_purge_result: false,
        p_purge_result: null,
      })
    );
  });
});
