import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const SQL_PATH = "supabase/manual/stage_1b_truth_spine_cousin_audit.sql";

const REQUIRED_QUERY_NAMES = [
  "truth_spine_health_rollup",
  "reported_completion_no_write_post_fix_monitor",
  "daily_outcome_spine_health_by_user",
  "explicit_miss_candidates_without_user_no",
  "explicit_partial_candidates_without_user_partial",
  "sent_inbound_reply_without_truth_spine_row",
  "victory_room_displayability_from_truth_spine",
  "plan_answer_to_prior_question_telemetry",
  "blocker_captured_health",
  "contract_raise_lower_change_health",
];

describe("stage_1b_truth_spine_cousin_audit.sql", () => {
  it("is read-only, schema-safe, and includes all required Stage 1b queries", async () => {
    const sql = await readFile(SQL_PATH, "utf8");
    const upper = sql.toUpperCase();

    expect(upper).not.toMatch(/\bINSERT\b/);
    expect(upper).not.toMatch(/\bUPDATE\b/);
    expect(upper).not.toMatch(/\bDELETE\b/);
    expect(upper).not.toMatch(/\bALTER\b/);
    expect(upper).not.toMatch(/\bDROP\b/);
    expect(upper).not.toMatch(/\bCREATE\b/);

    expect(sql.match(/WITH bounds AS/g)?.length).toBe(10);

    expect(sql).not.toMatch(/Brooke/i);
    expect(sql).not.toMatch(/Tyler/i);
    expect(sql).not.toMatch(/clerk_user_id\s*=\s*'/);

    for (const name of REQUIRED_QUERY_NAMES) {
      expect(sql).toContain(name);
    }

    expect(sql).toContain("to_jsonb(s)");
    expect(sql).toContain("to_jsonb(m)");
    expect(sql).toContain("to_jsonb(c)");
    expect(sql).toContain("to_jsonb(j)");

    expect(sql).not.toMatch(/\bs\.body\b/);
    expect(sql).not.toMatch(/\bs\.sms_body\b/);
    expect(sql).not.toMatch(/\bs\.message_body\b/);
    expect(sql).not.toMatch(/\be\.body\b/);
    expect(sql).not.toMatch(/\be\.sms_body\b/);
    expect(sql).not.toMatch(/\be\.message_body\b/);
    expect(sql).not.toMatch(/\bm\.created_at\b/);
    expect(sql).not.toMatch(/\bc\.effective_ask\b/);

    expect(sql).toContain("approximate_effective_ask_sql");
    expect(sql).toContain("next_daily_body_preview");
    expect(sql).toContain("inbound_turn_telemetry");
  });
});
