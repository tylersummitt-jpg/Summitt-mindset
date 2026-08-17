import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Environment,
  InAppOwnershipType,
  Type,
  VerificationException,
  VerificationStatus,
  type JWSTransactionDecodedPayload,
} from "@apple/app-store-server-library";
import { AppleIapError } from "@/lib/apple-iap/errors";

vi.mock("server-only", () => ({}));

const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

const assertDeletionMock = vi.fn();
vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  ACCOUNT_DELETION_IN_PROGRESS_BODY: {
    error: "account_deletion_in_progress",
    message: "This action is unavailable.",
  },
  assertEntitlementMutationAllowedForAccountDeletion: (...args: unknown[]) =>
    assertDeletionMock(...args),
}));

const verifyMock = vi.fn();
vi.mock("@/lib/apple-iap/verifier", () => ({
  verifySignedTransaction: async (...args: unknown[]) => {
    const result = await verifyMock(...args);
    if (
      result &&
      typeof result === "object" &&
      "payload" in result &&
      "verifiedEnvironment" in result
    ) {
      return result;
    }
    return {
      payload: result,
      verifiedEnvironment: Environment.SANDBOX,
    };
  },
}));

const getLiveTokenMock = vi.fn();
vi.mock("@/lib/apple-iap/bindings", () => ({
  getLiveAppleAccountToken: (...args: unknown[]) => getLiveTokenMock(...args),
}));

const persistMock = vi.fn();
vi.mock("@/lib/apple-iap/subscriptions", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/apple-iap/subscriptions")
  >("@/lib/apple-iap/subscriptions");
  return {
    ...actual,
    persistOwnedAppleSubscription: (...args: unknown[]) => persistMock(...args),
  };
});

