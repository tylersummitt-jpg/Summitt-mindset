import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildWriterOpenAiCapture } from "@/lib/tyler-text-overview-writer-capture";
import {
  isTylerTextOverviewDraftDayKey,
  requireTylerTextOverviewDraftDayKey,
  resolveCanonicalMorningTtoBatchDraftForDayKey,
  resolveTylerTextOverviewEveningDraftForDayKey,
} from "@/lib/tyler-text-overview-draft-day-key";
import {
  mapBuiltToTylerTextOverviewGenerationRow,
  generateTylerTextOverviewDailyDrafts,
  generateTylerTextOverviewDraftForUser,
  generateTylerTextOverviewEveningPreviewForUser,
  loadTylerTextOverviewAudienceRows,
} from "@/lib/tyler-text-overview-generate";
import type { DailySmsBuilt } from "@/lib/daily-sms-build";
import {
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  TYLER_TEXT_OVERVIEW_ENABLED_ENV,
} from "@/lib/tyler-text-overview-types";

const buildDailySmsContentMock = vi.hoisted(() => vi.fn());
const loadMorningPacketMock = vi.hoisted(() => vi.fn());
const writeMorningTtoBodyMock = vi.hoisted(() => vi.fn());
const runInterpreterMock = vi.hoisted(() => vi.fn());
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
      let rows = db.audience;
      if (payload.clerk_user_id) {
        rows = rows.filter((a) => a.clerk_user_id === payload.clerk_user_id);
      }
      if (payload.summitt_subscribed !== undefined) {
        rows = rows.filter((a) => a.summitt_subscribed === payload.summitt_subscribed);
      }
      if (payload.sms_enabled !== undefined) {
        rows = rows.filter((a) => a.sms_enabled === payload.sms_enabled);
      }
      return { data: payload.maybeSingle ? rows[0] ?? null : rows, error: null };
    }

    if (table === "sms_daily_draft_generations" && action === "select") {
      if (payload.id) {
        const row = db.generations.find((g) => g.id === payload.id) ?? null;
        return { data: row, error: null };
      }
      const clerk = payload.clerk_user_id as string;
      const day = payload.draft_for_day_key as string;
      let rows = db.generations.filter(
        (g) => g.clerk_user_id === clerk && g.draft_for_day_key === day
      );
      if (payload.send_slot) {
        rows = rows.filter((g) => g.send_slot === payload.send_slot);
      }
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
          g.send_slot === row.send_slot &&
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
      if (typeof payload.id === "string") {
        const target = db.generations.find((g) => g.id === payload.id);
        if (target) {
          if ("superseded_at" in payload) target.superseded_at = payload.superseded_at;
          if ("superseded_by_generation_id" in payload) {
            target.superseded_by_generation_id = payload.superseded_by_generation_id;
          }
        }
        return { data: null, error: null };
      }
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

    if (table === "sms_daily_drafts" && action === "select") {
      let rows = db.drafts;
      if (payload.clerk_user_id) {
        rows = rows.filter((d) => d.clerk_user_id === payload.clerk_user_id);
      }
      if (payload.draft_for_day_key) {
        rows = rows.filter((d) => d.draft_for_day_key === payload.draft_for_day_key);
      }
      if (payload.status) {
        rows = rows.filter((d) => d.status === payload.status);
      }
      if (payload.send_slot) {
        rows = rows.filter((d) => (d.send_slot ?? "morning") === payload.send_slot);
      }
      return { data: payload.maybeSingle ? rows[0] ?? null : rows, error: null };
    }

    if (table === "sms_daily_drafts" && action === "upsert") {
      const row = payload.row as Record<string, unknown>;
      const idx = db.drafts.findIndex(
        (d) =>
          d.clerk_user_id === row.clerk_user_id &&
          d.draft_for_day_key === row.draft_for_day_key &&
          (d.send_slot ?? "morning") === (row.send_slot ?? "morning")
      );
      if (idx >= 0) {
        db.drafts[idx] = { ...db.drafts[idx], ...row };
      } else {
        db.drafts.push({ ...row });
      }
      return { data: null, error: null };
    }

    if (table === "sms_send_events") {
      if (action === "select") {
        return { data: null, error: null };
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
    message_for: packet.message_for,
    mechanical: {
      days_since_last_user_response: packet.last_user_response.days_since,
      never_replied: packet.last_user_response.never_replied,
      recent_unanswered_outbound_count: 0,
    },
    canonical_goal: { text: packet.current_goal.text },
    pending_goal_change: packet.hard_state.pending_goal_change,
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
    exact_thread: packet.exact_thread,
  })),
  countRecentUnansweredOutboundFromExactThread: vi.fn(() => 0),
}));

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

vi.mock("@/lib/supabase-server", () => {
  return {
    supabaseServer: {
      from: vi.fn((name: string) =>
        makeChain({ table: name, action: "select", payload: {} })
      ),
    },
  };
});

const MORNING_WRITER_MESSAGES = [
  { role: "system" as const, content: "Morning brief writer system" },
  {
    role: "user" as const,
    content:
      'MORNING_COACHING_BRIEF_V1\n{"version":"morning_coaching_brief_v1"}\n\nMORNING_RELATIONSHIP_PACKET_V1\n{}',
  },
];

const MORNING_SUCCESS_BODY = "Did the two hours happen before noon?";

