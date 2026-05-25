import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VictoryEvolutionNudgeSection } from "@/components/VictoryEvolutionNudgeSection";

const INTERNAL_TERMS =
  /\b(reframe_commitment|refresh_commitment_only|recommendationId|confidence|algorithm|evolution engine|score|badge|streak)\b/i;

describe("VictoryEvolutionNudgeSection", () => {
  it("renders nothing when nudge is null", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryEvolutionNudgeSection, { nudge: null })
    );
    expect(html).toBe("");
  });

  it("renders headline, body, and review link without action buttons", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryEvolutionNudgeSection, {
        nudge: {
          headline: "Coach Pat has a recommendation",
          body: "There may be a better way to hold this standard. Review the recommendation.",
          href: "/dashboard",
        },
      })
    );

    expect(html).toContain("Coach Pat has a recommendation");
    expect(html).toContain("Review the recommendation");
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain("Review recommendation");
    expect(html).not.toContain("Daily OS");
    expect(html).not.toContain("Open dashboard");
    expect(html).not.toMatch(/accept|dismiss/i);
    expect(html).not.toMatch(INTERNAL_TERMS);
  });
});
