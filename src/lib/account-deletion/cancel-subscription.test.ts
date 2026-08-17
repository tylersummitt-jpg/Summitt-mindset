import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));
vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: vi.fn(async () => ({})),
}));

const { detachAppleMock } = vi.hoisted(() => ({
  detachAppleMock: vi.fn(),
}));
vi.mock("./detach-apple-iap", () => ({
  detachAppleIapForDeletion: (...args: unknown[]) => detachAppleMock(...args),
}));

import {
  createAccountDeletionRequest,
  acquireAccountDeletionLease,
  releaseAccountDeletionLease,
  transitionAccountDeletionRequest,
  getAccountDeletionRequestById,
  useInMemoryAccountDeletionStoreForTests,
} from "./repository";
import {
  cancelStripeSubscriptionsForDeletion,
  hasCredibleSummittMembershipEvidence,
  isLikelySummittSubscriptionForDeletion,
  type DeletionStripeClient,
} from "./cancel-subscription";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260718140000_account_deletion_cas_stripe_result.sql"
);
const CANCEL_MEMBERSHIP = join(
  process.cwd(),
  "src/app/api/cancel-membership/route.ts"
);
const CANCEL_ORCHESTRATOR = join(
  process.cwd(),
  "src/lib/account-deletion/cancel-subscription.ts"
);

const CURRENT_PRICE = "price_current_monthly";
const LEGACY_PRICE = "price_legacy_annual";
const UNRELATED_PRICE = "price_other_product";
const RECOGNIZED = new Set([CURRENT_PRICE, LEGACY_PRICE]);

function fakeSub(input: {
  id: string;
  status?: Stripe.Subscription.Status;
  priceId?: string;
  priceIds?: string[];
  metadata?: Record<string, string>;
  customer?: string;
}): Stripe.Subscription {
  const priceIds = input.priceIds ?? [input.priceId ?? CURRENT_PRICE];
  return {
    id: input.id,
    object: "subscription",
    status: input.status ?? "active",
    customer: input.customer ?? "cus_test123",
    metadata: input.metadata ?? {},
    items: {
      object: "list",
      data: priceIds.map((pid, i) => ({
        id: `si_${input.id}_${i}`,
        object: "subscription_item",
        price: {
          id: pid,
          object: "price",
          recurring: { interval: "month", interval_count: 1 },
        },
      })),
    },
  } as unknown as Stripe.Subscription;
}

function fakeCustomer(input: {
  id: string;
  userId?: string | null;
  deleted?: boolean;
}): Stripe.Customer | Stripe.DeletedCustomer {
  if (input.deleted) {
    return { id: input.id, object: "customer", deleted: true };
  }
  return {
    id: input.id,
    object: "customer",
    metadata:
      input.userId === null || input.userId === undefined
        ? {}
        : { userId: input.userId },
  } as Stripe.Customer;
}

