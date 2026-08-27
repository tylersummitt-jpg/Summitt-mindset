import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseFrom = vi.hoisted(() => vi.fn());
const getRecentV2EventsForAi = vi.hoisted(() => vi.fn());
const getActiveCommitment = vi.hoisted(() => vi.fn());
const fetchLastAnyUserReplyAt = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: supabaseFrom },
}));

vi.mock("@/lib/v2-commitment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-commitment")>();
  return {
    ...actual,
    getActiveCommitment,
    getRecentV2EventsForAi,
  };
});

vi.mock("@/lib/sms-last-any-user-reply", () => ({
  fetchLastAnyUserReplyAt,
}));

import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { loadMorningRelationshipPacket } from "@/lib/morning-tto-relationship-packet";

const TZ = "America/Chicago";
const NOW = new Date("2026-06-22T15:30:00.000Z");

function chain(rows: unknown[] | unknown | null, error: { message: string } | null = null) {
  const result = { data: error ? null : rows, error };
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    is: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () =>
      Promise.resolve(
        Array.isArray(rows) ? { data: rows[0] ?? null, error } : { data: rows, error }
      ),
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  return builder;
}

function activeCommitment(overrides: Partial<ActiveV2CommitmentRow> = {}): ActiveV2CommitmentRow {
  return {
    id: "cmt_morning",
    clerk_user_id: "user_morning",
    behavior_statement: "One hour of focused writing each morning",
    title: "Writing",
    accountability_phase: "active_accountability",
    started_at: "2026-01-01T12:00:00.000Z",
    refresh_session: null,
    ...overrides,
  } as ActiveV2CommitmentRow;
}

function setupPacketSupabase(args: {
  profile?: Record<string, unknown> | null;
  importantPeople?: unknown[];
  sendRows?: unknown[];
  inboundRows?: unknown[];
  evidenceRows?: unknown[];
  winRows?: unknown[];
  priorCommitmentRows?: unknown[];
  winError?: { message: string } | null;
}) {
  supabaseFrom.mockImplementation((table: string) => {
    switch (table) {
      case "user_profiles":
        return chain(args.profile ?? null);
      case "important_people":
        return chain(args.importantPeople ?? []);
      case "v2_commitment": {
        const priorRows = args.priorCommitmentRows ?? [];
        const priorResult = { data: priorRows, error: null };
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          is: () => builder,
          order: () => builder,
          limit: () => builder,
          maybeSingle: () => Promise.resolve({ data: activeCommitment(), error: null }),
          then: (resolve: (v: typeof priorResult) => void) => resolve(priorResult),
        };
        return builder;
      }
      case "sms_send_events":
        return chain(args.sendRows ?? []);
      case "sms_weekly_send_events":
        return chain([]);
      case "sms_inbound_coach_jobs":
        return chain([]);
      case "sms_inbound_messages":
        return chain(args.inboundRows ?? []);
      case "sms_last_outbound_context":
        return chain(null);
      case "v2_durable_user_evidence":
        return chain(args.evidenceRows ?? []);
      case "v2_win":
        return chain(args.winRows ?? [], args.winError ?? null);
      default:
        return chain([]);
    }
  });
}

