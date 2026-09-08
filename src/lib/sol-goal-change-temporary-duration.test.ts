import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { getDateKeyInTimezone, localDayUtcRange, resolveUserTimezone } from "@/lib/timezone";
import { resolveTylerTextOverviewWeeklyPeriod } from "@/lib/tyler-text-overview-weekly-period";
import {
  resolveTemporaryOverlayExpiry,
  TEMPORARY_WEEKDAY_OCCURRENCE_RULE,
  type ResolveTemporaryOverlayExpiryInput,
} from "@/lib/sol-goal-change-temporary-duration";

const NY = "America/New_York";
const PHOENIX = "America/Phoenix";
const MONDAY_NOON_NY = new Date("2026-09-07T16:00:00.000Z");
const FRIDAY_NOON_NY = new Date("2026-09-11T16:00:00.000Z");
const SATURDAY_NOON_NY = new Date("2026-09-12T16:00:00.000Z");
const SUNDAY_NOON_NY = new Date("2026-09-13T16:00:00.000Z");
const SPRING_NOON_NY = new Date("2026-03-08T16:00:00.000Z");
const FALL_NOON_NY = new Date("2026-11-01T17:00:00.000Z");
const PRE_SPRING_NOON_NY = new Date("2026-03-07T17:00:00.000Z");
const PHOENIX_NOON = new Date("2026-09-07T19:00:00.000Z");

function base(
  overrides: Partial<ResolveTemporaryOverlayExpiryInput>
): ResolveTemporaryOverlayExpiryInput {
  return {
    temporary_duration_kind: "unspecified",
    temporary_duration_days: null,
    temporary_weekday: null,
    temporary_end_local_date: null,
    timezone: NY,
    now: MONDAY_NOON_NY,
    ...overrides,
  };
}

