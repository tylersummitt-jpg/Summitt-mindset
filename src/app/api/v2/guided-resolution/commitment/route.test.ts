import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  authMock,
  getActiveCommitmentMock,
  clearExpiredMock,
  clearPendingMock,
  getPendingMock,
  applyCanonicalMock,
  unsafeMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  getActiveCommitmentMock: vi.fn(),
  clearExpiredMock: vi.fn(),
  clearPendingMock: vi.fn(),
  getPendingMock: vi.fn(),
  applyCanonicalMock: vi.fn(),
  unsafeMock: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/v2-commitment", () => ({
  getActiveCommitment: (...args: unknown[]) => getActiveCommitmentMock(...args),
}));

vi.mock("@/lib/v2-guided-resolution", () => ({
  clearPendingResolutionIfExpired: (...args: unknown[]) => clearExpiredMock(...args),
  clearPendingResolution: (...args: unknown[]) => clearPendingMock(...args),
  getPendingResolutionOrNull: (...args: unknown[]) => getPendingMock(...args),
}));

vi.mock("@/lib/v2-apply-canonical-goal-change", () => ({
  applyCanonicalGoalChangeWithSeasonMutation: (...args: unknown[]) => applyCanonicalMock(...args),
}));

vi.mock("@/lib/sms-inbound-safety", () => ({
  isUnsafeSmsGoalCandidateText: (...args: unknown[]) => unsafeMock(...args),
}));

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
    pending_resolution_kind: "commitment_replace",
    pending_resolution_created_at: "2026-05-10T12:00:00.000Z",
    pending_resolution_expires_at: "2027-05-10T12:00:00.000Z",
    pending_resolution_payload: {
      source: "coaching_refresh_resolved",
      resolution: "change",
      session_id: "sess_1",
      inbound_message_sid: "SM123",
    },
    updated_at: "2026-01-01T00:00:00.000Z",
    started_at: null,
  };
}

describe("POST /api/v2/guided-resolution/commitment", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
    getActiveCommitmentMock.mockResolvedValue(baseCommitment());
    clearExpiredMock.mockResolvedValue(undefined);
    getPendingMock.mockReturnValue({
      kind: "commitment_replace",
      createdAt: "2026-05-10T12:00:00.000Z",
      expiresAt: "2027-05-10T12:00:00.000Z",
      payload: {
        source: "coaching_refresh_resolved",
        resolution: "change",
        session_id: "sess_1",
        inbound_message_sid: "SM123",
      },
    });
    unsafeMock.mockReturnValue(false);
  });

  it("rejects unsafe goal text before canonical apply", async () => {
    unsafeMock.mockReturnValue(true);

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/v2/guided-resolution/commitment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          behavior_statement: "My goal is to starve myself.",
        }),
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("unsafe_goal_content");
    expect(applyCanonicalMock).not.toHaveBeenCalled();
  });
});
