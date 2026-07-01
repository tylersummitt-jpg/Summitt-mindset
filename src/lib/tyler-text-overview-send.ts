import type { DailySmsBuilt } from "@/lib/daily-sms-build";
import { supabaseServer } from "@/lib/supabase-server";
import {
  isTylerTextOverviewEnabled,
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  type TylerTextOverviewCurrentBodySource,
  type TylerTextOverviewSendMetadata,
  type TylerTextOverviewSendSource,
} from "@/lib/tyler-text-overview-types";
import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";

const MAIN_ACCOUNTABILITY_ROUTE_KIND = "main_active_accountability";

type DraftRow = {
  id: string;
  clerk_user_id: string;
  draft_for_day_key: string;
  current_generation_id: string;
  current_body_to_send: string | null;
  current_body_source: string;
  edited_by_tyler: boolean;
  machine_body_hash: string | null;
  current_body_hash: string | null;
  status: string;
};

type GenerationRow = {
  id: string;
  generated_at: string;
  machine_body_hash: string | null;
  notebook_verdict: string | null;
  notebook_verdict_reason: string | null;
  route_kind: string | null;
};

export type TylerTextOverviewDraftForSendResult = {
  usable: boolean;
  send_source: TylerTextOverviewSendSource;
  draft_id: string | null;
  generation_id: string | null;
  draft_for_day_key: string;
  current_body_to_send: string | null;
  current_body_source: TylerTextOverviewCurrentBodySource | null;
  edited_by_tyler: boolean;
  machine_body_hash: string | null;
  current_body_hash: string | null;
  notebook_verdict_at_generation: string | null;
  notebook_verdict_reason_at_generation: string | null;
  route_kind: string | null;
  stale: boolean;
  stale_reason: string | null;
};

export type TylerTextOverviewSendContext = {
  considered: boolean;
  draftBodyUsed: boolean;
  lookup: TylerTextOverviewDraftForSendResult;
  metadataBlock: TylerTextOverviewSendMetadata | null;
};

function trimBody(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function fallbackResult(args: {
  draftForDayKey: string;
  send_source: TylerTextOverviewSendSource;
  stale?: boolean;
  stale_reason?: string | null;
  draft_id?: string | null;
  generation_id?: string | null;
}): TylerTextOverviewDraftForSendResult {
  return {
    usable: false,
    send_source: args.send_source,
    draft_id: args.draft_id ?? null,
    generation_id: args.generation_id ?? null,
    draft_for_day_key: args.draftForDayKey,
    current_body_to_send: null,
    current_body_source: null,
    edited_by_tyler: false,
    machine_body_hash: null,
    current_body_hash: null,
    notebook_verdict_at_generation: null,
    notebook_verdict_reason_at_generation: null,
    route_kind: null,
    stale: args.stale ?? false,
    stale_reason: args.stale_reason ?? null,
  };
}

async function fetchLatestInboundAfter(args: {
  clerkUserId: string;
  afterIso: string;
}): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("sms_inbound_messages")
    .select("received_at")
    .eq("clerk_user_id", args.clerkUserId)
    .gt("received_at", args.afterIso)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`tyler_text_overview_inbound_stale_check_failed:${error.message}`);
  }

  const receivedAt = data?.received_at;
  return typeof receivedAt === "string" ? receivedAt : null;
}

