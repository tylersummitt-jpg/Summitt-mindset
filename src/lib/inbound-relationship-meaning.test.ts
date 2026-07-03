import { describe, expect, it } from "vitest";
import {
  buildInboundMeaningFacts,
  deriveInboundRelationshipMeaning,
  derivePersistenceDecision,
  deriveSmsResponseIntent,
  inferInboundMeaningRoutePriorityFromText,
  shouldPromoteClarifyForReportedCompletionPersist,
  textBlocksClassifierCompletionPromotion,
} from "@/lib/inbound-relationship-meaning";
import { defaultGatedDecision } from "@/lib/v2-ai-inbound";

const badClassifier = {
  eventType: "user_yes" as const,
  hint: "completion_detail",
};

function meaningFor(
  text: string,
  classifier?: { eventType: "user_yes" | "user_no" | "user_partial"; hint?: string | null },
  routePriority?: Parameters<typeof buildInboundMeaningFacts>[0]["routePriority"]
) {
  return buildInboundMeaningFacts({
    rawInbound: text,
    classifierEventType: classifier?.eventType,
    classifierNormalizedHint: classifier?.hint ?? null,
    routePriority,
  });
}

describe("deriveInboundRelationshipMeaning — reported completion", () => {
  it("recognizes positive reported completions", () => {
    for (const text of [
      "I did my 10,000 steps yesterday!",
      "I got it done",
      "I completed it",
      "I made the calls",
      "I did the workout",
      "I did it",
    ]) {
      const m = deriveInboundRelationshipMeaning({ rawInbound: text });
      expect(m.relationship_meaning).toBe("reported_completion");
    }
  });

  it("yesterday steps use yesterday temporal scope", () => {
    const m = meaningFor("I did my 10,000 steps yesterday!");
    expect(m.temporal_scope).toBe("yesterday");
    expect(m.sms_response_intent).toBe("acknowledge_completion_and_next_step");
  });
});

describe("derivePersistenceDecision — no false today user_yes", () => {
  it("past completion is ack_only not write_user_yes_today", () => {
    const facts = meaningFor("I did my 10,000 steps yesterday!");
    expect(facts.persistence_decision).toBe("ack_only");
    expect(facts.reason).toContain("prior_day");
    expect(shouldPromoteClarifyForReportedCompletionPersist({ inboundMeaning: facts })).toBe(false);
  });

  it("today completion can write_user_yes_today", () => {
    const facts = meaningFor("I did it");
    expect(facts.persistence_decision).toBe("write_user_yes_today");
  });
});

describe("inbound temporal anchoring", () => {
  it("anchors got it done today to received local day", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "Yes! I got it done today! Super proud of myself.",
      receivedAt: new Date("2026-05-31T21:17:00.000Z"),
      timezone: "America/New_York",
    });
    expect(facts.temporal_scope).toBe("today");
    expect(facts.spoken_local_day_key).toBe("2026-05-31");
    expect(facts.reported_for_day_key).toBe("2026-05-31");
    expect(facts.persistence_decision).toBe("write_user_yes_today");
  });
});

describe("classifier bad hint — must not promote completion", () => {
  it("cancel/support text with forced completion_detail", () => {
    const facts = meaningFor("I need to cancel my subscription", badClassifier);
    expect(facts.relationship_meaning).not.toBe("reported_completion");
    expect(facts.persistence_decision).not.toBe("write_user_yes_today");
    expect(textBlocksClassifierCompletionPromotion("I need to cancel my subscription")).toBe(true);
  });

  it("help cancel with negation and bad classifier", () => {
    const facts = meaningFor("help cancel my account, I did not mean to sign up", badClassifier);
    expect(facts.persistence_decision).not.toBe("write_user_yes_today");
  });

  it("plan text with bad classifier", () => {
    const facts = meaningFor("I made a plan", badClassifier);
    expect(facts.relationship_meaning).toBe("plan_made");
    expect(facts.persistence_decision).toBe("no_outcome_write");
  });

  it("partial text with bad classifier", () => {
    const facts = meaningFor("I almost did it", badClassifier);
    expect(facts.relationship_meaning).toBe("partial_attempt");
    expect(facts.persistence_decision).toBe("write_user_partial");
    expect(facts.persistence_decision).not.toBe("write_user_yes_today");
  });
});

