import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import { MORNING_COACHING_BRIEF_VERSION } from "@/lib/morning-tto-coaching-brief-v1";
import type { MorningCoachingBriefV1 } from "@/lib/morning-tto-coaching-brief-v1";
import { SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT } from "@/lib/tyler-text-overview-types";
import { TYLER_TEXT_OVERVIEW_ENABLED_ENV } from "@/lib/tyler-text-overview-types";
import type { WeeklyRelationshipPacket } from "@/lib/weekly-tto-relationship-packet";

const loadTylerTextOverviewAudienceRow = vi.hoisted(() => vi.fn());
const persistMorningTtoGeneration = vi.hoisted(() => vi.fn());
const formatSendPrefSnapshot = vi.hoisted(() => vi.fn(() => "clerk:morning"));
const getClerkUser = vi.hoisted(() => vi.fn());
const getActiveCommitment = vi.hoisted(() => vi.fn());
const resolveUserFullyOnV2ForCutoverMessaging = vi.hoisted(() => vi.fn());
const fetchV2UserSmsCommsPreferences = vi.hoisted(() => vi.fn());
const shouldSkipWeeklyForCommsPrefs = vi.hoisted(() => vi.fn(() => false));
const loadWeeklyRelationshipPacket = vi.hoisted(() => vi.fn());
const runWeeklyBriefInterpreterV1 = vi.hoisted(() => vi.fn());
const buildWeeklyBriefInterpreterMetadataV1 = vi.hoisted(() =>
  vi.fn(() => ({
    model: "gpt-5.6-sol",
    reasoning_effort: "low",
    prompt_path: "weekly_brief_interpreter_v1",
  }))
);
const writeWeeklyTtoBody = vi.hoisted(() => vi.fn());
const resolveQuietRelationshipMechanicalFacts = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tyler-text-overview-generate", () => ({
  loadTylerTextOverviewAudienceRow,
  persistMorningTtoGeneration,
  formatSendPrefSnapshot,
}));

vi.mock("@/lib/clerk-rest", () => ({
  getClerkUser,
}));

vi.mock("@/lib/v2-commitment", () => ({
  getActiveCommitment,
}));

vi.mock("@/lib/v2-cutover-gates", () => ({
  resolveUserFullyOnV2ForCutoverMessaging,
}));

vi.mock("@/lib/v2-sms-comms-preferences", () => ({
  fetchV2UserSmsCommsPreferences,
  shouldSkipWeeklyForCommsPrefs,
}));

vi.mock("@/lib/weekly-tto-relationship-packet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/weekly-tto-relationship-packet")>();
  return {
    ...actual,
    loadWeeklyRelationshipPacket,
  };
});

vi.mock("@/lib/weekly-tto-brief-interpreter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/weekly-tto-brief-interpreter")>();
  return {
    ...actual,
    runWeeklyBriefInterpreterV1,
    buildWeeklyBriefInterpreterMetadataV1,
  };
});

vi.mock("@/lib/sms-proactive-relationship-touch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sms-proactive-relationship-touch")>();
  return {
    ...actual,
    resolveQuietRelationshipMechanicalFacts,
  };
});

vi.mock("@/lib/weekly-tto-writer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/weekly-tto-writer")>();
  return {
    ...actual,
    writeWeeklyTtoBody,
  };
});

import { generateTylerTextOverviewWeeklyDraftForUser } from "@/lib/tyler-text-overview-weekly-generate";
import { classifyWeeklyGenerateAllMember } from "@/lib/tyler-text-overview-weekly-generate-all";
import { buildWeeklyWriterMessages } from "@/lib/weekly-tto-writer";

