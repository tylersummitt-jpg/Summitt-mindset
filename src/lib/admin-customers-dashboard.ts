import "server-only";

import Stripe from "stripe";

import {
  clerkStripeSubscriptionId,
  formatSubscriptionLabel,
  formatTextStatusLabel,
  isCurrentSubscribedMember,
  latestGrantingAppleCreatedAtIso,
  orderAndPaginateSubscribedCustomers,
  subscribedAtMsForCustomer,
  type AppleGrantCreatedAtRow,
  type StripeSubscriptionTime,
} from "@/lib/admin-customers-dashboard-pure";
import { listClerkUsers, type ClerkUserResponse } from "@/lib/clerk-rest";
import { resolvePreferredName } from "@/lib/resolve-preferred-name";
import { deriveRelationshipStatus } from "@/lib/sms-preferences-view";
import type { SmsRelationshipStatus } from "@/lib/sms-preferences-types";
import { extractPrimaryEmail } from "@/lib/quotes-book-fulfillment-reminder";
import { supabaseServer } from "@/lib/supabase-server";
import type { V2UserSmsCommsPreferencesRow } from "@/lib/v2-sms-comms-preferences";

export {
  clerkStripeSubscriptionId,
  formatSubscriptionLabel,
  formatTextStatusLabel,
  isCurrentSubscribedMember,
  latestGrantingAppleCreatedAtIso,
  normalizeAdminCustomerNotesPatch,
  orderAndPaginateSubscribedCustomers,
  resolveQuotesBookSentAtPatch,
  subscribedAtMs,
  subscribedAtMsForCustomer,
} from "@/lib/admin-customers-dashboard-pure";
export type { AdminCustomerNotesPatch } from "@/lib/admin-customers-dashboard-pure";

const STRIPE_RETRIEVE_CHUNK = 10;
const APPLE_IN_CHUNK = 100;

export const ADMIN_CUSTOMERS_PAGE_SIZE = 50;
export const CLERK_LIST_BATCH_SIZE = 200;
export const MAX_CLERK_SCAN_BATCHES = 100;

export type AdminCustomerNotesRow = {
  clerk_user_id: string;
  tyler_notes: string;
  sent_quotes_book: boolean;
  sent_quotes_book_at: string | null;
  other_items_sent: string | null;
};

export type AdminCustomerDashboardRow = {
  clerkUserId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  subscriptionLabel: string;
  textStatus: SmsRelationshipStatus;
  textStatusLabel: string;
  lastSmsReplyAt: string | null;
  tylerNotes: string;
  sentQuotesBook: boolean;
  sentQuotesBookAt: string | null;
  otherItemsSent: string | null;
};

export type AdminCustomersListResult = {
  page: number;
  limit: number;
  hasMore: boolean;
  rows: AdminCustomerDashboardRow[];
};

function clerkFirstName(user: ClerkUserResponse): string | null {
  const fn = user.first_name;
  return typeof fn === "string" && fn.trim() ? fn.trim() : null;
}

function clerkPhone(metadata: Record<string, unknown> | null | undefined): string | null {
  const raw = metadata?.phoneNumber;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clerkSmsEnabled(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.smsEnabled === true;
}

/** Full currently-subscribed Clerk set. Does not paginate or early-exit. */
export async function listAllSubscribedClerkUsers(): Promise<ClerkUserResponse[]> {
  const collected: ClerkUserResponse[] = [];
  let clerkOffset = 0;
  let batchesScanned = 0;

  while (batchesScanned < MAX_CLERK_SCAN_BATCHES) {
    const batch = await listClerkUsers({
      limit: CLERK_LIST_BATCH_SIZE,
      offset: clerkOffset,
    });
    batchesScanned += 1;

    if (!batch.length) break;

    for (const user of batch) {
      const md = (user.public_metadata || {}) as Record<string, unknown>;
      if (!isCurrentSubscribedMember(md)) continue;
      collected.push(user);
    }

    if (batch.length < CLERK_LIST_BATCH_SIZE) break;
    clerkOffset += CLERK_LIST_BATCH_SIZE;
  }

  return collected;
}

async function fetchStripeTimesBySubscriptionId(
  subscriptionIds: string[]
): Promise<Map<string, StripeSubscriptionTime>> {
  const map = new Map<string, StripeSubscriptionTime>();
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of subscriptionIds) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  if (!unique.length) return map;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.warn("[admin-customers] missing STRIPE_SECRET_KEY; Stripe timestamps skipped");
    return map;
  }

  const stripe = new Stripe(key);

  for (let i = 0; i < unique.length; i += STRIPE_RETRIEVE_CHUNK) {
    const chunk = unique.slice(i, i + STRIPE_RETRIEVE_CHUNK);
    const results = await Promise.all(
      chunk.map(async (id) => {
        try {
          const sub = await stripe.subscriptions.retrieve(id);
          return [
            id,
            {
              startDateUnixSeconds:
                typeof sub.start_date === "number" ? sub.start_date : null,
              createdUnixSeconds:
                typeof sub.created === "number" ? sub.created : null,
            },
          ] as const;
        } catch (err) {
          console.warn("[admin-customers] stripe retrieve failed", {
            subscriptionId: id,
            message: err instanceof Error ? err.message : "unknown_error",
          });
          return null;
        }
      })
    );
    for (const entry of results) {
      if (entry) map.set(entry[0], entry[1]);
    }
  }

  return map;
}

