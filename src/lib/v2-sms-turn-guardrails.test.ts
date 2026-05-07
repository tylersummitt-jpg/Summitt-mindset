import { describe, expect, it } from "vitest";

import {
  applySmsConversationBrainGuardrails,
  validateCoachSmsDraftLanguage,
  type SmsTurnServerContext,
} from "@/lib/v2-sms-turn-guardrails";
import type { SmsConversationBrainProposalV1 } from "@/lib/v2-sms-turn-contract";

function ctx(overrides: Partial<SmsTurnServerContext> = {}): SmsTurnServerContext {
  return {
    clerk_user_id: "user_1",
    commitment_id: "c1",
    message_sid: "SM123",
    subscription_ok: true,
    sms_eligible: true,
    has_active_commitment: true,
    pending_resolution_active: false,
    contract_overlay_active: false,
    branch_owner: "normal_accountability",
    recent_clarification_count_heuristic: 0,
    opt_out_or_compliance_turn: false,
    allowed_event_types: ["user_yes", "user_no", "user_partial"],
    confidence_floor: 0.55,
    max_clarify_per_window: 2,
    ...overrides,
  };
}

function proposal(p: Partial<SmsConversationBrainProposalV1>): SmsConversationBrainProposalV1 {
  return {
    schema_version: 1,
    turn_kind: "accountability_reply",
    interpreted_user_meaning: "test",
    accountability_outcome_candidate: "user_no",
    outcome_confidence: 0.9,
    should_write_outcome_event: true,
    proposed_event_type: "user_no",
    blocker_signal: false,
    blocker_text_if_any: null,
    needs_clarification: false,
    clarification_reason: null,
    repeated_clarification_risk: false,
    reply_strategy: "test",
    final_sms_draft: "Got it. What blocked it today?",
    safety_notes: [],
    short_reason_for_logs: "t",
    ...p,
  };
}

describe("applySmsConversationBrainGuardrails", () => {
  it("approves a clean user_no draft", () => {
    const r = applySmsConversationBrainGuardrails(proposal({}), ctx());
    expect(r.status).toBe("approved");
    expect(r.final_event_type).toBe("user_no");
    expect(r.should_write_event).toBe(true);
    expect(r.final_sms_draft).toContain("blocked");
  });

  it("blocks without active commitment", () => {
    const r = applySmsConversationBrainGuardrails(proposal({}), ctx({ has_active_commitment: false }));
    expect(r.status).toBe("blocked");
    expect(r.guardrail_reason).toBe("no_active_commitment");
  });

  it("blocks subscription ineligible", () => {
    const r = applySmsConversationBrainGuardrails(proposal({}), ctx({ subscription_ok: false }));
    expect(r.status).toBe("blocked");
    expect(r.guardrail_reason).toBe("subscription_or_sms_ineligible");
  });

  it("blocks sms ineligible", () => {
    const r = applySmsConversationBrainGuardrails(proposal({}), ctx({ sms_eligible: false }));
    expect(r.status).toBe("blocked");
  });

  it("blocks pending resolution branch", () => {
    const r = applySmsConversationBrainGuardrails(
      proposal({}),
      ctx({ pending_resolution_active: true })
    );
    expect(r.status).toBe("blocked");
    expect(r.guardrail_reason).toBe("pending_resolution_or_contract_overlay_active");
  });

  it("blocks contract overlay branch", () => {
    const r = applySmsConversationBrainGuardrails(
      proposal({}),
      ctx({ contract_overlay_active: true })
    );
    expect(r.status).toBe("blocked");
  });

  it("blocks illegal event type via allowed list", () => {
    const r = applySmsConversationBrainGuardrails(
      proposal({ proposed_event_type: "user_no" }),
      ctx({ allowed_event_types: ["user_yes"] })
    );
    expect(r.status).toBe("blocked");
    expect(r.guardrail_reason).toBe("event_type_not_allowed");
  });

  it("blocks profanity in draft", () => {
    const r = applySmsConversationBrainGuardrails(
      proposal({ final_sms_draft: "That was shit and you know it." }),
      ctx()
    );
    expect(r.status).toBe("blocked");
    expect(r.guardrail_reason.startsWith("draft_language")).toBe(true);
  });

  it("blocks sexual language in draft", () => {
    const r = applySmsConversationBrainGuardrails(
      proposal({ final_sms_draft: "Let's talk about sex tomorrow." }),
      ctx()
    );
    expect(r.status).toBe("blocked");
  });

  it("blocks low-confidence outcome writes", () => {
    const r = applySmsConversationBrainGuardrails(
      proposal({ outcome_confidence: 0.2 }),
      ctx({ confidence_floor: 0.85 })
    );
    expect(r.status).toBe("blocked");
    expect(r.guardrail_reason).toBe("below_confidence_floor");
  });

  it("overrides clarification when clarification window is saturated", () => {
    const r = applySmsConversationBrainGuardrails(
      proposal({ needs_clarification: true }),
      ctx({ recent_clarification_count_heuristic: 2, max_clarify_per_window: 2 })
    );
    expect(r.status).toBe("overridden");
    expect(r.should_write_event).toBe(false);
    expect(r.final_sms_draft).toBeNull();
  });

  it("blocks weak cheerlead drafts on scored outcome writes", () => {
    const r = applySmsConversationBrainGuardrails(
      proposal({
        accountability_outcome_candidate: "user_yes",
        proposed_event_type: "user_yes",
        outcome_confidence: 0.95,
        final_sms_draft: "Great job! Keep the momentum going—you nailed today.",
      }),
      ctx()
    );
    expect(r.status).toBe("blocked");
    expect(r.guardrail_reason).toContain("weak_generic_motivation");
  });

  it("allows firm but clean accountability language", () => {
    const draft =
      "That takes honesty. Tomorrow, protect the first step before anything else pulls you off course.";
    const lang = validateCoachSmsDraftLanguage(draft);
    expect(lang.ok).toBe(true);
    const r = applySmsConversationBrainGuardrails(proposal({ final_sms_draft: draft }), ctx());
    expect(r.status).toBe("approved");
  });
});
