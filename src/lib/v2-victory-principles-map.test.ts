import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));
import { buildDeterministicPrinciplesFromView } from "@/lib/v2-victory-principles-map";
import type { VictoryRoomViewData } from "@/lib/v2-victory-room-view";
import { EMPTY_VICTORY_EVIDENCE_COUNTS } from "@/lib/v2-victory-room-view";

function baseView(overrides: Partial<VictoryRoomViewData> = {}): VictoryRoomViewData {
  return {
    hasActiveV2Commitment: true,
    profile: { preferred_name: "Alex", identity_anchor_text: "Calm courage." },
    commitment: { id: "c1", title: "Morning walk", behavior_statement: "Walk 20 minutes." },
    activeSeason: { season_name: "Season 1", started_at: "2026-05-01T00:00:00Z" },
    effectiveCoachingAsk: "Walk before breakfast.",
    chapterRecord: {
      openedAt: "2026-05-01T00:00:00Z",
      firstProofAt: null,
      latestProofAt: null,
      proofCategoryLabels: [],
      earlierSeasonCount: 0,
    },
    moments: [],
    comebackLines: [],
    isDayZeroUser: true,
    hasSparseProof: true,
    evidenceCounts: EMPTY_VICTORY_EVIDENCE_COUNTS,
    pastSeasons: [],
    optionalMemoryProjectionLine: null,
    archiveMoments: [],
    priorChapters: [],
    cornerstoneMoments: [],
    ...overrides,
  };
}

const GAMIFICATION = /\b(achievement|badge|unlocked|level|score|streak|leaderboard|points)\b/i;

function allCopy(result: ReturnType<typeof buildDeterministicPrinciplesFromView>): string {
  return [
    result.starterText ?? "",
    result.livingWell?.text ?? "",
    result.livingWell?.title ?? "",
    result.focusNext.text,
    result.focusNext.title,
  ].join(" ");
}

