import { beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      insert: (...args: unknown[]) => insertMock(...args),
    }),
  },
}));

import {
  buildRefreshIdentityNoSendTruthPolicyContext,
  persistRefreshTruthOnNoSend,
} from "@/lib/v2-refresh-no-send-truth";

const BASE = {
  commitmentId: "cmt_refresh",
  clerkUserId: "user_refresh",
  inboundMessageSid: "SMrefresh1",
  refreshSessionId: "sess-1",
  stateTransitionSummary: "Test transition",
};

describe("persistRefreshTruthOnNoSend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockResolvedValue({ error: null });
  });

  it("1: identity_still no-send inserts durable audit visible_sent=false", async () => {
    const policy = buildRefreshIdentityNoSendTruthPolicyContext({
      ...BASE,
      refreshIntent: "identity_still_commitment_prompt",
      stateMutationCompletedBeforeSms: true,
      refreshSessionAdvancedBeforeSms: true,
      identityUpdatedBeforeSms: true,
      commitmentPromptDeliveredBeforeSms: false,
    });
    const r = await persistRefreshTruthOnNoSend({
      ...policy,
      noSendStage: "unified_final_guard",
      noSendReason: "rapid_near_duplicate_reply",
    });

    expect(r.refresh_no_send_truth_policy).toBe(true);
    expect(r.refresh_no_send_policy_branch).toBe("refresh_mutation_applied");
    expect(r.visible_sent).toBe(false);
    expect(r.refresh_truth_persisted).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0]![0];
    expect(row.idempotency_key).toBe("v2_sms_refresh_no_send:SMrefresh1");
    expect(row.source).toBe("sms_v2_refresh_no_send");
    expect(row.payload_json.refresh_no_send_truth).toBe(true);
  });

  it("2: identity_still audit includes refresh_session_advanced_before_sms=true", async () => {
    const policy = buildRefreshIdentityNoSendTruthPolicyContext({
      ...BASE,
      refreshIntent: "identity_still_commitment_prompt",
      stateMutationCompletedBeforeSms: true,
      refreshSessionAdvancedBeforeSms: true,
    });
    const r = await persistRefreshTruthOnNoSend({
      ...policy,
      noSendStage: "lane",
      noSendReason: "inbound_lane_no_send",
    });
    expect(r.refresh_session_advanced_before_sms).toBe(true);
  });

  it("3: identity_still audit includes commitment_prompt_delivered_before_sms=false", async () => {
    const policy = buildRefreshIdentityNoSendTruthPolicyContext({
      ...BASE,
      refreshIntent: "identity_still_commitment_prompt",
      stateMutationCompletedBeforeSms: true,
      commitmentPromptDeliveredBeforeSms: false,
    });
    const r = await persistRefreshTruthOnNoSend({
      ...policy,
      noSendStage: "final_voice_gate",
      noSendReason: "final_voice_gate_no_send",
    });
    expect(r.commitment_prompt_delivered_before_sms).toBe(false);
  });

  it("4: identity_change_handoff no-send inserts durable audit", async () => {
    const policy = buildRefreshIdentityNoSendTruthPolicyContext({
      ...BASE,
      refreshIntent: "identity_change_handoff",
      stateMutationCompletedBeforeSms: true,
      pendingCreatedBeforeSms: true,
      refreshClearedBeforeSms: true,
    });
    const r = await persistRefreshTruthOnNoSend({
      ...policy,
      noSendStage: "unified_final_guard",
      noSendReason: "unsupported_accountability_claim",
    });
    expect(r.refresh_no_send_policy_branch).toBe("refresh_pending_or_handoff_created");
    expect(r.pending_created_before_sms).toBe(true);
    expect(r.refresh_cleared_before_sms).toBe(true);
    expect(r.refresh_truth_persisted).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("5: identity_aborted_unclear no-send inserts durable audit", async () => {
    const policy = buildRefreshIdentityNoSendTruthPolicyContext({
      ...BASE,
      refreshIntent: "identity_aborted_unclear",
      stateMutationCompletedBeforeSms: true,
      refreshClearedBeforeSms: true,
    });
    const r = await persistRefreshTruthOnNoSend({
      ...policy,
      noSendStage: "post_unified_truth_recheck",
      noSendReason: "refresh_state_truth_violation_after_unified_guard",
    });
    expect(r.refresh_no_send_policy_branch).toBe("refresh_cleared_or_aborted");
    expect(r.refresh_cleared_before_sms).toBe(true);
    expect(r.refresh_truth_persisted).toBe(true);
  });

  it("6: identity_clarify_prompt no-send telemetry-only", async () => {
    const policy = buildRefreshIdentityNoSendTruthPolicyContext({
      ...BASE,
      refreshIntent: "identity_clarify_prompt",
      stateMutationCompletedBeforeSms: true,
      refreshClarificationConsumedBeforeSms: true,
    });
    const r = await persistRefreshTruthOnNoSend({
      ...policy,
      noSendStage: "lane",
      noSendReason: "inbound_lane_no_send",
    });
    expect(r.refresh_no_send_policy_branch).toBe("refresh_active_clarify");
    expect(r.refresh_clarification_consumed_before_sms).toBe(true);
    expect(r.refresh_truth_persisted).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("7: identity_already_applied no-send telemetry-only", async () => {
    const policy = buildRefreshIdentityNoSendTruthPolicyContext({
      ...BASE,
      refreshIntent: "identity_already_applied",
      stateMutationCompletedBeforeSms: false,
    });
    const r = await persistRefreshTruthOnNoSend({
      ...policy,
      noSendStage: "final_voice_gate",
      noSendReason: "final_voice_gate_no_send",
    });
    expect(r.refresh_no_send_policy_branch).toBe("refresh_noop_already_applied");
    expect(r.refresh_truth_persisted).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("8: identity_inactive_step no-send telemetry-only", async () => {
    const policy = buildRefreshIdentityNoSendTruthPolicyContext({
      ...BASE,
      refreshIntent: "identity_inactive_step",
      stateMutationCompletedBeforeSms: false,
    });
    const r = await persistRefreshTruthOnNoSend({
      ...policy,
      noSendStage: "lane",
      noSendReason: "inbound_lane_no_send",
    });
    expect(r.refresh_no_send_policy_branch).toBe("refresh_failed_before_mutation");
    expect(r.refresh_truth_persisted).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("9: duplicate refresh no-send audit safe", async () => {
    insertMock.mockResolvedValueOnce({ error: { code: "23505", message: "duplicate" } });
    const policy = buildRefreshIdentityNoSendTruthPolicyContext({
      ...BASE,
      refreshIntent: "identity_still_commitment_prompt",
      stateMutationCompletedBeforeSms: true,
    });
    const r = await persistRefreshTruthOnNoSend({
      ...policy,
      noSendStage: "unified_final_guard",
      noSendReason: "rapid_near_duplicate_reply",
    });
    expect(r.refresh_truth_persisted).toBe(true);
    expect(r.refresh_no_send_duplicate).toBe(true);
  });

  it("10: send_time_engagement_recorded_before_sms false after move", async () => {
    const policy = buildRefreshIdentityNoSendTruthPolicyContext({
      ...BASE,
      refreshIntent: "identity_still_commitment_prompt",
      stateMutationCompletedBeforeSms: true,
    });
    const r = await persistRefreshTruthOnNoSend({
      ...policy,
      noSendStage: "unified_final_guard",
      noSendReason: "rapid_near_duplicate_reply",
      sendTimeEngagementRecordedBeforeSms: false,
    });
    expect(r.send_time_engagement_recorded_before_sms).toBeUndefined();
  });
});
