import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const requireTylerAdminMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(() => {
      throw new Error("supabase should not be called when deps are injected");
    }),
  },
}));

vi.mock("@/lib/auth/require-tyler-admin", () => ({
  requireTylerAdmin: requireTylerAdminMock,
}));

vi.mock("@/lib/tyler-text-overview-types", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tyler-text-overview-types")>(
    "@/lib/tyler-text-overview-types"
  );
  return {
    ...actual,
    isTylerTextOverviewEnabled: () => true,
  };
});

vi.mock("@/lib/tyler-text-overview-weekly-generate", () => ({
  generateTylerTextOverviewWeeklyDraftForUser: vi.fn(),
}));

vi.mock("@/lib/tyler-text-overview-generate", () => ({
  loadTylerTextOverviewAudienceRows: vi.fn(),
}));

import {
  formatWeeklyGenerateMissingSummaryToast,
  weeklyGenerateMissingButtonLabel,
  WEEKLY_TTO_GENERATE_MISSING_BUTTON_LABEL,
  WEEKLY_TTO_GENERATE_MISSING_CONFIRM_COPY,
  WEEKLY_TTO_GENERATE_MISSING_HELP_COPY,
} from "@/lib/tyler-text-overview-dashboard-copy";
import {
  classifyWeeklyGenerateAllMember,
  generateMissingWeeklyDraftsForAllSendableUsers,
  WEEKLY_TTO_GENERATE_ALL_CHUNK_USER_CAP,
  WEEKLY_TTO_GENERATE_ALL_CONCURRENCY,
  WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY,
  WEEKLY_TTO_GENERATE_ALL_TIME_BUDGET_MS,
} from "@/lib/tyler-text-overview-weekly-generate-all";

const REPO = process.cwd();

