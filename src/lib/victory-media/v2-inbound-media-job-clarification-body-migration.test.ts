import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260822120000_v2_inbound_media_job_clarification_body.sql"
);
const BASE = join(
  process.cwd(),
  "supabase/migrations/20260810140000_v2_win_media.sql"
);
const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

describe("v2_inbound_media_job clarification_body migration (static)", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const base = readFileSync(BASE, "utf8");

  it("orders after v2_win_media table creation", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(
      files.indexOf(
        "20260822120000_v2_inbound_media_job_clarification_body.sql"
      )
    ).toBeGreaterThan(files.indexOf("20260810140000_v2_win_media.sql"));
  });

  it("adds nullable clarification_body without hijacking classifier_target", () => {
    expect(sql).toContain("ALTER TABLE public.v2_inbound_media_job");
    expect(sql).toContain("ADD COLUMN clarification_body TEXT NULL");
    expect(sql).not.toMatch(/clarification_body[\s\S]{0,80}DEFAULT/i);
    expect(sql).not.toMatch(/NOT NULL/);
    expect(sql).not.toMatch(/classifier_target TEXT/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(base).toContain("classifier_target TEXT NULL");
    expect(base).toContain("'acc_win'");
  });

  it("does not change status/resolution CHECKs or drop columns", () => {
    expect(sql).not.toContain("v2_inbound_media_job_status_chk");
    expect(sql).not.toContain("v2_inbound_media_job_resolution_chk");
    expect(sql).not.toContain("DROP ");
    expect(sql).not.toContain("CREATE TABLE");
    expect(sql).not.toMatch(/\bINDEX\b/i);
    expect(base).toContain("'pending_user'");
  });
});
