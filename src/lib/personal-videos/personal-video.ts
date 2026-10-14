import { randomBytes } from "crypto";

export const PERSONAL_VIDEO_EMBED_DOMAIN = "summittmindset.com";
export const PERSONAL_VIDEO_MAX_BYTES = 80 * 1024 * 1024;

export const PERSONAL_VIDEO_STATUSES = ["uploading", "processing", "ready", "failed"] as const;
export type PersonalVideoStatus = (typeof PERSONAL_VIDEO_STATUSES)[number];

const TOKEN_RE = /^[A-Za-z0-9_-]{32,80}$/;
const VIMEO_ID_RE = /^[0-9]{6,20}$/;

export function newPersonalVideoToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isPersonalVideoToken(value: string): boolean {
  return TOKEN_RE.test(value);
}

export function vimeoIdFromUri(uri: unknown): string | null {
  if (typeof uri !== "string") return null;
  const id = uri.split("/").filter(Boolean).pop() ?? "";
  return VIMEO_ID_RE.test(id) ? id : null;
}

export function isPersonalVideoByteSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= PERSONAL_VIDEO_MAX_BYTES;
}

export function personalVideoCreateBody(byteSize: number) {
  return {
    name: "Personal message from Tyler Summitt",
    upload: { approach: "tus" as const, size: byteSize },
    privacy: {
      view: "disable" as const,
      embed: "whitelist" as const,
      download: false,
    },
  };
}

export function isVimeoUploadLink(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith("vimeo.com");
  } catch {
    return false;
  }
}

type VimeoRead = {
  status?: unknown;
  transcode?: { status?: unknown } | null;
  privacy?: { view?: unknown; embed?: unknown; download?: unknown } | null;
  pictures?: { sizes?: unknown } | null;
};

export function personalVideoPrivacyOk(video: VimeoRead): boolean {
  return (
    video.privacy?.view === "disable" &&
    video.privacy?.embed === "whitelist" &&
    video.privacy?.download === false
  );
}

export function readinessFromVimeo(video: VimeoRead): PersonalVideoStatus {
  const transcode = video.transcode?.status;
  const status = video.status;
  if (transcode === "error" || status === "uploading_error" || status === "transcoding_error") {
    return "failed";
  }
  const playable = transcode === "complete" || status === "available";
  if (playable && !personalVideoPrivacyOk(video)) return "failed";
  if (playable) return "ready";
  if (transcode === "in_progress" || status === "transcoding") return "processing";
  if (status === "uploading") return "uploading";
  return "processing";
}

export function watchPathForStatus(token: string, status: PersonalVideoStatus): string | null {
  if (status !== "ready" || !isPersonalVideoToken(token)) return null;
  return `/for/${token}`;
}
