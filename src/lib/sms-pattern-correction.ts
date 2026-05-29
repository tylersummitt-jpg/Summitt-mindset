/**
 * Durable SMS pattern correction hints (review/storage only).
 * Non-authoritative — must not be wired into live SMS routing until explicitly approved.
 */

import {
  normalizePatternText,
  validateSmsPatternCorrectionInsert,
  type SmsPatternCorrectionInsertInput,
  type SmsPatternCorrectionStatus,
  type SmsPatternCorrectionType,
  type ValidatedSmsPatternCorrectionInsert,
} from "@/lib/sms-pattern-correction-schema";
import { supabaseServer } from "@/lib/supabase-server";

export type SmsPatternCorrectionRow = {
  id: string;
  scope: string;
  clerk_user_id: string | null;
  commitment_id: string | null;
  correction_type: string;
  phrase_pattern: string | null;
  normalized_pattern: string | null;
  meaning_label: string;
  correction_summary: string;
  usage_policy: string;
  status: string;
  source: string;
  source_shadow_id: string | null;
  source_event_id: string | null;
  source_message_sid: string | null;
  confidence: number | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  use_count: number;
  metadata: Record<string, unknown>;
};

export function normalizeSmsPatternCorrectionInput(
  input: SmsPatternCorrectionInsertInput
): ValidatedSmsPatternCorrectionInsert {
  return validateSmsPatternCorrectionInsert(input);
}

export async function createSmsPatternCorrection(
  input: SmsPatternCorrectionInsertInput
): Promise<{ ok: true; row: SmsPatternCorrectionRow } | { ok: false; error: string }> {
  let validated: ValidatedSmsPatternCorrectionInsert;
  try {
    validated = validateSmsPatternCorrectionInsert(input);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const now = new Date().toISOString();
  const row = {
    scope: validated.scope,
    clerk_user_id: validated.clerk_user_id,
    commitment_id: validated.commitment_id,
    correction_type: validated.correction_type,
    phrase_pattern: validated.phrase_pattern,
    normalized_pattern: validated.normalized_pattern,
    meaning_label: validated.meaning_label,
    correction_summary: validated.correction_summary,
    usage_policy: validated.usage_policy,
    status: validated.status,
    source: validated.source,
    source_shadow_id: validated.source_shadow_id,
    source_event_id: validated.source_event_id,
    source_message_sid: validated.source_message_sid,
    confidence: validated.confidence,
    review_note: validated.review_note,
    reviewed_by: validated.reviewed_by,
    reviewed_at: validated.reviewed_at,
    created_by: validated.created_by,
    expires_at: validated.expires_at,
    use_count: 0,
    metadata: validated.metadata,
    updated_at: now,
  };

  const { data, error } = await supabaseServer
    .from("v2_sms_pattern_correction")
    .insert(row)
    .select()
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, row: data as SmsPatternCorrectionRow };
}

export type ListApprovedSmsPatternCorrectionsFilters = {
  clerk_user_id?: string;
  commitment_id?: string;
  correction_type?: SmsPatternCorrectionType;
  scope?: "user" | "commitment" | "global";
  limit?: number;
};

/**
 * Read approved corrections for operator review / future prompt integration (not wired to inbound yet).
 */
export async function listApprovedSmsPatternCorrectionsForReview(
  filters: ListApprovedSmsPatternCorrectionsFilters = {}
): Promise<{ ok: true; rows: SmsPatternCorrectionRow[] } | { ok: false; error: string }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);

  let q = supabaseServer
    .from("v2_sms_pattern_correction")
    .select("*")
    .eq("status", "approved")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (filters.clerk_user_id) {
    q = q.eq("clerk_user_id", filters.clerk_user_id);
  }
  if (filters.commitment_id) {
    q = q.eq("commitment_id", filters.commitment_id);
  }
  if (filters.correction_type) {
    q = q.eq("correction_type", filters.correction_type);
  }
  if (filters.scope) {
    q = q.eq("scope", filters.scope);
  }

  const { data, error } = await q;

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, rows: (data ?? []) as SmsPatternCorrectionRow[] };
}

/**
 * Shadow prompt only — approved prompt_hint_only corrections (non-authoritative).
 */
export async function listApprovedSmsPatternCorrectionsForShadowPrompt(
  filters: ListApprovedSmsPatternCorrectionsFilters = {}
): Promise<{ ok: true; rows: SmsPatternCorrectionRow[] } | { ok: false; error: string }> {
  const limit = Math.min(Math.max(filters.limit ?? 8, 1), 20);

  let q = supabaseServer
    .from("v2_sms_pattern_correction")
    .select("*")
    .eq("status", "approved")
    .eq("usage_policy", "prompt_hint_only")
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (filters.clerk_user_id) {
    q = q.eq("clerk_user_id", filters.clerk_user_id);
  }
  if (filters.commitment_id) {
    q = q.eq("commitment_id", filters.commitment_id);
  }

  const { data, error } = await q;

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, rows: (data ?? []) as SmsPatternCorrectionRow[] };
}

export type UpdateSmsPatternCorrectionStatusInput = {
  id: string;
  status: SmsPatternCorrectionStatus;
  reviewed_by?: string | null;
  review_note?: string | null;
};

/**
 * Operator workflow: approve / reject / archive an existing row (storage only).
 */
export async function updateSmsPatternCorrectionStatus(
  input: UpdateSmsPatternCorrectionStatusInput
): Promise<{ ok: true; row: SmsPatternCorrectionRow } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: input.status,
    updated_at: now,
  };

  if (input.review_note !== undefined) {
    patch.review_note = input.review_note;
  }
  if (input.reviewed_by !== undefined) {
    patch.reviewed_by = input.reviewed_by;
  }
  if (input.status === "approved" || input.status === "rejected") {
    patch.reviewed_at = now;
    if (input.reviewed_by) {
      patch.reviewed_by = input.reviewed_by;
    }
  }

  const { data, error } = await supabaseServer
    .from("v2_sms_pattern_correction")
    .update(patch)
    .eq("id", input.id)
    .select()
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, row: data as SmsPatternCorrectionRow };
}

/** Re-export for callers building inserts from raw phrases. */
export { normalizePatternText };
