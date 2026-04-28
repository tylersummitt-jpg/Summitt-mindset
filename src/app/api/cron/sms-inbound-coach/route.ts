import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import { resolveUserTimezone } from "@/lib/timezone";
import { sendSMSChunked, isTwilioReady } from "@/lib/twilio";
import {
  activateAdaptiveOverlayFromProposal,
  clearStaleAdaptiveContractColumns,
  declineAdaptiveProposal,
  getEffectiveCoachingAsk,
  isV2PendingProposalValid,
  resolvePendingProposalContractKind,
} from "@/lib/v2-adaptive-contract";
import { loadV2CoachingMemoryForPrompt, recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import { recordV2SendTimeProfileInboundEngagement } from "@/lib/v2-send-time-profile";
import {
  buildBlockerAckSms,
  buildV2ContractOverlayNoAckSms,
  buildV2ContractOverlayYesAckSms,
  buildV2InboundReplySms,
  classifyV2InboundReply,
  isStrongV2YesNoOutcome,
  v2UserReplyIdempotencyKey,
} from "@/lib/v2-sms-accountability";
import {
  buildBlockerAckAiPayload,
  tryGenerateV2BlockerAckMessage,
  V2_BLOCKER_ACK_AI_MODEL,
  V2_BLOCKER_ACK_PROMPT_VERSION,
} from "@/lib/v2-ai-blocker-ack";
import {
  buildUserReplyAiPayload,
  strategyForInboundEventType,
  tryGenerateV2ContractConsentAckMessage,
  tryGenerateV2InboundMessage,
  V2_INBOUND_AI_MODEL,
  V2_INBOUND_AI_PROMPT_VERSION,
} from "@/lib/v2-ai-inbound";
import { deriveV2SilenceContext, parseLatestCheckSentNextMoveType } from "@/lib/v2-ai-outbound";
import {
  bumpIdentityRefreshCycleAfterRefreshStillReply,
  computeIdentityReferenceAllowedInbound,
  isIdentityRefreshDue,
} from "@/lib/v2-identity-anchor";
import {
  buildGuidedResolutionChangeHandoffSms,
  buildGuidedResolutionNewHandoffSms,
  buildGuidedTightenHandoffSms,
} from "@/lib/v2-guided-resolution";
import {
  applyRefreshCommitmentStepResolutionMutation,
  applyRefreshIdentityStepResolutionMutation,
  applyRefreshPromptedPostSendBookkeepingMutation,
  reconcileRefreshPostSendBookkeepingForCommitment,
  advanceSessionToCommitment,
  buildRefreshClarifyCommitmentSms,
  buildRefreshClarifyIdentitySms,
  buildRefreshKeepAckSms,
  buildRefreshStepCommitmentSms,
  isRefreshSessionActive,
  parseRefreshInboundToken,
  parseRefreshSession,
  persistRefreshSession,
  touchCommitmentRefreshPromptedTimestamp,
  type V2RefreshSessionState,
} from "@/lib/v2-refresh-session";
import {
  clearBlockerCapturePending,
  exitLowPressureReactivationOnInbound,
  getActiveCommitment,
  getRecentV2EventsForAi,
  isBlockerCapturePendingActive,
  isBlockerCapturePendingExpired,
  setBlockerCapturePending,
  type ActiveV2CommitmentRow,
  type V2AccountabilityOutcome,
} from "@/lib/v2-commitment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Job status (text column):
 * pending → claimed → processing → generating_reply → reply_ready → sending → sent
 * failed: retriable; needs_manual_review: operator must reset (e.g. to pending) or verify Twilio
 * cancelled: user ineligible
 */
const CRON_SECRET = process.env.CRON_SECRET;

const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 25;
const STALE_PROCESSING_MINUTES = 15;

const farFutureIso = () =>
  new Date(Date.now() + 86400 * 365 * 10 * 1000).toISOString();

function timingSafeEqualUtf8(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function validateCronSecret(req: Request): boolean {
  if (!CRON_SECRET) return false;

  const xCron = req.headers.get("x-cron-secret");
  if (xCron && timingSafeEqualUtf8(xCron, CRON_SECRET)) return true;

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token && timingSafeEqualUtf8(token, CRON_SECRET)) return true;
  }

  const hasXCronHeader = req.headers.get("x-cron-secret") != null;
  const hasAuthorizationHeader = req.headers.get("authorization") != null;

  if (!hasXCronHeader && !hasAuthorizationHeader && req.method === "GET") {
    try {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/api/cron/")) {
        const qSecret = url.searchParams.get("cron_secret");
        if (qSecret && timingSafeEqualUtf8(qSecret, CRON_SECRET)) {
          console.log("[sms-inbound-coach] allowed via query cron_secret fallback");
          return true;
        }
      }
    } catch {
      // ignore
    }
  }

  return false;
}

function computeNextRetryIso(attempt: number): string {
  const sec = Math.min(600, 30 * Math.max(1, attempt));
  return new Date(Date.now() + sec * 1000).toISOString();
}

type JobRow = {
  message_sid: string;
  clerk_user_id: string;
  from_phone: string;
  raw_body: string;
  status: string;
  attempt_count: number;
  next_retry_at: string;
  reply_body: string | null;
  sent_at: string | null;
  last_error: string | null;
  outbound_message_sid: string | null;
};

async function markJobFinal(args: {
  messageSid: string;
  status: string;
  lastError?: string | null;
  attemptCount?: number;
  nextRetry?: string;
}) {
  const patch: Record<string, unknown> = {
    status: args.status,
    updated_at: new Date().toISOString(),
  };
  if (args.lastError !== undefined) {
    patch.last_error = args.lastError;
  }
  if (args.nextRetry !== undefined) {
    patch.next_retry_at = args.nextRetry;
  }
  if (typeof args.attemptCount === "number") {
    patch.attempt_count = args.attemptCount;
  }

  await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update(patch)
    .eq("message_sid", args.messageSid);
}

async function repairOutboundSidWithoutSentAt(): Promise<number> {
  const { data: rows, error } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("message_sid")
    .not("outbound_message_sid", "is", null)
    .is("sent_at", null)
    .limit(25);

  if (error || !rows?.length) return 0;

  let n = 0;
  for (const r of rows) {
    const { error: upErr } = await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("message_sid", r.message_sid);
    if (!upErr) n += 1;
  }
  if (n > 0) {
    console.log("[sms-inbound-coach] repaired partial send finalization", { count: n });
  }
  return n;
}

