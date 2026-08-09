import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

const authMock = vi.fn();
const currentUserMock = vi.fn();
const applyMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  currentUser: () => currentUserMock(),
}));

vi.mock("@/lib/v2-win-user-edit", () => ({
  applyUserVictoryWinEdit: (...args: unknown[]) => applyMock(...args),
}));

vi.mock("@/lib/v2-win-user-delete", () => ({
  deleteUserVictoryWin: (...args: unknown[]) => deleteMock(...args),
}));

describe("PATCH /api/v2/wins/[winId]", () => {
  beforeEach(() => {
    authMock.mockReset();
    currentUserMock.mockReset();
    applyMock.mockReset();
    deleteMock.mockReset();
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

describe("DELETE /api/v2/wins/[winId]", () => {
  beforeEach(() => {
    authMock.mockReset();
    currentUserMock.mockReset();
    applyMock.mockReset();
    deleteMock.mockReset();
    authMock.mockResolvedValue({ userId: "user_1" });
    currentUserMock.mockResolvedValue({
      id: "user_1",
      publicMetadata: { timezone: "UTC" },
    });
  });

  it("soft-hides via helper and returns { ok: true }", async () => {
    deleteMock.mockResolvedValue({ ok: true, win_id: "win-1" });
    const { DELETE } = await import("@/app/api/v2/wins/[winId]/route");
    const res = await DELETE(
      new Request("http://localhost/api/v2/wins/win-1", {
        method: "DELETE",
        body: JSON.stringify({ expected_updated_at: "t1" }),
      }),
      { params: { winId: "win-1" } }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteMock).toHaveBeenCalledWith({
      clerkUserId: "user_1",
      winId: "win-1",
      expectedUpdatedAt: "t1",
    });
  });

  it("rejects forbidden status/hidden fields", async () => {
    const { DELETE } = await import("@/app/api/v2/wins/[winId]/route");
    const res = await DELETE(
      new Request("http://localhost/api/v2/wins/win-1", {
        method: "DELETE",
        body: JSON.stringify({
          expected_updated_at: "t1",
          hidden_reason: "hacked",
          status: "hidden",
        }),
      }),
      { params: { winId: "win-1" } }
    );
    expect(res.status).toBe(400);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("maps conflict to 409 and not_found to 404", async () => {
    const { DELETE } = await import("@/app/api/v2/wins/[winId]/route");

    deleteMock.mockResolvedValue({
      ok: false,
      error: "This Win changed since you opened it. Refresh and try again.",
      code: "conflict",
    });
    const conflict = await DELETE(
      new Request("http://localhost/api/v2/wins/win-1", {
        method: "DELETE",
        body: JSON.stringify({ expected_updated_at: "stale" }),
      }),
      { params: Promise.resolve({ winId: "win-1" }) }
    );
    expect(conflict.status).toBe(409);
    const conflictJson = await conflict.json();
    expect(conflictJson.code).toBe("conflict");

    deleteMock.mockResolvedValue({
      ok: false,
      error: "Win not found.",
      code: "not_found",
    });
    const missing = await DELETE(
      new Request("http://localhost/api/v2/wins/win-1", {
        method: "DELETE",
        body: JSON.stringify({ expected_updated_at: "t1" }),
      }),
      { params: { winId: "win-1" } }
    );
    expect(missing.status).toBe(404);
  });

  it("401 without auth", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { DELETE } = await import("@/app/api/v2/wins/[winId]/route");
    const res = await DELETE(
      new Request("http://localhost/api/v2/wins/win-1", {
        method: "DELETE",
        body: JSON.stringify({ expected_updated_at: "t" }),
      }),
      { params: { winId: "win-1" } }
    );
    expect(res.status).toBe(401);
  });

  it("route source does not physically delete and does not call OpenAI", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/v2/wins/[winId]/route.ts"),
      "utf8"
    );
    expect(src).toContain("deleteUserVictoryWin");
    expect(src).toContain("export async function DELETE");
    expect(src).not.toContain("openai");
    expect(src).not.toContain(".from(\"v2_win\").delete");
  });
});
