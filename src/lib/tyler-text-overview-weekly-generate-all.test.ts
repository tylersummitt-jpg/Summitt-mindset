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
  generateMissingWeeklyDraftsForAllSendableUsers,
  WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY,
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
        findDraftStatuses: async () => ({ hasCurrent: false, hasSent: false }),
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
        findDraftStatuses: async () => ({ hasCurrent: true, hasSent: false }),
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
        // Tyler-edited rows remain status=current
        findDraftStatuses: async () => ({ hasCurrent: true, hasSent: false }),
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
        findDraftStatuses: async () => ({ hasCurrent: false, hasSent: true }),
        generateForUser,
      },
    });

    expect(result.skipped_sent).toBe(1);
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
        findDraftStatuses: async () => ({ hasCurrent: false, hasSent: false }),
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
        findDraftStatuses: async () => ({ hasCurrent: false, hasSent: false }),
        generateForUser,
      },
    });

    expect(result.skipped_not_eligible).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("persists no-send drafts when generate returns machine_should_send false", async () => {
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
        findDraftStatuses: async () => ({ hasCurrent: false, hasSent: false }),
        generateForUser,
      },
    });

    expect(result.generated).toBe(1);
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
        findDraftStatuses: async () => ({ hasCurrent: false, hasSent: false }),
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
    const findDraftStatuses = vi
      .fn()
      .mockResolvedValueOnce({ hasCurrent: false, hasSent: false })
      .mockResolvedValueOnce({ hasCurrent: true, hasSent: false });

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
        findDraftStatuses,
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
        findDraftStatuses,
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

  it("rejects unsupported mode", async () => {
    requireTylerAdminMock.mockResolvedValue(undefined);
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
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain("unsupported_mode");
  });

  it("accepts missing_only mode", async () => {
    requireTylerAdminMock.mockResolvedValue(undefined);
    vi.resetModules();
    vi.doMock("@/lib/tyler-text-overview-weekly-generate-all", () => ({
      WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY: "missing_only",
      generateMissingWeeklyDraftsForAllSendableUsers: vi.fn().mockResolvedValue({
        ok: true,
        mode: "missing_only",
        scanned: 2,
        eligible: 2,
        generated: 1,
        skipped_existing_current: 1,
        skipped_sent: 0,
        skipped_already_weekly_event: 0,
        skipped_not_eligible: 0,
        failed: 0,
        week_keys_seen: ["2026-W29"],
        draft_for_day_keys_seen: ["2026-07-12"],
        errors_preview: [],
      }),
    }));
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
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.mode).toBe("missing_only");
    expect(json.generated).toBe(1);
    expect(json.skipped_existing_current).toBe(1);
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

  it("uses sequential missing_only generation via one-row generate", () => {
    expect(serviceSrc).toContain("generateTylerTextOverviewWeeklyDraftForUser");
    expect(serviceSrc).toContain("missing_only");
    expect(serviceSrc).toContain("for (const row of audience)");
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
    expect(dash).toContain("missing_only");
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
