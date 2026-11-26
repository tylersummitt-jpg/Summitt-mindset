/**
 * Scheduled Morning and Evening generation.
 * Uses the accepted proactive calculator and the existing per-member generators.
 * Claims a draft before any interpreter or writer call.
 */

import { getClerkUser, listClerkUsersByIds } from "@/lib/clerk-rest";
import { evaluateScheduledDeliveryGrace } from "@/lib/daily-sms-scheduling";
import { dayKeyOffset } from "@/lib/sms-temporal-contract-v1";
import {
  PROACTIVE_SCHEDULE_ADMIN_TIMEZONE,
  proactiveOwnerForSendSlot,
  proactiveSendSlotForOwner,
  resolveProactiveSchedule,
  type ProactiveSchedulePreferenceRead,
  type ProactiveScheduleResult,
  type ProactiveSendSlot,
  type ProactiveTtoOwner,
  type ScheduledProactiveText,
} from "@/lib/sms-proactive-schedule";
import {
  MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE,
  resolveQuietRelationshipMechanicalFacts,
} from "@/lib/sms-proactive-relationship-touch";
import { supabaseServer } from "@/lib/supabase-server";
import {
  sundayContextChanged,
  sundayContextEvidenceFromCoaching,
  weekdayLongFromLocalDayKey,
  type SundayContextEvidence,
  type SundayCoachingContext,
} from "@/lib/morning-tto-relationship-packet";
import { loadSundayPlannedInterruption } from "@/lib/sms-planned-interruption";
import {
  loadSundayAccountabilityTape,
  mondayThroughSundayEnding,
} from "@/lib/weekly-tto-accountability-events";
import { formatLocalHourMinute, getDateKeyInTimezone } from "@/lib/timezone";
import {
  loadSendableTylerTextOverviewAudienceMembers,
  readMemberSmsSendability,
} from "@/lib/tyler-text-overview-admin";
import {
  TTO_GENERATE_ALL_CHUNK_USER_CAP,
  TTO_GENERATE_ALL_CONCURRENCY,
  TTO_GENERATE_ALL_TIME_BUDGET_MS,
  runPoolWithBudget,
  type TtoGenerateAllChunkResult,
} from "@/lib/tyler-text-overview-generate-all";
import {
  finishReconsiderationDecision,
  generateTylerTextOverviewDraftForUser,
  generateTylerTextOverviewEveningPreviewForUser,
  latestAffirmedDeliveryFromMetadata,
  minuteFromHhMm,
  originalModelDeliveryFromMetadata,
  readTylerEditDeliveryContext,
  currentBodyEditContextRequiresReconsideration,
  editContextBelongsToBodyVersion,
  evidenceApprovesCurrentBody,
  tylerEditDeliveryMateriallyDiffers,
  loadTylerTextOverviewAudienceRow,
  attemptedSundayFailureFields,
  failureAppliesToCurrentBody,
  reconsiderationFailureCount,
  reconsiderationFailureEvidence,
  successfulConsiderationEvidence,
  recordedInstantsMatch,
  type CrossOwnerSourceVersion,
  type TtoBodyVersion,
  type TtoInputEvidence,
  type TtoReconsiderationFence,
  type TylerTextOverviewAudienceRow,
} from "@/lib/tyler-text-overview-generate";
import { parseWeeklySchedule, resolveAccountSmsTimezone } from "@/lib/sms-account-schedule";
import {
  bodyFromSendEventRow,
  bodyFromWeeklySendEventRow,
  coachJobReplyStrongDeliveryEvidence,
  isProactiveConversationComplianceBody,
  isSendEventStrongDeliveryEvidence,
  MORNING_TTO_THREAD_WINDOW_HOURS,
  timestampFromCoachJobReplyRow,
  timestampFromInboundMessageRow,
  timestampFromSendEventRow,
} from "@/lib/sms-recent-exact-thread-72h";
import type { V2UserSmsCommsPreferencesRead } from "@/lib/v2-sms-comms-preferences";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import {
  isTylerTextOverviewEnabled,
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";
import {
  readActiveCommitmentForCadence,
  readLastV2CheckSentForCadence,
  type ActiveV2CommitmentRow,
} from "@/lib/v2-commitment";
import { shouldSendV2CadenceToday } from "@/lib/v2-cadence";
import {
  readV2UserSmsCommsPreferences,
  shouldApplyUserCadenceOverride,
} from "@/lib/v2-sms-comms-preferences";

export const SCHEDULED_GENERATION_CONVENTION = "member_local_delivery_v1" as const;
export const SMS_TTO_GENERATION_BATCHES_TABLE = "sms_tto_generation_batches" as const;

export const TERMINAL_OCCURRENCE_STATES = [
  "generated",
  "intentional_space",
  "protected",
  "failed",
  "sent",
  "legacy_conflict",
  "expired",
  "ineligible",
] as const;

export type OccurrenceState =
  | "pending"
  | "claimed"
  | (typeof TERMINAL_OCCURRENCE_STATES)[number];

export type GenerationTrigger = "automatic_schedule" | "manual_schedule";

export type ScheduledOccurrence = {
  clerkUserId: string;
  memberLocalDate: string;
  utcInstant: string;
  selectedLocalMinute: number;
  effectiveLocalMinute: number;
  timeZone: string;
  state: OccurrenceState;
  initialSet: boolean;
  claimOwnerId: string | null;
  claimExpiresAt: string | null;
  detail: string | null;
  initialOutcome?: string | null;
  patchKind?: BatchPatchKind;
};

export type BatchPatchKind =
  | "reconcile"
  | "claim"
  | "result"
  | "eligibility"
  | "retry_claim"
  | "delivery";

export type NonScheduledMember = {
  clerkUserId: string;
  classification: "unscheduled" | "unresolved";
  reason: string;
};

export type ScheduledBatchRecord = {
  id: string;
  batchDate: string;
  sendSlot: ProactiveSendSlot;
  openedTrigger: GenerationTrigger;
  windowEndsAt: string;
  startedAt: string;
  initialCompletedAt: string | null;
  initialCompletedTrigger: GenerationTrigger | null;
  relevantMemberCount: number;
  scheduledMemberCount: number;
  scheduledOccurrenceCount: number;
  occurrences: ScheduledOccurrence[];
  nonScheduled: NonScheduledMember[];
};

export type ScheduledGenerationWindow =
  | { active: false }
  | { active: true; owner: ProactiveTtoOwner; batchDate: string };

type ClaimOutcome =
  | "claimed"
  | "busy"
  | "generated"
  | "intentional_space"
  | "protected"
  | "sent"
  | "legacy_conflict"
  | "failed"
  | "noncurrent"
  | "ineligible";

type ClaimResult = {
  outcome: ClaimOutcome;
  generationId: string | null;
  reason: string | null;
  claimExpiresAt?: string | null;
};

type CurrentDraftView = {
  body: string | null;
  generationId: string | null;
  machineShouldSend: boolean;
  machineNoSendReason: string | null;
  protected: boolean;
};

export type RevalidateResult =
  | { action: "ready" }
  | { action: "unresolved" }
  | { action: "ineligible"; reason: string }
  | { action: "expired" }
  | {
      action: "rescheduled";
      utcInstant: string;
      selectedLocalMinute: number;
      effectiveLocalMinute: number;
      timeZone: string;
    };

type ModelOutcome = {
  outcome: OccurrenceState;
  body: string | null;
  generationId: string | null;
  machineShouldSend: boolean;
  machineNoSendReason: string | null;
  error: string | null;
  recoverable?: boolean;
};

export type ScheduledBatchDeps = {
  readBatch: () => Promise<ScheduledBatchRecord | null>;
  openBatch: (batch: ScheduledBatchRecord) => Promise<ScheduledBatchRecord>;
  patchBatch: (
    patches: ScheduledOccurrence[],
    append: ScheduledOccurrence[]
  ) => Promise<ScheduledBatchRecord>;
  claim: (
    occurrence: ScheduledOccurrence,
    claimOwnerId: string,
    allowFailedRetry: boolean
  ) => Promise<ClaimResult>;
  generate: (
    occurrence: ScheduledOccurrence,
    claimOwnerId: string
  ) => Promise<ModelOutcome>;
  revalidate?: (occurrence: ScheduledOccurrence) => Promise<RevalidateResult>;
  readCurrentDraft?: (occurrence: ScheduledOccurrence) => Promise<CurrentDraftView | null>;
};

function occurrenceKey(clerkUserId: string, memberLocalDate: string): string {
  return `${clerkUserId}:${memberLocalDate}`;
}

function normalizeOccurrenceKey(key: string): string {
  const trimmed = key.trim();
  const divider = trimmed.indexOf("|");
  if (divider <= 0) return trimmed;
  return occurrenceKey(trimmed.slice(0, divider), trimmed.slice(divider + 1));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

/** Eastern wall clock. Evening 05:00–09:59. Morning 16:00–20:59. */
export function resolveScheduledGenerationWindow(now: Date): ScheduledGenerationWindow {
  const easternDate = getDateKeyInTimezone(now, PROACTIVE_SCHEDULE_ADMIN_TIMEZONE);
  const clock = formatLocalHourMinute(now, PROACTIVE_SCHEDULE_ADMIN_TIMEZONE);
  const hour = Number(clock.slice(0, 2));
  if (!Number.isInteger(hour)) return { active: false };
  if (hour >= 5 && hour <= 9) {
    return {
      active: true,
      owner: "evening",
      batchDate: easternDate,
    };
  }
  if (hour >= 16 && hour <= 20) {
    return {
      active: true,
      owner: "morning",
      batchDate: dayKeyOffset(easternDate, 1),
    };
  }
  return { active: false };
}

function easternOffsetMs(instant: Date): number | null {
  const name =
    new Intl.DateTimeFormat("en-US", {
      timeZone: PROACTIVE_SCHEDULE_ADMIN_TIMEZONE,
      timeZoneName: "shortOffset",
      hour: "2-digit",
    })
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value ?? "";
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * ((Number(match[2]) * 60 + Number(match[3] ?? "0")) * 60 * 1000);
}

/** First instant the authorized window is closed. Evening 10:00, Morning 21:00 Eastern. */
export function scheduledBatchWindowEndsAt(
  batchDate: string,
  owner: ProactiveTtoOwner
): string {
  const dateKey = owner === "evening" ? batchDate : dayKeyOffset(batchDate, -1);
  const hour = owner === "evening" ? 10 : 21;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error("invalid_batch_window");
  const label = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, 0, 0);
  const first = easternOffsetMs(new Date(label));
  const second = first == null ? null : easternOffsetMs(new Date(label - first));
  const offset = second ?? first;
  if (offset == null) throw new Error("invalid_batch_window");
  return new Date(label - offset).toISOString();
}

export function interpretBatchProgress(args: {
  initialCompletedAt: string | null;
  windowEndsAt: string | null;
  now: Date;
}): "completed" | "incomplete_after_window" | "active" {
  if (args.initialCompletedAt) return "completed";
  const end = Date.parse(args.windowEndsAt ?? "");
  if (Number.isFinite(end) && args.now.getTime() >= end) return "incomplete_after_window";
  return "active";
}

export function legacyCadenceEligibilityForDate(args: {
  explicitSchedule: boolean;
  cadenceOverride: "daily" | "every_other_day" | "every_3_days" | null;
  behaviorStatement: string | null;
  appliedCadence: "daily" | "every_other_day" | "every_3_days" | null;
  history: { ok: true; dayKey: string | null } | { ok: false };
  memberLocalDate: string;
}): "not_applicable" | "eligible" | "not_due" | "unresolved" {
  if (args.explicitSchedule) return "not_applicable";
  if (args.cadenceOverride !== "every_other_day" && args.cadenceOverride !== "every_3_days") {
    return "not_applicable";
  }
  if (!args.behaviorStatement?.trim()) return "eligible";
  if (!args.history.ok) return "unresolved";
  const level =
    args.appliedCadence === "every_other_day" || args.appliedCadence === "every_3_days"
      ? args.appliedCadence
      : args.cadenceOverride;
  return shouldSendV2CadenceToday({
    lastSuccessfulCheckSentDayKey: args.history.dayKey,
    todayLocalDayKey: args.memberLocalDate,
    cadenceLevel: level,
  })
    ? "eligible"
    : "not_due";
}

export function legacyCadenceDecisionFromCommitment(args: {
  explicitSchedule: boolean;
  cadenceOverride: "daily" | "every_other_day" | "every_3_days" | null;
  commitment: { ok: true; behaviorStatement: string | null } | { ok: false };
  appliedCadence: "daily" | "every_other_day" | "every_3_days" | null;
  history: { ok: true; dayKey: string | null } | { ok: false };
  memberLocalDate: string;
}): "not_applicable" | "eligible" | "not_due" | "unresolved" {
  if (args.explicitSchedule) return "not_applicable";
  if (args.cadenceOverride !== "every_other_day" && args.cadenceOverride !== "every_3_days") {
    return "not_applicable";
  }
  if (!args.commitment.ok) return "unresolved";
  return legacyCadenceEligibilityForDate({
    explicitSchedule: false,
    cadenceOverride: args.cadenceOverride,
    behaviorStatement: args.commitment.behaviorStatement,
    appliedCadence: args.appliedCadence,
    history: args.history,
    memberLocalDate: args.memberLocalDate,
  });
}

export function scheduledMemberEligibility(args: {
  sms: { ok: true; sendable: boolean } | { ok: false };
  commitment: { ok: true; behaviorStatement: string | null } | { ok: false };
}): "eligible" | "ineligible" | "unresolved" {
  if (!args.sms.ok || !args.commitment.ok) return "unresolved";
  if (!args.sms.sendable) return "ineligible";
  if (!args.commitment.behaviorStatement?.trim()) return "ineligible";
  return "eligible";
}

export function eveningPreviewIsReady(args: {
  state: OccurrenceState;
  preview: {
    body: string | null;
    machineNoSendReason: string | null;
    protected: boolean;
  } | null;
}): boolean {
  // Batch state is not evidence. A missing or unreadable draft is not ready.
  void args.state;
  const preview = args.preview;
  if (!preview) return false;
  if (preview.protected) return true;
  if (preview.machineNoSendReason === MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE) return true;
  if (preview.machineNoSendReason === "scheduled_generation_claim") return false;
  return typeof preview.body === "string" && preview.body.trim().length > 0;
}

export function isUncertainPersistence(reason: string | null, error: string | null): boolean {
  const text = `${reason ?? ""} ${error ?? ""}`.toLowerCase();
  if (text.includes("account_deletion")) return false;
  return (
    text.includes("stale_claim_owner") ||
    text.includes("upsert_failed") ||
    text.includes("insert_failed") ||
    text.includes("timeout") ||
    text.includes("network") ||
    text.includes("fetch failed") ||
    text.includes("scheduled_batch_response_invalid") ||
    text.includes("tto_finish_generation_persistence")
  );
}

const PREVIEW_SAVED_STATES = new Set<OccurrenceState>([
  "generated",
  "protected",
  "intentional_space",
  "sent",
]);

/**
 * Choose the preview occurrence before any claim or model call.
 * An explicit member-local date never falls through. An omitted date stays
 * on the previous unambiguous rule and refuses an ambiguous member.
 */
export function decideScheduledPreviewWork(args: {
  occurrences: ScheduledOccurrence[];
  clerkUserId: string;
  postedBatchDate: string;
  memberLocalDate?: string | null;
  now: Date;
}):
  | { action: "none" }
  | { action: "ambiguous"; dates: string[] }
  | {
      action: "read_existing" | "generate" | "not_ready";
      occurrence: ScheduledOccurrence;
      otherDates: string[];
    } {
  const choice = selectPreviewOccurrence({
    occurrences: args.occurrences,
    clerkUserId: args.clerkUserId,
    postedBatchDate: args.postedBatchDate,
    memberLocalDate: args.memberLocalDate,
  });
  if (choice.kind === "none") return { action: "none" };
  if (choice.kind === "ambiguous") return { action: "ambiguous", dates: choice.dates };
  if (PREVIEW_SAVED_STATES.has(choice.occurrence.state)) {
    return {
      action: "read_existing",
      occurrence: choice.occurrence,
      otherDates: choice.otherDates,
    };
  }
  const recoverable = selectRecoverableOccurrences({
    occurrences: [choice.occurrence],
    now: args.now,
    limit: 1,
    includeFailed: true,
  });
  return {
    action: recoverable.length === 1 ? "generate" : "not_ready",
    occurrence: choice.occurrence,
    otherDates: choice.otherDates,
  };
}

/**
 * A manual preview may open a batch only after one recoverable occurrence
 * has already been identified. Any other shape refuses before the open.
 */
export function exactPreviewCanOpenBatch(args: {
  discovered: ScheduledOccurrence[];
  clerkUserIds?: string[] | null;
  memberLocalDate: string;
  now: Date;
}): boolean {
  const requested = args.memberLocalDate.trim();
  if (!requested) return false;
  const only = (args.clerkUserIds ?? []).map((id) => id.trim()).filter(Boolean);
  const onlySet = only.length > 0 ? new Set(only) : null;
  const mine = args.discovered.filter((item) => {
    if (onlySet && !onlySet.has(item.clerkUserId)) return false;
    return item.memberLocalDate === requested;
  });
  if (mine.length !== 1) return false;
  return (
    selectRecoverableOccurrences({
      occurrences: mine,
      now: args.now,
      limit: 1,
    }).length === 1
  );
}

export function selectPreviewOccurrence(args: {
  occurrences: ScheduledOccurrence[];
  clerkUserId: string;
  postedBatchDate: string;
  /** When set, only this member-local date matches. Never falls through to another text. */
  memberLocalDate?: string | null;
}):
  | { kind: "one"; occurrence: ScheduledOccurrence; otherDates: string[] }
  | { kind: "none" }
  | { kind: "ambiguous"; dates: string[] } {
  const mine = args.occurrences.filter((item) => item.clerkUserId === args.clerkUserId);
  if (mine.length === 0) return { kind: "none" };
  const requested = args.memberLocalDate?.trim() ?? "";
  if (requested) {
    const exact = mine.filter((item) => item.memberLocalDate === requested);
    if (exact.length === 1) {
      return {
        kind: "one",
        occurrence: exact[0]!,
        otherDates: mine
          .filter((item) => item.memberLocalDate !== requested)
          .map((item) => item.memberLocalDate),
      };
    }
    if (exact.length === 0) return { kind: "none" };
    return { kind: "ambiguous", dates: exact.map((item) => item.memberLocalDate) };
  }
  const matched = mine.filter((item) => item.memberLocalDate === args.postedBatchDate);
  if (matched.length === 1) {
    return {
      kind: "one",
      occurrence: matched[0]!,
      otherDates: mine
        .filter((item) => item.memberLocalDate !== matched[0]!.memberLocalDate)
        .map((item) => item.memberLocalDate),
    };
  }
  if (mine.length === 1) return { kind: "one", occurrence: mine[0]!, otherDates: [] };
  return { kind: "ambiguous", dates: mine.map((item) => item.memberLocalDate) };
}

export function scheduledOccurrenceFromResult(
  result: ProactiveScheduleResult,
  owner: ProactiveTtoOwner,
  batchDate: string,
  now: Date
):
  | { keep: false }
  | { keep: true; occurrence: Omit<ScheduledOccurrence, "clerkUserId" | "state" | "initialSet" | "claimOwnerId" | "claimExpiresAt" | "detail">; expired: boolean } {
  if (result.kind !== "scheduled") return { keep: false };
  if (result.owner !== owner || result.batchDate !== batchDate) return { keep: false };
  const instant = Date.parse(result.utcInstant);
  return {
    keep: true,
    expired: !Number.isFinite(instant) || instant <= now.getTime(),
    occurrence: {
      memberLocalDate: result.memberLocalDate,
      utcInstant: result.utcInstant,
      selectedLocalMinute: result.selectedLocalMinute,
      effectiveLocalMinute: result.effectiveLocalMinute,
      timeZone: result.timeZone,
    },
  };
}

export function memberLocalDatesForBatch(batchDate: string): string[] {
  return [dayKeyOffset(batchDate, -1), batchDate, dayKeyOffset(batchDate, 1)];
}

export function planMemberSchedule(args: {
  clerkUserId: string;
  results: ProactiveScheduleResult[];
  owner: ProactiveTtoOwner;
  batchDate: string;
  now: Date;
}): { occurrences: ScheduledOccurrence[]; nonScheduled: NonScheduledMember | null } {
  const kept = args.results
    .map((result) => scheduledOccurrenceFromResult(result, args.owner, args.batchDate, args.now))
    .filter((item): item is Extract<typeof item, { keep: true }> => item.keep);
  if (kept.length > 0) {
    return {
      occurrences: kept.map((item) => ({
        clerkUserId: args.clerkUserId,
        ...item.occurrence,
        state: item.expired ? "expired" : "pending",
        initialSet: true,
        claimOwnerId: null,
        claimExpiresAt: null,
        detail: item.expired ? "utc_instant_passed" : null,
      })),
      nonScheduled: null,
    };
  }
  const unresolved = args.results.find((result) => result.kind === "unresolved");
  if (unresolved && unresolved.kind === "unresolved") {
    return {
      occurrences: [],
      nonScheduled: {
        clerkUserId: args.clerkUserId,
        classification: "unresolved",
        reason: unresolved.reason,
      },
    };
  }
  const unscheduled = args.results.find((result) => result.kind === "unscheduled");
  if (unscheduled && unscheduled.kind === "unscheduled") {
    return {
      occurrences: [],
      nonScheduled: {
        clerkUserId: args.clerkUserId,
        classification: "unscheduled",
        reason: unscheduled.reason,
      },
    };
  }
  return { occurrences: [], nonScheduled: null };
}

export function buildScheduledGenerationMetadata(args: {
  scheduled: ScheduledProactiveText;
  trigger: GenerationTrigger;
}): Record<string, unknown> {
  return {
    scheduled_generation_convention: SCHEDULED_GENERATION_CONVENTION,
    generation_trigger: args.trigger,
    record_kind: "scheduled_generation",
    member_local_date: args.scheduled.memberLocalDate,
    selected_local_minute: args.scheduled.selectedLocalMinute,
    effective_local_minute: args.scheduled.effectiveLocalMinute,
    time_zone: args.scheduled.timeZone,
    utc_instant: args.scheduled.utcInstant,
    tto_owner: args.scheduled.owner,
    administrative_batch_date: args.scheduled.batchDate,
  };
}

export function selectRecoverableOccurrences(args: {
  occurrences: ScheduledOccurrence[];
  now: Date;
  limit: number;
  alreadyTouched?: ReadonlySet<string>;
  includeFailed?: boolean;
  /** Confirmed failed occurrences only. Does not include pending or claimed work. */
  failedOnly?: boolean;
  excludeOccurrenceKeys?: ReadonlySet<string>;
}): ScheduledOccurrence[] {
  const nowMs = args.now.getTime();
  const touched = args.alreadyTouched ?? new Set<string>();
  const excluded = args.excludeOccurrenceKeys ?? new Set<string>();
  const recoverable = args.occurrences.filter((occurrence) => {
    const key = occurrenceKey(occurrence.clerkUserId, occurrence.memberLocalDate);
    if (touched.has(key) || excluded.has(key)) return false;
    if (args.failedOnly === true) return occurrence.state === "failed";
    const instant = Date.parse(occurrence.utcInstant);
    const inGrace = scheduledOccurrenceGraceOpen({
      now: new Date(nowMs),
      utcInstant: occurrence.utcInstant,
      memberLocalDate: occurrence.memberLocalDate,
      timeZone: occurrence.timeZone,
    });
    if (!Number.isFinite(instant) || (instant <= nowMs && !inGrace)) return false;
    if (occurrence.state === "sent" || occurrence.state === "expired" || occurrence.state === "ineligible" || occurrence.state === "legacy_conflict") {
      return false;
    }
    if (occurrence.state === "pending") return true;
    if (occurrence.state === "failed") return args.includeFailed === true || inGrace;
    if (occurrence.state !== "claimed") return false;
    const expires = Date.parse(occurrence.claimExpiresAt ?? "");
    return !Number.isFinite(expires) || expires <= nowMs;
  });
  recoverable.sort((a, b) => {
    if (a.initialSet !== b.initialSet) return a.initialSet ? -1 : 1;
    const rank = (state: OccurrenceState) => (state === "pending" ? 0 : state === "claimed" ? 1 : 2);
    const byState = rank(a.state) - rank(b.state);
    if (byState !== 0) return byState;
    const user = a.clerkUserId.localeCompare(b.clerkUserId);
    if (user !== 0) return user;
    return a.memberLocalDate.localeCompare(b.memberLocalDate);
  });
  return recoverable.slice(0, Math.max(0, args.limit));
}

export function initialPassIsComplete(occurrences: ScheduledOccurrence[]): boolean {
  return occurrences.every((occurrence) => {
    if (!occurrence.initialSet) return true;
    return occurrence.state !== "pending" && occurrence.state !== "claimed";
  });
}

function preferenceReadFromRow(
  read: Awaited<ReturnType<typeof readV2UserSmsCommsPreferences>>
): ProactiveSchedulePreferenceRead {
  if (!read.ok) return { ok: false };
  if (!read.row) return { ok: true, row: null };
  const row = read.row;
  return {
    ok: true,
    row: {
      weekly_schedule: row.weekly_schedule_invalid ? { invalid: true } : (row.weekly_schedule ?? null),
      schedule_timezone: row.schedule_timezone ?? null,
      pause_indefinite: row.pause_indefinite === true,
      pause_until: row.pause_until,
      cadence_override: row.cadence_override,
      weekend_send_policy: row.weekend_send_policy,
    },
  };
}

function occurrenceFromJson(value: unknown): ScheduledOccurrence | null {
  const row = asRecord(value);
  if (!row) return null;
  const clerkUserId = asString(row.clerk_user_id) ?? asString(row.clerkUserId);
  const memberLocalDate = asString(row.member_local_date) ?? asString(row.memberLocalDate);
  const utcInstant = asString(row.utc_instant) ?? asString(row.utcInstant);
  const state = asString(row.state);
  if (!clerkUserId || !memberLocalDate || !utcInstant || !state) return null;
  return {
    clerkUserId,
    memberLocalDate,
    utcInstant,
    selectedLocalMinute: asNumber(row.selected_local_minute) ?? asNumber(row.selectedLocalMinute) ?? 0,
    effectiveLocalMinute:
      asNumber(row.effective_local_minute) ?? asNumber(row.effectiveLocalMinute) ?? 0,
    timeZone: asString(row.time_zone) ?? asString(row.timeZone) ?? "",
    state: state as OccurrenceState,
    initialSet: row.initial_set == null && row.initialSet == null
      ? true
      : asBoolean(row.initial_set ?? row.initialSet),
    claimOwnerId: asString(row.claim_owner_id) ?? asString(row.claimOwnerId),
    claimExpiresAt: asString(row.claim_expires_at) ?? asString(row.claimExpiresAt),
    detail: asString(row.detail),
    initialOutcome: asString(row.initial_outcome) ?? asString(row.initialOutcome),
  };
}

function occurrenceToJson(occurrence: ScheduledOccurrence): Record<string, unknown> {
  return {
    clerk_user_id: occurrence.clerkUserId,
    member_local_date: occurrence.memberLocalDate,
    utc_instant: occurrence.utcInstant,
    selected_local_minute: occurrence.selectedLocalMinute,
    effective_local_minute: occurrence.effectiveLocalMinute,
    time_zone: occurrence.timeZone,
    state: occurrence.state,
    initial_set: occurrence.initialSet,
    claim_owner_id: occurrence.claimOwnerId,
    claim_expires_at: occurrence.claimExpiresAt,
    detail: occurrence.detail,
    initial_outcome: occurrence.initialOutcome ?? null,
    ...(occurrence.patchKind ? { patch_kind: occurrence.patchKind } : {}),
  };
}

function batchFromJson(value: unknown): ScheduledBatchRecord | null {
  const row = asRecord(value);
  if (!row) return null;
  const occurrencesRaw = Array.isArray(row.occurrences) ? row.occurrences : [];
  const nonRaw = Array.isArray(row.non_scheduled) ? row.non_scheduled : [];
  const occurrences = occurrencesRaw
    .map(occurrenceFromJson)
    .filter((item): item is ScheduledOccurrence => item != null);
  const nonScheduled: NonScheduledMember[] = [];
  for (const item of nonRaw) {
    const record = asRecord(item);
    const clerkUserId = asString(record?.clerk_user_id);
    const classification = asString(record?.classification);
    const reason = asString(record?.reason);
    if (!clerkUserId || !reason) continue;
    if (classification !== "unscheduled" && classification !== "unresolved") continue;
    nonScheduled.push({ clerkUserId, classification, reason });
  }
  const batchDate = asString(row.batch_date);
  const sendSlot = asString(row.send_slot);
  const startedAt = asString(row.started_at);
  if (!batchDate || !startedAt) return null;
  if (sendSlot !== SMS_DAILY_PRODUCTION_SEND_SLOT && sendSlot !== SMS_DAILY_EVENING_PREVIEW_SEND_SLOT) {
    return null;
  }
  return {
    id: asString(row.id) ?? "",
    batchDate,
    sendSlot,
    openedTrigger:
      asString(row.opened_trigger) === "manual_schedule" ? "manual_schedule" : "automatic_schedule",
    windowEndsAt: asString(row.window_ends_at) ?? "",
    startedAt,
    initialCompletedAt: asString(row.initial_completed_at),
    initialCompletedTrigger:
      asString(row.initial_completed_trigger) === "manual_schedule"
        ? "manual_schedule"
        : asString(row.initial_completed_trigger) === "automatic_schedule"
          ? "automatic_schedule"
          : null,
    relevantMemberCount: asNumber(row.relevant_member_count) ?? 0,
    scheduledMemberCount: asNumber(row.scheduled_member_count) ?? 0,
    scheduledOccurrenceCount: asNumber(row.scheduled_occurrence_count) ?? 0,
    occurrences,
    nonScheduled,
  };
}

function claimState(outcome: ClaimOutcome): OccurrenceState | null {
  if (outcome === "claimed" || outcome === "busy") return null;
  if (outcome === "noncurrent") return "legacy_conflict";
  return outcome;
}

function modelState(result: ModelOutcome): OccurrenceState {
  if (result.error && result.error.includes("stale_claim_owner")) return "claimed";
  return result.outcome;
}

function countStates(occurrences: ScheduledOccurrence[]) {
  const counts = {
    generated: 0,
    intentional_space: 0,
    protected: 0,
    failed: 0,
    sent: 0,
    legacy_conflict: 0,
    expired: 0,
    ineligible: 0,
    pending: 0,
    claimed: 0,
  };
  for (const occurrence of occurrences) {
    if (occurrence.state in counts) {
      counts[occurrence.state as keyof typeof counts] += 1;
    }
  }
  return counts;
}

export async function executeScheduledBatch(args: {
  now: Date;
  batchDate: string;
  owner: ProactiveTtoOwner;
  trigger: GenerationTrigger;
  relevantMemberCount: number;
  discovered: ScheduledOccurrence[];
  nonScheduled: NonScheduledMember[];
  timeBudgetMs?: number;
  nowMs?: () => number;
  chunkUserCap?: number;
  concurrency?: number;
  onlyClerkUserIds?: string[] | null;
  excludeOccurrenceKeys?: string[] | null;
  failedOnly?: boolean;
  /** Preview only: claim and generate this member-local date, and no other occurrence. */
  onlyMemberLocalDate?: string | null;
  deps: ScheduledBatchDeps;
}): Promise<{
  batch: ScheduledBatchRecord;
  processed: number;
  previews: Array<{
    clerkUserId: string;
    memberLocalDate: string;
    body: string | null;
    generationId: string | null;
    machineShouldSend: boolean;
    machineNoSendReason: string | null;
    protected: boolean;
  }>;
  failures: Array<{ clerkUserId: string; memberLocalDate: string; error: string }>;
}> {
  const nowMs = args.nowMs ?? (() => Date.now());
  const budget = args.timeBudgetMs ?? TTO_GENERATE_ALL_TIME_BUDGET_MS;
  const chunkCap = args.chunkUserCap ?? TTO_GENERATE_ALL_CHUNK_USER_CAP;
  const concurrency = args.concurrency ?? TTO_GENERATE_ALL_CONCURRENCY;
  const startedMs = nowMs();
  const claimOwnerId = crypto.randomUUID();
  const only = args.onlyClerkUserIds?.filter((id) => id.trim()) ?? null;
  const onlySet = only && only.length > 0 ? new Set(only) : null;
  const exactMemberLocalDate = args.onlyMemberLocalDate?.trim() || null;

  let batch = await args.deps.readBatch();
  if (!batch && args.failedOnly === true) {
    throw new Error("no_scheduled_batch");
  }
  if (!batch && exactMemberLocalDate) {
    const mayOpen = exactPreviewCanOpenBatch({
      discovered: args.discovered,
      clerkUserIds: only,
      memberLocalDate: exactMemberLocalDate,
      now: args.now,
    });
    if (!mayOpen) throw new Error("no_scheduled_occurrence");
  }
  if (!batch) {
    const initial = args.discovered.map((occurrence) => ({
      ...occurrence,
      state: occurrence.state,
      initialSet: true,
    }));
    const members = new Set(initial.map((occurrence) => occurrence.clerkUserId));
    batch = await args.deps.openBatch({
      id: "",
      batchDate: args.batchDate,
      sendSlot: proactiveSendSlotForOwner(args.owner),
      openedTrigger: args.trigger,
      windowEndsAt: scheduledBatchWindowEndsAt(args.batchDate, args.owner),
      startedAt: "",
      initialCompletedAt: null,
      initialCompletedTrigger: null,
      relevantMemberCount: args.relevantMemberCount,
      scheduledMemberCount: members.size,
      scheduledOccurrenceCount: initial.length,
      occurrences: initial,
      nonScheduled: args.nonScheduled,
    });
  } else if (args.failedOnly !== true && !exactMemberLocalDate) {
    const known = new Set(
      batch.occurrences.map((occurrence) =>
        occurrenceKey(occurrence.clerkUserId, occurrence.memberLocalDate)
      )
    );
    const late = args.discovered.filter((occurrence) => {
      if (occurrence.state === "expired") return false;
      return !known.has(occurrenceKey(occurrence.clerkUserId, occurrence.memberLocalDate));
    });
    const expired = batch.occurrences.filter((occurrence) => {
      if (occurrence.state !== "pending" && occurrence.state !== "claimed") return false;
      if (scheduledOccurrenceGraceOpen({
        now: args.now,
        utcInstant: occurrence.utcInstant,
        memberLocalDate: occurrence.memberLocalDate,
        timeZone: occurrence.timeZone,
      })) return false;
      const instant = Date.parse(occurrence.utcInstant);
      return Number.isFinite(instant) && instant <= args.now.getTime();
    }).map((occurrence) => ({
      ...occurrence,
      state: "expired" as const,
      detail: "utc_instant_passed",
      patchKind: "eligibility" as const,
    }));
    if (late.length > 0 || expired.length > 0) {
      batch = await args.deps.patchBatch(expired, late.map((occurrence) => ({
        ...occurrence,
        initialSet: false,
        state: "pending" as const,
      })));
    }
  }

  const touched = new Set<string>();
  const excluded = new Set(
    (args.excludeOccurrenceKeys ?? []).map((key) => normalizeOccurrenceKey(key)).filter(Boolean)
  );
  const failures: Array<{ clerkUserId: string; memberLocalDate: string; error: string }> = [];
  const previews: Array<{
    clerkUserId: string;
    memberLocalDate: string;
    body: string | null;
    generationId: string | null;
    machineShouldSend: boolean;
    machineNoSendReason: string | null;
    protected: boolean;
  }> = [];
  let processed = 0;

  while (nowMs() - startedMs < budget) {
    batch = await args.deps.readBatch() ?? batch;
    const pool = selectRecoverableOccurrences({
      occurrences: batch.occurrences.filter((occurrence) => {
        if (onlySet && !onlySet.has(occurrence.clerkUserId)) return false;
        if (exactMemberLocalDate && occurrence.memberLocalDate !== exactMemberLocalDate) return false;
        return true;
      }),
      now: new Date(nowMs()),
      limit: chunkCap,
      alreadyTouched: touched,
      includeFailed: args.trigger !== "automatic_schedule",
      failedOnly: args.failedOnly === true,
      excludeOccurrenceKeys: excluded,
    });
    if (pool.length === 0) break;

    const { results, started } = await runPoolWithBudget({
      items: pool,
      concurrency,
      shouldStop: () => nowMs() - startedMs >= budget,
      worker: async (occurrence) => {
        touched.add(occurrenceKey(occurrence.clerkUserId, occurrence.memberLocalDate));
        const retrying = occurrence.state === "failed";
        try {
          if (args.deps.revalidate) {
            const refreshed = await args.deps.revalidate(occurrence);
            if (refreshed.action === "unresolved") return "defer" as const;
            if (refreshed.action === "expired" || refreshed.action === "ineligible") {
              batch = await args.deps.patchBatch(
                [{
                  ...occurrence,
                  state: refreshed.action === "expired" ? "expired" : "ineligible",
                  detail: refreshed.action === "ineligible" ? refreshed.reason : "utc_instant_passed",
                  patchKind: "eligibility",
                }],
                []
              );
              return "work" as const;
            }
            if (refreshed.action === "rescheduled") {
              occurrence = {
                ...occurrence,
                utcInstant: refreshed.utcInstant,
                selectedLocalMinute: refreshed.selectedLocalMinute,
                effectiveLocalMinute: refreshed.effectiveLocalMinute,
                timeZone: refreshed.timeZone,
                patchKind: "eligibility",
                state: "pending",
              };
              batch = await args.deps.patchBatch([occurrence], []);
            }
          }

          const claim = await args.deps.claim(occurrence, claimOwnerId, retrying);
          const mapped = claimState(claim.outcome);
          if (claim.outcome !== "claimed") {
            if (claim.outcome === "busy") return "busy" as const;
            if (mapped) {
              batch = await args.deps.patchBatch(
                [{ ...occurrence, state: mapped, detail: claim.reason, patchKind: "reconcile" }],
                []
              );
            }
            if (
              (mapped === "generated" ||
                mapped === "protected" ||
                mapped === "intentional_space" ||
                mapped === "sent") &&
              args.deps.readCurrentDraft
            ) {
              const current = await args.deps.readCurrentDraft(occurrence);
              if (current) previews.push({ clerkUserId: occurrence.clerkUserId, memberLocalDate: occurrence.memberLocalDate, ...current });
            }
            if (mapped === "failed" || mapped === "legacy_conflict") {
              failures.push({
                clerkUserId: occurrence.clerkUserId,
                memberLocalDate: occurrence.memberLocalDate,
                error: claim.reason ?? mapped,
              });
            }
            return "work" as const;
          }

          batch = await args.deps.patchBatch(
            [{
              ...occurrence,
              state: "claimed",
              claimOwnerId,
              claimExpiresAt: claim.claimExpiresAt ?? null,
              detail: claim.reason,
              patchKind: retrying ? "retry_claim" : "claim",
            }],
            []
          );
          const accepted = batch.occurrences.find(
            (item) =>
              item.clerkUserId === occurrence.clerkUserId &&
              item.memberLocalDate === occurrence.memberLocalDate
          );
          if (accepted?.state !== "claimed" || accepted.claimOwnerId !== claimOwnerId) {
            return "defer" as const;
          }
          const generated = await args.deps.generate(occurrence, claimOwnerId);
          if (generated.recoverable || isUncertainPersistence(null, generated.error)) {
            return "defer" as const;
          }
          const state = modelState(generated);
          if (state === "claimed") return "defer" as const;
          batch = await args.deps.patchBatch(
            [{
              ...occurrence,
              state,
              claimOwnerId,
              detail: generated.error,
              patchKind: "result",
            }],
            []
          );
          previews.push({
            clerkUserId: occurrence.clerkUserId,
            memberLocalDate: occurrence.memberLocalDate,
            body: generated.body,
            generationId: generated.generationId,
            machineShouldSend: generated.machineShouldSend,
            machineNoSendReason: generated.machineNoSendReason,
            protected: state === "protected",
          });
          if (state === "failed") {
            failures.push({
              clerkUserId: occurrence.clerkUserId,
              memberLocalDate: occurrence.memberLocalDate,
              error: generated.error ?? "generation_failed",
            });
          }
          return "work" as const;
        } catch {
          return "defer" as const;
        }
      },
    });
    const steps = results.filter((step): step is "busy" | "defer" | "work" => step != null);
    const progressed = steps.filter((step) => step === "work").length;
    processed += progressed;
    if (started === 0 || progressed === 0) break;
  }

  batch = await args.deps.readBatch() ?? batch;
  if (
    batch.initialCompletedAt == null &&
    initialPassIsComplete(batch.occurrences) &&
    !(exactMemberLocalDate && processed === 0)
  ) {
    batch = await args.deps.patchBatch([], []);
  }
  return { batch, processed, previews, failures };
}

function chunkResultFromBatch(args: {
  batch: ScheduledBatchRecord;
  processed: number;
  failures: Array<{ clerkUserId: string; memberLocalDate: string; error: string }>;
}): TtoGenerateAllChunkResult {
  const counts = countStates(args.batch.occurrences);
  const remaining = counts.pending + counts.claimed;
  return {
    ok: args.failures.length === 0,
    draftForDayKey: args.batch.batchDate,
    sendSlot: args.batch.sendSlot,
    targeted: args.batch.scheduledOccurrenceCount,
    generated_complete: counts.generated + counts.intentional_space,
    generated_texts: counts.generated,
    intentional_spaces: counts.intentional_space,
    protected_complete: counts.protected,
    already_sent: counts.sent,
    noncurrent: counts.legacy_conflict,
    failed: counts.failed,
    pending: counts.pending,
    remaining,
    processed_this_chunk: args.processed,
    is_complete: remaining === 0,
    audience_clerk_user_ids: [
      ...new Set(args.batch.occurrences.map((occurrence) => occurrence.clerkUserId)),
    ],
    failures: args.failures.map((failure) => ({
      clerkUserId: failure.clerkUserId,
      memberLocalDate: failure.memberLocalDate,
      preferredName: null,
      error: failure.error,
    })),
    generated_this_chunk: args.processed,
    generated: args.processed,
    protectedTylerAuthority: counts.protected,
    skippedAlreadySent: counts.sent,
    skippedNonCurrent: counts.legacy_conflict,
  };
}

type CadenceHistory = { ok: true; dayKey: string | null } | { ok: false };
type CachedCadence = CadenceHistory | "no_statement" | "commitment_unread";

export async function cadenceDecisionForMemberDate(args: {
  clerkUserId: string;
  read: Awaited<ReturnType<typeof readV2UserSmsCommsPreferences>>;
  memberLocalDate: string;
  now: Date;
  historyByUser: Map<string, CachedCadence>;
  commitmentRead?: Awaited<ReturnType<typeof readActiveCommitmentForCadence>>;
}): Promise<"not_applicable" | "eligible" | "not_due" | "unresolved"> {
  if (!args.read.ok) return "unresolved";
  const row = args.read.row;
  const explicit = row != null && row.weekly_schedule != null && row.weekly_schedule_invalid !== true;
  const override = row?.cadence_override ?? null;
  const appliedCadence = shouldApplyUserCadenceOverride(row, args.now);
  if (explicit || (override !== "every_other_day" && override !== "every_3_days")) {
    return "not_applicable";
  }
  let cached = args.historyByUser.get(args.clerkUserId);
  if (!cached) {
    const commitment = args.commitmentRead ?? (await readActiveCommitmentForCadence(args.clerkUserId));
    if (!commitment.ok) {
      cached = "commitment_unread";
    } else if (!commitment.commitment?.behavior_statement?.trim()) {
      cached = "no_statement";
    } else {
      const readHistory = await readLastV2CheckSentForCadence(commitment.commitment.id);
      cached = readHistory.ok ? { ok: true, dayKey: readHistory.dayKey } : { ok: false };
    }
    args.historyByUser.set(args.clerkUserId, cached);
  }
  if (cached === "commitment_unread") {
    return legacyCadenceDecisionFromCommitment({
      explicitSchedule: false,
      cadenceOverride: override,
      commitment: { ok: false },
      appliedCadence,
      history: { ok: false },
      memberLocalDate: args.memberLocalDate,
    });
  }
  return legacyCadenceDecisionFromCommitment({
    explicitSchedule: false,
    cadenceOverride: override,
    commitment: {
      ok: true,
      behaviorStatement: cached === "no_statement" ? null : "present",
    },
    appliedCadence,
    history: cached === "no_statement" ? { ok: true, dayKey: null } : cached,
    memberLocalDate: args.memberLocalDate,
  });
}

async function resolveAudience(args: {
  now: Date;
  owner: ProactiveTtoOwner;
  batchDate: string;
  onlyClerkUserIds?: string[] | null;
}): Promise<{
  relevantMemberCount: number;
  discovered: ScheduledOccurrence[];
  nonScheduled: NonScheduledMember[];
  members: Map<string, TylerTextOverviewAudienceRow>;
}> {
  const audience = await loadSendableTylerTextOverviewAudienceMembers(args.now, {
    includeCurrentlyPaused: true,
  });
  const only = args.onlyClerkUserIds?.filter((id) => id.trim()) ?? null;
  const onlySet = only && only.length > 0 ? new Set(only) : null;
  const members = audience.filter((member) => (onlySet ? onlySet.has(member.clerkUserId) : true));
  const dates = memberLocalDatesForBatch(args.batchDate);
  const discovered: ScheduledOccurrence[] = [];
  const nonScheduled: NonScheduledMember[] = [];
  const audienceRows = new Map<string, TylerTextOverviewAudienceRow>();
  const historyByUser = new Map<string, CachedCadence>();

  for (const member of members) {
    audienceRows.set(member.clerkUserId, {
      clerk_user_id: member.clerkUserId,
      phone_number: member.phoneNumber,
      sms_enabled: true,
      stopped_at: null,
      timezone: member.timezone,
      summitt_subscribed: true,
    });
    const preferenceSource = await readV2UserSmsCommsPreferences(member.clerkUserId);
    const preferenceRead = preferenceReadFromRow(preferenceSource);
    let clerkTimezone: unknown = null;
    try {
      const user = await getClerkUser(member.clerkUserId);
      const metadata = (user.public_metadata ?? {}) as Record<string, unknown>;
      clerkTimezone = metadata.timezone;
    } catch {
      clerkTimezone = null;
    }

    const results: ProactiveScheduleResult[] = [];
    for (const memberLocalDate of dates) {
      const decision = await cadenceDecisionForMemberDate({
        clerkUserId: member.clerkUserId,
        read: preferenceSource,
        memberLocalDate,
        now: args.now,
        historyByUser,
      });
      results.push(
        resolveProactiveSchedule({
          preferenceRead,
          clerkTimezone,
          audienceTimezone: member.timezone,
          audienceUnreadable: false,
          memberLocalDate,
          proactiveDeliveryAllowed: true,
          ...(decision === "eligible"
            ? { legacyCadenceEligible: true }
            : decision === "not_due"
              ? { legacyCadenceEligible: false }
              : {}),
        })
      );
    }
    const planned = planMemberSchedule({
      clerkUserId: member.clerkUserId,
      results,
      owner: args.owner,
      batchDate: args.batchDate,
      now: args.now,
    });
    discovered.push(...planned.occurrences);
    if (planned.nonScheduled) nonScheduled.push(planned.nonScheduled);
  }

  return {
    relevantMemberCount: members.length,
    discovered,
    nonScheduled,
    members: audienceRows,
  };
}

/** Schedule one member for a preview. Does not open a batch or call a model. */
export async function resolveMemberPreviewDecision(args: {
  now: Date;
  owner: ProactiveTtoOwner;
  batchDate: string;
  clerkUserId: string;
  memberLocalDate?: string | null;
}): Promise<
  | { action: "unresolved"; reason: string }
  | ReturnType<typeof decideScheduledPreviewWork>
> {
  const resolved = await resolveAudience({
    now: args.now,
    owner: args.owner,
    batchDate: args.batchDate,
    onlyClerkUserIds: [args.clerkUserId],
  });
  const unresolved = resolved.nonScheduled.find(
    (item) => item.clerkUserId === args.clerkUserId && item.classification === "unresolved"
  );
  if (unresolved && resolved.discovered.length === 0) {
    return { action: "unresolved", reason: unresolved.reason };
  }
  return decideScheduledPreviewWork({
    occurrences: resolved.discovered,
    clerkUserId: args.clerkUserId,
    postedBatchDate: args.batchDate,
    memberLocalDate: args.memberLocalDate,
    now: args.now,
  });
}

function parseRpcBatch(data: unknown): ScheduledBatchRecord {
  const row = Array.isArray(data) ? data[0] : data;
  const batch = batchFromJson(row);
  if (!batch) throw new Error("scheduled_batch_response_invalid");
  return batch;
}

type LoadedScheduleSnapshot = {
  preferenceRead: V2UserSmsCommsPreferencesRead;
  commitmentRead: Awaited<ReturnType<typeof readActiveCommitmentForCadence>>;
  clerkTimezone: unknown;
  clerkReadOk: boolean;
  audienceTimezone: string | null;
  audienceUnreadable: boolean;
  historyByUser: Map<string, CachedCadence>;
  sms?: Awaited<ReturnType<typeof readMemberSmsSendability>>;
};

async function revalidatePendingOccurrence(args: {
  occurrence: ScheduledOccurrence;
  owner: ProactiveTtoOwner;
  batchDate: string;
  now: Date;
  loaded?: LoadedScheduleSnapshot;
}): Promise<RevalidateResult> {
  const sms = args.loaded?.sms ?? (await readMemberSmsSendability(args.occurrence.clerkUserId));
  if (!sms.ok) return { action: "unresolved" };
  if (!sms.sendable) return { action: "ineligible", reason: sms.reason };
  const commitment = args.loaded
    ? args.loaded.commitmentRead
    : await readActiveCommitmentForCadence(args.occurrence.clerkUserId);
  if (!commitment.ok) return { action: "unresolved" };
  const behaviorStatement = commitment.commitment?.behavior_statement ?? null;
  if (
    scheduledMemberEligibility({
      sms: { ok: true, sendable: true },
      commitment: { ok: true, behaviorStatement },
    }) !== "eligible"
  ) {
    return { action: "ineligible", reason: "no_active_commitment" };
  }
  const read = args.loaded
    ? args.loaded.preferenceRead
    : await readV2UserSmsCommsPreferences(args.occurrence.clerkUserId);
  if (!read.ok) return { action: "unresolved" };
  let clerkTimezone: unknown = null;
  const explicitZone = read.row?.schedule_timezone?.trim() ?? "";
  if (args.loaded) {
    if (!explicitZone && !args.loaded.clerkReadOk) return { action: "unresolved" };
    clerkTimezone = explicitZone ? null : args.loaded.clerkTimezone;
  } else {
    try {
      const user = await getClerkUser(args.occurrence.clerkUserId);
      const metadata = (user.public_metadata ?? {}) as Record<string, unknown>;
      clerkTimezone = metadata.timezone;
    } catch {
      if (!explicitZone) return { action: "unresolved" };
      clerkTimezone = null;
    }
  }
  const decision = await cadenceDecisionForMemberDate({
    clerkUserId: args.occurrence.clerkUserId,
    read,
    memberLocalDate: args.occurrence.memberLocalDate,
    now: args.now,
    historyByUser: args.loaded?.historyByUser ?? new Map(),
    commitmentRead: commitment,
  });
  if (decision === "unresolved") return { action: "unresolved" };
  const result = resolveProactiveSchedule({
    preferenceRead: preferenceReadFromRow(read),
    clerkTimezone,
    audienceTimezone: args.loaded?.audienceTimezone ?? sms.timezone,
    audienceUnreadable: args.loaded?.audienceUnreadable === true,
    memberLocalDate: args.occurrence.memberLocalDate,
    proactiveDeliveryAllowed: true,
    ...(decision === "eligible"
      ? { legacyCadenceEligible: true }
      : decision === "not_due"
        ? { legacyCadenceEligible: false }
        : {}),
  });
  if (result.kind === "unresolved") return { action: "unresolved" };
  if (result.kind !== "scheduled" || result.owner !== args.owner || result.batchDate !== args.batchDate) {
    return {
      action: "ineligible",
      reason: result.kind === "unscheduled" ? result.reason : "no_longer_in_batch",
    };
  }
  const instant = Date.parse(result.utcInstant);
  if (!Number.isFinite(instant)) return { action: "unresolved" };
  if (instant <= args.now.getTime() && !scheduledOccurrenceGraceOpen({
    now: args.now,
    utcInstant: result.utcInstant,
    memberLocalDate: result.memberLocalDate,
    timeZone: result.timeZone,
  })) {
    return { action: "expired" };
  }
  if (
    result.utcInstant !== args.occurrence.utcInstant ||
    result.selectedLocalMinute !== args.occurrence.selectedLocalMinute ||
    result.effectiveLocalMinute !== args.occurrence.effectiveLocalMinute ||
    result.timeZone !== args.occurrence.timeZone
  ) {
    return {
      action: "rescheduled",
      utcInstant: result.utcInstant,
      selectedLocalMinute: result.selectedLocalMinute,
      effectiveLocalMinute: result.effectiveLocalMinute,
      timeZone: result.timeZone,
    };
  }
  return { action: "ready" };
}

async function readCurrentScheduledDraft(
  occurrence: ScheduledOccurrence,
  owner: ProactiveTtoOwner
): Promise<CurrentDraftView | null> {
  const { data, error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(
      "current_generation_id, current_body_to_send, current_body_source, edited_by_tyler"
    )
    .eq("clerk_user_id", occurrence.clerkUserId)
    .eq("draft_for_day_key", occurrence.memberLocalDate)
    .eq("send_slot", proactiveSendSlotForOwner(owner))
    .maybeSingle();
  if (error || !data) return null;
  const generationId =
    typeof data.current_generation_id === "string" ? data.current_generation_id : null;
  let machineShouldSend = false;
  let machineNoSendReason: string | null = null;
  if (generationId) {
    const generation = await supabaseServer
      .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
      .select("machine_should_send, machine_no_send_reason")
      .eq("id", generationId)
      .maybeSingle();
    if (!generation.error && generation.data) {
      machineShouldSend = generation.data.machine_should_send === true;
      machineNoSendReason =
        typeof generation.data.machine_no_send_reason === "string"
          ? generation.data.machine_no_send_reason
          : null;
    }
  }
  return {
    body: typeof data.current_body_to_send === "string" ? data.current_body_to_send : null,
    generationId,
    machineShouldSend,
    machineNoSendReason,
    protected: data.edited_by_tyler === true || data.current_body_source === "tyler_edit",
  };
}

function scheduledBatchJsonIsReadable(value: unknown): boolean {
  const row = asRecord(value);
  if (!row || !Array.isArray(row.occurrences) || !Array.isArray(row.non_scheduled)) return false;
  if (row.occurrences.some((item) => occurrenceFromJson(item) == null)) return false;
  for (const item of row.non_scheduled) {
    const record = asRecord(item);
    const clerkUserId = asString(record?.clerk_user_id);
    const classification = asString(record?.classification);
    const reason = asString(record?.reason);
    if (!clerkUserId || !reason) return false;
    if (classification !== "unscheduled" && classification !== "unresolved") return false;
  }
  return true;
}

/** Read the batch for an individual preview. Does not open a batch or generate. */
export async function readScheduledGenerationBatch(args: {
  batchDate: string;
  owner: ProactiveTtoOwner;
}): Promise<{ ok: true; batch: ScheduledBatchRecord | null } | { ok: false; error: string }> {
  const { data, error } = await supabaseServer
    .from(SMS_TTO_GENERATION_BATCHES_TABLE)
    .select("*")
    .eq("batch_date", args.batchDate)
    .eq("send_slot", proactiveSendSlotForOwner(args.owner))
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: true, batch: null };
  if (!scheduledBatchJsonIsReadable(data)) return { ok: false, error: "batch_record_unreadable" };
  const batch = batchFromJson(data);
  if (!batch) return { ok: false, error: "batch_record_unreadable" };
  return { ok: true, batch };
}

/** Read a finished preview without calling a model. A legacy draft at the same key does not qualify. */
export async function readCompletedScheduledPreview(args: {
  clerkUserId: string;
  memberLocalDate: string;
  sendSlot: ProactiveSendSlot;
  batchDate: string;
}): Promise<CurrentDraftView | null> {
  const { data, error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(
      "current_generation_id, current_body_to_send, current_body_source, edited_by_tyler"
    )
    .eq("clerk_user_id", args.clerkUserId)
    .eq("draft_for_day_key", args.memberLocalDate)
    .eq("send_slot", args.sendSlot)
    .maybeSingle();
  if (error || !data) return null;
  const generationId =
    typeof data.current_generation_id === "string" ? data.current_generation_id : null;
  if (!generationId) return null;
  const generation = await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .select("machine_should_send, machine_no_send_reason, generation_metadata")
    .eq("id", generationId)
    .maybeSingle();
  if (generation.error || !generation.data) return null;
  const metadata = asRecord(generation.data.generation_metadata);
  if (metadata?.scheduled_generation_convention !== SCHEDULED_GENERATION_CONVENTION) return null;
  if (metadata.administrative_batch_date !== args.batchDate) return null;
  if (
    typeof metadata.member_local_date === "string" &&
    metadata.member_local_date !== args.memberLocalDate
  ) {
    return null;
  }
  if (typeof metadata.tto_owner === "string" && metadata.tto_owner !== args.sendSlot) return null;
  return {
    body: typeof data.current_body_to_send === "string" ? data.current_body_to_send : null,
    generationId,
    machineShouldSend: generation.data.machine_should_send === true,
    machineNoSendReason:
      typeof generation.data.machine_no_send_reason === "string"
        ? generation.data.machine_no_send_reason
        : null,
    protected: data.edited_by_tyler === true || data.current_body_source === "tyler_edit",
  };
}

function productionDeps(args: {
  now: Date;
  owner: ProactiveTtoOwner;
  batchDate: string;
  trigger: GenerationTrigger;
  members: Map<string, TylerTextOverviewAudienceRow>;
}): ScheduledBatchDeps {
  const readBatch = async () => {
    const { data, error } = await supabaseServer
      .from(SMS_TTO_GENERATION_BATCHES_TABLE)
      .select("*")
      .eq("batch_date", args.batchDate)
      .eq("send_slot", proactiveSendSlotForOwner(args.owner))
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return batchFromJson(data);
  };
  return {
    readBatch,
    openBatch: async (batch) => {
      const { data, error } = await supabaseServer.rpc("tto_generation_batch_open", {
        p_batch_date: batch.batchDate,
        p_send_slot: batch.sendSlot,
        p_opened_trigger: batch.openedTrigger,
        p_window_ends_at: batch.windowEndsAt,
        p_relevant_member_count: batch.relevantMemberCount,
        p_scheduled_member_count: batch.scheduledMemberCount,
        p_scheduled_occurrence_count: batch.scheduledOccurrenceCount,
        p_occurrences: batch.occurrences.map(occurrenceToJson),
        p_non_scheduled: batch.nonScheduled,
      });
      if (error) throw new Error(error.message);
      return parseRpcBatch(data);
    },
    patchBatch: async (patches, append) => {
      const { data, error } = await supabaseServer.rpc("tto_generation_batch_patch", {
        p_batch_date: args.batchDate,
        p_send_slot: proactiveSendSlotForOwner(args.owner),
        p_actor_trigger: args.trigger,
        p_patches: patches.map(occurrenceToJson),
        p_append: append.map(occurrenceToJson),
      });
      if (error) throw new Error(error.message);
      return parseRpcBatch(data);
    },
    claim: async (occurrence, claimOwnerId, allowFailedRetry) => {
      const { data, error } = await supabaseServer.rpc("tto_claim_scheduled_generation", {
        p_clerk_user_id: occurrence.clerkUserId,
        p_draft_for_day_key: occurrence.memberLocalDate,
        p_send_slot: proactiveSendSlotForOwner(args.owner),
        p_claim_owner_id: claimOwnerId,
        p_now: new Date().toISOString(),
        p_allow_failed_retry: allowFailedRetry,
        p_metadata: {
          time_zone: occurrence.timeZone,
          utc_instant: occurrence.utcInstant,
          selected_local_minute: occurrence.selectedLocalMinute,
          effective_local_minute: occurrence.effectiveLocalMinute,
          administrative_batch_date: args.batchDate,
          tto_owner: args.owner,
          generation_trigger: args.trigger,
        },
      });
      if (error) throw new Error(error.message);
      const row = (Array.isArray(data) ? data[0] : data) as
        | {
            outcome?: string;
            generation_id?: string | null;
            reason?: string | null;
            claim_expires_at?: string | null;
          }
        | null;
      const outcome = row?.outcome;
      if (
        outcome !== "claimed" &&
        outcome !== "busy" &&
        outcome !== "generated" &&
        outcome !== "intentional_space" &&
        outcome !== "protected" &&
        outcome !== "sent" &&
        outcome !== "legacy_conflict" &&
        outcome !== "failed" &&
        outcome !== "noncurrent" &&
        outcome !== "ineligible"
      ) {
        throw new Error("scheduled_claim_response_invalid");
      }
      return {
        outcome,
        generationId: typeof row?.generation_id === "string" ? row.generation_id : null,
        reason: typeof row?.reason === "string" ? row.reason : null,
        claimExpiresAt:
          typeof row?.claim_expires_at === "string" ? row.claim_expires_at : null,
      };
    },
    generate: async (occurrence, claimOwnerId) => {
      const audienceUser = args.members.get(occurrence.clerkUserId);
      if (!audienceUser) {
        return {
          outcome: "claimed",
          body: null,
          generationId: null,
          machineShouldSend: false,
          machineNoSendReason: null,
          error: "user_not_in_sendable_audience",
          recoverable: true,
        };
      }
      const metadata = buildScheduledGenerationMetadata({
        scheduled: {
          kind: "scheduled",
          memberLocalDate: occurrence.memberLocalDate,
          selectedLocalMinute: occurrence.selectedLocalMinute,
          effectiveLocalMinute: occurrence.effectiveLocalMinute,
          timeZone: occurrence.timeZone,
          timeZoneSource: "schedule",
          utcInstant: occurrence.utcInstant,
          easternDate: args.batchDate,
          easternMinute: 0,
          owner: args.owner,
          batchDate: args.batchDate,
        },
        trigger: args.trigger,
      });
      const generationReason =
        args.trigger === "manual_schedule"
          ? "manual_regenerate"
          : args.owner === "evening"
            ? "evening_sweep"
            : "noon_batch";
      if (args.owner === "evening") {
        const result = await generateTylerTextOverviewEveningPreviewForUser({
          clerkUserId: occurrence.clerkUserId,
          draftForDayKey: occurrence.memberLocalDate,
          now: args.now,
          generationReason,
          scheduleAuthoritativelyResolved: true,
          scheduledGenerationMetadata: metadata,
          claimOwnerId,
        });
        if (!result.ok) {
          const error = result.error ?? result.reason;
          const recoverable = isUncertainPersistence(result.reason, result.error ?? null);
          return {
            outcome: recoverable ? "claimed" : "failed",
            body: null,
            generationId: null,
            machineShouldSend: false,
            machineNoSendReason: null,
            error,
            recoverable,
          };
        }
        return normalizeModelResult(result);
      }
      const result = await generateTylerTextOverviewDraftForUser({
        audienceUser,
        now: args.now,
        draftForDayKey: occurrence.memberLocalDate,
        generationReason,
        scheduleAuthoritativelyResolved: true,
        scheduledGenerationMetadata: metadata,
        claimOwnerId,
      });
      if (!result.ok) {
        const error = result.error ?? result.reason;
        const recoverable = isUncertainPersistence(result.reason, result.error ?? null);
        return {
          outcome: recoverable ? "claimed" : "failed",
          body: null,
          generationId: null,
          machineShouldSend: false,
          machineNoSendReason: null,
          error,
          recoverable,
        };
      }
      return normalizeModelResult(result);
    },
    revalidate: (occurrence) =>
      revalidatePendingOccurrence({
        occurrence,
        owner: args.owner,
        batchDate: args.batchDate,
        now: new Date(),
      }),
    readCurrentDraft: (occurrence) => readCurrentScheduledDraft(occurrence, args.owner),
  };
}

function normalizeModelResult(result: {
  body: string | null;
  generationId: string;
  machineShouldSend: boolean;
  machineNoSendReason?: string | null;
  currentDraftProtected?: boolean;
  error?: string;
}): ModelOutcome {
  if (result.machineNoSendReason === MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE) {
    return {
      outcome: "intentional_space",
      body: null,
      generationId: result.generationId,
      machineShouldSend: false,
      machineNoSendReason: result.machineNoSendReason,
      error: null,
      recoverable: false,
    };
  }
  if (result.currentDraftProtected) {
    return {
      outcome: "protected",
      body: result.body,
      generationId: result.generationId,
      machineShouldSend: result.machineShouldSend,
      machineNoSendReason: result.machineNoSendReason ?? null,
      error: null,
      recoverable: false,
    };
  }
  if (result.machineShouldSend && result.body && result.body.trim()) {
    return {
      outcome: "generated",
      body: result.body,
      generationId: result.generationId,
      machineShouldSend: true,
      machineNoSendReason: null,
      error: null,
      recoverable: false,
    };
  }
  return {
    outcome: "failed",
    body: result.body,
    generationId: result.generationId,
    machineShouldSend: false,
    machineNoSendReason: result.machineNoSendReason ?? null,
    error: result.machineNoSendReason ?? "generation_incomplete",
    recoverable: false,
  };
}

export async function runScheduledTtoGeneration(args: {
  now?: Date;
  owner: ProactiveTtoOwner;
  batchDate: string;
  trigger: GenerationTrigger;
  onlyClerkUserIds?: string[] | null;
  excludeOccurrenceKeys?: string[] | null;
  failedOnly?: boolean;
  onlyMemberLocalDate?: string | null;
  /** Open or extend a batch for this member only. Does not enumerate the rest of the audience. */
  recoverSingleMember?: boolean;
  timeBudgetMs?: number;
  chunkUserCap?: number;
  nowMs?: () => number;
}): Promise<
  | {
      ok: true;
      chunk: TtoGenerateAllChunkResult;
      batch: ScheduledBatchRecord;
      previews: Awaited<ReturnType<typeof executeScheduledBatch>>["previews"];
    }
  | { ok: false; error: string; status: number }
> {
  if (!isTylerTextOverviewEnabled()) {
    return { ok: false, error: "tyler_text_overview_disabled", status: 503 };
  }
  const now = args.now ?? new Date();
  try {
    const exactMemberLocalDate = args.onlyMemberLocalDate?.trim() || null;
    let audienceLimit: string[] | null = exactMemberLocalDate ? args.onlyClerkUserIds ?? null : null;
    if (exactMemberLocalDate) {
      const existing = await readScheduledGenerationBatch({
        batchDate: args.batchDate,
        owner: args.owner,
      });
      if (!existing.ok) return { ok: false, error: existing.error, status: 503 };
      // No batch yet: enumerate the whole audience so the manual open keeps full counts.
      if (!existing.batch && args.recoverSingleMember !== true) audienceLimit = null;
    }
    const resolved = await resolveAudience({
      now,
      owner: args.owner,
      batchDate: args.batchDate,
      onlyClerkUserIds: audienceLimit,
    });
    const ran = await executeScheduledBatch({
      now,
      batchDate: args.batchDate,
      owner: args.owner,
      trigger: args.trigger,
      relevantMemberCount: resolved.relevantMemberCount,
      discovered: resolved.discovered,
      nonScheduled: resolved.nonScheduled,
      timeBudgetMs: args.timeBudgetMs,
      chunkUserCap: args.chunkUserCap,
      nowMs: args.nowMs,
      onlyClerkUserIds: args.onlyClerkUserIds,
      excludeOccurrenceKeys: args.excludeOccurrenceKeys,
      failedOnly: args.failedOnly === true,
      onlyMemberLocalDate: exactMemberLocalDate,
      deps: productionDeps({
        now,
        owner: args.owner,
        batchDate: args.batchDate,
        trigger: args.trigger,
        members: resolved.members,
      }),
    });
    return {
      ok: true,
      batch: ran.batch,
      previews: ran.previews,
      chunk: chunkResultFromBatch({
        batch: ran.batch,
        processed: ran.processed,
        failures: ran.failures,
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "scheduled_generation_failed";
    return {
      ok: false,
      error: message,
      status:
        message === "no_scheduled_batch" || message === "no_scheduled_occurrence" ? 409 : 500,
    };
  }
}

export async function runManualScheduledGenerateAll(args: {
  draftForDayKey: string;
  owner: ProactiveTtoOwner;
  audienceClerkUserIds?: string[] | null;
  excludeOccurrenceKeys?: string[] | null;
  failedOnly?: boolean;
  now?: Date;
}): Promise<TtoGenerateAllChunkResult | { ok: false; error: string; status: number }> {
  const batchDate = args.draftForDayKey.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(batchDate)) {
    return { ok: false, error: "Invalid draft_for_day_key", status: 400 };
  }
  const ran = await runScheduledTtoGeneration({
    now: args.now,
    owner: args.owner,
    batchDate,
    trigger: "manual_schedule",
    onlyClerkUserIds: args.audienceClerkUserIds,
    excludeOccurrenceKeys: args.excludeOccurrenceKeys,
    failedOnly: args.failedOnly === true,
  });
  if (!ran.ok) return ran;
  return ran.chunk;
}

const RECONSIDERATION_STATES = new Set<OccurrenceState>([
  "generated",
  "protected",
  "intentional_space",
]);

export type NextOccurrenceCandidate = {
  batchDate: string;
  owner: ProactiveTtoOwner;
  sendSlot: typeof SMS_DAILY_PRODUCTION_SEND_SLOT | typeof SMS_DAILY_EVENING_PREVIEW_SEND_SLOT;
  occurrence: ScheduledOccurrence;
};

/** Soonest future occurrence per member, across Morning and Evening batches. */
export function selectNextReconsiderationCandidates(
  batches: ScheduledBatchRecord[],
  now: Date
): NextOccurrenceCandidate[] {
  const soonest = new Map<string, NextOccurrenceCandidate>();
  for (const batch of batches) {
    const owner: ProactiveTtoOwner =
      batch.sendSlot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT ? "evening" : "morning";
    for (const occurrence of batch.occurrences) {
      const instant = Date.parse(occurrence.utcInstant);
      const inGrace = scheduledOccurrenceGraceOpen({
        now,
        utcInstant: occurrence.utcInstant,
        memberLocalDate: occurrence.memberLocalDate,
        timeZone: occurrence.timeZone,
      });
      if (!Number.isFinite(instant) || (instant <= now.getTime() && !inGrace)) continue;
      if (
        occurrence.state === "sent" ||
        occurrence.state === "expired" ||
        occurrence.state === "ineligible" ||
        occurrence.state === "legacy_conflict"
      ) {
        continue;
      }
      const candidate: NextOccurrenceCandidate = {
        batchDate: batch.batchDate,
        owner,
        sendSlot: batch.sendSlot,
        occurrence,
      };
      const current = soonest.get(occurrence.clerkUserId);
      if (
        !current ||
        Date.parse(current.occurrence.utcInstant) > instant
      ) {
        soonest.set(occurrence.clerkUserId, candidate);
      }
    }
  }
  return [...soonest.values()]
    .filter((item) => RECONSIDERATION_STATES.has(item.occurrence.state))
    .sort(
      (a, b) =>
        Date.parse(a.occurrence.utcInstant) - Date.parse(b.occurrence.utcInstant)
    );
}

/** Future occurrences that can still become the next delivery. Not collapsed to the soonest. */
export function listUpcomingOccurrenceCandidates(
  batches: ScheduledBatchRecord[],
  now: Date
): NextOccurrenceCandidate[] {
  const found: NextOccurrenceCandidate[] = [];
  for (const batch of batches) {
    const owner: ProactiveTtoOwner =
      batch.sendSlot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT ? "evening" : "morning";
    for (const occurrence of batch.occurrences) {
      const instant = Date.parse(occurrence.utcInstant);
      const inGrace = scheduledOccurrenceGraceOpen({
        now,
        utcInstant: occurrence.utcInstant,
        memberLocalDate: occurrence.memberLocalDate,
        timeZone: occurrence.timeZone,
      });
      if (!Number.isFinite(instant) || (instant <= now.getTime() && !inGrace)) continue;
      if (
        occurrence.state === "sent" ||
        occurrence.state === "expired" ||
        occurrence.state === "ineligible" ||
        occurrence.state === "legacy_conflict"
      ) {
        continue;
      }
      found.push({
        batchDate: batch.batchDate,
        owner,
        sendSlot: batch.sendSlot,
        occurrence,
      });
    }
  }
  return found;
}

export const MEMBER_CONVERSATION_READ_LIMIT = 30;

export type DiscoveredConversationMessage = {
  sourceId: string;
  sender: "user" | "coach";
  sentAtUtc: string;
  receivedAtUtc?: string | null;
};

export type UnidentifiedCoachReply = {
  sentAtUtc: string;
  receivedAtUtc: string | null;
};

export type MemberConversationDiscovery = {
  retrieval: "ok" | "incomplete";
  messages: DiscoveredConversationMessage[];
  unidentifiedReplies: UnidentifiedCoachReply[];
};

const RECOVERABLE_INELIGIBLE_REASONS = new Set([
  "pause_indefinite",
  "pause_until",
  "weekday_disabled",
  "weekend_policy",
  "cadence",
  "consent_ineligible",
  "no_active_commitment",
  "absent",
  "identity",
  "membership",
  "sms_disabled",
  "phone",
  "stopped",
]);

export function effectiveCoachingAskForDiscovery(
  row: {
    behavior_statement?: string | null;
    adaptive_ask_text?: string | null;
    adaptive_ask_expires_at?: string | null;
  },
  nowMs: number
): string {
  return getEffectiveCoachingAsk(
    {
      behavior_statement: row.behavior_statement ?? "",
      adaptive_ask_text: row.adaptive_ask_text ?? null,
      adaptive_ask_expires_at: row.adaptive_ask_expires_at ?? null,
    } as ActiveV2CommitmentRow,
    nowMs
  );
}

function isoFromUnknown(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

function inboundReceiptIso(row: Record<string, unknown>): string | null {
  return isoFromUnknown(row.inserted_at) ?? isoFromUnknown(row.created_at);
}

function coachReceiptIso(row: Record<string, unknown>): string | null {
  return isoFromUnknown(row.created_at);
}

function sourceIdFromSendEventRow(row: Record<string, unknown>): string {
  if (typeof row.message_sid === "string" && row.message_sid.trim()) return row.message_sid.trim();
  if (typeof row.outbound_message_sid === "string" && row.outbound_message_sid.trim()) {
    return row.outbound_message_sid.trim();
  }
  const meta = row.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const sid = (meta as { message_sid?: unknown }).message_sid;
    if (typeof sid === "string" && sid.trim()) return sid.trim();
  }
  return "";
}

export function discoverMemberMessages(args: {
  inboundRows: Record<string, unknown>[];
  inboundCapped: boolean;
  coachRows: Record<string, unknown>[];
  coachCapped: boolean;
  sendRows?: Record<string, unknown>[];
  weeklyRows?: Record<string, unknown>[];
}): MemberConversationDiscovery {
  const messages: DiscoveredConversationMessage[] = [];
  const unidentifiedReplies: UnidentifiedCoachReply[] = [];
  let incomplete = false;
  let ordinaryCount = 0;
  let complianceCount = 0;
  for (const row of args.inboundRows) {
    const body = typeof row.raw_body === "string" ? row.raw_body : "";
    if (!body.trim()) continue;
    if (isProactiveConversationComplianceBody(body)) {
      complianceCount += 1;
      continue;
    }
    ordinaryCount += 1;
    const sourceId = typeof row.message_sid === "string" ? row.message_sid.trim() : "";
    const ms = timestampFromInboundMessageRow(row);
    if (!sourceId || !Number.isFinite(ms) || ms <= 0) {
      incomplete = true;
      continue;
    }
    messages.push({
      sourceId,
      sender: "user",
      sentAtUtc: new Date(ms).toISOString(),
      receivedAtUtc: inboundReceiptIso(row),
    });
  }
  if (
    args.inboundCapped &&
    (ordinaryCount === 0 || (complianceCount > 0 && ordinaryCount < MEMBER_CONVERSATION_READ_LIMIT))
  ) {
    incomplete = true;
  }
  let provedCoach = 0;
  for (const row of args.coachRows) {
    const reply = typeof row.reply_body === "string" ? row.reply_body : "";
    const evidence = coachJobReplyStrongDeliveryEvidence(row, reply);
    if (!evidence) continue;
    provedCoach += 1;
    const outbound = typeof row.outbound_message_sid === "string" ? row.outbound_message_sid.trim() : "";
    const ms = timestampFromCoachJobReplyRow(row);
    if (!Number.isFinite(ms) || ms <= 0) {
      incomplete = true;
      continue;
    }
    if (!outbound) {
      unidentifiedReplies.push({
        sentAtUtc: new Date(ms).toISOString(),
        receivedAtUtc: coachReceiptIso(row),
      });
      continue;
    }
    messages.push({
      sourceId: outbound,
      sender: "coach",
      sentAtUtc: new Date(ms).toISOString(),
      receivedAtUtc: coachReceiptIso(row),
    });
  }
  if (args.coachCapped && provedCoach === 0 && args.coachRows.length > 0) incomplete = true;
  const pushQualifyingSend = (
    row: Record<string, unknown>,
    body: string
  ) => {
    if (!body.trim() || !isSendEventStrongDeliveryEvidence(row)) return;
    const sourceId = sourceIdFromSendEventRow(row);
    const ms = timestampFromSendEventRow(row);
    if (!sourceId || !Number.isFinite(ms) || ms <= 0) {
      incomplete = true;
      return;
    }
    messages.push({
      sourceId,
      sender: "coach",
      sentAtUtc: new Date(ms).toISOString(),
      receivedAtUtc: null,
    });
  };
  for (const row of args.sendRows ?? []) {
    pushQualifyingSend(row, bodyFromSendEventRow(row));
  }
  for (const row of args.weeklyRows ?? []) {
    pushQualifyingSend(row, bodyFromWeeklySendEventRow(row));
  }
  return { retrieval: incomplete ? "incomplete" : "ok", messages, unidentifiedReplies };
}

function messageIsAfterTylerEdit(args: {
  considered: TtoInputEvidence;
  eventMs: number;
  receiptMs: number;
}): boolean {
  if (args.considered.edited_by_tyler !== true) return true;
  const editedMs = args.considered.edited_at ? Date.parse(args.considered.edited_at) : NaN;
  if (!Number.isFinite(editedMs)) return false;
  const eventAfter = Number.isFinite(args.eventMs) && args.eventMs > editedMs;
  const receiptAfter = Number.isFinite(args.receiptMs) && args.receiptMs > editedMs;
  return eventAfter || receiptAfter;
}

export function conversationHasUnconsideredMessage(
  discovered: DiscoveredConversationMessage[],
  considered: TtoInputEvidence | null,
  options?: {
    now?: Date;
    unidentifiedReplies?: UnidentifiedCoachReply[];
  }
): "new" | "same" | "unresolved" {
  if (!considered || !Array.isArray(considered.considered_source_ids)) return "new";
  const nowMs = options?.now?.getTime() ?? Date.now();
  const floorMs = nowMs - MORNING_TTO_THREAD_WINDOW_HOURS * 60 * 60 * 1000;
  const known = new Set(considered.considered_source_ids);
  const unavailable = new Set(considered.retrieval_unavailable_source_ids ?? []);
  const excluded = new Set(
    (considered.excluded_source_ids ?? [])
      .map((item) => (typeof item.source_id === "string" ? item.source_id.trim() : ""))
      .filter(Boolean)
  );
  const oldestMs = considered.thread_oldest_sent_at
    ? Date.parse(considered.thread_oldest_sent_at)
    : NaN;
  const readMs = considered.conversation_read_at ? Date.parse(considered.conversation_read_at) : NaN;
  const omitted = considered.omitted_older_turn_count ?? 0;
  for (const message of discovered) {
    if (!message.sourceId) return "unresolved";
    const eventMs = Date.parse(message.sentAtUtc);
    if (!Number.isFinite(eventMs)) return "unresolved";
    if (eventMs < floorMs || eventMs > nowMs) continue;
    if (known.has(message.sourceId) || excluded.has(message.sourceId) || unavailable.has(message.sourceId)) continue;
    const receiptMs = message.receivedAtUtc ? Date.parse(message.receivedAtUtc) : NaN;
    if (!messageIsAfterTylerEdit({ considered, eventMs, receiptMs })) continue;
    if (!Number.isFinite(oldestMs) || eventMs >= oldestMs) return "new";
    if (omitted > 0) continue;
    if (Number.isFinite(readMs) && Number.isFinite(receiptMs) && receiptMs > readMs) return "new";
  }
  for (const reply of options?.unidentifiedReplies ?? []) {
    const eventMs = Date.parse(reply.sentAtUtc);
    if (!Number.isFinite(eventMs) || eventMs < floorMs || eventMs > nowMs) continue;
    const receiptMs = reply.receivedAtUtc ? Date.parse(reply.receivedAtUtc) : NaN;
    if (!messageIsAfterTylerEdit({ considered, eventMs, receiptMs })) continue;
    if (!Number.isFinite(readMs)) continue;
    if (!Number.isFinite(receiptMs) || receiptMs > readMs) return "unresolved";
  }
  return "same";
}

export function occurrenceRevalidationDisposition(
  checked: RevalidateResult
): "proceed" | "unresolved" | "skip_recoverable" | "patch_expired" | "patch_ineligible" {
  if (checked.action === "ready" || checked.action === "rescheduled") return "proceed";
  if (checked.action === "unresolved") return "unresolved";
  if (checked.action === "expired") return "patch_expired";
  if (checked.reason === "no_longer_in_batch") return "skip_recoverable";
  if (RECOVERABLE_INELIGIBLE_REASONS.has(checked.reason)) return "skip_recoverable";
  return "skip_recoverable";
}

export type AuthoritativeDelivery = {
  memberLocalDate: string;
  owner: ProactiveTtoOwner;
  batchDate: string;
  utcInstant: string;
  effectiveLocalMinute?: number;
  timeZone?: string;
};

/**
 * The occurrence the current schedule says is the next delivery.
 * An earlier pending or claimed occurrence still blocks.
 * An earlier scheduled delivery with no occurrence blocks, and no batch is opened.
 * A generated occurrence that is no longer the schedule does not block a later match.
 */
export function chooseAuthoritativeReconsiderationCandidate(args: {
  occurrences: NextOccurrenceCandidate[];
  schedule: AuthoritativeDelivery[] | "unresolved";
  now: Date;
}): NextOccurrenceCandidate | null {
  if (args.schedule === "unresolved") return null;
  const sorted = [...args.occurrences].sort(
    (a, b) => Date.parse(a.occurrence.utcInstant) - Date.parse(b.occurrence.utcInstant)
  );
  const planned = args.schedule
    .filter((item) => scheduledDeliveryRemainsActionable({
      now: args.now,
      utcInstant: item.utcInstant,
      memberLocalDate: item.memberLocalDate,
      timeZone: item.timeZone ?? "",
    }))
    .sort((a, b) => Date.parse(a.utcInstant) - Date.parse(b.utcInstant));
  const earliestBlocking = sorted.find(
    (item) => item.occurrence.state === "pending" || item.occurrence.state === "claimed"
  );
  for (const delivery of planned) {
    const deliveryMs = Date.parse(delivery.utcInstant);
    if (
      earliestBlocking &&
      Date.parse(earliestBlocking.occurrence.utcInstant) < deliveryMs
    ) {
      return null;
    }
    const match = sorted.find(
      (item) =>
        RECONSIDERATION_STATES.has(item.occurrence.state) &&
        item.occurrence.memberLocalDate === delivery.memberLocalDate &&
        item.batchDate === delivery.batchDate &&
        item.owner === delivery.owner
    );
    if (match) return match;
    return null;
  }
  return null;
}

export function dashboardOutcomeFromCurrentDraft(args: {
  editedByTyler: boolean;
  bodySource: string | null;
  body: string | null;
  machineNoSendReason: string | null;
}): "generated" | "intentional_space" | "protected" | null {
  if (args.editedByTyler || args.bodySource === "tyler_edit") return "protected";
  if (typeof args.body === "string" && args.body.trim()) return "generated";
  if (args.machineNoSendReason === MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE) {
    return "intentional_space";
  }
  return null;
}

export function dashboardRepairState(args: {
  occurrenceState: OccurrenceState;
  draftState: "generated" | "intentional_space" | "protected" | null;
}): "generated" | "intentional_space" | "protected" | null {
  if (!args.draftState) return null;
  if (!RECONSIDERATION_STATES.has(args.occurrenceState)) return null;
  if (args.draftState === args.occurrenceState) return null;
  return args.draftState;
}

export function reconsiderationOutcomePatchAllowed(args: {
  occurrenceState: string;
  expectedState: string;
  nextState: string;
  expectedGenerationId: string;
  currentGenerationId: string | null;
  expectedEditedAt?: string | null;
  currentEditedAt?: string | null;
}): boolean {
  if (args.occurrenceState === "sent" || args.occurrenceState === "expired") return false;
  if (args.occurrenceState !== args.expectedState) return false;
  if (!args.currentGenerationId || args.currentGenerationId !== args.expectedGenerationId) {
    return false;
  }
  if ((args.expectedEditedAt ?? null) !== (args.currentEditedAt ?? null)) return false;
  return (
    args.nextState === "generated" ||
    args.nextState === "intentional_space" ||
    args.nextState === "protected"
  );
}

export function earlierDeliveryBlocksCandidate(args: {
  candidateUtc: string;
  now: Date;
  earlierUtcInstants: string[];
}): boolean {
  const candidateMs = Date.parse(args.candidateUtc);
  if (!Number.isFinite(candidateMs)) return false;
  return args.earlierUtcInstants.some((value) => {
    const instant = Date.parse(value);
    return Number.isFinite(instant) && instant > args.now.getTime() && instant < candidateMs;
  });
}

export function replacementOccurrenceState(
  machineNoSendReason: string | null | undefined
): "generated" | "intentional_space" {
  return machineNoSendReason === MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE
    ? "intentional_space"
    : "generated";
}

export function authoritativeTimezoneChanged(args: {
  evidenceTimeZone: string | null | undefined;
  scheduleTimezone: string | null | undefined;
  audienceTimezone: string | null | undefined;
  clerkTimezone: unknown;
  audienceUnreadable?: boolean;
}): boolean | "unresolved" {
  const resolved = resolveAccountSmsTimezone({
    scheduleTimezone: args.scheduleTimezone?.trim() ? args.scheduleTimezone : null,
    clerkTimezone: args.clerkTimezone,
    audienceTimezone: args.audienceTimezone,
    audienceUnreadable: args.audienceUnreadable === true,
  });
  if (resolved.source === "unknown" || resolved.invalidExplicit) return "unresolved";
  const evidence = args.evidenceTimeZone?.trim() ?? "";
  if (!evidence) return true;
  return resolved.zone !== evidence;
}

export function reconsiderationReadiness(args: {
  goalReadOk: boolean;
  preferenceReadOk: boolean;
  draftReadOk: boolean;
  generationReadOk: boolean;
  retrieval: "ok" | "failed" | "incomplete";
}): "ready" | "unresolved" {
  if (!args.goalReadOk || !args.preferenceReadOk || !args.draftReadOk || !args.generationReadOk) {
    return "unresolved";
  }
  if (args.retrieval === "failed") return "unresolved";
  return "ready";
}

export function orderReconsiderationWork<
  T extends { failureCount: number; occurrence: { utcInstant: string } }
>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.failureCount !== b.failureCount) return a.failureCount - b.failureCount;
    return Date.parse(a.occurrence.utcInstant) - Date.parse(b.occurrence.utcInstant);
  });
}

