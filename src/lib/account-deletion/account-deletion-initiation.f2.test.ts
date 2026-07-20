/**
 * APP-041F2 — unreachable account-deletion initiation foundation tests.
 * Injected fakes / in-memory store only — no live Supabase, Stripe, Clerk,
 * Twilio, or real deletion requests.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.fn();
const rpcMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import {
  accountDeletionInitiationIdempotencyKey,
  initiateAccountDeletionRequestForUser,
  isCoherentAccountDeletionInitiationRow,
} from "./initiate-account-deletion-request";
import {
  acquireAccountDeletionLease,
  createAccountDeletionRequest,
  getUnresolvedAccountDeletionRequestForUser,
  markAccountDeletionCompleted,
  patchAccountDeletionRequestWhileLeased,
  recordAccountDeletionFailure,
  transitionAccountDeletionRequest,
  useInMemoryAccountDeletionStoreForTests,
} from "./repository";
import { APP_DATA_PURGE_RPC_STEP } from "./orchestrate-app-data-purge";
import {
  CLERK_DELETE_RPC_MARKER_DETAIL,
  CLERK_DELETE_RPC_STEP,
} from "./orchestrate-clerk-deletion";
import {
  ACCOUNT_DELETION_CONFIRMATION_VALUE,
  ACCOUNT_DELETION_INITIATION_DISABLED_CODE,
  ACCOUNT_DELETION_INITIATION_ENABLED_ENV,
  isAccountDeletionInitiationFullyEnabled,
  isExactTrueFlag,
  runAccountDeletionInitiation,
  validateAccountDeletionConfirmation,
  type AccountDeletionInitiationCreateOutcome,
  type RunAccountDeletionInitiationInput,
} from "./run-account-deletion-initiation";
import { ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV } from "./run-account-deletion-scheduler";
import { verifyAccountDeletionReauthenticationWithClerk } from "./verify-account-deletion-reauthentication";
import type { AccountDeletionRequestRow } from "./types";

const ROOT = process.cwd();
const ROUTE = join(ROOT, "src/app/api/account/delete/route.ts");
const CORE = join(
  ROOT,
  "src/lib/account-deletion/run-account-deletion-initiation.ts"
);
const WRAPPER = join(
  ROOT,
  "src/lib/account-deletion/initiate-account-deletion-request.ts"
);
const REAUTH = join(
  ROOT,
  "src/lib/account-deletion/verify-account-deletion-reauthentication.ts"
);
const MIDDLEWARE = join(ROOT, "src/middleware.ts");
const USER_PAGE = join(ROOT, "src/app/user/[[...user]]/page.tsx");
const CANCEL_PAGE = join(ROOT, "src/app/cancel/page.tsx");
const ADMIN_DELETIONS_PAGE = join(
  ROOT,
  "src/app/admin/account-deletions/page.tsx"
);
const VERCEL = join(ROOT, "vercel.json");
const USER_ID = "user_f2_test_owner";
const OTHER_USER = "user_f2_other";

/** Parse string literals from middleware createRouteMatcher([...]). */
function middlewarePublicRoutePatterns(): string[] {
  const src = readFileSync(MIDDLEWARE, "utf8");
  const block = src.match(/createRouteMatcher\(\[([\s\S]*?)\]\)/);
  expect(block).not.toBeNull();
  return [...(block![1].matchAll(/"([^"]+)"/g))].map((m) => m[1]);
}

function allowReauth() {
  return vi.fn(async () => ({ ok: true as const }));
}

function denyReauth() {
  return vi.fn(async () => ({
    ok: false as const,
    code: "reauth_required" as const,
  }));
}

function baseInput(
  overrides: Partial<RunAccountDeletionInitiationInput> = {}
): RunAccountDeletionInitiationInput {
  return {
    authenticatedUserId: USER_ID,
    confirmationBody: { confirmation: "DELETE" },
    initiationEnabledRaw: "true",
    schedulerEnabledRaw: "true",
    verifyReauthentication: allowReauth(),
    createOrGetRequest: vi.fn(async () => "created_new" as const),
    ...overrides,
  };
}

function assertSanitized(body: unknown) {
  expect(body).toEqual(
    expect.objectContaining({
      ok: expect.any(Boolean),
      code: expect.any(String),
    })
  );
  expect(Object.keys(body as object).sort()).toEqual(["code", "ok"]);
  const json = JSON.stringify(body);
  expect(json).not.toContain(USER_ID);
  expect(json).not.toContain("account-delete:v1");
  expect(json).not.toContain("requestId");
  expect(json).not.toMatch(/sk_live|sk_test|supabase|Error:|at Object\./i);
  expect(json).not.toContain(ACCOUNT_DELETION_INITIATION_ENABLED_ENV);
  expect(json).not.toContain(ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV);
}

describe("APP-041F2 flags + confirmation pure helpers", () => {
  it("6–11. exact-string dual gate; variants disabled", () => {
    expect(isExactTrueFlag("true")).toBe(true);
    expect(isExactTrueFlag(undefined)).toBe(false);
    expect(isExactTrueFlag("")).toBe(false);
    expect(isExactTrueFlag("false")).toBe(false);
    expect(isExactTrueFlag("FALSE")).toBe(false);
    expect(isExactTrueFlag("TRUE")).toBe(false);
    expect(isExactTrueFlag("1")).toBe(false);
    expect(isExactTrueFlag(" true")).toBe(false);
    expect(isExactTrueFlag("true ")).toBe(false);

    expect(isAccountDeletionInitiationFullyEnabled(undefined, undefined)).toBe(
      false
    );
    expect(isAccountDeletionInitiationFullyEnabled("true", undefined)).toBe(
      false
    );
    expect(isAccountDeletionInitiationFullyEnabled(undefined, "true")).toBe(
      false
    );
    expect(isAccountDeletionInitiationFullyEnabled("true", "false")).toBe(
      false
    );
    expect(isAccountDeletionInitiationFullyEnabled("false", "true")).toBe(
      false
    );
    expect(isAccountDeletionInitiationFullyEnabled("true", "true")).toBe(true);
  });

  it("16–24. confirmation exact DELETE only", () => {
    expect(validateAccountDeletionConfirmation({ confirmation: "DELETE" })).toEqual(
      { ok: true }
    );
    expect(ACCOUNT_DELETION_CONFIRMATION_VALUE).toBe("DELETE");

    for (const body of [
      { confirmation: "delete" },
      { confirmation: "Delete" },
      { confirmation: " DELETE" },
      { confirmation: "DELETE " },
      { confirmation: "" },
      {},
      { confirmation: 1 },
      { confirmation: true },
      { confirmation: "DELETE", extra: 1 },
      { userId: USER_ID, confirmation: "DELETE" },
      { confirmation: "DELETE", idempotencyKey: "x" },
      null,
      "DELETE",
      [],
    ]) {
      expect(validateAccountDeletionConfirmation(body)).toEqual({ ok: false });
    }
  });
});

describe("APP-041F2 initiation core fail-closed order", () => {
  it("1–2. unauthenticated → 401; no create/reauth", async () => {
    const verify = allowReauth();
    const create = vi.fn(async () => "created_new" as const);
    const result = await runAccountDeletionInitiation(
      baseInput({
        authenticatedUserId: null,
        verifyReauthentication: verify,
        createOrGetRequest: create,
      })
    );
    expect(result).toEqual({
      httpStatus: 401,
      body: { ok: false, code: "unauthorized" },
    });
    assertSanitized(result.body);
    expect(verify).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("6–15. disabled matrix: no reauth/create; no flag names in body", async () => {
    const cases: Array<[string | undefined, string | undefined]> = [
      [undefined, undefined],
      ["true", undefined],
      [undefined, "true"],
      ["true", "false"],
      ["false", "true"],
      ["TRUE", "true"],
      ["true", "TRUE"],
      ["1", "true"],
      ["true", "1"],
      [" true", "true"],
      ["true", "true "],
    ];
    for (const [init, sched] of cases) {
      const verify = allowReauth();
      const create = vi.fn(async () => "created_new" as const);
      const result = await runAccountDeletionInitiation(
        baseInput({
          initiationEnabledRaw: init,
          schedulerEnabledRaw: sched,
          verifyReauthentication: verify,
          createOrGetRequest: create,
        })
      );
      expect(result.httpStatus).toBe(503);
      expect(result.body).toEqual({
        ok: false,
        code: ACCOUNT_DELETION_INITIATION_DISABLED_CODE,
      });
      assertSanitized(result.body);
      expect(verify).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    }
  });

  it("17–25. invalid confirmation → 400; no reauth/create; body userId ignored", async () => {
    const verify = allowReauth();
    const create = vi.fn(async () => "created_new" as const);
    const result = await runAccountDeletionInitiation(
      baseInput({
        confirmationBody: {
          confirmation: "DELETE",
          userId: OTHER_USER,
          clerkUserId: OTHER_USER,
          idempotencyKey: "evil",
        },
        verifyReauthentication: verify,
        createOrGetRequest: create,
      })
    );
    expect(result).toEqual({
      httpStatus: 400,
      body: { ok: false, code: "invalid_confirmation" },
    });
    expect(verify).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("26–28. reauth failure/exception → 403; no create", async () => {
    const create = vi.fn(async () => "created_new" as const);
    const denied = await runAccountDeletionInitiation(
      baseInput({
        verifyReauthentication: denyReauth(),
        createOrGetRequest: create,
      })
    );
    expect(denied).toEqual({
      httpStatus: 403,
      body: { ok: false, code: "reauth_required" },
    });
    expect(create).not.toHaveBeenCalled();

    const threw = await runAccountDeletionInitiation(
      baseInput({
        verifyReauthentication: async () => {
          throw new Error("clerk boom");
        },
        createOrGetRequest: create,
      })
    );
    expect(threw).toEqual({
      httpStatus: 403,
      body: { ok: false, code: "reauth_unavailable" },
    });
    expect(create).not.toHaveBeenCalled();
    expect(JSON.stringify(threw.body)).not.toContain("clerk boom");
  });

  it("12 + 30–31. exact true+true + reauth → accepted_new", async () => {
    const verify = allowReauth();
    const create = vi.fn(async (id: string) => {
      expect(id).toBe(USER_ID);
      return "created_new" as const;
    });
    const result = await runAccountDeletionInitiation(
      baseInput({
        verifyReauthentication: verify,
        createOrGetRequest: create,
      })
    );
    expect(result).toEqual({
      httpStatus: 200,
      body: { ok: true, code: "accepted_new" },
    });
    assertSanitized(result.body);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(USER_ID);
  });

  it("32–39. maps create outcomes to sanitized HTTP bodies", async () => {
    const map: Array<
      [AccountDeletionInitiationCreateOutcome, number, boolean, string]
    > = [
      ["existing_active", 200, true, "accepted_existing"],
      ["already_completed", 409, true, "already_completed"],
      ["failed_terminal", 409, false, "failed_terminal"],
      ["conflict", 409, false, "conflict"],
      ["internal_error", 500, false, "internal_error"],
    ];
    for (const [outcome, status, ok, code] of map) {
      const result = await runAccountDeletionInitiation(
        baseInput({
          createOrGetRequest: async () => outcome,
        })
      );
      expect(result.httpStatus).toBe(status);
      expect(result.body).toEqual({ ok, code });
      assertSanitized(result.body);
    }
  });

  it("create throw → internal_error; auth before create", async () => {
    const create = vi.fn(async () => {
      throw new Error("db");
    });
    const result = await runAccountDeletionInitiation(
      baseInput({ createOrGetRequest: create })
    );
    expect(result).toEqual({
      httpStatus: 500,
      body: { ok: false, code: "internal_error" },
    });
    expect(create).toHaveBeenCalled();
  });
});

describe("APP-041F2 production reauth verifier", () => {
  it("29. production verifier does not default allow", () => {
    expect(verifyAccountDeletionReauthenticationWithClerk(undefined)).toEqual({
      ok: false,
      code: "reauth_unavailable",
    });
    expect(verifyAccountDeletionReauthenticationWithClerk(null)).toEqual({
      ok: false,
      code: "reauth_unavailable",
    });
    expect(
      verifyAccountDeletionReauthenticationWithClerk(() => {
        throw new Error("has failed");
      })
    ).toEqual({ ok: false, code: "reauth_unavailable" });
    expect(
      verifyAccountDeletionReauthenticationWithClerk(() => false)
    ).toEqual({ ok: false, code: "reauth_required" });
    expect(verifyAccountDeletionReauthenticationWithClerk(() => true)).toEqual({
      ok: true,
    });
  });
});

describe("APP-041F2 idempotent initiation wrapper (in-memory)", () => {
  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
    fromMock.mockImplementation(() => {
      throw new Error("supabase.from should not be called");
    });
    rpcMock.mockImplementation(() => {
      throw new Error("supabase.rpc should not be called");
    });
  });

  it("40–42. deterministic key; first → created_new; duplicate → existing_active", async () => {
    expect(accountDeletionInitiationIdempotencyKey(USER_ID)).toBe(
      `account-delete:v1:${USER_ID}`
    );

    const first = await initiateAccountDeletionRequestForUser(USER_ID);
    expect(first).toBe("created_new");
    const row = await getUnresolvedAccountDeletionRequestForUser(USER_ID);
    expect(row?.status).toBe("requested");
    expect(row?.idempotency_key).toBe(`account-delete:v1:${USER_ID}`);

    const second = await initiateAccountDeletionRequestForUser(USER_ID);
    expect(second).toBe("existing_active");

    const again = await createAccountDeletionRequest({
      clerkUserId: USER_ID,
      idempotencyKey: accountDeletionInitiationIdempotencyKey(USER_ID),
    });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.created).toBe(false);
  });

  it("33–35. conflict_unresolved under unexpected key → existing_active", async () => {
    await createAccountDeletionRequest({
      clerkUserId: USER_ID,
      idempotencyKey: "unexpected-other-key",
    });
    const outcome = await initiateAccountDeletionRequestForUser(USER_ID);
    expect(outcome).toBe("existing_active");
  });

  it("36. completed same key → already_completed", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: USER_ID,
      idempotencyKey: accountDeletionInitiationIdempotencyKey(USER_ID),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const lease = await acquireAccountDeletionLease({
      requestId: created.value.row.id,
      lockOwner: "account-deletion-cron:f2",
    });
    expect(lease.ok).toBe(true);
    if (!lease.ok) return;

    // Advance to deleting_clerk then complete (happy path end).
    const steps: Array<[string, string]> = [
      ["requested", "suppressing_sms"],
      ["suppressing_sms", "sms_suppressed"],
      ["sms_suppressed", "canceling_subscription"],
      ["canceling_subscription", "subscription_canceled"],
      ["subscription_canceled", "purging_app_data"],
      ["purging_app_data", "app_data_purged"],
      ["app_data_purged", "deleting_clerk"],
    ];
    for (const [from, to] of steps) {
      const t = await transitionAccountDeletionRequest({
        requestId: created.value.row.id,
        fromStatus: from as never,
        toStatus: to as never,
        lockOwner: "account-deletion-cron:f2",
      });
      expect(t.ok).toBe(true);
    }
    const at = new Date().toISOString();
    const withMarkers = await patchAccountDeletionRequestWhileLeased({
      requestId: created.value.row.id,
      expectedStatus: "deleting_clerk",
      lockOwner: "account-deletion-cron:f2",
      steps: {
        [APP_DATA_PURGE_RPC_STEP]: {
          at,
          ok: true,
          code: "purged",
          detail: "limitations:0;categories:1;deleted_total:1",
        },
        [CLERK_DELETE_RPC_STEP]: {
          at,
          ok: true,
          code: "deleted",
          detail: CLERK_DELETE_RPC_MARKER_DETAIL,
        },
      },
    });
    expect(withMarkers.ok).toBe(true);
    const done = await markAccountDeletionCompleted({
      requestId: created.value.row.id,
      fromStatus: "deleting_clerk",
      lockOwner: "account-deletion-cron:f2",
      clerkResult: "ok",
    });
    expect(done.ok).toBe(true);

    const outcome = await initiateAccountDeletionRequestForUser(USER_ID);
    expect(outcome).toBe("already_completed");
  });

  it("37. failed_terminal → failed_terminal", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: USER_ID,
      idempotencyKey: accountDeletionInitiationIdempotencyKey(USER_ID),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const lease = await acquireAccountDeletionLease({
      requestId: created.value.row.id,
      lockOwner: "account-deletion-cron:f2b",
    });
    expect(lease.ok).toBe(true);
    if (!lease.ok) return;
    const failed = await recordAccountDeletionFailure({
      requestId: created.value.row.id,
      fromStatus: "requested",
      terminal: true,
      errorCode: "test_terminal",
      errorDetail: "x",
      lockOwner: "account-deletion-cron:f2b",
    });
    expect(failed.ok).toBe(true);

    const outcome = await initiateAccountDeletionRequestForUser(USER_ID);
    expect(outcome).toBe("failed_terminal");
  });

  it("38–39. incoherent / unsupported version → conflict", () => {
    const badVersion = {
      id: "x",
      clerk_user_id: USER_ID,
      orchestration_version: 99,
      status: "requested",
      current_step: "requested",
      steps: {},
      attempt_count: 0,
      locked_at: null,
      lock_owner: null,
      created_at: "",
      updated_at: "",
      completed_at: null,
      last_retry_at: null,
      last_error_code: null,
      last_error_detail: null,
      sms_result: null,
      stripe_result: null,
      purge_result: null,
      clerk_result: null,
      idempotency_key: "k",
    } as AccountDeletionRequestRow;
    expect(isCoherentAccountDeletionInitiationRow(badVersion)).toBe(false);

    const incoherentCompleted = {
      ...badVersion,
      orchestration_version: 1,
      status: "completed",
      current_step: "requested",
    } as AccountDeletionRequestRow;
    expect(isCoherentAccountDeletionInitiationRow(incoherentCompleted)).toBe(
      false
    );
  });
});

