import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { VictoryAllProofSection } from "@/components/VictoryAllProofSection";

describe("VictoryAllProofSection", () => {
  it("renders All Wins title and back link without share or old proof language", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryAllProofSection, {
        wins: [
          {
            id: "m1",
            occurredAt: "2026-06-15T12:00:00Z",
            displayTitle: "Showed up",
            displayBody: "You followed through when it counted.",
            supportingQuote: null,
            celebrationAppropriate: true,
            commitmentId: "c1",
          },
        ],
        timeZone: "America/New_York",
        hasMore: false,
        nextCursor: null,
      })
    );
    expect(html).toContain("All Wins");
    expect(html).not.toContain("All Proof");
    expect(html).toContain("← Victory Room");
    expect(html).toContain("/dashboard/victory-room");
    expect(html).toContain("Add a Win");
    expect(html).toContain("/dashboard/victory-room/add-win?from=all-wins");
    expect(html).toContain("Showed up");
    expect(html).toContain("Edit");
    expect(html).toContain("/dashboard/victory-room/wins/m1/edit?from=all-wins");
    expect(html).not.toContain("Every saved proof moment");
    expect(html).not.toContain("Share");
    expect(html).not.toContain("Kept the goal");
  });

  it("shows View older Wins when hasMore and nextCursor are set", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryAllProofSection, {
        wins: [
          {
            id: "m1",
            occurredAt: "2026-06-15T12:00:00Z",
            displayTitle: "Showed up",
            displayBody: "You followed through when it counted.",
            supportingQuote: null,
            celebrationAppropriate: true,
            commitmentId: null,
          },
        ],
        timeZone: "UTC",
        hasMore: true,
        nextCursor: "cursor-token",
      })
    );
    expect(html).toContain("View older Wins");
    expect(html).toContain("/dashboard/victory-room/all-proof?cursor=");
    expect(html).not.toContain("Showing your most recent saved proof");
  });

  it("renders safe quote and omits category badges", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryAllProofSection, {
        wins: [
          {
            id: "good",
            occurredAt: "2026-06-07T12:00:00Z",
            displayTitle: "Named it",
            displayBody: "You named the obstacle instead of hiding.",
            supportingQuote: "it was hard and I said so",
            celebrationAppropriate: true,
            commitmentId: null,
          },
        ],
        timeZone: "UTC",
        hasMore: false,
        nextCursor: null,
      })
    );
    expect(html).toContain("You named the obstacle instead of hiding.");
    expect(html).toContain("it was hard and I said so");
    expect(html).not.toContain("Your reply:");
    expect(html).not.toContain("Told the truth");
  });
});
