/**
 * D2b photo-only outbound SMS eligibility.
 * Does not require or fabricate inbound coach jobs.
 */

import "server-only";

import { hasUnresolvedAccountDeletionRequest } from "@/lib/account-deletion/deletion-guards";
import { supabaseServer } from "@/lib/supabase-server";

export type InboundMmsD2bSmsEligibilityReason =
  | "eligible"
  | "account_deleting"
  | "identity_missing"
  | "sms_disabled"
  | "sms_stopped"
  | "phone_missing"
  | "lookup_failed";

export type InboundMmsD2bSmsEligibilityResult =
  | { ok: true; reason: "eligible"; phone: string }
  | {
      ok: false;
      reason: Exclude<InboundMmsD2bSmsEligibilityReason, "eligible">;
    };

export type CheckInboundMmsD2bSmsEligibilityInput = {
  clerkUserId: string;
};

export type CheckInboundMmsD2bSmsEligibilityDeps = {
  hasUnresolvedDeletion?: (clerkUserId: string) => Promise<boolean>;
  loadIdentity?: (clerkUserId: string) => Promise<{
    phone_number: string | null;
    sms_enabled: boolean | null;
    stopped_at: string | null;
  } | null | "error">;
};

async function defaultLoadIdentity(clerkUserId: string): Promise<{
  phone_number: string | null;
  sms_enabled: boolean | null;
  stopped_at: string | null;
} | null | "error"> {
  const { data, error } = await supabaseServer
    .from("sms_identities")
    .select("phone_number, sms_enabled, stopped_at")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (error) return "error";
  if (!data) return null;
  return {
    phone_number:
      typeof data.phone_number === "string" ? data.phone_number : null,
    sms_enabled: data.sms_enabled === true,
    stopped_at: typeof data.stopped_at === "string" ? data.stopped_at : null,
  };
}

/**
 * Pre-Twilio gate for D2b clarification. Does not send. Does not mutate rows.
 */
export async function checkInboundMmsD2bSmsEligibility(
  input: CheckInboundMmsD2bSmsEligibilityInput,
  deps: CheckInboundMmsD2bSmsEligibilityDeps = {}
): Promise<InboundMmsD2bSmsEligibilityResult> {
  const clerkUserId = input.clerkUserId.trim();
  if (!clerkUserId) {
    return { ok: false, reason: "identity_missing" };
  }

  const deletionCheck =
    deps.hasUnresolvedDeletion ?? hasUnresolvedAccountDeletionRequest;
  try {
    if (await deletionCheck(clerkUserId)) {
      return { ok: false, reason: "account_deleting" };
    }
  } catch {
    return { ok: false, reason: "lookup_failed" };
  }

  const loadIdentity = deps.loadIdentity ?? defaultLoadIdentity;
  let ident: Awaited<ReturnType<typeof defaultLoadIdentity>>;
  try {
    ident = await loadIdentity(clerkUserId);
  } catch {
    return { ok: false, reason: "lookup_failed" };
  }
  if (ident === "error") return { ok: false, reason: "lookup_failed" };
  if (!ident) return { ok: false, reason: "identity_missing" };
  if (ident.sms_enabled !== true) {
    return { ok: false, reason: "sms_disabled" };
  }
  if (ident.stopped_at != null && ident.stopped_at.trim() !== "") {
    return { ok: false, reason: "sms_stopped" };
  }
  const phone = ident.phone_number?.trim() ?? "";
  if (!phone) return { ok: false, reason: "phone_missing" };
  return { ok: true, reason: "eligible", phone };
}
