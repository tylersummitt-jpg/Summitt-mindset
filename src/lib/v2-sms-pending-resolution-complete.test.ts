import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  rpcMock,
  proofInsertMock,
  getActiveCommitmentMock,
  mergeMock,
  clearPendingMock,
  recomputeMock,
} = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  proofInsertMock: vi.fn(),
  getActiveCommitmentMock: vi.fn(),
  mergeMock: vi.fn(),
  clearPendingMock: vi.fn(),
  recomputeMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { rpc: rpcMock, from: vi.fn() },
}));

vi.mock("@/lib/v2-commitment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-commitment")>();
  return {
    ...actual,
    getActiveCommitment: getActiveCommitmentMock,
    getRecentV2EventsForAi: vi.fn(async () => []),
  };
});

vi.mock("@/lib/v2-guided-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-guided-resolution")>();
  return {
    ...actual,
    mergeSmsPendingResolutionPayload: mergeMock,
    clearPendingResolution: clearPendingMock,
    clearPendingResolutionIfExpired: vi.fn(async () => undefined),
    getPendingResolutionOrNull: actual.getPendingResolutionOrNull,
  };
});

vi.mock("@/lib/v2-coaching-memory", () => ({
  recomputeV2CoachingMemory: recomputeMock,
}));

vi.mock("@/lib/v2-adaptive-contract", () => ({
  activateAdaptiveOverlayFromProposal: vi.fn(),
  clearStaleAdaptiveContractColumns: vi.fn(),
  normalizeShrinkProposalBindingText: vi.fn((t: string) => t),
  persistContractOverlayProposed: vi.fn(),
  isV2AdaptiveOverlayActive: vi.fn(() => false),
  isV2PendingProposalValid: vi.fn(() => false),
}));

vi.mock("@/lib/v2-proof-moment", () => ({
  buildProofMomentCommitmentReplaced: vi.fn(() => ({
    proof_moment: true,
    proof_moment_type: "commitment_replaced",
    proof_moment_reason: "test",
  })),
  buildProofMomentCommitmentTightened: vi.fn(),
  decideVictoryRoomSmsCallout: vi.fn(() => ({
    eligible: false,
    appendToReply: null,
    eventPayloadExtras: {},
  })),
  insertSmsCommitmentChangeProofEvent: proofInsertMock,
  patchVictoryCalloutOnSpineEventBestEffort: vi.fn(),
  appendSmsParagraphIfUnderCap: vi.fn((a: string) => a),
}));

vi.mock("@/lib/v2-human-sms-brain/finalize-phase1-human-sms", () => ({
  finalizePhase1HumanSms: vi.fn(async (args: { machineDraft: string }) => ({
    message: args.machineDraft,
  })),
}));

vi.mock("@/lib/v2-human-sms-brain/flags", () => ({
  isV2PendingResolutionVictoryCalloutAllowed: vi.fn(() => false),
  shouldRunCommitmentInterpreterForPendingResolution: vi.fn(() => false),
  shouldRunHumanSmsPipelineForPendingResolution: vi.fn(() => false),
}));

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { tryHandleSmsInboundPendingResolution } from "@/lib/v2-sms-pending-resolution-complete";

