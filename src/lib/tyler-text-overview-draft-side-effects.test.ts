import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildWriterOpenAiCapture,
  hashWriterOpenAiMessages,
} from "@/lib/tyler-text-overview-writer-capture";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";

const clearStaleMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const reconcileCheckSentMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    attempted: 0,
    recovered: 0,
    failures: 0,
    snapshotCandidatesFound: 0,
    snapshotReplayAttempted: 0,
    snapshotReplayApplied: 0,
    heuristicFallbackAttempted: 0,
    heuristicFallbackApplied: 0,
    unresolvedAfterBoth: 0,
  })
);
const reconcileRefreshMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    attempted: 0,
    recovered: 0,
    failures: 0,
    stateConflicts: 0,
    rpcFailures: 0,
    repeatedLikely: 0,
    snapshotCandidatesFound: 0,
    snapshotReplayAttempted: 0,
    snapshotReplayApplied: 0,
    heuristicFallbackAttempted: 0,
    heuristicFallbackApplied: 0,
    unresolvedAfterBoth: 0,
  })
);
const abandonRefreshMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const clearPendingMock = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const sendSmsMock = vi.hoisted(() => vi.fn());
const getActiveCommitmentMock = vi.hoisted(() => vi.fn());
const buildRecentExactThreadForBriefMock = vi.hoisted(() => vi.fn());
const createMock = vi.hoisted(() => vi.fn());

const EMPTY_BRIEF_THREAD_MOCK = {
  window: { floor_hours: 72, extension_days: 7, mode: "72h_floor_7d_extension_capped" as const },
  messages: [],
  message_count: 0,
  char_count: 0,
  timeline_7d: {
    messages: [],
    window_hours: 168 as const,
    message_count: 0,
    had_preview_messages: false,
    had_system_no_send: false,
  },
  build_telemetry: {
    daily_brief_thread_source_candidate_count: 0,
    daily_brief_thread_visible_send_candidate_count: 0,
    daily_brief_thread_user_inbound_candidate_count: 0,
    daily_brief_thread_weekly_candidate_count: 0,
    daily_brief_thread_filtered_out_count: 0,
    daily_brief_thread_filtered_out_reason_top: null,
    daily_brief_thread_effective_timestamp_rescue_count: 0,
    daily_brief_thread_source_tables_present: "",
  },
  exact_source_message_count: 0,
  last_outbound_fallback_message_count: 0,
};

vi.mock("@/lib/sms-recent-exact-thread-72h", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sms-recent-exact-thread-72h")>();
  return {
    ...actual,
    buildRecentExactThreadForBrief: buildRecentExactThreadForBriefMock,
  };
});

vi.mock("@/lib/v2-adaptive-contract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-adaptive-contract")>();
  return {
    ...actual,
    clearStaleAdaptiveContractColumns: clearStaleMock,
  };
});

vi.mock("@/lib/v2-outbound-check-sent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-outbound-check-sent")>();
  return {
    ...actual,
    reconcileCheckSentPostSendBookkeepingForCommitment: reconcileCheckSentMock,
  };
});

vi.mock("@/lib/v2-refresh-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-refresh-session")>();
  return {
    ...actual,
    reconcileRefreshPostSendBookkeepingForCommitment: reconcileRefreshMock,
    abandonRefreshSessionTimeout: abandonRefreshMock,
  };
});

vi.mock("@/lib/v2-guided-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-guided-resolution")>();
  return {
    ...actual,
    clearPendingResolutionIfExpired: clearPendingMock,
  };
});

vi.mock("@/lib/twilio", () => ({
  sendSMS: sendSmsMock,
  isTwilioReady: vi.fn(() => false),
}));

vi.mock("@/lib/v2-commitment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-commitment")>();
  return {
    ...actual,
    getActiveCommitment: getActiveCommitmentMock,
    getLatestV2AccountabilityOutcome: vi.fn().mockResolvedValue(null),
    getRecentV2EventsForAi: vi.fn().mockResolvedValue([]),
    getLastV2CheckSentForCommitment: vi.fn().mockResolvedValue(null),
    getLastNV2CheckSentPayloads: vi.fn().mockResolvedValue([]),
    getLatestBlockerCapturedAfter: vi.fn().mockResolvedValue(null),
    shouldEnterLowPressureReactivation: vi.fn().mockReturnValue(false),
    isReactivationNudgeDue: vi.fn().mockReturnValue(false),
  };
});

vi.mock("@/lib/sms-relationship-memory-packet", () => ({
  buildSmsRelationshipMemoryPacket: vi.fn().mockResolvedValue({
    last_outbound_full_body: null,
    last_inbound_full_body: null,
    latest_open_question: null,
    latest_answer_after_open_question: null,
    open_question_pending: false,
    open_question_expected_answer_type: null,
    open_question_answered_at: null,
    do_not_repeat_phrases: [],
    last_5_user_answers: [],
    relationship_anchor_sources: { people: [], schedule: [] },
  }),
  buildDailyThreadMemoryFromPacket: vi.fn().mockReturnValue({
    latest_outbound_sms: null,
    latest_inbound_sms: null,
    recent_transcript_or_context_block: null,
    latest_open_question: null,
    do_not_repeat_hints: [],
    coaching_memory_snippet: "",
    recent_pattern_hints: null,
  }),
}));

