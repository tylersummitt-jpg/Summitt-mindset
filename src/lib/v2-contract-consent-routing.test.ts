import { describe, expect, it } from "vitest";

import {
  diagnoseOutboundSupportsPendingAdaptiveProposalContext,
  latestOutboundBodyContainsAdaptiveProposalBindingNeedle,
  shouldConsumeInboundAsContractProposalConsent,
} from "@/lib/v2-contract-consent-routing";
import {
  DAILY_SEMANTIC_CONTRACT_PROPOSAL_VERSION,
  type SemanticDailyOutboundSnapshotCandidate,
} from "@/lib/v3-daily-contract-proposal-semantic";

describe("shouldConsumeInboundAsContractProposalConsent", () => {
  const proposal = "Today only: 30 minutes of deep work";

  it("latest outbound contains proposal binding + inbound Yes => true", () => {
    expect(
      shouldConsumeInboundAsContractProposalConsent({
        inboundBody: "Yes",
        proposalText: proposal,
        latestOutboundBody: `Let’s simplify for a bit: ${proposal} Want me to hold you to that? Yes or no.`,
      })
    ).toBe(true);
  });

  it('latest outbound is a later follow-up ("How did the hour go?") + inbound Yes => false', () => {
    expect(
      shouldConsumeInboundAsContractProposalConsent({
        inboundBody: "Yes",
        proposalText: proposal,
        latestOutboundBody: "How did the hour go?",
      })
    ).toBe(false);
  });

  it('latest outbound is another follow-up ("What helped you stay focused?") + inbound Yes => false', () => {
    expect(
      shouldConsumeInboundAsContractProposalConsent({
        inboundBody: "Yes",
        proposalText: proposal,
        latestOutboundBody: "What helped you stay focused?",
      })
    ).toBe(false);
  });

  it("latest outbound empty/null + inbound Yes => false", () => {
    expect(
      shouldConsumeInboundAsContractProposalConsent({
        inboundBody: "Yes",
        proposalText: proposal,
        latestOutboundBody: "",
      })
    ).toBe(false);
    expect(
      shouldConsumeInboundAsContractProposalConsent({
        inboundBody: "Yes",
        proposalText: proposal,
        latestOutboundBody: null,
      })
    ).toBe(false);
  });

  it("inbound completion/proof message is not treated as consent unless latest outbound is the proposal prompt", () => {
    // Even though this classifies as user_yes, consent is blocked because latest outbound isn't proposal prompt.
    expect(
      shouldConsumeInboundAsContractProposalConsent({
        inboundBody: "1 hour sounds good. I actually already got it done!",
        proposalText: proposal,
        latestOutboundBody: "How did the hour go?",
      })
    ).toBe(false);
  });

  it("latestOutboundBodyContainsAdaptiveProposalBindingNeedle mirrors consent needle rule", () => {
    expect(
      latestOutboundBodyContainsAdaptiveProposalBindingNeedle(
        `Let’s simplify for a bit: ${proposal} Want me to hold you to that? Yes or no.`,
        proposal
      )
    ).toBe(true);
    expect(latestOutboundBodyContainsAdaptiveProposalBindingNeedle("How did the hour go?", proposal)).toBe(false);
  });
});

describe("diagnoseOutboundSupportsPendingAdaptiveProposalContext", () => {
  const proposal = "Today only: 30 minutes of deep work";
  const nowMs = Date.parse("2026-05-20T12:00:00.000Z");

  function snapshot(args: Partial<SemanticDailyOutboundSnapshotCandidate>): SemanticDailyOutboundSnapshotCandidate {
    return {
      message_sid: "SM_out_001",
      prompt_kind: "contract_overlay_proposal",
      expected_reply_semantics: "proposal_yes_no",
      source_wrapped_at: "2026-05-20T10:00:00.000Z",
      check_payload_json: {
        contract_proposal: {
          proposal_semantic_version: DAILY_SEMANTIC_CONTRACT_PROPOSAL_VERSION,
          proposal_text: proposal,
        },
      },
      ...args,
    };
  }

  it("returns ok when semantic snapshot matches last outbound SID", () => {
    const d = diagnoseOutboundSupportsPendingAdaptiveProposalContext({
      snapshots: [snapshot({})],
      canonicalProposalText: proposal,
      latestOutboundBody: `Proposal: ${proposal}`,
      lastTwilioMessageSid: "SM_out_001",
      nowMs,
    });
    expect(d.ok).toBe(true);
    expect(d.reason).toBe("ok");
  });

  it("returns sid_mismatch when snapshots exist but SID differs", () => {
    const d = diagnoseOutboundSupportsPendingAdaptiveProposalContext({
      snapshots: [snapshot({})],
      canonicalProposalText: proposal,
      latestOutboundBody: "How did the hour go?",
      lastTwilioMessageSid: "SM_follow_up",
      nowMs,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("sid_mismatch");
  });

  it("returns snapshot_missing when no snapshots and legacy needle absent", () => {
    const d = diagnoseOutboundSupportsPendingAdaptiveProposalContext({
      snapshots: [],
      canonicalProposalText: proposal,
      latestOutboundBody: "How did the hour go?",
      lastTwilioMessageSid: "SM_out_001",
      nowMs,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("snapshot_missing");
  });

  it("returns ok via legacy needle when outbound contains binding prefix", () => {
    const d = diagnoseOutboundSupportsPendingAdaptiveProposalContext({
      snapshots: [],
      canonicalProposalText: proposal,
      latestOutboundBody: `Let’s simplify: ${proposal} Yes or no?`,
      lastTwilioMessageSid: "SM_out_001",
      nowMs,
    });
    expect(d.ok).toBe(true);
    expect(d.details.legacy_needle_hit).toBe(true);
  });

  it("returns proposal_text_mismatch when snapshot proposal text differs", () => {
    const d = diagnoseOutboundSupportsPendingAdaptiveProposalContext({
      snapshots: [
        snapshot({
          check_payload_json: {
            contract_proposal: {
              proposal_semantic_version: DAILY_SEMANTIC_CONTRACT_PROPOSAL_VERSION,
              proposal_text: "Different proposal text entirely",
            },
          },
        }),
      ],
      canonicalProposalText: proposal,
      latestOutboundBody: "Does this plan fit for the next 7 days?",
      lastTwilioMessageSid: "SM_out_001",
      nowMs,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("proposal_text_mismatch");
  });
});

