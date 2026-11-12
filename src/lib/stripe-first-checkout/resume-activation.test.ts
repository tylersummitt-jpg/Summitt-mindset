import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const identityMock = vi.fn();
const lookupEmailMock = vi.fn();
const loadResumeMock = vi.fn();
const loadConfirmedMock = vi.fn();
const loadIdMock = vi.fn();
const loadBySubscriptionMock = vi.fn();
const loadBindingMock = vi.fn();
const markResumeSignInMock = vi.fn();
const markSessionMock = vi.fn();
const markProvisionedSessionMock = vi.fn();
const markHoldReleasedMock = vi.fn();
const markHoldBothMock = vi.fn();
const holdMock = vi.fn();
const appleMock = vi.fn();
const clerkMetadataMock = vi.fn();
const updateClerkMock = vi.fn();
const recomputeMock = vi.fn();
const retrieveCustomerMock = vi.fn();
const retrieveSubMock = vi.fn();
const updateCustomerMock = vi.fn();
const updateSubMock = vi.fn();
const createSubMock = vi.fn();
const cancelSubMock = vi.fn();

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

vi.mock("@/lib/stripe-first-checkout/member-notify", () => ({
  isOwnerCanaryMetadata: () => false,
  notifyConfirmedStripeFirstTrial: vi.fn(),
  stripeFirstMemberNotification: vi.fn(),
}));

vi.mock("@/lib/stripe-first-checkout/intent-store", () => ({
  alignBindingExpiry: vi.fn(),
  attachCheckoutSession: vi.fn(),
  confirmStripeTrial: vi.fn(),
  deleteUnstartedLiveIntent: vi.fn(),
  insertCheckoutIntent: vi.fn(),
  liveCanaryIntentExists: vi.fn(),
  loadConfirmedIntentsForEmail: (...args: unknown[]) => loadConfirmedMock(...args),
  loadIntentByBindingHash: (...args: unknown[]) => loadBindingMock(...args),
  loadIntentById: (...args: unknown[]) => loadIdMock(...args),
  loadIntentBySubscriptionId: (...args: unknown[]) => loadBySubscriptionMock(...args),
  loadResumeCandidateIntents: (...args: unknown[]) => loadResumeMock(...args),
  markClerkProvisioned: vi.fn(),
  markHoldConfirmedAndReleased: (...args: unknown[]) => markHoldBothMock(...args),
  markHoldReleased: (...args: unknown[]) => markHoldReleasedMock(...args),
  markResumeSignInRequired: (...args: unknown[]) => markResumeSignInMock(...args),
  markSessionStartedForExistingUser: (...args: unknown[]) => markSessionMock(...args),
  markSessionStartedForProvisionedUser: (...args: unknown[]) =>
    markProvisionedSessionMock(...args),
  markSignInRequired: vi.fn(),
  saveCheckoutMatchFields: vi.fn(),
  saveCheckoutRequestCountry: vi.fn(),
  saveGoogleClickId: vi.fn(),
}));

vi.mock("@/lib/stripe-first-checkout/stripe-hold", () => ({
  reconcileActivationHold: (...args: unknown[]) => holdMock(...args),
}));

vi.mock("@/lib/stripe-first-checkout/clerk-provision", () => ({
  createClerkSignInTicket: vi.fn(),
  createReservedClerkUser: vi.fn(),
  getClerkIdentity: (...args: unknown[]) => identityMock(...args),
  lookupClerkUserIdByExternalId: vi.fn(),
  lookupClerkUserIdsByEmail: (...args: unknown[]) => lookupEmailMock(...args),
}));

vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: (...args: unknown[]) => clerkMetadataMock(...args),
}));

vi.mock("@/lib/clerk-public-metadata", () => ({
  updateClerkPublicMetadata: (...args: unknown[]) => updateClerkMock(...args),
}));

vi.mock("@/lib/summitt-membership-entitlement.server", () => ({
  recomputeMembershipFromAuthoritativeStripeSubscription: (...args: unknown[]) =>
    recomputeMock(...args),
  resolveAppleMembershipGrantForUser: (...args: unknown[]) => appleMock(...args),
}));

vi.mock("@/lib/meta-capi-web-identifiers", () => ({
  matchFromCheckoutRequest: vi.fn(),
  saveMetaCapiWebMatchForUser: vi.fn(async () => undefined),
}));

vi.mock("stripe", () => {
  class StripeMock {
    customers = {
      retrieve: (...args: unknown[]) => retrieveCustomerMock(...args),
      update: (...args: unknown[]) => updateCustomerMock(...args),
    };
    subscriptions = {
      retrieve: (...args: unknown[]) => retrieveSubMock(...args),
      update: (...args: unknown[]) => updateSubMock(...args),
      create: (...args: unknown[]) => createSubMock(...args),
      cancel: (...args: unknown[]) => cancelSubMock(...args),
    };
  }
  return { default: StripeMock };
});