function sameDeliveryFacts(
  evidence: TtoInputEvidence | null,
  delivery: { utcInstant: string; effectiveLocalMinute: number; timeZone: string } | null
): boolean {
  if (!evidence || !delivery) return false;
  return (
    evidence.delivery.utc_instant === delivery.utcInstant &&
    evidence.delivery.effective_local_minute === delivery.effectiveLocalMinute &&
    (evidence.delivery.time_zone ?? "") === delivery.timeZone
  );
}

function unavailableSundayEvidence(): SundayContextEvidence {
  return {
    accountability_status: "unavailable",
    accountability_event_ids: [],
    accountability_fingerprint: "",
    interruption_status: "unavailable",
    interruption_occurred_at: null,
    interruption_reason_category: null,
    interruption_resume_hint: null,
  };
}

/** Sunday occurrences only. Monday–Saturday do not read the tape or interruption. */
export async function loadSundayContextForDelivery(args: {
  memberLocalDate: string;
  timeZone: string;
  clerkUserId: string;
  commitmentId: string;
  now: Date;
}): Promise<SundayContextEvidence | "not_sunday"> {
  if (weekdayLongFromLocalDayKey(args.memberLocalDate) !== "Sunday") return "not_sunday";
  const period = mondayThroughSundayEnding(args.memberLocalDate);
  if (!period || !args.commitmentId.trim() || !args.timeZone.trim()) {
    return unavailableSundayEvidence();
  }
  const [tape, interruption] = await Promise.all([
    loadSundayAccountabilityTape({
      commitmentId: args.commitmentId,
      clerkUserId: args.clerkUserId,
      timezone: args.timeZone,
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
  const coaching: SundayCoachingContext = {
    week_start_local_date: period.weekStartLocalDate,
    week_end_local_date: period.weekEndLocalDate,
    information_available_through_utc: args.now.toISOString(),
    accountability_events:
      tape.status === "loaded"
        ? { status: "loaded", events: tape.events }
        : { status: "unavailable", events: [] },
    planned_interruption: interruption,
  };
  return sundayContextEvidenceFromCoaching(coaching);
}

export function reconsiderationInputsChanged(args: {
  considered: TtoInputEvidence | null;
  failedAttempt: TtoInputEvidence | null;
  discovered: DiscoveredConversationMessage[];
  unidentifiedReplies?: UnidentifiedCoachReply[];
  retrieval: "ok" | "failed" | "incomplete";
  goalText: string | null;
  goalReadOk: boolean;
  delivery: { utcInstant: string; effectiveLocalMinute: number; timeZone: string } | null;
  deliveryReadOk: boolean;
  scheduleChangedSinceSuccess: boolean;
  scheduleChangedSinceFailure: boolean;
  retryAfter: string | null;
  now: Date;
  /**
   * The current body has a confirmed delivery context that differs from the
   * live schedule, and that exact body has not already been considered for it.
   */
  editContextRequiresReconsideration?: boolean;
  /** Machine intentional space is no longer valid because a touch is now required. */
  requiredTouchChanged?: boolean;
  /**
   * Current Sunday tape. "not_sunday" and omitted mean Monday–Saturday: no Sunday read.
   */
  sundayNow?: SundayContextEvidence | "not_sunday";
}): "unchanged" | "changed" | "unresolved" | "backoff" {
  if (!args.goalReadOk || !args.deliveryReadOk || args.retrieval === "failed") return "unresolved";
  const sundayAgainst = (
    record: TtoInputEvidence | null
  ): "skip" | "unchanged" | "changed" | "unresolved" => {
    if (!args.sundayNow || args.sundayNow === "not_sunday") return "skip";
    return sundayContextChanged({
      considered: record?.sunday_context,
      current: args.sundayNow,
    });
  };
  const sundayVsSuccess = sundayAgainst(args.considered);
  if (sundayVsSuccess === "unresolved") return "unresolved";
  if (!args.considered) return args.retrieval === "ok" ? "changed" : "unresolved";
  const conversation = conversationHasUnconsideredMessage(args.discovered, args.considered, {
    now: args.now,
    unidentifiedReplies: args.unidentifiedReplies,
  });
  if (conversation === "unresolved") return "unresolved";
  if (args.retrieval === "incomplete" && conversation !== "new") return "unresolved";
  const goalChanged = (args.goalText ?? "").trim() !== (args.considered.goal_text ?? "").trim();
  const deliveryChanged = !sameDeliveryFacts(args.considered, args.delivery);
  if (args.retryAfter && args.failedAttempt) {
    const retryAt = Date.parse(args.retryAfter);
    const failedConversation =
      args.failedAttempt.retrieval_failed === true &&
      !Array.isArray(args.failedAttempt.retrieval_unavailable_source_ids)
        ? "same"
        : conversationHasUnconsideredMessage(args.discovered, args.failedAttempt, {
          now: args.now,
          unidentifiedReplies: args.unidentifiedReplies,
        });
    const failedGoal =
      (args.goalText ?? "").trim() === (args.failedAttempt.goal_text ?? "").trim();
    const failedDelivery = sameDeliveryFacts(args.failedAttempt, args.delivery);
    const sundayVsFailure = sundayAgainst(args.failedAttempt);
    if (
      Number.isFinite(retryAt) &&
      retryAt > args.now.getTime() &&
      failedConversation !== "new" &&
      failedConversation !== "unresolved" &&
      failedGoal &&
      failedDelivery &&
      !args.scheduleChangedSinceFailure &&
      sundayVsFailure !== "changed" &&
      sundayVsFailure !== "unresolved"
    ) {
      return "backoff";
    }
  }
  if (
    conversation === "new" ||
    goalChanged ||
    deliveryChanged ||
    sundayVsSuccess === "changed" ||
    args.scheduleChangedSinceSuccess ||
    args.editContextRequiresReconsideration === true ||
    args.requiredTouchChanged === true
  ) {
    return "changed";
  }
  return "unchanged";
}

/**
 * True only when the existing no-model KEEP is legitimate.
 * A changed Sunday tape or interruption requires the interpreter.
 * Unavailable Sunday evidence is not a shortcut and is not a successful empty tape.
 * Monday–Saturday pass "not_sunday" and keep the previous shortcut rules.
 */
export function reconsiderationScheduleOnly(args: {
  moveBack: boolean;
  conversationIsNew: boolean;
  factsDifferFromEvidence: boolean;
  materialScheduleChange: boolean;
  goalUnchanged: boolean;
  zoneDrift: boolean;
  sundayNow: SundayContextEvidence | "not_sunday";
  consideredSunday?: SundayContextEvidence | null;
}): boolean {
  if (args.sundayNow !== "not_sunday") {
    const sunday = sundayContextChanged({
      considered: args.consideredSunday,
      current: args.sundayNow,
    });
    if (sunday === "changed" || sunday === "unresolved") return false;
  }
  return !args.moveBack
    && !args.conversationIsNew
    && !args.factsDifferFromEvidence
    && !args.materialScheduleChange
    && args.goalUnchanged
    && !args.zoneDrift;
}

/** Future, or an already-scheduled instant still inside the 15-minute grace. */
export function scheduledDeliveryRemainsActionable(args: {
  now: Date;
  utcInstant: string;
  memberLocalDate: string;
  timeZone: string;
}): boolean {
  const instant = Date.parse(args.utcInstant);
  if (!Number.isFinite(instant)) return false;
  if (!args.timeZone.trim()) return instant > args.now.getTime();
  if (instant > args.now.getTime()) return true;
  return scheduledOccurrenceGraceOpen(args);
}

/**
 * An existing occurrence whose own instant is still inside grace stays actionable.
 * A different minute that is already past is a newly selected late time and does not.
 */
export function existingGraceDeliveryShouldContinue(args: {
  now: Date;
  live: { utcInstant: string; memberLocalDate: string; timeZone: string; effectiveLocalMinute: number };
  stored: { utcInstant: string; memberLocalDate: string; timeZone: string; effectiveLocalMinute: number } | null;
}): boolean {
  if (!args.stored) return false;
  const sameSelection = args.stored.utcInstant === args.live.utcInstant
    || (
      args.stored.memberLocalDate === args.live.memberLocalDate
      && args.stored.effectiveLocalMinute === args.live.effectiveLocalMinute
      && args.stored.timeZone === args.live.timeZone
    );
  if (!sameSelection) return false;
  return scheduledDeliveryRemainsActionable({
    now: args.now,
    utcInstant: args.stored.utcInstant,
    memberLocalDate: args.stored.memberLocalDate,
    timeZone: args.stored.timeZone,
  });
}

/**
 * Accepted precedence: explicit schedule, then a successfully read Clerk timezone,
 * then audience, then the resolver fallback. A failed Clerk read is not an empty Clerk timezone.
 */
export function authoritativeSchedulingTimezone(args: {
  scheduleTimezone: string | null;
  clerkTimezone: unknown;
  clerkReadOk: boolean;
  audienceTimezone: unknown;
  audienceUnreadable?: boolean;
}): { zone: string; source: "schedule" | "clerk" | "audience" | "default" } | null {
  const explicit = args.scheduleTimezone?.trim() ?? "";
  if (!explicit && !args.clerkReadOk) return null;
  const resolved = resolveAccountSmsTimezone({
    scheduleTimezone: explicit || null,
    clerkTimezone: explicit ? null : args.clerkTimezone,
    audienceTimezone: args.audienceTimezone,
    audienceUnreadable: args.audienceUnreadable === true,
  });
  if (resolved.invalidExplicit || resolved.source === "unknown" || !resolved.zone) return null;
  if (
    resolved.source !== "schedule"
    && resolved.source !== "clerk"
    && resolved.source !== "audience"
    && resolved.source !== "default"
  ) {
    return null;
  }
  return { zone: resolved.zone, source: resolved.source };
}

/** Reserve one shared work slot before an awaited claim so two workers cannot pass the cap together. */
export function reserveActualWorkSlot(actual: { value: number }, cap: number): boolean {
  if (actual.value >= cap) return false;
  actual.value += 1;
  return true;
}

export function releaseActualWorkSlot(actual: { value: number }): void {
  if (actual.value > 0) actual.value -= 1;
}

export function crossOwnerSourceVersionsMatch(
  live: CrossOwnerSourceVersion,
  evaluated: CrossOwnerSourceVersion | null
): boolean {
  if (!evaluated) return false;
  return live.sourceDraftId === evaluated.sourceDraftId
    && live.sourceGenerationId === evaluated.sourceGenerationId
    && (live.sourceBodyHash ?? null) === (evaluated.sourceBodyHash ?? null)
    && recordedInstantsMatch(live.sourceEditedAt, evaluated.sourceEditedAt)
    && (live.sourceBodySource ?? null) === (evaluated.sourceBodySource ?? null)
    && live.sourceEditedByTyler === evaluated.sourceEditedByTyler;
}

/**
 * Transfer only a Tyler source the target has not successfully evaluated,
 * and only when that source is newer than a Tyler target.
 * A machine replacement is not treated as older than every source edit.
 */
export function shouldTransferCrossOwnerSource(args: {
  sourceIsTyler: boolean;
  source: CrossOwnerSourceVersion | null;
  targetIsTyler: boolean;
  targetEditedAt: string | null;
  evaluated: CrossOwnerSourceVersion | null;
}): boolean {
  if (!args.sourceIsTyler || !args.source?.sourceEditedByTyler) return false;
  if (crossOwnerSourceVersionsMatch(args.source, args.evaluated)) return false;
  const sourceMs = args.source.sourceEditedAt ? Date.parse(args.source.sourceEditedAt) : NaN;
  if (!Number.isFinite(sourceMs)) return false;
  if (args.evaluated) {
    const evaluatedMs = args.evaluated.sourceEditedAt ? Date.parse(args.evaluated.sourceEditedAt) : NaN;
    return Number.isFinite(evaluatedMs) ? sourceMs > evaluatedMs : true;
  }
  if (!args.targetIsTyler) return true;
  const targetMs = args.targetEditedAt ? Date.parse(args.targetEditedAt) : NaN;
  return Number.isFinite(targetMs) && sourceMs > targetMs;
}

export function crossOwnerActionForCandidate(args: {
  clerkUserId: string;
  memberLocalDate: string;
  sendSlot: string;
  draft: object | null | undefined;
  drafts: { get(key: string): object | undefined };
  generationMeta: Map<string, Record<string, unknown>>;
}): { transfer: boolean; moveBack: boolean } {
  const versionOf = (row: object | null | undefined): CrossOwnerSourceVersion | null => {
    if (!row) return null;
    const record = row as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.current_generation_id !== "string") return null;
    return {
      sourceDraftId: record.id,
      sourceGenerationId: record.current_generation_id,
      sourceBodyHash: typeof record.current_body_hash === "string" ? record.current_body_hash : null,
      sourceEditedAt: typeof record.edited_at === "string" ? record.edited_at : null,
      sourceBodySource: typeof record.current_body_source === "string" ? record.current_body_source : null,
      sourceEditedByTyler: record.edited_by_tyler === true || record.current_body_source === "tyler_edit",
    };
  };
  const otherSlot = args.sendSlot === SMS_DAILY_PRODUCTION_SEND_SLOT
    ? SMS_DAILY_EVENING_PREVIEW_SEND_SLOT
    : SMS_DAILY_PRODUCTION_SEND_SLOT;
  const other = args.drafts.get(`${args.clerkUserId}|${args.memberLocalDate}|${otherSlot}`);
  const source = versionOf(other);
  const target = versionOf(args.draft);
  const targetMeta = target ? args.generationMeta.get(target.sourceGenerationId) : null;
  const transfer = shouldTransferCrossOwnerSource({
    sourceIsTyler: source?.sourceEditedByTyler === true,
    source,
    targetIsTyler: target?.sourceEditedByTyler === true,
    targetEditedAt: target?.sourceEditedAt ?? null,
    evaluated: evaluatedCrossOwnerSourceFromMetadata(targetMeta),
  });
  const otherEvaluated = evaluatedCrossOwnerSourceFromMetadata(
    source ? args.generationMeta.get(source.sourceGenerationId) : null
  );
  const targetAlreadyDecided = target != null && evidenceApprovesCurrentBody(
    successfulConsiderationEvidence(targetMeta),
    {
      generation_id: target.sourceGenerationId,
      body_hash: target.sourceBodyHash,
      edited_at: target.sourceEditedAt,
      body_source: target.sourceBodySource,
      edited_by_tyler: target.sourceEditedByTyler,
    }
  );
  const moveBack = !transfer
    && !targetAlreadyDecided
    && target != null
    && otherEvaluated != null
    && crossOwnerSourceVersionsMatch(target, otherEvaluated)
    && (source?.sourceBodyHash ?? null) !== target.sourceBodyHash;
  return { transfer, moveBack };
}

export function evaluatedCrossOwnerSourceFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): CrossOwnerSourceVersion | null {
  const evidence = successfulConsiderationEvidence(metadata);
  const raw = evidence?.evaluated_cross_owner_source;
  if (!raw || typeof raw !== "object") return null;
  const row = raw as CrossOwnerSourceVersion;
  if (typeof row.sourceDraftId !== "string" || typeof row.sourceGenerationId !== "string") return null;
  return row;
}

export function scheduledOccurrenceGraceOpen(args: {
  now: Date;
  utcInstant: string;
  memberLocalDate: string;
  timeZone: string;
}): boolean {
  return evaluateScheduledDeliveryGrace(args).due;
}

/**
 * Whether this exact body may be submitted for this live delivery without another model call.
 * Initial generation evidence is sufficient when it records this delivery and nothing newer is unconsidered.
 * A KEEP, REPLACE, current-context Tyler edit, or policy retention must still satisfy delivery and freshness.
 */
export function scheduledDailyBodyAuthorization(args: {
  now: Date;
  live: {
    utcInstant: string;
    effectiveLocalMinute: number;
    timeZone: string;
    memberLocalDate: string;
    owner: string;
  };
  occurrenceState: string | null;
  draft: {
    generationId: string | null;
    body: string | null;
    bodyHash: string | null;
    bodySource: string | null;
    editedByTyler: boolean;
    editedAt: string | null;
  } | null;
  machineShouldSend: boolean | null;
  machineNoSendReason: string | null;
  messageRequiredToday: boolean | null;
  metadata: Record<string, unknown> | null;
  currentGoal: string | null;
  goalReadOk: boolean;
  conversation: "new" | "same" | "unresolved";
  retrievalOk: boolean;
  /** Omitted or not_sunday on Monday–Saturday. */
  sundayNow?: SundayContextEvidence | "not_sunday";
}): { action: "send"; body: string } | { action: "silence"; reason: "intentional_space" | "tyler_blank" } | { action: "hold"; reason: string } {
  const grace = evaluateScheduledDeliveryGrace({
    now: args.now,
    utcInstant: args.live.utcInstant,
    memberLocalDate: args.live.memberLocalDate,
    timeZone: args.live.timeZone,
  });
  if (!grace.due) return { action: "hold", reason: grace.reason };
  const state = args.occurrenceState;
  if (!state) return { action: "hold", reason: "missing_occurrence" };
  if (
    state === "sent" ||
    state === "expired" ||
    state === "ineligible" ||
    state === "legacy_conflict" ||
    state === "pending" ||
    state === "claimed" ||
    state === "failed"
  ) {
    return { action: "hold", reason: `occurrence_${state}` };
  }
  if (!args.goalReadOk || args.currentGoal == null) return { action: "hold", reason: "goal_unresolved" };
  if (!args.retrievalOk || args.conversation === "unresolved") {
    return { action: "hold", reason: "retrieval_incomplete" };
  }
  if (args.conversation === "new") return { action: "hold", reason: "unconsidered_member_information" };
  if (args.sundayNow && args.sundayNow !== "not_sunday") {
    const recorded = successfulConsiderationEvidence(args.metadata);
    const rawInput = args.metadata && args.metadata.input_evidence && typeof args.metadata.input_evidence === "object"
      ? args.metadata.input_evidence as TtoInputEvidence
      : null;
    const sunday = sundayContextChanged({
      considered: (recorded ?? rawInput)?.sunday_context,
      current: args.sundayNow,
    });
    if (sunday === "unresolved") return { action: "hold", reason: "sunday_context_unresolved" };
    if (sunday === "changed") return { action: "hold", reason: "sunday_context_changed" };
  }
  const draft = args.draft;
  if (!draft?.generationId) return { action: "hold", reason: "missing_draft" };
  const body = (draft.body ?? "").trim();
  const tyler = draft.editedByTyler === true || draft.bodySource === "tyler_edit";
  if (tyler && !body) return { action: "silence", reason: "tyler_blank" };
  if (args.machineNoSendReason === MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE && !tyler) {
    if (args.messageRequiredToday == null) return { action: "hold", reason: "required_touch_unresolved" };
    if (args.messageRequiredToday) return { action: "hold", reason: "required_touch_changed" };
    return { action: "silence", reason: "intentional_space" };
  }
  if (!body) return { action: "hold", reason: "missing_body" };
  if (!draft.bodyHash) return { action: "hold", reason: "missing_body_hash" };
  if (args.machineShouldSend === false && !tyler) return { action: "hold", reason: "machine_should_not_send" };
  const version: TtoBodyVersion = {
    generation_id: draft.generationId,
    body_hash: draft.bodyHash,
    edited_at: draft.editedAt,
    body_source: draft.bodySource,
    edited_by_tyler: draft.editedByTyler,
  };
  const metadata = args.metadata;
  const considered = successfulConsiderationEvidence(metadata);
  const input = metadata && metadata.input_evidence && typeof metadata.input_evidence === "object"
    ? metadata.input_evidence as TtoInputEvidence
    : null;
  const context = readTylerEditDeliveryContext(metadata);
  const liveDelivery = {
    utcInstant: args.live.utcInstant,
    effectiveLocalMinute: args.live.effectiveLocalMinute,
    timeZone: args.live.timeZone,
  };
  const goalMatches = (record: TtoInputEvidence | null) =>
    (args.currentGoal ?? "").trim() === (record?.goal_text ?? "").trim();
  const deliveryMatches = (record: TtoInputEvidence | null) =>
    sameDeliveryFacts(record, liveDelivery)
    && (record?.delivery.member_local_date ?? "") === args.live.memberLocalDate;
  if (considered?.delivery_mismatch_unresolved === true) {
    return { action: "hold", reason: "delivery_mismatch_unresolved" };
  }
  if (
    currentBodyEditContextRequiresReconsideration({
      context,
      currentBodyHash: draft.bodyHash,
      current: {
        memberLocalDate: args.live.memberLocalDate,
        effectiveLocalMinute: args.live.effectiveLocalMinute,
        timeZone: args.live.timeZone,
        utcInstant: args.live.utcInstant,
        owner: args.live.owner,
      },
      considered,
      currentVersion: version,
    })
  ) {
    return { action: "hold", reason: "edit_context_mismatch" };
  }
  if (
    evidenceApprovesCurrentBody(considered, version)
    && deliveryMatches(considered)
    && goalMatches(considered)
  ) {
    return { action: "send", body };
  }
  if (
    tyler
    && editContextBelongsToBodyVersion(context, version)
    && !tylerEditDeliveryMateriallyDiffers({
      context,
      currentBodyHash: draft.bodyHash,
      current: {
        memberLocalDate: args.live.memberLocalDate,
        effectiveLocalMinute: args.live.effectiveLocalMinute,
        timeZone: args.live.timeZone,
        utcInstant: args.live.utcInstant,
        owner: args.live.owner,
      },
    })
    && goalMatches(input ?? considered)
  ) {
    return { action: "send", body };
  }
  const reconsideration = metadata?.reconsideration_evidence;
  const hasReconsideration = Boolean(
    reconsideration && typeof reconsideration === "object" && !Array.isArray(reconsideration)
  );
  if (
    !tyler
    && !hasReconsideration
    && input
    && deliveryMatches(input)
    && goalMatches(input)
    && metadata?.scheduled_generation_convention === "member_local_delivery_v1"
  ) {
    return { action: "send", body };
  }
  if (context?.status === "unavailable") return { action: "hold", reason: "edit_context_unavailable" };
  return { action: "hold", reason: "body_not_authorized" };
}

export type LoadedMemberConversation =
  | { retrieval: "failed"; messages: DiscoveredConversationMessage[]; unidentifiedReplies: UnidentifiedCoachReply[] }
  | MemberConversationDiscovery;

export function conversationsFromDiscoveryPayload(
  clerkIds: string[],
  payload: unknown
): Map<string, LoadedMemberConversation> {
  const failed = (): Map<string, LoadedMemberConversation> => {
    const found = new Map<string, LoadedMemberConversation>();
    for (const clerkUserId of clerkIds) {
      found.set(clerkUserId, { retrieval: "failed", messages: [], unidentifiedReplies: [] });
    }
    return found;
  };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return failed();
  const record = payload as {
    inbound?: unknown;
    coach?: unknown;
    proactive?: unknown;
    weekly?: unknown;
  };
  if (
    !Array.isArray(record.inbound) ||
    !Array.isArray(record.coach) ||
    !Array.isArray(record.proactive) ||
    !Array.isArray(record.weekly)
  ) {
    return failed();
  }
  const inboundByMember = new Map<string, Record<string, unknown>[]>();
  const coachByMember = new Map<string, Record<string, unknown>[]>();
  const sendByMember = new Map<string, Record<string, unknown>[]>();
  const weeklyByMember = new Map<string, Record<string, unknown>[]>();
  const takeRow = (
    row: unknown,
    dest: Map<string, Record<string, unknown>[]>
  ): boolean => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const clerkUserId = typeof (row as { clerk_user_id?: unknown }).clerk_user_id === "string"
      ? (row as { clerk_user_id: string }).clerk_user_id
      : "";
    if (!clerkUserId) return false;
    const list = dest.get(clerkUserId) ?? [];
    list.push(row as Record<string, unknown>);
    dest.set(clerkUserId, list);
    return true;
  };
  for (const row of record.inbound) {
    if (!takeRow(row, inboundByMember)) return failed();
  }
  for (const row of record.coach) {
    if (!takeRow(row, coachByMember)) return failed();
  }
  for (const row of record.proactive) {
    if (!takeRow(row, sendByMember)) return failed();
  }
  for (const row of record.weekly) {
    if (!takeRow(row, weeklyByMember)) return failed();
  }
  const found = new Map<string, LoadedMemberConversation>();
  for (const clerkUserId of clerkIds) {
    const inboundRows = inboundByMember.get(clerkUserId) ?? [];
    const coachRows = coachByMember.get(clerkUserId) ?? [];
    found.set(clerkUserId, discoverMemberMessages({
      inboundRows,
      inboundCapped: inboundRows.length >= MEMBER_CONVERSATION_READ_LIMIT,
      coachRows,
      coachCapped: coachRows.length >= MEMBER_CONVERSATION_READ_LIMIT,
      sendRows: sendByMember.get(clerkUserId) ?? [],
      weeklyRows: weeklyByMember.get(clerkUserId) ?? [],
    }));
  }
  return found;
}

async function loadCandidateConversations(
  clerkIds: string[],
  now: Date
): Promise<Map<string, LoadedMemberConversation>> {
  if (clerkIds.length === 0) return new Map();
  const { data, error } = await supabaseServer.rpc("tto_reconsideration_conversation_discovery", {
    p_clerk_user_ids: clerkIds,
    p_now: now.toISOString(),
    p_limit: MEMBER_CONVERSATION_READ_LIMIT,
  });
  if (error) {
    return conversationsFromDiscoveryPayload(clerkIds, null);
  }
  return conversationsFromDiscoveryPayload(clerkIds, data);
}

async function patchReconsiderationOccurrence(args: {
  candidate: NextOccurrenceCandidate;
  state: OccurrenceState;
  expectedState: OccurrenceState;
  expectedGenerationId?: string | null;
  expectedEditedAt?: string | null;
  refreshDelivery: boolean;
  delivery?: {
    utcInstant: string;
    selectedLocalMinute: number;
    effectiveLocalMinute: number;
    timeZone: string;
  };
}): Promise<void> {
  const occurrence: ScheduledOccurrence = {
    ...args.candidate.occurrence,
    state: args.state,
    ...(args.delivery
      ? {
          utcInstant: args.delivery.utcInstant,
          selectedLocalMinute: args.delivery.selectedLocalMinute,
          effectiveLocalMinute: args.delivery.effectiveLocalMinute,
          timeZone: args.delivery.timeZone,
        }
      : {}),
    patchKind: args.state === "expired" || args.state === "ineligible" ? "eligibility" : "reconcile",
  };
  const { error } = await supabaseServer.rpc("tto_generation_batch_patch", {
    p_batch_date: args.candidate.batchDate,
    p_send_slot: args.candidate.sendSlot,
    p_actor_trigger: "automatic_schedule",
    p_patches: [
      {
        ...occurrenceToJson(occurrence),
        expected_state: args.expectedState,
        ...(args.expectedGenerationId
          ? { expected_generation_id: args.expectedGenerationId }
          : {}),
        ...("expectedEditedAt" in args
          ? { expected_edited_at: args.expectedEditedAt ?? null }
          : {}),
        ...(args.refreshDelivery ? { refresh_delivery: "true" } : {}),
      },
    ],
    p_append: [],
  });
  if (error) throw new Error(error.message);
}

export async function loadOneScheduledConversation(
  clerkUserId: string,
  now: Date
): Promise<LoadedMemberConversation> {
  const loaded = await loadCandidateConversations([clerkUserId], now);
  return loaded.get(clerkUserId) ?? {
    retrieval: "failed",
    messages: [],
    unidentifiedReplies: [],
  };
}

/** Records sent, or a miss/silence reason, without reopening a closed delivery. */
export async function recordScheduledDeliveryOccurrence(args: {
  batchDate: string;
  owner: ProactiveTtoOwner;
  occurrence: ScheduledOccurrence;
  state: OccurrenceState;
  detail: string;
}): Promise<void> {
  const patchKind: BatchPatchKind = args.state === "sent" ? "delivery" : "reconcile";
  const occurrence: ScheduledOccurrence = {
    ...args.occurrence,
    state: args.state,
    detail: args.detail,
    patchKind,
  };
  const { error } = await supabaseServer.rpc("tto_generation_batch_patch", {
    p_batch_date: args.batchDate,
    p_send_slot: proactiveSendSlotForOwner(args.owner),
    p_actor_trigger: "automatic_schedule",
    p_patches: [{
      ...occurrenceToJson(occurrence),
      expected_state: args.occurrence.state,
    }],
    p_append: [],
  });
  if (error) throw new Error(error.message);
}

async function earlierEligibleDeliveryBlocks(args: {
  clerkUserId: string;
  memberLocalDate: string;
  candidateUtc: string;
  now: Date;
  loaded?: LoadedScheduleSnapshot;
}): Promise<"yes" | "no" | "unresolved"> {
  const sms = args.loaded?.sms ?? (await readMemberSmsSendability(args.clerkUserId));
  if (!sms.ok) return "unresolved";
  if (!sms.sendable) return "no";
  const commitment = args.loaded
    ? args.loaded.commitmentRead
    : await readActiveCommitmentForCadence(args.clerkUserId);
  if (!commitment.ok) return "unresolved";
  if (!commitment.commitment?.behavior_statement) return "no";
  const read = args.loaded
    ? args.loaded.preferenceRead
    : await readV2UserSmsCommsPreferences(args.clerkUserId);
  if (!read.ok) return "unresolved";
  let clerkTimezone: unknown = null;
  const explicitZone = read.row?.schedule_timezone?.trim() ?? "";
  if (args.loaded) {
    if (!explicitZone && !args.loaded.clerkReadOk) return "unresolved";
    clerkTimezone = explicitZone ? null : args.loaded.clerkTimezone;
  } else {
    try {
      const user = await getClerkUser(args.clerkUserId);
      const metadata = (user.public_metadata ?? {}) as Record<string, unknown>;
      clerkTimezone = metadata.timezone;
    } catch {
      if (!explicitZone) return "unresolved";
    }
  }
  const history = args.loaded?.historyByUser ?? new Map<string, CachedCadence>();
  const dates = [
    dayKeyOffset(args.memberLocalDate, -2),
    dayKeyOffset(args.memberLocalDate, -1),
    args.memberLocalDate,
  ];
  for (const memberLocalDate of dates) {
    const decision = await cadenceDecisionForMemberDate({
      clerkUserId: args.clerkUserId,
      read,
      memberLocalDate,
      now: args.now,
      historyByUser: history,
      commitmentRead: commitment,
    });
    if (decision === "unresolved") return "unresolved";
    const result = resolveProactiveSchedule({
      preferenceRead: preferenceReadFromRow(read),
      clerkTimezone,
      audienceTimezone: args.loaded?.audienceTimezone ?? sms.timezone,
      audienceUnreadable: args.loaded?.audienceUnreadable === true,
      memberLocalDate,
      proactiveDeliveryAllowed: true,
      ...(decision === "eligible"
        ? { legacyCadenceEligible: true }
        : decision === "not_due"
          ? { legacyCadenceEligible: false }
          : {}),
    });
    if (result.kind === "unresolved") return "unresolved";
    if (result.kind !== "scheduled") continue;
    if (
      earlierDeliveryBlocksCandidate({
        candidateUtc: args.candidateUtc,
        now: args.now,
        earlierUtcInstants: [result.utcInstant],
      })
    ) {
      return "yes";
    }
  }
  return "no";
}

/** One PostgREST GET. The same bound used by linked generation reads. */
export const RECONSIDERATION_GENERATION_READ_CHUNK = 100;

export type ReconsiderationGenerationRow = {
  id?: string;
  generated_at?: string;
  generation_metadata?: unknown;
  machine_no_send_reason?: string | null;
};

export type ReconsiderationGenerationReadFailure = {
  operation: "reconsideration_generation_read";
  generation_id_count: number;
  failed_chunk_size: number;
  supabase_code: string | null;
  message: string;
};

type ScheduledReconsiderationResult = {
  ok: boolean;
  considered: number;
  kept_or_replaced: number;
  skipped_unchanged: number;
  error: ReconsiderationGenerationReadFailure | null;
};

function reconsiderationIdle(): ScheduledReconsiderationResult {
  return { ok: true, considered: 0, kept_or_replaced: 0, skipped_unchanged: 0, error: null };
}

/** Unique, non-empty ids, in first-seen order, split so no request exceeds the chunk bound. */
export function reconsiderationGenerationReadChunks(ids: readonly string[]): string[][] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += RECONSIDERATION_GENERATION_READ_CHUNK) {
    chunks.push(unique.slice(index, index + RECONSIDERATION_GENERATION_READ_CHUNK));
  }
  return chunks;
}

