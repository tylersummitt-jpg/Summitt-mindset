import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  emptySolGoalChangeSemanticResult,
  SOL_GOAL_CHANGE_SEMANTIC_VERSION,
} from "@/lib/sol-goal-change-semantic";
import type { SolGoalChangeSemanticResult } from "@/lib/sol-goal-change-semantic";
import type { SmsGoalSeasonMutationResult } from "@/lib/v2-sms-goal-season-mutation";

const getActiveCommitment = vi.hoisted(() => vi.fn());
const recomputeV2CoachingMemory = vi.hoisted(() => vi.fn());
const runSolGoalChangeSemanticInterpreter = vi.hoisted(() => vi.fn());
const applyCanonicalGoalChangeWithSeasonMutation = vi.hoisted(() => vi.fn());
const clearPendingResolution = vi.hoisted(() => vi.fn());
const mergeSmsPendingResolutionPayload = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/v2-commitment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-commitment")>();
  return { ...actual, getActiveCommitment };
});

vi.mock("@/lib/v2-coaching-memory", () => ({
  recomputeV2CoachingMemory,
}));

vi.mock("@/lib/sol-goal-change-semantic-interpreter", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/sol-goal-change-semantic-interpreter")>();
  return { ...actual, runSolGoalChangeSemanticInterpreter };
});

vi.mock("@/lib/v2-apply-canonical-goal-change", () => ({
  applyCanonicalGoalChangeWithSeasonMutation,
}));

vi.mock("@/lib/v2-guided-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-guided-resolution")>();
  return { ...actual, clearPendingResolution, mergeSmsPendingResolutionPayload };
});

const refreshUnsentTtoDraftsAfterRelationshipChange = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, clerkUserId: "user_angela", outcomes: [] })
);
vi.mock("@/lib/sol-goal-change-tto-draft-refresh", () => ({
  refreshUnsentTtoDraftsAfterRelationshipChange,
}));

import {
  isDeterministicPendingReject,
  isExactPendingProtocolNo,
  isExactPendingProtocolYes,
  isSafeDeterministicPendingYesFallback,
  liveReplaceConfirmationCandidate,
  provePostMutationGoalChangeReload,
  resolveModifiedPendingCandidate,
  resolveSolGoalChangePendingConfirmMeaning,
  runSolGoalChangePendingConfirmForInbound,
} from "@/lib/sol-goal-change-pending-confirm";

const ANGELA_CANONICAL = "I will be in bed by 9:30 pm nightly.";
const ANGELA_PENDING = "I will be in bed by 10:30 pm nightly.";
const ANGELA_1015 = "I will be in bed by 10:15 pm nightly.";

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

function angelaPending(): ActiveV2CommitmentRow {
  return withPending(commitment(), {
    source: "sms_inbound",
    sms_state: "awaiting_confirmation",
    detected_intent: "sms_replace_request",
    raw_user_text: "revise to 10:30",
    inbound_message_sid: "SMturn1",
    ai_confidence: null,
    candidate_behavior_statement: ANGELA_PENDING,
    candidate_new_bar: ANGELA_PENDING,
  });
}

const OVERLAY_FROM = "2026-09-07T16:00:00.000Z";
const OVERLAY_EXPIRES = "2026-09-14T04:00:00.000Z";

function angelaPendingWithLiveOverlay(): ActiveV2CommitmentRow {
  return withPending(
    commitment({
      adaptive_ask_text: ANGELA_PENDING,
      adaptive_ask_active_from: OVERLAY_FROM,
      adaptive_ask_expires_at: OVERLAY_EXPIRES,
    }),
    {
      source: "sms_inbound",
      sms_state: "awaiting_confirmation",
      detected_intent: "sms_replace_request",
      raw_user_text: "Make this permanent.",
      inbound_message_sid: "SMturn1",
      ai_confidence: null,
      candidate_behavior_statement: ANGELA_PENDING,
      candidate_new_bar: ANGELA_PENDING,
    }
  );
}

function angelaApplied(): ActiveV2CommitmentRow {
  return commitment({
    id: "cmt_angela_2",
    behavior_statement: ANGELA_PENDING,
    pending_resolution_kind: null,
    pending_resolution_created_at: null,
    pending_resolution_expires_at: null,
    pending_resolution_payload: null,
    updated_at: "2026-09-07T12:05:00.000Z",
  });
}