async function reclaimStaleJobs(nowIso: string): Promise<void> {
  const staleCutoff = new Date(
    Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000
  ).toISOString();

  const { error: e1 } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "failed",
      last_error: "stale_processing_reclaimed",
      next_retry_at: nowIso,
      updated_at: nowIso,
    })
    .eq("status", "processing")
    .is("sent_at", null)
    .is("outbound_message_sid", null)
    .lt("updated_at", staleCutoff);

  if (e1) {
    console.error("[sms-inbound-coach] stale processing reclaim error", e1);
  }

  const { error: e2 } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "needs_manual_review",
      last_error:
        "stale_generating_reply: coach step did not persist reply_body; operator verify coach_conversations / may reset to pending after fix",
      next_retry_at: farFutureIso(),
      updated_at: nowIso,
    })
    .eq("status", "generating_reply")
    .is("reply_body", null)
    .lt("updated_at", staleCutoff);

  if (e2) {
    console.error("[sms-inbound-coach] stale generating_reply reclaim error", e2);
  }

  const { error: e3 } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "needs_manual_review",
      last_error:
        "stale_sending_no_outbound_sid: possible Twilio delivery unknown; operator verify before resetting",
      next_retry_at: farFutureIso(),
      updated_at: nowIso,
    })
    .eq("status", "sending")
    .is("outbound_message_sid", null)
    .is("sent_at", null)
    .lt("updated_at", staleCutoff);

  if (e3) {
    console.error("[sms-inbound-coach] stale sending reclaim error", e3);
  }
}

async function loadJob(messageSid: string): Promise<JobRow | null> {
  const { data } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("*")
    .eq("message_sid", messageSid)
    .maybeSingle();
  return data as JobRow | null;
}

async function processV2NormalInboundOutcome(
  job: JobRow,
  userId: string,
  commitment: ActiveV2CommitmentRow,
  classification: ReturnType<typeof classifyV2InboundReply>,
  timezone: string
): Promise<void> {
  // 1) Classification is rule-based at call sites; event_type is server-controlled here.
  const { eventType, normalizedHint } = classification;
  // 2) Server strategy (AI must echo in JSON; never drives event_type).
  const serverStrategy = strategyForInboundEventType(eventType);
  const effectiveBehavior = getEffectiveCoachingAsk(commitment);
  const userMessage = (job.raw_body || "").trim();
  const recentEvents = await getRecentV2EventsForAi(commitment.id);

  const brokePause = commitment.accountability_phase === "low_pressure_reactivation";
  if (brokePause) {
    await exitLowPressureReactivationOnInbound(commitment.id);
    await recomputeV2CoachingMemory(commitment.id, {
      reasonCode: "inbound_exit_reactivation_before_outcome",
    });
  }

  const { data: inboundProfileRow } = await supabaseServer
    .from("user_profiles")
    .select(
      "preferred_name, life_desires, people_summary, responsibility, identity_anchor_text, identity_refresh_due_at, identity_last_referenced_at"
    )
    .eq("clerk_user_id", userId)
    .maybeSingle();

  const preferredName =
    typeof inboundProfileRow?.preferred_name === "string"
      ? inboundProfileRow.preferred_name
      : null;
  const lifeDesires =
    typeof inboundProfileRow?.life_desires === "string" ? inboundProfileRow.life_desires : null;
  const peopleSummary =
    typeof inboundProfileRow?.people_summary === "string" && inboundProfileRow.people_summary.trim()
      ? inboundProfileRow.people_summary.trim()
      : null;
  const responsibility =
    typeof inboundProfileRow?.responsibility === "string" && inboundProfileRow.responsibility.trim()
      ? inboundProfileRow.responsibility.trim()
      : null;
  const identityAnchorText =
    typeof inboundProfileRow?.identity_anchor_text === "string"
      ? inboundProfileRow.identity_anchor_text.trim()
      : null;
  const identityRefreshDue = isIdentityRefreshDue(
    typeof inboundProfileRow?.identity_refresh_due_at === "string"
      ? inboundProfileRow.identity_refresh_due_at
      : null,
    Date.now()
  );
  const identityReferenceAllowed = computeIdentityReferenceAllowedInbound({
    nowMs: Date.now(),
    identityAnchorText: inboundProfileRow?.identity_anchor_text,
    identityRefreshDueAt:
      typeof inboundProfileRow?.identity_refresh_due_at === "string"
        ? inboundProfileRow.identity_refresh_due_at
        : null,
    identityLastReferencedAt:
      typeof inboundProfileRow?.identity_last_referenced_at === "string"
        ? inboundProfileRow.identity_last_referenced_at
        : null,
    accountabilityPhase: commitment.accountability_phase,
    refreshSessionActive: isRefreshSessionActive(commitment),
    brokePause,
  });

  const { body: templateReplyBody, replyTemplateId } = buildV2InboundReplySms({
    behaviorStatement: effectiveBehavior,
    messageSid: job.message_sid,
    eventType,
    preferredName,
  });

  const silenceCtx = deriveV2SilenceContext(recentEvents, new Date());
  const afterSilence = silenceCtx.tier !== "none";
  const lastOutboundNextMove = parseLatestCheckSentNextMoveType(recentEvents);

  const coachingMemoryRow = await loadV2CoachingMemoryForPrompt(commitment.id);

  // 4) AI reply copy only; any invalid path falls back inside tryGenerate / validate.
  const aiTry = await tryGenerateV2InboundMessage({
    commitment,
    eventType,
    serverStrategy,
    userMessage,
    normalizedHint,
    eventsNewestFirst: recentEvents,
    coachingMemory: coachingMemoryRow,
    preferredName,
    lifeDesires,
    peopleSummary,
    responsibility,
    identityAnchorText,
    identityRefreshDue,
    identityReferenceAllowed,
    afterSilence,
    lastOutboundNextMove,
    ...(brokePause ? { brokePause: true } : {}),
    ...(afterSilence
      ? {
          unansweredChecks: silenceCtx.unanswered_checks,
          daysIdle: silenceCtx.days_since_last_user_outcome,
        }
      : {}),
  });

  // 5) Final SMS body + persisted ai blob (message = text actually sent).
  const replyBody = aiTry.ok ? aiTry.message : templateReplyBody;
  const aiPayload = buildUserReplyAiPayload({
    model: V2_INBOUND_AI_MODEL,
    promptVersion: V2_INBOUND_AI_PROMPT_VERSION,
    serverStrategy,
    message: replyBody,
    confidence: aiTry.ok ? aiTry.confidence : null,
    fallbackUsed: !aiTry.ok,
    fallbackReason: !aiTry.ok ? aiTry.reason : null,
  });

  const idempotencyKey = v2UserReplyIdempotencyKey(eventType, job.message_sid);

  // 6) Event spine: same event_type as classification; enrich payload_json only.
  const { error: evErr } = await supabaseServer.from("v2_commitment_event").insert({
    commitment_id: commitment.id,
    clerk_user_id: userId,
    event_type: eventType,
    source: "sms_v2_accountability",
    payload_json: {
      message: userMessage,
      ...(normalizedHint != null ? { normalized_hint: normalizedHint } : {}),
      ...(!aiTry.ok ? { reply_template_id: replyTemplateId } : {}),
      ...(afterSilence
        ? {
            reentry_context: {
              after_silence: true,
              unanswered_checks: silenceCtx.unanswered_checks,
              days_idle: silenceCtx.days_since_last_user_outcome,
            },
          }
        : {}),
      ai: aiPayload,
    },
    idempotency_key: idempotencyKey,
  });

  if (evErr) {
    const code = (evErr as { code?: string }).code;
    if (code !== "23505") {
      throw new Error(`v2_commitment_event_insert_failed: ${evErr.message}`);
    }
  } else {
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
  }

  await recomputeV2CoachingMemory(commitment.id, {
    reasonCode: "inbound_user_outcome",
  });

  // 7) Existing product side-effects (unchanged).
  if (eventType === "user_no" || eventType === "user_partial") {
    await setBlockerCapturePending(commitment.id, eventType as V2AccountabilityOutcome);
  }

  // 8) Job reply → shared send pipeline.
  const now = new Date().toISOString();
  const { data: persisted } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      reply_body: replyBody,
      status: "reply_ready",
      next_retry_at: now,
      updated_at: now,
      last_error: null,
    })
    .eq("message_sid", job.message_sid)
    .eq("status", "processing")
    .select()
    .maybeSingle();

  if (!persisted) {
    const j2 = await loadJob(job.message_sid);
    if (j2?.reply_body?.trim()) {
      await commitAndSendInboundCoachReply(j2, userId);
      return;
    }
    throw new Error("v2_reply_ready_persist_failed");
  }

  const fresh = (await loadJob(job.message_sid)) ?? job;
  await commitAndSendInboundCoachReply(fresh, userId);
}

