import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.fn();
const hasUnresolvedMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));
vi.mock("./deletion-guards", () => ({
  hasUnresolvedAccountDeletionRequest: (...args: unknown[]) =>
    hasUnresolvedMock(...args),
}));

import { checkInboundCoachSmsEligibility } from "./inbound-coach-send-eligibility";

function mockJobAndIdentity(opts: {
  jobStatus: string;
  jobUser?: string;
  identity?: Record<string, unknown> | null;
}) {
  fromMock.mockImplementation((table: string) => {
    if (table === "sms_inbound_coach_jobs") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                message_sid: "SM_job_1",
                status: opts.jobStatus,
                clerk_user_id: opts.jobUser ?? "user_a",
              },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "sms_identities") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: opts.identity === undefined
                ? {
                    phone_number: "+15551234567",
                    clerk_user_id: "user_a",
                    sms_enabled: true,
                    stopped_at: null,
                  }
                : opts.identity,
              error: null,
            }),
          }),
        }),
      };
    }
    return {};
  });
}

describe("checkInboundCoachSmsEligibility", () => {
  beforeEach(() => {
    fromMock.mockReset();
    hasUnresolvedMock.mockReset();
    hasUnresolvedMock.mockResolvedValue(false);
  });

  it("eligible when job sendable, identity live, no deletion", async () => {
    mockJobAndIdentity({ jobStatus: "sending" });
    const result = await checkInboundCoachSmsEligibility({
      clerkUserId: "user_a",
      destinationPhone: "+15551234567",
      messageSid: "SM_job_1",
      expectedJobStatuses: ["sending"],
    });
    expect(result).toEqual({ ok: true, reason: "eligible" });
    expect(JSON.stringify(result)).not.toMatch(/\+1555/);
  });

  it("account_deleting blocks and never includes phone", async () => {
    mockJobAndIdentity({ jobStatus: "sending" });
    hasUnresolvedMock.mockResolvedValue(true);
    const result = await checkInboundCoachSmsEligibility({
      clerkUserId: "user_a",
      destinationPhone: "+15551234567",
      messageSid: "SM_job_1",
      expectedJobStatuses: ["sending"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("account_deleting");
    expect(result.lastErrorCode).toBe("account_deleting");
    expect(JSON.stringify(result)).not.toMatch(/\+1555|phone/i);
  });

  it("identity_missing blocks", async () => {
    mockJobAndIdentity({ jobStatus: "processing", identity: null });
    const result = await checkInboundCoachSmsEligibility({
      clerkUserId: "user_a",
      destinationPhone: "+15551234567",
      messageSid: "SM_job_1",
      expectedJobStatuses: ["processing"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("identity_missing");
    expect(result.lastErrorCode).toBe("sms_not_eligible");
  });

  it("sms_disabled blocks", async () => {
    mockJobAndIdentity({
      jobStatus: "processing",
      identity: {
        phone_number: "+15551234567",
        clerk_user_id: "user_a",
        sms_enabled: false,
        stopped_at: null,
      },
    });
    const result = await checkInboundCoachSmsEligibility({
      clerkUserId: "user_a",
      destinationPhone: "+15551234567",
      messageSid: "SM_job_1",
      expectedJobStatuses: ["processing"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("sms_disabled");
  });

  it("sms_stopped blocks", async () => {
    mockJobAndIdentity({
      jobStatus: "processing",
      identity: {
        phone_number: "+15551234567",
        clerk_user_id: "user_a",
        sms_enabled: true,
        stopped_at: "2026-07-18T12:00:00.000Z",
      },
    });
    const result = await checkInboundCoachSmsEligibility({
      clerkUserId: "user_a",
      destinationPhone: "+15551234567",
      messageSid: "SM_job_1",
      expectedJobStatuses: ["processing"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("sms_stopped");
  });

  it("phone_mismatch blocks", async () => {
    mockJobAndIdentity({
      jobStatus: "sending",
      identity: {
        phone_number: "+15550001111",
        clerk_user_id: "user_a",
        sms_enabled: true,
        stopped_at: null,
      },
    });
    const result = await checkInboundCoachSmsEligibility({
      clerkUserId: "user_a",
      destinationPhone: "+15551234567",
      messageSid: "SM_job_1",
      expectedJobStatuses: ["sending"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("phone_mismatch");
    expect(JSON.stringify(result)).not.toMatch(/\+1555/);
  });

  it("job_not_sendable when status not expected", async () => {
    mockJobAndIdentity({ jobStatus: "cancelled" });
    const result = await checkInboundCoachSmsEligibility({
      clerkUserId: "user_a",
      destinationPhone: "+15551234567",
      messageSid: "SM_job_1",
      expectedJobStatuses: ["sending"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("job_not_sendable");
  });
});
