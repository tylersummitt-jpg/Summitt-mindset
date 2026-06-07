import { beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      insert: (...args: unknown[]) => insertMock(...args),
    }),
  },
}));

import { persistPendingResolutionTruthOnNoSend } from "@/lib/v2-pending-resolution-no-send-truth";

const BASE = {
  commitmentId: "cmt_pr",
  clerkUserId: "user_pr",
  inboundMessageSid: "SMpending1",
  pendingResolutionKind: "commitment_replace" as const,
  pendingResolutionApplied: true,
  stateMutationCompletedBeforeSms: true,
  pendingClearedBeforeSms: true,
  pendingStillActiveAfterPhase1: false,
  stateTransitionSummary: "Replace applied before visible SMS.",
  seasonTransitionFacts: null,
};

describe("persistPendingResolutionTruthOnNoSend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockResolvedValue({ error: null });
  });

  it("A: mutation_applied replace no-send persists audit with visible_sent=false", async () => {
    const r = await persistPendingResolutionTruthOnNoSend({
      ...BASE,
      policyBranch: "mutation_applied",
      noSendStage: "unified_final_guard",
      noSendReason: "rapid_near_duplicate_reply",
    });

    expect(r.pending_resolution_no_send_truth_policy).toBe(true);
    expect(r.pending_no_send_policy_branch).toBe("mutation_applied");
    expect(r.pending_resolution_visible_sent).toBe(false);
    expect(r.visible_sent).toBe(false);
    expect(r.state_mutation_completed_before_sms).toBe(true);
    expect(r.pending_resolution_applied).toBe(true);
    expect(r.pending_resolution_truth_persisted).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0]![0];
    expect(row.idempotency_key).toBe("v2_sms_pending_resolution_no_send:SMpending1");
    expect(row.event_type).toBe("sms_memory_signal");
    expect(row.payload_json.pending_resolution_no_send_truth).toBe(true);
  });

  it("B: mutation_applied tighten no-send persists audit", async () => {
    const r = await persistPendingResolutionTruthOnNoSend({
      ...BASE,
      policyBranch: "mutation_applied",
      pendingResolutionKind: "commitment_tighten",
      noSendStage: "final_voice_gate",
      noSendReason: "final_voice_gate_no_send",
    });

    expect(r.pending_resolution_kind).toBe("commitment_tighten");
    expect(r.pending_resolution_truth_persisted).toBe(true);
    expect(r.final_voice_gate_skip_reason).toBe("final_voice_gate_no_send");
  });

  it("C: pending_cleared_no_mutation cancel no-send records clear without rollback", async () => {
    const r = await persistPendingResolutionTruthOnNoSend({
      ...BASE,
      policyBranch: "pending_cleared_no_mutation",
      pendingResolutionApplied: false,
      stateMutationCompletedBeforeSms: true,
      pendingClearedBeforeSms: true,
      pendingStillActiveAfterPhase1: false,
      noSendStage: "lane",
      noSendReason: "inbound_lane_no_send",
    });

    expect(r.pending_cleared_before_sms).toBe(true);
    expect(r.pending_resolution_truth_persisted).toBe(true);
    expect(r.clear_pending_only).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("D: pending_active_clarify no-send is telemetry only", async () => {
    const r = await persistPendingResolutionTruthOnNoSend({
      ...BASE,
      policyBranch: "pending_active_clarify",
      pendingResolutionApplied: false,
      stateMutationCompletedBeforeSms: false,
      pendingClearedBeforeSms: false,
      pendingStillActiveAfterPhase1: true,
      pendingProgressed: true,
      noSendStage: "unified_final_guard",
      noSendReason: "pending_resolution_truth_violation_after_final_guard",
    });

    expect(r.pending_still_active_after_no_send).toBe(true);
    expect(r.pending_resolution_truth_persisted).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("E: reject/no reset candidate no-send keeps pending active", async () => {
    const r = await persistPendingResolutionTruthOnNoSend({
      ...BASE,
      policyBranch: "pending_active_clarify",
      pendingResolutionApplied: false,
      stateMutationCompletedBeforeSms: true,
      pendingClearedBeforeSms: false,
      pendingStillActiveAfterPhase1: true,
      pendingProgressed: true,
      noSendStage: "lane",
      noSendReason: "inbound_lane_no_send",
    });

    expect(r.pending_resolution_progressed).toBe(true);
    expect(r.pending_resolution_truth_persisted).toBe(false);
  });

  it("F: duplicate event insert is idempotent-safe", async () => {
    insertMock.mockResolvedValueOnce({ error: { code: "23505", message: "duplicate" } });
    const r = await persistPendingResolutionTruthOnNoSend({
      ...BASE,
      policyBranch: "mutation_applied",
      noSendStage: "unified_final_guard",
      noSendReason: "unsupported_accountability_claim",
    });

    expect(r.pending_resolution_truth_duplicate).toBe(true);
  });
});
