import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY,
  ACCOUNT_DELETION_SUPPORT_EMAIL_HREF,
} from "@/lib/legal/account-deletion-public-availability";
import {
  marketingAcquisitionHref,
  marketingSubscribeCtaLabel,
  marketingTrialCtaLabel,
  shouldShowMarketingPricingCopy,
} from "@/lib/native-app/native-safe-marketing-cta";

const root = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

const REVIEWER_SURFACES = [
  "src/app/app/membership/page.tsx",
  "src/components/app-sign-in/AppEmailCodeSignIn.tsx",
  "src/app/layout.tsx",
  "src/app/privacy/page.tsx",
  "src/app/terms/page.tsx",
  "src/app/data-deletion/page.tsx",
  "src/app/sms/page.tsx",
  "src/app/twilio/page.tsx",
  "src/app/user/[[...user]]/user-account-client.tsx",
  "src/app/page.tsx",
  "src/app/ask-pat-preview/page.tsx",
  "src/app/film-room-preview/page.tsx",
  "src/components/Navbar.tsx",
];

describe("native-safe marketing CTA helper", () => {
  it("routes native users away from subscribe acquisition", () => {
    expect(
      marketingAcquisitionHref({ isNativeApp: true, isSignedIn: false })
    ).toBe("/app/sign-in");
    expect(
      marketingAcquisitionHref({ isNativeApp: true, isSignedIn: true })
    ).toBe("/app/membership");
    expect(
      marketingAcquisitionHref({ isNativeApp: false, isSignedIn: false })
    ).toContain("/sign-in");
    expect(
      marketingAcquisitionHref({ isNativeApp: false, isSignedIn: true })
    ).toBe("/subscribe");
    expect(marketingTrialCtaLabel(true)).toBe("Sign in");
    expect(marketingTrialCtaLabel(false)).toMatch(/Free Trial/i);
    expect(marketingSubscribeCtaLabel(true)).toBe("Continue");
    expect(shouldShowMarketingPricingCopy(true)).toBe(false);
  });
});

describe("reviewer-visible link and navigation audit", () => {
  it("keeps required legal pages on the public middleware allowlist", () => {
    const mw = readSrc("src/middleware.ts");
    for (const route of [
      "/privacy",
      "/terms",
      "/data-deletion",
      "/support",
      "/sms",
      "/twilio",
    ]) {
      expect(mw).toContain(`"${route}"`);
    }
  });

  it("footer and membership expose Privacy, Terms, Data Deletion", () => {
    const layout = readSrc("src/app/layout.tsx");
    const membership = readSrc("src/app/app/membership/page.tsx");
    for (const src of [layout, membership]) {
      expect(src).toContain('href="/privacy"');
      expect(src).toContain('href="/terms"');
      expect(src).toContain('href="/data-deletion"');
    }
    expect(layout).toContain('href="/sms"');
    expect(layout).toContain('href="/twilio"');
  });

  it("support mailto uses canonical href and display", () => {
    expect(ACCOUNT_DELETION_SUPPORT_EMAIL_HREF).toBe(
      "mailto:support@summittmindset.com"
    );
    expect(ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY).toBe(
      "Support@SummittMindset.com"
    );
    const account = readSrc(
      "src/app/user/[[...user]]/user-account-client.tsx"
    );
    expect(account).toContain("ACCOUNT_DELETION_SUPPORT_EMAIL_HREF");
    expect(account).not.toContain("mailto:Support@SummittMindset.com");
    const membership = readSrc("src/app/app/membership/page.tsx");
    expect(membership).toContain("ACCOUNT_DELETION_SUPPORT_EMAIL_HREF");
  });

  it("native membership page has no purchase CTA or checkout link", () => {
    const page = readSrc("src/app/app/membership/page.tsx");
    expect(page).not.toMatch(/\$29|\$249/);
    expect(page).not.toMatch(/free trial/i);
    expect(page).not.toMatch(/\bSubscribe\b/);
    expect(page).not.toMatch(/\bCheckout\b/i);
    expect(page).not.toContain('href="/subscribe"');
    expect(page).toContain("Sign out");
    expect(page).toContain("AccountDeletionDangerZone");
  });

  it("home and preview pages use native-safe acquisition helpers", () => {
    for (const rel of [
      "src/app/page.tsx",
      "src/app/ask-pat-preview/page.tsx",
      "src/app/film-room-preview/page.tsx",
    ]) {
      const src = readSrc(rel);
      expect(src).toContain("marketingAcquisitionHref");
      expect(src).toContain("isNativeSummittMindsetAppRequest");
      expect(src).not.toMatch(
        /const trialHref = user \? "\/subscribe"/
      );
    }
  });

  it("cancel and onboarding unauth redirects are native-aware", () => {
    const cancel = readSrc("src/app/cancel/page.tsx");
    expect(cancel).toContain("signInPathForClient");
    expect(cancel).not.toMatch(/redirect\("\/sign-in"\)/);

    const onboarding = readSrc("src/app/onboarding/layout.tsx");
    expect(onboarding).toContain("signInPathForClient");
    expect(onboarding).toContain("isNativeSummittMindsetAppRequest");
  });

  it("onboarding SMS consent uses relative legal links without target blank", () => {
    const sms = readSrc("src/app/onboarding/sms/sms-client.tsx");
    expect(sms).toContain('href="/privacy"');
    expect(sms).toContain('href="/terms"');
    expect(sms).toContain('href="/sms"');
    expect(sms).not.toContain("https://www.summittmindset.com/privacy");
    expect(sms).not.toContain('target="_blank"');
  });

  it("target=_blank links include safe rel attributes", () => {
    const blanks = [
      "src/app/pat-summitt-documentary/page.tsx",
      "src/app/pat-summitt-quotes/[slug]/page.tsx",
    ];
    for (const rel of blanks) {
      const src = readSrc(rel);
      if (!src.includes('target="_blank"')) continue;
      const parts = src.split('target="_blank"');
      for (let i = 1; i < parts.length; i++) {
        const window = parts[i - 1].slice(-200) + parts[i].slice(0, 200);
        expect(window).toMatch(/rel=["'][^"']*(noopener|noreferrer)/);
      }
    }
  });

  it("reviewer surfaces avoid javascript:, localhost, preview tunnels, and insecure http links", () => {
    const combined = REVIEWER_SURFACES.map(readSrc).join("\n");
    expect(combined).not.toMatch(/javascript:/i);
    expect(combined).not.toMatch(/href=["']http:\/\//i);
    expect(combined).not.toMatch(/localhost:\d+/);
    expect(combined).not.toMatch(/ngrok|vercel\.app\/.*preview/i);
    expect(combined).not.toMatch(/window\.open\s*\(/);
  });

  it("browser purchase path remains on website subscribe surfaces", () => {
    const subscribe = readSrc("src/app/subscribe/page.tsx");
    expect(subscribe).toContain("isNativeSummittMindsetAppRequest");
    expect(subscribe).toContain("redirect(APP_MEMBERSHIP_PATH)");
    expect(subscribe).toContain("SubscribeCheckoutPanel");
  });

  it("resume copy does not push Subscribe on native membership surface", () => {
    const resume = readSrc("src/components/resume-membership-button.tsx");
    expect(resume).not.toMatch(/from Subscribe/);
    expect(resume).toMatch(/Contact support/i);
  });
});
