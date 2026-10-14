import "server-only";

import Stripe from "stripe";

import { loadClerkCensusRows } from "@/lib/clerk-account-export.server";
import { IncompleteClerkExportError } from "@/lib/clerk-account-export.server";
import type { ClerkExportRow } from "@/lib/clerk-account-export";
import {
  buildHistoricalNeverSubscriberCsv,
  classifyHistoricalAccount,
  countHistoricalDecision,
  emptyHistoricalCounts,
  findingFromAppleRows,
  findingFromSubscription,
  isHistoricalInternalAccount,
  mergeStripeFindings,
  resolveCustomerIdentity,
  type CustomerIdentityView,
  type HistoricalAppleFinding,
  type HistoricalCsvCounts,
  type HistoricalStripeFinding,
  type HistoricalSubscriptionView,
} from "@/lib/historical-never-subscriber";
import { getRecognizedSummittPriceIds } from "@/lib/stripe-recognized-price-ids";
import { supabaseServer } from "@/lib/supabase-server";

const LIST_PAGE = 100;
const MAX_PAGES = 10;
const CONCURRENCY = 4;

export class IncompleteHistoricalCohortError extends Error {
  constructor() {
    super("incomplete_clerk_list");
    this.name = "IncompleteHistoricalCohortError";
  }
}

type AppleRow = {
  environment: string;
  productId: string;
  status: string;
  expiresAt: string | null;
};

