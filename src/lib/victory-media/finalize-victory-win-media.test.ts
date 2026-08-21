import { describe, expect, it, vi } from "vitest";

import {
  finalizeVictoryWinMedia,
  type FinalizeVictoryWinMediaInput,
  type VictoryMediaFinalizeDb,
  type VictoryMediaObjectStore,
  type VictoryWinMediaRow,
} from "@/lib/victory-media/finalize-victory-win-media";
import {
  victoryMediaCardPath,
  victoryMediaMasterPath,
} from "@/lib/victory-media/storage-paths";

const USER = "user_abc123";
const OTHER = "user_other";
const WIN = "550e8400-e29b-41d4-a716-446655440010";
const MEDIA = "550e8400-e29b-41d4-a716-446655440020";
const MEDIA2 = "550e8400-e29b-41d4-a716-446655440021";
const JOB = "550e8400-e29b-41d4-a716-446655440030";
const BUCKET = "victory-media";

function jpegish(n = 32, fill = 1): Buffer {
  const buf = Buffer.alloc(n, fill);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

function baseInput(
  overrides: Partial<FinalizeVictoryWinMediaInput> = {}
): FinalizeVictoryWinMediaInput {
  const masterBytes = jpegish(40);
  const cardBytes = jpegish(20);
  return {
    mediaId: MEDIA,
    winId: WIN,
    clerkUserId: USER,
    bucket: BUCKET,
    master: {
      bytes: masterBytes,
      width: 100,
      height: 120,
      byteSize: masterBytes.length,
    },
    card: {
      bytes: cardBytes,
      width: 50,
      height: 60,
      byteSize: cardBytes.length,
    },
    sourceType: "web_upload",
    userSelected: true,
    ...overrides,
  };
}

function mediaRow(overrides: Partial<VictoryWinMediaRow> = {}): VictoryWinMediaRow {
  const now = "2026-08-10T12:00:00.000Z";
  return {
    id: MEDIA.toLowerCase(),
    win_id: WIN.toLowerCase(),
    clerk_user_id: USER,
    source_type: "web_upload",
    source_message_sid: null,
    source_media_ordinal: null,
    twilio_media_sid: null,
    storage_master_path: victoryMediaMasterPath(USER, MEDIA),
    storage_card_path: victoryMediaCardPath(USER, MEDIA),
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

function mockDb(args?: {
  win?: {
    id: string;
    clerk_user_id: string;
    status: string;
    hidden_at?: string | null;
  } | null;
  byId?: VictoryWinMediaRow | null;
  byWin?: VictoryWinMediaRow | null;
  insert?: VictoryMediaFinalizeDb["insertMedia"];
}): VictoryMediaFinalizeDb {
  return {
    getWin: vi.fn(async () =>
      args && "win" in args
        ? args.win == null
          ? null
          : {
              hidden_at: null,
              ...args.win,
            }
        : { id: WIN, clerk_user_id: USER, status: "active", hidden_at: null }
    ),
    getMediaById: vi.fn(async () => args?.byId ?? null),
    getMediaByWinId: vi.fn(async () => args?.byWin ?? null),
    insertMedia:
      args?.insert ??
      vi.fn(async (row) => ({
        ok: true as const,
        row: mediaRow({
          ...row,
          created_at: "2026-08-10T12:00:00.000Z",
          updated_at: "2026-08-10T12:00:00.000Z",
        }),
      })),
    markInboundJobAttached: vi.fn(async () => {}),
  };
}

function mockObjects(args?: {
  failOnPath?: string;
  removeOk?: boolean;
}): VictoryMediaObjectStore {
  const uploaded: string[] = [];
  return {
    upload: vi.fn(async ({ path }) => {
      if (args?.failOnPath && path === args.failOnPath) {
        throw new Error("storage_upload_failed");
      }
      uploaded.push(path);
    }),
    remove: vi.fn(async () => ({ ok: args?.removeOk ?? true })),
    // test helper surface
    ...({ __uploaded: uploaded } as object),
  } as VictoryMediaObjectStore;
}

describe("finalizeVictoryWinMedia", () => {
  it("owned active Win + no media → success attach", async () => {
    const db = mockDb();
    const objects = mockObjects();
    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("attached");
    expect(result.media.id).toBe(MEDIA.toLowerCase());
    expect(result.media.mimeType).toBe("image/jpeg");
    expect(result.media.storageMasterPath).toBe(
      victoryMediaMasterPath(USER, MEDIA)
    );
    expect(objects.upload).toHaveBeenCalledTimes(2);
    expect(db.insertMedia).toHaveBeenCalledOnce();
  });

  it("wrong owner → reject", async () => {
    const db = mockDb({
      win: { id: WIN, clerk_user_id: OTHER, status: "active" },
    });
    const objects = mockObjects();
    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result).toEqual({ ok: false, code: "win_forbidden" });
    expect(objects.upload).not.toHaveBeenCalled();
    expect(db.insertMedia).not.toHaveBeenCalled();
  });

  it("missing Win → reject", async () => {
    const db = mockDb({ win: null });
    const objects = mockObjects();
    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result).toEqual({ ok: false, code: "win_not_found" });
    expect(objects.upload).not.toHaveBeenCalled();
  });

  it("hidden Win → not attachable", async () => {
    const db = mockDb({
      win: { id: WIN, clerk_user_id: USER, status: "hidden" },
    });
    const result = await finalizeVictoryWinMedia(baseInput(), {
      db,
      objects: mockObjects(),
    });
    expect(result).toEqual({ ok: false, code: "win_not_attachable" });
  });

  it("active status with hidden_at set → not attachable before Storage", async () => {
    const db = mockDb({
      win: {
        id: WIN,
        clerk_user_id: USER,
        status: "active",
        hidden_at: "2026-08-20T12:00:00.000Z",
      },
    });
    const objects = mockObjects();
    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result).toEqual({ ok: false, code: "win_not_attachable" });
    expect(objects.upload).not.toHaveBeenCalled();
    expect(db.insertMedia).not.toHaveBeenCalled();
  });

  it("Win hidden after Storage and before insert → cleanup, no insert", async () => {
    let reads = 0;
    const db = mockDb();
    vi.mocked(db.getWin).mockImplementation(async () => {
      reads += 1;
      if (reads === 1) {
        return { id: WIN, clerk_user_id: USER, status: "active", hidden_at: null };
      }
      return {
        id: WIN,
        clerk_user_id: USER,
        status: "hidden",
        hidden_at: "2026-08-20T12:01:00.000Z",
      };
    });
    const objects = mockObjects();
    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("win_not_attachable");
    expect(db.insertMedia).not.toHaveBeenCalled();
    expect(objects.upload).toHaveBeenCalledTimes(2);
    expect(objects.remove).toHaveBeenCalledWith({
      bucket: BUCKET,
      paths: [
        victoryMediaMasterPath(USER, MEDIA),
        victoryMediaCardPath(USER, MEDIA),
      ],
    });
  });

  it("upsert:false master already exists without DB row → repair, then insert", async () => {
    const db = mockDb();
    const objects = mockObjects({
      failOnPath: victoryMediaMasterPath(USER, MEDIA),
    });
    objects.exists = vi.fn(async ({ path }) => path === victoryMediaMasterPath(USER, MEDIA));
    objects.download = vi.fn(async () => jpegish(40));

    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("attached");
    expect(db.insertMedia).toHaveBeenCalledOnce();
    expect(objects.remove).not.toHaveBeenCalled();
  });

  it("upsert:false card already exists without DB row → repair, then insert", async () => {
    const db = mockDb();
    const objects = mockObjects({
      failOnPath: victoryMediaCardPath(USER, MEDIA),
    });
    objects.exists = vi.fn(async ({ path }) => path === victoryMediaCardPath(USER, MEDIA));
    objects.download = vi.fn(async () => jpegish(20));

    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("attached");
    expect(db.insertMedia).toHaveBeenCalledOnce();
    expect(objects.remove).not.toHaveBeenCalled();
  });

  it("identical leftover master and card both exist → repair both, then insert", async () => {
    const db = mockDb();
    const objects = mockObjects();
    objects.upload = vi.fn(async () => {
      throw new Error("storage_upload_failed");
    });
    objects.exists = vi.fn(async () => true);
    objects.download = vi.fn(async ({ path }) => {
      if (path === victoryMediaMasterPath(USER, MEDIA)) return jpegish(40);
      return jpegish(20);
    });

    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("attached");
    expect(db.insertMedia).toHaveBeenCalledOnce();
    expect(objects.remove).not.toHaveBeenCalled();
  });

  it("different valid JPEG at master path → fail closed, no insert, no overwrite", async () => {
    const db = mockDb();
    const objects = mockObjects({
      failOnPath: victoryMediaMasterPath(USER, MEDIA),
    });
    objects.exists = vi.fn(async () => true);
    objects.download = vi.fn(async () => jpegish(40, 9));

    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result).toEqual({ ok: false, code: "storage_upload_failed" });
    expect(db.insertMedia).not.toHaveBeenCalled();
    expect(db.markInboundJobAttached).not.toHaveBeenCalled();
    expect(objects.upload).toHaveBeenCalledTimes(1);
    expect(objects.remove).not.toHaveBeenCalled();
  });

  it("different valid JPEG at card path → fail closed, no insert, does not delete pre-existing card", async () => {
    const db = mockDb();
    const objects = mockObjects({
      failOnPath: victoryMediaCardPath(USER, MEDIA),
    });
    objects.exists = vi.fn(async ({ path }) => path === victoryMediaCardPath(USER, MEDIA));
    objects.download = vi.fn(async () => jpegish(20, 9));

    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("storage_upload_failed");
    expect(db.insertMedia).not.toHaveBeenCalled();
    expect(db.markInboundJobAttached).not.toHaveBeenCalled();
    expect(objects.remove).toHaveBeenCalledWith({
      bucket: BUCKET,
      paths: [victoryMediaMasterPath(USER, MEDIA)],
    });
    expect(objects.remove).not.toHaveBeenCalledWith(
      expect.objectContaining({
        paths: expect.arrayContaining([victoryMediaCardPath(USER, MEDIA)]),
      })
    );
  });

  it("wrong leftover master + leftover card → no insert, does not delete either object", async () => {
    const db = mockDb();
    const objects = mockObjects();
    objects.upload = vi.fn(async () => {
      throw new Error("storage_upload_failed");
    });
    objects.exists = vi.fn(async () => true);
    objects.download = vi.fn(async ({ path }) => {
      if (path === victoryMediaMasterPath(USER, MEDIA)) return jpegish(40, 9);
      return jpegish(20, 9);
    });

    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result).toEqual({ ok: false, code: "storage_upload_failed" });
    expect(db.insertMedia).not.toHaveBeenCalled();
    expect(objects.remove).not.toHaveBeenCalled();
  });

  it("correct leftover master + different leftover card → no insert, does not delete pre-existing objects", async () => {
    const db = mockDb();
    const objects = mockObjects();
    objects.upload = vi.fn(async () => {
      throw new Error("storage_upload_failed");
    });
    objects.exists = vi.fn(async () => true);
    objects.download = vi.fn(async ({ path }) => {
      if (path === victoryMediaMasterPath(USER, MEDIA)) return jpegish(40);
      return jpegish(20, 9);
    });

    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("storage_upload_failed");
    expect(db.insertMedia).not.toHaveBeenCalled();
    const removedPaths = vi
      .mocked(objects.remove)
      .mock.calls.flatMap((c) => c[0]?.paths ?? []);
    expect(removedPaths).not.toContain(victoryMediaMasterPath(USER, MEDIA));
    expect(removedPaths).not.toContain(victoryMediaCardPath(USER, MEDIA));
  });

  it("inbound_mms different valid JPEG at master is also fail-closed", async () => {
    const db = mockDb();
    const objects = mockObjects({
      failOnPath: victoryMediaMasterPath(USER, MEDIA),
    });
    objects.exists = vi.fn(async () => true);
    objects.download = vi.fn(async () => jpegish(40, 7));

    const result = await finalizeVictoryWinMedia(
      baseInput({
        sourceType: "inbound_mms",
        sourceMessageSid: "SMabc",
        sourceMediaOrdinal: 0,
        userSelected: false,
        inboundJobId: JOB,
      }),
      { db, objects }
    );
    expect(result).toEqual({ ok: false, code: "storage_upload_failed" });
    expect(db.insertMedia).not.toHaveBeenCalled();
    expect(db.markInboundJobAttached).not.toHaveBeenCalled();
  });

  it("exists but download fails → fail closed", async () => {
    const db = mockDb();
    const objects = mockObjects({
      failOnPath: victoryMediaMasterPath(USER, MEDIA),
    });
    objects.exists = vi.fn(async () => true);
    objects.download = vi.fn(async () => {
      throw new Error("storage_download_failed");
    });

    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result).toEqual({ ok: false, code: "storage_upload_failed" });
    expect(db.insertMedia).not.toHaveBeenCalled();
    expect(objects.remove).not.toHaveBeenCalled();
  });

  it("exists without download capability → fail closed", async () => {
    const db = mockDb();
    const objects = mockObjects({
      failOnPath: victoryMediaMasterPath(USER, MEDIA),
    });
    objects.exists = vi.fn(async () => true);

    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result).toEqual({ ok: false, code: "storage_upload_failed" });
    expect(db.insertMedia).not.toHaveBeenCalled();
  });

  it("storage failure without existing object is not repaired into success", async () => {
    const db = mockDb();
    const objects = mockObjects({
      failOnPath: victoryMediaMasterPath(USER, MEDIA),
    });
    objects.exists = vi.fn(async () => false);

    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result).toEqual({ ok: false, code: "storage_upload_failed" });
    expect(db.insertMedia).not.toHaveBeenCalled();
  });

  it("existing media → one-photo conflict", async () => {
    const existing = mediaRow({ id: MEDIA2.toLowerCase() });
    const db = mockDb({ byWin: existing });
    const objects = mockObjects();
    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result).toEqual({ ok: false, code: "media_exists" });
    expect(objects.upload).not.toHaveBeenCalled();
  });

  it("same mediaId idempotent retry → existing", async () => {
    const existing = mediaRow();
    const db = mockDb({ byId: existing, byWin: existing });
    const objects = mockObjects();
    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("existing");
    expect(objects.upload).not.toHaveBeenCalled();
    expect(db.insertMedia).not.toHaveBeenCalled();
  });

  it("conflicting same mediaId → reject", async () => {
    const existing = mediaRow({
      win_id: "550e8400-e29b-41d4-a716-446655440099",
    });
    const db = mockDb({ byId: existing });
    const objects = mockObjects();
    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result).toEqual({ ok: false, code: "media_id_conflict" });
    expect(objects.upload).not.toHaveBeenCalled();
  });

  it("Storage master upload fails → no DB insert", async () => {
    const db = mockDb();
    const objects = mockObjects({
      failOnPath: victoryMediaMasterPath(USER, MEDIA),
    });
    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result).toEqual({ ok: false, code: "storage_upload_failed" });
    expect(db.insertMedia).not.toHaveBeenCalled();
    expect(objects.remove).not.toHaveBeenCalled();
  });

  it("Storage card upload fails → cleanup master", async () => {
    const db = mockDb();
    const objects = mockObjects({
      failOnPath: victoryMediaCardPath(USER, MEDIA),
    });
    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("storage_upload_failed");
    expect(db.insertMedia).not.toHaveBeenCalled();
    expect(objects.remove).toHaveBeenCalledWith({
      bucket: BUCKET,
      paths: [victoryMediaMasterPath(USER, MEDIA)],
    });
  });

  it("DB insert fails after uploads → cleanup both", async () => {
    const db = mockDb({
      insert: vi.fn(async () => ({ ok: false as const, kind: "other" as const })),
    });
    const objects = mockObjects();
    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("db_insert_failed");
    expect(objects.remove).toHaveBeenCalledWith({
      bucket: BUCKET,
      paths: [
        victoryMediaMasterPath(USER, MEDIA),
        victoryMediaCardPath(USER, MEDIA),
      ],
    });
  });

  it("cleanup failure does not mask primary failure", async () => {
    const db = mockDb({
      insert: vi.fn(async () => ({ ok: false as const, kind: "other" as const })),
    });
    const objects = mockObjects({ removeOk: false });
    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result).toEqual({
      ok: false,
      code: "db_insert_failed",
      cleanupError: true,
    });
  });

  it("existing user-selected photo blocks MMS attach", async () => {
    const existing = mediaRow({
      id: MEDIA2.toLowerCase(),
      source_type: "web_upload",
      user_selected_at: "2026-08-10T11:00:00.000Z",
    });
    const db = mockDb({ byWin: existing });
    const objects = mockObjects();
    const result = await finalizeVictoryWinMedia(
      baseInput({
        mediaId: MEDIA,
        sourceType: "inbound_mms",
        sourceMessageSid: "SMabc",
        sourceMediaOrdinal: 0,
        userSelected: false,
      }),
      { db, objects }
    );
    expect(result).toEqual({ ok: false, code: "media_exists" });
    expect(objects.upload).not.toHaveBeenCalled();
  });

  it("MMS provenance unique conflict after upload → cleanup", async () => {
    const db = mockDb({
      insert: vi.fn(async () => ({
        ok: false as const,
        kind: "unique_mms" as const,
      })),
    });
    const objects = mockObjects();
    const result = await finalizeVictoryWinMedia(
      baseInput({
        sourceType: "inbound_mms",
        sourceMessageSid: "SMabc",
        sourceMediaOrdinal: 0,
        userSelected: false,
        inboundJobId: JOB,
      }),
      { db, objects }
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("mms_provenance_conflict");
    expect(objects.remove).toHaveBeenCalled();
  });

  it("does not write v2_win semantics fields", async () => {
    const db = mockDb();
    const objects = mockObjects();
    await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(Object.keys(db)).not.toContain("updateWin");
    const insertArg = vi.mocked(db.insertMedia).mock.calls[0]![0];
    expect(insertArg).not.toHaveProperty("display_title");
    expect(insertArg).not.toHaveProperty("display_body");
    expect(insertArg).not.toHaveProperty("status");
  });

  it("same mediaId storage conflict → re-read existing, no cleanup of winner", async () => {
    const existing = mediaRow();
    let mediaReads = 0;
    const db = mockDb();
    vi.mocked(db.getMediaById).mockImplementation(async () => {
      mediaReads += 1;
      // Pre-check finds nothing; post-upload-conflict re-read finds winner.
      return mediaReads === 1 ? null : existing;
    });
    const objects = mockObjects({
      failOnPath: victoryMediaMasterPath(USER, MEDIA),
    });

    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("existing");
    expect(result.media.id).toBe(MEDIA.toLowerCase());
    expect(objects.remove).not.toHaveBeenCalled();
    expect(db.insertMedia).not.toHaveBeenCalled();
    expect(mediaReads).toBeGreaterThanOrEqual(2);
  });

  it("storage failure with no durable row → original storage_upload_failed", async () => {
    const db = mockDb(); // pre-check and re-read both empty
    const objects = mockObjects({
      failOnPath: victoryMediaMasterPath(USER, MEDIA),
    });
    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result).toEqual({ ok: false, code: "storage_upload_failed" });
    expect(objects.remove).not.toHaveBeenCalled();
    expect(db.insertMedia).not.toHaveBeenCalled();
    expect(db.getMediaById).toHaveBeenCalledTimes(2); // pre-check + race re-read
  });

  it("storage failure + conflicting mediaId row → media_id_conflict, never existing", async () => {
    const conflicting = mediaRow({
      win_id: "550e8400-e29b-41d4-a716-446655440099",
      clerk_user_id: OTHER,
    });
    let mediaReads = 0;
    const db = mockDb();
    vi.mocked(db.getMediaById).mockImplementation(async () => {
      mediaReads += 1;
      return mediaReads === 1 ? null : conflicting;
    });
    const objects = mockObjects({
      failOnPath: victoryMediaMasterPath(USER, MEDIA),
    });

    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result).toEqual({ ok: false, code: "media_id_conflict" });
    expect(objects.remove).not.toHaveBeenCalled();
    expect(db.insertMedia).not.toHaveBeenCalled();
  });

  it("rejects non-JPEG master/card before any Storage upload", async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x01,
    ]);
    const jpeg = jpegish(24);
    const db = mockDb();
    const objects = mockObjects();

    const badMaster = await finalizeVictoryWinMedia(
      baseInput({
        master: { bytes: png, width: 8, height: 8, byteSize: png.length },
        card: { bytes: jpeg, width: 8, height: 8, byteSize: jpeg.length },
      }),
      { db, objects }
    );
    expect(badMaster).toEqual({ ok: false, code: "invalid_normalized_media" });

    const badCard = await finalizeVictoryWinMedia(
      baseInput({
        master: { bytes: jpeg, width: 8, height: 8, byteSize: jpeg.length },
        card: { bytes: png, width: 8, height: 8, byteSize: png.length },
      }),
      { db, objects }
    );
    expect(badCard).toEqual({ ok: false, code: "invalid_normalized_media" });

    const random = Buffer.from("not-an-image-at-all!!!!!!!!!!!!");
    const badRandom = await finalizeVictoryWinMedia(
      baseInput({
        master: {
          bytes: random,
          width: 8,
          height: 8,
          byteSize: random.length,
        },
        card: { bytes: jpeg, width: 8, height: 8, byteSize: jpeg.length },
      }),
      { db, objects }
    );
    expect(badRandom).toEqual({ ok: false, code: "invalid_normalized_media" });

    expect(objects.upload).not.toHaveBeenCalled();
    expect(db.getWin).not.toHaveBeenCalled();
    expect(db.insertMedia).not.toHaveBeenCalled();
  });

  it("card storage conflict after master upload → existing without cleanup", async () => {
    const existing = mediaRow();
    let mediaReads = 0;
    const db = mockDb();
    vi.mocked(db.getMediaById).mockImplementation(async () => {
      mediaReads += 1;
      return mediaReads === 1 ? null : existing;
    });
    const objects = mockObjects({
      failOnPath: victoryMediaCardPath(USER, MEDIA),
    });

    const result = await finalizeVictoryWinMedia(baseInput(), { db, objects });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("existing");
    expect(objects.upload).toHaveBeenCalled();
    expect(objects.remove).not.toHaveBeenCalled();
    expect(db.insertMedia).not.toHaveBeenCalled();
  });
});
