/**
 * Victory Media — Replace Photo for an owned Win (server-only).
 * Stages new durable objects, atomically swaps via v2_replace_win_media,
 * then cleans old Storage. newMediaId = uploadId for idempotency.
 */

import "server-only";

import {
  VICTORY_MEDIA_BUCKET,
  VICTORY_MEDIA_MAX_UPLOAD_BYTES,
  VICTORY_MEDIA_SIGNED_READ_TTL_SECONDS,
  VICTORY_MEDIA_TEMP_UPLOAD_EXTENSION,
} from "@/lib/victory-media/constants";
import { normalizeVictoryImage } from "@/lib/victory-media/normalize-victory-image";
import type {
  NormalizeVictoryImageDeps,
  VictoryMediaNormalizeErrorCode,
} from "@/lib/victory-media/image-types";
import {
  victoryMediaCardPath,
  victoryMediaMasterPath,
  victoryMediaTempUploadPath,
} from "@/lib/victory-media/storage-paths";

export type ReplaceVictoryWinMediaErrorCode =
  | "invalid_input"
  | "not_found"
  | "media_lookup_failed"
  | "stale_media"
  | "no_media"
  | "object_missing"
  | "too_large"
  | "storage_upload_failed"
  | "rpc_failed"
  | "invalid_storage_path"
  | VictoryMediaNormalizeErrorCode;

export type ReplaceVictoryWinMediaPublicMedia = {
  id: string;
  cardUrl: string;
  width: number;
  height: number;
};

export type ReplaceVictoryWinMediaSuccess = {
  ok: true;
  status: "replaced" | "existing";
  /** Null only when swap succeeded but card signing failed. */
  media: ReplaceVictoryWinMediaPublicMedia | null;
  /** True when DB swap succeeded but signed card URL could not be issued. */
  cardSignFailed?: boolean;
  oldStorageCleanup?: "deleted" | "failed" | "skipped";
  tempCleanup?: "deleted" | "failed" | "already_absent" | "skipped";
};

export type ReplaceVictoryWinMediaResult =
  | ReplaceVictoryWinMediaSuccess
  | { ok: false; code: ReplaceVictoryWinMediaErrorCode };

type OwnedWinRow = { id: string };

type MediaRow = {
  id: string;
  win_id: string;
  clerk_user_id: string;
  storage_master_path: string;
  storage_card_path: string;
  card_width: number;
  card_height: number;
};

export type ReplaceRpcResultRow = {
  result: string;
  old_media_id: string | null;
  old_storage_master_path: string | null;
  old_storage_card_path: string | null;
  old_source_type: string | null;
};

export type ReplaceVictoryWinMediaDb = {
  getOwnedActiveWin(args: {
    clerkUserId: string;
    winId: string;
  }): Promise<OwnedWinRow | null>;
  getOwnedMedia(args: {
    clerkUserId: string;
    winId: string;
  }): Promise<
    | { status: "found"; media: MediaRow }
    | { status: "absent" }
    | { status: "query_failed" }
  >;
  replaceWinMedia(args: {
    clerkUserId: string;
    winId: string;
    expectedMediaId: string;
    newMediaId: string;
    storageMasterPath: string;
    storageCardPath: string;
    byteSize: number;
    width: number;
    height: number;
    cardByteSize: number;
    cardWidth: number;
    cardHeight: number;
    mimeType: "image/jpeg";
    userSelectedAt: string;
    now: string;
  }): Promise<
    | { ok: true; row: ReplaceRpcResultRow }
    | { ok: false; kind: "rpc_error" }
  >;
};

export type ReplaceVictoryWinMediaStorage = {
  exists(args: { bucket: string; path: string }): Promise<boolean>;
  byteSize?(args: {
    bucket: string;
    path: string;
  }): Promise<number | null>;
  upload(args: {
    bucket: string;
    path: string;
    bytes: Buffer;
    contentType: string;
  }): Promise<void>;
  remove(args: { bucket: string; paths: string[] }): Promise<{ ok: boolean }>;
  createSignedUrl(args: {
    bucket: string;
    path: string;
    expiresIn: number;
  }): Promise<{ signedUrl: string } | null>;
};

