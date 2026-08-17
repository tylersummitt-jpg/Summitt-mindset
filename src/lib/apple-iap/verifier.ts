import "server-only";

import {
  Environment,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import { loadAppleIapRootCertificates } from "./certificates";
import {
  appleIapProductionVerifierConfig,
  appleIapSandboxVerifierConfig,
  type AppleIapVerifierConfig,
} from "./config";
import {
  isOfficialAppleIapEnvironment,
  type OfficialAppleIapEnvironment,
} from "./environment";
import { AppleIapError } from "./errors";

export type AppleSignedDataVerifier = SignedDataVerifier;

/**
 * Apple README uses enableOnlineChecks=true (revocation + expiry vs now).
 * Construction does not contact Apple; OCSP runs only during verify.
 */
const DEFAULT_ENABLE_ONLINE_CHECKS = true;

export type CreateSignedDataVerifierOptions = {
  config: AppleIapVerifierConfig;
  appleRootCertificates?: Buffer[];
  enableOnlineChecks?: boolean;
};

export type VerifiedAppleSignedData<T> = {
  payload: T;
  verifiedEnvironment: OfficialAppleIapEnvironment;
};

export type VerifyAppleSignedDataOptions = {
  /** Pin to one official environment. Nested webhook payloads must use this. */
  environment?: OfficialAppleIapEnvironment;
  /** Injected verifier (tests). Skips dual-environment fallback. */
  verifier?: SignedDataVerifier;
  sandboxVerifier?: SignedDataVerifier;
  productionVerifier?: SignedDataVerifier;
  appleRootCertificates?: Buffer[];
  enableOnlineChecks?: boolean;
};

/**
 * Factory around Apple's SignedDataVerifier.
 *
 * Official constructor (v3.1.0):
 * new SignedDataVerifier(
 *   appleRootCertificates: Buffer[],
 *   enableOnlineChecks: boolean,
 *   environment: Environment,
 *   bundleId: string,
 *   appAppleId?: number
 * )
 *
 * Caller supplies config. Never reads env. Never constructs Xcode/LocalTesting
 * (those skip cryptographic verification inside Apple's verifyJWT).
 *
 * appAppleId is required when environment is Production (library throws).
 * Sandbox may omit it.
 *
 * Does not require App Store Server API issuer/key/private-key secrets.
 */
export function createSignedDataVerifier(
  options: CreateSignedDataVerifierOptions
): SignedDataVerifier {
  if (!isOfficialAppleIapEnvironment(options.config.environment)) {
    throw new AppleIapError(
      "apple_iap_invalid_environment",
      "SignedDataVerifier environment must be Sandbox or Production"
    );
  }

  const appleRootCertificates =
    options.appleRootCertificates ?? loadAppleIapRootCertificates();
  const enableOnlineChecks =
    options.enableOnlineChecks ?? DEFAULT_ENABLE_ONLINE_CHECKS;

  return new SignedDataVerifier(
    appleRootCertificates,
    enableOnlineChecks,
    options.config.environment,
    options.config.bundleId,
    options.config.appAppleId
  );
}

export function createSandboxSignedDataVerifier(
  options: Omit<CreateSignedDataVerifierOptions, "config"> = {}
): SignedDataVerifier {
  return createSignedDataVerifier({
    ...options,
    config: appleIapSandboxVerifierConfig(),
  });
}

export function createProductionSignedDataVerifier(
  options: Omit<CreateSignedDataVerifierOptions, "config"> = {}
): SignedDataVerifier {
  return createSignedDataVerifier({
    ...options,
    config: appleIapProductionVerifierConfig(),
  });
}

function normalizeVerificationFailure(error: unknown): AppleIapError {
  if (error instanceof AppleIapError) return error;
  const status =
    error instanceof VerificationException ? error.status : undefined;
  return new AppleIapError(
    "apple_iap_verification_failed",
    status === undefined
      ? "Apple signed-data verification failed"
      : `Apple signed-data verification failed (${status})`,
    { cause: error }
  );
}

function verificationStatusOf(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "status" in error) {
    return (error as { status: unknown }).status;
  }
  return undefined;
}

function verificationStatuses(error: unknown): unknown[] {
  const nested =
    typeof error === "object" && error !== null && "cause" in error
      ? (error as { cause: unknown }).cause
      : undefined;
  return [error, nested].map(verificationStatusOf);
}

/** OCSP / retryable SignedDataVerifier failures. Duck-typed for module isolation. */
export function isRetryableAppleVerificationFailure(error: unknown): boolean {
  return verificationStatuses(error).includes(
    VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
  );
}

