import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const REPO_ROOT = process.cwd();
const ROUTE_PATH = path.join(REPO_ROOT, "src/app/api/onboarding/sms/route.ts");

const BANNED_RELATIONSHIP_IMPORTS = [
  "refineMachineSmsBodyWithV3RefineLane",
  "finalizeNorthStarCoachSms",
  "finalizeNorthStarCoachSmsAsync",
  "applyFinalVoiceOwnershipGate",
  "produceWeeklyV3RelationshipSms",
  "produceInboundV3RelationshipSms",
  "v3-daily-relationship-lane",
  "v3_daily_relationship_lane",
];

describe("Phase 4.7 — onboarding SMS transactional exception (static)", () => {
  it("route source does not reference relationship voice / NS / FVG / refine entrypoints", () => {
    const src = fs.readFileSync(ROUTE_PATH, "utf8");
    for (const needle of BANNED_RELATIONSHIP_IMPORTS) {
      expect(src.includes(needle), `unexpected reference: ${needle}`).toBe(false);
    }
    expect(src).not.toMatch(/from\s+["']@\/lib\/v3-daily-relationship-lane["']/);
    expect(src).not.toMatch(/from\s+["']@\/lib\/north-star-coach-sms-openai["']/);
    expect(src).not.toMatch(/from\s+["']@\/lib\/v3-sms-voice-ownership["']/);
  });

  it("confirmation body includes frequency, rates, STOP, and HELP language", () => {
    const src = fs.readFileSync(ROUTE_PATH, "utf8");
    expect(src).toContain("Message frequency varies");
    expect(src).toContain("Msg & data rates may apply");
    expect(src).toContain("Reply STOP to opt out");
    expect(src).toContain("Reply HELP for help");
  });

  it("confirmation body avoids obvious internal coaching route jargon", () => {
    const src = fs.readFileSync(ROUTE_PATH, "utf8");
    expect(src.toLowerCase()).not.toContain("did the rep happen");
    expect(src).not.toContain("blocker_captured");
    expect(src).not.toContain("user_partial");
    expect(src).not.toMatch(/\bV2\b/);
  });

  it("sendSMS lastOutbound wires transactional kind and deliverySnapshot observability keys", () => {
    const src = fs.readFileSync(ROUTE_PATH, "utf8");
    expect(src).toContain('messageKind: "transactional"');
    expect(src).toContain("deliverySnapshot: buildOnboardingTransactionalSmsDeliverySnapshot()");
    expect(src).toContain('relationship_lane_bypass_kind: "onboarding_consent_transactional"');
    expect(src).toContain("transactional_sms: true");
    expect(src).toContain("v3_relationship_voice_used: false");
    expect(src).toContain("north_star_used: false");
    expect(src).toContain("final_voice_gate_used: false");
  });

  it("requires smsDisclosureAccepted when smsEnabled is true", () => {
    const src = fs.readFileSync(ROUTE_PATH, "utf8");
    expect(src).toContain("smsDisclosureAccepted !== true");
  });

  it("requires review_acknowledged_at before SMS when proposed and no active", () => {
    const src = fs.readFileSync(ROUTE_PATH, "utf8");
    expect(src).toContain("review_acknowledged_at");
    expect(src).toContain(
      "Please review your Identity and Current Goal before connecting SMS."
    );
    expect(src).not.toMatch(/\|\s*"needs_why"/);
    expect(src).not.toMatch(/\.from\(["']life_desires/);
    expect(src).not.toContain("/api/onboarding/why");
  });

  it("implements onboarding consent SMS dedupe latch via Clerk metadata", () => {
    const src = fs.readFileSync(ROUTE_PATH, "utf8");
    expect(src).toContain("shouldSkipOnboardingTransactionalConsentSms");
    expect(src).toContain("onboardingTransactionalConsentLatchFields");
    expect(src).toContain("onboarding_consent_sms_deduped");
    expect(src).toContain("onboardingConsentSmsDeduped");
    expect(src).not.toContain("DUPLICATE-SEND RISK");
  });

  it("does not write v2_commitment_sms_thread_memory or use sms_send_events", () => {
    const src = fs.readFileSync(ROUTE_PATH, "utf8");
    expect(src).not.toContain("v2_commitment_sms_thread_memory");
    expect(src).not.toContain("sms_send_events");
  });
});

const authMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

const getClerkPublicMetadataMock = vi.fn();
vi.mock("@/lib/clerk-rest", () => ({
  getClerkPublicMetadata: (...args: unknown[]) => getClerkPublicMetadataMock(...args),
}));

const updateClerkPublicMetadataMock = vi.fn();
vi.mock("@/lib/clerk-public-metadata", () => ({
  updateClerkPublicMetadata: (...args: unknown[]) => updateClerkPublicMetadataMock(...args),
}));

const syncSmsAudienceMock = vi.fn();
vi.mock("@/lib/sms-audience-sync", () => ({
  syncSmsAudience: (...args: unknown[]) => syncSmsAudienceMock(...args),
}));

vi.mock("@/lib/sms-daily-delivery-body", () => ({
  loadOrCreateSmsDeliveryState: vi.fn(async () => ({ data: {}, error: null })),
}));

const sendSMSMock = vi.fn();
const isTwilioReadyMock = vi.fn();
vi.mock("@/lib/twilio", () => ({
  sendSMS: (...args: unknown[]) => sendSMSMock(...args),
  isTwilioReady: () => isTwilioReadyMock(),
}));

type SupabaseSmsMockOptions = {
  proposed?: { id: string } | null;
  active?: { id: string } | null;
  reviewAcknowledgedAt?: string | null;
  intakeMissing?: boolean;
};

function makeSupabaseFrom(options: SupabaseSmsMockOptions = {}) {
  const {
    proposed = null,
    active = { id: "cmt_active" },
    reviewAcknowledgedAt = "2026-05-01T12:00:00.000Z",
    intakeMissing = false,
  } = options;

  return vi.fn((table: string) => {
    if (table === "v2_commitment") {
      return {
        select: () => ({
          eq: () => ({
            eq: (_key: string, status: string) => {
              if (status === "proposed") {
                return {
                  order: () => ({
                    limit: () => ({
                      maybeSingle: vi.fn(async () => ({ data: proposed, error: null })),
                    }),
                  }),
                };
              }
              if (status === "active") {
                return {
                  maybeSingle: vi.fn(async () => ({ data: active, error: null })),
                };
              }
              return {
                maybeSingle: vi.fn(async () => ({ data: null, error: null })),
              };
            },
          }),
        }),
      };
    }
    if (table === "v2_commitment_intake") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: vi.fn(async () => ({
                data: intakeMissing
                  ? null
                  : {
                      commitment_id: proposed?.id ?? "prop_1",
                      review_acknowledged_at: reviewAcknowledgedAt,
                    },
                error: null,
              })),
            }),
          }),
        }),
      };
    }
    if (table === "sms_identities") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          }),
        }),
        upsert: vi.fn(async () => ({ error: null })),
        update: () => ({
          eq: vi.fn(async () => ({ error: null })),
        }),
      };
    }
    return {};
  });
}

