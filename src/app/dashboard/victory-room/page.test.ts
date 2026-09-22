import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { PROUD_MOMENT_STAT_QUOTE } from "@/lib/v2-victory-room-display";

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
    expect(pageSrc).toContain("loadPublicVictoryWinsForUser");
    expect(pageSrc).toContain("recentLimit: 3");
    expect(pageSrc).not.toContain("PUBLIC_WINS_RECENT_LIMIT");
    expect(pageSrc).not.toContain(".slice(0, 3)");
    expect(pageSrc).not.toContain("sms_audience");
    expect(pageSrc).not.toContain("resolveSmsUserTimezone");
  });

  it("places the calendar in the proof-section slot, not as a later sibling", () => {
    expect(pageSrc).toContain("VictoryCalendarSection");
    expect(pageSrc).toContain("betweenToolbarAndList");
    const top = pageSrc.indexOf("<VictoryRoomTopCard");
    const wins = pageSrc.indexOf("<VictoryRecentProofSection");
    const cal = pageSrc.indexOf("<VictoryCalendarSection");
    const slot = pageSrc.indexOf("betweenToolbarAndList");
    const pat = pageSrc.indexOf("<VictoryPatReadSection");
    expect(top).toBeGreaterThan(-1);
    expect(wins).toBeGreaterThan(top);
    expect(slot).toBeGreaterThan(wins);
    expect(cal).toBeGreaterThan(slot);
    expect(pat).toBeGreaterThan(cal);
    expect((pageSrc.match(/<VictoryCalendarSection/g) ?? []).length).toBe(1);
    expect(pageSrc.slice(wins, pat)).toContain("<VictoryCalendarSection");
    expect(pageSrc.slice(pat)).not.toContain("VictoryCalendarSection");
    expect(pageSrc).not.toMatch(
      /<VictoryRecentProofSection[\s\S]*?\/>\s*<VictoryCalendarSection/
    );
    const notReady = pageSrc.indexOf("Not quite ready");
    expect(cal).toBeGreaterThan(notReady);
    expect(pageSrc).toContain("calendarState.selectedDay");
    expect(pageSrc).toContain("Promise.resolve([] as PublicWinDto[])");
    const calendarSrc = fs.readFileSync(
      path.join(process.cwd(), "src/components/VictoryCalendarSection.tsx"),
      "utf8"
    );
    expect(calendarSrc).toContain('title="Victory Calendar"');
    expect(calendarSrc).toContain("Your victories, one day at a time.");
  });

  it("keeps a single page H1 outside the foundation card", () => {
    const headerMatches = pageSrc.match(/<h1\b/g) ?? [];
    expect(headerMatches).toHaveLength(1);
    const h1 = pageSrc.indexOf("<h1");
    const top = pageSrc.indexOf("<VictoryRoomTopCard");
    const wins = pageSrc.indexOf("<VictoryRecentProofSection");
    expect(h1).toBeGreaterThan(-1);
    expect(top).toBeGreaterThan(h1);
    expect(wins).toBeGreaterThan(top);
    expect(pageSrc).toContain(">Victory Room<");
    expect(pageSrc).toContain("PROUD_MOMENT_STAT_QUOTE");
    expect(pageSrc).toContain('from "@/lib/v2-victory-room-display"');
    expect(pageSrc).toContain("“{PROUD_MOMENT_STAT_QUOTE}”");
    expect(pageSrc).toContain("— Pat Summitt");
    expect(pageSrc).not.toContain("Build your identity one day at a time.");
    expect(pageSrc).not.toContain(
      "Confidence comes from seeing a stack of evidence from your own life"
    );
    expect(PROUD_MOMENT_STAT_QUOTE).toBe(
      "Confidence comes from seeing a stack of evidence from your own life that proves what you’re capable of."
    );
    expect(PROUD_MOMENT_STAT_QUOTE).not.toContain("Pat Summitt");
    expect(pageSrc).toContain("vrSectionSubtitle");
    const tagline = pageSrc.indexOf("{PROUD_MOMENT_STAT_QUOTE}");
    expect(tagline).toBeGreaterThan(h1);
    expect(top).toBeGreaterThan(tagline);
    expect(pageSrc).not.toContain("A place to remember who you&apos;re becoming");
    expect(pageSrc).not.toContain("saved from your");
    expect(pageSrc).not.toContain("real choices.");
    expect(pageSrc).not.toContain("mt-1.5 mb-6 max-w-2xl text-sm text-stone-400 sm:mb-8 sm:text-base");
    expect(pageSrc).toContain("mb-5 sm:mb-6");
    const topCard = fs.readFileSync(
      path.join(process.cwd(), "src/components/VictoryRoomTopCard.tsx"),
      "utf8"
    );
    expect(topCard).not.toContain("<h1");
    expect(topCard).not.toContain(">Victory Room<");
  });
});

describe("Victory Room Proud Moments vocabulary", () => {
  const files = [
    "src/components/Navbar.tsx",
    "src/components/VictoryRoomTopCard.tsx",
    "src/components/VictoryRecentProofSection.tsx",
    "src/components/VictoryCalendarSection.tsx",
    "src/components/VictoryCalendarGrid.tsx",
    "src/components/VictoryAllProofSection.tsx",
    "src/components/VictorySeasonWinsSection.tsx",
    "src/components/VictorySeasonsSection.tsx",
    "src/components/VictoryWinCard.tsx",
    "src/components/VictoryWinCardActions.tsx",
    "src/components/VictoryProudMomentsEditChrome.tsx",
    "src/components/VictorySummaryCounts.tsx",
    "src/components/VictoryWinMediaImage.tsx",
    "src/components/VictoryPatReadSection.tsx",
    "src/app/dashboard/victory-room/page.tsx",
    "src/app/dashboard/victory-room/add-win/add-win-client.tsx",
    "src/app/dashboard/victory-room/wins/[winId]/edit/edit-win-client.tsx",
    "src/app/dashboard/victory-room/seasons/[seasonId]/page.tsx",
  ];

  function read(rel: string) {
    return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
  }

  it("keeps Victory Room as the product name in nav and H1", () => {
    expect(read("src/components/Navbar.tsx")).toContain('label: "Victory Room"');
    expect(read("src/app/dashboard/victory-room/page.tsx")).toContain(">Victory Room<");
    expect(read("src/components/VictoryRoomTopCard.tsx")).not.toContain(">Victory Room<");
    expect(read("src/components/VictoryPatReadSection.tsx")).toContain("What I'm proud of");
  });

  it("does not keep retired Win archive labels in production Victory Room UI", () => {
    const forbidden = [
      "Your Wins",
      "Add a Win",
      "All Wins",
      "View all Wins",
      "No Wins yet",
      "Edit Win",
      "Delete Win",
      "Delete this Win?",
      "Win actions",
      "Save Win",
      "Saving Win",
      "Your Win was saved",
      "Overall only",
      "Wins from this season",
    ];
    for (const rel of files) {
      const src = read(rel);
      for (const phrase of forbidden) {
        expect(src, `${rel} still contains ${JSON.stringify(phrase)}`).not.toContain(phrase);
      }
    }
  });
});
