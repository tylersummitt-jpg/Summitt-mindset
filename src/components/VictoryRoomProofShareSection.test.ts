import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VictoryRoomProofShareSection } from "@/components/VictoryRoomProofShareSection";

describe("VictoryRoomProofShareSection (Phase 5 share CTA)", () => {
  it("renders only one share CTA on the first card", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRoomProofShareSection, {
        viewForShare: {
          hasActiveV2Commitment: true,
          profile: { preferred_name: "Brooke", identity_anchor_text: null },
          commitment: { id: "c1", title: "Morning writing" },
          effectiveCoachingAsk: "Write 20 minutes before noon.",
          chapterRecord: {
            openedAt: null,
            firstProofAt: null,
            latestProofAt: null,
            proofCategoryLabels: [],
            earlierSeasonCount: 0,
          },
          moments: [],
          comebackLines: [],
          optionalMemoryProjectionLine: null,
          archiveMoments: [],
          priorChapters: [],
          cornerstoneMoments: [],
          share_identity_line: "Brooke",
        },
        moments: [
          {
            id: "m1",
            categoryLabel: "Told the Truth",
            headline: "Honesty",
            body: "You got honest and stayed in it.",
            dateLabel: "May 4, 2026",
            groundedInEventTypes: [],
          },
          {
            id: "m2",
            categoryLabel: "Kept the Thread Alive",
            headline: "Stayed engaged",
            body: "You stayed engaged instead of disappearing.",
            dateLabel: "May 3, 2026",
            groundedInEventTypes: [],
          },
          {
            id: "m3",
            categoryLabel: "Showed Up",
            headline: "Kept your word",
            body: "You followed through on the bar today.",
            dateLabel: "May 2, 2026",
            groundedInEventTypes: [],
          },
        ],
      })
    );

    // Only one share CTA should appear in the list.
    expect(html.match(/Share this proof/g)?.length ?? 0).toBe(1);

    // The first card should include the share CTA; later cards should not.
    const firstIndex = html.indexOf("You got honest and stayed in it.");
    const shareIndex = html.indexOf("Share this proof");
    const secondIndex = html.indexOf("You stayed engaged instead of disappearing.");
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(shareIndex).toBeGreaterThan(firstIndex);
    expect(secondIndex).toBeGreaterThan(shareIndex);
  });
});

