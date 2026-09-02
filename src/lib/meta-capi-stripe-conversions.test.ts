import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("server-only", () => ({}));

const sendMock = vi.fn();
vi.mock("@/lib/meta-capi", async () => {
  const actual = await vi.importActual<typeof import("./meta-capi")>("./meta-capi");
  return {
    ...actual,
    sendMetaCapiEvent: (...args: unknown[]) => sendMock(...args),
  };
});

const claimMock = vi.fn();
const markSentMock = vi.fn();
const markErrorMock = vi.fn();
const listPendingMock = vi.fn();
vi.mock("@/lib/meta-conversion-ledger", () => ({
  claimMetaConversionEvent: claimMock,
  markMetaConversionSent: markSentMock,
  markMetaConversionError: markErrorMock,
  listPendingMetaConversionsForSubscription: listPendingMock,
}));

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
    claimMock.mockReset();
    markSentMock.mockReset();
    markErrorMock.mockReset();
    listPendingMock.mockReset();
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
        event_time: 1700000000,
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
        event_time: 1700000100,
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
        event_time: 1700000100,
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
        event_time: 1700000100,
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
      })
    );
  });
});
