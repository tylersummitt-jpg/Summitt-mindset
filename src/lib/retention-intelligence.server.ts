import "server-only";

import Stripe from "stripe";

import {
  humanFirstTouchLabel,
  isLikelySummittStripeSubscription,
  organicSocialPlatformLabel,
  type GrowthStripeSubscription,
} from "@/lib/admin-subscriber-growth-pure";
import { parseContentProduction } from "@/lib/content-production";
import {
  buildRetentionIntelligence,
  spellFromSubscription,
  unreadableRetentionIntelligence,
  type RetentionAcquisition,
  type RetentionHit,
  type RetentionIntelligence,
  type RetentionInterval,
} from "@/lib/retention-intelligence";
import { getRecognizedSummittPriceIds } from "@/lib/stripe-recognized-price-ids";
import { supabaseServer } from "@/lib/supabase-server";

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const CHUNK = 80;

const UNREADABLE = "Stripe subscriptions or paid invoices could not be read.";
const WITHHELD =
  "Paid invoices stopped before the full history, newest first. First payment dates would be unreliable, so cohort rates are not shown. This is not zero retention.";

export async function loadRetentionIntelligence(
  now: Date,
  preloaded: { complete: boolean; subs: GrowthStripeSubscription[] } | null
): Promise<RetentionIntelligence> {
  if (!preloaded || (!preloaded.complete && preloaded.subs.length === 0)) {
    return unreadableRetentionIntelligence(UNREADABLE);
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return unreadableRetentionIntelligence(UNREADABLE);
  try {
    const stripe = new Stripe(key);
    const subscriptions = {
      rows: preloaded.subs.map(fromGrowthSubscription),
      complete: preloaded.complete,
    };
    const invoices = await listPaidInvoices(stripe);
    const appleRows = await countAppleRows();
    if (!invoices.complete) {
      const withheld = buildRetentionIntelligence({
        nowMs: now.getTime(),
        partial: true,
        partialReason: WITHHELD,
        withheld: WITHHELD,
        spells: [],
        activeWithoutPayment: 0,
        appleRows,
        customerFeedbackCount: 0,
        engagementReadable: false,
        hits: [],
        measuredSignals: [],
        acquisitionReadable: false,
        landingReadable: false,
        experimentReadable: false,
        acquisition: [],
      });
      return withheld;
    }

    const paidAtBySubscription = new Map<string, number[]>();
    for (const invoice of invoices.rows) {
      const list = paidAtBySubscription.get(invoice.subscriptionId) ?? [];
      list.push(invoice.paidAtMs);
      paidAtBySubscription.set(invoice.subscriptionId, list);
    }

    const recognized = new Set(getRecognizedSummittPriceIds());
    const spells = [];
    let activeWithoutPayment = 0;
    let customerFeedbackCount = 0;
    for (const row of subscriptions.rows) {
      if (!isLikelySummittStripeSubscription(row.growth, recognized)) continue;
      const paidAtMs = paidAtBySubscription.get(row.id) ?? [];
      const spell = spellFromSubscription({
        id: row.id,
        clerkUserId: row.clerkUserId,
        paidAtMs,
        status: row.growth.status,
        endedAtMs: row.endedAtMs,
        paused: row.paused,
        interval: row.interval,
        cancellationReason: row.cancellationReason,
        trialStartMs: row.trialStartMs,
      });
      if (!spell) {
        if (
          (row.growth.status === "active" || row.growth.status === "past_due") &&
          !row.paused
        ) {
          activeWithoutPayment += 1;
        }
        continue;
      }
      spells.push(spell);
      if (spell.endKnown && !spell.open && row.customerFeedback) customerFeedbackCount += 1;
    }

    const clerkIds = [
      ...new Set(spells.map((spell) => spell.clerkUserId).filter((id): id is string => Boolean(id))),
    ];
    const engagement = await loadEngagement(clerkIds);
    const acquisition = await loadAcquisition(clerkIds);

    return buildRetentionIntelligence({
      nowMs: now.getTime(),
      partial: !subscriptions.complete,
      partialReason: subscriptions.complete
        ? null
        : "The Stripe subscription list stopped early. These rates are not the whole business.",
      withheld: null,
      spells,
      activeWithoutPayment,
      appleRows,
      customerFeedbackCount,
      engagementReadable: engagement.readable,
      hits: engagement.hits,
      measuredSignals: engagement.signals,
      acquisitionReadable: acquisition.readable,
      landingReadable: acquisition.landingReadable,
      experimentReadable: acquisition.experimentReadable,
      acquisition: acquisition.rows,
    });
  } catch (err) {
    console.warn("[retention] billing read failed", {
      reason: err instanceof Error ? err.message : "retention_read_failed",
    });
    return unreadableRetentionIntelligence(UNREADABLE);
  }
}

type ListedSubscription = {
  id: string;
  growth: GrowthStripeSubscription;
  clerkUserId: string | null;
  endedAtMs: number | null;
  paused: boolean;
  interval: RetentionInterval;
  cancellationReason: string | null;
  customerFeedback: boolean;
  trialStartMs: number | null;
};

function fromGrowthSubscription(sub: GrowthStripeSubscription): ListedSubscription {
  const price = sub.items?.data?.[0]?.price;
  const intervalRaw = typeof price === "string" ? null : price?.recurring?.interval;
  const interval: RetentionInterval =
    intervalRaw === "year" ? "year" : intervalRaw === "month" ? "month" : "other";
  const feedback = sub.cancellation_feedback?.trim() ?? "";
  return {
    id: sub.id,
    growth: sub,
    clerkUserId: sub.metadata?.userId?.trim() || null,
    endedAtMs: typeof sub.ended_at === "number" ? sub.ended_at * 1000 : null,
    paused: Boolean(sub.pause_collection),
    interval,
    cancellationReason: sub.cancellation_reason ?? null,
    customerFeedback: feedback.length > 0,
    trialStartMs: typeof sub.trial_start === "number" ? sub.trial_start * 1000 : null,
  };
}

async function listPaidInvoices(
  stripe: Stripe
): Promise<{ rows: Array<{ subscriptionId: string; paidAtMs: number }>; complete: boolean }> {
  const rows: Array<{ subscriptionId: string; paidAtMs: number }> = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await stripe.invoices.list({
      status: "paid",
      limit: PAGE_SIZE,
      starting_after: startingAfter,
    });
    for (const invoice of res.data) {
      if (!(invoice.amount_paid > 0)) continue;
      const subscriptionId = invoiceSubscriptionId(invoice);
      if (!subscriptionId) continue;
      const paidAt = (
        invoice as { status_transitions?: { paid_at?: number | null } }
      ).status_transitions?.paid_at;
      const paidAtUnix = typeof paidAt === "number" ? paidAt : invoice.created;
      if (typeof paidAtUnix !== "number" || !Number.isFinite(paidAtUnix)) continue;
      rows.push({ subscriptionId, paidAtMs: paidAtUnix * 1000 });
    }
    if (!res.has_more) return { rows, complete: true };
    startingAfter = res.data[res.data.length - 1]?.id;
    if (!startingAfter) return { rows, complete: false };
  }
  return { rows, complete: false };
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as { subscription?: string | { id?: string } | null }).subscription;
  if (typeof legacy === "string" && legacy) return legacy;
  if (legacy && typeof legacy === "object" && typeof legacy.id === "string") return legacy.id;
  const parent = (
    invoice as {
      parent?: {
        subscription_details?: { subscription?: string | { id?: string } | null } | null;
      } | null;
    }
  ).parent;
  const current = parent?.subscription_details?.subscription;
  if (typeof current === "string" && current) return current;
  if (current && typeof current === "object" && typeof current.id === "string") return current.id;
  return null;
}

