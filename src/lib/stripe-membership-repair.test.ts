import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: () => ({}) },
}));

vi.mock("@/lib/sms-audience-sync", () => ({
  syncSmsAudience: vi.fn(async () => undefined),
}));

import {
  recomputeSummittMembershipEntitlement,
  resolveStripeMembershipGrantFromSubscription,
  type MembershipGrant,
} from "@/lib/summitt-membership-entitlement";
import {
  attemptStripeMembershipRepair,
  type RepairCheckoutSession,
  type RepairSubscription,
  type StripeMembershipRepairDeps,
} from "@/lib/stripe-membership-repair";

const USER_B = "user_b";
const USER_A = "user_a";
const SUMMITT_PRICE = "price_summitt_monthly";

function subscription(
  overrides: Partial<RepairSubscription> = {}
): RepairSubscription {
  return {
    id: "sub_summitt",
    status: "active",
    pause_collection: null,
    customer: "cus_b",
    metadata: { userId: USER_B, plan: "monthly" },
    items: {
      data: [
        {
          price: {
            id: SUMMITT_PRICE,
            recurring: { interval: "month" },
          },
        },
      ],
    },
    ...overrides,
  };
}

function deps(options: {
  metadata?: Record<string, unknown>;
  subscriptions?: RepairSubscription[];
  sessions?: RepairCheckoutSession[];
  customers?: string[];
  retrieveError?: unknown;
  listError?: unknown;
  searchError?: unknown;
  sessionError?: unknown;
  deletion?:
    | { ok: true }
    | { ok: false; code: "account_deletion_in_progress" | "lookup_failed" };
  secondDeletion?:
    | { ok: true }
    | { ok: false; code: "account_deletion_in_progress" | "lookup_failed" };
  appleGrant?: MembershipGrant | null;
  recomputeResult?: Awaited<
    ReturnType<StripeMembershipRepairDeps["recompute"]>
  >;
}) {
  const linkage: Array<Record<string, unknown>> = [];
  const projection: Array<Record<string, unknown>> = [];
  const retrieve = vi.fn(async () => {
    if (options.retrieveError) throw options.retrieveError;
    const id = options.metadata?.stripeSubscriptionId;
    const found = options.subscriptions?.find((sub) => sub.id === id);
    if (!found) {
      const error = new Error("missing");
      (error as Error & { code?: string }).code = "resource_missing";
      throw error;
    }
    return found;
  });
  const listCustomerSubscriptions = vi.fn(async () => {
    if (options.listError) throw options.listError;
    return options.subscriptions ?? [];
  });
  const searchCustomerIdsByMetadataUserId = vi.fn(async () => {
    if (options.searchError) throw options.searchError;
    return options.customers ?? [];
  });
  const listCheckoutSessionsForSubscription = vi.fn(async () => {
    if (options.sessionError) throw options.sessionError;
    return options.sessions ?? [];
  });
  let deletionCalls = 0;
  const deletionAllowed = vi.fn(async () => {
    deletionCalls += 1;
    if (deletionCalls > 1 && options.secondDeletion) return options.secondDeletion;
    return options.deletion ?? { ok: true as const };
  });
  const recompute = vi.fn(async (userId: string, sub: RepairSubscription) => {
    if (options.recomputeResult) return options.recomputeResult;
    if (options.appleGrant !== undefined) {
      return recomputeSummittMembershipEntitlement(userId, {
        resolveStripeMembershipGrant: async () =>
          resolveStripeMembershipGrantFromSubscription(sub),
        resolveAppleMembershipGrant: async () => options.appleGrant ?? null,
        updateClerkPublicMetadata: async (_id, fields) => {
          projection.push(fields);
        },
        syncSmsAudience: async () => undefined,
      });
    }
    return {
      ok: true as const,
      summittSubscribed: true,
      summittPlan: "monthly" as const,
      summittPaymentSource: "stripe" as const,
    };
  });

  const repairDeps: StripeMembershipRepairDeps = {
    readClerkPublicMetadata: async () => options.metadata ?? {},
    updateClerkPublicMetadata: async (_userId, fields) => {
      linkage.push(fields);
    },
    recompute,
    deletionAllowed,
    stripe: {
      retrieveSubscription: retrieve,
      listCustomerSubscriptions,
      searchCustomerIdsByMetadataUserId,
      listCheckoutSessionsForSubscription,
    },
  };

  return {
    repairDeps,
    linkage,
    projection,
    retrieve,
    listCustomerSubscriptions,
    searchCustomerIdsByMetadataUserId,
    listCheckoutSessionsForSubscription,
    recompute,
  };
}

