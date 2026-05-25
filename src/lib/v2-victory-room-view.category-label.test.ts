import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import {
  getRecentProofCategoryLabel,
  type VictoryMoment,
} from "@/lib/v2-victory-room-view";

function moment(partial: Partial<VictoryMoment> & { id: string; headline: string; body: string }): VictoryMoment {
  return {
    id: partial.id,
    occurredAt: partial.occurredAt ?? "2026-05-01T10:00:00Z",
    headline: partial.headline,
    body: partial.body,
    groundedInEventTypes: partial.groundedInEventTypes ?? [],
  };
}

describe("getRecentProofCategoryLabel (Phase 3)", () => {
  it("maps composite honesty to Told the Truth", () => {
    const m = moment({
      id: "composite:honesty:abc",
      headline: "Honesty",
      body: "You got honest and stayed in it.",
    });
    expect(getRecentProofCategoryLabel(m)).toBe("Told the truth");
  });

  it("maps Stayed engaged to Kept the Thread Alive", () => {
    const m = moment({
      id: "p1",
      headline: "Stayed engaged",
      body: "You stayed engaged instead of disappearing.",
    });
    expect(getRecentProofCategoryLabel(m)).toBe("Kept the goal");
  });

  it("maps reactivation comeback to Came Back", () => {
    const m = moment({
      id: "composite:reactivation_yes:xyz",
      headline: "Comeback",
      body: "You came back here.",
    });
    expect(getRecentProofCategoryLabel(m)).toBe("Got back on track");
  });

  it("maps Honest adjustment to Adjusted Wisely", () => {
    const m = moment({
      id: "m1",
      headline: "Honest adjustment",
      body: "You tightened the bar instead of quitting.",
    });
    expect(getRecentProofCategoryLabel(m)).toBe("Adjusted wisely");
  });

  it("maps New chapter to Finished a Chapter", () => {
    const m = moment({
      id: "m1",
      headline: "New chapter",
      body: "You named the next honest commitment instead of drifting.",
    });
    expect(getRecentProofCategoryLabel(m)).toBe("Named the next goal");
  });

  it("maps Bar adjusted to Raised the bar", () => {
    const m = moment({
      id: "m1",
      headline: "Bar adjusted",
      body: "You adjusted the bar with honesty.",
    });
    expect(getRecentProofCategoryLabel(m)).toBe("Raised the bar");
  });

  it("maps Kept your word to Kept the goal", () => {
    const m = moment({
      id: "m1",
      headline: "Kept your word",
      body: "You kept your word here.",
    });
    expect(getRecentProofCategoryLabel(m)).toBe("Kept the goal");
  });

  it("never returns internal enum strings", () => {
    const m = moment({
      id: "unknown",
      headline: "Something else",
      body: "Some proof line.",
    });
    const label = getRecentProofCategoryLabel(m);
    const forbidden = [
      "came_back",
      "told_the_truth",
      "adjusted_wisely",
      "finished_a_chapter",
      "showed_up",
      "kept_the_thread_alive",
    ];
    for (const term of forbidden) {
      expect(label.toLowerCase()).not.toContain(term);
    }
  });
});

