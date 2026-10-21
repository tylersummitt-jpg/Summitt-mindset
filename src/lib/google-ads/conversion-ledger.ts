/**
 * First-writer-wins Google Ads ingestion ledger. Fail-open for membership.
 * ingestion_accepted means Google returned a requestId. It is not attribution.
 */

import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import type { GoogleClickIdType } from "@/lib/marketing-attribution-pure";

export const GOOGLE_ADS_CONVERSION_MAX_EVENT_AGE_SECONDS = 90 * 24 * 60 * 60;
export const GOOGLE_ADS_CONVERSION_RETRY_MIN_AGE_MS = 2 * 60 * 1000;
export const GOOGLE_ADS_CONVERSION_RETRY_BATCH_LIMIT = 20;

const TABLE = "google_ads_conversion_events";

export type GoogleAdsEventKind = "trial_started" | "first_payment";

export type GoogleAdsLedgerStatus = "pending" | "ingestion_accepted" | "suppressed";

export type GoogleAdsLedgerRow = {
  id: string;
  event_kind: GoogleAdsEventKind;
  stripe_subscription_id: string;
  transaction_id: string;
  event_time: number;
  value: number | null;
  currency: string | null;
  google_click_id_type: GoogleClickIdType;
  google_click_id: string;
  request_country: "US";
  status: GoogleAdsLedgerStatus;
  google_request_id: string | null;
  created_at: string | null;
};

export type GoogleAdsClaimResult =
  | { status: "claimed" | "pending_retry"; row: GoogleAdsLedgerRow }
  | { status: "ingestion_accepted" | "suppressed" }
  | { status: "unavailable" };

const COLUMNS =
  "id, event_kind, stripe_subscription_id, transaction_id, event_time, value, currency, google_click_id_type, google_click_id, request_country, status, google_request_id, created_at";

function asClickType(value: unknown): GoogleClickIdType | null {
  if (value === "gclid" || value === "wbraid" || value === "gbraid") return value;
  return null;
}

function asRow(raw: Record<string, unknown> | null): GoogleAdsLedgerRow | null {
  if (!raw) return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  const eventKind = raw.event_kind;
  const subId = typeof raw.stripe_subscription_id === "string" ? raw.stripe_subscription_id : "";
  const transactionId = typeof raw.transaction_id === "string" ? raw.transaction_id : "";
  const eventTime = typeof raw.event_time === "number" ? raw.event_time : Number(raw.event_time);
  const clickType = asClickType(raw.google_click_id_type);
  const clickId = typeof raw.google_click_id === "string" ? raw.google_click_id : "";
  const status = raw.status;
  if (!id || !subId || !transactionId || !clickType || !clickId) return null;
  if (eventKind !== "trial_started" && eventKind !== "first_payment") return null;
  if (status !== "pending" && status !== "ingestion_accepted" && status !== "suppressed") {
    return null;
  }
  if (!Number.isFinite(eventTime)) return null;
  if (raw.request_country !== "US") return null;
  const valueRaw = raw.value;
  const value =
    valueRaw == null || valueRaw === ""
      ? null
      : typeof valueRaw === "number"
        ? valueRaw
        : Number(valueRaw);
  return {
    id,
    event_kind: eventKind,
    stripe_subscription_id: subId,
    transaction_id: transactionId,
    event_time: Math.floor(eventTime),
    value: value == null || !Number.isFinite(value) ? null : value,
    currency: typeof raw.currency === "string" ? raw.currency : null,
    google_click_id_type: clickType,
    google_click_id: clickId,
    request_country: "US",
    status,
    google_request_id: typeof raw.google_request_id === "string" ? raw.google_request_id : null,
    created_at: typeof raw.created_at === "string" ? raw.created_at : null,
  };
}

export async function claimGoogleAdsConversion(args: {
  eventKind: GoogleAdsEventKind;
  stripeSubscriptionId: string;
  transactionId: string;
  eventTime: number;
  value: number | null;
  currency: "USD" | null;
  clickType: GoogleClickIdType;
  clickId: string;
}): Promise<GoogleAdsClaimResult> {
  try {
    const subId = args.stripeSubscriptionId.trim();
    const transactionId = args.transactionId.trim();
    if (!subId || !transactionId || !args.clickId) return { status: "unavailable" };

    const insertPayload = {
      event_kind: args.eventKind,
      stripe_subscription_id: subId,
      transaction_id: transactionId,
      event_time: Math.floor(args.eventTime),
      value: args.value,
      currency: args.currency,
      google_click_id_type: args.clickType,
      google_click_id: args.clickId,
      request_country: "US",
      status: "pending",
    };

    const { data, error } = await supabaseServer
      .from(TABLE)
      .insert(insertPayload)
      .select(COLUMNS)
      .single();

    if (!error) {
      const row = asRow(data as Record<string, unknown> | null);
      if (!row || row.status !== "pending") return { status: "unavailable" };
      return { status: "claimed", row };
    }

    if (error.code !== "23505") {
      console.warn("[google-ads] ledger insert failed", {
        event_kind: args.eventKind,
        code: error.code ?? "unknown",
      });
      return { status: "unavailable" };
    }

    const { data: existing, error: selectError } = await supabaseServer
      .from(TABLE)
      .select(COLUMNS)
      .eq("event_kind", args.eventKind)
      .eq("stripe_subscription_id", subId)
      .maybeSingle();

    if (selectError || !existing) {
      console.warn("[google-ads] ledger conflict lookup failed", {
        event_kind: args.eventKind,
      });
      return { status: "unavailable" };
    }

    const row = asRow(existing as Record<string, unknown>);
    if (!row) {
      const status = (existing as { status?: unknown }).status;
      if (status === "ingestion_accepted") return { status: "ingestion_accepted" };
      if (status === "suppressed") return { status: "suppressed" };
      return { status: "unavailable" };
    }
    if (row.status === "ingestion_accepted") return { status: "ingestion_accepted" };
    if (row.status === "suppressed") return { status: "suppressed" };
    return { status: "pending_retry", row };
  } catch {
    console.warn("[google-ads] ledger claim unexpected", { event_kind: args.eventKind });
    return { status: "unavailable" };
  }
}

