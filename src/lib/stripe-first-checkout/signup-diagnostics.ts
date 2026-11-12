import "server-only";

import { hashCheckoutBinding } from "@/lib/stripe-first-checkout/binding";
import { hostedCompletionBrowserPresent } from "@/lib/stripe-first-checkout/credentials";
import {
  loadIntentByBindingHash,
  markOnboardingReachedForClerkUser,
  markSignupDiagnostic,
  markUnboundCheckoutReturn,
} from "@/lib/stripe-first-checkout/intent-store";

/**
 * Diagnostic timestamps explain a later incomplete signup.
 * A missing timestamp is an unrecorded event, not proof the customer left.
 * Every function swallows its own failure.
 */

async function noteBoundColumn(
  bindingSecret: string,
  column:
    | "return_seen_at"
    | "activate_retry_at"
    | "sign_in_redirected_at"
    | "link_retry_at"
    | "sign_in_client_reached_at"
    | "auth_observed_at"
): Promise<void> {
  try {
    const intent = await loadIntentByBindingHash(hashCheckoutBinding(bindingSecret));
    if (!intent) return;
    await markSignupDiagnostic(intent.id, column);
  } catch {
    console.warn("[stripe-first] signup diagnostic failed");
  }
}

/** The return page is rendering for a browser that presented the binding cookie. */
export async function noteBoundCheckoutReturn(bindingSecret: string): Promise<void> {
  await noteBoundColumn(bindingSecret, "return_seen_at");
}

/**
 * The return page was requested without an accepted binding cookie.
 * A session id only finds the row to stamp. It authorizes nothing.
 */
export async function noteUnboundCheckoutReturn(
  sessionId: string | undefined
): Promise<void> {
  if (typeof sessionId !== "string") return;
  await markUnboundCheckoutReturn(sessionId);
}

export async function recordCheckoutReturn(args: {
  bindingCookie: string | undefined;
  sessionId: string | undefined;
}): Promise<void> {
  try {
    if (hostedCompletionBrowserPresent(args.bindingCookie)) {
      await noteBoundCheckoutReturn(args.bindingCookie);
      return;
    }
    await noteUnboundCheckoutReturn(args.sessionId);
  } catch {
    console.warn("[stripe-first] signup diagnostic failed");
  }
}

/** The bound activate handler is about to answer retry. */
export async function noteActivateRetry(bindingSecret: string): Promise<void> {
  await noteBoundColumn(bindingSecret, "activate_retry_at");
}

/**
 * The continue page is about to send the HTTP redirect to sign-in.
 * This does not mean the sign-in page loaded.
 */
export async function noteSignInRedirectIssued(bindingSecret: string): Promise<void> {
  await noteBoundColumn(bindingSecret, "sign_in_redirected_at");
}

/** The authenticated link handler is about to answer retry. */
export async function noteLinkRetry(bindingSecret: string): Promise<void> {
  await noteBoundColumn(bindingSecret, "link_retry_at");
}

/**
 * The sign-in page's JavaScript called our server with the existing binding cookie.
 * This does not prove the screen was displayed.
 */
export async function noteSignInClientReached(bindingSecret: string): Promise<void> {
  await noteBoundColumn(bindingSecret, "sign_in_client_reached_at");
}

/**
 * A server entry point saw a verified Clerk user while the binding cookie
 * resolved to this checkout. This does not link the user or the subscription.
 */
export async function noteAuthObserved(bindingSecret: string): Promise<void> {
  await noteBoundColumn(bindingSecret, "auth_observed_at");
}

/**
 * The onboarding identity handler continued for the Clerk user already stored
 * on the checkout. A browser-supplied checkout id is not accepted.
 */
export async function noteOnboardingReached(clerkUserId: string): Promise<void> {
  try {
    await markOnboardingReachedForClerkUser(clerkUserId);
  } catch {
    console.warn("[stripe-first] signup diagnostic failed");
  }
}

/** Hold completion returned retry and this attempt did not release the hold. */
export async function noteHoldReleaseRetry(intentId: string): Promise<void> {
  try {
    await markSignupDiagnostic(intentId, "hold_release_retry_at");
  } catch {
    console.warn("[stripe-first] signup diagnostic failed");
  }
}
