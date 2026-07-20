/**
 * APP-041F4b — designated test-account allowlist foundation (inert).
 * Pure matrix + mocked route/UI proofs — no live env, Clerk, or deletion.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn(), rpc: vi.fn() },
}));

import {
  ACCOUNT_DELETION_INITIATION_ENABLED_ENV,
  ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV,
  ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV,
  ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV,
  evaluateAccountDeletionInitiationAccess,
  isExactTrueFlag,
} from "./account-deletion-initiation-access";
import {
  ACCOUNT_DELETION_CONFIRMATION_VALUE,
  ACCOUNT_DELETION_INITIATION_DISABLED_CODE,
} from "./run-account-deletion-initiation";

const ROOT = process.cwd();
const USER_PAGE = join(ROOT, "src/app/user/[[...user]]/page.tsx");
const ZONE = join(ROOT, "src/components/account-deletion-danger-zone.tsx");
const ROUTE = join(ROOT, "src/app/api/account/delete/route.ts");
const ACCESS = join(
  ROOT,
  "src/lib/account-deletion/account-deletion-initiation-access.ts"
);
const ACCESS_SERVER = join(
  ROOT,
  "src/lib/account-deletion/account-deletion-initiation-access.server.ts"
);
const VERCEL = join(ROOT, "vercel.json");
const CRON = join(ROOT, "src/app/api/cron/account-deletions/route.ts");

/** Synthetic fixture IDs only — not real Clerk accounts. */
const USER_A = "user_f4b_fixture_alpha";
const USER_B = "user_f4b_fixture_beta";