function metadataUserId(metadata: Stripe.Metadata | null | undefined): string | null {
  const value = metadata?.userId;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function customerView(customer: Stripe.Customer | Stripe.DeletedCustomer): CustomerIdentityView | null {
  if ("deleted" in customer && customer.deleted) return null;
  return { id: customer.id, userId: metadataUserId(customer.metadata) };
}

function subscriptionView(sub: Stripe.Subscription, clerkUserId: string, recognized: Set<string>): HistoricalSubscriptionView {
  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  return {
    status: sub.status,
    paused: sub.pause_collection != null,
    priceRecognized: typeof priceId === "string" && recognized.has(priceId),
    priceId: typeof priceId === "string" ? priceId : null,
    ownedByClerkUser: metadataUserId(sub.metadata) === clerkUserId,
    trialStart: typeof sub.trial_start === "number" ? sub.trial_start : null,
  };
}

async function listPages<T extends { id: string }>(
  read: (startingAfter: string | undefined) => Promise<{ data: T[]; has_more: boolean }>
): Promise<{ complete: boolean; data: T[] }> {
  const data: T[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let listed: { data: T[]; has_more: boolean };
    try {
      listed = await read(startingAfter);
    } catch {
      return { complete: false, data };
    }
    data.push(...listed.data);
    if (!listed.has_more) return { complete: true, data };
    const lastId = listed.data[listed.data.length - 1]?.id;
    if (!lastId) return { complete: false, data };
    startingAfter = lastId;
  }
  return { complete: false, data };
}

async function loadAppleHistory(userIds: readonly string[], now: Date): Promise<Map<string, HistoricalAppleFinding>> {
  const grouped = new Map<string, AppleRow[]>();
  const unreadable = new Set<string>();
  for (const id of userIds) grouped.set(id, []);
  try {
    for (let i = 0; i < userIds.length; i += 50) {
      const chunk = userIds.slice(i, i + 50);
      const { data, error } = await supabaseServer
        .from("apple_subscriptions")
        .select("clerk_user_id, product_id, status, environment, expires_at")
        .in("clerk_user_id", [...chunk]);
      if (error) {
        for (const id of chunk) unreadable.add(id);
        continue;
      }
      for (const row of data ?? []) {
        const clerkId = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
        if (!grouped.has(clerkId) || unreadable.has(clerkId)) continue;
        grouped.get(clerkId)?.push({
          environment: typeof row.environment === "string" ? row.environment : "",
          productId: typeof row.product_id === "string" ? row.product_id : "",
          status: typeof row.status === "string" ? row.status : "",
          expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
        });
      }
    }
  } catch {
    for (const id of userIds) unreadable.add(id);
  }
  const result = new Map<string, HistoricalAppleFinding>();
  for (const id of userIds) {
    result.set(id, unreadable.has(id) ? "unreadable" : findingFromAppleRows(grouped.get(id) ?? [], now));
  }
  return result;
}

async function searchCustomersByUserId(
  stripe: Stripe,
  clerkUserId: string
): Promise<{ complete: boolean; data: Stripe.Customer[] }> {
  const data: Stripe.Customer[] = [];
  let page: string | undefined;
  for (let attempt = 0; attempt < MAX_PAGES; attempt += 1) {
    try {
      const found = await stripe.customers.search({
        query: `metadata['userId']:'${clerkUserId}'`,
        limit: LIST_PAGE,
        page,
      });
      data.push(...found.data);
      if (!found.next_page) return { complete: true, data };
      page = found.next_page;
    } catch {
      return { complete: false, data };
    }
  }
  return { complete: false, data };
}

async function resolveLiveCustomer(
  stripe: Stripe,
  row: ClerkExportRow
): Promise<{ identity: ReturnType<typeof resolveCustomerIdentity>["identity"]; customerIds: string[]; stripeCustomerFound: boolean }> {
  if (!row.email.includes("@")) {
    return { identity: "lookup_failed", customerIds: [], stripeCustomerFound: false };
  }
  const emailCustomers = await listPages((startingAfter) =>
    stripe.customers.list({ email: row.email, limit: LIST_PAGE, starting_after: startingAfter })
  );
  if (emailCustomers.data.some((customer) => "deleted" in customer && customer.deleted)) {
    return { identity: "unresolved", customerIds: [], stripeCustomerFound: true };
  }
  const userIdCustomers = await searchCustomersByUserId(stripe, row.clerkId);

  let storedCustomer: CustomerIdentityView | null = null;
  let storedLookupFailed = false;
  const storedId = row.stripeCustomerId.trim();
  const alreadySeen = new Set(
    [...emailCustomers.data, ...userIdCustomers.data].map((customer) => customer.id)
  );
  if (storedId && !alreadySeen.has(storedId)) {
    try {
      const retrieved = customerView(await stripe.customers.retrieve(storedId));
      storedCustomer = retrieved;
      if (!retrieved) storedLookupFailed = true;
    } catch {
      storedLookupFailed = true;
    }
  }

  return resolveCustomerIdentity({
    clerkUserId: row.clerkId,
    storedCustomerId: storedId,
    emailCustomers: emailCustomers.data.flatMap((customer) => {
      const view = customerView(customer);
      return view ? [view] : [];
    }),
    emailListComplete: emailCustomers.complete,
    userIdCustomers: userIdCustomers.data.flatMap((customer) => {
      const view = customerView(customer);
      return view ? [view] : [];
    }),
    userIdSearchComplete: userIdCustomers.complete,
    storedCustomer,
    storedLookupFailed,
  });
}

async function stripeFindingForAccount(
  stripe: Stripe,
  row: ClerkExportRow,
  customerIds: readonly string[],
  recognized: Set<string>
): Promise<{ finding: HistoricalStripeFinding; subscriptionListComplete: boolean; sessionListComplete: boolean }> {
  const findings: HistoricalStripeFinding[] = [];
  const seen = new Set<string>();
  let subscriptionListComplete = true;
  let sessionListComplete = true;

  const consider = (sub: Stripe.Subscription) => {
    if (!sub.id || seen.has(sub.id)) return;
    seen.add(sub.id);
    findings.push(findingFromSubscription(subscriptionView(sub, row.clerkId, recognized)));
  };

  if (row.stripeSubscriptionId.trim()) {
    try {
      consider(await stripe.subscriptions.retrieve(row.stripeSubscriptionId.trim()));
    } catch {
      findings.push("unreadable");
    }
  }

  for (const customerId of customerIds) {
    const listed = await listPages((startingAfter) =>
      stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: LIST_PAGE,
        starting_after: startingAfter,
      })
    );
    if (!listed.complete) subscriptionListComplete = false;
    for (const sub of listed.data) consider(sub);

    const sessions = await listPages((startingAfter) =>
      stripe.checkout.sessions.list({
        customer: customerId,
        limit: LIST_PAGE,
        starting_after: startingAfter,
      })
    );
    if (!sessions.complete) sessionListComplete = false;
    for (const session of sessions.data) {
      if (session.status !== "complete") continue;
      const subscription = session.subscription;
      const subscriptionId = typeof subscription === "string" ? subscription : subscription?.id;
      if (!subscriptionId || seen.has(subscriptionId)) continue;
      try {
        consider(await stripe.subscriptions.retrieve(subscriptionId));
      } catch {
        findings.push("unreadable");
      }
    }
  }

  return {
    finding: mergeStripeFindings(findings),
    subscriptionListComplete,
    sessionListComplete,
  };
}

