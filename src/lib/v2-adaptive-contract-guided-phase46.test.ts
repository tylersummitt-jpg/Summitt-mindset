import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  adaptiveProposalBindingNeedlePrefix,
  latestOutboundBodyContainsAdaptiveProposalBindingNeedle,
  shouldConsumeInboundAsContractProposalConsent,
} from "@/lib/v2-contract-consent-routing";

const sendSMSMock = vi.hoisted(() =>
  vi.fn(async () => ({ sid: "SM_guided_test_1", status: "queued" as const }))
);

const buildShrinkMock = vi.hoisted(() => vi.fn());

const finalizeNorthStarCoachSmsAsyncMock = vi.hoisted(() =>
  vi.fn(async (args: { proposedBody: string }) => ({
    visibleBody: args.proposedBody,
    meta: { source: "approved" as const, blockedReasons: [] as string[] },
  }))
);

const applyFinalVoiceOwnershipGateMock = vi.hoisted(() => vi.fn());

const applyUnifiedSmsFinalProductLawGuardMock = vi.hoisted(() =>
  vi.fn(async (args: { outboundDaily?: { body: string } }) => ({
    should_send: true,
    shouldSend: true,
    body: args.outboundDaily?.body?.trim() ?? "",
    no_send_reason: null,
    noSendReason: null,
    final_body_authority: "unified_final_product_law_guard",
    guard_version: "test",
    guard_mode: "outbound_daily",
    checks_run: ["contract_proposal_truth_recheck"],
    checks_skipped: [],
    guard_results: {
      inbound_coach_final_body_guards: null,
      transactional_coaching_limited: null,
    },
    repair_attempts: 0,
    repair_succeeded: null,
    metadata: { unified_final_guard_mode: "outbound_daily" },
    tuGuard: null,
    prematureAdjustmentGuard: null,
    truthGuard: null,
    nearDuplicateGuard: null,
  }))
);

const getV2CommitmentByIdForCoachingMock = vi.hoisted(() => vi.fn());

const commitmentEventInserts: unknown[] = [];

function makeCommitmentUpdateChain() {
  const chain: Record<string, unknown> = {
    eq: vi.fn(function (this: unknown) {
      return chain;
    }),
    is: vi.fn(function (this: unknown) {
      return chain;
    }),
    select: vi.fn(() => ({
      maybeSingle: vi.fn(async () => ({
        data: { updated_at: "2026-05-10T12:00:01.000Z" },
        error: null,
      })),
    })),
  };
  return chain;
}

vi.mock("@/lib/twilio", () => ({
  isTwilioReady: vi.fn(() => true),
  sendSMS: sendSMSMock,
}));

vi.mock("@/lib/v2-sms-accountability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-sms-accountability")>();
  return {
    ...actual,
    buildV2ShrinkProposalOutboundSms: buildShrinkMock,
  };
});

vi.mock("@/lib/north-star-coach-sms-openai", () => ({
  finalizeNorthStarCoachSmsAsync: finalizeNorthStarCoachSmsAsyncMock,
}));

vi.mock("@/lib/v3-sms-voice-ownership", () => ({
  applyFinalVoiceOwnershipGate: applyFinalVoiceOwnershipGateMock,
}));

vi.mock("@/lib/sms-final-product-law-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sms-final-product-law-guard")>();
  return {
    ...actual,
    applyUnifiedSmsFinalProductLawGuard: applyUnifiedSmsFinalProductLawGuardMock,
  };
});

vi.mock("@/lib/sms-relationship-memory-packet", () => ({
  buildSmsRelationshipMemoryPacket: vi.fn(async () => ({
    last_outbound_full_body: null,
    recent_exact_thread_72h: {},
  })),
}));

vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: vi.fn(async () => ({})),
}));

vi.mock("@/lib/v2-commitment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-commitment")>();
  return {
    ...actual,
    getV2CommitmentByIdForCoaching: getV2CommitmentByIdForCoachingMock,
  };
});

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn((table: string) => {
      if (table === "v2_commitment") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: {
                  adaptive_ask_expires_at: null,
                  adaptive_proposal_expires_at: null,
                  adaptive_proposal_text: null,
                  adaptive_ask_text: null,
                },
                error: null,
              })),
            })),
          })),
          update: vi.fn(() => makeCommitmentUpdateChain()),
        };
      }
      if (table === "sms_identities") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: {
                  phone_number: "+15555550123",
                  sms_enabled: true,
                  stopped_at: null,
                },
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === "v2_commitment_event") {
        return {
          insert: vi.fn((row: unknown) => {
            commitmentEventInserts.push(row);
            return Promise.resolve({ error: null });
          }),
        };
      }
      return {};
    }),
  },
}));

