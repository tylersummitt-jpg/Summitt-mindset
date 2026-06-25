/**
 * V2 guided resolution: small pending state on `v2_commitment` after refresh SMS
 * hands the user to one dashboard page. Not a strategy engine — UX glue only.
 */

import { supabaseServer } from "@/lib/supabase-server";
import { getActiveCommitment, type ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { SmsSeasonMode } from "@/lib/v2-sms-season-mode";

/** Time window to complete the in-app handoff (PR1). */
export const V2_GUIDED_RESOLUTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Wave 15.1 — suppress duplicate daily pending reminder after inbound confirmation prompt. */
export const V2_PENDING_RESOLUTION_CONFIRMATION_REMINDER_SUPPRESS_MS = 24 * 60 * 60 * 1000;

export const V2_PENDING_RESOLUTION_KINDS = [
  "identity_anchor_update",
  "commitment_replace",
  "commitment_tighten",
] as const;

export type V2PendingResolutionKind = (typeof V2_PENDING_RESOLUTION_KINDS)[number];

export type V2GuidedResolutionPayload = {
  source: "coaching_refresh_resolved";
  resolution: "change" | "new" | "tighten";
  session_id: string;
  inbound_message_sid: string;
};

/** Wave 4.1 SMS pending-resolution wire states (stored in JSON payload; no migration). */
export type V2SmsPendingWireState =
  | "awaiting_candidate"
  | "awaiting_confirmation"
  | "candidate_received"
  | "confirmed"
  | "cancelled";

/** SMS-initiated pending handoff (Wave 4). Does not replace refresh-sourced payloads. */
export type V2SmsPendingResolutionPayload = {
  source: "sms_inbound";
  /** Defaults to awaiting_candidate when absent (legacy Wave 4 rows). */
  sms_state?: V2SmsPendingWireState;
  detected_intent:
    | "sms_tighten_request"
    | "sms_replace_request"
    | "sms_change_unspecified"
    | "sms_soft_quit_or_frustration"
    | "sms_raise_bar_request";
  raw_user_text: string;
  inbound_message_sid: string;
  ai_confidence: number | null;
  candidate_tightened_bar?: string | null;
  candidate_new_bar?: string | null;
  /** Canonical normalized bar used for confirmation + mutation. */
  candidate_behavior_statement?: string | null;
  confirmation_prompt_sent_at?: string | null;
  /** Wave 4.2 — last AI candidate extraction attempt (bounded; no prompt text). */
  ai_candidate_extraction_used?: boolean;
  ai_candidate_confidence?: number | null;
  ai_candidate_accepted?: boolean | null;
  ai_candidate_rejected_reason?: string | null;
  ai_reasoning_short?: string | null;
  /** Wave 9.1 — bounded snapshot from memory_signal interpreter (JSON-safe subset only). */
  memory_signal_snapshot?: Record<string, unknown> | null;
  last_inbound_memory_signal_at?: string | null;

  /** Phase 1 — Commitment Meaning Interpreter snapshot (optional JSON; no DB migration). */
  meaning_interpreter_prompt_version?: string | null;
  meaning_interpreter_interpreted_bar?: string | null;
  meaning_interpreter_needs_clarification?: boolean | null;
  meaning_interpreter_clarification_question?: string | null;
  meaning_interpreter_confidence?: number | null;
  meaning_interpreter_ok?: boolean | null;
  meaning_interpreter_error?: string | null;

  /** Pre-push season lifecycle — bundled goal-change alignment (Wave season slice). */
  season_mode?: "same_season_sync" | "new_chapter";
  season_mode_reason?: string | null;
  season_mode_set_at?: string | null;

  /** Slice 2B — TU awaiting_candidate shell metadata (JSON-only; no migration). */
  tu_goal_change_type?: import("@/lib/openai-relationship-turn-understanding-v1").TurnUnderstandingGoalAdjustmentType;
  tu_goal_change_source?: import("@/lib/openai-relationship-turn-understanding-v1").TurnUnderstandingGoalChangeSource;
  tu_goal_change_confidence?: import("@/lib/openai-relationship-turn-understanding-v1").TurnUnderstandingGoalChangeConfidenceLevel;
  awaiting_candidate_reason?: "goal_change_without_concrete_bar" | "accepted_coach_goal_evolution_invite" | "user_completed_goal_wants_new_bar" | "vague_theme_needs_concrete_bar";
  goal_change_requires_confirmation?: boolean;
  prior_goal_change_ask_satisfied?: boolean;
  stale_ask_goal_change_bridge_eligible?: boolean;
  no_outcome_write?: boolean;
  no_state_change_taken?: boolean;
  coach_initiated_goal_evolution?: true;
  accepted_invite_kind?: string | null;
  accepted_invite_source?: string | null;
  accepted_invite_sent_at?: string | null;
  accepted_invite_evidence_summary?: string | null;
};

/** In-app proactive goal change (sets commitment_replace pending before canonical RPC). */
export type V2AppGoalChangePendingPayload = {
  source: "app_goal_change";
  raw_user_text: string;
  candidate_behavior_statement: string;
  season_mode?: SmsSeasonMode;
  season_mode_reason?: string | null;
  client_request_id: string;
  confirmed_at: string;
};

export type V2PendingResolutionPayload =
  | V2GuidedResolutionPayload
  | V2SmsPendingResolutionPayload
  | V2AppGoalChangePendingPayload;

export type EnsureCommitmentReplacePendingResult =
  | { ok: true; commitment: ActiveV2CommitmentRow }
  | { ok: false; code: string; message: string };

/** Proactive app goal-change: block overwriting refresh/SMS pending handoffs. */
export const V2_APP_GOAL_CHANGE_PENDING_BLOCK_MESSAGE =
  "You already have an accountability update waiting. Finish that first, then you can update your goal.";

export const V2_COMPETING_APP_GOAL_CHANGE_MESSAGE =
  "Another goal update is already in progress. Refresh and try again.";

export function isValidPendingResolutionKind(v: unknown): v is V2PendingResolutionKind {
  return (
    v === "identity_anchor_update" ||
    v === "commitment_replace" ||
    v === "commitment_tighten"
  );
}

function parsePayload(raw: unknown): V2PendingResolutionPayload | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.source === "sms_inbound") {
    const detected = o.detected_intent;
    if (
      detected !== "sms_tighten_request" &&
      detected !== "sms_replace_request" &&
      detected !== "sms_change_unspecified" &&
      detected !== "sms_soft_quit_or_frustration" &&
      detected !== "sms_raise_bar_request"
    ) {
      return null;
    }
    const raw_user_text = typeof o.raw_user_text === "string" ? o.raw_user_text.trim() : "";
    const inbound_message_sid =
      typeof o.inbound_message_sid === "string" ? o.inbound_message_sid.trim() : "";
    if (!raw_user_text || !inbound_message_sid) return null;
    const ac = o.ai_confidence;
    const ai_confidence =
      typeof ac === "number" && Number.isFinite(ac) ? ac : null;
    const ctb = o.candidate_tightened_bar;
    const cnb = o.candidate_new_bar;
    const cbs = o.candidate_behavior_statement;
    const smsRaw = o.sms_state;
    const sms_state =
      smsRaw === "awaiting_candidate" ||
      smsRaw === "awaiting_confirmation" ||
      smsRaw === "candidate_received" ||
      smsRaw === "confirmed" ||
      smsRaw === "cancelled"
        ? smsRaw
        : undefined;
    const cps = o.confirmation_prompt_sent_at;
    const aceu = o.ai_candidate_extraction_used;
    const acc = o.ai_candidate_confidence;
    const aca = o.ai_candidate_accepted;
    const acrr = o.ai_candidate_rejected_reason;
    const ars = o.ai_reasoning_short;
    return {
      source: "sms_inbound",
      ...(sms_state ? { sms_state } : {}),
      detected_intent: detected,
      raw_user_text,
      inbound_message_sid,
      ai_confidence,
      candidate_tightened_bar: typeof ctb === "string" ? ctb : null,
      candidate_new_bar: typeof cnb === "string" ? cnb : null,
      candidate_behavior_statement: typeof cbs === "string" ? cbs : null,
      confirmation_prompt_sent_at: typeof cps === "string" ? cps : null,
      ...(aceu === true || aceu === false ? { ai_candidate_extraction_used: aceu } : {}),
      ...(typeof acc === "number" && Number.isFinite(acc) ? { ai_candidate_confidence: acc } : {}),
      ...(aca === true || aca === false ? { ai_candidate_accepted: aca } : {}),
      ...(typeof acrr === "string" ? { ai_candidate_rejected_reason: acrr } : {}),
      ...(typeof ars === "string" ? { ai_reasoning_short: ars } : {}),
      ...(o.memory_signal_snapshot != null &&
      typeof o.memory_signal_snapshot === "object" &&
      !Array.isArray(o.memory_signal_snapshot)
        ? { memory_signal_snapshot: o.memory_signal_snapshot as Record<string, unknown> }
        : {}),
      ...(typeof o.last_inbound_memory_signal_at === "string"
        ? { last_inbound_memory_signal_at: o.last_inbound_memory_signal_at }
        : {}),
      ...(typeof o.meaning_interpreter_prompt_version === "string"
        ? { meaning_interpreter_prompt_version: o.meaning_interpreter_prompt_version }
        : {}),
      ...(typeof o.meaning_interpreter_interpreted_bar === "string"
        ? { meaning_interpreter_interpreted_bar: o.meaning_interpreter_interpreted_bar }
        : {}),
      ...(o.meaning_interpreter_needs_clarification === true || o.meaning_interpreter_needs_clarification === false
        ? { meaning_interpreter_needs_clarification: o.meaning_interpreter_needs_clarification }
        : {}),
      ...(typeof o.meaning_interpreter_clarification_question === "string"
        ? { meaning_interpreter_clarification_question: o.meaning_interpreter_clarification_question }
        : {}),
      ...(typeof o.meaning_interpreter_confidence === "number" && Number.isFinite(o.meaning_interpreter_confidence)
        ? { meaning_interpreter_confidence: o.meaning_interpreter_confidence }
        : {}),
      ...(o.meaning_interpreter_ok === true || o.meaning_interpreter_ok === false
        ? { meaning_interpreter_ok: o.meaning_interpreter_ok }
        : {}),
      ...(typeof o.meaning_interpreter_error === "string"
        ? { meaning_interpreter_error: o.meaning_interpreter_error }
        : {}),
      ...(o.season_mode === "same_season_sync" || o.season_mode === "new_chapter"
        ? { season_mode: o.season_mode }
        : {}),
      ...(typeof o.season_mode_reason === "string"
        ? { season_mode_reason: o.season_mode_reason }
        : {}),
      ...(typeof o.season_mode_set_at === "string"
        ? { season_mode_set_at: o.season_mode_set_at }
        : {}),
    };
  }
  if (o.source === "app_goal_change") {
    const raw_user_text = typeof o.raw_user_text === "string" ? o.raw_user_text.trim() : "";
    const candidate_behavior_statement =
      typeof o.candidate_behavior_statement === "string"
        ? o.candidate_behavior_statement.trim()
        : "";
    const client_request_id =
      typeof o.client_request_id === "string" ? o.client_request_id.trim() : "";
    const confirmed_at = typeof o.confirmed_at === "string" ? o.confirmed_at.trim() : "";
    if (!raw_user_text || !candidate_behavior_statement || !client_request_id || !confirmed_at) {
      return null;
    }
    return {
      source: "app_goal_change",
      raw_user_text,
      candidate_behavior_statement,
      ...(o.season_mode === "same_season_sync" || o.season_mode === "new_chapter"
        ? { season_mode: o.season_mode }
        : {}),
      ...(typeof o.season_mode_reason === "string"
        ? { season_mode_reason: o.season_mode_reason }
        : {}),
      client_request_id,
      confirmed_at,
    };
  }
  if (o.source !== "coaching_refresh_resolved") return null;
  if (o.resolution !== "change" && o.resolution !== "new" && o.resolution !== "tighten") return null;
  const session_id = typeof o.session_id === "string" ? o.session_id.trim() : "";
  const inbound_message_sid =
    typeof o.inbound_message_sid === "string" ? o.inbound_message_sid.trim() : "";
  if (!session_id || !inbound_message_sid) return null;
  return {
    source: "coaching_refresh_resolved",
    resolution: o.resolution,
    session_id,
    inbound_message_sid,
  };
}

