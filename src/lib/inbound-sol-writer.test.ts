import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import {
  INBOUND_SOL_WRITER_JSON_REMINDER,
  INBOUND_SOL_WRITER_SYSTEM_PROMPT,
  parseInboundSolWriterJson,
  writeInboundSolBody,
} from "@/lib/inbound-sol-writer";
import { parseInboundCoachingBriefV1 } from "@/lib/inbound-sol-coaching-brief";
import { MORNING_COACHING_BRIEF_VERSION } from "@/lib/morning-tto-coaching-brief-v1";
import type { InboundRelationshipPacket } from "@/lib/inbound-relationship-packet";
import type { PatSourceEvidencePacketV1 } from "@/lib/inbound-pat-source-evidence";

function packet(latest: string): InboundRelationshipPacket {
  return {
    version: "inbound_relationship_v1",
    message_for: {
      timezone: "America/Chicago",
      local_date: "2026-08-18",
      local_weekday: "Tuesday",
      daypart: "inbound",
    },
    preferred_name: "Brooke",
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
      messages: [],
    },
  };
}

function brief() {
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
      stale_or_exhausted_topics: [],
      do_not_repeat: [],
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
      claims_to_avoid: [],
      topics_not_to_force: [],
      unsupported_capabilities: [],
      goal_authority_boundaries: [],
      identity_people_boundaries: [],
      coach_history_is_not_style: "History is not style.",
    },
    inbound: {
      answer_priority: "first",
      coaching_after_answer: "no",
      requires_pat_personal_knowledge: "yes",
      user_is_correcting_coach: false,
      accountability_interpretation: {
        relevance: "unrelated",
        outcome: "not_applicable",
        confidence: "high",
        evidence: "newest",
      },
      meaningful_win: null,
      pending_photo_relation: { relation: "none", target_win_id: null },
      durable_user_evidence: null,
      win_presentation: {
        mode: "none",
        win_id: null,
        win_kind: null,
        title: null,
        occurred_on: null,
        one_sentence_summary: null,
      },
    },
  })!;
}

function mockClient(contents: string[]): OpenAI {
  let i = 0;
  return {
    chat: {
      completions: {
        create: vi.fn(async () => {
          const content = contents[Math.min(i, contents.length - 1)] ?? "";
          i += 1;
          return { choices: [{ message: { content } }] };
        }),
      },
    },
  } as unknown as OpenAI;
}

const unrelatedEvidence: PatSourceEvidencePacketV1 = {
  required: true,
  retrieval_status: "ok",
  excerpts: [
    {
      book_id: "reach_for_the_summit",
      section_title: "CHAPTER 4",
      text: "Communication is paramount in a game or pressure situation.",
    },
  ],
};

const confidenceEvidence: PatSourceEvidencePacketV1 = {
  required: true,
  retrieval_status: "ok",
  excerpts: [
    {
      book_id: "sum_it_up",
      section_title: "SUM IT UP CHAPTER 4",
      text: "I was an insecure young coach. I overcompensated. I had to project confidence I did not always feel.",
    },
  ],
};

describe("parseInboundSolWriterJson", () => {
  it("A: nonempty body with needs_manual_pat_answer false is valid normal", () => {
    expect(
      parseInboundSolWriterJson(
        JSON.stringify({ body: "Yes. Early on I wondered whether I was ready.", needs_manual_pat_answer: false })
      )
    ).toEqual({
      body: "Yes. Early on I wondered whether I was ready.",
      needs_manual_pat_answer: false,
    });
  });

  it("B: nonempty body with flag omitted defaults to false", () => {
    expect(parseInboundSolWriterJson(JSON.stringify({ body: "Yes ..." }))).toEqual({
      body: "Yes ...",
      needs_manual_pat_answer: false,
    });
  });

  it("C: empty body with needs_manual_pat_answer true is valid manual", () => {
    expect(
      parseInboundSolWriterJson(JSON.stringify({ body: "", needs_manual_pat_answer: true }))
    ).toEqual({ body: "", needs_manual_pat_answer: true });
    expect(
      parseInboundSolWriterJson(JSON.stringify({ body: "   ", needs_manual_pat_answer: true }))
    ).toEqual({ body: "", needs_manual_pat_answer: true });
  });

  it("D: empty body without the flag is invalid", () => {
    expect(parseInboundSolWriterJson(JSON.stringify({ body: "" }))).toBeNull();
    expect(parseInboundSolWriterJson(JSON.stringify({ body: "  " }))).toBeNull();
  });

  it("E: nonempty body with needs_manual_pat_answer true is invalid", () => {
    expect(
      parseInboundSolWriterJson(
        JSON.stringify({
          body: "I don't remember whether I routinely set an alarm at night.",
          needs_manual_pat_answer: true,
        })
      )
    ).toBeNull();
  });

  it("F: invalid flag type is invalid", () => {
    expect(
      parseInboundSolWriterJson(JSON.stringify({ body: "Yes ...", needs_manual_pat_answer: "yes" }))
    ).toBeNull();
    expect(parseInboundSolWriterJson("not json")).toBeNull();
    expect(parseInboundSolWriterJson(JSON.stringify({ needs_manual_pat_answer: false }))).toBeNull();
  });
});

