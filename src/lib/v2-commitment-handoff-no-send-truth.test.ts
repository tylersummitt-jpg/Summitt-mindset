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
  buildCommitmentHandoffNoSendTruthPolicyContext,
  persistCommitmentHandoffTruthOnNoSend,
} from "@/lib/v2-commitment-handoff-no-send-truth";
import type { InboundV3CommitmentChangeFacts } from "@/lib/v3-inbound-relationship-lane";

const BASE_FACTS: InboundV3CommitmentChangeFacts = {
  detected_intent_type: "sms_tighten_request",
  current_commitment_snapshot: "title:Morning | behavior:Deep work",
  requested_change_summary: "Make it smaller",
  pending_resolution_created: true,
  pending_resolution_type: "commitment_tighten",
  pending_resolution_skip_reason: null,
  pending_resolution_apply_exception: null,
  existing_pending_resolution: false,
  candidate_tightened_bar_preview: "20 minutes reading",
  candidate_new_bar_preview: null,
  server_state_transition_summary: "pending_resolution_upserted:commitment_tighten;bootstrap:awaiting_confirmation",
  required_meaning_summary: "Pending created.",
  legacy_commitment_change_reply_preview: "preview",
  append_note_preview: null,
  inbound_message_sid: "SMhandoff1",
};

function policyFromFacts(overrides?: Partial<InboundV3CommitmentChangeFacts>) {
  return buildCommitmentHandoffNoSendTruthPolicyContext({
    commitmentChangeFacts: { ...BASE_FACTS, ...overrides },
    commitmentId: "cmt_handoff",
    clerkUserId: "user_handoff",
    inboundMessageSid: "SMhandoff1",
  });
}

describe("persistCommitmentHandoffTruthOnNoSend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockResolvedValue({ error: null });
  });

  it("1: handoff_pending_created no-send inserts visible_sent=false audit", async () => {
    const policy = policyFromFacts();
    const r = await persistCommitmentHandoffTruthOnNoSend({
      ...policy,
      noSendStage: "unified_final_guard",
      noSendReason: "rapid_near_duplicate_reply",
    });

    expect(r.commitment_handoff_no_send_truth_policy).toBe(true);
    expect(r.handoff_no_send_policy_branch).toBe("handoff_pending_created");
    expect(r.commitment_handoff_visible_sent).toBe(false);
    expect(r.visible_sent).toBe(false);
    expect(r.state_mutation_completed_before_sms).toBe(true);
    expect(r.handoff_pending_created).toBe(true);
    expect(r.commitment_handoff_truth_persisted).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0]![0];
    expect(row.idempotency_key).toBe("v2_sms_commitment_handoff_no_send:SMhandoff1");
    expect(row.event_type).toBe("sms_memory_signal");
    expect(row.source).toBe("sms_v2_commitment_handoff_no_send");
    expect(row.payload_json.commitment_handoff_no_send_truth).toBe(true);
  });

  it("2: handoff_pending_created includes pending_resolution_kind", async () => {
    const policy = policyFromFacts();
    const r = await persistCommitmentHandoffTruthOnNoSend({
      ...policy,
      noSendStage: "final_voice_gate",
      noSendReason: "final_voice_gate_no_send",
    });

    expect(r.pending_resolution_kind).toBe("commitment_tighten");
    expect(r.final_voice_gate_skip_reason).toBe("final_voice_gate_no_send");
  });

  it("3: handoff_pending_created includes bootstrap_promoted when true", async () => {
    const policy = policyFromFacts();
    const r = await persistCommitmentHandoffTruthOnNoSend({
      ...policy,
      noSendStage: "lane",
      noSendReason: "inbound_lane_no_send",
    });

    expect(r.bootstrap_promoted).toBe(true);
  });

  it("4: duplicate no-send audit safe", async () => {
    insertMock.mockResolvedValueOnce({ error: { code: "23505", message: "duplicate" } });
    const policy = policyFromFacts();
    const r = await persistCommitmentHandoffTruthOnNoSend({
      ...policy,
      noSendStage: "unified_final_guard",
      noSendReason: "unsupported_accountability_claim",
    });

    expect(r.commitment_handoff_no_send_duplicate).toBe(true);
  });

  it("5: handoff_no_mutation telemetry-only", async () => {
    const policy = policyFromFacts({
      pending_resolution_created: false,
      pending_resolution_type: null,
      server_state_transition_summary: "pending_resolution_skipped:soft_quit",
      pending_resolution_skip_reason: "soft_quit",
    });
    const r = await persistCommitmentHandoffTruthOnNoSend({
      ...policy,
      noSendStage: "lane",
      noSendReason: "inbound_lane_no_send",
    });

    expect(r.handoff_no_send_policy_branch).toBe("handoff_no_mutation");
    expect(r.commitment_handoff_truth_persisted).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("6: handoff_failed_before_mutation telemetry-only", async () => {
    const policy = policyFromFacts({
      pending_resolution_created: false,
      pending_resolution_apply_exception: "rpc_timeout",
      server_state_transition_summary: "pending_resolution_apply_failed:rpc_timeout",
    });
    const r = await persistCommitmentHandoffTruthOnNoSend({
      ...policy,
      noSendStage: "lane",
      noSendReason: "inbound_lane_no_send",
    });

    expect(r.handoff_no_send_policy_branch).toBe("handoff_failed_before_mutation");
    expect(r.commitment_handoff_truth_persisted).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("7: handoff_clarify_pending telemetry-only", async () => {
    const policy = policyFromFacts({
      pending_resolution_created: false,
      existing_pending_resolution: true,
      server_state_transition_summary: "pending_resolution_skipped:existing_pending",
      pending_resolution_skip_reason: "existing_pending",
    });
    const r = await persistCommitmentHandoffTruthOnNoSend({
      ...policy,
      noSendStage: "final_voice_gate",
      noSendReason: "final_voice_gate_no_send",
    });

    expect(r.handoff_no_send_policy_branch).toBe("handoff_clarify_pending");
    expect(r.commitment_handoff_truth_persisted).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("8: side_effects_recorded_before_sms metadata included", async () => {
    const policy = policyFromFacts();
    const r = await persistCommitmentHandoffTruthOnNoSend({
      ...policy,
      noSendStage: "final_voice_gate",
      noSendReason: "final_voice_gate_no_send",
      sideEffectsRecordedBeforeSms: true,
      memoryMergedIntoPendingBeforeSms: true,
      sendTimeEngagementRecordedBeforeSms: false,
    });

    expect(r.side_effects_recorded_before_sms).toBe(true);
    expect(r.memory_merged_into_pending_before_sms).toBe(true);
    expect(r.send_time_engagement_recorded_before_sms).toBeUndefined();
    expect(r.commitment_handoff_truth_persisted).toBe(true);
  });
});