function semantic(
  overrides: Partial<SolGoalChangeSemanticResult["goal_change"]> = {}
): SolGoalChangeSemanticResult {
  return {
    version: SOL_GOAL_CHANGE_SEMANTIC_VERSION,
    goal_change: {
      ...emptySolGoalChangeSemanticResult().goal_change,
      intent: "none",
      candidate_behavior_statement: ANGELA_PENDING,
      needs_clarification: false,
      requires_confirmation: false,
      confirms_existing_pending: false,
      rejects_existing_pending: false,
      modifies_existing_pending_candidate: false,
      member_meaning_summary: "",
      ...overrides,
    },
    concurrent_meaning: {
      planned_interruption: false,
      accountability_update: false,
    },
  };
}

function interpreterOk(result: SolGoalChangeSemanticResult) {
  return { ok: true as const, result, error: null, capture: { retry_occurred: false } };
}

function interpreterFail() {
  return {
    ok: false as const,
    result: null,
    error: "openai_unavailable",
    capture: { retry_occurred: false },
  };
}

function rpcApplied(): SmsGoalSeasonMutationResult {
  return {
    ok: true,
    rpcResult: "applied",
    seasonMode: "new_chapter",
    commitmentReplaceApplied: true,
    oldCommitmentId: "cmt_angela",
    newCommitmentId: "cmt_angela_2",
    seasonTransitionApplied: true,
    seasonTransitionAction: "new_chapter",
    oldSeasonId: "szn_old",
    newSeasonId: "szn_new",
    oldSeasonName: "Chapter 1",
    newSeasonName: "Chapter 2",
    sameSeasonGoalSnapshotSynced: false,
    idempotentReplay: false,
    warningCode: null,
  };
}