describe("Slice 7A — temporary overlay expiry resolver", () => {
  it("documents next-occurrence-including-today weekday law", () => {
    expect(TEMPORARY_WEEKDAY_OCCURRENCE_RULE).toBe("next_occurrence_on_or_after_today");
  });

  it("1 remaining_local_day expires at next local midnight", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({ temporary_duration_kind: "remaining_local_day" })
    );
    const today = getDateKeyInTimezone(MONDAY_NOON_NY, NY);
    const range = localDayUtcRange(today, NY);
    expect(result.supported).toBe(true);
    expect(result.clarification_required).toBe(false);
    expect(result.last_included_local_date).toBe(today);
    expect(result.expires_at_utc).toBe(range!.endUtcIso);
    expect(result.reason).toBe("resolved");
  });

  it("2 days=1 matches remaining_local_day civil end", () => {
    const remaining = resolveTemporaryOverlayExpiry(
      base({ temporary_duration_kind: "remaining_local_day" })
    );
    const days1 = resolveTemporaryOverlayExpiry(
      base({ temporary_duration_kind: "days", temporary_duration_days: 1 })
    );
    expect(days1).toEqual(remaining);
  });

  it("3 days=3 includes today and two following civil days", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({ temporary_duration_kind: "days", temporary_duration_days: 3 })
    );
    const range = localDayUtcRange("2026-09-09", NY);
    expect(result.supported).toBe(true);
    expect(result.last_included_local_date).toBe("2026-09-09");
    expect(result.expires_at_utc).toBe(range!.endUtcIso);
  });

  it("4 days=7 last included is today+6", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({ temporary_duration_kind: "days", temporary_duration_days: 7 })
    );
    expect(result.supported).toBe(true);
    expect(result.last_included_local_date).toBe("2026-09-13");
    expect(result.expires_at_utc).toBe(localDayUtcRange("2026-09-13", NY)!.endUtcIso);
  });

  it("5 local_week from Monday ends after Sunday", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({ temporary_duration_kind: "local_week", now: MONDAY_NOON_NY })
    );
    const week = resolveTylerTextOverviewWeeklyPeriod({ now: MONDAY_NOON_NY, timezone: NY });
    expect(week.weekStart).toBe("2026-09-07");
    expect(week.weekEnd).toBe("2026-09-13");
    expect(result.supported).toBe(true);
    expect(result.last_included_local_date).toBe("2026-09-13");
    expect(result.expires_at_utc).toBe(localDayUtcRange("2026-09-13", NY)!.endUtcIso);
  });

  it("6 local_week from Sunday still ends after that Sunday", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({ temporary_duration_kind: "local_week", now: SUNDAY_NOON_NY })
    );
    const week = resolveTylerTextOverviewWeeklyPeriod({ now: SUNDAY_NOON_NY, timezone: NY });
    expect(week.weekEnd).toBe("2026-09-13");
    expect(result.last_included_local_date).toBe("2026-09-13");
    expect(result.expires_at_utc).toBe(localDayUtcRange("2026-09-13", NY)!.endUtcIso);
  });

  it("7 through Friday from Monday includes this Friday", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({
        temporary_duration_kind: "through_weekday",
        temporary_weekday: "friday",
        now: MONDAY_NOON_NY,
      })
    );
    expect(result.supported).toBe(true);
    expect(result.last_included_local_date).toBe("2026-09-11");
    expect(result.expires_at_utc).toBe(localDayUtcRange("2026-09-11", NY)!.endUtcIso);
  });

  it("8 through Friday from Friday includes today", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({
        temporary_duration_kind: "through_weekday",
        temporary_weekday: "friday",
        now: FRIDAY_NOON_NY,
      })
    );
    expect(result.supported).toBe(true);
    expect(result.last_included_local_date).toBe("2026-09-11");
    expect(result.expires_at_utc).toBe(localDayUtcRange("2026-09-11", NY)!.endUtcIso);
  });

  it("9 until Friday from Monday excludes Friday", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({
        temporary_duration_kind: "until_weekday",
        temporary_weekday: "friday",
        now: MONDAY_NOON_NY,
      })
    );
    const fridayStart = localDayUtcRange("2026-09-11", NY)!.startUtcIso;
    expect(result.supported).toBe(true);
    expect(result.last_included_local_date).toBe("2026-09-10");
    expect(result.expires_at_utc).toBe(fridayStart);
  });

  it("10 until Friday on Friday fails closed — does not jump a week", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({
        temporary_duration_kind: "until_weekday",
        temporary_weekday: "friday",
        now: FRIDAY_NOON_NY,
      })
    );
    expect(result.supported).toBe(false);
    expect(result.clarification_required).toBe(true);
    expect(result.expires_at_utc).toBeNull();
    expect(result.last_included_local_date).toBeNull();
    expect(result.reason).toBe("already_expired");
  });

  it("through Friday from Saturday uses next Friday, not last Friday", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({
        temporary_duration_kind: "through_weekday",
        temporary_weekday: "friday",
        now: SATURDAY_NOON_NY,
      })
    );
    expect(result.supported).toBe(true);
    expect(result.last_included_local_date).toBe("2026-09-18");
    expect(result.expires_at_utc).toBe(localDayUtcRange("2026-09-18", NY)!.endUtcIso);
  });

  it("11 through explicit date includes that date", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({
        temporary_duration_kind: "through_local_date",
        temporary_end_local_date: "2026-09-12",
      })
    );
    expect(result.supported).toBe(true);
    expect(result.last_included_local_date).toBe("2026-09-12");
    expect(result.expires_at_utc).toBe(localDayUtcRange("2026-09-12", NY)!.endUtcIso);
  });

  it("12 until explicit date excludes that date", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({
        temporary_duration_kind: "until_local_date",
        temporary_end_local_date: "2026-09-12",
      })
    );
    expect(result.supported).toBe(true);
    expect(result.last_included_local_date).toBe("2026-09-11");
    expect(result.expires_at_utc).toBe(localDayUtcRange("2026-09-12", NY)!.startUtcIso);
  });

  it("13 invalid date fails closed", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({
        temporary_duration_kind: "through_local_date",
        temporary_end_local_date: "2026-02-30",
      })
    );
    expect(result.supported).toBe(false);
    expect(result.clarification_required).toBe(true);
    expect(result.reason).toBe("invalid_date");
  });

  it("14 date >14 local days out fails closed", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({
        temporary_duration_kind: "through_local_date",
        temporary_end_local_date: "2026-09-22",
      })
    );
    expect(result.supported).toBe(false);
    expect(result.clarification_required).toBe(true);
    expect(result.reason).toBe("beyond_supported_window");
  });

  it("14-day cap includes today+13", () => {
    const ok = resolveTemporaryOverlayExpiry(
      base({
        temporary_duration_kind: "through_local_date",
        temporary_end_local_date: "2026-09-20",
      })
    );
    expect(ok.supported).toBe(true);
    expect(ok.last_included_local_date).toBe("2026-09-20");
  });

  it("15 unspecified fails closed with no expiry", () => {
    const result = resolveTemporaryOverlayExpiry(base({ temporary_duration_kind: "unspecified" }));
    expect(result.supported).toBe(false);
    expect(result.clarification_required).toBe(true);
    expect(result.expires_at_utc).toBeNull();
    expect(result.reason).toBe("unspecified");
  });

  it("16 DST spring: remaining_local_day uses next midnight, not +24h", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({
        temporary_duration_kind: "remaining_local_day",
        now: SPRING_NOON_NY,
      })
    );
    const today = getDateKeyInTimezone(SPRING_NOON_NY, NY);
    expect(today).toBe("2026-03-08");
    const range = localDayUtcRange(today, NY)!;
    expect(result.expires_at_utc).toBe(range.endUtcIso);
    expect(Date.parse(range.endUtcIso) - Date.parse(range.startUtcIso)).toBe(23 * 60 * 60 * 1000);
    const plus24 = new Date(Date.parse(range.startUtcIso) + 24 * 60 * 60 * 1000).toISOString();
    expect(result.expires_at_utc).not.toBe(plus24);
  });

  it("17 DST fall: remaining_local_day uses next midnight, not +24h", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({
        temporary_duration_kind: "remaining_local_day",
        now: FALL_NOON_NY,
      })
    );
    const today = getDateKeyInTimezone(FALL_NOON_NY, NY);
    expect(today).toBe("2026-11-01");
    const range = localDayUtcRange(today, NY)!;
    expect(result.expires_at_utc).toBe(range.endUtcIso);
    expect(Date.parse(range.endUtcIso) - Date.parse(range.startUtcIso)).toBe(25 * 60 * 60 * 1000);
    const plus24 = new Date(Date.parse(range.startUtcIso) + 24 * 60 * 60 * 1000).toISOString();
    expect(result.expires_at_utc).not.toBe(plus24);
  });

  it("N-day expiry stays civil-day correct across spring DST", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({
        temporary_duration_kind: "days",
        temporary_duration_days: 3,
        now: PRE_SPRING_NOON_NY,
      })
    );
    expect(getDateKeyInTimezone(PRE_SPRING_NOON_NY, NY)).toBe("2026-03-07");
    expect(result.last_included_local_date).toBe("2026-03-09");
    expect(result.expires_at_utc).toBe(localDayUtcRange("2026-03-09", NY)!.endUtcIso);
    const start = localDayUtcRange("2026-03-07", NY)!.startUtcIso;
    const rolling72h = new Date(Date.parse(start) + 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(result.expires_at_utc).not.toBe(rolling72h);
  });

  it("18 timezone with no DST still uses next local midnight", () => {
    const result = resolveTemporaryOverlayExpiry(
      base({
        temporary_duration_kind: "remaining_local_day",
        timezone: PHOENIX,
        now: PHOENIX_NOON,
      })
    );
    const today = getDateKeyInTimezone(PHOENIX_NOON, PHOENIX);
    const range = localDayUtcRange(today, PHOENIX)!;
    expect(result.expires_at_utc).toBe(range.endUtcIso);
    expect(Date.parse(range.endUtcIso) - Date.parse(range.startUtcIso)).toBe(24 * 60 * 60 * 1000);
  });

  it("19 invalid timezone uses existing resolveUserTimezone fallback", () => {
    const fallbackTz = resolveUserTimezone("Not/ARealZone");
    expect(fallbackTz).toBe(NY);
    const result = resolveTemporaryOverlayExpiry(
      base({
        temporary_duration_kind: "remaining_local_day",
        timezone: "Not/ARealZone",
        now: MONDAY_NOON_NY,
      })
    );
    const expected = resolveTemporaryOverlayExpiry(
      base({ temporary_duration_kind: "remaining_local_day", timezone: NY, now: MONDAY_NOON_NY })
    );
    expect(result).toEqual(expected);
  });

  it("20 last_included_local_date is exact for remaining, days, through, until", () => {
    expect(
      resolveTemporaryOverlayExpiry(base({ temporary_duration_kind: "remaining_local_day" }))
        .last_included_local_date
    ).toBe("2026-09-07");
    expect(
      resolveTemporaryOverlayExpiry(
        base({ temporary_duration_kind: "days", temporary_duration_days: 3 })
      ).last_included_local_date
    ).toBe("2026-09-09");
    expect(
      resolveTemporaryOverlayExpiry(
        base({
          temporary_duration_kind: "through_weekday",
          temporary_weekday: "friday",
        })
      ).last_included_local_date
    ).toBe("2026-09-11");
    expect(
      resolveTemporaryOverlayExpiry(
        base({
          temporary_duration_kind: "until_local_date",
          temporary_end_local_date: "2026-09-12",
        })
      ).last_included_local_date
    ).toBe("2026-09-11");
  });

  it("resolver does not inspect raw member text", () => {
    const src = resolveTemporaryOverlayExpiry.toString();
    expect(src).not.toMatch(/tonight|this week|until friday/i);
  });
});
