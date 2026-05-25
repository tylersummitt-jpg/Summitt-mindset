import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getPendingResolutionOrNull } from "@/lib/v2-guided-resolution";

function rowWithPayload(payload: Record<string, unknown>): ActiveV2CommitmentRow {
  return {
    id: "cmt_parse",
    clerk_user_id: "user_parse",
    status: "active",
    behavior_statement: "Walk daily",
    title: "Walk",
    success_criteria: null,
    blocker_capture_expires_at: null,
    blocker_capture_after_event: null,
    adaptive_ask_text: null,
    adaptive_ask_active_from: null,
    adaptive_ask_expires_at: null,
    adaptive_proposal_text: null,
    adaptive_proposal_created_at: null,
    adaptive_proposal_expires_at: null,
    accountability_phase: "active_accountability",
    reactivation_entered_at: null,
    reactivation_last_sent_at: null,
    reactivation_entry_reason_code: null,
    refresh_session: null,
    commitment_refresh_last_prompted_at: null,
    pending_resolution_kind: "commitment_replace",
    pending_resolution_created_at: "2026-05-10T12:00:00.000Z",
    pending_resolution_expires_at: "2027-05-10T12:00:00.000Z",
    pending_resolution_payload: payload,
    updated_at: null,
    started_at: null,
  };
}

describe("sms pending payload parse — sms_raise_bar_request", () => {
  it("round-trips sms_raise_bar_request through getPendingResolutionOrNull", () => {
    const parsed = getPendingResolutionOrNull(
      rowWithPayload({
        source: "sms_inbound",
        detected_intent: "sms_raise_bar_request",
        raw_user_text: "This goal is too easy",
        inbound_message_sid: "SMraise1",
        ai_confidence: 0.9,
        sms_state: "awaiting_candidate",
      })
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.payload?.source).toBe("sms_inbound");
    if (parsed?.payload?.source === "sms_inbound") {
      expect(parsed.payload.detected_intent).toBe("sms_raise_bar_request");
      expect(parsed.payload.raw_user_text).toBe("This goal is too easy");
    }
  });

  it("rejects unknown detected_intent as null payload", () => {
    const parsed = getPendingResolutionOrNull(
      rowWithPayload({
        source: "sms_inbound",
        detected_intent: "sms_totally_unknown",
        raw_user_text: "Change my goal",
        inbound_message_sid: "SMunk1",
      })
    );
    expect(parsed?.payload).toBeNull();
  });
});
