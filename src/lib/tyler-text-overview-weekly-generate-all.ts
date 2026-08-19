/**
 * Batch Weekly TTO generation — chunked, resumable, missing/incomplete only.
 * Generation only: never sends SMS, never writes send/check events.
 *
 * COMPLETE skip (resume): nonempty current machine body, Tyler protected edit/blank, sent.
 * INCOMPLETE/retryable: OpenAI failure, empty machine body, validator-blocked machine attempt.
 */

import { getClerkUser } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { resolveSmsUserTimezone } from "@/lib/timezone";
import { loadSendableTylerTextOverviewAudienceMembers } from "@/lib/tyler-text-overview-admin";
import {
  classifyTtoGenerateAllMember,
  generateAllSoftFailureError,
  isTtoGenerateAllWorkRemaining,
  runPoolWithBudget,
  TTO_GENERATE_ALL_CHUNK_USER_CAP,
  TTO_GENERATE_ALL_CONCURRENCY,
  TTO_GENERATE_ALL_TIME_BUDGET_MS,
  type TtoGenerateAllFailure,
  type TtoGenerateAllMemberClass,
} from "@/lib/tyler-text-overview-generate-all";
import { loadTylerTextOverviewAudienceRows } from "@/lib/tyler-text-overview-generate";
import {
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
  isTylerTextOverviewEnabled,
} from "@/lib/tyler-text-overview-types";
import { generateTylerTextOverviewWeeklyDraftForUser } from "@/lib/tyler-text-overview-weekly-generate";
import { resolveTylerTextOverviewWeeklyPeriod } from "@/lib/tyler-text-overview-weekly-period";

export const WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY = "missing_only" as const;
export const WEEKLY_TTO_GENERATE_ALL_CHUNK_USER_CAP = TTO_GENERATE_ALL_CHUNK_USER_CAP;
export const WEEKLY_TTO_GENERATE_ALL_CONCURRENCY = TTO_GENERATE_ALL_CONCURRENCY;
export const WEEKLY_TTO_GENERATE_ALL_TIME_BUDGET_MS = TTO_GENERATE_ALL_TIME_BUDGET_MS;

export type WeeklyTtoGenerateAllMode = typeof WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY;

export type WeeklyTtoGenerateAllErrorPreview = {
  clerk_user_id: string;
  week_key?: string;
  reason: string;
  error?: string;
};

export type WeeklyTtoGenerateAllResult = {
  ok: true;
  mode: WeeklyTtoGenerateAllMode;
  scanned: number;
  eligible: number;
  generated: number;
  skipped_existing_current: number;
  skipped_sent: number;
  skipped_already_weekly_event: number;
  skipped_not_eligible: number;
  failed: number;
  week_keys_seen: string[];
  draft_for_day_keys_seen: string[];
  errors_preview: WeeklyTtoGenerateAllErrorPreview[];
};

export type WeeklyTtoGenerateAllChunkResult = {
  ok: boolean;
  sendSlot: typeof SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT;
  targeted: number;
  generated_complete: number;
  protected_complete: number;
  already_sent: number;
  noncurrent: number;
  failed: number;
  pending: number;
  remaining: number;
  processed_this_chunk: number;
  is_complete: boolean;
  audience_clerk_user_ids: string[];
  failures: TtoGenerateAllFailure[];
  generated_this_chunk: number;
  generated: number;
  protectedTylerAuthority: number;
  skippedAlreadySent: number;
  skippedNonCurrent: number;
};

const ERRORS_PREVIEW_MAX = 25;

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

function readMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const raw = metadata[key];
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

function hasNonEmptyPhone(phone: string | null | undefined): boolean {
  return typeof phone === "string" && phone.trim().length > 0;
}

export async function hasSmsWeeklySendEventForUserWeek(args: {
  clerkUserId: string;
  weekKey: string;
}): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("sms_weekly_send_events")
    .select("id")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("week_key", args.weekKey)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`sms_weekly_send_events_lookup_failed:${error.message}`);
  }

  return data != null && typeof (data as { id?: unknown }).id === "string";
}

type WeeklyDraftClassifyRow = {
  clerk_user_id: string;
  status: string;
  current_generation_id: string | null;
  edited_by_tyler: boolean | null;
  current_body_source: string | null;
  current_body_to_send: string | null;
};