export function getPendingResolutionOrNull(row: ActiveV2CommitmentRow): {
  kind: V2PendingResolutionKind;
  createdAt: string;
  expiresAt: string;
  payload: V2PendingResolutionPayload | null;
} | null {
  const kind = row.pending_resolution_kind;
  if (!isValidPendingResolutionKind(kind)) return null;
  const created =
    typeof row.pending_resolution_created_at === "string"
      ? row.pending_resolution_created_at.trim()
      : "";
  const expires =
    typeof row.pending_resolution_expires_at === "string"
      ? row.pending_resolution_expires_at.trim()
      : "";
  if (!created || !expires) return null;
  return {
    kind,
    createdAt: created,
    expiresAt: expires,
    payload: parsePayload(row.pending_resolution_payload),
  };
}

export function isPendingResolutionExpired(row: ActiveV2CommitmentRow, nowMs: number): boolean {
  const p = getPendingResolutionOrNull(row);
  if (!p) return false;
  const t = new Date(p.expiresAt).getTime();
  if (!Number.isFinite(t)) return true;
  return nowMs >= t;
}

/**
 * If TTL passed, clear pending columns. Returns true if a row was updated.
 */
export async function clearPendingResolutionIfExpired(
  commitmentId: string,
  row: ActiveV2CommitmentRow,
  nowMs: number = Date.now()
): Promise<boolean> {
  if (!getPendingResolutionOrNull(row)) return false;
  if (!isPendingResolutionExpired(row, nowMs)) return false;
  await clearPendingResolution(commitmentId, { expectedUpdatedAt: row.updated_at });
  return true;
}