import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";
import {
  accountResumeNeedsPostSignIn,
  applyRecoveryToSignInMetadata,
  linkExistingHostedCheckout,
  resumeExistingAccountActivation,
} from "@/lib/stripe-first-checkout/activate";
import { createReservedClerkUser } from "@/lib/stripe-first-checkout/clerk-provision";

const USER = "user_clerk";
const EMAIL = "member@example.com";
const TRIAL_END = 1_800_000_000;

type IntentFixture = {
  id: string;
  livemode: boolean;
  email: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  stripe_trial_confirmed_at: string;
  stripe_trial_end_at: string;
  stripe_hold_cancel_at: string;
  hold_confirmed_at: string | null;
  sign_in_required_at: string | null;
  clerk_user_provisioned_at: string | null;
  clerk_user_id: string | null;
  session_started_at: string | null;
  hold_released_at: string | null;
  binding_expires_at: string;
  stripe_checkout_session_id: string | null;
  meta_fbc: string | null;
  meta_fbp: string | null;
  client_ip: string | null;
  client_user_agent: string | null;
};

function intent(overrides: Partial<IntentFixture> = {}): IntentFixture {
  return {
    id: "intent_1",
    livemode: false,
    email: EMAIL,
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    stripe_trial_confirmed_at: "2026-11-11T15:52:37.000Z",
    stripe_trial_end_at: new Date(TRIAL_END * 1000).toISOString(),
    stripe_hold_cancel_at: new Date(TRIAL_END * 1000).toISOString(),
    hold_confirmed_at: "2026-11-11T15:52:38.000Z",
    sign_in_required_at: "2026-11-11T15:52:43.000Z",
    clerk_user_provisioned_at: null,
    clerk_user_id: null,
    session_started_at: null,
    hold_released_at: null,
    binding_expires_at: "2020-01-01T00:00:00.000Z",
    stripe_checkout_session_id: null,
    meta_fbc: null,
    meta_fbp: null,
    client_ip: null,
    client_user_agent: null,
    ...overrides,
  };
}

type SubscriptionFixture = {
  id: string;
  customer: string;
  livemode: boolean;
  status: string;
  pause_collection: null;
  cancel_at: number | null;
  cancel_at_period_end: boolean;
  trial_end: number;
  metadata: {
    checkoutIntentId?: string;
    summittCheckoutFlow?: string;
    userId?: string;
  };
  items: { data: Array<{ price: { id: string; recurring?: { interval: string } } }> };
};

function subscription(overrides: Partial<SubscriptionFixture> = {}): SubscriptionFixture {
  return {
    id: "sub_1",
    customer: "cus_1",
    livemode: false,
    status: "trialing",
    pause_collection: null,
    cancel_at: TRIAL_END,
    cancel_at_period_end: false,
    trial_end: TRIAL_END,
    metadata: {
      checkoutIntentId: "intent_1",
      summittCheckoutFlow: "stripe_first",
    },
    items: { data: [{ price: { id: "price_month", recurring: { interval: "month" } } }] },
    ...overrides,
  };
}

type CustomerFixture = {
  id: string;
  deleted: boolean;
  email: string;
  metadata: { userId?: string };
};

function customer(overrides: Partial<CustomerFixture> = {}): CustomerFixture {
  return {
    id: "cus_1",
    deleted: false,
    email: EMAIL,
    metadata: {},
    ...overrides,
  };
}

let row = intent();
let sub = subscription();
let buyer = customer();
let clerkState: Record<string, unknown> = {};

