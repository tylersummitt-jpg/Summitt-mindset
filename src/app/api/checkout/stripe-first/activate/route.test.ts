import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHECKOUT_ACTIVATE_TRACE_HEADER } from "@/lib/stripe-first-checkout/constants";

const { activateMock, continueMock, authMock, cookiesMock } = vi.hoisted(() => ({
  activateMock: vi.fn(),
  continueMock: vi.fn(),
  authMock: vi.fn(),
  cookiesMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () => cookiesMock(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/stripe-first-checkout/signup-diagnostics", () => ({
  noteActivateRetry: vi.fn(),
}));

vi.mock("@/lib/stripe-first-checkout/activate", () => ({
  activateHostedCheckout: (...args: unknown[]) => activateMock(...args),
  checkoutContinueHttpResult: (...args: unknown[]) => continueMock(...args),
}));

import { POST as hostedPost } from "@/app/api/checkout/hosted-test/activate/route";
import { POST as publicPost } from "@/app/api/checkout/stripe-first/activate/route";

const SESSION = "cs_live_secret_session_value";
const EMAIL = "member@example.com";
const TICKET = "tkt_secret_ticket_value";
const COOKIE = "bind_secret_cookie_value";
const CLERK_USER = "user_secret_clerk";
const CARD = "4242424242424242";
const BEARER = "Bearer sk_live_secret_token";

type TraceLog = { trace: string; http: number; category: string; error?: string };

const envKeys = [
  "STRIPE_SECRET_KEY",
  "CLERK_SECRET_KEY",
  "STRIPE_FIRST_CANARY_ENABLED",
] as const;
const savedEnv = new Map<string, string | undefined>();

function bind(secret: string | null) {
  cookiesMock.mockResolvedValue({
    get(name: string) {
      if (!secret || name !== "sm_checkout_bind") return undefined;
      return { value: secret };
    },
  });
}

function activateRequest() {
  return new Request("https://summittmindset.com/api/checkout/stripe-first/activate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `sm_checkout_bind=${COOKIE}`,
      authorization: BEARER,
    },
    body: JSON.stringify({
      sessionId: SESSION,
      email: EMAIL,
      ticket: TICKET,
      number: CARD,
    }),
  });
}

function traceLogs(spy: { mock: { calls: unknown[][] } }): TraceLog[] {
  return spy.mock.calls
    .filter((call) => call[0] === "[stripe-first] activate trace")
    .map((call) => call[1] as TraceLog);
}

function expectNoSecrets(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toContain(SESSION);
  expect(text).not.toContain(EMAIL);
  expect(text).not.toContain(TICKET);
  expect(text).not.toContain(COOKIE);
  expect(text).not.toContain(CLERK_USER);
  expect(text).not.toContain(CARD);
  expect(text).not.toContain("sk_live");
  expect(text).not.toContain("Bearer");
}

async function expectTraced(
  response: Response,
  spy: { mock: { calls: unknown[][] } },
  expected: { http: number; category: string; error?: string; body: unknown; cache?: string }
) {
  expect(response.status).toBe(expected.http);
  expect(await response.json()).toEqual(expected.body);
  if (expected.cache) {
    expect(response.headers.get("cache-control")).toBe(expected.cache);
  }
  const logs = traceLogs(spy);
  expect(logs).toHaveLength(1);
  expect(logs[0]).toEqual({
    trace: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    http: expected.http,
    category: expected.category,
    ...(expected.error ? { error: expected.error } : {}),
  });
  expect(response.headers.get(CHECKOUT_ACTIVATE_TRACE_HEADER)).toBe(logs[0].trace);
  expectNoSecrets(logs);
  expect(Object.keys(logs[0]).sort()).toEqual(
    (expected.error ? ["category", "error", "http", "trace"] : ["category", "http", "trace"]).sort()
  );
}

