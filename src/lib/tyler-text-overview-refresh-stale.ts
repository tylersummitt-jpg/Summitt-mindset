import {
  generateTylerTextOverviewDraftForUser,
  loadTylerTextOverviewAudienceRow,
  type TylerTextOverviewAudienceRow,
} from "@/lib/tyler-text-overview-generate";
import { supabaseServer } from "@/lib/supabase-server";
import {
  isTylerTextOverviewEnabled,
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  type TylerTextOverviewGenerationReason,
  type TylerTextOverviewRefreshStaleStats,
} from "@/lib/tyler-text-overview-types";

export const TYLER_TEXT_OVERVIEW_STALE_REFRESH_MAX_ROWS = 200 as const;

export const TYLER_TEXT_OVERVIEW_STALE_REFRESH_REASONS = [
  "evening_sweep",
  "pre_send_stale_refresh",
] as const satisfies ReadonlyArray<TylerTextOverviewGenerationReason>;

export type TylerTextOverviewStaleRefreshReason =
  (typeof TYLER_TEXT_OVERVIEW_STALE_REFRESH_REASONS)[number];

export function parseTylerTextOverviewStaleRefreshReason(
  raw: string | null | undefined
): TylerTextOverviewStaleRefreshReason {
  if (raw === "pre_send_stale_refresh") return "pre_send_stale_refresh";
  return "evening_sweep";
}

type CurrentDraftRow = {
  id: string;
  clerk_user_id: string;
  draft_for_day_key: string;
  current_generation_id: string;
  status: string;
};

type GenerationSnapshot = {
  id: string;
  generated_at: string;
  machine_draft_body: string | null;
};

export type TylerTextOverviewStaleDraftCandidate = {
  draftId: string;
  clerkUserId: string;
  draftForDayKey: string;
  currentGenerationId: string;
  generatedAt: string;
  priorMachineDraftBody: string | null;
};

function emptyStats(
  overrides: Partial<TylerTextOverviewRefreshStaleStats> = {}
): TylerTextOverviewRefreshStaleStats {
  return {
    ok: true,
    enabled: false,
    generation_reason: "evening_sweep",
    current_drafts_scanned: 0,
    stale_found: 0,
    refreshed: 0,
    skipped_not_stale: 0,
    skipped_audience: 0,
    skipped_not_v2: 0,
    skipped_comms_prefs: 0,
    build_failed: 0,
    insert_failed: 0,
    upsert_failed: 0,
    supersede_failed: 0,
    capped: false,
    errors_preview: [],
    ...overrides,
  };
}

async function loadCurrentDraftRows(): Promise<CurrentDraftRow[]> {
  const { data, error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select("id, clerk_user_id, draft_for_day_key, current_generation_id, status")
    .eq("status", "current");

  if (error) {
    throw new Error(`current_drafts_query_failed:${error.message}`);
  }

  return (data ?? []).filter(
    (row): row is CurrentDraftRow =>
      typeof row.id === "string" &&
      typeof row.clerk_user_id === "string" &&
      typeof row.draft_for_day_key === "string" &&
      typeof row.current_generation_id === "string" &&
      row.status === "current"
  );
}

async function loadGenerationSnapshot(generationId: string): Promise<GenerationSnapshot | null> {
  const { data, error } = await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .select("id, generated_at, machine_draft_body")
    .eq("id", generationId)
    .maybeSingle();

  if (error) {
    throw new Error(`generation_lookup_failed:${error.message}`);
  }

  if (!data || typeof data.id !== "string" || typeof data.generated_at !== "string") {
    return null;
  }

  return {
    id: data.id,
    generated_at: data.generated_at,
    machine_draft_body:
      typeof data.machine_draft_body === "string" ? data.machine_draft_body : null,
  };
}

async function hasInboundAfterGeneration(args: {
  clerkUserId: string;
  generatedAt: string;
}): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("sms_inbound_messages")
    .select("received_at")
    .eq("clerk_user_id", args.clerkUserId)
    .gt("received_at", args.generatedAt)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`inbound_stale_check_failed:${error.message}`);
  }

  return typeof data?.received_at === "string";
}

export async function findStaleTylerTextOverviewCurrentDrafts(): Promise<
  TylerTextOverviewStaleDraftCandidate[]
> {
  const currentDrafts = await loadCurrentDraftRows();
  const stale: TylerTextOverviewStaleDraftCandidate[] = [];

  for (const draft of currentDrafts) {
    const generation = await loadGenerationSnapshot(draft.current_generation_id);
    if (!generation || generation.id !== draft.current_generation_id) {
      continue;
    }

    const inboundAfter = await hasInboundAfterGeneration({
      clerkUserId: draft.clerk_user_id,
      generatedAt: generation.generated_at,
    });
    if (!inboundAfter) {
      continue;
    }

    stale.push({
      draftId: draft.id,
      clerkUserId: draft.clerk_user_id,
      draftForDayKey: draft.draft_for_day_key,
      currentGenerationId: draft.current_generation_id,
      generatedAt: generation.generated_at,
      priorMachineDraftBody: generation.machine_draft_body,
    });
  }

  return stale;
}

