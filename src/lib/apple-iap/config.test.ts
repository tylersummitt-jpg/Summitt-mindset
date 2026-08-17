import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Environment } from "@apple/app-store-server-library";
import { describe, expect, it } from "vitest";
import {
  APPLE_IAP_APP_APPLE_ID,
  APPLE_IAP_BUNDLE_ID,
  appleIapProductionVerifierConfig,
  appleIapSandboxVerifierConfig,
  isConfiguredAppleIapAppAppleId,
  normalizeAppleIapPrivateKey,
  readAppleIapApiClientConfig,
} from "./config";
import { AppleIapError } from "./errors";
import { APPLE_IAP_MONTHLY_PRODUCT_ID } from "./products";

const API_SECRETS = {
  APPLE_IAP_ISSUER_ID: "issuer-id",
  APPLE_IAP_KEY_ID: "KEYID12345",
  APPLE_IAP_PRIVATE_KEY:
    "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----",
};

describe("Apple IAP public config constants", () => {
  it("locks bundle ID in one code constant", () => {
    expect(APPLE_IAP_BUNDLE_ID).toBe("com.summittmindset.ios");
    expect(appleIapSandboxVerifierConfig().bundleId).toBe(APPLE_IAP_BUNDLE_ID);
  });

  it("locks monthly product ID in one code constant", () => {
    expect(APPLE_IAP_MONTHLY_PRODUCT_ID).toBe(
      "com.summittmindset.ios.membership.monthly"
    );
  });

  it("locks the real numeric App Store Connect Apple ID in code", () => {
    expect(APPLE_IAP_APP_APPLE_ID).toBe(6795223891);
    expect(Number.isSafeInteger(APPLE_IAP_APP_APPLE_ID)).toBe(true);
    expect(APPLE_IAP_APP_APPLE_ID).toBeGreaterThan(1);
    expect(APPLE_IAP_APP_APPLE_ID).not.toBe(0);
    expect(APPLE_IAP_APP_APPLE_ID).not.toBe(1);
    expect(isConfiguredAppleIapAppAppleId(APPLE_IAP_APP_APPLE_ID)).toBe(true);
    expect(isConfiguredAppleIapAppAppleId(0)).toBe(false);
    expect(isConfiguredAppleIapAppAppleId(1)).toBe(false);
  });

  it("sandbox verifier config does not require env or App Apple ID", () => {
    const config = appleIapSandboxVerifierConfig();
    expect(config).toEqual({
      bundleId: APPLE_IAP_BUNDLE_ID,
      environment: Environment.SANDBOX,
    });
    expect("appAppleId" in config && config.appAppleId !== undefined).toBe(
      false
    );
  });

  it("production verifier config uses the locked numeric App Apple ID", () => {
    expect(appleIapProductionVerifierConfig()).toEqual({
      bundleId: APPLE_IAP_BUNDLE_ID,
      environment: Environment.PRODUCTION,
      appAppleId: 6795223891,
    });
  });

  it("does not read public Apple identifiers from process.env", () => {
    const configSrc = readFileSync(
      join(process.cwd(), "src/lib/apple-iap/config.ts"),
      "utf8"
    );
    const productsSrc = readFileSync(
      join(process.cwd(), "src/lib/apple-iap/products.ts"),
      "utf8"
    );
    const verifierSrc = readFileSync(
      join(process.cwd(), "src/lib/apple-iap/verifier.ts"),
      "utf8"
    );
    for (const src of [configSrc, productsSrc, verifierSrc]) {
      expect(src).not.toMatch(/process\.env\.APPLE_IAP_BUNDLE_ID/);
      expect(src).not.toMatch(/process\.env\.APPLE_IAP_PRODUCT_ID_MONTHLY/);
      expect(src).not.toMatch(/process\.env\.APPLE_IAP_ENVIRONMENT/);
      expect(src).not.toMatch(/process\.env\.APPLE_IAP_APP_APPLE_ID/);
      expect(src).not.toMatch(/readTrimmed\(env,\s*"APPLE_IAP_BUNDLE_ID"\)/);
      expect(src).not.toMatch(
        /readTrimmed\(env,\s*"APPLE_IAP_PRODUCT_ID_MONTHLY"\)/
      );
      expect(src).not.toMatch(/readTrimmed\(env,\s*"APPLE_IAP_ENVIRONMENT"\)/);
      expect(src).not.toMatch(/readTrimmed\(env,\s*"APPLE_IAP_APP_APPLE_ID"\)/);
    }
  });
});

describe("Apple IAP API client config", () => {
  it("does not require API client secrets for sandbox verifier config", () => {
    expect(() => appleIapSandboxVerifierConfig()).not.toThrow();
  });

  it("requires issuer id for API client config", () => {
    expect(() =>
      readAppleIapApiClientConfig(Environment.SANDBOX, {
        APPLE_IAP_KEY_ID: "KEYID12345",
        APPLE_IAP_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----",
      })
    ).toThrow(/APPLE_IAP_ISSUER_ID/);
  });

  it("requires key id for API client config", () => {
    expect(() =>
      readAppleIapApiClientConfig(Environment.SANDBOX, {
        APPLE_IAP_ISSUER_ID: "issuer-id",
        APPLE_IAP_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----",
      })
    ).toThrow(/APPLE_IAP_KEY_ID/);
  });

  it("requires private key for API client config", () => {
    expect(() =>
      readAppleIapApiClientConfig(Environment.SANDBOX, {
        APPLE_IAP_ISSUER_ID: "issuer-id",
        APPLE_IAP_KEY_ID: "KEYID12345",
      })
    ).toThrow(/APPLE_IAP_PRIVATE_KEY/);
  });

  it("uses the code-constant bundle ID and caller-supplied environment", () => {
    const config = readAppleIapApiClientConfig(
      Environment.SANDBOX,
      API_SECRETS
    );
    expect(config.bundleId).toBe(APPLE_IAP_BUNDLE_ID);
    expect(config.environment).toBe(Environment.SANDBOX);
    expect(config.issuerId).toBe("issuer-id");
  });

  it("rejects Xcode/LocalTesting as API client environments", () => {
    expect(() =>
      readAppleIapApiClientConfig(Environment.XCODE, API_SECRETS)
    ).toThrow(AppleIapError);
    expect(() =>
      readAppleIapApiClientConfig(Environment.LOCAL_TESTING, API_SECRETS)
    ).toThrow(AppleIapError);
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
