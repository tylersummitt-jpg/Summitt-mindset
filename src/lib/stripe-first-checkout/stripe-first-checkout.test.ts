import { describe, expect, it } from "vitest";

import {
  normalizeCheckoutEmail,
  stripeFirstOnboardingEmail,
  suggestEmailDomain,
  unconfirmedOnboardingEmail,
} from "@/lib/stripe-first-checkout/email-typo";
import { unprotectedAlertAlreadySent } from "@/lib/stripe-first-checkout/hold-decision";
import { hostedCheckoutCredentialMode } from "@/lib/stripe-first-checkout/credentials";
import {
  hostedTestAccessIsValid,
  signHostedTestAccess,
} from "@/lib/stripe-first-checkout/access-token";
import {
  checkoutSessionBindingMatches,
  hashCheckoutBinding,
  newCheckoutBinding,
} from "@/lib/stripe-first-checkout/binding";
import { marketingAcquisitionHref } from "@/lib/native-app/native-safe-marketing-cta";
import { sanitizeInternalRedirectUrl } from "@/lib/safe-redirect";
import { readFileSync } from "node:fs";

describe("checkout email correction helpers", () => {
  it("suggests common domain typos and accepts other domains", () => {
    expect(suggestEmailDomain("pat@gmial.com")).toBe("pat@gmail.com");
    expect(suggestEmailDomain("pat@gamil.com")).toBe("pat@gmail.com");
    expect(suggestEmailDomain("pat@example.org")).toBeNull();
  });

  it("normalizes a usable address without rejecting unusual domains", () => {
    expect(normalizeCheckoutEmail(" Pat@Example.org ")).toBe("pat@example.org");
    expect(normalizeCheckoutEmail("not-an-email")).toBeNull();
  });

  it("shows an unconfirmed address and hides a verified one", () => {
    expect(
      unconfirmedOnboardingEmail({
        primaryEmailAddressId: "email_1",
        emailAddresses: [
          { id: "email_1", emailAddress: "pat@example.com", verificationStatus: null },
        ],
      })
    ).toBe("pat@example.com");
    expect(
      unconfirmedOnboardingEmail({
        primaryEmailAddressId: "email_1",
        emailAddresses: [
          {
            id: "email_1",
            emailAddress: "pat@example.com",
            verificationStatus: "verified",
          },
        ],
      })
    ).toBeNull();
  });

  it("shows the email only for a stripe-first account with an unconfirmed address", () => {
    const address = {
      id: "email_1",
      emailAddress: "pat@example.com",
      verificationStatus: null as string | null,
    };
    expect(
      stripeFirstOnboardingEmail({
        publicMetadata: { stripeFirstReservedEmail: true },
        primaryEmailAddressId: "email_1",
        emailAddresses: [address],
      })
    ).toBe("pat@example.com");
    expect(
      stripeFirstOnboardingEmail({
        publicMetadata: {},
        primaryEmailAddressId: "email_1",
        emailAddresses: [address],
      })
    ).toBeNull();
    expect(
      stripeFirstOnboardingEmail({
        publicMetadata: { stripeFirstReservedEmail: true },
        primaryEmailAddressId: "email_1",
        emailAddresses: [{ ...address, verificationStatus: "verified" }],
      })
    ).toBeNull();
  });
});

