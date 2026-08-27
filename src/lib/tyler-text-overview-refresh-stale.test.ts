import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildWriterOpenAiCapture } from "@/lib/tyler-text-overview-writer-capture";
import { resolveCanonicalMorningTtoBatchDraftForDayKey } from "@/lib/tyler-text-overview-draft-day-key";
import type { DailySmsBuilt } from "@/lib/daily-sms-build";
import {
  findStaleTylerTextOverviewCurrentDrafts,
  parseTylerTextOverviewStaleRefreshReason,
  refreshStaleTylerTextOverviewDrafts,
} from "@/lib/tyler-text-overview-refresh-stale";
import {
  isProtectedFromMorningDraftOverwrite,
  isProtectedTtoCurrentDraftBody,
  isProtectedTylerProvenanceDraft,
  TYLER_TEXT_OVERVIEW_ENABLED_ENV,
} from "@/lib/tyler-text-overview-types";

const buildDailySmsContentMock = vi.hoisted(() => vi.fn());
const loadMorningPacketMock = vi.hoisted(() => vi.fn());
const writeMorningTtoBodyMock = vi.hoisted(() => vi.fn());
const getClerkUserMock = vi.hoisted(() => vi.fn());
const resolveV2Mock = vi.hoisted(() => vi.fn());
const fetchCommsMock = vi.hoisted(() => vi.fn());
const shouldSkipCommsMock = vi.hoisted(() => vi.fn());
const fetchLearnedMock = vi.hoisted(() => vi.fn());
const getActiveCommitmentMock = vi.hoisted(() => vi.fn());
const sendSmsMock = vi.hoisted(() => vi.fn());
const reconcileCheckSentMock = vi.hoisted(() => vi.fn());
const validateCronSecretMock = vi.hoisted(() => vi.fn());

type GenerationRow = Record<string, unknown> & { id: string };
type DraftRow = Record<string, unknown> & { id: string };