describe("writer contract via writeInboundSolBody", () => {
  it("accepts omitted flag as a normal nonempty body without retry", async () => {
    const client = mockClient([JSON.stringify({ body: "Proud you got the lift in." })]);
    const result = await writeInboundSolBody({
      packet: packet("Got the lift in."),
      brief: brief(),
      client,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toBe("Proud you got the lift in.");
    expect(result.needs_manual_pat_answer).toBe(false);
    expect(result.capture.retry_occurred).toBe(false);
    expect(client.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("accepts manual empty body without retry", async () => {
    const client = mockClient([JSON.stringify({ body: "", needs_manual_pat_answer: true })]);
    const result = await writeInboundSolBody({
      packet: packet("Did you set alarms at night?"),
      brief: brief(),
      patSourceEvidence: unrelatedEvidence,
      client,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toBe("");
    expect(result.needs_manual_pat_answer).toBe(true);
    expect(result.capture.retry_occurred).toBe(false);
    expect(client.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("empty body without flag is writer failure after the existing JSON retry only", async () => {
    const client = mockClient([
      JSON.stringify({ body: "" }),
      JSON.stringify({ body: "" }),
    ]);
    const result = await writeInboundSolBody({
      packet: packet("Did you set alarms at night?"),
      brief: brief(),
      client,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("empty_body");
    expect(result.body).toBeNull();
    expect(result.capture.retry_occurred).toBe(true);
    expect(client.chat.completions.create).toHaveBeenCalledTimes(2);
  });

  it("conflicting nonempty body + manual flag retries once then invalid_json", async () => {
    const bad = JSON.stringify({
      body: "I don't remember...",
      needs_manual_pat_answer: true,
    });
    const client = mockClient([bad, bad]);
    const result = await writeInboundSolBody({
      packet: packet("Did you set alarms at night?"),
      brief: brief(),
      client,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_json");
    expect(result.capture.retry_occurred).toBe(true);
    expect(client.chat.completions.create).toHaveBeenCalledTimes(2);
  });

  it("invalid flag type uses existing JSON retry only, not a second writer", async () => {
    const bad = JSON.stringify({ body: "Yes", needs_manual_pat_answer: "yes" });
    const client = mockClient([bad, bad]);
    const result = await writeInboundSolBody({
      packet: packet("How did having Tyler change your coaching?"),
      brief: brief(),
      client,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("invalid_json");
    expect(client.chat.completions.create).toHaveBeenCalledTimes(2);
  });
});

describe("writer prompt contract (semantic fixtures, not live GPT)", () => {
  it("instructs manual handoff only when PAT_SOURCE_EVIDENCE cannot support the fact", () => {
    const p = INBOUND_SOL_WRITER_SYSTEM_PROMPT;
    expect(p).toContain("Did you set alarms at night?");
    expect(p).toContain("Did you drink a lot of water every day?");
    expect(p).toContain("What time did you normally wake up?");
    expect(p).toContain("Did you struggle with confidence early in coaching?");
    expect(p).toContain("How did having Tyler change your coaching?");
    expect(p).toContain("What did you learn from losing?");
    expect(p).toContain("needs_manual_pat_answer");
    expect(p).toContain('I don\'t remember');
    expect(p).toContain("I won't make it up");
    expect(p).toContain("Never set needs_manual_pat_answer true");
    expect(p).toContain("ordinary coaching-judgment uncertainty");
    expect(p).toContain("Exact wording match is NOT required");
    expect(p).not.toContain("decline a favorite-team");
    expect(INBOUND_SOL_WRITER_JSON_REMINDER).toContain("needs_manual_pat_answer");
  });

  it("names unsupported vs supported fixture questions without requiring one SMS sentence", () => {
    void unrelatedEvidence;
    void confidenceEvidence;
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toMatch(
      /Did you set alarms at night\?[\s\S]*manual/
    );
    expect(INBOUND_SOL_WRITER_SYSTEM_PROMPT).toMatch(
      /Did you struggle with confidence early in coaching\?[\s\S]*normal body/
    );
  });
});
