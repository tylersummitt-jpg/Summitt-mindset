import { describe, expect, it, vi, beforeEach } from "vitest";

const { mergeSmsPendingResolutionPayload, setPendingResolution, rpcMock } = vi.hoisted(() => ({
  mergeSmsPendingResolutionPayload: vi.fn(),
  setPendingResolution: vi.fn(async () => undefined),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { rpc: rpcMock, from: vi.fn() },
}));

vi.mock("@/lib/v2-guided-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-guided-resolution")>();
  return {
    ...actual,
    mergeSmsPendingResolutionPayload,
    setPendingResolution,
    clearPendingResolutionIfExpired: vi.fn(async () => undefined),
    getPendingResolutionOrNull: actual.getPendingResolutionOrNull,
  };
});

vi.mock("@/lib/v2-commitment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-commitment")>();
  return {
    ...actual,
    getActiveCommitment: vi.fn(async () => null),
    getRecentV2EventsForAi: vi.fn(async () => []),
  };
});

vi.mock("@/lib/v2-coaching-memory", () => ({
  recomputeV2CoachingMemory: vi.fn(),
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
  buildProofMomentCommitmentReplaced: vi.fn(),
  buildProofMomentCommitmentTightened: vi.fn(),
  decideVictoryRoomSmsCallout: vi.fn(() => ({
    eligible: false,
    appendToReply: null,
    eventPayloadExtras: {},
  })),
  insertSmsCommitmentChangeProofEvent: vi.fn(),
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
  extractCandidateBarsFromSms,
  shouldOpenCommitmentChangeHandoff,
} from "@/lib/v2-sms-commitment-change";
import { applyWave4SmsCommitmentPendingResolution } from "@/lib/v2-sms-commitment-change";
import {
  bootstrapSmsPendingConfirmationFromInbound,
  parseSmsConfirmation,
  tryHandleSmsInboundPendingResolution,
} from "@/lib/v2-sms-pending-resolution-complete";

function commitmentWithPending(
  payload: Record<string, unknown>,
  kind: "commitment_replace" | "commitment_tighten" = "commitment_replace"
): ActiveV2CommitmentRow {
  return {
    id: "cmt_col",
    clerk_user_id: "user_col",
    status: "active",
    behavior_statement: "Phone away at dinner",
    title: "Phone",
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
    pending_resolution_kind: kind,
    pending_resolution_created_at: "2026-05-10T12:00:00.000Z",
    pending_resolution_expires_at: "2027-05-10T12:00:00.000Z",
    pending_resolution_payload: payload,
    updated_at: "2026-05-10T12:00:00.000Z",
    started_at: null,
  };
}

function minimalCommitmentForWave4(): ActiveV2CommitmentRow {
  return {
    id: "cmt_wave4_col",
    clerk_user_id: "user_col",
    status: "active",
    behavior_statement: "Walk daily",
    title: "Walk",
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
    updated_at: null,
    started_at: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mergeSmsPendingResolutionPayload.mockResolvedValue({ ok: true });
});

describe("Slice A3 collisions — handoff gate + Wave 4", () => {
  it("planned interruption blocks handoff even with change-goal phrase", () => {
    expect(
      shouldOpenCommitmentChangeHandoff({
        gatedMode: "commitment_change_handoff",
        userMessage: "change my goal to walking after dinner",
        plannedInterruptionActionable: true,
        classificationEventType: null,
      })
    ).toBe(false);
  });

  it("does not apply Wave 4 pending when intent pack has unsafe candidate", async () => {
    setPendingResolution.mockClear();
    const r = await applyWave4SmsCommitmentPendingResolution({
      commitmentId: "cmt_wave4_col",
      clerkUserId: "user_col",
      commitment: minimalCommitmentForWave4(),
      messageSid: "SMunsafe1",
      rawBody: "change my goal to starve myself",
      intentPack: {
        intent: "sms_replace_request",
        candidateTightenedBar: null,
        candidateNewBar: "starve myself",
        aiConfidence: 0.9,
      },
    });
    expect(r.pendingApplied).toBe(false);
    expect(r.skipReason).toBe("unsafe_goal_content");
    expect(setPendingResolution).not.toHaveBeenCalled();
  });
});

describe("Slice A3 collisions — identity / unsafe bootstrap", () => {
  it('"change my identity to someone who keeps promises" is not a commitment handoff heuristic', async () => {
    const { isLikelyCommitmentChangeIntentTurn } = await import(
      "@/lib/v2-sms-conversation-brain-eligibility"
    );
    const { detectSmsIdentityEditIntent } = await import("@/lib/sms-identity-edit-intent");
    expect(isLikelyCommitmentChangeIntentTurn("Change my identity to someone who keeps promises")).toBe(
      false
    );
    expect(
      detectSmsIdentityEditIntent("Change my identity to someone who keeps promises").shouldRouteToIdentityLane
    ).toBe(true);
  });

  it('"change my goal to be a better dad" does not extract a replace candidate', () => {
    const r = extractCandidateBarsFromSms("change my goal to be a better dad");
    expect(r.candidateNewBar).toBeNull();
    expect(r.candidateTightenedBar).toBeNull();
  });

  it("identity-like goal does not promote to awaiting_confirmation", async () => {
    const c = commitmentWithPending({
      source: "sms_inbound",
      detected_intent: "sms_replace_request",
      raw_user_text: "change my goal to be a better dad",
      inbound_message_sid: "SMidad",
      ai_confidence: null,
      sms_state: "awaiting_candidate",
      candidate_new_bar: null,
    });
    const r = await bootstrapSmsPendingConfirmationFromInbound({
      commitment: c,
      rawBody: "change my goal to be a better dad",
    });
    expect(r.promoted).toBe(false);
    expect(mergeSmsPendingResolutionPayload).not.toHaveBeenCalled();
  });

  it('"change my goal to hurt someone at dinner" does not promote (unsafe)', async () => {
    const c = commitmentWithPending({
      source: "sms_inbound",
      detected_intent: "sms_replace_request",
      raw_user_text: "change my goal to hurt someone at dinner",
      inbound_message_sid: "SMhurt",
      ai_confidence: null,
      sms_state: "awaiting_candidate",
    });
    const r = await bootstrapSmsPendingConfirmationFromInbound({
      commitment: c,
      rawBody: "change my goal to hurt someone at dinner",
    });
    expect(r.promoted).toBe(false);
    expect(r.skipReason).toBe("unsafe");
    expect(mergeSmsPendingResolutionPayload).not.toHaveBeenCalled();
  });
});

describe("Slice A3 collisions — raise_bar bootstrap + YES", () => {
  it("raise_bar with embedded bar in same body can promote when safe (duration-widened extract)", async () => {
    const body = "this is too easy — change my goal to walk 30 minutes daily";
    const c = commitmentWithPending({
      source: "sms_inbound",
      detected_intent: "sms_raise_bar_request",
      raw_user_text: body,
      inbound_message_sid: "SMraise1",
      ai_confidence: null,
      sms_state: "awaiting_candidate",
      candidate_new_bar: "walk 30 minutes daily",
    });
    const r = await bootstrapSmsPendingConfirmationFromInbound({
      commitment: c,
      rawBody: body,
    });
    expect(r.promoted).toBe(true);
    expect(r.candidate).toMatch(/30 minutes daily/i);
  });

  it.each(["raise the bar", "make it harder", "this goal is too easy"])(
    "command-only raise phrase %s does not bootstrap-promote",
    async (phrase) => {
      const c = commitmentWithPending({
        source: "sms_inbound",
        detected_intent: "sms_raise_bar_request",
        raw_user_text: phrase,
        inbound_message_sid: `SMraise_${phrase.slice(0, 8)}`,
        ai_confidence: null,
        sms_state: "awaiting_candidate",
        candidate_new_bar: null,
      });
      const r = await bootstrapSmsPendingConfirmationFromInbound({
        commitment: c,
        rawBody: phrase,
      });
      expect(r.promoted).toBe(false);
      expect(r.skipReason).toBe("raise_bar_missing_candidate");
    }
  );
});

describe('Slice A3 collisions — "no, walking after dinner" documented limitation', () => {
  /**
   * Known limitation: bare NO clears the candidate and returns to awaiting_candidate.
   * A compound "no, <new bar>" is ambiguous — we do not re-extract the trailing bar on the same turn.
   */
  it("parseSmsConfirmation treats compound no+bar as ambiguous (not bare NO)", () => {
    expect(parseSmsConfirmation("no, walking after dinner")).toBe("ambiguous");
    expect(parseSmsConfirmation("no")).toBe("no");
  });

  it("ambiguous no+bar does not RPC and keeps prior candidate on the confirmation turn", async () => {
    const priorCandidate = "Walk 20 minutes after dinner";
    const c = commitmentWithPending({
      source: "sms_inbound",
      detected_intent: "sms_replace_request",
      raw_user_text: "walk",
      inbound_message_sid: "SMnocomma",
      ai_confidence: 0.9,
      sms_state: "awaiting_confirmation",
      candidate_behavior_statement: priorCandidate,
      candidate_new_bar: priorCandidate,
    });
    rpcMock.mockClear();

    const r = await tryHandleSmsInboundPendingResolution({
      job: { message_sid: "SMnocomma", raw_body: "no, walking after dinner" },
      clerkUserId: "user_col",
      commitment: c,
    });

    expect(r.handled).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(mergeSmsPendingResolutionPayload).not.toHaveBeenCalled();
    expect(r.replyBody).toMatch(new RegExp(priorCandidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
