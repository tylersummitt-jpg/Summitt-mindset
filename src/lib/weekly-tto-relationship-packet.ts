/**
 * Weekly TTO relationship packet — Sunday perspective wrapper over Morning loaders.
 * Reuses loadMorningRelationshipPacket (21d exact thread, canonical goal/identity/people).
 * Does not mutate state. Does not build a weekly summary.
 */

import {
  loadMorningRelationshipPacket,
  weekdayLongFromLocalDayKey,
  type MorningRelationshipPacket,
} from "@/lib/morning-tto-relationship-packet";
import { loadRecentPlannedInterruptionSignalForCommitment } from "@/lib/sms-planned-interruption";
import {
  loadWeeklyAccountabilityEventsReadOnly,
  loadWeeklyCoachingMemoryProjectionReadOnly,
  type WeeklyAccountabilityEventV1,
} from "@/lib/weekly-tto-accountability-events";

export const WEEKLY_RELATIONSHIP_PACKET_VERSION = "weekly_relationship_v1" as const;
export const WEEKLY_RELATIONSHIP_ROUTE_KIND = "weekly_relationship" as const;
export const WEEKLY_BRIEF_WRITER_RAN_VERDICT_REASON = "weekly_brief_writer_ran" as const;

export type WeeklyTtoMessageFor = {
  timezone: string;
  /** Intended Sunday local date (week_end). */
  local_date: string;
  local_weekday: string;
  daypart: "weekly";
  week_start_local_date: string;
  week_end_local_date: string;
};

export type WeeklyPlannedInterruptionHardState = {
  active: boolean;
  occurred_at: string;
  reason_category: string | null;
  resume_hint: string | null;
} | null;

export type WeeklyCoachingMemoryProjection = {
  authority: "non_authoritative_projection";
  coaching_summary: string | null;
} | null;

export type WeeklyRelationshipPacket = Omit<
  MorningRelationshipPacket,
  "version" | "message_for" | "hard_state"
> & {
  version: typeof WEEKLY_RELATIONSHIP_PACKET_VERSION;
  message_for: WeeklyTtoMessageFor;
  hard_state: MorningRelationshipPacket["hard_state"] & {
    planned_interruption: WeeklyPlannedInterruptionHardState;
  };
  weekly_accountability_events: WeeklyAccountabilityEventV1[];
  coaching_memory_projection: WeeklyCoachingMemoryProjection;
};

export type LoadWeeklyRelationshipPacketArgs = {
  clerkUserId: string;
  timezone: string;
  weekStartLocalDate: string;
  weekEndLocalDate: string;
  now?: Date;
  commitmentId?: string | null;
};

export type LoadWeeklyRelationshipPacketResult =
  | { ok: true; packet: WeeklyRelationshipPacket; commitmentId: string }
  | { ok: false; error: string };

function plannedInterruptionFromSignal(
  row: Awaited<ReturnType<typeof loadRecentPlannedInterruptionSignalForCommitment>>
): WeeklyPlannedInterruptionHardState {
  if (!row) return null;
  const reason =
    typeof row.memorySignal.reason_category === "string" && row.memorySignal.reason_category.trim()
      ? row.memorySignal.reason_category.trim()
      : null;
  const resume =
    typeof row.memorySignal.resume_hint === "string" && row.memorySignal.resume_hint.trim()
      ? row.memorySignal.resume_hint.trim()
      : null;
  return {
    active: true,
    occurred_at: row.occurredAt,
    reason_category: reason,
    resume_hint: resume,
  };
}

/**
 * Load canonical Weekly packet for the intended Sunday (week_end).
 * Exact thread is anchored to Sunday via Morning packet draft_for_day_key — not generation wall clock.
 */
export async function loadWeeklyRelationshipPacket(
  args: LoadWeeklyRelationshipPacketArgs
): Promise<LoadWeeklyRelationshipPacketResult> {
  const weekEnd = args.weekEndLocalDate.trim();
  const weekStart = args.weekStartLocalDate.trim();
  if (!weekEnd || !weekStart) {
    return { ok: false, error: "invalid_week_span" };
  }

  const loaded = await loadMorningRelationshipPacket({
    clerkUserId: args.clerkUserId,
    timezone: args.timezone,
    now: args.now,
    draftForDayKey: weekEnd,
    commitmentId: args.commitmentId,
    daypart: "morning",
  });

  if (!loaded.ok) return loaded;

  const [events, interruptionRow, coachingMemory] = await Promise.all([
    loadWeeklyAccountabilityEventsReadOnly({
      commitmentId: loaded.commitmentId,
      clerkUserId: args.clerkUserId,
      timezone: args.timezone,
      weekStartLocalDate: weekStart,
      weekEndLocalDate: weekEnd,
    }),
    loadRecentPlannedInterruptionSignalForCommitment({
      commitmentId: loaded.commitmentId,
      clerkUserId: args.clerkUserId,
      now: args.now,
    }),
    loadWeeklyCoachingMemoryProjectionReadOnly({
      commitmentId: loaded.commitmentId,
    }),
  ]);

  const packet: WeeklyRelationshipPacket = {
    ...loaded.packet,
    version: WEEKLY_RELATIONSHIP_PACKET_VERSION,
    message_for: {
      timezone: loaded.packet.message_for.timezone,
      local_date: weekEnd,
      local_weekday: weekdayLongFromLocalDayKey(weekEnd),
      daypart: "weekly",
      week_start_local_date: weekStart,
      week_end_local_date: weekEnd,
    },
    hard_state: {
      ...loaded.packet.hard_state,
      planned_interruption: plannedInterruptionFromSignal(interruptionRow),
    },
    weekly_accountability_events: events,
    coaching_memory_projection: coachingMemory,
  };

  return { ok: true, packet, commitmentId: loaded.commitmentId };
}

/** Type-compatible Morning packet view for shared Brief assemblers (daypart morning for types only). */
export function weeklyPacketAsMorningAssemblerView(
  packet: WeeklyRelationshipPacket
): MorningRelationshipPacket {
  const { planned_interruption: _ignored, ...morningHardState } = packet.hard_state;
  return {
    ...packet,
    version: "morning_relationship_v1",
    message_for: {
      timezone: packet.message_for.timezone,
      local_date: packet.message_for.local_date,
      local_weekday: packet.message_for.local_weekday,
      daypart: "morning",
    },
    hard_state: morningHardState,
  };
}
