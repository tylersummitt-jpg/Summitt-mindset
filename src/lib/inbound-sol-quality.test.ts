import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT,
  INBOUND_SOL_INTERPRETER_MODEL,
  INBOUND_SOL_INTERPRETER_REASONING_EFFORT,
} from "@/lib/inbound-sol-brief-interpreter";
import {
  INBOUND_SOL_WRITER_SYSTEM_PROMPT,
  INBOUND_SOL_WRITER_MODEL,
  INBOUND_SOL_WRITER_REASONING_EFFORT,
  buildInboundSolWriterMessages,
  toWriterFacingInboundCoachingBrief,
  toWriterFacingInboundRelationshipPacket,
} from "@/lib/inbound-sol-writer";
import { parseInboundCoachingBriefV1 } from "@/lib/inbound-sol-coaching-brief";
import { MORNING_COACHING_BRIEF_VERSION } from "@/lib/morning-tto-coaching-brief-v1";
import type { InboundRelationshipPacket } from "@/lib/inbound-relationship-packet";
import { evaluateInboundSolBlockOnlyReply } from "@/lib/inbound-sol-reply-validate";
import { exactThreadExcludingCurrentTurnSids } from "@/lib/inbound-relationship-packet";

function packet(latest: string, threadBodies: string[]): InboundRelationshipPacket {
  return {
    version: "inbound_relationship_v1",
    message_for: {
      timezone: "America/Chicago",
      local_date: "2026-08-18",
      local_weekday: "Tuesday",
      daypart: "inbound",
    },
    preferred_name: "Robin",
    current_goal: { text: "Lift 30 minutes" },
    current_identity: { text: null },
    personal_context: [],
    hard_state: { pending_goal_change: null, open_coach_question: null },
    latest_inbound_text: latest,
    latest_inbound_message_sid: "SMx",
    pending_media_context: {
      candidate_count: 0,
      candidate: null,
      recent_wins: [],
    },
    historical_evidence: [],
    exact_thread: {
      window_days: 21,
      max_messages: 30,
      omitted_older_turn_count: 0,
      messages: threadBodies.map((body, i) => ({
        sender: i % 2 === 0 ? "coach" : "user",
        sent_at_utc: new Date(Date.UTC(2026, 7, 10 + i, 12)).toISOString(),
        sent_at_local: "2026-08-10 07:00",
        local_day_key: "2026-08-10",
        local_weekday: "Monday",
        day_relation_to_message: "8 days before",
        body,
      })),
    },
  };
}

function briefWithInbound(inbound: Record<string, unknown>) {
  return parseInboundCoachingBriefV1({
    version: MORNING_COACHING_BRIEF_VERSION,
    confidence: "high",
    human_situation: {
      most_alive: "Newest inbound",
      direct_question_or_need: null,
      relevant_life_event: null,
      context_use: "relevant",
      identity_use: "background",
      person_use: "do_not_force",
      selected_person: null,
      selected_person_reason: null,
    },
    truth_and_evidence: {
      latest_user_truth: "newest",
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
      already_acknowledged: [],
      answered_question: null,
      open_loop: null,
      stale_or_exhausted_topics: ["stale team-win"],
      do_not_repeat: ["paraphrase the vehicle search"],
    },
    goal_role_today: {
      canonical_goal: "Lift 30 minutes",
      pending_goal: null,
      goal_alignment: "aligned",
      role: "background",
      note: "unknown",
    },
    coaching_direction: {
      primary_move: "answer",
      question_policy: "none",
      action_guidance: "none",
      pressure: "normal",
      proactive_decision: "send",
    },
    boundaries: {
      claims_to_avoid: ["Do not claim live search"],
      topics_not_to_force: ["Current Goal"],
      unsupported_capabilities: ["No live vehicle search"],
      goal_authority_boundaries: [],
      identity_people_boundaries: [],
      coach_history_is_not_style: "History is not style.",
    },
    inbound,
  });
}

