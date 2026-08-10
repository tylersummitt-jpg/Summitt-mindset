import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  VICTORY_MEDIA_ALLOWED_UPLOAD_MIMES,
  VICTORY_MEDIA_BUCKET,
  VICTORY_MEDIA_MAX_UPLOAD_BYTES,
  VICTORY_MEDIA_SIGNED_UPLOAD_CLIENT_CONTRACT,
  VICTORY_MEDIA_TEMP_UPLOAD_EXTENSION,
} from "@/lib/victory-media/constants";
import { createWebUploadIntent } from "@/lib/victory-media/create-web-upload-intent";
import { victoryMediaTempUploadPath } from "@/lib/victory-media/storage-paths";

const USER = "user_2AbCdEfGhIjKlMnOpQrStUv";
const UPLOAD = "660e8400-e29b-41d4-a716-446655440001";
const WIN = "550e8400-e29b-41d4-a716-446655440000";

describe("createWebUploadIntent", () => {
  const signedUploads = {
    createSignedUploadUrl: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    signedUploads.createSignedUploadUrl.mockImplementation(
      async ({ path }: { path: string }) => ({
        signedUrl: `https://example.supabase.co/storage/v1/object/upload/sign/${VICTORY_MEDIA_BUCKET}/${path}?token=tok`,
        token: "tok-abc",
        path,
      })
    );
  });

  it("documents client must set contentType = declaredMime on signed upload", () => {
    expect(
      VICTORY_MEDIA_SIGNED_UPLOAD_CLIENT_CONTRACT.contentTypeMustEqualDeclaredMime
    ).toBe(true);
  });

  it("rejects missing declared MIME", async () => {
    const result = await createWebUploadIntent(
      { clerkUserId: USER },
      { signedUploads, createUploadId: () => UPLOAD }
    );
    expect(result).toEqual({ ok: false, code: "invalid_input" });
    expect(signedUploads.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects unsupported MIME", async () => {
    const result = await createWebUploadIntent(
      { clerkUserId: USER, declaredMime: "image/avif" },
      { signedUploads, createUploadId: () => UPLOAD }
    );
    expect(result).toEqual({ ok: false, code: "unsupported_mime" });
    expect(signedUploads.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects image/gif", async () => {
    const result = await createWebUploadIntent(
      { clerkUserId: USER, declaredMime: "image/gif" },
      { signedUploads, createUploadId: () => UPLOAD }
    );
    expect(result).toEqual({ ok: false, code: "unsupported_mime" });
  });

  it.each([...VICTORY_MEDIA_ALLOWED_UPLOAD_MIMES])(
    "allows MIME %s and issues signed upload for owner-scoped path",
    async (mime) => {
      const result = await createWebUploadIntent(
        {
          clerkUserId: USER,
          declaredMime: mime,
          originalFilename: "photo.HEIC",
        },
        { signedUploads, createUploadId: () => UPLOAD }
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const expectedPath = victoryMediaTempUploadPath(
        USER,
        UPLOAD,
        VICTORY_MEDIA_TEMP_UPLOAD_EXTENSION
      );
      expect(result.uploadId).toBe(UPLOAD);
      expect(result.path).toBe(expectedPath);
      expect(result.path).toBe(`${USER}/temp/${UPLOAD}.bin`);
      expect(result.bucket).toBe(VICTORY_MEDIA_BUCKET);
      expect(result.maxBytes).toBe(VICTORY_MEDIA_MAX_UPLOAD_BYTES);
      expect(result.allowedMimeTypes).toEqual(VICTORY_MEDIA_ALLOWED_UPLOAD_MIMES);
      expect(result.signedUrl).toContain("token=tok");
      expect(result.token).toBe("tok-abc");
      expect(signedUploads.createSignedUploadUrl).toHaveBeenCalledExactlyOnceWith({
        bucket: VICTORY_MEDIA_BUCKET,
        path: expectedPath,
      });
    }
  );

  it("does not require winId (upload may precede Win creation)", async () => {
    const result = await createWebUploadIntent(
      { clerkUserId: USER, declaredMime: "image/jpeg" },
      { signedUploads, createUploadId: () => UPLOAD }
    );
    expect(result.ok).toBe(true);
  });

  it("accepts optional winId when valid UUID", async () => {
    const result = await createWebUploadIntent(
      { clerkUserId: USER, winId: WIN, declaredMime: "image/png" },
      { signedUploads, createUploadId: () => UPLOAD }
    );
    expect(result.ok).toBe(true);
  });

  it("rejects malformed optional winId", async () => {
    const result = await createWebUploadIntent(
      { clerkUserId: USER, winId: "not-a-uuid", declaredMime: "image/png" },
      { signedUploads, createUploadId: () => UPLOAD }
    );
    expect(result).toEqual({ ok: false, code: "invalid_input" });
  });

  it("generates uploadId when not injected", async () => {
    const result = await createWebUploadIntent(
      { clerkUserId: USER, declaredMime: "image/webp" },
      { signedUploads }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.uploadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("never returns service credentials", async () => {
    const result = await createWebUploadIntent(
      { clerkUserId: USER, declaredMime: "image/heic" },
      { signedUploads, createUploadId: () => UPLOAD }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const json = JSON.stringify(result);
    expect(json.toLowerCase()).not.toContain("service_role");
    expect(json.toLowerCase()).not.toContain("supabase_service");
    expect(json).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\./); // JWT-ish
  });

  it("fails when signed upload path mismatches server path", async () => {
    signedUploads.createSignedUploadUrl.mockResolvedValue({
      signedUrl: "https://example/x",
      token: "t",
      path: "evil/other.bin",
    });
    const result = await createWebUploadIntent(
      { clerkUserId: USER, declaredMime: "image/jpeg" },
      { signedUploads, createUploadId: () => UPLOAD }
    );
    expect(result).toEqual({ ok: false, code: "signed_upload_failed" });
  });

  it("maps store errors to signed_upload_failed", async () => {
    signedUploads.createSignedUploadUrl.mockRejectedValue(new Error("boom"));
    const result = await createWebUploadIntent(
      { clerkUserId: USER, declaredMime: "image/jpeg" },
      { signedUploads, createUploadId: () => UPLOAD }
    );
    expect(result).toEqual({ ok: false, code: "signed_upload_failed" });
  });
});
