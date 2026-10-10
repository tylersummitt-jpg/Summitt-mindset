import { randomBytes, randomUUID } from "node:crypto";
import {
  challengeAttentionAlert,
  challengeIdempotencyKey,
  decideDelivery,
  isUnsubscribeTokenShape,
  normalizeChallengeEmail,
  planAdvanceAccepted,
  planSendResult,
  publicSignupBody,
  sanitizeProviderError,
  type ChallengeAttentionAlert,
} from "@/lib/challenge-send-outcome";
import type { ChallengeStore } from "@/lib/challenge-store";
import {
  CHALLENGE_PUBLIC_ALREADY,
  CHALLENGE_SEND_TRACKING_CUTOVER_ISO,
  type ChallengeParticipant,
  type ChallengeSender,
  type PublicSignupResult,
} from "@/lib/challenge-types";
import { getNext8AMEastern } from "@/lib/timezone";

export type ChallengeDeps = {
  store: ChallengeStore;
  send: ChallengeSender;
  now?: Date;
  nextSendAt?: () => string;
  notifyAttention?: (alert: ChallengeAttentionAlert) => Promise<void>;
};

export type ChallengeCronResult = {
  success: true;
  processed: number;
  failed: number;
  skipped: number;
  needsAttention: number;
  legacyDay1Held: number;
};

function nowOf(deps: ChallengeDeps): Date {
  return deps.now ?? new Date();
}

