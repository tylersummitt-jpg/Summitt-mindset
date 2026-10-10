import "server-only";

import type Stripe from "stripe";

import {
  CHECKOUT_TRACKING_METADATA_KEY,
  CHECKOUT_TRACKING_VERSION,
  isCheckoutSessionId,
  isCheckoutSource,
  shouldStampCheckoutSession,
} from "@/lib/checkout-tracking";
import { readMarketingCookiesFromRequest } from "@/lib/marketing-collect";
import type { SourceNormalized } from "@/lib/marketing-attribution-pure";
import { supabaseServer } from "@/lib/supabase-server";
import type { CheckoutChannel, CheckoutPlan } from "@/lib/stripe-pending-checkout-session";

type TrackBase = {
  clerkUserId: string;
  plan: CheckoutPlan;
  channel: CheckoutChannel;
  req: Request;
  nowMs?: number;
};

function logCheckoutTrack(message: string, err: unknown): void {
  const reason = err instanceof Error ? err.message : "checkout_track_failed";
  console.warn(`[checkout-tracking] ${message}`, reason);
}

async function readOptionalAttribution(req: Request): Promise<{
  visitorId: string | null;
  source: SourceNormalized | null;
  attribution: {
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    source_normalized: string | null;
    is_paid_acquisition: boolean;
    referrer_host: string | null;
  };
}> {
  const empty = {
    visitorId: null,
    source: null,
    attribution: {
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      source_normalized: null,
      is_paid_acquisition: false,
      referrer_host: null,
    },
  };
  try {
    const cookies = await readMarketingCookiesFromRequest(req);
    const source = isCheckoutSource(cookies.attribution?.source_normalized)
      ? cookies.attribution.source_normalized
      : null;
    return {
      visitorId: cookies.visitorId,
      source,
      attribution: {
        utm_source: cookies.attribution?.utm_source ?? null,
        utm_medium: cookies.attribution?.utm_medium ?? null,
        utm_campaign: cookies.attribution?.utm_campaign ?? null,
        utm_content: cookies.attribution?.utm_content ?? null,
        source_normalized: source,
        is_paid_acquisition: cookies.attribution?.is_paid_acquisition === true,
        referrer_host: cookies.attribution?.referrer_host ?? null,
      },
    };
  } catch (err) {
    logCheckoutTrack("cookies unreadable", err);
    return empty;
  }
}

async function insertCheckoutEvent(row: {
  eventType: "checkout_opened" | "checkout_creation_failed";
  clerkUserId: string;
  visitorId: string | null;
  attribution: {
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    source_normalized: string | null;
    is_paid_acquisition: boolean;
    referrer_host: string | null;
  };
  metadata: Record<string, string>;
}): Promise<void> {
  const { error } = await supabaseServer.from("marketing_events").insert({
    occurred_at: new Date().toISOString(),
    event_type: row.eventType,
    visitor_id: row.visitorId,
    clerk_user_id: row.clerkUserId,
    path: null,
    utm_source: row.attribution.utm_source,
    utm_medium: row.attribution.utm_medium,
    utm_campaign: row.attribution.utm_campaign,
    utm_content: row.attribution.utm_content,
    source_normalized: row.attribution.source_normalized,
    is_paid_acquisition: row.attribution.is_paid_acquisition,
    referrer_host: row.attribution.referrer_host,
    metadata: row.metadata,
  });
  if (error && (error as { code?: string }).code !== "23505") {
    logCheckoutTrack("insert failed", new Error(error.message));
  }
}

/**
 * Mark a session this request just created. Older idempotent replays are left
 * unmarked so they are not counted as new checkout starts.
 * A failure here does not change the checkout response.
 */
export async function trackFreshCheckoutSession(
  args: TrackBase & {
    stripe: Stripe;
    session: Pick<Stripe.Checkout.Session, "id" | "created" | "metadata">;
    coach: boolean;
  }
): Promise<void> {
  try {
    const nowMs = args.nowMs ?? Date.now();
    if (!isCheckoutSessionId(args.session.id)) return;
    if (!shouldStampCheckoutSession(args.session.created, nowMs)) return;

    const link = await readOptionalAttribution(args.req);
    const metadata: Record<string, string> = {
      ...(args.session.metadata ?? {}),
      userId: args.clerkUserId,
      plan: args.plan,
      [CHECKOUT_TRACKING_METADATA_KEY]: CHECKOUT_TRACKING_VERSION,
    };
    if (args.coach) metadata.summittAcquisition = "coach";
    if (link.visitorId) metadata.visitorId = link.visitorId;
    if (link.source) metadata.sourceNormalized = link.source;

    try {
      await args.stripe.checkout.sessions.update(args.session.id, { metadata });
    } catch (err) {
      logCheckoutTrack("session mark failed", err);
    }

    try {
      await insertCheckoutEvent({
        eventType: "checkout_opened",
        clerkUserId: args.clerkUserId,
        visitorId: link.visitorId,
        attribution: link.attribution,
        metadata: {
          checkout_session_id: args.session.id,
          track: CHECKOUT_TRACKING_VERSION,
          plan: args.plan,
          channel: args.channel,
        },
      });
    } catch (err) {
      logCheckoutTrack("checkout_opened insert threw", err);
    }
  } catch (err) {
    logCheckoutTrack("fresh session tracking threw", err);
  }
}

/** Stripe could not create a session. Never includes card or email fields. */
export async function trackCheckoutCreationFailed(args: TrackBase): Promise<void> {
  try {
    const link = await readOptionalAttribution(args.req);
    await insertCheckoutEvent({
      eventType: "checkout_creation_failed",
      clerkUserId: args.clerkUserId,
      visitorId: link.visitorId,
      attribution: link.attribution,
      metadata: {
        track: CHECKOUT_TRACKING_VERSION,
        plan: args.plan,
        channel: args.channel,
      },
    });
  } catch (err) {
    logCheckoutTrack("creation failure insert threw", err);
  }
}
