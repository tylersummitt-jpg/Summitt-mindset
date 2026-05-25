import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VictoryEarlierHistoryIndexSection } from "@/components/VictoryEarlierHistoryIndexSection";
import type { EarlierChapterIndexRow } from "@/lib/v2-victory-earlier-chapter-index";

function row(overrides: Partial<EarlierChapterIndexRow> = {}): EarlierChapterIndexRow {
  return {
    commitmentId: "c1",
    title: "Morning walk",
    status: "completed",
    statusLabel: "Completed",
    rangeLabel: "Jan 1, 2025 — Jun 1, 2025",
    linkTarget: "chapter",
    seasonId: null,
    detailHref: "/dashboard/victory-room/chapters/c1",
    linkLabel: "View chapter proof",
    ...overrides,
  };
}

describe("VictoryEarlierHistoryIndexSection", () => {
  it("renders empty state when no chapters", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryEarlierHistoryIndexSection, { chapters: [] })
    );
    expect(html).toContain("No earlier chapters");
    expect(html).toContain("My Seasons");
  });

  it("chapter card uses chapter link label without season wording", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryEarlierHistoryIndexSection, {
        chapters: [row()],
      })
    );
    expect(html).toContain("Earlier chapters");
    expect(html).toContain("View chapter proof");
    expect(html).toContain("Completed");
    expect(html).not.toMatch(/proof moments/i);
  });

  it("season-linked card uses season proof link", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryEarlierHistoryIndexSection, {
        chapters: [
          row({
            linkTarget: "season",
            seasonId: "s1",
            detailHref: "/dashboard/victory-room/seasons/s1",
            linkLabel: "View season proof",
          }),
        ],
      })
    );
    expect(html).toContain("View season proof");
    expect(html).toContain("/dashboard/victory-room/seasons/s1");
  });

  it("shows superseded status label", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryEarlierHistoryIndexSection, {
        chapters: [
          row({
            status: "superseded",
            statusLabel: "Moved to a new standard",
          }),
        ],
      })
    );
    expect(html).toContain("Moved to a new standard");
  });
});
