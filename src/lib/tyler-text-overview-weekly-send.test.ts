import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  assertWeeklyTtoDraftAuthoritativeForCronSend,
  assertWeeklyTtoDraftAuthoritativeForManualSend,
  buildWeeklyTtoFinalBodyWithFooter,
  sendWeeklyTtoDraftAuthoritative,
  sendWeeklyTtoDraftManually,
  sendWeeklyTtoDraftViaCron,
  WEEKLY_TTO_COMPLIANCE_FOOTER,
  WEEKLY_TTO_CRON_SEND_SOURCE,
  WEEKLY_TTO_MANUAL_SEND_SOURCE,
} from "@/lib/tyler-text-overview-weekly-send";
import {
  isWeeklyManualSendEligible,
  weeklySendButtonLabel,
  WEEKLY_TTO_AUTHORITY_BANNER,
  WEEKLY_TTO_FOOTER_AT_SEND_COPY,
  WEEKLY_TTO_MANUAL_SEND_NOTE,
  WEEKLY_TTO_SAVE_BEFORE_SEND_COPY,
  EVENING_TTO_SAVE_BEFORE_SEND_COPY,
  eveningSendButtonLabel,
} from "@/lib/tyler-text-overview-dashboard-copy";

const sendSmsMock = vi.hoisted(() => vi.fn());
const isTwilioReadyMock = vi.hoisted(() => vi.fn());
const loadAudienceMock = vi.hoisted(() => vi.fn());
const resolveV2Mock = vi.hoisted(() => vi.fn());
const fetchCommsMock = vi.hoisted(() => vi.fn());
const isPauseActiveMock = vi.hoisted(() => vi.fn());
const getActiveCommitmentMock = vi.hoisted(() => vi.fn());
const upsertThreadMemoryMock = vi.hoisted(() => vi.fn());

const db = vi.hoisted(() => ({
  drafts: [] as Array<Record<string, unknown>>,
  generations: [] as Array<Record<string, unknown>>,
  weeklyEvents: [] as Array<Record<string, unknown>>,
  sendEvents: [] as Array<Record<string, unknown>>,
  commitmentEvents: [] as Array<Record<string, unknown>>,
  inboundJobs: [] as Array<Record<string, unknown>>,
  inboundJobLookupError: null as { message: string } | null,
  forceWeeklyInsertError: null as { code?: string; message?: string } | null,
  forceReserveRpcError: null as string | null,
  reserveReturnedBody: null as string | null,
  smsSendEventsInsertCount: 0,
  checkSentWriteCount: 0,
  commitmentEventInsertCount: 0,
}));

const WEEKLY_BODY = "This week you showed up three times. What made that possible?";
const COMMITMENT_ID = "commit-weekly-1";
const WEEK_KEY = "2026-W29";

function seedWeeklyDraft(overrides?: {
  draft?: Partial<Record<string, unknown>>;
  generation?: Partial<Record<string, unknown>>;
}) {
  db.drafts = [
    {
      id: "draft-weekly-1",
      clerk_user_id: "user_weekly",
      draft_for_day_key: "2026-07-12",
      send_slot: "weekly_review",
      current_generation_id: "gen-weekly-1",
      current_body_to_send: WEEKLY_BODY,
      status: "current",
      updated_at: new Date().toISOString(),
      ...overrides?.draft,
    },
  ];
  db.generations = [
    {
      id: "gen-weekly-1",
      send_slot: "weekly_review",
      commitment_id: COMMITMENT_ID,
      machine_should_send: true,
      machine_no_send_reason: null,
      timezone_snapshot: "America/New_York",
      generation_metadata: {
        week_key: WEEK_KEY,
        week_start: "2026-07-06",
        week_end: "2026-07-12",
        timezone: "America/New_York",
        send_slot: "weekly_review",
        draft_excludes_compliance_footer: true,
      },
      ...overrides?.generation,
    },
  ];
  db.weeklyEvents = [];
  db.sendEvents = [];
  db.commitmentEvents = [];
  db.inboundJobs = [];
  db.inboundJobLookupError = null;
  db.forceWeeklyInsertError = null;
  db.forceReserveRpcError = null;
  db.reserveReturnedBody = null;
  db.smsSendEventsInsertCount = 0;
  db.checkSentWriteCount = 0;
  db.commitmentEventInsertCount = 0;
}