export async function clearPendingResolution(
  commitmentId: string,
  options?: { expectedUpdatedAt?: string | null }
): Promise<string | null> {
  const nowIso = new Date().toISOString();
  let q = supabaseServer
    .from("v2_commitment")
    .update({
      pending_resolution_kind: null,
      pending_resolution_created_at: null,
      pending_resolution_expires_at: null,
      pending_resolution_payload: null,
      updated_at: nowIso,
    })
    .eq("id", commitmentId);
  if (typeof options?.expectedUpdatedAt === "string" && options.expectedUpdatedAt.trim()) {
    q = q.eq("updated_at", options.expectedUpdatedAt.trim());
  }
  const { data, error } = await q.select("updated_at").maybeSingle();

  if (error) {
    throw new Error(
      `[v2-guided-resolution] clearPendingResolution failed: ${error.message}`
    );
  }
  if (typeof options?.expectedUpdatedAt === "string" && options.expectedUpdatedAt.trim() && !data) {
    throw new Error(
      `[v2-guided-resolution] clearPendingResolution CAS mismatch for commitment_id=${commitmentId}`
    );
  }
  return typeof data?.updated_at === "string" ? data.updated_at : nowIso;
}

/**
 * Merge fields into an existing sms_inbound pending_resolution_payload with CAS on commitment.updated_at.
 */
