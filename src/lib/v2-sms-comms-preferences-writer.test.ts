import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const row: Record<string, unknown> = {
    clerk_user_id: "user_1",
    pause_until: null,
    pause_reason_category: null,
    cadence_override: null,
    weekend_send_policy: null,
    preferred_send_window: null,
    preferred_local_hour: null,
    source_message_sid: null,
    resume_prompt_sent_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  const selectMaybeSingle = vi.fn(
    async (): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> => ({
      data: null,
      error: null,
    })
  );
  const upsert = vi.fn(
    (
      payload: Record<string, unknown>
    ):
      | { error: { message: string; code?: string } }
      | {
          select: () => {
            maybeSingle: () => Promise<{
              data: Record<string, unknown> | null;
              error: { message: string; code?: string } | null;
            }>;
          };
        } => {
      Object.assign(row, payload);
      return {
        select: () => ({
          maybeSingle: async () => ({ data: { ...row }, error: null }),
        }),
      };
    }
  );

  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: selectMaybeSingle,
      })),
    })),
    upsert,
  }));

  const rpc = vi.fn(async (fn: string, args: { p_patch?: Record<string, unknown> }) => {
    if (fn !== "v2_upsert_sms_comms_preferences") {
      return { data: null, error: { message: `missing_rpc:${fn}`, code: "P0001" } };
    }
    const result = upsert(args.p_patch ?? {});
    if ("error" in result) {
      return { data: null, error: result.error };
    }
    return result.select().maybeSingle();
  });

  return { row, selectMaybeSingle, upsert, from, rpc };
});

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: hoisted.from, rpc: hoisted.rpc },
}));

import {
  applyInboundSmsCommsPreferencesFromMessage,
  clearCommsPreferencesOnSmsResume,
  fetchV2UserSmsCommsPreferences,
  upsertV2UserSmsCommsPreferences,
} from "@/lib/v2-sms-comms-preferences";