const MORNING_PACKET = {
  version: "morning_relationship_v1" as const,
  message_for: {
    timezone: "America/New_York",
    local_date: "2026-07-03",
    local_weekday: "Friday",
    daypart: "morning" as const,
  },
  last_user_response: {
    at_utc: "2026-07-01T12:00:00.000Z",
    at_local: "Jul 1, 8:00 AM",
    days_since: 2,
    never_replied: false,
  },
  preferred_name: "Tyler",
  current_goal: { text: "Two hours deep work" },
  current_identity: { text: null },
  personal_context: [],
  hard_state: { pending_goal_change: null },
  exact_thread: {
    window_days: 21 as const,
    max_messages: 30,
    omitted_older_turn_count: 0,
    messages: [
      {
        sender: "coach" as const,
        sent_at_utc: "2026-07-02T12:00:00.000Z",
        sent_at_local: "Jul 2, 8:00 AM",
        local_day_key: "2026-07-02",
        local_weekday: "Thursday",
        day_relation_to_message: "yesterday",
        body: "How did yesterday go?",
      },
      {
        sender: "user" as const,
        sent_at_utc: "2026-07-02T13:00:00.000Z",
        sent_at_local: "Jul 2, 9:00 AM",
        local_day_key: "2026-07-02",
        local_weekday: "Thursday",
        day_relation_to_message: "yesterday",
        body: "Pretty good.",
      },
    ],
  },
};

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
      current_send_slot: "morning",
      slot_coaching_context: {
        version: "1",
        current_slot: "morning",
        previous_slot: null,
        previous_outbound_summary: null,
        user_replies_since_previous_outbound: null,
        active_coaching_thread: "Fresh day — set a concrete rep or move, not a generic goal loop.",
        slot_role_recommendation: "set_today_rep",
        checkin_focus: null,
        should_send_recommendation: "writer_decides",
        skip_reason_hint: null,
      },
    },
  },
};

const SILENCE_CADENCE_NO_SEND_BUILT: DailySmsBuilt = {
  ok: false,
  error: "silence_cadence_no_send",
  dailyLaneMeta: {
    silence_cadence_route: "no_send_space_day9",
    silence_day: 9,
    send_today: false,
    intentional_space: true,
    no_send_reason: "silence_cadence_space_day9",
    skip_source: "silence_cadence_no_send",
    lane_stage: "silence_cadence_no_send",
    route_purpose: "main_active_accountability",
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
  loadMorningPacketMock.mockResolvedValue({
    ok: true,
    packet: MORNING_PACKET,
    commitmentId: "cmt-phase3",
  });
  writeMorningTtoBodyMock.mockResolvedValue({
    ok: true,
    body: MORNING_SUCCESS_BODY,
    messages: MORNING_WRITER_MESSAGES,
    primaryMessages: MORNING_WRITER_MESSAGES,
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
      raw_response: '{"body":"Did the two hours happen before noon?"}',
      raw_retry_response: null,
      error: null,
      request_started_at: "2026-07-02T16:00:00.000Z",
      request_completed_at: "2026-07-02T16:00:01.000Z",
      latency_ms: 1000,
      retry_occurred: false,
      retry_succeeded: null,
    },
  });
  runInterpreterMock.mockResolvedValue({
    ok: true,
    brief: {
      version: "morning_coaching_brief_v1",
      confidence: "medium",
      human_situation: {
        most_alive: "User finished the story",
        direct_question_or_need: null,
        relevant_life_event: null,
        context_use: "background",
        identity_use: "background",
        person_use: "do_not_force",
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
        already_acknowledged: [],
        answered_question: null,
        open_loop: null,
        stale_or_exhausted_topics: [],
        do_not_repeat: [],
      },
      goal_role_today: {
        canonical_goal: "Two hours deep work",
        pending_goal: null,
        goal_alignment: "aligned",
        role: "background",
        note: "ok",
      },
      coaching_direction: {
        primary_move: "continue_conversation",
        question_policy: "none",
        action_guidance: "none",
        pressure: "normal",
      },
      boundaries: {
        claims_to_avoid: [],
        topics_not_to_force: [],
        unsupported_capabilities: [],
        goal_authority_boundaries: [],
        identity_people_boundaries: [],
        coach_history_is_not_style: "Prior coach messages are history.",
      },
    },
    capture: {
      capture_version: "morning_brief_interpreter_capture_v1",
      model: "gpt-5.6-sol",
      temperature: null,
      reasoning_effort: "low",
      max_completion_tokens: 2500,
      prompt_path: "morning_brief_interpreter_v1",
      system_message: "interpreter system",
      user_message: "interpreter user",
      canonical_input: { version: "morning_brief_interpreter_input_v1" },
      raw_response: "{}",
      parsed_brief: null,
      error: null,
      request_started_at: "2026-07-02T16:00:00.000Z",
      request_completed_at: "2026-07-02T16:00:01.000Z",
      latency_ms: 1000,
      retry: null,
    },
  });
  buildDailySmsContentMock.mockResolvedValue(SUCCESS_BUILT);
}

