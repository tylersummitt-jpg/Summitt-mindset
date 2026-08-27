/**
 * Preserve Brief uncertainty in writer copy — prompt contract + writer-input fixtures.
 *
 * Writer-only. Tests do not run live Sol. A passing prompt contract does not
 * mathematically guarantee the model will never collapse uncertainty.
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import type { MorningCoachingBriefV1 } from "@/lib/morning-tto-coaching-brief-v1";
import { MORNING_COACHING_BRIEF_VERSION } from "@/lib/morning-tto-coaching-brief-v1";
import type { MorningRelationshipPacket } from "@/lib/morning-tto-relationship-packet";
import {
  MORNING_TTO_SYSTEM_PROMPT,
  buildMorningWriterMessages,
} from "@/lib/morning-tto-writer";
import type { WeeklyRelationshipPacket } from "@/lib/weekly-tto-relationship-packet";
import {
  WEEKLY_TTO_SYSTEM_PROMPT,
  buildWeeklyWriterMessages,
} from "@/lib/weekly-tto-writer";

const GREG_OPEN_LOOP =
  "It is unclear whether Greg is still on vacation, transitioning back, or has resumed work; there is also no reported outcome for the current before-noon business task.";
const GREG_CLAIM_TO_AVOID = "That the vacation is definitely over";
const GREG_VACATION_LINE = "Getting to relax. On vacation this week";
const GREG_NICE_LINE = "Yes! It has been nice";

function threadTurn(
  sender: "coach" | "user",
  body: string,
  day: string,
  local: string,
  rel: string,
  weekday: string
): MorningRelationshipPacket["exact_thread"]["messages"][number] {
  return {
    sender,
    sent_at_utc: `${day}T12:00:00.000Z`,
    sent_at_local: local,
    local_day_key: day,
    local_weekday: weekday,
    day_relation_to_message: rel,
    body,
  };
}

function baseBrief(overrides: Partial<MorningCoachingBriefV1> = {}): MorningCoachingBriefV1 {
  return {
    version: MORNING_COACHING_BRIEF_VERSION,
    confidence: "medium",
    human_situation: {
      most_alive: "User update",
      direct_question_or_need: null,
      relevant_life_event: null,
      context_use: "background",
      identity_use: "background",
      person_use: "do_not_force",
      selected_person: null,
      selected_person_reason: null,
    },
    truth_and_evidence: {
      latest_user_truth: "stated once",
      outcome: "no_recent_evidence",
      evidence_note: "thread",
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
      open_loop: null,
      stale_or_exhausted_topics: [],
      do_not_repeat: [],
    },
    goal_role_today: {
      canonical_goal: "I will finish one business task I have been avoiding before noon today.",
      pending_goal: null,
      goal_alignment: "unknown",
      role: "background",
      note: "ok",
    },
    coaching_direction: {
      primary_move: "reconnect",
      question_policy: "one_useful_question",
      action_guidance: "none",
      pressure: "normal",
      proactive_decision: "send",
    },
    boundaries: {
      claims_to_avoid: [],
      topics_not_to_force: [],
      unsupported_capabilities: [],
      goal_authority_boundaries: [],
      identity_people_boundaries: [],
      coach_history_is_not_style: "Prior coach messages are history, not style.",
    },
    ...overrides,
  };
}

function morningPacket(
  overrides: Partial<MorningRelationshipPacket> = {}
): MorningRelationshipPacket {
  return {
    version: "morning_relationship_v1",
    message_for: {
      timezone: "America/New_York",
      local_date: "2026-08-25",
      local_weekday: "Tuesday",
      daypart: "evening",
    },
    last_user_response: {
      at_utc: "2026-08-22T23:01:00.000Z",
      at_local: "Aug 22, 7:01 PM",
      days_since: 3,
      never_replied: false,
    },
    preferred_name: "Greg",
    current_goal: {
      text: "I will finish one business task I have been avoiding before noon today.",
    },
    current_identity: { text: null },
    personal_context: [],
    hard_state: { pending_goal_change: null },
    historical_evidence: [],
    exact_thread: {
      window_days: 21,
      max_messages: 30,
      omitted_older_turn_count: 0,
      messages: [],
    },
    ...overrides,
  };
}

function weeklyPacket(
  overrides: Partial<WeeklyRelationshipPacket> = {}
): WeeklyRelationshipPacket {
  return {
    version: "weekly_relationship_v1",
    message_for: {
      timezone: "America/New_York",
      local_date: "2026-08-23",
      local_weekday: "Sunday",
      daypart: "weekly",
      week_start_local_date: "2026-08-17",
      week_end_local_date: "2026-08-23",
    },
    last_user_response: {
      at_utc: "2026-08-20T16:00:00.000Z",
      at_local: "Aug 20, 12:00 PM",
      days_since: 3,
      never_replied: false,
    },
    preferred_name: "Greg",
    current_goal: {
      text: "I will finish one business task I have been avoiding before noon today.",
    },
    current_identity: { text: null },
    personal_context: [],
    hard_state: { pending_goal_change: null, planned_interruption: null },
    weekly_accountability_events: [],
    coaching_memory_projection: null,
    historical_evidence: [],
    exact_thread: {
      window_days: 21,
      max_messages: 30,
      omitted_older_turn_count: 0,
      messages: [],
    },
    ...overrides,
  };
}

function writerUserContent(
  packet: MorningRelationshipPacket,
  brief: MorningCoachingBriefV1
): string {
  const messages = buildMorningWriterMessages(packet, brief);
  expect(messages[0]?.content).toBe(MORNING_TTO_SYSTEM_PROMPT);
  return messages[1]?.content as string;
}

function expectUncertaintyLaw(prompt: string) {
  expect(prompt).toMatch(/Preserve uncertainty from the Brief/i);
  expect(prompt).toMatch(/do not collapse one possibility into an asserted premise/i);
  expect(prompt).toMatch(/unclear, unknown, or one of multiple plausible states/i);
  expect(prompt).toMatch(/omit the uncertain premise/i);
  expect(prompt).toMatch(/uncertainty remains open/i);
  expect(prompt).toMatch(/conversation_continuity\.open_loop/);
  expect(prompt).toMatch(/boundaries\.claims_to_avoid/);
  expect(prompt).toMatch(/actual wording, not merely in topic selection/i);
  expect(prompt).toMatch(/plans into completed events/i);
  expect(prompt).toMatch(/possibilities into facts/i);
  expect(prompt).toMatch(/unknown current circumstances into asserted current circumstances/i);
  expect(prompt).toMatch(/does not ban natural inference/i);
  expect(prompt).toMatch(/Brief and packet clearly support the current state/i);
  expect(prompt).toMatch(/does not require "maybe"/i);
  expect(prompt).toMatch(/hedging every text/i);
  expect(prompt).toMatch(/either\/or questions/i);
  expect(prompt).toMatch(/clarification questions/i);
  expect(prompt).toMatch(/does not weaken challenge or accountability/i);
  expect(prompt).toMatch(/Asking about the outcome of a planned action remains legal/i);
}

describe("brief uncertainty writer contract", () => {
  it("Morning/Evening writer prompt contains the uncertainty-preservation law", () => {
    expectUncertaintyLaw(MORNING_TTO_SYSTEM_PROMPT);
    expect(MORNING_TTO_SYSTEM_PROMPT).not.toMatch(/must hedge|always say maybe|force either\/or/i);
  });

  it("Weekly writer prompt contains the same uncertainty-preservation meaning", () => {
    expectUncertaintyLaw(WEEKLY_TTO_SYSTEM_PROMPT);
    expect(WEEKLY_TTO_SYSTEM_PROMPT).toMatch(
      /unclear whether an event occurred, do not recap that event as completed/i
    );
  });

  it("Greg-shaped Brief + packet are included exactly in Morning writer input", () => {
    const packet = morningPacket({
      historical_evidence: [],
      exact_thread: {
        window_days: 21,
        max_messages: 30,
        omitted_older_turn_count: 0,
        messages: [
          threadTurn(
            "coach",
            "what's been taking most of your attention lately?",
            "2026-08-21",
            "Aug 21, 7:01 AM",
            "4 days before",
            "Friday"
          ),
          threadTurn(
            "user",
            GREG_VACATION_LINE,
            "2026-08-21",
            "Aug 21, 7:06 AM",
            "4 days before",
            "Friday"
          ),
          threadTurn(
            "coach",
            "enjoy the rest of vacation",
            "2026-08-21",
            "Aug 21, 7:07 AM",
            "4 days before",
            "Friday"
          ),
          threadTurn(
            "coach",
            "unhurried Saturday evening",
            "2026-08-22",
            "Aug 22, 7:01 PM",
            "3 days before",
            "Saturday"
          ),
          threadTurn("user", GREG_NICE_LINE, "2026-08-22", "Aug 22, 7:01 PM", "3 days before", "Saturday"),
          threadTurn(
            "coach",
            "enjoy the rest of vacation",
            "2026-08-22",
            "Aug 22, 7:03 PM",
            "3 days before",
            "Saturday"
          ),
        ],
      },
    });
    const brief = baseBrief({
      human_situation: {
        most_alive:
          "Vacation rest is still the live thread, without assuming the vacation has ended",
        direct_question_or_need: null,
        relevant_life_event: "vacation",
        context_use: "relevant",
        identity_use: "background",
        person_use: "do_not_force",
        selected_person: null,
        selected_person_reason: null,
      },
      conversation_continuity: {
        already_acknowledged: ["vacation this week"],
        answered_question: null,
        open_loop: GREG_OPEN_LOOP,
        stale_or_exhausted_topics: [],
        do_not_repeat: [],
      },
      boundaries: {
        claims_to_avoid: [GREG_CLAIM_TO_AVOID],
        topics_not_to_force: [],
        unsupported_capabilities: [],
        goal_authority_boundaries: [],
        identity_people_boundaries: [],
        coach_history_is_not_style: "Prior coach messages are history, not style.",
      },
    });

    const user = writerUserContent(packet, brief);
    expect(user).toContain(JSON.stringify(brief));
    expect(user).toContain(JSON.stringify(packet));
    expect(user).toContain(GREG_OPEN_LOOP);
    expect(user).toContain(GREG_CLAIM_TO_AVOID);
    expect(user).toContain(GREG_VACATION_LINE);
    expect(user).toContain(GREG_NICE_LINE);
    expect(user).toContain('"local_weekday":"Tuesday"');
    expect(user).toContain('"daypart":"evening"');
    expect(user).toContain('"local_date":"2026-08-25"');
    expect(user).not.toMatch(/I'm home|I'm back|Vacation is over|I fly home|return date/i);

    const collapsedIllegal =
      "Greg, how’s the transition from vacation pace back toward your normal rhythm feeling?";
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/do not collapse one possibility into an asserted premise/i);
    expect(collapsedIllegal).toMatch(/transition from vacation/);
  });

  it("Weekly writer input keeps an unclear event as unclear, not a completed recap", () => {
    const packet = weeklyPacket({
      historical_evidence: [],
      exact_thread: {
        window_days: 21,
        max_messages: 30,
        omitted_older_turn_count: 0,
        messages: [
          threadTurn(
            "user",
            "Tryouts are sometime this week.",
            "2026-08-19",
            "Aug 19, 4:00 PM",
            "4 days before",
            "Wednesday"
          ),
        ],
      },
    });
    const brief = baseBrief({
      conversation_continuity: {
        already_acknowledged: [],
        answered_question: null,
        open_loop: "It is unclear whether tryouts happened this week.",
        stale_or_exhausted_topics: [],
        do_not_repeat: [],
      },
      boundaries: {
        claims_to_avoid: ["That tryouts definitely happened"],
        topics_not_to_force: [],
        unsupported_capabilities: [],
        goal_authority_boundaries: [],
        identity_people_boundaries: [],
        coach_history_is_not_style: "Prior coach messages are history, not style.",
      },
    });
    const messages = buildWeeklyWriterMessages(packet, brief);
    expect(messages[0]?.content).toBe(WEEKLY_TTO_SYSTEM_PROMPT);
    const user = messages[1]?.content as string;
    expect(user).toContain(JSON.stringify(brief));
    expect(user).toContain(JSON.stringify(packet));
    expect(user).toContain("It is unclear whether tryouts happened this week.");
    expect(user).toContain("That tryouts definitely happened");
    expect(user).toContain("Tryouts are sometime this week.");
  });

  it("A. known current vacation remains legal to reference as away", () => {
    const packet = morningPacket({
      preferred_name: "Kerry",
      historical_evidence: [],
      exact_thread: {
        window_days: 21,
        max_messages: 30,
        omitted_older_turn_count: 0,
        messages: [
          threadTurn(
            "user",
            "Still on the beach this week — back next Monday.",
            "2026-08-24",
            "Aug 24, 9:00 AM",
            "yesterday",
            "Monday"
          ),
        ],
      },
    });
    const brief = baseBrief({
      human_situation: {
        most_alive: "User is currently away on vacation",
        direct_question_or_need: null,
        relevant_life_event: "vacation in progress",
        context_use: "relevant",
        identity_use: "background",
        person_use: "do_not_force",
        selected_person: null,
        selected_person_reason: null,
      },
      conversation_continuity: {
        already_acknowledged: [],
        answered_question: null,
        open_loop: null,
        stale_or_exhausted_topics: [],
        do_not_repeat: [],
      },
      boundaries: {
        claims_to_avoid: [],
        topics_not_to_force: [],
        unsupported_capabilities: [],
        goal_authority_boundaries: [],
        identity_people_boundaries: [],
        coach_history_is_not_style: "Prior coach messages are history, not style.",
      },
    });
    const user = writerUserContent(packet, brief);
    expect(user).toContain("Still on the beach this week — back next Monday.");
    expect(user).toContain("User is currently away on vacation");
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/does not ban natural inference/i);
  });

  it("B. explicit return may be referenced confidently", () => {
    const packet = morningPacket({
      historical_evidence: [],
      exact_thread: {
        window_days: 21,
        max_messages: 30,
        omitted_older_turn_count: 0,
        messages: [
          threadTurn(
            "user",
            "I'm back home now.",
            "2026-08-25",
            "Aug 25, 8:00 AM",
            "same day",
            "Tuesday"
          ),
        ],
      },
    });
    const brief = baseBrief({
      human_situation: {
        most_alive: "User is back home",
        direct_question_or_need: null,
        relevant_life_event: "returned from trip",
        context_use: "relevant",
        identity_use: "background",
        person_use: "do_not_force",
        selected_person: null,
        selected_person_reason: null,
      },
      conversation_continuity: {
        already_acknowledged: [],
        answered_question: null,
        open_loop: null,
        stale_or_exhausted_topics: [],
        do_not_repeat: [],
      },
    });
    const user = writerUserContent(packet, brief);
    expect(user).toContain("I'm back home now.");
    expect(user).toContain("User is back home");
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/Brief and packet clearly support the current state/i);
  });

  it("C. planned return only must stay open — may ask, must not treat home as fact", () => {
    const packet = morningPacket({
      message_for: {
        timezone: "America/New_York",
        local_date: "2026-08-24",
        local_weekday: "Monday",
        daypart: "morning",
      },
      historical_evidence: [],
      exact_thread: {
        window_days: 21,
        max_messages: 30,
        omitted_older_turn_count: 0,
        messages: [
          threadTurn(
            "user",
            "I fly home Sunday.",
            "2026-08-21",
            "Aug 21, 10:00 AM",
            "3 days before",
            "Friday"
          ),
        ],
      },
    });
    const brief = baseBrief({
      conversation_continuity: {
        already_acknowledged: [],
        answered_question: null,
        open_loop: "It is unclear whether the Sunday flight happened and whether they are home.",
        stale_or_exhausted_topics: [],
        do_not_repeat: [],
      },
      boundaries: {
        claims_to_avoid: ["That they are home now"],
        topics_not_to_force: [],
        unsupported_capabilities: [],
        goal_authority_boundaries: [],
        identity_people_boundaries: [],
        coach_history_is_not_style: "Prior coach messages are history, not style.",
      },
    });
    const user = writerUserContent(packet, brief);
    expect(user).toContain("I fly home Sunday.");
    expect(user).toContain("It is unclear whether the Sunday flight happened and whether they are home.");
    expect(user).toContain("That they are home now");
    expect(user).not.toMatch(/I'm back home now/);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/unknown current circumstances into asserted current circumstances/i);
  });

  it("D. planned action — asking how the lift went remains legal", () => {
    const packet = morningPacket({
      preferred_name: "Johnny",
      historical_evidence: [],
      exact_thread: {
        window_days: 21,
        max_messages: 30,
        omitted_older_turn_count: 0,
        messages: [
          threadTurn(
            "user",
            "I'll lift tomorrow.",
            "2026-08-24",
            "Aug 24, 8:00 PM",
            "yesterday",
            "Monday"
          ),
        ],
      },
    });
    const brief = baseBrief({
      conversation_continuity: {
        already_acknowledged: [],
        answered_question: null,
        open_loop: "No reported outcome for the planned lift.",
        stale_or_exhausted_topics: [],
        do_not_repeat: [],
      },
    });
    const user = writerUserContent(packet, brief);
    expect(user).toContain("I'll lift tomorrow.");
    expect(user).toContain("No reported outcome for the planned lift.");
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(
      /Asking about the outcome of a planned action remains legal/i
    );
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/does not assert completion/i);
  });

  it("E. event uncertain — asking whether it happened remains legal; asserting it happened does not", () => {
    const packet = morningPacket({
      preferred_name: "Robin",
      historical_evidence: [],
      exact_thread: {
        window_days: 21,
        max_messages: 30,
        omitted_older_turn_count: 0,
        messages: [
          threadTurn(
            "user",
            "Tryouts are sometime this week.",
            "2026-08-24",
            "Aug 24, 6:00 PM",
            "yesterday",
            "Monday"
          ),
        ],
      },
    });
    const brief = baseBrief({
      conversation_continuity: {
        already_acknowledged: [],
        answered_question: null,
        open_loop: "It is unclear whether basketball tryouts have taken place yet.",
        stale_or_exhausted_topics: [],
        do_not_repeat: [],
      },
      boundaries: {
        claims_to_avoid: ["That tryouts already happened"],
        topics_not_to_force: [],
        unsupported_capabilities: [],
        goal_authority_boundaries: [],
        identity_people_boundaries: [],
        coach_history_is_not_style: "Prior coach messages are history, not style.",
      },
    });
    const user = writerUserContent(packet, brief);
    expect(user).toContain("Tryouts are sometime this week.");
    expect(user).toContain("It is unclear whether basketball tryouts have taken place yet.");
    expect(user).toContain("That tryouts already happened");
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/either omit the uncertain premise/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/uncertainty remains open/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/does not require "maybe"/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).not.toMatch(/must ask either\/or/i);
  });

  it("F. explicit current state X may be stated confidently", () => {
    const packet = morningPacket({
      preferred_name: "Dara",
      historical_evidence: [],
      exact_thread: {
        window_days: 21,
        max_messages: 30,
        omitted_older_turn_count: 0,
        messages: [
          threadTurn(
            "user",
            "I'm at the office all afternoon.",
            "2026-08-25",
            "Aug 25, 1:00 PM",
            "same day",
            "Tuesday"
          ),
        ],
      },
    });
    const brief = baseBrief({
      human_situation: {
        most_alive: "User is at the office this afternoon",
        direct_question_or_need: null,
        relevant_life_event: null,
        context_use: "relevant",
        identity_use: "background",
        person_use: "do_not_force",
        selected_person: null,
        selected_person_reason: null,
      },
    });
    const user = writerUserContent(packet, brief);
    expect(user).toContain("I'm at the office all afternoon.");
    expect(user).toContain("User is at the office this afternoon");
  });

  it("Robin / Tyler open-question patterns remain legal, not forced-awkward hedging", () => {
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/does not require "maybe" in every sentence/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/hedging every text, either\/or questions/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).toMatch(/does not weaken challenge or accountability/i);
    const robinLegal =
      "have the basketball tryouts taken place yet, or are they still ahead?";
    const tylerLegal = "already done or still ahead this evening?";
    expect(robinLegal).toMatch(/taken place yet, or are they still ahead/i);
    expect(tylerLegal).toMatch(/already done or still ahead/i);
    expect(MORNING_TTO_SYSTEM_PROMPT).not.toMatch(/forbid either\/or|ban or-questions/i);
  });

  it("architecture stays prompt-law only — no regex, rewrite, or second voice gate", () => {
    const morningSrc = readFileSync(
      path.join(process.cwd(), "src/lib/morning-tto-writer.ts"),
      "utf8"
    );
    const weeklySrc = readFileSync(
      path.join(process.cwd(), "src/lib/weekly-tto-writer.ts"),
      "utf8"
    );
    for (const src of [morningSrc, weeklySrc]) {
      expect(src).not.toMatch(/new RegExp/);
      expect(src).not.toMatch(/rewriteBody|repairWriter|second voice gate/i);
      expect(src).not.toMatch(/phrase blacklist|uncertainty phrase detector/i);
      expect(src).not.toMatch(/scan.*final body|mutate.*body after/i);
    }
  });
});