describe("inbound Sol contracts", () => {
  it("uses gpt-5.6-sol with reasoning_effort low and no temperature", () => {
    expect(INBOUND_SOL_INTERPRETER_MODEL).toBe("gpt-5.6-sol");
    expect(INBOUND_SOL_WRITER_MODEL).toBe("gpt-5.6-sol");
    expect(INBOUND_SOL_INTERPRETER_REASONING_EFFORT).toBe("low");
    expect(INBOUND_SOL_WRITER_REASONING_EFFORT).toBe("low");
  });

  it("interpreter prompt owns newest text, questions first, human moments, no English isolation", () => {
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain("Newest real inbound text");
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain("answer_priority = first");
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain("Never in isolation");
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toMatch(/family, faith, grief/i);
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain("user_is_correcting_coach");
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain("Attempt is NOT automatically partial");
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain("hard_state.open_coach_question");
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain("Do not force a stale pending question");
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain(
      "conversation_continuity.answered_question is the Coach question in this conversation that newest U actually answered"
    );
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain(
      "That may be hard_state.open_coach_question or another real Coach question visible in exact_thread"
    );
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain(
      "set answered_question.question to the exact open_coach_question.text"
    );
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain("copy that supplied text exactly");
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).not.toContain(
      "conversation_continuity.answered_question refers ONLY to hard_state.open_coach_question"
    );
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain(
      "It does NOT refer to pending photo clarification"
    );
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain("pending_photo_relation");
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain("win_presentation");
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain("Lifted Weights");
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain(
      "does NOT determine whether a Win exists"
    );
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).not.toContain("win_presentation");
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain("DURABLE USER EVIDENCE");
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain("verbatim contiguous substring");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).not.toContain("DURABLE USER EVIDENCE");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).not.toContain("I noticed");
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toContain(
      "You never receive image bytes, URLs, or Storage paths"
    );
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).not.toContain("within 24");
  });

  it("D1 pending-photo law: captions may pair without photo nouns; time alone is not authority", () => {
    const prompt = INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT;
    expect(prompt).toContain(
      "Awesome family day today! Loved spending time with Brooke and the kids."
    );
    expect(prompt).toContain("current_turn_win");
    expect(prompt).toMatch(/explicit photo\/picture\/image nouns are NOT required/i);
    expect(prompt).toContain("Conversational sequencing is legitimate semantic evidence");
    expect(prompt).toContain("Elapsed time by itself is never enough to pair");
    expect(prompt).toContain("What time is my check-in tomorrow?");
    expect(prompt).toContain("Breck hit his first home run today!");
    expect(prompt).toContain("a human genuinely could not tell");
    expect(prompt).toContain("candidate_count=2 → none");
    expect(prompt).not.toContain("Age in seconds is not evidence they belong together");
    expect(prompt).not.toMatch(/must say .{0,20}(this photo|this picture|that image)/i);
    expect(prompt).not.toMatch(/if age[_ ]?(seconds)?\s*</i);
  });

  it("writer prompt is relationship-first and does not clip", () => {
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain(
      "You are Coach Pat Summitt, replying to the user's newest real text in one ongoing coaching relationship."
    );
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).not.toContain("legendary");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("Do not clip to a character budget");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).not.toContain("300");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).not.toContain("320");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("accept the correction");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain(
      "Do not claim a photo or picture was saved, attached, added, or stored."
    );
  });
});

