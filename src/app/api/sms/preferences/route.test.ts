import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

const authMock = vi.fn();
const currentUserMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  currentUser: () => currentUserMock(),
}));

const isSmsPrefsUiEnabledMock = vi.fn();
vi.mock("@/lib/sms-preferences-flags", () => ({
  isSmsPrefsUiEnabled: () => isSmsPrefsUiEnabledMock(),
}));

const fetchPrefsMock = vi.fn();
const upsertPrefsMock = vi.fn();
vi.mock("@/lib/v2-sms-comms-preferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-sms-comms-preferences")>();
  return {
    ...actual,
    fetchV2UserSmsCommsPreferences: (...args: unknown[]) => fetchPrefsMock(...args),
    upsertV2UserSmsCommsPreferences: (...args: unknown[]) => upsertPrefsMock(...args),
  };
});

const getActiveCommitmentMock = vi.fn();
vi.mock("@/lib/v2-commitment", () => ({
  getActiveCommitment: (...args: unknown[]) => getActiveCommitmentMock(...args),
}));

describe("/api/sms/preferences", () => {
  const clerkUser = {
    id: "user_1",
    publicMetadata: {
      smsEnabled: true,
      phoneNumber: "+15551234567",
      smsTimePreference: "morning",
      timezone: "America/New_York",
      smsDisclosureAccepted: true,
    },
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user_1" });
    currentUserMock.mockResolvedValue(clerkUser);
    isSmsPrefsUiEnabledMock.mockReturnValue(true);
    fetchPrefsMock.mockResolvedValue(null);
    getActiveCommitmentMock.mockResolvedValue({
      accountability_phase: "active_accountability",
    });
    upsertPrefsMock.mockResolvedValue({
      ok: true,
      row: {
        clerk_user_id: "user_1",
        pause_until: null,
        pause_reason_category: null,
        cadence_override: "every_other_day",
        weekend_send_policy: "weekdays_only",
        preferred_send_window: "morning",
        preferred_local_hour: null,
        source_message_sid: null,
        resume_prompt_sent_at: null,
        created_at: "",
        updated_at: "",
      },
    });
  });

  afterEach(() => {
    delete process.env.SMS_PREFS_UI_ENABLED;
  });

  it("GET 401 without auth", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("GET 404 when flag off", async () => {
    isSmsPrefsUiEnabledMock.mockReturnValue(false);
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("GET returns sanitized merged model when flag on", async () => {
    fetchPrefsMock.mockResolvedValue({
      clerk_user_id: "user_1",
      pause_until: null,
      pause_reason_category: null,
      cadence_override: null,
      weekend_send_policy: null,
      preferred_send_window: null,
      preferred_local_hour: null,
      source_message_sid: "SM123",
      resume_prompt_sent_at: null,
      created_at: "",
      updated_at: "",
    });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.smsEnabled).toBe(true);
    expect(body.phoneMasked).toBe("(***) ***-4567");
    expect(body.source_message_sid).toBeUndefined();
    expect(body.confidence).toBeUndefined();
    expect(body.effectiveTimingLabel).toBeUndefined();
    expect(body.effectiveTimingSource).toBeUndefined();
    expect(body.preferredSendWindow).toBeUndefined();
    expect(body.preferredLocalHour).toBeUndefined();
  });

  it("PATCH 401 without auth", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ clearPause: true }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("PATCH 404 when flag off", async () => {
    isSmsPrefsUiEnabledMock.mockReturnValue(false);
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ clearPause: true }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("PATCH rejects unknown fields", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ phoneNumber: "+15559999999" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("PATCH rejects opted-out user for setting preferences", async () => {
    currentUserMock.mockResolvedValue({
      ...clerkUser,
      publicMetadata: { ...clerkUser.publicMetadata, smsEnabled: false },
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ weekend_send_policy: "weekdays_only" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("PATCH permits safe clear-only behavior when opted out", async () => {
    currentUserMock.mockResolvedValue({
      ...clerkUser,
      publicMetadata: { ...clerkUser.publicMetadata, smsEnabled: false },
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ clearPause: true }),
      })
    );
    expect(res.status).toBe(200);
    expect(upsertPrefsMock).toHaveBeenCalled();
  });

  it("PATCH calls upsert with allowlisted fields only", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({
          cadence_override: "every_other_day",
          weekend_send_policy: "weekdays_only",
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(upsertPrefsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: "user_1",
        patch: expect.objectContaining({
          cadence_override: "every_other_day",
          weekend_send_policy: "weekdays_only",
        }),
      })
    );
    const patchArg = upsertPrefsMock.mock.calls[0]?.[0] as { patch: Record<string, unknown> };
    expect(patchArg.patch).not.toHaveProperty("preferred_send_window");
    expect(patchArg.patch).not.toHaveProperty("preferred_local_hour");
    expect(patchArg.patch).not.toHaveProperty("source_message_sid");
    expect(patchArg.patch).not.toHaveProperty("sms_enabled");
  });

  it("PATCH rejects preferred_send_window from app", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ preferred_send_window: "morning" }),
      })
    );
    expect(res.status).toBe(400);
    expect(upsertPrefsMock).not.toHaveBeenCalled();
  });

  it("PATCH rejects preferred_local_hour from app", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ preferred_local_hour: 9 }),
      })
    );
    expect(res.status).toBe(400);
    expect(upsertPrefsMock).not.toHaveBeenCalled();
  });

  it("PATCH does not touch Clerk, sms_audience, Twilio, or V3", async () => {
    const routeSrc = await import("node:fs").then((fs) =>
      fs.readFileSync("src/app/api/sms/preferences/route.ts", "utf8")
    );
    expect(routeSrc).not.toContain("updateClerkPublicMetadata");
    expect(routeSrc).not.toContain("syncSmsAudience");
    expect(routeSrc).not.toContain("twilio");
    expect(routeSrc).not.toContain("OPENAI");
    expect(routeSrc).not.toContain("fetchV2UserSendTimeProfile");
    expect(routeSrc).not.toContain("v3-inbound");
  });
});