async function processV2BlockerCapture(
  job: JobRow,
  userId: string,
  commitment: ActiveV2CommitmentRow,
  blockerText: string,
  timezone: string
): Promise<void> {
  const following =
    commitment.blocker_capture_after_event === "user_no" ||
    commitment.blocker_capture_after_event === "user_partial"
      ? commitment.blocker_capture_after_event
      : ("user_partial" as const);

  const { data: blockerProfileRow } = await supabaseServer
    .from("user_profiles")
    .select(
      "preferred_name, life_desires, people_summary, responsibility, identity_anchor_text"
    )
    .eq("clerk_user_id", userId)
    .maybeSingle();

  const blockerPreferredName =
    typeof blockerProfileRow?.preferred_name === "string"
      ? blockerProfileRow.preferred_name
      : null;
  const blockerLifeDesires =
    typeof blockerProfileRow?.life_desires === "string" ? blockerProfileRow.life_desires : null;
  const blockerPeopleSummary =
    typeof blockerProfileRow?.people_summary === "string" &&
    blockerProfileRow.people_summary.trim()
      ? blockerProfileRow.people_summary.trim()
      : null;
  const blockerResponsibility =
    typeof blockerProfileRow?.responsibility === "string" &&
    blockerProfileRow.responsibility.trim()
      ? blockerProfileRow.responsibility.trim()
      : null;
  const blockerIdentityAnchorText =
    typeof blockerProfileRow?.identity_anchor_text === "string"
      ? blockerProfileRow.identity_anchor_text.trim()
      : null;

  const { body: templateAckBody, ackTemplateId } = buildBlockerAckSms(job.message_sid, {
    preferredName: blockerPreferredName,
  });

  const brokePause = commitment.accountability_phase === "low_pressure_reactivation";
  if (brokePause) {
    await exitLowPressureReactivationOnInbound(commitment.id);
    await recomputeV2CoachingMemory(commitment.id, {
      reasonCode: "inbound_exit_reactivation_before_blocker",
    });
  }

  const blockerCoachingMemory = await loadV2CoachingMemoryForPrompt(commitment.id);

  const blockerAckTry = await tryGenerateV2BlockerAckMessage({
    commitment,
    followingEventType: following,
    blockerText,
    preferredName: blockerPreferredName,
    lifeDesires: blockerLifeDesires,
    peopleSummary: blockerPeopleSummary,
    responsibility: blockerResponsibility,
    identityAnchorText: blockerIdentityAnchorText,
    coachingMemory: blockerCoachingMemory,
    ...(brokePause ? { brokePause: true } : {}),
  });

  const ackBody = blockerAckTry.ok ? blockerAckTry.message : templateAckBody;
  const blockerAiPayload = buildBlockerAckAiPayload({
    model: V2_BLOCKER_ACK_AI_MODEL,
    promptVersion: V2_BLOCKER_ACK_PROMPT_VERSION,
    message: ackBody,
    confidence: blockerAckTry.ok ? blockerAckTry.confidence : null,
    fallbackUsed: !blockerAckTry.ok,
    fallbackReason: !blockerAckTry.ok ? blockerAckTry.reason : null,
  });

  const now = new Date().toISOString();

  const { data: persisted } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      reply_body: ackBody,
      status: "reply_ready",
      next_retry_at: now,
      updated_at: now,
      last_error: null,
    })
    .eq("message_sid", job.message_sid)
    .eq("status", "processing")
    .select()
    .maybeSingle();

  if (!persisted) {
    const j2 = await loadJob(job.message_sid);
    if (j2?.reply_body?.trim()) {
      await commitAndSendInboundCoachReply(j2, userId);
    } else {
      throw new Error("v2_blocker_ack_reply_ready_persist_failed");
    }
  } else {
    const fresh = (await loadJob(job.message_sid)) ?? job;
    await commitAndSendInboundCoachReply(fresh, userId);
  }

  const afterSend = (await loadJob(job.message_sid)) ?? job;
  const ackSid =
    typeof afterSend.outbound_message_sid === "string" && afterSend.outbound_message_sid.length > 0
      ? afterSend.outbound_message_sid
      : null;

  const { error: evErr } = await supabaseServer.from("v2_commitment_event").insert({
    commitment_id: commitment.id,
    clerk_user_id: userId,
    event_type: "blocker_captured",
    source: "sms_v2_accountability",
    payload_json: {
      message: blockerText,
      following_event_type: following,
      captured_at_context: "post_miss_question",
      ...(!blockerAckTry.ok ? { ack_template_id: ackTemplateId } : {}),
      ...(ackSid ? { ack_message_sid: ackSid } : {}),
      ai: blockerAiPayload,
    },
    idempotency_key: `v2_blocker_captured:${job.message_sid}`,
  });

  if (evErr) {
    const code = (evErr as { code?: string }).code;
    if (code === "23505") {
      await clearBlockerCapturePending(commitment.id);
      return;
    }
    console.error("[sms-inbound-coach] blocker_captured insert failed", {
      message_sid: job.message_sid,
      message: evErr.message,
    });
    return;
  }

  await clearBlockerCapturePending(commitment.id);
  await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
  await recomputeV2CoachingMemory(commitment.id, {
    reasonCode: "inbound_blocker_captured",
  });
}

