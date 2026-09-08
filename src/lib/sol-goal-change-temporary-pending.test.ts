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
import { getPendingResolutionOrNull } from "@/lib/v2-guided-resolution";
import {
  applyGoalChangeMachineBodySafety,
  tryBuildAuthorizedGoalChangeWriterFailureFallback,
} from "@/lib/sol-goal-change-confirmation-guard";
import * as durationMod from "@/lib/sol-goal-change-temporary-duration";

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

import { runSolGoalChangePendingOpenForInbound } from "@/lib/sol-goal-change-pending-open";
import { runSolGoalChangeAwaitingCandidateForInbound } from "@/lib/sol-goal-change-awaiting-candidate";
import {
  applySolTemporaryHallwayMerge,
  canPromoteSolTemporaryConfirmation,
  classifySolTemporaryPendingMode,
  freezeTemporaryDurationFromSemantic,
  frozenDurationFromExistingPayload,
  isSolOwnedTemporaryOverlayPending,
  normalizeSemanticTemporaryCandidate,
  resolveSolTemporaryHallwayFrozenDuration,
  runSolTemporaryOverlayHoldingForInbound,
  shouldAttemptSolTemporaryPendingOpen,
  temporaryConfirmationAuthorizationFromReloadedCommitment,
} from "@/lib/sol-goal-change-temporary-pending";

