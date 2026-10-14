export const PERSONAL_VIDEO_MAX_BYTES = 320 * 1024 * 1024;

const PERSONAL_VIDEO_MAX_MB = PERSONAL_VIDEO_MAX_BYTES / (1024 * 1024);

export const PERSONAL_VIDEO_TOO_LARGE_MESSAGE = `This recording is larger than ${PERSONAL_VIDEO_MAX_MB} MB. Record a shorter video, then try Save Video again.`;

export function isPersonalVideoByteSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= PERSONAL_VIDEO_MAX_BYTES;
}
