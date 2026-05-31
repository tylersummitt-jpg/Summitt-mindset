import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFrom = vi.hoisted(() => vi.fn());
const getRecentV2EventsForAi = vi.hoisted(() => vi.fn());
const loadV2CoachingMemoryForPrompt = vi.hoisted(() => vi.fn());
const loadV2CommitmentSmsThreadMemory = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: supabaseFrom },
}));

vi.mock("@/lib/v2-commitment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-commitment")>();
  return {
    ...actual,
    getRecentV2EventsForAi,
  };
});

vi.mock("@/lib/v2-coaching-memory", () => ({
  loadV2CoachingMemoryForPrompt,
}));

vi.mock("@/lib/v2-commitment-sms-thread-memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-commitment-sms-thread-memory")>();
  return {
    ...actual,
    loadV2CommitmentSmsThreadMemory,
  };
});

import { buildInboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";
import type { V2InboundGatedDecision } from "@/lib/v2-ai-inbound";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  MEMORY_PRIORITY_RULES,
  buildDailyThreadMemoryFromPacket,
  buildSmsRelationshipMemoryPacket,
  slimMemoryPacketForFacts,
  type SmsRelationshipMemoryPacket,
} from "@/lib/sms-relationship-memory-packet";

const NOW = new Date("2026-05-18T12:00:00.000Z");

function chain(rows: unknown[] | unknown | null) {
  const result = { data: rows, error: null };
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve(Array.isArray(rows) ? { data: rows[0] ?? null, error: null } : result),
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  return builder;
}

function setupSupabaseTables(args: {
  sendRows?: unknown[];
  jobRows?: unknown[];
  inboundMsgRows?: unknown[];
  lastCtx?: unknown | null;
  profile?: unknown | null;
  commitment?: unknown | null;
}) {
  supabaseFrom.mockImplementation((table: string) => {
    switch (table) {
      case "sms_send_events":
        return chain(args.sendRows ?? []);
      case "sms_inbound_coach_jobs":
        return chain(args.jobRows ?? []);
      case "sms_inbound_messages":
        return chain(args.inboundMsgRows ?? []);
      case "sms_last_outbound_context":
        return chain(args.lastCtx ?? null);
      case "user_profiles":
        return chain(args.profile ?? null);
      case "v2_commitment":
        return chain(args.commitment ?? null);
      default:
        return chain([]);
    }
  });
}

