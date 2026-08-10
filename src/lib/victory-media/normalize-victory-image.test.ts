import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { normalizeVictoryImage } from "@/lib/victory-media/normalize-victory-image";
import type { VictoryMediaStorageBridge } from "@/lib/victory-media/image-types";
import { sniffImageFormat } from "@/lib/victory-media/sniff-image-format";

async function jpegBytes(opts?: {
  width?: number;
  height?: number;
  orientation?: number;
}): Promise<Buffer> {
  const width = opts?.width ?? 40;
  const height = opts?.height ?? 60;
  let pipeline = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 40, b: 40 },
    },
  }).jpeg({ quality: 90 });
  if (opts?.orientation != null) {
    pipeline = pipeline.withMetadata({ orientation: opts.orientation });
  }
  return pipeline.toBuffer();
}

async function pngBytes(opts?: {
  width?: number;
  height?: number;
  alpha?: boolean;
}): Promise<Buffer> {
  const width = opts?.width ?? 32;
  const height = opts?.height ?? 32;
  if (opts?.alpha) {
    return sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 255, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
  }
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 10, g: 120, b: 40 },
    },
  })
    .png()
    .toBuffer();
}

async function webpBytes(): Promise<Buffer> {
  return sharp({
    create: {
      width: 24,
      height: 24,
      channels: 3,
      background: { r: 20, g: 20, b: 200 },
    },
  })
    .webp({ quality: 80 })
    .toBuffer();
}

function heicFtypFixture(): Buffer {
  const parts = [
    Buffer.from("ftyp", "ascii"),
    Buffer.from("heic", "ascii"),
    Buffer.alloc(4),
    Buffer.from("mif1", "ascii"),
  ];
  const inner = Buffer.concat(parts);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(4 + inner.length, 0);
  return Buffer.concat([size, inner]);
}

function mockStorage(args: {
  original: Buffer;
  transformed?: Buffer;
  transformError?: boolean;
}): VictoryMediaStorageBridge {
  return {
    downloadObject: vi.fn(async () => args.original),
    downloadTransformed: vi.fn(async () => {
      if (args.transformError) throw new Error("transform_failed");
      if (!args.transformed) throw new Error("missing_transformed");
      return args.transformed;
    }),
  };
}

