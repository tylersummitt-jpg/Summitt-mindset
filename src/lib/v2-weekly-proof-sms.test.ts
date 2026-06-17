import { describe, expect, it } from "vitest";

import {
  isSuspectFalseUserNoPayload,
  tallyWeeklyUserNoDays,
} from "@/lib/v2-weekly-proof-miss-tally";

const ONBOARDING_DISPUTE =
  "Thanks I did 15 minutes of onboarding and you didn't ask me anything about what I chose. Did the onboarding matter?";

describe("tallyWeeklyUserNoDays — distinct local miss-day dedupe", () => {
  it("two user_no rows on same local_day_key count as one distinct miss day", () => {
    const tally = tallyWeeklyUserNoDays({
      timezone: "America/New_York",
      rows: [
        {
          occurred_at: "2026-06-10T14:00:00.000Z",
          payload_json: { local_day_key: "2026-06-10", message: "I didn't do it today" },
        },
        {
          occurred_at: "2026-06-10T20:00:00.000Z",
          payload_json: { local_day_key: "2026-06-10", message: "Missed again tonight" },
        },
      ],
    });
    expect(tally.raw_user_no_count).toBe(2);
    expect(tally.distinct_user_no_day_count).toBe(1);
    expect(tally.exact_miss_day_count_reliable).toBe(true);
  });

  it("two user_no rows on two distinct local_day_key values count as two miss days", () => {
    const tally = tallyWeeklyUserNoDays({
      timezone: "America/New_York",
      rows: [
        {
          occurred_at: "2026-06-09T14:00:00.000Z",
          payload_json: { local_day_key: "2026-06-09" },
        },
        {
          occurred_at: "2026-06-10T14:00:00.000Z",
          payload_json: { local_day_key: "2026-06-10" },
        },
      ],
    });
    expect(tally.raw_user_no_count).toBe(2);
    expect(tally.distinct_user_no_day_count).toBe(2);
  });

  it("excludes meta/onboarding false user_no from miss-day counts", () => {
    const tally = tallyWeeklyUserNoDays({
      timezone: "America/New_York",
      rows: [
        {
          occurred_at: "2026-06-10T14:00:00.000Z",
          payload_json: {
            local_day_key: "2026-06-10",
            message: "I did not get it today because vacation",
          },
        },
        {
          occurred_at: "2026-06-10T20:00:00.000Z",
          payload_json: { local_day_key: "2026-06-10", message: ONBOARDING_DISPUTE },
        },
      ],
    });
    expect(tally.raw_user_no_count).toBe(2);
    expect(tally.distinct_user_no_day_count).toBe(1);
    expect(tally.false_or_suspect_user_no_count).toBe(1);
  });

  it("missing local_day_key without payload day marks unknown and blocks exact multi-day claims", () => {
    const tally = tallyWeeklyUserNoDays({
      timezone: "America/New_York",
      rows: [
        {
          occurred_at: "not-a-date",
          payload_json: { message: "I missed it" },
        },
        {
          occurred_at: "also-not-a-date",
          payload_json: { message: "Skipped again" },
        },
      ],
    });
    expect(tally.raw_user_no_count).toBe(2);
    expect(tally.distinct_user_no_day_count).toBe(0);
    expect(tally.unknown_day_user_no_count).toBe(2);
    expect(tally.exact_miss_day_count_reliable).toBe(false);
  });

  it("detects suspect rows via evidence tags on payload", () => {
    expect(
      isSuspectFalseUserNoPayload({
        evidence: ["onboarding_process_dispute_not_miss"],
        local_day_key: "2026-06-10",
      })
    ).toBe(true);
  });
});
