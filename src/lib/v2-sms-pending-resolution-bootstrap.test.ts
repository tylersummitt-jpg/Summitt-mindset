import { describe, expect, it, vi, beforeEach } from "vitest";

const { mergeSmsPendingResolutionPayload } = vi.hoisted(() => ({
  mergeSmsPendingResolutionPayload: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

vi.mock("@/lib/v2-guided-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-guided-resolution")>();
  return {
    ...actual,
    mergeSmsPendingResolutionPayload,
    getPendingResolutionOrNull: actual.getPendingResolutionOrNull,
  };
});


import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { bootstrapSmsPendingConfirmationFromInbound } from "@/lib/v2-sms-pending-resolution-complete";

function commitmentWithPending(
  payload: Record<string, unknown>,
  kind: "commitment_replace" | "commitment_tighten" = "commitment_replace"
): ActiveV2CommitmentRow {
  return {
    id: "cmt_boot",
    clerk_user_id: "user_boot",
    status: "active",
    behavior_statement: "Phone away at dinner",
    title: "Phone",
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
    pending_resolution_kind: kind,
    pending_resolution_created_at: "2026-05-10T12:00:00.000Z",
    pending_resolution_expires_at: "2027-05-10T12:00:00.000Z",
    pending_resolution_payload: payload,
    updated_at: "2026-05-10T12:00:00.000Z",
    started_at: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mergeSmsPendingResolutionPayload.mockResolvedValue({ ok: true });
});

describe("bootstrapSmsPendingConfirmationFromInbound", () => {
  it("promotes to awaiting_confirmation when same-turn body has safe candidate", async () => {
    const c = commitmentWithPending({
      source: "sms_inbound",
      detected_intent: "sms_replace_request",
      raw_user_text: "change my goal to walking after dinner",
      inbound_message_sid: "SMboot1",
      ai_confidence: 0.9,
      sms_state: "awaiting_candidate",
    });
    const r = await bootstrapSmsPendingConfirmationFromInbound({
      commitment: c,
      rawBody: "change my goal to walking after dinner",
    });
    expect(r.promoted).toBe(true);
    expect(r.candidate).toMatch(/walking after dinner/i);
    expect(mergeSmsPendingResolutionPayload).toHaveBeenCalledTimes(1);
    const mergeFn = mergeSmsPendingResolutionPayload.mock.calls[0]![0].merge;
    const merged = mergeFn({
      source: "sms_inbound",
      detected_intent: "sms_replace_request",
      raw_user_text: "change my goal to walking after dinner",
      inbound_message_sid: "SMboot1",
      ai_confidence: 0.9,
      sms_state: "awaiting_candidate",
    });
    expect(merged.sms_state).toBe("awaiting_confirmation");
    expect(merged.candidate_behavior_statement).toMatch(/walking after dinner/i);
  });

  it("skips promotion when candidate is vague", async () => {
    const c = commitmentWithPending({
      source: "sms_inbound",
      detected_intent: "sms_replace_request",
      raw_user_text: "be better",
      inbound_message_sid: "SMboot2",
      ai_confidence: null,
      sms_state: "awaiting_candidate",
    });
    const r = await bootstrapSmsPendingConfirmationFromInbound({
      commitment: c,
      rawBody: "be better",
    });
    expect(r.promoted).toBe(false);
    expect(mergeSmsPendingResolutionPayload).not.toHaveBeenCalled();
  });

  it("skips promotion when candidate is unsafe", async () => {
    const c = commitmentWithPending({
      source: "sms_inbound",
      detected_intent: "sms_replace_request",
      raw_user_text: "harm",
      inbound_message_sid: "SMboot3",
      ai_confidence: null,
      sms_state: "awaiting_candidate",
    });
    const r = await bootstrapSmsPendingConfirmationFromInbound({
      commitment: c,
      rawBody: "how to hurt someone at dinner",
    });
    expect(r.promoted).toBe(false);
    expect(mergeSmsPendingResolutionPayload).not.toHaveBeenCalled();
  });

  it("does not run without pending", async () => {
    const c = commitmentWithPending({
      source: "sms_inbound",
      detected_intent: "sms_replace_request",
      raw_user_text: "x",
      inbound_message_sid: "SMboot4",
      ai_confidence: null,
      sms_state: "awaiting_candidate",
    });
    c.pending_resolution_kind = null;
    c.pending_resolution_payload = null;
    const r = await bootstrapSmsPendingConfirmationFromInbound({
      commitment: c,
      rawBody: "change my goal to walking after dinner",
    });
    expect(r.promoted).toBe(false);
    expect(r.skipReason).toBe("no_pending");
  });

  it("does not promote when already awaiting_confirmation", async () => {
    const c = commitmentWithPending({
      source: "sms_inbound",
      detected_intent: "sms_replace_request",
      raw_user_text: "walk",
      inbound_message_sid: "SMboot5",
      ai_confidence: null,
      sms_state: "awaiting_confirmation",
      candidate_behavior_statement: "Walk daily",
    });
    const r = await bootstrapSmsPendingConfirmationFromInbound({
      commitment: c,
      rawBody: "change my goal to walking after dinner",
    });
    expect(r.promoted).toBe(false);
    expect(r.skipReason).toBe("not_awaiting_candidate");
  });

  it('raise_bar command-only "raise the bar" skips with raise_bar_missing_candidate', async () => {
    const c = commitmentWithPending({
      source: "sms_inbound",
      detected_intent: "sms_raise_bar_request",
      raw_user_text: "raise the bar",
      inbound_message_sid: "SMboot6",
      ai_confidence: null,
      sms_state: "awaiting_candidate",
    });
    const r = await bootstrapSmsPendingConfirmationFromInbound({
      commitment: c,
      rawBody: "raise the bar",
    });
    expect(r.promoted).toBe(false);
    expect(r.skipReason).toBe("raise_bar_missing_candidate");
    expect(mergeSmsPendingResolutionPayload).not.toHaveBeenCalled();
  });

  it("raise_bar with embedded harder bar promotes", async () => {
    const body = "new goal: 30 minutes of walking after dinner";
    const c = commitmentWithPending({
      source: "sms_inbound",
      detected_intent: "sms_raise_bar_request",
      raw_user_text: body,
      inbound_message_sid: "SMboot7",
      ai_confidence: null,
      sms_state: "awaiting_candidate",
    });
    const r = await bootstrapSmsPendingConfirmationFromInbound({
      commitment: c,
      rawBody: body,
    });
    expect(r.promoted).toBe(true);
    expect(r.candidate).toMatch(/30 minutes of walking after dinner/i);
  });
});
