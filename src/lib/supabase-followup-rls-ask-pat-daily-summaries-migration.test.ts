import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260613123000_supabase_followup_rls_ask_pat_daily_summaries.sql"
);

const TABLES = ["ask_pat_questions", "ask_pat_usage", "daily_summaries"] as const;

describe("supabase follow-up RLS ask_pat daily_summaries migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("includes all 3 table names", () => {
    for (const table of TABLES) {
      expect(sql).toContain(`'${table}'`);
    }
  });

  it("enables RLS and revokes anon/authenticated/PUBLIC", () => {
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON TABLE public.%I FROM anon");
    expect(sql).toContain("REVOKE ALL ON TABLE public.%I FROM authenticated");
    expect(sql).toContain("REVOKE ALL ON TABLE public.%I FROM PUBLIC");
    expect(sql).toContain("to_regclass");
  });

  it("does not create client policies or grant to anon/authenticated", () => {
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/GRANT\s+.*\s+TO\s+anon/i);
    expect(sql).not.toMatch(/GRANT\s+.*\s+TO\s+authenticated/i);
  });

  it("documents follow-up to service-role-only hardening", () => {
    expect(sql).toMatch(/follow-up/i);
    expect(sql).toMatch(/20260613120000_supabase_service_role_only_hardening/i);
    expect(sql).toMatch(/No client RLS policies are created/i);
  });
});
