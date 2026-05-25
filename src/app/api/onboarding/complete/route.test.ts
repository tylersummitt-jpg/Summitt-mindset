import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE = join(process.cwd(), "src/app/api/onboarding/complete/route.ts");

describe("POST /api/onboarding/complete", () => {
  const src = readFileSync(ROUTE, "utf8");

  it("requires SMS consent before RPC for new users", () => {
    expect(src).toContain("hasValidSmsConsent");
    expect(src).toContain("SMS consent is required before finishing onboarding");
    expect(src).toContain("runSobCompleteOnboardingActivation");
  });

  it("does not set onboardingCompleted before RPC", () => {
    const activationBlock = src.slice(src.indexOf("runSobCompleteOnboardingActivation"));
    const clerkAfterActivation = activationBlock.indexOf("updateClerkPublicMetadata");
    const onboardingFlag = activationBlock.indexOf("onboardingCompleted: true");
    expect(clerkAfterActivation).toBeGreaterThan(-1);
    expect(onboardingFlag).toBeGreaterThan(-1);
    expect(onboardingFlag).toBeGreaterThan(clerkAfterActivation);
  });

  it("heals sms audience for already-completed users", () => {
    expect(src).toContain("onboardingCompleted === true");
    expect(src).toContain("healSmsAudience");
    expect(src).toContain("syncSmsAudience");
  });

  it("does not inline activate commitment (moved to RPC)", () => {
    expect(src).not.toContain('.update({\n          status: "active"');
  });
});
