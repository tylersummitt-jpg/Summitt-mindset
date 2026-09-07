import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { SOL_GOAL_CHANGE_SEMANTIC_VERSION } from "@/lib/sol-goal-change-semantic";
import type { SolGoalChangeSemanticResult } from "@/lib/sol-goal-change-semantic";

const getActiveCommitment = vi.hoisted(() => vi.fn());
const recomputeV2CoachingMemory = vi.hoisted(() => vi.fn());
const applyWave4SmsCommitmentPendingResolution = vi.hoisted(() => vi.fn());
const bootstrapSmsPendingConfirmationFromInbound = vi.hoisted(() => vi.fn());
const runSolGoalChangeSemanticInterpreter = vi.hoisted(() => vi.fn());
const clearPendingResolution = vi.hoisted(() => vi.fn());
const mergeSmsPendingResolutionPayload = vi.hoisted(() => vi.fn());

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
  return { ...actual, clearPendingResolution, mergeSmsPendingResolutionPayload };
});

import { runSolGoalChangePendingOpenForInbound } from "@/lib/sol-goal-change-pending-open";
import { runSolGoalChangePendingConfirmForInbound } from "@/lib/sol-goal-change-pending-confirm";
import {
  isSolOwnedReplaceAwaitingCandidatePending,
  isStructuralIncompleteReplacementCandidate,
  runSolGoalChangeAwaitingCandidateForInbound,
} from "@/lib/sol-goal-change-awaiting-candidate";

const ANGELA_CANONICAL = "I will be in bed by 9:30 pm nightly.";
const ANGELA_NORMALIZED = "I will be in bed by 10:30 pm nightly.";
const WORKOUT_CANONICAL = "I will work out five days per week.";
const WORKOUT_FOUR = "I will work out four days per week.";

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
  payload: Record<string, unknown>,
  kind: ActiveV2CommitmentRow["pending_resolution_kind"] = "commitment_replace"
): ActiveV2CommitmentRow {
  return {
    ...row,
    pending_resolution_kind: kind,
    pending_resolution_created_at: "2026-09-07T12:00:00.000Z",
    pending_resolution_expires_at: "2027-09-07T12:00:00.000Z",
    pending_resolution_payload: payload,
  };
}

function hallway(row: ActiveV2CommitmentRow = commitment()): ActiveV2CommitmentRow {
  return withPending(row, {
    source: "sms_inbound",
    sms_state: "awaiting_candidate",
    detected_intent: "sms_replace_request",
    candidate_behavior_statement: null,
    candidate_new_bar: null,
    inbound_message_sid: "SMturn1",
    raw_user_text: "I want to change my goal.",
  });
}

/** Predeploy-shaped row: Wave4 required fields only — no Slice-5-only metadata. */
function predeployHallway(): ActiveV2CommitmentRow {
  return withPending(commitment(), {
    source: "sms_inbound",
    detected_intent: "sms_replace_request",
    raw_user_text: "I want to change my goal.",
    inbound_message_sid: "SMpredeploy",
    ai_confidence: null,
    candidate_new_bar: null,
  });
}

function staged(candidate: string, row: ActiveV2CommitmentRow = commitment()): ActiveV2CommitmentRow {
  return withPending(row, {
    source: "sms_inbound",
    sms_state: "awaiting_confirmation",
    detected_intent: "sms_replace_request",
    candidate_behavior_statement: candidate,
    candidate_new_bar: candidate,
    inbound_message_sid: "SMturn2",
    raw_user_text: "10:30.",
  });
}

