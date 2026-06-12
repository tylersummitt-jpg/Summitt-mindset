import "server-only";

import {
  formatSubscriptionLabel,
  formatTextStatusLabel,
  isCurrentSubscribedMember,
} from "@/lib/admin-customers-dashboard-pure";
import { listClerkUsers, type ClerkUserResponse } from "@/lib/clerk-rest";
import { resolvePreferredName } from "@/lib/resolve-preferred-name";
import { deriveRelationshipStatus } from "@/lib/sms-preferences-view";
import type { SmsRelationshipStatus } from "@/lib/sms-preferences-types";
import { extractPrimaryEmail } from "@/lib/quotes-book-fulfillment-reminder";
import { supabaseServer } from "@/lib/supabase-server";
import type { V2UserSmsCommsPreferencesRow } from "@/lib/v2-sms-comms-preferences";

export {
  formatSubscriptionLabel,
  formatTextStatusLabel,
  isCurrentSubscribedMember,
  normalizeAdminCustomerNotesPatch,
  resolveQuotesBookSentAtPatch,
} from "@/lib/admin-customers-dashboard-pure";
export type { AdminCustomerNotesPatch } from "@/lib/admin-customers-dashboard-pure";

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

export async function listSubscribedClerkUsersPage(args: {
  page: number;
  limit: number;
}): Promise<{ users: ClerkUserResponse[]; hasMore: boolean }> {
  const page = Math.max(1, Math.floor(args.page));
  const limit = Math.min(Math.max(1, Math.floor(args.limit)), 100);
  const skip = (page - 1) * limit;
  const target = limit + 1;

  const collected: ClerkUserResponse[] = [];
  let subscribedIndex = 0;
  let clerkOffset = 0;
  let batchesScanned = 0;

  while (collected.length < target && batchesScanned < MAX_CLERK_SCAN_BATCHES) {
    const batch = await listClerkUsers({
      limit: CLERK_LIST_BATCH_SIZE,
      offset: clerkOffset,
    });
    batchesScanned += 1;

    if (!batch.length) break;

    for (const user of batch) {
      const md = (user.public_metadata || {}) as Record<string, unknown>;
      if (!isCurrentSubscribedMember(md)) continue;

      if (subscribedIndex < skip) {
        subscribedIndex += 1;
        continue;
      }

      collected.push(user);
      if (collected.length >= target) break;
    }

    if (collected.length >= target) break;
    if (batch.length < CLERK_LIST_BATCH_SIZE) break;
    clerkOffset += CLERK_LIST_BATCH_SIZE;
  }

  const hasMore = collected.length > limit;
  return { users: collected.slice(0, limit), hasMore };
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