function createFakeStripe(initial: Stripe.Subscription[]): {
  client: DeletionStripeClient;
  cancelCalls: string[];
  listCalls: number;
  retrieveCustomerCalls: string[];
  retrieveSubCalls: string[];
  setSubs: (subs: Stripe.Subscription[]) => void;
  setCustomer: (
    customer: Stripe.Customer | Stripe.DeletedCustomer | null
  ) => void;
  setRetrieveSub: (
    fn: (id: string) => Promise<Stripe.Subscription>
  ) => void;
  failNextCancel: (err: unknown) => void;
  failList: (err: unknown) => void;
  failCustomerRetrieve: (err: unknown) => void;
} {
  let subs = [...initial];
  let customer: Stripe.Customer | Stripe.DeletedCustomer | null = fakeCustomer({
    id: "cus_test123",
    userId: null,
  });
  let retrieveSubImpl: ((id: string) => Promise<Stripe.Subscription>) | null =
    null;
  const state = {
    cancelCalls: [] as string[],
    listCalls: 0,
    retrieveCustomerCalls: [] as string[],
    retrieveSubCalls: [] as string[],
  };
  let nextCancelErr: unknown = null;
  let listErr: unknown = null;
  let customerErr: unknown = null;

  return {
    cancelCalls: state.cancelCalls,
    get listCalls() {
      return state.listCalls;
    },
    retrieveCustomerCalls: state.retrieveCustomerCalls,
    retrieveSubCalls: state.retrieveSubCalls,
    setSubs(next) {
      subs = [...next];
    },
    setCustomer(next) {
      customer = next;
    },
    setRetrieveSub(fn) {
      retrieveSubImpl = fn;
    },
    failNextCancel(err) {
      nextCancelErr = err;
    },
    failList(err) {
      listErr = err;
    },
    failCustomerRetrieve(err) {
      customerErr = err;
    },
    client: {
      customers: {
        retrieve: async (id: string) => {
          state.retrieveCustomerCalls.push(id);
          if (customerErr) {
            const e = customerErr;
            customerErr = null;
            throw e;
          }
          if (!customer || (customer as Stripe.Customer).id !== id) {
            // Default: empty-metadata customer for requested id
            return fakeCustomer({ id, userId: null });
          }
          return customer;
        },
      },
      subscriptions: {
        retrieve: async (id: string) => {
          state.retrieveSubCalls.push(id);
          if (retrieveSubImpl) return retrieveSubImpl(id);
          const found = subs.find((s) => s.id === id);
          if (!found) {
            throw Object.assign(new Error("No such subscription"), {
              code: "resource_missing",
              statusCode: 404,
            });
          }
          return found;
        },
        list: async () => {
          state.listCalls += 1;
          if (listErr) {
            const e = listErr;
            listErr = null;
            throw e;
          }
          return { data: [...subs] };
        },
        cancel: async (id: string) => {
          state.cancelCalls.push(id);
          if (nextCancelErr) {
            const e = nextCancelErr;
            nextCancelErr = null;
            throw e;
          }
          const idx = subs.findIndex((s) => s.id === id);
          if (idx < 0) {
            throw Object.assign(new Error("No such subscription"), {
              code: "resource_missing",
              statusCode: 404,
            });
          }
          const updated = {
            ...subs[idx],
            status: "canceled" as const,
          };
          subs[idx] = updated;
          return updated;
        },
      },
    },
  };
}

async function seedSmsSuppressed(clerkUserId: string, key: string) {
  const created = await createAccountDeletionRequest({
    clerkUserId,
    idempotencyKey: key,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("create failed");
  const id = created.value.row.id;
  const owner = "seed-worker";
  const lease = await acquireAccountDeletionLease({
    requestId: id,
    lockOwner: owner,
  });
  expect(lease.ok).toBe(true);
  if (!lease.ok) throw new Error("lease failed");

  const toSuppressing = await transitionAccountDeletionRequest({
    requestId: id,
    fromStatus: "requested",
    toStatus: "suppressing_sms",
    lockOwner: owner,
    smsResult: "pending",
  });
  expect(toSuppressing.ok).toBe(true);

  const toSuppressed = await transitionAccountDeletionRequest({
    requestId: id,
    fromStatus: "suppressing_sms",
    toStatus: "sms_suppressed",
    lockOwner: owner,
    smsResult: "ok",
  });
  expect(toSuppressed.ok).toBe(true);

  await releaseAccountDeletionLease({ requestId: id, lockOwner: owner });
  return id;
}

describe("APP-041B3a migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("extends CAS with stripe_result and service_role-only execute", () => {
    expect(sql).toContain("p_stripe_result TEXT DEFAULT NULL");
    expect(sql).toContain("p_set_stripe_result BOOLEAN DEFAULT false");
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.cas_account_deletion_request(UUID, TEXT, INTEGER, TEXT, INTEGER, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, TEXT, BOOLEAN, TEXT, BOOLEAN) TO service_role"
    );
  });
});

