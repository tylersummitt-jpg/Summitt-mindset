/**
 * Victory Media — production storage contract constants (server).
 * Bucket is created manually in Supabase; not provisioned from code.
 */

/** Private production bucket. No public URLs. */
export const VICTORY_MEDIA_BUCKET = "victory-media";

/** Direct client upload ceiling (bytes). Matches normalize incoming max. */
export const VICTORY_MEDIA_MAX_UPLOAD_BYTES = 12_000_000;

/**
 * Fixed temp object extension so path can be reconstructed from
 * clerkUserId + uploadId alone (declared MIME is allowlist-only).
 */
export const VICTORY_MEDIA_TEMP_UPLOAD_EXTENSION = "bin";

/** Declared MIME allowlist for web upload intent (byte sniff remains authority). */
export const VICTORY_MEDIA_ALLOWED_UPLOAD_MIMES = [
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type VictoryMediaAllowedUploadMime =
  (typeof VICTORY_MEDIA_ALLOWED_UPLOAD_MIMES)[number];

export function isVictoryMediaAllowedUploadMime(
  value: unknown
): value is VictoryMediaAllowedUploadMime {
  return (
    typeof value === "string" &&
    (VICTORY_MEDIA_ALLOWED_UPLOAD_MIMES as readonly string[]).includes(
      value.trim().toLowerCase()
    )
  );
}

/**
 * TEMP LIFETIME (later slice):
 * Failed finalize may leave owner-scoped temp objects.
 * Require a 24-hour purge job for `{clerkUserId}/temp/*` — not implemented here.
 */
export const VICTORY_MEDIA_TEMP_PURGE_HOURS = 24;

/**
 * Client contract for direct signed temp upload (Slice 3A / 3B).
 * Temp paths use a fixed `.bin` extension; Storage defaults content type from
 * extension unless overridden. Client MUST pass contentType = declaredMime
 * used at upload-intent (e.g. image/heic) on uploadToSignedUrl / PUT.
 */
export const VICTORY_MEDIA_SIGNED_UPLOAD_CLIENT_CONTRACT = {
  contentTypeMustEqualDeclaredMime: true,
} as const;
