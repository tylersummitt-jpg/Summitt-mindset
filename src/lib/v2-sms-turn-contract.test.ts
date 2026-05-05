import { describe, expect, it } from "vitest";

import { parseSmsConversationBrainProposal, SMS_CONVERSATION_BRAIN_SCHEMA_VERSION } from "@/lib/v2-sms-turn-contract";

function baseProposal(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: SMS_CONVERSATION_BRAIN_SCHEMA_VERSION,
    turn_kind: "accountability_reply",
    interpreted_user_meaning: "User missed the commitment today.",
    accountability_outcome_candidate: "user_no",
    outcome_confidence: 0.82,
    should_write_outcome_event: true,
    proposed_event_type: "user_no",
    blocker_signal: false,
    blocker_text_if_any: null,
    needs_clarification: false,
    clarification_reason: null,
    repeated_clarification_risk: false,
    reply_strategy: "coach_forward_miss",
    final_sms_draft: "Got it — honest miss. What blocked it today?",
    safety_notes: [],
    short_reason_for_logs: "miss_ack",
    ...overrides,
  };
}

describe("parseSmsConversationBrainProposal", () => {
  it("parses a valid proposal", () => {
    const r = parseSmsConversationBrainProposal(baseProposal());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.schema_version).toBe(1);
      expect(r.data.proposed_event_type).toBe("user_no");
    }
  });

  it("rejects unknown turn_kind", () => {
    const r = parseSmsConversationBrainProposal(baseProposal({ turn_kind: "nope" }));
    expect(r.ok).toBe(false);
  });

  it("rejects missing interpreted_user_meaning", () => {
    const r = parseSmsConversationBrainProposal(baseProposal({ interpreted_user_meaning: "" }));
    expect(r.ok).toBe(false);
  });

  it("rejects confidence outside 0..1", () => {
    const r = parseSmsConversationBrainProposal(baseProposal({ outcome_confidence: 1.4 }));
    expect(r.ok).toBe(false);
  });

  it("rejects invalid proposed_event_type", () => {
    const r = parseSmsConversationBrainProposal(baseProposal({ proposed_event_type: "user_maybe" }));
    expect(r.ok).toBe(false);
  });

  it("allows null proposed_event_type when not writing outcome", () => {
    const r = parseSmsConversationBrainProposal(
      baseProposal({
        should_write_outcome_event: false,
        proposed_event_type: null,
        accountability_outcome_candidate: "none",
      })
    );
    expect(r.ok).toBe(true);
  });
});
