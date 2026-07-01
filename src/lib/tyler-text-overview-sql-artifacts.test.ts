import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMMAND_CENTER_PATH = join(
  process.cwd(),
  "supabase/manual/tyler_text_overview_command_center.sql"
);
const VERIFICATION_PATH = join(
  process.cwd(),
  "supabase/manual/tyler_text_overview_post_migration_verification.sql"
);
const CHECKLIST_PATH = join(
  process.cwd(),
  "src/sms-review-place/TYLER_TEXT_OVERVIEW_DEPLOYMENT_CHECKLIST.md"
);
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260701120000_tyler_text_overview.sql"
);

function readSqlWithoutComments(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("Tyler Text Overview Phase 7 SQL artifacts", () => {
  const commandCenter = readFileSync(COMMAND_CENTER_PATH, "utf8");
  const verification = readFileSync(VERIFICATION_PATH, "utf8");
  const checklist = readFileSync(CHECKLIST_PATH, "utf8");
  const commandCenterSql = readSqlWithoutComments(COMMAND_CENTER_PATH);
  const verificationSql = readSqlWithoutComments(VERIFICATION_PATH);

  it("command center SQL exists", () => {
    expect(commandCenter.length).toBeGreaterThan(0);
    expect(commandCenter).toContain("TTO_01");
    expect(commandCenter).toContain("TTO_11");
  });

  it("verification SQL exists", () => {
    expect(verification.length).toBeGreaterThan(0);
    expect(verification).toContain("TTO_VERIFY_10_summary");
  });

  it("deployment checklist exists", () => {
    expect(checklist.length).toBeGreaterThan(0);
    expect(checklist).toContain("Tyler Text Overview — Deployment Checklist");
  });

  it("command center SQL does not reference phone_number", () => {
    expect(commandCenterSql.toLowerCase()).not.toContain("phone_number");
  });

  it("command center SQL does not use sms_send_events.sent_at top-level", () => {
    expect(commandCenterSql).not.toMatch(/\bs\.sent_at\b/);
    expect(commandCenterSql).not.toMatch(/\bsms_send_events\.sent_at\b/);
  });

  it("command center SQL does not use sms_send_events.updated_at", () => {
    expect(commandCenterSql).not.toMatch(/\bs\.updated_at\b/);
    expect(commandCenter).not.toMatch(/sms_send_events[^\n]*updated_at/);
  });

  it("command center SQL does not use sms_inbound_messages.created_at", () => {
    expect(commandCenterSql).not.toMatch(/\bm\.created_at\b/);
  });

  it("command center SQL does not use sms_inbound_messages.inserted_at", () => {
    expect(commandCenterSql).not.toContain("inserted_at");
  });

  it("command center SQL references metadata->'tyler_text_overview'", () => {
    expect(commandCenter).toContain("metadata->'tyler_text_overview'");
  });

  it("command center SQL references writer_openai_messages", () => {
    expect(commandCenter).toContain("writer_openai_messages");
  });

  it("verification SQL references both TTO tables", () => {
    expect(verification).toContain("sms_daily_draft_generations");
    expect(verification).toContain("sms_daily_drafts");
  });

  it("checklist says to manually apply the Phase 1 migration before env true", () => {
    expect(checklist).toContain("supabase/migrations/20260701120000_tyler_text_overview.sql");
    expect(checklist).toContain("tyler_text_overview_post_migration_verification.sql");
    expect(checklist).toMatch(/Do not set `TYLER_TEXT_OVERVIEW_ENABLED=true`/);
  });

  it("checklist says TYLER_TEXT_OVERVIEW_ENABLED=false during initial deploy", () => {
    expect(checklist).toContain("TYLER_TEXT_OVERVIEW_ENABLED=false");
  });

  it("checklist has rollback env false", () => {
    expect(checklist).toMatch(/rollback/i);
    expect(checklist).toMatch(/TYLER_TEXT_OVERVIEW_ENABLED=false/);
  });

  it("checklist has no vercel schedule recommendation for first smoke", () => {
    expect(checklist).toMatch(/Do NOT add `vercel\.json` schedules for first smoke/i);
    expect(checklist).toMatch(/Manual curl invoke first/i);
  });

  it("only one TTO env var name appears in checklist/artifacts", () => {
    const envVarPattern = /TYLER_TEXT_OVERVIEW_[A-Z_]+/g;
    const names = new Set([
      ...(checklist.match(envVarPattern) ?? []),
      ...(commandCenter.match(envVarPattern) ?? []),
      ...(verification.match(envVarPattern) ?? []),
    ]);
    expect(names).toEqual(new Set(["TYLER_TEXT_OVERVIEW_ENABLED"]));
  });

  it("command center and verification SQL are SELECT-only (no DDL/DML)", () => {
    for (const sql of [commandCenterSql, verificationSql]) {
      const upper = sql.toUpperCase();
      expect(upper).not.toMatch(/\bINSERT INTO\b/);
      expect(upper).not.toMatch(/\bUPDATE\s+[A-Z_]/);
      expect(upper).not.toMatch(/\bDELETE FROM\b/);
      expect(upper).not.toMatch(/\bDROP TABLE\b/);
      expect(upper).not.toMatch(/\bALTER TABLE\b/);
      expect(upper).not.toMatch(/\bCREATE TABLE\b/);
      expect(upper).not.toMatch(/\bTRUNCATE\b/);
    }
  });

  it("migration file remains source of truth referenced by checklist", () => {
    expect(readFileSync(MIGRATION_PATH, "utf8")).toContain("sms_daily_draft_generations");
    expect(checklist.toLowerCase()).toContain("source of truth");
  });
});
