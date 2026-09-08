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

vi.mock("@/lib/v2-ai-sms-pending-candidate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-ai-sms-pending-candidate")>();
  return {
    ...actual,
    tryExtractV2SmsPendingResolutionCandidateAi: vi.fn(async () => ({
      ok: false as const,
      attempted: false as const,
      reason: "test_no_live_openai",
    })),
  };
});

vi.mock("@/lib/v2-victory-snapshot-invalidation", () => ({
  invalidateVictorySnapshotsAfterCanonicalGoalChange: vi.fn(async () => ({
    ok: true,
    patReadDeleted: 0,
    principlesDeleted: 0,
    seasonSummaryDeleted: 0,
    error: null,
  })),
  invalidateVictoryCurrentGoalSnapshots: vi.fn(async () => ({
    ok: true,
    patReadDeleted: 0,
    principlesDeleted: 0,
    seasonSummaryDeleted: 0,
    error: null,
  })),
}));

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getPendingResolutionOrNull } from "@/lib/v2-guided-resolution";
import {
  parseSmsConfirmation,
  mapPendingConfirmationParseToUserAnswerType,
  tryHandleSmsInboundPendingResolution,
  isVagueOrInvalidCandidateBar,
  isAcknowledgmentOrMetaChangeRequestOnly,
  extractDeterministicDailyBarCandidate,
} from "@/lib/v2-sms-pending-resolution-complete";

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


describe("Slice 6 leftover does not own saved replace", () => {
  it("synonym confirmation does not apply leftover saved-replace RPC", async () => {
    const c = commitmentAwaitingConfirm();
    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMpr1", raw_body: "yes" },
      clerkUserId: "user_pr",
      commitment: c,
    });
    expect(r.handled).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(proofInsertMock).not.toHaveBeenCalled();
  });

  it("I agree / Absolutely do not apply leftover saved-replace", async () => {
    for (const body of ["I agree", "Absolutely", "Yes, confirm"]) {
      rpcMock.mockClear();
      const r = await tryHandleSmsInboundPendingResolution({
        job: { message_sid: "SMpr_syn", raw_body: body },
        clerkUserId: "user_pr",
        commitment: commitmentAwaitingConfirm(),
      });
      expect(r.handled).toBe(false);
      expect(rpcMock).not.toHaveBeenCalled();
    }
  });

  it("leftover candidate AI is not invoked for saved replace awaiting_candidate", async () => {
    const { tryExtractV2SmsPendingResolutionCandidateAi } = await import(
      "@/lib/v2-ai-sms-pending-candidate"
    );
    const c = commitmentAwaitingConfirm({
      sms_state: "awaiting_candidate",
      candidate_behavior_statement: null,
      candidate_new_bar: null,
    });
    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMpr_ai", raw_body: "Walk 20 minutes after dinner" },
      clerkUserId: "user_pr",
      commitment: c,
    });
    expect(r.handled).toBe(false);
    expect(tryExtractV2SmsPendingResolutionCandidateAi).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("leftover keep-current regex does not clear saved replace", async () => {
    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMpr_keep", raw_body: "Keep the same goal" },
      clerkUserId: "user_pr",
      commitment: commitmentAwaitingConfirm(),
    });
    expect(r.handled).toBe(false);
    expect(clearPendingMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("leftover clock hallway does not own saved replace Turn 2", async () => {
    const c = commitmentAwaitingConfirm({
      sms_state: "awaiting_candidate",
      candidate_behavior_statement: null,
      candidate_new_bar: null,
    });
    c.behavior_statement = "I will be in bed by 9:30 pm nightly.";
    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMpr_clock", raw_body: "10:30" },
      clerkUserId: "user_pr",
      commitment: c,
    });
    expect(r.handled).toBe(false);
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it("empty-candidate awaiting_confirmation fails closed to awaiting_candidate without RPC", async () => {
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
    expect(mergeMock).toHaveBeenCalled();
    if (r.handled) {
      expect(r.pendingResolutionApplied).toBe(false);
      expect(r.replyBody).toMatch(/harder goal/i);
    }
  });
});

