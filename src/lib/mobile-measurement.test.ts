import { describe, expect, it } from "vitest";

import {
  activityRowFromEvent,
  buildMobilePopulationFacts,
  classifyNavigation,
  classifyStartup,
  formatMobilePopulation,
  measurementIdempotencyKey,
  navigationSurfaceFromPath,
  shouldRecordStall,
  summarizeDurations,
  timingRowFromEvent,
  SCREEN_READY_TIMEOUT_MS,
} from "@/lib/mobile-measurement";
import {
  buildRetentionIntelligence,
  formatRetentionIntelligence,
  type RetentionSpell,
} from "@/lib/retention-intelligence";

const NOW = Date.parse("2026-11-02T15:00:00.000Z");
const DAY = 86_400_000;

function spell(patch: Partial<RetentionSpell> & Pick<RetentionSpell, "id" | "interval">): RetentionSpell {
  return {
    clerkUserId: "user_month",
    paidStartMs: NOW - 40 * DAY,
    endedAtMs: null,
    endKnown: true,
    open: true,
    cancellationReason: null,
    trialStartMs: null,
    ...patch,
  };
}

describe("mobile measurement definitions", () => {
  it("keeps cold and warm startup separate from interactive sign-in and hidden time", () => {
    expect(
      classifyStartup({ interactiveAuth: false, hidden: false, kind: "cold", elapsedMs: 2400 })
    ).toEqual({ action: "record", elapsedMs: 2400 });
    expect(
      classifyStartup({ interactiveAuth: false, hidden: false, kind: "warm", elapsedMs: 400 })
    ).toEqual({ action: "record", elapsedMs: 400 });
    expect(
      classifyStartup({ interactiveAuth: true, hidden: false, kind: "cold", elapsedMs: 90000 })
    ).toEqual({ action: "drop" });
    expect(
      classifyStartup({ interactiveAuth: false, hidden: true, kind: "cold", elapsedMs: 1000 })
    ).toEqual({ action: "ignore" });
    expect(
      classifyStartup({ interactiveAuth: false, hidden: false, kind: "none", elapsedMs: 1000 })
    ).toEqual({ action: "ignore" });
    expect(
      classifyStartup({ interactiveAuth: false, hidden: false, kind: "cold", elapsedMs: 120_001 })
    ).toEqual({ action: "drop" });
    expect(classifyNavigation({ hidden: true, elapsedMs: 500 })).toEqual({ action: "ignore" });
    expect(classifyNavigation({ hidden: false, elapsedMs: 800 })).toEqual({
      action: "record",
      elapsedMs: 800,
    });
    expect(shouldRecordStall({ hidden: true, superseded: false })).toBe(false);
    expect(shouldRecordStall({ hidden: false, superseded: true })).toBe(false);
    expect(shouldRecordStall({ hidden: false, superseded: false })).toBe(true);
    expect(SCREEN_READY_TIMEOUT_MS).toBe(20_000);
  });

  it("maps member routes and rejects an unknown path", () => {
    expect(navigationSurfaceFromPath("/dashboard/victory-room")).toBe("victory_room");
    expect(navigationSurfaceFromPath("/ask-pat")).toBe("ask_pat");
    expect(navigationSurfaceFromPath("/film-room/abc")).toBe("film_room");
    expect(navigationSurfaceFromPath("/programs/a/b")).toBe("programs");
    expect(navigationSurfaceFromPath("/app/sign-in")).toBeNull();
  });

  it("does not guess an invalid platform and keeps deduped records", () => {
    expect(
      activityRowFromEvent({
        clerkUserId: "user_month",
        atMs: NOW,
        eventType: "victory_room_visited",
        payload: {},
      })?.platform
    ).toBe("unknown");
    expect(
      activityRowFromEvent({
        clerkUserId: "user_month",
        atMs: NOW,
        eventType: "member_surface_visited",
        payload: { platform: "ios", surface: "ask_pat" },
      })
    ).toMatchObject({ platform: "ios", surface: "ask_pat", signal: "surface" });
    expect(
      timingRowFromEvent({
        clerkUserId: "user_month",
        atMs: NOW,
        eventType: "native_launch_measured",
        payload: { platform: "desktop", outcome: "ready", launchKind: "cold", surface: "victory_room", elapsedMs: 10 },
      })?.platform
    ).toBe("unknown");
    expect(
      timingRowFromEvent({
        clerkUserId: "user_month",
        atMs: NOW,
        eventType: "screen_load_measured",
        payload: { outcome: "failed", launchKind: "navigation", surface: "film_room", elapsedMs: 10 },
      })
    ).toBeNull();
  });

  it("separates monthly and annual members, members and records, and withholds a failed read", () => {
    const activity = [
      {
        clerkUserId: "user_month",
        atMs: NOW - DAY,
        signal: "victory_room" as const,
        platform: "ios" as const,
        surface: null,
      },
      {
        clerkUserId: "user_month",
        atMs: NOW,
        signal: "victory_room" as const,
        platform: "ios" as const,
        surface: null,
      },
      {
        clerkUserId: "user_year",
        atMs: NOW,
        signal: "film_play" as const,
        platform: "web" as const,
        surface: null,
      },
      {
        clerkUserId: "user_month",
        atMs: NOW,
        signal: "surface" as const,
        platform: "ios" as const,
        surface: "ask_pat" as const,
      },
      {
        clerkUserId: "user_month",
        atMs: NOW,
        signal: "surface" as const,
        platform: "web" as const,
        surface: "ask_pat" as const,
      },
    ];
    const timing = [
      {
        clerkUserId: "user_month",
        atMs: NOW,
        platform: "ios" as const,
        outcome: "ready" as const,
        launchKind: "cold" as const,
        surface: "victory_room" as const,
        elapsedMs: 1000,
      },
      {
        clerkUserId: "user_month",
        atMs: NOW,
        platform: "ios" as const,
        outcome: "ready" as const,
        launchKind: "cold" as const,
        surface: "victory_room" as const,
        elapsedMs: 3000,
      },
      {
        clerkUserId: "user_year",
        atMs: NOW,
        platform: "android" as const,
        outcome: "ready" as const,
        launchKind: "warm" as const,
        surface: "victory_room" as const,
        elapsedMs: 500,
      },
      {
        clerkUserId: "user_month",
        atMs: NOW,
        platform: "web" as const,
        outcome: "failed" as const,
        launchKind: "navigation" as const,
        surface: "programs" as const,
        elapsedMs: null,
      },
    ];
    const spells = [
      spell({ id: "m", interval: "month", clerkUserId: "user_month" }),
      spell({ id: "y", interval: "year", clerkUserId: "user_year" }),
    ];
    const monthly = buildMobilePopulationFacts({
      population: "Monthly",
      nowMs: NOW,
      spells: spells.filter((item) => item.interval === "month"),
      activity,
      timing,
    });
    const annual = buildMobilePopulationFacts({
      population: "Annual",
      nowMs: NOW,
      spells: spells.filter((item) => item.interval === "year"),
      activity,
      timing,
    });
    expect(monthly.victoryRoom.find((row) => row.platform === "ios")).toEqual({
      platform: "ios",
      members: 1,
      records: 2,
    });
    expect(annual.victoryRoom.every((row) => row.records === 0)).toBe(true);
    expect(annual.filmPlays.find((row) => row.platform === "web")?.records).toBe(1);
    expect(monthly.surfaces.find((row) => row.surface === "ask_pat")?.counts.find((row) => row.platform === "ios")?.records).toBe(1);
    expect(monthly.surfaces.find((row) => row.surface === "ask_pat")?.counts.find((row) => row.platform === "web")?.records).toBe(1);
    expect(monthly.cold.ios).toEqual({ count: 2, medianMs: 2000, p95Ms: 3000 });
    expect(monthly.cold.android).toEqual({ count: 0, medianMs: null, p95Ms: null });
    expect(annual.warm.android).toEqual({ count: 1, medianMs: 500, p95Ms: 500 });
    expect(annual.warm.ios.count).toBe(0);
    expect(monthly.startupFailures).toEqual({ ios: 0, android: 0 });
    expect(monthly.navigation.find((row) => row.surface === "programs" && row.platform === "web")?.failures).toBe(1);
    expect(summarizeDurations([10, 20, 30, 40]).p95Ms).toBe(40);

    const unread = buildMobilePopulationFacts({
      population: "Monthly",
      nowMs: NOW,
      spells,
      activity: null,
      timing: null,
    });
    const text = formatMobilePopulation(unread).join("\n");
    expect(text).toContain("unavailable");
    expect(text).not.toContain("0 members");
    expect(JSON.stringify(monthly)).not.toContain("user_month");
    expect(JSON.stringify(annual)).not.toContain("user_year");
    expect(text).not.toContain("raw_body");
  });

  it("does not change existing retention milestones when mobile rows are present", () => {
    const base = {
      nowMs: NOW,
      partial: false,
      partialReason: null,
      withheld: null,
      spells: [spell({ id: "m", interval: "month" })],
      activeWithoutPayment: 0,
      appleRows: 0,
      customerFeedbackCount: 0,
      engagementReadable: true,
      hits: [{ clerkUserId: "user_month", atMs: NOW - DAY, signal: "victory_room_visited" }],
      measuredSignals: [],
      acquisitionReadable: true,
      landingReadable: true,
      experimentReadable: true,
      acquisition: [],
    };
    const before = buildRetentionIntelligence(base);
    const after = buildRetentionIntelligence({
      ...base,
      mobileActivity: [
        {
          clerkUserId: "user_month",
          atMs: NOW - DAY,
          signal: "victory_room",
          platform: "ios",
          surface: null,
        },
      ],
      mobileTiming: [],
    });
    expect(after.milestones).toEqual(before.milestones);
    expect(after.monthlyActivity).toEqual(before.monthlyActivity);
    expect(after.monthlyBehavior).toEqual(before.monthlyBehavior);
    const facts = formatRetentionIntelligence(after).join("\n");
    expect(facts).toContain("MOBILE APP FACTS");
    expect(facts).toContain("not native app launches");
    expect(facts).toContain("October 28, 2026");
    expect(facts).toContain("October 31, 2026");
    expect(facts).not.toContain("user_month");
    expect(facts).not.toContain("victory_room_visited");
    expect(measurementIdempotencyKey({
      clerkUserId: "user_month",
      measurementId: "abc-123",
      record: "startup",
    })).toContain("startup");
    expect(measurementIdempotencyKey({
      clerkUserId: "user_month",
      measurementId: "abc-123",
      record: "startup",
    })).not.toBe(
      measurementIdempotencyKey({
        clerkUserId: "user_month",
        measurementId: "abc-123",
        record: "startup_failed",
      })
    );
  });
});
