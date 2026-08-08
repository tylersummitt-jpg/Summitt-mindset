import { describe, expect, it, vi, beforeEach } from "vitest";

const mockCommitmentMaybeSingle = vi.fn();
const mockEventsLimit = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
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
import { loadVictoryEarlierChapterProofView } from "@/lib/v2-victory-earlier-chapter-proof-view";

describe("v2-victory-earlier-chapter-proof-view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommitmentMaybeSingle.mockResolvedValue({
      data: {
        id: "c1",
        clerk_user_id: "u1",
        title: "Morning walk",
        behavior_statement: "Walk before work",
        status: "completed",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: "2025-06-01T00:00:00Z",
        reactivation_entered_at: null,
      },
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
    mockCommitmentMaybeSingle.mockResolvedValue({
      data: {
        id: "c1",
        clerk_user_id: "other",
        title: "Walk",
        behavior_statement: "Walk",
        status: "completed",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        reactivation_entered_at: null,
      },
      error: null,
    });
    const view = await loadVictoryEarlierChapterProofView({
      clerkUserId: "u1",
      commitmentId: "c1",
    });
    expect(view).toBeNull();
  });

  it("rejects active commitment", async () => {
    mockCommitmentMaybeSingle.mockResolvedValue({
      data: {
        id: "c1",
        clerk_user_id: "u1",
        title: "Walk",
        behavior_statement: "Walk",
        status: "active",
        started_at: "2025-01-01T00:00:00Z",
        ended_at: null,
        reactivation_entered_at: null,
      },
      error: null,
    });
    const view = await loadVictoryEarlierChapterProofView({
      clerkUserId: "u1",
      commitmentId: "c1",
    });
    expect(view).toBeNull();
  });

  it("loads events with max 400 limit and curates max 20", async () => {
    const view = await loadVictoryEarlierChapterProofView({
      clerkUserId: "u1",
      commitmentId: "c1",
    });
    expect(mockEventsLimit).toHaveBeenCalledWith(ACTIVE_EVENT_FETCH_LIMIT);
    expect(view?.proofMoments.length).toBeLessThanOrEqual(20);
    expect(view?.proofMoments[0]?.categoryLabel).toBeTruthy();
    expect(view?.proofMoments[0]?.body).toBeTruthy();
    expect(view?.proofMoments[0]).not.toHaveProperty("payload_json");
    expect(view?.proofMoments[0]).not.toHaveProperty("event_type");
  });

  it("chapter title uses behavior_statement and never legacy title", async () => {
    mockCommitmentMaybeSingle.mockResolvedValue({
      data: {
        id: "c1",
        clerk_user_id: "u1",
        title: "SaaS App",
        behavior_statement: "Lift weights for 15 minutes a day",
        status: "superseded",
        started_at: "2026-05-25T00:00:00Z",
        ended_at: "2026-08-08T00:00:00Z",
        reactivation_entered_at: null,
      },
      error: null,
    });
    const view = await loadVictoryEarlierChapterProofView({
      clerkUserId: "u1",
      commitmentId: "c1",
    });
    expect(view?.title).toBe("Lift weights for 15 minutes a day");
    expect(view?.title).not.toContain("SaaS App");
    expect(view?.behaviorStatement).toBe("Lift weights for 15 minutes a day");
  });

  it("does not fall back to title when behavior is missing", async () => {
    mockCommitmentMaybeSingle.mockResolvedValue({
      data: {
        id: "c1",
        clerk_user_id: "u1",
        title: "SaaS App",
        behavior_statement: null,
        status: "completed",
        started_at: "2026-01-01T00:00:00Z",
        ended_at: null,
        reactivation_entered_at: null,
      },
      error: null,
    });
    const view = await loadVictoryEarlierChapterProofView({
      clerkUserId: "u1",
      commitmentId: "c1",
    });
    expect(view?.title).toBe("Goal unavailable");
    expect(view?.title).not.toContain("SaaS App");
  });

  it("system events do not create curated proof", async () => {
    mockEventsLimit.mockResolvedValue({
      data: [
        {
          id: "e-sys",
          event_type: "system_ping",
          occurred_at: "2026-05-02T10:00:00Z",
          payload_json: { secret: true },
        },
      ],
      error: null,
    });
    const view = await loadVictoryEarlierChapterProofView({
      clerkUserId: "u1",
      commitmentId: "c1",
    });
    expect(view?.hasCuratedProof).toBe(false);
    expect(view?.hasDerivedProofInWindow).toBe(false);
    expect(view?.proofMoments).toHaveLength(0);
  });
});