function safeReconsiderationReadMessage(message: string | null | undefined): string {
  const compact = (message ?? "").replace(/\s+/g, " ").trim();
  const withoutIds = compact.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
    "[id]"
  );
  if (!withoutIds) return "generation_read_failed";
  return withoutIds.slice(0, 240);
}

/**
 * Reads generation rows in bounded GETs.
 * A failed or unstarted chunk discards every row already read.
 * The caller must not continue with a partial map.
 */
export async function loadReconsiderationGenerationRows(args: {
  ids: readonly string[];
  deadlineMs: number;
  nowMs?: () => number;
  readChunk: (ids: string[]) => Promise<{
    data: ReconsiderationGenerationRow[] | null;
    error: { code?: string | null; message?: string | null } | null;
  }>;
}): Promise<
  | { ok: true; rows: ReconsiderationGenerationRow[] }
  | { ok: false; failure: ReconsiderationGenerationReadFailure }
> {
  const chunks = reconsiderationGenerationReadChunks(args.ids);
  const generationIdCount = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const nowMs = args.nowMs ?? (() => Date.now());
  const byId = new Map<string, ReconsiderationGenerationRow>();
  for (const chunk of chunks) {
    if (nowMs() >= args.deadlineMs) {
      const failure: ReconsiderationGenerationReadFailure = {
        operation: "reconsideration_generation_read",
        generation_id_count: generationIdCount,
        failed_chunk_size: chunk.length,
        supabase_code: null,
        message: "execution_budget_exhausted",
      };
      console.error("[scheduled-reconsideration] generation read failed", failure);
      return { ok: false, failure };
    }
    const result = await args.readChunk(chunk);
    if (result.error) {
      const code = result.error.code?.trim() ?? "";
      const failure: ReconsiderationGenerationReadFailure = {
        operation: "reconsideration_generation_read",
        generation_id_count: generationIdCount,
        failed_chunk_size: chunk.length,
        supabase_code: code || null,
        message: safeReconsiderationReadMessage(result.error.message),
      };
      console.error("[scheduled-reconsideration] generation read failed", failure);
      return { ok: false, failure };
    }
    for (const row of result.data ?? []) {
      if (typeof row.id !== "string" || !row.id || byId.has(row.id)) continue;
      byId.set(row.id, row);
    }
  }
  return { ok: true, rows: [...byId.values()] };
}

