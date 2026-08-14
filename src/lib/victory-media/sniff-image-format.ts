/**
 * Narrow deterministic image-container sniff for Victory Media.
 * Extension and declared MIME are irrelevant — bytes only.
 */

import type { VictoryMediaAllowedUploadMime } from "@/lib/victory-media/constants";
import type { SniffedImageFormat } from "@/lib/victory-media/image-types";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
  "heif",
]);

const AVIF_BRANDS = new Set(["avif", "avis"]);

function readAscii(buf: Buffer, start: number, end: number): string {
  return buf.toString("ascii", start, end);
}

function parseFtypBrands(buf: Buffer): string[] | null {
  if (buf.length < 16) return null;
  if (readAscii(buf, 4, 8) !== "ftyp") return null;

  const boxSize = buf.readUInt32BE(0);
  const limit =
    boxSize >= 8 && boxSize <= buf.length ? boxSize : Math.min(buf.length, 256);

  const brands: string[] = [];
  const major = readAscii(buf, 8, 12);
  if (major.length === 4) brands.push(major);

  // Compatible brands start after major (8..12) + minor_version (12..16).
  for (let offset = 16; offset + 4 <= limit; offset += 4) {
    const brand = readAscii(buf, offset, offset + 4);
    if (brand.trim().length === 0) continue;
    brands.push(brand);
  }
  return brands;
}

function hasBrand(brands: string[], set: Set<string>): boolean {
  return brands.some((b) => set.has(b.toLowerCase()));
}

function sniffSvg(buf: Buffer): boolean {
  // Skip UTF-8 BOM and leading whitespace.
  let i = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    i = 3;
  }
  while (i < buf.length) {
    const c = buf[i]!;
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
      i += 1;
      continue;
    }
    break;
  }
  const head = buf.slice(i, Math.min(buf.length, i + 256)).toString("utf8");
  const lower = head.toLowerCase();
  if (lower.startsWith("<svg")) return true;
  if (lower.startsWith("<?xml")) {
    return /<svg[\s>]/i.test(head);
  }
  return false;
}

/**
 * Sniff image/container format from actual bytes.
 * Returns a narrow enum; never trusts filename/MIME.
 */
export function sniffImageFormat(bytes: Buffer): SniffedImageFormat {
  if (!bytes || bytes.length < 3) return "unknown";

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }

  // PNG
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIG)) {
    return "png";
  }

  // GIF
  if (bytes.length >= 6) {
    const gif = readAscii(bytes, 0, 6);
    if (gif === "GIF87a" || gif === "GIF89a") return "gif";
  }

  // WebP: RIFF....WEBP
  if (
    bytes.length >= 12 &&
    readAscii(bytes, 0, 4) === "RIFF" &&
    readAscii(bytes, 8, 12) === "WEBP"
  ) {
    return "webp";
  }

  // ISO BMFF ftyp — AVIF before HEIF (mif1 is shared).
  const brands = parseFtypBrands(bytes);
  if (brands) {
    if (hasBrand(brands, AVIF_BRANDS)) return "avif";
    if (hasBrand(brands, HEIF_BRANDS)) return "heic_heif";
    return "unknown";
  }

  // SVG (text) — after binary magics so we don't misread binary as utf8 heavily.
  if (sniffSvg(bytes)) return "svg";

  return "unknown";
}

export function isNativeSharpRasterFormat(
  format: SniffedImageFormat
): format is "jpeg" | "png" | "webp" {
  return format === "jpeg" || format === "png" || format === "webp";
}

/**
 * Canonical private Storage contentType from sniffed bytes.
 * Declared MIME and HTTP response MIME are not inputs.
 *
 * sniffImageFormat returns a combined `heic_heif` — it does not distinguish
 * HEIC vs HEIF containers. Existing PATH B (`normalizeVictoryImage` with
 * `kind: "supabase_object"`) is likewise unified: byte sniff of `heic_heif`
 * triggers the Storage transform bridge regardless of container brand.
 * `image/heic` is the existing allowed bucket MIME used by the web HEIC
 * temp-object contract and is accepted by victory-media.
 */
export function storageMimeForSniffedImageFormat(
  format: SniffedImageFormat
): VictoryMediaAllowedUploadMime | null {
  switch (format) {
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "heic_heif":
      return "image/heic";
    case "gif":
    case "svg":
    case "avif":
    case "unknown":
      return null;
  }
}
