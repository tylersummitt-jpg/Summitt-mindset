import { describe, expect, it } from "vitest";
import {
  APPLE_IAP_MONTHLY_PRODUCT_ID,
  isAllowedAppleIapProductId,
} from "./products";

describe("Apple IAP product allowlist", () => {
  it("accepts the locked monthly product id", () => {
    expect(APPLE_IAP_MONTHLY_PRODUCT_ID).toBe(
      "com.summittmindset.ios.membership.monthly"
    );
    expect(isAllowedAppleIapProductId(APPLE_IAP_MONTHLY_PRODUCT_ID)).toBe(true);
  });

  it("rejects an unknown product id", () => {
    expect(
      isAllowedAppleIapProductId("com.summittmindset.ios.membership.annual")
    ).toBe(false);
    expect(isAllowedAppleIapProductId("com.other.app.premium")).toBe(false);
  });

  it("rejects a blank product id", () => {
    expect(isAllowedAppleIapProductId("")).toBe(false);
    expect(isAllowedAppleIapProductId("   ")).toBe(false);
  });
});