async function readReconsiderationGenerationChunk(
  ids: string[]
): Promise<{
  data: ReconsiderationGenerationRow[] | null;
  error: { code?: string | null; message?: string | null } | null;
}> {
  const { data, error } = await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .select("id, generated_at, generation_metadata, machine_no_send_reason")
    .in("id", ids);
  if (error) return { data: null, error: { code: error.code, message: error.message } };
  return { data: (data ?? []) as ReconsiderationGenerationRow[], error: null };
}

async function runScheduledReconsideration(args: {
  now: Date;
  deadlineMs: number;
  chunkCap?: number;
}): Promise<ScheduledReconsiderationResult> {
  const today = getDateKeyInTimezone(args.now, PROACTIVE_SCHEDULE_ADMIN_TIMEZONE);
  const dates = [dayKeyOffset(today, -1), today, dayKeyOffset(today, 1)];
  const { data, error } = await supabaseServer
    .from(SMS_TTO_GENERATION_BATCHES_TABLE)
    .select("*")
    .in("batch_date", dates)
    .in("send_slot", [SMS_DAILY_PRODUCTION_SEND_SLOT, SMS_DAILY_EVENING_PREVIEW_SEND_SLOT]);
  if (error || !Array.isArray(data)) {
    return reconsiderationIdle();
  }
  const batches = data
    .map((row) => batchFromJson(row))
    .filter((row): row is ScheduledBatchRecord => row != null);
  const upcoming = listUpcomingOccurrenceCandidates(batches, args.now);
  if (upcoming.length === 0) {
    return reconsiderationIdle();
  }
  const clerkIds = [...new Set(upcoming.map((item) => item.occurrence.clerkUserId))];
  const [draftRes, goalRes, preferenceRes, audienceRes, conversations] = await Promise.all([
    supabaseServer
      .from(SMS_DAILY_DRAFTS_TABLE)
      .select(
        "id, clerk_user_id, draft_for_day_key, send_slot, status, current_generation_id, current_body_to_send, current_body_source, current_body_hash, edited_by_tyler, edited_at"
      )
      .in("clerk_user_id", clerkIds)
      .eq("status", "current"),
    supabaseServer
      .from("v2_commitment")
      .select(
        "id, clerk_user_id, behavior_statement, adaptive_ask_text, adaptive_ask_expires_at, status"
      )
      .in("clerk_user_id", clerkIds)
      .eq("status", "active"),
    supabaseServer
      .from("v2_user_sms_comms_preferences")
      .select(
        "clerk_user_id, updated_at, created_at, pause_until, pause_indefinite, schedule_timezone, weekly_schedule, cadence_override, weekend_send_policy"
      )
      .in("clerk_user_id", clerkIds),
    supabaseServer
      .from("sms_audience")
      .select("clerk_user_id, timezone")
      .in("clerk_user_id", clerkIds),
    loadCandidateConversations(clerkIds, args.now),
  ]);
  if (draftRes.error || goalRes.error || preferenceRes.error) {
    return reconsiderationIdle();
  }
  const drafts = new Map<string, Record<string, unknown>>();
  for (const row of (draftRes.data ?? []) as Record<string, unknown>[]) {
    const key = `${row.clerk_user_id}|${row.draft_for_day_key}|${row.send_slot}`;
    drafts.set(key, row);
  }
  const generationIds = [
    ...new Set(
      [...drafts.values()]
        .map((row) => (typeof row.current_generation_id === "string" ? row.current_generation_id : ""))
        .filter(Boolean)
    ),
  ];
  const generationMeta = new Map<string, Record<string, unknown>>();
  const generationAt = new Map<string, string>();
  const generationNoSend = new Map<string, string | null>();
  if (generationIds.length > 0) {
    const loaded = await loadReconsiderationGenerationRows({
      ids: generationIds,
      deadlineMs: args.deadlineMs,
      readChunk: readReconsiderationGenerationChunk,
    });
    if (!loaded.ok) {
      return { ...reconsiderationIdle(), ok: false, error: loaded.failure };
    }
    for (const row of loaded.rows) {
      if (typeof row.id === "string" && row.generation_metadata && typeof row.generation_metadata === "object") {
        generationMeta.set(row.id, row.generation_metadata as Record<string, unknown>);
      }
      if (typeof row.id === "string" && typeof row.generated_at === "string") {
        generationAt.set(row.id, row.generated_at);
      }
      if (typeof row.id === "string") {
        generationNoSend.set(
          row.id,
          typeof row.machine_no_send_reason === "string" ? row.machine_no_send_reason : null
        );
      }
    }
  }
  const goals = new Map<string, string>();
  const ambiguousGoals = new Set<string>();
  const commitmentReads = new Map<string, Awaited<ReturnType<typeof readActiveCommitmentForCadence>>>();
  for (const row of (goalRes.data ?? []) as Record<string, unknown>[]) {
    const clerk = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
    if (!clerk) continue;
    if (goals.has(clerk)) {
      ambiguousGoals.add(clerk);
      continue;
    }
    goals.set(clerk, effectiveCoachingAskForDiscovery({
      behavior_statement: typeof row.behavior_statement === "string" ? row.behavior_statement : "",
      adaptive_ask_text: typeof row.adaptive_ask_text === "string" ? row.adaptive_ask_text : null,
      adaptive_ask_expires_at:
        typeof row.adaptive_ask_expires_at === "string" ? row.adaptive_ask_expires_at : null,
    }, args.now.getTime()));
    commitmentReads.set(clerk, {
      ok: true,
      commitment: {
        id: typeof row.id === "string" ? row.id : "",
        behavior_statement: typeof row.behavior_statement === "string" ? row.behavior_statement : "",
        adaptive_ask_text: typeof row.adaptive_ask_text === "string" ? row.adaptive_ask_text : null,
        adaptive_ask_expires_at:
          typeof row.adaptive_ask_expires_at === "string" ? row.adaptive_ask_expires_at : null,
      } as ActiveV2CommitmentRow,
    });
  }
  const preferences = new Map<string, {
    updatedAt: string | null;
    paused: boolean;
    scheduleTimezone: string | null;
    read: V2UserSmsCommsPreferencesRead;
  }>();
  for (const row of (preferenceRes.data ?? []) as Record<string, unknown>[]) {
    const clerk = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
    if (!clerk) continue;
    const pauseUntil = typeof row.pause_until === "string" ? Date.parse(row.pause_until) : NaN;
    const parsedSchedule = parseWeeklySchedule(
      Object.prototype.hasOwnProperty.call(row, "weekly_schedule") ? row.weekly_schedule : null
    );
    const cadence = row.cadence_override;
    const weekend = row.weekend_send_policy;
    preferences.set(clerk, {
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
      paused: row.pause_indefinite === true || (Number.isFinite(pauseUntil) && pauseUntil > args.now.getTime()),
      scheduleTimezone: typeof row.schedule_timezone === "string" ? row.schedule_timezone : null,
      read: {
        ok: true,
        row: {
          clerk_user_id: clerk,
          pause_until: typeof row.pause_until === "string" ? row.pause_until : null,
          pause_reason_category: null,
          cadence_override:
            cadence === "daily" || cadence === "every_other_day" || cadence === "every_3_days"
              ? cadence
              : null,
          weekend_send_policy: weekend === "all" || weekend === "weekdays_only" ? weekend : null,
          preferred_send_window: null,
          preferred_local_hour: null,
          source_message_sid: null,
          resume_prompt_sent_at: null,
          weekly_schedule: parsedSchedule.ok ? parsedSchedule.schedule : null,
          weekly_schedule_invalid: !parsedSchedule.ok,
          schedule_timezone:
            typeof row.schedule_timezone === "string" && row.schedule_timezone.trim()
              ? row.schedule_timezone.trim()
              : null,
          pause_indefinite: row.pause_indefinite === true,
          created_at: typeof row.created_at === "string" ? row.created_at : args.now.toISOString(),
          updated_at: typeof row.updated_at === "string" ? row.updated_at : args.now.toISOString(),
        },
      },
    });
  }
  const audienceTimezones = new Map<string, string | null>();
  if (!audienceRes.error) {
    for (const row of (audienceRes.data ?? []) as Record<string, unknown>[]) {
      const clerk = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
      if (!clerk) continue;
      audienceTimezones.set(clerk, typeof row.timezone === "string" ? row.timezone : null);
    }
  }
  const clerkTimezones = new Map<string, unknown>();
  const clerkUnread = new Set<string>();
  const clerkCandidates = clerkIds.filter((clerkUserId) => {
    const saved = preferences.get(clerkUserId)?.scheduleTimezone?.trim() ?? "";
    return saved.length === 0;
  });
  for (let index = 0; index < clerkCandidates.length; index += 4) {
    const chunk = clerkCandidates.slice(index, index + 4);
    await Promise.all(chunk.map(async (clerkUserId) => {
      try {
        const user = await getClerkUser(clerkUserId);
        const metadata = (user.public_metadata ?? {}) as Record<string, unknown>;
        clerkTimezones.set(clerkUserId, metadata.timezone);
      } catch {
        clerkUnread.add(clerkUserId);
      }
    }));
  }
  const workable: Array<
    NextOccurrenceCandidate & {
      scheduleOnly: boolean;
      failureCount: number;
      preserveTylerEdit: boolean;
      attemptedSunday: SundayContextEvidence | "not_sunday";
    }
  > = [];
  const repairs: Array<{
    candidate: NextOccurrenceCandidate;
    state: "generated" | "intentional_space" | "protected";
    expectedGenerationId: string;
    expectedEditedAt: string | null;
  }> = [];
  let skippedUnchanged = 0;
  const upcomingByMember = new Map<string, NextOccurrenceCandidate[]>();
  for (const item of upcoming) {
    const list = upcomingByMember.get(item.occurrence.clerkUserId) ?? [];
    list.push(item);
    upcomingByMember.set(item.occurrence.clerkUserId, list);
  }
  const historyByUser = new Map<string, CachedCadence>();
  const candidates: NextOccurrenceCandidate[] = [];
  const discoveryIdsByUser = new Map<string, string[]>();
  const liveDeliveryByCandidate = new Map<string, {
    utcInstant: string;
    effectiveLocalMinute: number;
    timeZone: string;
    memberLocalDate: string;
    owner: string;
  }>();
  for (const [clerkUserId, occurrences] of upcomingByMember) {
    const preference = preferences.get(clerkUserId);
    const preferenceRead = preference?.read ?? { ok: true as const, row: null };
    const commitmentRead = ambiguousGoals.has(clerkUserId)
      ? { ok: false as const, error: "ambiguous_commitment" }
      : commitmentReads.get(clerkUserId) ?? { ok: true as const, commitment: null };
    const savedZone = preference?.scheduleTimezone?.trim() ?? "";
    const needsClerk = savedZone.length === 0;
    if (needsClerk && (audienceRes.error || clerkUnread.has(clerkUserId))) {
      continue;
    }
    const dates = new Set<string>();
    const localDates = occurrences.map((item) => item.occurrence.memberLocalDate).sort();
    let cursor = dayKeyOffset(localDates[0] ?? today, -2);
    const lastDate = localDates[localDates.length - 1] ?? cursor;
    for (let step = 0; step < 8; step += 1) {
      dates.add(cursor);
      if (cursor >= lastDate) break;
      cursor = dayKeyOffset(cursor, 1);
    }
    const schedule: AuthoritativeDelivery[] = [];
    const expiredDeliveries: AuthoritativeDelivery[] = [];
    let scheduleUnresolved = false;
    for (const memberLocalDate of dates) {
      const decision = await cadenceDecisionForMemberDate({
        clerkUserId,
        read: preferenceRead,
        memberLocalDate,
        now: args.now,
        historyByUser,
        commitmentRead,
      });
      if (decision === "unresolved") {
        scheduleUnresolved = true;
        break;
      }
      const result = resolveProactiveSchedule({
        preferenceRead: preferenceReadFromRow(preferenceRead),
        clerkTimezone: needsClerk ? clerkTimezones.get(clerkUserId) ?? null : null,
        audienceTimezone: audienceTimezones.get(clerkUserId) ?? null,
        audienceUnreadable: Boolean(audienceRes.error) && needsClerk,
        memberLocalDate,
        proactiveDeliveryAllowed: true,
        ...(decision === "eligible"
          ? { legacyCadenceEligible: true }
          : decision === "not_due"
            ? { legacyCadenceEligible: false }
            : {}),
      });
      if (result.kind === "unresolved") {
        scheduleUnresolved = true;
        break;
      }
      if (result.kind !== "scheduled") continue;
      const plannedDelivery = {
        memberLocalDate: result.memberLocalDate,
        owner: result.owner,
        batchDate: result.batchDate,
        utcInstant: result.utcInstant,
        effectiveLocalMinute: result.effectiveLocalMinute,
        timeZone: result.timeZone,
      };
      const plannedMs = Date.parse(result.utcInstant);
      if (Number.isFinite(plannedMs) && plannedMs <= args.now.getTime()) {
        const stored = occurrences.find((item) =>
          item.occurrence.memberLocalDate === result.memberLocalDate
          && item.owner === result.owner
          && item.batchDate === result.batchDate
          && item.occurrence.state !== "sent"
          && item.occurrence.state !== "expired"
          && item.occurrence.state !== "legacy_conflict"
        );
        if (existingGraceDeliveryShouldContinue({
          now: args.now,
          live: {
            utcInstant: result.utcInstant,
            memberLocalDate: result.memberLocalDate,
            timeZone: result.timeZone,
            effectiveLocalMinute: result.effectiveLocalMinute,
          },
          stored: stored
            ? {
                utcInstant: stored.occurrence.utcInstant,
                memberLocalDate: stored.occurrence.memberLocalDate,
                timeZone: stored.occurrence.timeZone,
                effectiveLocalMinute: stored.occurrence.effectiveLocalMinute,
              }
            : null,
        })) {
          schedule.push(plannedDelivery);
        } else {
          expiredDeliveries.push(plannedDelivery);
        }
        continue;
      }
      schedule.push(plannedDelivery);
    }
    if (!scheduleUnresolved) {
      for (const item of occurrences) {
        if (!RECONSIDERATION_STATES.has(item.occurrence.state)) continue;
        const expired = expiredDeliveries.some(
          (delivery) =>
            delivery.memberLocalDate === item.occurrence.memberLocalDate &&
            delivery.owner === item.owner &&
            delivery.batchDate === item.batchDate
        );
        if (!expired) continue;
        const draft = drafts.get(
          `${item.occurrence.clerkUserId}|${item.occurrence.memberLocalDate}|${item.sendSlot}`
        );
        const generationId =
          draft && typeof draft.current_generation_id === "string" ? draft.current_generation_id : null;
        try {
          await patchReconsiderationOccurrence({
            candidate: item,
            state: "expired",
            expectedState: item.occurrence.state,
            expectedGenerationId: generationId,
            expectedEditedAt: typeof draft?.edited_at === "string" ? draft.edited_at : null,
            refreshDelivery: false,
          });
        } catch {
          continue;
        }
      }
    }
    const chosen = chooseAuthoritativeReconsiderationCandidate({
      occurrences,
      schedule: scheduleUnresolved ? "unresolved" : schedule,
      now: args.now,
    });
    if (chosen) {
      candidates.push(chosen);
      const live = schedule.find(
        (item) =>
          item.memberLocalDate === chosen.occurrence.memberLocalDate &&
          item.owner === chosen.owner &&
          item.batchDate === chosen.batchDate
      );
      if (
        live &&
        typeof live.effectiveLocalMinute === "number" &&
        typeof live.timeZone === "string" &&
        live.timeZone.trim()
      ) {
        liveDeliveryByCandidate.set(
          `${chosen.occurrence.clerkUserId}|${chosen.occurrence.memberLocalDate}|${chosen.sendSlot}`,
          {
            utcInstant: live.utcInstant,
            effectiveLocalMinute: live.effectiveLocalMinute,
            timeZone: live.timeZone,
            memberLocalDate: live.memberLocalDate,
            owner: live.owner === "evening" ? "evening_checkin" : "morning",
          }
        );
      }
    }
  }
  for (const candidate of candidates) {
    const preference = preferences.get(candidate.occurrence.clerkUserId);
    if (
      ambiguousGoals.has(candidate.occurrence.clerkUserId) ||
      !goals.has(candidate.occurrence.clerkUserId)
    ) {
      continue;
    }
    const conversation = conversations.get(candidate.occurrence.clerkUserId);
    const retrieval = conversation?.retrieval ?? "failed";
    const discovered = conversation && conversation.retrieval !== "failed" ? conversation.messages : [];
    discoveryIdsByUser.set(
      candidate.occurrence.clerkUserId,
      discovered.map((message) => message.sourceId).filter((sourceId) => sourceId.trim() !== "")
    );
    const unidentifiedReplies =
      conversation && conversation.retrieval !== "failed" ? conversation.unidentifiedReplies : [];
    const draft = drafts.get(
      `${candidate.occurrence.clerkUserId}|${candidate.occurrence.memberLocalDate}|${candidate.sendSlot}`
    );
    const generationId =
      draft && typeof draft.current_generation_id === "string" ? draft.current_generation_id : "";
    const metadata = generationId ? generationMeta.get(generationId) : undefined;
    const considered = successfulConsiderationEvidence(metadata);
    const currentBodyVersion: TtoBodyVersion = {
      generation_id: generationId || null,
      body_hash: typeof draft?.current_body_hash === "string" ? draft.current_body_hash : null,
      edited_at: typeof draft?.edited_at === "string" ? draft.edited_at : null,
      body_source: typeof draft?.current_body_source === "string" ? draft.current_body_source : null,
      edited_by_tyler: draft?.edited_by_tyler === true,
    };
    const rawFailure = reconsiderationFailureEvidence(metadata);
    const failedAttempt = failureAppliesToCurrentBody(rawFailure, currentBodyVersion) ? rawFailure : null;
    const savedZone = preference?.scheduleTimezone?.trim() ?? "";
    const needsClerk = savedZone.length === 0;
    const timezoneReadOk = !needsClerk || (!audienceRes.error && !clerkUnread.has(candidate.occurrence.clerkUserId));
    const accountZone = resolveAccountSmsTimezone({
      scheduleTimezone: savedZone || null,
      clerkTimezone: needsClerk ? clerkTimezones.get(candidate.occurrence.clerkUserId) ?? null : null,
      audienceTimezone: audienceTimezones.get(candidate.occurrence.clerkUserId) ?? null,
      audienceUnreadable: Boolean(audienceRes.error) && needsClerk,
    });
    const zoneKnown = timezoneReadOk && accountZone.source !== "unknown" && !accountZone.invalidExplicit;
    const observedPreferenceAt = considered?.delivery.preference_updated_at
      ?? (generationId ? generationAt.get(generationId) ?? null : null);
    const failedPreferenceAt = failedAttempt?.delivery.preference_updated_at ?? null;
    const successZone = considered?.delivery.time_zone ?? candidate.occurrence.timeZone;
    const failureZone = failedAttempt?.delivery.time_zone ?? successZone;
    const scheduleChangedSinceSuccess = Boolean(
      preference?.updatedAt && (!observedPreferenceAt || preference.updatedAt > observedPreferenceAt)
    ) || (zoneKnown && accountZone.zone !== successZone);
    const scheduleChangedSinceFailure = Boolean(
      preference?.updatedAt && (!failedPreferenceAt || preference.updatedAt > failedPreferenceAt)
    ) || (zoneKnown && accountZone.zone !== failureZone);
    const liveDelivery = liveDeliveryByCandidate.get(
      `${candidate.occurrence.clerkUserId}|${candidate.occurrence.memberLocalDate}|${candidate.sendSlot}`
    );
    const liveFacts = {
      memberLocalDate: liveDelivery?.memberLocalDate ?? candidate.occurrence.memberLocalDate,
      effectiveLocalMinute: liveDelivery?.effectiveLocalMinute ?? candidate.occurrence.effectiveLocalMinute,
      timeZone: liveDelivery?.timeZone ?? (zoneKnown ? accountZone.zone : candidate.occurrence.timeZone),
      utcInstant: liveDelivery?.utcInstant ?? candidate.occurrence.utcInstant,
      owner: liveDelivery?.owner ?? candidate.sendSlot,
    };
    const editContextRequiresReconsideration = currentBodyEditContextRequiresReconsideration({
      context: readTylerEditDeliveryContext(metadata),
      currentBodyHash: currentBodyVersion.body_hash,
      current: liveFacts,
      considered,
      currentVersion: currentBodyVersion,
    });
    const noSendReason = generationId ? generationNoSend.get(generationId) ?? null : null;
    const tylerBody = draft?.edited_by_tyler === true || draft?.current_body_source === "tyler_edit";
    let requiredTouchChanged = false;
    if (noSendReason === MACHINE_NO_SEND_REASON_INTENTIONAL_SPACE && !tylerBody && zoneKnown) {
      const storedRequired = metadata?.message_required_today;
      const days = metadata?.days_since_last_user_response;
      const unanswered = metadata?.recent_unanswered_outbound_count;
      if (storedRequired === true) {
        requiredTouchChanged = false;
      } else if (typeof days === "number" && typeof unanswered === "number") {
        const quiet = await resolveQuietRelationshipMechanicalFacts({
          clerkUserId: candidate.occurrence.clerkUserId,
          timezone: liveFacts.timeZone,
          localDate: liveFacts.memberLocalDate,
          daysSinceLastUserResponse: days,
          neverReplied: metadata?.never_replied === true,
          recentUnansweredOutboundCount: unanswered,
          observedAsOfLocalDate: getDateKeyInTimezone(args.now, liveFacts.timeZone),
        });
        if (quiet.clock_lookup_failed) continue;
        requiredTouchChanged = quiet.message_required_today === true && storedRequired !== true;
      } else if (storedRequired === false) {
        requiredTouchChanged = false;
      }
    }
    const goalReadOk = !ambiguousGoals.has(candidate.occurrence.clerkUserId);
    let sundayNow: SundayContextEvidence | "not_sunday" = "not_sunday";
    if (
      zoneKnown &&
      goalReadOk &&
      weekdayLongFromLocalDayKey(liveFacts.memberLocalDate) === "Sunday"
    ) {
      const commitmentRead = commitmentReads.get(candidate.occurrence.clerkUserId);
      sundayNow = await loadSundayContextForDelivery({
        memberLocalDate: liveFacts.memberLocalDate,
        timeZone: liveFacts.timeZone,
        clerkUserId: candidate.occurrence.clerkUserId,
        commitmentId: commitmentRead?.ok ? commitmentRead.commitment?.id ?? "" : "",
        now: args.now,
      });
    }
    const decision = reconsiderationInputsChanged({
      considered,
      failedAttempt,
      discovered,
      unidentifiedReplies,
      retrieval: retrieval === "failed" ? "failed" : retrieval,
      goalText: goalReadOk ? goals.get(candidate.occurrence.clerkUserId) ?? "" : null,
      goalReadOk,
      sundayNow,
      delivery: {
        utcInstant: liveFacts.utcInstant,
        effectiveLocalMinute: liveFacts.effectiveLocalMinute,
        timeZone: liveFacts.timeZone,
      },
      deliveryReadOk: zoneKnown,
      editContextRequiresReconsideration,
      scheduleChangedSinceSuccess,
      scheduleChangedSinceFailure,
      requiredTouchChanged,
      retryAfter:
        failedAttempt && metadata && typeof metadata.reconsideration_retry_after === "string"
          ? metadata.reconsideration_retry_after
          : null,
      now: args.now,
    });
    if (
      reconsiderationReadiness({
        goalReadOk: !ambiguousGoals.has(candidate.occurrence.clerkUserId),
        preferenceReadOk: true,
        draftReadOk: true,
        generationReadOk: true,
        retrieval: retrieval === "failed" ? "failed" : "ok",
      }) === "unresolved" &&
      decision === "unresolved"
    ) {
      continue;
    }
    const draftState = dashboardOutcomeFromCurrentDraft({
      editedByTyler: draft?.edited_by_tyler === true,
      bodySource: typeof draft?.current_body_source === "string" ? draft.current_body_source : null,
      body: typeof draft?.current_body_to_send === "string" ? draft.current_body_to_send : null,
      machineNoSendReason: generationId ? generationNoSend.get(generationId) ?? null : null,
    });
    const repairState = dashboardRepairState({
      occurrenceState: candidate.occurrence.state,
      draftState,
    });
    if (repairState && generationId && decision !== "changed") {
      repairs.push({
        candidate,
        state: repairState,
        expectedGenerationId: generationId,
        expectedEditedAt: typeof draft?.edited_at === "string" ? draft.edited_at : null,
      });
    }
    const crossOwner = crossOwnerActionForCandidate({
      clerkUserId: candidate.occurrence.clerkUserId,
      memberLocalDate: candidate.occurrence.memberLocalDate,
      sendSlot: candidate.sendSlot,
      draft,
      drafts,
      generationMeta,
    });
    const mustReconsider = decision === "changed" || crossOwner.transfer || crossOwner.moveBack;
    if (decision === "unchanged" && !mustReconsider) skippedUnchanged += 1;
    if (mustReconsider) {
      const sundayComparison = sundayNow === "not_sunday"
        ? "skip"
        : sundayContextChanged({
            considered: considered?.sunday_context,
            current: sundayNow,
          });
      // A failed Sunday read stays on the existing recovery path. Do not KEEP
      // the previous tape, and do not hand an unavailable read to the model.
      if (sundayComparison !== "unresolved") {
      const conversationIsNew = conversationHasUnconsideredMessage(discovered, considered, {
        now: args.now,
        unidentifiedReplies,
      }) === "new";
      const live = liveDeliveryByCandidate.get(
        `${candidate.occurrence.clerkUserId}|${candidate.occurrence.memberLocalDate}|${candidate.sendSlot}`
      );
      const currentFacts = {
        memberLocalDate: live?.memberLocalDate ?? candidate.occurrence.memberLocalDate,
        effectiveLocalMinute: live?.effectiveLocalMinute ?? candidate.occurrence.effectiveLocalMinute,
        timeZone: live?.timeZone ?? (zoneKnown ? accountZone.zone : candidate.occurrence.timeZone),
        utcInstant: live?.utcInstant ?? candidate.occurrence.utcInstant,
        owner: live?.owner ?? candidate.sendSlot,
      };
      const bodyHash = typeof draft?.current_body_hash === "string" ? draft.current_body_hash : null;
      const materialScheduleChange = tylerEditDeliveryMateriallyDiffers({
        context: readTylerEditDeliveryContext(metadata),
        currentBodyHash: bodyHash,
        current: currentFacts,
      });
      const factsDifferFromEvidence = !sameDeliveryFacts(considered, {
        utcInstant: currentFacts.utcInstant,
        effectiveLocalMinute: currentFacts.effectiveLocalMinute,
        timeZone: currentFacts.timeZone,
      });
      const tylerHolds =
        (draft?.edited_by_tyler === true || draft?.current_body_source === "tyler_edit") &&
        !conversationIsNew &&
        !materialScheduleChange;
      workable.push({
        ...candidate,
        scheduleOnly: reconsiderationScheduleOnly({
          moveBack: crossOwner.moveBack,
          conversationIsNew,
          factsDifferFromEvidence,
          materialScheduleChange,
          goalUnchanged:
            (goals.get(candidate.occurrence.clerkUserId) ?? "").trim() === (considered?.goal_text ?? "").trim(),
          zoneDrift: zoneKnown && accountZone.zone !== successZone,
          sundayNow,
          consideredSunday: considered?.sunday_context,
        }),
        failureCount: reconsiderationFailureCount(metadata),
        preserveTylerEdit: crossOwner.moveBack ? false : tylerHolds,
        attemptedSunday: sundayNow,
      });
      }
    }
  }
  for (const repair of repairs) {
    try {
      await patchReconsiderationOccurrence({
        candidate: repair.candidate,
        state: repair.state,
        expectedState: repair.candidate.occurrence.state,
        expectedGenerationId: repair.expectedGenerationId,
        expectedEditedAt: repair.expectedEditedAt,
        refreshDelivery: false,
      });
    } catch {
      continue;
    }
  }
  const workCap = args.chunkCap ?? TTO_GENERATE_ALL_CHUNK_USER_CAP;
  const ordered = orderReconsiderationWork(workable);
  let keptOrReplaced = 0;
  const actualWork = { value: 0 };
  await runPoolWithBudget({
    items: ordered,
    concurrency: TTO_GENERATE_ALL_CONCURRENCY,
    shouldStop: () => Date.now() >= args.deadlineMs || actualWork.value >= workCap,
    worker: async (candidate) => {
      const preference = preferences.get(candidate.occurrence.clerkUserId);
      const savedZone = preference?.scheduleTimezone?.trim() ?? "";
      const needsClerk = savedZone.length === 0;
      const sms = await readMemberSmsSendability(candidate.occurrence.clerkUserId);
      const loaded: LoadedScheduleSnapshot = {
        preferenceRead: preference?.read ?? { ok: true, row: null },
        commitmentRead: ambiguousGoals.has(candidate.occurrence.clerkUserId)
          ? { ok: false, error: "ambiguous_commitment" }
          : commitmentReads.get(candidate.occurrence.clerkUserId) ?? { ok: true, commitment: null },
        clerkTimezone: needsClerk ? clerkTimezones.get(candidate.occurrence.clerkUserId) ?? null : null,
        clerkReadOk: !needsClerk || !clerkUnread.has(candidate.occurrence.clerkUserId),
        audienceTimezone: audienceTimezones.get(candidate.occurrence.clerkUserId) ?? null,
        audienceUnreadable: Boolean(audienceRes.error) && needsClerk,
        historyByUser,
        sms,
      };
      const checked = await revalidatePendingOccurrence({
        occurrence: candidate.occurrence,
        owner: candidate.owner,
        batchDate: candidate.batchDate,
        now: args.now,
        loaded,
      });
      const disposition = occurrenceRevalidationDisposition(checked);
      if (disposition === "patch_expired" || disposition === "patch_ineligible") {
        const currentDraft = drafts.get(
          `${candidate.occurrence.clerkUserId}|${candidate.occurrence.memberLocalDate}|${candidate.sendSlot}`
        );
        const currentGenerationId =
          currentDraft && typeof currentDraft.current_generation_id === "string"
            ? currentDraft.current_generation_id
            : null;
        try {
          await patchReconsiderationOccurrence({
            candidate,
            state: disposition === "patch_expired" ? "expired" : "ineligible",
            expectedState: candidate.occurrence.state,
            expectedGenerationId: currentGenerationId,
            expectedEditedAt:
              currentDraft && typeof currentDraft.edited_at === "string" ? currentDraft.edited_at : null,
            refreshDelivery: false,
          });
        } catch {
          return;
        }
        return;
      }
      if (disposition !== "proceed") return;
      const earlier = await earlierEligibleDeliveryBlocks({
        clerkUserId: candidate.occurrence.clerkUserId,
        memberLocalDate: candidate.occurrence.memberLocalDate,
        candidateUtc: checked.action === "rescheduled" ? checked.utcInstant : candidate.occurrence.utcInstant,
        now: args.now,
        loaded,
      });
      if (earlier !== "no") return;
      const draft = drafts.get(
        `${candidate.occurrence.clerkUserId}|${candidate.occurrence.memberLocalDate}|${candidate.sendSlot}`
      );
      if (!draft || typeof draft.current_generation_id !== "string") return;
      const otherSlot = candidate.sendSlot === SMS_DAILY_PRODUCTION_SEND_SLOT
        ? SMS_DAILY_EVENING_PREVIEW_SEND_SLOT
        : SMS_DAILY_PRODUCTION_SEND_SLOT;
      const otherDraftRes = await supabaseServer
        .from(SMS_DAILY_DRAFTS_TABLE)
        .select("id, current_generation_id, current_body_to_send, current_body_hash, current_body_source, edited_by_tyler, edited_at")
        .eq("clerk_user_id", candidate.occurrence.clerkUserId)
        .eq("draft_for_day_key", candidate.occurrence.memberLocalDate)
        .eq("send_slot", otherSlot)
        .eq("status", "current")
        .maybeSingle();
      if (otherDraftRes.error) return;
      const otherDraft = otherDraftRes.data;
      const otherIsTyler = otherDraft?.edited_by_tyler === true || otherDraft?.current_body_source === "tyler_edit";
      const currentIsTyler = draft.edited_by_tyler === true || draft.current_body_source === "tyler_edit";
      const sourceVersion: CrossOwnerSourceVersion | null = otherDraft && typeof otherDraft.id === "string" && typeof otherDraft.current_generation_id === "string"
        ? {
            sourceDraftId: otherDraft.id,
            sourceGenerationId: otherDraft.current_generation_id,
            sourceBodyHash: typeof otherDraft.current_body_hash === "string" ? otherDraft.current_body_hash : null,
            sourceEditedAt: typeof otherDraft.edited_at === "string" ? otherDraft.edited_at : null,
            sourceBodySource: typeof otherDraft.current_body_source === "string" ? otherDraft.current_body_source : null,
            sourceEditedByTyler: otherIsTyler,
          }
        : null;
      const targetMeta = generationMeta.get(draft.current_generation_id) ?? null;
      let transferredSource: CrossOwnerSourceVersion | null = null;
      if (
        shouldTransferCrossOwnerSource({
          sourceIsTyler: otherIsTyler,
          source: sourceVersion,
          targetIsTyler: currentIsTyler,
          targetEditedAt: typeof draft.edited_at === "string" ? draft.edited_at : null,
          evaluated: evaluatedCrossOwnerSourceFromMetadata(targetMeta),
        })
        && sourceVersion
        && otherDraft
        && typeof otherDraft.current_generation_id === "string"
      ) {
        const sourceDraft = otherDraft;
        const sourceGeneration = await supabaseServer
          .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
          .select("generation_metadata")
          .eq("id", sourceDraft.current_generation_id)
          .maybeSingle();
        if (sourceGeneration.error) return;
        const sourceMeta = sourceGeneration.data?.generation_metadata && typeof sourceGeneration.data.generation_metadata === "object"
          ? sourceGeneration.data.generation_metadata as Record<string, unknown>
          : null;
        const sourceContext = readTylerEditDeliveryContext(sourceMeta) ?? { status: "unavailable" as const };
        const saved = await supabaseServer.rpc("tto_save_tyler_draft_body", {
          p_draft_id: draft.id,
          p_expected_generation_id: draft.current_generation_id,
          p_expected_day: candidate.occurrence.memberLocalDate,
          p_expected_slot: candidate.sendSlot,
          p_body: typeof otherDraft.current_body_to_send === "string" ? otherDraft.current_body_to_send : "",
          p_body_source: "tyler_edit",
          p_edited_by_tyler: true,
          p_edited_at: otherDraft.edited_at,
          p_edit_distance: null,
          p_body_hash: typeof otherDraft.current_body_hash === "string" ? otherDraft.current_body_hash : null,
          p_now: args.now.toISOString(),
          p_delivery_context: sourceContext,
          p_expected_edited_at: null,
          p_transfer_fence: {
            expected_edited_at: typeof draft.edited_at === "string" ? draft.edited_at : null,
            expected_body_hash: typeof draft.current_body_hash === "string" ? draft.current_body_hash : null,
            expected_body_source: typeof draft.current_body_source === "string" ? draft.current_body_source : null,
            expected_edited_by_tyler: currentIsTyler,
            source_draft_id: sourceVersion.sourceDraftId,
            source_generation_id: sourceVersion.sourceGenerationId,
            source_body_hash: sourceVersion.sourceBodyHash,
            source_edited_at: sourceVersion.sourceEditedAt,
            source_edited_by_tyler: true,
            source_body_source: "tyler_edit",
          },
        });
        const savedRow = saved.data && typeof saved.data === "object" && !Array.isArray(saved.data)
          ? saved.data as { ok?: boolean }
          : null;
        if (saved.error || savedRow?.ok !== true) return;
        transferredSource = sourceVersion;
        draft.current_body_to_send = typeof otherDraft.current_body_to_send === "string" ? otherDraft.current_body_to_send : "";
        draft.current_body_hash = typeof otherDraft.current_body_hash === "string" ? otherDraft.current_body_hash : null;
        draft.current_body_source = "tyler_edit";
        draft.edited_by_tyler = true;
        draft.edited_at = otherDraft.edited_at;
      }
      const delivery = {
        utc_instant: checked.action === "rescheduled" ? checked.utcInstant : candidate.occurrence.utcInstant,
        member_local_date: candidate.occurrence.memberLocalDate,
        batch_date: candidate.batchDate,
        effective_local_minute:
          checked.action === "rescheduled"
            ? checked.effectiveLocalMinute
            : candidate.occurrence.effectiveLocalMinute,
        time_zone: checked.action === "rescheduled" ? checked.timeZone : candidate.occurrence.timeZone,
        send_slot: candidate.sendSlot,
        preference_updated_at: preferences.get(candidate.occurrence.clerkUserId)?.updatedAt ?? null,
      };
      const claimOwnerId = crypto.randomUUID();
      if (!reserveActualWorkSlot(actualWork, workCap)) return;
      const { data: claimData, error: claimError } = await supabaseServer.rpc(
        "tto_claim_scheduled_generation",
        {
          p_clerk_user_id: candidate.occurrence.clerkUserId,
          p_draft_for_day_key: candidate.occurrence.memberLocalDate,
          p_send_slot: candidate.sendSlot,
          p_claim_owner_id: claimOwnerId,
          p_now: args.now.toISOString(),
          p_metadata: {},
          p_allow_failed_retry: false,
          p_mode: "reconsider",
        }
      );
      if (claimError) {
        releaseActualWorkSlot(actualWork);
        return;
      }
      const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as
        | { outcome?: string; generation_id?: string }
        | null;
      if (!claim || claim.outcome !== "claimed" || !claim.generation_id) {
        releaseActualWorkSlot(actualWork);
        return;
      }
      const claimedGen = await supabaseServer
        .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
        .select("generation_metadata")
        .eq("id", claim.generation_id)
        .maybeSingle();
      const claimedMeta =
        !claimedGen.error &&
        claimedGen.data &&
        claimedGen.data.generation_metadata &&
        typeof claimedGen.data.generation_metadata === "object"
          ? (claimedGen.data.generation_metadata as Record<string, unknown>)
          : null;
      if (!claimedMeta) return;
      const fence: TtoReconsiderationFence = {
        claimOwnerId,
        expectedGenerationId: claim.generation_id,
        expectedEditedAt:
          typeof claimedMeta.reconsideration_expected_edited_at === "string"
            ? claimedMeta.reconsideration_expected_edited_at
            : null,
        expectedBodyHash:
          typeof claimedMeta.reconsideration_expected_body_hash === "string"
            ? claimedMeta.reconsideration_expected_body_hash
            : null,
        expectedBodySource:
          typeof claimedMeta.reconsideration_expected_body_source === "string"
            ? claimedMeta.reconsideration_expected_body_source
            : null,
        expectedEditedByTyler: claimedMeta.reconsideration_expected_edited_by_tyler === true,
        currentBody: typeof draft.current_body_to_send === "string" ? draft.current_body_to_send : null,
        delivery,
        preserveTylerEdit: candidate.preserveTylerEdit,
        originalModelDelivery: originalModelDeliveryFromMetadata(
          claimedMeta,
          claimedMeta.reconsideration_expected_edited_by_tyler === true
        ),
        latestAffirmedDelivery: latestAffirmedDeliveryFromMetadata(
          claimedMeta,
          typeof draft.current_body_hash === "string" ? draft.current_body_hash : null,
          {
            generation_id: claim.generation_id,
            body_hash: typeof draft.current_body_hash === "string" ? draft.current_body_hash : null,
            edited_at: typeof draft.edited_at === "string" ? draft.edited_at : null,
            body_source: typeof draft.current_body_source === "string" ? draft.current_body_source : null,
            edited_by_tyler: draft.edited_by_tyler === true,
          }
        ),
        tylerEditDelivery: (() => {
          const context = readTylerEditDeliveryContext(claimedMeta);
          const bodyHash = typeof draft.current_body_hash === "string" ? draft.current_body_hash : null;
          if (!context || context.status !== "known" || (context.body_hash ?? null) !== bodyHash) return null;
          return context;
        })(),
        observedDiscoverySourceIds: discoveryIdsByUser.get(candidate.occurrence.clerkUserId) ?? [],
        transferredSourceEdit: transferredSource ?? evaluatedCrossOwnerSourceFromMetadata(claimedMeta) ?? undefined,
        attemptedSundayContext: candidate.attemptedSunday,
        deliveryMismatchUnresolved: (() => {
          if (candidate.preserveTylerEdit !== true) return false;
          const context = readTylerEditDeliveryContext(claimedMeta);
          const bodyHash = typeof draft.current_body_hash === "string" ? draft.current_body_hash : null;
          const contextKnown = context?.status === "known" && (context.body_hash ?? null) === bodyHash;
          if (contextKnown) return false;
          const original = originalModelDeliveryFromMetadata(
            claimedMeta,
            claimedMeta.reconsideration_expected_edited_by_tyler === true
          );
          const originalMinute = minuteFromHhMm(original.message_for?.intended_receive_time_local);
          const originalDiffers = original.status === "known" && original.message_for != null && (
            original.message_for.local_date !== delivery.member_local_date ||
            originalMinute !== delivery.effective_local_minute ||
            original.message_for.timezone !== delivery.time_zone ||
            (original.message_for.utc_instant != null &&
              delivery.utc_instant != null &&
              original.message_for.utc_instant !== delivery.utc_instant)
          );
          const evidenceDiffers = !sameDeliveryFacts(successfulConsiderationEvidence(claimedMeta), {
            utcInstant: delivery.utc_instant ?? "",
            effectiveLocalMinute: delivery.effective_local_minute ?? -1,
            timeZone: delivery.time_zone ?? "",
          });
          return originalDiffers || evidenceDiffers;
        })(),
      };
      const scheduledGenerationMetadata = buildScheduledGenerationMetadata({
        scheduled: {
          kind: "scheduled",
          memberLocalDate: candidate.occurrence.memberLocalDate,
          selectedLocalMinute:
            checked.action === "rescheduled"
              ? checked.selectedLocalMinute
              : candidate.occurrence.selectedLocalMinute,
          effectiveLocalMinute: delivery.effective_local_minute ?? candidate.occurrence.effectiveLocalMinute,
          timeZone: delivery.time_zone ?? candidate.occurrence.timeZone,
          timeZoneSource: "schedule",
          utcInstant: delivery.utc_instant ?? candidate.occurrence.utcInstant,
          easternDate: candidate.batchDate,
          easternMinute: 0,
          owner: proactiveOwnerForSendSlot(candidate.sendSlot),
          batchDate: candidate.batchDate,
        },
        trigger: "automatic_schedule",
      });
      if (candidate.scheduleOnly && checked.action === "ready") {
        const prior = successfulConsiderationEvidence(claimedMeta);
        const sundayAllowsShortcut = candidate.attemptedSunday === "not_sunday"
          || sundayContextChanged({
            considered: prior?.sunday_context,
            current: candidate.attemptedSunday,
          }) === "unchanged";
        // Policy retention of an already-evaluated body. A changed Sunday tape
        // falls through to the interpreter instead of being stamped onto prior evidence.
        if (prior && sundayAllowsShortcut) {
          const kept = await finishReconsiderationDecision({
            clerkUserId: candidate.occurrence.clerkUserId,
            draftForDayKey: candidate.occurrence.memberLocalDate,
            sendSlot: candidate.sendSlot,
            fence,
            result: "keep",
            evidence: {
              ...prior,
              succeeded: true,
              delivery: { ...prior.delivery, preference_updated_at: delivery.preference_updated_at },
            },
          });
          if (kept.ok) keptOrReplaced += 1;
          return;
        }
      }
      let generated: { ok: boolean; generationId?: string; machineNoSendReason?: string | null };
      try {
        if (candidate.owner === "evening") {
          generated = await generateTylerTextOverviewEveningPreviewForUser({
            clerkUserId: candidate.occurrence.clerkUserId,
            draftForDayKey: candidate.occurrence.memberLocalDate,
            now: args.now,
            scheduleAuthoritativelyResolved: true,
            scheduledGenerationMetadata,
            reconsideration: fence,
          });
        } else {
          const audience = await loadTylerTextOverviewAudienceRow(candidate.occurrence.clerkUserId);
          if (!audience) {
            await finishReconsiderationDecision({
              clerkUserId: candidate.occurrence.clerkUserId,
              draftForDayKey: candidate.occurrence.memberLocalDate,
              sendSlot: candidate.sendSlot,
              fence,
              result: "release",
              evidence: {
                ...(successfulConsiderationEvidence(claimedMeta) ?? {
                  goal_text: "",
                  existing_body_sha256: null,
                  existing_body_source: fence.expectedBodySource,
                  edited_by_tyler: fence.expectedEditedByTyler,
                  edited_at: fence.expectedEditedAt,
                  delivery,
                  attempt_id: claimOwnerId,
                  thread_tail: null,
                }),
                succeeded: false,
                retrieval_failed: true,
                evaluated_cross_owner_source: undefined,
                ...attemptedSundayFailureFields(candidate.attemptedSunday),
              },
            });
            return;
          }
          generated = await generateTylerTextOverviewDraftForUser({
            audienceUser: audience,
            draftForDayKey: candidate.occurrence.memberLocalDate,
            now: args.now,
            scheduleAuthoritativelyResolved: true,
            scheduledGenerationMetadata,
            reconsideration: fence,
          });
        }
      } catch {
        await finishReconsiderationDecision({
          clerkUserId: candidate.occurrence.clerkUserId,
          draftForDayKey: candidate.occurrence.memberLocalDate,
          sendSlot: candidate.sendSlot,
          fence,
          result: "release",
          evidence: {
            succeeded: false,
            retrieval_failed: true,
            considered_source_ids: [],
            thread_tail: null,
            goal_text: successfulConsiderationEvidence(claimedMeta)?.goal_text ?? "",
            existing_body_sha256: null,
            existing_body_source: fence.expectedBodySource,
            edited_by_tyler: fence.expectedEditedByTyler,
            edited_at: fence.expectedEditedAt,
            delivery,
            attempt_id: claimOwnerId,
            evaluated_cross_owner_source: undefined,
            ...attemptedSundayFailureFields(candidate.attemptedSunday),
          },
        });
        return;
      }
      if (!generated.ok) return;
      keptOrReplaced += 1;
      const replaced = generated.generationId !== fence.expectedGenerationId;
      if (!replaced && checked.action !== "rescheduled") return;
      try {
        await patchReconsiderationOccurrence({
          candidate,
          state: replaced
            ? replacementOccurrenceState(generated.machineNoSendReason)
            : candidate.occurrence.state,
          expectedState: candidate.occurrence.state,
          expectedGenerationId: replaced
            ? generated.generationId ?? fence.expectedGenerationId
            : fence.expectedGenerationId,
          expectedEditedAt: replaced ? null : fence.expectedEditedAt,
          refreshDelivery: checked.action === "rescheduled",
          delivery: checked.action === "rescheduled"
            ? {
                utcInstant: checked.utcInstant,
                selectedLocalMinute: checked.selectedLocalMinute,
                effectiveLocalMinute: checked.effectiveLocalMinute,
                timeZone: checked.timeZone,
              }
            : undefined,
        });
      } catch {
        return;
      }
    },
  });
  return {
    ok: true,
    considered: actualWork.value,
    kept_or_replaced: keptOrReplaced,
    skipped_unchanged: skippedUnchanged,
    error: null,
  };
}

