import { beforeEach, describe, expect, it, vi } from "vitest";

const notifyMock = vi.fn();
const assessMock = vi.fn();
const confirmMock = vi.fn();
const loadBindingMock = vi.fn();
const loadIdMock = vi.fn();
const holdMock = vi.fn();
const createUserMock = vi.fn();
const ticketMock = vi.fn();
const lookupExternalMock = vi.fn();
const lookupEmailMock = vi.fn();
const markProvisionedMock = vi.fn();
const retrieveSessionMock = vi.fn();
const updateCustomerMock = vi.fn();
const updateSubMock = vi.fn();
const retrieveSubMock = vi.fn();

vi.mock("@/lib/stripe-first-checkout/member-notify", () => ({
  isOwnerCanaryMetadata: (metadata: { summittCanary?: string } | null | undefined) =>
    metadata?.summittCanary === "owner",
  notifyConfirmedStripeFirstTrial: (...args: unknown[]) => notifyMock(...args),
}));

vi.mock("@/lib/stripe-first-checkout/intent-store", () => ({
  alignBindingExpiry: vi.fn(),
  attachCheckoutSession: vi.fn(),
  confirmStripeTrial: (...args: unknown[]) => confirmMock(...args),
  deleteUnstartedLiveIntent: vi.fn(),
  insertCheckoutIntent: vi.fn(),
  liveCanaryIntentExists: vi.fn(),
  loadIntentByBindingHash: (...args: unknown[]) => loadBindingMock(...args),
  loadIntentById: (...args: unknown[]) => loadIdMock(...args),
  loadIntentBySubscriptionId: vi.fn(async () => null),
  markClerkProvisioned: (...args: unknown[]) => markProvisionedMock(...args),
  markSessionStartedForExistingUser: vi.fn(),
  markSessionStartedForProvisionedUser: vi.fn(),
  markSignInRequired: vi.fn(),
}));

vi.mock("@/lib/stripe-first-checkout/reconcile", () => ({
  assessCheckoutSession: (...args: unknown[]) => assessMock(...args),
  readCheckoutIntentId: (metadata: { checkoutIntentId?: string } | null | undefined) => {
    const value = metadata?.checkoutIntentId;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  },
}));

vi.mock("@/lib/stripe-first-checkout/stripe-hold", () => ({
  reconcileActivationHold: (...args: unknown[]) => holdMock(...args),
}));

vi.mock("@/lib/stripe-first-checkout/clerk-provision", () => ({
  createClerkSignInTicket: (...args: unknown[]) => ticketMock(...args),
  createReservedClerkUser: (...args: unknown[]) => createUserMock(...args),
  lookupClerkUserIdByExternalId: (...args: unknown[]) => lookupExternalMock(...args),
  lookupClerkUserIdsByEmail: (...args: unknown[]) => lookupEmailMock(...args),
}));

vi.mock("@/lib/clerk-public-metadata", () => ({
  updateClerkPublicMetadata: vi.fn(async () => undefined),
}));

vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: vi.fn(async () => ({})),
}));

vi.mock("@/lib/marketing-account-link", () => ({
  linkMarketingVisitorToClerkUser: vi.fn(async () => undefined),
}));

vi.mock("@/lib/meta-capi-web-identifiers", () => ({
  matchFromCheckoutRequest: vi.fn(async () => ({
    fbc: null,
    fbp: null,
    clientIpAddress: null,
    clientUserAgent: null,
  })),
  saveMetaCapiWebMatchForUser: vi.fn(async () => undefined),
}));

vi.mock("@/lib/summitt-membership-entitlement.server", () => ({
  recomputeMembershipFromAuthoritativeStripeSubscription: vi.fn(async () => undefined),
  resolveAppleMembershipGrantForUser: vi.fn(async () => null),
}));

vi.mock("stripe", () => {
  class StripeMock {
    checkout = {
      sessions: {
        retrieve: (...args: unknown[]) => retrieveSessionMock(...args),
      },
    };
    customers = {
      update: (...args: unknown[]) => updateCustomerMock(...args),
    };
    subscriptions = {
      update: (...args: unknown[]) => updateSubMock(...args),
      retrieve: (...args: unknown[]) => retrieveSubMock(...args),
    };
  }
  return { default: StripeMock };
});

import { activateHostedCheckout } from "@/lib/stripe-first-checkout/activate";

const intent = {
  id: "intent_1",
  livemode: false,
  stripe_checkout_session_id: "cs_1",
  binding_expires_at: "2099-01-01T00:00:00.000Z",
  clerk_user_id: null,
  session_started_at: null,
  sign_in_required_at: null,
  clerk_user_provisioned_at: null,
};

describe("activateHostedCheckout member email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_activate";
    process.env.CLERK_SECRET_KEY = "sk_test_clerk";
    loadBindingMock.mockResolvedValue(intent);
    loadIdMock.mockResolvedValue({
      ...intent,
      clerk_user_id: "user_new",
      clerk_user_provisioned_at: "2026-10-16T12:00:00.000Z",
    });
    retrieveSessionMock.mockResolvedValue({
      id: "cs_1",
      livemode: false,
      metadata: { checkoutIntentId: "intent_1" },
      customer_details: { name: "Pat Summitt", phone: null, email: "pat@example.com" },
    });
    assessMock.mockResolvedValue({
      ok: true,
      email: "pat@example.com",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      trialEndUnix: 1_800_000_000,
      subscription: {
        status: "trialing",
        pause_collection: null,
        metadata: { plan: "monthly" },
        items: { data: [{ price: { recurring: { interval: "month" } } }] },
      },
    });
    confirmMock.mockResolvedValue("saved");
    holdMock.mockResolvedValue("ok");
    lookupExternalMock.mockResolvedValue(null);
    lookupEmailMock.mockResolvedValue([]);
    createUserMock.mockResolvedValue({ id: "user_new" });
    markProvisionedMock.mockResolvedValue(true);
    updateCustomerMock.mockResolvedValue({});
    updateSubMock.mockResolvedValue({});
    retrieveSubMock.mockResolvedValue({ id: "sub_1", status: "trialing" });
    ticketMock.mockResolvedValue("ticket_1");
  });

  it("continues Clerk provisioning when the new-member email fails", async () => {
    notifyMock.mockRejectedValue(new Error("resend down"));

    const result = await activateHostedCheckout({
      sessionId: "cs_1",
      bindingSecret: "browser-secret",
    });

    expect(result).toEqual({ status: "ticket", ticket: "ticket_1" });
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "pat@example.com",
        customerId: "cus_1",
        subscriptionId: "sub_1",
        checkoutSessionId: "cs_1",
        subscriptionStatus: "trialing",
      })
    );
    expect(createUserMock).toHaveBeenCalledTimes(1);
    expect(ticketMock).toHaveBeenCalledWith("user_new");
  });
});
