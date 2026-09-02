import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("Meta PageView architecture (single Pixel, no CAPI PageView)", () => {
  it("initializes fbq once and does not auto-track PageView in the snippet", () => {
    const pixelRoot = readSrc("src/components/MetaPixelRoot.tsx");
    expect(pixelRoot).toContain("if(f.fbq)return");
    expect(pixelRoot).toContain("id=\"meta-pixel-fbq-stub\"");
    expect(pixelRoot).toContain("fbq('init','${pixelId}')");
    expect(pixelRoot).not.toMatch(/fbq\('track',\s*'PageView'/);
    expect(pixelRoot).toContain("lastMetaPageViewPathname");
    expect(pixelRoot).toContain("usePathname");
    expect(pixelRoot).toContain("trackSafePageView");
  });

  it("pathname-only last PageView guard survives remounts", () => {
    const pixelRoot = readSrc("src/components/MetaPixelRoot.tsx");
    expect(pixelRoot).toMatch(/let lastMetaPageViewPathname: string \| null = null/);
    expect(pixelRoot).toContain("if (lastMetaPageViewPathname === pagePath) return");
  });

  it("does not send PageView through CAPI", () => {
    const capi = readSrc("src/lib/meta-capi.ts");
    expect(capi).not.toMatch(/"PageView"/);
    const conversions = readSrc("src/lib/meta-capi-stripe-conversions.ts");
    expect(conversions).not.toMatch(/PageView/);
  });
});

describe("StartTrial/Subscribe are not browser or checkout-open events", () => {
  it("homepage CTA, signup, subscribe panel, and create-checkout-session do not emit StartTrial", () => {
    for (const rel of [
      "src/app/page.tsx",
      "src/app/subscribe/page.tsx",
      "src/app/subscribe/subscribe-checkout-panel.tsx",
      "src/app/subscribe/success/page.tsx",
      "src/app/api/stripe/create-checkout-session/route.ts",
      "src/app/api/stripe/confirm-checkout/route.ts",
    ]) {
      const src = readSrc(rel);
      expect(src, rel).not.toMatch(/StartTrial|maybeEmitMetaStartTrial|sendMetaCapiEvent/);
    }
  });

  it("coach InitiateCheckout remains browser InitiateCheckout only", () => {
    const panel = readSrc("src/app/subscribe/subscribe-checkout-panel.tsx");
    expect(panel).toContain("trackCoachInitiateCheckout");
    expect(panel).not.toMatch(/StartTrial|sendMetaCapiEvent|maybeEmitMeta/);
    const pixel = readSrc("src/lib/meta-pixel.ts");
    expect(pixel).toContain('trackMetaStandard("InitiateCheckout"');
    expect(pixel).not.toMatch(/StartTrial|sendMetaCapiEvent/);
  });

  it("Apple IAP webhook does not emit Meta conversions", () => {
    const apple = readSrc("src/app/api/apple/webhook/route.ts");
    expect(apple).not.toMatch(/meta-capi|StartTrial|Subscribe/);
    const notifications = readSrc("src/lib/apple-iap/notifications.ts");
    expect(notifications).not.toMatch(/meta-capi|StartTrial/);
  });

  it("first-party marketing tables are not reused as the Meta ledger", () => {
    const conversions = readSrc("src/lib/meta-capi-stripe-conversions.ts");
    const ledger = readSrc("src/lib/meta-conversion-ledger.ts");
    for (const src of [conversions, ledger]) {
      expect(src).not.toMatch(/marketing_events|sm_visitor|sm_acq/);
    }
  });

  it("CAPI access token is server-only and never NEXT_PUBLIC", () => {
    const capi = readSrc("src/lib/meta-capi.ts");
    expect(capi).toContain('import "server-only"');
    expect(capi).toContain("META_CAPI_ACCESS_TOKEN");
    expect(capi).not.toContain("NEXT_PUBLIC_META_CAPI");
    const example = readSrc(".env.example");
    expect(example).toContain("META_CAPI_ACCESS_TOKEN=");
    expect(example).not.toMatch(/NEXT_PUBLIC_META_CAPI/);
  });
});
