import { describe, expect, it } from "vitest";

/**
 * Manual deploy check — run in Supabase SQL editor before Victory Room QA.
 * Cursor does not apply migrations; Tyler must confirm tables exist in target project.
 */
export const VICTORY_SNAPSHOT_DEPLOY_VERIFICATION_SQL = `-- Victory Room snapshot tables (required for persisted Pat read / principles / season summaries)
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'v2_victory_pat_read_snapshot',
    'v2_victory_pat_principles_snapshot',
    'v2_victory_season_summary_snapshot'
  )
ORDER BY table_name;

-- RLS enabled, no broad member policies (service-role writes only)
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'v2_victory_pat_read_snapshot',
    'v2_victory_pat_principles_snapshot',
    'v2_victory_season_summary_snapshot'
  )
ORDER BY tablename;`;

describe("Victory snapshot deploy verification (manual)", () => {
  it("documents the three required snapshot tables", () => {
    expect(VICTORY_SNAPSHOT_DEPLOY_VERIFICATION_SQL).toContain("v2_victory_pat_read_snapshot");
    expect(VICTORY_SNAPSHOT_DEPLOY_VERIFICATION_SQL).toContain("v2_victory_pat_principles_snapshot");
    expect(VICTORY_SNAPSHOT_DEPLOY_VERIFICATION_SQL).toContain("v2_victory_season_summary_snapshot");
  });

  it("documents RLS check for snapshot tables", () => {
    expect(VICTORY_SNAPSHOT_DEPLOY_VERIFICATION_SQL).toContain("rowsecurity");
  });
});
