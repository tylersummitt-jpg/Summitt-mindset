import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const insertSingle = vi.fn();
const selectMaybeSingle = vi.fn();
const updateEq = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

describe("meta-conversion-ledger", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    insertSingle.mockResolvedValue({
      data: {
        id: "row-1",
        event_name: "StartTrial",
        stripe_subscription_id: "sub_1",
        meta_event_id: "start_trial:sub_1",
        event_time: 1700000000,
        value: null,
        currency: null,
        external_id_hash: "abc",
        sent_at: null,
      },
      error: null,
    });
    selectMaybeSingle.mockResolvedValue({ data: null, error: null });
    updateEq.mockResolvedValue({ error: null });
    fromMock.mockImplementation(() => ({
      insert: () => ({
        select: () => ({
          single: () => insertSingle(),
        }),
      }),
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => selectMaybeSingle(),
          }),
        }),
      }),
      update: () => ({
        eq: (...args: unknown[]) => updateEq(...args),
      }),
    }));
  });

  it("claims a new StartTrial row", async () => {
    const { claimMetaConversionEvent } = await import("./meta-conversion-ledger");
    const result = await claimMetaConversionEvent({
      eventName: "StartTrial",
      stripeSubscriptionId: "sub_1",
      metaEventId: "start_trial:sub_1",
      eventTime: 1700000000,
    });
    expect(result.status).toBe("claimed");
    expect(fromMock).toHaveBeenCalledWith("meta_conversion_events");
  });

  it("returns already_sent on unique conflict when sent_at is set", async () => {
    insertSingle.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate" },
    });
    selectMaybeSingle.mockResolvedValue({
      data: {
        id: "row-1",
        event_name: "Subscribe",
        stripe_subscription_id: "sub_1",
        meta_event_id: "subscribe:sub_1",
        event_time: 1700000000,
        value: 29,
        currency: "USD",
        external_id_hash: null,
        sent_at: "2026-09-02T00:00:00.000Z",
      },
      error: null,
    });
    const { claimMetaConversionEvent } = await import("./meta-conversion-ledger");
    const result = await claimMetaConversionEvent({
      eventName: "Subscribe",
      stripeSubscriptionId: "sub_1",
      metaEventId: "subscribe:sub_1",
      eventTime: 1700000000,
      value: 29,
      currency: "USD",
    });
    expect(result.status).toBe("already_sent");
  });

  it("returns pending_retry on unique conflict when sent_at is null", async () => {
    insertSingle.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate" },
    });
    selectMaybeSingle.mockResolvedValue({
      data: {
        id: "row-pending",
        event_name: "Subscribe",
        stripe_subscription_id: "sub_1",
        meta_event_id: "subscribe:sub_1",
        event_time: 1700000000,
        value: 19.99,
        currency: "USD",
        external_id_hash: "deadbeef",
        sent_at: null,
      },
      error: null,
    });
    const { claimMetaConversionEvent } = await import("./meta-conversion-ledger");
    const result = await claimMetaConversionEvent({
      eventName: "Subscribe",
      stripeSubscriptionId: "sub_1",
      metaEventId: "subscribe:sub_1",
      eventTime: 999,
      value: 249,
      currency: "USD",
    });
    expect(result).toMatchObject({
      status: "pending_retry",
      row: { id: "row-pending", value: 19.99, currency: "USD" },
    });
  });

  it("treats ledger insert failure as unavailable (Meta fail-closed, membership untouched)", async () => {
    insertSingle.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission" },
    });
    const { claimMetaConversionEvent } = await import("./meta-conversion-ledger");
    const result = await claimMetaConversionEvent({
      eventName: "StartTrial",
      stripeSubscriptionId: "sub_1",
      metaEventId: "start_trial:sub_1",
      eventTime: 1700000000,
    });
    expect(result.status).toBe("unavailable");
  });
});
