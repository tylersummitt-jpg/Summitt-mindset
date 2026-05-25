import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";

const { getActiveCommitmentMock, fromMock } = vi.hoisted(() => ({
  getActiveCommitmentMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: (...args: unknown[]) => fromMock(...args) },
}));

vi.mock("@/lib/v2-commitment", () => ({
  getActiveCommitment: (...args: unknown[]) => getActiveCommitmentMock(...args),
}));

import {
  V2_APP_GOAL_CHANGE_PENDING_BLOCK_MESSAGE,
  V2_COMPETING_APP_GOAL_CHANGE_MESSAGE,
  ensureCommitmentReplacePendingForCanonicalGoalChange,
} from "@/lib/v2-guided-resolution";

const NOW_MS = Date.parse("2026-05-10T12:00:00.000Z");
const CLIENT_A = "11111111-1111-4111-8111-111111111111";
const CLIENT_B = "22222222-2222-4222-8222-222222222222";

function baseCommitment(
  overrides: Partial<ActiveV2CommitmentRow> = {}
): ActiveV2CommitmentRow {
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
    ...overrides,
  };
}

function pendingTimestamps() {
  return {
    pending_resolution_created_at: "2026-05-10T12:00:00.000Z",
    pending_resolution_expires_at: "2027-05-10T12:00:00.000Z",
  };
}

function wireSupabaseMergeSuccess(
  commitment: ActiveV2CommitmentRow,
  updatedAt = "2026-05-10T12:01:00.000Z"
) {
  fromMock.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: {
            updated_at: commitment.updated_at,
            pending_resolution_kind: commitment.pending_resolution_kind,
            pending_resolution_payload: commitment.pending_resolution_payload,
          },
          error: null,
        }),
      }),
    }),
    update: () => ({
      eq: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => ({
              data: { updated_at: updatedAt },
              error: null,
            }),
          }),
        }),
        select: () => ({
          maybeSingle: async () => ({
            data: { updated_at: updatedAt },
            error: null,
          }),
        }),
      }),
    }),
  }));
}

describe("ensureCommitmentReplacePendingForCanonicalGoalChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveCommitmentMock.mockImplementation(async () => baseCommitment());
  });

  it("blocks existing coaching_refresh_resolved commitment_replace pending", async () => {
    const commitment = baseCommitment({
      pending_resolution_kind: "commitment_replace",
      ...pendingTimestamps(),
      pending_resolution_payload: {
        source: "coaching_refresh_resolved",
        resolution: "change",
        session_id: "sess_1",
        inbound_message_sid: "SMrefresh1",
      },
    });
    getActiveCommitmentMock.mockResolvedValue(commitment);

    const r = await ensureCommitmentReplacePendingForCanonicalGoalChange({
      clerkUserId: "user_1",
      commitment,
      behaviorStatement: "Read 10 pages daily",
      seasonMode: "same_season_sync",
      clientRequestId: CLIENT_A,
      nowMs: NOW_MS,
      allowExistingAppGoalChangeOnly: true,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("pending_other_update");
      expect(r.message).toBe(V2_APP_GOAL_CHANGE_PENDING_BLOCK_MESSAGE);
    }
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("allows idempotent retry for app_goal_change with same client_request_id", async () => {
    const commitment = baseCommitment({
      pending_resolution_kind: "commitment_replace",
      ...pendingTimestamps(),
      pending_resolution_payload: {
        source: "app_goal_change",
        raw_user_text: "Read 10 pages",
        candidate_behavior_statement: "Read 10 pages",
        season_mode: "same_season_sync",
        client_request_id: CLIENT_A,
        confirmed_at: "2026-05-10T12:00:00.000Z",
      },
    });
    wireSupabaseMergeSuccess(commitment);
    getActiveCommitmentMock
      .mockResolvedValueOnce(commitment)
      .mockResolvedValueOnce({
        ...commitment,
        updated_at: "2026-05-10T12:01:00.000Z",
      });

    const r = await ensureCommitmentReplacePendingForCanonicalGoalChange({
      clerkUserId: "user_1",
      commitment,
      behaviorStatement: "Read 10 pages daily",
      seasonMode: "same_season_sync",
      clientRequestId: CLIENT_A,
      nowMs: NOW_MS,
      allowExistingAppGoalChangeOnly: true,
    });

    expect(r.ok).toBe(true);
    expect(fromMock).toHaveBeenCalled();
  });

  it("rejects competing app_goal_change with different client_request_id", async () => {
    const commitment = baseCommitment({
      pending_resolution_kind: "commitment_replace",
      ...pendingTimestamps(),
      pending_resolution_payload: {
        source: "app_goal_change",
        raw_user_text: "Read 10 pages",
        candidate_behavior_statement: "Read 10 pages",
        season_mode: "same_season_sync",
        client_request_id: CLIENT_A,
        confirmed_at: "2026-05-10T12:00:00.000Z",
      },
    });
    getActiveCommitmentMock.mockResolvedValue(commitment);

    const r = await ensureCommitmentReplacePendingForCanonicalGoalChange({
      clerkUserId: "user_1",
      commitment,
      behaviorStatement: "Meditate 5 minutes",
      seasonMode: "new_chapter",
      clientRequestId: CLIENT_B,
      nowMs: NOW_MS,
      allowExistingAppGoalChangeOnly: true,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("competing_app_goal_change");
      expect(r.message).toBe(V2_COMPETING_APP_GOAL_CHANGE_MESSAGE);
    }
    expect(fromMock).not.toHaveBeenCalled();
  });
});