export async function mergeSmsPendingResolutionPayload(args: {
  commitmentId: string;
  merge: (prev: V2SmsPendingResolutionPayload) => V2SmsPendingResolutionPayload;
}): Promise<{ ok: true; updatedAt: string } | { ok: false; error: string }> {
  const { data: row, error: fetchErr } = await supabaseServer
    .from("v2_commitment")
    .select("updated_at, pending_resolution_payload")
    .eq("id", args.commitmentId)
    .maybeSingle();

  if (fetchErr) {
    return { ok: false, error: fetchErr.message };
  }
  if (!row?.updated_at) {
    return { ok: false, error: "not_found" };
  }

  const prev = parsePayload(row.pending_resolution_payload);
  if (!prev || prev.source !== "sms_inbound") {
    return { ok: false, error: "not_sms_payload" };
  }

  const next = args.merge(prev);
  const nowIso = new Date().toISOString();

  const { data: up, error: upErr } = await supabaseServer
    .from("v2_commitment")
    .update({
      pending_resolution_payload: next as unknown as Record<string, unknown>,
      updated_at: nowIso,
    })
    .eq("id", args.commitmentId)
    .eq("updated_at", row.updated_at)
    .select("updated_at")
    .maybeSingle();

  if (upErr) {
    return { ok: false, error: upErr.message };
  }
  if (!up?.updated_at) {
    return { ok: false, error: "cas_mismatch" };
  }
  return { ok: true, updatedAt: up.updated_at };
}