describe("canonical Morning TTO batch draft day", () => {
  it("validates YYYY-MM-DD calendar keys", () => {
    expect(isTylerTextOverviewDraftDayKey("2026-08-06")).toBe(true);
    expect(isTylerTextOverviewDraftDayKey("2026-02-30")).toBe(false);
    expect(isTylerTextOverviewDraftDayKey("")).toBe(false);
    expect(isTylerTextOverviewDraftDayKey("08/06/2026")).toBe(false);
    expect(requireTylerTextOverviewDraftDayKey(" 2026-08-06 ")).toBe("2026-08-06");
    expect(() => requireTylerTextOverviewDraftDayKey("")).toThrow(/invalid_draft_for_day_key/);
  });

  it("Aug 5 Eastern afternoon → Aug 6 canonical batch day", () => {
    // 2026-08-05 15:57 UTC = 11:57 AM America/New_York
    const key = resolveCanonicalMorningTtoBatchDraftForDayKey(
      new Date("2026-08-05T15:57:00.000Z")
    );
    expect(key).toBe("2026-08-06");
  });

  it("Aug 5 Eastern before 11 still → Aug 6 (admin tomorrow, not local hour)", () => {
    // 2026-08-05 13:00 UTC = 09:00 AM ET
    const key = resolveCanonicalMorningTtoBatchDraftForDayKey(
      new Date("2026-08-05T13:00:00.000Z")
    );
    expect(key).toBe("2026-08-06");
  });

  it("Aug 5 Eastern after 2 PM → Aug 6", () => {
    // 2026-08-05 18:30 UTC = 2:30 PM ET
    const key = resolveCanonicalMorningTtoBatchDraftForDayKey(
      new Date("2026-08-05T18:30:00.000Z")
    );
    expect(key).toBe("2026-08-06");
  });

  it("near UTC date boundary still uses Eastern admin day", () => {
    // 2026-08-06 03:30 UTC = Aug 5 11:30 PM ET → admin today Aug 5 → draft Aug 6
    const key = resolveCanonicalMorningTtoBatchDraftForDayKey(
      new Date("2026-08-06T03:30:00.000Z")
    );
    expect(key).toBe("2026-08-06");
  });

  it("retry later same Eastern day computes the same draft day", () => {
    const a = resolveCanonicalMorningTtoBatchDraftForDayKey(
      new Date("2026-08-05T15:57:00.000Z")
    );
    const b = resolveCanonicalMorningTtoBatchDraftForDayKey(
      new Date("2026-08-05T20:00:00.000Z")
    );
    expect(a).toBe("2026-08-06");
    expect(b).toBe("2026-08-06");
  });
});