describe("APP-041F2 route wrapper", () => {
  const authMock = vi.hoisted(() => vi.fn());
  const createMock = vi.hoisted(() => vi.fn());
  const reauthMock = vi.hoisted(() => vi.fn());

  const prevInit = process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV];
  const prevSched = process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];

  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    createMock.mockReset();
    reauthMock.mockReset();
    delete process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV];
    delete process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];

    vi.doMock("server-only", () => ({}));
    vi.doMock("@/lib/supabase-server", () => ({
      supabaseServer: { from: vi.fn(), rpc: vi.fn() },
    }));
    vi.doMock("@clerk/nextjs/server", async () => {
      const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
        "@clerk/nextjs/server"
      );
      return {
        ...actual,
        auth: (...args: unknown[]) => authMock(...args),
      };
    });
    vi.doMock(
      "@/lib/account-deletion/initiate-account-deletion-request",
      () => ({
        initiateAccountDeletionRequestForUser: (...args: unknown[]) =>
          createMock(...args),
      })
    );
    vi.doMock(
      "@/lib/account-deletion/verify-account-deletion-reauthentication",
      () => ({
        verifyAccountDeletionReauthenticationWithClerk: (...args: unknown[]) =>
          reauthMock(...args),
      })
    );
    vi.doMock(
      "@/lib/account-deletion/run-account-deletion-initiation",
      async () =>
        vi.importActual<typeof import("./run-account-deletion-initiation")>(
          "./run-account-deletion-initiation"
        )
    );
  });

  afterEach(() => {
    if (prevInit === undefined) {
      delete process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV];
    } else {
      process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV] = prevInit;
    }
    if (prevSched === undefined) {
      delete process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];
    } else {
      process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV] = prevSched;
    }
  });

  it("1–5 + 50. unauthenticated → 401 JSON no-store; no redirect/reauth/create", async () => {
    authMock.mockResolvedValue({ userId: null, has: undefined });
    const { POST } = await import("@/app/api/account/delete/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
        body: JSON.stringify({ confirmation: "DELETE" }),
      })
    );
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(302);
    expect(res.headers.get("Location")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: false, code: "unauthorized" });
    expect(createMock).not.toHaveBeenCalled();
    expect(reauthMock).not.toHaveBeenCalled();
  });

  it("6–15. both flags unset → 503; no body reauth/create", async () => {
    authMock.mockResolvedValue({
      userId: USER_ID,
      has: () => true,
    });
    const { POST } = await import("@/app/api/account/delete/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
        body: "not-json",
      })
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      ok: false,
      code: ACCOUNT_DELETION_INITIATION_DISABLED_CODE,
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(reauthMock).not.toHaveBeenCalled();
  });

  it("partial flags → disabled", async () => {
    authMock.mockResolvedValue({ userId: USER_ID, has: () => true });
    process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV] = "true";
    // scheduler unset
    const { POST } = await import("@/app/api/account/delete/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE" }),
      })
    );
    expect(res.status).toBe(503);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("24. malformed JSON → 400 when flags on", async () => {
    authMock.mockResolvedValue({ userId: USER_ID, has: () => true });
    process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV] = "true";
    process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV] = "true";
    reauthMock.mockReturnValue({ ok: true });
    const { POST } = await import("@/app/api/account/delete/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
        body: "not-json",
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      code: "invalid_confirmation",
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("3–4 + 25 + 31. body userId cannot retarget; session id used", async () => {
    authMock.mockResolvedValue({ userId: USER_ID, has: () => true });
    process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV] = "true";
    process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV] = "true";
    reauthMock.mockReturnValue({ ok: true });
    createMock.mockResolvedValue("created_new");
    const { POST } = await import("@/app/api/account/delete/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmation: "DELETE",
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ ok: true, code: "accepted_new" });
    assertSanitized(body);
    expect(createMock).toHaveBeenCalledWith(USER_ID);
    expect(createMock).not.toHaveBeenCalledWith(OTHER_USER);
  });

  it("26–27. reauth failure → Clerk reverification hint 403; no create", async () => {
    authMock.mockResolvedValue({ userId: USER_ID, has: () => false });
    process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV] = "true";
    process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV] = "true";
    reauthMock.mockReturnValue({ ok: false, code: "reauth_required" });
    const { POST } = await import("@/app/api/account/delete/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE" }),
      })
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({
      clerk_error: {
        type: "forbidden",
        reason: "reverification-error",
        metadata: { reverification: "strict" },
      },
    });
    expect(body).not.toHaveProperty("ok");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("reauth_unavailable → sanitized 403; no create", async () => {
    authMock.mockResolvedValue({ userId: USER_ID, has: undefined });
    process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV] = "true";
    process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV] = "true";
    reauthMock.mockReturnValue({ ok: false, code: "reauth_unavailable" });
    const { POST } = await import("@/app/api/account/delete/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE" }),
      })
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, code: "reauth_required" });
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("APP-041F2 middleware pass-through (exact path)", () => {
  it("exact /api/account/delete allowlisted; no account wildcard; pages stay protected", async () => {
    const { createRouteMatcher } = await vi.importActual<
      typeof import("@clerk/nextjs/server")
    >("@clerk/nextjs/server");
    const patterns = middlewarePublicRoutePatterns();

    expect(patterns).toContain("/api/account/delete");
    expect(patterns.filter((p) => p.includes("/api/account"))).toEqual([
      "/api/account/delete",
    ]);
    expect(
      patterns.some((p) => p === "/api/account(.*)" || p === "/api/(.*)")
    ).toBe(false);
    expect(patterns.some((p) => p.includes("/user"))).toBe(false);
    expect(patterns.some((p) => p.includes("/cancel"))).toBe(false);
    expect(patterns.some((p) => p.includes("/admin"))).toBe(false);
    expect(patterns.some((p) => p.includes("/dashboard"))).toBe(false);

    const isPublicRoute = createRouteMatcher(patterns);
    const req = (path: string) =>
      ({
        nextUrl: { pathname: path },
      }) as Parameters<typeof isPublicRoute>[0];

    expect(isPublicRoute(req("/api/account/delete"))).toBe(true);
    expect(isPublicRoute(req("/api/account/delete/extra"))).toBe(false);
    expect(isPublicRoute(req("/api/account"))).toBe(false);
    expect(isPublicRoute(req("/api/account/other"))).toBe(false);
    expect(isPublicRoute(req("/user"))).toBe(false);
    expect(isPublicRoute(req("/cancel"))).toBe(false);
    expect(isPublicRoute(req("/admin/account-deletions"))).toBe(false);
    expect(isPublicRoute(req("/dashboard"))).toBe(false);

    // Pages remain auth-gated in app code as well (defense in depth).
    expect(readFileSync(USER_PAGE, "utf8")).toMatch(/auth|Clerk|user/i);
    expect(readFileSync(CANCEL_PAGE, "utf8")).toContain('redirect("/sign-in")');
    expect(existsSync(ADMIN_DELETIONS_PAGE)).toBe(true);
  });
});

