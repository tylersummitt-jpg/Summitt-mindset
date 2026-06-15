import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSeasonMaybeSingle = vi.fn();
const mockSnapshotMaybeSingle = vi.fn();
const mockUpsert = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table === "user_accountability_season") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: mockSeasonMaybeSingle,
                  }),
                }),
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
                maybeSingle: mockSnapshotMaybeSingle,
              }),
            }),
          }),
          upsert: mockUpsert,
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

import {
  classifyPrinciplesSourceChange,
  computePrinciplesSourceBundle,
  computePrinciplesSourceHash,
  getPrinciplesWeekKey,
  loadPatPrinciplesForVictoryRoom,
} from "@/lib/v2-victory-principles-persist";
import { stableSerializeForHash } from "@/lib/v2-victory-pat-read-persist";
import type { PatPrinciplesSourceBundle } from "@/lib/v2-victory-principles-persist";
import type { VictoryRoomViewData } from "@/lib/v2-victory-room-view";
import { EMPTY_VICTORY_EVIDENCE_COUNTS } from "@/lib/v2-victory-room-view";

function baseView(overrides: Partial<VictoryRoomViewData> = {}): VictoryRoomViewData {
  return {
    hasActiveV2Commitment: true,
    profile: { preferred_name: "Alex", identity_anchor_text: "Calm courage." },
    commitment: { id: "c1", title: "Morning walk", behavior_statement: "Walk 20 minutes." },
    activeSeason: { season_name: "Season 1", started_at: "2026-05-01T00:00:00Z" },
    effectiveCoachingAsk: "Walk before breakfast.",
    chapterRecord: {
      openedAt: "2026-05-01T00:00:00Z",
      firstProofAt: null,
      latestProofAt: null,
      proofCategoryLabels: [],
      earlierSeasonCount: 0,
    },
    moments: [],
    recentWins: [],
    comebackLines: [],
    isDayZeroUser: true,
    hasSparseProof: true,
    evidenceCounts: EMPTY_VICTORY_EVIDENCE_COUNTS,
    pastSeasons: [],
    optionalMemoryProjectionLine: null,
    archiveMoments: [],
    priorChapters: [],
    cornerstoneMoments: [],
    ...overrides,
  };
}

function storedSnapshot(bundle: PatPrinciplesSourceBundle, overrides: Record<string, unknown> = {}) {
  return {
    living_well_principle_id: null,
    living_well_title: null,
    living_well_text: null,
    living_well_evidence_ids: [],
    focus_next_principle_id: "take_full_responsibility",
    focus_next_title: "Take Full Responsibility",
    focus_next_text: "Practice telling the truth.",
    focus_next_evidence_ids: [],
    starter_text: "Starter",
    confidence: "starter" as const,
    provenance: "deterministic" as const,
    source_hash: computePrinciplesSourceHash(bundle),
    valid_for_week_key: "2026-W21:UTC",
    input_bundle_json: bundle,
    reason_for_update: "initial" as const,
    ...overrides,
  };
}

const WEEK = "2026-W21:UTC";

describe("Principles source hash", () => {
  it("same bundle produces same hash", () => {
    const view = baseView();
    const a = computePrinciplesSourceBundle(view, { seasonId: "s1", weekKey: WEEK })!;
    const b = computePrinciplesSourceBundle(view, { seasonId: "s1", weekKey: WEEK })!;
    expect(computePrinciplesSourceHash(a)).toBe(computePrinciplesSourceHash(b));
  });

  it("meaningful bundle change changes hash", () => {
    const sparse = computePrinciplesSourceBundle(baseView(), { weekKey: WEEK })!;
    const withProof = computePrinciplesSourceBundle(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Honesty",
            body: "Named the miss.",
            groundedInEventTypes: [],
          },
        ],
      }),
      { weekKey: WEEK }
    )!;
    expect(computePrinciplesSourceHash(sparse)).not.toBe(computePrinciplesSourceHash(withProof));
  });

  it("bundle excludes sensitive/internal fields", () => {
    const serialized = stableSerializeForHash(
      computePrinciplesSourceBundle(baseView(), { weekKey: WEEK })!
    );
    expect(serialized).not.toContain("payload_json");
    expect(serialized).not.toContain("event_type");
    expect(serialized).not.toContain("important_people");
    expect(serialized).not.toContain("proof_moment_type");
  });
});

