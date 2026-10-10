/**
 * Nonmember recovery decisions.
 * Sending stays off unless every gate below is true.
 * This module does not import Resend, Clerk, or the challenge sender.
 */

import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { classifyResendSend, type ResendSendLike } from "@/lib/challenge-send-outcome";

export const RECOVERY_FROM = "Tyler Summitt <tyler@summittmindset.com>";
export const RECOVERY_REPLY_TO = "tyler@summittmindset.com";
export const RECOVERY_INBOX_TEST_EMAIL = "tyler@summittmindset.com";
export const RECOVERY_INBOX_TEST_CLERK_ID = "recovery_inbox_test";
export const RECOVERY_ASSIGNMENT_SALT = "nonmember-recovery-v1";
export const RECOVERY_PRIMARY_WINDOW_DAYS = 14;
export const RECOVERY_DAILY_CAP = 25;

export const RECOVERY_DELAYS_MS = {
  firstAfterCreate: 24 * 60 * 60 * 1000,
  secondAfterFirst: 3 * 24 * 60 * 60 * 1000,
  thirdAfterSecond: 4 * 24 * 60 * 60 * 1000,
} as const;

export type RecoveryAutomationStatus = "unavailable" | "off" | "pilot" | "active" | "paused";
export type RecoveryAssignment = "control" | "recovery";
export type RecoveryStopReason =
  | "trial"
  | "member"
  | "former"
  | "unknown_membership"
  | "unsubscribe"
  | "suppressed"
  | "bounce"
  | "complaint"
  | "reply"
  | "invalid_email"
  | "geography"
  | "kill_switch"
  | "before_enrollment";

export type RecoverySettings = {
  status: RecoveryAutomationStatus;
  sendingAuthorized: boolean;
  inboundReady: boolean;
  suppressionCheckReady: boolean;
  suppressionReadable: boolean;
  postalAddress: string | null;
  enrollmentStartsAtMs: number | null;
  dailyCap: number;
};

export type RecoveryCandidate = {
  clerkUserId: string;
  createdAtMs: number;
  membership: "verified_nonmember" | "member" | "former" | "unknown" | "unavailable" | "missing";
  countryCode: string | null;
  email: string | null;
  firstName: string | null;
  suppressed: boolean;
  providerSuppressed: boolean | null;
  humanReplyOpen: boolean;
};

export type RecoveryMessageState = {
  step: 1 | 2 | 3;
  status: "scheduled" | "claimed" | "accepted" | "delivered" | "failed" | "suppressed" | "canceled" | "uncertain";
  idempotencyKey: string;
  claimHeldByOther: boolean;
  acceptedAtMs: number | null;
};

