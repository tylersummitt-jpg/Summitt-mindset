import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadIdMock,
  markProvisionedMock,
  markSignInMock,
  createUserMock,
  lookupExternalMock,
  lookupEmailMock,
  identityMock,
  ticketMock,
  holdMock,
  sessionMock,
  updateCustomerMock,
  updateSubMock,
  retrieveSubMock,
  cancelSubMock,
  createSubMock,
} = vi.hoisted(() => ({
  loadIdMock: vi.fn(),
  markProvisionedMock: vi.fn(),
  markSignInMock: vi.fn(),
  createUserMock: vi.fn(),
  lookupExternalMock: vi.fn(),
  lookupEmailMock: vi.fn(),
  identityMock: vi.fn(),
  ticketMock: vi.fn(),
  holdMock: vi.fn(),
  sessionMock: vi.fn(),
  updateCustomerMock: vi.fn(),
  updateSubMock: vi.fn(),
  retrieveSubMock: vi.fn(),
  cancelSubMock: vi.fn(),
  createSubMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("@/lib/acquisition/store", () => ({
  noteAcquisitionClerk: vi.fn(async () => undefined),
}));

vi.mock("@/lib/acquisition/email-acquired-member-notice.server", () => ({
  maybeNotifyEmailAcquiredMember: vi.fn(async () => "skipped"),
  verifiedAcquisitionJourneyId: vi.fn(async () => null),
}));

vi.mock("@/lib/marketing-account-link", () => ({
  linkMarketingVisitorToClerkUser: vi.fn(async () => undefined),
}));

vi.mock("@/lib/stripe-first-checkout/intent-store", () => ({
  alignBindingExpiry: vi.fn(),
  attachCheckoutSession: vi.fn(),
  confirmStripeTrial: vi.fn(),
  deleteUnstartedLiveIntent: vi.fn(),
  insertCheckoutIntent: vi.fn(),
  liveCanaryIntentExists: vi.fn(),
  loadConfirmedIntentsForEmail: vi.fn(async () => []),
  loadIntentByBindingHash: vi.fn(),
  loadIntentById: (...args: unknown[]) => loadIdMock(...args),
  loadIntentBySubscriptionId: vi.fn(async () => null),
  loadResumeCandidateIntents: vi.fn(async () => []),
  markClerkProvisioned: (...args: unknown[]) => markProvisionedMock(...args),
  markHoldConfirmedAndReleased: vi.fn(),
  markHoldReleased: vi.fn(),
  markResumeSignInRequired: vi.fn(),
  markSessionStartedForExistingUser: sessionMock,
  markSessionStartedForProvisionedUser: sessionMock,
  markSignInRequired: (...args: unknown[]) => markSignInMock(...args),
  saveCheckoutMatchFields: vi.fn(),
  saveCheckoutRequestCountry: vi.fn(),
  saveGoogleClickId: vi.fn(),
}));

vi.mock("@/lib/stripe-first-checkout/stripe-hold", () => ({
  reconcileActivationHold: (...args: unknown[]) => holdMock(...args),
}));

vi.mock("@/lib/stripe-first-checkout/clerk-provision", () => ({
  createClerkSignInTicket: (...args: unknown[]) => ticketMock(...args),
  createReservedClerkUser: (...args: unknown[]) => createUserMock(...args),
  getClerkIdentity: (...args: unknown[]) => identityMock(...args),
  lookupClerkUserIdByExternalId: (...args: unknown[]) => lookupExternalMock(...args),
  lookupClerkUserIdsByEmail: (...args: unknown[]) => lookupEmailMock(...args),
}));

vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: vi.fn(async () => ({})),
}));

vi.mock("@/lib/clerk-public-metadata", () => ({
  updateClerkPublicMetadata: vi.fn(async () => undefined),
}));

vi.mock("@/lib/summitt-membership-entitlement.server", () => ({
  recomputeMembershipFromAuthoritativeStripeSubscription: vi.fn(async () => undefined),
  resolveAppleMembershipGrantForUser: vi.fn(async () => null),
}));

vi.mock("@/lib/meta-capi-web-identifiers", () => ({
  matchFromCheckoutRequest: vi.fn(),
  saveMetaCapiWebMatchForUser: vi.fn(async () => undefined),
}));

