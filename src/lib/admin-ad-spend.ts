import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import {
  validateAdSpendInput,
  type AdSpendSource,
} from "@/lib/admin-ad-spend-pure";

export { validateAdSpendInput, type AdSpendSource };

export type AdSpendRow = {
  id: string;
  spend_date: string;
  source_normalized: AdSpendSource;
  utm_campaign: string;
  amount_cents: number;
  currency: string;
};

function normalizeAdSpendCampaign(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, 200) : "";
}

function mapAdSpendRow(raw: {
  id?: unknown;
  spend_date?: unknown;
  source_normalized?: unknown;
  utm_campaign?: unknown;
  amount_cents?: unknown;
  currency?: unknown;
}): AdSpendRow | null {
  if (raw.source_normalized !== "meta" && raw.source_normalized !== "google") {
    return null;
  }
  if (typeof raw.id !== "string" || typeof raw.spend_date !== "string") return null;
  if (typeof raw.amount_cents !== "number") return null;
  return {
    id: raw.id,
    spend_date: raw.spend_date,
    source_normalized: raw.source_normalized,
    utm_campaign: normalizeAdSpendCampaign(raw.utm_campaign),
    amount_cents: raw.amount_cents,
    currency: typeof raw.currency === "string" ? raw.currency : "usd",
  };
}

export async function upsertAdSpend(input: {
  spend_date: string;
  source_normalized: AdSpendSource;
  utm_campaign: string;
  amount_cents: number;
}): Promise<AdSpendRow | null> {
  const utm_campaign = normalizeAdSpendCampaign(input.utm_campaign);
  const { data, error } = await supabaseServer
    .from("ad_spend")
    .upsert(
      {
        spend_date: input.spend_date,
        source_normalized: input.source_normalized,
        utm_campaign,
        amount_cents: input.amount_cents,
        currency: "usd",
      },
      { onConflict: "spend_date,source_normalized,utm_campaign" }
    )
    .select("id, spend_date, source_normalized, utm_campaign, amount_cents, currency")
    .maybeSingle();
  if (error || !data) {
    console.warn("[ad-spend] upsert failed", error?.message);
    return null;
  }
  return mapAdSpendRow(data);
}

export async function deleteAdSpend(id: string): Promise<boolean> {
  if (!id.trim()) return false;
  const { error } = await supabaseServer.from("ad_spend").delete().eq("id", id);
  if (error) {
    console.warn("[ad-spend] delete failed", error.message);
    return false;
  }
  return true;
}

export async function listAdSpendInRange(args: {
  startDate: string | null;
  endDateExclusive: string;
}): Promise<AdSpendRow[]> {
  let q = supabaseServer
    .from("ad_spend")
    .select("id, spend_date, source_normalized, utm_campaign, amount_cents, currency")
    .lt("spend_date", args.endDateExclusive)
    .order("spend_date", { ascending: false });
  if (args.startDate) {
    q = q.gte("spend_date", args.startDate);
  }
  const { data, error } = await q;
  if (error) {
    console.warn("[ad-spend] list failed", error.message);
    return [];
  }
  const rows: AdSpendRow[] = [];
  for (const raw of data ?? []) {
    const mapped = mapAdSpendRow(raw);
    if (mapped) rows.push(mapped);
  }
  return rows;
}
