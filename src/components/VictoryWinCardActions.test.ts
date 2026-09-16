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

describe("VictoryWinCardActions visible Edit/Delete (no overflow menu)", () => {
  it("renders Edit link and Delete button in-flow without details/dots/Remove photo", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCardActions, {
        winId: "w1",
        editHref: "/dashboard/victory-room/wins/w1/edit?from=victory-room",
        expectedUpdatedAt: "2026-08-09T12:00:00.000Z",
      })
    );

    expect(html).toContain(">Edit<");
    expect(html).toContain(">Delete<");
    expect(html).toContain("/dashboard/victory-room/wins/w1/edit?from=victory-room");
    expect(html).toContain("mt-5");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
    expect(html).not.toContain("···");
    expect(html).not.toContain("Remove photo");
    expect(html).not.toContain("Proud Moment actions");
    expect(html).not.toMatch(/\babsolute\b/);
    expect(html).not.toMatch(/\bz-20\b/);

    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/VictoryWinCardActions.tsx"),
      "utf8"
    );
    expect(src).not.toContain("<details");
    expect(src).not.toContain("<summary");
    expect(src).not.toContain("···");
    expect(src).not.toMatch(/Remove photo/i);
    expect(src).toContain("Delete this Proud Moment?");
    expect(src).toContain("In-flow");
  });

  it("VictoryWinCard keeps overflow-hidden and hides actions unless showEditingControls", () => {
    expect(vrMomentCardBase).toContain("overflow-hidden");
    const normal = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Done",
        displayBody: "Done",
        dateLabel: "Aug 8, 2026",
        winId: "w1",
        expectedUpdatedAt: "t1",
        editHref: "/dashboard/victory-room/wins/w1/edit?from=victory-room",
      })
    );
    expect(normal).toContain("overflow-hidden");
    expect(normal).not.toContain(">Edit<");
    expect(normal).not.toContain(">Delete<");
    expect(normal).not.toContain("mt-5");
    expect(normal).not.toContain("···");

    const editing = renderToStaticMarkup(
      React.createElement(VictoryWinCard, {
        displayTitle: "Done",
        displayBody: "Done",
        dateLabel: "Aug 8, 2026",
        winId: "w1",
        expectedUpdatedAt: "t1",
        editHref: "/dashboard/victory-room/wins/w1/edit?from=victory-room",
        showEditingControls: true,
      })
    );
    expect(editing).toContain(">Edit<");
    expect(editing).toContain(">Delete<");
    expect(editing).toContain("mt-5");
  });
});

describe("VictoryWinCardActions Delete", () => {
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

  it("opens inline confirmation; Cancel does nothing", async () => {
    const user = userEvent.setup();
    render(
      React.createElement(VictoryWinCardActions, {
        winId: WIN,
        editHref: "/edit",
        expectedUpdatedAt: "t1",
      })
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete this Proud Moment?")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Delete this Proud Moment?")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("confirm DELETE uses win route and expected_updated_at; success refreshes", async () => {
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
      })
    );
    expect(
      screen.getByRole("link", { name: "Edit" }).getAttribute("href")
    ).toBe(`/dashboard/victory-room/wins/${WIN}/edit?from=victory-room`);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete this Proud Moment?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete Proud Moment" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/v2/wins/${WIN}`);
    expect(init).toMatchObject({ method: "DELETE", credentials: "include" });
    expect(JSON.parse(init.body as string)).toEqual({ expected_updated_at: "t1" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("failure keeps confirm; allows retry; busy blocks double submit", async () => {
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
      })
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete Proud Moment" }));
    expect(
      (screen.getByRole("button", { name: "Deleting…" }) as HTMLButtonElement).disabled
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Deleting…" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch({
      ok: false,
      status: 500,
      json: async () => ({
        ok: false,
        error: "We couldn’t delete this Proud Moment. Please try again.",
      }),
    });

    await waitFor(() =>
      expect(screen.getByText(/couldn’t delete this Proud Moment/i)).toBeTruthy()
    );
    expect(screen.getByText("Delete this Proud Moment?")).toBeTruthy();
    expect(refreshMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    await user.click(screen.getByRole("button", { name: "Delete Proud Moment" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("no Replace or Remove photo UI on card actions", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/VictoryWinCardActions.tsx"),
      "utf8"
    );
    expect(src).not.toMatch(/Replace/i);
    expect(src).not.toMatch(/Remove photo/i);
    const html = renderToStaticMarkup(
      React.createElement(VictoryWinCardActions, {
        winId: WIN,
        editHref: "/edit",
        expectedUpdatedAt: "t1",
      })
    );
    expect(html).not.toMatch(/Replace/i);
    expect(html).not.toMatch(/Remove photo/i);
  });
});
