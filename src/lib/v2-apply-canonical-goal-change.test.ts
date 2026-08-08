import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  rpcMock,
  clearStaleMock,
  recomputeMock,
  proofInsertMock,
  unsafeMock,
  invalidateMock,
} = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  clearStaleMock: vi.fn(),
  recomputeMock: vi.fn(),
  proofInsertMock: vi.fn(),
  unsafeMock: vi.fn(),
  invalidateMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { rpc: rpcMock },
}));

vi.mock("@/lib/v2-adaptive-contract", () => ({
  clearStaleAdaptiveContractColumns: clearStaleMock,
}));

vi.mock("@/lib/v2-coaching-memory", () => ({
  recomputeV2CoachingMemory: recomputeMock,
}));

vi.mock("@/lib/v2-proof-moment", () => ({
  insertSmsCommitmentChangeProofEvent: proofInsertMock,
}));

vi.mock("@/lib/sms-inbound-safety", () => ({
  isUnsafeSmsGoalCandidateText: unsafeMock,
}));

vi.mock("@/lib/v2-victory-snapshot-invalidation", () => ({
  invalidateVictorySnapshotsAfterCanonicalGoalChange: (...args: unknown[]) =>
    invalidateMock(...args),
}));

import { applyCanonicalGoalChangeWithSeasonMutation } from "@/lib/v2-apply-canonical-goal-change";

const baseCommitment = {
  id: "cmt_1",
  clerk_user_id: "user_1",
  status: "active",
  behavior_statement: "Walk 10 minutes",
  title: "Walk",
  success_criteria: null,
  blocker_capture_expires_at: null,
  blocker_capture_after_event: null,
  adaptive_ask_text: null,
  adaptive_ask_active_from: null,
  adaptive_ask_expires_at: null,
  adaptive_proposal_text: null,
  adaptive_proposal_created_at: null,
  adaptive_proposal_expires_at: null,
  accountability_phase: "active_accountability" as const,
  reactivation_entered_at: null,
  reactivation_last_sent_at: null,
  reactivation_entry_reason_code: null,
  refresh_session: null,
  commitment_refresh_last_prompted_at: null,
  pending_resolution_kind: "commitment_replace",
  pending_resolution_created_at: null,
  pending_resolution_expires_at: null,
  pending_resolution_payload: null,
  updated_at: "2026-01-01T00:00:00.000Z",
  started_at: null,
};

