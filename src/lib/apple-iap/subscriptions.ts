import "server-only";

import {
  Environment,
  InAppOwnershipType,
  Type,
  type JWSTransactionDecodedPayload,
} from "@apple/app-store-server-library";
import { APPLE_IAP_BUNDLE_ID } from "./config";
import { isAllowedAppleIapProductId } from "./products";
import { isPostgresUniqueViolation } from "./bindings";
import { supabaseServer } from "@/lib/supabase-server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AppleSubscriptionNormalizedStatus =
  | "active"
  | "expired"
  | "refunded";

export type AppleIapVerifyErrorCode =
  | "apple_invalid_bundle"
  | "apple_invalid_environment"
  | "apple_invalid_product"
  | "apple_invalid_type"
  | "apple_family_shared_not_allowed"
  | "apple_missing_transaction_id"
  | "apple_missing_original_transaction_id"
  | "apple_missing_app_account_token"
  | "apple_malformed_app_account_token"
  | "apple_missing_expires_date"
  | "apple_subscription_not_entitled";

export type ValidatedAppleTransaction = {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  bundleId: string;
  environment: "sandbox" | "production";
  appAccountToken: string;
  expiresAt: Date;
  status: AppleSubscriptionNormalizedStatus;
  entitled: boolean;
  refundedAt: string | null;
};

export type AppleTransactionValidationResult =
  | { ok: true; value: ValidatedAppleTransaction }
  | { ok: false; error: AppleIapVerifyErrorCode };

export type AppleSubscriptionRecord = {
  original_transaction_id: string;
  clerk_user_id: string | null;
};

export type PersistAppleSubscriptionResult =
  | { ok: true; outcome: "inserted" | "updated" }
  | {
      ok: false;
      reason:
        | "owned_by_other"
        | "detached"
        | "read_failed"
        | "insert_failed"
        | "update_failed";
    };

export type AppleSubscriptionStore = {
  findByOriginalTransactionId: (
    originalTransactionId: string
  ) => Promise<AppleSubscriptionRecord | null | "read_failed">;
  insertOwned: (row: {
    originalTransactionId: string;
    latestTransactionId: string;
    environment: "sandbox" | "production";
    clerkUserId: string;
    appAccountToken: string;
    productId: string;
    status: AppleSubscriptionNormalizedStatus;
    expiresAtIso: string;
    refundedAt: string | null;
  }) => Promise<"inserted" | "unique_violation" | "failed">;
  updateOwned: (args: {
    originalTransactionId: string;
    clerkUserId: string;
    latestTransactionId: string;
    environment: "sandbox" | "production";
    productId: string;
    status: AppleSubscriptionNormalizedStatus;
    expiresAtIso: string;
    refundedAt: string | null;
  }) => Promise<"updated" | "not_found" | "failed">;
};

