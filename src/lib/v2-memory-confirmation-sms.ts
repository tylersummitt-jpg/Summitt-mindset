/**
 * Wave 11 — Confirmed living memory updates by SMS (identity / relationship context).
 * Proposes via sms_memory_signal rows; applies user_profiles only after explicit SMS confirmation.
 */

import { supabaseServer } from "@/lib/supabase-server";
import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import { validateOnboardingIdentityAnchorInput } from "@/lib/v2-identity-anchor";
import { persistWave11ConfirmedIdentityAnchorEdit } from "@/lib/v2-persist-identity-edit";
import { buildProofMomentForMemoryUpdated, proofMomentPayloadFields } from "@/lib/v2-proof-moment";
import { parseSmsConfirmation } from "@/lib/v2-sms-pending-resolution-complete";

export const WAVE11_MEMORY_CONFIRMATION_TTL_MS = 72 * 60 * 60 * 1000;

export type Wave11PendingMemoryKind = "identity_anchor_update" | "relationship_context_update";

export type Wave11AwaitingMemoryConfirmation = {
  eventId: string;
  occurredAt: string;
  sourceMessageSid: string;
  pendingKind: Wave11PendingMemoryKind;
  candidateIdentityAnchorText: string | null;
  candidatePeopleSummary: string | null;
  candidateResponsibility: string | null;
  confirmationQuestion: string;
  expiresAtMs: number;
};

