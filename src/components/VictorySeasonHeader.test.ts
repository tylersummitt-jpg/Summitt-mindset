import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { VictorySeasonHeader } from "@/components/VictorySeasonHeader";

describe("VictorySeasonHeader", () => {
  it("shows behavior_statement and never legacy title", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictorySeasonHeader, {
        seasonName: "Season 2",
        status: "active",
        startedAt: "2026-08-08T00:00:00Z",
        endedAt: null,
        goalSnapshot: {
          title: "SaaS App",
          behaviorStatement: "Lift weights for 30 minutes a day",
        },
        timeZone: "UTC",
      })
    );
    expect(html).toContain("Lift weights for 30 minutes a day");
    expect(html).toContain("Goal this season:");
    expect(html).not.toContain("SaaS App");
  });

  it("does not fall back to title when behavior is missing", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictorySeasonHeader, {
        seasonName: "Season 1",
        status: "completed",
        startedAt: "2026-05-25T00:00:00Z",
        endedAt: "2026-08-08T00:00:00Z",
        goalSnapshot: {
          title: "SaaS App",
          behaviorStatement: null,
        },
        timeZone: "UTC",
      })
    );
    expect(html).toContain("Goal unavailable");
    expect(html).not.toContain("SaaS App");
  });
});
