import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFrom = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: supabaseFrom },
}));

import {
  bindingOpenQuestionAnswerAllowed,
  extractCoachQuestionFromOutboundBody,
  isAlreadyToldYouFrustrationInbound,
  isSubstantiveInboundForThreadMemory,
  loadV2CommitmentSmsThreadMemory,
  upsertCommitmentSmsThreadMemoryFromInbound,
  upsertCommitmentSmsThreadMemoryFromOutbound,
} from "@/lib/v2-commitment-sms-thread-memory";

type TableState = {
  row: Record<string, unknown> | null;
  insertPayload: Record<string, unknown> | null;
  updatePayload: Record<string, unknown> | null;
};

let state: TableState;

function resetState(row: Record<string, unknown> | null = null) {
  state = { row, insertPayload: null, updatePayload: null };
}

function installSupabaseMock() {
  supabaseFrom.mockImplementation((table: string) => {
    if (table !== "v2_commitment_sms_thread_memory") {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    }
    const builder = {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.row, error: null }),
        }),
      }),
      insert: (payload: Record<string, unknown>) => {
        state.insertPayload = payload;
        state.row = { ...payload };
        return Promise.resolve({ error: null });
      },
      update: (payload: Record<string, unknown>) => ({
        eq: async () => {
          state.updatePayload = payload;
          state.row = { ...(state.row ?? {}), ...payload };
          return { error: null };
        },
      }),
    };
    return builder;
  });
}

describe("extractCoachQuestionFromOutboundBody", () => {
  it("prefers last question sentence", () => {
    const q = extractCoachQuestionFromOutboundBody({
      sentBody: "Nice work yesterday. What story will you dictate today?",
    });
    expect(q).toMatch(/dictate today/i);
  });

  it("ignores binding yes/no unless expectedAnswerType allows", () => {
    const blocked = extractCoachQuestionFromOutboundBody({
      sentBody: "Reply YES to accept this tighter overlay?",
      expectedAnswerType: "yes_no_partial",
    });
    expect(blocked).toBeNull();

    const allowed = extractCoachQuestionFromOutboundBody({
      sentBody: "Reply YES to accept this tighter overlay?",
      expectedAnswerType: "proposal_yes_no",
    });
    expect(allowed).toMatch(/accept/i);
  });

  it("strips compliance footer before extraction", () => {
    const q = extractCoachQuestionFromOutboundBody({
      sentBody: "What is your smallest win today? Reply STOP to opt out.",
    });
    expect(q).toMatch(/smallest win/i);
    expect(q).not.toMatch(/STOP/i);
  });
});

