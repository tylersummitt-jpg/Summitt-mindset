/**
 * Shared SMS consent check for SoB onboarding gates and complete route,
 * plus transactional onboarding consent SMS dedupe latch (Clerk metadata).
 */

export type ClerkSmsMetadata = Record<string, unknown> | null | undefined;

export const ONBOARDING_CONSENT_SMS_LATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

export const ONBOARDING_TRANSACTIONAL_CONSENT_SMS_SENT_AT_KEY =
  "onboardingTransactionalConsentSmsSentAt";
export const ONBOARDING_TRANSACTIONAL_CONSENT_SMS_PHONE_KEY =
  "onboardingTransactionalConsentSmsPhoneE164";

export function hasValidSmsConsent(md: ClerkSmsMetadata): boolean {
  if (!md || typeof md !== "object") return false;
  return (
    md.smsEnabled === true &&
    typeof md.phoneNumber === "string" &&
    md.phoneNumber.trim().length > 0 &&
    md.smsDisclosureAccepted === true
  );
}

export function isOnboardingConsentSmsDedupeEnabled(): boolean {
  const v = process.env.ONBOARDING_SMS_CONSENT_DEDUPE_ENABLED;
  if (v === undefined || v === "") return true;
  return v !== "0" && v.toLowerCase() !== "false";
}

export function phoneE164Last4(phoneE164: string): string | null {
  const digits = (phoneE164 || "").replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

function parseLatchSentAt(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function shouldSkipOnboardingTransactionalConsentSms(args: {
  clerkMetadata: ClerkSmsMetadata;
  normalizedPhoneE164: string;
  now?: Date;
}): {
  skip: boolean;
  reason?: string;
  priorSentAt?: string | null;
} {
  const { clerkMetadata, normalizedPhoneE164 } = args;
  const now = args.now ?? new Date();

  if (!isOnboardingConsentSmsDedupeEnabled()) {
    return { skip: false };
  }

  if (!clerkMetadata || typeof clerkMetadata !== "object") {
    return { skip: false };
  }

  if (clerkMetadata.onboardingCompleted === true) {
    return { skip: false };
  }

  const latchedPhone = clerkMetadata[ONBOARDING_TRANSACTIONAL_CONSENT_SMS_PHONE_KEY];
  if (typeof latchedPhone !== "string" || latchedPhone.trim() !== normalizedPhoneE164) {
    return { skip: false };
  }

  const priorSentAtRaw = clerkMetadata[ONBOARDING_TRANSACTIONAL_CONSENT_SMS_SENT_AT_KEY];
  const priorSentAt =
    typeof priorSentAtRaw === "string" && priorSentAtRaw.trim().length > 0
      ? priorSentAtRaw.trim()
      : null;
  const sentAt = parseLatchSentAt(priorSentAtRaw);
  if (!sentAt || !priorSentAt) {
    return { skip: false };
  }

  const ageMs = now.getTime() - sentAt.getTime();
  if (ageMs < 0 || ageMs > ONBOARDING_CONSENT_SMS_LATCH_WINDOW_MS) {
    return { skip: false, priorSentAt };
  }

  return {
    skip: true,
    reason: "same_phone_within_latch_window",
    priorSentAt,
  };
}

export function onboardingTransactionalConsentLatchFields(
  normalizedPhoneE164: string,
  now?: Date
): Record<string, unknown> {
  return {
    [ONBOARDING_TRANSACTIONAL_CONSENT_SMS_SENT_AT_KEY]: (now ?? new Date()).toISOString(),
    [ONBOARDING_TRANSACTIONAL_CONSENT_SMS_PHONE_KEY]: normalizedPhoneE164,
  };
}
