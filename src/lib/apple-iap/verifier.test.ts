import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Environment,
  SignedDataVerifier,
  VerificationException,
  VerificationStatus,
} from "@apple/app-store-server-library";
import { describe, expect, it, vi } from "vitest";
import { loadAppleIapRootCertificates } from "./certificates";
import {
  APPLE_IAP_APP_APPLE_ID,
  APPLE_IAP_BUNDLE_ID,
  appleIapProductionVerifierConfig,
  appleIapSandboxVerifierConfig,
} from "./config";
import { AppleIapError } from "./errors";
import {
  createProductionSignedDataVerifier,
  createSandboxSignedDataVerifier,
  createSignedDataVerifier,
  isInvalidAppleEnvironmentFailure,
  isRetryableAppleVerificationFailure,
  verifySignedNotification,
  verifySignedRenewalInfo,
  verifySignedTransaction,
} from "./verifier";

function mockVerifier(overrides: {
  transaction?: () => Promise<unknown>;
  notification?: () => Promise<unknown>;
  renewal?: () => Promise<unknown>;
}): SignedDataVerifier {
  return {
    verifyAndDecodeTransaction:
      overrides.transaction ??
      (async () => {
        throw new Error("unexpected transaction verify");
      }),
    verifyAndDecodeNotification:
      overrides.notification ??
      (async () => {
        throw new Error("unexpected notification verify");
      }),
    verifyAndDecodeRenewalInfo:
      overrides.renewal ??
      (async () => {
        throw new Error("unexpected renewal verify");
      }),
  } as unknown as SignedDataVerifier;
}

describe("Apple IAP SignedDataVerifier factory", () => {
  it("constructs sandbox with public Apple root cert buffers and hardcoded bundle ID", () => {
    const verifier = createSandboxSignedDataVerifier({
      appleRootCertificates: loadAppleIapRootCertificates(),
      enableOnlineChecks: false,
    });
    expect(verifier).toBeInstanceOf(SignedDataVerifier);
    expect(appleIapSandboxVerifierConfig().bundleId).toBe(APPLE_IAP_BUNDLE_ID);
  });

  it("does not require API client secrets to construct a sandbox verifier", () => {
    expect(() =>
      createSandboxSignedDataVerifier({
        appleRootCertificates: loadAppleIapRootCertificates(),
        enableOnlineChecks: false,
      })
    ).not.toThrow();
  });

  it("production verifier constructs with the locked numeric App Apple ID", () => {
    expect(appleIapProductionVerifierConfig().appAppleId).toBe(
      APPLE_IAP_APP_APPLE_ID
    );
    expect(APPLE_IAP_APP_APPLE_ID).toBe(6795223891);
    const verifier = createProductionSignedDataVerifier({
      appleRootCertificates: loadAppleIapRootCertificates(),
      enableOnlineChecks: false,
    });
    expect(verifier).toBeInstanceOf(SignedDataVerifier);
  });

  it("refuses Xcode and LocalTesting verifier construction", () => {
    expect(() =>
      createSignedDataVerifier({
        config: {
          bundleId: APPLE_IAP_BUNDLE_ID,
          environment: Environment.XCODE,
        },
        appleRootCertificates: loadAppleIapRootCertificates(),
        enableOnlineChecks: false,
      })
    ).toThrow(AppleIapError);
    expect(() =>
      createSignedDataVerifier({
        config: {
          bundleId: APPLE_IAP_BUNDLE_ID,
          environment: Environment.LOCAL_TESTING,
        },
        appleRootCertificates: loadAppleIapRootCertificates(),
        enableOnlineChecks: false,
      })
    ).toThrow(AppleIapError);
  });
});

