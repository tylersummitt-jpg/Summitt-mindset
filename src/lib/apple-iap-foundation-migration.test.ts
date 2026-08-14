import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_FILENAME = "20260813120000_apple_iap_foundation.sql";
const MIGRATION_PATH = join(process.cwd(), "supabase/migrations", MIGRATION_FILENAME);
const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

const TABLES = [
  "apple_account_bindings",
  "apple_subscriptions",
  "apple_notification_events",
] as const;

const DESTRUCTIVE = [
  /\bDROP TABLE\b/i,
  /\bDROP INDEX\b/i,
  /\bTRUNCATE\b/i,
  /\bALTER TABLE\s+(?!public\.apple_)/i,
];

describe("apple IAP foundation migration (Phase 1)", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf8");

  it("is the latest additive migration filename after existing Victory Media work", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files).toContain(MIGRATION_FILENAME);
    expect(files.indexOf(MIGRATION_FILENAME)).toBeGreaterThan(
      files.indexOf("20260812120000_v2_replace_win_media.sql")
    );
  });

  it("creates all three Apple IAP tables", () => {
    expect(sql).toContain("CREATE TABLE public.apple_account_bindings");
    expect(sql).toContain("CREATE TABLE public.apple_subscriptions");
    expect(sql).toContain("CREATE TABLE public.apple_notification_events");
  });

  it("stores app_account_token as a globally unique UUID", () => {
    const bindings = sql.slice(
      sql.indexOf("CREATE TABLE public.apple_account_bindings"),
      sql.indexOf("CREATE TABLE public.apple_subscriptions")
    );
    expect(bindings).toMatch(/app_account_token UUID NOT NULL/);
    expect(bindings).toContain(
      "CONSTRAINT apple_account_bindings_app_account_token_uq UNIQUE (app_account_token)"
    );
  });

  it("enforces at most one live Clerk binding via partial unique index", () => {
    expect(sql).toContain("CREATE UNIQUE INDEX apple_account_bindings_live_clerk_user_id_uq");
    expect(sql).toMatch(
      /ON public\.apple_account_bindings \(clerk_user_id\)\s+WHERE unbound_at IS NULL AND clerk_user_id IS NOT NULL/
    );
  });

  it("allows deletion tombstones (nullable clerk_user_id + unbound_at)", () => {
    const bindings = sql.slice(
      sql.indexOf("CREATE TABLE public.apple_account_bindings"),
      sql.indexOf("CREATE TABLE public.apple_subscriptions")
    );
    expect(bindings).toMatch(/clerk_user_id TEXT NULL/);
    expect(bindings).toMatch(/unbound_at TIMESTAMPTZ NULL/);
    expect(bindings).toContain("apple_account_bindings_live_or_tombstone_chk");
  });

  it("makes original_transaction_id the unique Apple subscription identity", () => {
    const subs = sql.slice(
      sql.indexOf("CREATE TABLE public.apple_subscriptions"),
      sql.indexOf("CREATE TABLE public.apple_notification_events")
    );
    expect(subs).toMatch(/original_transaction_id TEXT NOT NULL/);
    expect(subs).toContain(
      "CONSTRAINT apple_subscriptions_original_transaction_id_uq UNIQUE (original_transaction_id)"
    );
    expect(subs).toMatch(/clerk_user_id TEXT NULL/);
  });

  it("constrains environment to sandbox or production", () => {
    expect(sql).toContain("CONSTRAINT apple_subscriptions_environment_chk");
    expect(sql).toContain("environment IN ('sandbox', 'production')");
  });

  it("stores a normalized status projection without a misleading canceled value", () => {
    const statuses = [
      "active",
      "grace_period",
      "billing_retry",
      "expired",
      "revoked",
      "refunded",
    ];
    for (const status of statuses) {
      expect(sql).toContain(`'${status}'`);
    }
    const statusBlock = sql.slice(
      sql.indexOf("CONSTRAINT apple_subscriptions_status_chk"),
      sql.indexOf("CONSTRAINT apple_subscriptions_product_id_nonempty_chk")
    );
    expect(statusBlock).not.toContain("'canceled'");
  });

  it("indexes clerk_user_id for entitlement lookup and does not add an expires_at index", () => {
    expect(sql).toContain(
      "CREATE INDEX apple_subscriptions_clerk_user_id_idx"
    );
    expect(sql).not.toMatch(/CREATE INDEX[\s\S]*expires_at/i);
  });

  it("uses notification_uuid as the ASSN V2 primary key with nullable processed_at", () => {
    const events = sql.slice(
      sql.indexOf("CREATE TABLE public.apple_notification_events")
    );
    expect(events).toMatch(/notification_uuid UUID PRIMARY KEY/);
    expect(events).toMatch(/original_transaction_id TEXT NULL/);
    expect(events).toMatch(/subtype TEXT NULL/);
    expect(events).toMatch(/processed_at TIMESTAMPTZ NULL/);
    expect(events).toMatch(/created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
  });

  it("enables RLS and restricts grants to service_role with no client policies", () => {
    for (const table of TABLES) {
      expect(sql).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`
      );
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon`);
      expect(sql).toContain(
        `REVOKE ALL ON TABLE public.${table} FROM authenticated`
      );
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC`);
      expect(sql).toContain(
        `REVOKE ALL ON TABLE public.${table} FROM service_role`
      );
      expect(sql).toContain(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${table} TO service_role`
      );
    }
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(
      /GRANT[\s\S]{0,40}ON TABLE public\.apple_[\s\S]{0,40}TO authenticated/i
    );
    expect(sql).not.toMatch(
      /GRANT[\s\S]{0,40}ON TABLE public\.apple_[\s\S]{0,40}TO anon/i
    );
  });

  it("does not modify unrelated tables or perform destructive operations", () => {
    const executable = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(executable).not.toMatch(/account_deletion_requests/);
    expect(executable).not.toMatch(/stripe_webhook_events/);
    expect(executable).not.toMatch(/sms_audience/);
    expect(executable).not.toMatch(/v2_win/);
    expect(executable).not.toMatch(/v2_commitment/);
    for (const pattern of DESTRUCTIVE) {
      expect(executable).not.toMatch(pattern);
    }
  });
});
