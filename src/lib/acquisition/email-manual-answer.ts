/**
 * Decisions for holding one unsupported acquisition question.
 * This module does not write records and does not call a provider.
 */

import {
  outboundSendPlan,
  postInstantlyThreadReply,
  reconcileInstantlyReply,
  replyRowFromAttempt,
} from "@/lib/acquisition/instantly-reply";
import { salesEmailMustStop, type AcquisitionLifecycle, ACQUISITION_LIFECYCLE } from "@/lib/acquisition/model";

export const EMAIL_ANSWER_NOTIFY_CAP = 3;
export const EMAIL_ANSWER_NOTIFY_STALE_MS = 10 * 60 * 1000;
export const EMAIL_ANSWER_REPAIR_LIMIT = 5;
export const EMAIL_ANSWER_HOLD_STATUSES = ["open", "sending", "uncertain", "failed"] as const;

export function manualAnswersMissingFrom(args: {
  messages: ReadonlyArray<{ id: string; outcome: string | null; processingError: string | null }>;
  coveredInboundIds: ReadonlySet<string>;
}): string[] {
  const missing: string[] = [];
  for (const message of args.messages) {
    if (args.coveredInboundIds.has(message.id)) continue;
    if (!manualAnswerNeeded({ outcome: message.outcome, draftRejected: false, processingError: message.processingError })) continue;
    missing.push(message.id);
    if (missing.length >= EMAIL_ANSWER_REPAIR_LIMIT) break;
  }
  return missing;
}

export type StuckSendRepair =
  | { action: "leave" }
  | { action: "reopen" }
  | { action: "mark_sent"; providerMessageId: string }
  | { action: "mark_terminal"; status: "failed" | "blocked"; reason: string }
  | { action: "hold_uncertain"; reason: "no_provider_id" }
  | { action: "read_provider"; providerMessageId: string; outboundStatus: string };

function claimIsLive(claimUntil: string | null, now: Date): boolean {
  const until = claimUntil ? Date.parse(claimUntil) : NaN;
  return Number.isFinite(until) && until > now.getTime();
}

/** Resolve a crashed manual send without starting a provider POST. */
export function stuckManualSendRepair(args: {
  requestStatus: string;
  claimUntil: string | null;
  outbound: { status: string; providerMessageId: string | null; claimUntil: string | null; error: string | null } | null;
  now: Date;
}): StuckSendRepair {
  const outbound = args.outbound;
  if (outbound?.status === "sent" && outbound.providerMessageId && args.requestStatus !== "sent") {
    return { action: "mark_sent", providerMessageId: outbound.providerMessageId };
  }
  if (outbound && (outbound.status === "failed" || outbound.status === "blocked") && args.requestStatus !== outbound.status && args.requestStatus !== "sent") {
    return {
      action: "mark_terminal",
      status: outbound.status,
      reason: (outbound.error ?? "provider_error").slice(0, 80),
    };
  }
  if (!outbound && args.requestStatus === "sending") {
    return claimIsLive(args.claimUntil, args.now) ? { action: "leave" } : { action: "reopen" };
  }
  if (outbound && (outbound.status === "uncertain" || outbound.status === "processing")) {
    if (outbound.status === "processing" && claimIsLive(outbound.claimUntil, args.now)) return { action: "leave" };
    if (outbound.providerMessageId) {
      return { action: "read_provider", providerMessageId: outbound.providerMessageId, outboundStatus: outbound.status };
    }
    if (args.requestStatus !== "uncertain") return { action: "hold_uncertain", reason: "no_provider_id" };
  }
  return { action: "leave" };
}

export function manualAnswerNeeded(args: {
  outcome: string | null;
  draftRejected: boolean;
  processingError: string | null;
}): boolean {
  if (args.outcome === "needs_human") return true;
  if (args.outcome === "ask_question" && (args.draftRejected || args.processingError === "draft_rejected")) return true;
  return false;
}

