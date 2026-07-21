import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_AUTH_INACTIVE_HOME,
  APP_AUTH_SUBSCRIBED_HOME,
  APP_POST_AUTH_PATH,
  APP_SIGN_IN_HEADING,
  APP_SIGN_IN_PATH,
  APP_SIGN_IN_SUPPORTING_COPY,
} from "@/lib/app-sign-in/app-sign-in-constants";
import {
  findEmailCodeFirstFactor,
  mapAppSignInError,
} from "@/lib/app-sign-in/app-sign-in-helpers";
import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";
import { APP_MEMBERSHIP_PATH } from "@/lib/native-app/membership-paths";

const root = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("app-specific combined email-code auth (/app/sign-in)", () => {
  it("is listed as a public middleware route without loosening unrelated routes", () => {
    const middleware = readSrc("src/middleware.ts");
    expect(middleware).toMatch(/["']\/app\/sign-in\(\.\*\)["']/);
    expect(middleware).toMatch(/["']\/sign-in\(\.\*\)["']/);
    expect(middleware).not.toMatch(/["']\/dashboard\(\.\*\)["']/);
    expect(middleware).not.toMatch(/["']\/user\(\.\*\)["']/);
    expect(middleware).not.toMatch(/["']\/admin\(\.\*\)["']/);
  });

  it("redirects already-signed-in visitors through /post-sign-in", () => {
    const page = readSrc("src/app/app/sign-in/page.tsx");
    expect(page).toContain("auth()");
    expect(page).toContain("redirect(APP_POST_AUTH_PATH)");
    expect(APP_POST_AUTH_PATH).toBe("/post-sign-in");
    expect(APP_AUTH_SUBSCRIBED_HOME).toBe(MEMBER_APP_HOME_PATH);
    expect(APP_AUTH_INACTIVE_HOME).toBe(APP_MEMBERSHIP_PATH);
  });

  it("entry screen offers Sign in and Create account without social or purchase copy", () => {
    const client = readSrc(
      "src/components/app-sign-in/AppEmailCodeSignIn.tsx"
    );
    const page = readSrc("src/app/app/sign-in/page.tsx");

    expect(APP_SIGN_IN_HEADING).toBe("Welcome to Summitt Mindset");
    expect(APP_SIGN_IN_SUPPORTING_COPY).toBe(
      "Sign in to your existing account or create a new account."
    );
    expect(client).toContain("APP_SIGN_IN_HEADING");
    expect(client).toContain("APP_SIGN_IN_SUPPORTING_COPY");
    expect(client).toMatch(/>\s*Sign in\s*</);
    expect(client).toMatch(/>\s*Create account\s*</);
    expect(client).toContain('data-app-auth-mode={mode}');
    expect(client).toContain("useSignIn");
    expect(client).toContain("useSignUp");
    expect(client).toContain("prepareEmailAddressVerification");
    expect(client).toContain("attemptEmailAddressVerification");
    expect(client).toContain('strategy: "email_code"');
    expect(client).toContain('autoComplete="one-time-code"');
    expect(client).toContain(`router.replace(APP_POST_AUTH_PATH)`);
    expect(client).toContain("APP_SIGN_IN_LEGAL_PREFIX");
    expect(client).toContain("APP_SIGN_IN_LEGAL_MID");
    expect(client).toContain('href="/terms"');
    expect(client).toContain('href="/privacy"');
    expect(client).toMatch(/>\s*Terms\s*</);
    expect(client).toMatch(/>\s*Privacy Policy\s*</);

    expect(client).not.toMatch(/\bGoogle\b/);
    expect(client).not.toMatch(/Sign in with Apple/i);
    expect(client).not.toMatch(/oauth_/i);
    expect(client).not.toMatch(/authenticateWithRedirect/);
    expect(client).not.toContain("<SignIn");
    expect(client).not.toContain("<SignUp");
    expect(client).not.toContain("SignInButton");
    expect(client).not.toMatch(/\$29|\$249/);
    expect(client).not.toMatch(/free trial/i);
    expect(client).not.toMatch(/\bSubscribe\b/);
    expect(client).not.toMatch(/\bCheckout\b/i);
    expect(client).not.toContain('href="/subscribe"');
    expect(page).not.toContain("<SignIn");
    expect(page).not.toMatch(/\bGoogle\b/);
  });

  it("unknown-email sign-in offers Create account without auto-creating", () => {
    const client = readSrc(
      "src/components/app-sign-in/AppEmailCodeSignIn.tsx"
    );
    expect(client).toContain('errorKind === "identifier_not_found"');
    expect(client).toContain('goToMode("sign-up", true)');
    // Failed sign-in must not call signUp.create in the same handler path.
    expect(client).toContain("handleSignInSendCode");
    expect(client).toContain("handleSignUpSendCode");
    expect(client.indexOf("handleSignInSendCode")).toBeLessThan(
      client.indexOf("handleSignUpSendCode")
    );
  });

  it("maps Clerk identifier errors with safe handoff kinds", () => {
    // Direct kind mapping via helper when given Clerk-shaped errors is covered
    // by string messages; identity of codes is asserted in source.
    const helpers = readSrc("src/lib/app-sign-in/app-sign-in-helpers.ts");
    expect(helpers).toContain('case "form_identifier_not_found"');
    expect(helpers).toContain('kind: "identifier_not_found"');
    expect(helpers).toContain('case "form_identifier_exists"');
    expect(helpers).toContain('kind: "identifier_exists"');
    expect(helpers).not.toMatch(/console\.(log|info|debug|warn|error)/);
  });

  it("existing-email sign-up offers Sign in instead", () => {
    const client = readSrc(
      "src/components/app-sign-in/AppEmailCodeSignIn.tsx"
    );
    expect(client).toContain('errorKind === "identifier_exists"');
    expect(client).toContain('goToMode("sign-in", true)');
    expect(client).toContain("Sign in instead");
  });

  it("post-auth destinations keep purchase gate intact", () => {
    const post = readSrc("src/app/post-sign-in/page.tsx");
    expect(post).toContain("inactiveMembershipRedirectPath");
    expect(post).toContain("MEMBER_APP_HOME_PATH");
    expect(APP_AUTH_INACTIVE_HOME).toBe("/app/membership");
    expect(APP_AUTH_SUBSCRIBED_HOME).toBe("/dashboard/victory-room");

    const checkout = readSrc(
      "src/app/api/stripe/create-checkout-session/route.ts"
    );
    expect(checkout).toContain("isNativeSummittMindsetIosRequestFromRequest");
    expect(checkout).toContain("NATIVE_APP_CHECKOUT_UNAVAILABLE_ERROR");

    const client = readSrc(
      "src/components/app-sign-in/AppEmailCodeSignIn.tsx"
    );
    expect(client).not.toContain("summittSubscribed");
    expect(client).not.toContain("updateClerkPublicMetadata");
    expect(client).not.toContain("create-checkout-session");
  });

  it("ignores arbitrary external redirect parameters", () => {
    const page = readSrc("src/app/app/sign-in/page.tsx");
    const client = readSrc(
      "src/components/app-sign-in/AppEmailCodeSignIn.tsx"
    );
    const combined = `${page}\n${client}`;

    expect(combined).not.toContain("useSearchParams");
    expect(combined).not.toContain("redirect_url");
    expect(combined).not.toContain("sanitizeInternalRedirectUrl");
    expect(combined).toContain("APP_POST_AUTH_PATH");
    expect(APP_SIGN_IN_PATH).toBe("/app/sign-in");
  });

  it("does not modify the normal website sign-in or sign-up routes", () => {
    const websiteSignIn = readSrc("src/app/sign-in/[[...sign-in]]/page.tsx");
    expect(websiteSignIn).toContain("<SignIn");
    expect(websiteSignIn).toContain("afterSignInUrl");
    expect(websiteSignIn).not.toContain("AppEmailCodeSignIn");
    expect(websiteSignIn).not.toContain("/app/sign-in");

    const websiteSignUp = readSrc("src/app/sign-up/[[...sign-up]]/page.tsx");
    expect(websiteSignUp).toContain("<SignUp");
    expect(websiteSignUp).not.toContain("AppEmailCodeSignIn");
  });

  it("findEmailCodeFirstFactor selects only email_code factors", () => {
    expect(
      findEmailCodeFirstFactor([
        { strategy: "oauth_google" },
        { strategy: "email_code", emailAddressId: "idn_email" },
        { strategy: "password" },
      ])
    ).toEqual({ strategy: "email_code", emailAddressId: "idn_email" });

    expect(
      findEmailCodeFirstFactor([{ strategy: "oauth_google" }])
    ).toBeNull();
    expect(findEmailCodeFirstFactor(null)).toBeNull();
  });

  it("mapAppSignInError never echoes codes or emails", () => {
    const message = mapAppSignInError(new Error("code 123456 for a@b.com"));
    expect(message).toBe("Something went wrong. Please try again.");
    expect(message).not.toMatch(/123456/);
    expect(message).not.toMatch(/a@b\.com/);
  });
});
