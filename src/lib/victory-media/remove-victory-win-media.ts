/**
 * Remove Victory Media for one owned Win.
 * Physically deletes durable master/card, hard-deletes v2_win_media,
 * and tombstones inbound MMS ingest when applicable. Never mutates v2_win.
 */

import "server-only";

import { VICTORY_MEDIA_BUCKET } from "@/lib/victory-media/constants";
import {
  victoryMediaCardPath,
  victoryMediaMasterPath,
} from "@/lib/victory-media/storage-paths";

export type RemoveVictoryWinMediaStatus = "removed" | "already_absent";

export type RemoveVictoryWinMediaErrorCode =
  | "invalid_input"
  | "not_found"
  | "media_lookup_failed"
  | "mms_tombstone_failed"
  | "invalid_storage_path"
  | "storage_remove_failed"
  | "db_delete_failed";

export type RemoveVictoryWinMediaResult =
  | { ok: true; status: RemoveVictoryWinMediaStatus }
  | { ok: false; code: RemoveVictoryWinMediaErrorCode };

type OwnedWinRow = { id: string };

type MediaRow = {
  id: string;
  win_id: string;
  clerk_user_id: string;
  source_type: string;
  source_message_sid: string | null;
  source_media_ordinal: number | null;
  storage_master_path: string;
  storage_card_path: string;
};

export type GetOwnedMediaResult =
  | { status: "found"; media: MediaRow }
  | { status: "absent" }
  | { status: "query_failed" };

export type RemoveVictoryWinMediaDb = {
  getOwnedActiveWin(args: {
    clerkUserId: string;
    winId: string;
  }): Promise<OwnedWinRow | null>;
  getOwnedMedia(args: {
    clerkUserId: string;
    winId: string;
  }): Promise<GetOwnedMediaResult>;
  tombstoneInboundJob(args: {
    clerkUserId: string;
    messageSid: string;
    mediaOrdinal: number;
    winId: string;
    tombstonedAt: string;
  }): Promise<{ ok: true } | { ok: false }>;
  deleteMediaRow(args: {
    clerkUserId: string;
    winId: string;
    mediaId: string;
  }): Promise<{ deleted: boolean }>;
};

export type RemoveVictoryWinMediaStorage = {
  remove(args: { bucket: string; paths: string[] }): Promise<{ ok: boolean }>;
};

export type RemoveVictoryWinMediaDeps = {
  db?: RemoveVictoryWinMediaDb;
  storage?: RemoveVictoryWinMediaStorage;
  nowIso?: () => string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MEDIA_SELECT =
  "id, win_id, clerk_user_id, source_type, source_message_sid, source_media_ordinal, storage_master_path, storage_card_path" as const;

function createDefaultDb(): RemoveVictoryWinMediaDb {
  return {
    async getOwnedActiveWin({ clerkUserId, winId }) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { data, error } = await supabaseServer
        .from("v2_win")
        .select("id")
        .eq("id", winId)
        .eq("clerk_user_id", clerkUserId)
        .eq("status", "active")
        .maybeSingle();
      if (error || !data?.id || typeof data.id !== "string") return null;
      return { id: data.id };
    },

    async getOwnedMedia({ clerkUserId, winId }) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { data, error } = await supabaseServer
        .from("v2_win_media")
        .select(MEDIA_SELECT)
        .eq("win_id", winId)
        .eq("clerk_user_id", clerkUserId)
        .maybeSingle();
      if (error) return { status: "query_failed" };
      if (!data?.id) return { status: "absent" };
      return { status: "found", media: data as MediaRow };
    },

    async tombstoneInboundJob({
      clerkUserId,
      messageSid,
      mediaOrdinal,
      winId,
      tombstonedAt,
    }) {
      void winId;
      const { supabaseServer } = await import("@/lib/supabase-server");
      // Primary stable ingest correlation: owner + message_sid + media_ordinal.
      // (attached_win_id is not the primary identity for this update.)
      const { data, error } = await supabaseServer
        .from("v2_inbound_media_job")
        .update({
          status: "tombstoned",
          tombstoned_at: tombstonedAt,
          resolution: "removed",
        })
        .eq("clerk_user_id", clerkUserId)
        .eq("message_sid", messageSid)
        .eq("media_ordinal", mediaOrdinal)
        .select("id");
      if (error) return { ok: false };
      if (!Array.isArray(data) || data.length === 0) return { ok: false };
      return { ok: true };
    },

    async deleteMediaRow({ clerkUserId, winId, mediaId }) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { data, error } = await supabaseServer
        .from("v2_win_media")
        .delete()
        .eq("id", mediaId)
        .eq("win_id", winId)
        .eq("clerk_user_id", clerkUserId)
        .select("id");
      if (error) return { deleted: false };
      return { deleted: Array.isArray(data) && data.length > 0 };
    },
  };
}