export async function loadUsableTylerTextOverviewDraftForSend(args: {
  clerkUserId: string;
  draftForDayKey: string;
  now?: Date;
}): Promise<TylerTextOverviewDraftForSendResult> {
  const draftForDayKey = args.draftForDayKey.trim();
  const clerkUserId = args.clerkUserId.trim();

  if (!isTylerTextOverviewEnabled()) {
    return fallbackResult({
      draftForDayKey,
      send_source: "live_fallback_no_draft",
    });
  }

  const { data: draftRow, error: draftError } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(
      "id, clerk_user_id, draft_for_day_key, current_generation_id, current_body_to_send, current_body_source, edited_by_tyler, machine_body_hash, current_body_hash, status"
    )
    .eq("clerk_user_id", clerkUserId)
    .eq("draft_for_day_key", draftForDayKey)
    .eq("status", "current")
    .maybeSingle();

  if (draftError) {
    return fallbackResult({
      draftForDayKey,
      send_source: "live_fallback_error",
      stale_reason: draftError.message,
    });
  }

  if (!draftRow) {
    return fallbackResult({
      draftForDayKey,
      send_source: "live_fallback_no_draft",
    });
  }

  const draft = draftRow as DraftRow;

  const { data: generationRow, error: generationError } = await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .select(
      "id, generated_at, machine_body_hash, notebook_verdict, notebook_verdict_reason, route_kind"
    )
    .eq("id", draft.current_generation_id)
    .maybeSingle();

  if (generationError) {
    return fallbackResult({
      draftForDayKey,
      send_source: "live_fallback_error",
      draft_id: draft.id,
      stale_reason: generationError.message,
    });
  }

  if (!generationRow) {
    return fallbackResult({
      draftForDayKey,
      send_source: "live_fallback_error",
      draft_id: draft.id,
    });
  }

  const generation = generationRow as GenerationRow;
  const body = trimBody(draft.current_body_to_send);

  const baseFields = {
    draft_id: draft.id,
    generation_id: generation.id,
    draft_for_day_key: draftForDayKey,
    current_body_to_send: body,
    current_body_source:
      draft.current_body_source === "machine" ||
      draft.current_body_source === "tyler_edit" ||
      draft.current_body_source === "live_fallback"
        ? (draft.current_body_source as TylerTextOverviewCurrentBodySource)
        : null,
    edited_by_tyler: Boolean(draft.edited_by_tyler),
    machine_body_hash:
      typeof draft.machine_body_hash === "string"
        ? draft.machine_body_hash
        : typeof generation.machine_body_hash === "string"
          ? generation.machine_body_hash
          : null,
    current_body_hash: typeof draft.current_body_hash === "string" ? draft.current_body_hash : null,
    notebook_verdict_at_generation:
      typeof generation.notebook_verdict === "string" ? generation.notebook_verdict : null,
    notebook_verdict_reason_at_generation:
      typeof generation.notebook_verdict_reason === "string"
        ? generation.notebook_verdict_reason
        : null,
    route_kind: typeof generation.route_kind === "string" ? generation.route_kind : null,
  };

  if (!body) {
    return {
      usable: false,
      send_source: "live_fallback_empty_body",
      stale: false,
      stale_reason: null,
      ...baseFields,
    };
  }

  if (
    baseFields.route_kind != null &&
    baseFields.route_kind !== MAIN_ACCOUNTABILITY_ROUTE_KIND
  ) {
    return {
      usable: false,
      send_source: "live_fallback_special_branch",
      stale: false,
      stale_reason: null,
      ...baseFields,
    };
  }

  let stale = false;
  let staleReason: string | null = null;
  try {
    const inboundAfter = await fetchLatestInboundAfter({
      clerkUserId,
      afterIso: generation.generated_at,
    });
    if (inboundAfter) {
      stale = true;
      staleReason = "inbound_received_after_generation";
    }
  } catch (err) {
    return {
      usable: false,
      send_source: "live_fallback_error",
      stale: false,
      stale_reason: err instanceof Error ? err.message : "inbound_stale_check_failed",
      ...baseFields,
    };
  }

  if (stale) {
    return {
      usable: false,
      send_source: "live_fallback_stale",
      stale: true,
      stale_reason: staleReason,
      ...baseFields,
    };
  }

  const send_source: TylerTextOverviewSendSource =
    draft.current_body_source === "tyler_edit" || draft.edited_by_tyler
      ? "tyler_edit"
      : "machine_draft";

  return {
    usable: true,
    send_source,
    stale: false,
    stale_reason: null,
    ...baseFields,
  };
}

export function isDailySmsBuiltSpecialBranch(
  built: DailySmsBuilt
): boolean {
  if (!built.ok) return false;
  return Boolean(
    built.v2RefreshOutboundPlan ||
      built.v2ReactivationNudge ||
      built.v2PendingResolutionReminder ||
      built.v2ContractProposalMode
  );
}

export function shouldApplyTylerTextOverviewDraftOverlay(args: {
  lookup: TylerTextOverviewDraftForSendResult;
  builtRaw: DailySmsBuilt;
}): boolean {
  if (!args.lookup.usable || !args.lookup.current_body_to_send) return false;
  if (!args.builtRaw.ok) return false;
  if (isDailySmsBuiltSpecialBranch(args.builtRaw)) return false;
  if (
    args.lookup.route_kind != null &&
    args.lookup.route_kind !== MAIN_ACCOUNTABILITY_ROUTE_KIND
  ) {
    return false;
  }
  return true;
}

export function applyTylerTextOverviewDraftBodyToBuilt(
  built: Extract<DailySmsBuilt, { ok: true }>,
  body: string
): Extract<DailySmsBuilt, { ok: true }> {
  return { ...built, smsBody: body.trim() };
}