beforeEach(() => {
  vi.clearAllMocks();
  row = intent();
  sub = subscription();
  buyer = customer();
  clerkState = {};
  process.env.STRIPE_SECRET_KEY = "sk_test_resume";
  process.env.CLERK_SECRET_KEY = "sk_test_resume";
  process.env.STRIPE_PRICE_ID_MONTHLY = "price_month";
  process.env.STRIPE_PRICE_ID_ANNUAL = "price_year";
  process.env.STRIPE_PRICE_ID_PARTNER_ANNUAL = "price_partner";
  identityMock.mockImplementation(async () => ({
    id: USER,
    primaryEmail: EMAIL,
    reserved: false,
    verificationStatus: "verified",
  }));
  lookupEmailMock.mockResolvedValue([USER]);
  loadResumeMock.mockImplementation(async () => (row.hold_released_at ? [] : [row]));
  loadConfirmedMock.mockImplementation(async () => [row]);
  loadIdMock.mockImplementation(async () => row);
  loadBySubscriptionMock.mockResolvedValue(null);
  loadBindingMock.mockResolvedValue(null);
  markResumeSignInMock.mockImplementation(async () => {
    if (row.sign_in_required_at || row.clerk_user_id) return false;
    row = { ...row, sign_in_required_at: "2026-11-11T16:00:00.000Z" };
    return true;
  });
  markProvisionedSessionMock.mockImplementation(async (intentId: string, clerkUserId: string) => {
    if (
      row.id !== intentId ||
      row.clerk_user_id !== clerkUserId ||
      !row.clerk_user_provisioned_at ||
      row.sign_in_required_at ||
      row.session_started_at
    ) {
      return false;
    }
    row = { ...row, session_started_at: "2026-11-11T16:00:01.000Z" };
    return true;
  });
  markSessionMock.mockImplementation(async (args: { clerkUserId: string }) => {
    if (!row.sign_in_required_at || row.clerk_user_id || row.session_started_at) return false;
    row = {
      ...row,
      clerk_user_id: args.clerkUserId,
      session_started_at: "2026-11-11T16:00:01.000Z",
    };
    return true;
  });
  markHoldReleasedMock.mockImplementation(async () => {
    row = { ...row, hold_released_at: "2026-11-11T16:00:02.000Z" };
    return true;
  });
  markHoldBothMock.mockImplementation(async () => {
    row = {
      ...row,
      hold_confirmed_at: row.hold_confirmed_at ?? "2026-11-11T16:00:02.000Z",
      hold_released_at: "2026-11-11T16:00:02.000Z",
    };
    return true;
  });
  holdMock.mockImplementation(async () => {
    sub = { ...sub, cancel_at: null };
    row = { ...row, hold_released_at: "2026-11-11T16:00:02.000Z" };
    return "ok";
  });
  appleMock.mockResolvedValue(null);
  clerkMetadataMock.mockImplementation(async () => ({ ...clerkState }));
  updateClerkMock.mockImplementation(async (_id: string, fields: Record<string, unknown>) => {
    clerkState = { ...clerkState, ...fields };
  });
  recomputeMock.mockImplementation(async () => {
    clerkState = { ...clerkState, summittSubscribed: true, summittPlan: "monthly" };
  });
  retrieveCustomerMock.mockImplementation(async () => buyer);
  retrieveSubMock.mockImplementation(async (id: string) => {
    if (id !== sub.id) {
      return subscription({
        id,
        status: "active",
        cancel_at: null,
        metadata: { userId: USER },
      });
    }
    return sub;
  });
  updateCustomerMock.mockImplementation(async (_id: string, body: { metadata: { userId: string } }) => {
    buyer = { ...buyer, metadata: { ...buyer.metadata, userId: body.metadata.userId } };
    return buyer;
  });
  updateSubMock.mockImplementation(async (_id: string, body: { metadata?: { userId?: string } }) => {
    sub = {
      ...sub,
      metadata: { ...sub.metadata, ...(body.metadata ?? {}) },
    };
    return sub;
  });
});

async function resume(userId = USER) {
  return resumeExistingAccountActivation({ clerkUserId: userId });
}

