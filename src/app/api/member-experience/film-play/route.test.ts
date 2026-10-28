import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const currentUserMock = vi.hoisted(() => vi.fn());
const insertMock = vi.hoisted(() => vi.fn());
const maybeSingleMock = vi.hoisted(() => vi.fn());
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

import { POST } from "@/app/api/member-experience/film-play/route";

function request(body: unknown, userAgent = "Mozilla/5.0") {
  return new Request("http://localhost/api/member-experience/film-play", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": userAgent,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/member-experience/film-play", () => {
  beforeEach(() => {
    authMock.mockReset();
    currentUserMock.mockReset();
    insertMock.mockReset();
    maybeSingleMock.mockReset();
    fromMock.mockReset();
    authMock.mockResolvedValue({ userId: "user_real" });
    currentUserMock.mockResolvedValue({
      id: "user_real",
      publicMetadata: { summittSubscribed: true, timezone: "America/New_York" },
    });
    insertMock.mockResolvedValue({ error: null });
    maybeSingleMock.mockResolvedValue({ data: { id: "film-1" }, error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "film_videos") {
        return { select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }) };
      }
      if (table === "v2_event") return { insert: insertMock };
      throw new Error(`unexpected table ${table}`);
    });
  });

  it("does not write for a signed-out or unsubscribed member", async () => {
    authMock.mockResolvedValue({ userId: null });
    const signedOut = await POST(request({ filmId: "film-1" }));
    expect(signedOut.status).toBe(401);
    expect(fromMock).not.toHaveBeenCalled();

    authMock.mockResolvedValue({ userId: "user_real" });
    currentUserMock.mockResolvedValue({
      id: "user_real",
      publicMetadata: { summittSubscribed: false },
    });
    const unsubscribed = await POST(request({ filmId: "film-1" }));
    expect(unsubscribed.status).toBe(403);
    expect(insertMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown film and a client member id", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const missing = await POST(request({ filmId: "missing-film", clerkUserId: "user_evil" }));
    expect(missing.status).toBe(404);
    expect(insertMock).not.toHaveBeenCalled();

    maybeSingleMock.mockResolvedValue({ data: { id: "film-1" }, error: null });
    const recorded = await POST(
      request({ filmId: "film-1", clerkUserId: "user_evil", platform: "ios" })
    );
    expect(recorded.status).toBe(200);
    expect(insertMock.mock.calls[0][0].clerk_user_id).toBe("user_real");
    expect(insertMock.mock.calls[0][0].payload_json).toEqual({
      platform: "web",
      filmId: "film-1",
    });
    expect(JSON.stringify(insertMock.mock.calls[0][0])).not.toContain("user_evil");
  });

  it("stores the iOS shell only from the request User-Agent", async () => {
    const recorded = await POST(
      request({ filmId: "film-1" }, "Mozilla/5.0 SummittMindsetiOS")
    );
    expect(recorded.status).toBe(200);
    expect(insertMock.mock.calls[0][0].payload_json.platform).toBe("ios");
  });

  it("returns the duplicate as recorded and a database error as failure", async () => {
    insertMock.mockResolvedValueOnce({ error: { code: "23505" } });
    const duplicate = await POST(request({ filmId: "film-1" }));
    expect(duplicate.status).toBe(200);

    insertMock.mockResolvedValueOnce({ error: { code: "08006" } });
    const failed = await POST(request({ filmId: "film-1" }));
    expect(failed.status).toBe(500);
  });

  it("rejects a malformed film id before looking up the catalog", async () => {
    const response = await POST(request({ filmId: "bad id" }));
    expect(response.status).toBe(400);
    expect(fromMock).not.toHaveBeenCalled();
  });
});