describe("buildSmsRelationshipMemoryPacket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentV2EventsForAi.mockResolvedValue([]);
    loadV2CoachingMemoryForPrompt.mockResolvedValue(null);
    loadV2CommitmentSmsThreadMemory.mockResolvedValue(null);
  });

  it("builds recent_exact_messages from coach jobs and send events", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          sms_body: "Daily check: did you get your two hours in?",
          created_at: "2026-05-18T11:00:00.000Z",
          status: "sent",
        },
      ],
      jobRows: [
        {
          raw_body: "Sunday School, farm, songs Mother sang",
          reply_body: "Beautiful memories — keep going.",
          status: "sent",
          sent_at: "2026-05-18T11:30:00.000Z",
          created_at: "2026-05-18T11:29:00.000Z",
          updated_at: "2026-05-18T11:31:00.000Z",
        },
      ],
    });

    const packet = await buildSmsRelationshipMemoryPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      now: NOW,
    });

    const sources = packet.recent_exact_messages.map((m) => m.source_table);
    expect(sources).toContain("sms_send_events");
    expect(sources).toContain("sms_inbound_coach_jobs");
    expect(packet.recent_exact_messages.some((m) => m.speaker === "user" && m.body.includes("Sunday School"))).toBe(
      true
    );
    expect(packet.recent_exact_messages.some((m) => m.speaker === "coach" && m.is_exact_body)).toBe(true);
    expect(packet.recent_exact_thread_72h.window_hours).toBe(72);
    expect(packet.relationship_memory_7d.window_days).toBe(7);
  });

  it("prefers full sms_send_events.sms_body over check_sent body_preview", async () => {
    const fullBody = "FULL_DAILY_BODY_" + "x".repeat(200);
    setupSupabaseTables({
      sendRows: [
        {
          sms_body: fullBody,
          created_at: "2026-05-18T10:00:00.000Z",
          status: "sent",
        },
      ],
    });
    getRecentV2EventsForAi.mockResolvedValue([
      {
        event_type: "check_sent",
        occurred_at: "2026-05-18T10:00:01.000Z",
        payload_json: { body_preview: "SHORT_PREVIEW_ONLY" },
      },
    ]);

    const packet = await buildSmsRelationshipMemoryPacket({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
      timezone: "America/Chicago",
      now: NOW,
    });

    const coachMsgs = packet.recent_exact_messages.filter((m) => m.speaker === "coach");
    expect(coachMsgs.some((m) => m.body.includes("FULL_DAILY_BODY"))).toBe(true);
    expect(coachMsgs.some((m) => m.body === "SHORT_PREVIEW_ONLY")).toBe(false);
  });

  it("excludes transactional sms_last_outbound_context from coaching last_outbound", async () => {
    setupSupabaseTables({
      sendRows: [
        {
          sms_body: "Coach question: what is your smallest win today?",
          created_at: "2026-05-18T11:50:00.000Z",
          status: "sent",
        },
      ],
      lastCtx: {
        sent_at: "2026-05-18T11:55:00.000Z",
        full_body: "Your subscription renews tomorrow.",
        message_kind: "transactional",
      },
    });

    const packet = await buildSmsRelationshipMemoryPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      now: NOW,
    });

    expect(packet.last_outbound_full_body).toMatch(/smallest win/i);
    expect(packet.recent_exact_messages.every((m) => !m.body.includes("subscription renews"))).toBe(true);
  });

  it("extracts last_5_coach_questions and last_5_user_answers", async () => {
    setupSupabaseTables({
      jobRows: [
        {
          raw_body: "Sunday School, farm, songs Mother sang",
          created_at: "2026-05-18T11:20:00.000Z",
          updated_at: "2026-05-18T11:20:00.000Z",
        },
        {
          reply_body: "What story will you dictate today?",
          status: "sent",
          sent_at: "2026-05-18T11:10:00.000Z",
          updated_at: "2026-05-18T11:10:00.000Z",
        },
        {
          reply_body: "How did yesterday go?",
          status: "sent",
          sent_at: "2026-05-18T10:00:00.000Z",
          updated_at: "2026-05-18T10:00:00.000Z",
        },
      ],
    });

    const packet = await buildSmsRelationshipMemoryPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      now: NOW,
    });

    expect(packet.last_5_coach_questions.length).toBeGreaterThan(0);
    expect(packet.last_5_coach_questions.some((q) => /dictate today/i.test(q.text))).toBe(true);
    expect(packet.last_5_user_answers.some((a) => a.text.includes("Sunday School"))).toBe(true);
  });

  it("derives latest_open_question_guess and answer after substantive user reply", async () => {
    setupSupabaseTables({
      jobRows: [
        {
          raw_body: "Sunday School, farm, songs Mother sang",
          created_at: "2026-05-18T11:25:00.000Z",
          updated_at: "2026-05-18T11:25:00.000Z",
        },
        {
          reply_body: "What story will you dictate today?",
          status: "sent",
          sent_at: "2026-05-18T11:10:00.000Z",
          updated_at: "2026-05-18T11:10:00.000Z",
        },
      ],
    });

    const packet = await buildSmsRelationshipMemoryPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      now: NOW,
    });

    expect(packet.latest_open_question_guess).toMatch(/dictate today/i);
    expect(packet.latest_answer_after_open_question_guess).toContain("Sunday School");
  });

  it("adds do_not_repeat_phrases from prior coach questions", async () => {
    setupSupabaseTables({
      jobRows: [
        {
          reply_body: "What story will you dictate today?",
          status: "sent",
          sent_at: "2026-05-18T11:10:00.000Z",
          updated_at: "2026-05-18T11:10:00.000Z",
        },
      ],
    });

    const packet = await buildSmsRelationshipMemoryPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      now: NOW,
    });

    expect(packet.do_not_repeat_phrases.some((h) => /dictate today/i.test(h.phrase))).toBe(true);
  });

  it("includes memory_priority_rules", async () => {
    setupSupabaseTables({});
    const packet = await buildSmsRelationshipMemoryPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      now: NOW,
    });
    expect(packet.memory_priority_rules).toEqual([...MEMORY_PRIORITY_RULES]);
  });

  it("caps packet size safely", async () => {
    const long = "W".repeat(800);
    setupSupabaseTables({
      jobRows: Array.from({ length: 30 }, (_, i) => ({
        raw_body: `${long}_${i}`,
        created_at: new Date(NOW.getTime() - i * 60_000).toISOString(),
        updated_at: new Date(NOW.getTime() - i * 60_000).toISOString(),
      })),
    });

    const packet = await buildSmsRelationshipMemoryPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      maxMessages: 20,
      now: NOW,
    });

    expect(packet.recent_exact_messages.length).toBeLessThanOrEqual(20);
    for (const m of packet.recent_exact_messages) {
      expect(m.body.length).toBeLessThanOrEqual(8000);
    }
    expect(packet.recent_exact_thread_text.length).toBeLessThanOrEqual(11_000);
    expect(packet.recent_exact_thread_72h.window_hours).toBe(72);
  });
});