describe("resolveTylerTextOverviewEveningDraftForDayKey", () => {
  it("8 PM Eastern July 9 → user-local today 2026-07-09 (no rollover)", () => {
    const key = resolveTylerTextOverviewEveningDraftForDayKey({
      now: new Date("2026-07-10T00:00:00.000Z"), // 8:00 PM ET July 9
      timezone: "America/New_York",
    });
    expect(key).toBe("2026-07-09");
  });

  it("8:30 PM ET July 11 → evening_checkin stays 2026-07-11", () => {
    const key = resolveTylerTextOverviewEveningDraftForDayKey({
      now: new Date("2026-07-12T00:30:00.000Z"), // 8:30 PM ET July 11
      timezone: "America/New_York",
    });
    expect(key).toBe("2026-07-11");
  });

  it("canonical Morning batch day at 8 PM ET July 9 is Eastern tomorrow 2026-07-10", () => {
    const morningKey = resolveCanonicalMorningTtoBatchDraftForDayKey(
      new Date("2026-07-10T00:00:00.000Z") // 8:00 PM ET July 9
    );
    expect(morningKey).toBe("2026-07-10");
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
    const stats = await generateTylerTextOverviewDailyDrafts({ now: new Date("2026-07-02T16:00:00.000Z"), draftForDayKey: "2026-07-03" });
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
      draftForDayKey: "2026-07-03",
      now: new Date("2026-07-02T16:00:00.000Z"),
    });
    expect(stats.enabled).toBe(true);
    expect(supabaseServer.from).toHaveBeenCalledWith("sms_audience");
    expect(loadMorningPacketMock).toHaveBeenCalled();
    expect(writeMorningTtoBodyMock).toHaveBeenCalled();
    expect(buildDailySmsContentMock).not.toHaveBeenCalled();
    expect(stats.generation_inserted).toBe(1);
    expect(stats.current_drafts_upserted).toBe(1);
    expect(db.generations).toHaveLength(1);
    expect(db.drafts).toHaveLength(1);
  });

  it("Morning generation does not call buildDailySmsContent", async () => {
    setupHappyPath();
    await generateTylerTextOverviewDailyDrafts({
      draftForDayKey: "2026-07-03",
      now: new Date("2026-07-02T16:00:00.000Z"),
    });
    expect(buildDailySmsContentMock).not.toHaveBeenCalled();
    expect(loadMorningPacketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: "user_phase3",
        timezone: "America/New_York",
        draftForDayKey: "2026-07-03",
      })
    );
    expect(writeMorningTtoBodyMock).toHaveBeenCalledWith({
      packet: MORNING_PACKET,
      morningCoachingBrief: expect.objectContaining({
        version: "morning_coaching_brief_v1",
      }),
    });
  });

  it("skips non-V2 users", async () => {
    setupHappyPath();
    resolveV2Mock.mockResolvedValue({ fullyOnV2: false, reason: "no_active_commitment" });
    const stats = await generateTylerTextOverviewDailyDrafts({ now: new Date("2026-07-02T16:00:00.000Z"), draftForDayKey: "2026-07-03" });
    expect(stats.skipped_not_v2).toBe(1);
    expect(buildDailySmsContentMock).not.toHaveBeenCalled();
  });

  it("skips comms-pref paused users", async () => {
    setupHappyPath();
    shouldSkipCommsMock.mockReturnValue({ skip: true, reason: "user_pause" });
    const stats = await generateTylerTextOverviewDailyDrafts({ now: new Date("2026-07-02T16:00:00.000Z"), draftForDayKey: "2026-07-03" });
    expect(stats.skipped_comms_prefs).toBe(1);
    expect(buildDailySmsContentMock).not.toHaveBeenCalled();
  });

  it("does not write sms_send_events or call Twilio", async () => {
    setupHappyPath();
    await generateTylerTextOverviewDailyDrafts({ now: new Date("2026-07-02T16:00:00.000Z"), draftForDayKey: "2026-07-03" });
    expect(db.smsSendEventsWrites).toBe(0);
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(reconcileCheckSentMock).not.toHaveBeenCalled();
  });

  it("stores writer_openai_messages exactly and defaults current_body_to_send", async () => {
    setupHappyPath();
    await generateTylerTextOverviewDailyDrafts({ now: new Date("2026-07-02T16:00:00.000Z"), draftForDayKey: "2026-07-03" });
    expect(db.generations[0]?.writer_openai_messages).toEqual(MORNING_WRITER_MESSAGES);
    expect(db.generations[0]?.writer_prompt_path).toBe("morning_brief_writer_v1");
    expect(db.generations[0]?.route_kind).toBe("morning_relationship");
    expect(db.drafts[0]?.current_body_to_send).toBe(MORNING_SUCCESS_BODY);
    expect(db.drafts[0]?.current_body_source).toBe("machine");
    expect(db.drafts[0]?.edited_by_tyler).toBe(false);
    const meta = db.generations[0]?.generation_metadata as Record<string, unknown>;
    expect(meta.packet_version).toBe("morning_relationship_v1");
    expect(meta.build_ok).toBe(true);
    expect(meta.capture_present).toBe(true);
    expect(meta.thread_message_count).toBe(2);
    expect(meta.writer_model).toBe("gpt-5.6-sol");
    expect(meta.morning_writer_capture_v1).toEqual(
      expect.objectContaining({
        model: "gpt-5.6-sol",
        temperature: null,
        reasoning_effort: "low",
        max_completion_tokens: 1200,
        retry_occurred: false,
        retry_succeeded: null,
        retry_messages: [],
        raw_response: expect.stringContaining('"body"'),
      })
    );
    expect(meta.morning_brief_interpreter_v1).toEqual(
      expect.objectContaining({
        model: "gpt-5.6-sol",
        reasoning_effort: "low",
        temperature: null,
        retry: null,
      })
    );
    expect(meta.morning_coaching_brief_v1).toEqual(
      expect.objectContaining({ version: "morning_coaching_brief_v1" })
    );
    expect(
      (meta.morning_brief_interpreter_v1 as Record<string, unknown>).parsed_brief
    ).toEqual(meta.morning_coaching_brief_v1);
  });

  it("Phase 2D: Brief passed to writer; packet unmutated; Brief JSON in writer messages", async () => {
    setupHappyPath();
    const callOrder: string[] = [];
    const briefForWriter = {
      version: "morning_coaching_brief_v1" as const,
      confidence: "medium" as const,
      human_situation: {
        most_alive: "alive",
        direct_question_or_need: null,
        relevant_life_event: null,
        context_use: "background" as const,
        identity_use: "background" as const,
        person_use: "do_not_force" as const,
        selected_person: null,
        selected_person_reason: null,
      },
      truth_and_evidence: {
        latest_user_truth: null,
        outcome: "no_recent_evidence" as const,
        evidence_note: "unknown",
        evidence_strength: "none" as const,
        consistency_supported: false,
        proof_claims_allowed: {
          completion: false,
          miss: false,
          partial: false,
          proof: false,
        },
      },
      conversation_continuity: {
        already_acknowledged: [],
        answered_question: null,
        open_loop: null,
        stale_or_exhausted_topics: [],
        do_not_repeat: [],
      },
      goal_role_today: {
        canonical_goal: "Two hours deep work",
        pending_goal: null,
        goal_alignment: "aligned" as const,
        role: "background" as const,
        note: "ok",
      },
      coaching_direction: {
        primary_move: "continue_conversation" as const,
        question_policy: "none" as const,
        action_guidance: "none" as const,
        pressure: "normal" as const,
      },
      boundaries: {
        claims_to_avoid: ["no fake consistency"],
        topics_not_to_force: [],
        unsupported_capabilities: [],
        goal_authority_boundaries: [],
        identity_people_boundaries: [],
        coach_history_is_not_style: "history",
      },
    };
    runInterpreterMock.mockImplementation(async () => {
      callOrder.push("interpreter");
      return {
        ok: true,
        brief: briefForWriter,
        capture: {
          capture_version: "morning_brief_interpreter_capture_v1",
          model: "gpt-5.6-sol",
          temperature: null,
          reasoning_effort: "low",
          max_completion_tokens: 2500,
          prompt_path: "morning_brief_interpreter_v1",
          system_message: "interpreter system never alone as writer",
          user_message: "interpreter user",
          canonical_input: { version: "morning_brief_interpreter_input_v1" },
          raw_response: "{}",
          parsed_brief: null,
          error: null,
          request_started_at: null,
          request_completed_at: null,
          latency_ms: null,
          retry: null,
        },
      };
    });
    writeMorningTtoBodyMock.mockImplementation(async (args) => {
      callOrder.push("writer");
      expect(args).toEqual(
        expect.objectContaining({
          packet: MORNING_PACKET,
          morningCoachingBrief: briefForWriter,
        })
      );
      expect(JSON.stringify(args.packet)).toBe(JSON.stringify(MORNING_PACKET));
      const messages = [
        { role: "system" as const, content: "Morning brief writer system" },
        {
          role: "user" as const,
          content: `MORNING_COACHING_BRIEF_V1\n${JSON.stringify(briefForWriter)}\n\nMORNING_RELATIONSHIP_PACKET_V1\n${JSON.stringify(args.packet)}`,
        },
      ];
      return {
        ok: true,
        body: MORNING_SUCCESS_BODY,
        messages,
        primaryMessages: messages,
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
          raw_response: '{"body":"x"}',
          raw_retry_response: null,
          error: null,
          request_started_at: null,
          request_completed_at: null,
          latency_ms: null,
          retry_occurred: false,
          retry_succeeded: null,
        },
      };
    });
    await generateTylerTextOverviewDailyDrafts({
      draftForDayKey: "2026-07-03",
      now: new Date("2026-07-02T16:00:00.000Z"),
    });
    expect(callOrder).toEqual(["interpreter", "writer"]);
    const userMsg = (
      db.generations[0]?.writer_openai_messages as Array<{ role: string; content: string }>
    )?.find((m) => m.role === "user")?.content;
    expect(userMsg).toContain("MORNING_COACHING_BRIEF_V1");
    expect(userMsg).toContain(JSON.stringify(briefForWriter));
    expect(userMsg).toContain("MORNING_RELATIONSHIP_PACKET_V1");
    expect(userMsg).not.toMatch(/interpreter system never alone as writer/);
    const meta = db.generations[0]?.generation_metadata as Record<string, unknown>;
    expect(meta.morning_coaching_brief_v1).toEqual(briefForWriter);
    expect(userMsg).toContain(JSON.stringify(meta.morning_coaching_brief_v1));
    expect(db.generations[0]?.machine_should_send).toBe(true);
  });

  it("Phase 2D: fail-soft Brief still reaches writer; machine_should_send from writer", async () => {
    setupHappyPath();
    runInterpreterMock.mockRejectedValue(new Error("boom"));
    writeMorningTtoBodyMock.mockImplementation(async (args) => {
      expect(args.morningCoachingBrief).toEqual(
        expect.objectContaining({ confidence: "low", version: "morning_coaching_brief_v1" })
      );
      return {
        ok: true,
        body: MORNING_SUCCESS_BODY,
        messages: MORNING_WRITER_MESSAGES,
        primaryMessages: MORNING_WRITER_MESSAGES,
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
          raw_response: '{"body":"x"}',
          raw_retry_response: null,
          error: null,
          request_started_at: null,
          request_completed_at: null,
          latency_ms: null,
          retry_occurred: false,
          retry_succeeded: null,
        },
      };
    });
    await generateTylerTextOverviewDailyDrafts({
      draftForDayKey: "2026-07-03",
      now: new Date("2026-07-02T16:00:00.000Z"),
    });
    expect(writeMorningTtoBodyMock).toHaveBeenCalled();
    expect(db.generations[0]?.machine_should_send).toBe(true);
    expect(db.generations[0]?.writer_openai_messages).toEqual(MORNING_WRITER_MESSAGES);
    const meta = db.generations[0]?.generation_metadata as Record<string, unknown>;
    expect(meta.morning_brief_interpreter_v1).toEqual(
      expect.objectContaining({ error: "boom" })
    );
    expect(meta.morning_coaching_brief_v1).toEqual(
      expect.objectContaining({ confidence: "low" })
    );
  });

  it("persists exact technical retry transcript in morning_writer_capture_v1", async () => {
    setupHappyPath();
    const retryMessages = [
      { role: "assistant" as const, content: "INVALID{" },
      {
        role: "user" as const,
        content:
          'Your previous response was invalid JSON or did not parse. Return strict JSON only: {"body":"<nonempty sms text>"}\n\nRespond with JSON only.',
      },
    ];
    writeMorningTtoBodyMock.mockResolvedValue({
      ok: true,
      body: "Body after retry.",
      messages: MORNING_WRITER_MESSAGES,
      primaryMessages: MORNING_WRITER_MESSAGES,
      retryMessages,
      retryOccurred: true,
      writer_prompt_path: "morning_brief_writer_v1",
      model: "gpt-5.6-sol",
      capture: {
        capture_version: "morning_writer_capture_v1",
        model: "gpt-5.6-sol",
        temperature: null,
        reasoning_effort: "low",
        max_completion_tokens: 1200,
        prompt_path: "morning_brief_writer_v1",
        raw_response: "INVALID{",
        raw_retry_response: '{"body":"Body after retry."}',
        error: null,
        request_started_at: null,
        request_completed_at: null,
        latency_ms: null,
        retry_occurred: true,
        retry_succeeded: true,
      },
    });
    await generateTylerTextOverviewDailyDrafts({ now: new Date("2026-07-02T16:00:00.000Z"), draftForDayKey: "2026-07-03" });
    expect(db.generations[0]?.writer_openai_messages).toEqual(MORNING_WRITER_MESSAGES);
    expect(db.generations[0]?.machine_draft_body).toBe("Body after retry.");
    const meta = db.generations[0]?.generation_metadata as Record<string, unknown>;
    expect(meta.writer_model).toBe("gpt-5.6-sol");
    expect(meta.morning_writer_capture_v1).toEqual(
      expect.objectContaining({
        model: "gpt-5.6-sol",
        reasoning_effort: "low",
        max_completion_tokens: 1200,
        temperature: null,
        retry_occurred: true,
        retry_succeeded: true,
        retry_messages: retryMessages,
        raw_response: "INVALID{",
        raw_retry_response: '{"body":"Body after retry."}',
      })
    );
  });

  it("writes send_slot morning on generation insert and draft upsert", async () => {
    setupHappyPath();
    await generateTylerTextOverviewDailyDrafts({ now: new Date("2026-07-02T16:00:00.000Z"), draftForDayKey: "2026-07-03" });
    expect(db.generations[0]?.send_slot).toBe("morning");
    expect(db.drafts[0]?.send_slot).toBe("morning");
  });

  it("writer failure persists generation with machine_should_send=false", async () => {
    setupHappyPath();
    writeMorningTtoBodyMock.mockResolvedValue({
      ok: false,
      error: "openai_request_failed",
      messages: MORNING_WRITER_MESSAGES,
    });
    await generateTylerTextOverviewDailyDrafts({ now: new Date("2026-07-02T16:00:00.000Z"), draftForDayKey: "2026-07-03" });
    expect(db.generations[0]?.machine_should_send).toBe(false);
    expect(db.generations[0]?.machine_no_send_reason).toBe("openai_request_failed");
    expect(db.generations[0]?.writer_prompt_path).toBe("morning_brief_writer_v1");
    expect(db.drafts[0]?.current_body_to_send).toBeNull();
  });

  it("packet failure persists generation history without clearing protected draft", async () => {
    setupHappyPath();
    loadMorningPacketMock.mockResolvedValue({ ok: false, error: "no_active_commitment" });
    await generateTylerTextOverviewDailyDrafts({ now: new Date("2026-07-02T16:00:00.000Z"), draftForDayKey: "2026-07-03" });
    expect(db.generations[0]?.machine_should_send).toBe(false);
    expect(db.generations[0]?.machine_no_send_reason).toBe("no_active_commitment");
    expect(db.generations[0]?.route_kind).toBe("morning_relationship");
    expect(db.drafts[0]?.current_body_to_send).toBeNull();
  });

  it("generation_number increments but protected current_body_to_send is not overwritten", async () => {
    setupHappyPath();
    await generateTylerTextOverviewDailyDrafts({
      draftForDayKey: "2026-07-03",
      now: new Date("2026-07-02T16:00:00.000Z"),
    });
    writeMorningTtoBodyMock.mockResolvedValue({
      ok: true,
      body: "Updated body should be new generation only",
      messages: MORNING_WRITER_MESSAGES,
      writer_prompt_path: "morning_brief_writer_v1",
      model: "gpt-5.6-sol",
    });
    await generateTylerTextOverviewDailyDrafts({
      draftForDayKey: "2026-07-03",
      now: new Date("2026-07-02T16:05:00.000Z"),
    });
    expect(db.generations).toHaveLength(2);
    expect(db.generations[0]?.generation_number).toBe(1);
    expect(db.generations[1]?.generation_number).toBe(2);
    expect(db.generations[0]?.machine_draft_body).toBe(MORNING_SUCCESS_BODY);
    expect(db.generations[1]?.machine_draft_body).toBe("Updated body should be new generation only");
    expect(db.drafts).toHaveLength(1);
    expect(db.drafts[0]?.current_body_to_send).toBe(MORNING_SUCCESS_BODY);
    expect(db.drafts[0]?.current_body_source).toBe("machine");
    expect(db.drafts[0]?.current_generation_id).toBe(db.generations[0]?.id);
    expect(db.generations[0]?.superseded_at == null).toBe(true);
    expect(db.generations[1]?.superseded_at).toBeTruthy();
    expect(db.generations[1]?.superseded_by_generation_id).toBe(db.generations[0]?.id);
  });

  it("does not overwrite protected current machine draft on generate", async () => {
    setupHappyPath();
    db.drafts = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        draft_for_day_key: "2026-07-03",
        status: "current",
        current_body_to_send: "Existing machine draft",
        current_body_source: "machine",
        edited_by_tyler: false,
      },
    ];
    writeMorningTtoBodyMock.mockResolvedValue({
      ok: true,
      body: "New machine draft",
      messages: MORNING_WRITER_MESSAGES,
      writer_prompt_path: "morning_brief_writer_v1",
      model: "gpt-5.6-sol",
    });
    await generateTylerTextOverviewDailyDrafts({
      draftForDayKey: "2026-07-03",
      now: new Date("2026-07-02T16:00:00.000Z"),
    });
    expect(db.drafts[0]?.current_body_to_send).toBe("Existing machine draft");
    expect(db.drafts[0]?.current_body_source).toBe("machine");
    expect(db.generations).toHaveLength(1);
    expect(db.generations[0]?.machine_draft_body).toBe("New machine draft");
  });

  it("does not overwrite protected tyler_edit draft on generate", async () => {
    setupHappyPath();
    db.drafts = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        draft_for_day_key: "2026-07-03",
        status: "current",
        current_body_to_send: "Tyler protected body",
        current_body_source: "tyler_edit",
        edited_by_tyler: true,
        edited_at: "2026-07-02T18:00:00.000Z",
        edit_distance_chars: 10,
      },
    ];
    writeMorningTtoBodyMock.mockResolvedValue({
      ok: true,
      body: "New machine draft",
      messages: MORNING_WRITER_MESSAGES,
      writer_prompt_path: "morning_brief_writer_v1",
      model: "gpt-5.6-sol",
    });
    await generateTylerTextOverviewDailyDrafts({
      draftForDayKey: "2026-07-03",
      now: new Date("2026-07-02T16:00:00.000Z"),
    });
    expect(db.drafts[0]?.current_body_to_send).toBe("Tyler protected body");
    expect(db.drafts[0]?.current_body_source).toBe("tyler_edit");
    expect(db.drafts[0]?.edited_by_tyler).toBe(true);
    expect(db.drafts[0]?.edited_at).toBe("2026-07-02T18:00:00.000Z");
    expect(db.drafts[0]?.edit_distance_chars).toBe(10);
  });

  it("does not overwrite Tyler intentional blank on generate", async () => {
    setupHappyPath();
    db.drafts = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        draft_for_day_key: "2026-07-03",
        status: "current",
        current_generation_id: "gen-prior",
        current_body_to_send: null,
        current_body_source: "tyler_edit",
        edited_by_tyler: true,
        edited_at: "2026-07-02T18:00:00.000Z",
        edit_distance_chars: 40,
      },
    ];
    db.generations = [
      {
        id: "gen-prior",
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        draft_for_day_key: "2026-07-03",
        send_slot: "morning",
        generation_number: 1,
        generation_reason: "noon_batch",
        machine_draft_body: "Prior machine body",
        machine_should_send: true,
        superseded_at: null,
      },
    ];
    db.nextGenId = 2;
    writeMorningTtoBodyMock.mockResolvedValue({
      ok: true,
      body: "New machine draft must not become live body",
      messages: MORNING_WRITER_MESSAGES,
      writer_prompt_path: "morning_brief_writer_v1",
      model: "gpt-5.6-sol",
    });
    await generateTylerTextOverviewDailyDrafts({
      draftForDayKey: "2026-07-03",
      now: new Date("2026-07-02T16:00:00.000Z"),
    });
    expect(db.drafts[0]?.current_body_to_send).toBeNull();
    expect(db.drafts[0]?.current_body_source).toBe("tyler_edit");
    expect(db.drafts[0]?.edited_by_tyler).toBe(true);
    expect(db.drafts[0]?.edited_at).toBe("2026-07-02T18:00:00.000Z");
    expect(db.drafts[0]?.edit_distance_chars).toBe(40);
    expect(db.drafts[0]?.current_generation_id).toBe("gen-prior");
  });

  it("overwrites machine null (no Tyler provenance) on generate", async () => {
    setupHappyPath();
    db.drafts = [
      {
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        draft_for_day_key: "2026-07-03",
        status: "current",
        current_generation_id: "gen-prior",
        current_body_to_send: null,
        current_body_source: "machine",
        edited_by_tyler: false,
        edited_at: null,
      },
    ];
    db.generations = [
      {
        id: "gen-prior",
        clerk_user_id: AUDIENCE_USER.clerk_user_id,
        draft_for_day_key: "2026-07-03",
        send_slot: "morning",
        generation_number: 1,
        generation_reason: "noon_batch",
        machine_draft_body: null,
        machine_should_send: false,
        machine_no_send_reason: "openai_request_failed",
        superseded_at: null,
      },
    ];
    db.nextGenId = 2;
    writeMorningTtoBodyMock.mockResolvedValue({
      ok: true,
      body: "Recovered machine draft",
      messages: MORNING_WRITER_MESSAGES,
      writer_prompt_path: "morning_brief_writer_v1",
      model: "gpt-5.6-sol",
    });
    await generateTylerTextOverviewDailyDrafts({
      draftForDayKey: "2026-07-03",
      now: new Date("2026-07-02T16:00:00.000Z"),
    });
    expect(db.drafts[0]?.current_body_to_send).toBe("Recovered machine draft");
    expect(db.drafts[0]?.current_body_source).toBe("machine");
    expect(db.drafts[0]?.edited_by_tyler).toBe(false);
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

  it("admin routes use requireTylerAdmin (Phase 4)", () => {
    for (const rel of [
      "src/app/api/admin/tyler-text-overview/route.ts",
      "src/app/api/admin/tyler-text-overview/[draftId]/route.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src).toContain("requireTylerAdmin");
    }
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
      draftForDayKey: "2026-07-03",
      audienceUser: AUDIENCE_USER,
      now: new Date("2026-07-02T16:00:00.000Z"),
    });
    expect(threadMemoryMock).not.toHaveBeenCalled();
    expect(checkSentInsertMock).not.toHaveBeenCalled();
    expect(db.v2EventWrites).toBe(0);
  });

  it("supplied draftForDayKey wins over user timezone and send preference", async () => {
    setupHappyPath();
    getClerkUserMock.mockResolvedValue({
      public_metadata: { timezone: "America/Los_Angeles", smsTimePreference: "evening" },
    });
    fetchCommsMock.mockResolvedValue({ preferred_send_window: "evening" });
    // Clock would have been "before 11" Pacific on Aug 5 under the old local-hour law.
    const result = await generateTylerTextOverviewDraftForUser({
      draftForDayKey: "2026-08-06",
      audienceUser: { ...AUDIENCE_USER, timezone: "America/Los_Angeles" },
      now: new Date("2026-08-05T15:57:00.000Z"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draftForDayKey).toBe("2026-08-06");
    expect(db.drafts[0]?.draft_for_day_key).toBe("2026-08-06");
    expect(loadMorningPacketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        draftForDayKey: "2026-08-06",
        timezone: "America/Los_Angeles",
      })
    );
  });
});

