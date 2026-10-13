export const HOSTED_TEST_PATH = "/checkout/hosted-test";

export const HOSTED_TEST_RETURN_PATH = "/checkout/hosted-test/return";

export const HOSTED_TEST_CONTINUE_PATH = "/checkout/hosted-test/continue";

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

export const BINDING_MAX_AGE_SECONDS = 60 * 60 * 3;

export const HOLD_METADATA_KEY = "summittActivationHold";

export const INTENT_METADATA_KEY = "checkoutIntentId";

/** Clerk public metadata. Set only when this checkout creates the Clerk user. */
export const STRIPE_FIRST_RESERVED_EMAIL_METADATA = "stripeFirstReservedEmail";

/** Stripe subscription metadata. Records that the staff alert was sent. Not a hold. */
export const UNPROTECTED_ALERTED_METADATA_KEY = "summittUnprotectedAlerted";

export const SIGN_IN_TICKET_SECONDS = 60;
