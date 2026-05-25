import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("coach setup post-onboarding guards", () => {
  const layout = readSrc("src/app/coach/setup/layout.tsx");
  const page = readSrc("src/app/coach/setup/page.tsx");
  const banner = readSrc("src/components/CoachVictoryHandoffBanner.tsx");
  const shippingRoute = readSrc("src/app/api/coach/shipping/route.ts");

  it("routes incomplete coaches to SoB gates before shipping", () => {
    expect(layout).toContain("redirectIfOnboardingIncomplete");
    expect(layout).toContain("md.onboardingCompleted !== true");
  });

  it("renders shipping form for completed coaches without coachAddressCollected", () => {
    expect(layout).toContain("coachAddressCollected");
    expect(layout).toContain("return <>{children}</>");
    expect(layout).toContain('md.acquisitionSource !== "coach"');
    expect(layout).toContain('redirect("/post-sign-in")');
  });

  it("redirects completed coaches with address collected to Victory Room", () => {
    expect(layout).toContain("coachAddressCollected === true");
    expect(layout).toContain("redirect(MEMBER_APP_HOME_PATH)");
  });

  it("sends unsubscribed users to subscribe", () => {
    expect(layout).toContain("isSubscribedFromPublicMetadata");
    expect(layout).toContain("/subscribe?src=coach");
  });

  it("shipping page returns to Victory Room after successful submit", () => {
    expect(page).toContain("MEMBER_APP_HOME_PATH");
    expect(page).not.toContain("/onboarding/identity");
  });

  it("Victory Room banner points to working coach setup route", () => {
    expect(banner).toContain('href="/coach/setup"');
    expect(banner).toContain("Add Kit shipping address");
    expect(banner).not.toContain("Open coach setup");
  });

  it("shipping API requires onboarding complete", () => {
    expect(shippingRoute).toContain("onboardingCompleted !== true");
    expect(shippingRoute).toContain("Finish onboarding before submitting Kit shipping.");
  });

  it("does not add My Why or life_desires artifacts", () => {
    expect(layout).not.toContain("life_desires");
    expect(layout).not.toContain("needs_why");
    expect(page).not.toContain("/api/onboarding/why");
    expect(shippingRoute).not.toContain("Twilio");
  });
});
