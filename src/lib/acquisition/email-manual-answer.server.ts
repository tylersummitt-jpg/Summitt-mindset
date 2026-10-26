import "server-only";

import { getClerkUserOrNull } from "@/lib/clerk-rest";
import { parseAcquisitionOffers, resolveCampaignPromise } from "@/lib/acquisition/assets";
import {
  EMAIL_ANSWER_HOLD_STATUSES,
  EMAIL_ANSWER_NOTIFY_CAP,
  EMAIL_ANSWER_REPAIR_LIMIT,
  blockedInboundIds,
  manualAnswersMissingFrom,
  missingInformationReason,
  notificationPlan,
  runApprovedEmailAnswer,
  stuckManualSendRepair,
  type ApprovedEmailDeps,
  type ApprovedEmailSnapshot,
  type EmailAnswerNotice,
} from "@/lib/acquisition/email-manual-answer";
import { reconcileInstantlyReply, replyRowFromAttempt } from "@/lib/acquisition/instantly-reply";
import { ACQUISITION_CLAIM_MS } from "@/lib/acquisition/model";
import { notifyAcquisitionEmailAnswer } from "@/lib/acquisition/notify-email-answer";
import { supabaseServer } from "@/lib/supabase-server";

const ABSENT: ApprovedEmailSnapshot["person"] = {
  found: false,
  lifecycle: "",
  suppressed: null,
  clerkSubscribed: false,
};

type Candidate = {
  id: string;
  personId: string;
  journeyId: string | null;
  campaignId: string | null;
  outcome: string | null;
  reason: string | null;
  processingError: string | null;
};

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

async function loadCandidates(): Promise<Candidate[]> {
  const { data, error } = await supabaseServer
    .from("acquisition_email_answer_gaps")
    .select("id, person_id, journey_id, campaign_id, ai_outcome, ai_reason, processing_error")
    .order("created_at", { ascending: true })
    .limit(EMAIL_ANSWER_REPAIR_LIMIT);
  if (error) throw new Error(error.message);
  const parsed = (data ?? []).flatMap((row) => {
    const id = asText(row.id);
    const personId = asText(row.person_id);
    if (!id || !personId) return [];
    return [{
      id,
      personId,
      journeyId: asText(row.journey_id),
      campaignId: asText(row.campaign_id),
      outcome: asText(row.ai_outcome),
      reason: asText(row.ai_reason),
      processingError: asText(row.processing_error),
    }];
  });
  const missing = new Set(manualAnswersMissingFrom({
    messages: parsed.map((row) => ({ id: row.id, outcome: row.outcome, processingError: row.processingError })),
    coveredInboundIds: new Set(),
  }));
  return parsed.filter((row) => missing.has(row.id));
}