async function fetchAppleGrantCreatedAtByUserId(
  clerkUserIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!clerkUserIds.length) return map;

  const now = new Date();

  for (let i = 0; i < clerkUserIds.length; i += APPLE_IN_CHUNK) {
    const chunk = clerkUserIds.slice(i, i + APPLE_IN_CHUNK);
    const { data, error } = await supabaseServer
      .from("apple_subscriptions")
      .select("clerk_user_id, created_at, product_id, status, expires_at")
      .in("clerk_user_id", chunk);

    if (error) {
      console.warn("[admin-customers] apple_subscriptions batch failed", error.message);
      continue;
    }

    const byUser = new Map<string, AppleGrantCreatedAtRow[]>();
    for (const raw of data ?? []) {
      const clerkUserId =
        typeof raw.clerk_user_id === "string" ? raw.clerk_user_id : "";
      if (!clerkUserId) continue;
      const createdAt =
        typeof raw.created_at === "string"
          ? raw.created_at
          : raw.created_at instanceof Date
            ? raw.created_at.toISOString()
            : null;
      if (typeof raw.product_id !== "string" || typeof raw.status !== "string") {
        continue;
      }
      const row = {
        product_id: raw.product_id,
        status: raw.status,
        expires_at:
          typeof raw.expires_at === "string"
            ? raw.expires_at
            : raw.expires_at instanceof Date
              ? raw.expires_at
              : null,
        created_at: createdAt,
      };
      const list = byUser.get(clerkUserId) ?? [];
      list.push(row);
      byUser.set(clerkUserId, list);
    }

    for (const [clerkUserId, rows] of byUser) {
      const iso = latestGrantingAppleCreatedAtIso(rows, now);
      if (!iso) continue;
      const prev = map.get(clerkUserId);
      if (!prev || Date.parse(iso) > Date.parse(prev)) {
        map.set(clerkUserId, iso);
      }
    }
  }

  return map;
}

export async function listSubscribedClerkUsersPage(args: {
  page: number;
  limit: number;
}): Promise<{ users: ClerkUserResponse[]; hasMore: boolean }> {
  const subscribed = await listAllSubscribedClerkUsers();

  const stripeIds: string[] = [];
  for (const user of subscribed) {
    const id = clerkStripeSubscriptionId(
      (user.public_metadata || {}) as Record<string, unknown>
    );
    if (id) stripeIds.push(id);
  }

  const [stripeTimes, appleCreatedAt] = await Promise.all([
    fetchStripeTimesBySubscriptionId(stripeIds),
    fetchAppleGrantCreatedAtByUserId(subscribed.map((u) => u.id)),
  ]);

  return orderAndPaginateSubscribedCustomers({
    users: subscribed,
    page: args.page,
    limit: args.limit,
    subscribedAtMsFor: (user) => {
      const md = (user.public_metadata || {}) as Record<string, unknown>;
      return subscribedAtMsForCustomer({
        clerkCreatedAtMs:
          typeof user.created_at === "number" ? user.created_at : null,
        stripeSubscriptionId: clerkStripeSubscriptionId(md),
        stripeTimesBySubscriptionId: stripeTimes,
        appleGrantCreatedAtIso: appleCreatedAt.get(user.id) ?? null,
      });
    },
  });
}

async function fetchPreferredNamesByUserId(
  clerkUserIds: string[]
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (!clerkUserIds.length) return map;

  const { data, error } = await supabaseServer
    .from("user_profiles")
    .select("clerk_user_id, preferred_name")
    .in("clerk_user_id", clerkUserIds);

  if (error) {
    console.error("[admin-customers] user_profiles batch failed", error.message);
    return map;
  }

  for (const row of data ?? []) {
    const id = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
    if (!id) continue;
    const preferred =
      typeof row.preferred_name === "string" ? row.preferred_name : null;
    map.set(id, preferred);
  }

  return map;
}