function nextSlot(deps: ChallengeDeps): string {
  return deps.nextSendAt ? deps.nextSendAt() : getNext8AMEastern();
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function logEvent(
  event: string,
  row: Pick<ChallengeParticipant, "id" | "challengeDay">,
  extra?: Record<string, unknown>
): void {
  console.info("[challenge]", {
    event,
    participantId: row.id,
    day: row.challengeDay,
    ...extra,
  });
}

export function newChallengeEnrollment(args: {
  email: string;
  now: Date;
  id?: string;
  token?: string;
}): ChallengeParticipant {
  return {
    id: args.id ?? randomUUID(),
    email: args.email,
    challengeDay: 1,
    startedAt: args.now.toISOString(),
    completed: false,
    nextSendAt: null,
    lastSentAt: null,
    suppressedAt: null,
    unsubscribeToken: args.token ?? newToken(),
    reliableSendTracking: true,
    sendTrackingCutoverAt: CHALLENGE_SEND_TRACKING_CUTOVER_ISO,
    sendState: "pending",
    sendAttention: null,
    attemptIdempotencyKey: null,
    attemptKeyCreatedAt: null,
    attemptCount: 0,
    nextRetryAt: null,
    lastSendError: null,
    lastSendAttemptAt: null,
    lastAcceptedDay: null,
    lastProviderMessageId: null,
    lastAcceptedAt: null,
    sendClaimToken: null,
    sendClaimUntil: null,
    reenrolledAt: null,
    attentionNotifiedAt: null,
  };
}

async function markAttention(
  deps: ChallengeDeps,
  row: ChallengeParticipant,
  attention: ChallengeParticipant["sendAttention"]
): Promise<void> {
  const next: ChallengeParticipant = {
    ...row,
    sendAttention: attention,
    sendState: attention === "unknown_expired" ? "unknown" : row.sendState,
    nextRetryAt: null,
    sendClaimToken: null,
    sendClaimUntil: null,
  };
  const saved = await deps.store.commitBookkeeping(row, next);
  if (saved) {
    logEvent("needs_attention", saved, { attention });
    await maybeAlert(deps, saved);
  }
}

async function maybeAlert(
  deps: ChallengeDeps,
  saved: ChallengeParticipant | null
): Promise<void> {
  if (!saved || !deps.notifyAttention) return;
  const alert = challengeAttentionAlert(saved);
  if (!alert) return;
  try {
    await deps.notifyAttention(alert);
  } catch (err) {
    console.error("[challenge] attention_notification_failed", {
      participantId: alert.participantId,
      day: alert.challengeDay,
      attention: alert.failureType,
      message: sanitizeProviderError(err),
    });
    return;
  }
  try {
    const stamped = await deps.store.markAttentionNotified(saved.id, alert.failureType);
    if (!stamped) {
      console.error("[challenge] attention_notification_failed", {
        participantId: alert.participantId,
        day: alert.challengeDay,
        attention: alert.failureType,
        message: "attention alert was not recorded",
      });
    }
  } catch (err) {
    console.error("[challenge] attention_notification_failed", {
      participantId: alert.participantId,
      day: alert.challengeDay,
      attention: alert.failureType,
      message: sanitizeProviderError(err),
    });
  }
}

/**
 * Send the current lesson, or record why it cannot be sent.
 * Does not advance the day unless Resend returns a message id.
 * Unknown results keep the same idempotency key.
 */
export async function deliverChallengeLesson(
  deps: ChallengeDeps,
  row: ChallengeParticipant
): Promise<"accepted" | "failed" | "skipped" | "attention"> {
  const now = nowOf(deps);
  const decision = decideDelivery(row, now);
  if (decision.kind === "not_due") return "skipped";
  if (decision.kind === "unknown_expired") {
    await markAttention(deps, row, "unknown_expired");
    return "attention";
  }
  if (decision.kind === "retry_exhausted") {
    await markAttention(deps, row, "retry_exhausted");
    return "attention";
  }
  if (decision.kind === "inconsistent") {
    await markAttention(deps, row, "sequence_inconsistent");
    return "attention";
  }
  if (decision.kind === "advance_accepted") {
    const advanced = planAdvanceAccepted(row, nextSlot(deps));
    if (!advanced) return "skipped";
    const saved = await deps.store.commitBookkeeping(row, advanced);
    return saved ? "accepted" : "skipped";
  }

  const claimed = await deps.store.claim(row, {
    now,
    claimToken: randomUUID(),
    idempotencyKey: challengeIdempotencyKey(row.id, row.challengeDay, randomUUID()),
    unsubscribeToken: newToken(),
  });
  if (!claimed) return "skipped";

  const fresh = await deps.store.getById(claimed.id);
  if (
    !fresh ||
    fresh.suppressedAt ||
    fresh.completed ||
    fresh.challengeDay !== claimed.challengeDay ||
    fresh.sendClaimToken !== claimed.sendClaimToken
  ) {
    if (fresh && fresh.sendClaimToken === claimed.sendClaimToken) {
      await deps.store.commitBookkeeping(claimed, {
        ...fresh,
        sendClaimToken: null,
        sendClaimUntil: null,
        sendState: fresh.suppressedAt ? "suppressed" : fresh.sendState,
        nextSendAt: fresh.suppressedAt ? null : fresh.nextSendAt,
        nextRetryAt: fresh.suppressedAt ? null : fresh.nextRetryAt,
      });
    }
    return "skipped";
  }

  if (!fresh.unsubscribeToken || !fresh.attemptIdempotencyKey) {
    await markAttention(deps, fresh, "permanent_failure");
    return "attention";
  }

  let result;
  try {
    result = await deps.send({
      to: fresh.email,
      day: fresh.challengeDay,
      idempotencyKey: fresh.attemptIdempotencyKey,
      unsubscribeToken: fresh.unsubscribeToken,
    });
  } catch (err) {
    result = {
      outcome: "unknown" as const,
      providerMessageId: null,
      errorName: "exception",
      statusCode: null,
      errorMessage: sanitizeProviderError(err),
    };
  }

  const after = (await deps.store.getById(claimed.id)) ?? fresh;
  const planned = planSendResult(after, result, now, nextSlot(deps));
  const saved = await deps.store.commitSendResult(claimed, planned);
  if (saved) await maybeAlert(deps, saved);
  if (!saved) {
    logEvent("send_result_not_saved", claimed, {
      outcome: result.outcome,
      providerMessageId: result.providerMessageId,
    });
    return result.outcome === "accepted" ? "failed" : "failed";
  }

  if (result.outcome === "accepted" && result.providerMessageId) {
    logEvent("provider_accepted", claimed, {
      providerMessageId: result.providerMessageId,
      nextDay: saved.challengeDay,
    });
    return "accepted";
  }

  logEvent("provider_not_accepted", claimed, {
    outcome: result.outcome,
    errorName: result.errorName,
    statusCode: result.statusCode,
    attention: saved.sendAttention,
  });
  return saved.sendAttention ? "attention" : "failed";
}

export async function enrollChallenge(
  deps: ChallengeDeps,
  emailRaw: string
): Promise<PublicSignupResult> {
  const email = normalizeChallengeEmail(emailRaw);
  if (!email) return publicSignupBody("invalid");

  try {
    const existing = await deps.store.findByEmail(email);
    if (existing) return publicSignupBody("already");

    const now = nowOf(deps);
    const created = newChallengeEnrollment({ email, now });
    const inserted = await deps.store.insert(created);
    if (inserted === "duplicate") return publicSignupBody("already");
    if (inserted === "error") return publicSignupBody("failed");

    const row = await deps.store.findByEmail(email);
    if (!row) return publicSignupBody("failed");

    const delivery = await deliverChallengeLesson(deps, row);
    if (delivery === "accepted") return publicSignupBody("started");
    return publicSignupBody("failed");
  } catch (err) {
    console.error("[challenge] enroll_failed", {
      message: sanitizeProviderError(err),
    });
    return publicSignupBody("failed");
  }
}

export async function processDueChallengeLessons(
  deps: ChallengeDeps
): Promise<ChallengeCronResult> {
  const now = nowOf(deps);
  const candidates = await deps.store.listCandidates();
  let processed = 0;
  let failed = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const current = (await deps.store.getById(candidate.id)) ?? candidate;
    if (current.sendAttention && !current.attentionNotifiedAt) {
      await maybeAlert(deps, current);
    }
    if (decideDelivery(current, now).kind === "not_due") {
      skipped += 1;
      continue;
    }
    const outcome = await deliverChallengeLesson(deps, current);
    if (outcome === "accepted") processed += 1;
    else if (outcome === "skipped") skipped += 1;
    else failed += 1;
  }
  const needsAttention = await deps.store.countNeedsAttention();
  const legacyDay1Held = await deps.store.countLegacyDay1Held();
  return {
    success: true,
    processed,
    failed,
    skipped,
    needsAttention,
    legacyDay1Held,
  };
}

