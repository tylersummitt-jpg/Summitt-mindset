import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  emptySolGoalChangeSemanticResult,
  SOL_GOAL_CHANGE_SEMANTIC_VERSION,
} from "@/lib/sol-goal-change-semantic";
import type { SolGoalChangeSemanticResult } from "@/lib/sol-goal-change-semantic";
import {
  applyGoalChangeMachineBodySafety,
  tryBuildAuthorizedGoalChangeWriterFailureFallback,
} from "@/lib/sol-goal-change-confirmation-guard";
import {
  getEffectiveCoachingAsk,
  isV2AdaptiveOverlayActive,
} from "@/lib/v2-adaptive-contract";

const getActiveCommitment = vi.hoisted(() => vi.fn());
const recomputeV2CoachingMemory = vi.hoisted(() => vi.fn());
const applyWave4SmsCommitmentPendingResolution = vi.hoisted(() => vi.fn());
const bootstrapSmsPendingConfirmationFromInbound = vi.hoisted(() => vi.fn());
const runSolGoalChangeSemanticInterpreter = vi.hoisted(() => vi.fn());
const mergeSmsPendingResolutionPayload = vi.hoisted(() => vi.fn());
const clearPendingResolution = vi.hoisted(() => vi.fn());
const supabaseFrom = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: supabaseFrom },
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

import { runSolGoalChangePendingOpenForInbound } from "@/lib/sol-goal-change-pending-open";
import {
  applySolActiveTemporaryOverlayRevert,
  buildAuthoritativeActiveOverlaySnapshot,
  buildTemporaryRevertedAuthorization,
  clearActiveTemporaryOverlay,
  proveTemporaryOverlayReverted,
} from "@/lib/sol-goal-change-temporary-revert";

const CANONICAL = "I will be in bed by 9:30 pm nightly.";
const OVERLAY = "I will be in bed by 10:30 pm nightly.";
const NOW = new Date("2026-09-07T16:00:00.000Z");
const EXPIRES = "2026-09-14T04:00:00.000Z";
const UPDATED = "2026-09-07T12:00:00.000Z";

