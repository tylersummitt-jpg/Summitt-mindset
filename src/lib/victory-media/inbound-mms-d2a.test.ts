import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/server", () => ({
  after: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  hasUnresolvedAccountDeletionRequest: vi.fn(async () => false),
}));

import { supabaseServer } from "@/lib/supabase-server";
import type { InboundMediaJobRow } from "@/lib/victory-media/claim-inbound-media-job";
import {
  INBOUND_MEDIA_D2A_GRACE_FLOOR_MS,
  INBOUND_MEDIA_D2A_GRACE_MS,
  INBOUND_MEDIA_D2A_MODEL_RETRY_MS,
  INBOUND_MEDIA_D2A_OWNED_LAST_ERROR_CODES,
  INBOUND_MEDIA_D2A_SEMANTIC_DUE,
  INBOUND_MEDIA_D2A_SEMANTIC_GRACE,
  INBOUND_MEDIA_D2A_SEMANTIC_MODEL_FAILED,
  inboundMmsD2aGraceRetryIso,
  inboundMmsD2aParkRetryIso,
} from "@/lib/victory-media/inbound-mms-d2a-codes";
import {
  isInboundMediaJobD2aDueListCandidate,
  listInboundMediaJobsForD2a,
  processInboundMmsD2aJob,
} from "@/lib/victory-media/inbound-mms-d2a";
import type { InboundMmsD2aSemanticFacts } from "@/lib/victory-media/inbound-mms-d2a-semantics";
import { victoryMediaMmsNormMasterPath } from "@/lib/victory-media/storage-paths";

const NOW = new Date("2026-08-22T12:00:00.000Z");
const JOB_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const JOB_B = "bbbbbbbb-2222-4222-8222-222222222222";
const WIN_A = "cccccccc-3333-4333-8333-333333333333";
const WIN_UNKNOWN = "dddddddd-4444-4444-8444-444444444444";
const USER = "user_d2a";
const PHOTO_SID = "SMdddddddddddddddddddddddddddddddd";
const PHOTO_SID_B = "SMffffffffffffffffffffffffffffffff";
const NORM = victoryMediaMmsNormMasterPath(USER, JOB_ID);

function dueJob(partial: Partial<InboundMediaJobRow> = {}): InboundMediaJobRow {
  return {
    id: JOB_ID,
    message_sid: PHOTO_SID,
    media_ordinal: 0,
    clerk_user_id: USER,
    twilio_media_sid: "MEcccccccccccccccccccccccccccccccc",
    declared_content_type: "image/jpeg",
    status: "pending_semantics",
    attempt_count: 2,
    next_retry_at: NOW.toISOString(),
    last_error_code: INBOUND_MEDIA_D2A_SEMANTIC_DUE,
    temp_storage_path: null,
    normalized_storage_path: NORM,
    attached_win_id: null,
    semantic_target_win_id: null,
    resolution: null,
    classifier_target: null,
    followup_idempotency_key: null,
    clarification_body: null,
    expires_at: "2026-08-25T12:00:00.000Z",
    tombstoned_at: null,
    created_at: "2026-08-22T11:58:00.000Z",
    updated_at: "2026-08-22T11:59:00.000Z",
    ...partial,
  };
}

function facts(
  partial: Partial<InboundMmsD2aSemanticFacts> = {}
): InboundMmsD2aSemanticFacts {
  return {
    pending_photo: {
      job_id: JOB_ID,
      age_seconds: 120,
      message_sid: PHOTO_SID,
    },
    recent_thread: [
      {
        at: "2026-08-22T11:56:00.000Z",
        role: "user",
        body: "Breck hit his first home run!",
      },
    ],
    candidate_wins: [
      {
        id: WIN_A,
        text: "Breck hit his first home run",
        occurred_at: "2026-08-22T11:56:00.000Z",
        relationship_type: "whole_life",
        commitment_id: null,
      },
    ],
    current_goal: "Be present with family",
    identity: null,
    open_coach_question: null,
    ...partial,
  };
}

