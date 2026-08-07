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
  type TylerTextOverviewAdminCounts,
  type TylerTextOverviewAdminDraftRow,
  type TylerTextOverviewDraftStatus,
  type TylerTextOverviewManifestIntegrity,
  type TylerTextOverviewRowState,
  type TylerTextOverviewMorningBriefInterpreterPanel,
  type TylerTextOverviewMorningWriterCapturePanel,
  type TylerTextOverviewSlotCoachingContextPanel,
} from "@/lib/tyler-text-overview-types";
import { requireTylerTextOverviewDraftDayKey } from "@/lib/tyler-text-overview-draft-day-key";
import { isPauseActive, type V2UserSmsCommsPreferencesRow } from "@/lib/v2-sms-comms-preferences";

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
  | "laneStage"
  | "slotCoachingContext"
  | "morningBriefInterpreterV1"
  | "morningCoachingBriefV1"
  | "morningWriterCaptureV1"
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
  laneStage: null,
  slotCoachingContext: null,
  morningBriefInterpreterV1: null,
  morningCoachingBriefV1: null,
  morningWriterCaptureV1: null,
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

function isSendableSmsAudienceRow(row: Record<string, unknown>): boolean {
  if (typeof row.clerk_user_id !== "string" || !row.clerk_user_id.trim()) return false;
  if (row.summitt_subscribed !== true) return false;
  if (row.sms_enabled !== true) return false;
  const phone = row.phone_number;
  if (typeof phone !== "string" || !phone.trim()) return false;
  const stoppedAt = row.stopped_at;
  if (stoppedAt != null && stoppedAt !== "") return false;
  return true;
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
  now: Date = new Date()
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
    if (isPauseActive(prefsByUserId.get(clerkUserId) ?? null, now)) continue;

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

function parseGenerationMetadata(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

export function normalizeTylerTextOverviewDraftBodyInput(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
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

/** Pass through stored generation-time interpreter capture only — never reconstruct. */
export function mapMorningBriefInterpreterPanel(
  metadata: Record<string, unknown>
): TylerTextOverviewMorningBriefInterpreterPanel | null {
  const raw = metadata.morning_brief_interpreter_v1;
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
    exactSystemMessage: typeof c.exact_system_message === "string" ? c.exact_system_message : null,
    exactUserMessage: typeof c.exact_user_message === "string" ? c.exact_user_message : null,
    exactInputObject: exactInput,
    rawResponse: typeof c.raw_response === "string" ? c.raw_response : null,
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
  | "laneStage"
  | "slotCoachingContext"
  | "morningBriefInterpreterV1"
  | "morningCoachingBriefV1"
  | "morningWriterCaptureV1"
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
  const skipSource = readMetadataString(metadata, "skip_source");
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
    laneStage: readMetadataString(metadata, "lane_stage"),
    slotCoachingContext: mapSlotCoachingContextPanel(metadata),
    morningBriefInterpreterV1: mapMorningBriefInterpreterPanel(metadata),
    morningCoachingBriefV1: mapMorningCoachingBriefFromMetadata(metadata),
    morningWriterCaptureV1: mapMorningWriterCapturePanel(metadata),
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

      if (args.draftForDayKey) {
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

export async function listSendableTylerTextOverviewRows(args?: {
  draftForDayKey?: string | null;
  sendSlot?: SmsDailySendSlot;
  searchQuery?: string | null;
  now?: Date;
}): Promise<{
  rows: TylerTextOverviewAdminDraftRow[];
  /** Unfiltered complete-audience counts (search must not shrink these). */
  counts: TylerTextOverviewAdminCounts;
  availableDayKeys: string[];
  manifest: TylerTextOverviewManifestIntegrity;
}> {
  const sendSlot = args?.sendSlot ?? SMS_DAILY_PRODUCTION_SEND_SLOT;
  const dayKey = args?.draftForDayKey?.trim() || null;
  const searchQuery = args?.searchQuery?.trim() || null;
  const now = args?.now ?? new Date();
  const lastRefreshedAt = now.toISOString();

  const audience = await loadSendableTylerTextOverviewAudienceMembers(now);
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
      counts: emptyTylerTextOverviewAdminCounts(),
      availableDayKeys,
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
    const overlay = pickTylerTextOverviewDraftOverlay(userDrafts, dayKey);
    const generation = overlay
      ? generationsById.get(overlay.current_generation_id)
      : undefined;
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

  return {
    rows: displayRows,
    counts,
    availableDayKeys,
    manifest: {
      expectedAudienceCount: audience.length,
      audienceDraftOverlayCount,
      genuineMissingAudienceDraftCount,
      selectedDayDraftCount: audienceDraftOverlayCount,
      genuineMissingDraftCount: genuineMissingAudienceDraftCount,
      allSelectedDayDraftCount: returnedCount,
      allSelectedDaySentDraftCount: dayKey ? daySentTotal : counts.draftSent,
      generationLinkageErrorCount,
      manifestComplete,
      queriedDraftExactCount: exactCount,
      returnedDraftCount: returnedCount,
      draftsMarkedSentDayTotal: dayKey ? daySentTotal : counts.draftSent,
      twilioAcceptedEventCount: twilioAccepted,
      twilioAcceptedDayTotal: twilioAccepted,
      selectedDayKey: dayKey,
      lastRefreshedAt,
      incompletenessReason,
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

export async function updateTylerTextOverviewDraftBody(args: {
  draftId: string;
  body: string;
  now?: Date;
  /** When set, refuses if the draft row's day does not match (bulk day guard). */
  expectedDraftForDayKey?: string;
  /** When set, refuses if the draft row's send_slot does not match. */
  expectedSendSlot?: SmsDailySendSlot;
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

  const { data: updatedRow, error: updateError } = await supabaseServer
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

  if (!updatedRow) {
    return { ok: false, error: "Draft update did not apply", status: 409 };
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

export type MorningTtoBulkSaveOperation = "blank_all" | "apply_all";

export type MorningTtoBulkSaveFailure = {
  draftId: string;
  clerkUserId: string;
  preferredName: string | null;
  error: string;
};

export type MorningTtoBulkSaveResult = {
  ok: boolean;
  draftForDayKey: string;
  operation: MorningTtoBulkSaveOperation;
  appliedBody: string | null;
  targeted: number;
  updated: number;
  skippedNonCurrent: number;
  skippedMissing: number;
  failed: MorningTtoBulkSaveFailure[];
  textsSentByThisAction: 0;
};

type MorningBulkDraftTargetRow = {
  id: string;
  clerk_user_id: string;
  draft_for_day_key: string;
  send_slot: string | null;
  status: string;
};

async function fetchMorningDraftsForBulkDay(args: {
  draftForDayKey: string;
  clerkUserIds: string[];
}): Promise<MorningBulkDraftTargetRow[]> {
  const uniqueUserIds = [...new Set(args.clerkUserIds.filter((id) => id.trim()))];
  if (uniqueUserIds.length === 0) return [];

  const pageSize = TTO_MANIFEST_PAGE_SIZE;
  const all: MorningBulkDraftTargetRow[] = [];

  for (const chunk of chunkIdsForTtoManifestQuery(uniqueUserIds)) {
    let from = 0;
    for (;;) {
      const { data, error } = await supabaseServer
        .from(SMS_DAILY_DRAFTS_TABLE)
        .select("id, clerk_user_id, draft_for_day_key, send_slot, status")
        .eq("draft_for_day_key", args.draftForDayKey)
        .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT)
        .in("clerk_user_id", chunk)
        .order("clerk_user_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        throw new Error(`morning_bulk_draft_query_failed:${error.message}`);
      }

      const rows = (data ?? []) as MorningBulkDraftTargetRow[];
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
 * Morning-admin bulk Tyler Save for one selected draft_for_day_key.
 * Reuses updateTylerTextOverviewDraftBody; never sends, generates, or calls OpenAI.
 */
export async function bulkSaveMorningTtoDraftBodies(args: {
  draftForDayKey: string;
  operation: MorningTtoBulkSaveOperation;
  body?: string;
  now?: Date;
}): Promise<
  | MorningTtoBulkSaveResult
  | { ok: false; error: string; status: number }
> {
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
  }

  const audience = await loadSendableTylerTextOverviewAudienceMembers(args.now ?? new Date());
  const preferredNameByUserId = new Map(
    audience.map((m) => [m.clerkUserId, m.preferredName] as const)
  );
  const audienceIds = audience.map((m) => m.clerkUserId);

  let dayDrafts: MorningBulkDraftTargetRow[];
  try {
    dayDrafts = await fetchMorningDraftsForBulkDay({
      draftForDayKey,
      clerkUserIds: audienceIds,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "morning_bulk_draft_query_failed",
      status: 500,
    };
  }

  const draftsByUserId = new Map<string, MorningBulkDraftTargetRow>();
  for (const draft of dayDrafts) {
    if (draft.draft_for_day_key !== draftForDayKey) continue;
    const slot = mapDbSendSlotToAdminDto(draft.send_slot);
    if (slot !== SMS_DAILY_PRODUCTION_SEND_SLOT) continue;
    draftsByUserId.set(draft.clerk_user_id, draft);
  }

  const currentTargets: MorningBulkDraftTargetRow[] = [];
  let skippedNonCurrent = 0;
  let skippedMissing = 0;

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

  const failed: MorningTtoBulkSaveFailure[] = [];
  let updated = 0;

  for (const draft of currentTargets) {
    const result = await updateTylerTextOverviewDraftBody({
      draftId: draft.id,
      body: bodyToSave,
      now: args.now,
      expectedDraftForDayKey: draftForDayKey,
      expectedSendSlot: SMS_DAILY_PRODUCTION_SEND_SLOT,
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