describe("v2-victory-principles-map", () => {
  it("no proof -> starter state", () => {
    const result = buildDeterministicPrinciplesFromView(baseView());
    expect(result.confidence).toBe("starter");
    expect(result.starterText).toContain("tell the truth");
    expect(result.livingWell).toBeNull();
    expect(result.focusNext.title).toBeTruthy();
  });

  it("low proof -> focus next only", () => {
    const result = buildDeterministicPrinciplesFromView(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: true,
        moments: [
          {
            id: "composite:honesty:1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Honesty",
            body: "You named the miss.",
            groundedInEventTypes: [],
          },
        ],
        evidenceCounts: { ...EMPTY_VICTORY_EVIDENCE_COUNTS, toldTheTruth: 1 },
      })
    );
    expect(result.livingWell).toBeNull();
    expect(result.focusNext.text).toMatch(/Early proof is forming/i);
  });

  it("living well not shown without evidence IDs", () => {
    const result = buildDeterministicPrinciplesFromView(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        comebackLines: ["You came back after silence."],
        evidenceCounts: { ...EMPTY_VICTORY_EVIDENCE_COUNTS, gotBackOnTrack: 1 },
      })
    );
    if (result.livingWell) {
      expect(result.livingWell.evidenceIds.length).toBeGreaterThan(0);
    }
  });

  it("kept-goal alone needs 3 separate moments before Living Well", () => {
    const twoKept = buildDeterministicPrinciplesFromView(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m1",
            occurredAt: "2026-05-01T10:00:00Z",
            headline: "Kept your word",
            body: "Showed up.",
            groundedInEventTypes: [],
          },
          {
            id: "m2",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Proof in the thread",
            body: "Stayed with it.",
            groundedInEventTypes: [],
          },
        ],
        evidenceCounts: { ...EMPTY_VICTORY_EVIDENCE_COUNTS, keptTheGoal: 2 },
      })
    );
    expect(twoKept.livingWell).toBeNull();

    const threeKept = buildDeterministicPrinciplesFromView(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m1",
            occurredAt: "2026-05-01T10:00:00Z",
            headline: "Kept your word",
            body: "Showed up.",
            groundedInEventTypes: [],
          },
          {
            id: "m2",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Proof in the thread",
            body: "Stayed with it.",
            groundedInEventTypes: [],
          },
          {
            id: "m3",
            occurredAt: "2026-05-03T10:00:00Z",
            headline: "Stayed engaged",
            body: "Kept the thread alive.",
            groundedInEventTypes: [],
          },
        ],
        evidenceCounts: { ...EMPTY_VICTORY_EVIDENCE_COUNTS, keptTheGoal: 3 },
      })
    );
    if (threeKept.livingWell) {
      expect(threeKept.livingWell.evidenceIds.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("told-the-truth maps toward Take Full Responsibility / Great Communicator", () => {
    const result = buildDeterministicPrinciplesFromView(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "composite:honesty:1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Honesty",
            body: "You told the truth about the miss.",
            groundedInEventTypes: [],
          },
          {
            id: "composite:honesty:2",
            occurredAt: "2026-05-03T10:00:00Z",
            headline: "Honest miss",
            body: "Named it early.",
            groundedInEventTypes: [],
          },
        ],
        evidenceCounts: { ...EMPTY_VICTORY_EVIDENCE_COUNTS, toldTheTruth: 2 },
      })
    );
    const titles = [result.livingWell?.title, result.focusNext.title].filter(Boolean);
    expect(
      titles.some((t) =>
        ["Take Full Responsibility", "Learn to Be a Great Communicator"].includes(t!)
      )
    ).toBe(true);
  });

  it("got-back-on-track maps toward Be a Competitor / Handle Success", () => {
    const result = buildDeterministicPrinciplesFromView(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "composite:reactivation_yes:1",
            occurredAt: "2026-05-04T10:00:00Z",
            headline: "Comeback",
            body: "You got back on track.",
            groundedInEventTypes: [],
          },
          {
            id: "composite:reactivation_yes:2",
            occurredAt: "2026-05-05T10:00:00Z",
            headline: "Comeback",
            body: "Stayed in the fight.",
            groundedInEventTypes: [],
          },
        ],
        evidenceCounts: { ...EMPTY_VICTORY_EVIDENCE_COUNTS, gotBackOnTrack: 2 },
      })
    );
    const titles = [result.livingWell?.title, result.focusNext.title].filter(Boolean);
    expect(
      titles.some((t) =>
        ["Be a Competitor", "Handle Success Like You Handle Failure"].includes(t!)
      )
    ).toBe(true);
  });

  it("adjusted-wisely maps toward Work Smart / Change Is a Must", () => {
    const result = buildDeterministicPrinciplesFromView(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "composite:decline_activate:1",
            occurredAt: "2026-05-04T10:00:00Z",
            headline: "Honest adjustment",
            body: "You adjusted wisely.",
            groundedInEventTypes: [],
          },
          {
            id: "composite:decline_activate:2",
            occurredAt: "2026-05-05T10:00:00Z",
            headline: "Alignment",
            body: "You changed the plan honestly.",
            groundedInEventTypes: [],
          },
        ],
        evidenceCounts: { ...EMPTY_VICTORY_EVIDENCE_COUNTS, adjustedWisely: 2 },
      })
    );
    const titles = [result.livingWell?.title, result.focusNext.title].filter(Boolean);
    expect(
      titles.some((t) =>
        ["Don’t Just Work Hard, Work Smart", "Change Is a Must"].includes(t!)
      )
    ).toBe(true);
  });

  it("raised-the-bar maps toward Be a Competitor / Winning Attitude", () => {
    const result = buildDeterministicPrinciplesFromView(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m-bar",
            occurredAt: "2026-05-04T10:00:00Z",
            headline: "Bar adjusted",
            body: "You raised the bar.",
            groundedInEventTypes: [],
          },
          {
            id: "m-bar-2",
            occurredAt: "2026-05-05T10:00:00Z",
            headline: "Bar adjusted",
            body: "You raised it again.",
            groundedInEventTypes: [],
          },
        ],
        evidenceCounts: { ...EMPTY_VICTORY_EVIDENCE_COUNTS, raisedTheBar: 2 },
      })
    );
    const titles = [result.livingWell?.title, result.focusNext.title].filter(Boolean);
    expect(
      titles.some((t) => ["Be a Competitor", "Make Winning an Attitude"].includes(t!))
    ).toBe(true);
  });

  it("avoids same principle twice when both cards show", () => {
    const result = buildDeterministicPrinciplesFromView(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "composite:honesty:1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Honesty",
            body: "Truth one.",
            groundedInEventTypes: [],
          },
          {
            id: "composite:honesty:2",
            occurredAt: "2026-05-03T10:00:00Z",
            headline: "Honest miss",
            body: "Truth two.",
            groundedInEventTypes: [],
          },
          {
            id: "composite:reactivation_yes:1",
            occurredAt: "2026-05-04T10:00:00Z",
            headline: "Comeback",
            body: "Back on track.",
            groundedInEventTypes: [],
          },
        ],
        evidenceCounts: {
          ...EMPTY_VICTORY_EVIDENCE_COUNTS,
          toldTheTruth: 2,
          gotBackOnTrack: 1,
        },
      })
    );
    if (result.livingWell) {
      expect(result.focusNext.title).not.toBe(result.livingWell.title);
    }
  });

  it("generated copy avoids gamification words", () => {
    const result = buildDeterministicPrinciplesFromView(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "composite:honesty:1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Honesty",
            body: "Proof.",
            groundedInEventTypes: [],
          },
          {
            id: "composite:reactivation_yes:1",
            occurredAt: "2026-05-04T10:00:00Z",
            headline: "Comeback",
            body: "Back.",
            groundedInEventTypes: [],
          },
        ],
        evidenceCounts: {
          ...EMPTY_VICTORY_EVIDENCE_COUNTS,
          toldTheTruth: 1,
          gotBackOnTrack: 1,
        },
      })
    );
    expect(allCopy(result)).not.toMatch(GAMIFICATION);
  });
});