function noFalseWrite(linkage: Array<Record<string, unknown>>) {
  expect(linkage.some((fields) => fields.summittSubscribed === false)).toBe(
    false
  );
  expect(linkage.some((fields) => fields.summittPlan === null)).toBe(false);
  expect(
    linkage.some((fields) => Object.prototype.hasOwnProperty.call(fields, "stripeSubscriptionId") && fields.stripeSubscriptionId == null)
  ).toBe(false);
}

describe("attemptStripeMembershipRepair", () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_ID_MONTHLY = SUMMITT_PRICE;
    process.env.STRIPE_PRICE_ID_ANNUAL = "price_summitt_annual";
    delete process.env.STRIPE_LEGACY_PRICE_IDS;
  });

  it("repairs when subscription metadata userId matches an active Summitt subscription", async () => {
    const sub = subscription();
    const harness = deps({
      metadata: { stripeSubscriptionId: sub.id },
      subscriptions: [sub],
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result).toEqual({ repaired: true, reason: "repaired" });
    expect(harness.linkage).toEqual([
      { stripeSubscriptionId: sub.id, stripeCustomerId: "cus_b" },
    ]);
    expect(harness.recompute).toHaveBeenCalledWith(USER_B, sub);
    expect(harness.listCheckoutSessionsForSubscription).not.toHaveBeenCalled();
    expect(harness.searchCustomerIdsByMetadataUserId).not.toHaveBeenCalled();
  });

  it("does not grant the same email when the subscription owner is someone else", async () => {
    const sub = subscription({
      metadata: { userId: USER_A, plan: "monthly" },
    });
    const harness = deps({
      metadata: { stripeCustomerId: "cus_shared" },
      subscriptions: [sub],
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result).toEqual({ repaired: false, reason: "not_proven" });
    expect(harness.linkage).toEqual([]);
    expect(harness.recompute).not.toHaveBeenCalled();
    expect(harness.searchCustomerIdsByMetadataUserId).not.toHaveBeenCalled();
    noFalseWrite(harness.linkage);
  });

  it("does not grant auth B when subscription userId is A and customer userId is B", async () => {
    const sub = subscription({
      metadata: { userId: USER_A, plan: "monthly" },
      customer: "cus_b",
    });
    const harness = deps({
      metadata: { stripeSubscriptionId: sub.id, stripeCustomerId: "cus_b" },
      subscriptions: [sub],
      sessions: [
        {
          id: "cs_b",
          client_reference_id: USER_B,
          subscription: sub.id,
        },
      ],
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result.repaired).toBe(false);
    expect(harness.linkage).toEqual([]);
    expect(harness.listCheckoutSessionsForSubscription).not.toHaveBeenCalled();
    noFalseWrite(harness.linkage);
  });

  it("does not grant from customer metadata alone", async () => {
    const sub = subscription({
      metadata: { plan: "monthly" },
    });
    const harness = deps({
      customers: ["cus_b"],
      subscriptions: [sub],
      sessions: [],
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result).toEqual({ repaired: false, reason: "not_proven" });
    expect(harness.searchCustomerIdsByMetadataUserId).toHaveBeenCalledWith(USER_B);
    expect(harness.linkage).toEqual([]);
    expect(harness.recompute).not.toHaveBeenCalled();
    noFalseWrite(harness.linkage);
  });

  it("does not grant a Summitt product that only customer metadata would claim", async () => {
    const sub = subscription({
      metadata: {},
      items: {
        data: [{ price: { id: SUMMITT_PRICE, recurring: { interval: "month" } } }],
      },
    });
    const harness = deps({
      customers: ["cus_b"],
      subscriptions: [sub],
      sessions: [
        {
          id: "cs_other",
          client_reference_id: USER_A,
          metadata: { userId: USER_A },
          subscription: sub.id,
        },
      ],
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result.repaired).toBe(false);
    expect(harness.linkage).toEqual([]);
    noFalseWrite(harness.linkage);
  });

  it("does not grant an owned active subscription that is not a Summitt product", async () => {
    const sub = subscription({
      metadata: { userId: USER_B },
      items: {
        data: [{ price: { id: "price_other_product", recurring: { interval: "month" } } }],
      },
    });
    const harness = deps({
      metadata: { stripeSubscriptionId: sub.id },
      subscriptions: [sub],
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result.repaired).toBe(false);
    expect(harness.linkage).toEqual([]);
    expect(harness.recompute).not.toHaveBeenCalled();
    noFalseWrite(harness.linkage);
  });

  it("repairs when the Checkout Session for that subscription proves the user", async () => {
    const sub = subscription({ metadata: { plan: "annual" } });
    const harness = deps({
      customers: ["cus_b"],
      subscriptions: [sub],
      sessions: [
        {
          id: "cs_exact",
          client_reference_id: USER_B,
          subscription: sub.id,
        },
      ],
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result.repaired).toBe(true);
    expect(harness.linkage[0]).toMatchObject({
      stripeSubscriptionId: sub.id,
      stripeCustomerId: "cus_b",
    });
    expect(harness.listCheckoutSessionsForSubscription).toHaveBeenCalledWith(sub.id);
  });

  it("accepts session metadata userId when client_reference_id is absent", async () => {
    const sub = subscription({ metadata: { plan: "monthly" } });
    const harness = deps({
      customers: ["cus_b"],
      subscriptions: [sub],
      sessions: [
        {
          id: "cs_meta",
          metadata: { userId: USER_B },
          subscription: sub.id,
        },
      ],
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result.repaired).toBe(true);
  });

  it("does not grant an unrelated Checkout Session on the same customer", async () => {
    const sub = subscription({ metadata: { plan: "monthly" } });
    const harness = deps({
      customers: ["cus_b"],
      subscriptions: [sub],
      sessions: [
        {
          id: "cs_unrelated",
          client_reference_id: USER_B,
          metadata: { userId: USER_B },
          subscription: "sub_other",
        },
      ],
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result.repaired).toBe(false);
    expect(harness.linkage).toEqual([]);
    noFalseWrite(harness.linkage);
  });

  it("does not write when Stripe retrieve throws", async () => {
    const harness = deps({
      metadata: { stripeSubscriptionId: "sub_summitt" },
      retrieveError: new Error("stripe down"),
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result).toEqual({ repaired: false, reason: "lookup_failed" });
    expect(harness.searchCustomerIdsByMetadataUserId).not.toHaveBeenCalled();
    expect(harness.linkage).toEqual([]);
    noFalseWrite(harness.linkage);
  });

  it("does not write when customer search throws", async () => {
    const harness = deps({
      searchError: new Error("search unavailable"),
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result).toEqual({ repaired: false, reason: "lookup_failed" });
    expect(harness.linkage).toEqual([]);
    noFalseWrite(harness.linkage);
  });

  it("does not write when Checkout Session lookup throws", async () => {
    const sub = subscription({ metadata: { plan: "monthly" } });
    const harness = deps({
      customers: ["cus_b"],
      subscriptions: [sub],
      sessionError: new Error("session list failed"),
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result).toEqual({ repaired: false, reason: "lookup_failed" });
    expect(harness.linkage).toEqual([]);
    noFalseWrite(harness.linkage);
  });

  it("does not write when customer search returns nothing", async () => {
    const harness = deps({ customers: [] });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result).toEqual({ repaired: false, reason: "not_proven" });
    expect(harness.linkage).toEqual([]);
    expect(harness.recompute).not.toHaveBeenCalled();
    noFalseWrite(harness.linkage);
  });

  it("repairs an owned Summitt trialing subscription", async () => {
    const sub = subscription({ status: "trialing" });
    const harness = deps({
      metadata: { stripeSubscriptionId: sub.id },
      subscriptions: [sub],
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result.repaired).toBe(true);
    expect(harness.recompute).toHaveBeenCalledWith(USER_B, sub);
  });

  it("does not grant an owned Summitt past_due subscription", async () => {
    const sub = subscription({ status: "past_due" });
    const harness = deps({
      metadata: { stripeSubscriptionId: sub.id },
      subscriptions: [sub],
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result.repaired).toBe(false);
    expect(harness.linkage).toEqual([]);
    expect(harness.recompute).not.toHaveBeenCalled();
    noFalseWrite(harness.linkage);
  });

  it("does not grant an owned Summitt paused subscription", async () => {
    const sub = subscription({
      pause_collection: { behavior: "mark_uncollectible" },
    });
    const harness = deps({
      metadata: { stripeSubscriptionId: sub.id },
      subscriptions: [sub],
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result.repaired).toBe(false);
    expect(harness.recompute).not.toHaveBeenCalled();
    noFalseWrite(harness.linkage);
  });

  it("keeps a valid Apple grant when recompute runs for a proven Stripe subscription", async () => {
    const sub = subscription();
    const harness = deps({
      metadata: { stripeSubscriptionId: sub.id },
      subscriptions: [sub],
      appleGrant: {
        grantsAccess: true,
        plan: "monthly",
        source: "apple",
      },
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result.repaired).toBe(true);
    expect(harness.projection).toEqual([
      expect.objectContaining({
        summittSubscribed: true,
        summittPlan: "monthly",
      }),
    ]);
    expect(
      harness.projection.some((fields) => fields.summittSubscribed === false)
    ).toBe(false);
  });

  it("is idempotent when repair runs again for the same subscription", async () => {
    const sub = subscription();
    const harness = deps({
      metadata: { stripeSubscriptionId: sub.id },
      subscriptions: [sub],
    });

    const first = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);
    const second = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(first).toEqual({ repaired: true, reason: "repaired" });
    expect(second).toEqual({ repaired: true, reason: "repaired" });
    expect(harness.linkage).toEqual([
      { stripeSubscriptionId: sub.id, stripeCustomerId: "cus_b" },
      { stripeSubscriptionId: sub.id, stripeCustomerId: "cus_b" },
    ]);
    noFalseWrite(harness.linkage);
  });

  it("does not clear Clerk when a stored subscription id is missing and search finds nothing", async () => {
    const harness = deps({
      metadata: {
        stripeSubscriptionId: "sub_gone",
        stripeCustomerId: "cus_old",
        summittPlan: "paused",
      },
      customers: [],
      listError: Object.assign(new Error("no such customer"), {
        code: "resource_missing",
      }),
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result.repaired).toBe(false);
    expect(harness.linkage).toEqual([]);
    noFalseWrite(harness.linkage);
  });

  it("does not recognize a Summitt price by itself", async () => {
    const sub = subscription({
      metadata: {},
      items: {
        data: [
          {
            price: {
              id: SUMMITT_PRICE,
              recurring: { interval: "month" },
            },
          },
        ],
      },
    });
    const harness = deps({
      metadata: { stripeSubscriptionId: sub.id },
      subscriptions: [sub],
      sessions: [],
    });

    const result = await attemptStripeMembershipRepair(USER_B, harness.repairDeps);

    expect(result.repaired).toBe(false);
    expect(harness.searchCustomerIdsByMetadataUserId).not.toHaveBeenCalled();
    noFalseWrite(harness.linkage);
  });
});

describe("stripe membership repair scope", () => {
  it("does not touch persistent sign-in, and native checkout stays blocked", () => {
    const root = process.cwd();
    const repair = readFileSync(
      path.join(root, "src/lib/stripe-membership-repair.ts"),
      "utf8"
    );
    const page = readFileSync(
      path.join(root, "src/app/app/membership/page.tsx"),
      "utf8"
    );
    const checkout = readFileSync(
      path.join(root, "src/app/api/stripe/create-checkout-session/route.ts"),
      "utf8"
    );
    const signIn = readFileSync(
      path.join(root, "src/components/app-sign-in/AppEmailCodeSignIn.tsx"),
      "utf8"
    );

    expect(repair).not.toMatch(/signOut|localStorage|sessionStorage|document\.cookie|setActive|WKWebsiteDataStore/);
    expect(repair).not.toContain("customers.list");
    expect(repair).not.toContain("recomputeMembershipFromDurableSources");
    expect(repair).toContain("recomputeMembershipFromAuthoritativeStripeSubscription");
    expect(page).toContain("repairStripeMembershipForUser");
    expect(page).toContain("redirect(APP_POST_AUTH_PATH)");
    expect(page).not.toContain('redirect("/dashboard/victory-room")');
    expect(checkout).toContain("NATIVE_APP_CHECKOUT_UNAVAILABLE_ERROR");
    expect(checkout).toContain("isNativeSummittMindsetAppRequestFromRequest");
    expect(repair).not.toContain("create-checkout-session");
    expect(repair).not.toContain("NATIVE_APP_CHECKOUT_UNAVAILABLE_ERROR");
    expect(signIn).toContain("router.replace(APP_POST_AUTH_PATH)");
    expect(signIn).not.toContain("repairStripeMembershipForUser");
  });
});
