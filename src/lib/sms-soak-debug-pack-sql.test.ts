import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const SQL_PATH = "supabase/manual/sms_soak_debug_pack.sql";

describe("sms_soak_debug_pack.sql", () => {
  it("is read-only and uses inbound sms_memory_signal telemetry joins", async () => {
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

    expect(sql.match(/WITH bounds AS/g)?.length).toBe(10);

    expect(sql).toContain("event_type = 'sms_memory_signal'");
    expect(sql).toContain("inbound_turn_telemetry");
    expect(sql).toContain("outbound_message_sid");
    expect(sql).not.toContain("v2_user_reply:' || j.message_sid");
  });

  it("v1.2 includes Daily C1 conversation intent and stale-ask observability columns", async () => {
    const sql = await readFile(SQL_PATH, "utf8");
    expect(sql).toContain("SMS SOAK DEBUG PACK v1.2");
    expect(sql).toContain("strategy_card_daily_conversation_intent");
    expect(sql).toContain("stale_ask_avoidance_has_satisfied_recent_ask");
    expect(sql).toContain("stale_ask_avoidance_satisfied_label_count");
    expect(sql).toContain("direct_outcome_check_count");
    expect(sql).toContain("relationship_anchor_bridge_count");
    expect(sql).not.toMatch(/satisfied_ask_labels/);
    expect(sql).not.toMatch(/do_not_reask_labels/);
  });
});