vi.mock("stripe", () => {
  class StripeMock {
    customers = { update: (...args: unknown[]) => updateCustomerMock(...args) };
    subscriptions = {
      update: (...args: unknown[]) => updateSubMock(...args),
      retrieve: (...args: unknown[]) => retrieveSubMock(...args),
      cancel: (...args: unknown[]) => cancelSubMock(...args),
      create: (...args: unknown[]) => createSubMock(...args),
    };
  }
  return { default: StripeMock };
});

import { prepareConfirmedCheckout } from "@/lib/stripe-first-checkout/activate";
import type { CheckoutBrowserIntent } from "@/lib/stripe-first-checkout/intent-store";

const EMAIL = "member@example.com";

type Row = {
  id: string;
  clerk_user_id: string | null;
  clerk_user_provisioned_at: string | null;
  sign_in_required_at: string | null;
  session_started_at: string | null;
};

type DirectoryUser = { id: string; email: string; externalId: string };

let row: Row;
let users: DirectoryUser[];
let createCount = 0;

function intent(id = "intent_1"): CheckoutBrowserIntent {
  return { id } as CheckoutBrowserIntent;
}

function proof(subscriptionId = "sub_1") {
  return {
    ok: true as const,
    email: EMAIL,
    customerId: "cus_1",
    subscriptionId,
    trialEndUnix: 1_800_000_000,
    subscription: {
      id: subscriptionId,
      status: "trialing",
      cancel_at: 1_800_000_000,
      metadata: { plan: "monthly" },
    } as never,
  };
}

function installDirectory() {
  lookupExternalMock.mockImplementation(async (externalId: string) => {
    return users.find((user) => user.externalId === externalId)?.id ?? null;
  });
  lookupEmailMock.mockImplementation(async (email: string) => {
    return users.filter((user) => user.email === email).map((user) => user.id);
  });
  identityMock.mockImplementation(async (id: string) => {
    const user = users.find((item) => item.id === id);
    if (!user) return null;
    return {
      id: user.id,
      primaryEmail: user.email,
      reserved: true,
      verificationStatus: null,
      externalId: user.externalId,
    };
  });
  createUserMock.mockImplementation(async (args: { email: string; externalId: string }) => {
    const taken = users.find(
      (user) => user.email === args.email || user.externalId === args.externalId
    );
    if (taken) return { conflict: true };
    createCount += 1;
    const created = { id: `user_${createCount}`, email: args.email, externalId: args.externalId };
    users.push(created);
    return { id: created.id };
  });
  loadIdMock.mockImplementation(async () => ({ ...row }));
  markProvisionedMock.mockImplementation(async (args: { intentId: string; clerkUserId: string }) => {
    if (
      row.id !== args.intentId ||
      row.clerk_user_id ||
      row.clerk_user_provisioned_at ||
      row.sign_in_required_at
    ) {
      return false;
    }
    row = {
      ...row,
      clerk_user_id: args.clerkUserId,
      clerk_user_provisioned_at: "2026-11-12T12:00:00.000Z",
    };
    return true;
  });
  markSignInMock.mockImplementation(async (intentId: string) => {
    if (
      row.id !== intentId ||
      row.sign_in_required_at ||
      row.clerk_user_id ||
      row.clerk_user_provisioned_at
    ) {
      return false;
    }
    row = { ...row, sign_in_required_at: "2026-11-12T12:00:00.000Z" };
    return true;
  });
}

function expectNoActivationSideEffects() {
  expect(ticketMock).not.toHaveBeenCalled();
  expect(sessionMock).not.toHaveBeenCalled();
  expect(holdMock).not.toHaveBeenCalled();
  expect(cancelSubMock).not.toHaveBeenCalled();
  expect(createSubMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  createCount = 0;
  users = [];
  row = {
    id: "intent_1",
    clerk_user_id: null,
    clerk_user_provisioned_at: null,
    sign_in_required_at: null,
    session_started_at: null,
  };
  process.env.STRIPE_SECRET_KEY = "sk_test_prepare";
  process.env.CLERK_SECRET_KEY = "sk_test_prepare";
  installDirectory();
  updateCustomerMock.mockResolvedValue({});
  updateSubMock.mockResolvedValue({});
  retrieveSubMock.mockResolvedValue({ id: "sub_1", status: "trialing", cancel_at: 1_800_000_000 });
});

