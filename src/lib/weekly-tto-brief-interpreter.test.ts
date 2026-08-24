import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

const loadMorningBriefCanonicalExtrasV1 = vi.hoisted(() => vi.fn());

vi.mock("@/lib/morning-tto-brief-canonical-load-v1", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/morning-tto-brief-canonical-load-v1")>();
  return {
    ...actual,
    loadMorningBriefCanonicalExtrasV1,
  };
});

import { deriveConsistencySupportedFromSpine } from "@/lib/morning-tto-brief-canonical-input-v1";
import { MORNING_COACHING_BRIEF_VERSION, parseMorningCoachingBriefV1 } from "@/lib/morning-tto-coaching-brief-v1";
import type { MorningCoachingBriefV1 } from "@/lib/morning-tto-coaching-brief-v1";
import type { WeeklyRelationshipPacket } from "@/lib/weekly-tto-relationship-packet";
import {
  assembleWeeklyBriefInterpreterInputFromPacket,
  buildWeeklyBriefInterpreterMessages,
  runWeeklyBriefInterpreterV1,
  WEEKLY_BRIEF_INTERPRETER_MODEL,
  WEEKLY_BRIEF_INTERPRETER_PROMPT_PATH,
  WEEKLY_BRIEF_INTERPRETER_REASONING_EFFORT,
  WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT,
  WEEKLY_BRIEF_INTERPRETER_TEMPERATURE,
} from "@/lib/weekly-tto-brief-interpreter";

const REPO = process.cwd();