async function repairStuckEmailAnswers(now: Date): Promise<void> {
  const { data, error } = await supabaseServer
    .from("acquisition_email_answers")
    .select("id, status, claim_until, inbound_message_id")
    .in("status", ["sending", "uncertain"])
    .order("updated_at", { ascending: true })
    .limit(20);
  if (error) throw new Error(error.message);
  const requests = (data ?? []).flatMap((row) => {
    const id = asText(row.id);
    const inboundMessageId = asText(row.inbound_message_id);
    if (!id || !inboundMessageId || typeof row.status !== "string") return [];
    return [{
      id,
      status: row.status,
      claimUntil: asText(row.claim_until),
      inboundMessageId,
    }];
  });
  if (requests.length === 0) return;
  const { data: outboundRows, error: outboundError } = await supabaseServer
    .from("acquisition_messages")
    .select("provider_message_id, processing_status, provider_response_id, processing_error, claim_until")
    .eq("provider", "instantly")
    .eq("direction", "outbound")
    .in("provider_message_id", requests.map((row) => `outbound:${row.inboundMessageId}`));
  if (outboundError) throw new Error(outboundError.message);
  const outboundByKey = new Map((outboundRows ?? []).flatMap((row) => typeof row.provider_message_id === "string" ? [[row.provider_message_id, row] as const] : []));
  let acted = 0;
  for (const row of requests) {
    if (acted >= EMAIL_ANSWER_REPAIR_LIMIT) break;
    const outboundRow = outboundByKey.get(`outbound:${row.inboundMessageId}`);
    const decision = stuckManualSendRepair({
      requestStatus: row.status,
      claimUntil: row.claimUntil,
      outbound: outboundRow ? {
        status: typeof outboundRow.processing_status === "string" ? outboundRow.processing_status : "",
        providerMessageId: asText(outboundRow.provider_response_id),
        claimUntil: asText(outboundRow.claim_until),
        error: asText(outboundRow.processing_error),
      } : null,
      now,
    });
    if (decision.action === "leave") continue;
    acted += 1;
    if (decision.action === "reopen") {
      await supabaseServer.from("acquisition_email_answers").update({
        status: "open",
        claim_until: null,
        send_error: null,
        updated_at: now.toISOString(),
      }).eq("id", row.id).eq("status", "sending").or(`claim_until.is.null,claim_until.lt.${now.toISOString()}`);
      continue;
    }
    if (decision.action === "mark_sent") {
      await supabaseServer.from("acquisition_email_answers").update({
        status: "sent",
        provider_response_id: decision.providerMessageId,
        send_error: null,
        claim_until: null,
        resolved_at: now.toISOString(),
        updated_at: now.toISOString(),
      }).eq("id", row.id).in("status", ["sending", "uncertain"]);
      continue;
    }
    if (decision.action === "mark_terminal") {
      await supabaseServer.from("acquisition_email_answers").update({
        status: decision.status,
        send_error: decision.reason,
        claim_until: null,
        resolved_at: decision.status === "blocked" ? now.toISOString() : null,
        updated_at: now.toISOString(),
      }).eq("id", row.id).in("status", ["sending", "uncertain", "open"]);
      continue;
    }
    if (decision.action === "hold_uncertain") {
      await supabaseServer.from("acquisition_messages").update({
        processing_status: "uncertain",
        processing_error: "no_provider_id",
        claim_until: null,
        updated_at: now.toISOString(),
      }).eq("provider", "instantly").eq("direction", "outbound").eq("provider_message_id", `outbound:${row.inboundMessageId}`).eq("processing_status", "processing");
      await supabaseServer.from("acquisition_email_answers").update({
        status: "uncertain",
        send_error: "no_provider_id",
        claim_until: null,
        updated_at: now.toISOString(),
      }).eq("id", row.id).in("status", ["sending", "open"]);
      continue;
    }
    const apiKey = process.env.INSTANTLY_API_KEY?.trim() || null;
    if (!apiKey) {
      console.error("[acquisition] email answer provider read skipped", { reason: "missing_credentials" });
      continue;
    }
    const attempt = await reconcileInstantlyReply({ apiKey, providerMessageId: decision.providerMessageId });
    if (attempt.state === "accepted" || attempt.state === "uncertain") {
      await supabaseServer.from("acquisition_messages").update({
        ...replyRowFromAttempt(attempt),
        claim_until: null,
        updated_at: now.toISOString(),
      }).eq("provider", "instantly").eq("direction", "outbound").eq("provider_message_id", `outbound:${row.inboundMessageId}`).eq("processing_status", decision.outboundStatus);
    }
    if (attempt.state === "accepted") {
      await supabaseServer.from("acquisition_email_answers").update({
        status: "sent",
        provider_response_id: attempt.providerMessageId,
        send_error: null,
        claim_until: null,
        resolved_at: now.toISOString(),
        updated_at: now.toISOString(),
      }).eq("id", row.id).in("status", ["sending", "uncertain"]);
    } else if (attempt.state === "uncertain") {
      await supabaseServer.from("acquisition_email_answers").update({
        status: "uncertain",
        send_error: attempt.reason.slice(0, 80),
        claim_until: null,
        updated_at: now.toISOString(),
      }).eq("id", row.id).in("status", ["sending", "uncertain", "open"]);
    } else {
      console.error("[acquisition] email answer provider read was not confirmed", { reason: attempt.reason });
    }
  }
}

