import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const loadAudienceMock = vi.hoisted(() => vi.fn());
const generateMorningUserMock = vi.hoisted(() => vi.fn());
const generateEveningUserMock = vi.hoisted(() => vi.fn());
const draftStatusByKey = vi.hoisted(
  () => new Map<string, { status: string } | null>()
);

vi.mock("@/lib/tyler-text-overview-admin", () => ({
  loadSendableTylerTextOverviewAudienceMembers: (...args: unknown[]) =>
    loadAudienceMock(...args),
}));

vi.mock("@/lib/tyler-text-overview-generate", () => ({
  generateTylerTextOverviewDraftForUser: (...args: unknown[]) =>
    generateMorningUserMock(...args),
  generateTylerTextOverviewEveningPreviewForUser: (...args: unknown[]) =>
    generateEveningUserMock(...args),
}));

vi.mock("@/lib/supabase-server", () => {
  function makeChain() {
    const filters: Record<string, string> = {};
    const api: Record<string, unknown> = {};
    api.select = () => api;
    api.eq = (col: string, val: string) => {
      filters[col] = val;
      return api;
    };
    api.maybeSingle = async () => {
      const key = `${filters.clerk_user_id}|${filters.draft_for_day_key}|${filters.send_slot}`;
      const row = draftStatusByKey.get(key);
      if (row === undefined) {
        return { data: null, error: null };
      }
      return { data: row, error: null };
    };
    return api;
  }
  return {
    supabaseServer: {
      from: () => makeChain(),
    },
  };
});

import {
  generateEveningTtoDraftBatch,
  generateMorningTtoDraftBatch,
  generateTtoDraftBatch,
} from "@/lib/tyler-text-overview-generate-all";
import {
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
  TYLER_TEXT_OVERVIEW_ENABLED_ENV,
} from "@/lib/tyler-text-overview-types";

const DAY = "2026-08-07";
const FUTURE = "2026-08-08";
const NOW = new Date("2026-08-07T19:30:00.000Z"); // afternoon / evening wall-clock

function member(id: string, name: string) {
  return {
    clerkUserId: id,
    phoneNumber: `+1555${id.slice(-7).padStart(7, "0")}`,
    timezone: "America/New_York",
    preferredName: name,
  };
}

function statusKey(userId: string, day: string, slot: string) {
  return `${userId}|${day}|${slot}`;
}