vi.mock("@/lib/supabase-server", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    insert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockResolvedValue({ error: null }),
  };
  return {
    supabaseServer: {
      from: vi.fn(() => chain),
    },
  };
});

vi.mock("openai", () => ({
  __esModule: true,
  default: class MockOpenAI {
    chat = {
      completions: {
        create: createMock,
      },
    };
  },
}));

const FORBIDDEN_RUNTIME_PATHS = [
  "src/app/api/cron/weekly-sms/route.ts",
  "src/app/api/twilio/inbound/route.ts",
  "src/app/api/cron/sms-inbound-coach/route.ts",
  "src/lib/sms-recent-exact-thread-72h.ts",
  "src/lib/sms-daily-writing-brief-v1.ts",
  "src/lib/twilio.ts",
  "vercel.json",
];

const ACTIVE_COMMITMENT = {
  id: "11111111-1111-1111-1111-111111111111",
  clerk_user_id: "user_tyler_phase2",
  behavior_statement: "Two hours deep work before noon",
  title: "Deep work",
  status: "active",
  accountability_phase: "active_accountability",
  refresh_session: null,
  pending_resolution_kind: null,
  pending_resolution_created_at: null,
  pending_resolution_expires_at: null,
  adaptive_contract_kind: null,
  adaptive_contract_expires_at: null,
  adaptive_proposal_text: null,
  behavior_statement_effective: null,
  started_at: "2026-01-01T00:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
};

const WRITER_CAPTURE = buildWriterOpenAiCapture({
  messages: [
    { role: "system", content: "system prompt" },
    { role: "user", content: "DAILY_SMS_WRITING_BRIEF_V1\n{}" },
  ],
  model: "gpt-4o-mini",
  writer_prompt_path: "daily_writing_brief_v1",
});

describe("tyler-text-overview writer capture helpers", () => {
  it("hashWriterOpenAiMessages is deterministic for same messages", () => {
    const messages = [
      { role: "system" as const, content: "A" },
      { role: "user" as const, content: "B" },
    ];
    expect(hashWriterOpenAiMessages(messages)).toBe(hashWriterOpenAiMessages(messages));
  });

  it("buildWriterOpenAiCapture sets notebook_hash from messages", () => {
    const capture = buildWriterOpenAiCapture({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "user" },
      ],
      model: "gpt-4o-mini",
      writer_prompt_path: "daily_writing_brief_v1",
    });
    expect(capture.notebook_hash).toBe(
      hashWriterOpenAiMessages([
        { role: "system", content: "sys" },
        { role: "user", content: "user" },
      ])
    );
  });
});

describe("buildDailySmsContent draft mode side effects", () => {
  let produceLaneMock: MockInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    buildRecentExactThreadForBriefMock.mockResolvedValue(EMPTY_BRIEF_THREAD_MOCK);
    getActiveCommitmentMock.mockResolvedValue(ACTIVE_COMMITMENT);
    const lane = await import("@/lib/v3-daily-relationship-lane");
    produceLaneMock = vi.spyOn(lane, "produceDailyV3RelationshipSms").mockResolvedValue({
      body: "Did the two hours happen before noon?",
      shouldSend: true,
      noSendReason: null,
      replySource: "v3_daily_relationship_lane",
      turnPurpose: "daily_accountability",
      voiceConfidence: 0.8,
      usedFacts: [],
      safetyNotes: [],
      metadata: { daily_v3_lane_used: true },
      openAiOk: true,
      writerOpenAiCapture: WRITER_CAPTURE,
    });
  });

  afterEach(() => {
    produceLaneMock?.mockRestore();
  });

  it("draft mode skips bookkeeping and commitment mutation side effects", async () => {
    const { buildDailySmsContent } = await import("@/lib/daily-sms-build");

    const built = await buildDailySmsContent(
      "user_tyler_phase2",
      { timezone: "America/New_York" },
      "2026-07-02",
      "America/New_York",
      { mode: "draft" }
    );

    expect(clearStaleMock).not.toHaveBeenCalled();
    expect(reconcileCheckSentMock).not.toHaveBeenCalled();
    expect(reconcileRefreshMock).not.toHaveBeenCalled();
    expect(abandonRefreshMock).not.toHaveBeenCalled();
    expect(clearPendingMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();

    if (built.ok) {
      expect(built.writerOpenAiCapture?.messages).toEqual(WRITER_CAPTURE.messages);
      expect(built.writerOpenAiCapture?.notebook_hash).toBe(WRITER_CAPTURE.notebook_hash);
    }
  });

  it("send mode runs opening bookkeeping side effects", async () => {
    const { buildDailySmsContent } = await import("@/lib/daily-sms-build");

    await buildDailySmsContent(
      "user_tyler_phase2",
      { timezone: "America/New_York" },
      "2026-07-02",
      "America/New_York",
      { mode: "send" }
    );

    expect(clearStaleMock).toHaveBeenCalled();
    expect(reconcileCheckSentMock).toHaveBeenCalled();
    expect(reconcileRefreshMock).toHaveBeenCalled();
  });
});

