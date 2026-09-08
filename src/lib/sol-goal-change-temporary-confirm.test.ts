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
  tryBuildAuthorizedGoalChangeWriterFailureFallback,
} from "@/lib/sol-goal-change-confirmation-guard";
import {
  getEffectiveCoachingAsk,
  isV2AdaptiveOverlayActive,
} from "@/lib/v2-adaptive-contract";

const getActiveCommitment = vi.hoisted(() => vi.fn());
const recomputeV2CoachingMemory = vi.hoisted(() => vi.fn());
const runSolGoalChangeSemanticInterpreter = vi.hoisted(() => vi.fn());
const mergeSmsPendingResolutionPayload = vi.hoisted(() => vi.fn());
const clearPendingResolution = vi.hoisted(() => vi.fn());
const setPendingResolution = vi.hoisted(() => vi.fn());
const persistContractOverlayProposed = vi.hoisted(() => vi.fn());
const activateAdaptiveOverlayFromProposal = vi.hoisted(() => vi.fn());
const clearStaleAdaptiveContractColumns = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn(), rpc: vi.fn() },
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

vi.mock("@/lib/v2-guided-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-guided-resolution")>();
  return {
    ...actual,
    mergeSmsPendingResolutionPayload,
    clearPendingResolution,
    setPendingResolution,
  };
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

import {
  buildTemporaryAppliedAuthorization,
  proveTemporaryOverlayApply,
  resolveSolTemporaryConfirmMeaning,
  runSolTemporaryOverlayConfirmForInbound,
  SOL_TEMPORARY_OVERLAY_CONTRACT_KIND,
} from "@/lib/sol-goal-change-temporary-confirm";

const CANONICAL = "I will be in bed by 9:30 pm nightly.";
const CANDIDATE = "I will be in bed by 10:30 pm nightly.";
const CANDIDATE_1015 = "I will be in bed by 10:15 pm nightly.";
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

