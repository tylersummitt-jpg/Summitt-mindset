import { describe, expect, it } from "vitest";

import {
  V2_EVENT_TRACKING_START_MS,
  activityPeriod,
  buildMemberActivity,
  unavailableActivitySignals,
  type ActivityMembership,
} from "@/lib/retention-activity-periods";
import { buildRetentionIntelligence, type RetentionSpell } from "@/lib/retention-intelligence";

const DAY = 86_400_000;
const START = Date.parse("2026-11-01T00:00:00.000Z");
const NOW = START + 44 * DAY;

function member(patch: Partial<ActivityMembership> = {}): ActivityMembership {
  return {
    clerkUserId: "user_a",
    startMs: START,
    endMs: null,
    endKnown: true,
    open: true,
    ...patch,
  };
}

describe("subscription-age activity", () => {
  it("uses days 0–7, days 8–30, then 30-day periods", () => {
    expect(activityPeriod(0)).toMatchObject({ label: "Days 0–7", startDay: 0, endDayExclusive: 8 });
    expect(activityPeriod(1)).toMatchObject({ label: "Days 8–30", startDay: 8, endDayExclusive: 31 });
    expect(activityPeriod(2)).toMatchObject({ label: "Days 31–60", startDay: 31, endDayExclusive: 61 });
    expect(activityPeriod(3).startDay).toBe(61);
  });

  it("counts distinct days inside the period and leaves out activity after the end", () => {
    const ended = member({
      open: false,
      endMs: START + 40 * DAY,
    });
    const report = buildMemberActivity({
      population: "Monthly",
      nowMs: NOW,
      memberships: [ended],
      unavailableSignalIds: [],
      hits: [
        { clerkUserId: "user_a", atMs: START + 3 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_a", atMs: START + 3 * DAY + 60_000, signal: "coaching_reply" },
        { clerkUserId: "user_a", atMs: START + 10 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_a", atMs: START + 39 * DAY, signal: "goal_win" },
        { clerkUserId: "user_a", atMs: START + 41 * DAY, signal: "goal_win" },
      ],
    });
    const finished = report.periods.find((period) => period.label === "Days 0–7" && period.status === "finished");
    const replies = finished?.cells.find((cell) => cell.signalId === "coaching_reply");
    expect(replies).toMatchObject({ status: "ready", eligible: 1, used: 1, total: 1, average: "1.0" });
    const middle = report.periods.find((period) => period.label === "Days 8–30" && period.status === "finished");
    expect(middle?.cells.find((cell) => cell.signalId === "coaching_reply")?.total).toBe(1);
    expect(
      report.periods.find((period) => period.label === "Days 31–60" && period.status === "finished")
    ).toBeUndefined();
    expect(
      report.periods.find((period) => period.label === "Days 31–60" && period.status === "in_progress")
        ?.endedDuring
    ).toBe(1);
    expect(
      report.periods.find((period) => period.label === "Days 0–7" && period.status === "finished")
        ?.endedDuring
    ).toBe(0);
    const laterWin = report.periods
      .flatMap((period) => period.cells)
      .filter((cell) => cell.signalId === "goal_win" && cell.total > 0);
    expect(laterWin).toEqual([]);
  });

  it("keeps a member who left during the period out of the finished count", () => {
    const report = buildMemberActivity({
      population: "Monthly",
      nowMs: NOW,
      memberships: [member({ open: false, endMs: START + 4 * DAY })],
      hits: [{ clerkUserId: "user_a", atMs: START + 2 * DAY, signal: "ask_pat" }],
      unavailableSignalIds: [],
    });
    const first = report.periods.find((period) => period.label === "Days 0–7" && period.status === "finished");
    expect(first?.endedDuring).toBe(1);
    expect(first?.cells.find((cell) => cell.signalId === "ask_pat")?.eligible).toBe(0);
    const stayed = buildMemberActivity({
      population: "Monthly",
      nowMs: NOW,
      memberships: [
        member({ open: false, endMs: START + 4 * DAY }),
        member({ clerkUserId: "user_b" }),
      ],
      hits: [],
      unavailableSignalIds: [],
    });
    const both = stayed.periods.find((period) => period.label === "Days 0–7" && period.status === "finished");
    expect(both?.endedDuring).toBe(1);
    expect(both?.cells.find((cell) => cell.signalId === "ask_pat")).toMatchObject({
      eligible: 1,
      used: 0,
    });
  });

  it("separates the current unfinished period", () => {
    const report = buildMemberActivity({
      population: "Monthly",
      nowMs: NOW,
      memberships: [member()],
      hits: [{ clerkUserId: "user_a", atMs: START + 40 * DAY, signal: "proud_moment" }],
      unavailableSignalIds: [],
    });
    const current = report.periods.find(
      (period) => period.label === "Days 31–60" && period.status === "in_progress"
    );
    const cell = current?.cells.find((cell) => cell.signalId === "proud_moment");
    expect(cell).toMatchObject({ status: "ready", eligible: 1, used: 1, total: 1 });
    expect(cell?.warning).toContain("Still open");
    const finishedLater = report.periods.find(
      (period) => period.label === "Days 31–60" && period.status === "finished"
    );
    expect(finishedLater).toBeUndefined();
  });

  it("shows Victory Room before October 28, 2026 as unavailable, not zero", () => {
    const earlyStart = Date.parse("2026-06-01T00:00:00.000Z");
    const report = buildMemberActivity({
      population: "Monthly",
      nowMs: Date.parse("2026-08-01T00:00:00.000Z"),
      memberships: [member({ startMs: earlyStart })],
      hits: [],
      unavailableSignalIds: [],
    });
    const visit = report.periods
      .find((period) => period.label === "Days 0–7" && period.status === "finished")
      ?.cells.find((cell) => cell.signalId === "victory_room_visited");
    expect(visit?.status).toBe("unavailable");
    expect(visit?.total).toBe(0);
    expect(visit?.warning).toContain("not zero");
    expect(earlyStart).toBeLessThan(V2_EVENT_TRACKING_START_MS);
  });

  it("counts a Victory Room visit only after tracking has started", () => {
    const report = buildMemberActivity({
      population: "Monthly",
      nowMs: NOW,
      memberships: [member()],
      hits: [
        {
          clerkUserId: "user_a",
          atMs: START + 2 * DAY,
          signal: "victory_room_visited",
        },
        {
          clerkUserId: "user_a",
          atMs: START + 2 * DAY + 3_600_000,
          signal: "film_room_played",
        },
      ],
      unavailableSignalIds: [],
    });
    const visits = report.periods
      .find((period) => period.label === "Days 0–7" && period.status === "finished")
      ?.cells.find((cell) => cell.signalId === "victory_room_visited");
    const plays = report.periods
      .find((period) => period.label === "Days 0–7" && period.status === "finished")
      ?.cells.find((cell) => cell.signalId === "film_room_played");
    expect(visits).toMatchObject({ status: "ready", eligible: 1, used: 1, total: 1 });
    expect(plays).toMatchObject({ status: "ready", total: 1 });
  });

  it("does not turn a failed read into zero usage", () => {
    const report = buildMemberActivity({
      population: "Monthly",
      nowMs: NOW,
      memberships: [member()],
      hits: [],
      unavailableSignalIds: unavailableActivitySignals(
        ["Coaching texts could not be fully read. They are not shown as zero."],
        true
      ),
    });
    const coaching = report.periods
      .find((period) => period.label === "Days 0–7" && period.status === "finished")
      ?.cells.find((cell) => cell.signalId === "coaching");
    expect(coaching?.status).toBe("unavailable");
    expect(coaching?.warning).toContain("not zero");
    expect(coaching?.average).toBe("Unavailable");
  });

  it("leaves monthly day-30 counts unchanged when visit hits are present", () => {
    const spell: RetentionSpell = {
      id: "s1",
      clerkUserId: "user_a",
      paidStartMs: START,
      endedAtMs: null,
      endKnown: true,
      open: true,
      interval: "month",
      cancellationReason: null,
      trialStartMs: null,
    };
    const without = buildRetentionIntelligence({
      nowMs: NOW,
      partial: false,
      partialReason: null,
      withheld: null,
      spells: [spell],
      activeWithoutPayment: 0,
      appleRows: 0,
      customerFeedbackCount: 0,
      engagementReadable: true,
      hits: [],
      measuredSignals: [],
      acquisitionReadable: false,
      landingReadable: false,
      experimentReadable: false,
      acquisition: [],
    });
    const withVisit = buildRetentionIntelligence({
      nowMs: NOW,
      partial: false,
      partialReason: null,
      withheld: null,
      spells: [spell],
      activeWithoutPayment: 0,
      appleRows: 0,
      customerFeedbackCount: 0,
      engagementReadable: true,
      hits: [{ clerkUserId: "user_a", atMs: START + DAY, signal: "victory_room_visited" }],
      measuredSignals: [],
      acquisitionReadable: false,
      landingReadable: false,
      experimentReadable: false,
      acquisition: [],
    });
    expect(withVisit.milestones).toEqual(without.milestones);
    expect(withVisit.annual).toEqual(without.annual);
    expect(withVisit.engagement).toEqual(without.engagement);
    expect(withVisit.monthlyActivity.periods.some((period) => period.label === "Days 0–7")).toBe(true);
  });
});
