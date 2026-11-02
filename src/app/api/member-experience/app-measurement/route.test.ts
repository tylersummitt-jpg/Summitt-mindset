import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const currentUserMock = vi.hoisted(() => vi.fn());
const insertMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  currentUser: () => currentUserMock(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => fromMock(table),
  },
}));

import { POST } from "@/app/api/member-experience/app-measurement/route";

function request(body: unknown, userAgent = "Mozilla/5.0 SummittMindsetiOS") {
  return new Request("http://localhost/api/member-experience/app-measurement", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": userAgent },
    body: JSON.stringify(body),
  });
}

const ready = {
  record: "startup",
  measurementId: "11111111-2222-4333-8444-555555555555",
  surface: "victory_room",
  launchKind: "cold",
  elapsedMs: 1800,
};

describe("POST /api/member-experience/app-measurement", () => {
  beforeEach(() => {
    authMock.mockReset();
    currentUserMock.mockReset();
    insertMock.mockReset();
    fromMock.mockReset();
    authMock.mockResolvedValue({ userId: "user_real" });
    currentUserMock.mockResolvedValue({
      id: "user_real",
      publicMetadata: { summittSubscribed: true },
    });
    insertMock.mockResolvedValue({ error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "v2_event") return { insert: insertMock };
      throw new Error(`unexpected table ${table}`);
    });
  });

  it("rejects signed-out members, bad durations, and sign-in surfaces", async () => {
    authMock.mockResolvedValue({ userId: null });
    expect((await POST(request(ready))).status).toBe(401);
    expect(insertMock).not.toHaveBeenCalled();

    authMock.mockResolvedValue({ userId: "user_real" });
    expect((await POST(request({ ...ready, elapsedMs: -1 }))).status).toBe(400);
    expect((await POST(request({ ...ready, surface: "sign_in" }))).status).toBe(400);
    expect((await POST(request({ ...ready, record: "startup_failed", elapsedMs: 20 }))).status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("stores the request platform and no client-supplied identity or message", async () => {
    const response = await POST(
      request({
        ...ready,
        clerkUserId: "user_evil",
        platform: "android",
        question: "private journal",
        url: "https://summittmindset.com/dashboard/victory-room?token=secret",
      })
    );
    expect(response.status).toBe(200);
    const row = insertMock.mock.calls[0][0];
    expect(row.event_type).toBe("native_launch_measured");
    expect(row.clerk_user_id).toBe("user_real");
    expect(row.payload_json).toEqual({
      platform: "ios",
      outcome: "ready",
      launchKind: "cold",
      surface: "victory_room",
      elapsedMs: 1800,
    });
    const saved = JSON.stringify(row.payload_json);
    expect(saved).not.toContain("user_evil");
    expect(saved).not.toContain("journal");
    expect(saved).not.toContain("token");
    expect(saved).not.toContain("android");
  });

  it("records a navigation stall without a made-up duration", async () => {
    const response = await POST(
      request(
        {
          record: "navigation_failed",
          measurementId: "nav-token-1",
          surface: "programs",
          launchKind: "navigation",
        },
        "Mozilla/5.0"
      )
    );
    expect(response.status).toBe(200);
    expect(insertMock.mock.calls[0][0].payload_json).toEqual({
      platform: "web",
      outcome: "failed",
      launchKind: "navigation",
      surface: "programs",
      elapsedMs: null,
    });
  });

  it("treats a duplicate write as saved", async () => {
    insertMock.mockResolvedValueOnce({ error: { code: "23505" } });
    expect((await POST(request(ready))).status).toBe(200);
  });
});
