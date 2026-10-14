import { randomBytes } from "crypto";

export {
  isPersonalVideoByteSize,
  PERSONAL_VIDEO_MAX_BYTES,
  PERSONAL_VIDEO_TOO_LARGE_MESSAGE,
} from "@/lib/personal-videos/upload-limit";

export const PERSONAL_VIDEO_EMBED_DOMAIN = "summittmindset.com";

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

export const PERSONAL_VIDEO_POSTER_SECONDS = 2;

type VimeoRead = {
  status?: unknown;
  transcode?: { status?: unknown } | null;
  privacy?: { view?: unknown; embed?: unknown; download?: unknown } | null;
  pictures?: { type?: unknown; active?: unknown; sizes?: unknown } | null;
};

export type PersonalVideoPosterPicture = {
  type?: unknown;
  active?: unknown;
  uri?: unknown;
};

export type PersonalVideoPosterStep = "keep" | "create" | "activate";

/** A real frame thumbnail. Vimeo's camera placeholder uses type "default". */
export function personalVideoPosterOk(video: { pictures?: { type?: unknown; active?: unknown } | null }): boolean {
  return video.pictures?.type === "custom" && video.pictures?.active === true;
}

/** About two seconds in, or halfway through a shorter video. Unknown duration stays at two seconds. */
export function personalVideoPosterSeconds(durationSeconds: unknown): number {
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return PERSONAL_VIDEO_POSTER_SECONDS;
  }
  if (durationSeconds >= PERSONAL_VIDEO_POSTER_SECONDS) return PERSONAL_VIDEO_POSTER_SECONDS;
  return Math.round((durationSeconds / 2) * 10) / 10;
}

/** Keep a custom active frame. Activate one that already exists. Create one only when none exists. */
export function personalVideoPosterStep(pictures: readonly PersonalVideoPosterPicture[]): PersonalVideoPosterStep {
  if (pictures.some((picture) => picture.type === "custom" && picture.active === true)) return "keep";
  if (
    pictures.some(
      (picture) =>
        picture.type === "custom" &&
        typeof picture.uri === "string" &&
        picture.uri.startsWith("/videos/") &&
        picture.uri.includes("/pictures/")
    )
  ) {
    return "activate";
  }
  return "create";
}

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
  if (playable && !personalVideoPosterOk(video)) return "processing";
  if (playable) return "ready";
  if (transcode === "in_progress" || status === "transcoding") return "processing";
  if (status === "uploading") return "uploading";
  return "processing";
}

export function watchPathForStatus(token: string, status: PersonalVideoStatus): string | null {
  if (status !== "ready" || !isPersonalVideoToken(token)) return null;
  return `/for/${token}`;
}
