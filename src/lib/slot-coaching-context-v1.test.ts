import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import {
  buildSlotCoachingContext,
  extractPreviousOutboundFromThread,
  extractUserRepliesSincePreviousOutbound,
  inferPreviousSlotFromOutboundBody,
  toWriterFacingSlotCoachingContext,
  type SlotCoachingThreadMessage,
} from "@/lib/slot-coaching-context-v1";
function thread(messages: SlotCoachingThreadMessage[]) {
  return messages;
}

describe("buildSlotCoachingContext", () => {
  it("1 action rep: check_prior_rep with concrete focus", () => {
    const ctx = buildSlotCoachingContext({
      currentSlot: "evening_checkin",
      recentExactThread: thread([
        {
          at_local: "Mon 7:00 AM",
          role: "coach",
          body: "Today's rep is simple: give one real compliment to each kid before bedtime.",
        },
      ]),
    });
    expect(ctx.slot_role_recommendation).toBe("check_prior_rep");
    expect(ctx.checkin_focus).toMatch(/compliment|each kid/i);
    expect(ctx.active_coaching_thread).toMatch(/Thread focus/i);
    expect(ctx.checkin_focus).not.toMatch(/hit your goal/i);
  });

  it("2 plan ask + user replied with plan: check_user_plan", () => {
    const ctx = buildSlotCoachingContext({
      currentSlot: "evening_checkin",
      recentExactThread: thread([
        { at_local: "Mon 7:00 AM", role: "coach", body: "What's your plan for today?" },
        { at_local: "Mon 7:15 AM", role: "user", body: "After lunch." },
      ]),
    });
    expect(ctx.slot_role_recommendation).toBe("check_user_plan");
    expect(ctx.checkin_focus).toMatch(/after lunch/i);
    expect(ctx.user_replies_since_previous_outbound).toMatch(/After lunch/i);
  });

  it("3 plan ask + no reply: truth_check mentions no response", () => {
    const ctx = buildSlotCoachingContext({
      currentSlot: "evening_checkin",
      recentExactThread: thread([
        { at_local: "Mon 7:00 AM", role: "coach", body: "What's your plan for today?" },
      ]),
      openQuestionPending: true,
      latestOpenQuestion: "What's your plan for today?",
    });
    expect(ctx.slot_role_recommendation).toBe("truth_check");
    expect(ctx.active_coaching_thread).toMatch(/No user reply/i);
  });

  it("4 proof after previous outbound: skip recommendation", () => {
    const ctx = buildSlotCoachingContext({
      currentSlot: "evening_checkin",
      recentExactThread: thread([
        {
          at_local: "Mon 7:00 AM",
          role: "coach",
          body: "Today's rep: one real compliment to each kid before bedtime.",
        },
        { at_local: "Mon 2:00 PM", role: "user", body: "Done — both kids got one." },
      ]),
    });
    expect(ctx.should_send_recommendation).toBe("skip");
    expect(ctx.skip_reason_hint).toMatch(/proof/i);
    expect(ctx.slot_role_recommendation).toBe("skip");
  });

  it("5 miss after previous outbound: reset_after_miss for morning", () => {
    const ctx = buildSlotCoachingContext({
      currentSlot: "morning",
      recentExactThread: thread([
        { at_local: "Mon 8:00 PM", role: "coach", body: "Did each kid hear a compliment today?" },
        { at_local: "Mon 8:05 PM", role: "user", body: "No — day got away from me." },
      ]),
    });
    expect(ctx.slot_role_recommendation).toBe("reset_after_miss");
    expect(ctx.active_coaching_thread).toMatch(/miss/i);
  });

  it("6 bedtime setup: morning truth_check on bedtime outcome", () => {
    const ctx = buildSlotCoachingContext({
      currentSlot: "morning",
      previousOutbound: {
        body: "Shut it down and get to bed on time tonight.",
        inferred_slot: "evening_checkin",
      },
    });
    expect(inferPreviousSlotFromOutboundBody("Shut it down and get to bed on time tonight.")).toBe(
      "evening_checkin"
    );
    expect(ctx.slot_role_recommendation).toBe("truth_check");
    expect(ctx.checkin_focus).toMatch(/bed/i);
  });

  it("7 wake-up setup: morning wake_up_check", () => {
    const ctx = buildSlotCoachingContext({
      currentSlot: "morning",
      recentExactThread: thread([
        {
          at_local: "Sun 9:00 PM",
          role: "coach",
          body: "Set the 5 AM alarm now so tomorrow starts clean.",
        },
      ]),
    });
    expect(ctx.previous_slot).toBe("evening_checkin");
    expect(ctx.slot_role_recommendation).toBe("wake_up_check");
    expect(ctx.checkin_focus).toMatch(/wake|alarm/i);
  });

  it("8 blocker: check_prior_rep with blocker focus", () => {
    const ctx = buildSlotCoachingContext({
      currentSlot: "evening_checkin",
      recentExactThread: thread([
        {
          at_local: "Mon 7:00 AM",
          role: "coach",
          body: "Your blocker today is waiting until the house gets loud. Beat it early.",
        },
      ]),
    });
    expect(ctx.slot_role_recommendation).toBe("check_prior_rep");
    expect(ctx.checkin_focus).toBeTruthy();
    expect(ctx.previous_outbound_summary).toMatch(/blocker|loud/i);
  });

  it("9 silence cadence: relationship_reentry", () => {
    const ctx = buildSlotCoachingContext({
      currentSlot: "morning",
      silenceCadence: {
        route: "relationship_check_day10",
        silence_day: 10,
        send_today: true,
        no_send_reason: null,
      },
    });
    expect(ctx.slot_role_recommendation).toBe("relationship_reentry");
    expect(ctx.should_send_recommendation).toBe("writer_decides");
  });

  it("9b silence cadence no send: skip", () => {
    const ctx = buildSlotCoachingContext({
      currentSlot: "morning",
      silenceCadence: {
        route: "no_send_space_day9",
        silence_day: 9,
        send_today: false,
        no_send_reason: "silence_cadence_intentional_space",
      },
    });
    expect(ctx.should_send_recommendation).toBe("skip");
    expect(ctx.skip_reason_hint).toMatch(/silence/i);
  });

  it("10 no useful prior thread: set_today_rep", () => {
    const ctx = buildSlotCoachingContext({
      currentSlot: "morning",
      recentExactThread: thread([]),
    });
    expect(ctx.slot_role_recommendation).toBe("set_today_rep");
    expect(ctx.previous_outbound_summary).toBeNull();
    expect(ctx.checkin_focus).toBeNull();
  });

  it("will do is plan_ack_only not proof skip for evening", () => {
    const ctx = buildSlotCoachingContext({
      currentSlot: "evening_checkin",
      recentExactThread: thread([
        {
          at_local: "Mon 7:00 AM",
          role: "coach",
          body: "Today's rep: give one real compliment to each kid before bedtime.",
        },
        { at_local: "Mon 7:10 AM", role: "user", body: "Will do." },
      ]),
    });
    expect(ctx.should_send_recommendation).not.toBe("skip");
    expect(ctx.active_coaching_thread).toMatch(/acknowledged plan/i);
  });
});

