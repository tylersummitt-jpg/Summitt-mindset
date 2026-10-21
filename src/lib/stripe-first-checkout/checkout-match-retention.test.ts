import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fromMock = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

const listPendingMock = vi.fn();
vi.mock("@/lib/meta-conversion-ledger", async () => {
  const actual = await vi.importActual<typeof import("@/lib/meta-conversion-ledger")>(
    "@/lib/meta-conversion-ledger"
  );
  return {
    ...actual,
    listPendingMetaConversionsForSubscription: (...args: unknown[]) => listPendingMock(...args),
  };
});

const loadWebMock = vi.fn();
vi.mock("@/lib/meta-capi-web-identifiers", () => ({
  loadMetaCapiWebIdentifiersForUser: (...args: unknown[]) => loadWebMock(...args),
}));

import { googleClickIdFromIntent } from "@/lib/marketing-attribution-pure";
import {
  CHECKOUT_MATCH_PAYMENT_WINDOW_MS,
  clearCheckoutMatchFieldsForClerkUser,
  clearStaleCheckoutMatchFields,
  loadIntentBySubscriptionId,
  saveCheckoutMatchFields,
  saveGoogleClickId,
  shouldClearCheckoutMatch,
  shouldClearGoogleClickId,
} from "@/lib/stripe-first-checkout/intent-store";

const NOW = Date.parse("2026-10-19T15:00:00.000Z");
const FBC = "fb.1.1700000000000.AbCdEf";
const GCLID = "Cj0KCQtestGclid123";

function intentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent_1",
    stripe_subscription_id: null,
    binding_expires_at: new Date(NOW - 60_000).toISOString(),
    clerk_user_id: null,
    stripe_trial_end_at: null,
    meta_fbc: FBC,
    meta_fbp: null,
    client_ip: null,
    client_user_agent: null,
    ...overrides,
  };
}

function mockCleanupQueries(args: { abandoned: unknown[]; linked: unknown[] }) {
  const kinds: string[] = [];
  const limits: number[] = [];
  const updateEq = vi.fn(async () => ({ error: null }));
  fromMock.mockImplementation(() => {
    let kind = "unknown";
    const chain = {
      select() {
        return chain;
      },
      is(column: string, value: unknown) {
        if (column === "stripe_subscription_id" && value === null) kind = "abandoned";
        return chain;
      },
      not(column: string) {
        if (column === "stripe_subscription_id") kind = "linked";
        return chain;
      },
      lt() {
        return chain;
      },
      lte() {
        return chain;
      },
      or() {
        return chain;
      },
      limit(count: number) {
        kinds.push(kind);
        limits.push(count);
        const data =
          kind === "abandoned" ? args.abandoned : kind === "linked" ? args.linked : args.linked;
        return Promise.resolve({ data, error: null });
      },
      update(patch: Record<string, unknown>) {
        return {
          eq: (...eqArgs: unknown[]) => updateEq(patch, ...eqArgs),
        };
      },
    };
    return chain;
  });
  return { kinds, limits, updateEq };
}

describe("checkout match retention", () => {
  it("keeps an open checkout and a trial that can still convert", () => {
    expect(
      shouldClearCheckoutMatch({
        nowMs: NOW,
        stripeSubscriptionId: null,
        bindingExpiresAt: new Date(NOW + 60_000).toISOString(),
        clerkUserId: null,
        clerkCopyPresent: false,
        pendingInWindow: false,
        trialEndAt: null,
      })
    ).toBe(false);
    expect(
      shouldClearCheckoutMatch({
        nowMs: NOW,
        stripeSubscriptionId: "sub_1",
        bindingExpiresAt: new Date(NOW - 60_000).toISOString(),
        clerkUserId: null,
        clerkCopyPresent: false,
        pendingInWindow: false,
        trialEndAt: new Date(NOW + 86_400_000).toISOString(),
      })
    ).toBe(false);
    expect(
      shouldClearCheckoutMatch({
        nowMs: NOW,
        stripeSubscriptionId: "sub_1",
        bindingExpiresAt: new Date(NOW - 60_000).toISOString(),
        clerkUserId: null,
        clerkCopyPresent: false,
        pendingInWindow: true,
        trialEndAt: new Date(NOW - CHECKOUT_MATCH_PAYMENT_WINDOW_MS - 1000).toISOString(),
      })
    ).toBe(false);
  });

  it("clears an abandoned checkout, a copied Clerk match, and a closed payment window", () => {
    expect(
      shouldClearCheckoutMatch({
        nowMs: NOW,
        stripeSubscriptionId: null,
        bindingExpiresAt: new Date(NOW - 1000).toISOString(),
        clerkUserId: null,
        clerkCopyPresent: false,
        pendingInWindow: false,
        trialEndAt: null,
      })
    ).toBe(true);
    expect(
      shouldClearCheckoutMatch({
        nowMs: NOW,
        stripeSubscriptionId: "sub_1",
        bindingExpiresAt: new Date(NOW - 1000).toISOString(),
        clerkUserId: "user_abc",
        clerkCopyPresent: true,
        pendingInWindow: false,
        trialEndAt: new Date(NOW + 86_400_000).toISOString(),
      })
    ).toBe(true);
    expect(
      shouldClearCheckoutMatch({
        nowMs: NOW,
        stripeSubscriptionId: "sub_1",
        bindingExpiresAt: new Date(NOW - 1000).toISOString(),
        clerkUserId: null,
        clerkCopyPresent: false,
        pendingInWindow: false,
        trialEndAt: new Date(NOW - CHECKOUT_MATCH_PAYMENT_WINDOW_MS - 1000).toISOString(),
      })
    ).toBe(true);
  });
});

