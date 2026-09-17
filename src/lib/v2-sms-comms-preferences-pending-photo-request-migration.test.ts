import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FILE =
  "20260917140000_v2_user_sms_comms_preferences_pending_photo_request.sql";
const MIGRATION = join(process.cwd(), "supabase/migrations", FILE);
const BASE = join(
  process.cwd(),
  "supabase/migrations/20260606120000_v2_user_sms_comms_preferences.sql"
);
const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

describe("v2_user_sms_comms_preferences pending photo-request columns (static)", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const base = readFileSync(BASE, "utf8");

  it("orders after the prefs table creation", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files.indexOf(FILE)).toBeGreaterThan(
      files.indexOf("20260606120000_v2_user_sms_comms_preferences.sql")
    );
  });

  it("adds the three live nullable columns with IF NOT EXISTS and no FK/index", () => {
    expect(base).toContain("CREATE TABLE v2_user_sms_comms_preferences");
    expect(sql).toContain("ALTER TABLE public.v2_user_sms_comms_preferences");
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS pending_photo_request_win_id UUID NULL"
    );
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS pending_photo_request_expires_at TIMESTAMPTZ NULL"
    );
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS last_photo_request_sent_at TIMESTAMPTZ NULL"
    );
    expect(sql).not.toMatch(/\bREFERENCES\b/i);
    expect(sql).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
    expect(sql).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(sql).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toContain("DROP ");
  });
});