describe("prepareConfirmedCheckout", () => {
  it("prepares one reserved user for a new email and does not sign them in", async () => {
    const result = await prepareConfirmedCheckout(intent(), EMAIL, proof());
    expect(result).toEqual({ status: "prepared", clerkUserId: "user_1" });
    expect(createCount).toBe(1);
    expect(users).toEqual([{ id: "user_1", email: EMAIL, externalId: "intent_1" }]);
    expect(row.clerk_user_id).toBe("user_1");
    expect(updateSubMock).toHaveBeenCalledWith("sub_1", {
      metadata: { userId: "user_1", plan: "monthly" },
    });
    expectNoActivationSideEffects();
  });

  it("requires sign-in for an existing Clerk account and does not link it", async () => {
    users.push({ id: "user_existing", email: EMAIL, externalId: "member-since-2019" });
    const result = await prepareConfirmedCheckout(intent(), EMAIL, proof());
    expect(result).toEqual({ status: "sign_in_required" });
    expect(createCount).toBe(0);
    expect(row.sign_in_required_at).toBeTruthy();
    expect(row.clerk_user_id).toBeNull();
    expect(updateSubMock).not.toHaveBeenCalled();
    expectNoActivationSideEffects();
  });

  it("reuses the reserved user already stored for this intent", async () => {
    users.push({ id: "user_reserved", email: EMAIL, externalId: "intent_1" });
    const result = await prepareConfirmedCheckout(intent(), EMAIL, proof());
    expect(result).toEqual({ status: "prepared", clerkUserId: "user_reserved" });
    expect(createCount).toBe(0);
    expect(users).toHaveLength(1);
    expect(row.clerk_user_id).toBe("user_reserved");
    expectNoActivationSideEffects();
  });

  it("retries the Supabase acknowledgment without creating another Clerk user", async () => {
    markProvisionedMock.mockResolvedValueOnce(false);
    const first = await prepareConfirmedCheckout(intent(), EMAIL, proof());
    expect(first).toEqual({ status: "retry" });
    expect(createCount).toBe(1);
    expect(row.clerk_user_id).toBeNull();

    const second = await prepareConfirmedCheckout(intent(), EMAIL, proof());
    expect(second).toEqual({ status: "prepared", clerkUserId: "user_1" });
    expect(createCount).toBe(1);
    expect(users).toHaveLength(1);
    expectNoActivationSideEffects();
  });

  it("recovers a Clerk user created before the create request timed out", async () => {
    createUserMock.mockImplementationOnce(async (args: { email: string; externalId: string }) => {
      users.push({ id: "user_timeout", email: args.email, externalId: args.externalId });
      throw new Error("clerk_create_failed");
    });
    await expect(prepareConfirmedCheckout(intent(), EMAIL, proof())).rejects.toThrow(
      "clerk_create_failed"
    );
    expect(users).toHaveLength(1);
    expect(row.clerk_user_id).toBeNull();

    const retried = await prepareConfirmedCheckout(intent(), EMAIL, proof());
    expect(retried).toEqual({ status: "prepared", clerkUserId: "user_timeout" });
    expect(users).toHaveLength(1);
    expectNoActivationSideEffects();
  });

  it("lets two overlapping preparations converge on one Clerk user", async () => {
    let releaseFirst: () => void = () => undefined;
    const firstEntered = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    createUserMock.mockImplementation(async (args: { email: string; externalId: string }) => {
      calls += 1;
      if (calls === 1) {
        await firstEntered;
        users.push({ id: "user_race", email: args.email, externalId: args.externalId });
        return { id: "user_race" };
      }
      releaseFirst();
      return { conflict: true };
    });

    const [first, second] = await Promise.all([
      prepareConfirmedCheckout(intent(), EMAIL, proof()),
      prepareConfirmedCheckout(intent(), EMAIL, proof()),
    ]);
    expect([first.status, second.status].sort()).toEqual(["prepared", "prepared"]);
    expect(users).toEqual([{ id: "user_race", email: EMAIL, externalId: "intent_1" }]);
    expect(row.clerk_user_id).toBe("user_race");
    expectNoActivationSideEffects();
  });

  it("does not give a second intent the reserved user from the first", async () => {
    expect((await prepareConfirmedCheckout(intent("intent_1"), EMAIL, proof("sub_1"))).status).toBe(
      "prepared"
    );
    row = {
      id: "intent_2",
      clerk_user_id: null,
      clerk_user_provisioned_at: null,
      sign_in_required_at: null,
      session_started_at: null,
    };
    const second = await prepareConfirmedCheckout(intent("intent_2"), EMAIL, proof("sub_2"));
    expect(second).toEqual({ status: "sign_in_required" });
    expect(users).toHaveLength(1);
    expect(users[0]?.externalId).toBe("intent_1");
    expect(row.clerk_user_id).toBeNull();
    expect(updateSubMock).not.toHaveBeenCalledWith("sub_2", expect.anything());
    expectNoActivationSideEffects();
  });

  it("stops when a conflicting external id already owns the email", async () => {
    createUserMock.mockResolvedValue({ conflict: true });
    users.push({ id: "user_other", email: EMAIL, externalId: "intent_other" });
    const result = await prepareConfirmedCheckout(intent(), EMAIL, proof());
    expect(result).toEqual({ status: "sign_in_required" });
    expect(users).toHaveLength(1);
    expect(row.clerk_user_id).toBeNull();
    expect(updateCustomerMock).not.toHaveBeenCalled();
    expectNoActivationSideEffects();
  });

  it("keeps the created user when subscription linking fails and then retries", async () => {
    updateSubMock.mockRejectedValueOnce(new Error("stripe_down"));
    await expect(prepareConfirmedCheckout(intent(), EMAIL, proof())).rejects.toThrow("stripe_down");
    expect(users).toHaveLength(1);
    expect(row.clerk_user_id).toBe("user_1");

    const retried = await prepareConfirmedCheckout(intent(), EMAIL, proof());
    expect(retried).toEqual({ status: "prepared", clerkUserId: "user_1" });
    expect(users).toHaveLength(1);
    expectNoActivationSideEffects();
  });

  it("links the same user again when the intent is already prepared", async () => {
    users.push({ id: "user_ready", email: EMAIL, externalId: "intent_1" });
    row = {
      ...row,
      clerk_user_id: "user_ready",
      clerk_user_provisioned_at: "2026-11-12T11:00:00.000Z",
    };
    const result = await prepareConfirmedCheckout(intent(), EMAIL, proof());
    expect(result).toEqual({ status: "prepared", clerkUserId: "user_ready" });
    expect(createCount).toBe(0);
    expect(updateSubMock).toHaveBeenCalledWith("sub_1", {
      metadata: { userId: "user_ready", plan: "monthly" },
    });
    expectNoActivationSideEffects();
  });

  it("reuses our user when the external-id lookup lags behind a create conflict", async () => {
    let visible = false;
    lookupExternalMock.mockImplementation(async () => null);
    lookupEmailMock.mockImplementation(async () =>
      visible ? ["user_lag"] : []
    );
    identityMock.mockImplementation(async () =>
      visible
        ? {
            id: "user_lag",
            primaryEmail: EMAIL,
            reserved: true,
            verificationStatus: null,
            externalId: "intent_1",
          }
        : null
    );
    createUserMock.mockImplementation(async () => {
      visible = true;
      users.push({ id: "user_lag", email: EMAIL, externalId: "intent_1" });
      return { conflict: true };
    });
    const result = await prepareConfirmedCheckout(intent(), EMAIL, proof());
    expect(result).toEqual({ status: "prepared", clerkUserId: "user_lag" });
    expect(users).toHaveLength(1);
    expect(row.sign_in_required_at).toBeNull();
    expect(row.clerk_user_id).toBe("user_lag");
    expectNoActivationSideEffects();
  });

  it("does not issue a ticket or touch the hold from preparation", () => {
    const src = readFileSync("src/lib/stripe-first-checkout/activate.ts", "utf8");
    const prepare = src.slice(
      src.indexOf("export async function prepareConfirmedCheckout"),
      src.indexOf("Browser return. POST only.")
    );
    expect(prepare).toContain("markReservedCheckoutEmail: true");
    expect(prepare).not.toContain("createClerkSignInTicket");
    expect(prepare).not.toContain("reconcileActivationHold");
    expect(prepare).not.toContain("markSessionStarted");
    expect(prepare).not.toContain("subscriptions.cancel");
    const browser = src.slice(
      src.indexOf("async function provisionNewCustomer"),
      src.indexOf("export async function prepareConfirmedCheckout")
    );
    expect(browser).toContain("issueTicketIfNeeded");
  });
});