describe("checkout match writes", () => {
  beforeEach(() => {
    fromMock.mockReset();
    listPendingMock.mockReset();
    loadWebMock.mockReset();
    listPendingMock.mockResolvedValue([]);
    loadWebMock.mockResolvedValue(null);
  });

  it("fills empty columns and does not replace an fbc already stored", async () => {
    const eq = vi.fn();
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({
        data: {
          id: "intent_1",
          meta_fbc: FBC,
          meta_fbp: null,
          client_ip: null,
          client_user_agent: null,
        },
        error: null,
      })),
      update: vi.fn(() => query),
      then: (onFulfilled: (value: unknown) => unknown) =>
        Promise.resolve({ error: null }).then(onFulfilled),
    };
    eq.mockReturnValue(query);
    query.eq = eq;
    fromMock.mockReturnValue(query);

    await saveCheckoutMatchFields({
      intentId: "intent_1",
      fbc: "fb.1.1700000000000.NewFbc",
      fbp: "fb.1.1700000000000.1234567890",
      clientIp: "8.8.8.8",
      clientUserAgent: "Mozilla/5.0",
    });

    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        meta_fbp: "fb.1.1700000000000.1234567890",
        client_ip: "8.8.8.8",
        client_user_agent: "Mozilla/5.0",
      })
    );
    const patch = query.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch.meta_fbc).toBeUndefined();
  });

  it("does not write invalid match fields", async () => {
    await saveCheckoutMatchFields({
      intentId: "intent_1",
      fbc: "not-an-fbc",
      fbp: "not-an-fbp",
      clientIp: "10.0.0.8",
      clientUserAgent: " \u0000 ",
    });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("nulls abandoned checkout match fields after the binding expires", async () => {
    const { updateEq } = mockCleanupQueries({
      abandoned: [intentRow()],
      linked: [],
    });

    await clearStaleCheckoutMatchFields(NOW);

    expect(listPendingMock).not.toHaveBeenCalled();
    expect(updateEq).toHaveBeenCalledWith(
      expect.objectContaining({
        meta_fbc: null,
        meta_fbp: null,
        client_ip: null,
        client_user_agent: null,
      }),
      "id",
      "intent_1"
    );
    expect(updateEq.mock.calls[0]?.[0]).not.toHaveProperty("google_click_id");
    expect(updateEq.mock.calls[0]?.[0]).not.toHaveProperty("google_click_id_type");
  });

  it("keeps match fields while a conversion is still inside seven days", async () => {
    const { updateEq } = mockCleanupQueries({
      abandoned: [],
      linked: [intentRow({ stripe_subscription_id: "sub_1" })],
    });
    listPendingMock.mockResolvedValue([
      {
        id: "row-1",
        event_name: "StartTrial",
        stripe_subscription_id: "sub_1",
        meta_event_id: "start_trial:sub_1",
        event_time: Math.floor(NOW / 1000) - 3600,
        value: null,
        currency: null,
        external_id_hash: null,
        sent_at: null,
      },
    ]);

    await clearStaleCheckoutMatchFields(NOW);

    expect(updateEq).not.toHaveBeenCalled();
  });

  it("clears intent columns once the Clerk copy exists and nothing is pending", async () => {
    const { updateEq } = mockCleanupQueries({
      abandoned: [],
      linked: [
        intentRow({
          stripe_subscription_id: "sub_1",
          clerk_user_id: "user_abc",
          stripe_trial_end_at: new Date(NOW + 86_400_000).toISOString(),
        }),
      ],
    });
    loadWebMock.mockResolvedValue({
      fbc: FBC,
      fbp: null,
      clientIpAddress: "8.8.8.8",
      clientUserAgent: "Mozilla/5.0",
    });

    await clearStaleCheckoutMatchFields(NOW);

    expect(updateEq).toHaveBeenCalled();
  });

  it("clears an expired abandoned checkout while forty in-window trials fill the other batch", async () => {
    const trials = Array.from({ length: 40 }, (_, index) =>
      intentRow({
        id: `trial_${index}`,
        stripe_subscription_id: `sub_${index}`,
        stripe_trial_end_at: new Date(NOW + 86_400_000).toISOString(),
        binding_expires_at: new Date(NOW - 60_000).toISOString(),
      })
    );
    const { kinds, limits, updateEq } = mockCleanupQueries({
      abandoned: [intentRow({ id: "abandoned_1" })],
      linked: trials,
    });

    await clearStaleCheckoutMatchFields(NOW);

    expect(kinds).toEqual(["abandoned", "linked", "abandoned", "linked"]);
    expect(limits).toEqual([40, 40, 40, 40]);
    expect(updateEq).toHaveBeenCalledTimes(1);
    expect(updateEq).toHaveBeenCalledWith(
      expect.objectContaining({
        meta_fbc: null,
        meta_fbp: null,
        client_ip: null,
        client_user_agent: null,
      }),
      "id",
      "abandoned_1"
    );
    const clearedIds = updateEq.mock.calls.map((call) => call[2]);
    expect(clearedIds).not.toContain("trial_0");
    expect(clearedIds).not.toContain("trial_39");
  });
});

