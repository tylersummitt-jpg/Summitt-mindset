import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SUMMITT_MINDSET_IOS_UA_TOKEN,
  isNativeSummittMindsetIosUserAgent,
} from "@/lib/native-app/ua-token";
import {
  APP_MEMBERSHIP_PATH,
  BROWSER_SUBSCRIBE_PATH,
  inactiveMembershipRedirectPath,
  signInPathForClient,
} from "@/lib/native-app/membership-paths";

const root = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("native iOS UA detection", () => {
  it("detects the exact SummittMindsetiOS token", () => {
    expect(SUMMITT_MINDSET_IOS_UA_TOKEN).toBe("SummittMindsetiOS");
    expect(
      isNativeSummittMindsetIosUserAgent(
        `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 SummittMindsetiOS`
      )
    ).toBe(true);
  });

  it("does not detect normal Safari", () => {
    expect(
      isNativeSummittMindsetIosUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
      )
    ).toBe(false);
  });

  it("rejects fuzzy / partial product-name matches (case-sensitive exact token)", () => {
    expect(isNativeSummittMindsetIosUserAgent("SummittMindset")).toBe(false);
    expect(isNativeSummittMindsetIosUserAgent("summittmindsetios")).toBe(false);
    expect(isNativeSummittMindsetIosUserAgent("SummittMindsetIOS")).toBe(false);
    expect(isNativeSummittMindsetIosUserAgent("Summitt Mindset iOS")).toBe(false);
    expect(isNativeSummittMindsetIosUserAgent("")).toBe(false);
    expect(isNativeSummittMindsetIosUserAgent(null)).toBe(false);
  });

  it("has no query-param or cookie spoof path in detection helpers", () => {
    const ua = readSrc("src/lib/native-app/ua-token.ts");
    const req = readSrc(
      "src/lib/native-app/is-native-summitt-mindset-ios-request.ts"
    );
    expect(ua).not.toMatch(/searchParams|get\(["']cookie|document\.cookie/i);
    expect(req).toContain('headerStore.get("user-agent")');
    expect(req).toContain('req.headers.get("user-agent")');
    expect(req).not.toMatch(/searchParams|cookies\(/);
  });
});

describe("inactive membership redirect paths", () => {
  it("routes native inactive users to /app/membership and browsers to /subscribe", () => {
    expect(inactiveMembershipRedirectPath(true)).toBe(APP_MEMBERSHIP_PATH);
    expect(inactiveMembershipRedirectPath(false)).toBe(BROWSER_SUBSCRIBE_PATH);
    expect(signInPathForClient(true)).toBe("/app/sign-in");
    expect(signInPathForClient(false)).toBe("/sign-in");
  });
});

describe("native membership gate surfaces", () => {
  it("dashboard gates native inactive users to /app/membership", () => {
    const layout = readSrc("src/app/dashboard/layout.tsx");
    expect(layout).toContain("inactiveMembershipRedirectPath");
    expect(layout).toContain("isNativeSummittMindsetIosRequest");
  });

  it("subscribe redirects native apps away from plans/checkout", () => {
    const page = readSrc("src/app/subscribe/page.tsx");
    expect(page).toContain("isNativeSummittMindsetIosRequest");
    expect(page).toContain("redirect(APP_MEMBERSHIP_PATH)");
  });

  it("/app/membership is neutral with no purchase solicitation", () => {
    const page = readSrc("src/app/app/membership/page.tsx");
    expect(page).toContain("Membership required");
    expect(page).toContain("Memberships are managed on the Summitt Mindset website");
    expect(page).toContain("Sign out");
    expect(page).toContain("/privacy");
    expect(page).toContain("/terms");
    expect(page).toContain("/data-deletion");
    expect(page).toContain("ResumeMembershipButton");
    expect(page).not.toMatch(/\$29|\$249/);
    expect(page).not.toMatch(/free trial/i);
    expect(page).not.toMatch(/\bSubscribe\b/);
    expect(page).not.toMatch(/\bStart Membership\b|\bUpgrade\b|\bBuy\b|\bCheckout\b/i);
    expect(page).not.toContain('href="/subscribe"');
    expect(page).not.toMatch(/App Store|\bIAP\b|WebView|Stripe policy/i);
  });

  it("/app/membership reuses AccountDeletionDangerZone behind server initiation access", () => {
    const page = readSrc("src/app/app/membership/page.tsx");
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toContain("shouldShowAccountDeletionDangerZone");
    expect(page).toContain("AccountDeletionDangerZone");
    expect(page).toContain("showDangerZone ? (");
    expect(page).toContain('data-testid="account-danger-zone-slot"');
    expect(page).toContain("Sign out");
    // Sign out remains a separate control from deletion.
    expect(page.indexOf("account-danger-zone-slot")).toBeLessThan(
      page.indexOf("Sign out")
    );
    expect(page).not.toContain('href="/data-deletion">Delete account');
    expect(page).not.toMatch(/dangerZone=\{process\.env/);
    expect(page).not.toMatch(/userId=\{/);
    expect(page).not.toContain("ACCOUNT_DELETION_INITIATION_ENABLED");
    expect(page).not.toContain("create-checkout-session");
  });

  it("/user still gates Danger Zone with the same server helper", () => {
    const page = readSrc("src/app/user/[[...user]]/page.tsx");
    expect(page).toContain("shouldShowAccountDeletionDangerZone");
    expect(page).toContain("AccountDeletionDangerZone");
    expect(page).toContain("showDangerZone ? <AccountDeletionDangerZone");
  });

  it("Navbar suppresses Start Free Trial and Subscribe in native context", () => {
    const nav = readSrc("src/components/Navbar.tsx");
    expect(nav).toContain("useIsNativeSummittMindsetIos");
    expect(nav).toContain("!isNativeIos");
    expect(nav).toContain('label: "Start Free Trial"');
    expect(nav).toContain('label: "Subscribe"');
  });

  it("Ask Pat replaces trial CTA in native context", () => {
    const client = readSrc("src/app/ask-pat/ask-pat-client.tsx");
    expect(client).toContain("isNativeSummittMindsetIos");
    expect(client).toContain("Start 7-day free trial");
    expect(client).toContain('router.push("/app/membership")');
    expect(client).toContain("Memberships are managed on the Summitt Mindset");
  });

  it("checkout API rejects native UA before Stripe", () => {
    const route = readSrc(
      "src/app/api/stripe/create-checkout-session/route.ts"
    );
    expect(route).toContain("isNativeSummittMindsetIosRequestFromRequest");
    expect(route).toContain("NATIVE_APP_CHECKOUT_UNAVAILABLE_ERROR");
    expect(route).toContain("status: 403");
    const nativeIdx = route.indexOf("isNativeSummittMindsetIosRequestFromRequest");
    const createIdx = route.indexOf("checkout.sessions.create");
    expect(nativeIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(nativeIdx);
  });

  it("does not loosen unrelated protected routes in middleware", () => {
    const mw = readSrc("src/middleware.ts");
    expect(mw).toContain("signInPathForClient");
    expect(mw).not.toMatch(/["']\/dashboard\(\.\*\)["']/);
    expect(mw).not.toMatch(/["']\/user\(\.\*\)["']/);
    expect(mw).not.toMatch(/["']\/app\/membership/);
  });

  it("preserves resume/cancel management paths", () => {
    const membership = readSrc("src/app/app/membership/page.tsx");
    expect(membership).toContain("ResumeMembershipButton");
    expect(readSrc("src/app/api/resume-membership/route.ts")).toContain(
      "stripe.subscriptions.update"
    );
    expect(readSrc("src/app/api/resume-membership/route.ts")).not.toContain(
      "checkout.sessions.create"
    );
  });
});
