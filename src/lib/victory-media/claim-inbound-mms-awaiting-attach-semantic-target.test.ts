import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/server", () => ({
  after: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  hasUnresolvedAccountDeletionRequest: vi.fn(async () => false),
}));

import type { InboundMediaJobRow } from "@/lib/victory-media/claim-inbound-media-job";
import {
  claimInboundMediaJobAwaitingAttachSemanticTarget,
  isInboundMediaJobAwaitingAttachSemanticTargetClaimable,
} from "@/lib/victory-media/claim-inbound-mms-awaiting-attach-semantic-target";
import { isInboundMediaJobSemanticTargetClaimable } from "@/lib/victory-media/claim-inbound-mms-semantic-target";
import { victoryMediaMmsNormMasterPath } from "@/lib/victory-media/storage-paths";

const NOW = new Date("2026-08-21T12:00:00.000Z");
const JOB_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const WIN_A = "cccccccc-3333-4333-8333-333333333333";
const USER = "user_d0";
const OTHER = "user_other";
const PHOTO_SID = "SMdddddddddddddddddddddddddddddddd";
const NORM = victoryMediaMmsNormMasterPath(USER, JOB_ID);

function awaitingJob(partial: Partial<InboundMediaJobRow> = {}): InboundMediaJobRow {
  return {
    id: JOB_ID,
    message_sid: PHOTO_SID,
    media_ordinal: 0,
    clerk_user_id: USER,
    twilio_media_sid: "MEcccccccccccccccccccccccccccccccc",
    declared_content_type: "image/jpeg",
    status: "awaiting_attach",
    attempt_count: 2,
    next_retry_at: NOW.toISOString(),
    last_error_code: "waiting_for_win",
    temp_storage_path: null,
    normalized_storage_path: NORM,
    attached_win_id: null,
    semantic_target_win_id: null,
    resolution: null,
    classifier_target: null,
    followup_idempotency_key: null,
    clarification_body: null,
    expires_at: "2026-08-24T12:00:00.000Z",
    tombstoned_at: null,
    created_at: "2026-08-19T00:00:00.000Z",
    updated_at: "2026-08-21T11:00:00.000Z",
    ...partial,
  };
}

function eligibleWin() {
  return {
    id: WIN_A,
    clerk_user_id: USER,
    status: "active",
    hidden_at: null,
  };
}

function okDeps(
  overrides: Parameters<typeof claimInboundMediaJobAwaitingAttachSemanticTarget>[1] = {}
) {
  return {
    hasUnresolvedDeletion: async () => false,
    loadJob: async () => awaitingJob(),
    loadTargetWin: async () => eligibleWin(),
    loadMediaForWin: async () => null,
    loadSameSidJobs: async () => [{ id: JOB_ID }],
    loadSameSidActiveWins: async () => 0,
    casClaim: async () => true,
    ...overrides,
  };
}

describe("awaiting_attach semantic-target sibling", () => {
  it("accepts awaiting_attach waiting_for_win / null last_error_code and rejects pending_semantics", () => {
    expect(
      isInboundMediaJobAwaitingAttachSemanticTargetClaimable(awaitingJob(), {
        clerkUserId: USER,
        now: NOW,
      })
    ).toBe(true);
    expect(
      isInboundMediaJobAwaitingAttachSemanticTargetClaimable(
        awaitingJob({ last_error_code: null }),
        { clerkUserId: USER, now: NOW }
      )
    ).toBe(true);
    expect(
      isInboundMediaJobAwaitingAttachSemanticTargetClaimable(
        awaitingJob({ status: "pending_semantics", last_error_code: "semantic_due" }),
        { clerkUserId: USER, now: NOW }
      )
    ).toBe(false);
    expect(
      isInboundMediaJobSemanticTargetClaimable(
        awaitingJob({ status: "pending_semantics", last_error_code: "semantic_due" }),
        { clerkUserId: USER, now: NOW }
      )
    ).toBe(true);
    expect(
      isInboundMediaJobSemanticTargetClaimable(awaitingJob(), {
        clerkUserId: USER,
        now: NOW,
      })
    ).toBe(false);
  });

  it("CAS stays awaiting_attach with semantic_target", async () => {
    const casClaim = vi.fn(async () => true);
    const r = await claimInboundMediaJobAwaitingAttachSemanticTarget(
      { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
      okDeps({ casClaim })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, targetWinId: WIN_A });
    expect(casClaim).toHaveBeenCalled();
  });

  it("rejects hidden and occupied targets without CAS", async () => {
    const casClaim = vi.fn(async () => true);
    const hidden = await claimInboundMediaJobAwaitingAttachSemanticTarget(
      { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
      okDeps({
        loadTargetWin: async () => ({
          ...eligibleWin(),
          hidden_at: NOW.toISOString(),
        }),
        casClaim,
      })
    );
    const occupied = await claimInboundMediaJobAwaitingAttachSemanticTarget(
      { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
      okDeps({
        loadMediaForWin: async () => ({
          id: "eeeeeeee-5555-4555-8555-555555555555",
          win_id: WIN_A,
          source_type: "inbound_mms",
        }),
        casClaim,
      })
    );
    const otherUser = await claimInboundMediaJobAwaitingAttachSemanticTarget(
      { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
      okDeps({
        loadTargetWin: async () => ({ ...eligibleWin(), clerk_user_id: OTHER }),
        casClaim,
      })
    );
    expect(hidden).toEqual({ ok: false, reason: "target_ineligible" });
    expect(occupied).toEqual({ ok: false, reason: "media_exists" });
    expect(otherUser).toEqual({ ok: false, reason: "target_ineligible" });
    expect(casClaim).not.toHaveBeenCalled();
  });

  it.each([1, 2])(
    "refuses when %s active same-SID win(s) already exist",
    async (count) => {
      const casClaim = vi.fn(async () => true);
      const r = await claimInboundMediaJobAwaitingAttachSemanticTarget(
        { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
        okDeps({
          loadSameSidActiveWins: async () => count,
          casClaim,
        })
      );
      expect(r).toEqual({ ok: false, reason: "same_sid_win_exists" });
      expect(casClaim).not.toHaveBeenCalled();
    }
  );

  it("fail-closes pending claim when same-SID win query errors", async () => {
    const casClaim = vi.fn(async () => true);
    const r = await claimInboundMediaJobAwaitingAttachSemanticTarget(
      { jobId: JOB_ID, clerkUserId: USER, targetWinId: WIN_A, now: NOW },
      okDeps({
        loadSameSidActiveWins: async () => "error",
        casClaim,
      })
    );
    expect(r).toEqual({ ok: false, reason: "correlation_query_failed" });
    expect(casClaim).not.toHaveBeenCalled();
  });
});