describe("named inbound quality regressions (prompt + brief contract)", () => {
  it("ANGEL VEHICLE SEARCH: do not paraphrase, ask how to help, force goal, or claim live search", () => {
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("Do not repeatedly paraphrase");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain(
      "Do not ask how to help after help was already requested"
    );
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("No unsupported live search claims");
    const brief = briefWithInbound({
      answer_priority: "first",
      coaching_after_answer: "no",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "unrelated",
        outcome: "not_applicable",
        confidence: "high",
        evidence: "Need an affordable 5 passenger SUV under $9000",
      },
      meaningful_win: null,
    });
    expect(brief?.inbound.answer_priority).toBe("first");
    expect(brief?.inbound.accountability_interpretation.outcome).toBe("not_applicable");
  });

  it("ROBIN TEMPORAL SCRAMBLE: newest watch/workout text, not stale team-win", () => {
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("Do not answer a stale earlier topic");
    const p = packet(
      "My watch shows that I am walking up to 3 miles during school day. I still need to do some sort of other workout.",
      ["Congrats on the team win!", "Thanks!", "How was the game?"]
    );
    const brief = briefWithInbound({
      answer_priority: "normal",
      coaching_after_answer: "yes",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "related",
        outcome: "partial",
        confidence: "medium",
        evidence: "walking up to 3 miles during school day",
      },
      meaningful_win: null,
    });
    const msgs = buildInboundSolWriterMessages(p, brief!);
    const user = String(msgs[1]?.content ?? "");
    expect(user).toContain("My watch shows that I am walking up to 3 miles");
    expect(brief?.conversation_continuity.stale_or_exhausted_topics).toEqual(
      expect.arrayContaining(["stale team-win"])
    );
  });

  it("BROOKE: hold me accountable is a coaching instruction", () => {
    expect(INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT).toMatch(/coaching feedback/i);
    const brief = briefWithInbound({
      answer_priority: "normal",
      coaching_after_answer: "no",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "related",
        outcome: "not_applicable",
        confidence: "high",
        evidence: "Please hold me accountable.",
      },
      meaningful_win: null,
    });
    expect(brief?.inbound.accountability_interpretation.outcome).toBe("not_applicable");
  });

  it("RB PRODUCT QUESTION: answer first, goal not central", () => {
    const brief = briefWithInbound({
      answer_priority: "first",
      coaching_after_answer: "no",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "unrelated",
        outcome: "not_applicable",
        confidence: "high",
        evidence: "Have you developed an App yet?",
      },
      meaningful_win: null,
    });
    expect(brief?.inbound.answer_priority).toBe("first");
    expect(brief?.coaching_direction.primary_move).toBe("answer");
  });

  it("TYLER FAMILY/FAITH: church with kids is not a lift pivot", () => {
    const brief = briefWithInbound({
      answer_priority: "normal",
      coaching_after_answer: "no",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "unrelated",
        outcome: "not_applicable",
        confidence: "high",
        evidence: "Awesome. The kids love church!",
      },
      meaningful_win: null,
    });
    expect(brief?.inbound.accountability_interpretation.relevance).toBe("unrelated");
  });

  it("DARA: still struggling stays grounded", () => {
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("No invented facts, emotions, proof");
    const brief = briefWithInbound({
      answer_priority: "normal",
      coaching_after_answer: "no",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "related",
        outcome: "unclear",
        confidence: "medium",
        evidence: "Still struggling.",
      },
      meaningful_win: null,
    });
    expect(brief?.inbound.accountability_interpretation.outcome).toBe("unclear");
  });

  it("RB CORRECTION: accept correction", () => {
    const brief = briefWithInbound({
      answer_priority: "normal",
      coaching_after_answer: "no",
      user_is_correcting_coach: true,
      accountability_interpretation: {
        relevance: "central",
        outcome: "completed",
        confidence: "high",
        evidence: "I completed all four, just out of order.",
      },
      meaningful_win: null,
    });
    expect(brief?.inbound.user_is_correcting_coach).toBe(true);
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("Do not defend a stale interpretation");
  });
});

