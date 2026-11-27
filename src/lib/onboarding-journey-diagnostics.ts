/**
 * Pure onboarding flight-recorder vocabulary.
 * No database, no cookies, no raw User-Agent storage.
 * A missing event is unknown. It is not evidence the member left.
 */

export const ONBOARDING_DIAGNOSTIC_STEPS = [
  "identity",
  "goal",
  "texts",
  "complete",
  "film_room",
] as const;

export const ONBOARDING_DIAGNOSTIC_OUTCOMES = [
  "step_reached",
  "client_initialized",
  "submission_attempted",
  "validation_blocked",
  "request_received",
  "save_failed",
  "client_error",
  "step_advanced",
  "completion_attempted",
  "completion_failed",
] as const;

export const ONBOARDING_DIAGNOSTIC_ERROR_CODES = [
  "none",
  "missing_name",
  "missing_anchor",
  "weak_anchor",
  "invalid_input",
  "missing_focus",
  "invalid_title",
  "invalid_behavior",
  "missing_identity",
  "missing_goal",
  "missing_review",
  "invalid_phone",
  "missing_consent",
  "phone_in_use",
  "unauthorized",
  "forbidden",
  "conflict",
  "persistence",
  "server",
  "request_failed",
  "render_failed",
  "account_deletion",
] as const;

export const ONBOARDING_CLIENT_SHELLS = [
  "browser",
  "in_app_browser",
  "ios_app",
  "android_app",
  "unknown",
] as const;

export const ONBOARDING_DEVICE_CLASSES = ["desktop", "phone", "tablet", "unknown"] as const;

export const ONBOARDING_BROWSER_FAMILIES = [
  "chrome",
  "safari",
  "firefox",
  "edge",
  "other",
  "none",
] as const;

export const CLIENT_ONBOARDING_OUTCOMES = [
  "client_initialized",
  "submission_attempted",
  "validation_blocked",
  "client_error",
  "step_advanced",
  "completion_attempted",
] as const;

export const ONBOARDING_DIAGNOSTIC_RATE_LIMIT_PER_MINUTE = 30;
export const ONBOARDING_DIAGNOSTIC_JOURNEY_CAP = 80;
export const ONBOARDING_DIAGNOSTIC_TIMEOUT_MS = 250;
export const ONBOARDING_DIAGNOSTIC_MAX_BODY_CHARS = 600;

export type OnboardingDiagnosticStep = (typeof ONBOARDING_DIAGNOSTIC_STEPS)[number];
export type OnboardingDiagnosticOutcome = (typeof ONBOARDING_DIAGNOSTIC_OUTCOMES)[number];
export type OnboardingDiagnosticErrorCode = (typeof ONBOARDING_DIAGNOSTIC_ERROR_CODES)[number];
export type OnboardingClientShell = (typeof ONBOARDING_CLIENT_SHELLS)[number];
export type OnboardingDeviceClass = (typeof ONBOARDING_DEVICE_CLASSES)[number];
export type OnboardingBrowserFamily = (typeof ONBOARDING_BROWSER_FAMILIES)[number];
export type ClientOnboardingOutcome = (typeof CLIENT_ONBOARDING_OUTCOMES)[number];

