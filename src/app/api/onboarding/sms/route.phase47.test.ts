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

const REMOVED_WELCOME_COPY = [
  "So awesome to meet you",
  "I will text you about your current goal. All you have to do is reply honestly to the check-ins.",
  "Message frequency varies. Msg & data rates may apply. Reply STOP to opt out. Reply HELP for help.",
];

describe("Onboarding SMS route — no outbound send (static)", () => {
  it("route source does not reference relationship voice / NS / FVG / refine entrypoints", () => {
    const src = fs.readFileSync(ROUTE_PATH, "utf8");
    for (const needle of BANNED_RELATIONSHIP_IMPORTS) {
      expect(src.includes(needle), `unexpected reference: ${needle}`).toBe(false);
    }
    expect(src).not.toMatch(/from\s+["']@\/lib\/v3-daily-relationship-lane["']/);
    expect(src).not.toMatch(/from\s+["']@\/lib\/north-star-coach-sms-openai["']/);
    expect(src).not.toMatch(/from\s+["']@\/lib\/v3-sms-voice-ownership["']/);
  });

  it("does not send a welcome, confirmation, or replacement onboarding SMS", () => {
    const src = fs.readFileSync(ROUTE_PATH, "utf8");
    expect(src).not.toMatch(/\bsendSMS\s*\(/);
    expect(src).not.toContain("isTwilioReady");
    expect(src).not.toMatch(/from\s+["']@\/lib\/twilio["']/);
    for (const needle of REMOVED_WELCOME_COPY) {
      expect(src).not.toContain(needle);
    }
    expect(src).not.toContain("You're all set");
    expect(src).not.toContain("onboarding_consent_sms_sent");
    expect(src).not.toContain("buildOnboardingTransactionalSmsDeliverySnapshot");
  });

  it("does not write a fake consent-SMS success latch", () => {
    const src = fs.readFileSync(ROUTE_PATH, "utf8");
    expect(src).not.toContain("onboardingTransactionalConsentLatchFields");
    expect(src).not.toContain("onboardingTransactionalConsentSmsSentAt");
    expect(src).not.toContain("onboardingTransactionalConsentSmsPhoneE164");
    expect(src).not.toContain("shouldSkipOnboardingTransactionalConsentSms");
  });

  it("does not manually seed sms_last_outbound_context", () => {
    const src = fs.readFileSync(ROUTE_PATH, "utf8");
    expect(src).not.toContain("sms_last_outbound_context");
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

  it("still persists consent, phone, identity, delivery state, and audience", () => {
    const src = fs.readFileSync(ROUTE_PATH, "utf8");
    expect(src).toContain("smsEnabled");
    expect(src).toContain("smsTimePreference");
    expect(src).toContain("phoneNumber");
    expect(src).toContain("smsDisclosureAccepted");
    expect(src).toContain("smsStopHelpDisclosureShownAt");
    expect(src).toContain("loadOrCreateSmsDeliveryState");
    expect(src).toContain("sms_identities");
    expect(src).toContain("syncSmsAudience");
  });

  it("does not write v2_commitment_sms_thread_memory or use sms_send_events", () => {
    const src = fs.readFileSync(ROUTE_PATH, "utf8");
    expect(src).not.toContain("v2_commitment_sms_thread_memory");
    expect(src).not.toContain("sms_send_events");
  });

  it("keeps APP-041B2b second deletion check after identity/phone work", () => {
    const src = fs.readFileSync(ROUTE_PATH, "utf8");
    expect(src).toContain("second check after identity/phone work");
    expect(src).toContain("evaluateOutboundSmsForAccountDeletion");
    expect(src).toContain("isAccountDeletionOutboundSmsError");
    const identityUpsertIdx = src.indexOf("stopped_at: null");
    const deletionCheckIdx = src.indexOf("second check after identity/phone work");
    const audienceIdx = src.indexOf("await syncSmsAudience");
    expect(identityUpsertIdx).toBeGreaterThan(-1);
    expect(deletionCheckIdx).toBeGreaterThan(identityUpsertIdx);
    expect(audienceIdx).toBeGreaterThan(deletionCheckIdx);
  });

  it("SMS client still continues to Complete after a successful save", () => {
    const client = fs.readFileSync(
      path.join(REPO_ROOT, "src/app/onboarding/sms/sms-client.tsx"),
      "utf8"
    );
    expect(client).toContain('fetch("/api/onboarding/sms"');
    expect(client).toContain('router.push("/onboarding/complete")');
  });

  it("Complete still requires SMS consent and still activates onboarding", () => {
    const complete = fs.readFileSync(
      path.join(REPO_ROOT, "src/app/api/onboarding/complete/route.ts"),
      "utf8"
    );
    expect(complete).toContain("hasValidSmsConsent");
    expect(complete).toContain("SMS consent is required before finishing onboarding");
    expect(complete).toContain("runSobCompleteOnboardingActivation");
    expect(complete).toContain("onboardingCompleted: true");
    expect(complete).not.toMatch(/\bsendSMS\s*\(/);
  });

  it("Morning/Evening/Weekly TTO send paths are unchanged by this slice", () => {
    const daily = fs.readFileSync(
      path.join(REPO_ROOT, "src/app/api/cron/daily-sms/route.ts"),
      "utf8"
    );
    const evening = fs.readFileSync(
      path.join(REPO_ROOT, "src/app/api/cron/evening-sms/route.ts"),
      "utf8"
    );
    const weekly = fs.readFileSync(
      path.join(REPO_ROOT, "src/app/api/cron/weekly-sms/route.ts"),
      "utf8"
    );
    expect(daily).toContain("[07:00, 09:00)");
    expect(daily).toMatch(/\bsendSMS\s*\(/);
    expect(evening).toContain("[19:00, 21:00)");
    expect(weekly).toContain("weekly-sms is Weekly TTO draft-authoritative");
    expect(weekly).toContain("sendWeeklyTtoDraftAuthoritative");
  });

  it("inbound STOP/HELP/START still resolve identity via sms_identities", () => {
    const inbound = fs.readFileSync(
      path.join(REPO_ROOT, "src/app/api/twilio/inbound/route.ts"),
      "utf8"
    );
    expect(inbound).toContain("You have been unsubscribed. Reply START to rejoin.");
    expect(inbound).toContain("HELP_TWIML_BODY");
    expect(inbound).toContain("START_TWIML_BODY");
    expect(inbound).toContain("sms_identities");
  });

  it("inbound Coach can proceed without a prior onboarding last-outbound row", () => {
    const coach = fs.readFileSync(
      path.join(REPO_ROOT, "src/app/api/cron/sms-inbound-coach/route.ts"),
      "utf8"
    );
    expect(coach).toContain("sms_last_outbound_context");
    expect(coach).toContain(".maybeSingle()");
    expect(coach).toMatch(
      /typeof lastCtx\?\.full_body === "string" \? lastCtx\.full_body : ""/
    );
  });

  it("activation analytics still require check_sent, not onboarding welcome", () => {
    const activation = fs.readFileSync(
      path.join(REPO_ROOT, "src/lib/admin-growth-activation.ts"),
      "utf8"
    );
    expect(activation).toContain('.eq("event_type", "check_sent")');
    expect(activation).not.toContain("onboardingTransactionalConsentSmsSentAt");
    expect(activation).not.toContain("So awesome to meet you");
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

vi.mock("@/lib/account-deletion/deletion-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/account-deletion/deletion-guards")>();
  return {
    ...actual,
    hasUnresolvedAccountDeletionRequest: vi.fn(async () => false),
    evaluateOutboundSmsForAccountDeletion: vi.fn(async () => ({
      decision: "allowed" as const,
    })),
  };
});

const loadOrCreateSmsDeliveryStateMock = vi.hoisted(() =>
  vi.fn(async () => ({ data: {}, error: null }))
);
vi.mock("@/lib/sms-daily-delivery-body", () => ({
  loadOrCreateSmsDeliveryState: (...args: unknown[]) =>
    loadOrCreateSmsDeliveryStateMock(...args),
}));

const sendSMSMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/twilio", () => ({
  sendSMS: (...args: unknown[]) => sendSMSMock(...args),
  isTwilioReady: () => true,
}));

type SupabaseSmsMockOptions = {
  proposed?: { id: string } | null;
  active?: { id: string } | null;
  reviewAcknowledgedAt?: string | null;
  intakeMissing?: boolean;
};

const smsIdentitiesUpsertMock = vi.hoisted(() => vi.fn(async () => ({ error: null })));

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
        upsert: smsIdentitiesUpsertMock,
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

const VALID_SMS_BODY = {
  smsEnabled: true,
  smsDisclosureAccepted: true,
  phoneNumber: "5551234567",
};

describe("Onboarding SMS POST — persist consent, no send", () => {
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
    loadOrCreateSmsDeliveryStateMock.mockResolvedValue({ data: {}, error: null });
    smsIdentitiesUpsertMock.mockResolvedValue({ error: null });
    sendSMSMock.mockResolvedValue({ sid: "SM_should_not_send" });
    const { evaluateOutboundSmsForAccountDeletion, hasUnresolvedAccountDeletionRequest } =
      await import("@/lib/account-deletion/deletion-guards");
    vi.mocked(evaluateOutboundSmsForAccountDeletion).mockResolvedValue({
      decision: "allowed",
    });
    vi.mocked(hasUnresolvedAccountDeletionRequest).mockResolvedValue(false);
  });

  it("returns 200 for valid onboarding SMS setup without sendSMS", async () => {
    const { POST } = await import("./route");
    const res = await POST(postOnboardingSms(VALID_SMS_BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendSMSMock).not.toHaveBeenCalled();
  });

  it("persists phone, smsEnabled, consent, time preference, and disclosure timestamp", async () => {
    const { POST } = await import("./route");
    const res = await POST(postOnboardingSms(VALID_SMS_BODY));
    expect(res.status).toBe(200);

    const persistCall = updateClerkPublicMetadataMock.mock.calls.find((call) => {
      const fields = call[1] as Record<string, unknown>;
      return fields.smsEnabled === true;
    });
    expect(persistCall).toBeTruthy();
    expect(persistCall![1]).toMatchObject({
      smsEnabled: true,
      smsTimePreference: "morning",
      phoneNumber: "+15551234567",
      smsDisclosureAccepted: true,
    });
    const fields = persistCall![1] as Record<string, unknown>;
    expect(typeof fields.smsStopHelpDisclosureShownAt).toBe("string");
    expect(String(fields.smsStopHelpDisclosureShownAt).length).toBeGreaterThan(0);
    expect(fields.onboardingTransactionalConsentSmsSentAt).toBeUndefined();
    expect(fields.onboardingTransactionalConsentSmsPhoneE164).toBeUndefined();
  });

  it("initializes sms_delivery_state and upserts sms_identities", async () => {
    const { POST } = await import("./route");
    const res = await POST(postOnboardingSms(VALID_SMS_BODY));
    expect(res.status).toBe(200);
    expect(loadOrCreateSmsDeliveryStateMock).toHaveBeenCalledWith("user_onb_1");
    expect(smsIdentitiesUpsertMock).toHaveBeenCalledWith({
      phone_number: "+15551234567",
      clerk_user_id: "user_onb_1",
      sms_enabled: true,
      stopped_at: null,
    });
  });

  it("syncSmsAudience still runs and is not gated on Twilio", async () => {
    const { POST } = await import("./route");
    const res = await POST(postOnboardingSms(VALID_SMS_BODY));
    expect(res.status).toBe(200);
    expect(syncSmsAudienceMock).toHaveBeenCalledTimes(1);
    expect(syncSmsAudienceMock).toHaveBeenCalledWith({
      userId: "user_onb_1",
      phoneNumber: "+15551234567",
      smsEnabled: true,
      timezone: null,
      smsTimePreference: "morning",
      summittSubscribed: null,
    });
  });

  it("returns 400 when smsEnabled without smsDisclosureAccepted", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      postOnboardingSms({
        smsEnabled: true,
        smsDisclosureAccepted: false,
        phoneNumber: "5551234567",
      })
    );
    expect(res.status).toBe(400);
    expect(sendSMSMock).not.toHaveBeenCalled();
    expect(updateClerkPublicMetadataMock).not.toHaveBeenCalled();
    expect(syncSmsAudienceMock).not.toHaveBeenCalled();
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
    const res = await POST(postOnboardingSms(VALID_SMS_BODY));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Please review your Identity and Current Goal");
    expect(updateClerkPublicMetadataMock).not.toHaveBeenCalled();
    expect(sendSMSMock).not.toHaveBeenCalled();
    expect(syncSmsAudienceMock).not.toHaveBeenCalled();
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
    const res = await POST(postOnboardingSms(VALID_SMS_BODY));
    expect(res.status).toBe(200);
    expect(updateClerkPublicMetadataMock).toHaveBeenCalled();
    expect(syncSmsAudienceMock).toHaveBeenCalledTimes(1);
    expect(sendSMSMock).not.toHaveBeenCalled();
  });

  it("repeated same phone still 200 and never sends", async () => {
    const { POST } = await import("./route");
    const res1 = await POST(postOnboardingSms(VALID_SMS_BODY));
    expect(res1.status).toBe(200);
    const res2 = await POST(postOnboardingSms(VALID_SMS_BODY));
    expect(res2.status).toBe(200);
    expect(sendSMSMock).not.toHaveBeenCalled();
    expect(syncSmsAudienceMock).toHaveBeenCalledTimes(2);
    expect(clerkMetadataState.value.onboardingTransactionalConsentSmsSentAt).toBeUndefined();
  });

  it("APP-041B2b blocked_due_to_deletion → 409, no send, no latch, no audience sync", async () => {
    const { evaluateOutboundSmsForAccountDeletion } = await import(
      "@/lib/account-deletion/deletion-guards"
    );
    vi.mocked(evaluateOutboundSmsForAccountDeletion).mockResolvedValueOnce({
      decision: "blocked_due_to_deletion",
      scope: "unresolved",
    });
    const { POST } = await import("./route");
    const res = await POST(postOnboardingSms(VALID_SMS_BODY));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("account_deletion_in_progress");
    expect(sendSMSMock).not.toHaveBeenCalled();
    expect(syncSmsAudienceMock).not.toHaveBeenCalled();
    expect(clerkMetadataState.value.onboardingTransactionalConsentSmsSentAt).toBeUndefined();
  });

  it("APP-041B2b lookup_failed → 500 retryable, not deletion-in-progress", async () => {
    const { evaluateOutboundSmsForAccountDeletion } = await import(
      "@/lib/account-deletion/deletion-guards"
    );
    vi.mocked(evaluateOutboundSmsForAccountDeletion).mockResolvedValueOnce({
      decision: "lookup_failed",
    });
    const { POST } = await import("./route");
    const res = await POST(postOnboardingSms(VALID_SMS_BODY));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("sms_temporarily_unavailable");
    expect(json.error).not.toBe("account_deletion_in_progress");
    expect(sendSMSMock).not.toHaveBeenCalled();
    expect(syncSmsAudienceMock).not.toHaveBeenCalled();
    expect(clerkMetadataState.value.onboardingTransactionalConsentSmsSentAt).toBeUndefined();
  });

  it("onboardingCompleted true returns 403 before persistence", async () => {
    clerkMetadataState.value = {
      onboardingCompleted: true,
    };
    const { POST } = await import("./route");
    const res = await POST(postOnboardingSms(VALID_SMS_BODY));
    expect(res.status).toBe(403);
    expect(sendSMSMock).not.toHaveBeenCalled();
    expect(updateClerkPublicMetadataMock).not.toHaveBeenCalled();
    expect(syncSmsAudienceMock).not.toHaveBeenCalled();
  });
});
