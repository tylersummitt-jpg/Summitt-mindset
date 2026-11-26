import { readFileSync } from "node:fs";
import path from "node:path";
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


describe("retired weekly generation does not call the model or persist a draft", () => {
  it("returns weekly_delivery_retired before an interpreter, writer, or draft write", async () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/tyler-text-overview-weekly-generate.ts"),
      "utf8"
    );
    const fn = src.slice(src.indexOf("export async function generateTylerTextOverviewWeeklyDraftForUser"));
    expect(fn).toContain("weekly_delivery_retired");
    expect(fn).not.toContain("loadWeeklyRelationshipPacket");
    expect(fn).not.toContain("runWeeklyBriefInterpreterV1");
    expect(fn).not.toContain("writeWeeklyTtoBody");
    expect(fn).not.toContain("persistMorningTtoGeneration");
    expect(fn).not.toContain("sendSMS");

    const result = await generateTylerTextOverviewWeeklyDraftForUser({
      clerkUserId: "user_1",
      now: new Date("2026-07-10T20:00:00.000Z"),
    });
    expect(result).toEqual({
      ok: false,
      reason: "weekly_delivery_retired",
      error: "weekly_delivery_retired",
    });
    expect(loadWeeklyRelationshipPacket).not.toHaveBeenCalled();
    expect(runWeeklyBriefInterpreterV1).not.toHaveBeenCalled();
    expect(writeWeeklyTtoBody).not.toHaveBeenCalled();
    expect(persistMorningTtoGeneration).not.toHaveBeenCalled();
  });

  it("classification of an existing draft does not generate", () => {
    expect(
      classifyWeeklyGenerateAllMember({
        draft: {
          clerk_user_id: "u",
          status: "current",
          current_generation_id: "g",
          edited_by_tyler: true,
          current_body_source: "tyler_edit",
          current_body_to_send: "Kept",
        },
        machineDraftBody: "ignored",
      })
    ).toBe("protected_complete");
  });
});
