import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

const insertMock = vi.fn();
const saveMatchMock = vi.fn();
const saveGoogleMock = vi.fn();
const attachMock = vi.fn();
const alignMock = vi.fn();
const liveCanaryMock = vi.fn();
const loadByBindingMock = vi.fn();
const createSessionMock = vi.fn();
const retrieveSessionMock = vi.fn();

vi.mock("@/lib/stripe-first-checkout/intent-store", () => ({
  alignBindingExpiry: (...args: unknown[]) => alignMock(...args),
  attachCheckoutSession: (...args: unknown[]) => attachMock(...args),
  confirmStripeTrial: vi.fn(),
  deleteUnstartedLiveIntent: vi.fn(),
  insertCheckoutIntent: (...args: unknown[]) => insertMock(...args),
  liveCanaryIntentExists: (...args: unknown[]) => liveCanaryMock(...args),
  loadIntentByBindingHash: (...args: unknown[]) => loadByBindingMock(...args),
  loadIntentById: vi.fn(),
  loadIntentBySubscriptionId: vi.fn(),
  markClerkProvisioned: vi.fn(),
  markSessionStartedForExistingUser: vi.fn(),
  markSessionStartedForProvisionedUser: vi.fn(),
  markSignInRequired: vi.fn(),
  saveCheckoutMatchFields: (...args: unknown[]) => saveMatchMock(...args),
  saveGoogleClickId: (...args: unknown[]) => saveGoogleMock(...args),
}));

vi.mock("stripe", () => {
  class StripeMock {
    checkout = {
      sessions: {
        create: (...args: unknown[]) => createSessionMock(...args),
        expire: vi.fn(),
        retrieve: (...args: unknown[]) => retrieveSessionMock(...args),
      },
    };
  }
  return { default: StripeMock };
});

import {
  beginHostedCheckout,
  resumeOrReplacePublicCheckout,
} from "@/lib/stripe-first-checkout/activate";

const MONTHLY = "price_monthly_capture";
const ANNUAL = "price_annual_capture";

function request(headers: Record<string, string> = {}) {
  return new Request("https://summittmindset.com/api/checkout/stripe-first/start", {
    method: "POST",
    headers,
  });
}

