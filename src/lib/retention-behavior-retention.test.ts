import { describe, expect, it } from "vitest";

import { buildBehaviorRetention, behaviorOutcomeDay } from "@/lib/retention-behavior-retention";
import { activityPeriod } from "@/lib/retention-activity-periods";
import { buildRetentionIntelligence, type RetentionSpell } from "@/lib/retention-intelligence";

const DAY = 86_400_000;
const START = Date.parse("2026-11-01T00:00:00.000Z");

function member(patch: {
  clerkUserId?: string;
  startMs?: number;
  endMs?: number | null;
  endKnown?: boolean;
  open?: boolean;
  hasLater?: boolean;
} = {}) {
  return {
    clerkUserId: "user_a",
    startMs: START,
    endMs: null as number | null,
    endKnown: true,
    open: true,
    hasLater: false,
    ...patch,
  };
}

function signalRow(
  report: ReturnType<typeof buildBehaviorRetention>,
  windowLabel: string,
  signalId: string
) {
  return report.windows
    .find((window) => window.windowLabel === windowLabel)
    ?.signals.find((signal) => signal.signalId === signalId);
}

function group(
  report: ReturnType<typeof buildBehaviorRetention>,
  windowLabel: string,
  signalId: string,
  labelStart: string
) {
  return signalRow(report, windowLabel, signalId)?.groups.find((item) =>
    item.label.startsWith(labelStart)
  );
}

