/**
 * Victory Media — finalize attach of normalized master/card to an owned Win.
 * Server-only. Does not mutate Win accountability/text/Season/goal/identity.
 */

import "server-only";

import {
  victoryMediaCardPath,
  victoryMediaMasterPath,
} from "@/lib/victory-media/storage-paths";
import { sniffImageFormat } from "@/lib/victory-media/sniff-image-format";

export type VictoryWinMediaSourceType = "web_upload" | "inbound_mms";

export type VictoryWinMediaDto = {
  id: string;
  winId: string;
  clerkUserId: string;
  sourceType: VictoryWinMediaSourceType;
  storageMasterPath: string;
  storageCardPath: string;
  mimeType: "image/jpeg";
  byteSize: number;
  width: number;
  height: number;
  cardByteSize: number;
  cardWidth: number;
  cardHeight: number;
  userSelectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FinalizeVictoryWinMediaErrorCode =
  | "invalid_input"
  | "invalid_normalized_media"
  | "win_not_found"
  | "win_forbidden"
  | "win_not_attachable"
  | "media_exists"
  | "media_id_conflict"
  | "mms_provenance_conflict"
  | "storage_upload_failed"
  | "db_insert_failed"
  | "cleanup_failed";

export type FinalizeVictoryWinMediaInput = {
  /** Caller-generated UUID; becomes durable v2_win_media.id */
  mediaId: string;
  winId: string;
  clerkUserId: string;
  /** Private production bucket name — supplied by trusted server caller (no env invent). */
  bucket: string;
  master: {
    bytes: Buffer;
    width: number;
    height: number;
    byteSize: number;
  };
  card: {
    bytes: Buffer;
    width: number;
    height: number;
    byteSize: number;
  };
  sourceType: VictoryWinMediaSourceType;
  sourceMessageSid?: string | null;
  sourceMediaOrdinal?: number | null;
  twilioMediaSid?: string | null;
  /** When true, sets user_selected_at (web/user-selected photo). */
  userSelected?: boolean;
  /** Optional MMS job to mark attached after successful insert. */
  inboundJobId?: string | null;
};

export type FinalizeVictoryWinMediaResult =
  | {
      ok: true;
      status: "attached" | "existing";
      media: VictoryWinMediaDto;
    }
  | {
      ok: false;
      code: FinalizeVictoryWinMediaErrorCode;
      cleanupError?: boolean;
    };

function hasNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export type VictoryWinAttachableRow = {
  id: string;
  clerk_user_id: string;
  status: string;
  hidden_at: string | null;
};

export function isVictoryWinNewlyAttachable(
  win: VictoryWinAttachableRow,
  clerkUserId: string
): boolean {
  return (
    win.clerk_user_id === clerkUserId &&
    win.status === "active" &&
    !hasNonEmptyText(win.hidden_at)
  );
}

export type VictoryMediaFinalizeDb = {
  getWin(winId: string): Promise<VictoryWinAttachableRow | null>;
  getMediaById(mediaId: string): Promise<VictoryWinMediaRow | null>;
  getMediaByWinId(winId: string): Promise<VictoryWinMediaRow | null>;
  insertMedia(
    row: VictoryWinMediaInsertRow
  ): Promise<
    | { ok: true; row: VictoryWinMediaRow }
    | {
        ok: false;
        kind: "unique_win" | "unique_media" | "unique_mms" | "other";
      }
  >;
  markInboundJobAttached(args: {
    jobId: string;
    winId: string;
    clerkUserId: string;
  }): Promise<void>;
};

export type VictoryMediaObjectStore = {
  upload(args: {
    bucket: string;
    path: string;
    bytes: Buffer;
    contentType: string;
  }): Promise<void>;
  remove(args: {
    bucket: string;
    paths: string[];
  }): Promise<{ ok: boolean }>;
  /**
   * Optional. Used only to repair upsert:false conflict on the exact
   * caller-derived canonical path when no durable DB row exists.
   * Repair requires both exists and download; missing either fails closed.
   */
  exists?(args: { bucket: string; path: string }): Promise<boolean>;
  download?(args: { bucket: string; path: string }): Promise<Buffer>;
};

export type FinalizeVictoryWinMediaDeps = {
  db?: VictoryMediaFinalizeDb;
  objects?: VictoryMediaObjectStore;
};

export type VictoryWinMediaRow = {
  id: string;
  win_id: string;
  clerk_user_id: string;
  source_type: VictoryWinMediaSourceType;
  source_message_sid: string | null;
  source_media_ordinal: number | null;
  twilio_media_sid: string | null;
  storage_master_path: string;
  storage_card_path: string;
  mime_type: string;
  byte_size: number;
  width: number;
  height: number;
  card_byte_size: number;
  card_width: number;
  card_height: number;
  user_selected_at: string | null;
  created_at: string;
  updated_at: string;
};

export type VictoryWinMediaInsertRow = {
  id: string;
  win_id: string;
  clerk_user_id: string;
  source_type: VictoryWinMediaSourceType;
  source_message_sid: string | null;
  source_media_ordinal: number | null;
  twilio_media_sid: string | null;
  storage_master_path: string;
  storage_card_path: string;
  mime_type: "image/jpeg";
  byte_size: number;
  width: number;
  height: number;
  card_byte_size: number;
  card_width: number;
  card_height: number;
  user_selected_at: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(
  code: FinalizeVictoryWinMediaErrorCode,
  cleanupError?: boolean
): FinalizeVictoryWinMediaResult {
  return cleanupError ? { ok: false, code, cleanupError: true } : { ok: false, code };
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("duplicate key") || msg.includes("unique constraint");
}

function mapRow(row: VictoryWinMediaRow): VictoryWinMediaDto {
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

function sameAttachIdentity(
  existing: VictoryWinMediaRow,
  args: {
    mediaId: string;
    winId: string;
    clerkUserId: string;
    masterPath: string;
    cardPath: string;
  }
): boolean {
  return (
    existing.id === args.mediaId &&
    existing.win_id === args.winId &&
    existing.clerk_user_id === args.clerkUserId &&
    existing.storage_master_path === args.masterPath &&
    existing.storage_card_path === args.cardPath
  );
}

function createDefaultDb(): VictoryMediaFinalizeDb {
  return {
    async getWin(winId) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { data, error } = await supabaseServer
        .from("v2_win")
        .select("id, clerk_user_id, status, hidden_at")
        .eq("id", winId)
        .maybeSingle();
      if (error || !data?.id) return null;
      return {
        id: String(data.id),
        clerk_user_id: String(data.clerk_user_id),
        status: String(data.status),
        hidden_at:
          typeof (data as { hidden_at?: unknown }).hidden_at === "string"
            ? (data as { hidden_at: string }).hidden_at
            : null,
      };
    },
    async getMediaById(mediaId) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { data, error } = await supabaseServer
        .from("v2_win_media")
        .select("*")
        .eq("id", mediaId)
        .maybeSingle();
      if (error || !data?.id) return null;
      return data as VictoryWinMediaRow;
    },
    async getMediaByWinId(winId) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { data, error } = await supabaseServer
        .from("v2_win_media")
        .select("*")
        .eq("win_id", winId)
        .maybeSingle();
      if (error || !data?.id) return null;
      return data as VictoryWinMediaRow;
    },
    async insertMedia(row) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { data, error } = await supabaseServer
        .from("v2_win_media")
        .insert(row)
        .select("*")
        .maybeSingle();
      if (!error && data?.id) {
        return { ok: true, row: data as VictoryWinMediaRow };
      }
      if (isUniqueViolation(error)) {
        const msg = (error?.message ?? "").toLowerCase();
        if (msg.includes("win_id") || msg.includes("v2_win_media_win_id")) {
          return { ok: false, kind: "unique_win" };
        }
        if (
          msg.includes("mms_provenance") ||
          msg.includes("source_message_sid")
        ) {
          return { ok: false, kind: "unique_mms" };
        }
        if (msg.includes("v2_win_media_pkey") || msg.includes("(id)")) {
          return { ok: false, kind: "unique_media" };
        }
        return { ok: false, kind: "unique_media" };
      }
      return { ok: false, kind: "other" };
    },
    async markInboundJobAttached({ jobId, winId, clerkUserId }) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      await supabaseServer
        .from("v2_inbound_media_job")
        .update({
          status: "attached",
          resolution: "attached",
          attached_win_id: winId,
        })
        .eq("id", jobId)
        .eq("clerk_user_id", clerkUserId);
    },
  };
}

