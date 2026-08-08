import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { VictoryRecentProofSection } from "@/components/VictoryRecentProofSection";

describe("VictoryRecentProofSection", () => {
  it("renders Your Wins total, cards, and View all Wins link without share or categories", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRecentProofSection, {
        totalActiveWins: 3,
        timeZone: "UTC",
        wins: [
          {
            id: "w1",
            occurredAt: "2026-06-01T12:00:00Z",
            displayTitle: "Kept walking",
            displayBody: "You finished the loops you promised yourself.",
            supportingQuote: "two loops done",
            celebrationAppropriate: true,
            commitmentId: null,
          },
        ],
      })
    );
    expect(html).toContain("Your Wins");
    expect(html).toContain(">3<");
    expect(html).toContain("Kept walking");
    expect(html).toContain("You finished the loops you promised yourself.");
    expect(html).toContain("two loops done");
    expect(html).toContain("View all Wins");
    expect(html).toContain("/dashboard/victory-room/all-proof");
    expect(html).toContain("Add a Win");
    expect(html).toContain('/dashboard/victory-room/add-win"');
    expect(html).not.toContain("See all proof");
    expect(html).not.toContain("Kept the goal");
    expect(html).not.toContain("Share");
    expect(html).not.toMatch(/streak|badge|\bXP\b|achievement unlocked|habit tracker|Win detected/i);
  });

  it("renders empty state without banned copy", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRecentProofSection, {
        totalActiveWins: 0,
        timeZone: "UTC",
        wins: [],
      })
    );
    expect(html).toContain("No Wins yet.");
    expect(html).toContain("worth remembering");
    expect(html).toContain("Add a Win");
    expect(html).not.toContain("Recent Proof");
    expect(html).not.toContain("saved");
    expect(html).not.toContain("logged");
    expect(html).not.toContain("detected");
  });
});
