import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

import {
  QUIET_RELATIONSHIP_MAX_GAP_DAYS,
  QUIET_RELATIONSHIP_MIN_DAYS_SINCE_USER_RESPONSE,
  SEND_EVENT_CLOCK_SELECT,
  WEEKLY_SEND_EVENT_CLOCK_SELECT,
  clampProactiveDecision,
  evaluateMessageRequiredToday,
  evaluateQuietRelationshipEligibility,
  loadSuccessfulProactiveRelationshipTouchClock,
  resolveQuietRelationshipMechanicalFacts,
} from "@/lib/sms-proactive-relationship-touch";

type ClockRow = Record<string, unknown>;

const tables: {
  sms_send_events: ClockRow[];
  sms_weekly_send_events: ClockRow[];
  errors: Partial<Record<"sms_send_events" | "sms_weekly_send_events", string>>;
  lastSelect: Partial<Record<"sms_send_events" | "sms_weekly_send_events", string>>;
} = {
  sms_send_events: [],
  sms_weekly_send_events: [],
  errors: {},
  lastSelect: {},
};

function makeChain(table: "sms_send_events" | "sms_weekly_send_events") {
  const self: Record<string, unknown> = {};
  const thenable = Promise.resolve().then(() => {
    if (tables.errors[table]) {
      return { data: null, error: { message: tables.errors[table] } };
    }
    return { data: tables[table], error: null };
  });
  self.select = vi.fn((cols: string) => {
    tables.lastSelect[table] = cols;
    return self;
  });
  self.eq = vi.fn(() => self);
  self.order = vi.fn(() => self);
  self.limit = vi.fn(() => self);
  self.then = thenable.then.bind(thenable);
  return self;
}

function strongDaily(args: {
  dayKey: string;
  sentAt: string;
  slot?: string | null;
}): ClockRow {
  return {
    status: "sent",
    message_sid: `SM-${args.dayKey}`,
    send_slot: args.slot === undefined ? "morning" : args.slot,
    created_at: args.sentAt,
    day_key: args.dayKey,
    metadata: { sent_at: args.sentAt },
  };
}

function strongWeekly(args: { dayKey: string; sentAt: string }): ClockRow {
  return {
    status: "delivered",
    message_sid: `SMW-${args.dayKey}`,
    created_at: args.sentAt,
    metadata: { sent_at: args.sentAt },
  };
}

