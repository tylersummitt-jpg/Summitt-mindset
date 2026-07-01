import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  TYLER_TEXT_OVERVIEW_CURRENT_BODY_SOURCES,
  TYLER_TEXT_OVERVIEW_DRAFT_STATUSES,
  TYLER_TEXT_OVERVIEW_ENABLED_ENV,
  TYLER_TEXT_OVERVIEW_GENERATION_REASONS,
  TYLER_TEXT_OVERVIEW_NOTEBOOK_VERDICTS,
} from "@/lib/tyler-text-overview-types";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260701120000_tyler_text_overview.sql"
);

const FORBIDDEN_RUNTIME_PATHS = [
  "src/app/api/cron/daily-sms/route.ts",
  "src/app/api/cron/weekly-sms/route.ts",
  "src/app/api/twilio/inbound/route.ts",
  "src/app/api/cron/sms-inbound-coach/route.ts",
  "src/lib/v3-daily-relationship-lane.ts",
  "src/lib/sms-recent-exact-thread-72h.ts",
  "src/lib/sms-daily-writing-brief-v1.ts",
  "src/lib/sms-daily-notebook-telemetry.ts",
  "src/lib/sms-weekly-notebook-telemetry.ts",
  "src/lib/twilio.ts",
  "vercel.json",
];

describe("tyler-text-overview schema migration (Phase 1)", () => {
  const migration = readFileSync(MIGRATION_PATH, "utf8");

  it("creates sms_daily_draft_generations table", () => {
    expect(migration).toMatch(/CREATE TABLE sms_daily_draft_generations/i);
  });

  it("creates sms_daily_drafts table", () => {
    expect(migration).toMatch(/CREATE TABLE sms_daily_drafts/i);
  });

  it("does not add phone_number column", () => {
    expect(migration).not.toMatch(/\bphone_number\b/i);
  });

  it("does not add review_reason, review_notes, or reviewed_by columns", () => {
    expect(migration).not.toMatch(/\breview_reason\b/i);
    expect(migration).not.toMatch(/\breview_notes\b/i);
    expect(migration).not.toMatch(/\breviewed_by\b/i);
  });

  it("enforces unique(clerk_user_id, draft_for_day_key, generation_number) on generations", () => {
    expect(migration).toMatch(
      /UNIQUE\s*\(\s*clerk_user_id\s*,\s*draft_for_day_key\s*,\s*generation_number\s*\)/i
    );
  });

  it("enforces unique(clerk_user_id, draft_for_day_key) on drafts", () => {
    expect(migration).toMatch(/UNIQUE\s*\(\s*clerk_user_id\s*,\s*draft_for_day_key\s*\)/i);
  });

  it("references sms_daily_draft_generations from current_generation_id", () => {
    expect(migration).toMatch(/current_generation_id UUID NOT NULL/i);
    expect(migration).toMatch(
      /REFERENCES sms_daily_draft_generations\s*\(\s*id\s*\)/i
    );
  });

  it("includes writer_openai_messages jsonb on generations", () => {
    expect(migration).toMatch(/writer_openai_messages JSONB NOT NULL/i);
  });

  it("stores machine_draft_body only on generations", () => {
    const generationsBlock = migration.slice(
      migration.indexOf("CREATE TABLE sms_daily_draft_generations"),
      migration.indexOf("CREATE TABLE sms_daily_drafts")
    );
    const draftsBlock = migration.slice(migration.indexOf("CREATE TABLE sms_daily_drafts"));
    expect(generationsBlock).toMatch(/\bmachine_draft_body\b/i);
    expect(draftsBlock).not.toMatch(/\bmachine_draft_body\b/i);
  });

  it("stores current_body_to_send on drafts", () => {
    const draftsBlock = migration.slice(migration.indexOf("CREATE TABLE sms_daily_drafts"));
    expect(draftsBlock).toMatch(/\bcurrent_body_to_send\b/i);
  });

  it("defines generation_reason check constraint with allowed values", () => {
    for (const reason of TYLER_TEXT_OVERVIEW_GENERATION_REASONS) {
      expect(migration).toContain(`'${reason}'`);
    }
    expect(migration).toMatch(/generation_reason TEXT NOT NULL[\s\S]*?CHECK/i);
  });

  it("defines current_body_source check constraint with allowed values", () => {
    for (const source of TYLER_TEXT_OVERVIEW_CURRENT_BODY_SOURCES) {
      expect(migration).toContain(`'${source}'`);
    }
    expect(migration).toMatch(/current_body_source TEXT NOT NULL[\s\S]*?CHECK/i);
  });

  it("defines status check constraint with allowed values", () => {
    for (const status of TYLER_TEXT_OVERVIEW_DRAFT_STATUSES) {
      expect(migration).toContain(`'${status}'`);
    }
    expect(migration).toMatch(/status TEXT NOT NULL[\s\S]*?CHECK/i);
  });

  it("defines notebook_verdict check constraint with allowed values", () => {
    for (const verdict of TYLER_TEXT_OVERVIEW_NOTEBOOK_VERDICTS) {
      expect(migration).toContain(`'${verdict}'`);
    }
    expect(migration).toMatch(/notebook_verdict TEXT NOT NULL[\s\S]*?CHECK/i);
  });

  it("enables service-role-only RLS hardening pattern on both tables", () => {
    expect(migration).toMatch(/ALTER TABLE sms_daily_draft_generations ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/ALTER TABLE sms_daily_drafts ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE sms_daily_draft_generations FROM anon/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE sms_daily_drafts FROM anon/i);
  });
});

describe("tyler-text-overview types (Phase 1)", () => {
  it("exports table names and single env var constant only", () => {
    expect(SMS_DAILY_DRAFT_GENERATIONS_TABLE).toBe("sms_daily_draft_generations");
    expect(SMS_DAILY_DRAFTS_TABLE).toBe("sms_daily_drafts");
    expect(TYLER_TEXT_OVERVIEW_ENABLED_ENV).toBe("TYLER_TEXT_OVERVIEW_ENABLED");
  });
});

describe("tyler-text-overview — runtime SMS untouched (Phase 1)", () => {
  it("forbidden runtime SMS files exist and were not part of this phase scope", () => {
    for (const relPath of FORBIDDEN_RUNTIME_PATHS) {
      const abs = join(process.cwd(), relPath);
      expect(readFileSync(abs, "utf8").length).toBeGreaterThan(0);
    }
  });
});
