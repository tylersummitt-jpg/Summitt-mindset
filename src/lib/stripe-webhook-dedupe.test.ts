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
