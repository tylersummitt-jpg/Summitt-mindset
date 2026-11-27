import { auth } from "@clerk/nextjs/server";
import {
  ONBOARDING_DIAGNOSTIC_MAX_BODY_CHARS,
  clientDiagnosticPairingAllowed,
  isOnboardingDiagnosticErrorCode,
  isOnboardingDiagnosticOutcome,
  isOnboardingDiagnosticStep,
} from "@/lib/onboarding-journey-diagnostics";
import { scheduleOnboardingDiagnostic } from "@/lib/onboarding-journey-diagnostics.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Client observations only. The Clerk id comes from the session.
 * This route does not read or write onboarding, billing, or SMS state.
 * It always finishes without changing the caller's next step.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return new Response(null, { status: 401 });
  }

  let raw = "";
  try {
    raw = await req.text();
  } catch {
    return new Response(null, { status: 204 });
  }
  if (raw.length > ONBOARDING_DIAGNOSTIC_MAX_BODY_CHARS) {
    return new Response(null, { status: 204 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 204 });
  }
  if (!parsed || typeof parsed !== "object") {
    return new Response(null, { status: 204 });
  }
  const body = parsed as Record<string, unknown>;
  if (!isOnboardingDiagnosticStep(body.step) || !isOnboardingDiagnosticOutcome(body.outcome)) {
    return new Response(null, { status: 204 });
  }
  const errorCode = body.errorCode === undefined ? "none" : body.errorCode;
  if (!isOnboardingDiagnosticErrorCode(errorCode)) {
    return new Response(null, { status: 204 });
  }
  if (!clientDiagnosticPairingAllowed(body.outcome, errorCode)) {
    return new Response(null, { status: 204 });
  }

  try {
    scheduleOnboardingDiagnostic({
      clerkUserId: userId,
      step: body.step,
      outcome: body.outcome,
      errorCode,
      journeyId: typeof body.journeyId === "string" ? body.journeyId : null,
      attemptId: typeof body.attemptId === "string" ? body.attemptId : null,
      userAgent: req.headers.get("user-agent"),
      source: "client",
    });
  } catch {
    console.warn("[onboarding-diagnostic] ingest failed");
  }

  return new Response(null, { status: 204 });
}
