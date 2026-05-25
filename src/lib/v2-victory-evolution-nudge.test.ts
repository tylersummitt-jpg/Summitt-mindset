import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { EvolutionRecommendationRow } from "@/lib/v2-commitment-evolution-recommendation";

const getActiveCommitmentMock = vi.hoisted(() => vi.fn());
const getPendingResolutionOrNullMock = vi.hoisted(() => vi.fn());
const fetchPendingEvolutionRecommendationMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

vi.mock("@/lib/v2-commitment", () => ({
  getActiveCommitment: getActiveCommitmentMock,
}));

vi.mock("@/lib/v2-guided-resolution", () => ({
  getPendingResolutionOrNull: getPendingResolutionOrNullMock,
}));

vi.mock("@/lib/v2-commitment-evolution-recommendation", () => ({
  fetchPendingEvolutionRecommendation: fetchPendingEvolutionRecommendationMock,
  syncEvolutionRecommendationForCommitment: vi.fn(),
}));

import { EVOLUTION_REVIEW_HREF, loadVictoryEvolutionNudge } from "@/lib/v2-victory-evolution-nudge";

function makeCommitment(overrides: Partial<ActiveV2CommitmentRow> = {}): ActiveV2CommitmentRow {
  return {
    id: "cmt_test",
    clerk_user_id: "user_test",
    status: "active",
    behavior_statement: "Walk 20 minutes",
    title: "Move daily",
    success_criteria: null,
    blocker_capture_expires_at: null,
    blocker_capture_after_event: null,
    adaptive_ask_text: null,
    adaptive_ask_active_from: null,
    adaptive_ask_expires_at: null,
    adaptive_proposal_text: null,
    adaptive_proposal_created_at: null,
    adaptive_proposal_expires_at: null,
    accountability_phase: "standard",
    reactivation_entered_at: null,
    reactivation_last_sent_at: null,
    reactivation_entry_reason_code: null,
    refresh_session: null,
    commitment_refresh_last_prompted_at: null,
    pending_resolution_kind: null,
    pending_resolution_created_at: null,
    pending_resolution_expires_at: null,
    pending_resolution_payload: null,
    updated_at: "2026-05-01T12:00:00.000Z",
    started_at: "2026-04-01T12:00:00.000Z",
    ...overrides,
  };
}

function makeRec(
  action: EvolutionRecommendationRow["recommended_action"],
  status: EvolutionRecommendationRow["status"] = "pending"
): EvolutionRecommendationRow {
  return {
    id: "rec_test",
    clerk_user_id: "user_test",
    commitment_id: "cmt_test",
    engine_version: "v1",
    recommended_action: action,
    evidence_json: {},
    status,
    created_at: "2026-05-01T12:00:00.000Z",
    resolved_at: null,
    superseded_at: null,
  };
}

describe("loadVictoryEvolutionNudge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPendingResolutionOrNullMock.mockReturnValue(null);
  });

  it("returns null when pending resolution exists", async () => {
    const commitment = makeCommitment({
      pending_resolution_kind: "commitment_tighten",
      pending_resolution_created_at: "2026-05-01T12:00:00.000Z",
      pending_resolution_expires_at: "2026-05-08T12:00:00.000Z",
    });
    getPendingResolutionOrNullMock.mockReturnValue({
      kind: "commitment_tighten",
      createdAt: commitment.pending_resolution_created_at!,
      expiresAt: commitment.pending_resolution_expires_at!,
      payload: null,
    });

    const result = await loadVictoryEvolutionNudge({
      clerkUserId: "user_test",
      commitment,
    });

    expect(result).toBeNull();
    expect(fetchPendingEvolutionRecommendationMock).not.toHaveBeenCalled();
  });

  it("returns null when no pending evolution recommendation", async () => {
    const commitment = makeCommitment();
    fetchPendingEvolutionRecommendationMock.mockResolvedValue(null);

    const result = await loadVictoryEvolutionNudge({
      clerkUserId: "user_test",
      commitment,
    });

    expect(result).toBeNull();
    expect(fetchPendingEvolutionRecommendationMock).toHaveBeenCalledWith("cmt_test");
  });

  it("returns null for non-surfaced actions", async () => {
    const commitment = makeCommitment();
    fetchPendingEvolutionRecommendationMock.mockResolvedValue(
      makeRec("keep_commitment", "pending")
    );

    const result = await loadVictoryEvolutionNudge({
      clerkUserId: "user_test",
      commitment,
    });

    expect(result).toBeNull();
  });

  it("returns DTO for surfaced action with safe copy", async () => {
    const commitment = makeCommitment();
    fetchPendingEvolutionRecommendationMock.mockResolvedValue(
      makeRec("reframe_commitment")
    );

    const result = await loadVictoryEvolutionNudge({
      clerkUserId: "user_test",
      commitment,
    });

    expect(result).toEqual({
      headline: "Coach Pat has a recommendation",
      body: expect.stringContaining("Review the recommendation"),
      href: EVOLUTION_REVIEW_HREF,
    });
    expect(result?.href).toBe("/dashboard");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("reframe_commitment");
    expect(serialized).not.toContain("rec_test");
    expect(serialized).not.toMatch(/confidence|algorithm|evolution engine|score/i);
  });

  it("is read-only and does not call syncEvolutionRecommendationForCommitment", async () => {
    const commitment = makeCommitment();
    fetchPendingEvolutionRecommendationMock.mockResolvedValue(
      makeRec("refresh_commitment_only")
    );

    await loadVictoryEvolutionNudge({ clerkUserId: "user_test", commitment });

    expect(fetchPendingEvolutionRecommendationMock).toHaveBeenCalledTimes(1);
    expect(fetchPendingEvolutionRecommendationMock).toHaveBeenCalledWith("cmt_test");
  });

  it("fetches active commitment when not provided", async () => {
    const commitment = makeCommitment();
    getActiveCommitmentMock.mockResolvedValue(commitment);
    fetchPendingEvolutionRecommendationMock.mockResolvedValue(null);

    await loadVictoryEvolutionNudge({ clerkUserId: "user_test" });

    expect(getActiveCommitmentMock).toHaveBeenCalledWith("user_test");
  });
});
