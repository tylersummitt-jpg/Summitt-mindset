/**
 * Claim/release helpers for stripe_webhook_events.
 *
 * `completed_at` means this code finished the event. `legacy_unverified`
 * means the row existed before that distinction: keep it for dedupe, and
 * do not treat it as a verified completion or as an abandoned claim.
 * `claimed_at` is only the current worker lease.
 */

import "server-only";

import { supabaseServer } from "@/lib/supabase-server";

/** How long a claim is treated as owned by a live worker. Not a completion signal. */
export const STRIPE_WEBHOOK_PROCESSING_LEASE_MS = 60_000;

export function stripeWebhookClaimIsLive(
  claimedAt: string | null,
  nowMs: number,
  leaseMs = STRIPE_WEBHOOK_PROCESSING_LEASE_MS
): boolean {
  if (!claimedAt) return false;
  const claimed = Date.parse(claimedAt);
  if (!Number.isFinite(claimed)) return false;
  return nowMs - claimed < leaseMs;
}

export type StripeWebhookEventClaim = {
  ok: boolean;
  found: boolean;
  completedAt: string | null;
  claimedAt: string | null;
  legacyUnverified: boolean;
};

const emptyClaim = {
  completedAt: null,
  claimedAt: null,
  legacyUnverified: false,
} as const;

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

/**
 * Read completion and the current claim lease. Does not change the row.
 * ok:false means the read failed and the caller must not treat the event as finished.
 */
export async function readStripeWebhookEventClaim(
  eventId: string
): Promise<StripeWebhookEventClaim> {
  const trimmed = eventId.trim();
  if (!trimmed) {
    return { ok: false, found: false, ...emptyClaim };
  }
  const { data, error } = await supabaseServer
    .from("stripe_webhook_events")
    .select("completed_at, claimed_at, legacy_unverified")
    .eq("event_id", trimmed)
    .maybeSingle();
  if (error) {
    console.error("[stripe_webhook_events] failed to read dedupe row", {
      event_id: trimmed,
    });
    return { ok: false, found: false, ...emptyClaim };
  }
  if (!data) {
    return { ok: true, found: false, ...emptyClaim };
  }
  const row = data as {
    completed_at?: unknown;
    claimed_at?: unknown;
    legacy_unverified?: unknown;
  };
  return {
    ok: true,
    found: true,
    completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
    claimedAt: typeof row.claimed_at === "string" ? row.claimed_at : null,
    legacyUnverified: row.legacy_unverified === true,
  };
}

/**
 * Take over one new unfinished event whose lease has expired.
 * Legacy rows and rows with completed_at are excluded. Two workers cannot
 * both match the same expired claim.
 */
export async function reclaimAbandonedStripeWebhookEvent(
  eventId: string,
  nowMs = Date.now()
): Promise<{ ok: boolean; reclaimed: boolean }> {
  const trimmed = eventId.trim();
  if (!trimmed) return { ok: false, reclaimed: false };
  const claimedAt = new Date(nowMs).toISOString();
  const cutoff = new Date(nowMs - STRIPE_WEBHOOK_PROCESSING_LEASE_MS).toISOString();
  const { data, error } = await supabaseServer
    .from("stripe_webhook_events")
    .update({ claimed_at: claimedAt })
    .eq("event_id", trimmed)
    .eq("legacy_unverified", false)
    .is("completed_at", null)
    .lt("claimed_at", cutoff)
    .select("event_id");
  if (error) {
    console.error("[stripe_webhook_events] failed to reclaim abandoned claim", {
      event_id: trimmed,
    });
    return { ok: false, reclaimed: false };
  }
  const rows = Array.isArray(data) ? data : [];
  return { ok: true, reclaimed: rows.length > 0 };
}

/**
 * Record explicit completion. Does not change created_at.
 * A later duplicate sees completed_at and does not run the handler again.
 */
export async function finishStripeWebhookEventDedupe(
  eventId: string,
  nowMs = Date.now()
): Promise<{ ok: boolean }> {
  const trimmed = eventId.trim();
  if (!trimmed) return { ok: false };
  const completedAt = new Date(nowMs).toISOString();
  const { error } = await supabaseServer
    .from("stripe_webhook_events")
    .update({ completed_at: completedAt })
    .eq("event_id", trimmed)
    .eq("legacy_unverified", false)
    .is("completed_at", null);
  if (error) {
    console.error("[stripe_webhook_events] failed to mark event finished", {
      event_id: trimmed,
    });
    return { ok: false };
  }
  return { ok: true };
}