export type OnboardingClientClassification = {
  clientShell: OnboardingClientShell;
  deviceClass: OnboardingDeviceClass;
  browserFamily: OnboardingBrowserFamily;
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const CLIENT_ERROR_CODES = new Set<OnboardingDiagnosticErrorCode>([
  "none",
  "missing_name",
  "missing_anchor",
  "weak_anchor",
  "invalid_input",
  "missing_focus",
  "invalid_title",
  "invalid_behavior",
  "invalid_phone",
  "missing_consent",
  "request_failed",
  "render_failed",
]);

export function isOnboardingDiagnosticStep(value: unknown): value is OnboardingDiagnosticStep {
  return (
    typeof value === "string" &&
    (ONBOARDING_DIAGNOSTIC_STEPS as readonly string[]).includes(value)
  );
}

export function isOnboardingDiagnosticOutcome(
  value: unknown
): value is OnboardingDiagnosticOutcome {
  return (
    typeof value === "string" &&
    (ONBOARDING_DIAGNOSTIC_OUTCOMES as readonly string[]).includes(value)
  );
}

export function isOnboardingDiagnosticErrorCode(
  value: unknown
): value is OnboardingDiagnosticErrorCode {
  return (
    typeof value === "string" &&
    (ONBOARDING_DIAGNOSTIC_ERROR_CODES as readonly string[]).includes(value)
  );
}

export function isClientOnboardingOutcome(value: unknown): value is ClientOnboardingOutcome {
  return (
    typeof value === "string" &&
    (CLIENT_ONBOARDING_OUTCOMES as readonly string[]).includes(value)
  );
}

/** Client beacons may describe attempts and local failures. They cannot assert a save. */
export function clientDiagnosticPairingAllowed(
  outcome: OnboardingDiagnosticOutcome,
  errorCode: OnboardingDiagnosticErrorCode
): boolean {
  if (!isClientOnboardingOutcome(outcome)) return false;
  if (!CLIENT_ERROR_CODES.has(errorCode)) return false;
  if (outcome === "validation_blocked") return errorCode !== "none";
  if (outcome === "client_error") {
    return errorCode === "request_failed" || errorCode === "render_failed";
  }
  return errorCode === "none";
}

export function sanitizeDiagnosticId(raw: unknown, fallback: string): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  return ID_PATTERN.test(value) ? value : fallback;
}

export function onboardingDiagnosticIdempotencyKey(args: {
  clerkUserId: string;
  journeyId: string;
  attemptId: string;
  step: OnboardingDiagnosticStep;
  outcome: OnboardingDiagnosticOutcome;
  errorCode: OnboardingDiagnosticErrorCode;
  oncePerMember?: boolean;
}): string {
  if (args.oncePerMember) {
    return `once:${args.clerkUserId}:${args.step}:${args.outcome}`;
  }
  return [
    "v1",
    args.clerkUserId,
    args.journeyId,
    args.attemptId,
    args.step,
    args.outcome,
    args.errorCode,
  ].join(":");
}

/**
 * Closed classification from the User-Agent. The raw string is not returned.
 * iOS app token wins over a WebView's Safari token. Edge wins over Chrome.
 */
export function classifyOnboardingClient(
  userAgent: string | null | undefined
): OnboardingClientClassification {
  if (typeof userAgent !== "string" || userAgent.trim().length === 0) {
    return { clientShell: "unknown", deviceClass: "unknown", browserFamily: "none" };
  }
  const ua = userAgent;
  let clientShell: OnboardingClientShell = "browser";
  if (ua.includes("SummittMindsetiOS")) clientShell = "ios_app";
  else if (ua.includes("SummittMindsetAndroid")) clientShell = "android_app";
  else if (/Instagram|FBAN|FBAV|FB_IAB/i.test(ua)) clientShell = "in_app_browser";

  let deviceClass: OnboardingDeviceClass = "desktop";
  if (/iPad|Tablet/i.test(ua)) deviceClass = "tablet";
  else if (/Android/i.test(ua) && !/Mobile/i.test(ua)) deviceClass = "tablet";
  else if (/Mobi|iPhone|Android/i.test(ua)) deviceClass = "phone";

  let browserFamily: OnboardingBrowserFamily = "other";
  if (/Edg\//i.test(ua)) browserFamily = "edge";
  else if (/Chrome\/|CriOS/i.test(ua)) browserFamily = "chrome";
  else if (/Firefox\/|FxiOS/i.test(ua)) browserFamily = "firefox";
  else if (/Safari\//i.test(ua)) browserFamily = "safari";

  return { clientShell, deviceClass, browserFamily };
}
