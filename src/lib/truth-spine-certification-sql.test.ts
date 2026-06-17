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
];

describe("truth_spine_certification_pack.sql", () => {
  it("is read-only, bounded, all-users, and includes all certification queries", async () => {
    const sql = await readFile(SQL_PATH, "utf8");
    const upper = sql.toUpperCase();

    expect(upper).not.toMatch(/\bINSERT\b/);
    expect(upper).not.toMatch(/\bUPDATE\b/);
    expect(upper).not.toMatch(/\bDELETE\b/);
    expect(upper).not.toMatch(/\bALTER\b/);
    expect(upper).not.toMatch(/\bDROP\b/);
    expect(upper).not.toMatch(/\bCREATE\b/);

    expect(sql.match(/WITH bounds AS/g)?.length).toBe(12);

    expect(sql).not.toMatch(/Brooke/i);
    expect(sql).not.toMatch(/Tyler/i);
    expect(sql).not.toMatch(/Jordan/i);
    expect(sql).not.toMatch(/clerk_user_id\s*=\s*'/);

    for (const name of REQUIRED_QUERY_NAMES) {
      expect(sql).toContain(name);
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

    expect(sql).toContain("2026-06-11 00:00:00 America/New_York");
    expect(sql).toContain("2026-06-18 00:00:00 America/New_York");
  });
});
