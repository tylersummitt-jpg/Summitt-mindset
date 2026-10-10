import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteEqMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

describe("releaseStripeWebhookEventDedupe", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    deleteEqMock.mockResolvedValue({ error: null });
    fromMock.mockReturnValue({
      delete: () => ({ eq: deleteEqMock }),
    });
  });

  it("deletes only the current event_id row", async () => {
    const { releaseStripeWebhookEventDedupe } = await import(
      "./stripe-webhook-dedupe"
    );
    const result = await releaseStripeWebhookEventDedupe("evt_current");
    expect(result).toEqual({ ok: true });
    expect(fromMock).toHaveBeenCalledWith("stripe_webhook_events");
    expect(deleteEqMock).toHaveBeenCalledWith("event_id", "evt_current");
    expect(deleteEqMock).not.toHaveBeenCalledWith("event_id", "evt_other");
  });

  it("returns ok:false on empty event id without deleting", async () => {
    const { releaseStripeWebhookEventDedupe } = await import(
      "./stripe-webhook-dedupe"
    );
    const result = await releaseStripeWebhookEventDedupe("  ");
    expect(result).toEqual({ ok: false });
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("stripe webhook claim lease", () => {
  it("treats only a fresh claimed_at as a live worker", async () => {
    const { STRIPE_WEBHOOK_PROCESSING_LEASE_MS, stripeWebhookClaimIsLive } =
      await import("./stripe-webhook-dedupe");
    const now = Date.parse("2026-10-10T12:00:00.000Z");
    expect(
      stripeWebhookClaimIsLive(new Date(now - 1_000).toISOString(), now)
    ).toBe(true);
    expect(
      stripeWebhookClaimIsLive(
        new Date(now - STRIPE_WEBHOOK_PROCESSING_LEASE_MS - 1_000).toISOString(),
        now
      )
    ).toBe(false);
    expect(stripeWebhookClaimIsLive(null, now)).toBe(false);
    expect(stripeWebhookClaimIsLive("not-a-date", now)).toBe(false);
  });
});

describe("read, reclaim, and finish stripe webhook claims", () => {
  const maybeSingleMock = vi.fn();
  const selectEqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
  const updateMock = vi.fn();
  const eqMock = vi.fn();
  const isMock = vi.fn();
  const ltMock = vi.fn();
  const returningMock = vi.fn();
  let updateResult: { data: { event_id: string }[] | null; error: null } = {
    data: [{ event_id: "evt_finish" }],
    error: null,
  };

  function filterBuilder() {
    const builder: {
      eq: (...args: unknown[]) => typeof builder;
      is: (...args: unknown[]) => typeof builder;
      lt: (...args: unknown[]) => typeof builder;
      select: (columns: string) => Promise<typeof updateResult>;
      then: (
        resolve: (value: { error: null }) => unknown,
        reject?: (reason: unknown) => unknown
      ) => Promise<unknown>;
    } = {
      eq: (...args: unknown[]) => {
        eqMock(...args);
        return builder;
      },
      is: (...args: unknown[]) => {
        isMock(...args);
        return builder;
      },
      lt: (...args: unknown[]) => {
        ltMock(...args);
        return builder;
      },
      select: (columns: string) => {
        returningMock(columns);
        return Promise.resolve(updateResult);
      },
      then: (resolve, reject) =>
        Promise.resolve({ error: updateResult.error }).then(resolve, reject),
    };
    return builder;
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    updateResult = { data: [{ event_id: "evt_finish" }], error: null };
    maybeSingleMock.mockResolvedValue({
      data: {
        completed_at: "2026-10-10T11:00:00.000Z",
        claimed_at: "2026-10-10T10:00:00.000Z",
        legacy_unverified: false,
      },
      error: null,
    });
    fromMock.mockReturnValue({
      select: () => ({ eq: selectEqMock }),
      update: (values: { completed_at?: string; claimed_at?: string }) => {
        updateMock(values);
        return filterBuilder();
      },
    });
  });

  it("reads completed_at and claimed_at for one event", async () => {
    const { readStripeWebhookEventClaim } = await import(
      "./stripe-webhook-dedupe"
    );
    const result = await readStripeWebhookEventClaim("evt_read");
    expect(result).toEqual({
      ok: true,
      found: true,
      completedAt: "2026-10-10T11:00:00.000Z",
      claimedAt: "2026-10-10T10:00:00.000Z",
      legacyUnverified: false,
    });
    expect(fromMock).toHaveBeenCalledWith("stripe_webhook_events");
    expect(selectEqMock).toHaveBeenCalledWith("event_id", "evt_read");
  });

  it("does not treat a failed read as a finished event", async () => {
    maybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: "db down" },
    });
    const { readStripeWebhookEventClaim } = await import(
      "./stripe-webhook-dedupe"
    );
    const result = await readStripeWebhookEventClaim("evt_read");
    expect(result).toEqual({
      ok: false,
      found: false,
      completedAt: null,
      claimedAt: null,
      legacyUnverified: false,
    });
  });

  it("marks one event finished by setting completed_at", async () => {
    const { finishStripeWebhookEventDedupe } = await import(
      "./stripe-webhook-dedupe"
    );
    const now = Date.parse("2026-10-10T12:00:00.000Z");
    const result = await finishStripeWebhookEventDedupe("evt_finish", now);
    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({
      completed_at: new Date(now).toISOString(),
    });
    expect(eqMock).toHaveBeenCalledWith("event_id", "evt_finish");
    expect(eqMock).toHaveBeenCalledWith("legacy_unverified", false);
    expect(isMock).toHaveBeenCalledWith("completed_at", null);
    expect(updateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ created_at: expect.any(String) })
    );
  });

  it("reclaims only an unfinished claim whose lease has expired", async () => {
    const {
      reclaimAbandonedStripeWebhookEvent,
      STRIPE_WEBHOOK_PROCESSING_LEASE_MS,
    } = await import("./stripe-webhook-dedupe");
    const now = Date.parse("2026-10-10T12:00:00.000Z");
    const result = await reclaimAbandonedStripeWebhookEvent("evt_old", now);
    expect(result).toEqual({ ok: true, reclaimed: true });
    expect(updateMock).toHaveBeenCalledWith({
      claimed_at: new Date(now).toISOString(),
    });
    expect(eqMock).toHaveBeenCalledWith("event_id", "evt_old");
    expect(eqMock).toHaveBeenCalledWith("legacy_unverified", false);
    expect(isMock).toHaveBeenCalledWith("completed_at", null);
    expect(ltMock).toHaveBeenCalledWith(
      "claimed_at",
      new Date(now - STRIPE_WEBHOOK_PROCESSING_LEASE_MS).toISOString()
    );
    expect(returningMock).toHaveBeenCalledWith("event_id");
  });
});
