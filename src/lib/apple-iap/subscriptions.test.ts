import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
      insert: async () => ({ error: null }),
      update: () => ({
        eq: () => ({ eq: async () => ({ error: null, count: 0 }) }),
      }),
    }),
  },
}));
import {
  Environment,
  InAppOwnershipType,
  Type,
  type JWSTransactionDecodedPayload,
} from "@apple/app-store-server-library";
import {
  appleAccountTokensEqual,
  persistOwnedAppleSubscription,
  validateDecodedAppleTransaction,
  type AppleSubscriptionStore,
} from "./subscriptions";

const TOKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FUTURE_MS = Date.parse("2026-12-01T00:00:00.000Z");
const PAST_MS = Date.parse("2020-01-01T00:00:00.000Z");
const NOW = new Date("2026-06-01T00:00:00.000Z");

function tx(
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

describe("validateDecodedAppleTransaction", () => {
  it("accepts a sandbox monthly PURCHASED subscription", () => {
    const result = validateDecodedAppleTransaction(tx(), {
      environment: Environment.SANDBOX,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entitled).toBe(true);
      expect(result.value.status).toBe("active");
      expect(result.value.environment).toBe("sandbox");
    }
  });

  it("rejects wrong product, bundle, environment, type, and FAMILY_SHARED", () => {
    const env = { environment: Environment.SANDBOX, now: NOW };
    expect(
      validateDecodedAppleTransaction(tx({ productId: "other.sku" }), env)
    ).toEqual({ ok: false, error: "apple_invalid_product" });
    expect(
      validateDecodedAppleTransaction(tx({ bundleId: "com.other" }), env)
    ).toEqual({ ok: false, error: "apple_invalid_bundle" });
    expect(
      validateDecodedAppleTransaction(
        tx({ environment: Environment.PRODUCTION }),
        env
      )
    ).toEqual({ ok: false, error: "apple_invalid_environment" });
    expect(
      validateDecodedAppleTransaction(
        tx({ type: Type.NON_CONSUMABLE }),
        env
      )
    ).toEqual({ ok: false, error: "apple_invalid_type" });
    expect(
      validateDecodedAppleTransaction(
        tx({ inAppOwnershipType: InAppOwnershipType.FAMILY_SHARED }),
        env
      )
    ).toEqual({ ok: false, error: "apple_family_shared_not_allowed" });
  });

  it("rejects missing or malformed required fields", () => {
    const env = { environment: Environment.SANDBOX, now: NOW };
    expect(
      validateDecodedAppleTransaction(tx({ transactionId: "" }), env)
    ).toEqual({ ok: false, error: "apple_missing_transaction_id" });
    expect(
      validateDecodedAppleTransaction(tx({ originalTransactionId: "  " }), env)
    ).toEqual({ ok: false, error: "apple_missing_original_transaction_id" });
    expect(
      validateDecodedAppleTransaction(tx({ appAccountToken: undefined }), env)
    ).toEqual({ ok: false, error: "apple_missing_app_account_token" });
    expect(
      validateDecodedAppleTransaction(tx({ appAccountToken: "not-a-uuid" }), env)
    ).toEqual({ ok: false, error: "apple_malformed_app_account_token" });
    expect(
      validateDecodedAppleTransaction(tx({ expiresDate: undefined }), env)
    ).toEqual({ ok: false, error: "apple_missing_expires_date" });
  });

  it("marks expired and refunded transactions as not entitled", () => {
    const env = { environment: Environment.SANDBOX, now: NOW };
    const expired = validateDecodedAppleTransaction(
      tx({ expiresDate: PAST_MS }),
      env
    );
    expect(expired.ok && expired.value.entitled).toBe(false);
    expect(expired.ok && expired.value.status).toBe("expired");
    const refunded = validateDecodedAppleTransaction(
      tx({ revocationDate: PAST_MS }),
      env
    );
    expect(refunded.ok && refunded.value.entitled).toBe(false);
    expect(refunded.ok && refunded.value.status).toBe("refunded");
  });
});

describe("appleAccountTokensEqual", () => {
  it("compares UUIDs case-insensitively", () => {
    expect(
      appleAccountTokensEqual(TOKEN.toUpperCase(), TOKEN.toLowerCase())
    ).toBe(true);
  });
});

function memorySubStore(seed?: AppleSubscriptionStore extends never ? never : {
  row?: { original_transaction_id: string; clerk_user_id: string | null } | null;
  insert?: AppleSubscriptionStore["insertOwned"];
  update?: AppleSubscriptionStore["updateOwned"];
}): AppleSubscriptionStore {
  let row = seed?.row ?? null;
  return {
    async findByOriginalTransactionId() {
      return row;
    },
    async insertOwned(args) {
      if (seed?.insert) return seed.insert(args);
      row = {
        original_transaction_id: args.originalTransactionId,
        clerk_user_id: args.clerkUserId,
      };
      return "inserted";
    },
    async updateOwned(args) {
      if (seed?.update) return seed.update(args);
      if (!row || row.clerk_user_id !== args.clerkUserId) return "not_found";
      return "updated";
    },
  };
}

describe("persistOwnedAppleSubscription", () => {
  const validated = {
    transactionId: "2001",
    originalTransactionId: "1001",
    productId: "com.summittmindset.ios.membership.monthly",
    bundleId: "com.summittmindset.ios",
    environment: "sandbox" as const,
    appAccountToken: TOKEN,
    expiresAt: new Date(FUTURE_MS),
    status: "active" as const,
    entitled: true,
    refundedAt: null,
  };

  it("inserts when no row exists", async () => {
    const insert = vi.fn(async () => "inserted" as const);
    const result = await persistOwnedAppleSubscription({
      clerkUserId: "user_1",
      transaction: validated,
      store: memorySubStore({ insert }),
    });
    expect(result).toEqual({ ok: true, outcome: "inserted" });
    expect(insert).toHaveBeenCalled();
  });

  it("conditionally updates the same user", async () => {
    const update = vi.fn(async () => "updated" as const);
    const result = await persistOwnedAppleSubscription({
      clerkUserId: "user_1",
      transaction: validated,
      store: memorySubStore({
        row: { original_transaction_id: "1001", clerk_user_id: "user_1" },
        update,
      }),
    });
    expect(result).toEqual({ ok: true, outcome: "updated" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        originalTransactionId: "1001",
        clerkUserId: "user_1",
      })
    );
  });

  it("rejects another live owner and detached rows", async () => {
    await expect(
      persistOwnedAppleSubscription({
        clerkUserId: "user_1",
        transaction: validated,
        store: memorySubStore({
          row: { original_transaction_id: "1001", clerk_user_id: "user_2" },
        }),
      })
    ).resolves.toEqual({ ok: false, reason: "owned_by_other" });
    await expect(
      persistOwnedAppleSubscription({
        clerkUserId: "user_1",
        transaction: validated,
        store: memorySubStore({
          row: { original_transaction_id: "1001", clerk_user_id: null },
        }),
      })
    ).resolves.toEqual({ ok: false, reason: "detached" });
  });

  it("23505 then same-user re-read continues with update", async () => {
    const insert = vi.fn(async () => "unique_violation" as const);
    const update = vi.fn(async () => "updated" as const);
    let finds = 0;
    const store: AppleSubscriptionStore = {
      async findByOriginalTransactionId() {
        finds += 1;
        if (finds === 1) return null;
        return { original_transaction_id: "1001", clerk_user_id: "user_1" };
      },
      insertOwned: insert,
      updateOwned: update,
    };
    const result = await persistOwnedAppleSubscription({
      clerkUserId: "user_1",
      transaction: validated,
      store,
    });
    expect(result).toEqual({ ok: true, outcome: "updated" });
  });

  it("23505 then other-user re-read is owned_by_other and does not update", async () => {
    let finds = 0;
    const update = vi.fn(async () => "updated" as const);
    const store: AppleSubscriptionStore = {
      async findByOriginalTransactionId() {
        finds += 1;
        if (finds === 1) return null;
        return { original_transaction_id: "1001", clerk_user_id: "user_2" };
      },
      async insertOwned() {
        return "unique_violation";
      },
      updateOwned: update,
    };
    const result = await persistOwnedAppleSubscription({
      clerkUserId: "user_1",
      transaction: validated,
      store,
    });
    expect(result).toEqual({ ok: false, reason: "owned_by_other" });
    expect(update).not.toHaveBeenCalled();
  });

  it("23505 then detached re-read is detached and does not update", async () => {
    let finds = 0;
    const update = vi.fn(async () => "updated" as const);
    const store: AppleSubscriptionStore = {
      async findByOriginalTransactionId() {
        finds += 1;
        if (finds === 1) return null;
        return { original_transaction_id: "1001", clerk_user_id: null };
      },
      async insertOwned() {
        return "unique_violation";
      },
      updateOwned: update,
    };
    const result = await persistOwnedAppleSubscription({
      clerkUserId: "user_1",
      transaction: validated,
      store,
    });
    expect(result).toEqual({ ok: false, reason: "detached" });
    expect(update).not.toHaveBeenCalled();
  });

  it("insert does not write auto_renew_enabled; update never writes clerk_user_id", async () => {
    const insert = vi.fn(async () => "inserted" as const);
    const update = vi.fn(async () => "updated" as const);
    await persistOwnedAppleSubscription({
      clerkUserId: "user_1",
      transaction: validated,
      store: memorySubStore({ insert, update }),
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: "user_1",
        originalTransactionId: "1001",
        latestTransactionId: "2001",
      })
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("insert failure returns insert_failed", async () => {
    const result = await persistOwnedAppleSubscription({
      clerkUserId: "user_1",
      transaction: validated,
      store: memorySubStore({ insert: async () => "failed" }),
    });
    expect(result).toEqual({ ok: false, reason: "insert_failed" });
  });

  it("update failure returns update_failed", async () => {
    const result = await persistOwnedAppleSubscription({
      clerkUserId: "user_1",
      transaction: validated,
      store: memorySubStore({
        row: { original_transaction_id: "1001", clerk_user_id: "user_1" },
        update: async () => "failed",
      }),
    });
    expect(result).toEqual({ ok: false, reason: "update_failed" });
  });
});
