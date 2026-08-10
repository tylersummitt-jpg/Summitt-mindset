/**
 * Victory Media — server-only image normalization foundation.
 *
 * PATH A: JPEG/PNG/WebP bytes → Sharp normalize → master + card
 * PATH B: HEIC/HEIF private Storage object → Supabase transform → Sharp normalize
 *
 * No uploads, deletes, DB writes, or public URLs.
 */

import "server-only";

import sharp from "sharp";

import {
  VICTORY_MEDIA_IMAGE_DEFAULTS,
  type NormalizeVictoryImageDeps,
  type NormalizeVictoryImageInput,
  type NormalizeVictoryImageResult,
  type NormalizedVictoryImageAsset,
  type SniffedImageFormat,
  type VictoryMediaNormalizeErrorCode,
  type VictoryMediaStorageBridge,
} from "@/lib/victory-media/image-types";
import {
  isNativeSharpRasterFormat,
  sniffImageFormat,
} from "@/lib/victory-media/sniff-image-format";

const HEIC_TRANSFORM = {
  width: 2048,
  height: 2048,
  resize: "contain" as const,
  quality: 85,
};

function fail(code: VictoryMediaNormalizeErrorCode): NormalizeVictoryImageResult {
  return { ok: false, code };
}

function rejectForSniffedFormat(
  format: SniffedImageFormat
): VictoryMediaNormalizeErrorCode | null {
  switch (format) {
    case "gif":
      return "animated_gif_not_supported";
    case "svg":
      return "dangerous_svg";
    case "avif":
    case "unknown":
      return "unsupported_format";
    default:
      return null;
  }
}

async function blobLikeToBuffer(data: Blob | ArrayBuffer | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (typeof (data as Blob).arrayBuffer === "function") {
    return Buffer.from(await (data as Blob).arrayBuffer());
  }
  throw new Error("unsupported_download_payload");
}

function createDefaultStorageBridge(): VictoryMediaStorageBridge {
  // Lazy import keeps unit tests free of env credentials and avoids
  // instantiating the service-role client until a Storage path is used.
  return {
    async downloadObject({ bucket, path }) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { data, error } = await supabaseServer.storage.from(bucket).download(path);
      if (error || !data) {
        throw new Error("download_failed");
      }
      return blobLikeToBuffer(data);
    },
    async downloadTransformed({ bucket, path, transform }) {
      const { supabaseServer } = await import("@/lib/supabase-server");
      const { data, error } = await supabaseServer.storage.from(bucket).download(path, {
        transform,
      });
      if (error || !data) {
        throw new Error("transform_failed");
      }
      return blobLikeToBuffer(data);
    },
  };
}

async function resolveRasterBytes(
  input: NormalizeVictoryImageInput,
  storage: VictoryMediaStorageBridge,
  maxIncomingBytes: number
): Promise<
  | {
      ok: true;
      bytes: Buffer;
      sniffedFormat: SniffedImageFormat;
      usedHeicBridge: boolean;
    }
  | { ok: false; code: VictoryMediaNormalizeErrorCode }
> {
  if (input.source.kind === "bytes") {
    const bytes = input.source.bytes;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      return { ok: false, code: "corrupt_image" };
    }
    if (bytes.length > maxIncomingBytes) {
      return { ok: false, code: "too_large_bytes" };
    }

    const sniffedFormat = sniffImageFormat(bytes);
    if (sniffedFormat === "heic_heif") {
      return { ok: false, code: "heic_requires_storage_source" };
    }
    const reject = rejectForSniffedFormat(sniffedFormat);
    if (reject) return { ok: false, code: reject };
    if (!isNativeSharpRasterFormat(sniffedFormat)) {
      return { ok: false, code: "unsupported_format" };
    }
    return { ok: true, bytes, sniffedFormat, usedHeicBridge: false };
  }

  const { bucket, path } = input.source;
  if (!bucket?.trim() || !path?.trim()) {
    return { ok: false, code: "corrupt_image" };
  }

  let original: Buffer;
  try {
    original = await storage.downloadObject({ bucket, path });
  } catch {
    return { ok: false, code: "decode_failed" };
  }

  if (!original || original.length === 0) {
    return { ok: false, code: "corrupt_image" };
  }
  if (original.length > maxIncomingBytes) {
    return { ok: false, code: "too_large_bytes" };
  }

  const sniffedFormat = sniffImageFormat(original);

  if (sniffedFormat === "heic_heif") {
    let transformed: Buffer;
    try {
      transformed = await storage.downloadTransformed({
        bucket,
        path,
        transform: HEIC_TRANSFORM,
      });
    } catch {
      return { ok: false, code: "heic_transform_failed" };
    }

    if (!transformed || transformed.length === 0) {
      return { ok: false, code: "heic_transform_failed" };
    }
    if (transformed.length > maxIncomingBytes) {
      return { ok: false, code: "too_large_bytes" };
    }

    const transformedFormat = sniffImageFormat(transformed);
    if (!isNativeSharpRasterFormat(transformedFormat)) {
      return { ok: false, code: "unexpected_transform_format" };
    }

    return {
      ok: true,
      bytes: transformed,
      sniffedFormat: "heic_heif",
      usedHeicBridge: true,
    };
  }

  const reject = rejectForSniffedFormat(sniffedFormat);
  if (reject) return { ok: false, code: reject };
  if (!isNativeSharpRasterFormat(sniffedFormat)) {
    return { ok: false, code: "unsupported_format" };
  }

  return {
    ok: true,
    bytes: original,
    sniffedFormat,
    usedHeicBridge: false,
  };
}