function mockD2aList(rows: Array<Record<string, unknown>>) {
  const captured: {
    inCol?: string;
    inVals?: unknown;
    limit?: number;
    eq?: Array<[string, unknown]>;
  } = { eq: [] };
  const api = {
    select: () => api,
    eq: (col: string, val: unknown) => {
      captured.eq!.push([col, val]);
      return api;
    },
    is: () => api,
    not: () => api,
    lte: () => api,
    order: () => api,
    in: (col: string, vals: unknown) => {
      captured.inCol = col;
      captured.inVals = vals;
      return api;
    },
    limit: (n: number) => {
      captured.limit = n;
      return api;
    },
    then(resolve: (v: { data: unknown; error: unknown }) => void) {
      const codes = Array.isArray(captured.inVals) ? captured.inVals : [];
      let match = rows.filter((r) => codes.includes(r.last_error_code));
      if (captured.limit != null) match = match.slice(0, captured.limit);
      resolve({ data: match, error: null });
    },
  };
  vi.mocked(supabaseServer.from).mockReturnValue(
    api as unknown as ReturnType<typeof supabaseServer.from>
  );
  return captured;
}

function processDeps(
  overrides: Parameters<typeof processInboundMmsD2aJob>[1] = {}
): NonNullable<Parameters<typeof processInboundMmsD2aJob>[1]> {
  return {
    now: NOW,
    hasUnresolvedDeletion: async () => false,
    loadJob: async () => dueJob(),
    listSiblingPhotos: async () => [],
    loadFacts: async () => facts(),
    runSemantics: async () => ({
      ok: true as const,
      decision: "no_attach" as const,
      target_win_id: null,
    }),
    claim: async () => ({ ok: false as const, reason: "not_used" }),
    casPark: async () => true,
    removeObjects: async () => {},
    ...overrides,
  };
}

describe("D2a codes and grace timing", () => {
  it("owns only semantic_due/model_failed; D2b owns semantic_grace", () => {
    expect(INBOUND_MEDIA_D2A_GRACE_MS).toBe(10 * 60 * 1000);
    expect([...INBOUND_MEDIA_D2A_OWNED_LAST_ERROR_CODES]).toEqual([
      "semantic_due",
      "semantic_model_failed",
    ]);
    expect(INBOUND_MEDIA_D2A_OWNED_LAST_ERROR_CODES).not.toContain(
      "semantic_grace"
    );
  });

  it("arms grace at created_at+10m, or now+60s if already past", () => {
    const created = new Date(NOW.getTime() - 60_000).toISOString();
    expect(
      inboundMmsD2aGraceRetryIso({ createdAt: created, now: NOW })
    ).toBe(new Date(new Date(created).getTime() + INBOUND_MEDIA_D2A_GRACE_MS).toISOString());
    const late = new Date(NOW.getTime() - 15 * 60_000).toISOString();
    expect(
      inboundMmsD2aGraceRetryIso({ createdAt: late, now: NOW })
    ).toBe(new Date(NOW.getTime() + INBOUND_MEDIA_D2A_GRACE_FLOOR_MS).toISOString());
  });

  it("parks grace until expires_at", () => {
    expect(
      inboundMmsD2aParkRetryIso({
        expiresAt: "2026-08-25T12:00:00.000Z",
        now: NOW,
      })
    ).toBe("2026-08-25T12:00:00.000Z");
  });
});