const fromMock = vi.hoisted(() => vi.fn());

const clerkMetadataState = vi.hoisted(() => ({
  value: { onboardingCompleted: false } as Record<string, unknown>,
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: fromMock,
  },
}));

function postOnboardingSms(body: Record<string, unknown>) {
  return new Request("http://localhost/api/onboarding/sms", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("Phase 4.7 — onboarding SMS POST (integration-shaped)", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    clerkMetadataState.value = { onboardingCompleted: false };
    fromMock.mockImplementation(makeSupabaseFrom());
    authMock.mockResolvedValue({ userId: "user_onb_1" });
    getClerkPublicMetadataMock.mockImplementation(async () => ({ ...clerkMetadataState.value }));
    updateClerkPublicMetadataMock.mockImplementation(async (_userId, fields) => {
      Object.assign(clerkMetadataState.value, fields);
    });
    syncSmsAudienceMock.mockResolvedValue(undefined);
    sendSMSMock.mockResolvedValue({ sid: "SM_onb_test" });
    isTwilioReadyMock.mockReturnValue(true);
  });

  it("returns 200 without sendSMS when Twilio is not ready (onboarding still succeeds)", async () => {
    isTwilioReadyMock.mockReturnValue(false);
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/sms", {
        method: "POST",
        body: JSON.stringify({
          smsEnabled: true,
          smsDisclosureAccepted: true,
          phoneNumber: "5551234567",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(sendSMSMock).not.toHaveBeenCalled();
  });

  it("returns 200 when sendSMS throws (onboarding still succeeds)", async () => {
    sendSMSMock.mockRejectedValueOnce(new Error("twilio simulated failure"));
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/sms", {
        method: "POST",
        body: JSON.stringify({
          smsEnabled: true,
          smsDisclosureAccepted: true,
          phoneNumber: "5551234567",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(sendSMSMock).toHaveBeenCalled();
  });

  it("sendSMS receives transactional deliverySnapshot metadata when Twilio is ready", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/sms", {
        method: "POST",
        body: JSON.stringify({
          smsEnabled: true,
          smsDisclosureAccepted: true,
          phoneNumber: "5551234567",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(200);
    expect(sendSMSMock).toHaveBeenCalledTimes(1);
    const arg = sendSMSMock.mock.calls[0]![0] as {
      lastOutbound?: { messageKind?: string; deliverySnapshot?: Record<string, unknown> };
    };
    expect(arg.lastOutbound?.messageKind).toBe("transactional");
    expect(arg.lastOutbound?.deliverySnapshot?.transactional_sms).toBe(true);
    expect(arg.lastOutbound?.deliverySnapshot?.relationship_lane_bypass_kind).toBe(
      "onboarding_consent_transactional"
    );
    expect(arg.lastOutbound?.deliverySnapshot?.twilio_send_attempted).toBe(true);
  });

  it("returns 400 when smsEnabled without smsDisclosureAccepted", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/sms", {
        method: "POST",
        body: JSON.stringify({
          smsEnabled: true,
          smsDisclosureAccepted: false,
          phoneNumber: "5551234567",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    expect(sendSMSMock).not.toHaveBeenCalled();
  });

  it("returns 400 when proposed exists but review_acknowledged_at is null", async () => {
    fromMock.mockImplementation(
      makeSupabaseFrom({
        proposed: { id: "prop_1" },
        active: null,
        reviewAcknowledgedAt: null,
      })
    );
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/onboarding/sms", {
        method: "POST",
        body: JSON.stringify({
          smsEnabled: true,
          smsDisclosureAccepted: true,
          phoneNumber: "5551234567",
        }),
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Please review your Identity and Current Goal");
    expect(updateClerkPublicMetadataMock).not.toHaveBeenCalled();
    expect(sendSMSMock).not.toHaveBeenCalled();
  });

  it("proceeds when proposed exists and review_acknowledged_at is set", async () => {
    fromMock.mockImplementation(
      makeSupabaseFrom({
        proposed: { id: "prop_1" },
        active: null,
        reviewAcknowledgedAt: "2026-05-01T12:00:00.000Z",
      })
    );
    const { POST } = await import("./route");
    const res = await POST(
      postOnboardingSms({
        smsEnabled: true,
        smsDisclosureAccepted: true,
        phoneNumber: "5551234567",
      })
    );
    expect(res.status).toBe(200);
    expect(updateClerkPublicMetadataMock).toHaveBeenCalled();
    expect(sendSMSMock).toHaveBeenCalled();
  });

  it("repeated same normalized phone within 24h does not call sendSMS again", async () => {
    const { POST } = await import("./route");
    const body = {
      smsEnabled: true,
      smsDisclosureAccepted: true,
      phoneNumber: "5551234567",
    };

    const res1 = await POST(postOnboardingSms(body));
    expect(res1.status).toBe(200);
    expect(sendSMSMock).toHaveBeenCalledTimes(1);

    sendSMSMock.mockClear();
    const res2 = await POST(postOnboardingSms(body));
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.onboardingConsentSmsDeduped).toBe(true);
    expect(sendSMSMock).not.toHaveBeenCalled();
    expect(syncSmsAudienceMock).toHaveBeenCalledTimes(2);
  });

  it("formatting-only phone difference dedupes to one send", async () => {
    const { POST } = await import("./route");

    await POST(
      postOnboardingSms({
        smsEnabled: true,
        smsDisclosureAccepted: true,
        phoneNumber: "(865) 555-1212",
      })
    );
    expect(sendSMSMock).toHaveBeenCalledTimes(1);

    sendSMSMock.mockClear();
    const res2 = await POST(
      postOnboardingSms({
        smsEnabled: true,
        smsDisclosureAccepted: true,
        phoneNumber: "+18655551212",
      })
    );
    expect(res2.status).toBe(200);
    expect((await res2.json()).onboardingConsentSmsDeduped).toBe(true);
    expect(sendSMSMock).not.toHaveBeenCalled();
  });

  it("genuinely different phone sends again", async () => {
    const { POST } = await import("./route");

    await POST(
      postOnboardingSms({
        smsEnabled: true,
        smsDisclosureAccepted: true,
        phoneNumber: "+18655551212",
      })
    );
    expect(sendSMSMock).toHaveBeenCalledTimes(1);

    sendSMSMock.mockClear();
    await POST(
      postOnboardingSms({
        smsEnabled: true,
        smsDisclosureAccepted: true,
        phoneNumber: "+18655559999",
      })
    );
    expect(sendSMSMock).toHaveBeenCalledTimes(1);
  });

  it("Twilio failure does not latch; retry with same phone sends again", async () => {
    sendSMSMock.mockRejectedValueOnce(new Error("twilio simulated failure"));
    const { POST } = await import("./route");
    const body = {
      smsEnabled: true,
      smsDisclosureAccepted: true,
      phoneNumber: "5551234567",
    };

    await POST(postOnboardingSms(body));
    expect(sendSMSMock).toHaveBeenCalledTimes(1);
    expect(clerkMetadataState.value.onboardingTransactionalConsentSmsSentAt).toBeUndefined();

    sendSMSMock.mockResolvedValue({ sid: "SM_onb_retry" });
    await POST(postOnboardingSms(body));
    expect(sendSMSMock).toHaveBeenCalledTimes(2);
    expect(clerkMetadataState.value.onboardingTransactionalConsentSmsPhoneE164).toBe(
      "+15551234567"
    );
  });

  it("Twilio not ready first does not latch; second request sends", async () => {
    isTwilioReadyMock.mockReturnValueOnce(false).mockReturnValue(true);
    const { POST } = await import("./route");
    const body = {
      smsEnabled: true,
      smsDisclosureAccepted: true,
      phoneNumber: "5551234567",
    };

    await POST(postOnboardingSms(body));
    expect(sendSMSMock).not.toHaveBeenCalled();
    expect(clerkMetadataState.value.onboardingTransactionalConsentSmsSentAt).toBeUndefined();

    await POST(postOnboardingSms(body));
    expect(sendSMSMock).toHaveBeenCalledTimes(1);
  });

  it("old latch outside 24h does not dedupe", async () => {
    clerkMetadataState.value = {
      onboardingCompleted: false,
      onboardingTransactionalConsentSmsSentAt: "2020-01-01T00:00:00.000Z",
      onboardingTransactionalConsentSmsPhoneE164: "+15551234567",
    };
    const { POST } = await import("./route");
    const res = await POST(
      postOnboardingSms({
        smsEnabled: true,
        smsDisclosureAccepted: true,
        phoneNumber: "5551234567",
      })
    );
    expect(res.status).toBe(200);
    expect(sendSMSMock).toHaveBeenCalledTimes(1);
    expect((await res.json()).onboardingConsentSmsDeduped).toBeUndefined();
  });

  it("malformed latch does not dedupe", async () => {
    clerkMetadataState.value = {
      onboardingCompleted: false,
      onboardingTransactionalConsentSmsSentAt: "not-a-date",
      onboardingTransactionalConsentSmsPhoneE164: "+15551234567",
    };
    const { POST } = await import("./route");
    await POST(
      postOnboardingSms({
        smsEnabled: true,
        smsDisclosureAccepted: true,
        phoneNumber: "5551234567",
      })
    );
    expect(sendSMSMock).toHaveBeenCalledTimes(1);
  });

  it("onboardingCompleted true returns 403 before dedupe", async () => {
    clerkMetadataState.value = {
      onboardingCompleted: true,
      onboardingTransactionalConsentSmsSentAt: new Date().toISOString(),
      onboardingTransactionalConsentSmsPhoneE164: "+15551234567",
    };
    const { POST } = await import("./route");
    const res = await POST(
      postOnboardingSms({
        smsEnabled: true,
        smsDisclosureAccepted: true,
        phoneNumber: "5551234567",
      })
    );
    expect(res.status).toBe(403);
    expect(sendSMSMock).not.toHaveBeenCalled();
  });

  it("writes latch fields only after successful sendSMS", async () => {
    const { POST } = await import("./route");
    await POST(
      postOnboardingSms({
        smsEnabled: true,
        smsDisclosureAccepted: true,
        phoneNumber: "5551234567",
      })
    );

    const latchCalls = updateClerkPublicMetadataMock.mock.calls.filter((call) => {
      const fields = call[1] as Record<string, unknown>;
      return fields.onboardingTransactionalConsentSmsSentAt != null;
    });
    expect(latchCalls.length).toBe(1);
    expect(latchCalls[0]![1]).toMatchObject({
      onboardingTransactionalConsentSmsPhoneE164: "+15551234567",
    });
  });
});