async function processV2ContractProposalConsent(
  job: JobRow,
  userId: string,
  commitment: ActiveV2CommitmentRow,
  timezone: string
): Promise<boolean> {
  let workingCommitment = commitment;
  if (!isV2PendingProposalValid(workingCommitment)) return false;

  const classification = classifyV2InboundReply((job.raw_body || "").trim());
  const proposalText = workingCommitment.adaptive_proposal_text?.trim();
  if (!proposalText) return false;

  if (
    workingCommitment.accountability_phase === "low_pressure_reactivation" &&
    (classification.eventType === "user_yes" || classification.eventType === "user_no")
  ) {
    await exitLowPressureReactivationOnInbound(workingCommitment.id);
    await recomputeV2CoachingMemory(workingCommitment.id, {
      reasonCode: "inbound_exit_reactivation_before_contract_consent",
    });
    const refreshed = await getActiveCommitment(userId);
    if (!refreshed?.id) {
      throw new Error("contract_consent_commitment_missing_after_reactivation_exit");
    }
    workingCommitment = refreshed;
  }

  const { data: consentProfileRow } = await supabaseServer
    .from("user_profiles")
    .select("preferred_name")
    .eq("clerk_user_id", userId)
    .maybeSingle();
  const consentPreferredName =
    typeof consentProfileRow?.preferred_name === "string" ? consentProfileRow.preferred_name : null;

  const persistReplyAndSend = async (replyBody: string): Promise<void> => {
    const now = new Date().toISOString();
    const { data: persisted } = await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        reply_body: replyBody,
        status: "reply_ready",
        next_retry_at: now,
        updated_at: now,
        last_error: null,
      })
      .eq("message_sid", job.message_sid)
      .eq("status", "processing")
      .select()
      .maybeSingle();

    if (!persisted) {
      const j2 = await loadJob(job.message_sid);
      if (j2?.reply_body?.trim()) {
        await commitAndSendInboundCoachReply(j2, userId);
        return;
      }
      throw new Error("v2_contract_consent_reply_ready_persist_failed");
    }

    const fresh = (await loadJob(job.message_sid)) ?? job;
    await commitAndSendInboundCoachReply(fresh, userId);
  };

  if (classification.eventType === "user_yes") {
    const contractKind = await resolvePendingProposalContractKind({
      commitmentId: commitment.id,
      proposalText,
    });
    const act = await activateAdaptiveOverlayFromProposal({
      commitmentId: workingCommitment.id,
      clerkUserId: userId,
      proposalText,
      inboundMessageSid: job.message_sid,
      contractKind,
      expectedProposalExpiresAt: workingCommitment.adaptive_proposal_expires_at,
      expectedUpdatedAt: workingCommitment.updated_at,
    });
    if (act.result === "already_applied") {
      await persistReplyAndSend(
        "Already recorded from a prior reply in this thread. Daily checks continue."
      );
      return true;
    }
    if (act.result === "state_conflict" || act.result === "not_found") {
      await persistReplyAndSend(
        "No active pending proposal to update from this reply. Daily checks continue."
      );
      return true;
    }
    if (!act.ok) {
      throw new Error(`contract_overlay_activate_failed:${act.error}`);
    }
    await recomputeV2CoachingMemory(workingCommitment.id, {
      reasonCode: "inbound_contract_overlay_accepted",
    });
    const tmpl = buildV2ContractOverlayYesAckSms({
      messageSid: job.message_sid,
      adoptedAskText: proposalText,
      contractKind,
    });
    const aiTry = await tryGenerateV2ContractConsentAckMessage({
      kind: "overlay_activated_ack",
      bindingText: proposalText,
      overlayContractKind: contractKind,
      originalBehaviorStatement: workingCommitment.behavior_statement,
      commitmentTitle: workingCommitment.title,
      preferredName: consentPreferredName,
    });
    const replyBody = aiTry.ok ? aiTry.message : tmpl.body;
    await persistReplyAndSend(replyBody);
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    return true;
  }

  if (classification.eventType === "user_no") {
    const contractKind = await resolvePendingProposalContractKind({
      commitmentId: commitment.id,
      proposalText,
    });
    const dec = await declineAdaptiveProposal({
      commitmentId: workingCommitment.id,
      clerkUserId: userId,
      proposalText,
      inboundMessageSid: job.message_sid,
      contractKind,
      expectedProposalExpiresAt: workingCommitment.adaptive_proposal_expires_at,
      expectedUpdatedAt: workingCommitment.updated_at,
    });
    if (dec.result === "already_applied") {
      await persistReplyAndSend(
        "Already recorded from a prior reply in this thread. Daily checks continue."
      );
      return true;
    }
    if (dec.result === "state_conflict" || dec.result === "not_found") {
      await persistReplyAndSend(
        "No active pending proposal to update from this reply. Daily checks continue."
      );
      return true;
    }
    if (!dec.ok) {
      throw new Error(`contract_overlay_decline_failed:${dec.error}`);
    }
    await recomputeV2CoachingMemory(workingCommitment.id, {
      reasonCode: "inbound_contract_overlay_declined",
    });
    const tmpl = buildV2ContractOverlayNoAckSms({
      messageSid: job.message_sid,
      originalBehaviorStatement: workingCommitment.behavior_statement,
    });
    const aiTry = await tryGenerateV2ContractConsentAckMessage({
      kind: "overlay_declined_ack",
      bindingText: null,
      overlayContractKind: contractKind,
      originalBehaviorStatement: workingCommitment.behavior_statement,
      commitmentTitle: workingCommitment.title,
      preferredName: consentPreferredName,
    });
    const replyBody = aiTry.ok ? aiTry.message : tmpl.body;
    await persistReplyAndSend(replyBody);
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    return true;
  }

  return false;
}