function metadataClaimsMembership(row: ClerkExportRow): boolean {
  return row.summittSubscribed === "true" || row.stripeSubscriptionId.trim().length > 0 || row.summittPlan.trim().length > 0;
}

async function reconcileRow(
  stripe: Stripe,
  row: ClerkExportRow,
  apple: HistoricalAppleFinding,
  recognized: Set<string>
) {
  const createdAtMs = Date.parse(row.createdAt);
  if (isHistoricalInternalAccount(row.email)) {
    return classifyHistoricalAccount({
      email: row.email,
      createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
      metadataClaimsMembership: false,
      identity: row.stripeCustomerId.trim() ? "resolved_customer" : "no_customer",
      stripeCustomerFound: row.stripeCustomerId.trim().length > 0,
      subscriptionListComplete: true,
      sessionListComplete: true,
      stripeFinding: "none",
      apple: "none",
    });
  }

  let identity: Awaited<ReturnType<typeof resolveLiveCustomer>>;
  try {
    identity = await resolveLiveCustomer(stripe, row);
  } catch {
    identity = { identity: "lookup_failed", customerIds: [], stripeCustomerFound: false };
  }

  const lists = await stripeFindingForAccount(
    stripe,
    row,
    identity.identity === "resolved_customer" ? identity.customerIds : [],
    recognized
  );
  if (identity.identity === "lookup_failed") {
    lists.subscriptionListComplete = false;
    lists.sessionListComplete = false;
  }

  return classifyHistoricalAccount({
    email: row.email,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
    metadataClaimsMembership: metadataClaimsMembership(row),
    identity: identity.identity,
    stripeCustomerFound: identity.stripeCustomerFound,
    subscriptionListComplete: lists.subscriptionListComplete,
    sessionListComplete: lists.sessionListComplete,
    stripeFinding: lists.finding,
    apple,
  });
}

export async function buildHistoricalNeverSubscriberCsvExport(now = new Date()): Promise<{
  csv: string;
  counts: HistoricalCsvCounts;
}> {
  let census: Awaited<ReturnType<typeof loadClerkCensusRows>>;
  try {
    census = await loadClerkCensusRows(now);
  } catch (err) {
    if (err instanceof IncompleteClerkExportError) throw new IncompleteHistoricalCohortError();
    throw new IncompleteHistoricalCohortError();
  }

  const unknown = census.rows.filter((row) => row.classification === "Unknown");
  const apple = await loadAppleHistory(
    unknown.filter((row) => !isHistoricalInternalAccount(row.email)).map((row) => row.clerkId),
    now
  );
  const key = process.env.STRIPE_SECRET_KEY;
  const stripe = key ? new Stripe(key) : null;
  const recognized = getRecognizedSummittPriceIds();
  const counts = emptyHistoricalCounts();
  const rows: { name: string; email: string; createdAt: string; decision: ReturnType<typeof classifyHistoricalAccount> }[] = [];

  for (let i = 0; i < unknown.length; i += CONCURRENCY) {
    const chunk = unknown.slice(i, i + CONCURRENCY);
    const decisions = await Promise.all(
      chunk.map(async (row) => {
        if (!stripe) {
          return classifyHistoricalAccount({
            email: row.email,
            createdAtMs: Number.isFinite(Date.parse(row.createdAt)) ? Date.parse(row.createdAt) : null,
            metadataClaimsMembership: metadataClaimsMembership(row),
            identity: "lookup_failed",
            stripeCustomerFound: false,
            subscriptionListComplete: false,
            sessionListComplete: false,
            stripeFinding: "unreadable",
            apple: apple.get(row.clerkId) ?? "unreadable",
          });
        }
        return reconcileRow(stripe, row, apple.get(row.clerkId) ?? "none", recognized);
      })
    );
    chunk.forEach((row, index) => {
      const decision = decisions[index];
      if (!decision) return;
      countHistoricalDecision(counts, decision);
      rows.push({ name: row.name, email: row.email, createdAt: row.createdAt, decision });
    });
  }

  return { csv: buildHistoricalNeverSubscriberCsv(counts, rows), counts };
}