function createDefaultObjectStore(): VictoryMediaObjectStore {
  return {
    async upload({ bucket, path, bytes, contentType }) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { error } = await supabaseServer.storage.from(bucket).upload(path, bytes, {
        contentType,
        upsert: false,
      });
      if (error) {
        throw new Error("storage_upload_failed");
      }
    },
    async remove({ bucket, paths }) {
      if (paths.length === 0) return { ok: true };
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { error } = await supabaseServer.storage.from(bucket).remove(paths);
      return { ok: !error };
    },
    async exists({ bucket, path }) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { data, error } = await supabaseServer.storage
        .from(bucket)
        .exists(path);
      if (error) return false;
      return data === true;
    },
    async download({ bucket, path }) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { data, error } = await supabaseServer.storage
        .from(bucket)
        .download(path);
      if (error || !data) {
        throw new Error("storage_download_failed");
      }
      if (Buffer.isBuffer(data)) return data;
      if (data instanceof Uint8Array) return Buffer.from(data);
      if (typeof (data as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer === "function") {
        return Buffer.from(
          await (data as Blob).arrayBuffer()
        );
      }
      throw new Error("storage_download_failed");
    },
  };
}

function validateAsset(asset: {
  bytes: Buffer;
  width: number;
  height: number;
  byteSize: number;
}): boolean {
  return (
    Buffer.isBuffer(asset.bytes) &&
    asset.bytes.length > 0 &&
    asset.byteSize === asset.bytes.length &&
    Number.isInteger(asset.width) &&
    asset.width > 0 &&
    Number.isInteger(asset.height) &&
    asset.height > 0
  );
}

