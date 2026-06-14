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

    expect(sql).toContain("VICTORY ROOM ↔ SMS BRIDGE DEBUG PACK v1");
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
});
