import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFrom = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: supabaseFrom },
}));

import {
  bindingOpenQuestionAnswerAllowed,
  extractCoachQuestionFromOutboundBody,
  isAlreadyToldYouFrustrationInbound,
  isShortContextualOpenQuestionAnswer,
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

  it("clearBindingOpenQuestion clears stale proposal_yes_no when ACK has no new question", async () => {
    resetState({
      commitment_id: "cmt_ack",
      clerk_user_id: "user_ack",
      projection_version: 1,
      open_question_text: "Reply YES to accept this overlay?",
      open_question_pending: true,
      open_question_expected_answer_type: "proposal_yes_no",
      open_question_asked_at: "2026-05-17T12:00:00.000Z",
      last_5_coach_questions: [],
      last_5_user_answers: [],
      do_not_repeat_phrases: [],
      recent_frustration_corrections: [],
      last_inbound_full_body: "yes",
      last_inbound_at: "2026-05-18T11:00:00.000Z",
    });
    installSupabaseMock();

    await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_ack",
      clerkUserId: "user_ack",
      sentBody: "Got it — your adjusted ask is in effect for today.",
      sentAt: new Date("2026-05-18T12:00:00.000Z"),
      messageSid: "SM_ACK_1",
      source: "inbound_coach_reply",
      expectedAnswerType: null,
      clearBindingOpenQuestion: true,
    });

    expect(state.updatePayload?.open_question_pending).toBe(false);
    expect(state.updatePayload?.open_question_expected_answer_type).toBeNull();
    expect(state.updatePayload?.open_question_text).toBeNull();
    expect(state.updatePayload?.last_outbound_source).toBe("inbound_coach_reply");
    expect(state.updatePayload?.last_inbound_full_body).toBe("yes");
  });

  it("clearBindingOpenQuestion clears stale contract_yes_no pending", async () => {
    resetState({
      commitment_id: "cmt_ack_c",
      clerk_user_id: "user_ack",
      projection_version: 1,
      open_question_text: "Reply YES to confirm this contract?",
      open_question_pending: true,
      open_question_expected_answer_type: "contract_yes_no",
      last_5_coach_questions: [],
      last_5_user_answers: [],
      do_not_repeat_phrases: [],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_ack_c",
      clerkUserId: "user_ack",
      sentBody: "Understood — keeping your current bar.",
      sentAt: new Date("2026-05-18T12:01:00.000Z"),
      messageSid: "SM_ACK_2",
      source: "inbound_coach_reply",
      expectedAnswerType: null,
      clearBindingOpenQuestion: true,
    });

    expect(state.updatePayload?.open_question_pending).toBe(false);
    expect(state.updatePayload?.open_question_expected_answer_type).toBeNull();
  });

  it("clearBindingOpenQuestion can set new non-binding question with expectedAnswerType null", async () => {
    resetState({
      commitment_id: "cmt_ack_q",
      clerk_user_id: "user_ack",
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

    await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_ack_q",
      clerkUserId: "user_ack",
      sentBody: "Locked in. What got in the way yesterday?",
      sentAt: new Date("2026-05-18T12:02:00.000Z"),
      messageSid: "SM_ACK_3",
      source: "inbound_coach_reply",
      expectedAnswerType: null,
      clearBindingOpenQuestion: true,
    });

    expect(state.updatePayload?.open_question_pending).toBe(true);
    expect(state.updatePayload?.open_question_expected_answer_type).toBeNull();
    expect(state.updatePayload?.open_question_text).toMatch(/got in the way/i);
  });

  it("without clearBindingOpenQuestion preserves stale binding open question", async () => {
    resetState({
      commitment_id: "cmt_no_clear",
      clerk_user_id: "user_ack",
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

    await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_no_clear",
      clerkUserId: "user_ack",
      sentBody: "Got it — your adjusted ask is in effect.",
      sentAt: new Date("2026-05-18T12:03:00.000Z"),
      messageSid: "SM_ACK_4",
      source: "inbound_coach_reply",
      expectedAnswerType: null,
    });

    expect(state.updatePayload?.open_question_pending).toBe(true);
    expect(state.updatePayload?.open_question_expected_answer_type).toBe("proposal_yes_no");
  });

  it("weekly_sms source is stored as last_outbound_source", async () => {
    const result = await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_weekly",
      clerkUserId: "user_weekly",
      sentBody: "You showed up three times this week. What standard are you carrying into tomorrow?",
      sentAt: new Date("2026-05-18T17:00:00.000Z"),
      messageSid: "SM_WEEKLY_1",
      source: "weekly_sms",
      expectedAnswerType: null,
    });

    expect(result).toEqual({ ok: true });
    expect(state.insertPayload?.last_outbound_source).toBe("weekly_sms");
  });

  it("weekly sentBody without footer stores last_outbound_full_body without Reply STOP", async () => {
    await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_weekly",
      clerkUserId: "user_weekly",
      sentBody: "Where do you need to tell the truth before Monday?",
      sentAt: new Date("2026-05-18T17:00:00.000Z"),
      messageSid: "SM_WEEKLY_2",
      source: "weekly_sms",
      expectedAnswerType: null,
    });

    expect(state.insertPayload?.last_outbound_full_body).toMatch(/tell the truth/i);
    expect(state.insertPayload?.last_outbound_full_body).not.toMatch(/Reply STOP/i);
  });

  it("weekly reflection question sets open_question_pending and last_5_coach_questions", async () => {
    await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_weekly",
      clerkUserId: "user_weekly",
      sentBody: "What's one place you got back on track this week?",
      sentAt: new Date("2026-05-18T17:00:00.000Z"),
      messageSid: "SM_WEEKLY_3",
      source: "weekly_sms",
      expectedAnswerType: null,
    });

    expect(state.insertPayload?.open_question_pending).toBe(true);
    expect(state.insertPayload?.open_question_text).toMatch(/back on track/i);
    const questions = state.insertPayload?.last_5_coach_questions as { text: string; source: string }[];
    expect(questions.some((q) => /back on track/i.test(q.text) && q.source === "weekly_sms")).toBe(true);
    const dnr = state.insertPayload?.do_not_repeat_phrases as string[];
    expect(dnr.some((p) => /back on track/i.test(p))).toBe(true);
  });

  it("weekly body without a question does not force new open_question_pending", async () => {
    resetState({
      commitment_id: "cmt_weekly",
      clerk_user_id: "user_weekly",
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

    await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_weekly",
      clerkUserId: "user_weekly",
      sentBody: "You kept showing up through a noisy week. That matters.",
      sentAt: new Date("2026-05-18T17:00:00.000Z"),
      messageSid: "SM_WEEKLY_4",
      source: "weekly_sms",
      expectedAnswerType: null,
    });

    expect(state.updatePayload?.last_outbound_full_body).toContain("noisy week");
    expect(state.updatePayload?.open_question_pending).toBe(true);
    expect(state.updatePayload?.open_question_text).toBe("What story will you dictate today?");
  });

  it("weekly binding Reply YES phrase with expectedAnswerType null does not set open_question_pending", async () => {
    await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_weekly",
      clerkUserId: "user_weekly",
      sentBody: "Reply YES to confirm this tighter overlay?",
      sentAt: new Date("2026-05-18T17:00:00.000Z"),
      messageSid: "SM_WEEKLY_5",
      source: "weekly_sms",
      expectedAnswerType: null,
    });

    expect(state.insertPayload?.open_question_pending).toBe(false);
    expect(state.insertPayload?.open_question_text).toBeNull();
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

  function resetNormalOpenQuestionPendingRow() {
    resetState({
      commitment_id: "cmt_short",
      clerk_user_id: "user_short",
      projection_version: 1,
      open_question_text: "What knocked it off track?",
      open_question_pending: true,
      open_question_expected_answer_type: null,
      last_5_coach_questions: [],
      last_5_user_answers: [],
      do_not_repeat_phrases: [],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();
  }

  it("normal coaching one-word answer clears pending open question", async () => {
    resetNormalOpenQuestionPendingRow();
    await upsertCommitmentSmsThreadMemoryFromInbound({
      commitmentId: "cmt_short",
      clerkUserId: "user_short",
      inboundBody: "avoidance",
      inboundAt: new Date("2026-05-19T10:00:00.000Z"),
      messageSid: "SM_SHORT_1",
      routePurpose: "normal_inbound_reply",
    });
    expect(state.updatePayload?.open_question_pending).toBe(false);
    expect(state.updatePayload?.open_question_answer_text).toBe("avoidance");
    const answers = state.updatePayload?.last_5_user_answers as { text: string }[];
    expect(answers.some((a) => a.text === "avoidance")).toBe(true);
  });

  it("normal coaching two-word answer clears pending open question", async () => {
    resetNormalOpenQuestionPendingRow();
    await upsertCommitmentSmsThreadMemoryFromInbound({
      commitmentId: "cmt_short",
      clerkUserId: "user_short",
      inboundBody: "late night",
      inboundAt: new Date("2026-05-19T10:01:00.000Z"),
      messageSid: "SM_SHORT_2",
      routePurpose: "normal_inbound_reply",
    });
    expect(state.updatePayload?.open_question_pending).toBe(false);
    expect(state.updatePayload?.open_question_answer_text).toBe("late night");
  });

  it('normal coaching "done" clears pending open question', async () => {
    resetNormalOpenQuestionPendingRow();
    await upsertCommitmentSmsThreadMemoryFromInbound({
      commitmentId: "cmt_short",
      clerkUserId: "user_short",
      inboundBody: "done",
      inboundAt: new Date("2026-05-19T10:02:00.000Z"),
      messageSid: "SM_SHORT_3",
    });
    expect(state.updatePayload?.open_question_pending).toBe(false);
    expect(state.updatePayload?.open_question_answer_text).toBe("done");
  });

  it('normal coaching "not today" clears pending open question', async () => {
    resetNormalOpenQuestionPendingRow();
    await upsertCommitmentSmsThreadMemoryFromInbound({
      commitmentId: "cmt_short",
      clerkUserId: "user_short",
      inboundBody: "not today",
      inboundAt: new Date("2026-05-19T10:03:00.000Z"),
      messageSid: "SM_SHORT_4",
    });
    expect(state.updatePayload?.open_question_pending).toBe(false);
    expect(state.updatePayload?.open_question_answer_text).toBe("not today");
  });

  it("short acknowledgments do not clear pending open question", async () => {
    resetNormalOpenQuestionPendingRow();
    for (const body of ["ok", "got it", "thanks", "👍"]) {
      resetNormalOpenQuestionPendingRow();
      await upsertCommitmentSmsThreadMemoryFromInbound({
        commitmentId: "cmt_short",
        clerkUserId: "user_short",
        inboundBody: body,
        inboundAt: new Date("2026-05-19T10:04:00.000Z"),
        messageSid: `SM_ACK_${body}`,
      });
      expect(state.updatePayload).toBeNull();
      expect(state.row?.open_question_pending).toBe(true);
    }
  });

  it("compliance commands do not update projection row", async () => {
    resetNormalOpenQuestionPendingRow();
    for (const body of ["STOP", "HELP"]) {
      resetNormalOpenQuestionPendingRow();
      await upsertCommitmentSmsThreadMemoryFromInbound({
        commitmentId: "cmt_short",
        clerkUserId: "user_short",
        inboundBody: body,
        inboundAt: new Date("2026-05-19T10:05:00.000Z"),
        messageSid: `SM_CMD_${body}`,
      });
      expect(state.updatePayload).toBeNull();
      expect(state.row?.open_question_pending).toBe(true);
    }
  });

  it("yes/no/maybe do not clear pending via short-answer helper alone", async () => {
    resetNormalOpenQuestionPendingRow();
    for (const body of ["yes", "no", "maybe"]) {
      resetNormalOpenQuestionPendingRow();
      await upsertCommitmentSmsThreadMemoryFromInbound({
        commitmentId: "cmt_short",
        clerkUserId: "user_short",
        inboundBody: body,
        inboundAt: new Date("2026-05-19T10:06:00.000Z"),
        messageSid: `SM_YN_${body}`,
      });
      expect(state.updatePayload).toBeNull();
      expect(state.row?.open_question_pending).toBe(true);
    }
  });

  it("binding proposal_yes_no does not clear on short contextual answers", async () => {
    for (const body of ["avoidance", "late night", "done", "not today"]) {
      resetState({
        commitment_id: "cmt_bind_p",
        clerk_user_id: "user_bind",
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
        commitmentId: "cmt_bind_p",
        clerkUserId: "user_bind",
        inboundBody: body,
        inboundAt: new Date("2026-05-19T10:07:00.000Z"),
        messageSid: `SM_BIND_P_${body}`,
        routePurpose: "normal_inbound_reply",
      });
      expect(state.updatePayload?.open_question_pending).toBe(true);
      expect(state.updatePayload?.open_question_answer_text).toBeNull();
    }
  });

  it("binding contract_yes_no does not clear on short contextual answers", async () => {
    for (const body of ["avoidance", "late night"]) {
      resetState({
        commitment_id: "cmt_bind_c",
        clerk_user_id: "user_bind",
        projection_version: 1,
        open_question_text: "Reply YES to confirm this contract?",
        open_question_pending: true,
        open_question_expected_answer_type: "contract_yes_no",
        last_5_coach_questions: [],
        last_5_user_answers: [],
        do_not_repeat_phrases: [],
        recent_frustration_corrections: [],
      });
      installSupabaseMock();
      await upsertCommitmentSmsThreadMemoryFromInbound({
        commitmentId: "cmt_bind_c",
        clerkUserId: "user_bind",
        inboundBody: body,
        inboundAt: new Date("2026-05-19T10:08:00.000Z"),
        messageSid: `SM_BIND_C_${body}`,
        routePurpose: "normal_inbound_reply",
      });
      expect(state.updatePayload?.open_question_pending).toBe(true);
      expect(state.updatePayload?.open_question_answer_text).toBeNull();
    }
  });

  it("already told you does not become open_question_answer_text", async () => {
    resetState({
      commitment_id: "cmt_aty",
      clerk_user_id: "user_aty",
      projection_version: 1,
      open_question_text: "What knocked it off track?",
      open_question_pending: true,
      open_question_expected_answer_type: null,
      last_5_coach_questions: [],
      last_5_user_answers: [],
      do_not_repeat_phrases: [],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();
    await upsertCommitmentSmsThreadMemoryFromInbound({
      commitmentId: "cmt_aty",
      clerkUserId: "user_aty",
      inboundBody: "already told you",
      inboundAt: new Date("2026-05-19T10:09:00.000Z"),
      messageSid: "SM_ATY_1",
    });
    expect(state.updatePayload?.open_question_answer_text).toBeNull();
    expect(state.updatePayload?.open_question_pending).toBe(true);
    const corrections = state.updatePayload?.recent_frustration_corrections as { text: string }[];
    expect(corrections.some((c) => /already told you/i.test(c.text))).toBe(true);
  });
});

describe("inbound classification helpers", () => {
  it("isShortContextualOpenQuestionAnswer accepts normal short coaching answers", () => {
    expect(isShortContextualOpenQuestionAnswer("avoidance")).toBe(true);
    expect(isShortContextualOpenQuestionAnswer("late night")).toBe(true);
    expect(isShortContextualOpenQuestionAnswer("the farm")).toBe(true);
    expect(isShortContextualOpenQuestionAnswer("not today")).toBe(true);
    expect(isShortContextualOpenQuestionAnswer("done")).toBe(true);
    expect(isShortContextualOpenQuestionAnswer("I did it")).toBe(true);
  });

  it("isShortContextualOpenQuestionAnswer rejects acks commands and overloaded replies", () => {
    expect(isShortContextualOpenQuestionAnswer("")).toBe(false);
    expect(isShortContextualOpenQuestionAnswer("ok")).toBe(false);
    expect(isShortContextualOpenQuestionAnswer("got it")).toBe(false);
    expect(isShortContextualOpenQuestionAnswer("thanks")).toBe(false);
    expect(isShortContextualOpenQuestionAnswer("👍")).toBe(false);
    expect(isShortContextualOpenQuestionAnswer("STOP")).toBe(false);
    expect(isShortContextualOpenQuestionAnswer("yes")).toBe(false);
    expect(isShortContextualOpenQuestionAnswer("no")).toBe(false);
    expect(isShortContextualOpenQuestionAnswer("maybe")).toBe(false);
    expect(isShortContextualOpenQuestionAnswer("already told you")).toBe(false);
  });

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
