import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
const assertOutboundMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("twilio", () => {
  class TwilioMock {
    messages = { create: (...args: unknown[]) => createMock(...args) };
  }
  return { default: (..._args: unknown[]) => new TwilioMock() as never };
});

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
      upsert: async () => ({ error: null }),
    }),
  },
}));

vi.mock("@/lib/account-deletion/deletion-guards", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/account-deletion/deletion-guards")>();
  return {
    ...actual,
    assertOutboundSmsAllowedForAccountDeletion: (...args: unknown[]) =>
      assertOutboundMock(...args),
  };
});

describe("sendSMS APP-041B2b transport deletion guard", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MGtest";
    createMock.mockResolvedValue({ sid: "SM123", status: "queued" });
    assertOutboundMock.mockResolvedValue(undefined);
  });

  it("7. ordinary user → messages.create once", async () => {
    const { sendSMS } = await import("./twilio");
    const msg = await sendSMS({
      to: "+15551234567",
      body: "hello",
      lastOutbound: { clerkUserId: "user_ok", messageKind: "question" },
    });
    expect(msg.sid).toBe("SM123");
    expect(assertOutboundMock).toHaveBeenCalledWith("user_ok");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("8. deletion-blocked user → no messages.create", async () => {
    const { AccountDeletionOutboundSmsError } = await import(
      "@/lib/account-deletion/deletion-guards"
    );
    assertOutboundMock.mockRejectedValue(
      new AccountDeletionOutboundSmsError("blocked_due_to_deletion")
    );
    const { sendSMS } = await import("./twilio");
    await expect(
      sendSMS({
        to: "+15551234567",
        body: "hello",
        lastOutbound: { clerkUserId: "user_del", messageKind: "question" },
      })
    ).rejects.toMatchObject({ code: "account_deletion_blocks_sms" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("9. lookup failure → no messages.create", async () => {
    const { AccountDeletionOutboundSmsError } = await import(
      "@/lib/account-deletion/deletion-guards"
    );
    assertOutboundMock.mockRejectedValue(
      new AccountDeletionOutboundSmsError("lookup_failed")
    );
    const { sendSMS } = await import("./twilio");
    await expect(
      sendSMS({
        to: "+15551234567",
        body: "hello",
        lastOutbound: { clerkUserId: "user_x", messageKind: "question" },
      })
    ).rejects.toMatchObject({ code: "deletion_lookup_failed" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("10. deletion begins after earlier check → transport still blocks", async () => {
    // Simulate: caller thought allowed, transport assert fails.
    const { AccountDeletionOutboundSmsError } = await import(
      "@/lib/account-deletion/deletion-guards"
    );
    assertOutboundMock.mockRejectedValue(
      new AccountDeletionOutboundSmsError("blocked_due_to_deletion")
    );
    const { sendSMS } = await import("./twilio");
    await expect(
      sendSMS({
        to: "+15551234567",
        body: "hello",
        lastOutbound: { clerkUserId: "user_race", messageKind: "weekly" },
      })
    ).rejects.toBeInstanceOf(AccountDeletionOutboundSmsError);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("11. missing clerkUserId fails closed without Twilio", async () => {
    const { sendSMS } = await import("./twilio");
    await expect(
      sendSMS({
        to: "+15551234567",
        body: "hello",
      })
    ).rejects.toMatchObject({
      code: "missing_clerk_user_id_for_outbound_sms",
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(assertOutboundMock).not.toHaveBeenCalled();
  });
});