/**
 * Outside the ordinary Eastern window, create the authoritative occurrence only when
 * a schedule move or a closed preparation window left the upcoming future delivery without one.
 * A time that is already past is not generated.
 */
async function recoverAuthoritativeOccurrences(args: {
  now: Date;
  deadlineMs: number;
  cap?: number;
}): Promise<number> {
  const today = getDateKeyInTimezone(args.now, PROACTIVE_SCHEDULE_ADMIN_TIMEZONE);
  const dates = [dayKeyOffset(today, -1), today, dayKeyOffset(today, 1)];
  const { data, error } = await supabaseServer
    .from(SMS_TTO_GENERATION_BATCHES_TABLE)
    .select("*")
    .in("batch_date", dates)
    .in("send_slot", [SMS_DAILY_PRODUCTION_SEND_SLOT, SMS_DAILY_EVENING_PREVIEW_SEND_SLOT]);
  if (error || !Array.isArray(data)) return 0;
  const batches = data
    .map((row) => batchFromJson(row))
    .filter((row): row is ScheduledBatchRecord => row != null);
  const members = new Set<string>();
  for (const batch of batches) {
    for (const occurrence of batch.occurrences) members.add(occurrence.clerkUserId);
  }
  let recovered = 0;
  for (const clerkUserId of members) {
    if (Date.now() >= args.deadlineMs || recovered >= (args.cap ?? TTO_GENERATE_ALL_CHUNK_USER_CAP)) break;
    const datesForMember = new Set<string>();
    for (const batch of batches) {
      for (const occurrence of batch.occurrences) {
        if (occurrence.clerkUserId === clerkUserId) datesForMember.add(occurrence.memberLocalDate);
      }
    }
    for (const memberLocalDate of datesForMember) {
      if (recovered >= (args.cap ?? TTO_GENERATE_ALL_CHUNK_USER_CAP)) break;
      const read = await readV2UserSmsCommsPreferences(clerkUserId);
      if (!read.ok) continue;
      const preference = preferenceReadFromRow(read);
      let clerkTimezone: unknown = null;
      const explicitZone = read.row?.schedule_timezone?.trim() ?? "";
      if (!explicitZone) {
        try {
          const user = await getClerkUser(clerkUserId);
          clerkTimezone = (user.public_metadata ?? {} as Record<string, unknown>).timezone;
        } catch {
          continue;
        }
      }
      const cadence = await cadenceDecisionForMemberDate({
        clerkUserId,
        read,
        memberLocalDate,
        now: args.now,
        historyByUser: new Map(),
      });
      if (cadence === "unresolved") continue;
      const resolved = resolveProactiveSchedule({
        preferenceRead: preference,
        clerkTimezone,
        audienceTimezone: null,
        memberLocalDate,
        proactiveDeliveryAllowed: true,
        ...(cadence === "eligible"
          ? { legacyCadenceEligible: true }
          : cadence === "not_due"
            ? { legacyCadenceEligible: false }
            : {}),
      });
      if (resolved.kind !== "scheduled") continue;
      const instant = Date.parse(resolved.utcInstant);
      if (!Number.isFinite(instant) || instant <= args.now.getTime()) continue;
      const ineligibleBatch = batches.find((batch) =>
        batch.sendSlot === proactiveSendSlotForOwner(resolved.owner)
        && batch.batchDate === resolved.batchDate
        && batch.occurrences.some((occurrence) =>
          occurrence.clerkUserId === clerkUserId
          && occurrence.memberLocalDate === memberLocalDate
          && occurrence.state === "ineligible"
        )
      );
      const ineligibleOccurrence = ineligibleBatch?.occurrences.find((occurrence) =>
        occurrence.clerkUserId === clerkUserId
        && occurrence.memberLocalDate === memberLocalDate
        && occurrence.state === "ineligible"
      );
      if (ineligibleBatch && ineligibleOccurrence) {
        const { error: reopenError } = await supabaseServer.rpc("tto_generation_batch_patch", {
          p_batch_date: resolved.batchDate,
          p_send_slot: proactiveSendSlotForOwner(resolved.owner),
          p_actor_trigger: "automatic_schedule",
          p_patches: [{
            ...occurrenceToJson({
              ...ineligibleOccurrence,
              state: "pending",
              detail: "eligible_again",
              patchKind: "eligibility",
            }),
            expected_state: "ineligible",
          }],
          p_append: [],
        });
        if (reopenError) continue;
        ineligibleOccurrence.state = "pending";
      }
      const already = batches.some((batch) =>
        batch.sendSlot === proactiveSendSlotForOwner(resolved.owner)
        && batch.batchDate === resolved.batchDate
        && batch.occurrences.some((occurrence) =>
          occurrence.clerkUserId === clerkUserId
          && occurrence.memberLocalDate === memberLocalDate
          && occurrence.state !== "expired"
          && occurrence.state !== "ineligible"
          && occurrence.state !== "failed"
        )
      );
      if (already) continue;
      const movedOrClosed = batches.some((batch) => {
        const owned = batch.occurrences.some((occurrence) =>
          occurrence.clerkUserId === clerkUserId && occurrence.memberLocalDate === memberLocalDate
        );
        if (!owned) return false;
        if (batch.sendSlot !== resolved.owner || batch.batchDate !== resolved.batchDate) return true;
        const ends = Date.parse(batch.windowEndsAt);
        return Number.isFinite(ends) && ends <= args.now.getTime();
      });
      if (!movedOrClosed) continue;
      const ran = await runScheduledTtoGeneration({
        now: args.now,
        owner: resolved.owner,
        batchDate: resolved.batchDate,
        trigger: "automatic_schedule",
        onlyClerkUserIds: [clerkUserId],
        onlyMemberLocalDate: memberLocalDate,
        recoverSingleMember: true,
        timeBudgetMs: Math.max(0, args.deadlineMs - Date.now()),
      });
      if (ran.ok) recovered += 1;
    }
  }
  recovered += await recoverMembersWithoutOccurrences({
    now: args.now,
    deadlineMs: args.deadlineMs,
    cap: Math.max(0, (args.cap ?? TTO_GENERATE_ALL_CHUNK_USER_CAP) - recovered),
    batches,
  });
  return recovered;
}