export async function findWeeklyReviewDraftForWeek(args: {
  clerkUserId: string;
  weekKey: string;
}): Promise<{
  draft: WeeklyDraftClassifyRow | null;
  machineDraftBody: string | null;
  hasSent: boolean;
}> {
  const { data: draftRows, error: draftError } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(
      "id, status, current_generation_id, edited_by_tyler, current_body_source, current_body_to_send"
    )
    .eq("clerk_user_id", args.clerkUserId)
    .eq("send_slot", SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT)
    .in("status", ["current", "sent"]);

  if (draftError) {
    throw new Error(`weekly_draft_lookup_failed:${draftError.message}`);
  }

  let matched: WeeklyDraftClassifyRow | null = null;
  let machineDraftBody: string | null = null;
  let hasSent = false;

  for (const draftRow of draftRows ?? []) {
    const generationId =
      typeof draftRow.current_generation_id === "string"
        ? draftRow.current_generation_id.trim()
        : "";
    if (!generationId) continue;

    const { data: generationRow, error: generationError } = await supabaseServer
      .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
      .select("id, generation_metadata, machine_draft_body")
      .eq("id", generationId)
      .maybeSingle();

    if (generationError || !generationRow) continue;

    const metadata = asRecord(generationRow.generation_metadata) ?? {};
    const metaWeekKey = readMetadataString(metadata, "week_key");
    if (metaWeekKey !== args.weekKey) continue;

    if (draftRow.status === "sent") hasSent = true;

    const row: WeeklyDraftClassifyRow = {
      clerk_user_id: args.clerkUserId,
      status: typeof draftRow.status === "string" ? draftRow.status : "",
      current_generation_id: generationId,
      edited_by_tyler:
        typeof draftRow.edited_by_tyler === "boolean" ? draftRow.edited_by_tyler : null,
      current_body_source:
        typeof draftRow.current_body_source === "string" ? draftRow.current_body_source : null,
      current_body_to_send:
        typeof draftRow.current_body_to_send === "string" || draftRow.current_body_to_send === null
          ? (draftRow.current_body_to_send as string | null)
          : null,
    };

    if (draftRow.status === "current" && !matched) {
      matched = row;
      machineDraftBody =
        typeof generationRow.machine_draft_body === "string"
          ? generationRow.machine_draft_body
          : null;
    }
  }

  return { draft: matched, machineDraftBody, hasSent };
}

export async function findWeeklyReviewDraftStatusesForWeek(args: {
  clerkUserId: string;
  weekKey: string;
}): Promise<{ hasCurrent: boolean; hasSent: boolean }> {
  const found = await findWeeklyReviewDraftForWeek(args);
  return { hasCurrent: found.draft?.status === "current", hasSent: found.hasSent };
}

export function classifyWeeklyGenerateAllMember(args: {
  draft: WeeklyDraftClassifyRow | null;
  machineDraftBody: string | null | undefined;
  hasWeeklySendEvent?: boolean;
  hasSent?: boolean;
}): TtoGenerateAllMemberClass {
  if (args.hasWeeklySendEvent || args.hasSent) return "already_sent";
  return classifyTtoGenerateAllMember({
    draft: args.draft,
    machineDraftBody: args.machineDraftBody,
  });
}

export type GenerateMissingWeeklyDraftsDeps = {
  loadAudienceRows?: typeof loadTylerTextOverviewAudienceRows;
  getClerkUserFn?: typeof getClerkUser;
  hasWeeklySendEvent?: typeof hasSmsWeeklySendEventForUserWeek;
  findDraftForWeek?: typeof findWeeklyReviewDraftForWeek;
  generateForUser?: typeof generateTylerTextOverviewWeeklyDraftForUser;
};

/**
 * Sequential missing/incomplete generate used by unit tests.
 * Live admin Generate All uses generateWeeklyTtoDraftBatch.
 */
