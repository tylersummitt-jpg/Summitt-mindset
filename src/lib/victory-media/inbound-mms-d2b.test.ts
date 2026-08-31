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
  isAccountDeletionOutboundSmsError: () => false,
  isIntentionalDeletionSmsBlock: () => false,
  isDeletionLookupFailure: () => false,
}));

vi.mock("@/lib/twilio", () => ({
  sendSMSChunked: vi.fn(),
  SMS_CHUNK_MAX_LENGTH: 280,
}));

import { supabaseServer } from "@/lib/supabase-server";
import type { InboundMediaJobRow } from "@/lib/victory-media/claim-inbound-media-job";
import {
  INBOUND_MEDIA_D2A_SEMANTIC_GRACE,
  inboundMmsD2aParkRetryIso,
} from "@/lib/victory-media/inbound-mms-d2a-codes";
import type { InboundMmsD2aSemanticFacts } from "@/lib/victory-media/inbound-mms-d2a-semantics";
import {
  INBOUND_MEDIA_D2B_ACTIVE_CLARIFICATION_WAIT_MS,
  INBOUND_MEDIA_D2B_CLARIFICATION_DUE,
  INBOUND_MEDIA_D2B_CLARIFICATION_MODEL_FAILED,
  INBOUND_MEDIA_D2B_CLARIFICATION_SEND_FAILED,
  INBOUND_MEDIA_D2B_MODEL_RETRY_MS,
  INBOUND_MEDIA_D2B_OWNED_LAST_ERROR_CODES,
  INBOUND_MEDIA_D2B_SEND_RETRY_MS,
  inboundMmsD2bClarificationIdempotencyKey,
} from "@/lib/victory-media/inbound-mms-d2b-codes";
import {
  INBOUND_MEDIA_D2_QUEUE_LAST_ERROR_CODES,
  isInboundMediaJobD2bActiveClarification,
  isInboundMediaJobD2bDueListCandidate,
  listInboundMediaJobsForD2,
  listInboundMmsD2bActiveClarifications,
  processInboundMmsD2bJob,
  processInboundMmsD2Job,
} from "@/lib/victory-media/inbound-mms-d2b";
import { victoryMediaMmsNormMasterPath } from "@/lib/victory-media/storage-paths";

const NOW = new Date("2026-08-22T12:10:00.000Z");
const JOB_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const JOB_B = "bbbbbbbb-2222-4222-8222-222222222222";
const JOB_C = "dddddddd-4444-4444-8444-444444444444";
const WIN_A = "cccccccc-3333-4333-8333-333333333333";
const USER = "user_d2b";
const PHOTO_SID = "SMdddddddddddddddddddddddddddddddd";
const NORM = victoryMediaMmsNormMasterPath(USER, JOB_ID);
const QUESTION = "What made this one a win for you?";
const KEY = inboundMmsD2bClarificationIdempotencyKey(JOB_ID);
const KEY_B = inboundMmsD2bClarificationIdempotencyKey(JOB_B);
const INCIDENT_NOW = new Date("2026-08-31T11:31:00.000Z");
const STALE_EXPIRES_AT = "2026-08-25T10:00:00.000Z";
const LIVE_EXPIRES_AT = "2026-09-03T10:53:23.000Z";

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
    last_error_code: INBOUND_MEDIA_D2A_SEMANTIC_GRACE,
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
    created_at: "2026-08-22T12:00:00.000Z",
    updated_at: "2026-08-22T12:00:30.000Z",
    ...partial,
  };
}

function facts(
  partial: Partial<InboundMmsD2aSemanticFacts> = {}
): InboundMmsD2aSemanticFacts {
  return {
    pending_photo: {
      job_id: JOB_ID,
      age_seconds: 600,
      message_sid: PHOTO_SID,
    },
    recent_thread: [],
    candidate_wins: [
      {
        id: WIN_A,
        text: "Breck hit his first home run",
        occurred_at: "2026-08-22T11:56:00.000Z",
        relationship_type: "whole_life",
        commitment_id: null,
      },
    ],
    current_goal: null,
    identity: null,
    open_coach_question: null,
    ...partial,
  };
}