export type ReplaceVictoryWinMediaDeps = {
  db?: ReplaceVictoryWinMediaDb;
  storage?: ReplaceVictoryWinMediaStorage;
  normalize?: typeof normalizeVictoryImage;
  normalizeDeps?: NormalizeVictoryImageDeps;
  nowIso?: () => string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MEDIA_SELECT =
  "id, win_id, clerk_user_id, storage_master_path, storage_card_path, card_width, card_height" as const;

function createDefaultDb(): ReplaceVictoryWinMediaDb {
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

    async replaceWinMedia(args) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { data, error } = await supabaseServer.rpc("v2_replace_win_media", {
        p_clerk_user_id: args.clerkUserId,
        p_win_id: args.winId,
        p_expected_media_id: args.expectedMediaId,
        p_new_media_id: args.newMediaId,
        p_storage_master_path: args.storageMasterPath,
        p_storage_card_path: args.storageCardPath,
        p_byte_size: args.byteSize,
        p_width: args.width,
        p_height: args.height,
        p_card_byte_size: args.cardByteSize,
        p_card_width: args.cardWidth,
        p_card_height: args.cardHeight,
        p_mime_type: args.mimeType,
        p_user_selected_at: args.userSelectedAt,
        p_now: args.now,
      });
      if (error) return { ok: false, kind: "rpc_error" };
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof (row as ReplaceRpcResultRow).result !== "string") {
        return { ok: false, kind: "rpc_error" };
      }
      return { ok: true, row: row as ReplaceRpcResultRow };
    },
  };
}

function createDefaultStorage(): ReplaceVictoryWinMediaStorage {
  return {
    async exists({ bucket, path }) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { data, error } = await supabaseServer.storage
        .from(bucket)
        .exists(path);
      if (error) return false;
      return data === true;
    },
    async byteSize({ bucket, path }) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { data, error } = await supabaseServer.storage
        .from(bucket)
        .info(path);
      if (error || !data) return null;
      const size =
        typeof (data as { size?: unknown }).size === "number"
          ? (data as { size: number }).size
          : null;
      return size;
    },
    async upload({ bucket, path, bytes, contentType }) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { error } = await supabaseServer.storage.from(bucket).upload(path, bytes, {
        contentType,
        upsert: false,
      });
      if (error) throw new Error("storage_upload_failed");
    },
    async remove({ bucket, paths }) {
      if (paths.length === 0) return { ok: true };
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { error } = await supabaseServer.storage.from(bucket).remove(paths);
      return { ok: !error };
    },
    async createSignedUrl({ bucket, path, expiresIn }) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { data, error } = await supabaseServer.storage
        .from(bucket)
        .createSignedUrl(path, expiresIn);
      if (error || !data?.signedUrl) return null;
      return { signedUrl: data.signedUrl };
    },
  };
}

async function signCardMedia(args: {
  storage: ReplaceVictoryWinMediaStorage;
  clerkUserId: string;
  mediaId: string;
  width: number;
  height: number;
}): Promise<ReplaceVictoryWinMediaPublicMedia | null> {
  let cardPath: string;
  try {
    cardPath = victoryMediaCardPath(args.clerkUserId, args.mediaId);
  } catch {
    return null;
  }
  const signed = await args.storage.createSignedUrl({
    bucket: VICTORY_MEDIA_BUCKET,
    path: cardPath,
    expiresIn: VICTORY_MEDIA_SIGNED_READ_TTL_SECONDS,
  });
  if (!signed?.signedUrl) return null;
  return {
    id: args.mediaId,
    cardUrl: signed.signedUrl,
    width: args.width,
    height: args.height,
  };
}

function validateOldPaths(args: {
  clerkUserId: string;
  oldMediaId: string;
  masterPath: string;
  cardPath: string;
}): boolean {
  try {
    const expectedMaster = victoryMediaMasterPath(
      args.clerkUserId,
      args.oldMediaId
    );
    const expectedCard = victoryMediaCardPath(args.clerkUserId, args.oldMediaId);
    return (
      args.masterPath === expectedMaster && args.cardPath === expectedCard
    );
  } catch {
    return false;
  }
}

/**
 * Replace photo for an owned active Win.
 * newMediaId is always the server-issued uploadId.
 */
