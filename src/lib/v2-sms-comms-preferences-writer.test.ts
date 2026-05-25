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

  const selectMaybeSingle = vi.fn(async () => ({ data: null, error: null }));
  const upsert = vi.fn(async (payload: Record<string, unknown>) => {
    Object.assign(row, payload);
    return { data: { ...row }, error: null };
  });

  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: selectMaybeSingle,
      })),
    })),
    upsert,
  }));

  return { row, selectMaybeSingle, upsert, from };
});

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: hoisted.from },
}));

import {
  clearCommsPreferencesOnSmsResume,
  fetchV2UserSmsCommsPreferences,
  upsertV2UserSmsCommsPreferences,
} from "@/lib/v2-sms-comms-preferences";

describe("v2-sms-comms-preferences writer", () => {
  beforeEach(() => {
    Object.assign(hoisted.row, {
      clerk_user_id: "user_1",
      pause_until: null,
      pause_reason_category: null,
      cadence_override: null,
      weekend_send_policy: "weekdays_only",
      preferred_send_window: "morning",
      preferred_local_hour: 7,
      source_message_sid: null,
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
    await clearCommsPreferencesOnSmsResume("user_1");
    const payload = hoisted.upsert.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload.pause_until).toBeNull();
    expect(payload.cadence_override).toBeNull();
    expect(hoisted.row.preferred_send_window).toBe("morning");
    expect(hoisted.row.weekend_send_policy).toBe("weekdays_only");
  });

  it("write failure returns ok false", async () => {
    hoisted.upsert.mockResolvedValueOnce({ data: null, error: { message: "db down" } });
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
});
