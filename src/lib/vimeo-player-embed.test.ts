import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildVimeoPlayerEmbedUrl } from "@/lib/vimeo-player-embed";

const root = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

const EMBED_SURFACES = [
  "src/app/film-room/[id]/page.tsx",
  "src/app/coach-leadership-kit/how-it-works/page.tsx",
  "src/app/challenge/day/[day]/page.tsx",
] as const;

describe("buildVimeoPlayerEmbedUrl", () => {
  it("builds HTTPS player URLs with dnt=1 for valid numeric IDs", () => {
    expect(buildVimeoPlayerEmbedUrl("1151027178")).toBe(
      "https://player.vimeo.com/video/1151027178?dnt=1"
    );
    expect(buildVimeoPlayerEmbedUrl(1151027178)).toBe(
      "https://player.vimeo.com/video/1151027178?dnt=1"
    );
    expect(buildVimeoPlayerEmbedUrl("  42  ")).toBe(
      "https://player.vimeo.com/video/42?dnt=1"
    );
  });

  it("fails safely for invalid or absent IDs", () => {
    expect(buildVimeoPlayerEmbedUrl(null)).toBeNull();
    expect(buildVimeoPlayerEmbedUrl(undefined)).toBeNull();
    expect(buildVimeoPlayerEmbedUrl("")).toBeNull();
    expect(buildVimeoPlayerEmbedUrl("abc")).toBeNull();
    expect(buildVimeoPlayerEmbedUrl("12abc")).toBeNull();
    expect(buildVimeoPlayerEmbedUrl("user_clerk")).toBeNull();
  });

  it("never adds autoplay=1 or identity fields", () => {
    const url = buildVimeoPlayerEmbedUrl("123")!;
    expect(url).not.toMatch(/autoplay=1/i);
    expect(url).not.toMatch(/email|phone|user_id|clerk|token/i);
    expect(url.startsWith("https://player.vimeo.com/video/")).toBe(true);
    expect(url).toContain("dnt=1");
  });
});

describe("Vimeo embed surfaces", () => {
  it("uses the shared helper on all three iframe surfaces", () => {
    for (const rel of EMBED_SURFACES) {
      const src = readSrc(rel);
      expect(src).toContain("buildVimeoPlayerEmbedUrl");
      expect(src).not.toMatch(
        /src=\{`https:\/\/player\.vimeo\.com\/video\/\$\{/
      );
      expect(src).not.toMatch(
        /src="https:\/\/player\.vimeo\.com\/video\//
      );
    }
  });

  it("requires iframe titles and HTTPS dnt player URLs via helper", () => {
    for (const rel of EMBED_SURFACES) {
      const src = readSrc(rel);
      expect(src).toMatch(/title=\{iframeTitle\}|title=\{[^}]+\}/);
      expect(src).toContain("allowFullScreen");
      expect(src).not.toMatch(/autoplay=1/);
      expect(src).not.toMatch(/http:\/\/player\.vimeo\.com/);
    }
  });

  it("Film Room list keeps thumbnails and has no player iframe", () => {
    const list = readSrc("src/app/film-room/page.tsx");
    expect(list).toContain("thumbnail_url");
    expect(list).not.toContain("player.vimeo.com");
    expect(list).not.toContain("buildVimeoPlayerEmbedUrl");
    expect(list).not.toMatch(/<iframe/);
  });
});

describe("Privacy Policy Vimeo disclosure", () => {
  const privacy = readSrc("src/app/privacy/page.tsx");

  it("names Vimeo and describes technical/playback data", () => {
    expect(privacy).toContain("Vimeo");
    expect(privacy).toMatch(/Film Room/i);
    expect(privacy).toMatch(/technical and\s+device information/i);
    expect(privacy).toMatch(/playback or\s+interaction/i);
    expect(privacy).toMatch(/cookies or similar identifiers/i);
    expect(privacy).toMatch(/Do Not Track/i);
  });

  it("does not claim anonymous, cookie-free, or full Vimeo deletion via Summitt", () => {
    expect(privacy).not.toMatch(/\banonymous\b/i);
    expect(privacy).not.toMatch(/cookie-free/i);
    expect(privacy).toMatch(
      /does not guarantee zero technical\s+logging/i
    );
    expect(privacy).toMatch(
      /does not claim to erase\s+technical logs retained independently by Vimeo/i
    );
    expect(privacy).toMatch(/does not place journals/i);
    expect(privacy).toMatch(/Clerk user IDs/i);
  });
});