export function resolveTylerTextOverviewEffectiveSendSource(args: {
  lookup: TylerTextOverviewDraftForSendResult;
  builtRaw: DailySmsBuilt;
  draftBodyUsed: boolean;
}): TylerTextOverviewSendSource {
  if (args.draftBodyUsed) {
    return args.lookup.send_source === "tyler_edit" ? "tyler_edit" : "machine_draft";
  }
  if (!args.lookup.usable) {
    return args.lookup.send_source;
  }
  if (shouldApplyTylerTextOverviewDraftOverlay(args)) {
    return args.lookup.send_source;
  }
  return "live_fallback_special_branch";
}

export function buildTylerTextOverviewSendMetadata(args: {
  lookup: TylerTextOverviewDraftForSendResult;
  effectiveSendSource: TylerTextOverviewSendSource;
  finalBodySent?: string | null;
}): TylerTextOverviewSendMetadata {
  const finalHash =
    args.finalBodySent && args.finalBodySent.trim()
      ? hashSmsSnippet(args.finalBodySent.trim())
      : null;

  return {
    enabled: true,
    draft_id: args.lookup.draft_id,
    generation_id: args.lookup.generation_id,
    draft_for_day_key: args.lookup.draft_for_day_key,
    send_source: args.effectiveSendSource,
    edited_by_tyler: args.lookup.edited_by_tyler,
    machine_body_hash: args.lookup.machine_body_hash,
    current_body_hash: args.lookup.current_body_hash,
    final_body_sent_hash: finalHash,
    notebook_verdict_at_generation: args.lookup.notebook_verdict_at_generation,
    notebook_verdict_reason_at_generation: args.lookup.notebook_verdict_reason_at_generation,
    stale: args.lookup.stale,
    stale_reason: args.lookup.stale_reason,
  };
}

export function mergeTylerTextOverviewSendMetadata(
  metadata: Record<string, unknown>,
  block: TylerTextOverviewSendMetadata | null
): Record<string, unknown> {
  if (!block) return metadata;
  return { ...metadata, tyler_text_overview: block };
}

export function buildTylerTextOverviewSendContext(args: {
  lookup: TylerTextOverviewDraftForSendResult;
  builtRaw: DailySmsBuilt;
  draftBodyUsed: boolean;
  finalBodySent?: string | null;
}): TylerTextOverviewSendContext | null {
  if (!isTylerTextOverviewEnabled()) return null;

  const effectiveSendSource = resolveTylerTextOverviewEffectiveSendSource({
    lookup: args.lookup,
    builtRaw: args.builtRaw,
    draftBodyUsed: args.draftBodyUsed,
  });

  return {
    considered: true,
    draftBodyUsed: args.draftBodyUsed,
    lookup: args.lookup,
    metadataBlock: buildTylerTextOverviewSendMetadata({
      lookup: args.lookup,
      effectiveSendSource,
      finalBodySent: args.finalBodySent ?? null,
    }),
  };
}

async function resolveSmsSendEventIdForDay(args: {
  clerkUserId: string;
  dayKey: string;
}): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("sms_send_events")
    .select("id")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("day_key", args.dayKey)
    .maybeSingle();

  if (error) {
    console.warn("[tyler-text-overview-send] sms_send_events id lookup failed", {
      clerk_user_id: args.clerkUserId,
      day_key: args.dayKey,
      message: error.message,
    });
    return null;
  }

  if (data?.id == null) return null;
  return String(data.id);
}

