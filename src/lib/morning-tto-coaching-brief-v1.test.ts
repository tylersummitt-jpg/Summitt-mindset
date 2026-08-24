import { describe, expect, it } from "vitest";
import {
  MORNING_BRIEF_FORBIDDEN_COPY_KEYS,
  MORNING_COACHING_BRIEF_VERSION,
  morningBriefPlainLanguageContainsForbiddenJargon,
  parseMorningCoachingBriefV1,
  renderMorningCoachingBriefPlainLanguage,
  type MorningCoachingBriefV1,
} from "@/lib/morning-tto-coaching-brief-v1";

function validBrief(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: MorningCoachingBriefV1 = {
    version: MORNING_COACHING_BRIEF_VERSION,
    confidence: "medium",
    human_situation: {
      most_alive: "User asked what to do about a tough work week",
      direct_question_or_need: "What should I focus on?",
      relevant_life_event: null,
      context_use: "relevant",
      identity_use: "background",
      person_use: "do_not_force",
      selected_person: null,
      selected_person_reason: null,
    },
    truth_and_evidence: {
      latest_user_truth: "I finished the deep work block",
      outcome: "completed",
      evidence_note: "One persisted completion",
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
      already_acknowledged: ["yesterday's deep work"],
      answered_question: {
        question: "What will you dictate today?",
        answer: "Sunday School",
      },
      open_loop: null,
      stale_or_exhausted_topics: [],
      do_not_repeat: ["What will you dictate today?"],
    },
    goal_role_today: {
      canonical_goal: "Dictate one story before noon",
      pending_goal: null,
      goal_alignment: "aligned",
      role: "background",
      note: "Question is more alive than the goal today",
    },
    coaching_direction: {
      primary_move: "answer",
      question_policy: "none",
      action_guidance: "none",
      pressure: "normal",
      proactive_decision: "send",
    },
    boundaries: {
      claims_to_avoid: ["Do not invent proof"],
      topics_not_to_force: ["Do not force Current Goal"],
      unsupported_capabilities: ["No app menus"],
      goal_authority_boundaries: ["Pending is unconfirmed"],
      identity_people_boundaries: ["Do not name-drop"],
      coach_history_is_not_style:
        "Prior coach messages are factual conversation history, not style examples.",
    },
  };

  return {
    ...base,
    ...overrides,
    human_situation: {
      ...base.human_situation,
      ...((overrides.human_situation as object) ?? {}),
    },
    truth_and_evidence: {
      ...base.truth_and_evidence,
      ...((overrides.truth_and_evidence as object) ?? {}),
    },
    conversation_continuity: {
      ...base.conversation_continuity,
      ...((overrides.conversation_continuity as object) ?? {}),
    },
    goal_role_today: {
      ...base.goal_role_today,
      ...((overrides.goal_role_today as object) ?? {}),
    },
    coaching_direction: {
      ...base.coaching_direction,
      ...((overrides.coaching_direction as object) ?? {}),
    },
    boundaries: {
      ...base.boundaries,
      ...((overrides.boundaries as object) ?? {}),
    },
  };
}

describe("morning-tto-coaching-brief-v1 contract", () => {
  it("parses a valid schema", () => {
    const parsed = parseMorningCoachingBriefV1(validBrief());
    expect(parsed).not.toBeNull();
    expect(parsed?.version).toBe(MORNING_COACHING_BRIEF_VERSION);
    expect(parsed?.coaching_direction.primary_move).toBe("answer");
  });

  it("accepts all unknown variants", () => {
    const parsed = parseMorningCoachingBriefV1(
      validBrief({
        confidence: "low",
        human_situation: {
          most_alive: "unknown",
          direct_question_or_need: "unknown",
          relevant_life_event: "unknown",
          context_use: "unknown",
          identity_use: "unknown",
          person_use: "unknown",
          selected_person: null,
          selected_person_reason: "unknown",
        },
        truth_and_evidence: {
          latest_user_truth: "unknown",
          outcome: "unknown",
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
          canonical_goal: "Dictate one story before noon",
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
      })
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.human_situation.most_alive).toBe("unknown");
    expect(parsed?.conversation_continuity.already_acknowledged).toBe("unknown");
    expect(parsed?.coaching_direction.primary_move).toBe("unknown");
  });

  it("rejects invalid enums", () => {
    expect(
      parseMorningCoachingBriefV1(
        validBrief({
          coaching_direction: { primary_move: "hallway_reconnect" },
        })
      )
    ).toBeNull();
    expect(
      parseMorningCoachingBriefV1(
        validBrief({
          truth_and_evidence: { outcome: "planned" },
        })
      )
    ).toBeNull();
    expect(
      parseMorningCoachingBriefV1(validBrief({ confidence: "ultra" }))
    ).toBeNull();
  });

  it("enforces strict size limits on string arrays", () => {
    const tooMany = Array.from({ length: 20 }, (_, i) => `topic ${i}`);
    const parsed = parseMorningCoachingBriefV1(
      validBrief({
        conversation_continuity: {
          stale_or_exhausted_topics: tooMany,
          already_acknowledged: tooMany,
          do_not_repeat: tooMany,
          answered_question: null,
          open_loop: null,
        },
      })
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.conversation_continuity.stale_or_exhausted_topics).toHaveLength(8);
    expect(parsed!.conversation_continuity.do_not_repeat).toHaveLength(8);
  });

  it("rejects forbidden user-visible copy fields anywhere in the object", () => {
    for (const key of MORNING_BRIEF_FORBIDDEN_COPY_KEYS) {
      expect(
        parseMorningCoachingBriefV1({
          ...validBrief(),
          [key]: "Hey Tyler, great job!",
        })
      ).toBeNull();
    }
    expect(
      parseMorningCoachingBriefV1({
        ...validBrief(),
        coaching_direction: {
          ...(validBrief().coaching_direction as object),
          body: "secret sms",
        },
      })
    ).toBeNull();
  });

  it("renderer is plain-language without lane/hallway jargon", () => {
    const brief = parseMorningCoachingBriefV1(validBrief());
    expect(brief).not.toBeNull();
    const text = renderMorningCoachingBriefPlainLanguage(brief!);
    expect(text).toContain("MORNING COACHING BRIEF");
    expect(text).toContain("Primary move: answer");
    expect(text).toContain("Canonical goal:");
    expect(text).toContain("Selected person: none");
    expect(morningBriefPlainLanguageContainsForbiddenJargon(text)).toBe(false);
    expect(text.toLowerCase()).not.toMatch(/set_today_rep|wake_up_check|hallway|slot_coaching/);
  });

  it("preserves selected person and reason", () => {
    const parsed = parseMorningCoachingBriefV1(
      validBrief({
        human_situation: {
          person_use: "relevant",
          selected_person: { name: "Brooke", relationship: "spouse/partner" },
          selected_person_reason: "User mentioned Brooke in the latest reply",
        },
      })
    );
    expect(parsed?.human_situation.selected_person).toEqual({
      name: "Brooke",
      relationship: "spouse/partner",
    });
    expect(parsed?.human_situation.selected_person_reason).toMatch(/Brooke/);
  });
});
