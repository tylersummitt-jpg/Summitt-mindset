import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  VICTORY_CALENDAR_PATH,
  VICTORY_CALENDAR_SLOT_COUNT,
  VICTORY_CALENDAR_WEEKDAY_COUNT,
  buildVictoryCalendarGrid,
  buildVictoryCalendarHref,
  formatVictoryCalendarDayHeading,
  formatVictoryCalendarLongDate,
  formatVictoryCalendarMonthLabel,
  nextVictoryCalendarMonth,
  parseVictoryCalendarMonthKey,
  previousVictoryCalendarMonth,
  resolveVictoryCalendarPageState,
  resolveVisibleVictoryCalendarMonth,
  victoryCalendarDayAccessibleName,
  type VictoryCalendarSlot,
} from "@/lib/v2-victory-calendar";

const SRC = readFileSync(join(process.cwd(), "src/lib/v2-victory-calendar.ts"), "utf8");

function dayKeys(slots: VictoryCalendarSlot[]): string[] {
  return slots.filter((s): s is Extract<VictoryCalendarSlot, { kind: "day" }> => s.kind === "day")
    .map((s) => s.dateKey);
}

function leadingBlankCount(slots: VictoryCalendarSlot[]): number {
  let n = 0;
  for (const s of slots) {
    if (s.kind !== "blank") break;
    n += 1;
  }
  return n;
}

function trailingBlankCount(slots: VictoryCalendarSlot[]): number {
  let n = 0;
  for (let i = slots.length - 1; i >= 0; i--) {
    if (slots[i]?.kind !== "blank") break;
    n += 1;
  }
  return n;
}

describe("v2-victory-calendar import safety", () => {
  it("is pure and does not import Sol, D2, SMS persist, media writes, or weekly TTO", () => {
    expect(SRC).not.toContain("server-only");
    expect(SRC).not.toContain("supabase");
    expect(SRC).not.toContain("weekly-tto-accountability-events");
    expect(SRC).not.toContain("inbound-win-recognition");
    expect(SRC).not.toContain("inbound-sol-relationship");
    expect(SRC).not.toContain("inbound-mms-d2a");
    expect(SRC).not.toContain("inbound-mms-d2b");
    expect(SRC).not.toContain("inbound-mms-d2c");
    expect(SRC).not.toContain("historical-win-evidence-load");
    expect(SRC).not.toContain("v2-win-persist");
    expect(SRC).not.toContain("v2-win-public-read");
    expect(SRC).not.toContain("victory-media/");
    expect(SRC).not.toContain("@clerk");
  });
});

describe("parseVictoryCalendarMonthKey", () => {
  it("accepts canonical YYYY-MM and rejects malformed months", () => {
    expect(parseVictoryCalendarMonthKey("2026-09")).toBe("2026-09");
    expect(parseVictoryCalendarMonthKey(" 2026-09 ")).toBe("2026-09");
    expect(parseVictoryCalendarMonthKey("2026-9")).toBeNull();
    expect(parseVictoryCalendarMonthKey("2026-13")).toBeNull();
    expect(parseVictoryCalendarMonthKey("2026-00")).toBeNull();
    expect(parseVictoryCalendarMonthKey("September 2026")).toBeNull();
    expect(parseVictoryCalendarMonthKey("2026-09-01")).toBeNull();
    expect(parseVictoryCalendarMonthKey(null)).toBeNull();
  });
});

describe("resolveVisibleVictoryCalendarMonth", () => {
  const current = "2026-09";

  it("uses current month when requested is missing or malformed", () => {
    expect(resolveVisibleVictoryCalendarMonth({ requestedMonth: undefined, currentMonthKey: current })).toBe(
      "2026-09"
    );
    expect(resolveVisibleVictoryCalendarMonth({ requestedMonth: "", currentMonthKey: current })).toBe(
      "2026-09"
    );
    expect(resolveVisibleVictoryCalendarMonth({ requestedMonth: "2026-13", currentMonthKey: current })).toBe(
      "2026-09"
    );
    expect(resolveVisibleVictoryCalendarMonth({ requestedMonth: "2026-9", currentMonthKey: current })).toBe(
      "2026-09"
    );
  });

  it("clamps future months to current and keeps historical months", () => {
    expect(resolveVisibleVictoryCalendarMonth({ requestedMonth: "2026-10", currentMonthKey: current })).toBe(
      "2026-09"
    );
    expect(resolveVisibleVictoryCalendarMonth({ requestedMonth: "2099-01", currentMonthKey: current })).toBe(
      "2026-09"
    );
    expect(resolveVisibleVictoryCalendarMonth({ requestedMonth: "2026-08", currentMonthKey: current })).toBe(
      "2026-08"
    );
    expect(resolveVisibleVictoryCalendarMonth({ requestedMonth: "2025-12", currentMonthKey: current })).toBe(
      "2025-12"
    );
    expect(resolveVisibleVictoryCalendarMonth({ requestedMonth: "2026-09", currentMonthKey: current })).toBe(
      "2026-09"
    );
  });
});

