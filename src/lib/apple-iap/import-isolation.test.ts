import { describe, expect, it } from "vitest";

describe("Apple IAP Phase 4 import isolation", () => {
  it("verifier import does not require API client secrets", async () => {
    const previous = {
      issuer: process.env.APPLE_IAP_ISSUER_ID,
      keyId: process.env.APPLE_IAP_KEY_ID,
      privateKey: process.env.APPLE_IAP_PRIVATE_KEY,
    };
    delete process.env.APPLE_IAP_ISSUER_ID;
    delete process.env.APPLE_IAP_KEY_ID;
    delete process.env.APPLE_IAP_PRIVATE_KEY;

    try {
      const { createSignedDataVerifier } = await import("./verifier");
      const { loadAppleIapRootCertificates } = await import("./certificates");
      const { APPLE_IAP_BUNDLE_ID, readAppleIapVerifierConfig } = await import(
        "./config"
      );

      expect(() =>
        createSignedDataVerifier({
          config: readAppleIapVerifierConfig({
            APPLE_IAP_BUNDLE_ID,
            APPLE_IAP_ENVIRONMENT: "sandbox",
          }),
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
    }
  });
});