describe("resumeExistingAccountActivation", () => {
  it("links an existing account that is waiting for sign-in", async () => {
    const result = await resume();
    expect(result).toEqual({ status: "linked", subscriptionId: "sub_1" });
    expect(isSubscribedFromPublicMetadata(clerkState)).toBe(true);
    expect(row.hold_released_at).toBeTruthy();
    expect(updateSubMock).toHaveBeenCalledWith("sub_1", { metadata: { userId: USER } });
    expect(updateCustomerMock).toHaveBeenCalledWith("cus_1", { metadata: { userId: USER } });
    expect(cancelSubMock).not.toHaveBeenCalled();
    expect(createSubMock).not.toHaveBeenCalled();
    expect(updateClerkMock).toHaveBeenCalledWith(USER, {
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
    });
    expect(recomputeMock).toHaveBeenCalled();
    const clerkPatch = updateClerkMock.mock.calls[0][1] as Record<string, unknown>;
    expect(clerkPatch).not.toHaveProperty("smsEnabled");
    expect(clerkPatch).not.toHaveProperty("onboardingCompleted");
  });

  it("links a confirmed trial whose browser never marked sign-in", async () => {
    row = intent({ sign_in_required_at: null });
    const result = await resume();
    expect(result.status).toBe("linked");
    expect(markResumeSignInMock).toHaveBeenCalledWith({
      intentId: "intent_1",
      email: EMAIL,
      subscriptionId: "sub_1",
    });
    expect(markSessionMock).toHaveBeenCalled();
    expect(markResumeSignInMock.mock.invocationCallOrder[0]).toBeLessThan(
      markSessionMock.mock.invocationCallOrder[0]
    );
  });

  it("recovers after the browser binding expired and from a later sign-in", async () => {
    row = intent({ binding_expires_at: "2020-01-01T00:00:00.000Z" });
    expect((await resume()).status).toBe("linked");
    expect(cancelSubMock).not.toHaveBeenCalled();
  });

  it("does not create a second subscription for annual or partner prices", async () => {
    sub = subscription({
      items: { data: [{ price: { id: "price_year", recurring: { interval: "year" } } }] },
    });
    expect((await resume()).status).toBe("linked");
    sub = subscription({
      items: { data: [{ price: { id: "price_partner", recurring: { interval: "year" } } }] },
    });
    row = intent();
    expect((await resume()).status).toBe("linked");
    expect(createSubMock).not.toHaveBeenCalled();
    for (const call of updateSubMock.mock.calls) {
      expect(call[1]).toEqual({ metadata: { userId: USER } });
    }
  });

  it("returns none when the hold is already released", async () => {
    row = intent({
      clerk_user_id: USER,
      session_started_at: "2026-11-11T16:00:01.000Z",
      hold_released_at: "2026-11-11T16:00:02.000Z",
    });
    expect(await resume()).toEqual({ status: "none" });
    expect(retrieveSubMock).not.toHaveBeenCalled();
    expect(await accountResumeNeedsPostSignIn(USER)).toBe(false);
  });

  it("finishes a repeated request after the first claim", async () => {
    holdMock.mockResolvedValueOnce("retry");
    expect((await resume()).status).toBe("retry");
    expect((await resume()).status).toBe("linked");
    expect(createSubMock).not.toHaveBeenCalled();
  });

  it("returns none for a different email and does not write", async () => {
    identityMock.mockResolvedValue({
      id: "user_other",
      primaryEmail: "other@example.com",
      reserved: false,
      verificationStatus: "verified",
    });
    loadResumeMock.mockResolvedValue([]);
    expect(await resume("user_other")).toEqual({ status: "none" });
    expect(updateSubMock).not.toHaveBeenCalled();
    expect(markSessionMock).not.toHaveBeenCalled();
  });

  it("refuses an unverified email, a mismatched owner, and duplicate Clerk users", async () => {
    identityMock.mockResolvedValue({
      id: USER,
      primaryEmail: EMAIL,
      reserved: false,
      verificationStatus: "unverified",
    });
    expect((await resume()).status).toBe("conflict");
    expect(markSessionMock).not.toHaveBeenCalled();

    identityMock.mockResolvedValue({
      id: USER,
      primaryEmail: EMAIL,
      reserved: false,
      verificationStatus: "verified",
    });
    lookupEmailMock.mockResolvedValue(["user_other"]);
    expect((await resume()).status).toBe("conflict");
    lookupEmailMock.mockResolvedValue([USER, "user_other"]);
    expect((await resume()).status).toBe("conflict");
    expect(updateSubMock).not.toHaveBeenCalled();
  });

  it("refuses multiple pending intents before any provider write", async () => {
    loadResumeMock.mockResolvedValue([intent(), intent({ id: "intent_2" })]);
    expect((await resume()).status).toBe("conflict");
    expect(retrieveSubMock).not.toHaveBeenCalled();
    expect(await accountResumeNeedsPostSignIn(USER)).toBe(true);
  });

  it("refuses a Stripe customer mismatch or another Clerk owner", async () => {
    sub = subscription({ customer: "cus_other" });
    expect((await resume()).status).toBe("conflict");
    sub = subscription({
      metadata: {
        checkoutIntentId: "intent_1",
        summittCheckoutFlow: "stripe_first",
        userId: "user_other",
      },
    });
    expect((await resume()).status).toBe("conflict");
    buyer = customer({ metadata: { userId: "user_other" } });
    sub = subscription();
    expect((await resume()).status).toBe("conflict");
    expect(markSessionMock).not.toHaveBeenCalled();
    expect(updateSubMock).not.toHaveBeenCalled();
  });

  it("does not let a losing claim overwrite the winner", async () => {
    identityMock.mockResolvedValue({
      id: "user_a",
      primaryEmail: EMAIL,
      reserved: false,
      verificationStatus: "verified",
    });
    lookupEmailMock.mockResolvedValue(["user_a"]);
    updateCustomerMock.mockRejectedValueOnce(new Error("stripe_down"));
    expect((await resume("user_a")).status).toBe("retry");
    expect(row.clerk_user_id).toBe("user_a");
    expect(sub.metadata.userId).toBeUndefined();
    identityMock.mockResolvedValue({
      id: "user_b",
      primaryEmail: EMAIL,
      reserved: false,
      verificationStatus: "verified",
    });
    lookupEmailMock.mockResolvedValue(["user_b"]);
    expect((await resume("user_b")).status).toBe("conflict");
    expect(updateCustomerMock).toHaveBeenCalledTimes(1);
    expect(updateSubMock).not.toHaveBeenCalled();
    expect(cancelSubMock).not.toHaveBeenCalled();
  });

  it("refuses an existing Stripe membership, an Apple grant, and an unrecognized price", async () => {
    clerkMetadataMock.mockResolvedValue({ stripeSubscriptionId: "sub_paid" });
    expect((await resume()).status).toBe("conflict");
    clerkMetadataMock.mockResolvedValue({});
    appleMock.mockResolvedValue({ grantsAccess: true });
    expect((await resume()).status).toBe("conflict");
    appleMock.mockResolvedValue(null);
    sub = subscription({
      items: { data: [{ price: { id: "price_unknown" } }] },
    });
    expect((await resume()).status).toBe("conflict");
    expect(updateSubMock).not.toHaveBeenCalled();
    expect(cancelSubMock).not.toHaveBeenCalled();
  });

  it("does not clear a customer cancellation or a foreign hold", async () => {
    sub = subscription({ cancel_at_period_end: true, cancel_at: null });
    expect((await resume()).status).toBe("preserved");
    sub = subscription({ cancel_at: TRIAL_END + 86_400 });
    expect((await resume()).status).toBe("preserved");
    const expired = 1_700_000_000;
    row = intent({
      stripe_trial_end_at: new Date(expired * 1000).toISOString(),
      stripe_hold_cancel_at: new Date(expired * 1000).toISOString(),
    });
    sub = subscription({ trial_end: expired, cancel_at: expired });
    expect((await resume()).status).toBe("conflict");
    expect(updateSubMock).not.toHaveBeenCalled();
    expect(holdMock).not.toHaveBeenCalled();
  });

  it("stops when a customer cancellation appears after the claim", async () => {
    let reads = 0;
    retrieveSubMock.mockImplementation(async () => {
      reads += 1;
      if (reads > 1) return subscription({ cancel_at_period_end: true, cancel_at: null });
      return sub;
    });
    expect((await resume()).status).toBe("preserved");
    expect(updateSubMock).not.toHaveBeenCalled();
    expect(holdMock).not.toHaveBeenCalled();
  });

  it("retries a Stripe metadata failure without a second subscription", async () => {
    updateCustomerMock.mockRejectedValueOnce(new Error("stripe_down"));
    expect((await resume()).status).toBe("retry");
    expect(createSubMock).not.toHaveBeenCalled();
    expect((await resume()).status).toBe("linked");
  });

  it("retries a Clerk metadata failure and keeps the same owner", async () => {
    updateClerkMock.mockRejectedValueOnce(new Error("clerk_down"));
    expect((await resume()).status).toBe("retry");
    expect(row.clerk_user_id).toBe(USER);
    expect((await resume()).status).toBe("linked");
    expect(updateSubMock.mock.calls.every((call) => call[1].metadata.userId === USER)).toBe(true);
  });

  it("retries a session update failure before any provider identity write", async () => {
    markSessionMock.mockRejectedValueOnce(new Error("intent_update_failed"));
    expect((await resume()).status).toBe("retry");
    expect(updateSubMock).not.toHaveBeenCalled();
    expect((await resume()).status).toBe("linked");
  });

  it("completes when the hold is already clear but reconciliation reports preserved", async () => {
    holdMock.mockImplementation(async () => {
      sub = { ...sub, cancel_at: null };
      return "preserved";
    });
    expect((await resume()).status).toBe("linked");
    expect(markHoldReleasedMock).toHaveBeenCalled();
    expect(cancelSubMock).not.toHaveBeenCalled();
  });

  it("retries a hold release and then confirms the cleared hold", async () => {
    holdMock.mockResolvedValueOnce("retry");
    expect((await resume()).status).toBe("retry");
    expect(sub.cancel_at).toBe(TRIAL_END);
    expect((await resume()).status).toBe("linked");
    expect(sub.cancel_at).toBeNull();
    expect(row.hold_released_at).toBeTruthy();
  });

  it("records a hold that Stripe already cleared when the database flag is missing", async () => {
    row = intent({
      clerk_user_id: USER,
      session_started_at: "2026-11-11T16:00:01.000Z",
      hold_confirmed_at: null,
      hold_released_at: null,
    });
    sub = subscription({ cancel_at: null, metadata: { ...subscription().metadata, userId: USER } });
    buyer = customer({ metadata: { userId: USER } });
    const result = await resume();
    expect(result.status).toBe("linked");
    expect(holdMock).not.toHaveBeenCalled();
    expect(markHoldBothMock).toHaveBeenCalled();
    expect(cancelSubMock).not.toHaveBeenCalled();
  });

  it("does not grant access or release the hold when the claim is the only write", async () => {
    updateCustomerMock.mockRejectedValueOnce(new Error("stripe_down"));
    expect((await resume()).status).toBe("retry");
    expect(row.session_started_at).toBeTruthy();
    expect(row.hold_released_at).toBeNull();
    expect(isSubscribedFromPublicMetadata(clerkState)).toBe(false);
    expect(holdMock).not.toHaveBeenCalled();
  });

  it("retries without releasing the hold when Clerk entitlement is not readable", async () => {
    recomputeMock.mockImplementation(async () => undefined);
    expect((await resume()).status).toBe("retry");
    expect(row.session_started_at).toBeTruthy();
    expect(row.hold_released_at).toBeNull();
    expect(isSubscribedFromPublicMetadata(clerkState)).toBe(false);
    expect(holdMock).not.toHaveBeenCalled();
    expect(await accountResumeNeedsPostSignIn(USER)).toBe(true);

    recomputeMock.mockImplementation(async () => {
      clerkState = { ...clerkState, summittSubscribed: true, summittPlan: "monthly" };
    });
    expect((await resume()).status).toBe("linked");
    expect(isSubscribedFromPublicMetadata(clerkState)).toBe(true);
    expect(row.hold_released_at).toBeTruthy();
    expect(await accountResumeNeedsPostSignIn(USER)).toBe(false);
  });

  it("preserves a cancellation that appears after linking and before hold release", async () => {
    let reads = 0;
    retrieveSubMock.mockImplementation(async () => {
      reads += 1;
      if (reads >= 4) return subscription({ cancel_at_period_end: true, cancel_at: null });
      return sub;
    });
    expect((await resume()).status).toBe("preserved");
    expect(holdMock).not.toHaveBeenCalled();
    expect(row.hold_released_at).toBeNull();
    expect(cancelSubMock).not.toHaveBeenCalled();
  });

  it("sends a recovered customer to onboarding without a second checkout", async () => {
    const result = await resume();
    expect(result.status).toBe("linked");
    const staleSessionMetadata = {};
    const route = applyRecoveryToSignInMetadata({
      metadata: staleSessionMetadata,
      status: "linked",
      subscriptionId: result.subscriptionId,
    });
    expect(route.action).toBe("continue");
    if (route.action !== "continue") return;
    expect(isSubscribedFromPublicMetadata(route.metadata)).toBe(true);
    expect(isSubscribedFromPublicMetadata(clerkState)).toBe(true);
    expect(await accountResumeNeedsPostSignIn(USER)).toBe(false);

    const unfinished = applyRecoveryToSignInMetadata({
      metadata: staleSessionMetadata,
      status: "retry",
      subscriptionId: "sub_1",
    });
    expect(unfinished).toEqual({ action: "notice", status: "retry" });
  });

  it("finishes a recorded provision when the session or hold never completed", async () => {
    row = intent({
      clerk_user_id: USER,
      clerk_user_provisioned_at: "2026-11-11T16:00:00.000Z",
      sign_in_required_at: null,
      session_started_at: null,
    });
    identityMock.mockResolvedValue({
      id: USER,
      primaryEmail: EMAIL,
      reserved: true,
      verificationStatus: null,
    });
    const result = await resume();
    expect(result).toEqual({ status: "linked", subscriptionId: "sub_1" });
    expect(markProvisionedSessionMock).toHaveBeenCalledWith("intent_1", USER);
    expect(markSessionMock).not.toHaveBeenCalled();
    expect(markResumeSignInMock).not.toHaveBeenCalled();
    expect(createSubMock).not.toHaveBeenCalled();
    expect(row.hold_released_at).toBeTruthy();
    expect(isSubscribedFromPublicMetadata(clerkState)).toBe(true);
  });

  it("releases the hold when the provisioned session already started", async () => {
    row = intent({
      clerk_user_id: USER,
      clerk_user_provisioned_at: "2026-11-11T16:00:00.000Z",
      sign_in_required_at: null,
      session_started_at: "2026-11-11T16:00:01.000Z",
    });
    sub = subscription({
      metadata: {
        checkoutIntentId: "intent_1",
        summittCheckoutFlow: "stripe_first",
        userId: USER,
      },
    });
    buyer = customer({ metadata: { userId: USER } });
    expect((await resume()).status).toBe("linked");
    expect(markProvisionedSessionMock).not.toHaveBeenCalled();
    expect(holdMock).toHaveBeenCalled();
    expect(createSubMock).not.toHaveBeenCalled();
  });

  it("does not let another user claim a recorded provision", async () => {
    row = intent({
      clerk_user_id: USER,
      clerk_user_provisioned_at: "2026-11-11T16:00:00.000Z",
      sign_in_required_at: null,
    });
    identityMock.mockResolvedValue({
      id: "user_other",
      primaryEmail: EMAIL,
      reserved: false,
      verificationStatus: "verified",
    });
    lookupEmailMock.mockResolvedValue([USER]);
    expect((await resume("user_other")).status).toBe("conflict");
    expect(updateSubMock).not.toHaveBeenCalled();
    expect(markProvisionedSessionMock).not.toHaveBeenCalled();
  });

  it("lets the original cookie session and recovery agree on one owner", async () => {
    row = intent({
      clerk_user_id: USER,
      clerk_user_provisioned_at: "2026-11-11T16:00:00.000Z",
      sign_in_required_at: null,
    });
    let claimed = false;
    markProvisionedSessionMock.mockImplementation(async () => {
      if (claimed) return false;
      claimed = true;
      row = { ...row, session_started_at: "2026-11-11T16:00:01.000Z" };
      return true;
    });
    const [first, second] = await Promise.all([resume(), resume()]);
    expect([first.status, second.status].sort()).toEqual(["linked", "linked"]);
    expect(updateCustomerMock.mock.calls.every((call) => call[1].metadata.userId === USER)).toBe(
      true
    );
    expect(cancelSubMock).not.toHaveBeenCalled();
  });

  function verified(externalId: string | null) {
    return {
      id: USER,
      primaryEmail: EMAIL,
      reserved: false,
      verificationStatus: "verified",
      externalId,
    };
  }

  function expectNoRecoveryWrites() {
    expect(markResumeSignInMock).not.toHaveBeenCalled();
    expect(markSessionMock).not.toHaveBeenCalled();
    expect(markProvisionedSessionMock).not.toHaveBeenCalled();
    expect(updateCustomerMock).not.toHaveBeenCalled();
    expect(updateSubMock).not.toHaveBeenCalled();
    expect(updateClerkMock).not.toHaveBeenCalled();
    expect(recomputeMock).not.toHaveBeenCalled();
    expect(holdMock).not.toHaveBeenCalled();
    expect(markHoldReleasedMock).not.toHaveBeenCalled();
    expect(markHoldBothMock).not.toHaveBeenCalled();
    expect(createSubMock).not.toHaveBeenCalled();
    expect(createReservedClerkUser).not.toHaveBeenCalled();
  }

  it("links a verified checkout-created user whose external id is this intent", async () => {
    identityMock.mockResolvedValue(verified("intent_1"));
    expect((await resume()).status).toBe("linked");
    expect(row.clerk_user_id).toBe(USER);
    expect(createSubMock).not.toHaveBeenCalled();
    expect(createReservedClerkUser).not.toHaveBeenCalled();
  });

  it("stops a checkout-created user from claiming a different intent", async () => {
    identityMock.mockResolvedValue(verified("intent_2"));
    loadIdMock.mockImplementation(async (id: string) =>
      id === "intent_2" ? intent({ id: "intent_2" }) : row
    );
    expect((await resume()).status).toBe("conflict");
    expectNoRecoveryWrites();
  });

  it("recovers a verified ordinary account with no checkout external id", async () => {
    identityMock.mockResolvedValue(verified(null));
    expect((await resume()).status).toBe("linked");

    row = intent();
    sub = subscription();
    buyer = customer();
    clerkState = {};
    identityMock.mockResolvedValue(verified("member-since-2019"));
    loadIdMock.mockImplementation(async (id: string) => (id === row.id ? row : null));
    expect((await resume()).status).toBe("linked");
    expect(createSubMock).not.toHaveBeenCalled();
    expect(createReservedClerkUser).not.toHaveBeenCalled();
  });

  it("links the same checkout user after the reserved email becomes verified", async () => {
    identityMock.mockResolvedValue({
      id: USER,
      primaryEmail: EMAIL,
      reserved: false,
      verificationStatus: "verified",
      externalId: "intent_1",
    });
    expect((await resume()).status).toBe("linked");
    expect(row.clerk_user_id).toBe(USER);
    expect(createReservedClerkUser).not.toHaveBeenCalled();
    expect(createSubMock).not.toHaveBeenCalled();
  });

  it("keeps the recorded provisioned owner when another checkout external id exists", async () => {
    row = intent({
      clerk_user_id: USER,
      clerk_user_provisioned_at: "2026-11-11T16:00:00.000Z",
      sign_in_required_at: null,
      session_started_at: null,
    });
    identityMock.mockResolvedValue({
      id: USER,
      primaryEmail: EMAIL,
      reserved: false,
      verificationStatus: "verified",
      externalId: "intent_2",
    });
    loadIdMock.mockImplementation(async (id: string) =>
      id === "intent_2" ? intent({ id: "intent_2" }) : row
    );
    expect((await resume()).status).toBe("linked");
    expect(markProvisionedSessionMock).toHaveBeenCalledWith("intent_1", USER);
    expect(markSessionMock).not.toHaveBeenCalled();
    expect(createReservedClerkUser).not.toHaveBeenCalled();
  });

  it("does not write when the external id matches but the email is unverified", async () => {
    identityMock.mockResolvedValue({
      id: USER,
      primaryEmail: EMAIL,
      reserved: true,
      verificationStatus: null,
      externalId: "intent_1",
    });
    expect((await resume()).status).toBe("conflict");
    expectNoRecoveryWrites();
  });

  it("does not let a different Clerk user use a matching external id", async () => {
    identityMock.mockResolvedValue({
      id: "user_other",
      primaryEmail: EMAIL,
      reserved: false,
      verificationStatus: "verified",
      externalId: "intent_1",
    });
    lookupEmailMock.mockResolvedValue([USER]);
    expect((await resume("user_other")).status).toBe("conflict");
    expectNoRecoveryWrites();
  });

  it("does not write when another confirmed checkout competes", async () => {
    identityMock.mockResolvedValue(verified("intent_1"));
    loadConfirmedMock.mockResolvedValue([
      row,
      intent({
        id: "intent_2",
        clerk_user_id: "user_other",
        clerk_user_provisioned_at: "2026-11-11T16:00:00.000Z",
      }),
    ]);
    expect((await resume()).status).toBe("conflict");
    expectNoRecoveryWrites();
  });

  it("does not repeat recovery or create another subscription after success", async () => {
    identityMock.mockResolvedValue(verified("intent_1"));
    expect((await resume()).status).toBe("linked");
    expect((await resume()).status).toBe("none");
    expect(createSubMock).not.toHaveBeenCalled();
    expect(createReservedClerkUser).not.toHaveBeenCalled();
    expect(cancelSubMock).not.toHaveBeenCalled();
  });

  it("returns none when no unfinished intent is loaded", async () => {
    loadResumeMock.mockResolvedValue([]);
    expect(await resume()).toEqual({ status: "none" });
    expect(markSessionMock).not.toHaveBeenCalled();
  });

  function openOriginalBrowserReturn() {
    row = {
      ...row,
      binding_expires_at: "2099-01-01T00:00:00.000Z",
      stripe_checkout_session_id: "cs_original",
    };
    loadBindingMock.mockImplementation(async () => row);
  }

  async function originalBrowserReturns() {
    return linkExistingHostedCheckout({
      bindingSecret: "original-browser-secret",
      clerkUserId: USER,
      signedInEmail: EMAIL,
    });
  }

  it("does not cancel the linked subscription when the original browser returns after recovery", async () => {
    expect((await resume()).status).toBe("linked");
    expect(row.clerk_user_id).toBe(USER);
    expect(sub.metadata.userId).toBe(USER);
    expect(clerkState.stripeSubscriptionId).toBe("sub_1");

    openOriginalBrowserReturn();
    const returned = await originalBrowserReturns();

    expect(returned.status).toBe("linked");
    expect(cancelSubMock).not.toHaveBeenCalled();
    expect(createSubMock).not.toHaveBeenCalled();
    expect(createReservedClerkUser).not.toHaveBeenCalled();
    expect(sub.id).toBe("sub_1");
    expect(sub.metadata.userId).toBe(USER);
    expect(buyer.metadata.userId).toBe(USER);
    expect(clerkState.stripeSubscriptionId).toBe("sub_1");
    expect(row.clerk_user_id).toBe(USER);
  });

  it("does not cancel when the original browser links first and recovery runs second", async () => {
    openOriginalBrowserReturn();
    const returned = await originalBrowserReturns();

    expect(returned.status).toBe("linked");
    expect(row.clerk_user_id).toBe(USER);
    expect(sub.metadata.userId).toBe(USER);
    expect(cancelSubMock).not.toHaveBeenCalled();

    expect((await resume()).status).toBe("none");
    expect(cancelSubMock).not.toHaveBeenCalled();
    expect(createSubMock).not.toHaveBeenCalled();
    expect(createReservedClerkUser).not.toHaveBeenCalled();
    expect(sub.id).toBe("sub_1");
    expect(sub.metadata.userId).toBe(USER);
    expect(clerkState.stripeSubscriptionId).toBe("sub_1");
  });
});