describe("Slice 6 leftover tighten still works", () => {
  function commitmentTightenConfirm(
    overrides: Partial<Record<string, unknown>> = {}
  ): ActiveV2CommitmentRow {
    const c = commitmentAwaitingConfirm({
      detected_intent: "sms_tighten_request",
      candidate_tightened_bar: "Walk 10 minutes after dinner",
      candidate_behavior_statement: "Walk 10 minutes after dinner",
      candidate_new_bar: null,
      ...overrides,
    });
    c.pending_resolution_kind = "commitment_tighten";
    return c;
  }

  it("awaiting_confirmation + yes applies leftover tighten overlay, not saved-replace RPC", async () => {
    const { persistContractOverlayProposed, activateAdaptiveOverlayFromProposal } = await import(
      "@/lib/v2-adaptive-contract"
    );
    vi.mocked(persistContractOverlayProposed).mockResolvedValue({ ok: true, updatedAt: null });
    vi.mocked(activateAdaptiveOverlayFromProposal).mockResolvedValue({
      ok: true,
      updatedAt: null,
      result: { result: "applied" } as never,
    });
    const pending = commitmentTightenConfirm();
    getActiveCommitmentMock.mockResolvedValue(pending);

    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMtight1", raw_body: "yes" },
      clerkUserId: "user_pr",
      commitment: pending,
    });
    expect(r.handled).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(persistContractOverlayProposed).toHaveBeenCalled();
    expect(activateAdaptiveOverlayFromProposal).toHaveBeenCalled();
    if (r.handled) {
      expect(r.pendingResolutionApplied).toBe(true);
      expect(r.pendingResolutionKind).toBe("commitment_tighten");
    }
  });

  it("awaiting_candidate leftover still extracts a tighten candidate", async () => {
    const c = commitmentTightenConfirm({
      sms_state: "awaiting_candidate",
      candidate_tightened_bar: null,
      candidate_behavior_statement: null,
    });
    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMtight2", raw_body: "Walk 10 minutes after dinner" },
      clerkUserId: "user_pr",
      commitment: c,
    });
    expect(r.handled).toBe(true);
    expect(mergeMock).toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    if (r.handled) {
      expect(r.pendingResolutionApplied).toBe(false);
      expect(r.pendingResolutionKind).toBe("commitment_tighten");
    }
  });

  it("Wave4-shaped untagged tighten (no sol_temporary_overlay) remains leftover-owned", async () => {
    const pending = commitmentTightenConfirm({
      sms_state: "awaiting_candidate",
      candidate_tightened_bar: "Wake at 10:30.",
      candidate_behavior_statement: null,
      candidate_new_bar: null,
    });
    expect(getPendingResolutionOrNull(pending)?.payload.sol_temporary_overlay).toBeUndefined();
    getActiveCommitmentMock.mockResolvedValue(pending);
    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMwave4untagged", raw_body: "yes" },
      clerkUserId: "user_pr",
      commitment: pending,
    });
    expect(r.handled).toBe(true);
  });

  it("sol_temporary_overlay tighten is skipped by leftover (Sol-owned, no overlay apply)", async () => {
    const { persistContractOverlayProposed, activateAdaptiveOverlayFromProposal } = await import(
      "@/lib/v2-adaptive-contract"
    );
    vi.mocked(persistContractOverlayProposed).mockClear();
    vi.mocked(activateAdaptiveOverlayFromProposal).mockClear();
    const pending = commitmentTightenConfirm({
      sol_temporary_overlay: true,
      temporary_duration_kind: "local_week",
      temporary_expires_at: "2099-01-01T05:00:00.000Z",
    });
    getActiveCommitmentMock.mockResolvedValue(pending);
    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMsoltemp", raw_body: "yes" },
      clerkUserId: "user_pr",
      commitment: pending,
    });
    expect(r.handled).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(persistContractOverlayProposed).not.toHaveBeenCalled();
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it.each([
    "Yes",
    "Y",
    "No",
    "N",
    "Absolutely",
    "Sounds good",
    "Never mind",
    "Actually make it 10:15",
    "Keep my normal goal",
    "Had a long day at work, traffic was brutal",
  ])("tagged temp leftover never semantically owns inbound %s", async (raw) => {
    const { persistContractOverlayProposed, activateAdaptiveOverlayFromProposal } = await import(
      "@/lib/v2-adaptive-contract"
    );
    vi.mocked(persistContractOverlayProposed).mockClear();
    vi.mocked(activateAdaptiveOverlayFromProposal).mockClear();
    const pending = commitmentTightenConfirm({
      sol_temporary_overlay: true,
      temporary_duration_kind: "local_week",
      temporary_expires_at: "2099-01-01T05:00:00.000Z",
    });
    getActiveCommitmentMock.mockResolvedValue(pending);
    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMsoltemp2", raw_body: raw },
      clerkUserId: "user_pr",
      commitment: pending,
    });
    expect(r.handled).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(persistContractOverlayProposed).not.toHaveBeenCalled();
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("Wave4 initial Sol-temp payload (pre-merge shape) is leftover-ineligible", async () => {
    const { persistContractOverlayProposed, activateAdaptiveOverlayFromProposal } = await import(
      "@/lib/v2-adaptive-contract"
    );
    vi.mocked(persistContractOverlayProposed).mockClear();
    vi.mocked(activateAdaptiveOverlayFromProposal).mockClear();
    const pending = commitmentTightenConfirm({
      sms_state: "awaiting_candidate",
      sol_temporary_overlay: true,
      candidate_tightened_bar: "Wake at 10:30.",
      candidate_behavior_statement: null,
      candidate_new_bar: null,
    });
    getActiveCommitmentMock.mockResolvedValue(pending);
    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMwave4shell", raw_body: "yes" },
      clerkUserId: "user_pr",
      commitment: pending,
    });
    expect(getPendingResolutionOrNull(pending)?.payload).toMatchObject({
      sol_temporary_overlay: true,
    });
    expect(r.handled).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(persistContractOverlayProposed).not.toHaveBeenCalled();
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("malformed tagged tighten (marker, missing candidate/duration) is leftover-ineligible", async () => {
    const pending = commitmentTightenConfirm({
      sms_state: "awaiting_candidate",
      sol_temporary_overlay: true,
      candidate_tightened_bar: null,
      candidate_behavior_statement: null,
      candidate_new_bar: null,
    });
    getActiveCommitmentMock.mockResolvedValue(pending);
    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMmalformed", raw_body: "Never mind, make it 9:00" },
      clerkUserId: "user_pr",
      commitment: pending,
    });
    expect(r.handled).toBe(false);
  });
});

