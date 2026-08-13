import { beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table !== "v2_inbound_media_job") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        insert: (row: unknown) => insertMock(row),
      };
    },
  },
}));

vi.mock("@/lib/victory-media/mms-ingest-flags", () => ({
  isVictoryMediaMmsIngestEnabled: vi.fn(() => true),
}));

import { isVictoryMediaMmsIngestEnabled } from "@/lib/victory-media/mms-ingest-flags";
import {
  enqueueInboundMediaJobs,
  maybeEnqueueInboundMediaJobsFromTwilioParams,
} from "@/lib/victory-media/enqueue-inbound-media-jobs";

const USER = "user_test_a2";
const SM = "SMbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ME = "MEcccccccccccccccccccccccccccccccc";
const AC = "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("enqueueInboundMediaJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockResolvedValue({ error: null });
  });

  it("one supported ordinal → one pending_download row", async () => {
    const r = await enqueueInboundMediaJobs({
      clerkUserId: USER,
      messageSid: SM,
      media: [{ ordinal: 0, declaredContentType: "image/jpeg", twilioMediaSid: ME }],
    });
    expect(r).toEqual({ attempted: 1, inserted: 1, alreadyExisted: 0, failed: 0 });
    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(row).toMatchObject({
      message_sid: SM,
      media_ordinal: 0,
      clerk_user_id: USER,
      twilio_media_sid: ME,
      declared_content_type: "image/jpeg",
      status: "pending_download",
      attempt_count: 0,
      expires_at: null,
      temp_storage_path: null,
      normalized_storage_path: null,
      attached_win_id: null,
      resolution: null,
      classifier_target: null,
      followup_idempotency_key: null,
    });
    expect(row).not.toHaveProperty("media_url");
    expect(JSON.stringify(row)).not.toContain("MediaUrl");
  });

  it("multiple ordinals → one insert each", async () => {
    const r = await enqueueInboundMediaJobs({
      clerkUserId: USER,
      messageSid: SM,
      media: [
        { ordinal: 0, declaredContentType: "image/png", twilioMediaSid: null },
        { ordinal: 1, declaredContentType: "image/webp", twilioMediaSid: ME },
      ],
    });
    expect(r.inserted).toBe(2);
    expect(insertMock).toHaveBeenCalledTimes(2);
  });

  it("duplicate sid+ordinal leaves original untouched (23505)", async () => {
    insertMock.mockResolvedValueOnce({ error: { code: "23505", message: "duplicate" } });
    const r = await enqueueInboundMediaJobs({
      clerkUserId: USER,
      messageSid: SM,
      media: [{ ordinal: 0, declaredContentType: "image/jpeg", twilioMediaSid: ME }],
    });
    expect(r).toEqual({ attempted: 1, inserted: 0, alreadyExisted: 1, failed: 0 });
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it("DB error counts as failed without throwing", async () => {
    insertMock.mockResolvedValueOnce({ error: { code: "42501", message: "denied" } });
    const r = await enqueueInboundMediaJobs({
      clerkUserId: USER,
      messageSid: SM,
      media: [{ ordinal: 0, declaredContentType: "image/jpeg", twilioMediaSid: null }],
    });
    expect(r.failed).toBe(1);
    expect(r.inserted).toBe(0);
  });
});

describe("maybeEnqueueInboundMediaJobsFromTwilioParams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockResolvedValue({ error: null });
    vi.mocked(isVictoryMediaMmsIngestEnabled).mockReturnValue(true);
    process.env.TWILIO_ACCOUNT_SID = AC;
  });

  it("flag off → null / no insert", async () => {
    vi.mocked(isVictoryMediaMmsIngestEnabled).mockReturnValue(false);
    const params = new URLSearchParams({
      MediaUrl0: `https://api.twilio.com/2010-04-01/Accounts/${AC}/Messages/${SM}/Media/${ME}`,
      MediaContentType0: "image/jpeg",
    });
    const r = await maybeEnqueueInboundMediaJobsFromTwilioParams({
      clerkUserId: USER,
      messageSid: SM,
      params,
      numMedia: 1,
    });
    expect(r).toBeNull();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("supported + video → only image job", async () => {
    const params = new URLSearchParams({
      MediaUrl0: `https://api.twilio.com/2010-04-01/Accounts/${AC}/Messages/${SM}/Media/${ME}`,
      MediaContentType0: "image/jpeg",
      MediaUrl1: `https://api.twilio.com/2010-04-01/Accounts/${AC}/Messages/${SM}/Media/MEdddddddddddddddddddddddddddddddd`,
      MediaContentType1: "video/mp4",
    });
    const r = await maybeEnqueueInboundMediaJobsFromTwilioParams({
      clerkUserId: USER,
      messageSid: SM,
      params,
      numMedia: 2,
    });
    expect(r?.inserted).toBe(1);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
