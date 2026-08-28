import { describe, expect, it } from "vitest";
import { classifyV2InboundReply } from "@/lib/v2-sms-accountability";
import { evaluateAdaptiveProposalAmbiguousConsentGate } from "@/lib/v2-adaptive-proposal-ambiguous-consent-gate";

function gate(body: string) {
  return evaluateAdaptiveProposalAmbiguousConsentGate({
    inboundBody: body,
    classification: classifyV2InboundReply(body.trim()),
  });
}

function denyReasonOf(body: string): string | null {
  const r = gate(body);
  return r.shouldRoute ? null : r.denyReason;
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
    expect(gate("Yes").shouldRoute).toBe(false);
    expect(denyReasonOf("Yes")).toBe("deterministic_yes_no_use_contract_path");
  });

  it("does not route explicit NO", () => {
    expect(gate("No").shouldRoute).toBe(false);
  });

  it("does not route completion proof language", () => {
    const reason = denyReasonOf("I already got it done");
    expect(gate("I already got it done").shouldRoute).toBe(false);
    expect(reason === "completion_or_proof_language" || reason === "deterministic_yes_no_use_contract_path").toBe(
      true
    );
  });

  it("does not route miss language", () => {
    expect(gate("I missed today").shouldRoute).toBe(false);
    expect(denyReasonOf("I missed today")).toBe("miss_or_non_completion_language");
  });

  it("does not route keyword partial accountability", () => {
    expect(gate("I was only partially able to do it").shouldRoute).toBe(false);
    expect(denyReasonOf("I was only partially able to do it")).toBe("keyword_partial_accountability_language");
  });

  it("does not route blocker report", () => {
    expect(gate("my blocker was email").shouldRoute).toBe(false);
    expect(denyReasonOf("my blocker was email")).toBe("blocker_report_language");
  });

  it("routes I think so as ambiguous", () => {
    const r = gate("I think so");
    expect(r.shouldRoute).toBe(true);
    if (r.shouldRoute) expect(r.inboundParse).toBe("ambiguous");
  });

  it("routes maybe later as ambiguous", () => {
    const r = gate("maybe later");
    expect(r.shouldRoute).toBe(true);
    if (r.shouldRoute) expect(r.inboundParse).toBe("ambiguous");
  });

  it("routes what does that mean as explanation_request", () => {
    const r = gate("what does that mean?");
    expect(r.shouldRoute).toBe(true);
    if (r.shouldRoute) expect(r.inboundParse).toBe("explanation_request");
  });

  it("does not route unrelated chit-chat", () => {
    expect(gate("see you tomorrow").shouldRoute).toBe(false);
    expect(denyReasonOf("see you tomorrow")).toBe("no_consent_adjacent_allowlist_match");
  });

  it("does not route sure-but hedging that is not on the allowlist", () => {
    expect(gate("sure but I have a meeting").shouldRoute).toBe(false);
    expect(denyReasonOf("sure but I have a meeting")).toBe("no_consent_adjacent_allowlist_match");
  });

  it("does not route whitespace or noise", () => {
    expect(gate("   ").shouldRoute).toBe(false);
    expect(gate("...").shouldRoute).toBe(false);
  });
});
