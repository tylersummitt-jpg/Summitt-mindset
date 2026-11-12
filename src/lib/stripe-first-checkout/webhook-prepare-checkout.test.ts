import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  confirmMock,
  loadBindingMock,
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
  retrieveSessionMock,
  cancelSubMock,
  createSubMock,
  appleMock,
  sendMock,
} = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  loadBindingMock: vi.fn(),
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
  retrieveSessionMock: vi.fn(),
  cancelSubMock: vi.fn(),
  createSubMock: vi.fn(),
  appleMock: vi.fn(async () => ({ grantsAccess: true })),
  sendMock: vi.fn(),
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
  resolveAppleMembershipGrantForUser: () => appleMock(),
}));

vi.mock("@/lib/meta-capi-web-identifiers", () => ({
  matchFromCheckoutRequest: vi.fn(),
  saveMetaCapiWebMatchForUser: vi.fn(async () => undefined),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: (...args: unknown[]) => sendMock(...args),
    };
  },
}));

vi.mock("stripe", () => {
  class StripeMock {
    checkout = {
      sessions: {
        retrieve: (...args: unknown[]) => retrieveSessionMock(...args),
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
import { reconcileStripeFirstFromCheckoutSession } from "@/lib/stripe-first-checkout/reconcile";

const EMAIL = "member@example.com";
const PRICE = "price_monthly";
const CUTOFF = "2026-12-01T00:00:00.000Z";
const CONFIRMED_AFTER = "2026-12-02T00:00:00.000Z";

type Row = {
  id: string;
  livemode: boolean;
  stripe_checkout_session_id: string;
  stripe_trial_confirmed_at: string | null;
  binding_expires_at: string;
  clerk_user_id: string | null;
  clerk_user_provisioned_at: string | null;
  sign_in_required_at: string | null;
  session_started_at: string | null;
};

type DirectoryUser = { id: string; email: string; externalId: string };

let row: Row;
let users: DirectoryUser[];
let createCount = 0;

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    status: "trialing",
    trial_end: 1_800_000_000,
    pause_collection: null,
    livemode: false,
    cancel_at: 1_800_000_000,
    metadata: { plan: "monthly" },
    items: { data: [{ price: { id: PRICE } }] },
    ...overrides,
  };
}

function checkoutSession(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
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
  loadBindingMock.mockImplementation(async () => ({ ...row }));
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

function expectNoAuthenticationOrCancellation() {
  expect(ticketMock).not.toHaveBeenCalled();
  expect(sessionMock).not.toHaveBeenCalled();
  expect(cancelSubMock).not.toHaveBeenCalled();
  expect(createSubMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  createCount = 0;
  users = [];
  row = {
    id: "intent_1",
    livemode: false,
    stripe_checkout_session_id: "cs_1",
    stripe_trial_confirmed_at: CONFIRMED_AFTER,
    binding_expires_at: "2099-01-01T00:00:00.000Z",
    clerk_user_id: null,
    clerk_user_provisioned_at: null,
    sign_in_required_at: null,
    session_started_at: null,
  };
  process.env.STRIPE_SECRET_KEY = "sk_test_prepare";
  process.env.CLERK_SECRET_KEY = "sk_test_prepare";
  process.env.STRIPE_PRICE_ID_MONTHLY = PRICE;
  process.env.STRIPE_FIRST_PREPARE_AFTER = CUTOFF;
  delete process.env.RESEND_API_KEY;
  delete process.env.COACH_KIT_NOTIFY_EMAIL;
  sendMock.mockResolvedValue({ data: { id: "re_1" }, error: null });
  installDirectory();
  confirmMock.mockResolvedValue("saved");
  holdMock.mockResolvedValue("ok");
  retrieveSubMock.mockResolvedValue(subscription());
  retrieveSessionMock.mockResolvedValue(checkoutSession());
  updateCustomerMock.mockResolvedValue({});
  updateSubMock.mockResolvedValue({});
  ticketMock.mockResolvedValue("ticket_1");
  appleMock.mockResolvedValue({ grantsAccess: true });
});

describe("webhook preparation", () => {
  it("prepares one reserved account when the browser never returns", async () => {
    const outcome = await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never);
    expect(outcome).toBe("ack");
    expect(users).toEqual([{ id: "user_1", email: EMAIL, externalId: "intent_1" }]);
    expect(row.clerk_user_id).toBe("user_1");
    expect(row.sign_in_required_at).toBeNull();
    expect(row.session_started_at).toBeNull();
    expect(holdMock.mock.invocationCallOrder[0]).toBeLessThan(
      createUserMock.mock.invocationCallOrder[0]
    );
    expect(updateSubMock).toHaveBeenCalledWith("sub_1", {
      metadata: { userId: "user_1", plan: "monthly" },
    });
    expectNoAuthenticationOrCancellation();
  });

  it("records sign-in required for an existing account and does not link it", async () => {
    users.push({ id: "user_existing", email: EMAIL, externalId: "member-since-2019" });
    const outcome = await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never);
    expect(outcome).toBe("ack");
    expect(row.sign_in_required_at).not.toBeNull();
    expect(row.clerk_user_id).toBeNull();
    expect(users).toHaveLength(1);
    expect(updateCustomerMock).not.toHaveBeenCalled();
    expect(updateSubMock).not.toHaveBeenCalled();
    expect(appleMock).not.toHaveBeenCalled();
    const browser = await activateHostedCheckout({
      sessionId: "cs_1",
      bindingSecret: "browser-secret",
    });
    expect(browser).toEqual({ status: "sign_in_required" });
    expectNoAuthenticationOrCancellation();
  });

  it("prepares once when the same checkout is delivered twice", async () => {
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("ack");
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("ack");
    expect(users).toHaveLength(1);
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect(createSubMock).not.toHaveBeenCalled();
    expectNoAuthenticationOrCancellation();
  });

  it("lets a later webhook reuse the account the browser already prepared", async () => {
    const browser = await activateHostedCheckout({
      sessionId: "cs_1",
      bindingSecret: "browser-secret",
    });
    expect(browser).toEqual({ status: "ticket", ticket: "ticket_1" });
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("ack");
    expect(users).toHaveLength(1);
    expect(ticketMock).toHaveBeenCalledTimes(1);
    expect(createSubMock).not.toHaveBeenCalled();
    expect(cancelSubMock).not.toHaveBeenCalled();
    expect(sessionMock).not.toHaveBeenCalled();
  });

  it("lets the browser return reuse the webhook account and issue the only ticket", async () => {
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("ack");
    expect(ticketMock).not.toHaveBeenCalled();
    const browser = await activateHostedCheckout({
      sessionId: "cs_1",
      bindingSecret: "browser-secret",
    });
    expect(browser).toEqual({ status: "ticket", ticket: "ticket_1" });
    expect(ticketMock).toHaveBeenCalledTimes(1);
    expect(ticketMock).toHaveBeenCalledWith("user_1");
    expect(users).toHaveLength(1);
    expect(sessionMock).not.toHaveBeenCalled();
    expect(cancelSubMock).not.toHaveBeenCalled();
    expect(createSubMock).not.toHaveBeenCalled();
  });

  it("converges when the webhook and browser prepare the same checkout together", async () => {
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

    const [webhook, browser] = await Promise.all([
      reconcileStripeFirstFromCheckoutSession(checkoutSession() as never),
      activateHostedCheckout({ sessionId: "cs_1", bindingSecret: "browser-secret" }),
    ]);
    expect(webhook).toBe("ack");
    expect(browser).toEqual({ status: "ticket", ticket: "ticket_1" });
    expect(users).toEqual([{ id: "user_race", email: EMAIL, externalId: "intent_1" }]);
    expect(row.clerk_user_id).toBe("user_race");
    expect(ticketMock).toHaveBeenCalledTimes(1);
    expect(sessionMock).not.toHaveBeenCalled();
    expect(cancelSubMock).not.toHaveBeenCalled();
    expect(createSubMock).not.toHaveBeenCalled();
  });

  it("leaves a transient Clerk failure retryable and then prepares one user", async () => {
    createUserMock.mockRejectedValueOnce(new Error("clerk_create_failed"));
    await expect(
      reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)
    ).rejects.toThrow("clerk_create_failed");
    expect(row.clerk_user_id).toBeNull();
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("ack");
    expect(users).toHaveLength(1);
    expect(row.clerk_user_id).toBe("user_1");
    expectNoAuthenticationOrCancellation();
  });

  it("reuses the Clerk user when the Supabase acknowledgment fails", async () => {
    markProvisionedMock.mockResolvedValueOnce(false);
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("retry");
    expect(users).toHaveLength(1);
    expect(row.clerk_user_id).toBeNull();
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("ack");
    expect(users).toHaveLength(1);
    expect(row.clerk_user_id).toBe("user_1");
    expect(createSubMock).not.toHaveBeenCalled();
    expectNoAuthenticationOrCancellation();
  });

  it("reuses a user created before the Clerk request timed out", async () => {
    createUserMock.mockImplementationOnce(async (args: { email: string; externalId: string }) => {
      users.push({ id: "user_timeout", email: args.email, externalId: args.externalId });
      throw new Error("clerk_create_failed");
    });
    await expect(
      reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)
    ).rejects.toThrow("clerk_create_failed");
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("ack");
    expect(users).toEqual([{ id: "user_timeout", email: EMAIL, externalId: "intent_1" }]);
    expect(row.clerk_user_id).toBe("user_timeout");
    expectNoAuthenticationOrCancellation();
  });

  it("retries the original subscription when provider linking fails", async () => {
    updateSubMock.mockRejectedValueOnce(new Error("stripe_down"));
    await expect(
      reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)
    ).rejects.toThrow("stripe_down");
    expect(users).toHaveLength(1);
    expect(row.clerk_user_id).toBe("user_1");
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("ack");
    expect(users).toHaveLength(1);
    expect(updateSubMock).toHaveBeenCalledWith("sub_1", {
      metadata: { userId: "user_1", plan: "monthly" },
    });
    expect(createSubMock).not.toHaveBeenCalled();
    expect(cancelSubMock).not.toHaveBeenCalled();
  });

  it("does not provision an ineligible subscription", async () => {
    retrieveSubMock.mockResolvedValue(subscription({ status: "canceled", trial_end: null }));
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("ack");
    expect(confirmMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
    expect(updateCustomerMock).not.toHaveBeenCalled();

    retrieveSubMock.mockResolvedValue(
      subscription({ items: { data: [{ price: { id: "price_unknown" } }] } })
    );
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("ack");
    expect(createUserMock).not.toHaveBeenCalled();
    expectNoAuthenticationOrCancellation();
  });

  it("does not prepare an account when the activation hold preserves a cancellation", async () => {
    holdMock.mockResolvedValue("preserved");
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("ack");
    expect(holdMock).toHaveBeenCalledWith("intent_1");
    expect(createUserMock).not.toHaveBeenCalled();
    expect(updateCustomerMock).not.toHaveBeenCalled();
    expect(updateSubMock).not.toHaveBeenCalled();
    expect(users).toHaveLength(0);
    expectNoAuthenticationOrCancellation();
  });
});

