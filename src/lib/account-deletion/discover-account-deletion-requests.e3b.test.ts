/**
 * APP-041E3b — bounded ID-only discovery tests.
 * In-memory mirror + migration static checks. No live Supabase / providers.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import {
  accountDeletionRetryBackoffMs,
  ACCOUNT_DELETION_VICTORY_MEDIA_TOKEN_BARRIER_MS,
  selectAccountDeletionRequestIdsForReconcile,
} from "./discover-account-deletion-requests";
import {
  LIST_ACCOUNT_DELETION_REQUESTS_FOR_RECONCILE_RPC,
  listAccountDeletionRequestIdsForReconcile,
  seedAccountDeletionRequestForTests,
  useAccountDeletionStoreForTests,
  useInMemoryAccountDeletionStoreForTests,
  useSupabaseAccountDeletionStoreForTests,
  type AccountDeletionStore,
} from "./repository";
import type { AccountDeletionRequestRow, AccountDeletionStatus } from "./types";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260810180000_list_account_deletion_requests_victory_media_token_barrier.sql"
);
const LEGACY_MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260719140000_list_account_deletion_requests_for_reconcile.sql"
);
const VERCEL_JSON = join(process.cwd(), "vercel.json");
const APP_DIR = join(process.cwd(), "src/app");
const COMPONENTS_DIR = join(process.cwd(), "src/components");
const REPO = join(process.cwd(), "src/lib/account-deletion/repository.ts");
const DISCOVER = join(
  process.cwd(),
  "src/lib/account-deletion/discover-account-deletion-requests.ts"
);

const FN_SIG = "INTEGER, INTEGER, TIMESTAMPTZ";

function baseRow(
  overrides: Partial<AccountDeletionRequestRow> &
    Pick<AccountDeletionRequestRow, "id" | "clerk_user_id" | "status" | "current_step">
): AccountDeletionRequestRow {
  const now = "2026-07-19T12:00:00.000Z";
  return {
    orchestration_version: 1,
    steps: {},
    attempt_count: 0,
    locked_at: null,
    lock_owner: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
    last_retry_at: null,
    last_error_code: null,
    last_error_detail: null,
    sms_result: null,
    stripe_result: null,
    purge_result: null,
    clerk_result: null,
    idempotency_key: `key-${overrides.id}`,
    ...overrides,
  };
}

async function seed(row: AccountDeletionRequestRow) {
  await seedAccountDeletionRequestForTests(row);
}

describe("APP-041E3b discovery migration (static)", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const legacy = readFileSync(LEGACY_MIGRATION, "utf8");

  it("36–46. service-role-only; INVOKER; IDs-only; no mutation/dynamic SQL", () => {
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.list_account_deletion_requests_for_reconcile("
    );
    expect(sql).toContain("RETURNS TABLE (request_id UUID)");
    expect(sql).toContain("SECURITY INVOKER");
    expect(sql).toContain("SET search_path = public");
    expect(sql).toContain(
      `REVOKE ALL ON FUNCTION public.list_account_deletion_requests_for_reconcile(${FN_SIG}) FROM PUBLIC`
    );
    expect(sql).toContain(
      `REVOKE ALL ON FUNCTION public.list_account_deletion_requests_for_reconcile(${FN_SIG}) FROM anon`
    );
    expect(sql).toContain(
      `REVOKE ALL ON FUNCTION public.list_account_deletion_requests_for_reconcile(${FN_SIG}) FROM authenticated`
    );
    expect(sql).toContain(
      `GRANT EXECUTE ON FUNCTION public.list_account_deletion_requests_for_reconcile(${FN_SIG}) TO service_role`
    );
    expect(sql).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).not.toMatch(/EXECUTE\s+FORMAT|EXECUTE\s+'/i);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(sql).toContain("RETURNS TABLE (request_id UUID)");
    expect(sql).not.toContain("clerk_user_id");
    expect(sql).not.toContain("idempotency_key");
    expect(sql).not.toContain("last_error");
    expect(sql).not.toMatch(/acquire_account_deletion_lease\s*\(/);
    // Lease filter may reference lock_owner/locked_at; they must not appear in RETURNS.
    expect(sql).toMatch(/lock_owner IS NULL/);
    // Failed-retry backoff base: newest of retry-start and updated_at (not COALESCE alone).
    expect(sql).toMatch(
      /GREATEST\s*\(\s*COALESCE\s*\(\s*r\.last_retry_at\s*,\s*r\.updated_at\s*\)\s*,\s*r\.updated_at\s*\)/
    );
    expect(sql).not.toMatch(
      /THEN\s+COALESCE\s*\(\s*r\.last_retry_at\s*,\s*r\.updated_at\s*\)\s*\+/
    );
    // Victory Media token barrier (happy-path app_data_purged only).
    expect(sql).toMatch(
      /WHEN\s+r\.status\s*=\s*'app_data_purged'\s+THEN\s+r\.created_at\s*\+\s*INTERVAL\s+'2 hours 5 minutes'/
    );
    // failed_retryable branch still uses GREATEST(...)+backoff.
    expect(sql).toMatch(
      /WHEN\s+r\.status\s*=\s*'failed_retryable'\s+THEN[\s\S]*?GREATEST\s*\(\s*COALESCE/
    );
    expect(legacy).toContain(
      "list_account_deletion_requests_for_reconcile"
    );
  });
});

describe("APP-041E3b in-memory discovery eligibility", () => {
  const now = new Date("2026-07-19T12:00:00.000Z");

  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
  });
  afterEach(() => {
    useSupabaseAccountDeletionStoreForTests();
  });

  const happy: AccountDeletionStatus[] = [
    "requested",
    "suppressing_sms",
    "sms_suppressed",
    "canceling_subscription",
    "subscription_canceled",
    "purging_app_data",
    "app_data_purged",
    "deleting_clerk",
  ];

  it.each(happy.map((s, i) => [i + 1, s] as const))(
    "%s. %s/%s included",
    async (_n, status) => {
      const id = `00000000-0000-4000-8000-0000000000${String(_n).padStart(2, "0")}`;
      const createdAt =
        status === "app_data_purged"
          ? new Date(
              now.getTime() - ACCOUNT_DELETION_VICTORY_MEDIA_TOKEN_BARRIER_MS
            ).toISOString()
          : "2026-07-19T12:00:00.000Z";
      await seed(
        baseRow({
          id,
          clerk_user_id: `user_${status}`,
          status,
          current_step: status,
          created_at: createdAt,
          updated_at: "2026-07-19T12:00:00.000Z",
        })
      );
      const result = await listAccountDeletionRequestIdsForReconcile({
        limit: 10,
        leaseMs: 120_000,
        now,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.requestIds).toContain(id);
    }
  );

  it("app_data_purged before barrier excluded; at barrier included; does not starve", async () => {
    const t0 = new Date("2026-07-19T10:00:00.000Z");
    const waitingId = "00000000-0000-4000-8000-000000000801";
    const readyOtherId = "00000000-0000-4000-8000-000000000802";
    await seed(
      baseRow({
        id: waitingId,
        clerk_user_id: "user_wait",
        status: "app_data_purged",
        current_step: "app_data_purged",
        created_at: t0.toISOString(),
        updated_at: "2026-07-19T09:00:00.000Z",
      })
    );
    await seed(
      baseRow({
        id: readyOtherId,
        clerk_user_id: "user_ready",
        status: "requested",
        current_step: "requested",
        created_at: "2026-07-19T11:00:00.000Z",
        updated_at: "2026-07-19T11:00:00.000Z",
      })
    );

    const beforeBarrier = new Date(
      t0.getTime() + ACCOUNT_DELETION_VICTORY_MEDIA_TOKEN_BARRIER_MS - 1000
    );
    const early = await listAccountDeletionRequestIdsForReconcile({
      limit: 1,
      leaseMs: 120_000,
      now: beforeBarrier,
    });
    expect(early.ok).toBe(true);
    if (!early.ok) return;
    expect(early.value.requestIds).toEqual([readyOtherId]);
    expect(early.value.requestIds).not.toContain(waitingId);

    const pure = selectAccountDeletionRequestIdsForReconcile(
      [
        baseRow({
          id: waitingId,
          clerk_user_id: "user_wait",
          status: "app_data_purged",
          current_step: "app_data_purged",
          created_at: t0.toISOString(),
          updated_at: "2026-07-19T09:00:00.000Z",
        }),
      ],
      {
        limit: 1,
        leaseMs: 120_000,
        now: beforeBarrier,
      }
    );
    expect(pure).toEqual([]);

    const atBarrier = new Date(
      t0.getTime() + ACCOUNT_DELETION_VICTORY_MEDIA_TOKEN_BARRIER_MS
    );
    const ready = selectAccountDeletionRequestIdsForReconcile(
      [
        baseRow({
          id: waitingId,
          clerk_user_id: "user_wait",
          status: "app_data_purged",
          current_step: "app_data_purged",
          created_at: t0.toISOString(),
          updated_at: "2026-07-19T09:00:00.000Z",
        }),
      ],
      { limit: 1, leaseMs: 120_000, now: atBarrier }
    );
    expect(ready).toEqual([waitingId]);
  });

  it("9. failed_retryable valid step included after backoff", async () => {
    const id = "00000000-0000-4000-8000-000000000101";
    await seed(
      baseRow({
        id,
        clerk_user_id: "user_fr",
        status: "failed_retryable",
        current_step: "suppressing_sms",
        attempt_count: 0,
        updated_at: "2026-07-19T11:50:00.000Z", // 10 min ago → past 5m backoff
        last_retry_at: null,
      })
    );
    const result = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      leaseMs: 120_000,
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requestIds).toContain(id);
  });

  it("10–11. completed and failed_terminal excluded", async () => {
    await seed(
      baseRow({
        id: "00000000-0000-4000-8000-000000000201",
        clerk_user_id: "user_done",
        status: "completed",
        current_step: "completed",
      })
    );
    await seed(
      baseRow({
        id: "00000000-0000-4000-8000-000000000202",
        clerk_user_id: "user_term",
        status: "failed_terminal",
        current_step: "deleting_clerk",
      })
    );
    const result = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requestIds).toEqual([]);
  });

  it("12–14. illegal pair / unsupported version / blank step excluded", async () => {
    await seed(
      baseRow({
        id: "00000000-0000-4000-8000-000000000301",
        clerk_user_id: "user_illegal",
        status: "failed_retryable",
        current_step: "sms_suppressed",
        updated_at: "2026-07-19T11:00:00.000Z",
      })
    );
    await seed(
      baseRow({
        id: "00000000-0000-4000-8000-000000000302",
        clerk_user_id: "user_ver",
        status: "requested",
        current_step: "requested",
        orchestration_version: 99,
      })
    );
    await seed(
      baseRow({
        id: "00000000-0000-4000-8000-000000000303",
        clerk_user_id: "user_blank",
        status: "requested",
        // Force blank via cast — schema forbids; mirror must exclude.
        current_step: "" as AccountDeletionStatus,
      })
    );
    const result = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requestIds).toEqual([]);
  });
});

describe("APP-041E3b leases", () => {
  const now = new Date("2026-07-19T12:00:00.000Z");
  const leaseMs = 120_000;

  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
  });
  afterEach(() => {
    useSupabaseAccountDeletionStoreForTests();
  });

  it("15–16. no lease and null locked_at included", async () => {
    await seed(
      baseRow({
        id: "00000000-0000-4000-8000-000000000401",
        clerk_user_id: "user_nolease",
        status: "requested",
        current_step: "requested",
        lock_owner: null,
        locked_at: null,
      })
    );
    await seed(
      baseRow({
        id: "00000000-0000-4000-8000-000000000402",
        clerk_user_id: "user_null_locked",
        status: "requested",
        current_step: "requested",
        lock_owner: "someone",
        locked_at: null,
      })
    );
    const result = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      leaseMs,
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requestIds).toEqual([
      "00000000-0000-4000-8000-000000000401",
      "00000000-0000-4000-8000-000000000402",
    ]);
  });

  it("17. active lease excluded", async () => {
    await seed(
      baseRow({
        id: "00000000-0000-4000-8000-000000000403",
        clerk_user_id: "user_active",
        status: "requested",
        current_step: "requested",
        lock_owner: "worker",
        locked_at: "2026-07-19T11:59:00.000Z", // 60s ago < 120s
      })
    );
    const result = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      leaseMs,
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requestIds).toEqual([]);
  });

  it("18–19. expired lease included; boundary still active (SQL <)", async () => {
    await seed(
      baseRow({
        id: "00000000-0000-4000-8000-000000000404",
        clerk_user_id: "user_expired",
        status: "requested",
        current_step: "requested",
        lock_owner: "worker",
        locked_at: "2026-07-19T11:57:59.000Z", // 121s ago → expired
      })
    );
    await seed(
      baseRow({
        id: "00000000-0000-4000-8000-000000000405",
        clerk_user_id: "user_boundary",
        status: "requested",
        current_step: "requested",
        lock_owner: "worker",
        // exactly now - leaseMs → NOT expired under SQL strict <
        locked_at: "2026-07-19T11:58:00.000Z",
      })
    );
    const result = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      leaseMs,
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requestIds).toEqual([
      "00000000-0000-4000-8000-000000000404",
    ]);
  });

  it("20. invalid leaseMs returns no rows", async () => {
    await seed(
      baseRow({
        id: "00000000-0000-4000-8000-000000000406",
        clerk_user_id: "user_lease_bad",
        status: "requested",
        current_step: "requested",
      })
    );
    for (const bad of [0, 999, 3_600_001, -1]) {
      const result = await listAccountDeletionRequestIdsForReconcile({
        limit: 10,
        leaseMs: bad,
        now,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.requestIds).toEqual([]);
    }
  });
});

describe("APP-041E3b backoff", () => {
  const now = new Date("2026-07-19T12:00:00.000Z");

  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
  });
  afterEach(() => {
    useSupabaseAccountDeletionStoreForTests();
  });

  it("21–22. before 5m excluded; after included", async () => {
    const early = "00000000-0000-4000-8000-000000000501";
    const ready = "00000000-0000-4000-8000-000000000502";
    await seed(
      baseRow({
        id: early,
        clerk_user_id: "user_early",
        status: "failed_retryable",
        current_step: "suppressing_sms",
        attempt_count: 1,
        updated_at: "2026-07-19T11:56:00.000Z", // 4 min ago
      })
    );
    await seed(
      baseRow({
        id: ready,
        clerk_user_id: "user_ready",
        status: "failed_retryable",
        current_step: "suppressing_sms",
        attempt_count: 1,
        updated_at: "2026-07-19T11:54:00.000Z", // 6 min ago
      })
    );
    const result = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requestIds).toEqual([ready]);
  });

  it("23–25. attempt_count tiers 15m / 30m / 60m", () => {
    expect(accountDeletionRetryBackoffMs(3)).toBe(15 * 60 * 1000);
    expect(accountDeletionRetryBackoffMs(5)).toBe(15 * 60 * 1000);
    expect(accountDeletionRetryBackoffMs(6)).toBe(30 * 60 * 1000);
    expect(accountDeletionRetryBackoffMs(9)).toBe(30 * 60 * 1000);
    expect(accountDeletionRetryBackoffMs(10)).toBe(60 * 60 * 1000);
  });

  it("23b. attempt_count 3 uses 15 minutes gate", async () => {
    const id = "00000000-0000-4000-8000-000000000503";
    await seed(
      baseRow({
        id,
        clerk_user_id: "user_a3",
        status: "failed_retryable",
        current_step: "canceling_subscription",
        attempt_count: 3,
        updated_at: "2026-07-19T11:50:00.000Z", // 10m — not enough for 15m
      })
    );
    const blocked = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      now,
    });
    expect(blocked.ok).toBe(true);
    if (blocked.ok) expect(blocked.value.requestIds).toEqual([]);

    await seed(
      baseRow({
        id,
        clerk_user_id: "user_a3",
        status: "failed_retryable",
        current_step: "canceling_subscription",
        attempt_count: 3,
        updated_at: "2026-07-19T11:44:00.000Z", // 16m
      })
    );
    const ok = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      now,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.requestIds).toEqual([id]);
  });

  it("24b–25b. attempt 6 / 10 gates", async () => {
    const id6 = "00000000-0000-4000-8000-000000000504";
    const id10 = "00000000-0000-4000-8000-000000000505";
    await seed(
      baseRow({
        id: id6,
        clerk_user_id: "user_a6",
        status: "failed_retryable",
        current_step: "purging_app_data",
        attempt_count: 6,
        updated_at: "2026-07-19T11:31:00.000Z", // 29m — blocked
      })
    );
    await seed(
      baseRow({
        id: id10,
        clerk_user_id: "user_a10",
        status: "failed_retryable",
        current_step: "deleting_clerk",
        attempt_count: 10,
        updated_at: "2026-07-19T11:01:00.000Z", // 59m — blocked
      })
    );
    let result = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      now,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.requestIds).toEqual([]);

    await seed(
      baseRow({
        id: id6,
        clerk_user_id: "user_a6",
        status: "failed_retryable",
        current_step: "purging_app_data",
        attempt_count: 6,
        updated_at: "2026-07-19T11:29:00.000Z", // 31m
      })
    );
    await seed(
      baseRow({
        id: id10,
        clerk_user_id: "user_a10",
        status: "failed_retryable",
        current_step: "deleting_clerk",
        attempt_count: 10,
        updated_at: "2026-07-19T10:59:00.000Z", // 61m
      })
    );
    result = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      now,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.requestIds).toEqual([id10, id6]);
    }
  });

  it("26. last_retry_at preferred over updated_at when newer", async () => {
    const id = "00000000-0000-4000-8000-000000000506";
    await seed(
      baseRow({
        id,
        clerk_user_id: "user_lr",
        status: "failed_retryable",
        current_step: "suppressing_sms",
        attempt_count: 0,
        updated_at: "2026-07-19T11:00:00.000Z", // would be ready
        last_retry_at: "2026-07-19T11:58:00.000Z", // 2m ago → blocked
      })
    );
    const result = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      now,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.requestIds).toEqual([]);
  });

  it("26b–26g. GREATEST backoff: stale last_retry_at does not hot-loop", async () => {
    const id = "00000000-0000-4000-8000-000000000510";
    // Retry began 10:00; stage failed 10:06 → base must be 10:06 (+5m → 10:11).
    const failedRow = baseRow({
      id,
      clerk_user_id: "user_stale_lr",
      status: "failed_retryable",
      current_step: "suppressing_sms",
      attempt_count: 1,
      last_retry_at: "2026-07-19T10:00:00.000Z",
      updated_at: "2026-07-19T10:06:00.000Z",
    });
    await seed(failedRow);

    const at1010 = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      now: new Date("2026-07-19T10:10:00.000Z"),
    });
    expect(at1010.ok).toBe(true);
    if (at1010.ok) expect(at1010.value.requestIds).toEqual([]);

    // Exact threshold equality (10:06 + 5m) remains included.
    const at1011 = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      now: new Date("2026-07-19T10:11:00.000Z"),
    });
    expect(at1011.ok).toBe(true);
    if (at1011.ok) expect(at1011.value.requestIds).toEqual([id]);

    // Stage duration > prior 5m delay must not cause immediate eligibility at failure.
    const atFailure = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      now: new Date("2026-07-19T10:06:00.000Z"),
    });
    expect(atFailure.ok).toBe(true);
    if (atFailure.ok) expect(atFailure.value.requestIds).toEqual([]);

    // Pure selector matches repository/SQL semantics for the same row.
    expect(
      selectAccountDeletionRequestIdsForReconcile([failedRow], {
        limit: 10,
        leaseMs: 120_000,
        now: new Date("2026-07-19T10:10:00.000Z"),
      })
    ).toEqual([]);
    expect(
      selectAccountDeletionRequestIdsForReconcile([failedRow], {
        limit: 10,
        leaseMs: 120_000,
        now: new Date("2026-07-19T10:11:00.000Z"),
      })
    ).toEqual([id]);
  });

  it("26h. last_retry_at null uses updated_at", async () => {
    const id = "00000000-0000-4000-8000-000000000511";
    await seed(
      baseRow({
        id,
        clerk_user_id: "user_null_lr",
        status: "failed_retryable",
        current_step: "canceling_subscription",
        attempt_count: 0,
        last_retry_at: null,
        updated_at: "2026-07-19T10:06:00.000Z",
      })
    );
    const early = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      now: new Date("2026-07-19T10:10:00.000Z"),
    });
    expect(early.ok).toBe(true);
    if (early.ok) expect(early.value.requestIds).toEqual([]);

    const ready = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      now: new Date("2026-07-19T10:11:00.000Z"),
    });
    expect(ready.ok).toBe(true);
    if (ready.ok) expect(ready.value.requestIds).toEqual([id]);
  });

  it("27. non-failed statuses do not receive retry backoff", async () => {
    const id = "00000000-0000-4000-8000-000000000507";
    await seed(
      baseRow({
        id,
        clerk_user_id: "user_nofail",
        status: "requested",
        current_step: "requested",
        attempt_count: 50,
        updated_at: "2026-07-19T11:59:30.000Z", // 30s ago — eligible immediately
      })
    );
    const result = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      now,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.requestIds).toEqual([id]);
  });
});

describe("APP-041E3b ordering and limits", () => {
  const now = new Date("2026-07-19T12:00:00.000Z");

  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
  });
  afterEach(() => {
    useSupabaseAccountDeletionStoreForTests();
  });

  it("28–30. oldest effective eligibility; updated_at then id; deterministic", async () => {
    await seed(
      baseRow({
        id: "00000000-0000-4000-8000-000000000602",
        clerk_user_id: "user_b",
        status: "requested",
        current_step: "requested",
        updated_at: "2026-07-19T11:00:00.000Z",
      })
    );
    await seed(
      baseRow({
        id: "00000000-0000-4000-8000-000000000601",
        clerk_user_id: "user_a",
        status: "requested",
        current_step: "requested",
        updated_at: "2026-07-19T11:00:00.000Z",
      })
    );
    await seed(
      baseRow({
        id: "00000000-0000-4000-8000-000000000603",
        clerk_user_id: "user_c",
        status: "requested",
        current_step: "requested",
        updated_at: "2026-07-19T10:00:00.000Z",
      })
    );
    const a = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      now,
    });
    const b = await listAccountDeletionRequestIdsForReconcile({
      limit: 10,
      now,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.requestIds).toEqual([
      "00000000-0000-4000-8000-000000000603",
      "00000000-0000-4000-8000-000000000601",
      "00000000-0000-4000-8000-000000000602",
    ]);
    expect(b.value.requestIds).toEqual(a.value.requestIds);
  });

  it("31–35. limit 1 / 3 / clamp 10 / zero-negative empty / null→1", async () => {
    for (let i = 1; i <= 12; i++) {
      await seed(
        baseRow({
          id: `00000000-0000-4000-8000-0000000010${String(i).padStart(2, "0")}`,
          clerk_user_id: `user_lim_${i}`,
          status: "requested",
          current_step: "requested",
          updated_at: `2026-07-19T${String(10 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`,
        })
      );
    }
    const one = await listAccountDeletionRequestIdsForReconcile({
      limit: 1,
      now,
    });
    expect(one.ok).toBe(true);
    if (one.ok) expect(one.value.requestIds).toHaveLength(1);

    const three = await listAccountDeletionRequestIdsForReconcile({
      limit: 3,
      now,
    });
    expect(three.ok).toBe(true);
    if (three.ok) expect(three.value.requestIds).toHaveLength(3);

    const capped = await listAccountDeletionRequestIdsForReconcile({
      limit: 99,
      now,
    });
    expect(capped.ok).toBe(true);
    if (capped.ok) expect(capped.value.requestIds).toHaveLength(10);

    const zero = await listAccountDeletionRequestIdsForReconcile({
      limit: 0,
      now,
    });
    expect(zero.ok).toBe(true);
    if (zero.ok) expect(zero.value.requestIds).toEqual([]);

    const neg = await listAccountDeletionRequestIdsForReconcile({
      limit: -5,
      now,
    });
    expect(neg.ok).toBe(true);
    if (neg.ok) expect(neg.value.requestIds).toEqual([]);

    const def = await listAccountDeletionRequestIdsForReconcile({
      limit: null,
      now,
    });
    expect(def.ok).toBe(true);
    if (def.ok) expect(def.value.requestIds).toHaveLength(1);
  });
});

describe("APP-041E3b repository helper", () => {
  afterEach(() => {
    useSupabaseAccountDeletionStoreForTests();
    rpcMock.mockReset();
  });

  it("47a. production RPC omits p_now (Postgres DEFAULT now())", async () => {
    useSupabaseAccountDeletionStoreForTests();
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const result = await listAccountDeletionRequestIdsForReconcile({
      limit: 1,
      leaseMs: 120_000,
    });
    expect(result.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      LIST_ACCOUNT_DELETION_REQUESTS_FOR_RECONCILE_RPC,
      {
        p_limit: 1,
        p_lease_ms: 120_000,
      }
    );
    const args = rpcMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args).not.toHaveProperty("p_now");
    expect(Object.keys(args).sort()).toEqual(["p_lease_ms", "p_limit"]);
  });

  it("47b. explicit test clock still sends p_now when supplied", async () => {
    useSupabaseAccountDeletionStoreForTests();
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const now = new Date("2026-07-19T12:00:00.000Z");
    const result = await listAccountDeletionRequestIdsForReconcile({
      limit: 1,
      leaseMs: 120_000,
      now,
    });
    expect(result.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith(
      LIST_ACCOUNT_DELETION_REQUESTS_FOR_RECONCILE_RPC,
      {
        p_limit: 1,
        p_lease_ms: 120_000,
        p_now: now.toISOString(),
      }
    );
  });

  it("48–49. malformed ID rejected; duplicates deduped preserving order", async () => {
    useAccountDeletionStoreForTests({
      async listIdsForReconcile() {
        return [
          "00000000-0000-4000-8000-000000000701",
          "not-a-uuid",
        ];
      },
    } as unknown as AccountDeletionStore);
    const bad = await listAccountDeletionRequestIdsForReconcile({ limit: 10 });
    expect(bad).toEqual({
      ok: false,
      code: "internal_error",
      message: "Discovery returned a malformed request id",
    });

    useAccountDeletionStoreForTests({
      async listIdsForReconcile() {
        return [
          "00000000-0000-4000-8000-000000000702",
          "00000000-0000-4000-8000-000000000703",
          "00000000-0000-4000-8000-000000000702",
        ];
      },
    } as unknown as AccountDeletionStore);
    const dup = await listAccountDeletionRequestIdsForReconcile({ limit: 10 });
    expect(dup.ok).toBe(true);
    if (dup.ok) {
      expect(dup.value.requestIds).toEqual([
        "00000000-0000-4000-8000-000000000702",
        "00000000-0000-4000-8000-000000000703",
      ]);
    }
  });

  it("50. raw Supabase error not returned", async () => {
    useSupabaseAccountDeletionStoreForTests();
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: {
        message: "permission denied for secret table xyz",
        code: "42501",
      },
    });
    const result = await listAccountDeletionRequestIdsForReconcile({
      limit: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("internal_error");
      expect(result.message).toBe("Account deletion discovery failed");
      expect(JSON.stringify(result)).not.toMatch(/permission denied|secret/i);
    }
  });

  it("51. preserves SQL order from store", async () => {
    useAccountDeletionStoreForTests({
      async listIdsForReconcile() {
        return [
          "00000000-0000-4000-8000-000000000801",
          "00000000-0000-4000-8000-000000000802",
        ];
      },
    } as unknown as AccountDeletionStore);
    const result = await listAccountDeletionRequestIdsForReconcile({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.requestIds).toEqual([
        "00000000-0000-4000-8000-000000000801",
        "00000000-0000-4000-8000-000000000802",
      ]);
    }
  });

  it("52–53. no provider imports; no reconciler invocation in discovery module", () => {
    const discoverSrc = readFileSync(DISCOVER, "utf8");
    const repoSrc = readFileSync(REPO, "utf8");
    expect(discoverSrc).not.toMatch(/stripe|twilio|openai|resend/i);
    expect(discoverSrc).not.toContain("reconcileAccountDeletionRequest");
    expect(discoverSrc).not.toContain("executeTrustedAccountDeletionReconcile");
    expect(repoSrc).toContain("listAccountDeletionRequestIdsForReconcile");
    expect(repoSrc).toContain(LIST_ACCOUNT_DELETION_REQUESTS_FOR_RECONCILE_RPC);
  });
});

describe("APP-041E3b pure selector fidelity + no-processing proof", () => {
  it("pure selector matches helper for mixed fixture", () => {
    const now = new Date("2026-07-19T12:00:00.000Z");
    const rows = [
      baseRow({
        id: "00000000-0000-4000-8000-000000000901",
        clerk_user_id: "a",
        status: "completed",
        current_step: "completed",
      }),
      baseRow({
        id: "00000000-0000-4000-8000-000000000902",
        clerk_user_id: "b",
        status: "requested",
        current_step: "requested",
        updated_at: "2026-07-19T11:00:00.000Z",
      }),
    ];
    expect(
      selectAccountDeletionRequestIdsForReconcile(rows, {
        limit: 10,
        leaseMs: 120_000,
        now,
      })
    ).toEqual(["00000000-0000-4000-8000-000000000902"]);
  });

  it("55. discovery wiring only on cron route; E4d may schedule while disabled", () => {
    const vercel = JSON.parse(readFileSync(VERCEL_JSON, "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    const deletionCrons = vercel.crons.filter(
      (c) => c.path === "/api/cron/account-deletions"
    );
    expect(deletionCrons.length).toBeLessThanOrEqual(1);
    expect(readFileSync(VERCEL_JSON, "utf8")).not.toMatch(
      /list_account_deletion/i
    );

    const markers = [
      "listAccountDeletionRequestIdsForReconcile",
      "list_account_deletion_requests_for_reconcile",
    ];
    function walk(dir: string): string[] {
      const out: string[] = [];
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) out.push(...walk(p));
        else if (/\.(ts|tsx|js|jsx)$/.test(ent.name)) out.push(p);
      }
      return out;
    }
    const allowed = join(APP_DIR, "api/cron/account-deletions/route.ts");
    const hits: string[] = [];
    for (const file of [...walk(APP_DIR), ...walk(COMPONENTS_DIR)]) {
      const text = readFileSync(file, "utf8");
      if (markers.some((m) => text.includes(m))) hits.push(file);
    }
    expect(hits).toEqual([allowed]);
  });
});
