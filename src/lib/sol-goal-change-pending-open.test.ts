import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  emptySolGoalChangeSemanticResult,
  SOL_GOAL_CHANGE_SEMANTIC_VERSION,
} from "@/lib/sol-goal-change-semantic";
import type { SolGoalChangeSemanticResult } from "@/lib/sol-goal-change-semantic";

const getActiveCommitment = vi.hoisted(() => vi.fn());
const recomputeV2CoachingMemory = vi.hoisted(() => vi.fn());
const applyWave4SmsCommitmentPendingResolution = vi.hoisted(() => vi.fn());
const bootstrapSmsPendingConfirmationFromInbound = vi.hoisted(() => vi.fn());
const runSolGoalChangeSemanticInterpreter = vi.hoisted(() => vi.fn());
const mergeSmsPendingResolutionPayload = vi.hoisted(() => vi.fn());
const clearPendingResolution = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("@/lib/v2-commitment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-commitment")>();
  return { ...actual, getActiveCommitment };
});

vi.mock("@/lib/v2-coaching-memory", () => ({
  recomputeV2CoachingMemory,
}));

vi.mock("@/lib/v2-sms-commitment-change", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-sms-commitment-change")>();
  return { ...actual, applyWave4SmsCommitmentPendingResolution };
});

vi.mock("@/lib/v2-sms-pending-resolution-complete", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/v2-sms-pending-resolution-complete")>();
  return { ...actual, bootstrapSmsPendingConfirmationFromInbound };
});

vi.mock("@/lib/sol-goal-change-semantic-interpreter", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/sol-goal-change-semantic-interpreter")>();
  return { ...actual, runSolGoalChangeSemanticInterpreter };
});

vi.mock("@/lib/v2-guided-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-guided-resolution")>();
  return { ...actual, mergeSmsPendingResolutionPayload, clearPendingResolution };
});

import {
  confirmationAuthorizationFromReloadedCommitment,
  isStructuralIncompleteReplacementCandidate,
  normalizeSemanticSavedReplaceCandidate,
  runSolGoalChangePendingOpenForInbound,
  shouldAttemptSolSavedReplaceAwaitingCandidateHallway,
  shouldAttemptSolSavedReplacePendingOpen,
  trySubstituteClockFragmentIntoCanonical,
} from "@/lib/sol-goal-change-pending-open";

const ANGELA_CANONICAL = "I will be in bed by 9:30 pm nightly.";
const ANGELA_NORMALIZED = "I will be in bed by 10:30 pm nightly.";
const WORKOUT_CANONICAL = "I will work out five days per week.";
const WORKOUT_FOUR = "I will work out four days per week.";
const ANGELA_INBOUND =
  "I'm out of town tonight, so 9:30 won't happen. Additionally I think I need to revise to 10:30.";

