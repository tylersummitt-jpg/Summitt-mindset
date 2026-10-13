import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import { unixFromIso } from "@/lib/stripe-first-checkout/hold-decision";
import type { HoldIntentView } from "@/lib/stripe-first-checkout/hold-decision";

export type CheckoutBrowserIntent = {
  id: string;
  binding_hash: string;
  livemode: boolean;
  email: string | null;
  visitor_id: string | null;
  experiment_id: string | null;
  experiment_variant: string | null;
  stripe_checkout_session_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_trial_end_at: string | null;
  stripe_hold_cancel_at: string | null;
  clerk_user_id: string | null;
  binding_expires_at: string;
  activation_recoverable_until: string | null;
  checkout_initiated_at: string | null;
  stripe_trial_confirmed_at: string | null;
  hold_confirmed_at: string | null;
  sign_in_required_at: string | null;
  clerk_user_provisioned_at: string | null;
  session_started_at: string | null;
  hold_released_at: string | null;
  created_at: string;
  updated_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function logIntentError(scope: string, code: string | undefined) {
  console.error("[stripe-first] intent write failed", { scope, code: code ?? "unknown" });
}

export function holdView(row: CheckoutBrowserIntent): HoldIntentView {
  return {
    sessionStarted: row.session_started_at != null,
    holdConfirmed: row.hold_confirmed_at != null,
    holdReleased: row.hold_released_at != null,
    trialConfirmed: row.stripe_trial_confirmed_at != null,
    storedHoldCancelAtUnix: unixFromIso(row.stripe_hold_cancel_at),
  };
}

export async function insertCheckoutIntent(args: {
  bindingHash: string;
  bindingExpiresAt: string;
  visitorId: string | null;
  experimentId: string | null;
  experimentVariant: string | null;
}): Promise<CheckoutBrowserIntent> {
  const { data, error } = await supabaseServer
    .from("checkout_browser_intents")
    .insert({
      binding_hash: args.bindingHash,
      livemode: false,
      visitor_id: args.visitorId,
      experiment_id: args.experimentId,
      experiment_variant: args.experimentVariant,
      binding_expires_at: args.bindingExpiresAt,
      updated_at: nowIso(),
    })
    .select("*")
    .single();

  if (error || !data) {
    logIntentError("insert", error?.code);
    throw new Error("intent_insert_failed");
  }
  return data as CheckoutBrowserIntent;
}

export async function loadIntentByBindingHash(
  bindingHash: string
): Promise<CheckoutBrowserIntent | null> {
  const { data, error } = await supabaseServer
    .from("checkout_browser_intents")
    .select("*")
    .eq("binding_hash", bindingHash)
    .maybeSingle();
  if (error) {
    logIntentError("load_binding", error.code);
    throw new Error("intent_load_failed");
  }
  return (data as CheckoutBrowserIntent | null) ?? null;
}

export async function loadIntentById(
  id: string
): Promise<CheckoutBrowserIntent | null> {
  const { data, error } = await supabaseServer
    .from("checkout_browser_intents")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logIntentError("load_id", error.code);
    throw new Error("intent_load_failed");
  }
  return (data as CheckoutBrowserIntent | null) ?? null;
}

export async function loadLatestIntentForClerkUser(
  clerkUserId: string
): Promise<CheckoutBrowserIntent | null> {
  const { data, error } = await supabaseServer
    .from("checkout_browser_intents")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    logIntentError("load_user", error.code);
    throw new Error("intent_load_failed");
  }
  const row = data?.[0];
  return (row as CheckoutBrowserIntent | undefined) ?? null;
}

export async function attachCheckoutSession(args: {
  intentId: string;
  sessionId: string;
}): Promise<boolean> {
  const timestamp = nowIso();
  const { data, error } = await supabaseServer
    .from("checkout_browser_intents")
    .update({
      stripe_checkout_session_id: args.sessionId,
      checkout_initiated_at: timestamp,
      updated_at: timestamp,
    })
    .eq("id", args.intentId)
    .is("stripe_checkout_session_id", null)
    .is("checkout_initiated_at", null)
    .select("id");
  if (error) {
    logIntentError("attach_session", error.code);
    throw new Error("intent_update_failed");
  }
  return (data?.length ?? 0) > 0;
}

export async function confirmStripeTrial(args: {
  intentId: string;
  sessionId: string;
  customerId: string;
  subscriptionId: string;
  email: string;
  trialEndIso: string;
}): Promise<"saved" | "already" | "mismatch"> {
  const existing = await loadIntentById(args.intentId);
  if (!existing) return "mismatch";
  if (
    existing.stripe_checkout_session_id &&
    existing.stripe_checkout_session_id !== args.sessionId
  ) {
    return "mismatch";
  }
  if (
    existing.stripe_subscription_id &&
    existing.stripe_subscription_id !== args.subscriptionId
  ) {
    return "mismatch";
  }
  if (existing.stripe_trial_confirmed_at) return "already";

  const timestamp = nowIso();
  const { data, error } = await supabaseServer
    .from("checkout_browser_intents")
    .update({
      email: args.email,
      stripe_checkout_session_id: args.sessionId,
      stripe_customer_id: args.customerId,
      stripe_subscription_id: args.subscriptionId,
      stripe_trial_end_at: args.trialEndIso,
      stripe_trial_confirmed_at: timestamp,
      checkout_initiated_at: existing.checkout_initiated_at ?? timestamp,
      activation_recoverable_until: args.trialEndIso,
      updated_at: timestamp,
    })
    .eq("id", args.intentId)
    .is("stripe_trial_confirmed_at", null)
    .select("id");
  if (error) {
    logIntentError("confirm_trial", error.code);
    throw new Error("intent_update_failed");
  }
  if ((data?.length ?? 0) > 0) return "saved";
  const fresh = await loadIntentById(args.intentId);
  if (fresh?.stripe_trial_confirmed_at && fresh.stripe_subscription_id === args.subscriptionId) {
    return "already";
  }
  return "mismatch";
}

