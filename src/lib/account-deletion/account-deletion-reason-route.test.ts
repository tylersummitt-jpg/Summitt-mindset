import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const authMock = vi.hoisted(() => vi.fn());
const validateCronSecretMock = vi.hoisted(() => vi.fn());
const runCoreMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));
vi.mock("@/lib/cron-auth", () => ({
  validateCronSecretRequest: (...args: unknown[]) => validateCronSecretMock(...args),
}));
vi.mock("@/lib/account-deletion/run-account-deletion-scheduler", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/account-deletion/run-account-deletion-scheduler")
  >("@/lib/account-deletion/run-account-deletion-scheduler");
  return {
    ...actual,
    runAccountDeletionSchedulerInvocation: (...args: unknown[]) => runCoreMock(...args),
  };
});
vi.mock("@/lib/account-deletion/repository", () => ({
  listAccountDeletionRequestIdsForReconcile: vi.fn(),
}));
vi.mock(
  "@/lib/account-deletion/build-production-account-deletion-scheduler-dependencies",
  () => ({
    buildProductionAccountDeletionSchedulerDependencies: vi.fn(),
  })
);
vi.mock("@/lib/account-deletion/reconcile-account-deletion", () => ({
  executeTrustedAccountDeletionReconcile: vi.fn(),
}));

import { ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV } from "@/lib/account-deletion/run-account-deletion-scheduler";

const SCHEDULER_BODY = {
  ok: true,
  enabled: true,
  code: "advanced",
  discovered: 1,
  attempted: 1,
};

describe("deletion reason route", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    authMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });
    authMock.mockResolvedValue({ userId: "user_owner" });
  });

  it("records only the signed-in member's reason and ignores a database failure", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "function not found" },
    });
    const { POST } = await import("@/app/api/account/delete-reason/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete-reason", {
        method: "POST",
        body: JSON.stringify({ reasonCode: "too_expensive" }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("record_account_deletion_reason", {
      p_clerk_user_id: "user_owner",
      p_reason_code: "too_expensive",
    });
    expect(JSON.stringify(rpcMock.mock.calls)).not.toContain("request_id");
  });

  it("rejects an invalid or enlarged body without calling the database", async () => {
    const { POST } = await import("@/app/api/account/delete-reason/route");
    const invalid = await POST(
      new Request("http://localhost/api/account/delete-reason", {
        method: "POST",
        body: JSON.stringify({ reasonCode: "not_using", message: "private" }),
      })
    );
    expect(invalid.status).toBe(400);
    const unnamed = await POST(
      new Request("http://localhost/api/account/delete-reason", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasonCode: "nope" }),
      })
    );
    expect(unnamed.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not record a reason for a signed-out caller", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { POST } = await import("@/app/api/account/delete-reason/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete-reason", {
        method: "POST",
        body: JSON.stringify({ reasonCode: "skipped" }),
      })
    );
    expect(res.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("repeats the same record call and does not write a count from the route", async () => {
    const { POST } = await import("@/app/api/account/delete-reason/route");
    const body = JSON.stringify({ reasonCode: "skipped" });
    await POST(new Request("http://localhost/api/account/delete-reason", { method: "POST", body }));
    await POST(new Request("http://localhost/api/account/delete-reason", { method: "POST", body }));
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock.mock.calls.every((call) => call[0] === "record_account_deletion_reason")).toBe(
      true
    );
    expect(JSON.stringify(rpcMock.mock.calls)).not.toContain("settle_account_deletion_reasons");
  });
});

describe("deletion cron settlement", () => {
  const previous = process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];

  beforeEach(() => {
    rpcMock.mockReset();
    validateCronSecretMock.mockReset();
    runCoreMock.mockReset();
    rpcMock.mockResolvedValue({ data: 0, error: null });
    delete process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];
  });

  afterEach(() => {
    if (previous === undefined) delete process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];
    else process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV] = previous;
  });

  it("keeps the scheduler response when settlement is missing or throws", async () => {
    validateCronSecretMock.mockReturnValue(true);
    process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV] = "true";
    runCoreMock.mockResolvedValue({ httpStatus: 200, body: SCHEDULER_BODY });
    rpcMock.mockRejectedValueOnce(new Error("statement timeout"));
    const { GET } = await import("@/app/api/cron/account-deletions/route");
    const failed = await GET(new Request("http://localhost/api/cron/account-deletions"));
    expect(failed.status).toBe(200);
    expect(await failed.json()).toEqual(SCHEDULER_BODY);
    expect(rpcMock).toHaveBeenCalledWith("settle_account_deletion_reasons", { p_limit: 25 });

    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    const missing = await GET(new Request("http://localhost/api/cron/account-deletions"));
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual(SCHEDULER_BODY);
  });

  it("does not settle while the deletion scheduler is disabled", async () => {
    validateCronSecretMock.mockReturnValue(true);
    runCoreMock.mockResolvedValue({
      httpStatus: 200,
      body: { ok: true, enabled: false, code: "account_deletion_scheduler_disabled" },
    });
    const { GET } = await import("@/app/api/cron/account-deletions/route");
    const res = await GET(new Request("http://localhost/api/cron/account-deletions"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      enabled: false,
      code: "account_deletion_scheduler_disabled",
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
