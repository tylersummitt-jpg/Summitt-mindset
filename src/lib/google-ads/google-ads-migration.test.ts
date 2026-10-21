import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20261021180000_google_ads_conversion_events.sql"),
  "utf8"
);

describe("google ads conversion ledger migration", () => {
  it("creates only the ingestion ledger and does not treat acceptance as attribution", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.google_ads_conversion_events");
    expect(sql).toContain("ingestion_accepted");
    expect(sql).toContain("start_trial:' || stripe_subscription_id");
    expect(sql).toContain("subscribe:' || stripe_subscription_id");
    expect(sql).toContain("request_country = 'US'");
    expect(sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.google_ads_conversion_events TO service_role");
    expect(sql).not.toMatch(/status IN \('attributed'|status = 'processed'/);
    expect(sql).not.toContain("meta_conversion_events");
    expect(sql).not.toContain("checkout_browser_intents");
    expect(sql).not.toContain("CREATE OR REPLACE FUNCTION public.purge_app_data_for_account_deletion(");
    expect(sql).not.toMatch(/\bemail_address\b|\bphone_number\b|\bclient_ip\b/);
  });
});