function samplePacket(
  overrides: Partial<WeeklyRelationshipPacket> = {}
): WeeklyRelationshipPacket {
  return {
    version: "weekly_relationship_v1",
    message_for: {
      timezone: "America/New_York",
      local_date: "2026-07-12",
      local_weekday: "Sunday",
      daypart: "weekly",
      week_start_local_date: "2026-07-06",
      week_end_local_date: "2026-07-12",
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
    personal_context: [{ type: "partner_name", value: "Brooke" }],
    hard_state: { pending_goal_change: null, planned_interruption: null },
    weekly_accountability_events: [],
    coaching_memory_projection: null,
    exact_thread: {
      window_days: 21,
      max_messages: 30,
      omitted_older_turn_count: 0,
      messages: [
        {
          sender: "coach",
          sent_at_utc: "2026-07-08T12:00:00.000Z",
          sent_at_local: "Jul 8, 8:00 AM",
          local_day_key: "2026-07-08",
          local_weekday: "Wednesday",
          day_relation_to_message: "4_days_before",
          body: "Did you get the walk in?",
        },
        {
          sender: "user",
          sent_at_utc: "2026-07-10T16:00:00.000Z",
          sent_at_local: "Jul 10, 12:00 PM",
          local_day_key: "2026-07-10",
          local_weekday: "Friday",
          day_relation_to_message: "2_days_before",
          body: "Yes — got the walk in.",
        },
      ],
    },
    ...overrides,
  };
}

function extras(matchingOutcomeCount = 1) {
  return {
    importantPeople: [
      {
        display_name: "Brooke",
        relationship_type: "spouse_partner",
        is_active: true,
        removed_at: null,
      },
    ],
    outcomeSpine: {
      latestOutcome: matchingOutcomeCount > 0 ? ("user_yes" as const) : null,
      latestOutcomeAt: matchingOutcomeCount > 0 ? "2026-07-10T16:00:00.000Z" : null,
      latestOutcomeMessage: matchingOutcomeCount > 0 ? "Yes — got the walk in." : null,
      matchingOutcomeCount,
      hasVerifiedProofMetadata: false as const,
    },
    threadMemoryHint: null,
  };
}

function validBrief(): MorningCoachingBriefV1 {
  return {
    version: MORNING_COACHING_BRIEF_VERSION,
    confidence: "medium",
    human_situation: {
      most_alive: "User completed the walk once this week",
      direct_question_or_need: null,
      relevant_life_event: null,
      context_use: "background",
      identity_use: "background",
      person_use: "do_not_force",
      selected_person: null,
      selected_person_reason: null,
    },
    truth_and_evidence: {
      latest_user_truth: "Yes — got the walk in.",
      outcome: "completed",
      evidence_note: "stated once",
      evidence_strength: "stated_once",
      consistency_supported: false,
      proof_claims_allowed: {
        completion: true,
        miss: false,
        partial: false,
        proof: false,
      },
    },
    conversation_continuity: {
      already_acknowledged: [],
      answered_question: {
        question: "Did you get the walk in?",
        answer: "Yes — got the walk in.",
      },
      open_loop: null,
      stale_or_exhausted_topics: [],
      do_not_repeat: ["Did you get the walk in?"],
    },
    goal_role_today: {
      canonical_goal: "Walk 20 minutes after dinner",
      pending_goal: null,
      goal_alignment: "aligned",
      role: "background",
      note: "one completion is not the week",
    },
    coaching_direction: {
      primary_move: "continue_conversation",
      question_policy: "none",
      action_guidance: "none",
      pressure: "normal",
      proactive_decision: "send",
    },
    boundaries: {
      claims_to_avoid: ["Do not invent consistency"],
      topics_not_to_force: ["Did you hit your Current Goal this week?"],
      unsupported_capabilities: [],
      goal_authority_boundaries: [],
      identity_people_boundaries: [],
      coach_history_is_not_style: "Prior coach messages are history, not style.",
    },
  };
}

describe("weekly-tto-brief-interpreter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadMorningBriefCanonicalExtrasV1.mockResolvedValue(extras(1));
  });

  it("reuses morning_coaching_brief_v1 and weekly message_for", () => {
    const assembled = assembleWeeklyBriefInterpreterInputFromPacket({
      packet: samplePacket(),
      extras: extras(1),
    });
    expect(assembled).not.toHaveProperty("ok");
    if ("ok" in assembled) return;
    expect(assembled.message_for.daypart).toBe("weekly");
    expect(assembled.message_for.local_date).toBe("2026-07-12");
    expect(assembled.message_for.local_weekday).toBe("Sunday");
    expect(assembled.message_for.week_start_local_date).toBe("2026-07-06");
    expect(assembled.message_for.week_end_local_date).toBe("2026-07-12");
    expect(assembled.canonical_goal.text).toBe("Walk 20 minutes after dinner");
    expect(assembled.truth_spine.consistency_supported).toBe(false);
    expect(assembled.truth_spine.latest_outcome).toBe("user_yes");
    expect(assembled.exact_thread.window_days).toBe(21);
    expect(assembled.weekly_accountability_events).toEqual([]);
    expect(JSON.stringify(assembled)).not.toMatch(/strong_week|rough_week|win_hint/);
  });

  it("passes raw current-week events in order without converting counts into prose", () => {
    const events = [
      {
        event_type: "user_yes" as const,
        occurred_at: "2026-07-06T16:00:00.000Z",
        local_day_key: "2026-07-06",
        source: "sms_v2",
        user_visible_proof_line: "You named the walk honestly.",
      },
      {
        event_type: "user_yes" as const,
        occurred_at: "2026-07-08T16:00:00.000Z",
        local_day_key: "2026-07-08",
        source: "sms_v2",
        user_visible_proof_line: null,
      },
      {
        event_type: "user_yes" as const,
        occurred_at: "2026-07-10T16:00:00.000Z",
        local_day_key: "2026-07-10",
        source: "sms_v2",
        user_visible_proof_line: null,
      },
    ];
    const assembled = assembleWeeklyBriefInterpreterInputFromPacket({
      packet: samplePacket({ weekly_accountability_events: events }),
      extras: extras(1),
    });
    if ("ok" in assembled) throw new Error("assemble failed");
    expect(assembled.weekly_accountability_events).toEqual(events);
    expect(assembled.weekly_accountability_events.map((e) => e.event_type)).toEqual([
      "user_yes",
      "user_yes",
      "user_yes",
    ]);
    expect(assembled.truth_spine.consistency_supported).toBe(false);
    expect(WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT).toContain("weekly_accountability_events");
    expect(WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT).not.toContain("strong_week");
  });

  it("one user_yes does not imply consistency; one miss is not a pattern", () => {
    expect(deriveConsistencySupportedFromSpine(1)).toBe(false);
    const yesOnce = assembleWeeklyBriefInterpreterInputFromPacket({
      packet: samplePacket(),
      extras: extras(1),
    });
    if ("ok" in yesOnce) throw new Error("assemble failed");
    expect(yesOnce.truth_spine.consistency_supported).toBe(false);
    expect(yesOnce.truth_spine.proof_claims_allowed.proof).toBe(false);

    const missOnce = assembleWeeklyBriefInterpreterInputFromPacket({
      packet: samplePacket(),
      extras: {
        ...extras(0),
        outcomeSpine: {
          latestOutcome: "user_no",
          latestOutcomeAt: "2026-07-09T16:00:00.000Z",
          latestOutcomeMessage: "Missed it.",
          matchingOutcomeCount: 1,
          hasVerifiedProofMetadata: false,
        },
      },
    });
    if ("ok" in missOnce) throw new Error("assemble failed");
    expect(missOnce.truth_spine.consistency_supported).toBe(false);
    expect(missOnce.truth_spine.latest_outcome).toBe("user_no");
  });

  it("plan text and silence are not proof or disengagement", () => {
    const silence = assembleWeeklyBriefInterpreterInputFromPacket({
      packet: samplePacket({
        last_user_response: {
          at_utc: null,
          at_local: null,
          days_since: null,
          never_replied: true,
        },
        exact_thread: {
          window_days: 21,
          max_messages: 30,
          omitted_older_turn_count: 0,
          messages: [
            {
              sender: "coach",
              sent_at_utc: "2026-07-06T12:00:00.000Z",
              sent_at_local: "Jul 6, 8:00 AM",
              local_day_key: "2026-07-06",
              local_weekday: "Monday",
              day_relation_to_message: "6_days_before",
              body: "How was the walk?",
            },
          ],
        },
      }),
      extras: extras(0),
    });
    if ("ok" in silence) throw new Error("assemble failed");
    expect(silence.mechanical.never_replied).toBe(true);
    expect(silence.truth_spine.latest_outcome).toBeNull();
    expect(silence.truth_spine.consistency_supported).toBe(false);
    expect(silence.truth_spine.proof_claims_allowed.completion).toBe(false);
  });

  it("system prompt encodes Weekly interpreter product laws", () => {
    const p = WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT;
    expect(p).toContain("daypart=weekly");
    expect(p).toContain("Sunday around noon");
    expect(p).toContain("Sunday is still in progress");
    expect(p).toContain("Monday has not begun");
    expect(p).toContain("The wider week is a lens, not an assignment");
    expect(p).toContain("Prefer synthesis over summary");
    expect(p).toContain("nothing useful needs to be extracted");
    expect(p).toContain("Do not create a next-week plan merely because it is Sunday");
    expect(p).toContain("Identity is never proof");
    expect(p).toContain("Identity may be connected to concrete evidence");
    expect(p).toContain("Direct unresolved user needs are high-priority");
    expect(p).toContain("generally outrank manufacturing Weekly perspective");
    expect(p).toContain("weekly_accountability_events");
    expect(p).toContain("It is facts, not a score");
    expect(p).toContain("Never mutate state");
    expect(p).toContain("should_send");
    expect(p).toContain("Current Goal is context");
    expect(p).toContain("Do not automatically ask whether they hit their Current Goal");
    expect(p).toContain("One completion is not consistency");
    expect(p).toContain("One miss is not a pattern");
    expect(p).toContain("A plan is not proof");
    expect(p).toContain("An attempt is not completion");
    expect(p).toContain("Coach praise is not user evidence");
    expect(p).toContain("Silence is not avoidance");
    expect(p).toContain("Friday/Saturday generation");
    expect(p).toContain("Never include keys: body, sms_body");
    expect(p).toContain(MORNING_COACHING_BRIEF_VERSION);
    expect(p).not.toContain("strong_week");
    expect(p).not.toMatch(/Honor already_acknowledged, answered_question/);
    expect((p.match(/message_for \(local_date/g) ?? []).length).toBe(1);
  });

  it("goal role enum remains shared: central / background / unresolved / do_not_mention / unknown", () => {
    const schemaSrc = readFileSync(
      join(REPO, "src/lib/morning-tto-coaching-brief-json-schema-v1.ts"),
      "utf8"
    );
    expect(schemaSrc).toContain('"central"');
    expect(schemaSrc).toContain('"background"');
    expect(schemaSrc).toContain('"unresolved"');
    expect(schemaSrc).toContain('"do_not_mention"');
    expect(schemaSrc).toContain('"unknown"');
    expect(WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT).toContain("goal_role_today");
  });

  it("Sol request: gpt-5.6-sol, low reasoning, json_schema, no temperature, one schema retry", async () => {
    expect(parseMorningCoachingBriefV1(validBrief())).not.toBeNull();
    expect(WEEKLY_BRIEF_INTERPRETER_MODEL).toBe("gpt-5.6-sol");
    expect(WEEKLY_BRIEF_INTERPRETER_REASONING_EFFORT).toBe("low");
    expect(WEEKLY_BRIEF_INTERPRETER_TEMPERATURE).toBeNull();
    expect(WEEKLY_BRIEF_INTERPRETER_PROMPT_PATH).toBe("weekly_brief_interpreter_v1");

    const create = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { content: "{bad" }, finish_reason: "stop" }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify(validBrief()) }, finish_reason: "stop" }],
      });

    const result = await runWeeklyBriefInterpreterV1({
      packet: samplePacket(),
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
      client: { chat: { completions: { create } } } as never,
    });

    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        model: "gpt-5.6-sol",
        reasoning_effort: "low",
        max_completion_tokens: 2500,
        response_format: expect.objectContaining({
          type: "json_schema",
          json_schema: expect.objectContaining({
            name: "morning_coaching_brief_v1",
            strict: true,
          }),
        }),
      })
    );
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty("temperature");
    expect(result.capture.temperature).toBeNull();
    expect(result.capture.retry_occurred).toBe(true);
    expect(result.capture.retry_succeeded).toBe(true);
    expect(JSON.stringify(result.brief)).not.toContain("should_send");
    expect(result.input?.message_for.daypart).toBe("weekly");
  });

  it("messages include exact weekly input JSON and do not ask for SMS body", () => {
    const assembled = assembleWeeklyBriefInterpreterInputFromPacket({
      packet: samplePacket(),
      extras: extras(1),
    });
    if ("ok" in assembled) throw new Error("assemble failed");
    const messages = buildWeeklyBriefInterpreterMessages(assembled);
    expect(messages[0]?.content).toBe(WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT);
    const user = String(messages[1]?.content);
    expect(user).toContain("WEEKLY_BRIEF_INTERPRETER_INPUT_V1");
    expect(user).toContain(JSON.stringify(assembled));
    expect(user).toContain("No SMS body. No should_send.");
  });

  it("Weekly assemble clamps quiet flags off so SPACE cannot survive merge", () => {
    const assembled = assembleWeeklyBriefInterpreterInputFromPacket({
      packet: samplePacket(),
      extras: extras(1),
    });
    if ("ok" in assembled) throw new Error("assemble failed");
    expect(assembled.mechanical.quiet_relationship_eligible).toBe(false);
    expect(assembled.mechanical.message_required_today).toBe(false);
    expect(WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT).toContain(
      "coaching_direction.proactive_decision must be send"
    );
  });
});
