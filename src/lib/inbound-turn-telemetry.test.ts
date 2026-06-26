import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  compactInboundTurnTelemetryLaneFields,
  compactInboundTurnTruthTelemetry,
  INBOUND_TURN_TELEMETRY_COMPACT_KEYS,
  INBOUND_TURN_TELEMETRY_TRUTH_KEYS,
} from "@/lib/inbound-turn-telemetry";

describe("compactInboundTurnTelemetryLaneFields", () => {
  it("includes compact strategy and packet fields when provided on lane metadata", () => {
    const fields = compactInboundTurnTelemetryLaneFields({
      laneMetadata: {
        route_purpose: "normal_inbound_reply",
        branch_name: "main",
        strategy_card_surface: "inbound",
        strategy_card_route_kind: "normal_inbound_reply",
        strategy_card_move_type: "ask_blocker",
        strategy_card_validation_status: "valid",
        strategy_card_validation_reasons: ["ok"],
        relationship_packet_version: "v1",
        open_loop_count: 2,
        can_claim_proof: false,
        RELATIONSHIP_PACKET_V1: { huge: "blob" },
        prompt: "must not appear",
      },
      packetObservability: {
        do_not_repeat_ask_count: 1,
        active_pending_state_source: "facts_fallback",
      },
      routePurpose: "normal_inbound_reply",
      branchName: "main",
      coachingMoveSource: "v3_inbound_relationship_lane",
      visibleSentIntended: true,
    });

    expect(fields.route_purpose).toBe("normal_inbound_reply");
    expect(fields.branch_name).toBe("main");
    expect(fields.strategy_card_route_kind).toBe("normal_inbound_reply");
    expect(fields.strategy_card_move_type).toBe("ask_blocker");
    expect(fields.do_not_repeat_ask_count).toBe(1);
    expect(fields.visible_sent_intended).toBe(true);
    expect(fields.v3_lane_reply_source).toBe("v3_inbound_relationship_lane");
    expect(fields).not.toHaveProperty("RELATIONSHIP_PACKET_V1");
    expect(fields).not.toHaveProperty("prompt");
  });

  it("whitelist covers soak SQL strategy and packet keys", () => {
    expect(INBOUND_TURN_TELEMETRY_COMPACT_KEYS).toContain("strategy_card_route_kind");
    expect(INBOUND_TURN_TELEMETRY_COMPACT_KEYS).toContain("relationship_packet_version");
    expect(INBOUND_TURN_TELEMETRY_COMPACT_KEYS).toContain("active_pending_state_source");
  });
});

describe("compactInboundTurnTruthTelemetry", () => {
  it("merges lane and pre-writer truth fields without raw thread leakage", () => {
    const truth = compactInboundTurnTruthTelemetry(
      {
        inbound_resolved_outcome: "completed",
        inbound_required_reply_move: "acknowledge_completion",
        explicit_aligned_completion_detected: true,
        final_reply_source: "completion_contradiction_repair",
        coalesced_inbound_body: "should not copy",
      },
      {
        inbound_truth_persist_succeeded_before_writer: true,
        inbound_truth_persist_event_type: "user_yes",
        completion_alignment_result: "aligned",
      }
    );
    expect(truth.inbound_resolved_outcome).toBe("completed");
    expect(truth.inbound_required_reply_move).toBe("acknowledge_completion");
    expect(truth.explicit_aligned_completion_detected).toBe(true);
    expect(truth.proof_persisted_before_writer).toBe(true);
    expect(truth.proof_persisted_event_type).toBe("user_yes");
    expect(truth.completion_alignment_result).toBe("aligned");
    expect(truth).not.toHaveProperty("coalesced_inbound_body");
    expect(INBOUND_TURN_TELEMETRY_TRUTH_KEYS).toContain("completion_contradiction_guard_applied");
  });
});