describe("previous/next Victory Calendar month", () => {
  it("rolls January ↔ December across years", () => {
    expect(previousVictoryCalendarMonth("2026-01")).toBe("2025-12");
    expect(nextVictoryCalendarMonth("2025-12")).toBe("2026-01");
    expect(previousVictoryCalendarMonth("2026-09")).toBe("2026-08");
    expect(nextVictoryCalendarMonth("2026-09")).toBe("2026-10");
  });

  it("returns null for invalid month keys", () => {
    expect(previousVictoryCalendarMonth("nope")).toBeNull();
    expect(nextVictoryCalendarMonth("2026-13")).toBeNull();
  });
});

describe("formatVictoryCalendarMonthLabel", () => {
  it("formats September 2026 from numeric pieces, not Date(YYYY-MM)", () => {
    expect(formatVictoryCalendarMonthLabel("2026-09")).toBe("September 2026");
    expect(formatVictoryCalendarMonthLabel("2026-01")).toBe("January 2026");
    expect(formatVictoryCalendarMonthLabel("2026-13")).toBeNull();
    expect(SRC).not.toMatch(/new Date\(\s*["'`]/);
  });
});

describe("buildVictoryCalendarGrid", () => {
  it("September 2026: Tuesday start, 30 days, exactly 42 slots, canonical keys", () => {
    const slots = buildVictoryCalendarGrid("2026-09");
    expect(slots).not.toBeNull();
    expect(VICTORY_CALENDAR_SLOT_COUNT).toBe(6 * VICTORY_CALENDAR_WEEKDAY_COUNT);
    expect(slots).toHaveLength(VICTORY_CALENDAR_SLOT_COUNT);
    expect(leadingBlankCount(slots!)).toBe(2);
    expect(trailingBlankCount(slots!)).toBe(10);
    const days = slots!.filter((s) => s.kind === "day");
    expect(days).toHaveLength(30);
    expect(days[0]).toEqual({ kind: "day", dateKey: "2026-09-01", dayOfMonth: 1 });
    expect(days[13]).toEqual({ kind: "day", dateKey: "2026-09-14", dayOfMonth: 14 });
    expect(days[29]).toEqual({ kind: "day", dateKey: "2026-09-30", dayOfMonth: 30 });
    expect(dayKeys(slots!)).toEqual(
      Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`)
    );
    expect(slots![0]).toEqual({ kind: "blank" });
    expect(slots![1]).toEqual({ kind: "blank" });
    expect(slots![2]?.kind).toBe("day");
    expect(slots!.every((s) => s.kind === "blank" || /^\d{4}-\d{2}-\d{2}$/.test(s.dateKey))).toBe(
      true
    );
  });

  it("February leap vs common year, 30-day and 31-day months, Sunday-first offsets", () => {
    const leap = buildVictoryCalendarGrid("2024-02");
    expect(leap).toHaveLength(42);
    expect(leadingBlankCount(leap!)).toBe(4);
    expect(leap!.filter((s) => s.kind === "day")).toHaveLength(29);
    expect(trailingBlankCount(leap!)).toBe(9);
    expect(dayKeys(leap!).at(-1)).toBe("2024-02-29");

    const commonFeb = buildVictoryCalendarGrid("2025-02");
    expect(leadingBlankCount(commonFeb!)).toBe(6);
    expect(commonFeb!.filter((s) => s.kind === "day")).toHaveLength(28);
    expect(trailingBlankCount(commonFeb!)).toBe(8);

    const sundayStart = buildVictoryCalendarGrid("2026-02");
    expect(leadingBlankCount(sundayStart!)).toBe(0);
    expect(sundayStart!.filter((s) => s.kind === "day")).toHaveLength(28);
    expect(trailingBlankCount(sundayStart!)).toBe(14);
    expect(sundayStart![0]).toEqual({ kind: "day", dateKey: "2026-02-01", dayOfMonth: 1 });

    const apr = buildVictoryCalendarGrid("2026-04");
    expect(apr!.filter((s) => s.kind === "day")).toHaveLength(30);
    expect(leadingBlankCount(apr!)).toBe(3);

    const jan = buildVictoryCalendarGrid("2026-01");
    expect(jan!.filter((s) => s.kind === "day")).toHaveLength(31);
    expect(leadingBlankCount(jan!)).toBe(4);
  });

  it("does not emit adjacent-month date keys in blank cells", () => {
    const slots = buildVictoryCalendarGrid("2026-09")!;
    for (const s of slots) {
      if (s.kind === "blank") {
        expect(s).toEqual({ kind: "blank" });
        expect(s).not.toHaveProperty("dateKey");
      } else {
        expect(s.dateKey.startsWith("2026-09-")).toBe(true);
      }
    }
  });

  it("returns null for invalid month keys", () => {
    expect(buildVictoryCalendarGrid("2026-13")).toBeNull();
    expect(buildVictoryCalendarGrid("")).toBeNull();
  });
});

describe("resolveVictoryCalendarPageState", () => {
  const todayKey = "2026-09-01";

  it("defaults to current month with no selected day", () => {
    expect(
      resolveVictoryCalendarPageState({
        requestedMonth: undefined,
        requestedDay: undefined,
        todayKey,
      })
    ).toEqual({ monthKey: "2026-09", selectedDay: null });
  });

  it("keeps a historical month and accepts a past day in that month", () => {
    expect(
      resolveVictoryCalendarPageState({
        requestedMonth: "2026-08",
        requestedDay: "2026-08-12",
        todayKey,
      })
    ).toEqual({ monthKey: "2026-08", selectedDay: "2026-08-12" });
  });

  it("clamps future and malformed months to current and ignores invalid selected days", () => {
    expect(
      resolveVictoryCalendarPageState({
        requestedMonth: "2099-01",
        requestedDay: "2099-01-15",
        todayKey,
      })
    ).toEqual({ monthKey: "2026-09", selectedDay: null });
    expect(
      resolveVictoryCalendarPageState({
        requestedMonth: "2026-13",
        requestedDay: "not-a-day",
        todayKey,
      })
    ).toEqual({ monthKey: "2026-09", selectedDay: null });
    expect(
      resolveVictoryCalendarPageState({
        requestedMonth: "2026-09",
        requestedDay: "2026-08-12",
        todayKey,
      })
    ).toEqual({ monthKey: "2026-09", selectedDay: null });
    expect(
      resolveVictoryCalendarPageState({
        requestedMonth: "2026-09",
        requestedDay: "2026-09-15",
        todayKey,
      })
    ).toEqual({ monthKey: "2026-09", selectedDay: null });
  });
});

describe("buildVictoryCalendarHref", () => {
  it("omits query on current month with no day; writes month+day; month change drops day", () => {
    expect(
      buildVictoryCalendarHref({ monthKey: "2026-09", currentMonthKey: "2026-09" })
    ).toBe(VICTORY_CALENDAR_PATH);
    expect(
      buildVictoryCalendarHref({
        monthKey: "2026-09",
        currentMonthKey: "2026-09",
        dayKey: "2026-09-14",
      })
    ).toBe("/dashboard/victory-room?month=2026-09&day=2026-09-14");
    expect(
      buildVictoryCalendarHref({ monthKey: "2026-08", currentMonthKey: "2026-09" })
    ).toBe("/dashboard/victory-room?month=2026-08");
  });
});

describe("Victory Calendar day labels", () => {
  it("formats long date, selected heading, and accessible names", () => {
    expect(formatVictoryCalendarLongDate("2026-09-14")).toBe("September 14, 2026");
    expect(formatVictoryCalendarDayHeading("2026-09-14")).toBe("September 14");
    expect(
      victoryCalendarDayAccessibleName({
        dateKey: "2026-09-14",
        winCount: 1,
        isToday: false,
      })
    ).toBe("September 14, 2026, 1 Win");
    expect(
      victoryCalendarDayAccessibleName({
        dateKey: "2026-09-14",
        winCount: 2,
        isToday: false,
      })
    ).toBe("September 14, 2026, 2 Wins");
    expect(
      victoryCalendarDayAccessibleName({
        dateKey: "2026-09-15",
        winCount: 0,
        isToday: false,
      })
    ).toBe("September 15, 2026, no Wins");
    expect(
      victoryCalendarDayAccessibleName({
        dateKey: "2026-09-01",
        winCount: 0,
        isToday: true,
      })
    ).toBe("Today, September 1, 2026, no Wins");
  });
});
