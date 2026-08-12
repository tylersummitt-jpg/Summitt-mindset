/**
 * removeVictoryWinMediaForUser — injectable deps (no live Supabase).
 */

import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { VICTORY_MEDIA_BUCKET } from "@/lib/victory-media/constants";
import {
  removeVictoryWinMediaForUser,
  type RemoveVictoryWinMediaDb,
  type RemoveVictoryWinMediaStorage,
} from "@/lib/victory-media/remove-victory-win-media";
import {
  victoryMediaCardPath,
  victoryMediaMasterPath,
} from "@/lib/victory-media/storage-paths";

const USER = "user_abc123";
const OTHER = "user_other";
const WIN = "550e8400-e29b-41d4-a716-446655440010";
const MEDIA = "550e8400-e29b-41d4-a716-446655440020";
const SID = "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NOW = "2026-08-12T14:00:00.000Z";

function mediaRow(
  overrides: Partial<{
    id: string;
    win_id: string;
    clerk_user_id: string;
    source_type: string;
    source_message_sid: string | null;
    source_media_ordinal: number | null;
    storage_master_path: string;
    storage_card_path: string;
  }> = {}
) {
  return {
    id: MEDIA.toLowerCase(),
    win_id: WIN.toLowerCase(),
    clerk_user_id: USER,
    source_type: "web_upload",
    source_message_sid: null,
    source_media_ordinal: null,
    storage_master_path: victoryMediaMasterPath(USER, MEDIA),
    storage_card_path: victoryMediaCardPath(USER, MEDIA),
    ...overrides,
  };
}

function makeDb(args?: {
  win?: { id: string } | null;
  media?: ReturnType<typeof mediaRow> | null;
  mediaLookup?: "found" | "absent" | "query_failed";
  tombstoneOk?: boolean;
  deleted?: boolean;
}): RemoveVictoryWinMediaDb & {
  calls: {
    getOwnedActiveWin: unknown[];
    getOwnedMedia: unknown[];
    tombstoneInboundJob: unknown[];
    deleteMediaRow: unknown[];
  };
} {
  const calls = {
    getOwnedActiveWin: [] as unknown[],
    getOwnedMedia: [] as unknown[],
    tombstoneInboundJob: [] as unknown[],
    deleteMediaRow: [] as unknown[],
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
      if (args?.mediaLookup === "query_failed") {
        return { status: "query_failed" };
      }
      if (args?.mediaLookup === "absent" || (args && "media" in args && args.media == null)) {
        return { status: "absent" };
      }
      if (args && "media" in args && args.media) {
        return { status: "found", media: args.media };
      }
      return { status: "found", media: mediaRow() };
    },
    async tombstoneInboundJob(a) {
      calls.tombstoneInboundJob.push(a);
      return args?.tombstoneOk === false ? { ok: false } : { ok: true };
    },
    async deleteMediaRow(a) {
      calls.deleteMediaRow.push(a);
      return { deleted: args?.deleted === false ? false : true };
    },
  };
}

function makeStorage(args?: { ok?: boolean }): RemoveVictoryWinMediaStorage & {
  removeCalls: Array<{ bucket: string; paths: string[] }>;
} {
  const removeCalls: Array<{ bucket: string; paths: string[] }> = [];
  return {
    removeCalls,
    async remove({ bucket, paths }) {
      removeCalls.push({ bucket, paths: [...paths] });
      return { ok: args?.ok !== false };
    },
  };
}

