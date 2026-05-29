import { classifyV2InboundReply } from "@/lib/v2-sms-accountability";
import {
  diagnoseSemanticDailyContractProposalSnapshots,
  matchSemanticDailyContractProposalSnapshots,
  type SemanticDailyOutboundSnapshotCandidate,
} from "@/lib/v3-daily-contract-proposal-semantic";

// Keep this module import-safe in unit tests (no supabase client required at import time).
const V2_ADAPTIVE_PROPOSAL_TTL_MS = 48 * 60 * 60 * 1000;

function norm(s: string): string {
  return (s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export type ContractConsentOutboundGateFailReason =
  | "ok"
  | "not_yes_no"
  | "proposal_text_empty"
  | "snapshot_missing"
  | "sid_missing"
  | "sid_mismatch"
  | "semantic_mismatch"
  | "proposal_text_mismatch"
  | "proposal_version_mismatch"
  | "snapshot_expired"
  | "semantics_mismatch"
  | "prompt_kind_mismatch"
  | "legacy_needle_miss";

export type ContractConsentOutboundGateDiagnosis = {
  ok: boolean;
  reason: ContractConsentOutboundGateFailReason;
  details: {
    inbound_event_type: string;
    proposal_text_digest: string;
    last_outbound_sid: string | null;
    snapshot_count: number;
    semantic_reason: string | null;
    legacy_needle_prefix: string;
    last_outbound_body_preview: string;
    legacy_needle_hit: boolean;
  };
};

/**
 * Normalized first-32-char binding needle used by inbound contract consent routing and guided outbound checks.
 * Must stay aligned with {@link latestOutboundBodyContainsAdaptiveProposalBindingNeedle}.
 */
export function adaptiveProposalBindingNeedlePrefix(proposalText: string | null | undefined): string {
  const proposal = typeof proposalText === "string" ? proposalText.trim() : "";
  if (!proposal) return "";
  return norm(proposal).slice(0, 32);
}

/**
 * Same normalized first-32-char binding needle as {@link legacyBindingNeedleContractProposalConsentGate}.
 * Used for Phase 3F-3 ambiguous consent clarification so proposal-truth matches contract consent routing.
 */
export function latestOutboundBodyContainsAdaptiveProposalBindingNeedle(
  latestOutboundBody: string | null | undefined,
  proposalText: string | null | undefined
): boolean {
  const needle = adaptiveProposalBindingNeedlePrefix(proposalText);
  if (!needle) return false;
  const latest = typeof latestOutboundBody === "string" ? latestOutboundBody : "";
  return norm(latest).includes(needle);
}

/**
 * Legacy daily / guided adaptive proposals: outbound must contain the binding needle slice.
 */
export function legacyBindingNeedleContractProposalConsentGate(args: {
  inboundBody: string;
  proposalText: string | null | undefined;
  latestOutboundBody: string | null | undefined;
}): boolean {
  if (!latestOutboundBodyContainsAdaptiveProposalBindingNeedle(args.latestOutboundBody, args.proposalText)) {
    return false;
  }

  const classification = classifyV2InboundReply((args.inboundBody || "").trim());
  return classification.eventType === "user_yes" || classification.eventType === "user_no";
}

/** @deprecated Prefer {@link legacyBindingNeedleContractProposalConsentGate} wording in new code paths. */
export function shouldConsumeInboundAsContractProposalConsent(args: {
  inboundBody: string;
  proposalText: string | null | undefined;
  latestOutboundBody: string | null | undefined;
}): boolean {
  return legacyBindingNeedleContractProposalConsentGate(args);
}

async function loadLatestProposalSnapshotsForConsent(
  commitmentId: string,
  clerkUserId: string
): Promise<SemanticDailyOutboundSnapshotCandidate[]> {
  const { supabaseServer } = await import("@/lib/supabase-server");
  const { data, error } = await supabaseServer
    .from("v2_check_sent_outbound_intent_snapshot")
    .select("message_sid,prompt_kind,expected_reply_semantics,check_payload_json,source_wrapped_at")
    .eq("commitment_id", commitmentId)
    .eq("clerk_user_id", clerkUserId)
    .order("source_wrapped_at", { ascending: false })
    .limit(36);

  if (error || !data?.length) return [];

  const out: SemanticDailyOutboundSnapshotCandidate[] = [];
  for (const raw of data as Record<string, unknown>[]) {
    const sid = typeof raw.message_sid === "string" ? raw.message_sid : "";
    const pk = typeof raw.prompt_kind === "string" ? raw.prompt_kind : "";
    const ers =
      typeof raw.expected_reply_semantics === "string" ? raw.expected_reply_semantics : "";
    const sw = typeof raw.source_wrapped_at === "string" ? raw.source_wrapped_at : "";
    const cpRaw = raw.check_payload_json;
    const payload =
      cpRaw != null && typeof cpRaw === "object" && !Array.isArray(cpRaw)
        ? (cpRaw as Record<string, unknown>)
        : {};
    if (!sid || !pk || !ers || !sw) continue;
    out.push({
      message_sid: sid,
      prompt_kind: pk,
      expected_reply_semantics: ers,
      source_wrapped_at: sw,
      check_payload_json: payload,
    });
  }
  return out;
}

function digestProposalText(proposalText: string): string {
  return proposalText.length > 180 ? `${proposalText.slice(0, 177)}...` : proposalText;
}

function mapSemanticReasonToGateReason(
  semanticReason: string
): ContractConsentOutboundGateFailReason {
  switch (semanticReason) {
    case "sid_missing":
      return "sid_missing";
    case "snapshot_missing":
      return "snapshot_missing";
    case "sid_mismatch":
      return "sid_mismatch";
    case "proposal_text_mismatch":
      return "proposal_text_mismatch";
    case "snapshot_expired":
      return "snapshot_expired";
    case "proposal_version_mismatch":
      return "proposal_version_mismatch";
    case "semantics_mismatch":
      return "semantics_mismatch";
    case "prompt_kind_mismatch":
      return "prompt_kind_mismatch";
    default:
      return "semantic_mismatch";
  }
}

/** Pure outbound-context diagnosis (no Supabase IO for last-outbound fields). */
export function diagnoseOutboundSupportsPendingAdaptiveProposalContext(args: {
  snapshots: ReadonlyArray<SemanticDailyOutboundSnapshotCandidate>;
  canonicalProposalText: string;
  latestOutboundBody: string | null | undefined;
  lastTwilioMessageSid: string | null | undefined;
  nowMs?: number;
}): ContractConsentOutboundGateDiagnosis {
  const canon = args.canonicalProposalText.trim();
  const lastSid =
    typeof args.lastTwilioMessageSid === "string" ? args.lastTwilioMessageSid.trim() : null;
  const lastBody = typeof args.latestOutboundBody === "string" ? args.latestOutboundBody : "";
  const now = args.nowMs ?? Date.now();
  const legacyNeedle = adaptiveProposalBindingNeedlePrefix(canon);
  const legacyHit = latestOutboundBodyContainsAdaptiveProposalBindingNeedle(lastBody, canon);

  const semantic = diagnoseSemanticDailyContractProposalSnapshots({
    snapshots: args.snapshots,
    lastTwilioMessageSid: lastSid,
    canonicalProposalText: canon,
    nowMs: now,
    snapshotTtlMs: V2_ADAPTIVE_PROPOSAL_TTL_MS,
  });

  if (semantic.matched) {
    return {
      ok: true,
      reason: "ok",
      details: {
        inbound_event_type: "n/a",
        proposal_text_digest: digestProposalText(canon),
        last_outbound_sid: lastSid,
        snapshot_count: args.snapshots.length,
        semantic_reason: "matched",
        legacy_needle_prefix: legacyNeedle,
        last_outbound_body_preview: lastBody.slice(0, 160),
        legacy_needle_hit: legacyHit,
      },
    };
  }

  if (legacyHit) {
    return {
      ok: true,
      reason: "ok",
      details: {
        inbound_event_type: "n/a",
        proposal_text_digest: digestProposalText(canon),
        last_outbound_sid: lastSid,
        snapshot_count: args.snapshots.length,
        semantic_reason: semantic.reason,
        legacy_needle_prefix: legacyNeedle,
        last_outbound_body_preview: lastBody.slice(0, 160),
        legacy_needle_hit: true,
      },
    };
  }

  return {
    ok: false,
    reason: mapSemanticReasonToGateReason(semantic.reason),
    details: {
      inbound_event_type: "n/a",
      proposal_text_digest: digestProposalText(canon),
      last_outbound_sid: lastSid,
      snapshot_count: args.snapshots.length,
      semantic_reason: semantic.reason,
      legacy_needle_prefix: legacyNeedle,
      last_outbound_body_preview: lastBody.slice(0, 160),
      legacy_needle_hit: false,
    },
  };
}

/**
 * Determines whether outbound context still reflects the user's pending adaptive proposal:
 * semantic daily snapshots (preferred for v1_semantic_daily) else legacy needle.
 */
export async function outboundSupportsPendingAdaptiveProposalContextAsync(args: {
  commitmentId: string;
  clerkUserId: string;
  canonicalProposalText: string;
  latestOutboundBody: string | null | undefined;
  lastTwilioMessageSid: string | null | undefined;
  nowMs?: number;
}): Promise<boolean> {
  const snaps = await loadLatestProposalSnapshotsForConsent(args.commitmentId, args.clerkUserId);
  const diagnosis = diagnoseOutboundSupportsPendingAdaptiveProposalContext({
    snapshots: snaps,
    canonicalProposalText: args.canonicalProposalText,
    latestOutboundBody: args.latestOutboundBody,
    lastTwilioMessageSid: args.lastTwilioMessageSid,
    nowMs: args.nowMs,
  });
  return diagnosis.ok;
}

/** Full gate diagnosis including inbound classifier + last-outbound context load. */
export async function diagnoseContractConsentOutboundGateAsync(args: {
  commitmentId: string;
  clerkUserId: string;
  inboundBody: string;
  proposalText: string | null | undefined;
  nowMs?: number;
}): Promise<ContractConsentOutboundGateDiagnosis> {
  const trimmedInbound = (args.inboundBody || "").trim();
  const classification = classifyV2InboundReply(trimmedInbound);
  const inboundEventType = classification.eventType;

  const proposalCanon = typeof args.proposalText === "string" ? args.proposalText.trim() : "";
  if (classification.eventType !== "user_yes" && classification.eventType !== "user_no") {
    return {
      ok: false,
      reason: "not_yes_no",
      details: {
        inbound_event_type: inboundEventType,
        proposal_text_digest: proposalCanon ? digestProposalText(proposalCanon) : "",
        last_outbound_sid: null,
        snapshot_count: 0,
        semantic_reason: null,
        legacy_needle_prefix: adaptiveProposalBindingNeedlePrefix(proposalCanon),
        last_outbound_body_preview: "",
        legacy_needle_hit: false,
      },
    };
  }

  if (!proposalCanon) {
    return {
      ok: false,
      reason: "proposal_text_empty",
      details: {
        inbound_event_type: inboundEventType,
        proposal_text_digest: "",
        last_outbound_sid: null,
        snapshot_count: 0,
        semantic_reason: null,
        legacy_needle_prefix: "",
        last_outbound_body_preview: "",
        legacy_needle_hit: false,
      },
    };
  }

  const { supabaseServer } = await import("@/lib/supabase-server");
  const { data: lastCtx } = await supabaseServer
    .from("sms_last_outbound_context")
    .select("full_body,twilio_message_sid")
    .eq("clerk_user_id", args.clerkUserId)
    .maybeSingle();

  const lastSid =
    typeof lastCtx?.twilio_message_sid === "string" ? lastCtx.twilio_message_sid.trim() : null;
  const lastBody = typeof lastCtx?.full_body === "string" ? lastCtx.full_body : "";

  const snaps = await loadLatestProposalSnapshotsForConsent(args.commitmentId, args.clerkUserId);
  const outbound = diagnoseOutboundSupportsPendingAdaptiveProposalContext({
    snapshots: snaps,
    canonicalProposalText: proposalCanon,
    latestOutboundBody: lastBody,
    lastTwilioMessageSid: lastSid,
    nowMs: args.nowMs,
  });

  return {
    ok: outbound.ok,
    reason: outbound.ok ? "ok" : outbound.reason,
    details: {
      ...outbound.details,
      inbound_event_type: inboundEventType,
    },
  };
}

/** Production gate: deterministic YES/NO only, plus outbound contract context (semantic daily or legacy needle). */
export async function shouldConsumeInboundAsContractProposalConsentAsync(args: {
  commitmentId: string;
  clerkUserId: string;
  inboundBody: string;
  proposalText: string | null | undefined;
  nowMs?: number;
}): Promise<boolean> {
  const diagnosis = await diagnoseContractConsentOutboundGateAsync(args);
  return diagnosis.ok;
}