const CANONICAL = "I will be in bed by 9:30 pm nightly.";
const CANDIDATE = "I will be in bed by 10:30 pm nightly.";
const NY = "America/New_York";
const NOW = new Date("2026-09-07T16:00:00.000Z");

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
    updated_at: "2026-09-07T12:00:00.000Z",
    started_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function withPending(
  row: ActiveV2CommitmentRow,
  payload: Record<string, unknown>,
  kind: ActiveV2CommitmentRow["pending_resolution_kind"] = "commitment_tighten"
): ActiveV2CommitmentRow {
  return {
    ...row,
    pending_resolution_kind: kind,
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
      intent: "temporary_adjustment",
      candidate_behavior_statement: "10:30",
      needs_clarification: false,
      requires_confirmation: true,
      confirms_existing_pending: false,
      rejects_existing_pending: false,
      modifies_existing_pending_candidate: false,
      member_meaning_summary: "temporary 10:30",
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
  return { ok: true as const, result, error: null, capture: { retry_occurred: false } };
}

function weekExpiry() {
  return resolveTemporaryOverlayExpiry({
    temporary_duration_kind: "local_week",
    temporary_duration_days: null,
    temporary_weekday: null,
    temporary_end_local_date: null,
    timezone: NY,
    now: NOW,
  });
}

function tempPayload(overrides: Record<string, unknown> = {}) {
  const week = weekExpiry();
  return {
    source: "sms_inbound",
    sms_state: "awaiting_confirmation",
    detected_intent: "sms_tighten_request",
    sol_temporary_overlay: true,
    candidate_behavior_statement: CANDIDATE,
    candidate_tightened_bar: CANDIDATE,
    inbound_message_sid: "SMtemp",
    raw_user_text: "This week, make it 10:30.",
    temporary_duration_kind: "local_week",
    temporary_duration_days: null,
    temporary_weekday: null,
    temporary_end_local_date: null,
    temporary_expires_at: week.expires_at_utc,
    temporary_last_included_local_date: week.last_included_local_date,
    canonical_behavior_snapshot: CANONICAL,
    temporary_interpreted_local_date: "2026-09-07",
    temporary_interpreted_at: NOW.toISOString(),
    ...overrides,
  };
}

describe("Slice 7B helpers", () => {
  it("opens temp pending only for temporary_adjustment without pending-mutation flags", () => {
    expect(shouldAttemptSolTemporaryPendingOpen(semantic())).toBe(true);
    expect(
      shouldAttemptSolTemporaryPendingOpen(semantic({ intent: "saved_replace" }))
    ).toBe(false);
    expect(
      shouldAttemptSolTemporaryPendingOpen(semantic({ confirms_existing_pending: true }))
    ).toBe(false);
  });

  it("normalizes a clock candidate into the canonical sentence", () => {
    expect(
      normalizeSemanticTemporaryCandidate({
        semanticCandidate: "10:30",
        canonicalBehaviorStatement: CANONICAL,
      })
    ).toEqual({ ok: true, candidate: CANDIDATE });
  });

  it("freezes local_week expiry at the original turn", () => {
    const frozen = freezeTemporaryDurationFromSemantic({
      semantic: semantic({ temporary_duration_kind: "local_week" }),
      timezone: NY,
      now: NOW,
    });
    const week = weekExpiry();
    expect(frozen.resolver_threw).toBe(false);
    expect(frozen.frozen.duration_supported).toBe(true);
    expect(frozen.frozen.temporary_expires_at).toBe(week.expires_at_utc);
    expect(frozen.frozen.temporary_last_included_local_date).toBe(week.last_included_local_date);
    expect(frozen.frozen.temporary_interpreted_local_date).toBe("2026-09-07");
  });

  it("unspecified duration never defaults to 7 days", () => {
    const frozen = freezeTemporaryDurationFromSemantic({
      semantic: semantic({ temporary_duration_kind: "unspecified" }),
      timezone: NY,
      now: NOW,
    });
    expect(frozen.resolver_threw).toBe(false);
    expect(frozen.frozen.duration_supported).toBe(false);
    expect(frozen.frozen.duration_clarification_required).toBe(true);
    expect(frozen.frozen.temporary_expires_at).toBeNull();
    expect(
      classifySolTemporaryPendingMode({
        candidate: CANDIDATE,
        frozen: frozen.frozen,
        nowMs: NOW.getTime(),
        liveCanonical: CANONICAL,
      })
    ).toBe("duration_clarification");
  });
});

describe("Slice 7B pending-open", () => {
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
    mergeSmsPendingResolutionPayload.mockResolvedValue({
      ok: true,
      updatedAt: base.updated_at,
    });
    clearPendingResolution.mockResolvedValue(undefined);
  });

  async function run(
    overrides: Partial<Parameters<typeof runSolGoalChangePendingOpenForInbound>[0]> = {}
  ) {
    return runSolGoalChangePendingOpenForInbound({
      clerkUserId: "user_angela",
      commitment: base,
      inboundRaw: "This week, make it 10:30.",
      messageSid: "SMtemp",
      plannedInterruptionKnown: false,
      timezone: NY,
      now: NOW,
      ...overrides,
    });
  }

  it("complete candidate + supported duration → awaiting_confirmation with frozen expiry", async () => {
    const week = weekExpiry();
    const reloaded = withPending(base, tempPayload());
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ temporary_duration_kind: "local_week" }))
    );
    getActiveCommitment.mockResolvedValueOnce(base).mockResolvedValue(reloaded);
    const r = await run();
    expect(r.authorization.temporary_adjustment_confirmation_authorized).toBe(true);
    expect(r.authorization.goal_change_confirmation_authorized).toBe(false);
    expect(r.authorization.goal_change_apply_authorized).toBe(false);
    expect(r.authorization.pending_state).toBe("awaiting_confirmation");
    expect(r.authorization.candidate_behavior_statement).toBe(CANDIDATE);
    expect(r.authorization.canonical_behavior_statement).toBe(CANONICAL);
    expect(r.authorization.temporary_expires_at).toBe(week.expires_at_utc);
    expect(r.authorization.temporary_last_included_local_date).toBe(
      week.last_included_local_date
    );
    expect(r.forensics.reload_authorized).toBe(true);
    expect(applyWave4SmsCommitmentPendingResolution.mock.calls[0]?.[0]?.intentPack).toMatchObject({
      intent: "sms_tighten_request",
    });
    expect(applyWave4SmsCommitmentPendingResolution.mock.calls[0]?.[0]?.solTemporaryOverlay).toBe(
      true
    );
    expect(mergeSmsPendingResolutionPayload).toHaveBeenCalled();
    const parsed = getPendingResolutionOrNull(reloaded);
    expect(parsed?.kind).toBe("commitment_tighten");
    expect(parsed?.payload && parsed.payload.source === "sms_inbound"
      ? parsed.payload.sol_temporary_overlay
      : null).toBe(true);
    expect(parsed?.payload && parsed.payload.source === "sms_inbound"
      ? parsed.payload.canonical_behavior_snapshot
      : null).toBe(CANONICAL);
  });

  it("missing candidate + local_week → awaiting_candidate with duration frozen now", async () => {
    const week = weekExpiry();
    const reloaded = withPending(
      base,
      tempPayload({
        sms_state: "awaiting_candidate",
        candidate_behavior_statement: null,
        candidate_tightened_bar: null,
      })
    );
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          candidate_behavior_statement: null,
          temporary_duration_kind: "local_week",
        })
      )
    );
    getActiveCommitment.mockResolvedValueOnce(base).mockResolvedValue(reloaded);
    const r = await run({ inboundRaw: "Make my goal easier this week." });
    expect(r.authorization.temporary_adjustment_confirmation_authorized).not.toBe(true);
    expect(r.authorization.pending_state).toBe("awaiting_candidate");
    expect(r.authorization.temporary_expires_at).toBe(week.expires_at_utc);
    expect(r.forensics.hallway_opened).toBe(true);
    const mergeFn = mergeSmsPendingResolutionPayload.mock.calls[0]?.[0]?.merge;
    expect(typeof mergeFn).toBe("function");
    if (typeof mergeFn === "function") {
      const merged = mergeFn({
        source: "sms_inbound",
        detected_intent: "sms_tighten_request",
        raw_user_text: "x",
        inbound_message_sid: "SMtemp",
        ai_confidence: null,
      });
      expect(merged.sms_state).toBe("awaiting_candidate");
      expect(merged.temporary_expires_at).toBe(week.expires_at_utc);
      expect(merged.temporary_interpreted_local_date).toBe("2026-09-07");
    }
  });

  it("open-ended duration never writes confirmable pending or 7-day default", async () => {
    const reloaded = withPending(
      base,
      tempPayload({
        sms_state: "awaiting_candidate",
        temporary_duration_kind: "unspecified",
        temporary_expires_at: null,
        temporary_last_included_local_date: null,
      })
    );
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ temporary_duration_kind: "unspecified" }))
    );
    getActiveCommitment.mockResolvedValueOnce(base).mockResolvedValue(reloaded);
    const r = await run({ inboundRaw: "For now, 10:30." });
    expect(r.authorization.temporary_adjustment_confirmation_authorized).not.toBe(true);
    expect(r.authorization.duration_clarification_required).toBe(true);
    expect(r.authorization.pending_state).toBe("awaiting_candidate");
    const mergeFn = mergeSmsPendingResolutionPayload.mock.calls[0]?.[0]?.merge;
    if (typeof mergeFn === "function") {
      const merged = mergeFn({
        source: "sms_inbound",
        detected_intent: "sms_tighten_request",
        raw_user_text: "x",
        inbound_message_sid: "SMtemp",
        ai_confidence: null,
      });
      expect(merged.sms_state).toBe("awaiting_candidate");
      expect(merged.temporary_expires_at).toBeNull();
      expect(merged.temporary_duration_kind).toBe("unspecified");
    }
  });

  it("temp confirmation auth is false when reload lacks the Sol overlay marker", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ temporary_duration_kind: "local_week" }))
    );
    getActiveCommitment.mockResolvedValue(base);
    const r = await run();
    expect(r.authorization.temporary_adjustment_confirmation_authorized).not.toBe(true);
    expect(r.forensics.reload_authorized).toBe(false);
  });

  it("canonical snapshot mismatch on reload fails closed", async () => {
    const reloaded = withPending(commitment({ behavior_statement: "Walk daily." }), tempPayload());
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ temporary_duration_kind: "local_week" }))
    );
    getActiveCommitment.mockResolvedValueOnce(base).mockResolvedValue(reloaded);
    const r = await run();
    expect(r.authorization.temporary_adjustment_confirmation_authorized).not.toBe(true);
    expect(r.forensics.pending_skip_reason).toBe("canonical_changed_before_reload");
  });

  it("pending write failure does not authorize confirmation", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ temporary_duration_kind: "local_week" }))
    );
    applyWave4SmsCommitmentPendingResolution.mockRejectedValue(new Error("cas_mismatch"));
    const r = await run();
    expect(r.authorization.temporary_adjustment_confirmation_authorized).not.toBe(true);
    expect(r.forensics.pending_write_applied).toBe(false);
    expect(mergeSmsPendingResolutionPayload).not.toHaveBeenCalled();
  });

  it("payload merge failure still tagged the initial Wave4 write before clear", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ temporary_duration_kind: "local_week" }))
    );
    mergeSmsPendingResolutionPayload.mockResolvedValue({ ok: false, error: "cas_mismatch" });
    getActiveCommitment.mockResolvedValue(base);
    const r = await run();
    expect(applyWave4SmsCommitmentPendingResolution.mock.calls[0]?.[0]?.solTemporaryOverlay).toBe(
      true
    );
    expect(clearPendingResolution).toHaveBeenCalled();
    expect(r.authorization.temporary_adjustment_confirmation_authorized).not.toBe(true);
    expect(r.forensics.pending_write_applied).toBe(false);
  });

  it("merge failure + clear failure still passed the Sol-temp ownership flag to Wave4", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ temporary_duration_kind: "local_week" }))
    );
    mergeSmsPendingResolutionPayload.mockResolvedValue({ ok: false, error: "cas_mismatch" });
    clearPendingResolution.mockRejectedValue(new Error("clear_failed"));
    getActiveCommitment.mockResolvedValue(base);
    const r = await run();
    expect(applyWave4SmsCommitmentPendingResolution.mock.calls[0]?.[0]?.solTemporaryOverlay).toBe(
      true
    );
    expect(r.authorization.temporary_adjustment_confirmation_authorized).not.toBe(true);
  });

  it("resolver throw does not persist user-facing duration clarification pending", async () => {
    const spy = vi.spyOn(durationMod, "resolveTemporaryOverlayExpiry").mockImplementation(() => {
      throw new Error("resolver_boom");
    });
    try {
      runSolGoalChangeSemanticInterpreter.mockResolvedValue(
        interpreterOk(semantic({ temporary_duration_kind: "local_week" }))
      );
      getActiveCommitment.mockResolvedValue(base);
      const r = await run();
      expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
      expect(mergeSmsPendingResolutionPayload).not.toHaveBeenCalled();
      expect(r.authorization.temporary_adjustment_confirmation_authorized).not.toBe(true);
      expect(r.authorization.duration_clarification_required).not.toBe(true);
      expect(r.authorization.pending_state).toBeNull();
      expect(r.forensics.pending_skip_reason).toBe("temporary_duration_resolver_threw");
      expect(r.forensics.pending_write_applied).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("active overlay blocks a second temp pending", async () => {
    const overlaid = commitment({
      adaptive_ask_text: "Be in bed by 11:00 pm tonight.",
      adaptive_ask_expires_at: "2099-01-01T00:00:00.000Z",
    });
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ temporary_duration_kind: "local_week" }))
    );
    getActiveCommitment.mockResolvedValue(overlaid);
    const r = await run({ commitment: overlaid });
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
    expect(r.forensics.pending_skip_reason).toBe("active_overlay_blocks_temporary_pending");
    expect(r.authorization.temporary_adjustment_confirmation_authorized).not.toBe(true);
  });

  it("active overlay does not block saved replace", async () => {
    const overlaid = commitment({
      adaptive_ask_text: "Be in bed by 11:00 pm tonight.",
      adaptive_ask_expires_at: "2099-01-01T00:00:00.000Z",
    });
    const saved = withPending(
      overlaid,
      {
        source: "sms_inbound",
        sms_state: "awaiting_confirmation",
        detected_intent: "sms_replace_request",
        candidate_behavior_statement: CANDIDATE,
        candidate_new_bar: CANDIDATE,
        inbound_message_sid: "SMsaved",
        raw_user_text: "Going forward, make it 10:30.",
      },
      "commitment_replace"
    );
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ intent: "saved_replace", temporary_duration_kind: "unspecified" }))
    );
    applyWave4SmsCommitmentPendingResolution.mockResolvedValue({
      pendingApplied: true,
      pendingKind: "commitment_replace",
      skipReason: null,
    });
    getActiveCommitment
      .mockResolvedValueOnce(overlaid)
      .mockResolvedValueOnce(
        withPending(
          overlaid,
          {
            source: "sms_inbound",
            sms_state: "awaiting_candidate",
            detected_intent: "sms_replace_request",
            candidate_new_bar: CANDIDATE,
            inbound_message_sid: "SMsaved",
            raw_user_text: "Going forward, make it 10:30.",
          },
          "commitment_replace"
        )
      )
      .mockResolvedValue(saved);
    const r = await run({
      commitment: overlaid,
      inboundRaw: "Going forward, make it 10:30.",
    });
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
    expect(applyWave4SmsCommitmentPendingResolution.mock.calls[0]?.[0]?.intentPack).toMatchObject({
      intent: "sms_replace_request",
    });
  });

  it("existing saved pending is not overwritten by temp intent", async () => {
    const existing = withPending(
      base,
      {
        source: "sms_inbound",
        sms_state: "awaiting_confirmation",
        detected_intent: "sms_replace_request",
        candidate_behavior_statement: CANDIDATE,
        candidate_new_bar: CANDIDATE,
        inbound_message_sid: "SMprior",
        raw_user_text: "Going forward, make it 10:30.",
      },
      "commitment_replace"
    );
    getActiveCommitment.mockResolvedValue(existing);
    const r = await run({ commitment: existing });
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
    expect(runSolGoalChangeSemanticInterpreter).not.toHaveBeenCalled();
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
    expect(r.forensics.pending_skip_reason).toBe("existing_pending");
  });

  it("existing leftover tighten is not overwritten", async () => {
    const existing = withPending(base, {
      source: "sms_inbound",
      sms_state: "awaiting_confirmation",
      detected_intent: "sms_tighten_request",
      candidate_tightened_bar: "Walk 10 minutes after dinner",
      inbound_message_sid: "SMlegacy",
      raw_user_text: "make it smaller",
    });
    getActiveCommitment.mockResolvedValue(existing);
    const r = await run({ commitment: existing });
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
    expect(r.forensics.pending_skip_reason).toBe("existing_pending_not_confirmable");
  });

  it("duplicate inbound SID returns existing temp pending without a second write", async () => {
    const existing = withPending(base, tempPayload());
    getActiveCommitment.mockResolvedValue(existing);
    const r = await run({ commitment: existing, messageSid: "SMtemp" });
    expect(applyWave4SmsCommitmentPendingResolution).not.toHaveBeenCalled();
    expect(r.authorization.temporary_adjustment_confirmation_authorized).toBe(true);
    expect(r.forensics.pending_skip_reason).toBe("existing_pending");
  });

  it("PI may coexist with temp pending-open", async () => {
    const reloaded = withPending(base, tempPayload());
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          temporary_duration_kind: "local_week",
          concurrent: { planned_interruption: true },
        })
      )
    );
    getActiveCommitment.mockResolvedValueOnce(base).mockResolvedValue(reloaded);
    const r = await run({ plannedInterruptionKnown: true });
    expect(r.authorization.temporary_adjustment_confirmation_authorized).toBe(true);
  });

  it("saved_replace first-turn still uses the saved path", async () => {
    const saved = withPending(
      base,
      {
        source: "sms_inbound",
        sms_state: "awaiting_confirmation",
        detected_intent: "sms_replace_request",
        candidate_behavior_statement: CANDIDATE,
        candidate_new_bar: CANDIDATE,
        inbound_message_sid: "SMtemp",
        raw_user_text: "Going forward, make it 10:30.",
      },
      "commitment_replace"
    );
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ intent: "saved_replace" }))
    );
    applyWave4SmsCommitmentPendingResolution.mockResolvedValue({
      pendingApplied: true,
      pendingKind: "commitment_replace",
      skipReason: null,
    });
    getActiveCommitment
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(
        withPending(
          base,
          {
            source: "sms_inbound",
            sms_state: "awaiting_candidate",
            detected_intent: "sms_replace_request",
            candidate_new_bar: CANDIDATE,
            inbound_message_sid: "SMtemp",
            raw_user_text: "Going forward, make it 10:30.",
          },
          "commitment_replace"
        )
      )
      .mockResolvedValue(saved);
    const r = await run({ inboundRaw: "Going forward, make it 10:30." });
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
    expect(r.authorization.temporary_adjustment_confirmation_authorized).toBeUndefined();
  });
});

