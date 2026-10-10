import "server-only";

import Stripe from "stripe";

import { countClerkUsers, getClerkUserOrNull, listClerkUsers, type ClerkUserResponse } from "@/lib/clerk-rest";
import {
  classifyCheckoutSession,
  isCheckoutSessionId,
  type CheckoutSessionView,
} from "@/lib/checkout-tracking";
import {
  censusCoverage,
  judgeCensusAccount,
  NONMEMBER_CENSUS_LIST_LIMIT,
  NONMEMBER_CENSUS_MAX_PAGES,
  NONMEMBER_CENSUS_PAGE_SIZE,
  NONMEMBER_CENSUS_SESSION_RETRIEVE_CAP,
  NONMEMBER_CENSUS_STRIPE_RETRIEVE_CAP,
  failedNonmemberCensus,
  tallyCensusAccounts,
  type CensusAccountInput,
  type CensusSessionEvidence,
  type CensusStripeEvidence,
  type NonmemberCensusData,
  type NonmemberCensusTally,
} from "@/lib/nonmember-census";
import { clerkStripeSubscriptionId } from "@/lib/admin-customers-dashboard-pure";
import { membershipFromAccountCheck } from "@/lib/recovery-engine";
import {
  classifySummittMembership,
  type SummittSubscriptionLike,
} from "@/lib/summitt-subscription-membership";
import {
  isAppleRowCurrentlyGranting,
  type AppleSubscriptionGrantRecord,
} from "@/lib/summitt-membership-entitlement";
import { supabaseServer } from "@/lib/supabase-server";

function hasEmailAddress(user: ClerkUserResponse): boolean {
  const list = user.email_addresses;
  if (!Array.isArray(list)) return false;
  return list.some(
    (entry) =>
      typeof entry?.email_address === "string" && entry.email_address.includes("@")
  );
}

function createdAtMs(user: ClerkUserResponse): number | null {
  return typeof user.created_at === "number" && Number.isFinite(user.created_at)
    ? user.created_at
    : null;
}

async function loadAppleGrants(
  userIds: readonly string[],
  now: Date
): Promise<{ byUser: Map<string, boolean>; complete: boolean }> {
  const byUser = new Map<string, boolean>();
  for (const id of userIds) byUser.set(id, false);
  try {
    for (let i = 0; i < userIds.length; i += 50) {
      const chunk = userIds.slice(i, i + 50);
      const { data, error } = await supabaseServer
        .from("apple_subscriptions")
        .select("clerk_user_id, product_id, status, expires_at")
        .in("clerk_user_id", [...chunk]);
      if (error) {
        console.warn("[nonmember-census] apple read failed", error.message);
        return { byUser, complete: false };
      }
      for (const row of data ?? []) {
        const clerkId = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
        if (!clerkId || !byUser.has(clerkId)) continue;
        const record: AppleSubscriptionGrantRecord = {
          product_id: typeof row.product_id === "string" ? row.product_id : "",
          status: typeof row.status === "string" ? row.status : "",
          expires_at: (row.expires_at as string | null) ?? null,
        };
        if (isAppleRowCurrentlyGranting(record, now)) byUser.set(clerkId, true);
      }
    }
    return { byUser, complete: true };
  } catch (err) {
    console.warn("[nonmember-census] apple read threw", {
      reason: err instanceof Error ? err.message : "apple_read_failed",
    });
    return { byUser, complete: false };
  }
}

async function retrieveStripeClasses(
  ids: readonly string[]
): Promise<Map<string, CensusStripeEvidence>> {
  const result = new Map<string, CensusStripeEvidence>();
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    for (const id of ids) result.set(id, "lookup_failed");
    return result;
  }
  const stripe = new Stripe(key);
  const capped = ids.slice(0, NONMEMBER_CENSUS_STRIPE_RETRIEVE_CAP);
  for (const id of ids.slice(NONMEMBER_CENSUS_STRIPE_RETRIEVE_CAP)) {
    result.set(id, "not_retrieved");
  }
  for (let i = 0; i < capped.length; i += 10) {
    const chunk = capped.slice(i, i + 10);
    const retrieved = await Promise.all(
      chunk.map(async (id) => {
        try {
          const sub = await stripe.subscriptions.retrieve(id);
          return [id, classifySummittMembership(sub as SummittSubscriptionLike)] as const;
        } catch (err) {
          console.warn("[nonmember-census] stripe retrieve failed", {
            reason: err instanceof Error ? err.message : "stripe_retrieve_failed",
          });
          return [id, "lookup_failed"] as const;
        }
      })
    );
    for (const [id, value] of retrieved) result.set(id, value);
  }
  return result;
}