describe("applyCanonicalGoalChangeWithSeasonMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unsafeMock.mockReturnValue(false);
    clearStaleMock.mockResolvedValue(undefined);
    recomputeMock.mockResolvedValue(undefined);
    proofInsertMock.mockResolvedValue(true);
    invalidateMock.mockResolvedValue({
      ok: true,
      patReadDeleted: 1,
      principlesDeleted: 1,
      seasonSummaryDeleted: 0,
      error: null,
    });
  });

  it("forces new_chapter even when caller passes same_season_sync", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          result: "applied",
          commitment_replace_applied: true,
          old_commitment_id: "cmt_1",
          new_commitment_id: "cmt_2",
          season_transition_applied: true,
          season_transition_action: "new_chapter",
          same_season_goal_snapshot_synced: false,
          idempotent_replay: false,
        },
      ],
      error: null,
    });

    const r = await applyCanonicalGoalChangeWithSeasonMutation({
      clerkUserId: "user_1",
      commitment: baseCommitment,
      behaviorStatement: "Walk 20 minutes",
      seasonMode: "same_season_sync",
      idempotencyKey: "app_goal_change:test-uuid",
      proofMessageSid: "app_goal_change:test-uuid",
      memoryReasonCode: "app_goal_change",
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.seasonMode).toBe("new_chapter");
      expect(r.sameSeasonGoalSnapshotSynced).toBe(false);
    }
    expect(rpcMock).toHaveBeenCalledWith("v2_apply_sms_goal_change_with_season_mutation", {
      p_old_commitment_id: "cmt_1",
      p_clerk_user_id: "user_1",
      p_new_behavior_statement: "Walk 20 minutes",
      p_season_mode: "new_chapter",
      p_expected_old_updated_at: baseCommitment.updated_at,
      p_idempotency_key: "app_goal_change:test-uuid",
      p_now: expect.any(String),
    });
    expect(proofInsertMock).toHaveBeenCalledTimes(1);
    expect(invalidateMock).toHaveBeenCalledWith({
      clerkUserId: "user_1",
      oldCommitmentId: "cmt_1",
      newCommitmentId: "cmt_2",
    });
  });

  it("does not invalidate Victory snapshots when RPC fails", async () => {
    rpcMock.mockResolvedValue({
      data: [{ result: "stale_commitment" }],
      error: null,
    });

    const r = await applyCanonicalGoalChangeWithSeasonMutation({
      clerkUserId: "user_1",
      commitment: baseCommitment,
      behaviorStatement: "Walk 20 minutes",
      seasonMode: "new_chapter",
      idempotencyKey: "k-fail",
      proofMessageSid: "k-fail",
      memoryReasonCode: "app_goal_change",
    });

    expect(r.ok).toBe(false);
    expect(invalidateMock).not.toHaveBeenCalled();
  });

  it("still returns success when snapshot invalidation fails", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          result: "applied",
          commitment_replace_applied: true,
          old_commitment_id: "cmt_1",
          new_commitment_id: "cmt_2",
          season_transition_applied: true,
          season_transition_action: "new_chapter",
          same_season_goal_snapshot_synced: false,
          idempotent_replay: false,
        },
      ],
      error: null,
    });
    invalidateMock.mockResolvedValue({
      ok: false,
      patReadDeleted: 0,
      principlesDeleted: 0,
      seasonSummaryDeleted: 0,
      error: "pat_read:boom",
    });

    const r = await applyCanonicalGoalChangeWithSeasonMutation({
      clerkUserId: "user_1",
      commitment: baseCommitment,
      behaviorStatement: "Walk 20 minutes",
      seasonMode: "new_chapter",
      idempotencyKey: "k-inv-fail",
      proofMessageSid: "k-inv-fail",
      memoryReasonCode: "app_goal_change",
    });
    expect(r.ok).toBe(true);
    expect(invalidateMock).toHaveBeenCalled();
  });

  it("inserts proof on new_chapter apply", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          result: "applied",
          commitment_replace_applied: true,
          old_commitment_id: "cmt_1",
          new_commitment_id: "cmt_2",
          season_transition_applied: true,
          season_transition_action: "new_chapter",
          same_season_goal_snapshot_synced: false,
          idempotent_replay: false,
        },
      ],
      error: null,
    });

    await applyCanonicalGoalChangeWithSeasonMutation({
      clerkUserId: "user_1",
      commitment: baseCommitment,
      behaviorStatement: "Read 10 pages",
      seasonMode: "new_chapter",
      idempotencyKey: "app_goal_change:uuid-2",
      proofMessageSid: "app_goal_change:uuid-2",
      memoryReasonCode: "app_goal_change",
    });

    expect(proofInsertMock).toHaveBeenCalledTimes(1);
    expect(proofInsertMock.mock.calls[0]![0]).toMatchObject({
      commitmentId: "cmt_2",
      kind: "commitment_replaced",
    });
  });

  it("does not insert proof on idempotent replay", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          result: "already_applied",
          commitment_replace_applied: true,
          old_commitment_id: "cmt_1",
          new_commitment_id: "cmt_2",
          season_transition_applied: true,
          season_transition_action: "new_chapter",
          idempotent_replay: true,
        },
      ],
      error: null,
    });

    await applyCanonicalGoalChangeWithSeasonMutation({
      clerkUserId: "user_1",
      commitment: baseCommitment,
      behaviorStatement: "Read 10 pages",
      seasonMode: "new_chapter",
      idempotencyKey: "app_goal_change:uuid-3",
      proofMessageSid: "app_goal_change:uuid-3",
      memoryReasonCode: "app_goal_change",
    });

    expect(proofInsertMock).not.toHaveBeenCalled();
  });

  it("rejects unsafe goal text", async () => {
    unsafeMock.mockReturnValue(true);
    const r = await applyCanonicalGoalChangeWithSeasonMutation({
      clerkUserId: "user_1",
      commitment: baseCommitment,
      behaviorStatement: "bad",
      seasonMode: "same_season_sync",
      idempotencyKey: "k",
      proofMessageSid: "k",
      memoryReasonCode: "app_goal_change",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unsafe_goal_content");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
