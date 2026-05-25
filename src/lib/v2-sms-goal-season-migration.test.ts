import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260610120000_v2_sms_goal_season_mutations.sql"
);

describe("v2 sms goal season mutations migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("defines bundled SMS goal-change RPC", () => {
    expect(sql).toContain("v2_apply_sms_goal_change_with_season_mutation");
    expect(sql).toContain("p_season_mode");
    expect(sql).toContain("same_season_sync");
    expect(sql).toContain("new_chapter");
  });

  it("defines explicit season lifecycle RPCs", () => {
    expect(sql).toContain("v2_close_active_accountability_season");
    expect(sql).toContain("v2_rename_accountability_season");
    expect(sql).toContain("v2_start_accountability_season_for_commitment");
  });

  it("grants execute to service_role only", () => {
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION v2_apply_sms_goal_change_with_season_mutation"
    );
    expect(sql).toContain("TO service_role");
    expect(sql).toContain("REVOKE ALL ON FUNCTION v2_close_active_accountability_season");
  });

  it("writes non-proof season lifecycle audit events", () => {
    expect(sql).toContain("'season_lifecycle', true");
    expect(sql).toContain("'exclude_from_proof_curation', true");
  });

  it("does not modify onboarding or raw replace RPC definitions", () => {
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION sob_complete_onboarding_activation/i);
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION v2_apply_guided_commitment_replace_mutation/i);
  });
});
