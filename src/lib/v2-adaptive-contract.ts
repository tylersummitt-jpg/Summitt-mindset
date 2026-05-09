import crypto from "crypto";

import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { supabaseServer } from "@/lib/supabase-server";
import { computeShrunkAskText } from "@/lib/v2-ai-outbound";
import { buildV2ShrinkProposalOutboundSms } from "@/lib/v2-sms-accountability";
import { isTwilioReady, sendSMS } from "@/lib/twilio";
import { finalizeNorthStarCoachSmsAsync } from "@/lib/north-star-coach-sms-openai";
import { getDateKeyInTimezone, resolveUserTimezone } from "@/lib/timezone";
import { getV2CommitmentByIdForCoaching, type ActiveV2CommitmentRow } from "@/lib/v2-commitment";

export type V2AdaptiveContractKind = "shrink_ask" | "recommit_same";

/** Pending shrink proposal window (authoritative for this PR). */
export const V2_ADAPTIVE_PROPOSAL_TTL_MS = 48 * 60 * 60 * 1000;

/** Active overlay duration after explicit YES (authoritative for this PR). */
export const V2_ADAPTIVE_OVERLAY_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export type V2AdaptiveContractEventType =
  | "contract_overlay_proposed"
  | "contract_overlay_activated"
  | "contract_overlay_declined";

type OverlayConsentMutationResult =
  | "applied"
  | "already_applied"
  | "state_conflict"
  | "not_found"
  | "error";

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

export function isV2AdaptiveOverlayActive(row: ActiveV2CommitmentRow, nowMs: number = Date.now()): boolean {
  const text = row.adaptive_ask_text?.trim();
  const exp = parseMs(row.adaptive_ask_expires_at);
  if (!text || exp == null) return false;
  return nowMs < exp;
}

export function isV2PendingProposalValid(row: ActiveV2CommitmentRow, nowMs: number = Date.now()): boolean {
  const text = row.adaptive_proposal_text?.trim();
  const exp = parseMs(row.adaptive_proposal_expires_at);
  if (!text || exp == null) return false;
  return nowMs < exp;
}

/**
 * Runtime coaching ask: temporary overlay when active and not expired; else base `behavior_statement`.
 */
export function getEffectiveCoachingAsk(row: ActiveV2CommitmentRow, nowMs: number = Date.now()): string {
  if (isV2AdaptiveOverlayActive(row, nowMs) && row.adaptive_ask_text?.trim()) {
    return row.adaptive_ask_text.trim();
  }
  return row.behavior_statement.trim();
}

/** Server-derived proposed smaller ask (not AI); tied to original commitment wording. */
export function computeShrinkProposalText(behaviorStatement: string): string {
  return computeShrunkAskText(behaviorStatement);
}

const SHRINK_BINDING_MAX_CHARS = 240;

/** Normalize user-edited shrink binding for guided flow; returns null if unusable. */
export function normalizeShrinkProposalBindingText(raw: string): string | null {
  const t = raw.trim().replace(/\s+/g, " ");
  if (t.length < 3) return null;
  if (t.length > SHRINK_BINDING_MAX_CHARS) return null;
  return t;
}

/**
 * Server-derived explicit recommit to the same bar (not AI, not a shrink, not a new goal).
 * Used as overlay text after consent; base `behavior_statement` stays unchanged.
 */
export function computeRecommitBindingText(behaviorStatement: string): string {
  const t = behaviorStatement.trim().replace(/\s+/g, " ");
  if (!t) {
    return "Same commitment—keep this line steady for the next 7 days.";
  }
  const cap = 88;
  const slice = t.length <= cap ? t : `${t.slice(0, cap - 1)}…`;
  return `Same commitment—keep this line for 7 days: ${slice}`;
}

/** Match pending column text to the newest proposed spine row that carries `contract_kind`. */
export async function resolvePendingProposalContractKind(args: {
  commitmentId: string;
  proposalText: string;
}): Promise<V2AdaptiveContractKind> {
  const want = args.proposalText.trim();
  if (!want) return "shrink_ask";

  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("payload_json")
    .eq("commitment_id", args.commitmentId)
    .eq("event_type", "contract_overlay_proposed")
    .order("occurred_at", { ascending: false })
    .limit(30);

  if (error || !data?.length) return "shrink_ask";

  for (const row of data) {
    const p = row.payload_json as Record<string, unknown> | null;
    const pt = typeof p?.proposal_text === "string" ? p.proposal_text.trim() : "";
    if (pt === want) {
      return p?.contract_kind === "recommit_same" ? "recommit_same" : "shrink_ask";
    }
  }
  return "shrink_ask";
}