export function recoveryGreeting(firstName: string | null | undefined): string {
  if (typeof firstName !== "string") return "Hey!";
  const name = firstName.trim();
  if (!name || name.length > 40 || name.includes("@")) return "Hey!";
  if (!/^[\p{L}][\p{L}\s.'-]{0,39}$/u.test(name)) return "Hey!";
  return `Hi ${name},`;
}

export function assignRecoveryGroup(clerkUserId: string, salt: string): RecoveryAssignment {
  const digest = createHash("sha256").update(`${salt}:${clerkUserId}`).digest();
  return digest[0] % 2 === 0 ? "control" : "recovery";
}

export function recoveryIdempotencyKey(enrollmentId: string, step: 1 | 2 | 3): string {
  return `recovery:${enrollmentId}:${step}`;
}

export function evaluateAutomation(settings: RecoverySettings): { process: boolean; reason: string } {
  if (settings.status === "unavailable") {
    return { process: false, reason: "Recovery settings could not be read. Nothing is sent." };
  }
  if (settings.status === "off" || settings.status === "paused") {
    return { process: false, reason: `Automation is ${settings.status}. Nothing is sent.` };
  }
  if (!settings.sendingAuthorized) {
    return { process: false, reason: "Sending authorization is not set. Nothing is sent." };
  }
  if (!settings.inboundReady) {
    return { process: false, reason: "The recovery reply route is not configured. Nothing is sent." };
  }
  if (!settings.suppressionCheckReady || !settings.suppressionReadable) {
    return { process: false, reason: "Marketing suppression could not be verified. Nothing is sent." };
  }
  if (!settings.postalAddress?.trim()) {
    return { process: false, reason: "A physical mailing address is not recorded. Nothing is sent." };
  }
  if (settings.enrollmentStartsAtMs == null) {
    return { process: false, reason: "The enrollment start is not set. Historical accounts are not emailed." };
  }
  return { process: true, reason: "Gates are open." };
}

export function decideRecoverySend(args: {
  nowMs: number;
  settings: RecoverySettings;
  candidate: RecoveryCandidate;
  assignment: RecoveryAssignment | null;
  message: RecoveryMessageState | null;
  priorAcceptedAtMs: number | null;
  alreadySentToday: number;
}): { send: false; reason: string } | { send: true; reason: "due" } {
  const gate = evaluateAutomation(args.settings);
  if (!gate.process) return { send: false, reason: gate.reason };
  if (args.candidate.createdAtMs < (args.settings.enrollmentStartsAtMs as number)) {
    return { send: false, reason: "Account was created before the enrollment start." };
  }
  if (args.candidate.membership === "unavailable") {
    return { send: false, reason: "Membership could not be verified. The message stays scheduled." };
  }
  if (args.candidate.membership === "missing") {
    return { send: false, reason: "The Clerk account no longer exists." };
  }
  if (args.candidate.membership === "unknown") {
    return { send: false, reason: "Membership is unknown. Unknown is not send-ready." };
  }
  if (args.candidate.membership === "member") {
    return { send: false, reason: "A current member or verified trial is excluded." };
  }
  if (args.candidate.membership === "former") {
    return { send: false, reason: "A former member is excluded from recovery." };
  }
  const geography = recoveryGeography(args.candidate.countryCode);
  if (!geography.eligible) {
    return {
      send: false,
      reason: geography.basis === "restricted"
        ? "Known restricted geography is excluded."
        : "Geography is outside the initial recovery program.",
    };
  }
  if (!isReliableEmail(args.candidate.email)) {
    return { send: false, reason: "The recipient address is not reliable." };
  }
  if (args.candidate.suppressed || args.candidate.providerSuppressed === true) {
    return { send: false, reason: "The address is suppressed." };
  }
  if (args.candidate.providerSuppressed == null) {
    return { send: false, reason: "Provider suppression was not checked." };
  }
  if (args.candidate.humanReplyOpen) {
    return { send: false, reason: "A human reply stopped the sequence." };
  }
  if (args.assignment !== "recovery") {
    return { send: false, reason: "The holdout receives no recovery email." };
  }
  if (!args.message || args.message.claimHeldByOther) {
    return { send: false, reason: "Another worker holds this send." };
  }
  if (args.message.status !== "scheduled" && args.message.status !== "claimed") {
    return { send: false, reason: "This step already has an outcome and is not retried." };
  }
  if (args.alreadySentToday >= args.settings.dailyCap) {
    return { send: false, reason: "The daily send cap is reached." };
  }
  const dueAt = dueAtMs(args);
  if (dueAt == null || args.nowMs < dueAt) {
    return { send: false, reason: "This step is not due." };
  }
  return { send: true, reason: "due" };
}

function dueAtMs(args: {
  candidate: RecoveryCandidate;
  message: RecoveryMessageState | null;
  priorAcceptedAtMs: number | null;
}): number | null {
  if (!args.message) return null;
  if (args.message.step === 1) return args.candidate.createdAtMs + RECOVERY_DELAYS_MS.firstAfterCreate;
  if (args.priorAcceptedAtMs == null) return null;
  const wait = args.message.step === 2 ? RECOVERY_DELAYS_MS.secondAfterFirst : RECOVERY_DELAYS_MS.thirdAfterSecond;
  return args.priorAcceptedAtMs + wait;
}

export function isReliableEmail(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const email = value.trim().toLowerCase();
  if (email.length < 6 || email.length > 254 || /\s/.test(email)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeRecoveryEmail(value: string): string {
  return value.trim().toLowerCase();
}

export type InboundClass = "human" | "auto" | "bounce" | "unmatched";

export function classifyRecoveryInbound(args: {
  from: string;
  subject: string;
  autoSubmitted: string | null;
  inReplyTo: string | null;
  knownMessageIds: readonly string[];
  tokenMatched?: boolean;
}): InboundClass {
  const from = args.from.toLowerCase();
  const subject = args.subject.trim().toLowerCase();
  if (from.includes("mailer-daemon") || from.includes("postmaster") || subject.includes("delivery status notification")) {
    return "bounce";
  }
  const autoHeader = (args.autoSubmitted ?? "").trim().toLowerCase();
  if ((autoHeader && autoHeader !== "no") || /^(auto:|automatic reply|out of office)/.test(subject)) {
    return "auto";
  }
  const replyTo = (args.inReplyTo ?? "").trim();
  if (args.tokenMatched) return "human";
  if (!replyTo || !args.knownMessageIds.includes(replyTo)) return "unmatched";
  return "human";
}

export function verifyResendWebhook(args: {
  secret: string;
  id: string;
  timestamp: string;
  signatureHeader: string;
  body: string;
  nowMs: number;
}): boolean {
  const timestampMs = Number(args.timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(args.nowMs - timestampMs) > 5 * 60 * 1000) return false;
  const key = resendWebhookKey(args.secret);
  if (!key) return false;
  const expected = createHmac("sha256", key).update(`${args.id}.${args.timestamp}.${args.body}`).digest("base64");
  const parts = args.signatureHeader.split(" ");
  return parts.some((part) => {
    const value = part.startsWith("v1,") ? part.slice(3) : "";
    if (!value) return false;
    const a = Buffer.from(value);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

function resendWebhookKey(secret: string): Buffer | null {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  try {
    const key = Buffer.from(raw, "base64");
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export function recoveryPreview(body: string): string {
  const text = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, 140);
}

export function recoveryMessageCopy(args: {
  step: 1 | 2 | 3;
  firstName: string | null;
  unsubscribeUrl: string;
  postalAddress: string;
}): { subject: string; text: string } {
  const hello = recoveryGreeting(args.firstName);
  const cta = `https://summittmindset.com/subscribe?utm_source=email&utm_medium=recovery&utm_campaign=nonmember_recovery&utm_content=email_${args.step}`;
  const footer = [
    "",
    "Tyler Summitt",
    "Summitt Mindset, LLC",
    args.postalAddress,
    `Unsubscribe: ${args.unsubscribeUrl}`,
  ];
  if (args.step === 1) {
    return {
      subject: "Your Summitt Mindset account is ready",
      text: [
        hello,
        "",
        "You created a Summitt Mindset account, and the free trial has not started.",
        "If you still want daily coaching, you can finish here:",
        cta,
        "",
        "If now is not the right time, you can ignore this note.",
        ...footer,
      ].join("\n"),
    };
  }
  if (args.step === 2) {
    return {
      subject: "Need a hand starting your free trial?",
      text: [
        hello,
        "",
        "If something got in the way of starting the free trial, reply to this email.",
        "Tyler reads those replies.",
        "Or finish here:",
        cta,
        ...footer,
      ].join("\n"),
    };
  }
  return {
    subject: "Last note about your Summitt Mindset trial",
    text: [
      hello,
      "",
      "This is the last note in this short series.",
      "The free trial is still available here:",
      cta,
      "",
      "If you do not want these notes, use the unsubscribe link below.",
      ...footer,
    ].join("\n"),
  };
}

/**
 * Countries where commercial email generally requires prior consent.
 * The initial program does not apply the U.S. opt-out model to these codes.
 * A missing code is not added to this set and is not treated as US.
 */
const RECOVERY_RESTRICTED_COUNTRIES = new Set([
  "CA",
  "GB",
  "UK",
  "CH",
  "AU",
  "NZ",
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "EL",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO",
]);

export type RecoveryGeographyBasis = "unknown" | "explicit_us" | "restricted" | "outside_initial_program";

/**
 * Initial recovery geography.
 * Unknown stays unknown and can be included. It is not relabeled US.
 * An explicit restricted country is excluded. Any other explicit country is
 * outside this first program. Nothing here invents a country.
 */
export function recoveryGeography(countryCode: string | null | undefined): {
  eligible: boolean;
  basis: RecoveryGeographyBasis;
} {
  if (typeof countryCode !== "string") return { eligible: true, basis: "unknown" };
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return { eligible: true, basis: "unknown" };
  if (code === "US") return { eligible: true, basis: "explicit_us" };
  if (RECOVERY_RESTRICTED_COUNTRIES.has(code)) return { eligible: false, basis: "restricted" };
  return { eligible: false, basis: "outside_initial_program" };
}

/**
 * Reads only an explicit ISO country the account already stores.
 * Email domains, names, IP addresses, and billing data are ignored.
 * A missing value stays null.
 */
export function explicitCountryCode(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as { country?: unknown }).country;
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return code;
}

export function newRecoveryToken(): string {
  return randomBytes(32).toString("base64url");
}

export function recoveryTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function findReplyToken(parts: readonly string[]): string | null {
  for (const part of parts) {
    const match = part.match(/r\+([A-Za-z0-9_-]{20,128})@/i);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * One Reply-To. Common clients use a single reply address, so two Reply-To
 * values do not reliably reach both the inbox and the recovery route.
 * The inbound address is the route. A matched reply is then forwarded to
 * tyler@summittmindset.com. That forward is not treated as confirmed until
 * a reply matched to a recovery message has been stored.
 */
export function recoveryReplyTo(args: { token: string; inboundDomain: string | null }): string {
  const domain = configuredInboundDomain(args.inboundDomain);
  if (!domain) return RECOVERY_REPLY_TO;
  return `r+${args.token}@${domain}`;
}

export function recoveryInboxTestAllowed(args: {
  status: RecoveryAutomationStatus;
  sendingAuthorized: boolean;
  recipient: string;
}): { ok: true } | { ok: false; reason: string } {
  if (args.sendingAuthorized) return { ok: false, reason: "Sending authorization is on." };
  if (args.status === "pilot" || args.status === "active") return { ok: false, reason: "Automation is not off." };
  if (args.recipient.trim().toLowerCase() !== RECOVERY_INBOX_TEST_EMAIL) {
    return { ok: false, reason: "Only the approved inbox can receive the test." };
  }
  return { ok: true };
}

export function configuredInboundDomain(domain: string | null | undefined): string | null {
  const value = domain?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value) || value === "summittmindset.com") return null;
  return value;
}

export function shouldForwardRecoveryReply(recipients: readonly string[]): boolean {
  return !recipients.some((recipient) => recipient.toLowerCase().includes(RECOVERY_REPLY_TO));
}

export function recoveryHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<div>${escaped.replace(/\n/g, "<br>")}</div>`;
}

export type RecoveryDeliveryPayload = {
  from: string;
  to: string;
  replyTo: string | string[];
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
  idempotencyKey: string;
};

export type RecoveryProviderEvent =
  | { kind: "ignore" }
  | { kind: "delivered"; providerMessageId: string }
  | { kind: "soft_bounce"; providerMessageId: string | null }
  | {
      kind: "suppress";
      email: string | null;
      providerMessageId: string | null;
      reason: "bounce" | "complaint" | "provider";
    }
  | {
      kind: "received";
      emailId: string;
      from: string;
      to: string[];
      subject: string;
      messageId: string | null;
    };

export function interpretResendRecoveryEvent(payload: unknown): RecoveryProviderEvent {
  if (!payload || typeof payload !== "object") return { kind: "ignore" };
  const record = payload as { type?: unknown; data?: unknown };
  const type = typeof record.type === "string" ? record.type : "";
  const data = record.data && typeof record.data === "object"
    ? record.data as Record<string, unknown>
    : {};
  const providerMessageId = textValue(data.email_id);
  if (type === "email.delivered" && providerMessageId) {
    return { kind: "delivered", providerMessageId };
  }
  if (type === "email.bounced") {
    const bounce = data.bounce && typeof data.bounce === "object"
      ? data.bounce as { type?: unknown }
      : {};
    const bounceType = typeof bounce.type === "string" ? bounce.type.toLowerCase() : "";
    if (bounceType === "transient" || bounceType === "temporary") {
      return { kind: "soft_bounce", providerMessageId };
    }
    return {
      kind: "suppress",
      email: firstAddress(data.to),
      providerMessageId,
      reason: "bounce",
    };
  }
  if (type === "email.complained") {
    return {
      kind: "suppress",
      email: firstAddress(data.to),
      providerMessageId,
      reason: "complaint",
    };
  }
  if (type === "email.suppressed") {
    return {
      kind: "suppress",
      email: firstAddress(data.to),
      providerMessageId,
      reason: "provider",
    };
  }
  if (type === "email.received") {
    const emailId = providerMessageId;
    if (!emailId) return { kind: "ignore" };
    return {
      kind: "received",
      emailId,
      from: textValue(data.from) ?? "",
      to: addressList(data.to),
      subject: textValue(data.subject) ?? "",
      messageId: textValue(data.message_id),
    };
  }
  return { kind: "ignore" };
}

export function interpretContactLookup(args: {
  threw?: boolean;
  statusCode?: number | null;
  unsubscribed?: boolean | null;
  message?: string | null;
}): "suppressed" | "clear" | "unknown" {
  if (args.threw) return "unknown";
  if (args.unsubscribed === true) return "suppressed";
  const message = (args.message ?? "").toLowerCase();
  if (message.includes("suppress") || message.includes("unsubscrib")) return "suppressed";
  const status = args.statusCode ?? null;
  if (status == null || status === 404) return "clear";
  if (status === 429 || status >= 500) return "unknown";
  return "clear";
}

export function combineSuppression(
  localFound: boolean | null,
  contact: "suppressed" | "clear" | "unknown"
): boolean | null {
  if (localFound == null) return null;
  if (localFound || contact === "suppressed") return true;
  if (contact === "unknown") return null;
  return false;
}

export function membershipFromAccountCheck(args: {
  clerk: "found" | "missing" | "unavailable";
  appleReadable: boolean;
  stripeReadable: boolean;
  checkoutReadable: boolean;
  sessionsReadable: boolean;
  judged: "verified_nonmember" | "member" | "former" | "unknown" | null;
}): RecoveryCandidate["membership"] {
  if (args.clerk === "missing") return "missing";
  if (
    args.clerk === "unavailable"
    || !args.appleReadable
    || !args.stripeReadable
    || !args.checkoutReadable
    || !args.sessionsReadable
  ) {
    return "unavailable";
  }
  return args.judged ?? "unavailable";
}

export function recoveryWaitReason(reason: string): string | null {
  if (!/could not be verified|not checked/i.test(reason)) return null;
  return `Waiting: ${reason}`.slice(0, 240);
}

export function selectDueRecoverySteps<T extends { enrollmentId: string; step: 1 | 2 | 3; scheduledAtMs: number }>(
  rows: readonly T[],
  nowMs: number
): T[] {
  const chosen = new Map<string, T>();
  for (const row of rows) {
    if (row.scheduledAtMs > nowMs) continue;
    const current = chosen.get(row.enrollmentId);
    if (!current || row.step < current.step) chosen.set(row.enrollmentId, row);
  }
  return [...chosen.values()];
}

export function recoverySkipDisposition(reason: string): "stop" | "release" {
  if (/current member|former member|Membership is unknown|no longer exists|Geography|address is suppressed|human reply|not reliable|before the enrollment|holdout/i.test(reason)) {
    return "stop";
  }
  return "release";
}

export type RecoveryBatchJob = {
  idempotencyKey: string;
  candidate: RecoveryCandidate;
  assignment: RecoveryAssignment;
  message: RecoveryMessageState;
  priorAcceptedAtMs: number | null;
  alreadySentToday: number;
};

export type RecoveryBatchOutcome = {
  idempotencyKey: string;
  outcome: "accepted" | "uncertain" | "suppressed" | "failed" | "stop" | "release";
  providerMessageId: string | null;
  reason: string;
};

export async function executeRecoveryBatch(args: {
  nowMs: number;
  settings: RecoverySettings;
  jobs: RecoveryBatchJob[];
  claim: (idempotencyKey: string) => Promise<boolean>;
  reread: (idempotencyKey: string) => Promise<{
    settings: RecoverySettings;
    candidate: RecoveryCandidate;
    assignment: RecoveryAssignment;
    message: RecoveryMessageState;
    priorAcceptedAtMs: number | null;
    alreadySentToday: number;
  }>;
  buildPayload: (idempotencyKey: string, fresh: {
    candidate: RecoveryCandidate;
    message: RecoveryMessageState;
  }) => Promise<RecoveryDeliveryPayload>;
  send: (payload: RecoveryDeliveryPayload) => Promise<ResendSendLike>;
  record: (outcome: RecoveryBatchOutcome) => Promise<void>;
}): Promise<{ accepted: number; uncertain: number; skipped: number }> {
  const gate = evaluateAutomation(args.settings);
  if (!gate.process) {
    return { accepted: 0, uncertain: 0, skipped: args.jobs.length };
  }
  let accepted = 0;
  let uncertain = 0;
  let skipped = 0;
  let sentThisRun = 0;
  const seenThisRun = new Set<string>();
  const jobs = [...args.jobs].sort((a, b) => a.message.step - b.message.step);
  for (const job of jobs) {
    if (seenThisRun.has(job.candidate.clerkUserId)) {
      await args.record({
        idempotencyKey: job.idempotencyKey,
        outcome: "release",
        providerMessageId: null,
        reason: "An earlier recovery email is still outstanding.",
      });
      skipped += 1;
      continue;
    }
    seenThisRun.add(job.candidate.clerkUserId);
    const claimed = await args.claim(job.idempotencyKey);
    if (!claimed) {
      skipped += 1;
      continue;
    }
    const fresh = await args.reread(job.idempotencyKey);
    const decision = decideRecoverySend({
      nowMs: args.nowMs,
      settings: fresh.settings,
      candidate: fresh.candidate,
      assignment: fresh.assignment,
      message: fresh.message,
      priorAcceptedAtMs: fresh.priorAcceptedAtMs,
      alreadySentToday: fresh.alreadySentToday + sentThisRun,
    });
    if (!decision.send) {
      const outcome = recoverySkipDisposition(decision.reason) === "stop" ? "stop" : "release";
      await args.record({
        idempotencyKey: job.idempotencyKey,
        outcome,
        providerMessageId: null,
        reason: decision.reason,
      });
      skipped += 1;
      continue;
    }
    let payload: RecoveryDeliveryPayload;
    try {
      payload = await args.buildPayload(job.idempotencyKey, {
        candidate: fresh.candidate,
        message: fresh.message,
      });
    } catch {
      await args.record({
        idempotencyKey: job.idempotencyKey,
        outcome: "release",
        providerMessageId: null,
        reason: "The message could not be prepared.",
      });
      skipped += 1;
      continue;
    }
    if (payload.from !== RECOVERY_FROM) {
      await args.record({
        idempotencyKey: job.idempotencyKey,
        outcome: "release",
        providerMessageId: null,
        reason: "The recovery sender was not the approved From address.",
      });
      skipped += 1;
      continue;
    }
    let provider: ResendSendLike | undefined;
    let threw: unknown;
    try {
      provider = await args.send(payload);
    } catch (error) {
      threw = error;
    }
    const classified = classifyResendSend(threw !== undefined ? { threw } : { result: provider });
    const mapped = mapProviderOutcome(classified.outcome, classified.errorName, classified.errorMessage);
    if (mapped === "accepted" || mapped === "uncertain") sentThisRun += 1;
    if (mapped === "accepted") accepted += 1;
    else if (mapped === "uncertain") uncertain += 1;
    else skipped += 1;
    await args.record({
      idempotencyKey: job.idempotencyKey,
      outcome: mapped,
      providerMessageId: classified.providerMessageId,
      reason: classified.errorMessage ?? mapped,
    });
  }
  return { accepted, uncertain, skipped };
}

function mapProviderOutcome(
  outcome: string,
  errorName: string | null,
  errorMessage: string | null
): "accepted" | "uncertain" | "suppressed" | "failed" {
  if (outcome === "accepted") return "accepted";
  if (outcome === "unknown" || outcome === "temporary_failure") return "uncertain";
  const blob = `${errorName ?? ""} ${errorMessage ?? ""}`.toLowerCase();
  if (blob.includes("suppress")) return "suppressed";
  return "failed";
}

export function recoveryStepsForAssignment(assignment: RecoveryAssignment): Array<1 | 2 | 3> {
  return assignment === "recovery" ? [1] : [];
}

export function planRecoveryEnrollment(args: {
  createdAtMs: number;
  enrollmentStartsAtMs: number;
  membership: RecoveryCandidate["membership"];
  countryCode: string | null;
  email: string | null;
  alreadyEnrolled: boolean;
  locallySuppressed: boolean;
  suppressionReadOk: boolean;
  clerkUserId: string;
}): { enroll: false; reason: string } | { enroll: true; assignment: RecoveryAssignment; email: string } {
  if (args.alreadyEnrolled) return { enroll: false, reason: "Already enrolled." };
  if (!args.suppressionReadOk) return { enroll: false, reason: "Marketing suppression could not be read." };
  if (args.createdAtMs < args.enrollmentStartsAtMs) {
    return { enroll: false, reason: "Account was created before the enrollment start." };
  }
  if (args.membership !== "verified_nonmember") {
    return { enroll: false, reason: "Membership is not a verified nonmember." };
  }
  const geography = recoveryGeography(args.countryCode);
  if (!geography.eligible) {
    return {
      enroll: false,
      reason: geography.basis === "restricted"
        ? "Known restricted geography is excluded."
        : "Geography is outside the initial recovery program.",
    };
  }
  if (!isReliableEmail(args.email)) return { enroll: false, reason: "The recipient address is not reliable." };
  if (args.locallySuppressed) return { enroll: false, reason: "The address is suppressed." };
  return {
    enroll: true,
    assignment: assignRecoveryGroup(args.clerkUserId, RECOVERY_ASSIGNMENT_SALT),
    email: normalizeRecoveryEmail(args.email as string),
  };
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function addressList(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function firstAddress(value: unknown): string | null {
  const addresses = addressList(value);
  if (!addresses[0]) return null;
  const match = addresses[0].match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}
