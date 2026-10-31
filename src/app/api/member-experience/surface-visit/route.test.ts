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

import { POST } from "@/app/api/member-experience/surface-visit/route";

function request(body: unknown, userAgent = "Mozilla/5.0") {
  return new Request("http://localhost/api/member-experience/surface-visit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": userAgent,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/member-experience/surface-visit", () => {
  beforeEach(() => {
    authMock.mockReset();
    currentUserMock.mockReset();
    insertMock.mockReset();
    fromMock.mockReset();
    authMock.mockResolvedValue({ userId: "user_real" });
    currentUserMock.mockResolvedValue({
      id: "user_real",
      publicMetadata: { summittSubscribed: true, timezone: "America/New_York" },
    });
    insertMock.mockResolvedValue({ error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "v2_event") return { insert: insertMock };
      throw new Error(`unexpected table ${table}`);
    });
  });

  it("does not write for a signed-out or unsubscribed member", async () => {
    authMock.mockResolvedValue({ userId: null });
    const signedOut = await POST(request({ surface: "dashboard" }));
    expect(signedOut.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();

    authMock.mockResolvedValue({ userId: "user_real" });
    currentUserMock.mockResolvedValue({
      id: "user_real",
      publicMetadata: { summittSubscribed: false },
    });
    const unsubscribed = await POST(request({ surface: "dashboard" }));
    expect(unsubscribed.status).toBe(403);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown surface before writing", async () => {
    const response = await POST(request({ surface: "victory_room", question: "private" }));
    expect(response.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("stores the signed-in member and request platform, and ignores client claims", async () => {
    const recorded = await POST(
      request(
        {
          surface: "ask_pat",
          clerkUserId: "user_evil",
          platform: "android",
          question: "What should I do?",
        },
        "Mozilla/5.0 SummittMindsetiOS"
      )
    );
    expect(recorded.status).toBe(200);
    const row = insertMock.mock.calls[0][0];
    expect(row.clerk_user_id).toBe("user_real");
    expect(row.event_type).toBe("member_surface_visited");
    expect(row.source).toBe("member_experience");
    expect(row.payload_json).toEqual({ platform: "ios", surface: "ask_pat" });
    expect(row.idempotency_key).toContain(":ask_pat:ios");
    expect(JSON.stringify(row)).not.toContain("user_evil");
    expect(JSON.stringify(row)).not.toContain("What should I do");
    expect(JSON.stringify(row)).not.toContain("android");
  });

  it("returns the duplicate as recorded and a database error as failure", async () => {
    insertMock.mockResolvedValueOnce({ error: { code: "23505" } });
    const duplicate = await POST(request({ surface: "film_room" }));
    expect(duplicate.status).toBe(200);

    insertMock.mockResolvedValueOnce({ error: { code: "08006" } });
    const failed = await POST(request({ surface: "film_room" }));
    expect(failed.status).toBe(500);
  });

  it("accepts a plan-only member and a programs visit", async () => {
    currentUserMock.mockResolvedValue({
      id: "user_real",
      publicMetadata: { summittPlan: "annual", timezone: "America/Chicago" },
    });
    const recorded = await POST(request({ surface: "programs" }));
    expect(recorded.status).toBe(200);
    expect(insertMock.mock.calls[0][0].payload_json).toEqual({
      platform: "web",
      surface: "programs",
    });
  });
});
