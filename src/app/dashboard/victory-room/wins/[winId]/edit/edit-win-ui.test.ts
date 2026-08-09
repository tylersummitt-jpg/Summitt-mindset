import fs from "fs";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

import { VictoryWinCard } from "@/components/VictoryWinCard";
import EditWinClient from "@/app/dashboard/victory-room/wins/[winId]/edit/edit-win-client";

describe("Edit Win UI", () => {
  it("VictoryWinCard shows Edit only when editHref provided", () => {
    const plain = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Done",
        displayBody: "Done",
        dateLabel: "Aug 8, 2026",
      })
    );
    expect(plain).not.toContain(">Edit<");

    const withEdit = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Done",
        displayBody: "Done",
        dateLabel: "Aug 8, 2026",
        editHref: "/dashboard/victory-room/wins/w1/edit?from=victory-room",
      })
    );
    expect(withEdit).toContain("Edit");
    expect(withEdit).toContain("/dashboard/victory-room/wins/w1/edit?from=victory-room");
  });

  it("Edit form prepopulates fields without provenance", () => {
    const html = renderToStaticMarkup(
      React.createElement(EditWinClient, {
        winId: "w1",
        maxOccurredOn: "2026-08-09",
        initialOccurredOn: "2026-08-08",
        initialTitle: "Lifted",
        initialDetails: "Felt strong",
        initialSeasonId: "s2",
        expectedUpdatedAt: "2026-08-09T12:00:00.000Z",
        seasonOptions: [
          {
            seasonId: "s2",
            seasonName: "Season 2",
            goalLabel: "Lift",
            status: "active",
            startedAt: "2026-08-01T00:00:00Z",
            endedAt: null,
            isCurrent: true,
            pickerLabel: "Season 2\nLift\nAug 1, 2026 – Current",
          },
        ],
        cancelHref: "/dashboard/victory-room",
        orphanCommitmentNotice: false,
      })
    );
    expect(html).toContain("Edit Win");
    expect(html).toContain("Save Changes");
    expect(html).toContain("Cancel");
    expect(html).toContain('value="Lifted"');
    expect(html).toContain("Felt strong");
    expect(html).toContain('value="2026-08-08"');
    expect(html).toContain('value="s2"');
    expect(html).toContain("Overall only");
    expect(html).not.toContain("source_type");
    expect(html).not.toContain("recognition_mode");
    expect(html).not.toContain("model_confidence");
    expect(html).not.toContain("MessageSid");
  });

  it("edit page wires ownership loader and bounded from origin", () => {
    const pageSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/dashboard/victory-room/wins/[winId]/edit/page.tsx"),
      "utf8"
    );
    expect(pageSrc).toContain("loadOwnedActiveWinForEdit");
    expect(pageSrc).toContain("parseEditWinOrigin");
    expect(pageSrc).toContain("editWinOriginHref");
    expect(pageSrc).not.toContain("returnTo");
    expect(pageSrc).not.toContain("openai");
  });
});
