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
import {
  parseSmsConfirmation,
  mapPendingConfirmationParseToUserAnswerType,
  tryHandleSmsInboundPendingResolution,
  isVagueOrInvalidCandidateBar,
  isAcknowledgmentOrMetaChangeRequestOnly,
  extractDeterministicDailyBarCandidate,
} from "@/lib/v2-sms-pending-resolution-complete";
import { derivePersistenceDecision } from "@/lib/inbound-relationship-meaning";

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
    expect(r.replyBody).toMatch(/harder goal/i);
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
      expect(r.replyBody).toMatch(/goal you asked for/i);
    }
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

describe("no raw full-body fallback for candidate_behavior_statement", () => {
  it("A — shell + meta goal-change request does not promote raw body to CBS", async () => {
    const raw = "I want to change my goal, please.";
    expect(extractDeterministicDailyBarCandidate(raw)).toBeNull();

    const c = commitmentAwaitingConfirm({
      sms_state: "awaiting_candidate",
      detected_intent: "sms_change_unspecified",
      raw_user_text: raw,
      candidate_behavior_statement: null,
      candidate_new_bar: null,
      confirmation_prompt_sent_at: null,
      awaiting_candidate_reason: "goal_change_without_concrete_bar",
    });

    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMpr_meta_please", raw_body: raw },
      clerkUserId: "user_pr",
      commitment: c,
    });

    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.pendingResolutionApplied).toBe(false);
      expect(r.pendingStillActiveAfterPhase1).toBe(true);
      expect(r.replyBody.toLowerCase()).toMatch(/hold you to|clear daily|what exactly/i);
    }

    // No merge that writes candidate_behavior_statement from raw body.
    for (const call of mergeMock.mock.calls) {
      const mergeFn = call[0]?.merge as
        | ((prev: Record<string, unknown>) => Record<string, unknown>)
        | undefined;
      if (!mergeFn) continue;
      const merged = mergeFn({
        source: "sms_inbound",
        detected_intent: "sms_change_unspecified",
        raw_user_text: raw,
        inbound_message_sid: "SMpr_meta_please",
        ai_confidence: null,
        sms_state: "awaiting_candidate",
        candidate_behavior_statement: null,
        candidate_new_bar: null,
      });
      expect(merged.candidate_behavior_statement ?? null).not.toBe(raw);
      expect(merged.sms_state).not.toBe("awaiting_confirmation");
    }
  });

  it("B — change-my-goal-to concrete clause extracts and can promote", async () => {
    const raw = "Change my goal to walking 10,000 steps every day.";
    const extracted = extractDeterministicDailyBarCandidate(raw);
    expect(extracted).toMatch(/walking 10,?000 steps every day/i);
    expect(extracted).not.toMatch(/^change my goal/i);

    const c = commitmentAwaitingConfirm({
      sms_state: "awaiting_candidate",
      detected_intent: "sms_replace_request",
      raw_user_text: raw,
      candidate_behavior_statement: null,
      candidate_new_bar: null,
      confirmation_prompt_sent_at: null,
    });

    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMpr_concrete_change", raw_body: raw },
      clerkUserId: "user_pr",
      commitment: c,
    });

    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.pendingResolutionApplied).toBe(false);
      expect(r.replyBody.toLowerCase()).toMatch(/hold you to|change the focus|raise the/);
    }
    expect(mergeMock).toHaveBeenCalled();
    const mergeFn = mergeMock.mock.calls[0]![0].merge as (prev: Record<string, unknown>) => Record<
      string,
      unknown
    >;
    const merged = mergeFn({
      source: "sms_inbound",
      detected_intent: "sms_replace_request",
      raw_user_text: raw,
      inbound_message_sid: "SMpr_concrete_change",
      ai_confidence: null,
      sms_state: "awaiting_candidate",
    });
    expect(merged.sms_state).toBe("awaiting_confirmation");
    expect(String(merged.candidate_behavior_statement)).toMatch(/walking 10,?000 steps every day/i);
    expect(String(merged.candidate_behavior_statement)).not.toBe(raw);
  });

  it("C — duration-anchored concrete bar still extracts", () => {
    const raw = "Walk 20 minutes after dinner.";
    expect(extractDeterministicDailyBarCandidate(raw)).toMatch(/20 minutes/i);
  });

  it("E — raw full-body alone is never a deterministic candidate source", () => {
    expect(extractDeterministicDailyBarCandidate("I want to change my goal, please.")).toBeNull();
    expect(extractDeterministicDailyBarCandidate("Please change my current goal somehow.")).toBeNull();
    expect(extractDeterministicDailyBarCandidate("I'd like a different focus going forward.")).toBeNull();
  });

  it("F — I agree to concrete clause still extracts", () => {
    const msg = "I agree to give each kid one genuine compliment every day";
    const extracted = extractDeterministicDailyBarCandidate(msg);
    expect(extracted).toMatch(/give each kid one genuine compliment every day/i);
    expect(extracted).not.toMatch(/^i agree/i);
  });
});

