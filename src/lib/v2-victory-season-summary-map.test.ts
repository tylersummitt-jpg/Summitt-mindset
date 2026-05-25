import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import {
  buildDeterministicSeasonSummary,
  seasonSummaryThresholdMet,
} from "@/lib/v2-victory-season-summary-map";
import type { VictoryMoment } from "@/lib/v2-victory-room-view";

function moment(id: string, headline: string, body: string): VictoryMoment {
  return {
    id,
    occurredAt: "2026-05-02T10:00:00Z",
    headline,
    body,
    groundedInEventTypes: [],
  };
}

describe("v2-victory-season-summary-map", () => {
  it("active season never gets summary", () => {
    const r = buildDeterministicSeasonSummary({
      seasonStatus: "active",
      proofMoments: [moment("m1", "Honesty", "Truth")],
      proofMomentCount: 1,
      patternText: "A pattern",
      patternConfidence: "high",
      principleLivedTitle: "Take Full Responsibility",
    });
    expect(r.summaryText).toBeNull();
  });

  it("completed season with no proof gets null summary", () => {
    const r = buildDeterministicSeasonSummary({
      seasonStatus: "completed",
      proofMoments: [],
      proofMomentCount: 0,
      patternText: null,
      patternConfidence: "none",
      principleLivedTitle: null,
    });
    expect(r.summaryText).toBeNull();
    expect(r.confidence).toBe("none");
  });

  it("completed season with one proof gets null summary", () => {
    const r = buildDeterministicSeasonSummary({
      seasonStatus: "completed",
      proofMoments: [moment("m1", "Honesty", "Named the miss.")],
      proofMomentCount: 1,
      patternText: null,
      patternConfidence: "none",
      principleLivedTitle: null,
    });
    expect(r.summaryText).toBeNull();
  });

  it("requires 3 moments or 2 categories plus non-kept-goal", () => {
    const twoKept = [
      moment("m1", "Kept your word", "A"),
      moment("m2", "Proof in the thread", "B"),
    ];
    expect(seasonSummaryThresholdMet(twoKept)).toBe(false);

    const threeKept = [...twoKept, moment("m3", "Stayed engaged", "C")];
    expect(seasonSummaryThresholdMet(threeKept)).toBe(true);

    const mixed = [
      moment("m1", "Honesty", "Truth"),
      moment("m2", "Comeback", "Back"),
    ];
    expect(seasonSummaryThresholdMet(mixed)).toBe(true);
  });

  it("completed season with enough proof gets deterministic summary", () => {
    const r = buildDeterministicSeasonSummary({
      seasonStatus: "completed",
      proofMoments: [
        moment("m1", "Honesty", "You told the truth."),
        moment("m2", "Comeback", "You got back on track."),
        moment("m3", "Bar adjusted", "You raised the bar."),
      ],
      proofMomentCount: 3,
      patternText: null,
      patternConfidence: "none",
      principleLivedTitle: null,
    });
    expect(r.summaryText).toMatch(/This season saved proof/);
    expect(r.summaryText).not.toMatch(/Pat said/i);
    expect(r.summaryText).not.toMatch(/mastered/i);
    expect(r.confidence).toBe("medium");
  });

  it("pattern and principle stay separate from summary_text (no duplicate lines)", () => {
    const r = buildDeterministicSeasonSummary({
      seasonStatus: "archived",
      proofMoments: [
        moment("m1", "Honesty", "A"),
        moment("m2", "Comeback", "B"),
        moment("m3", "Honest adjustment", "C"),
      ],
      proofMomentCount: 3,
      patternText: "You keep telling the truth early.",
      patternConfidence: "high",
      principleLivedTitle: "Take Full Responsibility",
    });
    expect(r.patternText).toContain("telling the truth");
    expect(r.principleLivedTitle).toBe("Take Full Responsibility");
    expect(r.summaryText).toMatch(/This season saved proof/);
    expect(r.summaryText).not.toContain("steady pattern");
    expect(r.summaryText).not.toMatch(/Coach Pat/i);
    expect(r.summaryText).not.toMatch(/Take Full Responsibility/);
  });

});