export async function reconcileAcquisitionEmailAnswers(now = new Date()): Promise<{ created: number; notified: number }> {
  try {
    await repairStuckEmailAnswers(now);
  } catch (err) {
    console.error("[acquisition] email answer send repair unavailable", {
      reason: err instanceof Error ? err.message : "send_repair_unavailable",
    });
  }
  const candidates = await loadCandidates();
  let created = 0;
  for (const row of candidates) {
    const { error } = await supabaseServer.from("acquisition_email_answers").insert({
      inbound_message_id: row.id,
      person_id: row.personId,
      journey_id: row.journeyId,
      campaign_id: row.campaignId,
      missing_reason: missingInformationReason({
        outcome: row.outcome,
        reason: row.reason,
        draftRejected: row.processingError === "draft_rejected",
      }),
      status: "open",
      notification_status: "pending",
    });
    if (!error) {
      created += 1;
      continue;
    }
    const code = (error as { code?: string }).code ?? "insert_failed";
    if (code === "23505") continue;
    console.error("[acquisition] email manual answer was not stored", { id: row.id, reason: code });
  }
  const notified = await notifyOpenEmailAnswers(now);
  return { created, notified };
}

async function notifyOpenEmailAnswers(now: Date): Promise<number> {
  const { data, error } = await supabaseServer
    .from("acquisition_email_answers")
    .select("id, status, notification_status, notification_attempts, updated_at, missing_reason")
    .eq("status", "open")
    .limit(10);
  if (error) throw new Error(error.message);
  let sent = 0;
  for (const row of data ?? []) {
    const notice: EmailAnswerNotice = {
      status: typeof row.status === "string" ? row.status : "",
      notificationStatus: typeof row.notification_status === "string" ? row.notification_status : "",
      attempts: typeof row.notification_attempts === "number" ? row.notification_attempts : 0,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    };
    if (notificationPlan(notice, now) !== "send") continue;
    if (typeof row.id !== "string") continue;
    const attempts = notice.attempts + (notice.notificationStatus === "pending" && notice.attempts >= EMAIL_ANSWER_NOTIFY_CAP ? 0 : 1);
    const { data: claimed } = await supabaseServer
      .from("acquisition_email_answers")
      .update({
        notification_status: "notifying",
        notification_attempts: Math.min(EMAIL_ANSWER_NOTIFY_CAP, Math.max(notice.attempts, attempts)),
        notification_error: null,
        updated_at: now.toISOString(),
      })
      .eq("id", row.id)
      .eq("notification_status", notice.notificationStatus)
      .eq("notification_attempts", notice.attempts)
      .lt("notification_attempts", EMAIL_ANSWER_NOTIFY_CAP)
      .select("id")
      .maybeSingle();
    if (!claimed?.id) continue;
    const result = await notifyAcquisitionEmailAnswer({
      requestId: row.id,
      missingReason: typeof row.missing_reason === "string" ? row.missing_reason : "",
    });
    if (result.ok) {
      await supabaseServer.from("acquisition_email_answers").update({
        notification_status: "sent",
        notified_at: now.toISOString(),
        notification_error: null,
        updated_at: now.toISOString(),
      }).eq("id", row.id).eq("notification_status", "notifying");
      sent += 1;
    } else {
      await supabaseServer.from("acquisition_email_answers").update({
        notification_status: "failed",
        notification_error: result.reason.slice(0, 240),
        updated_at: now.toISOString(),
      }).eq("id", row.id).eq("notification_status", "notifying");
    }
  }
  return sent;
}

export async function inboundIdsBlockedByEmailAnswers(ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data: messages, error } = await supabaseServer
    .from("acquisition_messages")
    .select("id, journey_id")
    .in("id", [...ids]);
  if (error) throw new Error(error.message);
  const parsed = (messages ?? []).flatMap((row) => typeof row.id === "string" ? [{
    id: row.id,
    journeyId: asText(row.journey_id),
  }] : []);
  const journeyIds = [...new Set(parsed.flatMap((row) => row.journeyId ? [row.journeyId] : []))];
  let answerQuery = supabaseServer
    .from("acquisition_email_answers")
    .select("inbound_message_id, journey_id, status")
    .in("status", [...EMAIL_ANSWER_HOLD_STATUSES]);
  answerQuery = journeyIds.length > 0
    ? answerQuery.or(`inbound_message_id.in.(${ids.join(",")}),journey_id.in.(${journeyIds.join(",")})`)
    : answerQuery.in("inbound_message_id", [...ids]);
  const { data: answers, error: answerError } = await answerQuery;
  if (answerError) throw new Error(answerError.message);
  return blockedInboundIds({
    messages: parsed,
    answers: (answers ?? []).flatMap((row) => typeof row.inbound_message_id === "string" && typeof row.status === "string" ? [{
      inboundMessageId: row.inbound_message_id,
      journeyId: asText(row.journey_id),
      status: row.status,
    }] : []),
  });
}

