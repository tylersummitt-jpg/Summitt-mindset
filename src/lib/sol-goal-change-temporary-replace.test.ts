import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  emptySolGoalChangeSemanticResult,
  SOL_GOAL_CHANGE_SEMANTIC_VERSION,
} from "@/lib/sol-goal-change-semantic";
import type { SolGoalChangeSemanticResult } from "@/lib/sol-goal-change-semantic";
import { resolveTemporaryOverlayExpiry } from "@/lib/sol-goal-change-temporary-duration";
import {
  applyGoalChangeMachineBodySafety,
  buildAuthorizedTemporaryAppliedAck,
  buildAuthorizedTemporaryConfirmationAsk,
  tryBuildAuthorizedGoalChangeWriterFailureFallback,
} from "@/lib/sol-goal-change-confirmation-guard";
import {
  getEffectiveCoachingAsk,
  isV2AdaptiveOverlayActive,
} from "@/lib/v2-adaptive-contract";
import { getPendingResolutionOrNull } from "@/lib/v2-guided-resolution";

const getActiveCommitment = vi.hoisted(() => vi.fn());
const recomputeV2CoachingMemory = vi.hoisted(() => vi.fn());
const applyWave4SmsCommitmentPendingResolution = vi.hoisted(() => vi.fn());
const bootstrapSmsPendingConfirmationFromInbound = vi.hoisted(() => vi.fn());
const runSolGoalChangeSemanticInterpreter = vi.hoisted(() => vi.fn());
const mergeSmsPendingResolutionPayload = vi.hoisted(() => vi.fn());
const clearPendingResolution = vi.hoisted(() => vi.fn());
const persistContractOverlayProposed = vi.hoisted(() => vi.fn());
const activateAdaptiveOverlayFromProposal = vi.hoisted(() => vi.fn());
const clearStaleAdaptiveContractColumns = vi.hoisted(() => vi.fn());
const supabaseFrom = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: supabaseFrom, rpc: vi.fn() },
}));

vi.mock("server-only", () => ({}));

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

vi.mock("@/lib/v2-adaptive-contract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-adaptive-contract")>();
  return {
    ...actual,
    persistContractOverlayProposed,
    activateAdaptiveOverlayFromProposal,
    clearStaleAdaptiveContractColumns,
  };
});

import { runSolGoalChangePendingOpenForInbound } from "@/lib/sol-goal-change-pending-open";
import { runSolTemporaryOverlayConfirmForInbound } from "@/lib/sol-goal-change-temporary-confirm";
import { resolveActiveOverlayReplacementFill } from "@/lib/sol-goal-change-temporary-pending";
import {
  liveOverlayMatchesReplacementSnapshot,
  replaceActiveTemporaryOverlay,
} from "@/lib/sol-goal-change-temporary-replace";
import { SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT } from "@/lib/sol-goal-change-semantic-interpreter";
import { INBOUND_SOL_WRITER_SYSTEM_PROMPT } from "@/lib/inbound-sol-writer";

const CANONICAL = "I will be in bed by 9:30 pm nightly.";
const OVERLAY = "I will be in bed by 10:30 pm nightly.";
const REPLACEMENT = "I will be in bed by 10:15 pm nightly.";
const NY = "America/New_York";
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

function fridayExpiry() {
  return resolveTemporaryOverlayExpiry({
    temporary_duration_kind: "through_weekday",
    temporary_duration_days: null,
    temporary_weekday: "friday",
    temporary_end_local_date: null,
    timezone: NY,
    now: NOW,
  });
}

