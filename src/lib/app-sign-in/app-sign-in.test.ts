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
  hasPasswordFirstFactor,
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

    // Optional password for existing-user Sign in only (not Create account).
    expect(client).toContain("Sign in with password");
    expect(client).toContain("Use an email code instead");
    expect(client).toContain("handlePasswordSignIn");
    expect(client).toContain('strategy: "password"');
    expect(client).toContain("hasPasswordFirstFactor");
    expect(client).toContain('autoComplete="current-password"');
    expect(client).toContain("needs_second_factor");
    expect(client).toContain("needs_new_password");
    expect(client).not.toMatch(/localStorage|sessionStorage/);
    expect(client).not.toMatch(/Forgot password/i);
    expect(client).not.toMatch(/\breviewer\b/i);

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

  it("password option is only wired into existing-user sign-in, not sign-up", () => {
    const client = readSrc(
      "src/components/app-sign-in/AppEmailCodeSignIn.tsx"
    );
    expect(client).toContain('mode === "sign-in" && step === "password"');
    expect(client).toContain("goToPasswordStep");
    // Create account still email-code only — no password enrollment.
    expect(client).not.toMatch(/signUp\.create\(\{[^}]*password/s);
    expect(client).not.toContain("preparePassword");
    expect(client).not.toContain('name="new-password"');
    expect(client).toContain("prepareEmailAddressVerification");
    expect(client).toContain("attemptEmailAddressVerification");
  });

  it("password submit clears transient password state and never logs it", () => {
    const client = readSrc(
      "src/components/app-sign-in/AppEmailCodeSignIn.tsx"
    );
    const helpers = readSrc("src/lib/app-sign-in/app-sign-in-helpers.ts");
    expect(client).toContain("clearPassword()");
    expect(client).toContain("const passwordAttempt = password");
    expect(client).not.toMatch(/console\.(log|info|debug|warn|error)\([^)]*password/i);
    expect(helpers).not.toMatch(/console\.(log|info|debug|warn|error)/);
    expect(client).not.toMatch(/searchParams|URLSearchParams|password=/);
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

  it("Create account mode mounts clerk-captcha before signUp.create", () => {
    const client = readSrc(
      "src/components/app-sign-in/AppEmailCodeSignIn.tsx"
    );

    // Exact supported mount id, once.
    expect(client).toContain('id="clerk-captcha"');
    expect(client.match(/id="clerk-captcha"/g)?.length).toBe(1);

    // Supported customization attributes only.
    expect(client).toContain('data-cl-theme="light"');
    expect(client).toContain('data-cl-size="flexible"');
    expect(client).toContain('data-cl-language="auto"');

    // Present in Create account mode; not required for Sign in mode.
    expect(client).toContain('mode === "sign-up"');
    const captchaIdx = client.indexOf('id="clerk-captcha"');
    const signUpModeIdx = client.indexOf('mode === "sign-up"');
    const createCallIdx = client.indexOf(
      "await signUp.create({ emailAddress: trimmed })"
    );
    expect(signUpModeIdx).toBeGreaterThan(-1);
    expect(captchaIdx).toBeGreaterThan(signUpModeIdx);
    // Element is in JSX rendered for sign-up; create() runs only after that UI.
    expect(createCallIdx).toBeGreaterThan(-1);
    expect(client).toContain("handleSignUpSendCode");

    // Must not be invisibly styled or zero-dimensioned on the element itself.
    const captchaOpen = client.indexOf("<div", captchaIdx - 80);
    const captchaClose = client.indexOf("/>", captchaIdx) + 2;
    const captchaEl = client.slice(captchaOpen, captchaClose);
    expect(captchaEl).toContain('id="clerk-captcha"');
    expect(captchaEl).not.toMatch(/display:\s*none/i);
    expect(captchaEl).not.toMatch(/opacity:\s*0/i);
    expect(captchaEl).not.toMatch(/visibility:\s*hidden/i);
    expect(captchaEl).not.toMatch(/(?:^|[\s"'])(?:h-0|w-0)(?:[\s"']|$)/);
    expect(captchaEl).not.toMatch(/height:\s*0|width:\s*0/i);
    expect(captchaEl).not.toMatch(/-left-\[|translate-x-\[|sr-only/);
    expect(captchaEl).toContain('className="w-full min-w-0"');
    expect(captchaEl).not.toContain("hidden");
    expect(captchaEl).not.toContain("invisible");
    expect(captchaEl).not.toContain("sr-only");

    // Sign-in path unchanged: no captcha requirement there.
    expect(client).toContain("handleSignInSendCode");
    expect(client).toContain("prepareFirstFactor");
  });

  it("maps captcha-related Clerk errors to safe copy", () => {
    const helpers = readSrc("src/lib/app-sign-in/app-sign-in-helpers.ts");
    expect(helpers).toContain('case "captcha_invalid"');
    expect(helpers).toContain('case "captcha_unavailable"');
    expect(helpers).toContain('kind: "captcha"');
    expect(helpers).toContain(
      "Please complete the security check and try again."
    );
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
    expect(checkout).toContain("isNativeSummittMindsetAppRequestFromRequest");
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

  it("website SignUp presentation is component-local and keeps redirect props", () => {
    const websiteSignUp = readSrc("src/app/sign-up/[[...sign-up]]/page.tsx");
    expect(websiteSignUp).toContain("showOptionalFields: false");
    expect(websiteSignUp).toContain('socialButtonsPlacement: "top"');
    expect(websiteSignUp).toContain('socialButtonsVariant: "blockButton"');
    expect(websiteSignUp).toContain("afterSignInUrl={safeAfterSignInUrl}");
    expect(websiteSignUp).toContain("afterSignUpUrl={safeAfterSignUpUrl}");
    expect(websiteSignUp).not.toContain("forceRedirectUrl");
    expect(websiteSignUp).not.toContain("fallbackRedirectUrl");
    expect(websiteSignUp).not.toMatch(/display:\s*["']none["']/);
    expect(websiteSignUp).toContain("STEP 1 OF 2");
    expect(websiteSignUp).toContain("Start your 7-day free trial");
    expect(websiteSignUp).toContain("Create your account");

    const consumerGrid = websiteSignUp.indexOf("lg:grid-cols-2");
    const consumerSignUpSlot = websiteSignUp.indexOf("{signUp}", consumerGrid);
    expect(consumerGrid).toBeGreaterThan(-1);
    expect(consumerSignUpSlot).toBeGreaterThan(consumerGrid);
    const consumerCopy = websiteSignUp.slice(consumerGrid, consumerSignUpSlot);
    expect(consumerCopy).toContain("Start your 7-day free trial");
    expect(consumerCopy).not.toContain("Create your account");
    expect(websiteSignUp).toContain("$29/month");
    expect(websiteSignUp).toContain("7 days free · then $29/month");
    expect(websiteSignUp).toContain("$0 DUE TODAY");
    expect(websiteSignUp).toContain(
      "Next, you&apos;ll choose your plan and securely add a payment method to start your trial."
    );
    expect(websiteSignUp).not.toContain("You won&apos;t be charged today");
    expect(websiteSignUp).not.toContain("7 days free, then $29/month");
    expect(websiteSignUp).not.toContain("$249");
    expect(websiteSignUp).not.toContain("Daily accountability");
    expect(websiteSignUp).toContain('aria-label="Coach signup steps"');

    const coachOlStart = websiteSignUp.indexOf(
      'aria-label="Coach signup steps"'
    );
    const coachSignUpSlot = websiteSignUp.indexOf("{signUp}", coachOlStart);
    expect(coachOlStart).toBeGreaterThan(-1);
    expect(coachSignUpSlot).toBeGreaterThan(coachOlStart);
    const coachCopy = websiteSignUp.slice(coachOlStart, coachSignUpSlot);
    expect(coachCopy).not.toContain("STEP 1 OF 2");
    expect(coachCopy).not.toContain("$29/month");
    expect(coachCopy).not.toContain("$0 DUE TODAY");
    expect(coachCopy).not.toContain("Start your 7-day free trial");
    expect(coachCopy).not.toContain("7 days free");
    expect(coachCopy).not.toContain("payment method");

    const layout = readSrc("src/app/layout.tsx");
    expect(layout).toContain("<ClerkProvider");
    expect(layout).not.toMatch(/<ClerkProvider[\s\S]*appearance=/);

    const authShell = readSrc("src/components/auth-marketing-shell.tsx");
    expect(authShell).not.toContain("Didn't get the code?");
    expect(authShell).not.toContain("SPAM_HELPER");
    expect(authShell).not.toContain("MutationObserver");
    expect(authShell).not.toContain("querySelector");

    const nativeClient = readSrc(
      "src/components/app-sign-in/AppEmailCodeSignIn.tsx"
    );
    expect(nativeClient).not.toContain("<SignUp");
    expect(nativeClient).not.toMatch(/oauth_/i);
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

  it("hasPasswordFirstFactor detects Clerk password strategy only", () => {
    expect(
      hasPasswordFirstFactor([
        { strategy: "email_code", emailAddressId: "idn_email" },
        { strategy: "password" },
      ])
    ).toBe(true);
    expect(
      hasPasswordFirstFactor([
        { strategy: "email_code", emailAddressId: "idn_email" },
      ])
    ).toBe(false);
    expect(hasPasswordFirstFactor(null)).toBe(false);
    expect(hasPasswordFirstFactor(undefined)).toBe(false);
  });

  it("maps password Clerk error codes to safe kinds in helpers", () => {
    const helpers = readSrc("src/lib/app-sign-in/app-sign-in-helpers.ts");
    expect(helpers).toContain('case "form_password_incorrect"');
    expect(helpers).toContain('case "form_password_or_identifier_incorrect"');
    expect(helpers).toContain('kind: "password_incorrect"');
    expect(helpers).toContain('"password_unavailable"');
    expect(helpers).toContain("hasPasswordFirstFactor");
    expect(helpers).toContain(
      "That sign-in method is not available for this account right now."
    );
  });

  it("mapAppSignInError never echoes codes or emails", () => {
    const message = mapAppSignInError(new Error("code 123456 for a@b.com"));
    expect(message).toBe("Something went wrong. Please try again.");
    expect(message).not.toMatch(/123456/);
    expect(message).not.toMatch(/a@b\.com/);
  });
});
