import { Environment } from "@apple/app-store-server-library";
import { describe, expect, it } from "vitest";
import { AppleIapError } from "./errors";
import { normalizeAppleIapEnvironment } from "./environment";

describe("Apple IAP environment normalization", () => {
  it("maps sandbox to Environment.SANDBOX", () => {
    expect(normalizeAppleIapEnvironment("sandbox")).toBe(Environment.SANDBOX);
    expect(normalizeAppleIapEnvironment(" Sandbox ")).toBe(Environment.SANDBOX);
  });

  it("maps production to Environment.PRODUCTION", () => {
    expect(normalizeAppleIapEnvironment("production")).toBe(
      Environment.PRODUCTION
    );
    expect(normalizeAppleIapEnvironment("PRODUCTION")).toBe(
      Environment.PRODUCTION
    );
  });

  it("fails closed on unknown environment values", () => {
    expect(() => normalizeAppleIapEnvironment("prod")).toThrow(AppleIapError);
    expect(() => normalizeAppleIapEnvironment("Xcode")).toThrow(AppleIapError);
    expect(() => normalizeAppleIapEnvironment("LocalTesting")).toThrow(
      AppleIapError
    );
    expect(() => normalizeAppleIapEnvironment("")).toThrow(AppleIapError);
    try {
      normalizeAppleIapEnvironment("staging");
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppleIapError);
      expect((error as AppleIapError).code).toBe(
        "apple_iap_invalid_environment"
      );
    }
  });
});