function semantic(
  overrides: Partial<SolGoalChangeSemanticResult["goal_change"]> = {}
): SolGoalChangeSemanticResult {
  return {
    version: SOL_GOAL_CHANGE_SEMANTIC_VERSION,
    goal_change: {
      ...emptySolGoalChangeSemanticResult().goal_change,
      intent: "temporary_adjustment",
      candidate_behavior_statement: "10:15",
      needs_clarification: false,
      requires_confirmation: true,
      confirms_existing_pending: false,
      rejects_existing_pending: false,
      modifies_existing_pending_candidate: false,
      member_meaning_summary: "change the live temporary overlay",
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

function replacementPayload(overrides: Record<string, unknown> = {}) {
  return {
    source: "sms_inbound",
    sms_state: "awaiting_confirmation",
    detected_intent: "sms_tighten_request",
    sol_temporary_overlay: true,
    replaces_active_temporary_overlay: true,
    replaced_overlay_behavior_statement: OVERLAY,
    replaced_overlay_expires_at: EXPIRES,
    candidate_behavior_statement: REPLACEMENT,
    candidate_tightened_bar: REPLACEMENT,
    inbound_message_sid: "SMrep",
    raw_user_text: "Make it 10:15 instead.",
    ai_confidence: null,
    temporary_duration_kind: "unspecified",
    temporary_duration_days: null,
    temporary_weekday: null,
    temporary_end_local_date: null,
    temporary_expires_at: EXPIRES,
    temporary_last_included_local_date: "2026-09-13",
    canonical_behavior_snapshot: CANONICAL,
    temporary_interpreted_local_date: "2026-09-07",
    temporary_interpreted_at: NOW.toISOString(),
    ...overrides,
  };
}

function withReplacementPending(
  row: ActiveV2CommitmentRow = overlayRow(),
  payload: Record<string, unknown> = replacementPayload()
): ActiveV2CommitmentRow {
  return {
    ...row,
    pending_resolution_kind: "commitment_tighten",
    pending_resolution_created_at: "2026-09-07T12:00:00.000Z",
    pending_resolution_expires_at: "2027-09-07T12:00:00.000Z",
    pending_resolution_payload: payload,
  };
}

function mockReplaceQuery(args: {
  data?: { updated_at: string } | null;
  error?: { message: string } | null;
  onUpdate?: (patch: Record<string, unknown>) => void;
}) {
  const q: {
    update: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    not: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  } = {
    update: vi.fn((patch: Record<string, unknown>) => {
      args.onUpdate?.(patch);
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
  return q;
}

describe("7F-2 fill rules", () => {
  const overlay = {
    active: true as const,
    overlay_behavior_statement: OVERLAY,
    overlay_expires_at: EXPIRES,
    overlay_last_included_local_date: "2026-09-13",
  };

  it("A: candidate-only keeps current expiry", () => {
    const r = resolveActiveOverlayReplacementFill({
      semantic: semantic({ temporary_duration_kind: "unspecified" }),
      overlay,
      canonicalBehaviorStatement: CANONICAL,
      timezone: NY,
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidate).toBe(REPLACEMENT);
    expect(r.frozen.temporary_expires_at).toBe(EXPIRES);
    expect(r.frozen.temporary_last_included_local_date).toBe("2026-09-13");
  });

  it("B: duration-only keeps current overlay text", () => {
    const friday = fridayExpiry();
    const r = resolveActiveOverlayReplacementFill({
      semantic: semantic({
        candidate_behavior_statement: null,
        temporary_duration_kind: "through_weekday",
        temporary_weekday: "friday",
      }),
      overlay,
      canonicalBehaviorStatement: CANONICAL,
      timezone: NY,
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidate).toBe(OVERLAY);
    expect(r.frozen.temporary_expires_at).toBe(friday.expires_at_utc);
  });

  it("C: candidate+duration replaces both", () => {
    const friday = fridayExpiry();
    const r = resolveActiveOverlayReplacementFill({
      semantic: semantic({
        temporary_duration_kind: "through_weekday",
        temporary_weekday: "friday",
      }),
      overlay,
      canonicalBehaviorStatement: CANONICAL,
      timezone: NY,
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidate).toBe(REPLACEMENT);
    expect(r.frozen.temporary_expires_at).toBe(friday.expires_at_utc);
  });

  it("identical overlay fill is not a replacement", () => {
    const r = resolveActiveOverlayReplacementFill({
      semantic: semantic({
        candidate_behavior_statement: OVERLAY,
        temporary_duration_kind: "unspecified",
      }),
      overlay,
      canonicalBehaviorStatement: CANONICAL,
      timezone: NY,
      now: NOW,
    });
    expect(r).toEqual({ ok: false, reason: "replacement_matches_current_overlay" });
  });
});

describe("7F-2 CAS replace primitive", () => {
  it("writes overlay columns only and constraints match snapshot", async () => {
    const q = mockReplaceQuery({});
    const r = await replaceActiveTemporaryOverlay({
      commitmentId: "cmt_angela",
      expectedUpdatedAt: UPDATED,
      expectedCanonical: CANONICAL,
      expectedOverlayText: OVERLAY,
      expectedOverlayExpiresAt: EXPIRES,
      nextOverlayText: REPLACEMENT,
      nextOverlayExpiresAt: EXPIRES,
      nowMs: NOW.getTime(),
    });
    expect(r).toEqual({
      ok: true,
      alreadyReplaced: false,
      updatedAt: "2026-09-07T16:00:01.000Z",
    });
    expect(q.update).toHaveBeenCalledWith({
      adaptive_ask_text: REPLACEMENT,
      adaptive_ask_active_from: NOW.toISOString(),
      adaptive_ask_expires_at: EXPIRES,
      updated_at: NOW.toISOString(),
    });
    expect(q.update.mock.calls[0][0]).not.toHaveProperty("behavior_statement");
    expect(q.eq).toHaveBeenCalledWith("id", "cmt_angela");
    expect(q.eq).toHaveBeenCalledWith("status", "active");
    expect(q.eq).toHaveBeenCalledWith("behavior_statement", CANONICAL);
    expect(q.eq).toHaveBeenCalledWith("adaptive_ask_text", OVERLAY);
    expect(q.eq).toHaveBeenCalledWith("adaptive_ask_expires_at", EXPIRES);
    expect(q.eq).toHaveBeenCalledWith("updated_at", UPDATED);
  });

  it("0 rows is state_conflict, not success", async () => {
    mockReplaceQuery({ data: null });
    const r = await replaceActiveTemporaryOverlay({
      commitmentId: "cmt_angela",
      expectedCanonical: CANONICAL,
      expectedOverlayText: OVERLAY,
      expectedOverlayExpiresAt: EXPIRES,
      nextOverlayText: REPLACEMENT,
      nextOverlayExpiresAt: EXPIRES,
      nowMs: NOW.getTime(),
    });
    expect(r).toEqual({ ok: false, error: "state_conflict" });
  });

  it("snapshot matcher fails closed on expiry, text, or canonical drift", () => {
    const row = overlayRow();
    expect(
      liveOverlayMatchesReplacementSnapshot({
        commitment: row,
        expectedCanonical: CANONICAL,
        expectedOverlayText: OVERLAY,
        expectedOverlayExpiresAt: EXPIRES,
        nowMs: NOW.getTime(),
      }).ok
    ).toBe(true);
    expect(
      liveOverlayMatchesReplacementSnapshot({
        commitment: { ...row, behavior_statement: REPLACEMENT },
        expectedCanonical: CANONICAL,
        expectedOverlayText: OVERLAY,
        expectedOverlayExpiresAt: EXPIRES,
        nowMs: NOW.getTime(),
      })
    ).toEqual({ ok: false, reason: "canonical_snapshot_mismatch" });
    expect(
      liveOverlayMatchesReplacementSnapshot({
        commitment: { ...row, adaptive_ask_text: REPLACEMENT },
        expectedCanonical: CANONICAL,
        expectedOverlayText: OVERLAY,
        expectedOverlayExpiresAt: EXPIRES,
        nowMs: NOW.getTime(),
      })
    ).toEqual({ ok: false, reason: "overlay_snapshot_mismatch" });
    expect(
      liveOverlayMatchesReplacementSnapshot({
        commitment: row,
        expectedCanonical: CANONICAL,
        expectedOverlayText: OVERLAY,
        expectedOverlayExpiresAt: EXPIRES,
        nowMs: Date.parse(EXPIRES) + 1,
      })
    ).toEqual({ ok: false, reason: "overlay_expired_not_live" });
  });
});

describe("7F-2 pending-open + confirm", () => {
  let live: ActiveV2CommitmentRow;

  beforeEach(() => {
    vi.clearAllMocks();
    live = overlayRow();
    getActiveCommitment.mockImplementation(async () => live);
    recomputeV2CoachingMemory.mockResolvedValue(undefined);
    clearStaleAdaptiveContractColumns.mockResolvedValue(undefined);
    persistContractOverlayProposed.mockResolvedValue({ ok: true, updatedAt: UPDATED });
    activateAdaptiveOverlayFromProposal.mockResolvedValue({
      ok: true,
      result: "applied",
      updatedAt: UPDATED,
    });
    applyWave4SmsCommitmentPendingResolution.mockResolvedValue({
      pendingApplied: true,
      pendingKind: "commitment_tighten",
      skipReason: null,
    });
    bootstrapSmsPendingConfirmationFromInbound.mockResolvedValue({
      promoted: false,
      candidate: null,
      skipReason: "sol_owned_awaiting_candidate_shell",
    });
    mergeSmsPendingResolutionPayload.mockImplementation(
      async (args: { merge: (prev: Record<string, unknown>) => Record<string, unknown> }) => {
        const prev = (live.pending_resolution_payload ?? {
          source: "sms_inbound",
          detected_intent: "sms_tighten_request",
          raw_user_text: "",
          inbound_message_sid: "SMrep",
          ai_confidence: null,
        }) as Record<string, unknown>;
        live = {
          ...live,
          pending_resolution_kind: "commitment_tighten",
          pending_resolution_created_at: live.pending_resolution_created_at ?? UPDATED,
          pending_resolution_expires_at: live.pending_resolution_expires_at ?? "2027-09-07T12:00:00.000Z",
          pending_resolution_payload: args.merge(prev),
          updated_at: "2026-09-07T12:01:00.000Z",
        };
        return { ok: true, updatedAt: live.updated_at };
      }
    );
    clearPendingResolution.mockImplementation(async () => {
      live = {
        ...live,
        pending_resolution_kind: null,
        pending_resolution_created_at: null,
        pending_resolution_expires_at: null,
        pending_resolution_payload: null,
        updated_at: "2026-09-07T12:02:00.000Z",
      };
      return live.updated_at;
    });
  });

  async function open(inboundRaw: string, result = semantic()) {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(interpreterOk(result));
    return runSolGoalChangePendingOpenForInbound({
      clerkUserId: "user_angela",
      commitment: live,
      inboundRaw,
      messageSid: "SMrep",
      plannedInterruptionKnown: false,
      timezone: NY,
      now: NOW,
      mutationClock: () => NOW.getTime(),
    });
  }

  async function confirm(inboundRaw: string, extras?: { mutationClock?: () => number }) {
    return runSolTemporaryOverlayConfirmForInbound({
      clerkUserId: "user_angela",
      commitment: live,
      inboundRaw,
      messageSid: "SMyes",
      timezone: NY,
      now: NOW,
      mutationClock: extras?.mutationClock ?? (() => NOW.getTime()),
    });
  }

  it("D: old overlay stays live while replacement pending awaits confirmation", async () => {
    const r = await open("Make it 10:15 instead.");
    expect(r.authorization.temporary_adjustment_confirmation_authorized).toBe(true);
    expect(r.authorization.replaces_active_temporary_overlay).toBe(true);
    expect(live.adaptive_ask_text).toBe(OVERLAY);
    expect(isV2AdaptiveOverlayActive(live, NOW.getTime())).toBe(true);
    expect(getEffectiveCoachingAsk(live, NOW.getTime())).toBe(OVERLAY);
    expect(live.behavior_statement).toBe(CANONICAL);
    const pending = getPendingResolutionOrNull(live);
    expect(pending?.payload && pending.payload.source === "sms_inbound"
      ? pending.payload.replaces_active_temporary_overlay
      : null).toBe(true);
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("E: confirm atomically replaces overlay and does not use consent RPC", async () => {
    live = withReplacementPending();
    mockReplaceQuery({
      onUpdate: (patch) => {
        live = {
          ...live,
          adaptive_ask_text: String(patch.adaptive_ask_text),
          adaptive_ask_active_from: String(patch.adaptive_ask_active_from),
          adaptive_ask_expires_at: String(patch.adaptive_ask_expires_at),
          updated_at: String(patch.updated_at),
        };
      },
    });
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ intent: "none", confirms_existing_pending: true }))
    );
    const r = await confirm("Yes");
    expect(r.consequence).toBe("applied");
    expect(r.authorization.temporary_adjustment_apply_authorized).toBe(true);
    expect(r.authorization.replaces_active_temporary_overlay).toBe(true);
    expect(r.authorization.goal_change_apply_authorized).toBe(false);
    expect(live.adaptive_ask_text).toBe(REPLACEMENT);
    expect(live.adaptive_ask_expires_at).toBe(EXPIRES);
    expect(live.behavior_statement).toBe(CANONICAL);
    expect(getEffectiveCoachingAsk(live, NOW.getTime())).toBe(REPLACEMENT);
    expect(isV2AdaptiveOverlayActive(live, NOW.getTime())).toBe(true);
    expect(getPendingResolutionOrNull(live)).toBeNull();
    expect(persistContractOverlayProposed).not.toHaveBeenCalled();
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("F: reject leaves old overlay untouched", async () => {
    live = withReplacementPending();
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ intent: "none", rejects_existing_pending: true }))
    );
    const r = await confirm("No");
    expect(r.consequence).toBe("rejected");
    expect(live.adaptive_ask_text).toBe(OVERLAY);
    expect(live.adaptive_ask_expires_at).toBe(EXPIRES);
    expect(live.behavior_statement).toBe(CANONICAL);
    expect(getPendingResolutionOrNull(live)).toBeNull();
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("G: modify pending restages and keeps live overlay", async () => {
    live = withReplacementPending();
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          modifies_existing_pending_candidate: true,
          candidate_behavior_statement: "10:45",
        })
      )
    );
    const r = await confirm("Make it 10:45 instead.");
    expect(r.consequence).toBe("modified");
    expect(r.authorization.temporary_adjustment_confirmation_authorized).toBe(true);
    expect(r.authorization.replaces_active_temporary_overlay).toBe(true);
    expect(live.adaptive_ask_text).toBe(OVERLAY);
    expect(
      (live.pending_resolution_payload as { candidate_behavior_statement?: string })
        .candidate_behavior_statement
    ).toBe("I will be in bed by 10:45 pm nightly.");
    expect(
      (live.pending_resolution_payload as { replaces_active_temporary_overlay?: boolean })
        .replaces_active_temporary_overlay
    ).toBe(true);
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("retry after replace-before-clear proves already applied without a second mutation", async () => {
    live = withReplacementPending(
      overlayRow({
        adaptive_ask_text: REPLACEMENT,
        adaptive_ask_active_from: "2026-09-07T16:00:01.000Z",
        adaptive_ask_expires_at: EXPIRES,
      })
    );
    const q = mockReplaceQuery({
      onUpdate: () => {
        throw new Error("second overlay mutation");
      },
    });
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ intent: "none", confirms_existing_pending: true }))
    );
    const r = await confirm("Yes");
    expect(r.consequence).toBe("applied");
    expect(r.authorization.temporary_adjustment_apply_authorized).toBe(true);
    expect(r.authorization.replaces_active_temporary_overlay).toBe(true);
    expect(r.authorization.goal_change_apply_authorized).toBe(false);
    expect(r.forensics.rpc_code).toBe("already_applied_state");
    expect(r.forensics.mutation_attempted).toBe(false);
    expect(live.adaptive_ask_text).toBe(REPLACEMENT);
    expect(live.adaptive_ask_expires_at).toBe(EXPIRES);
    expect(live.behavior_statement).toBe(CANONICAL);
    expect(getEffectiveCoachingAsk(live, NOW.getTime())).toBe(REPLACEMENT);
    expect(getPendingResolutionOrNull(live)).toBeNull();
    expect(q.update).not.toHaveBeenCalled();
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("near-match replacement with different expiry is not already applied", async () => {
    const otherExpiry = "2026-09-12T04:00:00.000Z";
    live = withReplacementPending(
      overlayRow({
        adaptive_ask_text: REPLACEMENT,
        adaptive_ask_active_from: "2026-09-07T16:00:01.000Z",
        adaptive_ask_expires_at: otherExpiry,
      })
    );
    const q = mockReplaceQuery({
      onUpdate: () => {
        throw new Error("must not mutate on near-match");
      },
    });
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ intent: "none", confirms_existing_pending: true }))
    );
    const r = await confirm("Yes");
    expect(r.consequence).not.toBe("applied");
    expect(r.authorization.temporary_adjustment_apply_authorized).not.toBe(true);
    expect(live.adaptive_ask_text).toBe(REPLACEMENT);
    expect(live.adaptive_ask_expires_at).toBe(otherExpiry);
    expect(live.behavior_statement).toBe(CANONICAL);
    expect(getPendingResolutionOrNull(live)).toBeNull();
    expect(q.update).not.toHaveBeenCalled();
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("H: overlay expires before confirm → fail closed", async () => {
    live = withReplacementPending();
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ intent: "none", confirms_existing_pending: true }))
    );
    const r = await confirm("Yes", {
      mutationClock: () => Date.parse(EXPIRES) + 1000,
    });
    expect(r.authorization.temporary_adjustment_apply_authorized).not.toBe(true);
    expect(r.consequence).not.toBe("applied");
    expect(live.behavior_statement).toBe(CANONICAL);
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("I: overlay changed before confirm → fail closed", async () => {
    live = withReplacementPending(
      overlayRow({ adaptive_ask_text: "I will be in bed by 11:00 pm nightly." })
    );
    mockReplaceQuery({ data: null });
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ intent: "none", confirms_existing_pending: true }))
    );
    const r = await confirm("Yes");
    expect(r.consequence).not.toBe("applied");
    expect(r.authorization.temporary_adjustment_apply_authorized).not.toBe(true);
    expect(live.adaptive_ask_text).toBe("I will be in bed by 11:00 pm nightly.");
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("J: canonical changed → fail closed", async () => {
    live = withReplacementPending(overlayRow({ behavior_statement: REPLACEMENT }));
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ intent: "none", confirms_existing_pending: true }))
    );
    const r = await confirm("Yes");
    expect(r.consequence).not.toBe("applied");
    expect(r.authorization.temporary_adjustment_apply_authorized).not.toBe(true);
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("A: overlay + saved_replace copying overlay text stages that overlay as saved candidate", async () => {
    applyWave4SmsCommitmentPendingResolution.mockImplementation(
      async (args: {
        intentPack: { intent: string; candidateNewBar: string | null };
      }) => {
        live = {
          ...live,
          pending_resolution_kind: "commitment_replace",
          pending_resolution_created_at: UPDATED,
          pending_resolution_expires_at: "2027-09-07T12:00:00.000Z",
          pending_resolution_payload: {
            source: "sms_inbound",
            sms_state: "awaiting_confirmation",
            detected_intent: "sms_replace_request",
            candidate_new_bar: args.intentPack.candidateNewBar,
            candidate_behavior_statement: args.intentPack.candidateNewBar,
            inbound_message_sid: "SMrep",
            raw_user_text: "Make this permanent.",
            ai_confidence: null,
          },
        };
        return { pendingApplied: true, pendingKind: "commitment_replace", skipReason: null };
      }
    );
    const r = await open(
      "Make this permanent.",
      semantic({
        intent: "saved_replace",
        candidate_behavior_statement: OVERLAY,
        temporary_duration_kind: "unspecified",
      })
    );
    expect(applyWave4SmsCommitmentPendingResolution.mock.calls[0]?.[0]?.intentPack).toMatchObject({
      intent: "sms_replace_request",
      candidateNewBar: OVERLAY,
    });
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
    expect(r.authorization.candidate_behavior_statement).toBe(OVERLAY);
    expect(r.authorization.temporary_adjustment_confirmation_authorized).not.toBe(true);
    expect(live.adaptive_ask_text).toBe(OVERLAY);
    expect(isV2AdaptiveOverlayActive(live, NOW.getTime())).toBe(true);
    expect(live.behavior_statement).toBe(CANONICAL);
  });

  it("B: overlay + saved_replace with a different explicit candidate does not use overlay text", async () => {
    applyWave4SmsCommitmentPendingResolution.mockResolvedValue({
      pendingApplied: true,
      pendingKind: "commitment_replace",
      skipReason: null,
    });
    const r = await open(
      "Going forward, make 10:15 my real goal.",
      semantic({
        intent: "saved_replace",
        candidate_behavior_statement: REPLACEMENT,
        temporary_duration_kind: "unspecified",
      })
    );
    expect(applyWave4SmsCommitmentPendingResolution.mock.calls[0]?.[0]?.intentPack).toMatchObject({
      intent: "sms_replace_request",
      candidateNewBar: REPLACEMENT,
    });
    expect(
      applyWave4SmsCommitmentPendingResolution.mock.calls[0]?.[0]?.intentPack?.candidateNewBar
    ).not.toBe(OVERLAY);
    expect(r.forensics.semantic_intent).toBe("saved_replace");
    expect(live.adaptive_ask_text).toBe(OVERLAY);
    expect(live.behavior_statement).toBe(CANONICAL);
  });

  it("G: overlay + temporary_adjustment still opens 7F-2 replacement, not saved_replace", async () => {
    const r = await open("Make it 10:15 instead.");
    expect(r.authorization.temporary_adjustment_confirmation_authorized).toBe(true);
    expect(r.authorization.replaces_active_temporary_overlay).toBe(true);
    expect(r.authorization.goal_change_confirmation_authorized).not.toBe(true);
    expect(applyWave4SmsCommitmentPendingResolution.mock.calls[0]?.[0]?.intentPack).toMatchObject({
      intent: "sms_tighten_request",
    });
    expect(live.adaptive_ask_text).toBe(OVERLAY);
  });

  it("L: exclusive revert still owns overlay restore", async () => {
    mockReplaceQuery({
      onUpdate: (patch) => {
        live = {
          ...live,
          adaptive_ask_text: (patch.adaptive_ask_text as string | null) ?? null,
          adaptive_ask_active_from: (patch.adaptive_ask_active_from as string | null) ?? null,
          adaptive_ask_expires_at: (patch.adaptive_ask_expires_at as string | null) ?? null,
          updated_at: String(patch.updated_at),
        };
      },
    });
    const r = await open(
      "Go back to my normal goal.",
      semantic({
        intent: "none",
        candidate_behavior_statement: null,
        reverts_active_temporary_overlay: true,
        temporary_duration_kind: "unspecified",
        requires_confirmation: false,
      })
    );
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
    expect(r.authorization.temporary_adjustment_reverted).toBe(true);
    expect(r.authorization.temporary_adjustment_confirmation_authorized).not.toBe(true);
  });

  it("M: ordinary coaching against live overlay does not stage replacement", async () => {
    const r = await open(
      "I had a good day",
      semantic({
        intent: "none",
        candidate_behavior_statement: null,
        requires_confirmation: false,
        temporary_duration_kind: "unspecified",
      })
    );
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
    expect(r.authorization.temporary_adjustment_confirmation_authorized).not.toBe(true);
    expect(live.adaptive_ask_text).toBe(OVERLAY);
    expect(getPendingResolutionOrNull(live)).toBeNull();
  });
});

