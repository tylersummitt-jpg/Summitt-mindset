import { isClerkAPIResponseError } from "@clerk/nextjs/errors";

export type AppAuthErrorKind =
  | "generic"
  | "identifier_not_found"
  | "identifier_exists"
  | "code_incorrect"
  | "code_expired"
  | "rate_limited"
  | "strategy_unavailable"
  | "captcha";

export type AppAuthMappedError = {
  kind: AppAuthErrorKind;
  message: string;
};

/**
 * Map Clerk errors to member-safe copy. Never include verification codes
 * or raw email addresses in returned messages or logs.
 */
export function mapAppAuthError(error: unknown): AppAuthMappedError {
  if (isClerkAPIResponseError(error)) {
    const code = error.errors?.[0]?.code;
    switch (code) {
      case "form_identifier_not_found":
        return {
          kind: "identifier_not_found",
          message:
            "We could not find an account with that email. You can create a new account instead.",
        };
      case "form_identifier_exists":
      case "form_email_address_exists":
      case "email_address_exists":
      case "identifier_exists":
        return {
          kind: "identifier_exists",
          message:
            "An account with that email already exists. Sign in instead.",
        };
      case "form_code_incorrect":
      case "form_conditional_param_value_disallowed":
        return {
          kind: "code_incorrect",
          message: "That verification code is incorrect. Please try again.",
        };
      case "verification_expired":
      case "form_code_expired":
        return {
          kind: "code_expired",
          message: "That verification code has expired. Request a new code.",
        };
      case "too_many_requests":
      case "rate_limit_exceeded":
        return {
          kind: "rate_limited",
          message: "Too many attempts. Please wait a moment and try again.",
        };
      case "strategy_for_user_invalid":
      case "form_param_value_invalid":
        return {
          kind: "strategy_unavailable",
          message:
            "Email verification is not available for this account right now.",
        };
      case "captcha_invalid":
      case "captcha_unavailable":
      case "requires_captcha":
      case "form_captcha_invalid":
        return {
          kind: "captcha",
          message:
            "Please complete the security check and try again.",
        };
      default:
        break;
    }
  }

  return {
    kind: "generic",
    message: "Something went wrong. Please try again.",
  };
}

/** @deprecated Use mapAppAuthError — kept for existing call sites/tests. */
export function mapAppSignInError(error: unknown): string {
  return mapAppAuthError(error).message;
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
