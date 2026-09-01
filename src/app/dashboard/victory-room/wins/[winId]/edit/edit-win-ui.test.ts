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
import { VictoryWinCardActions } from "@/components/VictoryWinCardActions";
import EditWinClient from "@/app/dashboard/victory-room/wins/[winId]/edit/edit-win-client";

describe("Edit Win UI", () => {
  it("VictoryWinCard shows More menu with Edit+Delete when actions wired", () => {
    const plain = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Done",
        displayBody: "Done",
        dateLabel: "Aug 8, 2026",
      })
    );
    expect(plain).not.toContain("Win actions");
    expect(plain).not.toContain(">Edit<");
    expect(plain).not.toContain(">Delete<");

    const withActions = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Done",
        displayBody: "Done",
        dateLabel: "Aug 8, 2026",
        winId: "w1",
        expectedUpdatedAt: "2026-08-09T12:00:00.000Z",
        editHref: "/dashboard/victory-room/wins/w1/edit?from=victory-room",
      })
    );
    expect(withActions).toContain('aria-label="Win actions"');
    expect(withActions).toContain("Edit");
    expect(withActions).toContain("Delete");
    expect(withActions).toContain("/dashboard/victory-room/wins/w1/edit?from=victory-room");
    expect(withActions).not.toContain("permanently delete");
    expect(withActions).not.toContain("user_deleted");
  });

  it("Edit-only without expectedUpdatedAt stays actionless (safe)", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Done",
        displayBody: "Done",
        dateLabel: "Aug 8, 2026",
        editHref: "/dashboard/victory-room/wins/w1/edit?from=victory-room",
      })
    );
    expect(html).not.toContain("Win actions");
    expect(html).not.toContain(">Edit<");
  });

  it("actions source uses DELETE with expected_updated_at and calm copy", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/VictoryWinCardActions.tsx"),
      "utf8"
    );
    expect(src).toContain('method: "DELETE"');
    expect(src).toContain("expected_updated_at");
    expect(src).toContain("router.refresh()");
    expect(src).toContain("Delete this Win?");
    expect(src).toContain("accountability history and messages are not");
    expect(src).toContain("Delete Win");
    expect(src).toContain("We couldn’t delete this Win");
    expect(src).toContain("changed since you opened");
    // Delete Win copy must not imply permanent/proof deletion; Remove photo may say permanently.
    expect(src).toContain("This permanently removes the photo");
    expect(src).toContain("Your Win stays in Victory Room");
    const deleteConfirmBlock = src.slice(
      src.indexOf("Delete this Win?"),
      src.indexOf("Remove this photo?")
    );
    expect(deleteConfirmBlock).not.toContain("permanently");
    expect(src).not.toContain("openai");
    // Clip regression: open panel must not use absolute positioning.
    expect(src).not.toMatch(/className="[^"]*\babsolute\b/);
    expect(src).not.toMatch(/\bleft-0\b/);
    expect(src).not.toMatch(/\bz-20\b/);
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
        media: null,
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
    expect(html).not.toContain("Remove photo");
  });

  it("Cancel uses the provided calendar month/day href", () => {
    const html = renderToStaticMarkup(
      React.createElement(EditWinClient, {
        winId: "w1",
        maxOccurredOn: "2026-08-09",
        initialOccurredOn: "2026-08-08",
        initialTitle: "Lifted",
        initialDetails: "",
        initialSeasonId: "",
        expectedUpdatedAt: "2026-08-09T12:00:00.000Z",
        seasonOptions: [],
        cancelHref: "/dashboard/victory-room?month=2026-08&day=2026-08-18",
        orphanCommitmentNotice: false,
        media: null,
      })
    );
    expect(html).toContain('href="/dashboard/victory-room?month=2026-08&amp;day=2026-08-18"');
  });

  it("edit page wires ownership loader, enricher, and bounded from origin", () => {
    const pageSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/dashboard/victory-room/wins/[winId]/edit/page.tsx"),
      "utf8"
    );
    expect(pageSrc).toContain("loadOwnedActiveWinForEdit");
    expect(pageSrc).toContain("enrichPublicWinsWithMedia");
    expect(pageSrc).toContain("parseEditWinOrigin");
    expect(pageSrc).toContain("editWinOriginHref");
    expect(pageSrc).toContain("media={media}");
    expect(pageSrc).not.toContain("returnTo");
    expect(pageSrc).not.toContain("openai");
    expect(pageSrc).not.toContain("storage_master_path");
    expect(pageSrc).toContain("parseEditWinOrigin(sp.from)");
    expect(pageSrc).toContain("editWinOriginHref(origin)");
  });

  it("confirm UI copy is available from actions component", () => {
    // Initial render is menu; confirm copy lives in source (stateful).
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCardActions, {
        winId: "w1",
        editHref: "/dashboard/victory-room/wins/w1/edit?from=victory-room",
        expectedUpdatedAt: "t1",
      })
    );
    expect(html).toContain("Win actions");
    expect(html).toContain("Edit");
    expect(html).toContain("Delete");
    expect(html).toContain("min-h-11");
  });
});