describe("hosted test credentials and binding", () => {
  it("accepts only server test keys and ignores any requested mode", () => {
    expect(
      hostedCheckoutCredentialMode({
        stripeSecretKey: "sk_test_123",
        clerkSecretKey: "sk_test_456",
      })
    ).toBe("test");
    expect(
      hostedCheckoutCredentialMode({
        stripeSecretKey: "sk_live_123",
        clerkSecretKey: "sk_test_456",
      })
    ).toBe("refused");
    expect(
      hostedCheckoutCredentialMode({
        stripeSecretKey: "sk_test_123",
        clerkSecretKey: "sk_live_456",
      })
    ).toBe("refused");
  });

  it("expires and rejects a tampered access token", () => {
    const secret = "server-secret";
    const token = signHostedTestAccess(5_000, secret);
    expect(hostedTestAccessIsValid(token, secret, 4_000)).toBe(true);
    expect(hostedTestAccessIsValid(token, secret, 5_000)).toBe(false);
    expect(hostedTestAccessIsValid(`${token}x`, secret, 4_000)).toBe(false);
  });

  it("stores a hash and rejects a swapped checkout session", () => {
    const binding = newCheckoutBinding();
    expect(hashCheckoutBinding(binding.secret)).toBe(binding.hash);
    expect(binding.secret).not.toBe(binding.hash);
    expect(
      checkoutSessionBindingMatches({
        requestedSessionId: "cs_test_one",
        storedSessionId: "cs_test_one",
        retrievedSessionId: "cs_test_two",
        retrievedIntentId: "intent-1",
        intentId: "intent-1",
      })
    ).toBe(false);
    expect(
      checkoutSessionBindingMatches({
        requestedSessionId: "cs_test_one",
        storedSessionId: null,
        retrievedSessionId: "cs_test_one",
        retrievedIntentId: "intent-1",
        intentId: "intent-1",
      })
    ).toBe(false);
  });
});

describe("public checkout stays on the current path", () => {
  it("keeps signed-out website trial buttons on Clerk sign-up", () => {
    expect(
      marketingAcquisitionHref({ isNativeApp: false, isSignedIn: false })
    ).toBe(`/sign-up?redirect_url=${encodeURIComponent("/checkout/start")}`);
    expect(marketingAcquisitionHref({ isNativeApp: false, isSignedIn: true })).toBe(
      "/subscribe"
    );
    expect(marketingAcquisitionHref({ isNativeApp: true, isSignedIn: false })).toBe(
      "/app/sign-in"
    );
  });

  it("allows the existing-account return and not a checkout session in the sign-in redirect", () => {
    expect(sanitizeInternalRedirectUrl("/checkout/hosted-test/continue")).toBe(
      "/checkout/hosted-test/continue"
    );
    expect(
      sanitizeInternalRedirectUrl("/checkout/hosted-test/return?session_id=cs_test_123")
    ).toBeNull();
  });

  it("does not let the webhook create a Clerk user for stripe-first checkout", () => {
    const reconcile = readFileSync("src/lib/stripe-first-checkout/reconcile.ts", "utf8");
    expect(reconcile).not.toContain("sign_in_tokens");
    expect(reconcile).not.toContain("email_address_identification_status");
    expect(reconcile).not.toContain("checkout.sessions.create");
    const webhook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
    expect(webhook).toContain("stripe_webhook_events");
    expect(webhook).toContain("missing userId");
    expect(webhook).toContain("stripeFirstIntentId && !userId");
  });

  it("retries activation without starting another checkout", () => {
    const retry = readFileSync(
      "src/app/checkout/hosted-test/return/hosted-test-return-client.tsx",
      "utf8"
    );
    expect(retry).toContain("/api/checkout/hosted-test/activate");
    expect(retry).not.toContain("/api/checkout/hosted-test/start");
  });

  it("marks only a newly created checkout user, and alerts once", () => {
    const activate = readFileSync("src/lib/stripe-first-checkout/activate.ts", "utf8");
    const provision = activate.indexOf("async function provisionNewCustomer");
    const link = activate.indexOf("export async function linkExistingHostedCheckout");
    expect(activate.slice(provision, link)).toContain("markReservedCheckoutEmail: true");
    expect(activate.slice(link)).not.toContain("markReservedCheckoutEmail: true");
    expect(unprotectedAlertAlreadySent({ summittUnprotectedAlerted: "intent-1" }, "intent-1")).toBe(
      true
    );
    expect(unprotectedAlertAlreadySent({}, "intent-1")).toBe(false);
  });
});
