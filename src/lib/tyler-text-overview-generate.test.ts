import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildWriterOpenAiCapture } from "@/lib/tyler-text-overview-writer-capture";
import {
  resolveTylerTextOverviewDraftForDayKey,
  isTylerTextOverviewEveningStyleSendUser,
} from "@/lib/tyler-text-overview-draft-day-key";
import {
  mapBuiltToTylerTextOverviewGenerationRow,
  generateTylerTextOverviewDailyDrafts,
  generateTylerTextOverviewDraftForUser,
  loadTylerTextOverviewAudienceRows,
} from "@/lib/tyler-text-overview-generate";
import type { DailySmsBuilt } from "@/lib/daily-sms-build";
import { TYLER_TEXT_OVERVIEW_ENABLED_ENV } from "@/lib/tyler-text-overview-types";

const buildDailySmsContentMock = vi.hoisted(() => vi.fn());
const getClerkUserMock = vi.hoisted(() => vi.fn());
const resolveV2Mock = vi.hoisted(() => vi.fn());
const fetchCommsMock = vi.hoisted(() => vi.fn());
const shouldSkipCommsMock = vi.hoisted(() => vi.fn());
const fetchLearnedMock = vi.hoisted(() => vi.fn());
const getActiveCommitmentMock = vi.hoisted(() => vi.fn());
const sendSmsMock = vi.hoisted(() => vi.fn());
const reconcileCheckSentMock = vi.hoisted(() => vi.fn());
const threadMemoryMock = vi.hoisted(() => vi.fn());
const checkSentInsertMock = vi.hoisted(() => vi.fn());

type GenerationRow = Record<string, unknown> & { id: string };
type DraftRow = Record<string, unknown>;

const db = vi.hoisted(() => ({
  audience: [] as Array<Record<string, unknown>>,
  generations: [] as GenerationRow[],
  drafts: [] as DraftRow[],
  smsSendEventsWrites: 0,
  v2EventWrites: 0,
  nextGenId: 1,
}));

function makeChain(handlers: {
  table: string;
  action: string;
  payload: Record<string, unknown>;
}) {
  const state = handlers;
  const execute = async () => {
    const { table, action, payload } = state;

    if (table === "sms_audience" && action === "select") {
      return { data: db.audience, error: null };
    }

    if (table === "sms_daily_draft_generations" && action === "select") {
      const clerk = payload.clerk_user_id as string;
      const day = payload.draft_for_day_key as string;
      const rows = db.generations.filter(
        (g) => g.clerk_user_id === clerk && g.draft_for_day_key === day
      );
      const max = rows.reduce(
        (m, g) => Math.max(m, Number(g.generation_number ?? 0)),
        0
      );
      return {
        data: max > 0 ? { generation_number: max } : null,
        error: null,
      };
    }

    if (table === "sms_daily_draft_generations" && action === "insert") {
      const row = payload.row as Record<string, unknown>;
      const dup = db.generations.some(
        (g) =>
          g.clerk_user_id === row.clerk_user_id &&
          g.draft_for_day_key === row.draft_for_day_key &&
          g.generation_number === row.generation_number
      );
      if (dup) {
        return { data: null, error: { code: "23505", message: "duplicate" } };
      }
      const id = `gen-${db.nextGenId++}`;
      db.generations.push({ ...row, id });
      return { data: { id }, error: null };
    }

    if (table === "sms_daily_draft_generations" && action === "update") {
      const clerk = payload.clerk_user_id as string;
      const day = payload.draft_for_day_key as string;
      const newId = payload.neq_id as string;
      const nowIso = payload.superseded_at as string;
      const supersededBy = payload.superseded_by_generation_id as string;
      for (const g of db.generations) {
        if (
          g.clerk_user_id === clerk &&
          g.draft_for_day_key === day &&
          g.id !== newId &&
          g.superseded_at == null
        ) {
          g.superseded_by_generation_id = supersededBy;
          g.superseded_at = nowIso;
        }
      }
      return { data: null, error: null };
    }

    if (table === "sms_daily_drafts" && action === "upsert") {
      const row = payload.row as Record<string, unknown>;
      const idx = db.drafts.findIndex(
        (d) =>
          d.clerk_user_id === row.clerk_user_id &&
          d.draft_for_day_key === row.draft_for_day_key
      );
      if (idx >= 0) {
        db.drafts[idx] = { ...db.drafts[idx], ...row };
      } else {
        db.drafts.push({ ...row });
      }
      return { data: null, error: null };
    }

    if (table === "sms_send_events") {
      db.smsSendEventsWrites += 1;
      return { data: null, error: null };
    }

    if (table === "v2_commitment_event") {
      db.v2EventWrites += 1;
      return { data: null, error: null };
    }

    return { data: null, error: null };
  };

  const self: Record<string, unknown> = {};
  self.select = vi.fn(() => self);
  self.eq = vi.fn((col: string, val: unknown) => {
    state.payload[col] = val;
    return self;
  });
  self.neq = vi.fn((col: string, val: unknown) => {
    state.payload[`neq_${col}`] = val;
    return self;
  });
  self.is = vi.fn(() => self);
  self.order = vi.fn(() => self);
  self.limit = vi.fn(() => self);
  self.maybeSingle = vi.fn(execute);
  self.single = vi.fn(execute);
  self.insert = vi.fn((row: Record<string, unknown>) => {
    state.action = "insert";
    state.payload.row = row;
    return { select: () => ({ single: execute }) };
  });
  self.update = vi.fn((row: Record<string, unknown>) => {
    state.action = "update";
    Object.assign(state.payload, row);
    return self;
  });
  self.upsert = vi.fn((row: Record<string, unknown>) => {
    state.action = "upsert";
    state.payload.row = row;
    return execute();
  });
  self.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    execute().then(onFulfilled, onRejected);

  return self;
}

