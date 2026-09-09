import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SOCIAL_BIO_REDIRECTS } from "@/lib/social-bio-redirects";

const ROOT = process.cwd();

function destinationFor(source: string): string | undefined {
  return SOCIAL_BIO_REDIRECTS.find((row) => row.source === source)?.destination;
}

describe("social bio bio-link redirects", () => {
  it("maps /instagram to the Instagram bio UTM homepage", () => {
    expect(destinationFor("/instagram")).toBe(
      "/?utm_source=instagram&utm_medium=organic_social&utm_campaign=organic&utm_content=bio"
    );
  });

  it("maps /facebook to the Facebook bio UTM homepage", () => {
    expect(destinationFor("/facebook")).toBe(
      "/?utm_source=facebook&utm_medium=organic_social&utm_campaign=organic&utm_content=bio"
    );
  });

  it("maps /tiktok to the TikTok bio UTM homepage", () => {
    expect(destinationFor("/tiktok")).toBe(
      "/?utm_source=tiktok&utm_medium=organic_social&utm_campaign=organic&utm_content=bio"
    );
  });

  it("maps /x to the X bio UTM homepage", () => {
    expect(destinationFor("/x")).toBe(
      "/?utm_source=x&utm_medium=organic_social&utm_campaign=organic&utm_content=bio"
    );
  });

  it("maps /twitter to the same X bio UTM homepage", () => {
    expect(destinationFor("/twitter")).toBe(destinationFor("/x"));
    expect(destinationFor("/twitter")).toBe(
      "/?utm_source=x&utm_medium=organic_social&utm_campaign=organic&utm_content=bio"
    );
  });

  it("is wired as temporary next.config redirects only", () => {
    const nextConfig = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    expect(nextConfig).toContain("SOCIAL_BIO_REDIRECTS");
    expect(nextConfig).toContain("async redirects()");
    expect(SOCIAL_BIO_REDIRECTS.every((row) => row.permanent === false)).toBe(true);
    expect(SOCIAL_BIO_REDIRECTS).toHaveLength(5);
  });
});
