import { readFileSync } from "node:fs";
import path from "node:path";
import { imageSize } from "image-size";

/**
 * Pixel size of a curated public lesson image.
 * EXIF orientations 5–8 swap the stored width and height so layout matches
 * the picture after the browser rotates it.
 */
export function readPublicLearningImageSize(src: string): { width: number; height: number } {
  if (!src.startsWith("/learning/") || src.includes("..") || src.includes("\\")) {
    throw new Error(`Invalid curriculum image path ${src}`);
  }
  const file = path.join(process.cwd(), "public", src.slice(1));
  let measured: { width?: number; height?: number; orientation?: number };
  try {
    measured = imageSize(readFileSync(file));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unreadable";
    throw new Error(`Invalid curriculum image ${src}: ${detail}`);
  }
  let width = measured.width ?? 0;
  let height = measured.height ?? 0;
  const orientation = measured.orientation ?? 1;
  if (orientation >= 5 && orientation <= 8) {
    const swapped = width;
    width = height;
    height = swapped;
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error(`Invalid curriculum image ${src}: missing dimensions`);
  }
  return { width: Math.round(width), height: Math.round(height) };
}
