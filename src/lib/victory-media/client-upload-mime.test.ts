import { describe, expect, it } from "vitest";

import {
  canPreviewVictoryMediaClientMime,
  resolveVictoryMediaClientMime,
} from "@/lib/victory-media/client-upload-mime";

describe("resolveVictoryMediaClientMime", () => {
  it("MIME wins when supported", () => {
    expect(
      resolveVictoryMediaClientMime({ name: "x.heic", type: "image/jpeg" })
    ).toBe("image/jpeg");
    expect(
      resolveVictoryMediaClientMime({ name: "x.bin", type: " image/PNG " })
    ).toBe("image/png");
  });

  it("blank type + HEIC / HEIF from extension", () => {
    expect(resolveVictoryMediaClientMime({ name: "Shot.HEIC", type: "" })).toBe(
      "image/heic"
    );
    expect(resolveVictoryMediaClientMime({ name: "Shot.heif", type: "  " })).toBe(
      "image/heif"
    );
  });

  it("uppercase extension maps", () => {
    expect(resolveVictoryMediaClientMime({ name: "A.JPG", type: "" })).toBe(
      "image/jpeg"
    );
    expect(resolveVictoryMediaClientMime({ name: "A.JPEG", type: "" })).toBe(
      "image/jpeg"
    );
    expect(resolveVictoryMediaClientMime({ name: "A.WEBP", type: "" })).toBe(
      "image/webp"
    );
  });

  it("JPG/JPEG/PNG/WebP from extension", () => {
    expect(resolveVictoryMediaClientMime({ name: "a.jpg", type: "" })).toBe(
      "image/jpeg"
    );
    expect(resolveVictoryMediaClientMime({ name: "a.jpeg", type: "" })).toBe(
      "image/jpeg"
    );
    expect(resolveVictoryMediaClientMime({ name: "a.png", type: "" })).toBe(
      "image/png"
    );
    expect(resolveVictoryMediaClientMime({ name: "a.webp", type: "" })).toBe(
      "image/webp"
    );
  });

  it("rejects GIF / AVIF / SVG / unknown", () => {
    expect(resolveVictoryMediaClientMime({ name: "a.gif", type: "image/gif" })).toBeNull();
    expect(resolveVictoryMediaClientMime({ name: "a.gif", type: "" })).toBeNull();
    expect(resolveVictoryMediaClientMime({ name: "a.avif", type: "image/avif" })).toBeNull();
    expect(resolveVictoryMediaClientMime({ name: "a.svg", type: "image/svg+xml" })).toBeNull();
    expect(resolveVictoryMediaClientMime({ name: "a.mov", type: "" })).toBeNull();
    expect(resolveVictoryMediaClientMime({ name: "noext", type: "" })).toBeNull();
  });
});

describe("canPreviewVictoryMediaClientMime", () => {
  it("allows jpeg/png/webp only", () => {
    expect(canPreviewVictoryMediaClientMime("image/jpeg")).toBe(true);
    expect(canPreviewVictoryMediaClientMime("image/png")).toBe(true);
    expect(canPreviewVictoryMediaClientMime("image/webp")).toBe(true);
    expect(canPreviewVictoryMediaClientMime("image/heic")).toBe(false);
    expect(canPreviewVictoryMediaClientMime("image/heif")).toBe(false);
    expect(canPreviewVictoryMediaClientMime(null)).toBe(false);
  });
});