export async function generateMissingWeeklyDraftsForAllSendableUsers(args?: {
  mode?: WeeklyTtoGenerateAllMode;
  now?: Date;
  deps?: GenerateMissingWeeklyDraftsDeps;
}): Promise<WeeklyTtoGenerateAllResult> {
  const mode = args?.mode ?? WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY;
  if (mode !== WEEKLY_TTO_GENERATE_ALL_MODE_MISSING_ONLY) {
    throw new Error(`unsupported_mode:${String(mode)}`);
  }

  if (!isTylerTextOverviewEnabled()) {
    throw new Error("tyler_text_overview_disabled");
  }

  const deps = args?.deps ?? {};
  const loadAudience = deps.loadAudienceRows ?? loadTylerTextOverviewAudienceRows;
  const getClerk = deps.getClerkUserFn ?? getClerkUser;
  const hasEvent = deps.hasWeeklySendEvent ?? hasSmsWeeklySendEventForUserWeek;
  const findDraft = deps.findDraftForWeek ?? findWeeklyReviewDraftForWeek;
  const generateForUser = deps.generateForUser ?? generateTylerTextOverviewWeeklyDraftForUser;
  const now = args?.now ?? new Date();

  const audience = await loadAudience();
  const weekKeysSeen = new Set<string>();
  const draftForDayKeysSeen = new Set<string>();
  const errorsPreview: WeeklyTtoGenerateAllErrorPreview[] = [];

  let scanned = 0;
  let generated = 0;
  let skippedExistingCurrent = 0;
  let skippedSent = 0;
  let skippedAlreadyWeeklyEvent = 0;
  let skippedNotEligible = 0;
  let failed = 0;

  function pushError(entry: WeeklyTtoGenerateAllErrorPreview) {
    if (errorsPreview.length < ERRORS_PREVIEW_MAX) {
      errorsPreview.push(entry);
    }
  }

  for (const row of audience) {
    scanned += 1;
    const clerkUserId = row.clerk_user_id.trim();

    if (!hasNonEmptyPhone(row.phone_number)) {
      skippedNotEligible += 1;
      continue;
    }

    let weekKey = "";
    let draftForDayKey = "";

    try {
      const user = await getClerk(clerkUserId);
      const md = (user.public_metadata ?? {}) as Record<string, unknown>;
      const tzResolved = resolveSmsUserTimezone({
        clerkMetadataTimezone: md.timezone,
        audienceTimezone: row.timezone,
      });
      const period = resolveTylerTextOverviewWeeklyPeriod({
        now,
        timezone: tzResolved.timezone,
      });
      weekKey = period.weekKey;
      draftForDayKey = period.draftForDayKey;
      weekKeysSeen.add(weekKey);
      draftForDayKeysSeen.add(draftForDayKey);
    } catch (e) {
      failed += 1;
      pushError({
        clerk_user_id: clerkUserId,
        reason: "clerk_or_period_failed",
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    try {
      if (await hasEvent({ clerkUserId, weekKey })) {
        skippedAlreadyWeeklyEvent += 1;
        continue;
      }

      const found = await findDraft({ clerkUserId, weekKey });
      const classification = classifyWeeklyGenerateAllMember({
        draft: found.draft,
        machineDraftBody: found.machineDraftBody,
        hasSent: found.hasSent,
      });
      if (classification === "already_sent") {
        skippedSent += 1;
        continue;
      }
      if (!isTtoGenerateAllWorkRemaining(classification)) {
        skippedExistingCurrent += 1;
        continue;
      }
    } catch (e) {
      failed += 1;
      pushError({
        clerk_user_id: clerkUserId,
        week_key: weekKey,
        reason: "skip_lookup_failed",
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    try {
      const result = await generateForUser({ clerkUserId, now });
      if (result.ok && result.currentDraftProtected === true) {
        skippedExistingCurrent += 1;
        continue;
      }
      if (result.ok) {
        const softError = generateAllSoftFailureError({
          body: result.machineDraftBody,
          machineNoSendReason: result.machineNoSendReason,
        });
        if (softError) {
          failed += 1;
          pushError({
            clerk_user_id: clerkUserId,
            week_key: weekKey,
            reason: "generation_incomplete",
            error: softError,
          });
          continue;
        }
        generated += 1;
        weekKeysSeen.add(result.weekKey);
        draftForDayKeysSeen.add(result.draftForDayKey);
        continue;
      }

      if (
        result.reason === "audience" ||
        result.reason === "comms_prefs" ||
        result.reason === "not_v2" ||
        result.reason === "no_commitment" ||
        result.reason === "disabled"
      ) {
        skippedNotEligible += 1;
        continue;
      }

      failed += 1;
      pushError({
        clerk_user_id: clerkUserId,
        week_key: weekKey,
        reason: result.reason,
        error: result.error,
      });
    } catch (e) {
      failed += 1;
      pushError({
        clerk_user_id: clerkUserId,
        week_key: weekKey,
        reason: "generate_threw",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const eligible = scanned - skippedNotEligible;

  return {
    ok: true,
    mode,
    scanned,
    eligible,
    generated,
    skipped_existing_current: skippedExistingCurrent,
    skipped_sent: skippedSent,
    skipped_already_weekly_event: skippedAlreadyWeeklyEvent,
    skipped_not_eligible: skippedNotEligible,
    failed,
    week_keys_seen: [...weekKeysSeen].sort(),
    draft_for_day_keys_seen: [...draftForDayKeysSeen].sort(),
    errors_preview: errorsPreview,
  };
}

function parseFrozenAudienceIds(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") return null;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function parseWeeklyGenerateAllRequestBody(body: unknown): {
  audienceClerkUserIds: string[] | null;
  excludeClerkUserIds: string[] | null;
} | { error: string } {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { audienceClerkUserIds: null, excludeClerkUserIds: null };
  }
  const record = body as Record<string, unknown>;
  const audienceClerkUserIds = parseFrozenAudienceIds(
    record.audience_clerk_user_ids ?? record.audienceClerkUserIds
  );
  if (
    record.audience_clerk_user_ids != null &&
    audienceClerkUserIds == null
  ) {
    return { error: "Invalid audience_clerk_user_ids" };
  }
  const excludeClerkUserIds = parseFrozenAudienceIds(
    record.exclude_clerk_user_ids ?? record.excludeClerkUserIds
  );
  if (
    (record.exclude_clerk_user_ids != null || record.excludeClerkUserIds != null) &&
    excludeClerkUserIds == null
  ) {
    return { error: "Invalid exclude_clerk_user_ids" };
  }
  return { audienceClerkUserIds, excludeClerkUserIds };
}

async function classifyWeeklyFrozenAudience(args: {
  clerkUserIds: string[];
  now: Date;
  liveById: Map<
    string,
    { clerkUserId: string; timezone: string | null; preferredName: string | null }
  >;
}): Promise<Map<string, TtoGenerateAllMemberClass>> {
  const classes = new Map<string, TtoGenerateAllMemberClass>();
  for (const id of args.clerkUserIds) {
    const member = args.liveById.get(id);
    const timezone = resolveSmsUserTimezone({
      clerkMetadataTimezone: null,
      audienceTimezone: member?.timezone ?? null,
    }).timezone;
    const period = resolveTylerTextOverviewWeeklyPeriod({
      now: args.now,
      timezone,
    });
    const hasEvent = await hasSmsWeeklySendEventForUserWeek({
      clerkUserId: id,
      weekKey: period.weekKey,
    });
    const found = await findWeeklyReviewDraftForWeek({
      clerkUserId: id,
      weekKey: period.weekKey,
    });
    classes.set(
      id,
      classifyWeeklyGenerateAllMember({
        draft: found.draft,
        machineDraftBody: found.machineDraftBody,
        hasWeeklySendEvent: hasEvent,
        hasSent: found.hasSent,
      })
    );
  }
  return classes;
}

function summarizeWeeklyClasses(
  clerkUserIds: string[],
  classes: Map<string, TtoGenerateAllMemberClass>
): {
  generated_complete: number;
  protected_complete: number;
  already_sent: number;
  noncurrent: number;
  failed: number;
  pending: number;
  remaining: number;
} {
  let generated_complete = 0;
  let protected_complete = 0;
  let already_sent = 0;
  let noncurrent = 0;
  let failed = 0;
  let pending = 0;
  for (const id of clerkUserIds) {
    const c = classes.get(id) ?? "pending";
    if (c === "generated_complete") generated_complete += 1;
    else if (c === "protected_complete") protected_complete += 1;
    else if (c === "already_sent") already_sent += 1;
    else if (c === "noncurrent") noncurrent += 1;
    else if (c === "failed_or_incomplete") failed += 1;
    else pending += 1;
  }
  return {
    generated_complete,
    protected_complete,
    already_sent,
    noncurrent,
    failed,
    pending,
    remaining: pending + failed,
  };
}

export async function generateWeeklyTtoDraftBatch(args?: {
  now?: Date;
  audienceClerkUserIds?: string[] | null;
  excludeClerkUserIds?: string[] | null;
  chunkUserCap?: number;
  concurrency?: number;
  timeBudgetMs?: number;
  nowMs?: () => number;
}): Promise<WeeklyTtoGenerateAllChunkResult | { ok: false; error: string; status: number }> {
  if (!isTylerTextOverviewEnabled()) {
    return { ok: false, error: "tyler_text_overview_disabled", status: 503 };
  }

  const now = args?.now ?? new Date();
  const chunkCap = args?.chunkUserCap ?? WEEKLY_TTO_GENERATE_ALL_CHUNK_USER_CAP;
  const concurrency = args?.concurrency ?? WEEKLY_TTO_GENERATE_ALL_CONCURRENCY;
  const timeBudgetMs = args?.timeBudgetMs ?? WEEKLY_TTO_GENERATE_ALL_TIME_BUDGET_MS;
  const nowMs = args?.nowMs ?? (() => Date.now());
  const startedMs = nowMs();

  let liveAudience: Array<{
    clerkUserId: string;
    timezone: string | null;
    preferredName: string | null;
  }>;
  try {
    liveAudience = await loadSendableTylerTextOverviewAudienceMembers(now);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "audience_load_failed",
      status: 500,
    };
  }

  const liveById = new Map(liveAudience.map((m) => [m.clerkUserId, m]));

  let audienceClerkUserIds = args?.audienceClerkUserIds?.filter((id) => id.trim()) ?? null;
  if (!audienceClerkUserIds || audienceClerkUserIds.length === 0) {
    audienceClerkUserIds = liveAudience.map((m) => m.clerkUserId);
  }

  const exclude = new Set(
    (args?.excludeClerkUserIds ?? []).map((id) => id.trim()).filter(Boolean)
  );

  let classes: Map<string, TtoGenerateAllMemberClass>;
  try {
    classes = await classifyWeeklyFrozenAudience({
      clerkUserIds: audienceClerkUserIds,
      now,
      liveById,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "classify_failed",
      status: 500,
    };
  }

  const workQueue: string[] = [];
  for (const id of audienceClerkUserIds) {
    const c = classes.get(id) ?? "pending";
    if (!isTtoGenerateAllWorkRemaining(c)) continue;
    if (exclude.has(id)) continue;
    workQueue.push(id);
    if (workQueue.length >= chunkCap) break;
  }

  const failures: TtoGenerateAllFailure[] = [];
  let generatedThisChunk = 0;

  const { results, started } = await runPoolWithBudget({
    items: workQueue,
    concurrency,
    shouldStop: () => nowMs() - startedMs >= timeBudgetMs,
    worker: async (clerkUserId) => {
      const member = liveById.get(clerkUserId) ?? null;
      try {
        const result = await generateTylerTextOverviewWeeklyDraftForUser({
          clerkUserId,
          now,
        });
        if (!result.ok) {
          return {
            clerkUserId,
            member,
            outcome: { ok: false as const, error: result.error ?? result.reason },
          };
        }
        if (result.currentDraftProtected === true) {
          return { clerkUserId, member, outcome: { ok: true as const } };
        }
        const softError = generateAllSoftFailureError({
          body: result.machineDraftBody,
          machineNoSendReason: result.machineNoSendReason,
        });
        if (softError) {
          return { clerkUserId, member, outcome: { ok: false as const, error: softError } };
        }
        return { clerkUserId, member, outcome: { ok: true as const } };
      } catch (err) {
        return {
          clerkUserId,
          member,
          outcome: {
            ok: false as const,
            error: err instanceof Error ? err.message : String(err),
          },
        };
      }
    },
  });

  for (const item of results) {
    if (!item) continue;
    if (item.outcome.ok) {
      generatedThisChunk += 1;
    } else {
      failures.push({
        clerkUserId: item.clerkUserId,
        preferredName: item.member?.preferredName ?? null,
        error: item.outcome.error,
      });
    }
  }

  try {
    classes = await classifyWeeklyFrozenAudience({
      clerkUserIds: audienceClerkUserIds,
      now,
      liveById,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "reclassify_failed",
      status: 500,
    };
  }

  const summary = summarizeWeeklyClasses(audienceClerkUserIds, classes);

  return {
    ok: failures.length === 0,
    sendSlot: SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
    targeted: audienceClerkUserIds.length,
    generated_complete: summary.generated_complete,
    protected_complete: summary.protected_complete,
    already_sent: summary.already_sent,
    noncurrent: summary.noncurrent,
    failed: summary.failed,
    pending: summary.pending,
    remaining: summary.remaining,
    processed_this_chunk: started,
    is_complete: summary.remaining === 0,
    audience_clerk_user_ids: audienceClerkUserIds,
    failures,
    generated_this_chunk: generatedThisChunk,
    generated: generatedThisChunk,
    protectedTylerAuthority: summary.protected_complete,
    skippedAlreadySent: summary.already_sent,
    skippedNonCurrent: summary.noncurrent,
  };
}