describe("quiet relationship eligibility + required-touch clock", () => {
  beforeEach(() => {
    tables.sms_send_events = [];
    tables.sms_weekly_send_events = [];
    tables.errors = {};
    tables.lastSelect = {};
    fromMock.mockImplementation((name: string) =>
      makeChain(name as "sms_send_events" | "sms_weekly_send_events")
    );
  });

  it("clock SELECT strings omit unsupported production columns", () => {
    expect(SEND_EVENT_CLOCK_SELECT).toBe(
      "status, message_sid, outbound_message_sid, metadata, created_at, send_slot, day_key"
    );
    expect(SEND_EVENT_CLOCK_SELECT).not.toMatch(/\bsent_at\b/);
    expect(SEND_EVENT_CLOCK_SELECT).not.toMatch(/\bprocessed_at\b/);
    expect(SEND_EVENT_CLOCK_SELECT).not.toMatch(/\bupdated_at\b/);
    expect(WEEKLY_SEND_EVENT_CLOCK_SELECT).toBe(
      "status, message_sid, outbound_message_sid, metadata, created_at"
    );
    expect(WEEKLY_SEND_EVENT_CLOCK_SELECT).not.toMatch(/\bsent_at\b/);
    expect(WEEKLY_SEND_EVENT_CLOCK_SELECT).not.toMatch(/\bprocessed_at\b/);
    expect(WEEKLY_SEND_EVENT_CLOCK_SELECT).not.toMatch(/\bupdated_at\b/);
    expect(WEEKLY_SEND_EVENT_CLOCK_SELECT).not.toMatch(/\bday_key\b/);
  });

  it("clock queries use the schema-safe SELECT strings", async () => {
    await loadSuccessfulProactiveRelationshipTouchClock({
      clerkUserId: "user_1",
      timezone: "America/New_York",
      localDate: "2026-07-12",
    });
    expect(tables.lastSelect.sms_send_events).toBe(SEND_EVENT_CLOCK_SELECT);
    expect(tables.lastSelect.sms_weekly_send_events).toBe(WEEKLY_SEND_EVENT_CLOCK_SELECT);
  });

  it("active-user shield is exact at 9 vs 10", () => {
    for (const days of [0, 1, 3, 7, 9]) {
      expect(
        evaluateQuietRelationshipEligibility({
          daysSinceLastUserResponse: days,
          neverReplied: false,
          recentUnansweredOutboundCount: 20,
          daysSinceFirstSuccessfulProactiveSend: 60,
        })
      ).toEqual({ eligible: false, reason: "active_user_shield" });
    }
    expect(
      evaluateQuietRelationshipEligibility({
        daysSinceLastUserResponse: 10,
        neverReplied: false,
        recentUnansweredOutboundCount: 0,
        daysSinceFirstSuccessfulProactiveSend: 10,
      })
    ).toEqual({ eligible: true, reason: "days_since_user_response" });
    expect(QUIET_RELATIONSHIP_MIN_DAYS_SINCE_USER_RESPONSE).toBe(10);
    expect(QUIET_RELATIONSHIP_MAX_GAP_DAYS).toBe(7);
  });

  it("never-replied needs unanswered outbound plus 10 local days since first successful send", () => {
    expect(
      evaluateQuietRelationshipEligibility({
        daysSinceLastUserResponse: null,
        neverReplied: true,
        recentUnansweredOutboundCount: 0,
        daysSinceFirstSuccessfulProactiveSend: 40,
      }).eligible
    ).toBe(false);
    expect(
      evaluateQuietRelationshipEligibility({
        daysSinceLastUserResponse: null,
        neverReplied: true,
        recentUnansweredOutboundCount: 1,
        daysSinceFirstSuccessfulProactiveSend: 9,
      }).eligible
    ).toBe(false);
    expect(
      evaluateQuietRelationshipEligibility({
        daysSinceLastUserResponse: null,
        neverReplied: true,
        recentUnansweredOutboundCount: 1,
        daysSinceFirstSuccessfulProactiveSend: 10,
      })
    ).toEqual({ eligible: true, reason: "never_replied_outbound_history" });
    expect(
      evaluateQuietRelationshipEligibility({
        daysSinceLastUserResponse: null,
        neverReplied: true,
        recentUnansweredOutboundCount: 1,
        daysSinceFirstSuccessfulProactiveSend: null,
        firstSendLookupFailed: true,
      }).eligible
    ).toBe(false);
  });

  it("required touch is false for active users, fail-safe on clock lookup failure, true when quiet and last send ≥7 or missing", () => {
    expect(
      evaluateMessageRequiredToday({
        quietEligible: false,
        daysSinceLastSuccessfulProactiveSend: 30,
        clockLookupFailed: false,
      })
    ).toBe(false);
    expect(
      evaluateMessageRequiredToday({
        quietEligible: true,
        daysSinceLastSuccessfulProactiveSend: 30,
        clockLookupFailed: true,
      })
    ).toBe(false);
    expect(
      evaluateMessageRequiredToday({
        quietEligible: true,
        daysSinceLastSuccessfulProactiveSend: 6,
        clockLookupFailed: false,
      })
    ).toBe(false);
    expect(
      evaluateMessageRequiredToday({
        quietEligible: true,
        daysSinceLastSuccessfulProactiveSend: 7,
        clockLookupFailed: false,
      })
    ).toBe(true);
    expect(
      evaluateMessageRequiredToday({
        quietEligible: true,
        daysSinceLastSuccessfulProactiveSend: null,
        clockLookupFailed: false,
      })
    ).toBe(true);
  });

  it("clamp keeps SPACE only when quiet-eligible, not required-touch, and clock is available", () => {
    expect(
      clampProactiveDecision({
        decision: "intentional_space",
        quietRelationshipEligible: false,
        messageRequiredToday: false,
      })
    ).toBe("send");
    expect(
      clampProactiveDecision({
        decision: "intentional_space",
        quietRelationshipEligible: true,
        messageRequiredToday: true,
      })
    ).toBe("send");
    expect(
      clampProactiveDecision({
        decision: "intentional_space",
        quietRelationshipEligible: true,
        messageRequiredToday: false,
      })
    ).toBe("intentional_space");
    expect(
      clampProactiveDecision({
        decision: "send",
        quietRelationshipEligible: true,
        messageRequiredToday: false,
      })
    ).toBe("send");
    expect(
      clampProactiveDecision({
        decision: "intentional_space",
        quietRelationshipEligible: true,
        messageRequiredToday: false,
        forceSend: true,
      })
    ).toBe("send");
    expect(
      clampProactiveDecision({
        decision: "intentional_space",
        quietRelationshipEligible: true,
        messageRequiredToday: false,
        clockLookupFailed: true,
      })
    ).toBe("send");
  });

  it("clock uses strong M/E/W evidence only; Weekly success resets last touch", async () => {
    tables.sms_send_events = [
      strongDaily({
        dayKey: "2026-07-01",
        sentAt: "2026-07-01T12:00:00.000Z",
        slot: "morning",
      }),
      {
        status: "skipped",
        send_slot: "morning",
        created_at: "2026-07-08T12:00:00.000Z",
        day_key: "2026-07-08",
      },
      {
        status: "queued",
        send_slot: "evening_checkin",
        created_at: "2026-07-09T12:00:00.000Z",
        day_key: "2026-07-09",
      },
    ];
    tables.sms_weekly_send_events = [
      strongWeekly({ dayKey: "2026-07-05", sentAt: "2026-07-05T16:00:00.000Z" }),
      {
        status: "reserved",
        created_at: "2026-07-12T16:00:00.000Z",
        day_key: "2026-07-12",
      },
    ];
    const clock = await loadSuccessfulProactiveRelationshipTouchClock({
      clerkUserId: "user_1",
      timezone: "America/New_York",
      localDate: "2026-07-12",
    });
    expect(clock.ok).toBe(true);
    if (!clock.ok) return;
    expect(clock.last?.sourceTable).toBe("sms_weekly_send_events");
    expect(clock.last?.localDayKey).toBe("2026-07-05");
    expect(clock.daysSinceLast).toBe(7);
    expect(clock.first?.localDayKey).toBe("2026-07-01");
  });

  it("failed/reserved/skipped Weekly does not reset the clock", async () => {
    tables.sms_send_events = [
      strongDaily({
        dayKey: "2026-07-01",
        sentAt: "2026-07-01T12:00:00.000Z",
        slot: "evening_checkin",
      }),
    ];
    tables.sms_weekly_send_events = [
      { status: "failed", created_at: "2026-07-11T16:00:00.000Z", day_key: "2026-07-11" },
      { status: "skipped", created_at: "2026-07-11T16:00:00.000Z", day_key: "2026-07-11" },
      { status: "reserved", created_at: "2026-07-11T16:00:00.000Z", day_key: "2026-07-11" },
      { status: "generated", created_at: "2026-07-11T16:00:00.000Z", day_key: "2026-07-11" },
    ];
    const clock = await loadSuccessfulProactiveRelationshipTouchClock({
      clerkUserId: "user_1",
      timezone: "America/New_York",
      localDate: "2026-07-12",
    });
    expect(clock.ok).toBe(true);
    if (!clock.ok) return;
    expect(clock.last?.sourceTable).toBe("sms_send_events");
    expect(clock.last?.localDayKey).toBe("2026-07-01");
    expect(clock.daysSinceLast).toBe(11);
  });

  it("null send_slot counts as legacy morning; inbound slots do not", async () => {
    tables.sms_send_events = [
      strongDaily({
        dayKey: "2026-07-02",
        sentAt: "2026-07-02T12:00:00.000Z",
        slot: null,
      }),
      {
        status: "sent",
        message_sid: "SM-inbound",
        send_slot: "inbound_reply",
        sent_at: "2026-07-10T12:00:00.000Z",
        created_at: "2026-07-10T12:00:00.000Z",
        day_key: "2026-07-10",
      },
    ];
    const clock = await loadSuccessfulProactiveRelationshipTouchClock({
      clerkUserId: "user_1",
      timezone: "America/New_York",
      localDate: "2026-07-12",
    });
    expect(clock.ok).toBe(true);
    if (!clock.ok) return;
    expect(clock.last?.localDayKey).toBe("2026-07-02");
  });

  it("clock lookup failure is fail-safe: required touch stays false", async () => {
    tables.errors.sms_send_events = "db down";
    const facts = await resolveQuietRelationshipMechanicalFacts({
      clerkUserId: "user_1",
      timezone: "America/New_York",
      localDate: "2026-07-12",
      daysSinceLastUserResponse: 14,
      neverReplied: false,
      recentUnansweredOutboundCount: 4,
    });
    expect(facts.clock_lookup_failed).toBe(true);
    expect(facts.clock_lookup_error).toBe("sms_send_events:db down");
    expect(facts.quiet_relationship_eligible).toBe(true);
    expect(facts.message_required_today).toBe(false);
    expect(facts.days_since_last_successful_proactive_send).toBeNull();
    expect(
      clampProactiveDecision({
        decision: "intentional_space",
        quietRelationshipEligible: facts.quiet_relationship_eligible,
        messageRequiredToday: facts.message_required_today,
        clockLookupFailed: facts.clock_lookup_failed,
      })
    ).toBe("send");
  });

  it("Weekly sent yesterday makes message_required_today false even if last M/E is old", async () => {
    tables.sms_send_events = [
      strongDaily({
        dayKey: "2026-06-20",
        sentAt: "2026-06-20T12:00:00.000Z",
      }),
    ];
    tables.sms_weekly_send_events = [
      strongWeekly({ dayKey: "2026-07-11", sentAt: "2026-07-11T16:00:00.000Z" }),
    ];
    const facts = await resolveQuietRelationshipMechanicalFacts({
      clerkUserId: "user_1",
      timezone: "America/New_York",
      localDate: "2026-07-12",
      daysSinceLastUserResponse: 40,
      neverReplied: false,
      recentUnansweredOutboundCount: 8,
    });
    expect(facts.quiet_relationship_eligible).toBe(true);
    expect(facts.days_since_last_successful_proactive_send).toBe(1);
    expect(facts.message_required_today).toBe(false);
    expect(facts.clock_lookup_failed).toBe(false);
    expect(facts.clock_lookup_error).toBeNull();
  });

  it("daily metadata.sent_at + send_slot + day_key is accepted; created_at-only also works", async () => {
    tables.sms_send_events = [
      strongDaily({
        dayKey: "2026-07-10",
        sentAt: "2026-07-10T12:00:00.000Z",
        slot: "evening_checkin",
      }),
    ];
    const metaClock = await loadSuccessfulProactiveRelationshipTouchClock({
      clerkUserId: "user_1",
      timezone: "America/New_York",
      localDate: "2026-07-12",
    });
    expect(metaClock.ok).toBe(true);
    if (!metaClock.ok) return;
    expect(metaClock.lookupFailed).toBe(false);
    expect(metaClock.last?.localDayKey).toBe("2026-07-10");
    expect(metaClock.daysSinceLast).toBe(2);

    tables.sms_send_events = [
      {
        status: "sent",
        message_sid: "SM-created-only",
        send_slot: "morning",
        created_at: "2026-07-09T14:00:00.000Z",
        day_key: "2026-07-09",
      },
    ];
    const createdClock = await loadSuccessfulProactiveRelationshipTouchClock({
      clerkUserId: "user_1",
      timezone: "America/New_York",
      localDate: "2026-07-12",
    });
    expect(createdClock.ok).toBe(true);
    if (!createdClock.ok) return;
    expect(createdClock.last?.localDayKey).toBe("2026-07-09");
    expect(createdClock.daysSinceLast).toBe(3);
  });

  it("weekly metadata.sent_at with no day_key derives local day from timestamp + timezone", async () => {
    tables.sms_weekly_send_events = [
      {
        status: "delivered",
        message_sid: "SMW-noday",
        created_at: "2026-07-05T16:00:00.000Z",
        metadata: { sent_at: "2026-07-05T16:00:00.000Z" },
      },
    ];
    const clock = await loadSuccessfulProactiveRelationshipTouchClock({
      clerkUserId: "user_1",
      timezone: "America/New_York",
      localDate: "2026-07-12",
    });
    expect(clock.ok).toBe(true);
    if (!clock.ok) return;
    expect(clock.last?.sourceTable).toBe("sms_weekly_send_events");
    expect(clock.last?.localDayKey).toBe("2026-07-05");
    expect(clock.daysSinceLast).toBe(7);
  });
});