describe("Slice 7B traces (Sol structured result owns the branch)", () => {
  const base = commitment();
  const week = weekExpiry();

  beforeEach(() => {
    getActiveCommitment.mockReset();
    recomputeV2CoachingMemory.mockReset().mockResolvedValue(undefined);
    applyWave4SmsCommitmentPendingResolution.mockReset().mockResolvedValue({
      pendingApplied: true,
      pendingKind: "commitment_tighten",
      skipReason: null,
    });
    bootstrapSmsPendingConfirmationFromInbound.mockReset().mockResolvedValue({
      promoted: false,
      candidate: null,
      skipReason: "sol_owned_awaiting_candidate_shell",
    });
    mergeSmsPendingResolutionPayload.mockReset().mockResolvedValue({
      ok: true,
      updatedAt: base.updated_at,
    });
    runSolGoalChangeSemanticInterpreter.mockReset();
  });

  async function runTrace(
    inbound: string,
    result: SolGoalChangeSemanticResult,
    reloaded: ActiveV2CommitmentRow
  ) {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(interpreterOk(result));
    getActiveCommitment.mockResolvedValueOnce(base).mockResolvedValue(reloaded);
    return runSolGoalChangePendingOpenForInbound({
      clerkUserId: "user_angela",
      commitment: base,
      inboundRaw: inbound,
      messageSid: "SMtrace",
      plannedInterruptionKnown: false,
      timezone: NY,
      now: NOW,
    });
  }

  const confirmRow = withPending(base, tempPayload({ inbound_message_sid: "SMtrace" }));
  const clarifyRow = withPending(
    base,
    tempPayload({
      inbound_message_sid: "SMtrace",
      sms_state: "awaiting_candidate",
      temporary_duration_kind: "unspecified",
      temporary_expires_at: null,
      temporary_last_included_local_date: null,
    })
  );
  const missingCandRow = withPending(
    base,
    tempPayload({
      inbound_message_sid: "SMtrace",
      sms_state: "awaiting_candidate",
      candidate_behavior_statement: null,
      candidate_tightened_bar: null,
    })
  );

  it.each([
    ["1. This week, make it 10:30.", semantic({ temporary_duration_kind: "local_week" }), confirmRow, "temp_confirm"],
    [
      "2. Just tonight, 10:30.",
      semantic({ temporary_duration_kind: "remaining_local_day" }),
      withPending(
        base,
        tempPayload({
          inbound_message_sid: "SMtrace",
          temporary_duration_kind: "remaining_local_day",
          temporary_expires_at: resolveTemporaryOverlayExpiry({
            temporary_duration_kind: "remaining_local_day",
            temporary_duration_days: null,
            temporary_weekday: null,
            temporary_end_local_date: null,
            timezone: NY,
            now: NOW,
          }).expires_at_utc,
          temporary_last_included_local_date: "2026-09-07",
        })
      ),
      "temp_confirm",
    ],
    [
      "3. For the next 3 days, 10:30.",
      semantic({ temporary_duration_kind: "days", temporary_duration_days: 3 }),
      withPending(
        base,
        tempPayload({
          inbound_message_sid: "SMtrace",
          temporary_duration_kind: "days",
          temporary_duration_days: 3,
          temporary_expires_at: resolveTemporaryOverlayExpiry({
            temporary_duration_kind: "days",
            temporary_duration_days: 3,
            temporary_weekday: null,
            temporary_end_local_date: null,
            timezone: NY,
            now: NOW,
          }).expires_at_utc,
          temporary_last_included_local_date: resolveTemporaryOverlayExpiry({
            temporary_duration_kind: "days",
            temporary_duration_days: 3,
            temporary_weekday: null,
            temporary_end_local_date: null,
            timezone: NY,
            now: NOW,
          }).last_included_local_date,
        })
      ),
      "temp_confirm",
    ],
    [
      "4. Through Friday, 10:30.",
      semantic({ temporary_duration_kind: "through_weekday", temporary_weekday: "friday" }),
      withPending(
        base,
        tempPayload({
          inbound_message_sid: "SMtrace",
          temporary_duration_kind: "through_weekday",
          temporary_weekday: "friday",
          temporary_expires_at: resolveTemporaryOverlayExpiry({
            temporary_duration_kind: "through_weekday",
            temporary_duration_days: null,
            temporary_weekday: "friday",
            temporary_end_local_date: null,
            timezone: NY,
            now: NOW,
          }).expires_at_utc,
          temporary_last_included_local_date: resolveTemporaryOverlayExpiry({
            temporary_duration_kind: "through_weekday",
            temporary_duration_days: null,
            temporary_weekday: "friday",
            temporary_end_local_date: null,
            timezone: NY,
            now: NOW,
          }).last_included_local_date,
        })
      ),
      "temp_confirm",
    ],
    [
      "5. Until Friday, 10:30.",
      semantic({ temporary_duration_kind: "until_weekday", temporary_weekday: "friday" }),
      withPending(
        base,
        tempPayload({
          inbound_message_sid: "SMtrace",
          temporary_duration_kind: "until_weekday",
          temporary_weekday: "friday",
          temporary_expires_at: resolveTemporaryOverlayExpiry({
            temporary_duration_kind: "until_weekday",
            temporary_duration_days: null,
            temporary_weekday: "friday",
            temporary_end_local_date: null,
            timezone: NY,
            now: NOW,
          }).expires_at_utc,
          temporary_last_included_local_date: resolveTemporaryOverlayExpiry({
            temporary_duration_kind: "until_weekday",
            temporary_duration_days: null,
            temporary_weekday: "friday",
            temporary_end_local_date: null,
            timezone: NY,
            now: NOW,
          }).last_included_local_date,
        })
      ),
      "temp_confirm",
    ],
    ["6. For now, 10:30.", semantic({ temporary_duration_kind: "unspecified" }), clarifyRow, "temp_clarify"],
    [
      "7. While I’m traveling, 10:30.",
      semantic({ temporary_duration_kind: "unspecified" }),
      clarifyRow,
      "temp_clarify",
    ],
    [
      "8. Make it easier this week.",
      semantic({
        candidate_behavior_statement: null,
        temporary_duration_kind: "local_week",
      }),
      missingCandRow,
      "temp_candidate",
    ],
    [
      "9. Make it harder this week.",
      semantic({
        candidate_behavior_statement: null,
        temporary_duration_kind: "local_week",
      }),
      missingCandRow,
      "temp_candidate",
    ],
  ] as const)("%s", async (_inbound, result, row, branch) => {
    const r = await runTrace(_inbound, result, row);
    expect(r.authorization.goal_change_confirmation_authorized).toBe(false);
    if (branch === "temp_confirm") {
      expect(r.authorization.temporary_adjustment_confirmation_authorized).toBe(true);
    } else {
      expect(r.authorization.temporary_adjustment_confirmation_authorized).not.toBe(true);
      expect(r.authorization.pending_state).toBe("awaiting_candidate");
    }
    expect(applyWave4SmsCommitmentPendingResolution.mock.calls[0]?.[0]?.intentPack.intent).toBe(
      "sms_tighten_request"
    );
    void week;
  });

  it("10. Going forward, make it 10:30. stays on saved replace", async () => {
    const saved = withPending(
      base,
      {
        source: "sms_inbound",
        sms_state: "awaiting_confirmation",
        detected_intent: "sms_replace_request",
        candidate_behavior_statement: CANDIDATE,
        candidate_new_bar: CANDIDATE,
        inbound_message_sid: "SMtrace",
        raw_user_text: "Going forward, make it 10:30.",
      },
      "commitment_replace"
    );
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ intent: "saved_replace" }))
    );
    applyWave4SmsCommitmentPendingResolution.mockResolvedValue({
      pendingApplied: true,
      pendingKind: "commitment_replace",
      skipReason: null,
    });
    getActiveCommitment
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(
        withPending(
          base,
          {
            source: "sms_inbound",
            sms_state: "awaiting_candidate",
            detected_intent: "sms_replace_request",
            candidate_new_bar: CANDIDATE,
            inbound_message_sid: "SMtrace",
            raw_user_text: "Going forward, make it 10:30.",
          },
          "commitment_replace"
        )
      )
      .mockResolvedValue(saved);
    const r = await runSolGoalChangePendingOpenForInbound({
      clerkUserId: "user_angela",
      commitment: base,
      inboundRaw: "Going forward, make it 10:30.",
      messageSid: "SMtrace",
      plannedInterruptionKnown: false,
      timezone: NY,
      now: NOW,
    });
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
    expect(applyWave4SmsCommitmentPendingResolution.mock.calls[0]?.[0]?.intentPack.intent).toBe(
      "sms_replace_request"
    );
  });
});