describe("isLikelySummittSubscriptionForDeletion (ownership-safe)", () => {
  it("matches exact userId even without recognized price", () => {
    expect(
      isLikelySummittSubscriptionForDeletion(
        fakeSub({
          id: "sub_1",
          priceId: UNRELATED_PRICE,
          metadata: { userId: "user_a" },
        }),
        "user_a",
        RECOGNIZED
      )
    ).toBe(true);
  });

  it("rejects foreign userId even with recognized price", () => {
    expect(
      isLikelySummittSubscriptionForDeletion(
        fakeSub({
          id: "sub_2",
          priceId: CURRENT_PRICE,
          metadata: { userId: "user_other" },
        }),
        "user_a",
        RECOGNIZED
      )
    ).toBe(false);
  });

  it("rejects plan-only metadata without userId or recognized price", () => {
    expect(
      isLikelySummittSubscriptionForDeletion(
        fakeSub({
          id: "sub_3",
          priceId: UNRELATED_PRICE,
          metadata: { plan: "monthly" },
        }),
        "user_a",
        RECOGNIZED
      )
    ).toBe(false);
  });

  it("detects recognized price on second subscription item", () => {
    expect(
      isLikelySummittSubscriptionForDeletion(
        fakeSub({
          id: "sub_4",
          priceIds: [UNRELATED_PRICE, LEGACY_PRICE],
        }),
        "user_a",
        RECOGNIZED
      )
    ).toBe(true);
  });
});

describe("hasCredibleSummittMembershipEvidence", () => {
  it("detects summittSubscribed and paused plan", () => {
    expect(
      hasCredibleSummittMembershipEvidence({ summittSubscribed: true })
    ).toBe(true);
    expect(hasCredibleSummittMembershipEvidence({ summittPlan: "paused" })).toBe(
      true
    );
    expect(hasCredibleSummittMembershipEvidence({})).toBe(false);
  });
});

