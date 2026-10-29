/**
 * Instantly webhook normalization.
 * Event names are the official webhook event types from
 * https://developer.instantly.ai/guides/webhook-events
 * and the create-webhook enum at
 * https://developer.instantly.ai/api-reference/webhook/create-webhook.
 * Reply text is never classified. There is no keyword rule for Interested.
 */

import {
  previewText,
  type AcquisitionSignal,
} from "@/lib/acquisition/model";

export const INSTANTLY_WEBHOOK_EVENTS = [
  "email_sent",
  "email_opened",
  "reply_received",
  "auto_reply_received",
  "link_clicked",
  "email_bounced",
  "lead_unsubscribed",
  "campaign_completed",
  "account_error",
  "lead_neutral",
  "lead_interested",
  "lead_not_interested",
  "lead_meeting_booked",
  "lead_meeting_completed",
  "lead_closed",
  "lead_out_of_office",
  "lead_wrong_person",
  "lead_no_show",
] as const;

export type InstantlyWebhookEvent = (typeof INSTANTLY_WEBHOOK_EVENTS)[number];

const KNOWN = new Set<string>(INSTANTLY_WEBHOOK_EVENTS);

export type InstantlyNormalized =
  | {
      kind: "person";
      eventType: string;
      rawEventType: string;
      signal: AcquisitionSignal;
      email: string;
      providerEventId: string;
      occurredAt: string;
      campaignId: string | null;
      campaignName: string | null;
      sender: string | null;
      preview: string | null;
      closeReason: string | null;
      step: number | null;
      /** Instantly email id when it fits unchanged. Not a thread id. */
      providerMessageId: string | null;
      replySubject: string | null;
      /** Full plain text for reply_received only. Null when the payload has none. */
      replyText: string | null;
      replyTextTruncated: boolean;
    }
  | {
      kind: "sender";
      eventType: "account_error";
      providerEventId: string;
      occurredAt: string;
      sender: string | null;
      detail: string | null;
    }
  | { kind: "ignore"; reason: "no_email" | "no_identity" };

const SIGNAL: Record<InstantlyWebhookEvent, AcquisitionSignal> = {
  email_sent: "email_sent",
  email_opened: "observe",
  reply_received: "reply_received",
  auto_reply_received: "observe",
  link_clicked: "observe",
  email_bounced: "bounced",
  lead_unsubscribed: "unsubscribed",
  campaign_completed: "campaign_completed",
  account_error: "observe",
  lead_neutral: "observe",
  lead_interested: "interested",
  lead_not_interested: "not_interested",
  lead_meeting_booked: "observe",
  lead_meeting_completed: "observe",
  lead_closed: "observe",
  lead_out_of_office: "observe",
  lead_wrong_person: "wrong_person",
  lead_no_show: "observe",
};

const CLOSE_REASON: Partial<Record<InstantlyWebhookEvent, string>> = {
  auto_reply_received: "auto_reply",
  lead_out_of_office: "out_of_office",
  lead_wrong_person: "wrong_person",
  lead_neutral: "neutral",
  lead_meeting_booked: "meeting_booked",
  lead_meeting_completed: "meeting_completed",
  lead_closed: "closed",
  lead_no_show: "no_show",
};

export const ACQUISITION_REPLY_TEXT_CAP = 20_000;

function text(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Reject an id that would have to be shortened. A shortened id is not a reply target. */
function exactToken(value: unknown, max = 80): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /\s/.test(trimmed)) return null;
  return trimmed;
}

