/**
 * Victory Media — finalize authenticated web upload (server-only).
 * Reconstructs owner-scoped temp path; does not accept caller-chosen paths.
 */

import "server-only";

import { randomUUID } from "crypto";

import {
  VICTORY_MEDIA_BUCKET,
  VICTORY_MEDIA_MAX_UPLOAD_BYTES,
  VICTORY_MEDIA_TEMP_UPLOAD_EXTENSION,
} from "@/lib/victory-media/constants";
import {
  finalizeVictoryWinMedia,
  type FinalizeVictoryWinMediaDeps,
  type FinalizeVictoryWinMediaErrorCode,
  type FinalizeVictoryWinMediaResult,
  type VictoryWinMediaDto,
  type VictoryWinMediaRow,
} from "@/lib/victory-media/finalize-victory-win-media";
import { normalizeVictoryImage } from "@/lib/victory-media/normalize-victory-image";
import type {
  NormalizeVictoryImageDeps,
  VictoryMediaNormalizeErrorCode,
} from "@/lib/victory-media/image-types";
import { victoryMediaTempUploadPath } from "@/lib/victory-media/storage-paths";

export type FinalizeWebUploadErrorCode =
  | "invalid_input"
  | "object_missing"
  | "too_large"
  | FinalizeVictoryWinMediaErrorCode
  | VictoryMediaNormalizeErrorCode;

export type FinalizeWebUploadInput = {
  clerkUserId: string;
  winId: string;
  uploadId: string;
  /** Ignored if provided — path is always reconstructed server-side. */
  tempPath?: string | null;
  originalFilename?: string | null;
  declaredMime?: string | null;
};

export type FinalizeWebUploadSuccess = {
  ok: true;
  status: "attached" | "existing";
  media: VictoryWinMediaDto;
  /**
   * Best-effort temp cleanup.
   * `already_absent` = idempotent retry after prior success deleted the temp.
   */
  tempCleanup: "deleted" | "failed" | "already_absent";
};

export type FinalizeWebUploadResult =
  | FinalizeWebUploadSuccess
  | { ok: false; code: FinalizeWebUploadErrorCode };

export type VictoryMediaTempObjectProbe = {
  exists(args: { bucket: string; path: string }): Promise<boolean>;
  /** Optional size probe when Storage metadata is available. */
  byteSize?(args: {
    bucket: string;
    path: string;
  }): Promise<number | null>;
  remove(args: {
    bucket: string;
    paths: string[];
  }): Promise<{ ok: boolean }>;
};

export type FinalizeWebUploadDeps = {
  tempObjects?: VictoryMediaTempObjectProbe;
  normalize?: typeof normalizeVictoryImage;
  finalize?: typeof finalizeVictoryWinMedia;
  normalizeDeps?: NormalizeVictoryImageDeps;
  finalizeDeps?: FinalizeVictoryWinMediaDeps;
  createMediaId?: () => string;
  /**
   * Lookup durable media for a Win (retry / lost-response path).
   * Defaults to service-role read of v2_win_media by win_id.
   */
  getMediaByWinId?: (winId: string) => Promise<VictoryWinMediaRow | null>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createDefaultTempProbe(): VictoryMediaTempObjectProbe {
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
    async remove({ bucket, paths }) {
      if (paths.length === 0) return { ok: true };
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { error } = await supabaseServer.storage.from(bucket).remove(paths);
      return { ok: !error };
    },
  };
}

function createDefaultGetMediaByWinId(): (
  winId: string
) => Promise<VictoryWinMediaRow | null> {
  return async (winId) => {
    const { supabaseServer } = await import("@/lib/supabase-server");
    const { data, error } = await supabaseServer
      .from("v2_win_media")
      .select("*")
      .eq("win_id", winId)
      .maybeSingle();
    if (error || !data?.id) return null;
    return data as VictoryWinMediaRow;
  };
}

