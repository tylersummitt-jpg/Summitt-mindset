import "server-only";

import { LANDING_MEASUREMENT_DESTINATIONS } from "@/lib/audience-landing-pages";
import {
  growthPeriodUtcMs,
  parseGrowthDateRange,
  SUBSCRIBER_GROWTH_TZ,
} from "@/lib/admin-subscriber-growth-pure";
import {
  LANDING_PAGE_MEASUREMENT_CUTOVER_MS,
  summarizeLandingPagePerformance,
  type LandingBillingInput,
  type LandingIdentityLink,
  type LandingObservation,
  type LandingPagePerformance,
} from "@/lib/landing-page-performance";
import { supabaseServer } from "@/lib/supabase-server";
import { getDateKeyInTimezone } from "@/lib/timezone";

const PAGE_SIZE = 200;
const MAX_PAGES = 8;
const HISTORY_MAX_PAGES = 25;

const MEASURED_PATHS = LANDING_MEASUREMENT_DESTINATIONS.map((item) => item.path);

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readEvents(args: {
  startMs: number | null;
  endMs: number;
  eventTypes: string[];
  paths: readonly string[] | null;
  maxPages?: number;
}): Promise<{ rows: LandingObservation[]; complete: boolean }> {
  const rows: LandingObservation[] = [];
  let from = 0;
  const maxPages = args.maxPages ?? MAX_PAGES;
  for (let page = 0; page < maxPages; page += 1) {
    let query = supabaseServer
      .from("marketing_events")
      .select("event_type, visitor_id, path, occurred_at")
      .in("event_type", args.eventTypes)
      .lt("occurred_at", new Date(args.endMs).toISOString())
      .order("occurred_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (args.startMs != null) {
      query = query.gte("occurred_at", new Date(args.startMs).toISOString());
    }
    if (args.paths) {
      query = query.in("path", [...args.paths]);
    }
    const { data, error } = await query;
    if (error) {
      console.warn("[landing-pages] event read failed", { reason: error.message });
      return { rows: [], complete: false };
    }
    const batch = data ?? [];
    for (const raw of batch) {
      if (typeof raw.visitor_id !== "string" || typeof raw.occurred_at !== "string") continue;
      if (typeof raw.event_type !== "string") continue;
      const occurredAtMs = Date.parse(raw.occurred_at);
      if (!Number.isFinite(occurredAtMs)) continue;
      const kind =
        raw.event_type === "page_viewed"
          ? "page_view"
          : raw.event_type === "trial_cta_clicked"
            ? "cta_click"
            : raw.event_type === "checkout_opened"
              ? "checkout"
              : raw.event_type === "account_created"
                ? "account"
                : null;
      if (!kind) continue;
      rows.push({
        kind,
        visitorId: raw.visitor_id,
        path: typeof raw.path === "string" ? raw.path : null,
        occurredAtMs,
      });
    }
    if (batch.length < PAGE_SIZE) return { rows, complete: true };
    from += PAGE_SIZE;
  }
  return { rows, complete: false };
}

const UNREADABLE_BILLING: LandingBillingInput = {
  subscriptionsReadable: false,
  paymentsReadable: false,
  trials: [],
  payments: [],
};

async function readIdentityLinks(endMs: number): Promise<{
  links: LandingIdentityLink[];
  complete: boolean;
}> {
  const links: LandingIdentityLink[] = [];
  let from = 0;
  for (let page = 0; page < HISTORY_MAX_PAGES; page += 1) {
    const { data, error } = await supabaseServer
      .from("marketing_attribution")
      .select("clerk_user_id, visitor_id, source_normalized")
      .order("clerk_user_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.warn("[landing-pages] attribution read failed", { reason: error.message });
      return { links: [], complete: false };
    }
    const batch = data ?? [];
    for (const raw of batch) {
      if (typeof raw.clerk_user_id !== "string" || typeof raw.visitor_id !== "string") continue;
      links.push({
        clerkUserId: raw.clerk_user_id,
        visitorId: raw.visitor_id,
        acquisitionSource:
          typeof raw.source_normalized === "string" ? raw.source_normalized : null,
      });
    }
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    if (page === HISTORY_MAX_PAGES - 1) return { links: [], complete: false };
  }

  from = 0;
  for (let page = 0; page < HISTORY_MAX_PAGES; page += 1) {
    const { data, error } = await supabaseServer
      .from("marketing_events")
      .select("visitor_id, clerk_user_id")
      .in("event_type", ["account_created", "checkout_opened"])
      .lt("occurred_at", new Date(endMs).toISOString())
      .order("occurred_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.warn("[landing-pages] identity event read failed", { reason: error.message });
      return { links: [], complete: false };
    }
    const batch = data ?? [];
    for (const raw of batch) {
      if (typeof raw.clerk_user_id !== "string" || typeof raw.visitor_id !== "string") continue;
      links.push({
        clerkUserId: raw.clerk_user_id,
        visitorId: raw.visitor_id,
        acquisitionSource: null,
      });
    }
    if (batch.length < PAGE_SIZE) return { links, complete: true };
    from += PAGE_SIZE;
  }
  return { links: [], complete: false };
}

export async function loadLandingPagePerformance(args: {
  searchParams?: Record<string, string | string[] | undefined>;
  now?: Date;
  billing?: LandingBillingInput | null;
}): Promise<LandingPagePerformance> {
  const now = args.now ?? new Date();
  const range = parseGrowthDateRange(firstQueryValue(args.searchParams?.range));
  const todayKey = getDateKeyInTimezone(now, SUBSCRIBER_GROWTH_TZ);
  const period = growthPeriodUtcMs(range, todayKey);
  if (!period) {
    return summarizeLandingPagePerformance({
      observations: [],
      pagesReadable: false,
      outcomesReadable: false,
    });
  }

  const pages = await readEvents({
    startMs: period.startMs,
    endMs: period.endMs,
    eventTypes: ["page_viewed", "trial_cta_clicked"],
    paths: MEASURED_PATHS,
  });
  const outcomes = await readEvents({
    startMs: period.startMs,
    endMs: period.endMs,
    eventTypes: ["checkout_opened", "account_created"],
    paths: null,
  });
  const history = await readEvents({
    startMs: LANDING_PAGE_MEASUREMENT_CUTOVER_MS,
    endMs: period.endMs,
    eventTypes: ["page_viewed"],
    paths: MEASURED_PATHS,
    maxPages: HISTORY_MAX_PAGES,
  });
  const identities = await readIdentityLinks(period.endMs);
  const pagesReadable = pages.complete || pages.rows.length > 0;
  const summary = summarizeLandingPagePerformance({
    observations: pagesReadable ? [...pages.rows, ...outcomes.rows] : [],
    attributionViews: history.rows,
    identities: identities.links,
    billing: args.billing === undefined ? UNREADABLE_BILLING : args.billing,
    journeyReadable: history.complete && identities.complete,
    pagesReadable,
    outcomesReadable: outcomes.complete,
    periodStartMs: period.startMs,
    periodEndMs: period.endMs,
    nowMs: now.getTime(),
  });
  return {
    ...summary,
    incomplete: pagesReadable && (!pages.complete || !outcomes.complete || !history.complete),
  };
}
