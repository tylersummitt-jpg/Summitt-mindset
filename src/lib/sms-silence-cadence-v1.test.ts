import { describe, expect, it, vi } from "vitest";
import { dayKeyOffset } from "@/lib/sms-temporal-contract-v1";
import {
  deriveSilenceCadenceV1,
  routeForSilenceDay,
  type SilenceCadenceRoute,
} from "@/lib/sms-silence-cadence-v1";
import { fetchLastAnyUserReplyAt } from "@/lib/sms-last-any-user-reply";
import { isSmsComplianceOnlyInbound } from "@/lib/v2-commitment-sms-thread-memory";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

const TZ = "America/New_York";
const TODAY = "2026-07-10";

function replyAtForDayKey(dayKey: string): string {
  return `${dayKey}T17:00:00.000Z`;
}

function cadenceForSilenceDay(silenceDay: number) {
  const anchorDay = dayKeyOffset(TODAY, -silenceDay);
  return deriveSilenceCadenceV1({
    lastAnyUserReplyAt: replyAtForDayKey(anchorDay),
    neverRepliedAnchorAt: "2026-06-01T12:00:00.000Z",
    todayLocalDayKey: TODAY,
    timezone: TZ,
  });
}

function expectRoute(
  silenceDay: number,
  route: SilenceCadenceRoute,
  sendToday: boolean,
  noSendReason: string | null = null
) {
  const result = cadenceForSilenceDay(silenceDay);
  expect(result.silence_day).toBe(silenceDay);
  expect(result.route).toBe(route);
  expect(result.send_today).toBe(sendToday);
  expect(result.no_send_reason).toBe(noSendReason);
  expect(result.route_card_id).toBe(route);
}

describe("routeForSilenceDay", () => {
  it("maps Tyler master schedule", () => {
    expect(routeForSilenceDay(0)).toBe("normal_daily");
    expect(routeForSilenceDay(9)).toBe("no_send_space_day9");
    expect(routeForSilenceDay(21)).toBe("weekly_reentry_day21");
    expect(routeForSilenceDay(36)).toBe("dormant_no_send_other");
  });
});

describe("deriveSilenceCadenceV1 schedule", () => {
  it("silence_day 0 -> normal_daily, send true", () => {
    expectRoute(0, "normal_daily", true);
  });

  it("silence_day 1 -> normal_daily, send true", () => {
    expectRoute(1, "normal_daily", true);
  });

  it("silence_day 2 -> normal_daily, send true", () => {
    expectRoute(2, "normal_daily", true);
  });

  it("day 3 -> soft_reentry_day3", () => {
    expectRoute(3, "soft_reentry_day3", true);
  });

  it("day 4 -> clean_reset_day4", () => {
    expectRoute(4, "clean_reset_day4", true);
  });

  it("day 5 -> cant_coach_silence_day5", () => {
    expectRoute(5, "cant_coach_silence_day5", true);
  });

  it("day 6 -> find_obstacle_day6", () => {
    expectRoute(6, "find_obstacle_day6", true);
  });

  it("day 7 -> recommit_or_adjust_day7", () => {
    expectRoute(7, "recommit_or_adjust_day7", true);
  });

  it("day 8 -> pat_style_challenge_day8", () => {
    expectRoute(8, "pat_style_challenge_day8", true);
  });

  it("day 9 -> no_send_space_day9, send false", () => {
    expectRoute(9, "no_send_space_day9", false, "silence_cadence_space_day9");
  });

  it("day 10 -> relationship_check_day10", () => {
    expectRoute(10, "relationship_check_day10", true);
  });

  it("day 11 -> no_send_space_day11, send false", () => {
    expectRoute(11, "no_send_space_day11", false, "silence_cadence_space_day11");
  });

  it("day 12 -> honest_decision_day12", () => {
    expectRoute(12, "honest_decision_day12", true);
  });

  it("day 13 -> no_send_space_day13, send false", () => {
    expectRoute(13, "no_send_space_day13", false, "silence_cadence_space_day13");
  });

  it("day 14 -> final_daily_mode_day14", () => {
    expectRoute(14, "final_daily_mode_day14", true);
  });

  it("days 15–20 -> dormant_no_send_days15_20, send false", () => {
    for (let d = 15; d <= 20; d += 1) {
      expectRoute(d, "dormant_no_send_days15_20", false, "silence_cadence_dormant_15_20");
    }
  });

  it("day 21 -> weekly_reentry_day21", () => {
    expectRoute(21, "weekly_reentry_day21", true);
  });

  it("days 22–27 -> dormant_no_send_other, send false", () => {
    for (let d = 22; d <= 27; d += 1) {
      expectRoute(d, "dormant_no_send_other", false, "silence_cadence_dormant_other");
    }
  });

  it("day 28 -> weekly_identity_day28", () => {
    expectRoute(28, "weekly_identity_day28", true);
  });

  it("days 29–34 -> dormant_no_send_other, send false", () => {
    for (let d = 29; d <= 34; d += 1) {
      expectRoute(d, "dormant_no_send_other", false, "silence_cadence_dormant_other");
    }
  });

  it("day 35 -> weekly_value_check_day35", () => {
    expectRoute(35, "weekly_value_check_day35", true);
  });

  it("day 36+ -> dormant_no_send_other, send false", () => {
    expectRoute(36, "dormant_no_send_other", false, "silence_cadence_dormant_other");
    expectRoute(40, "dormant_no_send_other", false, "silence_cadence_dormant_other");
  });
});

