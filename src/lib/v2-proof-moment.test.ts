import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import {
  buildInboundProofCalloutHint,
  decideVictoryRoomSmsCallout,
  decideVictoryRoomSmsCalloutEligibility,
  INBOUND_PROOF_CALLOUT_LANE_INSTRUCTION,
  type ProofMomentMeta,
} from "@/lib/v2-proof-moment";

const strongYesProof: ProofMomentMeta = {
  proof_moment: true,
  proof_moment_type: "first_completion",
  proof_moment_reason: "first_logged_yes",
  proof_weight: "strong",
  user_visible_proof_line: "You logged your first clear yes on this bar—that’s proof worth keeping.",
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
});
