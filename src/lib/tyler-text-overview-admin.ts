import { supabaseServer } from "@/lib/supabase-server";
import {
  deriveNotebookDisplayMode,
  deriveNotebookFamily,
} from "@/lib/tyler-text-overview-notebook-display";
import type { TylerTextOverviewWriterOpenAiMessage } from "@/lib/tyler-text-overview-writer-capture";
import {
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  type TylerTextOverviewAdminDraftRow,
} from "@/lib/tyler-text-overview-types";
import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";

type DraftDbRow = {
  id: string;
  clerk_user_id: string;
  draft_for_day_key: string;
  current_generation_id: string;
  current_body_to_send: string | null;
  status: string;
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
};

type LatestGenerationRef = {
  id: string;
  generation_number: number;
};

const WRITER_MESSAGE_ROLES = new Set(["system", "user", "assistant"]);

const GENERATION_SELECT_COLUMNS =
  "id, generation_number, writer_openai_messages, writer_prompt_path, machine_draft_body, machine_should_send, machine_no_send_reason, notebook_hash, generation_metadata, route_kind, clerk_user_id, draft_for_day_key";

function draftLatestGenKey(clerkUserId: string, draftForDayKey: string): string {
  return `${clerkUserId}:${draftForDayKey}`;
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
  };
}

export function mapDraftRowsToAdminDto(args: {
  drafts: DraftDbRow[];
  generationsById: Map<string, GenerationDbRow>;
  latestGenerationsByKey?: Map<string, LatestGenerationRef>;
}): TylerTextOverviewAdminDraftRow[] {
  return args.drafts.map((draft) => {
    const generation = args.generationsById.get(draft.current_generation_id);
    const notebookFields = mapGenerationToNotebookFields(generation);
    const latestKey = draftLatestGenKey(draft.clerk_user_id, draft.draft_for_day_key);
    const latest = args.latestGenerationsByKey?.get(latestKey) ?? null;

    return {
      draftId: draft.id,
      clerkUserId: draft.clerk_user_id,
      draftForDayKey: draft.draft_for_day_key,
      currentBodyToSend: draft.current_body_to_send,
      ...notebookFields,
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
    drafts.map((d) => draftLatestGenKey(d.clerk_user_id, d.draft_for_day_key))
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
    const key = draftLatestGenKey(row.clerk_user_id, row.draft_for_day_key);
    if (!allowedKeys.has(key)) continue;

    const existing = bestByKey.get(key);
    if (!existing || row.generation_number > existing.generation_number) {
      bestByKey.set(key, { id: row.id, generation_number: row.generation_number });
    }
  }

  return bestByKey;
}

async function fetchLatestGenerationsForDrafts(
  drafts: DraftDbRow[]
): Promise<Map<string, LatestGenerationRef>> {
  if (drafts.length === 0) return new Map();

  const clerkUserIds = [...new Set(drafts.map((d) => d.clerk_user_id))];
  const draftForDayKeys = [...new Set(drafts.map((d) => d.draft_for_day_key))];

  const { data: generationRows, error } = await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .select("id, clerk_user_id, draft_for_day_key, generation_number")
    .in("clerk_user_id", clerkUserIds)
    .in("draft_for_day_key", draftForDayKeys);

  if (error) {
    throw new Error(`tyler_text_overview_latest_generations_failed:${error.message}`);
  }

  return buildLatestGenerationsByKey((generationRows ?? []) as GenerationDbRow[], drafts);
}

export async function listCurrentTylerTextOverviewDrafts(args?: {
  draftForDayKey?: string | null;
}): Promise<TylerTextOverviewAdminDraftRow[]> {
  let query = supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select("id, clerk_user_id, draft_for_day_key, current_generation_id, current_body_to_send, status")
    .eq("status", "current")
    .order("draft_for_day_key", { ascending: false })
    .order("clerk_user_id", { ascending: true });

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
    fetchLatestGenerationsForDrafts(drafts),
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
    .select("id, clerk_user_id, draft_for_day_key, current_generation_id, current_body_to_send, status")
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
    .select("id, clerk_user_id, draft_for_day_key, current_generation_id, current_body_to_send, status")
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

  const latestGenerationsByKey = await fetchLatestGenerationsForDrafts([updatedRow as DraftDbRow]);

  return {
    ok: true,
    row: mapDraftRowsToAdminDto({
      drafts: [updatedRow as DraftDbRow],
      generationsById: new Map([[generation.id, generation]]),
      latestGenerationsByKey,
    })[0],
  };
}
