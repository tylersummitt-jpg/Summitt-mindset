import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const currentUserMock = vi.hoisted(() => vi.fn());
const insertMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  currentUser: () => currentUserMock(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table !== "v2_event") throw new Error(`unexpected table ${table}`);
      return { insert: insertMock };
    },
  },
}));

import { POST } from "@/app/api/member-experience/youre-in-video/route";

function request(body: unknown) {
  return new Request("http://localhost/api/member-experience/youre-in-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/member-experience/youre-in-video", () => {
  beforeEach(() => {
    authMock.mockReset();
    currentUserMock.mockReset();
    insertMock.mockReset();
    authMock.mockResolvedValue({ userId: "user_real" });
    currentUserMock.mockResolvedValue({
      id: "user_real",
      publicMetadata: { summittSubscribed: true },
    });
    insertMock.mockResolvedValue({ error: null });
  });

  it("rejects a signed-out member and an unknown event before writing", async () => {
    authMock.mockResolvedValue({ userId: null });
    const signedOut = await POST(request({ event: "youre_in_page_reached" }));
    expect(signedOut.status).toBe(401);

    authMock.mockResolvedValue({ userId: "user_real" });
    const unknown = await POST(request({ event: "youre_in_video_watched_100" }));
    expect(unknown.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("stores the session member and the fixed video id, not the browser payload", async () => {
    const response = await POST(
      request({
        event: "youre_in_video_started",
        clerkUserId: "user_evil",
        email: "member@example.com",
        phone: "555",
        vimeoVideoId: "999",
      })
    );
    expect(response.status).toBe(200);
    const row = insertMock.mock.calls[0][0];
    expect(row.clerk_user_id).toBe("user_real");
    expect(row.event_type).toBe("youre_in_video_started");
    expect(row.idempotency_key).toBe("youre_in_video:youre_in_video_started:user_real");
    expect(row.payload_json).toEqual({ vimeoVideoId: "1244458037" });
    expect(JSON.stringify(row)).not.toContain("user_evil");
    expect(JSON.stringify(row)).not.toContain("member@example.com");
    expect(JSON.stringify(row)).not.toContain("555");
  });

  it("treats a duplicate key as saved and a database error as a failed write", async () => {
    insertMock.mockResolvedValueOnce({ error: { code: "23505" } });
    const duplicate = await POST(request({ event: "youre_in_video_completed" }));
    expect(duplicate.status).toBe(200);

    insertMock.mockResolvedValueOnce({ error: { code: "08006" } });
    const failed = await POST(request({ event: "youre_in_video_completed" }));
    expect(failed.status).toBe(500);
  });
});