describe("block-only validation", () => {
  it("empty body blocks", () => {
    expect(evaluateInboundSolBlockOnlyReply({ body: "  ", persistedUserYes: false }).ok).toBe(
      false
    );
  });

  it("internal labels block", () => {
    const r = evaluateInboundSolBlockOnlyReply({
      body: "That's a user_yes today.",
      persistedUserYes: true,
    });
    expect(r.ok).toBe(false);
  });

  it("victory saved without persist blocks", () => {
    const r = evaluateInboundSolBlockOnlyReply({
      body: "Saved this to your Victory Room.",
      persistedUserYes: false,
    });
    expect(r.ok).toBe(false);
  });

  it("natural coaching body passes", () => {
    const r = evaluateInboundSolBlockOnlyReply({
      body: "Proud you finished the lift before lunch.",
      persistedUserYes: true,
    });
    expect(r.ok).toBe(true);
  });

  it("does not block natural logged-win language without Victory Room", () => {
    const r = evaluateInboundSolBlockOnlyReply({
      body: "Glad you logged that win.",
      persistedUserYes: false,
    });
    expect(r.ok).toBe(true);
  });

  it("still blocks Victory Room saved/logged without persist", () => {
    const r = evaluateInboundSolBlockOnlyReply({
      body: "I saved it in Victory Room.",
      persistedUserYes: false,
    });
    expect(r.ok).toBe(false);
  });

  it("blocks photo-saved claims when D1 pending photo is not canonically attached", () => {
    const blocked = [
      "I saved your photo.",
      "I saved that picture.",
      "I added your photo.",
      "I attached your picture.",
      "I put that photo in your Victory Room.",
    ];
    for (const body of blocked) {
      const r = evaluateInboundSolBlockOnlyReply({
        body,
        persistedUserYes: true,
        pendingPhotoNotCanonicallyAttached: true,
      });
      expect(r).toEqual({ ok: false, reason: "photo_saved_before_canonical_attach" });
    }
  });

  it("still allows Win-saved language when a pending photo is not attached", () => {
    const r = evaluateInboundSolBlockOnlyReply({
      body: "I saved that Win.",
      persistedUserYes: true,
      pendingPhotoNotCanonicallyAttached: true,
    });
    expect(r.ok).toBe(true);
    const logged = evaluateInboundSolBlockOnlyReply({
      body: "Glad you logged that win.",
      persistedUserYes: false,
      pendingPhotoNotCanonicallyAttached: true,
    });
    expect(logged.ok).toBe(true);
  });
});