async function persistV2JobReplyReadyAndSend(
  job: JobRow,
  userId: string,
  replyBody: string
): Promise<void> {
  const now = new Date().toISOString();
  const { data: persisted } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      reply_body: replyBody,
      status: "reply_ready",
      next_retry_at: now,
      updated_at: now,
      last_error: null,
    })
    .eq("message_sid", job.message_sid)
    .eq("status", "processing")
    .select()
    .maybeSingle();

  if (!persisted) {
    const j2 = await loadJob(job.message_sid);
    if (j2?.reply_body?.trim()) {
      await commitAndSendInboundCoachReply(j2, userId);
      return;
    }
    throw new Error("v2_refresh_reply_ready_persist_failed");
  }

  const fresh = (await loadJob(job.message_sid)) ?? job;
  await commitAndSendInboundCoachReply(fresh, userId);
}

/**
 * Strict refresh-session SMS flow (no AI interpretation of tokens).
 * Returns true when this inbound was fully handled as refresh traffic.
 */
async function processV2CoachingRefreshInbound(
  job: JobRow,
  userId: string,
  commitment: ActiveV2CommitmentRow,
  timezone: string
): Promise<boolean> {
  const session = parseRefreshSession(commitment.refresh_session);
  if (!session) return false;
  let expectedCommitmentUpdatedAt = commitment.updated_at;

  const token = parseRefreshInboundToken((job.raw_body || "").trim());

  if (session.step === "identity") {
    if (token === "STILL") {
      await bumpIdentityRefreshCycleAfterRefreshStillReply({ clerkUserId: userId });
      const still = await applyRefreshIdentityStepResolutionMutation({
        commitmentId: commitment.id,
        clerkUserId: userId,
        inboundMessageSid: job.message_sid,
        resolution: "still",
        expectedSessionId: session.session_id,
        expectedUpdatedAt: commitment.updated_at,
      });
      if (!still.ok) {
        if (still.result === "already_applied") {
          await persistV2JobReplyReadyAndSend(
            job,
            userId,
            "Already recorded from a prior reply in this thread. Normal checks continue."
          );
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (still.result === "state_conflict" || still.result === "not_found") {
          await persistV2JobReplyReadyAndSend(
            job,
            userId,
            "No active identity refresh step to update from this reply. Normal checks continue."
          );
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        throw new Error(`refresh_identity_still_failed:${still.error}`);
      }
      const advanced = advanceSessionToCommitment(session, new Date().toISOString());
      expectedCommitmentUpdatedAt = typeof still.updatedAt === "string" ? still.updatedAt : null;
      const effectiveAsk = getEffectiveCoachingAsk(commitment, Date.now());
      const { body: stepB } = buildRefreshStepCommitmentSms({ effectiveAsk });
      await persistV2JobReplyReadyAndSend(job, userId, stepB);
      const delivered: V2RefreshSessionState = {
        ...advanced,
        commitment_prompt_delivered: true,
      };
      const after = (await loadJob(job.message_sid)) ?? job;
      const outSid =
        typeof after.outbound_message_sid === "string" && after.outbound_message_sid.length > 0
          ? after.outbound_message_sid
          : null;
      if (outSid) {
        const booked = await applyRefreshPromptedPostSendBookkeepingMutation({
          commitmentId: commitment.id,
          clerkUserId: userId,
          messageSid: outSid,
          promptStep: "commitment",
          promptKind: "commitment_daily",
          bodyPreview: stepB,
          nextRefreshSession: delivered,
          expectedSessionId: delivered.session_id,
          expectedUpdatedAt: expectedCommitmentUpdatedAt,
        });
        if (!booked.ok) {
          throw new Error(`refresh_still_step_b_bookkeeping_failed:${booked.error}`);
        }
      }
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "inbound_refresh_still",
      });
      return true;
    }

    if (token === "CHANGE") {
      const change = await applyRefreshIdentityStepResolutionMutation({
        commitmentId: commitment.id,
        clerkUserId: userId,
        inboundMessageSid: job.message_sid,
        resolution: "change",
        expectedSessionId: session.session_id,
        expectedUpdatedAt: commitment.updated_at,
      });
      if (!change.ok) {
        if (change.result === "already_applied") {
          await persistV2JobReplyReadyAndSend(
            job,
            userId,
            "Already recorded from a prior reply in this thread. Normal checks continue."
          );
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (change.result === "state_conflict" || change.result === "not_found") {
          await persistV2JobReplyReadyAndSend(
            job,
            userId,
            "No active identity refresh step to update from this reply. Normal checks continue."
          );
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        throw new Error(`refresh_identity_change_failed:${change.error}`);
      }
      const { body } = buildGuidedResolutionChangeHandoffSms();
      await persistV2JobReplyReadyAndSend(job, userId, body);
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "inbound_refresh_change",
      });
      return true;
    }

    if (session.clarifications_remaining > 0) {
      const clarify = await applyRefreshIdentityStepResolutionMutation({
        commitmentId: commitment.id,
        clerkUserId: userId,
        inboundMessageSid: job.message_sid,
        resolution: "clarify_identity",
        expectedSessionId: session.session_id,
        expectedUpdatedAt: commitment.updated_at,
      });
      if (!clarify.ok) {
        if (clarify.result === "already_applied") {
          await persistV2JobReplyReadyAndSend(
            job,
            userId,
            "Already recorded from a prior reply in this thread. Normal checks continue."
          );
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (clarify.result === "state_conflict" || clarify.result === "not_found") {
          await persistV2JobReplyReadyAndSend(
            job,
            userId,
            "No active identity refresh step to update from this reply. Normal checks continue."
          );
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        throw new Error(`refresh_identity_clarify_failed:${clarify.error}`);
      }
      const { body } = buildRefreshClarifyIdentitySms();
      await persistV2JobReplyReadyAndSend(job, userId, body);
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "inbound_refresh_identity_clarify",
      });
      return true;
    }

    const abortIdentity = await applyRefreshIdentityStepResolutionMutation({
      commitmentId: commitment.id,
      clerkUserId: userId,
      inboundMessageSid: job.message_sid,
      resolution: "aborted_unclear",
      expectedSessionId: session.session_id,
      expectedUpdatedAt: commitment.updated_at,
    });
    if (!abortIdentity.ok) {
      if (abortIdentity.result === "already_applied") {
        await persistV2JobReplyReadyAndSend(
          job,
          userId,
          "Already recorded from a prior reply in this thread. Normal checks continue."
        );
        await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
        return true;
      }
      if (abortIdentity.result === "state_conflict" || abortIdentity.result === "not_found") {
        await persistV2JobReplyReadyAndSend(
          job,
          userId,
          "No active identity refresh step to update from this reply. Normal checks continue."
        );
        await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
        return true;
      }
      throw new Error(`refresh_identity_aborted_unclear_failed:${abortIdentity.error}`);
    }
    await persistV2JobReplyReadyAndSend(
      job,
      userId,
      "Closing that alignment check for now—no changes saved from this thread. Normal checks continue."
    );
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    await recomputeV2CoachingMemory(commitment.id, {
      reasonCode: "inbound_refresh_identity_aborted_unclear",
    });
    return true;
  }

  if (session.step === "commitment") {
    if (token === "KEEP") {
      const keep = await applyRefreshCommitmentStepResolutionMutation({
        commitmentId: commitment.id,
        clerkUserId: userId,
        inboundMessageSid: job.message_sid,
        resolution: "keep",
        expectedSessionId: session.session_id,
        expectedUpdatedAt: commitment.updated_at,
      });
      if (!keep.ok) {
        if (keep.result === "already_applied") {
          await persistV2JobReplyReadyAndSend(
            job,
            userId,
            "Already recorded from a prior reply in this thread. Normal checks continue."
          );
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (keep.result === "state_conflict" || keep.result === "not_found") {
          await persistV2JobReplyReadyAndSend(
            job,
            userId,
            "No active commitment refresh step to update from this reply. Normal checks continue."
          );
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        throw new Error(`refresh_commitment_keep_failed:${keep.error}`);
      }
      await touchCommitmentRefreshPromptedTimestamp(commitment.id);
      const { body } = buildRefreshKeepAckSms();
      await persistV2JobReplyReadyAndSend(job, userId, body);
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "inbound_refresh_keep",
      });
      return true;
    }

    if (token === "TIGHTEN") {
      const tighten = await applyRefreshCommitmentStepResolutionMutation({
        commitmentId: commitment.id,
        clerkUserId: userId,
        inboundMessageSid: job.message_sid,
        resolution: "tighten",
        expectedSessionId: session.session_id,
        expectedUpdatedAt: commitment.updated_at,
      });
      if (!tighten.ok) {
        if (tighten.result === "already_applied") {
          await persistV2JobReplyReadyAndSend(
            job,
            userId,
            "Already recorded from a prior reply in this thread. Normal checks continue."
          );
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (tighten.result === "state_conflict" || tighten.result === "not_found") {
          await persistV2JobReplyReadyAndSend(
            job,
            userId,
            "No active commitment refresh step to update from this reply. Normal checks continue."
          );
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        throw new Error(`refresh_commitment_tighten_failed:${tighten.error}`);
      }
      const { body } = buildGuidedTightenHandoffSms();
      await persistV2JobReplyReadyAndSend(job, userId, body);
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "inbound_refresh_tighten",
      });
      return true;
    }

    if (token === "NEW") {
      const replace = await applyRefreshCommitmentStepResolutionMutation({
        commitmentId: commitment.id,
        clerkUserId: userId,
        inboundMessageSid: job.message_sid,
        resolution: "new",
        expectedSessionId: session.session_id,
        expectedUpdatedAt: commitment.updated_at,
      });
      if (!replace.ok) {
        if (replace.result === "already_applied") {
          await persistV2JobReplyReadyAndSend(
            job,
            userId,
            "Already recorded from a prior reply in this thread. Normal checks continue."
          );
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        if (replace.result === "state_conflict" || replace.result === "not_found") {
          await persistV2JobReplyReadyAndSend(
            job,
            userId,
            "No active commitment refresh step to update from this reply. Normal checks continue."
          );
          await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
          return true;
        }
        throw new Error(`refresh_commitment_new_failed:${replace.error}`);
      }
      const { body } = buildGuidedResolutionNewHandoffSms();
      await persistV2JobReplyReadyAndSend(job, userId, body);
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "inbound_refresh_new",
      });
      return true;
    }

    if (session.clarifications_remaining > 0) {
      const nextSess = {
        ...session,
        clarifications_remaining: session.clarifications_remaining - 1,
      };
      expectedCommitmentUpdatedAt = await persistRefreshSession(commitment.id, nextSess, {
        expectedUpdatedAt: expectedCommitmentUpdatedAt,
      });
      const { body } = buildRefreshClarifyCommitmentSms();
      await persistV2JobReplyReadyAndSend(job, userId, body);
      await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
      await recomputeV2CoachingMemory(commitment.id, {
        reasonCode: "inbound_refresh_commitment_clarify",
      });
      return true;
    }

    const aborted = await applyRefreshCommitmentStepResolutionMutation({
      commitmentId: commitment.id,
      clerkUserId: userId,
      inboundMessageSid: job.message_sid,
      resolution: "aborted_unclear",
      expectedSessionId: session.session_id,
      expectedUpdatedAt: commitment.updated_at,
    });
    if (!aborted.ok) {
      if (aborted.result === "already_applied") {
        await persistV2JobReplyReadyAndSend(
          job,
          userId,
          "Already recorded from a prior reply in this thread. Normal checks continue."
        );
        await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
        return true;
      }
      if (aborted.result === "state_conflict" || aborted.result === "not_found") {
        await persistV2JobReplyReadyAndSend(
          job,
          userId,
          "No active commitment refresh step to update from this reply. Normal checks continue."
        );
        await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
        return true;
      }
      throw new Error(`refresh_commitment_aborted_unclear_failed:${aborted.error}`);
    }
    await persistV2JobReplyReadyAndSend(
      job,
      userId,
      "Didn’t catch a valid reply (KEEP / TIGHTEN / NEW). Normal checks continue—update the commitment in the app when you’re ready."
    );
    await recordV2SendTimeProfileInboundEngagement(userId, timezone, new Date());
    await recomputeV2CoachingMemory(commitment.id, {
      reasonCode: "inbound_refresh_commitment_aborted_unclear",
    });
    return true;
  }

  return false;
}

