import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const SQL_PATH = "supabase/manual/sms_weekly_notebook_health_check.sql";

describe("sms_weekly_notebook_health_check.sql", () => {
  it("is read-only and includes exhaustive weekly notebook health diagnostics", async () => {
    const sql = await readFile(SQL_PATH, "utf8");
    const upper = sql.toUpperCase();

    expect(upper).not.toMatch(/\bINSERT\s+INTO\b/);
    expect(upper).not.toMatch(/^\s*UPDATE\s+\w/m);
    expect(upper).not.toMatch(/\bDELETE\s+FROM\b/);

    expect(sql).toContain("weekly_thread_notebook_failure_reason");
    expect(sql).toContain("weekly_thread_filtered_out_count");
    expect(sql).toContain("weekly_thread_filtered_out_reason_top");
    expect(sql).toContain("weekly_thread_source_tables_present");
    expect(sql).toContain("weekly_thread_correct_notebook_verified");
    expect(sql).toContain("weekly_notebook_health");
    expect(sql).toContain("correct_notebook_verified");
    expect(sql).toContain("message_count_without_source_candidates");
    expect(sql).toContain("legacy_transcript_fallback_used");
    expect(sql).toContain("last_outbound_or_packet_fallback_used");
    expect(sql).toContain("unclassified_notebook_failure");
    expect(sql).toContain("P1 telemetry bug");
    expect(sql).toContain("weekly_thread_schema_fallback_used");
    expect(sql).not.toMatch(/ELSE\s+'needs_review'/);
  });
});