describe("Slice 7B Turn-2 hallway temporal binding", () => {
  const base = commitment();
  const week = weekExpiry();
  const hallwayRow = withPending(
    base,
    tempPayload({
      sms_state: "awaiting_candidate",
      candidate_behavior_statement: null,
      candidate_tightened_bar: null,
    })
  );

  beforeEach(() => {
    getActiveCommitment.mockReset();
    recomputeV2CoachingMemory.mockReset().mockResolvedValue(undefined);
    mergeSmsPendingResolutionPayload.mockReset().mockResolvedValue({
      ok: true,
      updatedAt: base.updated_at,
    });
    runSolGoalChangeSemanticInterpreter.mockReset();
    clearPendingResolution.mockReset().mockResolvedValue(undefined);
  });

  it("Turn 2 10:30 keeps frozen this-week expiry and does not recompute", async () => {
    const staged = withPending(base, tempPayload());
    getActiveCommitment.mockResolvedValueOnce(hallwayRow).mockResolvedValue(staged);
    const r = await runSolGoalChangeAwaitingCandidateForInbound({
      clerkUserId: "user_angela",
      commitment: hallwayRow,
      inboundRaw: "10:30",
      messageSid: "SMturn2",
      timezone: NY,
      now: new Date("2026-09-08T16:00:00.000Z"),
    });
    expect(r.handled).toBe(true);
    expect(r.consequence).toBe("staged");
    const mergeFn = mergeSmsPendingResolutionPayload.mock.calls[0]?.[0]?.merge;
    expect(typeof mergeFn).toBe("function");
    if (typeof mergeFn === "function") {
      const merged = mergeFn(hallwayRow.pending_resolution_payload as never);
      expect(merged.temporary_expires_at).toBe(week.expires_at_utc);
      expect(merged.temporary_interpreted_local_date).toBe("2026-09-07");
      expect(merged.sms_state).toBe("awaiting_confirmation");
      expect(merged.candidate_behavior_statement).toBe(CANDIDATE);
    }
  });
});

