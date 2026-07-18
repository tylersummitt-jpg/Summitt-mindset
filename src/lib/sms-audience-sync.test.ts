import { describe, expect, it, vi, beforeEach } from "vitest";

const upsertMock = vi.fn(async () => ({ error: null }));
const updateEqMock = vi.fn(async () => ({ error: null }));
const updateMock = vi.fn(() => ({ eq: updateEqMock }));
const maybeSingleMock = vi.fn();
const selectEqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: selectEqMock }));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn((table: string) => {
      if (table === "sms_identities") {
        return { select: selectMock };
      }
      if (table === "sms_audience") {
        return { upsert: upsertMock, update: updateMock };
      }
      if (table === "account_deletion_requests") {
        return {
          select: () => ({
            eq: () => ({
              neq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        };
      }
      return {};
    }),
  },
}));

vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: vi.fn(async () => ({ summittSubscribed: true })),
}));

vi.mock("server-only", () => ({}));

import {
  applyStoppedAtToAudiencePayload,
  syncSmsAudience,
} from "@/lib/sms-audience-sync";

describe("applyStoppedAtToAudiencePayload", () => {
  it("clears stopped_at when stoppedAt is null (START)", () => {
    const payload: Record<string, unknown> = {};
    applyStoppedAtToAudiencePayload(payload, null);
    expect(payload).toEqual({ stopped_at: null });
  });

  it("sets stopped_at when stoppedAt is a timestamp (STOP)", () => {
    const payload: Record<string, unknown> = {};
    applyStoppedAtToAudiencePayload(payload, "2026-07-11T12:00:00.000Z");
    expect(payload.stopped_at).toBe("2026-07-11T12:00:00.000Z");
  });

  it("leaves payload unchanged when stoppedAt is undefined", () => {
    const payload: Record<string, unknown> = { sms_enabled: true };
    applyStoppedAtToAudiencePayload(payload, undefined);
    expect(payload).toEqual({ sms_enabled: true });
  });
});

describe("syncSmsAudience START clears stopped_at", () => {
  beforeEach(() => {
    upsertMock.mockClear();
    updateMock.mockClear();
    updateEqMock.mockClear();
    maybeSingleMock.mockReset();
  });

  it("A: START-style sync upserts sms_enabled true and stopped_at null", async () => {
    await syncSmsAudience({
      userId: "user_shelly",
      phoneNumber: "+15551234567",
      smsEnabled: true,
      stoppedAt: null,
      summittSubscribed: true,
    });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [payload] = upsertMock.mock.calls[0]!;
    expect(payload).toMatchObject({
      clerk_user_id: "user_shelly",
      phone_number: "+15551234567",
      sms_enabled: true,
      stopped_at: null,
      summitt_subscribed: true,
    });
  });

  it("B: STOP-style sync upserts sms_enabled false and stopped_at timestamp", async () => {
    const stopped = "2026-07-11T18:00:00.000Z";
    await syncSmsAudience({
      userId: "user_shelly",
      phoneNumber: "+15551234567",
      smsEnabled: false,
      stoppedAt: stopped,
      summittSubscribed: true,
    });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [payload] = upsertMock.mock.calls[0]!;
    expect(payload).toMatchObject({
      sms_enabled: false,
      stopped_at: stopped,
    });
  });

  it("omitting stoppedAt does not write stopped_at (subscription sync)", async () => {
    await syncSmsAudience({
      userId: "user_shelly",
      phoneNumber: "+15551234567",
      smsEnabled: true,
      summittSubscribed: false,
    });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [payload] = upsertMock.mock.calls[0]!;
    expect(payload).toMatchObject({
      sms_enabled: true,
      summitt_subscribed: false,
    });
    expect(payload).not.toHaveProperty("stopped_at");
  });
});
