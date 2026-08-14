import "server-only";

import {
  AutoRenewStatus,
  NotificationTypeV2,
  Status,
  Subtype,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import { APPLE_IAP_BUNDLE_ID, readAppleIapVerifierConfig } from "./config";
import { isAppleIapError } from "./errors";
import { isPostgresUniqueViolation } from "./bindings";
import { isAllowedAppleIapProductId, APPLE_IAP_MONTHLY_PRODUCT_ID } from "./products";
import {
  appleSignedDateFromMs,
  createSupabaseAppleSubscriptionLifecycleStore,
  isAppleAccountTokenUuid,
  mapAppleEnvironmentToDb,
  preferNewerExpiryIso,
  preferNewerTransactionId,
  type AppleSubscriptionLifecycleStatus,
  type AppleSubscriptionLifecycleStore,
} from "./subscriptions";
import {
  isRetryableAppleVerificationFailure,
  verifySignedNotification,
  verifySignedRenewalInfo,
  verifySignedTransaction,
} from "./verifier";
import { supabaseServer } from "@/lib/supabase-server";
import {
  isRetryableMembershipSourceOrClerkFailure,
  isSmsReplicaFailureAfterClerkSuccess,
  membershipProjectionClerkSucceeded,
  recomputeMembershipFromDurableSources,
} from "@/lib/summitt-membership-entitlement.server";

export type AppleNotificationClaimRow = {
  notification_uuid: string;
  processed_at: string | null;
};

export type AppleNotificationEventStore = {
  insertClaim: (row: {
    notificationUuid: string;
    notificationType: string;
    subtype: string | null;
    originalTransactionId: string | null;
  }) => Promise<"inserted" | "unique_violation" | "failed">;
  findClaim: (
    notificationUuid: string
  ) => Promise<AppleNotificationClaimRow | null | "read_failed">;
  markProcessed: (
    notificationUuid: string
  ) => Promise<"updated" | "not_found" | "failed">;
};

export type HandleAppleNotificationResult =
  | {
      ok: true;
      outcome: "processed" | "duplicate_processed" | "stale" | "ignored";
    }
  | { ok: false; http: 400 | 500; error: string };

export type AppleNotificationHandlerDeps = {
  verifyNotification?: typeof verifySignedNotification;
  verifyTransaction?: typeof verifySignedTransaction;
  verifyRenewal?: typeof verifySignedRenewalInfo;
  readConfig?: typeof readAppleIapVerifierConfig;
  events?: AppleNotificationEventStore;
  subscriptions?: AppleSubscriptionLifecycleStore;
  recompute?: typeof recomputeMembershipFromDurableSources;
  now?: Date;
};

export function createSupabaseAppleNotificationEventStore(): AppleNotificationEventStore {
  return {
    async insertClaim(row) {
      const { error } = await supabaseServer.from("apple_notification_events").insert({
        notification_uuid: row.notificationUuid,
        notification_type: row.notificationType,
        subtype: row.subtype,
        original_transaction_id: row.originalTransactionId,
        processed_at: null,
      });
      if (!error) return "inserted";
      if (isPostgresUniqueViolation(error)) return "unique_violation";
      return "failed";
    },
    async findClaim(notificationUuid) {
      const { data, error } = await supabaseServer
        .from("apple_notification_events")
        .select("notification_uuid, processed_at")
        .eq("notification_uuid", notificationUuid)
        .maybeSingle();
      if (error) return "read_failed";
      if (!data) return null;
      return {
        notification_uuid: String(data.notification_uuid),
        processed_at:
          typeof data.processed_at === "string" ? data.processed_at : null,
      };
    },
    async markProcessed(notificationUuid) {
      const { error, count } = await supabaseServer
        .from("apple_notification_events")
        .update(
          { processed_at: new Date().toISOString() },
          { count: "exact" }
        )
        .eq("notification_uuid", notificationUuid)
        .is("processed_at", null);
      if (error) return "failed";
      if ((count ?? 0) < 1) return "not_found";
      return "updated";
    },
  };
}

function logWebhook(stage: string, extra: Record<string, unknown> = {}): void {
  console.error("[apple/webhook]", { stage, ...extra });
}

function asTypeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function mapDataStatus(
  status: Status | number | undefined
): AppleSubscriptionLifecycleStatus | null {
  if (status === Status.ACTIVE || status === 1) return "active";
  if (status === Status.EXPIRED || status === 2) return "expired";
  if (status === Status.BILLING_RETRY || status === 3) return "billing_retry";
  if (status === Status.BILLING_GRACE_PERIOD || status === 4) {
    return "grace_period";
  }
  if (status === Status.REVOKED || status === 5) return "revoked";
  return null;
}

export function mapAutoRenewEnabled(
  value: AutoRenewStatus | number | undefined
): boolean | null {
  if (value === AutoRenewStatus.ON || value === 1) return true;
  if (value === AutoRenewStatus.OFF || value === 0) return false;
  return null;
}

export type AppleNotificationLifecycleDecision =
  | { action: "ignore"; reason: string }
  | {
      action: "mutate";
      status: AppleSubscriptionLifecycleStatus | null;
    };

/**
 * Map official ASSN V2 type/subtype + data.status onto existing DB statuses.
 * TEST never mutates. data.status is the primary current-state signal when present.
 */
export function resolveAppleNotificationLifecycle(args: {
  notificationType: string;
  subtype: string | null;
  dataStatus?: Status | number;
  transaction?: JWSTransactionDecodedPayload;
  now?: Date;
}): AppleNotificationLifecycleDecision {
  const type = args.notificationType;
  const subtype = args.subtype ?? "";
  const fromStatus = mapDataStatus(args.dataStatus);

  if (type === NotificationTypeV2.TEST || type === "TEST") {
    return { action: "ignore", reason: "test" };
  }

  if (type === NotificationTypeV2.REFUND || type === "REFUND") {
    return { action: "mutate", status: "refunded" };
  }
  if (type === NotificationTypeV2.REVOKE || type === "REVOKE") {
    return { action: "mutate", status: "revoked" };
  }

  if (
    type === NotificationTypeV2.REFUND_REVERSED ||
    type === "REFUND_REVERSED"
  ) {
    if (fromStatus && fromStatus !== "revoked") {
      return { action: "mutate", status: fromStatus };
    }
    const tx = args.transaction;
    const now = args.now ?? new Date();
    const revoked =
      typeof tx?.revocationDate === "number" &&
      Number.isFinite(tx.revocationDate);
    const expires = appleSignedDateFromMs(tx?.expiresDate);
    if (!revoked && expires && expires.getTime() > now.getTime()) {
      return { action: "mutate", status: "active" };
    }
    if (expires && expires.getTime() <= now.getTime()) {
      return { action: "mutate", status: "expired" };
    }
    if (fromStatus) {
      return { action: "mutate", status: fromStatus };
    }
    return { action: "ignore", reason: "refund_reversed_state_unknown" };
  }

  if (
    type === NotificationTypeV2.DID_FAIL_TO_RENEW ||
    type === "DID_FAIL_TO_RENEW"
  ) {
    if (subtype === Subtype.GRACE_PERIOD || subtype === "GRACE_PERIOD") {
      return { action: "mutate", status: "grace_period" };
    }
    if (subtype === Subtype.BILLING_RETRY || subtype === "BILLING_RETRY") {
      return { action: "mutate", status: "billing_retry" };
    }
    if (
      subtype === Subtype.BILLING_RECOVERY ||
      subtype === "BILLING_RECOVERY"
    ) {
      return { action: "mutate", status: "active" };
    }
    if (fromStatus) {
      return { action: "mutate", status: fromStatus };
    }
    return { action: "mutate", status: "billing_retry" };
  }

  if (type === NotificationTypeV2.EXPIRED || type === "EXPIRED") {
    return { action: "mutate", status: fromStatus ?? "expired" };
  }
  if (
    type === NotificationTypeV2.GRACE_PERIOD_EXPIRED ||
    type === "GRACE_PERIOD_EXPIRED"
  ) {
    return { action: "mutate", status: fromStatus ?? "expired" };
  }
  if (type === NotificationTypeV2.DID_RENEW || type === "DID_RENEW") {
    return { action: "mutate", status: fromStatus ?? "active" };
  }
  if (type === NotificationTypeV2.SUBSCRIBED || type === "SUBSCRIBED") {
    return { action: "mutate", status: fromStatus ?? "active" };
  }

  if (
    type === NotificationTypeV2.DID_CHANGE_RENEWAL_STATUS ||
    type === "DID_CHANGE_RENEWAL_STATUS"
  ) {
    return { action: "mutate", status: fromStatus };
  }

  if (fromStatus) {
    return { action: "mutate", status: fromStatus };
  }

  return { action: "ignore", reason: "informational" };
}

async function markProcessedSafe(
  events: AppleNotificationEventStore,
  notificationUuid: string
): Promise<HandleAppleNotificationResult> {
  const marked = await events.markProcessed(notificationUuid);
  if (marked === "updated") {
    return { ok: true, outcome: "processed" };
  }
  if (marked === "not_found") {
    const existing = await events.findClaim(notificationUuid);
    if (existing && existing !== "read_failed" && existing.processed_at) {
      return { ok: true, outcome: "duplicate_processed" };
    }
  }
  logWebhook("mark_processed_failed");
  return { ok: false, http: 500, error: "Internal Server Error" };
}

/**
 * Verify ASSN V2 signedPayload, claim notificationUUID, update known
 * apple_subscriptions monotonically, recompute bound Clerk users.
 *
 * Clock: outer verified notification.signedDate.
 * Nested JWS payloads are verified separately and used for fields/sanity.
 */
export async function handleAppleServerNotification(
  signedPayload: string,
  deps: AppleNotificationHandlerDeps = {}
): Promise<HandleAppleNotificationResult> {
  const verifyNotification = deps.verifyNotification ?? verifySignedNotification;
  const verifyTransaction = deps.verifyTransaction ?? verifySignedTransaction;
  const verifyRenewal = deps.verifyRenewal ?? verifySignedRenewalInfo;
  const readConfig = deps.readConfig ?? readAppleIapVerifierConfig;
  const events = deps.events ?? createSupabaseAppleNotificationEventStore();
  const subscriptions =
    deps.subscriptions ?? createSupabaseAppleSubscriptionLifecycleStore();
  const recompute =
    deps.recompute ?? recomputeMembershipFromDurableSources;
  const now = deps.now ?? new Date();

  let decoded: ResponseBodyV2DecodedPayload;
  try {
    decoded = await verifyNotification(signedPayload);
  } catch (error) {
    if (isAppleIapError(error) && error.code === "apple_iap_not_configured") {
      logWebhook("not_configured");
      return { ok: false, http: 500, error: "Internal Server Error" };
    }
    if (isRetryableAppleVerificationFailure(error)) {
      logWebhook("verification_retryable");
      return { ok: false, http: 500, error: "Internal Server Error" };
    }
    logWebhook("verification_failed");
    return { ok: false, http: 400, error: "apple_iap_verification_failed" };
  }

  const notificationUuid = asTypeString(decoded.notificationUUID);
  if (!notificationUuid) {
    return { ok: false, http: 400, error: "apple_missing_notification_uuid" };
  }
  if (!isAppleAccountTokenUuid(notificationUuid)) {
    return { ok: false, http: 400, error: "apple_malformed_notification_uuid" };
  }

  const notificationType = asTypeString(decoded.notificationType);
  if (!notificationType) {
    return { ok: false, http: 400, error: "apple_missing_notification_type" };
  }
  const subtype = asTypeString(decoded.subtype) || null;

  let expectedEnv: "sandbox" | "production";
  try {
    const mapped = mapAppleEnvironmentToDb(readConfig().environment);
    if (!mapped) {
      throw new Error("apple_iap_not_configured");
    }
    expectedEnv = mapped;
  } catch {
    logWebhook("not_configured");
    return { ok: false, http: 500, error: "Internal Server Error" };
  }

  const data = decoded.data;
  if (data?.bundleId && data.bundleId !== APPLE_IAP_BUNDLE_ID) {
    logWebhook("ignored", { reason: "bundle", notificationType });
    return { ok: true, outcome: "ignored" };
  }
  if (data?.environment !== undefined) {
    const dataEnv = mapAppleEnvironmentToDb(data.environment);
    if (dataEnv !== expectedEnv) {
      return { ok: false, http: 400, error: "apple_invalid_environment" };
    }
  }

  let transaction: JWSTransactionDecodedPayload | undefined;
  const signedTransactionInfo = asTypeString(data?.signedTransactionInfo);
  if (signedTransactionInfo) {
    try {
      transaction = await verifyTransaction(signedTransactionInfo);
    } catch (error) {
      if (isRetryableAppleVerificationFailure(error)) {
        logWebhook("nested_transaction_retryable");
        return { ok: false, http: 500, error: "Internal Server Error" };
      }
      logWebhook("nested_transaction_failed");
      return { ok: false, http: 400, error: "apple_iap_verification_failed" };
    }
    const txEnv = mapAppleEnvironmentToDb(transaction.environment);
    if (txEnv && txEnv !== expectedEnv) {
      return { ok: false, http: 400, error: "apple_invalid_environment" };
    }
  }

  let renewal: JWSRenewalInfoDecodedPayload | undefined;
  const signedRenewalInfo = asTypeString(data?.signedRenewalInfo);
  if (signedRenewalInfo) {
    try {
      renewal = await verifyRenewal(signedRenewalInfo);
    } catch (error) {
      if (isRetryableAppleVerificationFailure(error)) {
        logWebhook("nested_renewal_retryable");
        return { ok: false, http: 500, error: "Internal Server Error" };
      }
      logWebhook("nested_renewal_failed");
      return { ok: false, http: 400, error: "apple_iap_verification_failed" };
    }
    const renewalEnv = mapAppleEnvironmentToDb(renewal.environment);
    if (renewalEnv && renewalEnv !== expectedEnv) {
      return { ok: false, http: 400, error: "apple_invalid_environment" };
    }
  }

  const originalTransactionId =
    asTypeString(transaction?.originalTransactionId) ||
    asTypeString(renewal?.originalTransactionId) ||
    null;

  const productId =
    asTypeString(transaction?.productId) ||
    asTypeString(renewal?.productId) ||
    asTypeString(renewal?.autoRenewProductId);

  const claimed = await events.insertClaim({
    notificationUuid,
    notificationType,
    subtype,
    originalTransactionId,
  });
  if (claimed === "failed") {
    logWebhook("claim_failed");
    return { ok: false, http: 500, error: "Internal Server Error" };
  }
  if (claimed === "unique_violation") {
    const existingClaim = await events.findClaim(notificationUuid);
    if (existingClaim === "read_failed" || !existingClaim) {
      logWebhook("claim_reread_failed");
      return { ok: false, http: 500, error: "Internal Server Error" };
    }
    if (existingClaim.processed_at) {
      return { ok: true, outcome: "duplicate_processed" };
    }
  }

  const finishIgnored = async (reason: string, extra: Record<string, unknown> = {}) => {
    logWebhook("ignored", {
      reason,
      notificationType,
      subtype,
      ...extra,
    });
    const marked = await markProcessedSafe(events, notificationUuid);
    if (!marked.ok) return marked;
    return { ok: true as const, outcome: "ignored" as const };
  };

  if (productId && !isAllowedAppleIapProductId(productId)) {
    return finishIgnored("unrelated_product", { productId });
  }

  const decision = resolveAppleNotificationLifecycle({
    notificationType,
    subtype,
    dataStatus: data?.status,
    transaction,
    now,
  });
  const autoRenewEnabled = mapAutoRenewEnabled(renewal?.autoRenewStatus);
  const wouldMutate =
    decision.action === "mutate" &&
    (decision.status !== null || autoRenewEnabled !== null);

  if (!wouldMutate) {
    return finishIgnored(
      decision.action === "ignore" ? decision.reason : "no_mutation"
    );
  }

  const signedAt = appleSignedDateFromMs(decoded.signedDate);
  if (!signedAt) {
    logWebhook("missing_signed_date", { notificationType });
    return { ok: false, http: 400, error: "apple_missing_signed_date" };
  }

  if (!originalTransactionId) {
    return finishIgnored("missing_original_transaction_id");
  }

  const existing = await subscriptions.findLifecycleRow(originalTransactionId);
  if (existing === "read_failed") {
    logWebhook("subscription_read_failed");
    return { ok: false, http: 500, error: "Internal Server Error" };
  }
  if (!existing) {
    return finishIgnored("unknown_transaction");
  }

  const incomingExpires = appleSignedDateFromMs(transaction?.expiresDate);
  const expiresAtIso = preferNewerExpiryIso(existing.expires_at, incomingExpires);
  const latestTransactionId = preferNewerTransactionId(
    existing.latest_transaction_id,
    transaction?.transactionId
  );
  const environment =
    mapAppleEnvironmentToDb(transaction?.environment) ??
    mapAppleEnvironmentToDb(data?.environment) ??
    expectedEnv;

  const status =
    decision.action === "mutate" && decision.status
      ? decision.status
      : (existing.status as AppleSubscriptionLifecycleStatus);

  const productForUpdate = isAllowedAppleIapProductId(productId)
    ? productId
    : APPLE_IAP_MONTHLY_PRODUCT_ID;

  const refundedAt = status === "refunded" ? signedAt.toISOString() : null;
  const revokedAt = status === "revoked" ? signedAt.toISOString() : null;

  const updated = await subscriptions.updateLifecycleIfNotNewer({
    originalTransactionId,
    incomingSignedAt: signedAt,
    status,
    latestTransactionId,
    environment,
    productId: productForUpdate,
    expiresAtIso,
    autoRenewEnabled,
    refundedAt,
    revokedAt,
  });

  if (updated.outcome === "failed") {
    logWebhook("lifecycle_update_failed");
    return { ok: false, http: 500, error: "Internal Server Error" };
  }
  if (updated.outcome === "stale") {
    const marked = await markProcessedSafe(events, notificationUuid);
    if (!marked.ok) return marked;
    return { ok: true, outcome: "stale" };
  }

  const clerkUserId = updated.row.clerk_user_id;
  if (clerkUserId) {
    const projection = await recompute(clerkUserId);
    if (isRetryableMembershipSourceOrClerkFailure(projection)) {
      logWebhook("recompute_retryable", { reason: projection.reason });
      return { ok: false, http: 500, error: "Internal Server Error" };
    }
    if (!membershipProjectionClerkSucceeded(projection)) {
      logWebhook("recompute_failed");
      return { ok: false, http: 500, error: "Internal Server Error" };
    }
    if (isSmsReplicaFailureAfterClerkSuccess(projection)) {
      logWebhook("sms_replica_failed");
    }
  }

  const marked = await markProcessedSafe(events, notificationUuid);
  if (!marked.ok) return marked;
  return { ok: true, outcome: "processed" };
}
