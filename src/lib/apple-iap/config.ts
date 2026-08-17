import "server-only";

import { Environment } from "@apple/app-store-server-library";
import { AppleIapError } from "./errors";

/** Locked iOS bundle ID. Public, not an env var. */
export const APPLE_IAP_BUNDLE_ID = "com.summittmindset.ios";

/**
 * Numeric App Store Connect Apple ID for this iOS app
 * (App Information → Apple ID). Public configuration, not a secret.
 */
export const APPLE_IAP_APP_APPLE_ID = 6795223891;

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
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
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

export function isConfiguredAppleIapAppAppleId(
  value: number | null
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 1
  );
}

export function appleIapSandboxVerifierConfig(): AppleIapVerifierConfig {
  return {
    bundleId: APPLE_IAP_BUNDLE_ID,
    environment: Environment.SANDBOX,
  };
}

/**
 * Production verifier config. Fails closed if APPLE_IAP_APP_APPLE_ID is not
 * a real positive App Store Connect numeric Apple ID.
 */
export function appleIapProductionVerifierConfig(): AppleIapVerifierConfig {
  if (!isConfiguredAppleIapAppAppleId(APPLE_IAP_APP_APPLE_ID)) {
    throw new AppleIapError(
      "apple_iap_not_configured",
      "Production Apple verification requires the numeric App Store Connect Apple ID in APPLE_IAP_APP_APPLE_ID"
    );
  }
  return {
    bundleId: APPLE_IAP_BUNDLE_ID,
    environment: Environment.PRODUCTION,
    appAppleId: APPLE_IAP_APP_APPLE_ID,
  };
}

/**
 * Config for App Store Server API client construction.
 * Call only when a route actually needs the API. Missing secrets fail here,
 * not at verifier import or JWS verification.
 *
 * Environment is a caller argument (Sandbox vs Production API host), not an env var.
 */
export function readAppleIapApiClientConfig(
  environment: Environment,
  env: EnvReader = process.env
): AppleIapApiClientConfig {
  if (
    environment !== Environment.SANDBOX &&
    environment !== Environment.PRODUCTION
  ) {
    throw new AppleIapError(
      "apple_iap_invalid_environment",
      "App Store Server API client environment must be Sandbox or Production"
    );
  }

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
    bundleId: APPLE_IAP_BUNDLE_ID,
    environment,
  };
}
