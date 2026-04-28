import { supabaseServer } from "@/lib/supabase-server";
import type { V2AccountabilityPhase } from "@/lib/v2-accountability-phase";

export type V2AccountabilityOutcome = "user_yes" | "user_no" | "user_partial";

/** Active V2 commitment row (subset of columns used by SMS + cron). */
export type ActiveV2CommitmentRow = {
  id: string;
  clerk_user_id: string;
  status: string;
  behavior_statement: string;
  title: string;
  success_criteria: string | null;
  blocker_capture_expires_at: string | null;
  blocker_capture_after_event: string | null;
  adaptive_ask_text: string | null;
  adaptive_ask_active_from: string | null;
  adaptive_ask_expires_at: string | null;
  adaptive_proposal_text: string | null;
  adaptive_proposal_created_at: string | null;
  adaptive_proposal_expires_at: string | null;
  accountability_phase: V2AccountabilityPhase;
  reactivation_entered_at: string | null;
  reactivation_last_sent_at: string | null;
  reactivation_entry_reason_code: string | null;
  /** JSONB refresh session state; authoritative on row. */
  refresh_session: unknown | null;
  commitment_refresh_last_prompted_at: string | null;
  pending_resolution_kind: string | null;
  pending_resolution_created_at: string | null;
  pending_resolution_expires_at: string | null;
  pending_resolution_payload: unknown | null;
  /** Row metadata (Supabase `v2_commitment.updated_at`). */
  updated_at: string | null;
};

/** Bounded rows for V2 AI + rule engine (newest first). */
export type V2EventRowForAi = {
  event_type: string;
  occurred_at: string;
  payload_json: Record<string, unknown>;
};

const BLOCKER_CAPTURE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Returns the user's active V2 commitment, if any.
 * Legacy SMS paths should treat a null result as "not on V2 accountability".
 */
export async function getActiveCommitment(
  clerkUserId: string
): Promise<ActiveV2CommitmentRow | null> {
  const { data, error } = await supabaseServer
    .from("v2_commitment")
    .select(
      "id, clerk_user_id, status, behavior_statement, title, success_criteria, blocker_capture_expires_at, blocker_capture_after_event, adaptive_ask_text, adaptive_ask_active_from, adaptive_ask_expires_at, adaptive_proposal_text, adaptive_proposal_created_at, adaptive_proposal_expires_at, accountability_phase, reactivation_entered_at, reactivation_last_sent_at, reactivation_entry_reason_code, refresh_session, commitment_refresh_last_prompted_at, pending_resolution_kind, pending_resolution_created_at, pending_resolution_expires_at, pending_resolution_payload, updated_at"
    )
    .eq("clerk_user_id", clerkUserId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.error("[v2-commitment] getActiveCommitment failed", {
      clerk_user_id: clerkUserId,
      message: error.message,
    });
    return null;
  }

  if (!data || typeof data.behavior_statement !== "string") {
    return null;
  }

  const row = data as Record<string, unknown>;
  return mapRowToActiveV2Commitment(row);
}

function parseAccountabilityPhase(v: unknown): V2AccountabilityPhase {
  return v === "low_pressure_reactivation" ? "low_pressure_reactivation" : "active_accountability";
}

