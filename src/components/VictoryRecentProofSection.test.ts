import React from "react";
import fs from "fs";
import path from "path";
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
  it("renders Your Victories, counts, cards, and View all Victories without share or categories", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRecentProofSection, {
        summaryCounts: {
          totalActiveWins: 5,
          totalActiveGoalWins: 2,
          totalActiveProudMoments: 3,
        },
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
    expect(html).toContain(">Your Victories<");
    expect(html).not.toContain("Proud Moments &amp; Goal Wins");
    expect(html).not.toContain("Proud Moments & Goal Wins");
    expect(html).not.toMatch(/>Proud Moments</);
    expect(html).not.toContain("Build your identity one day at a time.");
    expect(html).not.toContain(
      "Real moments worth remembering — from your life, not a scoreboard."
    );
    expect(html).not.toContain("Your Wins");
    expect(html).toContain(">5<");
    expect(html).toContain(">2<");
    expect(html).toContain(">3<");
    expect(html).toContain("TOTAL VICTORIES");
    expect(html).toContain("GOAL WINS");
    expect(html).toContain("PROUD MOMENTS");
    expect(html).toContain('aria-label="What are Total Victories?"');
    expect(html).toContain('aria-label="What are Goal Wins?"');
    expect(html).toContain('aria-label="What are Proud Moments?"');
    expect(html).not.toContain("Moment Saved");
    expect(html).not.toContain("Moments Saved");
    expect(html).toContain("Kept walking");
    expect(html).toContain("You finished the loops you promised yourself.");
    expect(html).toContain("two loops done");
    expect(html).toContain("View all Victories");
    expect(html).toContain("/dashboard/victory-room/all-proof");
    expect(html).toContain("+ Add a Victory");
    expect(html).not.toContain("Add a Goal Win");
    expect(html).not.toContain("Add a Win");
    expect(html).toContain('/dashboard/victory-room/add-win"');
    expect(html).toContain("Edit Victory");
    expect(html).not.toContain('aria-label="Proud Moment actions"');
    expect(html).not.toContain(">Edit<");
    expect(html).not.toContain(">Delete<");
    expect(html).not.toContain("···");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("permanently delete");
    expect(html).not.toContain("See all proof");
    expect(html).not.toContain("Kept the goal");
    expect(html).not.toContain("Share");
    expect(html).not.toMatch(/streak|badge|\bXP\b|achievement unlocked|habit tracker|Win detected/i);
  });

  it("wires bounded edit origin for home cards", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/VictoryRecentProofSection.tsx"),
      "utf8"
    );
    expect(src).toContain("buildEditWinHref");
    expect(src).toContain('kind: "victory-room"');
    expect(src).toContain("VictoryProudMomentsEditChrome");
    expect(src).toContain("VictorySummaryCounts");
    expect(src).toContain("winId: w.id");
    expect(src).toContain("expectedUpdatedAt: w.updatedAt");
  });

  it("renders legitimate zeros for all three stats", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRecentProofSection, {
        summaryCounts: {
          totalActiveWins: 0,
          totalActiveGoalWins: 0,
          totalActiveProudMoments: 0,
        },
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
    expect(html).toContain(">Your Victories<");
    expect(html).toContain("TOTAL VICTORIES");
    expect(html).toContain("GOAL WINS");
    expect(html).toContain("PROUD MOMENTS");
    expect(html.match(/>0</g)?.length).toBe(3);
    expect(html).not.toContain("Moment Saved");
    expect(html).not.toContain("Moments Saved");
    expect(html).toContain("+ Add a Victory");
    expect(html).toContain("Kept walking");
  });

  it("renders empty state without banned copy", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRecentProofSection, {
        summaryCounts: {
          totalActiveWins: 0,
          totalActiveGoalWins: 0,
          totalActiveProudMoments: 0,
        },
        timeZone: "UTC",
        wins: [],
      })
    );
    expect(html).toContain(">Your Victories<");
    expect(html).not.toContain("Build your identity one day at a time.");
    expect(html).toContain("TOTAL VICTORIES");
    expect(html).toContain("GOAL WINS");
    expect(html).toContain("PROUD MOMENTS");
    expect(html.match(/>0</g)?.length).toBe(3);
    expect(html).not.toContain("Moment Saved");
    expect(html).not.toContain("Moments Saved");
    expect(html).toContain("No Victories yet.");
    expect(html).toContain(
      "When something real in your life is worth remembering, it will show up here."
    );
    expect(html).toContain("worth remembering");
    expect(html).toContain("+ Add a Victory");
    expect(html).not.toContain("Edit Victory");
    expect(html).not.toContain("No Wins yet.");
    expect(html).not.toContain("Recent Proof");
    expect(html).not.toContain("saved");
    expect(html).not.toContain("logged");
    expect(html).not.toContain("detected");
  });

  it("omits the three-stat header when summaryCounts is null", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRecentProofSection, {
        summaryCounts: null,
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
    expect(html).not.toContain("TOTAL VICTORIES");
    expect(html).not.toContain("GOAL WINS");
    expect(html).not.toContain("PROUD MOMENTS");
    expect(html).not.toContain("What are Total Victories?");
    expect(html).not.toContain("What are Goal Wins?");
    expect(html).not.toContain("What are Proud Moments?");
    expect(html).not.toContain("Moment Saved");
    expect(html).not.toContain("Moments Saved");
    expect(html).not.toMatch(/>0</);
    expect(html).toContain("Kept walking");
    expect(html).toContain("You finished the loops you promised yourself.");
    expect(html).toContain("+ Add a Victory");
    expect(html).toContain("Edit Victory");
    expect(html).not.toContain("No Victories yet.");
  });

  it("keeps empty state and omits stats when summaryCounts is null", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRecentProofSection, {
        summaryCounts: null,
        timeZone: "UTC",
        wins: [],
      })
    );
    expect(html).not.toContain("TOTAL VICTORIES");
    expect(html).not.toContain("GOAL WINS");
    expect(html).not.toContain("PROUD MOMENTS");
    expect(html).not.toContain("What are Total Victories?");
    expect(html).not.toMatch(/>0</);
    expect(html).toContain("No Victories yet.");
    expect(html).toContain("+ Add a Victory");
    expect(html).not.toContain("Edit Victory");
  });
});