/**
 * Ensures `pending_resolution_kind = commitment_replace` before canonical season RPC.
 * Does not fake sms_inbound source.
 */
export async function ensureCommitmentReplacePendingForCanonicalGoalChange(args: {
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
  behaviorStatement: string;
  seasonMode: SmsSeasonMode;
  seasonModeReason?: string;
  clientRequestId: string;
  nowMs?: number;
  /** When true, only merge an existing app_goal_change pending with the same client_request_id. */
  allowExistingAppGoalChangeOnly?: boolean;
}): Promise<EnsureCommitmentReplacePendingResult> {
  const nowMs = args.nowMs ?? Date.now();
  let commitment = args.commitment;

  if (commitment.accountability_phase === "low_pressure_reactivation") {
    return {
      ok: false,
      code: "low_pressure_reactivation",
      message: "Goal changes are not available during low-pressure reactivation.",
    };
  }

  await clearPendingResolutionIfExpired(commitment.id, commitment, nowMs);
  const reloaded = await getActiveCommitment(args.clerkUserId);
  if (!reloaded?.id) {
    return { ok: false, code: "no_active_commitment", message: "No active commitment." };
  }
  commitment = reloaded;

  const pending = getPendingResolutionOrNull(commitment);
  if (pending && isPendingResolutionExpired(commitment, nowMs)) {
    await clearPendingResolution(commitment.id, { expectedUpdatedAt: commitment.updated_at });
    const afterClear = await getActiveCommitment(args.clerkUserId);
    if (!afterClear?.id) {
      return { ok: false, code: "no_active_commitment", message: "No active commitment." };
    }
    commitment = afterClear;
  }

  const pendingNow = getPendingResolutionOrNull(commitment);
  if (pendingNow && isSmsInboundPendingResolutionActionable(commitment, nowMs)) {
    return {
      ok: false,
      code: "sms_pending_in_flight",
      message: "Finish or cancel your text thread update before changing your goal in the app.",
    };
  }

  if (pendingNow?.kind === "commitment_tighten") {
    return {
      ok: false,
      code: "pending_tighten",
      message: "Finish your smaller-bar follow-up in guided resolution first.",
    };
  }
  if (pendingNow?.kind === "identity_anchor_update") {
    return {
      ok: false,
      code: "pending_identity",
      message: "Finish your identity update in guided resolution first.",
    };
  }

  if (args.allowExistingAppGoalChangeOnly && pendingNow) {
    if (pendingNow.kind !== "commitment_replace") {
      return {
        ok: false,
        code: "pending_other_update",
        message: V2_APP_GOAL_CHANGE_PENDING_BLOCK_MESSAGE,
      };
    }

    const source = pendingNow.payload?.source ?? null;
    if (source !== "app_goal_change") {
      return {
        ok: false,
        code: "pending_other_update",
        message: V2_APP_GOAL_CHANGE_PENDING_BLOCK_MESSAGE,
      };
    }

    const appPending = pendingNow.payload;
    if (!appPending || appPending.source !== "app_goal_change") {
      return {
        ok: false,
        code: "pending_other_update",
        message: V2_APP_GOAL_CHANGE_PENDING_BLOCK_MESSAGE,
      };
    }

    const existingClientId =
      typeof appPending.client_request_id === "string"
        ? appPending.client_request_id.trim()
        : "";
    const requestedClientId = args.clientRequestId.trim();
    if (!existingClientId || existingClientId !== requestedClientId) {
      return {
        ok: false,
        code: "competing_app_goal_change",
        message: V2_COMPETING_APP_GOAL_CHANGE_MESSAGE,
      };
    }
  }

  const appPayload: V2AppGoalChangePendingPayload = {
    source: "app_goal_change",
    raw_user_text: args.behaviorStatement,
    candidate_behavior_statement: args.behaviorStatement,
    season_mode: args.seasonMode,
    season_mode_reason: args.seasonModeReason ?? null,
    client_request_id: args.clientRequestId,
    confirmed_at: new Date(nowMs).toISOString(),
  };

  if (
    pendingNow?.kind === "commitment_replace" &&
    (!args.allowExistingAppGoalChangeOnly ||
      pendingNow.payload?.source === "app_goal_change")
  ) {
    const merged = await mergeCommitmentReplacePendingPayload({
      commitmentId: commitment.id,
      payload: appPayload,
      expectedUpdatedAt: commitment.updated_at,
    });
    if (!merged.ok) {
      return {
        ok: false,
        code: "pending_merge_failed",
        message: "Could not prepare goal change. Refresh and try again.",
      };
    }
    const afterMerge = await getActiveCommitment(args.clerkUserId);
    if (!afterMerge?.id) {
      return { ok: false, code: "no_active_commitment", message: "No active commitment." };
    }
    return { ok: true, commitment: afterMerge };
  }

  try {
    await setPendingResolution({
      commitmentId: commitment.id,
      kind: "commitment_replace",
      payload: appPayload,
      nowMs,
      expectedUpdatedAt: commitment.updated_at,
    });
  } catch {
    return {
      ok: false,
      code: "pending_set_failed",
      message: "Could not prepare goal change. Refresh and try again.",
    };
  }

  const afterSet = await getActiveCommitment(args.clerkUserId);
  if (!afterSet?.id) {
    return { ok: false, code: "no_active_commitment", message: "No active commitment." };
  }
  return { ok: true, commitment: afterSet };
}