describe("loadMorningRelationshipPacket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecentV2EventsForAi.mockResolvedValue([]);
    getActiveCommitment.mockResolvedValue(activeCommitment());
    fetchLastAnyUserReplyAt.mockResolvedValue(null);
  });

  it("returns morning_relationship_v1 packet with six sources", async () => {
    setupPacketSupabase({
      profile: {
        preferred_name: "Pat",
        identity_anchor_text: "I am a steady father.",
        identity_source: "user_edited",
        responsibility: "Lead the product team",
        work_challenge: "Too many meetings",
      },
      sendRows: [
        {
          sms_body: "How did the writing hour go yesterday?",
          created_at: "2026-06-21T14:00:00.000Z",
          status: "sent",
          message_sid: "SM_COACH",
          sent_at: "2026-06-21T14:00:00.000Z",
        },
      ],
      inboundRows: [
        {
          raw_body: "Got an hour in before breakfast.",
          received_at: "2026-06-21T16:00:00.000Z",
          message_sid: "SM_USER",
        },
      ],
    });
    fetchLastAnyUserReplyAt.mockResolvedValue("2026-06-21T16:00:00.000Z");

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.packet.version).toBe("morning_relationship_v1");
    expect(result.packet.message_for.timezone).toBe(TZ);
    expect(result.packet.message_for.local_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.packet.message_for.local_weekday).toBeTruthy();
    expect(result.packet.message_for.daypart).toBe("morning");
    expect(result.packet).not.toHaveProperty("current_local");
    expect(result.packet.preferred_name).toBe("Pat");
    expect(result.packet.current_goal.text).toBe("One hour of focused writing each morning");
    expect(result.packet.current_identity.text).toBe("I am a steady father.");
    expect(result.packet.personal_context.some((c) => c.type === "responsibility")).toBe(true);
    expect(result.packet.historical_evidence).toEqual([]);
    expect(result.packet.exact_thread.window_days).toBe(21);
    expect(result.packet.exact_thread.max_messages).toBe(30);
    expect(result.commitmentId).toBe("cmt_morning");
  });

  it("message_for equals draft_for_day_key when generated before 11 AM local", async () => {
    setupPacketSupabase({ profile: {} });
    // 2026-08-03 10:23 UTC = 06:23 America/New_York (before 11)
    const now = new Date("2026-08-03T10:23:00.000Z");
    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: "America/New_York",
      now,
      draftForDayKey: "2026-08-03",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.message_for).toEqual({
      timezone: "America/New_York",
      local_date: "2026-08-03",
      local_weekday: "Monday",
      daypart: "morning",
    });
    expect(JSON.stringify(result.packet)).not.toContain("current_local");
  });

  it("Evening daypart wrapper sets message_for.daypart=evening without changing local_date law", async () => {
    setupPacketSupabase({ profile: {} });
    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: "America/New_York",
      now: new Date("2026-08-02T20:00:00.000Z"),
      draftForDayKey: "2026-08-07",
      daypart: "evening",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.message_for).toEqual({
      timezone: "America/New_York",
      local_date: "2026-08-07",
      local_weekday: "Friday",
      daypart: "evening",
    });
    expect(result.packet.historical_evidence).toEqual([]);
  });

  it("loads active durable user evidence omitted from surviving exact-thread SIDs", async () => {
    setupPacketSupabase({
      profile: { preferred_name: "Pat" },
      sendRows: [
        {
          sms_body: "How did writing go?",
          created_at: "2026-06-21T14:00:00.000Z",
          status: "sent",
          message_sid: "SM_COACH",
          sent_at: "2026-06-21T14:00:00.000Z",
        },
      ],
      inboundRows: [
        {
          raw_body: "Got an hour in before breakfast.",
          received_at: "2026-06-21T16:00:00.000Z",
          message_sid: "SM_USER",
          inserted_at: "2026-06-21T16:00:00.000Z",
        },
      ],
      evidenceRows: [
        {
          id: "e-in",
          occurred_at: "2026-06-21T16:00:00.000Z",
          source_message_sid: "SM_USER",
          exact_user_evidence: "Got an hour in before breakfast.",
          created_at: "2026-06-21T16:00:01.000Z",
        },
        {
          id: "e-out",
          occurred_at: "2026-05-01T16:00:00.000Z",
          source_message_sid: "SM_FALLEN",
          exact_user_evidence: "I like when you challenge me directly.",
          created_at: "2026-05-01T16:00:01.000Z",
        },
      ],
    });
    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.historical_evidence).toEqual([
      {
        source: "user_message",
        occurred_at: "2026-05-01",
        evidence: "I like when you challenge me directly.",
        user_quote: "I like when you challenge me directly.",
      },
    ]);
    expect(JSON.stringify(result.packet.exact_thread.messages)).not.toContain("message_sid");
    expect(supabaseFrom).toHaveBeenCalledWith("v2_durable_user_evidence");
    expect(supabaseFrom).toHaveBeenCalledWith("v2_win");
  });

  it("Evening inherits the same historical_evidence loader as Morning", async () => {
    setupPacketSupabase({
      profile: { preferred_name: "Pat" },
      evidenceRows: [
        {
          id: "e-out",
          occurred_at: "2026-05-01T16:00:00.000Z",
          source_message_sid: "SM_FALLEN",
          exact_user_evidence: "I like when you challenge me directly.",
          created_at: "2026-05-01T16:00:01.000Z",
        },
      ],
    });
    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
      daypart: "evening",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.message_for.daypart).toBe("evening");
    expect(result.packet.historical_evidence).toEqual([
      {
        source: "user_message",
        occurred_at: "2026-05-01",
        evidence: "I like when you challenge me directly.",
        user_quote: "I like when you challenge me directly.",
      },
    ]);
  });

  it("message_for uses tomorrow draft day after 11 AM, not generation Tuesday", async () => {
    setupPacketSupabase({ profile: {} });
    // Proven Aug 5 skew: generated Tue 19:40 ET for Wed draft
    const now = new Date("2026-08-04T23:40:00.000Z");
    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: "America/New_York",
      now,
      draftForDayKey: "2026-08-05",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.message_for.local_date).toBe("2026-08-05");
    expect(result.packet.message_for.local_weekday).toBe("Wednesday");
    expect(result.packet.message_for.daypart).toBe("morning");
    expect(result.packet.message_for.local_date).not.toBe("2026-08-04");
    expect(result.packet.message_for.local_weekday).not.toBe("Tuesday");
  });

  it("weekdayLongFromLocalDayKey derives weekday from draft day key", async () => {
    const { weekdayLongFromLocalDayKey, buildMorningMessageFor } = await import(
      "@/lib/morning-tto-relationship-packet"
    );
    expect(weekdayLongFromLocalDayKey("2026-08-03")).toBe("Monday");
    expect(weekdayLongFromLocalDayKey("2026-08-05")).toBe("Wednesday");
    expect(
      buildMorningMessageFor({
        timezone: "America/New_York",
        draftForDayKey: "2026-08-05",
      }).local_weekday
    ).toBe("Wednesday");
  });

  it("uses adaptive overlay for current_goal when active", async () => {
    getActiveCommitment.mockResolvedValue(
      activeCommitment({
        behavior_statement: "Base behavior statement",
        adaptive_ask_text: "Two hours of deep work daily",
        adaptive_ask_expires_at: new Date("2026-07-01T12:00:00.000Z").toISOString(),
      })
    );
    setupPacketSupabase({ profile: {} });

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.current_goal.text).toBe("Two hours of deep work daily");
  });

  it("falls back to behavior_statement when adaptive overlay expired", async () => {
    getActiveCommitment.mockResolvedValue(
      activeCommitment({
        behavior_statement: "Base behavior statement",
        adaptive_ask_text: "Expired overlay ask",
        adaptive_ask_expires_at: new Date("2026-06-01T12:00:00.000Z").toISOString(),
      })
    );
    setupPacketSupabase({ profile: {} });

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.current_goal.text).toBe("Base behavior statement");
  });

  it("keeps pending candidate separate from current_goal in hard_state", async () => {
    getActiveCommitment.mockResolvedValue(
      activeCommitment({
        behavior_statement: "Current active goal",
        pending_resolution_kind: "commitment_replace",
        pending_resolution_created_at: "2026-06-20T12:00:00.000Z",
        pending_resolution_expires_at: "2026-07-01T12:00:00.000Z",
        pending_resolution_payload: {
          source: "sms_inbound",
          sms_state: "awaiting_confirmation",
          candidate_behavior_statement: "Run three miles every morning",
          detected_intent: "sms_replace_request",
          raw_user_text: "I want to run instead",
          inbound_message_sid: "SM_IN",
          ai_confidence: 0.9,
        },
      })
    );
    setupPacketSupabase({ profile: {} });

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.current_goal.text).toBe("Current active goal");
    expect(result.packet.hard_state.pending_goal_change).toEqual({
      candidate_text: "Run three miles every morning",
      status: "awaiting_user_confirmation",
    });
  });

  it("omits expired pending_goal_change", async () => {
    getActiveCommitment.mockResolvedValue(
      activeCommitment({
        pending_resolution_kind: "commitment_replace",
        pending_resolution_created_at: "2026-06-01T12:00:00.000Z",
        pending_resolution_expires_at: "2026-06-10T12:00:00.000Z",
        pending_resolution_payload: {
          source: "sms_inbound",
          sms_state: "awaiting_confirmation",
          candidate_behavior_statement: "Stale candidate",
          detected_intent: "sms_replace_request",
          raw_user_text: "change",
          inbound_message_sid: "SM_IN",
          ai_confidence: 0.9,
        },
      })
    );
    setupPacketSupabase({ profile: {} });

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.hard_state.pending_goal_change).toBeNull();
  });

  it("excludes AI profile_hint and people_summary from personal_context", async () => {
    setupPacketSupabase({
      profile: {
        responsibility: "Parent first",
        people_summary: "AI generated summary should not appear",
        profile_hint: "AI hint should not appear",
      },
    });

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const values = result.packet.personal_context.map((c) => c.value).join("|");
    expect(values).not.toMatch(/AI generated summary|AI hint/i);
    expect(result.packet.personal_context.some((c) => c.type === "people_summary")).toBe(false);
    expect(result.packet.personal_context.some((c) => c.type === "profile_hint")).toBe(false);
  });

  it("dedupes partner_name against important_people", async () => {
    setupPacketSupabase({
      profile: { partner_name: "Jordan" },
      importantPeople: [
        { display_name: "Jordan", relationship_type: "spouse_partner" },
        { display_name: "Sam", relationship_type: "child" },
      ],
    });

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const people = result.packet.personal_context.filter((c) => c.type === "important_person");
    expect(people).toHaveLength(1);
    expect(people[0]?.value).toMatch(/Sam \(child\)/);
  });

  it("computes days_since and never_replied from last user response", async () => {
    fetchLastAnyUserReplyAt.mockResolvedValue("2026-06-20T10:00:00.000Z");
    setupPacketSupabase({ profile: {} });

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.last_user_response.never_replied).toBe(false);
    expect(result.packet.last_user_response.at_utc).toBe("2026-06-20T10:00:00.000Z");
    expect(result.packet.last_user_response.at_local).toBeTruthy();
    expect(result.packet.last_user_response.days_since).toBe(2);
  });

  it("sets never_replied when no prior user response", async () => {
    fetchLastAnyUserReplyAt.mockResolvedValue(null);
    setupPacketSupabase({ profile: {} });

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.last_user_response.never_replied).toBe(true);
    expect(result.packet.last_user_response.days_since).toBeNull();
  });

  it("clamps future last-reply timestamps so days_since is never negative", async () => {
    fetchLastAnyUserReplyAt.mockResolvedValue("2026-06-25T10:00:00.000Z");
    setupPacketSupabase({ profile: {} });

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.last_user_response.days_since).toBe(0);
    expect(result.packet.last_user_response.days_since).toBeGreaterThanOrEqual(0);
  });

  it("computes days_since vs message_for day across timezone boundaries", async () => {
    // 2026-06-21 03:00 UTC = 2026-06-20 evening in America/New_York
    fetchLastAnyUserReplyAt.mockResolvedValue("2026-06-21T03:00:00.000Z");
    setupPacketSupabase({ profile: {} });

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: "America/New_York",
      now: new Date("2026-06-22T16:00:00.000Z"),
      draftForDayKey: "2026-06-22",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.message_for.local_date).toBe("2026-06-22");
    expect(result.packet.last_user_response.days_since).toBe(2);
  });

  it("days_since uses message_for day, not generation evening when draft is tomorrow", async () => {
    fetchLastAnyUserReplyAt.mockResolvedValue("2026-08-03T00:02:10.072Z");
    setupPacketSupabase({ profile: {} });
    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: "America/New_York",
      now: new Date("2026-08-04T23:40:00.000Z"),
      draftForDayKey: "2026-08-05",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Reply local day Aug 2; message_for Aug 5 → 3 days
    expect(result.packet.last_user_response.days_since).toBe(3);
  });

  it("writer-facing exact_thread omits message_count and char_count extras", async () => {
    setupPacketSupabase({
      profile: {},
      sendRows: [
        {
          id: "s1",
          message_sid: "SM1",
          sms_body: "Coach note",
          created_at: "2026-06-21T12:00:00.000Z",
          status: "delivered",
        },
      ],
      inboundRows: [
        {
          id: "i1",
          raw_body: "User reply",
          received_at: "2026-06-21T13:00:00.000Z",
        },
      ],
    });

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.packet.exact_thread).sort()).toEqual([
      "max_messages",
      "messages",
      "omitted_older_turn_count",
      "window_days",
    ]);
    expect(result.packet.exact_thread).not.toHaveProperty("message_count");
    expect(result.packet.exact_thread).not.toHaveProperty("char_count");
    expect(JSON.stringify(result.packet.exact_thread)).not.toContain("message_count");
    expect(JSON.stringify(result.packet.exact_thread)).not.toContain("char_count");
    expect(result.packet.exact_thread.omitted_older_turn_count).toBe(0);
  });

  it("fails with no_active_commitment", async () => {
    getActiveCommitment.mockResolvedValue(null);
    setupPacketSupabase({});

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_none",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });

    expect(result).toEqual({ ok: false, error: "no_active_commitment" });
  });

  it("fails with missing_current_goal when goal is empty", async () => {
    getActiveCommitment.mockResolvedValue(
      activeCommitment({ behavior_statement: "   ", adaptive_ask_text: null })
    );
    setupPacketSupabase({});

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });

    expect(result).toEqual({ ok: false, error: "missing_current_goal" });
  });

  it("omits non-quotable identity sources", async () => {
    setupPacketSupabase({
      profile: {
        identity_anchor_text: "Derived from people summary",
        identity_source: "onboarding_people_summary_v2",
      },
    });

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.current_identity.text).toBeNull();
  });

  it("invalid timezone falls back via resolveUserTimezone for message_for", async () => {
    setupPacketSupabase({ profile: {} });
    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: "Not/A_Real_Zone",
      now: NOW,
      draftForDayKey: "2026-06-22",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.message_for.timezone).toBe("America/New_York");
  });

  it("production fixture Aug 3: Sunday tomorrow-quote is yesterday vs Monday message_for", async () => {
    const quote =
      "It's been a good week. Also I'm going to lift weights tomorrow morning for sure.";
    setupPacketSupabase({
      profile: { preferred_name: "Tyler" },
      inboundRows: [
        {
          raw_body: quote,
          received_at: "2026-08-02T16:01:29.298Z",
          message_sid: "SM_AUG2_TOMORROW",
        },
      ],
    });

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: "America/New_York",
      now: new Date("2026-08-03T10:23:00.000Z"),
      draftForDayKey: "2026-08-03",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.message_for).toEqual({
      timezone: "America/New_York",
      local_date: "2026-08-03",
      local_weekday: "Monday",
      daypart: "morning",
    });
    const turn = result.packet.exact_thread.messages.find((m) => m.body === quote);
    expect(turn).toBeTruthy();
    expect(turn?.local_day_key).toBe("2026-08-02");
    expect(turn?.day_relation_to_message).toBe("yesterday");
    expect(turn?.body).toBe(quote);
    expect(JSON.stringify(result.packet)).not.toContain("resolved_relative_reference");
    expect(JSON.stringify(result.packet)).not.toContain("relationship_category");
    expect(JSON.stringify(result.packet)).not.toContain("coaching_posture");
  });

  it("production fixture Aug 5: message_for is Wednesday; Aug 2 turns are 3 days before", async () => {
    const pride =
      "Also, I did a great thing today. I helped out a person at church who was having a really hard time.";
    setupPacketSupabase({
      profile: { preferred_name: "Tyler" },
      sendRows: [
        {
          sms_body:
            "It's inspiring to see how you're balancing your commitments and values, Tyler. Helping your family and contributing to the church shows your dedication to those you care about. Keep that momentum going as you lift weights tomorrow!",
          created_at: "2026-08-03T11:01:03.878Z",
          status: "sent",
          message_sid: "SM_AUG3",
          sent_at: "2026-08-03T11:01:03.878Z",
        },
        {
          sms_body: "Happy Tuesday! How is this week going?! Tell me ONE THING you're proud of.",
          created_at: "2026-08-04T11:01:07.766Z",
          status: "sent",
          message_sid: "SM_AUG4",
          sent_at: "2026-08-04T11:01:07.766Z",
        },
      ],
      inboundRows: [
        {
          raw_body: pride,
          received_at: "2026-08-02T15:58:34.070Z",
          message_sid: "SM_AUG2_PRIDE",
        },
      ],
    });

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: "America/New_York",
      now: new Date("2026-08-04T23:40:00.000Z"),
      draftForDayKey: "2026-08-05",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.message_for.local_date).toBe("2026-08-05");
    expect(result.packet.message_for.local_weekday).toBe("Wednesday");
    expect(result.packet.message_for.daypart).toBe("morning");
    expect(result.packet).not.toHaveProperty("current_local");

    const prideTurn = result.packet.exact_thread.messages.find((m) => m.body === pride);
    expect(prideTurn?.local_day_key).toBe("2026-08-02");
    expect(prideTurn?.day_relation_to_message).toBe("3 days before");
    expect(prideTurn?.body).toBe(pride);

    const aug3 = result.packet.exact_thread.messages.find((m) =>
      m.body.includes("lift weights tomorrow")
    );
    expect(aug3?.day_relation_to_message).toBe("2 days before");

    const packetJson = JSON.stringify(result.packet);
    expect(packetJson).not.toContain('"current_local"');
    expect(packetJson).not.toContain("relationship_category");
    expect(packetJson).not.toContain("coaching_posture");
    expect(packetJson).not.toContain("selected_move");
    expect(packetJson).not.toContain("open_loop");
  });

  it("merges Win history into historical_evidence with user evidence", async () => {
    setupPacketSupabase({
      profile: { preferred_name: "Pat" },
      evidenceRows: [
        {
          id: "e-out",
          occurred_at: "2026-05-01T16:00:00.000Z",
          source_message_sid: "SM_FALLEN",
          exact_user_evidence: "I like when you challenge me directly.",
          created_at: "2026-05-01T16:00:01.000Z",
        },
      ],
      winRows: [
        {
          id: "w1",
          occurred_at: "2026-04-01T16:00:00.000Z",
          action_fact: "Completed 40 seconds",
          supporting_quote: null,
          relationship_type: "goal",
          commitment_id: "cmt_morning",
          source_message_sid: "SM_WIN",
          sensitivity_caution: false,
        },
      ],
    });
    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.historical_evidence).toEqual([
      {
        source: "win",
        occurred_at: "2026-04-01",
        evidence: "Then-standard: One hour of focused writing each morning. Win: Completed 40 seconds",
      },
      {
        source: "user_message",
        occurred_at: "2026-05-01",
        evidence: "I like when you challenge me directly.",
        user_quote: "I like when you challenge me directly.",
      },
    ]);
  });

  it("omits a Win whose source SID is in the surviving exact thread", async () => {
    setupPacketSupabase({
      profile: { preferred_name: "Pat" },
      sendRows: [
        {
          sms_body: "How did writing go?",
          created_at: "2026-06-21T14:00:00.000Z",
          status: "sent",
          message_sid: "SM_COACH",
          sent_at: "2026-06-21T14:00:00.000Z",
        },
      ],
      inboundRows: [
        {
          raw_body: "Got an hour in before breakfast.",
          received_at: "2026-06-21T16:00:00.000Z",
          message_sid: "SM_USER",
          inserted_at: "2026-06-21T16:00:00.000Z",
        },
      ],
      winRows: [
        {
          id: "w-in",
          occurred_at: "2026-06-21T16:00:00.000Z",
          action_fact: "Got an hour in",
          supporting_quote: null,
          relationship_type: "goal",
          commitment_id: "cmt_morning",
          source_message_sid: "SM_USER",
          sensitivity_caution: false,
        },
      ],
    });
    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.historical_evidence).toEqual([]);
  });

  it("Win loader failure does not erase user evidence", async () => {
    setupPacketSupabase({
      profile: { preferred_name: "Pat" },
      evidenceRows: [
        {
          id: "e-out",
          occurred_at: "2026-05-01T16:00:00.000Z",
          source_message_sid: "SM_FALLEN",
          exact_user_evidence: "I like when you challenge me directly.",
          created_at: "2026-05-01T16:00:01.000Z",
        },
      ],
      winError: { message: "boom" },
    });
    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.historical_evidence).toEqual([
      {
        source: "user_message",
        occurred_at: "2026-05-01",
        evidence: "I like when you challenge me directly.",
        user_quote: "I like when you challenge me directly.",
      },
    ]);
  });

  it("empty Wins preserves Commit 2 user-evidence output", async () => {
    setupPacketSupabase({
      profile: { preferred_name: "Pat" },
      evidenceRows: [
        {
          id: "e-out",
          occurred_at: "2026-05-01T16:00:00.000Z",
          source_message_sid: "SM_FALLEN",
          exact_user_evidence: "I like when you challenge me directly.",
          created_at: "2026-05-01T16:00:01.000Z",
        },
      ],
      winRows: [],
    });
    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.historical_evidence).toEqual([
      {
        source: "user_message",
        occurred_at: "2026-05-01",
        evidence: "I like when you challenge me directly.",
        user_quote: "I like when you challenge me directly.",
      },
    ]);
  });

  it("Evening inherits Win history through the Morning loader", async () => {
    setupPacketSupabase({
      profile: { preferred_name: "Pat" },
      winRows: [
        {
          id: "w1",
          occurred_at: "2026-04-01T16:00:00.000Z",
          action_fact: "Completed 40 seconds",
          supporting_quote: null,
          relationship_type: "goal",
          commitment_id: "cmt_morning",
          source_message_sid: null,
          sensitivity_caution: false,
        },
      ],
    });
    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: TZ,
      now: NOW,
      draftForDayKey: "2026-06-22",
      daypart: "evening",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.message_for.daypart).toBe("evening");
    expect(result.packet.historical_evidence).toEqual([
      {
        source: "win",
        occurred_at: "2026-04-01",
        evidence: "Then-standard: One hour of focused writing each morning. Win: Completed 40 seconds",
      },
    ]);
  });
});

describe("dayRelationToMessage", () => {
  it("covers today / yesterday / N days before / tomorrow / N days after", async () => {
    const { dayRelationToMessage } = await import("@/lib/sms-recent-exact-thread-72h");
    expect(dayRelationToMessage("2026-08-03", "2026-08-03")).toBe("today");
    expect(dayRelationToMessage("2026-08-02", "2026-08-03")).toBe("yesterday");
    expect(dayRelationToMessage("2026-08-02", "2026-08-05")).toBe("3 days before");
    expect(dayRelationToMessage("2026-08-04", "2026-08-03")).toBe("tomorrow");
    expect(dayRelationToMessage("2026-08-06", "2026-08-03")).toBe("3 days after");
  });

  it("DST spring-forward does not corrupt calendar day relation (America/New_York)", async () => {
    const { dayRelationToMessage } = await import("@/lib/sms-recent-exact-thread-72h");
    // 2026-03-08 is US DST start; relation still calendar-day based on day keys
    expect(dayRelationToMessage("2026-03-07", "2026-03-09")).toBe("2 days before");
    expect(dayRelationToMessage("2026-03-08", "2026-03-09")).toBe("yesterday");
  });
});
