export type AdSpendSource = "meta" | "google";

function parseSource(raw: unknown): AdSpendSource | null {
  return raw === "meta" || raw === "google" ? raw : null;
}

function parseDateKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

function parseAmountToCents(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const cents = Math.round(raw * 100);
    return cents > 0 ? cents : null;
  }
  if (typeof raw === "string") {
    const n = Number(raw.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n)) return null;
    const cents = Math.round(n * 100);
    return cents > 0 ? cents : null;
  }
  return null;
}

function parseCampaign(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 200);
}

export function validateAdSpendInput(body: unknown):
  | { ok: true; spend_date: string; source_normalized: AdSpendSource; utm_campaign: string; amount_cents: number }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_body" };
  const rec = body as Record<string, unknown>;
  const spend_date = parseDateKey(rec.spend_date ?? rec.date);
  const source_normalized = parseSource(rec.source_normalized ?? rec.source);
  const amountRaw =
    rec.amount_usd ??
    rec.amount ??
    (typeof rec.amount_cents === "number" ? rec.amount_cents / 100 : null);
  const amount_cents = parseAmountToCents(amountRaw);
  const utm_campaign = parseCampaign(rec.utm_campaign ?? rec.campaign);
  if (!spend_date) return { ok: false, error: "invalid_date" };
  if (!source_normalized) return { ok: false, error: "invalid_source" };
  if (amount_cents == null) return { ok: false, error: "invalid_amount" };
  return { ok: true, spend_date, source_normalized, utm_campaign, amount_cents };
}