function mapRowToActiveV2Commitment(row: Record<string, unknown>): ActiveV2CommitmentRow {
  return {
    id: String(row.id),
    clerk_user_id: String(row.clerk_user_id),
    status: String(row.status),
    behavior_statement: String(row.behavior_statement),
    title: String(row.title),
    success_criteria:
      row.success_criteria != null && typeof row.success_criteria === "string"
        ? row.success_criteria
        : null,
    blocker_capture_expires_at:
      row.blocker_capture_expires_at != null && typeof row.blocker_capture_expires_at === "string"
        ? row.blocker_capture_expires_at
        : null,
    blocker_capture_after_event:
      row.blocker_capture_after_event != null && typeof row.blocker_capture_after_event === "string"
        ? row.blocker_capture_after_event
        : null,
    adaptive_ask_text:
      row.adaptive_ask_text != null && typeof row.adaptive_ask_text === "string"
        ? row.adaptive_ask_text
        : null,
    adaptive_ask_active_from:
      row.adaptive_ask_active_from != null && typeof row.adaptive_ask_active_from === "string"
        ? row.adaptive_ask_active_from
        : null,
    adaptive_ask_expires_at:
      row.adaptive_ask_expires_at != null && typeof row.adaptive_ask_expires_at === "string"
        ? row.adaptive_ask_expires_at
        : null,
    adaptive_proposal_text:
      row.adaptive_proposal_text != null && typeof row.adaptive_proposal_text === "string"
        ? row.adaptive_proposal_text
        : null,
    adaptive_proposal_created_at:
      row.adaptive_proposal_created_at != null && typeof row.adaptive_proposal_created_at === "string"
        ? row.adaptive_proposal_created_at
        : null,
    adaptive_proposal_expires_at:
      row.adaptive_proposal_expires_at != null &&
      typeof row.adaptive_proposal_expires_at === "string"
        ? row.adaptive_proposal_expires_at
        : null,
    accountability_phase: parseAccountabilityPhase(row.accountability_phase),
    reactivation_entered_at:
      row.reactivation_entered_at != null && typeof row.reactivation_entered_at === "string"
        ? row.reactivation_entered_at
        : null,
    reactivation_last_sent_at:
      row.reactivation_last_sent_at != null && typeof row.reactivation_last_sent_at === "string"
        ? row.reactivation_last_sent_at
        : null,
    reactivation_entry_reason_code:
      row.reactivation_entry_reason_code != null &&
      typeof row.reactivation_entry_reason_code === "string"
        ? row.reactivation_entry_reason_code
        : null,
    refresh_session: row.refresh_session ?? null,
    commitment_refresh_last_prompted_at:
      row.commitment_refresh_last_prompted_at != null &&
      typeof row.commitment_refresh_last_prompted_at === "string"
        ? row.commitment_refresh_last_prompted_at
        : null,
    pending_resolution_kind:
      row.pending_resolution_kind != null && typeof row.pending_resolution_kind === "string"
        ? row.pending_resolution_kind
        : null,
    pending_resolution_created_at:
      row.pending_resolution_created_at != null &&
      typeof row.pending_resolution_created_at === "string"
        ? row.pending_resolution_created_at
        : null,
    pending_resolution_expires_at:
      row.pending_resolution_expires_at != null &&
      typeof row.pending_resolution_expires_at === "string"
        ? row.pending_resolution_expires_at
        : null,
    pending_resolution_payload: row.pending_resolution_payload ?? null,
    updated_at:
      row.updated_at != null && typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

/** Active commitment by id (for memory recompute / projections). */
export async function getV2CommitmentByIdForCoaching(
  commitmentId: string
): Promise<ActiveV2CommitmentRow | null> {
  const { data, error } = await supabaseServer
    .from("v2_commitment")
    .select(
      "id, clerk_user_id, status, behavior_statement, title, success_criteria, blocker_capture_expires_at, blocker_capture_after_event, adaptive_ask_text, adaptive_ask_active_from, adaptive_ask_expires_at, adaptive_proposal_text, adaptive_proposal_created_at, adaptive_proposal_expires_at, accountability_phase, reactivation_entered_at, reactivation_last_sent_at, reactivation_entry_reason_code, refresh_session, commitment_refresh_last_prompted_at, pending_resolution_kind, pending_resolution_created_at, pending_resolution_expires_at, pending_resolution_payload, updated_at"
    )
    .eq("id", commitmentId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.error("[v2-commitment] getV2CommitmentByIdForCoaching failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
    return null;
  }

  if (!data || typeof data.behavior_statement !== "string") {
    return null;
  }

  return mapRowToActiveV2Commitment(data as Record<string, unknown>);
}

export function isBlockerCapturePendingActive(row: ActiveV2CommitmentRow): boolean {
  if (!row.blocker_capture_expires_at) return false;
  const exp = new Date(row.blocker_capture_expires_at).getTime();
  if (!Number.isFinite(exp)) return false;
  return Date.now() < exp;
}

export function isBlockerCapturePendingExpired(row: ActiveV2CommitmentRow): boolean {
  if (!row.blocker_capture_expires_at) return false;
  const exp = new Date(row.blocker_capture_expires_at).getTime();
  if (!Number.isFinite(exp)) return false;
  return Date.now() >= exp;
}

export async function clearBlockerCapturePending(commitmentId: string): Promise<void> {
  const { error } = await supabaseServer
    .from("v2_commitment")
    .update({
      blocker_capture_expires_at: null,
      blocker_capture_after_event: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", commitmentId);

  if (error) {
    console.error("[v2-commitment] clearBlockerCapturePending failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
  }
}

export async function setBlockerCapturePending(
  commitmentId: string,
  afterEvent: V2AccountabilityOutcome
): Promise<void> {
  const expires = new Date(Date.now() + BLOCKER_CAPTURE_TTL_MS).toISOString();
  const { error } = await supabaseServer
    .from("v2_commitment")
    .update({
      blocker_capture_expires_at: expires,
      blocker_capture_after_event: afterEvent,
      updated_at: new Date().toISOString(),
    })
    .eq("id", commitmentId);

  if (error) {
    console.error("[v2-commitment] setBlockerCapturePending failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
  }
}

/** Latest user_yes | user_no | user_partial for this commitment (by occurred_at). */
export async function getLatestV2AccountabilityOutcome(
  commitmentId: string
): Promise<{ type: V2AccountabilityOutcome; occurred_at: string } | null> {
  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("event_type, occurred_at")
    .eq("commitment_id", commitmentId)
    .in("event_type", ["user_yes", "user_no", "user_partial"])
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[v2-commitment] getLatestV2AccountabilityOutcome failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
    return null;
  }

  if (!data?.event_type || !data.occurred_at) return null;
  const t = data.event_type as string;
  if (t !== "user_yes" && t !== "user_no" && t !== "user_partial") return null;
  return { type: t as V2AccountabilityOutcome, occurred_at: String(data.occurred_at) };
}

/** Latest blocker_captured message text strictly after `afterIso` (miss event time). */
export async function getLatestBlockerCapturedAfter(
  commitmentId: string,
  afterIso: string
): Promise<{ message: string } | null> {
  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("payload_json, occurred_at")
    .eq("commitment_id", commitmentId)
    .eq("event_type", "blocker_captured")
    .gt("occurred_at", afterIso)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[v2-commitment] getLatestBlockerCapturedAfter failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
    return null;
  }

  const payload = data?.payload_json as Record<string, unknown> | undefined;
  const msg = typeof payload?.message === "string" ? payload.message.trim() : "";
  if (!msg) return null;
  return { message: msg };
}

const V2_AI_EVENT_TYPES = [
  "check_sent",
  "user_yes",
  "user_no",
  "user_partial",
  "blocker_captured",
  "contract_overlay_proposed",
  "contract_overlay_activated",
  "contract_overlay_declined",
  "coaching_refresh_prompted",
  "coaching_refresh_resolved",
] as const;

const V2_AI_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const V2_AI_MAX_EVENTS = 25;

/**
 * Recent accountability-related events for AI / coaching rules (bounded).
 * Newest first. At most 25 rows, within the last 14 days.
 */
export async function getRecentV2EventsForAi(
  commitmentId: string
): Promise<V2EventRowForAi[]> {
  const cutoff = new Date(Date.now() - V2_AI_LOOKBACK_MS).toISOString();

  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("event_type, occurred_at, payload_json")
    .eq("commitment_id", commitmentId)
    .in("event_type", [...V2_AI_EVENT_TYPES])
    .gte("occurred_at", cutoff)
    .order("occurred_at", { ascending: false })
    .limit(V2_AI_MAX_EVENTS);

  if (error) {
    console.error("[v2-commitment] getRecentV2EventsForAi failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
    return [];
  }

  return (data ?? []).map((row) => ({
    event_type: String(row.event_type),
    occurred_at: String(row.occurred_at),
    payload_json:
      row.payload_json != null && typeof row.payload_json === "object" && !Array.isArray(row.payload_json)
        ? (row.payload_json as Record<string, unknown>)
        : {},
  }));
}

/**
 * Latest successful V2 `check_sent` for cadence / spacing (cron inserts only on Twilio success).
 */
export async function getLastV2CheckSentForCommitment(
  commitmentId: string
): Promise<{ day_key: string; payload_json: Record<string, unknown> } | null> {
  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("payload_json")
    .eq("commitment_id", commitmentId)
    .eq("event_type", "check_sent")
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[v2-commitment] getLastV2CheckSentForCommitment failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
    return null;
  }

  const payload =
    data?.payload_json != null &&
    typeof data.payload_json === "object" &&
    !Array.isArray(data.payload_json)
      ? (data.payload_json as Record<string, unknown>)
      : null;
  if (!payload) return null;
  const dk = payload.day_key;
  if (typeof dk !== "string" || !dk.trim()) return null;
  return { day_key: dk.trim(), payload_json: payload };
}

/** Latest N successful `check_sent` rows (Twilio success path), newest first. */
export async function getLastNV2CheckSentPayloads(
  commitmentId: string,
  n: number
): Promise<{ payload_json: Record<string, unknown>; occurred_at: string }[]> {
  if (n <= 0) return [];
  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("payload_json, occurred_at")
    .eq("commitment_id", commitmentId)
    .eq("event_type", "check_sent")
    .order("occurred_at", { ascending: false })
    .limit(n);

  if (error) {
    console.error("[v2-commitment] getLastNV2CheckSentPayloads failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
    return [];
  }

  const out: { payload_json: Record<string, unknown>; occurred_at: string }[] = [];
  for (const row of data ?? []) {
    const p = row.payload_json;
    const payload =
      p != null && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
    if (!payload || !row.occurred_at) continue;
    out.push({ payload_json: payload, occurred_at: String(row.occurred_at) });
  }
  return out;
}

export async function enterLowPressureReactivationMode(
  commitmentId: string,
  reasonCode: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseServer
    .from("v2_commitment")
    .update({
      accountability_phase: "low_pressure_reactivation",
      reactivation_entered_at: now,
      reactivation_entry_reason_code: reasonCode,
      pending_resolution_kind: null,
      pending_resolution_created_at: null,
      pending_resolution_expires_at: null,
      pending_resolution_payload: null,
      updated_at: now,
    })
    .eq("id", commitmentId)
    .eq("accountability_phase", "active_accountability")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[v2-commitment] enterLowPressureReactivationMode failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
    return false;
  }
  return Boolean(data?.id);
}

export async function exitLowPressureReactivationOnInbound(commitmentId: string): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseServer
    .from("v2_commitment")
    .update({
      accountability_phase: "active_accountability",
      reactivation_entered_at: null,
      reactivation_entry_reason_code: null,
      updated_at: now,
    })
    .eq("id", commitmentId)
    .eq("accountability_phase", "low_pressure_reactivation")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[v2-commitment] exitLowPressureReactivationOnInbound failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
    return false;
  }
  return Boolean(data?.id);
}

export async function updateReactivationLastSentAt(commitmentId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseServer
    .from("v2_commitment")
    .update({
      reactivation_last_sent_at: now,
      updated_at: now,
    })
    .eq("id", commitmentId);

  if (error) {
    console.error("[v2-commitment] updateReactivationLastSentAt failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
  }
}
