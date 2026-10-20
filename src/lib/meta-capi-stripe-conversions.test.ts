import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const FRESH_EVENT_TIME = Math.floor(Date.now() / 1000) - 180;

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

const sendMock = vi.fn();
vi.mock("@/lib/meta-capi", async () => {
  const actual = await vi.importActual<typeof import("./meta-capi")>("./meta-capi");
  return {
    ...actual,
    sendMetaCapiEvent: (...args: unknown[]) => sendMock(...args),
  };
});

const loadWebIdsMock = vi.fn();
vi.mock("@/lib/meta-capi-web-identifiers", () => ({
  loadMetaCapiWebIdentifiersForUser: (...args: unknown[]) => loadWebIdsMock(...args),
}));

const loadIntentBySubMock = vi.fn();
const clearStaleMock = vi.fn();
vi.mock("@/lib/stripe-first-checkout/intent-store", () => ({
  loadIntentBySubscriptionId: (...args: unknown[]) => loadIntentBySubMock(...args),
  clearStaleCheckoutMatchFields: (...args: unknown[]) => clearStaleMock(...args),
}));

const claimMock = vi.fn();
const markSentMock = vi.fn();
const markErrorMock = vi.fn();
const listPendingMock = vi.fn();
const listRetryableMock = vi.fn();
const unsentMock = vi.fn();
vi.mock("@/lib/meta-conversion-ledger", async () => {
  const actual = await vi.importActual<typeof import("./meta-conversion-ledger")>(
    "./meta-conversion-ledger"
  );
  return {
    ...actual,
    claimMetaConversionEvent: (...args: unknown[]) => claimMock(...args),
    markMetaConversionSent: (...args: unknown[]) => markSentMock(...args),
    markMetaConversionError: (...args: unknown[]) => markErrorMock(...args),
    listPendingMetaConversionsForSubscription: (...args: unknown[]) =>
      listPendingMock(...args),
    listRetryableMetaConversions: (...args: unknown[]) => listRetryableMock(...args),
    isMetaConversionUnsent: (...args: unknown[]) => unsentMock(...args),
  };
});

const PRICE = "price_monthly_current";

