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
      if (table === "v2_victory_pat_read_snapshot") {
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
  buildPatReadSnapshotFromView,
  classifyPatReadSourceChange,
  computePatReadSourceBundle,
  computePatReadSourceHash,
  getPatReadDayKey,
  loadPatReadForVictoryRoom,
  stableSerializeForHash,
} from "@/lib/v2-victory-pat-read-persist";
import { buildDeterministicPatRead } from "@/lib/v2-victory-pat-read";
import type { PatReadSourceBundle } from "@/lib/v2-victory-pat-read-persist";
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

function storedSnapshot(bundle: PatReadSourceBundle, overrides: Record<string, unknown> = {}) {
  return {
    strength_text: "Saved strength.",
    pattern_text: null,
    next_move_text: "Saved next move.",
    provenance: "deterministic" as const,
    source_hash: computePatReadSourceHash(bundle),
    valid_for_day_key: "2026-05-21:UTC",
    input_bundle_json: bundle,
    pattern_confidence: bundle.pattern_confidence,
    reason_for_update: "initial" as const,
    ...overrides,
  };
}

const DAY = "2026-05-21:UTC";

describe("Pat read source hash", () => {
  it("same bundle produces same hash", () => {
    const view = baseView();
    const a = computePatReadSourceBundle(view, { seasonId: "s1" });
    const b = computePatReadSourceBundle(view, { seasonId: "s1" });
    expect(computePatReadSourceHash(a!)).toBe(computePatReadSourceHash(b!));
  });

  it("changing proof moment body changes hash", () => {
    const sparse = baseView();
    const withProof = baseView({
      isDayZeroUser: false,
      hasSparseProof: false,
      moments: [
        {
          id: "m1",
          occurredAt: "2026-05-02T10:00:00Z",
          headline: "Honesty",
          body: "You got honest and stayed in it.",
          groundedInEventTypes: ["user_yes"],
        },
      ],
    });
    const h1 = computePatReadSourceHash(computePatReadSourceBundle(sparse)!);
    const h2 = computePatReadSourceHash(computePatReadSourceBundle(withProof)!);
    expect(h1).not.toBe(h2);
  });

  it("bundle JSON does not require raw payload_json fields", () => {
    const serialized = stableSerializeForHash(computePatReadSourceBundle(baseView())!);
    expect(serialized).not.toContain("payload_json");
    expect(serialized).not.toContain("event_type");
    expect(serialized).not.toContain("important_people");
  });
});

