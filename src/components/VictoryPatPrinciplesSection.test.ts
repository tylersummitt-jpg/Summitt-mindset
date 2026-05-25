import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { VictoryPatPrinciplesSection } from "@/components/VictoryPatPrinciplesSection";
import type { VictoryPatPrinciplesForDisplay } from "@/lib/v2-victory-principles-map";

const GAMIFICATION = /\b(achievement|badge|unlocked|level|score|streak|leaderboard|points)\b/i;

function renderPrinciples(principles: VictoryPatPrinciplesForDisplay) {
  return renderToStaticMarkup(
    React.createElement(VictoryPatPrinciplesSection, { principles })
  );
}

describe("VictoryPatPrinciplesSection", () => {
  it("renders starter state for new user", () => {
    const html = renderPrinciples({
      confidence: "starter",
      starterText:
        "Your principles will become clearer as Coach Pat sees proof. Start with the standard: tell the truth, keep the goal, and get back on track when you miss.",
      livingWell: null,
      focusNext: {
        title: "Take Full Responsibility",
        text: "Start with the standard: When you miss, name it plainly.",
        evidenceIds: [],
      },
      updatedFromProof: false,
    });
    expect(html).toContain("Pat Principles I");
    expect(html).toContain("Living");
    expect(html).toContain("Definite Dozen");
    expect(html).toContain("tell the truth");
    expect(html).not.toContain("living well");
  });

  it("renders focus next only", () => {
    const html = renderPrinciples({
      confidence: "low",
      starterText: null,
      livingWell: null,
      focusNext: {
        title: "Discipline Yourself So No One Else Has To",
        text: "Early proof is forming. This week, practice doing the daily bar before the day gets away from you.",
        evidenceIds: [],
      },
      updatedFromProof: true,
    });
    expect(html).toContain("Principle to focus on next");
    expect(html).not.toContain("living well");
  });

  it("renders living well with evidence and both cards", () => {
    const html = renderPrinciples({
      confidence: "medium",
      starterText: null,
      livingWell: {
        title: "Take Full Responsibility",
        text: "Your recent proof — told the truth — lines up with Take Full Responsibility.",
        evidenceIds: ["m1"],
      },
      focusNext: {
        title: "Be a Competitor",
        text: "This week, practice coming back after a miss.",
        evidenceIds: [],
      },
      updatedFromProof: true,
    });
    expect(html).toContain("living well");
    expect(html).toContain("Principle to focus on next");
    expect(html).toContain("Updated from your recent proof");
  });

  it("avoids internal terms and gamification", () => {
    const html = renderPrinciples({
      confidence: "medium",
      starterText: null,
      livingWell: {
        title: "Be a Competitor",
        text: "Your recent proof — got back on track — lines up with Be a Competitor.",
        evidenceIds: ["m1"],
      },
      focusNext: {
        title: "Discipline Yourself So No One Else Has To",
        text: "This week, practice the daily bar.",
        evidenceIds: [],
      },
      updatedFromProof: true,
    });
    expect(html).not.toContain("source_hash");
    expect(html).not.toContain("valid_for_week_key");
    expect(html).not.toContain("discipline_yourself");
    expect(html).not.toMatch(GAMIFICATION);
    expect(html).not.toMatch(/pat said/i);
    expect(html).not.toContain("\u201C");
  });
});
