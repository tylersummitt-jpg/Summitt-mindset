import "server-only";

import Stripe from "stripe";

import { clerkStripeSubscriptionId } from "@/lib/admin-customers-dashboard-pure";
import {
  classifyCheckoutSession,
  isCheckoutSessionId,
  type CheckoutSessionView,
} from "@/lib/checkout-tracking";
import { countClerkUsers, listClerkUsers, type ClerkUserResponse } from "@/lib/clerk-rest";
import {
  assertCompleteClerkList,
  buildClerkAccountExportCsv,
  classifyCensusJudgment,
  countExportRow,
  emptyExportCounts,
  isExcludedTestAccount,
  type ClerkExportCounts,
  type ClerkExportRow,
} from "@/lib/clerk-account-export";
import {
  judgeCensusAccount,
  type CensusAccountInput,
  type CensusSessionEvidence,
  type CensusStripeEvidence,
} from "@/lib/nonmember-census";
import {
  isAppleRowCurrentlyGranting,
  type AppleSubscriptionGrantRecord,
} from "@/lib/summitt-membership-entitlement";
import {
  classifySummittMembership,
  type SummittSubscriptionLike,
} from "@/lib/summitt-subscription-membership";
import { supabaseServer } from "@/lib/supabase-server";

const PAGE_SIZE = 100;

export class IncompleteClerkExportError extends Error {
  constructor() {
    super("incomplete_clerk_list");
    this.name = "IncompleteClerkExportError";
  }
}

type CheckoutEvent = {
  clerkUserId: string;
  eventType: string;
  sessionId: string | null;
  occurredAt: number;
};

