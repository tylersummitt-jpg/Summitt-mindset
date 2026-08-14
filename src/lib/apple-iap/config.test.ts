import { Environment } from "@apple/app-store-server-library";
import { describe, expect, it } from "vitest";
import {
  APPLE_IAP_BUNDLE_ID,
  normalizeAppleIapPrivateKey,
  readAppleIapApiClientConfig,
  readAppleIapVerifierConfig,
} from "./config";
import { AppleIapError } from "./errors";

const SANDBOX_VERIFIER_ENV = {
  APPLE_IAP_BUNDLE_ID,
  APPLE_IAP_ENVIRONMENT: "sandbox",
};

describe("Apple IAP config", () => {
  it("reads sandbox verifier config without API secrets", () => {
    const config = readAppleIapVerifierConfig(SANDBOX_VERIFIER_ENV);
    expect(config).toEqual({
      bundleId: APPLE_IAP_BUNDLE_ID,
      environment: Environment.SANDBOX,
      appAppleId: undefined,
    });
  });

  it("rejects missing bundle id", () => {
    expect(() =>
      readAppleIapVerifierConfig({
        APPLE_IAP_ENVIRONMENT: "sandbox",
      })
    ).toThrow(AppleIapError);
    try {
      readAppleIapVerifierConfig({
        APPLE_IAP_BUNDLE_ID: "   ",
        APPLE_IAP_ENVIRONMENT: "sandbox",
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppleIapError);
      expect((error as AppleIapError).code).toBe("apple_iap_not_configured");
    }
  });

  it("rejects missing production App Apple ID", () => {
    try {
      readAppleIapVerifierConfig({
        APPLE_IAP_BUNDLE_ID,
        APPLE_IAP_ENVIRONMENT: "production",
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppleIapError);
      expect((error as AppleIapError).code).toBe("apple_iap_not_configured");
    }
  });

  it("accepts production verifier config with numeric App Apple ID", () => {
    const config = readAppleIapVerifierConfig({
      APPLE_IAP_BUNDLE_ID,
      APPLE_IAP_ENVIRONMENT: "production",
      APPLE_IAP_APP_APPLE_ID: "1234567890",
    });
    expect(config.environment).toBe(Environment.PRODUCTION);
    expect(config.appAppleId).toBe(1234567890);
  });

  it("does not require API client secrets for verifier config", () => {
    expect(() =>
      readAppleIapVerifierConfig({
        ...SANDBOX_VERIFIER_ENV,
        APPLE_IAP_ISSUER_ID: undefined,
        APPLE_IAP_KEY_ID: undefined,
        APPLE_IAP_PRIVATE_KEY: undefined,
      })
    ).not.toThrow();
  });

  it("requires issuer id for API client config", () => {
    expect(() =>
      readAppleIapApiClientConfig({
        ...SANDBOX_VERIFIER_ENV,
        APPLE_IAP_KEY_ID: "KEYID12345",
        APPLE_IAP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----",
      })
    ).toThrow(/APPLE_IAP_ISSUER_ID/);
  });

  it("requires key id for API client config", () => {
    expect(() =>
      readAppleIapApiClientConfig({
        ...SANDBOX_VERIFIER_ENV,
        APPLE_IAP_ISSUER_ID: "issuer-id",
        APPLE_IAP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----",
      })
    ).toThrow(/APPLE_IAP_KEY_ID/);
  });

  it("requires private key for API client config", () => {
    expect(() =>
      readAppleIapApiClientConfig({
        ...SANDBOX_VERIFIER_ENV,
        APPLE_IAP_ISSUER_ID: "issuer-id",
        APPLE_IAP_KEY_ID: "KEYID12345",
      })
    ).toThrow(/APPLE_IAP_PRIVATE_KEY/);
  });

  it("normalizes escaped newlines in a PEM private key", () => {
    const escaped =
      "-----BEGIN PRIVATE KEY-----\\nMIGH\\n-----END PRIVATE KEY-----";
    const normalized = normalizeAppleIapPrivateKey(escaped);
    expect(normalized).toBe(
      "-----BEGIN PRIVATE KEY-----\nMIGH\n-----END PRIVATE KEY-----"
    );
    expect(normalized).not.toContain("\\n");
  });
});
