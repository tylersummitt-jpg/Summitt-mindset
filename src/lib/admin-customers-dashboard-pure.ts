import type { SmsRelationshipStatus } from "@/lib/sms-preferences-types";
import {
  isAppleRowCurrentlyGranting,
  type AppleSubscriptionGrantRecord,
} from "@/lib/summitt-membership-entitlement";

export const MAX_TYLER_NOTES_CHARS = 20_000;
export const MAX_OTHER_ITEMS_SENT_CHARS = 4_000;

export type AdminCustomerNotesPatch = {
  tylerNotes: string;
  sentQuotesBook: boolean;
  otherItemsSent: string | null;
};

/** V1 subscribed universe: strict Clerk cache flag only. */
export function isCurrentSubscribedMember(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  return metadata?.summittSubscribed === true;
}

export type StripeSubscriptionTime = {
  startDateUnixSeconds: number | null;
  createdUnixSeconds: number | null;
};

/** Current Clerk `stripeSubscriptionId` only — not lifetime history. */
export function clerkStripeSubscriptionId(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const raw = metadata?.stripeSubscriptionId;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function unixSecondsToMs(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.trunc(value) * 1000;
}

function isoToMs(iso: string | null | undefined): number | null {
  if (typeof iso !== "string" || !iso.trim()) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function clerkCreatedToMs(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.trunc(value);
}

/**
 * Canonical "subscribed at" for Admin → Customers newest-first sort.
 *
 * Stripe current sub: start_date, else created (unix seconds).
 * Apple granting row: created_at ISO.
 * Both: max of the two granting timestamps.
 * Else: Clerk created_at (unix ms) as fallback only.
 *
 * Does not use trial_end, current_period_start, customer created,
 * onboarding, SMS, or Clerk updated_at.
 */
export function subscribedAtMs(args: {
  stripe?: StripeSubscriptionTime | null;
  appleGrantCreatedAtIso?: string | null;
  clerkCreatedAtMs?: number | null;
}): number {
  const stripeMs =
    unixSecondsToMs(args.stripe?.startDateUnixSeconds) ??
    unixSecondsToMs(args.stripe?.createdUnixSeconds);
  const appleMs = isoToMs(args.appleGrantCreatedAtIso ?? null);

  if (stripeMs != null && appleMs != null) return Math.max(stripeMs, appleMs);
  if (stripeMs != null) return stripeMs;
  if (appleMs != null) return appleMs;
  return clerkCreatedToMs(args.clerkCreatedAtMs) ?? 0;
}

export type AppleGrantCreatedAtRow = AppleSubscriptionGrantRecord & {
  created_at: string | null;
};

/** Latest created_at among currently granting Apple rows. Expired rows ignored. */
export function latestGrantingAppleCreatedAtIso(
  rows: AppleGrantCreatedAtRow[],
  now: Date
): string | null {
  let latestIso: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (!isAppleRowCurrentlyGranting(row, now)) continue;
    const ms = isoToMs(row.created_at);
    if (ms == null || ms <= latestMs) continue;
    latestMs = ms;
    latestIso = row.created_at;
  }
  return latestIso;
}

export function subscribedAtMsForCustomer(args: {
  clerkCreatedAtMs: number | null | undefined;
  stripeSubscriptionId: string | null | undefined;
  stripeTimesBySubscriptionId: ReadonlyMap<string, StripeSubscriptionTime>;
  appleGrantCreatedAtIso: string | null | undefined;
}): number {
  const subId =
    typeof args.stripeSubscriptionId === "string"
      ? args.stripeSubscriptionId.trim()
      : "";
  const stripe = subId
    ? args.stripeTimesBySubscriptionId.get(subId) ?? null
    : null;
  return subscribedAtMs({
    stripe,
    appleGrantCreatedAtIso: args.appleGrantCreatedAtIso,
    clerkCreatedAtMs: args.clerkCreatedAtMs,
  });
}

/** Sort the full subscribed set newest-first, then slice the page. */
export function orderAndPaginateSubscribedCustomers<T extends { id: string }>(args: {
  users: T[];
  page: number;
  limit: number;
  subscribedAtMsFor: (user: T) => number;
}): { users: T[]; hasMore: boolean } {
  const ranked = [...args.users].sort((a, b) => {
    const diff = args.subscribedAtMsFor(b) - args.subscribedAtMsFor(a);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
  const page = Math.max(1, Math.floor(args.page));
  const limit = Math.min(Math.max(1, Math.floor(args.limit)), 100);
  const skip = (page - 1) * limit;
  const window = ranked.slice(skip, skip + limit + 1);
  return {
    users: window.slice(0, limit),
    hasMore: window.length > limit,
  };
}

export function formatSubscriptionLabel(
  metadata: Record<string, unknown> | null | undefined
): string {
  const plan = metadata?.summittPlan;
  if (plan === "monthly") return "Active (monthly)";
  if (plan === "annual") return "Active (annual)";
  return "Active";
}

export function formatTextStatusLabel(status: SmsRelationshipStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "stopped":
      return "Stopped";
    case "not_configured":
      return "Not configured";
    default:
      return status;
  }
}

export function normalizeAdminCustomerNotesPatch(
  body: unknown
): { ok: true; value: AdminCustomerNotesPatch } | { ok: false; error: string } {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid JSON body" };
  }

  const raw = body as Record<string, unknown>;

  if (typeof raw.tylerNotes !== "string") {
    return { ok: false, error: "tylerNotes must be a string" };
  }
  if (typeof raw.sentQuotesBook !== "boolean") {
    return { ok: false, error: "sentQuotesBook must be a boolean" };
  }

  const tylerNotes = raw.tylerNotes.trim().slice(0, MAX_TYLER_NOTES_CHARS);
  let otherItemsSent: string | null = null;
  if (raw.otherItemsSent != null) {
    if (typeof raw.otherItemsSent !== "string") {
      return { ok: false, error: "otherItemsSent must be a string or null" };
    }
    const trimmed = raw.otherItemsSent.trim().slice(0, MAX_OTHER_ITEMS_SENT_CHARS);
    otherItemsSent = trimmed.length > 0 ? trimmed : null;
  }

  return {
    ok: true,
    value: {
      tylerNotes,
      sentQuotesBook: raw.sentQuotesBook,
      otherItemsSent,
    },
  };
}

export function resolveQuotesBookSentAtPatch(args: {
  previousSent: boolean;
  nextSent: boolean;
  previousSentAt: string | null;
  nowIso: string;
}): string | null {
  if (!args.nextSent) return null;
  if (!args.previousSent && args.nextSent) return args.nowIso;
  if (args.previousSentAt) return args.previousSentAt;
  return args.nowIso;
}
