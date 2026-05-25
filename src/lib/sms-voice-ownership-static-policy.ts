/**
 * SMS Voice Ownership static policy constants (test/governance only — not runtime SMS behavior).
 */

/** Relationship coaching cron routes locked by Slice 1+ static tests. */
export const RELATIONSHIP_SMS_ROUTE_FILES = [
  "src/app/api/cron/daily-sms/route.ts",
  "src/app/api/cron/sms-inbound-coach/route.ts",
  "src/app/api/cron/weekly-sms/route.ts",
] as const;

/**
 * Documented deterministic user-visible SMS surfaces (allowed).
 * New normal-relationship deterministic sends must be added here or static tests fail.
 */
export const SMS_VOICE_OWNERSHIP_ALLOWED_DETERMINISTIC = {
  twilioStopHelpStart: "Twilio inbound STOP/HELP/START TwiML (not sendSMS)",
  safetyRedirects: "sms-inbound-safety SAFETY_COPY crisis/harm/brand redirects",
  onboardingConsent: "onboarding/sms transactional consent (bypasses FVG by design)",
  weeklyComplianceFooter: "weekly-sms WEEKLY_SMS_COMPLIANCE_FOOTER via appendPreservedSmsSuffix after FVG",
  bindingVerbatim: "binding_text_verbatim / required consent needles in contract_prompt & guided proposal",
  guidedAdaptiveContract: "v2-adaptive-contract shrink proposal with V3 refine + FVG + binding needle",
} as const;

/**
 * Forbidden on inbound relationship SMS after Voice Ownership Slice 2.
 * Static tests fail if these reappear in sms-inbound-coach/route.ts send path.
 */
export const FORBIDDEN_INBOUND_DETERMINISTIC_RELATIONSHIP_APPEND = [
  "applyVictoryCalloutAfterSpineInsert",
  "pickVictoryCalloutLine",
] as const;
