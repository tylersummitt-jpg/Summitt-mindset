import "server-only";

import { Resend } from "resend";

import type { ClerkUserResponse } from "@/lib/clerk-rest";
import { getClerkUser, listClerkUsers } from "@/lib/clerk-rest";
import { classifyResendSend, type ResendSendLike } from "@/lib/challenge-send-outcome";
import { loadNonmemberCensus, loadOneAccountMembership } from "@/lib/nonmember-census.server";
import { supabaseServer } from "@/lib/supabase-server";
import {
  combineSuppression,
  configuredInboundDomain,
  decideRecoverySend,
  RECOVERY_INBOX_TEST_CLERK_ID,
  RECOVERY_INBOX_TEST_EMAIL,
  recoveryInboxTestAllowed,
  evaluateAutomation,
  executeRecoveryBatch,
  classifyRecoveryInbound,
  explicitCountryCode,
  findReplyToken,
  interpretContactLookup,
  newRecoveryToken,
  planRecoveryEnrollment,
  RECOVERY_DELAYS_MS,
  RECOVERY_FROM,
  RECOVERY_REPLY_TO,
  recoveryHtml,
  recoveryIdempotencyKey,
  recoveryMessageCopy,
  recoveryPreview,
  recoveryReplyTo,
  recoveryStepsForAssignment,
  recoveryTokenHash,
  recoveryWaitReason,
  selectDueRecoverySteps,
  type RecoveryBatchOutcome,
  type RecoveryCandidate,
  type RecoveryDeliveryPayload,
  type RecoveryProviderEvent,
  type RecoverySettings,
} from "@/lib/recovery-engine";
import {
  attentionFrom,
  emptyRecoveryAttention,
  type RecoveryAttention,
  type RecoveryReplyView,
} from "@/lib/recovery-report";

export async function loadRecoveryAttention(now = new Date()): Promise<RecoveryAttention> {
  const settings = await readRecoverySettings();
  if (!settings) return emptyRecoveryAttention();
  const counts = await readRecoveryCounts();
  const replies = await readReplyViews(now);
  return attentionFrom(settings, counts, replies);
}

export async function runRecoveryCron(deps?: {
  now?: Date;
  send?: (payload: RecoveryDeliveryPayload) => Promise<ResendSendLike>;
}): Promise<{ sent: number; reason: string }> {
  const now = deps?.now ?? new Date();
  const settings = await readRecoverySettings();
  if (!settings) return { sent: 0, reason: "Recovery settings could not be read. Nothing is sent." };
  const gate = evaluateAutomation(settings);
  if (!gate.process) return { sent: 0, reason: gate.reason };
  if (!process.env.RESEND_API_KEY) {
    return { sent: 0, reason: "The email provider is not configured. Nothing is sent." };
  }
  const suppressed = await readSuppressedEmails();
  if (!suppressed.ok) {
    return { sent: 0, reason: "Marketing suppression could not be verified. Nothing is sent." };
  }
  await expireAbandonedClaims(now);
  await enrollEligibleAccounts(settings, suppressed.emails, now);
  const jobs = await loadDueJobs(settings, suppressed.emails, now);
  const result = await executeRecoveryBatch({
    nowMs: now.getTime(),
    settings,
    jobs,
    claim: claimMessage,
    reread: (idempotencyKey) => rereadJob(idempotencyKey, now),
    buildPayload: (idempotencyKey, fresh) => buildPayload(idempotencyKey, fresh, settings.postalAddress ?? ""),
    send: deps?.send ?? sendWithResend,
    record: (outcome) => recordOutcome(outcome, now),
  });
  return {
    sent: result.accepted,
    reason: result.accepted > 0 ? "Accepted recovery email was handed to the provider." : gate.reason,
  };
}

export async function pauseRecoverySettings(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabaseServer
    .from("recovery_settings")
    .update({
      automation_status: "paused",
      updated_at: new Date().toISOString(),
      updated_by: "tyler",
    })
    .eq("id", "default");
  if (error) return { ok: false, error: "Recovery could not be paused." };
  return { ok: true };
}

export async function markRecoveryReplyHandled(
  replyId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!replyId) return { ok: false, error: "Missing reply." };
  const { error } = await supabaseServer
    .from("recovery_replies")
    .update({ status: "handled", handled_at: new Date().toISOString() })
    .eq("id", replyId)
    .eq("status", "needs_reply");
  if (error) return { ok: false, error: "The reply could not be marked handled." };
  return { ok: true };
}