async function countAppleRows(): Promise<number | null> {
  const { count, error } = await supabaseServer
    .from("apple_subscriptions")
    .select("id", { count: "exact", head: true });
  if (error || typeof count !== "number") {
    console.warn("[retention] apple count failed", { reason: error?.message ?? "apple_count_failed" });
    return null;
  }
  return count;
}

async function loadEngagement(clerkIds: string[]): Promise<{
  readable: boolean;
  hits: RetentionHit[];
  signals: Array<{ id: string; label: string }>;
}> {
  if (clerkIds.length === 0) {
    return { readable: true, hits: [], signals: [] };
  }
  if (clerkIds.length > CHUNK * 8) {
    return { readable: false, hits: [], signals: [] };
  }
  const hits: RetentionHit[] = [];
  const signals: Array<{ id: string; label: string }> = [];

  const sends = await readChunked(
    "sms_send_events",
    "clerk_user_id, day_key, send_slot, message_sid, status",
    clerkIds
  );
  if (sends.ok) {
    signals.push(
      { id: "coaching", label: "Coaching text delivered" },
      { id: "morning", label: "Morning coaching text" },
      { id: "evening", label: "Evening coaching text" }
    );
    for (const row of sends.rows) {
      const clerkUserId = text(row.clerk_user_id);
      const atMs = dayKeyMs(row.day_key);
      if (!clerkUserId || atMs == null) continue;
      const sid = text(row.message_sid);
      const status = text(row.status);
      if (!sid || status === "failed" || status === "undelivered") continue;
      hits.push({ clerkUserId, atMs, signal: "coaching" });
      const slot = text(row.send_slot);
      if (slot === "morning" || slot === "evening") {
        hits.push({ clerkUserId, atMs, signal: slot });
      }
    }
  }

  const replies = await readChunked("sms_inbound_messages", "clerk_user_id, received_at", clerkIds);
  if (replies.ok) {
    signals.push({ id: "reply", label: "Replied to coaching" });
    for (const row of replies.rows) {
      const clerkUserId = text(row.clerk_user_id);
      const atMs = isoMs(row.received_at);
      if (!clerkUserId || atMs == null) continue;
      hits.push({ clerkUserId, atMs, signal: "reply" });
    }
  }

  const askPat = await readChunked("ask_pat_questions", "clerk_user_id, day_key", clerkIds);
  if (askPat.ok) {
    signals.push({ id: "ask_pat", label: "Ask Pat" });
    for (const row of askPat.rows) {
      const clerkUserId = text(row.clerk_user_id);
      const atMs = dayKeyMs(row.day_key);
      if (!clerkUserId || atMs == null) continue;
      hits.push({ clerkUserId, atMs, signal: "ask_pat" });
    }
  }

  const wins = await readChunked("v2_win", "clerk_user_id, occurred_at, win_kind", clerkIds);
  if (wins.ok) {
    signals.push(
      { id: "goal_win", label: "Goal Win" },
      { id: "proud_moment", label: "Proud Moment" }
    );
    for (const row of wins.rows) {
      const clerkUserId = text(row.clerk_user_id);
      const atMs = isoMs(row.occurred_at);
      const kind = text(row.win_kind);
      if (!clerkUserId || atMs == null) continue;
      if (kind === "goal_win" || kind === "proud_moment") {
        hits.push({ clerkUserId, atMs, signal: kind });
      }
    }
  }

  const programs = await readChunked(
    "learning_mini_program_progress",
    "clerk_user_id, started_at, completed_at",
    clerkIds
  );
  if (programs.ok) {
    signals.push({ id: "program", label: "Program started or completed" });
    for (const row of programs.rows) {
      const clerkUserId = text(row.clerk_user_id);
      const started = isoMs(row.started_at);
      const completed = isoMs(row.completed_at);
      if (!clerkUserId) continue;
      if (started != null) hits.push({ clerkUserId, atMs: started, signal: "program" });
      if (completed != null) hits.push({ clerkUserId, atMs: completed, signal: "program" });
    }
  }

  const profiles = await readChunked(
    "user_profiles",
    "clerk_user_id, identity_intake_completed_at",
    clerkIds
  );
  if (profiles.ok) {
    signals.push({ id: "onboarding", label: "Onboarding completed" });
    for (const row of profiles.rows) {
      const clerkUserId = text(row.clerk_user_id);
      const atMs = isoMs(row.identity_intake_completed_at);
      if (!clerkUserId || atMs == null) continue;
      hits.push({ clerkUserId, atMs, signal: "onboarding" });
    }
  }

  return { readable: signals.length > 0, hits, signals };
}

