import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("server-only", () => ({}));

const insertMock = vi.fn();
const acquireMock = vi.fn();
const finishMock = vi.fn();
const ambiguousMock = vi.fn();
const blockedMock = vi.fn();
const inspectMock = vi.fn();
const holdMock = vi.fn();
const gateMock = vi.fn();
const acceptedMock = vi.fn();
const errorMock = vi.fn();
const listMock = vi.fn();
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
  claimGoogleAdsConversion: vi.fn(),
  insertOperatorGoogleAdsSend: (...args: unknown[]) => insertMock(...args),
  acquireOperatorGoogleAdsSend: (...args: unknown[]) => acquireMock(...args),
  finishOperatorGoogleAdsSend: (...args: unknown[]) => finishMock(...args),
  markOperatorGoogleAdsAmbiguous: (...args: unknown[]) => ambiguousMock(...args),
  markOperatorGoogleAdsBlocked: (...args: unknown[]) => blockedMock(...args),
  inspectGoogleAdsTrialOccupancy: (...args: unknown[]) => inspectMock(...args),
  assessOperatorSendHold: (...args: unknown[]) => holdMock(...args),
  readGoogleAdsOperatorGate: (...args: unknown[]) => gateMock(...args),
  markGoogleAdsIngestionAccepted: (...args: unknown[]) => acceptedMock(...args),
  markGoogleAdsConversionError: (...args: unknown[]) => errorMock(...args),
  listRetryableGoogleAdsConversions: (...args: unknown[]) => listMock(...args),
  readGoogleAdsConversionStatus: vi.fn(),
  GOOGLE_ADS_CONVERSION_RETRY_MIN_AGE_MS: 2 * 60 * 1000,
  GOOGLE_ADS_CONVERSION_MAX_EVENT_AGE_SECONDS: 90 * 24 * 60 * 60,
}));

vi.mock("@/lib/google-ads/data-manager-client", () => ({
  googleAdsAccessToken: (...args: unknown[]) => tokenMock(...args),
  postGoogleAdsIngest: (...args: unknown[]) => ingestMock(...args),
}));

