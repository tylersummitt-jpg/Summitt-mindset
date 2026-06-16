import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import {
  buildShareSnippetFromMoment,
  VICTORY_SHARE_BRAND,
  VICTORY_SHARE_LEDE,
  VICTORY_SHARE_URL,
  type VictoryRoomViewForShare,
} from "@/lib/v2-victory-share-snippet";

function baseView(overrides: Partial<VictoryRoomViewForShare> = {}): VictoryRoomViewForShare {
  return {
    hasActiveV2Commitment: true,
    profile: {
      preferred_name: "Brooke",
      identity_anchor_text: "I keep my word when it's hard.",
    },
    commitment: { id: "c1", title: "Morning writing", behavior_statement: null },
    activeSeason: null,
    effectiveCoachingAsk: "Write 20 minutes before noon.",
    chapterRecord: {
      openedAt: null,
      firstProofAt: null,
      latestProofAt: null,
      proofCategoryLabels: [],
      earlierSeasonCount: 0,
    },
    moments: [
      {
        id: "m1",
        occurredAt: "2026-05-01T12:00:00Z",
        headline: "Stayed engaged",
        body: "You stayed engaged instead of disappearing.",
        groundedInEventTypes: ["user_partial"],
      },
    ],
    recentWins: [
      {
        id: "m1",
        occurredAt: "2026-05-01T12:00:00Z",
        headline: "Stayed engaged",
        body: "You stayed engaged instead of disappearing.",
        groundedInEventTypes: ["user_partial"],
      },
    ],
    proofFeedMoments: [
      {
        id: "m1",
        occurredAt: "2026-05-01T12:00:00Z",
        headline: "Stayed engaged",
        body: "You stayed engaged instead of disappearing.",
        groundedInEventTypes: ["user_partial"],
      },
    ],
    comebackLines: [],
    isDayZeroUser: false,
    hasSparseProof: false,
    evidenceCounts: {
      keptTheGoal: 0,
      toldTheTruth: 0,
      gotBackOnTrack: 0,
      adjustedWisely: 0,
      raisedTheBar: 0,
      seasonsCompleted: 0,
    },
    pastSeasons: [],
    optionalMemoryProjectionLine: null,
    archiveMoments: [],
    priorChapters: [],
    cornerstoneMoments: [],
    share_identity_line: "Brooke",
    ...overrides,
  };
}

