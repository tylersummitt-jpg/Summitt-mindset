import "server-only";

import { Environment } from "@apple/app-store-server-library";
import {
  isAppleIapProductionEnvironment,
  normalizeAppleIapEnvironment,
} from "./environment";
import { AppleIapError } from "./errors";

/** Locked iOS bundle ID. */
export const APPLE_IAP_BUNDLE_ID = "com.summittmindset.ios";

export type EnvReader = Record<string, string | undefined>;

export type AppleIapVerifierConfig = {
  bundleId: string;
  environment: Environment;
  /** Required by Apple's SignedDataVerifier when environment is Production. */
  appAppleId?: number;
};

export type AppleIapApiClientConfig = {
  issuerId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
  environment: Environment;
};

function readTrimmed(env: EnvReader, key: string): string | undefined {
  const raw = env[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Vercel/env-store often keeps PEM as a single line with escaped newlines.
 * Only rewrite the two-character sequence `\`+`n`; do not log the result.
 */
export function normalizeAppleIapPrivateKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("\\n")) {
    return trimmed.replace(/\\n/g, "\n");
  }
  return trimmed;
}

function parseAppAppleId(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[0-9]+$/.test(raw)) {
    throw new AppleIapError(
      "apple_iap_not_configured",
      "APPLE_IAP_APP_APPLE_ID must be a positive integer"
    );
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppleIapError(
      "apple_iap_not_configured",
      "APPLE_IAP_APP_APPLE_ID must be a positive integer"
    );
  }
  return value;
}

/**
 * Config for local JWS verification (SignedDataVerifier).
 * Does not require App Store Server API issuer/key/private-key secrets.
 */
export function readAppleIapVerifierConfig(
  env: EnvReader = process.env
): AppleIapVerifierConfig {
  const bundleId = readTrimmed(env, "APPLE_IAP_BUNDLE_ID");
  if (!bundleId) {
    throw new AppleIapError(
      "apple_iap_not_configured",
      "APPLE_IAP_BUNDLE_ID is required for Apple signed-data verification"
    );
  }

  const environmentRaw = readTrimmed(env, "APPLE_IAP_ENVIRONMENT");
  if (!environmentRaw) {
    throw new AppleIapError(
      "apple_iap_not_configured",
      "APPLE_IAP_ENVIRONMENT is required for Apple signed-data verification"
    );
  }
  const environment = normalizeAppleIapEnvironment(environmentRaw);

  const appAppleId = parseAppAppleId(readTrimmed(env, "APPLE_IAP_APP_APPLE_ID"));
  if (isAppleIapProductionEnvironment(environment) && appAppleId === undefined) {
    throw new AppleIapError(
      "apple_iap_not_configured",
      "APPLE_IAP_APP_APPLE_ID is required when APPLE_IAP_ENVIRONMENT is production"
    );
  }

  return { bundleId, environment, appAppleId };
}

/**
 * Config for App Store Server API client construction.
 * Call only when a route actually needs the API. Missing secrets fail here,
 * not at verifier import or JWS verification config.
 */
export function readAppleIapApiClientConfig(
  env: EnvReader = process.env
): AppleIapApiClientConfig {
  const verifier = readAppleIapVerifierConfig(env);

  const issuerId = readTrimmed(env, "APPLE_IAP_ISSUER_ID");
  if (!issuerId) {
    throw new AppleIapError(
      "apple_iap_not_configured",
      "APPLE_IAP_ISSUER_ID is required for the App Store Server API client"
    );
  }

  const keyId = readTrimmed(env, "APPLE_IAP_KEY_ID");
  if (!keyId) {
    throw new AppleIapError(
      "apple_iap_not_configured",
      "APPLE_IAP_KEY_ID is required for the App Store Server API client"
    );
  }

  const privateKeyRaw = readTrimmed(env, "APPLE_IAP_PRIVATE_KEY");
  if (!privateKeyRaw) {
    throw new AppleIapError(
      "apple_iap_not_configured",
      "APPLE_IAP_PRIVATE_KEY is required for the App Store Server API client"
    );
  }

  return {
    issuerId,
    keyId,
    privateKey: normalizeAppleIapPrivateKey(privateKeyRaw),
    bundleId: verifier.bundleId,
    environment: verifier.environment,
  };
}
