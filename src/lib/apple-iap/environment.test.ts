import { Environment } from "@apple/app-store-server-library";
import { describe, expect, it } from "vitest";
import {
  isAppleIapProductionEnvironment,
  isAppleIapSandboxEnvironment,
  isOfficialAppleIapEnvironment,
} from "./environment";

describe("Apple IAP official environment helpers", () => {
  it("accepts only Sandbox and Production", () => {
    expect(isOfficialAppleIapEnvironment(Environment.SANDBOX)).toBe(true);
    expect(isOfficialAppleIapEnvironment(Environment.PRODUCTION)).toBe(true);
    expect(isOfficialAppleIapEnvironment(Environment.XCODE)).toBe(false);
    expect(isOfficialAppleIapEnvironment(Environment.LOCAL_TESTING)).toBe(
      false
    );
    expect(isOfficialAppleIapEnvironment("Sandbox")).toBe(true);
    expect(isOfficialAppleIapEnvironment("Production")).toBe(true);
    expect(isOfficialAppleIapEnvironment("Xcode")).toBe(false);
    expect(isOfficialAppleIapEnvironment("LocalTesting")).toBe(false);
    expect(isOfficialAppleIapEnvironment(undefined)).toBe(false);
  });

  it("distinguishes sandbox vs production", () => {
    expect(isAppleIapSandboxEnvironment(Environment.SANDBOX)).toBe(true);
    expect(isAppleIapProductionEnvironment(Environment.PRODUCTION)).toBe(true);
    expect(isAppleIapSandboxEnvironment(Environment.PRODUCTION)).toBe(false);
    expect(isAppleIapProductionEnvironment(Environment.SANDBOX)).toBe(false);
  });
});
