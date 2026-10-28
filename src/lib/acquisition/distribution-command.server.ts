import "server-only";

import { continueAfterRangePage } from "@/lib/acquisition/backfill";
import {
  buildDistributionCommand,
  unreadableDistributionCommand,
  type DistributionCommandReport,
  type LedgerAction,
  type LedgerEvent,
  type LedgerMessage,
  type LedgerPerson,
} from "@/lib/acquisition/distribution-command";
import { loadInstantlyForDistribution } from "@/lib/acquisition/instantly-analytics.server";
import {
  growthPeriodUtcMs,
  parseGrowthDateRange,
  SUBSCRIBER_GROWTH_TZ,
  type GrowthDateRange,
} from "@/lib/admin-subscriber-growth-pure";
import { getDateKeyInTimezone } from "@/lib/timezone";
import { supabaseServer } from "@/lib/supabase-server";

const PAGE_SIZE = 1000;
const PAGE_CAP = 50;
const CAMPAIGN_ID = /^[A-Za-z0-9_-]{1,80}$/;
const RANGE_LABEL: Record<GrowthDateRange, string> = {
  today: "Today",
  last_7: "Last 7 days",
  last_30: "Last 30 days",
  all_time: "All time",
};

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || null;
}

function rangeBounds(range: GrowthDateRange, now: Date): {
  startMs: number | null;
  endMs: number;
  startDate: string | null;
  endDate: string | null;
  daySpan: number | null;
} | null {
  const period = growthPeriodUtcMs(range, getDateKeyInTimezone(now, SUBSCRIBER_GROWTH_TZ));
  if (!period) return null;
  if (period.startMs == null) return { startMs: null, endMs: period.endMs, startDate: null, endDate: null, daySpan: null };
  const startDate = getDateKeyInTimezone(new Date(period.startMs), SUBSCRIBER_GROWTH_TZ);
  const endDate = getDateKeyInTimezone(new Date(period.endMs - 1), SUBSCRIBER_GROWTH_TZ);
  const daySpan = Math.round((period.endMs - period.startMs) / 86_400_000);
  return { startMs: period.startMs, endMs: period.endMs, startDate, endDate, daySpan };
}

async function readPages<T>(
  load: (from: number, to: number) => Promise<{ rows: T[]; rawCount: number; error: boolean }>,
): Promise<{ ok: boolean; complete: boolean; rows: T[] }> {
  const rows: T[] = [];
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const from = page * PAGE_SIZE;
    const batch = await load(from, from + PAGE_SIZE - 1);
    if (batch.error) return { ok: false, complete: false, rows };
    rows.push(...batch.rows);
    const decision = continueAfterRangePage({
      pageNumber: page + 1,
      pageCap: PAGE_CAP,
      rowCount: batch.rawCount,
      pageSize: PAGE_SIZE,
    });
    if (!decision.continue) return { ok: true, complete: decision.complete, rows };
  }
  return { ok: true, complete: false, rows };
}