describe("deriveSilenceCadenceV1 reply reset", () => {
  it("same-day reply resets to silence_day 0", () => {
    const result = deriveSilenceCadenceV1({
      lastAnyUserReplyAt: replyAtForDayKey(TODAY),
      neverRepliedAnchorAt: "2026-06-01T12:00:00.000Z",
      todayLocalDayKey: TODAY,
      timezone: TZ,
    });
    expect(result.silence_day).toBe(0);
    expect(result.route).toBe("normal_daily");
    expect(result.send_today).toBe(true);
  });

  it("reply yesterday resets to normal_daily with silence_day 1", () => {
    const yesterday = dayKeyOffset(TODAY, -1);
    const result = deriveSilenceCadenceV1({
      lastAnyUserReplyAt: replyAtForDayKey(yesterday),
      neverRepliedAnchorAt: "2026-06-01T12:00:00.000Z",
      todayLocalDayKey: TODAY,
      timezone: TZ,
    });
    expect(result.silence_day).toBe(1);
    expect(result.route).toBe("normal_daily");
    expect(result.send_today).toBe(true);
  });

  it("never-replied anchor uses commitment/check_sent clock", () => {
    const anchorDay = dayKeyOffset(TODAY, -5);
    const result = deriveSilenceCadenceV1({
      lastAnyUserReplyAt: null,
      neverRepliedAnchorAt: replyAtForDayKey(anchorDay),
      todayLocalDayKey: TODAY,
      timezone: TZ,
    });
    expect(result.silence_day).toBe(5);
    expect(result.route).toBe("cant_coach_silence_day5");
  });
});

describe("fetchLastAnyUserReplyAt compliance exclusion", () => {
  it("compliance-only inbound does not count as engagement", () => {
    expect(isSmsComplianceOnlyInbound("STOP")).toBe(true);
    expect(isSmsComplianceOnlyInbound("thanks")).toBe(false);
    expect(isSmsComplianceOnlyInbound("ok")).toBe(false);
  });

  it("skips compliance rows when scanning inbound", async () => {
    const { supabaseServer } = await import("@/lib/supabase-server");
    const fromMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [
                { received_at: "2026-07-10T12:00:00.000Z", raw_body: "STOP" },
                { received_at: "2026-07-09T12:00:00.000Z", raw_body: "ok" },
              ],
              error: null,
            }),
          }),
        }),
      }),
    });
    vi.mocked(supabaseServer.from).mockImplementation(fromMock);

    const at = await fetchLastAnyUserReplyAt("user_test");
    expect(at).toBe("2026-07-09T12:00:00.000Z");
  });
});
