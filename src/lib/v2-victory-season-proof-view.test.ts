import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSeasonMaybeSingle = vi.fn();
const mockCommitmentMaybeSingle = vi.fn();
const mockEventsLimit = vi.fn();

vi.mock("@/lib/v2-victory-season-summary-persist", () => ({
  loadSeasonSummaryForDisplay: vi.fn(async () => null),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table === "user_accountability_season") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: mockSeasonMaybeSingle,
            }),
          }),
        };
      }
      if (table === "v2_commitment") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: mockCommitmentMaybeSingle,
            }),
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
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

import { ACTIVE_EVENT_FETCH_LIMIT } from "@/lib/v2-victory-room-view";
import { loadVictorySeasonProofView } from "@/lib/v2-victory-season-proof-view";

describe("v2-victory-season-proof-view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommitmentMaybeSingle.mockResolvedValue({
      data: { id: "c1", reactivation_entered_at: null },
      error: null,
    });
    mockEventsLimit.mockResolvedValue({
      data: [
        {
          id: "e1",
          event_type: "user_yes",
          occurred_at: "2026-05-02T10:00:00Z",
          payload_json: {},
        },
      ],
      error: null,
    });
  });

  it("returns null for wrong user", async () => {
    mockSeasonMaybeSingle.mockResolvedValue({
      data: {
        id: "s1",
        clerk_user_id: "other",
        commitment_id: "c1",
        season_name: "Season 1",
        status: "active",
        started_at: "2026-05-01T00:00:00Z",
        ended_at: null,
        goal_snapshot: { title: "Walk" },
      },
      error: null,
    });
    const view = await loadVictorySeasonProofView({
      clerkUserId: "u1",
      seasonId: "s1",
    });
    expect(view).toBeNull();
  });

  it("loads events with max 400 limit", async () => {
    mockSeasonMaybeSingle.mockResolvedValue({
      data: {
        id: "s1",
        clerk_user_id: "u1",
        commitment_id: "c1",
        season_name: "Season 1",
        status: "active",
        started_at: "2026-05-01T00:00:00Z",
        ended_at: null,
        goal_snapshot: { title: "Walk" },
      },
      error: null,
    });

    const view = await loadVictorySeasonProofView({
      clerkUserId: "u1",
      seasonId: "s1",
    });

    expect(mockEventsLimit).toHaveBeenCalledWith(ACTIVE_EVENT_FETCH_LIMIT);
    expect(view?.proofMoments.length).toBeLessThanOrEqual(20);
    expect(view?.proofMoments[0]?.body).toBeTruthy();
    expect(view?.proofMoments[0]?.categoryLabel).toBeTruthy();
    expect(view).not.toHaveProperty("patReadStrength");
    expect(view).not.toHaveProperty("patReadPattern");
  });

  it("hasProof follows curated moments, not raw event rows", async () => {
    mockEventsLimit.mockResolvedValue({
      data: [
        {
          id: "e-sys",
          event_type: "system_ping",
          occurred_at: "2026-05-02T10:00:00Z",
          payload_json: {},
        },
      ],
      error: null,
    });
    const view = await loadVictorySeasonProofView({
      clerkUserId: "u1",
      seasonId: "s1",
    });
    expect(view?.hasProof).toBe(false);
    expect(view?.proofMomentCount).toBe(0);
  });

  it("maps quote, meaning, and groundedInEventTypes from derived proof moments", async () => {
    mockSeasonMaybeSingle.mockResolvedValue({
      data: {
        id: "s1",
        clerk_user_id: "u1",
        commitment_id: "c1",
        season_name: "Season 1",
        status: "active",
        started_at: "2026-05-01T00:00:00Z",
        ended_at: null,
        goal_snapshot: { title: "Walk" },
      },
      error: null,
    });
    mockEventsLimit.mockResolvedValue({
      data: [
        {
          id: "e-yes",
          event_type: "user_yes",
          occurred_at: "2026-05-02T10:00:00Z",
          payload_json: {
            proof_moment: true,
            proof_quote: "yes I did it",
            proof_meaning_line: "You followed through when it counted.",
          },
        },
      ],
      error: null,
    });

    const view = await loadVictorySeasonProofView({
      clerkUserId: "u1",
      seasonId: "s1",
    });

    expect(view?.proofMoments).toHaveLength(1);
    expect(view?.proofMoments[0]?.quote).toBe("yes I did it");
    expect(view?.proofMoments[0]?.meaning).toBe("You followed through when it counted.");
    expect(view?.proofMoments[0]?.groundedInEventTypes).toEqual(["user_yes"]);
  });
});