function semantic(
  overrides: Partial<SolGoalChangeSemanticResult["goal_change"]> = {}
): SolGoalChangeSemanticResult {
  return {
    version: SOL_GOAL_CHANGE_SEMANTIC_VERSION,
    goal_change: {
      intent: "saved_replace",
      candidate_behavior_statement: null,
      needs_clarification: false,
      requires_confirmation: true,
      confirms_existing_pending: false,
      rejects_existing_pending: false,
      modifies_existing_pending_candidate: false,
      member_meaning_summary: "Turn 2 hallway",
      ...overrides,
    },
    concurrent_meaning: {
      planned_interruption: false,
      accountability_update: false,
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

async function runTurn2(args: {
  commitment: ActiveV2CommitmentRow;
  inboundRaw: string;
}) {
  return runSolGoalChangeAwaitingCandidateForInbound({
    clerkUserId: args.commitment.clerk_user_id,
    commitment: args.commitment,
    inboundRaw: args.inboundRaw,
    messageSid: "SMturn2",
    timezone: "America/New_York",
  });
}

describe("isStructuralIncompleteReplacementCandidate", () => {
  it("rejects raw non-clock fragments that must not become canonical", () => {
    expect(isStructuralIncompleteReplacementCandidate("Four days per week")).toBe(true);
    expect(isStructuralIncompleteReplacementCandidate("4 times a week")).toBe(true);
    expect(isStructuralIncompleteReplacementCandidate("Monday through Thursday")).toBe(true);
    expect(isStructuralIncompleteReplacementCandidate("10:30")).toBe(true);
  });

  it("does not treat a full replacement sentence as a fragment", () => {
    expect(isStructuralIncompleteReplacementCandidate(WORKOUT_FOUR)).toBe(false);
    expect(isStructuralIncompleteReplacementCandidate(ANGELA_NORMALIZED)).toBe(false);
    expect(
      isStructuralIncompleteReplacementCandidate("No alcohol Monday through Thursday")
    ).toBe(false);
  });
});

describe("predeploy compatibility", () => {
  it("routes old sms_inbound replace awaiting_candidate rows without new-only metadata", () => {
    expect(isSolOwnedReplaceAwaitingCandidatePending(predeployHallway())).toBe(true);
    expect(predeployHallway().pending_resolution_payload).not.toHaveProperty(
      "awaiting_candidate_reason"
    );
    expect(predeployHallway().pending_resolution_payload).not.toHaveProperty("tu_goal_change_type");
    expect(isSolOwnedReplaceAwaitingCandidatePending(commitment())).toBe(false);
    expect(
      isSolOwnedReplaceAwaitingCandidatePending(
        withPending(
          commitment(),
          {
            source: "sms_inbound",
            detected_intent: "sms_tighten_request",
            raw_user_text: "make it easier this week",
            inbound_message_sid: "SMtighten",
            ai_confidence: null,
          },
          "commitment_tighten"
        )
      )
    ).toBe(false);
  });
});

describe("runSolGoalChangeAwaitingCandidateForInbound", () => {
  beforeEach(() => {
    getActiveCommitment.mockReset();
    recomputeV2CoachingMemory.mockReset();
    runSolGoalChangeSemanticInterpreter.mockReset();
    clearPendingResolution.mockReset();
    mergeSmsPendingResolutionPayload.mockReset();
    mergeSmsPendingResolutionPayload.mockResolvedValue({ ok: true });
    clearPendingResolution.mockResolvedValue(undefined);
    recomputeV2CoachingMemory.mockResolvedValue(undefined);
  });

  it("1–2 clock-only 10:30. expands structurally without calling Sol interpreter", async () => {
    const open = hallway();
    const after = staged(ANGELA_NORMALIZED);
    getActiveCommitment.mockResolvedValueOnce(open).mockResolvedValueOnce(after);
    const r = await runTurn2({ commitment: open, inboundRaw: "10:30." });
    expect(runSolGoalChangeSemanticInterpreter).not.toHaveBeenCalled();
    expect(r.forensics.clock_structural_used).toBe(true);
    expect(r.forensics.interpreter_invoked).toBe(false);
    expect(r.forensics.leftover_candidate_ai_invoked).toBe(false);
    expect(r.consequence).toBe("staged");
    expect(r.authorization.pending_state).toBe("awaiting_confirmation");
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
    expect(r.authorization.goal_change_apply_authorized).toBe(false);
    expect(r.authorization.candidate_behavior_statement).toBe(ANGELA_NORMALIZED);
    expect(mergeSmsPendingResolutionPayload).toHaveBeenCalledTimes(1);
  });

  it("predeploy replace hallway without sms_state still uses the clock structural path", async () => {
    const open = predeployHallway();
    const after = staged(ANGELA_NORMALIZED);
    getActiveCommitment.mockResolvedValueOnce(open).mockResolvedValueOnce(after);
    const r = await runTurn2({ commitment: open, inboundRaw: "10:30" });
    expect(r.handled).toBe(true);
    expect(r.forensics.clock_structural_used).toBe(true);
    expect(r.forensics.interpreter_invoked).toBe(false);
    expect(r.consequence).toBe("staged");
  });

  it("3: Make it 10:30 is Sol-owned; leftover AI is not invoked", async () => {
    const open = hallway();
    const after = staged(ANGELA_NORMALIZED);
    getActiveCommitment.mockResolvedValueOnce(open).mockResolvedValueOnce(after);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "saved_replace",
          candidate_behavior_statement: ANGELA_NORMALIZED,
        })
      )
    );
    const r = await runTurn2({ commitment: open, inboundRaw: "Make it 10:30" });
    expect(r.forensics.interpreter_invoked).toBe(true);
    expect(r.forensics.clock_structural_used).toBe(false);
    expect(r.forensics.leftover_candidate_ai_invoked).toBe(false);
    expect(r.forensics.parse_sms_confirmation_used).toBe(false);
    expect(r.consequence).toBe("staged");
    expect(r.authorization.candidate_behavior_statement).toBe(ANGELA_NORMALIZED);
    const input = runSolGoalChangeSemanticInterpreter.mock.calls[0]?.[0]?.input;
    expect(input.authoritative_pending).toMatchObject({
      kind: "commitment_replace",
      sms_state: "awaiting_candidate",
      candidate_behavior_statement: null,
      source: "sms_inbound",
    });
    expect(input.latest_inbound_text).toBe("Make it 10:30");
  });

  it("4: uncertain clock sentence does not auto-stage from the clock helper", async () => {
    const open = hallway();
    getActiveCommitment.mockResolvedValue(open);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "possible_saved_replace",
          candidate_behavior_statement: null,
          needs_clarification: true,
        })
      )
    );
    const r = await runTurn2({
      commitment: open,
      inboundRaw: "Maybe 10:30 would be better, but I'm not sure",
    });
    expect(r.forensics.clock_structural_used).toBe(false);
    expect(r.forensics.interpreter_invoked).toBe(true);
    expect(r.consequence).toBe("stay_hallway");
    expect(r.authorization.pending_state).toBe("awaiting_candidate");
    expect(r.authorization.goal_change_confirmation_authorized).toBe(false);
    expect(mergeSmsPendingResolutionPayload).not.toHaveBeenCalled();
  });

  it("5: Sol full workout candidate stages awaiting_confirmation", async () => {
    const open = hallway(commitment({ behavior_statement: WORKOUT_CANONICAL }));
    const after = staged(WORKOUT_FOUR, commitment({ behavior_statement: WORKOUT_CANONICAL }));
    getActiveCommitment.mockResolvedValueOnce(open).mockResolvedValueOnce(after);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "saved_replace",
          candidate_behavior_statement: WORKOUT_FOUR,
        })
      )
    );
    const r = await runTurn2({
      commitment: open,
      inboundRaw: "I want to work out four days per week.",
    });
    expect(r.consequence).toBe("staged");
    expect(r.authorization.candidate_behavior_statement).toBe(WORKOUT_FOUR);
    expect(r.authorization.goal_change_apply_authorized).toBe(false);
  });

  it("6: raw Four days per week fails closed even if Sol returns the fragment", async () => {
    const open = hallway(commitment({ behavior_statement: WORKOUT_CANONICAL }));
    getActiveCommitment.mockResolvedValue(open);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "saved_replace",
          candidate_behavior_statement: "Four days per week",
        })
      )
    );
    const r = await runTurn2({ commitment: open, inboundRaw: "Four days per week" });
    expect(r.consequence).toBe("stay_hallway");
    expect(r.forensics.candidate_complete).toBe(false);
    expect(r.forensics.skip_reason).toBe("incomplete_replacement_fragment");
    expect(mergeSmsPendingResolutionPayload).not.toHaveBeenCalled();
  });

  it("7: Monday through Thursday is not reconstructed into a canonical bar", async () => {
    const open = hallway(commitment({ behavior_statement: WORKOUT_CANONICAL }));
    getActiveCommitment.mockResolvedValue(open);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "saved_replace",
          candidate_behavior_statement: "Monday through Thursday",
        })
      )
    );
    const r = await runTurn2({ commitment: open, inboundRaw: "Monday through Thursday" });
    expect(r.consequence).toBe("stay_hallway");
    expect(r.forensics.skip_reason).toBe("incomplete_replacement_fragment");
  });

  it("8: No alcohol Monday through Thursday is Sol-owned meaning", async () => {
    const alcohol = "No alcohol Monday through Thursday.";
    const open = hallway(
      commitment({ behavior_statement: "I will not drink alcohol on weeknights." })
    );
    const after = staged(
      alcohol,
      commitment({ behavior_statement: "I will not drink alcohol on weeknights." })
    );
    getActiveCommitment.mockResolvedValueOnce(open).mockResolvedValueOnce(after);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "saved_replace",
          candidate_behavior_statement: alcohol,
        })
      )
    );
    const r = await runTurn2({
      commitment: open,
      inboundRaw: "No alcohol Monday through Thursday",
    });
    expect(r.forensics.interpreter_invoked).toBe(true);
    expect(r.consequence).toBe("staged");
    expect(r.authorization.candidate_behavior_statement).toBe(alcohol);
  });

  it.each(["Never mind", "Forget it", "Keep the old goal", "Actually I don't want to change it"])(
    "9–12: Sol reject clears pending for %s — leftover regex is not the authority",
    async (inbound) => {
      const open = hallway();
      getActiveCommitment.mockResolvedValueOnce(open).mockResolvedValueOnce(commitment());
      runSolGoalChangeSemanticInterpreter.mockResolvedValue(
        interpreterOk(
          semantic({
            intent: "none",
            rejects_existing_pending: true,
            candidate_behavior_statement: null,
          })
        )
      );
      const r = await runTurn2({ commitment: open, inboundRaw: inbound });
      expect(r.forensics.interpreter_invoked).toBe(true);
      expect(r.consequence).toBe("rejected");
      expect(r.authorization.pending_cleared).toBe(true);
      expect(r.authorization.goal_change_apply_authorized).toBe(false);
      expect(clearPendingResolution).toHaveBeenCalledTimes(1);
      expect(mergeSmsPendingResolutionPayload).not.toHaveBeenCalled();
    }
  );

  it.each(["Something easier", "I don't know yet", "I had a great workout today"])(
    "13–15: unclear / unrelated does not fabricate a candidate: %s",
    async (inbound) => {
      const open = hallway();
      getActiveCommitment.mockResolvedValue(open);
      runSolGoalChangeSemanticInterpreter.mockResolvedValue(
        interpreterOk(
          semantic({
            intent: inbound.includes("workout") ? "none" : "possible_saved_replace",
            needs_clarification: !inbound.includes("workout"),
            candidate_behavior_statement: null,
          })
        )
      );
      const r = await runTurn2({ commitment: open, inboundRaw: inbound });
      expect(r.consequence).toBe("stay_hallway");
      expect(r.authorization.pending_state).toBe("awaiting_candidate");
      expect(mergeSmsPendingResolutionPayload).not.toHaveBeenCalled();
    }
  );

  it("16: No after elicitation is Sol-interpreted, not protocol reject", async () => {
    const open = hallway();
    getActiveCommitment.mockResolvedValue(open);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "none",
          rejects_existing_pending: false,
          candidate_behavior_statement: null,
        })
      )
    );
    const r = await runTurn2({ commitment: open, inboundRaw: "No" });
    expect(r.forensics.parse_sms_confirmation_used).toBe(false);
    expect(r.consequence).toBe("stay_hallway");
    expect(clearPendingResolution).not.toHaveBeenCalled();
  });

  it("17: Yes after elicitation is not confirmation protocol", async () => {
    const open = hallway();
    getActiveCommitment.mockResolvedValue(open);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "none",
          confirms_existing_pending: true,
          candidate_behavior_statement: null,
        })
      )
    );
    const r = await runTurn2({ commitment: open, inboundRaw: "Yes" });
    expect(r.consequence).toBe("stay_hallway");
    expect(r.authorization.pending_state).toBe("awaiting_candidate");
    expect(r.authorization.goal_change_confirmation_authorized).toBe(false);
    const confirm = await runSolGoalChangePendingConfirmForInbound({
      clerkUserId: open.clerk_user_id,
      commitment: open,
      inboundRaw: "Yes",
      messageSid: "SMturn2",
    });
    expect(confirm.handled).toBe(false);
  });

  it("tighten pending is not Sol-owned Turn 2", async () => {
    const tighten = withPending(
      commitment(),
      {
        source: "sms_inbound",
        sms_state: "awaiting_candidate",
        detected_intent: "sms_tighten_request",
        raw_user_text: "make it easier this week",
        inbound_message_sid: "SMtighten",
        ai_confidence: null,
      },
      "commitment_tighten"
    );
    getActiveCommitment.mockResolvedValue(tighten);
    const r = await runTurn2({ commitment: tighten, inboundRaw: "10:30." });
    expect(r.handled).toBe(false);
    expect(r.consequence).toBe("not_applicable");
    expect(runSolGoalChangeSemanticInterpreter).not.toHaveBeenCalled();
  });

  it("interpreter failure still owns the turn so leftover cannot take over", async () => {
    const open = hallway();
    getActiveCommitment.mockResolvedValue(open);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue({
      ok: false,
      result: null,
      error: "openai_unavailable",
      capture: { retry_occurred: false },
    });
    const r = await runTurn2({ commitment: open, inboundRaw: "Make it 10:30" });
    expect(r.handled).toBe(true);
    expect(r.consequence).toBe("stay_hallway");
    expect(r.authorization.pending_state).toBe("awaiting_candidate");
  });
});

