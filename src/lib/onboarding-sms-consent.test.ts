import { describe, expect, it } from "vitest";
import {
  ONBOARDING_CONSENT_SMS_LATCH_WINDOW_MS,
  onboardingTransactionalConsentLatchFields,
  shouldSkipOnboardingTransactionalConsentSms,
} from "@/lib/onboarding-sms-consent";

describe("shouldSkipOnboardingTransactionalConsentSms", () => {
  const phone = "+18655551212";
  const now = new Date("2026-05-21T12:00:00.000Z");

  it("skips when same phone within 24h latch window", () => {
    const r = shouldSkipOnboardingTransactionalConsentSms({
      clerkMetadata: {
        onboardingTransactionalConsentSmsSentAt: "2026-05-21T10:00:00.000Z",
        onboardingTransactionalConsentSmsPhoneE164: phone,
      },
      normalizedPhoneE164: phone,
      now,
    });
    expect(r.skip).toBe(true);
    expect(r.reason).toBe("same_phone_within_latch_window");
  });

  it("does not skip when latch phone differs", () => {
    const r = shouldSkipOnboardingTransactionalConsentSms({
      clerkMetadata: {
        onboardingTransactionalConsentSmsSentAt: "2026-05-21T10:00:00.000Z",
        onboardingTransactionalConsentSmsPhoneE164: "+18655559999",
      },
      normalizedPhoneE164: phone,
      now,
    });
    expect(r.skip).toBe(false);
  });

  it("does not skip when latch is older than 24h", () => {
    const r = shouldSkipOnboardingTransactionalConsentSms({
      clerkMetadata: {
        onboardingTransactionalConsentSmsSentAt: "2026-05-19T12:00:00.000Z",
        onboardingTransactionalConsentSmsPhoneE164: phone,
      },
      normalizedPhoneE164: phone,
      now,
    });
    expect(r.skip).toBe(false);
  });

  it("does not skip on malformed sentAt", () => {
    const r = shouldSkipOnboardingTransactionalConsentSms({
      clerkMetadata: {
        onboardingTransactionalConsentSmsSentAt: "not-a-date",
        onboardingTransactionalConsentSmsPhoneE164: phone,
      },
      normalizedPhoneE164: phone,
      now,
    });
    expect(r.skip).toBe(false);
  });

  it("does not skip when latch phone missing", () => {
    const r = shouldSkipOnboardingTransactionalConsentSms({
      clerkMetadata: {
        onboardingTransactionalConsentSmsSentAt: "2026-05-21T10:00:00.000Z",
      },
      normalizedPhoneE164: phone,
      now,
    });
    expect(r.skip).toBe(false);
  });
});

describe("onboardingTransactionalConsentLatchFields", () => {
  it("writes expected Clerk keys", () => {
    const fields = onboardingTransactionalConsentLatchFields(
      "+18655551212",
      new Date("2026-05-21T12:00:00.000Z")
    );
    expect(fields.onboardingTransactionalConsentSmsPhoneE164).toBe("+18655551212");
    expect(fields.onboardingTransactionalConsentSmsSentAt).toBe("2026-05-21T12:00:00.000Z");
  });
});

describe("ONBOARDING_CONSENT_SMS_LATCH_WINDOW_MS", () => {
  it("is 24 hours", () => {
    expect(ONBOARDING_CONSENT_SMS_LATCH_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});
