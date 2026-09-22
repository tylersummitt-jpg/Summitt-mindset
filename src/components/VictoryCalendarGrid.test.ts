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
  hasGoalWin: boolean;
  hasProudMoment: boolean;
};

function dayMarkers(
  entries: Record<string, { count: number; hasGoalWin?: boolean; hasProudMoment?: boolean }>
): Record<string, DayMarker> {
  return Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [
      key,
      {
        count: value.count,
        hasGoalWin: value.hasGoalWin ?? false,
        hasProudMoment: value.hasProudMoment ?? false,
      },
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
    expect(GRID_SRC).not.toContain("🏆");
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

  it("renders 42 slots, no marker on empty days, and number-only for unknown multi", () => {
    const { container } = render(
      React.createElement(VictoryCalendarGrid, {
        ...gridBase,
        markers: dayMarkers({ "2026-09-14": { count: 1 }, "2026-09-12": { count: 2 } }),
      })
    );
    expect(container.querySelector("[role='group']")?.children).toHaveLength(7 + 42);
    expect(container.textContent).not.toContain("Add a Win");
    expect(container.textContent).not.toContain("Add a Proud Moment");
    expect(container.textContent).not.toContain("🏆");
    const one = screen.getByRole("button", { name: "September 14, 2026, 1 Victory" });
    expect(one.querySelector("svg")).toBeNull();
    const many = screen.getByRole("button", { name: "September 12, 2026, 2 Victories" });
    expect(many.querySelector("svg")).toBeNull();
    expect(many.textContent).toMatch(/2/);
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
          "2026-09-14": { count: 1, hasGoalWin: true },
          "2026-09-12": { count: 1, hasProudMoment: true },
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

  it("renders Goal plus count for two goals, Star plus count for two proud, Goal plus count for mixed", () => {
    render(
      React.createElement(VictoryCalendarGrid, {
        ...gridBase,
        markers: dayMarkers({
          "2026-09-10": { count: 2, hasGoalWin: true },
          "2026-09-11": { count: 2, hasProudMoment: true },
          "2026-09-12": { count: 2, hasGoalWin: true, hasProudMoment: true },
        }),
      })
    );
    const twoGoal = screen.getByRole("button", { name: "September 10, 2026, 2 Victories" });
    expect(twoGoal.querySelectorAll("circle").length).toBe(3);
    expect(twoGoal.textContent).toMatch(/2/);
    expect(twoGoal.textContent).not.toContain("🏆");
    const twoProud = screen.getByRole("button", { name: "September 11, 2026, 2 Victories" });
    expect(twoProud.querySelector("path")).toBeTruthy();
    expect(twoProud.querySelectorAll("circle").length).toBe(0);
    expect(twoProud.textContent).toMatch(/2/);
    const mixed = screen.getByRole("button", { name: "September 12, 2026, 2 Victories" });
    expect(mixed.querySelectorAll("circle").length).toBe(3);
    expect(mixed.textContent).toMatch(/2/);
    expect(screen.queryByRole("button", { name: /1 Goal Win/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /1 Proud Moment/ })).toBeNull();
  });

  it("renders Goal plus total count when a Goal Win is mixed with several Proud Moments", () => {
    render(
      React.createElement(VictoryCalendarGrid, {
        ...gridBase,
        markers: dayMarkers({
          "2026-09-14": { count: 5, hasGoalWin: true, hasProudMoment: true },
        }),
      })
    );
    const cell = screen.getByRole("button", { name: "September 14, 2026, 5 Victories" });
    expect(cell.querySelectorAll("circle").length).toBe(3);
    expect(cell.textContent).toMatch(/5/);
    expect(cell.textContent).not.toContain("🏆");
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
    expect(today.textContent).not.toContain("🏆");
    expect(today.querySelector("svg")).toBeNull();
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
    const historical = screen.getByRole("button", { name: "August 12, 2026, 2 Victories" });
    expect(historical.textContent).toMatch(/2/);
    expect(historical.textContent).not.toContain("🏆");
    expect(historical.querySelector("svg")).toBeNull();
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