describe("shared activation cutoff", () => {
  it("does not prepare when the cutoff is missing, blank, or invalid", async () => {
    delete process.env.STRIPE_FIRST_PREPARE_AFTER;
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("ack");
    process.env.STRIPE_FIRST_PREPARE_AFTER = "   ";
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("ack");
    process.env.STRIPE_FIRST_PREPARE_AFTER = "2026-12-01T00:00:00-05:00";
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("ack");
    expect(createUserMock).not.toHaveBeenCalled();
    expect(holdMock).toHaveBeenCalledTimes(3);
    expect(confirmMock).toHaveBeenCalledTimes(3);
    expectNoAuthenticationOrCancellation();
  });

  it("does not prepare a trial confirmed before or exactly at the cutoff", async () => {
    row = { ...row, stripe_trial_confirmed_at: "2026-11-09T15:52:37.000Z" };
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("ack");
    row = { ...row, stripe_trial_confirmed_at: CUTOFF };
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("ack");
    expect(createUserMock).not.toHaveBeenCalled();
    expect(holdMock).toHaveBeenCalledTimes(2);
    expectNoAuthenticationOrCancellation();
  });

  it("prepares a trial confirmed after the cutoff through the shared function", async () => {
    row = { ...row, stripe_trial_confirmed_at: "2026-12-01T00:00:00.001Z" };
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("ack");
    expect(users).toEqual([
      { id: "user_1", email: EMAIL, externalId: "intent_1" },
    ]);
    expect(holdMock).toHaveBeenCalledTimes(1);
    expectNoAuthenticationOrCancellation();
  });

  it("retries when the cutoff is set but the persisted confirmation time is missing", async () => {
    row = { ...row, stripe_trial_confirmed_at: null };
    expect(await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never)).toBe("retry");
    expect(createUserMock).not.toHaveBeenCalled();
    expect(holdMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the browser return and recovery path independent of the cutoff", async () => {
    delete process.env.STRIPE_FIRST_PREPARE_AFTER;
    const browser = await activateHostedCheckout({
      sessionId: "cs_1",
      bindingSecret: "browser-secret",
    });
    expect(browser).toEqual({ status: "ticket", ticket: "ticket_1" });
    expect(createUserMock).toHaveBeenCalledTimes(1);

    const source = readFileSync("src/lib/stripe-first-checkout/activate.ts", "utf8");
    const browserSource = source.slice(
      source.indexOf("export async function activateHostedCheckout"),
      source.indexOf("export async function confirmHostedSession")
    );
    const recoverySource = source.slice(
      source.indexOf("export async function resumeExistingAccountActivation")
    );
    expect(browserSource).toContain("provisionNewCustomer");
    expect(browserSource).not.toContain("readPrepareAfterCutoff");
    expect(recoverySource).not.toContain("prepareConfirmedCheckout");
    expect(recoverySource).not.toContain("readPrepareAfterCutoff");
    expect(recoverySource).not.toContain("createReservedClerkUser");
  });

  it("prepares once when the staff email fails and the same checkout is delivered again", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.COACH_KIT_NOTIFY_EMAIL = "coach@example.com";
    sendMock.mockResolvedValueOnce({ data: null, error: { message: "timeout" } });

    const first = await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never);
    const second = await reconcileStripeFirstFromCheckoutSession(checkoutSession() as never);

    expect(first).toBe("retry");
    expect(second).toBe("ack");
    expect(users).toEqual([{ id: "user_1", email: EMAIL, externalId: "intent_1" }]);
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls.map((call) => call[1])).toEqual([
      { idempotencyKey: "stripe-first-member-sub_1" },
      { idempotencyKey: "stripe-first-member-sub_1" },
    ]);
    expect(updateSubMock).toHaveBeenCalledWith("sub_1", {
      metadata: { userId: "user_1", plan: "monthly" },
    });
    expect(row.session_started_at).toBeNull();
    expectNoAuthenticationOrCancellation();
  });
});
