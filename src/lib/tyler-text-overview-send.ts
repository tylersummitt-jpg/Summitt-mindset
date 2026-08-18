import type { DailySmsBuilt } from "@/lib/daily-sms-build";
import {
  TWILIO_SMS_BODY_MAX_CHARS,
  smsBodyExceedsTwilioTransportMax,
} from "@/lib/sms-transport-max";
import { supabaseServer } from "@/lib/supabase-server";
import {
  isTylerTextOverviewEnabled,
  isProtectedTtoCurrentDraftBody,
  isProductionSendSlot,
  parseSmsDailySendSlot,
  SMS_DAILY_DRAFT_GENERATIONS_TABLE,
  SMS_DAILY_DRAFTS_TABLE,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
  SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT,
  TTO_CURRENT_DRAFT_FINAL_STALE_REASON,
  TTO_CURRENT_DRAFT_ROUTE_CONFLICT,
  TTO_CURRENT_DRAFT_SPECIAL_BRANCH_CONFLICT,
  TTO_DRAFT_REVALIDATION_REASON_EMPTY,
  TTO_DRAFT_REVALIDATION_REASON_MISSING,
  TTO_DRAFT_REVALIDATION_REASON_NOT_CURRENT,
  TTO_POST_TTO_GUARDS_SKIPPED,
  type TtoDraftRevalidationFailureReason,
  type TtoDraftRevalidationSkipStatus,
  type TtoCurrentDraftRouteConflictReason,
  type TylerTextOverviewCurrentBodySource,
  type TylerTextOverviewSendMetadata,
  type TylerTextOverviewSendSource,
  type SmsDailySendSlot,
} from "@/lib/tyler-text-overview-types";
import { hashSmsSnippet } from "@/lib/v2-human-visible-sms/validate-human-visible-sms";

const MAIN_ACCOUNTABILITY_ROUTE_KIND = "main_active_accountability";
const MORNING_RELATIONSHIP_ROUTE_KIND = "morning_relationship";

const PREVIEW_ONLY_DRAFT_SEND_REFUSED = "preview_only_draft_not_sendable" as const;

export type MorningTtoAuthoritativeSkipReason =
  | "tto_no_current_morning_draft"
  | "tto_blank_morning_body"
  | "tto_body_too_long"
  | "tto_missing_generation"
  | "tto_generation_send_slot_mismatch"
  | "tto_machine_should_send_false"
  | "tto_route_not_eligible_v1";

export type MorningTtoAuthoritativeFailClosedReason =
  | "tto_live_fallback_blocked"
  | "tto_draft_body_not_used"
  | "tto_lookup_not_usable"
  | "tto_authoritative_body_mismatch";

type AuthoritativeDraftRow = DraftRow & { send_slot?: string };

type AuthoritativeGenerationRow = GenerationRow & {
  machine_should_send?: boolean | null;
  send_slot?: string | null;
};

export type MorningTtoAuthoritativeGateSuccess = {
  ok: true;
  bodyToSend: string;
  draft: AuthoritativeDraftRow;
  generation: AuthoritativeGenerationRow;
  tylerEdited: boolean;
};

export type MorningTtoAuthoritativeGateResult =
  | MorningTtoAuthoritativeGateSuccess
  | {
      ok: false;
      reason: MorningTtoAuthoritativeSkipReason;
      metadata?: Record<string, unknown>;
    };

export function isTylerEditTtoDraftOverride(draft: {
  edited_by_tyler: boolean;
  current_body_source: string;
}): boolean {
  // Morning absolute authority: any Tyler-save metadata wins over machine_should_send=false.
  return draft.edited_by_tyler === true || draft.current_body_source === "tyler_edit";
}

export function isLiveFallbackTtoSendSource(source: string | null | undefined): boolean {
  if (source == null || source === "") return false;
  return (
    source.startsWith("live_fallback") ||
    source === "live_fallback_no_draft" ||
    source === "live_fallback_empty_body" ||
    source === "live_fallback_special_branch"
  );
}