function commitmentAwaitingConfirm(
  overrides: Partial<Record<string, unknown>> = {}
): ActiveV2CommitmentRow {
  return {
    id: "cmt_pr",
    clerk_user_id: "user_pr",
    status: "active",
    behavior_statement: "Old bar",
    title: "Goal",
    success_criteria: null,
    blocker_capture_expires_at: null,
    blocker_capture_after_event: null,
    adaptive_ask_text: null,
    adaptive_ask_active_from: null,
    adaptive_ask_expires_at: null,
    adaptive_proposal_text: null,
    adaptive_proposal_created_at: null,
    adaptive_proposal_expires_at: null,
    accountability_phase: "active_accountability",
    reactivation_entered_at: null,
    reactivation_last_sent_at: null,
    reactivation_entry_reason_code: null,
    refresh_session: null,
    commitment_refresh_last_prompted_at: null,
    pending_resolution_kind: "commitment_replace",
    pending_resolution_created_at: "2026-05-10T12:00:00.000Z",
    pending_resolution_expires_at: "2027-05-10T12:00:00.000Z",
    pending_resolution_payload: {
      source: "sms_inbound",
      detected_intent: "sms_replace_request",
      raw_user_text: "walk daily",
      inbound_message_sid: "SMpr1",
      ai_confidence: 0.9,
      sms_state: "awaiting_confirmation",
      candidate_behavior_statement: "Walk 20 minutes after dinner",
      candidate_new_bar: "Walk 20 minutes after dinner",
      ...overrides,
    },
    updated_at: "2026-05-10T12:00:00.000Z",
    started_at: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getActiveCommitmentMock.mockResolvedValue(null);
  mergeMock.mockResolvedValue({ ok: true });
  clearPendingMock.mockResolvedValue(undefined);
  recomputeMock.mockResolvedValue(undefined);
  proofInsertMock.mockResolvedValue(true);
  rpcMock.mockResolvedValue({
    data: [
      {
        result: "applied",
        commitment_replace_applied: true,
        old_commitment_id: "cmt_pr",
        new_commitment_id: "cmt_pr_new",
        season_transition_applied: true,
        season_transition_action: "new_chapter",
        old_season_id: "s-old",
        new_season_id: "s-new",
        old_season_name: "Season 1",
        new_season_name: "Season 2",
        same_season_goal_snapshot_synced: false,
        idempotent_replay: false,
        warning_code: null,
      },
    ],
    error: null,
  });
});

describe("tryHandleSmsInboundPendingResolution — replace YES", () => {
  it("calls bundled season RPC once and inserts proof after new_chapter success", async () => {
    const c = commitmentAwaitingConfirm({
      detected_intent: "sms_replace_request",
      raw_user_text: "switch from phone discipline to walking every morning",
      season_mode: "new_chapter",
      season_mode_reason: "switch_from_to",
      candidate_behavior_statement: "Walk 20 minutes after dinner",
      candidate_new_bar: "Walk 20 minutes after dinner",
    });
    c.behavior_statement = "Put phone away at 10pm";
    getActiveCommitmentMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...c,
        id: "cmt_pr_new",
        behavior_statement: "Walk 20 minutes after dinner",
        pending_resolution_kind: null,
        pending_resolution_payload: null,
      });

    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMpr1", raw_body: "yes" },
      clerkUserId: "user_pr",
      commitment: c,
    });

    expect(r.handled).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0]![0]).toBe("v2_apply_sms_goal_change_with_season_mutation");
    expect(rpcMock.mock.calls[0]![1]).toMatchObject({
      p_season_mode: "new_chapter",
      p_idempotency_key: "SMpr1",
    });
    expect(proofInsertMock).toHaveBeenCalledTimes(1);
    expect(proofInsertMock.mock.calls[0]![0].kind).toBe("commitment_replaced");
    if (r.handled) {
      expect(r.seasonMutation?.seasonTransitionApplied).toBe(true);
    }
  });

  it("same_season_sync does not insert commitment_replaced proof", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          result: "applied",
          commitment_replace_applied: false,
          old_commitment_id: "cmt_pr",
          new_commitment_id: "cmt_pr",
          season_transition_applied: true,
          season_transition_action: "same_season_sync",
          old_season_id: "s-active",
          new_season_id: "s-active",
          same_season_goal_snapshot_synced: true,
          idempotent_replay: false,
        },
      ],
      error: null,
    });
    const c = commitmentAwaitingConfirm({
      season_mode: "same_season_sync",
    });
    getActiveCommitmentMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...c,
        behavior_statement: "Walk 20 minutes after dinner",
        pending_resolution_kind: null,
        pending_resolution_payload: null,
      });

    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMpr1", raw_body: "yes" },
      clerkUserId: "user_pr",
      commitment: c,
    });

    expect(r.handled).toBe(true);
    expect(rpcMock.mock.calls[0]![1]).toMatchObject({ p_season_mode: "same_season_sync" });
    expect(proofInsertMock).not.toHaveBeenCalled();
  });

  it("already_applied from bundled RPC is treated as success", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          result: "already_applied",
          commitment_replace_applied: true,
          old_commitment_id: "cmt_pr",
          new_commitment_id: "cmt_pr_new",
          season_transition_applied: true,
          season_transition_action: "new_chapter",
          idempotent_replay: true,
        },
      ],
      error: null,
    });
    const c = commitmentAwaitingConfirm();
    getActiveCommitmentMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...c,
      id: "cmt_pr_new",
      pending_resolution_kind: null,
      pending_resolution_payload: null,
    });

    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMpr1", raw_body: "yes" },
      clerkUserId: "user_pr",
      commitment: c,
    });

    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.seasonMutation?.idempotentReplay).toBe(true);
    }
  });

  it("returns handled false when no sms pending", async () => {
    const c = commitmentAwaitingConfirm();
    c.pending_resolution_kind = null;
    c.pending_resolution_payload = null;
    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMpr2", raw_body: "yes" },
      clerkUserId: "user_pr",
      commitment: c,
    });
    expect(r.handled).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("sms_raise_bar_request with no candidate does not RPC on yes", async () => {
    const c = commitmentAwaitingConfirm({
      detected_intent: "sms_raise_bar_request",
      candidate_behavior_statement: null,
      candidate_new_bar: null,
      sms_state: "awaiting_confirmation",
    });
    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMpr3", raw_body: "yes" },
      clerkUserId: "user_pr",
      commitment: c,
    });
    expect(r.handled).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(r.replyBody).toMatch(/harder daily bar/i);
  });

  it("NO returns to awaiting candidate without RPC", async () => {
    const c = commitmentAwaitingConfirm();
    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMpr4", raw_body: "no" },
      clerkUserId: "user_pr",
      commitment: c,
    });
    expect(r.handled).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(mergeMock).toHaveBeenCalled();
  });

  it("RPC failure preview avoids candidate and pending wording", async () => {
    rpcMock.mockResolvedValue({
      data: [{ result: "stale_commitment" }],
      error: null,
    });
    const c = commitmentAwaitingConfirm();
    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMpr_fail", raw_body: "yes" },
      clerkUserId: "user_pr",
      commitment: c,
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.replyBody.toLowerCase()).not.toMatch(/\bcandidate\b|\bpending\b/);
      expect(r.replyBody).toMatch(/bar you asked for/i);
    }
  });
});