function makeChain(state: {
  table: string;
  action: string;
  payload: Record<string, unknown>;
  insertPayload?: Record<string, unknown>;
  updatePayload?: Record<string, unknown>;
}) {
  const execute = async () => {
    const { table, payload } = state;

    if (table === "sms_daily_drafts" && state.action === "select") {
      let rows = [...db.drafts];
      if (payload.id) rows = rows.filter((d) => d.id === payload.id);
      if (payload.clerk_user_id) {
        rows = rows.filter((d) => d.clerk_user_id === payload.clerk_user_id);
      }
      if (payload.send_slot) {
        rows = rows.filter((d) => d.send_slot === payload.send_slot);
      }
      if (payload.status) {
        rows = rows.filter((d) => d.status === payload.status);
      }
      return { data: payload.maybeSingle ? rows[0] ?? null : rows, error: null };
    }

    if (table === "sms_daily_draft_generations" && state.action === "select") {
      const row = db.generations.find((g) => g.id === payload.id) ?? null;
      return { data: row, error: null };
    }

    if (table === "sms_inbound_coach_jobs" && state.action === "select") {
      if (
        db.inboundJobLookupError &&
        payload.status === "awaiting_sms_opt_out_review"
      ) {
        return { data: null, error: db.inboundJobLookupError };
      }
      let rows = [...db.inboundJobs];
      if (payload.clerk_user_id) {
        rows = rows.filter((j) => j.clerk_user_id === payload.clerk_user_id);
      }
      if (payload.status) {
        rows = rows.filter((j) => j.status === payload.status);
      }
      return { data: payload.maybeSingle ? rows[0] ?? null : rows, error: null };
    }

    if (table === "sms_weekly_send_events" && state.action === "insert") {
      if (db.forceWeeklyInsertError) {
        return { data: null, error: db.forceWeeklyInsertError };
      }
      const existing = db.weeklyEvents.find(
        (e) =>
          e.clerk_user_id === state.insertPayload?.clerk_user_id &&
          e.week_key === state.insertPayload?.week_key
      );
      if (existing) {
        return {
          data: null,
          error: { code: "23505", message: "duplicate key value violates unique constraint" },
        };
      }
      const row = {
        id: `weekly-evt-${db.weeklyEvents.length + 1}`,
        ...state.insertPayload,
      };
      db.weeklyEvents.push(row);
      return { data: { id: row.id }, error: null };
    }

    if (table === "sms_weekly_send_events" && state.action === "update") {
      const row = db.weeklyEvents.find(
        (e) =>
          e.clerk_user_id === payload.clerk_user_id && e.week_key === payload.week_key
      );
      if (row && state.updatePayload) Object.assign(row, state.updatePayload);
      return { data: null, error: null };
    }

    if (table === "sms_send_events" && state.action === "insert") {
      db.smsSendEventsInsertCount += 1;
      db.sendEvents.push({ id: `sse-${db.sendEvents.length + 1}`, ...state.insertPayload });
      return { data: { id: `sse-${db.sendEvents.length}` }, error: null };
    }

    if (table === "sms_send_events") {
      return { data: null, error: null };
    }

    if (table === "v2_commitment_event" && state.action === "insert") {
      db.commitmentEventInsertCount += 1;
      db.checkSentWriteCount += 1;
      return { data: null, error: null };
    }

    if (table === "sms_daily_drafts" && state.action === "update") {
      const draft = db.drafts.find((d) => d.id === payload.id && d.status === payload.status);
      if (draft && state.updatePayload) Object.assign(draft, state.updatePayload);
      return { data: draft ?? null, error: null };
    }

    if (table === "sms_daily_draft_generations" && state.action === "update") {
      const gen = db.generations.find((g) => g.id === payload.id);
      if (gen && state.updatePayload) {
        if (state.updatePayload.generation_metadata != null) {
          gen.generation_metadata = state.updatePayload.generation_metadata;
        }
        Object.assign(gen, state.updatePayload);
      }
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
  self.insert = vi.fn((row: Record<string, unknown>) => {
    state.action = "insert";
    state.insertPayload = row;
    return {
      select: vi.fn(() => ({
        maybeSingle: vi.fn(execute),
      })),
    };
  });
  self.update = vi.fn((row: Record<string, unknown>) => {
    state.action = "update";
    state.updatePayload = row;
    return self;
  });
  self.maybeSingle = vi.fn(() => {
    state.payload.maybeSingle = true;
    return execute();
  });
  self.limit = vi.fn(() => self);
  self.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    execute().then(onFulfilled, onRejected);

  return self;
}

function simulateWeeklyReserve(args: Record<string, unknown>) {
  if (db.forceReserveRpcError) {
    return { data: null, error: { message: db.forceReserveRpcError } };
  }
  const clerk = args.p_clerk_user_id;
  const weekKey = args.p_week_key;
  const source = args.p_send_source;
  const existing = db.weeklyEvents.find(
    (event) => event.clerk_user_id === clerk && event.week_key === weekKey
  );
  if (existing) {
    return { data: [{ ok: false, reason: "duplicate_weekly_send" }], error: null };
  }
  const drafts = db.drafts
    .filter(
      (draft) =>
        draft.clerk_user_id === clerk &&
        draft.send_slot === "weekly_review" &&
        draft.status === "current"
    )
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const matches: Array<{ draft: Record<string, unknown>; gen: Record<string, unknown> | undefined }> =
    [];
  for (const draft of drafts) {
    const gen = db.generations.find((row) => row.id === draft.current_generation_id);
    const meta = (gen?.generation_metadata ?? {}) as Record<string, unknown>;
    if (meta.week_key === weekKey) matches.push({ draft, gen });
  }
  if (matches.length === 0) return { data: [{ ok: false, reason: "no_draft" }], error: null };
  if (matches.length > 1) {
    return { data: [{ ok: false, reason: "ambiguous_weekly_draft" }], error: null };
  }
  const { draft, gen } = matches[0]!;
  const storedBody =
    typeof draft.current_body_to_send === "string" ? draft.current_body_to_send.trim() : "";
  if (!storedBody) return { data: [{ ok: false, reason: "blank_body" }], error: null };
  const meta = (gen?.generation_metadata ?? {}) as Record<string, unknown>;
  const note =
    source === "weekly_tto_cron"
      ? "reserved_by_weekly_tto_cron"
      : "reserved_by_weekly_tto_manual_send";
  const row = {
    id: `weekly-evt-${db.weeklyEvents.length + 1}`,
    clerk_user_id: clerk,
    week_key: weekKey,
    status: "reserved",
    metadata: {
      send_source: source,
      draft_id: draft.id,
      generation_id: draft.current_generation_id,
      week_key: weekKey,
      week_start: meta.week_start ?? null,
      week_end: meta.week_end ?? null,
      draft_for_day_key: draft.draft_for_day_key,
      timezone: gen?.timezone_snapshot ?? meta.timezone ?? null,
      note,
    },
  };
  db.weeklyEvents.push(row);
  return {
    data: [
      {
        ok: true,
        reason: "reserved",
        event_id: row.id,
        draft_id: draft.id,
        generation_id: draft.current_generation_id,
        body: db.reserveReturnedBody ?? storedBody,
        week_start: meta.week_start ?? null,
        week_end: meta.week_end ?? null,
        draft_for_day_key: draft.draft_for_day_key,
        timezone: gen?.timezone_snapshot ?? meta.timezone ?? null,
      },
    ],
    error: null,
  };
}

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn((table: string) => makeChain({ table, action: "select", payload: {} })),
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn !== "weekly_tto_reserve_send") {
        return { data: null, error: { message: `missing_rpc:${fn}` } };
      }
      return simulateWeeklyReserve(args ?? {});
    }),
  },
}));