const recomputeMock = vi.fn();
vi.mock("@/lib/summitt-membership-entitlement.server", () => ({
  recomputeMembershipFromDurableSources: (...args: unknown[]) =>
    recomputeMock(...args),
  isRetryableMembershipSourceOrClerkFailure: (result: {
    ok: boolean;
    retryable?: boolean;
    reason?: string;
  }) =>
    result.ok === false &&
    result.retryable === true &&
    (result.reason === "stripe_lookup_failed" ||
      result.reason === "apple_lookup_failed" ||
      result.reason === "clerk_projection_failed"),
  membershipProjectionClerkSucceeded: (result: {
    ok: boolean;
    clerkUpdated?: boolean;
  }) => result.ok === true || result.clerkUpdated === true,
  isSmsReplicaFailureAfterClerkSuccess: (result: {
    ok: boolean;
    reason?: string;
  }) => result.ok === false && result.reason === "sms_sync_failed",
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

const TOKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_TOKEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JWS = "header.payload.signature";
const FUTURE_MS = Date.parse("2099-12-01T00:00:00.000Z");
const PAST_MS = Date.parse("2020-01-01T00:00:00.000Z");

function decodedTx(
  overrides: Partial<JWSTransactionDecodedPayload> = {}
): JWSTransactionDecodedPayload {
  return {
    bundleId: "com.summittmindset.ios",
    environment: Environment.SANDBOX,
    productId: "com.summittmindset.ios.membership.monthly",
    type: Type.AUTO_RENEWABLE_SUBSCRIPTION,
    inAppOwnershipType: InAppOwnershipType.PURCHASED,
    transactionId: "2001",
    originalTransactionId: "1001",
    appAccountToken: TOKEN,
    expiresDate: FUTURE_MS,
    ...overrides,
  };
}

function verifyRequest(body: unknown = { signedTransactionInfo: JWS }): Request {
  return new Request("http://localhost/api/apple/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/apple/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.APPLE_IAP_ISSUER_ID;
    delete process.env.APPLE_IAP_KEY_ID;
    delete process.env.APPLE_IAP_PRIVATE_KEY;
    authMock.mockResolvedValue({ userId: "user_1" });
    assertDeletionMock.mockResolvedValue({ ok: true });
    verifyMock.mockResolvedValue(decodedTx());
    getLiveTokenMock.mockResolvedValue({
      ok: true,
      appAccountToken: TOKEN,
    });
    persistMock.mockResolvedValue({ ok: true, outcome: "inserted" });
    recomputeMock.mockResolvedValue({
      ok: true,
      summittSubscribed: true,
      summittPlan: "monthly",
      summittPaymentSource: "apple",
    });
  });

  it("unauthenticated => 401", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(assertDeletionMock).not.toHaveBeenCalled();
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("deletion in progress => 409 before verification", async () => {
    assertDeletionMock.mockResolvedValue({
      ok: false,
      code: "account_deletion_in_progress",
    });
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "account_deletion_in_progress",
      message: "This action is unavailable.",
    });
    expect(verifyMock).not.toHaveBeenCalled();
    expect(getLiveTokenMock).not.toHaveBeenCalled();
    expect(persistMock).not.toHaveBeenCalled();
    expect(recomputeMock).not.toHaveBeenCalled();
  });

  it("deletion lookup failure => 500", async () => {
    assertDeletionMock.mockResolvedValue({
      ok: false,
      code: "lookup_failed",
    });
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(500);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("valid sandbox monthly PURCHASED => 200, writes row, recomputes", async () => {
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
    expect(verifyMock).toHaveBeenCalledWith(JWS);
    expect(persistMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: "user_1",
        transaction: expect.objectContaining({
          originalTransactionId: "1001",
          status: "active",
          entitled: true,
        }),
      })
    );
    expect(recomputeMock).toHaveBeenCalledWith("user_1");
  });

  it("wrong product => 400", async () => {
    verifyMock.mockResolvedValue(decodedTx({ productId: "com.other.sku" }));
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "apple_invalid_product" });
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("wrong bundle => 400", async () => {
    verifyMock.mockResolvedValue(decodedTx({ bundleId: "com.other.app" }));
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "apple_invalid_bundle" });
  });

  it("wrong environment => 400", async () => {
    verifyMock.mockResolvedValue(
      decodedTx({ environment: Environment.PRODUCTION })
    );
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "apple_invalid_environment" });
  });

  it("production verified transaction is accepted when verifiedEnvironment is Production", async () => {
    verifyMock.mockResolvedValue({
      payload: decodedTx({ environment: Environment.PRODUCTION }),
      verifiedEnvironment: Environment.PRODUCTION,
    });
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("wrong IAP type => 400", async () => {
    verifyMock.mockResolvedValue(decodedTx({ type: Type.NON_CONSUMABLE }));
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "apple_invalid_type" });
  });

  it("FAMILY_SHARED => 400", async () => {
    verifyMock.mockResolvedValue(
      decodedTx({ inAppOwnershipType: InAppOwnershipType.FAMILY_SHARED })
    );
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "apple_family_shared_not_allowed",
    });
  });

  it("non-retryable verification failure => 400", async () => {
    verifyMock.mockRejectedValue(
      new AppleIapError("apple_iap_verification_failed", "bad jws", {
        cause: new VerificationException(VerificationStatus.VERIFICATION_FAILURE),
      })
    );
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "apple_iap_verification_failed",
    });
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("retryable verification/OCSP failure => 500", async () => {
    verifyMock.mockRejectedValue(
      new AppleIapError("apple_iap_verification_failed", "ocsp", {
        cause: new VerificationException(
          VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
        ),
      })
    );
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal Server Error" });
  });

  it("missing transactionId => 400", async () => {
    verifyMock.mockResolvedValue(decodedTx({ transactionId: "" }));
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "apple_missing_transaction_id",
    });
  });

  it("missing originalTransactionId => 400", async () => {
    verifyMock.mockResolvedValue(decodedTx({ originalTransactionId: undefined }));
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "apple_missing_original_transaction_id",
    });
  });

  it("missing appAccountToken => 400", async () => {
    verifyMock.mockResolvedValue(decodedTx({ appAccountToken: undefined }));
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "apple_missing_app_account_token",
    });
  });

  it("malformed appAccountToken => 400", async () => {
    verifyMock.mockResolvedValue(decodedTx({ appAccountToken: "not-a-uuid" }));
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "apple_malformed_app_account_token",
    });
  });

  it("no live binding => 409", async () => {
    getLiveTokenMock.mockResolvedValue({ ok: false, reason: "not_found" });
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "apple_account_token_required",
    });
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("token mismatch => 409", async () => {
    getLiveTokenMock.mockResolvedValue({
      ok: true,
      appAccountToken: OTHER_TOKEN,
    });
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "apple_account_token_mismatch",
    });
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("same-user replay => 200", async () => {
    persistMock.mockResolvedValue({ ok: true, outcome: "updated" });
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("same originalTransactionId owned by other user => 409", async () => {
    persistMock.mockResolvedValue({ ok: false, reason: "owned_by_other" });
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "apple_transaction_owned" });
    expect(recomputeMock).not.toHaveBeenCalled();
  });

  it("detached originalTransactionId => 409", async () => {
    persistMock.mockResolvedValue({ ok: false, reason: "detached" });
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "apple_transaction_detached" });
    expect(recomputeMock).not.toHaveBeenCalled();
  });

  it("expired transaction => no entitlement", async () => {
    verifyMock.mockResolvedValue(decodedTx({ expiresDate: PAST_MS }));
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "apple_subscription_not_entitled",
    });
    expect(persistMock).not.toHaveBeenCalled();
    expect(recomputeMock).not.toHaveBeenCalled();
  });

  it("revoked/refunded transaction => no entitlement", async () => {
    verifyMock.mockResolvedValue(decodedTx({ revocationDate: PAST_MS }));
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "apple_subscription_not_entitled",
    });
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("Apple insert failure => 500", async () => {
    persistMock.mockResolvedValue({ ok: false, reason: "insert_failed" });
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(500);
    expect(recomputeMock).not.toHaveBeenCalled();
  });

  it("Apple update failure => 500", async () => {
    persistMock.mockResolvedValue({ ok: false, reason: "update_failed" });
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(500);
  });

  it("recompute failure after durable write => 500", async () => {
    recomputeMock.mockResolvedValue({
      ok: false,
      retryable: true,
      reason: "clerk_projection_failed",
      clerkUpdated: false,
    });
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(500);
    expect(persistMock).toHaveBeenCalled();
  });

  it("retry after recompute failure => 200", async () => {
    const { POST } = await import("./route");
    recomputeMock.mockResolvedValueOnce({
      ok: false,
      retryable: true,
      reason: "stripe_lookup_failed",
      clerkUpdated: false,
    });
    const first = await POST(verifyRequest());
    expect(first.status).toBe(500);
    recomputeMock.mockResolvedValueOnce({
      ok: true,
      summittSubscribed: true,
      summittPlan: "monthly",
      summittPaymentSource: "apple",
    });
    persistMock.mockResolvedValue({ ok: true, outcome: "updated" });
    const second = await POST(verifyRequest());
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true });
  });

  it("client userId has no authority", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      verifyRequest({
        signedTransactionInfo: JWS,
        userId: "attacker",
        clerkUserId: "attacker",
      })
    );
    expect(res.status).toBe(200);
    expect(persistMock).toHaveBeenCalledWith(
      expect.objectContaining({ clerkUserId: "user_1" })
    );
    expect(getLiveTokenMock).toHaveBeenCalledWith("user_1");
    expect(recomputeMock).toHaveBeenCalledWith("user_1");
  });

  it("does not require API issuer/key/private key and does not instantiate API client", async () => {
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(200);
    const src = readFileSync(
      join(process.cwd(), "src/app/api/apple/verify/route.ts"),
      "utf8"
    );
    expect(src).not.toContain("api-client");
    expect(src).not.toContain("createAppStoreServerApiClient");
    expect(src).not.toContain("APPLE_IAP_ISSUER_ID");
    expect(src).not.toContain("APPLE_IAP_KEY_ID");
    expect(src).not.toContain("APPLE_IAP_PRIVATE_KEY");
    expect(src).not.toContain("APPLE_IAP_ENVIRONMENT");
    expect(src).not.toContain("APPLE_IAP_BUNDLE_ID");
    expect(src).not.toContain("APPLE_IAP_APP_APPLE_ID");
    expect(src).not.toContain("readAppleIapVerifierConfig");
    expect(src).toContain("verifySignedTransaction");
  });

  it("does not return or log the raw JWS", async () => {
    const logged: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args);
    });
    const { POST } = await import("./route");
    const res = await POST(verifyRequest());
    expect(res.status).toBe(200);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain(JWS);
    expect(JSON.stringify(logged)).not.toContain(JWS);
    spy.mockRestore();
  });

  it("malformed JSON => 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/apple/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });
});