function packet(): WeeklyRelationshipPacket {
  return {
    version: "weekly_relationship_v1",
    message_for: {
      timezone: "America/New_York",
      local_date: "2026-07-12",
      local_weekday: "Sunday",
      daypart: "weekly",
      week_start_local_date: "2026-07-06",
      week_end_local_date: "2026-07-12",
      intended_receive_time_local: "12:00",
    },
    last_user_response: {
      at_utc: "2026-07-10T16:00:00.000Z",
      at_local: "Jul 10, 12:00 PM",
      days_since: 2,
      never_replied: false,
    },
    preferred_name: "Sam",
    current_goal: { text: "Walk 20 minutes after dinner" },
    current_identity: { text: "I am a father who keeps his word" },
    personal_context: [],
    hard_state: { pending_goal_change: null, planned_interruption: null },
    weekly_accountability_events: [],
    coaching_memory_projection: null,
    historical_evidence: [],
    coach_relationship_memory: null,
    exact_thread: {
      window_days: 21,
      max_messages: 30,
      omitted_older_turn_count: 0,
      messages: [
        {
          sender: "user",
          sent_at_utc: "2026-07-10T16:00:00.000Z",
          sent_at_local: "Jul 10, 12:00 PM",
          local_day_key: "2026-07-10",
          local_weekday: "Friday",
          day_relation_to_message: "2_days_before",
          body: "Broke my ankle. Coaching has started to feel like another source of messages.",
        },
      ],
    },
    answered_user_message_links: [],
  };
}

function brief(): MorningCoachingBriefV1 {
  return {
    version: MORNING_COACHING_BRIEF_VERSION,
    confidence: "high",
    human_situation: {
      most_alive: "Broken ankle plus coaching-as-noise feedback",
      direct_question_or_need: "coaching feels like another source of messages",
      relevant_life_event: "injury",
      context_use: "relevant",
      identity_use: "background",
      person_use: "do_not_use",
      selected_person: null,
      selected_person_reason: null,
    },
    truth_and_evidence: {
      latest_user_truth: "Broke my ankle.",
      outcome: "no_recent_evidence",
      evidence_note: "human update",
      evidence_strength: "stated_once",
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
      open_loop: "coaching usefulness",
      stale_or_exhausted_topics: ["Did you hit your Current Goal this week?"],
      do_not_repeat: ["I'm in your corner", "How was your week?"],
    },
    goal_role_today: {
      canonical_goal: "Walk 20 minutes after dinner",
      pending_goal: null,
      goal_alignment: "unknown",
      role: "do_not_mention",
      note: "injury and coaching-feedback outrank goal",
    },
    coaching_direction: {
      primary_move: "acknowledge_truth",
      question_policy: "none",
      action_guidance: "none",
      pressure: "low",
      proactive_decision: "send",
    },
    boundaries: {
      claims_to_avoid: ["Do not invent a strong week"],
      topics_not_to_force: ["Current Goal recap"],
      unsupported_capabilities: [],
      goal_authority_boundaries: [],
      identity_people_boundaries: [],
      coach_history_is_not_style: "Prior coach messages are history, not style.",
    },
  };
}

function writerMessages(p: WeeklyRelationshipPacket, b: MorningCoachingBriefV1) {
  return buildWeeklyWriterMessages(p, b);
}

