import "server-only";

import { supabaseServer } from "@/lib/supabase-server";

export type SobActivationRpcRow = {
  result: string;
  commitment_id: string | null;
  season_id: string | null;
  commitment_was_activated: boolean;
  activated_event_inserted: boolean;
  prior_seasons_archived: number;
};

export type SobActivationResult =
  | {
      ok: true;
      commitmentId: string;
      seasonId: string;
      commitmentWasActivated: boolean;
      activatedEventInserted: boolean;
      priorSeasonsArchived: number;
    }
  | { ok: false; code: "no_commitment" | "no_identity" | "conflict" | "error"; message: string };

export async function runSobCompleteOnboardingActivation(
  clerkUserId: string
): Promise<SobActivationResult> {
  const { data, error } = await supabaseServer.rpc("sob_complete_onboarding_activation", {
    p_clerk_user_id: clerkUserId,
  });

  if (error) {
    console.error("[onboarding-complete-activation] RPC failed", error);
    return { ok: false, code: "error", message: "Failed to activate onboarding" };
  }

  const row = (Array.isArray(data) ? data[0] : data) as SobActivationRpcRow | undefined;
  if (!row?.result) {
    return { ok: false, code: "error", message: "Failed to activate onboarding" };
  }

  if (row.result === "ok" && row.commitment_id && row.season_id) {
    return {
      ok: true,
      commitmentId: row.commitment_id,
      seasonId: row.season_id,
      commitmentWasActivated: Boolean(row.commitment_was_activated),
      activatedEventInserted: Boolean(row.activated_event_inserted),
      priorSeasonsArchived: row.prior_seasons_archived ?? 0,
    };
  }

  if (row.result === "no_commitment") {
    return {
      ok: false,
      code: "no_commitment",
      message: "Commitment must be saved before completing onboarding.",
    };
  }

  if (row.result === "no_identity") {
    return {
      ok: false,
      code: "no_identity",
      message: "Identity must be saved before completing onboarding.",
    };
  }

  if (row.result === "conflict") {
    return {
      ok: false,
      code: "conflict",
      message: "Onboarding activation conflict. Please retry.",
    };
  }

  return { ok: false, code: "error", message: "Failed to activate onboarding" };
}