describe("isInboundMediaJobD2aDueListCandidate", () => {
  it("accepts a newly armed semantic_due job", () => {
    expect(isInboundMediaJobD2aDueListCandidate(dueJob(), NOW)).toBe(true);
  });

  it("rejects historical NULL/NULL pending_semantics", () => {
    expect(
      isInboundMediaJobD2aDueListCandidate(
        dueJob({ next_retry_at: null, last_error_code: null }),
        NOW
      )
    ).toBe(false);
  });

  it("rejects due semantic_grace so D2b owns that wake", () => {
    expect(
      isInboundMediaJobD2aDueListCandidate(
        dueJob({ last_error_code: INBOUND_MEDIA_D2A_SEMANTIC_GRACE }),
        NOW
      )
    ).toBe(false);
  });

  it("rejects a job D2a already handed to D0/C2", () => {
    expect(
      isInboundMediaJobD2aDueListCandidate(
        dueJob({
          status: "awaiting_attach",
          last_error_code: "semantic_target",
          semantic_target_win_id: WIN_A,
        }),
        NOW
      )
    ).toBe(false);
  });

  it("rejects future next_retry_at", () => {
    expect(
      isInboundMediaJobD2aDueListCandidate(
        dueJob({
          next_retry_at: new Date(NOW.getTime() + 60_000).toISOString(),
        }),
        NOW
      )
    ).toBe(false);
  });
});

describe("listInboundMediaJobsForD2a", () => {
  it("SQL-filters D2a codes, requires next_retry_at, limits 1", async () => {
    const historical = dueJob({
      id: JOB_B,
      last_error_code: null,
      next_retry_at: null,
    });
    const armed = dueJob();
    const captured = mockD2aList([historical, armed]);
    const ids = await listInboundMediaJobsForD2a(1, { now: NOW });
    expect(captured.inCol).toBe("last_error_code");
    expect(captured.inVals).toEqual([...INBOUND_MEDIA_D2A_OWNED_LAST_ERROR_CODES]);
    expect(captured.limit).toBe(1);
    expect(captured.eq).toContainEqual(["status", "pending_semantics"]);
    expect(ids).toEqual([JOB_ID]);
    expect(ids).not.toContain(JOB_B);
  });

  it("does not return historical NULL/NULL even if present in the table mock", async () => {
    mockD2aList([
      dueJob({ last_error_code: null, next_retry_at: null }),
    ]);
    const ids = await listInboundMediaJobsForD2a(1, { now: NOW });
    expect(ids).toEqual([]);
  });
});

