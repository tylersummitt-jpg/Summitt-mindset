import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildCheckSentIdempotencyKey,
  checkSentIdempotencyKey,
  legacyCheckSentIdempotencyKey,
  parseCheckSentSendSlot,
  parseCheckSentSendSlotFromIdempotencyKey,
} from "@/lib/v2-check-sent-slot";

const COMMITMENT = "11111111-1111-4111-8111-111111111111";
const DAY = "2026-07-07";

describe("v2-check-sent-slot", () => {
  it("checkSentIdempotencyKey includes send_slot", () => {
    expect(checkSentIdempotencyKey(COMMITMENT, DAY, "morning")).toBe(
      `v2_check_sent:${COMMITMENT}:${DAY}:morning`
    );
    expect(checkSentIdempotencyKey(COMMITMENT, DAY, "evening_checkin")).toBe(
      `v2_check_sent:${COMMITMENT}:${DAY}:evening_checkin`
    );
  });

  it("legacy day-only key differs from slot-scoped morning key", () => {
    expect(legacyCheckSentIdempotencyKey(COMMITMENT, DAY)).toBe(
      `v2_check_sent:${COMMITMENT}:${DAY}`
    );
    expect(legacyCheckSentIdempotencyKey(COMMITMENT, DAY)).not.toBe(
      checkSentIdempotencyKey(COMMITMENT, DAY, "morning")
    );
  });

  it("morning and evening keys are distinct for same commitment/day", () => {
    const morning = checkSentIdempotencyKey(COMMITMENT, DAY, "morning");
    const evening = checkSentIdempotencyKey(COMMITMENT, DAY, "evening_checkin");
    expect(morning).not.toBe(evening);
  });

  it("parseCheckSentSendSlot reads payload send_slot", () => {
    expect(parseCheckSentSendSlot({ send_slot: "evening_checkin" })).toBe("evening_checkin");
    expect(parseCheckSentSendSlot({ send_slot: "morning" })).toBe("morning");
    expect(parseCheckSentSendSlot({})).toBe("morning");
  });

  it("parseCheckSentSendSlot infers slot from idempotency key suffix", () => {
    expect(
      parseCheckSentSendSlot(
        {},
        checkSentIdempotencyKey(COMMITMENT, DAY, "evening_checkin")
      )
    ).toBe("evening_checkin");
    expect(parseCheckSentSendSlotFromIdempotencyKey(legacyCheckSentIdempotencyKey(COMMITMENT, DAY))).toBe(
      null
    );
  });

  it("buildCheckSentIdempotencyKey aliases checkSentIdempotencyKey", () => {
    expect(buildCheckSentIdempotencyKey(COMMITMENT, DAY, "morning")).toBe(
      checkSentIdempotencyKey(COMMITMENT, DAY, "morning")
    );
  });
});

describe("phase 2C-1 migration", () => {
  const migration = readFileSync(
    "supabase/migrations/20260707120000_v2_check_sent_slot_idempotency_phase2c1.sql",
    "utf8"
  );

  it("RPC uses slot-scoped idempotency key with legacy morning dedup", () => {
    expect(migration).toMatch(/v_send_slot/);
    expect(migration).toMatch(/v2_check_sent:%s:%s:%s/);
    expect(migration).toMatch(/v_legacy_idempotency_key/);
    expect(migration).toMatch(/'send_slot', v_send_slot/);
  });

  it("does not use explicit SAVEPOINT transaction control (Supabase PL/pgSQL safe)", () => {
    expect(migration).not.toMatch(/\bSAVEPOINT\b/i);
    expect(migration).not.toMatch(/ROLLBACK\s+TO\s+SAVEPOINT/i);
    expect(migration).not.toMatch(/\bRELEASE\s+SAVEPOINT\b/i);
  });

  it("uses nested BEGIN EXCEPTION blocks for proposal partial-write safety", () => {
    expect(migration).toMatch(/v2_check_sent_prop_repair_conflict/);
    expect(migration).toMatch(/v2_check_sent_prop_fresh_conflict/);
    expect(migration).toMatch(/EXCEPTION[\s\S]*WHEN OTHERS THEN/);
  });

  it("morning outbound bookkeeping includes send_slot in buildStandardCheckSentPayload", () => {
    const src = readFileSync("src/lib/daily-sms-build.ts", "utf8");
    expect(src).toMatch(/send_slot:\s*sendSlot/);
    expect(src).toMatch(/sendSlot\s*=\s*args\.sendSlot\s*\?\?\s*SMS_DAILY_PRODUCTION_SEND_SLOT/);
  });
});
