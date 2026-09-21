/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    refresh: vi.fn(),
    push: vi.fn(),
  }),
}));

import { VictoryCalendarGrid } from "@/components/VictoryCalendarGrid";

const GRID_SRC = readFileSync(join(process.cwd(), "src/components/VictoryCalendarGrid.tsx"), "utf8");

type DayMarker = {
  count: number;
  singleWinKind: "goal_win" | "proud_moment" | null;
};

function dayMarkers(
  entries: Record<string, { count: number; singleWinKind?: "goal_win" | "proud_moment" | null }>
): Record<string, DayMarker> {
  return Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [
      key,
      { count: value.count, singleWinKind: value.singleWinKind ?? null },
    ])
  );
}

const gridBase = {
  monthKey: "2026-09",
  currentMonthKey: "2026-09",
  todayKey: "2026-09-15",
  selectedDay: null as string | null,
};

describe("VictoryCalendarGrid import / timezone guards", () => {
  it("does not import public-read, Sol, D2, or use browser Date for today/future", () => {
    expect(GRID_SRC).toContain("VrIconGoal");
    expect(GRID_SRC).toContain("VrIconStar");
    expect(GRID_SRC).not.toContain("VrIconTrophy");
    expect(GRID_SRC).not.toContain("v2-win-public-read");
    expect(GRID_SRC).not.toContain("sms_audience");
    expect(GRID_SRC).not.toContain("inbound-sol");
    expect(GRID_SRC).not.toContain("inbound-mms-d2");
    expect(GRID_SRC).not.toContain("add-win");
    expect(GRID_SRC).not.toContain("Add a Win");
    expect(GRID_SRC).not.toContain("Add a Proud Moment");
    expect(GRID_SRC).toContain("scroll: false");
    expect(GRID_SRC).not.toMatch(/new Date\(/);
  });
});

describe("VictoryCalendarGrid", () => {
  afterEach(() => {
    cleanup();
    replaceMock.mockClear();
  });

  it("renders 42 slots, trophy without a visual 1, and multiple-win count", () => {
    const { container } = render(
      React.createElement(VictoryCalendarGrid, {
        ...gridBase,
        markers: dayMarkers({ "2026-09-14": { count: 1 }, "2026-09-12": { count: 2 } }),
      })
    );
    expect(container.querySelector("[role='group']")?.children).toHaveLength(7 + 42);
    expect(container.textContent).not.toContain("Add a Win");
    expect(container.textContent).not.toContain("Add a Proud Moment");
    const one = screen.getByRole("button", { name: "September 14, 2026, 1 Victory" });
    expect(one.textContent).toContain("🏆");
    expect(one.textContent).not.toMatch(/🏆\s*1/);
    const many = screen.getByRole("button", { name: "September 12, 2026, 2 Victories" });
    expect(many.textContent).toMatch(/🏆\s*2/);
    expect(screen.getByRole("button", { name: "September 13, 2026, no Victories" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "September 13, 2026, no Victories" }).textContent
    ).not.toContain("🏆");
  });

  it("renders Goal icon for a single goal_win and Star for a single proud_moment", () => {
    render(
      React.createElement(VictoryCalendarGrid, {
        ...gridBase,
        markers: dayMarkers({
          "2026-09-14": { count: 1, singleWinKind: "goal_win" },
          "2026-09-12": { count: 1, singleWinKind: "proud_moment" },
        }),
      })
    );
    const goal = screen.getByRole("button", { name: "September 14, 2026, 1 Goal Win" });
    expect(goal.querySelectorAll("circle").length).toBe(3);
    expect(goal.textContent).not.toContain("🏆");
    const proud = screen.getByRole("button", { name: "September 12, 2026, 1 Proud Moment" });
    expect(proud.querySelector("path")).toBeTruthy();
    expect(proud.querySelectorAll("circle").length).toBe(0);
    expect(proud.textContent).not.toContain("🏆");
  });

  it("renders trophy plus count for two goals, two proud, or mixed days", () => {
    render(
      React.createElement(VictoryCalendarGrid, {
        ...gridBase,
        markers: dayMarkers({
          "2026-09-10": { count: 2, singleWinKind: "goal_win" },
          "2026-09-11": { count: 2, singleWinKind: "proud_moment" },
          "2026-09-12": { count: 2 },
        }),
      })
    );
    expect(screen.getByRole("button", { name: "September 10, 2026, 2 Victories" }).textContent).toMatch(
      /🏆\s*2/
    );
    expect(screen.getByRole("button", { name: "September 11, 2026, 2 Victories" }).textContent).toMatch(
      /🏆\s*2/
    );
    expect(screen.getByRole("button", { name: "September 12, 2026, 2 Victories" }).textContent).toMatch(
      /🏆\s*2/
    );
    expect(screen.queryByRole("button", { name: /1 Goal Win/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /1 Proud Moment/ })).toBeNull();
  });

  it("marks today, selected, and keeps future days out of tab order", () => {
    render(
      React.createElement(VictoryCalendarGrid, {
        monthKey: "2026-09",
        currentMonthKey: "2026-09",
        todayKey: "2026-09-01",
        selectedDay: "2026-09-01",
        markers: dayMarkers({ "2026-09-01": { count: 1 } }),
      })
    );
    const today = screen.getByRole("button", { name: "Today, September 1, 2026, 1 Victory" });
    expect(today.getAttribute("aria-pressed")).toBe("true");
    expect(today.textContent).toContain("🏆");
    expect(screen.queryByRole("button", { name: /September 15, 2026/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /September 30, 2026/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Next month" }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(screen.queryByText("Back to This Month")).toBeNull();
  });

  it("shows Back to This Month only on historical months and enables next", () => {
    render(
      React.createElement(VictoryCalendarGrid, {
        monthKey: "2026-08",
        currentMonthKey: "2026-09",
        todayKey: "2026-09-01",
        selectedDay: "2026-08-12",
        markers: dayMarkers({ "2026-08-12": { count: 2 } }),
      })
    );
    expect(screen.getByRole("button", { name: "August 12, 2026, 2 Victories" }).textContent).toMatch(
      /🏆\s*2/
    );
    expect(screen.getByText("Back to This Month")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next month" }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it("writes month+day on select and uses scroll:false", () => {
    render(
      React.createElement(VictoryCalendarGrid, {
        monthKey: "2026-09",
        currentMonthKey: "2026-09",
        todayKey: "2026-09-15",
        selectedDay: null,
        markers: {},
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "September 14, 2026, no Victories" }));
    expect(replaceMock).toHaveBeenCalledWith(
      "/dashboard/victory-room?month=2026-09&day=2026-09-14",
      { scroll: false }
    );
  });

  it("previous month navigation drops the selected day", () => {
    render(
      React.createElement(VictoryCalendarGrid, {
        monthKey: "2026-09",
        currentMonthKey: "2026-09",
        todayKey: "2026-09-15",
        selectedDay: "2026-09-14",
        markers: {},
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(replaceMock).toHaveBeenCalledWith("/dashboard/victory-room?month=2026-08", {
      scroll: false,
    });
  });

  it("next month from historical uses scroll:false and no day", () => {
    render(
      React.createElement(VictoryCalendarGrid, {
        monthKey: "2026-08",
        currentMonthKey: "2026-09",
        todayKey: "2026-09-01",
        selectedDay: "2026-08-12",
        markers: {},
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(replaceMock).toHaveBeenCalledWith("/dashboard/victory-room", { scroll: false });
  });
});
