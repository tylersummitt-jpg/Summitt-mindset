/**
 * APP-041E4b/E4c/E4d — disabled account-deletion scheduler route foundation tests.
 * Injected fakes only — no live Supabase, Stripe, Clerk, Twilio, or real deletion.
 * E4d: Vercel Cron schedule may exist; kill switch remains off (scheduled ≠ activated).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import {
  ACCOUNT_DELETION_SCHEDULER_BATCH_SIZE,
  ACCOUNT_DELETION_SCHEDULER_DISABLED_CODE,
  ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV,
  ACCOUNT_DELETION_SCHEDULER_LEASE_MS,
  isAccountDeletionSchedulerEnabled,
  runAccountDeletionSchedulerInvocation,
  type RunAccountDeletionSchedulerInvocationInput,
} from "./run-account-deletion-scheduler";
import type {
  AccountDeletionReconcileResult,
  AccountDeletionReconcilerDependencies,
} from "./reconcile-account-deletion";
import { createTrustedAccountDeletionReconcilerDependencies } from "./reconcile-account-deletion";

const ROOT = join(process.cwd());
const ROUTE = join(
  ROOT,
  "src/app/api/cron/account-deletions/route.ts"
);
const CORE = join(
  ROOT,
  "src/lib/account-deletion/run-account-deletion-scheduler.ts"
);
const BUILDER = join(
  ROOT,
  "src/lib/account-deletion/build-production-account-deletion-scheduler-dependencies.ts"
);
const REPO = join(ROOT, "src/lib/account-deletion/repository.ts");
const MIGRATION = join(
  ROOT,
  "supabase/migrations/20260719140000_list_account_deletion_requests_for_reconcile.sql"
);
const VERCEL = join(ROOT, "vercel.json");
const REQUEST_ID = "00000000-0000-4000-8000-00000000e4b1";
const WORKER_ID = "account-deletion-cron:test-opaque";

function frozenBundle(): AccountDeletionReconcilerDependencies {
  return createTrustedAccountDeletionReconcilerDependencies({
    suppressSms: async () => ({
      ok: false,
      code: "not_found",
      message: "x",
    }),
    cancelStripe: async () => ({
      ok: false,
      code: "not_found",
      message: "x",
    }),
    purgeAppData: async () => ({
      ok: false,
      code: "not_found",
      message: "x",
    }),
    deleteClerk: async () => ({
      ok: false,
      code: "not_found",
      message: "x",
    }),
    clerkAdapter: {
      async deleteUser() {
        return { outcome: "deleted" as const, code: "test" };
      },
    },
  });
}

function baseInput(
  overrides: Partial<RunAccountDeletionSchedulerInvocationInput> = {}
): RunAccountDeletionSchedulerInvocationInput {
  return {
    enabled: true,
    discover: async () => ({ ok: true, requestIds: [REQUEST_ID] }),
    createDependencies: () => frozenBundle(),
    reconcile: async (): Promise<AccountDeletionReconcileResult> => ({
      outcome: "advanced",
      stage: "sms",
      request: {
        requestId: REQUEST_ID,
        status: "sms_suppressed",
        currentStep: "sms_suppressed",
        orchestrationVersion: 1,
        attemptCount: 0,
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z",
        completedAt: null,
        lastRetryAt: null,
        lastErrorCode: null,
        smsResult: "ok",
        stripeResult: null,
        purgeResult: null,
        clerkResult: null,
      },
    }),
    createWorkerId: () => WORKER_ID,
    ...overrides,
  };
}

describe("APP-041E4c kill switch", () => {
  it("27–40. only exact string true enables; no trim/lowercase", () => {
    const disabled = [
      undefined,
      null,
      "",
      "false",
      "FALSE",
      "TRUE",
      "1",
      " true",
      "true ",
      " true ",
      "True",
      "\ntrue",
      "true\n",
    ] as const;
    for (const raw of disabled) {
      expect(isAccountDeletionSchedulerEnabled(raw)).toBe(false);
    }
    expect(isAccountDeletionSchedulerEnabled("true")).toBe(true);
    const src = readFileSync(CORE, "utf8");
    expect(src).toMatch(/return raw === "true"/);
    expect(src).not.toMatch(/\.trim\(\)|toLowerCase\(|Boolean\(/);
  });

  it("disabled skips discovery/deps/reconcile; no counts; no processed key", async () => {
    const discover = vi.fn(async () => ({ ok: true as const, requestIds: [] }));
    const createDependencies = vi.fn(() => frozenBundle());
    const reconcile = vi.fn(async () => ({ outcome: "not_found" as const }));

    const result = await runAccountDeletionSchedulerInvocation(
      baseInput({
        enabled: false,
        discover,
        createDependencies,
        reconcile,
      })
    );

    expect(discover).not.toHaveBeenCalled();
    expect(createDependencies).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(result.httpStatus).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      enabled: false,
      code: ACCOUNT_DELETION_SCHEDULER_DISABLED_CODE,
    });
    expect(result.body).not.toHaveProperty("discovered");
    expect(result.body).not.toHaveProperty("attempted");
    expect(result.body).not.toHaveProperty("processed");
    expect(JSON.stringify(result.body)).not.toContain(REQUEST_ID);
  });
});

describe("APP-041E4c discovery failures", () => {
  it("21–26. throw / ok:false / malformed / >1 → internal_error; no deps/reconcile", async () => {
    const cases: Array<{
      name: string;
      discover: RunAccountDeletionSchedulerInvocationInput["discover"];
    }> = [
      {
        name: "throw",
        discover: async () => {
          throw new Error("secret discovery boom user_x");
        },
      },
      {
        name: "ok:false",
        discover: async () => ({ ok: false }),
      },
      {
        name: "malformed null",
        discover: async () =>
          ({ ok: true, requestIds: null }) as never,
      },
      {
        name: ">1 IDs",
        discover: async () => ({
          ok: true,
          requestIds: [REQUEST_ID, "00000000-0000-4000-8000-00000000e4b2"],
        }),
      },
    ];

    for (const c of cases) {
      const createDependencies = vi.fn(() => frozenBundle());
      const reconcile = vi.fn(async () => ({ outcome: "not_found" as const }));
      const result = await runAccountDeletionSchedulerInvocation(
        baseInput({
          discover: c.discover,
          createDependencies,
          reconcile,
        })
      );
      expect(createDependencies, c.name).not.toHaveBeenCalled();
      expect(reconcile, c.name).not.toHaveBeenCalled();
      expect(result, c.name).toEqual({
        httpStatus: 500,
        body: {
          ok: false,
          enabled: true,
          code: "internal_error",
          discovered: 0,
          attempted: 0,
        },
      });
      expect(JSON.stringify(result), c.name).not.toContain(REQUEST_ID);
      expect(JSON.stringify(result), c.name).not.toMatch(/secret|boom|user_/i);
      expect(result.body, c.name).not.toHaveProperty("processed");
    }
  });

  it("8. no_work → discovered:0 attempted:0", async () => {
    const createDependencies = vi.fn(() => frozenBundle());
    const reconcile = vi.fn(async () => ({ outcome: "not_found" as const }));
    const result = await runAccountDeletionSchedulerInvocation(
      baseInput({
        discover: async () => ({ ok: true, requestIds: [] }),
        createDependencies,
        reconcile,
      })
    );
    expect(createDependencies).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(result).toEqual({
      httpStatus: 200,
      body: {
        ok: true,
        enabled: true,
        code: "no_work",
        discovered: 0,
        attempted: 0,
      },
    });
  });

  it("batch/lease constants", () => {
    expect(ACCOUNT_DELETION_SCHEDULER_BATCH_SIZE).toBe(1);
    expect(ACCOUNT_DELETION_SCHEDULER_LEASE_MS).toBe(120_000);
  });
});

describe("APP-041E4c attempted semantics + unknown outcomes", () => {
  it("9. factory failure → discovered:1 attempted:0; no processed", async () => {
    const result = await runAccountDeletionSchedulerInvocation(
      baseInput({
        createDependencies: () => {
          throw new Error("STRIPE_SECRET_KEY missing sk_live_secret");
        },
      })
    );
    expect(result.body).toEqual({
      ok: false,
      enabled: true,
      code: "internal_error",
      discovered: 1,
      attempted: 0,
    });
    expect(result.body).not.toHaveProperty("processed");
    expect(JSON.stringify(result)).not.toMatch(/STRIPE|sk_live|missing/i);
  });

  it("10–13. allowlisted outcomes → attempted:1; code is honest", async () => {
    for (const outcome of [
      "advanced",
      "already_done",
      "no_action",
      "retryable_failure",
      "conflict",
      "not_found",
    ] as const) {
      const reconcile = vi.fn(
        async (): Promise<AccountDeletionReconcileResult> => {
          if (outcome === "advanced") {
            return {
              outcome: "advanced",
              stage: "sms",
              request: {
                requestId: REQUEST_ID,
                status: "sms_suppressed",
                currentStep: "sms_suppressed",
                orchestrationVersion: 1,
                attemptCount: 0,
                createdAt: "2026-07-19T00:00:00.000Z",
                updatedAt: "2026-07-19T00:00:00.000Z",
                completedAt: null,
                lastRetryAt: null,
                lastErrorCode: null,
                smsResult: "ok",
                stripeResult: null,
                purgeResult: null,
                clerkResult: null,
              },
            };
          }
          if (outcome === "already_done") {
            return {
              outcome: "already_done",
              request: {
                requestId: REQUEST_ID,
                status: "completed",
                currentStep: "completed",
                orchestrationVersion: 1,
                attemptCount: 1,
                createdAt: "2026-07-19T00:00:00.000Z",
                updatedAt: "2026-07-19T00:00:00.000Z",
                completedAt: "2026-07-19T00:00:00.000Z",
                lastRetryAt: null,
                lastErrorCode: null,
                smsResult: "ok",
                stripeResult: "ok",
                purgeResult: "ok",
                clerkResult: "ok",
              },
            };
          }
          if (outcome === "no_action") {
            return { outcome: "no_action", reason: "failed_terminal" };
          }
          if (outcome === "retryable_failure") {
            return { outcome: "retryable_failure", code: "lease_held" };
          }
          if (outcome === "conflict") {
            return { outcome: "conflict", code: "cas_conflict" };
          }
          return { outcome: "not_found" };
        }
      );
      const result = await runAccountDeletionSchedulerInvocation(
        baseInput({ reconcile })
      );
      expect(reconcile).toHaveBeenCalledTimes(1);
      expect(result.httpStatus).toBe(200);
      expect(result.body).toEqual({
        ok: true,
        enabled: true,
        code: outcome,
        discovered: 1,
        attempted: 1,
      });
      expect(result.body).not.toHaveProperty("processed");
      expect(JSON.stringify(result)).not.toContain(REQUEST_ID);
      expect(JSON.stringify(result)).not.toContain(WORKER_ID);
      expect(JSON.stringify(result)).not.toMatch(/lease_held|cas_conflict|failed_terminal/);
    }
  });

  it("14. reconciler throw → discovered:1 attempted:1", async () => {
    const result = await runAccountDeletionSchedulerInvocation(
      baseInput({
        reconcile: async () => {
          throw new Error("stack\nprovider body user@x.com");
        },
      })
    );
    expect(result).toEqual({
      httpStatus: 500,
      body: {
        ok: false,
        enabled: true,
        code: "internal_error",
        discovered: 1,
        attempted: 1,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/stack|provider|@|user_/i);
  });

  it("17–20. unknown / malformed outcome → internal_error; raw absent", async () => {
    const unknown = await runAccountDeletionSchedulerInvocation(
      baseInput({
        reconcile: async () =>
          ({ outcome: "totally_unknown_code", detail: "secret" }) as never,
      })
    );
    expect(unknown).toEqual({
      httpStatus: 500,
      body: {
        ok: false,
        enabled: true,
        code: "internal_error",
        discovered: 1,
        attempted: 1,
      },
    });
    expect(JSON.stringify(unknown)).not.toMatch(/totally_unknown|secret/);

    const malformed = await runAccountDeletionSchedulerInvocation(
      baseInput({
        reconcile: async () => null as never,
      })
    );
    expect(malformed.body.code).toBe("internal_error");
    expect(malformed.body.attempted).toBe(1);
    expect(malformed.httpStatus).toBe(500);
  });

  it("15–16. allowlisted keys only; no processed anywhere in core source", async () => {
    const disabled = await runAccountDeletionSchedulerInvocation(
      baseInput({ enabled: false })
    );
    expect(Object.keys(disabled.body).sort()).toEqual([
      "code",
      "enabled",
      "ok",
    ]);

    const attempted = await runAccountDeletionSchedulerInvocation(baseInput());
    expect(Object.keys(attempted.body).sort()).toEqual([
      "attempted",
      "code",
      "discovered",
      "enabled",
      "ok",
    ]);

    const coreSrc = readFileSync(CORE, "utf8");
    expect(coreSrc).not.toMatch(/\bprocessed\b/);
    expect(coreSrc).toContain("attempted");
  });

  it("order discover→factory→reconcile once", async () => {
    const order: string[] = [];
    const createDependencies = vi.fn(() => {
      order.push("factory");
      return frozenBundle();
    });
    const reconcile = vi.fn(async () => {
      order.push("reconcile");
      return { outcome: "not_found" as const };
    });
    await runAccountDeletionSchedulerInvocation(
      baseInput({
        discover: async () => {
          order.push("discover");
          return { ok: true, requestIds: [REQUEST_ID] };
        },
        createDependencies,
        reconcile,
      })
    );
    expect(order).toEqual(["discover", "factory", "reconcile"]);
    expect(createDependencies).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});

describe("APP-041E4c production clock source proof", () => {
  it("1–6. production RPC omits p_now; SQL default now(); route omits now", () => {
    const repoSrc = readFileSync(REPO, "utf8");
    expect(repoSrc).toContain("if (now !== undefined)");
    expect(repoSrc).toContain("rpcArgs.p_now = now.toISOString()");
    expect(repoSrc).toContain(
      "...(input.now !== undefined ? { now: input.now } : {})"
    );
    // Discovery public helper must not default to Node new Date().
    const discoveryStart = repoSrc.indexOf(
      "export async function listAccountDeletionRequestIdsForReconcile"
    );
    const discoveryFn = repoSrc.slice(discoveryStart, discoveryStart + 900);
    expect(discoveryFn).toContain(
      "...(input.now !== undefined ? { now: input.now } : {})"
    );
    expect(discoveryFn).not.toContain("input.now ?? new Date()");

    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toMatch(/p_now TIMESTAMPTZ DEFAULT now\(\)/);

    const routeSrc = readFileSync(ROUTE, "utf8");
    expect(routeSrc).toContain("listAccountDeletionRequestIdsForReconcile({");
    expect(routeSrc).toContain("limit: ACCOUNT_DELETION_SCHEDULER_BATCH_SIZE");
    expect(routeSrc).toContain("leaseMs: ACCOUNT_DELETION_SCHEDULER_LEASE_MS");
    expect(routeSrc).not.toMatch(/now\s*:/);
    expect(routeSrc).not.toContain("new Date(");
    expect(routeSrc).not.toMatch(
      /searchParams\.get\([\"'](requestId|userId|limit|force|now)/
    );
  });
});

describe("APP-041E4c route wrapper auth + wiring", () => {
  const validateCronSecretMock = vi.hoisted(() => vi.fn());
  const listDiscoverMock = vi.hoisted(() => vi.fn());
  const buildDepsMock = vi.hoisted(() => vi.fn());
  const reconcileMock = vi.hoisted(() => vi.fn());
  const runCoreMock = vi.hoisted(() => vi.fn());

  const prevEnabled = process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];

  beforeEach(() => {
    vi.resetModules();
    validateCronSecretMock.mockReset();
    listDiscoverMock.mockReset();
    buildDepsMock.mockReset();
    reconcileMock.mockReset();
    runCoreMock.mockReset();
    delete process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];

    vi.doMock("server-only", () => ({}));
    vi.doMock("@/lib/supabase-server", () => ({
      supabaseServer: { from: vi.fn(), rpc: vi.fn() },
    }));
    vi.doMock("@/lib/cron-auth", () => ({
      validateCronSecretRequest: (...args: unknown[]) =>
        validateCronSecretMock(...args),
    }));
    vi.doMock("@/lib/account-deletion/repository", () => ({
      listAccountDeletionRequestIdsForReconcile: (...args: unknown[]) =>
        listDiscoverMock(...args),
    }));
    vi.doMock(
      "@/lib/account-deletion/build-production-account-deletion-scheduler-dependencies",
      () => ({
        buildProductionAccountDeletionSchedulerDependencies: () =>
          buildDepsMock(),
      })
    );
    vi.doMock("@/lib/account-deletion/reconcile-account-deletion", () => ({
      executeTrustedAccountDeletionReconcile: (...args: unknown[]) =>
        reconcileMock(...args),
    }));
    // Default: real scheduler core (wiring tests). Auth test may override.
    vi.doMock(
      "@/lib/account-deletion/run-account-deletion-scheduler",
      async () =>
        vi.importActual<typeof import("./run-account-deletion-scheduler")>(
          "./run-account-deletion-scheduler"
        )
    );
  });

  afterEach(() => {
    if (prevEnabled === undefined) {
      delete process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];
    } else {
      process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV] = prevEnabled;
    }
  });

  it("41. auth failure blocks; no enabled leak; Cache-Control no-store", async () => {
    vi.doMock(
      "@/lib/account-deletion/run-account-deletion-scheduler",
      async () => {
        const actual = await vi.importActual<
          typeof import("./run-account-deletion-scheduler")
        >("./run-account-deletion-scheduler");
        return {
          ...actual,
          runAccountDeletionSchedulerInvocation: (
            ...args: unknown[]
          ) => runCoreMock(...args),
        };
      }
    );

    validateCronSecretMock.mockReturnValue(false);
    const { GET } = await import("@/app/api/cron/account-deletions/route");
    const res = await GET(
      new Request("http://localhost/api/cron/account-deletions")
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json).toEqual({ ok: false });
    expect(json).not.toHaveProperty("enabled");
    expect(runCoreMock).not.toHaveBeenCalled();
    expect(listDiscoverMock).not.toHaveBeenCalled();
    expect(buildDepsMock).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it("42–50. enabled wiring: limit 1, lease 120000, no now, one each, ID absent", async () => {
    // Real core + mocked discover/deps/reconcile — prove production closures.
    validateCronSecretMock.mockReturnValue(true);
    process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV] = "true";

    listDiscoverMock.mockResolvedValue({
      ok: true,
      value: { requestIds: [REQUEST_ID] },
    });
    buildDepsMock.mockReturnValue(frozenBundle());
    reconcileMock.mockResolvedValue({ outcome: "not_found" });

    const { GET } = await import("@/app/api/cron/account-deletions/route");
    const res = await GET(
      new Request(
        "http://localhost/api/cron/account-deletions?requestId=evil&limit=99&now=2020-01-01T00:00:00.000Z&userId=user_x"
      )
    );

    expect(listDiscoverMock).toHaveBeenCalledTimes(1);
    expect(listDiscoverMock).toHaveBeenCalledWith({
      limit: 1,
      leaseMs: 120_000,
    });
    const discoverArgs = listDiscoverMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(discoverArgs).not.toHaveProperty("now");
    expect(Object.keys(discoverArgs).sort()).toEqual(["leaseMs", "limit"]);

    expect(buildDepsMock).toHaveBeenCalledTimes(1);
    expect(reconcileMock).toHaveBeenCalledTimes(1);
    const reconcileArgs = reconcileMock.mock.calls[0]?.[0] as {
      requestId: string;
      lockOwner: string;
      leaseMs: number;
    };
    expect(reconcileArgs.requestId).toBe(REQUEST_ID);
    expect(reconcileArgs.leaseMs).toBe(120_000);
    expect(reconcileArgs.lockOwner).toMatch(/^account-deletion-cron:/);
    expect(reconcileArgs.lockOwner).not.toContain(REQUEST_ID);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      enabled: true,
      code: "not_found",
      discovered: 1,
      attempted: 1,
    });
    expect(body).not.toHaveProperty("processed");
    expect(JSON.stringify(body)).not.toContain(REQUEST_ID);
    expect(JSON.stringify(body)).not.toContain(reconcileArgs.lockOwner);
    expect(JSON.stringify(body)).not.toMatch(/user_x|evil/);
  });

  it("disabled env with valid secret: no discovery; no-store", async () => {
    validateCronSecretMock.mockReturnValue(true);
    // env unset → disabled
    const { GET } = await import("@/app/api/cron/account-deletions/route");
    const res = await GET(
      new Request("http://localhost/api/cron/account-deletions")
    );
    expect(listDiscoverMock).not.toHaveBeenCalled();
    expect(buildDepsMock).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      ok: true,
      enabled: false,
      code: ACCOUNT_DELETION_SCHEDULER_DISABLED_CODE,
    });
  });

  it("8–10. node runtime + force-dynamic + GET only", () => {
    const src = readFileSync(ROUTE, "utf8");
    expect(src).toContain('export const runtime = "nodejs"');
    expect(src).toContain('export const dynamic = "force-dynamic"');
    expect(src).toContain("export async function GET");
    expect(src).not.toMatch(/export async function (POST|PATCH|DELETE)/);
    expect(src).toContain("validateCronSecretRequest");
    expect(src).toContain('Cache-Control": "no-store"');
    expect(src).not.toContain('"use server"');
  });
});

describe("APP-041E4c production builder + no-scope", () => {
  it("55–60. no migration/mutation/public initiation/loop (E4d owns vercel schedule)", () => {
    const migrations = readdirSync(join(ROOT, "supabase/migrations"));
    expect(migrations.some((f) => /e4c|scheduler/i.test(f))).toBe(false);

    for (const file of [ROUTE, CORE, BUILDER]) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/waitUntil|\.after\(|setInterval\(|setTimeout\(/);
      expect(src).not.toMatch(/for\s*\([^)]*of\s+.*requestIds/);
      expect(src).not.toMatch(/\bwhile\s*\(/);
      expect(src).not.toContain('"use server"');
      expect(src).not.toMatch(/\bprocessed\b/);
    }

    const routeSrc = readFileSync(ROUTE, "utf8");
    expect(routeSrc).toContain("ACCOUNT_DELETION_SCHEDULER_ENABLED");
    expect(routeSrc).toContain("listAccountDeletionRequestIdsForReconcile");
    expect(routeSrc).toContain("executeTrustedAccountDeletionReconcile");
    expect(routeSrc).toContain(
      "buildProductionAccountDeletionSchedulerDependencies"
    );
    expect(routeSrc).not.toContain(
      "createProductionAccountDeletionReconcilerDependencies"
    );
    expect(routeSrc).not.toContain("createClerkRestDeletionAdapter");
  });

  it("factory not initialized at builder module import", async () => {
    const factory = vi.fn(() => frozenBundle());
    vi.resetModules();
    vi.doMock("server-only", () => ({}));
    vi.doMock("@/lib/supabase-server", () => ({
      supabaseServer: { from: vi.fn(), rpc: vi.fn() },
    }));
    vi.doMock("./create-production-account-deletion-dependencies", () => ({
      createProductionAccountDeletionReconcilerDependencies: factory,
      PRODUCTION_ACCOUNT_DELETION_DEPENDENCIES_INVALID:
        "invalid_production_account_deletion_dependencies",
    }));
    await import("./build-production-account-deletion-scheduler-dependencies");
    expect(factory).not.toHaveBeenCalled();
  });
});

describe("APP-041E4d disabled Vercel cron schedule", () => {
  /** Exact vercel.json inventory. Future cron additions must update this list. */
  const EXPECTED_CRONS = [
    { path: "/api/cron/daily-sms", schedule: "*/5 * * * *" },
    { path: "/api/cron/evening-sms", schedule: "*/5 * * * *" },
    { path: "/api/cron/weekly-sms", schedule: "*/5 * * * *" },
    { path: "/api/cron/challenge", schedule: "0 * * * *" },
    { path: "/api/cron/sms-inbound-coach", schedule: "* * * * *" },
    { path: "/api/cron/quotes-book-fulfillment", schedule: "0 15 * * *" },
    { path: "/api/cron/account-deletions", schedule: "*/5 * * * *" },
    { path: "/api/cron/victory-media", schedule: "* * * * *" },
  ] as const;

  function loadCrons(): Array<{ path: string; schedule: string }> {
    const parsed = JSON.parse(readFileSync(VERCEL, "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    expect(Array.isArray(parsed.crons)).toBe(true);
    return parsed.crons;
  }

  function sortedCronInventory(
    crons: ReadonlyArray<{ path: string; schedule: string }>
  ): Array<{ path: string; schedule: string }> {
    return [...crons].sort((a, b) =>
      a.path === b.path
        ? a.schedule.localeCompare(b.schedule)
        : a.path.localeCompare(b.path)
    );
  }

  it("1–5. exactly one account-deletions cron; */5; exact scheduled inventory", () => {
    const crons = loadCrons();
    const deletion = crons.filter(
      (c) => c.path === "/api/cron/account-deletions"
    );
    expect(deletion).toHaveLength(1);
    expect(deletion[0]).toEqual({
      path: "/api/cron/account-deletions",
      schedule: "*/5 * * * *",
    });

    expect(new Set(crons.map((c) => c.path)).size).toBe(crons.length);
    expect(sortedCronInventory(crons)).toEqual(
      sortedCronInventory(EXPECTED_CRONS)
    );

    const vercelRaw = readFileSync(VERCEL, "utf8");
    expect(vercelRaw).not.toMatch(
      /CRON_SECRET|ACCOUNT_DELETION_SCHEDULER|sk_|Bearer /i
    );
    expect(
      (vercelRaw.match(/\/api\/cron\/account-deletions/g) ?? []).length
    ).toBe(1);
  });

  it("6–10. auth required; unset env → disabled no-op (no discovery/deps/reconcile)", async () => {
    const validateCronSecretMock = vi.fn();
    const listDiscoverMock = vi.fn();
    const buildDepsMock = vi.fn();
    const reconcileMock = vi.fn();
    const prevEnabled = process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];

    vi.resetModules();
    delete process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];

    vi.doMock("server-only", () => ({}));
    vi.doMock("@/lib/supabase-server", () => ({
      supabaseServer: { from: vi.fn(), rpc: vi.fn() },
    }));
    vi.doMock("@/lib/cron-auth", () => ({
      validateCronSecretRequest: (...args: unknown[]) =>
        validateCronSecretMock(...args),
    }));
    vi.doMock("@/lib/account-deletion/repository", () => ({
      listAccountDeletionRequestIdsForReconcile: (...args: unknown[]) =>
        listDiscoverMock(...args),
    }));
    vi.doMock(
      "@/lib/account-deletion/build-production-account-deletion-scheduler-dependencies",
      () => ({
        buildProductionAccountDeletionSchedulerDependencies: () =>
          buildDepsMock(),
      })
    );
    vi.doMock("@/lib/account-deletion/reconcile-account-deletion", () => ({
      executeTrustedAccountDeletionReconcile: (...args: unknown[]) =>
        reconcileMock(...args),
    }));
    vi.doMock(
      "@/lib/account-deletion/run-account-deletion-scheduler",
      async () =>
        vi.importActual<typeof import("./run-account-deletion-scheduler")>(
          "./run-account-deletion-scheduler"
        )
    );

    try {
      validateCronSecretMock.mockReturnValue(false);
      const { GET } = await import("@/app/api/cron/account-deletions/route");
      const unauthorized = await GET(
        new Request("http://localhost/api/cron/account-deletions")
      );
      expect(unauthorized.status).toBe(401);
      expect(listDiscoverMock).not.toHaveBeenCalled();
      expect(buildDepsMock).not.toHaveBeenCalled();
      expect(reconcileMock).not.toHaveBeenCalled();

      validateCronSecretMock.mockReturnValue(true);
      const disabled = await GET(
        new Request("http://localhost/api/cron/account-deletions")
      );
      expect(disabled.status).toBe(200);
      expect(disabled.headers.get("Cache-Control")).toBe("no-store");
      expect(await disabled.json()).toEqual({
        ok: true,
        enabled: false,
        code: ACCOUNT_DELETION_SCHEDULER_DISABLED_CODE,
      });
      expect(listDiscoverMock).not.toHaveBeenCalled();
      expect(buildDepsMock).not.toHaveBeenCalled();
      expect(reconcileMock).not.toHaveBeenCalled();
    } finally {
      if (prevEnabled === undefined) {
        delete process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];
      } else {
        process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV] = prevEnabled;
      }
    }
  });

  it("11–20. no second switch/migration/admin mutation/public initiation", () => {
    const coreSrc = readFileSync(CORE, "utf8");
    expect(coreSrc).toMatch(/return raw === "true"/);
    expect(coreSrc).not.toMatch(/\.trim\(\)|toLowerCase\(|Boolean\(/);
    expect(coreSrc).toContain(ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV);
    expect(coreSrc).not.toMatch(
      /ACCOUNT_DELETION_SCHEDULER_FORCE|SCHEDULER_ACTIVE|AUTO_DELETE/
    );

    const routeSrc = readFileSync(ROUTE, "utf8");
    expect(routeSrc).toContain("validateCronSecretRequest");
    expect(routeSrc).toContain("isAccountDeletionSchedulerEnabled");
    expect(routeSrc).not.toMatch(/searchParams\.get\([\"']cron_secret/);

    const migrations = readdirSync(join(ROOT, "supabase/migrations"));
    expect(migrations.some((f) => /e4d/i.test(f))).toBe(false);

    for (const file of [
      join(ROOT, "src/app/admin/account-deletions/page.tsx"),
      join(
        ROOT,
        "src/app/admin/account-deletions/account-deletions-dashboard.tsx"
      ),
    ]) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/method:\s*[\"'](POST|PATCH|DELETE)[\"']/);
      expect(src).not.toContain("executeTrustedAccountDeletionReconcile");
      expect(src).not.toContain('"use server"');
    }

    expect(() =>
      readFileSync(join(ROOT, "src/app/api/account-deletion/route.ts"), "utf8")
    ).toThrow();
  });
});