describe("false positives — NOT user_yes persist", () => {
  const cases: Array<{ text: string; meaning: string; persist?: string }> = [
    { text: "I did not do it", meaning: "miss", persist: "write_user_no" },
    { text: "I didn't do it", meaning: "miss", persist: "write_user_no" },
    { text: "I never got to it", meaning: "miss", persist: "write_user_no" },
    { text: "I made a plan", meaning: "plan_made", persist: "no_outcome_write" },
    { text: "I'll do it tonight", meaning: "plan_made", persist: "no_outcome_write" },
    { text: "I almost did it", meaning: "partial_attempt", persist: "write_user_partial" },
    { text: "I tried to do it", meaning: "partial_attempt", persist: "write_user_partial" },
    { text: "I started but didn't finish", meaning: "partial_attempt", persist: "write_user_partial" },
    { text: "I started but did not finish", meaning: "partial_attempt", persist: "write_user_partial" },
    { text: "I did half", meaning: "partial_attempt", persist: "write_user_partial" },
    { text: "I tried but couldn't finish", meaning: "partial_attempt", persist: "write_user_partial" },
    { text: "I wish I did", meaning: "miss" },
    { text: "I did think about it", meaning: "uncertain" },
    { text: "I did?", meaning: "uncertain" },
  ];

  for (const { text, meaning, persist } of cases) {
    it(`"${text}" → ${meaning}, not today user_yes`, () => {
      const facts = meaningFor(text, badClassifier);
      expect(facts.relationship_meaning).toBe(meaning);
      expect(facts.persistence_decision).not.toBe("write_user_yes_today");
      if (persist) {
        expect(facts.persistence_decision).toBe(persist);
      }
    });
  }
});

describe("route priority", () => {
  it("pending resolution defers persistence", () => {
    const meaning = deriveInboundRelationshipMeaning({
      rawInbound: "I did it",
      routePriority: { pending_resolution: true },
    });
    const persist = derivePersistenceDecision({ meaning, routePriority: { pending_resolution: true } });
    expect(persist.persistence_decision).toBe("defer_to_pending_resolution");
  });

  it("contract consent defers", () => {
    const persist = derivePersistenceDecision({
      meaning: deriveInboundRelationshipMeaning({
        rawInbound: "yes",
        routePriority: { contract_consent: true },
      }),
      routePriority: { contract_consent: true },
    });
    expect(persist.persistence_decision).toBe("defer_to_contract_consent");
  });

  it("open question owns bounded yes/no", () => {
    const m = deriveInboundRelationshipMeaning({
      rawInbound: "yes",
      routePriority: { open_question_owns_turn: true },
    });
    expect(m.relationship_meaning).toBe("answer_to_prior_question");
  });

  it("support/cancel from text wins over bad classifier", () => {
    const facts = meaningFor("I need to cancel my subscription", badClassifier);
    expect(facts.relationship_meaning).toBe("support_request");
    expect(facts.persistence_decision).toBe("no_outcome_write");
  });

  it("STOP compliance inferred from text", () => {
    const route = inferInboundMeaningRoutePriorityFromText("STOP");
    expect(route.compliance_or_stop).toBe(true);
    const facts = meaningFor("STOP", badClassifier);
    expect(facts.relationship_meaning).toBe("support_request");
  });

  it("pending resolution wins over completion text", () => {
    const facts = meaningFor("I did it", undefined, { pending_resolution: true });
    expect(facts.persistence_decision).toBe("defer_to_pending_resolution");
  });
});