function metadataText(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function primaryEmail(user: ClerkUserResponse): string {
  const list = user.email_addresses ?? [];
  const primary = list.find((entry) => entry.id === user.primary_email_address_id);
  const chosen = primary ?? list.find((entry) => entry.email_address?.includes("@"));
  return chosen?.email_address?.trim() ?? "";
}

function displayName(user: ClerkUserResponse): string {
  return [user.first_name, user.last_name]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");
}

function createdAtIso(user: ClerkUserResponse): string {
  return typeof user.created_at === "number" && Number.isFinite(user.created_at)
    ? new Date(user.created_at).toISOString()
    : "";
}

async function listEveryClerkUser(): Promise<ClerkUserResponse[]> {
  let clerkTotal: number;
  try {
    clerkTotal = await countClerkUsers();
  } catch {
    throw new IncompleteClerkExportError();
  }
  const users: ClerkUserResponse[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset <= clerkTotal; offset += PAGE_SIZE) {
    let batch: ClerkUserResponse[];
    try {
      batch = await listClerkUsers({
        limit: PAGE_SIZE,
        offset,
        orderBy: "-created_at",
      });
    } catch {
      throw new IncompleteClerkExportError();
    }
    for (const user of batch) {
      if (!user.id || seen.has(user.id)) continue;
      seen.add(user.id);
      users.push(user);
    }
    if (batch.length < PAGE_SIZE) break;
  }
  try {
    assertCompleteClerkList(users.length, clerkTotal);
  } catch {
    throw new IncompleteClerkExportError();
  }
  return users;
}

async function loadAppleGrants(userIds: readonly string[]): Promise<Map<string, "grant" | "no_grant" | "unreadable">> {
  const result = new Map<string, "grant" | "no_grant" | "unreadable">();
  for (const id of userIds) result.set(id, "no_grant");
  const now = new Date();
  try {
    for (let i = 0; i < userIds.length; i += 50) {
      const chunk = userIds.slice(i, i + 50);
      const { data, error } = await supabaseServer
        .from("apple_subscriptions")
        .select("clerk_user_id, product_id, status, expires_at")
        .in("clerk_user_id", [...chunk]);
      if (error) {
        for (const id of chunk) result.set(id, "unreadable");
        continue;
      }
      for (const row of data ?? []) {
        const clerkId = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
        if (!result.has(clerkId) || result.get(clerkId) === "unreadable") continue;
        const record: AppleSubscriptionGrantRecord = {
          product_id: typeof row.product_id === "string" ? row.product_id : "",
          status: typeof row.status === "string" ? row.status : "",
          expires_at: (row.expires_at as string | null) ?? null,
        };
        if (isAppleRowCurrentlyGranting(record, now)) result.set(clerkId, "grant");
      }
    }
  } catch {
    for (const id of userIds) result.set(id, "unreadable");
  }
  return result;
}

async function loadCheckoutEvents(userIds: readonly string[]): Promise<{
  events: CheckoutEvent[];
  completeUserIds: Set<string>;
}> {
  const events: CheckoutEvent[] = [];
  const completeUserIds = new Set<string>();
  for (let i = 0; i < userIds.length; i += 80) {
    const chunk = userIds.slice(i, i + 80);
    let from = 0;
    let complete = true;
    try {
      for (let page = 0; page < 25; page += 1) {
        const { data, error } = await supabaseServer
          .from("marketing_events")
          .select("clerk_user_id, event_type, metadata, occurred_at")
          .in("event_type", ["checkout_opened", "checkout_creation_failed"])
          .in("clerk_user_id", [...chunk])
          .order("occurred_at", { ascending: false })
          .range(from, from + 199);
        if (error) {
          complete = false;
          break;
        }
        const batch = data ?? [];
        for (const row of batch) {
          const clerkUserId = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
          const eventType = typeof row.event_type === "string" ? row.event_type : "";
          const occurredAt = Date.parse(String(row.occurred_at ?? ""));
          const metadata = row.metadata as { checkout_session_id?: unknown } | null;
          const rawId = metadata?.checkout_session_id;
          const sessionId = typeof rawId === "string" && isCheckoutSessionId(rawId) ? rawId : null;
          if (!clerkUserId || !eventType) continue;
          events.push({
            clerkUserId,
            eventType,
            sessionId,
            occurredAt: Number.isFinite(occurredAt) ? occurredAt : 0,
          });
        }
        if (batch.length < 200) {
          complete = true;
          break;
        }
        from += 200;
        if (page === 24) complete = false;
      }
    } catch {
      complete = false;
    }
    if (complete) {
      for (const id of chunk) completeUserIds.add(id);
    }
  }
  return { events, completeUserIds };
}

async function retrieveStripeClasses(ids: readonly string[]): Promise<Map<string, CensusStripeEvidence>> {
  const result = new Map<string, CensusStripeEvidence>();
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    for (const id of ids) result.set(id, "lookup_failed");
    return result;
  }
  const stripe = new Stripe(key);
  for (let i = 0; i < ids.length; i += 8) {
    const chunk = ids.slice(i, i + 8);
    const retrieved = await Promise.all(
      chunk.map(async (id) => {
        try {
          const sub = await stripe.subscriptions.retrieve(id);
          return [id, classifySummittMembership(sub as SummittSubscriptionLike)] as const;
        } catch {
          return [id, "lookup_failed"] as const;
        }
      })
    );
    for (const [id, value] of retrieved) result.set(id, value);
  }
  return result;
}

