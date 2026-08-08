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
  it("renders current and past season cards with links, no numeric proof count", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictorySeasonsSection, {
        currentSeason: card({
          isCurrent: true,
          status: "active",
          statusLine: "This season is still building.",
          hasSavedProof: false,
          seasonName: "Season 2",
          detailHref: "/dashboard/victory-room/seasons/s2",
        }),
        pastSeasons: [card()],
        timeZone: "UTC",
      })
    );
    expect(html).toContain("My Seasons");
    expect(html).toContain("still building");
    expect(html).toContain("View season proof");
    expect(html).not.toMatch(/proof moments saved/i);
    expect(html).not.toMatch(/\b0 proof\b/i);
  });

  it("shows summary teaser only when provided", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictorySeasonsSection, {
        currentSeason: null,
        pastSeasons: [
          card({
            summaryTeaser: "This season saved proof that you told the truth.",
            statusLine: "This season saved proof that you told the truth.",
          }),
        ],
        timeZone: "UTC",
      })
    );
    expect(html).toContain("told the truth");
    expect(html).not.toMatch(GAMIFICATION);
    expect(html).not.toMatch(/Pat said/i);
    expect(html).not.toMatch(/Coach Pat saw/i);
  });

  it("summary block fields do not duplicate proof-only teaser", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictorySeasonsSection, {
        currentSeason: null,
        pastSeasons: [
          card({
            principleLivedTitle: "Take Full Responsibility",
            summaryTeaser: "This season saved proof that you told the truth.",
            statusLine: "This season saved proof that you told the truth.",
          }),
        ],
        timeZone: "UTC",
      })
    );
    expect(html).toContain("Principle lived:");
    expect(html).not.toMatch(/Coach Pat/i);
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
          statusLine: "This season is still building.",
          hasSavedProof: false,
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
});