async function handleV2SmsInboundCoachJob(
  job: JobRow,
  userId: string,
  commitment: ActiveV2CommitmentRow,
  timezone: string
): Promise<void> {
  let c = commitment;

  try {
    const reconcile = await reconcileRefreshPostSendBookkeepingForCommitment({
      commitmentId: c.id,
      clerkUserId: userId,
    });
    if (reconcile.failures > 0) {
      console.warn("[sms-inbound-coach] refresh reconcile unresolved", {
        clerk_user_id: userId,
        commitment_id: c.id,
        attempted: reconcile.attempted,
        recovered: reconcile.recovered,
        failures: reconcile.failures,
        state_conflicts: reconcile.stateConflicts,
        rpc_failures: reconcile.rpcFailures,
        repeated_likely: reconcile.repeatedLikely,
        snapshot_candidates_found: reconcile.snapshotCandidatesFound,
        snapshot_replay_attempted: reconcile.snapshotReplayAttempted,
        snapshot_replay_applied: reconcile.snapshotReplayApplied,
        heuristic_fallback_attempted: reconcile.heuristicFallbackAttempted,
        heuristic_fallback_applied: reconcile.heuristicFallbackApplied,
        unresolved_after_both: reconcile.unresolvedAfterBoth,
      });
    }
    const refreshedAfterReconcile = await getActiveCommitment(userId);
    if (refreshedAfterReconcile) {
      c = refreshedAfterReconcile;
    }
  } catch (e) {
    console.error("[sms-inbound-coach] refresh post-send reconcile failed", {
      clerk_user_id: userId,
      commitment_id: c.id,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  if (isBlockerCapturePendingExpired(c)) {
    await clearBlockerCapturePending(c.id);
    c = { ...c, blocker_capture_expires_at: null, blocker_capture_after_event: null };
  }

  if (isBlockerCapturePendingActive(c)) {
    const original = (job.raw_body || "").trim();
    if (!original) {
      await clearBlockerCapturePending(c.id);
      const cleared: ActiveV2CommitmentRow = {
        ...c,
        blocker_capture_expires_at: null,
        blocker_capture_after_event: null,
      };
      await processV2NormalInboundOutcome(job, userId, cleared, classifyV2InboundReply(""), timezone);
      return;
    }

    const classification = classifyV2InboundReply(original);
    if (isStrongV2YesNoOutcome(classification.eventType)) {
      await clearBlockerCapturePending(c.id);
      const cleared: ActiveV2CommitmentRow = {
        ...c,
        blocker_capture_expires_at: null,
        blocker_capture_after_event: null,
      };
      await processV2NormalInboundOutcome(job, userId, cleared, classification, timezone);
      return;
    }

    await processV2BlockerCapture(job, userId, c, original, timezone);
    return;
  }

  await clearStaleAdaptiveContractColumns(c.id);
  const reloadedCommitment = await getActiveCommitment(userId);
  if (reloadedCommitment) {
    c = reloadedCommitment;
  }

  if (await processV2CoachingRefreshInbound(job, userId, c, timezone)) {
    return;
  }

  if (await processV2ContractProposalConsent(job, userId, c, timezone)) {
    return;
  }

  await processV2NormalInboundOutcome(
    job,
    userId,
    c,
    classifyV2InboundReply((job.raw_body || "").trim()),
    timezone
  );
}

/** Finalize job: reply_ready → Twilio send → sent (shared by legacy coach path + V2). */
async function commitAndSendInboundCoachReply(job: JobRow, userId: string): Promise<void> {
  let replyBody = (job.reply_body || "").trim();
  if (!replyBody) {
    throw new Error("missing_reply_body_before_send");
  }

  if (job.sent_at || job.outbound_message_sid) {
    if (job.outbound_message_sid && !job.sent_at) {
      await supabaseServer
        .from("sms_inbound_coach_jobs")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("message_sid", job.message_sid);
    }
    return;
  }

  const { data: sendClaim } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "sending",
      updated_at: new Date().toISOString(),
    })
    .eq("message_sid", job.message_sid)
    .eq("status", "reply_ready")
    .select()
    .maybeSingle();

  if (!sendClaim) {
    let j = (await loadJob(job.message_sid)) ?? job;
    if (j.status === "sending" && j.outbound_message_sid) {
      await supabaseServer
        .from("sms_inbound_coach_jobs")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("message_sid", j.message_sid);
      return;
    }
    if (j.sent_at) return;
    throw new Error("send_claim_lost: could not move reply_ready → sending");
  }

  if (!isTwilioReady()) {
    await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        status: "reply_ready",
        next_retry_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: "twilio_not_configured_reverted_to_reply_ready",
      })
      .eq("message_sid", job.message_sid)
      .eq("status", "sending");
    throw new Error("twilio_not_configured");
  }

  const latestForSend = (await loadJob(job.message_sid)) ?? job;
  const toPhone = latestForSend.from_phone;
  const bodyToSend = (latestForSend.reply_body || "").trim() || replyBody;

  console.log("[sms-inbound-coach] sending sms", job.message_sid);
  const sendResult = await sendSMSChunked({
    to: toPhone,
    body: bodyToSend,
    lastOutbound: {
      clerkUserId: userId,
      messageKind: "coach",
    },
  });

  const sid =
    sendResult.firstSid && sendResult.firstSid.length > 0
      ? sendResult.firstSid
      : null;

  const { error: sidErr } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      outbound_message_sid: sid,
      updated_at: new Date().toISOString(),
    })
    .eq("message_sid", job.message_sid)
    .eq("status", "sending");

  if (sidErr) {
    throw new Error(`outbound_message_sid persist failed: ${sidErr.message}`);
  }

  const { error: finalErr } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("message_sid", job.message_sid)
    .eq("status", "sending");

  if (finalErr) {
    throw new Error(`sent_at finalization failed: ${finalErr.message}`);
  }

  console.log("[sms-inbound-coach] sms sent", job.message_sid, {
    chunkCount: sendResult.chunkCount,
    firstSid: sendResult.firstSid,
  });
}

