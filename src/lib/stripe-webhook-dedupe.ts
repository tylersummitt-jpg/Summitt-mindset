/**
 * APP-041B3b — narrow helpers for stripe_webhook_events claim/release.
 * Insert-before-handler dedupe is retained; lookup_failed must release the
 * current event_id so Stripe can retry when the DB recovers.
 */

import "server-only";

import { supabaseServer } from "@/lib/supabase-server";

/**
 * Delete only the given Stripe event_id from stripe_webhook_events so a
 * retryable failure can be redelivered. Does not touch other event rows.
 */
export async function releaseStripeWebhookEventDedupe(
  eventId: string
): Promise<{ ok: boolean }> {
  const trimmed = eventId.trim();
  if (!trimmed) return { ok: false };
  const { error } = await supabaseServer
    .from("stripe_webhook_events")
    .delete()
    .eq("event_id", trimmed);
  if (error) {
    console.error(
      "[stripe_webhook_events] failed to release dedupe row for retry",
      { event_id: trimmed }
    );
    return { ok: false };
  }
  return { ok: true };
}
