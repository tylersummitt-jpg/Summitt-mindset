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

  it("omits empty system body while still showing title, date, quote, photo, and menu", () => {
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
        hasMedia: true,
        mediaId: "media-1",
      })
    );

    expect(html).toContain("Consistent Weight Lifting");
    expect(html).toContain("Aug 1, 2026");
    expect(html).toContain("I lifted weights again today!");
    expect(html).toContain('src="https://signed.example/card.jpg?token=abc"');
    expect(html).toContain('aria-label="Win actions"');
    const imgIdx = html.indexOf("<img");
    const quoteIdx = html.indexOf("I lifted weights again today!");
    expect(imgIdx).toBeGreaterThan(-1);
    expect(quoteIdx).toBeGreaterThan(imgIdx);
    expect(html).not.toContain("Tyler, you lifted");
    expect(html).not.toContain("showing your commitment");
  });
});
