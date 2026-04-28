import {
  fetchLatestActivatedOverlayContractKind,
  getEffectiveCoachingAsk,
  isV2AdaptiveOverlayActive,
  isV2PendingProposalValid,
  resolvePendingProposalContractKind,
  type V2AdaptiveContractKind,
} from "@/lib/v2-adaptive-contract";
import { loadV2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory";
import { getActiveCommitment, type ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { supabaseServer } from "@/lib/supabase-server";
import { fetchV2UserSendTimeProfile, type V2UserSendTimeProfileRow } from "@/lib/v2-send-time-profile";
import type { V2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory-prompt";
import {
  fetchOperatorMessagingForensics,
  type OperatorMessagingForensics,
} from "@/lib/operator-messaging-forensics";

const OPERATOR_EVENT_LIMIT = 20;

export type OperatorIdentitySoT = {
  source: "user_profiles";
  identity_anchor_text: string | null;
  identity_refresh_due_at: string | null;
  identity_last_confirmed_at: string | null;
  identity_last_referenced_at: string | null;
};

export type OperatorContractDerived = {
  effective_coaching_ask: string;
  overlay_active: boolean;
  overlay_expires_at: string | null;
  overlay_contract_kind: V2AdaptiveContractKind | null;
  pending_proposal_valid: boolean;
  pending_proposal_text: string | null;
  pending_proposal_expires_at: string | null;
  pending_proposal_contract_kind: V2AdaptiveContractKind | null;
};

export type OperatorEventRowView = {
  occurred_at: string;
  event_type: string;
  summary: string;
  raw_payload_json: string;
};

export type OperatorCoachStateLoaded = {
  kind: "loaded";
  target_clerk_user_id: string;
  /** Canonical identity fields from `user_profiles` (may be null if no row). */
  identity: OperatorIdentitySoT | null;
  /** Active V2 commitment (always present for `loaded`). */
  commitment: ActiveV2CommitmentRow;
  contract: OperatorContractDerived;
  /** `v2_commitment_coaching_memory` + mirrors; null if no row yet. */
  coaching_memory_projection: V2CoachingMemoryForPrompt | null;
  send_time_profile: V2UserSendTimeProfileRow | null;
  events: OperatorEventRowView[];
  messagingForensics: OperatorMessagingForensics;
};

export type OperatorCoachStateView =
  | { kind: "needs_target" }
  | OperatorCoachStateLoaded
  | {
      kind: "no_profile_or_commitment";
      target_clerk_user_id: string;
      messagingForensics: OperatorMessagingForensics;
    }
  | {
      kind: "profile_no_active_commitment";
      target_clerk_user_id: string;
      identity: OperatorIdentitySoT;
      messagingForensics: OperatorMessagingForensics;
    };

function truncate(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** One-line summary for operator list (not full JSON). */
export function formatOperatorEventPayloadSummary(
  eventType: string,
  payload: Record<string, unknown> | null
): string {
  if (!payload || typeof payload !== "object") return "—";
  const p = payload;
  const bits: string[] = [];

  const ck = p.contract_kind;
  if (typeof ck === "string" && ck.trim()) bits.push(`contract_kind=${ck.trim()}`);

  const pt = p.proposal_text;
  if (typeof pt === "string" && pt.trim()) bits.push(`proposal="${truncate(pt, 72)}"`);

  const dk = p.day_key;
  if (typeof dk === "string" && dk.trim()) bits.push(`day_key=${dk.trim()}`);

  const msg = p.message;
  if (typeof msg === "string" && msg.trim()) bits.push(`message="${truncate(msg, 64)}"`);

  const bp = p.body_preview;
  if (typeof bp === "string" && bp.trim()) bits.push(`preview="${truncate(bp, 56)}"`);

  const res = p.resolution;
  if (typeof res === "string" && res.trim()) bits.push(`resolution=${res.trim()}`);

  const origin = p.origin;
  if (typeof origin === "string" && origin.trim()) bits.push(`origin=${origin.trim()}`);

  const intent = p.intent;
  if (typeof intent === "string" && intent.trim()) bits.push(`intent=${intent.trim()}`);

  if (bits.length === 0) return `(${eventType})`;
  return bits.join(" · ");
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function fetchIdentitySoT(clerkUserId: string): Promise<OperatorIdentitySoT | null> {
  const { data, error } = await supabaseServer
    .from("user_profiles")
    .select(
      "identity_anchor_text, identity_refresh_due_at, identity_last_confirmed_at, identity_last_referenced_at"
    )
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (error) {
    console.error("[operator-coach-state-view] user_profiles select failed", {
      clerk_user_id: clerkUserId,
      message: error.message,
    });
    return null;
  }
  if (!data) return null;

  return {
    source: "user_profiles",
    identity_anchor_text:
      typeof data.identity_anchor_text === "string" ? data.identity_anchor_text : null,
    identity_refresh_due_at:
      typeof data.identity_refresh_due_at === "string" ? data.identity_refresh_due_at : null,
    identity_last_confirmed_at:
      typeof data.identity_last_confirmed_at === "string" ? data.identity_last_confirmed_at : null,
    identity_last_referenced_at:
      typeof data.identity_last_referenced_at === "string" ? data.identity_last_referenced_at : null,
  };
}

async function fetchRecentEventsForConsole(commitmentId: string): Promise<OperatorEventRowView[]> {
  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("event_type, occurred_at, payload_json")
    .eq("commitment_id", commitmentId)
    .order("occurred_at", { ascending: false })
    .limit(OPERATOR_EVENT_LIMIT);

  if (error) {
    console.error("[operator-coach-state-view] events select failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
    return [];
  }

  const rows = data ?? [];
  return rows.map((row) => {
    const eventType = typeof row.event_type === "string" ? row.event_type : "unknown";
    const occurredAt = typeof row.occurred_at === "string" ? row.occurred_at : "";
    const payload =
      row.payload_json != null && typeof row.payload_json === "object" && !Array.isArray(row.payload_json)
        ? (row.payload_json as Record<string, unknown>)
        : null;
    return {
      occurred_at: occurredAt,
      event_type: eventType,
      summary: formatOperatorEventPayloadSummary(eventType, payload),
      raw_payload_json: safeJsonStringify(payload ?? {}),
    };
  });
}

export async function loadOperatorCoachStateView(
  targetClerkUserId: string | null | undefined
): Promise<OperatorCoachStateView> {
  const target = typeof targetClerkUserId === "string" ? targetClerkUserId.trim() : "";
  if (!target) return { kind: "needs_target" };

  const [identity, commitment] = await Promise.all([
    fetchIdentitySoT(target),
    getActiveCommitment(target),
  ]);

  if (!identity && !commitment) {
    const messagingForensics = await fetchOperatorMessagingForensics(target);
    return { kind: "no_profile_or_commitment", target_clerk_user_id: target, messagingForensics };
  }

  if (!commitment && identity) {
    const messagingForensics = await fetchOperatorMessagingForensics(target);
    return {
      kind: "profile_no_active_commitment",
      target_clerk_user_id: target,
      identity,
      messagingForensics,
    };
  }

  if (!commitment) {
    const messagingForensics = await fetchOperatorMessagingForensics(target);
    return { kind: "no_profile_or_commitment", target_clerk_user_id: target, messagingForensics };
  }

  const nowMs = Date.now();
  const cid = commitment.id;

  const [
    coaching_memory_projection,
    send_time_profile,
    events,
    overlayKindWhenActive,
    pendingProposalKind,
    messagingForensics,
  ] = await Promise.all([
    loadV2CoachingMemoryForPrompt(cid),
    fetchV2UserSendTimeProfile(target),
    fetchRecentEventsForConsole(cid),
    isV2AdaptiveOverlayActive(commitment, nowMs)
      ? fetchLatestActivatedOverlayContractKind(cid)
      : Promise.resolve(null as V2AdaptiveContractKind | null),
    isV2PendingProposalValid(commitment, nowMs) && commitment.adaptive_proposal_text?.trim()
      ? resolvePendingProposalContractKind({
          commitmentId: cid,
          proposalText: commitment.adaptive_proposal_text,
        })
      : Promise.resolve(null as V2AdaptiveContractKind | null),
    fetchOperatorMessagingForensics(target),
  ]);

  const overlay_active = isV2AdaptiveOverlayActive(commitment, nowMs);
  const pending_proposal_valid = isV2PendingProposalValid(commitment, nowMs);

  const contract: OperatorContractDerived = {
    effective_coaching_ask: getEffectiveCoachingAsk(commitment, nowMs),
    overlay_active,
    overlay_expires_at: overlay_active ? commitment.adaptive_ask_expires_at : null,
    overlay_contract_kind: overlay_active ? overlayKindWhenActive : null,
    pending_proposal_valid,
    pending_proposal_text: pending_proposal_valid ? commitment.adaptive_proposal_text : null,
    pending_proposal_expires_at: pending_proposal_valid ? commitment.adaptive_proposal_expires_at : null,
    pending_proposal_contract_kind: pending_proposal_valid ? pendingProposalKind : null,
  };

  return {
    kind: "loaded",
    target_clerk_user_id: target,
    identity,
    commitment,
    contract,
    coaching_memory_projection,
    send_time_profile,
    events,
    messagingForensics,
  };
}