type CheckoutEvent = {
  clerkUserId: string;
  eventType: string;
  sessionId: string | null;
  occurredAt: number;
};

async function loadCheckoutEvents(
  userIds: readonly string[]
): Promise<{ events: CheckoutEvent[]; complete: boolean }> {
  const events: CheckoutEvent[] = [];
  if (userIds.length === 0) return { events, complete: true };
  let from = 0;
  const pageSize = 200;
  try {
    for (let page = 0; page < 5; page += 1) {
      const { data, error } = await supabaseServer
        .from("marketing_events")
        .select("clerk_user_id, event_type, metadata, occurred_at")
        .in("event_type", ["checkout_opened", "checkout_creation_failed"])
        .in("clerk_user_id", [...userIds])
        .order("occurred_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) {
        console.warn("[nonmember-census] checkout events failed", error.message);
        return { events, complete: false };
      }
      const batch = data ?? [];
      for (const row of batch) {
        const clerkUserId = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
        const eventType = typeof row.event_type === "string" ? row.event_type : "";
        const occurredAt = Date.parse(String(row.occurred_at ?? ""));
        const metadata = row.metadata as { checkout_session_id?: unknown } | null;
        const rawId = metadata?.checkout_session_id;
        const sessionId =
          typeof rawId === "string" && isCheckoutSessionId(rawId) ? rawId : null;
        if (!clerkUserId || !eventType) continue;
        events.push({
          clerkUserId,
          eventType,
          sessionId,
          occurredAt: Number.isFinite(occurredAt) ? occurredAt : 0,
        });
      }
      if (batch.length < pageSize) return { events, complete: true };
      from += pageSize;
    }
    return { events, complete: false };
  } catch (err) {
    console.warn("[nonmember-census] checkout events threw", {
      reason: err instanceof Error ? err.message : "checkout_events_failed",
    });
    return { events, complete: false };
  }
}

function sessionEvidence(
  session: Stripe.Checkout.Session,
  nowMs: number
): CensusSessionEvidence | null {
  const subscription = session.subscription;
  let subscriptionClass: CensusSessionEvidence["subscription"] = "none";
  let trialStart: number | null = null;
  if (typeof subscription === "string") {
    subscriptionClass = "unreadable";
  } else if (subscription && typeof subscription === "object") {
    subscriptionClass = classifySummittMembership(subscription as SummittSubscriptionLike);
    const trial = subscription.trial_start;
    trialStart = typeof trial === "number" && Number.isFinite(trial) ? trial : null;
  }
  const view: CheckoutSessionView = {
    id: session.id,
    created: session.created,
    status: session.status,
    metadata: session.metadata,
    subscriptionTrialStart: trialStart,
  };
  const outcome = classifyCheckoutSession(view, nowMs);
  if (!outcome) return null;
  return { outcome, subscription: subscriptionClass };
}

async function retrieveSessions(
  ids: readonly string[],
  nowMs: number
): Promise<Map<string, CensusSessionEvidence | "unreadable">> {
  const result = new Map<string, CensusSessionEvidence | "unreadable">();
  const key = process.env.STRIPE_SECRET_KEY;
  const capped = ids.slice(0, NONMEMBER_CENSUS_SESSION_RETRIEVE_CAP);
  if (!key) {
    for (const id of capped) result.set(id, "unreadable");
    return result;
  }
  const stripe = new Stripe(key);
  for (let i = 0; i < capped.length; i += 10) {
    const chunk = capped.slice(i, i + 10);
    const retrieved = await Promise.all(
      chunk.map(async (id) => {
        try {
          const session = await stripe.checkout.sessions.retrieve(id, {
            expand: ["subscription"],
          });
          return [id, sessionEvidence(session, nowMs) ?? "unreadable"] as const;
        } catch (err) {
          console.warn("[nonmember-census] session retrieve failed", {
            reason: err instanceof Error ? err.message : "session_retrieve_failed",
          });
          return [id, "unreadable"] as const;
        }
      })
    );
    for (const [id, value] of retrieved) result.set(id, value);
  }
  return result;
}

