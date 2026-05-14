import { describe, expect, it } from "vitest";

import {
  latestOutboundBodyContainsAdaptiveProposalBindingNeedle,
  shouldConsumeInboundAsContractProposalConsent,
} from "@/lib/v2-contract-consent-routing";

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