export function recoveryDeliveryRequest(args: {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
  unsubscribeUrl: string;
}) {
  return {
    from: RECOVERY_FROM,
    to: args.to,
    replyTo: RECOVERY_REPLY_TO,
    subject: args.subject,
    text: args.text,
    html: args.html,
    headers: {
      "List-Unsubscribe": `<${args.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    idempotencyKey: args.idempotencyKey,
  };
}

export function assertSendStillAllowed(settings: RecoverySettings, candidate: Parameters<typeof decideRecoverySend>[0]["candidate"], assignment: "control" | "recovery" | null, message: Parameters<typeof decideRecoverySend>[0]["message"], nowMs: number) {
  return decideRecoverySend({
    nowMs,
    settings,
    candidate,
    assignment,
    message,
    priorAcceptedAtMs: null,
    alreadySentToday: 0,
  });
}

async function readRecoverySettings(): Promise<RecoverySettings | null> {
  const { data, error } = await supabaseServer
    .from("recovery_settings")
    .select("automation_status, enrollment_starts_at, daily_send_cap, inbound_ready, suppression_check_ready, suppression_source")
    .eq("id", "default")
    .maybeSingle();
  if (error || !data) return null;
  const status = data.automation_status;
  if (status !== "off" && status !== "pilot" && status !== "active" && status !== "paused") return null;
  const enrollment = data.enrollment_starts_at ? Date.parse(data.enrollment_starts_at) : null;
  const source = typeof data.suppression_source === "string" ? data.suppression_source.trim() : "";
  const attested = data.suppression_check_ready === true && source.length > 0;
  const probe = await supabaseServer
    .from("recovery_suppressions")
    .select("id", { head: true, count: "exact" });
  const inboundDomain = configuredInboundDomain(process.env.RECOVERY_INBOUND_DOMAIN);
  return {
    status,
    sendingAuthorized: process.env.RECOVERY_SENDING_AUTHORIZED === "yes",
    inboundReady: data.inbound_ready === true
      && Boolean(process.env.RECOVERY_INBOUND_WEBHOOK_SECRET)
      && inboundDomain != null,
    suppressionCheckReady: attested,
    suppressionReadable: attested && probe.error == null,
    postalAddress: process.env.RECOVERY_POSTAL_ADDRESS?.trim() || null,
    enrollmentStartsAtMs: Number.isFinite(enrollment) ? enrollment : null,
    dailyCap: typeof data.daily_send_cap === "number" ? data.daily_send_cap : 25,
  };
}

async function readRecoveryCounts(): Promise<{
  control: number | null;
  recovery: number | null;
  attempted: number | null;
  accepted: number | null;
  delivered: number | null;
  failed: number | null;
  suppressed: number | null;
  unsubscribes: number | null;
  complaints: number | null;
  repliesNeeding: number | null;
  repliesReceived: number | null;
  matchedReplies: number | null;
  verificationHolds: number | null;
} | null> {
  const [enrollments, messages, suppressions, replies] = await Promise.all([
    supabaseServer.from("recovery_enrollments").select("assignment, status, stop_reason"),
    supabaseServer.from("recovery_messages").select("status"),
    supabaseServer.from("recovery_suppressions").select("reason"),
    supabaseServer.from("recovery_replies").select("status, classification, enrollment_id"),
  ]);
  if (enrollments.error || messages.error || suppressions.error || replies.error) return null;
  const assignment = enrollments.data ?? [];
  const messageRows = messages.data ?? [];
  const suppressionRows = suppressions.data ?? [];
  const replyRows = replies.data ?? [];
  return {
    control: assignment.filter((row) => row.assignment === "control").length,
    recovery: assignment.filter((row) => row.assignment === "recovery").length,
    attempted: messageRows.filter((row) => row.status !== "scheduled" && row.status !== "canceled").length,
    accepted: messageRows.filter((row) => row.status === "accepted" || row.status === "delivered").length,
    delivered: messageRows.filter((row) => row.status === "delivered").length,
    failed: messageRows.filter((row) => row.status === "failed" || row.status === "uncertain").length,
    suppressed: messageRows.filter((row) => row.status === "suppressed").length,
    unsubscribes: suppressionRows.filter((row) => row.reason === "unsubscribe").length,
    complaints: suppressionRows.filter((row) => row.reason === "complaint").length,
    repliesNeeding: replyRows.filter((row) => row.status === "needs_reply" && row.classification === "human" && row.enrollment_id).length,
    repliesReceived: replyRows.length,
    matchedReplies: replyRows.filter((row) => row.classification === "human" && row.enrollment_id).length,
    verificationHolds: assignment.filter((row) =>
      row.status === "active" && typeof row.stop_reason === "string" && row.stop_reason.startsWith("Waiting:")
    ).length,
  };
}

async function readReplyViews(now: Date): Promise<RecoveryReplyView[]> {
  const { data, error } = await supabaseServer
    .from("recovery_replies")
    .select("id, first_name, received_at, message_step, preview, status, classification")
    .eq("classification", "human")
    .order("received_at", { ascending: false })
    .limit(15);
  if (error || !data) return [];
  return data
    .filter((row) => row.status === "needs_reply" || row.status === "handled")
    .map((row) => ({
      id: String(row.id),
      firstName: typeof row.first_name === "string" && row.first_name.trim() ? row.first_name.trim() : "Hey!",
      receivedLabel: new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(row.received_at ?? now.toISOString())),
      stepLabel: row.message_step === 1 || row.message_step === 2 || row.message_step === 3
        ? `Email ${row.message_step}`
        : "Recovery email not matched",
      preview: typeof row.preview === "string" ? row.preview : "",
      status: row.status === "handled" ? "handled" : "needs_reply",
    }));
}

const CLAIM_MS = 10 * 60 * 1000;

async function readSuppressedEmails(): Promise<{ ok: true; emails: Set<string> } | { ok: false }> {
  const { data, error } = await supabaseServer.from("recovery_suppressions").select("email_normalized");
  if (error) return { ok: false };
  const emails = new Set<string>();
  for (const row of data ?? []) {
    if (typeof row.email_normalized === "string") emails.add(row.email_normalized);
  }
  return { ok: true, emails };
}

async function expireAbandonedClaims(now: Date): Promise<void> {
  await supabaseServer
    .from("recovery_messages")
    .update({ status: "uncertain", claim_until: null })
    .eq("status", "claimed")
    .lt("claim_until", now.toISOString());
  await supabaseServer
    .from("recovery_messages")
    .update({ status: "uncertain", claim_until: null })
    .eq("status", "claimed")
    .is("claim_until", null);
}

async function enrollEligibleAccounts(
  settings: RecoverySettings,
  suppressed: Set<string>,
  now: Date
): Promise<void> {
  const start = settings.enrollmentStartsAtMs;
  if (start == null) return;
  let census;
  try {
    census = await loadNonmemberCensus(now);
  } catch {
    return;
  }
  const users = await listRecentAccounts(start);
  if (!users) return;
  const { data: existing, error } = await supabaseServer
    .from("recovery_enrollments")
    .select("clerk_user_id");
  if (error) return;
  const enrolled = new Set((existing ?? []).map((row) => String(row.clerk_user_id)));
  for (const user of users) {
    const createdAtMs = typeof user.created_at === "number" ? user.created_at : NaN;
    const plan = planRecoveryEnrollment({
      createdAtMs,
      enrollmentStartsAtMs: start,
      membership: membershipFromCensus(user.id, census.eligibility),
      countryCode: explicitCountryCode(user.public_metadata),
      email: primaryEmail(user),
      alreadyEnrolled: enrolled.has(user.id),
      locallySuppressed: suppressed.has(primaryEmail(user) ?? ""),
      suppressionReadOk: true,
      clerkUserId: user.id,
    });
    if (!plan.enroll) continue;
    const { data: row, error: insertError } = await supabaseServer
      .from("recovery_enrollments")
      .insert({
        clerk_user_id: user.id,
        email_normalized: plan.email,
        assignment: plan.assignment,
        account_created_at: new Date(createdAtMs).toISOString(),
      })
      .select("id")
      .maybeSingle();
    if (insertError || !row?.id) continue;
    const steps = recoveryStepsForAssignment(plan.assignment);
    if (steps.length === 0) continue;
    await supabaseServer.from("recovery_messages").insert({
      enrollment_id: row.id,
      step: 1,
      status: "scheduled",
      idempotency_key: recoveryIdempotencyKey(String(row.id), 1),
      scheduled_at: new Date(createdAtMs + RECOVERY_DELAYS_MS.firstAfterCreate).toISOString(),
    });
  }
}

async function listRecentAccounts(startMs: number): Promise<ClerkUserResponse[] | null> {
  const users: ClerkUserResponse[] = [];
  try {
    for (let page = 0; page < 2; page += 1) {
      const batch = await listClerkUsers({ limit: 100, offset: page * 100, orderBy: "-created_at" });
      users.push(...batch);
      const oldest = batch[batch.length - 1]?.created_at;
      if (batch.length < 100 || (typeof oldest === "number" && oldest < startMs)) break;
    }
  } catch {
    return null;
  }
  return users;
}

function membershipFromCensus(
  clerkUserId: string,
  eligibility: Record<string, RecoveryCandidate["membership"]> | undefined
): RecoveryCandidate["membership"] {
  return eligibility?.[clerkUserId] ?? "unknown";
}

function primaryEmail(user: ClerkUserResponse): string | null {
  const list = user.email_addresses ?? [];
  const primary = list.find((entry) => entry.id === user.primary_email_address_id) ?? list[0];
  const email = primary?.email_address?.trim().toLowerCase() ?? "";
  return email.includes("@") ? email : null;
}

async function loadDueJobs(
  settings: RecoverySettings,
  suppressed: Set<string>,
  now: Date
) {
  const sentToday = await countSentToday(now);
  const { data, error } = await supabaseServer
    .from("recovery_messages")
    .select("idempotency_key, step, status, scheduled_at, enrollment_id, recovery_enrollments(clerk_user_id, email_normalized, assignment, status, account_created_at)")
    .eq("status", "scheduled")
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(settings.dailyCap);
  if (error || !data) return [];
  const jobs = [];
  for (const row of data) {
    const enrollment = oneEnrollment(row.recovery_enrollments);
    if (!enrollment || enrollment.clerk_user_id === RECOVERY_INBOX_TEST_CLERK_ID) continue;
    const step = row.step === 1 || row.step === 2 || row.step === 3 ? row.step : null;
    if (!step || typeof row.idempotency_key !== "string") continue;
    const createdAtMs = Date.parse(enrollment.account_created_at);
    jobs.push({
      idempotencyKey: row.idempotency_key,
      assignment: enrollment.assignment === "control" ? "control" as const : "recovery" as const,
      priorAcceptedAtMs: await priorAcceptedAt(String(row.enrollment_id), step),
      alreadySentToday: sentToday,
      candidate: {
        clerkUserId: enrollment.clerk_user_id,
        createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
        membership: "unknown" as const,
        countryCode: null,
        email: enrollment.email_normalized,
        firstName: null,
        suppressed: suppressed.has(enrollment.email_normalized),
        providerSuppressed: null,
        humanReplyOpen: false,
      },
      message: {
        step,
        status: "scheduled" as const,
        idempotencyKey: row.idempotency_key,
        claimHeldByOther: false,
        acceptedAtMs: null,
      },
    });
  }
  return selectDueRecoverySteps(jobs.map((job) => ({
    ...job,
    enrollmentId: job.candidate.clerkUserId,
    step: job.message.step,
    scheduledAtMs: 0,
  })), 0).map(({ enrollmentId: _enrollmentId, step: _step, scheduledAtMs: _scheduledAtMs, ...job }) => job);
}

async function countSentToday(now: Date): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const { count, error } = await supabaseServer
    .from("recovery_messages")
    .select("id", { head: true, count: "exact" })
    .in("status", ["accepted", "delivered", "uncertain"])
    .gte("claimed_at", start);
  if (error || count == null) return Number.MAX_SAFE_INTEGER;
  return count;
}

async function priorAcceptedAt(enrollmentId: string, step: 1 | 2 | 3): Promise<number | null> {
  if (step === 1) return null;
  const { data } = await supabaseServer
    .from("recovery_messages")
    .select("status, claimed_at")
    .eq("enrollment_id", enrollmentId)
    .eq("step", step - 1)
    .maybeSingle();
  if (!data || (data.status !== "accepted" && data.status !== "delivered") || !data.claimed_at) return null;
  const parsed = Date.parse(data.claimed_at);
  return Number.isFinite(parsed) ? parsed : null;
}

async function claimMessage(idempotencyKey: string): Promise<boolean> {
  const now = new Date();
  const { data, error } = await supabaseServer
    .from("recovery_messages")
    .update({
      status: "claimed",
      claimed_at: now.toISOString(),
      claim_until: new Date(now.getTime() + CLAIM_MS).toISOString(),
    })
    .eq("idempotency_key", idempotencyKey)
    .eq("status", "scheduled")
    .select("id");
  return !error && Array.isArray(data) && data.length === 1;
}

async function rereadJob(idempotencyKey: string, now: Date) {
  const settings = await readRecoverySettings();
  const closed = settings ?? {
    status: "unavailable" as const,
    sendingAuthorized: false,
    inboundReady: false,
    suppressionCheckReady: false,
    suppressionReadable: false,
    postalAddress: null,
    enrollmentStartsAtMs: null,
    dailyCap: 25,
  };
  const { data } = await supabaseServer
    .from("recovery_messages")
    .select("step, status, idempotency_key, enrollment_id, recovery_enrollments(clerk_user_id, email_normalized, assignment, status, account_created_at)")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  const enrollment = data ? oneEnrollment(data.recovery_enrollments) : null;
  const step = data?.step === 1 || data?.step === 2 || data?.step === 3 ? data.step : 1;
  const createdAtMs = enrollment ? Date.parse(enrollment.account_created_at) : 0;
  const email = enrollment?.email_normalized ?? null;
  const local = email ? await localSuppression(email) : null;
  const contact = email ? await contactSuppression(email) : "unknown";
  const membership = enrollment?.status === "active" && enrollment.clerk_user_id
    ? await freshMembership(enrollment.clerk_user_id, now)
    : "unknown";
  const profile = enrollment?.clerk_user_id ? await clerkProfile(enrollment.clerk_user_id) : { countryCode: null, firstName: null };
  const sentToday = await countSentToday(now);
  return {
    settings: closed,
    assignment: enrollment?.assignment === "control" ? "control" as const : "recovery" as const,
    priorAcceptedAtMs: data?.enrollment_id ? await priorAcceptedAt(String(data.enrollment_id), step) : null,
    alreadySentToday: sentToday,
    candidate: {
      clerkUserId: enrollment?.clerk_user_id ?? "",
      createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
      membership,
      countryCode: profile.countryCode,
      email,
      firstName: profile.firstName,
      suppressed: local === true,
      providerSuppressed: combineSuppression(local, contact),
      humanReplyOpen: data?.enrollment_id ? await humanReplyOpen(String(data.enrollment_id)) : true,
    },
    message: {
      step,
      status: messageStatus(data?.status),
      idempotencyKey,
      claimHeldByOther: false,
      acceptedAtMs: null,
    },
  };
}

async function localSuppression(email: string): Promise<boolean | null> {
  const { data, error } = await supabaseServer
    .from("recovery_suppressions")
    .select("id")
    .eq("email_normalized", email)
    .maybeSingle();
  if (error) return null;
  return Boolean(data?.id);
}

async function contactSuppression(email: string): Promise<"suppressed" | "clear" | "unknown"> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return "unknown";
  try {
    const result = await new Resend(key).contacts.get({ email });
    return interpretContactLookup({
      statusCode: result.error?.statusCode ?? null,
      unsubscribed: result.data?.unsubscribed ?? null,
      message: result.error?.message ?? null,
    });
  } catch {
    return interpretContactLookup({ threw: true });
  }
}

async function freshMembership(clerkUserId: string, now: Date): Promise<RecoveryCandidate["membership"]> {
  try {
    return await loadOneAccountMembership(clerkUserId, now);
  } catch {
    return "unavailable";
  }
}

async function clerkProfile(clerkUserId: string): Promise<{ countryCode: string | null; firstName: string | null }> {
  try {
    const user = await getClerkUser(clerkUserId);
    const first = typeof user.first_name === "string" ? user.first_name : null;
    return { countryCode: explicitCountryCode(user.public_metadata), firstName: first };
  } catch {
    return { countryCode: null, firstName: null };
  }
}

async function humanReplyOpen(enrollmentId: string): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("recovery_replies")
    .select("id")
    .eq("enrollment_id", enrollmentId)
    .eq("classification", "human")
    .limit(1);
  if (error) return true;
  return (data?.length ?? 0) > 0;
}

function messageStatus(status: unknown): "scheduled" | "claimed" | "accepted" | "delivered" | "failed" | "suppressed" | "canceled" | "uncertain" {
  if (
    status === "scheduled" || status === "claimed" || status === "accepted" || status === "delivered"
    || status === "failed" || status === "suppressed" || status === "canceled" || status === "uncertain"
  ) return status;
  return "uncertain";
}

function oneEnrollment(value: unknown): {
  clerk_user_id: string;
  email_normalized: string;
  assignment: string;
  status: string;
  account_created_at: string;
} | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  if (typeof record.clerk_user_id !== "string" || typeof record.email_normalized !== "string") return null;
  return {
    clerk_user_id: record.clerk_user_id,
    email_normalized: record.email_normalized,
    assignment: typeof record.assignment === "string" ? record.assignment : "",
    status: typeof record.status === "string" ? record.status : "",
    account_created_at: typeof record.account_created_at === "string" ? record.account_created_at : "",
  };
}

async function buildPayload(
  idempotencyKey: string,
  fresh: { candidate: RecoveryCandidate; message: { step: 1 | 2 | 3 } },
  postalAddress: string
): Promise<RecoveryDeliveryPayload> {
  if (!fresh.candidate.email) throw new Error("missing_email");
  const token = newRecoveryToken();
  const { error } = await supabaseServer
    .from("recovery_messages")
    .update({ token_hash: recoveryTokenHash(token) })
    .eq("idempotency_key", idempotencyKey);
  if (error) throw new Error("token_not_stored");
  const copy = recoveryMessageCopy({
    step: fresh.message.step,
    firstName: fresh.candidate.firstName,
    unsubscribeUrl: `https://summittmindset.com/api/recovery/unsubscribe?token=${token}`,
    postalAddress,
  });
  return {
    from: RECOVERY_FROM,
    to: fresh.candidate.email,
    replyTo: recoveryReplyTo({ token, inboundDomain: process.env.RECOVERY_INBOUND_DOMAIN ?? null }),
    subject: copy.subject,
    text: copy.text,
    html: recoveryHtml(copy.text),
    headers: {
      "List-Unsubscribe": `<https://summittmindset.com/api/recovery/unsubscribe?token=${token}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    idempotencyKey,
  };
}

async function sendWithResend(payload: RecoveryDeliveryPayload): Promise<ResendSendLike> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("missing_resend_key");
  const result = await new Resend(key).emails.send({
    from: payload.from,
    to: payload.to,
    replyTo: payload.replyTo,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    headers: payload.headers,
  }, { idempotencyKey: payload.idempotencyKey });
  return { data: result.data, error: result.error };
}

async function recordOutcome(outcome: RecoveryBatchOutcome, now: Date): Promise<void> {
  const { data } = await supabaseServer
    .from("recovery_messages")
    .select("id, enrollment_id, step")
    .eq("idempotency_key", outcome.idempotencyKey)
    .maybeSingle();
  if (!data?.id || !data.enrollment_id) return;
  if (outcome.outcome === "accepted") {
    await supabaseServer.from("recovery_messages").update({
      status: "accepted",
      provider_message_id: outcome.providerMessageId,
      claim_until: null,
      attempt_count: 1,
    }).eq("id", data.id);
    await supabaseServer.from("recovery_enrollments").update({ stop_reason: null })
      .eq("id", data.enrollment_id)
      .eq("status", "active");
    await scheduleNext(String(data.enrollment_id), data.step, now);
    return;
  }
  if (outcome.outcome === "uncertain") {
    await supabaseServer.from("recovery_messages").update({
      status: "uncertain",
      claim_until: null,
      attempt_count: 1,
    }).eq("id", data.id);
    return;
  }
  if (outcome.outcome === "failed" || outcome.outcome === "suppressed") {
    await supabaseServer.from("recovery_messages").update({
      status: outcome.outcome === "suppressed" ? "suppressed" : "failed",
      claim_until: null,
      attempt_count: 1,
    }).eq("id", data.id);
    if (outcome.outcome === "suppressed") await suppressEnrollment(String(data.enrollment_id), "provider");
    else await stopEnrollment(String(data.enrollment_id), "invalid_email");
    return;
  }
  if (outcome.outcome === "stop") {
    await stopEnrollment(String(data.enrollment_id), stopReason(outcome.reason));
    return;
  }
  const wait = recoveryWaitReason(outcome.reason);
  if (wait) {
    await supabaseServer.from("recovery_enrollments").update({ stop_reason: wait })
      .eq("id", data.enrollment_id)
      .eq("status", "active");
  }
  await supabaseServer.from("recovery_messages").update({
    status: "scheduled",
    claim_until: null,
  }).eq("id", data.id).eq("status", "claimed");
}

async function scheduleNext(enrollmentId: string, step: number, now: Date): Promise<void> {
  const next = step === 1 ? 2 : step === 2 ? 3 : null;
  if (next !== 2 && next !== 3) return;
  const wait = next === 2 ? RECOVERY_DELAYS_MS.secondAfterFirst : RECOVERY_DELAYS_MS.thirdAfterSecond;
  await supabaseServer.from("recovery_messages").insert({
    enrollment_id: enrollmentId,
    step: next,
    status: "scheduled",
    idempotency_key: recoveryIdempotencyKey(enrollmentId, next),
    scheduled_at: new Date(now.getTime() + wait).toISOString(),
  });
}

async function stopEnrollment(enrollmentId: string, reason: string): Promise<void> {
  await supabaseServer.from("recovery_enrollments").update({
    status: "stopped",
    stop_reason: reason,
  }).eq("id", enrollmentId).eq("status", "active");
  await supabaseServer.from("recovery_messages").update({
    status: "canceled",
    claim_until: null,
  }).eq("enrollment_id", enrollmentId).in("status", ["scheduled", "claimed"]);
}

async function suppressEnrollment(enrollmentId: string, reason: "bounce" | "complaint" | "provider" | "unsubscribe"): Promise<void> {
  const { data } = await supabaseServer
    .from("recovery_enrollments")
    .select("email_normalized")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (typeof data?.email_normalized === "string") await insertSuppression(data.email_normalized, reason);
  await stopEnrollment(enrollmentId, reason === "unsubscribe" ? "unsubscribe" : reason === "complaint" ? "complaint" : reason === "bounce" ? "bounce" : "suppressed");
}

async function insertSuppression(email: string, reason: "bounce" | "complaint" | "provider" | "unsubscribe", tokenHash?: string): Promise<void> {
  const { error } = await supabaseServer.from("recovery_suppressions").insert({
    email_normalized: email,
    reason,
    token_hash: tokenHash ?? null,
  });
  if (error && error.code !== "23505") {
    console.warn("[recovery] suppression was not stored", { reason });
  }
}

function stopReason(reason: string): string {
  if (reason.includes("no longer exists")) return "account_missing";
  if (reason.includes("current member") || reason.includes("verified trial")) return "member";
  if (reason.includes("former")) return "former";
  if (reason.includes("unknown")) return "unknown_membership";
  if (reason.includes("Geography")) return "geography";
  if (reason.includes("suppressed")) return "suppressed";
  if (reason.includes("reply")) return "reply";
  if (reason.includes("not reliable")) return "invalid_email";
  if (reason.includes("before the enrollment")) return "before_enrollment";
  return "unknown_membership";
}

export async function applyRecoveryWebhook(
  event: RecoveryProviderEvent,
  received?: {
    text: string | null;
    html: string | null;
    headers: Record<string, string> | null;
    messageId: string | null;
  }
): Promise<{ ok: true; classification: string | null; forward: boolean } | { ok: false; error: string }> {
  if (event.kind === "ignore" || event.kind === "soft_bounce") {
    if (event.kind === "soft_bounce" && event.providerMessageId) {
      await supabaseServer.from("recovery_messages").update({ status: "failed" })
        .eq("provider_message_id", event.providerMessageId)
        .in("status", ["accepted", "claimed"]);
    }
    return { ok: true, classification: null, forward: false };
  }
  if (event.kind === "delivered") {
    await supabaseServer.from("recovery_messages").update({ status: "delivered" })
      .eq("provider_message_id", event.providerMessageId)
      .in("status", ["accepted", "claimed"]);
    return { ok: true, classification: null, forward: false };
  }
  if (event.kind === "suppress") {
    if (event.email) await insertSuppression(event.email, event.reason);
    if (event.providerMessageId) {
      const { data } = await supabaseServer.from("recovery_messages")
        .select("enrollment_id")
        .eq("provider_message_id", event.providerMessageId)
        .maybeSingle();
      if (data?.enrollment_id) {
        await supabaseServer.from("recovery_messages").update({ status: "suppressed" })
          .eq("provider_message_id", event.providerMessageId);
        await suppressEnrollment(String(data.enrollment_id), event.reason);
      }
    }
    return { ok: true, classification: null, forward: false };
  }
  const headers = received?.headers ?? {};
  const headerText = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
  const token = findReplyToken([
    ...event.to,
    ...headerText,
    received?.text ?? "",
    received?.html ?? "",
  ]);
  const inReplyTo = headerValue(headers, "in-reply-to") || received?.messageId || null;
  const matched = await matchReply(token, inReplyTo, event.messageId);
  const autoSubmitted = headerValue(headers, "auto-submitted");
  const classification = classifyRecoveryInbound({
    from: event.from,
    subject: event.subject,
    autoSubmitted,
    inReplyTo,
    knownMessageIds: matched?.matchedOn ? [matched.matchedOn] : [],
    tokenMatched: matched?.via === "token",
  });
  const preview = recoveryPreview(received?.text || received?.html || event.subject || "");
  const { error } = await supabaseServer.from("recovery_replies").insert({
    provider_event_id: event.emailId,
    enrollment_id: matched?.enrollmentId ?? null,
    message_step: matched?.step ?? null,
    received_at: new Date().toISOString(),
    first_name: matched?.firstName ?? null,
    preview,
    classification,
    status: classification === "human" ? "needs_reply" : "ignored",
    in_reply_to: inReplyTo,
  });
  if (error && error.code !== "23505") return { ok: false, error: "Reply was not stored." };
  if (classification === "human" && matched?.enrollmentId) {
    await stopEnrollment(matched.enrollmentId, "reply");
  }
  if (classification === "bounce" && matched?.enrollmentId) {
    await suppressEnrollment(matched.enrollmentId, "bounce");
  }
  return { ok: true, classification, forward: classification === "human" };
}

async function matchReply(token: string | null, inReplyTo: string | null, messageId: string | null): Promise<{
  enrollmentId: string;
  step: number | null;
  matchedOn: string;
  via: "token" | "header";
  firstName: string | null;
} | null> {
  if (token) {
    const { data } = await supabaseServer.from("recovery_messages")
      .select("enrollment_id, step")
      .eq("token_hash", recoveryTokenHash(token))
      .maybeSingle();
    if (data?.enrollment_id) {
      return {
        enrollmentId: String(data.enrollment_id),
        step: typeof data.step === "number" ? data.step : null,
        matchedOn: token,
        via: "token",
        firstName: null,
      };
    }
  }
  const candidates = [inReplyTo, messageId].filter((value): value is string => Boolean(value));
  for (const id of candidates) {
    const { data } = await supabaseServer.from("recovery_messages")
      .select("enrollment_id, step, provider_message_id")
      .eq("provider_message_id", id)
      .maybeSingle();
    if (data?.enrollment_id) {
      return {
        enrollmentId: String(data.enrollment_id),
        step: typeof data.step === "number" ? data.step : null,
        matchedOn: id,
        via: "header",
        firstName: null,
      };
    }
  }
  return null;
}

function headerValue(headers: Record<string, string>, name: string): string | null {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return found?.[1]?.trim() || null;
}

const INBOX_TEST_STEP_ONE = "recovery:inbox-test:1";

export async function sendRecoveryInboxTest(): Promise<{ ok: true } | { ok: false; error: string }> {
  const settings = await readRecoverySettings();
  const allowed = recoveryInboxTestAllowed({
    status: settings?.status ?? "unavailable",
    sendingAuthorized: process.env.RECOVERY_SENDING_AUTHORIZED === "yes",
    recipient: RECOVERY_INBOX_TEST_EMAIL,
  });
  if (!allowed.ok) return { ok: false, error: allowed.reason };
  if (!configuredInboundDomain(process.env.RECOVERY_INBOUND_DOMAIN) || !process.env.RECOVERY_INBOUND_WEBHOOK_SECRET) {
    return { ok: false, error: "The recovery reply route is not configured." };
  }
  const postal = process.env.RECOVERY_POSTAL_ADDRESS?.trim() ?? "";
  if (!postal) return { ok: false, error: "The physical mailing address is not recorded." };

  const { data: existing } = await supabaseServer
    .from("recovery_messages")
    .select("status")
    .eq("idempotency_key", INBOX_TEST_STEP_ONE)
    .maybeSingle();
  if (existing && !["scheduled", "failed"].includes(String(existing.status))) {
    return { ok: false, error: "The inbox test was already sent." };
  }

  const { data: enrollment } = await supabaseServer
    .from("recovery_enrollments")
    .select("id")
    .eq("clerk_user_id", RECOVERY_INBOX_TEST_CLERK_ID)
    .maybeSingle();
  let enrollmentId = enrollment?.id ? String(enrollment.id) : "";
  if (!enrollmentId) {
    const inserted = await supabaseServer
      .from("recovery_enrollments")
      .insert({
        clerk_user_id: RECOVERY_INBOX_TEST_CLERK_ID,
        email_normalized: RECOVERY_INBOX_TEST_EMAIL,
        assignment: "recovery",
        account_created_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();
    if (inserted.error || !inserted.data?.id) return { ok: false, error: "The inbox test could not be prepared." };
    enrollmentId = String(inserted.data.id);
  }
  if (!existing) {
    const stepOne = await supabaseServer.from("recovery_messages").insert({
      enrollment_id: enrollmentId,
      step: 1,
      status: "scheduled",
      idempotency_key: INBOX_TEST_STEP_ONE,
      scheduled_at: new Date().toISOString(),
    });
    if (stepOne.error) return { ok: false, error: "The inbox test could not be prepared." };
  }

  const token = newRecoveryToken();
  const claimed = await supabaseServer
    .from("recovery_messages")
    .update({
      token_hash: recoveryTokenHash(token),
      status: "claimed",
      claimed_at: new Date().toISOString(),
    })
    .eq("idempotency_key", INBOX_TEST_STEP_ONE)
    .in("status", ["scheduled", "failed"])
    .select("id");
  if (claimed.error || !Array.isArray(claimed.data) || claimed.data.length !== 1) {
    return { ok: false, error: "The inbox test could not be claimed." };
  }
  const copy = recoveryMessageCopy({
    step: 1,
    firstName: null,
    unsubscribeUrl: `https://summittmindset.com/api/recovery/unsubscribe?token=${token}`,
    postalAddress: postal,
  });
  let provider: ResendSendLike | undefined;
  let threw: unknown;
  try {
    provider = await sendWithResend({
      from: RECOVERY_FROM,
      to: RECOVERY_INBOX_TEST_EMAIL,
      replyTo: recoveryReplyTo({ token, inboundDomain: process.env.RECOVERY_INBOUND_DOMAIN ?? null }),
      subject: copy.subject,
      text: copy.text,
      html: recoveryHtml(copy.text),
      headers: {
        "List-Unsubscribe": `<https://summittmindset.com/api/recovery/unsubscribe?token=${token}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      idempotencyKey: INBOX_TEST_STEP_ONE,
    });
  } catch (error) {
    threw = error;
  }
  const classified = classifyResendSend(threw !== undefined ? { threw } : { result: provider });
  const accepted = classified.outcome === "accepted";
  await supabaseServer.from("recovery_messages").update({
    status: accepted ? "accepted" : "uncertain",
    provider_message_id: classified.providerMessageId,
    claim_until: null,
    attempt_count: 1,
  }).eq("idempotency_key", INBOX_TEST_STEP_ONE);
  if (!accepted) return { ok: false, error: "The inbox test did not get a provider acceptance." };
  return { ok: true };
}