export async function assertMorningTtoDraftAuthoritativeForSend(args: {
  clerkUserId: string;
  draftForDayKey: string;
}): Promise<MorningTtoAuthoritativeGateResult> {
  const draftForDayKey = args.draftForDayKey.trim();
  const clerkUserId = args.clerkUserId.trim();

  const { data: draftRow, error: draftError } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(
      "id, clerk_user_id, draft_for_day_key, current_generation_id, current_body_to_send, current_body_source, edited_by_tyler, machine_body_hash, current_body_hash, status, send_slot"
    )
    .eq("clerk_user_id", clerkUserId)
    .eq("draft_for_day_key", draftForDayKey)
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT)
    .eq("status", "current")
    .maybeSingle();

  if (draftError) {
    return {
      ok: false,
      reason: "tto_no_current_morning_draft",
      metadata: { draft_error: draftError.message },
    };
  }

  if (!draftRow) {
    return { ok: false, reason: "tto_no_current_morning_draft" };
  }

  const draft = draftRow as AuthoritativeDraftRow;
  const body = trimBody(draft.current_body_to_send);
  if (!body) {
    return {
      ok: false,
      reason: "tto_blank_morning_body",
      metadata: { draft_id: draft.id },
    };
  }

  if (smsBodyExceedsTwilioTransportMax(body)) {
    return {
      ok: false,
      reason: "tto_body_too_long",
      metadata: {
        draft_id: draft.id,
        body_length: body.length,
        transport_max: TWILIO_SMS_BODY_MAX_CHARS,
      },
    };
  }

  const generationId =
    typeof draft.current_generation_id === "string" ? draft.current_generation_id.trim() : "";
  if (!generationId) {
    return {
      ok: false,
      reason: "tto_missing_generation",
      metadata: { draft_id: draft.id },
    };
  }

  const { data: generationRow, error: generationError } = await supabaseServer
    .from(SMS_DAILY_DRAFT_GENERATIONS_TABLE)
    .select(
      "id, generated_at, machine_body_hash, notebook_verdict, notebook_verdict_reason, route_kind, machine_should_send, send_slot"
    )
    .eq("id", generationId)
    .maybeSingle();

  if (generationError || !generationRow) {
    return {
      ok: false,
      reason: "tto_missing_generation",
      metadata: {
        draft_id: draft.id,
        current_generation_id: generationId,
        generation_error: generationError?.message ?? null,
      },
    };
  }

  const generation = generationRow as AuthoritativeGenerationRow;
  const draftSlot =
    typeof draft.send_slot === "string" && draft.send_slot.trim()
      ? draft.send_slot.trim()
      : SMS_DAILY_PRODUCTION_SEND_SLOT;
  const generationSlot =
    typeof generation.send_slot === "string" && generation.send_slot.trim()
      ? generation.send_slot.trim()
      : null;
  if (
    generationSlot !== SMS_DAILY_PRODUCTION_SEND_SLOT ||
    draftSlot !== SMS_DAILY_PRODUCTION_SEND_SLOT
  ) {
    return {
      ok: false,
      reason: "tto_generation_send_slot_mismatch",
      metadata: {
        draft_id: draft.id,
        generation_id: generation.id,
        draft_slot: draftSlot,
        generation_slot: generationSlot,
      },
    };
  }

  const tylerEdited = isTylerEditTtoDraftOverride(draft);

  // Machine may block before TTO review (stale ask, post-validate, etc.).
  // Once Tyler Saves a non-empty body, machine_should_send=false must not veto.
  if (generation.machine_should_send === false && !tylerEdited) {
    return {
      ok: false,
      reason: "tto_machine_should_send_false",
      metadata: {
        draft_id: draft.id,
        generation_id: generation.id,
        route_kind: generation.route_kind,
      },
    };
  }

  const routeKindTrimmed =
    typeof generation.route_kind === "string" ? generation.route_kind.trim() : "";
  const routeEligibleForV1 =
    routeKindTrimmed === "" ||
    routeKindTrimmed === MAIN_ACCOUNTABILITY_ROUTE_KIND ||
    routeKindTrimmed === MORNING_RELATIONSHIP_ROUTE_KIND;
  if (!routeEligibleForV1 && !tylerEdited) {
    return {
      ok: false,
      reason: "tto_route_not_eligible_v1",
      metadata: {
        draft_id: draft.id,
        generation_id: generation.id,
        route_kind: generation.route_kind ?? null,
      },
    };
  }

  return {
    ok: true,
    bodyToSend: body,
    draft,
    generation,
    tylerEdited,
  };
}

export function evaluateMorningTtoAuthoritativeFailClosed(args: {
  gate: MorningTtoAuthoritativeGateSuccess;
  draftBodyUsed: boolean;
  lookup: TylerTextOverviewDraftForSendResult | null | undefined;
  smsBody: string;
}): { ok: true } | { ok: false; reason: MorningTtoAuthoritativeFailClosedReason } {
  if (!args.draftBodyUsed) {
    return { ok: false, reason: "tto_draft_body_not_used" };
  }
  if (!args.lookup?.usable) {
    return { ok: false, reason: "tto_lookup_not_usable" };
  }
  if (isLiveFallbackTtoSendSource(args.lookup.send_source)) {
    return { ok: false, reason: "tto_live_fallback_blocked" };
  }
  if (
    normalizedTtoCurrentDraftSendBody(args.smsBody) !==
    normalizedTtoCurrentDraftSendBody(args.gate.bodyToSend)
  ) {
    return { ok: false, reason: "tto_authoritative_body_mismatch" };
  }
  return { ok: true };
}

