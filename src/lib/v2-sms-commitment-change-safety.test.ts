import { describe, expect, it, vi } from "vitest";

const { setPendingResolution } = vi.hoisted(() => ({
  setPendingResolution: vi.fn(async () => undefined),
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

function minimalCommitment(): ActiveV2CommitmentRow {
  return {
    id: "cmt_safety",
    clerk_user_id: "user_safety",
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
    pending_resolution_kind: null,
    pending_resolution_created_at: null,
    pending_resolution_expires_at: null,
    pending_resolution_payload: null,
    updated_at: null,
    started_at: null,
  };
}

describe("applyWave4SmsCommitmentPendingResolution — unsafe goal guard", () => {
  it("skips harmful candidate without setPendingResolution", async () => {
    setPendingResolution.mockClear();
    const r = await applyWave4SmsCommitmentPendingResolution({
      commitmentId: "cmt_safety",
      clerkUserId: "user_safety",
      commitment: minimalCommitment(),
      messageSid: "SMharmful1",
      rawBody: "Change my goal",
      intentPack: {
        intent: "sms_replace_request",
        candidateTightenedBar: null,
        candidateNewBar: "starve myself",
        aiConfidence: 0.9,
      },
    });
    expect(r.pendingApplied).toBe(false);
    expect(r.skipReason).toBe("unsafe_goal_content");
    expect(setPendingResolution).not.toHaveBeenCalled();
  });

  it("skips when raw body is harmful", async () => {
    setPendingResolution.mockClear();
    const r = await applyWave4SmsCommitmentPendingResolution({
      commitmentId: "cmt_safety",
      clerkUserId: "user_safety",
      commitment: minimalCommitment(),
      messageSid: "SMharmful2",
      rawBody: "My goal is to starve myself.",
      intentPack: {
        intent: "sms_replace_request",
        candidateTightenedBar: null,
        candidateNewBar: null,
        aiConfidence: 0.9,
      },
    });
    expect(r.skipReason).toBe("unsafe_goal_content");
    expect(setPendingResolution).not.toHaveBeenCalled();
  });

  it("still allows safe goal-change candidate", async () => {
    setPendingResolution.mockClear();
    const r = await applyWave4SmsCommitmentPendingResolution({
      commitmentId: "cmt_safety",
      clerkUserId: "user_safety",
      commitment: minimalCommitment(),
      messageSid: "SMsafe1",
      rawBody: "Change my goal to walk 10000 steps daily",
      intentPack: {
        intent: "sms_replace_request",
        candidateTightenedBar: null,
        candidateNewBar: "walk 10000 steps daily",
        aiConfidence: 0.9,
      },
    });
    expect(r.skipReason).not.toBe("unsafe_goal_content");
    expect(r.pendingApplied).toBe(true);
    expect(setPendingResolution).toHaveBeenCalled();
  });
});