export async function refreshStaleTylerTextOverviewDrafts(args: {
  now?: Date;
  generationReason?: TylerTextOverviewStaleRefreshReason;
} = {}): Promise<TylerTextOverviewRefreshStaleStats> {
  const generationReason = args.generationReason ?? "evening_sweep";

  if (!isTylerTextOverviewEnabled()) {
    return emptyStats({ generation_reason: generationReason });
  }

  const now = args.now ?? new Date();
  const stats = emptyStats({ enabled: true, generation_reason: generationReason });
  const errors: string[] = [];

  let currentDrafts: CurrentDraftRow[];
  try {
    currentDrafts = await loadCurrentDraftRows();
  } catch (e) {
    stats.ok = false;
    stats.errors_preview.push(
      e instanceof Error ? e.message : "current_drafts_query_failed"
    );
    return stats;
  }

  stats.current_drafts_scanned = currentDrafts.length;

  const staleCandidates: TylerTextOverviewStaleDraftCandidate[] = [];
  for (const draft of currentDrafts) {
    const generation = await loadGenerationSnapshot(draft.current_generation_id);
    if (!generation || generation.id !== draft.current_generation_id) {
      stats.skipped_not_stale += 1;
      continue;
    }

    let inboundAfter = false;
    try {
      inboundAfter = await hasInboundAfterGeneration({
        clerkUserId: draft.clerk_user_id,
        generatedAt: generation.generated_at,
      });
    } catch (e) {
      stats.ok = false;
      errors.push(
        `${draft.clerk_user_id}:inbound_check:${e instanceof Error ? e.message : String(e)}`
      );
      continue;
    }

    if (!inboundAfter) {
      stats.skipped_not_stale += 1;
      continue;
    }

    staleCandidates.push({
      draftId: draft.id,
      clerkUserId: draft.clerk_user_id,
      draftForDayKey: draft.draft_for_day_key,
      currentGenerationId: draft.current_generation_id,
      generatedAt: generation.generated_at,
      priorMachineDraftBody: generation.machine_draft_body,
    });
  }

  stats.stale_found = staleCandidates.length;

  const toRefresh =
    staleCandidates.length > TYLER_TEXT_OVERVIEW_STALE_REFRESH_MAX_ROWS
      ? staleCandidates.slice(0, TYLER_TEXT_OVERVIEW_STALE_REFRESH_MAX_ROWS)
      : staleCandidates;

  if (staleCandidates.length > TYLER_TEXT_OVERVIEW_STALE_REFRESH_MAX_ROWS) {
    stats.capped = true;
  }

  for (const candidate of toRefresh) {
    let audienceUser: TylerTextOverviewAudienceRow | null;
    try {
      audienceUser = await loadTylerTextOverviewAudienceRow(candidate.clerkUserId);
    } catch (e) {
      stats.ok = false;
      errors.push(
        `${candidate.clerkUserId}:audience:${e instanceof Error ? e.message : String(e)}`
      );
      continue;
    }

    if (!audienceUser) {
      stats.skipped_audience += 1;
      continue;
    }

    try {
      const result = await generateTylerTextOverviewDraftForUser({
        audienceUser,
        now,
        draftForDayKey: candidate.draftForDayKey,
        generationReason,
      });

      if (!result.ok) {
        if (result.reason === "comms_prefs") {
          stats.skipped_comms_prefs += 1;
        } else if (result.reason === "not_v2") {
          stats.skipped_not_v2 += 1;
        } else if (result.reason === "insert_failed") {
          stats.insert_failed += 1;
          if (result.error) errors.push(`${candidate.clerkUserId}:insert:${result.error}`);
        } else if (result.reason === "upsert_failed") {
          stats.upsert_failed += 1;
          if (result.error) errors.push(`${candidate.clerkUserId}:upsert:${result.error}`);
        } else {
          stats.build_failed += 1;
          if (result.error) errors.push(`${candidate.clerkUserId}:build:${result.error}`);
        }
        continue;
      }

      stats.refreshed += 1;
      if (result.supersedeFailed) {
        stats.supersede_failed += 1;
      }
    } catch (e) {
      stats.build_failed += 1;
      errors.push(
        `${candidate.clerkUserId}:unexpected:${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  stats.errors_preview = errors.slice(0, 20);
  return stats;
}
