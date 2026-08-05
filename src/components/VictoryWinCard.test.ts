import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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
});
