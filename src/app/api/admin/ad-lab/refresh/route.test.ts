import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireTylerAdmin = vi.hoisted(() => vi.fn());
const importMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/require-tyler-admin", () => ({
  requireTylerAdmin,
}));

vi.mock("@/lib/ad-lab-import", () => ({
  runAdLabImport: (...args: unknown[]) => importMock(...args),
}));

import { POST } from "@/app/api/admin/ad-lab/refresh/route";

const TOKEN = "meta-ad-lab-test-token-value";

beforeEach(() => {
  requireTylerAdmin.mockReset();
  importMock.mockReset();
  requireTylerAdmin.mockResolvedValue({ userId: "user_brooke" });
});

describe("POST /api/admin/ad-lab/refresh", () => {
  it("requires an admin before importing", async () => {
    requireTylerAdmin.mockRejectedValueOnce(Object.assign(new Error("UNAUTHORIZED"), { status: 401 }));
    const response = await POST();
    expect(response.status).toBe(401);
    expect(importMock).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(TOKEN);
  });

  it("imports the recent window and hides a Meta token", async () => {
    importMock.mockResolvedValueOnce({
      ok: false,
      reason: "meta",
      message: `Meta said access_token=${TOKEN}`,
    });
    const response = await POST();
    expect(importMock).toHaveBeenCalledWith();
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      reason: "meta",
      error: "Meta is temporarily unavailable. The stored results are unchanged.",
    });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(JSON.stringify(body)).not.toContain("access_token");
  });

  it("tells the browser to wait when an import is already running", async () => {
    importMock.mockResolvedValueOnce({
      ok: false,
      reason: "cooldown",
      message: "internal",
    });
    const response = await POST();
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      ok: false,
      reason: "cooldown",
      error: "Meta was refreshed a few minutes ago. The stored results are unchanged.",
    });
  });
});
