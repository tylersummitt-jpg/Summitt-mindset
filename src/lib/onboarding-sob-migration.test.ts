import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260601120000_sob_onboarding_persistence.sql"
);

describe("sob onboarding migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("enables RLS on new tables without policies", () => {
    expect(sql).toContain("ALTER TABLE user_identity_version ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE important_people ENABLE ROW LEVEL SECURITY");
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it("uses partial unique for one active season per user", () => {
    expect(sql).toContain("uq_user_accountability_season_one_active_per_user");
    expect(sql).toContain("WHERE status = 'active'");
    expect(sql).not.toMatch(/UNIQUE\s*\(\s*clerk_user_id\s*\)(?!\s*WHERE)/i);
  });

  it("defines sob_complete_onboarding_activation RPC", () => {
    expect(sql).toContain("sob_complete_onboarding_activation");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION sob_complete_onboarding_activation");
  });

  it("uses master-plan coherence and sms enums", () => {
    expect(sql).toContain("'high'");
    expect(sql).toContain("'medium'");
    expect(sql).toContain("'low'");
    expect(sql).toContain("'unknown'");
    expect(sql).toContain("'strong'");
    expect(sql).toContain("'acceptable'");
    expect(sql).toContain("'weak'");
  });

  it("does not add life_desires columns", () => {
    expect(sql).not.toMatch(/ALTER TABLE.*life_desires/i);
    expect(sql).not.toMatch(/CREATE TABLE.*life_desires/i);
  });
});

describe("sob review acknowledgement migration file", () => {
  const reviewSql = readFileSync(
    join(process.cwd(), "supabase/migrations/20260602120000_sob_review_acknowledgement.sql"),
    "utf8"
  );

  it("exists and adds review_acknowledged_at", () => {
    expect(reviewSql).toContain("review_acknowledged_at");
  });
});