describe("weekly-generate-all missing_only service", () => {
  const now = new Date("2026-07-12T16:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scans TTO audience and generates missing weekly drafts", async () => {
    const generateForUser = vi.fn().mockResolvedValue({
      ok: true,
      draftForDayKey: "2026-07-12",
      weekKey: "2026-W29",
      weekStart: "2026-07-06",
      weekEnd: "2026-07-12",
      timezone: "America/New_York",
      generationId: "gen-1",
      machineShouldSend: true,
      machineDraftBody: "Weekly body",
      machineNoSendReason: null,
      sendSlot: "weekly_review",
    });

    const result = await generateMissingWeeklyDraftsForAllSendableUsers({
      mode: "missing_only",
      now,
      deps: {
        loadAudienceRows: async () => [
          {
            clerk_user_id: "user_missing",
            phone_number: "+15551234567",
            sms_enabled: true,
            stopped_at: null,
            timezone: "America/New_York",
            summitt_subscribed: true,
          },
        ],
        getClerkUserFn: async () =>
          ({
            id: "user_missing",
            public_metadata: { timezone: "America/New_York" },
          }) as never,
        hasWeeklySendEvent: async () => false,
        findDraftForWeek: async () => ({ draft: null, machineDraftBody: null, hasSent: false }),
        generateForUser,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe(WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY);
    expect(result.scanned).toBe(1);
    expect(result.generated).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.week_keys_seen).toContain("2026-W29");
    expect(result.draft_for_day_keys_seen).toContain("2026-07-12");
    expect(generateForUser).toHaveBeenCalledTimes(1);
  });

  it("skips existing current weekly drafts and does not call generate", async () => {
    const generateForUser = vi.fn();
    const result = await generateMissingWeeklyDraftsForAllSendableUsers({
      now,
      deps: {
        loadAudienceRows: async () => [
          {
            clerk_user_id: "user_current",
            phone_number: "+15551234567",
            sms_enabled: true,
            stopped_at: null,
            timezone: "America/New_York",
            summitt_subscribed: true,
          },
        ],
        getClerkUserFn: async () =>
          ({
            id: "user_current",
            public_metadata: { timezone: "America/New_York" },
          }) as never,
        hasWeeklySendEvent: async () => false,
        findDraftForWeek: async () => ({
          draft: {
            clerk_user_id: "user_current",
            status: "current",
            current_generation_id: "gen-current",
            edited_by_tyler: false,
            current_body_source: "machine",
            current_body_to_send: "Existing weekly body",
          },
          machineDraftBody: "Existing weekly body",
          hasSent: false,
        }),
        generateForUser,
      },
    });

    expect(result.skipped_existing_current).toBe(1);
    expect(result.generated).toBe(0);
    expect(generateForUser).not.toHaveBeenCalled();
  });

  it("skips Tyler-edited drafts because they are current", async () => {
    const generateForUser = vi.fn();
    const result = await generateMissingWeeklyDraftsForAllSendableUsers({
      now,
      deps: {
        loadAudienceRows: async () => [
          {
            clerk_user_id: "user_tyler_edited",
            phone_number: "+15551234567",
            sms_enabled: true,
            stopped_at: null,
            timezone: "America/New_York",
            summitt_subscribed: true,
          },
        ],
        getClerkUserFn: async () =>
          ({
            id: "user_tyler_edited",
            public_metadata: { timezone: "America/New_York" },
          }) as never,
        hasWeeklySendEvent: async () => false,
        findDraftForWeek: async () => ({
          draft: {
            clerk_user_id: "user_tyler_edited",
            status: "current",
            current_generation_id: "gen-tyler",
            edited_by_tyler: true,
            current_body_source: "tyler_edit",
            current_body_to_send: "Tyler weekly edit",
          },
          machineDraftBody: "machine leftover",
          hasSent: false,
        }),
        generateForUser,
      },
    });

    expect(result.skipped_existing_current).toBe(1);
    expect(generateForUser).not.toHaveBeenCalled();
  });

  it("skips sent weekly drafts", async () => {
    const generateForUser = vi.fn();
    const result = await generateMissingWeeklyDraftsForAllSendableUsers({
      now,
      deps: {
        loadAudienceRows: async () => [
          {
            clerk_user_id: "user_sent",
            phone_number: "+15551234567",
            sms_enabled: true,
            stopped_at: null,
            timezone: "America/New_York",
            summitt_subscribed: true,
          },
        ],
        getClerkUserFn: async () =>
          ({
            id: "user_sent",
            public_metadata: { timezone: "America/New_York" },
          }) as never,
        hasWeeklySendEvent: async () => false,
        findDraftForWeek: async () => ({
          draft: {
            clerk_user_id: "user_sent",
            status: "sent",
            current_generation_id: "gen-sent",
            edited_by_tyler: false,
            current_body_source: "machine",
            current_body_to_send: "Sent body",
          },
          machineDraftBody: "Sent body",
          hasSent: true,
        }),
        generateForUser,
      },
    });

    expect(result.skipped_sent).toBe(1);
    expect(generateForUser).not.toHaveBeenCalled();
  });

  it("retries current drafts whose machine body is empty (OpenAI failure)", async () => {
    const generateForUser = vi.fn().mockResolvedValue({
      ok: true,
      draftForDayKey: "2026-07-12",
      weekKey: "2026-W29",
      weekStart: "2026-07-06",
      weekEnd: "2026-07-12",
      timezone: "America/New_York",
      generationId: "gen-retry",
      machineShouldSend: true,
      machineDraftBody: "Recovered weekly body",
      machineNoSendReason: null,
      sendSlot: "weekly_review",
    });
    const result = await generateMissingWeeklyDraftsForAllSendableUsers({
      now,
      deps: {
        loadAudienceRows: async () => [
          {
            clerk_user_id: "user_retry",
            phone_number: "+15551234567",
            sms_enabled: true,
            stopped_at: null,
            timezone: "America/New_York",
            summitt_subscribed: true,
          },
        ],
        getClerkUserFn: async () =>
          ({
            id: "user_retry",
            public_metadata: { timezone: "America/New_York" },
          }) as never,
        hasWeeklySendEvent: async () => false,
        findDraftForWeek: async () => ({
          draft: {
            clerk_user_id: "user_retry",
            status: "current",
            current_generation_id: "gen-fail",
            edited_by_tyler: false,
            current_body_source: "machine",
            current_body_to_send: null,
          },
          machineDraftBody: null,
          hasSent: false,
        }),
        generateForUser,
      },
    });
    expect(generateForUser).toHaveBeenCalledTimes(1);
    expect(result.generated).toBe(1);
    expect(result.skipped_existing_current).toBe(0);
  });

  it("counts technical no-send (empty machine body) as failed, not generated", async () => {
    const generateForUser = vi.fn().mockResolvedValue({
      ok: true,
      draftForDayKey: "2026-07-12",
      weekKey: "2026-W29",
      weekStart: "2026-07-06",
      weekEnd: "2026-07-12",
      timezone: "America/New_York",
      generationId: "gen-empty",
      machineShouldSend: false,
      machineDraftBody: null,
      machineNoSendReason: "openai_429",
      sendSlot: "weekly_review",
    });
    const result = await generateMissingWeeklyDraftsForAllSendableUsers({
      now,
      deps: {
        loadAudienceRows: async () => [
          {
            clerk_user_id: "user_429",
            phone_number: "+15551234567",
            sms_enabled: true,
            stopped_at: null,
            timezone: "America/New_York",
            summitt_subscribed: true,
          },
        ],
        getClerkUserFn: async () =>
          ({
            id: "user_429",
            public_metadata: { timezone: "America/New_York" },
          }) as never,
        hasWeeklySendEvent: async () => false,
        findDraftForWeek: async () => ({ draft: null, machineDraftBody: null, hasSent: false }),
        generateForUser,
      },
    });
    expect(result.generated).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors_preview[0]?.error).toBe("openai_429");
  });

  it("protects Tyler blank current drafts", async () => {
    const generateForUser = vi.fn();
    const result = await generateMissingWeeklyDraftsForAllSendableUsers({
      now,
      deps: {
        loadAudienceRows: async () => [
          {
            clerk_user_id: "user_blank",
            phone_number: "+15551234567",
            sms_enabled: true,
            stopped_at: null,
            timezone: "America/New_York",
            summitt_subscribed: true,
          },
        ],
        getClerkUserFn: async () =>
          ({
            id: "user_blank",
            public_metadata: { timezone: "America/New_York" },
          }) as never,
        hasWeeklySendEvent: async () => false,
        findDraftForWeek: async () => ({
          draft: {
            clerk_user_id: "user_blank",
            status: "current",
            current_generation_id: "gen-blank",
            edited_by_tyler: true,
            current_body_source: "tyler_edit",
            current_body_to_send: null,
          },
          machineDraftBody: null,
          hasSent: false,
        }),
        generateForUser,
      },
    });
    expect(result.skipped_existing_current).toBe(1);
    expect(generateForUser).not.toHaveBeenCalled();
  });

  it("skips users with existing sms_weekly_send_events for week_key (incl. Tyler W29)", async () => {
    const generateForUser = vi.fn();
    const hasWeeklySendEvent = vi.fn().mockResolvedValue(true);
    const result = await generateMissingWeeklyDraftsForAllSendableUsers({
      now,
      deps: {
        loadAudienceRows: async () => [
          {
            clerk_user_id: "user_3Boa0IkXC7GzrZOBgcCem0DnFa9",
            phone_number: "+15551234567",
            sms_enabled: true,
            stopped_at: null,
            timezone: "America/New_York",
            summitt_subscribed: true,
          },
        ],
        getClerkUserFn: async () =>
          ({
            id: "user_3Boa0IkXC7GzrZOBgcCem0DnFa9",
            public_metadata: { timezone: "America/New_York" },
          }) as never,
        hasWeeklySendEvent,
        findDraftForWeek: async () => ({ draft: null, machineDraftBody: null, hasSent: false }),
        generateForUser,
      },
    });

    expect(result.skipped_already_weekly_event).toBe(1);
    expect(hasWeeklySendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: "user_3Boa0IkXC7GzrZOBgcCem0DnFa9",
        weekKey: "2026-W29",
      })
    );
    expect(generateForUser).not.toHaveBeenCalled();
  });

  it("skips not eligible (no phone) without generate", async () => {
    const generateForUser = vi.fn();
    const result = await generateMissingWeeklyDraftsForAllSendableUsers({
      now,
      deps: {
        loadAudienceRows: async () => [
          {
            clerk_user_id: "user_nophone",
            phone_number: "  ",
            sms_enabled: true,
            stopped_at: null,
            timezone: "America/New_York",
            summitt_subscribed: true,
          },
        ],
        generateForUser,
      },
    });

    expect(result.skipped_not_eligible).toBe(1);
    expect(result.generated).toBe(0);
    expect(generateForUser).not.toHaveBeenCalled();
  });

  it("maps generate eligibility failures to skipped_not_eligible", async () => {
    const generateForUser = vi.fn().mockResolvedValue({
      ok: false,
      reason: "not_v2",
    });
    const result = await generateMissingWeeklyDraftsForAllSendableUsers({
      now,
      deps: {
        loadAudienceRows: async () => [
          {
            clerk_user_id: "user_not_v2",
            phone_number: "+15551234567",
            sms_enabled: true,
            stopped_at: null,
            timezone: "America/New_York",
            summitt_subscribed: true,
          },
        ],
        getClerkUserFn: async () =>
          ({
            id: "user_not_v2",
            public_metadata: { timezone: "America/New_York" },
          }) as never,
        hasWeeklySendEvent: async () => false,
        findDraftForWeek: async () => ({ draft: null, machineDraftBody: null, hasSent: false }),
        generateForUser,
      },
    });

    expect(result.skipped_not_eligible).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("counts machine_should_send false with empty body as failed Generate All work", async () => {
    const generateForUser = vi.fn().mockResolvedValue({
      ok: true,
      draftForDayKey: "2026-07-12",
      weekKey: "2026-W29",
      weekStart: "2026-07-06",
      weekEnd: "2026-07-12",
      timezone: "America/New_York",
      generationId: "gen-nosend",
      machineShouldSend: false,
      machineDraftBody: null,
      machineNoSendReason: "weekly_lane_no_send",
      sendSlot: "weekly_review",
    });

    const result = await generateMissingWeeklyDraftsForAllSendableUsers({
      now,
      deps: {
        loadAudienceRows: async () => [
          {
            clerk_user_id: "user_nosend",
            phone_number: "+15551234567",
            sms_enabled: true,
            stopped_at: null,
            timezone: "America/New_York",
            summitt_subscribed: true,
          },
        ],
        getClerkUserFn: async () =>
          ({
            id: "user_nosend",
            public_metadata: { timezone: "America/New_York" },
          }) as never,
        hasWeeklySendEvent: async () => false,
        findDraftForWeek: async () => ({ draft: null, machineDraftBody: null, hasSent: false }),
        generateForUser,
      },
    });

    expect(result.generated).toBe(0);
    expect(result.failed).toBe(1);
    expect(generateForUser).toHaveBeenCalled();
  });

  it("returns errors_preview on partial failure while counting successes", async () => {
    const generateForUser = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        draftForDayKey: "2026-07-12",
        weekKey: "2026-W29",
        weekStart: "2026-07-06",
        weekEnd: "2026-07-12",
        timezone: "America/New_York",
        generationId: "gen-ok",
        machineShouldSend: true,
        machineDraftBody: "ok",
        machineNoSendReason: null,
        sendSlot: "weekly_review",
      })
      .mockResolvedValueOnce({
        ok: false,
        reason: "build_failed",
        error: "openai_down",
      });

    const result = await generateMissingWeeklyDraftsForAllSendableUsers({
      now,
      deps: {
        loadAudienceRows: async () => [
          {
            clerk_user_id: "user_ok",
            phone_number: "+15551111111",
            sms_enabled: true,
            stopped_at: null,
            timezone: "America/New_York",
            summitt_subscribed: true,
          },
          {
            clerk_user_id: "user_fail",
            phone_number: "+15552222222",
            sms_enabled: true,
            stopped_at: null,
            timezone: "America/New_York",
            summitt_subscribed: true,
          },
        ],
        getClerkUserFn: async (id: string) =>
          ({
            id,
            public_metadata: { timezone: "America/New_York" },
          }) as never,
        hasWeeklySendEvent: async () => false,
        findDraftForWeek: async () => ({ draft: null, machineDraftBody: null, hasSent: false }),
        generateForUser,
      },
    });

    expect(result.generated).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors_preview).toEqual([
      expect.objectContaining({
        clerk_user_id: "user_fail",
        reason: "build_failed",
        error: "openai_down",
      }),
    ]);
  });

  it("rerun missing_only skips users who now have current drafts", async () => {
    const generateForUser = vi.fn();
    const findDraftForWeek = vi
      .fn()
      .mockResolvedValueOnce({ draft: null, machineDraftBody: null, hasSent: false })
      .mockResolvedValueOnce({
        draft: {
          clerk_user_id: "user_rerun",
          status: "current",
          current_generation_id: "gen-1",
          edited_by_tyler: false,
          current_body_source: "machine",
          current_body_to_send: "body",
        },
        machineDraftBody: "body",
        hasSent: false,
      });

    generateForUser.mockResolvedValue({
      ok: true,
      draftForDayKey: "2026-07-12",
      weekKey: "2026-W29",
      weekStart: "2026-07-06",
      weekEnd: "2026-07-12",
      timezone: "America/New_York",
      generationId: "gen-1",
      machineShouldSend: true,
      machineDraftBody: "body",
      machineNoSendReason: null,
      sendSlot: "weekly_review",
    });

    const audience = [
      {
        clerk_user_id: "user_rerun",
        phone_number: "+15551234567",
        sms_enabled: true,
        stopped_at: null,
        timezone: "America/New_York",
        summitt_subscribed: true,
      },
    ];

    const first = await generateMissingWeeklyDraftsForAllSendableUsers({
      now,
      deps: {
        loadAudienceRows: async () => audience,
        getClerkUserFn: async () =>
          ({
            id: "user_rerun",
            public_metadata: { timezone: "America/New_York" },
          }) as never,
        hasWeeklySendEvent: async () => false,
        findDraftForWeek,
        generateForUser,
      },
    });
    expect(first.generated).toBe(1);

    const second = await generateMissingWeeklyDraftsForAllSendableUsers({
      now,
      deps: {
        loadAudienceRows: async () => audience,
        getClerkUserFn: async () =>
          ({
            id: "user_rerun",
            public_metadata: { timezone: "America/New_York" },
          }) as never,
        hasWeeklySendEvent: async () => false,
        findDraftForWeek,
        generateForUser,
      },
    });
    expect(second.skipped_existing_current).toBe(1);
    expect(second.generated).toBe(0);
    expect(generateForUser).toHaveBeenCalledTimes(1);
  });

  it("throws on unsupported mode", async () => {
    await expect(
      generateMissingWeeklyDraftsForAllSendableUsers({
        mode: "regenerate_all" as never,
      })
    ).rejects.toThrow(/unsupported_mode/);
  });
});

