import "server-only";

import Stripe from "stripe";

import { getDateKeyInTimezone } from "@/lib/timezone";
import {
  checkoutListLowerBoundMs,
  isCheckoutSessionId,
  summarizeCheckoutSessions,
  unavailableCheckoutMeasurement,
  type CheckoutMeasurement,
  type CheckoutSessionView,
} from "@/lib/checkout-tracking";
import {
  growthPeriodUtcMs,
  parseGrowthDateRange,
  SUBSCRIBER_GROWTH_TZ,
} from "@/lib/admin-subscriber-growth-pure";
import { supabaseServer } from "@/lib/supabase-server";

const LIST_PAGE = 100;
const LIST_MAX_PAGES = 5;
const EVENT_PAGE = 200;
const EVENT_MAX_PAGES = 10;

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function trialStartFromSubscription(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const trial = (raw as { trial_start?: unknown }).trial_start;
  return typeof trial === "number" && Number.isFinite(trial) ? trial : null;
}

function viewFromStripeSession(session: Stripe.Checkout.Session): CheckoutSessionView | null {
  if (!isCheckoutSessionId(session.id) || typeof session.created !== "number") return null;
  return {
    id: session.id,
    created: session.created,
    status: typeof session.status === "string" ? session.status : null,
    metadata: session.metadata,
    subscriptionTrialStart: trialStartFromSubscription(session.subscription),
  };
}

async function listInstrumentedSessions(args: {
  stripe: Stripe;
  startMs: number;
  endMs: number;
}): Promise<{ sessions: CheckoutSessionView[]; complete: boolean }> {
  const sessions: CheckoutSessionView[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
    const listed = await args.stripe.checkout.sessions.list({
      limit: LIST_PAGE,
      created: {
        gte: Math.floor(args.startMs / 1000),
        lt: Math.floor(args.endMs / 1000),
      },
      expand: ["data.subscription"],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const session of listed.data) {
      const view = viewFromStripeSession(session);
      if (view) sessions.push(view);
    }
    if (!listed.has_more) return { sessions, complete: true };
    const last = listed.data[listed.data.length - 1];
    if (!last?.id) return { sessions, complete: false };
    startingAfter = last.id;
  }
  return { sessions, complete: false };
}

async function loadCheckoutEvents(args: {
  startMs: number | null;
  endMs: number;
}): Promise<{ creationFailed: number; openedIds: Set<string>; complete: boolean }> {
  let creationFailed = 0;
  const openedIds = new Set<string>();
  let from = 0;
  for (let page = 0; page < EVENT_MAX_PAGES; page += 1) {
    let query = supabaseServer
      .from("marketing_events")
      .select("event_type, metadata, occurred_at")
      .in("event_type", ["checkout_opened", "checkout_creation_failed"])
      .lt("occurred_at", new Date(args.endMs).toISOString())
      .order("occurred_at", { ascending: true })
      .range(from, from + EVENT_PAGE - 1);
    if (args.startMs != null) {
      query = query.gte("occurred_at", new Date(args.startMs).toISOString());
    }
    const { data, error } = await query;
    if (error) {
      console.warn("[checkout-tracking] event query failed", error.message);
      return { creationFailed: 0, openedIds, complete: false };
    }
    const batch = data ?? [];
    for (const row of batch) {
      if (row.event_type === "checkout_creation_failed") {
        creationFailed += 1;
        continue;
      }
      if (row.event_type !== "checkout_opened") continue;
      const metadata = row.metadata as { checkout_session_id?: unknown } | null;
      const sessionId = metadata?.checkout_session_id;
      if (typeof sessionId === "string" && isCheckoutSessionId(sessionId)) {
        openedIds.add(sessionId);
      }
    }
    if (batch.length < EVENT_PAGE) {
      return { creationFailed, openedIds, complete: true };
    }
    from += EVENT_PAGE;
  }
  return { creationFailed, openedIds, complete: false };
}

export async function loadCheckoutMeasurement(args: {
  searchParams?: Record<string, string | string[] | undefined>;
  now?: Date;
}): Promise<CheckoutMeasurement> {
  const now = args.now ?? new Date();
  const range = parseGrowthDateRange(firstQueryValue(args.searchParams?.range));
  const todayKey = getDateKeyInTimezone(now, SUBSCRIBER_GROWTH_TZ);
  const period = growthPeriodUtcMs(range, todayKey);
  if (!period) return unavailableCheckoutMeasurement();

  const lower = checkoutListLowerBoundMs(period.startMs);
  const key = process.env.STRIPE_SECRET_KEY;
  let listed: { sessions: CheckoutSessionView[]; complete: boolean };
  if (!key) {
    listed = { sessions: [], complete: false };
  } else {
    try {
      listed = await listInstrumentedSessions({
        stripe: new Stripe(key),
        startMs: lower,
        endMs: period.endMs,
      });
    } catch (err) {
      console.warn("[checkout-tracking] session list failed", {
        reason: err instanceof Error ? err.message : "stripe_list_failed",
      });
      listed = { sessions: [], complete: false };
    }
  }

  let events: { creationFailed: number; openedIds: Set<string>; complete: boolean };
  try {
    events = await loadCheckoutEvents({
      startMs: period.startMs,
      endMs: period.endMs,
    });
  } catch (err) {
    console.warn("[checkout-tracking] event load threw", {
      reason: err instanceof Error ? err.message : "event_load_failed",
    });
    events = { creationFailed: 0, openedIds: new Set(), complete: false };
  }

  if (!listed.complete) {
    return {
      ...unavailableCheckoutMeasurement(),
      eventsComplete: events.complete,
      creationFailed: events.complete ? events.creationFailed : null,
      openedEvents: events.complete ? events.openedIds.size : null,
    };
  }

  const summary = summarizeCheckoutSessions(listed.sessions, now.getTime());
  if (!summary) return unavailableCheckoutMeasurement();
  return {
    ...summary,
    listComplete: true,
    eventsComplete: events.complete,
    creationFailed: events.complete ? events.creationFailed : null,
    openedEvents: events.complete ? events.openedIds.size : null,
  };
}
