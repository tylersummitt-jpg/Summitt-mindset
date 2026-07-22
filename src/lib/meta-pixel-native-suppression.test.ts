import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getMetaPixelId, isMetaPixelEnabled } from "@/lib/meta-pixel";
import { getMetaPageViewDecision } from "@/lib/meta-pixel-route-policy";
import {
  detectSummittMindsetPlatform,
  isNativeSummittMindsetApp,
  SUMMITT_MINDSET_ANDROID_UA_TOKEN,
  SUMMITT_MINDSET_IOS_UA_TOKEN,
} from "@/lib/native-app/platform";

const root = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("native Meta Pixel suppression (layout wiring)", () => {
  it("RootLayout gates MetaPixelRoot on the canonical native-app boolean", () => {
    const layout = readSrc("src/app/layout.tsx");
    expect(layout).toContain("isNativeSummittMindsetAppRequest");
    expect(layout).toContain(
      "isNativeSummittMindsetApp={isNativeSummittMindsetApp}"
    );
    expect(layout).toContain(
      "!isNativeSummittMindsetApp ? <MetaPixelRoot /> : null"
    );
    expect(layout).not.toMatch(
      /NativeAppProvider[\s\S]*?>\s*<MetaPixelRoot\s*\/>/
    );
  });

  it("does not introduce a second UA detector or client/query spoof gate for Pixel", () => {
    const layout = readSrc("src/app/layout.tsx");
    const pixelRoot = readSrc("src/components/MetaPixelRoot.tsx");
    expect(layout).not.toMatch(/navigator\.userAgent/);
    expect(pixelRoot).not.toMatch(/navigator\.userAgent/);
    expect(pixelRoot).not.toMatch(/native=1/);
    expect(layout).not.toMatch(/native=1/);
    expect(pixelRoot).not.toMatch(/localStorage|document\.cookie/);
  });

  it("MetaPixelRoot still loads fbevents.js when rendered (browser path unchanged)", () => {
    const pixelRoot = readSrc("src/components/MetaPixelRoot.tsx");
    expect(pixelRoot).toContain("connect.facebook.net");
    expect(pixelRoot).toContain("fbevents.js");
    expect(pixelRoot).toContain("fbq");
    expect(pixelRoot).toContain("getMetaPixelId");
    expect(pixelRoot).toContain("isMetaPixelEnabled");
  });

  it("suppresses Meta for iOS and Android markers; not for browser UA", () => {
    expect(SUMMITT_MINDSET_IOS_UA_TOKEN).toBe("SummittMindsetiOS");
    expect(SUMMITT_MINDSET_ANDROID_UA_TOKEN).toBe("SummittMindsetAndroid");
    expect(
      isNativeSummittMindsetApp(
        "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 SummittMindsetiOS"
      )
    ).toBe(true);
    expect(
      isNativeSummittMindsetApp(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 SummittMindsetAndroid"
      )
    ).toBe(true);
    expect(
      isNativeSummittMindsetApp("Mozilla/5.0 (iPhone) AppleWebKit/605.1.15")
    ).toBe(false);
    expect(detectSummittMindsetPlatform("?native=1")).toBe("none");
  });

  it("covers native shell routes via global layout gate (sign-in, membership, user, home)", () => {
    const layout = readSrc("src/app/layout.tsx");
    expect(layout).toContain(
      "!isNativeSummittMindsetApp ? <MetaPixelRoot /> : null"
    );
    for (const route of [
      "src/app/app/sign-in/page.tsx",
      "src/app/app/membership/page.tsx",
      "src/app/user/[[...user]]/user-account-client.tsx",
      "src/app/page.tsx",
    ]) {
      const src = readSrc(route);
      expect(src.length).toBeGreaterThan(0);
      expect(src).not.toContain("MetaPixelRoot");
      expect(src).not.toContain("connect.facebook.net");
      expect(src).not.toContain("fbevents.js");
    }
  });
});

describe("browser Meta Pixel env + policy preserved", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_META_PIXEL_ID;
    delete process.env.NEXT_PUBLIC_META_PIXEL_ENABLED;
  });

  it("valid ID with ENABLED unset keeps Pixel enabled for browser helpers", () => {
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "1234567890";
    delete process.env.NEXT_PUBLIC_META_PIXEL_ENABLED;
    expect(getMetaPixelId()).toBe("1234567890");
    expect(isMetaPixelEnabled()).toBe(true);
  });

  it("missing or invalid ID is a safe no-op", () => {
    delete process.env.NEXT_PUBLIC_META_PIXEL_ID;
    expect(getMetaPixelId()).toBeNull();
    expect(isMetaPixelEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_META_PIXEL_ID = "not-a-number";
    expect(getMetaPixelId()).toBeNull();
    expect(isMetaPixelEnabled()).toBe(false);
  });

  it("ENABLED=false disables even with valid ID", () => {
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "1234567890";
    process.env.NEXT_PUBLIC_META_PIXEL_ENABLED = "false";
    expect(isMetaPixelEnabled()).toBe(false);
  });

  it("PageView route policy is unchanged (marketing allow / app block)", () => {
    expect(getMetaPageViewDecision("/", "").action).toBe("allow");
    expect(getMetaPageViewDecision("/subscribe", "").action).toBe("allow");
    expect(getMetaPageViewDecision("/app/sign-in", "").action).toBe("block");
    expect(getMetaPageViewDecision("/app/membership", "").action).toBe("block");
    expect(getMetaPageViewDecision("/user", "").action).toBe("block");
  });
});
