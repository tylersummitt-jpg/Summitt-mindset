import { describe, expect, it, vi, beforeEach } from "vitest";

const mockCommitmentLimit = vi.fn();
const mockSeasonIn = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table === "v2_commitment") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: () => ({
                  limit: mockCommitmentLimit,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "user_accountability_season") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: () => mockSeasonIn(),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

import {
  EARLIER_CHAPTER_INDEX_LIMIT,
  hasEarlierChapterHistory,
  loadVictoryEarlierChapterIndex,
  pickSeasonIdForEarlierChapterLink,
} from "@/lib/v2-victory-earlier-chapter-index";

describe("v2-victory-earlier-chapter-index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSeasonIn.mockResolvedValue({ data: [], error: null });
  });

  it("hasEarlierChapterHistory false when no eligible rows after filters", async () => {
    mockCommitmentLimit.mockResolvedValue({
      data: [
        {
          id: "c-active-prior",
          title: "Old",
          status: "completed",
          started_at: "2026-01-01T00:00:00Z",
          ended_at: null,
          updated_at: null,
        },
      ],
      error: null,
    });
    const has = await hasEarlierChapterHistory({
      clerkUserId: "u1",
      activeCommitmentId: "c-active",
      excludeCommitmentIds: ["c-active-prior"],
    });
    expect(has).toBe(false);
  });

  it("hasEarlierChapterHistory true when eligible row exists", async () => {
    mockCommitmentLimit.mockResolvedValue({
      data: [
        {
          id: "c-old",
          title: "Earlier walk",
          status: "superseded",
          started_at: "2025-06-01T00:00:00Z",
          ended_at: "2025-12-01T00:00:00Z",
          updated_at: null,
        },
      ],
      error: null,
    });
    const has = await hasEarlierChapterHistory({
      clerkUserId: "u1",
      activeCommitmentId: "c-active",
      excludeCommitmentIds: ["c-season-visible"],
    });
    expect(has).toBe(true);
  });

  it("excludes active and My Seasons commitment ids", async () => {
    mockCommitmentLimit.mockResolvedValue({
      data: [
        {
          id: "c-active",
          title: "Should skip",
          status: "completed",
          started_at: "2026-01-01T00:00:00Z",
          ended_at: null,
          updated_at: null,
        },
        {
          id: "c-on-card",
          title: "On card",
          status: "completed",
          started_at: "2025-01-01T00:00:00Z",
          ended_at: null,
          updated_at: null,
        },
        {
          id: "c-hidden",
          title: "Hidden chapter",
          status: "abandoned",
          started_at: "2024-01-01T00:00:00Z",
          ended_at: "2024-06-01T00:00:00Z",
          updated_at: null,
        },
      ],
      error: null,
    });
    const index = await loadVictoryEarlierChapterIndex({
      clerkUserId: "u1",
      activeCommitmentId: "c-active",
      excludeCommitmentIds: ["c-on-card"],
    });
    expect(index.chapters).toHaveLength(1);
    expect(index.chapters[0]?.commitmentId).toBe("c-hidden");
    expect(index.chapters[0]?.statusLabel).toBe("Ended");
  });

  it("caps index at 15 rows", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `c-${i}`,
      title: `Chapter ${i}`,
      status: "completed",
      started_at: `2020-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      ended_at: null,
      updated_at: null,
    }));
    mockCommitmentLimit.mockResolvedValue({ data: rows, error: null });
    const index = await loadVictoryEarlierChapterIndex({
      clerkUserId: "u1",
      activeCommitmentId: null,
      excludeCommitmentIds: [],
    });
    expect(index.chapters.length).toBe(EARLIER_CHAPTER_INDEX_LIMIT);
  });

  it("links to season route when season row exists", async () => {
    mockCommitmentLimit.mockResolvedValue({
      data: [
        {
          id: "c1",
          title: "Walk",
          status: "completed",
          started_at: "2025-01-01T00:00:00Z",
          ended_at: null,
          updated_at: null,
        },
      ],
      error: null,
    });
    mockSeasonIn.mockResolvedValue({
      data: [
        {
          id: "s1",
          commitment_id: "c1",
          status: "completed",
          started_at: "2025-01-01T00:00:00Z",
        },
      ],
      error: null,
    });
    const index = await loadVictoryEarlierChapterIndex({
      clerkUserId: "u1",
      activeCommitmentId: "c-active",
      excludeCommitmentIds: [],
    });
    expect(index.chapters[0]?.linkTarget).toBe("season");
    expect(index.chapters[0]?.detailHref).toBe("/dashboard/victory-room/seasons/s1");
    expect(index.chapters[0]?.linkLabel).toBe("View season proof");
    expect(index.chapters[0]?.title).toBe("Walk");
    expect(mockSeasonIn).toHaveBeenCalled();
  });

  it("links to chapter route when no season row", async () => {
    mockCommitmentLimit.mockResolvedValue({
      data: [
        {
          id: "c2",
          title: "Run",
          status: "superseded",
          started_at: "2024-01-01T00:00:00Z",
          ended_at: null,
          updated_at: null,
        },
      ],
      error: null,
    });
    const index = await loadVictoryEarlierChapterIndex({
      clerkUserId: "u1",
      activeCommitmentId: "c-active",
      excludeCommitmentIds: [],
    });
    expect(index.chapters[0]?.linkTarget).toBe("chapter");
    expect(index.chapters[0]?.detailHref).toBe("/dashboard/victory-room/chapters/c2");
    expect(index.chapters[0]?.linkLabel).toBe("View chapter proof");
    expect(index.chapters[0]?.statusLabel).toBe("Moved to a new standard");
  });

  it("prefers completed season over active when multiple rows exist", async () => {
    mockCommitmentLimit.mockResolvedValue({
      data: [
        {
          id: "c1",
          title: "Walk",
          status: "completed",
          started_at: "2025-01-01T00:00:00Z",
          ended_at: null,
          updated_at: null,
        },
      ],
      error: null,
    });
    mockSeasonIn.mockResolvedValue({
      data: [
        {
          id: "s-active",
          commitment_id: "c1",
          status: "active",
          started_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "s-closed",
          commitment_id: "c1",
          status: "completed",
          started_at: "2025-06-01T00:00:00Z",
        },
      ],
      error: null,
    });
    const index = await loadVictoryEarlierChapterIndex({
      clerkUserId: "u1",
      activeCommitmentId: "c-active",
      excludeCommitmentIds: [],
    });
    expect(index.chapters[0]?.linkTarget).toBe("season");
    expect(index.chapters[0]?.detailHref).toBe("/dashboard/victory-room/seasons/s-closed");
  });

  it("links to chapter when only active season exists for prior commitment", async () => {
    mockCommitmentLimit.mockResolvedValue({
      data: [
        {
          id: "c1",
          title: "Walk",
          status: "superseded",
          started_at: "2025-01-01T00:00:00Z",
          ended_at: null,
          updated_at: null,
        },
      ],
      error: null,
    });
    mockSeasonIn.mockResolvedValue({
      data: [
        {
          id: "s-active-only",
          commitment_id: "c1",
          status: "active",
          started_at: "2026-01-01T00:00:00Z",
        },
      ],
      error: null,
    });
    const index = await loadVictoryEarlierChapterIndex({
      clerkUserId: "u1",
      activeCommitmentId: "c-other",
      excludeCommitmentIds: [],
    });
    expect(index.chapters[0]?.linkTarget).toBe("chapter");
    expect(index.chapters[0]?.detailHref).toBe("/dashboard/victory-room/chapters/c1");
  });

  it("pickSeasonIdForEarlierChapterLink chooses newest completed by started_at", () => {
    const id = pickSeasonIdForEarlierChapterLink([
      {
        id: "s-old",
        commitment_id: "c1",
        status: "completed",
        started_at: "2024-01-01T00:00:00Z",
      },
      {
        id: "s-new",
        commitment_id: "c1",
        status: "archived",
        started_at: "2025-01-01T00:00:00Z",
      },
    ]);
    expect(id).toBe("s-new");
  });

  it("does not label chapter-only rows as seasons in copy", async () => {
    mockCommitmentLimit.mockResolvedValue({
      data: [
        {
          id: "c2",
          title: "Run",
          status: "abandoned",
          started_at: "2024-01-01T00:00:00Z",
          ended_at: null,
          updated_at: null,
        },
      ],
      error: null,
    });
    const index = await loadVictoryEarlierChapterIndex({
      clerkUserId: "u1",
      activeCommitmentId: null,
      excludeCommitmentIds: [],
    });
    expect(index.chapters[0]?.linkLabel).not.toMatch(/season/i);
  });
});