async function mergeCommitmentReplacePendingPayload(args: {
  commitmentId: string;
  payload: V2AppGoalChangePendingPayload;
  expectedUpdatedAt: string | null;
}): Promise<{ ok: true; updatedAt: string } | { ok: false; error: string }> {
  const { data: row, error: fetchErr } = await supabaseServer
    .from("v2_commitment")
    .select("updated_at, pending_resolution_kind, pending_resolution_payload")
    .eq("id", args.commitmentId)
    .maybeSingle();

  if (fetchErr) return { ok: false, error: fetchErr.message };
  if (!row?.updated_at) return { ok: false, error: "not_found" };
  if (row.pending_resolution_kind !== "commitment_replace") {
    return { ok: false, error: "not_commitment_replace" };
  }

  const prevPayload = parsePayload(row.pending_resolution_payload);
  if (!prevPayload || prevPayload.source !== "app_goal_change") {
    return { ok: false, error: "not_app_goal_change" };
  }

  const prev =
    row.pending_resolution_payload != null &&
    typeof row.pending_resolution_payload === "object" &&
    !Array.isArray(row.pending_resolution_payload)
      ? (row.pending_resolution_payload as Record<string, unknown>)
      : {};

  const next: Record<string, unknown> = {
    ...prev,
    ...args.payload,
  };

  const nowIso = new Date().toISOString();
  let q = supabaseServer
    .from("v2_commitment")
    .update({
      pending_resolution_payload: next,
      updated_at: nowIso,
    })
    .eq("id", args.commitmentId);

  if (typeof args.expectedUpdatedAt === "string" && args.expectedUpdatedAt.trim()) {
    q = q.eq("updated_at", args.expectedUpdatedAt.trim());
  }

  const { data: up, error: upErr } = await q.select("updated_at").maybeSingle();
  if (upErr) return { ok: false, error: upErr.message };
  if (!up?.updated_at) return { ok: false, error: "cas_mismatch" };
  return { ok: true, updatedAt: up.updated_at };
}