describe("runtime-ish two-turn bedtime", () => {
  beforeEach(() => {
    getActiveCommitment.mockReset();
    recomputeV2CoachingMemory.mockReset();
    applyWave4SmsCommitmentPendingResolution.mockReset();
    bootstrapSmsPendingConfirmationFromInbound.mockReset();
    runSolGoalChangeSemanticInterpreter.mockReset();
    mergeSmsPendingResolutionPayload.mockReset();
    mergeSmsPendingResolutionPayload.mockResolvedValue({ ok: true });
    recomputeV2CoachingMemory.mockResolvedValue(undefined);
    applyWave4SmsCommitmentPendingResolution.mockResolvedValue({
      pendingApplied: true,
      skipReason: null,
    });
    bootstrapSmsPendingConfirmationFromInbound.mockResolvedValue({
      promoted: false,
      candidate: null,
      skipReason: "sol_owned_awaiting_candidate_shell",
    });
  });

  it("no pending → I want to change my goal. → 10:30. → full canonical awaiting_confirmation", async () => {
    const base = commitment();
    const open = hallway(base);
    const afterClock = staged(ANGELA_NORMALIZED, base);

    getActiveCommitment
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(open)
      .mockResolvedValueOnce(open)
      .mockResolvedValueOnce(open)
      .mockResolvedValueOnce(afterClock);

    runSolGoalChangeSemanticInterpreter.mockResolvedValueOnce(
      interpreterOk(
        semantic({
          intent: "possible_saved_replace",
          candidate_behavior_statement: null,
          needs_clarification: true,
        })
      )
    );

    const turn1 = await runSolGoalChangePendingOpenForInbound({
      clerkUserId: base.clerk_user_id,
      commitment: base,
      inboundRaw: "I want to change my goal.",
      messageSid: "SMturn1",
      plannedInterruptionKnown: false,
    });
    expect(turn1.forensics.hallway_opened).toBe(true);
    expect(turn1.authorization.pending_state).toBe("awaiting_candidate");
    expect(turn1.authorization.goal_change_confirmation_authorized).toBe(false);

    const turn2 = await runSolGoalChangeAwaitingCandidateForInbound({
      clerkUserId: base.clerk_user_id,
      commitment: open,
      inboundRaw: "10:30.",
      messageSid: "SMturn2",
    });
    expect(turn2.handled).toBe(true);
    expect(turn2.forensics.clock_structural_used).toBe(true);
    expect(turn2.forensics.interpreter_invoked).toBe(false);
    expect(turn2.consequence).toBe("staged");
    expect(turn2.authorization.pending_state).toBe("awaiting_confirmation");
    expect(turn2.authorization.candidate_behavior_statement).toBe(ANGELA_NORMALIZED);
    expect(turn2.authorization.goal_change_confirmation_authorized).toBe(true);
    expect(turn2.authorization.goal_change_apply_authorized).toBe(false);
    expect(runSolGoalChangeSemanticInterpreter).toHaveBeenCalledTimes(1);
  });
});