function mockD2List(rows: Array<Record<string, unknown>>) {
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
  overrides: Parameters<typeof processInboundMmsD2bJob>[1] = {}
): NonNullable<Parameters<typeof processInboundMmsD2bJob>[1]> {
  return {
    now: NOW,
    hasUnresolvedDeletion: async () => false,
    loadJob: async () => dueJob(),
    listSiblingPhotos: async () => [],
    listActiveClarifications: async () => [],
    loadFacts: async () => facts(),
    runSemantics: async () => ({
      ok: true as const,
      decision: "ask_clarification" as const,
      target_win_id: null,
      clarification_body: QUESTION,
    }),
    claim: async () => ({ ok: false as const, reason: "not_used" }),
    casPark: async () => true,
    checkSmsEligibility: async () => ({
      ok: true as const,
      reason: "eligible" as const,
      phone: "+15555550100",
    }),
    sendSms: async () => ({ firstSid: "SM_out" }),
    removeObjects: async () => {},
    ...overrides,
  };
}

describe("D2b due candidate and list", () => {
  it("owns semantic_grace plus clarification_due/send_failed/model_failed", () => {
    expect([...INBOUND_MEDIA_D2B_OWNED_LAST_ERROR_CODES]).toEqual([
      "semantic_grace",
      "clarification_due",
      "clarification_send_failed",
      "clarification_model_failed",
    ]);
    expect(INBOUND_MEDIA_D2_QUEUE_LAST_ERROR_CODES).toContain(
      INBOUND_MEDIA_D2A_SEMANTIC_GRACE
    );
  });

  it("accepts a due semantic_grace job at 10m+", () => {
    expect(isInboundMediaJobD2bDueListCandidate(dueJob(), NOW)).toBe(true);
  });

  it("9m59s future next_retry_at is not D2b-due (no send)", () => {
    expect(
      isInboundMediaJobD2bDueListCandidate(
        dueJob({
          next_retry_at: new Date(NOW.getTime() + 1000).toISOString(),
        }),
        NOW
      )
    ).toBe(false);
  });

  it("rejects historical NULL/NULL pending_semantics", () => {
    expect(
      isInboundMediaJobD2bDueListCandidate(
        dueJob({ next_retry_at: null, last_error_code: null }),
        NOW
      )
    ).toBe(false);
  });

  it("SQL-filters D2 codes, requires next_retry_at, skips historical", async () => {
    const historical = dueJob({
      id: JOB_B,
      last_error_code: null,
      next_retry_at: null,
    });
    const armed = dueJob();
    const captured = mockD2List([historical, armed]);
    const ids = await listInboundMediaJobsForD2(1, { now: NOW });
    expect(captured.inCol).toBe("last_error_code");
    expect(captured.inVals).toEqual([...INBOUND_MEDIA_D2_QUEUE_LAST_ERROR_CODES]);
    expect(captured.limit).toBe(1);
    expect(ids).toEqual([JOB_ID]);
    expect(ids).not.toContain(JOB_B);
  });
});

function activeShape(
  partial: Partial<Parameters<typeof isInboundMediaJobD2bActiveClarification>[0]> = {}
): Parameters<typeof isInboundMediaJobD2bActiveClarification>[0] {
  return {
    status: "pending_semantics",
    resolution: "pending_user",
    followup_idempotency_key: KEY_B,
    tombstoned_at: null,
    expires_at: LIVE_EXPIRES_AT,
    ...partial,
  };
}

function mockActiveClarificationList(rows: Array<Record<string, unknown>>) {
  const captured: {
    select?: string;
    gt?: [string, unknown];
    not?: Array<[string, string]>;
  } = { not: [] };
  const api = {
    select: (cols: string) => {
      captured.select = cols;
      return api;
    },
    eq: () => api,
    neq: () => api,
    is: () => api,
    not: (col: string, op: string) => {
      captured.not!.push([col, op]);
      return api;
    },
    gt: (col: string, val: unknown) => {
      captured.gt = [col, val];
      return api;
    },
    or: () => api,
    limit: () => api,
    then(resolve: (v: { data: unknown; error: unknown }) => void) {
      resolve({ data: rows, error: null });
    },
  };
  vi.mocked(supabaseServer.from).mockReturnValue(
    api as unknown as ReturnType<typeof supabaseServer.from>
  );
  return captured;
}