describe("generateTylerTextOverviewWeeklyDraftForUser Sol orchestration", () => {
  const fridayNow = new Date("2026-07-10T20:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    process.env[TYLER_TEXT_OVERVIEW_ENABLED_ENV] = "true";
    loadTylerTextOverviewAudienceRow.mockResolvedValue({
      clerk_user_id: "user_1",
      timezone: "America/New_York",
    });
    getClerkUser.mockResolvedValue({
      public_metadata: { timezone: "America/New_York" },
    });
    fetchV2UserSmsCommsPreferences.mockResolvedValue(null);
    shouldSkipWeeklyForCommsPrefs.mockReturnValue(false);
    resolveUserFullyOnV2ForCutoverMessaging.mockResolvedValue({ fullyOnV2: true });
    getActiveCommitment.mockResolvedValue({ id: "cmt_1" });
    loadWeeklyRelationshipPacket.mockResolvedValue({
      ok: true,
      packet: packet(),
      commitmentId: "cmt_1",
    });
    const b = brief();
    runWeeklyBriefInterpreterV1.mockResolvedValue({
      ok: true,
      brief: b,
      input: { message_for: packet().message_for },
      capture: {
        capture_version: "weekly_brief_interpreter_capture_v1",
        model: "gpt-5.6-sol",
        temperature: null,
        reasoning_effort: "low",
        prompt_path: "weekly_brief_interpreter_v1",
      },
    });
    const msgs = writerMessages(packet(), b);
    writeWeeklyTtoBody.mockResolvedValue({
      ok: true,
      body: "The ankle comes first. I'm here, not another inbox.",
      messages: msgs,
      primaryMessages: msgs,
      retryMessages: [],
      retryOccurred: false,
      writer_prompt_path: "weekly_brief_writer_v1",
      model: "gpt-5.6-sol",
      capture: {
        capture_version: "weekly_writer_capture_v1",
        model: "gpt-5.6-sol",
        temperature: null,
        reasoning_effort: "low",
        max_completion_tokens: 1200,
        prompt_path: "weekly_brief_writer_v1",
        raw_response: '{"body":"The ankle comes first. I\'m here, not another inbox."}',
        raw_retry_response: null,
        error: null,
        openai_error: null,
        retry_occurred: false,
        retry_succeeded: null,
      },
    });
    persistMorningTtoGeneration.mockResolvedValue({ ok: true, generationId: "gen-w1" });
    resolveQuietRelationshipMechanicalFacts.mockResolvedValue({
      quiet_relationship_eligible: false,
      message_required_today: false,
      clock_lookup_failed: false,
      clock_lookup_error: null,
      days_since_last_successful_proactive_send: 2,
      days_since_first_successful_proactive_send: 40,
    });
  });

  it("generated Friday still uses Sunday message_for and two Sol calls only", async () => {
    const result = await generateTylerTextOverviewWeeklyDraftForUser({
      clerkUserId: "user_1",
      now: fridayNow,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.weekEnd).toBe("2026-07-12");
    expect(result.weekStart).toBe("2026-07-06");
    expect(result.draftForDayKey).toBe("2026-07-12");
    expect(result.machineShouldSend).toBe(true);
    expect(result.machineDraftBody).toBe("The ankle comes first. I'm here, not another inbox.");
    expect(result.sendSlot).toBe(SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT);

    expect(loadWeeklyRelationshipPacket).toHaveBeenCalledTimes(1);
    expect(loadWeeklyRelationshipPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        weekStartLocalDate: "2026-07-06",
        weekEndLocalDate: "2026-07-12",
        now: fridayNow,
      })
    );
    expect(runWeeklyBriefInterpreterV1).toHaveBeenCalledTimes(1);
    expect(writeWeeklyTtoBody).toHaveBeenCalledTimes(1);
    expect(writeWeeklyTtoBody.mock.calls[0]?.[0].weeklyCoachingBrief.goal_role_today.role).toBe(
      "do_not_mention"
    );
    expect(writeWeeklyTtoBody.mock.calls[0]?.[0].weeklyCoachingBrief.human_situation.most_alive).toMatch(
      /ankle/i
    );
    expect(persistMorningTtoGeneration).toHaveBeenCalledTimes(1);
    const persistArgs = persistMorningTtoGeneration.mock.calls[0]?.[0];
    expect(persistArgs.sendSlot).toBe("weekly_review");
    expect(persistArgs.respectProtectedMorningDraft).toBe(true);
    expect(persistArgs.protectTylerProvenanceOnly).toBe(true);
    expect(persistArgs.routeKind).toBe("weekly_relationship");
    expect(persistArgs.notebookVerdictReason).toBe("weekly_brief_writer_ran");
    expect(persistArgs.success.body).toBe("The ankle comes first. I'm here, not another inbox.");
    expect(persistArgs.generationEffectiveAsk).toBe("Walk 20 minutes after dinner");
    expect(persistArgs.success.writerPromptPath).toBe("weekly_brief_writer_v1");
    expect(persistArgs.generationMetadataExtra.message_for.local_date).toBe("2026-07-12");
    expect(persistArgs.generationMetadataExtra.message_for.daypart).toBe("weekly");
    expect(persistArgs.generationMetadataExtra.weekly_relationship_packet_v1).toEqual(packet());
    expect(persistArgs.generationMetadataExtra.morning_coaching_brief_v1).toEqual(brief());
    expect(persistArgs.generationMetadataExtra.weekly_v3_lane_used).toBe(false);
    expect(persistArgs.success.messages).toEqual(writerMessages(packet(), brief()));
  });

  it("blocked writer body persists no-send without rewriting", async () => {
    writeWeeklyTtoBody.mockResolvedValue({
      ok: true,
      body: "Nice week. Reply STOP to opt out. Reply HELP for help.",
      messages: writerMessages(packet(), brief()),
      primaryMessages: writerMessages(packet(), brief()),
      retryMessages: [],
      retryOccurred: false,
      writer_prompt_path: "weekly_brief_writer_v1",
      model: "gpt-5.6-sol",
      capture: { model: "gpt-5.6-sol", temperature: null, reasoning_effort: "low" },
    });

    const result = await generateTylerTextOverviewWeeklyDraftForUser({
      clerkUserId: "user_1",
      now: fridayNow,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.machineShouldSend).toBe(false);
    expect(result.machineDraftBody).toBeNull();
    expect(result.machineNoSendReason).toBe("compliance_footer_in_body");
    expect(persistMorningTtoGeneration.mock.calls[0]?.[0].failure.error).toBe(
      "compliance_footer_in_body"
    );
    expect(persistMorningTtoGeneration.mock.calls[0]?.[0].success).toBeUndefined();
  });

  it("does not write proof, wins, season, goal, or identity tables", async () => {
    await generateTylerTextOverviewWeeklyDraftForUser({
      clerkUserId: "user_1",
      now: fridayNow,
    });
    expect(persistMorningTtoGeneration).toHaveBeenCalledTimes(1);
    expect(getActiveCommitment).toHaveBeenCalledTimes(1);
    const persistSrc = JSON.stringify(persistMorningTtoGeneration.mock.calls);
    expect(persistSrc).not.toContain("v2_commitment_event");
    expect(persistSrc).not.toContain("v2_win");
  });

  it("protected Tyler draft does not advertise discarded machine body as current", async () => {
    persistMorningTtoGeneration.mockResolvedValue({
      ok: true,
      generationId: "gen-orphan",
      currentDraftProtected: true,
    });
    const result = await generateTylerTextOverviewWeeklyDraftForUser({
      clerkUserId: "user_1",
      now: fridayNow,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.currentDraftProtected).toBe(true);
    expect(result.machineDraftBody).toBeNull();
    expect(result.machineNoSendReason).toBe("current_draft_protected");
    expect(result.machineShouldSend).toBe(false);
  });

  it("uses the real quiet resolver and still calls the writer for an active user", async () => {
    await generateTylerTextOverviewWeeklyDraftForUser({
      clerkUserId: "user_1",
      now: fridayNow,
    });
    expect(resolveQuietRelationshipMechanicalFacts).toHaveBeenCalledWith({
      clerkUserId: "user_1",
      timezone: "America/New_York",
      localDate: "2026-07-12",
      daysSinceLastUserResponse: 2,
      neverReplied: false,
      recentUnansweredOutboundCount: 0,
    });
    expect(runWeeklyBriefInterpreterV1).toHaveBeenCalledWith(
      expect.objectContaining({
        quietFacts: expect.objectContaining({
          quiet_relationship_eligible: false,
          message_required_today: false,
        }),
      })
    );
    expect(writeWeeklyTtoBody).toHaveBeenCalledTimes(1);
  });

  it("skips the writer and persists intentional_space when the shared clamp allows it", async () => {
    resolveQuietRelationshipMechanicalFacts.mockResolvedValue({
      quiet_relationship_eligible: true,
      message_required_today: false,
      clock_lookup_failed: false,
      clock_lookup_error: null,
      days_since_last_successful_proactive_send: 3,
      days_since_first_successful_proactive_send: 40,
    });
    const spaceBrief = brief();
    spaceBrief.coaching_direction.proactive_decision = "intentional_space";
    runWeeklyBriefInterpreterV1.mockResolvedValue({
      ok: true,
      brief: spaceBrief,
      input: { message_for: packet().message_for },
      capture: { model: "gpt-5.6-sol", prompt_path: "weekly_brief_interpreter_v1" },
    });

    const result = await generateTylerTextOverviewWeeklyDraftForUser({
      clerkUserId: "user_1",
      now: fridayNow,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(writeWeeklyTtoBody).not.toHaveBeenCalled();
    expect(result.machineShouldSend).toBe(false);
    expect(result.machineDraftBody).toBeNull();
    expect(result.machineNoSendReason).toBe("intentional_space");
    const persistArgs = persistMorningTtoGeneration.mock.calls[0]?.[0];
    expect(persistArgs.failure.error).toBe("intentional_space");
    expect(persistArgs.failure.messages).toBeUndefined();
    expect(persistArgs.notebookVerdictReason).toBe("intentional_space");
    expect(persistArgs.generationMetadataExtra.intentional_space).toBe(true);
    expect(persistArgs.generationMetadataExtra.error).toBeNull();
    expect(persistArgs.generationMetadataExtra.proactive_decision).toBe("intentional_space");
    expect(
      classifyWeeklyGenerateAllMember({
        draft: {
          clerk_user_id: "user_1",
          status: "current",
          current_generation_id: "gen-w1",
          edited_by_tyler: false,
          current_body_source: "machine",
          current_body_to_send: null,
        },
        machineDraftBody: null,
        machineNoSendReason: persistArgs.failure.error,
      })
    ).toBe("generated_complete");
  });

  it("clamps model space back to send when a required touch is due or the user is active", async () => {
    resolveQuietRelationshipMechanicalFacts.mockResolvedValue({
      quiet_relationship_eligible: true,
      message_required_today: true,
      clock_lookup_failed: false,
      clock_lookup_error: null,
      days_since_last_successful_proactive_send: 8,
      days_since_first_successful_proactive_send: 40,
    });
    const spaceBrief = brief();
    spaceBrief.coaching_direction.proactive_decision = "intentional_space";
    runWeeklyBriefInterpreterV1.mockResolvedValue({
      ok: true,
      brief: spaceBrief,
      input: null,
      capture: { model: "gpt-5.6-sol" },
    });
    await generateTylerTextOverviewWeeklyDraftForUser({
      clerkUserId: "user_1",
      now: fridayNow,
    });
    expect(writeWeeklyTtoBody).toHaveBeenCalledTimes(1);
    expect(writeWeeklyTtoBody.mock.calls[0]?.[0].weeklyCoachingBrief.coaching_direction.proactive_decision).toBe(
      "send"
    );
    expect(persistMorningTtoGeneration.mock.calls[0]?.[0].failure?.error).not.toBe(
      "intentional_space"
    );
  });

  it("clamps model space back to send when the proactive clock lookup failed", async () => {
    resolveQuietRelationshipMechanicalFacts.mockResolvedValue({
      quiet_relationship_eligible: true,
      message_required_today: false,
      clock_lookup_failed: true,
      clock_lookup_error: "sms_send_events:db down",
      days_since_last_successful_proactive_send: null,
      days_since_first_successful_proactive_send: null,
    });
    const spaceBrief = brief();
    spaceBrief.coaching_direction.proactive_decision = "intentional_space";
    runWeeklyBriefInterpreterV1.mockResolvedValue({
      ok: true,
      brief: spaceBrief,
      input: null,
      capture: { model: "gpt-5.6-sol" },
    });
    await generateTylerTextOverviewWeeklyDraftForUser({
      clerkUserId: "user_1",
      now: fridayNow,
    });
    expect(writeWeeklyTtoBody).toHaveBeenCalledTimes(1);
    expect(
      writeWeeklyTtoBody.mock.calls[0]?.[0].weeklyCoachingBrief.coaching_direction.proactive_decision
    ).toBe("send");
  });

  it("does not persist interpreter or writer failure as intentional_space", async () => {
    resolveQuietRelationshipMechanicalFacts.mockResolvedValue({
      quiet_relationship_eligible: true,
      message_required_today: false,
      clock_lookup_failed: false,
      clock_lookup_error: null,
      days_since_last_successful_proactive_send: 3,
      days_since_first_successful_proactive_send: 40,
    });
    const failedBrief = brief();
    runWeeklyBriefInterpreterV1.mockResolvedValue({
      ok: false,
      error: "openai_request_failed",
      brief: failedBrief,
      input: null,
      capture: { model: "gpt-5.6-sol", error: "openai_request_failed" },
    });
    writeWeeklyTtoBody.mockResolvedValue({
      ok: false,
      error: "openai_429",
      messages: undefined,
    });
    const result = await generateTylerTextOverviewWeeklyDraftForUser({
      clerkUserId: "user_1",
      now: fridayNow,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(writeWeeklyTtoBody).toHaveBeenCalledTimes(1);
    expect(result.machineNoSendReason).toBe("openai_429");
    expect(persistMorningTtoGeneration.mock.calls[0]?.[0].failure.error).toBe("openai_429");
  });
});
