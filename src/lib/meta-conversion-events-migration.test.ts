import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260902120000_meta_conversion_events.sql"
);

describe("meta_conversion_events migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("creates a minimal StartTrial/Subscribe ledger with first-writer-wins uniqueness", () => {
    expect(sql).toContain("CREATE TABLE public.meta_conversion_events");
    expect(sql).toContain("event_name IN ('StartTrial', 'Subscribe')");
    expect(sql).toContain(
      "CREATE UNIQUE INDEX meta_conversion_events_event_sub_uq"
    );
    expect(sql).toContain("(event_name, stripe_subscription_id)");
    expect(sql).toContain("sent_at TIMESTAMPTZ NULL");
  });

  it("is service-role only with RLS and no client policies", () => {
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON TABLE public.meta_conversion_events FROM anon");
    expect(sql).toContain(
      "REVOKE ALL ON TABLE public.meta_conversion_events FROM authenticated"
    );
    expect(sql).toContain("REVOKE ALL ON TABLE public.meta_conversion_events FROM PUBLIC");
    expect(sql).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meta_conversion_events TO service_role"
    );
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it("does not store email, phone, SMS, or raw Clerk user ids", () => {
    expect(sql).not.toMatch(/email TEXT|phone TEXT|clerk_user_id TEXT/i);
    expect(sql).toMatch(/Never store the raw Clerk id/);
  });
});