describe("upsertCommitmentSmsThreadMemoryFromOutbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState(null);
    installSupabaseMock();
  });

  it("inserts row with open question on first outbound", async () => {
    const result = await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_1",
      clerkUserId: "user_1",
      sentBody: "What story will you dictate today?",
      sentAt: new Date("2026-05-18T12:00:00.000Z"),
      messageSid: "SM_OUT_1",
      source: "daily_sms",
      expectedAnswerType: "yes_no_partial",
    });

    expect(result).toEqual({ ok: true });
    expect(state.insertPayload).not.toBeNull();
    expect(state.insertPayload?.open_question_pending).toBe(true);
    expect(state.insertPayload?.open_question_text).toMatch(/dictate today/i);
    expect(state.insertPayload?.last_outbound_source).toBe("daily_sms");
    const questions = state.insertPayload?.last_5_coach_questions as { text: string }[];
    expect(questions.some((q) => /dictate today/i.test(q.text))).toBe(true);
    const dnr = state.insertPayload?.do_not_repeat_phrases as string[];
    expect(dnr.some((p) => /dictate today/i.test(p))).toBe(true);
  });

  it("updates outbound without clearing open question when no new question", async () => {
    resetState({
      commitment_id: "cmt_1",
      clerk_user_id: "user_1",
      projection_version: 1,
      open_question_text: "What story will you dictate today?",
      open_question_pending: true,
      open_question_asked_at: "2026-05-17T12:00:00.000Z",
      last_5_coach_questions: [
        {
          text: "What story will you dictate today?",
          asked_at: "2026-05-17T12:00:00.000Z",
          source: "daily_sms",
          message_sid: "SM_OLD",
        },
      ],
      do_not_repeat_phrases: ["What story will you dictate today?"],
      last_5_user_answers: [],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    const result = await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_1",
      clerkUserId: "user_1",
      sentBody: "You're right — let's keep going from your answer.",
      sentAt: new Date("2026-05-18T12:00:00.000Z"),
      messageSid: "SM_OUT_2",
      source: "inbound_coach_reply",
    });

    expect(result).toEqual({ ok: true });
    expect(state.updatePayload?.open_question_text).toBe("What story will you dictate today?");
    expect(state.updatePayload?.open_question_pending).toBe(true);
    expect(state.updatePayload?.last_outbound_full_body).toContain("keep going");
  });

  it("replaces open question when new coaching question is sent", async () => {
    resetState({
      commitment_id: "cmt_1",
      clerk_user_id: "user_1",
      projection_version: 1,
      open_question_text: "What story will you dictate today?",
      open_question_pending: true,
      open_question_answer_text: "Sunday School",
      open_question_answered_at: "2026-05-17T13:00:00.000Z",
      last_5_coach_questions: [],
      do_not_repeat_phrases: [],
      last_5_user_answers: [],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_1",
      clerkUserId: "user_1",
      sentBody: "What time will you protect for deep work tomorrow?",
      sentAt: new Date("2026-05-18T12:00:00.000Z"),
      messageSid: "SM_OUT_3",
      source: "inbound_coach_reply",
    });

    expect(state.updatePayload?.open_question_text).toMatch(/deep work tomorrow/i);
    expect(state.updatePayload?.open_question_pending).toBe(true);
    expect(state.updatePayload?.open_question_answer_text).toBeNull();
    expect(state.updatePayload?.open_question_answered_at).toBeNull();
  });
});