describe("weekly generate-all classification", () => {
  it("Generate Missing All + valid machine A is generated_complete (skip)", () => {
    expect(
      classifyWeeklyGenerateAllMember({
        draft: {
          clerk_user_id: "u",
          status: "current",
          current_generation_id: "g",
          edited_by_tyler: false,
          current_body_source: "machine",
          current_body_to_send: "ok",
        },
        machineDraftBody: "ok",
      })
    ).toBe("generated_complete");
  });

  it("Generate Missing All + Tyler edit is protected_complete", () => {
    expect(
      classifyWeeklyGenerateAllMember({
        draft: {
          clerk_user_id: "u",
          status: "current",
          current_generation_id: "g",
          edited_by_tyler: true,
          current_body_source: "tyler_edit",
          current_body_to_send: "Tyler kept this",
        },
        machineDraftBody: "ignored machine",
      })
    ).toBe("protected_complete");
  });

  it("Generate Missing All + Tyler blank is protected_complete", () => {
    expect(
      classifyWeeklyGenerateAllMember({
        draft: {
          clerk_user_id: "u",
          status: "current",
          current_generation_id: "g",
          edited_by_tyler: true,
          current_body_source: "tyler_edit",
          current_body_to_send: null,
        },
        machineDraftBody: null,
      })
    ).toBe("protected_complete");
  });

  it("Generate Missing All + failed machine is retryable", () => {
    expect(
      classifyWeeklyGenerateAllMember({
        draft: {
          clerk_user_id: "u",
          status: "current",
          current_generation_id: "g",
          edited_by_tyler: false,
          current_body_source: "machine",
          current_body_to_send: null,
        },
        machineDraftBody: null,
      })
    ).toBe("failed_or_incomplete");
  });

  it("treats nonempty machine current as complete and empty machine current as retryable", () => {
    expect(
      classifyWeeklyGenerateAllMember({
        draft: {
          clerk_user_id: "u",
          status: "current",
          current_generation_id: "g",
          edited_by_tyler: false,
          current_body_source: "machine",
          current_body_to_send: "ok",
        },
        machineDraftBody: "ok",
      })
    ).toBe("generated_complete");
    expect(
      classifyWeeklyGenerateAllMember({
        draft: {
          clerk_user_id: "u",
          status: "current",
          current_generation_id: "g",
          edited_by_tyler: false,
          current_body_source: "machine",
          current_body_to_send: null,
        },
        machineDraftBody: null,
      })
    ).toBe("failed_or_incomplete");
    expect(
      classifyWeeklyGenerateAllMember({
        draft: {
          clerk_user_id: "u",
          status: "current",
          current_generation_id: "g",
          edited_by_tyler: true,
          current_body_source: "tyler_edit",
          current_body_to_send: null,
        },
        machineDraftBody: null,
      })
    ).toBe("protected_complete");
  });

  it("reuses Morning chunk size, concurrency, and budget", () => {
    expect(WEEKLY_TTO_GENERATE_ALL_CHUNK_USER_CAP).toBe(8);
    expect(WEEKLY_TTO_GENERATE_ALL_CONCURRENCY).toBe(2);
    expect(WEEKLY_TTO_GENERATE_ALL_TIME_BUDGET_MS).toBe(180_000);
  });
});

