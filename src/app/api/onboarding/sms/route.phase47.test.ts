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

  it("documents duplicate-send risk without adding a latch", () => {
    const src = fs.readFileSync(ROUTE_PATH, "utf8");
    expect(src).toContain("DUPLICATE-SEND RISK");
    expect(src).toContain("sent-once latch");
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

function makeSupabaseFrom() {
  return vi.fn((table: string) => {
    if (table === "v2_commitment") {
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              limit: () => ({
                maybeSingle: vi.fn(async () => ({ data: { id: "cmt_onb" }, error: null })),
              }),
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

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: fromMock,
  },
}));

describe("Phase 4.7 — onboarding SMS POST (integration-shaped)", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    fromMock.mockImplementation(makeSupabaseFrom());
    authMock.mockResolvedValue({ userId: "user_onb_1" });
    getClerkPublicMetadataMock.mockResolvedValue({ onboardingCompleted: false });
    updateClerkPublicMetadataMock.mockResolvedValue(undefined);
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
});