async function fetchSmsPrefsByUserId(
  clerkUserIds: string[]
): Promise<Map<string, V2UserSmsCommsPreferencesRow>> {
  const map = new Map<string, V2UserSmsCommsPreferencesRow>();
  if (!clerkUserIds.length) return map;

  const { data, error } = await supabaseServer
    .from("v2_user_sms_comms_preferences")
    .select("*")
    .in("clerk_user_id", clerkUserIds);

  if (error) {
    console.warn("[admin-customers] sms prefs batch failed", error.message);
    return map;
  }

  for (const row of data ?? []) {
    const id = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
    if (!id) continue;
    map.set(id, row as V2UserSmsCommsPreferencesRow);
  }

  return map;
}

async function fetchAdminNotesByUserId(
  clerkUserIds: string[]
): Promise<Map<string, AdminCustomerNotesRow>> {
  const map = new Map<string, AdminCustomerNotesRow>();
  if (!clerkUserIds.length) return map;

  const { data, error } = await supabaseServer
    .from("admin_customer_relationship_notes")
    .select(
      "clerk_user_id, tyler_notes, sent_quotes_book, sent_quotes_book_at, other_items_sent"
    )
    .in("clerk_user_id", clerkUserIds);

  if (error) {
    console.error("[admin-customers] admin notes batch failed", error.message);
    return map;
  }

  for (const row of data ?? []) {
    const id = typeof row.clerk_user_id === "string" ? row.clerk_user_id : "";
    if (!id) continue;
    map.set(id, {
      clerk_user_id: id,
      tyler_notes: typeof row.tyler_notes === "string" ? row.tyler_notes : "",
      sent_quotes_book: row.sent_quotes_book === true,
      sent_quotes_book_at:
        typeof row.sent_quotes_book_at === "string" ? row.sent_quotes_book_at : null,
      other_items_sent:
        typeof row.other_items_sent === "string" ? row.other_items_sent : null,
    });
  }

  return map;
}

/** Latest inbound SMS timestamp per user (read-only). */
export async function fetchLastInboundSmsAtByUserId(
  clerkUserIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!clerkUserIds.length) return map;

  const results = await Promise.all(
    clerkUserIds.map(async (clerkUserId) => {
      const { data, error } = await supabaseServer
        .from("sms_inbound_messages")
        .select("received_at")
        .eq("clerk_user_id", clerkUserId)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn("[admin-customers] last inbound lookup failed", {
          clerk_user_id: clerkUserId,
          message: error.message,
        });
        return null;
      }

      const at = typeof data?.received_at === "string" ? data.received_at : null;
      return at ? ([clerkUserId, at] as const) : null;
    })
  );

  for (const entry of results) {
    if (entry) map.set(entry[0], entry[1]);
  }

  return map;
}

export async function buildAdminCustomerDashboardRows(
  users: ClerkUserResponse[]
): Promise<AdminCustomerDashboardRow[]> {
  if (!users.length) return [];

  const ids = users.map((u) => u.id);

  const [preferredNames, smsPrefs, adminNotes, lastInbound] = await Promise.all([
    fetchPreferredNamesByUserId(ids),
    fetchSmsPrefsByUserId(ids),
    fetchAdminNotesByUserId(ids),
    fetchLastInboundSmsAtByUserId(ids),
  ]);

  return users.map((user) => {
    const md = (user.public_metadata || {}) as Record<string, unknown>;
    const phone = clerkPhone(md);
    const prefs = smsPrefs.get(user.id) ?? null;
    const notes = adminNotes.get(user.id);
    const textStatus = deriveRelationshipStatus({
      smsEnabled: clerkSmsEnabled(md),
      phoneConfigured: Boolean(phone),
      prefs,
    });

    return {
      clerkUserId: user.id,
      name: resolvePreferredName(preferredNames.get(user.id), clerkFirstName(user)),
      email: extractPrimaryEmail(user),
      phone,
      subscriptionLabel: formatSubscriptionLabel(md),
      textStatus,
      textStatusLabel: formatTextStatusLabel(textStatus),
      lastSmsReplyAt: lastInbound.get(user.id) ?? null,
      tylerNotes: notes?.tyler_notes ?? "",
      sentQuotesBook: notes?.sent_quotes_book ?? false,
      sentQuotesBookAt: notes?.sent_quotes_book_at ?? null,
      otherItemsSent: notes?.other_items_sent ?? null,
    };
  });
}

export async function loadAdminCustomersPage(args: {
  page: number;
  limit?: number;
}): Promise<AdminCustomersListResult> {
  const limit = args.limit ?? ADMIN_CUSTOMERS_PAGE_SIZE;
  const { users, hasMore } = await listSubscribedClerkUsersPage({
    page: args.page,
    limit,
  });
  const rows = await buildAdminCustomerDashboardRows(users);

  return {
    page: Math.max(1, Math.floor(args.page)),
    limit,
    hasMore,
    rows,
  };
}
