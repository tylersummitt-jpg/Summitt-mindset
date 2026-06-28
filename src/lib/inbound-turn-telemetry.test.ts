import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  capInboundStageBodyPreview,
  compactInboundTurnTelemetryLaneFields,
  compactInboundTurnTruthTelemetry,
  compactInboundTurnWriterObservability,
  INBOUND_TURN_TELEMETRY_COMPACT_KEYS,
  INBOUND_TURN_TELEMETRY_TRUTH_KEYS,
  INBOUND_TURN_TELEMETRY_WRITER_OBSERVABILITY_KEYS,
} from "@/lib/inbound-turn-telemetry";
import { INBOUND_NOTEBOOK_OBSERVABILITY_KEYS } from "@/lib/sms-inbound-notebook-telemetry";

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
    expect(INBOUND_TURN_TELEMETRY_TRUTH_KEYS).toContain("semantic_completion_source");
    expect(INBOUND_TURN_TELEMETRY_TRUTH_KEYS).toContain("proof_persist_decision_reason");
  });

  it("merges semantic completion telemetry from pre-writer payload", () => {
    const truth = compactInboundTurnTruthTelemetry(null, {
      semantic_completion_checked: true,
      semantic_completion_source: "turn_understanding",
      semantic_completion_claimed: true,
      semantic_completion_alignment: "aligned",
      semantic_completion_confidence: "high",
      semantic_completion_tense: "completed_today",
      semantic_completion_object_preview: "I prayed today",
      proof_persist_decision_reason: "semantic_turn_understanding_aligned_completed_today",
    });
    expect(truth.semantic_completion_source).toBe("turn_understanding");
    expect(truth.proof_persist_decision_reason).toBe(
      "semantic_turn_understanding_aligned_completed_today"
    );
  });
});

describe("compactInboundTurnWriterObservability", () => {
  it("includes writer finish_reason and usage from lane metadata", () => {
    const fields = compactInboundTurnWriterObservability({
      laneMetadata: {
        writer_model: "gpt-4o-mini",
        writer_finish_reason: "length",
        writer_output_tokens: 42,
        writer_prompt_tokens: 100,
        writer_candidate_preview: "x".repeat(250),
        system_prompt: "must not appear",
      },
    });
    expect(fields.writer_finish_reason).toBe("length");
    expect(fields.writer_output_tokens).toBe(42);
    expect(fields.writer_prompt_tokens).toBe(100);
    expect(String(fields.writer_candidate_preview).length).toBeLessThanOrEqual(250);
    expect(fields).not.toHaveProperty("system_prompt");
  });

  it("merges stage previews and integrity telemetry from guard metadata", () => {
    const long = "a".repeat(300);
    const fields = compactInboundTurnWriterObservability({
      stageTelemetry: {
        post_north_star_body_preview: capInboundStageBodyPreview(long),
        post_fvg_body_preview: capInboundStageBodyPreview(long),
        final_body_before_integrity_preview: capInboundStageBodyPreview(long),
      },
      guardMetadata: {
        final_body_after_integrity_preview: capInboundStageBodyPreview(long),
        final_sentence_integrity_checked: true,
        final_sentence_integrity_ok: true,
        final_sentence_integrity_repair_applied: false,
        raw_prompt: "secret",
      },
    });
    expect(String(fields.post_north_star_body_preview).length).toBe(200);
    expect(String(fields.post_fvg_body_preview).length).toBe(200);
    expect(String(fields.final_body_before_integrity_preview).length).toBe(200);
    expect(String(fields.final_body_after_integrity_preview).length).toBe(200);
    expect(fields.final_sentence_integrity_checked).toBe(true);
    expect(fields).not.toHaveProperty("raw_prompt");
  });

  it("whitelist covers writer observability keys", () => {
    expect(INBOUND_TURN_TELEMETRY_WRITER_OBSERVABILITY_KEYS).toContain("writer_finish_reason");
    expect(INBOUND_TURN_TELEMETRY_WRITER_OBSERVABILITY_KEYS).toContain(
      "final_body_after_integrity_preview"
    );
    expect(INBOUND_TURN_TELEMETRY_WRITER_OBSERVABILITY_KEYS).toContain(
      "final_sentence_integrity_repair_applied"
    );
  });

  it("absorbs inbound notebook observability from packetObservability", () => {
    const packetObs: Record<string, unknown> = {
      inbound_thread_correct_notebook_verified: true,
      inbound_thread_notebook_failure_reason: "none",
      inbound_context_packet_used: true,
    };
    const compact = compactInboundTurnTelemetryLaneFields({ packetObservability: packetObs });
    expect(compact.inbound_thread_correct_notebook_verified).toBe(true);
    expect(compact.inbound_thread_notebook_failure_reason).toBe("none");
    expect(compact.inbound_context_packet_used).toBe(true);
    expect(INBOUND_NOTEBOOK_OBSERVABILITY_KEYS).toContain("inbound_thread_fetch_error_count");
  });
});
