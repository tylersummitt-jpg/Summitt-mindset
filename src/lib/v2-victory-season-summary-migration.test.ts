import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260605120000_victory_season_summary_snapshot.sql"
);

describe("victory season summary snapshot migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("creates v2_victory_season_summary_snapshot", () => {
    expect(sql).toContain("CREATE TABLE v2_victory_season_summary_snapshot");
    expect(sql).toContain("REFERENCES user_accountability_season (id)");
    expect(sql).toContain("REFERENCES v2_commitment (id)");
    expect(sql).toContain("summary_text TEXT NULL");
    expect(sql).toContain("input_bundle_json JSONB NOT NULL DEFAULT '{}'::jsonb");
    expect(sql).toContain("valid_for_season_key TEXT NOT NULL");
  });

  it("enables RLS without public policies", () => {
    expect(sql).toContain(
      "ALTER TABLE v2_victory_season_summary_snapshot ENABLE ROW LEVEL SECURITY"
    );
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it("has constraints and indexes", () => {
    expect(sql).toContain("uq_v2_victory_season_summary_snapshot_clerk_season");
    expect(sql).toContain("(clerk_user_id, season_id)");
    expect(sql).toContain("confidence IN ('none', 'low', 'medium', 'high')");
    expect(sql).toContain("'pat_principles_changed'");
    expect(sql).toContain("proof_moment_count >= 0");
  });
});