describe("v2-sms-comms-preferences writer", () => {
  beforeEach(() => {
    for (const key of Object.keys(hoisted.row)) delete hoisted.row[key];
    Object.assign(hoisted.row, {
      clerk_user_id: "user_1",
      pause_until: null,
      pause_reason_category: null,
      cadence_override: null,
      weekend_send_policy: "weekdays_only",
      preferred_send_window: "morning",
      preferred_local_hour: 7,
      source_message_sid: null,
      resume_prompt_sent_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    hoisted.selectMaybeSingle.mockReset();
    hoisted.selectMaybeSingle.mockImplementation(async () => ({
      data: { ...hoisted.row },
      error: null,
    }));
    hoisted.upsert.mockClear();
  });

  it("upsert pause", async () => {
    const r = await upsertV2UserSmsCommsPreferences({
      clerkUserId: "user_1",
      patch: {
        pause_until: "2026-06-01T11:00:00.000Z",
        pause_reason_category: "travel",
        source_message_sid: "SM1",
      },
    });
    expect(r.ok).toBe(true);
    expect(r.row?.pause_until).toBe("2026-06-01T11:00:00.000Z");
  });

  it("update timing preference", async () => {
    const r = await upsertV2UserSmsCommsPreferences({
      clerkUserId: "user_1",
      patch: { preferred_send_window: "evening", preferred_local_hour: 19 },
    });
    expect(r.ok).toBe(true);
    expect(r.row?.preferred_send_window).toBe("evening");
  });

  it("clear pause", async () => {
    hoisted.row.pause_until = "2026-06-01T11:00:00.000Z";
    const r = await upsertV2UserSmsCommsPreferences({
      clerkUserId: "user_1",
      patch: { source_message_sid: "SM2" },
      clearPause: true,
    });
    expect(r.ok).toBe(true);
    expect(r.row?.pause_until).toBeNull();
    const payload = hoisted.upsert.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("pause_indefinite");
  });

  it("clear pause does not clear an indefinite scheduled-text pause", async () => {
    hoisted.row.pause_until = "2026-06-01T11:00:00.000Z";
    hoisted.row.pause_indefinite = true;
    await upsertV2UserSmsCommsPreferences({
      clerkUserId: "user_1",
      patch: { source_message_sid: "SM2" },
      clearPause: true,
    });
    const payload = hoisted.upsert.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload.pause_until).toBeNull();
    expect(payload).not.toHaveProperty("pause_indefinite");
    expect(hoisted.row.pause_indefinite).toBe(true);
  });

  it("only an explicit indefinite-pause clear removes pause_indefinite", async () => {
    hoisted.row.pause_indefinite = true;
    await upsertV2UserSmsCommsPreferences({
      clerkUserId: "user_1",
      patch: {},
      clearPause: true,
      clearIndefinitePause: true,
    });
    const payload = hoisted.upsert.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload.pause_until).toBeNull();
    expect(payload.pause_indefinite).toBe(false);
  });

  it("ordinary daily conversation does not clear an indefinite pause", async () => {
    hoisted.row.pause_indefinite = true;
    hoisted.row.pause_until = "2026-06-01T11:00:00.000Z";
    await applyInboundSmsCommsPreferencesFromMessage({
      clerkUserId: "user_1",
      messageSid: "SM-daily",
      body: "I text my coach daily",
      timezone: "America/New_York",
      now: new Date("2026-05-01T15:00:00.000Z"),
    });
    const payload = hoisted.upsert.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload).toBeTruthy();
    expect(payload.pause_until).toBeNull();
    expect(payload.cadence_override).toBeNull();
    expect(payload).not.toHaveProperty("pause_indefinite");
    expect(hoisted.row.pause_indefinite).toBe(true);
  });

  it("inbound resume texts clears the timed pause only", async () => {
    hoisted.row.pause_indefinite = true;
    hoisted.row.pause_until = "2026-06-01T11:00:00.000Z";
    await applyInboundSmsCommsPreferencesFromMessage({
      clerkUserId: "user_1",
      messageSid: "SM-resume",
      body: "resume texts",
      timezone: "America/New_York",
      now: new Date("2026-05-01T15:00:00.000Z"),
    });
    const payload = hoisted.upsert.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload.pause_until).toBeNull();
    expect(payload).not.toHaveProperty("pause_indefinite");
    expect(hoisted.row.pause_indefinite).toBe(true);
  });

  it("preferred hour and weekend writes do not clear indefinite pause", async () => {
    hoisted.row.pause_indefinite = true;
    await upsertV2UserSmsCommsPreferences({
      clerkUserId: "user_1",
      patch: { preferred_local_hour: 8, weekend_send_policy: "weekdays_only" },
    });
    const payload = hoisted.upsert.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("pause_indefinite");
    expect(hoisted.row.pause_indefinite).toBe(true);
  });

  it("clear cadence", async () => {
    hoisted.row.cadence_override = "every_other_day";
    const r = await upsertV2UserSmsCommsPreferences({
      clerkUserId: "user_1",
      patch: {},
      clearCadenceOverride: true,
    });
    expect(r.row?.cadence_override).toBeNull();
  });

  it("START clear preserves timing/weekend", async () => {
    const result = await clearCommsPreferencesOnSmsResume("user_1");
    expect(result).toBe("cleared");
    const payload = hoisted.upsert.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload.pause_until).toBeNull();
    expect(payload.cadence_override).toBeNull();
    expect(hoisted.row.preferred_send_window).toBe("morning");
    expect(hoisted.row.weekend_send_policy).toBe("weekdays_only");
    expect(payload).not.toHaveProperty("pending_photo_request_win_id");
    expect(payload).not.toHaveProperty("pending_photo_request_expires_at");
    expect(payload).not.toHaveProperty("last_photo_request_sent_at");
    expect(payload.pause_indefinite).toBe(false);
    expect(payload).not.toHaveProperty("weekly_schedule");
    expect(payload).not.toHaveProperty("schedule_timezone");
  });

  it("START preference clear reports a server rejection without claiming success", async () => {
    hoisted.upsert.mockReturnValueOnce({ error: { message: "check violation", code: "23514" } });
    const result = await clearCommsPreferencesOnSmsResume("user_1");
    expect(result).toBe("failed");
  });

  it("START preference clear reports a transport failure as unconfirmed", async () => {
    hoisted.upsert.mockImplementationOnce(() => {
      throw new Error("TypeError: fetch failed");
    });
    const result = await clearCommsPreferencesOnSmsResume("user_1");
    expect(result).toBe("unconfirmed");
  });

  it("a server error code is a rejected write", async () => {
    hoisted.upsert.mockReturnValueOnce({
      select: () => ({
        maybeSingle: async () => ({
          data: null,
          error: { message: "check violation", code: "23514" },
        }),
      }),
    });
    const r = await upsertV2UserSmsCommsPreferences({
      clerkUserId: "user_1",
      patch: { cadence_override: "every_3_days" },
    });
    expect(r.ok).toBe(false);
    expect(r.persistence).toBe("rejected");
  });

  it("a missing row without an error code is an uncertain write", async () => {
    hoisted.upsert.mockReturnValueOnce({
      select: () => ({
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    });
    const r = await upsertV2UserSmsCommsPreferences({
      clerkUserId: "user_1",
      patch: { schedule_timezone: "America/Chicago" },
    });
    expect(r.ok).toBe(false);
    expect(r.persistence).toBe("uncertain");
    expect(r.row).toBeNull();
  });

  it("a transport error without a server code is an uncertain write", async () => {
    hoisted.upsert.mockReturnValueOnce({
      select: () => ({
        maybeSingle: async () => ({
          data: null,
          error: { message: "TypeError: fetch failed", code: "" },
        }),
      }),
    });
    const r = await upsertV2UserSmsCommsPreferences({
      clerkUserId: "user_1",
      patch: { schedule_timezone: "America/Chicago" },
    });
    expect(r.ok).toBe(false);
    expect(r.persistence).toBe("uncertain");
  });

  it("write failure returns ok false", async () => {
    hoisted.upsert.mockReturnValueOnce({
      select: () => ({
        maybeSingle: async () => ({ data: null, error: { message: "db down" } }),
      }),
    });
    const r = await upsertV2UserSmsCommsPreferences({
      clerkUserId: "user_1",
      patch: { cadence_override: "every_3_days" },
    });
    expect(r.ok).toBe(false);
  });

  it("duplicate message SID updates same row", async () => {
    await upsertV2UserSmsCommsPreferences({
      clerkUserId: "user_1",
      patch: { pause_until: "2026-06-01T11:00:00.000Z", source_message_sid: "SM9" },
    });
    await upsertV2UserSmsCommsPreferences({
      clerkUserId: "user_1",
      patch: { pause_until: "2026-06-02T11:00:00.000Z", source_message_sid: "SM9" },
    });
    expect(hoisted.upsert).toHaveBeenCalledTimes(2);
    expect(hoisted.row.source_message_sid).toBe("SM9");
    const fetched = await fetchV2UserSmsCommsPreferences("user_1");
    expect(fetched?.pause_until).toBe("2026-06-02T11:00:00.000Z");
  });

  it("schedule write does not send pause or photo fields", async () => {
    hoisted.row.pause_until = "2026-06-01T11:00:00.000Z";
    hoisted.row.pause_indefinite = true;
    hoisted.row.pending_photo_request_win_id = "win-1";
    const schedule = {
      monday: 420,
      tuesday: null,
      wednesday: 435,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    };
    await upsertV2UserSmsCommsPreferences({
      clerkUserId: "user_1",
      patch: { weekly_schedule: schedule, schedule_timezone: "America/Chicago" },
    });
    const payload = hoisted.upsert.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload.weekly_schedule).toEqual(schedule);
    expect(payload.schedule_timezone).toBe("America/Chicago");
    expect(payload).not.toHaveProperty("pause_until");
    expect(payload).not.toHaveProperty("pause_indefinite");
    expect(payload).not.toHaveProperty("cadence_override");
    expect(payload).not.toHaveProperty("pending_photo_request_win_id");
    expect(hoisted.row.pause_until).toBe("2026-06-01T11:00:00.000Z");
    expect(hoisted.row.pause_indefinite).toBe(true);
    expect(hoisted.row.pending_photo_request_win_id).toBe("win-1");
  });

  it("pause write does not send the weekly schedule", async () => {
    hoisted.row.weekly_schedule = {
      monday: 500,
      tuesday: 500,
      wednesday: 500,
      thursday: 500,
      friday: 500,
      saturday: null,
      sunday: null,
    };
    await upsertV2UserSmsCommsPreferences({
      clerkUserId: "user_1",
      patch: { pause_indefinite: true },
    });
    const payload = hoisted.upsert.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload).toEqual({ clerk_user_id: "user_1", pause_indefinite: true });
    expect(hoisted.row.weekly_schedule).toMatchObject({ monday: 500, saturday: null });
  });

  it("explicit null schedule is different from omitting the schedule", async () => {
    hoisted.row.weekly_schedule = {
      monday: 420,
      tuesday: 420,
      wednesday: 420,
      thursday: 420,
      friday: 420,
      saturday: 420,
      sunday: 420,
    };
    await upsertV2UserSmsCommsPreferences({
      clerkUserId: "user_1",
      patch: { schedule_timezone: "America/Denver" },
    });
    const timezoneOnly = hoisted.upsert.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(timezoneOnly).not.toHaveProperty("weekly_schedule");
    expect(hoisted.row.weekly_schedule).toMatchObject({ monday: 420 });

    await upsertV2UserSmsCommsPreferences({
      clerkUserId: "user_1",
      patch: { weekly_schedule: null },
    });
    const cleared = hoisted.upsert.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(cleared.weekly_schedule).toBeNull();
    expect(cleared).not.toHaveProperty("schedule_timezone");
  });
});