function commitment(overrides: Partial<ActiveV2CommitmentRow> = {}): ActiveV2CommitmentRow {
  return {
    id: "cmt_angela",
    clerk_user_id: "user_angela",
    status: "active",
    behavior_statement: ANGELA_CANONICAL,
    title: "Bed",
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
    pending_resolution_kind: null,
    pending_resolution_created_at: null,
    pending_resolution_expires_at: null,
    pending_resolution_payload: null,
    updated_at: "2026-09-07T12:00:00.000Z",
    started_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function withPending(
  row: ActiveV2CommitmentRow,
  payload: Record<string, unknown>
): ActiveV2CommitmentRow {
  return {
    ...row,
    pending_resolution_kind: "commitment_replace",
    pending_resolution_created_at: "2026-09-07T12:00:00.000Z",
    pending_resolution_expires_at: "2027-09-07T12:00:00.000Z",
    pending_resolution_payload: payload,
  };
}

function semantic(
  overrides: Partial<SolGoalChangeSemanticResult["goal_change"]> & {
    concurrent?: Partial<SolGoalChangeSemanticResult["concurrent_meaning"]>;
  } = {}
): SolGoalChangeSemanticResult {
  const { concurrent, ...goal } = overrides;
  return {
    version: SOL_GOAL_CHANGE_SEMANTIC_VERSION,
    goal_change: {
      ...emptySolGoalChangeSemanticResult().goal_change,
      intent: "saved_replace",
      candidate_behavior_statement: "10:30",
      needs_clarification: false,
      requires_confirmation: true,
      confirms_existing_pending: false,
      rejects_existing_pending: false,
      modifies_existing_pending_candidate: false,
      member_meaning_summary: "Revise nightly bedtime to 10:30",
      ...goal,
    },
    concurrent_meaning: {
      planned_interruption: false,
      accountability_update: false,
      ...concurrent,
    },
  };
}

function interpreterOk(result: SolGoalChangeSemanticResult) {
  return {
    ok: true as const,
    result,
    error: null,
    capture: { retry_occurred: false },
  };
}

describe("normalizeSemanticSavedReplaceCandidate", () => {
  it("substitutes a clock fragment into a one-clock canonical bar", () => {
    expect(trySubstituteClockFragmentIntoCanonical(ANGELA_CANONICAL, "10:30")).toBe(
      ANGELA_NORMALIZED
    );
    const n = normalizeSemanticSavedReplaceCandidate({
      semanticCandidate: "10:30",
      canonicalBehaviorStatement: ANGELA_CANONICAL,
      inboundRaw: ANGELA_INBOUND,
    });
    expect(n).toEqual({ ok: true, candidate: ANGELA_NORMALIZED });
  });

  it("fails closed on a clock fragment when canonical has no clock", () => {
    const n = normalizeSemanticSavedReplaceCandidate({
      semanticCandidate: "10:30",
      canonicalBehaviorStatement: "Walk 20 minutes after dinner",
      inboundRaw: "I need to revise to 10:30",
    });
    expect(n.ok).toBe(false);
  });

  it("rejects a vague candidate", () => {
    const n = normalizeSemanticSavedReplaceCandidate({
      semanticCandidate: "be better",
      canonicalBehaviorStatement: ANGELA_CANONICAL,
      inboundRaw: "I need to be better",
    });
    expect(n.ok).toBe(false);
  });

  it("rejects a raw frequency crumb that must not become canonical", () => {
    expect(isStructuralIncompleteReplacementCandidate("Four days per week")).toBe(true);
    const n = normalizeSemanticSavedReplaceCandidate({
      semanticCandidate: "Four days per week",
      canonicalBehaviorStatement: WORKOUT_CANONICAL,
      inboundRaw: "I want to change my goal to four days per week",
    });
    expect(n).toEqual({ ok: false, reason: "incomplete_replacement_fragment" });
  });

  it("rejects a raw weekday crumb that must not become canonical", () => {
    expect(isStructuralIncompleteReplacementCandidate("Monday through Thursday")).toBe(true);
    const n = normalizeSemanticSavedReplaceCandidate({
      semanticCandidate: "Monday through Thursday",
      canonicalBehaviorStatement: WORKOUT_CANONICAL,
      inboundRaw: "Monday through Thursday",
    });
    expect(n).toEqual({ ok: false, reason: "incomplete_replacement_fragment" });
  });

  it("accepts a full workout replacement sentence", () => {
    expect(isStructuralIncompleteReplacementCandidate(WORKOUT_FOUR)).toBe(false);
    const n = normalizeSemanticSavedReplaceCandidate({
      semanticCandidate: WORKOUT_FOUR,
      canonicalBehaviorStatement: WORKOUT_CANONICAL,
      inboundRaw: "I will work out four days per week.",
    });
    expect(n).toEqual({ ok: true, candidate: WORKOUT_FOUR });
  });
});

describe("shouldAttemptSolSavedReplacePendingOpen", () => {
  it("opens only for saved_replace with a nonempty candidate and no pending mutation flags", () => {
    expect(shouldAttemptSolSavedReplacePendingOpen(semantic())).toBe(true);
    expect(
      shouldAttemptSolSavedReplacePendingOpen(semantic({ intent: "possible_saved_replace" }))
    ).toBe(false);
    expect(
      shouldAttemptSolSavedReplacePendingOpen(semantic({ intent: "temporary_adjustment" }))
    ).toBe(false);
    expect(
      shouldAttemptSolSavedReplacePendingOpen(semantic({ confirms_existing_pending: true }))
    ).toBe(false);
    expect(
      shouldAttemptSolSavedReplacePendingOpen(semantic({ needs_clarification: true }))
    ).toBe(false);
  });
});

describe("shouldAttemptSolSavedReplaceAwaitingCandidateHallway", () => {
  it("opens a Sol-owned replace hallway when saved-replace needs a candidate", () => {
    expect(
      shouldAttemptSolSavedReplaceAwaitingCandidateHallway(
        semantic({
          intent: "possible_saved_replace",
          candidate_behavior_statement: null,
          needs_clarification: true,
        })
      )
    ).toBe(true);
    expect(
      shouldAttemptSolSavedReplaceAwaitingCandidateHallway(
        semantic({
          intent: "saved_replace",
          candidate_behavior_statement: null,
          needs_clarification: true,
        })
      )
    ).toBe(true);
    expect(shouldAttemptSolSavedReplaceAwaitingCandidateHallway(semantic())).toBe(false);
    expect(
      shouldAttemptSolSavedReplaceAwaitingCandidateHallway(
        semantic({ intent: "none", candidate_behavior_statement: null, needs_clarification: false })
      )
    ).toBe(false);
    expect(
      shouldAttemptSolSavedReplaceAwaitingCandidateHallway(
        semantic({ intent: "temporary_adjustment", needs_clarification: true })
      )
    ).toBe(false);
  });
});

describe("runSolGoalChangePendingOpenForInbound", () => {
  const base = commitment();

  beforeEach(() => {
    getActiveCommitment.mockReset();
    recomputeV2CoachingMemory.mockReset();
    applyWave4SmsCommitmentPendingResolution.mockReset();
    bootstrapSmsPendingConfirmationFromInbound.mockReset();
    runSolGoalChangeSemanticInterpreter.mockReset();
    mergeSmsPendingResolutionPayload.mockReset();
    clearPendingResolution.mockReset();
    recomputeV2CoachingMemory.mockResolvedValue(undefined);
    getActiveCommitment.mockResolvedValue(base);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(interpreterOk(semantic()));
    applyWave4SmsCommitmentPendingResolution.mockResolvedValue({
      pendingApplied: true,
      pendingKind: "commitment_replace",
      skipReason: null,
    });
    bootstrapSmsPendingConfirmationFromInbound.mockResolvedValue({
      promoted: true,
      candidate: ANGELA_NORMALIZED,
      skipReason: null,
    });
    mergeSmsPendingResolutionPayload.mockResolvedValue({ ok: true, updatedAt: base.updated_at });
    clearPendingResolution.mockResolvedValue(undefined);
  });

  async function run(
    overrides: Partial<Parameters<typeof runSolGoalChangePendingOpenForInbound>[0]> = {}
  ) {
    return runSolGoalChangePendingOpenForInbound({
      clerkUserId: "user_angela",
      commitment: base,
      inboundRaw: ANGELA_INBOUND,
      messageSid: "SMangela",
      plannedInterruptionKnown: false,
      timezone: "America/Chicago",
      ...overrides,
    });
  }

  it("1: semantic saved replace + valid candidate + pending write succeeds → confirmation authorized", async () => {
    const awaiting = withPending(base, {
      source: "sms_inbound",
      sms_state: "awaiting_confirmation",
      detected_intent: "sms_replace_request",
      candidate_behavior_statement: ANGELA_NORMALIZED,
      candidate_new_bar: ANGELA_NORMALIZED,
      inbound_message_sid: "SMangela",
      raw_user_text: ANGELA_INBOUND,
    });
    getActiveCommitment
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(
        withPending(base, {
          source: "sms_inbound",
          sms_state: "awaiting_candidate",
          detected_intent: "sms_replace_request",
          candidate_new_bar: ANGELA_NORMALIZED,
          inbound_message_sid: "SMangela",
          raw_user_text: ANGELA_INBOUND,
        })
      )
      .mockResolvedValueOnce(awaiting);

    const r = await run();
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
    expect(r.authorization.candidate_behavior_statement).toBe(ANGELA_NORMALIZED);
    expect(r.authorization.pending_state).toBe("awaiting_confirmation");
    expect(r.forensics.pending_write_applied).toBe(true);
    expect(applyWave4SmsCommitmentPendingResolution).toHaveBeenCalledTimes(1);
    expect(applyWave4SmsCommitmentPendingResolution.mock.calls[0]?.[0]?.intentPack).toMatchObject({
      intent: "sms_replace_request",
      candidateNewBar: ANGELA_NORMALIZED,
    });
  });

  it("2: semantic saved replace + invalid candidate → no pending, no binding confirmation", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ candidate_behavior_statement: "be better" }))
    );
    const r = await run();
    expect(r.authorization.goal_change_confirmation_authorized).toBe(false);
    expect(r.forensics.pending_attempted).toBe(false);
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
  });

  it("3: pending write throws → no binding confirmation", async () => {
    applyWave4SmsCommitmentPendingResolution.mockRejectedValue(new Error("cas_mismatch"));
    const r = await run();
    expect(r.authorization.goal_change_confirmation_authorized).toBe(false);
    expect(r.forensics.pending_attempted).toBe(true);
    expect(r.forensics.pending_write_applied).toBe(false);
    expect(r.forensics.pending_skip_reason).toContain("cas_mismatch");
  });

  it("4: pending write appears successful but reload does not show expected pending → no binding confirmation", async () => {
    getActiveCommitment.mockResolvedValue(base);
    const r = await run();
    expect(applyWave4SmsCommitmentPendingResolution).toHaveBeenCalled();
    expect(r.authorization.goal_change_confirmation_authorized).toBe(false);
    expect(r.forensics.reload_authorized).toBe(false);
  });

  it("5: planned interruption + saved replace does not erase pending creation", async () => {
    const awaiting = withPending(base, {
      source: "sms_inbound",
      sms_state: "awaiting_confirmation",
      detected_intent: "sms_replace_request",
      candidate_behavior_statement: ANGELA_NORMALIZED,
      candidate_new_bar: ANGELA_NORMALIZED,
      inbound_message_sid: "SMangela",
      raw_user_text: ANGELA_INBOUND,
    });
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ concurrent: { planned_interruption: true } }))
    );
    getActiveCommitment
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(
        withPending(base, {
          source: "sms_inbound",
          sms_state: "awaiting_candidate",
          candidate_new_bar: ANGELA_NORMALIZED,
          detected_intent: "sms_replace_request",
          inbound_message_sid: "SMangela",
          raw_user_text: ANGELA_INBOUND,
        })
      )
      .mockResolvedValueOnce(awaiting);

    const r = await run({ plannedInterruptionKnown: true });
    expect(runSolGoalChangeSemanticInterpreter.mock.calls[0]?.[0]?.input.planned_interruption_known).toBe(
      true
    );
    expect(applyWave4SmsCommitmentPendingResolution).toHaveBeenCalledTimes(1);
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
  });

  it("6: heuristic-blind revise still drives pending via the semantic interpreter", async () => {
    const awaiting = withPending(base, {
      source: "sms_inbound",
      sms_state: "awaiting_confirmation",
      detected_intent: "sms_replace_request",
      candidate_behavior_statement: ANGELA_NORMALIZED,
      candidate_new_bar: ANGELA_NORMALIZED,
      inbound_message_sid: "SMangela",
      raw_user_text: ANGELA_INBOUND,
    });
    getActiveCommitment
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(
        withPending(base, {
          source: "sms_inbound",
          sms_state: "awaiting_candidate",
          candidate_new_bar: ANGELA_NORMALIZED,
          detected_intent: "sms_replace_request",
          inbound_message_sid: "SMangela",
          raw_user_text: ANGELA_INBOUND,
        })
      )
      .mockResolvedValueOnce(awaiting);
    const r = await run();
    expect(r.forensics.semantic_intent).toBe("saved_replace");
    expect(applyWave4SmsCommitmentPendingResolution).toHaveBeenCalled();
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
  });

  it("Slice 5: change my goal to 10:30 normalizes to the full canonical sentence, not the clock fragment", async () => {
    const inbound = "I want to change my goal to 10:30.";
    const awaiting = withPending(base, {
      source: "sms_inbound",
      sms_state: "awaiting_confirmation",
      detected_intent: "sms_replace_request",
      candidate_behavior_statement: ANGELA_NORMALIZED,
      candidate_new_bar: ANGELA_NORMALIZED,
      inbound_message_sid: "SMangela",
      raw_user_text: inbound,
    });
    getActiveCommitment
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(
        withPending(base, {
          source: "sms_inbound",
          sms_state: "awaiting_candidate",
          detected_intent: "sms_replace_request",
          candidate_new_bar: ANGELA_NORMALIZED,
          inbound_message_sid: "SMangela",
          raw_user_text: inbound,
        })
      )
      .mockResolvedValueOnce(awaiting);

    const r = await run({ inboundRaw: inbound });
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
    expect(r.authorization.candidate_behavior_statement).toBe(ANGELA_NORMALIZED);
    expect(r.authorization.candidate_behavior_statement).not.toBe("10:30");
    expect(applyWave4SmsCommitmentPendingResolution.mock.calls[0]?.[0]?.intentPack).toMatchObject({
      intent: "sms_replace_request",
      candidateNewBar: ANGELA_NORMALIZED,
    });
    expect(applyWave4SmsCommitmentPendingResolution.mock.calls[0]?.[0]?.rawBody).toBe(inbound);
  });

  it("7: existing awaiting_confirmation pending → no duplicate pending", async () => {
    const existing = withPending(base, {
      source: "sms_inbound",
      sms_state: "awaiting_confirmation",
      detected_intent: "sms_replace_request",
      candidate_behavior_statement: ANGELA_NORMALIZED,
      candidate_new_bar: ANGELA_NORMALIZED,
      inbound_message_sid: "SMprior",
      raw_user_text: "prior",
    });
    getActiveCommitment.mockResolvedValue(existing);
    const r = await run({ commitment: existing });
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
    expect(runSolGoalChangeSemanticInterpreter).not.toHaveBeenCalled();
    expect(r.forensics.pending_skip_reason).toBe("existing_pending");
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
  });

  it("8: Sol possible_saved_replace without a candidate writes awaiting_candidate hallway, not confirmation", async () => {
    const hallway = withPending(base, {
      source: "sms_inbound",
      sms_state: "awaiting_candidate",
      detected_intent: "sms_replace_request",
      candidate_behavior_statement: null,
      candidate_new_bar: null,
      inbound_message_sid: "SMangela",
      raw_user_text: "I want to change my goal.",
    });
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "possible_saved_replace",
          candidate_behavior_statement: null,
          needs_clarification: true,
        })
      )
    );
    bootstrapSmsPendingConfirmationFromInbound.mockResolvedValue({
      promoted: false,
      candidate: null,
      skipReason: "sol_owned_awaiting_candidate_shell",
    });
    getActiveCommitment
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(hallway)
      .mockResolvedValueOnce(hallway);
    const r = await run({ inboundRaw: "I want to change my goal." });
    expect(applyWave4SmsCommitmentPendingResolution).toHaveBeenCalledTimes(1);
    expect(applyWave4SmsCommitmentPendingResolution.mock.calls[0]?.[0]?.intentPack).toMatchObject({
      intent: "sms_replace_request",
      candidateNewBar: null,
    });
    expect(bootstrapSmsPendingConfirmationFromInbound.mock.calls[0]?.[0]).toMatchObject({
      openedAsAwaitingCandidateShell: true,
    });
    expect(r.forensics.hallway_opened).toBe(true);
    expect(r.forensics.pending_write_applied).toBe(true);
    expect(r.authorization.goal_change_confirmation_authorized).toBe(false);
    expect(r.authorization.candidate_behavior_statement).toBeNull();
    expect(r.authorization.pending_state).toBe("awaiting_candidate");
  });

  it("8g: Sol hallway with extractable clock wording still calls bootstrap as shell-only", async () => {
    const inbound = "I want to change my goal to 10:30";
    const hallway = withPending(base, {
      source: "sms_inbound",
      sms_state: "awaiting_candidate",
      detected_intent: "sms_replace_request",
      candidate_behavior_statement: null,
      candidate_new_bar: null,
      inbound_message_sid: "SMangela",
      raw_user_text: inbound,
    });
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "possible_saved_replace",
          candidate_behavior_statement: null,
          needs_clarification: true,
        })
      )
    );
    bootstrapSmsPendingConfirmationFromInbound.mockResolvedValue({
      promoted: false,
      candidate: null,
      skipReason: "sol_owned_awaiting_candidate_shell",
    });
    getActiveCommitment
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(hallway)
      .mockResolvedValueOnce(hallway);
    const r = await run({ inboundRaw: inbound });
    expect(bootstrapSmsPendingConfirmationFromInbound.mock.calls[0]?.[0]).toMatchObject({
      openedAsAwaitingCandidateShell: true,
      rawBody: inbound,
    });
    expect(r.forensics.bootstrap_promoted).toBe(false);
    expect(r.forensics.hallway_opened).toBe(true);
    expect(r.authorization.pending_state).toBe("awaiting_candidate");
    expect(r.authorization.goal_change_confirmation_authorized).toBe(false);
    expect(r.authorization.candidate_behavior_statement).toBeNull();
  });

  it("8h: first-turn Sol frequency crumb does not open confirmable pending", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "saved_replace",
          candidate_behavior_statement: "Four days per week",
        })
      )
    );
    const r = await run({
      inboundRaw: "I want to change my goal to four days per week",
      commitment: commitment({ behavior_statement: WORKOUT_CANONICAL }),
    });
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
    expect(r.authorization.goal_change_confirmation_authorized).toBe(false);
    expect(r.forensics.pending_skip_reason).toBe("incomplete_replacement_fragment");
    expect(r.forensics.hallway_opened).toBe(false);
  });

  it("8i: first-turn Sol weekday crumb does not open confirmable pending", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "saved_replace",
          candidate_behavior_statement: "Monday through Thursday",
        })
      )
    );
    const r = await run({
      inboundRaw: "Monday through Thursday",
      commitment: commitment({ behavior_statement: WORKOUT_CANONICAL }),
    });
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
    expect(r.authorization.goal_change_confirmation_authorized).toBe(false);
    expect(r.forensics.pending_skip_reason).toBe("incomplete_replacement_fragment");
  });

  it("8j: first-turn full workout sentence opens confirmable pending", async () => {
    const workout = commitment({ behavior_statement: WORKOUT_CANONICAL });
    const awaiting = withPending(workout, {
      source: "sms_inbound",
      sms_state: "awaiting_confirmation",
      detected_intent: "sms_replace_request",
      candidate_behavior_statement: WORKOUT_FOUR,
      candidate_new_bar: WORKOUT_FOUR,
      inbound_message_sid: "SMangela",
      raw_user_text: WORKOUT_FOUR,
    });
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "saved_replace",
          candidate_behavior_statement: WORKOUT_FOUR,
        })
      )
    );
    bootstrapSmsPendingConfirmationFromInbound.mockResolvedValue({
      promoted: true,
      candidate: WORKOUT_FOUR,
      skipReason: null,
    });
    getActiveCommitment
      .mockResolvedValueOnce(workout)
      .mockResolvedValueOnce(
        withPending(workout, {
          source: "sms_inbound",
          sms_state: "awaiting_candidate",
          detected_intent: "sms_replace_request",
          candidate_new_bar: WORKOUT_FOUR,
          inbound_message_sid: "SMangela",
          raw_user_text: WORKOUT_FOUR,
        })
      )
      .mockResolvedValueOnce(awaiting);
    const r = await run({
      commitment: workout,
      inboundRaw: "I will work out four days per week.",
    });
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
    expect(r.authorization.candidate_behavior_statement).toBe(WORKOUT_FOUR);
    expect(r.authorization.goal_change_apply_authorized).toBe(false);
  });

  it("8b: interpreter failure does not create awaiting_candidate", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue({
      ok: false,
      result: null,
      error: "openai_unavailable",
      capture: { retry_occurred: false },
    });
    const r = await run({ inboundRaw: "I want to change my goal." });
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
    expect(r.forensics.hallway_opened).toBe(false);
    expect(r.authorization.goal_change_confirmation_authorized).toBe(false);
  });

  it("8c: Sol none on negated Goal Change does not create pending", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "none",
          candidate_behavior_statement: null,
          needs_clarification: false,
        })
      )
    );
    const r = await run({ inboundRaw: "I don't want to change my goal." });
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
    expect(r.forensics.hallway_opened).toBe(false);
  });

  it("8d: Sol none on a Goal Change question does not create pending", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "none",
          candidate_behavior_statement: null,
          needs_clarification: false,
        })
      )
    );
    const r = await run({ inboundRaw: "Can I change my goal?" });
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
    expect(r.forensics.hallway_opened).toBe(false);
  });

  it("8e: existing awaiting_candidate pending is not overwritten", async () => {
    const existing = withPending(base, {
      source: "sms_inbound",
      sms_state: "awaiting_candidate",
      detected_intent: "sms_replace_request",
      candidate_behavior_statement: null,
      candidate_new_bar: null,
      inbound_message_sid: "SMprior",
      raw_user_text: "I want to change my goal.",
    });
    getActiveCommitment.mockResolvedValue(existing);
    const r = await run({ commitment: existing, inboundRaw: "I want to change my goal." });
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
    expect(runSolGoalChangeSemanticInterpreter).not.toHaveBeenCalled();
    expect(r.forensics.pending_skip_reason).toBe("existing_pending_not_confirmable");
  });

  it("8f: existing commitment_tighten pending is not overwritten by Sol hallway", async () => {
    const existing = {
      ...base,
      pending_resolution_kind: "commitment_tighten" as const,
      pending_resolution_created_at: "2026-09-07T12:00:00.000Z",
      pending_resolution_expires_at: "2027-09-07T12:00:00.000Z",
      pending_resolution_payload: {
        source: "sms_inbound",
        sms_state: "awaiting_confirmation",
        detected_intent: "sms_tighten_request",
        candidate_tightened_bar: "Walk 10 minutes after dinner",
        inbound_message_sid: "SMtight",
        raw_user_text: "make it smaller",
      },
    };
    getActiveCommitment.mockResolvedValue(existing);
    const r = await run({ commitment: existing, inboundRaw: "I want to change my goal." });
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
    expect(r.forensics.pending_skip_reason).toBe("existing_pending_not_confirmable");
  });

  it("9: semantic temporary_adjustment with unspecified duration opens temp hallway, not saved replace", async () => {
    const tempPending = {
      ...base,
      pending_resolution_kind: "commitment_tighten" as const,
      pending_resolution_created_at: "2026-09-07T12:00:00.000Z",
      pending_resolution_expires_at: "2027-09-07T12:00:00.000Z",
      pending_resolution_payload: {
        source: "sms_inbound",
        sms_state: "awaiting_candidate",
        detected_intent: "sms_tighten_request",
        sol_temporary_overlay: true,
        candidate_behavior_statement: ANGELA_NORMALIZED,
        candidate_tightened_bar: ANGELA_NORMALIZED,
        inbound_message_sid: "SMangela",
        raw_user_text: ANGELA_INBOUND,
        temporary_duration_kind: "unspecified",
        temporary_duration_days: null,
        temporary_expires_at: null,
        canonical_behavior_snapshot: ANGELA_CANONICAL,
      },
    };
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ intent: "temporary_adjustment" }))
    );
    applyWave4SmsCommitmentPendingResolution.mockResolvedValue({
      pendingApplied: true,
      pendingKind: "commitment_tighten",
      skipReason: null,
    });
    getActiveCommitment.mockResolvedValueOnce(base).mockResolvedValue(tempPending);
    const r = await run();
    expect(applyWave4SmsCommitmentPendingResolution).toHaveBeenCalledTimes(1);
    expect(applyWave4SmsCommitmentPendingResolution.mock.calls[0]?.[0]?.intentPack).toMatchObject({
      intent: "sms_tighten_request",
    });
    expect(r.authorization.goal_change_confirmation_authorized).toBe(false);
    expect(r.authorization.temporary_adjustment_confirmation_authorized).not.toBe(true);
    expect(r.authorization.pending_state).toBe("awaiting_candidate");
    expect(r.authorization.duration_clarification_required).toBe(true);
    expect(r.forensics.pending_write_applied).toBe(true);
  });

  it("10: interpreter unavailable → no unbound binding confirmation", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue({
      ok: false,
      result: null,
      error: "openai_unavailable",
      capture: { retry_occurred: false },
    });
    const r = await run();
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
    expect(r.authorization.goal_change_confirmation_authorized).toBe(false);
    expect(r.forensics.interpreter_ok).toBe(false);
  });

  it("Angela dual-intent: PI known + revise to 10:30 opens pending then authorizes confirmation", async () => {
    const awaiting = withPending(base, {
      source: "sms_inbound",
      sms_state: "awaiting_confirmation",
      detected_intent: "sms_replace_request",
      candidate_behavior_statement: ANGELA_NORMALIZED,
      candidate_new_bar: ANGELA_NORMALIZED,
      inbound_message_sid: "SMangela",
      raw_user_text: ANGELA_INBOUND,
    });
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          concurrent: { planned_interruption: true },
          member_meaning_summary: "Travel tonight and revise nightly bedtime to 10:30",
        })
      )
    );
    getActiveCommitment
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(
        withPending(base, {
          source: "sms_inbound",
          sms_state: "awaiting_candidate",
          candidate_new_bar: ANGELA_NORMALIZED,
          detected_intent: "sms_replace_request",
          inbound_message_sid: "SMangela",
          raw_user_text: ANGELA_INBOUND,
        })
      )
      .mockResolvedValueOnce(awaiting);

    const r = await run({ plannedInterruptionKnown: true, inboundRaw: ANGELA_INBOUND });
    expect(r.authorization).toEqual({
      goal_change_confirmation_authorized: true,
      goal_change_apply_authorized: false,
      candidate_behavior_statement: ANGELA_NORMALIZED,
      canonical_behavior_statement: ANGELA_CANONICAL,
      pending_state: "awaiting_confirmation",
      previous_behavior_statement: null,
      previous_commitment_id: null,
      active_commitment_id: "cmt_angela",
      pending_cleared: false,
    });
    expect(r.forensics.pending_write_applied).toBe(true);
  });
});