export function buildMorningTtoSendLookupFromGate(
  gate: MorningTtoAuthoritativeGateSuccess,
  bodyToSend: string
): TylerTextOverviewDraftForSendResult {
  const { draft, generation, tylerEdited } = gate;
  return {
    usable: true,
    send_source: tylerEdited ? "tyler_edit" : "machine_draft",
    draft_id: draft.id,
    generation_id: generation.id,
    draft_for_day_key: draft.draft_for_day_key,
    current_body_to_send: bodyToSend,
    current_body_source:
      draft.current_body_source === "machine" ||
      draft.current_body_source === "tyler_edit" ||
      draft.current_body_source === "live_fallback"
        ? (draft.current_body_source as TylerTextOverviewCurrentBodySource)
        : null,
    edited_by_tyler: tylerEdited,
    machine_body_hash:
      typeof draft.machine_body_hash === "string"
        ? draft.machine_body_hash
        : typeof generation.machine_body_hash === "string"
          ? generation.machine_body_hash
          : null,
    current_body_hash:
      typeof draft.current_body_hash === "string"
        ? draft.current_body_hash
        : hashSmsSnippet(bodyToSend),
    notebook_verdict_at_generation:
      typeof generation.notebook_verdict === "string" ? generation.notebook_verdict : null,
    notebook_verdict_reason_at_generation:
      typeof generation.notebook_verdict_reason === "string"
        ? generation.notebook_verdict_reason
        : null,
    route_kind: typeof generation.route_kind === "string" ? generation.route_kind : null,
    stale: false,
    stale_reason: null,
  };
}

export function buildMorningTtoSendContextFromGate(args: {
  gate: MorningTtoAuthoritativeGateSuccess;
  bodyToSend: string;
  revalidationMetadata?: Partial<TylerTextOverviewSendMetadata>;
}): TylerTextOverviewSendContext {
  const lookup = buildMorningTtoSendLookupFromGate(args.gate, args.bodyToSend);
  const effectiveSendSource = lookup.send_source;
  const metadataBlock = buildTylerTextOverviewSendMetadata({
    lookup,
    effectiveSendSource,
    finalBodySent: args.bodyToSend,
    postTtoWritersBypassed: true,
  });

  return {
    considered: true,
    draftBodyUsed: true,
    postTtoWritersBypassed: true,
    lookup,
    metadataBlock: {
      ...metadataBlock,
      ...(args.revalidationMetadata ?? {}),
    },
  };
}

export type MorningTtoExactBodySuccess = {
  ok: true;
  bodyToSend: string;
  sendContext: TylerTextOverviewSendContext;
};

export type MorningTtoExactBodyFailure = {
  ok: false;
  skipStatus:
    | TtoDraftRevalidationSkipStatus
    | "skipped_tto_authoritative_fail_closed"
    | "skipped_tto_authoritative_body_mismatch";
  reason: TtoDraftRevalidationFailureReason | MorningTtoAuthoritativeFailClosedReason;
  metadataExtras: Partial<TylerTextOverviewSendMetadata> & Record<string, unknown>;
};

export async function resolveMorningTtoExactBodyImmediatelyBeforeTwilio(args: {
  gate: MorningTtoAuthoritativeGateSuccess;
  clerkUserId: string;
  draftForDayKey: string;
}): Promise<MorningTtoExactBodySuccess | MorningTtoExactBodyFailure> {
  const lookup = buildMorningTtoSendLookupFromGate(args.gate, args.gate.bodyToSend);

  const revalidation = await revalidateCurrentTtoDraftBodyBeforeSend({
    lookup,
    pinnedBody: args.gate.bodyToSend,
    clerkUserId: args.clerkUserId,
    draftForDayKey: args.draftForDayKey,
  });

  if (!revalidation.ok) {
    return {
      ok: false,
      skipStatus: revalidation.skipStatus,
      reason: revalidation.reason,
      metadataExtras: revalidation.metadataExtras,
    };
  }

  const failClosed = evaluateMorningTtoAuthoritativeFailClosed({
    gate: args.gate,
    draftBodyUsed: true,
    lookup: { ...lookup, ...revalidation.lookupUpdates, usable: true },
    smsBody: revalidation.bodyToSend,
  });

  if (!failClosed.ok && failClosed.reason !== "tto_authoritative_body_mismatch") {
    return {
      ok: false,
      skipStatus: "skipped_tto_authoritative_fail_closed",
      reason: failClosed.reason,
      metadataExtras: {
        tto_authoritative_fail_closed_reason: failClosed.reason,
      },
    };
  }

  const bodyToSend = revalidation.bodyToSend.trim();
  if (!bodyToSend) {
    return {
      ok: false,
      skipStatus: "skipped_tto_current_draft_empty_on_revalidation",
      reason: TTO_DRAFT_REVALIDATION_REASON_EMPTY,
      metadataExtras: buildTtoRevalidationFailureMetadata({
        lookup,
        reason: TTO_DRAFT_REVALIDATION_REASON_EMPTY,
        pinnedBody: args.gate.bodyToSend,
      }),
    };
  }

  const sendContext = buildMorningTtoSendContextFromGate({
    gate: args.gate,
    bodyToSend,
    revalidationMetadata: revalidation.metadataExtras,
  });

  sendContext.lookup = {
    ...sendContext.lookup,
    ...revalidation.lookupUpdates,
    current_body_to_send: bodyToSend,
  };

  return {
    ok: true,
    bodyToSend,
    sendContext,
  };
}

