import {
  TWILIO_SMS_BODY_MAX_CHARS,
  smsBodyExceedsTwilioTransportMax,
} from "@/lib/sms-transport-max";
import { supabaseServer } from "@/lib/supabase-server";
import {
  deriveNotebookDisplayMode,
  deriveNotebookFamily,
} from "@/lib/tyler-text-overview-notebook-display";
import type { TylerTextOverviewWriterOpenAiMessage } from "@/lib/tyler-text-overview-writer-capture";
import { matchesTylerTextOverviewSearchQuery } from "@/lib/tyler-text-overview-dashboard-copy";
import { parseSlotCoachingContextFromMetadata } from "@/lib/slot-coaching-context-v1";
import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";
import {
  parseSmsDailySendSlot,
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
  type AuthoritativeMachineDraftStatus,
  type SmsDailySendSlot,
  type TtoBatchStatistics,
  type TtoGenerationOutcomeCounts,
  type TylerTextOverviewAdminCounts,
  type TylerTextOverviewAdminDraftRow,
  type TylerTextOverviewDraftStatus,
  type TylerTextOverviewManifestIntegrity,
  type TylerTextOverviewRowState,
  type TylerTextOverviewMorningBriefInterpreterPanel,
  type TylerTextOverviewMorningWriterCapturePanel,
  type TylerTextOverviewOpenAiErrorPanel,
  type TylerTextOverviewSlotCoachingContextPanel,
} from "@/lib/tyler-text-overview-types";
import { requireTylerTextOverviewDraftDayKey } from "@/lib/tyler-text-overview-draft-day-key";
import {
  isPauseActive,
  readV2UserSmsCommsPreferences,
  type V2UserSmsCommsPreferencesRow,
} from "@/lib/v2-sms-comms-preferences";
import { getClerkUserOrNull } from "@/lib/clerk-rest";
import { isValidIanaTimezone } from "@/lib/timezone";
import {
  resolveProactiveSchedule,
  scheduledDeliveryTupleIsCoherent,
  type ProactiveSchedulePreferenceRead,
} from "@/lib/sms-proactive-schedule";
import {
  persistedDeliveryFactsFromMetadata,
  type TtoCurrentDeliveryFacts,
} from "@/lib/tyler-text-overview-generate";
import {
  WEEKLY_TTO_DRAFT_BODY_EXCEEDS_EDITABLE_MAX,
  weeklyEditableBodyExceedsMax,
} from "@/lib/weekly-tto-length";

export const PREVIEW_ONLY_DRAFT_NOT_EDITABLE = "preview_only_draft_not_editable" as const;

/** Page size for PostgREST range pagination (well under typical max_rows). */
export const TTO_MANIFEST_DRAFT_PAGE_SIZE = 500 as const;
export const TTO_MANIFEST_PAGE_SIZE = TTO_MANIFEST_DRAFT_PAGE_SIZE;
/** Safe chunk size for `.in("clerk_user_id"|"id", …)` lists. */
export const TTO_MANIFEST_ID_CHUNK_SIZE = 250 as const;

export const TTO_MANIFEST_INCOMPLETE_ERROR_PREFIX = "tto_manifest_incomplete:" as const;

export function ttoManifestIncompleteError(code: string): Error {
  return new Error(`${TTO_MANIFEST_INCOMPLETE_ERROR_PREFIX}${code}`);
}

export function requireTtoExactCount(
  count: number | null | undefined,
  code: string
): number {
  if (typeof count !== "number" || !Number.isFinite(count)) {
    throw ttoManifestIncompleteError(code);
  }
  return count;
}

