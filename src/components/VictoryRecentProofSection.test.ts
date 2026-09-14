import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

import { VictoryRecentProofSection } from "@/components/VictoryRecentProofSection";

describe("VictoryRecentProofSection", () => {
  it("renders Proud Moments total, cards, and View all Proud Moments link without share or categories", () => {
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
            updatedAt: "2026-06-01T12:05:00.000Z",
          },
        ],
      })
    );
    expect(html).toContain(">Proud Moments &amp; Goal Wins<");
    expect(html).not.toMatch(/>Proud Moments</);
    expect(html).toContain("Build your identity one day at a time.");
    expect(html).not.toContain(
      "Real moments worth remembering — from your life, not a scoreboard."
    );
    expect(html).not.toContain("Your Wins");
    expect(html).toContain(">3<");
    expect(html).toMatch(/text-stone-400">Moments Saved</);
    expect(html).not.toMatch(/text-stone-400">Moment Saved</);
    expect(html).toContain("Kept walking");
    expect(html).toContain("You finished the loops you promised yourself.");
    expect(html).toContain("two loops done");
    expect(html).toContain("View all Proud Moments");
    expect(html).toContain("/dashboard/victory-room/all-proof");
    expect(html).toContain("+ Add a Proud Moment");
    expect(html).not.toContain("Add a Goal Win");
    expect(html).not.toContain("Add a Win");
    expect(html).toContain('/dashboard/victory-room/add-win"');
    expect(html).toContain('aria-label="Proud Moment actions"');
    expect(html).toContain("Edit");
    expect(html).toContain("Delete");
    expect(html).toContain("/dashboard/victory-room/wins/w1/edit?from=victory-room");
    expect(html).not.toContain("permanently delete");
    expect(html).not.toContain("See all proof");
    expect(html).not.toContain("Kept the goal");
    expect(html).not.toContain("Share");
    expect(html).not.toMatch(/streak|badge|\bXP\b|achievement unlocked|habit tracker|Win detected/i);
  });

  it("uses Moment Saved for a singular count", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRecentProofSection, {
        totalActiveWins: 1,
        timeZone: "UTC",
        wins: [
          {
            id: "w1",
            occurredAt: "2026-06-01T12:00:00Z",
            displayTitle: "Kept walking",
            displayBody: "You finished the loops you promised yourself.",
            supportingQuote: null,
            celebrationAppropriate: true,
            commitmentId: null,
            updatedAt: "2026-06-01T12:05:00.000Z",
          },
        ],
      })
    );
    expect(html).toContain(">Proud Moments &amp; Goal Wins<");
    expect(html).toMatch(/text-stone-400">Moment Saved</);
    expect(html).not.toMatch(/text-stone-400">Moments Saved</);
    expect(html).toContain("+ Add a Proud Moment");
  });

  it("renders empty state without banned copy", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRecentProofSection, {
        totalActiveWins: 0,
        timeZone: "UTC",
        wins: [],
      })
    );
    expect(html).toContain(">Proud Moments &amp; Goal Wins<");
    expect(html).toContain("Build your identity one day at a time.");
    expect(html).toMatch(/text-stone-400">Moments Saved</);
    expect(html).toContain("No Proud Moments yet.");
    expect(html).toContain(
      "When something real in your life is worth remembering, it will show up here."
    );
    expect(html).toContain("worth remembering");
    expect(html).toContain("+ Add a Proud Moment");
    expect(html).not.toContain("No Wins yet.");
    expect(html).not.toContain("Recent Proof");
    expect(html).not.toContain("saved");
    expect(html).not.toContain("logged");
    expect(html).not.toContain("detected");
  });
});
