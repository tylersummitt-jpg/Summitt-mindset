import { AppStoreServerAPIClient } from "@apple/app-store-server-library";
import { describe, expect, it } from "vitest";
import { createAppStoreServerApiClient } from "./api-client";
import {
  APPLE_IAP_BUNDLE_ID,
  readAppleIapApiClientConfig,
} from "./config";
import { AppleIapError } from "./errors";

const API_ENV = {
  APPLE_IAP_BUNDLE_ID,
  APPLE_IAP_ENVIRONMENT: "sandbox",
  APPLE_IAP_ISSUER_ID: "issuer-id",
  APPLE_IAP_KEY_ID: "KEYID12345",
  APPLE_IAP_PRIVATE_KEY:
    "-----BEGIN PRIVATE KEY-----\\nMIGH\\n-----END PRIVATE KEY-----",
};

describe("Apple IAP App Store Server API client factory", () => {
  it("is lazy: missing secrets fail only when the client is requested", () => {
    expect(() =>
      createAppStoreServerApiClient({
        config: readAppleIapApiClientConfig({
          APPLE_IAP_BUNDLE_ID,
          APPLE_IAP_ENVIRONMENT: "sandbox",
        }),
      })
    ).toThrow(AppleIapError);
  });

  it("constructs when API secrets are present without contacting Apple", () => {
    const client = createAppStoreServerApiClient({
      config: readAppleIapApiClientConfig(API_ENV),
    });
    expect(client).toBeInstanceOf(AppStoreServerAPIClient);
  });
});
