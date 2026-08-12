import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const replaceMock = vi.fn();
const hasUnresolvedMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/victory-media/replace-victory-win-media", () => ({
  replaceVictoryWinMediaForUser: (...args: unknown[]) => replaceMock(...args),
}));

vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  hasUnresolvedAccountDeletionRequest: (...args: unknown[]) =>
    hasUnresolvedMock(...args),
}));

const WIN = "550e8400-e29b-41d4-a716-446655440010";
const MEDIA = "550e8400-e29b-41d4-a716-446655440020";
const UPLOAD = "550e8400-e29b-41d4-a716-446655440030";

function postReq(body?: unknown) {
  return new Request(`http://localhost/api/victory-media/win/${WIN}/replace`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      body ?? {
        uploadId: UPLOAD,
        expectedMediaId: MEDIA,
        declaredMime: "image/jpeg",
        originalFilename: "shot.jpg",
      }
    ),
  });
}

describe("POST /api/victory-media/win/[winId]/replace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
    hasUnresolvedMock.mockResolvedValue(false);
    replaceMock.mockResolvedValue({
      ok: true,
      status: "replaced",
      media: {
        id: UPLOAD,
        cardUrl: "https://example.com/card.jpg?token=1",
        width: 800,
        height: 600,
      },
    });
  });

  it("401 unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { POST } = await import("./route");
    const res = await POST(postReq(), { params: { winId: WIN } });
    expect(res.status).toBe(401);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("deletion gate", async () => {
    hasUnresolvedMock.mockResolvedValue(true);
    const { POST } = await import("./route");
    const res = await POST(postReq(), { params: { winId: WIN } });
    expect(res.status).toBe(409);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("rejects path/source overrides", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      postReq({
        uploadId: UPLOAD,
        expectedMediaId: MEDIA,
        storageMasterPath: "x/y/master.jpg",
      }),
      { params: { winId: WIN } }
    );
    expect(res.status).toBe(400);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("success returns safe media only", async () => {
    const { POST } = await import("./route");
    const res = await POST(postReq(), { params: { winId: WIN } });
    expect(res.status).toBe(200);
    expect(replaceMock).toHaveBeenCalledWith({
      clerkUserId: "user_1",
      winId: WIN,
      uploadId: UPLOAD,
      expectedMediaId: MEDIA,
      declaredMime: "image/jpeg",
      originalFilename: "shot.jpg",
    });
    const json = await res.json();
    expect(json).toEqual({
      ok: true,
      status: "replaced",
      media: {
        id: UPLOAD,
        cardUrl: "https://example.com/card.jpg?token=1",
        width: 800,
        height: 600,
      },
    });
    expect(JSON.stringify(json)).not.toMatch(/storage_|master\.jpg|service_role/);
  });

  it("stale_media → 409", async () => {
    replaceMock.mockResolvedValue({ ok: false, code: "stale_media" });
    const { POST } = await import("./route");
    const res = await POST(postReq(), { params: { winId: WIN } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ok: false,
      error: "This photo changed since you opened it. Refresh and try again.",
      code: "stale_media",
    });
  });

  it("success with null media (sign fail) still ok", async () => {
    replaceMock.mockResolvedValue({
      ok: true,
      status: "replaced",
      media: null,
      cardSignFailed: true,
    });
    const { POST } = await import("./route");
    const res = await POST(postReq(), { params: { winId: WIN } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.media).toBeNull();
    expect(json.cardSignFailed).toBe(true);
  });

  it("pre-swap failure keeps generic preserve-current copy", async () => {
    replaceMock.mockResolvedValue({ ok: false, code: "storage_upload_failed" });
    const { POST } = await import("./route");
    const res = await POST(postReq(), { params: { winId: WIN } });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe(
      "We couldn’t replace the photo. Your current photo is still there."
    );
  });
});
