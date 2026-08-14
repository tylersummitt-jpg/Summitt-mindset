import "server-only";

import { Environment } from "@apple/app-store-server-library";
import { AppleIapError } from "./errors";

export type AppleIapEnvironmentName = "sandbox" | "production";

/**
 * Map our env string to Apple's Environment enum.
 * Unknown values fail closed — no silent sandbox or production fallback.
 */
export function normalizeAppleIapEnvironment(raw: string): Environment {
  const value = raw.trim().toLowerCase();
  if (value === "sandbox") return Environment.SANDBOX;
  if (value === "production") return Environment.PRODUCTION;
  throw new AppleIapError(
    "apple_iap_invalid_environment",
    "APPLE_IAP_ENVIRONMENT must be sandbox or production"
  );
}

export function isAppleIapProductionEnvironment(environment: Environment): boolean {
  return environment === Environment.PRODUCTION;
}
