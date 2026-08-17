import "server-only";

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { VerificationStatus } from "@apple/app-store-server-library";
import {
  ACCOUNT_DELETION_IN_PROGRESS_BODY,
  assertEntitlementMutationAllowedForAccountDeletion,
} from "@/lib/account-deletion/deletion-guards";
import { getLiveAppleAccountToken } from "@/lib/apple-iap/bindings";
import { isAppleIapError } from "@/lib/apple-iap/errors";
import {
  appleAccountTokensEqual,
  persistOwnedAppleSubscription,
  validateDecodedAppleTransaction,
} from "@/lib/apple-iap/subscriptions";
import { verifySignedTransaction } from "@/lib/apple-iap/verifier";
import {
  isRetryableMembershipSourceOrClerkFailure,
  isSmsReplicaFailureAfterClerkSuccess,
  membershipProjectionClerkSucceeded,
  recomputeMembershipFromDurableSources,
} from "@/lib/summitt-membership-entitlement.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function json(
  body: Record<string, unknown>,
  status: number
): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function verificationStatus(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "status" in error) {
    return (error as { status: unknown }).status;
  }
  return undefined;
}

function isRetryableVerificationFailure(error: unknown): boolean {
  const nested =
    typeof error === "object" && error !== null && "cause" in error
      ? (error as { cause: unknown }).cause
      : undefined;
  return [error, nested].some(
    (candidate) =>
      verificationStatus(candidate) ===
      VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
  );
}

function logVerify(stage: string, extra: Record<string, unknown> = {}): void {
  console.error("[apple/verify]", { stage, ...extra });
}

/**
 * POST /api/apple/verify
 *
 * Verify a StoreKit signed transaction JWS, bind it to the authenticated
 * Clerk user via live appAccountToken, persist apple_subscriptions, recompute.
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return json({ error: "Unauthorized" }, 401);
  }

  const deletionGate =
    await assertEntitlementMutationAllowedForAccountDeletion(userId);
  if (!deletionGate.ok) {
    if (deletionGate.code === "lookup_failed") {
      logVerify("deletion_lookup_failed");
      return json({ error: "Internal Server Error" }, 500);
    }
    return json({ ...ACCOUNT_DELETION_IN_PROGRESS_BODY }, 409);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const signedTransactionInfo =
    body &&
    typeof body === "object" &&
    "signedTransactionInfo" in body &&
    typeof (body as { signedTransactionInfo?: unknown }).signedTransactionInfo ===
      "string"
      ? (body as { signedTransactionInfo: string }).signedTransactionInfo.trim()
      : "";
  if (!signedTransactionInfo) {
    return json({ error: "missing_signed_transaction_info" }, 400);
  }

  let decoded;
  let verifiedEnvironment;
  try {
    const verified = await verifySignedTransaction(signedTransactionInfo);
    decoded = verified.payload;
    verifiedEnvironment = verified.verifiedEnvironment;
  } catch (error) {
    if (isAppleIapError(error) && error.code === "apple_iap_not_configured") {
      logVerify("not_configured");
      return json({ error: "Internal Server Error" }, 500);
    }
    if (isRetryableVerificationFailure(error)) {
      logVerify("verification_retryable");
      return json({ error: "Internal Server Error" }, 500);
    }
    logVerify("verification_failed");
    return json({ error: "apple_iap_verification_failed" }, 400);
  }

  const validated = validateDecodedAppleTransaction(decoded, {
    environment: verifiedEnvironment,
  });
  if (!validated.ok) {
    logVerify("field_validation", {
      error: validated.error,
      productId:
        typeof decoded.productId === "string" ? decoded.productId : undefined,
    });
    return json({ error: validated.error }, 400);
  }
  if (!validated.value.entitled) {
    logVerify("not_entitled", {
      error: "apple_subscription_not_entitled",
      productId: validated.value.productId,
      environment: validated.value.environment,
    });
    return json({ error: "apple_subscription_not_entitled" }, 400);
  }

  const live = await getLiveAppleAccountToken(userId);
  if (!live.ok) {
    if (live.reason === "read_failed") {
      logVerify("binding_read_failed");
      return json({ error: "Internal Server Error" }, 500);
    }
    return json({ error: "apple_account_token_required" }, 409);
  }
  if (
    !appleAccountTokensEqual(
      live.appAccountToken,
      validated.value.appAccountToken
    )
  ) {
    return json({ error: "apple_account_token_mismatch" }, 409);
  }

  const persisted = await persistOwnedAppleSubscription({
    clerkUserId: userId,
    transaction: validated.value,
  });
  if (!persisted.ok) {
    if (persisted.reason === "owned_by_other") {
      return json({ error: "apple_transaction_owned" }, 409);
    }
    if (persisted.reason === "detached") {
      return json({ error: "apple_transaction_detached" }, 409);
    }
    logVerify("persist_failed", { reason: persisted.reason });
    return json({ error: "Internal Server Error" }, 500);
  }

  const projection = await recomputeMembershipFromDurableSources(userId);
  if (isRetryableMembershipSourceOrClerkFailure(projection)) {
    logVerify("recompute_retryable", { reason: projection.reason });
    return json({ error: "Internal Server Error" }, 500);
  }
  if (!membershipProjectionClerkSucceeded(projection)) {
    logVerify("recompute_failed");
    return json({ error: "Internal Server Error" }, 500);
  }
  if (isSmsReplicaFailureAfterClerkSuccess(projection)) {
    logVerify("sms_replica_failed");
  }

  return json({ ok: true }, 200);
}