const CANDIDATE_1015 = "I will be in bed by 10:15 pm nightly.";
const DURATION_LATER_START = {
  sms_state: "awaiting_candidate",
  candidate_behavior_statement: CANDIDATE,
  candidate_tightened_bar: CANDIDATE,
  temporary_duration_kind: "unspecified",
  temporary_duration_days: null,
  temporary_weekday: null,
  temporary_end_local_date: null,
  temporary_expires_at: null,
  temporary_last_included_local_date: null,
} as const;

const OWNERSHIP_INBOUNDS = [
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
] as const;

describe("Slice 7B correction — duration-later structured Sol merge", () => {
  const base = commitment();
  const tuesday = new Date("2026-09-08T16:00:00.000Z");
  const startRow = withPending(base, tempPayload(DURATION_LATER_START));

  beforeEach(() => {
    getActiveCommitment.mockReset();
    recomputeV2CoachingMemory.mockReset().mockResolvedValue(undefined);
    mergeSmsPendingResolutionPayload.mockReset().mockResolvedValue({
      ok: true,
      updatedAt: base.updated_at,
    });
    runSolGoalChangeSemanticInterpreter.mockReset();
    clearPendingResolution.mockReset().mockResolvedValue(undefined);
  });

  async function runDurationLater(result: SolGoalChangeSemanticResult, inbound: string) {
    const staged = withPending(base, tempPayload());
    getActiveCommitment.mockResolvedValueOnce(startRow).mockResolvedValue(staged);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(interpreterOk(result));
    return runSolGoalChangeAwaitingCandidateForInbound({
      clerkUserId: "user_angela",
      commitment: startRow,
      inboundRaw: inbound,
      messageSid: "SMdur2",
      timezone: NY,
      now: tuesday,
    });
  }

  function expectMergedDuration(kind: string, extra: Record<string, unknown> = {}) {
    const mergeFn = mergeSmsPendingResolutionPayload.mock.calls[0]?.[0]?.merge;
    expect(typeof mergeFn).toBe("function");
    if (typeof mergeFn !== "function") return;
    const merged = mergeFn(startRow.pending_resolution_payload as never);
    const expected = resolveTemporaryOverlayExpiry({
      temporary_duration_kind: kind as never,
      temporary_duration_days: (extra.temporary_duration_days as number | null) ?? null,
      temporary_weekday: (extra.temporary_weekday as never) ?? null,
      temporary_end_local_date: null,
      timezone: NY,
      now: tuesday,
    });
    expect(merged.candidate_behavior_statement).toBe(CANDIDATE);
    expect(merged.temporary_duration_kind).toBe(kind);
    expect(merged.temporary_expires_at).toBe(expected.expires_at_utc);
    expect(merged.temporary_interpreted_at).toBe(tuesday.toISOString());
    expect(merged.sms_state).toBe("awaiting_confirmation");
    expect(merged.sol_temporary_overlay).toBe(true);
  }

  it("1. through Friday merges through_weekday using turn-2 now", async () => {
    const r = await runDurationLater(
      semantic({
        candidate_behavior_statement: null,
        temporary_duration_kind: "through_weekday",
        temporary_weekday: "friday",
      }),
      "Through Friday."
    );
    expect(r.handled).toBe(true);
    expectMergedDuration("through_weekday", { temporary_weekday: "friday" });
  });

  it("2. until Friday merges until_weekday using turn-2 now", async () => {
    const r = await runDurationLater(
      semantic({
        candidate_behavior_statement: null,
        temporary_duration_kind: "until_weekday",
        temporary_weekday: "friday",
      }),
      "Until Friday."
    );
    expect(r.handled).toBe(true);
    expectMergedDuration("until_weekday", { temporary_weekday: "friday" });
  });

  it("3. three days merges days=3 using turn-2 now", async () => {
    const r = await runDurationLater(
      semantic({
        candidate_behavior_statement: null,
        temporary_duration_kind: "days",
        temporary_duration_days: 3,
      }),
      "Three days."
    );
    expect(r.handled).toBe(true);
    expectMergedDuration("days", { temporary_duration_days: 3 });
  });

  it("4. this week merges local_week using turn-2 now", async () => {
    const r = await runDurationLater(
      semantic({
        candidate_behavior_statement: null,
        temporary_duration_kind: "local_week",
      }),
      "This week."
    );
    expect(r.handled).toBe(true);
    expectMergedDuration("local_week");
  });

  it("5. tonight merges remaining_local_day using turn-2 now", async () => {
    const r = await runDurationLater(
      semantic({
        candidate_behavior_statement: null,
        temporary_duration_kind: "remaining_local_day",
      }),
      "Tonight."
    );
    expect(r.handled).toBe(true);
    expectMergedDuration("remaining_local_day");
  });

  it("6. invalid/open-ended unspecified does not invent a 7-day window", async () => {
    getActiveCommitment.mockReset();
    getActiveCommitment.mockResolvedValue(startRow);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          candidate_behavior_statement: null,
          temporary_duration_kind: "unspecified",
          needs_clarification: true,
        })
      )
    );
    const r = await runSolGoalChangeAwaitingCandidateForInbound({
      clerkUserId: "user_angela",
      commitment: startRow,
      inboundRaw: "For a while.",
      messageSid: "SMdur2",
      timezone: NY,
      now: tuesday,
    });
    expect(r.handled).toBe(true);
    expect(r.consequence).toBe("stay_hallway");
    expect(mergeSmsPendingResolutionPayload).not.toHaveBeenCalled();
    expect(r.authorization.temporary_adjustment_confirmation_authorized).not.toBe(true);
    expect(r.authorization.duration_clarification_required).toBe(true);
  });

  it("7. never mind with structured reject clears pending", async () => {
    getActiveCommitment.mockResolvedValue(startRow);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          candidate_behavior_statement: null,
          rejects_existing_pending: true,
          temporary_duration_kind: "unspecified",
        })
      )
    );
    const r = await runSolGoalChangeAwaitingCandidateForInbound({
      clerkUserId: "user_angela",
      commitment: startRow,
      inboundRaw: "Never mind",
      messageSid: "SMdur2",
      timezone: NY,
      now: tuesday,
    });
    expect(r.handled).toBe(true);
    expect(r.consequence).toBe("rejected");
    expect(clearPendingResolution).toHaveBeenCalled();
  });

  it("8. candidate modification only preserves unspecified duration", async () => {
    const staged = withPending(
      base,
      tempPayload({
        ...DURATION_LATER_START,
        candidate_behavior_statement: CANDIDATE_1015,
        candidate_tightened_bar: CANDIDATE_1015,
      })
    );
    getActiveCommitment.mockResolvedValueOnce(startRow).mockResolvedValue(staged);
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          candidate_behavior_statement: "10:15",
          modifies_existing_pending_candidate: true,
          temporary_duration_kind: "unspecified",
        })
      )
    );
    const r = await runSolGoalChangeAwaitingCandidateForInbound({
      clerkUserId: "user_angela",
      commitment: startRow,
      inboundRaw: "Actually make it 10:15",
      messageSid: "SMdur2",
      timezone: NY,
      now: tuesday,
    });
    expect(r.handled).toBe(true);
    const mergeFn = mergeSmsPendingResolutionPayload.mock.calls[0]?.[0]?.merge;
    expect(typeof mergeFn).toBe("function");
    if (typeof mergeFn === "function") {
      const merged = mergeFn(startRow.pending_resolution_payload as never);
      expect(merged.candidate_behavior_statement).toBe(CANDIDATE_1015);
      expect(merged.temporary_duration_kind).toBe("unspecified");
      expect(merged.temporary_expires_at).toBeNull();
      expect(merged.sms_state).toBe("awaiting_candidate");
    }
  });
});