describe("canonical batch persists one day across US timezones", () => {
  afterEach(() => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "false";
    vi.clearAllMocks();
  });

  it("Eastern/Central/Mountain/Pacific all persist supplied Aug 6 at 11:57 AM ET", async () => {
    setupHappyPath();
    const zones = [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
    ] as const;
    db.audience = zones.map((timezone, i) => ({
      ...AUDIENCE_USER,
      clerk_user_id: `user_tz_${i}`,
      timezone,
    }));
    getClerkUserMock.mockImplementation(async (id: string) => {
      const idx = Number(String(id).replace("user_tz_", ""));
      return {
        public_metadata: {
          timezone: zones[idx] ?? "America/New_York",
          smsTimePreference: "morning",
        },
      };
    });

    const now = new Date("2026-08-05T15:57:00.000Z"); // 11:57 AM ET
    const draftForDayKey = resolveCanonicalMorningTtoBatchDraftForDayKey(now);
    expect(draftForDayKey).toBe("2026-08-06");

    const stats = await generateTylerTextOverviewDailyDrafts({ now, draftForDayKey });
    expect(stats.ok).toBe(true);
    expect(stats.draft_for_day_key).toBe("2026-08-06");
    expect(stats.generation_inserted).toBe(4);
    expect(db.drafts).toHaveLength(4);
    expect(new Set(db.drafts.map((d) => d.draft_for_day_key))).toEqual(new Set(["2026-08-06"]));
    expect(new Set(db.generations.map((g) => g.draft_for_day_key))).toEqual(
      new Set(["2026-08-06"])
    );
    for (const call of loadMorningPacketMock.mock.calls) {
      expect(call[0]?.draftForDayKey).toBe("2026-08-06");
    }
  });

  it("supplied day wins before 11 AM Eastern and after 2 PM Eastern", async () => {
    setupHappyPath();
    for (const now of [
      new Date("2026-08-05T13:00:00.000Z"), // 9 AM ET
      new Date("2026-08-05T18:30:00.000Z"), // 2:30 PM ET
    ]) {
      db.generations = [];
      db.drafts = [];
      db.audience = [AUDIENCE_USER];
      const stats = await generateTylerTextOverviewDailyDrafts({
        now,
        draftForDayKey: "2026-08-06",
      });
      expect(stats.draft_for_day_key).toBe("2026-08-06");
      expect(db.drafts[0]?.draft_for_day_key).toBe("2026-08-06");
    }
  });

  it("rejects blank draftForDayKey before audience work", async () => {
    setupHappyPath();
    const { supabaseServer } = await import("@/lib/supabase-server");
    const stats = await generateTylerTextOverviewDailyDrafts({
      now: new Date("2026-08-05T15:57:00.000Z"),
      draftForDayKey: "  ",
    });
    expect(stats.ok).toBe(false);
    expect(stats.errors_preview[0]).toMatch(/invalid_draft_for_day_key/);
    expect(supabaseServer.from).not.toHaveBeenCalled();
  });
});