describe("upsertCommitmentSmsThreadMemoryFromInbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState(null);
    installSupabaseMock();
  });

  it("skips compliance-only inbound", async () => {
    const result = await upsertCommitmentSmsThreadMemoryFromInbound({
      commitmentId: "cmt_1",
      clerkUserId: "user_1",
      inboundBody: "STOP",
      inboundAt: new Date("2026-05-18T12:00:00.000Z"),
      messageSid: "SM_IN_1",
    });
    expect(result).toEqual({ ok: true });
    expect(state.insertPayload).toBeNull();
    expect(state.updatePayload).toBeNull();
  });

  it("records substantive answer and clears pending open question", async () => {
    resetState({
      commitment_id: "cmt_1",
      clerk_user_id: "user_1",
      projection_version: 1,
      open_question_text: "What story will you dictate today?",
      open_question_pending: true,
      open_question_expected_answer_type: "future_plan_story_title",
      last_5_coach_questions: [],
      last_5_user_answers: [],
      do_not_repeat_phrases: [],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    const result = await upsertCommitmentSmsThreadMemoryFromInbound({
      commitmentId: "cmt_1",
      clerkUserId: "user_1",
      inboundBody: "Sunday School lesson on patience",
      inboundAt: new Date("2026-05-18T12:05:00.000Z"),
      messageSid: "SM_IN_2",
      classification: "user_yes",
      routePurpose: "normal_inbound_reply",
    });

    expect(result).toEqual({ ok: true });
    expect(state.updatePayload?.open_question_answer_text).toBe("Sunday School lesson on patience");
    expect(state.updatePayload?.open_question_pending).toBe(false);
    expect(state.updatePayload?.last_inbound_full_body).toContain("Sunday School");
  });

  it("appends frustration correction without using it as open question answer", async () => {
    resetState({
      commitment_id: "cmt_1",
      clerk_user_id: "user_1",
      projection_version: 1,
      open_question_text: "What story will you dictate today?",
      open_question_pending: true,
      open_question_expected_answer_type: "future_plan_story_title",
      last_5_user_answers: [
        {
          text: "Sunday School",
          answered_at: "2026-05-17T13:00:00.000Z",
          source: "inbound_sms",
          message_sid: "SM_OLD",
        },
      ],
      last_5_coach_questions: [],
      do_not_repeat_phrases: [],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    await upsertCommitmentSmsThreadMemoryFromInbound({
      commitmentId: "cmt_1",
      clerkUserId: "user_1",
      inboundBody: "I already told you — Sunday School",
      inboundAt: new Date("2026-05-18T12:06:00.000Z"),
      messageSid: "SM_IN_3",
    });

    expect(state.updatePayload?.open_question_answer_text).toBeNull();
    expect(state.updatePayload?.open_question_pending).toBe(true);
    const corrections = state.updatePayload?.recent_frustration_corrections as { text: string }[];
    expect(corrections.some((c) => /already told you/i.test(c.text))).toBe(true);
  });

  it("does not clear binding proposal on arbitrary substantive text", async () => {
    resetState({
      commitment_id: "cmt_1",
      clerk_user_id: "user_1",
      projection_version: 1,
      open_question_text: "Reply YES to accept this overlay?",
      open_question_pending: true,
      open_question_expected_answer_type: "proposal_yes_no",
      last_5_coach_questions: [],
      last_5_user_answers: [],
      do_not_repeat_phrases: [],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    await upsertCommitmentSmsThreadMemoryFromInbound({
      commitmentId: "cmt_1",
      clerkUserId: "user_1",
      inboundBody: "Maybe tomorrow morning works better for me",
      inboundAt: new Date("2026-05-18T12:07:00.000Z"),
      messageSid: "SM_IN_4",
      routePurpose: "normal_inbound_reply",
    });

    expect(state.updatePayload?.open_question_pending).toBe(true);
    expect(state.updatePayload?.open_question_answer_text).toBeNull();
  });
});

describe("inbound classification helpers", () => {
  it("detects substantive vs frustration", () => {
    expect(isSubstantiveInboundForThreadMemory("Sunday School lesson plan")).toBe(true);
    expect(isAlreadyToldYouFrustrationInbound("I already told you")).toBe(true);
    expect(isSubstantiveInboundForThreadMemory("I already told you")).toBe(false);
    expect(bindingOpenQuestionAnswerAllowed({
      expectedAnswerType: "proposal_yes_no",
      classification: "user_yes",
      routePurpose: "adaptive_proposal_consent_accept",
    })).toBe(true);
    expect(
      bindingOpenQuestionAnswerAllowed({
        expectedAnswerType: "proposal_yes_no",
        classification: null,
        routePurpose: "normal_inbound_reply",
      })
    ).toBe(false);
  });
});

describe("loadV2CommitmentSmsThreadMemory", () => {
  beforeEach(() => {
    resetState({
      commitment_id: "cmt_1",
      clerk_user_id: "user_1",
      projection_version: 1,
      open_question_text: "What is your win?",
      open_question_pending: true,
      last_5_coach_questions: [],
      last_5_user_answers: [],
      do_not_repeat_phrases: [],
      recent_frustration_corrections: [],
      created_at: "2026-05-18T12:00:00.000Z",
      updated_at: "2026-05-18T12:00:00.000Z",
    });
    installSupabaseMock();
  });

  it("loads projection row", async () => {
    const row = await loadV2CommitmentSmsThreadMemory({ commitmentId: "cmt_1" });
    expect(row?.open_question_text).toBe("What is your win?");
    expect(row?.open_question_pending).toBe(true);
  });
});