async function processJob(claimedJob: JobRow): Promise<void> {
  const fresh = await loadJob(claimedJob.message_sid);
  if (!fresh) {
    throw new Error("job_missing");
  }

  let job = fresh;

  if (job.outbound_message_sid && !job.sent_at) {
    console.log("[sms-inbound-coach] repair sent_at from outbound sid", job.message_sid);
    await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("message_sid", job.message_sid);
    return;
  }

  if (job.sent_at) {
    await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        status: "sent",
        updated_at: new Date().toISOString(),
      })
      .eq("message_sid", job.message_sid);
    return;
  }

  const userId = job.clerk_user_id;

  const { data: identity } = await supabaseServer
    .from("sms_identities")
    .select("phone_number, clerk_user_id, sms_enabled, stopped_at")
    .eq("phone_number", job.from_phone)
    .maybeSingle();

  if (!identity?.clerk_user_id || identity.clerk_user_id !== userId) {
    console.log("[sms-inbound-coach] cancelled: identity missing", job.message_sid);
    await markJobFinal({
      messageSid: job.message_sid,
      status: "cancelled",
      lastError: "identity_missing",
      nextRetry: farFutureIso(),
    });
    return;
  }

  if (identity.sms_enabled !== true || typeof identity.stopped_at === "string") {
    console.log("[sms-inbound-coach] cancelled: sms disabled", job.message_sid);
    await markJobFinal({
      messageSid: job.message_sid,
      status: "cancelled",
      lastError: "sms_disabled",
      nextRetry: farFutureIso(),
    });
    return;
  }

  const md = await getClerkPublicMetadata(userId);
  if (md.smsEnabled !== true) {
    console.log("[sms-inbound-coach] cancelled: clerk sms off", job.message_sid);
    await markJobFinal({
      messageSid: job.message_sid,
      status: "cancelled",
      lastError: "clerk_sms_disabled",
      nextRetry: farFutureIso(),
    });
    return;
  }

  const activeV2Commitment = await getActiveCommitment(userId);
  if (activeV2Commitment) {
    const v2Timezone = resolveUserTimezone(md.timezone);
    await handleV2SmsInboundCoachJob(job, userId, activeV2Commitment, v2Timezone);
    return;
  }

  // PR6: Inbound accountability is V2-only (active commitment handled above). No legacy completeDay / coachEngine.
  console.warn("[sms-inbound-coach][v2-only] inbound_cancelled_no_active_commitment", {
    clerk_user_id: userId,
    message_sid: job.message_sid,
    note: "legacy_inbound_accountability_removed_pr6",
  });
  await markJobFinal({
    messageSid: job.message_sid,
    status: "cancelled",
    lastError: "v2_only_no_active_commitment",
    nextRetry: farFutureIso(),
  });
  return;
}

