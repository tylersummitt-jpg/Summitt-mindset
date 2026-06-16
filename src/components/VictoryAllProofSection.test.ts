import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { VictoryAllProofSection } from "@/components/VictoryAllProofSection";

describe("VictoryAllProofSection", () => {
  it("renders All Proof title and back link", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryAllProofSection, {
        moments: [
          {
            id: "m1",
            occurredAt: "2026-06-15T12:00:00Z",
            headline: "Kept your word",
            body: "You followed through when it counted.",
            groundedInEventTypes: ["user_yes"],
          },
        ],
        timeZone: "America/New_York",
        truncated: false,
        viewForShare: null,
      })
    );
    expect(html).toContain("All Proof");
    expect(html).toContain("← Victory Room");
    expect(html).toContain("/dashboard/victory-room");
    expect(html).toContain("Every saved proof moment from your check-ins");
  });

  it("shows truncation note when truncated", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryAllProofSection, {
        moments: [
          {
            id: "m1",
            occurredAt: "2026-06-15T12:00:00Z",
            headline: "Kept your word",
            body: "You followed through when it counted.",
            groundedInEventTypes: ["user_yes"],
          },
        ],
        timeZone: "UTC",
        truncated: true,
        viewForShare: null,
      })
    );
    expect(html).toContain("Showing your most recent saved proof");
  });

  it("shows meaning-first display with muted receipt for contextless quote", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryAllProofSection, {
        moments: [
          {
            id: "good",
            occurredAt: "2026-06-07T12:00:00Z",
            headline: "Honesty",
            body: "You named the obstacle instead of hiding.",
            meaning: "You named the obstacle instead of hiding.",
            quote: "Good",
            groundedInEventTypes: ["blocker_captured"],
          },
        ],
        timeZone: "UTC",
        truncated: false,
        viewForShare: null,
      })
    );
    expect(html).toContain("You named the obstacle instead of hiding.");
    expect(html).toContain('Your reply: &quot;Good&quot;');
    expect(html).not.toContain("&ldquo;Good&rdquo;");
  });
});
