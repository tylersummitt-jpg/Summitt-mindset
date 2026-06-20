import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const SQL_PATH = "supabase/manual/sms_daily_command_center_pack_v2.sql";

const QUERY_HEADERS = [
  "executive_command_center_scorecard",
  "thread_timeline_time_of_day",
  "eligible_no_send_forensics_scoreboard",
  "memory_stale_thread_freshness",
  "zero_question_hidden_robot_scan",
  "inbound_pairing_truth_continuity",
  "truth_spine_outcome_certification",
  "no_send_truth_loss_persistence_timing",
  "plans_blockers_goal_changes_certification",
  "victory_room_projection_certification",
  "weekly_pending_state_sensitive_audit",
  "final_guard_product_law_side_room_audit",
  "observability_denominator_sanity_check",
];

const SAVED_QUERY_NAMES = [
  "SM_AUDIT_01_Command_Center",
  "SM_AUDIT_02_Thread_Timeline",
  "SM_AUDIT_03_Eligible_No_Send",
  "SM_AUDIT_04_Memory_Thread_Freshness",
  "SM_AUDIT_05_Language_Scan",
  "SM_AUDIT_06_Inbound_Pairing",
  "SM_AUDIT_07_Truth_Spine_Cert",
  "SM_AUDIT_08_NoSend_Truth_Loss",
  "SM_AUDIT_09_Plans_Blockers_Goals",
  "SM_AUDIT_10_Victory_Room",
  "SM_AUDIT_11_Weekly_Pending",
  "SM_AUDIT_12_Final_Guard_SideRoom",
  "SM_AUDIT_13_Denominator_Sanity",
];

describe("sms_daily_command_center_pack_v2.sql", () => {
  it("exists, is read-only, and has exactly 13 standalone query headers", async () => {
    const sql = await readFile(SQL_PATH, "utf8");
    const upper = sql.toUpperCase();

    expect(upper).not.toMatch(/\bINSERT\s+INTO\b/);
    expect(upper).not.toMatch(/^\s*UPDATE\s+\w/m);
    expect(upper).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(upper).not.toMatch(/\bALTER\s+TABLE\b/);
    expect(upper).not.toMatch(/\bDROP\s+TABLE\b/);
    expect(upper).not.toMatch(/\bCREATE\s+TABLE\b/);
    expect(upper).not.toMatch(/\bTRUNCATE\b/);

    expect(sql).toContain("SMS DAILY COMMAND CENTER PACK v2.2");
    expect(sql.match(/^-- QUERY \d{2} —/gm)?.length).toBe(13);

    for (const name of QUERY_HEADERS) {
      expect(sql).toContain(name);
    }
    for (const saved of SAVED_QUERY_NAMES) {
      expect(sql).toContain(saved);
    }

    expect(sql.match(/WITH bounds AS/g)?.length).toBeGreaterThanOrEqual(13);
    expect(sql).not.toMatch(/Brooke/i);
    expect(sql).not.toMatch(/Tyler/i);
    expect(sql).not.toMatch(/clerk_user_id\s*=\s*'/);
  });

  it("does not use unsafe last_error::jsonb casts", async () => {
    const sql = await readFile(SQL_PATH, "utf8");
    expect(sql).not.toMatch(/last_error'\)::jsonb/i);
    expect(sql).not.toMatch(/last_error\)\)::jsonb/i);
    expect(sql).not.toMatch(/last_error_json/);
  });

  it("includes required observability markers across the pack", async () => {
    const sql = await readFile(SQL_PATH, "utf8");

    expect(sql).toContain("time_of_day_copy_risk");
    expect(sql).toContain("near_duplicate_to_previous_coach_sms");
    expect(sql).toContain("eligible_no_send_rate");
    expect(sql).toContain("coach_body_near_duplicate_detected");
    expect(sql).toContain("daily_coach_body_near_duplicate_blocked");
    expect(sql).toContain("memory_repeat_no_send_reason");
    expect(sql).toContain("prior_coach_body_preview");
    expect(sql).toContain("coach_body_near_duplicate_block");
    expect(sql).toContain("daily_coach_body_near_duplicate_block_count");
    expect(sql).toContain("inbound_resolved_outcome");
    expect(sql).toContain("inbound_required_reply_move");
    expect(sql).toContain("inbound_truth_max_questions_override");
    expect(sql).toContain("inbound_resolved_truth");
    expect(sql).toContain("memory_repeat_repair_skipped_zero_question_mode");
    expect(sql).toContain("cert_diagnostic");
    expect(sql).toContain("should_display_in_vr");
    expect(sql).toContain("observability_denominator_sanity_check");
    expect(sql).toContain("could_make_sql_lie");
    expect(sql).toContain("inbound_truth_persist_attempted_before_writer");
    expect(sql).toContain("possible_truth_loss_due_to_no_send");
    expect(sql).toContain("next_recommended_slice");
    expect(sql).toContain("pairing_quality");
    expect(sql).toContain("actual_job_no_send_reason");
    expect(sql).toContain("no_send_truth_diagnostic");
    expect(sql).toContain("impacted_query");
    expect(sql).toContain("severity");
    expect(sql).toContain("inbound_stale_ask_no_send");
    expect(sql).toMatch(/amend/i);
    expect(sql).toMatch(/re-?state/i);
    expect(sql).toMatch(/restate/i);
    expect(sql).toMatch(/reset/i);
    expect(sql).toMatch(/old\\s\+goals/i);
    expect(sql).toMatch(
      /skipped_\(not_fully_on_v2\|no_active_commitment\|duplicate\|tapback\|compliance\|safety\|crisis\|invalid_phone\|outside_send_window\|active_inbound_thread\)/
    );
  });
});
