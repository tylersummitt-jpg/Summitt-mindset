import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

const loadWeeklyAccountabilityEventsReadOnly = vi.hoisted(() => vi.fn(async () => []));
const loadWeeklyCoachingMemoryProjectionReadOnly = vi.hoisted(() => vi.fn(async () => null));
const loadRecentPlannedInterruptionSignalForCommitment = vi.hoisted(() =>
  vi.fn(async () => null)
);

vi.mock("@/lib/weekly-tto-accountability-events", () => ({
  loadWeeklyAccountabilityEventsReadOnly,
  loadWeeklyCoachingMemoryProjectionReadOnly,
}));

vi.mock("@/lib/sms-planned-interruption", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sms-planned-interruption")>();
  return {
    ...actual,
    loadRecentPlannedInterruptionSignalForCommitment,
  };
});

const loadMorningRelationshipPacket = vi.hoisted(() => vi.fn());

vi.mock("@/lib/morning-tto-relationship-packet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/morning-tto-relationship-packet")>();
  return {
    ...actual,
    loadMorningRelationshipPacket,
  };
});

import type { MorningRelationshipPacket } from "@/lib/morning-tto-relationship-packet";
import {
  loadWeeklyRelationshipPacket,
  weeklyPacketAsMorningAssemblerView,
  WEEKLY_RELATIONSHIP_PACKET_VERSION,
} from "@/lib/weekly-tto-relationship-packet";

const REPO = process.cwd();

function morningPacket(overrides: Partial<MorningRelationshipPacket> = {}): MorningRelationshipPacket {
  return {
    version: "morning_relationship_v1",
    message_for: {
      timezone: "America/New_York",
      local_date: "2026-07-12",
      local_weekday: "Sunday",
      daypart: "morning",
    },
    last_user_response: {
      at_utc: "2026-07-10T16:00:00.000Z",
      at_local: "Jul 10, 12:00 PM",
      days_since: 2,
      never_replied: false,
    },
    preferred_name: "Sam",
    current_goal: { text: "Walk 20 minutes after dinner" },
    current_identity: { text: "I am a father who keeps his word" },
    personal_context: [{ type: "partner_name", value: "Brooke" }],
    hard_state: { pending_goal_change: null },
    exact_thread: {
      window_days: 21,
      max_messages: 30,
      omitted_older_turn_count: 0,
      messages: [
        {
          sender: "coach",
          sent_at_utc: "2026-07-06T12:00:00.000Z",
          sent_at_local: "Jul 6, 8:00 AM",
          local_day_key: "2026-07-06",
          local_weekday: "Monday",
          day_relation_to_message: "6_days_before",
          body: "Protect the walk tonight.",
        },
        {
          sender: "user",
          sent_at_utc: "2026-07-10T16:00:00.000Z",
          sent_at_local: "Jul 10, 12:00 PM",
          local_day_key: "2026-07-10",
          local_weekday: "Friday",
          day_relation_to_message: "2_days_before",
          body: "Broke my ankle. Surgery Monday.",
        },
      ],
    },
    ...overrides,
  };
}

describe("weekly-tto-relationship-packet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadMorningRelationshipPacket.mockResolvedValue({
      ok: true,
      packet: morningPacket(),
      commitmentId: "cmt_weekly",
    });
  });

  it("anchors message_for to the target Sunday, not generation wall clock", async () => {
    const fridayGenerate = new Date("2026-07-10T20:00:00.000Z");
    const result = await loadWeeklyRelationshipPacket({
      clerkUserId: "user_1",
      timezone: "America/New_York",
      weekStartLocalDate: "2026-07-06",
      weekEndLocalDate: "2026-07-12",
      now: fridayGenerate,
      commitmentId: "cmt_weekly",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.version).toBe(WEEKLY_RELATIONSHIP_PACKET_VERSION);
    expect(result.packet.message_for).toEqual({
      timezone: "America/New_York",
      local_date: "2026-07-12",
      local_weekday: "Sunday",
      daypart: "weekly",
      week_start_local_date: "2026-07-06",
      week_end_local_date: "2026-07-12",
    });
    expect(result.packet.message_for.local_date).not.toBe("2026-07-10");
    expect(loadMorningRelationshipPacket).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: "user_1",
        timezone: "America/New_York",
        now: fridayGenerate,
        draftForDayKey: "2026-07-12",
        commitmentId: "cmt_weekly",
        daypart: "morning",
      })
    );
  });

  it("reuses Morning 21-day exact thread and canonical facts without a weekly summary", async () => {
    const result = await loadWeeklyRelationshipPacket({
      clerkUserId: "user_1",
      timezone: "America/New_York",
      weekStartLocalDate: "2026-07-06",
      weekEndLocalDate: "2026-07-12",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.exact_thread.window_days).toBe(21);
    expect(result.packet.exact_thread.max_messages).toBe(30);
    expect(result.packet.current_goal.text).toBe("Walk 20 minutes after dinner");
    expect(result.packet.current_identity.text).toMatch(/father/);
    expect(result.packet.preferred_name).toBe("Sam");
    expect(result.packet.hard_state.pending_goal_change).toBeNull();
    expect(JSON.stringify(result.packet)).not.toMatch(/weekly_summary|weekly_score|weekly_story/);
  });

  it("keeps pending goal separate from current_goal", async () => {
    loadMorningRelationshipPacket.mockResolvedValue({
      ok: true,
      packet: morningPacket({
        hard_state: {
          pending_goal_change: {
            candidate_text: "Run three miles",
            status: "awaiting_user_confirmation",
          },
        },
      }),
      commitmentId: "cmt_weekly",
    });
    const result = await loadWeeklyRelationshipPacket({
      clerkUserId: "user_1",
      timezone: "America/New_York",
      weekStartLocalDate: "2026-07-06",
      weekEndLocalDate: "2026-07-12",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.packet.current_goal.text).toBe("Walk 20 minutes after dinner");
    expect(result.packet.hard_state.pending_goal_change?.candidate_text).toBe("Run three miles");
  });

  it("assembler view does not mutate weekly packet and only remaps types for shared Brief loaders", async () => {
    const result = await loadWeeklyRelationshipPacket({
      clerkUserId: "user_1",
      timezone: "America/New_York",
      weekStartLocalDate: "2026-07-06",
      weekEndLocalDate: "2026-07-12",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const before = JSON.stringify(result.packet);
    const view = weeklyPacketAsMorningAssemblerView(result.packet);
    expect(view.version).toBe("morning_relationship_v1");
    expect(view.message_for.daypart).toBe("morning");
    expect(view.message_for.local_date).toBe("2026-07-12");
    expect(JSON.stringify(result.packet)).toBe(before);
    expect(result.packet.message_for.daypart).toBe("weekly");
  });

  it("does not invent a weekly notebook table or 10-day memory packet", () => {
    const src = readFileSync(join(REPO, "src/lib/weekly-tto-relationship-packet.ts"), "utf8");
    expect(src).toContain("loadMorningRelationshipPacket");
    expect(src).not.toContain("buildSmsRelationshipMemoryPacket");
    expect(src).not.toContain("weekly_summary");
    expect(src).not.toContain("weekly_notebook");
    expect(src).not.toContain("exactThreadPath: \"weekly\"");
  });
});
