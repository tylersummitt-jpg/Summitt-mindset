import "server-only";

import { continueAfterRangePage } from "@/lib/acquisition/backfill";
import {
  foldEligibility,
  foldExperimentActivity,
  presentExperimentActivity,
  unavailableEligibility,
  unavailableExperimentActivity,
  type ActivityActionRow,
  type ActivityEventRow,
  type EligibilityPerson,
  type EligibilityReport,
  type ExperimentActivity,
} from "@/lib/acquisition/experiment-activity";
import { growthPeriodUtcMs, SUBSCRIBER_GROWTH_TZ, type GrowthDateRange } from "@/lib/admin-subscriber-growth-pure";
import { getDateKeyInTimezone } from "@/lib/timezone";
import { supabaseServer } from "@/lib/supabase-server";

const PAGE_SIZE = 1000;
const PAGE_CAP = 50;

const EVENT_TYPES = [
  "email_sent",
  "reply_received",
  "lead_unsubscribed",
  "resend_unsubscribed",
  "email_bounced",
  "resend_bounced",
  "resend_complained",
  "campaign_completed",
  "trial_started",
] as const;

type Page<T> = { ok: boolean; complete: boolean; rows: T[] };

async function readPages<T>(
  load: (from: number, to: number) => Promise<{ rows: T[]; rawCount: number; error: { message: string } | null }>,
): Promise<Page<T>> {
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

export async function loadExperimentActivity(args: {
  range: GrowthDateRange;
  now?: Date;
}): Promise<{ activity: ExperimentActivity; eligibility: EligibilityReport }> {
  const now = args.now ?? new Date();
  const period = growthPeriodUtcMs(args.range, getDateKeyInTimezone(now, SUBSCRIBER_GROWTH_TZ));
  if (!period) {
    const note = "The America/New_York range could not be resolved. Do not treat that as zero.";
    return { activity: unavailableExperimentActivity(note), eligibility: unavailableEligibility(note) };
  }
  const start = period.startMs == null ? null : new Date(period.startMs).toISOString();
  const end = new Date(period.endMs).toISOString();

  const events = await readPages<ActivityEventRow>(async (from, to) => {
    let query = supabaseServer
      .from("acquisition_events")
      .select("person_id, provider, provider_event_id, event_type, occurred_at")
      .in("event_type", [...EVENT_TYPES])
      .lt("occurred_at", end)
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true });
    if (start) query = query.gte("occurred_at", start);
    const { data, error } = await query.range(from, to);
    const raw = data ?? [];
    return {
      rawCount: raw.length,
      error,
      rows: raw.flatMap((row) => {
        if (typeof row.provider !== "string" || typeof row.event_type !== "string" || typeof row.occurred_at !== "string") return [];
        return [{
          personId: typeof row.person_id === "string" ? row.person_id : null,
          provider: row.provider,
          providerEventId: typeof row.provider_event_id === "string" ? row.provider_event_id : null,
          eventType: row.event_type,
          occurredAt: row.occurred_at,
        }];
      }),
    };
  });

  const actions = await readPages<ActivityActionRow>(async (from, to) => {
    const { data, error } = await supabaseServer
      .from("acquisition_actions")
      .select("person_id, action_type, status, updated_at, delivered_at")
      .eq("action_type", "send_asset")
      .in("status", ["accepted", "delivered"])
      .order("id", { ascending: true })
      .range(from, to);
    const raw = data ?? [];
    return {
      rawCount: raw.length,
      error,
      rows: raw.flatMap((row) => {
        if (typeof row.action_type !== "string" || typeof row.status !== "string") return [];
        return [{
          personId: typeof row.person_id === "string" ? row.person_id : null,
          actionType: row.action_type,
          status: row.status,
          updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
          deliveredAt: typeof row.delivered_at === "string" ? row.delivered_at : null,
        }];
      }),
    };
  });

  const people = await readPages<EligibilityPerson>(async (from, to) => {
    const { data, error } = await supabaseServer
      .from("acquisition_people")
      .select("email_normalized, lifecycle_state")
      .order("email_normalized", { ascending: true })
      .range(from, to);
    const raw = data ?? [];
    return {
      rawCount: raw.length,
      error,
      rows: raw.flatMap((row) => {
        if (typeof row.email_normalized !== "string" || typeof row.lifecycle_state !== "string") return [];
        return [{ email: row.email_normalized, lifecycle: row.lifecycle_state }];
      }),
    };
  });

  const suppressions = await readPages<string>(async (from, to) => {
    const { data, error } = await supabaseServer
      .from("recovery_suppressions")
      .select("email_normalized")
      .order("email_normalized", { ascending: true })
      .range(from, to);
    const raw = data ?? [];
    return {
      rawCount: raw.length,
      error,
      rows: raw.flatMap((row) => typeof row.email_normalized === "string" ? [row.email_normalized] : []),
    };
  });

  const activity = presentExperimentActivity({
    counts: foldExperimentActivity({
      events: events.ok ? events.rows : [],
      actions: actions.ok ? actions.rows : [],
      startMs: period.startMs,
      endMs: period.endMs,
    }),
    eventsFailed: !events.ok,
    actionsFailed: !actions.ok,
    eventsComplete: events.ok && events.complete,
    actionsComplete: actions.ok && actions.complete,
  });

  const eligibility = !people.ok
    ? unavailableEligibility("Acquisition people could not be read. Do not treat that as zero.")
    : !suppressions.ok
      ? unavailableEligibility("Suppression could not be read in full. Eligibility is unknown. Do not treat that as zero.")
      : foldEligibility({
        people: people.rows,
        suppressedEmails: suppressions.rows,
        peopleComplete: people.complete,
        suppressionComplete: suppressions.complete,
      });

  return { activity, eligibility };
}
