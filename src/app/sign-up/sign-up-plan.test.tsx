/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
let params = new URLSearchParams(
  `redirect_url=${encodeURIComponent("/checkout/start")}`
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: replace }),
  useSearchParams: () => params,
}));

vi.mock("@clerk/nextjs", () => ({
  SignUp: (props: {
    forceRedirectUrl?: string;
    fallbackRedirectUrl?: string;
    signInUrl?: string;
  }) => (
    <div
      data-testid="clerk-signup"
      data-force-redirect={props.forceRedirectUrl}
      data-fallback-redirect={props.fallbackRedirectUrl}
      data-sign-in-url={props.signInUrl}
    />
  ),
  useUser: () => ({ isLoaded: true, isSignedIn: false }),
}));

vi.mock("next/image", () => ({
  default: (props: { alt?: string }) => <img alt={props.alt ?? ""} />,
}));

import SignUpPage from "@/app/sign-up/[[...sign-up]]/page";

const CHECKOUT_REDIRECT = encodeURIComponent("/checkout/start");

describe("consumer sign-up plan selector", () => {
  afterEach(() => {
    cleanup();
    replace.mockReset();
    params = new URLSearchParams(`redirect_url=${CHECKOUT_REDIRECT}`);
  });

  it("defaults to monthly copy, Clerk hop, and selected Monthly chip", () => {
    render(<SignUpPage />);
    expect(screen.getByText("STEP 1 OF 3")).toBeTruthy();
    expect(screen.getByText("7 days free · then $29/month")).toBeTruthy();
    expect(screen.getByText("$0 DUE TODAY")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Monthly" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(
      screen.getByRole("button", { name: "Annual — Save $99" }).getAttribute("aria-pressed")
    ).toBe("false");
    const clerk = screen.getByTestId("clerk-signup");
    expect(clerk.getAttribute("data-force-redirect")).toBe("/checkout/start");
    expect(clerk.getAttribute("data-fallback-redirect")).toBe("/checkout/start");
    expect(clerk.getAttribute("data-sign-in-url")).toBe(
      `/sign-in?redirect_url=${CHECKOUT_REDIRECT}`
    );
    expect(screen.queryByText("$19.99")).toBeNull();
    expect(screen.queryByText("$120")).toBeNull();
  });

  it("annual sibling plan updates copy and Clerk forceRedirectUrl", () => {
    params = new URLSearchParams(
      `plan=annual&redirect_url=${CHECKOUT_REDIRECT}`
    );
    render(<SignUpPage />);
    expect(screen.getByText("7 days free · then $249/year")).toBeTruthy();
    expect(screen.getByText("Annual — Save $99")).toBeTruthy();
    expect(screen.getByText("$0 DUE TODAY")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Annual — Save $99" }).getAttribute("aria-pressed")
    ).toBe("true");
    const clerk = screen.getByTestId("clerk-signup");
    expect(clerk.getAttribute("data-force-redirect")).toBe(
      "/checkout/start?plan=annual"
    );
    expect(clerk.getAttribute("data-sign-in-url")).toBe(
      `/sign-in?plan=annual&redirect_url=${CHECKOUT_REDIRECT}`
    );
    expect(clerk.getAttribute("data-sign-in-url")).not.toContain(
      encodeURIComponent("/checkout/start?plan=annual")
    );
  });

  it("invalid plan stays monthly", () => {
    params = new URLSearchParams(
      `plan=yearly&redirect_url=${CHECKOUT_REDIRECT}`
    );
    render(<SignUpPage />);
    expect(screen.getByText("7 days free · then $29/month")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Monthly" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(screen.getByTestId("clerk-signup").getAttribute("data-force-redirect")).toBe(
      "/checkout/start"
    );
  });

  it("clicking Annual replaces URL with sibling plan=annual", async () => {
    render(<SignUpPage />);
    await userEvent.click(screen.getByRole("button", { name: "Annual — Save $99" }));
    expect(replace).toHaveBeenCalledWith(
      `/sign-up?plan=annual&redirect_url=${CHECKOUT_REDIRECT}`,
      { scroll: false }
    );
  });

  it("coach signup does not show the consumer plan selector", () => {
    params = new URLSearchParams(
      `redirect_url=${encodeURIComponent("/subscribe?src=coach")}`
    );
    render(<SignUpPage />);
    expect(screen.queryByRole("button", { name: "Monthly" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Annual — Save $99" })).toBeNull();
    expect(screen.queryByText("$249/year")).toBeNull();
    expect(screen.queryByText("$29/month")).toBeNull();
    expect(
      screen.getByTestId("clerk-signup").getAttribute("data-force-redirect")
    ).toBe("/subscribe?src=coach");
  });
});
