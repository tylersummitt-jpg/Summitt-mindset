import { describe, expect, it } from "vitest";
import { Environment } from "@apple/app-store-server-library";

describe("Apple IAP import isolation", () => {
  it("importing Apple modules requires no Apple credential or public-config env vars", async () => {
    const previous = {
      issuer: process.env.APPLE_IAP_ISSUER_ID,
      keyId: process.env.APPLE_IAP_KEY_ID,
      privateKey: process.env.APPLE_IAP_PRIVATE_KEY,
      bundle: process.env.APPLE_IAP_BUNDLE_ID,
      product: process.env.APPLE_IAP_PRODUCT_ID_MONTHLY,
      environment: process.env.APPLE_IAP_ENVIRONMENT,
      appAppleId: process.env.APPLE_IAP_APP_APPLE_ID,
    };
    delete process.env.APPLE_IAP_ISSUER_ID;
    delete process.env.APPLE_IAP_KEY_ID;
    delete process.env.APPLE_IAP_PRIVATE_KEY;
    delete process.env.APPLE_IAP_BUNDLE_ID;
    delete process.env.APPLE_IAP_PRODUCT_ID_MONTHLY;
    delete process.env.APPLE_IAP_ENVIRONMENT;
    delete process.env.APPLE_IAP_APP_APPLE_ID;

    try {
      const { createSandboxSignedDataVerifier } = await import("./verifier");
      const { loadAppleIapRootCertificates } = await import("./certificates");
      const { appleIapSandboxVerifierConfig } = await import("./config");

      expect(appleIapSandboxVerifierConfig().bundleId).toBe(
        "com.summittmindset.ios"
      );
      expect(() =>
        createSandboxSignedDataVerifier({
          appleRootCertificates: loadAppleIapRootCertificates(),
          enableOnlineChecks: false,
        })
      ).not.toThrow();
    } finally {
      if (previous.issuer !== undefined) {
        process.env.APPLE_IAP_ISSUER_ID = previous.issuer;
      }
      if (previous.keyId !== undefined) {
        process.env.APPLE_IAP_KEY_ID = previous.keyId;
      }
      if (previous.privateKey !== undefined) {
        process.env.APPLE_IAP_PRIVATE_KEY = previous.privateKey;
      }
      if (previous.bundle !== undefined) {
        process.env.APPLE_IAP_BUNDLE_ID = previous.bundle;
      }
      if (previous.product !== undefined) {
        process.env.APPLE_IAP_PRODUCT_ID_MONTHLY = previous.product;
      }
      if (previous.environment !== undefined) {
        process.env.APPLE_IAP_ENVIRONMENT = previous.environment;
      }
      if (previous.appAppleId !== undefined) {
        process.env.APPLE_IAP_APP_APPLE_ID = previous.appAppleId;
      }
    }
  });

  it("API client credentials remain unread until the client factory runs", async () => {
    delete process.env.APPLE_IAP_ISSUER_ID;
    delete process.env.APPLE_IAP_KEY_ID;
    delete process.env.APPLE_IAP_PRIVATE_KEY;
    const { createAppStoreServerApiClient } = await import("./api-client");
    expect(() =>
      createAppStoreServerApiClient({ environment: Environment.SANDBOX })
    ).toThrow(/APPLE_IAP_ISSUER_ID/);
  });
});
