import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { VictorySeasonWinsSection } from "@/components/VictorySeasonWinsSection";

describe("VictorySeasonWinsSection", () => {
  it("renders Wins from this season with VictoryWinCard content", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictorySeasonWinsSection, {
        timeZone: "UTC",
        seasonId: "11111111-1111-4111-8111-111111111111",
        wins: [
          {
            id: "win-manual-1",
            occurredAt: "2026-08-08T12:00:00.000Z",
            displayTitle: "Done",
            displayBody: "Done",
            supportingQuote: null,
            celebrationAppropriate: false,
            commitmentId: "c1",
          },
          {
            id: "win-sms-1",
            occurredAt: "2026-08-07T12:00:00.000Z",
            displayTitle: "Showed up",
            displayBody: "You kept the goal.",
            supportingQuote: "got it done",
            celebrationAppropriate: true,
            commitmentId: "c1",
          },
        ],
      })
    );
    expect(html).toContain("Wins from this season");
    expect(html).toContain("Done");
    expect(html).toContain("Showed up");
    expect(html).toContain("got it done");
    expect(html).toContain("Edit");
    expect(html).toContain("/dashboard/victory-room/wins/win-manual-1/edit?from=season%3A");
    expect(html).not.toMatch(/\bstreak\b|\bscore\b|\bbadge\b|\btrophy\b/i);
  });

  it("omits section entirely when zero Wins", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictorySeasonWinsSection, {
        timeZone: "UTC",
        seasonId: "11111111-1111-4111-8111-111111111111",
        wins: [],
      })
    );
    expect(html).toBe("");
    expect(html).not.toContain("Wins from this season");
    expect(html).not.toContain("0");
  });
});
