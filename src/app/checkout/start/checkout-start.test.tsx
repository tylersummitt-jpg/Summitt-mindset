/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const replace = vi.fn();
let userState: {
  isLoaded: boolean;
  isSignedIn: boolean;
} = { isLoaded: true, isSignedIn: true };

vi.mock("@clerk/nextjs", () => ({
  useUser: () => userState,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: replace }),
}));

import CheckoutStartClient from "@/app/checkout/start/checkout-start-client";

const assign = vi.fn();

describe("/checkout/start hop", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    replace.mockReset();
    assign.mockReset();
    userState = { isLoaded: true, isSignedIn: true };
  });

  it("server page redirects native and unsigned, links marketing before client Stripe", () => {
    const page = readFileSync(
      join(process.cwd(), "src/app/checkout/start/page.tsx"),
      "utf8"
    );
    expect(page).toContain("isNativeSummittMindsetAppRequest");
    expect(page).toContain("redirect(APP_MEMBERSHIP_PATH)");
    expect(page.indexOf("if (isNativeApp)")).toBeLessThan(
      page.indexOf("linkMarketingVisitorToClerkUser(user.id)")
    );
    expect(page.indexOf("linkMarketingVisitorToClerkUser(user.id)")).toBeLessThan(
      page.indexOf("return <CheckoutStartClient")
    );
    expect(page).toContain("fail-open");
    expect(page).toContain(
      '`/sign-up?redirect_url=${encodeURIComponent("/checkout/start")}`'
    );
    expect(page).not.toContain("src=coach");
    expect(page).not.toContain("Pat");
    expect(page).not.toContain("$249");
  });

  it("middleware treats /checkout/start as public so unsigned users can reach Sign Up", () => {
    const mw = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");
    expect(mw).toContain('"/checkout/start"');
  });

  it("unsigned client redirects to Sign Up", async () => {
    userState = { isLoaded: true, isSignedIn: false };
    render(<CheckoutStartClient />);
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        `/sign-up?redirect_url=${encodeURIComponent("/checkout/start")}`
      );
    });
  });

  it("waits while Clerk is not loaded and does not POST", async () => {
    userState = { isLoaded: false, isSignedIn: false };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutStartClient />);
    await waitFor(() => {
      expect(screen.getByText(/Opening secure checkout/i)).toBeTruthy();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("signed-in consumer POSTs monthly only and assigns Stripe URL", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ url: "https://checkout.stripe.test/cs" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { assign },
    });
    render(<CheckoutStartClient />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stripe/create-checkout-session",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ plan: "monthly" }),
      })
    );
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/cs");
    });
  });

  it("already_subscribed goes to post-sign-in; paused and pending go to subscribe", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: "already_subscribed" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutStartClient />);
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/post-sign-in");
    });

    cleanup();
    replace.mockReset();
    userState = { isLoaded: true, isSignedIn: true };
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: "membership_paused", action: "resume" }),
    }));
    render(<CheckoutStartClient />);
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/subscribe");
    });

    cleanup();
    replace.mockReset();
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: "checkout_pending" }),
    }));
    render(<CheckoutStartClient />);
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/subscribe");
    });
  });

  it("checkout_processing stays on hop retry UI instead of subscribe", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        error: "checkout_processing",
        message: "Your checkout is still finishing. Please wait a moment and try again.",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutStartClient />);
    await waitFor(() => {
      expect(screen.getByText(/still finishing/i)).toBeTruthy();
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("checkout_unavailable stays on hop retry UI instead of subscribe", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        error: "checkout_unavailable",
        message:
          "Checkout could not be restarted. Please try again in a little while.",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutStartClient />);
    await waitFor(() => {
      expect(screen.getByText(/could not be restarted/i)).toBeTruthy();
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows retry UI on 500 and does not loop automatically", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<CheckoutStartClient />);
    await waitFor(() => {
      expect(screen.getByText(/didn’t start/i)).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("coach funnel links remain on /subscribe?src=coach", () => {
    const coach = readFileSync(
      join(process.cwd(), "src/lib/coach-funnel-links.ts"),
      "utf8"
    );
    expect(coach).toContain("/subscribe?src=coach");
    expect(coach).not.toContain("/checkout/start");
    const nav = readFileSync(
      join(process.cwd(), "src/components/Navbar.tsx"),
      "utf8"
    );
    expect(nav).toContain(
      'SIGN_UP_WITH_COACH_SUBSCRIBE_REDIRECT = `/sign-up?redirect_url=${encodeURIComponent("/subscribe?src=coach")}`'
    );
    const signIn = readFileSync(
      join(process.cwd(), "src/app/sign-in/[[...sign-in]]/page.tsx"),
      "utf8"
    );
    expect(signIn).toContain("signUpUrlPreservingInternalRedirect");
    expect(signIn).toContain("safeCheckoutStartDestination");
    expect(signIn).toContain("signUpForceRedirectUrl={safeAfterSignUpUrl}");
  });
});