export function isSmsInboundPendingResolutionActionable(
  row: ActiveV2CommitmentRow,
  nowMs: number = Date.now()
): boolean {
  const p = getPendingResolutionOrNull(row);
  if (!p?.payload || p.payload.source !== "sms_inbound") return false;
  if (p.kind !== "commitment_replace" && p.kind !== "commitment_tighten") return false;
  if (isPendingResolutionExpired(row, nowMs)) return false;
  const st = p.payload.sms_state ?? "awaiting_candidate";
  if (st === "confirmed" || st === "cancelled") return false;
  return true;
}

export async function setPendingResolution(args: {
  commitmentId: string;
  kind: V2PendingResolutionKind;
  payload: V2PendingResolutionPayload;
  nowMs?: number;
  expectedUpdatedAt?: string | null;
}): Promise<string | null> {
  const nowMs = args.nowMs ?? Date.now();
  const createdIso = new Date(nowMs).toISOString();
  const expiresIso = new Date(nowMs + V2_GUIDED_RESOLUTION_TTL_MS).toISOString();

  let q = supabaseServer
    .from("v2_commitment")
    .update({
      pending_resolution_kind: args.kind,
      pending_resolution_created_at: createdIso,
      pending_resolution_expires_at: expiresIso,
      pending_resolution_payload: args.payload as unknown as Record<string, unknown>,
      updated_at: createdIso,
    })
    .eq("id", args.commitmentId);
  if (typeof args.expectedUpdatedAt === "string" && args.expectedUpdatedAt.trim()) {
    q = q.eq("updated_at", args.expectedUpdatedAt.trim());
  }
  const { data, error } = await q.select("updated_at").maybeSingle();

  if (error) {
    throw new Error(
      `[v2-guided-resolution] setPendingResolution failed: ${error.message}`
    );
  }
  if (typeof args.expectedUpdatedAt === "string" && args.expectedUpdatedAt.trim() && !data) {
    throw new Error(
      `[v2-guided-resolution] setPendingResolution CAS mismatch for commitment_id=${args.commitmentId}`
    );
  }
  if (!data) {
    throw new Error(
      `[v2-guided-resolution] setPendingResolution no rows updated for commitment_id=${args.commitmentId}`
    );
  }
  return typeof data.updated_at === "string" ? data.updated_at : createdIso;
}

function appBaseUrl(): string {
  const u =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "";
  return u.replace(/\/+$/, "");
}

/** HTTPS link to the single guided resolution page (no PII in URL). */
export function buildGuidedResolutionUrl(): string {
  const base = appBaseUrl();
  const path = "/dashboard/guided-resolution";
  if (!base) return path;
  return `${base}${path}`;
}

export function buildGuidedResolutionChangeHandoffSms(): { body: string } {
  const url = buildGuidedResolutionUrl();
  return {
    body: `Got it. Finish your identity line in the app (~2 min): ${url}`,
  };
}

export function buildGuidedResolutionNewHandoffSms(): { body: string } {
  const url = buildGuidedResolutionUrl();
  return {
    body: `Understood. Update your accountability focus in the app: ${url}`,
  };
}

export function buildGuidedTightenHandoffSms(): { body: string } {
  const url = buildGuidedResolutionUrl();
  return {
    body: `Noted—let’s set a smaller bar you can honestly say yes to. Finish in the app (~2 min), then you’ll get a short follow-up text here: ${url}`,
  };
}

/**
 * When SMS pending-resolution already sent a confirmation question recently, skip the daily
 * pending-resolution reminder for that window (avoids duplicate “should I make that the bar?” SMS).
 */
