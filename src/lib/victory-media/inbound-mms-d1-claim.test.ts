import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/server", () => ({
  after: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import type { PersistRecognizedWinsResult } from "@/lib/v2-win-persist";
import {
  collectDurableWinIdsFromPersistResult,
  inboundMmsD1OriginalJobStillSoleEligible,
  resolveInboundMmsD1ClaimTarget,
  scheduleInboundMmsD1SemanticClaim,
} from "@/lib/victory-media/inbound-mms-d1-claim";
import {
  EMPTY_INBOUND_MMS_D1_PENDING_CONTEXT,
  INBOUND_MEDIA_D1_PENDING_LOOKBACK_MS,
  listInboundMmsD1EligiblePendingJobs,
  type InboundMmsD1JobLite,
  type InboundMmsD1PendingContext,
} from "@/lib/victory-media/inbound-mms-d1-pending-context";
import { EMPTY_INBOUND_SOL_PENDING_PHOTO_RELATION } from "@/lib/inbound-sol-coaching-brief";

const JOB_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const JOB_B = "bbbbbbbb-2222-4222-8222-222222222222";
const FRESH_PROD_JOB = "2cf694ea-ba64-4323-a56f-bdb9a4075136";
const OLD_PROD_JOB = "dba40005-52c2-43bd-a4c1-edadc3ebff7e";
const WIN_A = "cccccccc-3333-4333-8333-333333333333";
const WIN_B = "dddddddd-4444-4444-8444-444444444444";
const VACATION_WIN = "cecc9398-ca3b-46a6-9393-87c9be246665";
const UNKNOWN = "eeeeeeee-5555-4555-8555-555555555555";
const USER = "user_d1";
const BODY_SID = "SMeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const PHOTO_SID = "SMdddddddddddddddddddddddddddddddd";
const PHOTO_SID_B = "SMffffffffffffffffffffffffffffffff";
const NOW = new Date("2026-08-21T12:00:00.000Z");
const MIN_MS = 60 * 1000;