const PRICE = "price_monthly_current";
const GCLID = "EAIaIQobChMI_test";
const NOW = 1_700_000_100;

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
    created: 1_700_000_000,
    trial_start: 1_700_000_000,
    trial_end: 1_700_000_000 + 7 * 24 * 3600,
    metadata: {},
    items: { data: [{ price: { id: PRICE } }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function claimedRow() {
  return {
    status: "locked" as const,
    row: {
      id: "row-1",
      event_kind: "trial_started" as const,
      stripe_subscription_id: "sub_1",
      transaction_id: "start_trial:sub_1",
      event_time: 1_700_000_000,
      value: null,
      currency: null,
      google_click_id_type: "gclid" as const,
      google_click_id: GCLID,
      request_country: "US" as const,
      status: "pending" as const,
      google_request_id: null,
      created_at: "2026-10-21T00:00:00.000Z",
    },
  };
}

function allowSend() {
  inspectMock.mockReset();
  inspectMock
    .mockResolvedValueOnce({ status: "empty" })
    .mockResolvedValue({
      status: "this_trial",
      ledgerStatus: "pending",
      requestId: null,
      lock: "sending",
    });
  holdMock.mockResolvedValue({ status: "clear" });
  gateMock.mockResolvedValue({ status: "pending", lock: "sending", requestId: null });
  acquireMock.mockResolvedValue({ status: "acquired" });
}

describe("operator single-trial upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_PRICE_ID_MONTHLY = PRICE;
    process.env.STRIPE_PRICE_ID_ANNUAL = "price_annual_current";
    delete process.env.STRIPE_LEGACY_PRICE_IDS;
    process.env.GOOGLE_ADS_CUSTOMER_ID = "2101350707";
    process.env.GOOGLE_ADS_TRIAL_CONVERSION_ACTION_ID = "7861619714";
    process.env.GOOGLE_ADS_PAYMENT_CONVERSION_ACTION_ID = "7861626227";
    process.env.GOOGLE_CLOUD_PROJECT_NUMBER = "123456789012";
    process.env.GOOGLE_WORKLOAD_IDENTITY_POOL_ID = "vercel";
    process.env.GOOGLE_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "vercel";
    process.env.GOOGLE_DATA_MANAGER_SERVICE_ACCOUNT_EMAIL =
      "summitt-google-ads-conversions@summitt-mindset.iam.gserviceaccount.com";
    delete process.env.GOOGLE_ADS_INGEST_ENABLED;
    delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    insertMock.mockResolvedValue(claimedRow());
    acquireMock.mockResolvedValue({ status: "acquired" });
    finishMock.mockResolvedValue(undefined);
    ambiguousMock.mockResolvedValue(undefined);
    blockedMock.mockResolvedValue(undefined);
    acceptedMock.mockResolvedValue(undefined);
    errorMock.mockResolvedValue(undefined);
    listMock.mockResolvedValue([]);
    inspectMock.mockResolvedValue({ status: "empty" });
    holdMock.mockResolvedValue({ status: "clear" });
    gateMock.mockResolvedValue({ status: "pending", lock: "sending", requestId: null });
    tokenMock.mockResolvedValue("ya29.operator-token");
    ingestMock.mockResolvedValue({ outcome: "ingestion_accepted", requestId: "req-1" });
    loadIntentMock.mockResolvedValue(intent());
  });

  it("previews a valid trial without a ledger write or a Google request", async () => {
    const loadSubscription = vi.fn(async () => sub());
    const { previewOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const result = await previewOperatorGoogleAdsTrial("sub_1", {
      loadSubscription,
      nowUnix: NOW,
    });
    expect(result).toEqual({
      eligibility: "eligible",
      subscriptionId: "sub_1",
      clickType: "gclid",
      requestCountry: "US",
      transactionId: "start_trial:sub_1",
      deliveryStatus: "not_sent",
      requestId: null,
    });
    expect(loadSubscription).toHaveBeenCalledWith("sub_1");
    expect(insertMock).not.toHaveBeenCalled();
    expect(acquireMock).not.toHaveBeenCalled();
    expect(tokenMock).not.toHaveBeenCalled();
    expect(ingestMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(GCLID);
  });

  it("rejects a non-US country and an unknown country", async () => {
    const { previewOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const nonUs = await previewOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    loadIntentMock.mockResolvedValueOnce(intent({ request_country: "CA" }));
    const canada = await previewOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    loadIntentMock.mockResolvedValueOnce(intent({ request_country: null }));
    const unknown = await previewOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    loadIntentMock.mockResolvedValueOnce(intent({ request_country: "us" }));
    const lowercase = await previewOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    expect(nonUs.deliveryStatus).toBe("not_sent");
    expect(canada).toMatchObject({
      eligibility: "ineligible",
      requestCountry: "CA",
      clickType: "gclid",
      deliveryStatus: "not_us",
    });
    expect(unknown).toMatchObject({ deliveryStatus: "unknown_country", requestCountry: null });
    expect(lowercase.deliveryStatus).toBe("not_us");
    expect(insertMock).not.toHaveBeenCalled();
    expect(JSON.stringify(canada)).not.toContain(GCLID);
  });

  it("rejects a missing click id", async () => {
    loadIntentMock.mockResolvedValue(intent({ google_click_id_type: "gclid", google_click_id: "" }));
    const { previewOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const result = await previewOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    expect(result.deliveryStatus).toBe("missing_click_id");
    expect(result.clickType).toBeNull();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects organic Google because that checkout stores no click id", async () => {
    loadIntentMock.mockResolvedValue(
      intent({ google_click_id_type: null, google_click_id: null, request_country: "US" })
    );
    const { previewOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const result = await previewOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    expect(result.deliveryStatus).toBe("missing_click_id");
    expect(insertMock).not.toHaveBeenCalled();
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("rejects an owner canary and test mode", async () => {
    const { previewOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const canary = await previewOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub({ metadata: { summittCanary: "owner" } }),
      nowUnix: NOW,
    });
    const testMode = await previewOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub({ livemode: false }),
      nowUnix: NOW,
    });
    expect(canary.deliveryStatus).toBe("owner_canary");
    expect(testMode.deliveryStatus).toBe("not_livemode");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects a trial event older than 90 days", async () => {
    const old = NOW - 91 * 24 * 60 * 60;
    const { previewOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const result = await previewOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () =>
        sub({ status: "trialing", trial_start: old, created: old, trial_end: NOW + 3600 }),
      nowUnix: NOW,
    });
    expect(result.deliveryStatus).toBe("event_too_old");
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects a trial that ended before preview", async () => {
    const { previewOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const result = await previewOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub({ status: "active", trial_end: NOW - 10 }),
      nowUnix: NOW,
    });
    expect(result.deliveryStatus).toBe("trial_inactive");
    expect(insertMock).not.toHaveBeenCalled();
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("rejects an unexpected ledger row before claiming", async () => {
    inspectMock.mockResolvedValue({ status: "blocked" });
    const { confirmOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const result = await confirmOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    expect(result.deliveryStatus).toBe("ledger_occupied");
    expect(insertMock).not.toHaveBeenCalled();
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("does not upload a suppressed or already accepted trial", async () => {
    const { confirmOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    inspectMock.mockResolvedValue({
      status: "this_trial",
      ledgerStatus: "suppressed",
      requestId: null,
      lock: "open",
    });
    const suppressed = await confirmOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    inspectMock.mockResolvedValue({
      status: "this_trial",
      ledgerStatus: "ingestion_accepted",
      requestId: "req-kept",
      lock: "open",
    });
    const accepted = await confirmOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    expect(suppressed.deliveryStatus).toBe("suppressed");
    expect(accepted).toMatchObject({
      eligibility: "eligible",
      deliveryStatus: "already_accepted",
      requestId: "req-kept",
    });
    expect(insertMock).not.toHaveBeenCalled();
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("stops when the trial ends after the claim and before the upload", async () => {
    allowSend();
    const loadSubscription = vi
      .fn()
      .mockResolvedValueOnce(sub())
      .mockResolvedValueOnce(sub({ status: "active", trial_end: NOW - 10 }));
    const { confirmOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const result = await confirmOperatorGoogleAdsTrial("sub_1", { loadSubscription, nowUnix: NOW });
    expect(result.deliveryStatus).toBe("trial_inactive");
    expect(ingestMock).not.toHaveBeenCalled();
    expect(blockedMock).toHaveBeenCalledWith("row-1");
    expect(acceptedMock).not.toHaveBeenCalled();
  });

  it("stops when another locked or accepted row is present before the upload", async () => {
    inspectMock.mockResolvedValueOnce({ status: "empty" });
    holdMock.mockResolvedValue({ status: "occupied" });
    const { confirmOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const result = await confirmOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    expect(result.deliveryStatus).toBe("ledger_occupied");
    expect(ingestMock).not.toHaveBeenCalled();
    expect(blockedMock).toHaveBeenCalledWith("row-1");
  });

  it("lets one locked insert upload and stops the other without a second write", async () => {
    inspectMock.mockResolvedValue({ status: "empty" });
    holdMock.mockResolvedValue({ status: "clear" });
    let winner = false;
    insertMock.mockImplementation(async (args: { stripeSubscriptionId?: string }) => {
      const subscriptionId = args.stripeSubscriptionId ?? "sub_1";
      if (winner) return { status: "busy" };
      winner = true;
      return {
        status: "locked",
        row: {
          ...claimedRow().row,
          id: `row-${subscriptionId}`,
          stripe_subscription_id: subscriptionId,
          transaction_id: `start_trial:${subscriptionId}`,
        },
      };
    });
    const { confirmOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const deps = {
      loadSubscription: async (id: string) => sub({ id }),
      nowUnix: NOW,
    };
    const [first, second] = await Promise.all([
      confirmOperatorGoogleAdsTrial("sub_1", deps),
      confirmOperatorGoogleAdsTrial("sub_2", deps),
    ]);
    const statuses = [first.deliveryStatus, second.deliveryStatus].sort();
    expect(statuses).toEqual(["busy", "ingestion_accepted"]);
    expect(ingestMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(acquireMock).not.toHaveBeenCalled();
    expect(blockedMock).not.toHaveBeenCalled();
  });

  it("locks an existing row in place and does not upload when that lock is busy", async () => {
    inspectMock.mockResolvedValue({ status: "empty" });
    insertMock.mockResolvedValue({ status: "existing", row: claimedRow().row });
    acquireMock.mockResolvedValue({ status: "busy" });
    const { confirmOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const result = await confirmOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    expect(result.deliveryStatus).toBe("busy");
    expect(acquireMock).toHaveBeenCalledTimes(1);
    expect(acquireMock).toHaveBeenCalledWith("row-1");
    expect(ingestMock).not.toHaveBeenCalled();
    expect(blockedMock).not.toHaveBeenCalled();
    expect(ambiguousMock).not.toHaveBeenCalled();
  });

  it("stops on an unknown insert conflict without locking or uploading", async () => {
    inspectMock.mockResolvedValue({ status: "empty" });
    insertMock.mockResolvedValue({ status: "unavailable" });
    const { confirmOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const result = await confirmOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    expect(result.deliveryStatus).toBe("ledger_unavailable");
    expect(acquireMock).not.toHaveBeenCalled();
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("sends one trial while automatic ingestion stays disabled", async () => {
    allowSend();
    const { confirmOperatorGoogleAdsTrial, retryBoundedPendingGoogleAdsConversions } =
      await import("./stripe-conversions");
    const result = await confirmOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    expect(result).toMatchObject({
      eligibility: "eligible",
      subscriptionId: "sub_1",
      clickType: "gclid",
      requestCountry: "US",
      transactionId: "start_trial:sub_1",
      deliveryStatus: "ingestion_accepted",
      requestId: "req-1",
    });
    expect(ingestMock).toHaveBeenCalledTimes(1);
    expect(ingestMock.mock.calls[0][0].draft).toMatchObject({
      kind: "trial_started",
      transactionId: "start_trial:sub_1",
      valueUsd: null,
      click: { type: "gclid", value: GCLID },
    });
    expect(acceptedMock).toHaveBeenCalledWith("row-1", "req-1");
    expect(acquireMock).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(GCLID);
    expect(JSON.stringify(result)).not.toContain("ya29");

    ingestMock.mockClear();
    tokenMock.mockClear();
    gateMock.mockResolvedValue({ status: "pending", lock: "open", requestId: null });
    listMock.mockResolvedValue([{ ...claimedRow().row, created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() }]);
    await retryBoundedPendingGoogleAdsConversions(Date.now());
    expect(ingestMock).not.toHaveBeenCalled();
    expect(tokenMock).not.toHaveBeenCalled();
    expect(errorMock).toHaveBeenCalledWith("row-1", "ingest_disabled");
  });

  it("does not send when the global ingestion flag is on", async () => {
    process.env.GOOGLE_ADS_INGEST_ENABLED = "true";
    const loadSubscription = vi.fn(async () => sub());
    const { confirmOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const result = await confirmOperatorGoogleAdsTrial("sub_1", { loadSubscription, nowUnix: NOW });
    expect(result.deliveryStatus).toBe("automatic_ingestion_enabled");
    expect(loadSubscription).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("lets only one of two overlapping confirms call Google", async () => {
    let inspections = 0;
    let held = false;
    inspectMock.mockImplementation(async () => {
      inspections += 1;
      if (inspections <= 2) return { status: "empty" };
      return { status: "this_trial", ledgerStatus: "pending", requestId: null, lock: "sending" };
    });
    insertMock.mockImplementation(async () => {
      if (held) return { status: "existing", row: claimedRow().row };
      held = true;
      return claimedRow();
    });
    acquireMock.mockResolvedValue({ status: "not_held" });
    const { confirmOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const deps = { loadSubscription: async () => sub(), nowUnix: NOW };
    const [first, second] = await Promise.all([
      confirmOperatorGoogleAdsTrial("sub_1", deps),
      confirmOperatorGoogleAdsTrial("sub_1", deps),
    ]);
    const statuses = [first.deliveryStatus, second.deliveryStatus].sort();
    expect(statuses).toEqual(["in_flight", "ingestion_accepted"]);
    expect(ingestMock).toHaveBeenCalledTimes(1);
    expect(acquireMock).toHaveBeenCalledTimes(1);
  });

  it("aborts when account deletion suppresses the row before the upload", async () => {
    allowSend();
    gateMock.mockResolvedValue({ status: "suppressed", lock: "open", requestId: null });
    const { confirmOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const result = await confirmOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    expect(result.deliveryStatus).toBe("suppressed");
    expect(ingestMock).not.toHaveBeenCalled();
    expect(acceptedMock).not.toHaveBeenCalled();
  });

  it("locks the row after a timeout or an ambiguous Google response", async () => {
    allowSend();
    ingestMock.mockResolvedValueOnce({ outcome: "not_accepted", reason: "timeout" });
    const { confirmOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const timeout = await confirmOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    expect(timeout.deliveryStatus).toBe("timeout");
    expect(ambiguousMock).toHaveBeenCalledWith("row-1");
    expect(finishMock).not.toHaveBeenCalled();

    allowSend();
    ambiguousMock.mockClear();
    ingestMock.mockResolvedValueOnce({ outcome: "not_accepted", reason: "missing_request_id" });
    const ambiguous = await confirmOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    expect(ambiguous.deliveryStatus).toBe("missing_request_id");
    expect(ambiguousMock).toHaveBeenCalledWith("row-1");
    expect(ingestMock).toHaveBeenCalledTimes(2);
  });

  it("records a definite Google rejection without leaving the send lock held", async () => {
    allowSend();
    ingestMock.mockResolvedValue({ outcome: "not_accepted", reason: "http_503" });
    const { confirmOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const result = await confirmOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    expect(result.deliveryStatus).toBe("http_503");
    expect(finishMock).toHaveBeenCalledWith("row-1", "http_503");
    expect(ambiguousMock).not.toHaveBeenCalled();
    expect(acceptedMock).not.toHaveBeenCalled();
  });

  it("does not call Google when authentication fails", async () => {
    allowSend();
    tokenMock.mockResolvedValue(null);
    const { confirmOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const result = await confirmOperatorGoogleAdsTrial("sub_1", {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    expect(result.deliveryStatus).toBe("token_rejected");
    expect(ingestMock).not.toHaveBeenCalled();
    expect(finishMock).toHaveBeenCalledWith("row-1", "token_rejected");
    expect(JSON.stringify(result)).not.toContain("ya29");
  });

  it("does not echo an invalid subscription id that could be a click id", async () => {
    const { previewOperatorGoogleAdsTrial } = await import("./stripe-conversions");
    const result = await previewOperatorGoogleAdsTrial(GCLID, {
      loadSubscription: async () => sub(),
      nowUnix: NOW,
    });
    expect(result.subscriptionId).toBe("");
    expect(result.deliveryStatus).toBe("invalid_subscription_id");
    expect(JSON.stringify(result)).not.toContain(GCLID);
    expect(loadIntentMock).not.toHaveBeenCalled();
  });

  it("leaves Stripe webhooks, cron, Meta, and both dashboards unchanged", () => {
    const root = process.cwd();
    const sender = readFileSync(join(root, "src/lib/google-ads/stripe-conversions.ts"), "utf8");
    const cron = readFileSync(join(root, "src/app/api/cron/recovery/route.ts"), "utf8");
    const webhook = readFileSync(join(root, "src/app/api/stripe/webhook/route.ts"), "utf8");
    expect(sender).not.toContain("admin-subscriber-growth");
    expect(sender).not.toContain("distribution-intelligence");
    expect(sender).not.toContain("maybeEmitMeta");
    expect(cron).not.toContain("confirmOperatorGoogleAdsTrial");
    expect(webhook).not.toContain("confirmOperatorGoogleAdsTrial");
    expect(cron).toContain("retryBoundedPendingGoogleAdsConversions");
  });
});