describe("APP-041F4b pure access matrix", () => {
  it("1. all flags off → disabled", () => {
    expect(
      evaluateAccountDeletionInitiationAccess({
        authenticatedUserId: USER_A,
        publicInitiationFlag: undefined,
        schedulerFlag: undefined,
        testModeFlag: undefined,
        designatedTestUserId: undefined,
      })
    ).toBe("disabled");
  });

  it("2. public true + scheduler false → disabled", () => {
    expect(
      evaluateAccountDeletionInitiationAccess({
        authenticatedUserId: USER_A,
        publicInitiationFlag: "true",
        schedulerFlag: "false",
        testModeFlag: undefined,
        designatedTestUserId: undefined,
      })
    ).toBe("disabled");
  });

  it("3 + 14. public true + scheduler true → public_enabled (no designated needed)", () => {
    expect(
      evaluateAccountDeletionInitiationAccess({
        authenticatedUserId: USER_A,
        publicInitiationFlag: "true",
        schedulerFlag: "true",
        testModeFlag: undefined,
        designatedTestUserId: undefined,
      })
    ).toBe("public_enabled");
  });

  it("4. test mode true + scheduler false + exact user → disabled", () => {
    expect(
      evaluateAccountDeletionInitiationAccess({
        authenticatedUserId: USER_A,
        publicInitiationFlag: undefined,
        schedulerFlag: undefined,
        testModeFlag: "true",
        designatedTestUserId: USER_A,
      })
    ).toBe("disabled");
    expect(
      evaluateAccountDeletionInitiationAccess({
        authenticatedUserId: USER_A,
        publicInitiationFlag: undefined,
        schedulerFlag: "false",
        testModeFlag: "true",
        designatedTestUserId: USER_A,
      })
    ).toBe("disabled");
  });

  it("5. test mode true + scheduler true + exact user → designated_test_enabled", () => {
    expect(
      evaluateAccountDeletionInitiationAccess({
        authenticatedUserId: USER_A,
        publicInitiationFlag: undefined,
        schedulerFlag: "true",
        testModeFlag: "true",
        designatedTestUserId: USER_A,
      })
    ).toBe("designated_test_enabled");
  });

  it("6. test mode true + scheduler true + nonmatching user → disabled", () => {
    expect(
      evaluateAccountDeletionInitiationAccess({
        authenticatedUserId: USER_B,
        publicInitiationFlag: undefined,
        schedulerFlag: "true",
        testModeFlag: "true",
        designatedTestUserId: USER_A,
      })
    ).toBe("disabled");
  });

  it("7. test mode false + matching user + scheduler true → disabled", () => {
    expect(
      evaluateAccountDeletionInitiationAccess({
        authenticatedUserId: USER_A,
        publicInitiationFlag: undefined,
        schedulerFlag: "true",
        testModeFlag: "false",
        designatedTestUserId: USER_A,
      })
    ).toBe("disabled");
  });

  it("8–9. missing/empty designated user ID → disabled", () => {
    expect(
      evaluateAccountDeletionInitiationAccess({
        authenticatedUserId: USER_A,
        publicInitiationFlag: undefined,
        schedulerFlag: "true",
        testModeFlag: "true",
        designatedTestUserId: undefined,
      })
    ).toBe("disabled");
    expect(
      evaluateAccountDeletionInitiationAccess({
        authenticatedUserId: USER_A,
        publicInitiationFlag: undefined,
        schedulerFlag: "true",
        testModeFlag: "true",
        designatedTestUserId: "",
      })
    ).toBe("disabled");
  });

  it("10–13. case/whitespace/prefix/comma mismatches → disabled", () => {
    const base = {
      authenticatedUserId: USER_A,
      publicInitiationFlag: undefined as string | undefined,
      schedulerFlag: "true" as const,
      testModeFlag: "true" as const,
    };
    expect(
      evaluateAccountDeletionInitiationAccess({
        ...base,
        designatedTestUserId: USER_A.toUpperCase(),
      })
    ).toBe("disabled");
    expect(
      evaluateAccountDeletionInitiationAccess({
        ...base,
        designatedTestUserId: ` ${USER_A}`,
      })
    ).toBe("disabled");
    expect(
      evaluateAccountDeletionInitiationAccess({
        ...base,
        designatedTestUserId: `${USER_A} `,
      })
    ).toBe("disabled");
    expect(
      evaluateAccountDeletionInitiationAccess({
        ...base,
        designatedTestUserId: USER_A.slice(0, -1),
      })
    ).toBe("disabled");
    expect(
      evaluateAccountDeletionInitiationAccess({
        ...base,
        designatedTestUserId: `${USER_A}x`,
      })
    ).toBe("disabled");
    expect(
      evaluateAccountDeletionInitiationAccess({
        ...base,
        designatedTestUserId: `${USER_A},${USER_B}`,
      })
    ).toBe("disabled");
  });

  it("15. scheduler required for both public and test modes", () => {
    expect(
      evaluateAccountDeletionInitiationAccess({
        authenticatedUserId: USER_A,
        publicInitiationFlag: "true",
        schedulerFlag: undefined,
        testModeFlag: undefined,
        designatedTestUserId: undefined,
      })
    ).toBe("disabled");
    expect(
      evaluateAccountDeletionInitiationAccess({
        authenticatedUserId: USER_A,
        publicInitiationFlag: undefined,
        schedulerFlag: undefined,
        testModeFlag: "true",
        designatedTestUserId: USER_A,
      })
    ).toBe("disabled");
  });

  it("36–39. exact-string flags only", () => {
    expect(isExactTrueFlag("TRUE")).toBe(false);
    expect(isExactTrueFlag("1")).toBe(false);
    expect(isExactTrueFlag(" true")).toBe(false);
    expect(isExactTrueFlag("true ")).toBe(false);
    expect(isExactTrueFlag("true")).toBe(true);

    for (const bad of ["TRUE", "1", " true", "true "]) {
      expect(
        evaluateAccountDeletionInitiationAccess({
          authenticatedUserId: USER_A,
          publicInitiationFlag: bad,
          schedulerFlag: "true",
          testModeFlag: undefined,
          designatedTestUserId: undefined,
        })
      ).toBe("disabled");
      expect(
        evaluateAccountDeletionInitiationAccess({
          authenticatedUserId: USER_A,
          publicInitiationFlag: undefined,
          schedulerFlag: "true",
          testModeFlag: bad,
          designatedTestUserId: USER_A,
        })
      ).toBe("disabled");
    }

    expect(
      evaluateAccountDeletionInitiationAccess({
        authenticatedUserId: USER_A,
        publicInitiationFlag: "true",
        schedulerFlag: "true",
        testModeFlag: undefined,
        designatedTestUserId: undefined,
      })
    ).toBe("public_enabled");
    expect(
      evaluateAccountDeletionInitiationAccess({
        authenticatedUserId: USER_A,
        publicInitiationFlag: undefined,
        schedulerFlag: "true",
        testModeFlag: "true",
        designatedTestUserId: USER_A,
      })
    ).toBe("designated_test_enabled");
  });
});

