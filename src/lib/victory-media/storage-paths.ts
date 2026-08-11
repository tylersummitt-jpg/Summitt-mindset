/**
 * Deterministic private Storage path helpers for Victory Media.
 * Paths are clerkUserId/mediaId based — never win_id.
 */

export type VictoryMediaPathErrorCode =
  | "invalid_clerk_user_id"
  | "invalid_media_id"
  | "invalid_upload_id"
  | "invalid_job_id"
  | "invalid_extension";

export class VictoryMediaPathError extends Error {
  readonly code: VictoryMediaPathErrorCode;

  constructor(code: VictoryMediaPathErrorCode) {
    super(code);
    this.name = "VictoryMediaPathError";
    this.code = code;
  }
}

const CLERK_USER_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXT_RE = /^[a-z0-9]{1,8}$/i;

function assertNoTraversal(value: string): void {
  if (
    value.includes("..") ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    throw new VictoryMediaPathError("invalid_clerk_user_id");
  }
}

function requireClerkUserId(clerkUserId: string): string {
  const id = typeof clerkUserId === "string" ? clerkUserId.trim() : "";
  assertNoTraversal(id);
  if (!CLERK_USER_ID_RE.test(id)) {
    throw new VictoryMediaPathError("invalid_clerk_user_id");
  }
  return id;
}

function requireUuid(
  value: string,
  code: "invalid_media_id" | "invalid_upload_id" | "invalid_job_id"
): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (
    id.includes("..") ||
    id.includes("/") ||
    id.includes("\\") ||
    id.includes("\0") ||
    !UUID_RE.test(id)
  ) {
    throw new VictoryMediaPathError(code);
  }
  return id.toLowerCase();
}

function normalizeExtension(extension?: string | null): string {
  if (extension == null || extension === "") return "bin";
  const raw = extension.trim().replace(/^\./, "").toLowerCase();
  if (!EXT_RE.test(raw)) {
    throw new VictoryMediaPathError("invalid_extension");
  }
  return raw;
}

/**
 * Exact Storage ownership root for a user under victory-media.
 * Returns `{clerkUserId}/` (trailing slash). Rejects traversal / malformed ids.
 */
export function victoryMediaUserStoragePrefix(clerkUserId: string): string {
  return `${requireClerkUserId(clerkUserId)}/`;
}

export function victoryMediaMasterPath(
  clerkUserId: string,
  mediaId: string
): string {
  const user = requireClerkUserId(clerkUserId);
  const media = requireUuid(mediaId, "invalid_media_id");
  return `${user}/${media}/master.jpg`;
}

export function victoryMediaCardPath(
  clerkUserId: string,
  mediaId: string
): string {
  const user = requireClerkUserId(clerkUserId);
  const media = requireUuid(mediaId, "invalid_media_id");
  return `${user}/${media}/card.jpg`;
}

export function victoryMediaTempUploadPath(
  clerkUserId: string,
  uploadId: string,
  extension?: string | null
): string {
  const user = requireClerkUserId(clerkUserId);
  const upload = requireUuid(uploadId, "invalid_upload_id");
  const ext = normalizeExtension(extension);
  return `${user}/temp/${upload}.${ext}`;
}

export function victoryMediaMmsTempPath(
  clerkUserId: string,
  jobId: string,
  extension?: string | null
): string {
  const user = requireClerkUserId(clerkUserId);
  const job = requireUuid(jobId, "invalid_job_id");
  const ext = normalizeExtension(extension);
  return `${user}/mms-temp/${job}.${ext}`;
}
