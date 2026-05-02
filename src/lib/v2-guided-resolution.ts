/**
 * V2 guided resolution: small pending state on `v2_commitment` after refresh SMS
 * hands the user to one dashboard page. Not a strategy engine — UX glue only.
 */

import { supabaseServer } from "@/lib/supabase-server";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";

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
    | "sms_soft_quit_or_frustration";
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
};

export type V2PendingResolutionPayload = V2GuidedResolutionPayload | V2SmsPendingResolutionPayload;

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
      detected !== "sms_soft_quit_or_frustration"
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
