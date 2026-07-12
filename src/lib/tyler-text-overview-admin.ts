import { supabaseServer } from "@/lib/supabase-server";
import {
  deriveNotebookDisplayMode,
  deriveNotebookFamily,
} from "@/lib/tyler-text-overview-notebook-display";
import type { TylerTextOverviewWriterOpenAiMessage } from "@/lib/tyler-text-overview-writer-capture";
import {
  parseSmsDailySendSlot,
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
  type SmsDailySendSlot,
  type TylerTextOverviewAdminCounts,
  type TylerTextOverviewAdminDraftRow,
  type TylerTextOverviewDraftStatus,
  type TylerTextOverviewRowState,
  type TylerTextOverviewSlotCoachingContextPanel,
} from "@/lib/tyler-text-overview-types";
import { isPauseActive, type V2UserSmsCommsPreferencesRow } from "@/lib/v2-sms-comms-preferences";

export const PREVIEW_ONLY_DRAFT_NOT_EDITABLE = "preview_only_draft_not_editable" as const;

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
import { parseSlotCoachingContextFromMetadata } from "@/lib/slot-coaching-context-v1";
import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";

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
> = {
  writerOpenAiMessages: [],
  currentGenerationId: null,
  currentGenerationNumber: null,
  latestGenerationId: null,
  latestGenerationNumber: null,
  isLatestGeneration: null,
  writerPromptPath: null,
  notebookHash: null,
  notebookMessageCount: 0,
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
};

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

export function matchesTylerTextOverviewSearchQuery(
  row: TylerTextOverviewAdminDraftRow,
  rawQuery: string | null | undefined
): boolean {
  const query = rawQuery?.trim().toLowerCase();
  if (!query) return true;

  const haystacks = [
    row.clerkUserId,
    row.preferredName,
    row.phoneNumber,
    row.draftForDayKey,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLowerCase());

  return haystacks.some((value) => value.includes(query));
}