export function missingInformationReason(args: {
  outcome: string | null;
  reason: string | null;
  draftRejected: boolean;
}): string {
  const base = (args.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
  if (args.draftRejected) {
    const withheld = "Draft withheld because it included an unsupported claim.";
    return (base ? `${base} ${withheld}` : withheld).slice(0, 240);
  }
  return (base || "The question is not covered by verified product facts.").slice(0, 240);
}

export function emailAnswerAdminUrl(requestId: string): string {
  return `https://summittmindset.com/admin/distribution/email-answers?request=${encodeURIComponent(requestId)}`;
}

export function reviewOwnerEmailAnswer(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\u0000/g, "").trim();
  if (!trimmed || trimmed.length > 2000) return null;
  if (/https?:\/\//i.test(trimmed) || /\bwww\./i.test(trimmed)) return null;
  if (/\battach(?:ed|ment|ing)\b/i.test(trimmed)) return null;
  return trimmed;
}

export type EmailAnswerNotice = {
  status: string;
  notificationStatus: string;
  attempts: number;
  updatedAt: string | null;
};

export function notificationPlan(notice: EmailAnswerNotice, now: Date): "send" | "leave" {
  if (notice.status !== "open") return "leave";
  if (notice.notificationStatus === "sent") return "leave";
  if (notice.attempts >= EMAIL_ANSWER_NOTIFY_CAP && notice.notificationStatus !== "pending") return "leave";
  if (notice.notificationStatus === "pending" || notice.notificationStatus === "failed") return "send";
  if (notice.notificationStatus === "notifying") {
    const updated = notice.updatedAt ? Date.parse(notice.updatedAt) : NaN;
    if (!Number.isFinite(updated) || updated + EMAIL_ANSWER_NOTIFY_STALE_MS > now.getTime()) return "leave";
    if (notice.attempts >= EMAIL_ANSWER_NOTIFY_CAP) return "leave";
    return "send";
  }
  return "leave";
}

export function blockedInboundIds(args: {
  messages: ReadonlyArray<{ id: string; journeyId: string | null }>;
  answers: ReadonlyArray<{ inboundMessageId: string; journeyId: string | null; status: string }>;
}): Set<string> {
  const heldJourneys = new Set(
    args.answers
      .filter((answer) => (EMAIL_ANSWER_HOLD_STATUSES as readonly string[]).includes(answer.status) && answer.journeyId)
      .map((answer) => answer.journeyId as string),
  );
  const heldInbound = new Set(
    args.answers
      .filter((answer) => (EMAIL_ANSWER_HOLD_STATUSES as readonly string[]).includes(answer.status))
      .map((answer) => answer.inboundMessageId),
  );
  const blocked = new Set<string>();
  for (const message of args.messages) {
    if (heldInbound.has(message.id) || (message.journeyId != null && heldJourneys.has(message.journeyId))) {
      blocked.add(message.id);
    }
  }
  return blocked;
}

type OutboundState = {
  status: string;
  providerMessageId: string | null;
  claimUntil: string | null;
  error: string | null;
} | null;

export type ApprovedEmailSnapshot = {
  readable: boolean;
  request: {
    id: string;
    status: string;
    approvedBody: string | null;
    inboundMessageId: string;
    personId: string;
    journeyId: string | null;
    claimUntil: string | null;
  } | null;
  inbound: {
    replyToProviderMessageId: string | null;
    senderAccount: string | null;
    subject: string | null;
    leadEmail: string | null;
    campaignId: string | null;
  } | null;
  person: {
    found: boolean;
    lifecycle: string;
    suppressed: boolean | null;
    clerkSubscribed: boolean;
  };
  journey?: { lifecycle: string; closed: boolean } | "unreadable" | null;
  outbound: OutboundState;
};

export type ApprovedEmailResult = {
  state: "accepted" | "refused" | "blocked" | "failed" | "uncertain" | "processing";
  reason: string | null;
  providerMessageId: string | null;
};

export type ApprovedEmailDeps = {
  now: Date;
  apiKey: string | null;
  read: () => Promise<ApprovedEmailSnapshot>;
  mark: (status: string, patch: Record<string, string | null>) => Promise<boolean>;
  claim: () => Promise<"claimed" | "lost" | "error">;
  insertOutbound: (guard: { replyTo: string; sender: string; leadEmail: string; subject: string; body: string }) => Promise<"inserted" | "duplicate" | "error">;
  recordOutbound: (patch: ReturnType<typeof replyRowFromAttempt>, expectedStatus: string) => Promise<boolean>;
  fetchImpl?: typeof fetch;
};

function knownLifecycle(value: string): value is AcquisitionLifecycle {
  return (ACQUISITION_LIFECYCLE as readonly string[]).includes(value);
}

export function journeyAnswerBlock(snapshot: ApprovedEmailSnapshot): "ok" | "block" | "unreadable" {
  if (snapshot.journey === "unreadable") return "unreadable";
  if (snapshot.request?.journeyId && snapshot.journey && snapshot.journey !== null) {
    if (snapshot.journey.closed || snapshot.journey.lifecycle === "not_interested") return "block";
    return "ok";
  }
  if (!snapshot.request?.journeyId && snapshot.person.lifecycle === "not_interested") return "block";
  return "ok";
}

function token(value: string | null, max: number): value is string {
  return Boolean(value && value.length >= 1 && value.length <= max && !/\s/.test(value));
}

function mailbox(value: string | null): value is string {
  return Boolean(value && value.includes("@") && value.length >= 3 && value.length <= 254 && !/\s/.test(value));
}

function lead(value: string | null): value is string {
  return Boolean(value && value.includes("@") && value.length >= 6 && value.length <= 254 && !/\s/.test(value));
}

export function approvedEmailDecision(snapshot: ApprovedEmailSnapshot, now: Date):
  | { action: "refuse"; reason: string }
  | { action: "block_opt_out" }
  | { action: "leave"; result: ApprovedEmailResult }
  | { action: "reconcile"; providerMessageId: string | null; expectedStatus: string }
  | { action: "send"; body: string; subject: string; replyTo: string; sender: string; leadEmail: string } {
  if (!snapshot.readable || !snapshot.request || !snapshot.inbound) return { action: "refuse", reason: "unreadable" };
  const outbound = snapshot.outbound;
  if (outbound) {
    const plan = outboundSendPlan({
      status: outbound.status,
      providerMessageId: outbound.providerMessageId,
      claimUntil: outbound.claimUntil,
    }, now);
    if (plan === "reconcile") {
      return { action: "reconcile", providerMessageId: outbound.providerMessageId, expectedStatus: outbound.status };
    }
    if (outbound.status === "sent" && outbound.providerMessageId) {
      return { action: "leave", result: { state: "accepted", reason: null, providerMessageId: outbound.providerMessageId } };
    }
    if (outbound.status === "processing") {
      return { action: "leave", result: { state: "processing", reason: "claim_held", providerMessageId: null } };
    }
    if (outbound.status === "blocked" || outbound.status === "failed") {
      return {
        action: "leave",
        result: { state: outbound.status, reason: outbound.error ?? "provider_error", providerMessageId: null },
      };
    }
    return { action: "leave", result: { state: "refused", reason: "existing_outbound", providerMessageId: null } };
  }
  const person = snapshot.person;
  const lifecycle = knownLifecycle(person.lifecycle) ? person.lifecycle : null;
  const journeyBlock = journeyAnswerBlock(snapshot);
  if (journeyBlock === "unreadable") return { action: "refuse", reason: "journey_unreadable" };
  if (!person.found || !lifecycle || salesEmailMustStop(lifecycle) || person.clerkSubscribed || person.suppressed || journeyBlock === "block") {
    return { action: "block_opt_out" };
  }
  if (person.suppressed == null) return { action: "refuse", reason: "suppression_unknown" };
  if (snapshot.request.status === "sending") {
    const until = snapshot.request.claimUntil ? Date.parse(snapshot.request.claimUntil) : NaN;
    if (Number.isFinite(until) && until > now.getTime()) {
      return { action: "leave", result: { state: "processing", reason: "claim_held", providerMessageId: null } };
    }
  } else if (snapshot.request.status !== "open") {
    return { action: "leave", result: { state: "refused", reason: "closed", providerMessageId: null } };
  }
  const body = reviewOwnerEmailAnswer(snapshot.request.approvedBody);
  if (!body) return { action: "refuse", reason: "missing_answer" };
  const subjectSource = snapshot.inbound.subject?.trim() || null;
  const subject = subjectSource ? `Re: ${subjectSource}`.slice(0, 180) : null;
  if (!subject || /https?:\/\//i.test(subject)) return { action: "refuse", reason: "missing_subject" };
  if (!token(snapshot.inbound.replyToProviderMessageId, 80)) return { action: "refuse", reason: "missing_reply_target" };
  if (!mailbox(snapshot.inbound.senderAccount)) return { action: "refuse", reason: "missing_account" };
  if (!lead(snapshot.inbound.leadEmail)) return { action: "refuse", reason: "ineligible" };
  return {
    action: "send",
    body,
    subject,
    replyTo: snapshot.inbound.replyToProviderMessageId,
    sender: snapshot.inbound.senderAccount,
    leadEmail: snapshot.inbound.leadEmail,
  };
}

function fromAttempt(attempt: Awaited<ReturnType<typeof postInstantlyThreadReply>>): ApprovedEmailResult {
  if (attempt.state === "accepted") return { state: "accepted", reason: null, providerMessageId: attempt.providerMessageId };
  if (attempt.state === "uncertain") return { state: "uncertain", reason: attempt.reason, providerMessageId: attempt.providerMessageId };
  return {
    state: attempt.reason === "provider_error" ? "failed" : "blocked",
    reason: attempt.reason,
    providerMessageId: null,
  };
}

async function reconcileOutbound(
  decision: Extract<ReturnType<typeof approvedEmailDecision>, { action: "reconcile" }>,
  deps: ApprovedEmailDeps,
): Promise<ApprovedEmailResult> {
  if (!deps.apiKey) return { state: "refused", reason: "missing_credentials", providerMessageId: null };
  const attempt = await reconcileInstantlyReply({
    apiKey: deps.apiKey,
    providerMessageId: decision.providerMessageId,
    fetchImpl: deps.fetchImpl,
  });
  await deps.recordOutbound(replyRowFromAttempt(attempt), decision.expectedStatus);
  const result = fromAttempt(attempt);
  if (result.state === "accepted") {
    await deps.mark("sent", { provider_response_id: result.providerMessageId, send_error: null });
  } else if (result.state === "uncertain") {
    await deps.mark("uncertain", { send_error: result.reason });
  }
  return result;
}

async function finishKnownSend(deps: ApprovedEmailDeps, result: ApprovedEmailResult): Promise<ApprovedEmailResult> {
  if (result.state === "accepted") {
    await deps.mark("sent", { provider_response_id: result.providerMessageId, send_error: null });
  } else if (result.state === "failed" || result.state === "blocked") {
    await deps.mark(result.state, { send_error: result.reason });
  }
  return result;
}

export async function runApprovedEmailAnswer(deps: ApprovedEmailDeps): Promise<ApprovedEmailResult> {
  const first = approvedEmailDecision(await deps.read(), deps.now);
  if (first.action === "refuse") return { state: "refused", reason: first.reason, providerMessageId: null };
  if (first.action === "block_opt_out") {
    await deps.mark("blocked", { send_error: "ineligible" });
    return { state: "blocked", reason: "ineligible", providerMessageId: null };
  }
  if (first.action === "leave") return finishKnownSend(deps, first.result);
  if (first.action === "reconcile") return reconcileOutbound(first, deps);
  if (!deps.apiKey) return { state: "refused", reason: "missing_credentials", providerMessageId: null };
  const claimed = await deps.claim();
  if (claimed === "lost") return { state: "processing", reason: "claim_held", providerMessageId: null };
  if (claimed === "error") return { state: "refused", reason: "claim_failed", providerMessageId: null };
  const snapshot = await deps.read();
  const lifecycleOk = knownLifecycle(snapshot.person.lifecycle) && !salesEmailMustStop(snapshot.person.lifecycle);
  const journeyBlock = journeyAnswerBlock(snapshot);
  if (journeyBlock === "unreadable") {
    await deps.mark("open", { send_error: "journey_unreadable" });
    return { state: "refused", reason: "journey_unreadable", providerMessageId: null };
  }
  const stopped = !snapshot.person.found || snapshot.person.suppressed !== false || snapshot.person.clerkSubscribed || !lifecycleOk || journeyBlock === "block";
  if (snapshot.outbound || stopped) {
    const follow = approvedEmailDecision({
      ...snapshot,
      request: snapshot.request ? { ...snapshot.request, status: "open" } : null,
    }, deps.now);
    if (follow.action === "leave") return finishKnownSend(deps, follow.result);
    if (follow.action === "reconcile") return reconcileOutbound(follow, deps);
    if (follow.action === "block_opt_out") {
      await deps.mark("blocked", { send_error: "ineligible" });
      return { state: "blocked", reason: "ineligible", providerMessageId: null };
    }
    if (follow.action === "refuse") {
      await deps.mark("open", { send_error: follow.reason });
      return { state: "refused", reason: follow.reason, providerMessageId: null };
    }
  }
  const inserted = await deps.insertOutbound({
    replyTo: first.replyTo,
    sender: first.sender,
    leadEmail: first.leadEmail,
    subject: first.subject,
    body: first.body,
  });
  if (inserted === "error") {
    await deps.mark("open", { send_error: "claim_failed" });
    return { state: "refused", reason: "claim_failed", providerMessageId: null };
  }
  if (inserted === "duplicate") {
    const after = approvedEmailDecision(await deps.read(), deps.now);
    if (after.action === "send") return { state: "refused", reason: "duplicate_send", providerMessageId: null };
    if (after.action === "leave") return finishKnownSend(deps, after.result);
    if (after.action === "reconcile") return reconcileOutbound(after, deps);
    if (after.action === "block_opt_out") return { state: "blocked", reason: "ineligible", providerMessageId: null };
    return { state: "refused", reason: after.reason, providerMessageId: null };
  }
  const attempt = await postInstantlyThreadReply({
    apiKey: deps.apiKey,
    sending: "on",
    eligible: true,
    eaccount: first.sender,
    replyToUuid: first.replyTo,
    subject: first.subject,
    text: first.body,
    fetchImpl: deps.fetchImpl,
  });
  await deps.recordOutbound(replyRowFromAttempt(attempt), "processing");
  const result = fromAttempt(attempt);
  const nextStatus = result.state === "accepted" ? "sent" : result.state === "uncertain" ? "uncertain" : result.state === "failed" ? "failed" : "blocked";
  await deps.mark(nextStatus, {
    provider_response_id: result.providerMessageId,
    send_error: result.reason,
    approved_subject: first.subject,
  });
  return result;
}