describe("buildShareSnippetFromMoment (Victory Card V1)", () => {
  it("includes category, meaning, brand/link in plainText", () => {
    const snippet = buildShareSnippetFromMoment(baseView(), "m1", {
      categoryLabel: "Told the truth",
      dateLabel: "May 1, 2026",
    });
    expect(snippet).not.toBeNull();
    expect(snippet!.plainText).toContain(VICTORY_SHARE_LEDE);
    expect(snippet!.plainText).toContain("Told the truth");
    expect(snippet!.plainText).toContain("You stayed engaged instead of disappearing.");
    expect(snippet!.plainText).toContain(VICTORY_SHARE_BRAND);
    expect(snippet!.plainText).toContain(VICTORY_SHARE_URL);
    expect(snippet!.categoryLabel).toBe("Told the truth");
    expect(snippet!.dateLabel).toBe("May 1, 2026");
  });

  it("excludes identity anchor and current bar by default", () => {
    const snippet = buildShareSnippetFromMoment(baseView(), "m1", {
      categoryLabel: "Kept the goal",
      dateLabel: "May 1, 2026",
    });
    expect(snippet).not.toBeNull();
    expect(snippet!.plainText).not.toContain("I keep my word");
    expect(snippet!.plainText).not.toContain("Current bar");
    expect(snippet!.plainText).not.toContain("Write 20 minutes");
    expect(snippet!.plainText).not.toContain("Brooke");
    expect(snippet!.plainText).not.toContain("Morning writing");
  });

  it("does not include phone/email or internal terms in plainText", () => {
    const snippet = buildShareSnippetFromMoment(baseView(), "m1");
    expect(snippet).not.toBeNull();

    const forbidden = [
      "spine",
      "event_type",
      "user_partial",
      "sms_memory_signal",
      "payload_json",
      "v2_commitment_event",
      "@",
      "555-",
    ];
    for (const term of forbidden) {
      expect(snippet!.plainText.toLowerCase()).not.toContain(term);
    }
  });

  it("formats quote and meaning without duplication", () => {
    const moment = {
      id: "m-dup",
      occurredAt: "2026-05-01T12:00:00Z",
      headline: "Proof in the thread",
      body: "You followed through when it counted.",
      quote: "I came back today and got the two hours done.",
      meaning: "You followed through when it counted.",
      groundedInEventTypes: ["user_yes"],
    };
    const view = baseView({
      moments: [moment],
      recentWins: [moment],
      shareProofMoments: [moment],
    });

    const snippet = buildShareSnippetFromMoment(view, "m-dup", {
      categoryLabel: "Kept the goal",
      dateLabel: "May 2, 2026",
    });
    expect(snippet).not.toBeNull();
    expect(snippet!.quote).toBe("I came back today and got the two hours done.");
    expect(snippet!.meaning).toBe("You followed through when it counted.");
    expect(snippet!.plainText).toContain('"I came back today and got the two hours done."');
    expect(snippet!.plainText).toContain("You followed through when it counted.");
    expect(snippet!.plainText).not.toContain("[VISUAL TEST]");
    expect(snippet!.plainText.match(/I came back today and got the two hours done/g)?.length).toBe(1);
  });

  it("finds moments via shareProofMoments when not in moments", () => {
    const view = baseView({
      moments: [],
      recentWins: [],
      shareProofMoments: [
        {
          id: "m-share",
          occurredAt: "2026-05-03T12:00:00Z",
          headline: "Kept your word",
          body: "You followed through when it counted.",
          groundedInEventTypes: ["user_yes"],
        },
      ],
    });
    const snippet = buildShareSnippetFromMoment(view, "m-share", {
      categoryLabel: "Kept the goal",
    });
    expect(snippet).not.toBeNull();
    expect(snippet!.meaning).toContain("followed through");
  });

  it("uses meaning line instead of contextless quote in share", () => {
    const moment = {
      id: "m-good",
      occurredAt: "2026-06-07T12:00:00Z",
      headline: "Honesty",
      body: "You named the obstacle instead of hiding.",
      meaning: "You named the obstacle instead of hiding.",
      quote: "Good",
      groundedInEventTypes: ["blocker_captured"],
    };
    const snippet = buildShareSnippetFromMoment(
      baseView({ shareProofMoments: [moment], recentWins: [moment], moments: [moment] }),
      "m-good",
      { categoryLabel: "Told the truth" }
    );
    expect(snippet).not.toBeNull();
    expect(snippet!.quote).toBeNull();
    expect(snippet!.meaning).toBe("You named the obstacle instead of hiding.");
    expect(snippet!.plainText).not.toContain('"Good"');
    expect(snippet!.plainText).toContain("You named the obstacle instead of hiding.");
  });

  it("uses verbatim quote in share when self-explanatory", () => {
    const moment = {
      id: "m-miss",
      occurredAt: "2026-06-07T12:00:00Z",
      headline: "Honest miss",
      body: "You stayed in the conversation instead of disappearing.",
      meaning: "You stayed in the conversation instead of disappearing.",
      quote: "I did not hit my goal yesterday",
      groundedInEventTypes: ["user_partial"],
    };
    const snippet = buildShareSnippetFromMoment(
      baseView({ shareProofMoments: [moment], recentWins: [moment], moments: [moment] }),
      "m-miss",
      { categoryLabel: "Told the truth" }
    );
    expect(snippet).not.toBeNull();
    expect(snippet!.quote).toBe("I did not hit my goal yesterday");
    expect(snippet!.plainText).toContain('"I did not hit my goal yesterday"');
  });
});