/** Latest activated overlay kind from spine (for prompts; old rows without field → null). */
export async function fetchLatestActivatedOverlayContractKind(
  commitmentId: string
): Promise<V2AdaptiveContractKind | null> {
  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("payload_json")
    .eq("commitment_id", commitmentId)
    .eq("event_type", "contract_overlay_activated")
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.payload_json) return null;
  const p = data.payload_json as Record<string, unknown>;
  if (p.contract_kind === "recommit_same") return "recommit_same";
  if (p.contract_kind === "shrink_ask") return "shrink_ask";
  return null;
}

/**
 * Clears expired proposal and/or expired overlay columns so stale state does not block new proposals.
 */
export async function clearStaleAdaptiveContractColumns(commitmentId: string): Promise<void> {
  const { data: row, error: fetchErr } = await supabaseServer
    .from("v2_commitment")
    .select(
      "adaptive_ask_expires_at, adaptive_proposal_expires_at, adaptive_proposal_text, adaptive_ask_text"
    )
    .eq("id", commitmentId)
    .maybeSingle();

  if (fetchErr || !row) return;

  const now = Date.now();
  const overlayExp = parseMs(
    typeof row.adaptive_ask_expires_at === "string" ? row.adaptive_ask_expires_at : null
  );
  const proposalExp = parseMs(
    typeof row.adaptive_proposal_expires_at === "string" ? row.adaptive_proposal_expires_at : null
  );

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let needs = false;

  if (overlayExp != null && now >= overlayExp && row.adaptive_ask_text) {
    patch.adaptive_ask_text = null;
    patch.adaptive_ask_active_from = null;
    patch.adaptive_ask_expires_at = null;
    needs = true;
  }
  if (proposalExp != null && now >= proposalExp && row.adaptive_proposal_text) {
    patch.adaptive_proposal_text = null;
    patch.adaptive_proposal_created_at = null;
    patch.adaptive_proposal_expires_at = null;
    needs = true;
  }

  if (!needs) return;

  const { error } = await supabaseServer.from("v2_commitment").update(patch).eq("id", commitmentId);
  if (error) {
    console.error("[v2-adaptive-contract] clearStaleAdaptiveContractColumns failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
  }
}

export async function persistContractOverlayProposed(args: {
  commitmentId: string;
  clerkUserId: string;
  proposalText: string;
  dayKey: string;
  messageSid: string;
  contractKind: V2AdaptiveContractKind;
  /** Distinct idempotency when multiple proposals could share the same calendar day_key (e.g. guided + cron). */
  idempotencySuffix?: string;
  expectedUpdatedAt?: string | null;
  requireFreshProposalSlot?: boolean;
  skipEventWrite?: boolean;
}): Promise<{ ok: true; updatedAt: string | null } | { ok: false; error: string }> {
  const now = new Date();
  const proposalExpires = new Date(now.getTime() + V2_ADAPTIVE_PROPOSAL_TTL_MS).toISOString();
  const proposalText = args.proposalText.trim();
  const idempotencyKey = args.idempotencySuffix
    ? `v2_contract_overlay_proposed:${args.commitmentId}:${args.dayKey}:${args.idempotencySuffix}`
    : `v2_contract_overlay_proposed:${args.commitmentId}:${args.dayKey}`;

  if (!args.skipEventWrite) {
    const { error: evErr } = await supabaseServer.from("v2_commitment_event").insert({
      commitment_id: args.commitmentId,
      clerk_user_id: args.clerkUserId,
      event_type: "contract_overlay_proposed" satisfies V2AdaptiveContractEventType,
      source: "sms_v2_accountability",
      payload_json: {
        contract_kind: args.contractKind,
        proposal_text: proposalText,
        proposal_expires_at: proposalExpires,
        day_key: args.dayKey,
        message_sid: args.messageSid,
        proposal_ttl_hours: 48,
        ...(args.idempotencySuffix ? { origin: "guided_resolution" } : {}),
      },
      idempotency_key: idempotencyKey,
    });

    if (evErr) {
      const code = (evErr as { code?: string }).code;
      if (code !== "23505") {
        return { ok: false, error: `contract_overlay_proposed_event_failed:${evErr.message}` };
      }
    }
  }

  let up = supabaseServer
    .from("v2_commitment")
    .update({
      adaptive_proposal_text: proposalText,
      adaptive_proposal_created_at: now.toISOString(),
      adaptive_proposal_expires_at: proposalExpires,
      updated_at: now.toISOString(),
    })
    .eq("id", args.commitmentId);
  if (typeof args.expectedUpdatedAt === "string" && args.expectedUpdatedAt.trim()) {
    up = up.eq("updated_at", args.expectedUpdatedAt.trim());
  }
  if (args.requireFreshProposalSlot !== false) {
    up = up.is("adaptive_proposal_text", null).is("adaptive_ask_text", null);
  }
  const { data: upData, error: upErr } = await up.select("updated_at").maybeSingle();

  if (upErr) {
    return { ok: false, error: `contract_overlay_proposed_update_failed:${upErr.message}` };
  }
  if (!upData) {
    return { ok: false, error: "contract_overlay_proposed_state_conflict" };
  }
  return { ok: true, updatedAt: typeof upData.updated_at === "string" ? upData.updated_at : null };
}

export async function activateAdaptiveOverlayFromProposal(args: {
  commitmentId: string;
  clerkUserId: string;
  proposalText: string;
  inboundMessageSid: string;
  contractKind: V2AdaptiveContractKind;
  expectedProposalExpiresAt?: string | null;
  expectedUpdatedAt?: string | null;
}): Promise<
  | { ok: true; updatedAt: string | null; result: OverlayConsentMutationResult }
  | { ok: false; error: string; result?: OverlayConsentMutationResult }
> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseServer.rpc("v2_apply_overlay_consent_mutation", {
    p_commitment_id: args.commitmentId,
    p_clerk_user_id: args.clerkUserId,
    p_inbound_message_sid: args.inboundMessageSid,
    p_decision: "accept",
    p_proposal_text: args.proposalText.trim(),
    p_contract_kind: args.contractKind,
    p_expected_proposal_expires_at:
      typeof args.expectedProposalExpiresAt === "string" ? args.expectedProposalExpiresAt : null,
    p_expected_updated_at: typeof args.expectedUpdatedAt === "string" ? args.expectedUpdatedAt : null,
    p_now: nowIso,
  });
  if (error) {
    return { ok: false, error: `contract_overlay_activate_rpc_failed:${error.message}` };
  }
  const row = Array.isArray(data) ? data[0] : null;
  const result = typeof row?.result === "string" ? (row.result as OverlayConsentMutationResult) : "error";
  const updatedAt =
    typeof row?.updated_at === "string" ? row.updated_at : row?.updated_at != null ? String(row.updated_at) : null;
  if (result === "applied") {
    return { ok: true, updatedAt, result };
  }
  return { ok: false, error: `contract_overlay_activate_${result}`, result };
}

