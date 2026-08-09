import fs from "fs";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

import { VictoryWinCard } from "@/components/VictoryWinCard";
import { VictoryWinCardActions } from "@/components/VictoryWinCardActions";
import { vrMomentCardBase } from "@/components/victory-room-visual";

describe("VictoryWinCardActions in-flow menu (overflow clip regression)", () => {
  it("menu panel is not absolutely positioned (avoids card overflow-hidden clip)", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCardActions, {
        winId: "w1",
        editHref: "/dashboard/victory-room/wins/w1/edit?from=victory-room",
        expectedUpdatedAt: "2026-08-09T12:00:00.000Z",
      })
    );

    expect(html).toContain('aria-label="Win actions"');
    expect(html).toContain(">Edit<");
    expect(html).toContain(">Delete<");
    expect(html).toContain("<details");
    expect(html).toContain("<summary");

    // Open panel must stay in normal flow under the trigger.
    expect(html).not.toMatch(/\babsolute\b/);
    expect(html).not.toMatch(/\bleft-0\b/);
    expect(html).not.toMatch(/\bz-20\b/);
    expect(html).toContain("mt-2");
    expect(html).toContain("w-full");

    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/VictoryWinCardActions.tsx"),
      "utf8"
    );
    expect(src).not.toMatch(/className="[^"]*\babsolute\b/);
    expect(src).not.toMatch(/className=\{`[^`]*\babsolute\b/);
    expect(src).toContain("In-flow");
    expect(src).toContain("Delete this Win?");
    // No absolute/left-0/z-20 class utilities remain in this file.
    expect(src).not.toMatch(/\bleft-0\b/);
    expect(src).not.toMatch(/\bz-20\b/);
  });

  it("open details markup keeps Edit/Delete as in-flow children of details", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCardActions, {
        winId: "w1",
        editHref: "/edit",
        expectedUpdatedAt: "t1",
      })
    );
    // Force-open attribute is not set by default; children still serialize for SSR
    // and live under <details> so native toggle reveals them in-flow.
    const detailsIdx = html.indexOf("<details");
    const menuRoleIdx = html.indexOf('role="menu"');
    const editIdx = html.indexOf(">Edit<");
    const deleteIdx = html.indexOf(">Delete<");
    expect(detailsIdx).toBeGreaterThanOrEqual(0);
    expect(menuRoleIdx).toBeGreaterThan(detailsIdx);
    expect(editIdx).toBeGreaterThan(menuRoleIdx);
    expect(deleteIdx).toBeGreaterThan(editIdx);
  });

  it("VictoryWinCard keeps overflow-hidden while wiring in-flow actions", () => {
    expect(vrMomentCardBase).toContain("overflow-hidden");
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Done",
        displayBody: "Done",
        dateLabel: "Aug 8, 2026",
        winId: "w1",
        expectedUpdatedAt: "t1",
        editHref: "/dashboard/victory-room/wins/w1/edit?from=victory-room",
      })
    );
    expect(html).toContain("overflow-hidden");
    expect(html).toContain('aria-label="Win actions"');
    expect(html).toContain("Edit");
    expect(html).toContain("Delete");
    expect(html).not.toMatch(/\babsolute left-0\b/);
    expect(html).not.toMatch(/\bz-20\b/);
  });
});
