import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

const TYLER_ID = "user_tyler_admin";
const BROOKE_ID = "user_brooke_admin";

describe("requireTylerAdmin", () => {
  const env = { ...process.env };

  beforeEach(() => {
    authMock.mockReset();
    process.env = { ...env };
    process.env.TYLER_CLERK_USER_ID = TYLER_ID;
    delete process.env.BROOKE_CLERK_USER_ID;
  });

  afterEach(() => {
    process.env = env;
  });

  it("allows Tyler", async () => {
    authMock.mockResolvedValueOnce({ userId: TYLER_ID });
    await expect(requireTylerAdmin()).resolves.toEqual({ userId: TYLER_ID });
  });

  it("allows Brooke when BROOKE_CLERK_USER_ID matches exactly", async () => {
    process.env.BROOKE_CLERK_USER_ID = BROOKE_ID;
    authMock.mockResolvedValueOnce({ userId: BROOKE_ID });
    await expect(requireTylerAdmin()).resolves.toEqual({ userId: BROOKE_ID });
  });

  it("rejects a random signed-in user with 403", async () => {
    process.env.BROOKE_CLERK_USER_ID = BROOKE_ID;
    authMock.mockResolvedValueOnce({ userId: "user_random" });
    await expect(requireTylerAdmin()).rejects.toMatchObject({
      message: "FORBIDDEN",
      status: 403,
    });
  });

  it("rejects logged-out access with 401", async () => {
    authMock.mockResolvedValueOnce({ userId: null });
    await expect(requireTylerAdmin()).rejects.toMatchObject({
      message: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("fails closed with 500 when TYLER_CLERK_USER_ID is missing", async () => {
    delete process.env.TYLER_CLERK_USER_ID;
    process.env.BROOKE_CLERK_USER_ID = BROOKE_ID;
    authMock.mockResolvedValueOnce({ userId: TYLER_ID });
    await expect(requireTylerAdmin()).rejects.toMatchObject({
      message: "SERVER_MISCONFIG_TYLER_CLERK_USER_ID",
      status: 500,
    });
  });

  it("fails closed with 500 when TYLER_CLERK_USER_ID is blank", async () => {
    process.env.TYLER_CLERK_USER_ID = "   ";
    authMock.mockResolvedValueOnce({ userId: TYLER_ID });
    await expect(requireTylerAdmin()).rejects.toMatchObject({
      message: "SERVER_MISCONFIG_TYLER_CLERK_USER_ID",
      status: 500,
    });
  });

  it("fails closed with 500 when TYLER_CLERK_USER_ID is truncated", async () => {
    process.env.TYLER_CLERK_USER_ID = "user_tyler…";
    authMock.mockResolvedValueOnce({ userId: TYLER_ID });
    await expect(requireTylerAdmin()).rejects.toMatchObject({
      message: "SERVER_MISCONFIG_TYLER_CLERK_USER_ID",
      status: 500,
    });
  });

  it("still allows Tyler when BROOKE_CLERK_USER_ID is missing", async () => {
    delete process.env.BROOKE_CLERK_USER_ID;
    authMock.mockResolvedValueOnce({ userId: TYLER_ID });
    await expect(requireTylerAdmin()).resolves.toEqual({ userId: TYLER_ID });
  });

  it("still allows Tyler when BROOKE_CLERK_USER_ID is blank", async () => {
    process.env.BROOKE_CLERK_USER_ID = "   ";
    authMock.mockResolvedValueOnce({ userId: TYLER_ID });
    await expect(requireTylerAdmin()).resolves.toEqual({ userId: TYLER_ID });
  });

  it("ignores a truncated Brooke env and still allows Tyler", async () => {
    process.env.BROOKE_CLERK_USER_ID = "user_brooke...";
    authMock.mockResolvedValueOnce({ userId: TYLER_ID });
    await expect(requireTylerAdmin()).resolves.toEqual({ userId: TYLER_ID });
  });

  it("does not allow a random user when Brooke env is malformed", async () => {
    process.env.BROOKE_CLERK_USER_ID = "user_brooke…";
    authMock.mockResolvedValueOnce({ userId: "user_random" });
    await expect(requireTylerAdmin()).rejects.toMatchObject({
      message: "FORBIDDEN",
      status: 403,
    });
  });

  it("does not allow Brooke unless the Clerk user ID matches exactly", async () => {
    process.env.BROOKE_CLERK_USER_ID = BROOKE_ID;
    authMock.mockResolvedValueOnce({ userId: `${BROOKE_ID}_extra` });
    await expect(requireTylerAdmin()).rejects.toMatchObject({
      message: "FORBIDDEN",
      status: 403,
    });
  });
});