export type EmailAnswerCard = {
  id: string;
  inboundMessageId: string;
  campaignId: string | null;
  offerLabel: string | null;
  question: string;
  history: Array<{ direction: string; body: string; occurredAt: string }>;
  missingReason: string;
  status: string;
  createdAt: string;
  ageHours: number;
  notificationStatus: string;
  notificationError: string | null;
  sendError: string | null;
  approvedBody: string;
  hasReplyTarget: boolean;
  hasSender: boolean;
};

export async function listEmailAnswers(): Promise<EmailAnswerCard[]> {
  const { data, error } = await supabaseServer
    .from("acquisition_email_answers")
    .select("id, inbound_message_id, person_id, journey_id, campaign_id, missing_reason, status, created_at, notification_status, notification_error, send_error, approved_body")
    .in("status", ["open", "sending", "uncertain", "failed", "blocked"])
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const inboundIds = rows.flatMap((row) => typeof row.inbound_message_id === "string" ? [row.inbound_message_id] : []);
  const { data: messages } = inboundIds.length
    ? await supabaseServer.from("acquisition_messages").select("id, journey_id, subject, body_text, reply_to_provider_message_id, sender_account, occurred_at, direction").in("id", inboundIds)
    : { data: [] };
  const byId = new Map((messages ?? []).map((row) => [row.id, row]));
  const journeyIds = [...new Set(rows.flatMap((row) => typeof row.journey_id === "string" ? [row.journey_id] : []))];
  const { data: history } = journeyIds.length
    ? await supabaseServer.from("acquisition_messages").select("id, journey_id, direction, body_text, occurred_at").in("journey_id", journeyIds).order("occurred_at", { ascending: true }).limit(80)
    : { data: [] };
  const settings = await supabaseServer.from("acquisition_settings").select("campaign_assets, offers").eq("id", "default").maybeSingle();
  const offers = parseAcquisitionOffers(settings.data?.offers);
  const assets = settings.data?.campaign_assets && typeof settings.data.campaign_assets === "object"
    ? settings.data.campaign_assets as Record<string, unknown>
    : {};
  const now = Date.now();
  return rows.flatMap((row) => {
    if (typeof row.id !== "string" || typeof row.inbound_message_id !== "string") return [];
    const inbound = byId.get(row.inbound_message_id);
    const campaignId = asText(row.campaign_id);
    const promise = resolveCampaignPromise({
      campaignValue: campaignId && Object.prototype.hasOwnProperty.call(assets, campaignId) ? assets[campaignId] : null,
      offers,
    });
    const createdAt = typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString();
    const thread = (history ?? []).filter((item) => item.journey_id === row.journey_id && item.id !== row.inbound_message_id).slice(-8);
    return [{
      id: row.id,
      inboundMessageId: row.inbound_message_id,
      campaignId,
      offerLabel: promise?.label ?? (promise ? promise.assets.join(", ") : null),
      question: typeof inbound?.body_text === "string" ? inbound.body_text : "",
      history: thread.flatMap((item) => typeof item.body_text === "string" ? [{
        direction: typeof item.direction === "string" ? item.direction : "inbound",
        body: item.body_text,
        occurredAt: typeof item.occurred_at === "string" ? item.occurred_at : createdAt,
      }] : []),
      missingReason: typeof row.missing_reason === "string" ? row.missing_reason : "",
      status: typeof row.status === "string" ? row.status : "open",
      createdAt,
      ageHours: Math.max(0, Math.round((now - Date.parse(createdAt)) / 36e5)),
      notificationStatus: typeof row.notification_status === "string" ? row.notification_status : "pending",
      notificationError: asText(row.notification_error),
      sendError: asText(row.send_error),
      approvedBody: typeof row.approved_body === "string" ? row.approved_body : "",
      hasReplyTarget: typeof inbound?.reply_to_provider_message_id === "string",
      hasSender: typeof inbound?.sender_account === "string",
    }];
  });
}

