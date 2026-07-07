import { describe, expect, it } from "vitest";

import { checkSentIdempotencyKey } from "@/lib/v2-check-sent-slot";

const COMMITMENT = "22222222-2222-4222-8222-222222222222";
const DAY = "2026-07-07";

describe("check_sent idempotency — slot dedup matrix", () => {
  it("duplicate morning keys collide", () => {
    const a = checkSentIdempotencyKey(COMMITMENT, DAY, "morning");
    const b = checkSentIdempotencyKey(COMMITMENT, DAY, "morning");
    expect(a).toBe(b);
  });

  it("duplicate evening keys collide", () => {
    const a = checkSentIdempotencyKey(COMMITMENT, DAY, "evening_checkin");
    const b = checkSentIdempotencyKey(COMMITMENT, DAY, "evening_checkin");
    expect(a).toBe(b);
  });

  it("morning and evening keys do not collide", () => {
    expect(
      checkSentIdempotencyKey(COMMITMENT, DAY, "morning")
    ).not.toBe(checkSentIdempotencyKey(COMMITMENT, DAY, "evening_checkin"));
  });
});
