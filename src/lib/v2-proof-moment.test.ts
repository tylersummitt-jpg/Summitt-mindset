import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import {
  buildInboundProofCalloutHint,
  buildProofMomentForAccountabilityOutcome,
  decideVictoryRoomSmsCallout,
  decideVictoryRoomSmsCalloutEligibility,
  INBOUND_PROOF_CALLOUT_LANE_INSTRUCTION,
  proofMomentPayloadFields,
  type ProofMomentMeta,
} from "@/lib/v2-proof-moment";

const strongYesProof: ProofMomentMeta = {
  proof_moment: true,
  proof_moment_type: "first_completion",
  proof_moment_reason: "first_logged_yes",
  proof_weight: "strong",
  proof_meaning_line: "You logged your first clear yes on this bar.",
  user_visible_proof_line: "You logged your first clear yes on this bar.",
};

describe("decideVictoryRoomSmsCalloutEligibility", () => {
  it("eligible for strong first_completion proof", () => {
    const e = decideVictoryRoomSmsCalloutEligibility({
      proofMeta: strongYesProof,
      eventsNewestFirst: [],
    });
    expect(e.eligible).toBe(true);
    expect(e.proof_moment_type).toBe("first_completion");
  });

  it("not eligible for light weight proof", () => {
    const e = decideVictoryRoomSmsCalloutEligibility({
      proofMeta: { ...strongYesProof, proof_weight: "light" },
      eventsNewestFirst: [],
    });
    expect(e.eligible).toBe(false);
  });
});

describe("decideVictoryRoomSmsCallout", () => {
  it("never returns deterministic appendToReply (Slice 2)", () => {
    const callout = decideVictoryRoomSmsCallout({
      proofMeta: strongYesProof,
      eventsNewestFirst: [],
    });
    expect(callout.appendToReply).toBeNull();
    expect(callout.eventPayloadExtras).toEqual({});
  });
});

describe("buildInboundProofCalloutHint", () => {
  it("sets eligible and instruction when proof moment qualifies", () => {
    const hint = buildInboundProofCalloutHint({
      proofMeta: strongYesProof,
      eventsNewestFirst: [],
      shouldWriteOutcomeEvent: true,
    });
    expect(hint?.eligible).toBe(true);
    expect(hint?.surface).toBe("victory_room");
    expect(hint?.instruction).toBe(INBOUND_PROOF_CALLOUT_LANE_INSTRUCTION);
    expect(hint?.proof_insert_will_attempt).toBe(true);
    expect(hint?.proof_callout_claim_saved_allowed).toBe(false);
  });

  it("returns null when not eligible and no outcome insert planned", () => {
    const hint = buildInboundProofCalloutHint({
      proofMeta: null,
      eventsNewestFirst: [],
      shouldWriteOutcomeEvent: false,
    });
    expect(hint).toBeNull();
  });

  it("does not embed canned I'm saving that as proof text", () => {
    const hint = buildInboundProofCalloutHint({
      proofMeta: strongYesProof,
      eventsNewestFirst: [],
      shouldWriteOutcomeEvent: true,
    });
    expect(JSON.stringify(hint)).not.toMatch(/I'm saving that as proof/i);
  });

  it("encourages soft Victory Room identity language without hard saved/logged claims or fixed append", () => {
    const hint = buildInboundProofCalloutHint({
      proofMeta: strongYesProof,
      eventsNewestFirst: [],
      shouldWriteOutcomeEvent: true,
    });
    expect(hint?.instruction).toMatch(/soft Victory Room/i);
    expect(hint?.instruction).toMatch(/Victory Room material|belongs in your Victory Room/i);
    expect(hint?.instruction).toMatch(/concrete detail/i);
    expect(hint?.instruction).not.toMatch(/I'm adding that to your Victory Room/i);
    expect(hint?.proof_callout_claim_saved_allowed).toBe(false);
    const callout = decideVictoryRoomSmsCallout({
      proofMeta: strongYesProof,
      eventsNewestFirst: [],
    });
    expect(callout.appendToReply).toBeNull();
  });
});

describe("proofMomentPayloadFields", () => {
  it("includes deterministic proof_meaning_line and optional proof_quote", () => {
    const meta = buildProofMomentForAccountabilityOutcome({
      finalEventType: "user_yes",
      eventsNewestFirst: [],
      isRepairOutcome: false,
      userMessageCharCount: 3,
    });
    expect(meta).not.toBeNull();
    const payload = proofMomentPayloadFields(meta, "yes");
    expect(payload.proof_meaning_line).toBe("You logged your first clear yes on this bar.");
    expect(payload.user_visible_proof_line).toBe("You logged your first clear yes on this bar.");
    expect(payload.proof_quote).toBe("yes");
  });
});

describe("buildProofMomentForAccountabilityOutcome — user_no proof gate", () => {
  const PRODUCTION_META_CORRECTION =
    "Yes! I was wondering why you asked it because I did not say I would be playing with the kids tomorrow";

  it("meta-correction does not create honest_miss proof", () => {
    const meta = buildProofMomentForAccountabilityOutcome({
      finalEventType: "user_no",
      eventsNewestFirst: [],
      isRepairOutcome: false,
      userMessageCharCount: PRODUCTION_META_CORRECTION.length,
      rawBody: PRODUCTION_META_CORRECTION,
    });
    expect(meta).toBeNull();
  });

  it("explicit miss still creates honest_miss proof", () => {
    const raw = "I didn't hit my steps today";
    const meta = buildProofMomentForAccountabilityOutcome({
      finalEventType: "user_no",
      eventsNewestFirst: [],
      isRepairOutcome: false,
      userMessageCharCount: raw.length,
      rawBody: raw,
    });
    expect(meta?.proof_moment_type).toBe("honest_miss");
    expect(meta?.user_visible_proof_line).toContain("told the truth about the miss");
  });

  it("onboarding/process complaint does not create honest_miss proof", () => {
    const raw =
      "Thanks I did 15 minutes of onboarding and you didn't ask me anything about what I chose. Did the onboarding matter?";
    const meta = buildProofMomentForAccountabilityOutcome({
      finalEventType: "user_no",
      eventsNewestFirst: [],
      isRepairOutcome: false,
      userMessageCharCount: raw.length,
      rawBody: raw,
    });
    expect(meta).toBeNull();
  });
});
