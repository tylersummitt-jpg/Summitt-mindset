import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck } from "@/lib/v2-commitment-handoff-post-unified-truth";
import type { InboundV3CommitmentChangeFacts } from "@/lib/v3-inbound-relationship-lane";

const EXISTING_PENDING_NOTE =
  "You already have a commitment update in progress—reply here to finish it before starting another.";

function baseFacts(overrides?: Partial<InboundV3CommitmentChangeFacts>): InboundV3CommitmentChangeFacts {
  return {
    detected_intent_type: "sms_tighten_request",
    current_commitment_snapshot: "title:Morning | behavior:Deep work",
    requested_change_summary: "Make it smaller",
    pending_resolution_created: true,
    pending_resolution_type: "commitment_tighten",
    pending_resolution_skip_reason: null,
    pending_resolution_apply_exception: null,
    existing_pending_resolution: false,
    candidate_tightened_bar_preview: "20 minutes reading",
    candidate_new_bar_preview: null,
    server_state_transition_summary: "pending_resolution_upserted:commitment_tighten",
    required_meaning_summary: "Pending created.",
    legacy_commitment_change_reply_preview: "preview",
    append_note_preview: null,
    inbound_message_sid: "SMhandoff1",
    ...overrides,
  };
}

describe("evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck", () => {
  it("9: pending created body says goal already changed → blocked", () => {
    const r = evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck({
      body: "Your goal has been updated to the smaller bar.",
      commitmentChangeFacts: baseFacts(),
    });
    expect(r.blocked).toBe(true);
    expect(r.handoffTruthViolations).toContain("handoff_pending_created_but_body_claims_applied");
  });

  it("10: pending created body says commitment updated/active/locked in → blocked", () => {
    const r = evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck({
      body: "Your commitment is now locked in for the week.",
      commitmentChangeFacts: baseFacts(),
    });
    expect(r.blocked).toBe(true);
  });

  it("11: pending created body says pending change started / confirmation needed → allowed", () => {
    const r = evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck({
      body: "Got it — I started a confirmation flow for the smaller bar. Reply YES when you're ready to lock it in.",
      commitmentChangeFacts: baseFacts(),
    });
    expect(r.blocked).toBe(false);
  });

  it("12: no pending created body says pending created → blocked", () => {
    const r = evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck({
      body: "I created a pending change for your goal.",
      commitmentChangeFacts: baseFacts({
        pending_resolution_created: false,
        pending_resolution_type: null,
        server_state_transition_summary: "pending_resolution_skipped:soft_quit",
      }),
    });
    expect(r.blocked).toBe(true);
    expect(r.handoffTruthViolations).toContain("handoff_no_pending_but_body_claims_pending_created");
  });

  it("13: existing pending required verbatim missing → blocked", () => {
    const r = evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck({
      body: "Finish your current update before starting another.",
      commitmentChangeFacts: baseFacts({
        pending_resolution_created: false,
        existing_pending_resolution: true,
        required_verbatim_substrings: [EXISTING_PENDING_NOTE],
        server_state_transition_summary: "pending_resolution_skipped:existing_pending",
      }),
    });
    expect(r.blocked).toBe(true);
    expect(r.verbatimMissing).toEqual([EXISTING_PENDING_NOTE]);
  });

  it("14: required verbatim present → allowed", () => {
    const r = evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck({
      body: EXISTING_PENDING_NOTE,
      commitmentChangeFacts: baseFacts({
        pending_resolution_created: false,
        existing_pending_resolution: true,
        required_verbatim_substrings: [EXISTING_PENDING_NOTE],
        server_state_transition_summary: "pending_resolution_skipped:existing_pending",
      }),
    });
    expect(r.blocked).toBe(false);
  });

  it("15: fake proof / Victory / completed claim blocked", () => {
    const r = evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck({
      body: "Great job completing your goal today — saved to Victory Room.",
      commitmentChangeFacts: baseFacts(),
    });
    expect(r.blocked).toBe(true);
    expect(r.fakeProofFailed).toBe(true);
  });

  it("16: internal jargon blocked", () => {
    const r = evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck({
      body: "route_purpose says pending_resolution is active.",
      commitmentChangeFacts: baseFacts(),
    });
    expect(r.blocked).toBe(true);
    expect(r.forbiddenPhraseFailed).toBe(true);
  });

  it("17: valid handoff ack allowed", () => {
    const r = evaluatePostUnifiedGuardCommitmentHandoffTruthRecheck({
      body: "I hear you want a smaller bar. I set up a quick confirmation — reply YES when you want me to hold you to 20 minutes reading.",
      commitmentChangeFacts: baseFacts(),
    });
    expect(r.blocked).toBe(false);
  });
});
