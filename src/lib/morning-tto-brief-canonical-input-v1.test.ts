import { describe, expect, it } from "vitest";
import {
  assembleMorningBriefInterpreterInputV1,
  deriveConsistencySupportedFromSpine,
  deriveEvidenceStrengthFromSpine,
  humanizeImportantPeopleRelationship,
  mapSpineOutcomeToBriefOutcome,
  MORNING_BRIEF_IMPORTANT_PEOPLE_MAX,
  MORNING_BRIEF_INTERPRETER_INPUT_VERSION,
  type AssembleMorningBriefInterpreterInputArgs,
} from "@/lib/morning-tto-brief-canonical-input-v1";
import { ONBOARDING_IDENTITY_ANCHOR_SOURCE } from "@/lib/v2-identity-anchor-validation";

function baseArgs(
  overrides: Partial<AssembleMorningBriefInterpreterInputArgs> = {}
): AssembleMorningBriefInterpreterInputArgs {
  return {
    timezone: "America/New_York",
    localDate: "2026-08-07",
    localWeekday: "Friday",
    daysSinceLastUserResponse: 1,
    neverReplied: false,
    recentUnansweredOutboundCount: 0,
    canonicalGoalText: "Dictate one story before noon",
    pendingGoalChange: null,
    identityAnchorText: "I am a father who keeps his word",
    identitySource: ONBOARDING_IDENTITY_ANCHOR_SOURCE,
    importantPeople: [
      {
        display_name: "Brooke",
        relationship_type: "spouse_partner",
        is_active: true,
        removed_at: null,
      },
      {
        display_name: "Emma",
        relationship_type: "child",
        is_active: true,
        removed_at: null,
      },
      {
        display_name: "Old",
        relationship_type: "other",
        is_active: false,
        removed_at: null,
      },
      {
        display_name: "Gone",
        relationship_type: "family_member",
        is_active: true,
        removed_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    lifeContextProfile: {
      partner_name: "Brooke",
      work_challenge: "Launching a new product",
    },
    latestOutcome: "user_yes",
    latestOutcomeAt: "2026-08-06T15:00:00.000Z",
    latestOutcomeMessage: "Got the story done",
    matchingOutcomeCount: 1,
    hasVerifiedProofMetadata: false,
    threadMemoryHint: {
      open_question_pending: false,
      open_question_text: "What will you dictate today?",
      open_question_answer_text: "Sunday School",
    },
    exactThreadMessages: [
      {
        sender: "coach",
        sent_at_utc: "2026-08-06T12:00:00.000Z",
        sent_at_local: "2026-08-06 08:00",
        local_day_key: "2026-08-06",
        local_weekday: "Thursday",
        day_relation_to_message: "1_day_before",
        body: "What will you dictate today?",
      },
      {
        sender: "user",
        sent_at_utc: "2026-08-06T15:00:00.000Z",
        sent_at_local: "2026-08-06 11:00",
        local_day_key: "2026-08-06",
        local_weekday: "Thursday",
        day_relation_to_message: "1_day_before",
        body: "Got the story done. Sunday School.",
      },
    ],
    omittedOlderTurnCount: 0,
    ...overrides,
  };
}

describe("morning-tto-brief-canonical-input-v1", () => {
  it("assembles versioned input with structured people and separate life context", () => {
    const result = assembleMorningBriefInterpreterInputV1(baseArgs());
    expect(result).not.toHaveProperty("ok");
    if ("ok" in result) throw new Error("unexpected failure");
    expect(result.version).toBe(MORNING_BRIEF_INTERPRETER_INPUT_VERSION);
    expect(result.message_for.daypart).toBe("morning");
    expect(result.canonical_goal.text).toBe("Dictate one story before noon");
    expect(result.available_identity).toEqual({
      text: "I am a father who keeps his word",
    });
    expect(result.available_important_people).toEqual([
      { name: "Brooke", relationship: "spouse/partner" },
      { name: "Emma", relationship: "child" },
    ]);
    expect(result.available_life_context).toEqual(
      expect.arrayContaining([
        { type: "partner_name", value: "Brooke" },
        { type: "work_challenge", value: "Launching a new product" },
      ])
    );
    expect(result.available_important_people.every((p) => "type" in p === false)).toBe(
      true
    );
    expect(result.thread_memory_hint?.authority).toBe("non_authoritative_projection");
  });

  it("includes quotable identity and excludes non-quotable identity", () => {
    const quotable = assembleMorningBriefInterpreterInputV1(baseArgs());
    if ("ok" in quotable) throw new Error("fail");
    expect(quotable.available_identity?.text).toMatch(/father/);

    const legacy = assembleMorningBriefInterpreterInputV1(
      baseArgs({
        identitySource: "onboarding_people_summary_v2",
      })
    );
    if ("ok" in legacy) throw new Error("fail");
    expect(legacy.available_identity).toBeNull();
  });

  it("accepts already-quotable-gated identity without inventing a source", () => {
    const result = assembleMorningBriefInterpreterInputV1(
      baseArgs({
        identityAnchorText: "I am a father who keeps his word",
        identitySource: null,
        identityAlreadyQuotableGated: true,
      })
    );
    if ("ok" in result) throw new Error("fail");
    expect(result.available_identity).toEqual({
      text: "I am a father who keeps his word",
    });
    expect(result.available_identity).not.toHaveProperty("source");
    expect(JSON.stringify(result)).not.toMatch(/onboarding_identity_anchor_v1/);
    expect(JSON.stringify(result)).not.toMatch(/identity_source|identitySource/);
  });

  it("already-quotable-gated path does not require or invent onboarding source for other quotable origins", () => {
    // Production no longer mislabels user_edited / guided / etc. as onboarding.
    // Upstream gate already decided; source stays null and is not persisted.
    for (const ignored of [
      null,
      "user_edited",
      "explicitly_confirmed",
      "guided_resolution_identity",
      "not_a_real_source",
    ]) {
      const result = assembleMorningBriefInterpreterInputV1(
        baseArgs({
          identityAnchorText: "I show up for my kids",
          identitySource: ignored,
          identityAlreadyQuotableGated: true,
        })
      );
      if ("ok" in result) throw new Error("fail");
      expect(result.available_identity).toEqual({ text: "I show up for my kids" });
      expect(JSON.stringify(result.available_identity)).not.toMatch(
        /onboarding_identity_anchor_v1|user_edited|guided_resolution/
      );
    }
  });

  it("ungated identity still requires the existing quotable-source rule", () => {
    const blocked = assembleMorningBriefInterpreterInputV1(
      baseArgs({
        identityAnchorText: "Arbitrary ungated identity text",
        identitySource: null,
        identityAlreadyQuotableGated: false,
      })
    );
    if ("ok" in blocked) throw new Error("fail");
    expect(blocked.available_identity).toBeNull();

    const stillBlocked = assembleMorningBriefInterpreterInputV1(
      baseArgs({
        identityAnchorText: "Arbitrary ungated identity text",
        identitySource: "onboarding_people_summary_v2",
        // undefined already_quotable_gated
      })
    );
    if ("ok" in stillBlocked) throw new Error("fail");
    expect(stillBlocked.available_identity).toBeNull();

    const allowed = assembleMorningBriefInterpreterInputV1(
      baseArgs({
        identityAnchorText: "I am a father who keeps his word",
        identitySource: ONBOARDING_IDENTITY_ANCHOR_SOURCE,
        identityAlreadyQuotableGated: undefined,
      })
    );
    if ("ok" in allowed) throw new Error("fail");
    expect(allowed.available_identity?.text).toMatch(/father/);
  });

  it("null identity remains null even when already-quotable-gated", () => {
    const result = assembleMorningBriefInterpreterInputV1(
      baseArgs({
        identityAnchorText: null,
        identitySource: null,
        identityAlreadyQuotableGated: true,
      })
    );
    if ("ok" in result) throw new Error("fail");
    expect(result.available_identity).toBeNull();
  });

  it("excludes inactive and removed people and caps at product max", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      display_name: `Person${i}`,
      relationship_type: "other",
      is_active: true,
      removed_at: null as string | null,
    }));
    const result = assembleMorningBriefInterpreterInputV1(
      baseArgs({ importantPeople: many })
    );
    if ("ok" in result) throw new Error("fail");
    expect(result.available_important_people).toHaveLength(
      MORNING_BRIEF_IMPORTANT_PEOPLE_MAX
    );
  });

  it("humanizes relationship labels", () => {
    expect(humanizeImportantPeopleRelationship("spouse_partner")).toBe("spouse/partner");
    expect(humanizeImportantPeopleRelationship("child")).toBe("child");
    expect(humanizeImportantPeopleRelationship("team_player_staff")).toBe("team member");
  });

  it("does not select a person — no interpreter selection in assembler", () => {
    const result = assembleMorningBriefInterpreterInputV1(baseArgs());
    if ("ok" in result) throw new Error("fail");
    expect(result).not.toHaveProperty("selected_person");
    expect(JSON.stringify(result)).not.toMatch(/"selected_person"/);
  });

  it("maps spine outcomes and never invents consistency from one completion", () => {
    expect(mapSpineOutcomeToBriefOutcome("user_yes")).toBe("completed");
    expect(mapSpineOutcomeToBriefOutcome("user_no")).toBe("missed");
    expect(mapSpineOutcomeToBriefOutcome("user_partial")).toBe("partial");
    expect(mapSpineOutcomeToBriefOutcome(null)).toBe("no_recent_evidence");

    expect(deriveEvidenceStrengthFromSpine({ matchingOutcomeCount: 1, hasVerifiedProofMetadata: false })).toBe(
      "stated_once"
    );
    expect(deriveConsistencySupportedFromSpine(1)).toBe(false);
    expect(deriveEvidenceStrengthFromSpine({ matchingOutcomeCount: 2, hasVerifiedProofMetadata: false })).toBe(
      "repeated"
    );
    expect(deriveConsistencySupportedFromSpine(2)).toBe(true);
    expect(
      deriveEvidenceStrengthFromSpine({ matchingOutcomeCount: 1, hasVerifiedProofMetadata: true })
    ).toBe("verified");
  });

  it("plan text / goal title never becomes completion evidence", () => {
    const result = assembleMorningBriefInterpreterInputV1(
      baseArgs({
        canonicalGoalText: "Plan to dictate tomorrow",
        latestOutcome: null,
        latestOutcomeMessage: null,
        matchingOutcomeCount: 0,
        hasVerifiedProofMetadata: false,
      })
    );
    if ("ok" in result) throw new Error("fail");
    expect(result.canonical_goal.text).toBe("Plan to dictate tomorrow");
    expect(result.truth_spine.latest_outcome).toBeNull();
    expect(result.truth_spine.evidence_strength).toBe("none");
    expect(result.truth_spine.consistency_supported).toBe(false);
    expect(result.truth_spine.proof_claims_allowed).toEqual({
      completion: false,
      miss: false,
      partial: false,
      proof: false,
    });
  });

  it("keeps pending goal as unconfirmed awaiting_user_confirmation", () => {
    const result = assembleMorningBriefInterpreterInputV1(
      baseArgs({
        pendingGoalChange: {
          candidate_text: "Walk 20 minutes after dinner",
          status: "awaiting_user_confirmation",
        },
      })
    );
    if ("ok" in result) throw new Error("fail");
    expect(result.pending_goal_change).toEqual({
      candidate_text: "Walk 20 minutes after dinner",
      status: "awaiting_user_confirmation",
    });
    expect(result.canonical_goal.text).toBe("Dictate one story before noon");
  });

  it("uses behavior/effective ask text as Current Goal, not a separate title field", () => {
    const result = assembleMorningBriefInterpreterInputV1(
      baseArgs({
        canonicalGoalText: "  Dictate one story before noon  ",
      })
    );
    if ("ok" in result) throw new Error("fail");
    expect(result.canonical_goal.text).toBe("Dictate one story before noon");
    expect(result).not.toHaveProperty("goal_title");
  });

  it("exact thread only includes provided real messages", () => {
    const result = assembleMorningBriefInterpreterInputV1(baseArgs());
    if ("ok" in result) throw new Error("fail");
    expect(result.exact_thread.messages).toHaveLength(2);
    expect(result.exact_thread.messages.map((m) => m.body)).toEqual([
      "What will you dictate today?",
      "Got the story done. Sunday School.",
    ]);
    expect(JSON.stringify(result.exact_thread)).not.toMatch(/Never sent draft/i);
  });

  it("records long silence as mechanical facts only — no coaching move", () => {
    const result = assembleMorningBriefInterpreterInputV1(
      baseArgs({
        daysSinceLastUserResponse: 18,
        recentUnansweredOutboundCount: 3,
        neverReplied: false,
        latestOutcome: null,
        matchingOutcomeCount: 0,
      })
    );
    if ("ok" in result) throw new Error("fail");
    expect(result.mechanical).toEqual({
      days_since_last_user_response: 18,
      never_replied: false,
      recent_unanswered_outbound_count: 3,
      message_required_today: false,
      quiet_relationship_eligible: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/primary_move|reconnect|pressure/);
  });

  it("does not encode list-recitation or name-drop behavior", () => {
    const result = assembleMorningBriefInterpreterInputV1(baseArgs());
    if ("ok" in result) throw new Error("fail");
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/name-?drop|recite|prove you remember/i);
    expect(result.available_important_people.length).toBeGreaterThan(0);
  });
});