vi.mock("@/lib/twilio", () => ({
  sendSMS: sendSmsMock,
  isTwilioReady: isTwilioReadyMock,
}));

vi.mock("@/lib/account-deletion/deletion-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/account-deletion/deletion-guards")>();
  return {
    ...actual,
    evaluateOutboundSmsForAccountDeletion: vi.fn(async () => ({
      decision: "allowed" as const,
    })),
  };
});

vi.mock("@/lib/tyler-text-overview-generate", () => ({
  loadTylerTextOverviewAudienceRow: loadAudienceMock,
}));

vi.mock("@/lib/v2-cutover-gates", () => ({
  resolveUserFullyOnV2ForCutoverMessaging: resolveV2Mock,
}));

vi.mock("@/lib/v2-sms-comms-preferences", () => ({
  fetchV2UserSmsCommsPreferences: fetchCommsMock,
  isPauseActive: isPauseActiveMock,
}));

vi.mock("@/lib/v2-commitment", () => ({
  getActiveCommitment: getActiveCommitmentMock,
}));

vi.mock("@/lib/v2-commitment-sms-thread-memory", () => ({
  upsertCommitmentSmsThreadMemoryFromOutbound: upsertThreadMemoryMock,
}));

const ensureCurrentTtoDraftFreshForSend = vi.hoisted(() =>
  vi.fn(async () => ({
    ok: true as const,
    status: "fresh" as const,
    draftId: "draft-weekly-1",
    currentBodyToSend: "This week you showed up three times. What made that possible?",
    currentGenerationId: "gen-weekly-1",
  }))
);
const savedProactiveSentenceOutgrownByRealConversation = vi.hoisted(() =>
  vi.fn(async () => "current" as const)
);
vi.mock("@/lib/tto-draft-fresh-for-send", () => ({
  ensureCurrentTtoDraftFreshForSend,
  savedProactiveSentenceOutgrownByRealConversation,
}));