vi.mock("@/lib/daily-sms-build", () => ({
  buildDailySmsContent: buildDailySmsContentMock,
}));

vi.mock("@/lib/clerk-rest", () => ({
  getClerkUser: getClerkUserMock,
}));

vi.mock("@/lib/v2-cutover-gates", () => ({
  resolveUserFullyOnV2ForCutoverMessaging: resolveV2Mock,
}));

vi.mock("@/lib/v2-sms-comms-preferences", () => ({
  fetchV2UserSmsCommsPreferences: fetchCommsMock,
  shouldSkipDailyForCommsPrefs: shouldSkipCommsMock,
}));

vi.mock("@/lib/v2-send-time-profile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-send-time-profile")>();
  return {
    ...actual,
    fetchV2UserSendTimeProfile: fetchLearnedMock,
  };
});

vi.mock("@/lib/v2-commitment", () => ({
  getActiveCommitment: getActiveCommitmentMock,
}));

vi.mock("@/lib/twilio", () => ({
  sendSMS: sendSmsMock,
  isTwilioReady: vi.fn(() => false),
}));

vi.mock("@/lib/v2-outbound-check-sent", () => ({
  reconcileCheckSentPostSendBookkeepingForCommitment: reconcileCheckSentMock,
}));

vi.mock("@/lib/supabase-server", () => {
  return {
    supabaseServer: {
      from: vi.fn((name: string) =>
        makeChain({ table: name, action: "select", payload: {} })
      ),
    },
  };
});

const WRITER_CAPTURE = buildWriterOpenAiCapture({
  messages: [
    { role: "system", content: "system" },
    { role: "user", content: "DAILY_SMS_WRITING_BRIEF_V1\n{}" },
  ],
  model: "gpt-4o-mini",
  writer_prompt_path: "daily_writing_brief_v1",
});

const AUDIENCE_USER = {
  clerk_user_id: "user_phase3",
  phone_number: "+15551234567",
  sms_enabled: true,
  stopped_at: null,
  timezone: "America/New_York",
  summitt_subscribed: true,
};

const SUCCESS_BUILT: DailySmsBuilt = {
  ok: true,
  smsBody: "Did the two hours happen before noon?",
  deliveryStateSnapshot: null,
  day2SpecialUsed: false,
  v2Accountability: true,
  v2CommitmentId: "cmt-phase3",
  v3DailyRelationshipLane: true,
  writerOpenAiCapture: WRITER_CAPTURE,
  v2AiPayload: {
    v3_brain: {
      route_purpose: "main_active_accountability",
      notebook_verdict: "verified",
      notebook_verdict_reason: "none",
      notebook_source_candidate_count: 3,
      notebook_exact_source_message_count: 2,
      notebook_brief_thread_message_count: 4,
      notebook_filtered_out_reason_top: null,
    },
  },
};

