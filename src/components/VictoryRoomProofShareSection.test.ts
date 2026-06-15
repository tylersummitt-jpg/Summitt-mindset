import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VictoryRoomProofShareSection } from "@/components/VictoryRoomProofShareSection";

describe("VictoryRoomProofShareSection (Victory Card V1)", () => {
  it("renders a subtle Share affordance on every Recent Proof card", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRoomProofShareSection, {
        viewForShare: {
          hasActiveV2Commitment: true,
          profile: { preferred_name: "Brooke", identity_anchor_text: null },
          commitment: { id: "c1", title: "Morning writing", behavior_statement: null },
          activeSeason: null,
          effectiveCoachingAsk: "Write 20 minutes before noon.",
          chapterRecord: {
            openedAt: null,
            firstProofAt: null,
            latestProofAt: null,
            proofCategoryLabels: [],
            earlierSeasonCount: 0,
          },
          recentWins: [],
          moments: [],
          comebackLines: [],
          isDayZeroUser: false,
          hasSparseProof: false,
          evidenceCounts: {
            keptTheGoal: 0,
            toldTheTruth: 0,
            gotBackOnTrack: 0,
            adjustedWisely: 0,
            raisedTheBar: 0,
            seasonsCompleted: 0,
          },
          pastSeasons: [],
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

    expect(html.match(/>Share</g)?.length ?? 0).toBe(3);
    expect(html.match(/Share this Victory Card/g)?.length ?? 0).toBe(3);
    expect(html).not.toContain("Share this proof");
  });
});
