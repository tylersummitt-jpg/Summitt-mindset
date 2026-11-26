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

const readPrefsMock = vi.fn();
const fetchPrefsMock = vi.fn();
const upsertPrefsMock = vi.fn();
vi.mock("@/lib/v2-sms-comms-preferences", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-sms-comms-preferences")>();
  return {
    ...actual,
    readV2UserSmsCommsPreferences: (...args: unknown[]) => readPrefsMock(...args),
    fetchV2UserSmsCommsPreferences: (...args: unknown[]) => fetchPrefsMock(...args),
    upsertV2UserSmsCommsPreferences: (...args: unknown[]) => upsertPrefsMock(...args),
  };
});

const deletionDecisionMock = vi.fn();
vi.mock("@/lib/account-deletion/deletion-guards", () => ({
  evaluateEntitlementRestorationForAccountDeletion: (...args: unknown[]) =>
    deletionDecisionMock(...args),
}));

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
    readPrefsMock.mockResolvedValue({ ok: true, row: null });
    fetchPrefsMock.mockResolvedValue(null);
    deletionDecisionMock.mockResolvedValue({ decision: "allowed" });
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

  it("GET 401 without auth", async () => {
    authMock.mockResolvedValue({ userId: null });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("GET does not require SMS_PREFS_UI_ENABLED", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.preferenceRecordPresent).toBe(false);
    expect(body.weeklyScheduleExplicit).toBe(false);
    expect(upsertPrefsMock).not.toHaveBeenCalled();
  });

  it("GET returns sanitized merged model when a preference row exists", async () => {
    readPrefsMock.mockResolvedValue({
      ok: true,
      row: {
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
      },
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

  it("PATCH does not require SMS_PREFS_UI_ENABLED", async () => {
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
    const arg = upsertPrefsMock.mock.calls[0]?.[0] as {
      clearPause?: boolean;
      clearIndefinitePause?: boolean;
    };
    expect(arg.clearPause).toBe(true);
    expect(arg.clearIndefinitePause).toBeUndefined();
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
    expect(routeSrc).not.toContain("isSmsPrefsUiEnabled");
    expect(routeSrc).not.toContain("SMS_PREFS_UI_ENABLED");
  });

  it("GET distinguishes a failed read from a missing preference row", async () => {
    readPrefsMock.mockResolvedValue({ ok: false, error: "db down" });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.weeklyScheduleExplicit).toBeUndefined();
    expect(upsertPrefsMock).not.toHaveBeenCalled();
  });

  it("GET returns saved preferences when the commitment lookup throws", async () => {
    getActiveCommitmentMock.mockRejectedValue(new Error("commitment down"));
    readPrefsMock.mockResolvedValue({
      ok: true,
      row: {
        clerk_user_id: "user_1",
        pause_until: null,
        pause_reason_category: null,
        cadence_override: null,
        weekend_send_policy: null,
        preferred_send_window: null,
        preferred_local_hour: null,
        source_message_sid: null,
        resume_prompt_sent_at: null,
        created_at: "",
        updated_at: "",
        pause_indefinite: true,
        schedule_timezone: "America/Chicago",
      },
    });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.commitmentKnown).toBe(false);
    expect(body.pauseIndefinite).toBe(true);
    expect(body.scheduleTimezone).toBe("America/Chicago");
    expect(body.lowPressureActive).toBe(false);
    expect(body.refreshRequired).toBeUndefined();
  });

  it("GET returns an explicit schedule and keeps a nonstandard time zone", async () => {
    readPrefsMock.mockResolvedValue({
      ok: true,
      row: {
        clerk_user_id: "user_1",
        pause_until: null,
        pause_reason_category: null,
        cadence_override: "every_other_day",
        weekend_send_policy: "weekdays_only",
        preferred_send_window: "morning",
        preferred_local_hour: 8,
        source_message_sid: "SM123",
        resume_prompt_sent_at: null,
        weekly_schedule: {
          monday: 420,
          tuesday: null,
          wednesday: 510,
          thursday: null,
          friday: null,
          saturday: null,
          sunday: null,
        },
        schedule_timezone: "Europe/Paris",
        pause_indefinite: false,
        created_at: "",
        updated_at: "",
      },
    });
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.weeklyScheduleExplicit).toBe(true);
    expect(body.weeklySchedule.tuesday).toBeNull();
    expect(body.weeklySchedule.wednesday).toBe(510);
    expect(body.scheduleTimezone).toBe("Europe/Paris");
    expect(body.effectiveTimezone).toBe("Europe/Paris");
    expect(body.cadenceOverride).toBe("every_other_day");
    expect(body.preferredLocalHour).toBeUndefined();
    expect(upsertPrefsMock).not.toHaveBeenCalled();
  });

  it("GET treats seven null days as an explicit off schedule, not the default", async () => {
    readPrefsMock.mockResolvedValue({
      ok: true,
      row: {
        clerk_user_id: "user_1",
        pause_until: null,
        pause_reason_category: null,
        cadence_override: null,
        weekend_send_policy: null,
        preferred_send_window: null,
        preferred_local_hour: null,
        source_message_sid: null,
        resume_prompt_sent_at: null,
        weekly_schedule: {
          monday: null,
          tuesday: null,
          wednesday: null,
          thursday: null,
          friday: null,
          saturday: null,
          sunday: null,
        },
        schedule_timezone: null,
        pause_indefinite: false,
        created_at: "",
        updated_at: "",
      },
    });
    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();
    expect(body.weeklyScheduleExplicit).toBe(true);
    expect(body.weeklySchedule.monday).toBeNull();
    expect(body.applicationPauseActive).toBe(false);
  });

  it("PATCH persists a schedule and time zone together without pause fields", async () => {
    const schedule = {
      monday: 420,
      tuesday: 435,
      wednesday: null,
      thursday: 1260,
      friday: 540,
      saturday: null,
      sunday: 0,
    };
    upsertPrefsMock.mockResolvedValue({
      ok: true,
      row: {
        clerk_user_id: "user_1",
        pause_until: "2026-12-01T11:00:00.000Z",
        pause_reason_category: "travel",
        cadence_override: "every_other_day",
        weekend_send_policy: "weekdays_only",
        preferred_send_window: "morning",
        preferred_local_hour: 8,
        source_message_sid: "SM123",
        resume_prompt_sent_at: null,
        weekly_schedule: schedule,
        schedule_timezone: "America/Chicago",
        pause_indefinite: true,
        created_at: "",
        updated_at: "",
      },
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ weekly_schedule: schedule, schedule_timezone: "America/Chicago" }),
      })
    );
    expect(res.status).toBe(200);
    const patchArg = upsertPrefsMock.mock.calls[0]?.[0] as {
      clerkUserId: string;
      patch: Record<string, unknown>;
      clearPause?: boolean;
    };
    expect(patchArg.clerkUserId).toBe("user_1");
    expect(patchArg.patch.weekly_schedule).toEqual(schedule);
    expect(patchArg.patch.schedule_timezone).toBe("America/Chicago");
    expect(patchArg.patch).not.toHaveProperty("pause_indefinite");
    expect(patchArg.patch).not.toHaveProperty("pause_until");
    expect(patchArg.patch).not.toHaveProperty("cadence_override");
    expect(patchArg.clearPause).toBeUndefined();
    const body = await res.json();
    expect(body.weeklySchedule).toEqual(schedule);
    expect(body.effectiveTimezone).toBe("America/Chicago");
    expect(body.cadenceOverride).toBe("every_other_day");
    expect(body.pauseIndefinite).toBe(true);
  });

  it("PATCH timezone-only does not write a weekly schedule", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ schedule_timezone: "America/Phoenix" }),
      })
    );
    expect(res.status).toBe(200);
    const patchArg = upsertPrefsMock.mock.calls[0]?.[0] as { patch: Record<string, unknown> };
    expect(patchArg.patch).toEqual({ schedule_timezone: "America/Phoenix" });
  });

  it("PATCH rejects invalid schedules and time zones without writing", async () => {
    const { PATCH } = await import("./route");
    const cases = [
      { weekly_schedule: { monday: 1440 } },
      { weekly_schedule: { monday: 7.5 } },
      { weekly_schedule: { monday: "420" } },
      { weekly_schedule: { monday: 420, extra: 1 } },
      { weekly_schedule: [] },
      { schedule_timezone: "Not/A Zone" },
      { schedule_timezone: "Eastern" },
    ];
    for (const body of cases) {
      upsertPrefsMock.mockClear();
      const res = await PATCH(
        new Request("http://localhost/api/sms/preferences", {
          method: "PATCH",
          body: JSON.stringify(body),
        })
      );
      expect(res.status).toBe(400);
      expect(upsertPrefsMock).not.toHaveBeenCalled();
    }
  });

  it("PATCH accepts a non-quarter-hour minute and rejects another member id", async () => {
    const { PATCH } = await import("./route");
    const ok = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({
          weekly_schedule: {
            monday: 421,
            tuesday: null,
            wednesday: null,
            thursday: null,
            friday: null,
            saturday: null,
            sunday: null,
          },
        }),
      })
    );
    expect(ok.status).toBe(200);
    const rejected = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ clerk_user_id: "user_2", clearPause: true }),
      })
    );
    expect(rejected.status).toBe(400);
  });

  it("PATCH pause and resume do not include the schedule", async () => {
    const { PATCH } = await import("./route");
    const paused = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ account_pause: "indefinite" }),
      })
    );
    expect(paused.status).toBe(200);
    expect(upsertPrefsMock.mock.calls[0]?.[0]).toEqual({
      clerkUserId: "user_1",
      patch: { pause_indefinite: true },
      clearPause: undefined,
      clearCadenceOverride: undefined,
      clearIndefinitePause: undefined,
    });

    upsertPrefsMock.mockClear();
    const resumed = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ account_pause: "resume" }),
      })
    );
    expect(resumed.status).toBe(200);
    expect(upsertPrefsMock.mock.calls[0]?.[0]).toMatchObject({
      clerkUserId: "user_1",
      clearPause: true,
      clearIndefinitePause: true,
      patch: {},
    });
    const resumeArg = upsertPrefsMock.mock.calls[0]?.[0] as { patch: Record<string, unknown> };
    expect(resumeArg.patch).not.toHaveProperty("weekly_schedule");
    expect(resumeArg.patch).not.toHaveProperty("schedule_timezone");
  });

  it("PATCH resume cannot restore SMS after STOP", async () => {
    currentUserMock.mockResolvedValue({
      ...clerkUser,
      publicMetadata: { ...clerkUser.publicMetadata, smsEnabled: false },
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ account_pause: "resume" }),
      })
    );
    expect(res.status).toBe(403);
    expect(upsertPrefsMock).not.toHaveBeenCalled();
  });

  it("PATCH does not write preferences for a deletion-blocked account", async () => {
    deletionDecisionMock.mockResolvedValue({
      decision: "blocked_due_to_deletion",
      scope: "unresolved",
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ account_pause: "indefinite" }),
      })
    );
    expect(res.status).toBe(409);
    expect(upsertPrefsMock).not.toHaveBeenCalled();
  });

  it("PATCH refuses to save when the deletion check cannot be read", async () => {
    deletionDecisionMock.mockResolvedValue({ decision: "lookup_failed" });
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ schedule_timezone: "America/Chicago" }),
      })
    );
    expect(res.status).toBe(503);
    expect(upsertPrefsMock).not.toHaveBeenCalled();
  });

  it("PATCH reports a failed preference write as failed", async () => {
    upsertPrefsMock.mockResolvedValue({
      ok: false,
      row: null,
      error: "check violation",
      persistence: "rejected",
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ account_pause: "indefinite" }),
      })
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.persistence).toBe("failed");
    expect(body.preferencesPersisted).toBeUndefined();
  });

  it("PATCH keeps a successful write when the commitment lookup fails", async () => {
    getActiveCommitmentMock.mockRejectedValue(new Error("commitment down"));
    upsertPrefsMock.mockResolvedValue({
      ok: true,
      row: {
        clerk_user_id: "user_1",
        pause_until: null,
        pause_reason_category: null,
        cadence_override: null,
        weekend_send_policy: null,
        preferred_send_window: null,
        preferred_local_hour: null,
        source_message_sid: null,
        resume_prompt_sent_at: null,
        created_at: "",
        updated_at: "",
        pause_indefinite: true,
        schedule_timezone: "America/Chicago",
      },
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ account_pause: "indefinite" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.preferencesPersisted).toBe(true);
    expect(body.refreshRequired).toBe(false);
    expect(body.persistence).toBe("confirmed");
    expect(body.commitmentKnown).toBe(false);
    expect(body.pauseIndefinite).toBe(true);
    expect(body.scheduleTimezone).toBe("America/Chicago");
    expect(body.error).toBeUndefined();
  });

  it("PATCH reports an interrupted preference write as uncertain", async () => {
    upsertPrefsMock.mockRejectedValue(new Error("socket hangup"));
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ schedule_timezone: "America/Chicago" }),
      })
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.persistence).toBe("uncertain");
    expect(body.preferencesPersisted).toBeUndefined();
  });

  it("PATCH treats a missing returned row as an uncertain write", async () => {
    upsertPrefsMock.mockResolvedValue({
      ok: false,
      row: null,
      error: "Preference save did not return a row",
      persistence: "uncertain",
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/sms/preferences", {
        method: "PATCH",
        body: JSON.stringify({ schedule_timezone: "America/Chicago" }),
      })
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.persistence).toBe("uncertain");
    expect(body.preferencesPersisted).toBeUndefined();
    expect(body.ok).toBe(false);
  });
});