export async function replaceVictoryWinMediaForUser(
  args: {
    clerkUserId: string;
    winId: string;
    uploadId: string;
    expectedMediaId: string;
    declaredMime?: string | null;
    originalFilename?: string | null;
  },
  deps: ReplaceVictoryWinMediaDeps = {}
): Promise<ReplaceVictoryWinMediaResult> {
  const clerkUserId =
    typeof args.clerkUserId === "string" ? args.clerkUserId.trim() : "";
  const winId =
    typeof args.winId === "string" ? args.winId.trim().toLowerCase() : "";
  const uploadId =
    typeof args.uploadId === "string" ? args.uploadId.trim().toLowerCase() : "";
  const expectedMediaId =
    typeof args.expectedMediaId === "string"
      ? args.expectedMediaId.trim().toLowerCase()
      : "";

  if (
    !clerkUserId ||
    !UUID_RE.test(winId) ||
    !UUID_RE.test(uploadId) ||
    !UUID_RE.test(expectedMediaId)
  ) {
    return { ok: false, code: "invalid_input" };
  }

  // newMediaId = uploadId (locked idempotency strategy).
  const newMediaId = uploadId;
  if (newMediaId === expectedMediaId) {
    return { ok: false, code: "invalid_input" };
  }

  const db = deps.db ?? createDefaultDb();
  const storage = deps.storage ?? createDefaultStorage();
  const normalizeFn = deps.normalize ?? normalizeVictoryImage;
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
    return { ok: false, code: "no_media" };
  }

  const current = mediaLookup.media;
  const currentId = current.id.trim().toLowerCase();
  if (
    current.clerk_user_id !== clerkUserId ||
    current.win_id.toLowerCase() !== winId
  ) {
    return { ok: false, code: "not_found" };
  }

  // Lost-response replay: this uploadId is already the canonical media.
  if (currentId === newMediaId) {
    const media = await signCardMedia({
      storage,
      clerkUserId,
      mediaId: newMediaId,
      width: current.card_width,
      height: current.card_height,
    });
    return {
      ok: true,
      status: "existing",
      media,
      cardSignFailed: media == null,
      oldStorageCleanup: "skipped",
      tempCleanup: "already_absent",
    };
  }

  if (currentId !== expectedMediaId) {
    return { ok: false, code: "stale_media" };
  }

  let tempPath: string;
  let masterPath: string;
  let cardPath: string;
  try {
    tempPath = victoryMediaTempUploadPath(
      clerkUserId,
      uploadId,
      VICTORY_MEDIA_TEMP_UPLOAD_EXTENSION
    );
    masterPath = victoryMediaMasterPath(clerkUserId, newMediaId);
    cardPath = victoryMediaCardPath(clerkUserId, newMediaId);
  } catch {
    return { ok: false, code: "invalid_input" };
  }

  const exists = await storage.exists({
    bucket: VICTORY_MEDIA_BUCKET,
    path: tempPath,
  });
  if (!exists) {
    return { ok: false, code: "object_missing" };
  }

  if (storage.byteSize) {
    const size = await storage.byteSize({
      bucket: VICTORY_MEDIA_BUCKET,
      path: tempPath,
    });
    if (size != null && size > VICTORY_MEDIA_MAX_UPLOAD_BYTES) {
      return { ok: false, code: "too_large" };
    }
  }

  const normalized = await normalizeFn(
    {
      source: {
        kind: "supabase_object",
        bucket: VICTORY_MEDIA_BUCKET,
        path: tempPath,
        declaredMime: args.declaredMime ?? null,
        originalFilename: args.originalFilename ?? null,
      },
      maxIncomingBytes: VICTORY_MEDIA_MAX_UPLOAD_BYTES,
    },
    deps.normalizeDeps
  );
  if (!normalized.ok) {
    return { ok: false, code: normalized.code };
  }

  const uploaded: string[] = [];
  try {
    await storage.upload({
      bucket: VICTORY_MEDIA_BUCKET,
      path: masterPath,
      bytes: normalized.master.bytes,
      contentType: "image/jpeg",
    });
    uploaded.push(masterPath);
  } catch {
    return { ok: false, code: "storage_upload_failed" };
  }

  try {
    await storage.upload({
      bucket: VICTORY_MEDIA_BUCKET,
      path: cardPath,
      bytes: normalized.card.bytes,
      contentType: "image/jpeg",
    });
    uploaded.push(cardPath);
  } catch {
    await storage.remove({ bucket: VICTORY_MEDIA_BUCKET, paths: uploaded });
    return { ok: false, code: "storage_upload_failed" };
  }

  const now = nowIso();
  const rpc = await db.replaceWinMedia({
    clerkUserId,
    winId,
    expectedMediaId,
    newMediaId,
    storageMasterPath: masterPath,
    storageCardPath: cardPath,
    byteSize: normalized.master.byteSize,
    width: normalized.master.width,
    height: normalized.master.height,
    cardByteSize: normalized.card.byteSize,
    cardWidth: normalized.card.width,
    cardHeight: normalized.card.height,
    mimeType: "image/jpeg",
    userSelectedAt: now,
    now,
  });

  if (!rpc.ok) {
    await storage.remove({ bucket: VICTORY_MEDIA_BUCKET, paths: uploaded });
    return { ok: false, code: "rpc_failed" };
  }

  const rpcResult = rpc.row.result.trim().toLowerCase();

  if (rpcResult === "existing") {
    // Canonical already this uploadId (race with concurrent same attempt).
    const media = await signCardMedia({
      storage,
      clerkUserId,
      mediaId: newMediaId,
      width: normalized.card.width,
      height: normalized.card.height,
    });
    let tempCleanup: ReplaceVictoryWinMediaSuccess["tempCleanup"] = "deleted";
    try {
      const removed = await storage.remove({
        bucket: VICTORY_MEDIA_BUCKET,
        paths: [tempPath],
      });
      if (!removed.ok) tempCleanup = "failed";
    } catch {
      tempCleanup = "failed";
    }
    return {
      ok: true,
      status: "existing",
      media,
      cardSignFailed: media == null,
      oldStorageCleanup: "skipped",
      tempCleanup,
    };
  }

  if (rpcResult === "stale_conflict") {
    await storage.remove({ bucket: VICTORY_MEDIA_BUCKET, paths: uploaded });
    return { ok: false, code: "stale_media" };
  }
  if (rpcResult === "not_found") {
    await storage.remove({ bucket: VICTORY_MEDIA_BUCKET, paths: uploaded });
    return { ok: false, code: "not_found" };
  }
  if (rpcResult === "no_media") {
    await storage.remove({ bucket: VICTORY_MEDIA_BUCKET, paths: uploaded });
    return { ok: false, code: "no_media" };
  }
  if (rpcResult !== "replaced") {
    await storage.remove({ bucket: VICTORY_MEDIA_BUCKET, paths: uploaded });
    return { ok: false, code: "rpc_failed" };
  }

  // Post-swap: best-effort old Storage cleanup. Never roll back swap.
  let oldStorageCleanup: ReplaceVictoryWinMediaSuccess["oldStorageCleanup"] =
    "deleted";
  const oldMediaId =
    typeof rpc.row.old_media_id === "string"
      ? rpc.row.old_media_id.trim().toLowerCase()
      : "";
  const oldMaster =
    typeof rpc.row.old_storage_master_path === "string"
      ? rpc.row.old_storage_master_path.trim()
      : "";
  const oldCard =
    typeof rpc.row.old_storage_card_path === "string"
      ? rpc.row.old_storage_card_path.trim()
      : "";

  if (
    UUID_RE.test(oldMediaId) &&
    oldMaster &&
    oldCard &&
    validateOldPaths({
      clerkUserId,
      oldMediaId,
      masterPath: oldMaster,
      cardPath: oldCard,
    })
  ) {
    try {
      const removed = await storage.remove({
        bucket: VICTORY_MEDIA_BUCKET,
        paths: [oldMaster, oldCard],
      });
      if (!removed.ok) {
        oldStorageCleanup = "failed";
        console.warn(
          "[victory-media/replace] old storage cleanup failed",
          oldMediaId.slice(0, 8)
        );
      }
    } catch {
      oldStorageCleanup = "failed";
      console.warn(
        "[victory-media/replace] old storage cleanup threw",
        oldMediaId.slice(0, 8)
      );
    }
  } else {
    oldStorageCleanup = "failed";
    console.warn("[victory-media/replace] old path validation failed");
  }

  let tempCleanup: ReplaceVictoryWinMediaSuccess["tempCleanup"] = "deleted";
  try {
    const removed = await storage.remove({
      bucket: VICTORY_MEDIA_BUCKET,
      paths: [tempPath],
    });
    if (!removed.ok) tempCleanup = "failed";
  } catch {
    tempCleanup = "failed";
  }

  const media = await signCardMedia({
    storage,
    clerkUserId,
    mediaId: newMediaId,
    width: normalized.card.width,
    height: normalized.card.height,
  });

  return {
    ok: true,
    status: "replaced",
    media,
    cardSignFailed: media == null,
    oldStorageCleanup,
    tempCleanup,
  };
}
