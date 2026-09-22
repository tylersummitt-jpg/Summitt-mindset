import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const hoisted = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const updateEq = vi.fn();
  const coachMaybeSingle = vi.fn();
  const lastUpdate = {
    payload: null as Record<string, unknown> | null,
    eqs: [] as Array<[string, string]>,
    gt: null as [string, string] | null,
  };
  const mediaLimit = vi.fn();
  const lastMediaQuery = {
    sids: null as string[] | null,
    gte: null as string | null,
    lte: null as string | null,
  };
  const from = vi.fn((table: string) => {
    if (table === "v2_user_sms_comms_preferences") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle }),
        }),
        update: (payload: Record<string, unknown>) => {
          lastUpdate.payload = payload;
          lastUpdate.eqs = [];
          lastUpdate.gt = null;
          const chain = {
            eq: (col: string, val: string) => {
              lastUpdate.eqs.push([col, val]);
              return chain;
            },
            gt: (col: string, val: string) => {
              lastUpdate.gt = [col, val];
              return chain;
            },
            select: () => ({
              maybeSingle: updateEq,
            }),
          };
          return chain;
        },
      };
    }
    if (table === "sms_inbound_coach_jobs") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: coachMaybeSingle }),
        }),
      };
    }
    if (table === "v2_inbound_media_job") {
      const chain: {
        select: () => typeof chain;
        eq: () => typeof chain;
        in: (col: string, vals: string[]) => typeof chain;
        gte: (col: string, val: string) => typeof chain;
        lte: (col: string, val: string) => typeof chain;
        limit: typeof mediaLimit;
      } = {
        select: () => chain,
        eq: () => chain,
        in: (col: string, vals: string[]) => {
          if (col === "message_sid") lastMediaQuery.sids = vals;
          return chain;
        },
        gte: (col: string, val: string) => {
          if (col === "created_at") lastMediaQuery.gte = val;
          return chain;
        },
        lte: (col: string, val: string) => {
          if (col === "created_at") lastMediaQuery.lte = val;
          return chain;
        },
        limit: mediaLimit,
      };
      return chain;
    }
    throw new Error(`unexpected table ${table}`);
  });
  return {
    from,
    maybeSingle,
    updateEq,
    coachMaybeSingle,
    lastUpdate,
    mediaLimit,
    lastMediaQuery,
  };
});

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: hoisted.from },
}));

import {
  candidatePhotoTargetWinIdFromPersistResult,
  clearPendingPhotoRequestTarget,
  clearPhotoRequestCooldownAfterRequestedAttach,
  computePhotoRequestAllowed,
  hasCurrentTurnInboundMediaOccupancy,
  INBOUND_PHOTO_REQUEST_COACH_FALLBACK_NO,
  INBOUND_PHOTO_REQUEST_COACH_FALLBACK_YES,
  INBOUND_PHOTO_REQUEST_COOLDOWN_MS,
  INBOUND_PHOTO_REQUEST_PENDING_TTL_MS,
  isActivePendingPhotoTarget,
  isInboundPhotoRequestCoachFallbackAllowed,
  isPhotoRequestCooldownClear,
  loadActivePendingPhotoTarget,
  loadCoachJobStatusForPhotoPendingFallback,
  loadPhotoRequestEligibilityState,
  photoRequestRecentMediaWindow,
  shouldWritePhotoRequestAfterSuccessfulSend,
  tryWritePhotoRequestStateAfterTwilioSuccess,
  writePendingPhotoRequestAfterSuccessfulSend,
} from "@/lib/inbound-photo-request-state";
import { INBOUND_BURST_COALESCE_WINDOW_MS } from "@/lib/sms-inbound-burst-pace";

const NOW = new Date("2026-09-17T16:00:00.000Z");
const WIN = "cccccccc-3333-4333-8333-333333333333";