export function computeTylerTextOverviewAdminCounts(
  rows: TylerTextOverviewAdminDraftRow[]
): TylerTextOverviewAdminCounts {
  let noDraftYet = 0;
  let draftCurrent = 0;
  let draftSent = 0;
  let draftSkipped = 0;
  let machineShouldSendTrue = 0;
  let machineShouldSendFalse = 0;

  for (const row of rows) {
    switch (row.rowState) {
      case "no_draft_yet":
        noDraftYet += 1;
        break;
      case "draft_current":
        draftCurrent += 1;
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
    draftSent,
    draftSkipped,
    machineShouldSendTrue,
    machineShouldSendFalse,
  };
}

function emptyTylerTextOverviewAdminCounts(): TylerTextOverviewAdminCounts {
  return {
    sendableUsers: 0,
    noDraftYet: 0,
    draftCurrent: 0,
    draftSent: 0,
    draftSkipped: 0,
    machineShouldSendTrue: 0,
    machineShouldSendFalse: 0,
  };
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

export async function loadSendableTylerTextOverviewAudienceMembers(
  now: Date = new Date()
): Promise<SendableAudienceMember[]> {
  const { data: audienceRows, error: audienceError } = await supabaseServer
    .from("sms_audience")
    .select("clerk_user_id, phone_number, timezone, sms_enabled, stopped_at, summitt_subscribed")
    .eq("summitt_subscribed", true)
    .eq("sms_enabled", true);

  if (audienceError) {
    throw new Error(`tyler_text_overview_sendable_audience_failed:${audienceError.message}`);
  }

  const smsEligible = (audienceRows ?? []).filter(isSendableSmsAudienceRow);
  if (smsEligible.length === 0) return [];

  const clerkUserIds = [...new Set(smsEligible.map((row) => row.clerk_user_id as string))];

  const [commitmentResult, prefsResult, profileResult] = await Promise.all([
    supabaseServer
      .from("v2_commitment")
      .select("clerk_user_id, behavior_statement, status")
      .eq("status", "active")
      .in("clerk_user_id", clerkUserIds),
    supabaseServer
      .from("v2_user_sms_comms_preferences")
      .select("clerk_user_id, pause_until")
      .in("clerk_user_id", clerkUserIds),
    supabaseServer
      .from("user_profiles")
      .select("clerk_user_id, preferred_name")
      .in("clerk_user_id", clerkUserIds),
  ]);

  if (commitmentResult.error) {
    throw new Error(
      `tyler_text_overview_sendable_v2_failed:${commitmentResult.error.message}`
    );
  }

  const activeV2UserIds = new Set<string>();
  for (const row of commitmentResult.data ?? []) {
    if (typeof row.clerk_user_id !== "string") continue;
    const behavior =
      typeof row.behavior_statement === "string" ? row.behavior_statement.trim() : "";
    if (behavior.length > 0) {
      activeV2UserIds.add(row.clerk_user_id);
    }
  }

  const prefsByUserId = new Map<string, V2UserSmsCommsPreferencesRow>();
  if (!prefsResult.error) {
    for (const row of prefsResult.data ?? []) {
      if (typeof row.clerk_user_id !== "string") continue;
      prefsByUserId.set(row.clerk_user_id, {
        clerk_user_id: row.clerk_user_id,
        pause_until: typeof row.pause_until === "string" ? row.pause_until : null,
      } as V2UserSmsCommsPreferencesRow);
    }
  }

  const preferredNameByUserId = new Map<string, string>();
  if (!profileResult.error) {
    for (const row of profileResult.data ?? []) {
      if (typeof row.clerk_user_id !== "string") continue;
      const name = typeof row.preferred_name === "string" ? row.preferred_name.trim() : "";
      if (name) preferredNameByUserId.set(row.clerk_user_id, name);
    }
  }

  const members: SendableAudienceMember[] = [];
  for (const row of smsEligible) {
    const clerkUserId = row.clerk_user_id as string;
    if (!activeV2UserIds.has(clerkUserId)) continue;
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
      ...EMPTY_NOTEBOOK_FIELDS,
      previewOnly: sendSlot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
      morningAnchorSource: null,
      morningAnchorSent: null,
      morningAnchorBodyPreview: null,
    };
  }

  const mapped = mapDraftRowsToAdminDto({
    drafts: [draft],
    generationsById: generation ? new Map([[generation.id, generation]]) : new Map(),
    latestGenerationsByKey,
    audienceByUserId: new Map([[member.clerkUserId, member]]),
  })[0];

  return {
    ...mapped,
    preferredName: member.preferredName,
    phoneNumber: member.phoneNumber,
    timezone: member.timezone,
    rowState: resolveTylerTextOverviewRowState(draft.status),
  };
}
type DraftDbRow = {
  id: string;
  clerk_user_id: string;
  draft_for_day_key: string;
  send_slot?: string;
  current_generation_id: string;
  current_body_to_send: string | null;
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
};

type LatestGenerationRef = {
  id: string;
  generation_number: number;
};

const WRITER_MESSAGE_ROLES = new Set(["system", "user", "assistant"]);

const GENERATION_SELECT_COLUMNS =
  "id, generation_number, writer_openai_messages, writer_prompt_path, machine_draft_body, machine_should_send, machine_no_send_reason, notebook_hash, generation_metadata, route_kind, clerk_user_id, draft_for_day_key";

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

function mapGenerationToNotebookFields(
  generation: GenerationDbRow | undefined
): Pick<
  TylerTextOverviewAdminDraftRow,
  | "writerOpenAiMessages"
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
> {
  const writerOpenAiMessages = parseWriterOpenAiMessages(generation?.writer_openai_messages);
  const notebookMessageCount = writerOpenAiMessages.length;
  const metadata = parseGenerationMetadata(generation?.generation_metadata);
  const machineShouldSend =
    typeof generation?.machine_should_send === "boolean" ? generation.machine_should_send : null;
  const machineNoSendReason =
    typeof generation?.machine_no_send_reason === "string"
      ? generation.machine_no_send_reason
      : null;
  const capturePresent = readMetadataBoolean(metadata, "capture_present");
  const intentionalSpace = readMetadataBoolean(metadata, "intentional_space");
  const skipSource = readMetadataString(metadata, "skip_source");

  return {
    writerOpenAiMessages,
    currentGenerationId: generation?.id ?? null,
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
    const notebookFields = mapGenerationToNotebookFields(generation);
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
      ...notebookFields,
      ...previewFields,
      ...weeklyPeriodFields,
      latestGenerationId: latest?.id ?? notebookFields.currentGenerationId,
      latestGenerationNumber: latest?.generation_number ?? notebookFields.currentGenerationNumber,
      isLatestGeneration:
        latest != null && generation?.id != null ? latest.id === generation.id : null,
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
    "id, clerk_user_id, draft_for_day_key, send_slot, current_generation_id, current_body_to_send, status, sent_at, final_body_sent, twilio_message_sid, source_sms_send_event_id";

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

export async function listSendableTylerTextOverviewRows(args?: {
  draftForDayKey?: string | null;
  sendSlot?: SmsDailySendSlot;
  searchQuery?: string | null;
  now?: Date;
}): Promise<{
  rows: TylerTextOverviewAdminDraftRow[];
  counts: TylerTextOverviewAdminCounts;
  availableDayKeys: string[];
}> {
  const sendSlot = args?.sendSlot ?? SMS_DAILY_PRODUCTION_SEND_SLOT;
  const dayKey = args?.draftForDayKey?.trim() || null;
  const searchQuery = args?.searchQuery?.trim() || null;
  const now = args?.now ?? new Date();

  const audience = await loadSendableTylerTextOverviewAudienceMembers(now);
  if (audience.length === 0) {
    return {
      rows: [],
      counts: emptyTylerTextOverviewAdminCounts(),
      availableDayKeys: [],
    };
  }

  const audienceByUserId = new Map(audience.map((member) => [member.clerkUserId, member]));
  const clerkUserIds = audience.map((member) => member.clerkUserId);

  const draftSelectColumns =
    "id, clerk_user_id, draft_for_day_key, send_slot, current_generation_id, current_body_to_send, status, sent_at, final_body_sent, twilio_message_sid, source_sms_send_event_id";

  const { data: draftRows, error: draftError } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(draftSelectColumns)
    .eq("send_slot", sendSlot)
    .in("clerk_user_id", clerkUserIds)
    .in("status", ["current", "sent", "skipped"]);

  if (draftError) {
    throw new Error(`tyler_text_overview_drafts_list_failed:${draftError.message}`);
  }

  const drafts = (draftRows ?? []) as DraftDbRow[];
  const draftsByUserId = new Map<string, DraftDbRow[]>();
  const availableDayKeySet = new Set<string>();

  for (const draft of drafts) {
    availableDayKeySet.add(draft.draft_for_day_key);
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

  const generationIds = [
    ...new Set(overlayDrafts.map((draft) => draft.current_generation_id).filter(Boolean)),
  ];

  const [generationResult, latestGenerationsByKey] = await Promise.all([
    generationIds.length > 0
      ? supabaseServer
          .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
          .select(GENERATION_SELECT_COLUMNS)
          .in("id", generationIds)
      : Promise.resolve({ data: [], error: null }),
    fetchLatestGenerationsForDrafts(overlayDrafts, sendSlot),
  ]);

  if (generationResult.error) {
    throw new Error(
      `tyler_text_overview_generations_list_failed:${generationResult.error.message}`
    );
  }

  const generationsById = new Map<string, GenerationDbRow>();
  for (const row of generationResult.data ?? []) {
    if (typeof row.id === "string") {
      generationsById.set(row.id, row as GenerationDbRow);
    }
  }

  const rows = audience.map((member) => {
    const userDrafts = draftsByUserId.get(member.clerkUserId) ?? [];
    const overlay = pickTylerTextOverviewDraftOverlay(userDrafts, dayKey);
    const generation = overlay
      ? generationsById.get(overlay.current_generation_id)
      : undefined;

    return mapAudienceOverlayToAdminRow({
      member,
      sendSlot,
      draft: overlay,
      generation,
      latestGenerationsByKey,
      overlayDayKey: dayKey,
    });
  });

  const filteredRows = searchQuery
    ? rows.filter((row) => matchesTylerTextOverviewSearchQuery(row, searchQuery))
    : rows;

  return {
    rows: filteredRows,
    counts: computeTylerTextOverviewAdminCounts(filteredRows),
    availableDayKeys: [...availableDayKeySet].sort((a, b) => b.localeCompare(a)),
  };
}

export type UpdateTylerTextOverviewDraftBodyResult =
  | { ok: true; row: TylerTextOverviewAdminDraftRow }
  | { ok: false; error: string; status: number };

export async function updateTylerTextOverviewDraftBody(args: {
  draftId: string;
  body: string;
  now?: Date;
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

  const draftSendSlot = mapDbSendSlotToAdminDto(draft.send_slot);

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

  const edited = computeTylerTextOverviewEdited({
    normalizedBody,
    machineDraftBody,
  });

  const now = args.now ?? new Date();
  const nowIso = now.toISOString();
  const currentBodyHash = normalizedBody ? hashSmsSnippet(normalizedBody) : null;
  const editDistanceChars =
    edited && normalizedBody != null && machineDraftBody != null
      ? levenshteinCharDistance(machineDraftBody, normalizedBody)
      : null;

  const { data: updatedRow, error: updateError } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .update({
      current_body_to_send: normalizedBody,
      current_body_source: edited ? "tyler_edit" : "machine",
      edited_by_tyler: edited,
      edited_at: edited ? nowIso : null,
      edit_distance_chars: editDistanceChars,
      current_body_hash: currentBodyHash,
      updated_at: nowIso,
    })
    .eq("id", draftId)
    .eq("status", "current")
    .select(
      "id, clerk_user_id, draft_for_day_key, send_slot, current_generation_id, current_body_to_send, status"
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