describe("classifyPrinciplesSourceChange", () => {
  const sparseBundle = computePrinciplesSourceBundle(baseView(), {
    seasonId: "s1",
    weekKey: WEEK,
  })!;

  it("same hash does not refresh", () => {
    const hash = computePrinciplesSourceHash(sparseBundle);
    const result = classifyPrinciplesSourceChange({
      existing: storedSnapshot(sparseBundle, { source_hash: hash }),
      newBundle: sparseBundle,
      newHash: hash,
      currentWeekKey: WEEK,
    });
    expect(result.shouldRefresh).toBe(false);
  });

  it("previous week refreshes as weekly_refresh", () => {
    const result = classifyPrinciplesSourceChange({
      existing: storedSnapshot(sparseBundle, { valid_for_week_key: "2026-W20:UTC" }),
      newBundle: sparseBundle,
      newHash: "different",
      currentWeekKey: WEEK,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "weekly_refresh" });
  });

  it("same-week minor kept-goal bump does not refresh", () => {
    const proofBundle = computePrinciplesSourceBundle(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Kept your word",
            body: "Followed through.",
            groundedInEventTypes: [],
          },
        ],
      }),
      { seasonId: "s1", weekKey: WEEK }
    )!;
    const bumped = {
      ...proofBundle,
      evidence_counts: {
        ...proofBundle.evidence_counts,
        kept_the_goal: proofBundle.evidence_counts.kept_the_goal + 1,
      },
    };
    const result = classifyPrinciplesSourceChange({
      existing: storedSnapshot(proofBundle),
      newBundle: bumped,
      newHash: computePrinciplesSourceHash(bumped),
      currentWeekKey: WEEK,
    });
    expect(result.shouldRefresh).toBe(false);
  });

  it("identity change refreshes same week", () => {
    const next = computePrinciplesSourceBundle(
      baseView({
        profile: { preferred_name: "Alex", identity_anchor_text: "New anchor." },
      }),
      { seasonId: "s1", weekKey: WEEK }
    )!;
    const result = classifyPrinciplesSourceChange({
      existing: storedSnapshot(sparseBundle),
      newBundle: next,
      newHash: computePrinciplesSourceHash(next),
      currentWeekKey: WEEK,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "identity_changed" });
  });

  it("goal change refreshes same week", () => {
    const next = computePrinciplesSourceBundle(
      baseView({
        commitment: { id: "c1", title: "Evening walk", behavior_statement: "Walk 20 minutes." },
      }),
      { seasonId: "s1", weekKey: WEEK }
    )!;
    const result = classifyPrinciplesSourceChange({
      existing: storedSnapshot(sparseBundle),
      newBundle: next,
      newHash: computePrinciplesSourceHash(next),
      currentWeekKey: WEEK,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "goal_changed" });
  });

  it("season change refreshes same week", () => {
    const next = computePrinciplesSourceBundle(baseView(), { seasonId: "s2", weekKey: WEEK })!;
    const result = classifyPrinciplesSourceChange({
      existing: storedSnapshot(sparseBundle),
      newBundle: next,
      newHash: computePrinciplesSourceHash(next),
      currentWeekKey: WEEK,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "season_changed" });
  });

  it("first real proof refreshes same week", () => {
    const proofBundle = computePrinciplesSourceBundle(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Honesty",
            body: "Named it.",
            groundedInEventTypes: [],
          },
        ],
      }),
      { seasonId: "s1", weekKey: WEEK }
    )!;
    const result = classifyPrinciplesSourceChange({
      existing: storedSnapshot(sparseBundle),
      newBundle: proofBundle,
      newHash: computePrinciplesSourceHash(proofBundle),
      currentWeekKey: WEEK,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "first_real_proof" });
  });

  it("major evidence change refreshes same week", () => {
    const before = computePrinciplesSourceBundle(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        evidenceCounts: { ...EMPTY_VICTORY_EVIDENCE_COUNTS, keptTheGoal: 1 },
      }),
      { seasonId: "s1", weekKey: WEEK }
    )!;
    const after = computePrinciplesSourceBundle(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        evidenceCounts: { ...EMPTY_VICTORY_EVIDENCE_COUNTS, gotBackOnTrack: 1 },
      }),
      { seasonId: "s1", weekKey: WEEK }
    )!;
    const result = classifyPrinciplesSourceChange({
      existing: storedSnapshot(before),
      newBundle: after,
      newHash: computePrinciplesSourceHash(after),
      currentWeekKey: WEEK,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "major_evidence_change" });
  });

  it("pat_read_changed refreshes when curated proof ids change (not hash alone)", () => {
    const before = computePrinciplesSourceBundle(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Kept your word",
            body: "Body one.",
            groundedInEventTypes: [],
          },
        ],
      }),
      { seasonId: "s1", weekKey: WEEK }
    )!;
    const after = {
      ...before,
      recent_proof_moment_ids: ["m2", "m1"],
      recent_proof_bodies: ["Body two.", "Body one."],
      recent_proof_category_labels: ["Told the truth", "Kept the goal"],
      pat_read_source_hash: "hash-b",
    };
    const result = classifyPrinciplesSourceChange({
      existing: storedSnapshot(before),
      newBundle: after,
      newHash: computePrinciplesSourceHash(after),
      currentWeekKey: WEEK,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "pat_read_changed" });
  });

  it("pat read hash alone without curated input change does not refresh", () => {
    const before = { ...sparseBundle, pat_read_source_hash: "hash-a" };
    const after = { ...sparseBundle, pat_read_source_hash: "hash-b" };
    const result = classifyPrinciplesSourceChange({
      existing: storedSnapshot(before),
      newBundle: after,
      newHash: computePrinciplesSourceHash(after),
      currentWeekKey: WEEK,
    });
    expect(result.shouldRefresh).toBe(false);
  });
});

describe("loadPatPrinciplesForVictoryRoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSeasonMaybeSingle.mockResolvedValue({ data: { id: "s1" }, error: null });
    mockUpsert.mockResolvedValue({ error: null });
  });

  it("returns deterministic fallback when DB read fails", async () => {
    mockSnapshotMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "relation does not exist" },
    });
    const view = baseView();
    const result = await loadPatPrinciplesForVictoryRoom({
      clerkUserId: "user_1",
      view,
      timezone: "UTC",
    });
    expect(result).not.toBeNull();
    expect(result?.focusNext.title).toBeTruthy();
  });

  it("returns persisted snapshot when hash matches", async () => {
    const bundle = computePrinciplesSourceBundle(baseView(), {
      seasonId: "s1",
      weekKey: getPrinciplesWeekKey("UTC"),
    })!;
    const hash = computePrinciplesSourceHash(bundle);
    mockSnapshotMaybeSingle.mockResolvedValue({
      data: storedSnapshot(bundle, {
        source_hash: hash,
        valid_for_week_key: getPrinciplesWeekKey("UTC"),
        starter_text: null,
        confidence: "low",
        focus_next_text: "Saved focus copy.",
      }),
      error: null,
    });
    const result = await loadPatPrinciplesForVictoryRoom({
      clerkUserId: "user_1",
      view: baseView(),
      timezone: "UTC",
    });
    expect(result?.focusNext.text).toBe("Saved focus copy.");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("falls back when upsert fails", async () => {
    mockSnapshotMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockUpsert.mockResolvedValue({ error: { message: "write failed" } });
    const result = await loadPatPrinciplesForVictoryRoom({
      clerkUserId: "user_1",
      view: baseView(),
      timezone: "UTC",
    });
    expect(result?.starterText).toContain("tell the truth");
  });
});