describe("classifyPatReadSourceChange", () => {
  const sparseBundle = computePatReadSourceBundle(baseView(), { seasonId: "s1" })!;

  it("same hash does not refresh", () => {
    const hash = computePatReadSourceHash(sparseBundle);
    const result = classifyPatReadSourceChange({
      existing: storedSnapshot(sparseBundle, { source_hash: hash }),
      newBundle: sparseBundle,
      newHash: hash,
      todayDayKey: DAY,
    });
    expect(result.shouldRefresh).toBe(false);
    expect(result.reasonForUpdate).toBe("source_hash_match");
  });

  it("no existing snapshot refreshes as initial", () => {
    const result = classifyPatReadSourceChange({
      existing: null,
      newBundle: sparseBundle,
      newHash: "new",
      todayDayKey: DAY,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "initial" });
  });

  it("previous day changed hash refreshes as daily_refresh", () => {
    const result = classifyPatReadSourceChange({
      existing: storedSnapshot(sparseBundle, { valid_for_day_key: "2026-05-20:UTC" }),
      newBundle: sparseBundle,
      newHash: "different-hash",
      todayDayKey: DAY,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "daily_refresh" });
  });

  it("same-day proof count bump alone does not refresh", () => {
    const proofBundle = computePatReadSourceBundle(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Kept your word",
            body: "You followed through today.",
            groundedInEventTypes: ["user_yes"],
          },
        ],
      }),
      { seasonId: "s1" }
    )!;
    const bumped = {
      ...proofBundle,
      evidence_counts: {
        ...proofBundle.evidence_counts,
        kept_the_goal: proofBundle.evidence_counts.kept_the_goal + 1,
      },
    };
    const result = classifyPatReadSourceChange({
      existing: storedSnapshot(proofBundle),
      newBundle: bumped,
      newHash: computePatReadSourceHash(bumped),
      todayDayKey: DAY,
    });
    expect(result.shouldRefresh).toBe(false);
  });

  it("identity change refreshes same day", () => {
    const next = computePatReadSourceBundle(
      baseView({
        profile: { preferred_name: "Alex", identity_anchor_text: "New anchor line." },
      }),
      { seasonId: "s1" }
    )!;
    const result = classifyPatReadSourceChange({
      existing: storedSnapshot(sparseBundle),
      newBundle: next,
      newHash: computePatReadSourceHash(next),
      todayDayKey: DAY,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "identity_changed" });
  });

  it("goal title change refreshes same day", () => {
    const next = computePatReadSourceBundle(
      baseView({
        commitment: { id: "c1", title: "Evening walk", behavior_statement: "Walk 20 minutes." },
      }),
      { seasonId: "s1" }
    )!;
    const result = classifyPatReadSourceChange({
      existing: storedSnapshot(sparseBundle),
      newBundle: next,
      newHash: computePatReadSourceHash(next),
      todayDayKey: DAY,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "goal_changed" });
  });

  it("behavior_statement change refreshes same day", () => {
    const next = computePatReadSourceBundle(
      baseView({
        commitment: { id: "c1", title: "Morning walk", behavior_statement: "Walk 30 minutes." },
      }),
      { seasonId: "s1" }
    )!;
    const result = classifyPatReadSourceChange({
      existing: storedSnapshot(sparseBundle),
      newBundle: next,
      newHash: computePatReadSourceHash(next),
      todayDayKey: DAY,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "goal_changed" });
  });

  it("effective ask change refreshes same day", () => {
    const next = computePatReadSourceBundle(
      baseView({ effectiveCoachingAsk: "Walk after lunch." }),
      { seasonId: "s1" }
    )!;
    const result = classifyPatReadSourceChange({
      existing: storedSnapshot(sparseBundle),
      newBundle: next,
      newHash: computePatReadSourceHash(next),
      todayDayKey: DAY,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "goal_changed" });
  });

  it("season id change refreshes same day", () => {
    const next = computePatReadSourceBundle(baseView(), { seasonId: "s2" })!;
    const result = classifyPatReadSourceChange({
      existing: storedSnapshot(sparseBundle),
      newBundle: next,
      newHash: computePatReadSourceHash(next),
      todayDayKey: DAY,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "season_changed" });
  });

  it("season name change refreshes same day", () => {
    const next = computePatReadSourceBundle(
      baseView({
        activeSeason: { season_name: "Season 2", started_at: "2026-05-01T00:00:00Z" },
      }),
      { seasonId: "s1" }
    )!;
    const result = classifyPatReadSourceChange({
      existing: storedSnapshot(sparseBundle),
      newBundle: next,
      newHash: computePatReadSourceHash(next),
      todayDayKey: DAY,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "season_changed" });
  });

  it("sparse to first real proof refreshes same day", () => {
    const proofBundle = computePatReadSourceBundle(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Kept your word",
            body: "You followed through today.",
            groundedInEventTypes: ["user_yes"],
          },
        ],
      }),
      { seasonId: "s1" }
    )!;
    const result = classifyPatReadSourceChange({
      existing: storedSnapshot(sparseBundle),
      newBundle: proofBundle,
      newHash: computePatReadSourceHash(proofBundle),
      todayDayKey: DAY,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "first_real_proof" });
  });

  it("pattern confidence none to medium refreshes same day", () => {
    const prev = computePatReadSourceBundle(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Kept your word",
            body: "One moment only.",
            groundedInEventTypes: ["user_yes"],
          },
        ],
      }),
      { seasonId: "s1" }
    )!;
    const next = computePatReadSourceBundle(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Honesty",
            body: "You got honest and stayed in it.",
            groundedInEventTypes: ["user_no", "user_yes"],
          },
          {
            id: "m2",
            occurredAt: "2026-05-03T10:00:00Z",
            headline: "Honesty",
            body: "You named the miss plainly.",
            groundedInEventTypes: ["user_no"],
          },
        ],
      }),
      { seasonId: "s1" }
    )!;
    expect(next.pattern_confidence).toMatch(/medium|high/);
    const result = classifyPatReadSourceChange({
      existing: storedSnapshot(prev),
      newBundle: next,
      newHash: computePatReadSourceHash(next),
      todayDayKey: DAY,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "pattern_became_confident" });
  });

  it("first got-back-on-track evidence refreshes as major_evidence_change", () => {
    const prev = computePatReadSourceBundle(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        evidenceCounts: { ...EMPTY_VICTORY_EVIDENCE_COUNTS, keptTheGoal: 2 },
      }),
      { seasonId: "s1" }
    )!;
    const next: PatReadSourceBundle = {
      ...prev,
      evidence_counts: {
        ...prev.evidence_counts,
        got_back_on_track: 1,
      },
    };
    const result = classifyPatReadSourceChange({
      existing: storedSnapshot(prev),
      newBundle: next,
      newHash: computePatReadSourceHash(next),
      todayDayKey: DAY,
    });
    expect(result).toEqual({ shouldRefresh: true, reasonForUpdate: "major_evidence_change" });
  });
});

