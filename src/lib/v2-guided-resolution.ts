/**
 * V2 guided resolution: small pending state on `v2_commitment` after refresh SMS
 * hands the user to one dashboard page. Not a strategy engine — UX glue only.
 */

import { supabaseServer } from "@/lib/supabase-server";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";

/** Time window to complete the in-app handoff (PR1). */
export const V2_GUIDED_RESOLUTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

export function isValidPendingResolutionKind(v: unknown): v is V2PendingResolutionKind {
  return (
    v === "identity_anchor_update" ||
    v === "commitment_replace" ||
    v === "commitment_tighten"
  );
}

function parsePayload(raw: unknown): V2GuidedResolutionPayload | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
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
  payload: V2GuidedResolutionPayload | null;
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

export async function setPendingResolution(args: {
  commitmentId: string;
  kind: V2PendingResolutionKind;
  payload: V2GuidedResolutionPayload;
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
    body: `Noted—let’s set a smaller bar you can say YES to. Finish in the app (~2 min), then watch for a YES/NO text: ${url}`,
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
