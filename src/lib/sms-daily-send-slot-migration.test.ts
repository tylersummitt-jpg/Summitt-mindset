import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SMS_DAILY_PRODUCTION_SEND_SLOT,
  SMS_DAILY_SEND_SLOTS,
} from "@/lib/tyler-text-overview-types";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260706120000_sms_daily_send_slot_phase1.sql"
);

describe("sms_daily_send_slot phase 1 migration", () => {
  const migration = readFileSync(MIGRATION_PATH, "utf8");

  it("adds send_slot to sms_daily_draft_generations, sms_daily_drafts, sms_send_events", () => {
    expect(migration).toMatch(
      /ALTER TABLE sms_daily_draft_generations[\s\S]*ADD COLUMN send_slot/i
    );
    expect(migration).toMatch(/ALTER TABLE sms_daily_drafts[\s\S]*ADD COLUMN send_slot/i);
    expect(migration).toMatch(/ALTER TABLE sms_send_events[\s\S]*ADD COLUMN send_slot/i);
  });

  it("defaults send_slot to morning", () => {
    expect(migration).toMatch(/DEFAULT 'morning'/gi);
  });

  it("adds CHECK constraints for morning and evening_checkin", () => {
    for (const slot of SMS_DAILY_SEND_SLOTS) {
      expect(migration).toContain(`'${slot}'`);
    }
  });

  it("replaces generations unique with user/day/slot/gen", () => {
    expect(migration).toMatch(/DROP CONSTRAINT IF EXISTS sms_daily_draft_generations_user_day_gen_unique/i);
    expect(migration).toMatch(
      /sms_daily_draft_generations_user_day_slot_gen_unique[\s\S]*UNIQUE\s*\(\s*clerk_user_id\s*,\s*draft_for_day_key\s*,\s*send_slot\s*,\s*generation_number\s*\)/i
    );
  });

  it("replaces drafts unique with user/day/slot", () => {
    expect(migration).toMatch(/DROP CONSTRAINT IF EXISTS sms_daily_drafts_user_day_unique/i);
    expect(migration).toMatch(
      /sms_daily_drafts_user_day_slot_unique[\s\S]*UNIQUE\s*\(\s*clerk_user_id\s*,\s*draft_for_day_key\s*,\s*send_slot\s*\)/i
    );
  });

  it("drops production sms_send_events_unique_user_day index", () => {
    expect(migration).toMatch(/DROP INDEX IF EXISTS sms_send_events_unique_user_day/i);
  });

  it("adds sms_send_events_user_day_slot_unique index", () => {
    expect(migration).toMatch(
      /sms_send_events_user_day_slot_unique[\s\S]*\(clerk_user_id,\s*day_key,\s*send_slot\)/i
    );
  });

  it("documents send_slot as purpose/moment not wall-clock time", () => {
    expect(migration).toMatch(/moment\/purpose/i);
    expect(migration).toMatch(/Not wall-clock/i);
  });
});

describe("sms_daily_send_slot phase 1 constants", () => {
  it("production slot is morning", () => {
    expect(SMS_DAILY_PRODUCTION_SEND_SLOT).toBe("morning");
  });

  it("evening_checkin is reserved but not production slot", () => {
    expect(SMS_DAILY_SEND_SLOTS).toContain("evening_checkin");
    expect(SMS_DAILY_PRODUCTION_SEND_SLOT).not.toBe("evening_checkin");
  });

  it("legacy smsTimePreference evening still maps to hour 19", () => {
    const scheduling = readFileSync(
      join(process.cwd(), "src/lib/daily-sms-scheduling.ts"),
      "utf8"
    );
    expect(scheduling).toMatch(/evening:\s*19/);
  });
});

describe("sms_daily_send_slot — no evening_checkin in production code paths", () => {
  const productionPaths = [
    "src/lib/tyler-text-overview-generate.ts",
    "src/lib/tyler-text-overview-send.ts",
    "src/lib/tyler-text-overview-admin.ts",
    "src/lib/tyler-text-overview-refresh-stale.ts",
  ];

  it("production libs use SMS_DAILY_PRODUCTION_SEND_SLOT constant", () => {
    for (const rel of productionPaths) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src).toContain("SMS_DAILY_PRODUCTION_SEND_SLOT");
    }
    const cronSrc = readFileSync(
      join(process.cwd(), "src/app/api/cron/daily-sms/route.ts"),
      "utf8"
    );
    expect(cronSrc).toContain("SMS_DAILY_PRODUCTION_SEND_SLOT");
    expect(cronSrc).toMatch(/send_slot:\s*SMS_DAILY_PRODUCTION_SEND_SLOT/);
  });

  it("upsert conflict includes send_slot", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-generate.ts"),
      "utf8"
    );
    expect(src).toContain('onConflict: "clerk_user_id,draft_for_day_key,send_slot"');
  });

  it("evening live send module uses evening_checkin send slot", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-evening-send.ts"),
      "utf8"
    );
    expect(src).toContain("SMS_DAILY_EVENING_PREVIEW_SEND_SLOT");
    expect(src).toMatch(/send_slot:\s*SMS_DAILY_EVENING_PREVIEW_SEND_SLOT/);
  });
});