describe("thread helpers", () => {
  it("extractPreviousOutboundFromThread finds last coach message", () => {
    const prev = extractPreviousOutboundFromThread([
      { at_local: "a", role: "user", body: "hi" },
      { at_local: "b", role: "coach", body: "Coach line" },
    ]);
    expect(prev?.body).toBe("Coach line");
  });

  it("extractUserRepliesSincePreviousOutbound collects user messages after coach", () => {
    const replies = extractUserRepliesSincePreviousOutbound(
      [
        { at_local: "a", role: "coach", body: "Plan?" },
        { at_local: "b", role: "user", body: "After lunch." },
        { at_local: "c", role: "user", body: "Maybe." },
      ],
      "Plan?"
    );
    expect(replies).toEqual(["After lunch.", "Maybe."]);
  });

  it("toWriterFacingSlotCoachingContext nulls interpretive thread echo", () => {
    const ctx = buildSlotCoachingContext({
      currentSlot: "morning",
      recentExactThread: thread([
        {
          at_local: "Mon 7:00 AM",
          role: "coach",
          body: "Enjoy playing sports with the kids today!",
        },
      ]),
    });
    expect(ctx.active_coaching_thread).toBeTruthy();
    expect(ctx.previous_outbound_summary).toBeTruthy();
    const writerFacing = toWriterFacingSlotCoachingContext(ctx);
    expect(writerFacing.active_coaching_thread).toBeNull();
    expect(writerFacing.previous_outbound_summary).toBeNull();
    expect(writerFacing.slot_role_recommendation).toBe(ctx.slot_role_recommendation);
    expect(writerFacing.current_slot).toBe("morning");
  });
});
