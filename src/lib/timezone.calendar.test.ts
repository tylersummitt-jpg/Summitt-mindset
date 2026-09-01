import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getDateKeyInTimezone,
  localDayUtcRange,
  localMonthUtcRange,
  resolveUserTimezone,
  utcInstantForLocalMidnight,
} from "@/lib/timezone";

const HOUR_MS = 3600_000;
const TZ_SRC = readFileSync(join(process.cwd(), "src/lib/timezone.ts"), "utf8");

describe("timezone calendar range helpers — import safety", () => {
  it("does not import weekly TTO, Sol, D2, accountability persist, or media writes", () => {
    expect(TZ_SRC).not.toContain("weekly-tto-accountability-events");
    expect(TZ_SRC).not.toContain("inbound-win-recognition");
    expect(TZ_SRC).not.toContain("inbound-sol-relationship");
    expect(TZ_SRC).not.toContain("inbound-mms-d2a");
    expect(TZ_SRC).not.toContain("inbound-mms-d2b");
    expect(TZ_SRC).not.toContain("inbound-mms-d2c");
    expect(TZ_SRC).not.toContain("historical-win-evidence-load");
    expect(TZ_SRC).not.toContain("accountability-persist");
    expect(TZ_SRC).not.toContain("victory-media/");
  });
});

describe("utcInstantForLocalMidnight", () => {
  it("resolves valid NY / LA / UTC midnights", () => {
    expect(utcInstantForLocalMidnight("2026-09-14", "America/New_York")?.toISOString()).toBe(
      "2026-09-14T04:00:00.000Z"
    );
    expect(utcInstantForLocalMidnight("2026-09-14", "America/Los_Angeles")?.toISOString()).toBe(
      "2026-09-14T07:00:00.000Z"
    );
    expect(utcInstantForLocalMidnight("2026-09-14", "UTC")?.toISOString()).toBe(
      "2026-09-14T00:00:00.000Z"
    );
    expect(utcInstantForLocalMidnight("2026-01-01", "America/New_York")?.toISOString()).toBe(
      "2026-01-01T05:00:00.000Z"
    );
  });

  it("returns null for invalid dates and does not throw", () => {
    expect(utcInstantForLocalMidnight("2026-02-30", "America/New_York")).toBeNull();
    expect(utcInstantForLocalMidnight("2026-13-01", "America/New_York")).toBeNull();
    expect(utcInstantForLocalMidnight("not-a-date", "UTC")).toBeNull();
    expect(utcInstantForLocalMidnight("", "UTC")).toBeNull();
    expect(utcInstantForLocalMidnight("2026-9-14", "UTC")).toBeNull();
    expect(utcInstantForLocalMidnight(null, "UTC")).toBeNull();
  });

  it("falls back through resolveUserTimezone for missing/invalid TZ", () => {
    const ny = utcInstantForLocalMidnight("2026-09-14", "America/New_York")?.toISOString();
    expect(resolveUserTimezone("Not/A_Zone")).toBe("America/New_York");
    expect(resolveUserTimezone("")).toBe("America/New_York");
    expect(resolveUserTimezone(null)).toBe("America/New_York");
    expect(utcInstantForLocalMidnight("2026-09-14", "Not/A_Zone")?.toISOString()).toBe(ny);
    expect(utcInstantForLocalMidnight("2026-09-14", "")?.toISOString()).toBe(ny);
    expect(utcInstantForLocalMidnight("2026-09-14", null)?.toISOString()).toBe(ny);
  });
});

