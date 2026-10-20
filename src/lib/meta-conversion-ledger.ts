/**
 * First-writer-wins Meta conversion ledger. Fail-open for membership; fail-closed
 * for duplicate Meta sends when the ledger cannot be read/written.
 */

import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import type { MetaCapiStandardEvent } from "@/lib/meta-capi";

export const META_CONVERSION_MAX_EVENT_AGE_SECONDS = 7 * 24 * 60 * 60;
export const META_CONVERSION_RETRY_MIN_AGE_MS = 2 * 60 * 1000;
export const META_CONVERSION_RETRY_BATCH_LIMIT = 20;

export type MetaConversionClaimRow = {
  id: string;
  event_name: MetaCapiStandardEvent;
  stripe_subscription_id: string;
  meta_event_id: string;
  event_time: number;
  value: number | null;
  currency: string | null;
  external_id_hash: string | null;
  sent_at: string | null;
};

export type MetaConversionRetryRow = MetaConversionClaimRow & {
  created_at: string | null;
};

/** True when the stored event_time is not older than seven days. Does not rewrite it. */
export function metaConversionEventWithinMaxAge(
  eventTimeUnix: number,
  nowUnix: number
): boolean {
  if (!Number.isFinite(eventTimeUnix) || !Number.isFinite(nowUnix)) return false;
  return (
    Math.floor(eventTimeUnix) >=
    Math.floor(nowUnix) - META_CONVERSION_MAX_EVENT_AGE_SECONDS
  );
}

export type MetaConversionClaimResult =
  | { status: "claimed"; row: MetaConversionClaimRow }
  | { status: "pending_retry"; row: MetaConversionClaimRow }
  | { status: "already_sent" }
  | { status: "unavailable" };

const TABLE = "meta_conversion_events";

function asRow(raw: Record<string, unknown> | null): MetaConversionClaimRow | null {
  if (!raw) return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  const eventName = raw.event_name;
  const subId =
    typeof raw.stripe_subscription_id === "string" ? raw.stripe_subscription_id : "";
  const metaEventId = typeof raw.meta_event_id === "string" ? raw.meta_event_id : "";
  const eventTime = typeof raw.event_time === "number" ? raw.event_time : Number(raw.event_time);
  if (!id || (eventName !== "StartTrial" && eventName !== "Subscribe") || !subId || !metaEventId) {
    return null;
  }
  if (!Number.isFinite(eventTime)) return null;
  const valueRaw = raw.value;
  const value =
    valueRaw == null || valueRaw === ""
      ? null
      : typeof valueRaw === "number"
        ? valueRaw
        : Number(valueRaw);
  return {
    id,
    event_name: eventName,
    stripe_subscription_id: subId,
    meta_event_id: metaEventId,
    event_time: Math.floor(eventTime),
    value: value == null || !Number.isFinite(value) ? null : value,
    currency: typeof raw.currency === "string" ? raw.currency : null,
    external_id_hash: typeof raw.external_id_hash === "string" ? raw.external_id_hash : null,
    sent_at: typeof raw.sent_at === "string" ? raw.sent_at : null,
  };
}

export async function claimMetaConversionEvent(args: {
  eventName: MetaCapiStandardEvent;
  stripeSubscriptionId: string;
  metaEventId: string;
  eventTime: number;
  value?: number | null;
  currency?: string | null;
  externalIdHash?: string | null;
}): Promise<MetaConversionClaimResult> {
  try {
    const subId = args.stripeSubscriptionId.trim();
    const metaEventId = args.metaEventId.trim();
    if (!subId || !metaEventId) return { status: "unavailable" };

    const insertPayload = {
      event_name: args.eventName,
      stripe_subscription_id: subId,
      meta_event_id: metaEventId,
      event_time: Math.floor(args.eventTime),
      value: args.value ?? null,
      currency: args.currency ?? null,
      external_id_hash: args.externalIdHash ?? null,
    };

    const { data, error } = await supabaseServer
      .from(TABLE)
      .insert(insertPayload)
      .select(
        "id, event_name, stripe_subscription_id, meta_event_id, event_time, value, currency, external_id_hash, sent_at"
      )
      .single();

    if (!error) {
      const row = asRow(data as Record<string, unknown> | null);
      if (!row) return { status: "unavailable" };
      return { status: "claimed", row };
    }

    if (error.code !== "23505") {
      console.warn("[meta-capi] ledger insert failed", {
        event_name: args.eventName,
        code: error.code ?? "unknown",
      });
      return { status: "unavailable" };
    }

    const { data: existing, error: selectError } = await supabaseServer
      .from(TABLE)
      .select(
        "id, event_name, stripe_subscription_id, meta_event_id, event_time, value, currency, external_id_hash, sent_at"
      )
      .eq("event_name", args.eventName)
      .eq("stripe_subscription_id", subId)
      .maybeSingle();

    if (selectError || !existing) {
      console.warn("[meta-capi] ledger conflict lookup failed", {
        event_name: args.eventName,
      });
      return { status: "unavailable" };
    }

    const row = asRow(existing as Record<string, unknown>);
    if (!row) return { status: "unavailable" };
    if (row.sent_at) return { status: "already_sent" };
    return { status: "pending_retry", row };
  } catch {
    console.warn("[meta-capi] ledger claim unexpected", {
      event_name: args.eventName,
    });
    return { status: "unavailable" };
  }
}

