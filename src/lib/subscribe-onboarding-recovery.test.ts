import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("subscribe onboarding recovery slice 1", () => {
  it("success unsigned recovery encodes success URL including session_id", () => {
    const src = readSrc("src/app/subscribe/success/page.tsx");
    expect(src).toContain("encodeURIComponent(successReturn)");
    expect(src).toContain("`/subscribe/success?session_id=${sessionId}`");
    expect(src).toContain('sessionId');
    expect(src).toContain(': "/subscribe/success"');
    expect(src).not.toContain(
      'router.push("/sign-in?redirect_url=/subscribe/success")'
    );
    expect(src).not.toContain("localStorage");
    expect(src).not.toContain("sessionStorage");
  });

  it("subscribe keeps native membership redirect before entitled /post-sign-in", () => {
    const page = readSrc("src/app/subscribe/page.tsx");
    const native = page.indexOf("redirect(APP_MEMBERSHIP_PATH)");
    const entitled = page.indexOf('redirect("/post-sign-in")');
    const helper = page.indexOf("isSubscribedFromPublicMetadata");
    const panel = page.indexOf("<SubscribeCheckoutPanel />");

    expect(native).toBeGreaterThan(-1);
    expect(entitled).toBeGreaterThan(native);
    expect(helper).toBeGreaterThan(-1);
    expect(helper).toBeLessThan(entitled);
    expect(panel).toBeGreaterThan(entitled);
    expect(page).toContain(
      'from "@/lib/onboarding-subscription-metadata"'
    );
    expect(page).not.toContain("create-checkout-session");
    expect(page).not.toContain("recomputeMembership");
    expect(page).not.toContain("getOnboardingSobStatus");
    expect(page).not.toContain("$19.99");
    expect(page).not.toContain("$120");
    expect(page).not.toContain("trial_period_days");
  });
});
