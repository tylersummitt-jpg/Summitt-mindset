import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("Victory Room main — legacy proof surface retirement", () => {
  const pageSrc = fs.readFileSync(
    path.join(process.cwd(), "src/app/dashboard/victory-room/page.tsx"),
    "utf8"
  );

  it("keeps Wins, Seasons, Coach Pat Feedback, and Pat Principles", () => {
    expect(pageSrc).toContain("VictoryRecentProofSection");
    expect(pageSrc).toContain("VictorySeasonsSection");
    expect(pageSrc).toContain("VictoryPatReadSection");
    expect(pageSrc).toContain("VictoryPatPrinciplesSection");
    expect(pageSrc).toContain("VictoryRoomTopCard");
  });

  it("hides Earlier Chapters proof-history link from primary Victory Room", () => {
    expect(pageSrc).not.toContain("VictoryEarlierHistoryLinkSection");
    expect(pageSrc).not.toContain("hasEarlierChapterHistory");
  });
});

describe("Victory Room Victory Calendar wiring", () => {
  const pageSrc = fs.readFileSync(
    path.join(process.cwd(), "src/app/dashboard/victory-room/page.tsx"),
    "utf8"
  );

  it("resolves month/day from Clerk TZ helpers and Slice 1 clamp, not sms_audience", () => {
    expect(pageSrc).toContain("getDateKeyInTimezone");
    expect(pageSrc).toContain("resolveUserTimezone");
    expect(pageSrc).toContain("resolveVictoryCalendarPageState");
    expect(pageSrc).toContain("loadVictoryWinMonthMarkersForUser");
    expect(pageSrc).toContain("loadPublicVictoryWinsForUserLocalDay");
    expect(pageSrc).toContain("PUBLIC_WINS_RECENT_LIMIT");
    expect(pageSrc).toContain("loadPublicVictoryWinsForUser");
    expect(pageSrc).not.toContain("sms_audience");
    expect(pageSrc).not.toContain("resolveSmsUserTimezone");
  });

  it("places the calendar after the foundation card and only in the active-commitment branch", () => {
    expect(pageSrc).toContain("VictoryCalendarSection");
    const top = pageSrc.indexOf("<VictoryRoomTopCard");
    const cal = pageSrc.indexOf("<VictoryCalendarSection");
    const wins = pageSrc.indexOf("<VictoryRecentProofSection");
    expect(top).toBeGreaterThan(-1);
    expect(cal).toBeGreaterThan(top);
    expect(wins).toBeGreaterThan(cal);
    const notReady = pageSrc.indexOf("Not quite ready");
    expect(cal).toBeGreaterThan(notReady);
    expect(pageSrc).toContain("calendarState.selectedDay");
    expect(pageSrc).toContain("Promise.resolve([] as PublicWinDto[])");
  });
});
