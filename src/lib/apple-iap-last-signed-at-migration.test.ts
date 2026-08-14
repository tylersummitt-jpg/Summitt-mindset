import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_FILENAME = "20260814120000_apple_subscriptions_last_signed_at.sql";
const FOUNDATION_FILENAME = "20260813120000_apple_iap_foundation.sql";
const MIGRATION_PATH = join(process.cwd(), "supabase/migrations", MIGRATION_FILENAME);
const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

const DESTRUCTIVE = [
  /\bDROP TABLE\b/i,
  /\bDROP INDEX\b/i,
  /\bDROP COLUMN\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE FROM\b/i,
  /\bUPDATE\b/i,
  /\bCREATE INDEX\b/i,
  /\bCREATE UNIQUE INDEX\b/i,
  /\bENABLE ROW LEVEL SECURITY\b/i,
  /\bCREATE POLICY\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
];

describe("apple subscriptions last_signed_at migration (Phase 7A)", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");
  const executable = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  it("is additive after the Phase 1 Apple IAP foundation migration", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files).toContain(MIGRATION_FILENAME);
    expect(files.indexOf(MIGRATION_FILENAME)).toBeGreaterThan(
      files.indexOf(FOUNDATION_FILENAME)
    );
  });

  it("only adds nullable last_signed_at on apple_subscriptions", () => {
    expect(executable).toMatch(
      /ALTER TABLE public\.apple_subscriptions\s+ADD COLUMN IF NOT EXISTS last_signed_at TIMESTAMPTZ NULL/
    );
    expect(executable).not.toMatch(/NOT NULL/);
    expect(executable).not.toMatch(/DEFAULT/);
  });

  it("does not backfill, index, or mutate existing columns", () => {
    expect(executable).not.toMatch(/\bSET\b/);
    expect(executable).not.toMatch(/USING\b/);
    expect(executable).not.toMatch(/ALTER COLUMN/);
  });

  it("does not change RLS, grants, Stripe, or other Apple tables", () => {
    expect(executable).not.toMatch(/apple_account_bindings/);
    expect(executable).not.toMatch(/apple_notification_events/);
    expect(executable).not.toMatch(/stripe_/);
    expect(executable).not.toMatch(/account_deletion/);
    for (const pattern of DESTRUCTIVE) {
      expect(executable).not.toMatch(pattern);
    }
  });
});
