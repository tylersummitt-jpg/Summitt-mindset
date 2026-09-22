/** @vitest-environment jsdom */

import fs from "fs";
import path from "path";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { VictorySummaryCounts } from "@/components/VictorySummaryCounts";

const counts = {
  totalActiveWins: 33,
  totalActiveGoalWins: 7,
  totalActiveProudMoments: 26,
};

const SRC = fs.readFileSync(
  path.join(process.cwd(), "src/components/VictorySummaryCounts.tsx"),
  "utf8"
);

const ICONS_SRC = fs.readFileSync(
  path.join(process.cwd(), "src/components/VictoryRoomIcons.tsx"),
  "utf8"
);

describe("VictorySummaryCounts", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders three counts, decorative icons, and info buttons without an explanation", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictorySummaryCounts, { counts })
    );
    expect(html).toContain(">33<");
    expect(html).toContain(">7<");
    expect(html).toContain(">26<");
    expect(html).toContain("TOTAL VICTORIES");
    expect(html).toContain("GOAL WINS");
    expect(html).toContain("PROUD MOMENTS");
    expect(html.indexOf(">33<")).toBeLessThan(html.indexOf("TOTAL VICTORIES"));
    expect(html.indexOf(">7<")).toBeLessThan(html.indexOf("GOAL WINS"));
    expect(html.indexOf(">26<")).toBeLessThan(html.indexOf("PROUD MOMENTS"));
    const totalInfo = html.indexOf('aria-label="What are Total Victories?"');
    const goalInfo = html.indexOf('aria-label="What are Goal Wins?"');
    const proudInfo = html.indexOf('aria-label="What are Proud Moments?"');
    expect(html.slice(html.indexOf(">33<"), html.indexOf("TOTAL VICTORIES"))).not.toContain("<svg");
    expect(html.slice(html.indexOf(">7<"), html.indexOf("GOAL WINS"))).toContain("<svg");
    expect(html.slice(html.indexOf(">26<"), html.indexOf("PROUD MOMENTS"))).toContain("<svg");
    expect(html.slice(html.indexOf("GOAL WINS"), goalInfo)).not.toContain("<svg");
    expect(html.slice(html.indexOf("PROUD MOMENTS"), proudInfo)).not.toContain("<svg");
    expect(html.slice(html.indexOf("TOTAL VICTORIES"), totalInfo)).not.toContain("<svg");
    expect(html).toContain("flex-col");
    expect(html).toContain("sm:flex-row");
    expect(html).toContain("h-11 w-11");
    expect(html).toContain('aria-label="What are Total Victories?"');
    expect(html).toContain('aria-label="What are Goal Wins?"');
    expect(html).toContain('aria-label="What are Proud Moments?"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Your Total Victories are your Goal Wins");
    expect(html).not.toContain("We keep score in life");
    expect(html).not.toContain("role=\"region\"");
    expect(html).not.toContain("🏆");
    expect(html.match(/aria-hidden/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("uses existing Victory Room vector icons rather than emoji or a new library", () => {
    expect(SRC).toContain("VrIconGoal");
    expect(SRC).toContain("VrIconStar");
    expect(SRC).toContain("VrIconInfo");
    expect(SRC).toContain("PROUD_MOMENT_STAT_QUOTE");
    expect(SRC).not.toContain("VrIconTrophy");
    expect(SRC).not.toContain("🏆");
    expect(SRC).toContain("flex-col items-center sm:flex-row");
    expect(SRC).toContain("h-11 w-11");
    expect(SRC).toContain("h-5 w-5");
    expect(SRC).not.toContain('span className="h-5');
    expect(SRC).not.toContain(
      "Confidence comes from seeing a stack of evidence from your own life"
    );
    expect(SRC).not.toContain("lucide");
    expect(SRC).not.toContain("<details");
    expect(SRC).not.toContain("group-hover");
    expect(SRC).not.toContain("fixed inset-0");
    expect(ICONS_SRC).not.toContain("export function VrIconTrophy");
    expect(ICONS_SRC).toContain("export function VrIconInfo");
    expect(ICONS_SRC).toContain('stroke="currentColor"');
  });

  it("opens Total, replaces with Goal, and toggles the active control closed", async () => {
    const user = userEvent.setup();
    render(React.createElement(VictorySummaryCounts, { counts }));

    expect(screen.queryByRole("region")).toBeNull();

    await user.click(screen.getByRole("button", { name: "What are Total Victories?" }));
    expect(screen.getByRole("region", { name: "Total Victories" })).toBeTruthy();
    expect(
      screen.getByText("Your Total Victories are your Goal Wins + Proud Moments.")
    ).toBeTruthy();
    expect(screen.getByText(/We keep score in life because it matters\. It counts\./)).toBeTruthy();
    expect(screen.getByText("— Pat Summitt")).toBeTruthy();
    expect(screen.queryByText(/Discipline yourself so nobody else has to/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "What are Goal Wins?" }));
    expect(screen.getByRole("region", { name: "Goal Wins" })).toBeTruthy();
    expect(
      screen.getByText(
        "A Goal Win is a time you followed through on your current goal — evidence that you did what you said you would do."
      )
    ).toBeTruthy();
    expect(screen.getByText(/Discipline yourself so nobody else has to/)).toBeTruthy();
    expect(
      screen.queryByText("Your Total Victories are your Goal Wins + Proud Moments.")
    ).toBeNull();
    expect(screen.getAllByRole("region")).toHaveLength(1);

    const goalInfo = screen.getByRole("button", { name: "What are Goal Wins?" });
    expect(goalInfo.getAttribute("aria-expanded")).toBe("true");
    await user.click(goalInfo);
    expect(screen.queryByRole("region")).toBeNull();
    expect(goalInfo.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens Proud Moments copy and closes on Escape", async () => {
    const user = userEvent.setup();
    render(React.createElement(VictorySummaryCounts, { counts }));

    await user.click(screen.getByRole("button", { name: "What are Proud Moments?" }));
    expect(screen.getByRole("region", { name: "Proud Moments" })).toBeTruthy();
    expect(
      screen.getByText(
        "A Proud Moment is a meaningful accomplishment or life moment worth remembering — evidence from your own life you can look back on."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        /Confidence comes from seeing a stack of evidence from your own life that proves what you.re capable of/
      )
    ).toBeTruthy();
    expect(
      screen.queryByText("Life gives you vision. But you can't acquire it if you're afraid of keeping score.")
    ).toBeNull();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("closes from the panel Close control", async () => {
    const user = userEvent.setup();
    render(React.createElement(VictorySummaryCounts, { counts }));
    await user.click(screen.getByRole("button", { name: "What are Total Victories?" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region")).toBeNull();
  });
});
