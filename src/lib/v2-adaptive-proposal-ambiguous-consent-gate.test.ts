import { describe, expect, it } from "vitest";
import { classifyV2InboundReply } from "@/lib/v2-sms-accountability";
import { evaluateAdaptiveProposalAmbiguousConsentGate } from "@/lib/v2-adaptive-proposal-ambiguous-consent-gate";

function gate(body: string) {
  return evaluateAdaptiveProposalAmbiguousConsentGate({
    inboundBody: body,
    classification: classifyV2InboundReply(body.trim()),
  });
}

describe("evaluateAdaptiveProposalAmbiguousConsentGate", () => {
  it("routes maybe as ambiguous", () => {
    const r = gate("maybe");
    expect(r.shouldRoute).toBe(true);
    if (r.shouldRoute) expect(r.inboundParse).toBe("ambiguous");
  });

  it("routes can you explain as explanation_request", () => {
    const r = gate("can you explain?");
    expect(r.shouldRoute).toBe(true);
    if (r.shouldRoute) expect(r.inboundParse).toBe("explanation_request");
  });

  it("does not route explicit YES", () => {
    const r = gate("Yes");
    expect(r.shouldRoute).toBe(false);
    expect(r.denyReason).toBe("deterministic_yes_no_use_contract_path");
  });

  it("does not route explicit NO", () => {
    const r = gate("No");
    expect(r.shouldRoute).toBe(false);
  });

  it("does not route completion proof language", () => {
    const r = gate("I already got it done");
    expect(r.shouldRoute).toBe(false);
    expect(
      r.denyReason === "completion_or_proof_language" || r.denyReason === "deterministic_yes_no_use_contract_path"
    ).toBe(true);
  });

  it("does not route miss language", () => {
    const r = gate("I missed today");
    expect(r.shouldRoute).toBe(false);
    expect(r.denyReason).toBe("miss_or_non_completion_language");
  });

  it("does not route keyword partial accountability", () => {
    const r = gate("I was only partially able to do it");
    expect(r.shouldRoute).toBe(false);
    expect(r.denyReason).toBe("keyword_partial_accountability_language");
  });

  it("does not route blocker report", () => {
    const r = gate("my blocker was email");
    expect(r.shouldRoute).toBe(false);
    expect(r.denyReason).toBe("blocker_report_language");
  });

  it("does not route unrelated chit-chat", () => {
    const r = gate("see you tomorrow");
    expect(r.shouldRoute).toBe(false);
    expect(r.denyReason).toBe("no_consent_adjacent_allowlist_match");
  });
});