describe("localDayUtcRange", () => {
  it("is [local midnight, next local midnight) in NY, LA, and UTC", () => {
    expect(localDayUtcRange("2026-09-14", "America/New_York")).toEqual({
      startUtcIso: "2026-09-14T04:00:00.000Z",
      endUtcIso: "2026-09-15T04:00:00.000Z",
    });
    expect(localDayUtcRange("2026-09-14", "America/Los_Angeles")).toEqual({
      startUtcIso: "2026-09-14T07:00:00.000Z",
      endUtcIso: "2026-09-15T07:00:00.000Z",
    });
    expect(localDayUtcRange("2026-09-14", "UTC")).toEqual({
      startUtcIso: "2026-09-14T00:00:00.000Z",
      endUtcIso: "2026-09-15T00:00:00.000Z",
    });
  });

  it("covers a member-local day that crosses a UTC date", () => {
    const range = localDayUtcRange("2026-09-14", "America/New_York");
    expect(range).not.toBeNull();
    const stillLocalSep14 = "2026-09-15T02:00:00.000Z";
    expect(stillLocalSep14 >= range!.startUtcIso).toBe(true);
    expect(stillLocalSep14 < range!.endUtcIso).toBe(true);
    expect(getDateKeyInTimezone(new Date(stillLocalSep14), "America/New_York")).toBe(
      "2026-09-14"
    );
    expect("2026-09-15T04:00:00.000Z" < range!.endUtcIso).toBe(false);
  });

  it("uses next local midnight, not +24h, across DST", () => {
    const spring = localDayUtcRange("2026-03-08", "America/New_York");
    expect(spring).toEqual({
      startUtcIso: "2026-03-08T05:00:00.000Z",
      endUtcIso: "2026-03-09T04:00:00.000Z",
    });
    expect(Date.parse(spring!.endUtcIso) - Date.parse(spring!.startUtcIso)).toBe(23 * HOUR_MS);

    const fall = localDayUtcRange("2026-11-01", "America/New_York");
    expect(fall).toEqual({
      startUtcIso: "2026-11-01T04:00:00.000Z",
      endUtcIso: "2026-11-02T05:00:00.000Z",
    });
    expect(Date.parse(fall!.endUtcIso) - Date.parse(fall!.startUtcIso)).toBe(25 * HOUR_MS);

    const ordinary = localDayUtcRange("2026-09-14", "America/New_York");
    expect(Date.parse(ordinary!.endUtcIso) - Date.parse(ordinary!.startUtcIso)).toBe(24 * HOUR_MS);
  });

  it("returns null for invalid dates without throwing", () => {
    expect(localDayUtcRange("2026-02-30", "America/New_York")).toBeNull();
    expect(localDayUtcRange("nope", "UTC")).toBeNull();
    expect(localDayUtcRange("2026-04-31", "UTC")).toBeNull();
  });
});

describe("localMonthUtcRange", () => {
  it("is [first local midnight, next-month first local midnight) for NY / LA / UTC", () => {
    expect(localMonthUtcRange("2026-09", "America/New_York")).toEqual({
      startUtcIso: "2026-09-01T04:00:00.000Z",
      endUtcIso: "2026-10-01T04:00:00.000Z",
    });
    expect(localMonthUtcRange("2026-09", "America/Los_Angeles")).toEqual({
      startUtcIso: "2026-09-01T07:00:00.000Z",
      endUtcIso: "2026-10-01T07:00:00.000Z",
    });
    expect(localMonthUtcRange("2026-09", "UTC")).toEqual({
      startUtcIso: "2026-09-01T00:00:00.000Z",
      endUtcIso: "2026-10-01T00:00:00.000Z",
    });
  });

  it("includes late-UTC instants that still belong to the member-local month", () => {
    const range = localMonthUtcRange("2026-09", "America/New_York");
    const stillSeptemberLocal = "2026-10-01T02:00:00.000Z";
    expect(stillSeptemberLocal >= range!.startUtcIso).toBe(true);
    expect(stillSeptemberLocal < range!.endUtcIso).toBe(true);
    expect(getDateKeyInTimezone(new Date(stillSeptemberLocal), "America/New_York")).toBe(
      "2026-09-30"
    );
  });

  it("rolls December to January without +30 days", () => {
    expect(localMonthUtcRange("2026-12", "America/New_York")).toEqual({
      startUtcIso: "2026-12-01T05:00:00.000Z",
      endUtcIso: "2027-01-01T05:00:00.000Z",
    });
    const ms =
      Date.parse("2027-01-01T05:00:00.000Z") - Date.parse("2026-12-01T05:00:00.000Z");
    expect(ms).toBe(31 * 24 * HOUR_MS);
  });

  it("returns null for invalid months without throwing", () => {
    expect(localMonthUtcRange("2026-13", "America/New_York")).toBeNull();
    expect(localMonthUtcRange("2026-00", "UTC")).toBeNull();
    expect(localMonthUtcRange("2026-9", "UTC")).toBeNull();
    expect(localMonthUtcRange("September 2026", "UTC")).toBeNull();
    expect(localMonthUtcRange("", "UTC")).toBeNull();
    expect(localMonthUtcRange(null, "UTC")).toBeNull();
  });

  it("preserves resolveUserTimezone fallback for invalid TZ on a valid month", () => {
    expect(localMonthUtcRange("2026-09", "garbage")).toEqual(
      localMonthUtcRange("2026-09", "America/New_York")
    );
  });
});
