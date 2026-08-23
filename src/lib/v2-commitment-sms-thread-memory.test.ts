import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFrom = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: supabaseFrom },
}));

import {
  applySolAnsweredOpenCoachQuestion,
  bindingOpenQuestionAnswerAllowed,
  extractCoachQuestionFromOutboundBody,
  isAlreadyToldYouFrustrationInbound,
  isShortContextualOpenQuestionAnswer,
  isSubstantiveInboundForThreadMemory,
  loadV2CommitmentSmsThreadMemory,
  openCoachQuestionTextsMatch,
  OUTBOUND_THREAD_MEMORY_CLEAR_UPDATE_KEYS,
  OUTBOUND_THREAD_MEMORY_NEW_QUESTION_UPDATE_KEYS,
  OUTBOUND_THREAD_MEMORY_STATEMENT_UPDATE_KEYS,
  SOL_ANSWERED_OPEN_QUESTION_SOURCE,
  upsertCommitmentSmsThreadMemoryFromInbound,
  upsertCommitmentSmsThreadMemoryFromOutbound,
} from "@/lib/v2-commitment-sms-thread-memory";

function sortedKeys(obj: Record<string, unknown> | null | undefined) {
  return Object.keys(obj ?? {}).sort();
}

type TableState = {
  row: Record<string, unknown> | null;
  insertPayload: Record<string, unknown> | null;
  updatePayload: Record<string, unknown> | null;
  updateFilters: Array<[string, unknown]>;
  updateCalls: Array<{
    payload: Record<string, unknown>;
    filters: Array<[string, unknown]>;
    applied: boolean;
  }>;
  onBeforeUpdate: (() => void) | null;
};

let state: TableState;

