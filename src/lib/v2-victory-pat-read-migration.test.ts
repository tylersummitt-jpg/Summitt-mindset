import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260603120000_victory_pat_read_snapshot.sql"
);

describe("victory pat read snapshot migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("creates v2_victory_pat_read_snapshot with expected constraints", () => {
    expect(sql).toContain("CREATE TABLE v2_victory_pat_read_snapshot");
    expect(sql).toContain("REFERENCES v2_commitment (id)");
    expect(sql).toContain("REFERENCES user_accountability_season (id)");
    expect(sql).toContain("provenance IN ('deterministic', 'ai', 'fallback')");
    expect(sql).toContain(
      "pattern_confidence IN ('none', 'low', 'medium', 'high')"
    );
    expect(sql).toContain("reason_for_update");
    expect(sql).toContain("'pattern_became_confident'");
    expect(sql).toContain("'major_evidence_change'");
    expect(sql).toContain("linked_proof_moment_ids JSONB NOT NULL DEFAULT '[]'::jsonb");
  });

  it("enables RLS without public/client policies", () => {
    expect(sql).toContain(
      "ALTER TABLE v2_victory_pat_read_snapshot ENABLE ROW LEVEL SECURITY"
    );
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it("has unique protection for clerk_user_id + commitment_id", () => {
    expect(sql).toContain("uq_v2_victory_pat_read_snapshot_clerk_commitment");
    expect(sql).toContain("(clerk_user_id, commitment_id)");
  });
});
