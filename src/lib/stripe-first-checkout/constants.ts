export const HOSTED_TEST_PATH = "/checkout/hosted-test";

export const HOSTED_TEST_RETURN_PATH = "/checkout/hosted-test/return";

export const HOSTED_TEST_CONTINUE_PATH = "/checkout/hosted-test/continue";

export const PUBLIC_CHECKOUT_RETURN_PATH = "/checkout/return";

export const PUBLIC_CHECKOUT_CONTINUE_PATH = "/checkout/continue";

/** Distinguishes a public Stripe-first session from the owner canary and the old Clerk-first checkout. */
export const PUBLIC_CHECKOUT_FLOW_KEY = "summittCheckoutFlow";

export const PUBLIC_CHECKOUT_FLOW_VALUE = "stripe_first";

export const ONBOARDING_IDENTITY_PATH = "/onboarding/identity";

/** HttpOnly gate minted by an admin. Not a checkout binding. */
export const HOSTED_TEST_ACCESS_COOKIE = "sm_hosted_test";

/** HttpOnly secret. Only its hash is stored. */
export const CHECKOUT_BINDING_COOKIE = "sm_checkout_bind";

export const ACCESS_MAX_AGE_SECONDS = 60 * 60 * 2;

/** Owner canary only. Unset or any value other than "true" keeps production closed. */
export const CANARY_ENABLED_ENV = "STRIPE_FIRST_CANARY_ENABLED";

export const CANARY_ACCESS_MAX_AGE_SECONDS = 30 * 60;

export const CANARY_METADATA_KEY = "summittCanary";

export const CANARY_METADATA_VALUE = "owner";

/**
 * Provisional browser-binding lifetime. Stripe Checkout Sessions last 24 hours.
 * After Stripe returns expires_at, the stored binding and cookie use that time.
 */
export const BINDING_MAX_AGE_SECONDS = 60 * 60 * 24;

export const HOLD_METADATA_KEY = "summittActivationHold";

export const INTENT_METADATA_KEY = "checkoutIntentId";

/** Clerk public metadata. Set only when this checkout creates the Clerk user. */
export const STRIPE_FIRST_RESERVED_EMAIL_METADATA = "stripeFirstReservedEmail";

/** Stripe subscription metadata. Records that the staff alert was sent. Not a hold. */
export const UNPROTECTED_ALERTED_METADATA_KEY = "summittUnprotectedAlerted";

/** Staff alert for a paid trial that never became a Clerk account. Not a customer email. */
export const STRANDED_ALERTED_METADATA_KEY = "summittStrandedAlerted";

export const SIGN_IN_TICKET_SECONDS = 60;
