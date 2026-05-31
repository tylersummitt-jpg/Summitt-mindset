import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VictoryProofExportFrame } from "@/components/VictoryProofExportFrame";
import {
  VICTORY_PROOF_EXPORT_HEIGHT,
  VICTORY_PROOF_EXPORT_WIDTH,
} from "@/lib/victory-proof-export-image";
import type { VictoryShareSnippet } from "@/lib/v2-victory-share-snippet";

const sampleSnippet: VictoryShareSnippet = {
  categoryLabel: "Kept the goal",
  dateLabel: "May 2, 2026",
  quote: "yes",
  meaning: "You followed through when it counted.",
  tagline: "Proof over promises.",
  brandLine: "Summitt Mindset",
  brandUrl: "summittmindset.com",
  plainText: "caption",
};

describe("VictoryProofExportFrame", () => {
  it("contains Victory Card content with non-zero export dimensions", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryProofExportFrame, { snippet: sampleSnippet })
    );

    expect(html).toContain("Kept the goal");
    expect(html).toContain("May 2, 2026");
    expect(html).toContain("yes");
    expect(html).toContain("You followed through when it counted.");
    expect(html).toContain("Summitt Mindset");
    expect(html).toContain("summittmindset.com");
    expect(html).toContain("Proof over promises.");

    expect(html).toContain(String(VICTORY_PROOF_EXPORT_WIDTH));
    expect(html).toContain(String(VICTORY_PROOF_EXPORT_HEIGHT));
    expect(html).toContain("opacity:0");
    expect(html).not.toContain("left:-12000");
    expect(html).not.toContain("z-index:-10");
  });

  it("does not use -webkit-box line-clamp on export text", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryProofExportFrame, { snippet: sampleSnippet })
    );

    expect(html.toLowerCase()).not.toContain("-webkit-box");
    expect(html.toLowerCase()).not.toContain("webkitlineclamp");
    expect(html.toLowerCase()).not.toContain("-webkit-line-clamp");
  });
});
