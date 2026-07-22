import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SUMMITT_MINDSET_ANDROID_UA_TOKEN,
  SUMMITT_MINDSET_IOS_UA_TOKEN,
  detectSummittMindsetPlatform,
  isNativeSummittMindsetApp,
} from "@/lib/native-app/platform";
import { isNativeSummittMindsetIosUserAgent } from "@/lib/native-app/ua-token";

const root = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const ANDROID_WEBVIEW =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36";

describe("detectSummittMindsetPlatform", () => {
  it("maps exact iOS marker to ios", () => {
    expect(detectSummittMindsetPlatform(SUMMITT_MINDSET_IOS_UA_TOKEN)).toBe(
      "ios"
    );
    expect(SUMMITT_MINDSET_IOS_UA_TOKEN).toBe("SummittMindsetiOS");
  });

  it("maps exact Android marker to android", () => {
    expect(
      detectSummittMindsetPlatform(SUMMITT_MINDSET_ANDROID_UA_TOKEN)
    ).toBe("android");
    expect(SUMMITT_MINDSET_ANDROID_UA_TOKEN).toBe("SummittMindsetAndroid");
  });

  it("detects markers appended to realistic Safari / Android WebView UAs", () => {
    expect(
      detectSummittMindsetPlatform(`${SAFARI_IPHONE} SummittMindsetiOS`)
    ).toBe("ios");
    expect(
      detectSummittMindsetPlatform(`${ANDROID_WEBVIEW} SummittMindsetAndroid`)
    ).toBe("android");
  });

  it("maps ordinary browsers without markers to none", () => {
    expect(detectSummittMindsetPlatform(SAFARI_IPHONE)).toBe("none");
    expect(detectSummittMindsetPlatform(ANDROID_CHROME)).toBe("none");
    expect(detectSummittMindsetPlatform(DESKTOP_CHROME)).toBe("none");
  });

  it("maps empty / undefined / absent input to none", () => {
    expect(detectSummittMindsetPlatform("")).toBe("none");
    expect(detectSummittMindsetPlatform(null)).toBe("none");
    expect(detectSummittMindsetPlatform(undefined)).toBe("none");
  });

  it("rejects unrelated lookalike strings", () => {
    expect(detectSummittMindsetPlatform("SummittMindset")).toBe("none");
    expect(detectSummittMindsetPlatform("summittmindsetios")).toBe("none");
    expect(detectSummittMindsetPlatform("SummittMindsetIOS")).toBe("none");
    expect(detectSummittMindsetPlatform("SummittMindsetANDROID")).toBe("none");
    expect(detectSummittMindsetPlatform("summittmindsetandroid")).toBe("none");
    expect(detectSummittMindsetPlatform("Summitt Mindset Android")).toBe(
      "none"
    );
    expect(detectSummittMindsetPlatform("?native=1")).toBe("none");
  });

  it("prefers ios when both markers somehow appear (deterministic)", () => {
    expect(
      detectSummittMindsetPlatform(
        "SummittMindsetAndroid SummittMindsetiOS"
      )
    ).toBe("ios");
  });
});

describe("isNativeSummittMindsetApp", () => {
  it("is true for ios and android, false for none", () => {
    expect(isNativeSummittMindsetApp(`${SAFARI_IPHONE} SummittMindsetiOS`)).toBe(
      true
    );
    expect(
      isNativeSummittMindsetApp(`${ANDROID_WEBVIEW} SummittMindsetAndroid`)
    ).toBe(true);
    expect(isNativeSummittMindsetApp(SAFARI_IPHONE)).toBe(false);
    expect(isNativeSummittMindsetApp(ANDROID_CHROME)).toBe(false);
    expect(isNativeSummittMindsetApp("")).toBe(false);
    expect(isNativeSummittMindsetApp(null)).toBe(false);
  });
});

describe("iOS wrapper remains platform === ios only", () => {
  it("does not treat Android marker as iOS", () => {
    expect(
      isNativeSummittMindsetIosUserAgent(
        `${ANDROID_WEBVIEW} SummittMindsetAndroid`
      )
    ).toBe(false);
    expect(
      isNativeSummittMindsetIosUserAgent(`${SAFARI_IPHONE} SummittMindsetiOS`)
    ).toBe(true);
  });
});

describe("canonical module is the sole token source of truth", () => {
  it("does not duplicate raw marker literals outside platform + tests/docs", () => {
    const platform = readSrc("src/lib/native-app/platform.ts");
    expect(platform).toContain('"SummittMindsetiOS"');
    expect(platform).toContain('"SummittMindsetAndroid"');

    // Product gates must use helpers, not raw substring includes of markers.
    const gateFiles = [
      "src/app/layout.tsx",
      "src/middleware.ts",
      "src/app/api/stripe/create-checkout-session/route.ts",
      "src/app/subscribe/page.tsx",
      "src/components/Navbar.tsx",
      "src/components/SubscriptionGate.tsx",
    ];
    for (const rel of gateFiles) {
      const src = readSrc(rel);
      expect(src).not.toContain("SummittMindsetiOS");
      expect(src).not.toContain("SummittMindsetAndroid");
      expect(src).not.toMatch(/userAgent\.includes\(/);
    }
  });
});
