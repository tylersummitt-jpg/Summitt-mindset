/** @vitest-environment jsdom */

import fs from "fs";
import path from "path";
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: refreshMock,
    push: vi.fn(),
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("a", { href, ...rest }, children),
}));

import { VictoryWinCard } from "@/components/VictoryWinCard";
import { VictoryWinCardActions } from "@/components/VictoryWinCardActions";
import { vrMomentCardBase } from "@/components/victory-room-visual";

const WIN = "550e8400-e29b-41d4-a716-446655440010";

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

describe("VictoryWinCardActions Remove photo", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    refreshMock.mockClear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function revealMenu() {
    const details = document.querySelector("details");
    expect(details).toBeTruthy();
    details!.open = true;
  }

  it("1. text-only Win → no Remove photo", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCardActions, {
        winId: WIN,
        editHref: "/edit",
        expectedUpdatedAt: "t1",
        hasMedia: false,
      })
    );
    expect(html).toContain(">Edit<");
    expect(html).toContain(">Delete<");
    expect(html).not.toContain("Remove photo");
  });

  it("2. media Win → Remove photo visible", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCardActions, {
        winId: WIN,
        editHref: "/edit",
        expectedUpdatedAt: "t1",
        hasMedia: true,
      })
    );
    expect(html).toContain("Remove photo");
    expect(html).toContain(">Edit<");
    expect(html).toContain(">Delete<");
  });

  it("3–5. opens separate confirmation with photo/Win-stays copy; Cancel does nothing", async () => {
    const user = userEvent.setup();
    render(
      React.createElement(VictoryWinCardActions, {
        winId: WIN,
        editHref: "/edit",
        expectedUpdatedAt: "t1",
        hasMedia: true,
      })
    );

    revealMenu();
    await user.click(screen.getByRole("menuitem", { name: "Remove photo" }));
    expect(screen.getByText("Remove this photo?")).toBeTruthy();
    expect(
      screen.getByText(
        /This permanently removes the photo\. Your Win stays in Victory Room\. This can’t be undone\./
      )
    ).toBeTruthy();
    expect(screen.queryByText("Delete this Win?")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Remove this photo?")).toBeNull();
    revealMenu();
    expect(screen.getByRole("menuitem", { name: "Remove photo" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("6–9. confirm DELETE exact route; success removed/already_absent refresh", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: "removed" }),
    });

    render(
      React.createElement(VictoryWinCardActions, {
        winId: WIN,
        editHref: "/edit",
        expectedUpdatedAt: "t1",
        hasMedia: true,
      })
    );

    revealMenu();
    await user.click(screen.getByRole("menuitem", { name: "Remove photo" }));
    await user.click(screen.getByRole("button", { name: "Remove photo" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/victory-media/win/${WIN}`);
    expect(init).toMatchObject({ method: "DELETE", credentials: "include" });
    expect(init).not.toHaveProperty("body");
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));

    cleanup();
    refreshMock.mockClear();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: "already_absent" }),
    });
    render(
      React.createElement(VictoryWinCardActions, {
        winId: WIN,
        editHref: "/edit",
        expectedUpdatedAt: "t1",
        hasMedia: true,
      })
    );
    revealMenu();
    await user.click(screen.getByRole("menuitem", { name: "Remove photo" }));
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("10–12. failure keeps confirm; allows retry; busy blocks double Remove", async () => {
    const user = userEvent.setup();
    let resolveFetch: (v: unknown) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );

    render(
      React.createElement(VictoryWinCardActions, {
        winId: WIN,
        editHref: "/edit",
        expectedUpdatedAt: "t1",
        hasMedia: true,
      })
    );

    revealMenu();
    await user.click(screen.getByRole("menuitem", { name: "Remove photo" }));
    const confirmBtn = screen.getByRole("button", { name: "Remove photo" });
    await user.click(confirmBtn);
    expect(
      (screen.getByRole("button", { name: "Removing…" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Removing…" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch({
      ok: false,
      status: 500,
      json: async () => ({
        ok: false,
        error: "We couldn’t remove this photo. Please try again.",
        code: "remove_failed",
      }),
    });

    await waitFor(() =>
      expect(
        screen.getByText(/couldn’t remove this photo/i)
      ).toBeTruthy()
    );
    expect(screen.getByText("Remove this photo?")).toBeTruthy();
    expect(refreshMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, status: "removed" }),
    });
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("13. Edit/Delete Win unchanged (still present; Delete uses win route)", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    render(
      React.createElement(VictoryWinCardActions, {
        winId: WIN,
        editHref: `/dashboard/victory-room/wins/${WIN}/edit?from=victory-room`,
        expectedUpdatedAt: "t1",
        hasMedia: true,
      })
    );
    revealMenu();
    expect(
      screen.getByRole("menuitem", { name: "Edit" }).getAttribute("href")
    ).toBe(`/dashboard/victory-room/wins/${WIN}/edit?from=victory-room`);
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByText("Delete this Win?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete Win" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/v2/wins/${WIN}`);
    expect(init.method).toBe("DELETE");
  });

  it("14. all three shared surfaces pass hasMedia", () => {
    for (const file of [
      "VictoryRecentProofSection.tsx",
      "VictoryAllProofSection.tsx",
      "VictorySeasonWinsSection.tsx",
    ]) {
      const src = fs.readFileSync(
        path.join(process.cwd(), "src/components", file),
        "utf8"
      );
      expect(src).toContain("hasMedia={Boolean(w.media)}");
    }
    const card = fs.readFileSync(
      path.join(process.cwd(), "src/components/VictoryWinCard.tsx"),
      "utf8"
    );
    expect(card).toContain("hasMedia={hasMedia}");
  });

  it("15. no Replace UI", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/VictoryWinCardActions.tsx"),
      "utf8"
    );
    expect(src).not.toMatch(/Replace/i);
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCardActions, {
        winId: WIN,
        editHref: "/edit",
        expectedUpdatedAt: "t1",
        hasMedia: true,
      })
    );
    expect(html).not.toMatch(/Replace/i);
  });
});