async function recoverMembersWithoutOccurrences(args: {
  now: Date;
  deadlineMs: number;
  cap: number;
  batches: ScheduledBatchRecord[];
}): Promise<number> {
  if (args.cap <= 0 || Date.now() >= args.deadlineMs) return 0;
  const audience = await supabaseServer
    .from("sms_audience")
    .select("clerk_user_id, timezone")
    .eq("sms_enabled", true)
    .eq("summitt_subscribed", true);
  if (audience.error || !Array.isArray(audience.data)) return 0;
  const ids = audience.data
    .map((row) => (typeof row.clerk_user_id === "string" ? row.clerk_user_id : ""))
    .filter(Boolean);
  if (ids.length === 0) return 0;
  const prefs = await supabaseServer
    .from("v2_user_sms_comms_preferences")
    .select("clerk_user_id, weekly_schedule, schedule_timezone, pause_indefinite, pause_until, cadence_override, weekend_send_policy")
    .in("clerk_user_id", ids);
  if (prefs.error || !Array.isArray(prefs.data)) return 0;
  const preferenceByUser = new Map<string, Record<string, unknown>>();
  for (const row of prefs.data as Record<string, unknown>[]) {
    if (typeof row.clerk_user_id === "string") preferenceByUser.set(row.clerk_user_id, row);
  }
  const clerkTimezoneByUser = new Map<string, unknown>();
  const clerkReadFailed = new Set<string>();
  const clerkNeeded = ids.filter((clerkUserId) => {
    const preference = preferenceByUser.get(clerkUserId);
    const scheduleZone = typeof preference?.schedule_timezone === "string" ? preference.schedule_timezone.trim() : "";
    return scheduleZone.length === 0;
  });
  for (let index = 0; index < clerkNeeded.length; index += 100) {
    const chunk = clerkNeeded.slice(index, index + 100);
    try {
      const users = await listClerkUsersByIds(chunk);
      const returned = new Set(users.map((user) => user.id));
      for (const user of users) {
        clerkTimezoneByUser.set(user.id, user.public_metadata?.timezone);
      }
      for (const clerkUserId of chunk) {
        if (!returned.has(clerkUserId)) clerkReadFailed.add(clerkUserId);
      }
    } catch {
      for (const clerkUserId of chunk) clerkReadFailed.add(clerkUserId);
    }
  }
  let recovered = 0;
  for (const row of audience.data) {
    if (recovered >= args.cap || Date.now() >= args.deadlineMs) break;
    const clerkUserId = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
    if (!clerkUserId) continue;
    const preference = preferenceByUser.get(clerkUserId);
    const scheduleZone = typeof preference?.schedule_timezone === "string" ? preference.schedule_timezone.trim() : "";
    const audienceZone = typeof row.timezone === "string" ? row.timezone.trim() : "";
    const authoritative = authoritativeSchedulingTimezone({
      scheduleTimezone: scheduleZone || null,
      clerkTimezone: clerkTimezoneByUser.get(clerkUserId),
      clerkReadOk: scheduleZone.length > 0 || !clerkReadFailed.has(clerkUserId),
      audienceTimezone: audienceZone || null,
    });
    if (!authoritative) continue;
    let memberLocalDate = "";
    try {
      memberLocalDate = getDateKeyInTimezone(args.now, authoritative.zone);
    } catch {
      continue;
    }
    const todayKey = memberLocalDate;
    for (const dateKey of [todayKey, dayKeyOffset(todayKey, 1)]) {
    const known = args.batches.some((batch) =>
      batch.occurrences.some((occurrence) =>
        occurrence.clerkUserId === clerkUserId && occurrence.memberLocalDate === dateKey
      )
    );
    if (known) continue;
    const explicit = preference?.weekly_schedule != null;
    const cadenceOverride = preference?.cadence_override;
    const needsHistory = !explicit && (cadenceOverride === "every_other_day" || cadenceOverride === "every_3_days");
    const read = needsHistory
      ? await readV2UserSmsCommsPreferences(clerkUserId)
      : {
          ok: true as const,
          row: preference
            ? {
                weekly_schedule: preference.weekly_schedule ?? null,
                weekly_schedule_invalid: false,
                schedule_timezone: scheduleZone || null,
                pause_indefinite: preference.pause_indefinite === true,
                pause_until: typeof preference.pause_until === "string" ? preference.pause_until : null,
                cadence_override: cadenceOverride === "daily" || cadenceOverride === "every_other_day" || cadenceOverride === "every_3_days" ? cadenceOverride : null,
                weekend_send_policy: preference.weekend_send_policy === "all" || preference.weekend_send_policy === "weekdays_only" ? preference.weekend_send_policy : null,
              }
            : null,
        };
    if (!read.ok) break;
    const cadence = needsHistory
      ? await cadenceDecisionForMemberDate({
          clerkUserId,
          read: read as Awaited<ReturnType<typeof readV2UserSmsCommsPreferences>>,
          memberLocalDate: dateKey,
          now: args.now,
          historyByUser: new Map(),
        })
      : "not_applicable" as const;
    if (cadence === "unresolved") break;
    const resolved = resolveProactiveSchedule({
      preferenceRead: preferenceReadFromRow(read as Awaited<ReturnType<typeof readV2UserSmsCommsPreferences>>),
      clerkTimezone: scheduleZone ? null : clerkTimezoneByUser.get(clerkUserId),
      audienceTimezone: audienceZone || null,
      memberLocalDate: dateKey,
      proactiveDeliveryAllowed: true,
      ...(cadence === "eligible"
        ? { legacyCadenceEligible: true }
        : cadence === "not_due"
          ? { legacyCadenceEligible: false }
          : {}),
    });
    if (resolved.kind !== "scheduled") continue;
    const instant = Date.parse(resolved.utcInstant);
    if (!Number.isFinite(instant) || instant <= args.now.getTime()) continue;
    let windowClosed = false;
    try {
      windowClosed = args.now.getTime() >= Date.parse(scheduledBatchWindowEndsAt(resolved.batchDate, resolved.owner));
    } catch {
      continue;
    }
    if (!windowClosed) continue;
    const blockingDelivery = await supabaseServer
      .from("sms_send_events")
      .select("status, message_sid, metadata, day_key")
      .eq("clerk_user_id", clerkUserId)
      .in("send_slot", [SMS_DAILY_PRODUCTION_SEND_SLOT, SMS_DAILY_EVENING_PREVIEW_SEND_SLOT]);
    if (blockingDelivery.error) continue;
    const blocked = (blockingDelivery.data ?? []).some((event) => {
      const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata as Record<string, unknown> : {};
      const applies = event.day_key === dateKey || metadata.member_local_date === dateKey;
      const attempted = metadata.twilio_send_attempted === true || metadata.twilio_send_attempted === "true";
      const sid = typeof event.message_sid === "string" && event.message_sid.trim().length > 0;
      return applies && (sid || event.status === "sent" || attempted);
    });
    if (blocked) continue;
    const ran = await runScheduledTtoGeneration({
      now: args.now,
      owner: resolved.owner,
      batchDate: resolved.batchDate,
      trigger: "automatic_schedule",
      onlyClerkUserIds: [clerkUserId],
      onlyMemberLocalDate: dateKey,
      recoverSingleMember: true,
      timeBudgetMs: Math.max(0, args.deadlineMs - Date.now()),
      chunkUserCap: 1,
    });
    if (ran.ok) recovered += 1;
    break;
    }
  }
  return recovered;
}