describe("isInboundMediaJobD2bActiveClarification", () => {
  it("accepts in-window pending_user", () => {
    expect(isInboundMediaJobD2bActiveClarification(activeShape(), INCIDENT_NOW)).toBe(
      true
    );
  });

  it("rejects past-expiry pending_user", () => {
    expect(
      isInboundMediaJobD2bActiveClarification(
        activeShape({ expires_at: STALE_EXPIRES_AT }),
        INCIDENT_NOW
      )
    ).toBe(false);
  });

  it("accepts in-window reserved-unsent (resolution null + key)", () => {
    expect(
      isInboundMediaJobD2bActiveClarification(
        activeShape({
          resolution: null,
          followup_idempotency_key: KEY_B,
          expires_at: LIVE_EXPIRES_AT,
        }),
        INCIDENT_NOW
      )
    ).toBe(true);
  });

  it("rejects past-expiry reserved-unsent", () => {
    expect(
      isInboundMediaJobD2bActiveClarification(
        activeShape({
          resolution: null,
          followup_idempotency_key: KEY_B,
          expires_at: STALE_EXPIRES_AT,
        }),
        INCIDENT_NOW
      )
    ).toBe(false);
  });

  it("missing or invalid expires_at is not an immortal blocker", () => {
    expect(
      isInboundMediaJobD2bActiveClarification(
        activeShape({ expires_at: null }),
        INCIDENT_NOW
      )
    ).toBe(false);
    expect(
      isInboundMediaJobD2bActiveClarification(
        activeShape({ expires_at: "  " }),
        INCIDENT_NOW
      )
    ).toBe(false);
    expect(
      isInboundMediaJobD2bActiveClarification(
        activeShape({ expires_at: "not-a-timestamp" }),
        INCIDENT_NOW
      )
    ).toBe(false);
  });

  it("ignores tombstoned, attached, and expired-status rows", () => {
    expect(
      isInboundMediaJobD2bActiveClarification(
        activeShape({ tombstoned_at: INCIDENT_NOW.toISOString() }),
        INCIDENT_NOW
      )
    ).toBe(false);
    expect(
      isInboundMediaJobD2bActiveClarification(
        activeShape({ status: "attached" }),
        INCIDENT_NOW
      )
    ).toBe(false);
    expect(
      isInboundMediaJobD2bActiveClarification(
        activeShape({ status: "expired", resolution: "expired" }),
        INCIDENT_NOW
      )
    ).toBe(false);
  });
});

describe("listInboundMmsD2bActiveClarifications", () => {
  it("SQL requires future expires_at and JS drops stale/missing even if SQL returns them", async () => {
    const live = {
      id: JOB_B,
      status: "pending_semantics",
      resolution: "pending_user",
      followup_idempotency_key: KEY_B,
      tombstoned_at: null,
      expires_at: LIVE_EXPIRES_AT,
    };
    const staleAug22 = {
      id: JOB_C,
      status: "pending_semantics",
      resolution: "pending_user",
      followup_idempotency_key: inboundMmsD2bClarificationIdempotencyKey(JOB_C),
      tombstoned_at: null,
      expires_at: STALE_EXPIRES_AT,
    };
    const missingExpiry = {
      ...live,
      id: "eeeeeeee-5555-4555-8555-555555555555",
      expires_at: null,
    };
    const captured = mockActiveClarificationList([
      live,
      staleAug22,
      missingExpiry,
    ]);
    const ids = await listInboundMmsD2bActiveClarifications({
      clerkUserId: USER,
      excludeJobId: JOB_ID,
      now: INCIDENT_NOW,
    });
    expect(captured.select).toContain("expires_at");
    expect(captured.gt).toEqual(["expires_at", INCIDENT_NOW.toISOString()]);
    expect(captured.not).toContainEqual(["expires_at", "is"]);
    expect(ids).toEqual([
      {
        id: JOB_B,
        status: "pending_semantics",
        resolution: "pending_user",
        followup_idempotency_key: KEY_B,
      },
    ]);
  });
});