describe("APP-041F4b route access", () => {
  const authMock = vi.hoisted(() => vi.fn());
  const initiateMock = vi.hoisted(() => vi.fn());
  const reauthMock = vi.hoisted(() => vi.fn());

  const prevInit = process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV];
  const prevSched = process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];
  const prevTest = process.env[ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV];
  const prevDesignated = process.env[ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV];

  function clearAccessEnv() {
    delete process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV];
    delete process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];
    delete process.env[ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV];
    delete process.env[ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV];
  }

  function restoreAccessEnv() {
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
    if (prevTest === undefined) {
      delete process.env[ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV];
    } else {
      process.env[ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV] = prevTest;
    }
    if (prevDesignated === undefined) {
      delete process.env[ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV];
    } else {
      process.env[ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV] = prevDesignated;
    }
  }

  beforeEach(() => {
    vi.resetModules();
    authMock.mockReset();
    initiateMock.mockReset();
    reauthMock.mockReset();
    clearAccessEnv();

    vi.doMock("server-only", () => ({}));
    vi.doMock("@/lib/supabase-server", () => ({
      supabaseServer: { from: vi.fn(), rpc: vi.fn() },
    }));
    vi.doMock("@clerk/nextjs/server", async () => {
      const actual = await vi.importActual<
        typeof import("@clerk/nextjs/server")
      >("@clerk/nextjs/server");
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
    restoreAccessEnv();
  });

  it("16. unauthenticated → 401 before access mutation work", async () => {
    authMock.mockResolvedValue({ userId: null });
    const jsonSpy = vi.spyOn(Request.prototype, "json");
    const { POST } = await import("@/app/api/account/delete/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: ACCOUNT_DELETION_CONFIRMATION_VALUE }),
      })
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, code: "unauthorized" });
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(reauthMock).not.toHaveBeenCalled();
    expect(initiateMock).not.toHaveBeenCalled();
    jsonSpy.mockRestore();
  });

  it("17. disabled normal user → 503; no body parse/reauth/create", async () => {
    authMock.mockResolvedValue({ userId: USER_A, has: () => true });
    const jsonSpy = vi.spyOn(Request.prototype, "json");
    const { POST } = await import("@/app/api/account/delete/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: ACCOUNT_DELETION_CONFIRMATION_VALUE }),
      })
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      ok: false,
      code: ACCOUNT_DELETION_INITIATION_DISABLED_CODE,
    });
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(reauthMock).not.toHaveBeenCalled();
    expect(initiateMock).not.toHaveBeenCalled();
    jsonSpy.mockRestore();
  });

  it("18. designated user with scheduler off → 503", async () => {
    process.env[ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV] = "true";
    process.env[ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV] = USER_A;
    authMock.mockResolvedValue({ userId: USER_A, has: () => true });
    const { POST } = await import("@/app/api/account/delete/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: ACCOUNT_DELETION_CONFIRMATION_VALUE }),
      })
    );
    expect(res.status).toBe(503);
    expect(reauthMock).not.toHaveBeenCalled();
    expect(initiateMock).not.toHaveBeenCalled();
  });

  it("19. exact designated user with test mode + scheduler on proceeds", async () => {
    process.env[ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV] = "true";
    process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV] = "true";
    process.env[ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV] = USER_A;
    authMock.mockResolvedValue({ userId: USER_A, has: () => true });
    reauthMock.mockReturnValue({ ok: true });
    initiateMock.mockResolvedValue("created_new");
    const { POST } = await import("@/app/api/account/delete/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: ACCOUNT_DELETION_CONFIRMATION_VALUE }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, code: "accepted_new" });
    expect(body).not.toHaveProperty("access");
    expect(body).not.toHaveProperty("mode");
    expect(JSON.stringify(body)).not.toContain(USER_A);
    expect(JSON.stringify(body)).not.toContain(
      ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV
    );
    expect(initiateMock).toHaveBeenCalledWith(USER_A);
  });

  it("20. non-designated user with test mode + scheduler on → 503", async () => {
    process.env[ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV] = "true";
    process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV] = "true";
    process.env[ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV] = USER_A;
    authMock.mockResolvedValue({ userId: USER_B, has: () => true });
    const { POST } = await import("@/app/api/account/delete/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: ACCOUNT_DELETION_CONFIRMATION_VALUE }),
      })
    );
    expect(res.status).toBe(503);
    expect(initiateMock).not.toHaveBeenCalled();
  });

  it("21. public mode + scheduler on proceeds for normal user", async () => {
    process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV] = "true";
    process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV] = "true";
    authMock.mockResolvedValue({ userId: USER_B, has: () => true });
    reauthMock.mockReturnValue({ ok: true });
    initiateMock.mockResolvedValue("created_new");
    const { POST } = await import("@/app/api/account/delete/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation: ACCOUNT_DELETION_CONFIRMATION_VALUE }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, code: "accepted_new" });
    expect(initiateMock).toHaveBeenCalledWith(USER_B);
  });

  it("22–25. body cannot override identity; response hides mode/ID/env", async () => {
    process.env[ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV] = "true";
    process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV] = "true";
    process.env[ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV] = USER_A;
    authMock.mockResolvedValue({ userId: USER_A, has: () => true });
    reauthMock.mockReturnValue({ ok: true });
    const { POST } = await import("@/app/api/account/delete/route");
    const res = await POST(
      new Request("http://localhost/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmation: ACCOUNT_DELETION_CONFIRMATION_VALUE,
          userId: USER_B,
          idempotencyKey: "attacker-value",
        }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ ok: false, code: "invalid_confirmation" });
    expect(JSON.stringify(body)).not.toMatch(
      /public_enabled|designated_test|test_mode|USER_A|USER_B|ACCOUNT_DELETION_/
    );
    expect(reauthMock).not.toHaveBeenCalled();
    expect(initiateMock).not.toHaveBeenCalled();
  });
});