export async function runAutomaticScheduledGeneration(args: {
  now?: Date;
} = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = args.now ?? new Date();
  const started = Date.now();
  const deadlineMs = started + TTO_GENERATE_ALL_TIME_BUDGET_MS;
  const window = resolveScheduledGenerationWindow(now);
  const reconsideration = await runScheduledReconsideration({
    now,
    deadlineMs,
    chunkCap: TTO_GENERATE_ALL_CHUNK_USER_CAP,
  });
  const remainingCap = Math.max(0, TTO_GENERATE_ALL_CHUNK_USER_CAP - reconsideration.considered);
  if (!window.active) {
    const recovered = await recoverAuthoritativeOccurrences({
      now,
      deadlineMs,
      cap: remainingCap,
    });
    return {
      status: 200,
      body: { ok: true, active: false, recovered, reconsideration },
    };
  }
  const recovered = await recoverAuthoritativeOccurrences({ now, deadlineMs, cap: remainingCap });
  const ran = await runScheduledTtoGeneration({
    now,
    owner: window.owner,
    batchDate: window.batchDate,
    trigger: "automatic_schedule",
    timeBudgetMs: Math.max(0, deadlineMs - Date.now()),
    chunkUserCap: Math.max(0, remainingCap - recovered),
  });
  if (!ran.ok) {
    return {
      status: ran.status,
      body: { ok: false, error: ran.error, active: true, reconsideration },
    };
  }
  return {
    status: 200,
    body: {
      ok: true,
      active: true,
      recovered,
      owner: window.owner,
      batch_date: window.batchDate,
      reconsideration,
      opened_trigger: ran.batch.openedTrigger,
      window_ends_at: ran.batch.windowEndsAt,
      batch_progress: interpretBatchProgress({
        initialCompletedAt: ran.batch.initialCompletedAt,
        windowEndsAt: ran.batch.windowEndsAt,
        now,
      }),
      started_at: ran.batch.startedAt,
      initial_completed_at: ran.batch.initialCompletedAt,
      initial_completed_trigger: ran.batch.initialCompletedTrigger,
      relevant_member_count: ran.batch.relevantMemberCount,
      scheduled_member_count: ran.batch.scheduledMemberCount,
      scheduled_occurrence_count: ran.batch.scheduledOccurrenceCount,
      processed_this_invocation: ran.chunk.processed_this_chunk,
      remaining: ran.chunk.remaining,
      generated_complete: ran.chunk.generated_complete,
      failed: ran.chunk.failed,
      is_complete: ran.chunk.is_complete,
    },
  };
}
