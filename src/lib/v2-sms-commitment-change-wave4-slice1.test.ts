import { describe, expect, it, vi } from "vitest";

const { setPendingResolution } = vi.hoisted(() => ({
  setPendingResolution: vi.fn(async () => "2026-05-10T12:00:00.000Z"),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

vi.mock("@/lib/v2-guided-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-guided-resolution")>();
  return {
    ...actual,
    setPendingResolution,
    clearPendingResolutionIfExpired: vi.fn(async () => undefined),
    getPendingResolutionOrNull: vi.fn(() => null),
  };
});

vi.mock("@/lib/v2-commitment", () => ({
  getActiveCommitment: vi.fn(async () => null),
}));

import { applyWave4SmsCommitmentPendingResolution } from "@/lib/v2-sms-commitment-change";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";

function minimalCommitment(overrides: Partial<ActiveV2CommitmentRow> = {}): ActiveV2CommitmentRow {
  return {
    id: "cmt_wave4",
    clerk_user_id: "user_wave4",
    status: "active",
    behavior_statement: "Run 3 miles",
    title: "Running",
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
    pending_resolution_kind: null,
    pending_resolution_created_at: null,
    pending_resolution_expires_at: null,
    pending_resolution_payload: null,
    updated_at: null,
    started_at: null,
    ...overrides,
  };
}

describe("applyWave4SmsCommitmentPendingResolution — Slice 1 parity", () => {
  it("skips with soft_quit before any pending upsert", async () => {
    const r = await applyWave4SmsCommitmentPendingResolution({
      commitmentId: "cmt_wave4",
      clerkUserId: "user_wave4",
      commitment: minimalCommitment(),
      messageSid: "SMwave4softquit",
      rawBody: "I give up",
      intentPack: {
        intent: "sms_soft_quit_or_frustration",
        candidateTightenedBar: null,
        candidateNewBar: null,
        aiConfidence: 0.9,
      },
    });
    expect(r.pendingApplied).toBe(false);
    expect(r.skipReason).toBe("soft_quit");
    expect(r.pendingKind).toBeNull();
  });

  it("maps sms_raise_bar_request to commitment_replace pending", async () => {
    const r = await applyWave4SmsCommitmentPendingResolution({
      commitmentId: "cmt_wave4",
      clerkUserId: "user_wave4",
      commitment: minimalCommitment(),
      messageSid: "SMwave4raise",
      rawBody: "this goal is too easy",
      intentPack: {
        intent: "sms_raise_bar_request",
        candidateTightenedBar: null,
        candidateNewBar: null,
        aiConfidence: 0.9,
      },
    });
    expect(r.pendingApplied).toBe(true);
    expect(r.pendingKind).toBe("commitment_replace");
    expect(setPendingResolution).toHaveBeenCalled();
    const payload = (setPendingResolution as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]
      ?.payload;
    expect(payload?.detected_intent).toBe("sms_raise_bar_request");
  });

  it("skips with paused_reactivation when accountability phase is low_pressure_reactivation", async () => {
    const r = await applyWave4SmsCommitmentPendingResolution({
      commitmentId: "cmt_wave4",
      clerkUserId: "user_wave4",
      commitment: minimalCommitment({ accountability_phase: "low_pressure_reactivation" }),
      messageSid: "SMwave4paused",
      rawBody: "Change my goal",
      intentPack: {
        intent: "sms_replace_request",
        candidateTightenedBar: null,
        candidateNewBar: "Walk 20 minutes",
        aiConfidence: 0.85,
      },
    });
    expect(r.pendingApplied).toBe(false);
    expect(r.skipReason).toBe("paused_reactivation");
  });
});
