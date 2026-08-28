import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  buildContractConsentAckIntent,
  validateContractConsentAckForbiddenLanguage,
  validateContractConsentAckHumanBody,
  validateContractConsentAckRequiredMeaning,
} from "@/lib/v2-contract-consent-ack-send";

function baseIntent(overrides: Partial<ReturnType<typeof buildContractConsentAckIntent>> = {}) {
  return buildContractConsentAckIntent({
    consentParse: "user_yes",
    messageSid: "SM_intent_001",
    proposalText: "This is the standard for the next 7 days: workout daily.",
    contractKind: "recommit_same",
    behaviorStatement: "Workout daily",
    effectiveAsk: "Workout daily",
    contractConsentFacts: {
      overlay_action: "activated",
      rpc_result: "applied",
      proposal_text_digest: "This is the standard...",
      required_meaning_summary: "Acknowledge acceptance for the next 7 days.",
    },
    ...overrides,
  });
}

describe("buildContractConsentAckIntent", () => {
  it("stores legacy template as meaning anchor only, not as send target", () => {
    const intent = baseIntent();
    expect(intent.legacy_meaning_anchor_preview).toBeTruthy();
    expect(intent.legacy_meaning_anchor_preview).toContain("week");
  });
});

describe("validateContractConsentAckHumanBody", () => {
  it("rejects verbatim legacy template paste as final body", () => {
    const intent = baseIntent();
    const r = validateContractConsentAckHumanBody({
      body: intent.legacy_meaning_anchor_preview!,
      intent,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("verbatim_legacy_template_paste");
  });

  it("rejects menu/robot forbidden language", () => {
    const r = validateContractConsentAckForbiddenLanguage("Reply YES to confirm your overlay.");
    expect(r.ok).toBe(false);
  });

  it("accepts human generated yes ack with week/acceptance meaning", () => {
    const intent = baseIntent();
    const r = validateContractConsentAckHumanBody({
      body: "Good — we'll hold that standard for the next week. Show me the rep.",
      intent,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects yes ack missing acceptance/week meaning", () => {
    const intent = baseIntent();
    const r = validateContractConsentAckRequiredMeaning({
      body: "Thanks for texting.",
      intent,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("yes_ack_missing_week_or_acceptance");
  });

  it("accepts decline ack that keeps the current commitment", () => {
    const intent = buildContractConsentAckIntent({
      consentParse: "user_no",
      messageSid: "SM_intent_no",
      proposalText: "Tighter ask",
      contractKind: "recommit_same",
      behaviorStatement: "Workout daily",
      effectiveAsk: "Workout daily",
      contractConsentFacts: {
        overlay_action: "declined",
        rpc_result: "applied",
        proposal_text_digest: "Tighter ask",
        required_meaning_summary: "Acknowledge decline; keep current commitment.",
      },
    });
    const r = validateContractConsentAckHumanBody({
      body: "All good — we keep the current commitment.",
      intent,
    });
    expect(r.ok).toBe(true);
  });
});