export async function listPendingMetaConversionsForSubscription(
  stripeSubscriptionId: string
): Promise<MetaConversionClaimRow[]> {
  try {
    const subId = stripeSubscriptionId.trim();
    if (!subId) return [];
    const { data, error } = await supabaseServer
      .from(TABLE)
      .select(
        "id, event_name, stripe_subscription_id, meta_event_id, event_time, value, currency, external_id_hash, sent_at"
      )
      .eq("stripe_subscription_id", subId)
      .is("sent_at", null);
    if (error || !data) return [];
    const rows: MetaConversionClaimRow[] = [];
    for (const raw of data) {
      const row = asRow(raw as Record<string, unknown>);
      if (row) rows.push(row);
    }
    return rows;
  } catch {
    return [];
  }
}

const RETRY_COLUMNS =
  "id, event_name, stripe_subscription_id, meta_event_id, event_time, value, currency, external_id_hash, sent_at, created_at";

function asRetryRow(raw: Record<string, unknown> | null): MetaConversionRetryRow | null {
  const row = asRow(raw);
  if (!row || !raw) return null;
  return {
    ...row,
    created_at: typeof raw.created_at === "string" ? raw.created_at : null,
  };
}

/**
 * Pending rows old enough that the webhook attempt should have finished,
 * and young enough that Meta will still accept the original event_time.
 */
export async function listRetryableMetaConversions(
  nowMs: number
): Promise<MetaConversionRetryRow[]> {
  try {
    if (!Number.isFinite(nowMs)) return [];
    const nowUnix = Math.floor(nowMs / 1000);
    const minEventTime = nowUnix - META_CONVERSION_MAX_EVENT_AGE_SECONDS;
    const createdBefore = new Date(nowMs - META_CONVERSION_RETRY_MIN_AGE_MS).toISOString();
    const { data, error } = await supabaseServer
      .from(TABLE)
      .select(RETRY_COLUMNS)
      .is("sent_at", null)
      .gte("event_time", minEventTime)
      .lte("created_at", createdBefore)
      .order("created_at", { ascending: true })
      .limit(META_CONVERSION_RETRY_BATCH_LIMIT);
    if (error || !data) return [];
    const rows: MetaConversionRetryRow[] = [];
    for (const raw of data) {
      const row = asRetryRow(raw as Record<string, unknown>);
      if (row) rows.push(row);
    }
    return rows;
  } catch {
    return [];
  }
}

/** Re-read immediately before POST. False when the row is missing or already sent. */
export async function isMetaConversionUnsent(id: string): Promise<boolean> {
  try {
    const trimmed = id.trim();
    if (!trimmed) return false;
    const { data, error } = await supabaseServer
      .from(TABLE)
      .select("sent_at")
      .eq("id", trimmed)
      .maybeSingle();
    if (error || !data) return false;
    return (data as { sent_at?: unknown }).sent_at == null;
  } catch {
    return false;
  }
}

export async function markMetaConversionSent(id: string): Promise<void> {
  try {
    const trimmed = id.trim();
    if (!trimmed) return;
    const { error } = await supabaseServer
      .from(TABLE)
      .update({ sent_at: new Date().toISOString(), last_error: null })
      .eq("id", trimmed);
    if (error) {
      console.warn("[meta-capi] ledger mark sent failed");
    }
  } catch {
    console.warn("[meta-capi] ledger mark sent unexpected");
  }
}

export async function markMetaConversionError(id: string, reason: string): Promise<void> {
  try {
    const trimmed = id.trim();
    if (!trimmed) return;
    const safe = reason.replace(/[^a-z0-9_]/gi, "").slice(0, 40) || "error";
    const { error } = await supabaseServer
      .from(TABLE)
      .update({ last_error: safe })
      .eq("id", trimmed);
    if (error) {
      console.warn("[meta-capi] ledger mark error failed");
    }
  } catch {
    console.warn("[meta-capi] ledger mark error unexpected");
  }
}
