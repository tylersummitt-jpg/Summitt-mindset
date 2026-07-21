/**
 * App-specific mobile auth constants (DEC-018 / APP-061).
 * Same Clerk production instance as the website; email verification-code only.
 * Supports explicit Sign in and Create account — not purchase.
 */

import { APP_MEMBERSHIP_PATH } from "@/lib/native-app/membership-paths";
import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";

/** Public route used by the native iOS WKWebView shell. */
export const APP_SIGN_IN_PATH = "/app/sign-in" as const;

/**
 * Post-auth router. Resolves subscribed → Victory Room, inactive native →
 * /app/membership, paused → Account, onboarding when entitled.
 * Query redirect parameters are intentionally ignored on the app auth surface.
 */
export const APP_POST_AUTH_PATH = "/post-sign-in" as const;

/** @deprecated Prefer APP_POST_AUTH_PATH — kept for clarity in older references. */
export const APP_SIGN_IN_SUCCESS_PATH = APP_POST_AUTH_PATH;

export const APP_SIGN_IN_HEADING = "Welcome to Summitt Mindset" as const;

export const APP_SIGN_IN_SUPPORTING_COPY =
  "Sign in to your existing account or create a new account." as const;

export const APP_SIGN_IN_LEGAL_PREFIX =
  "By continuing, you agree to the" as const;

export const APP_SIGN_IN_LEGAL_MID =
  "and acknowledge the" as const;

/** Fixed destinations used in tests and copy — not client-overridable. */
export const APP_AUTH_SUBSCRIBED_HOME = MEMBER_APP_HOME_PATH;
export const APP_AUTH_INACTIVE_HOME = APP_MEMBERSHIP_PATH;