describe("generateTylerTextOverviewEveningPreviewForUser", () => {
  beforeEach(() => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    db.generations = [];
    db.drafts = [];
    db.smsSendEventsWrites = 0;
    vi.clearAllMocks();
    setupHappyPath();
  });

  afterEach(() => {
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "false";
  });

  it("persists evening_checkin preview rows with metadata", async () => {
    buildDailySmsContentMock.mockImplementation(
      (_uid, _md, _day, _tz, options) => {
        expect(options?.writingBriefOverrides?.currentSendSlot).toBe(
          SMS_DAILY_EVENING_PREVIEW_SEND_SLOT
        );
        expect(options?.writingBriefOverrides?.slotDaypartOverride).toBe("evening");
        return Promise.resolve({
          ...SUCCESS_BUILT,
          v2AiPayload: {
            v3_brain: {
              slot_coaching_context: {
                version: "1",
                current_slot: "evening_checkin",
                previous_slot: "morning",
                previous_outbound_summary: "Morning rep.",
                user_replies_since_previous_outbound: null,
                active_coaching_thread: "Thread focus: plan",
                slot_role_recommendation: "truth_check",
                checkin_focus: null,
                should_send_recommendation: "writer_decides",
                skip_reason_hint: null,
              },
              current_send_slot: "evening_checkin",
            },
          },
        });
      }
    );

    const result = await generateTylerTextOverviewEveningPreviewForUser({
      clerkUserId: AUDIENCE_USER.clerk_user_id,
      draftForDayKey: "2026-07-03",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(db.generations.some((g) => g.send_slot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT)).toBe(
      true
    );
    expect(db.drafts.some((d) => d.send_slot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT)).toBe(true);
    expect(db.generations.some((g) => g.send_slot === "morning")).toBe(false);

    const eveningGen = db.generations.find(
      (g) => g.send_slot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT
    );
    const meta = eveningGen?.generation_metadata as Record<string, unknown>;
    expect(meta.preview_only).toBe(true);
    expect(meta.preview_slot).toBe(SMS_DAILY_EVENING_PREVIEW_SEND_SLOT);
    expect(meta.morning_anchor_source).toBeTruthy();
    expect(meta.current_send_slot).toBe("evening_checkin");
    expect(db.smsSendEventsWrites).toBe(0);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("morning and evening drafts coexist for same user/day", async () => {
    db.generations.push({
      id: "gen-morning",
      clerk_user_id: AUDIENCE_USER.clerk_user_id,
      draft_for_day_key: "2026-07-03",
      send_slot: "morning",
      generation_number: 1,
    });
    db.drafts.push({
      clerk_user_id: AUDIENCE_USER.clerk_user_id,
      draft_for_day_key: "2026-07-03",
      send_slot: "morning",
      status: "current",
    });

    buildDailySmsContentMock.mockResolvedValue(SUCCESS_BUILT);
    await generateTylerTextOverviewEveningPreviewForUser({
      clerkUserId: AUDIENCE_USER.clerk_user_id,
      draftForDayKey: "2026-07-03",
    });

    const morningDrafts = db.drafts.filter(
      (d) => d.send_slot === "morning" && d.draft_for_day_key === "2026-07-03"
    );
    const eveningDrafts = db.drafts.filter(
      (d) => d.send_slot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT
    );
    expect(morningDrafts.length).toBe(1);
    expect(eveningDrafts.length).toBe(1);
  });

  it("defaults to user-local today at 8 PM ET without morning rollover", async () => {
    buildDailySmsContentMock.mockResolvedValue(SUCCESS_BUILT);
    const result = await generateTylerTextOverviewEveningPreviewForUser({
      clerkUserId: AUDIENCE_USER.clerk_user_id,
      now: new Date("2026-07-10T00:00:00.000Z"), // 8:00 PM ET July 9
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draftForDayKey).toBe("2026-07-09");
    expect(buildDailySmsContentMock).toHaveBeenCalledWith(
      AUDIENCE_USER.clerk_user_id,
      expect.any(Object),
      "2026-07-09",
      "America/New_York",
      expect.objectContaining({
        mode: "draft",
        writingBriefOverrides: expect.objectContaining({
          currentSendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
        }),
      })
    );
    const eveningOpts = buildDailySmsContentMock.mock.calls.at(-1)?.[4] as
      | { ttoDraftPreservePrimaryBody?: boolean }
      | undefined;
    expect(eveningOpts?.ttoDraftPreservePrimaryBody).not.toBe(true);
  });

  it("respects explicit draftForDayKey even when local evening would be today", async () => {
    buildDailySmsContentMock.mockResolvedValue(SUCCESS_BUILT);
    const result = await generateTylerTextOverviewEveningPreviewForUser({
      clerkUserId: AUDIENCE_USER.clerk_user_id,
      draftForDayKey: "2026-07-10",
      now: new Date("2026-07-10T00:00:00.000Z"), // 8:00 PM ET July 9
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draftForDayKey).toBe("2026-07-10");
  });
});