describe("pattern confidence gating", () => {
  it("sparse read uses none confidence and null pattern in snapshot", () => {
    const snapshot = buildPatReadSnapshotFromView({
      view: baseView(),
      displayName: "Alex",
      sourceHash: "hash",
      dayKey: "2026-05-21:UTC",
      reasonForUpdate: "initial",
    });
    expect(snapshot!.pattern_confidence).toBe("none");
    expect(snapshot!.pattern_text).toBeNull();
  });

  it("two matching honesty moments allow medium pattern text", () => {
    const view = baseView({
      isDayZeroUser: false,
      hasSparseProof: false,
      moments: [
        {
          id: "m1",
          occurredAt: "2026-05-02T10:00:00Z",
          headline: "Honesty",
          body: "You got honest and stayed in it.",
          groundedInEventTypes: ["user_no", "user_yes"],
        },
        {
          id: "m2",
          occurredAt: "2026-05-03T10:00:00Z",
          headline: "Honesty",
          body: "You named the miss plainly.",
          groundedInEventTypes: ["user_no"],
        },
      ],
    });
    const deterministic = buildDeterministicPatRead(view, "Alex");
    expect(deterministic!.pattern).not.toBeNull();
    const snapshot = buildPatReadSnapshotFromView({
      view,
      displayName: "Alex",
      sourceHash: "h",
      dayKey: "2026-05-21:UTC",
      reasonForUpdate: "pattern_became_confident",
    });
    expect(snapshot!.pattern_text).not.toBeNull();
    expect(snapshot!.linked_proof_moment_ids).toEqual(["m1", "m2"]);
  });
});