describe("pending photo-request state", () => {
  beforeEach(() => {
    hoisted.maybeSingle.mockReset();
    hoisted.updateEq.mockReset();
    hoisted.coachMaybeSingle.mockReset();
    hoisted.mediaLimit.mockReset();
    hoisted.lastUpdate.payload = null;
    hoisted.lastUpdate.eqs = [];
    hoisted.lastUpdate.gt = null;
    hoisted.lastMediaQuery.sids = null;
    hoisted.lastMediaQuery.gte = null;
    hoisted.lastMediaQuery.lte = null;
  });

  it("active only when win id is set and expiry is in the future", () => {
    expect(
      isActivePendingPhotoTarget(
        {
          pending_photo_request_win_id: WIN,
          pending_photo_request_expires_at: "2026-09-17T17:00:00.000Z",
        },
        NOW
      )
    ).toBe(true);
    expect(
      isActivePendingPhotoTarget(
        {
          pending_photo_request_win_id: WIN,
          pending_photo_request_expires_at: "2026-09-17T15:00:00.000Z",
        },
        NOW
      )
    ).toBe(false);
    expect(
      isActivePendingPhotoTarget(
        {
          pending_photo_request_win_id: null,
          pending_photo_request_expires_at: "2026-09-17T17:00:00.000Z",
        },
        NOW
      )
    ).toBe(false);
  });

  it("coach fallback YES/NO lists are exact", () => {
    expect([...INBOUND_PHOTO_REQUEST_COACH_FALLBACK_YES]).toEqual([
      "reply_ready",
      "sending",
      "sent",
      "cancelled",
      "awaiting_manual_pat_answer",
    ]);
    expect([...INBOUND_PHOTO_REQUEST_COACH_FALLBACK_NO]).toEqual([
      "pending",
      "processing",
      "failed",
      "needs_manual_review",
      "generating_reply",
    ]);
    for (const s of INBOUND_PHOTO_REQUEST_COACH_FALLBACK_YES) {
      expect(isInboundPhotoRequestCoachFallbackAllowed(s)).toBe(true);
    }
    for (const s of INBOUND_PHOTO_REQUEST_COACH_FALLBACK_NO) {
      expect(isInboundPhotoRequestCoachFallbackAllowed(s)).toBe(false);
    }
    expect(isInboundPhotoRequestCoachFallbackAllowed(null)).toBe(false);
    expect(isInboundPhotoRequestCoachFallbackAllowed("error")).toBe(false);
  });

  it("loadActivePendingPhotoTarget returns null for expired rows and error on query failure", async () => {
    hoisted.maybeSingle.mockResolvedValueOnce({
      data: {
        pending_photo_request_win_id: WIN,
        pending_photo_request_expires_at: "2026-09-17T17:00:00.000Z",
      },
      error: null,
    });
    await expect(loadActivePendingPhotoTarget("user_1", NOW)).resolves.toEqual({
      winId: WIN,
      expiresAt: "2026-09-17T17:00:00.000Z",
    });

    hoisted.maybeSingle.mockResolvedValueOnce({
      data: {
        pending_photo_request_win_id: WIN,
        pending_photo_request_expires_at: "2026-09-17T15:00:00.000Z",
      },
      error: null,
    });
    await expect(loadActivePendingPhotoTarget("user_1", NOW)).resolves.toBeNull();

    hoisted.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "db down" },
    });
    await expect(loadActivePendingPhotoTarget("user_1", NOW)).resolves.toBe(
      "error"
    );
  });

  it("coach status missing is null; query failure is error", async () => {
    hoisted.coachMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(
      loadCoachJobStatusForPhotoPendingFallback("SM1")
    ).resolves.toBeNull();
    hoisted.coachMaybeSingle.mockResolvedValueOnce({
      data: { status: "processing" },
      error: null,
    });
    await expect(loadCoachJobStatusForPhotoPendingFallback("SM1")).resolves.toBe(
      "processing"
    );
    hoisted.coachMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "db down" },
    });
    await expect(loadCoachJobStatusForPhotoPendingFallback("SM1")).resolves.toBe(
      "error"
    );
  });

  it("clear pending target never writes last_photo_request_sent_at", async () => {
    hoisted.updateEq.mockResolvedValueOnce({
      data: { clerk_user_id: "user_1" },
      error: null,
    });
    await expect(
      clearPendingPhotoRequestTarget({
        clerkUserId: "user_1",
        winId: WIN,
        now: NOW,
      })
    ).resolves.toBe(true);
    expect(hoisted.lastUpdate.payload).toMatchObject({
      pending_photo_request_win_id: null,
      pending_photo_request_expires_at: null,
    });
    expect(hoisted.lastUpdate.payload).not.toHaveProperty(
      "last_photo_request_sent_at"
    );
  });
});

const CLEAR = {
  pending: null,
  lastSentAt: null,
} as const;

function allowed(overrides: Partial<Parameters<typeof computePhotoRequestAllowed>[0]> = {}) {
  return computePhotoRequestAllowed({
    candidateWinId: WIN,
    questionPolicy: "none",
    hasCurrentTurnMedia: false,
    eligibilityState: { ...CLEAR },
    now: NOW,
    ...overrides,
  });
}