function accountInput(args: {
  user: ClerkUserResponse;
  appleComplete: boolean;
  appleGrants: boolean;
  stripeById: Map<string, CensusStripeEvidence>;
  events: CheckoutEvent[];
  eventsComplete: boolean;
  sessions: Map<string, CensusSessionEvidence | "unreadable">;
}): CensusAccountInput {
  const subscriptionId = clerkStripeSubscriptionId(
    (args.user.public_metadata || {}) as Record<string, unknown>
  );
  let stripe: CensusStripeEvidence = "no_subscription_id";
  if (subscriptionId) {
    stripe = args.stripeById.get(subscriptionId) ?? "lookup_failed";
  }
  const mine = args.events
    .filter((event) => event.clerkUserId === args.user.id)
    .sort((a, b) => b.occurredAt - a.occurredAt);
  const sessionIds = mine
    .filter((event) => event.eventType === "checkout_opened" && event.sessionId)
    .map((event) => event.sessionId as string);
  const uniqueSessionIds = [...new Set(sessionIds)];
  const sessions: CensusSessionEvidence[] = [];
  let unreadSessionIds = 0;
  for (const id of uniqueSessionIds) {
    const evidence = args.sessions.get(id);
    if (!evidence || evidence === "unreadable") {
      unreadSessionIds += 1;
      continue;
    }
    sessions.push(evidence);
  }
  return {
    createdAtMs: createdAtMs(args.user),
    hasEmail: hasEmailAddress(args.user),
    apple: args.appleComplete ? (args.appleGrants ? "grant" : "no_grant") : "unreadable",
    stripe,
    sessions,
    unreadSessionIds,
    creationFailed: mine.some((event) => event.eventType === "checkout_creation_failed"),
    eventsComplete: args.eventsComplete,
  };
}

export async function loadOneAccountMembership(
  clerkUserId: string,
  now: Date
): Promise<"verified_nonmember" | "member" | "former" | "unknown" | "unavailable" | "missing"> {
  const id = clerkUserId.trim();
  if (!id) return "missing";
  let user: ClerkUserResponse | null;
  try {
    user = await getClerkUserOrNull(id);
  } catch {
    return "unavailable";
  }
  if (!user) return "missing";
  const apple = await loadAppleGrants([id], now);
  const subscriptionId = clerkStripeSubscriptionId(
    (user.public_metadata || {}) as Record<string, unknown>
  );
  const stripeById = subscriptionId
    ? await retrieveStripeClasses([subscriptionId])
    : new Map<string, CensusStripeEvidence>();
  const stripeValue = subscriptionId ? stripeById.get(subscriptionId) : "no_subscription_id";
  const stripeReadable = stripeValue !== "lookup_failed" && stripeValue !== "not_retrieved" && stripeValue != null;
  const checkout = await loadCheckoutEvents([id]);
  const sessionIds = [...new Set(
    checkout.events
      .filter((event) => event.eventType === "checkout_opened" && event.sessionId)
      .map((event) => event.sessionId as string)
  )];
  const sessions = await retrieveSessions(sessionIds, now.getTime());
  const sessionsReadable = sessionIds.every((sessionId) => {
    const evidence = sessions.get(sessionId);
    return Boolean(evidence) && evidence !== "unreadable";
  });
  const readable = apple.complete && stripeReadable && checkout.complete && sessionsReadable;
  const judged = readable
    ? eligibilityFor(judgeCensusAccount(accountInput({
      user,
      appleComplete: apple.complete,
      appleGrants: apple.byUser.get(id) === true,
      stripeById,
      events: checkout.events,
      eventsComplete: checkout.complete,
      sessions,
    })))
    : null;
  return membershipFromAccountCheck({
    clerk: "found",
    appleReadable: apple.complete,
    stripeReadable,
    checkoutReadable: checkout.complete,
    sessionsReadable,
    judged,
  });
}