describe("loadPatReadForVictoryRoom", () => {
  beforeEach(() => {
    mockSeasonMaybeSingle.mockReset();
    mockSnapshotMaybeSingle.mockReset();
    mockUpsert.mockReset();
    mockSeasonMaybeSingle.mockResolvedValue({ data: { id: "season-1" }, error: null });
    mockUpsert.mockResolvedValue({ error: null });
  });

  it("returns null without active commitment", async () => {
    const read = await loadPatReadForVictoryRoom({
      clerkUserId: "u1",
      view: { ...baseView(), hasActiveV2Commitment: false, commitment: null },
      displayName: "Alex",
    });
    expect(read).toBeNull();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns persisted snapshot when hash matches", async () => {
    const view = baseView();
    const bundle = computePatReadSourceBundle(view, { seasonId: "season-1" })!;
    const hash = computePatReadSourceHash(bundle);
    mockSnapshotMaybeSingle.mockResolvedValue({
      data: {
        strength_text: "Saved strength.",
        pattern_text: null,
        next_move_text: "Saved next move.",
        provenance: "deterministic",
        source_hash: hash,
        valid_for_day_key: getPatReadDayKey("UTC"),
        input_bundle_json: bundle,
        pattern_confidence: "none",
        reason_for_update: "initial",
      },
      error: null,
    });

    const read = await loadPatReadForVictoryRoom({
      clerkUserId: "u1",
      view,
      displayName: "Alex",
      timezone: "UTC",
    });

    expect(read).toEqual({
      strength: "Saved strength.",
      pattern: null,
      nextMove: "Saved next move.",
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("upserts with reason_for_update initial when none exists", async () => {
    mockSnapshotMaybeSingle.mockResolvedValue({ data: null, error: null });

    await loadPatReadForVictoryRoom({
      clerkUserId: "u1",
      view: baseView(),
      displayName: "Alex",
      timezone: "UTC",
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const payload = mockUpsert.mock.calls[0][0];
    expect(payload.reason_for_update).toBe("initial");
    expect(payload.linked_proof_moment_ids).toEqual([]);
  });

  it("upserts daily_refresh on previous-day hash change", async () => {
    const view = baseView();
    const bundle = computePatReadSourceBundle(view, { seasonId: "season-1" })!;
    mockSnapshotMaybeSingle.mockResolvedValue({
      data: {
        strength_text: "Old strength.",
        pattern_text: null,
        next_move_text: "Old next.",
        provenance: "deterministic",
        source_hash: "stale-hash",
        valid_for_day_key: "2026-05-20:UTC",
        input_bundle_json: bundle,
        pattern_confidence: "none",
        reason_for_update: "initial",
      },
      error: null,
    });

    await loadPatReadForVictoryRoom({
      clerkUserId: "u1",
      view,
      displayName: "Alex",
      timezone: "UTC",
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert.mock.calls[0][0].reason_for_update).toBe("daily_refresh");
  });

  it("upserts identity_changed on same-day identity change", async () => {
    const prevBundle = computePatReadSourceBundle(baseView(), { seasonId: "season-1" })!;
    mockSnapshotMaybeSingle.mockResolvedValue({
      data: {
        strength_text: "Old strength.",
        pattern_text: null,
        next_move_text: "Old next.",
        provenance: "deterministic",
        source_hash: "old-hash",
        valid_for_day_key: getPatReadDayKey("UTC"),
        input_bundle_json: prevBundle,
        pattern_confidence: "none",
        reason_for_update: "initial",
      },
      error: null,
    });

    const view = baseView({
      profile: { preferred_name: "Alex", identity_anchor_text: "A new identity line." },
    });

    await loadPatReadForVictoryRoom({
      clerkUserId: "u1",
      view,
      displayName: "Alex",
      timezone: "UTC",
    });

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert.mock.calls[0][0].reason_for_update).toBe("identity_changed");
  });

  it("preserves snapshot on same-day minor proof change", async () => {
    const proofBundle = computePatReadSourceBundle(
      baseView({
        isDayZeroUser: false,
        hasSparseProof: false,
        moments: [
          {
            id: "m1",
            occurredAt: "2026-05-02T10:00:00Z",
            headline: "Kept your word",
            body: "You followed through today.",
            groundedInEventTypes: ["user_yes"],
          },
        ],
      }),
      { seasonId: "season-1" }
    )!;
    const bumped = {
      ...proofBundle,
      evidence_counts: {
        ...proofBundle.evidence_counts,
        kept_the_goal: proofBundle.evidence_counts.kept_the_goal + 1,
      },
    };

    mockSnapshotMaybeSingle.mockResolvedValue({
      data: {
        strength_text: "Saved strength.",
        pattern_text: null,
        next_move_text: "Saved next move.",
        provenance: "deterministic",
        source_hash: "saved-hash",
        valid_for_day_key: getPatReadDayKey("UTC"),
        input_bundle_json: proofBundle,
        pattern_confidence: proofBundle.pattern_confidence,
        reason_for_update: "first_real_proof",
      },
      error: null,
    });

    const view = baseView({
      isDayZeroUser: false,
      hasSparseProof: false,
      moments: [
        {
          id: "m1",
          occurredAt: "2026-05-02T10:00:00Z",
          headline: "Kept your word",
          body: "You followed through today.",
          groundedInEventTypes: ["user_yes"],
        },
      ],
      evidenceCounts: {
        ...EMPTY_VICTORY_EVIDENCE_COUNTS,
        keptTheGoal: proofBundle.evidence_counts.kept_the_goal + 1,
      },
    });

    const read = await loadPatReadForVictoryRoom({
      clerkUserId: "u1",
      view,
      displayName: "Alex",
      timezone: "UTC",
    });

    expect(read).toEqual({
      strength: "Saved strength.",
      pattern: null,
      nextMove: "Saved next move.",
    });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(computePatReadSourceHash(bumped)).not.toBe("saved-hash");
  });

  it("falls back deterministically when upsert fails", async () => {
    mockSnapshotMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockUpsert.mockResolvedValue({ error: { message: "write failed" } });

    const read = await loadPatReadForVictoryRoom({
      clerkUserId: "u1",
      view: baseView(),
      displayName: "Alex",
      timezone: "UTC",
    });

    expect(read).not.toBeNull();
    expect(read!.nextMove).toContain("Walk before breakfast");
  });
});

describe("getPatReadDayKey", () => {
  it("includes timezone in stable day key", () => {
    const key = getPatReadDayKey("America/New_York");
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}:America\/New_York$/);
  });
});
