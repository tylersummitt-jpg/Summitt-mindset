import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const currentUserMock = vi.fn();
const retrieveCustomerMock = vi.fn();
const createPortalMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  currentUser: () => currentUserMock(),
}));

vi.mock("stripe", () => {
  class StripeMock {
    customers = {
      retrieve: (...args: unknown[]) => retrieveCustomerMock(...args),
    };
    billingPortal = {
      sessions: {
        create: (...args: unknown[]) => createPortalMock(...args),
      },
    };
  }
  return { default: StripeMock };
});

const PORTAL_URL = "https://billing.stripe.com/p/session/test_123";

function portalRequest(options?: {
  url?: string;
  body?: string;
  headers?: Record<string, string>;
}): Request {
  return new Request(
    options?.url ?? "https://summittmindset.com/api/stripe/customer-portal",
    {
      method: "POST",
      headers: {
        "x-forwarded-host": "summittmindset.com",
        "x-forwarded-proto": "https",
        ...options?.headers,
      },
      body: options?.body,
    }
  );
}

describe("POST /api/stripe/customer-portal", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_portal";
    process.env.NEXT_PUBLIC_APP_URL = "https://summittmindset.com";
    authMock.mockResolvedValue({ userId: "user_1" });
    currentUserMock.mockResolvedValue({
      publicMetadata: {
        stripeCustomerId: "cus_1",
        summittSubscribed: false,
        summittPlan: null,
      },
    });
    retrieveCustomerMock.mockResolvedValue({
      id: "cus_1",
      metadata: { userId: "user_1" },
    });
    createPortalMock.mockResolvedValue({ url: PORTAL_URL });
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { POST } = await import("./route");
    const res = await POST(portalRequest());
    expect(res.status).toBe(401);
    expect(retrieveCustomerMock).not.toHaveBeenCalled();
    expect(createPortalMock).not.toHaveBeenCalled();
  });

  it("returns 404 when stripeCustomerId is missing", async () => {
    currentUserMock.mockResolvedValue({
      publicMetadata: { summittSubscribed: false },
    });
    const { POST } = await import("./route");
    const res = await POST(portalRequest());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "no_stripe_customer" });
    expect(retrieveCustomerMock).not.toHaveBeenCalled();
    expect(createPortalMock).not.toHaveBeenCalled();
  });

  it("rejects a client-supplied customer id and does not call Stripe", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      portalRequest({
        body: JSON.stringify({ stripeCustomerId: "cus_evil", customerId: "cus_evil" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_request" });
    expect(retrieveCustomerMock).not.toHaveBeenCalled();
    expect(createPortalMock).not.toHaveBeenCalled();
  });

  it("rejects a customer id in the query string", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      portalRequest({
        url: "https://summittmindset.com/api/stripe/customer-portal?customer=cus_evil",
      })
    );
    expect(res.status).toBe(400);
    expect(createPortalMock).not.toHaveBeenCalled();
  });

  it("rejects a client return_url", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      portalRequest({
        body: JSON.stringify({ return_url: "https://evil.example/phish" }),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    expect(createPortalMock).not.toHaveBeenCalled();
  });

  it("creates a payment_method_update session for the Clerk customer", async () => {
    const { POST } = await import("./route");
    const res = await POST(portalRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, url: PORTAL_URL });
    expect(retrieveCustomerMock).toHaveBeenCalledWith("cus_1");
    expect(createPortalMock).toHaveBeenCalledTimes(1);
    const params = createPortalMock.mock.calls[0][0];
    expect(params.customer).toBe("cus_1");
    expect(params.flow_data.type).toBe("payment_method_update");
    expect(params.flow_data).not.toHaveProperty("subscription_cancel");
    expect(params.flow_data).not.toHaveProperty("subscription_update");
    expect(params.return_url).toBe("https://summittmindset.com/user");
    expect(params.flow_data.after_completion).toEqual({
      type: "redirect",
      redirect: { return_url: "https://summittmindset.com/user" },
    });
  });

  it("still opens the portal when Clerk says the member is inactive", async () => {
    currentUserMock.mockResolvedValue({
      publicMetadata: {
        stripeCustomerId: "cus_1",
        summittSubscribed: false,
        summittPlan: null,
      },
    });
    const { POST } = await import("./route");
    const res = await POST(portalRequest());
    expect(res.status).toBe(200);
    expect(createPortalMock).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when Stripe customer metadata.userId does not match", async () => {
    retrieveCustomerMock.mockResolvedValue({
      id: "cus_1",
      metadata: { userId: "user_other" },
    });
    const { POST } = await import("./route");
    const res = await POST(portalRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "forbidden" });
    expect(createPortalMock).not.toHaveBeenCalled();
  });

  it("returns 403 when Stripe customer metadata.userId is missing", async () => {
    retrieveCustomerMock.mockResolvedValue({ id: "cus_1", metadata: {} });
    const { POST } = await import("./route");
    const res = await POST(portalRequest());
    expect(res.status).toBe(403);
    expect(createPortalMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a deleted Stripe customer", async () => {
    retrieveCustomerMock.mockResolvedValue({ id: "cus_1", deleted: true });
    const { POST } = await import("./route");
    const res = await POST(portalRequest());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "no_stripe_customer" });
    expect(createPortalMock).not.toHaveBeenCalled();
  });

  it("returns 404 when Stripe customer retrieve throws", async () => {
    retrieveCustomerMock.mockRejectedValue(new Error("No such customer"));
    const { POST } = await import("./route");
    const res = await POST(portalRequest());
    expect(res.status).toBe(404);
    expect(createPortalMock).not.toHaveBeenCalled();
  });

  it("uses the allowlisted /user return url and ignores an untrusted host", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      portalRequest({
        url: "https://evil.example/api/stripe/customer-portal",
        headers: {
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
        },
      })
    );
    expect(res.status).toBe(200);
    const params = createPortalMock.mock.calls[0][0];
    expect(params.return_url).toBe("https://summittmindset.com/user");
    expect(params.return_url).not.toContain("evil.example");
  });

  it("rejects a portal URL that is not billing.stripe.com", async () => {
    createPortalMock.mockResolvedValue({ url: "https://evil.example/phish" });
    const { POST } = await import("./route");
    const res = await POST(portalRequest());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "stripe_unavailable" });
  });
});