describe("Slice 7B correction — temporal binding + future-expiry gate", () => {
  const base = commitment();

  it("A. Monday duration-known / Tuesday candidate preserves Monday frozen expiry", () => {
    const monday = NOW;
    const tuesday = new Date("2026-09-08T16:00:00.000Z");
    const mondayFrozen = freezeTemporaryDurationFromSemantic({
      semantic: semantic({
        candidate_behavior_statement: null,
        temporary_duration_kind: "local_week",
      }),
      timezone: NY,
      now: monday,
    }).frozen;
    const prev = tempPayload({
      sms_state: "awaiting_candidate",
      candidate_behavior_statement: null,
      candidate_tightened_bar: null,
      temporary_expires_at: mondayFrozen.temporary_expires_at,
      temporary_interpreted_local_date: mondayFrozen.temporary_interpreted_local_date,
      temporary_interpreted_at: mondayFrozen.temporary_interpreted_at,
    });
    const resolved = resolveSolTemporaryHallwayFrozenDuration({
      prev: prev as never,
      semantic: semantic({
        candidate_behavior_statement: "10:30",
        temporary_duration_kind: "local_week",
      }),
      timezone: NY,
      now: tuesday,
    });
    expect(resolved.frozen.temporary_expires_at).toBe(mondayFrozen.temporary_expires_at);
    expect(resolved.frozen.temporary_interpreted_at).toBe(monday.toISOString());
    const merged = applySolTemporaryHallwayMerge({
      prev: prev as never,
      nextCandidate: CANDIDATE,
      frozen: resolved.frozen,
      inboundRaw: "10:30",
      messageSid: "SMtue",
      liveCanonical: CANONICAL,
      nowMs: tuesday.getTime(),
    });
    expect(merged.sms_state).toBe("awaiting_confirmation");
    expect(merged.temporary_expires_at).toBe(mondayFrozen.temporary_expires_at);
  });

  it("B. Monday candidate-known / Tuesday duration resolves using Tuesday now", () => {
    const tuesday = new Date("2026-09-08T16:00:00.000Z");
    const prev = tempPayload(DURATION_LATER_START);
    const resolved = resolveSolTemporaryHallwayFrozenDuration({
      prev: prev as never,
      semantic: semantic({
        candidate_behavior_statement: null,
        temporary_duration_kind: "through_weekday",
        temporary_weekday: "friday",
      }),
      timezone: NY,
      now: tuesday,
    });
    const expected = resolveTemporaryOverlayExpiry({
      temporary_duration_kind: "through_weekday",
      temporary_duration_days: null,
      temporary_weekday: "friday",
      temporary_end_local_date: null,
      timezone: NY,
      now: tuesday,
    });
    expect(resolved.frozen.temporary_expires_at).toBe(expected.expires_at_utc);
    expect(resolved.frozen.temporary_interpreted_at).toBe(tuesday.toISOString());
    const merged = applySolTemporaryHallwayMerge({
      prev: prev as never,
      nextCandidate: CANDIDATE,
      frozen: resolved.frozen,
      inboundRaw: "Through Friday.",
      messageSid: "SMtue",
      liveCanonical: CANONICAL,
      nowMs: tuesday.getTime(),
    });
    expect(merged.sms_state).toBe("awaiting_confirmation");
    expect(merged.temporary_expires_at).toBe(expected.expires_at_utc);
  });

  it("C. Sunday 11:55 PM this week / Monday 12:05 AM candidate does not promote stale expiry", () => {
    const sunday = new Date("2026-09-14T03:55:00.000Z");
    const monday = new Date("2026-09-14T04:05:00.000Z");
    const sundayFrozen = freezeTemporaryDurationFromSemantic({
      semantic: semantic({
        candidate_behavior_statement: null,
        temporary_duration_kind: "local_week",
      }),
      timezone: NY,
      now: sunday,
    }).frozen;
    expect(sundayFrozen.temporary_expires_at).toBeTruthy();
    expect(Date.parse(sundayFrozen.temporary_expires_at!)).toBeLessThanOrEqual(monday.getTime());
    const prev = tempPayload({
      sms_state: "awaiting_candidate",
      candidate_behavior_statement: null,
      candidate_tightened_bar: null,
      temporary_expires_at: sundayFrozen.temporary_expires_at,
      temporary_last_included_local_date: sundayFrozen.temporary_last_included_local_date,
      temporary_interpreted_at: sundayFrozen.temporary_interpreted_at,
    });
    const resolved = resolveSolTemporaryHallwayFrozenDuration({
      prev: prev as never,
      semantic: null,
      timezone: NY,
      now: monday,
    });
    expect(resolved.frozen.temporary_expires_at).toBeNull();
    const merged = applySolTemporaryHallwayMerge({
      prev: prev as never,
      nextCandidate: CANDIDATE,
      frozen: resolved.frozen,
      inboundRaw: "10:30",
      messageSid: "SMmon",
      liveCanonical: CANONICAL,
      nowMs: monday.getTime(),
    });
    expect(merged.sms_state).toBe("awaiting_candidate");
    expect(merged.temporary_expires_at).toBeNull();
    expect(merged.candidate_behavior_statement).toBe(CANDIDATE);
  });

  it("D. 1 second before expiry may promote", () => {
    const exp = "2026-09-14T04:00:00.000Z";
    const nowMs = Date.parse(exp) - 1000;
    expect(
      canPromoteSolTemporaryConfirmation({
        candidate: CANDIDATE,
        expiresAt: exp,
        canonicalSnapshot: CANONICAL,
        liveCanonical: CANONICAL,
        nowMs,
      })
    ).toBe(true);
    const merged = applySolTemporaryHallwayMerge({
      prev: tempPayload({
        sms_state: "awaiting_candidate",
        temporary_expires_at: exp,
      }) as never,
      nextCandidate: CANDIDATE,
      frozen: frozenDurationFromExistingPayload(
        tempPayload({ temporary_expires_at: exp }) as never,
        nowMs
      ),
      inboundRaw: "10:30",
      messageSid: "SMrace",
      liveCanonical: CANONICAL,
      nowMs,
    });
    expect(merged.sms_state).toBe("awaiting_confirmation");
    expect(merged.temporary_expires_at).toBe(exp);
  });

  it("E. at expiry does not promote", () => {
    const exp = "2026-09-14T04:00:00.000Z";
    const nowMs = Date.parse(exp);
    expect(
      canPromoteSolTemporaryConfirmation({
        candidate: CANDIDATE,
        expiresAt: exp,
        canonicalSnapshot: CANONICAL,
        liveCanonical: CANONICAL,
        nowMs,
      })
    ).toBe(false);
    const merged = applySolTemporaryHallwayMerge({
      prev: tempPayload({
        sms_state: "awaiting_candidate",
        temporary_expires_at: exp,
      }) as never,
      nextCandidate: CANDIDATE,
      frozen: frozenDurationFromExistingPayload(
        tempPayload({ temporary_expires_at: exp }) as never,
        nowMs
      ),
      inboundRaw: "10:30",
      messageSid: "SMrace",
      liveCanonical: CANONICAL,
      nowMs,
    });
    expect(merged.sms_state).toBe("awaiting_candidate");
    expect(merged.temporary_expires_at).toBeNull();
  });

  it("F. 1 second after expiry does not promote", () => {
    const exp = "2026-09-14T04:00:00.000Z";
    const nowMs = Date.parse(exp) + 1000;
    expect(
      canPromoteSolTemporaryConfirmation({
        candidate: CANDIDATE,
        expiresAt: exp,
        canonicalSnapshot: CANONICAL,
        liveCanonical: CANONICAL,
        nowMs,
      })
    ).toBe(false);
    const merged = applySolTemporaryHallwayMerge({
      prev: tempPayload({ temporary_expires_at: exp }) as never,
      nextCandidate: CANDIDATE,
      frozen: frozenDurationFromExistingPayload(
        tempPayload({ temporary_expires_at: exp }) as never,
        nowMs
      ),
      inboundRaw: "10:30",
      messageSid: "SMrace",
      liveCanonical: CANONICAL,
      nowMs,
    });
    expect(merged.sms_state).toBe("awaiting_candidate");
    expect(merged.temporary_expires_at).toBeNull();
  });

  it("canonical snapshot mismatch cannot promote or authorize confirmation", () => {
    const nowMs = NOW.getTime();
    const prev = tempPayload({
      canonical_behavior_snapshot: CANONICAL,
    });
    expect(
      canPromoteSolTemporaryConfirmation({
        candidate: CANDIDATE,
        expiresAt: prev.temporary_expires_at as string,
        canonicalSnapshot: CANONICAL,
        liveCanonical: "Walk daily.",
        nowMs,
      })
    ).toBe(false);
    const merged = applySolTemporaryHallwayMerge({
      prev: prev as never,
      nextCandidate: CANDIDATE,
      frozen: frozenDurationFromExistingPayload(prev as never, nowMs),
      inboundRaw: "Yes",
      messageSid: "SMsnap",
      liveCanonical: "Walk daily.",
      nowMs,
    });
    expect(merged.sms_state).toBe("awaiting_candidate");
    const auth = temporaryConfirmationAuthorizationFromReloadedCommitment(
      withPending(commitment({ behavior_statement: "Walk daily." }), prev),
      CANDIDATE,
      nowMs
    );
    expect(auth.temporary_adjustment_confirmation_authorized).not.toBe(true);
    expect(auth.goal_change_confirmation_authorized).toBe(false);
  });
});

