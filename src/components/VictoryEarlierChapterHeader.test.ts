import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { VictoryEarlierChapterHeader } from "@/components/VictoryEarlierChapterHeader";

describe("VictoryEarlierChapterHeader", () => {
  it("shows behavior_statement and never legacy title", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryEarlierChapterHeader, {
        title: "SaaS App",
        statusLabel: "Moved to a new standard",
        startedAt: "2026-05-25T00:00:00Z",
        endedAt: "2026-08-08T00:00:00Z",
        behaviorStatement: "Lift weights for 15 minutes a day",
        timeZone: "UTC",
      })
    );
    expect(html).toContain("Lift weights for 15 minutes a day");
    expect(html).not.toContain("SaaS App");
  });

  it("does not fall back to title when behavior is missing", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryEarlierChapterHeader, {
        title: "SaaS App",
        statusLabel: "Completed",
        startedAt: "2026-01-01T00:00:00Z",
        endedAt: null,
        behaviorStatement: null,
        timeZone: "UTC",
      })
    );
    expect(html).toContain("Goal unavailable");
    expect(html).not.toContain("SaaS App");
  });
});
