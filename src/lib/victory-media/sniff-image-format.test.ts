import { describe, expect, it } from "vitest";

import { VICTORY_MEDIA_ALLOWED_UPLOAD_MIMES } from "@/lib/victory-media/constants";
import {
  sniffImageFormat,
  storageMimeForSniffedImageFormat,
} from "@/lib/victory-media/sniff-image-format";

function ftypBox(major: string, compat: string[] = []): Buffer {
  const parts = [
    Buffer.from("ftyp", "ascii"),
    Buffer.from(major.padEnd(4, " ").slice(0, 4), "ascii"),
    Buffer.alloc(4), // minor_version
    ...compat.map((c) => Buffer.from(c.padEnd(4, " ").slice(0, 4), "ascii")),
  ];
  const inner = Buffer.concat(parts);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(4 + inner.length, 0);
  return Buffer.concat([size, inner]);
}

describe("sniffImageFormat", () => {
  it("recognizes JPEG magic", () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(sniffImageFormat(bytes)).toBe("jpeg");
  });

  it("recognizes PNG magic", () => {
    const bytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ]);
    expect(sniffImageFormat(bytes)).toBe("png");
  });

  it("recognizes WebP RIFF container", () => {
    const bytes = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0x10, 0x00, 0x00, 0x00]),
      Buffer.from("WEBP", "ascii"),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
    ]);
    expect(sniffImageFormat(bytes)).toBe("webp");
  });

  it("recognizes GIF87a / GIF89a", () => {
    expect(sniffImageFormat(Buffer.from("GIF87a......"))).toBe("gif");
    expect(sniffImageFormat(Buffer.from("GIF89a......"))).toBe("gif");
  });

  it("recognizes HEIC ftyp brands", () => {
    expect(sniffImageFormat(ftypBox("heic"))).toBe("heic_heif");
    expect(sniffImageFormat(ftypBox("mif1", ["heic"]))).toBe("heic_heif");
    expect(sniffImageFormat(ftypBox("msf1", ["heix"]))).toBe("heic_heif");
  });

  it("distinguishes AVIF ftyp from HEIC (including shared mif1)", () => {
    expect(sniffImageFormat(ftypBox("avif"))).toBe("avif");
    expect(sniffImageFormat(ftypBox("avis"))).toBe("avif");
    // AVIF often uses mif1 major with avif compat — must not classify as HEIC.
    expect(sniffImageFormat(ftypBox("mif1", ["avif", "miaf"]))).toBe("avif");
  });

  it("recognizes SVG after BOM/whitespace and xml prologue", () => {
    expect(sniffImageFormat(Buffer.from("  \n<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBe(
      "svg"
    );
    expect(
      sniffImageFormat(
        Buffer.from('\uFEFF<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')
      )
    ).toBe("svg");
  });

  it("returns unknown for empty/short/unrecognized", () => {
    expect(sniffImageFormat(Buffer.alloc(0))).toBe("unknown");
    expect(sniffImageFormat(Buffer.from([0x00, 0x01]))).toBe("unknown");
    expect(sniffImageFormat(Buffer.from("not-an-image"))).toBe("unknown");
  });

  it("ignores filename-like context: PNG bytes remain PNG", () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ]);
    // Callers may pass originalFilename photo.jpg — sniff still uses bytes.
    expect(sniffImageFormat(png)).toBe("png");
  });

  it("does not treat corrupt near-JPEG as JPEG", () => {
    // Missing third FF.
    expect(sniffImageFormat(Buffer.from([0xff, 0xd8, 0x00, 0x00]))).toBe("unknown");
  });
});

describe("storageMimeForSniffedImageFormat", () => {
  it("maps supported sniffs to bucket-allowed Storage MIME", () => {
    expect(storageMimeForSniffedImageFormat("jpeg")).toBe("image/jpeg");
    expect(storageMimeForSniffedImageFormat("png")).toBe("image/png");
    expect(storageMimeForSniffedImageFormat("webp")).toBe("image/webp");
    expect(storageMimeForSniffedImageFormat("heic_heif")).toBe("image/heic");
    for (const mime of [
      storageMimeForSniffedImageFormat("jpeg"),
      storageMimeForSniffedImageFormat("png"),
      storageMimeForSniffedImageFormat("webp"),
      storageMimeForSniffedImageFormat("heic_heif"),
    ]) {
      expect(VICTORY_MEDIA_ALLOWED_UPLOAD_MIMES).toContain(mime);
    }
  });

  it("returns null for unsupported sniffs (no Storage MIME)", () => {
    expect(storageMimeForSniffedImageFormat("gif")).toBeNull();
    expect(storageMimeForSniffedImageFormat("svg")).toBeNull();
    expect(storageMimeForSniffedImageFormat("avif")).toBeNull();
    expect(storageMimeForSniffedImageFormat("unknown")).toBeNull();
  });

  it("does not emit application/octet-stream", () => {
    const formats = [
      "jpeg",
      "png",
      "webp",
      "heic_heif",
      "gif",
      "svg",
      "avif",
      "unknown",
    ] as const;
    for (const format of formats) {
      expect(storageMimeForSniffedImageFormat(format)).not.toBe(
        "application/octet-stream"
      );
    }
  });
});
