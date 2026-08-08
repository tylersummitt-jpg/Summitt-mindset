import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HISTORICAL = join(
  process.cwd(),
  "supabase/migrations/20260610120000_v2_sms_goal_season_mutations.sql"
);

const LAW = join(
  process.cwd(),
  "supabase/migrations/20260807120000_saved_goal_change_always_new_chapter.sql"
);

describe("v2 sms goal season mutations migration (historical)", () => {
  const sql = readFileSync(HISTORICAL, "utf8");

  it("defines bundled SMS goal-change RPC", () => {
    expect(sql).toContain("v2_apply_sms_goal_change_with_season_mutation");
    expect(sql).toContain("p_season_mode");
    expect(sql).toContain("same_season_sync");
    expect(sql).toContain("new_chapter");
  });

  it("does not modify onboarding or raw replace RPC definitions", () => {
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION sob_complete_onboarding_activation/i);
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION v2_apply_guided_commitment_replace_mutation/i);
  });
});

describe("saved goal change always new chapter migration", () => {
  const sql = readFileSync(LAW, "utf8");

  it("replaces bundled RPC and preserves signature", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION v2_apply_sms_goal_change_with_season_mutation");
    expect(sql).toContain("p_old_commitment_id UUID");
    expect(sql).toContain("p_season_mode TEXT");
    expect(sql).toContain("same_season_goal_snapshot_synced BOOLEAN");
  });

  it("accepts legacy same_season_sync but normalizes effective mode to new_chapter", () => {
    expect(sql).toContain("NOT IN ('same_season_sync', 'new_chapter')");
    expect(sql).toContain("v_effective_mode := 'new_chapter'");
    expect(sql).toContain("requested_season_mode");
  });

  it("removes in-place same-season behavior_statement mutation path", () => {
    expect(sql).not.toContain("same_season_goal_sync");
    expect(sql).not.toMatch(
      /IF p_season_mode = 'same_season_sync' THEN[\s\S]*UPDATE v2_commitment\s+SET behavior_statement/
    );
  });

  it("idempotent replay reports new_chapter truth not same_season_sync", () => {
    expect(sql).toContain("'already_applied'::TEXT");
    expect(sql).toMatch(/already_applied[\s\S]*v_effective_mode/);
    expect(sql).not.toMatch(
      /already_applied[\s\S]*\(p_season_mode = 'same_season_sync'\)/
    );
  });

  it("keeps service_role grant and does not elevate security attributes", () => {
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION v2_apply_sms_goal_change_with_season_mutation"
    );
    expect(sql).toContain("TO service_role");
    expect(sql).not.toMatch(/^\s*SECURITY\s+DEFINER/im);
    expect(sql).not.toMatch(/SET\s+search_path\s*=/i);
  });

  it("does not invent season updated_at column writes or modify guided replace RPC", () => {
    expect(sql).not.toMatch(
      /UPDATE\s+user_accountability_season[\s\S]{0,120}updated_at/i
    );
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION v2_apply_guided_commitment_replace_mutation/i);
  });
});