import { proposeShrinkAskFromGuidedResolution } from "@/lib/v2-adaptive-contract";

const BINDING = "Walk ten minutes daily";

function stubCommitment(): ActiveV2CommitmentRow {
  return {
    id: "cmt_guided_phase46",
    clerk_user_id: "user_phase46",
    status: "active",
    behavior_statement: "Two hours of deep work each morning",
    title: "Deep work",
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
    updated_at: "2026-05-10T12:00:00.000Z",
    started_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("Phase 4.6 — guided contract proposal SMS (snapshot + needle + metadata)", () => {
  const envSnapshot = { ...process.env };

  beforeEach(() => {
    process.env = { ...envSnapshot };
    delete process.env.SMS_DRY_RUN;
    vi.clearAllMocks();
    commitmentEventInserts.length = 0;
    getV2CommitmentByIdForCoachingMock.mockResolvedValue(stubCommitment());
    buildShrinkMock.mockResolvedValue({
      body: `Let’s simplify for a bit: ${BINDING} Want me to hold you to that? A clear yes or no is enough.`,
      northStarReplySource: "v3_adaptive_proposal_refined",
      templateId: 61,
    });
    finalizeNorthStarCoachSmsAsyncMock.mockImplementation(async (args: { proposedBody: string }) => ({
      visibleBody: args.proposedBody,
      meta: { source: "approved", blockedReasons: [] },
    }));
    applyFinalVoiceOwnershipGateMock.mockResolvedValue({
      shouldSend: true,
      body: `Let’s simplify for a bit: ${BINDING} Want me to hold you to that? A clear yes or no is enough.`,
      metadata: { final_voice_gate_test: true },
      voiceOwner: "v3_machine_refine",
      source: "test",
      v3Owned: true,
      repaired: false,
      emergencyFallbackUsed: false,
      blockedReasons: [],
    });
  });

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("success: sendSMS upserts last-outbound context (no skip) and passes binding needle", async () => {
    const r = await proposeShrinkAskFromGuidedResolution({
      commitmentId: "cmt_guided_phase46",
      clerkUserId: "user_phase46",
      proposalBindingText: BINDING,
      originalBehaviorStatement: stubCommitment().behavior_statement,
    });
    expect(r.ok).toBe(true);
    expect(sendSMSMock).toHaveBeenCalledTimes(1);
    const sendArg = sendSMSMock.mock.calls[0]![0] as {
      body: string;
      lastOutbound?: { skipLastOutboundContextUpsert?: boolean; fullBodyForContext?: string };
    };
    expect(sendArg.lastOutbound?.skipLastOutboundContextUpsert).not.toBe(true);
    expect(sendArg.lastOutbound?.fullBodyForContext).toBe(sendArg.body);
    expect(latestOutboundBodyContainsAdaptiveProposalBindingNeedle(sendArg.body, BINDING)).toBe(true);

    const lastInsert = commitmentEventInserts.at(-1) as { payload_json?: Record<string, unknown> } | undefined;
    expect(lastInsert?.payload_json?.guided_contract_sms_policy).toBe("option_a_v3_refine_fvg_fail_closed");
    expect(lastInsert?.payload_json?.binding_text_server_owned).toBe(true);
    expect(lastInsert?.payload_json?.binding_needle_verified).toBe(true);
    expect(lastInsert?.payload_json?.sms_last_outbound_context_updated).toBe(true);
    expect(lastInsert?.payload_json?.sms_last_outbound_context_update_method).toBe("sendSMS");
    expect(lastInsert?.payload_json?.twilio_send_attempted).toBe(true);
    expect(lastInsert?.payload_json?.final_voice_gate).toEqual({ final_voice_gate_test: true });
    expect(lastInsert?.payload_json?.final_body_authority).toBe("unified_final_product_law_guard");
    expect(lastInsert?.payload_json?.binding_needle_stage).toBe("post_unified_guard");
    expect(lastInsert?.payload_json?.visible_sent).toBe(true);
    expect(applyUnifiedSmsFinalProductLawGuardMock).toHaveBeenCalledTimes(1);
    const guardCall = applyUnifiedSmsFinalProductLawGuardMock.mock.calls[0]![0] as {
      mode?: string;
      routePurpose?: string;
    };
    expect(guardCall.mode).toBe("outbound_daily");
    expect(guardCall.routePurpose).toBe("guided_shrink_contract_prompt");
    const guardResult = await applyUnifiedSmsFinalProductLawGuardMock.mock.results[0]!.value;
    expect(sendArg.body).toBe(guardResult.body);
  });

  it("missing binding needle: no Twilio send, rollback, guided_contract_binding_needle_missing", async () => {
    applyFinalVoiceOwnershipGateMock.mockResolvedValue({
      shouldSend: true,
      body: "Friendly wrapper with no embedded binding phrase that matches.",
      metadata: {},
      voiceOwner: "unknown",
      source: "test",
      v3Owned: false,
      repaired: false,
      emergencyFallbackUsed: false,
      blockedReasons: [],
    });
    const r = await proposeShrinkAskFromGuidedResolution({
      commitmentId: "cmt_guided_phase46",
      clerkUserId: "user_phase46",
      proposalBindingText: BINDING,
      originalBehaviorStatement: stubCommitment().behavior_statement,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error).toBe("guided_contract_binding_needle_missing");
    expect(sendSMSMock).not.toHaveBeenCalled();
    const { supabaseServer } = await import("@/lib/supabase-server");
    const fromMock = vi.mocked(supabaseServer.from);
    const updateCalls = fromMock.mock.results
      .map((r) => (r.value as { update?: unknown })?.update)
      .filter(Boolean);
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("unified guard no-send does not call Twilio and rolls back reservation", async () => {
    applyUnifiedSmsFinalProductLawGuardMock.mockResolvedValueOnce({
      should_send: false,
      shouldSend: false,
      body: "",
      no_send_reason: "daily_contract_proposal_false_state_claim_after_unified_guard",
      noSendReason: "daily_contract_proposal_false_state_claim_after_unified_guard",
      final_body_authority: "unified_final_product_law_guard",
      guard_version: "test",
      guard_mode: "outbound_daily",
      checks_run: ["contract_proposal_truth_recheck"],
      checks_skipped: [],
      guard_results: {
        inbound_coach_final_body_guards: null,
        transactional_coaching_limited: null,
      },
      repair_attempts: 0,
      repair_succeeded: null,
      metadata: { unified_final_guard_mode: "outbound_daily" },
      tuGuard: null,
      prematureAdjustmentGuard: null,
      truthGuard: null,
      nearDuplicateGuard: null,
    });
    const r = await proposeShrinkAskFromGuidedResolution({
      commitmentId: "cmt_guided_phase46",
      clerkUserId: "user_phase46",
      proposalBindingText: BINDING,
      originalBehaviorStatement: stubCommitment().behavior_statement,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error).toBe("unified_final_guard_no_send");
    expect(sendSMSMock).not.toHaveBeenCalled();
    expect(commitmentEventInserts.length).toBe(0);
  });

  it("FVG no-send does not call Twilio or unified guard", async () => {
    applyFinalVoiceOwnershipGateMock.mockResolvedValue({
      shouldSend: false,
      body: "",
      metadata: { blocked: true },
      voiceOwner: "unknown",
      source: "test",
      v3Owned: false,
      repaired: false,
      emergencyFallbackUsed: false,
      blockedReasons: ["test"],
    });
    const r = await proposeShrinkAskFromGuidedResolution({
      commitmentId: "cmt_guided_phase46",
      clerkUserId: "user_phase46",
      proposalBindingText: BINDING,
      originalBehaviorStatement: stubCommitment().behavior_statement,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error).toBe("final_voice_gate_no_send");
    expect(sendSMSMock).not.toHaveBeenCalled();
    expect(applyUnifiedSmsFinalProductLawGuardMock).not.toHaveBeenCalled();
  });

  it("send failure clears reservation and does not finalize success", async () => {
    sendSMSMock.mockRejectedValueOnce(new Error("twilio unavailable"));
    const r = await proposeShrinkAskFromGuidedResolution({
      commitmentId: "cmt_guided_phase46",
      clerkUserId: "user_phase46",
      proposalBindingText: BINDING,
      originalBehaviorStatement: stubCommitment().behavior_statement,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error).toBe("sms_send_failed");
    expect(commitmentEventInserts.length).toBe(0);
  });

  it("dry-run skips Twilio and last-outbound context metadata", async () => {
    process.env.SMS_DRY_RUN = "true";
    const r = await proposeShrinkAskFromGuidedResolution({
      commitmentId: "cmt_guided_phase46",
      clerkUserId: "user_phase46",
      proposalBindingText: BINDING,
      originalBehaviorStatement: stubCommitment().behavior_statement,
    });
    expect(r.ok).toBe(true);
    expect(sendSMSMock).not.toHaveBeenCalled();
    const guidedNsCalls = finalizeNorthStarCoachSmsAsyncMock.mock.calls.filter(
      (c) => (c[0] as { channel?: string }).channel === "guided_contract_proposal"
    );
    expect(guidedNsCalls.length).toBe(0);
    const lastInsert = commitmentEventInserts.at(-1) as { payload_json?: Record<string, unknown> } | undefined;
    expect(lastInsert?.payload_json?.sms_last_outbound_context_update_method).toBe("dry_run_skipped");
    expect(lastInsert?.payload_json?.sms_last_outbound_context_updated).toBe(false);
    expect(lastInsert?.payload_json?.twilio_send_attempted).toBe(false);
    expect(lastInsert?.payload_json?.binding_needle_verified).toBe(true);
  });

  it("dry-run fails needle check when builder body omits binding", async () => {
    process.env.SMS_DRY_RUN = "true";
    buildShrinkMock.mockResolvedValueOnce({
      body: "No binding text here at all.",
      northStarReplySource: "v3_adaptive_proposal_refined",
      templateId: 61,
    });
    const r = await proposeShrinkAskFromGuidedResolution({
      commitmentId: "cmt_guided_phase46",
      clerkUserId: "user_phase46",
      proposalBindingText: BINDING,
      originalBehaviorStatement: stubCommitment().behavior_statement,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.error).toBe("guided_contract_binding_needle_missing");
  });

  it("inbound consent routing: bare YES consumes after final body stored as latest outbound", () => {
    const finalBody = `Let’s simplify for a bit: ${BINDING} Want me to hold you to that? A clear yes or no is enough.`;
    expect(
      shouldConsumeInboundAsContractProposalConsent({
        inboundBody: "yes",
        proposalText: BINDING,
        latestOutboundBody: finalBody,
      })
    ).toBe(true);
  });

  it("forwards protected v3_adaptive_proposal_refined into guided_contract_proposal North Star pass", async () => {
    await proposeShrinkAskFromGuidedResolution({
      commitmentId: "cmt_guided_phase46",
      clerkUserId: "user_phase46",
      proposalBindingText: BINDING,
      originalBehaviorStatement: stubCommitment().behavior_statement,
    });
    const guidedCalls = finalizeNorthStarCoachSmsAsyncMock.mock.calls.filter(
      (c) => (c[0] as { channel?: string }).channel === "guided_contract_proposal"
    );
    expect(guidedCalls.length).toBe(1);
    expect((guidedCalls[0]![0] as { replySource?: string }).replySource).toBe("v3_adaptive_proposal_refined");
  });
});

describe("adaptiveProposalBindingNeedlePrefix", () => {
  it("matches latestOutboundBodyContainsAdaptiveProposalBindingNeedle contract", () => {
    const proposal = "  Run 20 minutes  ";
    const needle = adaptiveProposalBindingNeedlePrefix(proposal);
    expect(needle.length).toBeLessThanOrEqual(32);
    const body = `Heads up: ${proposal.trim()} — yes or no?`;
    expect(latestOutboundBodyContainsAdaptiveProposalBindingNeedle(body, proposal)).toBe(true);
    expect(body.toLowerCase().replace(/\s+/g, " ").includes(needle)).toBe(true);
  });
});