describe("buildSmsRelationshipMemoryPacket projection (M2B-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentV2EventsForAi.mockResolvedValue([]);
    loadV2CoachingMemoryForPrompt.mockResolvedValue(null);
    loadV2CommitmentSmsThreadMemory.mockResolvedValue(null);
  });

  it("reads mocked projection row and beats runtime open-question guess", async () => {
    setupSupabaseTables({
      jobRows: [
        {
          reply_body: "What story will you dictate today?",
          status: "sent",
          sent_at: "2026-05-18T11:10:00.000Z",
          updated_at: "2026-05-18T11:10:00.000Z",
        },
        {
          raw_body: "Sunday School, farm, songs Mother sang",
          created_at: "2026-05-18T11:20:00.000Z",
          updated_at: "2026-05-18T11:20:00.000Z",
        },
      ],
    });

    loadV2CommitmentSmsThreadMemory.mockResolvedValue({
      commitment_id: "cmt_proj",
      clerk_user_id: "user_1",
      projection_version: 1,
      last_outbound_full_body: "Projection coach: what is your smallest win today?",
      last_outbound_sent_at: "2026-05-18T12:00:00.000Z",
      last_outbound_source: "daily_sms",
      last_outbound_message_sid: "SM_PROJ_OUT",
      last_inbound_full_body: "Sunday School, farm, songs Mother sang",
      last_inbound_at: "2026-05-18T11:20:00.000Z",
      last_inbound_message_sid: "SM_PROJ_IN",
      last_5_coach_questions: [
        {
          text: "What is your smallest win today?",
          asked_at: "2026-05-18T12:00:00.000Z",
          source: "daily_sms",
          message_sid: "SM_PROJ_OUT",
        },
      ],
      last_5_user_answers: [
        {
          text: "Sunday School, farm, songs Mother sang",
          answered_at: "2026-05-18T11:20:00.000Z",
          source: "inbound_sms",
          message_sid: "SM_PROJ_IN",
        },
      ],
      open_question_text: "What is your smallest win today?",
      open_question_asked_at: "2026-05-18T12:00:00.000Z",
      open_question_expected_answer_type: "open_reflection",
      open_question_source_message_sid: "SM_PROJ_OUT",
      open_question_answer_text: "Sunday School, farm, songs Mother sang",
      open_question_answered_at: "2026-05-18T11:20:00.000Z",
      open_question_pending: false,
      do_not_repeat_phrases: ["What is your smallest win today?"],
      recent_frustration_corrections: [],
      current_live_thread_summary: null,
      last_recomputed_from_spine_at: null,
      created_at: "2026-05-18T10:00:00.000Z",
      updated_at: "2026-05-18T12:00:00.000Z",
    });

    const packet = await buildSmsRelationshipMemoryPacket({
      clerkUserId: "user_1",
      commitmentId: "cmt_proj",
      now: NOW,
    });

    expect(loadV2CommitmentSmsThreadMemory).toHaveBeenCalledWith({ commitmentId: "cmt_proj" });
    expect(packet.meta.projection_used).toBe(true);
    expect(packet.latest_open_question).toBe("What is your smallest win today?");
    expect(packet.open_question_source).toBe("projection");
    expect(packet.latest_answer_after_open_question).toContain("Sunday School");
    expect(packet.answer_source).toBe("projection");
    expect(packet.latest_open_question_guess).toMatch(/dictate today/i);
    expect(packet.do_not_repeat_phrases.some((h) => h.kind === "projection_dnr")).toBe(true);
    expect(packet.last_5_coach_questions[0]?.source_table).toBe("v2_commitment_sms_thread_memory");
  });

  it("falls back to runtime packet when projection load returns null", async () => {
    setupSupabaseTables({
      jobRows: [
        {
          reply_body: "What story will you dictate today?",
          status: "sent",
          sent_at: "2026-05-18T11:10:00.000Z",
          updated_at: "2026-05-18T11:10:00.000Z",
        },
      ],
    });
    loadV2CommitmentSmsThreadMemory.mockResolvedValue(null);

    const packet = await buildSmsRelationshipMemoryPacket({
      clerkUserId: "user_1",
      commitmentId: "cmt_proj",
      now: NOW,
    });

    expect(packet.meta.projection_used).toBe(false);
    expect(packet.open_question_source).toBe("runtime_guess");
    expect(packet.latest_open_question).toMatch(/dictate today/i);
  });

  it("does not throw when projection load rejects", async () => {
    setupSupabaseTables({});
    loadV2CommitmentSmsThreadMemory.mockRejectedValue(new Error("projection_read_failed"));

    await expect(
      buildSmsRelationshipMemoryPacket({
        clerkUserId: "user_1",
        commitmentId: "cmt_proj",
        now: NOW,
      })
    ).resolves.toBeTruthy();
  });
});