describe("Slice 3 confirmation meaning helpers", () => {
  it("Sol-down confirm fallback is exact protocol Yes/Y only, not synonyms", () => {
    expect(isExactPendingProtocolYes("Yes")).toBe(true);
    expect(isExactPendingProtocolYes("yes")).toBe(true);
    expect(isExactPendingProtocolYes("Y")).toBe(true);
    expect(isExactPendingProtocolYes("Yes!")).toBe(true);
    expect(isExactPendingProtocolYes("Yep")).toBe(false);
    expect(isExactPendingProtocolYes("Yeah")).toBe(false);
    expect(isExactPendingProtocolYes("Yup")).toBe(false);
    expect(isExactPendingProtocolYes("Sounds good")).toBe(false);
    expect(isExactPendingProtocolYes("Okay")).toBe(false);
    expect(isExactPendingProtocolYes("I agree")).toBe(false);
    expect(isExactPendingProtocolYes("Absolutely")).toBe(false);
    expect(isExactPendingProtocolYes("Perfect")).toBe(false);
    expect(isExactPendingProtocolYes("Let's do it")).toBe(false);
    expect(isExactPendingProtocolYes("Yes, but make it 10:15")).toBe(false);
    expect(isExactPendingProtocolYes("Maybe")).toBe(false);
    expect(isSafeDeterministicPendingYesFallback("Yes")).toBe(true);
    expect(isSafeDeterministicPendingYesFallback("Sounds good")).toBe(false);
  });

  it("Sol-down reject fallback is exact protocol No/N only, not keep/never-mind English", () => {
    expect(isExactPendingProtocolNo("No")).toBe(true);
    expect(isExactPendingProtocolNo("n")).toBe(true);
    expect(isExactPendingProtocolNo("No.")).toBe(true);
    expect(isExactPendingProtocolNo("Keep 9:30")).toBe(false);
    expect(isExactPendingProtocolNo("Never mind")).toBe(false);
    expect(isExactPendingProtocolNo("Leave it alone")).toBe(false);
    expect(isExactPendingProtocolNo("I changed my mind")).toBe(false);
    expect(isExactPendingProtocolNo("Nope")).toBe(false);
    expect(isDeterministicPendingReject("No")).toBe(true);
    expect(isDeterministicPendingReject("Keep 9:30")).toBe(false);
  });

  it("never treats a 10:15 modification as the old 10:30 candidate", () => {
    const next = resolveModifiedPendingCandidate({
      inboundRaw: "Yes, but make it 10:15",
      canonicalBehaviorStatement: ANGELA_CANONICAL,
      currentCandidate: ANGELA_PENDING,
      semanticCandidate: "10:15",
    });
    expect(next).toBe(ANGELA_1015);
    expect(next).not.toBe(ANGELA_PENDING);
  });

  it("does not restage a raw frequency crumb as the confirmable candidate", () => {
    const next = resolveModifiedPendingCandidate({
      inboundRaw: "Four days per week",
      canonicalBehaviorStatement: "I will work out five days per week.",
      currentCandidate: ANGELA_PENDING,
      semanticCandidate: "Four days per week",
    });
    expect(next).toBeNull();
  });

  it("does not restage a raw weekday crumb as the confirmable candidate", () => {
    const next = resolveModifiedPendingCandidate({
      inboundRaw: "Let's change it to Monday through Thursday going forward",
      canonicalBehaviorStatement: "I will work out five days per week.",
      currentCandidate: "I will work out five days per week.",
      semanticCandidate: "Monday through Thursday",
    });
    expect(next).toBeNull();
  });

  it("can restage a complete replacement sentence", () => {
    const next = resolveModifiedPendingCandidate({
      inboundRaw: "I will work out four days per week.",
      canonicalBehaviorStatement: "I will work out five days per week.",
      currentCandidate: ANGELA_PENDING,
      semanticCandidate: "I will work out four days per week.",
    });
    expect(next).toBe("I will work out four days per week.");
  });

  it("F: Sol complete MODIFY candidate wins even when inbound contains a clock", () => {
    const solCandidate = "I will be in bed by 10:15 pm on weekdays.";
    const next = resolveModifiedPendingCandidate({
      inboundRaw: "Yes, but make it 10:15 on weekdays",
      canonicalBehaviorStatement: ANGELA_CANONICAL,
      currentCandidate: ANGELA_PENDING,
      semanticCandidate: solCandidate,
    });
    expect(next).toBe(solCandidate);
    expect(next).not.toBe(ANGELA_1015);
  });

  it("G: Sol additional constraints are preserved and not clock-stripped", () => {
    const solCandidate =
      "I will be in bed by 10:15 pm on weekdays but later on weekends.";
    const next = resolveModifiedPendingCandidate({
      inboundRaw: "Actually 10:15 makes more sense because weekdays are brutal",
      canonicalBehaviorStatement: ANGELA_CANONICAL,
      currentCandidate: ANGELA_PENDING,
      semanticCandidate: solCandidate,
    });
    expect(next).toBe(solCandidate);
    expect(next).toContain("weekdays");
    expect(next).toContain("weekends");
  });

  it("qualification vetoes clean confirm even if Sol said confirms", () => {
    const r = resolveSolGoalChangePendingConfirmMeaning({
      inboundRaw: "Yes, but make it 10:15",
      semantic: semantic({ confirms_existing_pending: true }),
      interpreterOk: true,
    });
    expect(r.meaning).toBe("modify");
    expect(r.qualificationVeto).toBe(true);
  });

  it("Sol reject beats actually qualification and clears meaning to reject", () => {
    const r = resolveSolGoalChangePendingConfirmMeaning({
      inboundRaw: "Actually keep 9:30",
      semantic: semantic({ rejects_existing_pending: true }),
      interpreterOk: true,
    });
    expect(r.qualificationVeto).toBe(true);
    expect(r.meaning).toBe("reject");
  });

  it("qualification on Actually yes does not auto-reject when Sol confirms", () => {
    const r = resolveSolGoalChangePendingConfirmMeaning({
      inboundRaw: "Actually yes, 10:30 is right",
      semantic: semantic({ confirms_existing_pending: true }),
      interpreterOk: true,
    });
    expect(r.qualificationVeto).toBe(true);
    expect(r.meaning).not.toBe("reject");
    expect(r.meaning).not.toBe("confirm");
    expect(r.meaning).toBe("modify");
  });

  it("Sol-down never classifies modification from English", () => {
    for (const inbound of [
      "Yes, but 10:15",
      "10:15 instead",
      "Actually make it 10:15",
      "Weekdays only",
      "Yes, weekdays only",
    ]) {
      const r = resolveSolGoalChangePendingConfirmMeaning({
        inboundRaw: inbound,
        semantic: null,
        interpreterOk: false,
      });
      expect(r.meaning).toBe("ambiguous");
    }
  });
});