function isoAgo(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

function onePhoto(
  recentIds: string[] = [WIN_A],
  jobId: string = JOB_ID,
  ageSeconds = 120
): InboundMmsD1PendingContext {
  return {
    candidate_count: 1,
    candidate: {
      job_id: jobId,
      age_seconds: ageSeconds,
      message_sid: PHOTO_SID,
      normalized_ready: true,
    },
    recent_wins: recentIds.map((id) => ({
      id,
      text: "Kids hiking",
      occurred_at: "2026-08-20T12:00:00.000Z",
      relationship_type: "whole_life",
      commitment_id: null,
      has_media: false,
    })),
  };
}

function jobLite(partial: Partial<InboundMmsD1JobLite> = {}): InboundMmsD1JobLite {
  return {
    id: JOB_ID,
    message_sid: PHOTO_SID,
    created_at: isoAgo(10 * MIN_MS),
    status: "pending_semantics",
    resolution: null,
    tombstoned_at: null,
    attached_win_id: null,
    semantic_target_win_id: null,
    temp_storage_path: null,
    normalized_storage_path: `mms-norm/${USER}/${JOB_ID}/master.jpg`,
    expires_at: "2026-08-24T12:00:00.000Z",
    ...partial,
  };
}

function persist(ids: Array<{ id: string | null; status: "inserted" | "existing" | "failed" | "skipped" }>): PersistRecognizedWinsResult {
  return {
    attempted: ids.length,
    persisted: ids.filter((w) => w.status === "inserted").length,
    conflicts: ids.filter((w) => w.status === "existing").length,
    failed: ids.filter((w) => w.status === "failed").length,
    allDurable: ids.every((w) => w.status === "inserted" || w.status === "existing"),
    wins: ids.map((w, i) => ({
      ordinal: (i === 0 ? 0 : 1) as 0 | 1,
      id: w.id,
      status: w.status,
      idempotency_key: null,
    })),
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

describe("collectDurableWinIdsFromPersistResult", () => {
  it("uses inserted and existing ids from this result only", () => {
    expect(
      collectDurableWinIdsFromPersistResult(
        persist([
          { id: WIN_A, status: "inserted" },
          { id: null, status: "skipped" },
        ])
      )
    ).toEqual([WIN_A]);
    expect(
      collectDurableWinIdsFromPersistResult(
        persist([
          { id: WIN_A, status: "existing" },
          { id: WIN_B, status: "inserted" },
        ])
      )
    ).toEqual([WIN_A, WIN_B]);
    expect(collectDurableWinIdsFromPersistResult(null)).toEqual([]);
  });
});

describe("inboundMmsD1OriginalJobStillSoleEligible", () => {
  it("allows only the original sole eligible job", () => {
    expect(
      inboundMmsD1OriginalJobStillSoleEligible([jobLite()], JOB_ID)
    ).toBe("allow");
    expect(
      inboundMmsD1OriginalJobStillSoleEligible(
        [jobLite(), jobLite({ id: JOB_B, message_sid: PHOTO_SID_B })],
        JOB_ID
      )
    ).toBe("block");
    expect(
      inboundMmsD1OriginalJobStillSoleEligible(
        [jobLite({ id: JOB_B, message_sid: PHOTO_SID_B })],
        JOB_ID
      )
    ).toBe("block");
    expect(inboundMmsD1OriginalJobStillSoleEligible([], JOB_ID)).toBe("block");
    expect(inboundMmsD1OriginalJobStillSoleEligible("error", JOB_ID)).toBe(
      "lookup_failed"
    );
  });
});

describe("resolveInboundMmsD1ClaimTarget", () => {
  it("current_turn_win with exactly one durable Win claims that id", () => {
    expect(
      resolveInboundMmsD1ClaimTarget({
        context: onePhoto(),
        relation: { relation: "current_turn_win", target_win_id: null },
        winResult: persist([{ id: WIN_A, status: "inserted" }]),
      })
    ).toEqual({ jobId: JOB_ID, targetWinId: WIN_A });
  });

  it("current_turn_win with zero or two durable Wins does not claim", () => {
    expect(
      resolveInboundMmsD1ClaimTarget({
        context: onePhoto(),
        relation: { relation: "current_turn_win", target_win_id: null },
        winResult: null,
      })
    ).toBeNull();
    expect(
      resolveInboundMmsD1ClaimTarget({
        context: onePhoto(),
        relation: { relation: "current_turn_win", target_win_id: null },
        winResult: persist([
          { id: WIN_A, status: "inserted" },
          { id: WIN_B, status: "inserted" },
        ]),
      })
    ).toBeNull();
  });

  it("current_turn_win rejects a model-supplied UUID instead of persist result", () => {
    expect(
      resolveInboundMmsD1ClaimTarget({
        context: onePhoto(),
        relation: { relation: "current_turn_win", target_win_id: WIN_A },
        winResult: persist([{ id: WIN_A, status: "inserted" }]),
      })
    ).toBeNull();
  });

  it("none and uncertain never claim", () => {
    const winResult = persist([{ id: WIN_A, status: "inserted" }]);
    expect(
      resolveInboundMmsD1ClaimTarget({
        context: onePhoto(),
        relation: EMPTY_INBOUND_SOL_PENDING_PHOTO_RELATION,
        winResult,
      })
    ).toBeNull();
    expect(
      resolveInboundMmsD1ClaimTarget({
        context: onePhoto(),
        relation: { relation: "uncertain", target_win_id: null },
        winResult,
      })
    ).toBeNull();
  });

  it("existing_win claims only a supplied recent-win UUID", () => {
    expect(
      resolveInboundMmsD1ClaimTarget({
        context: onePhoto([WIN_A]),
        relation: { relation: "existing_win", target_win_id: WIN_A },
        winResult: null,
      })
    ).toEqual({ jobId: JOB_ID, targetWinId: WIN_A });
    expect(
      resolveInboundMmsD1ClaimTarget({
        context: onePhoto([WIN_A]),
        relation: { relation: "existing_win", target_win_id: UNKNOWN },
        winResult: null,
      })
    ).toBeNull();
  });

  it("does not claim when candidate_count is 0 or 2", () => {
    const relation = {
      relation: "current_turn_win" as const,
      target_win_id: null,
    };
    const winResult = persist([{ id: WIN_A, status: "inserted" }]);
    expect(
      resolveInboundMmsD1ClaimTarget({
        context: EMPTY_INBOUND_MMS_D1_PENDING_CONTEXT,
        relation,
        winResult,
      })
    ).toBeNull();
    expect(
      resolveInboundMmsD1ClaimTarget({
        context: { candidate_count: 2, candidate: null, recent_wins: [] },
        relation,
        winResult,
      })
    ).toBeNull();
  });
});

describe("scheduleInboundMmsD1SemanticClaim", () => {
  const baseArgs = {
    clerkUserId: USER,
    currentMessageSid: BODY_SID,
    context: onePhoto(),
    relation: { relation: "current_turn_win" as const, target_win_id: null },
    winResult: persist([{ id: WIN_A, status: "inserted" }]),
  };

  it("schedules D0 claim via after() and does not throw when claim fails", async () => {
    const { afterFn, run } = captureAfter();
    const claim = vi.fn(async () => ({ ok: false as const, reason: "expired" }));
    const scheduled = scheduleInboundMmsD1SemanticClaim(baseArgs, {
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
    });
  });

  it("does not call after() when there is nothing to claim", () => {
    const afterFn = vi.fn();
    const claim = vi.fn();
    const scheduled = scheduleInboundMmsD1SemanticClaim(
      {
        ...baseArgs,
        relation: EMPTY_INBOUND_SOL_PENDING_PHOTO_RELATION,
      },
      { afterFn, claim }
    );
    expect(scheduled).toBeNull();
    expect(afterFn).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it("STALE SINGLE-CANDIDATE CLAIM = BLOCKED when B appears before after()", async () => {
    const { afterFn, run } = captureAfter();
    const claim = vi.fn();
    let eligible: InboundMmsD1JobLite[] | "error" = [jobLite()];
    const scheduled = scheduleInboundMmsD1SemanticClaim(baseArgs, {
      afterFn,
      claim,
      listEligiblePending: async () => eligible,
    });
    expect(scheduled).toEqual({ jobId: JOB_ID, targetWinId: WIN_A });
    eligible = [
      jobLite(),
      jobLite({ id: JOB_B, message_sid: PHOTO_SID_B }),
    ];
    await run();
    expect(claim).not.toHaveBeenCalled();
  });

  it("does not claim B when A is gone and B is the only eligible job", async () => {
    const { afterFn, run } = captureAfter();
    const claim = vi.fn();
    const listEligiblePending = vi.fn(async () => [
      jobLite({ id: JOB_B, message_sid: PHOTO_SID_B }),
    ]);
    const scheduled = scheduleInboundMmsD1SemanticClaim(baseArgs, {
      afterFn,
      claim,
      listEligiblePending,
    });
    expect(scheduled).toEqual({ jobId: JOB_ID, targetWinId: WIN_A });
    await run();
    expect(claim).not.toHaveBeenCalled();
    expect(listEligiblePending).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: USER,
        currentMessageSid: BODY_SID,
      })
    );
  });

  it("claims when the current eligible set is still exactly the original job", async () => {
    const { afterFn, run } = captureAfter();
    const claim = vi.fn(async () => ({ ok: true as const }));
    const scheduled = scheduleInboundMmsD1SemanticClaim(baseArgs, {
      afterFn,
      claim,
      listEligiblePending: async () => [jobLite()],
    });
    expect(scheduled).toEqual({ jobId: JOB_ID, targetWinId: WIN_A });
    await run();
    expect(claim).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledWith({
      jobId: JOB_ID,
      clerkUserId: USER,
      targetWinId: WIN_A,
    });
  });

  it("claim-time lookup failure fails closed without calling D0", async () => {
    const { afterFn, run } = captureAfter();
    const claim = vi.fn();
    const scheduled = scheduleInboundMmsD1SemanticClaim(baseArgs, {
      afterFn,
      claim,
      listEligiblePending: async () => "error",
    });
    expect(scheduled).toEqual({ jobId: JOB_ID, targetWinId: WIN_A });
    await expect(run()).resolves.toBeUndefined();
    expect(claim).not.toHaveBeenCalled();
  });

  it("claim-time lookup throw fails closed without calling D0", async () => {
    const { afterFn, run } = captureAfter();
    const claim = vi.fn();
    const scheduled = scheduleInboundMmsD1SemanticClaim(baseArgs, {
      afterFn,
      claim,
      listEligiblePending: async () => {
        throw new Error("db");
      },
    });
    expect(scheduled).toEqual({ jobId: JOB_ID, targetWinId: WIN_A });
    await expect(run()).resolves.toBeUndefined();
    expect(claim).not.toHaveBeenCalled();
  });

  it("claim-time revalidation uses the same 30-minute helper window", async () => {
    expect(INBOUND_MEDIA_D1_PENDING_LOOKBACK_MS).toBe(30 * 60 * 1000);
    const { afterFn, run } = captureAfter();
    const claim = vi.fn(async () => ({ ok: true as const }));
    const fresh = jobLite({
      id: FRESH_PROD_JOB,
      message_sid: "MM2cf694eaba644323a56fbdb9a4075136",
      created_at: isoAgo(17 * MIN_MS),
    });
    const old = jobLite({
      id: OLD_PROD_JOB,
      message_sid: "MMdba4000552c243bda4c1edadc3ebff7e",
      created_at: isoAgo(10 * 60 * MIN_MS),
    });
    const scheduled = scheduleInboundMmsD1SemanticClaim(
      {
        ...baseArgs,
        context: onePhoto([], FRESH_PROD_JOB, 17 * 60),
        winResult: persist([{ id: VACATION_WIN, status: "inserted" }]),
      },
      {
        afterFn,
        claim,
        listEligiblePending: (args) =>
          listInboundMmsD1EligiblePendingJobs(
            { ...args, now: NOW },
            {
              hasUnresolvedDeletion: async () => false,
              listPendingJobs: async () => [old, fresh],
              listBodySids: async () => new Set(),
            }
          ),
      }
    );
    expect(scheduled).toEqual({ jobId: FRESH_PROD_JOB, targetWinId: VACATION_WIN });
    await run();
    expect(claim).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledWith({
      jobId: FRESH_PROD_JOB,
      clerkUserId: USER,
      targetWinId: VACATION_WIN,
    });
  });

  it("claim-time 29-minute photo remains eligible", async () => {
    const { afterFn, run } = captureAfter();
    const claim = vi.fn(async () => ({ ok: true as const }));
    const scheduled = scheduleInboundMmsD1SemanticClaim(baseArgs, {
      afterFn,
      claim,
      listEligiblePending: (args) =>
        listInboundMmsD1EligiblePendingJobs(
          { ...args, now: NOW },
          {
            hasUnresolvedDeletion: async () => false,
            listPendingJobs: async () => [
              jobLite({ created_at: isoAgo(29 * MIN_MS) }),
            ],
            listBodySids: async () => new Set(),
          }
        ),
    });
    expect(scheduled).toEqual({ jobId: JOB_ID, targetWinId: WIN_A });
    await run();
    expect(claim).toHaveBeenCalledOnce();
  });

  it("claim-time 31-minute photo is no longer eligible and is not claimed", async () => {
    const { afterFn, run } = captureAfter();
    const claim = vi.fn();
    const aged = jobLite({ created_at: isoAgo(31 * MIN_MS) });
    const snapshot = structuredClone(aged);
    const scheduled = scheduleInboundMmsD1SemanticClaim(baseArgs, {
      afterFn,
      claim,
      listEligiblePending: (args) =>
        listInboundMmsD1EligiblePendingJobs(
          { ...args, now: NOW },
          {
            hasUnresolvedDeletion: async () => false,
            listPendingJobs: async () => [aged],
            listBodySids: async () => new Set(),
          }
        ),
    });
    expect(scheduled).toEqual({ jobId: JOB_ID, targetWinId: WIN_A });
    await run();
    expect(claim).not.toHaveBeenCalled();
    expect(aged).toEqual(snapshot);
  });

  it("claim-time two fresh photos inside 30 minutes do not claim", async () => {
    const { afterFn, run } = captureAfter();
    const claim = vi.fn();
    const scheduled = scheduleInboundMmsD1SemanticClaim(baseArgs, {
      afterFn,
      claim,
      listEligiblePending: (args) =>
        listInboundMmsD1EligiblePendingJobs(
          { ...args, now: NOW },
          {
            hasUnresolvedDeletion: async () => false,
            listPendingJobs: async () => [
              jobLite({ created_at: isoAgo(10 * MIN_MS) }),
              jobLite({
                id: JOB_B,
                message_sid: PHOTO_SID_B,
                created_at: isoAgo(17 * MIN_MS),
              }),
            ],
            listBodySids: async () => new Set(),
          }
        ),
    });
    expect(scheduled).toEqual({ jobId: JOB_ID, targetWinId: WIN_A });
    await run();
    expect(claim).not.toHaveBeenCalled();
  });
});