describe("APP-041F2 no-scope / reachability proofs", () => {
  it("51–60. no inline stages/providers/UI/vercel/migration; flags off", () => {
    for (const file of [ROUTE, CORE, WRAPPER, REAUTH]) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(
        /executeTrustedAccountDeletionReconcile|buildProductionAccountDeletionSchedulerDependencies|suppressSmsForDeletion|cancelStripe|purgeAppDataForDeletion|orchestrateClerkDeletion|acquireAccountDeletionLease|createClerkRestDeletionAdapter/
      );
      expect(src).not.toMatch(/from \"stripe\"|twilio|waitUntil|\.after\(/);
      expect(src).not.toContain('"use server"');
      expect(src).not.toMatch(/signOut|revokeSession|sessions\.revoke/);
    }

    const middlewareSrc = readFileSync(MIDDLEWARE, "utf8");
    expect(middlewareSrc).toContain('"/api/account/delete"');
    expect(middlewareSrc).not.toMatch(
      /executeTrustedAccountDeletionReconcile|suppressSmsForDeletion|acquireAccountDeletionLease/
    );

    const routeSrc = readFileSync(ROUTE, "utf8");
    expect(routeSrc).toContain('export const runtime = "nodejs"');
    expect(routeSrc).toContain('export const dynamic = "force-dynamic"');
    expect(routeSrc).toContain("export async function POST");
    expect(routeSrc).not.toMatch(/export async function (GET|PATCH|DELETE)/);
    expect(routeSrc).toContain("auth()");
    expect(routeSrc).toContain("verifyAccountDeletionReauthenticationWithClerk");
    expect(routeSrc).toContain("initiateAccountDeletionRequestForUser");
    expect(routeSrc).toContain('Cache-Control": "no-store"');

    const userSrc = readFileSync(USER_PAGE, "utf8");
    // F4b: Danger Zone mounts only via shared server access decision.
    expect(userSrc).toContain("shouldShowAccountDeletionDangerZone");
    expect(userSrc).toContain("await auth()");
    expect(userSrc).toContain("AccountDeletionDangerZone");
    expect(userSrc).not.toMatch(/Danger zone|Delete account/i);
    expect(userSrc).not.toContain("/api/account/delete");

    const vercel = readFileSync(VERCEL, "utf8");
    expect(vercel).not.toMatch(/\/api\/account\/delete/);
    expect(vercel).not.toMatch(
      /ACCOUNT_DELETION_INITIATION|ACCOUNT_DELETION_SCHEDULER_ENABLED/
    );

    const migrations = readdirSync(join(ROOT, "supabase/migrations"));
    expect(migrations.some((f) => /f2|initiation/i.test(f))).toBe(false);

    expect(process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV]).not.toBe(
      "true"
    );
    expect(process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV]).not.toBe(
      "true"
    );
  });
});