export async function loadNonmemberCensus(now = new Date()): Promise<NonmemberCensusData> {
  let clerkTotal: number | null = null;
  try {
    clerkTotal = await countClerkUsers();
  } catch (err) {
    console.warn("[nonmember-census] clerk count failed", {
      reason: err instanceof Error ? err.message : "clerk_count_failed",
    });
  }

  const users: ClerkUserResponse[] = [];
  const pageLengths: number[] = [];
  try {
    for (let page = 0; page < NONMEMBER_CENSUS_MAX_PAGES; page += 1) {
      const batch = await listClerkUsers({
        limit: NONMEMBER_CENSUS_PAGE_SIZE,
        offset: page * NONMEMBER_CENSUS_PAGE_SIZE,
        orderBy: "-created_at",
      });
      pageLengths.push(batch.length);
      users.push(...batch);
      if (batch.length < NONMEMBER_CENSUS_PAGE_SIZE) break;
    }
  } catch (err) {
    console.warn("[nonmember-census] clerk list failed", {
      reason: err instanceof Error ? err.message : "clerk_list_failed",
    });
    return { ...failedNonmemberCensus(), clerkTotal };
  }

  const coverage = censusCoverage({
    pageLengths,
    pageSize: NONMEMBER_CENSUS_PAGE_SIZE,
    maxPages: NONMEMBER_CENSUS_MAX_PAGES,
    clerkTotal,
  });
  const userIds = users.map((user) => user.id).filter((id) => id.trim().length > 0);
  const apple = await loadAppleGrants(userIds, now);
  const stripeIds: string[] = [];
  const seenStripe = new Set<string>();
  for (const user of users) {
    const id = clerkStripeSubscriptionId(
      (user.public_metadata || {}) as Record<string, unknown>
    );
    if (!id || seenStripe.has(id)) continue;
    seenStripe.add(id);
    stripeIds.push(id);
  }
  const stripeById = await retrieveStripeClasses(stripeIds);
  const checkout = await loadCheckoutEvents(userIds);
  const sessionIds: string[] = [];
  const seenSessions = new Set<string>();
  for (const event of checkout.events) {
    if (!event.sessionId || seenSessions.has(event.sessionId)) continue;
    seenSessions.add(event.sessionId);
    sessionIds.push(event.sessionId);
  }
  const sessions = await retrieveSessions(sessionIds, now.getTime());

  const judged = users.map((user) => {
    const input = accountInput({
      user,
      appleComplete: apple.complete,
      appleGrants: apple.byUser.get(user.id) === true,
      stripeById,
      events: checkout.events,
      eventsComplete: checkout.complete,
      sessions,
    });
    return { user, input, judgment: judgeCensusAccount(input) };
  });
  const tally: NonmemberCensusTally = tallyCensusAccounts(
    judged.map((row) => ({ hasEmail: row.input.hasEmail, judgment: row.judgment }))
  );
  const rows = judged
    .filter((row) => row.judgment.kind === "nonmember")
    .slice(0, NONMEMBER_CENSUS_LIST_LIMIT)
    .map((row) => ({
      clerkUserId: row.user.id,
      createdAtMs: row.input.createdAtMs,
      category: row.judgment.kind === "nonmember" ? row.judgment.category : "unknown",
    }));
  const eligibility: Record<string, "verified_nonmember" | "former" | "member" | "unknown"> = {};
  for (const row of judged) {
    eligibility[row.user.id] = eligibilityFor(row.judgment);
  }

  return {
    coverage: coverage.coverage,
    examined: coverage.examined,
    clerkTotal,
    members: tally.members,
    nonmembers: tally.nonmembers,
    unknownEntitlement: tally.unknownEntitlement,
    unverifiedTrial: tally.unverifiedTrial,
    withEmail: tally.withEmail,
    categories: tally.categories,
    rows,
    eligibility,
  };
}

function eligibilityFor(
  judgment: { kind: "member" } | { kind: "unknown"; reason: string } | { kind: "nonmember"; category: string }
): "verified_nonmember" | "former" | "member" | "unknown" {
  if (judgment.kind === "member") return "member";
  if (judgment.kind !== "nonmember") return "unknown";
  if (judgment.category === "previously_subscribed") return "former";
  if (judgment.category === "unknown" || judgment.category === "insufficient_history") return "unknown";
  return "verified_nonmember";
}
