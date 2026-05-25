import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260604120000_victory_pat_principles_snapshot.sql"
);

describe("victory pat principles snapshot migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("creates v2_victory_pat_principles_snapshot with expected fields", () => {
    expect(sql).toContain("CREATE TABLE v2_victory_pat_principles_snapshot");
    expect(sql).toContain("REFERENCES v2_commitment (id)");
    expect(sql).toContain("REFERENCES user_accountability_season (id)");
    expect(sql).toContain("valid_for_week_key TEXT NOT NULL");
    expect(sql).toContain("living_well_evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb");
    expect(sql).toContain("focus_next_evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb");
    expect(sql).toContain("input_bundle_json JSONB NOT NULL DEFAULT '{}'::jsonb");
  });

  it("enables RLS without public/client policies", () => {
    expect(sql).toContain(
      "ALTER TABLE v2_victory_pat_principles_snapshot ENABLE ROW LEVEL SECURITY"
    );
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it("has unique clerk_user_id + commitment_id and CHECK constraints", () => {
    expect(sql).toContain("uq_v2_victory_pat_principles_snapshot_clerk_commitment");
    expect(sql).toContain("(clerk_user_id, commitment_id)");
    expect(sql).toContain("confidence IN ('starter', 'low', 'medium', 'high')");
    expect(sql).toContain("provenance IN ('deterministic', 'ai', 'fallback')");
    expect(sql).toContain("'pat_read_changed'");
    expect(sql).toContain("living_well_principle_id IS NULL");
    expect(sql).toContain("jsonb_typeof(living_well_evidence_ids) = 'array'");
  });
});