/**
 * Resolve draft send_slot for morning finalize/skip guards.
 * Never maps weekly_review or unknown slots to morning.
 * Returns:
 * - { found: false } when the draft row is missing
 * - { found: true, sendSlot } for known slots
 * - { found: true, sendSlot: null } for unparseable/unknown slots
 */
export async function loadDraftSendSlotForGuard(draftId: string): Promise<
  | { found: false }
  | { found: true; sendSlot: SmsDailySendSlot | null; rawSendSlot: string | null }
> {
  const { data, error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select("send_slot")
    .eq("id", draftId)
    .maybeSingle();

  if (error || !data) return { found: false };
  const raw =
    typeof data.send_slot === "string" && data.send_slot.trim()
      ? data.send_slot.trim()
      : null;
  const parsed = parseSmsDailySendSlot(raw);
  return { found: true, sendSlot: parsed, rawSendSlot: raw };
}

export function isSendableTylerTextOverviewDraftSlot(
  sendSlot: SmsDailySendSlot | string | null | undefined
): boolean {
  return isProductionSendSlot(sendSlot);
}

export async function assertSendableTylerTextOverviewDraft(args: {
  draftId: string;
}): Promise<{ ok: true } | { ok: false; error: typeof PREVIEW_ONLY_DRAFT_SEND_REFUSED }> {
  const loaded = await loadDraftSendSlotForGuard(args.draftId);
  if (!loaded.found) {
    return { ok: true };
  }
  // weekly_review / evening_checkin / unknown must not be treated as morning-sendable.
  if (loaded.sendSlot == null) {
    return { ok: false, error: PREVIEW_ONLY_DRAFT_SEND_REFUSED };
  }
  if (loaded.sendSlot === SMS_DAILY_WEEKLY_REVIEW_SEND_SLOT) {
    return { ok: false, error: PREVIEW_ONLY_DRAFT_SEND_REFUSED };
  }
  if (!isSendableTylerTextOverviewDraftSlot(loaded.sendSlot)) {
    return { ok: false, error: PREVIEW_ONLY_DRAFT_SEND_REFUSED };
  }
  return { ok: true };
}

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
  postTtoWritersBypassed: boolean;
  lookup: TylerTextOverviewDraftForSendResult;
  metadataBlock: TylerTextOverviewSendMetadata | null;
};

export function normalizedTtoCurrentDraftSendBody(body: string): string {
  return body.trim();
}

export function isTtoCurrentDraftPinEligible(
  lookup: TylerTextOverviewDraftForSendResult
): boolean {
  return lookup.usable && isProtectedTtoCurrentDraftBody(lookup.current_body_to_send);
}

/** Current draft row with non-empty body for this send day (pin required if present). */
export function hasProtectedTtoCurrentDraftForSendDay(
  lookup: TylerTextOverviewDraftForSendResult | null | undefined
): boolean {
  if (!lookup?.draft_id) return false;
  return isProtectedTtoCurrentDraftBody(lookup.current_body_to_send);
}

export function canPinTtoCurrentDraftForSend(args: {
  lookup: TylerTextOverviewDraftForSendResult | null | undefined;
  builtRaw: DailySmsBuilt;
  draftBodyUsed: boolean;
}): boolean {
  return Boolean(
    args.lookup &&
      args.draftBodyUsed &&
      isTtoCurrentDraftPinEligible(args.lookup) &&
      args.builtRaw.ok &&
      args.lookup.current_body_to_send
  );
}

export type TtoCurrentDraftSendConflict = {
  status:
    | "skipped_tto_current_draft_special_branch_conflict"
    | "skipped_tto_current_draft_route_conflict";
  reason: TtoCurrentDraftRouteConflictReason;
};

/**
 * Protected current draft exists but exact pin cannot apply — live send must not proceed.
 */
