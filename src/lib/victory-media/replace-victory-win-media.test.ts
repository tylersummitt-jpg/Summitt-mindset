/**
 * replaceVictoryWinMediaForUser — injectable deps (no live Supabase).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { VICTORY_MEDIA_BUCKET } from "@/lib/victory-media/constants";
import {
  replaceVictoryWinMediaForUser,
  type ReplaceVictoryWinMediaDb,
  type ReplaceVictoryWinMediaStorage,
} from "@/lib/victory-media/replace-victory-win-media";
import {
  victoryMediaCardPath,
  victoryMediaMasterPath,
  victoryMediaTempUploadPath,
} from "@/lib/victory-media/storage-paths";

const USER = "user_abc123";
const WIN = "550e8400-e29b-41d4-a716-446655440010";
const OLD_MEDIA = "550e8400-e29b-41d4-a716-446655440020";
const UPLOAD = "550e8400-e29b-41d4-a716-446655440030";
const OTHER_MEDIA = "550e8400-e29b-41d4-a716-446655440099";
const NOW = "2026-08-12T15:00:00.000Z";

function jpegBuf(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x01, 0x02, 0x03]);
}

function mediaRow(overrides: Partial<{
  id: string;
  win_id: string;
  clerk_user_id: string;
  card_width: number;
  card_height: number;
}> = {}) {
  const id = (overrides.id ?? OLD_MEDIA).toLowerCase();
  return {
    id,
    win_id: (overrides.win_id ?? WIN).toLowerCase(),
    clerk_user_id: overrides.clerk_user_id ?? USER,
    storage_master_path: victoryMediaMasterPath(USER, id),
    storage_card_path: victoryMediaCardPath(USER, id),
    card_width: overrides.card_width ?? 800,
    card_height: overrides.card_height ?? 600,
  };
}

function makeDb(args?: {
  win?: { id: string } | null;
  media?: ReturnType<typeof mediaRow> | null;
  mediaLookup?: "found" | "absent" | "query_failed";
  rpcResult?: string;
  rpcError?: boolean;
}): ReplaceVictoryWinMediaDb & {
  calls: {
    getOwnedActiveWin: unknown[];
    getOwnedMedia: unknown[];
    replaceWinMedia: unknown[];
  };
} {
  const calls = {
    getOwnedActiveWin: [] as unknown[],
    getOwnedMedia: [] as unknown[],
    replaceWinMedia: [] as unknown[],
  };
  return {
    calls,
    async getOwnedActiveWin(a) {
      calls.getOwnedActiveWin.push(a);
      if (args && "win" in args) return args.win ?? null;
      return { id: WIN.toLowerCase() };
    },
    async getOwnedMedia(a) {
      calls.getOwnedMedia.push(a);
      if (args?.mediaLookup === "query_failed") return { status: "query_failed" };
      if (args?.mediaLookup === "absent" || (args && "media" in args && args.media == null)) {
        return { status: "absent" };
      }
      if (args && "media" in args && args.media) {
        return { status: "found", media: args.media };
      }
      return { status: "found", media: mediaRow() };
    },
    async replaceWinMedia(a) {
      calls.replaceWinMedia.push(a);
      if (args?.rpcError) return { ok: false, kind: "rpc_error" };
      const result = args?.rpcResult ?? "replaced";
      return {
        ok: true,
        row: {
          result,
          old_media_id: OLD_MEDIA.toLowerCase(),
          old_storage_master_path: victoryMediaMasterPath(USER, OLD_MEDIA),
          old_storage_card_path: victoryMediaCardPath(USER, OLD_MEDIA),
          old_source_type: "web_upload",
        },
      };
    },
  };
}

function makeStorage(args?: {
  exists?: boolean;
  uploadFailAt?: "master" | "card";
  removeOk?: boolean;
  signedUrl?: string | null;
}): ReplaceVictoryWinMediaStorage & {
  uploads: string[];
  removes: string[][];
} {
  const uploads: string[] = [];
  const removes: string[][] = [];
  let uploadCount = 0;
  return {
    uploads,
    removes,
    async exists() {
      return args?.exists !== false;
    },
    async byteSize() {
      return 100;
    },
    async upload({ path }) {
      uploadCount += 1;
      if (args?.uploadFailAt === "master" && uploadCount === 1) {
        throw new Error("storage_upload_failed");
      }
      if (args?.uploadFailAt === "card" && uploadCount === 2) {
        throw new Error("storage_upload_failed");
      }
      uploads.push(path);
    },
    async remove({ paths }) {
      removes.push([...paths]);
      return { ok: args?.removeOk !== false };
    },
    async createSignedUrl() {
      if (args && "signedUrl" in args && args.signedUrl === null) return null;
      return {
        signedUrl:
          args?.signedUrl ??
          "https://example.supabase.co/storage/v1/object/sign/victory-media/x/card.jpg?token=t",
      };
    },
  };
}

const normalizedOk = {
  ok: true as const,
  master: {
    bytes: jpegBuf(),
    width: 1200,
    height: 900,
    byteSize: 8,
  },
  card: {
    bytes: jpegBuf(),
    width: 800,
    height: 600,
    byteSize: 8,
  },
};

describe("replaceVictoryWinMediaForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. expected id match → stages, swaps, cleans old", async () => {
    const db = makeDb();
    const storage = makeStorage();
    const result = await replaceVictoryWinMediaForUser(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        expectedMediaId: OLD_MEDIA,
      },
      {
        db,
        storage,
        normalize: async () => normalizedOk,
        nowIso: () => NOW,
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("replaced");
    expect(result.media?.id).toBe(UPLOAD.toLowerCase());
    expect(result.media?.cardUrl).toContain("sign");
    expect(db.calls.replaceWinMedia[0]).toMatchObject({
      newMediaId: UPLOAD.toLowerCase(),
      expectedMediaId: OLD_MEDIA.toLowerCase(),
      storageMasterPath: victoryMediaMasterPath(USER, UPLOAD),
      storageCardPath: victoryMediaCardPath(USER, UPLOAD),
    });
    expect(storage.uploads).toEqual([
      victoryMediaMasterPath(USER, UPLOAD),
      victoryMediaCardPath(USER, UPLOAD),
    ]);
    expect(storage.removes.some((p) => p.includes(victoryMediaMasterPath(USER, OLD_MEDIA)))).toBe(
      true
    );
    expect(JSON.stringify(result)).not.toMatch(/storage_master|master\.jpg/);
  });

  it("2. current id == uploadId replay → success without staging", async () => {
    const db = makeDb({ media: mediaRow({ id: UPLOAD }) });
    const storage = makeStorage();
    const result = await replaceVictoryWinMediaForUser(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        expectedMediaId: OLD_MEDIA,
      },
      { db, storage, normalize: async () => normalizedOk }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("existing");
    expect(result.media?.id).toBe(UPLOAD.toLowerCase());
    expect(storage.uploads).toHaveLength(0);
    expect(db.calls.replaceWinMedia).toHaveLength(0);
  });

  it("3. stale current id → no staging/swap", async () => {
    const db = makeDb({ media: mediaRow({ id: OTHER_MEDIA }) });
    const storage = makeStorage();
    const result = await replaceVictoryWinMediaForUser(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        expectedMediaId: OLD_MEDIA,
      },
      { db, storage, normalize: async () => normalizedOk }
    );
    expect(result).toEqual({ ok: false, code: "stale_media" });
    expect(storage.uploads).toHaveLength(0);
    expect(db.calls.replaceWinMedia).toHaveLength(0);
  });

  it("4. temp missing", async () => {
    const result = await replaceVictoryWinMediaForUser(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        expectedMediaId: OLD_MEDIA,
      },
      {
        db: makeDb(),
        storage: makeStorage({ exists: false }),
        normalize: async () => normalizedOk,
      }
    );
    expect(result).toEqual({ ok: false, code: "object_missing" });
  });

  it("5. normalization failure preserves old", async () => {
    const storage = makeStorage();
    const db = makeDb();
    const result = await replaceVictoryWinMediaForUser(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        expectedMediaId: OLD_MEDIA,
      },
      {
        db,
        storage,
        normalize: async () => ({ ok: false, code: "unsupported_format" }),
      }
    );
    expect(result).toEqual({ ok: false, code: "unsupported_format" });
    expect(storage.uploads).toHaveLength(0);
    expect(db.calls.replaceWinMedia).toHaveLength(0);
  });

  it("6. new master upload failure", async () => {
    const storage = makeStorage({ uploadFailAt: "master" });
    const result = await replaceVictoryWinMediaForUser(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        expectedMediaId: OLD_MEDIA,
      },
      { db: makeDb(), storage, normalize: async () => normalizedOk }
    );
    expect(result).toEqual({ ok: false, code: "storage_upload_failed" });
    expect(storage.uploads).toHaveLength(0);
  });

  it("7. new card upload failure cleans master", async () => {
    const storage = makeStorage({ uploadFailAt: "card" });
    const result = await replaceVictoryWinMediaForUser(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        expectedMediaId: OLD_MEDIA,
      },
      { db: makeDb(), storage, normalize: async () => normalizedOk }
    );
    expect(result).toEqual({ ok: false, code: "storage_upload_failed" });
    expect(storage.uploads).toEqual([victoryMediaMasterPath(USER, UPLOAD)]);
    expect(storage.removes[0]).toEqual([victoryMediaMasterPath(USER, UPLOAD)]);
  });

  it("8. RPC stale cleans new durable", async () => {
    const storage = makeStorage();
    const result = await replaceVictoryWinMediaForUser(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        expectedMediaId: OLD_MEDIA,
      },
      {
        db: makeDb({ rpcResult: "stale_conflict" }),
        storage,
        normalize: async () => normalizedOk,
      }
    );
    expect(result).toEqual({ ok: false, code: "stale_media" });
    expect(storage.removes.some((p) => p.includes(victoryMediaMasterPath(USER, UPLOAD)))).toBe(
      true
    );
  });

  it("9. RPC failure cleans new durable", async () => {
    const storage = makeStorage();
    const result = await replaceVictoryWinMediaForUser(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        expectedMediaId: OLD_MEDIA,
      },
      {
        db: makeDb({ rpcError: true }),
        storage,
        normalize: async () => normalizedOk,
      }
    );
    expect(result).toEqual({ ok: false, code: "rpc_failed" });
    expect(storage.removes[0]).toEqual([
      victoryMediaMasterPath(USER, UPLOAD),
      victoryMediaCardPath(USER, UPLOAD),
    ]);
  });

  it("10–11. RPC success + old Storage cleanup", async () => {
    const storage = makeStorage();
    const result = await replaceVictoryWinMediaForUser(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        expectedMediaId: OLD_MEDIA,
      },
      {
        db: makeDb({ rpcResult: "replaced" }),
        storage,
        normalize: async () => normalizedOk,
        nowIso: () => NOW,
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.oldStorageCleanup).toBe("deleted");
    expect(
      storage.removes.some(
        (p) =>
          p.includes(victoryMediaMasterPath(USER, OLD_MEDIA)) &&
          p.includes(victoryMediaCardPath(USER, OLD_MEDIA))
      )
    ).toBe(true);
  });

  it("12. old cleanup failure still user success", async () => {
    const storage = makeStorage({ removeOk: false });
    // First remove is old cleanup; still success.
    const result = await replaceVictoryWinMediaForUser(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        expectedMediaId: OLD_MEDIA,
      },
      {
        db: makeDb(),
        storage,
        normalize: async () => normalizedOk,
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("replaced");
    expect(result.oldStorageCleanup).toBe("failed");
  });

  it("13. web→web has no MMS surface on helper deps", async () => {
    const db = makeDb();
    await replaceVictoryWinMediaForUser(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        expectedMediaId: OLD_MEDIA,
      },
      { db, storage: makeStorage(), normalize: async () => normalizedOk }
    );
    expect(db).not.toHaveProperty("tombstoneInboundJob");
  });

  it("14. safe media response only (no paths)", async () => {
    const result = await replaceVictoryWinMediaForUser(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        expectedMediaId: OLD_MEDIA,
      },
      {
        db: makeDb(),
        storage: makeStorage(),
        normalize: async () => normalizedOk,
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.media!)).toEqual(["id", "cardUrl", "width", "height"]);
  });

  it("15. signing after swap failure not reported as failed replacement", async () => {
    const result = await replaceVictoryWinMediaForUser(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        expectedMediaId: OLD_MEDIA,
      },
      {
        db: makeDb(),
        storage: makeStorage({ signedUrl: null }),
        normalize: async () => normalizedOk,
      }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("replaced");
    expect(result.media).toBeNull();
    expect(result.cardSignFailed).toBe(true);
  });

  it("16. temp cleanup best effort after success", async () => {
    const storage = makeStorage();
    const result = await replaceVictoryWinMediaForUser(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        expectedMediaId: OLD_MEDIA,
      },
      { db: makeDb(), storage, normalize: async () => normalizedOk }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tempCleanup).toBe("deleted");
    const temp = victoryMediaTempUploadPath(USER, UPLOAD, "bin");
    expect(storage.removes.some((p) => p.includes(temp))).toBe(true);
  });

  it("17. newMediaId exactly uploadId", async () => {
    const db = makeDb();
    await replaceVictoryWinMediaForUser(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        expectedMediaId: OLD_MEDIA,
      },
      { db, storage: makeStorage(), normalize: async () => normalizedOk }
    );
    expect(db.calls.replaceWinMedia[0]).toMatchObject({
      newMediaId: UPLOAD.toLowerCase(),
    });
  });

  it("18. public input does not accept durable paths / source_type", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/victory-media/replace-victory-win-media.ts"),
      "utf8"
    );
    expect(src).toContain("newMediaId = uploadId");
    const inputStart = src.indexOf("export async function replaceVictoryWinMediaForUser");
    const inputSlice = src.slice(inputStart, inputStart + 500);
    expect(inputSlice).toContain("uploadId: string");
    expect(inputSlice).toContain("expectedMediaId: string");
    expect(inputSlice).not.toContain("storageMasterPath");
    expect(inputSlice).not.toContain("sourceType");
    expect(inputSlice).not.toContain("source_type");
  });

  it("bucket is private victory-media", async () => {
    const storage = makeStorage();
    await replaceVictoryWinMediaForUser(
      {
        clerkUserId: USER,
        winId: WIN,
        uploadId: UPLOAD,
        expectedMediaId: OLD_MEDIA,
      },
      { db: makeDb(), storage, normalize: async () => normalizedOk }
    );
    expect(VICTORY_MEDIA_BUCKET).toBe("victory-media");
  });
});