describe("recovery routing source", () => {
  it("keeps the cookie link path and does not cancel from the new path", () => {
    const src = readFileSync("src/lib/stripe-first-checkout/activate.ts", "utf8");
    const added = src.slice(src.indexOf("export type ResumeActivationStatus"));
    expect(added).not.toContain("cancelUnlinkedTrial");
    expect(added).not.toContain("linkExistingHostedCheckout");
    expect(added).not.toContain("subscriptions.cancel");
    expect(added).not.toContain("smsEnabled");
    expect(added).not.toContain("onboardingCompleted");
    expect(src).toContain("export async function linkExistingHostedCheckout");
  });

  it("runs recovery on post-sign-in before the subscribe redirect", () => {
    const page = readFileSync("src/app/post-sign-in/page.tsx", "utf8");
    const recovery = page.indexOf("resumeExistingAccountActivation");
    const subscribe = page.indexOf('"/subscribe?from=post-sign-in"');
    expect(recovery).toBeGreaterThan(-1);
    expect(subscribe).toBeGreaterThan(recovery);
    expect(page).toContain('effectiveMd?.summittPlan === "paused"');
    expect(page).toContain("inactiveMembershipRedirectPath");
    expect(page).toContain("onboardingCompleted");
    expect(page).toContain("getOnboardingSobStatus");
    expect(page).toContain("MEMBER_APP_HOME_PATH");
  });

  it("sends a signed-in subscribe visitor with a pending trial to post-sign-in", () => {
    const page = readFileSync("src/app/subscribe/page.tsx", "utf8");
    expect(page).toContain("accountResumeNeedsPostSignIn");
    expect(page).toContain('from !== "post-sign-in"');
    expect(page).toContain("<SubscribeCheckoutPanel />");
    expect(page).toContain("APP_MEMBERSHIP_PATH");
  });
});