describe("sms_response_intent coaching alignment", () => {
  it("miss → tell_truth_and_recover", () => {
    const meaning = deriveInboundRelationshipMeaning({ rawInbound: "I did not do it" });
    const persist = derivePersistenceDecision({ meaning });
    expect(deriveSmsResponseIntent({ meaning, persistence: persist }).sms_response_intent).toBe(
      "tell_truth_and_recover"
    );
  });

  it("plan → reinforce_plan", () => {
    const meaning = deriveInboundRelationshipMeaning({ rawInbound: "I made a plan" });
    const persist = derivePersistenceDecision({ meaning });
    expect(deriveSmsResponseIntent({ meaning, persistence: persist }).sms_response_intent).toBe(
      "reinforce_plan_and_choose_first_step"
    );
  });

  it("partial → identify_blocker_or_next_move", () => {
    const meaning = deriveInboundRelationshipMeaning({ rawInbound: "I started but didn't finish" });
    const persist = derivePersistenceDecision({ meaning });
    expect(deriveSmsResponseIntent({ meaning, persistence: persist }).sms_response_intent).toBe(
      "identify_blocker_or_next_move"
    );
  });

  it("reported_completion → acknowledge_completion_and_next_step", () => {
    const meaning = deriveInboundRelationshipMeaning({ rawInbound: "I got it done" });
    const persist = derivePersistenceDecision({ meaning });
    expect(deriveSmsResponseIntent({ meaning, persistence: persist }).sms_response_intent).toBe(
      "acknowledge_completion_and_next_step"
    );
  });
});

describe("clear today completion persistence decision", () => {
  it("I did it! allows write_user_yes_today", () => {
    expect(meaningFor("I did it!").persistence_decision).toBe("write_user_yes_today");
  });

  it("yesterday steps use ack_only", () => {
    expect(meaningFor("I did my 10,000 steps yesterday!").persistence_decision).toBe("ack_only");
  });
});

describe("coach-context correction — not miss / no user_no", () => {
  const PRODUCTION_META_CORRECTION =
    "Yes! I was wondering why you asked it because I did not say I would be playing with the kids tomorrow";

  const noWriteCases = [
    PRODUCTION_META_CORRECTION,
    "Where did you get that? I didn't say that.",
    "No, I didn't say I would do that tomorrow.",
    "That's not what I said.",
    "You misunderstood me.",
  ];

  it.each(noWriteCases)("%s → answer_to_prior_question, no_outcome_write", (text) => {
    const facts = meaningFor(text, { eventType: "user_yes" });
    expect(facts.relationship_meaning).not.toBe("miss");
    expect(facts.persistence_decision).toBe("no_outcome_write");
    expect(facts.evidence).toContain("coach_context_correction_not_miss");
  });

  it("production case is not classified as miss", () => {
    const m = deriveInboundRelationshipMeaning({ rawInbound: PRODUCTION_META_CORRECTION });
    expect(m.relationship_meaning).toBe("answer_to_prior_question");
    expect(m.evidence).toContain("coach_context_correction_not_miss");
  });
});

describe("true accountability misses — still write_user_no", () => {
  const missCases = [
    "I didn't do my goal today.",
    "No, I didn't hit my steps.",
    "I missed it.",
    "I didn't make the calls.",
    "Didn't happen.",
  ];

  it.each(missCases)("%s → miss / write_user_no", (text) => {
    const facts = meaningFor(text, { eventType: "user_no" });
    expect(facts.relationship_meaning).toBe("miss");
    expect(facts.persistence_decision).toBe("write_user_no");
  });
});

const TYLER_DISTRIBUTION_COMPLETION =
  "I got my distribution done today! I hit the goal! Woo hoo!";

const BROOKE_STEPS_COMPLETION =
  "I got my 10,000 steps today though! And I did it before we had a birthday party to go to";

const TENNESSEE_FUTURE_CONFIDENCE =
  "We're heading to Tennessee on Thursday. We live in Ohio and we're driving to Tennessee with all three kids so it'll throw us off our routine a little bit but I should still be able to hit the goals";

