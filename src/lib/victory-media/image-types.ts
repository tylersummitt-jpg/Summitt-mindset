/**
 * Victory Media — image normalization types (server pipeline foundation).
 * No persistence, no UI, no EXIF/GPS exposure.
 */

export type SniffedImageFormat =
  | "jpeg"
  | "png"
  | "webp"
  | "heic_heif"
  | "avif"
  | "gif"
  | "svg"
  | "unknown";

/** Formats Sharp can normalize directly in this slice. */
export type NativeSharpRasterFormat = "jpeg" | "png" | "webp";

export type VictoryMediaNormalizeErrorCode =
  | "too_large_bytes"
  | "too_many_pixels"
  | "unsupported_format"
  | "dangerous_svg"
  | "animated_gif_not_supported"
  | "corrupt_image"
  | "heic_requires_storage_source"
  | "heic_transform_failed"
  | "unexpected_transform_format"
  | "decode_failed"
  | "normalize_failed";

export type NormalizeVictoryImageSource =
  | {
      kind: "bytes";
      bytes: Buffer;
      declaredMime?: string | null;
      originalFilename?: string | null;
    }
  | {
      kind: "supabase_object";
      bucket: string;
      path: string;
      declaredMime?: string | null;
      originalFilename?: string | null;
    };

export type NormalizeVictoryImageInput = {
  source: NormalizeVictoryImageSource;
  maxIncomingBytes?: number;
  maxPixels?: number;
  maxLongEdge?: number;
  jpegQuality?: number;
  cardLongEdge?: number;
  cardQuality?: number;
};

export type NormalizedVictoryImageAsset = {
  bytes: Buffer;
  mime: "image/jpeg";
  width: number;
  height: number;
  byteSize: number;
};

export type NormalizeVictoryImageSuccess = {
  ok: true;
  master: NormalizedVictoryImageAsset;
  card: NormalizedVictoryImageAsset;
  source: {
    sniffedFormat: SniffedImageFormat;
    usedHeicBridge: boolean;
  };
};

export type NormalizeVictoryImageFailure = {
  ok: false;
  code: VictoryMediaNormalizeErrorCode;
};

export type NormalizeVictoryImageResult =
  | NormalizeVictoryImageSuccess
  | NormalizeVictoryImageFailure;

/** Injected Storage boundary for HEIC transform + object download (tests mock this). */
export type VictoryMediaStorageBridge = {
  downloadObject(args: { bucket: string; path: string }): Promise<Buffer>;
  downloadTransformed(args: {
    bucket: string;
    path: string;
    transform: {
      width: number;
      height: number;
      resize: "contain";
      quality: number;
    };
  }): Promise<Buffer>;
};

export type NormalizeVictoryImageDeps = {
  storage?: VictoryMediaStorageBridge;
};

export const VICTORY_MEDIA_IMAGE_DEFAULTS = {
  MAX_INCOMING_BYTES: 12_000_000,
  MAX_PIXELS: 40_000_000,
  MAX_LONG_EDGE: 2048,
  JPEG_QUALITY: 85,
  CARD_LONG_EDGE: 1280,
  CARD_QUALITY: 82,
  ALPHA_BACKGROUND: { r: 255, g: 255, b: 255 } as const,
} as const;
