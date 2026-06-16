import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { VictoryRecentProofSection } from "@/components/VictoryRecentProofSection";

describe("VictoryRecentProofSection", () => {
  it("renders Your Wins title and See all proof link", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRecentProofSection, {
        viewForShare: null,
        moments: [
          {
            id: "m1",
            categoryLabel: "Kept the goal",
            headline: "Kept your word",
            body: "You followed through when it counted.",
            dateLabel: "Jun 1, 2026",
            groundedInEventTypes: ["user_yes"],
          },
        ],
      })
    );
    expect(html).toContain("Your Wins");
    expect(html).not.toContain("Recent Proof");
    expect(html).toContain("See all proof");
    expect(html).toContain("/dashboard/victory-room/all-proof");
    expect(html).not.toMatch(/streak|badge|\bXP\b|achievement unlocked|habit tracker|manual add|trophy room/i);
  });

  it("renders empty state without banned copy", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryRecentProofSection, {
        viewForShare: null,
        moments: [],
      })
    );
    expect(html).toContain("Your wins start here");
    expect(html).not.toContain("Recent Proof");
  });
});
