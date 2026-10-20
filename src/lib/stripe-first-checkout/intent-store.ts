import "server-only";

import {
  listPendingMetaConversionsForSubscription,
  metaConversionEventWithinMaxAge,
} from "@/lib/meta-conversion-ledger";
import { loadMetaCapiWebIdentifiersForUser } from "@/lib/meta-capi-web-identifiers";
import {
  sanitizeMetaClientIp,
  sanitizeMetaClientUserAgent,
  sanitizeMetaFbc,
  sanitizeMetaFbp,
} from "@/lib/meta-capi-web-identifier-validation";
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
  meta_fbc: string | null;
  meta_fbp: string | null;
  client_ip: string | null;
  client_user_agent: string | null;
};

export const CHECKOUT_MATCH_PAYMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const CHECKOUT_MATCH_CLEANUP_LIMIT = 40;

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

export async function liveCanaryIntentExists(): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("checkout_browser_intents")
    .select("id")
    .eq("livemode", true)
    .limit(1);
  if (error) {
    logIntentError("canary_exists", error.code);
    throw new Error("intent_load_failed");
  }
  return (data?.length ?? 0) > 0;
}

/** Removes an owner-canary row only when no Checkout Session was stored. */
export async function deleteUnstartedLiveIntent(intentId: string): Promise<void> {
  const { error } = await supabaseServer
    .from("checkout_browser_intents")
    .delete()
    .eq("id", intentId)
    .eq("livemode", true)
    .is("stripe_checkout_session_id", null);
  if (error) logIntentError("canary_rollback", error.code);
}

