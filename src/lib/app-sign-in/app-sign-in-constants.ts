/**
 * App-specific mobile sign-in constants (DEC-018 / APP-061).
 * Same Clerk production instance as the website; email verification-code only.
 */

import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";

/** Public route used by the native iOS WKWebView shell. */
export const APP_SIGN_IN_PATH = "/app/sign-in" as const;

/**
 * Hard-coded post-auth destination for the app sign-in surface.
 * Query redirect parameters are intentionally ignored on this route.
 */
export const APP_SIGN_IN_SUCCESS_PATH = MEMBER_APP_HOME_PATH;

export const APP_SIGN_IN_HEADING = "Welcome to Summitt Mindset" as const;

export const APP_SIGN_IN_SUPPORTING_COPY =
  "Sign in with your email to continue." as const;