const db = vi.hoisted(() => ({
  audience: [] as Array<Record<string, unknown>>,
  generations: [] as GenerationRow[],
  drafts: [] as DraftRow[],
  inbound: [] as Array<Record<string, unknown>>,
  smsSendEventsWrites: 0,
  v2EventWrites: 0,
  nextGenId: 1,
  fromCalls: [] as string[],
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
      if (payload.clerk_user_id) {
        const row =
          db.audience.find((a) => a.clerk_user_id === payload.clerk_user_id) ?? null;
        return { data: payload.maybeSingle ? row : row ? [row] : [], error: null };
      }
      return { data: db.audience, error: null };
    }

    if (table === "sms_daily_drafts" && action === "select") {
      let rows = db.drafts;
      if (payload.status) rows = rows.filter((d) => d.status === payload.status);
      if (payload.send_slot) {
        rows = rows.filter((d) => (d.send_slot ?? "morning") === payload.send_slot);
      }
      if (payload.clerk_user_id) {
        rows = rows.filter((d) => d.clerk_user_id === payload.clerk_user_id);
      }
      if (payload.draft_for_day_key) {
        rows = rows.filter((d) => d.draft_for_day_key === payload.draft_for_day_key);
      }
      if (payload.id) rows = rows.filter((d) => d.id === payload.id);
      return { data: payload.maybeSingle ? rows[0] ?? null : rows, error: null };
    }

    if (table === "sms_daily_draft_generations" && action === "select") {
      if (payload.id) {
        const row = db.generations.find((g) => g.id === payload.id) ?? null;
        return { data: row, error: null };
      }
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

    if (table === "sms_inbound_messages" && action === "select") {
      const after = payload.gt_received_at as string;
      const rows = db.inbound
        .filter(
          (m) =>
            m.clerk_user_id === payload.clerk_user_id &&
            typeof m.received_at === "string" &&
            (m.received_at as string) > after
        )
        .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
      return { data: payload.maybeSingle ? rows[0] ?? null : rows, error: null };
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
      db.generations.push({ ...row, id, generated_at: row.generated_at ?? new Date().toISOString() });
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
        db.drafts.push({ ...row, id: `draft-${db.drafts.length + 1}` } as DraftRow);
      }
      return { data: null, error: null };
    }

    if (table === "sms_send_events") {
      if (action === "select") {
        return { data: [], error: null };
      }
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
  self.gt = vi.fn((col: string, val: unknown) => {
    if (col === "received_at") state.payload.gt_received_at = val;
    return self;
  });
  self.is = vi.fn(() => self);
  self.order = vi.fn(() => self);
  self.limit = vi.fn(() => self);
  self.maybeSingle = vi.fn(() => {
    state.payload.maybeSingle = true;
    return execute();
  });
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

vi.mock("@/lib/morning-tto-relationship-packet", () => ({
  loadMorningRelationshipPacket: loadMorningPacketMock,
}));

vi.mock("@/lib/morning-tto-writer", () => ({
  writeMorningTtoBody: writeMorningTtoBodyMock,
}));

vi.mock("@/lib/morning-tto-brief-canonical-load-v1", () => ({
  loadMorningBriefCanonicalExtrasV1: vi.fn(async () => ({
    importantPeople: [],
    outcomeSpine: {
      latestOutcome: null,
      latestOutcomeAt: null,
      latestOutcomeMessage: null,
      matchingOutcomeCount: 0,
      hasVerifiedProofMetadata: false,
    },
    threadMemoryHint: null,
  })),
  assembleMorningBriefInterpreterInputFromPacket: vi.fn(({ packet }) => ({
    version: "morning_brief_interpreter_input_v1",
    message_for: {
      timezone: "America/New_York",
      local_date: "2026-07-03",
      local_weekday: "Friday",
      daypart: "morning",
    },
    mechanical: {
      days_since_last_user_response: 1,
      never_replied: false,
      recent_unanswered_outbound_count: 0,
    },
    canonical_goal: { text: "Two hours deep work" },
    pending_goal_change: null,
    available_identity: null,
    available_important_people: [],
    available_life_context: [],
    truth_spine: {
      latest_outcome: null,
      latest_outcome_at: null,
      latest_outcome_message: null,
      evidence_strength: "none",
      consistency_supported: false,
      proof_claims_allowed: {
        completion: false,
        miss: false,
        partial: false,
        proof: false,
      },
    },
    thread_memory_hint: null,
    historical_evidence: packet.historical_evidence ?? [],
    exact_thread: packet.exact_thread ?? {
      window_days: 21,
      max_messages: 30,
      messages: [],
      omitted_older_turn_count: 0,
    },
  })),
  countRecentUnansweredOutboundFromExactThread: vi.fn(() => 0),
}));

const runInterpreterMock = vi.hoisted(() =>
  vi.fn(async () => ({
    ok: false,
    error: "openai_unavailable",
    brief: {
      version: "morning_coaching_brief_v1",
      confidence: "low",
      human_situation: {
        most_alive: "unknown",
        direct_question_or_need: "unknown",
        relevant_life_event: "unknown",
        context_use: "unknown",
        identity_use: "unknown",
        person_use: "unknown",
        selected_person: null,
        selected_person_reason: null,
      },
      truth_and_evidence: {
        latest_user_truth: null,
        outcome: "no_recent_evidence",
        evidence_note: "unknown",
        evidence_strength: "none",
        consistency_supported: false,
        proof_claims_allowed: {
          completion: false,
          miss: false,
          partial: false,
          proof: false,
        },
      },
      conversation_continuity: {
        already_acknowledged: "unknown",
        answered_question: "unknown",
        open_loop: "unknown",
        stale_or_exhausted_topics: "unknown",
        do_not_repeat: "unknown",
      },
      goal_role_today: {
        canonical_goal: "Two hours deep work",
        pending_goal: null,
        goal_alignment: "unknown",
        role: "unknown",
        note: "unknown",
      },
      coaching_direction: {
        primary_move: "unknown",
        question_policy: "unknown",
        action_guidance: "unknown",
        pressure: "unknown",
        proactive_decision: "send",
      },
      boundaries: {
        claims_to_avoid: [],
        topics_not_to_force: [],
        unsupported_capabilities: [],
        goal_authority_boundaries: [],
        identity_people_boundaries: [],
        coach_history_is_not_style: "history",
      },
    },
    capture: {
      capture_version: "morning_brief_interpreter_capture_v1",
      model: "gpt-5.6-sol",
      temperature: null,
      reasoning_effort: "low",
      max_completion_tokens: 2500,
      prompt_path: "morning_brief_interpreter_v1",
      system_message: "sys",
      user_message: "user",
      canonical_input: { version: "morning_brief_interpreter_input_v1" },
      raw_response: null,
      parsed_brief: null,
      error: "openai_unavailable",
      request_started_at: null,
      request_completed_at: null,
      latency_ms: null,
      retry: null,
    },
  }))
);

vi.mock("@/lib/morning-tto-brief-interpreter-v1", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/morning-tto-brief-interpreter-v1")>();
  return {
    ...actual,
    runMorningBriefInterpreterV1: runInterpreterMock,
  };
});

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

vi.mock("@/lib/cron-auth", () => ({
  validateCronSecretRequest: validateCronSecretMock,
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn((name: string) => {
      db.fromCalls.push(name);
      return makeChain({ table: name, action: "select", payload: {} });
    }),
  },
}));

const WRITER_CAPTURE = buildWriterOpenAiCapture({
  messages: [
    { role: "system", content: "system" },
    { role: "user", content: "DAILY_SMS_WRITING_BRIEF_V1\n{}" },
  ],
  model: "gpt-4o-mini",
  writer_prompt_path: "daily_writing_brief_v1",
});

const AUDIENCE_USER = {
  clerk_user_id: "user_stale",
  phone_number: "+15551234567",
  sms_enabled: true,
  stopped_at: null,
  timezone: "America/New_York",
  summitt_subscribed: true,
};

const SUCCESS_BUILT: DailySmsBuilt = {
  ok: true,
  smsBody: "Refreshed stale draft body",
  deliveryStateSnapshot: null,
  day2SpecialUsed: false,
  v2Accountability: true,
  v2CommitmentId: "cmt-stale",
  v3DailyRelationshipLane: true,
  writerOpenAiCapture: WRITER_CAPTURE,
  v2AiPayload: {
    v3_brain: {
      route_purpose: "main_active_accountability",
      notebook_verdict: "verified",
      notebook_verdict_reason: "none",
    },
  },
};

const REFRESHED_BUILT: DailySmsBuilt = {
  ...SUCCESS_BUILT,
  smsBody: "After inbound refresh body",
};

function seedCurrentDraft(args: {
  draftForDayKey?: string;
  generatedAt?: string;
  machineBody?: string;
  tylerEdited?: boolean;
  status?: string;
  emptySendBody?: boolean;
}) {
  const draftForDayKey = args.draftForDayKey ?? "2026-07-03";
  const generatedAt = args.generatedAt ?? "2026-07-02T17:00:00.000Z";
  const genId = "gen-original";
  db.generations = [
    {
      id: genId,
      clerk_user_id: AUDIENCE_USER.clerk_user_id,
      draft_for_day_key: draftForDayKey,
      generation_number: 1,
      generation_reason: "noon_batch",
      generated_at: generatedAt,
      machine_draft_body: args.machineBody ?? "Original machine body",
      machine_should_send: true,
      writer_openai_messages: WRITER_CAPTURE.messages,
      superseded_at: null,
    },
  ];
  db.drafts = [
    {
      id: "draft-1",
      clerk_user_id: AUDIENCE_USER.clerk_user_id,
      draft_for_day_key: draftForDayKey,
      current_generation_id: genId,
      current_body_to_send: args.emptySendBody
        ? null
        : args.tylerEdited
          ? "Tyler edited body"
          : "Original machine body",
      current_body_source: args.tylerEdited ? "tyler_edit" : "machine",
      edited_by_tyler: args.tylerEdited ?? false,
      edited_at: args.tylerEdited ? "2026-07-02T18:00:00.000Z" : null,
      edit_distance_chars: args.tylerEdited ? 12 : null,
      status: args.status ?? "current",
    },
  ];
}

function setupHappyPath() {
  process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
  db.audience = [AUDIENCE_USER];
  db.inbound = [];
  db.smsSendEventsWrites = 0;
  db.v2EventWrites = 0;
  db.nextGenId = 2;
  db.fromCalls = [];

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
    id: "cmt-stale",
    behavior_statement: "Two hours deep work",
  });
  loadMorningPacketMock.mockResolvedValue({
    ok: true,
    packet: {
      version: "morning_relationship_v1",
      historical_evidence: [],
      exact_thread: { window_days: 21, max_messages: 30, omitted_older_turn_count: 0, messages: [] },
      last_user_response: { never_replied: false, days_since: 1, at_utc: null, at_local: null },
      hard_state: { pending_goal_change: null },
    },
    commitmentId: "cmt-stale",
  });
  writeMorningTtoBodyMock.mockResolvedValue({
    ok: true,
    body: "After inbound refresh body",
    messages: [
      { role: "system", content: "Morning system" },
      { role: "user", content: "MORNING_RELATIONSHIP_PACKET_V1\n{}" },
    ],
    primaryMessages: [
      { role: "system", content: "Morning system" },
      { role: "user", content: "MORNING_RELATIONSHIP_PACKET_V1\n{}" },
    ],
    retryMessages: [],
    retryOccurred: false,
    writer_prompt_path: "morning_brief_writer_v1",
    model: "gpt-5.6-sol",
    capture: {
      capture_version: "morning_writer_capture_v1",
      model: "gpt-5.6-sol",
      temperature: null,
      reasoning_effort: "low",
      max_completion_tokens: 1200,
      prompt_path: "morning_brief_writer_v1",
      raw_response: '{"body":"After inbound refresh body"}',
      raw_retry_response: null,
      error: null,
      request_started_at: null,
      request_completed_at: null,
      latency_ms: null,
      retry_occurred: false,
      retry_succeeded: null,
    },
  });
  buildDailySmsContentMock.mockResolvedValue(REFRESHED_BUILT);
}