export async function saveEmailAnswer(args: { requestId: string; approvedBody: string }): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const id = args.requestId.trim();
  if (!id) return { ok: false, status: 400, error: "request required" };
  const { data, error } = await supabaseServer
    .from("acquisition_email_answers")
    .update({ approved_body: args.approvedBody, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "save_failed" };
  if (!data?.id) return { ok: false, status: 409, error: "This question is no longer open." };
  return { ok: true };
}

async function readApprovedSnapshot(requestId: string): Promise<ApprovedEmailSnapshot> {
  const { data: request, error } = await supabaseServer
    .from("acquisition_email_answers")
    .select("id, status, approved_body, inbound_message_id, person_id, journey_id, claim_until")
    .eq("id", requestId)
    .maybeSingle();
  if (error || !request || typeof request.inbound_message_id !== "string" || typeof request.person_id !== "string") {
    return { readable: false, request: null, inbound: null, person: ABSENT, outbound: null };
  }
  const { data: inbound, error: inboundError } = await supabaseServer
    .from("acquisition_messages")
    .select("reply_to_provider_message_id, sender_account, subject, lead_email, campaign_id")
    .eq("id", request.inbound_message_id)
    .eq("direction", "inbound")
    .maybeSingle();
  if (inboundError || !inbound) return { readable: false, request: null, inbound: null, person: ABSENT, outbound: null };
  const localId = `outbound:${request.inbound_message_id}`;
  const { data: outbound, error: outboundError } = await supabaseServer
    .from("acquisition_messages")
    .select("processing_status, provider_response_id, processing_error, claim_until")
    .eq("provider", "instantly")
    .eq("direction", "outbound")
    .eq("provider_message_id", localId)
    .maybeSingle();
  if (outboundError) return { readable: false, request: null, inbound: null, person: ABSENT, outbound: null };
  const { data: person, error: personError } = await supabaseServer
    .from("acquisition_people")
    .select("lifecycle_state, email_normalized, clerk_user_id")
    .eq("id", request.person_id)
    .maybeSingle();
  if (personError) return { readable: false, request: null, inbound: null, person: ABSENT, outbound: null };
  const email = asText(person?.email_normalized) ?? "";
  let suppressed: boolean | null = null;
  if (email) {
    const suppression = await supabaseServer.from("recovery_suppressions").select("id").eq("email_normalized", email).maybeSingle();
    if (suppression.error) return { readable: false, request: null, inbound: null, person: ABSENT, outbound: null };
    suppressed = Boolean(suppression.data?.id);
  }
  let clerkSubscribed = false;
  const clerkUserId = asText(person?.clerk_user_id);
  if (clerkUserId) {
    try {
      const user = await getClerkUserOrNull(clerkUserId);
      clerkSubscribed = user?.public_metadata?.summittSubscribed === true;
    } catch {
      clerkSubscribed = true;
    }
  }
  return {
    readable: true,
    request: {
      id: request.id,
      status: typeof request.status === "string" ? request.status : "",
      approvedBody: typeof request.approved_body === "string" ? request.approved_body : null,
      inboundMessageId: request.inbound_message_id,
      personId: request.person_id,
      journeyId: asText(request.journey_id),
      claimUntil: asText(request.claim_until),
    },
    inbound: {
      replyToProviderMessageId: asText(inbound.reply_to_provider_message_id),
      senderAccount: asText(inbound.sender_account),
      subject: asText(inbound.subject),
      leadEmail: asText(inbound.lead_email),
      campaignId: asText(inbound.campaign_id),
    },
    person: {
      found: Boolean(person),
      lifecycle: typeof person?.lifecycle_state === "string" ? person.lifecycle_state : "",
      suppressed,
      clerkSubscribed,
    },
    outbound: outbound ? {
      status: typeof outbound.processing_status === "string" ? outbound.processing_status : "",
      providerMessageId: asText(outbound.provider_response_id),
      claimUntil: asText(outbound.claim_until),
      error: asText(outbound.processing_error),
    } : null,
  };
}