export async function insertCheckoutIntent(args: {
  bindingHash: string;
  bindingExpiresAt: string;
  visitorId: string | null;
  experimentId: string | null;
  experimentVariant: string | null;
  livemode: boolean;
}): Promise<CheckoutBrowserIntent> {
  const { data, error } = await supabaseServer
    .from("checkout_browser_intents")
    .insert({
      binding_hash: args.bindingHash,
      livemode: args.livemode,
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

export async function loadIntentBySubscriptionId(
  subscriptionId: string
): Promise<CheckoutBrowserIntent | null> {
  const subId = subscriptionId.trim();
  if (!subId) return null;
  const { data, error } = await supabaseServer
    .from("checkout_browser_intents")
    .select("*")
    .eq("stripe_subscription_id", subId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    logIntentError("load_subscription", error.code);
    throw new Error("intent_load_failed");
  }
  const row = data?.[0];
  return (row as CheckoutBrowserIntent | undefined) ?? null;
}

/**
 * Fill empty match columns only. Never replaces an fbc already stored.
 * Fail-open: checkout continues when this write fails.
 */
export async function saveCheckoutMatchFields(args: {
  intentId: string;
  fbc: string | null;
  fbp: string | null;
  clientIp: string | null;
  clientUserAgent: string | null;
}): Promise<void> {
  try {
    const intentId = args.intentId.trim();
    if (!intentId) return;
    const fbc = sanitizeMetaFbc(args.fbc);
    const fbp = sanitizeMetaFbp(args.fbp);
    const clientIp = sanitizeMetaClientIp(args.clientIp);
    const clientUserAgent = sanitizeMetaClientUserAgent(args.clientUserAgent);
    if (!fbc && !fbp && !clientIp && !clientUserAgent) return;
    const existing = await loadIntentById(intentId);
    if (!existing) return;
    const patch: Record<string, string> = {};
    if (!existing.meta_fbc && fbc) patch.meta_fbc = fbc;
    if (!existing.meta_fbp && fbp) patch.meta_fbp = fbp;
    if (!existing.client_ip && clientIp) patch.client_ip = clientIp;
    if (!existing.client_user_agent && clientUserAgent) {
      patch.client_user_agent = clientUserAgent;
    }
    if (Object.keys(patch).length === 0) return;
    patch.updated_at = nowIso();
    const { error } = await supabaseServer
      .from("checkout_browser_intents")
      .update(patch)
      .eq("id", intentId);
    if (error) logIntentError("save_match", error.code);
  } catch {
    console.warn("[stripe-first] checkout match save failed");
  }
}

export async function clearCheckoutMatchFields(intentId: string): Promise<void> {
  try {
    const id = intentId.trim();
    if (!id) return;
    const { error } = await supabaseServer
      .from("checkout_browser_intents")
      .update({
        meta_fbc: null,
        meta_fbp: null,
        client_ip: null,
        client_user_agent: null,
        updated_at: nowIso(),
      })
      .eq("id", id);
    if (error) logIntentError("clear_match", error.code);
  } catch {
    console.warn("[stripe-first] checkout match clear failed");
  }
}

/** Account deletion. Throws when the write fails so deletion does not complete. */
export async function clearCheckoutMatchFieldsForClerkUser(
  clerkUserId: string | null | undefined
): Promise<void> {
  const uid = typeof clerkUserId === "string" ? clerkUserId.trim() : "";
  if (!uid) return;
  const { error } = await supabaseServer
    .from("checkout_browser_intents")
    .update({
      meta_fbc: null,
      meta_fbp: null,
      client_ip: null,
      client_user_agent: null,
      updated_at: nowIso(),
    })
    .eq("clerk_user_id", uid);
  if (error) {
    logIntentError("clear_match_user", error.code);
    throw new Error("checkout_match_clear_failed");
  }
}

export function shouldClearCheckoutMatch(args: {
  nowMs: number;
  stripeSubscriptionId: string | null;
  bindingExpiresAt: string | null;
  clerkUserId: string | null;
  clerkCopyPresent: boolean;
  pendingInWindow: boolean;
  trialEndAt: string | null;
}): boolean {
  if (args.pendingInWindow) return false;
  const bindingMs = args.bindingExpiresAt ? Date.parse(args.bindingExpiresAt) : Number.NaN;
  if (!args.stripeSubscriptionId) {
    return Number.isFinite(bindingMs) && bindingMs <= args.nowMs;
  }
  if (args.clerkUserId && args.clerkCopyPresent) return true;
  const trialMs = args.trialEndAt ? Date.parse(args.trialEndAt) : Number.NaN;
  const windowEnd = Number.isFinite(trialMs)
    ? trialMs + CHECKOUT_MATCH_PAYMENT_WINDOW_MS
    : Number.isFinite(bindingMs)
      ? bindingMs + CHECKOUT_MATCH_PAYMENT_WINDOW_MS
      : args.nowMs + 1;
  return args.nowMs >= windowEnd;
}

function intentHasMatch(row: CheckoutBrowserIntent): boolean {
  return Boolean(row.meta_fbc || row.meta_fbp || row.client_ip || row.client_user_agent);
}

const MATCH_CLEANUP_COLUMNS =
  "id, stripe_subscription_id, binding_expires_at, clerk_user_id, stripe_trial_end_at, meta_fbc, meta_fbp, client_ip, client_user_agent";

const MATCH_PRESENT_FILTER =
  "meta_fbc.not.is.null,meta_fbp.not.is.null,client_ip.not.is.null,client_user_agent.not.is.null";

async function clearListedCheckoutMatches(
  rows: CheckoutBrowserIntent[],
  nowMs: number
): Promise<void> {
  const nowUnix = Math.floor(nowMs / 1000);
  for (const row of rows) {
    if (!row?.id || !intentHasMatch(row)) continue;
    const subscriptionId =
      typeof row.stripe_subscription_id === "string" ? row.stripe_subscription_id.trim() : "";
    let pendingInWindow = false;
    if (subscriptionId) {
      const pending = await listPendingMetaConversionsForSubscription(subscriptionId);
      pendingInWindow = pending.some((item) =>
        metaConversionEventWithinMaxAge(item.event_time, nowUnix)
      );
    }
    let clerkCopyPresent = false;
    const clerkUserId =
      typeof row.clerk_user_id === "string" && row.clerk_user_id.trim()
        ? row.clerk_user_id.trim()
        : null;
    if (clerkUserId) {
      const copied = await loadMetaCapiWebIdentifiersForUser(clerkUserId);
      clerkCopyPresent = Boolean(
        copied && (copied.fbc || copied.fbp || copied.clientIpAddress || copied.clientUserAgent)
      );
    }
    if (
      !shouldClearCheckoutMatch({
        nowMs,
        stripeSubscriptionId: subscriptionId || null,
        bindingExpiresAt: row.binding_expires_at ?? null,
        clerkUserId,
        clerkCopyPresent,
        pendingInWindow,
        trialEndAt: row.stripe_trial_end_at ?? null,
      })
    ) {
      continue;
    }
    await clearCheckoutMatchFields(row.id);
  }
}

/**
 * Hourly cleanup. Expired checkouts with no subscription are cleared on their
 * own bounded query so in-window trials cannot occupy every slot.
 * A subscription keeps match data while a conversion is still inside seven days,
 * or until the first payment window ends, unless the Clerk copy is already stored.
 */
export async function clearStaleCheckoutMatchFields(nowMs: number = Date.now()): Promise<void> {
  const now = new Date(nowMs).toISOString();
  try {
    const { data, error } = await supabaseServer
      .from("checkout_browser_intents")
      .select(MATCH_CLEANUP_COLUMNS)
      .is("stripe_subscription_id", null)
      .lt("binding_expires_at", now)
      .or(MATCH_PRESENT_FILTER)
      .limit(CHECKOUT_MATCH_CLEANUP_LIMIT);
    if (error) logIntentError("list_abandoned_match_cleanup", error.code);
    else if (data) await clearListedCheckoutMatches(data as CheckoutBrowserIntent[], nowMs);
  } catch {
    console.warn("[stripe-first] abandoned checkout match cleanup failed");
  }
  try {
    const { data, error } = await supabaseServer
      .from("checkout_browser_intents")
      .select(MATCH_CLEANUP_COLUMNS)
      .not("stripe_subscription_id", "is", null)
      .or(MATCH_PRESENT_FILTER)
      .limit(CHECKOUT_MATCH_CLEANUP_LIMIT);
    if (error) logIntentError("list_match_cleanup", error.code);
    else if (data) await clearListedCheckoutMatches(data as CheckoutBrowserIntent[], nowMs);
  } catch {
    console.warn("[stripe-first] checkout match cleanup failed");
  }
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

/** Extends completion to the Checkout Session lifetime. Does not rotate the binding secret. */
export async function alignBindingExpiry(args: {
  intentId: string;
  bindingExpiresAt: string;
}): Promise<void> {
  const { error } = await supabaseServer
    .from("checkout_browser_intents")
    .update({
      binding_expires_at: args.bindingExpiresAt,
      updated_at: nowIso(),
    })
    .eq("id", args.intentId)
    .is("session_started_at", null);
  if (error) logIntentError("binding_expiry", error.code);
}

export async function loadUnprovisionedPaidIntents(
  offset = 0
): Promise<CheckoutBrowserIntent[]> {
  const { data, error } = await supabaseServer
    .from("checkout_browser_intents")
    .select("*")
    .not("stripe_trial_confirmed_at", "is", null)
    .not("stripe_subscription_id", "is", null)
    .is("clerk_user_provisioned_at", null)
    .is("sign_in_required_at", null)
    .is("session_started_at", null)
    .order("stripe_trial_confirmed_at", { ascending: true })
    .range(offset, offset + 49);
  if (error) {
    logIntentError("load_stranded", error.code);
    throw new Error("intent_load_failed");
  }
  return (data as CheckoutBrowserIntent[] | null) ?? [];
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