describe("isProtectedFromMorningDraftOverwrite", () => {
  it("keeps isProtectedTtoCurrentDraftBody body-only (null/blank not body-protected)", () => {
    expect(isProtectedTtoCurrentDraftBody(null)).toBe(false);
    expect(isProtectedTtoCurrentDraftBody("")).toBe(false);
    expect(isProtectedTtoCurrentDraftBody("   ")).toBe(false);
    expect(isProtectedTtoCurrentDraftBody("Hello")).toBe(true);
  });

  it("protects non-empty body and Tyler provenance including intentional blank", () => {
    expect(
      isProtectedFromMorningDraftOverwrite({
        current_body_to_send: "Machine body",
        edited_by_tyler: false,
        current_body_source: "machine",
      })
    ).toBe(true);
    expect(
      isProtectedFromMorningDraftOverwrite({
        current_body_to_send: "Tyler body",
        edited_by_tyler: true,
        current_body_source: "tyler_edit",
      })
    ).toBe(true);
    expect(
      isProtectedFromMorningDraftOverwrite({
        current_body_to_send: null,
        edited_by_tyler: true,
        current_body_source: "tyler_edit",
      })
    ).toBe(true);
  });

  it("does not protect machine/generation null without Tyler provenance", () => {
    expect(
      isProtectedFromMorningDraftOverwrite({
        current_body_to_send: null,
        edited_by_tyler: false,
        current_body_source: "machine",
      })
    ).toBe(false);
    expect(
      isProtectedFromMorningDraftOverwrite({
        current_body_to_send: null,
        edited_by_tyler: false,
        current_body_source: null,
      })
    ).toBe(false);
  });
});