export async function sendApprovedEmailAnswer(requestId: string): Promise<{ ok: true; providerMessageId: string | null } | { ok: false; status: number; error: string }> {
  const snapshot = await readApprovedSnapshot(requestId);
  const request = snapshot.request;
  if (!request) return { ok: false, status: 404, error: "Request not found." };
  const deps: ApprovedEmailDeps = {
    now: new Date(),
    apiKey: process.env.INSTANTLY_API_KEY?.trim() || null,
    read: () => readApprovedSnapshot(requestId),
    mark: async (status, patch) => {
      const resolved = status === "sent" || status === "blocked" || status === "cancelled" ? new Date().toISOString() : null;
      const update: Record<string, string | null> = {
        status,
        claim_until: null,
        updated_at: new Date().toISOString(),
      };
      if ("send_error" in patch) update.send_error = patch.send_error;
      if (patch.provider_response_id) update.provider_response_id = patch.provider_response_id;
      if (patch.approved_subject) update.approved_subject = patch.approved_subject;
      if (resolved) update.resolved_at = resolved;
      const { data, error } = await supabaseServer.from("acquisition_email_answers").update(update).eq("id", requestId).select("id").maybeSingle();
      return !error && Boolean(data?.id);
    },
    claim: async () => {
      const now = new Date();
      const patch = {
        status: "sending",
        claim_until: new Date(now.getTime() + ACQUISITION_CLAIM_MS).toISOString(),
        updated_at: now.toISOString(),
      };
      const open = await supabaseServer.from("acquisition_email_answers").update(patch).eq("id", requestId).eq("status", "open").select("id").maybeSingle();
      if (open.error) return "error";
      if (open.data?.id) return "claimed";
      const expired = await supabaseServer
        .from("acquisition_email_answers")
        .update(patch)
        .eq("id", requestId)
        .eq("status", "sending")
        .or(`claim_until.is.null,claim_until.lt.${now.toISOString()}`)
        .select("id")
        .maybeSingle();
      if (expired.error) return "error";
      return expired.data?.id ? "claimed" : "lost";
    },
    insertOutbound: async (guard) => {
      const now = new Date();
      const { error } = await supabaseServer.from("acquisition_messages").insert({
        person_id: request.personId,
        journey_id: request.journeyId,
        campaign_id: snapshot.inbound?.campaignId ?? null,
        direction: "outbound",
        provider: "instantly",
        provider_message_id: `outbound:${request.inboundMessageId}`,
        reply_to_provider_message_id: guard.replyTo,
        sender_account: guard.sender,
        lead_email: guard.leadEmail,
        subject: guard.subject,
        body_text: guard.body,
        occurred_at: now.toISOString(),
        processing_status: "processing",
        claim_until: new Date(now.getTime() + ACQUISITION_CLAIM_MS).toISOString(),
        attempt_count: 1,
      });
      if (!error) return "inserted";
      return (error as { code?: string }).code === "23505" ? "duplicate" : "error";
    },
    recordOutbound: async (patch, expectedStatus) => {
      const { data, error } = await supabaseServer.from("acquisition_messages").update({
        ...patch,
        claim_until: null,
        updated_at: new Date().toISOString(),
      }).eq("provider", "instantly").eq("direction", "outbound").eq("provider_message_id", `outbound:${request.inboundMessageId}`).eq("processing_status", expectedStatus).select("id").maybeSingle();
      return !error && Boolean(data?.id);
    },
  };
  const result = await runApprovedEmailAnswer(deps);
  if (result.state === "accepted") return { ok: true, providerMessageId: result.providerMessageId };
  const status = result.state === "blocked" ? 409 : result.state === "processing" ? 409 : 422;
  return { ok: false, status, error: result.reason ?? result.state };
}
