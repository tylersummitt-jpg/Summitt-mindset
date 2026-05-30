import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VictoryMomentCard } from "@/components/VictoryMomentCard";

describe("VictoryMomentCard (Phase 1 trust cleanup)", () => {
  it("renders category/date but does not render internal grounding or event types", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryMomentCard, {
        categoryLabel: "Kept the goal",
        headline: "Stayed engaged",
        body: "You stayed in the conversation instead of disappearing.",
        dateLabel: "May 1, 2026",
        groundedInEventTypes: ["user_partial"],
      })
    );

    expect(html).toContain("Kept the goal");
    expect(html).not.toContain("Stayed engaged");
    expect(html).toContain("You stayed in the conversation instead of disappearing.");
    expect(html).toContain("May 1, 2026");

    expect(html).not.toContain("Grounded in spine");
    expect(html).not.toContain("user_partial");
    expect(html.toLowerCase()).not.toContain("came_back");
    expect(html.toLowerCase()).not.toContain("told_the_truth");
  });

  it("renders quote with quotation marks and meaning beneath when quote exists", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryMomentCard, {
        categoryLabel: "Kept the goal",
        headline: "Proof in the thread",
        body: "You followed through when it counted.",
        quote: "yes",
        meaning: "You followed through when it counted.",
        dateLabel: "May 2, 2026",
        groundedInEventTypes: ["user_yes"],
      })
    );

    expect(html).toContain("“yes”");
    expect(html).toContain("You followed through when it counted.");
  });

  it("meaning-only legacy card still works when quote is absent", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryMomentCard, {
        categoryLabel: "Told the truth",
        headline: "Honest miss",
        body: "Honest no still counts as showing up.",
        dateLabel: "May 3, 2026",
        groundedInEventTypes: ["user_no"],
      })
    );

    expect(html).not.toContain("&ldquo;");
    expect(html).toContain("Honest no still counts as showing up.");
  });
});
