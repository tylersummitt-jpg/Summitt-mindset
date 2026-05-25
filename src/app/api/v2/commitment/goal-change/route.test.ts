import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  authMock,
  getActiveCommitmentMock,
  ensurePendingMock,
  applyCanonicalMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  getActiveCommitmentMock: vi.fn(),
  ensurePendingMock: vi.fn(),
  applyCanonicalMock: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/v2-commitment", () => ({
  getActiveCommitment: (...args: unknown[]) => getActiveCommitmentMock(...args),
}));

vi.mock("@/lib/v2-guided-resolution", () => ({
  ensureCommitmentReplacePendingForCanonicalGoalChange: (...args: unknown[]) =>
    ensurePendingMock(...args),
  V2_APP_GOAL_CHANGE_PENDING_BLOCK_MESSAGE:
    "You already have an accountability update waiting. Finish that first, then you can update your goal.",
}));

vi.mock("@/lib/v2-apply-canonical-goal-change", () => ({
  applyCanonicalGoalChangeWithSeasonMutation: (...args: unknown[]) => applyCanonicalMock(...args),
}));

vi.mock("@/lib/sms-inbound-safety", () => ({
  isUnsafeSmsGoalCandidateText: vi.fn(() => false),
}));

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";

function baseCommitment() {
  return {
    id: "cmt_1",
    clerk_user_id: "user_1",
    status: "active",
    behavior_statement: "Walk 10 minutes",
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
    updated_at: "2026-01-01T00:00:00.000Z",
    started_at: null,
  };
}

describe("POST /api/v2/commitment/goal-change", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
    getActiveCommitmentMock.mockResolvedValue(baseCommitment());
    applyCanonicalMock.mockResolvedValue({
      ok: true,
      seasonMode: "same_season_sync",
      oldCommitmentId: "cmt_1",
      newCommitmentId: "cmt_1",
      idempotentReplay: false,
    });
  });

  it("returns 409 when pending exists from non-app source", async () => {
    ensurePendingMock.mockResolvedValue({
      ok: false,
      code: "pending_other_update",
      message:
        "You already have an accountability update waiting. Finish that first, then you can update your goal.",
    });

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/commitment/goal-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          behavior_statement: "Read 10 pages daily",
          season_mode: "same_season_sync",
          client_request_id: CLIENT_ID,
        }),
      })
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("pending_other_update");
    expect(applyCanonicalMock).not.toHaveBeenCalled();
    expect(ensurePendingMock).toHaveBeenCalledWith(
      expect.objectContaining({ allowExistingAppGoalChangeOnly: true })
    );
  });
});