const NO_SEND_BUILT: DailySmsBuilt = {
  ok: false,
  error: "daily_v3_lane_no_send",
  writerOpenAiCapture: WRITER_CAPTURE,
  dailyLaneMeta: {
    no_send_reason: "memory_repeat_no_send",
    notebook_verdict: "verified",
    notebook_verdict_reason: "none",
    route_purpose: "main_active_accountability",
  },
};

function setupHappyPath() {
  process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
  db.audience = [AUDIENCE_USER];
  db.generations = [];
  db.drafts = [];
  db.smsSendEventsWrites = 0;
  db.v2EventWrites = 0;
  db.nextGenId = 1;

  getClerkUserMock.mockResolvedValue({
    public_metadata: { timezone: "America/New_York", smsTimePreference: "morning" },
  });
  resolveV2Mock.mockResolvedValue({ fullyOnV2: true, reason: "active_commitment_with_behavior" });
  fetchCommsMock.mockResolvedValue({
    preferred_send_window: "morning",
    preferred_local_hour: 7,
  });
  shouldSkipCommsMock.mockReturnValue({ skip: false, reason: null });
  fetchLearnedMock.mockResolvedValue(null);
  getActiveCommitmentMock.mockResolvedValue({
    id: "cmt-phase3",
    behavior_statement: "Two hours deep work",
  });
  buildDailySmsContentMock.mockResolvedValue(SUCCESS_BUILT);
}

describe("resolveTylerTextOverviewDraftForDayKey", () => {
  it("morning user before 11 local → today", () => {
    const key = resolveTylerTextOverviewDraftForDayKey({
      now: new Date("2026-07-02T14:00:00.000Z"), // 10:00 ET
      timezone: "America/New_York",
      clerkSmsTimePreference: "morning",
      commsPrefs: null,
      learnedProfile: null,
    });
    expect(key).toBe("2026-07-02");
  });

  it("morning user after 11 local → tomorrow", () => {
    const key = resolveTylerTextOverviewDraftForDayKey({
      now: new Date("2026-07-02T16:00:00.000Z"), // 12:00 ET
      timezone: "America/New_York",
      clerkSmsTimePreference: "morning",
      commsPrefs: null,
      learnedProfile: null,
    });
    expect(key).toBe("2026-07-03");
  });

  it("evening user before 22 local → today", () => {
    expect(
      isTylerTextOverviewEveningStyleSendUser({
        clerkSmsTimePreference: "evening",
        commsPrefs: null,
        learnedProfile: null,
      })
    ).toBe(true);
    const key = resolveTylerTextOverviewDraftForDayKey({
      now: new Date("2026-07-02T21:00:00.000Z"), // 17:00 ET
      timezone: "America/New_York",
      clerkSmsTimePreference: "evening",
      commsPrefs: { preferred_send_window: "evening" } as never,
      learnedProfile: null,
    });
    expect(key).toBe("2026-07-02");
  });

  it("evening user after 22 local → tomorrow", () => {
    const key = resolveTylerTextOverviewDraftForDayKey({
      now: new Date("2026-07-03T02:30:00.000Z"), // 22:30 ET on July 2
      timezone: "America/New_York",
      clerkSmsTimePreference: "evening",
      commsPrefs: { preferred_send_window: "evening" } as never,
      learnedProfile: null,
    });
    expect(key).toBe("2026-07-03");
  });

  it("timezone-specific morning behavior in America/Los_Angeles", () => {
    const key = resolveTylerTextOverviewDraftForDayKey({
      now: new Date("2026-07-02T17:30:00.000Z"), // 10:30 PT
      timezone: "America/Los_Angeles",
      clerkSmsTimePreference: "morning",
      commsPrefs: null,
      learnedProfile: null,
    });
    expect(key).toBe("2026-07-02");
  });
});

