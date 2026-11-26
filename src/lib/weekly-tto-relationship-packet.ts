/**
 * Weekly TTO relationship packet — Sunday perspective wrapper over Morning loaders.
 * Reuses loadMorningRelationshipPacket (21d exact thread, canonical goal/identity/people).
 * Does not mutate state. Does not build a weekly summary.
 */

import {
  loadMorningRelationshipPacket,
  sundayContextEvidenceFromCoaching,
  weekdayLongFromLocalDayKey,
  type MorningRelationshipPacket,
  type MorningRelationshipPacketAssemblerView,
  type SundayCoachingContext,
  type SundayContextEvidence,
} from "@/lib/morning-tto-relationship-packet";
import {
  loadRecentPlannedInterruptionSignalForCommitment,
  loadSundayPlannedInterruption,
} from "@/lib/sms-planned-interruption";
import {
  loadSundayAccountabilityTape,
  loadWeeklyAccountabilityEventsReadOnly,
  loadWeeklyCoachingMemoryProjectionReadOnly,
  mondayThroughSundayEnding,
  type WeeklyAccountabilityEventV1,
} from "@/lib/weekly-tto-accountability-events";

export const WEEKLY_RELATIONSHIP_PACKET_VERSION = "weekly_relationship_v1" as const;
export const WEEKLY_RELATIONSHIP_ROUTE_KIND = "weekly_relationship" as const;
export const WEEKLY_BRIEF_WRITER_RAN_VERDICT_REASON = "weekly_brief_writer_ran" as const;

/**
 * Sunday-noon Sol slot context. Weekly cron hour=12 was not extracted (would require
 * changing the cron route). Keep this aligned with Sunday 12:00–12:14 send.
 */
export const WEEKLY_INTENDED_RECEIVE_TIME_LOCAL = "12:00" as const;

export type WeeklyTtoMessageFor = {
  timezone: string;
  /** Intended Sunday local date (week_end). */
  local_date: string;
  local_weekday: string;
  daypart: "weekly";
  week_start_local_date: string;
  week_end_local_date: string;
  /** Immutable Sunday-noon slot clock for Sol. Not the 12:00–12:14 send window. */
  intended_receive_time_local: typeof WEEKLY_INTENDED_RECEIVE_TIME_LOCAL;
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
      intended_receive_time_local: WEEKLY_INTENDED_RECEIVE_TIME_LOCAL,
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

function unavailableSundayCoaching(args: {
  weekStart: string;
  weekEnd: string;
  now: Date;
}): SundayCoachingContext {
  return {
    week_start_local_date: args.weekStart,
    week_end_local_date: args.weekEnd,
    information_available_through_utc: args.now.toISOString(),
    accountability_events: { status: "unavailable", events: [] },
    planned_interruption: {
      status: "unavailable",
      occurred_at: null,
      reason_category: null,
      resume_hint: null,
    },
  };
}

/**
 * Sunday deliveries only. Monday–Saturday return the same packet with no extra reads.
 * Does not copy the legacy coaching_memory_projection.
 */
export async function attachSundayCoachingContext(args: {
  packet: MorningRelationshipPacket;
  clerkUserId: string;
  commitmentId: string;
  now: Date;
}): Promise<MorningRelationshipPacket> {
  if (args.packet.message_for.local_weekday !== "Sunday") return args.packet;
  const period = mondayThroughSundayEnding(args.packet.message_for.local_date);
  if (!period || !args.commitmentId.trim()) {
    return {
      ...args.packet,
      sunday_coaching: unavailableSundayCoaching({
        weekStart: period?.weekStartLocalDate ?? args.packet.message_for.local_date,
        weekEnd: period?.weekEndLocalDate ?? args.packet.message_for.local_date,
        now: args.now,
      }),
    };
  }
  const [tape, interruption] = await Promise.all([
    loadSundayAccountabilityTape({
      commitmentId: args.commitmentId,
      clerkUserId: args.clerkUserId,
      timezone: args.packet.message_for.timezone,
      weekStartLocalDate: period.weekStartLocalDate,
      weekEndLocalDate: period.weekEndLocalDate,
      availableThrough: args.now,
    }),
    loadSundayPlannedInterruption({
      commitmentId: args.commitmentId,
      clerkUserId: args.clerkUserId,
      now: args.now,
    }),
  ]);
  const sunday_coaching: SundayCoachingContext = {
    week_start_local_date: period.weekStartLocalDate,
    week_end_local_date: period.weekEndLocalDate,
    information_available_through_utc: args.now.toISOString(),
    accountability_events:
      tape.status === "loaded"
        ? { status: "loaded", events: tape.events }
        : { status: "unavailable", events: [] },
    planned_interruption: interruption,
  };
  return { ...args.packet, sunday_coaching };
}

export function sundayContextEvidenceForDelivery(args: {
  coaching: SundayCoachingContext;
}): SundayContextEvidence {
  return sundayContextEvidenceFromCoaching(args.coaching);
}

/** Type-compatible Morning packet view for shared Brief assemblers (daypart morning for types only). */
export function weeklyPacketAsMorningAssemblerView(
  packet: WeeklyRelationshipPacket
): MorningRelationshipPacketAssemblerView {
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
