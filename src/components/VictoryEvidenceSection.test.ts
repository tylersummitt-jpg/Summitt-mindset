import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { VictoryEvidenceSection } from "@/components/VictoryEvidenceSection";
import { EMPTY_VICTORY_EVIDENCE_COUNTS } from "@/lib/v2-victory-room-view";

describe("VictoryEvidenceSection", () => {
  it("shows encouraging empty state when all counts are zero", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryEvidenceSection, { counts: EMPTY_VICTORY_EVIDENCE_COUNTS })
    );
    expect(html).toContain("The Evidence");
    expect(html).toContain("no scoreboard");
    expect(html).not.toContain(">0<");
  });

  it("renders only non-zero tiles", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryEvidenceSection, {
        counts: {
          ...EMPTY_VICTORY_EVIDENCE_COUNTS,
          keptTheGoal: 3,
          toldTheTruth: 0,
          gotBackOnTrack: 1,
        },
      })
    );
    expect(html).toContain("Kept the goal");
    expect(html).toContain("Got back on track");
    expect(html).not.toContain("Told the truth");
    expect(html).toContain('class="font-serif text-4xl font-semibold tabular-nums leading-none text-amber-50 sm:text-5xl"');
    expect(html).toContain(">3<");
    expect(html).toContain(">1<");
  });
});