describe("processInboundMmsD2bJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("future grace deadline is a noop with no SMS", async () => {
    const sendSms = vi.fn();
    const runSemantics = vi.fn();
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        loadJob: async () =>
          dueJob({
            next_retry_at: new Date(NOW.getTime() + 1000).toISOString(),
          }),
        sendSms,
        runSemantics,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "noop" });
    expect(sendSms).not.toHaveBeenCalled();
    expect(runSemantics).not.toHaveBeenCalled();
  });

  it("no-context at 10m reserves and sends one natural clarification", async () => {
    let row = dueJob();
    const sendSms = vi.fn(async (args: { body: string }) => {
      expect(args.body).toBe(QUESTION);
      return { firstSid: "SM_out" };
    });
    const casPark = vi.fn(async ({ patch }: { patch: Record<string, unknown> }) => {
      row = { ...row, ...patch } as InboundMediaJobRow;
      return true;
    });
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        loadJob: async () => row,
        casPark,
        sendSms,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "sent" });
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(row.resolution).toBe("pending_user");
    expect(row.followup_idempotency_key).toBe(KEY);
    expect(row.clarification_body).toBe(QUESTION);
    expect(row.next_retry_at).toBeNull();
    expect(row.semantic_target_win_id).toBeNull();
    expect(row.next_retry_at).not.toBe(row.expires_at);
    expect(casPark.mock.calls[0]![0].patch.resolution).toBeUndefined();
    expect(casPark.mock.calls[0]![0].patch.followup_idempotency_key).toBe(KEY);
  });

  it("sparse/no-context does not park semantic_grace to expires_at", async () => {
    let row = dueJob();
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        loadJob: async () => row,
        loadFacts: async () => facts({ recent_thread: [], candidate_wins: [] }),
        casPark: async ({ patch }) => {
          row = { ...row, ...patch } as InboundMediaJobRow;
          return true;
        },
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "sent" });
    expect(row.resolution).toBe("pending_user");
    expect(row.clarification_body).toBe(QUESTION);
    expect(row.next_retry_at).toBeNull();
    expect(row.next_retry_at).not.toBe(
      inboundMmsD2aParkRetryIso({ expiresAt: dueJob().expires_at, now: NOW })
    );
  });

  it("legacy/invalid no_action is model failure, not expiry park", async () => {
    let row = dueJob();
    const sendSms = vi.fn();
    const casPark = vi.fn(async ({ patch }: { patch: Record<string, unknown> }) => {
      row = { ...row, ...patch } as InboundMediaJobRow;
      return true;
    });
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        loadJob: async () => row,
        runSemantics: async () => ({ ok: false, reason: "invalid_decision" }),
        sendSms,
        casPark,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "parked" });
    expect(sendSms).not.toHaveBeenCalled();
    expect(row.resolution).toBeNull();
    expect(row.followup_idempotency_key).toBeNull();
    expect(row.clarification_body).toBeNull();
    expect(row.last_error_code).toBe(INBOUND_MEDIA_D2B_CLARIFICATION_MODEL_FAILED);
    expect(row.next_retry_at).toBe(
      new Date(NOW.getTime() + INBOUND_MEDIA_D2B_MODEL_RETRY_MS).toISOString()
    );
    expect(row.next_retry_at).not.toBe(row.expires_at);
  });

  it("cron replay after pending_user does not send again", async () => {
    const sendSms = vi.fn();
    const runSemantics = vi.fn();
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        loadJob: async () =>
          dueJob({
            resolution: "pending_user",
            followup_idempotency_key: KEY,
            clarification_body: QUESTION,
            next_retry_at: null,
            last_error_code: INBOUND_MEDIA_D2B_CLARIFICATION_DUE,
          }),
        sendSms,
        runSemantics,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "noop" });
    expect(sendSms).not.toHaveBeenCalled();
    expect(runSemantics).not.toHaveBeenCalled();
  });

  it("post-grace obvious Win attaches via D0 and does not SMS", async () => {
    const sendSms = vi.fn();
    const claim = vi.fn(async () => ({
      ok: true as const,
      jobId: JOB_ID,
      targetWinId: WIN_A,
    }));
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        loadFacts: async () =>
          facts({
            recent_thread: [
              {
                at: "2026-08-22T12:07:00.000Z",
                role: "user",
                body: "That's Breck's home run",
              },
            ],
          }),
        runSemantics: async () => ({
          ok: true as const,
          decision: "attach_existing_win",
          target_win_id: WIN_A,
          clarification_body: null,
        }),
        claim,
        sendSms,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "claimed" });
    expect(claim).toHaveBeenCalledWith({
      jobId: JOB_ID,
      clerkUserId: USER,
      targetWinId: WIN_A,
      now: NOW,
      expectedResolution: null,
    });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("send failure keeps reservation, same body, resolution null, no remodel", async () => {
    let row = dueJob();
    const runSemantics = vi.fn(async () => ({
      ok: true as const,
      decision: "ask_clarification" as const,
      target_win_id: null,
      clarification_body: QUESTION,
    }));
    const sendSms = vi.fn(async () => {
      throw new Error("twilio");
    });
    const casPark = vi.fn(async ({ patch }: { patch: Record<string, unknown> }) => {
      row = { ...row, ...patch } as InboundMediaJobRow;
      return true;
    });
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        loadJob: async () => row,
        casPark,
        sendSms,
        runSemantics,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "parked" });
    expect(row.resolution).toBeNull();
    expect(row.followup_idempotency_key).toBe(KEY);
    expect(row.clarification_body).toBe(QUESTION);
    expect(row.last_error_code).toBe(INBOUND_MEDIA_D2B_CLARIFICATION_SEND_FAILED);
    expect(row.next_retry_at).toBe(
      new Date(NOW.getTime() + INBOUND_MEDIA_D2B_SEND_RETRY_MS).toISOString()
    );
    expect(runSemantics).toHaveBeenCalledTimes(1);
  });

  it("send retry reuses the exact body and then marks pending_user", async () => {
    const otherQuestion = "Was this the hike or the game?";
    let row = dueJob({
      last_error_code: INBOUND_MEDIA_D2B_CLARIFICATION_SEND_FAILED,
      followup_idempotency_key: KEY,
      clarification_body: QUESTION,
    });
    const runSemantics = vi.fn(async () => ({
      ok: true as const,
      decision: "ask_clarification" as const,
      target_win_id: null,
      clarification_body: otherQuestion,
    }));
    const sendSms = vi.fn(async (args: { body: string }) => {
      expect(args.body).toBe(QUESTION);
      expect(args.body).not.toBe(otherQuestion);
      return { firstSid: "SM_retry" };
    });
    const casPark = vi.fn(async ({ patch }: { patch: Record<string, unknown> }) => {
      row = { ...row, ...patch } as InboundMediaJobRow;
      return true;
    });
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        loadJob: async () => row,
        casPark,
        sendSms,
        runSemantics,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "sent" });
    expect(runSemantics).not.toHaveBeenCalled();
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(row.resolution).toBe("pending_user");
    expect(row.clarification_body).toBe(QUESTION);
  });

  it("STOP during grace parks without SMS and does not remodel", async () => {
    const sendSms = vi.fn();
    const runSemantics = vi.fn();
    const casPark = vi.fn(async () => true);
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        checkSmsEligibility: async () => ({
          ok: false as const,
          reason: "sms_stopped",
        }),
        sendSms,
        runSemantics,
        casPark,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "parked" });
    expect(sendSms).not.toHaveBeenCalled();
    expect(runSemantics).not.toHaveBeenCalled();
    expect(casPark.mock.calls[0]![0].patch.resolution).not.toBe("pending_user");
  });

  it("unresolved deletion fail-closes without SMS", async () => {
    const sendSms = vi.fn();
    const runSemantics = vi.fn();
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        hasUnresolvedDeletion: async () => true,
        sendSms,
        runSemantics,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "expired" });
    expect(sendSms).not.toHaveBeenCalled();
    expect(runSemantics).not.toHaveBeenCalled();
  });

  it("D1 claim during grace makes D2b a noop", async () => {
    const sendSms = vi.fn();
    const runSemantics = vi.fn();
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        loadJob: async () =>
          dueJob({
            status: "awaiting_attach",
            semantic_target_win_id: WIN_A,
            last_error_code: "semantic_target",
          }),
        sendSms,
        runSemantics,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "noop" });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("D1 claim after reservation but before send cancels the SMS", async () => {
    const reserved = dueJob({
      last_error_code: INBOUND_MEDIA_D2B_CLARIFICATION_DUE,
      followup_idempotency_key: KEY,
      clarification_body: QUESTION,
    });
    let loads = 0;
    const sendSms = vi.fn();
    const runSemantics = vi.fn();
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        loadJob: async () => {
          loads += 1;
          if (loads === 1) return reserved;
          return {
            ...reserved,
            status: "awaiting_attach",
            semantic_target_win_id: WIN_A,
            last_error_code: "semantic_target",
            updated_at: "2026-08-22T12:10:05.000Z",
          };
        },
        sendSms,
        runSemantics,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "noop" });
    expect(sendSms).not.toHaveBeenCalled();
    expect(runSemantics).not.toHaveBeenCalled();
  });

  it("in-window pending_user A blocks B (5-min wait, no send, no remodel)", async () => {
    const sendSms = vi.fn();
    const runSemantics = vi.fn();
    const casPark = vi.fn(async () => true);
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        listActiveClarifications: async () => [
          {
            id: JOB_B,
            status: "pending_semantics",
            resolution: "pending_user",
            followup_idempotency_key: KEY_B,
          },
        ],
        sendSms,
        runSemantics,
        casPark,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "parked" });
    expect(sendSms).not.toHaveBeenCalled();
    expect(runSemantics).not.toHaveBeenCalled();
    expect(casPark).toHaveBeenCalledTimes(1);
    expect(casPark.mock.calls[0]![0].job.id).toBe(JOB_ID);
    expect(casPark.mock.calls[0]![0].patch).toEqual({
      last_error_code: INBOUND_MEDIA_D2A_SEMANTIC_GRACE,
      next_retry_at: new Date(
        NOW.getTime() + INBOUND_MEDIA_D2B_ACTIVE_CLARIFICATION_WAIT_MS
      ).toISOString(),
      updated_at: NOW.toISOString(),
    });
  });

  it("in-window reserved-unsent A blocks B", async () => {
    const sendSms = vi.fn();
    const runSemantics = vi.fn();
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        listActiveClarifications: async () => [
          {
            id: JOB_B,
            status: "pending_semantics",
            resolution: null,
            followup_idempotency_key: KEY_B,
          },
        ],
        sendSms,
        runSemantics,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "parked" });
    expect(sendSms).not.toHaveBeenCalled();
    expect(runSemantics).not.toHaveBeenCalled();
  });

  it("past-expiry pending_user A does not block B; B sends once after Twilio", async () => {
    let row = dueJob({
      created_at: "2026-08-31T10:53:23.000Z",
      next_retry_at: INCIDENT_NOW.toISOString(),
      expires_at: LIVE_EXPIRES_AT,
      updated_at: "2026-08-31T10:54:00.000Z",
    });
    const sendSms = vi.fn(async () => ({ firstSid: "SM_out" }));
    const removeObjects = vi.fn(async () => {});
    const casPark = vi.fn(async ({ patch }: { patch: Record<string, unknown> }) => {
      row = { ...row, ...patch } as InboundMediaJobRow;
      return true;
    });
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        now: INCIDENT_NOW,
        loadJob: async () => row,
        casPark,
        sendSms,
        removeObjects,
        listActiveClarifications: async () => [],
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "sent" });
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(row.resolution).toBe("pending_user");
    expect(row.followup_idempotency_key).toBe(KEY);
    expect(row.clarification_body).toBe(QUESTION);
    expect(casPark.mock.calls.map((c) => c[0].job.id)).toEqual([JOB_ID, JOB_ID]);
    expect(casPark.mock.calls[0]![0].patch.resolution).toBeUndefined();
    expect(casPark.mock.calls[1]![0].patch.resolution).toBe("pending_user");
    expect(removeObjects).not.toHaveBeenCalled();
  });

  it("past-expiry reserved-unsent A does not block B", async () => {
    let row = dueJob();
    const sendSms = vi.fn(async () => ({ firstSid: "SM_out" }));
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        loadJob: async () => row,
        casPark: async ({ patch }) => {
          row = { ...row, ...patch } as InboundMediaJobRow;
          return true;
        },
        sendSms,
        listActiveClarifications: async () => [],
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "sent" });
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("Aug 22 stale pending_user omitted; Aug 31 church photo can proceed", async () => {
    expect(
      isInboundMediaJobD2bActiveClarification(
        {
          status: "pending_semantics",
          resolution: "pending_user",
          followup_idempotency_key: KEY_B,
          tombstoned_at: null,
          expires_at: STALE_EXPIRES_AT,
        },
        INCIDENT_NOW
      )
    ).toBe(false);
    let church = dueJob({
      created_at: "2026-08-31T10:53:23.000Z",
      next_retry_at: INCIDENT_NOW.toISOString(),
      expires_at: LIVE_EXPIRES_AT,
      last_error_code: INBOUND_MEDIA_D2A_SEMANTIC_GRACE,
    });
    const sendSms = vi.fn(async () => ({ firstSid: "SM_church" }));
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        now: INCIDENT_NOW,
        loadJob: async () => church,
        casPark: async ({ patch }) => {
          church = { ...church, ...patch } as InboundMediaJobRow;
          return true;
        },
        sendSms,
        listActiveClarifications: async () => [],
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "sent" });
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(church.resolution).toBe("pending_user");
  });

  it("C waits after B successfully becomes pending_user", async () => {
    const sendC = vi.fn();
    const r = await processInboundMmsD2bJob(
      JOB_C,
      processDeps({
        loadJob: async () =>
          dueJob({
            id: JOB_C,
            followup_idempotency_key: null,
            clarification_body: null,
          }),
        listActiveClarifications: async () => [
          {
            id: JOB_ID,
            status: "pending_semantics",
            resolution: "pending_user",
            followup_idempotency_key: KEY,
          },
        ],
        sendSms: sendC,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_C, action: "parked" });
    expect(sendC).not.toHaveBeenCalled();
  });

  it("historical NULL/NULL sibling does not block a valid D2b send", async () => {
    let row = dueJob();
    const sendSms = vi.fn(async () => ({ firstSid: "SM_out" }));
    const casPark = vi.fn(async ({ patch }: { patch: Record<string, unknown> }) => {
      row = { ...row, ...patch } as InboundMediaJobRow;
      return true;
    });
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        loadJob: async () => row,
        casPark,
        listSiblingPhotos: async () => [],
        listActiveClarifications: async () => [],
        sendSms,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "sent" });
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("two D2-armed photos skip silent attach", async () => {
    const sendSms = vi.fn();
    const claim = vi.fn();
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        listSiblingPhotos: async () => [{ id: JOB_B }],
        runSemantics: async () => ({
          ok: true as const,
          decision: "attach_existing_win",
          target_win_id: WIN_A,
          clarification_body: null,
        }),
        claim,
        sendSms,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "parked" });
    expect(claim).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("expired reserved send does not SMS", async () => {
    const sendSms = vi.fn();
    const r = await processInboundMmsD2bJob(
      JOB_ID,
      processDeps({
        loadJob: async () =>
          dueJob({
            expires_at: "2026-08-22T12:00:00.000Z",
            followup_idempotency_key: KEY,
            clarification_body: QUESTION,
          }),
        sendSms,
      })
    );
    expect(r).toEqual({ ok: true, jobId: JOB_ID, action: "expired" });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("dispatcher routes grace/clarification_* to D2b and semantic_due/model_failed to D2a", async () => {
    const d2b = await processInboundMmsD2Job(
      JOB_ID,
      processDeps({
        loadJob: async () => dueJob(),
      })
    );
    expect(d2b.phase).toBe("d2b");
    expect(d2b.ok).toBe(true);

    const d2a = await processInboundMmsD2Job(JOB_ID, {
      ...processDeps({
        loadJob: async () => dueJob({ last_error_code: "semantic_due" }),
        runSemantics: async () => ({
          ok: true as const,
          decision: "no_attach" as const,
          target_win_id: null,
        }),
      }),
    });
    expect(d2a.phase).toBe("d2a");

    const failed = await processInboundMmsD2Job(JOB_ID, {
      ...processDeps({
        loadJob: async () =>
          dueJob({ last_error_code: "semantic_model_failed" }),
        runSemantics: async () => ({
          ok: true as const,
          decision: "no_attach" as const,
          target_win_id: null,
        }),
      }),
    });
    expect(failed.phase).toBe("d2a");
  });
});