function commitment(overrides: Partial<ActiveV2CommitmentRow> = {}): ActiveV2CommitmentRow {
  return {
    id: "cmt_angela",
    clerk_user_id: "user_angela",
    status: "active",
    behavior_statement: CANONICAL,
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
    updated_at: UPDATED,
    started_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function overlayRow(overrides: Partial<ActiveV2CommitmentRow> = {}): ActiveV2CommitmentRow {
  return commitment({
    adaptive_ask_text: OVERLAY,
    adaptive_ask_active_from: "2026-09-07T16:00:00.000Z",
    adaptive_ask_expires_at: EXPIRES,
    ...overrides,
  });
}

function clearedRow(from: ActiveV2CommitmentRow = overlayRow()): ActiveV2CommitmentRow {
  return {
    ...from,
    adaptive_ask_text: null,
    adaptive_ask_active_from: null,
    adaptive_ask_expires_at: null,
    updated_at: "2026-09-07T16:00:01.000Z",
  };
}

function semantic(
  overrides: Partial<SolGoalChangeSemanticResult["goal_change"]> = {}
): SolGoalChangeSemanticResult {
  return {
    version: SOL_GOAL_CHANGE_SEMANTIC_VERSION,
    goal_change: {
      ...emptySolGoalChangeSemanticResult().goal_change,
      intent: "none",
      member_meaning_summary: "Restore canonical coaching.",
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

function mockClearQuery(args: {
  data?: { updated_at: string } | null;
  error?: { message: string } | null;
}) {
  const patches: Record<string, unknown>[] = [];
  const q: {
    update: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    not: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  } = {
    update: vi.fn((patch: Record<string, unknown>) => {
      patches.push(patch);
      return q;
    }),
    eq: vi.fn(() => q),
    not: vi.fn(() => q),
    select: vi.fn(() => q),
    maybeSingle: vi.fn(async () => ({
      data: args.data === undefined ? { updated_at: "2026-09-07T16:00:01.000Z" } : args.data,
      error: args.error ?? null,
    })),
  };
  supabaseFrom.mockReturnValue(q);
  return { q, patches };
}

describe("Slice 7F-1 overlay snapshot + proof helpers", () => {
  it("exposes live overlay facts only; proposal columns are ignored", () => {
    const live = overlayRow({
      adaptive_proposal_text: "I will be in bed by 11:00 pm nightly.",
      adaptive_proposal_expires_at: "2026-09-20T04:00:00.000Z",
    });
    const snap = buildAuthoritativeActiveOverlaySnapshot(live, NOW.getTime(), "America/Chicago");
    expect(snap).toEqual({
      active: true,
      overlay_behavior_statement: OVERLAY,
      overlay_expires_at: EXPIRES,
      overlay_last_included_local_date: "2026-09-13",
    });
    expect(
      buildAuthoritativeActiveOverlaySnapshot(commitment(), NOW.getTime(), "America/Chicago")
    ).toBeNull();
    expect(
      buildAuthoritativeActiveOverlaySnapshot(
        overlayRow({ adaptive_ask_expires_at: "2026-09-07T15:00:00.000Z" }),
        NOW.getTime(),
        "America/Chicago"
      )
    ).toBeNull();
  });

  it("proves revert from reloaded state, not the mutation return value", () => {
    const before = overlayRow();
    const after = clearedRow(before);
    expect(
      proveTemporaryOverlayReverted({
        before,
        after,
        canonicalSnapshot: CANONICAL,
        nowMs: NOW.getTime(),
      })
    ).toEqual({ ok: true });
    expect(isV2AdaptiveOverlayActive(after, NOW.getTime())).toBe(false);
    expect(getEffectiveCoachingAsk(after, NOW.getTime())).toBe(CANONICAL);
    expect(
      proveTemporaryOverlayReverted({
        before,
        after: { ...after, behavior_statement: OVERLAY },
        canonicalSnapshot: CANONICAL,
        nowMs: NOW.getTime(),
      }).ok
    ).toBe(false);
    expect(
      proveTemporaryOverlayReverted({
        before,
        after: overlayRow(),
        canonicalSnapshot: CANONICAL,
        nowMs: NOW.getTime(),
      })
    ).toEqual({ ok: false, reason: "reload_overlay_still_active" });
  });

  it("fails proof if overlay text is gone but active_from remains", () => {
    const before = overlayRow();
    const after = {
      ...clearedRow(before),
      adaptive_ask_active_from: before.adaptive_ask_active_from,
    };
    expect(
      proveTemporaryOverlayReverted({
        before,
        after,
        canonicalSnapshot: CANONICAL,
        nowMs: NOW.getTime(),
      })
    ).toEqual({ ok: false, reason: "reload_overlay_active_from_still_present" });
  });

  it("fails proof if overlay text is gone but expires_at remains", () => {
    const before = overlayRow();
    const after = {
      ...clearedRow(before),
      adaptive_ask_expires_at: before.adaptive_ask_expires_at,
    };
    expect(
      proveTemporaryOverlayReverted({
        before,
        after,
        canonicalSnapshot: CANONICAL,
        nowMs: NOW.getTime(),
      })
    ).toEqual({ ok: false, reason: "reload_overlay_expires_at_still_present" });
  });

  it("passes proof only when all three adaptive_ask_* columns are cleared", () => {
    const before = overlayRow();
    const after = clearedRow(before);
    expect(after.adaptive_ask_text).toBeNull();
    expect(after.adaptive_ask_active_from).toBeNull();
    expect(after.adaptive_ask_expires_at).toBeNull();
    expect(
      proveTemporaryOverlayReverted({
        before,
        after,
        canonicalSnapshot: CANONICAL,
        nowMs: NOW.getTime(),
      })
    ).toEqual({ ok: true });
  });
});

describe("Slice 7F-1 clearActiveTemporaryOverlay", () => {
  beforeEach(() => {
    supabaseFrom.mockReset();
  });

  it("clears only adaptive_ask_* on the same active row", async () => {
    const { patches, q } = mockClearQuery({});
    const r = await clearActiveTemporaryOverlay({
      commitmentId: "cmt_angela",
      expectedUpdatedAt: UPDATED,
      nowMs: NOW.getTime(),
    });
    expect(r).toEqual({
      ok: true,
      alreadyCleared: false,
      updatedAt: "2026-09-07T16:00:01.000Z",
    });
    expect(supabaseFrom).toHaveBeenCalledWith("v2_commitment");
    expect(patches).toHaveLength(1);
    expect(Object.keys(patches[0] ?? {}).sort()).toEqual([
      "adaptive_ask_active_from",
      "adaptive_ask_expires_at",
      "adaptive_ask_text",
      "updated_at",
    ]);
    expect(patches[0]?.adaptive_ask_text).toBeNull();
    expect(patches[0]?.adaptive_ask_active_from).toBeNull();
    expect(patches[0]?.adaptive_ask_expires_at).toBeNull();
    expect(q.eq).toHaveBeenCalledWith("id", "cmt_angela");
    expect(q.eq).toHaveBeenCalledWith("status", "active");
    expect(q.eq).toHaveBeenCalledWith("updated_at", UPDATED);
    expect(q.not).toHaveBeenCalledWith("adaptive_ask_text", "is", null);
  });

  it("treats a 0-row CAS miss as alreadyCleared without throwing", async () => {
    mockClearQuery({ data: null });
    const r = await clearActiveTemporaryOverlay({
      commitmentId: "cmt_angela",
      expectedUpdatedAt: UPDATED,
      nowMs: NOW.getTime(),
    });
    expect(r).toEqual({ ok: true, alreadyCleared: true, updatedAt: null });
  });
});

describe("runSolGoalChangePendingOpenForInbound — 7F-1 revert", () => {
  beforeEach(() => {
    getActiveCommitment.mockReset();
    recomputeV2CoachingMemory.mockReset();
    applyWave4SmsCommitmentPendingResolution.mockReset();
    bootstrapSmsPendingConfirmationFromInbound.mockReset();
    runSolGoalChangeSemanticInterpreter.mockReset();
    mergeSmsPendingResolutionPayload.mockReset();
    clearPendingResolution.mockReset();
    supabaseFrom.mockReset();
    recomputeV2CoachingMemory.mockResolvedValue(undefined);
    applyWave4SmsCommitmentPendingResolution.mockResolvedValue({
      pendingApplied: true,
      pendingKind: "commitment_replace",
      skipReason: null,
    });
    bootstrapSmsPendingConfirmationFromInbound.mockResolvedValue({
      promoted: false,
      candidate: null,
      skipReason: "not_needed",
    });
  });

  async function run(
    row: ActiveV2CommitmentRow,
    extras: {
      inboundRaw?: string;
      messageSid?: string;
      now?: Date;
      mutationClock?: () => number;
      plannedInterruptionKnown?: boolean;
    } = {}
  ) {
    return runSolGoalChangePendingOpenForInbound({
      clerkUserId: "user_angela",
      commitment: row,
      inboundRaw: extras.inboundRaw ?? "Use my regular goal again.",
      messageSid: extras.messageSid ?? "SMrevert",
      plannedInterruptionKnown: extras.plannedInterruptionKnown === true,
      timezone: "America/Chicago",
      now: extras.now ?? NOW,
      mutationClock: extras.mutationClock ?? (() => NOW.getTime()),
    });
  }

  it("A: active overlay + revert intent → clear → proof → revert auth", async () => {
    const live = overlayRow();
    const after = clearedRow(live);
    getActiveCommitment
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(after);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ reverts_active_temporary_overlay: true }))
    );
    const { patches } = mockClearQuery({});
    const r = await run(live);
    expect(r.authorization.temporary_adjustment_reverted).toBe(true);
    expect(r.authorization.goal_change_apply_authorized).toBe(false);
    expect(r.authorization.goal_change_confirmation_authorized).toBe(false);
    expect(r.authorization.canonical_behavior_statement).toBe(CANONICAL);
    expect(r.forensics.overlay_revert_proved).toBe(true);
    expect(r.forensics.reload_authorized).toBe(true);
    expect(patches).toHaveLength(1);
    expect(r.commitment.behavior_statement).toBe(CANONICAL);
    expect(r.commitment.id).toBe(live.id);
    expect(isV2AdaptiveOverlayActive(r.commitment, NOW.getTime())).toBe(false);
    expect(getEffectiveCoachingAsk(r.commitment, NOW.getTime())).toBe(CANONICAL);
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
    expect(recomputeV2CoachingMemory).toHaveBeenCalledWith("cmt_angela", {
      reasonCode: "sol_temporary_overlay_reverted",
    });
    const input = runSolGoalChangeSemanticInterpreter.mock.calls[0]?.[0]?.input;
    expect(input.authoritative_active_overlay?.active).toBe(true);
    expect(input.authoritative_active_overlay?.overlay_behavior_statement).toBe(OVERLAY);
  });

  it("A2: revert=true + saved_replace does not clear overlay; saved path still opens", async () => {
    const live = overlayRow();
    const pending = {
      ...live,
      pending_resolution_kind: "commitment_replace" as const,
      pending_resolution_created_at: "2026-09-07T16:00:00.000Z",
      pending_resolution_expires_at: "2027-09-07T16:00:00.000Z",
      pending_resolution_payload: {
        source: "sms_inbound",
        sms_state: "awaiting_confirmation",
        detected_intent: "sms_replace_request",
        candidate_behavior_statement: OVERLAY,
        candidate_new_bar: OVERLAY,
        inbound_message_sid: "SMdual",
        raw_user_text: "Change my real goal to 10:30",
      },
    };
    getActiveCommitment.mockResolvedValueOnce(live).mockResolvedValue(pending);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "saved_replace",
          candidate_behavior_statement: "10:30",
          requires_confirmation: true,
          reverts_active_temporary_overlay: true,
        })
      )
    );
    const r = await run(live, { inboundRaw: "Change my real goal to 10:30" });
    expect(supabaseFrom).not.toHaveBeenCalled();
    expect(applyWave4SmsCommitmentPendingResolution).toHaveBeenCalled();
    expect(r.authorization.temporary_adjustment_reverted).not.toBe(true);
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
  });

  it("B2: revert=true + temporary_adjustment does not clear overlay", async () => {
    const live = overlayRow();
    getActiveCommitment.mockResolvedValue(live);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "temporary_adjustment",
          candidate_behavior_statement: "11:00",
          reverts_active_temporary_overlay: true,
          temporary_duration_kind: "local_week",
        })
      )
    );
    const r = await run(live, { inboundRaw: "This week make it 11:00." });
    expect(supabaseFrom).not.toHaveBeenCalled();
    expect(r.authorization.temporary_adjustment_reverted).not.toBe(true);
  });

  it("B: active overlay + non-revert intent → no clear", async () => {
    const live = overlayRow();
    getActiveCommitment.mockResolvedValue(live);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "none",
          reverts_active_temporary_overlay: false,
          member_meaning_summary: "Ordinary coaching with overlay live.",
        })
      )
    );
    const r = await run(live, { inboundRaw: "I had a great workout" });
    expect(supabaseFrom).not.toHaveBeenCalled();
    expect(r.authorization.temporary_adjustment_reverted).not.toBe(true);
    expect(live.adaptive_ask_text).toBe(OVERLAY);
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
  });

  it("C: no overlay + revert-ish Sol flag false → no clear", async () => {
    const live = commitment();
    getActiveCommitment.mockResolvedValue(live);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ reverts_active_temporary_overlay: false }))
    );
    const r = await run(live);
    expect(supabaseFrom).not.toHaveBeenCalled();
    expect(r.authorization.temporary_adjustment_reverted).not.toBe(true);
  });

  it("D: overlay expires before mutation → no live-revert mutation / no false proof", async () => {
    const live = overlayRow();
    getActiveCommitment.mockResolvedValue(live);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ reverts_active_temporary_overlay: true }))
    );
    const wall = Date.parse(EXPIRES) + 1000;
    const r = await run(live, {
      now: NOW,
      mutationClock: () => wall,
    });
    expect(supabaseFrom).not.toHaveBeenCalled();
    expect(r.authorization.temporary_adjustment_reverted).not.toBe(true);
    expect(r.forensics.overlay_revert_reason).toBe("overlay_expired_not_live");
    expect(r.forensics.overlay_revert_proved).toBe(false);
    expect(live.behavior_statement).toBe(CANONICAL);
    expect(live.adaptive_ask_text).toBe(OVERLAY);
    expect(tryBuildAuthorizedGoalChangeWriterFailureFallback(r.authorization)).toBeNull();
  });

  it("E: clear succeeds → canonical unchanged and effective ask canonical", async () => {
    const live = overlayRow();
    const after = clearedRow(live);
    getActiveCommitment
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(after);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ reverts_active_temporary_overlay: true }))
    );
    mockClearQuery({});
    const r = await run(live);
    expect(r.commitment.behavior_statement).toBe(CANONICAL);
    expect(r.commitment.behavior_statement).toBe(live.behavior_statement);
    expect(getEffectiveCoachingAsk(r.commitment, NOW.getTime())).toBe(CANONICAL);
    expect(r.authorization.canonical_behavior_statement).toBe(CANONICAL);
  });

  it("F: clear fails → no revert auth", async () => {
    const live = overlayRow();
    getActiveCommitment.mockResolvedValue(live);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ reverts_active_temporary_overlay: true }))
    );
    mockClearQuery({ data: null, error: { message: "write_failed" } });
    const r = await run(live);
    expect(r.authorization.temporary_adjustment_reverted).not.toBe(true);
    expect(r.forensics.overlay_revert_proved).toBe(false);
    expect(r.forensics.overlay_revert_reason).toContain("clear_failed");
    expect(recomputeV2CoachingMemory).not.toHaveBeenCalled();
  });

  it("G: reload proof fails → no revert auth", async () => {
    const live = overlayRow();
    getActiveCommitment
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce({ ...clearedRow(live), behavior_statement: OVERLAY });
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ reverts_active_temporary_overlay: true }))
    );
    mockClearQuery({});
    const r = await run(live);
    expect(r.authorization.temporary_adjustment_reverted).not.toBe(true);
    expect(r.forensics.overlay_revert_reason).toBe("reload_canonical_changed");
    expect(recomputeV2CoachingMemory).not.toHaveBeenCalled();
  });

  it("H: duplicate SID → no double mutation", async () => {
    const live = overlayRow();
    const after = clearedRow(live);
    getActiveCommitment
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(after);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ reverts_active_temporary_overlay: true }))
    );
    const first = mockClearQuery({});
    const r1 = await run(live, { messageSid: "SMdup" });
    expect(r1.authorization.temporary_adjustment_reverted).toBe(true);
    expect(first.patches).toHaveLength(1);

    getActiveCommitment.mockResolvedValue(after);
    supabaseFrom.mockClear();
    const r2 = await run(after, { messageSid: "SMdup" });
    expect(r2.authorization.temporary_adjustment_reverted).toBe(true);
    expect(supabaseFrom).not.toHaveBeenCalled();
    expect(r2.forensics.overlay_revert_reason).toBe("already_canonical");
    expect(after.behavior_statement).toBe(CANONICAL);
  });

  it("I: writer failure after clear → canonical stays; retry does not re-clear", async () => {
    const live = overlayRow();
    const after = clearedRow(live);
    getActiveCommitment
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(after);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ reverts_active_temporary_overlay: true }))
    );
    mockClearQuery({});
    const first = await run(live, { messageSid: "SMwriter" });
    expect(first.authorization.temporary_adjustment_reverted).toBe(true);
    const fallback = tryBuildAuthorizedGoalChangeWriterFailureFallback(first.authorization);
    expect(fallback).toMatch(/regular goal/i);
    expect(
      applyGoalChangeMachineBodySafety({
        body: "Your goal is now 10:30.",
        authorization: first.authorization,
      }).blocked
    ).toBe(true);

    getActiveCommitment.mockResolvedValue(after);
    supabaseFrom.mockClear();
    const retry = await run(after, { messageSid: "SMwriter" });
    expect(supabaseFrom).not.toHaveBeenCalled();
    expect(retry.commitment.adaptive_ask_text).toBeNull();
    expect(retry.commitment.behavior_statement).toBe(CANONICAL);
    expect(retry.authorization.temporary_adjustment_reverted).toBe(true);
  });

  it("J: active overlay + saved pending → saved pending precedence / no steal", async () => {
    const live = overlayRow({
      pending_resolution_kind: "commitment_replace",
      pending_resolution_created_at: "2026-09-07T12:00:00.000Z",
      pending_resolution_expires_at: "2027-09-07T12:00:00.000Z",
      pending_resolution_payload: {
        source: "sms_inbound",
        sms_state: "awaiting_confirmation",
        detected_intent: "sms_replace_request",
        candidate_behavior_statement: OVERLAY,
        candidate_new_bar: OVERLAY,
        inbound_message_sid: "SMsaved",
        raw_user_text: "Change my goal to 10:30",
      },
    });
    getActiveCommitment.mockResolvedValue(live);
    const r = await run(live, { inboundRaw: "Yes" });
    expect(runSolGoalChangeSemanticInterpreter).not.toHaveBeenCalled();
    expect(supabaseFrom).not.toHaveBeenCalled();
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
    expect(r.authorization.temporary_adjustment_reverted).not.toBe(true);
    expect(r.forensics.pending_skip_reason).toBe("existing_pending");
    expect(live.adaptive_ask_text).toBe(OVERLAY);
  });

  it("K: active overlay + PI known → PI is not mutated and revert still proofs", async () => {
    const live = overlayRow();
    const after = clearedRow(live);
    getActiveCommitment
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(after);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk({
        ...semantic({ reverts_active_temporary_overlay: true }),
        concurrent_meaning: { planned_interruption: true, accountability_update: false },
      })
    );
    mockClearQuery({});
    const r = await run(live, { plannedInterruptionKnown: true });
    expect(r.authorization.temporary_adjustment_reverted).toBe(true);
    const input = runSolGoalChangeSemanticInterpreter.mock.calls[0]?.[0]?.input;
    expect(input.planned_interruption_known).toBe(true);
    expect(clearPendingResolution).not.toHaveBeenCalled();
    expect(mergeSmsPendingResolutionPayload).not.toHaveBeenCalled();
  });

  it("L: ordinary coaching with active overlay → no revert without Sol flag", async () => {
    const live = overlayRow();
    getActiveCommitment.mockResolvedValue(live);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "none",
          reverts_active_temporary_overlay: false,
          member_meaning_summary: "Workout went well.",
        })
      )
    );
    const r = await run(live, { inboundRaw: "I had a great workout" });
    expect(supabaseFrom).not.toHaveBeenCalled();
    expect(r.authorization.temporary_adjustment_reverted).not.toBe(true);
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
  });

  it("M: saved Goal Change is unchanged when Sol does not revert", async () => {
    const live = overlayRow();
    const pending = {
      ...live,
      pending_resolution_kind: "commitment_replace" as const,
      pending_resolution_created_at: "2026-09-07T16:00:00.000Z",
      pending_resolution_expires_at: "2027-09-07T16:00:00.000Z",
      pending_resolution_payload: {
        source: "sms_inbound",
        sms_state: "awaiting_confirmation",
        detected_intent: "sms_replace_request",
        candidate_behavior_statement: OVERLAY,
        candidate_new_bar: OVERLAY,
        inbound_message_sid: "SMsaved2",
        raw_user_text: "Going forward, make it 10:30",
      },
    };
    getActiveCommitment.mockResolvedValueOnce(live).mockResolvedValue(pending);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "saved_replace",
          candidate_behavior_statement: "10:30",
          requires_confirmation: true,
          reverts_active_temporary_overlay: false,
        })
      )
    );
    const r = await run(live, { inboundRaw: "Going forward, make it 10:30" });
    expect(supabaseFrom).not.toHaveBeenCalled();
    expect(applyWave4SmsCommitmentPendingResolution).toHaveBeenCalled();
    expect(r.authorization.temporary_adjustment_reverted).not.toBe(true);
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
  });

  it("N: leftover untagged tighten pending is not stolen by overlay revert", async () => {
    const live = overlayRow({
      pending_resolution_kind: "commitment_tighten",
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
    });
    getActiveCommitment.mockResolvedValue(live);
    const r = await run(live, { inboundRaw: "never mind" });
    expect(runSolGoalChangeSemanticInterpreter).not.toHaveBeenCalled();
    expect(supabaseFrom).not.toHaveBeenCalled();
    expect(r.authorization.temporary_adjustment_reverted).not.toBe(true);
    expect(r.forensics.pending_skip_reason).toBe("existing_pending_not_confirmable");
    const leftover = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-sms-pending-resolution-complete.ts"),
      "utf8"
    );
    expect(leftover).toMatch(/never mind/);
  });
});

