import { describe, expect, it } from "vitest";
import { resolveTylerTextOverviewWeeklyPeriod } from "@/lib/tyler-text-overview-weekly-period";
import { getWeekKey, getWeekKeyForLocalDateKey } from "@/lib/weekly-sms-week-key";

const TZ = "America/New_York";

function periodAt(iso: string) {
  return resolveTylerTextOverviewWeeklyPeriod({
    now: new Date(iso),
    timezone: TZ,
  });
}

describe("weekly week_key is target Sunday, not generate weekday", () => {
  it("Friday generate and Sunday cron share one key for Jul 6–12 2026", () => {
    const friday = periodAt("2026-07-10T19:00:00.000Z");
    const saturday = periodAt("2026-07-11T19:00:00.000Z");
    const sunday = periodAt("2026-07-12T16:00:00.000Z");
    expect(friday.weekStart).toBe("2026-07-06");
    expect(friday.weekEnd).toBe("2026-07-12");
    expect(friday.weekKey).toBe(getWeekKeyForLocalDateKey("2026-07-12"));
    expect(friday.weekKey).toBe(saturday.weekKey);
    expect(friday.weekKey).toBe(sunday.weekKey);
    const fridayLocal = new Date(
      new Date("2026-07-10T19:00:00.000Z").toLocaleString("en-US", { timeZone: TZ })
    );
    expect(getWeekKey(fridayLocal)).not.toBe(friday.weekKey);
  });

  it("one Mon–Sun logical period has exactly one send key", () => {
    const keys = new Set(
      [
        periodAt("2026-07-06T16:00:00.000Z"),
        periodAt("2026-07-08T16:00:00.000Z"),
        periodAt("2026-07-10T19:00:00.000Z"),
        periodAt("2026-07-11T19:00:00.000Z"),
        periodAt("2026-07-12T16:00:00.000Z"),
      ].map((p) => p.weekKey)
    );
    expect(keys.size).toBe(1);
  });

  it("next Monday belongs to the next Weekly period", () => {
    const sunday = periodAt("2026-07-12T16:00:00.000Z");
    const monday = periodAt("2026-07-13T16:00:00.000Z");
    expect(monday.weekStart).toBe("2026-07-13");
    expect(monday.weekEnd).toBe("2026-07-19");
    expect(monday.weekKey).not.toBe(sunday.weekKey);
  });

  it("Dec 31 / Jan 1 / Jan 2 / first Sunday share the year-boundary logical week key", () => {
    const dec31 = periodAt("2025-12-31T20:00:00.000Z");
    const jan1 = periodAt("2026-01-01T20:00:00.000Z");
    const jan2 = periodAt("2026-01-02T20:00:00.000Z");
    const sunday = periodAt("2026-01-04T17:00:00.000Z");
    expect(dec31.weekStart).toBe("2025-12-29");
    expect(dec31.weekEnd).toBe("2026-01-04");
    expect(dec31.weekKey).toBe(getWeekKeyForLocalDateKey("2026-01-04"));
    expect(dec31.weekKey).toBe(jan1.weekKey);
    expect(jan1.weekKey).toBe(jan2.weekKey);
    expect(jan2.weekKey).toBe(sunday.weekKey);
    expect(new Set([dec31.weekKey, jan1.weekKey, jan2.weekKey, sunday.weekKey]).size).toBe(1);
  });

  it("does not create a second week numbering system", () => {
    const sunday = periodAt("2026-07-12T16:00:00.000Z");
    expect(sunday.weekKey).toBe(getWeekKeyForLocalDateKey(sunday.weekEnd));
  });
});
