import "server-only";

import { AppStoreServerAPIClient, type Environment } from "@apple/app-store-server-library";
import {
  readAppleIapApiClientConfig,
  type AppleIapApiClientConfig,
} from "./config";

export type CreateAppStoreServerApiClientOptions = {
  environment: Environment;
  config?: AppleIapApiClientConfig;
};

/**
 * Lazy factory around Apple's AppStoreServerAPIClient.
 *
 * Official constructor (v3.1.0):
 * new AppStoreServerAPIClient(
 *   signingKey: string,
 *   keyId: string,
 *   issuerId: string,
 *   bundleId: string,
 *   environment: Environment
 * )
 *
 * Must not be called at module import time. Missing API secrets fail only
 * when this factory (or readAppleIapApiClientConfig) is invoked.
 * Verifier/JWS paths must never call this.
 */
export function createAppStoreServerApiClient(
  options: CreateAppStoreServerApiClientOptions
): AppStoreServerAPIClient {
  const config =
    options.config ?? readAppleIapApiClientConfig(options.environment);
  return new AppStoreServerAPIClient(
    config.privateKey,
    config.keyId,
    config.issuerId,
    config.bundleId,
    config.environment
  );
}
