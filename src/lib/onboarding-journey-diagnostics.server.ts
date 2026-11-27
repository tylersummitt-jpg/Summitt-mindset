import "server-only";

import { after } from "next/server";
import { failOpenWithTimeout } from "@/lib/meta-capi-fail-open-timeout";
import {
  ONBOARDING_DIAGNOSTIC_JOURNEY_CAP,
  ONBOARDING_DIAGNOSTIC_RATE_LIMIT_PER_MINUTE,
  ONBOARDING_DIAGNOSTIC_TIMEOUT_MS,
  classifyOnboardingClient,
  onboardingDiagnosticIdempotencyKey,
  sanitizeDiagnosticId,
  type OnboardingDiagnosticErrorCode,
  type OnboardingDiagnosticOutcome,
  type OnboardingDiagnosticStep,
} from "@/lib/onboarding-journey-diagnostics";

const TABLE = "onboarding_journey_diagnostics";

async function diagnosticDb() {
  const { supabaseServer } = await import("@/lib/supabase-server");
  return supabaseServer;
}

export type RecordOnboardingDiagnosticInput = {
  clerkUserId: string;
  step: OnboardingDiagnosticStep;
  outcome: OnboardingDiagnosticOutcome;
  errorCode?: OnboardingDiagnosticErrorCode;
  journeyId?: string | null;
  attemptId?: string | null;
  userAgent?: string | null;
  source: "server" | "client";
  /** First Film Room arrival only. Later visits do not add rows. */
  oncePerMember?: boolean;
};

function freshId(): string {
  return crypto.randomUUID();
}

async function countRecent(clerkUserId: string): Promise<number | null> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const db = await diagnosticDb();
  const { count, error } = await db
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("clerk_user_id", clerkUserId)
    .gte("recorded_at", since);
  if (error) return null;
  return typeof count === "number" ? count : 0;
}

async function countJourney(clerkUserId: string, journeyId: string): Promise<number | null> {
  const db = await diagnosticDb();
  const { count, error } = await db
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("clerk_user_id", clerkUserId)
    .eq("journey_id", journeyId);
  if (error) return null;
  return typeof count === "number" ? count : 0;
}

async function writeOnboardingDiagnostic(input: RecordOnboardingDiagnosticInput): Promise<void> {
  const clerkUserId = input.clerkUserId.trim();
  if (!clerkUserId || clerkUserId.length > 128 || /\s/.test(clerkUserId)) return;

  const errorCode = input.errorCode ?? "none";
  const journeyId = sanitizeDiagnosticId(input.journeyId, "server");
  const attemptWasValid = sanitizeDiagnosticId(input.attemptId, "") !== "";
  const attemptId = attemptWasValid
    ? sanitizeDiagnosticId(input.attemptId, "")
    : input.source === "server"
      ? freshId()
      : "";
  if (!attemptId) return;

  const idempotencyKey = onboardingDiagnosticIdempotencyKey({
    clerkUserId,
    journeyId,
    attemptId,
    step: input.step,
    outcome: input.outcome,
    errorCode,
    oncePerMember: input.oncePerMember,
  });
  if (idempotencyKey.length > 200) return;

  if (!input.oncePerMember) {
    const recent = await countRecent(clerkUserId);
    if (recent != null && recent >= ONBOARDING_DIAGNOSTIC_RATE_LIMIT_PER_MINUTE) return;
    if (input.source === "client" && journeyId !== "server") {
      const journeyCount = await countJourney(clerkUserId, journeyId);
      if (journeyCount != null && journeyCount >= ONBOARDING_DIAGNOSTIC_JOURNEY_CAP) return;
    }
  }

  const classified = classifyOnboardingClient(input.userAgent);
  const db = await diagnosticDb();
  const { error } = await db.from(TABLE).insert({
    clerk_user_id: clerkUserId,
    step: input.step,
    outcome: input.outcome,
    error_code: errorCode,
    journey_id: journeyId,
    attempt_id: attemptId,
    client_shell: classified.clientShell,
    device_class: classified.deviceClass,
    browser_family: classified.browserFamily,
    source: input.source,
    idempotency_key: idempotencyKey,
  });
  if (error && error.code !== "23505") {
    console.warn("[onboarding-diagnostic] write failed", { code: error.code ?? "unknown" });
  }
}

/** Never throws. Resolves when the bounded write finishes or times out. */
export async function recordOnboardingDiagnostic(
  input: RecordOnboardingDiagnosticInput
): Promise<void> {
  await failOpenWithTimeout(
    writeOnboardingDiagnostic(input).catch((err: unknown) => {
      const code = err && typeof err === "object" && "code" in err ? String(err.code) : "threw";
      console.warn("[onboarding-diagnostic] write failed", { code });
    }),
    undefined,
    ONBOARDING_DIAGNOSTIC_TIMEOUT_MS
  );
}

/**
 * Starts a diagnostic write and returns immediately.
 * Next keeps the write alive after the response. A missing request scope
 * still runs the write, and a scheduler failure cannot reach the caller.
 */
export function scheduleOnboardingDiagnostic(input: RecordOnboardingDiagnosticInput): void {
  const work = recordOnboardingDiagnostic(input).catch(() => undefined);
  try {
    after(() => work);
  } catch {
    void work;
  }
}

export function recordOnboardingApiEvent(args: {
  request: Request;
  clerkUserId: string;
  step: OnboardingDiagnosticStep;
  outcome: OnboardingDiagnosticOutcome;
  errorCode?: OnboardingDiagnosticErrorCode;
}): void {
  scheduleOnboardingDiagnostic({
    clerkUserId: args.clerkUserId,
    step: args.step,
    outcome: args.outcome,
    errorCode: args.errorCode,
    journeyId: args.request.headers.get("x-onboarding-journey"),
    attemptId: args.request.headers.get("x-onboarding-attempt"),
    userAgent: args.request.headers.get("user-agent"),
    source: "server",
  });
}