function sub(overrides: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    status: "trialing",
    trial_end: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    items: {
      data: [{ price: { id: PRICE } }],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function invoice(overrides: Record<string, unknown> = {}): Stripe.Invoice {
  return {
    id: "in_first",
    amount_paid: 2999,
    currency: "usd",
    billing_reason: "subscription_cycle",
    created: 1700000100,
    status_transitions: { paid_at: 1700000100 },
    ...overrides,
  } as unknown as Stripe.Invoice;
}

describe("meta-capi-stripe-conversions", () => {
  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    loadWebIdsMock.mockReset();
    loadWebIdsMock.mockResolvedValue(null);
    loadIntentBySubMock.mockReset();
    loadIntentBySubMock.mockResolvedValue(null);
    clearStaleMock.mockReset();
    clearStaleMock.mockResolvedValue(undefined);
    claimMock.mockReset();
    markSentMock.mockReset();
    markErrorMock.mockReset();
    listPendingMock.mockReset();
    listRetryableMock.mockReset();
    listRetryableMock.mockResolvedValue([]);
    unsentMock.mockReset();
    unsentMock.mockResolvedValue(true);
    process.env.STRIPE_PRICE_ID_MONTHLY = PRICE;
    process.env.STRIPE_PRICE_ID_ANNUAL = "price_annual_current";
    delete process.env.STRIPE_LEGACY_PRICE_IDS;
    sendMock.mockResolvedValue({ ok: true });
    claimMock.mockResolvedValue({
      status: "claimed",
      row: {
        id: "row-1",
        event_name: "StartTrial",
        stripe_subscription_id: "sub_1",
        meta_event_id: "start_trial:sub_1",
        event_time: FRESH_EVENT_TIME,
        value: null,
        currency: null,
        external_id_hash: "hash",
        sent_at: null,
      },
    });
    markSentMock.mockResolvedValue(undefined);
    markErrorMock.mockResolvedValue(undefined);
    listPendingMock.mockResolvedValue([]);
  });

  it("StartTrial fires for a recognized trialing subscription", async () => {
    const { maybeEmitMetaStartTrialFromCheckout } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaStartTrialFromCheckout({
      subscription: sub(),
      userId: "user_abc",
      eventCreatedUnix: 1700000000,
    });
    expect(claimMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "StartTrial",
        stripeSubscriptionId: "sub_1",
        metaEventId: "start_trial:sub_1",
      })
    );
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "StartTrial",
        eventId: "start_trial:sub_1",
      })
    );
    expect(markSentMock).toHaveBeenCalledWith("row-1");
  });

  it("StartTrial appends stored fbc/fbp/IP/UA without changing event identity", async () => {
    loadWebIdsMock.mockResolvedValue({
      fbc: "fb.1.1700000000000.AbCdEf",
      fbp: "fb.1.1700000000000.1234567890",
      clientIpAddress: "8.8.8.8",
      clientUserAgent: "Mozilla/5.0 TestBrowser",
    });
    const { maybeEmitMetaStartTrialFromCheckout } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaStartTrialFromCheckout({
      subscription: sub(),
      userId: "user_abc",
      eventCreatedUnix: 1700000000,
    });
    expect(loadWebIdsMock).toHaveBeenCalledWith("user_abc");
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "StartTrial",
        eventId: "start_trial:sub_1",
        eventTime: FRESH_EVENT_TIME,
        fbc: "fb.1.1700000000000.AbCdEf",
        fbp: "fb.1.1700000000000.1234567890",
        clientIpAddress: "8.8.8.8",
        clientUserAgent: "Mozilla/5.0 TestBrowser",
      })
    );
  });

  it("StartTrial identifier lookup failure still sends external_id-only event", async () => {
    loadWebIdsMock.mockRejectedValue(new Error("db down"));
    const { maybeEmitMetaStartTrialFromCheckout } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaStartTrialFromCheckout({
      subscription: sub(),
      userId: "user_abc",
      eventCreatedUnix: 1700000000,
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "StartTrial",
        eventId: "start_trial:sub_1",
        eventTime: FRESH_EVENT_TIME,
      })
    );
    const sent = sendMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.fbc).toBeUndefined();
    expect(sent.fbp).toBeUndefined();
  });

  it("StartTrial identifier lookup timeout still sends external_id-only event", async () => {
    loadWebIdsMock.mockImplementation(() => new Promise(() => {}));
    const { maybeEmitMetaStartTrialFromCheckout } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaStartTrialFromCheckout({
      subscription: sub(),
      userId: "user_abc",
      eventCreatedUnix: 1700000000,
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "StartTrial",
        eventId: "start_trial:sub_1",
        eventTime: FRESH_EVENT_TIME,
      })
    );
    const sent = sendMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.fbc).toBeUndefined();
    expect(sent.fbp).toBeUndefined();
    expect(sent.clientIpAddress).toBeUndefined();
    expect(sent.clientUserAgent).toBeUndefined();
  });

  it("StartTrial does not fire without a trial", async () => {
    const { maybeEmitMetaStartTrialFromCheckout } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaStartTrialFromCheckout({
      subscription: sub({ status: "active", trial_end: null }),
      userId: "user_abc",
      eventCreatedUnix: 1700000000,
    });
    expect(claimMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("StartTrial does not fire for an unrecognized price", async () => {
    const { maybeEmitMetaStartTrialFromCheckout } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaStartTrialFromCheckout({
      subscription: sub({
        items: { data: [{ price: { id: "price_other_product" } }] },
      }),
      userId: "user_abc",
      eventCreatedUnix: 1700000000,
    });
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("duplicate StartTrial claim does not send again", async () => {
    claimMock.mockResolvedValue({ status: "already_sent" });
    const { maybeEmitMetaStartTrialFromCheckout } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaStartTrialFromCheckout({
      subscription: sub(),
      userId: "user_abc",
      eventCreatedUnix: 1700000000,
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("$0 trial invoice does not Subscribe", async () => {
    const list = vi.fn();
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice({ amount_paid: 0, billing_reason: "subscription_create" }),
      subscription: sub({ status: "trialing" }),
      userId: "user_abc",
      eventCreatedUnix: 1700000000,
    });
    expect(list).not.toHaveBeenCalled();
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("first real paid invoice Subscribes with actual amount_paid/100 and USD", async () => {
    const list = vi.fn(async () => ({
      data: [{ id: "in_first", amount_paid: 2999 }],
      has_more: false,
    }));
    claimMock.mockResolvedValue({
      status: "claimed",
      row: {
        id: "row-sub",
        event_name: "Subscribe",
        stripe_subscription_id: "sub_1",
        meta_event_id: "subscribe:sub_1",
        event_time: FRESH_EVENT_TIME,
        value: 29.99,
        currency: "USD",
        external_id_hash: "hash",
        sent_at: null,
      },
    });
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice(),
      subscription: sub({ status: "active", trial_end: null }),
      userId: "user_abc",
      eventCreatedUnix: 1700000100,
    });
    expect(claimMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "Subscribe",
        metaEventId: "subscribe:sub_1",
        value: 29.99,
        currency: "USD",
      })
    );
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "Subscribe",
        eventId: "subscribe:sub_1",
        value: 29.99,
        currency: "USD",
      })
    );
    const sent = sendMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.fbc).toBeUndefined();
    expect(sent.fbp).toBeUndefined();
    expect(sent.clientIpAddress).toBeUndefined();
    expect(sent.clientUserAgent).toBeUndefined();
    expect(loadWebIdsMock).toHaveBeenCalledWith("user_abc");
    expect(sent.eventSourceUrl).toBe("https://summittmindset.com/subscribe");
  });

  it("later monthly renewal does not Subscribe", async () => {
    const list = vi.fn(async () => ({
      data: [
        { id: "in_renewal", amount_paid: 2999 },
        { id: "in_first", amount_paid: 2999 },
      ],
      has_more: false,
    }));
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice({ id: "in_renewal" }),
      subscription: sub({ status: "active", trial_end: null }),
      userId: "user_abc",
      eventCreatedUnix: 1700000200,
    });
    expect(claimMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("later annual renewal does not Subscribe", async () => {
    const list = vi.fn(async () => ({
      data: [
        { id: "in_year2", amount_paid: 24900 },
        { id: "in_year1", amount_paid: 24900 },
      ],
      has_more: false,
    }));
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice({ id: "in_year2", amount_paid: 24900 }),
      subscription: sub({
        status: "active",
        trial_end: null,
        items: { data: [{ price: { id: "price_annual_current" } }] },
      }),
      userId: "user_abc",
      eventCreatedUnix: 1700000200,
    });
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("grandfathered subscriber next renewal does not Subscribe", async () => {
    process.env.STRIPE_LEGACY_PRICE_IDS = "price_legacy_1999";
    const list = vi.fn(async () => ({
      data: [
        { id: "in_next", amount_paid: 1999 },
        { id: "in_old", amount_paid: 1999 },
      ],
      has_more: false,
    }));
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice({ id: "in_next", amount_paid: 1999 }),
      subscription: sub({
        status: "active",
        trial_end: null,
        items: { data: [{ price: { id: "price_legacy_1999" } }] },
      }),
      userId: "user_abc",
      eventCreatedUnix: 1700000200,
    });
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("manual invoice does not Subscribe", async () => {
    const list = vi.fn();
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice({ billing_reason: "manual" }),
      subscription: sub({ status: "active", trial_end: null }),
      userId: "user_abc",
      eventCreatedUnix: 1700000100,
    });
    expect(list).not.toHaveBeenCalled();
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("unrelated currency does not Subscribe", async () => {
    const list = vi.fn();
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice({ currency: "eur" }),
      subscription: sub({ status: "active", trial_end: null }),
      userId: "user_abc",
      eventCreatedUnix: 1700000100,
    });
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("fails closed for Meta when invoice history cannot be determined", async () => {
    const list = vi.fn(async () => {
      throw new Error("stripe down");
    });
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice(),
      subscription: sub({ status: "active", trial_end: null }),
      userId: "user_abc",
      eventCreatedUnix: 1700000100,
    });
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("same subscription cannot Subscribe twice once sent", async () => {
    const list = vi.fn(async () => ({
      data: [{ id: "in_first", amount_paid: 2999 }],
      has_more: false,
    }));
    claimMock.mockResolvedValue({ status: "already_sent" });
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice(),
      subscription: sub({ status: "active", trial_end: null }),
      userId: "user_abc",
      eventCreatedUnix: 1700000100,
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("Meta send failure marks error and does not throw", async () => {
    sendMock.mockResolvedValue({ ok: false, reason: "timeout" });
    const { maybeEmitMetaStartTrialFromCheckout } = await import(
      "./meta-capi-stripe-conversions"
    );
    await expect(
      maybeEmitMetaStartTrialFromCheckout({
        subscription: sub(),
        userId: "user_abc",
        eventCreatedUnix: 1700000000,
      })
    ).resolves.toBeUndefined();
    expect(markErrorMock).toHaveBeenCalledWith("row-1", "timeout");
    expect(markSentMock).not.toHaveBeenCalled();
  });

  it("pending retry resends stored Subscribe value not the current invoice amount", async () => {
    const list = vi.fn(async () => ({
      data: [{ id: "in_first", amount_paid: 2999 }],
      has_more: false,
    }));
    claimMock.mockResolvedValue({
      status: "pending_retry",
      row: {
        id: "row-pending",
        event_name: "Subscribe",
        stripe_subscription_id: "sub_1",
        meta_event_id: "subscribe:sub_1",
        event_time: FRESH_EVENT_TIME,
        value: 19.99,
        currency: "USD",
        external_id_hash: "hash",
        sent_at: null,
      },
    });
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice({ amount_paid: 24900 }),
      subscription: sub({ status: "active", trial_end: null }),
      userId: "user_abc",
      eventCreatedUnix: 1700000999,
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ value: 19.99, currency: "USD" })
    );
  });

  it("renewal retries pending Subscribe with stored original value", async () => {
    const list = vi.fn(async () => ({
      data: [
        { id: "in_renewal", amount_paid: 2999 },
        { id: "in_first", amount_paid: 2999 },
      ],
      has_more: false,
    }));
    listPendingMock.mockResolvedValue([
      {
        id: "row-pending",
        event_name: "Subscribe",
        stripe_subscription_id: "sub_1",
        meta_event_id: "subscribe:sub_1",
        event_time: FRESH_EVENT_TIME,
        value: 29.99,
        currency: "USD",
        external_id_hash: "hash",
        sent_at: null,
      },
    ]);
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice({ id: "in_renewal" }),
      subscription: sub({ status: "active", trial_end: null }),
      userId: "user_abc",
      eventCreatedUnix: 1700000200,
    });
    expect(claimMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "Subscribe",
        value: 29.99,
        eventId: "subscribe:sub_1",
        eventTime: FRESH_EVENT_TIME,
      })
    );
  });

  it("uses Stripe trial_start for monthly and annual StartTrial and keeps the event id", async () => {
    const trialStart = FRESH_EVENT_TIME;
    claimMock.mockImplementation(async (args: { eventTime: number; eventName: string; metaEventId: string; stripeSubscriptionId: string }) => ({
      status: "claimed",
      row: {
        id: "row-trial",
        event_name: args.eventName,
        stripe_subscription_id: args.stripeSubscriptionId,
        meta_event_id: args.metaEventId,
        event_time: args.eventTime,
        value: null,
        currency: null,
        external_id_hash: null,
        sent_at: null,
      },
    }));
    const { maybeEmitMetaStartTrialFromCheckout } = await import(
      "./meta-capi-stripe-conversions"
    );
    const match = {
      fbc: "fb.1.1700000000000.AbCdEf",
      fbp: "fb.1.1700000000000.1234567890",
      clientIpAddress: "8.8.8.8",
      clientUserAgent: "Mozilla/5.0 TestBrowser",
    };
    for (const price of [PRICE, "price_annual_current"] as const) {
      sendMock.mockClear();
      claimMock.mockClear();
      await maybeEmitMetaStartTrialFromCheckout({
        subscription: sub({
          trial_start: trialStart,
          created: trialStart - 20,
          items: { data: [{ price: { id: price } }] },
        }),
        userId: null,
        eventCreatedUnix: trialStart - 400,
        eventSourceUrl: "https://summittmindset.com/checkout/start",
        webMatch: match,
      });
      expect(claimMock).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "StartTrial",
          metaEventId: "start_trial:sub_1",
          eventTime: trialStart,
          externalIdHash: null,
        })
      );
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: "start_trial:sub_1",
          eventTime: trialStart,
          eventSourceUrl: "https://summittmindset.com/checkout/start",
          fbc: match.fbc,
          fbp: match.fbp,
          clientIpAddress: "8.8.8.8",
          clientUserAgent: "Mozilla/5.0 TestBrowser",
        })
      );
      const sent = sendMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(JSON.stringify(sent)).not.toMatch(/email|phone|@/i);
    }
  });

  it("falls back to subscription.created when trial_start is missing", async () => {
    const created = FRESH_EVENT_TIME;
    claimMock.mockImplementation(async (args: { eventTime: number }) => ({
      status: "claimed",
      row: {
        id: "row-created",
        event_name: "StartTrial",
        stripe_subscription_id: "sub_1",
        meta_event_id: "start_trial:sub_1",
        event_time: args.eventTime,
        value: null,
        currency: null,
        external_id_hash: null,
        sent_at: null,
      },
    }));
    const { maybeEmitMetaStartTrialFromCheckout } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaStartTrialFromCheckout({
      subscription: sub({ trial_start: null, created }),
      userId: "user_abc",
      eventCreatedUnix: created - 50,
    });
    expect(claimMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventTime: created })
    );
  });

  it("Subscribe reuses stored match fields and the Clerk checkout URL", async () => {
    loadWebIdsMock.mockResolvedValue({
      fbc: "fb.1.1700000000000.ClerkFbc",
      fbp: "fb.1.1700000000000.1234567890",
      clientIpAddress: "1.1.1.1",
      clientUserAgent: "Mozilla/5.0 Clerk",
    });
    const list = vi.fn(async () => ({ data: [{ id: "in_first", amount_paid: 2999 }], has_more: false }));
    claimMock.mockResolvedValue({
      status: "claimed",
      row: {
        id: "row-sub",
        event_name: "Subscribe",
        stripe_subscription_id: "sub_1",
        meta_event_id: "subscribe:sub_1",
        event_time: FRESH_EVENT_TIME,
        value: 29.99,
        currency: "USD",
        external_id_hash: "hash",
        sent_at: null,
      },
    });
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice(),
      subscription: sub({ status: "active", trial_end: null }),
      userId: "user_abc",
      eventCreatedUnix: 1700000100,
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "Subscribe",
        eventId: "subscribe:sub_1",
        eventTime: FRESH_EVENT_TIME,
        fbc: "fb.1.1700000000000.ClerkFbc",
        eventSourceUrl: "https://summittmindset.com/subscribe",
      })
    );
  });

  it("sends one Subscribe from the checkout intent when the invoice is first and Clerk is not linked", async () => {
    loadIntentBySubMock.mockResolvedValue({
      id: "intent_1",
      stripe_subscription_id: "sub_1",
      clerk_user_id: null,
      meta_fbc: "fb.1.1700000000000.AbCdEf",
      meta_fbp: null,
      client_ip: "8.8.8.8",
      client_user_agent: "Mozilla/5.0",
    });
    const list = vi.fn(async () => ({ data: [{ id: "in_first", amount_paid: 24900 }], has_more: false }));
    claimMock.mockResolvedValue({
      status: "claimed",
      row: {
        id: "row-preclerk",
        event_name: "Subscribe",
        stripe_subscription_id: "sub_1",
        meta_event_id: "subscribe:sub_1",
        event_time: FRESH_EVENT_TIME,
        value: 249,
        currency: "USD",
        external_id_hash: null,
        sent_at: null,
      },
    });
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice({ amount_paid: 24900, billing_reason: "subscription_create" }),
      subscription: sub({ status: "active", trial_end: null }),
      userId: null,
      eventCreatedUnix: 1700000100,
    });
    expect(claimMock).toHaveBeenCalledTimes(1);
    expect(claimMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "Subscribe",
        externalIdHash: null,
        value: 249,
      })
    );
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "subscribe:sub_1",
        fbc: "fb.1.1700000000000.AbCdEf",
        fbp: null,
        eventSourceUrl: "https://summittmindset.com/checkout/start",
      })
    );
  });

  it("retries a pending StartTrial before the first Subscribe and keeps both stored times", async () => {
    listPendingMock.mockResolvedValue([
      {
        id: "row-trial",
        event_name: "StartTrial",
        stripe_subscription_id: "sub_1",
        meta_event_id: "start_trial:sub_1",
        event_time: FRESH_EVENT_TIME - 10,
        value: null,
        currency: null,
        external_id_hash: null,
        sent_at: null,
      },
    ]);
    const list = vi.fn(async () => ({ data: [{ id: "in_first", amount_paid: 2999 }], has_more: false }));
    claimMock.mockResolvedValue({
      status: "claimed",
      row: {
        id: "row-sub",
        event_name: "Subscribe",
        stripe_subscription_id: "sub_1",
        meta_event_id: "subscribe:sub_1",
        event_time: FRESH_EVENT_TIME,
        value: 29.99,
        currency: "USD",
        external_id_hash: "hash",
        sent_at: null,
      },
    });
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice(),
      subscription: sub({ status: "active", trial_end: null }),
      userId: "user_abc",
      eventCreatedUnix: 1700000999,
    });
    expect(sendMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventName: "StartTrial",
        eventId: "start_trial:sub_1",
        eventTime: FRESH_EVENT_TIME - 10,
      })
    );
    expect(sendMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventName: "Subscribe",
        eventId: "subscribe:sub_1",
        eventTime: FRESH_EVENT_TIME,
      })
    );
  });

  it("does not resend an event older than seven days or give it a new timestamp", async () => {
    const oldTime = Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60;
    claimMock.mockResolvedValue({
      status: "pending_retry",
      row: {
        id: "row-old",
        event_name: "StartTrial",
        stripe_subscription_id: "sub_1",
        meta_event_id: "start_trial:sub_1",
        event_time: oldTime,
        value: null,
        currency: null,
        external_id_hash: null,
        sent_at: null,
      },
    });
    const { maybeEmitMetaStartTrialFromCheckout } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaStartTrialFromCheckout({
      subscription: sub(),
      userId: "user_abc",
      eventCreatedUnix: FRESH_EVENT_TIME,
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(markSentMock).not.toHaveBeenCalled();
    expect(markErrorMock).not.toHaveBeenCalled();
  });

  it("does not send again when a concurrent reader already marked the row sent", async () => {
    unsentMock.mockResolvedValue(false);
    const { maybeEmitMetaStartTrialFromCheckout } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaStartTrialFromCheckout({
      subscription: sub(),
      userId: "user_abc",
      eventCreatedUnix: FRESH_EVENT_TIME,
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(markSentMock).not.toHaveBeenCalled();
  });

  it("concurrent webhook and recovery sends keep the stored event id and time", async () => {
    const storedTime = FRESH_EVENT_TIME - 15;
    const pending = {
      id: "row-race",
      event_name: "StartTrial" as const,
      stripe_subscription_id: "sub_1",
      meta_event_id: "start_trial:sub_1",
      event_time: storedTime,
      value: null,
      currency: null,
      external_id_hash: null,
      sent_at: null,
      created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };
    claimMock.mockResolvedValue({ status: "pending_retry", row: pending });
    listRetryableMock.mockResolvedValue([pending]);
    const { maybeEmitMetaStartTrialFromCheckout, retryBoundedPendingMetaConversions } =
      await import("./meta-capi-stripe-conversions");
    await Promise.all([
      maybeEmitMetaStartTrialFromCheckout({
        subscription: sub(),
        userId: null,
        eventCreatedUnix: storedTime + 90,
      }),
      retryBoundedPendingMetaConversions(Date.now()),
    ]);
    expect(sendMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of sendMock.mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({
          eventId: "start_trial:sub_1",
          eventTime: storedTime,
        })
      );
    }
  });

  it("skips hourly retries created less than two minutes ago", async () => {
    listRetryableMock.mockResolvedValue([
      {
        id: "row-young",
        event_name: "Subscribe",
        stripe_subscription_id: "sub_1",
        meta_event_id: "subscribe:sub_1",
        event_time: FRESH_EVENT_TIME,
        value: 29.99,
        currency: "USD",
        external_id_hash: "hash",
        sent_at: null,
        created_at: new Date(Date.now() - 30 * 1000).toISOString(),
      },
    ]);
    const { retryBoundedPendingMetaConversions } = await import(
      "./meta-capi-stripe-conversions"
    );
    await retryBoundedPendingMetaConversions(Date.now());
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("marks events_received failures for retry and does not mark them sent", async () => {
    sendMock.mockResolvedValue({ ok: false, reason: "events_received" });
    const { maybeEmitMetaStartTrialFromCheckout } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaStartTrialFromCheckout({
      subscription: sub(),
      userId: "user_abc",
      eventCreatedUnix: FRESH_EVENT_TIME,
    });
    expect(markErrorMock).toHaveBeenCalledWith("row-1", "events_received");
    expect(markSentMock).not.toHaveBeenCalled();
  });

  it("still clears temporary match data when the hourly retry throws", async () => {
    listRetryableMock.mockRejectedValue(new Error("ledger down"));
    const { runHourlyMetaConversionMaintenance } = await import(
      "./meta-capi-stripe-conversions"
    );
    await runHourlyMetaConversionMaintenance(Date.now());
    expect(clearStaleMock).toHaveBeenCalledTimes(1);
  });

  it("a renewal before Clerk linkage does not create another Subscribe", async () => {
    const list = vi.fn(async () => ({
      data: [
        { id: "in_renewal", amount_paid: 2999 },
        { id: "in_first", amount_paid: 2999 },
      ],
      has_more: false,
    }));
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice({ id: "in_renewal" }),
      subscription: sub({ status: "active", trial_end: null }),
      userId: null,
      eventCreatedUnix: 1700000200,
    });
    expect(claimMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("a $0 invoice before Clerk linkage does not Subscribe", async () => {
    const list = vi.fn();
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice({ amount_paid: 0, billing_reason: "subscription_create" }),
      subscription: sub({ status: "trialing" }),
      userId: null,
      eventCreatedUnix: 1700000000,
    });
    expect(list).not.toHaveBeenCalled();
    expect(claimMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("pre-Clerk Subscribe sends the loaded intent match and does not read the intent again", async () => {
    const checkoutIntent = {
      id: "intent_1",
      stripe_subscription_id: "sub_1",
      clerk_user_id: null,
      meta_fbc: "fb.1.1700000000000.AbCdEf",
      meta_fbp: "fb.1.1700000000000.1234567890",
      client_ip: "8.8.8.8",
      client_user_agent: "Mozilla/5.0 PreClerk",
    };
    const list = vi.fn(async () => ({ data: [{ id: "in_first", amount_paid: 2999 }], has_more: false }));
    claimMock.mockResolvedValue({
      status: "claimed",
      row: {
        id: "row-preclerk",
        event_name: "Subscribe",
        stripe_subscription_id: "sub_1",
        meta_event_id: "subscribe:sub_1",
        event_time: FRESH_EVENT_TIME,
        value: 29.99,
        currency: "USD",
        external_id_hash: null,
        sent_at: null,
      },
    });
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice({ status_transitions: { paid_at: FRESH_EVENT_TIME } }),
      subscription: sub({ status: "active", trial_end: null }),
      userId: null,
      eventCreatedUnix: FRESH_EVENT_TIME,
      checkoutIntent,
    });
    expect(loadIntentBySubMock).not.toHaveBeenCalled();
    expect(claimMock).toHaveBeenCalledTimes(1);
    expect(claimMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "Subscribe",
        metaEventId: "subscribe:sub_1",
        eventTime: FRESH_EVENT_TIME,
        externalIdHash: null,
      })
    );
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "subscribe:sub_1",
        eventTime: FRESH_EVENT_TIME,
        eventSourceUrl: "https://summittmindset.com/checkout/start",
        fbc: "fb.1.1700000000000.AbCdEf",
        fbp: "fb.1.1700000000000.1234567890",
        clientIpAddress: "8.8.8.8",
        clientUserAgent: "Mozilla/5.0 PreClerk",
      })
    );
  });

  it("does not mark an unmatched Subscribe sent when the intent lookup fails", async () => {
    loadIntentBySubMock.mockRejectedValue(new Error("intent db down"));
    const list = vi.fn(async () => ({ data: [{ id: "in_first", amount_paid: 2999 }], has_more: false }));
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice({ status_transitions: { paid_at: FRESH_EVENT_TIME } }),
      subscription: sub({ status: "active", trial_end: null }),
      userId: null,
      eventCreatedUnix: FRESH_EVENT_TIME,
    });
    expect(claimMock).toHaveBeenCalledTimes(1);
    expect(claimMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metaEventId: "subscribe:sub_1",
        eventTime: FRESH_EVENT_TIME,
      })
    );
    expect(sendMock).not.toHaveBeenCalled();
    expect(markSentMock).not.toHaveBeenCalled();
    expect(markErrorMock).toHaveBeenCalledWith("row-1", "intent_lookup_failed");
  });

  it("a timed-out intent lookup leaves the pending Subscribe unsent", async () => {
    loadIntentBySubMock.mockImplementation(() => new Promise(() => {}));
    listRetryableMock.mockResolvedValue([
      {
        id: "row-pending",
        event_name: "Subscribe",
        stripe_subscription_id: "sub_1",
        meta_event_id: "subscribe:sub_1",
        event_time: FRESH_EVENT_TIME,
        value: 29.99,
        currency: "USD",
        external_id_hash: null,
        sent_at: null,
        created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    ]);
    const { retryBoundedPendingMetaConversions } = await import(
      "./meta-capi-stripe-conversions"
    );
    await retryBoundedPendingMetaConversions(Date.now());
    expect(sendMock).not.toHaveBeenCalled();
    expect(markSentMock).not.toHaveBeenCalled();
    expect(markErrorMock).toHaveBeenCalledWith("row-pending", "intent_lookup_failed");
  });

  it("retries the original Subscribe id and time once the intent lookup succeeds", async () => {
    const storedTime = FRESH_EVENT_TIME - 40;
    const pending = {
      id: "row-pending",
      event_name: "Subscribe" as const,
      stripe_subscription_id: "sub_1",
      meta_event_id: "subscribe:sub_1",
      event_time: storedTime,
      value: 29.99,
      currency: "USD",
      external_id_hash: null,
      sent_at: null,
      created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };
    listRetryableMock.mockResolvedValue([pending]);
    loadIntentBySubMock.mockResolvedValue({
      id: "intent_1",
      stripe_subscription_id: "sub_1",
      clerk_user_id: null,
      meta_fbc: "fb.1.1700000000000.AbCdEf",
      meta_fbp: "fb.1.1700000000000.1234567890",
      client_ip: "8.8.8.8",
      client_user_agent: "Mozilla/5.0 PreClerk",
    });
    const { retryBoundedPendingMetaConversions } = await import(
      "./meta-capi-stripe-conversions"
    );
    await retryBoundedPendingMetaConversions(Date.now());
    expect(claimMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "subscribe:sub_1",
        eventTime: storedTime,
        fbc: "fb.1.1700000000000.AbCdEf",
        fbp: "fb.1.1700000000000.1234567890",
        clientIpAddress: "8.8.8.8",
        clientUserAgent: "Mozilla/5.0 PreClerk",
      })
    );
  });

  it("sends an identifier-free checkout without inventing match fields", async () => {
    const list = vi.fn(async () => ({ data: [{ id: "in_first", amount_paid: 2999 }], has_more: false }));
    claimMock.mockResolvedValue({
      status: "claimed",
      row: {
        id: "row-empty",
        event_name: "Subscribe",
        stripe_subscription_id: "sub_1",
        meta_event_id: "subscribe:sub_1",
        event_time: FRESH_EVENT_TIME,
        value: 29.99,
        currency: "USD",
        external_id_hash: null,
        sent_at: null,
      },
    });
    const { maybeEmitMetaSubscribeFromInvoicePaid } = await import(
      "./meta-capi-stripe-conversions"
    );
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice({ status_transitions: { paid_at: FRESH_EVENT_TIME } }),
      subscription: sub({ status: "active", trial_end: null }),
      userId: null,
      eventCreatedUnix: FRESH_EVENT_TIME,
      checkoutIntent: {
        id: "intent_empty",
        stripe_subscription_id: "sub_1",
        clerk_user_id: null,
        meta_fbc: null,
        meta_fbp: null,
        client_ip: null,
        client_user_agent: null,
      },
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(markSentMock).toHaveBeenCalledWith("row-empty");
    const sent = sendMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.eventId).toBe("subscribe:sub_1");
    expect(sent.fbc).toBeUndefined();
    expect(sent.fbp).toBeUndefined();
    expect(sent.clientIpAddress).toBeUndefined();
    expect(sent.clientUserAgent).toBeUndefined();
  });

  it("StartTrial and Subscribe prefer the checkout click over an older Clerk click", async () => {
    const checkoutFbc = "fb.1.1700000000000.CheckoutClk";
    const clerkFbc = "fb.1.1700000000000.OlderClerk";
    loadIntentBySubMock.mockResolvedValue({
      id: "intent_1",
      stripe_subscription_id: "sub_1",
      clerk_user_id: "user_abc",
      meta_fbc: checkoutFbc,
      meta_fbp: null,
      client_ip: "8.8.8.8",
      client_user_agent: "Mozilla/5.0 Checkout",
    });
    loadWebIdsMock.mockResolvedValue({
      fbc: clerkFbc,
      fbp: "fb.1.1700000000000.1234567890",
      clientIpAddress: "1.1.1.1",
      clientUserAgent: "Mozilla/5.0 Clerk",
    });
    claimMock.mockImplementation(async (args: { eventName: string; metaEventId: string; eventTime: number }) => ({
      status: "claimed",
      row: {
        id: `row-${args.eventName}`,
        event_name: args.eventName,
        stripe_subscription_id: "sub_1",
        meta_event_id: args.metaEventId,
        event_time: args.eventTime,
        value: args.eventName === "Subscribe" ? 29.99 : null,
        currency: args.eventName === "Subscribe" ? "USD" : null,
        external_id_hash: "hash",
        sent_at: null,
      },
    }));
    const list = vi.fn(async () => ({ data: [{ id: "in_first", amount_paid: 2999 }], has_more: false }));
    const { maybeEmitMetaStartTrialFromCheckout, maybeEmitMetaSubscribeFromInvoicePaid } =
      await import("./meta-capi-stripe-conversions");
    await maybeEmitMetaStartTrialFromCheckout({
      subscription: sub({ trial_start: FRESH_EVENT_TIME }),
      userId: "user_abc",
      eventCreatedUnix: FRESH_EVENT_TIME,
      eventSourceUrl: "https://summittmindset.com/checkout/start",
    });
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice({ status_transitions: { paid_at: FRESH_EVENT_TIME } }),
      subscription: sub({ status: "active", trial_end: null, trial_start: FRESH_EVENT_TIME }),
      userId: "user_abc",
      eventCreatedUnix: FRESH_EVENT_TIME,
    });
    expect(claimMock).toHaveBeenCalledTimes(2);
    expect(claimMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ metaEventId: "start_trial:sub_1" })
    );
    expect(claimMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ metaEventId: "subscribe:sub_1" })
    );
    expect(sendMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventName: "StartTrial",
        eventId: "start_trial:sub_1",
        fbc: checkoutFbc,
        fbp: "fb.1.1700000000000.1234567890",
        clientIpAddress: "8.8.8.8",
        clientUserAgent: "Mozilla/5.0 Checkout",
      })
    );
    expect(sendMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventName: "Subscribe",
        eventId: "subscribe:sub_1",
        fbc: checkoutFbc,
        fbp: "fb.1.1700000000000.1234567890",
        clientIpAddress: "8.8.8.8",
        clientUserAgent: "Mozilla/5.0 Checkout",
      })
    );
  });

  it("Clerk-first events keep the account match when no checkout intent exists", async () => {
    loadIntentBySubMock.mockResolvedValue(null);
    loadWebIdsMock.mockResolvedValue({
      fbc: "fb.1.1700000000000.ClerkFbc",
      fbp: "fb.1.1700000000000.1234567890",
      clientIpAddress: "1.1.1.1",
      clientUserAgent: "Mozilla/5.0 Clerk",
    });
    claimMock.mockImplementation(async (args: { eventName: string; metaEventId: string; eventTime: number }) => ({
      status: "claimed",
      row: {
        id: `row-${args.eventName}`,
        event_name: args.eventName,
        stripe_subscription_id: "sub_1",
        meta_event_id: args.metaEventId,
        event_time: args.eventTime,
        value: args.eventName === "Subscribe" ? 29.99 : null,
        currency: args.eventName === "Subscribe" ? "USD" : null,
        external_id_hash: "hash",
        sent_at: null,
      },
    }));
    const list = vi.fn(async () => ({ data: [{ id: "in_first", amount_paid: 2999 }], has_more: false }));
    const { maybeEmitMetaStartTrialFromCheckout, maybeEmitMetaSubscribeFromInvoicePaid } =
      await import("./meta-capi-stripe-conversions");
    await maybeEmitMetaStartTrialFromCheckout({
      subscription: sub(),
      userId: "user_abc",
      eventCreatedUnix: FRESH_EVENT_TIME,
    });
    await maybeEmitMetaSubscribeFromInvoicePaid({
      stripe: { invoices: { list } },
      invoice: invoice({ status_transitions: { paid_at: FRESH_EVENT_TIME } }),
      subscription: sub({ status: "active", trial_end: null }),
      userId: "user_abc",
      eventCreatedUnix: FRESH_EVENT_TIME,
    });
    expect(sendMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventName: "StartTrial",
        eventId: "start_trial:sub_1",
        eventSourceUrl: "https://summittmindset.com/subscribe",
        fbc: "fb.1.1700000000000.ClerkFbc",
      })
    );
    expect(sendMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventName: "Subscribe",
        eventId: "subscribe:sub_1",
        eventSourceUrl: "https://summittmindset.com/subscribe",
        fbc: "fb.1.1700000000000.ClerkFbc",
      })
    );
  });
});
