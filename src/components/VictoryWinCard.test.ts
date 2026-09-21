import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

import { VictoryWinCard } from "@/components/VictoryWinCard";

describe("VictoryWinCard", () => {
  it("renders title, body, date, and safe quote without category badges", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Owned the apology",
        displayBody: "You repaired the moment with honesty.",
        dateLabel: "Aug 1, 2026",
        supportingQuote: "I apologized today",
        celebrationAppropriate: true,
      })
    );

    expect(html).toContain("Owned the apology");
    expect(html).toContain("You repaired the moment with honesty.");
    expect(html).toContain("Aug 1, 2026");
    expect(html).toContain("I apologized today");
    expect(html).not.toContain("Kept the goal");
    expect(html).not.toContain("Told the truth");
    expect(html).not.toContain("Got back on track");
    expect(html).not.toContain("Share");
    expect(html).not.toContain("user_yes");
    expect(html).not.toContain("Win detected");
    expect(html).not.toContain("Goal Win");
    expect(html).not.toContain("Proud Moment");
    expect(html).not.toContain("<circle");
    expect(html).not.toContain("<path");
  });

  it("uses quieter styling and still omits quote when celebrationAppropriate is false", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Hard truth",
        displayBody: "You faced it without spinning.",
        dateLabel: "Aug 2, 2026",
        supportingQuote: null,
        celebrationAppropriate: false,
      })
    );

    expect(html).toContain("Hard truth");
    expect(html).toContain("border-white/12");
    expect(html).not.toContain("&ldquo;");
  });

  it("omits empty system body while still showing title, date, quote, and photo without actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Consistent Weight Lifting",
        displayBody: "",
        dateLabel: "Aug 1, 2026",
        supportingQuote: "I lifted weights again today!",
        celebrationAppropriate: true,
        media: {
          id: "media-1",
          cardUrl: "https://signed.example/card.jpg?token=abc",
          width: 1280,
          height: 960,
        },
        winId: "win-1",
        editHref: "/dashboard/victory-room/wins/win-1/edit",
        expectedUpdatedAt: "2026-08-01T12:05:00.000Z",
      })
    );

    expect(html).toContain("Consistent Weight Lifting");
    expect(html).toContain("Aug 1, 2026");
    expect(html).toContain("I lifted weights again today!");
    expect(html).toContain('src="https://signed.example/card.jpg?token=abc"');
    expect(html).not.toContain('aria-label="Proud Moment actions"');
    expect(html).not.toContain(">Edit<");
    expect(html).not.toContain(">Delete<");
    expect(html).not.toContain("mt-5");
    const imgIdx = html.indexOf("<img");
    const quoteIdx = html.indexOf("I lifted weights again today!");
    expect(imgIdx).toBeGreaterThan(-1);
    expect(quoteIdx).toBeGreaterThan(imgIdx);
    expect(html).not.toContain("Tyler, you lifted");
    expect(html).not.toContain("showing your commitment");
  });

  it("renders a Goal Win target icon and hidden type label", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Lifted Weights for 30 Minutes",
        displayBody: "You did the work.",
        dateLabel: "Aug 1, 2026",
        winKind: "goal_win",
      })
    );
    expect(html).toContain("Lifted Weights for 30 Minutes");
    expect(html).toContain("Aug 1, 2026");
    expect(html).toContain("You did the work.");
    expect(html).toContain("sr-only");
    expect(html).toContain("Goal Win");
    expect(html).toContain("<circle");
    expect(html).not.toContain("Proud Moment");
    expect(html).not.toContain("<path");
    expect(html).not.toContain("Kept the goal");
  });

  it("renders a Proud Moment star icon and hidden type label", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Rocky Caught His First Fish",
        displayBody: "A moment worth keeping.",
        dateLabel: "Aug 2, 2026",
        winKind: "proud_moment",
        supportingQuote: "he caught it",
        media: {
          id: "media-1",
          cardUrl: "https://signed.example/card.jpg",
          width: 100,
          height: 80,
        },
      })
    );
    expect(html).toContain("Rocky Caught His First Fish");
    expect(html).toContain("Aug 2, 2026");
    expect(html).toContain("A moment worth keeping.");
    expect(html).toContain("he caught it");
    expect(html).toContain('src="https://signed.example/card.jpg"');
    expect(html).toContain("Proud Moment");
    expect(html).toContain("<path");
    expect(html).not.toContain("Goal Win");
    expect(html).not.toContain("<circle");
    expect(html).not.toContain(">Edit<");
    expect(html).not.toContain(">Delete<");
  });

  it("omits type icon and hidden label when winKind is missing or null", () => {
    const omitted = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Owned the apology",
        displayBody: "You repaired the moment with honesty.",
        dateLabel: "Aug 1, 2026",
      })
    );
    const explicitNull = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Owned the apology",
        displayBody: "You repaired the moment with honesty.",
        dateLabel: "Aug 1, 2026",
        winKind: null,
      })
    );
    for (const html of [omitted, explicitNull]) {
      expect(html).toContain("Owned the apology");
      expect(html).not.toContain("Goal Win");
      expect(html).not.toContain("Proud Moment");
      expect(html).not.toContain("<circle");
      expect(html).not.toContain("<path");
    }
  });
});
