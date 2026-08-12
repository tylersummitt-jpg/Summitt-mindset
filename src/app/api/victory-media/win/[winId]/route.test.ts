import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const removeMock = vi.fn();
const hasUnresolvedMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/victory-media/remove-victory-win-media", () => ({
  removeVictoryWinMediaForUser: (...args: unknown[]) => removeMock(...args),
}));

vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  hasUnresolvedAccountDeletionRequest: (...args: unknown[]) =>
    hasUnresolvedMock(...args),
}));

const WIN = "550e8400-e29b-41d4-a716-446655440010";

describe("DELETE /api/victory-media/win/[winId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
    hasUnresolvedMock.mockResolvedValue(false);
    removeMock.mockResolvedValue({ ok: true, status: "removed" });
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request(`http://localhost/api/victory-media/win/${WIN}`, {
        method: "DELETE",
      }),
      { params: { winId: WIN } }
    );
    expect(res.status).toBe(401);
    expect(removeMock).not.toHaveBeenCalled();
    expect(hasUnresolvedMock).not.toHaveBeenCalled();
  });

  it("rejects invalid UUID", async () => {
    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request("http://localhost/api/victory-media/win/not-a-uuid", {
        method: "DELETE",
      }),
      { params: { winId: "not-a-uuid" } }
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("invalid_input");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("blocks when unresolved account deletion exists", async () => {
    hasUnresolvedMock.mockResolvedValue(true);
    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request(`http://localhost/api/victory-media/win/${WIN}`, {
        method: "DELETE",
      }),
      { params: { winId: WIN } }
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toEqual({
      ok: false,
      error: "This action is unavailable.",
      code: "account_deletion_in_progress",
    });
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("fails closed when deletion lookup throws", async () => {
    hasUnresolvedMock.mockRejectedValue(new Error("db down"));
    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request(`http://localhost/api/victory-media/win/${WIN}`, {
        method: "DELETE",
      }),
      { params: { winId: WIN } }
    );
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe("deletion_lookup_failed");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("owned removed → 200", async () => {
    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request(`http://localhost/api/victory-media/win/${WIN}`, {
        method: "DELETE",
      }),
      { params: { winId: WIN } }
    );
    expect(res.status).toBe(200);
    expect(hasUnresolvedMock).toHaveBeenCalledWith("user_1");
    expect(removeMock).toHaveBeenCalledWith({
      clerkUserId: "user_1",
      winId: WIN,
    });
    const json = await res.json();
    expect(json).toEqual({ ok: true, status: "removed" });
  });

  it("owned already_absent → 200", async () => {
    removeMock.mockResolvedValue({ ok: true, status: "already_absent" });
    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request(`http://localhost/api/victory-media/win/${WIN}`, {
        method: "DELETE",
      }),
      { params: { winId: WIN } }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "already_absent" });
  });

  it("foreign/not-owned → safe not_found", async () => {
    removeMock.mockResolvedValue({ ok: false, code: "not_found" });
    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request(`http://localhost/api/victory-media/win/${WIN}`, {
        method: "DELETE",
      }),
      { params: { winId: WIN } }
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({
      ok: false,
      error: "Win not found.",
      code: "not_found",
    });
    expect(JSON.stringify(json).toLowerCase()).not.toContain("owner");
    expect(JSON.stringify(json).toLowerCase()).not.toContain("user_");
  });

  it("helper failure → generic 5xx", async () => {
    removeMock.mockResolvedValue({ ok: false, code: "storage_remove_failed" });
    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request(`http://localhost/api/victory-media/win/${WIN}`, {
        method: "DELETE",
      }),
      { params: { winId: WIN } }
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.code).toBe("remove_failed");
    expect(json.error).toMatch(/photo/i);
    expect(JSON.stringify(json)).not.toMatch(/storage_master|service_role|path/i);
  });

  it("media_lookup_failed → generic non-2xx (not 200 already_absent)", async () => {
    removeMock.mockResolvedValue({ ok: false, code: "media_lookup_failed" });
    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request(`http://localhost/api/victory-media/win/${WIN}`, {
        method: "DELETE",
      }),
      { params: { winId: WIN } }
    );
    expect(res.status).toBe(500);
    expect(res.status).not.toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      ok: false,
      error: "We couldn’t remove this photo. Please try again.",
      code: "remove_failed",
    });
    expect(JSON.stringify(json)).not.toMatch(/supabase|v2_win_media|query/i);
  });

  it("response never includes Storage paths", async () => {
    removeMock.mockResolvedValue({ ok: true, status: "removed" });
    const { DELETE } = await import("./route");
    const res = await DELETE(
      new Request(`http://localhost/api/victory-media/win/${WIN}`, {
        method: "DELETE",
      }),
      { params: { winId: WIN } }
    );
    const text = await res.text();
    expect(text).not.toMatch(/master\.jpg|card\.jpg|victory-media\//i);
    expect(text).not.toMatch(/storage_/i);
  });
});