describe("Slice 7F-1 applySolActiveTemporaryOverlayRevert isolation", () => {
  beforeEach(() => {
    getActiveCommitment.mockReset();
    recomputeV2CoachingMemory.mockReset();
    supabaseFrom.mockReset();
    recomputeV2CoachingMemory.mockResolvedValue(undefined);
  });

  it("does not authorize revert from Sol meaning without proof", async () => {
    const live = overlayRow();
    getActiveCommitment.mockResolvedValue(live);
    mockClearQuery({ data: null });
    const r = await applySolActiveTemporaryOverlayRevert({
      clerkUserId: "user_angela",
      commitment: live,
      inboundMessageSid: "SMcas",
      mutationClock: () => NOW.getTime(),
    });
    expect(r.authorization.temporary_adjustment_reverted).not.toBe(true);
    expect(r.forensics.overlay_revert_reason).toBe("cas_mismatch");
  });

  it("reverted authorization never stages confirmation", () => {
    const auth = buildTemporaryRevertedAuthorization({ commitment: overlayRow() });
    expect(auth.temporary_adjustment_reverted).toBe(true);
    expect(auth.goal_change_confirmation_authorized).toBe(false);
    expect(auth.pending_state).toBeNull();
    expect(auth.temporary_adjustment_confirmation_authorized).toBe(false);
    expect(auth.goal_change_apply_authorized).toBe(false);
  });
});

