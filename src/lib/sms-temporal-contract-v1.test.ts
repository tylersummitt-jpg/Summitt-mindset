import { describe, expect, it } from "vitest";

import {
  allowedRelativeLabelForLocalDay,
  buildTemporalContractV1,
  buildReferencedEventsFromDailySources,
  dayKeyOffset,
  deriveInboundTemporalDayKeys,
  getLocalDayKeyForTimestamp,
} from "@/lib/sms-temporal-contract-v1";

const TZ = "America/New_York";

describe("sms-temporal-contract-v1", () => {
  it("computes yesterday/tomorrow from send day", () => {
    const now = new Date("2026-06-02T12:00:00.000Z");
    const c = buildTemporalContractV1({
      timezone: TZ,
      now,
      sendDayKey: "2026-06-02",
    });
    expect(c.today_key).toBe("2026-06-02");
    expect(c.yesterday_key).toBe("2026-06-01");
    expect(c.tomorrow_key).toBe("2026-06-03");
    expect(c.send_day_key).toBe("2026-06-02");
  });

  it("anchors inbound today to received local day", () => {
    const receivedAt = new Date("2026-05-31T21:17:00.000Z");
    const keys = deriveInboundTemporalDayKeys({
      temporalScope: "today",
      receivedAt,
      timezone: TZ,
    });
    expect(keys.spoken_local_day_key).toBe("2026-05-31");
    expect(keys.reported_for_day_key).toBe("2026-05-31");
  });

  it("labels May 31 completion as the_other_day on June 2 send", () => {
    const label = allowedRelativeLabelForLocalDay({
      eventLocalDayKey: "2026-05-31",
      todayKey: "2026-06-02",
      yesterdayKey: "2026-06-01",
      tomorrowKey: "2026-06-03",
    });
    expect(label).toBe("the_other_day");
  });

  it("buildReferencedEventsFromDailySources includes thread completion", () => {
    const contract = buildTemporalContractV1({
      timezone: TZ,
      now: new Date("2026-06-02T12:00:00.000Z"),
      sendDayKey: "2026-06-02",
    });
    const events = buildReferencedEventsFromDailySources({
      timezone: TZ,
      contract,
      recentThread72h: {
        messages: [
          {
            at: "2026-05-31T21:17:00.000Z",
            at_local: "May 31, 5:17 PM",
            at_local_timezone: TZ,
            local_day_key: "2026-05-31",
            role: "user",
            body: "Yes! I got it done today! Super proud.",
            message_kind: null,
            source_table: "sms_inbound_messages",
            message_sid: "SM1",
            delivery_status: "sent",
            is_exact_body: true,
          },
        ],
        window_hours: 72,
        message_count: 1,
        had_preview_messages: false,
        had_system_no_send: false,
      },
    });
    expect(events.some((e) => e.local_day_key === "2026-05-31")).toBe(true);
    expect(events.find((e) => e.ref_id.startsWith("thread_72h"))?.allowed_relative_label).toBe(
      "the_other_day"
    );
  });

  it("dayKeyOffset shifts calendar days", () => {
    expect(dayKeyOffset("2026-06-02", -1)).toBe("2026-06-01");
    expect(getLocalDayKeyForTimestamp("2026-05-31T21:17:00.000Z", TZ)).toBe("2026-05-31");
  });
});