const REPO = process.cwd();

describe("assertWeeklyTtoDraftAuthoritativeForManualSend", () => {
  beforeEach(() => {
    seedWeeklyDraft();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires weekly_review current draft", async () => {
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "draft-weekly-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.weekKey).toBe(WEEK_KEY);
    expect(result.draft.bodyWithoutFooter).toBe(WEEKLY_BODY);
  });

  it("blocks wrong slot", async () => {
    seedWeeklyDraft({ draft: { send_slot: "morning" } });
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "draft-weekly-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("wrong_slot");
  });

  it("blocks no draft", async () => {
    db.drafts = [];
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "missing",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("no_draft");
  });

  it("blocks sent / non-current draft", async () => {
    seedWeeklyDraft({ draft: { status: "sent" } });
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "draft-weekly-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("draft_not_current");
  });

  it("blocks missing generation", async () => {
    seedWeeklyDraft({ draft: { current_generation_id: null } });
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "draft-weekly-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("missing_generation");
  });

  it("blocks week_key mismatch", async () => {
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "draft-weekly-1",
      weekKey: "2026-W28",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("week_key_mismatch");
  });

  it("blocks blank body", async () => {
    seedWeeklyDraft({ draft: { current_body_to_send: "   " } });
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "draft-weekly-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("blank_body");
  });

  it("blocks machine_should_send=false", async () => {
    seedWeeklyDraft({
      generation: { machine_should_send: false, machine_no_send_reason: "no_safe_voice" },
    });
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "draft-weekly-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("machine_should_send_false");
  });

  it("allows a nonempty Tyler edit when machine_should_send=false", async () => {
    seedWeeklyDraft({
      draft: {
        edited_by_tyler: true,
        current_body_source: "tyler_edit",
        current_body_to_send: WEEKLY_BODY,
      },
      generation: { machine_should_send: false, machine_no_send_reason: "openai_429" },
    });
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "draft-weekly-1",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects editable body over 1555 before send", async () => {
    seedWeeklyDraft({
      draft: { current_body_to_send: "x".repeat(1556) },
    });
    const result = await assertWeeklyTtoDraftAuthoritativeForManualSend({
      draftId: "draft-weekly-1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("body_too_long");
  });
});

describe("retired weekly send functions", () => {
  it("manual, cron, and shared send refuse before Twilio, reservation, or a draft write", async () => {
    const manual = await sendWeeklyTtoDraftManually({
      draftId: "draft-weekly-1",
      requestedByClerkUserId: "admin_tyler",
    });
    const cron = await sendWeeklyTtoDraftViaCron({
      clerkUserId: "user_weekly",
      weekKey: "2026-W28",
      phoneTo: "+15551234567",
    });
    const authoritative = await sendWeeklyTtoDraftAuthoritative({
      draft: {
        draftId: "draft-weekly-1",
        clerkUserId: "user_weekly",
        weekKey: "2026-W28",
        currentBodyToSend: "A saved weekly body",
        generationId: "gen-1",
      } as never,
      sendSource: WEEKLY_TTO_CRON_SEND_SOURCE,
      phoneTo: "+15551234567",
    });
    for (const result of [manual, cron, authoritative]) {
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.refusalCode).toBe("weekly_delivery_retired");
    }
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("the send functions do not contain a model, reservation, or provider path", () => {
    const src = readFileSync(join(REPO, "src/lib/tyler-text-overview-weekly-send.ts"), "utf8");
    const fns = src.slice(src.indexOf("export async function sendWeeklyTtoDraftAuthoritative"));
    expect(fns).toContain("weekly_delivery_retired");
    expect(fns).not.toContain("sendSMS");
    expect(fns).not.toContain("weekly_tto_reserve_send");
    expect(fns).not.toContain("ensureCurrentTtoDraftFreshForSend");
    expect(fns).not.toContain("runWeeklyBriefInterpreterV1");
    expect(fns).not.toContain("writeWeeklyTtoBody");
    expect(fns).not.toContain("persistMorningTtoGeneration");
    expect(fns).not.toContain(".update(");
    expect(fns).not.toContain(".insert(");
  });
});

describe("assertWeeklyTtoDraftAuthoritativeForCronSend", () => {
  beforeEach(() => {
    seedWeeklyDraft();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads current weekly_review draft by clerk_user_id + week_key", async () => {
    const result = await assertWeeklyTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_weekly",
      weekKey: WEEK_KEY,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.draftId).toBe("draft-weekly-1");
    expect(result.draft.bodyWithoutFooter).toBe(WEEKLY_BODY);
  });

  it("no draft = no_draft", async () => {
    db.drafts = [];
    const result = await assertWeeklyTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_weekly",
      weekKey: WEEK_KEY,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("no_draft");
  });

  it("week_key mismatch blocks", async () => {
    const result = await assertWeeklyTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_weekly",
      weekKey: "2026-W28",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("week_key_mismatch");
  });

  it("ambiguous multiple current drafts for same week blocks", async () => {
    db.drafts.push({
      id: "draft-weekly-2",
      clerk_user_id: "user_weekly",
      draft_for_day_key: "2026-07-12",
      send_slot: "weekly_review",
      current_generation_id: "gen-weekly-2",
      current_body_to_send: "Second draft",
      status: "current",
    });
    db.generations.push({
      id: "gen-weekly-2",
      send_slot: "weekly_review",
      commitment_id: COMMITMENT_ID,
      machine_should_send: true,
      generation_metadata: { week_key: WEEK_KEY },
    });
    const result = await assertWeeklyTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_weekly",
      weekKey: WEEK_KEY,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.refusalCode).toBe("ambiguous_weekly_draft");
  });

  it("blank body / machine false / missing generation block", async () => {
    seedWeeklyDraft({ draft: { current_body_to_send: "  " } });
    let result = await assertWeeklyTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_weekly",
      weekKey: WEEK_KEY,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.result.refusalCode).toBe("blank_body");

    seedWeeklyDraft({ generation: { machine_should_send: false } });
    result = await assertWeeklyTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_weekly",
      weekKey: WEEK_KEY,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.result.refusalCode).toBe("machine_should_send_false");

    seedWeeklyDraft({ draft: { current_generation_id: null } });
    result = await assertWeeklyTtoDraftAuthoritativeForCronSend({
      clerkUserId: "user_weekly",
      weekKey: WEEK_KEY,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.result.refusalCode).toBe("missing_generation");
  });
});

