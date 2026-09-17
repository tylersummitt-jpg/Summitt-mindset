import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const hoisted = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const updateEq = vi.fn();
  const coachMaybeSingle = vi.fn();
  const lastUpdate = { payload: null as Record<string, unknown> | null };
  const from = vi.fn((table: string) => {
    if (table === "v2_user_sms_comms_preferences") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle }),
        }),
        update: (payload: Record<string, unknown>) => {
          lastUpdate.payload = payload;
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: updateEq,
                }),
              }),
            }),
          };
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
    throw new Error(`unexpected table ${table}`);
  });
  return { from, maybeSingle, updateEq, coachMaybeSingle, lastUpdate };
});

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: hoisted.from },
}));

import {
  clearPendingPhotoRequestTarget,
  INBOUND_PHOTO_REQUEST_COACH_FALLBACK_NO,
  INBOUND_PHOTO_REQUEST_COACH_FALLBACK_YES,
  isActivePendingPhotoTarget,
  isInboundPhotoRequestCoachFallbackAllowed,
  loadActivePendingPhotoTarget,
  loadCoachJobStatusForPhotoPendingFallback,
} from "@/lib/inbound-photo-request-state";

const NOW = new Date("2026-09-17T16:00:00.000Z");
const WIN = "cccccccc-3333-4333-8333-333333333333";

describe("pending photo-request state", () => {
  beforeEach(() => {
    hoisted.maybeSingle.mockReset();
    hoisted.updateEq.mockReset();
    hoisted.coachMaybeSingle.mockReset();
    hoisted.lastUpdate.payload = null;
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