describe("APP-041F4b UI gating source + pure show decision", () => {
  it("26–35. page uses server auth + shared access; no client ID/mode/env", async () => {
    const page = readFileSync(USER_PAGE, "utf8");
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toContain("await auth()");
    expect(page).toContain("shouldShowAccountDeletionDangerZone");
    expect(page).toContain("showDangerZone ? <AccountDeletionDangerZone />");
    expect(page).not.toContain('"use client"');
    expect(page).not.toMatch(/dangerZone=\{process\.env/);
    expect(page).not.toMatch(/userId=\{/);
    expect(page).not.toMatch(/dangerZone=\{[^}]*userId/);
    expect(page).not.toMatch(/ACCOUNT_DELETION_TEST_/);
    expect(page).not.toMatch(/test mode|Test mode|designated user/i);

    const zone = readFileSync(ZONE, "utf8");
    expect(zone).not.toMatch(/process\.env/);
    expect(zone).not.toMatch(/ACCOUNT_DELETION_TEST_|TEST_MODE|TEST_CLERK/);
    expect(zone).not.toMatch(/test mode|designated test/i);

    const {
      shouldShowAccountDeletionDangerZone,
    } = await import("./account-deletion-initiation-access.server");

    const prevInit = process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV];
    const prevSched = process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];
    const prevTest = process.env[ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV];
    const prevDesignated =
      process.env[ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV];

    const clear = () => {
      delete process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV];
      delete process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV];
      delete process.env[ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV];
      delete process.env[ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV];
    };
    const restore = () => {
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
      if (prevTest === undefined) {
        delete process.env[ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV];
      } else {
        process.env[ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV] = prevTest;
      }
      if (prevDesignated === undefined) {
        delete process.env[ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV];
      } else {
        process.env[ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV] = prevDesignated;
      }
    };

    try {
      clear();
      expect(shouldShowAccountDeletionDangerZone(USER_A)).toBe(false);

      process.env[ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV] = "true";
      process.env[ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV] = USER_A;
      expect(shouldShowAccountDeletionDangerZone(USER_A)).toBe(false);

      process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV] = "true";
      expect(shouldShowAccountDeletionDangerZone(USER_A)).toBe(true);
      expect(shouldShowAccountDeletionDangerZone(USER_B)).toBe(false);

      clear();
      process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV] = "true";
      process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV] = "true";
      expect(shouldShowAccountDeletionDangerZone(USER_B)).toBe(true);
    } finally {
      restore();
    }
  });
});

describe("APP-041F4b no-scope / inert", () => {
  it("40–50. no migration/env/vercel/cron/providers/real IDs", () => {
    const access = readFileSync(ACCESS, "utf8");
    const accessServer = readFileSync(ACCESS_SERVER, "utf8");
    const page = readFileSync(USER_PAGE, "utf8");
    const route = readFileSync(ROUTE, "utf8");
    const zone = readFileSync(ZONE, "utf8");
    const vercel = readFileSync(VERCEL, "utf8");
    const cron = readFileSync(CRON, "utf8");

    expect(route).toContain("resolveAccountDeletionInitiationAccess");
    expect(cron).not.toContain("ACCOUNT_DELETION_TEST_");
    expect(vercel).not.toMatch(/ACCOUNT_DELETION_TEST_|Danger zone/i);

    for (const src of [access, accessServer, page, route, zone]) {
      expect(src).not.toMatch(
        /executeTrustedAccountDeletionReconcile|suppressSmsForDeletion|acquireAccountDeletionLease|orchestrateClerkDeletion|purgeAppDataForDeletion/
      );
      expect(src).not.toMatch(/user_[A-Za-z0-9]{20,}/);
      expect(src).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
      expect(src).not.toMatch(/\+1\d{10}|\b\d{10}\b/);
    }

    expect(process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV]).not.toBe(
      "true"
    );
    expect(process.env[ACCOUNT_DELETION_SCHEDULER_ENABLED_ENV]).not.toBe(
      "true"
    );
    expect(process.env[ACCOUNT_DELETION_TEST_MODE_ENABLED_ENV]).not.toBe(
      "true"
    );
    expect(process.env[ACCOUNT_DELETION_TEST_CLERK_USER_ID_ENV]).toBeUndefined();
  });
});
