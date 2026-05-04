import { describe, expect, it } from "vitest";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";

describe("isSubscribedFromPublicMetadata", () => {
  it("returns false for null, non-object, or empty object", () => {
    expect(isSubscribedFromPublicMetadata(null)).toBe(false);
    expect(isSubscribedFromPublicMetadata(undefined)).toBe(false);
    expect(isSubscribedFromPublicMetadata("x")).toBe(false);
    expect(isSubscribedFromPublicMetadata({})).toBe(false);
  });

  it("returns true for summittSubscribed true or string true", () => {
    expect(isSubscribedFromPublicMetadata({ summittSubscribed: true })).toBe(true);
    expect(isSubscribedFromPublicMetadata({ summittSubscribed: "true" })).toBe(true);
  });

  it("returns true for monthly or annual plan", () => {
    expect(isSubscribedFromPublicMetadata({ summittPlan: "monthly" })).toBe(true);
    expect(isSubscribedFromPublicMetadata({ summittPlan: "annual" })).toBe(true);
  });

  it("ignores non-string plan values", () => {
    expect(isSubscribedFromPublicMetadata({ summittPlan: 123 })).toBe(false);
    expect(isSubscribedFromPublicMetadata({ summittPlan: "weekly" })).toBe(false);
  });
});
