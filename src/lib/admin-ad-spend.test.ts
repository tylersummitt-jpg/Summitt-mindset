import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { validateAdSpendInput } from "@/lib/admin-ad-spend-pure";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260901120000_marketing_analytics.sql"
);

describe("ad spend validation", () => {
  it("accepts Meta and Google with a positive daily amount", () => {
    expect(
      validateAdSpendInput({
        spend_date: "2026-09-01",
        source: "meta",
        amount_usd: 12.5,
        campaign: "spring",
      })
    ).toEqual({
      ok: true,
      spend_date: "2026-09-01",
      source_normalized: "meta",
      utm_campaign: "spring",
      amount_cents: 1250,
    });
    expect(
      validateAdSpendInput({
        date: "2026-09-01",
        source: "google",
        amount_usd: "40",
      })
    ).toEqual({
      ok: true,
      spend_date: "2026-09-01",
      source_normalized: "google",
      utm_campaign: "",
      amount_cents: 4000,
    });
  });

  it("normalizes missing or blank campaign to empty string", () => {
    expect(
      validateAdSpendInput({
        spend_date: "2026-09-01",
        source: "meta",
        amount_usd: 10,
      })
    ).toMatchObject({ ok: true, utm_campaign: "" });
    expect(
      validateAdSpendInput({
        spend_date: "2026-09-01",
        source: "google",
        amount_usd: 10,
        campaign: "   ",
      })
    ).toMatchObject({ ok: true, utm_campaign: "" });
    expect(
      validateAdSpendInput({
        spend_date: "2026-09-01",
        source: "meta",
        amount_usd: 10,
        campaign: null,
      })
    ).toMatchObject({ ok: true, utm_campaign: "" });
  });

  it("rejects Direct, organic, zero, and negative amounts", () => {
    expect(
      validateAdSpendInput({ spend_date: "2026-09-01", source: "direct", amount_usd: 10 })
    ).toEqual({ ok: false, error: "invalid_source" });
    expect(
      validateAdSpendInput({
        spend_date: "2026-09-01",
        source: "organic_social",
        amount_usd: 10,
      })
    ).toEqual({ ok: false, error: "invalid_source" });
    expect(
      validateAdSpendInput({ spend_date: "2026-09-01", source: "referral", amount_usd: 10 })
    ).toEqual({ ok: false, error: "invalid_source" });
    expect(
      validateAdSpendInput({ spend_date: "2026-09-01", source: "meta", amount_usd: 0 })
    ).toEqual({ ok: false, error: "invalid_amount" });
  });
});

describe("ad spend production schema alignment", () => {
  it("matches live ad_spend.utm_campaign NOT NULL DEFAULT '' unique key", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const adSpend = sql.slice(sql.indexOf("CREATE TABLE public.ad_spend"));
    expect(adSpend).toContain("utm_campaign TEXT NOT NULL DEFAULT ''");
    expect(adSpend).toContain("spend_date,\n    source_normalized,\n    utm_campaign");
    expect(adSpend).not.toContain("COALESCE");
    expect(adSpend).not.toMatch(/utm_campaign TEXT NULL/);
  });

  it("upserts on spend_date,source_normalized,utm_campaign", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/admin-ad-spend.ts"), "utf8");
    expect(src).toContain('onConflict: "spend_date,source_normalized,utm_campaign"');
    expect(src).not.toContain("COALESCE");
  });
});
