import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fromMock = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

vi.mock("@/lib/native-app/is-native-summitt-mindset-app-request", () => ({
  isNativeSummittMindsetAppRequestFromRequest: (req: Request) =>
    (req.headers.get("user-agent") ?? "").includes("SummittMindsetiOS") ||
    (req.headers.get("user-agent") ?? "").includes("SummittMindsetAndroid"),
}));

import {
  loadMetaCapiWebIdentifiersForUser,
  metaCapiWebIdentifiersPresenceForUser,
  persistMetaCapiWebIdentifiersFromCheckoutRequest,
  purgeMetaCapiWebIdentifiersForUser,
} from "@/lib/meta-capi-web-identifiers";

function chain(result: { data: unknown; error: unknown }) {
  const query: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => Promise<unknown>;
  } = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    insert: vi.fn(async () => ({ error: null })),
    update: vi.fn(() => query),
    delete: vi.fn(() => query),
    then: (onFulfilled, onRejected) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return query;
}

describe("meta_capi_web_identifiers store", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("persists real _fbc/_fbp/IP/UA for a Clerk user and does not log them", async () => {
    const query = chain({ data: null, error: null });
    fromMock.mockReturnValue(query);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await persistMetaCapiWebIdentifiersFromCheckoutRequest({
      userId: "user_abc",
      req: new Request("http://localhost/api/stripe/create-checkout-session", {
        headers: {
          cookie: "_fbc=fb.1.1700000000000.AbCdEf; _fbp=fb.1.1700000000000.1234567890",
          "user-agent": "Mozilla/5.0 TestBrowser",
          "x-forwarded-for": "8.8.8.8",
        },
      }),
    });
    expect(fromMock).toHaveBeenCalledWith("meta_capi_web_identifiers");
    expect(query.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        clerk_user_id: "user_abc",
        meta_fbc: "fb.1.1700000000000.AbCdEf",
        meta_fbp: "fb.1.1700000000000.1234567890",
        client_ip: "8.8.8.8",
        client_user_agent: "Mozilla/5.0 TestBrowser",
      })
    );
    const dumped = JSON.stringify(warn.mock.calls);
    expect(dumped).not.toContain("AbCdEf");
    expect(dumped).not.toContain("8.8.8.8");
    expect(dumped).not.toContain("Mozilla/5.0");
    warn.mockRestore();
  });

  it("constructs fbc from stored real fbclid + first timestamp when _fbc is missing", async () => {
    const query = chain({ data: null, error: null });
    fromMock.mockReturnValue(query);
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
    await persistMetaCapiWebIdentifiersFromCheckoutRequest({
      userId: "user_abc",
      req: new Request("http://localhost/api/stripe/create-checkout-session", {
        headers: {
          cookie: `sm_acq=${acq}`,
          "user-agent": "Mozilla/5.0",
          "x-forwarded-for": "1.1.1.1",
        },
      }),
    });
    expect(query.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        meta_fbclid: "AbCdEf",
        meta_fbclid_observed_at: observed,
        meta_fbc: `fb.1.${Date.parse(observed)}.AbCdEf`,
        meta_fbp: null,
      })
    );
  });

  it("does not fabricate fbp when _fbp is missing", async () => {
    const query = chain({ data: null, error: null });
    fromMock.mockReturnValue(query);
    await persistMetaCapiWebIdentifiersFromCheckoutRequest({
      userId: "user_abc",
      req: new Request("http://localhost/api/stripe/create-checkout-session", {
        headers: {
          "user-agent": "Mozilla/5.0",
          "x-forwarded-for": "8.8.8.8",
        },
      }),
    });
    const inserted = query.insert.mock.calls[0]?.[0] as { meta_fbp: unknown };
    expect(inserted.meta_fbp).toBeNull();
  });

  it("persists nothing for native iOS or Android", async () => {
    for (const ua of [
      "Mozilla/5.0 SummittMindsetiOS",
      "Mozilla/5.0 SummittMindsetAndroid",
    ]) {
      fromMock.mockClear();
      await persistMetaCapiWebIdentifiersFromCheckoutRequest({
        userId: "user_abc",
        req: new Request("http://localhost/api/stripe/create-checkout-session", {
          headers: {
            "user-agent": ua,
            cookie: "_fbc=fb.1.1700000000000.AbCdEf; _fbp=fb.1.1700000000000.1",
            "x-forwarded-for": "8.8.8.8",
          },
        }),
      });
      expect(fromMock).not.toHaveBeenCalled();
    }
  });

  it("loads identifiers by exact Clerk user id", async () => {
    const query = chain({
      data: {
        clerk_user_id: "user_abc",
        meta_fbclid: "AbCdEf",
        meta_fbclid_observed_at: "2026-09-01T12:00:00.000Z",
        meta_fbc: "fb.1.1700000000000.AbCdEf",
        meta_fbp: "fb.1.1700000000000.1234567890",
        client_ip: "8.8.8.8",
        client_user_agent: "Mozilla/5.0",
      },
      error: null,
    });
    fromMock.mockReturnValue(query);
    const match = await loadMetaCapiWebIdentifiersForUser("user_abc");
    expect(query.eq).toHaveBeenCalledWith("clerk_user_id", "user_abc");
    expect(match).toEqual({
      fbc: "fb.1.1700000000000.AbCdEf",
      fbp: "fb.1.1700000000000.1234567890",
      clientIpAddress: "8.8.8.8",
      clientUserAgent: "Mozilla/5.0",
    });
  });

  it("lookup failure returns null", async () => {
    fromMock.mockImplementation(() => {
      throw new Error("db down");
    });
    await expect(loadMetaCapiWebIdentifiersForUser("user_abc")).resolves.toBeNull();
  });

  it("purge deletes by Clerk user id and is fail-open", async () => {
    const query = chain({ data: null, error: null });
    fromMock.mockReturnValue(query);
    await purgeMetaCapiWebIdentifiersForUser("user_abc");
    expect(fromMock).toHaveBeenCalledWith("meta_capi_web_identifiers");
    expect(query.delete).toHaveBeenCalled();
    expect(query.eq).toHaveBeenCalledWith("clerk_user_id", "user_abc");

    fromMock.mockImplementation(() => {
      throw new Error("db down");
    });
    await expect(purgeMetaCapiWebIdentifiersForUser("user_abc")).resolves.toBeUndefined();
  });

  it("presence is absent when no row, present when a Clerk row exists, unknown on error", async () => {
    const missing = chain({ data: null, error: null });
    fromMock.mockReturnValue(missing);
    await expect(metaCapiWebIdentifiersPresenceForUser("user_abc")).resolves.toBe(
      "absent"
    );

    const found = chain({
      data: { clerk_user_id: "user_abc" },
      error: null,
    });
    fromMock.mockReturnValue(found);
    await expect(metaCapiWebIdentifiersPresenceForUser("user_abc")).resolves.toBe(
      "present"
    );

    fromMock.mockImplementation(() => {
      throw new Error("db down");
    });
    await expect(metaCapiWebIdentifiersPresenceForUser("user_abc")).resolves.toBe(
      "unknown"
    );
  });
});
