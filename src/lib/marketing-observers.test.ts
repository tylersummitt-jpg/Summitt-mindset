import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { attachMarketingCookies } from "@/lib/marketing-middleware-cookies";
import { SM_ACQ_COOKIE, SM_VISITOR_COOKIE } from "@/lib/marketing-attribution-pure";
import { NextRequest, NextResponse } from "next/server";

const ROOT = process.cwd();

function read(rel: string) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("marketing observers and fail-open wiring", () => {
  it("root layout mounts page-view and CTA observers for browser only", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain("MarketingPageViewBeacon");
    expect(layout).toContain("MarketingCtaCapture");
    expect(layout).toContain("!isNativeSummittMindsetApp");
    const nativeGate = layout.lastIndexOf("!isNativeSummittMindsetApp");
    expect(layout.lastIndexOf("<MarketingPageViewBeacon")).toBeGreaterThan(nativeGate);
    expect(layout.lastIndexOf("<MarketingCtaCapture")).toBeGreaterThan(nativeGate);
  });

  it("CTA capture does not preventDefault, stopPropagation, or await fetch", () => {
    const src = read("src/components/marketing-cta-capture.tsx");
    expect(src).not.toContain("preventDefault");
    expect(src).not.toContain("stopPropagation");
    expect(src).toContain("keepalive: true");
    expect(src).toContain("void fetch");
    expect(src).not.toMatch(/await fetch/);
    expect(src).toContain("data-growth-ignore");
  });

  it("page-view beacon is fire-and-forget", () => {
    const src = read("src/components/marketing-page-view-beacon.tsx");
    expect(src).toContain("void fetch");
    expect(src).not.toMatch(/await fetch/);
    expect(src).toContain("keepalive: true");
  });

  it("middleware only attaches cookies and never talks to Supabase", () => {
    const mw = read("src/middleware.ts");
    expect(mw).toContain("attachMarketingCookies");
    expect(mw).toContain("/api/marketing/collect");
    expect(mw).not.toMatch(/supabase/i);
    expect(mw).not.toMatch(/marketing_events|marketing_attribution|ad_spend/);
    const helper = read("src/lib/marketing-middleware-cookies.ts");
    expect(helper).not.toMatch(/supabase/i);
    expect(helper).toContain("No database");
  });

  it("skips native UA cookie minting", () => {
    const req = new NextRequest("http://localhost/", {
      headers: { "user-agent": "Mozilla SummittMindsetiOS" },
    });
    const res = attachMarketingCookies(req, NextResponse.next());
    expect(res.cookies.get(SM_VISITOR_COOKIE)).toBeUndefined();
    expect(res.cookies.get(SM_ACQ_COOKIE)).toBeUndefined();
  });

  it("sets HttpOnly Lax visitor cookies on homepage", () => {
    const req = new NextRequest("http://localhost/");
    const res = attachMarketingCookies(req, NextResponse.next());
    const visitor = res.cookies.get(SM_VISITOR_COOKIE);
    const acq = res.cookies.get(SM_ACQ_COOKIE);
    expect(visitor?.value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(acq?.value).toBeTruthy();
    expect(visitor?.httpOnly).toBe(true);
    expect(acq?.httpOnly).toBe(true);
  });

  it("account-link call sites are fail-open and do not change redirects", () => {
    const post = read("src/app/post-sign-in/page.tsx");
    const subscribe = read("src/app/subscribe/page.tsx");
    const onboarding = read("src/app/onboarding/layout.tsx");
    const checkoutStart = read("src/app/checkout/start/page.tsx");
    for (const src of [post, subscribe, onboarding, checkoutStart]) {
      expect(src).toContain("linkMarketingVisitorToClerkUser");
      expect(src).toContain("try {");
      expect(src).toContain("fail-open");
    }
    expect(onboarding).toContain("isSubscribedFromPublicMetadata");
    expect(onboarding.indexOf("linkMarketingVisitorToClerkUser")).toBeLessThan(
      onboarding.indexOf("redirect(subscribePath)")
    );
    expect(subscribe).toContain("redirect(APP_MEMBERSHIP_PATH)");
    expect(subscribe.indexOf("if (isNativeApp)")).toBeLessThan(
      subscribe.lastIndexOf("linkMarketingVisitorToClerkUser")
    );
  });

  it("does not change Stripe Checkout, webhook, Apple, SMS, or coach cookie names", () => {
    const checkout = read("src/app/api/stripe/create-checkout-session/route.ts");
    const webhook = read("src/app/api/stripe/webhook/route.ts");
    const apple = read("src/app/api/apple/webhook/route.ts");
    expect(checkout).toContain("stripe.checkout.sessions");
    expect(checkout).toContain("resolveAppleMembershipGrantForUser");
    expect(checkout).toContain("checkoutIdempotencyKeyV2");
    expect(checkout).not.toContain("sessions.expire");
    expect(checkout).not.toContain("sessions.search");
    expect(checkout).not.toContain(":after:");
    expect(read("src/lib/stripe-pending-checkout-session.ts")).toContain(
      "checkout-subscription-v2"
    );
    expect(webhook).toContain("constructEvent");
    expect(apple).toContain("handleAppleServerNotification");
    expect(read("src/lib/coach-attribution.ts")).toContain('summitt_attribution');
    expect(read("src/app/subscribe/subscribe-checkout-panel.tsx")).toContain(
      'data-growth-ignore="checkout"'
    );
    expect(read("src/components/SubscriptionGate.tsx")).toContain("Start Free Trial →");
    expect(read("src/components/SubscriptionGate.tsx")).toContain('data-growth-cta="trial"');
  });
});