export async function loadDistributionCommand(args: {
  searchParams?: Record<string, string | string[] | undefined>;
  now?: Date;
}): Promise<DistributionCommandReport> {
  const now = args.now ?? new Date();
  const range = parseGrowthDateRange(first(args.searchParams?.range));
  const label = RANGE_LABEL[range];
  const bounds = rangeBounds(range, now);
  if (!bounds) return unreadableDistributionCommand("The date range could not be resolved. Do not treat that as zero.", label);
  const selectedRaw = first(args.searchParams?.emailCampaign);
  const selectedCampaignId = selectedRaw && CAMPAIGN_ID.test(selectedRaw) ? selectedRaw : null;

  const [people, events, actions, messages, journeys, instantly] = await Promise.all([
    readPages<LedgerPerson>(async (from, to) => {
      const { data, error } = await supabaseServer
        .from("acquisition_people")
        .select("id, lifecycle_state, source_campaign, sport, role, geography, offer_key")
        .order("id", { ascending: true })
        .range(from, to);
      const raw = data ?? [];
      return {
        error: Boolean(error),
        rawCount: raw.length,
        rows: raw.flatMap((row) => {
          if (typeof row.id !== "string" || typeof row.lifecycle_state !== "string") return [];
          return [{
            id: row.id,
            lifecycle: row.lifecycle_state,
            sourceCampaign: typeof row.source_campaign === "string" ? row.source_campaign : null,
            sport: typeof row.sport === "string" ? row.sport : null,
            role: typeof row.role === "string" ? row.role : null,
            geography: typeof row.geography === "string" ? row.geography : null,
            offerKey: typeof row.offer_key === "string" ? row.offer_key : null,
          }];
        }),
      };
    }),
    readPages<LedgerEvent>(async (from, to) => {
      const { data, error } = await supabaseServer
        .from("acquisition_events")
        .select("person_id, provider, provider_event_id, event_type, occurred_at, campaign_id, journey_id, sender, metadata")
        .order("occurred_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      const raw = data ?? [];
      return {
        error: Boolean(error),
        rawCount: raw.length,
        rows: raw.flatMap((row) => {
          if (typeof row.provider !== "string" || typeof row.event_type !== "string" || typeof row.occurred_at !== "string") return [];
          const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
          const step = typeof metadata.step === "number" && Number.isFinite(metadata.step) ? metadata.step : null;
          const rawInstantlyType = typeof metadata.instantly_event_type === "string" ? metadata.instantly_event_type : null;
          return [{
            personId: typeof row.person_id === "string" ? row.person_id : null,
            provider: row.provider,
            providerEventId: typeof row.provider_event_id === "string" ? row.provider_event_id : null,
            eventType: row.event_type,
            occurredAt: row.occurred_at,
            campaignId: typeof row.campaign_id === "string" ? row.campaign_id : null,
            journeyId: typeof row.journey_id === "string" ? row.journey_id : null,
            sender: typeof row.sender === "string" ? row.sender : null,
            rawInstantlyType,
            step,
            videoId: typeof metadata.personal_video_id === "string" ? metadata.personal_video_id : null,
          }];
        }),
      };
    }),
    readPages<LedgerAction & { journeyId: string | null }>(async (from, to) => {
      const { data, error } = await supabaseServer
        .from("acquisition_actions")
        .select("person_id, journey_id, action_type, status, attempt_count, delivered_at, claimed_at")
        .order("id", { ascending: true })
        .range(from, to);
      const raw = data ?? [];
      return {
        error: Boolean(error),
        rawCount: raw.length,
        rows: raw.flatMap((row) => {
          if (typeof row.person_id !== "string" || typeof row.action_type !== "string" || typeof row.status !== "string") return [];
          return [{
            personId: row.person_id,
            journeyId: typeof row.journey_id === "string" ? row.journey_id : null,
            campaignId: null,
            actionType: row.action_type,
            status: row.status,
            attemptCount: typeof row.attempt_count === "number" ? row.attempt_count : 0,
            delivered: typeof row.delivered_at === "string",
            claimed: typeof row.claimed_at === "string",
          }];
        }),
      };
    }),
    readPages<LedgerMessage>(async (from, to) => {
      const { data, error } = await supabaseServer
        .from("acquisition_messages")
        .select("person_id, direction, processing_status, ai_outcome, campaign_id, occurred_at")
        .order("occurred_at", { ascending: true })
        .range(from, to);
      const raw = data ?? [];
      return {
        error: Boolean(error),
        rawCount: raw.length,
        rows: raw.flatMap((row) => {
          if (typeof row.direction !== "string" || typeof row.processing_status !== "string" || typeof row.occurred_at !== "string") return [];
          return [{
            personId: typeof row.person_id === "string" ? row.person_id : null,
            direction: row.direction,
            processingStatus: row.processing_status,
            aiOutcome: typeof row.ai_outcome === "string" ? row.ai_outcome : null,
            campaignId: typeof row.campaign_id === "string" ? row.campaign_id : null,
            occurredAt: row.occurred_at,
          }];
        }),
      };
    }),
    readPages<{ id: string; personId: string; campaignId: string | null; closed: boolean }>(async (from, to) => {
      const { data, error } = await supabaseServer
        .from("acquisition_journeys")
        .select("id, person_id, campaign_id, closed_at")
        .order("id", { ascending: true })
        .range(from, to);
      const raw = data ?? [];
      return {
        error: Boolean(error),
        rawCount: raw.length,
        rows: raw.flatMap((row) => {
          if (typeof row.id !== "string" || typeof row.person_id !== "string") return [];
          return [{
            id: row.id,
            personId: row.person_id,
            campaignId: typeof row.campaign_id === "string" ? row.campaign_id : null,
            closed: typeof row.closed_at === "string",
          }];
        }),
      };
    }),
    loadInstantlyForDistribution({
      startDate: bounds.startDate,
      endDate: bounds.endDate,
      daySpan: bounds.daySpan,
      selectedCampaignId,
    }),
  ]);

  if (!people.ok || !events.ok || !people.complete || !events.complete) {
    return unreadableDistributionCommand(
      !people.ok || !events.ok
        ? "The cold-email ledger could not be read. Do not treat that as zero."
        : "The cold-email read hit its row cap. Totals are withheld because they would be incomplete.",
      label,
    );
  }

  const journeyById = new Map(journeys.ok ? journeys.rows.map((row) => [row.id, row.campaignId]) : []);
  const linkedActions: LedgerAction[] = actions.ok
    ? actions.rows.map((row) => ({
      ...row,
      campaignId: row.journeyId ? journeyById.get(row.journeyId) ?? null : null,
    }))
    : [];
  const journeyPeople = new Set(journeys.ok ? journeys.rows.map((row) => row.personId) : []);

  return buildDistributionCommand({
    readable: true,
    truncated: false,
    rangeLabel: label,
    startMs: bounds.startMs,
    endMs: bounds.endMs,
    nowMs: now.getTime(),
    people: people.rows,
    events: events.rows,
    actions: actions.ok && actions.complete && journeys.ok ? linkedActions : null,
    messages: messages.ok && messages.complete ? messages.rows : null,
    openJourneys: journeys.ok && journeys.complete ? journeys.rows.filter((row) => !row.closed).length : null,
    closedJourneys: journeys.ok && journeys.complete ? journeys.rows.filter((row) => row.closed).length : null,
    peopleWithJourney: journeys.ok && journeys.complete ? journeyPeople.size : null,
    instantly,
  });
}