export async function declineAdaptiveProposal(args: {
  commitmentId: string;
  clerkUserId: string;
  proposalText: string;
  inboundMessageSid: string;
  contractKind: V2AdaptiveContractKind;
  expectedProposalExpiresAt?: string | null;
  expectedUpdatedAt?: string | null;
}): Promise<
  | { ok: true; updatedAt: string | null; result: OverlayConsentMutationResult }
  | { ok: false; error: string; result?: OverlayConsentMutationResult }
> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseServer.rpc("v2_apply_overlay_consent_mutation", {
    p_commitment_id: args.commitmentId,
    p_clerk_user_id: args.clerkUserId,
    p_inbound_message_sid: args.inboundMessageSid,
    p_decision: "decline",
    p_proposal_text: args.proposalText.trim(),
    p_contract_kind: args.contractKind,
    p_expected_proposal_expires_at:
      typeof args.expectedProposalExpiresAt === "string" ? args.expectedProposalExpiresAt : null,
    p_expected_updated_at: typeof args.expectedUpdatedAt === "string" ? args.expectedUpdatedAt : null,
    p_now: nowIso,
  });
  if (error) {
    return { ok: false, error: `contract_overlay_decline_rpc_failed:${error.message}` };
  }
  const row = Array.isArray(data) ? data[0] : null;
  const result = typeof row?.result === "string" ? (row.result as OverlayConsentMutationResult) : "error";
  const updatedAt =
    typeof row?.updated_at === "string" ? row.updated_at : row?.updated_at != null ? String(row.updated_at) : null;
  if (result === "applied") {
    return { ok: true, updatedAt, result };
  }
  return { ok: false, error: `contract_overlay_decline_${result}`, result };
}

/**
 * Guided refresh TIGHTEN: create shrink_ask proposal state + send YES/NO consent SMS.
 * Does not activate overlay, does not mutate base `behavior_statement`, does not write `check_sent`.
 */
