import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import {
  ACTIVE_EVENT_FETCH_LIMIT,
  buildVictoryEvidenceCounts,
  deriveMergedProofMomentsFromEventWindow,
  EMPTY_VICTORY_EVIDENCE_COUNTS,
  PROOF_DERIVATION_EVENT_LIMIT,
} from "@/lib/v2-victory-room-view";

describe("proof derivation event window", () => {
  it("uses the full 400-event bounded window for derivation", () => {
    expect(PROOF_DERIVATION_EVENT_LIMIT).toBe(ACTIVE_EVENT_FETCH_LIMIT);
    expect(PROOF_DERIVATION_EVENT_LIMIT).toBe(400);
  });

  it("derives proof from events beyond the old 120 cap within 400", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      id: `e${i}`,
      event_type: "user_yes",
      occurred_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 200 - i)).toISOString(),
      payload_json: {
        proof_moment: true,
        user_visible_proof_line: `Unique proof line ${i} for derivation window test.`,
      },
    }));

    const { merged } = deriveMergedProofMomentsFromEventWindow({
      eventRowsFull: rows,
      reactivationEnteredAt: null,
    });

    expect(merged.some((m) => m.id === "e150")).toBe(true);
    expect(merged.some((m) => m.id === "e0")).toBe(true);
  });
});

describe("buildVictoryEvidenceCounts", () => {
  it("activated-only window produces no numeric categories", () => {
    const rows = [
      {
        id: "e1",
        event_type: "activated",
        occurred_at: "2026-05-01T10:00:00Z",
        payload_json: {},
      },
    ];
    const { merged } = deriveMergedProofMomentsFromEventWindow({
      eventRowsFull: rows,
      reactivationEnteredAt: null,
    });
    const counts = buildVictoryEvidenceCounts(merged, 0);
    expect(counts).toEqual(EMPTY_VICTORY_EVIDENCE_COUNTS);
  });

  it("counts categories from derived moments", () => {
    const { merged } = deriveMergedProofMomentsFromEventWindow({
      eventRowsFull: [
        {
          id: "y1",
          event_type: "user_yes",
          occurred_at: "2026-05-02T10:00:00Z",
          payload_json: {},
        },
        {
          id: "n1",
          event_type: "user_no",
          occurred_at: "2026-05-01T10:00:00Z",
          payload_json: {
            proof_moment: true,
            user_visible_proof_line: "You named the miss plainly.",
          },
        },
      ],
      reactivationEnteredAt: null,
    });
    expect(merged.length).toBeGreaterThan(0);
    const counts = buildVictoryEvidenceCounts(merged, 2);
    expect(counts.toldTheTruth + counts.keptTheGoal + counts.gotBackOnTrack).toBeGreaterThan(0);
    expect(counts.seasonsCompleted).toBe(2);
  });
});