describe("Slice 2 photo-request eligibility", () => {
  it("one fresh UUID + no image + no pending + cooldown clear + question_policy none -> true", () => {
    expect(
      candidatePhotoTargetWinIdFromPersistResult([
        { id: WIN, status: "inserted" },
      ])
    ).toBe(WIN);
    expect(allowed()).toBe(true);
  });

  it("zero fresh -> false", () => {
    expect(candidatePhotoTargetWinIdFromPersistResult([])).toBeNull();
    expect(candidatePhotoTargetWinIdFromPersistResult(null)).toBeNull();
    expect(allowed({ candidateWinId: null })).toBe(false);
  });

  it("two fresh inserted -> false", () => {
    expect(
      candidatePhotoTargetWinIdFromPersistResult([
        { id: WIN, status: "inserted" },
        { id: "dddddddd-4444-4444-8444-444444444444", status: "inserted" },
      ])
    ).toBeNull();
  });

  it("retry/existing win -> false", () => {
    expect(
      candidatePhotoTargetWinIdFromPersistResult([
        { id: WIN, status: "existing" },
      ])
    ).toBeNull();
    expect(
      candidatePhotoTargetWinIdFromPersistResult([
        { id: WIN, status: "failed" },
      ])
    ).toBeNull();
    expect(
      candidatePhotoTargetWinIdFromPersistResult([{ id: "w1", status: "inserted" }])
    ).toBeNull();
  });

  it("same-turn image -> false", () => {
    expect(allowed({ hasCurrentTurnMedia: true })).toBe(false);
  });

  it("active pending -> false", () => {
    expect(
      allowed({
        eligibilityState: {
          pending: { winId: WIN, expiresAt: "2026-09-17T17:00:00.000Z" },
          lastSentAt: null,
        },
      })
    ).toBe(false);
  });

  it("cooldown <168h -> false; >=168h -> true", () => {
    const justUnder = new Date(
      NOW.getTime() - INBOUND_PHOTO_REQUEST_COOLDOWN_MS + 1000
    ).toISOString();
    const exactly = new Date(
      NOW.getTime() - INBOUND_PHOTO_REQUEST_COOLDOWN_MS
    ).toISOString();
    expect(isPhotoRequestCooldownClear(justUnder, NOW)).toBe(false);
    expect(isPhotoRequestCooldownClear(exactly, NOW)).toBe(true);
    expect(isPhotoRequestCooldownClear(null, NOW)).toBe(true);
    expect(allowed({ eligibilityState: { pending: null, lastSentAt: justUnder } })).toBe(
      false
    );
    expect(allowed({ eligibilityState: { pending: null, lastSentAt: exactly } })).toBe(
      true
    );
  });

  it("unfulfilled request keeps the 168h block after the pending window is inactive", () => {
    const dayLater = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const sentAt = NOW.toISOString();
    expect(isPhotoRequestCooldownClear(sentAt, dayLater)).toBe(false);
    expect(
      computePhotoRequestAllowed({
        candidateWinId: WIN,
        questionPolicy: "none",
        hasCurrentTurnMedia: false,
        eligibilityState: { pending: null, lastSentAt: sentAt },
        now: dayLater,
        bindingConfirmationRequired: false,
      })
    ).toBe(false);
  });

  it("null cooldown and no pending allow the next ask when every other gate passes", () => {
    expect(
      allowed({
        eligibilityState: { pending: null, lastSentAt: null },
        questionPolicy: "none",
        hasCurrentTurnMedia: false,
        bindingConfirmationRequired: false,
      })
    ).toBe(true);
  });

  it("state/media lookup error -> false", () => {
    expect(allowed({ eligibilityState: "error" })).toBe(false);
    expect(allowed({ hasCurrentTurnMedia: "error" })).toBe(false);
  });

  it("binding Goal Change confirmation required -> false", () => {
    expect(allowed({ bindingConfirmationRequired: true })).toBe(false);
    expect(allowed({ bindingConfirmationRequired: false })).toBe(true);
  });

  it("question_policy one_useful_question -> false", () => {
    expect(allowed({ questionPolicy: "one_useful_question" })).toBe(false);
    expect(allowed({ questionPolicy: "unknown" })).toBe(false);
  });

  it("TTL is 6h and cooldown is 168h", () => {
    expect(INBOUND_PHOTO_REQUEST_PENDING_TTL_MS).toBe(6 * 60 * 60 * 1000);
    expect(INBOUND_PHOTO_REQUEST_COOLDOWN_MS).toBe(168 * 60 * 60 * 1000);
  });
});