export function resolveTtoCurrentDraftSendConflict(args: {
  lookup: TylerTextOverviewDraftForSendResult | null | undefined;
  builtRaw: DailySmsBuilt;
  draftBodyUsed: boolean;
}): TtoCurrentDraftSendConflict | null {
  if (!hasProtectedTtoCurrentDraftForSendDay(args.lookup)) {
    return null;
  }
  if (canPinTtoCurrentDraftForSend(args)) {
    return null;
  }

  if (args.builtRaw.ok && isDailySmsBuiltSpecialBranch(args.builtRaw)) {
    return {
      status: "skipped_tto_current_draft_special_branch_conflict",
      reason: TTO_CURRENT_DRAFT_SPECIAL_BRANCH_CONFLICT,
    };
  }

  return {
    status: "skipped_tto_current_draft_route_conflict",
    reason: TTO_CURRENT_DRAFT_ROUTE_CONFLICT,
  };
}

export function buildTtoCurrentDraftConflictMetadataExtras(args: {
  lookup: TylerTextOverviewDraftForSendResult;
  conflict: TtoCurrentDraftSendConflict;
  builtRaw: DailySmsBuilt;
}): Partial<TylerTextOverviewSendMetadata> {
  return {
    tto_current_draft_protected: true,
    live_fallback_used: false,
    post_tto_writers_bypassed: false,
    tto_current_draft_route_conflict_reason: args.conflict.reason,
  };
}

export function buildTylerTextOverviewRouteConflictMetadata(args: {
  lookup: TylerTextOverviewDraftForSendResult;
  builtRaw: DailySmsBuilt;
  draftBodyUsed: boolean;
  conflict: TtoCurrentDraftSendConflict;
}): TylerTextOverviewSendMetadata {
  const effectiveSendSource = resolveTylerTextOverviewEffectiveSendSource({
    lookup: args.lookup,
    builtRaw: args.builtRaw,
    draftBodyUsed: args.draftBodyUsed,
  });
  return {
    ...buildTylerTextOverviewSendMetadata({
      lookup: args.lookup,
      effectiveSendSource,
      finalBodySent: null,
      postTtoWritersBypassed: false,
    }),
    ...buildTtoCurrentDraftConflictMetadataExtras({
      lookup: args.lookup,
      conflict: args.conflict,
      builtRaw: args.builtRaw,
    }),
  };
}

export function assertTtoCurrentDraftBodyMatches(args: {
  smsBody: string;
  currentBodyToSend: string;
}):
  | { ok: true; normalizedBody: string }
  | { ok: false; reason: "tto_current_draft_body_mismatch" } {
  const expected = normalizedTtoCurrentDraftSendBody(args.currentBodyToSend);
  const actual = normalizedTtoCurrentDraftSendBody(args.smsBody);
  if (actual !== expected) {
    return { ok: false, reason: "tto_current_draft_body_mismatch" };
  }
  return { ok: true, normalizedBody: expected };
}

export function buildTtoProtectedSendMetadataExtras(args: {
  lookup: TylerTextOverviewDraftForSendResult;
  finalBodySent: string;
}): Partial<TylerTextOverviewSendMetadata> {
  const normalized = normalizedTtoCurrentDraftSendBody(args.finalBodySent);
  const currentHash = args.lookup.current_body_hash ?? hashSmsSnippet(normalized);
  return {
    tto_current_draft_protected: true,
    post_tto_writers_bypassed: true,
    sent_body_equals_current_body_to_send: true,
    stale_check_ignored_reason: TTO_CURRENT_DRAFT_FINAL_STALE_REASON,
    live_fallback_used: false,
    post_tto_guards_skipped: [...TTO_POST_TTO_GUARDS_SKIPPED],
    current_body_hash_at_send: currentHash,
    final_body_sent_hash: hashSmsSnippet(normalized),
  };
}