function mapMediaRow(row: VictoryWinMediaRow): VictoryWinMediaDto {
  return {
    id: row.id,
    winId: row.win_id,
    clerkUserId: row.clerk_user_id,
    sourceType: row.source_type,
    storageMasterPath: row.storage_master_path,
    storageCardPath: row.storage_card_path,
    mimeType: "image/jpeg",
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    cardByteSize: row.card_byte_size,
    cardWidth: row.card_width,
    cardHeight: row.card_height,
    userSelectedAt: row.user_selected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Lost-response / retry: if temp is gone but this exact Win already has
 * owned web_upload media (one-photo law), return that durable row as success.
 * inbound_mms must never masquerade as a successful web finalize.
 */
function resolveExistingWebUploadForRetry(args: {
  clerkUserId: string;
  winId: string;
  row: VictoryWinMediaRow | null;
}): FinalizeWebUploadSuccess | null {
  const row = args.row;
  if (!row) return null;
  if (row.win_id.toLowerCase() !== args.winId.toLowerCase()) return null;
  if (row.clerk_user_id !== args.clerkUserId) return null;
  if (row.source_type !== "web_upload") return null;
  return {
    ok: true,
    status: "existing",
    media: mapMediaRow(row),
    tempCleanup: "already_absent",
  };
}

/**
 * Normalize + attach a private temp object to an owned Win.
 * Caller supplies uploadId; temp path is derived from authenticated clerkUserId.
 */
export async function finalizeWebUpload(
  input: FinalizeWebUploadInput,
  deps: FinalizeWebUploadDeps = {}
): Promise<FinalizeWebUploadResult> {
  const clerkUserId =
    typeof input.clerkUserId === "string" ? input.clerkUserId.trim() : "";
  const winId = typeof input.winId === "string" ? input.winId.trim() : "";
  const uploadId =
    typeof input.uploadId === "string" ? input.uploadId.trim() : "";

  if (!clerkUserId || !UUID_RE.test(winId) || !UUID_RE.test(uploadId)) {
    return { ok: false, code: "invalid_input" };
  }

  const winIdNorm = winId.toLowerCase();
  const uploadIdNorm = uploadId.toLowerCase();

  let tempPath: string;
  try {
    tempPath = victoryMediaTempUploadPath(
      clerkUserId,
      uploadIdNorm,
      VICTORY_MEDIA_TEMP_UPLOAD_EXTENSION
    );
  } catch {
    return { ok: false, code: "invalid_input" };
  }

  // Reject any attempt to finalize a path that is not the reconstructed owner path.
  if (
    typeof input.tempPath === "string" &&
    input.tempPath.trim() !== "" &&
    input.tempPath.trim() !== tempPath
  ) {
    return { ok: false, code: "invalid_input" };
  }

  const tempObjects = deps.tempObjects ?? createDefaultTempProbe();
  const getMediaByWinId =
    deps.getMediaByWinId ?? createDefaultGetMediaByWinId();
  const exists = await tempObjects.exists({
    bucket: VICTORY_MEDIA_BUCKET,
    path: tempPath,
  });
  if (!exists) {
    const existing = await getMediaByWinId(winIdNorm);
    const retry = resolveExistingWebUploadForRetry({
      clerkUserId,
      winId: winIdNorm,
      row: existing,
    });
    if (retry) return retry;
    return { ok: false, code: "object_missing" };
  }

  if (tempObjects.byteSize) {
    const size = await tempObjects.byteSize({
      bucket: VICTORY_MEDIA_BUCKET,
      path: tempPath,
    });
    if (size != null && size > VICTORY_MEDIA_MAX_UPLOAD_BYTES) {
      return { ok: false, code: "too_large" };
    }
  }

  const normalizeFn = deps.normalize ?? normalizeVictoryImage;
  const normalized = await normalizeFn(
    {
      source: {
        kind: "supabase_object",
        bucket: VICTORY_MEDIA_BUCKET,
        path: tempPath,
        declaredMime: input.declaredMime ?? null,
        originalFilename: input.originalFilename ?? null,
      },
      maxIncomingBytes: VICTORY_MEDIA_MAX_UPLOAD_BYTES,
    },
    deps.normalizeDeps
  );

  if (!normalized.ok) {
    return { ok: false, code: normalized.code };
  }

  const createMediaId = deps.createMediaId ?? (() => randomUUID());
  const mediaId = createMediaId().trim().toLowerCase();
  if (!UUID_RE.test(mediaId)) {
    return { ok: false, code: "invalid_input" };
  }

  const finalizeFn = deps.finalize ?? finalizeVictoryWinMedia;
  const finalized: FinalizeVictoryWinMediaResult = await finalizeFn(
    {
      mediaId,
      winId: winIdNorm,
      clerkUserId,
      bucket: VICTORY_MEDIA_BUCKET,
      master: {
        bytes: normalized.master.bytes,
        width: normalized.master.width,
        height: normalized.master.height,
        byteSize: normalized.master.byteSize,
      },
      card: {
        bytes: normalized.card.bytes,
        width: normalized.card.width,
        height: normalized.card.height,
        byteSize: normalized.card.byteSize,
      },
      sourceType: "web_upload",
      userSelected: true,
    },
    deps.finalizeDeps
  );

  if (!finalized.ok) {
    return { ok: false, code: finalized.code };
  }

  let tempCleanup: "deleted" | "failed" = "deleted";
  try {
    const removed = await tempObjects.remove({
      bucket: VICTORY_MEDIA_BUCKET,
      paths: [tempPath],
    });
    if (!removed.ok) {
      tempCleanup = "failed";
      console.warn(
        "[victory-media/finalize-web-upload] temp cleanup failed",
        tempPath.slice(0, 80)
      );
    }
  } catch {
    tempCleanup = "failed";
    console.warn(
      "[victory-media/finalize-web-upload] temp cleanup threw",
      tempPath.slice(0, 80)
    );
  }

  return {
    ok: true,
    status: finalized.status,
    media: finalized.media,
    tempCleanup,
  };
}
