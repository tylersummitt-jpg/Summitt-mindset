import "server-only";

import { supabaseServer } from "@/lib/supabase-server";

/**
 * Codes these signup handlers already throw. Anything else, including a raw
 * provider message, is not stored.
 */
export const SIGNUP_FAILURE_CODES = [
  "clerk_create_failed",
  "clerk_lookup_failed",
  "clerk_ticket_failed",
  "missing_clerk",
  "intent_load_failed",
  "intent_update_failed",
  "missing_stripe",
  "stripe_clear_hold_failed",
] as const;

export const SIGNUP_FAILURE_STEPS = [
  "prepare",
  "activate",
  "confirm",
  "link",
  "hold",
] as const;

export type SignupFailureCode = (typeof SIGNUP_FAILURE_CODES)[number];
export type SignupFailureStep = (typeof SIGNUP_FAILURE_STEPS)[number];

const recordedErrors = new WeakSet<object>();

function knownCode(error: unknown): SignupFailureCode | null {
  if (!(error instanceof Error)) return null;
  const code = error.message;
  return SIGNUP_FAILURE_CODES.includes(code as SignupFailureCode)
    ? (code as SignupFailureCode)
    : null;
}

/**
 * Records one known failure for one checkout. The same step and code stay one
 * row. A database error is contained and does not change the caller's result.
 */
export async function recordSignupFailure(args: {
  intentId: string;
  step: SignupFailureStep;
  error: unknown;
}): Promise<void> {
  try {
    if (typeof args.error === "object" && args.error && recordedErrors.has(args.error)) return;
    const code = knownCode(args.error);
    const intentId = args.intentId.trim();
    if (!code || !intentId || !SIGNUP_FAILURE_STEPS.includes(args.step)) return;
    if (typeof args.error === "object" && args.error) recordedErrors.add(args.error);
    const { error } = await supabaseServer.from("checkout_signup_failures").insert({
      checkout_intent_id: intentId,
      step: args.step,
      error_code: code,
      failed_at: new Date().toISOString(),
    });
    if (error && error.code !== "23505") {
      console.warn("[stripe-first] signup failure record failed", { code: error.code });
    }
  } catch {
    console.warn("[stripe-first] signup failure record failed");
  }
}