function thursdayExpiry() {
  return resolveTemporaryOverlayExpiry({
    temporary_duration_kind: "through_weekday",
    temporary_duration_days: null,
    temporary_weekday: "thursday",
    temporary_end_local_date: null,
    timezone: NY,
    now: NOW,
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
    ai_confidence: null,
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

function withTempPending(
  row: ActiveV2CommitmentRow,
  payload: Record<string, unknown> = tempPayload()
): ActiveV2CommitmentRow {
  return {
    ...row,
    pending_resolution_kind: "commitment_tighten",
    pending_resolution_created_at: "2026-09-07T12:00:00.000Z",
    pending_resolution_expires_at: "2027-09-07T12:00:00.000Z",
    pending_resolution_payload: payload,
  };
}

function semantic(
  overrides: Partial<SolGoalChangeSemanticResult["goal_change"]> = {}
): SolGoalChangeSemanticResult {
  return {
    version: SOL_GOAL_CHANGE_SEMANTIC_VERSION,
    goal_change: {
      ...emptySolGoalChangeSemanticResult().goal_change,
      intent: "temporary_adjustment",
      candidate_behavior_statement: CANDIDATE,
      needs_clarification: false,
      requires_confirmation: true,
      confirms_existing_pending: false,
      rejects_existing_pending: false,
      modifies_existing_pending_candidate: false,
      member_meaning_summary: "temporary 10:30",
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

describe("Slice 7C overlay RPC migration source", () => {
  const sql = fs.readFileSync(
    path.join(
      process.cwd(),
      "supabase/migrations/20260908010000_v2_overlay_consent_optional_expires_at.sql"
    ),
    "utf8"
  );
  const activateSrc = fs.readFileSync(
    path.join(process.cwd(), "src/lib/v2-adaptive-contract.ts"),
    "utf8"
  );
  const leftover = fs.readFileSync(
    path.join(process.cwd(), "src/lib/v2-sms-pending-resolution-complete.ts"),
    "utf8"
  );
  const route = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts"),
    "utf8"
  );

  it("adds optional p_overlay_expires_at DEFAULT NULL and COALESCE 7-day default", () => {
    expect(sql).toContain("p_overlay_expires_at TIMESTAMPTZ DEFAULT NULL");
    expect(sql).toContain("COALESCE(p_overlay_expires_at, p_now + interval '7 days')");
    expect(sql).toContain("DROP FUNCTION IF EXISTS public.v2_apply_overlay_consent_mutation(");
    expect(sql).not.toContain("ALTER TABLE");
  });

  it("activate only passes p_overlay_expires_at when overlayExpiresAt is provided", () => {
    expect(activateSrc).toContain("overlayExpiresAt?: string | null");
    expect(activateSrc).toContain("p_overlay_expires_at: overlayExpiresAt");
  });

  it("legacy leftover tighten and contract consent omit overlayExpiresAt", () => {
    const leftoverAct = leftover.slice(
      leftover.indexOf("const act = await activateAdaptiveOverlayFromProposal"),
      leftover.indexOf("if (!act.ok)")
    );
    expect(leftoverAct).toContain('contractKind: "shrink_ask"');
    expect(leftoverAct).not.toContain("overlayExpiresAt");
    const consentAct = route.slice(
      route.indexOf("const act = await activateAdaptiveOverlayFromProposal"),
      route.indexOf("const yesTmplPreview")
    );
    expect(consentAct).not.toContain("overlayExpiresAt");
  });
});

describe("getEffectiveCoachingAsk explicit non-7-day expiry", () => {
  it("returns temporary candidate while an explicit Friday overlay is active", () => {
    const friday = fridayExpiry();
    expect(friday.supported).toBe(true);
    const row = commitment({
      adaptive_ask_text: CANDIDATE,
      adaptive_ask_active_from: NOW.toISOString(),
      adaptive_ask_expires_at: friday.expires_at_utc,
    });
    expect(isV2AdaptiveOverlayActive(row, NOW.getTime())).toBe(true);
    expect(getEffectiveCoachingAsk(row, NOW.getTime())).toBe(CANDIDATE);
    expect(row.behavior_statement).toBe(CANONICAL);
  });

  it("returns canonical after an explicit tonight expiry", () => {
    const tonight = resolveTemporaryOverlayExpiry({
      temporary_duration_kind: "remaining_local_day",
      temporary_duration_days: null,
      temporary_weekday: null,
      temporary_end_local_date: null,
      timezone: NY,
      now: NOW,
    });
    expect(tonight.supported).toBe(true);
    const row = commitment({
      adaptive_ask_text: CANDIDATE,
      adaptive_ask_active_from: NOW.toISOString(),
      adaptive_ask_expires_at: tonight.expires_at_utc,
    });
    expect(getEffectiveCoachingAsk(row, NOW.getTime())).toBe(CANDIDATE);
    const after = Date.parse(tonight.expires_at_utc!) + 1000;
    expect(isV2AdaptiveOverlayActive(row, after)).toBe(false);
    expect(getEffectiveCoachingAsk(row, after)).toBe(CANONICAL);
  });
});

describe("proveTemporaryOverlayApply", () => {
  it("requires canonical unchanged, exact overlay text, exact expiry, and pending cleared", () => {
    const week = weekExpiry();
    const before = withTempPending(commitment());
    const after = commitment({
      adaptive_ask_text: CANDIDATE,
      adaptive_ask_active_from: NOW.toISOString(),
      adaptive_ask_expires_at: week.expires_at_utc,
    });
    expect(
      proveTemporaryOverlayApply({
        before,
        after,
        expectedCandidate: CANDIDATE,
        expectedExpiresAt: week.expires_at_utc!,
        canonicalSnapshot: CANONICAL,
        nowMs: NOW.getTime(),
      }).ok
    ).toBe(true);
    expect(
      proveTemporaryOverlayApply({
        before,
        after: { ...after, behavior_statement: CANDIDATE },
        expectedCandidate: CANDIDATE,
        expectedExpiresAt: week.expires_at_utc!,
        canonicalSnapshot: CANONICAL,
        nowMs: NOW.getTime(),
      })
    ).toEqual({ ok: false, reason: "reload_canonical_changed" });
    expect(
      proveTemporaryOverlayApply({
        before,
        after: { ...after, adaptive_ask_text: CANDIDATE_1015 },
        expectedCandidate: CANDIDATE,
        expectedExpiresAt: week.expires_at_utc!,
        canonicalSnapshot: CANONICAL,
        nowMs: NOW.getTime(),
      })
    ).toEqual({ ok: false, reason: "reload_overlay_text_mismatch" });
    expect(
      proveTemporaryOverlayApply({
        before,
        after: { ...after, adaptive_ask_expires_at: fridayExpiry().expires_at_utc },
        expectedCandidate: CANDIDATE,
        expectedExpiresAt: week.expires_at_utc!,
        canonicalSnapshot: CANONICAL,
        nowMs: NOW.getTime(),
      })
    ).toEqual({ ok: false, reason: "reload_overlay_expiry_mismatch" });
    expect(
      proveTemporaryOverlayApply({
        before,
        after: withTempPending(after),
        expectedCandidate: CANDIDATE,
        expectedExpiresAt: week.expires_at_utc!,
        canonicalSnapshot: CANONICAL,
        nowMs: NOW.getTime(),
      })
    ).toEqual({ ok: false, reason: "reload_pending_still_active" });
    expect(
      proveTemporaryOverlayApply({
        before,
        after,
        expectedCandidate: CANDIDATE,
        expectedExpiresAt: week.expires_at_utc!,
        canonicalSnapshot: CANONICAL,
        nowMs: Date.parse(week.expires_at_utc!) + 1,
      })
    ).toEqual({ ok: false, reason: "reload_overlay_not_active" });
  });
});

describe("resolveSolTemporaryConfirmMeaning", () => {
  const payload = tempPayload();

  it("Sol-down exact Yes/Y confirm and No/N reject; synonyms stay", () => {
    expect(
      resolveSolTemporaryConfirmMeaning({
        inboundRaw: "Yes",
        semantic: null,
        interpreterOk: false,
        payload,
        liveCanonical: CANONICAL,
      }).meaning
    ).toBe("confirm");
    expect(
      resolveSolTemporaryConfirmMeaning({
        inboundRaw: "Y",
        semantic: null,
        interpreterOk: false,
        payload,
        liveCanonical: CANONICAL,
      }).deterministicYesFallback
    ).toBe(true);
    expect(
      resolveSolTemporaryConfirmMeaning({
        inboundRaw: "No",
        semantic: null,
        interpreterOk: false,
        payload,
        liveCanonical: CANONICAL,
      }).meaning
    ).toBe("reject");
    expect(
      resolveSolTemporaryConfirmMeaning({
        inboundRaw: "Absolutely",
        semantic: null,
        interpreterOk: false,
        payload,
        liveCanonical: CANONICAL,
      }).meaning
    ).toBe("ambiguous");
  });

  it("Sol owns Absolutely confirm, Never mind reject, Maybe stay, and modify", () => {
    expect(
      resolveSolTemporaryConfirmMeaning({
        inboundRaw: "Absolutely",
        semantic: semantic({ confirms_existing_pending: true }),
        interpreterOk: true,
        payload,
        liveCanonical: CANONICAL,
      }).meaning
    ).toBe("confirm");
    expect(
      resolveSolTemporaryConfirmMeaning({
        inboundRaw: "Never mind",
        semantic: semantic({ rejects_existing_pending: true }),
        interpreterOk: true,
        payload,
        liveCanonical: CANONICAL,
      }).meaning
    ).toBe("reject");
    expect(
      resolveSolTemporaryConfirmMeaning({
        inboundRaw: "Maybe",
        semantic: semantic({ needs_clarification: true }),
        interpreterOk: true,
        payload,
        liveCanonical: CANONICAL,
      }).meaning
    ).toBe("ambiguous");
    expect(
      resolveSolTemporaryConfirmMeaning({
        inboundRaw: "Actually make it 10:15.",
        semantic: semantic({
          modifies_existing_pending_candidate: true,
          candidate_behavior_statement: "10:15",
        }),
        interpreterOk: true,
        payload,
        liveCanonical: CANONICAL,
      }).meaning
    ).toBe("modify");
    expect(
      resolveSolTemporaryConfirmMeaning({
        inboundRaw: "Actually make 10:30 my permanent goal.",
        semantic: semantic({
          intent: "saved_replace",
          candidate_behavior_statement: CANDIDATE,
        }),
        interpreterOk: true,
        payload,
        liveCanonical: CANONICAL,
      }).meaning
    ).toBe("permanent_instead");
  });
});

describe("runSolTemporaryOverlayConfirmForInbound", () => {
  let live: ActiveV2CommitmentRow;

  beforeEach(() => {
    vi.clearAllMocks();
    live = withTempPending(commitment());
    getActiveCommitment.mockImplementation(async () => live);
    recomputeV2CoachingMemory.mockResolvedValue(undefined);
    clearStaleAdaptiveContractColumns.mockResolvedValue(undefined);
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
    setPendingResolution.mockImplementation(
      async (args: { kind: string; payload: Record<string, unknown> }) => {
        live = {
          ...live,
          pending_resolution_kind: args.kind as ActiveV2CommitmentRow["pending_resolution_kind"],
          pending_resolution_payload: args.payload,
          updated_at: "2026-09-07T12:01:00.000Z",
        };
        return live.updated_at;
      }
    );
    persistContractOverlayProposed.mockImplementation(async (args: { proposalText: string }) => {
      live = {
        ...live,
        adaptive_proposal_text: args.proposalText,
        adaptive_proposal_created_at: NOW.toISOString(),
        adaptive_proposal_expires_at: "2026-09-09T16:00:00.000Z",
        updated_at: "2026-09-07T12:01:30.000Z",
      };
      return { ok: true, updatedAt: live.updated_at };
    });
    activateAdaptiveOverlayFromProposal.mockImplementation(
      async (args: { proposalText: string; overlayExpiresAt?: string | null }) => {
        live = {
          ...live,
          adaptive_ask_text: args.proposalText,
          adaptive_ask_active_from: NOW.toISOString(),
          adaptive_ask_expires_at: args.overlayExpiresAt ?? weekExpiry().expires_at_utc,
          adaptive_proposal_text: null,
          adaptive_proposal_created_at: null,
          adaptive_proposal_expires_at: null,
          updated_at: "2026-09-07T12:02:00.000Z",
        };
        return { ok: true, result: "applied", updatedAt: live.updated_at };
      }
    );
  });

  async function run(
    inboundRaw: string,
    messageSid = "SMyes",
    extras?: { now?: Date; mutationClock?: () => number }
  ) {
    return runSolTemporaryOverlayConfirmForInbound({
      clerkUserId: "user_angela",
      commitment: live,
      inboundRaw,
      messageSid,
      timezone: NY,
      now: extras?.now ?? NOW,
      mutationClock: extras?.mutationClock ?? (() => NOW.getTime()),
    });
  }

  function sequentialClock(times: number[]): () => number {
    let i = 0;
    return () => times[Math.min(i++, times.length - 1)]!;
  }

  it("exact Yes applies overlay with frozen expiry, proves, and does not mutate canonical", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const week = weekExpiry();
    const r = await run("Yes");
    expect(r.handled).toBe(true);
    expect(r.consequence).toBe("applied");
    expect(r.authorization.temporary_adjustment_apply_authorized).toBe(true);
    expect(r.authorization.goal_change_apply_authorized).toBe(false);
    expect(r.authorization.canonical_behavior_statement).toBe(CANONICAL);
    expect(r.authorization.pending_cleared).toBe(true);
    expect(live.behavior_statement).toBe(CANONICAL);
    expect(live.id).toBe("cmt_angela");
    expect(live.adaptive_ask_text).toBe(CANDIDATE);
    expect(live.adaptive_ask_expires_at).toBe(week.expires_at_utc);
    expect(persistContractOverlayProposed).toHaveBeenCalledTimes(1);
    expect(activateAdaptiveOverlayFromProposal).toHaveBeenCalledTimes(1);
    const actArgs = activateAdaptiveOverlayFromProposal.mock.calls[0]![0] as {
      overlayExpiresAt: string;
      contractKind: string;
      inboundMessageSid: string;
    };
    expect(actArgs.overlayExpiresAt).toBe(week.expires_at_utc);
    expect(actArgs.contractKind).toBe(SOL_TEMPORARY_OVERLAY_CONTRACT_KIND);
    expect(actArgs.inboundMessageSid).toBe("SMyes");
    expect(getEffectiveCoachingAsk(live, NOW.getTime())).toBe(CANDIDATE);
  });

  it("natural Absolutely via Sol applies", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const r = await run("Absolutely");
    expect(r.consequence).toBe("applied");
    expect(r.authorization.temporary_adjustment_apply_authorized).toBe(true);
    expect(activateAdaptiveOverlayFromProposal).toHaveBeenCalled();
  });

  it("exact No rejects, clears pending, does not touch overlay or canonical", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ rejects_existing_pending: true }))
    );
    const r = await run("No");
    expect(r.consequence).toBe("rejected");
    expect(r.authorization.temporary_adjustment_apply_authorized).not.toBe(true);
    expect(r.authorization.pending_cleared).toBe(true);
    expect(live.behavior_statement).toBe(CANONICAL);
    expect(live.adaptive_ask_text).toBeNull();
    expect(persistContractOverlayProposed).not.toHaveBeenCalled();
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("Never mind via Sol rejects", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ rejects_existing_pending: true }))
    );
    const r = await run("Never mind");
    expect(r.consequence).toBe("rejected");
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("modify candidate restages and requires fresh confirmation", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          modifies_existing_pending_candidate: true,
          candidate_behavior_statement: "10:15",
        })
      )
    );
    const r = await run("Actually make it 10:15.");
    expect(r.consequence).toBe("modified");
    expect(r.authorization.temporary_adjustment_confirmation_authorized).toBe(true);
    expect(r.authorization.temporary_adjustment_apply_authorized).not.toBe(true);
    expect((live.pending_resolution_payload as { candidate_behavior_statement?: string })
      .candidate_behavior_statement).toBe(CANDIDATE_1015);
    expect(
      (live.pending_resolution_payload as { temporary_expires_at?: string }).temporary_expires_at
    ).toBe(weekExpiry().expires_at_utc);
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("modify duration restages frozen expiry and requires fresh confirmation", async () => {
    const thursday = thursdayExpiry();
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          temporary_duration_kind: "through_weekday",
          temporary_weekday: "thursday",
          candidate_behavior_statement: CANDIDATE,
        })
      )
    );
    const r = await run("Actually only through Thursday.");
    expect(r.consequence).toBe("modified");
    expect(r.authorization.temporary_adjustment_apply_authorized).not.toBe(true);
    expect(
      (live.pending_resolution_payload as { temporary_expires_at?: string }).temporary_expires_at
    ).toBe(thursday.expires_at_utc);
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("modify candidate and duration restages both and does not apply", async () => {
    const thursday = thursdayExpiry();
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          modifies_existing_pending_candidate: true,
          candidate_behavior_statement: "10:15",
          temporary_duration_kind: "through_weekday",
          temporary_weekday: "thursday",
        })
      )
    );
    const r = await run("Actually 10:15 through Thursday.");
    expect(r.consequence).toBe("modified");
    const payload = live.pending_resolution_payload as {
      candidate_behavior_statement?: string;
      temporary_expires_at?: string;
    };
    expect(payload.candidate_behavior_statement).toBe(CANDIDATE_1015);
    expect(payload.temporary_expires_at).toBe(thursday.expires_at_utc);
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("ambiguous Maybe leaves pending and does not RPC", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ needs_clarification: true }))
    );
    const r = await run("Maybe");
    expect(r.consequence).toBe("ambiguous");
    expect(live.pending_resolution_kind).toBe("commitment_tighten");
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
    expect(clearPendingResolution).not.toHaveBeenCalled();
  });

  it("Sol-down exact protocol Yes applies; synonym Absolutely does not", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(interpreterFail());
    const yes = await run("Yes");
    expect(yes.consequence).toBe("applied");
    live = withTempPending(commitment());
    persistContractOverlayProposed.mockClear();
    activateAdaptiveOverlayFromProposal.mockClear();
    const syn = await run("Absolutely");
    expect(syn.consequence).toBe("ambiguous");
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("expired pending cannot apply", async () => {
    live = withTempPending(
      commitment(),
      tempPayload({ temporary_expires_at: "2026-09-07T12:00:00.000Z" })
    );
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const r = await runSolTemporaryOverlayConfirmForInbound({
      clerkUserId: "user_angela",
      commitment: live,
      inboundRaw: "Yes",
      messageSid: "SMexp",
      timezone: NY,
      now: new Date("2026-09-07T16:00:00.000Z"),
    });
    expect(r.authorization.temporary_adjustment_apply_authorized).not.toBe(true);
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("canonical snapshot mismatch cannot apply", async () => {
    live = withTempPending(
      commitment({ behavior_statement: "I will be in bed by 8:00 pm nightly." }),
      tempPayload()
    );
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const r = await run("Yes");
    expect(r.authorization.temporary_adjustment_apply_authorized).not.toBe(true);
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
  });

  it("active overlay conflict clears stale temp pending and does not stack", async () => {
    live = withTempPending(
      commitment({
        adaptive_ask_text: "I will walk 20 minutes.",
        adaptive_ask_active_from: NOW.toISOString(),
        adaptive_ask_expires_at: weekExpiry().expires_at_utc,
      })
    );
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const r = await run("Yes");
    expect(r.consequence).toBe("overlay_conflict");
    expect(r.authorization.temporary_adjustment_apply_authorized).not.toBe(true);
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
    expect(live.pending_resolution_kind).toBeNull();
    expect(live.adaptive_ask_text).toBe("I will walk 20 minutes.");
  });

  it("retry after overlay already matches and pending remains: skip persist/rpc, clear, prove", async () => {
    const week = weekExpiry();
    live = withTempPending(
      commitment({
        adaptive_ask_text: CANDIDATE,
        adaptive_ask_active_from: NOW.toISOString(),
        adaptive_ask_expires_at: week.expires_at_utc,
      })
    );
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const r = await run("Yes", "SMdup");
    expect(r.consequence).toBe("applied");
    expect(r.authorization.temporary_adjustment_apply_authorized).toBe(true);
    expect(persistContractOverlayProposed).not.toHaveBeenCalled();
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
    expect(live.pending_resolution_kind).toBeNull();
  });

  it("retry after pending already cleared does not re-apply overlay", async () => {
    const week = weekExpiry();
    live = commitment({
      adaptive_ask_text: CANDIDATE,
      adaptive_ask_active_from: NOW.toISOString(),
      adaptive_ask_expires_at: week.expires_at_utc,
    });
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const r = await run("Yes", "SMdup");
    expect(r.handled).toBe(false);
    expect(r.consequence).toBe("not_applicable");
    expect(persistContractOverlayProposed).not.toHaveBeenCalled();
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
    expect(live.adaptive_ask_text).toBe(CANDIDATE);
    expect(live.behavior_statement).toBe(CANONICAL);
  });

  it("RPC already_applied still requires reload proof", async () => {
    const week = weekExpiry();
    activateAdaptiveOverlayFromProposal.mockImplementation(async (args: { proposalText: string }) => {
      live = {
        ...live,
        adaptive_ask_text: args.proposalText,
        adaptive_ask_active_from: NOW.toISOString(),
        adaptive_ask_expires_at: week.expires_at_utc,
        adaptive_proposal_text: null,
        updated_at: "2026-09-07T12:02:00.000Z",
      };
      return { ok: false, error: "contract_overlay_activate_already_applied", result: "already_applied" };
    });
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const r = await run("Yes");
    expect(r.consequence).toBe("applied");
    expect(r.authorization.temporary_adjustment_apply_authorized).toBe(true);
    expect(r.forensics.rpc_code).toBe("already_applied");
  });

  it("RPC success with bad reload does not authorize applied ack", async () => {
    activateAdaptiveOverlayFromProposal.mockImplementation(async () => {
      live = {
        ...live,
        adaptive_ask_text: CANDIDATE_1015,
        adaptive_ask_active_from: NOW.toISOString(),
        adaptive_ask_expires_at: weekExpiry().expires_at_utc,
        pending_resolution_kind: null,
        pending_resolution_payload: null,
        pending_resolution_created_at: null,
        pending_resolution_expires_at: null,
      };
      return { ok: true, result: "applied", updatedAt: live.updated_at };
    });
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const r = await run("Yes");
    expect(r.consequence).toBe("reload_mismatch");
    expect(r.authorization.temporary_adjustment_apply_authorized).not.toBe(true);
  });

  it("pending clear proof is required for applied auth", async () => {
    clearPendingResolution.mockImplementation(async () => {
      return live.updated_at;
    });
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const r = await run("Yes");
    expect(r.consequence).toBe("reload_mismatch");
    expect(r.authorization.temporary_adjustment_apply_authorized).not.toBe(true);
    expect(r.forensics.pending_cleared).toBe(false);
  });

  it("writer failure after proof uses temporary applied fallback, not saved-goal language", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const r = await run("Yes");
    const fallback = tryBuildAuthorizedGoalChangeWriterFailureFallback(r.authorization);
    expect(fallback).toMatch(/Current Goal stays/i);
    expect(fallback).not.toMatch(/going forward is/i);
    const guarded = applyGoalChangeMachineBodySafety({
      body: "Your goal is now 10:30.",
      authorization: r.authorization,
    });
    expect(guarded.blocked).toBe(true);
    expect(guarded.body).toMatch(/Current Goal stays/i);
  });

  it("temp → permanent converts pending to saved-replace and does not apply overlay", async () => {
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(
        semantic({
          intent: "saved_replace",
          candidate_behavior_statement: CANDIDATE,
        })
      )
    );
    const r = await run("Actually make 10:30 my permanent goal.");
    expect(r.consequence).toBe("permanent_instead");
    expect(r.authorization.goal_change_confirmation_authorized).toBe(true);
    expect(r.authorization.temporary_adjustment_apply_authorized).not.toBe(true);
    expect(live.pending_resolution_kind).toBe("commitment_replace");
    expect(
      (live.pending_resolution_payload as { sol_temporary_overlay?: boolean }).sol_temporary_overlay
    ).toBeUndefined();
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
    expect(live.behavior_statement).toBe(CANONICAL);
  });

  it("stale job.created_at cannot authorize apply after wall-clock expiry (near midnight)", async () => {
    const expiry = "2026-09-08T04:00:00.000Z";
    const turn = new Date("2026-09-08T03:59:50.000Z");
    const wall = Date.parse("2026-09-08T04:00:05.000Z");
    live = withTempPending(commitment(), tempPayload({ temporary_expires_at: expiry }));
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const r = await run("Yes", "SMmidnight", {
      now: turn,
      mutationClock: () => wall,
    });
    expect(r.authorization.temporary_adjustment_apply_authorized).not.toBe(true);
    expect(r.consequence).not.toBe("applied");
    expect(r.forensics.reload_fail_reason).toBe("expiry_not_future");
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
    expect(persistContractOverlayProposed).not.toHaveBeenCalled();
    expect(live.behavior_statement).toBe(CANONICAL);
    expect(live.adaptive_ask_text).toBeNull();
    expect(
      (live.pending_resolution_payload as { sms_state?: string } | null)?.sms_state
    ).not.toBe("awaiting_confirmation");
    const fallback = tryBuildAuthorizedGoalChangeWriterFailureFallback(r.authorization);
    expect(fallback ?? "").not.toMatch(/I'll coach you against/i);
    expect(fallback ?? "").not.toMatch(/Temporary target is active/i);
  });

  it("pre-RPC wall-clock re-check blocks a just-expired window", async () => {
    const expiry = "2026-09-08T04:00:00.000Z";
    const turn = new Date("2026-09-08T03:59:50.000Z");
    const preApply = Date.parse("2026-09-08T03:59:59.000Z");
    const preRpc = Date.parse("2026-09-08T04:00:05.000Z");
    live = withTempPending(commitment(), tempPayload({ temporary_expires_at: expiry }));
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const r = await run("Yes", "SMprerpc", {
      now: turn,
      mutationClock: sequentialClock([preApply, preRpc]),
    });
    expect(persistContractOverlayProposed).toHaveBeenCalled();
    expect(activateAdaptiveOverlayFromProposal).not.toHaveBeenCalled();
    expect(r.authorization.temporary_adjustment_apply_authorized).not.toBe(true);
    expect(r.consequence).not.toBe("applied");
    expect(r.forensics.reload_fail_reason).toBe("expiry_race_before_rpc");
    expect(live.behavior_statement).toBe(CANONICAL);
    expect(live.adaptive_ask_text).toBeNull();
  });

  it("proof-time wall-clock cannot authorize an already-expired overlay", async () => {
    const expiry = "2026-09-08T04:00:00.000Z";
    const turn = new Date("2026-09-08T03:59:50.000Z");
    const preApply = Date.parse("2026-09-08T03:59:58.000Z");
    const preRpc = Date.parse("2026-09-08T03:59:59.000Z");
    const proof = Date.parse("2026-09-08T04:00:05.000Z");
    live = withTempPending(commitment(), tempPayload({ temporary_expires_at: expiry }));
    runSolGoalChangeSemanticInterpreter.mockResolvedValue(
      interpreterOk(semantic({ confirms_existing_pending: true }))
    );
    const r = await run("Yes", "SMproof", {
      now: turn,
      mutationClock: sequentialClock([preApply, preRpc, proof]),
    });
    expect(activateAdaptiveOverlayFromProposal).toHaveBeenCalled();
    expect(r.consequence).toBe("reload_mismatch");
    expect(r.forensics.reload_fail_reason).toBe("reload_overlay_not_active");
    expect(r.authorization.temporary_adjustment_apply_authorized).not.toBe(true);
    expect(live.behavior_statement).toBe(CANONICAL);
    const fallback = tryBuildAuthorizedGoalChangeWriterFailureFallback(r.authorization);
    expect(fallback ?? "").not.toMatch(/I'll coach you against/i);
    expect(fallback ?? "").not.toMatch(/Temporary target is active/i);
  });
});

describe("Slice 7C no second English brain", () => {
  it("new production confirm code has no synonym/duration regex interpreter", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/sol-goal-change-temporary-confirm.ts"),
      "utf8"
    );
    expect(src).not.toContain("parseSmsConfirmation");
    expect(src).not.toContain("looksLikeCancellation");
    expect(src).not.toMatch(/Yep|Absolutely|Sounds good|Never mind/);
    expect(src).not.toMatch(/through Friday|this week|tonight only/);
    expect(src).toContain("runSolGoalChangeSemanticInterpreter");
    expect(src).toContain("isExactPendingProtocolYes");
    expect(src).toContain("isExactPendingProtocolNo");
    expect(src).toContain("mutationClock = args.mutationClock ?? Date.now");
    expect(src).toContain("const mutationNowMs = mutationClock()");
    expect(src).toContain("const preRpcNowMs = mutationClock()");
    expect(src).toContain("const proofNowMs = args.mutationClock()");
  });
});

describe("buildTemporaryAppliedAuthorization is distinct from saved apply", () => {
  it("does not set goal_change_apply_authorized", () => {
    const week = weekExpiry();
    const auth = buildTemporaryAppliedAuthorization({
      commitment: commitment({
        adaptive_ask_text: CANDIDATE,
        adaptive_ask_expires_at: week.expires_at_utc,
        adaptive_ask_active_from: NOW.toISOString(),
      }),
      candidate: CANDIDATE,
      expiresAt: week.expires_at_utc!,
      lastIncludedLocalDate: week.last_included_local_date,
    });
    expect(auth.temporary_adjustment_apply_authorized).toBe(true);
    expect(auth.goal_change_apply_authorized).toBe(false);
    expect(auth.pending_cleared).toBe(true);
  });
});