describe("cancelStripeSubscriptionsForDeletion (mocks only — no real Stripe)", () => {
  beforeEach(() => {
    useInMemoryAccountDeletionStoreForTests();
    detachAppleMock.mockReset();
    detachAppleMock.mockResolvedValue({
      ok: true,
      binding: "already_unbound",
      subscriptions: "none",
    });
  });

  it("1. no handles + no membership evidence → skipped", async () => {
    const id = await seedSmsSuppressed("user_nocus", "k-nocus");
    const fake = createFakeStripe([]);
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_nocus",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({}),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stripeResult).toBe("skipped");
    expect(result.value.row.status).toBe("subscription_canceled");
    expect(fake.listCalls).toBe(0);
    expect(fake.cancelCalls).toEqual([]);
  });

  it("2. customer exists, no matching Summitt → skipped", async () => {
    const id = await seedSmsSuppressed("user_none", "k-none");
    const fake = createFakeStripe([
      fakeSub({ id: "sub_other", priceId: UNRELATED_PRICE }),
    ]);
    fake.setCustomer(fakeCustomer({ id: "cus_test123", userId: null }));
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_none",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stripeResult).toBe("skipped");
    expect(fake.cancelCalls).toEqual([]);
  });

  it("3. matching Summitt already canceled → already_done", async () => {
    const id = await seedSmsSuppressed("user_done", "k-done");
    const fake = createFakeStripe([
      fakeSub({
        id: "sub_term",
        status: "canceled",
        priceId: CURRENT_PRICE,
      }),
    ]);
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_done",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stripeResult).toBe("already_done");
    expect(fake.cancelCalls).toEqual([]);
  });

  it("4. one active current-price Summitt → ok", async () => {
    const id = await seedSmsSuppressed("user_one", "k-one");
    const fake = createFakeStripe([
      fakeSub({ id: "sub_live", priceId: CURRENT_PRICE }),
    ]);
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_one",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stripeResult).toBe("ok");
    expect(fake.cancelCalls).toEqual(["sub_live"]);
    expect(fake.retrieveCustomerCalls).toContain("cus_test123");
  });

  it("5. legacy price → ok", async () => {
    const id = await seedSmsSuppressed("user_leg", "k-leg");
    const fake = createFakeStripe([
      fakeSub({ id: "sub_leg", priceId: LEGACY_PRICE }),
    ]);
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_leg",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stripeResult).toBe("ok");
    expect(fake.cancelCalls).toEqual(["sub_leg"]);
  });

  it("6. multiple matching → all canceled", async () => {
    const id = await seedSmsSuppressed("user_multi", "k-multi");
    const fake = createFakeStripe([
      fakeSub({ id: "sub_a", priceId: CURRENT_PRICE }),
      fakeSub({ id: "sub_b", priceId: LEGACY_PRICE }),
    ]);
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_multi",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.canceledCount).toBe(2);
    expect(fake.cancelCalls.sort()).toEqual(["sub_a", "sub_b"]);
  });

  it("7. mixed related/unrelated → only Summitt canceled", async () => {
    const id = await seedSmsSuppressed("user_mix", "k-mix");
    const fake = createFakeStripe([
      fakeSub({ id: "sub_summitt", priceId: CURRENT_PRICE }),
      fakeSub({ id: "sub_other", priceId: UNRELATED_PRICE }),
    ]);
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_mix",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fake.cancelCalls).toEqual(["sub_summitt"]);
  });

  it("8. partial success then retry completes without re-canceling success", async () => {
    const id = await seedSmsSuppressed("user_part", "k-part");
    const fake = createFakeStripe([
      fakeSub({ id: "sub_ok", priceId: CURRENT_PRICE }),
      fakeSub({ id: "sub_fail", priceId: LEGACY_PRICE }),
    ]);
    let cancelN = 0;
    fake.client.subscriptions.cancel = async (subId: string) => {
      fake.cancelCalls.push(subId);
      cancelN += 1;
      if (cancelN === 2) {
        throw Object.assign(new Error("rate limited"), {
          statusCode: 429,
          code: "rate_limit",
        });
      }
      const list = await fake.client.subscriptions.list({
        customer: "cus_x",
        status: "all",
      });
      const found = list.data.find((s) => s.id === subId);
      if (!found) throw new Error("missing");
      const updated = { ...found, status: "canceled" as const };
      fake.setSubs(list.data.map((s) => (s.id === subId ? updated : s)));
      return updated;
    };

    const first = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_part",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(first.ok).toBe(false);
    const afterFail = await getAccountDeletionRequestById(id);
    expect(afterFail?.status).toBe("failed_retryable");
    expect(afterFail?.stripe_result).toBe("failed");
    expect(afterFail?.lock_owner).toBeNull();

    const cancelCalls2: string[] = [];
    fake.client.subscriptions.cancel = async (subId: string) => {
      cancelCalls2.push(subId);
      const list = await fake.client.subscriptions.list({
        customer: "cus_x",
        status: "all",
      });
      const found = list.data.find((s) => s.id === subId);
      if (!found) {
        throw Object.assign(new Error("gone"), { code: "resource_missing" });
      }
      const updated = { ...found, status: "canceled" as const };
      fake.setSubs(list.data.map((s) => (s.id === subId ? updated : s)));
      return updated;
    };

    const second = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_part",
      lockOwner: "w2",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.stripeResult).toBe("ok");
    expect(cancelCalls2).toEqual(["sub_fail"]);
  });

  it("9. transient discovery failure → failed_retryable", async () => {
    const id = await seedSmsSuppressed("user_disc", "k-disc");
    const fake = createFakeStripe([]);
    fake.failList(
      Object.assign(new Error("connection reset"), {
        type: "StripeConnectionError",
        statusCode: 500,
      })
    );
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_disc",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(false);
    const row = await getAccountDeletionRequestById(id);
    expect(row?.status).toBe("failed_retryable");
    expect(row?.stripe_result).toBe("failed");
    expect(row?.lock_owner).toBeNull();
  });

  it("10. transient cancel failure → failed_retryable", async () => {
    const id = await seedSmsSuppressed("user_tc", "k-tc");
    const fake = createFakeStripe([
      fakeSub({ id: "sub_x", priceId: CURRENT_PRICE }),
    ]);
    fake.failNextCancel(
      Object.assign(new Error("api error"), {
        type: "StripeAPIError",
        statusCode: 500,
      })
    );
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_tc",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(false);
    const row = await getAccountDeletionRequestById(id);
    expect(row?.status).toBe("failed_retryable");
    expect(row?.stripe_result).toBe("failed");
  });

  it("11. resource_missing on cancel is idempotent already_done", async () => {
    const id = await seedSmsSuppressed("user_idem", "k-idem");
    const fake = createFakeStripe([
      fakeSub({ id: "sub_gone", priceId: CURRENT_PRICE }),
    ]);
    fake.client.subscriptions.cancel = async (subId: string) => {
      fake.cancelCalls.push(subId);
      throw Object.assign(new Error("No such subscription: sub_gone"), {
        code: "resource_missing",
        statusCode: 404,
      });
    };
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_idem",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stripeResult).toBe("already_done");
  });

  it("12. stale expected version → CAS fails closed", async () => {
    const id = await seedSmsSuppressed("user_ver", "k-ver");
    const fake = createFakeStripe([
      fakeSub({ id: "sub_v", priceId: CURRENT_PRICE }),
    ]);
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_ver",
      lockOwner: "w1",
      expectedOrchestrationVersion: 999,
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unsupported_orchestration_version");
    expect(fake.cancelCalls).toEqual([]);
  });

  it("13. lease held → fails closed", async () => {
    const id = await seedSmsSuppressed("user_lease", "k-lease");
    await acquireAccountDeletionLease({
      requestId: id,
      lockOwner: "other-worker",
    });
    const fake = createFakeStripe([]);
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_lease",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("lease_held");
  });

  it("14. wrong starting state → no Stripe call", async () => {
    const created = await createAccountDeletionRequest({
      clerkUserId: "user_wrong",
      idempotencyKey: "k-wrong",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const fake = createFakeStripe([
      fakeSub({ id: "sub_w", priceId: CURRENT_PRICE }),
    ]);
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: created.value.row.id,
      clerkUserId: "user_wrong",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("illegal_transition");
    expect(fake.listCalls).toBe(0);
  });

  it("15. CAS failure before cancel → no Stripe cancel", async () => {
    const id = await seedSmsSuppressed("user_pre", "k-pre");
    const fake = createFakeStripe([
      fakeSub({ id: "sub_pre", priceId: CURRENT_PRICE }),
    ]);
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_pre",
      lockOwner: "w1",
      expectedOrchestrationVersion: 42,
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(false);
    expect(fake.cancelCalls).toEqual([]);
    expect(fake.listCalls).toBe(0);
  });

  it("16. CAS failure after cancel → retry rediscovers already_done", async () => {
    const id = await seedSmsSuppressed("user_post", "k-post");
    const fake = createFakeStripe([
      fakeSub({ id: "sub_post", priceId: CURRENT_PRICE }),
    ]);
    const now = new Date("2026-07-18T15:00:00.000Z");
    const leaseMs = 60_000;
    const realCancel = fake.client.subscriptions.cancel.bind(
      fake.client.subscriptions
    );
    fake.client.subscriptions.cancel = async (subId: string) => {
      const updated = await realCancel(subId);
      now.setTime(now.getTime() + leaseMs + 1);
      return updated;
    };

    const first = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_post",
      lockOwner: "w1",
      leaseMs,
      now,
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.code).toBe("cas_conflict");
    expect(fake.cancelCalls).toEqual(["sub_post"]);

    const second = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_post",
      lockOwner: "w2",
      leaseMs,
      now: new Date("2026-07-18T16:00:00.000Z"),
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.stripeResult).toBe("already_done");
    expect(fake.cancelCalls).toEqual(["sub_post"]);
  });

  it("17. sanitization: secrets not persisted", async () => {
    const id = await seedSmsSuppressed("user_san", "k-san");
    const fake = createFakeStripe([
      fakeSub({ id: "sub_san", priceId: CURRENT_PRICE }),
    ]);
    fake.failNextCancel(
      Object.assign(
        new Error(
          "boom sk_test_abc123secret Authorization: Bearer tok email@x.com"
        ),
        { statusCode: 500, type: "StripeAPIError" }
      )
    );
    await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_san",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    const row = await getAccountDeletionRequestById(id);
    expect(row?.last_error_detail).not.toContain("sk_test_abc123secret");
    expect(row?.last_error_detail).not.toContain("email@x.com");
  });

  it("18. churn route regression: B3a does not import cancel-membership", () => {
    const churn = readFileSync(CANCEL_MEMBERSHIP, "utf8");
    const orchestrator = readFileSync(CANCEL_ORCHESTRATOR, "utf8");
    expect(churn).toContain("stripe.subscriptions.cancel(subscriptionId)");
    expect(orchestrator).not.toMatch(
      /from\s+["']@\/app\/api\/cancel-membership/
    );
    expect(orchestrator).not.toContain("syncSmsAudience");
    expect(orchestrator).not.toContain("AppStoreServerAPIClient");
    expect(orchestrator).not.toContain("createAppStoreServerApiClient");
    expect(orchestrator).not.toContain("APPLE_IAP_ISSUER_ID");
    expect(orchestrator).toMatch(/plan-only metadata is NOT sufficient/i);
    expect(orchestrator).toContain("detachAppleIapForDeletion");
  });

  it("C1. wrong customer metadata userId → no list/cancel, failed", async () => {
    const id = await seedSmsSuppressed("user_own", "k-own");
    const fake = createFakeStripe([
      fakeSub({ id: "sub_victim", priceId: CURRENT_PRICE }),
    ]);
    fake.setCustomer(
      fakeCustomer({ id: "cus_test123", userId: "user_other" })
    );
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_own",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(false);
    expect(fake.listCalls).toBe(0);
    expect(fake.cancelCalls).toEqual([]);
    const row = await getAccountDeletionRequestById(id);
    expect(row?.status).toBe("failed_retryable");
    expect(row?.stripe_result).toBe("failed");
    expect(row?.last_error_code).toBe("stripe_customer_owner_mismatch");
    expect(row?.last_error_detail).not.toMatch(/cus_|user_other|sub_/);
  });

  it("C2. customer metadata has no userId → per-sub rules still apply", async () => {
    const id = await seedSmsSuppressed("user_nouser", "k-nouser");
    const fake = createFakeStripe([
      fakeSub({ id: "sub_price", priceId: CURRENT_PRICE }),
      fakeSub({
        id: "sub_plan_only",
        priceId: UNRELATED_PRICE,
        metadata: { plan: "monthly" },
      }),
    ]);
    fake.setCustomer(fakeCustomer({ id: "cus_test123", userId: null }));
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_nouser",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fake.cancelCalls).toEqual(["sub_price"]);
  });

  it("C3. foreign sub userId with recognized price → never canceled", async () => {
    const id = await seedSmsSuppressed("user_for", "k-for");
    const fake = createFakeStripe([
      fakeSub({
        id: "sub_foreign",
        priceId: CURRENT_PRICE,
        metadata: { userId: "user_other" },
      }),
    ]);
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_for",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fake.cancelCalls).toEqual([]);
    expect(result.value.stripeResult).toBe("skipped");
  });

  it("C4. matching userId + unrecognized price → canceled", async () => {
    const id = await seedSmsSuppressed("user_uid", "k-uid");
    const fake = createFakeStripe([
      fakeSub({
        id: "sub_uid",
        priceId: UNRELATED_PRICE,
        metadata: { userId: "user_uid" },
      }),
    ]);
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_uid",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fake.cancelCalls).toEqual(["sub_uid"]);
    expect(result.value.stripeResult).toBe("ok");
  });

  it("C5. plan-only metadata → not canceled", async () => {
    const id = await seedSmsSuppressed("user_plan", "k-plan");
    const fake = createFakeStripe([
      fakeSub({
        id: "sub_plan",
        priceId: UNRELATED_PRICE,
        metadata: { plan: "annual" },
      }),
    ]);
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_plan",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fake.cancelCalls).toEqual([]);
    expect(result.value.stripeResult).toBe("skipped");
  });

  it("C6. recognized price on second item → canceled", async () => {
    const id = await seedSmsSuppressed("user_item2", "k-item2");
    const fake = createFakeStripe([
      fakeSub({
        id: "sub_multi_item",
        priceIds: [UNRELATED_PRICE, CURRENT_PRICE],
      }),
    ]);
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_item2",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ stripeCustomerId: "cus_test123" }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fake.cancelCalls).toEqual(["sub_multi_item"]);
  });

  it("C7. missing customer + valid subscription id → derive customer and cancel", async () => {
    const id = await seedSmsSuppressed("user_rec", "k-rec");
    const sub = fakeSub({
      id: "sub_rec",
      priceId: CURRENT_PRICE,
      customer: "cus_derived",
      metadata: { userId: "user_rec" },
    });
    const fake = createFakeStripe([sub]);
    fake.setCustomer(fakeCustomer({ id: "cus_derived", userId: "user_rec" }));
    fake.setRetrieveSub(async (sid) => {
      if (sid !== "sub_rec") {
        throw Object.assign(new Error("missing"), { code: "resource_missing" });
      }
      return sub;
    });
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_rec",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({
        stripeSubscriptionId: "sub_rec",
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fake.retrieveSubCalls).toContain("sub_rec");
    expect(fake.retrieveCustomerCalls).toContain("cus_derived");
    expect(fake.cancelCalls).toEqual(["sub_rec"]);
    expect(result.value.stripeResult).toBe("ok");
  });

  it("C8. missing customer + subscription resource_missing → already_done", async () => {
    const id = await seedSmsSuppressed("user_gone", "k-gone");
    const fake = createFakeStripe([]);
    fake.setRetrieveSub(async () => {
      throw Object.assign(new Error("No such subscription"), {
        code: "resource_missing",
        statusCode: 404,
      });
    });
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_gone",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({
        stripeSubscriptionId: "sub_missing",
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Handle existed in Clerk but is gone in Stripe; no membership evidence → already_done.
    expect(result.value.stripeResult).toBe("already_done");
    expect(fake.listCalls).toBe(0);
    expect(fake.cancelCalls).toEqual([]);
  });

  it("C9. missing customer + subscription lookup transient → failed_retryable", async () => {
    const id = await seedSmsSuppressed("user_tlook", "k-tlook");
    const fake = createFakeStripe([]);
    fake.setRetrieveSub(async () => {
      throw Object.assign(new Error("timeout"), {
        type: "StripeConnectionError",
        statusCode: 500,
      });
    });
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_tlook",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({
        stripeSubscriptionId: "sub_tmp",
      }),
    });
    expect(result.ok).toBe(false);
    const row = await getAccountDeletionRequestById(id);
    expect(row?.status).toBe("failed_retryable");
    expect(row?.stripe_result).toBe("failed");
    expect(row?.last_error_code).toBe("stripe_subscription_lookup_failed");
  });

  it("C10. no handles + summittSubscribed → Stripe skipped, Apple detach, stage advances", async () => {
    const id = await seedSmsSuppressed("user_ev", "k-ev");
    const fake = createFakeStripe([]);
    detachAppleMock.mockResolvedValue({
      ok: true,
      binding: "tombstoned",
      subscriptions: "detached",
    });
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_ev",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ summittSubscribed: true }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stripeResult).toBe("skipped");
    expect(result.value.row.status).toBe("subscription_canceled");
    expect(fake.listCalls).toBe(0);
    expect(fake.cancelCalls).toEqual([]);
    expect(detachAppleMock).toHaveBeenCalledWith("user_ev");
  });

  it("C11. foreign subscription recovery handle → fail closed", async () => {
    const id = await seedSmsSuppressed("user_fsub", "k-fsub");
    const fake = createFakeStripe([]);
    fake.setRetrieveSub(async () =>
      fakeSub({
        id: "sub_f",
        priceId: CURRENT_PRICE,
        customer: "cus_x",
        metadata: { userId: "user_other" },
      })
    );
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_fsub",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({
        stripeSubscriptionId: "sub_f",
      }),
    });
    expect(result.ok).toBe(false);
    const row = await getAccountDeletionRequestById(id);
    expect(row?.last_error_code).toBe("stripe_subscription_owner_mismatch");
    expect(row?.last_error_detail).not.toMatch(/sub_f|user_other|cus_/);
    expect(fake.cancelCalls).toEqual([]);
  });

  it("Stripe + Apple: cancels Stripe immediately and detaches Apple without App Store cancel", async () => {
    const id = await seedSmsSuppressed("user_both", "k-both");
    const fake = createFakeStripe([
      fakeSub({ id: "sub_live", priceId: CURRENT_PRICE }),
    ]);
    detachAppleMock.mockResolvedValue({
      ok: true,
      binding: "tombstoned",
      subscriptions: "detached",
    });
    const result = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_both",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({
        stripeCustomerId: "cus_test123",
        summittSubscribed: true,
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fake.cancelCalls).toEqual(["sub_live"]);
    expect(result.value.stripeResult).toBe("ok");
    expect(result.value.row.status).toBe("subscription_canceled");
    expect(detachAppleMock).toHaveBeenCalledWith("user_both");
  });

  it("Apple detach failure after Stripe skip stays retryable then completes", async () => {
    const id = await seedSmsSuppressed("user_retry_apple", "k-retry-apple");
    const fake = createFakeStripe([]);
    detachAppleMock.mockResolvedValueOnce({
      ok: false,
      reason: "subscription_detach_failed",
      binding: "tombstoned",
      subscriptions: "failed",
    });
    const first = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_retry_apple",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ summittSubscribed: true }),
    });
    expect(first.ok).toBe(false);
    const failedRow = await getAccountDeletionRequestById(id);
    expect(failedRow?.status).toBe("failed_retryable");
    expect(failedRow?.last_error_code).toBe(
      "apple_iap_subscription_detach_failed"
    );
    expect(failedRow?.status).not.toBe("subscription_canceled");

    detachAppleMock.mockResolvedValueOnce({
      ok: true,
      binding: "already_unbound",
      subscriptions: "detached",
    });
    const second = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_retry_apple",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({ summittSubscribed: true }),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.row.status).toBe("subscription_canceled");
    expect(fake.cancelCalls).toEqual([]);
  });

  it("binding tombstone failure stays retryable then completes", async () => {
    const id = await seedSmsSuppressed("user_retry_bind", "k-retry-bind");
    const fake = createFakeStripe([]);
    detachAppleMock.mockResolvedValueOnce({
      ok: false,
      reason: "binding_tombstone_failed",
      binding: "failed",
      subscriptions: "detached",
    });
    const first = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_retry_bind",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({}),
    });
    expect(first.ok).toBe(false);
    const failedRow = await getAccountDeletionRequestById(id);
    expect(failedRow?.last_error_code).toBe(
      "apple_iap_binding_tombstone_failed"
    );

    detachAppleMock.mockResolvedValueOnce({
      ok: true,
      binding: "tombstoned",
      subscriptions: "none",
    });
    const second = await cancelStripeSubscriptionsForDeletion({
      requestId: id,
      clerkUserId: "user_retry_bind",
      lockOwner: "w1",
      stripe: fake.client,
      recognizedPriceIds: RECOGNIZED,
      getPublicMetadata: async () => ({}),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.row.status).toBe("subscription_canceled");
  });
});
