import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VictoryChapterRecordSection } from "@/components/VictoryChapterRecordSection";

describe("VictoryChapterRecordSection (Phase 6 Chapter Record)", () => {
  it("renders title and early-user copy when no proof exists", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryChapterRecordSection, {
        chapterRecord: {
          openedAt: null,
          firstProofAt: null,
          latestProofAt: null,
          proofCategoryLabels: [],
          earlierSeasonCount: 0,
        },
        timeZone: "UTC",
      })
    );

    expect(html).toContain("Chapter record");
    expect(html).toContain("This is a real chapter");
    expect(html).toContain("Proof starts gathering as you answer real check-ins.");
  });

  it("renders dates, human labels, and does not render internal terms", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryChapterRecordSection, {
        chapterRecord: {
          openedAt: "2026-05-01T00:00:00Z",
          firstProofAt: "2026-05-02T10:00:00Z",
          latestProofAt: "2026-05-03T10:00:00Z",
          proofCategoryLabels: ["Told the truth", "Adjusted wisely", "Kept the goal"],
          earlierSeasonCount: 1,
        },
        timeZone: "UTC",
      })
    );

    expect(html).toContain("Opened");
    expect(html).toContain("First proof captured");
    expect(html).toContain("Latest proof captured");
    expect(html).toContain("Told the truth");
    expect(html).toContain("Adjusted wisely");
    expect(html).toContain("Kept the goal");
    expect(html).toContain("Earlier seasons are saved below.");

    const lower = html.toLowerCase();
    expect(lower).not.toContain("user_partial");
    expect(lower).not.toContain("came_back");
    expect(lower).not.toContain("event_type");
    expect(lower).not.toContain("payload_json");
    expect(lower).not.toContain("spine");
    expect(lower).not.toContain("streak");
    expect(lower).not.toContain("badge");
    expect(lower).not.toContain("score");
  });
});

