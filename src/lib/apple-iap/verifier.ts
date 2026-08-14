import "server-only";

import {
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import { loadAppleIapRootCertificates } from "./certificates";
import {
  readAppleIapVerifierConfig,
  type AppleIapVerifierConfig,
} from "./config";
import { AppleIapError } from "./errors";

export type AppleSignedDataVerifier = SignedDataVerifier;

/**
 * Apple README uses enableOnlineChecks=true (revocation + expiry vs now).
 * Construction does not contact Apple; OCSP runs only during verify.
 */
const DEFAULT_ENABLE_ONLINE_CHECKS = true;

export type CreateSignedDataVerifierOptions = {
  config?: AppleIapVerifierConfig;
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
 * appAppleId is required when environment is Production (library throws).
 * Sandbox may omit it.
 *
 * Does not require App Store Server API issuer/key/private-key secrets.
 */
export function createSignedDataVerifier(
  options: CreateSignedDataVerifierOptions = {}
): SignedDataVerifier {
  const config = options.config ?? readAppleIapVerifierConfig();
  const appleRootCertificates =
    options.appleRootCertificates ?? loadAppleIapRootCertificates();
  const enableOnlineChecks =
    options.enableOnlineChecks ?? DEFAULT_ENABLE_ONLINE_CHECKS;

  return new SignedDataVerifier(
    appleRootCertificates,
    enableOnlineChecks,
    config.environment,
    config.bundleId,
    config.appAppleId
  );
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

export async function verifySignedTransaction(
  signedTransaction: string,
  verifier: SignedDataVerifier = createSignedDataVerifier()
): Promise<JWSTransactionDecodedPayload> {
  try {
    return await verifier.verifyAndDecodeTransaction(signedTransaction);
  } catch (error) {
    throw normalizeVerificationFailure(error);
  }
}

export async function verifySignedNotification(
  signedPayload: string,
  verifier: SignedDataVerifier = createSignedDataVerifier()
): Promise<ResponseBodyV2DecodedPayload> {
  try {
    return await verifier.verifyAndDecodeNotification(signedPayload);
  } catch (error) {
    throw normalizeVerificationFailure(error);
  }
}

export async function verifySignedRenewalInfo(
  signedRenewalInfo: string,
  verifier: SignedDataVerifier = createSignedDataVerifier()
): Promise<JWSRenewalInfoDecodedPayload> {
  try {
    return await verifier.verifyAndDecodeRenewalInfo(signedRenewalInfo);
  } catch (error) {
    throw normalizeVerificationFailure(error);
  }
}

function verificationStatusOf(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "status" in error) {
    return (error as { status: unknown }).status;
  }
  return undefined;
}

/** OCSP / retryable SignedDataVerifier failures. Duck-typed for module isolation. */
export function isRetryableAppleVerificationFailure(error: unknown): boolean {
  const nested =
    typeof error === "object" && error !== null && "cause" in error
      ? (error as { cause: unknown }).cause
      : undefined;
  return [error, nested].some(
    (candidate) =>
      verificationStatusOf(candidate) ===
      VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
  );
}
