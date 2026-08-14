import {
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
} from "@apple/app-store-server-library";
import { describe, expect, it, vi } from "vitest";
import { loadAppleIapRootCertificates } from "./certificates";
import { APPLE_IAP_BUNDLE_ID, readAppleIapVerifierConfig } from "./config";
import { AppleIapError } from "./errors";
import {
  createSignedDataVerifier,
  verifySignedNotification,
  verifySignedRenewalInfo,
  verifySignedTransaction,
} from "./verifier";

const sandboxConfig = () =>
  readAppleIapVerifierConfig({
    APPLE_IAP_BUNDLE_ID,
    APPLE_IAP_ENVIRONMENT: "sandbox",
  });

describe("Apple IAP SignedDataVerifier factory", () => {
  it("constructs in sandbox with public Apple root cert buffers", () => {
    const verifier = createSignedDataVerifier({
      config: sandboxConfig(),
      appleRootCertificates: loadAppleIapRootCertificates(),
      enableOnlineChecks: false,
    });
    expect(verifier).toBeInstanceOf(SignedDataVerifier);
  });

  it("does not require API client secrets to construct a verifier", () => {
    expect(() =>
      createSignedDataVerifier({
        config: sandboxConfig(),
        appleRootCertificates: loadAppleIapRootCertificates(),
        enableOnlineChecks: false,
      })
    ).not.toThrow();
  });
});

describe("Apple IAP verification helpers", () => {
  it("calls verifyAndDecodeTransaction and normalizes failure", async () => {
    const verifyAndDecodeTransaction = vi.fn(async () => {
      throw new VerificationException(VerificationStatus.VERIFICATION_FAILURE);
    });
    const verifier = {
      verifyAndDecodeTransaction,
    } as unknown as SignedDataVerifier;

    await expect(
      verifySignedTransaction("signed.transaction.placeholder", verifier)
    ).rejects.toMatchObject({
      name: "AppleIapError",
      code: "apple_iap_verification_failed",
    });
    expect(verifyAndDecodeTransaction).toHaveBeenCalledTimes(1);
    expect(verifyAndDecodeTransaction).toHaveBeenCalledWith(
      "signed.transaction.placeholder"
    );
  });

  it("calls verifyAndDecodeNotification and normalizes failure", async () => {
    const verifyAndDecodeNotification = vi.fn(async () => {
      throw new VerificationException(VerificationStatus.INVALID_ENVIRONMENT);
    });
    const verifier = {
      verifyAndDecodeNotification,
    } as unknown as SignedDataVerifier;

    await expect(
      verifySignedNotification("signed.notification.placeholder", verifier)
    ).rejects.toBeInstanceOf(AppleIapError);
    await expect(
      verifySignedNotification("signed.notification.placeholder", verifier)
    ).rejects.toMatchObject({ code: "apple_iap_verification_failed" });
    expect(verifyAndDecodeNotification).toHaveBeenCalledWith(
      "signed.notification.placeholder"
    );
  });

  it("calls verifyAndDecodeRenewalInfo and normalizes failure", async () => {
    const verifyAndDecodeRenewalInfo = vi.fn(async () => {
      throw new VerificationException(VerificationStatus.VERIFICATION_FAILURE);
    });
    const verifier = {
      verifyAndDecodeRenewalInfo,
    } as unknown as SignedDataVerifier;

    await expect(
      verifySignedRenewalInfo("signed.renewal.placeholder", verifier)
    ).rejects.toMatchObject({
      name: "AppleIapError",
      code: "apple_iap_verification_failed",
    });
    expect(verifyAndDecodeRenewalInfo).toHaveBeenCalledWith(
      "signed.renewal.placeholder"
    );
  });
});