function makeRbMemoryPacket(): SmsRelationshipMemoryPacket {
  return {
    clerk_user_id: "user_mem",
    commitment_id: "cmt_mem",
    behavior_statement: "Dictate stories",
    effective_ask: "Dictate stories",
    accountability_phase: "active_accountability",
    pending_resolution_summary: null,
    overlay_active: false,
    recent_outcomes_summary: {
      yes_7d: 0,
      no_7d: 0,
      partial_7d: 0,
      blockers_7d: 0,
      checks_sent_7d: 0,
      latest_blocker_preview: null,
      latest_proof_hint: null,
    },
    coaching_memory_summary: null,
    coaching_memory_is_background_only: true,
    relationship_profile_summary: null,
    recent_exact_messages: [
      {
        speaker: "coach",
        body: "What story will you dictate today?",
        source_table: "sms_inbound_coach_jobs",
        created_at: "2026-05-18T11:00:00.000Z",
        message_kind: "coach",
        is_exact_body: true,
        is_preview: false,
      },
      {
        speaker: "user",
        body: "Sunday School, farm, songs Mother sang",
        source_table: "sms_inbound_coach_jobs",
        created_at: "2026-05-18T11:20:00.000Z",
        message_kind: null,
        is_exact_body: true,
        is_preview: false,
      },
      {
        speaker: "user",
        body: "I already told you",
        source_table: "sms_inbound_coach_jobs",
        created_at: "2026-05-18T11:30:00.000Z",
        message_kind: null,
        is_exact_body: true,
        is_preview: false,
      },
    ],
    recent_exact_thread_text:
      "Coach: What story will you dictate today?\nUser: Sunday School, farm, songs Mother sang\nUser: I already told you",
    recent_exact_thread_72h: {
      messages: [],
      window_hours: 72,
      message_count: 0,
      had_preview_messages: false,
      had_system_no_send: false,
    },
    relationship_memory_7d: {
      window_days: 7,
      built_at: NOW.toISOString(),
      outcome_counts: { yes: 0, no: 0, partial: 0, blockers: 0, checks_sent: 0 },
      wins: [],
      misses: [],
      partials: [],
      comebacks: [],
      blockers: [],
      proof_moments: [],
      open_loops: [],
      direct_answer_history: [],
      context_flags: {},
      meta: { item_count: 0, sources_used: [] },
    },
    last_outbound_full_body: "What story will you dictate today?",
    last_inbound_full_body: "I already told you",
    last_substantive_user_message: "Sunday School, farm, songs Mother sang",
    last_substantive_coach_message: "What story will you dictate today?",
    last_5_coach_questions: [
      {
        text: "What story will you dictate today?",
        asked_at: "2026-05-18T11:00:00.000Z",
        source_table: "sms_inbound_coach_jobs",
        is_preview: false,
      },
    ],
    last_5_user_answers: [
      {
        text: "Sunday School, farm, songs Mother sang",
        answered_at: "2026-05-18T11:20:00.000Z",
        source_table: "sms_inbound_coach_jobs",
      },
    ],
    latest_open_question_guess: "What story will you dictate today?",
    latest_answer_after_open_question_guess: "Sunday School, farm, songs Mother sang",
    latest_open_question: "What story will you dictate today?",
    latest_answer_after_open_question: "Sunday School, farm, songs Mother sang",
    open_question_answered_at: null,
    open_question_pending: false,
    open_question_expected_answer_type: null,
    open_question_source: "runtime_guess",
    answer_source: "runtime_guess",
    do_not_repeat_phrases: [{ kind: "prior_coach_question", phrase: "What story will you dictate today?" }],
    memory_priority_rules: [...MEMORY_PRIORITY_RULES],
    meta: {
      message_count: 3,
      thread_text_capped: false,
      sources_used: ["sms_inbound_coach_jobs"],
      built_at: NOW.toISOString(),
      projection_used: false,
      projection_load_failed: false,
    },
  };
}

