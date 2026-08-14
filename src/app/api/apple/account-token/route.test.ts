import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

const assertDeletionMock = vi.fn();
vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  ACCOUNT_DELETION_IN_PROGRESS_BODY: {
    error: "account_deletion_in_progress",
    message: "This action is unavailable.",
  },
  assertEntitlementMutationAllowedForAccountDeletion: (...args: unknown[]) =>
    assertDeletionMock(...args),
}));

const getOrCreateMock = vi.fn();
vi.mock("@/lib/apple-iap/bindings", () => ({
  getOrCreateLiveAppleAccountToken: (...args: unknown[]) =>
    getOrCreateMock(...args),
}));

const TOKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function tokenRequest(url =
  "http://localhost/api/apple/account-token"): Request {
  return new Request(url, { method: "GET" });
}

describe("GET /api/apple/account-token", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.APPLE_IAP_ENVIRONMENT;
    delete process.env.APPLE_IAP_APP_APPLE_ID;
    delete process.env.APPLE_IAP_ISSUER_ID;
    delete process.env.APPLE_IAP_KEY_ID;
    delete process.env.APPLE_IAP_PRIVATE_KEY;
    authMock.mockResolvedValue({ userId: "user_1" });
    assertDeletionMock.mockResolvedValue({ ok: true });
    getOrCreateMock.mockResolvedValue({
      ok: true,
      appAccountToken: TOKEN,
    });
  });

  it("unauthenticated → 401 and does not query bindings", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { GET } = await import("./route");
    const res = await GET(tokenRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(assertDeletionMock).not.toHaveBeenCalled();
    expect(getOrCreateMock).not.toHaveBeenCalled();
  });

  it("authenticated existing/first issuance returns only appAccountToken", async () => {
    const { GET } = await import("./route");
    const res = await GET(tokenRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ appAccountToken: TOKEN });
    expect(getOrCreateMock).toHaveBeenCalledWith("user_1");
  });

  it("repeat request uses auth().userId only", async () => {
    const { GET } = await import("./route");
    await GET(tokenRequest());
    await GET(tokenRequest());
    expect(getOrCreateMock).toHaveBeenCalledTimes(2);
    expect(getOrCreateMock.mock.calls[0][0]).toBe("user_1");
    expect(getOrCreateMock.mock.calls[1][0]).toBe("user_1");
  });

  it("client query/body UUID cannot influence the result", async () => {
    const attacker = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const { GET } = await import("./route");
    const res = await GET(
      tokenRequest(
        `http://localhost/api/apple/account-token?userId=attacker&appAccountToken=${attacker}`
      )
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ appAccountToken: TOKEN });
    expect(getOrCreateMock).toHaveBeenCalledTimes(1);
    expect(getOrCreateMock).toHaveBeenCalledWith("user_1");
    expect(getOrCreateMock.mock.calls[0][0]).not.toBe("attacker");
  });

  it("unresolved account deletion → 409, no insert", async () => {
    assertDeletionMock.mockResolvedValue({
      ok: false,
      code: "account_deletion_in_progress",
    });
    const { GET } = await import("./route");
    const res = await GET(tokenRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "account_deletion_in_progress",
      message: "This action is unavailable.",
    });
    expect(getOrCreateMock).not.toHaveBeenCalled();
  });

  it("deletion lookup failure → 500, no insert", async () => {
    assertDeletionMock.mockResolvedValue({
      ok: false,
      code: "lookup_failed",
    });
    const { GET } = await import("./route");
    const res = await GET(tokenRequest());
    expect(res.status).toBe(500);
    expect(getOrCreateMock).not.toHaveBeenCalled();
  });

  it("DB read/insert failure → 500 without manufacturing a body token", async () => {
    getOrCreateMock.mockResolvedValue({ ok: false, reason: "read_failed" });
    const { GET } = await import("./route");
    const res = await GET(tokenRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal Server Error" });
  });

  it("does not require Apple env, secrets, verifier, or API client", async () => {
    const { GET } = await import("./route");
    const res = await GET(tokenRequest());
    expect(res.status).toBe(200);
    const src = readFileSync(
      join(process.cwd(), "src/app/api/apple/account-token/route.ts"),
      "utf8"
    );
    expect(src).not.toContain("verifier");
    expect(src).not.toContain("api-client");
    expect(src).not.toContain("APPLE_IAP_");
    expect(src).not.toContain("createSignedDataVerifier");
    expect(src).not.toContain("createAppStoreServerApiClient");
  });

  it("does not use client/browser Supabase", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/apple/account-token/route.ts"),
      "utf8"
    );
    expect(src).not.toContain("createBrowserClient");
    expect(src).not.toContain("supabase-browser");
    expect(src).not.toContain("@supabase/auth-helpers");
  });
});