describe("substantive self-reported completion — persistence carve-out", () => {
  const openQuestionRoute = { open_question_owns_turn: true };

  it("Tyler exact string with open question → write_user_yes_today", () => {
    const facts = meaningFor(TYLER_DISTRIBUTION_COMPLETION, badClassifier, openQuestionRoute);
    expect(facts.relationship_meaning).toBe("reported_completion");
    expect(facts.persistence_decision).toBe("write_user_yes_today");
    expect(facts.reason).toBe("substantive_self_reported_completion");
  });

  it("Brooke exact string with open question → write_user_yes_today (today anchor beats before-clause)", () => {
    const facts = meaningFor(BROOKE_STEPS_COMPLETION, badClassifier, openQuestionRoute);
    expect(facts.persistence_decision).toBe("write_user_yes_today");
    expect(facts.reason).toBe("substantive_self_reported_completion");
  });

  it("Tennessee future-confidence trip → not write_user_yes_today", () => {
    const facts = meaningFor(TENNESSEE_FUTURE_CONFIDENCE, badClassifier, openQuestionRoute);
    expect(facts.persistence_decision).not.toBe("write_user_yes_today");
  });

  it("I got my steps in today with open question → write_user_yes_today", () => {
    const facts = meaningFor("I got my steps in today", badClassifier, openQuestionRoute);
    expect(facts.persistence_decision).toBe("write_user_yes_today");
  });

  it("I got in 2 miles today with open question → write_user_yes_today", () => {
    const facts = meaningFor("I got in 2 miles today", badClassifier, openQuestionRoute);
    expect(facts.persistence_decision).toBe("write_user_yes_today");
  });

  it("I got my run in with open question → write_user_yes_today", () => {
    const facts = meaningFor("I got my run in", badClassifier, openQuestionRoute);
    expect(facts.persistence_decision).toBe("write_user_yes_today");
  });

  it("I should be able to hit the goal → no_outcome_write", () => {
    const facts = meaningFor("I should be able to hit the goal", badClassifier, openQuestionRoute);
    expect(facts.persistence_decision).not.toBe("write_user_yes_today");
  });

  it("I'll get it done later → no_outcome_write", () => {
    const facts = meaningFor("I'll get it done later", badClassifier, openQuestionRoute);
    expect(facts.persistence_decision).not.toBe("write_user_yes_today");
  });

  it("I hit the goal with open question → write_user_yes_today", () => {
    const facts = meaningFor("I hit the goal", badClassifier, openQuestionRoute);
    expect(facts.persistence_decision).toBe("write_user_yes_today");
    expect(facts.reason).toBe("substantive_self_reported_completion");
  });

  it("I got my distribution done today with open question pending → write_user_yes_today", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: "I got my distribution done today",
      classifierEventType: "user_yes",
      openQuestionPending: true,
      latestOpenQuestion: "What happened with your distribution plan?",
    });
    expect(facts.persistence_decision).toBe("write_user_yes_today");
    expect(facts.reason).toBe("substantive_self_reported_completion");
  });

  it("I completed my run today with open question → write_user_yes_today", () => {
    const facts = meaningFor("I completed my run today", badClassifier, openQuestionRoute);
    expect(facts.persistence_decision).toBe("write_user_yes_today");
    expect(facts.reason).toBe("substantive_self_reported_completion");
  });

  it("bare Yes with open question → no_outcome_write", () => {
    const facts = meaningFor("yes", badClassifier, openQuestionRoute);
    expect(facts.persistence_decision).toBe("no_outcome_write");
  });

  it("future plan → no_outcome_write", () => {
    const facts = meaningFor("I'll do it tonight", badClassifier, openQuestionRoute);
    expect(facts.persistence_decision).toBe("no_outcome_write");
  });

  it("bare Will do X later → plan_made / no_outcome_write", () => {
    const facts = meaningFor("Will do more cardio later", badClassifier);
    expect(facts.relationship_meaning).toBe("plan_made");
    expect(facts.persistence_decision).toBe("no_outcome_write");
    expect(facts.temporal_scope).toBe("future");
  });

  it.each([
    "Will run later",
    "Will get it done tonight",
    "Will handle it after work",
  ])("%s → plan_made", (text) => {
    const facts = meaningFor(text, badClassifier);
    expect(facts.relationship_meaning).toBe("plan_made");
    expect(facts.persistence_decision).toBe("no_outcome_write");
  });

  it("compound future + completed today → write_user_yes_today", () => {
    const facts = meaningFor(
      "I'm going to run tomorrow. I completed my run today.",
      badClassifier,
      openQuestionRoute
    );
    expect(facts.persistence_decision).toBe("write_user_yes_today");
  });
});