describe("inbound and daily memory packet wiring", () => {
  function baseCommitment(): ActiveV2CommitmentRow {
    return {
      id: "cmt_mem",
      clerk_user_id: "user_mem",
      status: "active",
      behavior_statement: "Dictate stories",
      title: "Stories",
      success_criteria: null,
      blocker_capture_expires_at: null,
      blocker_capture_after_event: null,
      adaptive_ask_text: null,
      adaptive_ask_active_from: null,
      adaptive_ask_expires_at: null,
      adaptive_proposal_text: null,
      adaptive_proposal_created_at: null,
      adaptive_proposal_expires_at: null,
      accountability_phase: "active_accountability",
      reactivation_entered_at: null,
      reactivation_last_sent_at: null,
      reactivation_entry_reason_code: null,
      refresh_session: null,
      commitment_refresh_last_prompted_at: null,
      pending_resolution_kind: null,
      pending_resolution_created_at: null,
      pending_resolution_expires_at: null,
      pending_resolution_payload: null,
      updated_at: null,
      started_at: null,
    };
  }

  const gated: V2InboundGatedDecision = {
    mode: "use_deterministic",
    final_event_type: "user_partial",
    decision_reason: "test",
    confidence_used: null,
    should_write_outcome_event: true,
    should_open_blocker_capture: false,
    reply_style: "normal_outcome",
    overrode_deterministic: false,
  };

  const rbPacket = makeRbMemoryPacket();
  const slimPacket = slimMemoryPacketForFacts(rbPacket);

  it("inbound facts include memory_packet fields", () => {
    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_mem",
      preferredName: "R.B.",
      timezone: "America/Chicago",
      localTimeIso: NOW.toISOString(),
      commitment: baseCommitment(),
      effectiveAsk: "Dictate stories",
      userMessageRaw: "I already told you",
      coalescedInboundText: "I already told you",
      suppressedMessageSids: [],
      transcriptLines: ["Coach: What story will you dictate today?", "User: I already told you"],
      northStarPacket: {
        source: "sms_inbound_coach",
        latestOutboundBody: "About grammar school",
        latestOpenQuestion: null,
        expectedReplySemantics: null,
        proofSignal: false,
        missSignal: false,
        blockerSignal: false,
        todayCompleted: false,
      },
      gatedDecision: gated,
      deterministicEventType: "user_partial",
      doNotRepeatHints: [],
      relationshipProfileSummary: null,
      conversationBrain: { enabled: false },
      centralBrain: { shadow_stored: false },
      arc: { ambiguous_short_reply: false, clarification_required: false },
      phase5a: {
        central_tether_brain_enabled: false,
        arc_clarify_brain_enabled: false,
        inbound_stitched_final_enabled: false,
      },
      forcedFutureStretchIntentActive: false,
      wave11MemoryConfirmationPending: false,
      accountabilityProofHint: null,
      rejectedTimeCandidates: [],
      unavailableWindows: [],
      routePurpose: "normal_inbound_reply",
      relationshipMemoryPacket: slimPacket,
    });

    expect(facts.thread.memory_packet?.recent_exact_thread_text).toContain("Sunday School");
    expect(facts.thread.memory_packet?.last_5_coach_questions).toContain("What story will you dictate today?");
    expect(facts.thread.most_recent_substantive_prior_user_message).toContain("Sunday School");
    expect(facts.thread.latest_open_question).toMatch(/dictate today/i);
  });

  it("daily thread memory uses packet open question instead of null", () => {
    const thread = buildDailyThreadMemoryFromPacket({
      packet: rbPacket,
    });

    expect(thread.latest_open_question).toMatch(/dictate today/i);
    expect(thread.latest_answer_after_open_question).toContain("Sunday School");
    expect(thread.recent_exact_thread_text).toContain("Coach:");
    expect(thread.memory_priority_rules?.length).toBeGreaterThan(0);
  });
});