describe("Slice 7B correction — exclusive temp awaiting_confirmation owner", () => {
  const base = commitment();
  const confirmRow = withPending(base, tempPayload());

  beforeEach(() => {
    getActiveCommitment.mockReset().mockResolvedValue(confirmRow);
    recomputeV2CoachingMemory.mockReset().mockResolvedValue(undefined);
    mergeSmsPendingResolutionPayload.mockReset().mockResolvedValue({
      ok: true,
      updatedAt: base.updated_at,
    });
    clearPendingResolution.mockReset().mockResolvedValue(undefined);
  });

  it("tagged awaiting_confirmation is Sol-owned exclusive pending", () => {
    expect(isSolOwnedTemporaryOverlayPending(confirmRow)).toBe(true);
  });

  it("holding consumes tagged confirm pending without overlay/canonical mutation", async () => {
    const held = await runSolTemporaryOverlayHoldingForInbound({
      commitment: confirmRow,
      nowMs: NOW.getTime(),
    });
    expect(held.demoted).toBe(false);
    expect(held.authorization.temporary_adjustment_confirmation_authorized).toBe(true);
    expect(held.authorization.goal_change_apply_authorized).toBe(false);
    expect(mergeSmsPendingResolutionPayload).not.toHaveBeenCalled();
    expect(clearPendingResolution).not.toHaveBeenCalled();
    expect(held.commitment.behavior_statement).toBe(CANONICAL);
  });

  it.each(OWNERSHIP_INBOUNDS)(
    "ownership inbound %s is not interpreted by the holding owner",
    async () => {
      const held = await runSolTemporaryOverlayHoldingForInbound({
        commitment: confirmRow,
        nowMs: NOW.getTime(),
      });
      expect(held.authorization.temporary_adjustment_confirmation_authorized).toBe(true);
      expect(held.authorization.goal_change_apply_authorized).toBe(false);
      expect(mergeSmsPendingResolutionPayload).not.toHaveBeenCalled();
      expect(clearPendingResolution).not.toHaveBeenCalled();
    }
  );

  it("expired awaiting_confirmation is demoted and expiry is not confirmable", async () => {
    const exp = "2026-09-07T12:00:00.000Z";
    const expired = withPending(
      base,
      tempPayload({
        sms_state: "awaiting_confirmation",
        temporary_expires_at: exp,
      })
    );
    getActiveCommitment.mockResolvedValue(expired);
    const held = await runSolTemporaryOverlayHoldingForInbound({
      commitment: expired,
      nowMs: Date.parse(exp) + 1000,
    });
    expect(held.demoted).toBe(true);
    expect(mergeSmsPendingResolutionPayload).toHaveBeenCalled();
    const mergeFn = mergeSmsPendingResolutionPayload.mock.calls[0]?.[0]?.merge;
    if (typeof mergeFn === "function") {
      const merged = mergeFn(expired.pending_resolution_payload as never);
      expect(merged.sms_state).toBe("awaiting_candidate");
      expect(merged.temporary_expires_at).toBeNull();
      expect(merged.candidate_behavior_statement).toBe(CANDIDATE);
    }
  });

  it("holding owner source does not parse confirmation English or leftover tighten", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/sol-goal-change-temporary-pending.ts"),
      "utf8"
    );
    const holdStart = src.indexOf("export async function runSolTemporaryOverlayHoldingForInbound");
    const holdBlock = src.slice(holdStart, src.indexOf("export function deterministicTemporaryDurationSummary"));
    expect(holdBlock).not.toContain("parseSmsConfirmation");
    expect(holdBlock).not.toContain("looksLikeCancellation");
    expect(holdBlock).not.toContain("applySmsTightenMutation");
    expect(holdBlock).not.toContain("persistContractOverlayProposed");
    expect(holdBlock).not.toContain("activateAdaptiveOverlayFromProposal");
    expect(holdBlock).not.toContain("applyV2CommitmentReplace");
  });
});