describe("runSolGoalChangePendingConfirmForInbound", () => {
  let live: ActiveV2CommitmentRow;

  beforeEach(() => {
    vi.clearAllMocks();
    live = angelaPending();
    getActiveCommitment.mockImplementation(async () => live);
    recomputeV2CoachingMemory.mockResolvedValue(undefined);
    mergeSmsPendingResolutionPayload.mockImplementation(
      async (args: { merge: (prev: Record<string, unknown>) => Record<string, unknown> }) => {
        const prev = (live.pending_resolution_payload ?? {}) as Record<string, unknown>;
        live = {
          ...live,
          pending_resolution_payload: args.merge(prev),
          updated_at: "2026-09-07T12:01:00.000Z",
        };
        return { ok: true, updatedAt: live.updated_at };
      }
    );
    clearPendingResolution.mockImplementation(async () => {
      live = commitment({
        ...live,
        pending_resolution_kind: null,
        pending_resolution_created_at: null,
        pending_resolution_expires_at: null,
        pending_resolution_payload: null,
        updated_at: "2026-09-07T12:01:00.000Z",
      });
      return live.updated_at;
    });
    applyCanonicalGoalChangeWithSeasonMutation.mockImplementation(async () => {
      live = angelaApplied();
      return rpcApplied();
    });
    refreshUnsentTtoDraftsAfterRelationshipChange.mockResolvedValue({
      ok: true,
      clerkUserId: "user_angela",
      outcomes: [],
    });
  });

  async function run(inboundRaw: string, messageSid = "SMturn2") {
    return runSolGoalChangePendingConfirmForInbound({
      clerkUserId: "user_angela",
      commitment: live,
      inboundRaw,
      messageSid,
    });
  }

  it("P Angela Turn 2 canary: Yes applies 10:30, reload proves, apply authorized", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          confirms_existing_pending: true,
          candidate_behavior_statement: ANGELA_PENDING,
          member_meaning_summary: "Confirm 10:30 nightly",
        })
      )
    );

    const r = await run("Yes");

    expect(liveReplaceConfirmationCandidate(angelaPending())).toBe(ANGELA_PENDING);
    expect(applyCanonicalGoalChangeWithSeasonMutation).toHaveBeenCalledTimes(1);
    const applyArgs = applyCanonicalGoalChangeWithSeasonMutation.mock.calls[0]![0] as {
      behaviorStatement: string;
      seasonMode: string;
      memoryReasonCode: string;
      idempotencyKey: string;
    };
    expect(applyArgs.behaviorStatement).toBe(ANGELA_PENDING);
    expect(applyArgs.seasonMode).toBe("new_chapter");
    expect(applyArgs.memoryReasonCode).toBe("sms_pending_resolution_replace");
    expect(applyArgs.idempotencyKey).toBe("SMturn2");
    expect(r.handled).toBe(true);
    expect(r.consequence).toBe("applied");
    expect(r.authorization.goal_change_apply_authorized).toBe(true);
    expect(r.authorization.goal_change_confirmation_authorized).toBe(false);
    expect(r.authorization.canonical_behavior_statement).toBe(ANGELA_PENDING);
    expect(r.authorization.previous_behavior_statement).toBe(ANGELA_CANONICAL);
    expect(r.authorization.previous_commitment_id).toBe("cmt_angela");
    expect(r.authorization.active_commitment_id).toBe("cmt_angela_2");
    expect(r.authorization.pending_cleared).toBe(true);
    expect(r.commitment.id).toBe("cmt_angela_2");
    expect(r.commitment.behavior_statement).toBe(ANGELA_PENDING);
    expect(r.forensics.reload_proved).toBe(true);
    expect(r.forensics.rpc_ok).toBe(true);
    expect(refreshUnsentTtoDraftsAfterRelationshipChange).toHaveBeenCalledTimes(1);
    expect(refreshUnsentTtoDraftsAfterRelationshipChange).toHaveBeenCalledWith({
      clerkUserId: "user_angela",
    });
  });

  it("2: pending + Absolutely applies when Sol confirms", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const r = await run("Absolutely");
    expect(r.consequence).toBe("applied");
    expect(applyCanonicalGoalChangeWithSeasonMutation).toHaveBeenCalledTimes(1);
  });

  it("3: pending + Sounds good applies when Sol confirms", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const r = await run("Sounds good");
    expect(r.consequence).toBe("applied");
    expect(r.authorization.goal_change_apply_authorized).toBe(true);
  });

  it("4: Yes, but make it 10:15 does not apply 10:30", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          confirms_existing_pending: false,
          modifies_existing_pending_candidate: true,
          candidate_behavior_statement: "10:15",
        })
      )
    );
    const r = await run("Yes, but make it 10:15");
    expect(applyCanonicalGoalChangeWithSeasonMutation).not.toHaveBeenCalled();
    expect(r.consequence).toBe("modified");
    expect(r.authorization.goal_change_apply_authorized).toBe(false);
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
    expect(r.authorization.candidate_behavior_statement).toBe(ANGELA_1015);
  });

  it("5: 10:15 instead does not apply 10:30", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          modifies_existing_pending_candidate: true,
          candidate_behavior_statement: "10:15",
        })
      )
    );
    const r = await run("10:15 instead");
    expect(applyCanonicalGoalChangeWithSeasonMutation).not.toHaveBeenCalled();
    expect(r.consequence).toBe("modified");
    expect(r.authorization.candidate_behavior_statement).toBe(ANGELA_1015);
  });

  it("F: modify restages Sol's full candidate, not an inbound clock extract", async () => {
    const solCandidate = "I will be in bed by 10:15 pm on weekdays.";
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          modifies_existing_pending_candidate: true,
          candidate_behavior_statement: solCandidate,
        })
      )
    );
    const r = await run("Yes, but make it 10:15 on weekdays");
    expect(applyCanonicalGoalChangeWithSeasonMutation).not.toHaveBeenCalled();
    expect(r.consequence).toBe("modified");
    expect(r.authorization.candidate_behavior_statement).toBe(solCandidate);
    expect(r.authorization.candidate_behavior_statement).not.toBe(ANGELA_1015);
  });

  it("G: modify preserves Sol constraints beyond a clock", async () => {
    const solCandidate =
      "I will be in bed by 10:15 pm on weekdays but later on weekends.";
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          modifies_existing_pending_candidate: true,
          candidate_behavior_statement: solCandidate,
        })
      )
    );
    const r = await run("Actually 10:15 makes more sense because weekdays are brutal");
    expect(r.consequence).toBe("modified");
    expect(r.authorization.candidate_behavior_statement).toBe(solCandidate);
  });

  it("6: No does not apply and clears pending", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ rejects_existing_pending: true }))
    );
    const r = await run("No");
    expect(applyCanonicalGoalChangeWithSeasonMutation).not.toHaveBeenCalled();
    expect(r.consequence).toBe("rejected");
    expect(r.authorization.goal_change_apply_authorized).toBe(false);
    expect(r.authorization.canonical_behavior_statement).toBe(ANGELA_CANONICAL);
    expect(r.authorization.pending_cleared).toBe(true);
    expect(clearPendingResolution).toHaveBeenCalled();
  });

  it("7: Keep 9:30 rejects when Sol classifies reject", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ rejects_existing_pending: true }))
    );
    const r = await run("Keep 9:30");
    expect(applyCanonicalGoalChangeWithSeasonMutation).not.toHaveBeenCalled();
    expect(r.consequence).toBe("rejected");
  });

  it("7b: Never mind rejects when Sol classifies reject", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ rejects_existing_pending: true }))
    );
    const r = await run("Never mind");
    expect(applyCanonicalGoalChangeWithSeasonMutation).not.toHaveBeenCalled();
    expect(r.consequence).toBe("rejected");
    expect(clearPendingResolution).toHaveBeenCalled();
  });

  it("7c: Actually keep 9:30 rejects even though qualification sees actually", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ rejects_existing_pending: true }))
    );
    const r = await run("Actually keep 9:30");
    expect(applyCanonicalGoalChangeWithSeasonMutation).not.toHaveBeenCalled();
    expect(r.consequence).toBe("rejected");
    expect(r.forensics.qualification_veto).toBe(true);
    expect(r.authorization.pending_cleared).toBe(true);
    expect(clearPendingResolution).toHaveBeenCalled();
  });

  it("7d: I changed my mind rejects when Sol classifies reject", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ rejects_existing_pending: true }))
    );
    const r = await run("I changed my mind");
    expect(applyCanonicalGoalChangeWithSeasonMutation).not.toHaveBeenCalled();
    expect(r.consequence).toBe("rejected");
    expect(clearPendingResolution).toHaveBeenCalled();
  });

  it("8: Maybe does not apply", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(interpreterOk(semantic()));
    const r = await run("Maybe");
    expect(applyCanonicalGoalChangeWithSeasonMutation).not.toHaveBeenCalled();
    expect(r.consequence).toBe("ambiguous");
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
    expect(r.authorization.goal_change_apply_authorized).toBe(false);
  });

  it("9: unrelated response does not apply", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(interpreterOk(semantic()));
    const r = await run("How was your day?");
    expect(applyCanonicalGoalChangeWithSeasonMutation).not.toHaveBeenCalled();
    expect(r.consequence).toBe("ambiguous");
  });

  it("10: interpreter fails + exact Yes uses protocol fallback apply", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(interpreterFail());
    const r = await run("Yes");
    expect(r.forensics.deterministic_yes_fallback).toBe(true);
    expect(r.consequence).toBe("applied");
    expect(applyCanonicalGoalChangeWithSeasonMutation).toHaveBeenCalledTimes(1);
  });

  it("10b: interpreter fails + exact Y uses protocol fallback apply", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(interpreterFail());
    const r = await run("Y");
    expect(r.forensics.deterministic_yes_fallback).toBe(true);
    expect(r.consequence).toBe("applied");
    expect(applyCanonicalGoalChangeWithSeasonMutation).toHaveBeenCalledTimes(1);
  });

  it("11: interpreter fails + Absolutely fail-closed, no apply", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(interpreterFail());
    const r = await run("Absolutely");
    expect(isSafeDeterministicPendingYesFallback("Absolutely")).toBe(false);
    expect(applyCanonicalGoalChangeWithSeasonMutation).not.toHaveBeenCalled();
    expect(r.consequence).toBe("ambiguous");
    expect(r.authorization.goal_change_apply_authorized).toBe(false);
  });

  describe("Sol unavailable — protocol Yes/No only, no NLP", () => {
    function expectPendingUnchangedFailClosed(
      r: Awaited<ReturnType<typeof runSolGoalChangePendingConfirmForInbound>>
    ) {
      expect(applyCanonicalGoalChangeWithSeasonMutation).not.toHaveBeenCalled();
      expect(clearPendingResolution).not.toHaveBeenCalled();
      expect(mergeSmsPendingResolutionPayload).not.toHaveBeenCalled();
      expect(r.handled).toBe(true);
      expect(r.consequence).toBe("ambiguous");
      expect(r.authorization.goal_change_apply_authorized).toBe(false);
      expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
      expect(r.authorization.candidate_behavior_statement).toBe(ANGELA_PENDING);
      expect(r.authorization.pending_cleared).toBe(false);
      expect(liveReplaceConfirmationCandidate(r.commitment)).toBe(ANGELA_PENDING);
      expect(r.commitment.behavior_statement).toBe(ANGELA_CANONICAL);
    }

    beforeEach(() => {
      runSolGoalChangeSemanticInterpreter.mockResolvedValue(interpreterFail());
    });

    it.each(["Yep", "Yeah", "Sounds good", "Okay", "I agree", "Absolutely", "Perfect", "Let's do it"])(
      "must not apply synonym confirm %s",
      async (inbound) => {
        const r = await run(inbound);
        expectPendingUnchangedFailClosed(r);
      }
    );

    it("11-sol-down: No may reject/clear", async () => {
      const r = await run("No");
      expect(applyCanonicalGoalChangeWithSeasonMutation).not.toHaveBeenCalled();
      expect(r.consequence).toBe("rejected");
      expect(clearPendingResolution).toHaveBeenCalled();
      expect(r.authorization.pending_cleared).toBe(true);
      expect(r.authorization.canonical_behavior_statement).toBe(ANGELA_CANONICAL);
    });

    it("12-sol-down: N may reject/clear", async () => {
      const r = await run("N");
      expect(applyCanonicalGoalChangeWithSeasonMutation).not.toHaveBeenCalled();
      expect(r.consequence).toBe("rejected");
      expect(clearPendingResolution).toHaveBeenCalled();
    });

    it.each(["Keep 9:30", "Never mind", "Leave it alone", "I changed my mind"])(
      "must not deterministically reject %s",
      async (inbound) => {
        const r = await run(inbound);
        expectPendingUnchangedFailClosed(r);
      }
    );

    it.each([
      "Yes, but 10:15",
      "10:15 instead",
      "Actually make it 10:15",
      "Weekdays only",
      "Yes, weekdays only",
    ])("must not restage or apply from %s", async (inbound) => {
      const r = await run(inbound);
      expectPendingUnchangedFailClosed(r);
      expect(r.authorization.candidate_behavior_statement).not.toContain("10:15");
    });
  });

  it("12: RPC throw → no applied claim", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    applyCanonicalGoalChangeWithSeasonMutation.mockRejectedValue(new Error("rpc down"));
    const r = await run("Yes");
    expect(r.consequence).toBe("rpc_failed");
    expect(r.authorization.goal_change_apply_authorized).toBe(false);
  });

  it("13: RPC returns failure → no applied claim", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    applyCanonicalGoalChangeWithSeasonMutation.mockResolvedValue({
      ok: false,
      code: "stale_commitment",
    });
    const r = await run("Yes");
    expect(r.consequence).toBe("rpc_failed");
    expect(r.authorization.goal_change_apply_authorized).toBe(false);
  });

  it("14: RPC success + reload still old goal → no applied claim", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    applyCanonicalGoalChangeWithSeasonMutation.mockResolvedValue(rpcApplied());
    const r = await run("Yes");
    expect(r.consequence).toBe("reload_mismatch");
    expect(r.authorization.goal_change_apply_authorized).toBe(false);
    expect(r.commitment.behavior_statement).toBe(ANGELA_CANONICAL);
  });

  it("15: RPC success + reload candidate mismatch → no applied claim", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    applyCanonicalGoalChangeWithSeasonMutation.mockImplementation(async () => {
      live = commitment({
        id: "cmt_angela_2",
        behavior_statement: "I will be in bed by 11:00 pm nightly.",
      });
      return rpcApplied();
    });
    const r = await run("Yes");
    expect(r.consequence).toBe("reload_mismatch");
    expect(r.authorization.goal_change_apply_authorized).toBe(false);
  });

  it("18: duplicate Yes after apply does not open a second chapter", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const first = await run("Yes", "SMfirst");
    expect(first.consequence).toBe("applied");
    expect(applyCanonicalGoalChangeWithSeasonMutation).toHaveBeenCalledTimes(1);

    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const second = await run("Yes", "SMsecond");
    expect(second.handled).toBe(false);
    expect(second.consequence).toBe("not_applicable");
    expect(applyCanonicalGoalChangeWithSeasonMutation).toHaveBeenCalledTimes(1);
    expect(second.authorization.goal_change_apply_authorized).toBe(false);
  });

  it("C: saved confirmation NO over live overlay leaves overlay untouched", async () => {
    live = angelaPendingWithLiveOverlay();
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ rejects_existing_pending: true }))
    );
    const r = await run("No");
    expect(applyCanonicalGoalChangeWithSeasonMutation).not.toHaveBeenCalled();
    expect(r.consequence).toBe("rejected");
    expect(live.adaptive_ask_text).toBe(ANGELA_PENDING);
    expect(live.adaptive_ask_active_from).toBe(OVERLAY_FROM);
    expect(live.adaptive_ask_expires_at).toBe(OVERLAY_EXPIRES);
    expect(live.behavior_statement).toBe(ANGELA_CANONICAL);
    expect(live.id).toBe("cmt_angela");
    expect(live.pending_resolution_kind).toBeNull();
  });

  it("D: saved confirmation MODIFY over live overlay restages candidate and leaves overlay", async () => {
    live = angelaPendingWithLiveOverlay();
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          modifies_existing_pending_candidate: true,
          candidate_behavior_statement: "10:15",
        })
      )
    );
    const r = await run("Yes, but make it 10:15");
    expect(applyCanonicalGoalChangeWithSeasonMutation).not.toHaveBeenCalled();
    expect(r.consequence).toBe("modified");
    expect(r.authorization.candidate_behavior_statement).toBe(ANGELA_1015);
    expect(live.adaptive_ask_text).toBe(ANGELA_PENDING);
    expect(live.adaptive_ask_active_from).toBe(OVERLAY_FROM);
    expect(live.adaptive_ask_expires_at).toBe(OVERLAY_EXPIRES);
    expect(live.behavior_statement).toBe(ANGELA_CANONICAL);
    expect(live.id).toBe("cmt_angela");
  });

  it("E: saved confirmation YES over live overlay creates a new chapter without copying overlay", async () => {
    live = angelaPendingWithLiveOverlay();
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const r = await run("Yes");
    expect(applyCanonicalGoalChangeWithSeasonMutation).toHaveBeenCalledTimes(1);
    const applyArgs = applyCanonicalGoalChangeWithSeasonMutation.mock.calls[0]![0] as {
      behaviorStatement: string;
      seasonMode: string;
    };
    expect(applyArgs.behaviorStatement).toBe(ANGELA_PENDING);
    expect(applyArgs.seasonMode).toBe("new_chapter");
    expect(r.consequence).toBe("applied");
    expect(r.commitment.id).toBe("cmt_angela_2");
    expect(r.commitment.behavior_statement).toBe(ANGELA_PENDING);
    expect(r.commitment.adaptive_ask_text).toBeNull();
    expect(r.commitment.adaptive_ask_active_from).toBeNull();
    expect(r.commitment.adaptive_ask_expires_at).toBeNull();
    const sql = fs.readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260508170000_v2_guided_commitment_replace_wrapper.sql"
      ),
      "utf8"
    );
    expect(sql).toContain("INSERT INTO v2_commitment");
    expect(sql).toContain("p_new_behavior_statement");
    expect(sql).not.toMatch(/INSERT INTO v2_commitment \([\s\S]*adaptive_ask_text/);
  });

  it("tighten pending is not owned by Slice 3", async () => {
    live = {
      ...withPending(commitment(), {
        source: "sms_inbound",
        sms_state: "awaiting_confirmation",
        detected_intent: "sms_tighten_request",
        raw_user_text: "make it smaller",
        inbound_message_sid: "SMtight",
        ai_confidence: null,
        candidate_tightened_bar: "Walk 5 minutes",
      }),
      pending_resolution_kind: "commitment_tighten",
    };
    const r = await run("Yes");
    expect(r.handled).toBe(false);
    expect(applyCanonicalGoalChangeWithSeasonMutation).not.toHaveBeenCalled();
  });

  it("G: failed Goal Change mutation does not refresh TTO drafts", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    applyCanonicalGoalChangeWithSeasonMutation.mockRejectedValue(new Error("rpc down"));
    const r = await run("Yes");
    expect(r.consequence).toBe("rpc_failed");
    expect(refreshUnsentTtoDraftsAfterRelationshipChange).not.toHaveBeenCalled();
  });

  it("I: reject does not refresh TTO drafts", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ rejects_existing_pending: true }))
    );
    const r = await run("No");
    expect(r.consequence).toBe("rejected");
    expect(refreshUnsentTtoDraftsAfterRelationshipChange).not.toHaveBeenCalled();
  });

  it("J: modify-pending does not refresh TTO drafts", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          modifies_existing_pending_candidate: true,
          candidate_behavior_statement: "10:15",
        })
      )
    );
    const r = await run("Yes, but make it 10:15");
    expect(r.consequence).toBe("modified");
    expect(refreshUnsentTtoDraftsAfterRelationshipChange).not.toHaveBeenCalled();
  });

  it("O: TTO refresh failure does not roll back a proven saved Goal Change", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    refreshUnsentTtoDraftsAfterRelationshipChange.mockRejectedValue(new Error("tto down"));
    const r = await run("Yes");
    expect(r.consequence).toBe("applied");
    expect(r.authorization.goal_change_apply_authorized).toBe(true);
    expect(r.commitment.behavior_statement).toBe(ANGELA_PENDING);
  });

  it("G: saved Goal Change stays applied when TTO refresh reports unresolved failure", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    refreshUnsentTtoDraftsAfterRelationshipChange.mockResolvedValue({
      ok: false,
      clerkUserId: "user_angela",
      reason: "stale_draft_could_not_be_disabled",
      outcomes: [],
    });
    const r = await run("Yes");
    expect(r.consequence).toBe("applied");
    expect(r.authorization.goal_change_apply_authorized).toBe(true);
    expect(r.commitment.behavior_statement).toBe(ANGELA_PENDING);
  });
});