describe("Slice 7F-1 no second brain / no generic overlay platform", () => {
  it("production revert + pending-open have no inbound phrase parser", () => {
    const files = [
      "sol-goal-change-temporary-revert.ts",
      "sol-goal-change-pending-open.ts",
      "sol-goal-change-semantic.ts",
      "sol-goal-change-semantic-interpreter.ts",
    ];
    for (const file of files) {
      const src = fs.readFileSync(path.join(process.cwd(), "src/lib", file), "utf8");
      expect(src).not.toMatch(/go back to my normal goal/i);
      expect(src).not.toMatch(/\\bcancel the temporary\\b/);
      expect(src).not.toContain("applyCanonicalGoalChangeWithSeasonMutation");
    }
    const revert = fs.readFileSync(
      path.join(process.cwd(), "src/lib/sol-goal-change-temporary-revert.ts"),
      "utf8"
    );
    expect(revert).toContain("clearActiveTemporaryOverlay");
    expect(revert).not.toContain("parseSmsConfirmation");
    expect(revert).not.toContain("looksLikeCancellation");
    expect(revert).not.toContain("export async function clearAnyAdaptiveOverlay");
    expect(revert).not.toContain("planned_interruption");
    expect(revert).toContain("mutationClock");
    expect(revert).toContain("const mutationNowMs = mutationClock()");
    expect(revert).toContain("const proofNowMs = mutationClock()");
  });

  it("route keeps job.created_at as semantic now; mutationClock is not the job clock", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts"),
      "utf8"
    );
    const start = src.indexOf("await runSolGoalChangePendingOpenForInbound");
    const block = src.slice(start, start + 900);
    expect(block).toContain("now: job.created_at");
    expect(block).not.toContain("mutationClock:");
  });

  it("writer coaching note is proof-gated", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/inbound-sol-writer.ts"),
      "utf8"
    );
    expect(src).toContain("TEMPORARY_OVERLAY_REVERTED_COACHING_NOTE");
    expect(src).toContain("verified_temporary_overlay_reverted");
    expect(src).toContain("overlay_active_after_revert");
    expect(src).toContain("effective_ask_after_revert");
  });
});
