import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeInternalRedirectUrl } from "@/lib/safe-redirect";
import {
  CHECKOUT_START_PATH,
  checkoutPlanFromSearchValue,
  checkoutPlanFromUnknown,
  checkoutStartForceRedirectUrl,
  isAnnualCheckoutPlan,
  signInHrefForCheckoutStart,
  signUpHrefForCheckoutStart,
} from "@/lib/checkout-plan";

const ROOT = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("consumer checkout plan helper", () => {
  it("only literal annual opts in; everything else is monthly", () => {
    expect(isAnnualCheckoutPlan("annual")).toBe(true);
    expect(isAnnualCheckoutPlan("monthly")).toBe(false);
    expect(isAnnualCheckoutPlan("yearly")).toBe(false);
    expect(isAnnualCheckoutPlan("ANNUAL")).toBe(false);
    expect(isAnnualCheckoutPlan("")).toBe(false);
    expect(isAnnualCheckoutPlan(null)).toBe(false);
    expect(checkoutPlanFromUnknown(undefined)).toBe("monthly");
    expect(checkoutPlanFromSearchValue("annual")).toBe("annual");
    expect(checkoutPlanFromSearchValue(["annual"])).toBe("annual");
    expect(checkoutPlanFromSearchValue("monthly")).toBe("monthly");
    expect(checkoutPlanFromSearchValue("yearly")).toBe("monthly");
    expect(checkoutPlanFromSearchValue(undefined)).toBe("monthly");
  });

  it("monthly URLs omit plan; annual uses sibling plan=annual", () => {
    expect(signUpHrefForCheckoutStart("monthly")).toBe(
      `/sign-up?redirect_url=${encodeURIComponent("/checkout/start")}`
    );
    expect(signUpHrefForCheckoutStart("annual")).toBe(
      `/sign-up?plan=annual&redirect_url=${encodeURIComponent("/checkout/start")}`
    );
    expect(signInHrefForCheckoutStart("monthly")).toBe(
      `/sign-in?redirect_url=${encodeURIComponent("/checkout/start")}`
    );
    expect(signInHrefForCheckoutStart("annual")).toBe(
      `/sign-in?plan=annual&redirect_url=${encodeURIComponent("/checkout/start")}`
    );
    expect(signUpHrefForCheckoutStart("annual")).toContain("plan=annual&");
    expect(signUpHrefForCheckoutStart("annual")).not.toContain(
      "redirect_url=/checkout/start?plan=annual"
    );
    expect(signUpHrefForCheckoutStart("annual")).not.toContain(
      encodeURIComponent("/checkout/start?plan=annual")
    );
  });

  it("Clerk forceRedirect monthly is /checkout/start; annual is /checkout/start?plan=annual", () => {
    expect(checkoutStartForceRedirectUrl("monthly")).toBe("/checkout/start");
    expect(checkoutStartForceRedirectUrl(undefined)).toBe("/checkout/start");
    expect(checkoutStartForceRedirectUrl("yearly")).toBe("/checkout/start");
    expect(checkoutStartForceRedirectUrl("annual")).toBe(
      "/checkout/start?plan=annual"
    );
    expect(CHECKOUT_START_PATH).toBe("/checkout/start");
  });

  it("sanitizer still rejects nested plan on redirect_url", () => {
    expect(sanitizeInternalRedirectUrl("/checkout/start")).toBe(
      "/checkout/start"
    );
    expect(sanitizeInternalRedirectUrl("/checkout/start?plan=annual")).toBeNull();
  });
});

describe("consumer checkout plan wiring (source)", () => {
  it("sign-up keeps redirect_url as /checkout/start and puts plan on forceRedirectUrl", () => {
    const src = readSrc("src/app/sign-up/[[...sign-up]]/page.tsx");
    expect(src).toContain("checkoutStartForceRedirectUrl");
    expect(src).toContain("signInHrefForCheckoutStart");
    expect(src).toContain("signUpHrefForCheckoutStart");
    expect(src).toContain('sanitizeInternalRedirectUrl(redirectUrl) === "/checkout/start"');
    expect(src).toContain(
      'safeSubscribeDestination ?? safeCheckoutStartDestination ?? "/onboarding"'
    );
    expect(src).not.toContain("unsafeMetadata");
    expect(src).not.toContain("sessionStorage");
    expect(src).not.toContain("document.cookie");
    expect(src).not.toContain("$19.99");
    expect(src).not.toContain("$120");
  });

  it("sign-in preserves annual as sibling plan on the Sign Up toggle", () => {
    const src = readSrc("src/app/sign-in/[[...sign-in]]/page.tsx");
    expect(src).toContain("checkoutStartForceRedirectUrl");
    expect(src).toContain("signUpHrefForCheckoutStart");
    expect(src).toContain("signUpUrlPreservingInternalRedirect");
    expect(src).not.toContain("unsafeMetadata");
    expect(src).not.toContain("$19.99");
    expect(src).not.toContain("$120");
  });

  it("checkout-start unsigned bounce preserves plan via helper; attribution hop unchanged", () => {
    const page = readSrc("src/app/checkout/start/page.tsx");
    expect(page).toContain("signUpHrefForCheckoutStart");
    expect(page).toContain("checkoutPlanFromSearchValue");
    expect(page).toContain("linkMarketingVisitorToClerkUser(user.id)");
    expect(page.indexOf("if (isNativeApp)")).toBeLessThan(
      page.indexOf("linkMarketingVisitorToClerkUser(user.id)")
    );
    expect(page.indexOf("linkMarketingVisitorToClerkUser(user.id)")).toBeLessThan(
      page.indexOf("return <CheckoutStartClient")
    );
    expect(page).toContain("fail-open");
    expect(page).not.toContain("src=coach");
    expect(page).not.toContain("$19.99");
    expect(page).not.toContain("$120");
  });

  it("webhook, membership, coach, native, Home, and Navbar stay off this plan selector", () => {
    expect(readSrc("src/app/api/stripe/webhook/route.ts")).not.toContain(
      "checkout-plan"
    );
    expect(readSrc("src/lib/summitt-membership-entitlement.ts")).not.toContain(
      "checkout-plan"
    );
    expect(readSrc("src/lib/summitt-subscription-membership.ts")).toContain(
      'if (interval === "year") return "annual"'
    );
    expect(readSrc("src/lib/coach-funnel-links.ts")).not.toContain("plan=annual");
    expect(readSrc("src/lib/native-app/native-safe-marketing-cta.ts")).not.toContain(
      "plan=annual"
    );
    expect(readSrc("src/app/page.tsx")).not.toContain("plan=annual");
    expect(readSrc("src/components/Navbar.tsx")).not.toContain("plan=annual");
    expect(readSrc("src/lib/safe-redirect.ts")).not.toContain("plan=annual");
  });
});