export function parseIsoMsSafe(iso: string | null | undefined): number | null {
  if (!iso || typeof iso !== "string") return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Yes / no / ambiguous for memory confirmation follow-ups (extends tighten/replace parser). */
export function parseMemoryConfirmationReply(raw: string): "yes" | "no" | "ambiguous" {
  const t = raw.trim();
  const lower = t.toLowerCase();
  if (/\bremember\s+(that|this)\b/i.test(lower) && !/\b(don'?t|not|won'?t|never)\b/i.test(lower)) {
    if (/\b(no|wrong|not)\b/i.test(lower)) return "ambiguous";
    return "yes";
  }
  return parseSmsConfirmation(t);
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Conservative gate for relationship fields — avoids vague one-liners.
 */
export function conservativeRelationshipCandidate(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const t = raw.trim().replace(/\s+/g, " ");
  if (t.length < 14 || wordCount(t) < 4) return null;
  const low = t.toLowerCase();
  if (/^(things changed|life changed|stuff happened|idk|n\/a)\.?$/i.test(low)) return null;
  if (/^(my family|the family|home)\.?$/i.test(low)) return null;
  return t.length > 400 ? `${t.slice(0, 399)}…` : t;
}

export async function fetchLatestAwaitingMemoryConfirmation(
  commitmentId: string,
  nowMs: number = Date.now()
): Promise<Wave11AwaitingMemoryConfirmation | null> {
  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("id, occurred_at, payload_json")
    .eq("commitment_id", commitmentId)
    .eq("event_type", "sms_memory_signal")
    .order("occurred_at", { ascending: false })
    .limit(80);

  if (error || !data?.length) return null;

  const resolvedSids = new Set<string>();
  for (const row of data) {
    const p = row.payload_json as Record<string, unknown> | null;
    if (!p || typeof p !== "object") continue;
    if (p.wave11_memory_resolution === true && typeof p.resolved_pending_source_message_sid === "string") {
      resolvedSids.add(p.resolved_pending_source_message_sid);
    }
  }

  for (const row of data) {
    const p = row.payload_json as Record<string, unknown> | null;
    if (!p || typeof p !== "object") continue;
    if (p.memory_confirmation_pending !== true) continue;
    if (p.status !== "awaiting_confirmation") continue;
    const sid = typeof p.source_message_sid === "string" ? p.source_message_sid : null;
    if (!sid || resolvedSids.has(sid)) continue;
    const expMs = parseIsoMsSafe(typeof p.expires_at === "string" ? p.expires_at : null);
    if (expMs != null && nowMs > expMs) continue;

    const kindRaw = p.pending_memory_kind;
    const pendingKind: Wave11PendingMemoryKind | null =
      kindRaw === "identity_anchor_update" || kindRaw === "relationship_context_update" ? kindRaw : null;
    if (!pendingKind) continue;

    const q =
      typeof p.confirmation_question === "string" && p.confirmation_question.trim()
        ? p.confirmation_question.trim()
        : null;
    if (!q) continue;

    const id = typeof row.id === "string" ? row.id : String(row.id ?? "");
    if (!id) continue;

    return {
      eventId: id,
      occurredAt: typeof row.occurred_at === "string" ? row.occurred_at : new Date(0).toISOString(),
      sourceMessageSid: sid,
      pendingKind,
      candidateIdentityAnchorText:
        typeof p.candidate_identity_anchor_text === "string" ? p.candidate_identity_anchor_text.trim() : null,
      candidatePeopleSummary:
        typeof p.candidate_people_summary === "string" ? p.candidate_people_summary.trim() : null,
      candidateResponsibility:
        typeof p.candidate_responsibility === "string" ? p.candidate_responsibility.trim() : null,
      confirmationQuestion: q,
      expiresAtMs: expMs ?? nowMs + WAVE11_MEMORY_CONFIRMATION_TTL_MS,
    };
  }

  return null;
}

export async function insertWave11MemoryResolutionEvent(args: {
  commitmentId: string;
  clerkUserId: string;
  inboundMessageSid: string;
  resolvedPendingSourceMessageSid: string;
  outcome: "confirmed" | "declined" | "ambiguous_clarify" | "expired_skipped";
  priorEventId: string | null;
  appliedIdentity: boolean;
  appliedPeopleSummary: boolean;
  appliedResponsibility: boolean;
  /** Wave 12.1 — only when Victory callout text was appended to the outbound SMS. */
  victoryCalloutExtras?: Record<string, unknown>;
  /** Optional resolution telemetry (visible_sent, unified guard metadata, etc.). */
  resolutionTelemetry?: Record<string, unknown> | null;
}): Promise<{ inserted: boolean; duplicate: boolean }> {
  try {
    const memoryProof =
      args.outcome === "confirmed"
        ? buildProofMomentForMemoryUpdated({
            appliedIdentity: args.appliedIdentity,
            appliedPeopleSummary: args.appliedPeopleSummary,
            appliedResponsibility: args.appliedResponsibility,
          })
        : null;

    const { error } = await supabaseServer.from("v2_commitment_event").insert({
      commitment_id: args.commitmentId,
      clerk_user_id: args.clerkUserId,
      event_type: "sms_memory_signal",
      source: "sms_v2_wave11_memory_resolution",
      payload_json: {
        wave11_memory_resolution: true,
        resolved_pending_source_message_sid: args.resolvedPendingSourceMessageSid,
        resolution_outcome: args.outcome,
        prior_confirmation_event_id: args.priorEventId,
        applied_identity_anchor: args.appliedIdentity,
        applied_people_summary: args.appliedPeopleSummary,
        applied_responsibility: args.appliedResponsibility,
        inbound_resolution_message_sid: args.inboundMessageSid,
        ...proofMomentPayloadFields(memoryProof),
        ...(args.victoryCalloutExtras ?? {}),
        ...(args.resolutionTelemetry ?? {}),
      },
      idempotency_key: `v2_wave11_memory_resolution:${args.inboundMessageSid}`,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") return { inserted: false, duplicate: true };
      console.warn("[wave11] memory_resolution insert skipped", { message: error.message, code });
      return { inserted: false, duplicate: false };
    }
    return { inserted: true, duplicate: false };
  } catch (e) {
    console.warn("[wave11] memory_resolution insert failed", {
      message: e instanceof Error ? e.message : String(e),
    });
    return { inserted: false, duplicate: false };
  }
}

export type MemoryConfirmationNoSendStage = "lane" | "final_voice_gate" | "unified_final_guard";

export type MemoryConfirmationNoSendBranch = "ambiguous" | "decline" | "yes";

export type MemoryConfirmationNoSendTruthPolicyContext = {
  branch: MemoryConfirmationNoSendBranch;
  commitmentId: string;
  clerkUserId: string;
  inboundMessageSid: string;
  pendingSourceMessageSid: string;
  pendingEventId?: string | null;
  applied?: Wave11ProfileApplyResult | null;
  anyApplied?: boolean;
};

export type PersistMemoryConfirmationTruthOnNoSendArgs = MemoryConfirmationNoSendTruthPolicyContext & {
  noSendStage: MemoryConfirmationNoSendStage;
  noSendReason: string;
  stageMetadata?: Record<string, unknown>;
};

export type MemoryConfirmationNoSendTruthTelemetry = {
  memory_confirmation_branch: MemoryConfirmationNoSendBranch;
  memory_no_send_stage: MemoryConfirmationNoSendStage;
  memory_resolution_persisted: boolean;
  memory_resolution_visible_sent: false;
  pending_memory_cleared: boolean;
  no_send_reason: string;
  visible_sent: false;
  memory_update_applied_before_sms?: boolean;
  memory_applied_any?: boolean;
  memory_resolution_duplicate?: boolean;
  lane_no_send_reason?: string;
  final_voice_gate_skip_reason?: string;
  unified_final_guard_no_send_reason?: string;
};

function memoryNoSendStageReasonField(
  stage: MemoryConfirmationNoSendStage,
  reason: string
): Pick<
  MemoryConfirmationNoSendTruthTelemetry,
  "lane_no_send_reason" | "final_voice_gate_skip_reason" | "unified_final_guard_no_send_reason"
> {
  if (stage === "lane") return { lane_no_send_reason: reason };
  if (stage === "final_voice_gate") return { final_voice_gate_skip_reason: reason };
  return { unified_final_guard_no_send_reason: reason };
}

/**
 * Branch-specific truth/state policy when memory confirmation visible SMS no-sends
 * (lane, FVG, or unified final guard).
 */
export async function persistMemoryConfirmationTruthOnNoSend(
  args: PersistMemoryConfirmationTruthOnNoSendArgs
): Promise<MemoryConfirmationNoSendTruthTelemetry> {
  const anyApplied = args.anyApplied === true;
  const applied = args.applied ?? null;
  const stageReason = memoryNoSendStageReasonField(args.noSendStage, args.noSendReason);

  const baseTelemetry: MemoryConfirmationNoSendTruthTelemetry = {
    memory_confirmation_branch: args.branch,
    memory_no_send_stage: args.noSendStage,
    memory_resolution_visible_sent: false,
    visible_sent: false,
    no_send_reason: args.noSendReason,
    ...stageReason,
    ...(args.stageMetadata ?? {}),
    memory_resolution_persisted: false,
    pending_memory_cleared: false,
  };

  if (args.branch === "ambiguous") {
    return baseTelemetry;
  }

  if (args.branch === "decline") {
    const resolutionPayload = {
      ...baseTelemetry,
      memory_resolution_persisted: true,
      pending_memory_cleared: true,
      memory_update_applied_before_sms: false,
    };
    const insertResult = await insertWave11MemoryResolutionEvent({
      commitmentId: args.commitmentId,
      clerkUserId: args.clerkUserId,
      inboundMessageSid: args.inboundMessageSid,
      resolvedPendingSourceMessageSid: args.pendingSourceMessageSid,
      outcome: "declined",
      priorEventId: args.pendingEventId ?? null,
      appliedIdentity: false,
      appliedPeopleSummary: false,
      appliedResponsibility: false,
      resolutionTelemetry: resolutionPayload,
    });
    return {
      ...resolutionPayload,
      memory_resolution_duplicate: insertResult.duplicate,
    };
  }

  if (anyApplied) {
    await recomputeV2CoachingMemory(args.commitmentId, {
      reasonCode: "wave11_sms_memory_confirmation",
    });
  }

  const resolutionPayload = {
    ...baseTelemetry,
    memory_resolution_persisted: true,
    pending_memory_cleared: true,
    memory_update_applied_before_sms: anyApplied,
    memory_applied_any: anyApplied,
  };
  const insertResult = await insertWave11MemoryResolutionEvent({
    commitmentId: args.commitmentId,
    clerkUserId: args.clerkUserId,
    inboundMessageSid: args.inboundMessageSid,
    resolvedPendingSourceMessageSid: args.pendingSourceMessageSid,
    outcome: "confirmed",
    priorEventId: args.pendingEventId ?? null,
    appliedIdentity: applied?.appliedIdentity ?? false,
    appliedPeopleSummary: applied?.appliedPeopleSummary ?? false,
    appliedResponsibility: applied?.appliedResponsibility ?? false,
    resolutionTelemetry: resolutionPayload,
  });
  return {
    ...resolutionPayload,
    memory_resolution_duplicate: insertResult.duplicate,
  };
}

export type Wave11ProfileApplyResult = {
  appliedIdentity: boolean;
  appliedPeopleSummary: boolean;
  appliedResponsibility: boolean;
};

/**
 * Apply confirmed memory updates to user_profiles. Identity uses SMS explicit confirmation source.
 */
const WAVE11_APPEND_MAX_CHARS = 320;

export function wave11ShouldOfferConfirmationOffer(args: {
  memoryDetected: boolean;
  requiresConfirmation: boolean;
  confidence: number;
  signalType: string;
  shouldWriteOutcome: boolean;
  gatedMode: string;
  identityCandidateOk: boolean;
  relationshipCandidateOk: boolean;
  hasAwaitingPending: boolean;
}): boolean {
  if (args.hasAwaitingPending) return false;
  if (!args.memoryDetected || !args.requiresConfirmation) return false;
  if (args.confidence < 0.58) return false;
  if (args.shouldWriteOutcome) return false;
  if (args.gatedMode === "commitment_change_handoff") return false;
  if (args.gatedMode === "identity_edit_integrity") return false;
  if (args.gatedMode === "clarify" && args.confidence < 0.82) return false;
  if (args.signalType === "identity_shift") return args.identityCandidateOk;
  if (args.signalType === "relationship_context_changed") return args.relationshipCandidateOk;
  return false;
}

/**
 * Build SMS-safe confirmation copy; avoid quoting sensitive or long strings.
 */
export function buildWave11MemoryConfirmationQuestion(args: {
  pendingKind: Wave11PendingMemoryKind;
  confirmationQuestionPreview: string | null;
  sensitive: boolean;
  shouldNotQuoteDirectly: boolean;
  candidateIdentityAnchor: string | null;
}): string | null {
  const preview =
    args.confirmationQuestionPreview?.trim() &&
    args.confirmationQuestionPreview.trim().length <= 220
      ? args.confirmationQuestionPreview.trim()
      : null;

  if (args.pendingKind === "identity_anchor_update") {
    const cand = args.candidateIdentityAnchor?.trim() ?? "";
    const shortEnough = cand.length > 0 && cand.length <= 72;
    const canQuote =
      shortEnough && !args.sensitive && args.shouldNotQuoteDirectly === false && cand.length >= 12;
    if (canQuote) {
      return `That sounds like your identity line may have shifted. Want me to remember it as: “${cand.replace(/"/g, "'")}”?`;
    }
    if (preview && !/\b(yes|reply)\b/i.test(preview)) {
      return preview.length <= 200 ? preview : `${preview.slice(0, 197)}…`;
    }
    return "That sounds like your identity line may have shifted. Want me to remember that as your current identity line?";
  }

  if (preview && preview.length <= 200 && !args.sensitive) {
    return preview;
  }
  return "That sounds like your life context changed. Want me to remember an updated family or responsibility note going forward?";
}

/** Append confirmation when both coach reply and question fit in one SMS-sized bundle. */
export function wave11AppendConfirmationIfFits(baseReply: string, confirmation: string): string | null {
  const sep = "\n\n";
  const combined = `${baseReply.trim()}${sep}${confirmation.trim()}`;
  if (combined.length <= WAVE11_APPEND_MAX_CHARS) return combined;
  return null;
}

export async function applyWave11ConfirmedProfileUpdates(args: {
  clerkUserId: string;
  pending: Wave11AwaitingMemoryConfirmation;
}): Promise<Wave11ProfileApplyResult> {
  const out: Wave11ProfileApplyResult = {
    appliedIdentity: false,
    appliedPeopleSummary: false,
    appliedResponsibility: false,
  };

  if (args.pending.pendingKind === "identity_anchor_update") {
    const cand = args.pending.candidateIdentityAnchorText;
    const v = validateOnboardingIdentityAnchorInput(cand);
    if (!v.ok) return out;

    const result = await persistWave11ConfirmedIdentityAnchorEdit({
      clerkUserId: args.clerkUserId,
      identityAnchorText: v.normalized,
    });

    if (result.ok) {
      out.appliedIdentity = true;
    } else {
      console.error("[wave11] versioned identity update failed", {
        clerk_user_id: args.clerkUserId,
        code: result.code,
        error: result.error,
      });
    }
    return out;
  }

  const people = conservativeRelationshipCandidate(args.pending.candidatePeopleSummary);
  const resp = conservativeRelationshipCandidate(args.pending.candidateResponsibility);

  const patch: Record<string, unknown> = {};
  if (people) {
    patch.people_summary = people;
    out.appliedPeopleSummary = true;
  }
  if (resp) {
    patch.responsibility = resp;
    out.appliedResponsibility = true;
  }

  if (Object.keys(patch).length === 0) return out;

  const { error } = await supabaseServer.from("user_profiles").update(patch).eq("clerk_user_id", args.clerkUserId);

  if (error) {
    console.error("[wave11] relationship profile update failed", {
      clerk_user_id: args.clerkUserId,
      message: error.message,
    });
    return { appliedIdentity: false, appliedPeopleSummary: false, appliedResponsibility: false };
  }

  return out;
}
