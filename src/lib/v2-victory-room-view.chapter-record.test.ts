import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import { buildChapterRecord, type VictoryMoment } from "@/lib/v2-victory-room-view";

type EventRowLike = { occurred_at: string };

function m(args: {
  id: string;
  occurredAt: string;
  headline: string;
  body: string;
  groundedInEventTypes?: string[];
}): VictoryMoment {
  return {
    id: args.id,
    occurredAt: args.occurredAt,
    headline: args.headline,
    body: args.body,
    groundedInEventTypes: args.groundedInEventTypes ?? [],
  };
}

describe("buildChapterRecord (Phase 6 Chapter Record)", () => {
  it("new user/no proof: returns null dates, empty labels, and no weird values", () => {
    const chapter = buildChapterRecord({
      commitmentStartedAt: null,
      eventRowsFull: [] as unknown as any[],
      moments: [],
      archiveMoments: [],
      cornerstoneMoments: [],
      earlierSeasonCount: 0,
    });

    expect(chapter.openedAt).toBeNull();
    expect(chapter.firstProofAt).toBeNull();
    expect(chapter.latestProofAt).toBeNull();
    expect(chapter.proofCategoryLabels).toEqual([]);
    expect(chapter.earlierSeasonCount).toBe(0);
    expect(String(chapter.openedAt)).not.toContain("NaN");
  });

  it("openedAt prefers commitment.started_at, otherwise earliest event occurred_at", () => {
    const eventRowsFull = [
      { occurred_at: "2026-05-05T10:00:00Z" },
      { occurred_at: "2026-05-02T10:00:00Z" },
      { occurred_at: "2026-05-03T10:00:00Z" },
    ] as unknown as EventRowLike[];

    const a = buildChapterRecord({
      commitmentStartedAt: "2026-05-01T00:00:00Z",
      eventRowsFull: eventRowsFull as unknown as any[],
      moments: [],
      archiveMoments: [],
      cornerstoneMoments: [],
      earlierSeasonCount: 0,
    });
    expect(a.openedAt).toBe("2026-05-01T00:00:00Z");

    const b = buildChapterRecord({
      commitmentStartedAt: null,
      eventRowsFull: eventRowsFull as unknown as any[],
      moments: [],
      archiveMoments: [],
      cornerstoneMoments: [],
      earlierSeasonCount: 0,
    });
    expect(b.openedAt).toBe("2026-05-02T10:00:00Z");
  });

  it("derives firstProofAt/latestProofAt from derived proof pools and returns only human labels", () => {
    const moments = [
      m({
        id: "composite:honesty:test",
        occurredAt: "2026-05-03T10:00:00Z",
        headline: "Honesty",
        body: "You got honest and stayed in it.",
      }),
    ];
    const archiveMoments = [
      m({
        id: "m2",
        occurredAt: "2026-05-01T10:00:00Z",
        headline: "Stayed engaged",
        body: "You stayed engaged instead of disappearing.",
      }),
    ];
    const cornerstoneMoments = [
      m({
        id: "m3",
        occurredAt: "2026-05-04T10:00:00Z",
        headline: "Honest adjustment",
        body: "You adjusted wisely instead of quitting.",
      }),
    ];

    const chapter = buildChapterRecord({
      commitmentStartedAt: null,
      eventRowsFull: [] as unknown as any[],
      moments,
      archiveMoments,
      cornerstoneMoments,
      earlierSeasonCount: 2,
    });

    expect(chapter.firstProofAt).toBe("2026-05-01T10:00:00Z");
    expect(chapter.latestProofAt).toBe("2026-05-04T10:00:00Z");
    expect(chapter.earlierSeasonCount).toBe(2);

    const blob = chapter.proofCategoryLabels.join(" ").toLowerCase();
    expect(blob).toContain("told the truth");
    expect(blob).toContain("adjusted wisely");
    expect(blob).not.toContain("came_back");
    expect(blob).not.toContain("told_the_truth");
    expect(blob).not.toContain("event_type");
    expect(blob).not.toContain("payload_json");
  });

  it("does not mutate input arrays", () => {
    const moments = [
      m({
        id: "m1",
        occurredAt: "2026-05-01T10:00:00Z",
        headline: "Stayed engaged",
        body: "You stayed engaged instead of disappearing.",
      }),
    ];
    const archiveMoments = [
      m({
        id: "m2",
        occurredAt: "2026-05-02T10:00:00Z",
        headline: "Kept your word",
        body: "You kept your word here.",
      }),
    ];
    const cornerstoneMoments = [
      m({
        id: "m3",
        occurredAt: "2026-05-03T10:00:00Z",
        headline: "Honesty",
        body: "You told the truth and stayed in it.",
      }),
    ];

    const m0 = [...moments];
    const a0 = [...archiveMoments];
    const c0 = [...cornerstoneMoments];

    buildChapterRecord({
      commitmentStartedAt: null,
      eventRowsFull: [] as unknown as any[],
      moments,
      archiveMoments,
      cornerstoneMoments,
      earlierSeasonCount: 0,
    });

    expect(moments).toEqual(m0);
    expect(archiveMoments).toEqual(a0);
    expect(cornerstoneMoments).toEqual(c0);
  });
});

