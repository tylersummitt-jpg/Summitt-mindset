import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/server", () => ({
  after: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import type { PersistRecognizedWinsResult } from "@/lib/v2-win-persist";
import { EMPTY_INBOUND_SOL_PENDING_PHOTO_RELATION } from "@/lib/inbound-sol-coaching-brief";
import {
  INBOUND_MEDIA_D2C_EXPECTED_RESOLUTION,
  scheduleInboundMmsD2cSemanticClaim,
} from "@/lib/victory-media/inbound-mms-d2c-claim";
import type { InboundMmsD1PendingContext } from "@/lib/victory-media/inbound-mms-d1-pending-context";
import type { InboundMmsD2cJobLite } from "@/lib/victory-media/inbound-mms-d2c-pending-context";

const JOB_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const JOB_B = "bbbbbbbb-2222-4222-8222-222222222222";
const WIN_A = "cccccccc-3333-4333-8333-333333333333";
const USER = "user_d2c";
const BODY_SID = "SMeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const PHOTO_SID = "SMdddddddddddddddddddddddddddddddd";
const PHOTO_SID_B = "SMffffffffffffffffffffffffffffffff";
const QUESTION = "What made this one a win for you?";

function oneClarification(
  jobId: string = JOB_ID
): InboundMmsD1PendingContext {
  return {
    candidate_count: 1,
    candidate: {
      job_id: jobId,
      age_seconds: 2400,
      message_sid: PHOTO_SID,
      normalized_ready: true,
      awaiting_user: true,
      clarification_body: QUESTION,
    },
    recent_wins: [
      {
        id: WIN_A,
        text: "Kids hiking",
        occurred_at: "2026-08-20T12:00:00.000Z",
        relationship_type: "whole_life",
        commitment_id: null,
        has_media: false,
      },
    ],
  };
}

function jobLite(partial: Partial<InboundMmsD2cJobLite> = {}): InboundMmsD2cJobLite {
  return {
    id: JOB_ID,
    message_sid: PHOTO_SID,
    created_at: "2026-08-22T15:20:00.000Z",
    status: "pending_semantics",
    resolution: "pending_user",
    tombstoned_at: null,
    attached_win_id: null,
    semantic_target_win_id: null,
    temp_storage_path: null,
    normalized_storage_path: `mms-norm/${USER}/${JOB_ID}/master.jpg`,
    expires_at: "2026-08-25T12:00:00.000Z",
    clarification_body: QUESTION,
    followup_idempotency_key: `mms-d2-clarify:${JOB_ID}`,
    ...partial,
  };
}

function persist(id: string): PersistRecognizedWinsResult {
  return {
    attempted: 1,
    persisted: 1,
    conflicts: 0,
    failed: 0,
    allDurable: true,
    wins: [{ ordinal: 0, id, status: "inserted", idempotency_key: null }],
  };
}

function captureAfter() {
  let callback: () => void | Promise<void> = async () => {};
  const afterFn = vi.fn((fn: () => void | Promise<void>) => {
    callback = fn;
  });
  return {
    afterFn,
    run: async () => {
      await callback();
    },
  };
}

describe("scheduleInboundMmsD2cSemanticClaim", () => {
  const baseArgs = {
    clerkUserId: USER,
    currentMessageSid: BODY_SID,
    context: oneClarification(),
    relation: { relation: "current_turn_win" as const, target_win_id: null },
    winResult: persist(WIN_A),
  };

  it("claims via D0 with expectedResolution pending_user", async () => {
    const { afterFn, run } = captureAfter();
    const claim = vi.fn(async () => ({
      ok: true as const,
      jobId: JOB_ID,
      targetWinId: WIN_A,
    }));
    const scheduled = scheduleInboundMmsD2cSemanticClaim(baseArgs, {
      afterFn,
      claim,
      listEligiblePending: async () => [jobLite()],
    });
    expect(scheduled).toEqual({ jobId: JOB_ID, targetWinId: WIN_A });
    expect(afterFn).toHaveBeenCalledOnce();
    await run();
    expect(claim).toHaveBeenCalledWith({
      jobId: JOB_ID,
      clerkUserId: USER,
      targetWinId: WIN_A,
      expectedResolution: INBOUND_MEDIA_D2C_EXPECTED_RESOLUTION,
    });
    expect(INBOUND_MEDIA_D2C_EXPECTED_RESOLUTION).toBe("pending_user");
  });

  it("does not schedule D1-shaped context (no awaiting_user)", () => {
    const afterFn = vi.fn();
    const claim = vi.fn();
    const scheduled = scheduleInboundMmsD2cSemanticClaim(
      {
        ...baseArgs,
        context: {
          candidate_count: 1,
          candidate: {
            job_id: JOB_ID,
            age_seconds: 120,
            message_sid: PHOTO_SID,
            normalized_ready: true,
          },
          recent_wins: [],
        },
      },
      { afterFn, claim }
    );
    expect(scheduled).toBeNull();
    expect(afterFn).not.toHaveBeenCalled();
  });

  it("does not call after() when relation is none", () => {
    const afterFn = vi.fn();
    const claim = vi.fn();
    const scheduled = scheduleInboundMmsD2cSemanticClaim(
      {
        ...baseArgs,
        relation: EMPTY_INBOUND_SOL_PENDING_PHOTO_RELATION,
      },
      { afterFn, claim }
    );
    expect(scheduled).toBeNull();
    expect(afterFn).not.toHaveBeenCalled();
  });

  it("does not claim when two pending_user jobs appear before after()", async () => {
    const { afterFn, run } = captureAfter();
    const claim = vi.fn();
    let eligible: InboundMmsD2cJobLite[] | "error" = [jobLite()];
    const scheduled = scheduleInboundMmsD2cSemanticClaim(baseArgs, {
      afterFn,
      claim,
      listEligiblePending: async () => eligible,
    });
    expect(scheduled).toEqual({ jobId: JOB_ID, targetWinId: WIN_A });
    eligible = [
      jobLite(),
      jobLite({
        id: JOB_B,
        message_sid: PHOTO_SID_B,
        followup_idempotency_key: `mms-d2-clarify:${JOB_B}`,
      }),
    ];
    await run();
    expect(claim).not.toHaveBeenCalled();
  });

  it("does not substitute a later pending_user job", async () => {
    const { afterFn, run } = captureAfter();
    const claim = vi.fn();
    const scheduled = scheduleInboundMmsD2cSemanticClaim(baseArgs, {
      afterFn,
      claim,
      listEligiblePending: async () => [
        jobLite({
          id: JOB_B,
          message_sid: PHOTO_SID_B,
          followup_idempotency_key: `mms-d2-clarify:${JOB_B}`,
        }),
      ],
    });
    expect(scheduled).toEqual({ jobId: JOB_ID, targetWinId: WIN_A });
    await run();
    expect(claim).not.toHaveBeenCalled();
  });

  it("current_turn_win with zero durable Wins does not claim", () => {
    const afterFn = vi.fn();
    const claim = vi.fn();
    const scheduled = scheduleInboundMmsD2cSemanticClaim(
      { ...baseArgs, winResult: null },
      { afterFn, claim }
    );
    expect(scheduled).toBeNull();
    expect(afterFn).not.toHaveBeenCalled();
  });
});
