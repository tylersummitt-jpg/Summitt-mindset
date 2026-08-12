/**
 * Coarse client MIME hint for Victory Media upload-intent / signed PUT.
 * Extension fallback is only for blank/unsupported browser file.type (e.g. HEIC).
 * Server byte sniff remains format authority at finalize.
 */

export const VICTORY_MEDIA_CLIENT_ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export type VictoryMediaClientAllowedMime =
  (typeof VICTORY_MEDIA_CLIENT_ALLOWED_MIMES)[number];

const ALLOWED_SET = new Set<string>(VICTORY_MEDIA_CLIENT_ALLOWED_MIMES);

const EXT_TO_MIME: Record<string, VictoryMediaClientAllowedMime> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

function extensionOf(filename: string): string | null {
  const name = filename.trim().toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return null;
  // Ignore path segments; take final extension only.
  const base = name.slice(dot + 1);
  if (!base || base.includes("/") || base.includes("\\")) return null;
  return base;
}

/**
 * Resolve declared MIME for upload-intent / PUT Content-Type.
 * Returns null when the file is not an allowed Victory Media image hint.
 */
export function resolveVictoryMediaClientMime(file: {
  name: string;
  type: string;
}): VictoryMediaClientAllowedMime | null {
  const type = typeof file.type === "string" ? file.type.trim().toLowerCase() : "";
  if (type && ALLOWED_SET.has(type)) {
    return type as VictoryMediaClientAllowedMime;
  }

  const ext = extensionOf(typeof file.name === "string" ? file.name : "");
  if (!ext) return null;
  return EXT_TO_MIME[ext] ?? null;
}

/** True when a local object-URL preview is safe (raster browsers can decode). */
export function canPreviewVictoryMediaClientMime(
  mime: string | null | undefined
): boolean {
  return mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
}
