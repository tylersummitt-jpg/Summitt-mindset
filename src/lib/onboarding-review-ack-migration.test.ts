import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260602120000_sob_review_acknowledgement.sql"
);

describe("sob review acknowledgement migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("adds review_acknowledged_at to v2_commitment_intake", () => {
    expect(sql).toContain("ALTER TABLE v2_commitment_intake");
    expect(sql).toContain("review_acknowledged_at TIMESTAMPTZ NULL");
  });
});