describe("parseSmsConfirmation — pending goal confirm language", () => {
  it("1: compound yes confirm with accomplishment tail => yes", () => {
    expect(
      parseSmsConfirmation(
        "Yes, confirm and accomplished last night. Put on calendar going forward."
      )
    ).toBe("yes");
  });

  it("2: Yes, confirm => yes", () => {
    expect(parseSmsConfirmation("Yes, confirm")).toBe("yes");
  });

  it("3: Confirm => yes", () => {
    expect(parseSmsConfirmation("Confirm")).toBe("yes");
  });

  it("4: Yes, that's right => yes", () => {
    expect(parseSmsConfirmation("Yes, that's right")).toBe("yes");
  });

  it("5: Yes, but change it to 9 hours => not yes", () => {
    expect(parseSmsConfirmation("Yes, but change it to 9 hours")).not.toBe("yes");
  });

  it("6: Yes, instead make it 9 hours => not yes", () => {
    expect(parseSmsConfirmation("Yes, instead make it 9 hours")).not.toBe("yes");
  });

  it("7: No, change it => no", () => {
    expect(parseSmsConfirmation("No, change it")).toBe("no");
  });

  it("does not treat bare yes+accomplishment without confirm language as yes", () => {
    expect(parseSmsConfirmation("Yes, I accomplished it last night")).not.toBe("yes");
  });

  it("I agree / sounds good confirm existing pending candidate", () => {
    expect(parseSmsConfirmation("I agree")).toBe("yes");
    expect(parseSmsConfirmation("I agree.")).toBe("yes");
    expect(parseSmsConfirmation("sounds good")).toBe("yes");
  });

  it("Victory Room still-says + change to my new goal confirms pending candidate", () => {
    expect(
      parseSmsConfirmation(
        "My goal in my victory room still says 10,000 steps. Can you change it to my new goal?"
      )
    ).toBe("yes");
    expect(parseSmsConfirmation("Can you change it to my new goal?")).toBe("yes");
  });

  it("change it to a concrete alternative is not apply-pending confirmation", () => {
    expect(parseSmsConfirmation("Can you change it to waking up before my kids?")).not.toBe("yes");
  });

  it("maps parse results to pending user_answer_type semantics", () => {
    expect(mapPendingConfirmationParseToUserAnswerType("yes")).toBe("pending_confirmed");
    expect(mapPendingConfirmationParseToUserAnswerType("ambiguous")).toBe(
      "pending_confirmation_ambiguous"
    );
    expect(mapPendingConfirmationParseToUserAnswerType("no")).toBe("pending_rejected");
  });
});

describe("candidate hygiene — acknowledgments and meta change-requests", () => {
  it.each([
    "I agree",
    "I agree.",
    "yes",
    "yeah",
    "yep",
    "sounds good",
    "ok",
    "okay",
    "I want a change",
    "I need a change",
    "change it",
    "let's change it",
    "I want to change my goal",
    "that goal isn't right",
    "not that goal",
    "what is the lock",
    "what does lock mean",
    "What I agree what is the lock?",
  ])("rejects standalone invalid candidate: %s", (text) => {
    expect(isAcknowledgmentOrMetaChangeRequestOnly(text)).toBe(true);
    expect(isVagueOrInvalidCandidateBar(text)).toBe(true);
    expect(extractDeterministicDailyBarCandidate(text)).toBeNull();
  });

  it("does not treat unstructured desire phrasing as a deterministic candidate (no full-body fallback)", () => {
    const unstructured = "I want to give each kid one genuine compliment every day";
    expect(isAcknowledgmentOrMetaChangeRequestOnly(unstructured)).toBe(false);
    // Without a structured cue (change-to / duration / agree-to), raw body is not a candidate.
    expect(extractDeterministicDailyBarCandidate(unstructured)).toBeNull();
  });

  it("extracts concrete clause from change-my-goal-to framing", () => {
    const concrete = "Change my goal to give each kid one genuine compliment every day";
    expect(isAcknowledgmentOrMetaChangeRequestOnly(concrete)).toBe(false);
    expect(extractDeterministicDailyBarCandidate(concrete)).toMatch(/compliment/i);
  });

  it("strips I agree to wrapper and keeps concrete clause", () => {
    const msg = "I agree to give each kid one genuine compliment every day";
    expect(isAcknowledgmentOrMetaChangeRequestOnly(msg)).toBe(false);
    const extracted = extractDeterministicDailyBarCandidate(msg);
    expect(extracted).toMatch(/give each kid one genuine compliment every day/i);
    expect(extracted).not.toMatch(/^i agree/i);
  });
});