describe("pending confirmation — I agree confirms existing candidate, not as candidate text", () => {
  it("awaiting_confirmation + I agree applies existing candidate via RPC", async () => {
    const cand = "give each kid one genuine compliment every day";
    const c = commitmentAwaitingConfirm({
      candidate_behavior_statement: cand,
      candidate_new_bar: cand,
    });
    getActiveCommitmentMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...c,
        behavior_statement: cand,
        pending_resolution_kind: null,
        pending_resolution_payload: null,
      });

    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMpr_i_agree_confirm", raw_body: "I agree" },
      clerkUserId: "user_pr",
      commitment: c,
    });

    expect(r.handled).toBe(true);
    expect(rpcMock).toHaveBeenCalled();
    if (r.handled) {
      expect(r.pendingResolutionApplied).toBe(true);
      expect(r.replyBody.toLowerCase()).not.toMatch(/i'?m still holding|the lock|locked in/);
    }
  });

  it("awaiting_candidate + I agree does not promote I agree as candidate", async () => {
    const c = commitmentAwaitingConfirm({
      sms_state: "awaiting_candidate",
      candidate_behavior_statement: null,
      candidate_new_bar: null,
      confirmation_prompt_sent_at: null,
    });
    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMpr_i_agree_no_cand", raw_body: "I agree." },
      clerkUserId: "user_pr",
      commitment: c,
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.pendingResolutionApplied).toBe(false);
      expect(r.replyBody.toLowerCase()).toMatch(/hold you to|clear daily|what exactly/i);
      expect(r.replyBody.toLowerCase()).not.toMatch(/i'?m still holding|the lock|locked in/);
      expect(r.replyBody.toLowerCase()).not.toMatch(/i agree/);
    }
  });

  it("awaiting_candidate + I want a change asks for new goal without lock jargon", async () => {
    const c = commitmentAwaitingConfirm({
      sms_state: "awaiting_candidate",
      candidate_behavior_statement: null,
      candidate_new_bar: null,
      confirmation_prompt_sent_at: null,
    });
    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMpr_want_change", raw_body: "I want a change" },
      clerkUserId: "user_pr",
      commitment: c,
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.pendingResolutionApplied).toBe(false);
      expect(r.replyBody.toLowerCase()).not.toMatch(/i'?m still holding|the lock|locked in/);
      expect(r.replyBody.toLowerCase()).toMatch(/hold you to|clear daily|what exactly/i);
    }
  });

  it("confusion about lock does not become candidate and avoids lock jargon", async () => {
    const c = commitmentAwaitingConfirm({
      sms_state: "awaiting_candidate",
      candidate_behavior_statement: null,
      candidate_new_bar: null,
      confirmation_prompt_sent_at: null,
    });
    const r = await tryHandleSmsInboundPendingResolution({
      job: {
        message_sid: "SMpr_lock_confusion",
        raw_body: "What I agree what is the lock?",
      },
      clerkUserId: "user_pr",
      commitment: c,
    });
    expect(r.handled).toBe(true);
    if (r.handled) {
      expect(r.pendingResolutionApplied).toBe(false);
      expect(r.replyBody.toLowerCase()).not.toMatch(/\block\b|i'?m still holding/);
      expect(r.replyBody.toLowerCase()).toMatch(/hold you to|clear daily|what exactly/i);
    }
  });
});

describe("tryHandleSmsInboundPendingResolution — compound yes/confirm", () => {
  it("8: awaiting_confirmation + compound yes/confirm => RPC called and pending applied", async () => {
    const c = commitmentAwaitingConfirm({
      candidate_behavior_statement: "Aiming for 8 hours of sleep from 10pm to 6am",
      candidate_new_bar: "Aiming for 8 hours of sleep from 10pm to 6am",
    });
    getActiveCommitmentMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...c,
        behavior_statement: "Aiming for 8 hours of sleep from 10pm to 6am",
        pending_resolution_kind: null,
        pending_resolution_payload: null,
      });

    const r = await tryHandleSmsInboundPendingResolution({
      job: {
        message_sid: "SMpr_confirm_compound",
        raw_body: "Yes, confirm and accomplished last night. Put on calendar going forward.",
      },
      clerkUserId: "user_pr",
      commitment: c,
    });

    expect(r.handled).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    if (r.handled) {
      expect(r.pendingResolutionApplied).toBe(true);
      expect(r.pendingClearedBeforeSms).toBe(true);
    }
  });

  it("9: accomplishment tail on pending route defers outcome persistence (no proof write)", () => {
    const raw =
      "Yes, confirm and accomplished last night. Put on calendar going forward.";
    const persistence = derivePersistenceDecision({
      meaning: {
        relationship_meaning: "reported_completion",
        temporal_scope: "past",
        confidence: "high",
        evidence: ["reported_completion_candidate"],
        disqualifiers: [],
      },
      routePriority: { pending_resolution: true },
      classifierEventType: "user_yes",
      rawInbound: raw,
    });
    expect(persistence.persistence_decision).toBe("defer_to_pending_resolution");
  });

  it("10: Yes, but change... does not RPC and stays pending clarify", async () => {
    const c = commitmentAwaitingConfirm({
      candidate_behavior_statement: "Walk 20 minutes after dinner",
      candidate_new_bar: "Walk 20 minutes after dinner",
    });
    const r = await tryHandleSmsInboundPendingResolution({
      job: {
        message_sid: "SMpr_change",
        raw_body: "Yes, but change it to 9 hours",
      },
      clerkUserId: "user_pr",
      commitment: c,
    });
    expect(r.handled).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
    if (r.handled) {
      expect(r.pendingResolutionApplied).toBe(false);
      expect(r.pendingStillActiveAfterPhase1).toBe(true);
      expect(r.replyBody).toMatch(/what would work better|clear daily action/i);
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
      expect(r.replyBody.toLowerCase()).toMatch(/raise the (bar|standard)|hold you to that/);
      expect(r.replyBody.toLowerCase()).not.toMatch(/new commitment|the lock|locked in/);
    }
  });

  it("new_chapter confirmation preview uses focus / hold-you-to wording", async () => {
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
      expect(r.replyBody.toLowerCase()).toMatch(/change the focus|hold you to that/);
      expect(r.replyBody.toLowerCase()).not.toMatch(/new commitment|lock that in|the lock/);
    }
  });
});