export async function unsubscribeChallenge(
  deps: ChallengeDeps,
  tokenRaw: string
): Promise<"suppressed" | "already" | "missing"> {
  const token = tokenRaw.trim();
  if (!isUnsubscribeTokenShape(token)) return "missing";
  return deps.store.suppressByToken(token, nowOf(deps));
}

export type ReenrollResult = {
  ok: boolean;
  status: number;
  message: string;
};

export async function reenrollChallenge(
  deps: ChallengeDeps,
  tokenRaw: string
): Promise<ReenrollResult> {
  const token = tokenRaw.trim();
  if (!isUnsubscribeTokenShape(token)) {
    return { ok: false, status: 400, message: "This unsubscribe link is invalid." };
  }
  const plan = await deps.store.reenrollByToken(token, nowOf(deps), nextSlot(deps));
  if (plan === "missing") {
    return { ok: false, status: 400, message: "This unsubscribe link is invalid." };
  }
  if (plan.kind === "completed") {
    return {
      ok: true,
      status: 200,
      message: "This challenge is already complete. It will not start over.",
    };
  }
  if (plan.kind === "paused") {
    return {
      ok: false,
      status: 409,
      message: "This sequence is paused because a lesson could not be confirmed. It was not turned back on.",
    };
  }
  if (plan.kind === "already_active") {
    return { ok: true, status: 200, message: CHALLENGE_PUBLIC_ALREADY };
  }
  if (plan.kind === "resume_day1") {
    const delivery = await deliverChallengeLesson(deps, plan.row);
    if (delivery === "accepted") {
      return {
        ok: true,
        status: 200,
        message: "You're back on the challenge. Your next lesson is on its way.",
      };
    }
    return {
      ok: false,
      status: 503,
      message: "We couldn't restart the remaining lessons. Please try again from your unsubscribe link.",
    };
  }
  return {
    ok: true,
    status: 200,
    message:
      "You're back on the challenge. Remaining lessons will resume. Finished lessons are not sent again.",
  };
}

export async function readChallengeActionRequest(request: Request): Promise<{
  token: string;
  preferRedirect: boolean;
}> {
  const url = new URL(request.url);
  const queryToken = (url.searchParams.get("token") ?? "").trim();
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token.trim() : queryToken;
    return { token, preferRedirect: false };
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await request.formData();
    const field = form.get("token");
    const listUnsub = form.get("List-Unsubscribe");
    const token = typeof field === "string" && field.trim() ? field.trim() : queryToken;
    const oneClick = listUnsub === "One-Click";
    return { token, preferRedirect: !oneClick && typeof field === "string" };
  }

  const raw = await request.text().catch(() => "");
  if (raw.includes("List-Unsubscribe=One-Click")) {
    return { token: queryToken, preferRedirect: false };
  }
  return { token: queryToken, preferRedirect: false };
}
