import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VictoryEarlierHistoryLinkSection } from "@/components/VictoryEarlierHistoryLinkSection";

const GAMIFICATION = /\b(achievement|badge|streak|leaderboard|points)\b/i;

describe("VictoryEarlierHistoryLinkSection", () => {
  it("renders nothing when hasEarlierHistory is false", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryEarlierHistoryLinkSection, { hasEarlierHistory: false })
    );
    expect(html).toBe("");
  });

  it("renders link section without numeric proof counts", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryEarlierHistoryLinkSection, { hasEarlierHistory: true })
    );
    expect(html).toContain("Earlier Chapters");
    expect(html).toContain("View earlier chapters");
    expect(html).toContain("/dashboard/victory-room/history");
    expect(html).not.toMatch(/proof moments saved/i);
    expect(html).not.toMatch(/\b0 proof\b/i);
    expect(html).not.toMatch(GAMIFICATION);
    expect(html).not.toMatch(/Pat said/i);
  });
});
