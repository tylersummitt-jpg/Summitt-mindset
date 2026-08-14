import "server-only";

export type AppleIapErrorCode =
  | "apple_iap_not_configured"
  | "apple_iap_invalid_environment"
  | "apple_iap_verification_failed";

export class AppleIapError extends Error {
  readonly code: AppleIapErrorCode;

  constructor(code: AppleIapErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppleIapError";
    this.code = code;
  }
}

export function isAppleIapError(value: unknown): value is AppleIapError {
  return value instanceof AppleIapError;
}
