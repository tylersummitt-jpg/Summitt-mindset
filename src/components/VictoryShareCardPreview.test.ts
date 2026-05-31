import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VictoryShareCardPreview } from "@/components/VictoryShareCardPreview";
import type { VictoryShareSnippet } from "@/lib/v2-victory-share-snippet";

const sampleSnippet: VictoryShareSnippet = {
  categoryLabel: "Told the truth",
  dateLabel: "May 4, 2026",
  quote: "I showed up even when I didn't feel like it.",
  meaning: "You told the truth and stayed in the thread.",
  tagline: "Proof over promises.",
  brandLine: "Summitt Mindset",
  brandUrl: "summittmindset.com",
  plainText:
    "Building proof, not just intentions.\n\nTold the truth\n\"I showed up\"\nMeaning\n\nSummitt Mindset\nsummittmindset.com",
};

describe("VictoryShareCardPreview", () => {
  it("uses Victory Card modal copy and omits current bar", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryShareCardPreview, {
        snippet: sampleSnippet,
        onClose: () => {},
      })
    );

    expect(html).toContain("Share your Victory Card");
    expect(html).toContain("Copy caption");
    expect(html).toContain("Save image");
    expect(html).toContain("You choose what to copy or save. Nothing posts from Summitt.");
    expect(html).toContain("Told the truth");
    expect(html).toContain("summittmindset.com");
    expect(html).toContain("Proof over promises.");

    expect(html).not.toContain("Proof to share");
    expect(html).not.toContain("Current bar");
    expect(html).not.toContain("Copy to clipboard");
    expect(html).not.toContain("Download image");
    expect(html).not.toContain("identity_anchor");
    expect(html).toContain("data-victory-card-capture");
    expect(html).not.toContain("victory-proof-export-root");
    expect(html).not.toContain("opacity:0");
    expect(html).not.toContain("text-sky-");
    expect(html).not.toContain("border-emerald-");
    expect(html).not.toContain("bg-gradient-to-br");
  });
});
