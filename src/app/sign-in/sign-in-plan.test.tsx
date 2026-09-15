/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

let params = new URLSearchParams(
  `redirect_url=${encodeURIComponent("/checkout/start")}`
);

vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
}));

vi.mock("@clerk/nextjs", () => ({
  SignIn: (props: {
    forceRedirectUrl?: string;
    signUpForceRedirectUrl?: string;
    signUpUrl?: string;
  }) => (
    <div
      data-testid="clerk-signin"
      data-force-redirect={props.forceRedirectUrl}
      data-signup-force-redirect={props.signUpForceRedirectUrl}
      data-signup-url={props.signUpUrl}
    />
  ),
  useUser: () => ({ isLoaded: true, isSignedIn: false }),
}));

vi.mock("next/image", () => ({
  default: (props: { alt?: string }) => <img alt={props.alt ?? ""} />,
}));

import SignInPage from "@/app/sign-in/[[...sign-in]]/page";

const CHECKOUT_REDIRECT = encodeURIComponent("/checkout/start");

describe("consumer sign-in plan preservation", () => {
  afterEach(() => {
    cleanup();
    params = new URLSearchParams(`redirect_url=${CHECKOUT_REDIRECT}`);
  });

  it("monthly checkout hop keeps /checkout/start after sign-in", () => {
    render(<SignInPage />);
    const clerk = screen.getByTestId("clerk-signin");
    expect(clerk.getAttribute("data-force-redirect")).toBe("/checkout/start");
    expect(clerk.getAttribute("data-signup-force-redirect")).toBe("/checkout/start");
    expect(clerk.getAttribute("data-signup-url")).toBe(
      `/sign-up?redirect_url=${CHECKOUT_REDIRECT}`
    );
  });

  it("annual sibling plan is preserved on sign-in and Sign Up toggle", () => {
    params = new URLSearchParams(
      `plan=annual&redirect_url=${CHECKOUT_REDIRECT}`
    );
    render(<SignInPage />);
    const clerk = screen.getByTestId("clerk-signin");
    expect(clerk.getAttribute("data-force-redirect")).toBe(
      "/checkout/start?plan=annual"
    );
    expect(clerk.getAttribute("data-signup-force-redirect")).toBe(
      "/checkout/start?plan=annual"
    );
    expect(clerk.getAttribute("data-signup-url")).toBe(
      `/sign-up?plan=annual&redirect_url=${CHECKOUT_REDIRECT}`
    );
    expect(clerk.getAttribute("data-signup-url")).not.toContain(
      encodeURIComponent("/checkout/start?plan=annual")
    );
  });

  it("coach sign-in ignores plan=annual", () => {
    params = new URLSearchParams(
      `plan=annual&redirect_url=${encodeURIComponent("/subscribe?src=coach")}`
    );
    render(<SignInPage />);
    const clerk = screen.getByTestId("clerk-signin");
    expect(clerk.getAttribute("data-force-redirect")).toBe("/subscribe?src=coach");
    expect(clerk.getAttribute("data-signup-url")).toBe(
      `/sign-up?redirect_url=${encodeURIComponent("/subscribe?src=coach")}`
    );
    expect(clerk.getAttribute("data-signup-url")).not.toContain("plan=annual");
  });
});
