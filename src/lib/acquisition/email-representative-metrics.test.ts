import { describe, expect, it } from "vitest";

import { averageHours, buildEmailRepresentativeReport, resolvedWithoutTylerPercent } from "@/lib/acquisition/email-representative-metrics";

describe("email representative measurement", () => {
  it("averages completed manual answers and does not treat a draft as a caused trial", () => {
    expect(averageHours([
      { startedAt: "2026-10-26T10:00:00.000Z", resolvedAt: "2026-10-26T12:00:00.000Z" },
      { startedAt: "2026-10-26T10:00:00.000Z", resolvedAt: null },
    ])).toBe(2);
    expect(resolvedWithoutTylerPercent({ aiDrafts: 1, needsHuman: 3 })).toBe(25);
    expect(resolvedWithoutTylerPercent({ aiDrafts: 0, needsHuman: 0 })).toBeNull();
    const report = buildEmailRepresentativeReport({
      readable: true,
      knowledgeInstalled: false,
      interpretedReplies: 2,
      aiDrafts: 1,
      needsHuman: 1,
      outboundReplies: 2,
      manualOpen: 0,
      manualSent: 1,
      humanHours: [{ startedAt: "2026-10-26T10:10:16.829Z", resolvedAt: "2026-10-26T10:22:22.761Z" }],
      activeKnowledge: null,
      retiredKnowledge: null,
      repeatedTopics: [],
      recordedTrialStarts: 4,
      recordedPaidMembers: 1,
    });
    expect(report.resolvedWithoutTylerPercent).toBe(50);
    expect(report.leadershipKitAcceptance).toBeNull();
    expect(report.notes.join(" ")).toContain("not attributed");
    expect(report.notes.join(" ")).toContain("Leadership Kit acceptance is not an acquisition event");
  });
});