/**
 * After a Storage upload conflict/failure that may mean another request
 * already created durable media, re-read DB once (no sleep).
 * Returns a finalization result when durable state is decisive; otherwise null.
 */
async function resolveAfterPossibleStorageRace(args: {
  db: VictoryMediaFinalizeDb;
  mediaId: string;
  winId: string;
  clerkUserId: string;
  masterPath: string;
  cardPath: string;
}): Promise<FinalizeVictoryWinMediaResult | null> {
  const identity = {
    mediaId: args.mediaId,
    winId: args.winId,
    clerkUserId: args.clerkUserId,
    masterPath: args.masterPath,
    cardPath: args.cardPath,
  };

  const byId = await args.db.getMediaById(args.mediaId);
  if (byId) {
    if (sameAttachIdentity(byId, identity)) {
      return { ok: true, status: "existing", media: mapRow(byId) };
    }
    return fail("media_id_conflict");
  }

  const byWin = await args.db.getMediaByWinId(args.winId);
  if (byWin) {
    if (sameAttachIdentity(byWin, identity)) {
      return { ok: true, status: "existing", media: mapRow(byWin) };
    }
    return fail("media_exists");
  }

  return null;
}

/**
 * Repair upsert:false conflict only for the exact caller-derived path.
 * Reuse is allowed only when existing bytes are identical to the caller buffer.
 * Never overwrites. Never treats a missing/undownloadable object as success.
 */
async function acceptExistingCanonicalObject(args: {
  objects: VictoryMediaObjectStore;
  bucket: string;
  path: string;
  expected: Buffer;
}): Promise<boolean> {
  if (!args.objects.exists || !args.objects.download) return false;
  if (!Buffer.isBuffer(args.expected) || args.expected.length === 0) return false;
  const present = await args.objects.exists({
    bucket: args.bucket,
    path: args.path,
  });
  if (!present) return false;
  try {
    const bytes = await args.objects.download({
      bucket: args.bucket,
      path: args.path,
    });
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) return false;
    return bytes.equals(args.expected);
  } catch {
    return false;
  }
}

/**
 * Attach normalized master/card JPEGs to an owned active Win.
 * Upload-first, DB-second; best-effort Storage cleanup on DB failure.
 */