describe("tryHandleSmsInboundPendingResolution — replace confirmation preview", () => {
  it("same_season_sync confirmation preview does not say new commitment", async () => {
    const c = commitmentAwaitingConfirm({
      sms_state: "awaiting_candidate",
      detected_intent: "sms_raise_bar_request",
      raw_user_text: "walking 10 minutes is too easy, make it 30",
      candidate_behavior_statement: null,
      candidate_new_bar: null,
    });
    c.behavior_statement = "Walk 10 minutes each morning";

    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMpr_confirm_same", raw_body: "make it 30 minutes each morning" },
      clerkUserId: "user_pr",
      commitment: c,
    });

    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.replyBody.toLowerCase()).toMatch(/raise the bar/);
      expect(r.replyBody.toLowerCase()).not.toMatch(/new commitment/);
    }
  });

  it("new_chapter confirmation preview uses focus/lock-in wording", async () => {
    const c = commitmentAwaitingConfirm({
      sms_state: "awaiting_candidate",
      detected_intent: "sms_replace_request",
      raw_user_text: "switch from phone discipline to walking every morning",
      candidate_behavior_statement: null,
      candidate_new_bar: null,
    });
    c.behavior_statement = "Put phone away at 10pm";

    const r = await tryHandleSmsInboundPendingResolution({
      job: {
        message_sid: "SMpr_confirm_chapter",
        raw_body: "switch from phone discipline to walking every morning",
      },
      clerkUserId: "user_pr",
      commitment: c,
    });

    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.replyBody.toLowerCase()).toMatch(/change the focus|lock that in/);
      expect(r.replyBody.toLowerCase()).not.toMatch(/new commitment/);
    }
  });
});
