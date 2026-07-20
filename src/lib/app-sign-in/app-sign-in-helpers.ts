import { isClerkAPIResponseError } from "@clerk/nextjs/errors";

/**
 * Map Clerk errors to member-safe copy. Never include verification codes
 * or raw email addresses in returned messages or logs.
 */
export function mapAppSignInError(error: unknown): string {
  if (isClerkAPIResponseError(error)) {
    const code = error.errors?.[0]?.code;
    switch (code) {
      case "form_identifier_not_found":
        return "We could not find an account with that email.";
      case "form_code_incorrect":
      case "form_conditional_param_value_disallowed":
        return "That verification code is incorrect. Please try again.";
      case "verification_expired":
      case "form_code_expired":
        return "That verification code has expired. Request a new code.";
      case "too_many_requests":
      case "rate_limit_exceeded":
        return "Too many attempts. Please wait a moment and try again.";
      case "strategy_for_user_invalid":
      case "form_param_value_invalid":
        return "Email sign-in is not available for this account right now.";
      default:
        break;
    }
  }

  return "Something went wrong. Please try again.";
}

/**
 * Locate the email_code first factor from a Clerk SignIn attempt.
 * Returns null when email verification-code is unavailable for the identifier.
 */
export function findEmailCodeFirstFactor(
  factors:
    | Array<{ strategy: string; emailAddressId?: string }>
    | null
    | undefined
): { strategy: "email_code"; emailAddressId: string } | null {
  if (!factors) return null;
  for (const factor of factors) {
    if (
      factor.strategy === "email_code" &&
      typeof factor.emailAddressId === "string" &&
      factor.emailAddressId.length > 0
    ) {
      return {
        strategy: "email_code",
        emailAddressId: factor.emailAddressId,
      };
    }
  }
  return null;
}