export async function finalizeTylerTextOverviewDraftAfterSend(args: {
  draftId: string;
  clerkUserId: string;
  dayKey: string;
  twilioMessageSid: string;
  finalBodySent: string;
  now?: Date;
}): Promise<{ ok: boolean; error?: string }> {
  const nowIso = (args.now ?? new Date()).toISOString();
  const sendEventId = await resolveSmsSendEventIdForDay({
    clerkUserId: args.clerkUserId,
    dayKey: args.dayKey,
  });

  const { error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .update({
      status: "sent",
      sent_at: nowIso,
      source_sms_send_event_id: sendEventId,
      twilio_message_sid: args.twilioMessageSid,
      final_body_sent: args.finalBodySent,
      updated_at: nowIso,
    })
    .eq("id", args.draftId)
    .eq("status", "current");

  if (error) {
    console.error("[tyler-text-overview-send] draft finalize after send failed", {
      draft_id: args.draftId,
      error: error.message,
    });
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function markTylerTextOverviewDraftSkippedAfterGuard(args: {
  draftId: string;
  clerkUserId: string;
  dayKey: string;
  now?: Date;
}): Promise<void> {
  const nowIso = (args.now ?? new Date()).toISOString();
  const sendEventId = await resolveSmsSendEventIdForDay({
    clerkUserId: args.clerkUserId,
    dayKey: args.dayKey,
  });

  const { error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .update({
      status: "skipped",
      source_sms_send_event_id: sendEventId,
      final_body_sent: null,
      updated_at: nowIso,
    })
    .eq("id", args.draftId)
    .eq("status", "current");

  if (error) {
    console.warn("[tyler-text-overview-send] draft skipped after guard failed", {
      draft_id: args.draftId,
      error: error.message,
    });
  }
}

export async function markTylerTextOverviewDraftSkippedAfterLiveFallback(args: {
  draftId: string;
  clerkUserId: string;
  dayKey: string;
  finalBodySent: string | null;
  now?: Date;
}): Promise<void> {
  const nowIso = (args.now ?? new Date()).toISOString();
  const sendEventId = await resolveSmsSendEventIdForDay({
    clerkUserId: args.clerkUserId,
    dayKey: args.dayKey,
  });

  const { error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .update({
      status: "skipped",
      source_sms_send_event_id: sendEventId,
      final_body_sent: args.finalBodySent,
      updated_at: nowIso,
    })
    .eq("id", args.draftId)
    .eq("status", "current");

  if (error) {
    console.warn("[tyler-text-overview-send] draft skipped after live fallback failed", {
      draft_id: args.draftId,
      error: error.message,
    });
  }
}

export type PrepareTylerTextOverviewDailyBuildResult = {
  builtMainRaw: DailySmsBuilt;
  sendContext: TylerTextOverviewSendContext | null;
  draftBodyUsed: boolean;
};

export async function prepareTylerTextOverviewDailyBuild(args: {
  clerkUserId: string;
  draftForDayKey: string;
  now: Date;
  build: (overrideBody: string | null) => Promise<DailySmsBuilt>;
}): Promise<PrepareTylerTextOverviewDailyBuildResult> {
  if (!isTylerTextOverviewEnabled()) {
    const builtMainRaw = await args.build(null);
    return { builtMainRaw, sendContext: null, draftBodyUsed: false };
  }

  const lookup = await loadUsableTylerTextOverviewDraftForSend({
    clerkUserId: args.clerkUserId,
    draftForDayKey: args.draftForDayKey,
    now: args.now,
  });

  const overrideForBuild =
    lookup.usable &&
    lookup.current_body_to_send &&
    (lookup.send_source === "tyler_edit" || lookup.edited_by_tyler)
      ? lookup.current_body_to_send
      : null;

  let builtMainRaw = await args.build(overrideForBuild);

  let draftBodyUsed = false;
  if (
    builtMainRaw.ok &&
    shouldApplyTylerTextOverviewDraftOverlay({ lookup, builtRaw: builtMainRaw })
  ) {
    builtMainRaw = applyTylerTextOverviewDraftBodyToBuilt(
      builtMainRaw,
      lookup.current_body_to_send!
    );
    draftBodyUsed = true;
  } else if (
    lookup.usable &&
    lookup.current_body_to_send &&
    builtMainRaw.ok &&
    overrideForBuild &&
    builtMainRaw.smsBody.trim() === lookup.current_body_to_send.trim()
  ) {
    draftBodyUsed = true;
  }

  const sendContext = buildTylerTextOverviewSendContext({
    lookup,
    builtRaw: builtMainRaw,
    draftBodyUsed,
  });

  return { builtMainRaw, sendContext, draftBodyUsed };
}

export function withTylerTextOverviewFinalBodyOnContext(
  ctx: TylerTextOverviewSendContext | null,
  finalBodySent: string | null
): TylerTextOverviewSendContext | null {
  if (!ctx) return null;
  const effectiveSendSource = resolveTylerTextOverviewEffectiveSendSource({
    lookup: ctx.lookup,
    builtRaw: { ok: true, smsBody: finalBodySent ?? "" } as Extract<DailySmsBuilt, { ok: true }>,
    draftBodyUsed: ctx.draftBodyUsed,
  });
  return {
    ...ctx,
    metadataBlock: buildTylerTextOverviewSendMetadata({
      lookup: ctx.lookup,
      effectiveSendSource,
      finalBodySent,
    }),
  };
}