describe("processInboundMmsD2aJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("obvious text→photo claims the supplied Win via D0", async () => {
    const claim = vi.fn(async () => ({
      ok: true as const,
      jobId: JOB_ID,
      targetWinId: WIN_A,
    }));
    const runSemantics = vi.fn(async () => ({
      ok: true as const,
      decision: "attach_existing_win" as const,
      target_win_id: WIN_A,
    }));
    const r = await processInboundMmsD2aJob(
      JOB_ID,
      processDeps({ claim, runSemantics })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "claimed" });
    expect(claim).toHaveBeenCalledWith({
      jobId: JOB_ID,
      clerkUserId: USER,
      targetWinId: WIN_A,
      now: NOW,
      expectedResolution: null,
    });
  });

  it("Coach-asked photo can attach the supplied Win", async () => {
    const claim = vi.fn(async () => ({
      ok: true as const,
      jobId: JOB_ID,
      targetWinId: WIN_A,
    }));
    const r = await processInboundMmsD2aJob(
      JOB_ID,
      processDeps({
        loadFacts: async () =>
          facts({
            recent_thread: [
              {
                at: "2026-08-22T11:55:00.000Z",
                role: "coach",
                body: "Send me a picture of that.",
              },
            ],
          }),
        runSemantics: async () => ({
          ok: true as const,
          decision: "attach_existing_win",
          target_win_id: WIN_A,
        }),
        claim,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "claimed" });
    expect(claim).toHaveBeenCalledOnce();
  });

  it("no context → no attach + semantic_grace, no model attach, no SMS", async () => {
    const casPark = vi.fn(async () => true);
    const runSemantics = vi.fn(async () => ({
      ok: true as const,
      decision: "no_attach" as const,
      target_win_id: null,
    }));
    const claim = vi.fn();
    const r = await processInboundMmsD2aJob(
      JOB_ID,
      processDeps({
        loadFacts: async () =>
          facts({ recent_thread: [], candidate_wins: facts().candidate_wins }),
        runSemantics,
        casPark,
        claim,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "grace" });
    expect(claim).not.toHaveBeenCalled();
    const patch = casPark.mock.calls[0]![0].patch;
    expect(patch.last_error_code).toBe(INBOUND_MEDIA_D2A_SEMANTIC_GRACE);
    expect(patch.next_retry_at).toBe(
      inboundMmsD2aGraceRetryIso({
        createdAt: dueJob().created_at,
        now: NOW,
      })
    );
  });

  it("unrelated context → grace", async () => {
    const casPark = vi.fn(async () => true);
    const r = await processInboundMmsD2aJob(
      JOB_ID,
      processDeps({
        loadFacts: async () =>
          facts({
            recent_thread: [
              { at: NOW.toISOString(), role: "user", body: "What's for dinner?" },
            ],
          }),
        runSemantics: async () => ({
          ok: true as const,
          decision: "no_attach",
          target_win_id: null,
        }),
        casPark,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "grace" });
    expect(casPark.mock.calls[0]![0].patch.last_error_code).toBe(
      INBOUND_MEDIA_D2A_SEMANTIC_GRACE
    );
  });

  it("unknown model UUID is rejected and does not claim", async () => {
    const claim = vi.fn();
    const casPark = vi.fn(async () => true);
    const r = await processInboundMmsD2aJob(
      JOB_ID,
      processDeps({
        runSemantics: async () => ({
          ok: true as const,
          decision: "attach_existing_win",
          target_win_id: WIN_UNKNOWN,
        }),
        claim,
        casPark,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "grace" });
    expect(claim).not.toHaveBeenCalled();
  });

  it("0 unoccupied candidates skips the model and arms grace", async () => {
    const runSemantics = vi.fn();
    const r = await processInboundMmsD2aJob(
      JOB_ID,
      processDeps({
        loadFacts: async () => facts({ candidate_wins: [] }),
        runSemantics,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "grace" });
    expect(runSemantics).not.toHaveBeenCalled();
  });

  it("2+ current photos do not silently attach", async () => {
    const runSemantics = vi.fn();
    const claim = vi.fn();
    const r = await processInboundMmsD2aJob(
      JOB_ID,
      processDeps({
        listSiblingPhotos: async () => [
          {
            id: JOB_B,
            message_sid: PHOTO_SID_B,
            created_at: NOW.toISOString(),
            status: "pending_semantics",
            resolution: null,
            tombstoned_at: null,
            attached_win_id: null,
            semantic_target_win_id: null,
            temp_storage_path: null,
            normalized_storage_path: "mms-norm/x/y/master.jpg",
            expires_at: "2026-08-25T12:00:00.000Z",
          },
        ],
        runSemantics,
        claim,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "grace" });
    expect(runSemantics).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it("expiry terminalizes an armed job without OpenAI", async () => {
    const runSemantics = vi.fn();
    const casPark = vi.fn(async () => true);
    const removeObjects = vi.fn(async () => {});
    const r = await processInboundMmsD2aJob(
      JOB_ID,
      processDeps({
        loadJob: async () =>
          dueJob({ expires_at: "2026-08-22T11:00:00.000Z" }),
        runSemantics,
        casPark,
        removeObjects,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "expired" });
    expect(runSemantics).not.toHaveBeenCalled();
    expect(casPark.mock.calls[0]![0].patch).toMatchObject({
      status: "expired",
      resolution: "expired",
      next_retry_at: null,
    });
    expect(removeObjects).toHaveBeenCalled();
  });

  it("unresolved deletion fail-closes without OpenAI", async () => {
    const runSemantics = vi.fn();
    const r = await processInboundMmsD2aJob(
      JOB_ID,
      processDeps({
        hasUnresolvedDeletion: async () => true,
        runSemantics,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "expired" });
    expect(runSemantics).not.toHaveBeenCalled();
  });

  it("deletion lookup failure retries without OpenAI", async () => {
    const runSemantics = vi.fn();
    const casPark = vi.fn(async () => true);
    const r = await processInboundMmsD2aJob(
      JOB_ID,
      processDeps({
        hasUnresolvedDeletion: async () => {
          throw new Error("db");
        },
        runSemantics,
        casPark,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "parked" });
    expect(runSemantics).not.toHaveBeenCalled();
    expect(casPark.mock.calls[0]![0].patch.next_retry_at).toBe(
      new Date(NOW.getTime() + INBOUND_MEDIA_D2A_MODEL_RETRY_MS).toISOString()
    );
  });

  it("model failure arms semantic_model_failed once, then parks grace", async () => {
    const casPark = vi.fn(async () => true);
    const first = await processInboundMmsD2aJob(
      JOB_ID,
      processDeps({
        runSemantics: async () => ({ ok: false, reason: "openai_request_failed" }),
        casPark,
      })
    );
    expect(first).toEqual({ ok: true, jobId: JOB_ID, action: "parked" });
    expect(casPark.mock.calls[0]![0].patch.last_error_code).toBe(
      INBOUND_MEDIA_D2A_SEMANTIC_MODEL_FAILED
    );

    const casPark2 = vi.fn(async () => true);
    const second = await processInboundMmsD2aJob(
      JOB_ID,
      processDeps({
        loadJob: async () =>
          dueJob({ last_error_code: INBOUND_MEDIA_D2A_SEMANTIC_MODEL_FAILED }),
        runSemantics: async () => ({ ok: false, reason: "openai_request_failed" }),
        casPark: casPark2,
      })
    );
    expect(second).toEqual({ ok: true, jobId: JOB_ID, action: "parked" });
    expect(casPark2.mock.calls[0]![0].patch.last_error_code).toBe(
      INBOUND_MEDIA_D2A_SEMANTIC_GRACE
    );
    expect(casPark2.mock.calls[0]![0].patch.next_retry_at).toBe(
      inboundMmsD2aGraceRetryIso({
        createdAt: dueJob().created_at,
        now: NOW,
      })
    );
  });

  it("due semantic_grace is a D2a noop so D2b owns the wake", async () => {
    const runSemantics = vi.fn();
    const casPark = vi.fn(async () => true);
    const r = await processInboundMmsD2aJob(
      JOB_ID,
      processDeps({
        loadJob: async () =>
          dueJob({ last_error_code: INBOUND_MEDIA_D2A_SEMANTIC_GRACE }),
        runSemantics,
        casPark,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "noop" });
    expect(runSemantics).not.toHaveBeenCalled();
    expect(casPark).not.toHaveBeenCalled();
  });

  it("D0 stale_ownership (D1 won) is a noop", async () => {
    const casPark = vi.fn(async () => true);
    const r = await processInboundMmsD2aJob(
      JOB_ID,
      processDeps({
        runSemantics: async () => ({
          ok: true as const,
          decision: "attach_existing_win",
          target_win_id: WIN_A,
        }),
        claim: async () => ({ ok: false as const, reason: "stale_ownership" }),
        casPark,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "noop" });
    expect(casPark).not.toHaveBeenCalled();
  });

  it("D0 media_exists does not overwrite; arms grace", async () => {
    const casPark = vi.fn(async () => true);
    const r = await processInboundMmsD2aJob(
      JOB_ID,
      processDeps({
        runSemantics: async () => ({
          ok: true as const,
          decision: "attach_existing_win",
          target_win_id: WIN_A,
        }),
        claim: async () => ({ ok: false as const, reason: "media_exists" }),
        casPark,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "grace" });
    expect(casPark.mock.calls[0]![0].patch.last_error_code).toBe(
      INBOUND_MEDIA_D2A_SEMANTIC_GRACE
    );
  });

  it("historical unarmed job is a noop with no model", async () => {
    const runSemantics = vi.fn();
    const casPark = vi.fn();
    const r = await processInboundMmsD2aJob(
      JOB_ID,
      processDeps({
        loadJob: async () =>
          dueJob({ last_error_code: null, next_retry_at: null }),
        runSemantics,
        casPark,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "noop" });
    expect(runSemantics).not.toHaveBeenCalled();
    expect(casPark).not.toHaveBeenCalled();
  });
});