describe("weekly-generate-all route", () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env, TYLER_CLERK_USER_ID: "user_tyler" };
  });

  afterEach(() => {
    process.env = env;
  });

  it("requires admin", async () => {
    const err = Object.assign(new Error("UNAUTHORIZED"), { status: 401 });
    requireTylerAdminMock.mockRejectedValueOnce(err);
    const { POST } = await import(
      "@/app/api/admin/tyler-text-overview/weekly-generate-all/route"
    );
    const res = await POST(
      new Request("http://localhost/api/admin/tyler-text-overview/weekly-generate-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "missing_only" }),
      })
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("ignores extra mode fields and still runs a generate-all chunk", async () => {
    requireTylerAdminMock.mockResolvedValue(undefined);
    vi.resetModules();
    vi.doMock("@/lib/tyler-text-overview-weekly-generate-all", () => ({
      parseWeeklyGenerateAllRequestBody: () => ({
        audienceClerkUserIds: null,
        excludeClerkUserIds: null,
      }),
      generateWeeklyTtoDraftBatch: vi.fn().mockResolvedValue({
        ok: true,
        sendSlot: "weekly_review",
        targeted: 2,
        generated_complete: 1,
        protected_complete: 0,
        already_sent: 0,
        noncurrent: 0,
        failed: 0,
        pending: 1,
        remaining: 1,
        processed_this_chunk: 1,
        is_complete: false,
        audience_clerk_user_ids: ["user_a", "user_b"],
        failures: [],
        generated_this_chunk: 1,
        generated: 1,
        protectedTylerAuthority: 0,
        skippedAlreadySent: 0,
        skippedNonCurrent: 0,
      }),
    }));
    const { POST } = await import(
      "@/app/api/admin/tyler-text-overview/weekly-generate-all/route"
    );
    const res = await POST(
      new Request("http://localhost/api/admin/tyler-text-overview/weekly-generate-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "regenerate_all" }),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.result.generated_complete).toBe(1);
    vi.doUnmock("@/lib/tyler-text-overview-weekly-generate-all");
  });

  it("returns a chunk result for Generate All", async () => {
    requireTylerAdminMock.mockResolvedValue(undefined);
    vi.resetModules();
    vi.doMock("@/lib/tyler-text-overview-weekly-generate-all", () => ({
      parseWeeklyGenerateAllRequestBody: () => ({
        audienceClerkUserIds: null,
        excludeClerkUserIds: null,
      }),
      generateWeeklyTtoDraftBatch: vi.fn().mockResolvedValue({
        ok: true,
        sendSlot: "weekly_review",
        targeted: 2,
        generated_complete: 1,
        protected_complete: 1,
        already_sent: 0,
        noncurrent: 0,
        failed: 0,
        pending: 0,
        remaining: 0,
        processed_this_chunk: 1,
        is_complete: true,
        audience_clerk_user_ids: ["user_a", "user_b"],
        failures: [],
        generated_this_chunk: 1,
        generated: 1,
        protectedTylerAuthority: 1,
        skippedAlreadySent: 0,
        skippedNonCurrent: 0,
      }),
    }));
    const { POST } = await import(
      "@/app/api/admin/tyler-text-overview/weekly-generate-all/route"
    );
    const res = await POST(
      new Request("http://localhost/api/admin/tyler-text-overview/weekly-generate-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.result.is_complete).toBe(true);
    expect(json.result.generated_complete).toBe(1);
    vi.doUnmock("@/lib/tyler-text-overview-weekly-generate-all");
  });
});

describe("weekly-generate-all no-send static guards", () => {
  const serviceSrc = readFileSync(
    join(REPO, "src/lib/tyler-text-overview-weekly-generate-all.ts"),
    "utf8"
  );
  const routeSrc = readFileSync(
    join(REPO, "src/app/api/admin/tyler-text-overview/weekly-generate-all/route.ts"),
    "utf8"
  );
  const dashSrc = readFileSync(
    join(REPO, "src/app/admin/tyler-text-overview/tyler-text-overview-weekly-dashboard.tsx"),
    "utf8"
  );
  const weeklySmsSrc = readFileSync(join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
  const vercelSrc = readFileSync(join(REPO, "vercel.json"), "utf8");

  it("does not call sendSMS / Twilio", () => {
    for (const src of [serviceSrc, routeSrc, dashSrc]) {
      expect(src).not.toMatch(/\bsendSMS\b/);
      expect(src).not.toMatch(/from ["']@\/lib\/twilio["']/);
    }
  });

  it("does not write sms_weekly_send_events (select-only allowed for skip)", () => {
    expect(serviceSrc).toContain('from("sms_weekly_send_events")');
    expect(serviceSrc).not.toMatch(/sms_weekly_send_events[\s\S]{0,200}\.insert\(/);
    expect(serviceSrc).not.toMatch(/\.insert\([\s\S]{0,120}week_key/);
    expect(routeSrc).not.toContain("sms_weekly_send_events");
  });

  it("does not write sms_send_events / check_sent / v2 events / thread memory", () => {
    for (const src of [serviceSrc, routeSrc]) {
      expect(src).not.toContain('from("sms_send_events")');
      expect(src).not.toContain("check_sent");
      expect(src).not.toContain("v2_commitment_event");
      expect(src).not.toContain("onV2StandardCheckSent");
      expect(src).not.toContain("upsertCommitmentSmsThreadMemory");
      expect(src).not.toContain("last_outbound");
    }
  });

  it("does not call or modify weekly-sms cron / vercel.json", () => {
    expect(serviceSrc).not.toContain("/api/cron/weekly-sms");
    expect(routeSrc).not.toContain("/api/cron/weekly-sms");
    expect(weeklySmsSrc).not.toContain("weekly-generate-all");
    expect(vercelSrc).not.toContain("weekly-generate-all");
  });

  it("uses chunked resumable generation via one-row generate", () => {
    expect(serviceSrc).toContain("generateTylerTextOverviewWeeklyDraftForUser");
    expect(serviceSrc).toContain("runPoolWithBudget");
    expect(serviceSrc).toContain("WEEKLY_TTO_GENERATE_ALL_CHUNK_USER_CAP");
    expect(serviceSrc).toContain("WEEKLY_TTO_GENERATE_ALL_CONCURRENCY");
    expect(routeSrc).toContain("generateWeeklyTtoDraftBatch");
    expect(routeSrc).toContain("maxDuration");
  });
});

describe("weekly-generate-all UI / copy", () => {
  it("button and confirmation copy exist", () => {
    expect(WEEKLY_TTO_GENERATE_MISSING_BUTTON_LABEL).toBe("Generate Missing Weekly Drafts");
    expect(WEEKLY_TTO_GENERATE_MISSING_HELP_COPY).toContain("does not send texts");
    expect(WEEKLY_TTO_GENERATE_MISSING_HELP_COPY).toContain("does not overwrite");
    expect(WEEKLY_TTO_GENERATE_MISSING_CONFIRM_COPY).toContain("does not send texts");
    expect(WEEKLY_TTO_GENERATE_MISSING_CONFIRM_COPY).toContain("does not overwrite");
    expect(weeklyGenerateMissingButtonLabel(false)).toBe("Generate Missing Weekly Drafts");
    expect(
      formatWeeklyGenerateMissingSummaryToast({
        generated: 12,
        skippedExistingCurrent: 20,
        skippedSent: 2,
        skippedAlreadyWeeklyEvent: 6,
        failed: 1,
      })
    ).toBe(
      "Generated 12 missing weekly drafts. Skipped 20 existing, 8 already sent, 1 failed."
    );
  });

  it("dashboard wires generate-all button without Send All", () => {
    const dash = readFileSync(
      join(REPO, "src/app/admin/tyler-text-overview/tyler-text-overview-weekly-dashboard.tsx"),
      "utf8"
    );
    expect(dash).toContain("weekly-generate-all");
    expect(dash).toContain("weeklyGenerateMissingButtonLabel");
    expect(dash).toContain("WEEKLY_TTO_GENERATE_MISSING_CONFIRM_COPY");
    expect(dash).toContain("audience_clerk_user_ids");
    expect(dash).not.toMatch(/Send All/i);
    expect(dash).not.toMatch(/Regenerate All/i);
    expect(dash).not.toMatch(/Queue All/i);
  });

  it("route file exists", () => {
    expect(
      existsSync(
        join(REPO, "src/app/api/admin/tyler-text-overview/weekly-generate-all/route.ts")
      )
    ).toBe(true);
  });
});

describe("weekly-generate-all does not regress siblings", () => {
  it("morning / evening dashboards unchanged for Send All", () => {
    const morning = readFileSync(
      join(REPO, "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx"),
      "utf8"
    );
    expect(morning).not.toContain("weekly-generate-all");
    const eveningPath = join(
      REPO,
      "src/app/admin/tyler-text-overview/tyler-text-overview-evening-dashboard.tsx"
    );
    if (existsSync(eveningPath)) {
      const evening = readFileSync(eveningPath, "utf8");
      expect(evening).not.toContain("weekly-generate-all");
      expect(evening).not.toMatch(/Send All/i);
    }
  });

  it("weekly-sms cron remains draft-authoritative", () => {
    const src = readFileSync(join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    expect(src).toContain("assertWeeklyTtoDraftAuthoritativeForCronSend");
    expect(src).not.toContain("produceWeeklyV3RelationshipSms");
  });
});