export function normalizeAppleAccountToken(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isAppleAccountTokenUuid(raw: string): boolean {
  return UUID_RE.test(raw.trim());
}

export function appleAccountTokensEqual(a: string, b: string): boolean {
  return normalizeAppleAccountToken(a) === normalizeAppleAccountToken(b);
}

function mapDbEnvironment(
  environment: Environment | string | undefined
): "sandbox" | "production" | null {
  if (
    environment === Environment.SANDBOX ||
    environment === "Sandbox" ||
    environment === "sandbox"
  ) {
    return "sandbox";
  }
  if (
    environment === Environment.PRODUCTION ||
    environment === "Production" ||
    environment === "production"
  ) {
    return "production";
  }
  return null;
}

export function validateDecodedAppleTransaction(
  decoded: JWSTransactionDecodedPayload,
  expected: { environment: Environment; now?: Date }
): AppleTransactionValidationResult {
  if (decoded.bundleId !== APPLE_IAP_BUNDLE_ID) {
    return { ok: false, error: "apple_invalid_bundle" };
  }

  const environment = mapDbEnvironment(decoded.environment);
  if (!environment) {
    return { ok: false, error: "apple_invalid_environment" };
  }
  const expectedDb = mapDbEnvironment(expected.environment);
  if (expectedDb !== environment) {
    return { ok: false, error: "apple_invalid_environment" };
  }

  const productId =
    typeof decoded.productId === "string" ? decoded.productId : "";
  if (!isAllowedAppleIapProductId(productId)) {
    return { ok: false, error: "apple_invalid_product" };
  }

  if (decoded.type !== Type.AUTO_RENEWABLE_SUBSCRIPTION) {
    return { ok: false, error: "apple_invalid_type" };
  }

  if (decoded.inAppOwnershipType === InAppOwnershipType.FAMILY_SHARED) {
    return { ok: false, error: "apple_family_shared_not_allowed" };
  }
  if (decoded.inAppOwnershipType !== InAppOwnershipType.PURCHASED) {
    return { ok: false, error: "apple_family_shared_not_allowed" };
  }

  const transactionId =
    typeof decoded.transactionId === "string" ? decoded.transactionId.trim() : "";
  if (!transactionId) {
    return { ok: false, error: "apple_missing_transaction_id" };
  }

  const originalTransactionId =
    typeof decoded.originalTransactionId === "string"
      ? decoded.originalTransactionId.trim()
      : "";
  if (!originalTransactionId) {
    return { ok: false, error: "apple_missing_original_transaction_id" };
  }

  const appAccountTokenRaw =
    typeof decoded.appAccountToken === "string" ? decoded.appAccountToken : "";
  if (!appAccountTokenRaw.trim()) {
    return { ok: false, error: "apple_missing_app_account_token" };
  }
  if (!isAppleAccountTokenUuid(appAccountTokenRaw)) {
    return { ok: false, error: "apple_malformed_app_account_token" };
  }

  if (
    typeof decoded.expiresDate !== "number" ||
    !Number.isFinite(decoded.expiresDate)
  ) {
    return { ok: false, error: "apple_missing_expires_date" };
  }

  const expiresAt = new Date(decoded.expiresDate);
  if (Number.isNaN(expiresAt.getTime())) {
    return { ok: false, error: "apple_missing_expires_date" };
  }

  const now = expected.now ?? new Date();
  const refunded =
    typeof decoded.revocationDate === "number" &&
    Number.isFinite(decoded.revocationDate);
  let status: AppleSubscriptionNormalizedStatus;
  if (refunded) {
    status = "refunded";
  } else if (expiresAt.getTime() > now.getTime()) {
    status = "active";
  } else {
    status = "expired";
  }

  return {
    ok: true,
    value: {
      transactionId,
      originalTransactionId,
      productId: productId.trim(),
      bundleId: APPLE_IAP_BUNDLE_ID,
      environment,
      appAccountToken: normalizeAppleAccountToken(appAccountTokenRaw),
      expiresAt,
      status,
      entitled: status === "active",
      refundedAt: refunded
        ? new Date(decoded.revocationDate as number).toISOString()
        : null,
    },
  };
}

export function createSupabaseAppleSubscriptionStore(): AppleSubscriptionStore {
  return {
    async findByOriginalTransactionId(originalTransactionId) {
      const { data, error } = await supabaseServer
        .from("apple_subscriptions")
        .select("original_transaction_id, clerk_user_id")
        .eq("original_transaction_id", originalTransactionId)
        .maybeSingle();
      if (error) return "read_failed";
      if (!data) return null;
      return {
        original_transaction_id: String(data.original_transaction_id),
        clerk_user_id:
          typeof data.clerk_user_id === "string" ? data.clerk_user_id : null,
      };
    },

    async insertOwned(row) {
      const { error } = await supabaseServer.from("apple_subscriptions").insert({
        original_transaction_id: row.originalTransactionId,
        latest_transaction_id: row.latestTransactionId,
        environment: row.environment,
        clerk_user_id: row.clerkUserId,
        app_account_token: row.appAccountToken,
        product_id: row.productId,
        status: row.status,
        expires_at: row.expiresAtIso,
        refunded_at: row.refundedAt,
      });
      if (!error) return "inserted";
      if (isPostgresUniqueViolation(error)) return "unique_violation";
      return "failed";
    },

    async updateOwned(args) {
      const { error, count } = await supabaseServer
        .from("apple_subscriptions")
        .update(
          {
            latest_transaction_id: args.latestTransactionId,
            environment: args.environment,
            product_id: args.productId,
            status: args.status,
            expires_at: args.expiresAtIso,
            refunded_at: args.refundedAt,
            updated_at: new Date().toISOString(),
          },
          { count: "exact" }
        )
        .eq("original_transaction_id", args.originalTransactionId)
        .eq("clerk_user_id", args.clerkUserId);
      if (error) return "failed";
      if ((count ?? 0) < 1) return "not_found";
      return "updated";
    },
  };
}

function ownershipFailure(
  row: AppleSubscriptionRecord,
  clerkUserId: string
): PersistAppleSubscriptionResult | null {
  if (row.clerk_user_id == null) {
    return { ok: false, reason: "detached" };
  }
  if (row.clerk_user_id !== clerkUserId) {
    return { ok: false, reason: "owned_by_other" };
  }
  return null;
}

/**
 * Persist a verified Apple subscription for this Clerk user.
 * Never upserts clerk_user_id. Unique races re-read the canonical row.
 */
export async function persistOwnedAppleSubscription(args: {
  clerkUserId: string;
  transaction: ValidatedAppleTransaction;
  store?: AppleSubscriptionStore;
}): Promise<PersistAppleSubscriptionResult> {
  const store = args.store ?? createSupabaseAppleSubscriptionStore();
  const { clerkUserId, transaction } = args;
  const patch = {
    originalTransactionId: transaction.originalTransactionId,
    latestTransactionId: transaction.transactionId,
    environment: transaction.environment,
    productId: transaction.productId,
    status: transaction.status,
    expiresAtIso: transaction.expiresAt.toISOString(),
    refundedAt: transaction.refundedAt,
  };

  const existing = await store.findByOriginalTransactionId(
    transaction.originalTransactionId
  );
  if (existing === "read_failed") return { ok: false, reason: "read_failed" };

  if (existing) {
    const blocked = ownershipFailure(existing, clerkUserId);
    if (blocked) return blocked;
    const updated = await store.updateOwned({
      ...patch,
      clerkUserId,
    });
    if (updated === "updated") return { ok: true, outcome: "updated" };
    if (updated === "not_found") {
      const again = await store.findByOriginalTransactionId(
        transaction.originalTransactionId
      );
      if (again === "read_failed") return { ok: false, reason: "read_failed" };
      if (!again) return { ok: false, reason: "update_failed" };
      const blockedAgain = ownershipFailure(again, clerkUserId);
      if (blockedAgain) return blockedAgain;
      return { ok: false, reason: "update_failed" };
    }
    return { ok: false, reason: "update_failed" };
  }

  const inserted = await store.insertOwned({
    ...patch,
    clerkUserId,
    appAccountToken: transaction.appAccountToken,
  });
  if (inserted === "inserted") return { ok: true, outcome: "inserted" };
  if (inserted === "failed") return { ok: false, reason: "insert_failed" };

  const raced = await store.findByOriginalTransactionId(
    transaction.originalTransactionId
  );
  if (raced === "read_failed") return { ok: false, reason: "read_failed" };
  if (!raced) return { ok: false, reason: "insert_failed" };
  const blocked = ownershipFailure(raced, clerkUserId);
  if (blocked) return blocked;
  const updated = await store.updateOwned({ ...patch, clerkUserId });
  if (updated === "updated") return { ok: true, outcome: "updated" };
  return { ok: false, reason: "update_failed" };
}
