import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("server-only", () => ({}));

const claimMock = vi.fn();
const readStatusMock = vi.fn();
const markAcceptedMock = vi.fn();
const markErrorMock = vi.fn();
const listRetryableMock = vi.fn();
const tokenMock = vi.fn();
const ingestMock = vi.fn();
const loadIntentMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("@/lib/stripe-first-checkout/intent-store", () => ({
  loadIntentBySubscriptionId: (...args: unknown[]) => loadIntentMock(...args),
}));

vi.mock("@/lib/google-ads/conversion-ledger", () => ({
  claimGoogleAdsConversion: (...args: unknown[]) => claimMock(...args),
  readGoogleAdsConversionStatus: (...args: unknown[]) => readStatusMock(...args),
  markGoogleAdsIngestionAccepted: (...args: unknown[]) => markAcceptedMock(...args),
  markGoogleAdsConversionError: (...args: unknown[]) => markErrorMock(...args),
  listRetryableGoogleAdsConversions: (...args: unknown[]) => listRetryableMock(...args),
  GOOGLE_ADS_CONVERSION_RETRY_MIN_AGE_MS: 2 * 60 * 1000,
}));

vi.mock("@/lib/google-ads/data-manager-client", () => ({
  googleAdsAccessToken: (...args: unknown[]) => tokenMock(...args),
  postGoogleAdsIngest: (...args: unknown[]) => ingestMock(...args),
}));

const PRICE = "price_monthly_current";
const ANNUAL = "price_annual_current";
const GCLID = "EAIaIQobChMI_test";

function intent(overrides: Record<string, unknown> = {}) {
  return {
    livemode: true,
    request_country: "US",
    google_click_id_type: "gclid",
    google_click_id: GCLID,
    ...overrides,
  };
}