describe("confirmationAuthorizationFromReloadedCommitment", () => {
  it("authorizes only actionable sms_inbound commitment_replace awaiting_confirmation", () => {
    const row = withPending(commitment(), {
      source: "sms_inbound",
      sms_state: "awaiting_confirmation",
      detected_intent: "sms_replace_request",
      raw_user_text: ANGELA_INBOUND,
      inbound_message_sid: "SMangela",
      ai_confidence: null,
      candidate_behavior_statement: ANGELA_NORMALIZED,
      candidate_new_bar: ANGELA_NORMALIZED,
    });
    const auth = confirmationAuthorizationFromReloadedCommitment(row, ANGELA_NORMALIZED);
    expect(auth.goal_change_confirmation_authorized).toBe(true);
    expect(auth.goal_change_apply_authorized).toBe(false);
    expect(auth.pending_state).toBe("awaiting_confirmation");
  });

  it("rejects candidate mismatch on reload", () => {
    const row = withPending(commitment(), {
      source: "sms_inbound",
      sms_state: "awaiting_confirmation",
      detected_intent: "sms_replace_request",
      raw_user_text: ANGELA_INBOUND,
      inbound_message_sid: "SMangela",
      ai_confidence: null,
      candidate_behavior_statement: "Walk 40 minutes daily",
    });
    const auth = confirmationAuthorizationFromReloadedCommitment(row, ANGELA_NORMALIZED);
    expect(auth.goal_change_confirmation_authorized).toBe(false);
  });
});
