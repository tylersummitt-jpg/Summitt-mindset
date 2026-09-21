/** @vitest-environment jsdom */

import React from "react";
import fs from "fs";
import path from "path";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
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

import { VictoryProudMomentsEditChrome } from "@/components/VictoryProudMomentsEditChrome";

const cardA = {
  displayTitle: "First",
  displayBody: "One",
  dateLabel: "Sep 1, 2026",
  winId: "w1",
  expectedUpdatedAt: "t1",
  editHref: "/dashboard/victory-room/wins/w1/edit?from=victory-room",
};

const cardB = {
  displayTitle: "Second",
  displayBody: "Two",
  dateLabel: "Sep 2, 2026",
  winId: "w2",
  expectedUpdatedAt: "t2",
  editHref: "/dashboard/victory-room/wins/w2/edit?from=victory-room",
};

describe("VictoryProudMomentsEditChrome", () => {
  afterEach(() => {
    cleanup();
  });

  it("normal mode: Add + Edit toggle, no per-card actions, no dots", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryProudMomentsEditChrome, {
        addHref: "/dashboard/victory-room/add-win",
        addLabel: "+ Add a Victory",
        groups: [{ key: "recent", cards: [cardA, cardB] }],
      })
    );
    expect(html).toContain("+ Add a Victory");
    expect(html).toContain("Edit Victory");
    expect(html).toContain("flex-col");
    expect(html).toContain("sm:flex-row");
    expect(html).toContain("min-h-11");
    expect(html).not.toContain("Done Editing");
    expect(html).not.toContain(">Edit<");
    expect(html).not.toContain(">Delete<");
    expect(html).not.toContain("···");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("Remove photo");
    expect(html).not.toContain("/dashboard/victory-room/wins/w1/edit");

    const addClass = html.match(
      /<a href="\/dashboard\/victory-room\/add-win" class="([^"]+)">\+ Add a Victory<\/a>/
    )?.[1];
    const editClass = html.match(
      /<button type="button" class="([^"]+)" aria-pressed="false">Edit Victory<\/button>/
    )?.[1];
    expect(addClass).toBeTruthy();
    expect(editClass).toBeTruthy();
    expect(addClass).toBe(editClass);
    expect(addClass).toContain("text-amber-300");
    expect(addClass).toContain("underline");
  });

  it("keeps full Done Editing copy in source", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/VictoryProudMomentsEditChrome.tsx"),
      "utf8"
    );
    expect(src).toContain("Done Editing");
    expect(src).toContain("Edit Victory");
    expect(src).not.toContain("Edit a Proud Moment");
    expect(src).not.toContain("Done Editing Proud Moments");
    expect(src).toContain("aria-pressed");
    expect(src).toContain("flex-col");
    expect(src).toContain("sm:flex-row");
  });

  it("hides the Edit toggle when there are no cards and keeps Add", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryProudMomentsEditChrome, {
        addHref: "/dashboard/victory-room/add-win",
        addLabel: "+ Add a Victory",
        groups: [],
        emptyState: React.createElement("p", null, "No Victories yet."),
      })
    );
    expect(html).toContain("+ Add a Victory");
    expect(html).toContain("No Victories yet.");
    expect(html).not.toContain("Edit Victory");
    expect(html).not.toContain("Done Editing");
  });

  it("enters and exits edit mode; card Edit uses existing href; Done unmounts confirm", async () => {
    const user = userEvent.setup();
    render(
      React.createElement(VictoryProudMomentsEditChrome, {
        addHref: "/dashboard/victory-room/add-win",
        addLabel: "+ Add a Victory",
        groups: [{ key: "recent", cards: [cardA, cardB] }],
      })
    );

    const toggle = screen.getByRole("button", { name: "Edit Victory" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await user.click(toggle);

    expect(screen.getByRole("button", { name: "Done Editing" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Done Editing" }).getAttribute("aria-pressed")
    ).toBe("true");
    expect(screen.getAllByRole("link", { name: "Edit" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "+ Add a Victory" })).toBeTruthy();
    expect(screen.queryByText("···")).toBeNull();
    expect(
      screen.getAllByRole("link", { name: "Edit" })[0]!.getAttribute("href")
    ).toBe("/dashboard/victory-room/wins/w1/edit?from=victory-room");

    await user.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
    expect(screen.getByText("Delete this Victory?")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Done Editing" }));
    expect(screen.getByRole("button", { name: "Edit Victory" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByText("Delete this Victory?")).toBeNull();
  });

  it("stays in edit mode when rerendered with fewer remaining cards", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      React.createElement(VictoryProudMomentsEditChrome, {
        addHref: "/add",
        addLabel: "+ Add a Victory",
        groups: [{ key: "recent", cards: [cardA, cardB] }],
      })
    );
    await user.click(screen.getByRole("button", { name: "Edit Victory" }));
    expect(screen.getByRole("button", { name: "Done Editing" })).toBeTruthy();

    rerender(
      React.createElement(VictoryProudMomentsEditChrome, {
        addHref: "/add",
        addLabel: "+ Add a Victory",
        groups: [{ key: "recent", cards: [cardB] }],
      })
    );
    expect(screen.getByRole("button", { name: "Done Editing" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
    expect(screen.getByText("Second")).toBeTruthy();
    expect(screen.queryByText("First")).toBeNull();
  });

  it("final-card empty rerender hides Done and keeps Add", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      React.createElement(VictoryProudMomentsEditChrome, {
        addHref: "/add",
        addLabel: "+ Add a Victory",
        groups: [{ key: "recent", cards: [cardA] }],
      })
    );
    await user.click(screen.getByRole("button", { name: "Edit Victory" }));
    rerender(
      React.createElement(VictoryProudMomentsEditChrome, {
        addHref: "/add",
        addLabel: "+ Add a Victory",
        groups: [],
        emptyState: React.createElement("p", null, "No Victories yet."),
      })
    );
    expect(screen.getByRole("link", { name: "+ Add a Victory" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Done Editing" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit Victory" })).toBeNull();
    expect(screen.getByText("No Victories yet.")).toBeTruthy();
  });
});