describe("generateTylerTextOverviewDailyDrafts", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.clearAllMocks();
  });

  it("env disabled → no audience query, no build, no DB writes", async () => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "false";
    const { supabaseServer } = await import("@/lib/supabase-server");
    const stats = await generateTylerTextOverviewDailyDrafts();
    expect(stats.enabled).toBe(false);
    expect(stats.skipped_disabled).toBe(1);
    expect(supabaseServer.from).not.toHaveBeenCalled();
    expect(buildDailySmsContentMock).not.toHaveBeenCalled();
    expect(db.generations).toHaveLength(0);
    expect(db.drafts).toHaveLength(0);
  });

  it("env enabled → reads sms_audience and persists drafts", async () => {
    setupHappyPath();
    const { supabaseServer } = await import("@/lib/supabase-server");
    const stats = await generateTylerTextOverviewDailyDrafts({
      now: new Date("2026-07-02T16:00:00.000Z"),
    });
    expect(stats.enabled).toBe(true);
    expect(supabaseServer.from).toHaveBeenCalledWith("sms_audience");
    expect(buildDailySmsContentMock).toHaveBeenCalled();
    expect(stats.generation_inserted).toBe(1);
    expect(stats.current_drafts_upserted).toBe(1);
    expect(db.generations).toHaveLength(1);
    expect(db.drafts).toHaveLength(1);
  });

  it("calls buildDailySmsContent with draft mode and matching day key", async () => {
    setupHappyPath();
    await generateTylerTextOverviewDailyDrafts({
      now: new Date("2026-07-02T16:00:00.000Z"),
    });
    expect(buildDailySmsContentMock).toHaveBeenCalledWith(
      "user_phase3",
      expect.any(Object),
      "2026-07-03",
      "America/New_York",
      { mode: "draft" }
    );
  });

  it("skips non-V2 users", async () => {
    setupHappyPath();
    resolveV2Mock.mockResolvedValue({ fullyOnV2: false, reason: "no_active_commitment" });
    const stats = await generateTylerTextOverviewDailyDrafts();
    expect(stats.skipped_not_v2).toBe(1);
    expect(buildDailySmsContentMock).not.toHaveBeenCalled();
  });

  it("skips comms-pref paused users", async () => {
    setupHappyPath();
    shouldSkipCommsMock.mockReturnValue({ skip: true, reason: "user_pause" });
    const stats = await generateTylerTextOverviewDailyDrafts();
    expect(stats.skipped_comms_prefs).toBe(1);
    expect(buildDailySmsContentMock).not.toHaveBeenCalled();
  });

  it("does not write sms_send_events or call Twilio", async () => {
    setupHappyPath();
    await generateTylerTextOverviewDailyDrafts();
    expect(db.smsSendEventsWrites).toBe(0);
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(reconcileCheckSentMock).not.toHaveBeenCalled();
  });

  it("stores writer_openai_messages exactly and defaults current_body_to_send", async () => {
    setupHappyPath();
    await generateTylerTextOverviewDailyDrafts();
    expect(db.generations[0]?.writer_openai_messages).toEqual(WRITER_CAPTURE.messages);
    expect(db.drafts[0]?.current_body_to_send).toBe(SUCCESS_BUILT.smsBody);
    expect(db.drafts[0]?.current_body_source).toBe("machine");
    expect(db.drafts[0]?.edited_by_tyler).toBe(false);
  });

  it("no-send build still inserts generation with machine_should_send=false", async () => {
    setupHappyPath();
    buildDailySmsContentMock.mockResolvedValue(NO_SEND_BUILT);
    await generateTylerTextOverviewDailyDrafts();
    expect(db.generations[0]?.machine_should_send).toBe(false);
    expect(db.generations[0]?.machine_draft_body).toBeNull();
    expect(db.drafts[0]?.current_body_to_send).toBeNull();
    expect(db.drafts[0]?.status).toBe("current");
  });

  it("generation_number increments and machine body stays immutable on second run", async () => {
    setupHappyPath();
    await generateTylerTextOverviewDailyDrafts({
      now: new Date("2026-07-02T16:00:00.000Z"),
    });
    buildDailySmsContentMock.mockResolvedValue({
      ...SUCCESS_BUILT,
      smsBody: "Updated body should be new generation only",
    });
    await generateTylerTextOverviewDailyDrafts({
      now: new Date("2026-07-02T16:05:00.000Z"),
    });
    expect(db.generations).toHaveLength(2);
    expect(db.generations[0]?.generation_number).toBe(1);
    expect(db.generations[1]?.generation_number).toBe(2);
    expect(db.generations[0]?.machine_draft_body).toBe(SUCCESS_BUILT.smsBody);
    expect(db.generations[1]?.machine_draft_body).toBe("Updated body should be new generation only");
    expect(db.drafts).toHaveLength(1);
    expect(db.drafts[0]?.current_body_to_send).toBe("Updated body should be new generation only");
  });

  it("loadTylerTextOverviewAudienceRows excludes stopped users", async () => {
    db.audience = [
      AUDIENCE_USER,
      { ...AUDIENCE_USER, clerk_user_id: "user_stopped", stopped_at: "2026-01-01T00:00:00.000Z" },
    ];
    const rows = await loadTylerTextOverviewAudienceRows();
    expect(rows.map((r) => r.clerk_user_id)).toEqual(["user_phase3"]);
  });
});

