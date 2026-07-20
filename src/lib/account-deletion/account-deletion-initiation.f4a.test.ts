/**
 * APP-041F4a — pre-activation initiation hardening tests.
 * Fakes / in-memory / mocked route only — no live DB, Clerk, or deletion.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn(), rpc: vi.fn() },
}));

import {
  accountDeletionInitiationIdempotencyKey,
  isCoherentAccountDeletionInitiationRow,
} from "./initiate-account-deletion-request";
import { APP_DATA_PURGE_RPC_STEP } from "./orchestrate-app-data-purge";
import {
  CLERK_DELETE_RPC_MARKER_DETAIL,
  CLERK_DELETE_RPC_STEP,
} from "./orchestrate-clerk-deletion";
import {
  ACCOUNT_DELETION_INITIATION_ENABLED_ENV,
  ACCOUNT_DELETION_CONFIRMATION_VALUE,
} from "./run-account-deletion-initiation";
import { ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV } from "./run-account-deletion-scheduler";
import type { AccountDeletionRequestRow } from "./types";

const ROOT = process.cwd();
const USER_PAGE = join(ROOT, "src/app/user/[[...user]]/page.tsx");
const ZONE = join(ROOT, "src/components/account-deletion-danger-zone.tsx");
const VERCEL = join(ROOT, "vercel.json");
const USER_ID = "user_f4a_coherence";
const OTHER_USER = "user_f4a_other";

function baseRow(
  overrides: Partial<AccountDeletionRequestRow> = {}
): AccountDeletionRequestRow {
  const at = "2026-07-20T12:00:00.000Z";
  return {
    id: "00000000-0000-4000-8000-00000000f4a1",
    clerk_user_id: USER_ID,
    orchestration_version: 1,
    status: "requested",
    current_step: "requested",
    steps: { requested: { at, ok: true, code: "created" } },
    attempt_count: 0,
    locked_at: null,
    lock_owner: null,
    created_at: at,
    updated_at: at,
    completed_at: null,
    last_retry_at: null,
    last_error_code: null,
    last_error_detail: null,
    sms_result: null,
    stripe_result: null,
    purge_result: null,
    clerk_result: null,
    idempotency_key: accountDeletionInitiationIdempotencyKey(USER_ID),
    ...overrides,
  };
}

function validPurgeMarker(at = "2026-07-20T12:00:00.000Z") {
  return {
    at,
    ok: true as const,
    code: "purged",
    detail: "limitations:0;categories:1;deleted_total:1",
  };
}

function validClerkMarker(at = "2026-07-20T12:00:00.000Z") {
  return {
    at,
    ok: true as const,
    code: "deleted",
    detail: CLERK_DELETE_RPC_MARKER_DETAIL,
  };
}

function completedRow(
  overrides: Partial<AccountDeletionRequestRow> = {}
): AccountDeletionRequestRow {
  const at = "2026-07-20T12:00:00.000Z";
  return baseRow({
    status: "completed",
    current_step: "completed",
    completed_at: at,
    sms_result: "ok",
    stripe_result: "ok",
    purge_result: "ok",
    clerk_result: "ok",
    steps: {
      requested: { at, ok: true, code: "created" },
      [APP_DATA_PURGE_RPC_STEP]: validPurgeMarker(at),
      [CLERK_DELETE_RPC_STEP]: validClerkMarker(at),
    },
    ...overrides,
  });
}

describe("APP-041F4a strict existing-row coherence", () => {
  it("1. valid requested/requested → coherent (accepted_existing path)", () => {
    expect(isCoherentAccountDeletionInitiationRow(baseRow())).toBe(true);
  });

  it("2. requested/deleting_clerk → conflict", () => {
    const row = baseRow({
      status: "requested",
      current_step: "deleting_clerk",
    });
    expect(isCoherentAccountDeletionInitiationRow(row)).toBe(false);
  });

  it("3. failed_retryable + suppressing_sms → coherent", () => {
    const row = baseRow({
      status: "failed_retryable",
      current_step: "suppressing_sms",
    });
    expect(isCoherentAccountDeletionInitiationRow(row)).toBe(true);
  });

  it("4. failed_retryable + sms_suppressed → conflict", () => {
    const row = baseRow({
      status: "failed_retryable",
      current_step: "sms_suppressed",
    });
    expect(isCoherentAccountDeletionInitiationRow(row)).toBe(false);
  });

  it("5. app_data_purged missing purge marker → conflict", () => {
    const row = baseRow({
      status: "app_data_purged",
      current_step: "app_data_purged",
      purge_result: "ok",
      steps: {},
    });
    expect(isCoherentAccountDeletionInitiationRow(row)).toBe(false);
  });

  it("6. deleting_clerk missing purge marker → conflict", () => {
    const row = baseRow({
      status: "deleting_clerk",
      current_step: "deleting_clerk",
      steps: {},
    });
    expect(isCoherentAccountDeletionInitiationRow(row)).toBe(false);
  });

  it("7. completed missing completed_at → conflict", () => {
    const row = completedRow({ completed_at: null });
    expect(isCoherentAccountDeletionInitiationRow(row)).toBe(false);
  });

  it("8. completed missing Clerk marker → conflict", () => {
    const at = "2026-07-20T12:00:00.000Z";
    const row = completedRow({
      steps: {
        [APP_DATA_PURGE_RPC_STEP]: validPurgeMarker(at),
      },
    });
    expect(isCoherentAccountDeletionInitiationRow(row)).toBe(false);
  });

  it("9. valid completed → coherent (already_completed path)", () => {
    expect(isCoherentAccountDeletionInitiationRow(completedRow())).toBe(true);
  });

  it("10. unsupported version → conflict", () => {
    expect(
      isCoherentAccountDeletionInitiationRow(
        baseRow({ orchestration_version: 99 })
      )
    ).toBe(false);
  });

  it("11. malformed completed_at → conflict", () => {
    const row = completedRow({ completed_at: "not-a-date" });
    expect(isCoherentAccountDeletionInitiationRow(row)).toBe(false);
  });

  it("12. malformed lease → conflict", () => {
    const row = baseRow({ lock_owner: "owner", locked_at: null });
    expect(isCoherentAccountDeletionInitiationRow(row)).toBe(false);
  });
});

describe("APP-041F4a wrapper race + identity fakes", () => {
  const createMock = vi.hoisted(() => vi.fn());
  const unresolvedMock = vi.hoisted(() => vi.fn());

  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
    unresolvedMock.mockReset();
    vi.doMock("server-only", () => ({}));
    vi.doMock("@/lib/account-deletion/repository", async () => {
      const actual = await vi.importActual<
        typeof import("@/lib/account-deletion/repository")
      >("@/lib/account-deletion/repository");
      return {
        ...actual,
        createAccountDeletionRequest: (...args: unknown[]) =>
          createMock(...args),
        getUnresolvedAccountDeletionRequestForUser: (...args: unknown[]) =>
          unresolvedMock(...args),
      };
    });
  });

  afterEach(() => {
    vi.doUnmock("@/lib/account-deletion/repository");
  });

  it("13. same-key 23505-style re-read coherent → accepted_existing", async () => {
    createMock.mockResolvedValue({
      ok: true,
      value: { row: baseRow(), created: false },
    });
    const { initiateAccountDeletionRequestForUser: initiate } = await import(
      "@/lib/account-deletion/initiate-account-deletion-request"
    );
    await expect(initiate(USER_ID)).resolves.toBe("existing_active");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(unresolvedMock).not.toHaveBeenCalled();
  });

  it("14. unresolved-per-user race re-read coherent → accepted_existing", async () => {
    createMock.mockResolvedValue({
      ok: false,
      code: "conflict_unresolved_exists",
      message: "race",
    });
    unresolvedMock.mockResolvedValue(baseRow());
    const { initiateAccountDeletionRequestForUser: initiate } = await import(
      "@/lib/account-deletion/initiate-account-deletion-request"
    );
    await expect(initiate(USER_ID)).resolves.toBe("existing_active");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(unresolvedMock).toHaveBeenCalledTimes(1);
  });

  it("15. race re-read incoherent → conflict", async () => {
    createMock.mockResolvedValue({
      ok: true,
      value: {
        row: baseRow({ status: "requested", current_step: "deleting_clerk" }),
        created: false,
      },
    });
    const { initiateAccountDeletionRequestForUser: initiate } = await import(
      "@/lib/account-deletion/initiate-account-deletion-request"
    );
    await expect(initiate(USER_ID)).resolves.toBe("conflict");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("16. different-user row never accepted", async () => {
    createMock.mockResolvedValue({
      ok: true,
      value: {
        row: baseRow({ clerk_user_id: OTHER_USER }),
        created: false,
      },
    });
    const { initiateAccountDeletionRequestForUser: initiate } = await import(
      "@/lib/account-deletion/initiate-account-deletion-request"
    );
    await expect(initiate(USER_ID)).resolves.toBe("conflict");
  });

  it("17. raw error sanitized → internal_error", async () => {
    createMock.mockRejectedValue(
      Object.assign(new Error("duplicate key value violates unique constraint"), {
        code: "23505",
        detail: "Key (clerk_user_id)=(user_secret) already exists",
      })
    );
    const { initiateAccountDeletionRequestForUser: initiate } = await import(
      "@/lib/account-deletion/initiate-account-deletion-request"
    );
    await expect(initiate(USER_ID)).resolves.toBe("internal_error");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("18. one create attempt maximum (no insert loop)", async () => {
    createMock.mockResolvedValue({
      ok: false,
      code: "conflict_unresolved_exists",
      message: "x",
    });
    unresolvedMock.mockResolvedValue(
      baseRow({ status: "requested", current_step: "deleting_clerk" })
    );
    const { initiateAccountDeletionRequestForUser: initiate } = await import(
      "@/lib/account-deletion/initiate-account-deletion-request"
    );
    await expect(initiate(USER_ID)).resolves.toBe("conflict");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(unresolvedMock).toHaveBeenCalledTimes(1);
  });
});

describe("APP-041F4a route body override", () => {
  const authMock = vi.hoisted(() => vi.fn());
  const initiateMock = vi.hoisted(() => vi.fn());
  const reauthMock = vi.hoisted(() => vi.fn());

  const prevInit = process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV];
  const prevSched = process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];

  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    initiateMock.mockReset();
    reauthMock.mockReset();
    process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV] = "true";
    process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV] = "true";

    vi.doMock("server-only", () => ({}));
    vi.doMock("@/lib/supabase-server", () => ({
      supabaseServer: { from: vi.fn(), rpc: vi.fn() },
    }));
    vi.doMock("@clerk/nextjs/server", async () => {
      const actual = await vi.importActual<typeof import("@clerk/nextjs/server")>(
        "@clerk/nextjs/server"
      );
      return { ...actual, auth: (...args: unknown[]) => authMock(...args) };
    });
    vi.doMock("@/lib/account-deletion/initiate-account-deletion-request", () => ({
      initiateAccountDeletionRequestForUser: (...args: unknown[]) =>
        initiateMock(...args),
      accountDeletionInitiationIdempotencyKey: (id: string) =>
        `account-delete:v1:${id}`,
      isCoherentAccountDeletionInitiationRow: () => true,
    }));
    vi.doMock(
      "@/lib/account-deletion/verify-account-deletion-reauthentication",
      () => ({
        verifyAccountDeletionReauthenticationWithClerk: (...args: unknown[]) =>
          reauthMock(...args),
      })
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

  it("19–21. extra userId/idempotencyKey → 400; no reauth/create", async () => {
    authMock.mockResolvedValue({
      userId: USER_ID,
      has: () => true,
    });
    reauthMock.mockReturnValue({ ok: true });
    const { POST } = await import("@/app/api/account/delete/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmation: ACCOUNT_DELETION_CONFIRMATION_VALUE,
          userId: OTHER_USER,
          idempotencyKey: "attacker-value",
        }),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      ok: false,
      code: "invalid_confirmation",
    });
    expect(reauthMock).not.toHaveBeenCalled();
    expect(initiateMock).not.toHaveBeenCalled();
  });
});

describe("APP-041F4a dynamic / hidden / no-scope", () => {
  it("50–53. force-dynamic; hidden wiring preserved", () => {
    const page = readFileSync(USER_PAGE, "utf8");
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toContain('=== "true"');
    expect(page).not.toContain('"use client"');
    expect(page).not.toMatch(/dangerZone=\{process\.env/);

    const zone = readFileSync(ZONE, "utf8");
    expect(zone).toContain("useReverification");
    expect(zone).not.toMatch(/password|otp|defaultAllow|bypassReauth/i);

    expect(process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV]).not.toBe(
      "true"
    );
    expect(process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV]).not.toBe(
      "true"
    );
  });

  it("57–61. no vercel change; no provider calls in F4a UI", () => {
    const vercel = readFileSync(VERCEL, "utf8");
    expect(vercel).not.toMatch(/ACCOUNT_DELETION_INITIATION|Danger zone/i);
    const zone = readFileSync(ZONE, "utf8");
    expect(zone).not.toMatch(
      /executeTrustedAccountDeletionReconcile|suppressSmsForDeletion|acquireAccountDeletionLease|orchestrateClerkDeletion|purgeAppDataForDeletion/
    );
  });
});
