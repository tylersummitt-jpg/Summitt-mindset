import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { VictorySeasonProofList } from "@/components/VictorySeasonProofList";

describe("VictorySeasonProofList", () => {
  it("renders dark VictoryMomentCard with quote and meaning, not white cards", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictorySeasonProofList, {
        timeZone: "America/Chicago",
        moments: [
          {
            id: "m1",
            categoryLabel: "Kept the goal",
            headline: "Proof in the thread",
            body: "You followed through when it counted.",
            quote: "yes",
            meaning: "You followed through when it counted.",
            occurredAt: "2026-05-02T10:00:00Z",
            groundedInEventTypes: ["user_yes"],
          },
        ],
      })
    );

    expect(html).toContain("Proof from this season");
    expect(html).toContain("Kept the goal");
    expect(html).toContain("“yes”");
    expect(html).toContain("You followed through when it counted.");
    expect(html).toContain("text-emerald-300");
    expect(html).not.toContain("bg-white");
    expect(html).not.toContain("text-gray-900");
    expect(html).not.toContain("Share this proof");
  });
});