describe("checkout activate diagnostics", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    activateMock.mockReset();
    continueMock.mockReset();
    authMock.mockReset();
    cookiesMock.mockReset();
    authMock.mockResolvedValue({ userId: CLERK_USER });
    bind(COOKIE);
    for (const key of envKeys) savedEnv.set(key, process.env[key]);
    process.env.STRIPE_SECRET_KEY = "sk_test_diagnostic";
    process.env.CLERK_SECRET_KEY = "sk_test_diagnostic";
    delete process.env.STRIPE_FIRST_CANARY_ENABLED;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = savedEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
  });

  const routes = [
    { name: "public", post: publicPost },
    { name: "hosted-test", post: hostedPost },
  ];

  for (const route of routes) {
    describe(route.name, () => {
      it("records a missing binding as refused and does not activate", async () => {
        bind(null);
        const response = await route.post(activateRequest());
        await expectTraced(response, errorSpy, {
          http: 404,
          category: "refused",
          error: "refused",
          body: { error: "refused" },
        });
        expect(activateMock).not.toHaveBeenCalled();
        expect(authMock).not.toHaveBeenCalled();
        expect(continueMock).not.toHaveBeenCalled();
      });

      it.each([
        {
          name: "rejected",
          result: { status: "rejected" },
          http: 403,
          body: { error: "rejected" },
          category: "rejected",
          error: "rejected",
        },
        {
          name: "retry",
          result: { status: "retry" },
          http: 503,
          body: { error: "retry" },
          category: "retry",
          error: "retry",
        },
        {
          name: "ticket",
          result: { status: "ticket", ticket: TICKET },
          http: 200,
          body: { status: "ticket", ticket: TICKET },
          category: "ticket",
        },
        {
          name: "preserved",
          result: { status: "preserved" },
          http: 200,
          body: { status: "preserved", next: "/post-sign-in" },
          category: "preserved",
        },
        {
          name: "incomplete",
          result: { status: "incomplete" },
          http: 200,
          body: { status: "incomplete" },
          category: "incomplete",
        },
        {
          name: "unprotected",
          result: { status: "unprotected" },
          http: 200,
          body: { status: "unprotected" },
          category: "unprotected",
        },
      ])("records $name without changing its body", async (item) => {
        activateMock.mockResolvedValue(item.result);
        const response = await route.post(activateRequest());
        await expectTraced(response, errorSpy, {
          http: item.http,
          category: item.category,
          error: "error" in item ? item.error : undefined,
          body: item.body,
          cache: "no-store",
        });
        expect(activateMock).toHaveBeenCalledTimes(1);
        expect(activateMock).toHaveBeenCalledWith({
          sessionId: SESSION,
          bindingSecret: COOKIE,
        });
        expect(authMock).not.toHaveBeenCalled();
        expect(continueMock).not.toHaveBeenCalled();
      });

      it.each([
        {
          name: "continue",
          resume: { http: 200, body: { status: "continue" } },
          category: "continue",
        },
        {
          name: "account mismatch",
          resume: { http: 200, body: { status: "account_mismatch", signedIn: true } },
          category: "account_mismatch",
        },
        {
          name: "unsigned mismatch",
          resume: { http: 200, body: { status: "account_mismatch", signedIn: false } },
          category: "account_mismatch",
        },
        {
          name: "continue retry",
          resume: { http: 503, body: { error: "retry" } },
          category: "retry",
          error: "retry",
        },
        {
          name: "continue rejected",
          resume: { http: 403, body: { error: "rejected" } },
          category: "rejected",
          error: "rejected",
        },
      ])("records the continue gate result for $name", async (item) => {
        activateMock.mockResolvedValue({ status: "continue" });
        continueMock.mockResolvedValue(item.resume);
        const response = await route.post(activateRequest());
        await expectTraced(response, errorSpy, {
          http: item.resume.http,
          category: item.category,
          error: "error" in item ? item.error : undefined,
          body: item.resume.body,
          cache: "no-store",
        });
        expect(authMock).toHaveBeenCalledTimes(1);
        expect(continueMock).toHaveBeenCalledWith({
          bindingSecret: COOKIE,
          authenticatedClerkUserId: CLERK_USER,
        });
        expectNoSecrets(traceLogs(errorSpy));
      });
    });
  }

  it("keeps the public and hosted-test sign-in redirects", async () => {
    activateMock.mockResolvedValue({ status: "sign_in_required" });
    const publicResponse = await publicPost(activateRequest());
    await expectTraced(publicResponse, errorSpy, {
      http: 200,
      category: "sign_in_required",
      body: {
        status: "sign_in_required",
        signInUrl: "/sign-in?redirect_url=%2Fcheckout%2Fcontinue",
      },
      cache: "no-store",
    });

    errorSpy.mockClear();
    const hostedResponse = await hostedPost(activateRequest());
    await expectTraced(hostedResponse, errorSpy, {
      http: 200,
      category: "sign_in_required",
      body: {
        status: "sign_in_required",
        signInUrl: "/sign-in?redirect_url=%2Fcheckout%2Fhosted-test%2Fcontinue",
      },
      cache: "no-store",
    });
    expect(authMock).not.toHaveBeenCalled();
  });

  it("still rejects hosted-test sign-in outside test mode", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_diagnostic";
    process.env.CLERK_SECRET_KEY = "sk_live_diagnostic";
    activateMock.mockResolvedValue({ status: "sign_in_required" });
    const response = await hostedPost(activateRequest());
    await expectTraced(response, errorSpy, {
      http: 403,
      category: "rejected",
      error: "rejected",
      body: { error: "rejected" },
      cache: "no-store",
    });
    expectNoSecrets(traceLogs(errorSpy));
  });

  it("records an unexpected status without copying it into the log", async () => {
    activateMock.mockResolvedValue({ status: EMAIL });
    const response = await publicPost(activateRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: EMAIL });
    expect(traceLogs(errorSpy)[0]).toMatchObject({
      http: 200,
      category: "unexpected",
    });
    expectNoSecrets(traceLogs(errorSpy));
  });

  it("records a thrown activation as an exception and keeps the failure", async () => {
    activateMock.mockRejectedValue(new Error(`${SESSION} ${EMAIL} ${TICKET}`));
    await expect(publicPost(activateRequest())).rejects.toThrow(SESSION);
    expect(traceLogs(errorSpy)).toEqual([
      {
        trace: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        http: 500,
        category: "exception",
        error: "exception",
      },
    ]);
    expectNoSecrets(traceLogs(errorSpy));
  });

  it("returns the ticket body when the log throws", async () => {
    errorSpy.mockImplementation(() => {
      throw new Error("log down");
    });
    activateMock.mockResolvedValue({ status: "ticket", ticket: TICKET });
    const response = await publicPost(activateRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ticket", ticket: TICKET });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get(CHECKOUT_ACTIVATE_TRACE_HEADER)).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("gives simultaneous activations different correlation ids", async () => {
    activateMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { status: "preserved" };
    });
    const [first, second] = await Promise.all([
      publicPost(activateRequest()),
      publicPost(activateRequest()),
    ]);
    const firstId = first.headers.get(CHECKOUT_ACTIVATE_TRACE_HEADER);
    const secondId = second.headers.get(CHECKOUT_ACTIVATE_TRACE_HEADER);
    expect(firstId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(secondId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(firstId).not.toBe(secondId);
    const ids = traceLogs(errorSpy).map((log) => log.trace);
    expect(ids).toHaveLength(2);
    expect(new Set(ids)).toEqual(new Set([firstId, secondId]));
    expect(await first.json()).toEqual({ status: "preserved", next: "/post-sign-in" });
    expect(await second.json()).toEqual({ status: "preserved", next: "/post-sign-in" });
  });

  it("does not call the network while recording a response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const before = fetchSpy.mock.calls.length;
    activateMock.mockResolvedValue({ status: "retry" });
    await publicPost(activateRequest());
    await hostedPost(activateRequest());
    expect(fetchSpy.mock.calls.length).toBe(before);
  });
});