describe("provePostMutationGoalChangeReload", () => {
  it("requires new id, matching bar, and pending gone", () => {
    const before = angelaPending();
    const after = angelaApplied();
    const ok = provePostMutationGoalChangeReload({
      before,
      after,
      expectedBehaviorStatement: ANGELA_PENDING,
      rpc: rpcApplied(),
    });
    expect(ok).toEqual({ ok: true });
  });

  it("fails when reload still shows the old bar", () => {
    const before = angelaPending();
    const r = provePostMutationGoalChangeReload({
      before,
      after: before,
      expectedBehaviorStatement: ANGELA_PENDING,
      rpc: rpcApplied(),
    });
    expect(r.ok).toBe(false);
  });
});

describe("K: modify path has no inbound clock/weekday English classifier", () => {
  const confirm = fs.readFileSync(
    path.join(process.cwd(), "src/lib/sol-goal-change-pending-confirm.ts"),
    "utf8"
  );
  const open = fs.readFileSync(
    path.join(process.cwd(), "src/lib/sol-goal-change-pending-open.ts"),
    "utf8"
  );

  it("does not extract clocks or weekdays from inbound English", () => {
    expect(confirm).not.toContain("extractSingleClockFragment");
    expect(confirm).not.toContain("CLOCK_IN_TEXT_RE");
    expect(confirm).not.toContain("tryMergeWeekdaysIntoCandidate");
    expect(confirm).not.toContain("trySubstituteClockFragmentIntoCanonical");
    expect(open).not.toContain("extractDeterministicDailyBarCandidate");
  });
});