function sessionEvidence(session: Stripe.Checkout.Session, nowMs: number): CensusSessionEvidence | "unreadable" {
  const subscription = session.subscription;
  let subscriptionClass: CensusSessionEvidence["subscription"] = "none";
  let trialStart: number | null = null;
  if (typeof subscription === "string") subscriptionClass = "unreadable";
  else if (subscription && typeof subscription === "object") {
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
  if (!outcome) return "unreadable";
  return { outcome, subscription: subscriptionClass };
}

async function retrieveSessions(
  ids: readonly string[],
  nowMs: number
): Promise<Map<string, CensusSessionEvidence | "unreadable">> {
  const result = new Map<string, CensusSessionEvidence | "unreadable">();
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    for (const id of ids) result.set(id, "unreadable");
    return result;
  }
  const stripe = new Stripe(key);
  for (let i = 0; i < ids.length; i += 8) {
    const chunk = ids.slice(i, i + 8);
    const retrieved = await Promise.all(
      chunk.map(async (id) => {
        try {
          const session = await stripe.checkout.sessions.retrieve(id, { expand: ["subscription"] });
          return [id, sessionEvidence(session, nowMs)] as const;
        } catch {
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
  apple: "grant" | "no_grant" | "unreadable";
  stripeById: Map<string, CensusStripeEvidence>;
  events: CheckoutEvent[];
  eventsComplete: boolean;
  sessions: Map<string, CensusSessionEvidence | "unreadable">;
}): CensusAccountInput {
  const publicMetadata = (args.user.public_metadata || {}) as Record<string, unknown>;
  const subscriptionId = clerkStripeSubscriptionId(publicMetadata);
  let stripe: CensusStripeEvidence = "no_subscription_id";
  if (subscriptionId) stripe = args.stripeById.get(subscriptionId) ?? "lookup_failed";
  const mine = args.events
    .filter((event) => event.clerkUserId === args.user.id)
    .sort((a, b) => b.occurredAt - a.occurredAt);
  const sessionIds = [
    ...new Set(
      mine
        .filter((event) => event.eventType === "checkout_opened" && event.sessionId)
        .map((event) => event.sessionId as string)
    ),
  ];
  const sessions: CensusSessionEvidence[] = [];
  let unreadSessionIds = 0;
  for (const id of sessionIds) {
    const evidence = args.sessions.get(id);
    if (!evidence || evidence === "unreadable") {
      unreadSessionIds += 1;
      continue;
    }
    sessions.push(evidence);
  }
  return {
    createdAtMs: typeof args.user.created_at === "number" ? args.user.created_at : null,
    hasEmail: primaryEmail(args.user).includes("@"),
    apple: args.apple,
    stripe,
    sessions,
    unreadSessionIds,
    creationFailed: mine.some((event) => event.eventType === "checkout_creation_failed"),
    eventsComplete: args.eventsComplete,
    stripeFirstProvisioning: publicMetadata.stripeFirstReservedEmail === true,
  };
}

export async function loadClerkCensusRows(now = new Date()): Promise<{
  rows: ClerkExportRow[];
  counts: ClerkExportCounts;
}> {
  const users = await listEveryClerkUser();
  const userIds = users.map((user) => user.id);
  const apple = await loadAppleGrants(userIds);
  const checkout = await loadCheckoutEvents(userIds);
  const stripeIds: string[] = [];
  const seenStripe = new Set<string>();
  for (const user of users) {
    const id = clerkStripeSubscriptionId((user.public_metadata || {}) as Record<string, unknown>);
    if (!id || seenStripe.has(id)) continue;
    seenStripe.add(id);
    stripeIds.push(id);
  }
  const stripeById = await retrieveStripeClasses(stripeIds);
  const sessionIds = [
    ...new Set(checkout.events.flatMap((event) => (event.sessionId ? [event.sessionId] : []))),
  ];
  const sessions = await retrieveSessions(sessionIds, now.getTime());
  const counts = emptyExportCounts();
  counts.examined = users.length;
  const rows: ClerkExportRow[] = [];
  for (const user of users) {
    const email = primaryEmail(user);
    if (isExcludedTestAccount(email)) {
      counts.excludedTest += 1;
      continue;
    }
    const metadata = (user.public_metadata || {}) as Record<string, unknown>;
    const classified = classifyCensusJudgment(
      judgeCensusAccount(
        accountInput({
          user,
          apple: apple.get(user.id) ?? "unreadable",
          stripeById,
          events: checkout.events,
          eventsComplete: checkout.completeUserIds.has(user.id),
          sessions,
        })
      )
    );
    countExportRow(counts, classified.classification);
    rows.push({
      name: displayName(user),
      email,
      createdAt: createdAtIso(user),
      clerkId: user.id,
      summittSubscribed: metadataText(metadata.summittSubscribed),
      summittPlan: metadataText(metadata.summittPlan),
      stripeSubscriptionId: metadataText(metadata.stripeSubscriptionId),
      stripeCustomerId: metadataText(metadata.stripeCustomerId),
      classification: classified.classification,
      reason: classified.reason,
    });
  }
  return { rows, counts };
}

export async function buildClerkAccountExport(now = new Date()): Promise<{
  csv: string;
  counts: ClerkExportCounts;
}> {
  const census = await loadClerkCensusRows(now);
  return { csv: buildClerkAccountExportCsv(census.counts, census.rows), counts: census.counts };
}