async function loadAcquisition(clerkIds: string[]): Promise<{
  readable: boolean;
  landingReadable: boolean;
  experimentReadable: boolean;
  rows: RetentionAcquisition[];
}> {
  if (clerkIds.length === 0) {
    return { readable: true, landingReadable: true, experimentReadable: true, rows: [] };
  }
  const attribution = await readChunked(
    "marketing_attribution",
    "clerk_user_id, visitor_id, source_normalized, is_paid_acquisition, source_detail, referrer_host, utm_source, utm_campaign, utm_content",
    clerkIds
  );
  if (!attribution.ok) {
    return { readable: false, landingReadable: false, experimentReadable: false, rows: [] };
  }
  const byClerk = new Map<string, Array<Record<string, unknown>>>();
  for (const row of attribution.rows) {
    const clerkUserId = text(row.clerk_user_id);
    if (!clerkUserId) continue;
    const list = byClerk.get(clerkUserId) ?? [];
    list.push(row);
    byClerk.set(clerkUserId, list);
  }

  const visitorByClerk = new Map<string, string | null>();
  const rows: RetentionAcquisition[] = clerkIds.map((clerkUserId) => {
    const records = byClerk.get(clerkUserId) ?? [];
    const visitorIds = uniqueText(records.map((row) => row.visitor_id));
    const visitorId = visitorIds.length === 1 ? visitorIds[0] : null;
    visitorByClerk.set(clerkUserId, visitorId);
    return {
      clerkUserId,
      source: records.length === 0 ? null : singleText(records.map((row) => row.source_normalized)),
      campaign: records.length === 0 ? null : singleText(records.map((row) => row.utm_campaign)),
      content: records.length === 0 ? null : singleText(records.map((row) => row.utm_content)),
      channel: records.length === 0 ? null : singleText(records.map((row) => channelLabel(row))),
      production: null,
      landing: null,
      experiment: null,
    };
  });

  const visitorIds = [...new Set([...visitorByClerk.values()].filter((id): id is string => Boolean(id)))];
  const events = await readVisitorEvents(visitorIds);
  if (!events.ok) {
    return { readable: true, landingReadable: false, experimentReadable: false, rows };
  }
  const eventsByVisitor = new Map<string, Array<Record<string, unknown>>>();
  for (const row of events.rows) {
    const visitorId = text(row.visitor_id);
    if (!visitorId) continue;
    const list = eventsByVisitor.get(visitorId) ?? [];
    list.push(row);
    eventsByVisitor.set(visitorId, list);
  }
  for (const row of rows) {
    const visitorId = visitorByClerk.get(row.clerkUserId);
    if (!visitorId) {
      row.experiment = "Unknown";
      continue;
    }
    const visits = eventsByVisitor.get(visitorId) ?? [];
    const earliest = [...visits].sort((a, b) => (isoMs(a.occurred_at) ?? 0) - (isoMs(b.occurred_at) ?? 0))[0];
    row.landing = text(earliest?.path);
    row.experiment = experimentLabel(visits);
    row.production = productionFromVisits(visits);
  }
  return { readable: true, landingReadable: true, experimentReadable: true, rows };
}