describe("writer D1 pending-photo data minimization", () => {
  it("does not give the writer pending_media_context or pending_photo_relation", () => {
    const p = packet("This was me finally taking the kids hiking.", []);
    p.pending_media_context = {
      candidate_count: 1,
      candidate: {
        job_id: "aaaaaaaa-1111-4111-8111-111111111111",
        age_seconds: 120,
        message_sid: "SMdddddddddddddddddddddddddddddddd",
        normalized_ready: true,
      },
      recent_wins: [
        {
          id: "cccccccc-3333-4333-8333-333333333333",
          text: "Kids hiking",
          occurred_at: "2026-08-20T12:00:00.000Z",
          relationship_type: "whole_life",
          commitment_id: null,
          has_media: false,
        },
      ],
    };
    const brief = briefWithInbound({
      answer_priority: "normal",
      coaching_after_answer: "no",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "unrelated",
        outcome: "not_applicable",
        confidence: "high",
        evidence: "This was me finally taking the kids hiking.",
      },
      meaningful_win: {
        present: true,
        grounded_action: "Took the kids hiking",
        relationship: "life",
      },
      pending_photo_relation: { relation: "current_turn_win", target_win_id: null },
    });
    expect(brief?.inbound.pending_photo_relation.relation).toBe("current_turn_win");
    const writerPacket = toWriterFacingInboundRelationshipPacket(p);
    const writerBrief = toWriterFacingInboundCoachingBrief(brief!);
    expect(writerPacket).not.toHaveProperty("pending_media_context");
    expect(writerPacket.historical_evidence).toEqual([]);
    expect(writerPacket).toHaveProperty("historical_evidence");
    expect(writerBrief.inbound).not.toHaveProperty("pending_photo_relation");
    const msgs = buildInboundSolWriterMessages(p, brief!);
    const user = String(msgs[1]?.content ?? "");
    expect(user).not.toContain("pending_media_context");
    expect(user).not.toContain("pending_photo_relation");
    expect(user).not.toContain("current_turn_win");
    expect(user).toContain("This was me finally taking the kids hiking.");
    expect(p.pending_media_context.candidate_count).toBe(1);
    expect(brief?.inbound.pending_photo_relation.relation).toBe("current_turn_win");
  });

  it("does not give the writer win_presentation trophy titles", () => {
    const p = packet("yes", []);
    const brief = briefWithInbound({
      answer_priority: "normal",
      coaching_after_answer: "no",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "central",
        outcome: "completed",
        confidence: "high",
        evidence: "yes",
      },
      meaningful_win: null,
      pending_photo_relation: { relation: "none", target_win_id: null },
      win_presentation: {
        accountability_trophy_title: "Lifted Weights",
        life_trophy_title: "Swam With the Kids",
      },
    });
    expect(brief?.inbound.win_presentation.accountability_trophy_title).toBe("Lifted Weights");
    const writerBrief = toWriterFacingInboundCoachingBrief(brief!);
    expect(writerBrief.inbound).not.toHaveProperty("win_presentation");
    expect(writerBrief.inbound).not.toHaveProperty("accountability_trophy_title");
    expect(writerBrief.inbound).not.toHaveProperty("life_trophy_title");
    const user = String(buildInboundSolWriterMessages(p, brief!)[1]?.content ?? "");
    expect(user).not.toContain("win_presentation");
    expect(user).not.toContain("accountability_trophy_title");
    expect(user).not.toContain("life_trophy_title");
    expect(user).not.toContain("Lifted Weights");
    expect(user).not.toContain("Swam With the Kids");
  });

  it("does not give the writer requires_pat_personal_knowledge (commit 1)", () => {
    const p = packet("How did having Tyler change your coaching?", []);
    const brief = briefWithInbound({
      answer_priority: "first",
      coaching_after_answer: "no",
      requires_pat_personal_knowledge: "yes",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "unrelated",
        outcome: "not_applicable",
        confidence: "high",
        evidence: "How did having Tyler change your coaching?",
      },
      meaningful_win: null,
    });
    expect(brief?.inbound.requires_pat_personal_knowledge).toBe("yes");
    const writerBrief = toWriterFacingInboundCoachingBrief(brief!);
    expect(writerBrief.inbound).not.toHaveProperty("requires_pat_personal_knowledge");
    const user = String(buildInboundSolWriterMessages(p, brief!)[1]?.content ?? "");
    expect(user).not.toContain("requires_pat_personal_knowledge");
    expect(user).not.toContain("PAT_SOURCE_EVIDENCE");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain(
      "You are Coach Pat Summitt, replying to the user's newest real text in one ongoing coaching relationship."
    );
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain(
      "Being Coach Pat Summitt does NOT mean telling a Pat story"
    );
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("factual ceiling");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("I want you to...");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("Do not use AI/policy language");
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain("As an AI...");
  });

  it("treats PAT_SOURCE_EVIDENCE as a memory bank and allows confident synthesis", () => {
    const p = INBOUND_SOL_WRITER_SYSTEM_PROMPT;
    expect(p).toContain("MEMORY BANK");
    expect(p).toContain("not a set of citations to litigate");
    expect(p).toContain("Speak as yourself in first person with authority");
    expect(p).toContain("Supported synthesis");
    expect(p).toContain("Exact wording match is NOT required");
    expect(p).toContain("Do not hedge merely because");
    expect(p).toContain("What's documented is...");
    expect(p).toContain("I can't honestly say whether...");
    expect(p).toContain("I can't tell you honestly...");
    expect(p).toContain("Ban evidentiary");
    expect(p).toContain("Never expose the mechanics of grounding");
    expect(p).toContain("The factual ceiling remains");
    expect(p).toContain("do not invent it");
    expect(p).toContain("needs_manual_pat_answer");
    expect(p).toContain("Did you set alarms at night?");
    expect(p).toContain("Never set needs_manual_pat_answer true");
    expect(p).toContain("No invented unsupported autobiography");
    expect(p).toContain("Do not use AI/policy language");
    expect(p).toContain(
      "Being Coach Pat Summitt does NOT mean telling a Pat story"
    );
    expect(p).toContain("I want you to...");
    expect(p).toContain("No forced biography");
    expect(p).toContain("No increased hedging");
    expect(p).toContain("Witness material from Pat's books about Pat herself");
    expect(p).toContain("If she's nervous they'd never know it");
    expect(p).toContain("Direct first-person evidence outweighs weaker conditional witness language");
    expect(p).not.toContain("legendary");
  });

  it("adds PAT_SOURCE_EVIDENCE only when the packet is passed", () => {
    const p = packet("How did having Tyler change your coaching?", []);
    const brief = briefWithInbound({
      answer_priority: "first",
      coaching_after_answer: "no",
      requires_pat_personal_knowledge: "yes",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "unrelated",
        outcome: "not_applicable",
        confidence: "high",
        evidence: "How did having Tyler change your coaching?",
      },
      meaningful_win: null,
    });
    const without = String(buildInboundSolWriterMessages(p, brief!)[1]?.content ?? "");
    expect(without).not.toContain("PAT_SOURCE_EVIDENCE_V1");
    const withEv = String(
      buildInboundSolWriterMessages(p, brief!, {
        required: true,
        retrieval_status: "ok",
        excerpts: [{ book_id: "sum_it_up", section_title: "CHAPTER 8", text: "Ty-man" }],
      })[1]?.content ?? ""
    );
    expect(withEv).toContain("PAT_SOURCE_EVIDENCE_V1");
    expect(withEv).toContain("Ty-man");
    expect(withEv).not.toContain("global_id");
    expect(withEv).not.toContain('"score"');
  });

  it("D2c awaiting_user and clarification_body are stripped from writer input", () => {
    const p = packet("I took Lakelyn to her first dance class.", []);
    p.pending_media_context = {
      candidate_count: 1,
      candidate: {
        job_id: "aaaaaaaa-1111-4111-8111-111111111111",
        age_seconds: 2400,
        message_sid: "SMdddddddddddddddddddddddddddddddd",
        normalized_ready: true,
        awaiting_user: true,
        clarification_body: "What made this one a win for you?",
      },
      recent_wins: [],
    };
    const brief = briefWithInbound({
      answer_priority: "normal",
      coaching_after_answer: "no",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "unrelated",
        outcome: "not_applicable",
        confidence: "high",
        evidence: "I took Lakelyn to her first dance class.",
      },
      meaningful_win: {
        present: true,
        grounded_action: "Took Lakelyn to her first dance class",
        relationship: "life",
      },
      pending_photo_relation: { relation: "current_turn_win", target_win_id: null },
    });
    const writerPacket = toWriterFacingInboundRelationshipPacket(p);
    const writerBrief = toWriterFacingInboundCoachingBrief(brief!);
    expect(writerPacket).not.toHaveProperty("pending_media_context");
    expect(writerBrief.inbound).not.toHaveProperty("pending_photo_relation");
    const user = String(buildInboundSolWriterMessages(p, brief!)[1]?.content ?? "");
    expect(user).not.toContain("awaiting_user");
    expect(user).not.toContain("clarification_body");
    expect(user).not.toContain("What made this one a win for you?");
    expect(user).not.toContain("pending_photo_relation");
    expect(user).toContain("I took Lakelyn to her first dance class.");
  });

  it("does not authorize photo-saved claims when a Win persisted and D0 is only queued", () => {
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toContain(
      "Do not claim a photo or picture was saved, attached, added, or stored."
    );
    const queued = evaluateInboundSolBlockOnlyReply({
      body: "I saved your photo to the Victory Room.",
      persistedUserYes: true,
      pendingPhotoNotCanonicallyAttached: true,
    });
    expect(queued.ok).toBe(false);
    const winOnly = evaluateInboundSolBlockOnlyReply({
      body: "Proud you took the kids hiking — I saved that Win.",
      persistedUserYes: true,
      pendingPhotoNotCanonicallyAttached: true,
    });
    expect(winOnly.ok).toBe(true);
  });
});

describe("coalesced inbound U appears once in thread", () => {
  it("drops current SIDs and keeps historical identical body from another SID", () => {
    const kept = exactThreadExcludingCurrentTurnSids(
      [
        { sender: "user", message_sid: "SMold", body: "Need a 5 passenger SUV under 9000" },
        { sender: "user", message_sid: "SMnow", body: "Need a 5 passenger SUV under 9000" },
      ],
      ["SMnow"]
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.message_sid).toBe("SMold");
  });
});
