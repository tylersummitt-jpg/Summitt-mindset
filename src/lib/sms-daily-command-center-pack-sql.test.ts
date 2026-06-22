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
  "relationship_thread_review",
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
  "SM_AUDIT_14_Relationship_Thread_Review",
];

describe("sms_daily_command_center_pack_v2.sql", () => {
  it("exists, is read-only, and has exactly 14 standalone query headers", async () => {
    const sql = await readFile(SQL_PATH, "utf8");
    const upper = sql.toUpperCase();

    expect(upper).not.toMatch(/\bINSERT\s+INTO\b/);
    expect(upper).not.toMatch(/^\s*UPDATE\s+\w/m);
    expect(upper).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(upper).not.toMatch(/\bALTER\s+TABLE\b/);
    expect(upper).not.toMatch(/\bDROP\s+TABLE\b/);
    expect(upper).not.toMatch(/\bCREATE\s+TABLE\b/);
    expect(upper).not.toMatch(/\bTRUNCATE\b/);

    expect(sql).toContain("SMS DAILY COMMAND CENTER PACK v2.8");
    expect(sql.match(/^-- QUERY \d{2} —/gm)?.length).toBe(14);

    for (const name of QUERY_HEADERS) {
      expect(sql).toContain(name);
    }
    for (const saved of SAVED_QUERY_NAMES) {
      expect(sql).toContain(saved);
    }

    expect(sql.match(/WITH bounds AS/g)?.length).toBeGreaterThanOrEqual(14);
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

  it("includes DailySmsWritingBriefV1 observability markers in the pack", async () => {
    const sql = await readFile(SQL_PATH, "utf8");

    expect(sql).toContain("writer_prompt_path");
    expect(sql).toContain("daily_writing_brief_used");
    expect(sql).toContain("daily_writing_brief_build_status");
    expect(sql).toContain("daily_writing_brief_skip_reason");
    expect(sql).toContain("daily_suggested_move");
    expect(sql).toContain("daily_freshness_avoid_phrases_preview");
    expect(sql).toContain("daily_brief_thread_extension_message_count");
    expect(sql).toContain("daily_open_loop_pending_active");
    expect(sql).toContain("c1_brief_used_count");
    expect(sql).toContain("c1_brief_fallback_count");
    expect(sql).toContain("c1_brief_missing_reason_count");
    expect(sql).toContain("extension_thread_used_count");
    expect(sql).toContain("freshness_phrase_preview_present_count");
    expect(sql).toContain("open_loop_active_count");
    expect(sql).toContain("c1_legacy_without_skip_reason");
    expect(sql).toContain("c1_brief_used_missing_suggested_move");
    expect(sql).toContain("c1_brief_thread_counts_missing");
    expect(sql).toContain("c1_freshness_count_without_preview");
    expect(sql).toContain("c1_open_loop_flags_missing");
    expect(sql).toContain("daily_local_daypart");
    expect(sql).toContain("daily_timing_guidance_present");
    expect(sql).toContain("daily_durable_memory_item_count");
    expect(sql).toContain("daily_durable_people_count");
    expect(sql).toContain("daily_durable_memory_background_only");
    expect(sql).toContain("timing_guidance_present_count");
    expect(sql).toContain("durable_memory_present_count");
    expect(sql).toContain("durable_people_present_count");
    expect(sql).toContain("c1_brief_missing_timing_observability");
    expect(sql).toContain("c1_brief_missing_durable_memory_observability");
    expect(sql).toContain("c1_brief_durable_memory_not_background_only");
    expect(sql).toContain("c1_brief_missing_daypart");
    expect(sql).toContain("c1_brief_thread_over_cap");
    expect(sql).toContain("c1_brief_empty_thread_with_prior_visible");
    expect(sql).toContain("c1_freshness_missed_visible_cta");
    expect(sql).toMatch(/hour\.\{0,30\}distribution/);
    expect(sql).toContain("c1_brief_oldest_newest_reversed_count");
    expect(sql).toContain("visible_repeated_cta_risk");
    expect(sql).toContain("freshness_preview_missed_visible_cta");
    expect(sql).toContain("repeated_cta_family");
    expect(sql).toContain("daily_writing_brief_v1_sent_count");
    expect(sql).toContain("legacy_packet_v1_sent_count");
    expect(sql).toContain("daily_praise_allowed_level");
    expect(sql).toContain("unsupported_praise_claim");
    expect(sql).toContain("unsupported_praise_no_send_count");
    expect(sql).toContain("repeated_cta_no_send_count");
    expect(sql).toContain("repeated_cta_detected");
    expect(sql).toContain("weak_proof_bad_praise_visible_count");
    expect(sql).toContain("brief_telemetry_missing_on_c1_sent");
    expect(sql).toContain("writer_total_chars_missing");
    expect(sql).not.toMatch(/last_error'\)::jsonb/i);
  });

  it("includes v2.7 Relationship Thread Review markers in the pack", async () => {
    const sql = await readFile(SQL_PATH, "utf8");

    expect(sql).toContain("relationship_thread_review");
    expect(sql).toContain("thread_role");
    expect(sql).toContain("visible_relationship_row");
    expect(sql).toContain("user_inbound_job");
    expect(sql).toContain("coach_daily_outbound");
    expect(sql).toContain("coach_inbound_reply");
    expect(sql).toContain("coach_weekly_outbound");
    expect(sql).toContain("daily_brief_thread_message_count");
    expect(sql).toContain("daily_freshness_avoid_phrases_preview");
    expect(sql).toContain("daily_durable_memory_item_count");
    expect(sql).toContain("user_stated_why_signal");
    expect(sql).toContain("SM_AUDIT_14_Relationship_Thread_Review");
    expect(sql).not.toMatch(/last_error'\)::jsonb/i);
  });

  it("includes v2.8 weekly SMS body observability markers in the pack", async () => {
    const sql = await readFile(SQL_PATH, "utf8");

    expect(sql).toContain("north_star_gate,final_body");
    expect(sql).toContain("north_star_gate,original_body");
    expect(sql).toContain("v3_candidate_body");
    expect(sql).toContain("final_voice_gate,final_body");
    expect(sql).toContain("weekly_body_missing_with_sid_count");
    expect(sql).toContain("weekly_body_missing_with_sid");
    expect(sql).toContain("relationship_thread_review");
    expect(sql.match(/^-- QUERY \d{2} —/gm)?.length).toBe(14);
    expect(sql).not.toMatch(/last_error'\)::jsonb/i);
  });
});