describe("weekly send route / UI static contracts", () => {
  it("route exists and is POST-only one-row", () => {
    const routePath = join(
      REPO,
      "src/app/api/admin/tyler-text-overview/weekly-send/route.ts"
    );
    expect(existsSync(routePath)).toBe(true);
    const src = readFileSync(routePath, "utf8");
    expect(src).toContain("requireTylerAdmin");
    expect(src).toContain("weekly_delivery_retired");
    expect(src).not.toContain("sendWeeklyTtoDraftManually");
    expect(src).not.toContain("sendSMS");
    expect(src).not.toContain("export async function GET");
  });

  it("UI shows Send Weekly Text only via eligibility helper path", () => {
    const dash = readFileSync(
      join(REPO, "src/app/admin/tyler-text-overview/tyler-text-overview-weekly-dashboard.tsx"),
      "utf8"
    );
    expect(dash).toContain("weeklySendButtonLabel");
    expect(dash).toContain("weekly-send");
    expect(dash).toContain("isWeeklyManualSendEligible");
    expect(dash).toContain("WEEKLY_TTO_SAVE_BEFORE_SEND_COPY");
    expect(dash).toContain("WEEKLY_TTO_FOOTER_AT_SEND_COPY");
    expect(dash).toContain("confirmSendRow.currentBodyToSend");
    expect(dash).not.toContain("Send all");
    expect(dash).toContain("WEEKLY_TTO_BULK_APPLY_TITLE");
    expect(dash).toContain("/api/admin/tyler-text-overview/weekly-bulk-save");
    expect(dash.toLowerCase()).not.toContain("cron cutover");
  });

  it("eligibility helper gates correctly", () => {
    const base = {
      rowState: "draft_current" as const,
      draftStatus: "current",
      sendSlot: "weekly_review",
      draftId: "d1",
      currentBodyToSend: WEEKLY_BODY,
      machineShouldSend: true as boolean | null,
      dirty: false,
      sending: false,
    };
    expect(isWeeklyManualSendEligible(base)).toBe(true);
    expect(isWeeklyManualSendEligible({ ...base, dirty: true })).toBe(false);
    expect(isWeeklyManualSendEligible({ ...base, machineShouldSend: false })).toBe(false);
    expect(
      isWeeklyManualSendEligible({
        ...base,
        machineShouldSend: false,
        editedByTyler: true,
        currentBodySource: "tyler_edit",
      })
    ).toBe(true);
    expect(isWeeklyManualSendEligible({ ...base, currentBodyToSend: "  " })).toBe(false);
    expect(isWeeklyManualSendEligible({ ...base, rowState: "draft_sent" })).toBe(false);
    expect(isWeeklyManualSendEligible({ ...base, sendSlot: "morning" })).toBe(false);
  });

  it("copy labels exist and morning/evening labels unchanged", () => {
    expect(weeklySendButtonLabel(false)).toBe("Send Weekly Text");
    expect(weeklySendButtonLabel(true)).toBe("Sending Weekly Text…");
    expect(WEEKLY_TTO_SAVE_BEFORE_SEND_COPY).toBe("Save changes before sending.");
    expect(WEEKLY_TTO_MANUAL_SEND_NOTE).toContain("sends this saved Weekly TTO draft now");
    expect(WEEKLY_TTO_MANUAL_SEND_NOTE).toContain("draft-authoritative");
    expect(WEEKLY_TTO_MANUAL_SEND_NOTE).toContain("sms_weekly_send_events");
    expect(WEEKLY_TTO_MANUAL_SEND_NOTE).toContain("cron will not send another one");
    expect(WEEKLY_TTO_MANUAL_SEND_NOTE).not.toContain("does not change the weekly cron yet");
    expect(WEEKLY_TTO_FOOTER_AT_SEND_COPY).toContain("STOP/HELP");
    expect(WEEKLY_TTO_AUTHORITY_BANNER).toContain("draft-authoritative");
    expect(WEEKLY_TTO_AUTHORITY_BANNER).toContain("only sends current Weekly TTO drafts");
    expect(WEEKLY_TTO_AUTHORITY_BANNER).not.toContain("not cut over yet");
    expect(eveningSendButtonLabel(false)).toBe("Send Evening Text");
    expect(EVENING_TTO_SAVE_BEFORE_SEND_COPY).toBe("Save changes before sending.");
  });
});

