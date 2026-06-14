import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const SQL_PATH = "supabase/manual/victory_room_sms_bridge_debug_pack.sql";

describe("victory_room_sms_bridge_debug_pack.sql", () => {
  it("is read-only, all-users, and uses bounds CTEs on every query", async () => {
    const sql = await readFile(SQL_PATH, "utf8");
    const upper = sql.toUpperCase();

    expect(upper).not.toMatch(/\bINSERT\b/);
    expect(upper).not.toMatch(/\bUPDATE\b/);
    expect(upper).not.toMatch(/\bDELETE\b/);
    expect(upper).not.toMatch(/\bALTER\b/);
    expect(upper).not.toMatch(/\bDROP\b/);
    expect(upper).not.toMatch(/\bCREATE\b/);

    expect(sql).not.toMatch(/Brooke/i);
    expect(sql).not.toMatch(/clerk_user_id\s*=\s*'/);

    expect(sql.match(/WITH bounds AS/g)?.length).toBe(11);
  });

  it("contains required bridge query sections", async () => {
    const sql = await readFile(SQL_PATH, "utf8");

    expect(sql).toContain("VICTORY ROOM ↔ SMS BRIDGE DEBUG PACK v1.2");
    expect(sql).toContain("sms_outcome_to_proof_moment_map");
    expect(sql).toContain("proof_moments_displayability_candidates");
    expect(sql).toContain("victory_room_current_goal_vs_sms_effective_ask");
    expect(sql).toContain("sms_victory_room_language_claims");
    expect(sql).toContain("sms_proof_claim_without_saved_proof");
    expect(sql).toContain("no_send_wrote_proof_check");
    expect(sql).toContain("app_identity_goal_edit_to_sms_context");
    expect(sql).toContain("sms_goal_change_to_victory_room_state");
    expect(sql).toContain("important_people_privacy_bridge");
    expect(sql).toContain("victory_room_surface_copy_risk_search");
    expect(sql).toContain("bridge_health_rollup");
  });

  it("does not select important_people.display_name in active queries", async () => {
    const sql = await readFile(SQL_PATH, "utf8");
    const withoutCommentedManualBlock = sql.split(
      "-- Manual privacy audit:"
    )[0]!;

    expect(withoutCommentedManualBlock).not.toMatch(
      /important_people\.display_name/i
    );
    expect(withoutCommentedManualBlock).toContain("active_people_count");
    expect(withoutCommentedManualBlock).toContain(
      "relationship_anchor_available_count"
    );
  });

  it("includes proof_moment spine fields and effective ask mismatch flags", async () => {
    const sql = await readFile(SQL_PATH, "utf8");

    expect(sql).toContain("proof_moment_type");
    expect(sql).toContain("user_visible_proof_line");
    expect(sql).toContain("sms_effective_ask_differs_from_victory_goal");
    expect(sql).toContain("can_reference_victory_room");
    expect(sql).toContain("event_type = 'sms_memory_signal'");
  });

  it("Query 3 does not reference sms_send_events.commitment_id column", async () => {
    const sql = await readFile(SQL_PATH, "utf8");
    const q3Start = sql.indexOf("QUERY 3 — victory_room_current_goal_vs_sms_effective_ask");
    const q4Start = sql.indexOf("QUERY 4 — sms_victory_room_language_claims");
    const q3 = sql.slice(q3Start, q4Start);

    expect(q3).not.toMatch(/e\.commitment_id/);
    expect(q3).toContain("ac.clerk_user_id = e.clerk_user_id");
    expect(q3).toContain("pending_same_base_recommit_proposal");
    expect(q3).toContain("recommit_same");
  });

  it("Query 11 uses local date day_series joins aligned with rollup CTEs", async () => {
    const sql = await readFile(SQL_PATH, "utf8");
    const q11Start = sql.indexOf("QUERY 11 — bridge_health_rollup");
    const q11 = sql.slice(q11Start);

    expect(q11).toContain(")::date AS day_et");
    expect(q11).toContain(
      "(ev.occurred_at AT TIME ZONE 'America/New_York')::date AS day_et"
    );
    expect(q11).toContain("LEFT JOIN outcome_counts o ON o.day_et = d.day_et");
    expect(q11).not.toContain("LEFT JOIN outcome_counts o ON o.day_et = d.day_start");
  });

  it("Query 6 does not reference sms_send_events.commitment_id column", async () => {
    const sql = await readFile(SQL_PATH, "utf8");
    const q6Start = sql.indexOf("QUERY 6 — no_send_wrote_proof_check");
    const q7Start = sql.indexOf("QUERY 7 — app_identity_goal_edit_to_sms_context");
    const q6 = sql.slice(q6Start, q7Start);

    expect(q6).not.toMatch(/\be\.commitment_id\b/);
    expect(q6).toContain("metadata->>'commitment_id'");
    expect(q6).toContain("ac.clerk_user_id = e.clerk_user_id");
  });

  it("Query 7 does not reference sms_send_events.commitment_id column", async () => {
    const sql = await readFile(SQL_PATH, "utf8");
    const q7Start = sql.indexOf("QUERY 7 — app_identity_goal_edit_to_sms_context");
    const q8Start = sql.indexOf("QUERY 8 — sms_goal_change_to_victory_room_state");
    const q7 = sql.slice(q7Start, q8Start);

    expect(q7).not.toMatch(/\bs\.commitment_id\b/);
    expect(q7).toContain("ac.clerk_user_id = s.clerk_user_id");
    expect(q7).toContain("sms_used_old_identity");
    expect(q7).toContain("sms_used_old_goal");
  });

  it("entire pack has no direct sms_send_events.commitment_id column reference", async () => {
    const sql = await readFile(SQL_PATH, "utf8");

    for (const match of sql.matchAll(/FROM sms_send_events\s+(\w+)/gi)) {
      const alias = match[1]!;
      const start = match.index ?? 0;
      const nextSection = sql.indexOf("\n-- =", start + 1);
      const block = sql.slice(
        start,
        nextSection > start ? nextSection : start + 5000
      );
      expect(block).not.toMatch(new RegExp(`\\b${alias}\\.commitment_id\\b`));
    }
  });
});
