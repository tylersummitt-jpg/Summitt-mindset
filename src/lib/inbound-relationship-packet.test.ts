import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { RecentExactThread72hMessage } from "@/lib/sms-recent-exact-thread-72h";
import { exactThreadExcludingCurrentTurnSids } from "@/lib/inbound-relationship-packet";

vi.mock("server-only", () => ({}));

const supabaseFrom = vi.hoisted(() => vi.fn());
const buildRecentExactThread72h = vi.hoisted(() => vi.fn());
const loadInboundMmsD1PendingContext = vi.hoisted(() =>
  vi.fn(async () => ({
    candidate_count: 0,
    candidate: null,
    recent_wins: [],
  }))
);
const loadInboundMmsD2cPendingContext = vi.hoisted(() =>
  vi.fn(async () => ({
    candidate_count: 0,
    candidate: null,
    recent_wins: [],
  }))
);

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: supabaseFrom },
}));

vi.mock("@/lib/sms-recent-exact-thread-72h", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sms-recent-exact-thread-72h")>();
  return {
    ...actual,
    buildRecentExactThread72h,
  };
});

vi.mock("@/lib/victory-media/inbound-mms-d1-pending-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/victory-media/inbound-mms-d1-pending-context")>();
  return {
    ...actual,
    loadInboundMmsD1PendingContext,
  };
});

vi.mock("@/lib/victory-media/inbound-mms-d2c-pending-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/victory-media/inbound-mms-d2c-pending-context")>();
  return {
    ...actual,
    loadInboundMmsD2cPendingContext,
  };
});

import { loadInboundRelationshipPacket } from "@/lib/inbound-relationship-packet";

const commitment = {
  id: "c1",
  behavior_statement: "Lift 30 minutes",
  title: "Lift",
} as ActiveV2CommitmentRow;

function threadMsg(
  overrides: Partial<RecentExactThread72hMessage> &
    Pick<RecentExactThread72hMessage, "role" | "body" | "at" | "message_sid">
): RecentExactThread72hMessage {
  return {
    at_local: "2026-08-18 11:00",
    at_local_timezone: "America/Chicago",
    local_day_key: "2026-08-18",
    message_kind: overrides.role === "user" ? "inbound" : "outbound",
    source_table: overrides.role === "user" ? "sms_inbound_messages" : "sms_send_events",
    delivery_status: overrides.role === "user" ? "sent" : "sent",
    is_exact_body: true,
    ...overrides,
  };
}

