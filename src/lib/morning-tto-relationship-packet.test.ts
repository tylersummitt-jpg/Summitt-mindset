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

function chain(rows: unknown[] | unknown | null) {
  const result = { data: rows, error: null };
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () =>
      Promise.resolve(Array.isArray(rows) ? { data: rows[0] ?? null, error: null } : result),
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
}) {
  supabaseFrom.mockImplementation((table: string) => {
    switch (table) {
      case "user_profiles":
        return chain(args.profile ?? null);
      case "important_people":
        return chain(args.importantPeople ?? []);
      case "v2_commitment":
        return chain(activeCommitment());
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
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.packet.version).toBe("morning_relationship_v1");
    expect(result.packet.current_local.timezone).toBe(TZ);
    expect(result.packet.current_local.local_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.packet.current_local.local_weekday).toBeTruthy();
    expect(result.packet.current_local.local_time).toMatch(/^\d{2}:\d{2}$/);
    expect(result.packet.preferred_name).toBe("Pat");
    expect(result.packet.current_goal.text).toBe("One hour of focused writing each morning");
    expect(result.packet.current_identity.text).toBe("I am a steady father.");
    expect(result.packet.personal_context.some((c) => c.type === "responsibility")).toBe(true);
    expect(result.packet.exact_thread.window_days).toBe(21);
    expect(result.packet.exact_thread.max_messages).toBe(30);
    expect(result.commitmentId).toBe("cmt_morning");
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
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.last_user_response.days_since).toBe(0);
    expect(result.packet.last_user_response.days_since).toBeGreaterThanOrEqual(0);
  });

  it("computes days_since on local calendar day keys across timezone boundaries", async () => {
    // 2026-06-21 03:00 UTC = 2026-06-20 evening in America/New_York
    fetchLastAnyUserReplyAt.mockResolvedValue("2026-06-21T03:00:00.000Z");
    setupPacketSupabase({ profile: {} });

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_morning",
      timezone: "America/New_York",
      now: new Date("2026-06-22T16:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.last_user_response.days_since).toBe(2);
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
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.packet.exact_thread).sort()).toEqual([
      "max_messages",
      "messages",
      "window_days",
    ]);
    expect(result.packet.exact_thread).not.toHaveProperty("message_count");
    expect(result.packet.exact_thread).not.toHaveProperty("char_count");
    expect(JSON.stringify(result.packet.exact_thread)).not.toContain("message_count");
    expect(JSON.stringify(result.packet.exact_thread)).not.toContain("char_count");
  });

  it("fails with no_active_commitment", async () => {
    getActiveCommitment.mockResolvedValue(null);
    setupPacketSupabase({});

    const result = await loadMorningRelationshipPacket({
      clerkUserId: "user_none",
      timezone: TZ,
      now: NOW,
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
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.current_identity.text).toBeNull();
  });
});