describe("Slice 7C exclusive temp confirm route wire", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts"),
    "utf8"
  );
  const pendingFnStart = src.indexOf("async function processV2SmsInboundPendingResolution");
  const pendingBlock = src.slice(
    pendingFnStart,
    src.indexOf("async function processV2CoachingRefreshInbound")
  );

  it("confirm owner is after hallway and before leftover, and returns true", () => {
    const slice3 = pendingBlock.indexOf("await runSolGoalChangePendingConfirmForInbound");
    const hallway = pendingBlock.indexOf("await runSolGoalChangeAwaitingCandidateForInbound");
    const confirm = pendingBlock.indexOf("await runSolTemporaryOverlayConfirmForInbound");
    const leftoverCall = pendingBlock.indexOf("await tryHandleSmsInboundPendingResolution");
    expect(confirm).toBeGreaterThan(hallway);
    expect(leftoverCall).toBeGreaterThan(confirm);
    expect(slice3).toBeGreaterThan(0);
    const between = pendingBlock.slice(confirm, leftoverCall);
    expect(between).toContain("sendSolTemporaryOverlayConfirmInboundReply");
    expect(between).toContain("return true");
    expect(between).not.toContain("tryHandleSmsInboundPendingResolution");
    expect(pendingBlock).toContain("isSolOwnedTemporaryOverlayPending");
  });

  it("confirm writer is exclusive Sol, no scoring, no V3 persist", () => {
    const ownedStart = src.indexOf("async function sendSolGoalChangeOwnedPendingInboundReply");
    const ownedBlock = src.slice(
      ownedStart,
      src.indexOf("async function sendSolGoalChangePendingConfirmInboundReply")
    );
    expect(ownedBlock).toContain("exclusiveLaneOwnsTurn: true");
    expect(ownedBlock).toContain("should_write_outcome_event: false");
    expect(src).toContain('decisionReason: "sol_temporary_overlay_confirm"');
    expect(src).not.toMatch(
      /sendSolTemporaryOverlayConfirmInboundReply[\s\S]{0,1200}persistInboundV3RelationshipLaneReplyReadyAndSend/
    );
  });

  it("route passes job.created_at as semantic now only; mutationClock is not wired from the job", () => {
    const confirm = pendingBlock.indexOf("await runSolTemporaryOverlayConfirmForInbound");
    const leftoverCall = pendingBlock.indexOf("await tryHandleSmsInboundPendingResolution");
    const between = pendingBlock.slice(confirm, leftoverCall);
    expect(between).toContain("now: job.created_at");
    expect(between).toContain("Semantic/turn time only");
    expect(between).not.toContain("mutationClock:");
  });
});


describe("Slice 7B writer failure + body safety", () => {
  it("temp confirm auth fallback is temporary, and permanence is blocked", () => {
    const week = weekExpiry();
    const auth = temporaryConfirmationAuthorizationFromReloadedCommitment(
      withPending(commitment(), tempPayload()),
      CANDIDATE,
      NOW.getTime()
    );
    expect(auth.temporary_adjustment_confirmation_authorized).toBe(true);
    const fallback = tryBuildAuthorizedGoalChangeWriterFailureFallback(auth);
    expect(fallback).toMatch(/temporary target/i);
    expect(fallback).toContain(week.last_included_local_date);
    expect(
      applyGoalChangeMachineBodySafety({
        body: "Your goal is now 10:30.",
        authorization: auth,
      }).blocked
    ).toBe(true);
  });
});

describe("Slice 7B no second English brain", () => {
  const files = [
    "src/lib/sol-goal-change-temporary-pending.ts",
    "src/lib/sol-goal-change-pending-open.ts",
    "src/lib/sol-goal-change-awaiting-candidate.ts",
    "src/app/api/cron/sms-inbound-coach/route.ts",
  ];

  it("production 7B code does not inspect raw duration/temp English", () => {
    const banned =
      /\.includes\(\s*["'](?:tonight|this week|until|through|harder|easier|traveling|for now|temporary)/i;
    const regexEnglish =
      /\/\\b(?:tonight|this week|until|through|harder|easier|traveling|for now)/i;
    for (const rel of files) {
      const src = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      expect(src).not.toMatch(banned);
      expect(src).not.toMatch(regexEnglish);
    }
  });

  it("hallway duration-later merges structured Sol fields, not inbound tokens", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/sol-goal-change-awaiting-candidate.ts"),
      "utf8"
    );
    expect(src).toContain("semanticSuppliesTemporaryDuration");
    expect(src).toContain("resolveSolTemporaryHallwayFrozenDuration");
    expect(src).not.toContain("parseSmsConfirmation");
    expect(src).not.toContain("looksLikeCancellation");
    expect(src).not.toMatch(/includes\(["']through Friday["']\)/);
  });
});