describe("Apple IAP dual-environment verification", () => {
  it("sandbox transaction verification works without env config", async () => {
    const payload = {
      bundleId: APPLE_IAP_BUNDLE_ID,
      environment: Environment.SANDBOX,
    };
    const sandbox = mockVerifier({
      transaction: async () => payload,
    });
    const production = mockVerifier({});
    const result = await verifySignedTransaction("signed.tx", {
      sandboxVerifier: sandbox,
      productionVerifier: production,
    });
    expect(result).toEqual({
      payload,
      verifiedEnvironment: Environment.SANDBOX,
    });
  });

  it("production transaction verification works once production verifier is supplied", async () => {
    const payload = {
      bundleId: APPLE_IAP_BUNDLE_ID,
      environment: Environment.PRODUCTION,
    };
    const sandbox = mockVerifier({
      transaction: async () => {
        throw new VerificationException(VerificationStatus.INVALID_ENVIRONMENT);
      },
    });
    const production = mockVerifier({
      transaction: async () => payload,
    });
    const result = await verifySignedTransaction("signed.tx", {
      sandboxVerifier: sandbox,
      productionVerifier: production,
    });
    expect(result).toEqual({
      payload,
      verifiedEnvironment: Environment.PRODUCTION,
    });
  });

  it("sandbox notification verification works without env config", async () => {
    const payload = { notificationUUID: "uuid", data: { environment: Environment.SANDBOX } };
    const result = await verifySignedNotification("signed.note", {
      sandboxVerifier: mockVerifier({ notification: async () => payload }),
      productionVerifier: mockVerifier({}),
    });
    expect(result.verifiedEnvironment).toBe(Environment.SANDBOX);
    expect(result.payload).toEqual(payload);
  });

  it("production notification verification works once production verifier is supplied", async () => {
    const payload = {
      notificationUUID: "uuid",
      data: { environment: Environment.PRODUCTION },
    };
    const result = await verifySignedNotification("signed.note", {
      sandboxVerifier: mockVerifier({
        notification: async () => {
          throw new VerificationException(
            VerificationStatus.INVALID_ENVIRONMENT
          );
        },
      }),
      productionVerifier: mockVerifier({
        notification: async () => payload,
      }),
    });
    expect(result.verifiedEnvironment).toBe(Environment.PRODUCTION);
  });

  it("does not trust an unverified environment claim to select a verifier", async () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/apple-iap/verifier.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/jsonwebtoken\.decode/);
    expect(src).not.toMatch(/jwt\.decode/);
    expect(src).not.toContain("atob(");
    const productionRun = vi.fn(async () => ({
      environment: Environment.PRODUCTION,
    }));
    const sandbox = mockVerifier({
      transaction: async () => {
        throw new VerificationException(VerificationStatus.INVALID_ENVIRONMENT);
      },
    });
    await verifySignedTransaction("header.payload.signature", {
      sandboxVerifier: sandbox,
      productionVerifier: mockVerifier({ transaction: productionRun }),
    });
    expect(productionRun).toHaveBeenCalledTimes(1);
  });

  it("production/sandbox cross-environment payload fails when pinned", async () => {
    await expect(
      verifySignedTransaction("signed.tx", {
        environment: Environment.SANDBOX,
        sandboxVerifier: mockVerifier({
          transaction: async () => {
            throw new VerificationException(
              VerificationStatus.INVALID_ENVIRONMENT
            );
          },
        }),
        productionVerifier: mockVerifier({
          transaction: async () => ({ environment: Environment.PRODUCTION }),
        }),
      })
    ).rejects.toMatchObject({
      code: "apple_iap_verification_failed",
    });
  });

  it("retryable OCSP/network failure remains retryable and does not try the other environment", async () => {
    const productionTx = vi.fn(async () => ({
      environment: Environment.PRODUCTION,
    }));
    const sandbox = mockVerifier({
      transaction: async () => {
        throw new VerificationException(
          VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
        );
      },
    });
    const error = await verifySignedTransaction("signed.tx", {
      sandboxVerifier: sandbox,
      productionVerifier: mockVerifier({ transaction: productionTx }),
    }).catch((caught) => caught);
    expect(isRetryableAppleVerificationFailure(error)).toBe(true);
    expect(isInvalidAppleEnvironmentFailure(error)).toBe(false);
    expect(productionTx).not.toHaveBeenCalled();
  });

  it("permanent invalid signature remains permanent and does not try the other environment", async () => {
    const productionTx = vi.fn(async () => ({
      environment: Environment.PRODUCTION,
    }));
    const sandbox = mockVerifier({
      transaction: async () => {
        throw new VerificationException(VerificationStatus.VERIFICATION_FAILURE);
      },
    });
    const error = await verifySignedTransaction("signed.tx", {
      sandboxVerifier: sandbox,
      productionVerifier: mockVerifier({ transaction: productionTx }),
    }).catch((caught) => caught);
    expect(error).toMatchObject({ code: "apple_iap_verification_failed" });
    expect(isRetryableAppleVerificationFailure(error)).toBe(false);
    expect(isInvalidAppleEnvironmentFailure(error)).toBe(false);
    expect(productionTx).not.toHaveBeenCalled();
  });

  it("INVALID_APP_IDENTIFIER does not fall through to the other environment", async () => {
    const production = mockVerifier({
      transaction: async () => ({ environment: Environment.PRODUCTION }),
    });
    await expect(
      verifySignedTransaction("signed.tx", {
        sandboxVerifier: mockVerifier({
          transaction: async () => {
            throw new VerificationException(
              VerificationStatus.INVALID_APP_IDENTIFIER
            );
          },
        }),
        productionVerifier: production,
      })
    ).rejects.toMatchObject({ code: "apple_iap_verification_failed" });
  });

  it("classifies official INVALID_ENVIRONMENT after crypto as the only dual-env fallback", () => {
    const invalidEnv = new AppleIapError(
      "apple_iap_verification_failed",
      "env",
      {
        cause: new VerificationException(VerificationStatus.INVALID_ENVIRONMENT),
      }
    );
    const retryable = new AppleIapError("apple_iap_verification_failed", "ocsp", {
      cause: new VerificationException(
        VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
      ),
    });
    expect(isInvalidAppleEnvironmentFailure(invalidEnv)).toBe(true);
    expect(isRetryableAppleVerificationFailure(retryable)).toBe(true);
    expect(isInvalidAppleEnvironmentFailure(retryable)).toBe(false);
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
      verifySignedTransaction("signed.transaction.placeholder", { verifier })
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
      verifySignedNotification("signed.notification.placeholder", { verifier })
    ).rejects.toBeInstanceOf(AppleIapError);
    await expect(
      verifySignedNotification("signed.notification.placeholder", { verifier })
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
      verifySignedRenewalInfo("signed.renewal.placeholder", { verifier })
    ).rejects.toMatchObject({
      name: "AppleIapError",
      code: "apple_iap_verification_failed",
    });
    expect(verifyAndDecodeRenewalInfo).toHaveBeenCalledWith(
      "signed.renewal.placeholder"
    );
  });

  it("pinned environment does not attempt dual fallback", async () => {
    const production = mockVerifier({
      renewal: async () => ({ environment: Environment.PRODUCTION }),
    });
    await expect(
      verifySignedRenewalInfo("signed.renewal", {
        environment: Environment.SANDBOX,
        sandboxVerifier: mockVerifier({
          renewal: async () => {
            throw new VerificationException(
              VerificationStatus.INVALID_ENVIRONMENT
            );
          },
        }),
        productionVerifier: production,
      })
    ).rejects.toMatchObject({ code: "apple_iap_verification_failed" });
  });
});
