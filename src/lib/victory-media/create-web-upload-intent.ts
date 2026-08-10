/**
 * Victory Media — create signed temp upload intent (server-only).
 * Path is always server-generated from authenticated clerkUserId + uploadId.
 */

import "server-only";

import { randomUUID } from "crypto";

import {
  VICTORY_MEDIA_ALLOWED_UPLOAD_MIMES,
  VICTORY_MEDIA_BUCKET,
  VICTORY_MEDIA_MAX_UPLOAD_BYTES,
  VICTORY_MEDIA_TEMP_UPLOAD_EXTENSION,
  isVictoryMediaAllowedUploadMime,
  type VictoryMediaAllowedUploadMime,
} from "@/lib/victory-media/constants";
import { victoryMediaTempUploadPath } from "@/lib/victory-media/storage-paths";

export type CreateWebUploadIntentErrorCode =
  | "invalid_input"
  | "unsupported_mime"
  | "signed_upload_failed";

export type CreateWebUploadIntentInput = {
  clerkUserId: string;
  /** Optional; not required — upload may precede Win creation. */
  winId?: string | null;
  originalFilename?: string | null;
  declaredMime?: string | null;
};

export type CreateWebUploadIntentSuccess = {
  ok: true;
  uploadId: string;
  path: string;
  bucket: string;
  signedUrl: string;
  token: string;
  maxBytes: number;
  allowedMimeTypes: readonly VictoryMediaAllowedUploadMime[];
};

export type CreateWebUploadIntentResult =
  | CreateWebUploadIntentSuccess
  | { ok: false; code: CreateWebUploadIntentErrorCode };

export type VictoryMediaSignedUploadStore = {
  createSignedUploadUrl(args: {
    bucket: string;
    path: string;
  }): Promise<{ signedUrl: string; token: string; path: string }>;
};

export type CreateWebUploadIntentDeps = {
  signedUploads?: VictoryMediaSignedUploadStore;
  /** Test seam for deterministic uploadId. */
  createUploadId?: () => string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createDefaultSignedUploadStore(): VictoryMediaSignedUploadStore {
  return {
    async createSignedUploadUrl({ bucket, path }) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { data, error } = await supabaseServer.storage
        .from(bucket)
        .createSignedUploadUrl(path);
      if (error || !data?.signedUrl || !data?.token || !data?.path) {
        throw new Error("signed_upload_failed");
      }
      return {
        signedUrl: data.signedUrl,
        token: data.token,
        path: data.path,
      };
    },
  };
}

/**
 * Issue a one-time signed upload authorization for a private temp object.
 * Does not create DB rows. Never returns service credentials.
 */
export async function createWebUploadIntent(
  input: CreateWebUploadIntentInput,
  deps: CreateWebUploadIntentDeps = {}
): Promise<CreateWebUploadIntentResult> {
  const clerkUserId =
    typeof input.clerkUserId === "string" ? input.clerkUserId.trim() : "";
  if (!clerkUserId) {
    return { ok: false, code: "invalid_input" };
  }

  if (input.winId != null && input.winId !== "") {
    const winId = typeof input.winId === "string" ? input.winId.trim() : "";
    if (!UUID_RE.test(winId)) {
      return { ok: false, code: "invalid_input" };
    }
  }

  const declaredRaw =
    typeof input.declaredMime === "string" ? input.declaredMime.trim() : "";
  if (!declaredRaw) {
    return { ok: false, code: "invalid_input" };
  }
  const declaredMime = declaredRaw.toLowerCase();
  if (!isVictoryMediaAllowedUploadMime(declaredMime)) {
    return { ok: false, code: "unsupported_mime" };
  }

  const createUploadId = deps.createUploadId ?? (() => randomUUID());
  const uploadId = createUploadId().trim().toLowerCase();
  if (!UUID_RE.test(uploadId)) {
    return { ok: false, code: "invalid_input" };
  }

  let path: string;
  try {
    path = victoryMediaTempUploadPath(
      clerkUserId,
      uploadId,
      VICTORY_MEDIA_TEMP_UPLOAD_EXTENSION
    );
  } catch {
    return { ok: false, code: "invalid_input" };
  }

  const store = deps.signedUploads ?? createDefaultSignedUploadStore();
  try {
    const signed = await store.createSignedUploadUrl({
      bucket: VICTORY_MEDIA_BUCKET,
      path,
    });
    // Never trust a caller-chosen path; signed target must match server path.
    if (signed.path !== path) {
      return { ok: false, code: "signed_upload_failed" };
    }
    return {
      ok: true,
      uploadId,
      path,
      bucket: VICTORY_MEDIA_BUCKET,
      signedUrl: signed.signedUrl,
      token: signed.token,
      maxBytes: VICTORY_MEDIA_MAX_UPLOAD_BYTES,
      allowedMimeTypes: VICTORY_MEDIA_ALLOWED_UPLOAD_MIMES,
    };
  } catch {
    return { ok: false, code: "signed_upload_failed" };
  }
}
