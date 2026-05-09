/**
 * Pure helpers for V1 internal quotes book fulfillment reminders (ops email only).
 */

import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";

const MS_PER_DAY = 86_400_000;

export type ClerkLikeUser = {
  id?: string;
  created_at?: number;
  email_addresses?: Array<{ id: string; email_address: string }>;
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  public_metadata?: Record<string, unknown>;
};

export function parseAutomationCutover(raw: string | undefined): Date | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Clerk `created_at` is Unix time in milliseconds. */
export function parseClerkCreatedAtMs(user: ClerkLikeUser): number | null {
  const c = user.created_at;
  if (typeof c !== "number" || !Number.isFinite(c) || c <= 0) return null;
  return c;
}

export function isUserCreatedOnOrAfterCutoff(
  clerkCreatedAtMs: number,
  cutoff: Date
): boolean {
  return clerkCreatedAtMs >= cutoff.getTime();
}

export function isEntitledForQuotesBookReminder(metadata: unknown): boolean {
  return isSubscribedFromPublicMetadata(metadata);
}

export function extractPrimaryEmail(user: ClerkLikeUser): string | null {
  const emails = user.email_addresses;
  if (!Array.isArray(emails) || emails.length === 0) return null;

  const primaryId =
    typeof user.primary_email_address_id === "string"
      ? user.primary_email_address_id.trim()
      : "";

  if (primaryId) {
    const match = emails.find((e) => e?.id === primaryId);
    const addr =
      typeof match?.email_address === "string"
        ? match.email_address.trim()
        : "";
    if (addr) return addr;
  }

  const first = emails[0];
  const addr =
    typeof first?.email_address === "string"
      ? first.email_address.trim()
      : "";
  return addr || null;
}

export function extractDisplayNameSnapshot(user: ClerkLikeUser): string | null {
  const fn =
    typeof user.first_name === "string" ? user.first_name.trim() : "";
  const ln =
    typeof user.last_name === "string" ? user.last_name.trim() : "";
  const combined = [fn, ln].filter(Boolean).join(" ").trim();
  return combined || null;
}

/** Calendar 20 days in UTC from the given instant (same as Date + 20 * 24h for this use case). */
export function addTwentyDays(entitledFirstSeen: Date): Date {
  return new Date(entitledFirstSeen.getTime() + 20 * MS_PER_DAY);
}

export function isDue(quotesBookDueAt: Date, now: Date): boolean {
  return quotesBookDueAt.getTime() <= now.getTime();
}

export function isNotDueYet(quotesBookDueAt: Date, now: Date): boolean {
  return quotesBookDueAt.getTime() > now.getTime();
}

export function canSendOpsReminder(opsEmailSentAt: unknown): boolean {
  return opsEmailSentAt == null;
}

/** True when the row is due and V1 ops email has not succeeded yet. */
export function shouldSendDueOpsReminder(
  quotesBookDueAt: Date,
  now: Date,
  opsEmailSentAt: unknown
): boolean {
  return canSendOpsReminder(opsEmailSentAt) && isDue(quotesBookDueAt, now);
}

export function truncateErrorMessage(err: unknown, maxLen: number): string {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);
  if (msg.length <= maxLen) return msg;
  return msg.slice(0, maxLen);
}