export async function markHoldConfirmed(args: {
  intentId: string;
  holdCancelAtIso: string;
  allowAfterSession: boolean;
}): Promise<boolean> {
  const timestamp = nowIso();
  let query = supabaseServer
    .from("checkout_browser_intents")
    .update({
      hold_confirmed_at: timestamp,
      stripe_hold_cancel_at: args.holdCancelAtIso,
      updated_at: timestamp,
    })
    .eq("id", args.intentId)
    .is("hold_confirmed_at", null)
    .is("hold_released_at", null)
    .not("stripe_trial_confirmed_at", "is", null);
  if (!args.allowAfterSession) {
    query = query.is("session_started_at", null);
  }
  const { data, error } = await query.select("id");
  if (error) {
    logIntentError("hold_confirmed", error.code);
    throw new Error("intent_update_failed");
  }
  return (data?.length ?? 0) > 0;
}

export async function markSignInRequired(intentId: string): Promise<boolean> {
  const timestamp = nowIso();
  const { data, error } = await supabaseServer
    .from("checkout_browser_intents")
    .update({
      sign_in_required_at: timestamp,
      updated_at: timestamp,
    })
    .eq("id", intentId)
    .is("sign_in_required_at", null)
    .is("clerk_user_provisioned_at", null)
    .is("clerk_user_id", null)
    .select("id");
  if (error) {
    logIntentError("sign_in_required", error.code);
    throw new Error("intent_update_failed");
  }
  return (data?.length ?? 0) > 0;
}

export async function markClerkProvisioned(args: {
  intentId: string;
  clerkUserId: string;
}): Promise<boolean> {
  const timestamp = nowIso();
  const { data, error } = await supabaseServer
    .from("checkout_browser_intents")
    .update({
      clerk_user_id: args.clerkUserId,
      clerk_user_provisioned_at: timestamp,
      updated_at: timestamp,
    })
    .eq("id", args.intentId)
    .is("clerk_user_provisioned_at", null)
    .is("sign_in_required_at", null)
    .is("clerk_user_id", null)
    .select("id");
  if (error) {
    logIntentError("provisioned", error.code);
    throw new Error("intent_update_failed");
  }
  return (data?.length ?? 0) > 0;
}

export async function markSessionStartedForProvisionedUser(
  intentId: string,
  clerkUserId: string
): Promise<boolean> {
  const timestamp = nowIso();
  const { data, error } = await supabaseServer
    .from("checkout_browser_intents")
    .update({
      session_started_at: timestamp,
      updated_at: timestamp,
    })
    .eq("id", intentId)
    .eq("clerk_user_id", clerkUserId)
    .is("session_started_at", null)
    .is("sign_in_required_at", null)
    .not("clerk_user_provisioned_at", "is", null)
    .select("id");
  if (error) {
    logIntentError("session_provisioned", error.code);
    throw new Error("intent_update_failed");
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Existing Clerk account. clerk_user_provisioned_at stays null.
 */
export async function markSessionStartedForExistingUser(args: {
  intentId: string;
  clerkUserId: string;
}): Promise<boolean> {
  const timestamp = nowIso();
  const { data, error } = await supabaseServer
    .from("checkout_browser_intents")
    .update({
      clerk_user_id: args.clerkUserId,
      session_started_at: timestamp,
      updated_at: timestamp,
    })
    .eq("id", args.intentId)
    .not("sign_in_required_at", "is", null)
    .is("clerk_user_provisioned_at", null)
    .is("clerk_user_id", null)
    .is("session_started_at", null)
    .select("id");
  if (error) {
    logIntentError("session_existing", error.code);
    throw new Error("intent_update_failed");
  }
  return (data?.length ?? 0) > 0;
}

export async function markHoldReleased(intentId: string): Promise<boolean> {
  const timestamp = nowIso();
  const { data, error } = await supabaseServer
    .from("checkout_browser_intents")
    .update({
      hold_released_at: timestamp,
      updated_at: timestamp,
    })
    .eq("id", intentId)
    .not("session_started_at", "is", null)
    .not("hold_confirmed_at", "is", null)
    .is("hold_released_at", null)
    .select("id");
  if (error) {
    logIntentError("hold_released", error.code);
    throw new Error("intent_update_failed");
  }
  return (data?.length ?? 0) > 0;
}

export async function markHoldConfirmedAndReleased(args: {
  intentId: string;
  holdCancelAtIso: string;
}): Promise<boolean> {
  const timestamp = nowIso();
  const { data, error } = await supabaseServer
    .from("checkout_browser_intents")
    .update({
      hold_confirmed_at: timestamp,
      stripe_hold_cancel_at: args.holdCancelAtIso,
      hold_released_at: timestamp,
      updated_at: timestamp,
    })
    .eq("id", args.intentId)
    .not("session_started_at", "is", null)
    .not("stripe_trial_confirmed_at", "is", null)
    .is("hold_released_at", null)
    .select("id");
  if (error) {
    logIntentError("hold_confirmed_released", error.code);
    throw new Error("intent_update_failed");
  }
  return (data?.length ?? 0) > 0;
}

export async function updateIntentEmail(args: {
  intentId: string;
  email: string;
}): Promise<void> {
  const { error } = await supabaseServer
    .from("checkout_browser_intents")
    .update({
      email: args.email,
      updated_at: nowIso(),
    })
    .eq("id", args.intentId);
  if (error) {
    logIntentError("email", error.code);
    throw new Error("intent_update_failed");
  }
}