function resetState(row: Record<string, unknown> | null = null) {
  state = {
    row,
    insertPayload: null,
    updatePayload: null,
    updateFilters: [],
    updateCalls: [],
    onBeforeUpdate: null,
  };
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
      update: (payload: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = [];
        const chain = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return chain;
          },
          select: () => chain,
          then: (
            onFulfilled?: (value: { data: Array<{ commitment_id: unknown }>; error: null }) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) => {
            state.onBeforeUpdate?.();
            state.updateFilters = filters;
            const matches =
              state.row != null &&
              filters.every(([column, value]) => state.row?.[column] === value);
            state.updateCalls.push({ payload, filters, applied: matches });
            if (!matches) {
              if (state.updateCalls.length === 1) state.updatePayload = null;
              return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
            }
            state.updatePayload = payload;
            state.row = { ...(state.row ?? {}), ...payload };
            return Promise.resolve({
              data: [{ commitment_id: state.row.commitment_id }],
              error: null,
            }).then(onFulfilled, onRejected);
          },
        };
        return chain;
      },
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
    expect(sortedKeys(state.updatePayload)).toEqual([...OUTBOUND_THREAD_MEMORY_STATEMENT_UPDATE_KEYS].sort());
    expect(state.updatePayload).not.toHaveProperty("open_question_text");
    expect(state.updatePayload).not.toHaveProperty("open_question_pending");
    expect(state.updatePayload).not.toHaveProperty("last_5_user_answers");
    expect(state.updatePayload?.last_outbound_full_body).toContain("keep going");
    expect(state.row?.open_question_text).toBe("What story will you dictate today?");
    expect(state.row?.open_question_pending).toBe(true);
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

    expect(sortedKeys(state.updatePayload)).toEqual(
      [...OUTBOUND_THREAD_MEMORY_NEW_QUESTION_UPDATE_KEYS].sort()
    );
    expect(state.updatePayload?.open_question_text).toMatch(/deep work tomorrow/i);
    expect(state.updatePayload?.open_question_pending).toBe(true);
    expect(state.updatePayload?.open_question_answer_text).toBeNull();
    expect(state.updatePayload?.open_question_answered_at).toBeNull();
    expect(state.updatePayload).not.toHaveProperty("last_5_user_answers");
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

    expect(state.updateCalls).toHaveLength(2);
    expect(sortedKeys(state.updateCalls[0]?.payload)).toEqual(
      [...OUTBOUND_THREAD_MEMORY_STATEMENT_UPDATE_KEYS].sort()
    );
    expect(sortedKeys(state.updateCalls[1]?.payload)).toEqual(
      [...OUTBOUND_THREAD_MEMORY_CLEAR_UPDATE_KEYS].sort()
    );
    expect(state.updateCalls[1]?.filters).toEqual(
      expect.arrayContaining([
        ["commitment_id", "cmt_ack"],
        ["open_question_pending", true],
        ["open_question_text", "Reply YES to accept this overlay?"],
        ["open_question_asked_at", "2026-05-17T12:00:00.000Z"],
      ])
    );
    expect(state.updateCalls[1]?.payload.open_question_pending).toBe(false);
    expect(state.updateCalls[1]?.payload.open_question_expected_answer_type).toBeNull();
    expect(state.updateCalls[1]?.payload.open_question_text).toBeNull();
    expect(state.updateCalls[0]?.payload.last_outbound_source).toBe("inbound_coach_reply");
    expect(state.updateCalls[0]?.payload).not.toHaveProperty("last_inbound_full_body");
    expect(state.updateCalls[0]?.payload).not.toHaveProperty("last_5_user_answers");
    expect(state.row?.last_inbound_full_body).toBe("yes");
    expect(state.row?.open_question_pending).toBe(false);
  });

  it("clearBindingOpenQuestion clears stale contract_yes_no pending", async () => {
    resetState({
      commitment_id: "cmt_ack_c",
      clerk_user_id: "user_ack",
      projection_version: 1,
      open_question_text: "Reply YES to confirm this contract?",
      open_question_pending: true,
      open_question_expected_answer_type: "contract_yes_no",
      open_question_asked_at: "2026-05-17T12:00:00.000Z",
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

    expect(state.updateCalls).toHaveLength(2);
    expect(state.updateCalls[1]?.applied).toBe(true);
    expect(state.updateCalls[1]?.payload.open_question_pending).toBe(false);
    expect(state.updateCalls[1]?.payload.open_question_expected_answer_type).toBeNull();
    expect(state.row?.open_question_pending).toBe(false);
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

    expect(state.updateCalls).toHaveLength(1);
    expect(sortedKeys(state.updatePayload)).toEqual(
      [...OUTBOUND_THREAD_MEMORY_NEW_QUESTION_UPDATE_KEYS].sort()
    );
    expect(state.updatePayload?.open_question_pending).toBe(true);
    expect(state.updatePayload?.open_question_expected_answer_type).toBeNull();
    expect(state.updatePayload?.open_question_text).toMatch(/got in the way/i);
    expect(state.updatePayload).not.toHaveProperty("last_5_user_answers");
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

    expect(sortedKeys(state.updatePayload)).toEqual([...OUTBOUND_THREAD_MEMORY_STATEMENT_UPDATE_KEYS].sort());
    expect(state.updatePayload).not.toHaveProperty("open_question_pending");
    expect(state.row?.open_question_pending).toBe(true);
    expect(state.row?.open_question_expected_answer_type).toBe("proposal_yes_no");
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
    expect(sortedKeys(state.updatePayload)).toEqual([...OUTBOUND_THREAD_MEMORY_STATEMENT_UPDATE_KEYS].sort());
    expect(state.updatePayload).not.toHaveProperty("open_question_pending");
    expect(state.updatePayload).not.toHaveProperty("open_question_text");
    expect(state.row?.open_question_pending).toBe(true);
    expect(state.row?.open_question_text).toBe("What story will you dictate today?");
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

  it("statement outbound does not resurrect a concurrent last-ask close", async () => {
    resetState({
      commitment_id: "cmt_race",
      clerk_user_id: "user_1",
      projection_version: 1,
      open_question_text: "How did the meeting go?",
      open_question_pending: true,
      open_question_asked_at: "2026-08-22T15:00:00.000Z",
      open_question_answer_text: null,
      open_question_answered_at: null,
      last_5_coach_questions: [],
      last_5_user_answers: [{ text: "OLD", answered_at: "2026-08-22T14:00:00.000Z", source: "inbound_sms", message_sid: "SMold" }],
      do_not_repeat_phrases: [],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    const human = "Yeah it went really well";
    const answeredAt = "2026-08-22T16:20:00.000Z";
    const newAnswers = [
      { text: "OLD", answered_at: "2026-08-22T14:00:00.000Z", source: "inbound_sms", message_sid: "SMold" },
      { text: human, answered_at: answeredAt, source: SOL_ANSWERED_OPEN_QUESTION_SOURCE, message_sid: "SMmeet" },
    ];
    state.onBeforeUpdate = () => {
      state.row = {
        ...(state.row ?? {}),
        open_question_pending: false,
        open_question_answer_text: human,
        open_question_answered_at: answeredAt,
        last_5_user_answers: newAnswers,
      };
    };

    const result = await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_race",
      clerkUserId: "user_1",
      sentBody: "Proud of you for walking in. Keep that standard.",
      sentAt: new Date("2026-08-22T16:21:00.000Z"),
      messageSid: "SMstmt",
      source: "inbound_coach_reply",
    });

    expect(result).toEqual({ ok: true });
    expect(state.updateCalls).toHaveLength(1);
    expect(sortedKeys(state.updateCalls[0]?.payload)).toEqual(
      [...OUTBOUND_THREAD_MEMORY_STATEMENT_UPDATE_KEYS].sort()
    );
    expect(state.updateCalls[0]?.payload).not.toHaveProperty("last_5_user_answers");
    expect(state.updateCalls[0]?.payload).not.toHaveProperty("open_question_pending");
    expect(state.row?.open_question_pending).toBe(false);
    expect(state.row?.open_question_answer_text).toBe(human);
    expect(state.row?.open_question_answered_at).toBe(answeredAt);
    expect(state.row?.last_5_user_answers).toEqual(newAnswers);
    expect(state.row?.last_outbound_message_sid).toBe("SMstmt");
  });

  it("new-question outbound installs Q2 without rewinding concurrent last_5_user_answers", async () => {
    resetState({
      commitment_id: "cmt_race",
      clerk_user_id: "user_1",
      projection_version: 1,
      open_question_text: "How did the meeting go?",
      open_question_pending: true,
      open_question_asked_at: "2026-08-22T15:00:00.000Z",
      last_5_coach_questions: [],
      last_5_user_answers: [{ text: "OLD", answered_at: "2026-08-22T14:00:00.000Z", source: "inbound_sms", message_sid: "SMold" }],
      do_not_repeat_phrases: [],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    const newAnswers = [
      {
        text: "Yeah it went really well",
        answered_at: "2026-08-22T16:20:00.000Z",
        source: SOL_ANSWERED_OPEN_QUESTION_SOURCE,
        message_sid: "SMmeet",
      },
    ];
    state.onBeforeUpdate = () => {
      state.row = {
        ...(state.row ?? {}),
        open_question_pending: false,
        open_question_answer_text: "Yeah it went really well",
        open_question_answered_at: "2026-08-22T16:20:00.000Z",
        last_5_user_answers: newAnswers,
      };
    };

    await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_race",
      clerkUserId: "user_1",
      sentBody: "What will you protect tomorrow?",
      sentAt: new Date("2026-08-22T16:22:00.000Z"),
      messageSid: "SMQ2",
      source: "daily_sms",
      expectedAnswerType: null,
    });

    expect(sortedKeys(state.updatePayload)).toEqual(
      [...OUTBOUND_THREAD_MEMORY_NEW_QUESTION_UPDATE_KEYS].sort()
    );
    expect(state.updatePayload).not.toHaveProperty("last_5_user_answers");
    expect(state.row?.open_question_text).toMatch(/protect tomorrow/i);
    expect(state.row?.open_question_pending).toBe(true);
    expect(state.row?.open_question_source_message_sid).toBe("SMQ2");
    expect(state.row?.open_question_answer_text).toBeNull();
    expect(state.row?.last_5_user_answers).toEqual(newAnswers);
  });

  it("stale Morning clear cannot wipe a newer Q2 generation and still records last_outbound", async () => {
    resetState({
      commitment_id: "cmt_race",
      clerk_user_id: "user_1",
      projection_version: 1,
      open_question_text: "How did the meeting go?",
      open_question_pending: true,
      open_question_asked_at: "2026-08-22T15:00:00.000Z",
      open_question_expected_answer_type: null,
      last_5_coach_questions: [],
      last_5_user_answers: [{ text: "HUMAN", answered_at: "2026-08-22T16:20:00.000Z", source: "inbound_sms", message_sid: "SMmeet" }],
      do_not_repeat_phrases: [],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    state.onBeforeUpdate = () => {
      state.row = {
        ...(state.row ?? {}),
        open_question_text: "What will you protect tomorrow?",
        open_question_pending: true,
        open_question_asked_at: "2026-08-22T16:22:00.000Z",
        open_question_source_message_sid: "SMQ2",
        open_question_expected_answer_type: null,
        open_question_answer_text: null,
        open_question_answered_at: null,
      };
    };

    await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_race",
      clerkUserId: "user_1",
      sentBody: "Good morning. Let's stay with the work.",
      sentAt: new Date("2026-08-23T12:00:00.000Z"),
      messageSid: "SMmorning",
      source: "daily_sms",
      clearBindingOpenQuestion: true,
    });

    expect(state.updateCalls[0]?.applied).toBe(true);
    expect(sortedKeys(state.updateCalls[0]?.payload)).toEqual(
      [...OUTBOUND_THREAD_MEMORY_STATEMENT_UPDATE_KEYS].sort()
    );
    expect(state.updateCalls[1]?.applied).toBe(false);
    expect(state.updateCalls[1]?.filters).toEqual(
      expect.arrayContaining([
        ["open_question_pending", true],
        ["open_question_text", "How did the meeting go?"],
        ["open_question_asked_at", "2026-08-22T15:00:00.000Z"],
      ])
    );
    expect(state.row?.open_question_text).toBe("What will you protect tomorrow?");
    expect(state.row?.open_question_pending).toBe(true);
    expect(state.row?.open_question_asked_at).toBe("2026-08-22T16:22:00.000Z");
    expect(state.row?.last_outbound_message_sid).toBe("SMmorning");
    expect(state.row?.last_5_user_answers).toEqual([
      { text: "HUMAN", answered_at: "2026-08-22T16:20:00.000Z", source: "inbound_sms", message_sid: "SMmeet" },
    ]);
  });

  it("clearBindingOpenQuestion fails closed when snapshot asked_at is missing", async () => {
    resetState({
      commitment_id: "cmt_ack_missing_at",
      clerk_user_id: "user_ack",
      projection_version: 1,
      open_question_text: "Reply YES to accept this overlay?",
      open_question_pending: true,
      open_question_expected_answer_type: "proposal_yes_no",
      open_question_asked_at: null,
      last_5_coach_questions: [],
      last_5_user_answers: [],
      do_not_repeat_phrases: [],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_ack_missing_at",
      clerkUserId: "user_ack",
      sentBody: "Got it — your adjusted ask is in effect for today.",
      sentAt: new Date("2026-05-18T12:00:00.000Z"),
      messageSid: "SM_ACK_NO_AT",
      source: "inbound_coach_reply",
      clearBindingOpenQuestion: true,
    });

    expect(state.updateCalls).toHaveLength(1);
    expect(sortedKeys(state.updateCalls[0]?.payload)).toEqual(
      [...OUTBOUND_THREAD_MEMORY_STATEMENT_UPDATE_KEYS].sort()
    );
    expect(state.row?.open_question_pending).toBe(true);
    expect(state.row?.open_question_text).toBe("Reply YES to accept this overlay?");
    expect(state.row?.last_outbound_message_sid).toBe("SM_ACK_NO_AT");
  });

  it("Morning statement with clearBindingOpenQuestion clears a fresh pending generation", async () => {
    resetState({
      commitment_id: "cmt_morn",
      clerk_user_id: "user_1",
      projection_version: 1,
      open_question_text: "How did the meeting go?",
      open_question_pending: true,
      open_question_asked_at: "2026-08-22T15:00:00.000Z",
      last_5_coach_questions: [],
      last_5_user_answers: [{ text: "keep this", answered_at: "2026-08-22T14:00:00.000Z", source: "inbound_sms", message_sid: "SMx" }],
      do_not_repeat_phrases: ["How did the meeting go?"],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_morn",
      clerkUserId: "user_1",
      sentBody: "Good morning. Stay with the work today.",
      sentAt: new Date("2026-08-23T12:00:00.000Z"),
      messageSid: "SMmorning2",
      source: "daily_sms",
      clearBindingOpenQuestion: true,
    });

    expect(state.row?.open_question_pending).toBe(false);
    expect(state.row?.open_question_text).toBeNull();
    expect(state.row?.last_5_user_answers).toEqual([
      { text: "keep this", answered_at: "2026-08-22T14:00:00.000Z", source: "inbound_sms", message_sid: "SMx" },
    ]);
    expect(state.row?.do_not_repeat_phrases).toEqual(["How did the meeting go?"]);
    expect(state.row?.last_outbound_source).toBe("daily_sms");
  });

  it("Evening statement with clearBindingOpenQuestion clears a fresh pending generation", async () => {
    resetState({
      commitment_id: "cmt_eve",
      clerk_user_id: "user_1",
      projection_version: 1,
      open_question_text: "How did the meeting go?",
      open_question_pending: true,
      open_question_asked_at: "2026-08-22T15:00:00.000Z",
      last_5_coach_questions: [],
      last_5_user_answers: [{ text: "keep this", answered_at: "2026-08-22T14:00:00.000Z", source: "inbound_sms", message_sid: "SMx" }],
      do_not_repeat_phrases: ["How did the meeting go?"],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_eve",
      clerkUserId: "user_1",
      sentBody: "Good evening. You kept the standard today.",
      sentAt: new Date("2026-08-23T23:00:00.000Z"),
      messageSid: "SMevening",
      source: "daily_sms",
      clearBindingOpenQuestion: true,
    });

    expect(state.updateCalls).toHaveLength(2);
    expect(state.row?.open_question_pending).toBe(false);
    expect(state.row?.open_question_text).toBeNull();
    expect(state.row?.last_5_user_answers).toEqual([
      { text: "keep this", answered_at: "2026-08-22T14:00:00.000Z", source: "inbound_sms", message_sid: "SMx" },
    ]);
    expect(state.row?.last_outbound_message_sid).toBe("SMevening");
  });

  it("Morning extracted question installs a new generation instead of clearing", async () => {
    resetState({
      commitment_id: "cmt_morn_q",
      clerk_user_id: "user_1",
      projection_version: 1,
      open_question_text: "How did the meeting go?",
      open_question_pending: true,
      open_question_asked_at: "2026-08-22T15:00:00.000Z",
      last_5_coach_questions: [],
      last_5_user_answers: [{ text: "keep this", answered_at: "2026-08-22T14:00:00.000Z", source: "inbound_sms", message_sid: "SMx" }],
      do_not_repeat_phrases: [],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_morn_q",
      clerkUserId: "user_1",
      sentBody: "Good morning. What will you protect today?",
      sentAt: new Date("2026-08-23T12:00:00.000Z"),
      messageSid: "SMmorningQ",
      source: "daily_sms",
      clearBindingOpenQuestion: true,
    });

    expect(state.updateCalls).toHaveLength(1);
    expect(sortedKeys(state.updatePayload)).toEqual(
      [...OUTBOUND_THREAD_MEMORY_NEW_QUESTION_UPDATE_KEYS].sort()
    );
    expect(state.row?.open_question_text).toMatch(/protect today/i);
    expect(state.row?.open_question_pending).toBe(true);
    expect(state.row?.last_5_user_answers).toEqual([
      { text: "keep this", answered_at: "2026-08-22T14:00:00.000Z", source: "inbound_sms", message_sid: "SMx" },
    ]);
  });

  it("Evening extracted question installs a new generation instead of clearing", async () => {
    resetState({
      commitment_id: "cmt_eve_q",
      clerk_user_id: "user_1",
      projection_version: 1,
      open_question_text: "How did the meeting go?",
      open_question_pending: true,
      open_question_asked_at: "2026-08-22T15:00:00.000Z",
      last_5_coach_questions: [],
      last_5_user_answers: [{ text: "keep this", answered_at: "2026-08-22T14:00:00.000Z", source: "inbound_sms", message_sid: "SMx" }],
      do_not_repeat_phrases: [],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_eve_q",
      clerkUserId: "user_1",
      sentBody: "Good evening. What got in the way today?",
      sentAt: new Date("2026-08-23T23:00:00.000Z"),
      messageSid: "SMeveningQ",
      source: "daily_sms",
      clearBindingOpenQuestion: true,
    });

    expect(state.updateCalls).toHaveLength(1);
    expect(sortedKeys(state.updatePayload)).toEqual(
      [...OUTBOUND_THREAD_MEMORY_NEW_QUESTION_UPDATE_KEYS].sort()
    );
    expect(state.row?.open_question_text).toMatch(/got in the way/i);
    expect(state.row?.open_question_pending).toBe(true);
    expect(state.row?.last_5_user_answers).toEqual([
      { text: "keep this", answered_at: "2026-08-22T14:00:00.000Z", source: "inbound_sms", message_sid: "SMx" },
    ]);
  });

  it("INSERT statement first outbound creates a coherent row without a question generation", async () => {
    const result = await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_insert_stmt",
      clerkUserId: "user_1",
      sentBody: "Proud of you for walking in. Keep that standard.",
      sentAt: new Date("2026-08-23T12:00:00.000Z"),
      messageSid: "SMinsert",
      source: "inbound_coach_reply",
    });

    expect(result).toEqual({ ok: true });
    expect(state.insertPayload?.open_question_pending).toBe(false);
    expect(state.insertPayload?.open_question_text).toBeNull();
    expect(state.insertPayload?.last_5_user_answers).toEqual([]);
    expect(state.insertPayload?.last_5_coach_questions).toEqual([]);
    expect(state.insertPayload?.do_not_repeat_phrases).toEqual([]);
    expect(state.insertPayload?.projection_version).toBe(1);
    expect(state.insertPayload?.last_outbound_message_sid).toBe("SMinsert");
    expect(state.insertPayload).toHaveProperty("created_at");
    expect(state.updatePayload).toBeNull();
  });

  it("weekly statement does not rewind concurrent last_5_user_answers", async () => {
    resetState({
      commitment_id: "cmt_weekly",
      clerk_user_id: "user_weekly",
      projection_version: 1,
      open_question_text: "What story will you dictate today?",
      open_question_pending: false,
      open_question_answer_text: "HUMAN",
      open_question_answered_at: "2026-08-22T16:20:00.000Z",
      last_5_coach_questions: [],
      last_5_user_answers: [{ text: "OLD", answered_at: "2026-08-22T14:00:00.000Z", source: "inbound_sms", message_sid: "SMold" }],
      do_not_repeat_phrases: [],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    const newAnswers = [
      {
        text: "Yeah it went really well",
        answered_at: "2026-08-22T16:20:00.000Z",
        source: SOL_ANSWERED_OPEN_QUESTION_SOURCE,
        message_sid: "SMmeet",
      },
    ];
    state.onBeforeUpdate = () => {
      state.row = {
        ...(state.row ?? {}),
        last_5_user_answers: newAnswers,
      };
    };

    await upsertCommitmentSmsThreadMemoryFromOutbound({
      commitmentId: "cmt_weekly",
      clerkUserId: "user_weekly",
      sentBody: "You kept showing up through a noisy week. That matters.",
      sentAt: new Date("2026-08-23T17:00:00.000Z"),
      messageSid: "SM_WEEKLY_6",
      source: "weekly_sms",
      expectedAnswerType: null,
    });

    expect(sortedKeys(state.updatePayload)).toEqual([...OUTBOUND_THREAD_MEMORY_STATEMENT_UPDATE_KEYS].sort());
    expect(state.updatePayload).not.toHaveProperty("last_5_user_answers");
    expect(state.updatePayload).not.toHaveProperty("open_question_pending");
    expect(state.row?.last_5_user_answers).toEqual(newAnswers);
    expect(state.row?.open_question_answer_text).toBe("HUMAN");
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

  it("records last inbound without treating generic substantive text as the open-question answer", async () => {
    resetState({
      commitment_id: "cmt_1",
      clerk_user_id: "user_1",
      projection_version: 1,
      open_question_text: "What story will you dictate today?",
      open_question_pending: true,
      open_question_expected_answer_type: "future_plan_story_title",
      last_5_coach_questions: [],
      last_5_user_answers: [],
      do_not_repeat_phrases: ["What story will you dictate today?"],
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
    expect(state.updatePayload?.open_question_pending).toBe(true);
    expect(state.updatePayload?.open_question_answer_text).toBeNull();
    expect(state.updatePayload?.open_question_answered_at).toBeNull();
    expect(state.updatePayload?.last_inbound_full_body).toContain("Sunday School");
    expect(state.updatePayload?.do_not_repeat_phrases).toEqual([
      "What story will you dictate today?",
    ]);
  });

  it("generic last-ask: photo-answer text does not close an unrelated pending Coach question", async () => {
    resetState({
      commitment_id: "cmt_meeting",
      clerk_user_id: "user_1",
      projection_version: 1,
      open_question_text: "How did the meeting go?",
      open_question_pending: true,
      open_question_expected_answer_type: null,
      last_5_coach_questions: [],
      last_5_user_answers: [],
      do_not_repeat_phrases: ["How did the meeting go?"],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    await upsertCommitmentSmsThreadMemoryFromInbound({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      inboundBody: "Taking Lakelyn to her first dance class.",
      inboundAt: new Date("2026-08-22T16:10:00.000Z"),
      messageSid: "SMlake",
      routePurpose: "normal_inbound_reply",
    });

    expect(state.updatePayload?.open_question_pending).toBe(true);
    expect(state.updatePayload?.open_question_answer_text).toBeNull();
    expect(state.updatePayload?.open_question_text).toBe("How did the meeting go?");
    expect(state.updatePayload?.do_not_repeat_phrases).toEqual(["How did the meeting go?"]);
  });

  it("direct unrelated question does not close a pending non-binding open question", async () => {
    resetState({
      commitment_id: "cmt_tenn",
      clerk_user_id: "user_1",
      projection_version: 1,
      open_question_text: "How did the meeting go?",
      open_question_pending: true,
      open_question_expected_answer_type: null,
      last_5_coach_questions: [],
      last_5_user_answers: [],
      do_not_repeat_phrases: ["How did the meeting go?"],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    await upsertCommitmentSmsThreadMemoryFromInbound({
      commitmentId: "cmt_tenn",
      clerkUserId: "user_1",
      inboundBody: "What time does Tennessee play?",
      inboundAt: new Date("2026-08-22T16:12:00.000Z"),
      messageSid: "SMtenn",
      routePurpose: "normal_inbound_reply",
    });

    expect(state.updatePayload?.open_question_pending).toBe(true);
    expect(state.updatePayload?.open_question_answer_text).toBeNull();
  });

  it("goal-change heuristic text does not close an unrelated non-binding open question", async () => {
    resetState({
      commitment_id: "cmt_goal",
      clerk_user_id: "user_1",
      projection_version: 1,
      open_question_text: "How did the meeting go?",
      open_question_pending: true,
      open_question_expected_answer_type: null,
      last_5_coach_questions: [],
      last_5_user_answers: [],
      do_not_repeat_phrases: [],
      recent_frustration_corrections: [],
    });
    installSupabaseMock();

    await upsertCommitmentSmsThreadMemoryFromInbound({
      commitmentId: "cmt_goal",
      clerkUserId: "user_1",
      inboundBody: "I want to change my goal",
      inboundAt: new Date("2026-08-22T16:13:00.000Z"),
      messageSid: "SMgoal",
      routePurpose: "normal_inbound_reply",
    });

    expect(state.updatePayload?.open_question_pending).toBe(true);
    expect(state.updatePayload?.open_question_answer_text).toBeNull();
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

  it("normal coaching one-word answer stays pending until Sol-authored apply", async () => {
    resetNormalOpenQuestionPendingRow();
    await upsertCommitmentSmsThreadMemoryFromInbound({
      commitmentId: "cmt_short",
      clerkUserId: "user_short",
      inboundBody: "avoidance",
      inboundAt: new Date("2026-05-19T10:00:00.000Z"),
      messageSid: "SM_SHORT_1",
      routePurpose: "normal_inbound_reply",
    });
    expect(state.updatePayload?.open_question_pending).toBe(true);
    expect(state.updatePayload?.open_question_answer_text).toBeNull();
  });

  it("normal coaching two-word answer stays pending until Sol-authored apply", async () => {
    resetNormalOpenQuestionPendingRow();
    await upsertCommitmentSmsThreadMemoryFromInbound({
      commitmentId: "cmt_short",
      clerkUserId: "user_short",
      inboundBody: "late night",
      inboundAt: new Date("2026-05-19T10:01:00.000Z"),
      messageSid: "SM_SHORT_2",
      routePurpose: "normal_inbound_reply",
    });
    expect(state.updatePayload?.open_question_pending).toBe(true);
    expect(state.updatePayload?.open_question_answer_text).toBeNull();
  });

  it('normal coaching "done" stays pending until Sol-authored apply', async () => {
    resetNormalOpenQuestionPendingRow();
    await upsertCommitmentSmsThreadMemoryFromInbound({
      commitmentId: "cmt_short",
      clerkUserId: "user_short",
      inboundBody: "done",
      inboundAt: new Date("2026-05-19T10:02:00.000Z"),
      messageSid: "SM_SHORT_3",
    });
    expect(state.updatePayload?.open_question_pending).toBe(true);
    expect(state.updatePayload?.open_question_answer_text).toBeNull();
  });

  it('normal coaching "not today" stays pending until Sol-authored apply', async () => {
    resetNormalOpenQuestionPendingRow();
    await upsertCommitmentSmsThreadMemoryFromInbound({
      commitmentId: "cmt_short",
      clerkUserId: "user_short",
      inboundBody: "not today",
      inboundAt: new Date("2026-05-19T10:03:00.000Z"),
      messageSid: "SM_SHORT_4",
    });
    expect(state.updatePayload?.open_question_pending).toBe(true);
    expect(state.updatePayload?.open_question_answer_text).toBeNull();
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

  it("V3 exclusive open_question_answer lane still records a non-binding answer", async () => {
    resetState({
      commitment_id: "cmt_v3",
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

    await upsertCommitmentSmsThreadMemoryFromInbound({
      commitmentId: "cmt_v3",
      clerkUserId: "user_1",
      inboundBody: "Sunday School lesson on patience",
      inboundAt: new Date("2026-05-18T12:05:00.000Z"),
      messageSid: "SM_V3_1",
      classification: "user_yes",
      routePurpose: "open_question_answer",
    });

    expect(state.updatePayload?.open_question_pending).toBe(false);
    expect(state.updatePayload?.open_question_answer_text).toBe("Sunday School lesson on patience");
  });

  it("binding proposal_yes_no still records answer on consent-safe yes", async () => {
    resetState({
      commitment_id: "cmt_bind_yes",
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
      commitmentId: "cmt_bind_yes",
      clerkUserId: "user_bind",
      inboundBody: "Yes I accept this overlay",
      inboundAt: new Date("2026-05-19T10:10:00.000Z"),
      messageSid: "SM_BIND_YES",
      classification: "user_yes",
      routePurpose: "adaptive_proposal_consent_accept",
    });

    expect(state.updatePayload?.open_question_pending).toBe(false);
    expect(state.updatePayload?.open_question_answer_text).toBe("Yes I accept this overlay");
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

function meetingQuestionRow(overrides: Record<string, unknown> = {}) {
  return {
    commitment_id: "cmt_meeting",
    clerk_user_id: "user_1",
    projection_version: 1,
    open_question_text: "How did the meeting go?",
    open_question_pending: true,
    open_question_expected_answer_type: null,
    open_question_asked_at: "2026-08-22T15:00:00.000Z",
    last_5_coach_questions: [],
    last_5_user_answers: [],
    do_not_repeat_phrases: ["How did the meeting go?"],
    recent_frustration_corrections: [],
    last_inbound_full_body: "Taking Lakelyn to her first dance class.",
    last_inbound_message_sid: "SMlake",
    ...overrides,
  };
}

describe("applySolAnsweredOpenCoachQuestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState(meetingQuestionRow());
    installSupabaseMock();
  });

  const meetingAskedAt = "2026-08-22T15:00:00.000Z";
  const expectedMeeting = {
    text: "How did the meeting go?",
    pending: true,
    expected_answer_type: null as string | null,
    asked_at: meetingAskedAt,
  };

  it("closes a pending non-binding question when Sol question text matches", async () => {
    const humanText = "Yeah it was pretty good actually";
    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMmeet",
      expectedOpenQuestion: expectedMeeting,
      answeredQuestion: {
        question: "How did the meeting go?",
        answer: "The meeting went well.",
      },
      canonicalHumanTurnText: humanText,
      answeredAt: new Date("2026-08-22T16:20:00.000Z"),
    });

    expect(result).toEqual({ ok: true, applied: true });
    expect(state.updatePayload?.open_question_pending).toBe(false);
    expect(state.updatePayload?.open_question_answer_text).toBe(humanText);
    expect(state.updatePayload?.open_question_answer_text).not.toBe("The meeting went well.");
    expect(state.updateFilters).toEqual(
      expect.arrayContaining([
        ["commitment_id", "cmt_meeting"],
        ["clerk_user_id", "user_1"],
        ["open_question_pending", true],
        ["open_question_text", "How did the meeting go?"],
        ["open_question_asked_at", meetingAskedAt],
      ])
    );
    expect(Object.keys(state.updatePayload ?? {}).sort()).toEqual(
      [
        "last_5_user_answers",
        "open_question_answer_text",
        "open_question_answered_at",
        "open_question_pending",
        "updated_at",
      ].sort()
    );
    expect(state.updatePayload).not.toHaveProperty("do_not_repeat_phrases");
    expect(state.updatePayload).not.toHaveProperty("last_outbound_full_body");
    expect(state.updatePayload).not.toHaveProperty("last_5_coach_questions");
    const answers = state.updatePayload?.last_5_user_answers as {
      text: string;
      source: string;
      message_sid: string | null;
    }[];
    expect(answers.some((a) => a.source === SOL_ANSWERED_OPEN_QUESTION_SOURCE && a.text === humanText)).toBe(
      true
    );
    expect(answers.some((a) => a.text === "The meeting went well.")).toBe(false);
  });

  it("does not close when Sol answered_question is null", async () => {
    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMlake",
      expectedOpenQuestion: expectedMeeting,
      answeredQuestion: null,
      canonicalHumanTurnText: "Taking Lakelyn to her first dance class.",
    });
    expect(result).toEqual({ ok: true, applied: false, reason: "no_answered_question" });
    expect(state.updatePayload).toBeNull();
    expect(state.row?.open_question_pending).toBe(true);
  });

  it("does not close when Sol reports a different question", async () => {
    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMlake",
      expectedOpenQuestion: expectedMeeting,
      answeredQuestion: {
        question: "What made this one a win for you?",
        answer: "Taking Lakelyn to her first dance class.",
      },
      canonicalHumanTurnText: "Taking Lakelyn to her first dance class.",
    });
    expect(result).toEqual({ ok: true, applied: false, reason: "question_mismatch" });
    expect(state.updatePayload).toBeNull();
    expect(state.row?.open_question_pending).toBe(true);
  });

  it("does not close a newer pending question on same-SID retry", async () => {
    resetState(
      meetingQuestionRow({
        open_question_text: "What will you protect tomorrow?",
        open_question_pending: true,
        last_5_user_answers: [
          {
            text: "The meeting went really well.",
            answered_at: "2026-08-22T16:20:00.000Z",
            source: SOL_ANSWERED_OPEN_QUESTION_SOURCE,
            message_sid: "SMmeet",
          },
        ],
      })
    );
    installSupabaseMock();

    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMmeet",
      expectedOpenQuestion: {
        text: "How did the meeting go?",
        pending: true,
        expected_answer_type: null,
        asked_at: meetingAskedAt,
      },
      answeredQuestion: {
        question: "How did the meeting go?",
        answer: "The meeting went really well.",
      },
      canonicalHumanTurnText: "The meeting went really well.",
    });

    expect(result).toEqual({ ok: true, applied: false, reason: "already_applied_this_turn" });
    expect(state.updatePayload).toBeNull();
    expect(state.row?.open_question_text).toBe("What will you protect tomorrow?");
    expect(state.row?.open_question_pending).toBe(true);
  });

  it("does not close binding expected-answer types", async () => {
    resetState(
      meetingQuestionRow({
        open_question_text: "Reply YES to accept this overlay?",
        open_question_expected_answer_type: "proposal_yes_no",
      })
    );
    installSupabaseMock();

    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMbind",
      expectedOpenQuestion: {
        text: "Reply YES to accept this overlay?",
        pending: true,
        expected_answer_type: "proposal_yes_no",
      },
      answeredQuestion: {
        question: "Reply YES to accept this overlay?",
        answer: "Yes I accept this overlay",
      },
      canonicalHumanTurnText: "Yes I accept this overlay",
    });

    expect(result).toEqual({ ok: true, applied: false, reason: "binding" });
    expect(state.updatePayload).toBeNull();
  });

  it("matches trimmed whitespace and case only", () => {
    expect(openCoachQuestionTextsMatch("How did the meeting go?", "  how did the meeting go?  ")).toBe(
      true
    );
    expect(
      openCoachQuestionTextsMatch("How did the meeting go?", "What made this one a win for you?")
    ).toBe(false);
  });

  it("does not close when Sol answered_question is unknown", async () => {
    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMunk",
      expectedOpenQuestion: expectedMeeting,
      answeredQuestion: "unknown",
      canonicalHumanTurnText: "Yeah it was pretty good actually",
    });
    expect(result).toEqual({ ok: true, applied: false, reason: "unknown" });
    expect(state.updatePayload).toBeNull();
    expect(state.row?.open_question_pending).toBe(true);
  });

  it("does not close when Sol paraphrases the server question identity", async () => {
    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMpara",
      expectedOpenQuestion: expectedMeeting,
      answeredQuestion: {
        question: "How did your meeting go?",
        answer: "Yeah it was pretty good actually",
      },
      canonicalHumanTurnText: "Yeah it was pretty good actually",
    });
    expect(result).toEqual({ ok: true, applied: false, reason: "question_mismatch" });
    expect(state.updatePayload).toBeNull();
    expect(state.row?.open_question_pending).toBe(true);
  });

  it("leaves Q1 pending when Sol reports a different exact-thread Coach question", async () => {
    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMqx",
      expectedOpenQuestion: expectedMeeting,
      answeredQuestion: {
        question: "What will you protect tomorrow?",
        answer: "The first 30 minutes before email.",
      },
      canonicalHumanTurnText: "The first 30 minutes before email.",
    });
    expect(result).toEqual({ ok: true, applied: false, reason: "question_mismatch" });
    expect(state.updatePayload).toBeNull();
    expect(state.row?.open_question_text).toBe("How did the meeting go?");
    expect(state.row?.open_question_pending).toBe(true);
    expect(state.row?.open_question_answer_text).toBeUndefined();
  });

  it("persists coalesced human turn text, not an individual SID body or Sol paraphrase", async () => {
    const coalesced = "I took Lakelyn to her first dance class.";
    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMpart3",
      expectedOpenQuestion: expectedMeeting,
      answeredQuestion: {
        question: "How did the meeting go?",
        answer: "Lakelyn's first dance class.",
      },
      canonicalHumanTurnText: coalesced,
    });
    expect(result).toEqual({ ok: true, applied: true });
    expect(state.updatePayload?.open_question_answer_text).toBe(coalesced);
    expect(state.updatePayload?.open_question_answer_text).not.toBe("I took Lakelyn");
    expect(state.updatePayload?.open_question_answer_text).not.toBe("Lakelyn's first dance class.");
    const answers = state.updatePayload?.last_5_user_answers as { text: string; message_sid: string | null }[];
    expect(answers.filter((a) => a.text === coalesced)).toHaveLength(1);
    expect(answers[answers.length - 1]?.message_sid).toBe("SMpart3");
  });

  it("dedupes last_5 when the human turn was already recorded pre-Sol", async () => {
    const humanText = "Yeah it was pretty good actually";
    resetState(
      meetingQuestionRow({
        last_5_user_answers: [
          {
            text: humanText,
            answered_at: "2026-08-22T16:19:00.000Z",
            source: "inbound_sms",
            message_sid: "SMmeet",
          },
        ],
      })
    );
    installSupabaseMock();

    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMmeet",
      expectedOpenQuestion: expectedMeeting,
      answeredQuestion: {
        question: "How did the meeting go?",
        answer: "The meeting went well.",
      },
      canonicalHumanTurnText: humanText,
    });

    expect(result).toEqual({ ok: true, applied: true });
    const answers = state.updatePayload?.last_5_user_answers as { text: string; source: string }[];
    expect(answers.filter((a) => a.text === humanText)).toHaveLength(1);
    expect(answers.some((a) => a.source === SOL_ANSWERED_OPEN_QUESTION_SOURCE && a.text === humanText)).toBe(
      true
    );
    expect(answers.some((a) => a.text === "The meeting went well.")).toBe(false);
  });

  it("Q1→Q2 race: final CAS includes stored question text and does not apply", async () => {
    state.onBeforeUpdate = () => {
      state.row = meetingQuestionRow({
        open_question_text: "What will you protect tomorrow?",
        open_question_pending: true,
        open_question_answer_text: null,
      });
    };

    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMmeet",
      expectedOpenQuestion: expectedMeeting,
      answeredQuestion: {
        question: "How did the meeting go?",
        answer: "The meeting went well.",
      },
      canonicalHumanTurnText: "Yeah it was pretty good actually",
    });

    expect(result).toEqual({ ok: true, applied: false, reason: "cas_miss" });
    expect(state.updatePayload).toBeNull();
    expect(state.updateFilters).toEqual(
      expect.arrayContaining([
        ["commitment_id", "cmt_meeting"],
        ["clerk_user_id", "user_1"],
        ["open_question_pending", true],
        ["open_question_text", "How did the meeting go?"],
        ["open_question_asked_at", meetingAskedAt],
      ])
    );
    expect(state.row?.open_question_text).toBe("What will you protect tomorrow?");
    expect(state.row?.open_question_pending).toBe(true);
    expect(state.row?.open_question_answer_text).toBeNull();
  });

  it("zero-row stale CAS is not reported as applied", async () => {
    state.onBeforeUpdate = () => {
      state.row = meetingQuestionRow({
        open_question_pending: false,
        open_question_answer_text: "already closed elsewhere",
      });
    };

    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMstale",
      expectedOpenQuestion: expectedMeeting,
      answeredQuestion: {
        question: "How did the meeting go?",
        answer: "The meeting went well.",
      },
      canonicalHumanTurnText: "Yeah it was pretty good actually",
    });

    expect(result).toEqual({ ok: true, applied: false, reason: "cas_miss" });
    expect(state.updatePayload).toBeNull();
    expect(state.row?.open_question_pending).toBe(false);
    expect(state.row?.open_question_answer_text).toBe("already closed elsewhere");
  });

  it("does not clobber concurrent outbound thread-memory fields on close", async () => {
    const humanText = "Yeah it was pretty good actually";
    resetState(
      meetingQuestionRow({
        last_outbound_full_body: "OLD_OUTBOUND",
        last_outbound_sent_at: "2026-08-22T14:00:00.000Z",
        last_outbound_message_sid: "SMold",
        last_5_coach_questions: [{ text: "OLD_Q", asked_at: "2026-08-22T14:00:00.000Z" }],
        do_not_repeat_phrases: ["OLD_DNR"],
      })
    );
    installSupabaseMock();

    const concurrentOutbound = {
      last_outbound_full_body: "NEW_OUTBOUND",
      last_outbound_sent_at: "2026-08-22T16:19:00.000Z",
      last_outbound_message_sid: "SMnew",
      last_5_coach_questions: [{ text: "NEW_Q", asked_at: "2026-08-22T16:19:00.000Z" }],
      do_not_repeat_phrases: ["NEW_DNR"],
    };

    state.onBeforeUpdate = () => {
      state.row = {
        ...(state.row ?? {}),
        ...concurrentOutbound,
        open_question_text: "How did the meeting go?",
        open_question_pending: true,
      };
    };

    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMmeet",
      expectedOpenQuestion: expectedMeeting,
      answeredQuestion: {
        question: "How did the meeting go?",
        answer: "The meeting went well.",
      },
      canonicalHumanTurnText: humanText,
      answeredAt: new Date("2026-08-22T16:20:00.000Z"),
    });

    expect(result).toEqual({ ok: true, applied: true });
    expect(Object.keys(state.updatePayload ?? {}).sort()).toEqual(
      [
        "last_5_user_answers",
        "open_question_answer_text",
        "open_question_answered_at",
        "open_question_pending",
        "updated_at",
      ].sort()
    );
    expect(state.updatePayload).not.toHaveProperty("last_outbound_full_body");
    expect(state.updatePayload).not.toHaveProperty("last_outbound_sent_at");
    expect(state.updatePayload).not.toHaveProperty("last_outbound_message_sid");
    expect(state.updatePayload).not.toHaveProperty("last_5_coach_questions");
    expect(state.updatePayload).not.toHaveProperty("do_not_repeat_phrases");
    expect(state.updatePayload).not.toHaveProperty("open_question_text");
    expect(state.updatePayload).not.toHaveProperty("open_question_asked_at");
    expect(state.updatePayload).not.toHaveProperty("open_question_source_message_sid");
    expect(state.updatePayload).not.toHaveProperty("open_question_expected_answer_type");
    expect(state.updatePayload?.open_question_pending).toBe(false);
    expect(state.updatePayload?.open_question_answer_text).toBe(humanText);
    expect(state.updatePayload?.open_question_answered_at).toBe("2026-08-22T16:20:00.000Z");
    const answers = state.updatePayload?.last_5_user_answers as { text: string; source: string }[];
    expect(answers.some((a) => a.source === SOL_ANSWERED_OPEN_QUESTION_SOURCE && a.text === humanText)).toBe(
      true
    );
    expect(state.row?.open_question_pending).toBe(false);
    expect(state.row?.open_question_answer_text).toBe(humanText);
    expect(state.row?.last_outbound_full_body).toBe("NEW_OUTBOUND");
    expect(state.row?.last_outbound_sent_at).toBe("2026-08-22T16:19:00.000Z");
    expect(state.row?.last_outbound_message_sid).toBe("SMnew");
    expect(state.row?.last_5_coach_questions).toEqual(concurrentOutbound.last_5_coach_questions);
    expect(state.row?.do_not_repeat_phrases).toEqual(["NEW_DNR"]);
  });

  it("refuses to apply when packet asked_at is missing and does not fall back to text-only close", async () => {
    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMmeet",
      expectedOpenQuestion: {
        text: "How did the meeting go?",
        pending: true,
        expected_answer_type: null,
        asked_at: null,
      },
      answeredQuestion: {
        question: "How did the meeting go?",
        answer: "The meeting went well.",
      },
      canonicalHumanTurnText: "Yeah it was pretty good actually",
    });

    expect(result).toEqual({ ok: true, applied: false, reason: "missing_question_generation" });
    expect(state.updatePayload).toBeNull();
    expect(state.row?.open_question_pending).toBe(true);
    expect(state.row?.open_question_answer_text).toBeUndefined();
    expect(state.row?.last_5_user_answers).toEqual([]);
  });

  it("refuses to apply when packet asked_at is empty or whitespace", async () => {
    for (const asked_at of ["", "   "]) {
      resetState(meetingQuestionRow());
      installSupabaseMock();
      const result = await applySolAnsweredOpenCoachQuestion({
        commitmentId: "cmt_meeting",
        clerkUserId: "user_1",
        messageSid: "SMmeet",
        expectedOpenQuestion: {
          text: "How did the meeting go?",
          pending: true,
          expected_answer_type: null,
          asked_at,
        },
        answeredQuestion: {
          question: "How did the meeting go?",
          answer: "The meeting went well.",
        },
        canonicalHumanTurnText: "Yeah it was pretty good actually",
      });
      expect(result).toEqual({ ok: true, applied: false, reason: "missing_question_generation" });
      expect(state.updatePayload).toBeNull();
      expect(state.row?.open_question_pending).toBe(true);
    }
  });

  it("does not close a newer identical-text generation seen on live re-read", async () => {
    const laterAskedAt = "2026-08-22T16:22:00.000Z";
    resetState(
      meetingQuestionRow({
        open_question_text: "How did the meeting go?",
        open_question_pending: true,
        open_question_asked_at: laterAskedAt,
        last_5_user_answers: [{ text: "keep me", answered_at: "2026-08-22T16:20:00.000Z", source: "inbound_sms", message_sid: "SMkeep" }],
      })
    );
    installSupabaseMock();

    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMmeet",
      expectedOpenQuestion: expectedMeeting,
      answeredQuestion: {
        question: "How did the meeting go?",
        answer: "The meeting went well.",
      },
      canonicalHumanTurnText: "Yeah it was pretty good actually",
    });

    expect(result).toEqual({ ok: true, applied: false, reason: "generation_mismatch" });
    expect(state.updatePayload).toBeNull();
    expect(state.row?.open_question_pending).toBe(true);
    expect(state.row?.open_question_text).toBe("How did the meeting go?");
    expect(state.row?.open_question_asked_at).toBe(laterAskedAt);
    expect(state.row?.open_question_answer_text).toBeUndefined();
    expect(state.row?.last_5_user_answers).toEqual([
      { text: "keep me", answered_at: "2026-08-22T16:20:00.000Z", source: "inbound_sms", message_sid: "SMkeep" },
    ]);
  });

  it("does not close a distinct-text Q2 seen on live re-read", async () => {
    resetState(
      meetingQuestionRow({
        open_question_text: "What will you protect tomorrow?",
        open_question_pending: true,
        open_question_asked_at: "2026-08-22T16:22:00.000Z",
      })
    );
    installSupabaseMock();

    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMmeet",
      expectedOpenQuestion: expectedMeeting,
      answeredQuestion: {
        question: "How did the meeting go?",
        answer: "The meeting went well.",
      },
      canonicalHumanTurnText: "Yeah it was pretty good actually",
    });

    expect(result).toEqual({ ok: true, applied: false, reason: "snapshot_mismatch" });
    expect(state.updatePayload).toBeNull();
    expect(state.row?.open_question_pending).toBe(true);
    expect(state.row?.open_question_text).toBe("What will you protect tomorrow?");
    expect(state.row?.open_question_asked_at).toBe("2026-08-22T16:22:00.000Z");
  });

  it("identical-text Q2 after re-read and before UPDATE loses the CAS and does not apply", async () => {
    const laterAskedAt = "2026-08-22T16:22:00.000Z";
    state.onBeforeUpdate = () => {
      state.row = meetingQuestionRow({
        open_question_text: "How did the meeting go?",
        open_question_pending: true,
        open_question_asked_at: laterAskedAt,
        open_question_answer_text: null,
        last_5_user_answers: [{ text: "keep me", answered_at: "2026-08-22T16:20:00.000Z", source: "inbound_sms", message_sid: "SMkeep" }],
      });
    };

    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMmeet",
      expectedOpenQuestion: expectedMeeting,
      answeredQuestion: {
        question: "How did the meeting go?",
        answer: "The meeting went well.",
      },
      canonicalHumanTurnText: "Yeah it was pretty good actually",
    });

    expect(result).toEqual({ ok: true, applied: false, reason: "cas_miss" });
    expect(state.updatePayload).toBeNull();
    expect(state.updateFilters).toEqual(
      expect.arrayContaining([
        ["open_question_pending", true],
        ["open_question_text", "How did the meeting go?"],
        ["open_question_asked_at", meetingAskedAt],
      ])
    );
    expect(state.row?.open_question_pending).toBe(true);
    expect(state.row?.open_question_text).toBe("How did the meeting go?");
    expect(state.row?.open_question_asked_at).toBe(laterAskedAt);
    expect(state.row?.open_question_answer_text).toBeNull();
    expect(state.row?.last_5_user_answers).toEqual([
      { text: "keep me", answered_at: "2026-08-22T16:20:00.000Z", source: "inbound_sms", message_sid: "SMkeep" },
    ]);
  });

  it("uses the exact packet asked_at string as the CAS value without Date rewriting", async () => {
    const exactAskedAt = "2026-08-22T15:00:00.123Z";
    resetState(meetingQuestionRow({ open_question_asked_at: exactAskedAt }));
    installSupabaseMock();

    const result = await applySolAnsweredOpenCoachQuestion({
      commitmentId: "cmt_meeting",
      clerkUserId: "user_1",
      messageSid: "SMmeet",
      expectedOpenQuestion: {
        ...expectedMeeting,
        asked_at: exactAskedAt,
      },
      answeredQuestion: {
        question: "How did the meeting go?",
        answer: "The meeting went well.",
      },
      canonicalHumanTurnText: "Yeah it was pretty good actually",
    });

    expect(result).toEqual({ ok: true, applied: true });
    expect(state.updateFilters).toEqual(
      expect.arrayContaining([["open_question_asked_at", exactAskedAt]])
    );
    const askedAtFilter = state.updateFilters.find(([column]) => column === "open_question_asked_at");
    expect(askedAtFilter?.[1]).toBe("2026-08-22T15:00:00.123Z");
    expect(askedAtFilter?.[1]).not.toBe("2026-08-22T15:00:00.000Z");
    expect(state.updatePayload).not.toHaveProperty("open_question_asked_at");
  });
});
