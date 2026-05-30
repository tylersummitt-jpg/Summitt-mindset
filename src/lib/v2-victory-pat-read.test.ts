import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { buildDeterministicPatRead, buildNextMoveCopy } from "@/lib/v2-victory-pat-read";
import type { VictoryRoomViewData } from "@/lib/v2-victory-room-view";
import { EMPTY_VICTORY_EVIDENCE_COUNTS } from "@/lib/v2-victory-room-view";

function baseView(overrides: Partial<VictoryRoomViewData> = {}): VictoryRoomViewData {
  return {
    hasActiveV2Commitment: true,
    profile: { preferred_name: "Alex", identity_anchor_text: "I lead with calm courage." },
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

describe("buildDeterministicPatRead", () => {
  it("renders strength and next move for sparse users without repeating the goal", () => {
    const read = buildDeterministicPatRead(baseView(), "Alex");
    expect(read).not.toBeNull();
    expect(read!.provenance).toBe("deterministic");
    expect(read!.strength.length).toBeGreaterThan(10);
    expect(read!.nextMove.length).toBeGreaterThan(10);
    expect(read!.nextMove.toLowerCase()).toContain("check-in");
    expect(read!.nextMove).not.toContain("Walk before breakfast");
    expect(read!.nextMove).not.toContain("Walk 20 minutes");
    expect(read!.pattern).toBeNull();
  });

  it("next move for rich proof does not repeat the full behavior statement", () => {
    const read = buildDeterministicPatRead(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Kept your word",
            body: "You followed through today.",
            groundedInEventTypes: ["user_yes"],
          },
        ],
      }),
      "Alex"
    );
    expect(read!.nextMove.length).toBeGreaterThan(10);
    expect(read!.nextMove).not.toContain("Walk before breakfast");
    expect(read!.nextMove).not.toContain("Walk 20 minutes");
    expect(read!.nextMove.toLowerCase()).toContain("standard");
  });

  it("next move after honesty proof coaches forward without repeating the goal", () => {
    const read = buildDeterministicPatRead(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Honesty",
            body: "You got honest and stayed in it.",
            groundedInEventTypes: ["user_no", "user_yes"],
          },
        ],
      }),
      "Alex"
    );
    expect(read!.nextMove.length).toBeGreaterThan(10);
    expect(read!.nextMove).not.toContain("Walk before breakfast");
    expect(read!.nextMove.toLowerCase()).toMatch(/truth|check-in|conversation/);
  });

  it("next move may reference adaptive ask when it differs from base goal", () => {
    const adaptiveAsk = "Ten minutes only, not twenty.";
    const read = buildDeterministicPatRead(
      baseView({
        commitment: { id: "c1", title: "Morning walk", behavior_statement: "Walk 20 minutes." },
        effectiveCoachingAsk: adaptiveAsk,
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Bar adjusted",
            body: "You tightened the standard honestly.",
            groundedInEventTypes: ["user_yes"],
          },
        ],
      }),
      "Alex"
    );
    expect(read!.nextMove).toContain(adaptiveAsk);
    expect(read!.nextMove.toLowerCase()).toContain("adjustment");
  });
});

describe("buildNextMoveCopy", () => {
  it("returns sparse-state coaching without echoing the goal", () => {
    const view = baseView();
    const copy = buildNextMoveCopy(view, {
      address_as: "Alex",
      preferred_name: "Alex",
      identity_anchor_text: "I lead with calm courage.",
      effective_ask: "Walk before breakfast.",
      commitment_title: "Morning walk",
      moments: [],
      comeback_lines: [],
      sparse: true,
      input_contains_digit: false,
    });
    expect(copy).not.toContain("Walk before breakfast");
    expect(copy.toLowerCase()).toContain("check-in");
  });
});

describe("buildDeterministicPatRead patterns and copy guardrails", () => {
  it("omits pattern when only one weak signal exists", () => {
    const read = buildDeterministicPatRead(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Kept your word",
            body: "You kept your word here.",
            groundedInEventTypes: ["user_yes"],
          },
        ],
      }),
      "Alex"
    );
    expect(read!.pattern).toBeNull();
  });

  it("includes pattern when two moments share a category", () => {
    const read = buildDeterministicPatRead(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Honesty",
            body: "You got honest and stayed in it.",
            groundedInEventTypes: ["user_no", "user_yes"],
          },
          {
            id: "m2",
            occurredAt: "2026-05-03T10:00:00Z",
            headline: "Honest miss",
            body: "You named the miss plainly.",
            groundedInEventTypes: ["user_no"],
          },
        ],
      }),
      "Alex"
    );
    expect(read!.pattern).not.toBeNull();
    expect(read!.pattern!.toLowerCase()).toContain("pattern");
    expect(read!.pattern!.toLowerCase()).not.toContain("streak");
  });

  it("does not use streak wording in user-visible copy", () => {
    const read = buildDeterministicPatRead(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Honesty",
            body: "You got honest and stayed in it.",
            groundedInEventTypes: ["user_no", "user_yes"],
          },
          {
            id: "m2",
            occurredAt: "2026-05-03T10:00:00Z",
            headline: "Honesty",
            body: "You named the miss plainly.",
            groundedInEventTypes: ["user_no"],
          },
        ],
      }),
      "Alex"
    );
    const blob = `${read!.strength} ${read!.pattern ?? ""} ${read!.nextMove}`.toLowerCase();
    expect(blob).not.toContain("streak");
  });

  it("does not use fake Pat quote language", () => {
    const read = buildDeterministicPatRead(baseView(), "Alex");
    const blob = `${read!.strength} ${read!.nextMove} ${read!.pattern ?? ""}`.toLowerCase();
    expect(blob).not.toContain("pat said");
    expect(blob).not.toContain("coach pat said");
  });
});