describe("isProtectedTylerProvenanceDraft", () => {
  it("pins Tyler edit and Tyler blank, not untouched machine copy", () => {
    expect(
      isProtectedTylerProvenanceDraft({
        edited_by_tyler: false,
        current_body_source: "machine",
      })
    ).toBe(false);
    expect(
      isProtectedTylerProvenanceDraft({
        edited_by_tyler: true,
        current_body_source: "tyler_edit",
      })
    ).toBe(true);
    expect(
      isProtectedTylerProvenanceDraft({
        edited_by_tyler: true,
        current_body_source: "machine",
      })
    ).toBe(true);
    expect(
      isProtectedTylerProvenanceDraft({
        edited_by_tyler: false,
        current_body_source: "tyler_edit",
      })
    ).toBe(true);
  });
});

describe("refreshStaleTylerTextOverviewDrafts", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.clearAllMocks();
  });

  it("env disabled → no DB reads/writes", async () => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "false";
    const { supabaseServer } = await import("@/lib/supabase-server");
    const stats = await refreshStaleTylerTextOverviewDrafts();
    expect(stats.enabled).toBe(false);
    expect(supabaseServer.from).not.toHaveBeenCalled();
    expect(buildDailySmsContentMock).not.toHaveBeenCalled();
    expect(loadMorningPacketMock).not.toHaveBeenCalled();
  });

  it("finds stale current draft when inbound received_at > generation.generated_at", async () => {
    setupHappyPath();
    seedCurrentDraft({});
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T18:00:00.000Z",
      },
    ];
    const stale = await findStaleTylerTextOverviewCurrentDrafts();
    expect(stale).toHaveLength(1);
    expect(stale[0]?.draftForDayKey).toBe("2026-07-03");
  });

  it("does not treat received_at = generated_at as stale", async () => {
    setupHappyPath();
    seedCurrentDraft({ generatedAt: "2026-07-02T17:00:00.000Z" });
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T17:00:00.000Z",
      },
    ];
    const stale = await findStaleTylerTextOverviewCurrentDrafts();
    expect(stale).toHaveLength(0);
  });

  it("ignores sent/skipped drafts", async () => {
    setupHappyPath();
    seedCurrentDraft({ status: "sent" });
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T18:00:00.000Z",
      },
    ];
    const stale = await findStaleTylerTextOverviewCurrentDrafts();
    expect(stale).toHaveLength(0);
  });

  it("ignores current drafts with no newer inbound", async () => {
    setupHappyPath();
    seedCurrentDraft({});
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T16:00:00.000Z",
      },
    ];
    const stats = await refreshStaleTylerTextOverviewDrafts();
    expect(stats.stale_found).toBe(0);
    expect(stats.refreshed).toBe(0);
    expect(buildDailySmsContentMock).not.toHaveBeenCalled();
    expect(loadMorningPacketMock).not.toHaveBeenCalled();
  });

  it("uses existing draft row draft_for_day_key, not recomputed day key", async () => {
    setupHappyPath();
    seedCurrentDraft({ draftForDayKey: "2026-07-10", emptySendBody: true });
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T18:00:00.000Z",
      },
    ];
    const refreshNow = new Date("2026-07-02T16:00:00.000Z"); // noon ET July 2
    await refreshStaleTylerTextOverviewDrafts({
      now: refreshNow,
    });
    expect(loadMorningPacketMock).toHaveBeenCalled();
    expect(
      db.generations.some((g) => g.draft_for_day_key === "2026-07-10")
    ).toBe(true);
    expect(buildDailySmsContentMock).not.toHaveBeenCalled();
    // Canonical batch day for this clock would be Eastern tomorrow — not the stale draft day.
    const canonicalIfBatch = resolveCanonicalMorningTtoBatchDraftForDayKey(refreshNow);
    expect(canonicalIfBatch).toBe("2026-07-03");
    expect(canonicalIfBatch).not.toBe("2026-07-10");
  });

  it("calls Morning packet+writer for stale users only", async () => {
    setupHappyPath();
    seedCurrentDraft({ emptySendBody: true });
    db.drafts.push({
      id: "draft-fresh",
      clerk_user_id: "user_fresh",
      draft_for_day_key: "2026-07-03",
      current_generation_id: "gen-fresh",
      status: "current",
    });
    db.generations.push({
      id: "gen-fresh",
      clerk_user_id: "user_fresh",
      draft_for_day_key: "2026-07-03",
      generation_number: 1,
      generated_at: "2026-07-02T20:00:00.000Z",
      machine_draft_body: "Fresh",
      superseded_at: null,
    });
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T18:00:00.000Z",
      },
      {
        clerk_user_id: "user_fresh",
        received_at: "2026-07-02T19:00:00.000Z",
      },
    ];
    await refreshStaleTylerTextOverviewDrafts();
    expect(loadMorningPacketMock).toHaveBeenCalledTimes(1);
    expect(writeMorningTtoBodyMock).toHaveBeenCalledTimes(1);
    expect(buildDailySmsContentMock).not.toHaveBeenCalled();
  });

  it("skips Tyler intentional blank as protected (evening_sweep; no OpenAI)", async () => {
    setupHappyPath();
    seedCurrentDraft({ tylerEdited: true, emptySendBody: true });
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T18:00:00.000Z",
      },
    ];
    const stats = await refreshStaleTylerTextOverviewDrafts();
    expect(stats.generation_reason).toBe("evening_sweep");
    expect(stats.refreshed).toBe(0);
    expect(stats.skipped_protected_current_draft).toBe(1);
    expect(loadMorningPacketMock).not.toHaveBeenCalled();
    expect(writeMorningTtoBodyMock).not.toHaveBeenCalled();
    expect(db.drafts[0]?.current_body_to_send).toBeNull();
    expect(db.drafts[0]?.current_body_source).toBe("tyler_edit");
    expect(db.drafts[0]?.edited_by_tyler).toBe(true);
    expect(db.drafts[0]?.edited_at).toBe("2026-07-02T18:00:00.000Z");
    expect(db.drafts[0]?.current_generation_id).toBe("gen-original");
    expect(db.generations).toHaveLength(1);
  });

  it("skips Tyler intentional blank as protected on pre_send_stale_refresh", async () => {
    setupHappyPath();
    seedCurrentDraft({ tylerEdited: true, emptySendBody: true });
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T18:00:00.000Z",
      },
    ];
    const stats = await refreshStaleTylerTextOverviewDrafts({
      generationReason: "pre_send_stale_refresh",
    });
    expect(stats.generation_reason).toBe("pre_send_stale_refresh");
    expect(stats.refreshed).toBe(0);
    expect(stats.skipped_protected_current_draft).toBe(1);
    expect(writeMorningTtoBodyMock).not.toHaveBeenCalled();
    expect(db.drafts[0]?.current_body_to_send).toBeNull();
    expect(db.drafts[0]?.current_body_source).toBe("tyler_edit");
    expect(db.drafts[0]?.edited_by_tyler).toBe(true);
  });

  it("inserts new generation with generation_reason pre_send_stale_refresh when machine null refreshes", async () => {
    setupHappyPath();
    seedCurrentDraft({ emptySendBody: true });
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T18:00:00.000Z",
      },
    ];
    await refreshStaleTylerTextOverviewDrafts({ generationReason: "pre_send_stale_refresh" });
    expect(db.generations.some((g) => g.generation_reason === "pre_send_stale_refresh")).toBe(true);
  });

  it("supersedes old generation", async () => {
    setupHappyPath();
    seedCurrentDraft({ emptySendBody: true });
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T18:00:00.000Z",
      },
    ];
    await refreshStaleTylerTextOverviewDrafts();
    const oldGen = db.generations.find((g) => g.id === "gen-original");
    expect(oldGen?.superseded_at).toBeTruthy();
    expect(oldGen?.superseded_by_generation_id).toBeTruthy();
  });

  it("skips refresh when protected current draft body exists", async () => {
    setupHappyPath();
    seedCurrentDraft({});
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T18:00:00.000Z",
      },
    ];
    const stats = await refreshStaleTylerTextOverviewDrafts();
    expect(stats.skipped_protected_current_draft).toBe(1);
    expect(stats.refreshed).toBe(0);
    expect(buildDailySmsContentMock).not.toHaveBeenCalled();
    expect(loadMorningPacketMock).not.toHaveBeenCalled();
    expect(db.drafts[0]?.current_body_to_send).toBe("Original machine body");
    expect(db.drafts[0]?.current_generation_id).toBe("gen-original");
  });

  it("does not overwrite protected machine draft on stale refresh", async () => {
    setupHappyPath();
    seedCurrentDraft({});
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T18:00:00.000Z",
      },
    ];
    await refreshStaleTylerTextOverviewDrafts();
    expect(db.drafts[0]?.current_body_to_send).toBe("Original machine body");
    expect(db.drafts[0]?.current_generation_id).toBe("gen-original");
  });

  it("does not overwrite protected tyler_edit on stale refresh", async () => {
    setupHappyPath();
    seedCurrentDraft({ tylerEdited: true });
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T18:00:00.000Z",
      },
    ];
    await refreshStaleTylerTextOverviewDrafts();
    expect(db.drafts[0]?.current_body_to_send).toBe("Tyler edited body");
    expect(db.drafts[0]?.edited_by_tyler).toBe(true);
    expect(db.drafts[0]?.edited_at).toBe("2026-07-02T18:00:00.000Z");
    expect(db.drafts[0]?.edit_distance_chars).toBe(12);
    expect(db.drafts[0]?.current_body_source).toBe("tyler_edit");
  });

  it("refreshes machine null (no Tyler provenance) when current draft body is empty", async () => {
    setupHappyPath();
    seedCurrentDraft({ emptySendBody: true });
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T18:00:00.000Z",
      },
    ];
    const stats = await refreshStaleTylerTextOverviewDrafts();
    expect(stats.generation_reason).toBe("evening_sweep");
    expect(stats.refreshed).toBe(1);
    expect(stats.skipped_protected_current_draft).toBe(0);
    expect(db.drafts[0]?.current_body_to_send).toBe("After inbound refresh body");
    expect(db.drafts[0]?.current_body_source).toBe("machine");
    expect(db.drafts[0]?.edited_by_tyler).toBe(false);
  });

  it("does not mutate old machine_draft_body", async () => {
    setupHappyPath();
    seedCurrentDraft({ machineBody: "Immutable original body", emptySendBody: true });
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T18:00:00.000Z",
      },
    ];
    await refreshStaleTylerTextOverviewDrafts();
    const oldGen = db.generations.find((g) => g.id === "gen-original");
    expect(oldGen?.machine_draft_body).toBe("Immutable original body");
  });

  it("does not write sms_send_events", async () => {
    setupHappyPath();
    seedCurrentDraft({ emptySendBody: true });
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T18:00:00.000Z",
      },
    ];
    await refreshStaleTylerTextOverviewDrafts();
    expect(db.smsSendEventsWrites).toBe(0);
  });

  it("Phase 1 scans only morning send_slot current drafts", async () => {
    setupHappyPath();
    db.drafts.push({
      id: "draft-evening",
      clerk_user_id: "user_evening",
      draft_for_day_key: "2026-07-03",
      current_generation_id: "gen-evening",
      status: "current",
      send_slot: "evening_checkin",
      current_body_to_send: "Future slot",
    });
    db.generations.push({
      id: "gen-evening",
      clerk_user_id: "user_evening",
      draft_for_day_key: "2026-07-03",
      send_slot: "evening_checkin",
      generated_at: "2026-07-02T12:00:00.000Z",
      machine_draft_body: "Future slot",
    });
    seedCurrentDraft({ emptySendBody: true });
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T18:00:00.000Z",
      },
    ];
    const stats = await refreshStaleTylerTextOverviewDrafts();
    expect(stats.current_drafts_scanned).toBe(1);
    expect(stats.refreshed).toBe(1);
  });

  it("does not call Twilio", async () => {
    setupHappyPath();
    seedCurrentDraft({ emptySendBody: true });
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T18:00:00.000Z",
      },
    ];
    await refreshStaleTylerTextOverviewDrafts();
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(reconcileCheckSentMock).not.toHaveBeenCalled();
    expect(db.v2EventWrites).toBe(0);
  });

  it("returns stats", async () => {
    setupHappyPath();
    seedCurrentDraft({ emptySendBody: true });
    db.inbound = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        received_at: "2026-07-02T18:00:00.000Z",
      },
    ];
    const stats = await refreshStaleTylerTextOverviewDrafts();
    expect(stats.ok).toBe(true);
    expect(stats.enabled).toBe(true);
    expect(stats.current_drafts_scanned).toBe(1);
    expect(stats.stale_found).toBe(1);
    expect(stats.refreshed).toBe(1);
  });

  it("parseTylerTextOverviewStaleRefreshReason defaults safely", () => {
    expect(parseTylerTextOverviewStaleRefreshReason(null)).toBe("evening_sweep");
    expect(parseTylerTextOverviewStaleRefreshReason("bogus")).toBe("evening_sweep");
    expect(parseTylerTextOverviewStaleRefreshReason("pre_send_stale_refresh")).toBe(
      "pre_send_stale_refresh"
    );
  });
});