describe("weekly send does not touch forbidden paths", () => {
  it("weekly-sms cron refuses before a provider submission", () => {
    const src = readFileSync(join(REPO, "src/app/api/cron/weekly-sms/route.ts"), "utf8");
    expect(src).toContain("weekly_delivery_retired");
    expect(src).toContain("force_ignored");
    expect(src).not.toContain("sendWeeklyTtoDraftAuthoritative");
    expect(src).not.toContain("produceWeeklyV3RelationshipSms");
    expect(src).not.toContain("buildV2WeeklyProofPack");
  });

  it("vercel.json does not schedule weekly-sms", () => {
    const vercel = readFileSync(join(REPO, "vercel.json"), "utf8");
    expect(vercel).not.toContain("/api/cron/weekly-sms");
    expect(vercel).not.toContain("weekly-tto");
  });

  it("the send module does not reserve or submit a weekly text", () => {
    const src = readFileSync(join(REPO, "src/lib/tyler-text-overview-weekly-send.ts"), "utf8");
    expect(src).toContain("weekly_delivery_retired");
    expect(src).not.toContain("weekly_tto_reserve_send");
    expect(src).not.toContain("sendSMS");
    expect(src).not.toContain(".insert(");
    expect(src).not.toContain("updateTylerTextOverviewDraftBody");
  });
});

