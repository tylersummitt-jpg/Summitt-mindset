/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";

const push = vi.fn();
const assign = vi.fn();
const reload = vi.fn();
const signInCreate = vi.fn();
const setActive = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams("session_id=cs_test_same"),
}));

vi.mock("@clerk/nextjs", () => ({
  useSignIn: () => ({
    isLoaded: true,
    signIn: { create: signInCreate },
    setActive,
  }),
}));

import { HostedTestReturnClient } from "@/app/checkout/hosted-test/return/hosted-test-return-client";
import { ONBOARDING_IDENTITY_PATH } from "@/lib/stripe-first-checkout/constants";

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

describe("hosted checkout return", () => {
  afterEach(() => {
    cleanup();
    push.mockReset();
    assign.mockReset();
    reload.mockReset();
    signInCreate.mockReset();
    setActive.mockReset();
    vi.unstubAllGlobals();
  });

  function stubLocation() {
    vi.stubGlobal("location", { assign, reload });
  }

  it("shows a same-session retry for HTTP 503 and does not claim the payment succeeded", async () => {
    stubLocation();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).sessionId).toBe("cs_test_same");
      return jsonResponse(503, { error: "retry" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<HostedTestReturnClient activatePath="/api/checkout/stripe-first/activate" />);

    expect(await screen.findByRole("heading", { name: "Finishing your free trial" })).toBeTruthy();
    expect(screen.getByText(/still confirming your membership/i)).toBeTruthy();
    expect(screen.queryByText(/payment succeeded/i)).toBeNull();
    expect(screen.queryByText(/could not be confirmed/i)).toBeNull();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toBe("/api/checkout/stripe-first/activate");
      expect(JSON.parse(String(call[1]?.body)).sessionId).toBe("cs_test_same");
    }
    const callsBeforeRetry = fetchMock.mock.calls.length;

    await userEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(callsBeforeRetry);
    expect(push).not.toHaveBeenCalled();
  });

  it("sends continue to Identity and keeps a different Clerk session off that path", async () => {
    stubLocation();
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { status: "account_mismatch", signedIn: true })
    );
    vi.stubGlobal("fetch", fetchMock);
    const mismatch = render(
      <HostedTestReturnClient activatePath="/api/checkout/stripe-first/activate" />
    );
    expect(await screen.findByRole("heading", { name: "Sign in to finish" })).toBeTruthy();
    expect(screen.getByText(/different Summitt Mindset account/i)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    mismatch.unmount();

    fetchMock.mockResolvedValue(jsonResponse(200, { status: "continue" }));
    render(<HostedTestReturnClient activatePath="/api/checkout/stripe-first/activate" />);
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(ONBOARDING_IDENTITY_PATH);
    });
  });

  it("keeps the existing-email sign-in redirect and the new-email ticket", async () => {
    stubLocation();
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        status: "sign_in_required",
        signInUrl: "/sign-in?redirect_url=%2Fcheckout%2Fcontinue",
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const signedOut = render(<HostedTestReturnClient />);
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/sign-in?redirect_url=%2Fcheckout%2Fcontinue");
    });
    expect(push).not.toHaveBeenCalled();
    signedOut.unmount();

    signInCreate.mockResolvedValue({ status: "complete", createdSessionId: "sess_new" });
    setActive.mockResolvedValue(undefined);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { status: "ticket", ticket: "ticket_1" }))
      .mockResolvedValueOnce(jsonResponse(200, { next: ONBOARDING_IDENTITY_PATH }));
    render(<HostedTestReturnClient />);
    await waitFor(() => {
      expect(signInCreate).toHaveBeenCalledWith({ strategy: "ticket", ticket: "ticket_1" });
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(ONBOARDING_IDENTITY_PATH);
    });
  });

  it("keeps rejected, incomplete, and missing-cookie copy distinct from the retry", async () => {
    stubLocation();
    const fetchMock = vi.fn(async () => jsonResponse(403, { error: "rejected" }));
    vi.stubGlobal("fetch", fetchMock);
    const rejected = render(<HostedTestReturnClient />);
    expect(await screen.findByText(/cannot be confirmed in this browser/i)).toBeTruthy();
    rejected.unmount();

    fetchMock.mockResolvedValue(jsonResponse(200, { status: "incomplete" }));
    const incomplete = render(<HostedTestReturnClient />);
    expect(await screen.findByText(/Checkout is not finished/i)).toBeTruthy();
    incomplete.unmount();

    const source = readFileSync(
      "src/app/checkout/hosted-test/return/hosted-test-return-client.tsx",
      "utf8"
    );
    expect(source).toContain("window.location.reload()");
    expect(source).not.toContain("/api/checkout/stripe-first/start");
    expect(source).not.toContain("/api/stripe/create-checkout-session");
    const publicRoute = readFileSync("src/app/api/checkout/stripe-first/activate/route.ts", "utf8");
    const hostedRoute = readFileSync("src/app/api/checkout/hosted-test/activate/route.ts", "utf8");
    for (const route of [publicRoute, hostedRoute]) {
      expect(route).toContain("await auth()");
      expect(route).toContain("checkoutContinueHttpResult");
      expect(route).not.toContain("body?.userId");
      expect(route).not.toContain("body.userId");
      expect(route).toContain('error: "retry"');
      expect(route).toContain('status: "sign_in_required"');
      expect(route).toContain('status: "ticket"');
    }
    const activate = readFileSync("src/lib/stripe-first-checkout/activate.ts", "utf8");
    expect(activate).toContain("trial_period_days: 7");
    expect(activate).toContain("cancelUnlinkedTrial");
    expect(activate).toContain("authenticatedClerkUserId: args.authenticatedClerkUserId");
    expect(activate).not.toContain("args.clerkUserIdFromBrowser");
    const gate = activate.slice(
      activate.indexOf("export async function checkoutContinueHttpResult"),
      activate.indexOf("async function requireTrial")
    );
    expect(gate).toContain("authenticatedClerkUserId: args.authenticatedClerkUserId");
    expect(gate).not.toContain("subscriptions.retrieve");
    expect(gate).not.toContain("subscriptions.update");
    expect(gate).not.toContain("subscriptions.cancel");
    expect(gate).not.toContain(".create(");
    expect(gate).not.toContain("stripeClient");
  });
});
