import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const upsertMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      upsert: (...args: unknown[]) => upsertMock(...args),
    }),
  },
}));

describe("POST /api/profile/update", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
    upsertMock.mockResolvedValue({ error: null });
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/profile/update", {
        method: "POST",
        body: JSON.stringify({ preferred_name: "Alex" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(401);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects identity_anchor_text with 400 and does not upsert", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/profile/update", {
        method: "POST",
        body: JSON.stringify({ identity_anchor_text: "I am becoming steadier." }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Use Edit identity in Victory Room to update your identity.");
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("still updates allowed Life Context fields", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/profile/update", {
        method: "POST",
        body: JSON.stringify({
          preferred_name: "Alex",
          responsibility: "Caregiving",
          work_challenge: "Focus",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, updated: true });
    expect(upsertMock).toHaveBeenCalledWith(
      {
        clerk_user_id: "user_1",
        preferred_name: "Alex",
        responsibility: "Caregiving",
        work_challenge: "Focus",
      },
      { onConflict: "clerk_user_id" }
    );
  });

  it("rejects identity_anchor_text via explicit guard, not allowlist", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/api/profile/update/route.ts", "utf8");
    expect(src).toContain('Object.prototype.hasOwnProperty.call(body, "identity_anchor_text")');
    const allowlist = src.match(/const ALLOWED_KEYS = \[([\s\S]*?)\] as const/)?.[1] ?? "";
    expect(allowlist).not.toContain('"identity_anchor_text"');
  });
});
