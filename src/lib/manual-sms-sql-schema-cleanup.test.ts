import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEEKLY_HEALTH_PATH = join(
  process.cwd(),
  "supabase/manual/sms_weekly_notebook_health_check.sql"
);
const SOAK_DEBUG_PATH = join(process.cwd(), "supabase/manual/sms_soak_debug_pack.sql");

const SCHEMA_RULES_SNIPPET = "SUMMITT SMS SPINE SCHEMA RULES:";

describe("manual SMS SQL schema cleanup (P4B Step 4B Part 1)", () => {
  const weeklyHealth = readFileSync(WEEKLY_HEALTH_PATH, "utf8");
  const soakDebug = readFileSync(SOAK_DEBUG_PATH, "utf8");

  it("sms_weekly_notebook_health_check.sql does not contain to_jsonb(w)->>'body'", () => {
    expect(weeklyHealth).not.toContain("to_jsonb(w)->>'body'");
  });

  it("sms_weekly_notebook_health_check.sql does not contain to_jsonb(w)->>'sms_body'", () => {
    expect(weeklyHealth).not.toContain("to_jsonb(w)->>'sms_body'");
  });

  it("sms_weekly_notebook_health_check.sql contains metadata->>'sms_body'", () => {
    expect(weeklyHealth).toContain("w.metadata->>'sms_body'");
  });

  it("sms_weekly_notebook_health_check.sql contains metadata->>'sent_at'", () => {
    expect(weeklyHealth).toContain("w.metadata->>'sent_at'");
    expect(weeklyHealth).toContain("effective_send_at");
  });

  it("sms_soak_debug_pack.sql does not contain m.created_at", () => {
    expect(soakDebug).not.toMatch(/\bm\.created_at\b/);
  });

  it("sms_soak_debug_pack.sql does not contain COALESCE(m.created_at", () => {
    expect(soakDebug).not.toContain("COALESCE(m.created_at");
  });

  it("sms_soak_debug_pack.sql contains m.received_at", () => {
    expect(soakDebug).toMatch(/\bm\.received_at\b/);
  });

  it("neither file uses inserted_at as a SQL column reference", () => {
    for (const src of [weeklyHealth, soakDebug]) {
      const sqlOnly = src
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
      expect(sqlOnly).not.toContain("inserted_at");
    }
  });

  it("both files contain the schema rules comment", () => {
    expect(weeklyHealth).toContain(SCHEMA_RULES_SNIPPET);
    expect(soakDebug).toContain(SCHEMA_RULES_SNIPPET);
  });
});
