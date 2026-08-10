import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const createIntentMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/victory-media/create-web-upload-intent", () => ({
  createWebUploadIntent: (...args: unknown[]) => createIntentMock(...args),
}));

describe("POST /api/victory-media/upload-intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
    createIntentMock.mockResolvedValue({
      ok: true,
      uploadId: "660e8400-e29b-41d4-a716-446655440001",
      path: "user_1/temp/660e8400-e29b-41d4-a716-446655440001.bin",
      bucket: "victory-media",
      signedUrl: "https://example.supabase.co/sign?token=abc",
      token: "abc",
      maxBytes: 12_000_000,
      allowedMimeTypes: [
        "image/heic",
        "image/heif",
        "image/jpeg",
        "image/png",
        "image/webp",
      ],
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/victory-media/upload-intent", {
        method: "POST",
        body: JSON.stringify({ declaredMime: "image/jpeg" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(401);
    expect(createIntentMock).not.toHaveBeenCalled();
  });

  it("rejects caller-supplied path/bucket/clerkUserId", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/victory-media/upload-intent", {
        method: "POST",
        body: JSON.stringify({
          declaredMime: "image/jpeg",
          path: "evil/path.bin",
          clerkUserId: "user_other",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("invalid_input");
    expect(createIntentMock).not.toHaveBeenCalled();
  });

  it("passes authenticated clerkUserId and declared MIME", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/victory-media/upload-intent", {
        method: "POST",
        body: JSON.stringify({
          declaredMime: "image/heic",
          originalFilename: "IMG.HEIC",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(createIntentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: "user_1",
        declaredMime: "image/heic",
        originalFilename: "IMG.HEIC",
      })
    );
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.uploadId).toBeTruthy();
    expect(json.signedUrl).toBeTruthy();
    expect(json.token).toBeTruthy();
    expect(JSON.stringify(json).toLowerCase()).not.toContain("service_role");
  });

  it("surfaces unsupported_mime safely", async () => {
    createIntentMock.mockResolvedValue({ ok: false, code: "unsupported_mime" });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/victory-media/upload-intent", {
        method: "POST",
        body: JSON.stringify({ declaredMime: "image/avif" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("unsupported_mime");
    expect(json.error).not.toMatch(/stack|supabase|service/i);
  });
});