export async function proposeShrinkAskFromGuidedResolution(args: {
  commitmentId: string;
  clerkUserId: string;
  proposalBindingText: string;
  /** Base written commitment (not overlay ask) for {{B}} in consent SMS. */
  originalBehaviorStatement: string;
}): Promise<{ ok: true; messageSid: string } | { ok: false; error: string }> {
  await clearStaleAdaptiveContractColumns(args.commitmentId);

  const c = await getV2CommitmentByIdForCoaching(args.commitmentId);
  if (!c) {
    return { ok: false, error: "commitment_not_found" };
  }
  const nowMs = Date.now();
  if (isV2AdaptiveOverlayActive(c, nowMs)) {
    return { ok: false, error: "overlay_already_active" };
  }
  if (isV2PendingProposalValid(c, nowMs)) {
    return { ok: false, error: "proposal_already_pending" };
  }

  const dryRun = process.env.SMS_DRY_RUN === "true";
  if (!isTwilioReady() && !dryRun) {
    return { ok: false, error: "twilio_not_configured" };
  }

  const { data: ident } = await supabaseServer
    .from("sms_identities")
    .select("phone_number, sms_enabled, stopped_at")
    .eq("clerk_user_id", args.clerkUserId)
    .maybeSingle();

  const phone = typeof ident?.phone_number === "string" ? ident.phone_number.trim() : "";
  if (!phone || ident?.sms_enabled !== true || typeof ident?.stopped_at === "string") {
    return { ok: false, error: "sms_not_reachable" };
  }

  const dayKey = getDateKeyInTimezone(new Date(), "UTC");
  const idempotencySuffix = `guided:${crypto.randomUUID()}`;

  const mdGuided = await getClerkPublicMetadata(args.clerkUserId);
  const timezoneGuided = resolveUserTimezone(mdGuided?.timezone);

  const { body: smsBody, northStarReplySource } = await buildV2ShrinkProposalOutboundSms({
    clerkUserId: args.clerkUserId,
    dayKey,
    proposalBindingText: args.proposalBindingText,
    originalBehaviorStatement: args.originalBehaviorStatement,
    v3Refine: { commitment: c, timezone: timezoneGuided },
  });

  // Reserve canonical proposal state before sending, so guided path never emits YES/NO
  // copy when a valid pending proposal state could not be persisted.
  const reserved = await persistContractOverlayProposed({
    commitmentId: args.commitmentId,
    clerkUserId: args.clerkUserId,
    proposalText: args.proposalBindingText,
    dayKey,
    messageSid: `pending_guided_send:${idempotencySuffix}`,
    contractKind: "shrink_ask",
    idempotencySuffix,
    expectedUpdatedAt: c.updated_at,
    requireFreshProposalSlot: true,
    skipEventWrite: true,
  });
  if (!reserved.ok) {
    return { ok: false, error: reserved.error };
  }

  let messageSid: string;
  if (dryRun) {
    messageSid = `dry_run_guided_shrink:${idempotencySuffix}`;
  } else {
    try {
      const gatedGuided = await finalizeNorthStarCoachSmsAsync({
        proposedBody: smsBody,
        channel: "guided_contract_proposal",
        behaviorStatement: args.originalBehaviorStatement,
        effectiveAskText: args.proposalBindingText,
        replySource: northStarReplySource ?? undefined,
        contextPacket: {
          activeCommitmentId: args.commitmentId,
          behaviorStatement: args.originalBehaviorStatement,
          effectiveAskText: args.proposalBindingText,
          source: "guided_contract_proposal",
        },
      });
      const msg = await sendSMS({
        to: phone,
        body: gatedGuided.visibleBody,
        lastOutbound: {
          clerkUserId: args.clerkUserId,
          messageKind: "question",
          skipLastOutboundContextUpsert: true,
        },
      });
      messageSid = msg.sid;
    } catch (e) {
      await supabaseServer
        .from("v2_commitment")
        .update({
          adaptive_proposal_text: null,
          adaptive_proposal_created_at: null,
          adaptive_proposal_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", args.commitmentId)
        .eq("adaptive_proposal_text", args.proposalBindingText.trim());
      console.error("[v2-adaptive-contract] proposeShrinkAskFromGuidedResolution send failed", e);
      return { ok: false, error: "sms_send_failed" };
    }
  }

  const finalized = await persistContractOverlayProposed({
    commitmentId: args.commitmentId,
    clerkUserId: args.clerkUserId,
    proposalText: args.proposalBindingText,
    dayKey,
    messageSid,
    contractKind: "shrink_ask",
    idempotencySuffix,
    requireFreshProposalSlot: false,
  });
  if (!finalized.ok) {
    return { ok: false, error: finalized.error };
  }

  return { ok: true, messageSid };
}