function channelLabel(row: Record<string, unknown>): string | null {
  const source = text(row.source_normalized);
  if (!source) return null;
  const platform = organicSocialPlatformLabel(source, text(row.utm_source));
  if (platform) return platform;
  return humanFirstTouchLabel({
    source_normalized: source,
    is_paid_acquisition: row.is_paid_acquisition === true,
    source_detail: text(row.source_detail),
    referrer_host: text(row.referrer_host),
    utm_source: text(row.utm_source),
  });
}

function productionFromVisits(visits: Array<Record<string, unknown>>): string | null {
  const labels = new Set<string>();
  for (const visit of visits) {
    const metadata = visit.metadata;
    if (!metadata || typeof metadata !== "object") continue;
    const production = parseContentProduction(
      (metadata as { production?: unknown }).production
    );
    if (production) labels.add(production);
  }
  if (labels.size === 1) return [...labels][0] ?? null;
  return null;
}

function experimentLabel(visits: Array<Record<string, unknown>>): string {
  const labels = new Set<string>();
  for (const visit of visits) {
    const metadata = visit.metadata;
    if (!metadata || typeof metadata !== "object") continue;
    const record = metadata as { experiment_id?: unknown; experiment_variant?: unknown };
    const id = text(record.experiment_id);
    const variant = text(record.experiment_variant);
    if (!id || (variant !== "control" && variant !== "challenger")) continue;
    labels.add(`${id.slice(0, 8)} · ${variant}`);
  }
  if (labels.size === 1) return [...labels][0] ?? "Unknown";
  if (labels.size > 1) return "Unknown";
  return "Not in a controlled experiment";
}