export function chunkIdsForTtoManifestQuery<T>(ids: T[], chunkSize = TTO_MANIFEST_ID_CHUNK_SIZE): T[][] {
  const unique = [...new Set(ids)];
  const chunks: T[][] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    chunks.push(unique.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Resolve admin list send_slot. Unknown values default to morning for list filtering only.
 * Known slots (including weekly_review) are preserved — never coerce weekly_review → morning.
 */
export function resolveAdminListSendSlot(
  raw: string | null | undefined
): SmsDailySendSlot {
  const parsed = parseSmsDailySendSlot(raw);
  if (parsed) return parsed;
  return SMS_DAILY_PRODUCTION_SEND_SLOT;
}

/** Map DB send_slot onto known SmsDailySendSlot without silently remapping weekly_review. */
export function mapDbSendSlotToAdminDto(
  raw: string | null | undefined
): SmsDailySendSlot {
  const parsed = parseSmsDailySendSlot(raw);
  if (parsed) return parsed;
  return SMS_DAILY_PRODUCTION_SEND_SLOT;
}
type SendableAudienceMember = {
  clerkUserId: string;
  phoneNumber: string;
  timezone: string | null;
  preferredName: string | null;
};

const DRAFT_OVERLAY_STATUS_PRIORITY: Record<string, number> = {
  current: 0,
  sent: 1,
  skipped: 2,
};

const EMPTY_NOTEBOOK_FIELDS: Pick<
  TylerTextOverviewAdminDraftRow,
  | "writerOpenAiMessages"
  | "authoritativeRetryMessages"
  | "authoritativeMachineDraftBody"
  | "authoritativeMachineDraftStatus"
  | "authoritativeWriterModel"
  | "authoritativeRetryOccurred"
  | "authoritativeGeneratedAt"
  | "currentGenerationId"
  | "currentGenerationNumber"
  | "latestGenerationId"
  | "latestGenerationNumber"
  | "isLatestGeneration"
  | "writerPromptPath"
  | "notebookHash"
  | "notebookMessageCount"
  | "notebookFamily"
  | "notebookDisplayMode"
  | "machineShouldSend"
  | "machineNoSendReason"
  | "capturePresent"
  | "silenceCadenceRoute"
  | "silenceDay"
  | "intentionalSpace"
  | "messageRequiredToday"
  | "quietRelationshipEligible"
  | "interpreterProactiveDecision"
  | "clampedProactiveDecision"
  | "clockLookupFailed"
  | "clockLookupError"
  | "daysSinceLastSuccessfulProactiveSend"
  | "laneStage"
  | "slotCoachingContext"
  | "morningBriefInterpreterV1"
  | "morningCoachingBriefV1"
  | "morningWriterCaptureV1"
  | "messageFor"
  | "morningRelationshipPacketV1"
  | "coachingStack"
> = {
  writerOpenAiMessages: [],
  authoritativeRetryMessages: [],
  authoritativeMachineDraftBody: null,
  authoritativeMachineDraftStatus: null,
  authoritativeWriterModel: null,
  authoritativeRetryOccurred: null,
  authoritativeGeneratedAt: null,
  currentGenerationId: null,
  currentGenerationNumber: null,
  latestGenerationId: null,
  latestGenerationNumber: null,
  isLatestGeneration: null,
  writerPromptPath: null,
  notebookHash: null,
  notebookMessageCount: 0,
  /** Missing-draft rows must not pretend a writer generation existed. */
  notebookFamily: "writer_skipped",
  notebookDisplayMode: "writer_skipped_unknown",
  machineShouldSend: null,
  machineNoSendReason: null,
  capturePresent: null,
  silenceCadenceRoute: null,
  silenceDay: null,
  intentionalSpace: null,
  messageRequiredToday: null,
  quietRelationshipEligible: null,
  interpreterProactiveDecision: null,
  clampedProactiveDecision: null,
  clockLookupFailed: null,
  clockLookupError: null,
  daysSinceLastSuccessfulProactiveSend: null,
  laneStage: null,
  slotCoachingContext: null,
  morningBriefInterpreterV1: null,
  morningCoachingBriefV1: null,
  morningWriterCaptureV1: null,
  messageFor: null,
  morningRelationshipPacketV1: null,
  coachingStack: null,
};

export function isTylerBlankedMorningDraft(row: {
  rowState: TylerTextOverviewRowState;
  editedByTyler: boolean;
  currentBodySource: string | null | undefined;
  currentBodyToSend: string | null | undefined;
}): boolean {
  if (row.rowState !== "draft_current") return false;
  const blank = !(row.currentBodyToSend?.trim() ?? "");
  if (!blank) return false;
  return row.editedByTyler === true || row.currentBodySource === "tyler_edit";
}

export function resolveTylerTextOverviewRowState(
  draftStatus: string | null | undefined
): TylerTextOverviewRowState {
  if (!draftStatus) return "no_draft_yet";
  if (draftStatus === "current") return "draft_current";
  if (draftStatus === "sent") return "draft_sent";
  if (draftStatus === "skipped") return "draft_skipped";
  return "draft_other";
}

export function pickTylerTextOverviewDraftOverlay(
  drafts: DraftDbRow[],
  draftForDayKey?: string | null
): DraftDbRow | null {
  if (drafts.length === 0) return null;

  const dayKey = draftForDayKey?.trim();
  if (dayKey) {
    return drafts.find((draft) => draft.draft_for_day_key === dayKey) ?? null;
  }

  return [...drafts].sort((a, b) => {
    const priorityA = DRAFT_OVERLAY_STATUS_PRIORITY[a.status] ?? 99;
    const priorityB = DRAFT_OVERLAY_STATUS_PRIORITY[b.status] ?? 99;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return b.draft_for_day_key.localeCompare(a.draft_for_day_key);
  })[0];
}

export { matchesTylerTextOverviewSearchQuery };

export function computeTylerTextOverviewAdminCounts(
  rows: TylerTextOverviewAdminDraftRow[],
  extras?: {
    draftsMarkedSentDayTotal?: number;
    twilioAcceptedDayTotal?: number | null;
  }
): TylerTextOverviewAdminCounts {
  let noDraftYet = 0;
  let draftCurrent = 0;
  let draftCurrentReady = 0;
  let draftCurrentTylerBlanked = 0;
  let draftSent = 0;
  let draftSkipped = 0;
  let machineShouldSendTrue = 0;
  let machineShouldSendFalse = 0;
  let generationLinkageErrors = 0;

  for (const row of rows) {
    if (row.generationLinkageError === true) generationLinkageErrors += 1;

    switch (row.rowState) {
      case "no_draft_yet":
        noDraftYet += 1;
        break;
      case "draft_current":
        draftCurrent += 1;
        if (isTylerBlankedMorningDraft(row)) {
          draftCurrentTylerBlanked += 1;
        } else if (row.currentBodyToSend?.trim()) {
          draftCurrentReady += 1;
        }
        break;
      case "draft_sent":
        draftSent += 1;
        break;
      case "draft_skipped":
        draftSkipped += 1;
        break;
      default:
        break;
    }

    if (row.machineShouldSend === true) machineShouldSendTrue += 1;
    if (row.machineShouldSend === false) machineShouldSendFalse += 1;
  }

  return {
    sendableUsers: rows.length,
    noDraftYet,
    draftCurrent,
    draftCurrentReady,
    draftCurrentTylerBlanked,
    draftSent,
    draftSkipped,
    machineShouldSendTrue,
    machineShouldSendFalse,
    generationLinkageErrors,
    draftsMarkedSentDayTotal: extras?.draftsMarkedSentDayTotal ?? draftSent,
    twilioAcceptedDayTotal:
      extras?.twilioAcceptedDayTotal === undefined ? null : extras.twilioAcceptedDayTotal,
  };
}

function emptyTylerTextOverviewAdminCounts(): TylerTextOverviewAdminCounts {
  return {
    sendableUsers: 0,
    noDraftYet: 0,
    draftCurrent: 0,
    draftCurrentReady: 0,
    draftCurrentTylerBlanked: 0,
    draftSent: 0,
    draftSkipped: 0,
    machineShouldSendTrue: 0,
    machineShouldSendFalse: 0,
    generationLinkageErrors: 0,
    draftsMarkedSentDayTotal: 0,
    twilioAcceptedDayTotal: null,
  };
}

export function emptyTylerTextOverviewManifestIntegrity(
  overrides: Partial<TylerTextOverviewManifestIntegrity> = {}
): TylerTextOverviewManifestIntegrity {
  const base: TylerTextOverviewManifestIntegrity = {
    expectedAudienceCount: 0,
    audienceDraftOverlayCount: 0,
    genuineMissingAudienceDraftCount: 0,
    selectedDayDraftCount: 0,
    genuineMissingDraftCount: 0,
    allSelectedDayDraftCount: 0,
    allSelectedDaySentDraftCount: 0,
    generationLinkageErrorCount: 0,
    manifestComplete: false,
    queriedDraftExactCount: 0,
    returnedDraftCount: 0,
    draftsMarkedSentDayTotal: 0,
    twilioAcceptedEventCount: null,
    twilioAcceptedDayTotal: null,
    selectedDayKey: null,
    lastRefreshedAt: new Date().toISOString(),
    incompletenessReason: null,
    audienceComplete: false,
    commitmentLookupComplete: false,
    preferenceLookupComplete: false,
    profileLookupComplete: false,
    draftQueryComplete: false,
    generationQueryComplete: false,
    historicalSentCountComplete: false,
    twilioCountComplete: false,
    audienceOverlayInvariantComplete: false,
  };
  return { ...base, ...overrides };
}

export type SmsAudienceSendability =
  | { sendable: true }
  | {
      sendable: false;
      reason: "absent" | "identity" | "membership" | "sms_disabled" | "phone" | "stopped";
    };

/** Same consent rules as the sendable audience loader, for one already-fetched row. */
export function classifySmsAudienceSendability(
  row: Record<string, unknown> | null
): SmsAudienceSendability {
  if (!row) return { sendable: false, reason: "absent" };
  if (typeof row.clerk_user_id !== "string" || !row.clerk_user_id.trim()) {
    return { sendable: false, reason: "identity" };
  }
  if (row.summitt_subscribed !== true) return { sendable: false, reason: "membership" };
  if (row.sms_enabled !== true) return { sendable: false, reason: "sms_disabled" };
  const phone = row.phone_number;
  if (typeof phone !== "string" || !phone.trim()) return { sendable: false, reason: "phone" };
  const stoppedAt = row.stopped_at;
  if (stoppedAt != null && stoppedAt !== "") return { sendable: false, reason: "stopped" };
  return { sendable: true };
}

function isSendableSmsAudienceRow(row: Record<string, unknown>): boolean {
  return classifySmsAudienceSendability(row).sendable;
}

/**
 * One member's current SMS consent row. Does not load the rest of the audience.
 * A query error stays unresolved. A missing or non-sendable row is confirmed.
 */
export async function readMemberSmsSendability(clerkUserId: string): Promise<
  | { ok: true; sendable: true; timezone: string | null }
  | {
      ok: true;
      sendable: false;
      reason: "absent" | "identity" | "membership" | "sms_disabled" | "phone" | "stopped";
    }
  | { ok: false; error: string }
> {
  const { data, error } = await supabaseServer
    .from("sms_audience")
    .select("clerk_user_id, phone_number, timezone, sms_enabled, stopped_at, summitt_subscribed")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  const row =
    data != null && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const classified = classifySmsAudienceSendability(row);
  if (!classified.sendable) return { ok: true, sendable: false, reason: classified.reason };
  const timezone = typeof row?.timezone === "string" ? row.timezone : null;
  return { ok: true, sendable: true, timezone };
}

async function paginateExactQueryRows<T extends Record<string, unknown>>(args: {
  runPage: (from: number, to: number, withCount: boolean) => Promise<{
    data: T[] | null;
    error: { message: string } | null;
    count: number | null;
  }>;
  countUnavailableCode: string;
  truncationCode: string;
  pageSize?: number;
}): Promise<{ rows: T[]; exactCount: number }> {
  const pageSize = args.pageSize ?? TTO_MANIFEST_PAGE_SIZE;
  let from = 0;
  let exactCount: number | null = null;
  const all: T[] = [];

  for (;;) {
    const { data, error, count } = await args.runPage(from, from + pageSize - 1, from === 0);
    if (error) {
      throw new Error(error.message);
    }
    if (from === 0) {
      exactCount = requireTtoExactCount(count, args.countUnavailableCode);
    }
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  const resolvedExact = requireTtoExactCount(exactCount, args.countUnavailableCode);
  if (all.length !== resolvedExact) {
    throw ttoManifestIncompleteError(
      `${args.truncationCode}:returned=${all.length}:exact=${resolvedExact}`
    );
  }
  return { rows: all, exactCount: resolvedExact };
}

async function fetchCompleteSmsAudienceBaseRows(): Promise<Array<Record<string, unknown>>> {
  const { rows, exactCount } = await paginateExactQueryRows<Record<string, unknown>>({
    countUnavailableCode: "audience_count_unavailable",
    truncationCode: "audience_truncated",
    runPage: async (from, to, withCount) => {
      const { data, error, count } = await supabaseServer
        .from("sms_audience")
        .select(
          "clerk_user_id, phone_number, timezone, sms_enabled, stopped_at, summitt_subscribed",
          { count: withCount ? "exact" : undefined }
        )
        .eq("summitt_subscribed", true)
        .eq("sms_enabled", true)
        .order("clerk_user_id", { ascending: true })
        .range(from, to);
      return { data: (data ?? null) as Array<Record<string, unknown>> | null, error, count };
    },
  });

  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const row of rows) {
    const id = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
    if (!id) continue;
    if (seen.has(id)) duplicates.push(id);
    else seen.add(id);
  }
  if (duplicates.length > 0) {
    throw ttoManifestIncompleteError(
      `audience_duplicate_clerk_user_id:count=${duplicates.length}`
    );
  }
  if (rows.length !== exactCount) {
    throw ttoManifestIncompleteError(
      `audience_truncated:returned=${rows.length}:exact=${exactCount}`
    );
  }
  return rows;
}

async function fetchActiveCommitmentsByUserIds(
  clerkUserIds: string[]
): Promise<Map<string, { clerk_user_id: string; behavior_statement: string | null }>> {
  const result = new Map<string, { clerk_user_id: string; behavior_statement: string | null }>();
  if (clerkUserIds.length === 0) return result;

  for (const chunk of chunkIdsForTtoManifestQuery(clerkUserIds)) {
    const { rows } = await paginateExactQueryRows<{
      clerk_user_id: string;
      behavior_statement: string | null;
      status: string;
    }>({
      countUnavailableCode: "commitment_count_unavailable",
      truncationCode: "commitment_truncated",
      runPage: async (from, to, withCount) => {
        const { data, error, count } = await supabaseServer
          .from("v2_commitment")
          .select("clerk_user_id, behavior_statement, status", {
            count: withCount ? "exact" : undefined,
          })
          .eq("status", "active")
          .in("clerk_user_id", chunk)
          .order("clerk_user_id", { ascending: true })
          .range(from, to);
        return {
          data: (data ?? null) as Array<{
            clerk_user_id: string;
            behavior_statement: string | null;
            status: string;
          }> | null,
          error,
          count,
        };
      },
    });

    for (const row of rows) {
      if (typeof row.clerk_user_id !== "string") continue;
      if (result.has(row.clerk_user_id)) {
        throw ttoManifestIncompleteError(
          `duplicate_active_commitment:${row.clerk_user_id}`
        );
      }
      result.set(row.clerk_user_id, {
        clerk_user_id: row.clerk_user_id,
        behavior_statement:
          typeof row.behavior_statement === "string" ? row.behavior_statement : null,
      });
    }
  }

  return result;
}

async function fetchPrefsByUserIds(
  clerkUserIds: string[]
): Promise<Map<string, V2UserSmsCommsPreferencesRow>> {
  const result = new Map<string, V2UserSmsCommsPreferencesRow>();
  if (clerkUserIds.length === 0) return result;

  for (const chunk of chunkIdsForTtoManifestQuery(clerkUserIds)) {
    const { rows } = await paginateExactQueryRows<{
      clerk_user_id: string;
      pause_until: string | null;
    }>({
      countUnavailableCode: "preference_count_unavailable",
      truncationCode: "preference_truncated",
      runPage: async (from, to, withCount) => {
        const { data, error, count } = await supabaseServer
          .from("v2_user_sms_comms_preferences")
          .select("clerk_user_id, pause_until", {
            count: withCount ? "exact" : undefined,
          })
          .in("clerk_user_id", chunk)
          .order("clerk_user_id", { ascending: true })
          .range(from, to);
        return {
          data: (data ?? null) as Array<{
            clerk_user_id: string;
            pause_until: string | null;
          }> | null,
          error,
          count,
        };
      },
    });

    for (const row of rows) {
      if (typeof row.clerk_user_id !== "string") continue;
      if (result.has(row.clerk_user_id)) {
        throw ttoManifestIncompleteError(`duplicate_preference_row:${row.clerk_user_id}`);
      }
      result.set(row.clerk_user_id, {
        clerk_user_id: row.clerk_user_id,
        pause_until: typeof row.pause_until === "string" ? row.pause_until : null,
      } as V2UserSmsCommsPreferencesRow);
    }
  }

  return result;
}

async function fetchPreferredNamesByUserIds(
  clerkUserIds: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (clerkUserIds.length === 0) return result;

  for (const chunk of chunkIdsForTtoManifestQuery(clerkUserIds)) {
    const { rows } = await paginateExactQueryRows<{
      clerk_user_id: string;
      preferred_name: string | null;
    }>({
      countUnavailableCode: "profile_count_unavailable",
      truncationCode: "profile_truncated",
      runPage: async (from, to, withCount) => {
        const { data, error, count } = await supabaseServer
          .from("user_profiles")
          .select("clerk_user_id, preferred_name", {
            count: withCount ? "exact" : undefined,
          })
          .in("clerk_user_id", chunk)
          .order("clerk_user_id", { ascending: true })
          .range(from, to);
        return {
          data: (data ?? null) as Array<{
            clerk_user_id: string;
            preferred_name: string | null;
          }> | null,
          error,
          count,
        };
      },
    });

    for (const row of rows) {
      if (typeof row.clerk_user_id !== "string") continue;
      if (result.has(row.clerk_user_id)) {
        throw ttoManifestIncompleteError(`duplicate_profile_row:${row.clerk_user_id}`);
      }
      const name = typeof row.preferred_name === "string" ? row.preferred_name.trim() : "";
      if (name) result.set(row.clerk_user_id, name);
    }
  }

  return result;
}

export async function loadSendableTylerTextOverviewAudienceMembers(
  now: Date = new Date(),
  options?: { includeCurrentlyPaused?: boolean }
): Promise<SendableAudienceMember[]> {
  let audienceRows: Array<Record<string, unknown>>;
  try {
    audienceRows = await fetchCompleteSmsAudienceBaseRows();
  } catch (err) {
    const message = err instanceof Error ? err.message : "audience_failed";
    if (message.startsWith(TTO_MANIFEST_INCOMPLETE_ERROR_PREFIX)) throw err;
    throw ttoManifestIncompleteError(`audience_query_failed:${message}`);
  }

  const smsEligible = audienceRows.filter(isSendableSmsAudienceRow);
  if (smsEligible.length === 0) return [];

  const clerkUserIds = [
    ...new Set(smsEligible.map((row) => row.clerk_user_id as string)),
  ];

  let commitmentsByUserId: Map<string, { clerk_user_id: string; behavior_statement: string | null }>;
  let prefsByUserId: Map<string, V2UserSmsCommsPreferencesRow>;
  let preferredNameByUserId: Map<string, string>;
  try {
    [commitmentsByUserId, prefsByUserId, preferredNameByUserId] = await Promise.all([
      fetchActiveCommitmentsByUserIds(clerkUserIds),
      fetchPrefsByUserIds(clerkUserIds),
      fetchPreferredNamesByUserIds(clerkUserIds),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "lookup_failed";
    if (message.startsWith(TTO_MANIFEST_INCOMPLETE_ERROR_PREFIX)) throw err;
    throw ttoManifestIncompleteError(`audience_lookup_failed:${message}`);
  }

  const members: SendableAudienceMember[] = [];
  for (const row of smsEligible) {
    const clerkUserId = row.clerk_user_id as string;
    const commitment = commitmentsByUserId.get(clerkUserId);
    if (!commitment) continue;
    const behavior =
      typeof commitment.behavior_statement === "string"
        ? commitment.behavior_statement.trim()
        : "";
    if (!behavior) continue;
    if (
      !options?.includeCurrentlyPaused &&
      isPauseActive(prefsByUserId.get(clerkUserId) ?? null, now)
    ) {
      continue;
    }

    members.push({
      clerkUserId,
      phoneNumber: (row.phone_number as string).trim(),
      timezone: typeof row.timezone === "string" ? row.timezone : null,
      preferredName: preferredNameByUserId.get(clerkUserId) ?? null,
    });
  }

  members.sort((a, b) => {
    const nameCmp = (a.preferredName ?? "").localeCompare(b.preferredName ?? "");
    if (nameCmp !== 0) return nameCmp;
    return a.clerkUserId.localeCompare(b.clerkUserId);
  });

  return members;
}

function mapAudienceOverlayToAdminRow(args: {
  member: SendableAudienceMember;
  sendSlot: SmsDailySendSlot;
  draft: DraftDbRow | null;
  generation: GenerationDbRow | undefined;
  latestGenerationsByKey?: Map<string, LatestGenerationRef>;
  overlayDayKey?: string | null;
}): TylerTextOverviewAdminDraftRow {
  const { member, sendSlot, draft, generation, latestGenerationsByKey, overlayDayKey } = args;

  if (!draft) {
    return {
      draftId: null,
      clerkUserId: member.clerkUserId,
      preferredName: member.preferredName,
      phoneNumber: member.phoneNumber,
      timezone: member.timezone,
      rowState: "no_draft_yet",
      draftForDayKey: overlayDayKey?.trim() ?? "",
      sendSlot,
      draftStatus: "current",
      sentAt: null,
      finalBodySent: null,
      twilioMessageSid: null,
      sourceSmsSendEventId: null,
      currentBodyToSend: null,
      currentBodySource: null,
      editedByTyler: false,
      editedAt: null,
      ...EMPTY_NOTEBOOK_FIELDS,
      previewOnly: sendSlot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      morningAnchorSource: null,
      morningAnchorSent: null,
      morningAnchorBodyPreview: null,
      generationLinkageError: false,
    };
  }

  const mapped = mapDraftRowsToAdminDto({
    drafts: [draft],
    generationsById: generation ? new Map([[generation.id, generation]]) : new Map(),
    latestGenerationsByKey,
    audienceByUserId: new Map([[member.clerkUserId, member]]),
  })[0];

  const linkageError =
    Boolean(draft.current_generation_id?.trim()) && generation == null;

  return {
    ...mapped,
    preferredName: member.preferredName,
    phoneNumber: member.phoneNumber,
    timezone: member.timezone,
    rowState: resolveTylerTextOverviewRowState(draft.status),
    generationLinkageError: linkageError,
  };
}
type DraftDbRow = {
  id: string;
  clerk_user_id: string;
  draft_for_day_key: string;
  send_slot?: string;
  current_generation_id: string;
  current_body_to_send: string | null;
  current_body_source?: string | null;
  edited_by_tyler?: boolean | null;
  edited_at?: string | null;
  status: string;
  sent_at?: string | null;
  final_body_sent?: string | null;
  twilio_message_sid?: string | null;
  source_sms_send_event_id?: string | null;
};

type GenerationDbRow = {
  id: string;
  generation_number?: number;
  writer_openai_messages: unknown;
  writer_prompt_path?: string | null;
  machine_draft_body: string | null;
  machine_should_send?: boolean;
  machine_no_send_reason?: string | null;
  notebook_hash?: string | null;
  generation_metadata?: unknown;
  route_kind?: string | null;
  clerk_user_id?: string;
  draft_for_day_key?: string;
  send_slot?: string;
  generated_at?: string | null;
};

type LatestGenerationRef = {
  id: string;
  generation_number: number;
};

const WRITER_MESSAGE_ROLES = new Set(["system", "user", "assistant"]);

const GENERATION_SELECT_COLUMNS =
  "id, generation_number, writer_openai_messages, writer_prompt_path, machine_draft_body, machine_should_send, machine_no_send_reason, notebook_hash, generation_metadata, route_kind, clerk_user_id, draft_for_day_key, generated_at";

function draftLatestGenKey(clerkUserId: string, draftForDayKey: string, sendSlot: string): string {
  return `${clerkUserId}:${draftForDayKey}:${sendSlot}`;
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const raw = metadata[key];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

function readMetadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const raw = metadata[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readMetadataBoolean(metadata: Record<string, unknown>, key: string): boolean | null {
  const raw = metadata[key];
  if (raw === true) return true;
  if (raw === false) return false;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function readProactiveDecisionToken(raw: unknown): string | null {
  return raw === "send" || raw === "intentional_space" ? raw : null;
}

function interpreterProactiveDecisionFromParsedBrief(
  parsedBrief: Record<string, unknown> | null
): string | null {
  if (!parsedBrief) return null;
  const coaching = parsedBrief.coaching_direction;
  if (!coaching || typeof coaching !== "object" || Array.isArray(coaching)) return null;
  return readProactiveDecisionToken((coaching as Record<string, unknown>).proactive_decision);
}

function parseGenerationMetadata(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

export function normalizeTylerTextOverviewDraftBodyInput(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const TTO_DRAFT_BODY_EXCEEDS_TWILIO_TRANSPORT_MAX =
  `Body exceeds Twilio SMS transport max (${TWILIO_SMS_BODY_MAX_CHARS} characters)`;

function isMorningOrEveningTtoTransportGuardedSlot(slot: SmsDailySendSlot): boolean {
  return (
    slot === SMS_DAILY_PRODUCTION_SEND_SLOT ||
    slot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT
  );
}

export function parseWriterOpenAiMessages(raw: unknown): TylerTextOverviewWriterOpenAiMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: TylerTextOverviewWriterOpenAiMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (
      typeof role === "string" &&
      WRITER_MESSAGE_ROLES.has(role) &&
      typeof content === "string"
    ) {
      out.push({ role: role as TylerTextOverviewWriterOpenAiMessage["role"], content });
    }
  }
  return out;
}

/** Exact Morning technical-retry follow-ups from generation_metadata.morning_writer_capture_v1. */
export function parseMorningWriterRetryCapture(metadata: unknown): {
  model: string | null;
  retryOccurred: boolean | null;
  retryMessages: TylerTextOverviewWriterOpenAiMessage[];
} {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { model: null, retryOccurred: null, retryMessages: [] };
  }
  const root = metadata as Record<string, unknown>;
  const capture =
    root.morning_writer_capture_v1 &&
    typeof root.morning_writer_capture_v1 === "object" &&
    !Array.isArray(root.morning_writer_capture_v1)
      ? (root.morning_writer_capture_v1 as Record<string, unknown>)
      : null;

  const modelFromCapture =
    typeof capture?.model === "string" && capture.model.trim() ? capture.model.trim() : null;
  const modelFromRoot =
    typeof root.writer_model === "string" && root.writer_model.trim()
      ? root.writer_model.trim()
      : null;

  if (!capture) {
    return {
      model: modelFromRoot,
      retryOccurred: null,
      retryMessages: [],
    };
  }

  const retryOccurred =
    capture.retry_occurred === true
      ? true
      : capture.retry_occurred === false
        ? false
        : null;
  const retryMessages = parseWriterOpenAiMessages(capture.retry_messages);

  return {
    model: modelFromCapture ?? modelFromRoot,
    retryOccurred,
    retryMessages: retryOccurred === true ? retryMessages : [],
  };
}

/**
 * Machine draft status from the linked generation only.
 * Never uses current_body_to_send as a substitute.
 */
export function deriveAuthoritativeMachineDraftStatus(args: {
  draftCurrentGenerationId: string | null | undefined;
  generation: GenerationDbRow | undefined;
}): AuthoritativeMachineDraftStatus {
  const linkedId =
    typeof args.draftCurrentGenerationId === "string" && args.draftCurrentGenerationId.trim()
      ? args.draftCurrentGenerationId.trim()
      : null;
  if (!linkedId) return "generation_missing";
  if (!args.generation) return "generation_missing";

  if (typeof args.generation.machine_draft_body === "string") {
    return "available";
  }

  if (args.generation.machine_no_send_reason === "intentional_space") {
    return "intentional_space";
  }

  if (
    args.generation.machine_should_send === false ||
    (typeof args.generation.machine_no_send_reason === "string" &&
      args.generation.machine_no_send_reason.trim().length > 0)
  ) {
    return "generation_failed";
  }

  return "historical_unavailable";
}

/**
 * Compare saved body vs machine draft body (edit-distance / telemetry only).
 * Morning send authority does NOT use body inequality — Save itself is Tyler approval.
 */
export function computeTylerTextOverviewEdited(args: {
  normalizedBody: string | null;
  machineDraftBody: string | null;
}): boolean {
  if (args.normalizedBody === null && args.machineDraftBody === null) {
    return false;
  }
  if (args.normalizedBody === null || args.machineDraftBody === null) {
    return true;
  }
  return args.normalizedBody !== args.machineDraftBody;
}

/**
 * Any intentional TTO Save marks Tyler approval metadata.
 * Non-empty + Tyler approval → Morning cron may send despite machine_should_send=false.
 * Blank + Tyler approval → still no send (blank-body gate).
 */
export function isTylerTextOverviewSaveApproval(): boolean {
  return true;
}

/** Levenshtein edit distance for Tyler draft edit telemetry. */
export function levenshteinCharDistance(a: string, b: string): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  const prev = new Array<number>(bLen + 1);
  const curr = new Array<number>(bLen + 1);

  for (let j = 0; j <= bLen; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= aLen; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= bLen; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= bLen; j += 1) {
      prev[j] = curr[j];
    }
  }

  return prev[bLen];
}

function mapPreviewFieldsFromMetadata(
  metadata: Record<string, unknown>,
  draftStatus: string
): Pick<
  TylerTextOverviewAdminDraftRow,
  "previewOnly" | "morningAnchorSource" | "morningAnchorSent" | "morningAnchorBodyPreview"
> {
  const previewOnly =
    draftStatus !== "sent" && readMetadataBoolean(metadata, "preview_only") === true;
  if (!previewOnly) {
    return {
      previewOnly: false,
      morningAnchorSource: null,
      morningAnchorSent: null,
      morningAnchorBodyPreview: null,
    };
  }
  return {
    previewOnly: true,
    morningAnchorSource: readMetadataString(metadata, "morning_anchor_source"),
    morningAnchorSent: readMetadataBoolean(metadata, "morning_anchor_sent"),
    morningAnchorBodyPreview: readMetadataString(metadata, "morning_anchor_body_preview"),
  };
}

function mapWeeklyPeriodFieldsFromMetadata(
  metadata: Record<string, unknown>
): Pick<TylerTextOverviewAdminDraftRow, "weekKey" | "weekStart" | "weekEnd"> {
  return {
    weekKey: readMetadataString(metadata, "week_key"),
    weekStart: readMetadataString(metadata, "week_start"),
    weekEnd: readMetadataString(metadata, "week_end"),
  };
}

function mapSlotCoachingContextPanel(
  metadata: Record<string, unknown>
): TylerTextOverviewSlotCoachingContextPanel | null {
  const ctx = parseSlotCoachingContextFromMetadata(metadata.slot_coaching_context);
  if (!ctx) return null;
  return {
    currentSlot: ctx.current_slot,
    previousSlot: ctx.previous_slot,
    activeCoachingThread: ctx.active_coaching_thread,
    slotRoleRecommendation: ctx.slot_role_recommendation,
    checkinFocus: ctx.checkin_focus,
    userRepliesSincePreviousOutbound: ctx.user_replies_since_previous_outbound,
    shouldSendRecommendation: ctx.should_send_recommendation,
    skipReasonHint: ctx.skip_reason_hint,
  };
}

function mapOpenAiErrorPanel(raw: unknown): TylerTextOverviewOpenAiErrorPanel | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  const panel: TylerTextOverviewOpenAiErrorPanel = {
    name: typeof e.name === "string" && e.name.trim() ? e.name.trim() : null,
    message: typeof e.message === "string" && e.message.trim() ? e.message.trim() : null,
    status: typeof e.status === "number" && Number.isFinite(e.status) ? e.status : null,
    code:
      typeof e.code === "string" && e.code.trim()
        ? e.code.trim()
        : typeof e.code === "number" && Number.isFinite(e.code)
          ? String(e.code)
          : null,
    type: typeof e.type === "string" && e.type.trim() ? e.type.trim() : null,
    requestId:
      typeof e.request_id === "string" && e.request_id.trim()
        ? e.request_id.trim()
        : typeof e.requestId === "string" && e.requestId.trim()
          ? e.requestId.trim()
          : null,
  };
  if (
    panel.name == null &&
    panel.message == null &&
    panel.status == null &&
    panel.code == null &&
    panel.type == null &&
    panel.requestId == null
  ) {
    return null;
  }
  return panel;
}

/** Pass through stored generation-time interpreter capture only — never reconstruct. */
export function mapMorningBriefInterpreterPanel(
  metadata: Record<string, unknown>
): TylerTextOverviewMorningBriefInterpreterPanel | null {
  const raw =
    (metadata.weekly_brief_interpreter_v1 &&
    typeof metadata.weekly_brief_interpreter_v1 === "object" &&
    !Array.isArray(metadata.weekly_brief_interpreter_v1)
      ? metadata.weekly_brief_interpreter_v1
      : null) ??
    (metadata.morning_brief_interpreter_v1 &&
    typeof metadata.morning_brief_interpreter_v1 === "object" &&
    !Array.isArray(metadata.morning_brief_interpreter_v1)
      ? metadata.morning_brief_interpreter_v1
      : null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const exactInput =
    c.exact_input_object &&
    typeof c.exact_input_object === "object" &&
    !Array.isArray(c.exact_input_object)
      ? (c.exact_input_object as Record<string, unknown>)
      : null;
  const parsedBrief =
    c.parsed_brief && typeof c.parsed_brief === "object" && !Array.isArray(c.parsed_brief)
      ? (c.parsed_brief as Record<string, unknown>)
      : null;
  return {
    model: typeof c.model === "string" ? c.model : null,
    temperature: typeof c.temperature === "number" ? c.temperature : null,
    reasoningEffort: typeof c.reasoning_effort === "string" ? c.reasoning_effort : null,
    maxCompletionTokens:
      typeof c.max_completion_tokens === "number" ? c.max_completion_tokens : null,
    latencyMs: typeof c.latency_ms === "number" ? c.latency_ms : null,
    error: typeof c.error === "string" ? c.error : c.error === null ? null : null,
    openaiError: mapOpenAiErrorPanel(c.openai_error),
    exactSystemMessage: typeof c.exact_system_message === "string" ? c.exact_system_message : null,
    exactUserMessage: typeof c.exact_user_message === "string" ? c.exact_user_message : null,
    exactInputObject: exactInput,
    rawResponse: typeof c.raw_response === "string" ? c.raw_response : null,
    rawRetryResponse: typeof c.raw_retry_response === "string" ? c.raw_retry_response : null,
    retryOccurred: typeof c.retry_occurred === "boolean" ? c.retry_occurred : null,
    retrySucceeded: typeof c.retry_succeeded === "boolean" ? c.retry_succeeded : null,
    fallbackBriefUsed:
      typeof c.fallback_brief_used === "boolean" ? c.fallback_brief_used : null,
    parsedBrief,
  };
}

export function mapMorningCoachingBriefFromMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> | null {
  const raw = metadata.morning_coaching_brief_v1;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/** Persisted generation-time message_for only — never reconstruct from admin day selector. */
export function mapMessageForFromMetadata(
  metadata: Record<string, unknown>
): TylerTextOverviewAdminDraftRow["messageFor"] {
  const raw = metadata.message_for;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const timezone = typeof m.timezone === "string" ? m.timezone.trim() : "";
  const local_date = typeof m.local_date === "string" ? m.local_date.trim() : "";
  const local_weekday = typeof m.local_weekday === "string" ? m.local_weekday.trim() : "";
  const daypart =
    m.daypart === "evening" || m.daypart === "morning" || m.daypart === "weekly"
      ? m.daypart
      : null;
  if (!timezone || !local_date || !local_weekday || !daypart) return null;
  const intended =
    typeof m.intended_receive_time_local === "string" ? m.intended_receive_time_local.trim() : "";
  const utc = typeof m.utc_instant === "string" ? m.utc_instant.trim() : "";
  const batch = typeof m.administrative_batch_date === "string" ? m.administrative_batch_date.trim() : "";
  return {
    timezone,
    local_date,
    local_weekday,
    daypart,
    ...(intended ? { intended_receive_time_local: intended } : {}),
    ...(utc ? { utc_instant: utc } : {}),
    ...(batch ? { administrative_batch_date: batch } : {}),
  };
}

function considerationVersionsDisagree(
  record: Record<string, unknown>,
  metadata: Record<string, unknown>
): boolean {
  const applied = record.applies_to_body_version;
  const current = metadata.current_body_version;
  if (!applied || typeof applied !== "object" || Array.isArray(applied)) return false;
  if (!current || typeof current !== "object" || Array.isArray(current)) return false;
  const left = applied as Record<string, unknown>;
  const right = current as Record<string, unknown>;
  return left.generation_id !== right.generation_id
    || (left.body_hash ?? null) !== (right.body_hash ?? null)
    || (left.edited_at ?? null) !== (right.edited_at ?? null)
    || (left.body_source ?? null) !== (right.body_source ?? null)
    || left.edited_by_tyler !== right.edited_by_tyler;
}

/** Recorded reconsideration only. Does not reconstruct a missing model clock. */
export function formatReconsiderationRecord(metadata: Record<string, unknown>): string | null {
  const success = metadata.reconsideration_evidence;
  const failure = metadata.reconsideration_failure_evidence;
  const record =
    success && typeof success === "object" && !Array.isArray(success)
      ? (success as Record<string, unknown>)
      : null;
  if (record && record.succeeded === true) {
    if (record.current_body_approval === false || considerationVersionsDisagree(record, metadata)) {
      return "An earlier consideration does not approve the current body. Not send authorization.";
    }
    const decision =
      record.model_existing_text_decision === "keep" ||
      record.model_existing_text_decision === "replace"
        ? record.model_existing_text_decision
        : "unrecorded";
    const retention =
      record.body_retention === "model_keep"
        ? "affirmative model KEEP"
        : record.body_retention === "tyler_edit_policy"
          ? record.delivery_mismatch_unresolved === true
            ? "Tyler edit retained by policy with an unresolved delivery context"
            : "Tyler edit retained by policy"
          : "body retained";
    const minute = record.delivery && typeof record.delivery === "object"
      ? (record.delivery as { effective_local_minute?: unknown }).effective_local_minute
      : null;
    const clock = typeof minute === "number" ? ` Delivery minute ${minute}.` : "";
    return `Latest reconsideration: model ${decision}; ${retention}.${clock} Not send authorization.`;
  }
  if (failure && typeof failure === "object" && !Array.isArray(failure)) {
    const failed = failure as Record<string, unknown>;
    if (considerationVersionsDisagree(failed, metadata)) {
      return "An earlier failure does not apply to the current body.";
    }
    return "Latest reconsideration failed. The saved body was not replaced.";
  }
  return null;
}

/** Persisted generation-time packet only — never rebuild from current DB. */
export function mapMorningRelationshipPacketFromMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> | null {
  const weekly = metadata.weekly_relationship_packet_v1;
  if (weekly && typeof weekly === "object" && !Array.isArray(weekly)) {
    return weekly as Record<string, unknown>;
  }
  const raw = metadata.morning_relationship_packet_v1;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

export function mapCoachingStackFromMetadata(
  metadata: Record<string, unknown>
): string | null {
  return readMetadataString(metadata, "coaching_stack");
}

/** Pass through stored generation-time Sol writer capture only — never reconstruct. */
export function mapMorningWriterCapturePanel(
  metadata: Record<string, unknown>
): TylerTextOverviewMorningWriterCapturePanel | null {
  const raw = metadata.morning_writer_capture_v1;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const hasSolFields =
    typeof c.reasoning_effort === "string" ||
    typeof c.max_completion_tokens === "number" ||
    typeof c.raw_response === "string" ||
    c.temperature === null;
  if (!hasSolFields && typeof c.model !== "string") return null;
  return {
    model: typeof c.model === "string" ? c.model : null,
    temperature: typeof c.temperature === "number" ? c.temperature : null,
    reasoningEffort: typeof c.reasoning_effort === "string" ? c.reasoning_effort : null,
    maxCompletionTokens:
      typeof c.max_completion_tokens === "number" ? c.max_completion_tokens : null,
    latencyMs: typeof c.latency_ms === "number" ? c.latency_ms : null,
    error: typeof c.error === "string" ? c.error : null,
    openaiError: mapOpenAiErrorPanel(c.openai_error),
    rawResponse: typeof c.raw_response === "string" ? c.raw_response : null,
    rawRetryResponse: typeof c.raw_retry_response === "string" ? c.raw_retry_response : null,
    retryOccurred:
      c.retry_occurred === true ? true : c.retry_occurred === false ? false : null,
    retrySucceeded:
      c.retry_succeeded === true ? true : c.retry_succeeded === false ? false : null,
  };
}

function mapGenerationToNotebookFields(
  generation: GenerationDbRow | undefined,
  draftCurrentGenerationId?: string | null
): Pick<
  TylerTextOverviewAdminDraftRow,
  | "writerOpenAiMessages"
  | "authoritativeRetryMessages"
  | "authoritativeMachineDraftBody"
  | "authoritativeMachineDraftStatus"
  | "authoritativeWriterModel"
  | "authoritativeRetryOccurred"
  | "authoritativeGeneratedAt"
  | "currentGenerationId"
  | "currentGenerationNumber"
  | "writerPromptPath"
  | "notebookHash"
  | "notebookMessageCount"
  | "notebookFamily"
  | "notebookDisplayMode"
  | "machineShouldSend"
  | "machineNoSendReason"
  | "capturePresent"
  | "silenceCadenceRoute"
  | "silenceDay"
  | "intentionalSpace"
  | "messageRequiredToday"
  | "quietRelationshipEligible"
  | "interpreterProactiveDecision"
  | "clampedProactiveDecision"
  | "clockLookupFailed"
  | "clockLookupError"
  | "daysSinceLastSuccessfulProactiveSend"
  | "laneStage"
  | "slotCoachingContext"
  | "morningBriefInterpreterV1"
  | "morningCoachingBriefV1"
  | "morningWriterCaptureV1"
  | "messageFor"
  | "morningRelationshipPacketV1"
  | "coachingStack"
> {
  const writerOpenAiMessages = parseWriterOpenAiMessages(generation?.writer_openai_messages);
  const notebookMessageCount = writerOpenAiMessages.length;
  const metadata = parseGenerationMetadata(generation?.generation_metadata);
  const retryCapture = parseMorningWriterRetryCapture(generation?.generation_metadata);
  const machineShouldSend =
    typeof generation?.machine_should_send === "boolean" ? generation.machine_should_send : null;
  const machineNoSendReason =
    typeof generation?.machine_no_send_reason === "string"
      ? generation.machine_no_send_reason
      : null;
  const capturePresent = readMetadataBoolean(metadata, "capture_present");
  const intentionalSpace = readMetadataBoolean(metadata, "intentional_space");
  const messageRequiredToday = readMetadataBoolean(metadata, "message_required_today");
  const skipSource = readMetadataString(metadata, "skip_source");
  const interpreterPanel = mapMorningBriefInterpreterPanel(metadata);
  const linkedGenerationId =
    typeof draftCurrentGenerationId === "string" && draftCurrentGenerationId.trim()
      ? draftCurrentGenerationId.trim()
      : generation?.id ?? null;
  const machineDraftStatus = deriveAuthoritativeMachineDraftStatus({
    draftCurrentGenerationId: linkedGenerationId,
    generation,
  });
  const machineDraftBody =
    typeof generation?.machine_draft_body === "string" ? generation.machine_draft_body : null;

  return {
    writerOpenAiMessages,
    authoritativeRetryMessages: retryCapture.retryMessages,
    authoritativeMachineDraftBody: machineDraftBody,
    authoritativeMachineDraftStatus: machineDraftStatus,
    authoritativeWriterModel: retryCapture.model,
    authoritativeRetryOccurred: retryCapture.retryOccurred,
    authoritativeGeneratedAt:
      typeof generation?.generated_at === "string" && generation.generated_at.trim()
        ? generation.generated_at.trim()
        : null,
    currentGenerationId: linkedGenerationId,
    currentGenerationNumber:
      typeof generation?.generation_number === "number" ? generation.generation_number : null,
    writerPromptPath:
      typeof generation?.writer_prompt_path === "string" ? generation.writer_prompt_path : null,
    notebookHash: typeof generation?.notebook_hash === "string" ? generation.notebook_hash : null,
    notebookMessageCount,
    notebookFamily: deriveNotebookFamily({
      messageCount: notebookMessageCount,
      writerPromptPath:
        typeof generation?.writer_prompt_path === "string" ? generation.writer_prompt_path : null,
      messages: writerOpenAiMessages,
    }),
    notebookDisplayMode: deriveNotebookDisplayMode({
      messageCount: notebookMessageCount,
      machineShouldSend,
      machineNoSendReason,
      capturePresent,
      intentionalSpace,
      skipSource,
    }),
    machineShouldSend,
    machineNoSendReason,
    capturePresent,
    silenceCadenceRoute: readMetadataString(metadata, "silence_cadence_route"),
    silenceDay: readMetadataNumber(metadata, "silence_day"),
    intentionalSpace,
    messageRequiredToday,
    quietRelationshipEligible: readMetadataBoolean(metadata, "quiet_relationship_eligible"),
    interpreterProactiveDecision: interpreterProactiveDecisionFromParsedBrief(
      interpreterPanel?.parsedBrief ?? null
    ),
    clampedProactiveDecision: readProactiveDecisionToken(metadata.proactive_decision),
    clockLookupFailed: readMetadataBoolean(metadata, "clock_lookup_failed"),
    clockLookupError: readMetadataString(metadata, "clock_lookup_error"),
    daysSinceLastSuccessfulProactiveSend: readMetadataNumber(
      metadata,
      "days_since_last_successful_proactive_send"
    ),
    laneStage: readMetadataString(metadata, "lane_stage"),
    slotCoachingContext: mapSlotCoachingContextPanel(metadata),
    morningBriefInterpreterV1: interpreterPanel,
    morningCoachingBriefV1: mapMorningCoachingBriefFromMetadata(metadata),
    morningWriterCaptureV1: mapMorningWriterCapturePanel(metadata),
    messageFor: mapMessageForFromMetadata(metadata),
    morningRelationshipPacketV1: mapMorningRelationshipPacketFromMetadata(metadata),
    coachingStack: mapCoachingStackFromMetadata(metadata),
  };
}

export function mapDraftRowsToAdminDto(args: {
  drafts: DraftDbRow[];
  generationsById: Map<string, GenerationDbRow>;
  latestGenerationsByKey?: Map<string, LatestGenerationRef>;
  audienceByUserId?: Map<string, SendableAudienceMember>;
}): TylerTextOverviewAdminDraftRow[] {
  return args.drafts.map((draft) => {
    const generation = args.generationsById.get(draft.current_generation_id);
    const notebookFields = mapGenerationToNotebookFields(
      generation,
      draft.current_generation_id
    );
    const sendSlot = mapDbSendSlotToAdminDto(draft.send_slot);
    const latestKey = draftLatestGenKey(draft.clerk_user_id, draft.draft_for_day_key, sendSlot);
    const latest = args.latestGenerationsByKey?.get(latestKey) ?? null;

    const metadata = parseGenerationMetadata(generation?.generation_metadata);
    const previewFields = mapPreviewFieldsFromMetadata(metadata, draft.status);
    const weeklyPeriodFields = mapWeeklyPeriodFieldsFromMetadata(metadata);
    const audience = args.audienceByUserId?.get(draft.clerk_user_id);

    return {
      draftId: draft.id,
      clerkUserId: draft.clerk_user_id,
      preferredName: audience?.preferredName ?? null,
      phoneNumber: audience?.phoneNumber ?? null,
      timezone: audience?.timezone ?? null,
      rowState: resolveTylerTextOverviewRowState(draft.status),
      draftForDayKey: draft.draft_for_day_key,
      sendSlot,
      draftStatus: (
        ["current", "sent", "skipped", "superseded"] as const
      ).includes(draft.status as TylerTextOverviewDraftStatus)
        ? (draft.status as TylerTextOverviewDraftStatus)
        : "current",
      sentAt: typeof draft.sent_at === "string" ? draft.sent_at : null,
      finalBodySent:
        typeof draft.final_body_sent === "string" ? draft.final_body_sent : null,
      twilioMessageSid:
        typeof draft.twilio_message_sid === "string" ? draft.twilio_message_sid : null,
      sourceSmsSendEventId:
        typeof draft.source_sms_send_event_id === "string"
          ? draft.source_sms_send_event_id
          : null,
      reconsiderationRecord: formatReconsiderationRecord(metadata),
      currentBodyToSend: draft.current_body_to_send,
      currentBodySource:
        draft.current_body_source === "machine" ||
        draft.current_body_source === "tyler_edit" ||
        draft.current_body_source === "live_fallback"
          ? draft.current_body_source
          : null,
      editedByTyler: draft.edited_by_tyler === true,
      editedAt: typeof draft.edited_at === "string" ? draft.edited_at : null,
      ...notebookFields,
      ...previewFields,
      ...weeklyPeriodFields,
      latestGenerationId: latest?.id ?? notebookFields.currentGenerationId,
      latestGenerationNumber: latest?.generation_number ?? notebookFields.currentGenerationNumber,
      isLatestGeneration:
        latest != null && notebookFields.currentGenerationId != null
          ? latest.id === notebookFields.currentGenerationId
          : null,
    };
  });
}

function buildLatestGenerationsByKey(
  rows: GenerationDbRow[],
  drafts: DraftDbRow[]
): Map<string, LatestGenerationRef> {
  const allowedKeys = new Set(
    drafts.map((d) =>
      draftLatestGenKey(
        d.clerk_user_id,
        d.draft_for_day_key,
        mapDbSendSlotToAdminDto(d.send_slot)
      )
    )
  );
  const bestByKey = new Map<string, LatestGenerationRef>();

  for (const row of rows) {
    if (
      typeof row.id !== "string" ||
      typeof row.clerk_user_id !== "string" ||
      typeof row.draft_for_day_key !== "string" ||
      typeof row.generation_number !== "number"
    ) {
      continue;
    }
    const sendSlot = mapDbSendSlotToAdminDto(row.send_slot);
    const key = draftLatestGenKey(row.clerk_user_id, row.draft_for_day_key, sendSlot);
    if (!allowedKeys.has(key)) continue;

    const existing = bestByKey.get(key);
    if (!existing || row.generation_number > existing.generation_number) {
      bestByKey.set(key, { id: row.id, generation_number: row.generation_number });
    }
  }

  return bestByKey;
}

async function fetchLatestGenerationsForDrafts(
  drafts: DraftDbRow[],
  sendSlot: SmsDailySendSlot
): Promise<Map<string, LatestGenerationRef>> {
  if (drafts.length === 0) return new Map();

  const clerkUserIds = [...new Set(drafts.map((d) => d.clerk_user_id))];
  const draftForDayKeys = [...new Set(drafts.map((d) => d.draft_for_day_key))];

  const { data: generationRows, error } = await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .select("id, clerk_user_id, draft_for_day_key, generation_number, send_slot")
    .in("clerk_user_id", clerkUserIds)
    .in("draft_for_day_key", draftForDayKeys)
    .eq("send_slot", sendSlot);

  if (error) {
    throw new Error(`tyler_text_overview_latest_generations_failed:${error.message}`);
  }

  return buildLatestGenerationsByKey((generationRows ?? []) as GenerationDbRow[], drafts);
}

export async function listCurrentTylerTextOverviewDrafts(args?: {
  draftForDayKey?: string | null;
  sendSlot?: SmsDailySendSlot;
}): Promise<TylerTextOverviewAdminDraftRow[]> {
  const sendSlot = args?.sendSlot ?? SMS_DAILY_PRODUCTION_SEND_SLOT;

  const draftSelectColumns =
    "id, clerk_user_id, draft_for_day_key, send_slot, current_generation_id, current_body_to_send, current_body_source, edited_by_tyler, edited_at, status, sent_at, final_body_sent, twilio_message_sid, source_sms_send_event_id";

  let query = supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(draftSelectColumns)
    .eq("send_slot", sendSlot)
    .order("draft_for_day_key", { ascending: false })
    .order("clerk_user_id", { ascending: true });

  if (sendSlot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT) {
    query = query.in("status", ["current", "sent"]);
  } else {
    query = query.eq("status", "current");
  }

  const dayKey = args?.draftForDayKey?.trim();
  if (dayKey) {
    query = query.eq("draft_for_day_key", dayKey);
  }

  const { data: draftRows, error: draftError } = await query;
  if (draftError) {
    throw new Error(`tyler_text_overview_drafts_list_failed:${draftError.message}`);
  }

  const drafts = (draftRows ?? []) as DraftDbRow[];
  if (drafts.length === 0) {
    return [];
  }

  const generationIds = [...new Set(drafts.map((d) => d.current_generation_id))];
  const [generationResult, latestGenerationsByKey] = await Promise.all([
    supabaseServer
      .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
      .select(GENERATION_SELECT_COLUMNS)
      .in("id", generationIds),
    fetchLatestGenerationsForDrafts(drafts, sendSlot),
  ]);

  if (generationResult.error) {
    throw new Error(`tyler_text_overview_generations_list_failed:${generationResult.error.message}`);
  }

  const generationsById = new Map<string, GenerationDbRow>();
  for (const row of generationResult.data ?? []) {
    if (typeof row.id === "string") {
      generationsById.set(row.id, row as GenerationDbRow);
    }
  }

  return mapDraftRowsToAdminDto({ drafts, generationsById, latestGenerationsByKey });
}

async function fetchAvailableDraftDayKeys(sendSlot: SmsDailySendSlot): Promise<string[]> {
  const pageSize = TTO_MANIFEST_PAGE_SIZE;
  let from = 0;
  const keys = new Set<string>();

  for (;;) {
    const { data, error, count } = await supabaseServer
      .from(SMS_DAILY_DRAFTS_TABLE)
      .select("draft_for_day_key", { count: from === 0 ? "exact" : undefined })
      .eq("send_slot", sendSlot)
      .in("status", ["current", "sent", "skipped"])
      .order("draft_for_day_key", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw ttoManifestIncompleteError(`day_keys_failed:${error.message}`);
    }
    if (from === 0) {
      requireTtoExactCount(count, "day_keys_count_unavailable");
    }

    const rows = data ?? [];
    for (const row of rows) {
      if (typeof row.draft_for_day_key === "string" && row.draft_for_day_key.trim()) {
        keys.add(row.draft_for_day_key.trim());
      }
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return [...keys].sort((a, b) => b.localeCompare(a));
}

function draftUserDaySlotKey(draft: DraftDbRow): string {
  const slot = mapDbSendSlotToAdminDto(draft.send_slot);
  return `${draft.clerk_user_id}:${draft.draft_for_day_key}:${slot}`;
}

/**
 * Load every matching draft for the selected day (chunked by user id).
 * Always orders deterministically and requires exact counts (null fails).
 */
export async function fetchCompleteTtoManifestDrafts(args: {
  sendSlot: SmsDailySendSlot;
  clerkUserIds: string[];
  draftForDayKey: string | null;
  draftForDayKeys?: string[] | null;
}): Promise<{
  drafts: DraftDbRow[];
  exactCount: number;
  returnedCount: number;
}> {
  const uniqueUserIds = [...new Set(args.clerkUserIds.filter((id) => id.trim()))];
  if (uniqueUserIds.length === 0) {
    return { drafts: [], exactCount: 0, returnedCount: 0 };
  }

  const pageSize = TTO_MANIFEST_PAGE_SIZE;
  const draftSelectColumns =
    "id, clerk_user_id, draft_for_day_key, send_slot, current_generation_id, current_body_to_send, current_body_source, edited_by_tyler, edited_at, status, sent_at, final_body_sent, twilio_message_sid, source_sms_send_event_id";

  const all: DraftDbRow[] = [];
  const seenDraftIds = new Set<string>();
  const seenUserDaySlot = new Set<string>();
  let exactCountTotal = 0;

  for (const chunk of chunkIdsForTtoManifestQuery(uniqueUserIds)) {
    let from = 0;
    let chunkExact: number | null = null;
    const chunkRows: DraftDbRow[] = [];

    for (;;) {
      let query = supabaseServer
        .from(SMS_DAILY_DRAFTS_TABLE)
        .select(draftSelectColumns, { count: from === 0 ? "exact" : undefined })
        .eq("send_slot", args.sendSlot)
        .in("clerk_user_id", chunk)
        .in("status", ["current", "sent", "skipped"])
        .order("clerk_user_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);

      const dayKeys = (args.draftForDayKeys ?? []).map((key) => key.trim()).filter(Boolean);
      if (dayKeys.length > 0) {
        query = query.in("draft_for_day_key", [...new Set(dayKeys)]);
      } else if (args.draftForDayKey) {
        query = query.eq("draft_for_day_key", args.draftForDayKey);
      }

      const { data, error, count } = await query;
      if (error) {
        throw new Error(`tyler_text_overview_drafts_list_failed:${error.message}`);
      }
      if (from === 0) {
        chunkExact = requireTtoExactCount(count, "draft_count_unavailable");
      }

      const rows = (data ?? []) as DraftDbRow[];
      chunkRows.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }

    const resolvedChunkExact = requireTtoExactCount(chunkExact, "draft_count_unavailable");
    if (chunkRows.length !== resolvedChunkExact) {
      throw ttoManifestIncompleteError(
        `drafts:returned=${chunkRows.length}:exact=${resolvedChunkExact}`
      );
    }
    exactCountTotal += resolvedChunkExact;

    for (const draft of chunkRows) {
      if (seenDraftIds.has(draft.id)) {
        throw ttoManifestIncompleteError(`duplicate_draft_id:${draft.id}`);
      }
      seenDraftIds.add(draft.id);
      const uds = draftUserDaySlotKey(draft);
      if (seenUserDaySlot.has(uds)) {
        throw ttoManifestIncompleteError(`duplicate_user_day_slot:${uds}`);
      }
      seenUserDaySlot.add(uds);
      all.push(draft);
    }
  }

  const returnedCount = all.length;
  if (returnedCount !== exactCountTotal) {
    throw ttoManifestIncompleteError(
      `drafts:returned=${returnedCount}:exact=${exactCountTotal}`
    );
  }

  return { drafts: all, exactCount: exactCountTotal, returnedCount };
}

async function countSelectedDayDraftsMarkedSent(args: {
  sendSlot: SmsDailySendSlot;
  draftForDayKey: string;
}): Promise<number> {
  const { count, error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("send_slot", args.sendSlot)
    .eq("draft_for_day_key", args.draftForDayKey)
    .eq("status", "sent");

  if (error) {
    throw ttoManifestIncompleteError(`sent_count_failed:${error.message}`);
  }
  return requireTtoExactCount(count, "sent_count_unavailable");
}

async function countSelectedDayTwilioAcceptedEvents(args: {
  sendSlot: SmsDailySendSlot;
  draftForDayKey: string;
}): Promise<number> {
  const { count, error } = await supabaseServer
    .from("sms_send_events")
    .select("id", { count: "exact", head: true })
    .eq("send_slot", args.sendSlot)
    .eq("day_key", args.draftForDayKey)
    .not("message_sid", "is", null)
    .neq("message_sid", "");

  if (error) {
    throw ttoManifestIncompleteError(`twilio_count_failed:${error.message}`);
  }
  return requireTtoExactCount(count, "twilio_count_unavailable");
}

async function fetchGenerationsByIdsComplete(
  generationIds: string[]
): Promise<{ generationsById: Map<string, GenerationDbRow>; missingIds: string[] }> {
  const uniqueIds = [
    ...new Set(generationIds.filter((id) => typeof id === "string" && id.trim())),
  ];
  const generationsById = new Map<string, GenerationDbRow>();
  if (uniqueIds.length === 0) {
    return { generationsById, missingIds: [] };
  }

  const pageSize = TTO_MANIFEST_ID_CHUNK_SIZE;
  for (let i = 0; i < uniqueIds.length; i += pageSize) {
    const chunk = uniqueIds.slice(i, i + pageSize);
    const requested = new Set(chunk);
    const { data, error, count } = await supabaseServer
      .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
      .select(GENERATION_SELECT_COLUMNS, { count: "exact" })
      .in("id", chunk)
      .order("id", { ascending: true });

    if (error) {
      throw ttoManifestIncompleteError(`generations_query_failed:${error.message}`);
    }

    const exact = requireTtoExactCount(count, "generation_count_unavailable");
    const rows = data ?? [];
    if (rows.length !== exact) {
      throw ttoManifestIncompleteError(
        `generations:returned=${rows.length}:exact=${exact}`
      );
    }

    const seenReturned = new Set<string>();
    for (const row of rows) {
      if (typeof row.id !== "string") {
        throw ttoManifestIncompleteError("generation_row_missing_id");
      }
      if (seenReturned.has(row.id)) {
        throw ttoManifestIncompleteError(`duplicate_generation_id:${row.id}`);
      }
      seenReturned.add(row.id);
      if (!requested.has(row.id)) {
        throw ttoManifestIncompleteError(`unexpected_generation_id:${row.id}`);
      }
      generationsById.set(row.id, row as GenerationDbRow);
    }
  }

  const missingIds = uniqueIds.filter((id) => !generationsById.has(id));
  return { generationsById, missingIds };
}

/** Matches Stage 3 scheduled_generation_convention. Kept local to avoid a loader cycle. */
const DASHBOARD_SCHEDULED_GENERATION_CONVENTION = "member_local_delivery_v1";
const SMS_TTO_GENERATION_BATCHES_TABLE = "sms_tto_generation_batches";
const CLAIM_PLACEHOLDER_REASON = "scheduled_generation_claim";

type DashboardOccurrence = {
  clerkUserId: string;
  memberLocalDate: string;
  utcInstant: string;
  selectedLocalMinute: number;
  effectiveLocalMinute: number;
  timeZone: string;
  state: string;
  initialSet: boolean;
  initialOutcome: string | null;
};

type DashboardBatch = {
  batchDate: string;
  sendSlot: string;
  openedTrigger: "automatic_schedule" | "manual_schedule";
  windowEndsAt: string;
  startedAt: string;
  initialCompletedAt: string | null;
  initialCompletedTrigger: "automatic_schedule" | "manual_schedule" | null;
  relevantMemberCount: number;
  scheduledMemberCount: number;
  scheduledOccurrenceCount: number;
  occurrences: DashboardOccurrence[];
  nonScheduled: Array<{ clerkUserId: string; classification: "unscheduled" | "unresolved"; reason: string }>;
};

function emptyOutcomeCounts(): TtoGenerationOutcomeCounts {
  return {
    generated: 0,
    intentionalSpace: 0,
    protected: 0,
    failed: 0,
    pending: 0,
    claimed: 0,
    sent: 0,
    legacyConflict: 0,
    expired: 0,
    ineligible: 0,
  };
}

function addOutcome(counts: TtoGenerationOutcomeCounts, state: string | null | undefined) {
  switch (state) {
    case "generated":
      counts.generated += 1;
      break;
    case "intentional_space":
      counts.intentionalSpace += 1;
      break;
    case "protected":
      counts.protected += 1;
      break;
    case "failed":
      counts.failed += 1;
      break;
    case "pending":
      counts.pending += 1;
      break;
    case "claimed":
      counts.claimed += 1;
      break;
    case "sent":
      counts.sent += 1;
      break;
    case "legacy_conflict":
      counts.legacyConflict += 1;
      break;
    case "expired":
      counts.expired += 1;
      break;
    case "ineligible":
      counts.ineligible += 1;
      break;
    default:
      break;
  }
}

function dashboardProgress(args: {
  initialCompletedAt: string | null;
  windowEndsAt: string | null;
  now: Date;
}): "completed" | "incomplete_after_window" | "active" {
  if (args.initialCompletedAt) return "completed";
  const end = Date.parse(args.windowEndsAt ?? "");
  if (Number.isFinite(end) && args.now.getTime() >= end) return "incomplete_after_window";
  return "active";
}

export function notStartedBatchStatistics(): TtoBatchStatistics {
  return {
    retrieval: "missing",
    error: null,
    status: "not_started",
    startedAt: null,
    initialCompletedAt: null,
    elapsedMs: null,
    openedTrigger: null,
    initialCompletedTrigger: null,
    windowEndsAt: null,
    relevantMemberCount: null,
    initialScheduledMemberCount: null,
    initialScheduledOccurrenceCount: null,
    currentScheduledMemberCount: null,
    currentScheduledOccurrenceCount: null,
    initialOutcomes: null,
    currentOutcomes: null,
    unscheduledMemberCount: 0,
    unresolvedMemberCount: 0,
    latePendingOrClaimedCount: 0,
    confirmedFailureCount: 0,
  };
}

export function unavailableBatchStatistics(error: string): TtoBatchStatistics {
  return {
    ...notStartedBatchStatistics(),
    retrieval: "unavailable",
    error,
    status: "unavailable",
  };
}

export function summarizeDashboardBatch(args: {
  batch: DashboardBatch;
  now: Date;
}): TtoBatchStatistics {
  const current = emptyOutcomeCounts();
  const initial = emptyOutcomeCounts();
  let latePendingOrClaimedCount = 0;
  for (const occurrence of args.batch.occurrences) {
    addOutcome(current, occurrence.state);
    if (occurrence.initialSet === false) {
      if (occurrence.state === "pending" || occurrence.state === "claimed") {
        latePendingOrClaimedCount += 1;
      }
      continue;
    }
    addOutcome(initial, occurrence.initialOutcome);
  }
  const unresolvedMemberCount = args.batch.nonScheduled.filter(
    (item) => item.classification === "unresolved"
  ).length;
  const unscheduledMemberCount = args.batch.nonScheduled.filter(
    (item) => item.classification === "unscheduled"
  ).length;
  const progress = dashboardProgress({
    initialCompletedAt: args.batch.initialCompletedAt,
    windowEndsAt: args.batch.windowEndsAt,
    now: args.now,
  });
  const blocked =
    current.failed +
      current.legacyConflict +
      current.expired +
      current.ineligible +
      unresolvedMemberCount >
    0;
  const status =
    progress === "incomplete_after_window"
      ? "incomplete_after_window"
      : progress === "completed"
        ? blocked
          ? "completed_with_blocked"
          : "completed"
        : current.pending + current.claimed > 0
          ? "in_progress"
          : "started_idle";
  const startedMs = Date.parse(args.batch.startedAt);
  const completedMs = Date.parse(args.batch.initialCompletedAt ?? "");
  const elapsedMs =
    args.batch.initialCompletedAt && Number.isFinite(startedMs) && Number.isFinite(completedMs)
      ? completedMs - startedMs
      : null;
  return {
    retrieval: "ok",
    error: null,
    status,
    startedAt: args.batch.startedAt,
    initialCompletedAt: args.batch.initialCompletedAt,
    elapsedMs: elapsedMs != null && elapsedMs >= 0 ? elapsedMs : null,
    openedTrigger: args.batch.openedTrigger,
    initialCompletedTrigger: args.batch.initialCompletedTrigger,
    windowEndsAt: args.batch.windowEndsAt,
    relevantMemberCount: args.batch.relevantMemberCount,
    initialScheduledMemberCount: args.batch.scheduledMemberCount,
    initialScheduledOccurrenceCount: args.batch.scheduledOccurrenceCount,
    currentScheduledMemberCount: new Set(args.batch.occurrences.map((item) => item.clerkUserId)).size,
    currentScheduledOccurrenceCount: args.batch.occurrences.length,
    initialOutcomes: initial,
    currentOutcomes: current,
    unscheduledMemberCount,
    unresolvedMemberCount,
    latePendingOrClaimedCount,
    confirmedFailureCount: current.failed,
  };
}

function asDashboardString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asDashboardNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asDashboardBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function parseDashboardOccurrence(value: unknown): DashboardOccurrence | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const clerkUserId = asDashboardString(row.clerk_user_id) ?? asDashboardString(row.clerkUserId);
  const memberLocalDate = asDashboardString(row.member_local_date) ?? asDashboardString(row.memberLocalDate);
  const utcInstant = asDashboardString(row.utc_instant) ?? asDashboardString(row.utcInstant);
  const state = asDashboardString(row.state);
  const effectiveLocalMinute =
    asDashboardNumber(row.effective_local_minute) ?? asDashboardNumber(row.effectiveLocalMinute);
  const timeZone = asDashboardString(row.time_zone) ?? asDashboardString(row.timeZone);
  if (!clerkUserId || !memberLocalDate || !utcInstant || !state) return null;
  if (effectiveLocalMinute == null || !timeZone) return null;
  return {
    clerkUserId,
    memberLocalDate,
    utcInstant,
    selectedLocalMinute:
      asDashboardNumber(row.selected_local_minute) ?? asDashboardNumber(row.selectedLocalMinute) ?? 0,
    effectiveLocalMinute,
    timeZone,
    state,
    initialSet:
      row.initial_set == null && row.initialSet == null
        ? true
        : asDashboardBoolean(row.initial_set ?? row.initialSet),
    initialOutcome: asDashboardString(row.initial_outcome) ?? asDashboardString(row.initialOutcome),
  };
}

function parseDashboardBatch(value: unknown): DashboardBatch | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const batchDate = asDashboardString(row.batch_date);
  const sendSlot = asDashboardString(row.send_slot);
  const startedAt = asDashboardString(row.started_at);
  const windowEndsAt = asDashboardString(row.window_ends_at);
  const opened = asDashboardString(row.opened_trigger);
  const relevantMemberCount = asDashboardNumber(row.relevant_member_count);
  const scheduledMemberCount = asDashboardNumber(row.scheduled_member_count);
  const scheduledOccurrenceCount = asDashboardNumber(row.scheduled_occurrence_count);
  if (!batchDate || !sendSlot || !startedAt || !windowEndsAt) return null;
  if (opened !== "manual_schedule" && opened !== "automatic_schedule") return null;
  if (relevantMemberCount == null || scheduledMemberCount == null || scheduledOccurrenceCount == null) {
    return null;
  }
  if (!Array.isArray(row.occurrences) || !Array.isArray(row.non_scheduled)) return null;
  const occurrences: DashboardOccurrence[] = [];
  for (const item of row.occurrences) {
    const occurrence = parseDashboardOccurrence(item);
    if (!occurrence) return null;
    occurrences.push(occurrence);
  }
  const nonScheduled: DashboardBatch["nonScheduled"] = [];
  for (const item of row.non_scheduled) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const clerkUserId = asDashboardString(record.clerk_user_id) ?? asDashboardString(record.clerkUserId);
    const classification = asDashboardString(record.classification);
    const reason = asDashboardString(record.reason);
    if (!clerkUserId || !reason) return null;
    if (classification !== "unscheduled" && classification !== "unresolved") return null;
    nonScheduled.push({ clerkUserId, classification, reason });
  }
  const completedTrigger = asDashboardString(row.initial_completed_trigger);
  return {
    batchDate,
    sendSlot,
    openedTrigger: opened,
    windowEndsAt,
    startedAt,
    initialCompletedAt: asDashboardString(row.initial_completed_at),
    initialCompletedTrigger:
      completedTrigger === "manual_schedule" || completedTrigger === "automatic_schedule"
        ? completedTrigger
        : null,
    relevantMemberCount,
    scheduledMemberCount,
    scheduledOccurrenceCount,
    occurrences,
    nonScheduled,
  };
}

export function scheduledDraftMatchesOccurrence(args: {
  metadata: unknown;
  draftClerkUserId: string;
  draftForDayKey: string;
  draftSendSlot: string;
  clerkUserId: string;
  memberLocalDate: string;
  sendSlot: string;
  batchDate: string;
}): boolean {
  if (args.draftClerkUserId !== args.clerkUserId) return false;
  if (args.draftForDayKey !== args.memberLocalDate) return false;
  if (args.draftSendSlot !== args.sendSlot) return false;
  const metadata = parseGenerationMetadata(args.metadata);
  if (metadata.scheduled_generation_convention !== DASHBOARD_SCHEDULED_GENERATION_CONVENTION) {
    return false;
  }
  if (metadata.administrative_batch_date !== args.batchDate) return false;
  if (
    typeof metadata.member_local_date === "string" &&
    metadata.member_local_date !== args.memberLocalDate
  ) {
    return false;
  }
  if (typeof metadata.tto_owner === "string" && metadata.tto_owner !== args.sendSlot) return false;
  return true;
}

export function scheduledDraftBelongsToAnotherBatch(metadataRaw: unknown, selectedDay: string): boolean {
  const metadata = parseGenerationMetadata(metadataRaw);
  if (metadata.scheduled_generation_convention !== DASHBOARD_SCHEDULED_GENERATION_CONVENTION) {
    return false;
  }
  const batchDate = metadata.administrative_batch_date;
  return typeof batchDate === "string" && batchDate.trim() !== "" && batchDate !== selectedDay;
}

function generatedDeliveryFromMetadata(metadataRaw: unknown): TylerTextOverviewAdminDraftRow["generatedDelivery"] {
  const metadata = parseGenerationMetadata(metadataRaw);
  if (metadata.scheduled_generation_convention !== DASHBOARD_SCHEDULED_GENERATION_CONVENTION) {
    return null;
  }
  return {
    memberLocalDate: asDashboardString(metadata.member_local_date),
    effectiveLocalMinute: asDashboardNumber(metadata.effective_local_minute),
    timeZone: asDashboardString(metadata.time_zone),
  };
}

function isClaimPlaceholderGeneration(generation: GenerationDbRow | undefined): boolean {
  if (!generation) return false;
  if (generation.machine_no_send_reason === CLAIM_PLACEHOLDER_REASON) return true;
  const metadata = parseGenerationMetadata(generation.generation_metadata);
  return metadata.record_kind === "generation_claim";
}

type BatchRowRead =
  | { kind: "missing" }
  | { kind: "failed"; error: string }
  | { kind: "found"; batch: DashboardBatch };

async function readDashboardGenerationBatch(
  batchDate: string,
  sendSlot: SmsDailySendSlot
): Promise<BatchRowRead> {
  const { data, error } = await supabaseServer
    .from(SMS_TTO_GENERATION_BATCHES_TABLE)
    .select("*")
    .eq("batch_date", batchDate)
    .eq("send_slot", sendSlot)
    .maybeSingle();
  if (error) return { kind: "failed", error: error.message };
  if (!data) return { kind: "missing" };
  const batch = parseDashboardBatch(data);
  if (!batch) return { kind: "failed", error: "batch_record_unreadable" };
  return { kind: "found", batch };
}

async function readDashboardBatchDates(
  sendSlot: SmsDailySendSlot
): Promise<{ ok: true; dates: string[] } | { ok: false; error: string }> {
  const { data, error } = await supabaseServer
    .from(SMS_TTO_GENERATION_BATCHES_TABLE)
    .select("batch_date")
    .eq("send_slot", sendSlot);
  if (error) return { ok: false, error: error.message };
  const dates: string[] = [];
  for (const row of Array.isArray(data) ? data : []) {
    if (row == null || typeof row !== "object") continue;
    const batchDate = asDashboardString((row as { batch_date?: unknown }).batch_date);
    if (batchDate) dates.push(batchDate);
  }
  return { ok: true, dates };
}

function mergeDashboardDayKeys(draftKeys: string[], batchDates: string[]): string[] {
  return [...new Set([...draftKeys, ...batchDates])].sort((a, b) => b.localeCompare(a));
}

function occurrenceIdentity(clerkUserId: string, memberLocalDate: string): string {
  return `${clerkUserId}:${memberLocalDate}`;
}

async function buildScheduledBatchDashboard(args: {
  audience: SendableAudienceMember[];
  sendSlot: SmsDailySendSlot;
  dayKey: string;
  searchQuery: string | null;
  now: Date;
  lastRefreshedAt: string;
  batch: DashboardBatch;
  batchDates: string[];
  batchDateListFailed: boolean;
}): Promise<{
  rows: TylerTextOverviewAdminDraftRow[];
  historicalRows: TylerTextOverviewAdminDraftRow[];
  counts: TylerTextOverviewAdminCounts;
  availableDayKeys: string[];
  manifest: TylerTextOverviewManifestIntegrity;
  batchStatistics: TtoBatchStatistics;
}> {
  const audienceById = new Map(args.audience.map((member) => [member.clerkUserId, member]));
  const occurrenceUserIds = args.batch.occurrences.map((item) => item.clerkUserId);
  const clerkUserIds = [
    ...new Set([...args.audience.map((member) => member.clerkUserId), ...occurrenceUserIds]),
  ];
  const dayKeys = [
    ...new Set([
      args.dayKey,
      ...args.batch.occurrences.map((item) => item.memberLocalDate),
    ]),
  ];
  const availableDayKeysPromise = fetchAvailableDraftDayKeys(args.sendSlot);
  const { drafts, exactCount, returnedCount } =
    clerkUserIds.length === 0
      ? { drafts: [] as DraftDbRow[], exactCount: 0, returnedCount: 0 }
      : await fetchCompleteTtoManifestDrafts({
          sendSlot: args.sendSlot,
          clerkUserIds,
          draftForDayKey: null,
          draftForDayKeys: dayKeys,
        });
  const generationIds = drafts
    .map((draft) => draft.current_generation_id)
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  const [{ generationsById, missingIds }, latestGenerationsByKey, availableDayKeys] =
    await Promise.all([
      fetchGenerationsByIdsComplete(generationIds),
      fetchLatestGenerationsForDrafts(drafts, args.sendSlot),
      availableDayKeysPromise,
    ]);

  const draftsByIdentity = new Map<string, DraftDbRow>();
  for (const draft of drafts) {
    draftsByIdentity.set(occurrenceIdentity(draft.clerk_user_id, draft.draft_for_day_key), draft);
  }

  const attachedDraftIds = new Set<string>();
  const occurrenceRows = args.batch.occurrences.map((occurrence) => {
    const member = audienceById.get(occurrence.clerkUserId) ?? {
      clerkUserId: occurrence.clerkUserId,
      phoneNumber: "",
      timezone: occurrence.timeZone || null,
      preferredName: null,
    };
    const draft = draftsByIdentity.get(
      occurrenceIdentity(occurrence.clerkUserId, occurrence.memberLocalDate)
    );
    const generation = draft ? generationsById.get(draft.current_generation_id) : undefined;
    const matches =
      draft != null &&
      scheduledDraftMatchesOccurrence({
        metadata: generation?.generation_metadata,
        draftClerkUserId: draft.clerk_user_id,
        draftForDayKey: draft.draft_for_day_key,
        draftSendSlot: mapDbSendSlotToAdminDto(draft.send_slot),
        clerkUserId: occurrence.clerkUserId,
        memberLocalDate: occurrence.memberLocalDate,
        sendSlot: args.sendSlot,
        batchDate: args.batch.batchDate,
      });
    if (draft && matches) attachedDraftIds.add(draft.id);
    const row = mapAudienceOverlayToAdminRow({
      member,
      sendSlot: args.sendSlot,
      draft: matches && draft ? draft : null,
      generation: matches ? generation : undefined,
      latestGenerationsByKey,
      overlayDayKey: occurrence.memberLocalDate,
    });
    const generatedDelivery = matches ? generatedDeliveryFromMetadata(generation?.generation_metadata) : null;
    const deliveryDiffers =
      generatedDelivery != null &&
      (generatedDelivery.memberLocalDate !== occurrence.memberLocalDate ||
        generatedDelivery.effectiveLocalMinute !== occurrence.effectiveLocalMinute ||
        generatedDelivery.timeZone !== occurrence.timeZone);
    return {
      ...row,
      occurrenceKey: occurrenceIdentity(occurrence.clerkUserId, occurrence.memberLocalDate),
      rowRole: "scheduled_occurrence" as const,
      occurrenceState: occurrence.state,
      scheduledDelivery: {
        memberLocalDate: occurrence.memberLocalDate,
        effectiveLocalMinute: occurrence.effectiveLocalMinute,
        selectedLocalMinute: occurrence.selectedLocalMinute,
        timeZone: occurrence.timeZone,
      },
      generatedDelivery: deliveryDiffers ? generatedDelivery : null,
      generationLinkageError:
        Boolean(matches && draft?.current_generation_id && !generation) ||
        Boolean(matches && draft && missingIds.includes(draft.current_generation_id)),
    };
  });

  const historicalRows: TylerTextOverviewAdminDraftRow[] = [];
  for (const draft of drafts) {
    if (draft.draft_for_day_key !== args.dayKey) continue;
    if (attachedDraftIds.has(draft.id)) continue;
    const generation = generationsById.get(draft.current_generation_id);
    if (scheduledDraftBelongsToAnotherBatch(generation?.generation_metadata, args.dayKey)) continue;
    if (
      parseGenerationMetadata(generation?.generation_metadata).scheduled_generation_convention ===
      DASHBOARD_SCHEDULED_GENERATION_CONVENTION
    ) {
      continue;
    }
    const member = audienceById.get(draft.clerk_user_id) ?? {
      clerkUserId: draft.clerk_user_id,
      phoneNumber: "",
      timezone: null,
      preferredName: null,
    };
    const row = mapAudienceOverlayToAdminRow({
      member,
      sendSlot: args.sendSlot,
      draft,
      generation,
      latestGenerationsByKey,
      overlayDayKey: draft.draft_for_day_key,
    });
    historicalRows.push({
      ...row,
      rowRole: "historical_legacy",
      occurrenceKey: null,
      occurrenceState: null,
      scheduledDelivery: null,
      generatedDelivery: null,
    });
  }

  const statistics = summarizeDashboardBatch({ batch: args.batch, now: args.now });
  const counts = computeTylerTextOverviewAdminCounts(occurrenceRows);
  counts.sendableUsers = args.audience.length;
  const match = (row: TylerTextOverviewAdminDraftRow) =>
    !args.searchQuery || matchesTylerTextOverviewSearchQuery(row, args.searchQuery);
  const linkageErrors = occurrenceRows.filter((row) => row.generationLinkageError === true).length;
  const listedDayKeys = mergeDashboardDayKeys(availableDayKeys, args.batchDates);
  const incompletenessReason = args.batchDateListFailed
    ? "batch_date_list_unavailable"
    : linkageErrors > 0
      ? "generation_linkage_incomplete"
      : null;

  return {
    rows: occurrenceRows.filter(match),
    historicalRows: historicalRows.filter(match),
    counts,
    availableDayKeys: listedDayKeys,
    batchStatistics: statistics,
    manifest: emptyTylerTextOverviewManifestIntegrity({
      manifestComplete: incompletenessReason == null && returnedCount === exactCount,
      selectedDayKey: args.dayKey,
      lastRefreshedAt: args.lastRefreshedAt,
      incompletenessReason,
      expectedAudienceCount: args.audience.length,
      audienceDraftOverlayCount: occurrenceRows.filter((row) => row.draftId != null).length,
      genuineMissingAudienceDraftCount: occurrenceRows.filter((row) => row.draftId == null).length,
      selectedDayDraftCount: occurrenceRows.filter((row) => row.draftId != null).length,
      genuineMissingDraftCount: occurrenceRows.filter((row) => row.draftId == null).length,
      allSelectedDayDraftCount: returnedCount,
      queriedDraftExactCount: exactCount,
      returnedDraftCount: returnedCount,
      generationLinkageErrorCount: linkageErrors,
      audienceComplete: true,
      commitmentLookupComplete: true,
      preferenceLookupComplete: true,
      profileLookupComplete: true,
      draftQueryComplete: returnedCount === exactCount,
      generationQueryComplete: linkageErrors === 0,
      historicalSentCountComplete: true,
      twilioCountComplete: true,
      audienceOverlayInvariantComplete: true,
    }),
  };
}

export async function listSendableTylerTextOverviewRows(args?: {
  draftForDayKey?: string | null;
  sendSlot?: SmsDailySendSlot;
  searchQuery?: string | null;
  now?: Date;
}): Promise<{
  rows: TylerTextOverviewAdminDraftRow[];
  historicalRows: TylerTextOverviewAdminDraftRow[];
  /** Unfiltered complete-audience counts (search must not shrink these). */
  counts: TylerTextOverviewAdminCounts;
  availableDayKeys: string[];
  manifest: TylerTextOverviewManifestIntegrity;
  batchStatistics: TtoBatchStatistics | null;
}> {
  const sendSlot = args?.sendSlot ?? SMS_DAILY_PRODUCTION_SEND_SLOT;
  const dayKey = args?.draftForDayKey?.trim() || null;
  const searchQuery = args?.searchQuery?.trim() || null;
  const now = args?.now ?? new Date();
  const lastRefreshedAt = now.toISOString();
  const batchDateList = await readDashboardBatchDates(sendSlot);
  const batchRead = dayKey ? await readDashboardGenerationBatch(dayKey, sendSlot) : null;

  if (batchRead?.kind === "failed") {
    let draftKeys: string[] = [];
    try {
      draftKeys = await fetchAvailableDraftDayKeys(sendSlot);
    } catch {
      draftKeys = [];
    }
    return {
      rows: [],
      historicalRows: [],
      counts: emptyTylerTextOverviewAdminCounts(),
      availableDayKeys: mergeDashboardDayKeys(draftKeys, batchDateList.ok ? batchDateList.dates : []),
      batchStatistics: unavailableBatchStatistics(batchRead.error),
      manifest: emptyTylerTextOverviewManifestIntegrity({
        manifestComplete: false,
        selectedDayKey: dayKey,
        lastRefreshedAt,
        incompletenessReason: "batch_read_failed",
        draftQueryComplete: false,
        generationQueryComplete: false,
      }),
    };
  }

  const audience = await loadSendableTylerTextOverviewAudienceMembers(now);
  if (batchRead?.kind === "found") {
    return buildScheduledBatchDashboard({
      audience,
      sendSlot,
      dayKey: dayKey ?? batchRead.batch.batchDate,
      searchQuery,
      now,
      lastRefreshedAt,
      batch: batchRead.batch,
      batchDates: batchDateList.ok ? batchDateList.dates : [],
      batchDateListFailed: !batchDateList.ok,
    });
  }
  const audienceComplete = true;
  const commitmentLookupComplete = true;
  const preferenceLookupComplete = true;
  const profileLookupComplete = true;

  if (audience.length === 0) {
    const availableDayKeys = await fetchAvailableDraftDayKeys(sendSlot);
    const historicalSentCountComplete = !dayKey;
    const twilioCountComplete = !dayKey;
    let daySentTotal = 0;
    let twilioAccepted: number | null = null;
    if (dayKey) {
      daySentTotal = await countSelectedDayDraftsMarkedSent({ sendSlot, draftForDayKey: dayKey });
      twilioAccepted = await countSelectedDayTwilioAcceptedEvents({
        sendSlot,
        draftForDayKey: dayKey,
      });
    }
    return {
      rows: [],
      historicalRows: [],
      counts: emptyTylerTextOverviewAdminCounts(),
      availableDayKeys: mergeDashboardDayKeys(
        availableDayKeys,
        batchDateList.ok ? batchDateList.dates : []
      ),
      batchStatistics: dayKey ? notStartedBatchStatistics() : null,
      manifest: emptyTylerTextOverviewManifestIntegrity({
        manifestComplete: Boolean(dayKey),
        selectedDayKey: dayKey,
        lastRefreshedAt,
        incompletenessReason: dayKey
          ? null
          : "select_a_draft_day_for_complete_morning_manifest",
        audienceComplete,
        commitmentLookupComplete,
        preferenceLookupComplete,
        profileLookupComplete,
        draftQueryComplete: true,
        generationQueryComplete: true,
        historicalSentCountComplete: dayKey ? true : historicalSentCountComplete,
        twilioCountComplete: dayKey ? true : twilioCountComplete,
        audienceOverlayInvariantComplete: true,
        allSelectedDaySentDraftCount: daySentTotal,
        draftsMarkedSentDayTotal: daySentTotal,
        twilioAcceptedEventCount: twilioAccepted,
        twilioAcceptedDayTotal: twilioAccepted,
      }),
    };
  }

  const clerkUserIds = audience.map((member) => member.clerkUserId);
  const availableDayKeysPromise = fetchAvailableDraftDayKeys(sendSlot);

  const { drafts, exactCount, returnedCount } = await fetchCompleteTtoManifestDrafts({
    sendSlot,
    clerkUserIds,
    draftForDayKey: dayKey,
  });
  const draftQueryComplete = returnedCount === exactCount;

  const draftsByUserId = new Map<string, DraftDbRow[]>();
  for (const draft of drafts) {
    const existing = draftsByUserId.get(draft.clerk_user_id) ?? [];
    existing.push(draft);
    draftsByUserId.set(draft.clerk_user_id, existing);
  }

  const overlayDrafts: DraftDbRow[] = [];
  for (const member of audience) {
    const userDrafts = draftsByUserId.get(member.clerkUserId) ?? [];
    const overlay = pickTylerTextOverviewDraftOverlay(userDrafts, dayKey);
    if (overlay) overlayDrafts.push(overlay);
  }

  const generationIds = overlayDrafts
    .map((draft) => draft.current_generation_id)
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0);

  const [generationResult, latestGenerationsByKey, availableDayKeys, daySentTotal, twilioAccepted] =
    await Promise.all([
      fetchGenerationsByIdsComplete(generationIds),
      fetchLatestGenerationsForDrafts(overlayDrafts, sendSlot),
      availableDayKeysPromise,
      dayKey
        ? countSelectedDayDraftsMarkedSent({ sendSlot, draftForDayKey: dayKey })
        : Promise.resolve(0),
      dayKey
        ? countSelectedDayTwilioAcceptedEvents({ sendSlot, draftForDayKey: dayKey })
        : Promise.resolve(null),
    ]);

  const { generationsById, missingIds } = generationResult;
  const missingGenerationIdSet = new Set(missingIds);
  const generationQueryComplete = true;

  const allRows = audience.map((member) => {
    const userDrafts = draftsByUserId.get(member.clerkUserId) ?? [];
    const picked = pickTylerTextOverviewDraftOverlay(userDrafts, dayKey);
    const pickedGeneration = picked
      ? generationsById.get(picked.current_generation_id)
      : undefined;
    const foreignScheduledDraft =
      dayKey != null &&
      picked != null &&
      scheduledDraftBelongsToAnotherBatch(pickedGeneration?.generation_metadata, dayKey);
    const overlay = foreignScheduledDraft ? null : picked;
    const generation = foreignScheduledDraft ? undefined : pickedGeneration;
    const row = mapAudienceOverlayToAdminRow({
      member,
      sendSlot,
      draft: overlay,
      generation,
      latestGenerationsByKey,
      overlayDayKey: dayKey,
    });
    if (
      overlay &&
      missingGenerationIdSet.has(overlay.current_generation_id) &&
      !row.generationLinkageError
    ) {
      return { ...row, generationLinkageError: true };
    }
    return row;
  });

  // Search filters display rows only — global counts/manifest use allRows.
  const displayRows = searchQuery
    ? allRows.filter((row) => matchesTylerTextOverviewSearchQuery(row, searchQuery))
    : allRows;

  const audienceDraftOverlayCount = allRows.filter((r) => r.draftId != null).length;
  const genuineMissingAudienceDraftCount = allRows.filter(
    (r) => r.rowState === "no_draft_yet"
  ).length;
  const generationLinkageErrorCount = allRows.filter(
    (r) => r.generationLinkageError === true
  ).length;

  const counts = computeTylerTextOverviewAdminCounts(allRows, {
    draftsMarkedSentDayTotal: dayKey ? daySentTotal : allRows.filter((r) => r.rowState === "draft_sent").length,
    twilioAcceptedDayTotal: twilioAccepted,
  });

  const audienceOverlayInvariantComplete =
    Boolean(dayKey) &&
    audience.length === audienceDraftOverlayCount + genuineMissingAudienceDraftCount;

  const historicalSentCountComplete = Boolean(dayKey) || !dayKey;
  const twilioCountComplete = dayKey ? twilioAccepted != null : true;

  const incompletenessReason = !dayKey
    ? "select_a_draft_day_for_complete_morning_manifest"
    : !draftQueryComplete
      ? "draft_query_incomplete"
      : !audienceOverlayInvariantComplete
        ? "audience_draft_invariant_failed"
        : generationLinkageErrorCount > 0
          ? "generation_linkage_incomplete"
          : null;

  const manifestComplete =
    Boolean(dayKey) &&
    audienceComplete &&
    commitmentLookupComplete &&
    preferenceLookupComplete &&
    profileLookupComplete &&
    draftQueryComplete &&
    generationQueryComplete &&
    generationLinkageErrorCount === 0 &&
    (dayKey ? historicalSentCountComplete : true) &&
    (dayKey ? twilioCountComplete : true) &&
    audienceOverlayInvariantComplete;

  const listedDayKeys = mergeDashboardDayKeys(
    availableDayKeys,
    batchDateList.ok ? batchDateList.dates : []
  );
  const dayListReason = !batchDateList.ok && dayKey ? "batch_date_list_unavailable" : null;

  return {
    rows: displayRows,
    historicalRows: [],
    counts,
    availableDayKeys: listedDayKeys,
    batchStatistics: dayKey ? notStartedBatchStatistics() : null,
    manifest: {
      expectedAudienceCount: audience.length,
      audienceDraftOverlayCount,
      genuineMissingAudienceDraftCount,
      selectedDayDraftCount: audienceDraftOverlayCount,
      genuineMissingDraftCount: genuineMissingAudienceDraftCount,
      allSelectedDayDraftCount: returnedCount,
      allSelectedDaySentDraftCount: dayKey ? daySentTotal : counts.draftSent,
      generationLinkageErrorCount,
      manifestComplete: manifestComplete && dayListReason == null,
      queriedDraftExactCount: exactCount,
      returnedDraftCount: returnedCount,
      draftsMarkedSentDayTotal: dayKey ? daySentTotal : counts.draftSent,
      twilioAcceptedEventCount: twilioAccepted,
      twilioAcceptedDayTotal: twilioAccepted,
      selectedDayKey: dayKey,
      lastRefreshedAt,
      incompletenessReason: dayListReason ?? incompletenessReason,
      audienceComplete,
      commitmentLookupComplete,
      preferenceLookupComplete,
      profileLookupComplete,
      draftQueryComplete,
      generationQueryComplete,
      historicalSentCountComplete: dayKey ? true : historicalSentCountComplete,
      twilioCountComplete,
      audienceOverlayInvariantComplete,
    },
  };
}

export type UpdateTylerTextOverviewDraftBodyResult =
  | { ok: true; row: TylerTextOverviewAdminDraftRow }
  | { ok: false; error: string; status: number };

export type DisplayedDeliveryEcho = {
  clerkUserId?: string;
  memberLocalDate: string;
  effectiveLocalMinute: number;
  timeZone: string;
};

export function parseDisplayedDeliveryEcho(value: unknown): DisplayedDeliveryEcho | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const memberLocalDate = typeof row.memberLocalDate === "string" ? row.memberLocalDate.trim() : "";
  const timeZone = typeof row.timeZone === "string" ? row.timeZone.trim() : "";
  const minute = row.effectiveLocalMinute;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(memberLocalDate) || !isValidIanaTimezone(timeZone)) return null;
  if (typeof minute !== "number" || !Number.isInteger(minute) || minute < 0 || minute > 1439) return null;
  const clerkUserId = typeof row.clerkUserId === "string" ? row.clerkUserId.trim() : undefined;
  return {
    ...(clerkUserId ? { clerkUserId } : {}),
    memberLocalDate,
    effectiveLocalMinute: minute,
    timeZone,
  };
}

export function parseDisplayedDeliveryEchoes(value: unknown): DisplayedDeliveryEcho[] {
  if (!Array.isArray(value)) return [];
  const found: DisplayedDeliveryEcho[] = [];
  for (const item of value) {
    const parsed = parseDisplayedDeliveryEcho(item);
    if (parsed) found.push(parsed);
  }
  return found;
}

function deliveryFactsMatchEcho(fact: TtoCurrentDeliveryFacts, echo: DisplayedDeliveryEcho): boolean {
  return (
    fact.memberLocalDate === echo.memberLocalDate &&
    fact.effectiveLocalMinute === echo.effectiveLocalMinute &&
    fact.timeZone === echo.timeZone
  );
}

function coherentDeliveryFact(fact: TtoCurrentDeliveryFacts, batchDate?: string | null): boolean {
  const owner = fact.owner === "evening_checkin" || fact.owner === "evening"
    ? "evening"
    : fact.owner === "morning"
      ? "morning"
      : null;
  if (!owner || !fact.utcInstant) return false;
  return scheduledDeliveryTupleIsCoherent({
    utcInstant: fact.utcInstant,
    memberLocalDate: fact.memberLocalDate,
    effectiveLocalMinute: fact.effectiveLocalMinute,
    timeZone: fact.timeZone,
    owner,
    administrativeBatchDate: batchDate,
  });
}

function knownContextPayload(fact: TtoCurrentDeliveryFacts): Record<string, unknown> {
  return {
    status: "known",
    member_local_date: fact.memberLocalDate,
    effective_local_minute: fact.effectiveLocalMinute,
    time_zone: fact.timeZone,
    utc_instant: fact.utcInstant || null,
    owner: fact.owner,
  };
}

async function confirmedTylerEditDeliveryContext(args: {
  clerkUserId: string;
  memberLocalDate: string;
  displayed: DisplayedDeliveryEcho | null;
  metadata: Record<string, unknown> | null;
}): Promise<Record<string, unknown>> {
  const echo = args.displayed;
  if (!echo || echo.memberLocalDate !== args.memberLocalDate) return { status: "unavailable" };
  const preference = await readV2UserSmsCommsPreferences(args.clerkUserId);
  let clerkTimezone: string | null = null;
  const scheduleZone = preference.ok ? preference.row?.schedule_timezone?.trim() ?? "" : "";
  if (!scheduleZone) {
    const user = await getClerkUserOrNull(args.clerkUserId);
    const metadata = user?.public_metadata;
    const timezone = metadata && typeof metadata === "object"
      ? (metadata as { timezone?: unknown }).timezone
      : null;
    clerkTimezone = typeof timezone === "string" ? timezone : null;
  }
  if (preference.ok) {
    const cadence = preference.row?.cadence_override ?? null;
    const weekend = preference.row?.weekend_send_policy ?? null;
    const preferenceRead: ProactiveSchedulePreferenceRead =
      cadence != null &&
      cadence !== "daily" &&
      cadence !== "every_other_day" &&
      cadence !== "every_3_days"
        ? { ok: false }
        : weekend != null && weekend !== "all" && weekend !== "weekdays_only"
          ? { ok: false }
          : {
              ok: true,
              row: preference.row
                ? {
                    weekly_schedule: preference.row.weekly_schedule ?? null,
                    schedule_timezone: preference.row.schedule_timezone ?? null,
                    pause_indefinite: preference.row.pause_indefinite === true,
                    pause_until: preference.row.pause_until,
                    cadence_override: cadence,
                    weekend_send_policy: weekend,
                  }
                : null,
            };
    const live = resolveProactiveSchedule({
      preferenceRead,
      clerkTimezone,
      audienceTimezone: null,
      memberLocalDate: args.memberLocalDate,
      proactiveDeliveryAllowed: true,
    });
    if (live.kind === "scheduled") {
      const liveFacts: TtoCurrentDeliveryFacts = {
        memberLocalDate: live.memberLocalDate,
        effectiveLocalMinute: live.effectiveLocalMinute,
        timeZone: live.timeZone,
        utcInstant: live.utcInstant,
        owner: live.owner === "evening" ? "evening_checkin" : "morning",
      };
      if (deliveryFactsMatchEcho(liveFacts, echo) && coherentDeliveryFact(liveFacts, live.batchDate)) {
        return knownContextPayload(liveFacts);
      }
    }
  }
  const stored = persistedDeliveryFactsFromMetadata(args.metadata).find((fact) =>
    deliveryFactsMatchEcho(fact, echo) && coherentDeliveryFact(fact)
  );
  return stored ? knownContextPayload(stored) : { status: "unavailable" };
}

export async function updateTylerTextOverviewDraftBody(args: {
  draftId: string;
  body: string;
  now?: Date;
  /** When set, refuses if the draft row's day does not match (bulk day guard). */
  expectedDraftForDayKey?: string;
  /** When set, refuses if the draft row's send_slot does not match. */
  expectedSendSlot?: SmsDailySendSlot;
  /** Schedule the dashboard presented. Ignored unless the server can confirm it. */
  displayedDelivery?: DisplayedDeliveryEcho | null;
}): Promise<UpdateTylerTextOverviewDraftBodyResult> {
  const draftId = args.draftId.trim();
  if (!draftId) {
    return { ok: false, error: "Missing draft id", status: 400 };
  }

  const { data: draftRow, error: draftLoadError } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(
      "id, clerk_user_id, draft_for_day_key, send_slot, current_generation_id, current_body_to_send, status"
    )
    .eq("id", draftId)
    .maybeSingle();

  if (draftLoadError) {
    return {
      ok: false,
      error: `draft_load_failed:${draftLoadError.message}`,
      status: 500,
    };
  }

  if (!draftRow) {
    return { ok: false, error: "Draft not found", status: 404 };
  }

  const draft = draftRow as DraftDbRow;
  if (draft.status !== "current") {
    return { ok: false, error: "Draft is not current", status: 409 };
  }

  const expectedDay = args.expectedDraftForDayKey?.trim();
  if (expectedDay && draft.draft_for_day_key !== expectedDay) {
    return { ok: false, error: "Draft day mismatch", status: 409 };
  }

  const draftSendSlot = mapDbSendSlotToAdminDto(draft.send_slot);
  if (args.expectedSendSlot && draftSendSlot !== args.expectedSendSlot) {
    return { ok: false, error: "Draft send_slot mismatch", status: 409 };
  }

  const { data: generationRow, error: generationLoadError } = await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .select(GENERATION_SELECT_COLUMNS)
    .eq("id", draft.current_generation_id)
    .maybeSingle();

  if (generationLoadError) {
    return {
      ok: false,
      error: `generation_load_failed:${generationLoadError.message}`,
      status: 500,
    };
  }

  if (!generationRow) {
    return { ok: false, error: "Current generation not found", status: 404 };
  }

  const generation = generationRow as GenerationDbRow;
  const normalizedBody = normalizeTylerTextOverviewDraftBodyInput(args.body);
  if (
    normalizedBody != null &&
    isMorningOrEveningTtoTransportGuardedSlot(draftSendSlot) &&
    smsBodyExceedsTwilioTransportMax(normalizedBody)
  ) {
    return {
      ok: false,
      error: TTO_DRAFT_BODY_EXCEEDS_TWILIO_TRANSPORT_MAX,
      status: 400,
    };
  }
  if (
    normalizedBody != null &&
    draftSendSlot === "weekly_review" &&
    weeklyEditableBodyExceedsMax(normalizedBody)
  ) {
    return {
      ok: false,
      error: WEEKLY_TTO_DRAFT_BODY_EXCEEDS_EDITABLE_MAX,
      status: 400,
    };
  }
  const machineDraftBody =
    typeof generation.machine_draft_body === "string" ? generation.machine_draft_body : null;

  // Save = Tyler approval. Do not require body ≠ machine_draft_body.
  const tylerApproved = isTylerTextOverviewSaveApproval();

  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const currentBodyHash = normalizedBody ? hashSmsSnippet(normalizedBody) : null;
  const editDistanceChars =
    normalizedBody != null && machineDraftBody != null
      ? levenshteinCharDistance(machineDraftBody, normalizedBody)
      : normalizedBody == null && machineDraftBody != null
        ? machineDraftBody.length
        : null;

  let updatedRow: DraftDbRow | null = null;
  if (isMorningOrEveningTtoTransportGuardedSlot(draftSendSlot)) {
    const metadata =
      generation.generation_metadata &&
      typeof generation.generation_metadata === "object" &&
      !Array.isArray(generation.generation_metadata)
        ? (generation.generation_metadata as Record<string, unknown>)
        : null;
    const deliveryContext = tylerApproved
      ? await confirmedTylerEditDeliveryContext({
          clerkUserId: draft.clerk_user_id,
          memberLocalDate: draft.draft_for_day_key,
          displayed: args.displayedDelivery ?? null,
          metadata,
        })
      : { status: "unavailable" };
    const { data: saved, error: saveError } = await supabaseServer.rpc("tto_save_tyler_draft_body", {
      p_draft_id: draftId,
      p_expected_generation_id: draft.current_generation_id,
      p_expected_day: draft.draft_for_day_key,
      p_expected_slot: draft.send_slot,
      p_body: normalizedBody,
      p_body_source: tylerApproved ? "tyler_edit" : "machine",
      p_edited_by_tyler: tylerApproved,
      p_edited_at: tylerApproved ? nowIso : null,
      p_edit_distance: editDistanceChars,
      p_body_hash: currentBodyHash,
      p_now: nowIso,
      p_delivery_context: deliveryContext,
    });
    if (saveError) {
      return {
        ok: false,
        error: `draft_update_failed:${saveError.message}`,
        status: 500,
      };
    }
    const savedRow = saved && typeof saved === "object" && !Array.isArray(saved)
      ? (saved as Record<string, unknown>)
      : null;
    if (!savedRow || savedRow.ok !== true) {
      return { ok: false, error: "Draft update did not apply", status: 409 };
    }
    updatedRow = {
      ...(draft as DraftDbRow),
      current_body_to_send: normalizedBody,
      current_body_source: tylerApproved ? "tyler_edit" : "machine",
      edited_by_tyler: tylerApproved,
      edited_at: tylerApproved ? nowIso : null,
      status: "current",
    };
  } else {
    const { data: directRow, error: updateError } = await supabaseServer
      .from(SMS_DAILY_DRAFTS_TABLE)
      .update({
        current_body_to_send: normalizedBody,
        current_body_source: tylerApproved ? "tyler_edit" : "machine",
        edited_by_tyler: tylerApproved,
        edited_at: tylerApproved ? nowIso : null,
        edit_distance_chars: editDistanceChars,
        current_body_hash: currentBodyHash,
        updated_at: nowIso,
      })
      .eq("id", draftId)
      .eq("status", "current")
      .select(
        "id, clerk_user_id, draft_for_day_key, send_slot, current_generation_id, current_body_to_send, current_body_source, edited_by_tyler, edited_at, status"
      )
      .maybeSingle();

    if (updateError) {
      return {
        ok: false,
        error: `draft_update_failed:${updateError.message}`,
        status: 500,
      };
    }

    if (!directRow) {
      return { ok: false, error: "Draft update did not apply", status: 409 };
    }
    updatedRow = directRow as DraftDbRow;
  }

  const dtoDraft = {
    ...(updatedRow as DraftDbRow),
    send_slot: draftSendSlot,
  };

  const latestGenerationsByKey = await fetchLatestGenerationsForDrafts(
    [dtoDraft],
    draftSendSlot
  );

  return {
    ok: true,
    row: mapDraftRowsToAdminDto({
      drafts: [dtoDraft],
      generationsById: new Map([[generation.id, generation]]),
      latestGenerationsByKey,
    })[0],
  };
}

export type TtoBulkSaveOperation = "blank_all" | "apply_all";

/** @deprecated Prefer TtoBulkSaveOperation — kept for Morning route/test compatibility. */
export type MorningTtoBulkSaveOperation = TtoBulkSaveOperation;

export type TtoBulkSaveFailure = {
  draftId: string;
  clerkUserId: string;
  preferredName: string | null;
  error: string;
};

/** @deprecated Prefer TtoBulkSaveFailure — kept for Morning route/test compatibility. */
export type MorningTtoBulkSaveFailure = TtoBulkSaveFailure;

export type TtoBulkSaveResult = {
  ok: boolean;
  draftForDayKey: string;
  sendSlot: typeof SMS_DAILY_PRODUCTION_SEND_SLOT | typeof SMS_DAILY_EVENING_PREVIEW_SEND_SLOT;
  operation: TtoBulkSaveOperation;
  appliedBody: string | null;
  targeted: number;
  updated: number;
  skippedNonCurrent: number;
  skippedMissing: number;
  failed: TtoBulkSaveFailure[];
  textsSentByThisAction: 0;
};

/**
 * Morning bulk result shape (same fields as TtoBulkSaveResult minus required sendSlot
 * in legacy callers — sendSlot is still present when returned from shared helper).
 */
export type MorningTtoBulkSaveResult = TtoBulkSaveResult;

type TtoBulkDraftTargetRow = {
  id: string;
  clerk_user_id: string;
  draft_for_day_key: string;
  send_slot: string | null;
  status: string;
  current_generation_id?: string | null;
  edited_by_tyler?: boolean | null;
  current_body_source?: string | null;
};

type TtoBulkSaveableSlot =
  | typeof SMS_DAILY_PRODUCTION_SEND_SLOT
  | typeof SMS_DAILY_EVENING_PREVIEW_SEND_SLOT;

async function fetchTtoDraftsForBulkDay(args: {
  draftForDayKey: string;
  draftForDayKeys?: string[];
  sendSlot: TtoBulkSaveableSlot;
  clerkUserIds: string[];
}): Promise<TtoBulkDraftTargetRow[]> {
  const uniqueUserIds = [...new Set(args.clerkUserIds.filter((id) => id.trim()))];
  if (uniqueUserIds.length === 0) return [];

  const pageSize = TTO_MANIFEST_PAGE_SIZE;
  const all: TtoBulkDraftTargetRow[] = [];

  for (const chunk of chunkIdsForTtoManifestQuery(uniqueUserIds)) {
    let from = 0;
    for (;;) {
      let query = supabaseServer
        .from(SMS_DAILY_DRAFTS_TABLE)
        .select(
          "id, clerk_user_id, draft_for_day_key, send_slot, status, current_generation_id, edited_by_tyler, current_body_source"
        )
        .eq("send_slot", args.sendSlot)
        .in("clerk_user_id", chunk);
      const dayKeys = (args.draftForDayKeys ?? []).filter((key) => key.trim());
      query =
        dayKeys.length > 0
          ? query.in("draft_for_day_key", dayKeys)
          : query.eq("draft_for_day_key", args.draftForDayKey);
      const { data, error } = await query
        .order("clerk_user_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        throw new Error(`tto_bulk_draft_query_failed:${error.message}`);
      }

      const rows = (data ?? []) as TtoBulkDraftTargetRow[];
      for (const row of rows) {
        if (
          typeof row.id === "string" &&
          typeof row.clerk_user_id === "string" &&
          typeof row.draft_for_day_key === "string" &&
          typeof row.status === "string"
        ) {
          all.push(row);
        }
      }
      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }

  return all;
}

/**
 * Slot-aware admin bulk Tyler Save for one selected draft_for_day_key.
 * Reuses updateTylerTextOverviewDraftBody; never sends, generates, or calls OpenAI.
 * Only morning and evening_checkin are supported.
 */
export async function bulkSaveTtoDraftBodies(args: {
  draftForDayKey: string;
  sendSlot: TtoBulkSaveableSlot;
  operation: TtoBulkSaveOperation;
  body?: string;
  now?: Date;
  displayedDeliveries?: DisplayedDeliveryEcho[];
}): Promise<TtoBulkSaveResult | { ok: false; error: string; status: number }> {
  const sendSlot = args.sendSlot;
  if (
    sendSlot !== SMS_DAILY_PRODUCTION_SEND_SLOT &&
    sendSlot !== SMS_DAILY_EVENING_PREVIEW_SEND_SLOT
  ) {
    return { ok: false, error: "Unsupported send_slot for bulk save", status: 400 };
  }

  let draftForDayKey: string;
  try {
    draftForDayKey = requireTylerTextOverviewDraftDayKey(args.draftForDayKey);
  } catch {
    return { ok: false, error: "Invalid draft_for_day_key", status: 400 };
  }

  if (args.operation !== "blank_all" && args.operation !== "apply_all") {
    return { ok: false, error: "operation must be blank_all or apply_all", status: 400 };
  }

  let bodyToSave = "";
  let appliedBody: string | null = null;
  if (args.operation === "blank_all") {
    bodyToSave = "";
    appliedBody = null;
  } else {
    const raw = typeof args.body === "string" ? args.body : "";
    const normalized = normalizeTylerTextOverviewDraftBodyInput(raw);
    if (normalized == null) {
      return {
        ok: false,
        error: "apply_all requires a non-empty body; use blank_all to blank texts",
        status: 400,
      };
    }
    bodyToSave = normalized;
    appliedBody = normalized;
    if (smsBodyExceedsTwilioTransportMax(bodyToSave)) {
      return {
        ok: false,
        error: TTO_DRAFT_BODY_EXCEEDS_TWILIO_TRANSPORT_MAX,
        status: 400,
      };
    }
  }

  const batchRead = await readDashboardGenerationBatch(draftForDayKey, sendSlot);
  if (batchRead.kind === "failed") {
    return {
      ok: false,
      error: `batch_read_failed:${batchRead.error}`,
      status: 503,
    };
  }

  const audience = await loadSendableTylerTextOverviewAudienceMembers(args.now ?? new Date());
  const preferredNameByUserId = new Map(
    audience.map((m) => [m.clerkUserId, m.preferredName] as const)
  );
  const audienceIds = audience.map((m) => m.clerkUserId);
  const occurrenceIds =
    batchRead.kind === "found" ? batchRead.batch.occurrences.map((item) => item.clerkUserId) : [];
  const clerkUserIds = [...new Set([...audienceIds, ...occurrenceIds])];

  let dayDrafts: TtoBulkDraftTargetRow[];
  try {
    dayDrafts = await fetchTtoDraftsForBulkDay({
      draftForDayKey,
      draftForDayKeys:
        batchRead.kind === "found"
          ? batchRead.batch.occurrences.map((item) => item.memberLocalDate)
          : undefined,
      sendSlot,
      clerkUserIds,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "tto_bulk_draft_query_failed",
      status: 500,
    };
  }

  let generationsById = new Map<string, GenerationDbRow>();
  try {
    const loaded = await fetchGenerationsByIdsComplete(
      dayDrafts
        .map((draft) => draft.current_generation_id ?? "")
        .filter((id) => id.trim().length > 0)
    );
    generationsById = loaded.generationsById;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "tto_bulk_generation_query_failed",
      status: 500,
    };
  }

  const currentTargets: TtoBulkDraftTargetRow[] = [];
  let skippedNonCurrent = 0;
  let skippedMissing = 0;

  if (batchRead.kind === "found") {
    for (const occurrence of batchRead.batch.occurrences) {
      const draft = dayDrafts.find(
        (item) =>
          item.clerk_user_id === occurrence.clerkUserId &&
          item.draft_for_day_key === occurrence.memberLocalDate &&
          mapDbSendSlotToAdminDto(item.send_slot) === sendSlot
      );
      const generation = draft?.current_generation_id
        ? generationsById.get(draft.current_generation_id)
        : undefined;
      const matches =
        draft != null &&
        scheduledDraftMatchesOccurrence({
          metadata: generation?.generation_metadata,
          draftClerkUserId: draft.clerk_user_id,
          draftForDayKey: draft.draft_for_day_key,
          draftSendSlot: mapDbSendSlotToAdminDto(draft.send_slot),
          clerkUserId: occurrence.clerkUserId,
          memberLocalDate: occurrence.memberLocalDate,
          sendSlot,
          batchDate: batchRead.batch.batchDate,
        });
      if (!draft || !matches) {
        skippedMissing += 1;
        continue;
      }
      const tylerEdited =
        draft.edited_by_tyler === true || draft.current_body_source === "tyler_edit";
      if (draft.status !== "current") {
        skippedNonCurrent += 1;
        continue;
      }
      if (isClaimPlaceholderGeneration(generation) && !tylerEdited) {
        skippedNonCurrent += 1;
        continue;
      }
      currentTargets.push(draft);
    }
  } else {
    const draftsByUserId = new Map<string, TtoBulkDraftTargetRow>();
    for (const draft of dayDrafts) {
      if (draft.draft_for_day_key !== draftForDayKey) continue;
      const slot = mapDbSendSlotToAdminDto(draft.send_slot);
      if (slot !== sendSlot) continue;
      const generation = draft.current_generation_id
        ? generationsById.get(draft.current_generation_id)
        : undefined;
      if (scheduledDraftBelongsToAnotherBatch(generation?.generation_metadata, draftForDayKey)) {
        continue;
      }
      draftsByUserId.set(draft.clerk_user_id, draft);
    }

    for (const clerkUserId of audienceIds) {
      const draft = draftsByUserId.get(clerkUserId);
      if (!draft) {
        skippedMissing += 1;
        continue;
      }
      if (draft.status === "current") {
        currentTargets.push(draft);
      } else {
        skippedNonCurrent += 1;
      }
    }
  }

  const failed: TtoBulkSaveFailure[] = [];
  let updated = 0;

  for (const draft of currentTargets) {
    const displayed = (args.displayedDeliveries ?? []).find(
      (item) =>
        item.clerkUserId === draft.clerk_user_id &&
        item.memberLocalDate === draft.draft_for_day_key
    );
    const result = await updateTylerTextOverviewDraftBody({
      draftId: draft.id,
      body: bodyToSave,
      now: args.now,
      expectedDraftForDayKey: draft.draft_for_day_key,
      expectedSendSlot: sendSlot,
      displayedDelivery: displayed ?? null,
    });

    if (result.ok) {
      updated += 1;
      continue;
    }

    if (result.status === 409 && /not current|day mismatch|send_slot mismatch/i.test(result.error)) {
      skippedNonCurrent += 1;
      continue;
    }

    failed.push({
      draftId: draft.id,
      clerkUserId: draft.clerk_user_id,
      preferredName: preferredNameByUserId.get(draft.clerk_user_id) ?? null,
      error: result.error,
    });
  }

  return {
    ok: failed.length === 0,
    draftForDayKey,
    sendSlot,
    operation: args.operation,
    appliedBody,
    targeted: currentTargets.length,
    updated,
    skippedNonCurrent,
    skippedMissing,
    failed,
    textsSentByThisAction: 0,
  };
}

/**
 * Morning-admin bulk Tyler Save for one selected draft_for_day_key.
 * Thin wrapper over bulkSaveTtoDraftBodies(sendSlot=morning).
 */
export async function bulkSaveMorningTtoDraftBodies(args: {
  draftForDayKey: string;
  operation: MorningTtoBulkSaveOperation;
  body?: string;
  now?: Date;
  displayedDeliveries?: DisplayedDeliveryEcho[];
}): Promise<
  | MorningTtoBulkSaveResult
  | { ok: false; error: string; status: number }
> {
  return bulkSaveTtoDraftBodies({
    draftForDayKey: args.draftForDayKey,
    sendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
    operation: args.operation,
    body: args.body,
    now: args.now,
    displayedDeliveries: args.displayedDeliveries,
  });
}

/**
 * Evening-admin bulk Tyler Save for one selected draft_for_day_key.
 * Thin wrapper over bulkSaveTtoDraftBodies(sendSlot=evening_checkin).
 */
export async function bulkSaveEveningTtoDraftBodies(args: {
  draftForDayKey: string;
  operation: TtoBulkSaveOperation;
  body?: string;
  now?: Date;
  displayedDeliveries?: DisplayedDeliveryEcho[];
}): Promise<TtoBulkSaveResult | { ok: false; error: string; status: number }> {
  return bulkSaveTtoDraftBodies({
    draftForDayKey: args.draftForDayKey,
    sendSlot: SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
    operation: args.operation,
    body: args.body,
    now: args.now,
    displayedDeliveries: args.displayedDeliveries,
  });
}
