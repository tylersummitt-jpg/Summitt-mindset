import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

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
  parseManualWinKind: (raw: unknown) =>
    raw === "goal_win" || raw === "proud_moment" ? raw : null,
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
          win_kind: "proud_moment",
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
          win_kind: "proud_moment",
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
        winKind: "proud_moment",
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
          win_kind: "goal_win",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(persistMock).toHaveBeenCalledWith(
      expect.objectContaining({
        season: { seasonId: "season-1", commitmentId: "c-owned" },
        winKind: "goal_win",
      })
    );
    const json = await res.json();
    expect(json.redirect_to).toBe("/dashboard/victory-room/seasons/season-1");
  });

  it.each([
    ["missing", { client_request_id: REQ, title: "Done", occurred_on: "2026-08-01" }],
    [
      "null",
      { client_request_id: REQ, title: "Done", occurred_on: "2026-08-01", win_kind: null },
    ],
    [
      "empty",
      { client_request_id: REQ, title: "Done", occurred_on: "2026-08-01", win_kind: "" },
    ],
    [
      "mixed",
      { client_request_id: REQ, title: "Done", occurred_on: "2026-08-01", win_kind: "mixed" },
    ],
    [
      "arbitrary",
      { client_request_id: REQ, title: "Done", occurred_on: "2026-08-01", win_kind: "trophy" },
    ],
  ] as const)("rejects %s win_kind without persisting", async (_label, payload) => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/wins/manual", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("validation");
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("accepts goal_win and ignores client source_type", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/wins/manual", {
        method: "POST",
        body: JSON.stringify({
          client_request_id: REQ,
          title: "Done",
          occurred_on: "2026-08-01",
          win_kind: "goal_win",
          source_type: "sms_inbound",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(persistMock).toHaveBeenCalledWith(
      expect.objectContaining({
        winKind: "goal_win",
        season: null,
      })
    );
    expect(persistMock.mock.calls[0]?.[0]).not.toHaveProperty("source_type");
  });

  it("route does not write accountability events", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/v2/wins/manual/route.ts"),
      "utf8"
    );
    expect(src).toContain("persistManualV2Win");
    expect(src).toContain("parseManualWinKind");
    expect(src).not.toContain("v2_commitment_event");
    expect(src).not.toContain("user_yes");
    expect(src).not.toContain("persistInboundWinsWithAccountability");
  });
});