async function readVisitorEvents(
  visitorIds: string[]
): Promise<{ ok: boolean; rows: Array<Record<string, unknown>> }> {
  if (visitorIds.length === 0) return { ok: true, rows: [] };
  const rows: Array<Record<string, unknown>> = [];
  for (const group of chunks(visitorIds, CHUNK)) {
    let from = 0;
    for (let page = 0; page < 4; page += 1) {
      const { data, error } = await supabaseServer
        .from("marketing_events")
        .select("visitor_id, path, occurred_at, metadata")
        .eq("event_type", "page_viewed")
        .in("visitor_id", group)
        .order("occurred_at", { ascending: true })
        .range(from, from + 499);
      if (error) {
        console.warn("[retention] landing read failed", { reason: error.message });
        return { ok: false, rows: [] };
      }
      const batch = (data ?? []) as unknown as Array<Record<string, unknown>>;
      rows.push(...batch);
      if (batch.length < 500) break;
      if (page === 3) return { ok: false, rows: [] };
      from += 500;
    }
  }
  return { ok: true, rows };
}

async function readChunked(
  table: string,
  columns: string,
  ids: string[]
): Promise<{ ok: boolean; rows: Array<Record<string, unknown>> }> {
  const rows: Array<Record<string, unknown>> = [];
  for (const group of chunks(ids, CHUNK)) {
    let from = 0;
    for (let page = 0; page < 4; page += 1) {
      const { data, error } = await supabaseServer
        .from(table)
        .select(columns)
        .in("clerk_user_id", group)
        .range(from, from + 499);
      if (error) {
        console.warn("[retention] product read failed", { table, reason: error.message });
        return { ok: false, rows: [] };
      }
      const batch = (data ?? []) as unknown as Array<Record<string, unknown>>;
      rows.push(...batch);
      if (batch.length < 500) break;
      if (page === 3) return { ok: false, rows: [] };
      from += 500;
    }
  }
  return { ok: true, rows };
}

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uniqueText(values: unknown[]): string[] {
  return [...new Set(values.map((value) => text(value)).filter((value): value is string => Boolean(value)))];
}

function singleText(values: unknown[]): string | null {
  const unique = uniqueText(values);
  return unique.length === 1 ? unique[0] : null;
}

function dayKeyMs(value: unknown): number | null {
  const day = text(value);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const ms = Date.parse(`${day}T12:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

function isoMs(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}
