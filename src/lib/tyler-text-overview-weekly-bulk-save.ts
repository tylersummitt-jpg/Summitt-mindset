import { supabaseServer } from "@/lib/supabase-server";
import {
  chunkIdsForTtoManifestQuery,
  levenshteinCharDistance,
  loadSendableTylerTextOverviewAudienceMembers,
  normalizeTylerTextOverviewDraftBodyInput,
  TTO_MANIFEST_ID_CHUNK_SIZE,
} from "@/lib/tyler-text-overview-admin";
import { requireTylerTextOverviewDraftDayKey } from "@/lib/tyler-text-overview-draft-day-key";
import { runPoolWithBudget, TTO_GENERATE_ALL_CONCURRENCY } from "@/lib/tyler-text-overview-generate-all";
import {
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";
import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";
import { getWeekKeyForLocalDateKey } from "@/lib/weekly-sms-week-key";
import {
  WEEKLY_TTO_DRAFT_BODY_EXCEEDS_EDITABLE_MAX,
  weeklyEditableBodyExceedsMax,
} from "@/lib/weekly-tto-length";

export const WEEKLY_TTO_BULK_OPERATION = "apply_all" as const;

export type WeeklyTtoBulkSaveFailure = {
  draftId: string;
  preferredName: string | null;
  error: string;
};

export type WeeklyTtoBulkSaveResult = {
  ok: boolean;
  draftForDayKey: string;
  weekKey: string;
  operation: typeof WEEKLY_TTO_BULK_OPERATION;
  audience: number;
  candidates: number;
  updated: number;
  skippedMissing: number;
  skippedNonCurrent: number;
  skippedBadWeekLinkage: number;
  skippedSendEvent: number;
  skippedAmbiguous: number;
  skippedMissingGeneration: number;
  failed: WeeklyTtoBulkSaveFailure[];
  textsSentByThisAction: 0;
  message: string;
};

type WeeklyBulkDraftRow = {
  id: string;
  clerk_user_id: string;
  draft_for_day_key: string;
  send_slot: string;
  status: string;
  current_generation_id: string | null;
  current_body_to_send: string | null;
};

type WeeklyBulkGenerationRow = {
  id: string;
  send_slot: string | null;
  machine_draft_body: string | null;
  machine_should_send: boolean | null;
  generation_metadata: Record<string, unknown> | null;
};

function metadataText(metadata: Record<string, unknown> | null, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatWeeklyBulkMessage(args: {
  updated: number;
  failed: number;
  audience: number;
  candidates: number;
  skippedMissing: number;
  skippedNonCurrent: number;
  skippedBadWeekLinkage: number;
  skippedSendEvent: number;
  skippedAmbiguous: number;
  skippedMissingGeneration: number;
}): string {
  const head =
    args.failed > 0
      ? `Updated ${args.updated}. ${args.failed} failed. This action sent 0 texts.`
      : `Updated ${args.updated}. This action sent 0 texts.`;
  return [
    head,
    `Audience ${args.audience}. Candidates ${args.candidates}.`,
    `Skipped missing ${args.skippedMissing}, non-current ${args.skippedNonCurrent}, bad week linkage ${args.skippedBadWeekLinkage}, send event ${args.skippedSendEvent}, ambiguous ${args.skippedAmbiguous}, missing generation ${args.skippedMissingGeneration}.`,
  ].join(" ");
}

function mapApplyReason(reason: string): keyof Pick<
  WeeklyTtoBulkSaveResult,
  | "skippedNonCurrent"
  | "skippedBadWeekLinkage"
  | "skippedSendEvent"
  | "skippedAmbiguous"
  | "skippedMissingGeneration"
> | "failed" {
  switch (reason) {
    case "send_event_exists":
      return "skippedSendEvent";
    case "ambiguous_week":
    case "draft_mismatch":
      return "skippedAmbiguous";
    case "missing_generation":
      return "skippedMissingGeneration";
    case "bad_week_linkage":
    case "no_current_for_week":
      return "skippedBadWeekLinkage";
    case "not_current":
      return "skippedNonCurrent";
    default:
      return "failed";
  }
}

async function fetchWeeklyDraftsForSunday(
  clerkUserIds: string[],
  draftForDayKey: string
): Promise<WeeklyBulkDraftRow[]> {
  const rows: WeeklyBulkDraftRow[] = [];
  for (const chunk of chunkIdsForTtoManifestQuery(clerkUserIds, TTO_MANIFEST_ID_CHUNK_SIZE)) {
    const { data, error } = await supabaseServer
      .from(SMS_DAILY_DRAFTS_TABLE)
      .select(
        "id, clerk_user_id, draft_for_day_key, send_slot, status, current_generation_id, current_body_to_send"
      )
      .in("clerk_user_id", chunk)
      .eq("draft_for_day_key", draftForDayKey)
      .eq("send_slot", SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT);
    if (error) {
      throw new Error(`weekly_bulk_draft_read_failed:${error.message}`);
    }
    for (const row of data ?? []) {
      if (!row || typeof row.id !== "string" || typeof row.clerk_user_id !== "string") continue;
      rows.push({
        id: row.id,
        clerk_user_id: row.clerk_user_id,
        draft_for_day_key:
          typeof row.draft_for_day_key === "string" ? row.draft_for_day_key : draftForDayKey,
        send_slot: typeof row.send_slot === "string" ? row.send_slot : "",
        status: typeof row.status === "string" ? row.status : "",
        current_generation_id:
          typeof row.current_generation_id === "string" ? row.current_generation_id : null,
        current_body_to_send:
          typeof row.current_body_to_send === "string" ? row.current_body_to_send : null,
      });
    }
  }
  return rows;
}

async function fetchGenerationsByIds(ids: string[]): Promise<Map<string, WeeklyBulkGenerationRow>> {
  const byId = new Map<string, WeeklyBulkGenerationRow>();
  for (const chunk of chunkIdsForTtoManifestQuery(ids, TTO_MANIFEST_ID_CHUNK_SIZE)) {
    const { data, error } = await supabaseServer
      .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
      .select("id, send_slot, machine_draft_body, machine_should_send, generation_metadata")
      .in("id", chunk);
    if (error) {
      throw new Error(`weekly_bulk_generation_read_failed:${error.message}`);
    }
    for (const row of data ?? []) {
      if (!row || typeof row.id !== "string") continue;
      const metadata =
        row.generation_metadata &&
        typeof row.generation_metadata === "object" &&
        !Array.isArray(row.generation_metadata)
          ? (row.generation_metadata as Record<string, unknown>)
          : null;
      byId.set(row.id, {
        id: row.id,
        send_slot: typeof row.send_slot === "string" ? row.send_slot : null,
        machine_draft_body:
          typeof row.machine_draft_body === "string" ? row.machine_draft_body : null,
        machine_should_send:
          typeof row.machine_should_send === "boolean" ? row.machine_should_send : null,
        generation_metadata: metadata,
      });
    }
  }
  return byId;
}

async function fetchWeeklySendEventUserIds(
  clerkUserIds: string[],
  weekKey: string
): Promise<Set<string>> {
  const blocked = new Set<string>();
  for (const chunk of chunkIdsForTtoManifestQuery(clerkUserIds, TTO_MANIFEST_ID_CHUNK_SIZE)) {
    const { data, error } = await supabaseServer
      .from("sms_weekly_send_events")
      .select("clerk_user_id, week_key, status")
      .eq("week_key", weekKey)
      .in("clerk_user_id", chunk);
    if (error) {
      throw new Error(`weekly_bulk_send_event_read_failed:${error.message}`);
    }
    for (const row of data ?? []) {
      if (row && typeof row.clerk_user_id === "string" && row.clerk_user_id.trim()) {
        blocked.add(row.clerk_user_id);
      }
    }
  }
  return blocked;
}

export async function bulkApplyWeeklyTtoDraftBodies(args: {
  draftForDayKey: string;
  body: string;
  now?: Date;
}): Promise<WeeklyTtoBulkSaveResult | { ok: false; error: string; status: number }> {
  let draftForDayKey: string;
  try {
    draftForDayKey = requireTylerTextOverviewDraftDayKey(args.draftForDayKey);
  } catch {
    return { ok: false, error: "Invalid draft_for_day_key", status: 400 };
  }

  const normalized = normalizeTylerTextOverviewDraftBodyInput(args.body);
  if (normalized == null) {
    return { ok: false, error: "apply_all requires a non-empty body", status: 400 };
  }
  if (weeklyEditableBodyExceedsMax(normalized)) {
    return { ok: false, error: WEEKLY_TTO_DRAFT_BODY_EXCEEDS_EDITABLE_MAX, status: 400 };
  }

  const weekKey = getWeekKeyForLocalDateKey(draftForDayKey);
  const now = args.now ?? new Date();
  const editedAt = now.toISOString();
  const bodyHash = hashSmsSnippet(normalized);

  const audience = await loadSendableTylerTextOverviewAudienceMembers(now);
  const audienceIds = audience.map((member) => member.clerkUserId);
  const preferredNameByUserId = new Map(
    audience.map((member) => [member.clerkUserId, member.preferredName])
  );

  const drafts = await fetchWeeklyDraftsForSunday(audienceIds, draftForDayKey);
  const draftsByUser = new Map<string, WeeklyBulkDraftRow[]>();
  for (const draft of drafts) {
    const list = draftsByUser.get(draft.clerk_user_id) ?? [];
    list.push(draft);
    draftsByUser.set(draft.clerk_user_id, list);
  }

  const generationIds = drafts
    .map((draft) => draft.current_generation_id)
    .filter((id): id is string => Boolean(id));
  const generations = await fetchGenerationsByIds(generationIds);
  const sendEventUsers = await fetchWeeklySendEventUserIds(audienceIds, weekKey);

  let skippedMissing = 0;
  let skippedNonCurrent = 0;
  let skippedBadWeekLinkage = 0;
  let skippedSendEvent = 0;
  let skippedAmbiguous = 0;
  let skippedMissingGeneration = 0;
  const candidates: WeeklyBulkDraftRow[] = [];

  for (const clerkUserId of audienceIds) {
    const userDrafts = draftsByUser.get(clerkUserId) ?? [];
    if (userDrafts.length === 0) {
      skippedMissing += 1;
      continue;
    }
    const current = userDrafts.filter((draft) => draft.status === "current");
    if (current.length === 0) {
      skippedNonCurrent += 1;
      continue;
    }
    if (current.length > 1) {
      skippedAmbiguous += 1;
      continue;
    }
    const draft = current[0]!;
    if (sendEventUsers.has(clerkUserId)) {
      skippedSendEvent += 1;
      continue;
    }
    const generation = draft.current_generation_id
      ? generations.get(draft.current_generation_id) ?? null
      : null;
    if (!generation) {
      skippedMissingGeneration += 1;
      continue;
    }
    const weekEnd = metadataText(generation.generation_metadata, "week_end");
    const generationWeekKey = metadataText(generation.generation_metadata, "week_key");
    if (
      generation.send_slot !== SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT ||
      generationWeekKey !== weekKey ||
      weekEnd !== draftForDayKey
    ) {
      skippedBadWeekLinkage += 1;
      continue;
    }
    candidates.push(draft);
  }

  const failed: WeeklyTtoBulkSaveFailure[] = [];
  let updated = 0;

  await runPoolWithBudget({
    items: candidates,
    concurrency: TTO_GENERATE_ALL_CONCURRENCY,
    shouldStop: () => false,
    worker: async (draft) => {
      const generation = draft.current_generation_id
        ? generations.get(draft.current_generation_id)
        : undefined;
      const machineBody = generation?.machine_draft_body ?? "";
      const { data, error } = await supabaseServer.rpc("weekly_tto_apply_tyler_body", {
        p_draft_id: draft.id,
        p_clerk_user_id: draft.clerk_user_id,
        p_draft_for_day_key: draftForDayKey,
        p_week_key: weekKey,
        p_body: normalized,
        p_body_hash: bodyHash,
        p_edit_distance_chars: levenshteinCharDistance(machineBody, normalized),
        p_edited_at: editedAt,
      });
      if (error) {
        console.error("[weekly-tto-bulk] weekly_tto_apply_tyler_body failed", {
          draft_id: draft.id,
          message: error.message,
        });
        failed.push({
          draftId: draft.id,
          preferredName: preferredNameByUserId.get(draft.clerk_user_id) ?? null,
          error: error.message,
        });
        return;
      }
      const row = (Array.isArray(data) ? data[0] : data) as
        | { ok?: boolean; reason?: string }
        | null
        | undefined;
      if (row?.ok === true && row.reason === "applied") {
        updated += 1;
        return;
      }
      const reason = typeof row?.reason === "string" ? row.reason : "apply_failed";
      const bucket = mapApplyReason(reason);
      if (bucket === "failed") {
        failed.push({
          draftId: draft.id,
          preferredName: preferredNameByUserId.get(draft.clerk_user_id) ?? null,
          error: reason,
        });
        return;
      }
      if (bucket === "skippedNonCurrent") skippedNonCurrent += 1;
      else if (bucket === "skippedBadWeekLinkage") skippedBadWeekLinkage += 1;
      else if (bucket === "skippedSendEvent") skippedSendEvent += 1;
      else if (bucket === "skippedAmbiguous") skippedAmbiguous += 1;
      else skippedMissingGeneration += 1;
    },
  });

  const result: WeeklyTtoBulkSaveResult = {
    ok: failed.length === 0,
    draftForDayKey,
    weekKey,
    operation: WEEKLY_TTO_BULK_OPERATION,
    audience: audienceIds.length,
    candidates: candidates.length,
    updated,
    skippedMissing,
    skippedNonCurrent,
    skippedBadWeekLinkage,
    skippedSendEvent,
    skippedAmbiguous,
    skippedMissingGeneration,
    failed,
    textsSentByThisAction: 0,
    message: formatWeeklyBulkMessage({
      updated,
      failed: failed.length,
      audience: audienceIds.length,
      candidates: candidates.length,
      skippedMissing,
      skippedNonCurrent,
      skippedBadWeekLinkage,
      skippedSendEvent,
      skippedAmbiguous,
      skippedMissingGeneration,
    }),
  };
  return result;
}
