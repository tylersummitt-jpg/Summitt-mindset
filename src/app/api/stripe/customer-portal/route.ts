import { NextResponse } from "next/server";

/**
 * ======================================================
 * Stripe Customer Portal — DISABLED (CANONICAL)
 * ======================================================
 *
 * This endpoint is intentionally disabled.
 *
 * Reason:
 * - Stripe Billing Portal allows cancellation
 * - That would bypass Summitt Mindset’s
 *   canonical cancellation + feedback flow
 * - Silent churn is not allowed
 *
 * If billing changes are needed in the future,
 * they must be routed through:
 *   - Custom UI
 *   - Logged feedback
 *   - Explicit intent
 */

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Billing portal is disabled. Please use the in-app cancellation flow.",
      canonical: true,
    },
    { status: 410 } // Gone (intentional)
  );
}