function sub(overrides: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    status: "trialing",
    livemode: true,
    trial_start: 1_700_000_000,
    trial_end: 1_700_000_000 + 7 * 24 * 3600,
    metadata: {},
    items: { data: [{ price: { id: PRICE } }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function invoice(overrides: Record<string, unknown> = {}): Stripe.Invoice {
  return {
    id: "in_first",
    amount_paid: 2999,
    currency: "usd",
    billing_reason: "subscription_cycle",
    created: 1_700_604_800,
    status_transitions: { paid_at: 1_700_604_800 },
    ...overrides,
  } as unknown as Stripe.Invoice;
}

function stripeClient(rows: Array<{ id: string; amount_paid: number }> = []) {
  return {
    invoices: {
      list: vi.fn(async () => ({ data: rows, has_more: false })),
    },
  };
}

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "claimed",
    row: {
      id: "row-1",
      event_kind: "trial_started",
      stripe_subscription_id: "sub_1",
      transaction_id: "start_trial:sub_1",
      event_time: 1_700_000_000,
      value: null,
      currency: null,
      google_click_id_type: "gclid",
      google_click_id: GCLID,
      request_country: "US",
      status: "pending",
      google_request_id: null,
      created_at: "2026-10-21T00:00:00.000Z",
      ...overrides,
    },
  };
}

describe("Stripe to Google Ads conversions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_PRICE_ID_MONTHLY = PRICE;
    process.env.STRIPE_PRICE_ID_ANNUAL = ANNUAL;
    delete process.env.STRIPE_LEGACY_PRICE_IDS;
    process.env.GOOGLE_ADS_CUSTOMER_ID = "2101350707";
    process.env.GOOGLE_ADS_TRIAL_CONVERSION_ACTION_ID = "7861619714";
    process.env.GOOGLE_ADS_PAYMENT_CONVERSION_ACTION_ID = "7861626227";
    process.env.GOOGLE_DATA_MANAGER_OAUTH_CLIENT_ID = "client";
    process.env.GOOGLE_DATA_MANAGER_OAUTH_CLIENT_SECRET = "secret";
    process.env.GOOGLE_DATA_MANAGER_OAUTH_REFRESH_TOKEN = "refresh";
    process.env.GOOGLE_ADS_INGEST_ENABLED = "true";
    delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    claimMock.mockResolvedValue(claimedRow());
    readStatusMock.mockResolvedValue("pending");
    markAcceptedMock.mockResolvedValue(undefined);
    markErrorMock.mockResolvedValue(undefined);
    listRetryableMock.mockResolvedValue([]);
    tokenMock.mockResolvedValue("ya29.test");
    ingestMock.mockResolvedValue({ outcome: "ingestion_accepted", requestId: "req-1" });
    loadIntentMock.mockResolvedValue(intent());
  });

  it("uploads one US trial with the stored gclid and the trial action", async () => {
    const { maybeEmitGoogleAdsTrial } = await import("./stripe-conversions");
    await maybeEmitGoogleAdsTrial({
      subscription: sub(),
      intent: intent(),
      eventCreatedUnix: 1_700_000_050,
    });
    expect(claimMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "trial_started",
        stripeSubscriptionId: "sub_1",
        transactionId: "start_trial:sub_1",
        eventTime: 1_700_000_000,
        value: null,
        currency: null,
        clickType: "gclid",
        clickId: GCLID,
      })
    );
    expect(ingestMock).toHaveBeenCalledTimes(1);
    const draft = ingestMock.mock.calls[0][0].draft;
    expect(draft.kind).toBe("trial_started");
    expect(draft.valueUsd).toBeNull();
    expect(draft.click).toEqual({ type: "gclid", value: GCLID });
    expect(markAcceptedMock).toHaveBeenCalledWith("row-1", "req-1");
  });

  it("does not upload a non-US, unknown, or clickless checkout", async () => {
    const { maybeEmitGoogleAdsTrial } = await import("./stripe-conversions");
    await maybeEmitGoogleAdsTrial({
      subscription: sub(),
      intent: intent({ request_country: "DE" }),
      eventCreatedUnix: 1_700_000_000,
    });
    await maybeEmitGoogleAdsTrial({
      subscription: sub(),
      intent: intent({ request_country: null }),
      eventCreatedUnix: 1_700_000_000,
    });
    await maybeEmitGoogleAdsTrial({
      subscription: sub(),
      intent: intent({
        google_click_id: null,
        google_click_id_type: null,
        meta_fbc: "fb.1.1.Ab",
      }),
      eventCreatedUnix: 1_700_000_000,
    });
    expect(claimMock).not.toHaveBeenCalled();
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("does not upload an unrecognized price or a subscription that is not trialing", async () => {
    const { maybeEmitGoogleAdsTrial } = await import("./stripe-conversions");
    await maybeEmitGoogleAdsTrial({
      subscription: sub({ items: { data: [{ price: { id: "price_other" } }] } }),
      intent: intent(),
      eventCreatedUnix: 1_700_000_000,
    });
    await maybeEmitGoogleAdsTrial({
      subscription: sub({ status: "active", trial_end: 1_600_000_000 }),
      intent: intent(),
      eventCreatedUnix: 1_700_000_000,
    });
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("does not upload test mode or an owner canary", async () => {
    const { maybeEmitGoogleAdsTrial } = await import("./stripe-conversions");
    await maybeEmitGoogleAdsTrial({
      subscription: sub({ livemode: false }),
      intent: intent({ livemode: false }),
      eventCreatedUnix: 1_700_000_000,
    });
    await maybeEmitGoogleAdsTrial({
      subscription: sub({ metadata: { summittCanary: "owner" } }),
      intent: intent(),
      eventCreatedUnix: 1_700_000_000,
    });
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("does not post again when the trial was already accepted", async () => {
    claimMock.mockResolvedValue({ status: "ingestion_accepted" });
    const { maybeEmitGoogleAdsTrial } = await import("./stripe-conversions");
    await maybeEmitGoogleAdsTrial({
      subscription: sub(),
      intent: intent(),
      eventCreatedUnix: 1_700_000_000,
    });
    expect(ingestMock).not.toHaveBeenCalled();
    expect(markAcceptedMock).not.toHaveBeenCalled();
  });

  it("keeps a failed ingest pending and retries it later", async () => {
    ingestMock.mockResolvedValueOnce({ outcome: "not_accepted", reason: "http_500" });
    const { maybeEmitGoogleAdsTrial, retryBoundedPendingGoogleAdsConversions } = await import(
      "./stripe-conversions"
    );
    await maybeEmitGoogleAdsTrial({
      subscription: sub(),
      intent: intent(),
      eventCreatedUnix: 1_700_000_000,
    });
    expect(markErrorMock).toHaveBeenCalledWith("row-1", "http_500");
    expect(markAcceptedMock).not.toHaveBeenCalled();

    ingestMock.mockResolvedValueOnce({ outcome: "ingestion_accepted", requestId: "req-retry" });
    const createdAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    listRetryableMock.mockResolvedValue([
      {
        ...claimedRow().row,
        created_at: createdAt,
      },
    ]);
    await retryBoundedPendingGoogleAdsConversions(Date.now());
    expect(markAcceptedMock).toHaveBeenCalledWith("row-1", "req-retry");
  });

  it("does not call Google when ingestion is disabled or credentials are missing", async () => {
    delete process.env.GOOGLE_ADS_INGEST_ENABLED;
    const { maybeEmitGoogleAdsTrial } = await import("./stripe-conversions");
    await maybeEmitGoogleAdsTrial({
      subscription: sub(),
      intent: intent(),
      eventCreatedUnix: 1_700_000_000,
    });
    expect(claimMock).toHaveBeenCalledTimes(1);
    expect(ingestMock).not.toHaveBeenCalled();
    expect(markErrorMock).toHaveBeenCalledWith("row-1", "ingest_disabled");

    claimMock.mockClear();
    markErrorMock.mockClear();
    process.env.GOOGLE_ADS_INGEST_ENABLED = "true";
    delete process.env.GOOGLE_DATA_MANAGER_OAUTH_REFRESH_TOKEN;
    await maybeEmitGoogleAdsTrial({
      subscription: sub(),
      intent: intent(),
      eventCreatedUnix: 1_700_000_000,
    });
    expect(claimMock).toHaveBeenCalledTimes(1);
    expect(tokenMock).not.toHaveBeenCalled();
    expect(ingestMock).not.toHaveBeenCalled();
    expect(markErrorMock).toHaveBeenCalledWith("row-1", "credentials_missing");
  });

  it("uploads the first monthly and annual payments and skips renewals and zero-dollar invoices", async () => {
    const { maybeEmitGoogleAdsFirstPayment } = await import("./stripe-conversions");
    const paidSub = sub({ status: "active" });
    await maybeEmitGoogleAdsFirstPayment({
      stripe: stripeClient(),
      invoice: invoice(),
      subscription: paidSub,
      intent: intent(),
      eventCreatedUnix: 1_700_604_900,
    });
    expect(claimMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: "first_payment",
        transactionId: "subscribe:sub_1",
        eventTime: 1_700_604_800,
        value: 29.99,
        currency: "USD",
      })
    );

    claimMock.mockClear();
    ingestMock.mockClear();
    await maybeEmitGoogleAdsFirstPayment({
      stripe: stripeClient(),
      invoice: invoice({ id: "in_year", amount_paid: 24900 }),
      subscription: sub({
        status: "active",
        items: { data: [{ price: { id: ANNUAL } }] },
      }),
      intent: intent({ google_click_id_type: "wbraid", google_click_id: "wbraid_1" }),
      eventCreatedUnix: 1_700_604_900,
    });
    expect(claimMock).toHaveBeenCalledWith(
      expect.objectContaining({ value: 249, clickType: "wbraid", clickId: "wbraid_1" })
    );

    claimMock.mockClear();
    await maybeEmitGoogleAdsFirstPayment({
      stripe: stripeClient([{ id: "in_old", amount_paid: 2999 }]),
      invoice: invoice({ id: "in_renewal" }),
      subscription: paidSub,
      intent: intent(),
      eventCreatedUnix: 1_700_604_900,
    });
    await maybeEmitGoogleAdsFirstPayment({
      stripe: stripeClient(),
      invoice: invoice({ amount_paid: 0 }),
      subscription: paidSub,
      intent: intent(),
      eventCreatedUnix: 1_700_604_900,
    });
    await maybeEmitGoogleAdsFirstPayment({
      stripe: stripeClient(),
      invoice: invoice({ currency: "eur" }),
      subscription: paidSub,
      intent: intent(),
      eventCreatedUnix: 1_700_604_900,
    });
    expect(claimMock).not.toHaveBeenCalled();
  });

  it("still returns when Google throws", async () => {
    ingestMock.mockRejectedValue(new Error("socket hang up"));
    const { maybeEmitGoogleAdsTrial } = await import("./stripe-conversions");
    await expect(
      maybeEmitGoogleAdsTrial({
        subscription: sub(),
        intent: intent(),
        eventCreatedUnix: 1_700_000_000,
      })
    ).resolves.toBeUndefined();
  });
});
