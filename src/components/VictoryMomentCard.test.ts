import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VictoryMomentCard } from "@/components/VictoryMomentCard";

describe("VictoryMomentCard (Phase 1 trust cleanup)", () => {
  it("renders headline/body/date but does not render internal grounding or event types", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryMomentCard, {
        categoryLabel: "Kept the Thread Alive",
        headline: "Stayed engaged",
        body: "You stayed engaged instead of disappearing.",
        dateLabel: "May 1, 2026",
        groundedInEventTypes: ["user_partial"],
      })
    );

    expect(html).toContain("Kept the Thread Alive");
    expect(html).not.toContain("Stayed engaged");
    expect(html).toContain("You stayed engaged instead of disappearing.");
    expect(html).toContain("May 1, 2026");

    expect(html).not.toContain("Grounded in spine");
    expect(html).not.toContain("user_partial");
    expect(html.toLowerCase()).not.toContain("came_back");
    expect(html.toLowerCase()).not.toContain("told_the_truth");
  });
});

