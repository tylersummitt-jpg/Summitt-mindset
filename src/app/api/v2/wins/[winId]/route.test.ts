import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const currentUserMock = vi.fn();
const applyMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  currentUser: () => currentUserMock(),
}));

vi.mock("@/lib/v2-win-user-edit", () => ({
  applyUserVictoryWinEdit: (...args: unknown[]) => applyMock(...args),
}));

describe("PATCH /api/v2/wins/[winId]", () => {
  beforeEach(() => {
    authMock.mockReset();
    currentUserMock.mockReset();
    applyMock.mockReset();
    authMock.mockResolvedValue({ userId: "user_1" });
    currentUserMock.mockResolvedValue({
      id: "user_1",
      publicMetadata: { timezone: "UTC" },
    });
  });

  it("rejects commitment_id and returns 409 on conflict", async () => {
    const { PATCH } = await import("@/app/api/v2/wins/[winId]/route");

    const bad = await PATCH(
      new Request("http://localhost/api/v2/wins/win-1", {
        method: "PATCH",
        body: JSON.stringify({
          title: "Done",
          occurred_on: "2026-08-08",
          expected_updated_at: "t1",
          commitment_id: "c1",
        }),
      }),
      { params: { winId: "win-1" } }
    );
    expect(bad.status).toBe(400);
    expect(applyMock).not.toHaveBeenCalled();

    applyMock.mockResolvedValue({
      ok: false,
      error: "This Win changed since you opened it. Refresh and try again.",
      code: "conflict",
    });
    const conflict = await PATCH(
      new Request("http://localhost/api/v2/wins/win-1", {
        method: "PATCH",
        body: JSON.stringify({
          title: "Done",
          occurred_on: "2026-08-08",
          expected_updated_at: "stale",
          season_id: null,
        }),
      }),
      { params: Promise.resolve({ winId: "win-1" }) }
    );
    expect(conflict.status).toBe(409);
  });

  it("passes validated fields to helper and returns ok", async () => {
    applyMock.mockResolvedValue({
      ok: true,
      status: "updated",
      win_id: "win-1",
      updated_at: "2026-08-09T13:00:00.000Z",
      revision_id: "rev-1",
      user_edited_at: "2026-08-09T13:00:00.000Z",
    });
    const { PATCH } = await import("@/app/api/v2/wins/[winId]/route");
    const res = await PATCH(
      new Request("http://localhost/api/v2/wins/win-1", {
        method: "PATCH",
        body: JSON.stringify({
          title: "Done",
          details: null,
          occurred_on: "2026-08-08",
          season_id: null,
          expected_updated_at: "t1",
        }),
      }),
      { params: { winId: "win-1" } }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.revision_id).toBe("rev-1");
    expect(applyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: "user_1",
        winId: "win-1",
        title: "Done",
        expectedUpdatedAt: "t1",
      })
    );
  });

  it("401 without auth", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { PATCH } = await import("@/app/api/v2/wins/[winId]/route");
    const res = await PATCH(
      new Request("http://localhost/api/v2/wins/win-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "x", occurred_on: "2026-08-08", expected_updated_at: "t" }),
      }),
      { params: { winId: "win-1" } }
    );
    expect(res.status).toBe(401);
  });
});
