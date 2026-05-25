import { describe, expect, it, vi, beforeEach } from "vitest";

const mockMaybeSingle = vi.fn();
const mockUpsert = vi.fn();
const mockInSelect = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table === "v2_victory_season_summary_snapshot") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: mockMaybeSingle,
              }),
              in: () => mockInSelect,
            }),
          }),
          upsert: mockUpsert,
        };
      }
      if (table === "v2_victory_pat_read_snapshot") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "v2_victory_pat_principles_snapshot") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
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
  computeSeasonSummarySourceBundle,
  computeSeasonSummarySourceHash,
  getValidForSeasonKey,
  loadSeasonSummaryForDisplay,
} from "@/lib/v2-victory-season-summary-persist";
import type { VictoryMoment } from "@/lib/v2-victory-room-view";

const moments: VictoryMoment[] = [
  {
    id: "m1",
    occurredAt: "2026-05-01T10:00:00Z",
    headline: "Honesty",
    body: "Named it.",
    groundedInEventTypes: [],
  },
  {
    id: "m2",
    occurredAt: "2026-05-02T10:00:00Z",
    headline: "Comeback",
    body: "Came back.",
    groundedInEventTypes: [],
  },
  {
    id: "m3",
    occurredAt: "2026-05-03T10:00:00Z",
    headline: "Bar adjusted",
    body: "Raised bar.",
    groundedInEventTypes: [],
  },
];

describe("v2-victory-season-summary-persist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsert.mockResolvedValue({ error: null });
  });

  it("source hash is stable", () => {
    const bundle = computeSeasonSummarySourceBundle({
      seasonId: "s1",
      commitmentId: "c1",
      seasonStatus: "completed",
      proofMoments: moments,
      proofMomentCount: 3,
    });
    const a = computeSeasonSummarySourceHash(bundle);
    const b = computeSeasonSummarySourceHash(bundle);
    expect(a).toBe(b);
  });

  it("no active-season write path returns null from loader", async () => {
    const result = await loadSeasonSummaryForDisplay({
      clerkUserId: "u1",
      seasonId: "s1",
      commitmentId: "c1",
      seasonStatus: "active",
      proofMoments: moments,
      proofMomentCount: 3,
    });
    expect(result).toBeNull();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("completed threshold triggers upsert", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const result = await loadSeasonSummaryForDisplay({
      clerkUserId: "u1",
      seasonId: "s1",
      commitmentId: "c1",
      seasonStatus: "completed",
      proofMoments: moments,
      proofMomentCount: 3,
    });
    expect(result?.summaryText).toBeTruthy();
    expect(mockUpsert).toHaveBeenCalled();
  });

  it("matching hash does not rewrite", async () => {
    const bundle = computeSeasonSummarySourceBundle({
      seasonId: "s1",
      commitmentId: "c1",
      seasonStatus: "completed",
      proofMoments: moments,
      proofMomentCount: 3,
    });
    const hash = computeSeasonSummarySourceHash(bundle);
    mockMaybeSingle.mockResolvedValue({
      data: {
        summary_text: "Saved summary.",
        pattern_text: null,
        principle_lived_title: null,
        confidence: "medium",
        source_hash: hash,
        valid_for_season_key: getValidForSeasonKey("s1", "completed"),
        input_bundle_json: bundle,
        reason_for_update: "initial",
      },
      error: null,
    });
    await loadSeasonSummaryForDisplay({
      clerkUserId: "u1",
      seasonId: "s1",
      commitmentId: "c1",
      seasonStatus: "completed",
      proofMoments: moments,
      proofMomentCount: 3,
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("DB upsert failure returns deterministic fallback", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockUpsert.mockResolvedValue({ error: { message: "write failed" } });
    const result = await loadSeasonSummaryForDisplay({
      clerkUserId: "u1",
      seasonId: "s1",
      commitmentId: "c1",
      seasonStatus: "completed",
      proofMoments: moments,
      proofMomentCount: 3,
    });
    expect(result?.summaryText).toBeTruthy();
  });

  it("bundle excludes payload_json", () => {
    const serialized = JSON.stringify(
      computeSeasonSummarySourceBundle({
        seasonId: "s1",
        commitmentId: "c1",
        seasonStatus: "completed",
        proofMoments: moments,
        proofMomentCount: 3,
      })
    );
    expect(serialized).not.toContain("payload_json");
    expect(serialized).not.toContain("important_people");
  });
});