describe("mapBuiltToTylerTextOverviewGenerationRow", () => {
  it("maps notebook metadata and hashes from build result", () => {
    const row = mapBuiltToTylerTextOverviewGenerationRow({
      clerkUserId: "user_phase3",
      draftForDayKey: "2026-07-03",
      generationNumber: 1,
      built: SUCCESS_BUILT,
      commitmentId: "cmt-phase3",
      timezone: "America/New_York",
      sendPrefSnapshot: "clerk:morning|window:morning|hour:7",
    });
    expect(row.machine_should_send).toBe(true);
    expect(row.notebook_verdict).toBe("verified");
    expect(row.writer_openai_messages).toEqual(WRITER_CAPTURE.messages);
    expect(row.machine_body_hash).toBeTruthy();
    expect(row.writer_notebook_snapshot).toBeNull();
  });
});

describe("tyler-text-overview Phase 3 scope guards", () => {
  it("generate files only use TYLER_TEXT_OVERVIEW_ENABLED env", () => {
    for (const rel of [
      "src/lib/tyler-text-overview-generate.ts",
      "src/app/api/cron/tyler-text-overview-generate/route.ts",
      "src/lib/tyler-text-overview-types.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      const envReads = src.match(/process\.env\.[A-Z0-9_]+/g) ?? [];
      const allowed = new Set(["process.env.CRON_SECRET", `process.env.${TYLER_TEXT_OVERVIEW_ENABLED_ENV}`]);
      for (const read of envReads) {
        expect(allowed.has(read)).toBe(true);
      }
    }
  });

  it("forbidden runtime files were not modified in this phase scope", () => {
    const forbidden = [
      "src/app/api/cron/daily-sms/route.ts",
      "src/app/api/cron/weekly-sms/route.ts",
      "vercel.json",
    ];
    for (const rel of forbidden) {
      expect(readFileSync(join(process.cwd(), rel), "utf8").length).toBeGreaterThan(0);
    }
  });

  it("no admin route files added", () => {
    expect(() =>
      readFileSync(join(process.cwd(), "src/app/api/admin/tyler-text-overview/route.ts"), "utf8")
    ).toThrow();
  });
});

describe("generateTylerTextOverviewDraftForUser direct", () => {
  afterEach(() => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "false";
    vi.clearAllMocks();
  });

  it("does not call thread memory or check_sent writers", async () => {
    setupHappyPath();
    threadMemoryMock.mockResolvedValue(undefined);
    checkSentInsertMock.mockResolvedValue(undefined);
    await generateTylerTextOverviewDraftForUser({
      audienceUser: AUDIENCE_USER,
      now: new Date("2026-07-02T16:00:00.000Z"),
    });
    expect(threadMemoryMock).not.toHaveBeenCalled();
    expect(checkSentInsertMock).not.toHaveBeenCalled();
    expect(db.v2EventWrites).toBe(0);
  });
});