describe("Slice 2 photo-request read/write", () => {
  beforeEach(() => {
    hoisted.maybeSingle.mockReset();
    hoisted.updateEq.mockReset();
    hoisted.coachMaybeSingle.mockReset();
    hoisted.mediaLimit.mockReset();
    hoisted.lastUpdate.payload = null;
    hoisted.lastUpdate.eqs = [];
    hoisted.lastUpdate.gt = null;
    hoisted.lastMediaQuery.sids = null;
    hoisted.lastMediaQuery.gte = null;
    hoisted.lastMediaQuery.lte = null;
  });
  it("eligibility state returns pending and lastSentAt; query error is error", async () => {
    hoisted.maybeSingle.mockResolvedValueOnce({
      data: {
        pending_photo_request_win_id: WIN,
        pending_photo_request_expires_at: "2026-09-17T17:00:00.000Z",
        last_photo_request_sent_at: "2026-09-10T16:00:00.000Z",
      },
      error: null,
    });
    await expect(loadPhotoRequestEligibilityState("user_1", NOW)).resolves.toEqual({
      pending: { winId: WIN, expiresAt: "2026-09-17T17:00:00.000Z" },
      lastSentAt: "2026-09-10T16:00:00.000Z",
    });

    hoisted.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "db down" },
    });
    await expect(loadPhotoRequestEligibilityState("user_1", NOW)).resolves.toBe(
      "error"
    );
  });

  it("media on processed SID suppresses occupancy", async () => {
    hoisted.mediaLimit.mockResolvedValueOnce({
      data: [{ id: "job-1" }],
      error: null,
    });
    await expect(
      hasCurrentTurnInboundMediaOccupancy({
        clerkUserId: "user_1",
        currentTurnMessageSids: ["SM1"],
        turnReceivedAt: NOW,
      })
    ).resolves.toBe(true);
    expect(hoisted.lastMediaQuery.sids).toEqual(["SM1"]);
    expect(hoisted.mediaLimit).toHaveBeenCalledTimes(1);
  });

  it("media on suppressed/coalesced SID suppresses occupancy", async () => {
    hoisted.mediaLimit.mockResolvedValueOnce({
      data: [{ id: "job-a" }],
      error: null,
    });
    await expect(
      hasCurrentTurnInboundMediaOccupancy({
        clerkUserId: "user_1",
        currentTurnMessageSids: ["SMphoto", "SMcaption"],
        turnReceivedAt: NOW,
      })
    ).resolves.toBe(true);
    expect(hoisted.lastMediaQuery.sids).toEqual(["SMphoto", "SMcaption"]);
    expect(hoisted.mediaLimit).toHaveBeenCalledTimes(1);
  });

  it("no media on any currentTurnMessageSid and no recent window row does not suppress", async () => {
    hoisted.mediaLimit
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    await expect(
      hasCurrentTurnInboundMediaOccupancy({
        clerkUserId: "user_1",
        currentTurnMessageSids: ["SMcaption"],
        turnReceivedAt: NOW,
      })
    ).resolves.toBe(false);
    expect(hoisted.lastMediaQuery.sids).toEqual(["SMcaption"]);
    const window = photoRequestRecentMediaWindow(NOW);
    expect(hoisted.lastMediaQuery.gte).toBe(window?.startIso);
    expect(hoisted.lastMediaQuery.lte).toBe(window?.endIso);
    expect(hoisted.mediaLimit).toHaveBeenCalledTimes(2);
  });

  it("image-only media job inside 120s before caption suppresses", async () => {
    hoisted.mediaLimit
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [{ id: "job-img" }], error: null });
    await expect(
      hasCurrentTurnInboundMediaOccupancy({
        clerkUserId: "user_1",
        currentTurnMessageSids: ["SMcaption"],
        turnReceivedAt: NOW,
      })
    ).resolves.toBe(true);
    const window = photoRequestRecentMediaWindow(NOW);
    expect(window).toEqual({
      startIso: new Date(NOW.getTime() - INBOUND_BURST_COALESCE_WINDOW_MS).toISOString(),
      endIso: NOW.toISOString(),
    });
    expect(hoisted.lastMediaQuery.gte).toBe(window?.startIso);
    expect(hoisted.lastMediaQuery.lte).toBe(window?.endIso);
  });

  it("media job outside 120s window does not suppress", async () => {
    hoisted.mediaLimit
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    await expect(
      hasCurrentTurnInboundMediaOccupancy({
        clerkUserId: "user_1",
        currentTurnMessageSids: ["SMcaption"],
        turnReceivedAt: NOW,
      })
    ).resolves.toBe(false);
    expect(hoisted.lastMediaQuery.gte).toBe(
      new Date(NOW.getTime() - INBOUND_BURST_COALESCE_WINDOW_MS).toISOString()
    );
    expect(hoisted.lastMediaQuery.lte).toBe(NOW.toISOString());
  });

  it("current-turn SID media lookup error fails closed", async () => {
    hoisted.mediaLimit.mockResolvedValueOnce({
      data: null,
      error: { message: "db down" },
    });
    await expect(
      hasCurrentTurnInboundMediaOccupancy({
        clerkUserId: "user_1",
        currentTurnMessageSids: ["SM1"],
        turnReceivedAt: NOW,
      })
    ).resolves.toBe("error");
    expect(hoisted.mediaLimit).toHaveBeenCalledTimes(1);
  });

  it("recent-window media lookup error fails closed", async () => {
    hoisted.mediaLimit
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "db down" } });
    await expect(
      hasCurrentTurnInboundMediaOccupancy({
        clerkUserId: "user_1",
        currentTurnMessageSids: ["SMcaption"],
        turnReceivedAt: NOW,
      })
    ).resolves.toBe("error");
    expect(hoisted.mediaLimit).toHaveBeenCalledTimes(2);
  });

  it("photo_requested false or missing candidate skips write", async () => {
    expect(
      shouldWritePhotoRequestAfterSuccessfulSend({
        photoRequested: false,
        candidatePhotoTargetWinId: WIN,
      })
    ).toBe(false);
    expect(
      shouldWritePhotoRequestAfterSuccessfulSend({
        photoRequested: true,
        candidatePhotoTargetWinId: null,
      })
    ).toBe(false);
    await tryWritePhotoRequestStateAfterTwilioSuccess({
      clerkUserId: "user_1",
      photoRequested: true,
      candidatePhotoTargetWinId: null,
    });
    expect(hoisted.lastUpdate.payload).toBeNull();
  });

  it("successful send writes one update with target + 6h + now", async () => {
    hoisted.updateEq.mockResolvedValueOnce({
      data: { clerk_user_id: "user_1" },
      error: null,
    });
    await expect(
      writePendingPhotoRequestAfterSuccessfulSend({
        clerkUserId: "user_1",
        winId: WIN,
        now: NOW,
      })
    ).resolves.toBe(true);
    expect(hoisted.lastUpdate.payload).toEqual({
      pending_photo_request_win_id: WIN,
      pending_photo_request_expires_at: new Date(
        NOW.getTime() + INBOUND_PHOTO_REQUEST_PENDING_TTL_MS
      ).toISOString(),
      last_photo_request_sent_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });
  });

  it("photo-state write failure after Twilio does not throw", async () => {
    hoisted.updateEq.mockResolvedValueOnce({
      data: null,
      error: { message: "db down" },
    });
    await expect(
      tryWritePhotoRequestStateAfterTwilioSuccess({
        clerkUserId: "user_1",
        photoRequested: true,
        candidatePhotoTargetWinId: WIN,
        now: NOW,
      })
    ).resolves.toBeUndefined();
  });

  it("cron writes photo state after Twilio sid persist and before sent finalize", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts"),
      "utf8"
    );
    const sidIdx = src.indexOf("outbound_message_sid persist failed");
    const photoIdx = src.indexOf("await tryWritePhotoRequestStateAfterTwilioSuccess({");
    const sentIdx = src.indexOf("sent_at finalization failed");
    expect(sidIdx).toBeGreaterThan(0);
    expect(photoIdx).toBeGreaterThan(sidIdx);
    expect(sentIdx).toBeGreaterThan(photoIdx);
    expect(src).toContain("photo_request_state_write_failed_soft");
  });

  it("requested attach inside the pending window clears cooldown and pending together", async () => {
    const createdAt = "2026-09-17T15:00:00.000Z";
    hoisted.updateEq.mockResolvedValueOnce({
      data: { clerk_user_id: "user_1" },
      error: null,
    });
    await expect(
      clearPhotoRequestCooldownAfterRequestedAttach({
        clerkUserId: "user_1",
        attachedWinId: WIN,
        mediaJobCreatedAt: createdAt,
        now: NOW,
      })
    ).resolves.toBe(true);
    expect(hoisted.lastUpdate.payload).toEqual({
      last_photo_request_sent_at: null,
      pending_photo_request_win_id: null,
      pending_photo_request_expires_at: null,
      updated_at: NOW.toISOString(),
    });
    expect(hoisted.lastUpdate.eqs).toEqual([
      ["clerk_user_id", "user_1"],
      ["pending_photo_request_win_id", WIN],
    ]);
    expect(hoisted.lastUpdate.gt).toEqual([
      "pending_photo_request_expires_at",
      createdAt,
    ]);
  });

  it("a different or newer pending win id is the only win the update will match", async () => {
    const newerWin = "dddddddd-4444-4444-8444-444444444444";
    hoisted.updateEq.mockResolvedValueOnce({ data: null, error: null });
    await expect(
      clearPhotoRequestCooldownAfterRequestedAttach({
        clerkUserId: "user_1",
        attachedWinId: WIN,
        mediaJobCreatedAt: "2026-09-17T15:00:00.000Z",
        now: NOW,
      })
    ).resolves.toBe(false);
    expect(hoisted.lastUpdate.eqs).toEqual([
      ["clerk_user_id", "user_1"],
      ["pending_photo_request_win_id", WIN],
    ]);
    expect(hoisted.lastUpdate.eqs).not.toContainEqual([
      "pending_photo_request_win_id",
      newerWin,
    ]);
  });

  it("media received at or after expiry is excluded by expires_at > created_at", async () => {
    const createdAt = "2026-09-17T22:00:00.000Z";
    hoisted.updateEq.mockResolvedValueOnce({ data: null, error: null });
    await expect(
      clearPhotoRequestCooldownAfterRequestedAttach({
        clerkUserId: "user_1",
        attachedWinId: WIN,
        mediaJobCreatedAt: createdAt,
        now: NOW,
      })
    ).resolves.toBe(false);
    expect(hoisted.lastUpdate.gt).toEqual([
      "pending_photo_request_expires_at",
      createdAt,
    ]);
  });

  it("malformed media created_at does not write", async () => {
    await expect(
      clearPhotoRequestCooldownAfterRequestedAttach({
        clerkUserId: "user_1",
        attachedWinId: WIN,
        mediaJobCreatedAt: "not-a-date",
        now: NOW,
      })
    ).resolves.toBe(false);
    expect(hoisted.lastUpdate.payload).toBeNull();
  });

  it("prefs clear failure does not throw", async () => {
    hoisted.updateEq.mockResolvedValueOnce({
      data: null,
      error: { message: "db down" },
    });
    await expect(
      clearPhotoRequestCooldownAfterRequestedAttach({
        clerkUserId: "user_1",
        attachedWinId: WIN,
        mediaJobCreatedAt: "2026-09-17T15:00:00.000Z",
        now: NOW,
      })
    ).resolves.toBe(false);
  });

  it("a second clear after the pending win is gone matches zero rows", async () => {
    hoisted.updateEq.mockResolvedValueOnce({ data: null, error: null });
    await expect(
      clearPhotoRequestCooldownAfterRequestedAttach({
        clerkUserId: "user_1",
        attachedWinId: WIN,
        mediaJobCreatedAt: "2026-09-17T15:00:00.000Z",
        now: NOW,
      })
    ).resolves.toBe(false);
  });

  it("Morning, Evening, and Weekly writers do not clear this cooldown", () => {
    for (const rel of [
      "src/lib/morning-tto-writer.ts",
      "src/lib/tyler-text-overview-evening-send.ts",
      "src/lib/weekly-tto-writer.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src).not.toContain("clearPhotoRequestCooldownAfterRequestedAttach");
      expect(src).not.toContain("last_photo_request_sent_at");
    }
  });

  it("writer prompt and model constants are unchanged by this cooldown clear", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/inbound-sol-writer.ts"),
      "utf8"
    );
    expect(src).toContain('export const INBOUND_SOL_WRITER_MODEL = "gpt-5.6-sol"');
    expect(src).toContain('export const INBOUND_SOL_WRITER_REASONING_EFFORT = "low"');
    expect(src).not.toContain("clearPhotoRequestCooldownAfterRequestedAttach");
    expect(src).toContain("When photo_request_allowed is true, normally use");
  });
});