function session(livemode: boolean) {
  return {
    id: livemode ? "cs_live_1" : "cs_test_1",
    url: "https://checkout.stripe.com/c/pay/cs_test",
    livemode,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
}

describe("Stripe-first checkout match capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_capture";
    process.env.CLERK_SECRET_KEY = "sk_test_capture";
    process.env.STRIPE_PRICE_ID_MONTHLY = MONTHLY;
    process.env.STRIPE_PRICE_ID_ANNUAL = ANNUAL;
    delete process.env.STRIPE_FIRST_CANARY_ENABLED;
    insertMock.mockResolvedValue({ id: "intent_1" });
    saveMatchMock.mockResolvedValue(undefined);
    saveGoogleMock.mockResolvedValue(undefined);
    attachMock.mockResolvedValue(true);
    alignMock.mockResolvedValue(undefined);
    liveCanaryMock.mockResolvedValue(false);
    createSessionMock.mockResolvedValue(session(false));
  });

  it("stores a returning visitor's fbc for monthly checkout and still creates the same trial session", async () => {
    const result = await beginHostedCheckout({
      request: request({
        cookie: "_fbc=fb.1.1700000000000.AbCdEf; _fbp=fb.1.1700000000000.1234567890",
        "user-agent": "Mozilla/5.0 Returning",
        "x-forwarded-for": "8.8.8.8",
      }),
      plan: "monthly",
      visitorCookie: null,
      experimentId: null,
      experimentVariant: null,
      publicCheckout: true,
    });

    expect(result.url).toBe("https://checkout.stripe.com/c/pay/cs_test");
    expect(saveMatchMock).toHaveBeenCalledWith({
      intentId: "intent_1",
      fbc: "fb.1.1700000000000.AbCdEf",
      fbp: "fb.1.1700000000000.1234567890",
      clientIp: "8.8.8.8",
      clientUserAgent: "Mozilla/5.0 Returning",
    });
    expect(saveGoogleMock).not.toHaveBeenCalled();
    const params = createSessionMock.mock.calls[0]?.[0] as {
      line_items: Array<{ price: string }>;
      subscription_data: { trial_period_days: number; metadata: Record<string, string> };
      metadata: Record<string, string>;
    };
    expect(params.line_items[0]?.price).toBe(MONTHLY);
    expect(params.subscription_data.trial_period_days).toBe(7);
    expect(params.metadata.fbc).toBeUndefined();
    expect(params.metadata.meta_fbc).toBeUndefined();
    expect(JSON.stringify(params)).not.toContain("fb.1.1700000000000.AbCdEf");
  });

  it("reuses the open Checkout Session and fills match fields that were missing", async () => {
    loadByBindingMock.mockResolvedValue({
      id: "intent_reuse",
      stripe_checkout_session_id: "cs_test_open",
    });
    retrieveSessionMock.mockResolvedValue({
      id: "cs_test_open",
      url: "https://checkout.stripe.com/c/pay/cs_test_open",
      status: "open",
      livemode: false,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      metadata: { plan: "monthly" },
    });

    const result = await resumeOrReplacePublicCheckout({
      bindingSecret: "binding-secret",
      plan: "monthly",
      request: request({
        cookie: "_fbc=fb.1.1700000000000.LaterClick; _fbp=fb.1.1700000000000.1234567890",
        "user-agent": "Mozilla/5.0 Later",
        "x-forwarded-for": "8.8.4.4",
      }),
    });

    expect(result).toEqual(
      expect.objectContaining({
        action: "reuse",
        url: "https://checkout.stripe.com/c/pay/cs_test_open",
      })
    );
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(saveMatchMock).toHaveBeenCalledWith({
      intentId: "intent_reuse",
      fbc: "fb.1.1700000000000.LaterClick",
      fbp: "fb.1.1700000000000.1234567890",
      clientIp: "8.8.4.4",
      clientUserAgent: "Mozilla/5.0 Later",
    });
  });

  it("reuse still returns the existing session when match storage fails", async () => {
    loadByBindingMock.mockResolvedValue({
      id: "intent_reuse",
      stripe_checkout_session_id: "cs_test_open",
    });
    retrieveSessionMock.mockResolvedValue({
      id: "cs_test_open",
      url: "https://checkout.stripe.com/c/pay/cs_test_open",
      status: "open",
      livemode: false,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      metadata: { plan: "monthly" },
    });
    saveMatchMock.mockRejectedValue(new Error("match store down"));

    const result = await resumeOrReplacePublicCheckout({
      bindingSecret: "binding-secret",
      plan: "monthly",
      request: request({
        cookie: "_fbc=fb.1.1700000000000.LaterClick",
        "user-agent": "Mozilla/5.0 Later",
      }),
    });

    expect(result).toEqual(
      expect.objectContaining({
        action: "reuse",
        url: "https://checkout.stripe.com/c/pay/cs_test_open",
      })
    );
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("stores constructed fbc for annual checkout when only fbclid is present", async () => {
    const observed = "2026-09-01T12:00:00.000Z";
    const acq = encodeURIComponent(
      JSON.stringify({
        v: 1,
        first_touch_at: observed,
        utm_source: "facebook",
        utm_medium: "paid",
        utm_campaign: null,
        utm_content: null,
        gclid_present: false,
        fbclid_present: true,
        referrer_host: null,
        source_normalized: "meta",
        is_paid_acquisition: true,
        source_detail: null,
        meta_fbclid: "AbCdEf",
        meta_fbclid_observed_at: observed,
      })
    );
    const result = await beginHostedCheckout({
      request: request({
        cookie: `sm_acq=${acq}`,
        "user-agent": "Mozilla/5.0",
        "x-forwarded-for": "1.1.1.1",
      }),
      plan: "annual",
      visitorCookie: null,
      experimentId: null,
      experimentVariant: null,
      publicCheckout: true,
    });

    expect(result.url).toContain("checkout.stripe.com");
    expect(saveMatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fbc: `fb.1.${Date.parse(observed)}.AbCdEf`,
        fbp: null,
        clientIp: "1.1.1.1",
      })
    );
    const params = createSessionMock.mock.calls[0]?.[0] as {
      line_items: Array<{ price: string }>;
      subscription_data: { trial_period_days: number };
    };
    expect(params.line_items[0]?.price).toBe(ANNUAL);
    expect(params.subscription_data.trial_period_days).toBe(7);
  });

  it("stores nulls for invalid fields and still returns a checkout URL", async () => {
    const result = await beginHostedCheckout({
      request: request({
        cookie: "_fbc=not-valid; _fbp=also-bad",
        "user-agent": "Mozilla/5.0",
        "x-forwarded-for": "192.168.1.9",
      }),
      plan: "monthly",
      visitorCookie: null,
      experimentId: null,
      experimentVariant: null,
      publicCheckout: true,
    });

    expect(result.url).toContain("checkout.stripe.com");
    expect(saveMatchMock).toHaveBeenCalledWith({
      intentId: "intent_1",
      fbc: null,
      fbp: null,
      clientIp: null,
      clientUserAgent: "Mozilla/5.0",
    });
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  it("does not store match fields for the owner canary", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_capture";
    process.env.CLERK_SECRET_KEY = "sk_live_capture";
    process.env.STRIPE_FIRST_CANARY_ENABLED = "true";
    createSessionMock.mockResolvedValue(session(true));

    const result = await beginHostedCheckout({
      request: request({
        cookie: "_fbc=fb.1.1700000000000.AbCdEf; _fbp=fb.1.1700000000000.1234567890",
        "user-agent": "Mozilla/5.0",
        "x-forwarded-for": "8.8.8.8",
      }),
      plan: "monthly",
      visitorCookie: null,
      experimentId: null,
      experimentVariant: null,
    });

    expect(result.url).toContain("checkout.stripe.com");
    expect(saveMatchMock).not.toHaveBeenCalled();
    expect(saveGoogleMock).not.toHaveBeenCalled();
    const params = createSessionMock.mock.calls[0]?.[0] as {
      metadata: Record<string, string>;
      subscription_data: { trial_period_days: number };
    };
    expect(params.metadata.summittCanary).toBe("owner");
    expect(params.subscription_data.trial_period_days).toBe(7);
  });

  it("returns a checkout URL when match storage throws", async () => {
    saveMatchMock.mockRejectedValue(new Error("match store down"));
    const result = await beginHostedCheckout({
      request: request({
        cookie: "_fbc=fb.1.1700000000000.AbCdEf",
        "user-agent": "Mozilla/5.0",
        "x-forwarded-for": "8.8.8.8",
      }),
      plan: "monthly",
      visitorCookie: null,
      experimentId: null,
      experimentVariant: null,
      publicCheckout: true,
    });
    expect(result.url).toContain("checkout.stripe.com");
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });

  const GCLID = "Cj0KCQtestGclid123";

  function googleCookie(click: { type: "gclid" | "wbraid" | "gbraid"; value: string } | null) {
    return `sm_acq=${encodeURIComponent(
      JSON.stringify({
        v: 1,
        first_touch_at: "2026-09-01T12:00:00.000Z",
        utm_source: "google",
        utm_medium: "cpc",
        utm_campaign: "brand_defense",
        utm_content: null,
        gclid_present: click?.type === "gclid",
        fbclid_present: false,
        referrer_host: null,
        source_normalized: "google",
        is_paid_acquisition: true,
        source_detail: null,
        meta_fbclid: null,
        meta_fbclid_observed_at: null,
        google_click_id_type: click?.type ?? null,
        google_click_id: click?.value ?? null,
      })
    )}`;
  }

  it("stores the Google click id through checkout without putting it in Stripe", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await beginHostedCheckout({
      request: request({
        cookie: googleCookie({ type: "gclid", value: GCLID }),
        "user-agent": "Mozilla/5.0",
        "x-forwarded-for": "8.8.8.8",
      }),
      plan: "monthly",
      visitorCookie: null,
      experimentId: null,
      experimentVariant: null,
      publicCheckout: true,
      attribution: {
        utmSource: "google",
        utmMedium: "cpc",
        utmCampaign: "brand_defense",
        utmContent: null,
        sourceNormalized: "google",
      },
    });

    expect(result.url).toContain("checkout.stripe.com");
    expect(saveGoogleMock).toHaveBeenCalledWith({
      intentId: "intent_1",
      type: "gclid",
      value: GCLID,
    });
    const params = createSessionMock.mock.calls[0]?.[0];
    expect(JSON.stringify(params)).not.toContain(GCLID);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(GCLID);
    expect(JSON.stringify(error.mock.calls)).not.toContain(GCLID);
    warn.mockRestore();
    error.mockRestore();
  });

  it("still checks out when the Google click id is missing or the save throws", async () => {
    const missing = await beginHostedCheckout({
      request: request({ cookie: googleCookie(null), "user-agent": "Mozilla/5.0" }),
      plan: "monthly",
      visitorCookie: null,
      experimentId: null,
      experimentVariant: null,
      publicCheckout: true,
    });
    expect(missing.url).toContain("checkout.stripe.com");
    expect(saveGoogleMock).not.toHaveBeenCalled();
    expect(createSessionMock).toHaveBeenCalledTimes(1);

    saveGoogleMock.mockRejectedValueOnce(new Error(GCLID));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failed = await beginHostedCheckout({
      request: request({
        cookie: googleCookie({ type: "wbraid", value: "WbraidTestClick123" }),
        "user-agent": "Mozilla/5.0",
      }),
      plan: "monthly",
      visitorCookie: null,
      experimentId: null,
      experimentVariant: null,
      publicCheckout: true,
    });
    expect(failed.url).toContain("checkout.stripe.com");
    expect(createSessionMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("WbraidTestClick123");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(GCLID);
    warn.mockRestore();
  });

  it("stores the click id when an open checkout is reused and does not create a new session", async () => {
    loadByBindingMock.mockResolvedValue({
      id: "intent_reuse",
      stripe_checkout_session_id: "cs_test_open",
    });
    retrieveSessionMock.mockResolvedValue({
      id: "cs_test_open",
      url: "https://checkout.stripe.com/c/pay/cs_test_open",
      status: "open",
      livemode: false,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      metadata: { plan: "monthly" },
    });

    const result = await resumeOrReplacePublicCheckout({
      bindingSecret: "binding-secret",
      plan: "monthly",
      request: request({
        cookie: googleCookie({ type: "gbraid", value: "GbraidTestClick123" }),
      }),
    });

    expect(result).toEqual(expect.objectContaining({ action: "reuse" }));
    expect(saveGoogleMock).toHaveBeenCalledWith({
      intentId: "intent_reuse",
      type: "gbraid",
      value: "GbraidTestClick123",
    });
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(JSON.stringify(retrieveSessionMock.mock.results)).not.toContain("GbraidTestClick123");
  });
});
