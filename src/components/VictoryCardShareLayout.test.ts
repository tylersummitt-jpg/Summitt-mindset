import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VictoryCardShareLayout } from "@/components/VictoryCardShareLayout";
import { getVictoryCardPatQuote } from "@/lib/victory-card-pat-quote";
import {
  normalizeVictoryCardLine,
  VICTORY_CARD_BASE_WIDTH_PX,
} from "@/lib/victory-card-share-tone";
import type { VictoryShareSnippet } from "@/lib/v2-victory-share-snippet";

const sampleSnippet: VictoryShareSnippet = {
  categoryLabel: "Told the truth",
  dateLabel: "May 4, 2026",
  quote: "I showed up.",
  meaning: "You told the truth and stayed in the thread.",
  tagline: "Proof over promises.",
  brandLine: "Summitt Mindset",
  brandUrl: "summittmindset.com",
  plainText: "caption",
};

const TAILWIND_COLOR_CLASS_PATTERN =
  /\b(text|border|bg|from|to|via|shadow|ring)-(stone|sky|emerald|amber|orange|violet|green|blue|purple)-/;

describe("VictoryCardShareLayout", () => {
  it("uses portrait 4:5 layout and export-safe colors only", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryCardShareLayout, { snippet: sampleSnippet })
    );

    expect(html).toContain("Victory Card");
    expect(html).not.toContain("Summitt Mindset · Victory Card");
    expect(html).toContain("Told the truth");
    expect(html).toContain("Summitt Mindset");
    expect(html).not.toContain("summittmindset.com");
    expect(html).not.toContain("Proof over promises.");
    expect(html).toContain(getVictoryCardPatQuote("Told the truth"));
    expect(html).toContain("Pat Summitt");
    expect(html).toContain(`max-width:${VICTORY_CARD_BASE_WIDTH_PX}px`);
    expect(html).toContain("aspect-ratio:4 / 5");

    expect(html).not.toMatch(TAILWIND_COLOR_CLASS_PATTERN);
    expect(html).not.toContain("oklab");
    expect(html).not.toContain("oklch");
  });

  it("renders category-specific Pat quote in footer", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryCardShareLayout, {
        snippet: { ...sampleSnippet, categoryLabel: "Raised the bar" },
      })
    );
    expect(html).toContain("Change is a must if you want to be your best.");
  });

  it("does not repeat meaning when it matches the quote", () => {
    const dup: VictoryShareSnippet = {
      ...sampleSnippet,
      quote: "I showed up today.",
      meaning: "I showed up today.",
    };
    const html = renderToStaticMarkup(React.createElement(VictoryCardShareLayout, { snippet: dup }));
    expect(html.match(/I showed up today\./g)?.length).toBe(1);
  });
});

describe("normalizeVictoryCardLine", () => {
  it("treats whitespace-normalized duplicates as equal", () => {
    expect(normalizeVictoryCardLine("  Hello  ")).toBe(normalizeVictoryCardLine("hello"));
  });
});
