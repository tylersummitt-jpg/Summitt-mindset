import "server-only";

import { supabaseServer } from "@/lib/supabase-server";

export {
  V2_IDENTITY_ANCHOR_MAX_CHARS,
  ONBOARDING_IDENTITY_ANCHOR_SOURCE,
  isQuotableIdentitySource,
  isRelationshipDerivedIdentitySource,
  normalizeIdentityAnchorText,
  isRelationshipOnlyIdentityAnchorStub,
  validateOnboardingIdentityAnchorInput,
  type OnboardingIdentityAnchorValidation,
} from "./v2-identity-anchor-validation";

import { isQuotableIdentitySource } from "./v2-identity-anchor-validation";

/** 75 days — refresh cadence for identity grounding in V2 SMS (milliseconds). */
export const V2_IDENTITY_REFRESH_INTERVAL_MS = 75 * 24 * 60 * 60 * 1000;

/** Minimum gap between outbound messages that actually quote the anchor (milliseconds). */
export const V2_IDENTITY_REFERENCE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

export function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso || typeof iso !== "string") return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

export type V2IdentityReferencePolicyArgs = {
  nowMs: number;
  identityAnchorText: string | null | undefined;
  /** When set, relationship-derived or unknown sources disallow quoting even if anchor text exists. */
  identitySource?: string | null;
  identityRefreshDueAt: string | null | undefined;
  identityLastReferencedAt: string | null | undefined;
  accountabilityPhase: "active_accountability" | "low_pressure_reactivation";
  contractProposalMode: boolean;
  /** When a coaching refresh session is active, suppress identity grounding in normal checks. */
  refreshSessionActive?: boolean;
  /** Outbound: serverStrategy; use `reactivation_nudge` to suppress. */
  serverStrategy?: string;
};

/**
 * Selective server gate: identity may appear in outbound only when all conditions pass.
 * Does not decide copy — AI/templates still must follow validation rules.
 */
export function computeIdentityReferenceAllowed(args: V2IdentityReferencePolicyArgs): boolean {
  const anchor = typeof args.identityAnchorText === "string" ? args.identityAnchorText.trim() : "";
  if (!anchor) return false;
  if (args.identitySource !== undefined && !isQuotableIdentitySource(args.identitySource)) {
    return false;
  }

  if (args.refreshSessionActive) return false;
  if (args.accountabilityPhase === "low_pressure_reactivation") return false;
  if (args.contractProposalMode) return false;
  if (args.serverStrategy === "reactivation_nudge") return false;

  const dueAt = parseIsoMs(args.identityRefreshDueAt);
  if (dueAt == null || args.nowMs < dueAt) return false;

  const lastRef = parseIsoMs(args.identityLastReferencedAt);
  if (lastRef != null && args.nowMs - lastRef < V2_IDENTITY_REFERENCE_COOLDOWN_MS) {
    return false;
  }

  return true;
}

export type V2InboundIdentityPolicyArgs = Omit<
  V2IdentityReferencePolicyArgs,
  "serverStrategy" | "contractProposalMode"
> & {
  /** When user text ends low-pressure pause, treat as normal accountability for this gate. */
  brokePause?: boolean;
};

export function computeIdentityReferenceAllowedInbound(args: V2InboundIdentityPolicyArgs): boolean {
  const { brokePause, ...rest } = args;
  const phase =
    brokePause && args.accountabilityPhase === "low_pressure_reactivation"
      ? "active_accountability"
      : args.accountabilityPhase;
  return computeIdentityReferenceAllowed({
    ...rest,
    accountabilityPhase: phase,
    contractProposalMode: false,
    serverStrategy: undefined,
  });
}

/** True if message appears to invoke identity wording without including the full anchor (substring leak). */
export function identityAnchorLeakDetected(message: string, anchor: string): boolean {
  const a = anchor.trim();
  const msg = (message || "").trim();
  if (!a || !msg) return false;
  if (msg.includes(a)) return false;
  const probeLen = Math.min(24, a.length);
  if (probeLen < 10) return false;
  const needle = a.slice(0, probeLen).toLowerCase();
  return msg.toLowerCase().includes(needle);
}

/** True iff final sent body includes the exact normalized anchor as substring. */
export function sentMessageUsesVerbatimIdentityAnchor(message: string, anchor: string): boolean {
  const a = anchor.trim();
  if (!a) return false;
  return (message || "").includes(a);
}

/**
 * User explicitly confirmed identity via refresh SMS (STILL) — advances refresh cycle only;
 * does not read or rewrite `identity_anchor_text` from inbound.
 */
export async function bumpIdentityRefreshCycleAfterRefreshStillReply(args: {
  clerkUserId: string;
}): Promise<void> {
  const now = new Date();
  const nextRefresh = new Date(now.getTime() + V2_IDENTITY_REFRESH_INTERVAL_MS).toISOString();
  const nowIso = now.toISOString();

  const { error } = await supabaseServer
    .from("user_profiles")
    .update({
      identity_last_referenced_at: nowIso,
      identity_refresh_due_at: nextRefresh,
    })
    .eq("clerk_user_id", args.clerkUserId);

  if (error) {
    console.error("[v2-identity-anchor] bumpIdentityRefreshCycleAfterRefreshStillReply failed", {
      clerk_user_id: args.clerkUserId,
      message: error.message,
    });
  }
}

export async function markIdentityAnchorReferencedIfPresentInBody(args: {
  clerkUserId: string;
  sentBody: string;
  identityAnchorText: string | null | undefined;
}): Promise<void> {
  const anchor = typeof args.identityAnchorText === "string" ? args.identityAnchorText.trim() : "";
  if (!anchor) return;
  if (!sentMessageUsesVerbatimIdentityAnchor(args.sentBody, anchor)) return;

  const now = new Date();
  const nextRefresh = new Date(now.getTime() + V2_IDENTITY_REFRESH_INTERVAL_MS).toISOString();
  const nowIso = now.toISOString();

  const { error } = await supabaseServer
    .from("user_profiles")
    .update({
      identity_last_referenced_at: nowIso,
      identity_refresh_due_at: nextRefresh,
    })
    .eq("clerk_user_id", args.clerkUserId);

  if (error) {
    console.error("[v2-identity-anchor] markIdentityAnchorReferencedIfPresentInBody failed", {
      clerk_user_id: args.clerkUserId,
      message: error.message,
    });
  }
}

export function computeIdentityRefreshDueAtIsoFromNow(nowMs: number = Date.now()): string {
  return new Date(nowMs + V2_IDENTITY_REFRESH_INTERVAL_MS).toISOString();
}

/** For prompts / memory: refresh window is open (informational; server gate still applies). */
export function isIdentityRefreshDue(
  identityRefreshDueAt: string | null | undefined,
  nowMs: number
): boolean {
  const dueAt = parseIsoMs(identityRefreshDueAt);
  if (dueAt == null) return false;
  return nowMs >= dueAt;
}