export async function finalizeVictoryWinMedia(
  input: FinalizeVictoryWinMediaInput,
  deps: FinalizeVictoryWinMediaDeps = {}
): Promise<FinalizeVictoryWinMediaResult> {
  const db = deps.db ?? createDefaultDb();
  const objects = deps.objects ?? createDefaultObjectStore();

  const mediaId = typeof input.mediaId === "string" ? input.mediaId.trim() : "";
  const winId = typeof input.winId === "string" ? input.winId.trim() : "";
  const clerkUserId =
    typeof input.clerkUserId === "string" ? input.clerkUserId.trim() : "";
  const bucket = typeof input.bucket === "string" ? input.bucket.trim() : "";

  if (
    !UUID_RE.test(mediaId) ||
    !UUID_RE.test(winId) ||
    !clerkUserId ||
    !bucket ||
    bucket.includes("..") ||
    bucket.includes("/") ||
    (input.sourceType !== "web_upload" && input.sourceType !== "inbound_mms") ||
    !validateAsset(input.master) ||
    !validateAsset(input.card)
  ) {
    return fail("invalid_input");
  }

  if (
    sniffImageFormat(input.master.bytes) !== "jpeg" ||
    sniffImageFormat(input.card.bytes) !== "jpeg"
  ) {
    return fail("invalid_normalized_media");
  }

  const mediaIdNorm = mediaId.toLowerCase();
  const winIdNorm = winId.toLowerCase();

  if (input.sourceType === "web_upload") {
    if (input.sourceMessageSid != null || input.sourceMediaOrdinal != null) {
      return fail("invalid_input");
    }
  } else {
    const sid =
      typeof input.sourceMessageSid === "string"
        ? input.sourceMessageSid.trim()
        : "";
    if (
      !sid ||
      input.sourceMediaOrdinal == null ||
      !Number.isInteger(input.sourceMediaOrdinal) ||
      input.sourceMediaOrdinal < 0
    ) {
      return fail("invalid_input");
    }
  }

  let masterPath: string;
  let cardPath: string;
  try {
    masterPath = victoryMediaMasterPath(clerkUserId, mediaIdNorm);
    cardPath = victoryMediaCardPath(clerkUserId, mediaIdNorm);
  } catch {
    return fail("invalid_input");
  }

  const win = await db.getWin(winIdNorm);
  if (!win) return fail("win_not_found");
  if (win.clerk_user_id !== clerkUserId) return fail("win_forbidden");
  if (!isVictoryWinNewlyAttachable(win, clerkUserId)) {
    return fail("win_not_attachable");
  }

  const existingById = await db.getMediaById(mediaIdNorm);
  if (existingById) {
    if (
      sameAttachIdentity(existingById, {
        mediaId: mediaIdNorm,
        winId: winIdNorm,
        clerkUserId,
        masterPath,
        cardPath,
      })
    ) {
      return { ok: true, status: "existing", media: mapRow(existingById) };
    }
    return fail("media_id_conflict");
  }

  const existingByWin = await db.getMediaByWinId(winIdNorm);
  if (existingByWin) {
    if (
      sameAttachIdentity(existingByWin, {
        mediaId: mediaIdNorm,
        winId: winIdNorm,
        clerkUserId,
        masterPath,
        cardPath,
      })
    ) {
      return { ok: true, status: "existing", media: mapRow(existingByWin) };
    }
    // One-photo law + MMS must not overwrite user-selected/existing photo.
    return fail("media_exists");
  }

  const uploaded: string[] = [];
  try {
    await objects.upload({
      bucket,
      path: masterPath,
      bytes: input.master.bytes,
      contentType: "image/jpeg",
    });
    uploaded.push(masterPath);
  } catch {
    // upsert:false conflict may mean a concurrent same-mediaId request won
    // or a prior crash left the exact canonical object without a DB row.
    const raced = await resolveAfterPossibleStorageRace({
      db,
      mediaId: mediaIdNorm,
      winId: winIdNorm,
      clerkUserId,
      masterPath,
      cardPath,
    });
    if (raced) return raced;
    const repaired = await acceptExistingCanonicalObject({
      objects,
      bucket,
      path: masterPath,
      expected: input.master.bytes,
    });
    // Pre-existing object was not created by this invocation — do not bookkeep
    // it for later cleanup. Fail closed leaves unknown objects untouched.
    if (!repaired) return fail("storage_upload_failed");
  }

  try {
    await objects.upload({
      bucket,
      path: cardPath,
      bytes: input.card.bytes,
      contentType: "image/jpeg",
    });
    uploaded.push(cardPath);
  } catch {
    const raced = await resolveAfterPossibleStorageRace({
      db,
      mediaId: mediaIdNorm,
      winId: winIdNorm,
      clerkUserId,
      masterPath,
      cardPath,
    });
    // Never clean paths if another request already made them durable.
    if (raced) return raced;
    const repaired = await acceptExistingCanonicalObject({
      objects,
      bucket,
      path: cardPath,
      expected: input.card.bytes,
    });
    if (!repaired) {
      const cleanup = await objects.remove({ bucket, paths: uploaded });
      return fail("storage_upload_failed", !cleanup.ok);
    }
    // Identical leftover card is not this invocation's upload.
  }

  const winAgain = await db.getWin(winIdNorm);
  if (
    !winAgain ||
    winAgain.id.toLowerCase() !== winIdNorm ||
    !isVictoryWinNewlyAttachable(winAgain, clerkUserId)
  ) {
    const cleanup = await objects.remove({ bucket, paths: uploaded });
    if (!winAgain) return fail("win_not_found", !cleanup.ok);
    if (winAgain.clerk_user_id !== clerkUserId) {
      return fail("win_forbidden", !cleanup.ok);
    }
    return fail("win_not_attachable", !cleanup.ok);
  }

  const userSelectedAt =
    input.userSelected === true ? new Date().toISOString() : null;

  const insertRow: VictoryWinMediaInsertRow = {
    id: mediaIdNorm,
    win_id: winIdNorm,
    clerk_user_id: clerkUserId,
    source_type: input.sourceType,
    source_message_sid:
      input.sourceType === "inbound_mms"
        ? String(input.sourceMessageSid).trim()
        : null,
    source_media_ordinal:
      input.sourceType === "inbound_mms" ? input.sourceMediaOrdinal! : null,
    twilio_media_sid:
      typeof input.twilioMediaSid === "string" && input.twilioMediaSid.trim()
        ? input.twilioMediaSid.trim()
        : null,
    storage_master_path: masterPath,
    storage_card_path: cardPath,
    mime_type: "image/jpeg",
    byte_size: input.master.byteSize,
    width: input.master.width,
    height: input.master.height,
    card_byte_size: input.card.byteSize,
    card_width: input.card.width,
    card_height: input.card.height,
    user_selected_at: userSelectedAt,
  };

  const inserted = await db.insertMedia(insertRow);
  if (!inserted.ok) {
    if (inserted.kind === "unique_media") {
      // Re-read before any cleanup — concurrent winner may own the same paths.
      const raced = await db.getMediaById(mediaIdNorm);
      if (
        raced &&
        sameAttachIdentity(raced, {
          mediaId: mediaIdNorm,
          winId: winIdNorm,
          clerkUserId,
          masterPath,
          cardPath,
        })
      ) {
        return { ok: true, status: "existing", media: mapRow(raced) };
      }
      const cleanup = await objects.remove({ bucket, paths: uploaded });
      return fail("media_id_conflict", !cleanup.ok);
    }

    const cleanup = await objects.remove({ bucket, paths: uploaded });
    if (inserted.kind === "unique_win") {
      return fail("media_exists", !cleanup.ok);
    }
    if (inserted.kind === "unique_mms") {
      return fail("mms_provenance_conflict", !cleanup.ok);
    }
    return fail("db_insert_failed", !cleanup.ok);
  }

  if (input.inboundJobId && typeof input.inboundJobId === "string") {
    const jobId = input.inboundJobId.trim();
    if (UUID_RE.test(jobId)) {
      try {
        await db.markInboundJobAttached({
          jobId,
          winId: winIdNorm,
          clerkUserId,
        });
      } catch {
        // Media row is durable; job mark is best-effort follow-up for this slice.
      }
    }
  }

  return {
    ok: true,
    status: "attached",
    media: mapRow(inserted.row),
  };
}
