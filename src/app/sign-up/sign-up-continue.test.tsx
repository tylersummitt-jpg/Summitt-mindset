/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";

let params = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => params,
}));

vi.mock("@clerk/nextjs", () => ({
  SignUp: (props: {
    forceRedirectUrl?: string;
    signInForceRedirectUrl?: string;
    signInUrl?: string;
  }) => (
    <div
      data-testid="clerk-signup"
      data-force-redirect={props.forceRedirectUrl}
      data-signin-force-redirect={props.signInForceRedirectUrl}
      data-signin-url={props.signInUrl}
    />
  ),
  useUser: () => ({ isLoaded: true, isSignedIn: false }),
}));

vi.mock("next/image", () => ({
  default: () => null,
}));

import SignUpPage from "@/app/sign-up/[[...sign-up]]/page";

describe("existing-email checkout Sign Up", () => {
  afterEach(() => {
    cleanup();
    params = new URLSearchParams();
  });

  it("returns to /checkout/continue and does not open a new checkout", () => {
    params = new URLSearchParams(
      `redirect_url=${encodeURIComponent("/checkout/continue")}`
    );
    render(<SignUpPage />);
    const clerk = screen.getByTestId("clerk-signup");
    expect(clerk.getAttribute("data-force-redirect")).toBe("/checkout/continue");
    expect(clerk.getAttribute("data-signin-force-redirect")).toBe("/checkout/continue");
    expect(clerk.getAttribute("data-signin-url")).toBe(
      `/sign-in?redirect_url=${encodeURIComponent("/checkout/continue")}`
    );
    expect(screen.queryByRole("button", { name: "Monthly" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Annual/ })).toBeNull();
  });

  it("still sends a bare sign-up to onboarding", () => {
    render(<SignUpPage />);
    expect(screen.getByTestId("clerk-signup").getAttribute("data-force-redirect")).toBe(
      "/onboarding"
    );
  });

  it("keeps email mismatch from claiming or paying again", () => {
    const activate = readFileSync("src/lib/stripe-first-checkout/activate.ts", "utf8");
    const start = activate.indexOf("export async function linkExistingHostedCheckout");
    const emailCheck = activate.indexOf("intent.email !== args.signedInEmail", start);
    const cancel = activate.indexOf("cancelUnlinkedTrial", start);
    expect(emailCheck).toBeGreaterThan(start);
    expect(cancel).toBeGreaterThan(emailCheck);
    const continueClient = readFileSync(
      "src/app/checkout/hosted-test/continue/hosted-test-continue-client.tsx",
      "utf8"
    );
    expect(continueClient).not.toContain("/checkout/start");
    expect(continueClient).not.toContain("/api/stripe/create-checkout-session");
    expect(continueClient).toContain("Sign in with the email from checkout to finish.");
  });
});
