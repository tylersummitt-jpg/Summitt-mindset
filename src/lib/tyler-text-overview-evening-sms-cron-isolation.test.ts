import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendEveningMock = vi.hoisted(() => vi.fn());
const getClerkUserMock = vi.hoisted(() => vi.fn());
const audienceRows = vi.hoisted(() => ({ current: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/tyler-text-overview-evening-send", () => ({
  sendEveningTtoAuthoritativeCronSend: sendEveningMock,
}));

vi.mock("@/lib/clerk-rest", () => ({
  getClerkUser: getClerkUserMock,
}));

vi.mock("@/lib/twilio", () => ({
  isTwilioReady: () => true,
}));

vi.mock("@/lib/v2-sms-comms-preferences", () => ({
  fetchV2UserSmsCommsPreferences: vi.fn(async () => null),
  shouldSkipDailyForCommsPrefs: () => ({ skip: false }),
}));

vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  evaluateOutboundSmsForAccountDeletion: vi.fn(async () => ({ decision: "allowed" })),
}));

vi.mock("@/lib/supabase-server", () => {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.is = () => builder;
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data: audienceRows.current, error: null }).then(resolve, reject);
  return { supabaseServer: { from: () => builder } };
});

function audienceUser(clerkUserId: string, phone: string) {
  return {
    clerk_user_id: clerkUserId,
    phone_number: phone,
    sms_enabled: true,
    stopped_at: null,
    timezone: "America/New_York",
    summitt_subscribed: true,
  };
}

describe("Evening cron per-user send exception isolation", () => {
  const cronSecret = "evening-cron-isolation-secret";

  beforeEach(() => {
    process.env.CRON_SECRET = cronSecret;
    delete process.env.SMS_DRY_RUN;
    audienceRows.current = [
      audienceUser("user_a", "+15551111111"),
      audienceUser("user_b", "+15552222222"),
    ];
    getClerkUserMock.mockResolvedValue({
      public_metadata: { timezone: "America/New_York" },
    });
    sendEveningMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T23:05:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a thrown send for user A is counted and does not abort user B's send path", async () => {
    sendEveningMock.mockImplementation(async (args: { clerkUserId: string }) => {
      if (args.clerkUserId === "user_a") {
        throw new Error("unexpected user A boom");
      }
      return {
        ok: true,
        draftId: "draft-b",
        clerkUserId: "user_b",
        draftForDayKey: "2026-06-27",
        sendSlot: "evening_checkin",
        smsSendEventId: "evt-b",
        twilioMessageSid: "SM_B",
        finalBodySent: "Good evening B",
        mode: "evening_sms_cron",
      };
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { GET } = await import("@/app/api/cron/evening-sms/route");
      const res = await GET(
        new Request("http://localhost/api/cron/evening-sms", {
          headers: { "x-cron-secret": cronSecret },
        })
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(sendEveningMock).toHaveBeenCalledTimes(2);
      expect(sendEveningMock.mock.calls[0]?.[0]?.clerkUserId).toBe("user_a");
      expect(sendEveningMock.mock.calls[1]?.[0]?.clerkUserId).toBe("user_b");
      expect(body.scanned).toBe(2);
      expect(body.eligible).toBe(2);
      expect(body.skippedOther).toBe(1);
      expect(body.sent).toBe(1);
      expect(body.failed).toBe(0);
      expect(errorSpy).toHaveBeenCalledWith(
        "[evening-sms] sendEveningTtoAuthoritativeCronSend threw",
        "user_a",
        expect.any(Error)
      );
      await expect(sendEveningMock.mock.results[0]?.value).rejects.toThrow(
        "unexpected user A boom"
      );
      await expect(sendEveningMock.mock.results[1]?.value).resolves.toMatchObject({
        ok: true,
        clerkUserId: "user_b",
        smsSendEventId: "evt-b",
      });
    } finally {
      errorSpy.mockRestore();
    }
  });
});