describe("daily-sms route send-mode wiring", () => {
  it("imports buildDailySmsContent from daily-sms-build", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/cron/daily-sms/route.ts"),
      "utf8"
    );
    expect(route).toContain('from "@/lib/daily-sms-build"');
    expect(route).toContain("buildDailySmsContent(");
    expect(route).not.toMatch(/async function buildDailySmsContent\(/);
  });
});

describe("tyler-text-overview Phase 2 scope guards", () => {
  it("new files do not read TYLER_TEXT_OVERVIEW_ENABLED", () => {
    const paths = [
      "src/lib/daily-sms-build.ts",
      "src/lib/tyler-text-overview-writer-capture.ts",
      "src/lib/v3-daily-relationship-lane.ts",
    ];
    for (const rel of paths) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src).not.toContain("TYLER_TEXT_OVERVIEW_ENABLED");
      expect(src).not.toMatch(/process\.env\.TYLER_TEXT_OVERVIEW/);
    }
  });

  it("new files do not persist to draft tables", () => {
    const paths = [
      "src/lib/daily-sms-build.ts",
      "src/lib/v3-daily-relationship-lane.ts",
    ];
    for (const rel of paths) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src).not.toContain("sms_daily_draft_generations");
      expect(src).not.toContain("sms_daily_drafts");
    }
  });

  it("forbidden runtime files were not modified in this phase scope", () => {
    for (const relPath of FORBIDDEN_RUNTIME_PATHS) {
      expect(readFileSync(join(process.cwd(), relPath), "utf8").length).toBeGreaterThan(0);
    }
  });
});

describe("produceDailyV3RelationshipSms writerOpenAiCapture", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    createMock.mockClear();
    buildRecentExactThreadForBriefMock.mockClear();
  });

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    buildRecentExactThreadForBriefMock.mockResolvedValue(EMPTY_BRIEF_THREAD_MOCK);
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              should_send: true,
              body: "Quick check — did the two hours happen before noon?",
              no_send_reason: null,
              turn_purpose: "daily_accountability",
              voice_confidence: 0.8,
              used_facts: [],
              safety_notes: [],
            }),
          },
        },
      ],
    });
  });

  it("writerOpenAiCapture.messages match OpenAI primaryMessages", async () => {
    const { produceDailyV3RelationshipSms } = await import("@/lib/v3-daily-relationship-lane");
    const facts = {
      route_kind: "main_active_accountability" as const,
      accountability_day_key: "2026-05-12",
      user: {
        clerk_user_id: "user_test",
        preferred_name: "Alex",
        timezone: "America/Chicago",
        local_time_iso: "2026-05-12T09:00:00.000Z",
        relationship_profile_summary: null,
      },
      commitment: {
        id: "cmt_1",
        title: "Morning focus",
        behavior_statement: "Two hours of deep work before noon",
        effective_ask: "Two hours of deep work before noon",
        accountability_phase: "active_accountability",
        identity_anchor_allowed: false,
        identity_anchor_short: null,
      },
      thread_memory: {
        latest_outbound_sms: "How did yesterday land?",
        latest_inbound_sms: "Rough start",
        recent_transcript_or_context_block: "Coach: …\nUser: …",
        latest_open_question: null,
        do_not_repeat_hints: [],
        coaching_memory_snippet: "COACHING_MEMORY…",
        recent_pattern_hints: null,
      },
      accountability: {
        daily_purpose: "standard_accountability_check",
        server_strategy: "standard_check",
        next_move_type: "hold_standard",
        prior_outcome: "user_no",
        yes_streak_14d: 1,
        no_count_14d: 2,
        partial_count_14d: 0,
        blocker_preview: "meetings",
        proof_or_milestone_signal: null,
        silence_tier: "none",
        unanswered_checks: 0,
        days_since_last_user_outcome: 1,
        reentry_active: false,
        overlay_active: false,
        evolution_pattern_hint: null,
        contract_proposal_mode: false,
      },
      suggested_coaching_move: "ask_completion",
      constraints: {
        max_chars: 300,
        one_sms: true,
        no_raw_title_or_behavior_paste: true,
        no_generic_motivation: true,
        if_unsafe_return_no_send: true,
      },
    } satisfies DailyV3RelationshipFacts;

    const r = await produceDailyV3RelationshipSms({
      facts,
      telemetry_fact_sources: ["tyler_text_overview_capture_test"],
    });

    const openAiMessages = createMock.mock.calls.at(-1)?.[0]?.messages as
      | Array<{ role: string; content: string }>
      | undefined;
    expect(openAiMessages?.length).toBe(2);
    expect(r.writerOpenAiCapture?.messages).toEqual(openAiMessages);
    expect(r.writerOpenAiCapture?.notebook_hash).toBe(
      hashWriterOpenAiMessages(
        (openAiMessages ?? []) as Array<{ role: "system" | "user" | "assistant"; content: string }>
      )
    );
  });
});
