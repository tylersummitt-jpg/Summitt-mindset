/**
 * APP-041E4b — disabled account-deletion scheduler route foundation tests.
 * Injected fakes only — no live Supabase, Stripe, Clerk, Twilio, or real deletion.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
const VERCEL = join(ROOT, "vercel.json");
const REQUEST_ID = "00000000-0000-4000-8000-00000000e4b1";

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
    createWorkerId: () => "account-deletion-cron:test-opaque",
    ...overrides,
  };
}

describe("APP-041E4b kill switch", () => {
  it("11–16. only exact string true enables", () => {
    expect(isAccountDeletionSchedulerEnabled(undefined)).toBe(false);
    expect(isAccountDeletionSchedulerEnabled(null)).toBe(false);
    expect(isAccountDeletionSchedulerEnabled("")).toBe(false);
    expect(isAccountDeletionSchedulerEnabled("false")).toBe(false);
    expect(isAccountDeletionSchedulerEnabled("TRUE")).toBe(false);
    expect(isAccountDeletionSchedulerEnabled("1")).toBe(false);
    expect(isAccountDeletionSchedulerEnabled("true")).toBe(true);
  });

  it("17–20. disabled skips discovery/deps/reconcile; sanitized body", async () => {
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
    expect(JSON.stringify(result.body)).not.toContain(REQUEST_ID);
  });
});

describe("APP-041E4b discovery", () => {
  it("21–24. enabled discovers once with batch=1 / lease=120000 constants", async () => {
    expect(ACCOUNT_DELETION_SCHEDULER_BATCH_SIZE).toBe(1);
    expect(ACCOUNT_DELETION_SCHEDULER_LEASE_MS).toBe(120_000);

    const discover = vi.fn(async () => ({
      ok: true as const,
      requestIds: [] as string[],
    }));
    await runAccountDeletionSchedulerInvocation(
      baseInput({ discover, createDependencies: vi.fn(() => frozenBundle()) })
    );
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("25–27. zero IDs → no_work; no deps/reconcile", async () => {
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
        processed: 0,
      },
    });
  });

  it("28–29. discovery error → internal_error; no deps", async () => {
    const createDependencies = vi.fn(() => frozenBundle());
    const result = await runAccountDeletionSchedulerInvocation(
      baseInput({
        discover: async () => ({ ok: false }),
        createDependencies,
      })
    );
    expect(createDependencies).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({
      ok: false,
      enabled: true,
      code: "internal_error",
      discovered: 0,
      processed: 0,
    });
    expect(result.httpStatus).toBe(500);
  });

  it("30. malformed discovery result fails closed", async () => {
    const result = await runAccountDeletionSchedulerInvocation(
      baseInput({
        discover: async () =>
          ({ ok: true, requestIds: null }) as never,
      })
    );
    expect(result.body.code).toBe("internal_error");
    expect(result.body.processed).toBe(0);
  });

  it("31–32. more than one ID fails closed; ID absent from response", async () => {
    const createDependencies = vi.fn(() => frozenBundle());
    const reconcile = vi.fn(
      async (): Promise<AccountDeletionReconcileResult> => ({
        outcome: "not_found",
      })
    );
    const result = await runAccountDeletionSchedulerInvocation(
      baseInput({
        discover: async () => ({
          ok: true,
          requestIds: [REQUEST_ID, "00000000-0000-4000-8000-00000000e4b2"],
        }),
        createDependencies,
        reconcile,
      })
    );
    expect(createDependencies).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(result.body.code).toBe("internal_error");
    expect(result.body.processed).toBe(0);
    expect(JSON.stringify(result)).not.toContain(REQUEST_ID);
  });
});

describe("APP-041E4b dependencies + reconcile", () => {
  it("33–34. factory once after discovery; order discover→factory→reconcile", async () => {
    const order: string[] = [];
    const createDependencies = vi.fn(() => {
      order.push("factory");
      return frozenBundle();
    });
    const reconcile = vi.fn(
      async (input): Promise<AccountDeletionReconcileResult> => {
        order.push("reconcile");
        expect(input.requestId).toBe(REQUEST_ID);
        expect(input.leaseMs).toBe(120_000);
        expect(Object.isFrozen(input.dependencies)).toBe(true);
        return { outcome: "already_done", request: {
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
        } };
      }
    );

    const result = await runAccountDeletionSchedulerInvocation(
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
    expect(result.body).toEqual({
      ok: true,
      enabled: true,
      code: "already_done",
      discovered: 1,
      processed: 1,
    });
  });

  it("35–36. factory failure sanitized; no raw config", async () => {
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
      processed: 0,
    });
    expect(JSON.stringify(result)).not.toMatch(/STRIPE|sk_live|missing/i);
  });

  it("37–38. frozen bundle preserved; builder not eager at core import", async () => {
    const bundle = frozenBundle();
    expect(Object.isFrozen(bundle)).toBe(true);
    const coreSrc = readFileSync(CORE, "utf8");
    expect(coreSrc).not.toContain("buildProductionAccountDeletionSchedulerDependencies");
    expect(coreSrc).not.toContain("process.env");
  });

  it("39–45. one reconcile; no loop; retryable not retried; exception sanitized", async () => {
    const reconcile = vi.fn(async () => ({
      outcome: "retryable_failure" as const,
      code: "lease_held",
    }));
    const once = await runAccountDeletionSchedulerInvocation(
      baseInput({ reconcile })
    );
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(once.body.code).toBe("retryable_failure");
    expect(once.body.processed).toBe(1);
    expect(JSON.stringify(once)).not.toContain("lease_held");
    expect(JSON.stringify(once)).not.toContain(REQUEST_ID);

    const boom = await runAccountDeletionSchedulerInvocation(
      baseInput({
        reconcile: async () => {
          throw new Error("stack\nprovider body user@x.com");
        },
      })
    );
    expect(boom.body.code).toBe("internal_error");
    expect(JSON.stringify(boom)).not.toMatch(/stack|provider|@|user_/i);
  });

  it("46–48. worker opaque; not returned; no request/user id", async () => {
    let seenOwner = "";
    await runAccountDeletionSchedulerInvocation(
      baseInput({
        createWorkerId: () => "account-deletion-cron:opaque-token-xyz",
        reconcile: async (input) => {
          seenOwner = input.lockOwner;
          return { outcome: "no_action", reason: "terminal" };
        },
      })
    );
    expect(seenOwner).toBe("account-deletion-cron:opaque-token-xyz");
    expect(seenOwner).not.toContain(REQUEST_ID);
    expect(seenOwner).not.toMatch(/user_/);
  });
});

describe("APP-041E4b responses", () => {
  it("49–56. allowlisted keys only; status codes", async () => {
    const disabled = await runAccountDeletionSchedulerInvocation(
      baseInput({ enabled: false })
    );
    expect(Object.keys(disabled.body).sort()).toEqual([
      "code",
      "enabled",
      "ok",
    ]);

    const noWork = await runAccountDeletionSchedulerInvocation(
      baseInput({
        discover: async () => ({ ok: true, requestIds: [] }),
      })
    );
    expect(Object.keys(noWork.body).sort()).toEqual([
      "code",
      "discovered",
      "enabled",
      "ok",
      "processed",
    ]);

    const processed = await runAccountDeletionSchedulerInvocation(baseInput());
    expect(Object.keys(processed.body).sort()).toEqual([
      "code",
      "discovered",
      "enabled",
      "ok",
      "processed",
    ]);
    expect(processed.httpStatus).toBe(200);

    const internal = await runAccountDeletionSchedulerInvocation(
      baseInput({ discover: async () => ({ ok: false }) })
    );
    expect(Object.keys(internal.body).sort()).toEqual([
      "code",
      "discovered",
      "enabled",
      "ok",
      "processed",
    ]);
    expect(internal.httpStatus).toBe(500);
    const raw = JSON.stringify(internal);
    expect(raw).not.toMatch(/stack|last_error_detail|"detail"|\"steps\"/i);
    expect(raw).not.toContain(REQUEST_ID);
  });
});

describe("APP-041E4b route wrapper auth", () => {
  const validateCronSecretMock = vi.hoisted(() => vi.fn());
  const runCoreMock = vi.hoisted(() => vi.fn());
  const listDiscoverMock = vi.hoisted(() => vi.fn());
  const buildDepsMock = vi.hoisted(() => vi.fn());
  const reconcileMock = vi.hoisted(() => vi.fn());

  beforeEach(() => {
    vi.resetModules();
    validateCronSecretMock.mockReset();
    runCoreMock.mockReset();
    listDiscoverMock.mockReset();
    buildDepsMock.mockReset();
    reconcileMock.mockReset();

    vi.doMock("server-only", () => ({}));
    vi.doMock("@/lib/supabase-server", () => ({
      supabaseServer: { from: vi.fn(), rpc: vi.fn() },
    }));
    vi.doMock("@/lib/cron-auth", () => ({
      validateCronSecretRequest: (...args: unknown[]) =>
        validateCronSecretMock(...args),
    }));
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
  });

  it("1–7. auth failure blocks; no enabled leak; valid secret reaches core", async () => {
    validateCronSecretMock.mockReturnValue(false);
    const { GET } = await import("@/app/api/cron/account-deletions/route");
    const res = await GET(new Request("http://localhost/api/cron/account-deletions"));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toEqual({ ok: false });
    expect(json).not.toHaveProperty("enabled");
    expect(runCoreMock).not.toHaveBeenCalled();
    expect(listDiscoverMock).not.toHaveBeenCalled();
    expect(buildDepsMock).not.toHaveBeenCalled();
    expect(reconcileMock).not.toHaveBeenCalled();

    validateCronSecretMock.mockReturnValue(true);
    runCoreMock.mockResolvedValue({
      httpStatus: 200,
      body: {
        ok: true,
        enabled: false,
        code: ACCOUNT_DELETION_SCHEDULER_DISABLED_CODE,
      },
    });
    const { GET: GET2 } = await import(
      "@/app/api/cron/account-deletions/route"
    );
    const res2 = await GET2(
      new Request("http://localhost/api/cron/account-deletions")
    );
    expect(validateCronSecretMock).toHaveBeenCalled();
    expect(runCoreMock).toHaveBeenCalledTimes(1);
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual({
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
    expect(src).not.toContain('"use server"');
  });
});

describe("APP-041E4b production builder + no-scope", () => {
  it("57–68. no migration/vercel/cron schedule/mutation/public initiation/loop", () => {
    const migrations = readdirSync(join(ROOT, "supabase/migrations"));
    expect(migrations.some((f) => /e4b|scheduler/i.test(f))).toBe(false);

    const vercel = readFileSync(VERCEL, "utf8");
    expect(vercel).not.toMatch(/account-deletion|account_deletion/i);

    for (const file of [ROUTE, CORE, BUILDER]) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/waitUntil|\.after\(|setInterval\(|setTimeout\(/);
      expect(src).not.toMatch(/for\s*\([^)]*of\s+.*requestIds/);
      expect(src).not.toMatch(/\bwhile\s*\(/);
      expect(src).not.toContain('"use server"');
      expect(src).not.toMatch(
        /searchParams\.get\([\"'](requestId|userId|limit|force)/
      );
    }

    const routeSrc = readFileSync(ROUTE, "utf8");
    expect(routeSrc).toContain("ACCOUNT_DELETION_SCHEDULER_ENABLED");
    expect(routeSrc).toContain("listAccountDeletionRequestIdsForReconcile");
    expect(routeSrc).toContain("executeTrustedAccountDeletionReconcile");
    expect(routeSrc).toContain("buildProductionAccountDeletionSchedulerDependencies");
    expect(routeSrc).not.toContain(
      "createProductionAccountDeletionReconcilerDependencies"
    );

    // Factory markers stay out of app route text (builder owns them in lib).
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
