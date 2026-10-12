import { createClient } from "@supabase/supabase-js";

import type { AcquisitionCookiePayload } from "@/lib/marketing-attribution-pure";
import {
  PROUD_TEST_EXPERIMENT_ID,
  PROUD_TEST_INSTRUMENTATION_VERSION,
  type ProudTestStatus,
  type ProudTestVariant,
} from "@/lib/landing-experiment-shared";
import { parseClientEnvironment } from "@/lib/landing-experiment-telemetry";

const STATUS_CACHE_MS = 15_000;

let statusCache: { at: number; status: ProudTestStatus } | null = null;

function experimentClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function knownStatus(status: string | null | undefined): ProudTestStatus {
  const known: ProudTestStatus[] = ["running", "paused", "planned", "completed"];
  return known.includes(status as ProudTestStatus) ? (status as ProudTestStatus) : "missing";
}

/** Cached registry status for the homepage split. A failed read is not cached. */
export async function readProudTestStatus(): Promise<ProudTestStatus> {
  if (statusCache && Date.now() - statusCache.at < STATUS_CACHE_MS) return statusCache.status;
  const supabase = experimentClient();
  if (!supabase) return "unavailable";
  const result = await supabase
    .from("operating_experiments")
    .select("status")
    .eq("id", PROUD_TEST_EXPERIMENT_ID)
    .maybeSingle();
  if (result.error || !result.data) return "unavailable";
  const status = knownStatus(typeof result.data.status === "string" ? result.data.status : null);
  statusCache = { at: Date.now(), status };
  return status;
}

export function clearProudTestStatusMemory(): void {
  statusCache = null;
}

/**
 * One durable assignment per visitor. Safe to call from middleware.
 * The stored path stays off the landing pages so it is not a second page view.
 */
export async function recordLandingAssignment(args: {
  visitorId: string;
  experimentId: string;
  slug: string;
  variant: ProudTestVariant;
  attribution: AcquisitionCookiePayload;
  userAgent: string | null;
  synthetic: boolean;
  entryMode?: "homepage";
}): Promise<void> {
  const supabase = experimentClient();
  if (!supabase) return;
  const existing = await supabase
    .from("marketing_events")
    .select("id")
    .eq("event_type", "page_viewed")
    .eq("visitor_id", args.visitorId)
    .filter("metadata->>experiment_id", "eq", args.experimentId)
    .filter("metadata->>experiment_record", "eq", "assignment")
    .limit(1);
  if (existing.error) {
    console.warn("[landing-experiment] assignment lookup failed", { reason: existing.error.message });
    return;
  }
  if ((existing.data ?? []).length > 0) return;
  const environment = parseClientEnvironment(args.userAgent);
  const { error } = await supabase.from("marketing_events").insert({
    event_type: "page_viewed",
    visitor_id: args.visitorId,
    path: `/go/${args.slug}`,
    utm_source: args.attribution.utm_source,
    utm_medium: args.attribution.utm_medium,
    utm_campaign: args.attribution.utm_campaign,
    utm_content: args.attribution.utm_content,
    source_normalized: args.attribution.source_normalized,
    is_paid_acquisition: args.attribution.is_paid_acquisition,
    referrer_host: args.attribution.referrer_host,
    metadata: {
      experiment_id: args.experimentId,
      experiment_variant: args.variant,
      experiment_record: "assignment",
      instrumentation_version: PROUD_TEST_INSTRUMENTATION_VERSION,
      device: environment.device,
      os: environment.os,
      browser: environment.browser,
      in_app: environment.inApp,
      synthetic: args.synthetic,
      ...(args.entryMode ? { entry_mode: args.entryMode } : {}),
    },
  });
  if (error && (error as { code?: string }).code !== "23505") {
    console.warn("[landing-experiment] assignment insert failed", { reason: error.message });
  }
}
