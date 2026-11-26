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
  generateWeeklyTtoDraftBatch,
  WEEKLY_TTO_GENERATE_ALL_CHUNK_USER_CAP,
  WEEKLY_TTO_GENERATE_ALL_CONCURRENCY,
  WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY,
  WEEKLY_TTO_GENERATE_ALL_TIME_BUDGET_MS,
} from "@/lib/tyler-text-overview-weekly-generate-all";

const REPO = process.cwd();

describe("weekly generation batch entry points are retired", () => {
  it("missing-only generation throws before an audience scan or a model call", async () => {
    await expect(generateMissingWeeklyDraftsForAllSendableUsers()).rejects.toThrow(
      "weekly_delivery_retired"
    );
  });

  it("the chunked batch refuses before a draft write or a provider call", async () => {
    await expect(generateWeeklyTtoDraftBatch({ now: new Date("2026-08-08T18:00:00.000Z") })).resolves.toEqual({
      ok: false,
      error: "weekly_delivery_retired",
      status: 410,
    });
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

  it("treats exact intentional_space as generated_complete and other reasons as retryable", () => {
    const currentBlank = {
      clerk_user_id: "u",
      status: "current" as const,
      current_generation_id: "g",
      edited_by_tyler: false,
      current_body_source: "machine",
      current_body_to_send: null,
    };
    expect(
      classifyWeeklyGenerateAllMember({
        draft: currentBlank,
        machineDraftBody: null,
        machineNoSendReason: "intentional_space",
      })
    ).toBe("generated_complete");
    for (const machineNoSendReason of [
      "openai_429",
      "packet_failed",
      "weekly_block_validator",
      "over_max",
      "unknown_reason",
      null,
    ]) {
      expect(
        classifyWeeklyGenerateAllMember({
          draft: currentBlank,
          machineDraftBody: null,
          machineNoSendReason,
        })
      ).toBe("failed_or_incomplete");
    }
    expect(
      classifyWeeklyGenerateAllMember({
        draft: null,
        machineDraftBody: null,
        machineNoSendReason: null,
      })
    ).toBe("pending");
  });

  it("explicit per-user regenerate does not use Generate Missing classification", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/admin/tyler-text-overview/weekly-generate/route.ts"),
      "utf8"
    );
    expect(route).toContain("weekly_delivery_retired");
    expect(route).not.toContain("generateTylerTextOverviewWeeklyDraftForUser");
    expect(route).not.toContain("classifyWeeklyGenerateAllMember");
    expect(route).not.toContain("classifyTtoGenerateAllMember");
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
    const res = await POST();
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
    const res = await POST();
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe("weekly_delivery_retired");
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
    const res = await POST();
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe("weekly_delivery_retired");
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

  it("retired entry points do not call the generator, interpreter, writer, or send path", () => {
    expect(serviceSrc).toContain("weekly_delivery_retired");
    expect(serviceSrc).not.toContain("generateTylerTextOverviewWeeklyDraftForUser");
    expect(serviceSrc).not.toContain("runPoolWithBudget");
    expect(serviceSrc).not.toContain("runWeeklyBriefInterpreterV1");
    expect(serviceSrc).not.toContain("writeWeeklyTtoBody");
    expect(serviceSrc).not.toContain("persistMorningTtoGeneration");
    expect(serviceSrc).not.toContain("sendSMS");
    expect(routeSrc).toContain("weekly_delivery_retired");
    expect(routeSrc).not.toContain("generateWeeklyTtoDraftBatch");
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

  it("weekly-sms cron cannot submit a text", () => {
    const src = readFileSync(join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    expect(src).toContain("weekly_delivery_retired");
    expect(src).toContain("force_ignored");
    expect(src).not.toContain("assertWeeklyTtoDraftAuthoritativeForCronSend");
    expect(src).not.toContain("produceWeeklyV3RelationshipSms");
  });
});