describe("normalizeVictoryImage", () => {
  it("JPEG → master/card JPEG with metadata stripped", async () => {
    const bytes = await jpegBytes({ width: 80, height: 120, orientation: 1 });
    const result = await normalizeVictoryImage({
      source: { kind: "bytes", bytes, originalFilename: "x.bin" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.master.mime).toBe("image/jpeg");
    expect(result.card.mime).toBe("image/jpeg");
    expect(result.master.width).toBe(80);
    expect(result.master.height).toBe(120);
    expect(result.card.width).toBeLessThanOrEqual(1280);
    expect(result.card.height).toBeLessThanOrEqual(1280);
    expect(result.source.sniffedFormat).toBe("jpeg");
    expect(result.source.usedHeicBridge).toBe(false);

    const masterMeta = await sharp(result.master.bytes).metadata();
    expect(masterMeta.format).toBe("jpeg");
    expect(masterMeta.exif).toBeUndefined();
    expect(masterMeta.orientation).toBeUndefined();
    expect(sniffImageFormat(result.master.bytes)).toBe("jpeg");
  });

  it("PNG → JPEG master/card", async () => {
    const bytes = await pngBytes({ width: 50, height: 40 });
    const result = await normalizeVictoryImage({
      source: { kind: "bytes", bytes, originalFilename: "photo.jpg" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.sniffedFormat).toBe("png");
    expect(result.master.mime).toBe("image/jpeg");
    expect(result.master.width).toBe(50);
    expect(result.master.height).toBe(40);
  });

  it("transparent PNG flattens to white", async () => {
    const bytes = await pngBytes({ width: 16, height: 16, alpha: true });
    const result = await normalizeVictoryImage({
      source: { kind: "bytes", bytes },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { data, info } = await sharp(result.master.bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBeGreaterThanOrEqual(3);
    // Fully transparent blue source → white after flatten.
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(255);
    expect(data[2]).toBe(255);
  });

  it("WebP → JPEG", async () => {
    const bytes = await webpBytes();
    const result = await normalizeVictoryImage({
      source: { kind: "bytes", bytes },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.sniffedFormat).toBe("webp");
    expect(result.master.mime).toBe("image/jpeg");
  });

  it("orientation=6 rotates to correct dimensions", async () => {
    // 40x60 with orientation 6 → display as 60x40 after rotate().
    const bytes = await jpegBytes({ width: 40, height: 60, orientation: 6 });
    const before = await sharp(bytes).metadata();
    expect(before.orientation).toBe(6);

    const result = await normalizeVictoryImage({
      source: { kind: "bytes", bytes },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.master.width).toBe(60);
    expect(result.master.height).toBe(40);
    const after = await sharp(result.master.bytes).metadata();
    expect(after.orientation).toBeUndefined();
  });

  it("does not enlarge small images", async () => {
    const bytes = await jpegBytes({ width: 100, height: 80 });
    const result = await normalizeVictoryImage({
      source: { kind: "bytes", bytes },
      maxLongEdge: 2048,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.master.width).toBe(100);
    expect(result.master.height).toBe(80);
  });

  it("rejects too many pixels via maxPixels", async () => {
    const bytes = await jpegBytes({ width: 50, height: 50 });
    const result = await normalizeVictoryImage({
      source: { kind: "bytes", bytes },
      maxPixels: 100,
    });
    expect(result).toEqual({ ok: false, code: "too_many_pixels" });
  });

  it("rejects >12MB before expensive decode", async () => {
    const huge = Buffer.alloc(12_000_001, 0);
    huge[0] = 0xff;
    huge[1] = 0xd8;
    huge[2] = 0xff;
    const result = await normalizeVictoryImage({
      source: { kind: "bytes", bytes: huge },
    });
    expect(result).toEqual({ ok: false, code: "too_large_bytes" });
  });

  it("rejects corrupt image bytes", async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);
    const result = await normalizeVictoryImage({
      source: { kind: "bytes", bytes },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(["corrupt_image", "decode_failed", "normalize_failed"]).toContain(result.code);
  });

  it("rejects GIF", async () => {
    const bytes = Buffer.from("GIF89a......");
    const result = await normalizeVictoryImage({
      source: { kind: "bytes", bytes },
    });
    expect(result).toEqual({ ok: false, code: "animated_gif_not_supported" });
  });

  it("rejects SVG (including .jpg filename)", async () => {
    const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const result = await normalizeVictoryImage({
      source: {
        kind: "bytes",
        bytes,
        originalFilename: "photo.jpg",
        declaredMime: "image/jpeg",
      },
    });
    expect(result).toEqual({ ok: false, code: "dangerous_svg" });
  });

  it("rejects AVIF as unsupported in V1 production path", async () => {
    const parts = [
      Buffer.from("ftyp", "ascii"),
      Buffer.from("avif", "ascii"),
      Buffer.alloc(4),
    ];
    const inner = Buffer.concat(parts);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(4 + inner.length, 0);
    const bytes = Buffer.concat([size, inner]);
    const result = await normalizeVictoryImage({
      source: { kind: "bytes", bytes },
    });
    expect(result).toEqual({ ok: false, code: "unsupported_format" });
  });

  it("HEIC raw bytes require storage source", async () => {
    const bytes = heicFtypFixture();
    expect(sniffImageFormat(bytes)).toBe("heic_heif");
    const result = await normalizeVictoryImage({
      source: { kind: "bytes", bytes, originalFilename: "IMG_4383.HEIC" },
    });
    expect(result).toEqual({ ok: false, code: "heic_requires_storage_source" });
  });

  it("HEIC storage source → transformed JPEG → master/card", async () => {
    const original = heicFtypFixture();
    const transformed = await jpegBytes({ width: 90, height: 120 });
    const storage = mockStorage({ original, transformed });

    const result = await normalizeVictoryImage(
      {
        source: {
          kind: "supabase_object",
          bucket: "any-private-bucket",
          path: "uploads/IMG_4383.HEIC",
        },
      },
      { storage }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source.sniffedFormat).toBe("heic_heif");
    expect(result.source.usedHeicBridge).toBe(true);
    expect(result.master.mime).toBe("image/jpeg");
    expect(result.master.width).toBe(90);
    expect(result.master.height).toBe(120);
    expect(result.card.width).toBeLessThanOrEqual(1280);
    expect(storage.downloadObject).toHaveBeenCalledOnce();
    expect(storage.downloadTransformed).toHaveBeenCalledWith({
      bucket: "any-private-bucket",
      path: "uploads/IMG_4383.HEIC",
      transform: {
        width: 2048,
        height: 2048,
        resize: "contain",
        quality: 85,
      },
    });
  });

  it("HEIC transform failure → heic_transform_failed", async () => {
    const storage = mockStorage({
      original: heicFtypFixture(),
      transformError: true,
    });
    const result = await normalizeVictoryImage(
      {
        source: {
          kind: "supabase_object",
          bucket: "b",
          path: "p.HEIC",
        },
      },
      { storage }
    );
    expect(result).toEqual({ ok: false, code: "heic_transform_failed" });
  });

  it("unexpected transform format → unexpected_transform_format", async () => {
    const storage = mockStorage({
      original: heicFtypFixture(),
      transformed: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    });
    const result = await normalizeVictoryImage(
      {
        source: { kind: "supabase_object", bucket: "b", path: "p.HEIC" },
      },
      { storage }
    );
    expect(result).toEqual({ ok: false, code: "unexpected_transform_format" });
  });
});
