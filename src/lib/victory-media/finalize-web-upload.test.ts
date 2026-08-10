import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  VICTORY_MEDIA_BUCKET,
  VICTORY_MEDIA_SIGNED_UPLOAD_CLIENT_CONTRACT,
  VICTORY_MEDIA_TEMP_UPLOAD_EXTENSION,
} from "@/lib/victory-media/constants";
import { finalizeWebUpload } from "@/lib/victory-media/finalize-web-upload";
import { victoryMediaTempUploadPath } from "@/lib/victory-media/storage-paths";
import type {
  VictoryWinMediaDto,
  VictoryWinMediaRow,
} from "@/lib/victory-media/finalize-victory-win-media";

const USER = "user_abc123";
const OTHER = "user_other999";
const WIN = "550e8400-e29b-41d4-a716-446655440010";
const UPLOAD = "660e8400-e29b-41d4-a716-446655440001";
const MEDIA = "770e8400-e29b-41d4-a716-446655440020";

function jpegish(n = 32): Buffer {
  const buf = Buffer.alloc(n, 1);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

function mediaDto(overrides: Partial<VictoryWinMediaDto> = {}): VictoryWinMediaDto {
  const now = "2026-08-10T12:00:00.000Z";
  return {
    id: MEDIA,
    winId: WIN,
    clerkUserId: USER,
    sourceType: "web_upload",
    storageMasterPath: `${USER}/${MEDIA}/master.jpg`,
    storageCardPath: `${USER}/${MEDIA}/card.jpg`,
    mimeType: "image/jpeg",
    byteSize: 40,
    width: 100,
    height: 120,
    cardByteSize: 20,
    cardWidth: 50,
    cardHeight: 60,
    userSelectedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function mediaRow(overrides: Partial<VictoryWinMediaRow> = {}): VictoryWinMediaRow {
  const now = "2026-08-10T12:00:00.000Z";
  return {
    id: MEDIA,
    win_id: WIN,
    clerk_user_id: USER,
    source_type: "web_upload",
    source_message_sid: null,
    source_media_ordinal: null,
    twilio_media_sid: null,
    storage_master_path: `${USER}/${MEDIA}/master.jpg`,
    storage_card_path: `${USER}/${MEDIA}/card.jpg`,
    mime_type: "image/jpeg",
    byte_size: 40,
    width: 100,
    height: 120,
    card_byte_size: 20,
    card_width: 50,
    card_height: 60,
    user_selected_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("finalizeWebUpload", () => {
  const tempObjects = {
    exists: vi.fn(),
    byteSize: vi.fn(),
    remove: vi.fn(),
  };
  const normalize = vi.fn();
  const finalize = vi.fn();
  const getMediaByWinId = vi.fn();

  const expectedPath = victoryMediaTempUploadPath(
    USER,
    UPLOAD,
    VICTORY_MEDIA_TEMP_UPLOAD_EXTENSION
  );

  beforeEach(() => {
    vi.clearAllMocks();
    tempObjects.exists.mockResolvedValue(true);
    tempObjects.byteSize.mockResolvedValue(1024);
    tempObjects.remove.mockResolvedValue({ ok: true });
    getMediaByWinId.mockResolvedValue(null);
    normalize.mockResolvedValue({
      ok: true,
      master: {
        bytes: jpegish(40),
        mime: "image/jpeg",
        width: 100,
        height: 120,
        byteSize: 40,
      },
      card: {
        bytes: jpegish(20),
        mime: "image/jpeg",
        width: 50,
        height: 60,
        byteSize: 20,
      },
      source: { sniffedFormat: "jpeg", usedHeicBridge: false },
    });
    finalize.mockResolvedValue({
      ok: true,
      status: "attached",
      media: mediaDto(),
    });
  });

  it("rejects malformed winId/uploadId", async () => {
    const badWin = await finalizeWebUpload(
      { clerkUserId: USER, winId: "bad", uploadId: UPLOAD },
      { tempObjects, normalize, finalize, createMediaId: () => MEDIA }
    );
    expect(badWin).toEqual({ ok: false, code: "invalid_input" });

    const badUpload = await finalizeWebUpload(
      { clerkUserId: USER, winId: WIN, uploadId: "bad" },
      { tempObjects, normalize, finalize, createMediaId: () => MEDIA }
    );
    expect(badUpload).toEqual({ ok: false, code: "invalid_input" });
    expect(tempObjects.exists).not.toHaveBeenCalled();
  });

  it("reconstructs path from authenticated user + uploadId", async () => {
    const result = await finalizeWebUpload(
      { clerkUserId: USER, winId: WIN, uploadId: UPLOAD },
      {
        tempObjects,
        normalize,
        finalize,
        getMediaByWinId,
        createMediaId: () => MEDIA,
      }
    );
    expect(result.ok).toBe(true);
    expect(tempObjects.exists).toHaveBeenCalledWith({
      bucket: VICTORY_MEDIA_BUCKET,
      path: expectedPath,
    });
    expect(normalize).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({
          kind: "supabase_object",
          bucket: VICTORY_MEDIA_BUCKET,
          path: expectedPath,
        }),
      }),
      undefined
    );
  });

  it("cannot finalize another user's temp path (owner-scoped reconstruction)", async () => {
    const otherPath = victoryMediaTempUploadPath(
      OTHER,
      UPLOAD,
      VICTORY_MEDIA_TEMP_UPLOAD_EXTENSION
    );

    const result = await finalizeWebUpload(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        tempPath: otherPath,
      },
      { tempObjects, normalize, finalize, createMediaId: () => MEDIA }
    );
    expect(result).toEqual({ ok: false, code: "invalid_input" });
    expect(normalize).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it("rejects mismatched tempPath without using it", async () => {
    const result = await finalizeWebUpload(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        tempPath: `${USER}/temp/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.bin`,
      },
      { tempObjects, normalize, finalize, createMediaId: () => MEDIA }
    );
    expect(result).toEqual({ ok: false, code: "invalid_input" });
    expect(tempObjects.exists).not.toHaveBeenCalled();
  });

  it("first finalize succeeds and deletes temp", async () => {
    const result = await finalizeWebUpload(
      { clerkUserId: USER, winId: WIN, uploadId: UPLOAD },
      {
        tempObjects,
        normalize,
        finalize,
        getMediaByWinId,
        createMediaId: () => MEDIA,
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("attached");
    expect(result.tempCleanup).toBe("deleted");
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(tempObjects.remove).toHaveBeenCalledWith({
      bucket: VICTORY_MEDIA_BUCKET,
      paths: [expectedPath],
    });
    expect(getMediaByWinId).not.toHaveBeenCalled();
  });

  it("retry after success with temp missing returns existing web_upload", async () => {
    tempObjects.exists.mockResolvedValue(false);
    getMediaByWinId.mockResolvedValue(mediaRow());

    const result = await finalizeWebUpload(
      { clerkUserId: USER, winId: WIN, uploadId: UPLOAD },
      {
        tempObjects,
        normalize,
        finalize,
        getMediaByWinId,
        createMediaId: () => "880e8400-e29b-41d4-a716-446655440099",
      }
    );

    expect(result).toEqual({
      ok: true,
      status: "existing",
      media: mediaDto(),
      tempCleanup: "already_absent",
    });
    expect(normalize).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(tempObjects.remove).not.toHaveBeenCalled();
    expect(getMediaByWinId).toHaveBeenCalledWith(WIN);
  });

  it("existing inbound_mms on Win does not masquerade as web retry success", async () => {
    tempObjects.exists.mockResolvedValue(false);
    getMediaByWinId.mockResolvedValue(
      mediaRow({
        source_type: "inbound_mms",
        source_message_sid: "SMxxx",
        source_media_ordinal: 0,
        user_selected_at: null,
      })
    );

    const result = await finalizeWebUpload(
      { clerkUserId: USER, winId: WIN, uploadId: UPLOAD },
      { tempObjects, normalize, finalize, getMediaByWinId, createMediaId: () => MEDIA }
    );
    expect(result).toEqual({ ok: false, code: "object_missing" });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("missing temp + no existing media remains object_missing", async () => {
    tempObjects.exists.mockResolvedValue(false);
    getMediaByWinId.mockResolvedValue(null);
    const result = await finalizeWebUpload(
      { clerkUserId: USER, winId: WIN, uploadId: UPLOAD },
      { tempObjects, normalize, finalize, getMediaByWinId, createMediaId: () => MEDIA }
    );
    expect(result).toEqual({ ok: false, code: "object_missing" });
    expect(normalize).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it("another user's media on winId is not returned", async () => {
    tempObjects.exists.mockResolvedValue(false);
    getMediaByWinId.mockResolvedValue(
      mediaRow({ clerk_user_id: OTHER })
    );

    const result = await finalizeWebUpload(
      { clerkUserId: USER, winId: WIN, uploadId: UPLOAD },
      { tempObjects, normalize, finalize, getMediaByWinId, createMediaId: () => MEDIA }
    );
    expect(result).toEqual({ ok: false, code: "object_missing" });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("retry after success does not insert a second durable row", async () => {
    // Simulate: first call attaches + deletes temp.
    const first = await finalizeWebUpload(
      { clerkUserId: USER, winId: WIN, uploadId: UPLOAD },
      {
        tempObjects,
        normalize,
        finalize,
        getMediaByWinId,
        createMediaId: () => MEDIA,
      }
    );
    expect(first.ok).toBe(true);
    expect(finalize).toHaveBeenCalledTimes(1);

    // Second call: temp gone, durable web_upload present.
    tempObjects.exists.mockResolvedValue(false);
    getMediaByWinId.mockResolvedValue(mediaRow());
    finalize.mockClear();
    normalize.mockClear();

    const second = await finalizeWebUpload(
      { clerkUserId: USER, winId: WIN, uploadId: UPLOAD },
      {
        tempObjects,
        normalize,
        finalize,
        getMediaByWinId,
        createMediaId: () => "880e8400-e29b-41d4-a716-446655440099",
      }
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.status).toBe("existing");
    expect(second.media.id).toBe(MEDIA);
    expect(finalize).not.toHaveBeenCalled();
    expect(normalize).not.toHaveBeenCalled();
  });

  it("surfaces normalize failure", async () => {
    normalize.mockResolvedValue({ ok: false, code: "unsupported_format" });
    const result = await finalizeWebUpload(
      { clerkUserId: USER, winId: WIN, uploadId: UPLOAD },
      { tempObjects, normalize, finalize, createMediaId: () => MEDIA }
    );
    expect(result).toEqual({ ok: false, code: "unsupported_format" });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("HEIC normalize path uses supabase_object source (transform bridge boundary)", async () => {
    normalize.mockResolvedValue({
      ok: true,
      master: {
        bytes: jpegish(40),
        mime: "image/jpeg",
        width: 100,
        height: 120,
        byteSize: 40,
      },
      card: {
        bytes: jpegish(20),
        mime: "image/jpeg",
        width: 50,
        height: 60,
        byteSize: 20,
      },
      source: { sniffedFormat: "heic_heif", usedHeicBridge: true },
    });

    const result = await finalizeWebUpload(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        declaredMime: "image/heic",
        originalFilename: "IMG_1.HEIC",
      },
      { tempObjects, normalize, finalize, createMediaId: () => MEDIA }
    );
    expect(result.ok).toBe(true);
    expect(normalize).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({
          kind: "supabase_object",
          path: expectedPath,
          declaredMime: "image/heic",
          originalFilename: "IMG_1.HEIC",
        }),
      }),
      undefined
    );
  });

  it("temp delete failure does not turn success into failure", async () => {
    tempObjects.remove.mockResolvedValue({ ok: false });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await finalizeWebUpload(
      { clerkUserId: USER, winId: WIN, uploadId: UPLOAD },
      { tempObjects, normalize, finalize, createMediaId: () => MEDIA }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tempCleanup).toBe("failed");
    expect(result.media.id).toBe(MEDIA);
    warn.mockRestore();
  });

  it("one-photo conflict surfaces safely when temp still present", async () => {
    finalize.mockResolvedValue({ ok: false, code: "media_exists" });
    const result = await finalizeWebUpload(
      { clerkUserId: USER, winId: WIN, uploadId: UPLOAD },
      { tempObjects, normalize, finalize, createMediaId: () => MEDIA }
    );
    expect(result).toEqual({ ok: false, code: "media_exists" });
    expect(tempObjects.remove).not.toHaveBeenCalled();
  });

  it("rejects oversized temp object when size metadata available", async () => {
    tempObjects.byteSize.mockResolvedValue(12_000_001);
    const result = await finalizeWebUpload(
      { clerkUserId: USER, winId: WIN, uploadId: UPLOAD },
      { tempObjects, normalize, finalize, createMediaId: () => MEDIA }
    );
    expect(result).toEqual({ ok: false, code: "too_large" });
    expect(normalize).not.toHaveBeenCalled();
  });
});

describe("signed upload client contentType contract", () => {
  it("requires contentType = declaredMime on direct signed upload", () => {
    expect(
      VICTORY_MEDIA_SIGNED_UPLOAD_CLIENT_CONTRACT.contentTypeMustEqualDeclaredMime
    ).toBe(true);
  });
});
