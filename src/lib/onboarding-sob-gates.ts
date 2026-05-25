/**
 * Centralized SoB onboarding gate status (no needs_why, no life_desires).
 */

import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";
import { supabaseServer } from "@/lib/supabase-server";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";
import { hasValidSmsConsent, type ClerkSmsMetadata } from "@/lib/onboarding-sms-consent";

export { MEMBER_APP_HOME_PATH };

export type OnboardingSobStatus =
  | "needs_subscription"
  | "complete"
  | "needs_identity"
  | "needs_current_goal"
  | "needs_review"
  | "needs_sms"
  | "needs_complete"
  | "inconsistent_state";

export type OnboardingSobGateResult = {
  status: OnboardingSobStatus;
  redirectTo: string | null;
};

/** Step order for skip-ahead prevention (backward navigation allowed). */
export const ONBOARDING_PATH_RANK: Record<string, number> = {
  "/onboarding": 0,
  "/onboarding/identity": 1,
  "/onboarding/commitment": 2,
  "/onboarding/review": 3,
  "/onboarding/sms": 4,
  "/onboarding/complete": 5,
};

const STATUS_MAX_ACCESSIBLE_RANK: Record<OnboardingSobStatus, number> = {
  needs_subscription: -1,
  complete: 99,
  needs_identity: 1,
  needs_current_goal: 2,
  needs_review: 3,
  needs_sms: 4,
  needs_complete: 5,
  inconsistent_state: 0,
};

export async function getOnboardingSobStatus(
  clerkUserId: string,
  md: ClerkSmsMetadata
): Promise<OnboardingSobGateResult> {
  if (!isSubscribedFromPublicMetadata(md)) {
    return { status: "needs_subscription", redirectTo: "/subscribe?from=onboarding" };
  }

  if (md?.onboardingCompleted === true) {
    return { status: "complete", redirectTo: MEMBER_APP_HOME_PATH };
  }

  const { data: profile } = await supabaseServer
    .from("user_profiles")
    .select("preferred_name, identity_anchor_text, active_identity_version_id")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  const hasPreferred =
    typeof profile?.preferred_name === "string" &&
    profile.preferred_name.trim().length > 0;
  const hasAnchor =
    typeof profile?.identity_anchor_text === "string" &&
    profile.identity_anchor_text.trim().length > 0;
  const hasVersion = Boolean(profile?.active_identity_version_id);

  if (!profile || !hasPreferred || !hasAnchor || !hasVersion) {
    return { status: "needs_identity", redirectTo: "/onboarding/identity" };
  }

  const { data: proposed } = await supabaseServer
    .from("v2_commitment")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: active } = await supabaseServer
    .from("v2_commitment")
    .select("id")
    .eq("clerk_user_id", clerkUserId)
    .eq("status", "active")
    .maybeSingle();

  if (!proposed?.id && !active?.id) {
    return { status: "needs_current_goal", redirectTo: "/onboarding/commitment" };
  }

  if (proposed?.id && !active?.id) {
    const { data: intake } = await supabaseServer
      .from("v2_commitment_intake")
      .select("review_acknowledged_at")
      .eq("commitment_id", proposed.id)
      .maybeSingle();

    const acknowledged =
      intake?.review_acknowledged_at != null &&
      String(intake.review_acknowledged_at).trim().length > 0;

    if (!acknowledged) {
      return { status: "needs_review", redirectTo: "/onboarding/review" };
    }
  }

  if (!hasValidSmsConsent(md)) {
    return { status: "needs_sms", redirectTo: "/onboarding/sms" };
  }

  if (active?.id || proposed?.id) {
    return { status: "needs_complete", redirectTo: "/onboarding/complete" };
  }

  return { status: "inconsistent_state", redirectTo: "/onboarding" };
}

/**
 * Returns a redirect path when the user may not access currentPath, else null.
 */
export async function resolveOnboardingSobRedirect(
  clerkUserId: string,
  md: ClerkSmsMetadata,
  currentPath: string
): Promise<string | null> {
  const gate = await getOnboardingSobStatus(clerkUserId, md);

  if (gate.status === "needs_subscription") {
    return gate.redirectTo;
  }

  if (gate.status === "complete") {
    if (currentPath.startsWith("/onboarding")) {
      return gate.redirectTo ?? MEMBER_APP_HOME_PATH;
    }
    return null;
  }

  const required = gate.redirectTo;
  if (!required) return null;

  if (currentPath === "/onboarding" && gate.status !== "needs_identity") {
    return required;
  }

  const currentRank = ONBOARDING_PATH_RANK[currentPath] ?? -1;
  const maxRank = STATUS_MAX_ACCESSIBLE_RANK[gate.status];

  if (currentRank > maxRank) {
    return required;
  }

  return null;
}

/** @deprecated Use resolveOnboardingSobRedirect */
export async function enforceOnboardingSobGate(
  clerkUserId: string,
  md: ClerkSmsMetadata,
  currentPath: string,
  _allowedPaths: string[]
): Promise<string | null> {
  return resolveOnboardingSobRedirect(clerkUserId, md, currentPath);
}

export const SOB_ONBOARDING_PATHS = [
  "/onboarding",
  "/onboarding/identity",
  "/onboarding/commitment",
  "/onboarding/review",
  "/onboarding/sms",
  "/onboarding/complete",
] as const;