describe("inbound relationship packet", () => {
  beforeEach(() => {
    supabaseFrom.mockReset();
    loadInboundMmsD1PendingContext.mockReset();
    loadInboundMmsD1PendingContext.mockResolvedValue({
      candidate_count: 0,
      candidate: null,
      recent_wins: [],
    });
    loadInboundMmsD2cPendingContext.mockReset();
    loadInboundMmsD2cPendingContext.mockResolvedValue({
      candidate_count: 0,
      candidate: null,
      recent_wins: [],
    });
    supabaseFrom.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { preferred_name: "Angel", identity_anchor_text: null },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "important_people") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "v2_commitment_sms_thread_memory") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (table === "sms_inbound_messages") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    });
    buildRecentExactThread72h.mockResolvedValue({
      messages: [
        threadMsg({
          role: "user",
          at: "2026-08-18T16:00:00.000Z",
          message_sid: "SMangel",
          body: "Need a 5 passenger SUV",
        }),
      ],
      window_hours: 21 * 24,
      message_count: 1,
      had_preview_messages: false,
      had_system_no_send: false,
    });
  });

  it("loads packet with inbound daypart and latest inbound fields", async () => {
    const loaded = await loadInboundRelationshipPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: "Need a 5 passenger SUV",
      latestInboundMessageSid: "SMangel",
      receivedAt: new Date("2026-08-18T16:30:00.000Z"),
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.packet.message_for.daypart).toBe("inbound");
    expect(loaded.packet.latest_inbound_text).toBe("Need a 5 passenger SUV");
    expect(loaded.packet.latest_inbound_message_sid).toBe("SMangel");
    expect(loaded.packet.preferred_name).toBe("Angel");
    expect(loaded.packet.exact_thread.window_days).toBe(21);
    expect(loaded.packet.hard_state.open_coach_question).toBeNull();
    expect(loaded.packet.pending_media_context).toEqual({
      candidate_count: 0,
      candidate: null,
      recent_wins: [],
    });
    expect(loadInboundMmsD2cPendingContext).toHaveBeenCalledWith({
      clerkUserId: "user_1",
      currentMessageSid: "SMangel",
      now: new Date("2026-08-18T16:30:00.000Z"),
    });
    expect(loadInboundMmsD1PendingContext).toHaveBeenCalledWith({
      clerkUserId: "user_1",
      currentMessageSid: "SMangel",
      now: new Date("2026-08-18T16:30:00.000Z"),
    });
    expect(buildRecentExactThread72h).toHaveBeenCalled();
  });

  it("pending_user clarification outranks D1 unresolved photos", async () => {
    const question = "What made this one a win for you?";
    loadInboundMmsD2cPendingContext.mockResolvedValue({
      candidate_count: 1,
      candidate: {
        job_id: "aaaaaaaa-1111-4111-8111-111111111111",
        age_seconds: 2400,
        message_sid: "SMdddddddddddddddddddddddddddddddd",
        normalized_ready: true,
        awaiting_user: true,
        clarification_body: question,
      },
      recent_wins: [],
    });
    const loaded = await loadInboundRelationshipPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: "I took Lakelyn to her first dance class.",
      latestInboundMessageSid: "SMlake",
      receivedAt: new Date("2026-08-18T16:30:00.000Z"),
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.packet.pending_media_context.candidate?.awaiting_user).toBe(true);
    expect(loaded.packet.pending_media_context.candidate?.clarification_body).toBe(
      question
    );
    expect(loadInboundMmsD1PendingContext).not.toHaveBeenCalled();
  });

  it("D2c lookup failure does not fall through to D1", async () => {
    loadInboundMmsD2cPendingContext.mockResolvedValue("error");
    const loaded = await loadInboundRelationshipPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: "Need a 5 passenger SUV",
      latestInboundMessageSid: "SMangel",
      receivedAt: new Date("2026-08-18T16:30:00.000Z"),
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.packet.pending_media_context).toEqual({
      candidate_count: 0,
      candidate: null,
      recent_wins: [],
    });
    expect(loadInboundMmsD1PendingContext).not.toHaveBeenCalled();
  });

  it("D2c deletion-guard throw (mocked as error) does not load D1", async () => {
    loadInboundMmsD2cPendingContext.mockRejectedValue(new Error("deletion_lookup_failed"));
    const loaded = await loadInboundRelationshipPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: "Taking Lakelyn to dance class.",
      latestInboundMessageSid: "SMlake",
      receivedAt: new Date("2026-08-18T16:30:00.000Z"),
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.packet.pending_media_context).toEqual({
      candidate_count: 0,
      candidate: null,
      recent_wins: [],
    });
    expect(loadInboundMmsD1PendingContext).not.toHaveBeenCalled();
  });

  it("two pending_user jobs do not fall through to D1", async () => {
    loadInboundMmsD2cPendingContext.mockResolvedValue({
      candidate_count: 2,
      candidate: null,
      recent_wins: [],
    });
    const loaded = await loadInboundRelationshipPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: "Taking Lakelyn to dance class.",
      latestInboundMessageSid: "SMlake",
      receivedAt: new Date("2026-08-18T16:30:00.000Z"),
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.packet.pending_media_context.candidate_count).toBe(2);
    expect(loaded.packet.pending_media_context.candidate).toBeNull();
    expect(loadInboundMmsD1PendingContext).not.toHaveBeenCalled();
  });

  it("reserved-unsent (successful zero D2c) may load D1; sent clarification does not", async () => {
    loadInboundMmsD2cPendingContext.mockResolvedValue({
      candidate_count: 0,
      candidate: null,
      recent_wins: [],
    });
    const loaded = await loadInboundRelationshipPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: "Taking Lakelyn to dance class.",
      latestInboundMessageSid: "SMlake",
      receivedAt: new Date("2026-08-18T16:30:00.000Z"),
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loadInboundMmsD1PendingContext).toHaveBeenCalled();
    expect(loaded.packet.pending_media_context.candidate?.awaiting_user).not.toBe(true);
    expect(loaded.packet.pending_media_context.candidate?.clarification_body).toBeUndefined();
  });

  it("D2c pending fact does not require sms_last_outbound_context or a fake transcript row", async () => {
    const question = "What made this one a win for you?";
    loadInboundMmsD2cPendingContext.mockResolvedValue({
      candidate_count: 1,
      candidate: {
        job_id: "aaaaaaaa-1111-4111-8111-111111111111",
        age_seconds: 2400,
        message_sid: "SMdddddddddddddddddddddddddddddddd",
        normalized_ready: true,
        awaiting_user: true,
        clarification_body: question,
      },
      recent_wins: [],
    });
    buildRecentExactThread72h.mockResolvedValue({
      messages: [
        threadMsg({
          role: "user",
          body: "Need a 5 passenger SUV",
          at: "2026-08-18T16:00:00.000Z",
          message_sid: "SMangel",
        }),
      ],
    });
    const loaded = await loadInboundRelationshipPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: "I took Lakelyn to her first dance class.",
      latestInboundMessageSid: "SMlake",
      receivedAt: new Date("2026-08-18T16:30:00.000Z"),
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.packet.pending_media_context.candidate?.clarification_body).toBe(
      question
    );
    expect(JSON.stringify(loaded.packet.exact_thread.messages)).not.toContain(question);
    const tables = supabaseFrom.mock.calls.map((c) => c[0]);
    expect(tables).not.toContain("sms_last_outbound_context");
  });

  it("reads open_coach_question from thread memory without deciding whether newest U answers it", async () => {
    supabaseFrom.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { preferred_name: "Angel", identity_anchor_text: null },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "important_people") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "v2_commitment_sms_thread_memory") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  open_question_text: "What story will you dictate today?",
                  open_question_expected_answer_type: "open_reflection",
                  open_question_pending: true,
                  open_question_asked_at: "2026-08-17T12:00:00.000Z",
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
    });

    const loaded = await loadInboundRelationshipPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: "My brother is in town this week",
      latestInboundMessageSid: "SMfresh",
      receivedAt: new Date("2026-08-18T16:30:00.000Z"),
      currentTurnMessageSids: ["SMfresh"],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.packet.hard_state.open_coach_question).toEqual({
      text: "What story will you dictate today?",
      expected_answer_type: "open_reflection",
      pending: true,
      asked_at: "2026-08-17T12:00:00.000Z",
    });
    expect(loaded.packet.latest_inbound_text).toBe("My brother is in town this week");
  });

  it("single U: current SID absent from exact thread, latest U correct", async () => {
    buildRecentExactThread72h.mockResolvedValue({
      messages: [
        threadMsg({
          role: "coach",
          at: "2026-08-18T15:00:00.000Z",
          message_sid: "SMcoach",
          body: "Did you lift?",
        }),
        threadMsg({
          role: "user",
          at: "2026-08-18T16:00:00.000Z",
          message_sid: "SMnow",
          body: "Done before lunch",
        }),
      ],
      window_hours: 21 * 24,
      message_count: 2,
      had_preview_messages: false,
      had_system_no_send: false,
    });

    const loaded = await loadInboundRelationshipPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: "Done before lunch",
      latestInboundMessageSid: "SMnow",
      receivedAt: new Date("2026-08-18T16:00:00.000Z"),
      currentTurnMessageSids: ["SMnow"],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.packet.latest_inbound_text).toBe("Done before lunch");
    expect(loaded.packet.exact_thread.messages.every((m) => m.body !== "Done before lunch")).toBe(
      true
    );
    expect(loaded.packet.exact_thread.messages.some((m) => m.body === "Did you lift?")).toBe(true);
  });

  it("coalesced U1/U2/U3: all current SIDs absent; latest preserves order/newlines", async () => {
    buildRecentExactThread72h.mockResolvedValue({
      messages: [
        threadMsg({
          role: "user",
          at: "2026-08-18T15:50:00.000Z",
          message_sid: "SM1",
          body: "First",
        }),
        threadMsg({
          role: "user",
          at: "2026-08-18T15:51:00.000Z",
          message_sid: "SM2",
          body: "Second",
        }),
        threadMsg({
          role: "user",
          at: "2026-08-18T15:52:00.000Z",
          message_sid: "SM3",
          body: "Third",
        }),
      ],
      window_hours: 21 * 24,
      message_count: 3,
      had_preview_messages: false,
      had_system_no_send: false,
    });

    const latest = "First\nSecond\nThird";
    const loaded = await loadInboundRelationshipPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: latest,
      latestInboundMessageSid: "SM3",
      receivedAt: new Date("2026-08-18T15:52:00.000Z"),
      currentTurnMessageSids: ["SM1", "SM2", "SM3"],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.packet.latest_inbound_text).toBe(latest);
    expect(loaded.packet.exact_thread.messages).toHaveLength(0);
  });

  it("identical historical/current body: historical different SID remains", async () => {
    buildRecentExactThread72h.mockResolvedValue({
      messages: [
        threadMsg({
          role: "user",
          at: "2026-08-17T16:00:00.000Z",
          message_sid: "SMold",
          body: "Need a 5 passenger SUV",
        }),
        threadMsg({
          role: "user",
          at: "2026-08-18T16:00:00.000Z",
          message_sid: "SMnow",
          body: "Need a 5 passenger SUV",
        }),
      ],
      window_hours: 21 * 24,
      message_count: 2,
      had_preview_messages: false,
      had_system_no_send: false,
    });

    const loaded = await loadInboundRelationshipPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: "Need a 5 passenger SUV",
      latestInboundMessageSid: "SMnow",
      receivedAt: new Date("2026-08-18T16:00:00.000Z"),
      currentTurnMessageSids: ["SMnow"],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.packet.exact_thread.messages).toHaveLength(1);
    expect(loaded.packet.exact_thread.messages[0]?.body).toBe("Need a 5 passenger SUV");
    expect(loaded.packet.latest_inbound_text).toBe("Need a 5 passenger SUV");
  });

  it("11:59 receive / midnight process uses receive local date", async () => {
    const receivedAt = new Date("2026-08-19T04:59:00.000Z");
    const loaded = await loadInboundRelationshipPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: "Done",
      latestInboundMessageSid: "SMlate",
      receivedAt,
      now: new Date("2026-08-19T05:05:00.000Z"),
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.packet.message_for.local_date).toBe("2026-08-18");
    expect(loaded.receivedAt.toISOString()).toBe(receivedAt.toISOString());
  });

  it("retry next day keeps original receive day", async () => {
    const loaded = await loadInboundRelationshipPacket({
      clerkUserId: "user_1",
      timezone: "America/Chicago",
      commitment,
      latestInboundText: "Done",
      latestInboundMessageSid: "SMretry",
      receivedAt: new Date("2026-08-19T04:59:00.000Z"),
      now: new Date("2026-08-20T16:00:00.000Z"),
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.packet.message_for.local_date).toBe("2026-08-18");
  });
});

describe("exactThreadExcludingCurrentTurnSids", () => {
  it("drops current user SIDs and keeps older identical body from another SID", () => {
    const messages = [
      { role: "user" as const, message_sid: "SMold", body: "same" },
      { role: "user" as const, message_sid: "SM1", body: "same" },
      { role: "user" as const, message_sid: "SM2", body: "same" },
      { role: "coach" as const, message_sid: "SMcoach", body: "ok" },
    ];
    const kept = exactThreadExcludingCurrentTurnSids(messages, ["SM1", "SM2"]);
    expect(kept.map((m) => m.message_sid)).toEqual(["SMold", "SMcoach"]);
  });
});
