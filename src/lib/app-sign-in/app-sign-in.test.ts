import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_SIGN_IN_PATH,
  APP_SIGN_IN_SUCCESS_PATH,
  APP_SIGN_IN_HEADING,
  APP_SIGN_IN_SUPPORTING_COPY,
} from "@/lib/app-sign-in/app-sign-in-constants";
import {
  findEmailCodeFirstFactor,
  mapAppSignInError,
} from "@/lib/app-sign-in/app-sign-in-helpers";
import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";

const root = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("app-specific email-code sign-in (/app/sign-in)", () => {
  it("is listed as a public middleware route without loosening unrelated routes", () => {
    const middleware = readSrc("src/middleware.ts");
    expect(middleware).toMatch(/["']\/app\/sign-in\(\.\*\)["']/);
    expect(middleware).toMatch(/["']\/sign-in\(\.\*\)["']/);
    expect(middleware).not.toMatch(/["']\/dashboard\(\.\*\)["']/);
    expect(middleware).not.toMatch(/["']\/user\(\.\*\)["']/);
    expect(middleware).not.toMatch(/["']\/admin\(\.\*\)["']/);
  });

  it("redirects signed-in visitors to Victory Room", () => {
    const page = readSrc("src/app/app/sign-in/page.tsx");
    expect(page).toContain("auth()");
    expect(page).toContain("redirect(APP_SIGN_IN_SUCCESS_PATH)");
    expect(APP_SIGN_IN_SUCCESS_PATH).toBe(MEMBER_APP_HOME_PATH);
    expect(APP_SIGN_IN_SUCCESS_PATH).toBe("/dashboard/victory-room");
  });

  it("uses custom useSignIn email-code flow with no Google or Apple UI", () => {
    const client = readSrc(
      "src/components/app-sign-in/AppEmailCodeSignIn.tsx"
    );
    const page = readSrc("src/app/app/sign-in/page.tsx");

    expect(client).toContain("useSignIn");
    expect(client).toContain('strategy: "email_code"');
    expect(client).toContain("prepareFirstFactor");
    expect(client).toContain("attemptFirstFactor");
    expect(client).toContain("autoComplete=\"one-time-code\"");
    expect(client).toContain("APP_SIGN_IN_HEADING");
    expect(client).toContain("APP_SIGN_IN_SUPPORTING_COPY");
    expect(client).toContain(`router.replace(APP_SIGN_IN_SUCCESS_PATH)`);
    expect(APP_SIGN_IN_HEADING).toBe("Welcome to Summitt Mindset");
    expect(APP_SIGN_IN_SUPPORTING_COPY).toBe(
      "Sign in with your email to continue."
    );

    expect(client).not.toMatch(/\bGoogle\b/);
    expect(client).not.toMatch(/Sign in with Apple/i);
    expect(client).not.toMatch(/oauth_/i);
    expect(client).not.toMatch(/authenticateWithRedirect/);
    expect(client).not.toContain("<SignIn");
    expect(client).not.toContain("SignInButton");
    expect(page).not.toContain("<SignIn");
    expect(page).not.toMatch(/\bGoogle\b/);
    expect(page).not.toMatch(/Sign in with Apple/i);
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
    expect(combined).toContain("APP_SIGN_IN_SUCCESS_PATH");
    expect(APP_SIGN_IN_PATH).toBe("/app/sign-in");
  });

  it("does not modify the normal website sign-in route", () => {
    const website = readSrc("src/app/sign-in/[[...sign-in]]/page.tsx");
    expect(website).toContain('from "@clerk/nextjs"');
    expect(website).toContain("<SignIn");
    expect(website).toContain("afterSignInUrl");
    expect(website).toContain("sanitizeInternalRedirectUrl");
    expect(website).not.toContain("AppEmailCodeSignIn");
    expect(website).not.toContain("/app/sign-in");
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
