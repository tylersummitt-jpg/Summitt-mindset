import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const SQL_PATH = "supabase/manual/truth_spine_certification_pack.sql";

const REQUIRED_QUERY_NAMES = [
  "master_thread_truth_reconciliation",
  "outcome_candidate_gap_rollup",
  "user_yes_certification",
  "user_no_certification",
  "user_partial_certification",
  "plan_memory_certification",
  "blocker_certification",
  "goal_change_raise_lower_certification",
  "victory_room_projection_certification",
  "next_sms_truth_usage_certification",
  "no_send_truth_loss_certification",
  "certification_scoreboard",
  "Q13_known_fixture_drilldown",
];

const V11_MARKERS = [
  "known_fix_cutover_at_user_yes",
  "known_fix_cutover_at_meta_process",
  "known_fix_cutover_at_weekly_miss_count",
  "classified_inbound",
  "classified_with_diag",
  "expected_persistence_decision",
  "cert_diagnostic",
  "fix_era",
  "historical_pre_fix_observation",
  "current_code_failure_candidate",
  "expected_write_but_missing",
  "false_outcome_written",
  "outcome_written_ok",
  "expected_no_write_and_none_written",
  "is_known_historical_fixture",
  "Do NOT call pre-fix rows current bugs",
];

describe("truth_spine_certification_pack.sql", () => {
  it("is read-only, bounded, all-users, v1.1 current-code-aware", async () => {
    const sql = await readFile(SQL_PATH, "utf8");
    const upper = sql.toUpperCase();

    expect(upper).not.toMatch(/\bINSERT\b/);
    expect(upper).not.toMatch(/\bUPDATE\b/);
    expect(upper).not.toMatch(/\bDELETE\b/);
    expect(upper).not.toMatch(/\bALTER\b/);
    expect(upper).not.toMatch(/\bDROP\b/);
    expect(upper).not.toMatch(/\bCREATE TABLE\b/);
    expect(upper).not.toMatch(/\bTRUNCATE\b/);

    expect(sql.match(/WITH bounds AS/g)?.length).toBe(13);

    expect(sql).not.toMatch(/Brooke/i);
    expect(sql).not.toMatch(/Tyler/i);
    expect(sql).not.toMatch(/Jordan/i);
    expect(sql).not.toMatch(/clerk_user_id\s*=\s*'/);

    for (const name of REQUIRED_QUERY_NAMES) {
      expect(sql).toContain(name);
    }

    for (const marker of V11_MARKERS) {
      expect(sql).toContain(marker);
    }

    expect(sql).toContain("to_jsonb(m)");
    expect(sql).toContain("to_jsonb(j)");
    expect(sql).toContain("to_jsonb(s)");
    expect(sql).toContain("inbound_turn_telemetry");
    expect(sql).toContain("master_thread_truth_reconciliation");
    expect(sql).toContain("certification_scoreboard");

    expect(sql).not.toMatch(/\bm\.created_at\b/);
    expect(sql).not.toMatch(/\bs\.sms_body\b/);
    expect(sql).not.toMatch(/\bc\.effective_ask\b/);

    expect(sql).toContain("2026-06-17 00:00:00 America/New_York");
    expect(sql).toContain("2026-06-11 00:00:00 America/New_York");
    expect(sql).toContain("2026-06-18 00:00:00 America/New_York");
  });
});
