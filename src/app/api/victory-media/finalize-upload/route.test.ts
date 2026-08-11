import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const finalizeMock = vi.fn();
const hasUnresolvedMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/victory-media/finalize-web-upload", () => ({
  finalizeWebUpload: (...args: unknown[]) => finalizeMock(...args),
}));

vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  hasUnresolvedAccountDeletionRequest: (...args: unknown[]) =>
    hasUnresolvedMock(...args),
}));

const WIN = "550e8400-e29b-41d4-a716-446655440010";
const UPLOAD = "660e8400-e29b-41d4-a716-446655440001";

describe("POST /api/victory-media/finalize-upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
    hasUnresolvedMock.mockResolvedValue(false);
    finalizeMock.mockResolvedValue({
      ok: true,
      status: "attached",
      tempCleanup: "deleted",
      media: {
        id: "770e8400-e29b-41d4-a716-446655440020",
        winId: WIN,
        clerkUserId: "user_1",
        sourceType: "web_upload",
        storageMasterPath: "user_1/770e8400-e29b-41d4-a716-446655440020/master.jpg",
        storageCardPath: "user_1/770e8400-e29b-41d4-a716-446655440020/card.jpg",
        mimeType: "image/jpeg",
        byteSize: 40,
        width: 100,
        height: 120,
        cardByteSize: 20,
        cardWidth: 50,
        cardHeight: 60,
        userSelectedAt: "2026-08-10T12:00:00.000Z",
        createdAt: "2026-08-10T12:00:00.000Z",
        updatedAt: "2026-08-10T12:00:00.000Z",
      },
    });
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/victory-media/finalize-upload", {
        method: "POST",
        body: JSON.stringify({ winId: WIN, uploadId: UPLOAD }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(401);
    expect(finalizeMock).not.toHaveBeenCalled();
    expect(hasUnresolvedMock).not.toHaveBeenCalled();
  });

  it("blocks when unresolved account deletion exists", async () => {
    hasUnresolvedMock.mockResolvedValue(true);
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/victory-media/finalize-upload", {
        method: "POST",
        body: JSON.stringify({ winId: WIN, uploadId: UPLOAD }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("account_deletion_in_progress");
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("fails closed when deletion lookup throws", async () => {
    hasUnresolvedMock.mockRejectedValue(new Error("db down"));
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/victory-media/finalize-upload", {
        method: "POST",
        body: JSON.stringify({ winId: WIN, uploadId: UPLOAD }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe("deletion_lookup_failed");
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("rejects raw bytes / file body fields", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/victory-media/finalize-upload", {
        method: "POST",
        body: JSON.stringify({
          winId: WIN,
          uploadId: UPLOAD,
          bytes: "AAAA",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("rejects caller-supplied clerkUserId", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/victory-media/finalize-upload", {
        method: "POST",
        body: JSON.stringify({
          winId: WIN,
          uploadId: UPLOAD,
          clerkUserId: "user_other",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("passes authenticated user and IDs only", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/victory-media/finalize-upload", {
        method: "POST",
        body: JSON.stringify({
          winId: WIN,
          uploadId: UPLOAD,
          declaredMime: "image/heic",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(finalizeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: "user_1",
        winId: WIN,
        uploadId: UPLOAD,
        declaredMime: "image/heic",
      })
    );
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.media.id).toBeTruthy();
    expect(json.media.mimeType).toBe("image/jpeg");
    expect(json.tempCleanup).toBe("deleted");
  });

  it("surfaces media_exists as 409", async () => {
    finalizeMock.mockResolvedValue({ ok: false, code: "media_exists" });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/victory-media/finalize-upload", {
        method: "POST",
        body: JSON.stringify({ winId: WIN, uploadId: UPLOAD }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("media_exists");
  });

  it("surfaces object_missing as 404", async () => {
    finalizeMock.mockResolvedValue({ ok: false, code: "object_missing" });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/victory-media/finalize-upload", {
        method: "POST",
        body: JSON.stringify({ winId: WIN, uploadId: UPLOAD }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.code).toBe("object_missing");
  });

  it("surfaces invalid_input for malformed IDs from helper", async () => {
    finalizeMock.mockResolvedValue({ ok: false, code: "invalid_input" });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/victory-media/finalize-upload", {
        method: "POST",
        body: JSON.stringify({ winId: "bad", uploadId: "bad" }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    expect(jsonCode(await res.json())).toBe("invalid_input");
  });

  it("passes through existing retry success with tempCleanup already_absent", async () => {
    finalizeMock.mockResolvedValue({
      ok: true,
      status: "existing",
      tempCleanup: "already_absent",
      media: {
        id: "770e8400-e29b-41d4-a716-446655440020",
        winId: WIN,
        clerkUserId: "user_1",
        sourceType: "web_upload",
        storageMasterPath: "user_1/770e8400-e29b-41d4-a716-446655440020/master.jpg",
        storageCardPath: "user_1/770e8400-e29b-41d4-a716-446655440020/card.jpg",
        mimeType: "image/jpeg",
        byteSize: 40,
        width: 100,
        height: 120,
        cardByteSize: 20,
        cardWidth: 50,
        cardHeight: 60,
        userSelectedAt: "2026-08-10T12:00:00.000Z",
        createdAt: "2026-08-10T12:00:00.000Z",
        updatedAt: "2026-08-10T12:00:00.000Z",
      },
    });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/victory-media/finalize-upload", {
        method: "POST",
        body: JSON.stringify({ winId: WIN, uploadId: UPLOAD }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe("existing");
    expect(json.tempCleanup).toBe("already_absent");
    expect(json.media.sourceType).toBe("web_upload");
  });
});

function jsonCode(json: { code?: string }): string | undefined {
  return json.code;
}
