import type { CSSProperties } from "react";

/** Narrower than this is a portrait or cutout. Matches the measured runtime split. */
export const PORTRAIT_MAX_RATIO = 0.85;
/** Through this ratio, treat the image as square-ish. */
export const SQUARE_MAX_RATIO = 1.25;
/**
 * Do not enlarge a file whose longest side is under this.
 * The common lesson photos are 1680px wide; the small scans are not.
 */
export const LOW_RES_LONGEST_SIDE = 800;
/** Banners and other very wide frames span a gallery row instead of a cell. */
export const GALLERY_WIDE_RATIO = 2.2;

export type ImageFrameKind = "portrait" | "square" | "landscape";

export type ImageFrame = {
  kind: ImageFrameKind;
  frameClassName: string;
  imageClassName: string;
  imageStyle: CSSProperties;
  sizes: string;
};

export function imageFrameKind(width: number, height: number): ImageFrameKind {
  const ratio = width / height;
  if (ratio < PORTRAIT_MAX_RATIO) return "portrait";
  if (ratio <= SQUARE_MAX_RATIO) return "square";
  return "landscape";
}

/** Pixel width cap for a small source. Null when the file can fill its layout slot. */
export function sourceWidthCap(width: number, height: number): number | null {
  if (Math.max(width, height) < LOW_RES_LONGEST_SIDE) return width;
  return null;
}

export function imageFrame(width: number, height: number): ImageFrame {
  const kind = imageFrameKind(width, height);
  const cap = sourceWidthCap(width, height);
  const imageClassName = "block h-auto object-contain";

  if (kind === "portrait") {
    const maxWidth = cap == null ? "22rem" : `min(22rem, ${cap}px)`;
    return {
      kind,
      frameClassName: "mx-auto w-fit max-w-full",
      imageClassName,
      imageStyle: { width: "auto", height: "auto", maxWidth, maxHeight: "32rem" },
      sizes: "22rem",
    };
  }

  if (kind === "square") {
    const maxWidth = cap == null ? "28rem" : `min(28rem, ${cap}px)`;
    return {
      kind,
      frameClassName: "mx-auto w-full",
      imageClassName: `${imageClassName} mx-auto w-full`,
      imageStyle: { width: "100%", height: "auto", maxWidth },
      sizes: "(min-width: 768px) 28rem, 100vw",
    };
  }

  if (cap == null) {
    return {
      kind,
      frameClassName: "w-full",
      imageClassName: `${imageClassName} w-full`,
      imageStyle: { width: "100%", height: "auto" },
      sizes: "(min-width: 768px) 45rem, 100vw",
    };
  }

  return {
    kind,
    frameClassName: "mx-auto w-fit max-w-full",
    imageClassName,
    imageStyle: { width: "auto", height: "auto", maxWidth: `${cap}px` },
    sizes: `${cap}px`,
  };
}

export type GalleryLayoutKind = "portraits" | "landscapes";

export function galleryLayout(images: Array<{ width: number; height: number }>): {
  kind: GalleryLayoutKind;
  listClassName: string;
} {
  const portraits = images.filter((image) => image.width / image.height < PORTRAIT_MAX_RATIO).length;
  const majorityPortrait = images.length > 0 && portraits * 2 >= images.length;
  if (majorityPortrait && images.length >= 6) {
    return { kind: "portraits", listClassName: "grid list-none grid-cols-2 gap-3 sm:grid-cols-4" };
  }
  if (majorityPortrait && images.length >= 3) {
    return { kind: "portraits", listClassName: "grid list-none grid-cols-2 gap-3 sm:grid-cols-3" };
  }
  return { kind: "landscapes", listClassName: "grid list-none grid-cols-1 gap-4 sm:grid-cols-2" };
}

export function galleryItemClassName(
  image: { width: number; height: number },
  images: Array<{ width: number; height: number }>
): string {
  if (image.width / image.height <= GALLERY_WIDE_RATIO) return "min-w-0";
  const layout = galleryLayout(images);
  if (layout.listClassName.includes("sm:grid-cols-4")) return "col-span-2 min-w-0 sm:col-span-4";
  if (layout.listClassName.includes("sm:grid-cols-3")) return "col-span-2 min-w-0 sm:col-span-3";
  return "min-w-0 sm:col-span-2";
}

export function galleryImageStyle(width: number, height: number): CSSProperties {
  const cap = sourceWidthCap(width, height);
  return {
    width: "100%",
    height: "auto",
    ...(cap == null ? {} : { maxWidth: `${cap}px` }),
  };
}
