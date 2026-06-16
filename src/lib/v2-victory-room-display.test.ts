import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { VictoryMomentCard } from "@/components/VictoryMomentCard";
import { resolveVictoryMomentCardDisplay } from "@/lib/v2-victory-room-display";
import {
  buildHomeDisplayWinsList,
  type VictoryMoment,
} from "@/lib/v2-victory-room-view";

function moment(partial: Partial<VictoryMoment> & Pick<VictoryMoment, "id">): VictoryMoment {
  return {
    occurredAt: "2026-06-07T12:00:00Z",
    headline: "Honest miss",
    body: "You stayed in the conversation instead of disappearing.",
    meaning: "You stayed in the conversation instead of disappearing.",
    groundedInEventTypes: ["user_partial"],
    ...partial,
  };
}

describe("resolveVictoryMomentCardDisplay", () => {
  it("uses meaning as primary for contextless quote on home", () => {
    const display = resolveVictoryMomentCardDisplay(
      moment({
        id: "good",
        quote: "Good",
        meaning: "You named the obstacle instead of hiding.",
        body: "You named the obstacle instead of hiding.",
        groundedInEventTypes: ["blocker_captured"],
      }),
      "home"
    );
    expect(display.showQuoteMarks).toBe(false);
    expect(display.primaryText).toBe("You named the obstacle instead of hiding.");
    expect(display.mutedReceiptText).toBeNull();
  });

  it("uses quoted primary for meaningful quote on home", () => {
    const display = resolveVictoryMomentCardDisplay(
      moment({
        id: "miss",
        quote: "I did not hit my goal yesterday",
        meaning: "You stayed in the conversation instead of disappearing.",
      }),
      "home"
    );
    expect(display.showQuoteMarks).toBe(true);
    expect(display.primaryText).toBe("I did not hit my goal yesterday");
    expect(display.secondaryText).toBe(
      "You stayed in the conversation instead of disappearing."
    );
  });

  it("shows muted receipt on All Proof for contextless quote", () => {
    const display = resolveVictoryMomentCardDisplay(
      moment({
        id: "good",
        quote: "Good",
        meaning: "You named the obstacle instead of hiding.",
        body: "You named the obstacle instead of hiding.",
      }),
      "allProof"
    );
    expect(display.primaryText).toBe("You named the obstacle instead of hiding.");
    expect(display.mutedReceiptText).toBe('Your reply: "Good"');
  });
});

describe("VictoryMomentCard resolved display", () => {
  it("does not render contextless quote as large hero text on home", () => {
    const display = resolveVictoryMomentCardDisplay(
      moment({
        id: "good",
        quote: "Good",
        meaning: "You named the obstacle instead of hiding.",
        body: "You named the obstacle instead of hiding.",
      }),
      "home"
    );
    const html = renderToStaticMarkup(
      React.createElement(VictoryMomentCard, {
        categoryLabel: "Told the truth",
        headline: "Honesty",
        body: display.primaryText,
        quote: "Good",
        meaning: display.primaryText,
        dateLabel: "Jun 7, 2026",
        groundedInEventTypes: ["blocker_captured"],
        primaryText: display.primaryText,
        secondaryText: display.secondaryText,
        showQuoteMarks: display.showQuoteMarks,
      })
    );
    expect(html).toContain("You named the obstacle instead of hiding.");
    expect(html).not.toContain("&ldquo;Good&rdquo;");
  });

  it("renders meaningful quote as hero text", () => {
    const display = resolveVictoryMomentCardDisplay(
      moment({
        id: "miss",
        quote: "I did not hit my goal yesterday",
        meaning: "You stayed in the conversation instead of disappearing.",
      }),
      "home"
    );
    const html = renderToStaticMarkup(
      React.createElement(VictoryMomentCard, {
        categoryLabel: "Told the truth",
        headline: "Honest miss",
        body: "You stayed in the conversation instead of disappearing.",
        quote: "I did not hit my goal yesterday",
        meaning: "You stayed in the conversation instead of disappearing.",
        dateLabel: "Jun 7, 2026",
        groundedInEventTypes: ["user_partial"],
        primaryText: display.primaryText,
        secondaryText: display.secondaryText,
        showQuoteMarks: display.showQuoteMarks,
      })
    );
    expect(html).toContain("I did not hit my goal yesterday");
    expect(html).toContain("You stayed in the conversation instead of disappearing.");
  });
});

describe("buildHomeDisplayWinsList", () => {
  const tz = "America/New_York";

  it("collapses same local date + same category to best representative", () => {
    const good = moment({
      id: "good",
      occurredAt: "2026-06-07T10:00:00Z",
      quote: "Good",
      meaning: "You named the obstacle instead of hiding.",
      body: "You named the obstacle instead of hiding.",
      headline: "Honesty",
      groundedInEventTypes: ["blocker_captured"],
    });
    const miss = moment({
      id: "miss",
      occurredAt: "2026-06-07T18:00:00Z",
      quote: "I did not hit my goal yesterday",
      meaning: "You stayed in the conversation instead of disappearing.",
      body: "You stayed in the conversation instead of disappearing.",
      headline: "Honest miss",
      groundedInEventTypes: ["user_partial"],
    });

    const wins = buildHomeDisplayWinsList([good, miss], { maxCards: 7, timeZone: tz });
    expect(wins).toHaveLength(1);
    expect(wins[0]!.id).toBe("miss");
  });

  it("keeps multiple categories on the same local date", () => {
    const truth = moment({
      id: "miss",
      occurredAt: "2026-06-07T18:00:00Z",
      quote: "I did not hit my goal yesterday",
      groundedInEventTypes: ["user_partial"],
    });
    const kept = moment({
      id: "yes",
      occurredAt: "2026-06-07T20:00:00Z",
      headline: "Kept your word",
      quote: "I hit the goal today",
      meaning: "You followed through when it counted.",
      body: "You followed through when it counted.",
      groundedInEventTypes: ["user_yes"],
    });

    const wins = buildHomeDisplayWinsList([truth, kept], { maxCards: 7, timeZone: tz });
    expect(wins).toHaveLength(2);
    expect(wins.map((w) => w.id)).toEqual(["yes", "miss"]);
  });

  it("caps at maxCards after cleanup", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      moment({
        id: `m-${i}`,
        occurredAt: `2026-06-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
        quote: `Proof line number ${i} with enough context`,
        groundedInEventTypes: ["user_yes"],
        headline: "Kept your word",
        meaning: "You followed through when it counted.",
        body: "You followed through when it counted.",
      })
    );
    const wins = buildHomeDisplayWinsList(rows, { maxCards: 7, timeZone: tz });
    expect(wins).toHaveLength(7);
  });

  it("groups by user local date across UTC midnight boundary", () => {
    const lateUtc = moment({
      id: "late",
      occurredAt: "2026-06-08T03:30:00Z",
      quote: "Good",
      meaning: "You named the obstacle instead of hiding.",
      body: "You named the obstacle instead of hiding.",
      groundedInEventTypes: ["blocker_captured"],
    });
    const eveningUtc = moment({
      id: "evening",
      occurredAt: "2026-06-08T01:00:00Z",
      quote: "I did not hit my goal yesterday",
      meaning: "You stayed in the conversation instead of disappearing.",
      groundedInEventTypes: ["user_partial"],
    });

    const wins = buildHomeDisplayWinsList([lateUtc, eveningUtc], {
      maxCards: 7,
      timeZone: "America/New_York",
    });
    expect(wins).toHaveLength(1);
    expect(wins[0]!.id).toBe("evening");
  });
});