export async function GET(req: Request) {
  if (!validateCronSecret(req)) {
    console.error("[sms-inbound-coach] unauthorized");
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const stats = {
    ok: true as boolean,
    scanned: 0,
    claimed: 0,
    completed: 0,
    errors: 0,
    repairedPartialSends: 0,
  };

  const nowIso = new Date().toISOString();

  stats.repairedPartialSends = await repairOutboundSidWithoutSentAt();
  await reclaimStaleJobs(nowIso);

  const { data: candidates, error: listErr } = await supabaseServer
    .from("sms_inbound_coach_jobs")
    .select("*")
    .in("status", ["pending", "failed", "reply_ready"])
    .lte("next_retry_at", nowIso)
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("next_retry_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (listErr) {
    console.error("[sms-inbound-coach] list error", listErr);
    return NextResponse.json(
      { ok: false, error: listErr.message },
      { status: 500 }
    );
  }

  stats.scanned = candidates?.length ?? 0;

  for (const row of candidates ?? []) {
    const job = row as JobRow;

    const { data: claimed } = await supabaseServer
      .from("sms_inbound_coach_jobs")
      .update({
        status: "processing",
        updated_at: new Date().toISOString(),
      })
      .eq("message_sid", job.message_sid)
      .in("status", ["pending", "failed", "reply_ready"])
      .select()
      .maybeSingle();

    if (!claimed) {
      continue;
    }

    stats.claimed += 1;
    const claimedJob = claimed as JobRow;

    try {
      await processJob(claimedJob);
      stats.completed += 1;
    } catch (err) {
      stats.errors += 1;
      const msg =
        err instanceof Error ? err.message : typeof err === "string" ? err : "unknown_error";

      console.error("[sms-inbound-coach] job failed", claimedJob.message_sid, err);

      const nextAttempt = claimedJob.attempt_count + 1;
      const terminal = nextAttempt >= MAX_ATTEMPTS;

      const failState = await loadJob(claimedJob.message_sid);
      const orphanedCoach =
        failState?.status === "generating_reply" &&
        !(failState.reply_body || "").trim();

      if (orphanedCoach) {
        await supabaseServer
          .from("sms_inbound_coach_jobs")
          .update({
            status: "needs_manual_review",
            attempt_count: nextAttempt,
            last_error: `coach_step_failed_or_incomplete_persist (no_auto_retry): ${msg.slice(
              0,
              1700
            )}`,
            next_retry_at: farFutureIso(),
            updated_at: new Date().toISOString(),
          })
          .eq("message_sid", claimedJob.message_sid);
        console.error(
          "[sms-inbound-coach] needs_manual_review orphan generating_reply",
          claimedJob.message_sid
        );
        continue;
      }

      await supabaseServer
        .from("sms_inbound_coach_jobs")
        .update({
          status: terminal ? "needs_manual_review" : "failed",
          attempt_count: nextAttempt,
          last_error: terminal
            ? `max_attempts_exceeded_no_auto_retry (attempts=${nextAttempt}): ${msg.slice(0, 1500)}`
            : msg.slice(0, 2000),
          next_retry_at: terminal
            ? farFutureIso()
            : computeNextRetryIso(nextAttempt),
          updated_at: new Date().toISOString(),
        })
        .eq("message_sid", claimedJob.message_sid);

      if (terminal) {
        console.error(
          "[sms-inbound-coach] needs_manual_review (max attempts)",
          claimedJob.message_sid,
          { attempts: nextAttempt }
        );
      }
    }
  }

  return NextResponse.json(stats);
}
