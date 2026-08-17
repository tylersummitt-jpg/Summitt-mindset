import { AppStoreServerAPIClient, Environment } from "@apple/app-store-server-library";
import { describe, expect, it } from "vitest";
import { createAppStoreServerApiClient } from "./api-client";
import { readAppleIapApiClientConfig } from "./config";
import { AppleIapError } from "./errors";

const API_ENV = {
  APPLE_IAP_ISSUER_ID: "issuer-id",
  APPLE_IAP_KEY_ID: "KEYID12345",
  APPLE_IAP_PRIVATE_KEY:
    "-----BEGIN PRIVATE KEY-----\\nMIGH\\n-----END PRIVATE KEY-----",
};

describe("Apple IAP App Store Server API client factory", () => {
  it("is lazy: missing secrets fail only when the client is requested", () => {
    expect(() =>
      createAppStoreServerApiClient({
        environment: Environment.SANDBOX,
        config: readAppleIapApiClientConfig(Environment.SANDBOX, {}),
      })
    ).toThrow(AppleIapError);
  });

  it("constructs when API secrets are present without contacting Apple", () => {
    const client = createAppStoreServerApiClient({
      environment: Environment.SANDBOX,
      config: readAppleIapApiClientConfig(Environment.SANDBOX, API_ENV),
    });
    expect(client).toBeInstanceOf(AppStoreServerAPIClient);
  });

  it("does not read APPLE_IAP_ENVIRONMENT", () => {
    const config = readAppleIapApiClientConfig(Environment.PRODUCTION, API_ENV);
    expect(config.environment).toBe(Environment.PRODUCTION);
    expect(config.bundleId).toBe("com.summittmindset.ios");
  });
});
