import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import AddWinClient from "@/app/dashboard/victory-room/add-win/add-win-client";

describe("AddWinClient", () => {
  it("Overall form defaults Overall only and shows Season picker", () => {
    const html = renderToStaticMarkup(
      React.createElement(AddWinClient, {
        timeZone: "America/New_York",
        defaultOccurredOn: "2026-08-08",
        lockedSeason: null,
        seasonOptions: [
          {
            seasonId: "s2",
            seasonName: "Season 2",
            goalLabel: "Lift weights for 30 minutes a day",
            status: "active",
            startedAt: "2026-08-01T12:00:00Z",
            endedAt: null,
            isCurrent: true,
            pickerLabel: "Season 2\nLift weights for 30 minutes a day\nAug 1, 2026 – Current",
          },
        ],
        cancelHref: "/dashboard/victory-room",
      })
    );
    expect(html).toContain("Add a Win");
    expect(html).toContain("What happened?");
    expect(html).toContain("Details");
    expect(html).toContain("Date");
    expect(html).toContain("Overall only");
    expect(html).toContain("Season 2");
    expect(html).toContain("Lift weights for 30 minutes a day");
    expect(html).toContain("Aug 1, 2026 – Current");
    expect(html).toContain("Save Win");
    expect(html).not.toContain("commitment.title");
    expect(html).not.toMatch(/streak|score|badge|points|achievement/i);
  });

  it("Season form shows fixed context and has no picker", () => {
    const html = renderToStaticMarkup(
      React.createElement(AddWinClient, {
        timeZone: "UTC",
        defaultOccurredOn: "2026-08-08",
        lockedSeason: {
          seasonId: "s2",
          seasonName: "Season 2",
          goalLabel: "Lift weights for 30 minutes a day",
        },
        seasonOptions: [],
        cancelHref: "/dashboard/victory-room/seasons/s2",
      })
    );
    expect(html).toContain("Saving to");
    expect(html).toContain("Season 2");
    expect(html).toContain("Lift weights for 30 minutes a day");
    expect(html).not.toContain("Overall only");
    expect(html).not.toContain('id="win-season"');
  });

  it("picker uses behavior_statement-derived labels never legacy title hygiene", () => {
    const pageSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/dashboard/victory-room/add-win/page.tsx"),
      "utf8"
    );
    const persistSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-win-manual-persist.ts"),
      "utf8"
    );
    expect(pageSrc).toContain("behavior_statement");
    expect(pageSrc).toContain("formatUserFacingGoal");
    expect(persistSrc).toContain("behavior_statement");
    expect(persistSrc).not.toMatch(/commitment\.title|legacy.*title/i);
    expect(pageSrc).not.toContain("openai");
  });

  it("client posts to manual API with client_request_id and no OpenAI", () => {
    const clientSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/dashboard/victory-room/add-win/add-win-client.tsx"),
      "utf8"
    );
    expect(clientSrc).toContain("/api/v2/wins/manual");
    expect(clientSrc).toContain("client_request_id");
    expect(clientSrc).toContain("maxLength={MANUAL_WIN_TITLE_MAX}");
    expect(clientSrc).toContain("w-full");
    expect(clientSrc).not.toContain("openai");
    expect(clientSrc).not.toContain("generate");
  });

  it("mobile-safe structure uses full-width controls and page shell", () => {
    const pageSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/dashboard/victory-room/add-win/page.tsx"),
      "utf8"
    );
    const clientSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/dashboard/victory-room/add-win/add-win-client.tsx"),
      "utf8"
    );
    expect(pageSrc).toContain("vrPageOuter");
    expect(clientSrc).toContain("w-full");
    expect(clientSrc).toContain("text-base");
  });
});
