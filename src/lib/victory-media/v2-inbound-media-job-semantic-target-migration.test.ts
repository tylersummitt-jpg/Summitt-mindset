import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260821120000_v2_inbound_media_job_semantic_target_win_id.sql"
);
const BASE = join(
  process.cwd(),
  "supabase/migrations/20260810140000_v2_win_media.sql"
);
const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

describe("v2_inbound_media_job semantic_target_win_id migration (static)", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const base = readFileSync(BASE, "utf8");

  it("orders after v2_win_media table creation", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(
      files.indexOf("20260821120000_v2_inbound_media_job_semantic_target_win_id.sql")
    ).toBeGreaterThan(files.indexOf("20260810140000_v2_win_media.sql"));
  });

  it("adds nullable uuid FK to v2_win with ON DELETE SET NULL and no default", () => {
    expect(sql).toContain("ALTER TABLE public.v2_inbound_media_job");
    expect(sql).toContain("ADD COLUMN semantic_target_win_id UUID NULL");
    expect(sql).toContain("REFERENCES public.v2_win (id)");
    expect(sql).toContain("ON DELETE SET NULL");
    expect(sql).not.toMatch(/semantic_target_win_id[\s\S]{0,80}DEFAULT/i);
    expect(sql).not.toMatch(/NOT NULL/);
  });

  it("does not add status or resolution CHECK values", () => {
    expect(sql).not.toContain("v2_inbound_media_job_status_chk");
    expect(sql).not.toContain("v2_inbound_media_job_resolution_chk");
    expect(sql).not.toContain("CREATE TABLE");
    expect(sql).not.toContain("DROP ");
    expect(sql).not.toMatch(/\bINDEX\b/i);
    expect(sql).not.toMatch(/\bRPC\b/i);
    expect(sql).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/i);
  });

  it("does not reuse attached_win_id and keeps base CHECKs unchanged", () => {
    expect(base).toContain("attached_win_id UUID NULL REFERENCES public.v2_win (id) ON DELETE SET NULL");
    expect(base).toContain("'pending_semantics'");
    expect(base).toContain("'pending_user'");
    expect(sql).not.toContain("DROP CONSTRAINT");
    expect(sql).toContain("Distinct from attached_win_id");
  });
});
