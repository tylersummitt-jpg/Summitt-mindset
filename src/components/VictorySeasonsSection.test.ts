import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { VictorySeasonsSection } from "@/components/VictorySeasonsSection";
import type { VictorySeasonCardData } from "@/lib/v2-victory-season-list";

const GAMIFICATION = /\b(achievement|badge|streak|leaderboard|points)\b/i;

function card(overrides: Partial<VictorySeasonCardData> = {}): VictorySeasonCardData {
  return {
    seasonId: "s1",
    commitmentId: "c1",
    seasonName: "Season 1",
    status: "completed",
    startedAt: "2026-01-01T00:00:00Z",
    endedAt: "2026-04-01T00:00:00Z",
    goalTitle: "Morning walk",
    hasSavedProof: true,
    summaryTeaser: null,
    principleLivedTitle: null,
    statusLine: "Proof was saved for this season.",
    detailHref: "/dashboard/victory-room/seasons/s1",
    isCurrent: false,
    ...overrides,
  };
}

describe("VictorySeasonsSection", () => {
  it("renders calm chapter cards with View season, no proof narrative", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictorySeasonsSection, {
        currentSeason: card({
          isCurrent: true,
          status: "active",
          statusLine: "Proof is forming in this season.",
          hasSavedProof: false,
          seasonName: "Season 2",
          goalTitle: "Lift weights for 30 minutes a day",
          winCount: 2,
          principleLivedTitle: "Take Full Responsibility",
          summaryTeaser: "This season saved proof that you told the truth.",
          detailHref: "/dashboard/victory-room/seasons/s2",
          endedAt: null,
        }),
        pastSeasons: [
          card({
            seasonName: "Season 1",
            goalTitle: "Lift weights for 15 minutes a day",
            winCount: 3,
            principleLivedTitle: "Discipline",
            statusLine: "Little was captured in text for this season.",
            summaryTeaser: "teaser",
          }),
        ],
        timeZone: "UTC",
      })
    );
    expect(html).toContain("My Seasons");
    expect(html).toContain("Each season is a chapter of your accountability.");
    expect(html).not.toContain("proof lives");
    expect(html).toContain("Current chapter");
    expect(html).toContain("Past chapters");
    expect(html).toContain("Season 2");
    expect(html).toContain("Season 1");
    expect(html).toContain("Lift weights for 30 minutes a day");
    expect(html).toContain("Lift weights for 15 minutes a day");
    expect(html).toContain("2 WINS");
    expect(html).toContain("3 WINS");
    expect(html).toContain("View season");
    expect(html).not.toContain("View season proof");
    expect(html).not.toContain("Proof is forming");
    expect(html).not.toContain("Little was captured");
    expect(html).not.toContain("Proof was saved");
    expect(html).not.toContain("Principle lived");
    expect(html).not.toContain("Take Full Responsibility");
    expect(html).not.toContain("told the truth");
    expect(html).not.toContain("teaser");
    expect(html).not.toMatch(GAMIFICATION);
  });

  it("renders behavior goal labels and never shows SaaS App title", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictorySeasonsSection, {
        currentSeason: card({
          isCurrent: true,
          status: "active",
          seasonName: "Season 2",
          goalTitle: "Lift weights for 30 minutes a day",
          endedAt: null,
          detailHref: "/dashboard/victory-room/seasons/s2",
        }),
        pastSeasons: [
          card({
            seasonName: "Season 1",
            goalTitle: "Lift weights for 15 minutes a day",
          }),
        ],
        timeZone: "UTC",
      })
    );
    expect(html).toContain("Lift weights for 30 minutes a day");
    expect(html).toContain("Lift weights for 15 minutes a day");
    expect(html).not.toContain("SaaS App");
  });

  it("renders 1 WIN / N WINS and nothing for zero", () => {
    const zero = renderToStaticMarkup(
      React.createElement(VictorySeasonsSection, {
        currentSeason: card({ isCurrent: true, status: "active", winCount: 0 }),
        pastSeasons: [],
        timeZone: "UTC",
      })
    );
    expect(zero).not.toMatch(/\b0 WINS?\b/);
    expect(zero).not.toMatch(/\bWIN\b/);

    const one = renderToStaticMarkup(
      React.createElement(VictorySeasonsSection, {
        currentSeason: card({ isCurrent: true, status: "active", winCount: 1 }),
        pastSeasons: [],
        timeZone: "UTC",
      })
    );
    expect(one).toContain("1 WIN");
    expect(one).not.toContain("1 WINS");

    const two = renderToStaticMarkup(
      React.createElement(VictorySeasonsSection, {
        currentSeason: card({ isCurrent: true, status: "active", winCount: 2 }),
        pastSeasons: [],
        timeZone: "UTC",
      })
    );
    expect(two).toContain("2 WINS");
  });
});