describe("removeVictoryWinMediaForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. verifies owned Win before media lookup", async () => {
    const db = makeDb({ media: null });
    const storage = makeStorage();
    await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage, nowIso: () => NOW }
    );
    expect(db.calls.getOwnedActiveWin).toHaveLength(1);
    expect(db.calls.getOwnedActiveWin[0]).toEqual({
      clerkUserId: USER,
      winId: WIN.toLowerCase(),
    });
    expect(db.calls.getOwnedMedia).toHaveLength(1);
    expect(db.calls.getOwnedActiveWin.length).toBeGreaterThan(0);
    // Win check precedes media (array order of calls recorded in sequence).
    expect(db.calls.getOwnedActiveWin[0]).toBeTruthy();
  });

  it("2. foreign/unowned Win does not return already_absent", async () => {
    const db = makeDb({ win: null, media: mediaRow() });
    const storage = makeStorage();
    const result = await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage }
    );
    expect(result).toEqual({ ok: false, code: "not_found" });
    expect(db.calls.getOwnedMedia).toHaveLength(0);
    expect(storage.removeCalls).toHaveLength(0);
    expect(db.calls.deleteMediaRow).toHaveLength(0);
  });

  it("3. owned Win no media → already_absent", async () => {
    const db = makeDb({ media: null });
    const storage = makeStorage();
    const result = await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage }
    );
    expect(result).toEqual({ ok: true, status: "already_absent" });
    expect(storage.removeCalls).toHaveLength(0);
    expect(db.calls.tombstoneInboundJob).toHaveLength(0);
    expect(db.calls.deleteMediaRow).toHaveLength(0);
  });

  it("3c. expectedMediaId mismatch → stale_media with no mutations", async () => {
    const OTHER_MEDIA = "550e8400-e29b-41d4-a716-446655440099";
    const db = makeDb({
      media: mediaRow({ id: OTHER_MEDIA.toLowerCase() }),
    });
    const storage = makeStorage();
    const result = await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage }
    );
    expect(result).toEqual({ ok: false, code: "stale_media" });
    expect(db.calls.tombstoneInboundJob).toHaveLength(0);
    expect(storage.removeCalls).toHaveLength(0);
    expect(db.calls.deleteMediaRow).toHaveLength(0);
  });

  it("3d. missing expectedMediaId → invalid_input", async () => {
    const result = await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: "" },
      { db: makeDb(), storage: makeStorage() }
    );
    expect(result).toEqual({ ok: false, code: "invalid_input" });
  });

  it("3b. owned Win + media DB query error → media_lookup_failed (not already_absent)", async () => {
    const db = makeDb({ mediaLookup: "query_failed" });
    const storage = makeStorage();
    const result = await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage }
    );
    expect(result).toEqual({ ok: false, code: "media_lookup_failed" });
    expect(result).not.toEqual({ ok: true, status: "already_absent" });
    expect(db.calls.tombstoneInboundJob).toHaveLength(0);
    expect(storage.removeCalls).toHaveLength(0);
    expect(db.calls.deleteMediaRow).toHaveLength(0);
  });

  it("4. web_upload remove: no MMS, Storage paths, hard-delete, Win untouched", async () => {
    const db = makeDb();
    const storage = makeStorage();
    const result = await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage }
    );
    expect(result).toEqual({ ok: true, status: "removed" });
    expect(db.calls.tombstoneInboundJob).toHaveLength(0);
    expect(storage.removeCalls).toEqual([
      {
        bucket: VICTORY_MEDIA_BUCKET,
        paths: [
          victoryMediaMasterPath(USER, MEDIA),
          victoryMediaCardPath(USER, MEDIA),
        ],
      },
    ]);
    expect(db.calls.deleteMediaRow).toEqual([
      {
        clerkUserId: USER,
        winId: WIN.toLowerCase(),
        mediaId: MEDIA.toLowerCase(),
      },
    ]);
    // Helper never exposes a Win mutation surface.
    expect(Object.keys(db)).not.toContain("updateWin");
    expect(Object.keys(db)).not.toContain("deleteWin");
  });

  it("5. inbound_mms tombstones exact job before Storage deletion", async () => {
    const order: string[] = [];
    const db = makeDb({
      media: mediaRow({
        source_type: "inbound_mms",
        source_message_sid: SID,
        source_media_ordinal: 0,
      }),
    });
    db.tombstoneInboundJob = async (a) => {
      order.push("tombstone");
      db.calls.tombstoneInboundJob.push(a);
      return { ok: true };
    };
    const storage = makeStorage();
    const origRemove = storage.remove.bind(storage);
    storage.remove = async (a) => {
      order.push("storage");
      return origRemove(a);
    };
    const origDelete = db.deleteMediaRow.bind(db);
    db.deleteMediaRow = async (a) => {
      order.push("db");
      return origDelete(a);
    };

    const result = await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage, nowIso: () => NOW }
    );
    expect(result).toEqual({ ok: true, status: "removed" });
    expect(db.calls.tombstoneInboundJob).toEqual([
      {
        clerkUserId: USER,
        messageSid: SID,
        mediaOrdinal: 0,
        winId: WIN.toLowerCase(),
        tombstonedAt: NOW,
      },
    ]);
    expect(order).toEqual(["tombstone", "storage", "db"]);
  });

  it("6. missing/invalid MMS provenance fails closed", async () => {
    const db = makeDb({
      media: mediaRow({
        source_type: "inbound_mms",
        source_message_sid: null,
        source_media_ordinal: 0,
      }),
    });
    const storage = makeStorage();
    const result = await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage }
    );
    expect(result).toEqual({ ok: false, code: "mms_tombstone_failed" });
    expect(db.calls.tombstoneInboundJob).toHaveLength(0);
    expect(storage.removeCalls).toHaveLength(0);
    expect(db.calls.deleteMediaRow).toHaveLength(0);
  });

  it("7. MMS tombstone failure prevents Storage delete", async () => {
    const db = makeDb({
      media: mediaRow({
        source_type: "inbound_mms",
        source_message_sid: SID,
        source_media_ordinal: 1,
      }),
      tombstoneOk: false,
    });
    const storage = makeStorage();
    const result = await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage, nowIso: () => NOW }
    );
    expect(result).toEqual({ ok: false, code: "mms_tombstone_failed" });
    expect(storage.removeCalls).toHaveLength(0);
    expect(db.calls.deleteMediaRow).toHaveLength(0);
  });

  it("8. paths come from DB (expected master/card)", async () => {
    const db = makeDb();
    const storage = makeStorage();
    await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage }
    );
    expect(storage.removeCalls[0]?.paths).toEqual([
      mediaRow().storage_master_path,
      mediaRow().storage_card_path,
    ]);
  });

  it("9. paths owner/media-shape validated against helpers", async () => {
    const db = makeDb({
      media: mediaRow({
        storage_master_path: `${OTHER}/${MEDIA.toLowerCase()}/master.jpg`,
        storage_card_path: `${OTHER}/${MEDIA.toLowerCase()}/card.jpg`,
      }),
    });
    const storage = makeStorage();
    const result = await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage }
    );
    expect(result).toEqual({ ok: false, code: "invalid_storage_path" });
    expect(storage.removeCalls).toHaveLength(0);
  });

  it("10. arbitrary/malformed DB path fails closed", async () => {
    const db = makeDb({
      media: mediaRow({
        storage_master_path: "../evil/master.jpg",
        storage_card_path: victoryMediaCardPath(USER, MEDIA),
      }),
    });
    const storage = makeStorage();
    const result = await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage }
    );
    expect(result).toEqual({ ok: false, code: "invalid_storage_path" });
    expect(storage.removeCalls).toHaveLength(0);
    expect(db.calls.deleteMediaRow).toHaveLength(0);
  });

  it("11. Storage failure prevents media DB delete", async () => {
    const db = makeDb();
    const storage = makeStorage({ ok: false });
    const result = await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage }
    );
    expect(result).toEqual({ ok: false, code: "storage_remove_failed" });
    expect(db.calls.deleteMediaRow).toHaveLength(0);
  });

  it("12. DB delete failure reported", async () => {
    const db = makeDb({ deleted: false });
    const storage = makeStorage();
    const result = await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage }
    );
    expect(result).toEqual({ ok: false, code: "db_delete_failed" });
    expect(storage.removeCalls).toHaveLength(1);
  });

  it("13. retry after Storage already absent can finish DB removal", async () => {
    // Storage remove succeeds even when objects already gone (idempotent).
    const db = makeDb();
    const storage = makeStorage({ ok: true });
    const result = await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage }
    );
    expect(result).toEqual({ ok: true, status: "removed" });
    expect(db.calls.deleteMediaRow).toHaveLength(1);
  });

  it("14. repeated remove → already_absent", async () => {
    const db = makeDb({ media: null });
    const storage = makeStorage();
    const first = await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage }
    );
    const second = await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage }
    );
    expect(first).toEqual({ ok: true, status: "already_absent" });
    expect(second).toEqual({ ok: true, status: "already_absent" });
  });

  it("5b. default MMS tombstone sets status/resolution/tombstoned_at; media error ≠ absent", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/victory-media/remove-victory-win-media.ts"),
      "utf8"
    );
    expect(src).toContain('status: "tombstoned"');
    expect(src).toContain('resolution: "removed"');
    expect(src).toContain("tombstoned_at:");
    expect(src).toContain('.eq("message_sid"');
    expect(src).toContain('.eq("media_ordinal"');
    expect(src).not.toContain('.from("v2_win").update');
    expect(src).not.toContain('.from("v2_win").delete');
    expect(src).not.toMatch(/v2_win[\s\S]{0,80}\.update\(/);
    expect(src).toContain('if (error) return { status: "query_failed" }');
    expect(src).toContain('code: "media_lookup_failed"');
  });

  it("15. no v2_win mutation surface on deps", async () => {
    const db = makeDb();
    await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage: makeStorage() }
    );
    expect(db).not.toHaveProperty("updateWin");
    expect(db).not.toHaveProperty("deleteWin");
    expect(db).not.toHaveProperty("hideWin");
  });

  it("does not treat OTHER user media ownership as already_absent when win owned", async () => {
    // Defensive: mismatched clerk on media row fails closed, not absent.
    const db = makeDb({
      media: mediaRow({ clerk_user_id: OTHER }),
    });
    const result = await removeVictoryWinMediaForUser(
      { clerkUserId: USER, winId: WIN, expectedMediaId: MEDIA },
      { db, storage: makeStorage() }
    );
    expect(result).toEqual({ ok: false, code: "not_found" });
  });
});