export async function readGoogleAdsConversionStatus(
  id: string
): Promise<GoogleAdsLedgerStatus | null> {
  try {
    const trimmed = id.trim();
    if (!trimmed) return null;
    const { data, error } = await supabaseServer
      .from(TABLE)
      .select("status")
      .eq("id", trimmed)
      .maybeSingle();
    if (error || !data) return null;
    const status = (data as { status?: unknown }).status;
    if (status === "pending" || status === "ingestion_accepted" || status === "suppressed") {
      return status;
    }
    return null;
  } catch {
    return null;
  }
}

export async function markGoogleAdsIngestionAccepted(
  id: string,
  requestId: string
): Promise<void> {
  try {
    const trimmed = id.trim();
    const request = requestId.trim();
    if (!trimmed || !request) return;
    const { error } = await supabaseServer
      .from(TABLE)
      .update({
        status: "ingestion_accepted",
        google_request_id: request,
        accepted_at: new Date().toISOString(),
        last_error: null,
        google_click_id: null,
        google_click_id_type: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", trimmed)
      .eq("status", "pending");
    if (error) console.warn("[google-ads] ledger accept failed");
  } catch {
    console.warn("[google-ads] ledger accept unexpected");
  }
}

export async function markGoogleAdsConversionError(id: string, reason: string): Promise<void> {
  try {
    const trimmed = id.trim();
    if (!trimmed) return;
    const safe = reason.replace(/[^a-z0-9_]/gi, "").slice(0, 40) || "error";
    const { error } = await supabaseServer
      .from(TABLE)
      .update({ last_error: safe, updated_at: new Date().toISOString() })
      .eq("id", trimmed)
      .eq("status", "pending");
    if (error) console.warn("[google-ads] ledger error mark failed");
  } catch {
    console.warn("[google-ads] ledger error mark unexpected");
  }
}

export async function listRetryableGoogleAdsConversions(
  nowMs: number
): Promise<GoogleAdsLedgerRow[]> {
  try {
    if (!Number.isFinite(nowMs)) return [];
    const nowUnix = Math.floor(nowMs / 1000);
    const minEventTime = nowUnix - GOOGLE_ADS_CONVERSION_MAX_EVENT_AGE_SECONDS;
    const createdBefore = new Date(nowMs - GOOGLE_ADS_CONVERSION_RETRY_MIN_AGE_MS).toISOString();
    const { data, error } = await supabaseServer
      .from(TABLE)
      .select(COLUMNS)
      .eq("status", "pending")
      .eq("request_country", "US")
      .not("google_click_id", "is", null)
      .gte("event_time", minEventTime)
      .lte("created_at", createdBefore)
      .order("created_at", { ascending: true })
      .limit(GOOGLE_ADS_CONVERSION_RETRY_BATCH_LIMIT);
    if (error || !data) return [];
    const rows: GoogleAdsLedgerRow[] = [];
    for (const raw of data) {
      const row = asRow(raw as Record<string, unknown>);
      if (row && row.status === "pending") rows.push(row);
    }
    return rows;
  } catch {
    return [];
  }
}

/**
 * Account deletion. Removes stored click ids.
 * Pending rows are suppressed so a later webhook cannot upload them.
 * Accepted rows keep the ingestion request id and lose the click id.
 */
export async function suppressGoogleAdsConversionsForClerkUser(
  clerkUserId: string | null | undefined
): Promise<void> {
  const uid = typeof clerkUserId === "string" ? clerkUserId.trim() : "";
  if (!uid) return;

  const { data, error } = await supabaseServer
    .from("checkout_browser_intents")
    .select("stripe_subscription_id")
    .eq("clerk_user_id", uid);
  if (error) {
    console.warn("[google-ads] deletion lookup failed", { code: error.code ?? "unknown" });
    throw new Error("google_ads_conversion_clear_failed");
  }

  const subscriptionIds: string[] = [];
  for (const row of data ?? []) {
    const id = (row as { stripe_subscription_id?: unknown }).stripe_subscription_id;
    if (typeof id === "string" && id.trim()) subscriptionIds.push(id.trim());
  }
  if (subscriptionIds.length === 0) return;

  const now = new Date().toISOString();
  const pending = await supabaseServer
    .from(TABLE)
    .update({
      status: "suppressed",
      google_click_id: null,
      google_click_id_type: null,
      request_country: null,
      updated_at: now,
    })
    .in("stripe_subscription_id", subscriptionIds)
    .eq("status", "pending");
  if (pending.error) {
    console.warn("[google-ads] deletion suppress failed", {
      code: pending.error.code ?? "unknown",
    });
    throw new Error("google_ads_conversion_clear_failed");
  }

  const accepted = await supabaseServer
    .from(TABLE)
    .update({
      google_click_id: null,
      google_click_id_type: null,
      updated_at: now,
    })
    .in("stripe_subscription_id", subscriptionIds)
    .eq("status", "ingestion_accepted");
  if (accepted.error) {
    console.warn("[google-ads] deletion click clear failed", {
      code: accepted.error.code ?? "unknown",
    });
    throw new Error("google_ads_conversion_clear_failed");
  }
}