describe("7F-2 writer + no-English + blast radius", () => {
  it("P: pending replacement cannot claim applied or permanent; applied cannot claim saved change", () => {
    const pendingAuth = {
      goal_change_confirmation_authorized: false,
      goal_change_apply_authorized: false,
      temporary_adjustment_confirmation_authorized: true,
      replaces_active_temporary_overlay: true,
      candidate_behavior_statement: REPLACEMENT,
      canonical_behavior_statement: CANONICAL,
      pending_state: "awaiting_confirmation" as const,
      previous_behavior_statement: null,
      previous_commitment_id: null,
      active_commitment_id: "cmt_angela",
      pending_cleared: false,
      temporary_last_included_local_date: "2026-09-13",
    };
    const ask = buildAuthorizedTemporaryConfirmationAsk(pendingAuth);
    expect(ask).toContain("switch the temporary target");
    expect(ask).not.toMatch(/going forward/i);
    expect(tryBuildAuthorizedGoalChangeWriterFailureFallback(pendingAuth)).toBe(ask);
    const blocked = applyGoalChangeMachineBodySafety({
      body: "Your goal is now 10:15.",
      authorization: pendingAuth,
    });
    expect(blocked.blocked).toBe(true);

    const appliedAuth = {
      ...pendingAuth,
      temporary_adjustment_confirmation_authorized: false,
      temporary_adjustment_apply_authorized: true,
      pending_state: null,
      pending_cleared: true,
      temporary_candidate_behavior_statement: REPLACEMENT,
    };
    const ack = buildAuthorizedTemporaryAppliedAck(appliedAuth);
    expect(ack).toMatch(/update the temporary target/i);
    expect(ack).toContain("Current Goal stays");
    const perm = applyGoalChangeMachineBodySafety({
      body: "Going forward, your goal is 10:15.",
      authorization: appliedAuth,
    });
    expect(perm.blocked).toBe(true);
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("replaces_active_temporary_overlay");
  });

  it("Q: production replace path has no inbound English parsers", () => {
    const files = [
      "src/lib/sol-goal-change-temporary-replace.ts",
      "src/lib/sol-goal-change-temporary-pending.ts",
      "src/lib/sol-goal-change-pending-open.ts",
      "src/lib/sol-goal-change-temporary-confirm.ts",
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      expect(src).not.toContain("parseSmsConfirmation");
      expect(src).not.toMatch(/\bextend\b.*\\b/);
      expect(src).not.toMatch(/through Friday/);
      expect(src).not.toMatch(/actually make it/);
      expect(src).not.toContain("modifies_active_temporary_overlay");
      expect(src).not.toContain("make this permanent");
      expect(src).not.toContain("keep this as my regular goal");
      expect(src).not.toContain("make the temporary one my real goal");
      expect(src).not.toContain("I want this going forward");
    }
    const slice3 = fs.readFileSync(
      path.join(process.cwd(), "src/lib/sol-goal-change-pending-confirm.ts"),
      "utf8"
    );
    expect(slice3).not.toContain("make this permanent");
    expect(slice3).not.toContain("keep this as my regular goal");
    expect(slice3).not.toContain("make the temporary one my real goal");
    expect(slice3).not.toContain("I want this going forward");
    expect(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT).toContain(
      "Member wants the live temporary overlay changed"
    );
    expect(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT).toContain("temporary_adjustment");
    expect(SOL_GOAL_CHANGE_SEMANTIC_INTERPRETER_SYSTEM_PROMPT).toContain(
      "copy overlay_behavior_statement into candidate_behavior_statement"
    );
  });

  it("N: leftover still skips tagged Sol temp including replacement marker", () => {
    const leftover = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-sms-pending-resolution-complete.ts"),
      "utf8"
    );
    expect(leftover).toContain("payload.sol_temporary_overlay === true");
    expect(leftover).toContain("return { handled: false }");
  });

  it("O: PI module is not imported by the replace primitive", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/sol-goal-change-temporary-replace.ts"),
      "utf8"
    );
    expect(src).not.toContain("planned-interruption");
    expect(src).not.toContain("sms-planned-interruption");
  });
});
