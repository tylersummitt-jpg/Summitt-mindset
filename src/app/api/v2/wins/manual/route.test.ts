import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const currentUserMock = vi.fn();
const loadOwnedSeasonMock = vi.fn();
const persistMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  currentUser: () => currentUserMock(),
}));

vi.mock("@/lib/v2-win-manual-persist", () => ({
  loadOwnedSeasonForManualWin: (...args: unknown[]) => loadOwnedSeasonMock(...args),
  persistManualV2Win: (...args: unknown[]) => persistMock(...args),
}));

const REQ = "550e8400-e29b-41d4-a716-446655440000";

describe("POST /api/v2/wins/manual", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
    currentUserMock.mockResolvedValue({
      id: "user_1",
      publicMetadata: { timezone: "America/New_York" },
    });
    persistMock.mockResolvedValue({
      ok: true,
      status: "inserted",
      id: "win-1",
      idempotency_key: `win_v1:manual:user_1:${REQ}`,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/wins/manual", {
        method: "POST",
        body: JSON.stringify({
          client_request_id: REQ,
          title: "Done",
          occurred_on: "2026-08-01",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(401);
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("rejects client commitment_id without persisting", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/wins/manual", {
        method: "POST",
        body: JSON.stringify({
          client_request_id: REQ,
          title: "Done",
          occurred_on: "2026-08-01",
          commitment_id: "c-evil",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("rejects another user's / invalid season without falling back to Overall", async () => {
    loadOwnedSeasonMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/wins/manual", {
        method: "POST",
        body: JSON.stringify({
          client_request_id: REQ,
          title: "Done",
          occurred_on: "2026-08-01",
          season_id: "season-foreign",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(404);
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("Overall success persists with null season and redirects to Victory Room", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/wins/manual", {
        method: "POST",
        body: JSON.stringify({
          client_request_id: REQ,
          title: "Done",
          occurred_on: "2026-08-01",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(persistMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: "user_1",
        title: "Done",
        season: null,
      })
    );
    const json = await res.json();
    expect(json.redirect_to).toBe("/dashboard/victory-room");
    expect(json.season_id).toBeNull();
  });

  it("Season success resolves owned commitment and redirects to season detail", async () => {
    loadOwnedSeasonMock.mockResolvedValue({
      id: "season-1",
      commitment_id: "c-owned",
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/wins/manual", {
        method: "POST",
        body: JSON.stringify({
          client_request_id: REQ,
          title: "Lifted",
          occurred_on: "2026-08-01",
          season_id: "season-1",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(persistMock).toHaveBeenCalledWith(
      expect.objectContaining({
        season: { seasonId: "season-1", commitmentId: "c-owned" },
      })
    );
    const json = await res.json();
    expect(json.redirect_to).toBe("/dashboard/victory-room/seasons/season-1");
  });
});