describe("tyler-text-overview-refresh-stale route", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    vi.clearAllMocks();
  });

  it("unauthorized request rejected before DB", async () => {
    validateCronSecretMock.mockReturnValue(false);
    const { GET } = await import(
      "@/app/api/cron/tyler-text-overview-refresh-stale/route"
    );
    const { supabaseServer } = await import("@/lib/supabase-server");
    const res = await GET(new Request("http://localhost/api/cron/tyler-text-overview-refresh-stale"));
    expect(res.status).toBe(401);
    expect(supabaseServer.from).not.toHaveBeenCalled();
  });

  it("authorized request passes reason query to refresh helper", async () => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "false";
    validateCronSecretMock.mockReturnValue(true);
    const { GET } = await import(
      "@/app/api/cron/tyler-text-overview-refresh-stale/route"
    );
    const res = await GET(
      new Request(
        "http://localhost/api/cron/tyler-text-overview-refresh-stale?reason=pre_send_stale_refresh",
        { headers: { "x-cron-secret": "test" } }
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.generation_reason).toBe("pre_send_stale_refresh");
    expect(body.enabled).toBe(false);
  });
});

describe("tyler-text-overview Phase 6A scope guards", () => {
  it("refresh files only use TYLER_TEXT_OVERVIEW_ENABLED env", () => {
    for (const rel of [
      "src/lib/tyler-text-overview-refresh-stale.ts",
      "src/app/api/cron/tyler-text-overview-refresh-stale/route.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      const envReads = src.match(/process\.env\.[A-Z0-9_]+/g) ?? [];
      const allowed = new Set([`process.env.${TYLER_TEXT_OVERVIEW_ENABLED_ENV}`]);
      for (const read of envReads) {
        expect(allowed.has(read)).toBe(true);
      }
    }
  });

  it("forbidden runtime files were not modified in this phase scope", () => {
    const forbidden = [
      "src/app/api/cron/daily-sms/route.ts",
      "src/app/api/cron/weekly-sms/route.ts",
      "src/app/api/cron/sms-inbound-coach/route.ts",
      "vercel.json",
    ];
    for (const rel of forbidden) {
      expect(readFileSync(join(process.cwd(), rel), "utf8").length).toBeGreaterThan(0);
    }
  });

  it("does not touch daily route / inbound route source", () => {
    const dailySrc = readFileSync(
      join(process.cwd(), "src/app/api/cron/daily-sms/route.ts"),
      "utf8"
    );
    expect(dailySrc).not.toContain("tyler-text-overview-refresh-stale");
    expect(dailySrc).not.toContain("refreshStaleTylerTextOverviewDrafts");
  });
});
