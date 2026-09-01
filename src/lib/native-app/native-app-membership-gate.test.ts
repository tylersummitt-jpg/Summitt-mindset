import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectSummittMindsetPlatform,
  isNativeSummittMindsetApp,
  SUMMITT_MINDSET_ANDROID_UA_TOKEN,
  SUMMITT_MINDSET_IOS_UA_TOKEN,
} from "@/lib/native-app/platform";
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

describe("native platform UA detection (canonical)", () => {
  it("detects iOS and Android markers via the shared platform module", () => {
    expect(SUMMITT_MINDSET_IOS_UA_TOKEN).toBe("SummittMindsetiOS");
    expect(SUMMITT_MINDSET_ANDROID_UA_TOKEN).toBe("SummittMindsetAndroid");
    expect(
      detectSummittMindsetPlatform(
        `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 SummittMindsetiOS`
      )
    ).toBe("ios");
    expect(
      detectSummittMindsetPlatform(
        `Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 SummittMindsetAndroid`
      )
    ).toBe("android");
    expect(isNativeSummittMindsetApp("SummittMindsetiOS")).toBe(true);
    expect(isNativeSummittMindsetApp("SummittMindsetAndroid")).toBe(true);
  });

  it("does not detect normal Safari / Chrome", () => {
    expect(
      detectSummittMindsetPlatform(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
      )
    ).toBe("none");
    expect(
      detectSummittMindsetPlatform(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
      )
    ).toBe("none");
  });

  it("rejects fuzzy / partial product-name matches", () => {
    expect(detectSummittMindsetPlatform("SummittMindset")).toBe("none");
    expect(detectSummittMindsetPlatform("summittmindsetios")).toBe("none");
    expect(detectSummittMindsetPlatform("SummittMindsetIOS")).toBe("none");
    expect(detectSummittMindsetPlatform("SummittMindsetANDROID")).toBe("none");
    expect(detectSummittMindsetPlatform("")).toBe("none");
    expect(detectSummittMindsetPlatform(null)).toBe("none");
  });

  it("has no query-param or cookie spoof path in detection helpers", () => {
    const platform = readSrc("src/lib/native-app/platform.ts");
    const appReq = readSrc(
      "src/lib/native-app/is-native-summitt-mindset-app-request.ts"
    );
    expect(platform).not.toMatch(/searchParams|get\(["']cookie|document\.cookie/i);
    expect(appReq).toContain('headerStore.get("user-agent")');
    expect(appReq).toContain('req.headers.get("user-agent")');
    expect(appReq).not.toMatch(/searchParams|cookies\(/);
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
    expect(layout).toContain("isNativeSummittMindsetAppRequest");
  });

  it("subscribe redirects native apps away from plans/checkout", () => {
    const page = readSrc("src/app/subscribe/page.tsx");
    expect(page).toContain("isNativeSummittMindsetAppRequest");
    expect(page).toContain("redirect(APP_MEMBERSHIP_PATH)");
  });

  it("/app/membership keeps Android/browser website copy and iOS Apple purchase", () => {
    const page = readSrc("src/app/app/membership/page.tsx");
    expect(page).toContain("Membership required");
    expect(page).toContain("Memberships are managed on the Summitt Mindset website");
    expect(page).toContain("IosAppleMembershipPanel");
    expect(page).toContain('platform === "ios"');
    expect(page).toContain("Sign out");
    expect(page).toContain("/privacy");
    expect(page).toContain("/terms");
    expect(page).toContain("/data-deletion");
    expect(page).toContain("ResumeMembershipButton");
    expect(page).not.toMatch(/\$29|\$249/);
    expect(page).not.toMatch(/free trial/i);
    expect(page).not.toContain('href="/subscribe"');
    expect(page).not.toContain("create-checkout-session");
    expect(page).toContain('showIosApplePurchase = platform === "ios" && !isPaused');
    expect(page).toContain("Sign in on the website to review your membership options.");
    expect(page).not.toContain("Membership includes:");
    const panel = readSrc("src/components/ios-apple-membership-panel.tsx");
    expect(panel).toContain("Subscribe with Apple");
    expect(panel).toContain("Restore Purchases");
    expect(panel).toContain("displayPrice");
    expect(panel).toContain("Membership includes:");
    expect(panel).toContain("Victory Room for your identity, Current Goal, and Wins");
    expect(panel).toContain("Ask Pat coaching inspired by Pat Summitt’s standards");
    expect(panel).toContain("Film Room leadership lessons");
    expect(panel.indexOf("Membership includes:")).toBeLessThan(
      panel.indexOf("Subscribe with Apple")
    );
    expect(panel).not.toMatch(/\$29/);
    expect(panel).not.toMatch(/managed on the Summitt Mindset website/i);
    expect(panel).not.toContain("/subscribe");
    expect(panel).not.toContain("Stripe");
    expect(panel).toContain("/privacy");
    expect(panel).toContain("/terms");
    expect(panel).toContain("user?.reload");
    expect(panel).toContain("router.refresh");
    expect(panel).toContain("/post-sign-in");
    expect(panel).toContain("backendVerified");
    expect(panel).not.toContain("summittSubscribed");
  });

  it("/app/membership reuses AccountDeletionDangerZone behind server initiation access", () => {
    const page = readSrc("src/app/app/membership/page.tsx");
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toContain("shouldShowAccountDeletionDangerZone");
    expect(page).toContain("AccountDeletionDangerZone");
    expect(page).toContain('surface="light"');
    expect(page).toContain("showDangerZone ? (");
    expect(page).toContain('data-testid="account-danger-zone-slot"');
    expect(page).toContain("Sign out");
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
    expect(page).toContain('surface="dark"');
    expect(page).toContain("showDangerZone ? <AccountDeletionDangerZone");
  });

  it("Navbar suppresses Start Free Trial and Subscribe in native context", () => {
    const nav = readSrc("src/components/Navbar.tsx");
    expect(nav).toContain("useIsNativeSummittMindsetApp");
    expect(nav).toContain("!isNativeApp");
    expect(nav).toContain('label: "Start Free Trial"');
    expect(nav).toContain('label: "Subscribe"');
  });

  it("Ask Pat replaces trial CTA in native context", () => {
    const client = readSrc("src/app/ask-pat/ask-pat-client.tsx");
    expect(client).toContain("isNativeSummittMindsetApp");
    expect(client).toContain("Start 7-day free trial");
    expect(client).toContain('router.push("/app/membership")');
    expect(client).toContain("Memberships are managed on the Summitt Mindset");
  });

  it("checkout API rejects native UA before Stripe", () => {
    const route = readSrc(
      "src/app/api/stripe/create-checkout-session/route.ts"
    );
    expect(route).toContain("isNativeSummittMindsetAppRequestFromRequest");
    expect(route).toContain("NATIVE_APP_CHECKOUT_UNAVAILABLE_ERROR");
    expect(route).toContain("status: 403");
    const nativeIdx = route.indexOf(
      "isNativeSummittMindsetAppRequestFromRequest"
    );
    const createIdx = route.indexOf("checkout.sessions.create");
    expect(nativeIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(nativeIdx);
    expect(route).toContain("trial_period_days: 7");
    expect(route).toContain("process.env.STRIPE_PRICE_ID_MONTHLY");
    expect(route).toContain("process.env.STRIPE_PRICE_ID_ANNUAL");
    expect(route).toContain("STRIPE_LEGACY_PRICE_IDS");
  });

  it("does not loosen unrelated protected routes in middleware", () => {
    const mw = readSrc("src/middleware.ts");
    expect(mw).toContain("signInPathForClient");
    expect(mw).toContain("isNativeSummittMindsetApp");
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

  it("shared /app/sign-in and /app/membership paths remain unchanged", () => {
    expect(readSrc("src/app/app/sign-in/page.tsx").length).toBeGreaterThan(0);
    expect(APP_MEMBERSHIP_PATH).toBe("/app/membership");
    expect(signInPathForClient(true)).toBe("/app/sign-in");
  });
});
