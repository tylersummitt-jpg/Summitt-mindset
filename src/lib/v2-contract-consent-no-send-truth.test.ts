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
  buildContractConsentNoSendTruthPolicyContext,
  persistContractConsentTruthOnNoSend,
} from "@/lib/v2-contract-consent-no-send-truth";
import type { InboundV3ContractConsentFacts } from "@/lib/v3-inbound-relationship-lane";

const BASE_FACTS: InboundV3ContractConsentFacts = {
  consent_parse: "user_yes",
  latest_outbound_was_proposal: true,
  proposal_kind: "adaptive_overlay",
  proposal_text_digest: "Morning walk",
  overlay_action: "activated",
  rpc_result: "applied",
  server_state_transition_summary: "RPC applied adaptive overlay.",
  required_verbatim_substrings: ["Morning walk"],
  required_meaning_summary: "Acknowledge acceptance.",
  legacy_contract_ack_preview: "preview",
  inbound_message_sid: "SMcontract1",
  proposal_expires_at: null,
};

function policyFromFacts(
  overlayAction: InboundV3ContractConsentFacts["overlay_action"],
  stateMutationCompletedBeforeSms: boolean
) {
  return buildContractConsentNoSendTruthPolicyContext({
    contractConsentFacts: { ...BASE_FACTS, overlay_action: overlayAction },
    stateMutationCompletedBeforeSms,
    commitmentId: "cmt_cc",
    clerkUserId: "user_cc",
    inboundMessageSid: "SMcontract1",
    proposalStillActive: false,
  });
}

describe("persistContractConsentTruthOnNoSend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockResolvedValue({ error: null });
  });

  it("1: contract_mutation_applied no-send inserts visible_sent=false audit", async () => {
    const policy = policyFromFacts("activated", true);
    const r = await persistContractConsentTruthOnNoSend({
      ...policy,
      noSendStage: "unified_final_guard",
      noSendReason: "rapid_near_duplicate_reply",
    });

    expect(r.contract_consent_no_send_truth_policy).toBe(true);
    expect(r.contract_no_send_policy_branch).toBe("contract_mutation_applied");
    expect(r.contract_consent_visible_sent).toBe(false);
    expect(r.visible_sent).toBe(false);
    expect(r.state_mutation_completed_before_sms).toBe(true);
    expect(r.contract_consent_applied).toBe(true);
    expect(r.contract_consent_truth_persisted).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0]![0];
    expect(row.idempotency_key).toBe("v2_sms_contract_consent_no_send:SMcontract1");
    expect(row.event_type).toBe("sms_memory_signal");
    expect(row.payload_json.contract_consent_no_send_truth).toBe(true);
  });

  it("2: contract_declined_or_cleared no-send inserts visible_sent=false audit", async () => {
    const policy = policyFromFacts("declined", true);
    const r = await persistContractConsentTruthOnNoSend({
      ...policy,
      contractConsentApplied: false,
      proposalCleared: true,
      noSendStage: "final_voice_gate",
      noSendReason: "final_voice_gate_no_send",
    });

    expect(r.contract_no_send_policy_branch).toBe("contract_declined_or_cleared");
    expect(r.proposal_cleared).toBe(true);
    expect(r.contract_consent_truth_persisted).toBe(true);
    expect(r.final_voice_gate_skip_reason).toBe("final_voice_gate_no_send");
  });

  it("3: contract_noop_already_applied no-send inserts light audit", async () => {
    const policy = policyFromFacts("noop_already_applied", true);
    const r = await persistContractConsentTruthOnNoSend({
      ...policy,
      contractConsentApplied: false,
      contractNoop: true,
      noSendStage: "lane",
      noSendReason: "inbound_lane_no_send",
    });

    expect(r.contract_no_send_policy_branch).toBe("contract_noop_already_applied");
    expect(r.already_finalized).toBe(true);
    expect(r.state_mutation_completed_before_sms).toBe(false);
    expect(r.contract_consent_truth_persisted).toBe(true);
  });

  it("4: contract_pending_active_clarify telemetry only", async () => {
    const policy = policyFromFacts("noop_not_found", false);
    const r = await persistContractConsentTruthOnNoSend({
      ...policy,
      proposalStillActive: true,
      noSendStage: "unified_final_guard",
      noSendReason: "contract_state_truth_violation_after_unified_guard",
    });

    expect(r.contract_no_send_policy_branch).toBe("contract_pending_active_clarify");
    expect(r.proposal_still_active).toBe(true);
    expect(r.contract_consent_truth_persisted).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("5: duplicate no-send audit safe", async () => {
    insertMock.mockResolvedValueOnce({ error: { code: "23505", message: "duplicate" } });
    const policy = policyFromFacts("activated", true);
    const r = await persistContractConsentTruthOnNoSend({
      ...policy,
      noSendStage: "unified_final_guard",
      noSendReason: "unsupported_accountability_claim",
    });

    expect(r.contract_consent_no_send_duplicate).toBe(true);
  });
});
