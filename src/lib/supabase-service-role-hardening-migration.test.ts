import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260613120000_supabase_service_role_only_hardening.sql"
);

const CRITICAL_TABLES = [
  "v2_commitment",
  "v2_commitment_event",
  "sms_audience",
  "sms_identities",
  "sms_inbound_messages",
  "sms_inbound_coach_jobs",
  "user_profiles",
  "journal_entries",
  "v2_sms_meaning_interpretation_shadow",
  "v2_sms_pattern_correction",
] as const;

const HARDENED_FUNCTIONS = [
  "set_updated_at",
  "set_updated_at_coach_shipping_addresses",
  "set_v2_user_sms_comms_prefs_updated_at",
  "update_sms_audience_timestamp",
  "update_user_profiles_timestamp",
  "update_weekly_summaries_updated_at",
  "v2_apply_check_sent_post_send_bookkeeping_mutation",
  "v2_apply_guided_commitment_replace_mutation",
  "v2_apply_overlay_consent_mutation",
  "v2_apply_refresh_commitment_step_resolution_mutation",
  "v2_apply_refresh_identity_step_resolution_mutation",
  "v2_apply_refresh_prompted_post_send_bookkeeping_mutation",
  "sob_complete_onboarding_activation",
  "v2_apply_sms_goal_change_with_season_mutation",
  "v2_close_active_accountability_season",
  "v2_rename_accountability_season",
  "v2_start_accountability_season_for_commitment",
] as const;

describe("supabase service-role-only hardening migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("documents server-side service-role model", () => {
    expect(sql).toMatch(/server-side service-role/i);
    expect(sql).toMatch(/Direct anon\/authenticated table access is intentionally revoked/i);
    expect(sql).toMatch(/Clerk-authenticated Next.js server routes/i);
    expect(sql).toMatch(/No client RLS policies are created/i);
  });

  it("enables RLS for key critical tables in allowlist", () => {
    for (const table of CRITICAL_TABLES) {
      expect(sql).toContain(`'${table}'`);
    }
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("revokes anon/authenticated/PUBLIC table privileges via DO block", () => {
    expect(sql).toContain("REVOKE ALL ON TABLE public.%I FROM anon");
    expect(sql).toContain("REVOKE ALL ON TABLE public.%I FROM authenticated");
    expect(sql).toContain("REVOKE ALL ON TABLE public.%I FROM PUBLIC");
    expect(sql).toContain("to_regclass");
  });

  it("drops unused SMS prefs client policy", () => {
    expect(sql).toContain(
      "DROP POLICY IF EXISTS v2_user_sms_comms_prefs_select_own ON public.v2_user_sms_comms_preferences"
    );
  });

  it("hardens key mutation RPCs to service_role only", () => {
    expect(sql).toContain("v2_apply_guided_commitment_replace_mutation");
    expect(sql).toContain("v2_apply_overlay_consent_mutation");
    expect(sql).toContain("sob_complete_onboarding_activation");
    expect(sql).toContain("v2_apply_sms_goal_change_with_season_mutation");
    expect(sql).toContain("REVOKE ALL ON FUNCTION %s FROM PUBLIC");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION %s TO service_role");
  });

  it("includes full function hardening allowlist (17 names)", () => {
    for (const fn of HARDENED_FUNCTIONS) {
      expect(sql).toContain(`'${fn}'`);
    }
  });

  it("does not create client policies or grant to anon/authenticated", () => {
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/GRANT\s+.*\s+TO\s+anon/i);
    expect(sql).not.toMatch(/GRANT\s+.*\s+TO\s+authenticated/i);
  });
});
