import { readFileSync } from "node:fs";
import { join } from "node:path";
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

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { VictoryCalendarSection } from "@/components/VictoryCalendarSection";
import type { PublicWinDto } from "@/lib/v2-win-public-read";

const SECTION_SRC = readFileSync(
  join(process.cwd(), "src/components/VictoryCalendarSection.tsx"),
  "utf8"
);

function win(overrides: Partial<PublicWinDto> = {}): PublicWinDto {
  return {
    id: "w1",
    occurredAt: "2026-09-14T16:00:00.000Z",
    displayTitle: "Showed up",
    displayBody: "You did the hard thing.",
    supportingQuote: null,
    celebrationAppropriate: true,
    commitmentId: null,
    updatedAt: "2026-09-14T16:05:00.000Z",
    ...overrides,
  };
}

const base = {
  monthKey: "2026-09",
  currentMonthKey: "2026-09",
  todayKey: "2026-09-15",
  counts: {} as Record<string, number>,
  timeZone: "America/New_York",
};

describe("VictoryCalendarSection import guards", () => {
  it("adds only the selected-day accent Add Win link and keeps semantic systems out", () => {
    expect(SECTION_SRC).toContain("buildCalendarAddWinHref");
    expect(SECTION_SRC).toContain("+ Add a Victory");
    expect(SECTION_SRC).toContain("vrAccentLink");
    expect(SECTION_SRC).not.toContain("vrFoundationBtn");
    expect(SECTION_SRC).not.toContain("returnTo");
    expect(SECTION_SRC).not.toContain("persistManualV2Win");
    expect(SECTION_SRC).not.toContain("/api/v2/wins/manual");
    expect(SECTION_SRC).not.toContain("sms_audience");
    expect(SECTION_SRC).not.toContain("inbound-sol");
    expect(SECTION_SRC).not.toContain("inbound-mms-d2");
    expect(SECTION_SRC).toContain("VictoryWinCard");
    expect(SECTION_SRC).toContain("showEditingControls={false}");
    expect(SECTION_SRC).not.toContain("buildEditWinHref");
    expect(SECTION_SRC).not.toContain("VictoryProudMomentsEditChrome");
    expect(SECTION_SRC).toContain("import type { PublicWinDto }");
  });
});

describe("VictoryCalendarSection selected-day detail", () => {
  it("omits the detail region when no day is selected", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryCalendarSection, {
        ...base,
        selectedDay: null,
        selectedWins: [],
      })
    );
    expect(html).toContain("Victory Calendar");
    expect(html).toContain("Your victories, one day at a time.");
    expect(html).not.toContain("Your wins, one day at a time.");
    expect(html).not.toContain("No Victories recorded yet.");
    expect(html).not.toContain("No Wins recorded yet.");
    expect(html).not.toContain("Add a Victory");
    expect(html).not.toContain("Add a Win");
  });

  it("shows empty copy and a single + Add a Win link for a selected day with no Wins", () => {
    const html = renderToStaticMarkup(
      React.createElement(VictoryCalendarSection, {
        ...base,
        selectedDay: "2026-09-15",
        selectedWins: [],
      })
    );
    expect(html).toContain("September 15");
    expect(html).toContain("No Victories recorded yet.");
    expect(html).toContain("+ Add a Victory");
    expect(html.split("Add a Victory").length - 1).toBe(1);
    expect(html).not.toContain("Add a Win");
    expect(html).toContain(
      "/dashboard/victory-room/add-win?occurredOn=2026-09-15&amp;from=calendar%3A2026-09%3A2026-09-15"
    );
  });

  it("renders existing VictoryWinCard for one and multiple Wins, including photo DTO", () => {
    const one = renderToStaticMarkup(
      React.createElement(VictoryCalendarSection, {
        ...base,
        selectedDay: "2026-09-14",
        selectedWins: [win()],
      })
    );
    expect(one).toContain("September 14");
    expect(one).toContain("1 Victory");
    expect(one).not.toContain("1 Win");
    expect(one).toContain("Showed up");
    expect(one).toContain("You did the hard thing.");
    expect(one).toContain("+ Add a Victory");
    expect(one.split("Add a Victory").length - 1).toBe(1);
    expect(one).toContain(
      "/dashboard/victory-room/add-win?occurredOn=2026-09-14&amp;from=calendar%3A2026-09%3A2026-09-14"
    );
    expect(one).not.toContain("/dashboard/victory-room/wins/w1/edit");
    expect(one).not.toContain("Edit Victory");
    expect(one).not.toContain(">Edit<");
    expect(one).not.toContain(">Delete<");
    expect(one).not.toContain("···");
    expect(one).not.toContain("<details");
    expect(one).not.toContain("from=victory-room");

    const many = renderToStaticMarkup(
      React.createElement(VictoryCalendarSection, {
        ...base,
        selectedDay: "2026-09-14",
        selectedWins: [
          win({ id: "w2", displayTitle: "Second win" }),
          win({
            id: "w3",
            displayTitle: "Photo win",
            media: {
              id: "m1",
              cardUrl: "https://signed.example/card.jpg",
              width: 100,
              height: 80,
            },
          }),
        ],
      })
    );
    expect(many).toContain("2 Victories");
    expect(many).not.toContain("2 Wins");
    expect(many).toContain("Second win");
    expect(many).toContain("Photo win");
    expect(many).toContain("https://signed.example/card.jpg");
    expect(many).toContain("alt=\"Photo attached to this proud moment\"");
    expect(many.split("Add a Victory").length - 1).toBe(1);
    expect(many).not.toContain("/dashboard/victory-room/wins/");
    expect(many).not.toContain("Edit Victory");
    expect(many).not.toContain(">Edit<");
    expect(many).not.toContain(">Delete<");
  });
});