function replyBody(value: unknown): { text: string; truncated: boolean } | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\u0000/g, "").trim();
  if (!trimmed) return null;
  if (trimmed.length <= ACQUISITION_REPLY_TEXT_CAP) return { text: trimmed, truncated: false };
  return { text: trimmed.slice(0, ACQUISITION_REPLY_TEXT_CAP), truncated: true };
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function normalizeInstantlyWebhook(payload: unknown, now = new Date()): InstantlyNormalized {
  if (!payload || typeof payload !== "object") return { kind: "ignore", reason: "no_identity" };
  const record = payload as Record<string, unknown>;
  const rawType = text(record.event_type, 80);
  if (!rawType) return { kind: "ignore", reason: "no_identity" };
  const occurredAt = timestamp(record.timestamp) ?? now.toISOString();
  const sender = text(record.email_account, 254);
  const campaignId = text(record.campaign_id, 80);
  const email = text(record.lead_email, 254);
  const emailId = text(record.email_id, 80);
  const identity = emailId
    ? `${rawType}:${emailId}`
    : email
      ? `${rawType}:${email.toLowerCase()}:${occurredAt}:${campaignId ?? ""}`
      : sender
        ? `${rawType}:${sender.toLowerCase()}:${occurredAt}`
        : "";
  if (!identity) return { kind: "ignore", reason: "no_identity" };

  if (rawType === "account_error") {
    return {
      kind: "sender",
      eventType: "account_error",
      providerEventId: identity.slice(0, 180),
      occurredAt,
      sender,
      detail: previewText(record.email_subject, 180),
    };
  }

  if (!email) return { kind: "ignore", reason: "no_email" };
  const known = KNOWN.has(rawType) ? (rawType as InstantlyWebhookEvent) : null;
  const step = typeof record.step === "number" && Number.isFinite(record.step) ? record.step : null;
  const isReply = rawType === "reply_received";
  const body = isReply ? replyBody(record.reply_text) : null;
  return {
    kind: "person",
    eventType: known ?? "unrecognized",
    rawEventType: rawType,
    signal: known ? SIGNAL[known] : "observe",
    email,
    providerEventId: identity.slice(0, 180),
    occurredAt,
    campaignId,
    campaignName: text(record.campaign_name, 120),
    sender,
    preview: previewText(record.reply_text_snippet) ?? previewText(record.reply_text),
    closeReason: known ? CLOSE_REASON[known] ?? null : null,
    step,
    providerMessageId: exactToken(record.email_id, 80),
    replySubject: isReply ? text(record.reply_subject, 300) : null,
    replyText: body?.text ?? null,
    replyTextTruncated: body?.truncated ?? false,
  };
}

export function instantlyPersonMetadata(
  event: Extract<InstantlyNormalized, { kind: "person" }>
): Record<string, unknown> {
  return {
    ...(event.preview ? { preview: event.preview } : {}),
    ...(event.closeReason ? { close_reason: event.closeReason } : {}),
    ...(event.step != null ? { step: event.step } : {}),
    ...(event.eventType === "unrecognized" ? { instantly_event_type: event.rawEventType } : {}),
  };
}

/**
 * Lead status and interest numbers from the Instantly API v2 lead schema
 * (status: Active, Paused, Completed, Bounced, Unsubscribed, Skipped;
 * lt_interest_status: Interested, Meeting Booked, Meeting Completed, Won,
 * Out of Office, Not Interested, Wrong Person, Lost, No Show).
 * Values outside those enums are not treated as Interested.
 */
export const INSTANTLY_LEAD_STATUS: Record<number, "active" | "paused" | "completed" | "bounced" | "unsubscribed" | "skipped"> = {
  1: "active",
  2: "paused",
  3: "completed",
  [-1]: "bounced",
  [-2]: "unsubscribed",
  [-3]: "skipped",
};

export const INSTANTLY_INTEREST: Record<
  number,
  "interested" | "meeting_booked" | "meeting_completed" | "won" | "out_of_office" | "not_interested" | "wrong_person" | "lost" | "no_show"
> = {
  1: "interested",
  2: "meeting_booked",
  3: "meeting_completed",
  4: "won",
  0: "out_of_office",
  [-1]: "not_interested",
  [-2]: "wrong_person",
  [-3]: "lost",
  [-4]: "no_show",
};

export function instantlyInterestLabel(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return INSTANTLY_INTEREST[value] ?? null;
}

export function instantlyLeadStatusLabel(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return INSTANTLY_LEAD_STATUS[value] ?? null;
}

/**
 * Instantly lead verification_status from the v2 lead schema.
 * Verified is the only value that clears the address for import.
 */
export const INSTANTLY_VERIFICATION: Record<
  number,
  "not_verified" | "verified" | "invalid" | "risky" | "catch_all" | "job_change" | "pending" | "pending_job"
> = {
  0: "not_verified",
  1: "verified",
  [-1]: "invalid",
  [-2]: "risky",
  [-3]: "catch_all",
  [-4]: "job_change",
  11: "pending",
  12: "pending_job",
};

export function instantlyVerificationLabel(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return INSTANTLY_VERIFICATION[value] ?? null;
}

export function instantlyVerificationClearance(
  value: unknown,
): "verified" | "exclude" | "unverified" {
  const label = instantlyVerificationLabel(value);
  if (label === "verified") return "verified";
  if (label === "invalid" || label === "risky" || label === "catch_all" || label === "job_change") return "exclude";
  return "unverified";
}