export async function applyDailySmsBuiltWithTtoPostWriterBypass(args: {
  builtRaw: DailySmsBuilt;
  lookup: TylerTextOverviewDraftForSendResult | null | undefined;
  draftBodyUsed: boolean;
  applyNorthStarGate: (built: Extract<DailySmsBuilt, { ok: true }>) => Promise<DailySmsBuilt>;
}): Promise<{ built: DailySmsBuilt; postTtoWritersBypassed: boolean }> {
  const pinEligible =
    args.lookup && args.draftBodyUsed && isTtoCurrentDraftPinEligible(args.lookup);

  if (!pinEligible || !args.builtRaw.ok || !args.lookup?.current_body_to_send) {
    if (args.builtRaw.ok) {
      return {
        built: await args.applyNorthStarGate(args.builtRaw),
        postTtoWritersBypassed: false,
      };
    }
    return { built: args.builtRaw, postTtoWritersBypassed: false };
  }

  const pinnedBody = normalizedTtoCurrentDraftSendBody(args.lookup.current_body_to_send);
  const built = applyTylerTextOverviewDraftBodyToBuilt(args.builtRaw, pinnedBody);
  return { built, postTtoWritersBypassed: true };
}

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
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT)
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
    baseFields.route_kind !== MAIN_ACCOUNTABILITY_ROUTE_KIND &&
    baseFields.route_kind !== MORNING_RELATIONSHIP_ROUTE_KIND
  ) {
    if (isTylerEditTtoDraftOverride(draft)) {
      return {
        usable: true,
        send_source: "tyler_edit",
        stale: false,
        stale_reason: null,
        ...baseFields,
      };
    }
    return {
      usable: false,
      send_source: "live_fallback_special_branch",
      stale: false,
      stale_reason: null,
      ...baseFields,
    };
  }

  let inboundAfterGeneration = false;
  let staleReason: string | null = null;
  try {
    const inboundAfter = await fetchLatestInboundAfter({
      clerkUserId,
      afterIso: generation.generated_at,
    });
    if (inboundAfter) {
      inboundAfterGeneration = true;
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

  const send_source: TylerTextOverviewSendSource =
    draft.current_body_source === "tyler_edit" || draft.edited_by_tyler
      ? "tyler_edit"
      : "machine_draft";

  return {
    usable: true,
    send_source,
    stale: inboundAfterGeneration,
    stale_reason: inboundAfterGeneration ? staleReason : null,
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
  const tylerEdited =
    args.lookup.edited_by_tyler || args.lookup.current_body_source === "tyler_edit";
  if (isDailySmsBuiltSpecialBranch(args.builtRaw) && !tylerEdited) return false;
  if (
    args.lookup.route_kind != null &&
    args.lookup.route_kind !== MAIN_ACCOUNTABILITY_ROUTE_KIND &&
    !tylerEdited
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
  postTtoWritersBypassed?: boolean;
}): TylerTextOverviewSendMetadata {
  const finalHash =
    args.finalBodySent && args.finalBodySent.trim()
      ? hashSmsSnippet(args.finalBodySent.trim())
      : null;

  const base: TylerTextOverviewSendMetadata = {
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

  if (args.postTtoWritersBypassed && args.finalBodySent?.trim()) {
    return {
      ...base,
      ...buildTtoProtectedSendMetadataExtras({
        lookup: args.lookup,
        finalBodySent: args.finalBodySent,
      }),
    };
  }

  return base;
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
  postTtoWritersBypassed?: boolean;
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
    postTtoWritersBypassed: args.postTtoWritersBypassed ?? false,
    lookup: args.lookup,
    metadataBlock: buildTylerTextOverviewSendMetadata({
      lookup: args.lookup,
      effectiveSendSource,
      finalBodySent: args.finalBodySent ?? null,
      postTtoWritersBypassed: args.postTtoWritersBypassed,
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
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT)
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
  const guard = await assertSendableTylerTextOverviewDraft({ draftId: args.draftId });
  if (!guard.ok) {
    return { ok: false, error: guard.error };
  }

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
  const guard = await assertSendableTylerTextOverviewDraft({ draftId: args.draftId });
  if (!guard.ok) {
    console.warn("[tyler-text-overview-send] skipped guard on preview-only draft", {
      draft_id: args.draftId,
      reason: guard.error,
    });
    return;
  }

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
  const guard = await assertSendableTylerTextOverviewDraft({ draftId: args.draftId });
  if (!guard.ok) {
    console.warn("[tyler-text-overview-send] skipped live fallback on preview-only draft", {
      draft_id: args.draftId,
      reason: guard.error,
    });
    return;
  }

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
    lookup.usable && lookup.current_body_to_send ? lookup.current_body_to_send : null;

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

export function withTylerTextOverviewPostWriterBypassOnContext(
  ctx: TylerTextOverviewSendContext | null,
  postTtoWritersBypassed: boolean,
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
    postTtoWritersBypassed,
    metadataBlock: buildTylerTextOverviewSendMetadata({
      lookup: ctx.lookup,
      effectiveSendSource,
      finalBodySent,
      postTtoWritersBypassed,
    }),
  };
}

export function withTylerTextOverviewFinalBodyOnContext(
  ctx: TylerTextOverviewSendContext | null,
  finalBodySent: string | null
): TylerTextOverviewSendContext | null {
  return withTylerTextOverviewPostWriterBypassOnContext(
    ctx,
    ctx?.postTtoWritersBypassed ?? false,
    finalBodySent
  );
}

type TtoDraftRevalidationRow = {
  current_body_to_send: string | null;
  current_body_source: string;
  edited_by_tyler: boolean;
  current_body_hash: string | null;
  status: string;
};

function parseTtoCurrentBodySource(
  raw: string | null | undefined
): TylerTextOverviewCurrentBodySource | null {
  if (
    raw === "machine" ||
    raw === "tyler_edit" ||
    raw === "live_fallback"
  ) {
    return raw;
  }
  return null;
}

function resolveTtoSendSourceFromDraftRow(row: TtoDraftRevalidationRow): TylerTextOverviewSendSource {
  if (row.current_body_source === "tyler_edit" || row.edited_by_tyler) {
    return "tyler_edit";
  }
  return "machine_draft";
}

async function fetchTtoDraftRowForRevalidation(args: {
  draftId: string;
  clerkUserId: string;
  draftForDayKey: string;
}): Promise<TtoDraftRevalidationRow | null> {
  const { data, error } = await supabaseServer
    .from(SMS_DAILY_DRAFTS_TABLE)
    .select(
      "current_body_to_send, current_body_source, edited_by_tyler, current_body_hash, status"
    )
    .eq("id", args.draftId)
    .eq("clerk_user_id", args.clerkUserId)
    .eq("draft_for_day_key", args.draftForDayKey)
    .eq("send_slot", SMS_DAILY_PRODUCTION_SEND_SLOT)
    .maybeSingle();

  if (error) {
    throw new Error(`tyler_text_overview_revalidation_read_failed:${error.message}`);
  }

  if (!data) return null;
  return data as TtoDraftRevalidationRow;
}

export function shouldRevalidateTtoCurrentDraftBeforeSend(args: {
  tylerTextOverviewCtx: TylerTextOverviewSendContext | null;
  tylerDraftBodyUsed: boolean;
  built: DailySmsBuilt;
}): boolean {
  if (!isTylerTextOverviewEnabled()) return false;
  return Boolean(
    args.built.ok &&
      args.tylerDraftBodyUsed &&
      args.tylerTextOverviewCtx?.postTtoWritersBypassed &&
      hasProtectedTtoCurrentDraftForSendDay(args.tylerTextOverviewCtx.lookup) &&
      args.tylerTextOverviewCtx.lookup.draft_id
  );
}

export type TtoDraftRevalidationSuccess = {
  ok: true;
  bodyToSend: string;
  refreshed: boolean;
  metadataExtras: Partial<TylerTextOverviewSendMetadata>;
  lookupUpdates: Partial<TylerTextOverviewDraftForSendResult>;
};

export type TtoDraftRevalidationFailure = {
  ok: false;
  skipStatus: TtoDraftRevalidationSkipStatus;
  reason: TtoDraftRevalidationFailureReason;
  metadataExtras: Partial<TylerTextOverviewSendMetadata>;
};

export type TtoDraftRevalidationResult = TtoDraftRevalidationSuccess | TtoDraftRevalidationFailure;

export function buildTtoRevalidationFailureMetadata(args: {
  lookup: TylerTextOverviewDraftForSendResult;
  reason: TtoDraftRevalidationFailureReason;
  pinnedBody: string;
}): Partial<TylerTextOverviewSendMetadata> {
  const pinnedNormalized = normalizedTtoCurrentDraftSendBody(args.pinnedBody);
  return {
    tto_current_draft_protected: true,
    live_fallback_used: false,
    tto_current_draft_revalidated_before_twilio: true,
    tto_current_draft_reloaded_before_twilio: true,
    tto_current_draft_revalidation_failed: true,
    tto_current_draft_revalidation_reason: args.reason,
    current_body_source_at_send: args.lookup.current_body_source,
    previous_loaded_body_hash: pinnedNormalized
      ? hashSmsSnippet(pinnedNormalized)
      : args.lookup.current_body_hash,
  };
}

export function buildTtoRevalidationSuccessMetadataExtras(args: {
  refreshed: boolean;
  latestBody: string;
  pinnedBody: string;
  reloadedRow: TtoDraftRevalidationRow;
}): Partial<TylerTextOverviewSendMetadata> {
  const latestHash =
    typeof args.reloadedRow.current_body_hash === "string"
      ? args.reloadedRow.current_body_hash
      : hashSmsSnippet(args.latestBody);
  const pinnedNormalized = normalizedTtoCurrentDraftSendBody(args.pinnedBody);
  return {
    tto_current_draft_revalidated_before_twilio: true,
    tto_current_draft_reloaded_before_twilio: true,
    tto_current_draft_body_refreshed_before_twilio: args.refreshed,
    sent_body_equals_current_body_to_send: true,
    live_fallback_used: false,
    current_body_hash_at_send: latestHash,
    final_body_sent_hash: hashSmsSnippet(args.latestBody),
    current_body_source_at_send: parseTtoCurrentBodySource(args.reloadedRow.current_body_source),
    ...(args.refreshed && pinnedNormalized
      ? { tto_current_draft_previous_body_hash: hashSmsSnippet(pinnedNormalized) }
      : {}),
  };
}

/**
 * Read-only re-read of current TTO draft immediately before Twilio.
 * Latest saved current_body_to_send wins over the earlier in-memory snapshot.
 */
export async function revalidateCurrentTtoDraftBodyBeforeSend(args: {
  lookup: TylerTextOverviewDraftForSendResult;
  pinnedBody: string;
  clerkUserId: string;
  draftForDayKey: string;
}): Promise<TtoDraftRevalidationResult> {
  const draftId = args.lookup.draft_id;
  if (!draftId) {
    return {
      ok: false,
      skipStatus: "skipped_tto_current_draft_revalidation_failed",
      reason: TTO_DRAFT_REVALIDATION_REASON_MISSING,
      metadataExtras: buildTtoRevalidationFailureMetadata({
        lookup: args.lookup,
        reason: TTO_DRAFT_REVALIDATION_REASON_MISSING,
        pinnedBody: args.pinnedBody,
      }),
    };
  }

  const row = await fetchTtoDraftRowForRevalidation({
    draftId,
    clerkUserId: args.clerkUserId,
    draftForDayKey: args.draftForDayKey,
  });

  if (!row) {
    return {
      ok: false,
      skipStatus: "skipped_tto_current_draft_revalidation_failed",
      reason: TTO_DRAFT_REVALIDATION_REASON_MISSING,
      metadataExtras: buildTtoRevalidationFailureMetadata({
        lookup: args.lookup,
        reason: TTO_DRAFT_REVALIDATION_REASON_MISSING,
        pinnedBody: args.pinnedBody,
      }),
    };
  }

  if (row.status !== "current") {
    return {
      ok: false,
      skipStatus: "skipped_tto_current_draft_no_longer_current",
      reason: TTO_DRAFT_REVALIDATION_REASON_NOT_CURRENT,
      metadataExtras: buildTtoRevalidationFailureMetadata({
        lookup: args.lookup,
        reason: TTO_DRAFT_REVALIDATION_REASON_NOT_CURRENT,
        pinnedBody: args.pinnedBody,
      }),
    };
  }

  const latestBody = trimBody(row.current_body_to_send);
  if (!latestBody) {
    return {
      ok: false,
      skipStatus: "skipped_tto_current_draft_empty_on_revalidation",
      reason: TTO_DRAFT_REVALIDATION_REASON_EMPTY,
      metadataExtras: buildTtoRevalidationFailureMetadata({
        lookup: args.lookup,
        reason: TTO_DRAFT_REVALIDATION_REASON_EMPTY,
        pinnedBody: args.pinnedBody,
      }),
    };
  }

  const pinnedNormalized = normalizedTtoCurrentDraftSendBody(args.pinnedBody);
  const refreshed = pinnedNormalized !== latestBody;
  const sendSource = resolveTtoSendSourceFromDraftRow(row);

  return {
    ok: true,
    bodyToSend: latestBody,
    refreshed,
    metadataExtras: buildTtoRevalidationSuccessMetadataExtras({
      refreshed,
      latestBody,
      pinnedBody: args.pinnedBody,
      reloadedRow: row,
    }),
    lookupUpdates: {
      current_body_to_send: latestBody,
      current_body_source: parseTtoCurrentBodySource(row.current_body_source),
      edited_by_tyler: Boolean(row.edited_by_tyler),
      current_body_hash:
        typeof row.current_body_hash === "string" ? row.current_body_hash : hashSmsSnippet(latestBody),
      send_source: sendSource,
    },
  };
}

export function applyTtoDraftRevalidationSuccess(args: {
  built: Extract<DailySmsBuilt, { ok: true }>;
  tylerTextOverviewCtx: TylerTextOverviewSendContext;
  revalidation: TtoDraftRevalidationSuccess;
}): {
  built: Extract<DailySmsBuilt, { ok: true }>;
  tylerTextOverviewCtx: TylerTextOverviewSendContext;
} {
  const lookup: TylerTextOverviewDraftForSendResult = {
    ...args.tylerTextOverviewCtx.lookup,
    ...args.revalidation.lookupUpdates,
    current_body_to_send: args.revalidation.bodyToSend,
  };
  const built = applyTylerTextOverviewDraftBodyToBuilt(
    args.built,
    args.revalidation.bodyToSend
  );
  const baseCtx = withTylerTextOverviewPostWriterBypassOnContext(
    { ...args.tylerTextOverviewCtx, lookup },
    true,
    args.revalidation.bodyToSend
  )!;
  return {
    built,
    tylerTextOverviewCtx: {
      ...baseCtx,
      lookup,
      metadataBlock: {
        ...baseCtx.metadataBlock!,
        ...args.revalidation.metadataExtras,
      },
    },
  };
}
