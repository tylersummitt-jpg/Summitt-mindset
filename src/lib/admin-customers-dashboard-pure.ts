import type { SmsRelationshipStatus } from "@/lib/sms-preferences-types";

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
