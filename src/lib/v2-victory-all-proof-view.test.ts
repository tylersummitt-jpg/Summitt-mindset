import { describe, expect, it, vi, beforeEach } from "vitest";

const mockCommitmentsSelect = vi.fn();
const mockEventsSelect = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table === "v2_commitment") {
        return {
          select: () => ({
            eq: () => mockCommitmentsSelect(),
          }),
        };
      }
      if (table === "v2_commitment_event") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => mockEventsSelect(),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

import { ALL_PROOF_EVENT_FETCH_LIMIT } from "@/lib/v2-victory-room-view";
import { loadVictoryAllProofView } from "@/lib/v2-victory-all-proof-view";

describe("loadVictoryAllProofView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCommitmentsSelect.mockResolvedValue({
      data: [
        { id: "c-active", reactivation_entered_at: null },
        { id: "c-prior", reactivation_entered_at: null },
      ],
      error: null,
    });
  });

  it("includes proof from multiple commitments", async () => {
    mockEventsSelect.mockResolvedValue({
      data: [
        {
          id: "e1",
          event_type: "user_yes",
          occurred_at: "2026-06-10T12:00:00Z",
          commitment_id: "c-active",
          payload_json: { proof_moment: true, proof_meaning_line: "Active yes." },
        },
        {
          id: "e2",
          event_type: "user_yes",
          occurred_at: "2026-05-01T12:00:00Z",
          commitment_id: "c-prior",
          payload_json: { proof_moment: true, proof_meaning_line: "Prior yes." },
        },
      ],
      error: null,
    });

    const view = await loadVictoryAllProofView("user_1");
    expect(view.allProofMoments.length).toBeGreaterThan(1);
    expect(view.allProofMoments.map((m) => m.id)).toContain("e1");
    expect(view.allProofMoments.map((m) => m.id)).toContain("e2");
    expect(view.allProofTruncated).toBe(false);
  });

  it("can return more than seven proof moments", async () => {
    mockEventsSelect.mockResolvedValue({
      data: Array.from({ length: 12 }, (_, i) => ({
        id: `e-${i}`,
        event_type: "user_yes",
        occurred_at: `2026-06-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
        commitment_id: "c-active",
        payload_json: { proof_moment: true, proof_meaning_line: "Yes." },
      })),
      error: null,
    });

    const view = await loadVictoryAllProofView("user_1");
    expect(view.allProofMoments.length).toBeGreaterThan(7);
  });

  it("excludes non-proof blocker rows without proof lines", async () => {
    mockEventsSelect.mockResolvedValue({
      data: [
        {
          id: "bc-no-proof",
          event_type: "blocker_captured",
          occurred_at: "2026-06-10T12:00:00Z",
          commitment_id: "c-active",
          payload_json: { message: "work was crazy" },
        },
        {
          id: "yes-1",
          event_type: "user_yes",
          occurred_at: "2026-06-09T12:00:00Z",
          commitment_id: "c-active",
          payload_json: {},
        },
      ],
      error: null,
    });

    const view = await loadVictoryAllProofView("user_1");
    expect(view.allProofMoments.map((m) => m.id)).toContain("yes-1");
    expect(view.allProofMoments.map((m) => m.id)).not.toContain("bc-no-proof");
  });

  it("sets allProofTruncated when event query hits limit", async () => {
    mockEventsSelect.mockResolvedValue({
      data: Array.from({ length: ALL_PROOF_EVENT_FETCH_LIMIT }, (_, i) => ({
        id: `e-${i}`,
        event_type: "user_yes",
        occurred_at: "2026-06-01T12:00:00Z",
        commitment_id: "c-active",
        payload_json: {},
      })),
      error: null,
    });

    const view = await loadVictoryAllProofView("user_1");
    expect(view.allProofTruncated).toBe(true);
  });
});