describe("generateTtoDraftBatch (E7)", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env = { ...env, [TYLER_TEXT_OVERVIEW_ENABLED_ENV]: "true" };
    draftStatusByKey.clear();
    loadAudienceMock.mockReset();
    generateMorningUserMock.mockReset();
    generateEveningUserMock.mockReset();
    loadAudienceMock.mockResolvedValue([
      member("user_a", "Alex"),
      member("user_b", "Blake"),
    ]);
    generateMorningUserMock.mockResolvedValue({
      ok: true,
      generationId: "gen-m",
      supersedeFailed: false,
      currentDraftProtected: false,
    });
    generateEveningUserMock.mockResolvedValue({
      ok: true,
      generationId: "gen-e",
      supersedeFailed: false,
      currentDraftProtected: false,
    });
  });

  afterEach(() => {
    process.env = env;
  });

  it("Morning uses exact selected day (wall-clock does not override)", async () => {
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.draftForDayKey).toBe(DAY);
    expect(result.sendSlot).toBe(SMS_DAILY_PRODUCTION_SEND_SLOT);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(2);
    for (const call of generateMorningUserMock.mock.calls) {
      expect(call[0].draftForDayKey).toBe(DAY);
      expect(call[0].now).toBe(NOW);
    }
    expect(generateEveningUserMock).not.toHaveBeenCalled();
  });

  it("Evening uses exact selected day (wall-clock does not override)", async () => {
    const result = await generateEveningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.draftForDayKey).toBe(DAY);
    expect(result.sendSlot).toBe(SMS_DAILY_EVENING_PREVIEW_SEND_SLOT);
    expect(generateEveningUserMock).toHaveBeenCalledTimes(2);
    for (const call of generateEveningUserMock.mock.calls) {
      expect(call[0].draftForDayKey).toBe(DAY);
      expect(call[0].now).toBe(NOW);
    }
    expect(generateMorningUserMock).not.toHaveBeenCalled();
  });

  it("future Morning day works", async () => {
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: FUTURE,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.draftForDayKey).toBe(FUTURE);
    expect(generateMorningUserMock.mock.calls[0][0].draftForDayKey).toBe(FUTURE);
  });

  it("future Evening day works", async () => {
    const result = await generateEveningTtoDraftBatch({
      draftForDayKey: FUTURE,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.draftForDayKey).toBe(FUTURE);
    expect(generateEveningUserMock.mock.calls[0][0].draftForDayKey).toBe(FUTURE);
  });

  it("uses page-sendable audience loader (not cron generate audience)", async () => {
    await generateMorningTtoDraftBatch({ draftForDayKey: DAY, now: NOW });
    expect(loadAudienceMock).toHaveBeenCalledTimes(1);
    expect(loadAudienceMock).toHaveBeenCalledWith(NOW);
    const orch = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-generate-all.ts"),
      "utf8"
    );
    expect(orch).toContain("loadSendableTylerTextOverviewAudienceMembers");
    expect(orch).not.toContain("loadTylerTextOverviewAudienceRows");
    expect(orch).not.toContain("resolveCanonicalMorningTtoBatchDraftForDayKey");
  });

  it("search cannot narrow server targets (no user id list accepted)", async () => {
    const orch = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-generate-all.ts"),
      "utf8"
    );
    expect(orch).not.toMatch(/clerk_user_ids|userIds|visibleUserIds/);
    const morningRoute = readFileSync(
      join(
        process.cwd(),
        "src/app/api/admin/tyler-text-overview/morning-generate-all/route.ts"
      ),
      "utf8"
    );
    const eveningRoute = readFileSync(
      join(
        process.cwd(),
        "src/app/api/admin/tyler-text-overview/evening-generate-all/route.ts"
      ),
      "utf8"
    );
    expect(morningRoute).toContain("draft_for_day_key");
    expect(morningRoute).not.toMatch(/send_slot/);
    expect(eveningRoute).not.toMatch(/send_slot/);
  });

  it("missing drafts are generated", async () => {
    // no draftStatusByKey entries → generate
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.generated).toBe(2);
    expect(result.targeted).toBe(2);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(2);
  });

  it("ineligible/out-of-page audience not targeted", async () => {
    loadAudienceMock.mockResolvedValue([member("user_only", "Only")]);
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.targeted).toBe(1);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(1);
    expect(generateMorningUserMock.mock.calls[0][0].audienceUser.clerk_user_id).toBe(
      "user_only"
    );
  });

  it("Morning Tyler-protected edit survives (counted protected)", async () => {
    generateMorningUserMock.mockResolvedValue({
      ok: true,
      generationId: "gen-p",
      supersedeFailed: false,
      currentDraftProtected: true,
    });
    draftStatusByKey.set(statusKey("user_a", DAY, "morning"), { status: "current" });
    draftStatusByKey.set(statusKey("user_b", DAY, "morning"), { status: "current" });
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.generated).toBe(2);
    expect(result.protectedTylerAuthority).toBe(2);
  });

  it("Evening Tyler-protected blank survives (counted protected)", async () => {
    generateEveningUserMock.mockResolvedValue({
      ok: true,
      generationId: "gen-p",
      supersedeFailed: false,
      currentDraftProtected: true,
    });
    const result = await generateEveningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.protectedTylerAuthority).toBe(2);
  });

  it("machine-only current draft may regenerate", async () => {
    draftStatusByKey.set(statusKey("user_a", DAY, "morning"), { status: "current" });
    draftStatusByKey.set(statusKey("user_b", DAY, "morning"), { status: "current" });
    generateMorningUserMock.mockResolvedValue({
      ok: true,
      generationId: "gen-b",
      supersedeFailed: false,
      currentDraftProtected: false,
    });
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.generated).toBe(2);
    expect(result.protectedTylerAuthority).toBe(0);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(2);
  });

  it("Morning sent row skipped (skippedAlreadySent)", async () => {
    draftStatusByKey.set(statusKey("user_a", DAY, "morning"), { status: "sent" });
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.skippedAlreadySent).toBe(1);
    expect(result.generated).toBe(1);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(1);
    expect(generateMorningUserMock.mock.calls[0][0].audienceUser.clerk_user_id).toBe(
      "user_b"
    );
  });

  it("Evening sent row skipped", async () => {
    draftStatusByKey.set(
      statusKey("user_a", DAY, SMS_DAILY_EVENING_PREVIEW_SEND_SLOT),
      { status: "sent" }
    );
    const result = await generateEveningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.skippedAlreadySent).toBe(1);
    expect(result.generated).toBe(1);
    expect(generateEveningUserMock).toHaveBeenCalledTimes(1);
  });

  it("generic non-current row skipped", async () => {
    draftStatusByKey.set(statusKey("user_a", DAY, "morning"), {
      status: "superseded",
    });
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.skippedNonCurrent).toBe(1);
    expect(result.generated).toBe(1);
  });

  it("same-day other slot unaffected by Morning Generate All", async () => {
    draftStatusByKey.set(
      statusKey("user_a", DAY, SMS_DAILY_EVENING_PREVIEW_SEND_SLOT),
      { status: "sent" }
    );
    // Morning has no row — should still generate morning
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.skippedAlreadySent).toBe(0);
    expect(result.generated).toBe(2);
    expect(generateMorningUserMock).toHaveBeenCalledTimes(2);
  });

  it("partial failure continues and ok=false", async () => {
    generateMorningUserMock
      .mockResolvedValueOnce({
        ok: false,
        reason: "sol_failed",
        error: "interpreter boom",
      })
      .mockResolvedValueOnce({
        ok: true,
        generationId: "gen-ok",
        supersedeFailed: false,
        currentDraftProtected: false,
      });
    const result = await generateMorningTtoDraftBatch({
      draftForDayKey: DAY,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if ("status" in result) throw new Error("unexpected error");
    expect(result.generated).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].clerkUserId).toBe("user_a");
    expect(result.failed[0].preferredName).toBe("Alex");
    expect(result.failed[0].error).toContain("interpreter boom");
    expect(generateMorningUserMock).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid draft_for_day_key", async () => {
    const result = await generateTtoDraftBatch({
      draftForDayKey: "not-a-day",
      sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!("status" in result)) throw new Error("expected status error");
    expect(result.status).toBe(400);
  });

  it("no Twilio / send / reservation imports in orchestrator or routes", () => {
    const files = [
      "src/lib/tyler-text-overview-generate-all.ts",
      "src/app/api/admin/tyler-text-overview/morning-generate-all/route.ts",
      "src/app/api/admin/tyler-text-overview/evening-generate-all/route.ts",
    ];
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src).not.toMatch(/sendSMS/);
      expect(src).not.toMatch(/from ["']@\/lib\/twilio/);
      expect(src).not.toMatch(/daily-sms-scheduling/);
      expect(src).not.toMatch(/tyler-text-overview-evening-send/);
      expect(src).not.toMatch(/evening-sms/);
      expect(src).not.toMatch(/reserveSms|sms_send_events/);
      expect(src).not.toMatch(/CRON_SECRET/);
    }
  });

  it("Morning/Evening wrappers call existing Sol per-user generators only", () => {
    const orch = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-generate-all.ts"),
      "utf8"
    );
    expect(orch).toContain("generateTylerTextOverviewDraftForUser");
    expect(orch).toContain("generateTylerTextOverviewEveningPreviewForUser");
    expect(orch).not.toMatch(/gpt-4|mini|cheap/i);
    expect(orch).not.toContain("buildDailySmsContent");
  });

  it("admin routes fix slot server-side and set maxDuration=300", () => {
    const morning = readFileSync(
      join(
        process.cwd(),
        "src/app/api/admin/tyler-text-overview/morning-generate-all/route.ts"
      ),
      "utf8"
    );
    const evening = readFileSync(
      join(
        process.cwd(),
        "src/app/api/admin/tyler-text-overview/evening-generate-all/route.ts"
      ),
      "utf8"
    );
    expect(morning).toContain("requireTylerAdmin");
    expect(morning).toContain("generateMorningTtoDraftBatch");
    expect(morning).toContain("maxDuration = 300");
    expect(evening).toContain("requireTylerAdmin");
    expect(evening).toContain("generateEveningTtoDraftBatch");
    expect(evening).toContain("maxDuration = 300");
    expect(morning).not.toContain("generateEveningTtoDraftBatch");
    expect(evening).not.toContain("generateMorningTtoDraftBatch");
  });

  it("legacy cron generate route retained and unchanged for admin UI", () => {
    const cron = readFileSync(
      join(process.cwd(), "src/app/api/cron/tyler-text-overview-generate/route.ts"),
      "utf8"
    );
    expect(cron.length).toBeGreaterThan(50);
    const dashboard = readFileSync(
      join(
        process.cwd(),
        "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx"
      ),
      "utf8"
    );
    expect(dashboard).not.toContain("/api/cron/tyler-text-overview-generate");
    expect(dashboard).toContain("ttoGenerateAllEndpoint");
  });
});
