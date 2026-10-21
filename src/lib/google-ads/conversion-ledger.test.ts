import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const insertSingle = vi.fn();
const selectMaybe = vi.fn();
const updateEq = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: (...args: unknown[]) => fromMock(...args) },
}));

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    event_kind: "trial_started",
    stripe_subscription_id: "sub_1",
    transaction_id: "start_trial:sub_1",
    event_time: 1_700_000_000,
    value: null,
    currency: null,
    google_click_id_type: "gclid",
    google_click_id: "EAIaIQobChMI_test",
    request_country: "US",
    status: "pending",
    google_request_id: null,
    created_at: "2026-10-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("google ads conversion ledger", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    insertSingle.mockResolvedValue({ data: pendingRow(), error: null });
    selectMaybe.mockResolvedValue({ data: null, error: null });
    updateEq.mockResolvedValue({ error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "checkout_browser_intents") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [{ stripe_subscription_id: "sub_1" }], error: null }),
          }),
        };
      }
      return {
        insert: () => ({
          select: () => ({
            single: () => insertSingle(),
          }),
        }),
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => selectMaybe(),
            }),
            maybeSingle: () => selectMaybe(),
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: () => updateEq(),
          }),
          in: () => ({
            eq: () => updateEq(),
          }),
        }),
      };
    });
  });

  it("claims a pending trial row", async () => {
    const { claimGoogleAdsConversion } = await import("./conversion-ledger");
    const result = await claimGoogleAdsConversion({
      eventKind: "trial_started",
      stripeSubscriptionId: "sub_1",
      transactionId: "start_trial:sub_1",
      eventTime: 1_700_000_000,
      value: null,
      currency: null,
      clickType: "gclid",
      clickId: "EAIaIQobChMI_test",
    });
    expect(result.status).toBe("claimed");
    expect(fromMock).toHaveBeenCalledWith("google_ads_conversion_events");
  });

  it("does not claim a second send after ingestion was accepted", async () => {
    insertSingle.mockResolvedValue({ data: null, error: { code: "23505" } });
    selectMaybe.mockResolvedValue({
      data: pendingRow({
        status: "ingestion_accepted",
        google_request_id: "req-1",
        event_kind: "first_payment",
        transaction_id: "subscribe:sub_1",
        value: 29.99,
        currency: "USD",
      }),
      error: null,
    });
    const { claimGoogleAdsConversion } = await import("./conversion-ledger");
    const result = await claimGoogleAdsConversion({
      eventKind: "first_payment",
      stripeSubscriptionId: "sub_1",
      transactionId: "subscribe:sub_1",
      eventTime: 1_700_604_800,
      value: 29.99,
      currency: "USD",
      clickType: "gclid",
      clickId: "EAIaIQobChMI_test",
    });
    expect(result.status).toBe("ingestion_accepted");
  });

  it("suppresses pending rows and clears accepted click ids for a deleted account", async () => {
    const updates: Array<Record<string, unknown>> = [];
    fromMock.mockImplementation((table: string) => {
      if (table === "checkout_browser_intents") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [{ stripe_subscription_id: "sub_1" }],
                error: null,
              }),
          }),
        };
      }
      return {
        update: (patch: Record<string, unknown>) => ({
          in: () => ({
            eq: (_column: string, status: string) => {
              updates.push({ status, patch });
              return Promise.resolve({ error: null });
            },
          }),
        }),
      };
    });
    const { suppressGoogleAdsConversionsForClerkUser } = await import("./conversion-ledger");
    await suppressGoogleAdsConversionsForClerkUser("user_1");
    expect(updates).toEqual([
      {
        status: "pending",
        patch: expect.objectContaining({
          status: "suppressed",
          google_click_id: null,
          google_click_id_type: null,
          request_country: null,
        }),
      },
      {
        status: "ingestion_accepted",
        patch: expect.objectContaining({
          google_click_id: null,
          google_click_id_type: null,
        }),
      },
    ]);
    expect(JSON.stringify(updates)).not.toContain("EAIaIQobChMI_test");
  });

  it("drops the click id when ingestion is accepted", async () => {
    let patch: Record<string, unknown> | null = null;
    fromMock.mockImplementation(() => ({
      update: (value: Record<string, unknown>) => ({
        eq: () => ({
          eq: () => {
            patch = value;
            return Promise.resolve({ error: null });
          },
        }),
      }),
    }));
    const { markGoogleAdsIngestionAccepted } = await import("./conversion-ledger");
    await markGoogleAdsIngestionAccepted("row-1", "req-1");
    expect(patch).toMatchObject({
      status: "ingestion_accepted",
      google_request_id: "req-1",
      google_click_id: null,
      google_click_id_type: null,
    });
    expect(JSON.stringify(patch)).not.toContain("EAIa");
  });

  it("fails closed when the deletion lookup fails", async () => {
    fromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => Promise.resolve({ data: null, error: { code: "42P01" } }),
      }),
    }));
    const { suppressGoogleAdsConversionsForClerkUser } = await import("./conversion-ledger");
    await expect(suppressGoogleAdsConversionsForClerkUser("user_1")).rejects.toThrow(
      "google_ads_conversion_clear_failed"
    );
  });
});
