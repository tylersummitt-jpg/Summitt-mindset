import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  detectAdaptiveClarifyPendingStateTruthViolations,
  evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck,
} from "@/lib/v2-adaptive-consent-clarify-post-unified-truth";
import type { InboundV3AdaptiveConsentClarificationFacts } from "@/lib/v3-inbound-relationship-lane";

const BASE_FACTS: InboundV3AdaptiveConsentClarificationFacts = {
  latest_outbound_was_proposal: true,
  pending_proposal_valid: true,
  proposal_kind: "adaptive_overlay",
  proposal_text_digest: "Morning walk",
  inbound_parse: "ambiguous",
  server_action_taken: "none",
  state_remains_pending: true,
  required_meaning_summary:
    "Ask whether they want the adjusted ask or to keep their current bar. Make clear the current bar has not changed yet. Ask for a clear decision in natural language.",
  legacy_clarification_preview: "preview",
  inbound_message_sid: "SMadaptive1",
};

const RECHECK_BASE = {
  adaptiveConsentClarificationFacts: BASE_FACTS,
};

describe("evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck", () => {
  it("1: valid clarification passes", () => {
    const r = evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck({
      ...RECHECK_BASE,
      body: "I want to make sure I understood — are you saying yes to that plan, or not yet?",
    });
    expect(r.blocked).toBe(false);
  });

  it("2: body claims accepted → blocked", () => {
    const v = detectAdaptiveClarifyPendingStateTruthViolations(
      "Got it — you accepted the tighter ask for the week.",
      { stateRemainsPending: true, pendingProposalValid: true }
    );
    expect(v).toContain("clarify_but_body_claims_accepted");
    const r = evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck({
      ...RECHECK_BASE,
      body: "Got it — you accepted the tighter ask for the week.",
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe("adaptive_clarify_state_truth_violation_after_unified_guard");
  });

  it("3: body claims declined → blocked", () => {
    const r = evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck({
      ...RECHECK_BASE,
      body: "No problem — you declined that plan and we're keeping your current commitment.",
    });
    expect(r.blocked).toBe(true);
    expect(r.adaptiveTruthViolations).toContain("clarify_but_body_claims_declined");
  });

  it("4: body claims plan active → blocked", () => {
    const r = evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck({
      ...RECHECK_BASE,
      body: "Your new ask is now in effect for the week.",
    });
    expect(r.blocked).toBe(true);
    expect(r.adaptiveTruthViolations).toContain("clarify_but_body_claims_plan_active");
  });

  it("5: body says proposal resolved → blocked", () => {
    const r = evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck({
      ...RECHECK_BASE,
      body: "All set — that proposal is handled and we're good.",
    });
    expect(r.blocked).toBe(true);
    expect(r.adaptiveTruthViolations.length).toBeGreaterThan(0);
  });

  it("6: body does not ask for clarification → blocked", () => {
    const r = evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck({
      ...RECHECK_BASE,
      body: "Thanks for the note. I'll check in again tomorrow.",
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe("adaptive_clarify_missing_clarification_meaning_after_unified_guard");
  });

  it("7: fake proof / Victory claim blocked", () => {
    const r = evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck({
      ...RECHECK_BASE,
      body: "Great job completing your goal — are you saying yes to the plan?",
    });
    expect(r.blocked).toBe(true);
    expect(r.adaptiveTruthViolations).toContain("clarify_but_body_claims_fake_proof_or_completion");
  });

  it("8: required substring missing, if present → blocked", () => {
    const r = evaluatePostUnifiedGuardAdaptiveClarifyTruthRecheck({
      ...RECHECK_BASE,
      requiredVerbatimSubstrings: ["Morning walk"],
      body: "Want to confirm — are you saying yes to that tighter plan, or not yet?",
    });
    expect(r.blocked).toBe(true);
    expect(r.noSendReason).toBe("adaptive_clarify_required_verbatim_missing_after_unified_guard");
    expect(r.verbatimMissing).toEqual(["Morning walk"]);
  });
});
