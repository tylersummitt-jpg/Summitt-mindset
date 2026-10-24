/**
 * Instantly thread reply transport.
 * POST /api/v2/emails/reply only. This module does not decide eligibility
 * beyond the arguments it is given, and it does not retry an uncertain post.
 */

export const INSTANTLY_REPLY_URL = "https://api.instantly.ai/api/v2/emails/reply";

export function outboundSendPlan(existing: {
  status: string;
  providerMessageId: string | null;
  claimUntil: string | null;
} | null, now: Date): "claim_and_send" | "reconcile" | "leave" {
  if (!existing) return "claim_and_send";
  if (existing.status === "sent" && existing.providerMessageId) return "leave";
  if (existing.status === "uncertain") return "reconcile";
  if (existing.status === "processing") {
    const live = existing.claimUntil != null && Date.parse(existing.claimUntil) > now.getTime();
    return live ? "leave" : "reconcile";
  }
  return "leave";
}

export type InstantlyReplyAttempt =
  | { state: "blocked"; reason: "sending_off" | "missing_credentials" | "missing_reply_target" | "missing_account" | "missing_subject" | "missing_body" | "ineligible" | "unauthorized" | "payment_required" | "not_found" | "rate_limited" | "provider_error"; statusCode: number | null }
  | { state: "uncertain"; reason: "timeout_or_network" | "unreadable_response" | "no_provider_id"; statusCode: number | null; providerMessageId: string | null }
  | { state: "accepted"; providerMessageId: string; statusCode: 200 };

function blocked(reason: Extract<InstantlyReplyAttempt, { state: "blocked" }>["reason"], statusCode: number | null = null): InstantlyReplyAttempt {
  return { state: "blocked", reason, statusCode };
}

export async function postInstantlyThreadReply(args: {
  apiKey: string | null;
  sending: "off" | "on";
  eligible: boolean;
  eaccount: string | null;
  replyToUuid: string | null;
  subject: string | null;
  text: string | null;
  fetchImpl?: typeof fetch;
}): Promise<InstantlyReplyAttempt> {
  if (args.sending !== "on") return blocked("sending_off");
  if (!args.apiKey) return blocked("missing_credentials");
  if (!args.replyToUuid) return blocked("missing_reply_target");
  if (!args.eaccount) return blocked("missing_account");
  if (!args.subject) return blocked("missing_subject");
  if (!args.text) return blocked("missing_body");
  if (!args.eligible) return blocked("ineligible");
  const fetchImpl = args.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(INSTANTLY_REPLY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        eaccount: args.eaccount,
        reply_to_uuid: args.replyToUuid,
        subject: args.subject,
        body: { text: args.text },
      }),
    });
  } catch {
    return { state: "uncertain", reason: "timeout_or_network", statusCode: null, providerMessageId: null };
  }
  if (response.status === 401) return blocked("unauthorized", 401);
  if (response.status === 402) return blocked("payment_required", 402);
  if (response.status === 404) return blocked("not_found", 404);
  if (response.status === 429) return blocked("rate_limited", 429);
  if (!response.ok) return blocked("provider_error", response.status);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { state: "uncertain", reason: "unreadable_response", statusCode: response.status, providerMessageId: null };
  }
  const id = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as { id?: unknown }).id
    : null;
  if (typeof id !== "string" || !id.trim() || id.trim().length > 80) {
    return { state: "uncertain", reason: "unreadable_response", statusCode: response.status, providerMessageId: null };
  }
  return { state: "accepted", providerMessageId: id.trim(), statusCode: 200 };
}

export function replyRowFromAttempt(attempt: InstantlyReplyAttempt): {
  processing_status: "blocked" | "uncertain" | "sent" | "failed";
  processing_error: string | null;
  provider_status_code: number | null;
  provider_response_id: string | null;
} {
  if (attempt.state === "accepted") {
    return {
      processing_status: "sent",
      processing_error: null,
      provider_status_code: 200,
      provider_response_id: attempt.providerMessageId,
    };
  }
  if (attempt.state === "uncertain") {
    return {
      processing_status: "uncertain",
      processing_error: attempt.reason,
      provider_status_code: attempt.statusCode,
      provider_response_id: attempt.providerMessageId,
    };
  }
  return {
    processing_status: attempt.reason === "provider_error" ? "failed" : "blocked",
    processing_error: attempt.reason,
    provider_status_code: attempt.statusCode,
    provider_response_id: null,
  };
}

export async function reconcileInstantlyReply(args: {
  apiKey: string | null;
  providerMessageId: string | null;
  fetchImpl?: typeof fetch;
}): Promise<InstantlyReplyAttempt> {
  if (!args.providerMessageId) {
    return { state: "uncertain", reason: "no_provider_id", statusCode: null, providerMessageId: null };
  }
  if (!args.apiKey) return blocked("missing_credentials");
  const fetchImpl = args.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`https://api.instantly.ai/api/v2/emails/${encodeURIComponent(args.providerMessageId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${args.apiKey}` },
    });
  } catch {
    return { state: "uncertain", reason: "timeout_or_network", statusCode: null, providerMessageId: args.providerMessageId };
  }
  if (response.status === 404) {
    return { state: "uncertain", reason: "no_provider_id", statusCode: 404, providerMessageId: args.providerMessageId };
  }
  if (!response.ok) {
    return { state: "uncertain", reason: "unreadable_response", statusCode: response.status, providerMessageId: args.providerMessageId };
  }
  return { state: "accepted", providerMessageId: args.providerMessageId, statusCode: 200 };
}