function createDefaultStorage(): RemoveVictoryWinMediaStorage {
  return {
    async remove({ bucket, paths }) {
      if (paths.length === 0) return { ok: true };
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { error } = await supabaseServer.storage.from(bucket).remove(paths);
      return { ok: !error };
    },
  };
}

function isMediaRow(raw: MediaRow): boolean {
  return (
    typeof raw.id === "string" &&
    UUID_RE.test(raw.id) &&
    typeof raw.win_id === "string" &&
    typeof raw.clerk_user_id === "string" &&
    typeof raw.source_type === "string" &&
    typeof raw.storage_master_path === "string" &&
    typeof raw.storage_card_path === "string"
  );
}

/**
 * Remove photo for an owned active Win. Idempotent when media already absent.
 */
export async function removeVictoryWinMediaForUser(
  args: { clerkUserId: string; winId: string },
  deps: RemoveVictoryWinMediaDeps = {}
): Promise<RemoveVictoryWinMediaResult> {
  const clerkUserId =
    typeof args.clerkUserId === "string" ? args.clerkUserId.trim() : "";
  const winId = typeof args.winId === "string" ? args.winId.trim().toLowerCase() : "";
  if (!clerkUserId || !UUID_RE.test(winId)) {
    return { ok: false, code: "invalid_input" };
  }

  const db = deps.db ?? createDefaultDb();
  const storage = deps.storage ?? createDefaultStorage();
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());

  const win = await db.getOwnedActiveWin({ clerkUserId, winId });
  if (!win) {
    return { ok: false, code: "not_found" };
  }

  const mediaLookup = await db.getOwnedMedia({ clerkUserId, winId });
  if (mediaLookup.status === "query_failed") {
    return { ok: false, code: "media_lookup_failed" };
  }
  if (mediaLookup.status === "absent") {
    return { ok: true, status: "already_absent" };
  }

  const media = mediaLookup.media;
  if (!isMediaRow(media)) {
    return { ok: false, code: "media_lookup_failed" };
  }

  if (media.clerk_user_id !== clerkUserId || media.win_id.toLowerCase() !== winId) {
    return { ok: false, code: "not_found" };
  }

  const mediaId = media.id.trim().toLowerCase();

  let expectedMaster: string;
  let expectedCard: string;
  try {
    expectedMaster = victoryMediaMasterPath(clerkUserId, mediaId);
    expectedCard = victoryMediaCardPath(clerkUserId, mediaId);
  } catch {
    return { ok: false, code: "invalid_storage_path" };
  }

  const masterPath = media.storage_master_path.trim();
  const cardPath = media.storage_card_path.trim();
  if (masterPath !== expectedMaster || cardPath !== expectedCard) {
    return { ok: false, code: "invalid_storage_path" };
  }

  if (media.source_type === "inbound_mms") {
    const sid =
      typeof media.source_message_sid === "string"
        ? media.source_message_sid.trim()
        : "";
    const ordinal = media.source_media_ordinal;
    if (
      !sid ||
      typeof ordinal !== "number" ||
      !Number.isInteger(ordinal) ||
      ordinal < 0
    ) {
      return { ok: false, code: "mms_tombstone_failed" };
    }

    const tombstone = await db.tombstoneInboundJob({
      clerkUserId,
      messageSid: sid,
      mediaOrdinal: ordinal,
      winId,
      tombstonedAt: nowIso(),
    });
    if (!tombstone.ok) {
      return { ok: false, code: "mms_tombstone_failed" };
    }
  } else if (media.source_type !== "web_upload") {
    return { ok: false, code: "invalid_input" };
  }

  const removed = await storage.remove({
    bucket: VICTORY_MEDIA_BUCKET,
    paths: [masterPath, cardPath],
  });
  if (!removed.ok) {
    return { ok: false, code: "storage_remove_failed" };
  }

  const del = await db.deleteMediaRow({
    clerkUserId,
    winId,
    mediaId,
  });
  if (!del.deleted) {
    return { ok: false, code: "db_delete_failed" };
  }

  return { ok: true, status: "removed" };
}