describe("sleep/phone cousin audit — miss not implemented in this slice", () => {
  const SLEEP_PHONE_BODY =
    "Ok I got in bed at 11:45. I didn't fall asleep until 1:30. I did stay on my phone past 9:30";

  it("documents current classification for sleep/phone example", () => {
    const facts = buildInboundMeaningFacts({
      rawInbound: SLEEP_PHONE_BODY,
      classifierEventType: "user_no",
      routePriority: { open_question_owns_turn: true },
      openQuestionPending: true,
      latestOpenQuestion: "Were you off your phone by 9:30 tonight?",
      effectiveAsk: "off phone by 9:30",
      behaviorStatement: "No phone after 9:30pm",
    });
    // Current: "I did stay on my phone" can false-promote to reported_completion via i-did-* pattern.
    // With open_question_owns_turn, persistence is no_outcome_write regardless.
    expect(facts.persistence_decision).toBe("no_outcome_write");
    expect(facts.reason).toBe("open_question_route_owns_turn");
  });
});

describe("onboarding/coach-process disputes — no user_no", () => {
  const ONBOARDING_DISPUTE =
    "Thanks I did 15 minutes of onboarding and you didn't ask me anything about what I chose. Did the onboarding matter?";

  it("production onboarding dispute is question/answer not miss", () => {
    const facts = meaningFor(ONBOARDING_DISPUTE, { eventType: "user_no" });
    expect(["question", "answer_to_prior_question"]).toContain(facts.relationship_meaning);
    expect(facts.persistence_decision).toBe("no_outcome_write");
    expect(facts.evidence).toContain("onboarding_process_dispute_not_miss");
  });

  it.each([
    "You didn't ask me about what I chose.",
    "Did the onboarding matter?",
    "Why didn't you ask me about my onboarding answers?",
  ])("%s → no_outcome_write", (text) => {
    const facts = meaningFor(text, { eventType: "user_no" });
    expect(facts.persistence_decision).toBe("no_outcome_write");
  });

  it.each([
    "I didn't do it today.",
    "I didn't hit my steps today.",
    "I did not get it today because this is the first day of vacation",
  ])("%s → write_user_no preserved", (text) => {
    const facts = meaningFor(text, { eventType: "user_no" });
    expect(facts.relationship_meaning).toBe("miss");
    expect(facts.persistence_decision).toBe("write_user_no");
  });

  it("I did not say that meta-correction still no_outcome_write", () => {
    const facts = meaningFor("I did not say that", { eventType: "user_no" });
    expect(facts.persistence_decision).toBe("no_outcome_write");
  });

  it("No I won't proposal rejection still no_outcome_write", () => {
    const facts = meaningFor("No I won't", { eventType: "user_no" });
    expect(facts.persistence_decision).toBe("no_outcome_write");
  });

  it("substantive completion fix still write_user_yes_today", () => {
    const facts = meaningFor("I got my steps in today");
    expect(facts.persistence_decision).toBe("write_user_yes_today");
  });
});

describe("reflective_share meaning", () => {
  it("classifies substantive team-unity reflection", () => {
    const text =
      "I spent time today encouraging others on the team and building unity. It reminded me why leadership matters.";
    const facts = meaningFor(text);
    expect(facts.relationship_meaning).toBe("reflective_share");
    expect(facts.sms_response_intent).toBe("acknowledge_reflection");
    expect(facts.persistence_decision).toBe("no_outcome_write");
  });

  it("does not classify short yes/no as reflective_share", () => {
    const facts = meaningFor("Yes");
    expect(facts.relationship_meaning).not.toBe("reflective_share");
  });

  it("open-question multi-item list answers prior ask instead of reflective_share", () => {
    const text =
      "Our family is healthy. We are provided with everything we need. My wife's family is doing well health wise.";
    const facts = buildInboundMeaningFacts({
      rawInbound: text,
      classifierEventType: "user_partial",
      classifierNormalizedHint: null,
      openQuestionPending: true,
      latestOpenQuestion: "Name three things you are grateful for.",
    });
    expect(facts.relationship_meaning).toBe("answer_to_prior_question");
    expect(facts.relationship_meaning).not.toBe("reflective_share");
  });
});
