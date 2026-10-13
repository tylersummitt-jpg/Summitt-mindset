import { describe, expect, it } from "vitest";

import {
  normalizeCheckoutEmail,
  stripeFirstOnboardingEmail,
  suggestEmailDomain,
  unconfirmedOnboardingEmail,
} from "@/lib/stripe-first-checkout/email-typo";
import { unprotectedAlertAlreadySent } from "@/lib/stripe-first-checkout/hold-decision";
import {
  canaryCheckoutStartAllowed,
  checkoutSessionIdempotencyKey,
  hostedCheckoutCredentialMode,
  hostedCompletionAllowed,
  hostedStartAllowed,
} from "@/lib/stripe-first-checkout/credentials";
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
        stripeSecretKey: "sk_test_123",
        clerkSecretKey: "sk_test_456",
        canaryEnabled: "true",
      })
    ).toBe("test");
    expect(
      hostedCheckoutCredentialMode({
        stripeSecretKey: "sk_live_123",
        clerkSecretKey: "sk_test_456",
        canaryEnabled: "true",
      })
    ).toBe("refused");
    expect(
      hostedCheckoutCredentialMode({
        stripeSecretKey: "sk_test_123",
        clerkSecretKey: "sk_live_456",
        canaryEnabled: "true",
      })
    ).toBe("refused");
    expect(
      hostedCheckoutCredentialMode({
        stripeSecretKey: "sk_live_123",
        clerkSecretKey: "sk_live_456",
      })
    ).toBe("refused");
    expect(
      hostedCheckoutCredentialMode({
        stripeSecretKey: "sk_live_123",
        clerkSecretKey: "sk_live_456",
        canaryEnabled: "TRUE",
      })
    ).toBe("refused");
    expect(
      hostedCheckoutCredentialMode({
        stripeSecretKey: "sk_live_123",
        clerkSecretKey: "sk_live_456",
        canaryEnabled: "true",
      })
    ).toBe("canary");
  });

  it("allows one monthly canary start and leaves test plans alone", () => {
    expect(
      canaryCheckoutStartAllowed({
        mode: "canary",
        plan: "monthly",
        liveIntentExists: false,
      })
    ).toBe(true);
    expect(
      canaryCheckoutStartAllowed({
        mode: "canary",
        plan: "annual",
        liveIntentExists: false,
      })
    ).toBe(false);
    expect(
      canaryCheckoutStartAllowed({
        mode: "canary",
        plan: "monthly",
        liveIntentExists: true,
      })
    ).toBe(false);
    expect(
      canaryCheckoutStartAllowed({
        mode: "test",
        plan: "annual",
        liveIntentExists: true,
      })
    ).toBe(true);
    expect(
      canaryCheckoutStartAllowed({
        mode: "refused",
        plan: "monthly",
        liveIntentExists: false,
      })
    ).toBe(false);
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
  it("sends signed-out website trial buttons to Stripe-first checkout", () => {
    expect(
      marketingAcquisitionHref({ isNativeApp: false, isSignedIn: false })
    ).toBe("/checkout/start");
    expect(marketingAcquisitionHref({ isNativeApp: false, isSignedIn: true })).toBe(
      "/subscribe"
    );
    expect(marketingAcquisitionHref({ isNativeApp: true, isSignedIn: false })).toBe(
      "/app/sign-in"
    );
  });

  it("allows the existing-account return and not a checkout session in the sign-in redirect", () => {
    expect(sanitizeInternalRedirectUrl("/checkout/continue")).toBe("/checkout/continue");
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

  it("public activation uses the existing-account sign-in path and not the owner canary", () => {
    const start = readFileSync("src/app/api/checkout/stripe-first/start/route.ts", "utf8");
    const activate = readFileSync("src/app/api/checkout/stripe-first/activate/route.ts", "utf8");
    const hostedActivate = readFileSync(
      "src/app/api/checkout/hosted-test/activate/route.ts",
      "utf8"
    );
    expect(start).toContain("publicCheckout: true");
    expect(start).not.toContain("STRIPE_FIRST_CANARY_ENABLED");
    expect(start).not.toContain("HOSTED_TEST_ACCESS_COOKIE");
    expect(activate).toContain("PUBLIC_CHECKOUT_CONTINUE_PATH");
    expect(activate).not.toContain('!== "test"');
    expect(hostedActivate).toContain('!== "test"');
    expect(readFileSync("src/lib/admin-subscriber-growth.ts", "utf8")).toContain(
      'sub.metadata?.summittCanary !== "owner"'
    );
    expect(readFileSync("src/lib/nonmember-census.ts", "utf8")).toContain("unverified_trial");
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

describe("owner canary authorization", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  it("keeps the live monthly trial and does not use the development price", () => {
    const activate = read("src/lib/stripe-first-checkout/activate.ts");
    expect(activate).toContain("trial_period_days: 7");
    expect(activate).toContain("process.env.STRIPE_PRICE_ID_MONTHLY");
    expect(activate).not.toContain("19.99");
    expect(activate).toContain("checkoutSessionIdempotencyKey");
    expect(activate).not.toContain("stripe-first-owner-canary");
    expect(activate).toContain("CANARY_METADATA_KEY");
    expect(read("src/lib/stripe-first-checkout/constants.ts")).toContain("summittCanary");
    expect(activate).toContain("publicCheckout");
    expect(activate).toContain("PUBLIC_CHECKOUT_FLOW_KEY");
  });

  it("requires the browser authorization on every canary action", () => {
    for (const path of [
      "src/app/api/checkout/hosted-test/start/route.ts",
      "src/app/api/checkout/hosted-test/link/route.ts",
      "src/app/checkout/hosted-test/continue/page.tsx",
    ]) {
      const source = read(path);
      expect(source).toContain("HOSTED_TEST_ACCESS_COOKIE");
      expect(source).toContain("hostedCheckoutRequestAuthorized");
    }
    for (const path of [
      "src/app/api/checkout/hosted-test/activate/route.ts",
      "src/app/api/checkout/hosted-test/confirm-session/route.ts",
      "src/app/checkout/hosted-test/return/page.tsx",
    ]) {
      const source = read(path);
      expect(source).toContain("CHECKOUT_BINDING_COOKIE");
      expect(source).toContain("hostedCompletionBrowserPresent");
      expect(source).not.toContain("hostedCheckoutRequestAuthorized");
    }
    const link = read("src/app/api/checkout/hosted-test/link/route.ts");
    expect(link).toContain('hostedCheckoutCredentialModeFromEnv() !== "test"');
    const access = read("src/app/api/checkout/hosted-test/access/route.ts");
    expect(access).toContain("isTylerOwnerSession");
    expect(access).toContain("httpOnly: true");
    expect(access).toContain('sameSite: "lax"');
    expect(access).toContain("CANARY_ACCESS_MAX_AGE_SECONDS");
    const start = read("src/app/api/checkout/hosted-test/start/route.ts");
    expect(start).not.toContain("body?.livemode");
    expect(start).not.toContain("body?.mode");
    expect(start).not.toContain('from "@clerk/nextjs/server"');
    expect(start).toContain('mode === "canary" ? null');
  });

  it("does not let the canary cookie sign into an existing account", () => {
    const activate = read("src/lib/stripe-first-checkout/activate.ts");
    const link = activate.indexOf("export async function linkExistingHostedCheckout");
    expect(activate.slice(link)).toContain("CANARY_METADATA_KEY");
    expect(activate.slice(link)).toContain('{ status: "rejected" }');
    const activateRoute = read("src/app/api/checkout/hosted-test/activate/route.ts");
    expect(activateRoute).toContain('hostedCheckoutCredentialModeFromEnv() !== "test"');
    expect(activateRoute).not.toContain("console.log");
  });

  it("keys Stripe retries to one intent and still allows only one canary start", () => {
    expect(checkoutSessionIdempotencyKey("intent-a")).toBe("stripe-first-intent-a");
    expect(checkoutSessionIdempotencyKey(" intent-a ")).toBe(
      checkoutSessionIdempotencyKey("intent-a")
    );
    expect(checkoutSessionIdempotencyKey("intent-a")).not.toBe(
      checkoutSessionIdempotencyKey("intent-b")
    );
    expect(() => checkoutSessionIdempotencyKey("  ")).toThrow("intent_required");
    expect(
      canaryCheckoutStartAllowed({
        mode: "canary",
        plan: "monthly",
        liveIntentExists: true,
      })
    ).toBe(false);
  });

  it("expires the owner cookie for new starts and still finishes a stored checkout", () => {
    expect(hostedStartAllowed({ mode: "canary", accessCookieValid: true })).toBe(true);
    expect(hostedStartAllowed({ mode: "canary", accessCookieValid: false })).toBe(false);
    expect(hostedStartAllowed({ mode: "refused", accessCookieValid: true })).toBe(false);
    expect(
      hostedCompletionAllowed({
        bindingCookiePresent: true,
        sessionStored: true,
        intentLivemode: true,
        serverMode: "canary",
      })
    ).toBe(true);
    expect(
      hostedCompletionAllowed({
        bindingCookiePresent: true,
        sessionStored: true,
        intentLivemode: true,
        serverMode: "refused",
      })
    ).toBe(true);
    expect(
      hostedCompletionAllowed({
        bindingCookiePresent: false,
        sessionStored: true,
        intentLivemode: true,
        serverMode: "canary",
      })
    ).toBe(false);
    expect(
      hostedCompletionAllowed({
        bindingCookiePresent: true,
        sessionStored: false,
        intentLivemode: true,
        serverMode: "refused",
      })
    ).toBe(false);
  });

  it("leaves webhook reconciliation and normal billing outside the canary switch", () => {
    const webhook = read("src/app/api/stripe/webhook/route.ts");
    const reconcile = read("src/lib/stripe-first-checkout/reconcile.ts");
    const hold = read("src/lib/stripe-first-checkout/stripe-hold.ts");
    const checkout = read("src/app/api/stripe/create-checkout-session/route.ts");
    const cancel = read("src/lib/account-deletion/cancel-subscription.ts");
    for (const source of [webhook, reconcile, hold, checkout, cancel]) {
      expect(source).not.toContain("STRIPE_FIRST_CANARY_ENABLED");
      expect(source).not.toContain("hostedCheckoutCredentialMode");
    }
    expect(webhook).toContain("stripeFirstIntentId && !userId");
    expect(checkout).toContain("trial_period_days: 7");
  });
});