/**
 * Official INVALID_ENVIRONMENT (4) is thrown only after cryptographic
 * verification succeeded. Safe classifier for trying the other official env.
 */
export function isInvalidAppleEnvironmentFailure(error: unknown): boolean {
  return verificationStatuses(error).includes(
    VerificationStatus.INVALID_ENVIRONMENT
  );
}

async function callOfficialVerifier<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw normalizeVerificationFailure(error);
  }
}

function verifierConstructionOptions(
  options: VerifyAppleSignedDataOptions
): Omit<CreateSignedDataVerifierOptions, "config"> {
  return {
    appleRootCertificates: options.appleRootCertificates,
    enableOnlineChecks: options.enableOnlineChecks,
  };
}

function sandboxVerifierFrom(
  options: VerifyAppleSignedDataOptions
): SignedDataVerifier {
  return (
    options.sandboxVerifier ??
    createSandboxSignedDataVerifier(verifierConstructionOptions(options))
  );
}

function productionVerifierFrom(
  options: VerifyAppleSignedDataOptions
): SignedDataVerifier {
  return (
    options.productionVerifier ??
    createProductionSignedDataVerifier(verifierConstructionOptions(options))
  );
}

function verifierForPinnedEnvironment(
  environment: OfficialAppleIapEnvironment,
  options: VerifyAppleSignedDataOptions
): SignedDataVerifier {
  return environment === Environment.PRODUCTION
    ? productionVerifierFrom(options)
    : sandboxVerifierFrom(options);
}

/**
 * Cryptographic verification first. Environment is never taken from an
 * unverified JWS. Dual-env fallback runs only on official INVALID_ENVIRONMENT.
 *
 * Attempt order is Sandbox then Production: Production also checks appAppleId
 * for notifications, which would throw INVALID_APP_IDENTIFIER before
 * INVALID_ENVIRONMENT and block fallback.
 */
async function verifyWithOfficialEnvironmentFallback<T>(
  run: (verifier: SignedDataVerifier) => Promise<T>,
  options: VerifyAppleSignedDataOptions
): Promise<VerifiedAppleSignedData<T>> {
  if (options.verifier) {
    const payload = await callOfficialVerifier(() => run(options.verifier!));
    const verifiedEnvironment =
      options.environment ?? Environment.SANDBOX;
    if (!isOfficialAppleIapEnvironment(verifiedEnvironment)) {
      throw new AppleIapError(
        "apple_iap_invalid_environment",
        "Pinned Apple verifier environment must be Sandbox or Production"
      );
    }
    return { payload, verifiedEnvironment };
  }

  if (options.environment) {
    const verifier = verifierForPinnedEnvironment(
      options.environment,
      options
    );
    const payload = await callOfficialVerifier(() => run(verifier));
    return { payload, verifiedEnvironment: options.environment };
  }

  try {
    const payload = await callOfficialVerifier(() =>
      run(sandboxVerifierFrom(options))
    );
    return { payload, verifiedEnvironment: Environment.SANDBOX };
  } catch (error) {
    if (isRetryableAppleVerificationFailure(error)) {
      throw error;
    }
    if (!isInvalidAppleEnvironmentFailure(error)) {
      throw error;
    }
  }

  const payload = await callOfficialVerifier(() =>
    run(productionVerifierFrom(options))
  );
  return { payload, verifiedEnvironment: Environment.PRODUCTION };
}

export async function verifySignedTransaction(
  signedTransaction: string,
  options: VerifyAppleSignedDataOptions = {}
): Promise<VerifiedAppleSignedData<JWSTransactionDecodedPayload>> {
  return verifyWithOfficialEnvironmentFallback(
    (verifier) => verifier.verifyAndDecodeTransaction(signedTransaction),
    options
  );
}

export async function verifySignedNotification(
  signedPayload: string,
  options: VerifyAppleSignedDataOptions = {}
): Promise<VerifiedAppleSignedData<ResponseBodyV2DecodedPayload>> {
  return verifyWithOfficialEnvironmentFallback(
    (verifier) => verifier.verifyAndDecodeNotification(signedPayload),
    options
  );
}

export async function verifySignedRenewalInfo(
  signedRenewalInfo: string,
  options: VerifyAppleSignedDataOptions = {}
): Promise<VerifiedAppleSignedData<JWSRenewalInfoDecodedPayload>> {
  return verifyWithOfficialEnvironmentFallback(
    (verifier) => verifier.verifyAndDecodeRenewalInfo(signedRenewalInfo),
    options
  );
}
