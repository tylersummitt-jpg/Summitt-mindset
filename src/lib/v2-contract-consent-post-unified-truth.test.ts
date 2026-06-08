import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  detectContractConsentStateTruthViolations,
  evaluatePostUnifiedGuardContractTruthRecheck,
} from "@/lib/v2-contract-consent-post-unified-truth";
import type { InboundV3ContractConsentFacts } from "@/lib/v3-inbound-relationship-lane";

const BASE: InboundV3ContractConsentFacts = {
  consent_parse: "user_yes",
  latest_outbound_was_proposal: true,
  proposal_kind: "adaptive_overlay",
  proposal_text_digest: "Morning walk",
  overlay_action: "activated",
  rpc_result: "applied",
  server_state_transition_summary: "Applied.",
  required_verbatim_substrings: ["Morning walk"],
  required_meaning_summary: "Acknowledge acceptance and new ask.",
  legacy_contract_ack_preview: "preview",
  inbound_message_sid: "SM1",
  proposal_expires_at: null,
};

const RECHECK_BASE = {
  contractConsentFacts: BASE,
  consentParse: "user_yes" as const,
  proposalText: "Morning walk every day",
  contractKind: "adaptive_overlay" as const,
  behaviorStatement: "Walk daily",
  effectiveAsk: "Morning walk every day",
  optionalBindingSubstring: "Morning walk",
  proposalStillActive: false,
};

describe("detectContractConsentStateTruthViolations", () => {
  it("7: YES applied body missing required verbatim is handled by evaluatePostUnifiedGuard", () => {
    const r = evaluatePostUnifiedGuardContractTruthRecheck({
      ...RECHECK_BASE,
      body: "Got it — locked in for the week.",
    });
    expect(r.blocked).toBe(true);
    expect(r.verbatimMissing).toEqual(["Morning walk"]);
  });

  it("8: YES applied body claims declined/unchanged → blocked", () => {
    const v = detectContractConsentStateTruthViolations(
      "No problem — keeping your current commitment unchanged.",
      { overlayAction: "activated", consentParse: "user_yes" }
    );
    expect(v.length).toBeGreaterThan(0);
  });

  it("9: YES applied body asks user to accept again → blocked", () => {
    const v = detectContractConsentStateTruthViolations("Reply YES if you want this.", {
      overlayAction: "activated",
      consentParse: "user_yes",
    });
    expect(v).toContain("activated_but_body_reasks_consent");
  });

  it("10: NO declined body claims plan active → blocked", () => {
    const v = detectContractConsentStateTruthViolations(
      "Your new ask is now in effect for the week.",
      { overlayAction: "declined", consentParse: "user_no" }
    );
    expect(v).toContain("declined_but_body_claims_overlay_active");
  });

  it("11: Noop body claims fresh activation → blocked", () => {
    const v = detectContractConsentStateTruthViolations(
      "Just activated your tighter ask for the week.",
      { overlayAction: "noop_already_applied", consentParse: "user_yes" }
    );
    expect(v).toContain("noop_already_applied_but_body_claims_fresh_activation");
  });

  it("12: Pending-active body claims accepted/declined → blocked", () => {
    const v = detectContractConsentStateTruthViolations(
      "Your plan is now active for the week.",
      { overlayAction: "noop_not_found", consentParse: "user_yes", pendingRemainsActive: true }
    );
    expect(v.length).toBeGreaterThan(0);
  });

  it("13: Valid YES applied body passes", () => {
    const body =
      "Morning walk — got it. I will hold you to that sharper ask this week.";
    const r = evaluatePostUnifiedGuardContractTruthRecheck({
      ...RECHECK_BASE,
      body,
    });
    expect(r.blocked).toBe(false);
  });

  it("14: Valid NO declined body passes", () => {
    const facts: InboundV3ContractConsentFacts = {
      ...BASE,
      consent_parse: "user_no",
      overlay_action: "declined",
      required_verbatim_substrings: undefined,
      required_meaning_summary:
        "Acknowledge decline; they keep their existing written commitment.",
    };
    const r = evaluatePostUnifiedGuardContractTruthRecheck({
      ...RECHECK_BASE,
      contractConsentFacts: facts,
      consentParse: "user_no",
      optionalBindingSubstring: null,
      body: "No problem — we'll keep your current commitment as the standard.",
    });
    expect(r.blocked).toBe(false);
  });

  it("14b: Valid noop body passes", () => {
    const facts: InboundV3ContractConsentFacts = {
      ...BASE,
      overlay_action: "noop_already_applied",
      rpc_result: "already_applied",
      required_verbatim_substrings: undefined,
    };
    const r = evaluatePostUnifiedGuardContractTruthRecheck({
      ...RECHECK_BASE,
      contractConsentFacts: facts,
      body: "Got it — already recorded from a prior reply. Normal checks continue.",
    });
    expect(r.blocked).toBe(false);
  });
});
