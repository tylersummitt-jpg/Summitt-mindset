import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VictoryCardShareLayout } from "@/components/VictoryCardShareLayout";
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
  it("does not use Tailwind color utilities that compile to oklab/oklch", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryCardShareLayout, { snippet: sampleSnippet })
    );

    expect(html).toContain("Told the truth");
    expect(html).toContain("Summitt Mindset");
    expect(html).toContain("#7dd3fc");
    expect(html).toContain("rgba(14, 165, 233");

    expect(html).not.toMatch(TAILWIND_COLOR_CLASS_PATTERN);
    expect(html).not.toContain("bg-gradient-to-br");
    expect(html).not.toContain("text-stone-");
    expect(html).not.toContain("text-amber-");
    expect(html).not.toContain("border-sky-");
  });
});