export function shouldSkipPendingResolutionDailyReminderDueToRecentConfirmation(args: {
  row: ActiveV2CommitmentRow;
  nowMs: number;
}): {
  skip: boolean;
  smsState: string | null;
  candidatePresent: boolean;
  confirmationPromptAgeMinutes: number | null;
} {
  const p = getPendingResolutionOrNull(args.row);
  const payload = p?.payload;
  if (!payload || payload.source !== "sms_inbound") {
    return {
      skip: false,
      smsState: null,
      candidatePresent: false,
      confirmationPromptAgeMinutes: null,
    };
  }
  const smsState = payload.sms_state ?? "awaiting_candidate";
  const cand =
    payload.candidate_behavior_statement?.trim() ||
    payload.candidate_tightened_bar?.trim() ||
    payload.candidate_new_bar?.trim() ||
    "";
  const candidatePresent = Boolean(cand);
  const cps = typeof payload.confirmation_prompt_sent_at === "string" ? payload.confirmation_prompt_sent_at.trim() : "";
  if (smsState !== "awaiting_confirmation" || !candidatePresent || !cps) {
    return { skip: false, smsState, candidatePresent, confirmationPromptAgeMinutes: null };
  }
  const sentMs = Date.parse(cps);
  if (!Number.isFinite(sentMs)) {
    return { skip: false, smsState, candidatePresent, confirmationPromptAgeMinutes: null };
  }
  const ageMs = args.nowMs - sentMs;
  if (ageMs < 0) {
    return { skip: false, smsState, candidatePresent, confirmationPromptAgeMinutes: null };
  }
  const confirmationPromptAgeMinutes = Math.round(ageMs / 60000);
  if (ageMs < V2_PENDING_RESOLUTION_CONFIRMATION_REMINDER_SUPPRESS_MS) {
    return { skip: true, smsState, candidatePresent, confirmationPromptAgeMinutes };
  }
  return { skip: false, smsState, candidatePresent, confirmationPromptAgeMinutes };
}

/**
 * Short human reminder when `pending_resolution_*` is active — not a normal YES/NO check-in.
 * SMS-native Wave 4.1 uses different copy when source is sms_inbound.
 */
export function buildPendingResolutionDailyReminderSms(row: ActiveV2CommitmentRow): { body: string; templateId: number } {
  const p = getPendingResolutionOrNull(row);
  const payload = p?.payload;
  if (payload?.source === "sms_inbound") {
    const st = payload.sms_state ?? "awaiting_candidate";
    const cand = (
      payload.candidate_behavior_statement?.trim() ||
      payload.candidate_tightened_bar?.trim() ||
      payload.candidate_new_bar?.trim() ||
      ""
    ).slice(0, 160);
    if (st === "awaiting_confirmation" && cand) {
      return {
        body: `Let’s finish the commitment update. I’m holding this candidate: ${cand}. Should I make that the new bar?`,
        templateId: 89,
      };
    }
    return {
      body:
        "Let’s finish the commitment update so I’m holding you to the right thing. What should the new daily bar be?",
      templateId: 89,
    };
  }

  return {
    body:
      "Let’s finish the commitment update we started so I’m holding you to the right thing. Open the app when you can, or text me one clear sentence for the new bar if you’re still deciding.",
    templateId: 89,
  };
}

/** Prompt mirror only — does not validate expiry. */
export function mirrorPendingResolutionForPrompt(row: {
  pending_resolution_kind?: string | null;
  pending_resolution_expires_at?: string | null;
}): { pending_resolution_kind: string | null; pending_resolution_expires_at: string | null } {
  const kind =
    typeof row.pending_resolution_kind === "string" ? row.pending_resolution_kind.trim() : null;
  const ex =
    typeof row.pending_resolution_expires_at === "string"
      ? row.pending_resolution_expires_at.trim()
      : null;
  if (!kind || !ex) return { pending_resolution_kind: null, pending_resolution_expires_at: null };
  if (!isValidPendingResolutionKind(kind)) {
    return { pending_resolution_kind: null, pending_resolution_expires_at: null };
  }
  return { pending_resolution_kind: kind, pending_resolution_expires_at: ex };
}
