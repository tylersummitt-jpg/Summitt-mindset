import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AutoRenewStatus,
  Environment,
  NotificationTypeV2,
  Status,
  Subtype,
  VerificationException,
  VerificationStatus,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";
import { AppleIapError } from "./errors";
import type {
  AppleLifecycleRow,
  AppleLifecycleUpdatePatch,
  AppleSubscriptionLifecycleStore,
} from "./subscriptions";
import type {
  AppleNotificationEventStore,
  AppleNotificationHandlerDeps,
} from "./notifications";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ supabaseServer: {} }));
vi.mock("@/lib/summitt-membership-entitlement.server", () => ({
  recomputeMembershipFromDurableSources: vi.fn(),
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

import {
  handleAppleServerNotification,
  resolveAppleNotificationLifecycle,
} from "./notifications";

const UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_UUID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PRODUCT = "com.summittmindset.ios.membership.monthly";
const OTHER_PRODUCT = "com.other.sku";
const SIGNED_MS = Date.parse("2026-06-15T00:00:00.000Z");
const OLDER_MS = Date.parse("2026-06-01T00:00:00.000Z");
const NEWER_MS = Date.parse("2026-07-01T00:00:00.000Z");
const FUTURE_MS = Date.parse("2099-12-01T00:00:00.000Z");
const PAST_MS = Date.parse("2020-01-01T00:00:00.000Z");
const JWS = "header.payload.signature";
const NESTED_TX = "nested.tx.jws";
const NESTED_RENEWAL = "nested.renewal.jws";

function tx(
  overrides: Partial<JWSTransactionDecodedPayload> = {}
): JWSTransactionDecodedPayload {
  return {
    originalTransactionId: "1001",
    transactionId: "2001",
    productId: PRODUCT,
    bundleId: "com.summittmindset.ios",
    environment: Environment.SANDBOX,
    expiresDate: FUTURE_MS,
    signedDate: SIGNED_MS,
    ...overrides,
  };
}

function renewal(
  overrides: Partial<JWSRenewalInfoDecodedPayload> = {}
): JWSRenewalInfoDecodedPayload {
  return {
    originalTransactionId: "1001",
    productId: PRODUCT,
    autoRenewProductId: PRODUCT,
    autoRenewStatus: AutoRenewStatus.ON,
    environment: Environment.SANDBOX,
    signedDate: SIGNED_MS,
    ...overrides,
  };
}

function notification(
  overrides: Partial<ResponseBodyV2DecodedPayload> = {}
): ResponseBodyV2DecodedPayload {
  return {
    notificationUUID: UUID,
    notificationType: NotificationTypeV2.DID_RENEW,
    signedDate: SIGNED_MS,
    data: {
      bundleId: "com.summittmindset.ios",
      environment: Environment.SANDBOX,
      status: Status.ACTIVE,
      signedTransactionInfo: NESTED_TX,
      signedRenewalInfo: NESTED_RENEWAL,
    },
    ...overrides,
  };
}

function boundRow(
  overrides: Partial<AppleLifecycleRow> = {}
): AppleLifecycleRow {
  return {
    original_transaction_id: "1001",
    clerk_user_id: "user_1",
    last_signed_at: null,
    expires_at: new Date(FUTURE_MS).toISOString(),
    latest_transaction_id: "2001",
    status: "active",
    auto_renew_enabled: true,
    ...overrides,
  };
}

function memoryEvents(seed?: {
  processed?: boolean;
  duplicate?: boolean;
}): AppleNotificationEventStore & { processedAt: string | null } {
  let inserted = Boolean(seed?.duplicate);
  let processedAt: string | null = seed?.processed
    ? "2026-06-01T00:00:00.000Z"
    : null;
  return {
    get processedAt() {
      return processedAt;
    },
    async insertClaim() {
      if (inserted) return "unique_violation";
      inserted = true;
      return "inserted";
    },
    async findClaim() {
      if (!inserted) return null;
      return { notification_uuid: UUID, processed_at: processedAt };
    },
    async markProcessed() {
      if (processedAt) return "not_found";
      processedAt = new Date().toISOString();
      return "updated";
    },
  };
}

function memorySubs(initial: AppleLifecycleRow | null): AppleSubscriptionLifecycleStore & {
  row: AppleLifecycleRow | null;
  updates: AppleLifecycleUpdatePatch[];
} {
  let row = initial;
  const updates: AppleLifecycleUpdatePatch[] = [];
  return {
    get row() {
      return row;
    },
    updates,
    async findLifecycleRow() {
      return row;
    },
    async updateLifecycleIfNotNewer(patch) {
      updates.push(patch);
      if (!row) return { outcome: "failed" };
      if (row.last_signed_at) {
        const stored = Date.parse(row.last_signed_at);
        if (Number.isFinite(stored) && stored > patch.incomingSignedAt.getTime()) {
          return { outcome: "stale", row };
        }
      }
      row = {
        ...row,
        status: patch.status,
        last_signed_at: patch.incomingSignedAt.toISOString(),
        expires_at: patch.expiresAtIso,
        latest_transaction_id: patch.latestTransactionId,
        auto_renew_enabled:
          patch.autoRenewEnabled ?? row.auto_renew_enabled,
        clerk_user_id: row.clerk_user_id,
      };
      return { outcome: "updated", row };
    },
  };
}

describe("resolveAppleNotificationLifecycle", () => {
  it("maps official types onto existing statuses", () => {
    expect(
      resolveAppleNotificationLifecycle({
        notificationType: NotificationTypeV2.TEST,
        subtype: null,
      })
    ).toEqual({ action: "ignore", reason: "test" });
    expect(
      resolveAppleNotificationLifecycle({
        notificationType: NotificationTypeV2.SUBSCRIBED,
        subtype: Subtype.INITIAL_BUY,
      }).action
    ).toBe("mutate");
    expect(
      resolveAppleNotificationLifecycle({
        notificationType: NotificationTypeV2.DID_RENEW,
        subtype: null,
      })
    ).toMatchObject({ action: "mutate", status: "active" });
    expect(
      resolveAppleNotificationLifecycle({
        notificationType: NotificationTypeV2.DID_FAIL_TO_RENEW,
        subtype: Subtype.GRACE_PERIOD,
      })
    ).toMatchObject({ status: "grace_period" });
    expect(
      resolveAppleNotificationLifecycle({
        notificationType: NotificationTypeV2.DID_FAIL_TO_RENEW,
        subtype: Subtype.BILLING_RETRY,
      })
    ).toMatchObject({ status: "billing_retry" });
    expect(
      resolveAppleNotificationLifecycle({
        notificationType: NotificationTypeV2.DID_FAIL_TO_RENEW,
        subtype: Subtype.BILLING_RECOVERY,
      })
    ).toMatchObject({ status: "active" });
    expect(
      resolveAppleNotificationLifecycle({
        notificationType: NotificationTypeV2.EXPIRED,
        subtype: Subtype.VOLUNTARY,
      })
    ).toMatchObject({ status: "expired" });
    expect(
      resolveAppleNotificationLifecycle({
        notificationType: NotificationTypeV2.GRACE_PERIOD_EXPIRED,
        subtype: null,
      })
    ).toMatchObject({ status: "expired" });
    expect(
      resolveAppleNotificationLifecycle({
        notificationType: NotificationTypeV2.REFUND,
        subtype: null,
      })
    ).toMatchObject({ status: "refunded" });
    expect(
      resolveAppleNotificationLifecycle({
        notificationType: NotificationTypeV2.REVOKE,
        subtype: null,
      })
    ).toMatchObject({ status: "revoked" });
  });

  it("REFUND_REVERSED uses verified current state, not a forced active", () => {
    expect(
      resolveAppleNotificationLifecycle({
        notificationType: NotificationTypeV2.REFUND_REVERSED,
        subtype: null,
        dataStatus: Status.EXPIRED,
      })
    ).toMatchObject({ status: "expired" });
    expect(
      resolveAppleNotificationLifecycle({
        notificationType: NotificationTypeV2.REFUND_REVERSED,
        subtype: null,
        transaction: tx({ expiresDate: FUTURE_MS, revocationDate: undefined }),
        now: new Date("2026-06-01T00:00:00.000Z"),
      })
    ).toMatchObject({ status: "active" });
  });
});

describe("handleAppleServerNotification", () => {
  const verifyNotification = vi.fn();
  const verifyTransaction = vi.fn();
  const verifyRenewal = vi.fn();
  const recompute = vi.fn();
  let events: ReturnType<typeof memoryEvents>;
  let subscriptions: ReturnType<typeof memorySubs>;

  function deps(): AppleNotificationHandlerDeps {
    return {
      verifyNotification,
      verifyTransaction,
      verifyRenewal,
      readConfig: () =>
        ({
          bundleId: "com.summittmindset.ios",
          environment: Environment.SANDBOX,
        }) as ReturnType<typeof import("./config").readAppleIapVerifierConfig>,
      events,
      subscriptions,
      recompute,
      now: new Date("2026-06-20T00:00:00.000Z"),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    events = memoryEvents();
    subscriptions = memorySubs(boundRow());
    verifyNotification.mockResolvedValue(notification());
    verifyTransaction.mockResolvedValue(tx());
    verifyRenewal.mockResolvedValue(renewal());
    recompute.mockResolvedValue({
      ok: true,
      summittSubscribed: true,
      summittPlan: "monthly",
      summittPaymentSource: "apple",
    });
  });

  it("invalid signedPayload => 400", async () => {
    verifyNotification.mockRejectedValue(
      new AppleIapError("apple_iap_verification_failed", "bad")
    );
    const result = await handleAppleServerNotification(JWS, deps());
    expect(result).toEqual({
      ok: false,
      http: 400,
      error: "apple_iap_verification_failed",
    });
    expect(events.processedAt).toBeNull();
  });

  it("retryable verification failure => 500", async () => {
    verifyNotification.mockRejectedValue(
      new AppleIapError("apple_iap_verification_failed", "ocsp", {
        cause: new VerificationException(
          VerificationStatus.RETRYABLE_VERIFICATION_FAILURE
        ),
      })
    );
    const result = await handleAppleServerNotification(JWS, deps());
    expect(result).toEqual({
      ok: false,
      http: 500,
      error: "Internal Server Error",
    });
  });

  it("notificationUUID required and must be a UUID", async () => {
    verifyNotification.mockResolvedValue(
      notification({ notificationUUID: undefined })
    );
    await expect(handleAppleServerNotification(JWS, deps())).resolves.toEqual({
      ok: false,
      http: 400,
      error: "apple_missing_notification_uuid",
    });
    verifyNotification.mockResolvedValue(
      notification({ notificationUUID: "not-a-uuid" })
    );
    await expect(handleAppleServerNotification(JWS, deps())).resolves.toEqual({
      ok: false,
      http: 400,
      error: "apple_malformed_notification_uuid",
    });
  });

  it("valid TEST => 200 no membership mutation", async () => {
    verifyNotification.mockResolvedValue(
      notification({
        notificationType: NotificationTypeV2.TEST,
        data: {
          bundleId: "com.summittmindset.ios",
          environment: Environment.SANDBOX,
        },
      })
    );
    const result = await handleAppleServerNotification(JWS, deps());
    expect(result).toEqual({ ok: true, outcome: "ignored" });
    expect(subscriptions.updates).toHaveLength(0);
    expect(recompute).not.toHaveBeenCalled();
    expect(events.processedAt).not.toBeNull();
  });

  it("duplicate processed => 200 no mutation", async () => {
    events = memoryEvents({ duplicate: true, processed: true });
    const result = await handleAppleServerNotification(JWS, deps());
    expect(result).toEqual({ ok: true, outcome: "duplicate_processed" });
    expect(subscriptions.updates).toHaveLength(0);
    expect(recompute).not.toHaveBeenCalled();
  });

  it("duplicate unprocessed re-enters", async () => {
    events = memoryEvents({ duplicate: true, processed: false });
    const result = await handleAppleServerNotification(JWS, deps());
    expect(result).toEqual({ ok: true, outcome: "processed" });
    expect(subscriptions.updates).toHaveLength(1);
    expect(recompute).toHaveBeenCalledWith("user_1");
    expect(events.processedAt).not.toBeNull();
  });

  it("unrelated product => 200 no membership mutation", async () => {
    verifyTransaction.mockResolvedValue(tx({ productId: OTHER_PRODUCT }));
    const result = await handleAppleServerNotification(JWS, deps());
    expect(result).toEqual({ ok: true, outcome: "ignored" });
    expect(subscriptions.updates).toHaveLength(0);
    expect(recompute).not.toHaveBeenCalled();
  });

  it("known bound SUBSCRIBED / DID_RENEW mutate and recompute", async () => {
    verifyNotification.mockResolvedValue(
      notification({ notificationType: NotificationTypeV2.SUBSCRIBED })
    );
    await expect(handleAppleServerNotification(JWS, deps())).resolves.toEqual({
      ok: true,
      outcome: "processed",
    });
    expect(subscriptions.updates[0]?.status).toBe("active");
    expect(recompute).toHaveBeenCalledWith("user_1");
  });

  it("DID_FAIL_TO_RENEW grace / retry / recovery", async () => {
    verifyNotification.mockResolvedValue(
      notification({
        notificationType: NotificationTypeV2.DID_FAIL_TO_RENEW,
        subtype: Subtype.GRACE_PERIOD,
        data: {
          ...notification().data,
          status: Status.BILLING_GRACE_PERIOD,
        },
      })
    );
    await handleAppleServerNotification(JWS, deps());
    expect(subscriptions.updates.at(-1)?.status).toBe("grace_period");

    verifyNotification.mockResolvedValue(
      notification({
        notificationUUID: OTHER_UUID,
        notificationType: NotificationTypeV2.DID_FAIL_TO_RENEW,
        subtype: Subtype.BILLING_RETRY,
        data: { ...notification().data, status: Status.BILLING_RETRY },
      })
    );
    events = memoryEvents();
    await handleAppleServerNotification(JWS, deps());
    expect(subscriptions.updates.at(-1)?.status).toBe("billing_retry");

    verifyNotification.mockResolvedValue(
      notification({
        notificationType: NotificationTypeV2.DID_FAIL_TO_RENEW,
        subtype: Subtype.BILLING_RECOVERY,
        data: { ...notification().data, status: Status.ACTIVE },
      })
    );
    events = memoryEvents();
    await handleAppleServerNotification(JWS, deps());
    expect(subscriptions.updates.at(-1)?.status).toBe("active");
  });

  it("EXPIRED and GRACE_PERIOD_EXPIRED", async () => {
    verifyNotification.mockResolvedValue(
      notification({
        notificationType: NotificationTypeV2.EXPIRED,
        data: { ...notification().data, status: Status.EXPIRED },
      })
    );
    verifyTransaction.mockResolvedValue(tx({ expiresDate: PAST_MS }));
    await handleAppleServerNotification(JWS, deps());
    expect(subscriptions.updates.at(-1)?.status).toBe("expired");

    events = memoryEvents();
    verifyNotification.mockResolvedValue(
      notification({
        notificationType: NotificationTypeV2.GRACE_PERIOD_EXPIRED,
        data: { ...notification().data, status: Status.EXPIRED },
      })
    );
    await handleAppleServerNotification(JWS, deps());
    expect(subscriptions.updates.at(-1)?.status).toBe("expired");
  });

  it("REFUND and REVOKE", async () => {
    verifyNotification.mockResolvedValue(
      notification({ notificationType: NotificationTypeV2.REFUND })
    );
    await handleAppleServerNotification(JWS, deps());
    expect(subscriptions.updates.at(-1)?.status).toBe("refunded");

    events = memoryEvents();
    verifyNotification.mockResolvedValue(
      notification({ notificationType: NotificationTypeV2.REVOKE })
    );
    await handleAppleServerNotification(JWS, deps());
    expect(subscriptions.updates.at(-1)?.status).toBe("revoked");
  });

  it("auto renew ON and OFF from verified renewalInfo", async () => {
    verifyRenewal.mockResolvedValue(
      renewal({ autoRenewStatus: AutoRenewStatus.OFF })
    );
    await handleAppleServerNotification(JWS, deps());
    expect(subscriptions.updates.at(-1)?.autoRenewEnabled).toBe(false);

    events = memoryEvents();
    verifyRenewal.mockResolvedValue(
      renewal({ autoRenewStatus: AutoRenewStatus.ON })
    );
    await handleAppleServerNotification(JWS, deps());
    expect(subscriptions.updates.at(-1)?.autoRenewEnabled).toBe(true);
  });

  it("unknown original transaction => no insert / no ownership assignment", async () => {
    subscriptions = memorySubs(null);
    const result = await handleAppleServerNotification(JWS, deps());
    expect(result).toEqual({ ok: true, outcome: "ignored" });
    expect(subscriptions.updates).toHaveLength(0);
    expect(recompute).not.toHaveBeenCalled();
  });

  it("detached subscription updates but does not recompute", async () => {
    subscriptions = memorySubs(boundRow({ clerk_user_id: null }));
    const result = await handleAppleServerNotification(JWS, deps());
    expect(result).toEqual({ ok: true, outcome: "processed" });
    expect(subscriptions.updates).toHaveLength(1);
    expect(recompute).not.toHaveBeenCalled();
    expect(subscriptions.row?.clerk_user_id).toBeNull();
  });

  it("nested transaction and renewal JWS are verified", async () => {
    await handleAppleServerNotification(JWS, deps());
    expect(verifyNotification).toHaveBeenCalledWith(JWS);
    expect(verifyTransaction).toHaveBeenCalledWith(NESTED_TX);
    expect(verifyRenewal).toHaveBeenCalledWith(NESTED_RENEWAL);
  });

  it("newer renewal applies; older out-of-order does not overwrite", async () => {
    subscriptions = memorySubs(
      boundRow({ last_signed_at: new Date(NEWER_MS).toISOString() })
    );
    verifyNotification.mockResolvedValue(
      notification({ signedDate: OLDER_MS })
    );
    const result = await handleAppleServerNotification(JWS, deps());
    expect(result).toEqual({ ok: true, outcome: "stale" });
    expect(recompute).not.toHaveBeenCalled();
    expect(events.processedAt).not.toBeNull();
  });

  it("older grace event does not overwrite newer expired state", async () => {
    subscriptions = memorySubs(
      boundRow({
        status: "expired",
        last_signed_at: new Date(NEWER_MS).toISOString(),
      })
    );
    verifyNotification.mockResolvedValue(
      notification({
        notificationType: NotificationTypeV2.DID_FAIL_TO_RENEW,
        subtype: Subtype.GRACE_PERIOD,
        signedDate: OLDER_MS,
        data: {
          ...notification().data,
          status: Status.BILLING_GRACE_PERIOD,
        },
      })
    );
    const result = await handleAppleServerNotification(JWS, deps());
    expect(result.ok).toBe(true);
    expect(subscriptions.row?.status).toBe("expired");
  });

  it("newer expiration applies", async () => {
    subscriptions = memorySubs(
      boundRow({ last_signed_at: new Date(OLDER_MS).toISOString() })
    );
    verifyNotification.mockResolvedValue(
      notification({
        notificationType: NotificationTypeV2.EXPIRED,
        signedDate: NEWER_MS,
        data: { ...notification().data, status: Status.EXPIRED },
      })
    );
    await handleAppleServerNotification(JWS, deps());
    expect(subscriptions.updates.at(-1)?.status).toBe("expired");
    expect(subscriptions.updates.at(-1)?.incomingSignedAt.getTime()).toBe(
      NEWER_MS
    );
  });

  it("retry after durable update + recompute failure leaves processed_at null then succeeds", async () => {
    recompute.mockResolvedValueOnce({
      ok: false,
      retryable: true,
      reason: "clerk_projection_failed",
      clerkUpdated: false,
    });
    const first = await handleAppleServerNotification(JWS, deps());
    expect(first).toEqual({
      ok: false,
      http: 500,
      error: "Internal Server Error",
    });
    expect(subscriptions.updates).toHaveLength(1);
    expect(events.processedAt).toBeNull();

    events = memoryEvents({ duplicate: true, processed: false });
    recompute.mockResolvedValueOnce({
      ok: true,
      summittSubscribed: true,
      summittPlan: "monthly",
      summittPaymentSource: "apple",
    });
    const second = await handleAppleServerNotification(JWS, deps());
    expect(second).toEqual({ ok: true, outcome: "processed" });
    expect(events.processedAt).not.toBeNull();
  });

  it("does not infer Clerk ownership from appAccountToken", async () => {
    subscriptions = memorySubs(null);
    verifyTransaction.mockResolvedValue(
      tx({ appAccountToken: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })
    );
    await handleAppleServerNotification(JWS, deps());
    expect(subscriptions.updates).toHaveLength(0);
    expect(recompute).not.toHaveBeenCalled();
  });

  it("does not return or require API issuer/key/private key", async () => {
    delete process.env.APPLE_IAP_ISSUER_ID;
    delete process.env.APPLE_IAP_KEY_ID;
    delete process.env.APPLE_IAP_PRIVATE_KEY;
    const result = await handleAppleServerNotification(JWS, deps());
    expect(result.ok).toBe(true);
  });
});
