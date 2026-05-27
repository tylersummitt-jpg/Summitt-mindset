import { classifyV2InboundReply } from "@/lib/v2-sms-accountability";
import {
  matchSemanticDailyContractProposalSnapshots,
  type SemanticDailyOutboundSnapshotCandidate,
} from "@/lib/v3-daily-contract-proposal-semantic";

// Keep this module import-safe in unit tests (no supabase client required at import time).
const V2_ADAPTIVE_PROPOSAL_TTL_MS = 48 * 60 * 60 * 1000;

function norm(s: string): string {
  return (s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

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
  const now = args.nowMs ?? Date.now();

  const semanticHit = matchSemanticDailyContractProposalSnapshots({
    snapshots: snaps,
    lastTwilioMessageSid: args.lastTwilioMessageSid,
    canonicalProposalText: args.canonicalProposalText,
    nowMs: now,
    snapshotTtlMs: V2_ADAPTIVE_PROPOSAL_TTL_MS,
  });
  if (semanticHit) return true;

  return latestOutboundBodyContainsAdaptiveProposalBindingNeedle(
    args.latestOutboundBody,
    args.canonicalProposalText
  );
}

/** Production gate: deterministic YES/NO only, plus outbound contract context (semantic daily or legacy needle). */
export async function shouldConsumeInboundAsContractProposalConsentAsync(args: {
  commitmentId: string;
  clerkUserId: string;
  inboundBody: string;
  proposalText: string | null | undefined;
  nowMs?: number;
}): Promise<boolean> {
  const trimmedInbound = (args.inboundBody || "").trim();
  const classification = classifyV2InboundReply(trimmedInbound);
  if (classification.eventType !== "user_yes" && classification.eventType !== "user_no") return false;

  const proposalCanon = typeof args.proposalText === "string" ? args.proposalText.trim() : "";
  if (!proposalCanon) return false;

  const { supabaseServer } = await import("@/lib/supabase-server");
  const { data: lastCtx } = await supabaseServer
    .from("sms_last_outbound_context")
    .select("full_body,twilio_message_sid")
    .eq("clerk_user_id", args.clerkUserId)
    .maybeSingle();

  const lastSid =
    typeof lastCtx?.twilio_message_sid === "string" ? lastCtx.twilio_message_sid.trim() : null;
  const lastBody = typeof lastCtx?.full_body === "string" ? lastCtx.full_body : "";

  return outboundSupportsPendingAdaptiveProposalContextAsync({
    commitmentId: args.commitmentId,
    clerkUserId: args.clerkUserId,
    canonicalProposalText: proposalCanon,
    latestOutboundBody: lastBody,
    lastTwilioMessageSid: lastSid,
    nowMs: args.nowMs,
  });
}