describe("strict customer.metadata.userId ownership", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_portal";
    process.env.NEXT_PUBLIC_APP_URL = "https://summittmindset.com";
    authMock.mockResolvedValue({ userId: "user_1" });
    currentUserMock.mockResolvedValue({
      publicMetadata: { stripeCustomerId: "cus_1" },
    });
    createPortalMock.mockResolvedValue({ url: PORTAL_URL });
  });

  it("matching customer.metadata.userId is allowed", async () => {
    retrieveCustomerMock.mockResolvedValue({
      id: "cus_1",
      metadata: { userId: "user_1" },
    });
    const { POST } = await import("./route");
    const res = await POST(portalRequest());
    expect(res.status).toBe(200);
    expect(createPortalMock).toHaveBeenCalledTimes(1);
    expect(createPortalMock.mock.calls[0][0].customer).toBe("cus_1");
  });

  it("missing customer.metadata.userId is 403", async () => {
    const { POST } = await import("./route");
    for (const metadata of [undefined, {}, { userId: "" }, { userId: "   " }]) {
      retrieveCustomerMock.mockResolvedValue({ id: "cus_1", metadata });
      createPortalMock.mockClear();
      const res = await POST(portalRequest());
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ok: false, error: "forbidden" });
      expect(createPortalMock).not.toHaveBeenCalled();
    }
  });

  it("mismatched customer.metadata.userId is 403", async () => {
    retrieveCustomerMock.mockResolvedValue({
      id: "cus_1",
      metadata: { userId: "user_other" },
    });
    const { POST } = await import("./route");
    const res = await POST(portalRequest());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "forbidden" });
    expect(createPortalMock).not.toHaveBeenCalled();
  });

  it("does not fall back to subscription.metadata.userId", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/stripe/customer-portal/route.ts"),
      "utf8"
    );
    expect(route).toContain("customer.metadata?.userId");
    expect(route).not.toContain("subscription.metadata");
    expect(route).not.toContain("subscriptions.retrieve");
    expect(route).not.toContain("subscriptions.list");
  });
});
