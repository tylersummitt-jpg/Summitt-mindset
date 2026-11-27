"use client";

import {
  ONBOARDING_DIAGNOSTIC_MAX_BODY_CHARS,
  clientDiagnosticPairingAllowed,
  type ClientOnboardingOutcome,
  type OnboardingDiagnosticErrorCode,
  type OnboardingDiagnosticStep,
} from "@/lib/onboarding-journey-diagnostics";

const JOURNEY_STORAGE_KEY = "sm_onboarding_journey";

let memoryJourneyId: string | null = null;

export function newOnboardingAttemptId(): string {
  return crypto.randomUUID();
}

export function onboardingJourneyId(): string {
  if (memoryJourneyId) return memoryJourneyId;
  if (typeof window === "undefined") {
    memoryJourneyId = crypto.randomUUID();
    return memoryJourneyId;
  }
  try {
    const existing = window.sessionStorage.getItem(JOURNEY_STORAGE_KEY);
    if (existing && /^[A-Za-z0-9_-]{1,64}$/.test(existing)) {
      memoryJourneyId = existing;
      return existing;
    }
  } catch {
    // Storage can be blocked. The in-memory id still correlates this page.
  }
  const created = crypto.randomUUID();
  memoryJourneyId = created;
  try {
    window.sessionStorage.setItem(JOURNEY_STORAGE_KEY, created);
  } catch {
    // Same-tab memory remains the correlation id.
  }
  return created;
}

export function onboardingDiagnosticHeaders(attemptId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-onboarding-journey": onboardingJourneyId(),
    "x-onboarding-attempt": attemptId,
  };
}

export function reportOnboardingClient(args: {
  step: OnboardingDiagnosticStep;
  outcome: ClientOnboardingOutcome;
  errorCode?: OnboardingDiagnosticErrorCode;
  attemptId: string;
}): void {
  const errorCode = args.errorCode ?? "none";
  if (!clientDiagnosticPairingAllowed(args.outcome, errorCode)) return;
  let body = "";
  try {
    body = JSON.stringify({
      step: args.step,
      outcome: args.outcome,
      errorCode,
      journeyId: onboardingJourneyId(),
      attemptId: args.attemptId,
    });
  } catch {
    return;
  }
  if (body.length > ONBOARDING_DIAGNOSTIC_MAX_BODY_CHARS) return;

  try {
    const beacon =
      typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
        ? navigator.sendBeacon.bind(navigator)
        : null;
    if (beacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (beacon("/api/onboarding/diagnostic", blob)) return;
    }
  } catch {
    // Fall through to fetch.
  }

  try {
    void fetch("/api/onboarding/diagnostic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body,
    }).catch(() => undefined);
  } catch {
    // Lost before transmission. The absence stays unknown.
  }
}