describe("Google click id retention", () => {
  beforeEach(() => {
    fromMock.mockReset();
    listPendingMock.mockReset();
    loadWebMock.mockReset();
    listPendingMock.mockResolvedValue([]);
    loadWebMock.mockResolvedValue(null);
  });

  it("keeps the id through trial end and the following seven days", () => {
    const trialEnd = new Date(NOW).toISOString();
    expect(
      shouldClearGoogleClickId({
        nowMs: NOW,
        stripeSubscriptionId: "sub_1",
        bindingExpiresAt: new Date(NOW - 60_000).toISOString(),
        trialEndAt: trialEnd,
      })
    ).toBe(false);
    expect(
      shouldClearGoogleClickId({
        nowMs: NOW + CHECKOUT_MATCH_PAYMENT_WINDOW_MS - 1,
        stripeSubscriptionId: "sub_1",
        bindingExpiresAt: new Date(NOW - 60_000).toISOString(),
        trialEndAt: trialEnd,
      })
    ).toBe(false);
    expect(
      shouldClearGoogleClickId({
        nowMs: NOW + CHECKOUT_MATCH_PAYMENT_WINDOW_MS,
        stripeSubscriptionId: "sub_1",
        bindingExpiresAt: new Date(NOW - 60_000).toISOString(),
        trialEndAt: trialEnd,
      })
    ).toBe(true);
    expect(
      shouldClearGoogleClickId({
        nowMs: NOW,
        stripeSubscriptionId: "sub_1",
        bindingExpiresAt: new Date(NOW - 60_000).toISOString(),
        trialEndAt: null,
      })
    ).toBe(false);
  });

  it("clears an abandoned id only after the binding expires", () => {
    expect(
      shouldClearGoogleClickId({
        nowMs: NOW,
        stripeSubscriptionId: null,
        bindingExpiresAt: new Date(NOW + 60_000).toISOString(),
        trialEndAt: null,
      })
    ).toBe(false);
    expect(
      shouldClearGoogleClickId({
        nowMs: NOW,
        stripeSubscriptionId: null,
        bindingExpiresAt: new Date(NOW - 60_000).toISOString(),
        trialEndAt: null,
      })
    ).toBe(true);
  });

  it("does not remove the id when Meta cleanup runs at trial end", async () => {
    const { updateEq } = mockCleanupQueries({
      abandoned: [],
      linked: [
        intentRow({
          stripe_subscription_id: "sub_1",
          clerk_user_id: "user_abc",
          stripe_trial_end_at: new Date(NOW).toISOString(),
          google_click_id_type: "gclid",
          google_click_id: GCLID,
        }),
      ],
    });
    loadWebMock.mockResolvedValue({
      fbc: FBC,
      fbp: null,
      clientIpAddress: "8.8.8.8",
      clientUserAgent: "Mozilla/5.0",
    });

    await clearStaleCheckoutMatchFields(NOW);

    expect(updateEq).toHaveBeenCalled();
    for (const call of updateEq.mock.calls) {
      expect(call[0]).not.toHaveProperty("google_click_id");
      expect(JSON.stringify(call)).not.toContain(GCLID);
    }
  });

  it("clears the id once seven days have passed after trial end", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { updateEq } = mockCleanupQueries({
      abandoned: [],
      linked: [
        intentRow({
          stripe_subscription_id: "sub_1",
          stripe_trial_end_at: new Date(NOW - CHECKOUT_MATCH_PAYMENT_WINDOW_MS).toISOString(),
          google_click_id_type: "gclid",
          google_click_id: GCLID,
        }),
      ],
    });

    await clearStaleCheckoutMatchFields(NOW);

    const googlePatch = updateEq.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((patch) => Object.prototype.hasOwnProperty.call(patch, "google_click_id"));
    expect(googlePatch).toMatchObject({
      google_click_id: null,
      google_click_id_type: null,
    });
    expect(googlePatch).not.toHaveProperty("meta_fbc");
    const metaPatch = updateEq.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((patch) => Object.prototype.hasOwnProperty.call(patch, "meta_fbc"));
    expect(metaPatch).not.toHaveProperty("google_click_id");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(GCLID);
    expect(JSON.stringify(error.mock.calls)).not.toContain(GCLID);
    warn.mockRestore();
    error.mockRestore();
  });

  it("recovers the stored id by Stripe subscription id", async () => {
    const row = {
      id: "intent_1",
      stripe_subscription_id: "sub_1",
      google_click_id_type: "gclid",
      google_click_id: GCLID,
      stripe_trial_end_at: new Date(NOW).toISOString(),
    };
    const chain = {
      select() {
        return chain;
      },
      eq() {
        return chain;
      },
      order() {
        return chain;
      },
      limit: async () => ({ data: [row], error: null }),
    };
    fromMock.mockReturnValue(chain);

    const loaded = await loadIntentBySubscriptionId("sub_1");
    expect(googleClickIdFromIntent(loaded)).toEqual({ type: "gclid", value: GCLID });
    expect(loaded?.stripe_subscription_id).toBe("sub_1");
  });

  it("fills an empty click id and does not replace or log it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({
        data: { id: "intent_1", google_click_id: null, google_click_id_type: null },
        error: null,
      })),
      update: vi.fn(),
      then: (onFulfilled: (value: unknown) => unknown) =>
        Promise.resolve({ error: { code: "42703", message: GCLID } }).then(onFulfilled),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.update.mockReturnValue(query);
    fromMock.mockReturnValue(query);

    await saveGoogleClickId({ intentId: "intent_1", type: "gclid", value: GCLID });

    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        google_click_id_type: "gclid",
        google_click_id: GCLID,
      })
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(GCLID);
    expect(JSON.stringify(error.mock.calls)).not.toContain(GCLID);
    expect(error).toHaveBeenCalledWith(
      "[stripe-first] intent write failed",
      expect.objectContaining({ scope: "save_google_click", code: "42703" })
    );

    query.update.mockClear();
    query.maybeSingle.mockResolvedValue({
      data: { id: "intent_1", google_click_id: GCLID, google_click_id_type: "gclid" },
      error: null,
    });
    await saveGoogleClickId({
      intentId: "intent_1",
      type: "wbraid",
      value: "WbraidTestClick123",
    });
    expect(query.update).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it("account deletion nulls the click id with the Meta match fields", async () => {
    const eq = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq }));
    fromMock.mockReturnValue({ update });

    await clearCheckoutMatchFieldsForClerkUser("user_abc");

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        meta_fbc: null,
        meta_fbp: null,
        client_ip: null,
        client_user_agent: null,
        google_click_id_type: null,
        google_click_id: null,
      })
    );
    expect(eq).toHaveBeenCalledWith("clerk_user_id", "user_abc");
  });
});
