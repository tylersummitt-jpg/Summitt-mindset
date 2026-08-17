import "server-only";

import { Environment } from "@apple/app-store-server-library";

export type AppleIapEnvironmentName = "sandbox" | "production";

export type OfficialAppleIapEnvironment =
  | Environment.SANDBOX
  | Environment.PRODUCTION;

export function isAppleIapProductionEnvironment(
  environment: Environment
): boolean {
  return environment === Environment.PRODUCTION;
}

export function isAppleIapSandboxEnvironment(
  environment: Environment
): boolean {
  return environment === Environment.SANDBOX;
}

/** Official Sandbox/Production only. Xcode and LocalTesting are rejected. */
export function isOfficialAppleIapEnvironment(
  environment: Environment | string | undefined
): environment is Environment.SANDBOX | Environment.PRODUCTION {
  return (
    environment === Environment.SANDBOX ||
    environment === Environment.PRODUCTION
  );
}