async function sharpNormalizeToMaster(args: {
  bytes: Buffer;
  maxPixels: number;
  maxLongEdge: number;
  jpegQuality: number;
}): Promise<
  | { ok: true; asset: NormalizedVictoryImageAsset }
  | { ok: false; code: VictoryMediaNormalizeErrorCode }
> {
  const { bytes, maxPixels, maxLongEdge, jpegQuality } = args;

  let meta: sharp.Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: maxPixels }).metadata();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/limitInputPixels|input image exceeds pixel limit/i.test(msg)) {
      return { ok: false, code: "too_many_pixels" };
    }
    return { ok: false, code: "decode_failed" };
  }

  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) {
    return { ok: false, code: "corrupt_image" };
  }
  if (width * height > maxPixels) {
    return { ok: false, code: "too_many_pixels" };
  }

  try {
    let pipeline = sharp(bytes, { limitInputPixels: maxPixels })
      .rotate()
      .toColorspace("srgb");

    if (meta.hasAlpha) {
      pipeline = pipeline.flatten({
        background: VICTORY_MEDIA_IMAGE_DEFAULTS.ALPHA_BACKGROUND,
      });
    }

    const masterBuf = await pipeline
      .resize({
        width: maxLongEdge,
        height: maxLongEdge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: jpegQuality, mozjpeg: true })
      .toBuffer();

    const outMeta = await sharp(masterBuf).metadata();
    const outW = outMeta.width ?? 0;
    const outH = outMeta.height ?? 0;
    if (!outW || !outH || outMeta.format !== "jpeg") {
      return { ok: false, code: "normalize_failed" };
    }

    return {
      ok: true,
      asset: {
        bytes: masterBuf,
        mime: "image/jpeg",
        width: outW,
        height: outH,
        byteSize: masterBuf.length,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/limitInputPixels|input image exceeds pixel limit/i.test(msg)) {
      return { ok: false, code: "too_many_pixels" };
    }
    return { ok: false, code: "normalize_failed" };
  }
}

async function createCardFromMaster(args: {
  masterBytes: Buffer;
  cardLongEdge: number;
  cardQuality: number;
  maxPixels: number;
}): Promise<
  | { ok: true; asset: NormalizedVictoryImageAsset }
  | { ok: false; code: VictoryMediaNormalizeErrorCode }
> {
  try {
    const cardBuf = await sharp(args.masterBytes, {
      limitInputPixels: args.maxPixels,
    })
      .resize({
        width: args.cardLongEdge,
        height: args.cardLongEdge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: args.cardQuality, mozjpeg: true })
      .toBuffer();

    const outMeta = await sharp(cardBuf).metadata();
    const outW = outMeta.width ?? 0;
    const outH = outMeta.height ?? 0;
    if (!outW || !outH || outMeta.format !== "jpeg") {
      return { ok: false, code: "normalize_failed" };
    }

    return {
      ok: true,
      asset: {
        bytes: cardBuf,
        mime: "image/jpeg",
        width: outW,
        height: outH,
        byteSize: cardBuf.length,
      },
    };
  } catch {
    return { ok: false, code: "normalize_failed" };
  }
}

/**
 * Normalize a Victory Media image to durable JPEG master + card.
 * Does not persist, upload, or mutate Storage/DB.
 */
export async function normalizeVictoryImage(
  input: NormalizeVictoryImageInput,
  deps: NormalizeVictoryImageDeps = {}
): Promise<NormalizeVictoryImageResult> {
  const maxIncomingBytes =
    input.maxIncomingBytes ?? VICTORY_MEDIA_IMAGE_DEFAULTS.MAX_INCOMING_BYTES;
  const maxPixels = input.maxPixels ?? VICTORY_MEDIA_IMAGE_DEFAULTS.MAX_PIXELS;
  const maxLongEdge = input.maxLongEdge ?? VICTORY_MEDIA_IMAGE_DEFAULTS.MAX_LONG_EDGE;
  const jpegQuality = input.jpegQuality ?? VICTORY_MEDIA_IMAGE_DEFAULTS.JPEG_QUALITY;
  const cardLongEdge = input.cardLongEdge ?? VICTORY_MEDIA_IMAGE_DEFAULTS.CARD_LONG_EDGE;
  const cardQuality = input.cardQuality ?? VICTORY_MEDIA_IMAGE_DEFAULTS.CARD_QUALITY;

  const storage = deps.storage ?? createDefaultStorageBridge();

  const resolved = await resolveRasterBytes(input, storage, maxIncomingBytes);
  if (!resolved.ok) return fail(resolved.code);

  const masterResult = await sharpNormalizeToMaster({
    bytes: resolved.bytes,
    maxPixels,
    maxLongEdge,
    jpegQuality,
  });
  if (!masterResult.ok) return fail(masterResult.code);

  const cardResult = await createCardFromMaster({
    masterBytes: masterResult.asset.bytes,
    cardLongEdge,
    cardQuality,
    maxPixels,
  });
  if (!cardResult.ok) return fail(cardResult.code);

  return {
    ok: true,
    master: masterResult.asset,
    card: cardResult.asset,
    source: {
      sniffedFormat: resolved.sniffedFormat,
      usedHeicBridge: resolved.usedHeicBridge,
    },
  };
}
