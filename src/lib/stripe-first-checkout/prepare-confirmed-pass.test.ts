import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadEligibleMock,
  loadIdMock,
  markClosedMock,
  loadBindingMock,
  confirmMock,
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
  retrieveSessionMock,
  cancelSubMock,
  createSubMock,
} = vi.hoisted(() => ({
  loadEligibleMock: vi.fn(),
  loadIdMock: vi.fn(),
  markClosedMock: vi.fn(),
  loadBindingMock: vi.fn(),
  confirmMock: vi.fn(),
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
  retrieveSessionMock: vi.fn(),
  cancelSubMock: vi.fn(),
  createSubMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("@/lib/acquisition/store", () => ({
  noteAcquisitionTrial: vi.fn(async () => undefined),
  noteAcquisitionClerk: vi.fn(async () => undefined),
}));

vi.mock("@/lib/acquisition/email-acquired-member-notice.server", () => ({
  maybeNotifyEmailAcquiredMember: vi.fn(async () => "skipped"),
  verifiedAcquisitionJourneyId: vi.fn(async () => null),
}));

vi.mock("@/lib/marketing-account-link", () => ({
  linkMarketingVisitorToClerkUser: vi.fn(async () => undefined),
}));

vi.mock("@/lib/meta-capi-stripe-conversions", () => ({
  maybeEmitMetaStartTrialFromCheckout: vi.fn(async () => undefined),
  metaStartTrialEventUnix: () => 1_700_000_000,
}));

vi.mock("@/lib/google-ads/stripe-conversions", () => ({
  maybeEmitGoogleAdsTrial: vi.fn(async () => undefined),
}));

vi.mock("@/lib/stripe-first-checkout/intent-store", () => ({
  alignBindingExpiry: vi.fn(),
  attachCheckoutSession: vi.fn(),
  confirmStripeTrial: (...args: unknown[]) => confirmMock(...args),
  deleteUnstartedLiveIntent: vi.fn(),
  insertCheckoutIntent: vi.fn(),
  liveCanaryIntentExists: vi.fn(),
  loadConfirmedIntentsForEmail: vi.fn(async () => []),
  loadIntentByBindingHash: (...args: unknown[]) => loadBindingMock(...args),
  loadIntentById: (...args: unknown[]) => loadIdMock(...args),
  loadIntentBySubscriptionId: vi.fn(async () => null),
  loadPrepareEligibleIntents: (...args: unknown[]) => loadEligibleMock(...args),
  markPrepareClosed: (...args: unknown[]) => markClosedMock(...args),
  holdView: (row: {
    session_started_at: string | null;
    hold_confirmed_at?: string | null;
    hold_released_at: string | null;
    stripe_trial_confirmed_at: string | null;
    stripe_hold_cancel_at: string | null;
  }) => ({
    sessionStarted: row.session_started_at != null,
    holdConfirmed: row.hold_confirmed_at != null,
    holdReleased: row.hold_released_at != null,
    trialConfirmed: row.stripe_trial_confirmed_at != null,
    storedHoldCancelAtUnix: row.stripe_hold_cancel_at
      ? Math.floor(Date.parse(row.stripe_hold_cancel_at) / 1000)
      : null,
  }),
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
  subscriptionHoldView: (sub: {
    status: string;
    cancel_at: number | null;
    cancel_at_period_end?: boolean;
    trial_end: number | null;
    pause_collection: unknown;
  }) => ({
    status: sub.status,
    cancelAt: sub.cancel_at,
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    trialEnd: sub.trial_end,
    paused: sub.pause_collection != null,
  }),
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
  resolveAppleMembershipGrantForUser: vi.fn(async () => ({ grantsAccess: true })),
}));

vi.mock("@/lib/meta-capi-web-identifiers", () => ({
  matchFromCheckoutRequest: vi.fn(),
  saveMetaCapiWebMatchForUser: vi.fn(async () => undefined),
}));

vi.mock("stripe", () => {
  class StripeMock {
    checkout = {
      sessions: {
        retrieve: (...args: unknown[]) => retrieveSessionMock(...args),
        create: vi.fn(),
      },
    };
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

import { activateHostedCheckout } from "@/lib/stripe-first-checkout/activate";
import { runConfirmedCheckoutPreparationPass } from "@/lib/stripe-first-checkout/prepare-confirmed-pass";
import { reconcileStripeFirstFromCheckoutSession } from "@/lib/stripe-first-checkout/reconcile";
import type { CheckoutBrowserIntent } from "@/lib/stripe-first-checkout/intent-store";

const EMAIL = "member@example.com";
const PRICE = "price_monthly";
const CUTOFF = "2026-12-01T00:00:00.000Z";
const NOW_MS = Date.parse("2026-12-01T12:00:00.000Z");
const TRIAL_END_UNIX = Date.parse("2026-12-20T00:00:00.000Z") / 1000;

type Row = CheckoutBrowserIntent;
type DirectoryUser = { id: string; email: string; externalId: string };

let rows: Map<string, Row>;
let users: DirectoryUser[];
let createCount = 0;
let subscription: {
  id: string;
  status: string;
  trial_end: number | null;
  cancel_at: number | null;
  cancel_at_period_end: boolean;
  pause_collection: { behavior: string } | null;
  livemode: boolean;
  metadata: { plan: string; summittCanary?: string };
  items: { data: Array<{ price: { id: string } }> };
};

function row(id = "intent_1", overrides: Partial<Row> = {}): Row {
  return {
    id,
    livemode: false,
    email: EMAIL,
    stripe_checkout_session_id: "cs_1",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    stripe_trial_end_at: "2026-12-20T00:00:00.000Z",
    stripe_trial_confirmed_at: "2026-12-01T00:00:01.000Z",
    stripe_hold_cancel_at: null,
    clerk_user_id: null,
    clerk_user_provisioned_at: null,
    sign_in_required_at: null,
    session_started_at: null,
    hold_released_at: null,
    prepare_closed_at: null,
    binding_expires_at: "2099-01-01T00:00:00.000Z",
    binding_hash: "hash_1",
    ...overrides,
  } as Row;
}

function checkoutSession() {
  return {
    id: "cs_1",
    status: "complete",
    payment_status: "paid",
    mode: "subscription",
    livemode: false,
    subscription: "sub_1",
    customer: "cus_1",
    customer_details: { email: EMAIL, name: "Member", phone: null },
    customer_email: null,
    metadata: { checkoutIntentId: "intent_1" },
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
  loadIdMock.mockImplementation(async (id: string) => {
    const found = rows.get(id);
    return found ? { ...found } : null;
  });
  loadBindingMock.mockImplementation(async () => {
    const found = rows.get("intent_1");
    return found ? { ...found } : null;
  });
  markProvisionedMock.mockImplementation(async (args: { intentId: string; clerkUserId: string }) => {
    const current = rows.get(args.intentId);
    if (
      !current ||
      current.clerk_user_id ||
      current.clerk_user_provisioned_at ||
      current.sign_in_required_at
    ) {
      return false;
    }
    rows.set(args.intentId, {
      ...current,
      clerk_user_id: args.clerkUserId,
      clerk_user_provisioned_at: "2026-12-01T12:00:00.000Z",
    });
    return true;
  });
  markSignInMock.mockImplementation(async (intentId: string) => {
    const current = rows.get(intentId);
    if (
      !current ||
      current.sign_in_required_at ||
      current.clerk_user_id ||
      current.clerk_user_provisioned_at
    ) {
      return false;
    }
    rows.set(intentId, {
      ...current,
      sign_in_required_at: "2026-12-01T12:00:00.000Z",
    });
    return true;
  });
  markClosedMock.mockImplementation(async (intentId: string) => {
    const current = rows.get(intentId);
    if (
      !current ||
      current.prepare_closed_at ||
      current.clerk_user_provisioned_at ||
      current.sign_in_required_at ||
      current.clerk_user_id ||
      current.session_started_at ||
      current.hold_released_at ||
      !current.stripe_trial_confirmed_at ||
      !current.stripe_subscription_id ||
      !current.stripe_checkout_session_id
    ) {
      return false;
    }
    rows.set(intentId, {
      ...current,
      prepare_closed_at: "2026-12-01T12:00:00.000Z",
    });
    return true;
  });
}

function expectNoCronAuthority() {
  expect(ticketMock).not.toHaveBeenCalled();
  expect(sessionMock).not.toHaveBeenCalled();
  expect(cancelSubMock).not.toHaveBeenCalled();
  expect(createSubMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  createCount = 0;
  users = [];
  rows = new Map([["intent_1", row()]]);
  subscription = {
    id: "sub_1",
    status: "trialing",
    trial_end: TRIAL_END_UNIX,
    cancel_at: null,
    cancel_at_period_end: false,
    pause_collection: null,
    livemode: false,
    metadata: { plan: "monthly" },
    items: { data: [{ price: { id: PRICE } }] },
  };
  process.env.STRIPE_SECRET_KEY = "sk_test_prepare";
  process.env.CLERK_SECRET_KEY = "sk_test_prepare";
  process.env.STRIPE_PRICE_ID_MONTHLY = PRICE;
  process.env.STRIPE_FIRST_PREPARE_AFTER = CUTOFF;
  delete process.env.RESEND_API_KEY;
  installDirectory();
  confirmMock.mockResolvedValue("saved");
  loadEligibleMock.mockImplementation(async () => [...rows.values()]);
  holdMock.mockImplementation(async () => {
    subscription.cancel_at = subscription.trial_end;
    return "ok";
  });
  retrieveSubMock.mockImplementation(async () => ({ ...subscription }));
  retrieveSessionMock.mockResolvedValue(checkoutSession());
  updateCustomerMock.mockResolvedValue({});
  updateSubMock.mockResolvedValue({});
  ticketMock.mockResolvedValue("ticket_1");
});

describe("automatic preparation pass", () => {
  it("selects nothing when the cutoff is missing or invalid", async () => {
    delete process.env.STRIPE_FIRST_PREPARE_AFTER;
    await expect(runConfirmedCheckoutPreparationPass(NOW_MS)).resolves.toMatchObject({
      examined: 0,
    });
    process.env.STRIPE_FIRST_PREPARE_AFTER = "2026-12-01T00:00:00-05:00";
    await expect(runConfirmedCheckoutPreparationPass(NOW_MS)).resolves.toMatchObject({
      examined: 0,
    });
    expect(loadEligibleMock).not.toHaveBeenCalled();
    expectNoCronAuthority();
  });

  it("prepares one reserved account after the hold is installed", async () => {
    const result = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(result).toMatchObject({ examined: 1, prepared: 1, retry: 0 });
    expect(users).toEqual([{ id: "user_1", email: EMAIL, externalId: "intent_1" }]);
    expect(rows.get("intent_1")?.clerk_user_id).toBe("user_1");
    expect(holdMock.mock.invocationCallOrder[0]).toBeLessThan(
      createUserMock.mock.invocationCallOrder[0]
    );
    expect(updateSubMock).toHaveBeenCalledWith("sub_1", {
      metadata: { userId: "user_1", plan: "monthly" },
    });
    expect(updateSubMock.mock.calls.every((call) => call[1].trial_end == null)).toBe(true);
    expectNoCronAuthority();
  });

  it("does not prepare when the hold reconcile does not install protection", async () => {
    holdMock.mockImplementation(async () => "ok");
    const result = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(result).toMatchObject({ examined: 1, prepared: 0, retry: 1 });
    expect(createUserMock).not.toHaveBeenCalled();
    expectNoCronAuthority();
  });

  it("leaves a Clerk failure eligible and then reuses the created user", async () => {
    createUserMock.mockRejectedValueOnce(new Error("clerk_create_failed"));
    const first = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(first).toMatchObject({ retry: 1, prepared: 0 });
    expect(rows.get("intent_1")?.clerk_user_id).toBeNull();

    const second = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(second).toMatchObject({ prepared: 1 });
    expect(users).toHaveLength(1);
    expect(rows.get("intent_1")?.clerk_user_id).toBe("user_1");
    expectNoCronAuthority();
  });

  it("reuses the Clerk user when the Supabase acknowledgment fails", async () => {
    markProvisionedMock.mockResolvedValueOnce(false);
    const first = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(first).toMatchObject({ retry: 1 });
    expect(users).toHaveLength(1);
    expect(rows.get("intent_1")?.clerk_user_id).toBeNull();
    const second = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(second).toMatchObject({ prepared: 1 });
    expect(users).toHaveLength(1);
    expect(rows.get("intent_1")?.clerk_user_id).toBe("user_1");
    expectNoCronAuthority();
  });

  it("reuses a user created before the Clerk request timed out", async () => {
    createUserMock.mockImplementationOnce(async (args: { email: string; externalId: string }) => {
      users.push({ id: "user_timeout", email: args.email, externalId: args.externalId });
      throw new Error("clerk_create_failed");
    });
    await expect(runConfirmedCheckoutPreparationPass(NOW_MS)).resolves.toMatchObject({ retry: 1 });
    await expect(runConfirmedCheckoutPreparationPass(NOW_MS)).resolves.toMatchObject({
      prepared: 1,
    });
    expect(users).toEqual([{ id: "user_timeout", email: EMAIL, externalId: "intent_1" }]);
    expect(rows.get("intent_1")?.clerk_user_id).toBe("user_timeout");
    expectNoCronAuthority();
  });

  it("lets two overlapping passes converge on one account", async () => {
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
      runConfirmedCheckoutPreparationPass(NOW_MS),
      runConfirmedCheckoutPreparationPass(NOW_MS),
    ]);
    expect(first.prepared + second.prepared).toBeGreaterThan(0);
    expect(users).toEqual([{ id: "user_race", email: EMAIL, externalId: "intent_1" }]);
    expect(ticketMock).not.toHaveBeenCalled();
    expect(cancelSubMock).not.toHaveBeenCalled();
    expect(createSubMock).not.toHaveBeenCalled();
  });

  it("converges when two passes and the webhook prepare the same intent", async () => {
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

    const [firstPass, webhook] = await Promise.all([
      runConfirmedCheckoutPreparationPass(NOW_MS),
      reconcileStripeFirstFromCheckoutSession(checkoutSession() as never),
    ]);
    const secondPass = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(webhook).toBe("ack");
    expect(firstPass.prepared + secondPass.prepared).toBeGreaterThan(0);
    expect(users).toEqual([{ id: "user_race", email: EMAIL, externalId: "intent_1" }]);
    expect(rows.get("intent_1")?.clerk_user_id).toBe("user_race");
    expect(ticketMock).not.toHaveBeenCalled();
    expect(cancelSubMock).not.toHaveBeenCalled();
    expect(createSubMock).not.toHaveBeenCalled();
  });

  it("lets the browser issue the only ticket while the cron prepares the same account", async () => {
    const [pass, browser] = await Promise.all([
      runConfirmedCheckoutPreparationPass(NOW_MS),
      activateHostedCheckout({ sessionId: "cs_1", bindingSecret: "browser-secret" }),
    ]);
    expect(pass.prepared + (browser.status === "ticket" ? 1 : 0)).toBeGreaterThan(0);
    expect(users).toHaveLength(1);
    expect(ticketMock.mock.calls.length).toBeLessThanOrEqual(1);
    if (browser.status === "ticket") {
      expect(ticketMock).toHaveBeenCalledTimes(1);
    }
    expect(sessionMock).not.toHaveBeenCalled();
    expect(cancelSubMock).not.toHaveBeenCalled();
    expect(createSubMock).not.toHaveBeenCalled();
  });

  it("records sign-in required for an existing account and does not link it", async () => {
    users.push({ id: "user_existing", email: EMAIL, externalId: "member-since-2019" });
    const result = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(result).toMatchObject({ signInRequired: 1, prepared: 0 });
    expect(rows.get("intent_1")?.sign_in_required_at).not.toBeNull();
    expect(rows.get("intent_1")?.clerk_user_id).toBeNull();
    expect(updateCustomerMock).not.toHaveBeenCalled();
    expect(updateSubMock).not.toHaveBeenCalled();
    expect(users).toHaveLength(1);
    expectNoCronAuthority();
  });

  it("skips an intent that is already prepared", async () => {
    rows.set(
      "intent_1",
      row("intent_1", {
        clerk_user_id: "user_ready",
        clerk_user_provisioned_at: "2026-12-01T11:00:00.000Z",
      })
    );
    const result = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(result).toMatchObject({ examined: 1, prepared: 0, retry: 0 });
    expect(createUserMock).not.toHaveBeenCalled();
    expect(holdMock).not.toHaveBeenCalled();
    expectNoCronAuthority();
  });

  it("preserves a customer cancellation and does not revive an expired trial", async () => {
    subscription.cancel_at = TRIAL_END_UNIX + 3600;
    holdMock.mockResolvedValue("preserved");
    const canceled = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(canceled).toMatchObject({ preserved: 1, prepared: 0 });
    expect(rows.get("intent_1")?.prepare_closed_at).toBeTruthy();
    expect(createUserMock).not.toHaveBeenCalled();
    expect(updateSubMock).not.toHaveBeenCalled();
    expectNoCronAuthority();

    subscription.status = "trialing";
    subscription.trial_end = Math.floor(NOW_MS / 1000) - 60;
    holdMock.mockClear();
    const expired = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(expired).toMatchObject({ prepared: 0, retry: 0, preserved: 0 });
    expect(holdMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
    expect(updateSubMock).not.toHaveBeenCalled();
    expectNoCronAuthority();
  });

  it("continues to the next intent when the first provider call fails", async () => {
    rows.set("intent_1", row("intent_1"));
    rows.set(
      "intent_2",
      row("intent_2", {
        email: "second@example.com",
        stripe_subscription_id: "sub_2",
        stripe_customer_id: "cus_2",
        stripe_checkout_session_id: "cs_2",
      })
    );
    retrieveSessionMock.mockImplementation(async (sessionId: string) => ({
      ...checkoutSession(),
      id: sessionId,
      subscription: sessionId === "cs_2" ? "sub_2" : "sub_1",
      customer: sessionId === "cs_2" ? "cus_2" : "cus_1",
      customer_details: {
        email: sessionId === "cs_2" ? "second@example.com" : EMAIL,
        name: "Member",
        phone: null,
      },
      metadata: { checkoutIntentId: sessionId === "cs_2" ? "intent_2" : "intent_1" },
    }));
    retrieveSubMock.mockImplementation(async (subscriptionId: string) => ({
      ...subscription,
      id: subscriptionId,
      cancel_at: subscription.cancel_at,
    }));
    createUserMock.mockImplementation(async (args: { email: string; externalId: string }) => {
      if (args.externalId === "intent_1") throw new Error("clerk_down");
      users.push({ id: "user_second", email: args.email, externalId: args.externalId });
      return { id: "user_second" };
    });

    const result = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(result).toMatchObject({ examined: 2, prepared: 1, retry: 1 });
    expect(rows.get("intent_2")?.clerk_user_id).toBe("user_second");
    expect(rows.get("intent_1")?.clerk_user_id).toBeNull();
    expectNoCronAuthority();
  });

  it("does not issue a ticket, start a session, or cancel from the pass", () => {
    const pass = readFileSync(
      "src/lib/stripe-first-checkout/prepare-confirmed-pass.ts",
      "utf8"
    );
    const route = readFileSync("src/app/api/cron/recovery/route.ts", "utf8");
    expect(pass).toContain("prepareConfirmedCheckout");
    expect(pass).toContain("reconcileActivationHold");
    expect(pass).toContain("markPrepareClosed");
    expect(pass).not.toContain("createClerkSignInTicket");
    expect(pass).not.toContain("markSessionStarted");
    expect(pass).not.toContain("markHoldReleased");
    expect(pass).not.toContain("subscriptions.cancel");
    expect(pass).not.toContain("checkout.sessions.create");
    expect(route).toContain("runConfirmedCheckoutPreparationPass");
    expect(route).toContain("alertStrandedNewCustomerTrials");
    expect(route).not.toContain("createClerkSignInTicket");
  });
});

describe("terminal preparation closure", () => {
  function openPage() {
    const nowIso = new Date(NOW_MS).toISOString();
    return [...rows.values()]
      .filter(
        (item) =>
          item.prepare_closed_at == null &&
          item.stripe_trial_confirmed_at != null &&
          item.stripe_trial_confirmed_at > CUTOFF &&
          item.stripe_trial_end_at != null &&
          item.stripe_trial_end_at > nowIso &&
          item.stripe_subscription_id != null &&
          item.stripe_checkout_session_id != null &&
          item.clerk_user_provisioned_at == null &&
          item.sign_in_required_at == null &&
          item.session_started_at == null &&
          item.hold_released_at == null
      )
      .sort((left, right) =>
        String(left.stripe_trial_confirmed_at).localeCompare(String(right.stripe_trial_confirmed_at))
      )
      .slice(0, 10);
  }

  function seedClosedPrefix(closedCount: number) {
    rows = new Map();
    const subscriptions = new Map<string, Record<string, unknown>>();
    for (let index = 0; index < closedCount; index += 1) {
      const id = `closed_${String(index).padStart(2, "0")}`;
      rows.set(
        id,
        row(id, {
          email: `closed${index}@example.com`,
          stripe_checkout_session_id: `cs_${id}`,
          stripe_customer_id: `cus_${id}`,
          stripe_subscription_id: `sub_${id}`,
          stripe_trial_confirmed_at: `2026-12-02T00:00:${String(index).padStart(2, "0")}.000Z`,
        })
      );
      subscriptions.set(`sub_${id}`, {
        ...subscription,
        id: `sub_${id}`,
        status: "canceled",
        cancel_at: null,
      });
    }
    rows.set(
      "valid",
      row("valid", {
        email: "valid@example.com",
        stripe_checkout_session_id: "cs_valid",
        stripe_customer_id: "cus_valid",
        stripe_subscription_id: "sub_valid",
        stripe_trial_confirmed_at: "2026-12-03T00:00:00.000Z",
      })
    );
    subscriptions.set("sub_valid", {
      ...subscription,
      id: "sub_valid",
      status: "trialing",
      cancel_at: TRIAL_END_UNIX,
    });
    loadEligibleMock.mockImplementation(async () => openPage());
    retrieveSessionMock.mockImplementation(async (sessionId: string) => {
      const intent = [...rows.values()].find(
        (item) => item.stripe_checkout_session_id === sessionId
      );
      return {
        ...checkoutSession(),
        id: sessionId,
        subscription: intent?.stripe_subscription_id,
        customer: intent?.stripe_customer_id,
        customer_details: { email: intent?.email ?? EMAIL, name: "Member", phone: null },
        metadata: { checkoutIntentId: intent?.id },
      };
    });
    retrieveSubMock.mockImplementation(async (subscriptionId: string) => ({
      ...(subscriptions.get(subscriptionId) ?? subscription),
    }));
    holdMock.mockResolvedValue("ok");
  }

  it("closes ten canceled intents and prepares the eleventh on the next pass", async () => {
    seedClosedPrefix(10);
    const first = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(first).toMatchObject({ examined: 10, preserved: 10, prepared: 0 });
    expect(openPage().map((item) => item.id)).toEqual(["valid"]);
    expect(createUserMock).not.toHaveBeenCalled();

    const second = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(second).toMatchObject({ examined: 1, prepared: 1, preserved: 0 });
    expect(rows.get("valid")?.clerk_user_id).toBe("user_1");
    expect(rows.get("valid")?.prepare_closed_at).toBeNull();
    expect(users).toEqual([{ id: "user_1", email: "valid@example.com", externalId: "valid" }]);
    expectNoCronAuthority();
  });

  it("moves past more terminal rows than one provider budget", async () => {
    seedClosedPrefix(15);
    const first = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(first).toMatchObject({ examined: 10, preserved: 10, prepared: 0 });
    const remaining = openPage();
    expect(remaining[0]?.id).toBe("closed_10");
    expect(remaining.at(-1)?.id).toBe("valid");

    const second = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(second).toMatchObject({ examined: 6, preserved: 5, prepared: 1 });
    expect(rows.get("valid")?.clerk_user_id).toBe("user_1");
    expect([...rows.values()].filter((item) => item.id.startsWith("closed_")).every(
      (item) => item.prepare_closed_at != null
    )).toBe(true);
    expectNoCronAuthority();
  });

  it("does not close a transient provider failure or an ambiguous owner", async () => {
    retrieveSessionMock.mockRejectedValue(new Error("stripe down"));
    const stripeDown = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(stripeDown).toMatchObject({ retry: 1, preserved: 0 });
    expect(rows.get("intent_1")?.prepare_closed_at).toBeNull();

    retrieveSessionMock.mockResolvedValue(checkoutSession());
    createUserMock.mockRejectedValue(new Error("clerk down"));
    const clerkDown = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(clerkDown).toMatchObject({ retry: 1, preserved: 0 });
    expect(rows.get("intent_1")?.prepare_closed_at).toBeNull();

    createUserMock.mockResolvedValue({ conflict: true });
    lookupExternalMock.mockResolvedValue(null);
    lookupEmailMock.mockResolvedValue([]);
    const ambiguous = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(ambiguous).toMatchObject({ retry: 1, preserved: 0 });
    expect(rows.get("intent_1")?.prepare_closed_at).toBeNull();
    expect(rows.get("intent_1")?.sign_in_required_at).toBeNull();
    expectNoCronAuthority();
  });

  it("marks an existing email sign-in required and leaves a prepared row open", async () => {
    users.push({ id: "user_existing", email: EMAIL, externalId: "member-since-2019" });
    const existing = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(existing).toMatchObject({ signInRequired: 1, prepared: 0 });
    expect(rows.get("intent_1")?.sign_in_required_at).toBeTruthy();
    expect(rows.get("intent_1")?.prepare_closed_at).toBeNull();
    expect(createUserMock).not.toHaveBeenCalled();

    rows.set(
      "intent_1",
      row("intent_1", {
        clerk_user_id: "user_ready",
        clerk_user_provisioned_at: "2026-12-01T11:00:00.000Z",
      })
    );
    loadEligibleMock.mockImplementation(async () => openPage());
    const prepared = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(prepared).toMatchObject({ examined: 0, prepared: 0 });
    expect(rows.get("intent_1")?.prepare_closed_at).toBeNull();
    expectNoCronAuthority();
  });

  it("lets one closure win and does not overwrite a browser provision", async () => {
    subscription.status = "canceled";
    const [first, second] = await Promise.all([
      runConfirmedCheckoutPreparationPass(NOW_MS),
      runConfirmedCheckoutPreparationPass(NOW_MS),
    ]);
    expect(first.preserved + second.preserved).toBeGreaterThan(0);
    expect(rows.get("intent_1")?.prepare_closed_at).toBeTruthy();
    expect(users).toHaveLength(0);

    rows.set("intent_1", row("intent_1"));
    retrieveSubMock.mockImplementation(async () => {
      const current = rows.get("intent_1");
      if (current && !current.clerk_user_id) {
        rows.set("intent_1", {
          ...current,
          clerk_user_id: "user_browser",
          clerk_user_provisioned_at: "2026-12-01T12:00:01.000Z",
        });
      }
      return { ...subscription, status: "canceled" };
    });
    const raced = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(raced.prepared).toBe(0);
    expect(rows.get("intent_1")?.clerk_user_id).toBe("user_browser");
    expect(rows.get("intent_1")?.prepare_closed_at).toBeNull();
    expectNoCronAuthority();
  });

  it("does not close a paused, unknown-price, pre-cutoff, or expired trial", async () => {
    subscription.pause_collection = { behavior: "keep_as_draft" };
    const paused = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(paused).toMatchObject({ prepared: 0, preserved: 0 });
    expect(rows.get("intent_1")?.prepare_closed_at).toBeNull();

    subscription.pause_collection = null;
    subscription.items = { data: [{ price: { id: "price_unknown" } }] };
    const unknownPrice = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(unknownPrice).toMatchObject({ prepared: 0, preserved: 0 });
    expect(rows.get("intent_1")?.prepare_closed_at).toBeNull();

    subscription.items = { data: [{ price: { id: PRICE } }] };
    rows.set(
      "intent_1",
      row("intent_1", { stripe_trial_confirmed_at: "2026-11-09T15:52:37.000Z" })
    );
    retrieveSubMock.mockClear();
    retrieveSessionMock.mockClear();
    const historical = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(historical).toMatchObject({ prepared: 0, preserved: 0, retry: 0 });
    expect(rows.get("intent_1")?.prepare_closed_at).toBeNull();
    expect(retrieveSubMock).not.toHaveBeenCalled();

    rows.set("intent_1", row("intent_1"));
    subscription.trial_end = Math.floor(NOW_MS / 1000) - 60;
    const expired = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(expired).toMatchObject({ prepared: 0, preserved: 0, retry: 0 });
    expect(rows.get("intent_1")?.prepare_closed_at).toBeNull();
    expect(updateSubMock).not.toHaveBeenCalled();
    expectNoCronAuthority();
  });

  it("closes a canceled-equivalent incomplete subscription and an owner-canary rejection", async () => {
    subscription.status = "incomplete_expired";
    const ended = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(ended).toMatchObject({ preserved: 1, prepared: 0 });
    expect(rows.get("intent_1")?.prepare_closed_at).toBeTruthy();
    expect(createUserMock).not.toHaveBeenCalled();

    rows.set("intent_1", row("intent_1"));
    subscription.status = "trialing";
    subscription.metadata = { plan: "monthly", summittCanary: "owner" };
    users.push({ id: "user_owner", email: EMAIL, externalId: "owner-account" });
    const canary = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(canary).toMatchObject({ preserved: 1, prepared: 0, signInRequired: 0 });
    expect(rows.get("intent_1")?.prepare_closed_at).toBeTruthy();
    expect(rows.get("intent_1")?.sign_in_required_at).toBeNull();
    expect(rows.get("intent_1")?.clerk_user_id).toBeNull();
    expectNoCronAuthority();
  });

  it("keeps ten transient failures ahead of a later valid checkout", async () => {
    seedClosedPrefix(10);
    retrieveSessionMock.mockRejectedValue(new Error("stripe down"));
    const blocked = await runConfirmedCheckoutPreparationPass(NOW_MS);
    expect(blocked).toMatchObject({ examined: 10, retry: 10, prepared: 0, preserved: 0 });
    expect([...rows.values()].every((item) => item.prepare_closed_at == null)).toBe(true);
    expect(rows.get("valid")?.clerk_user_id).toBeNull();
    const stillBlocked = openPage();
    expect(stillBlocked).toHaveLength(10);
    expect(stillBlocked.some((item) => item.id === "valid")).toBe(false);
  });
});
