import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("subscribe onboarding recovery slice 1", () => {
  it("unsigned success preserves checkout context and offers secure Sign In recovery", () => {
    const src = readSrc("src/app/subscribe/success/page.tsx");
    expect(src).toContain("signInUrlPreservingInternalRedirect");
    expect(src).toContain("`/subscribe/success?session_id=${sessionId}`");
    expect(src).toContain('return "/subscribe/success"');
    expect(src).toContain("Sign In to Finish Setup");
    expect(src).toContain("Your trial is started.");
    expect(src).toContain("Sign in to finish setting up Coach Pat.");
    expect(src).not.toMatch(
      /if \(isLoaded && !isSignedIn\) \{\s*[\s\S]*router\.push\(/
    );
    expect(src).not.toContain(
      'router.push("/sign-in?redirect_url=/subscribe/success")'
    );
    expect(src).not.toContain("localStorage");
    expect(src).not.toContain("sessionStorage");
    expect(src).toContain("Set Up Coach Pat →");
    expect(src).not.toContain("Continue to account");
    expect(src).toContain("Still starting your trial");
    expect(src).toContain("Your trial is started. Next: set up Coach Pat.");
    expect(src).toContain('router.push("/post-sign-in")');
    expect(src).toContain("res.status === 401");
    expect(src).toContain("res.status === 403");
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