describe("behavior vs future retention", () => {
  it("maps each finished window to the later retention day", () => {
    expect(behaviorOutcomeDay(activityPeriod(0))).toBe(30);
    expect(behaviorOutcomeDay(activityPeriod(1))).toBe(60);
    expect(behaviorOutcomeDay(activityPeriod(2))).toBe(90);
    expect(behaviorOutcomeDay(activityPeriod(3))).toBe(120);
    expect(behaviorOutcomeDay(activityPeriod(5))).toBe(180);
  });

  it("ignores activity after the observation window and after the membership end", () => {
    const report = buildBehaviorRetention({
      population: "Monthly",
      nowMs: START + 40 * DAY,
      memberships: [
        member({ endMs: START + 35 * DAY, open: false }),
        member({ clerkUserId: "user_b" }),
      ],
      hits: [
        { clerkUserId: "user_a", atMs: START + 3 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_a", atMs: START + 8 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_a", atMs: START + 36 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_b", atMs: START + 8 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_b", atMs: START + 36 * DAY, signal: "coaching_reply" },
      ],
      unavailableSignalIds: [],
    });
    expect(group(report, "Days 0–7", "coaching_reply", "Some")).toMatchObject({
      retained: 1,
      eligible: 1,
    });
    expect(group(report, "Days 0–7", "coaching_reply", "No activity")).toMatchObject({
      retained: 1,
      eligible: 1,
    });
    expect(group(report, "Days 0–7", "coaching_reply", "Frequent")).toBeUndefined();
  });

  it("counts early leavers separately and leaves them out of the inactive group", () => {
    const report = buildBehaviorRetention({
      population: "Monthly",
      nowMs: START + 40 * DAY,
      memberships: [
        member({ open: false, endMs: START + 4 * DAY }),
        member({ clerkUserId: "user_b" }),
      ],
      hits: [{ clerkUserId: "user_a", atMs: START + 2 * DAY, signal: "ask_pat" }],
      unavailableSignalIds: [],
    });
    const window = report.windows.find((item) => item.windowLabel === "Days 0–7");
    expect(window?.leftDuring).toBe(1);
    expect(group(report, "Days 0–7", "ask_pat", "No activity")).toMatchObject({
      eligible: 1,
      retained: 1,
    });
    expect(group(report, "Days 0–7", "ask_pat", "Some")).toBeUndefined();
  });

  it("leaves members who have not reached the later day out of the rate", () => {
    const report = buildBehaviorRetention({
      population: "Monthly",
      nowMs: START + 20 * DAY,
      memberships: [member()],
      hits: [{ clerkUserId: "user_a", atMs: START + DAY, signal: "goal_win" }],
      unavailableSignalIds: [],
    });
    const window = report.windows.find((item) => item.windowLabel === "Days 0–7");
    expect(window?.immature).toBe(1);
    expect(window?.outcomeLabel).toBe("Day 30");
    expect(signalRow(report, "Days 0–7", "goal_win")).toBeUndefined();
  });

  it("does not count a member who ended and paid again as still subscribed", () => {
    const report = buildBehaviorRetention({
      population: "Monthly",
      nowMs: START + 40 * DAY,
      memberships: [member({ open: false, endMs: START + 20 * DAY, hasLater: true })],
      hits: [],
      unavailableSignalIds: [],
    });
    expect(group(report, "Days 0–7", "coaching", "No activity")).toMatchObject({
      retained: 0,
      eligible: 1,
    });
  });

  it("splits frequency from the observed usage in that window", () => {
    const report = buildBehaviorRetention({
      population: "Monthly",
      nowMs: START + 40 * DAY,
      memberships: [
        member(),
        member({ clerkUserId: "user_b" }),
        member({ clerkUserId: "user_c", open: false, endMs: START + 20 * DAY }),
      ],
      hits: [
        { clerkUserId: "user_b", atMs: START + 2 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_c", atMs: START + DAY, signal: "coaching_reply" },
        { clerkUserId: "user_c", atMs: START + 2 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_c", atMs: START + 3 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_c", atMs: START + 4 * DAY, signal: "coaching_reply" },
      ],
      unavailableSignalIds: [],
    });
    const row = signalRow(report, "Days 0–7", "coaching_reply");
    expect(row?.definition).toContain("median 1");
    expect(group(report, "Days 0–7", "coaching_reply", "No activity")).toMatchObject({
      retained: 1,
      eligible: 1,
    });
    expect(group(report, "Days 0–7", "coaching_reply", "Some")).toMatchObject({
      retained: 1,
      eligible: 1,
    });
    expect(group(report, "Days 0–7", "coaching_reply", "Frequent")).toMatchObject({
      retained: 0,
      eligible: 1,
    });
    expect(row?.groups.every((item) => item.small)).toBe(true);
  });

  it("reports Victory Room before October 28, 2026 as unavailable, not zero", () => {
    const early = Date.parse("2026-06-01T00:00:00.000Z");
    const report = buildBehaviorRetention({
      population: "Monthly",
      nowMs: Date.parse("2026-08-15T00:00:00.000Z"),
      memberships: [member({ startMs: early })],
      hits: [],
      unavailableSignalIds: [],
    });
    const visit = signalRow(report, "Days 0–7", "victory_room_visited");
    expect(visit?.status).toBe("unavailable");
    expect(visit?.reason).toContain("not zero");
    expect(visit?.groups).toEqual([]);
  });

  it("does not turn a failed read into a zero-activity group", () => {
    const report = buildBehaviorRetention({
      population: "Monthly",
      nowMs: START + 40 * DAY,
      memberships: [member()],
      hits: [],
      unavailableSignalIds: ["coaching_reply"],
    });
    const row = signalRow(report, "Days 0–7", "coaching_reply");
    expect(row?.status).toBe("unavailable");
    expect(row?.reason).toContain("not zero");
    expect(group(report, "Days 0–7", "coaching_reply", "No activity")).toBeUndefined();
  });

  it("compares a decline only across two finished periods of the same length", () => {
    const nowMs = START + 130 * DAY;
    const report = buildBehaviorRetention({
      population: "Monthly",
      nowMs,
      memberships: [
        member(),
        member({ clerkUserId: "user_b" }),
        member({ clerkUserId: "user_c", open: false, endMs: START + 100 * DAY }),
        member({ clerkUserId: "user_d", open: false, endMs: START + 70 * DAY }),
      ],
      hits: [
        { clerkUserId: "user_a", atMs: START + 32 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_a", atMs: START + 33 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_a", atMs: START + 34 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_a", atMs: START + 62 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_b", atMs: START + 40 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_b", atMs: START + 41 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_b", atMs: START + 70 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_b", atMs: START + 71 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_c", atMs: START + 45 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_c", atMs: START + 65 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_c", atMs: START + 66 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_d", atMs: START + 32 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_d", atMs: START + 33 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_d", atMs: START + 34 * DAY, signal: "coaching_reply" },
        { clerkUserId: "user_d", atMs: START + 62 * DAY, signal: "coaching_reply" },
      ],
      unavailableSignalIds: [],
    });
    expect(report.disengagement.some((row) => row.priorLabel === "Days 0–7")).toBe(false);
    const replies = report.disengagement.find(
      (row) => row.signalId === "coaching_reply" && row.latestLabel === "Days 61–90"
    );
    expect(replies?.status).toBe("ready");
    expect(replies?.decreased).toMatchObject({ retained: 1, eligible: 1 });
    expect(replies?.unchanged).toMatchObject({ retained: 1, eligible: 1 });
    expect(replies?.increased).toMatchObject({ retained: 0, eligible: 1 });
    expect(replies?.sentence).toContain("1 of 1");
    expect(replies?.sentence).toContain("1 of 2");
  });

  it("does not call missing Victory Room history a decline", () => {
    const early = Date.parse("2026-06-01T00:00:00.000Z");
    const report = buildBehaviorRetention({
      population: "Monthly",
      nowMs: early + 200 * DAY,
      memberships: [member({ startMs: early })],
      hits: [],
      unavailableSignalIds: [],
    });
    const visit = report.disengagement.find((row) => row.signalId === "victory_room_visited");
    expect(visit?.status).toBe("unavailable");
    expect(visit?.reason).toContain("not zero");
    expect(visit?.decreased.eligible).toBe(0);
  });

  it("keeps monthly and annual apart and does not change headline retention", () => {
    const nowMs = Date.parse("2026-12-15T00:00:00.000Z");
    const start = nowMs - 100 * DAY;
    const spell = (patch: Partial<RetentionSpell> & Pick<RetentionSpell, "id" | "clerkUserId" | "interval">): RetentionSpell => ({
      paidStartMs: start,
      endedAtMs: null,
      endKnown: true,
      open: true,
      cancellationReason: null,
      trialStartMs: null,
      ...patch,
    });
    const base = {
      nowMs,
      partial: false,
      partialReason: null,
      withheld: null,
      activeWithoutPayment: 0,
      appleRows: 0,
      customerFeedbackCount: 0,
      engagementReadable: true,
      measuredSignals: [],
      acquisitionReadable: false,
      landingReadable: false,
      experimentReadable: false,
      acquisition: [],
    };
    const without = buildRetentionIntelligence({
      ...base,
      spells: [spell({ id: "m", clerkUserId: "user_m", interval: "month" })],
      hits: [],
    });
    const withVisit = buildRetentionIntelligence({
      ...base,
      spells: [
        spell({ id: "m", clerkUserId: "user_m", interval: "month" }),
        spell({ id: "y", clerkUserId: "user_y", interval: "year" }),
      ],
      hits: [
        { clerkUserId: "user_y", atMs: start + DAY, signal: "coaching_reply" },
        { clerkUserId: "user_m", atMs: start + DAY, signal: "victory_room_visited" },
      ],
    });
    expect(withVisit.milestones).toEqual(
      buildRetentionIntelligence({
        ...base,
        spells: [
          spell({ id: "m", clerkUserId: "user_m", interval: "month" }),
          spell({ id: "y", clerkUserId: "user_y", interval: "year" }),
        ],
        hits: [],
      }).milestones
    );
    expect(withVisit.annual).toEqual(
      buildRetentionIntelligence({
        ...base,
        spells: [
          spell({ id: "m", clerkUserId: "user_m", interval: "month" }),
          spell({ id: "y", clerkUserId: "user_y", interval: "year" }),
        ],
        hits: [],
      }).annual
    );
    expect(without.milestones[0]?.retained).toBe(1);
    expect(group(withVisit.monthlyBehavior, "Days 0–7", "coaching_reply", "No activity")?.eligible).toBe(1);
    expect(group(withVisit.annualBehavior, "Days 0–7", "coaching_reply", "Some")?.eligible).toBe(1);
    expect(group(withVisit.monthlyBehavior, "Days 0–7", "coaching_reply", "Some")).toBeUndefined();
    expect(signalRow(withVisit.monthlyBehavior, "Days 0–7", "victory_room_visited")?.status).toBe(
      "unavailable"
    );
  });
});
