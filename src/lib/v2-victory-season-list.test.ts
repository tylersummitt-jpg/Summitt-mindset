import { describe, expect, it, vi, beforeEach } from "vitest";

const mockActiveMaybeSingle = vi.fn();
const mockPastLimit = vi.fn();
const mockCommitmentActiveMaybeSingle = vi.fn();
const mockCommitmentByIdMaybeSingle = vi.fn();
const mockEventsLimit = vi.fn();
const mockFetchHints = vi.fn();
const mockWinCountEq = vi.fn();

vi.mock("@/lib/v2-victory-season-summary-persist", () => ({
  fetchSeasonListHintsForRoom: (...args: unknown[]) => mockFetchHints(...args),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table === "user_accountability_season") {
        const orderLimitMaybeSingle = {
          order: () => ({
            limit: () => ({
              maybeSingle: mockActiveMaybeSingle,
            }),
          }),
        };
        const orderLimitPast = {
          order: () => ({
            limit: mockPastLimit,
          }),
        };
        const afterClerkUser = {
          eq: (_col: string, val: unknown) => {
            if (val === "active") {
              return orderLimitMaybeSingle;
            }
            return afterClerkUser;
          },
          in: () => orderLimitPast,
        };
        return {
          select: () => ({
            eq: (col: string) => {
              if (col === "clerk_user_id") {
                return afterClerkUser;
              }
              return afterClerkUser;
            },
          }),
        };
      }
      if (table === "v2_commitment") {
        return {
          select: () => ({
            eq: (col: string) => {
              if (col === "clerk_user_id") {
                return {
                  eq: () => ({
                    maybeSingle: mockCommitmentActiveMaybeSingle,
                  }),
                };
              }
              return {
                maybeSingle: mockCommitmentByIdMaybeSingle,
              };
            },
          }),
        };
      }
      if (table === "v2_commitment_event") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: mockEventsLimit,
              }),
            }),
          }),
        };
      }
      if (table === "v2_win") {
        return {
          select: () => ({
            in: () => ({
              eq: mockWinCountEq,
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

import { loadVictorySeasonListForRoom } from "@/lib/v2-victory-season-list";

describe("v2-victory-season-list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveMaybeSingle.mockResolvedValue({
      data: {
        id: "s-active",
        commitment_id: "c-active",
        season_name: "Season 2",
        status: "active",
        started_at: "2026-05-10T00:00:00Z",
        ended_at: null,
        goal_snapshot: { title: "Evening walk" },
      },
      error: null,
    });
    mockPastLimit.mockResolvedValue({
      data: [],
      error: null,
    });
    mockCommitmentActiveMaybeSingle.mockResolvedValue({
      data: {
        id: "c-active",
        title: "Live walking goal",
        behavior_statement: "Walk 30 min daily",
      },
      error: null,
    });
    mockCommitmentByIdMaybeSingle.mockResolvedValue({
      data: { reactivation_entered_at: null, behavior_statement: "Walk 30 min daily" },
      error: null,
    });
    mockEventsLimit.mockResolvedValue({ data: [], error: null });
    mockFetchHints.mockResolvedValue(new Map());
    mockWinCountEq.mockResolvedValue({ data: [], error: null });
  });

  it("active season no proof -> still building copy", async () => {
    const list = await loadVictorySeasonListForRoom("u1");
    expect(list.currentSeason?.statusLine).toContain("still building");
    expect(list.currentSeason?.hasSavedProof).toBe(false);
  });

  it("past season no proof -> honest captured copy", async () => {
    mockPastLimit.mockResolvedValue({
      data: [
        {
          id: "s-past",
          commitment_id: "c-past",
          season_name: "Season 1",
          status: "completed",
          started_at: "2026-01-01T00:00:00Z",
          ended_at: "2026-04-01T00:00:00Z",
          goal_snapshot: {
            title: "Morning walk",
            behavior_statement: "Walk before breakfast",
          },
        },
      ],
      error: null,
    });
    const list = await loadVictorySeasonListForRoom("u1");
    expect(list.pastSeasons[0]?.statusLine).toContain("Little was captured");
    expect(list.pastSeasons[0]?.hasSavedProof).toBe(false);
    expect(list.pastSeasons[0]?.detailHref).toBe("/dashboard/victory-room/seasons/s-past");
  });

  it("does not use raw event count as proof signal on main list", async () => {
    mockEventsLimit.mockResolvedValue({
      data: [
        {
          id: "e-sys",
          event_type: "system_ping",
          occurred_at: "2026-05-11T10:00:00Z",
          payload_json: {},
        },
        {
          id: "e-sys2",
          event_type: "routing_ack",
          occurred_at: "2026-05-11T09:00:00Z",
          payload_json: {},
        },
      ],
      error: null,
    });
    const list = await loadVictorySeasonListForRoom("u1");
    expect(list.currentSeason?.hasSavedProof).toBe(false);
    expect(list.currentSeason?.statusLine).toContain("still building");
  });

  it("active season card prefers live behavior_statement over stale title and snapshot", async () => {
    const list = await loadVictorySeasonListForRoom("u1");
    expect(list.currentSeason?.goalTitle).toBe("Walk 30 min daily");
    expect(list.currentSeason?.goalTitle).not.toBe("Live walking goal");
  });

  it("active season hides SaaS App title when behavior is lifting goal", async () => {
    mockActiveMaybeSingle.mockResolvedValue({
      data: {
        id: "s-active",
        commitment_id: "c-active",
        season_name: "Season 2",
        status: "active",
        started_at: "2026-08-08T00:00:00Z",
        ended_at: null,
        goal_snapshot: {
          title: "SaaS App",
          behavior_statement: "Lift weights for 30 minutes a day",
        },
      },
      error: null,
    });
    mockCommitmentActiveMaybeSingle.mockResolvedValue({
      data: {
        id: "c-active",
        title: "SaaS App",
        behavior_statement: "Lift weights for 30 minutes a day",
      },
      error: null,
    });
    const list = await loadVictorySeasonListForRoom("u1");
    expect(list.currentSeason?.goalTitle).toBe("Lift weights for 30 minutes a day");
    expect(list.currentSeason?.goalTitle).not.toContain("SaaS App");
  });

  it("active season card prefers user active behavior when season commitment drifted", async () => {
    mockActiveMaybeSingle.mockResolvedValue({
      data: {
        id: "s-active",
        commitment_id: "c-stale-season",
        season_name: "Season 2",
        status: "active",
        started_at: "2026-05-10T00:00:00Z",
        ended_at: null,
        goal_snapshot: {
          title: "Stale evening walk",
          behavior_statement: "Stale snapshot behavior",
        },
      },
      error: null,
    });
    mockCommitmentActiveMaybeSingle.mockResolvedValue({
      data: {
        id: "c-active-new",
        title: "Current active goal",
        behavior_statement: "Walk 30 min daily",
      },
      error: null,
    });
    const list = await loadVictorySeasonListForRoom("u1");
    expect(list.currentSeason?.goalTitle).toBe("Walk 30 min daily");
    expect(list.currentSeason?.goalTitle).not.toBe("Current active goal");
  });

  it("past season uses snapshot behavior_statement and never title", async () => {
    mockActiveMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockPastLimit.mockResolvedValue({
      data: [
        {
          id: "s-past",
          commitment_id: "c-past",
          season_name: "Season 1",
          status: "completed",
          started_at: "2026-01-01T00:00:00Z",
          ended_at: "2026-04-01T00:00:00Z",
          goal_snapshot: {
            title: "SaaS App",
            behavior_statement: "Lift weights for 15 minutes a day",
          },
        },
      ],
      error: null,
    });
    const list = await loadVictorySeasonListForRoom("u1");
    expect(list.pastSeasons[0]?.goalTitle).toBe("Lift weights for 15 minutes a day");
    expect(list.pastSeasons[0]?.goalTitle).not.toContain("SaaS App");
  });

  it("past season does not fall back to title when behavior is missing", async () => {
    mockActiveMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockPastLimit.mockResolvedValue({
      data: [
        {
          id: "s-past",
          commitment_id: "c-past",
          season_name: "Season 1",
          status: "completed",
          started_at: "2026-01-01T00:00:00Z",
          ended_at: "2026-04-01T00:00:00Z",
          goal_snapshot: { title: "SaaS App" },
        },
      ],
      error: null,
    });
    const list = await loadVictorySeasonListForRoom("u1");
    expect(list.pastSeasons[0]?.goalTitle).toBe("Goal unavailable");
    expect(list.pastSeasons[0]?.goalTitle).not.toContain("SaaS App");
  });

  it("past season uses snapshot hints for saved proof without event fetch", async () => {
    mockActiveMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockPastLimit.mockResolvedValue({
      data: [
        {
          id: "s-past",
          commitment_id: "c-past",
          season_name: "Season 1",
          status: "completed",
          started_at: "2026-01-01T00:00:00Z",
          ended_at: "2026-04-01T00:00:00Z",
          goal_snapshot: {
            title: "Morning walk",
            behavior_statement: "Walk before breakfast",
          },
        },
      ],
      error: null,
    });
    mockFetchHints.mockResolvedValue(
      new Map([
        [
          "s-past",
          {
            hasSavedProof: true,
            summary: undefined,
          },
        ],
      ])
    );
    const list = await loadVictorySeasonListForRoom("u1");
    expect(list.pastSeasons[0]?.hasSavedProof).toBe(true);
    expect(list.pastSeasons[0]?.statusLine).toBe("Proof was saved for this season.");
    expect(mockEventsLimit).not.toHaveBeenCalled();
  });

  it("attaches active winCount by commitment_id and excludes other commitments", async () => {
    mockWinCountEq.mockResolvedValue({
      data: [
        { commitment_id: "c-active" },
        { commitment_id: "c-active" },
        { commitment_id: "c-active" },
        { commitment_id: "c-past" },
      ],
      error: null,
    });
    mockPastLimit.mockResolvedValue({
      data: [
        {
          id: "s-past",
          commitment_id: "c-past",
          season_name: "Season 1",
          status: "completed",
          started_at: "2026-01-01T00:00:00Z",
          ended_at: "2026-04-01T00:00:00Z",
          goal_snapshot: { behavior_statement: "Walk before breakfast" },
        },
      ],
      error: null,
    });
    const list = await loadVictorySeasonListForRoom("u1");
    expect(list.currentSeason?.winCount).toBe(3);
    expect(list.pastSeasons[0]?.winCount).toBe(1);
  });

  it("zero wins → winCount 0 on card model", async () => {
    mockWinCountEq.mockResolvedValue({ data: [], error: null });
    const list = await loadVictorySeasonListForRoom("u1");
    expect(list.currentSeason?.winCount).toBe(0);
  });
});
