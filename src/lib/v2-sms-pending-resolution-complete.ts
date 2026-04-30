/**
 * Wave 4.1 — Complete SMS-only tighten/replace using pending_resolution_* + server RPCs.
 * AI does not mutate commitments; this module applies v2_apply_guided_commitment_replace_mutation
 * and the overlay consent path (persist + v2_apply_overlay_consent_mutation) only after confirmation.
 */

import { supabaseServer } from "@/lib/supabase-server";
import {
  activateAdaptiveOverlayFromProposal,
  clearStaleAdaptiveContractColumns,
  normalizeShrinkProposalBindingText,
  persistContractOverlayProposed,
  isV2AdaptiveOverlayActive,
  isV2PendingProposalValid,
} from "@/lib/v2-adaptive-contract";
import { getActiveCommitment, type ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { recomputeV2CoachingMemory } from "@/lib/v2-coaching-memory";
import {
  clearPendingResolution,
  clearPendingResolutionIfExpired,
  getPendingResolutionOrNull,
  mergeSmsPendingResolutionPayload,
  type V2PendingResolutionKind,
} from "@/lib/v2-guided-resolution";
import {
  tryExtractV2SmsPendingResolutionCandidateAi,
  V2_SMS_PENDING_CANDIDATE_CONFIDENCE_MIN,
} from "@/lib/v2-ai-sms-pending-candidate";
import {
  extractCandidateBarsFromSms,
  extractDurationAnchoredBarPhrase,
} from "@/lib/v2-sms-commitment-change";
import { getRecentV2EventsForAi } from "@/lib/v2-commitment";
import {
  appendSmsParagraphIfUnderCap,
  buildProofMomentCommitmentReplaced,
  buildProofMomentCommitmentTightened,
  decideVictoryRoomSmsCallout,
  insertSmsCommitmentChangeProofEvent,
} from "@/lib/v2-proof-moment";
import { getDateKeyInTimezone } from "@/lib/timezone";

const BEHAVIOR_MAX = 2000;
const RAW_LOG_MAX = 280;
const AI_REASONING_STORE_MAX = 220;

export function parseSmsConfirmation(raw: string): "yes" | "no" | "ambiguous" {
  const t = raw.trim();
  const lower = t.toLowerCase();
  if (!lower) return "ambiguous";

  if (/^(yes|yep|yeah|yup|y)$/i.test(t)) return "yes";
  if (/^(no|nope|nah|n)$/i.test(t)) return "no";

  if (/\b(do it|that's right|thats right|correct|make it that|sounds good|go ahead|please do|lock it in)\b/i.test(lower)) {
    if (/\b(no|not|wrong|change)\b/i.test(lower)) return "ambiguous";
    return "yes";
  }
  if (/\b(not that|wrong|change it)\b/i.test(lower)) return "no";
  return "ambiguous";
}

function looksLikeCancellation(raw: string): boolean {
  return /\b(never mind|nevermind|forget it|cancel that|skip this|abort)\b/i.test(raw.trim());
}

/** Skip AI when the inbound is almost certainly not a bar candidate (short yes/no, etc.). */
function shouldAttemptAiCandidateExtraction(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 5) return false;
  if (looksLikeCancellation(t)) return false;
  if (t.length <= 20) {
    const conf = parseSmsConfirmation(t);
    if (conf === "yes" || conf === "no") return false;
  }
  return true;
}

const RESERVED_CANDIDATE = /^(yes|no|yep|nope|same|idk|i\s*dk|maybe|ok|okay|nah|sure|n\/a)$/i;

export function isVagueOrInvalidCandidateBar(text: string): boolean {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t || t.length < 3) return true;
  if (t.length > BEHAVIOR_MAX) return true;
  if (RESERVED_CANDIDATE.test(t)) return true;
  if (/^(be better|do better|try harder|just\s+be|more)$/i.test(t)) return true;
  if (/^(my kids|our kids|the kids|whatever)$/i.test(t)) return true;
  if (/^i\s*(don'?t|do not)\s*know\.?$/i.test(t)) return true;
  if (/^(feel healthier|be happier)$/i.test(t)) return true;
  if (t.length < 8 && !/\d/.test(t) && !/\b(walk|read|run|write|pray|call|go|do|lift|study|meditat)/i.test(t)) {
    return true;
  }
  return false;
}

export function extractDeterministicDailyBarCandidate(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;

  const durEx = extractDurationAnchoredBarPhrase(trimmed, BEHAVIOR_MAX);
  if (durEx.mode === "deferred") {
    console.info("[sms-pending-candidate] deterministic_duration_deferred_ai", {
      reason: "bare_duration_rich_context",
      preview: trimmed.slice(0, 120),
    });
  }
  if (durEx.phrase) {
    if (durEx.mode === "widened") {
      console.info("[sms-pending-candidate] deterministic_duration_widened", {
        preview: durEx.phrase.slice(0, 100),
      });
    }
    return durEx.phrase;
  }

  const heur = extractCandidateBarsFromSms(trimmed);
  if (heur.candidateNewBar?.trim()) return heur.candidateNewBar.trim();
  if (heur.candidateTightenedBar?.trim()) return heur.candidateTightenedBar.trim();
  if (/\b(one\s+story|one\s+page|a\s+chapter)\b/i.test(trimmed) && trimmed.length <= 200) {
    return trimmed.slice(0, BEHAVIOR_MAX);
  }
  return trimmed.length >= 3 && trimmed.length <= BEHAVIOR_MAX ? trimmed : null;
}

function clampCandidateForKind(kind: V2PendingResolutionKind, text: string): string | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (kind === "commitment_tighten") {
    return normalizeShrinkProposalBindingText(t);
  }
  if (!t || t.length > BEHAVIOR_MAX) return null;
  return t;
}

async function applySmsReplaceMutation(args: {
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
  behaviorStatement: string;
}): Promise<
  { ok: true; oldCommitmentId: string; newCommitmentId: string } | { ok: false; code: string }
> {
  const { data, error } = await supabaseServer.rpc("v2_apply_guided_commitment_replace_mutation", {
    p_old_commitment_id: args.commitment.id,
    p_clerk_user_id: args.clerkUserId,
    p_new_behavior_statement: args.behaviorStatement,
    p_expected_old_updated_at: args.commitment.updated_at,
    p_now: new Date().toISOString(),
  });
  if (error) return { ok: false, code: `rpc_error:${error.message}` };
  const row = Array.isArray(data) ? data[0] : null;
  const result = typeof row?.result === "string" ? row.result : "error";
  const oldCommitmentId =
    typeof row?.old_commitment_id === "string" ? row.old_commitment_id : args.commitment.id;
  const newCommitmentId =
    typeof row?.new_commitment_id === "string" && row.new_commitment_id.trim()
      ? row.new_commitment_id.trim()
      : "";
  if (result === "applied" || result === "already_applied") {
    if (!newCommitmentId) return { ok: false, code: "missing_new_id" };
    await clearStaleAdaptiveContractColumns(newCommitmentId);
    await recomputeV2CoachingMemory(newCommitmentId, {
      reasonCode:
        result === "already_applied"
          ? "sms_pending_resolution_replace_raced_winner"
          : "sms_pending_resolution_replace",
    });
    return { ok: true, oldCommitmentId, newCommitmentId };
  }
  return { ok: false, code: result };
}

async function applySmsTightenMutation(args: {
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
  proposalBindingText: string;
  inboundMessageSid: string;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  await clearStaleAdaptiveContractColumns(args.commitment.id);
  const c = (await getActiveCommitment(args.clerkUserId)) ?? args.commitment;
  const nowMs = Date.now();
  if (isV2AdaptiveOverlayActive(c, nowMs)) {
    return { ok: false, code: "overlay_already_active" };
  }
  if (isV2PendingProposalValid(c, nowMs)) {
    return { ok: false, code: "proposal_slot_blocked" };
  }

  const dayKey = getDateKeyInTimezone(new Date(), "UTC");
  const idempotencySuffix = `sms_pending:${args.inboundMessageSid}`;

  const persisted = await persistContractOverlayProposed({
    commitmentId: c.id,
    clerkUserId: args.clerkUserId,
    proposalText: args.proposalBindingText,
    dayKey,
    messageSid: args.inboundMessageSid,
    contractKind: "shrink_ask",
    idempotencySuffix,
    expectedUpdatedAt: c.updated_at,
    requireFreshProposalSlot: true,
    skipEventWrite: false,
  });
  if (!persisted.ok) {
    return { ok: false, code: persisted.error };
  }

  const after = (await getActiveCommitment(args.clerkUserId)) ?? c;
  const act = await activateAdaptiveOverlayFromProposal({
    commitmentId: after.id,
    clerkUserId: args.clerkUserId,
    proposalText: args.proposalBindingText,
    inboundMessageSid: args.inboundMessageSid,
    contractKind: "shrink_ask",
    expectedProposalExpiresAt: after.adaptive_proposal_expires_at,
    expectedUpdatedAt: after.updated_at,
  });
  if (!act.ok) {
    return { ok: false, code: act.error ?? "activate_failed" };
  }
  await recomputeV2CoachingMemory(after.id, {
    reasonCode: "sms_pending_resolution_tighten_overlay",
  });
  return { ok: true };
}

function logSmsPending(j: Record<string, unknown>) {
  console.info("[sms-pending-resolution]", { wave: "4.1", ...j });
}

export async function tryHandleSmsInboundPendingResolution(args: {
  job: { message_sid: string; raw_body: string | null };
  clerkUserId: string;
  commitment: ActiveV2CommitmentRow;
}): Promise<{ handled: false } | { handled: true; replyBody: string }> {
  const rawFull = (args.job.raw_body ?? "").trim();
  const rawPreview = rawFull.slice(0, RAW_LOG_MAX);

  await clearPendingResolutionIfExpired(args.commitment.id, args.commitment);
  let c = (await getActiveCommitment(args.clerkUserId)) ?? args.commitment;

  const pending = getPendingResolutionOrNull(c);
  if (!pending?.payload || pending.payload.source !== "sms_inbound") {
    return { handled: false };
  }

  if (pending.kind !== "commitment_replace" && pending.kind !== "commitment_tighten") {
    return { handled: false };
  }

  const payload = pending.payload;
  const smsState = payload.sms_state ?? "awaiting_candidate";

  if (smsState === "confirmed" || smsState === "cancelled") {
    return { handled: false };
  }

  if (c.accountability_phase === "low_pressure_reactivation") {
    await clearPendingResolution(c.id, { expectedUpdatedAt: c.updated_at });
    await recomputeV2CoachingMemory(c.id, { reasonCode: "sms_pending_cleared_paused" });
    logSmsPending({
      pending_resolution_sms_state: smsState,
      confirmation: null,
      mutation_attempted: false,
      mutation_success: false,
      rpc: null,
      old_commitment_id: c.id,
      new_commitment_id: null,
      message_sid: args.job.message_sid,
      raw_text_preview: rawPreview,
      detail: "paused_cleared_pending",
    });
    return {
      handled: true,
      replyBody:
        "I can’t update your commitment while you’re in low-pressure mode. When you’re ready for full accountability again, text me and we’ll set the bar.",
    };
  }

  const kind = pending.kind;

  if (looksLikeCancellation(rawFull) && smsState === "awaiting_candidate") {
    await clearPendingResolution(c.id, { expectedUpdatedAt: c.updated_at });
    await recomputeV2CoachingMemory(c.id, { reasonCode: "sms_pending_resolution_cancelled" });
    logSmsPending({
      pending_resolution_sms_state: "cancelled",
      detected_candidate: null,
      confirmation: "cancel",
      mutation_attempted: false,
      mutation_success: false,
      rpc: null,
      old_commitment_id: c.id,
      new_commitment_id: null,
      message_sid: args.job.message_sid,
      raw_text_preview: rawPreview,
    });
    return {
      handled: true,
      replyBody: "Okay—I’ll drop that update for now. Text me anytime you want to adjust the bar.",
    };
  }

  if (smsState === "awaiting_confirmation") {
    const cand =
      payload.candidate_behavior_statement?.trim() ||
      payload.candidate_tightened_bar?.trim() ||
      payload.candidate_new_bar?.trim() ||
      "";
    if (!cand) {
      await mergeSmsPendingResolutionPayload({
        commitmentId: c.id,
        merge: (prev) => ({
          ...prev,
          sms_state: "awaiting_candidate",
        }),
      });
      return {
        handled: true,
        replyBody:
          "I lost track of the candidate—what exactly should I hold you to tomorrow? One clear action.",
      };
    }

    const conf = parseSmsConfirmation(rawFull);
    if (conf === "ambiguous") {
      logSmsPending({
        pending_resolution_sms_state: "awaiting_confirmation",
        detected_candidate: cand,
        confirmation: "ambiguous",
        mutation_attempted: false,
        mutation_success: false,
        rpc: null,
        old_commitment_id: c.id,
        new_commitment_id: null,
        message_sid: args.job.message_sid,
        raw_text_preview: rawPreview,
      });
      return {
        handled: true,
        replyBody: `I’m still holding: ${cand}. Reply yes to lock it in, or no if you want to change it.`,
      };
    }

    if (conf === "no") {
      const merged = await mergeSmsPendingResolutionPayload({
        commitmentId: c.id,
        merge: (prev) => ({
          ...prev,
          sms_state: "awaiting_candidate",
          candidate_behavior_statement: null,
          candidate_tightened_bar: null,
          candidate_new_bar: null,
          confirmation_prompt_sent_at: null,
        }),
      });
      if (!merged.ok) {
        return {
          handled: true,
          replyBody: "Something glitched—try naming the bar again in one short sentence.",
        };
      }
      logSmsPending({
        pending_resolution_sms_state: "awaiting_candidate",
        detected_candidate: cand,
        confirmation: "no",
        mutation_attempted: false,
        mutation_success: false,
        rpc: null,
        old_commitment_id: c.id,
        new_commitment_id: null,
        message_sid: args.job.message_sid,
        raw_text_preview: rawPreview,
      });
      return {
        handled: true,
        replyBody:
          "No problem—what would work better? Send one clear daily action you want me to hold you to.",
      };
    }

    c = (await getActiveCommitment(args.clerkUserId)) ?? c;

    if (kind === "commitment_replace") {
      logSmsPending({
        pending_resolution_sms_state: "awaiting_confirmation",
        detected_candidate: cand,
        confirmation: "yes",
        mutation_attempted: true,
        mutation_success: false,
        rpc: "v2_apply_guided_commitment_replace_mutation",
        old_commitment_id: c.id,
        new_commitment_id: null,
        message_sid: args.job.message_sid,
        raw_text_preview: rawPreview,
      });
      const rep = await applySmsReplaceMutation({
        clerkUserId: args.clerkUserId,
        commitment: c,
        behaviorStatement: cand,
      });
      if (!rep.ok) {
        logSmsPending({
          pending_resolution_sms_state: "awaiting_confirmation",
          detected_candidate: cand,
          confirmation: "yes",
          mutation_attempted: true,
          mutation_success: false,
          rpc: "v2_apply_guided_commitment_replace_mutation",
          old_commitment_id: c.id,
          new_commitment_id: null,
          message_sid: args.job.message_sid,
          raw_text_preview: rawPreview,
          error: rep.code,
        });
        return {
          handled: true,
          replyBody: `I couldn’t safely update it from here. I still have the candidate: ${cand}. I’ll keep this pending so we don’t lose it.`,
        };
      }
      logSmsPending({
        pending_resolution_sms_state: "confirmed",
        detected_candidate: cand,
        confirmation: "yes",
        mutation_attempted: true,
        mutation_success: true,
        rpc: "v2_apply_guided_commitment_replace_mutation",
        old_commitment_id: rep.oldCommitmentId,
        new_commitment_id: rep.newCommitmentId,
        message_sid: args.job.message_sid,
        raw_text_preview: rawPreview,
      });
      const replaceProof = buildProofMomentCommitmentReplaced();
      const recentReplace = await getRecentV2EventsForAi(rep.newCommitmentId);
      const replaceCallout = decideVictoryRoomSmsCallout({
        proofMeta: replaceProof,
        eventsNewestFirst: recentReplace,
      });
      let replaceReply = `Done. New commitment: ${cand}. I’ll hold you to that tomorrow.`;
      const beforeReplaceCallout = replaceReply;
      replaceReply = appendSmsParagraphIfUnderCap(replaceReply, replaceCallout.appendToReply);
      const replaceCalloutShown =
        replaceCallout.appendToReply != null && replaceReply !== beforeReplaceCallout;
      await insertSmsCommitmentChangeProofEvent({
        commitmentId: rep.newCommitmentId,
        clerkUserId: args.clerkUserId,
        messageSid: args.job.message_sid,
        messagePreview: cand,
        kind: "commitment_replaced",
        victoryCalloutExtras: replaceCalloutShown ? replaceCallout.eventPayloadExtras : undefined,
      });
      return {
        handled: true,
        replyBody: replaceReply,
      };
    }

    const normalized = normalizeShrinkProposalBindingText(cand);
    if (!normalized) {
      return {
        handled: true,
        replyBody:
          "That wording doesn’t fit the safe format from here. What smaller bar should I hold you to—one short sentence?",
      };
    }

    logSmsPending({
      pending_resolution_sms_state: "awaiting_confirmation",
      detected_candidate: cand,
      confirmation: "yes",
      mutation_attempted: true,
      mutation_success: false,
      rpc: "persistContractOverlayProposed+v2_apply_overlay_consent_mutation",
      old_commitment_id: c.id,
      new_commitment_id: null,
      message_sid: args.job.message_sid,
      raw_text_preview: rawPreview,
    });

    const tight = await applySmsTightenMutation({
      clerkUserId: args.clerkUserId,
      commitment: c,
      proposalBindingText: normalized,
      inboundMessageSid: args.job.message_sid,
    });

    if (!tight.ok) {
      logSmsPending({
        pending_resolution_sms_state: "awaiting_confirmation",
        detected_candidate: cand,
        confirmation: "yes",
        mutation_attempted: true,
        mutation_success: false,
        rpc: "persistContractOverlayProposed+v2_apply_overlay_consent_mutation",
        old_commitment_id: c.id,
        new_commitment_id: null,
        message_sid: args.job.message_sid,
        raw_text_preview: rawPreview,
        error: tight.code,
      });
      return {
        handled: true,
        replyBody: `I couldn’t safely update it from here. I still have the candidate: ${cand}. I’ll keep this pending so we don’t lose it.`,
      };
    }

    const reloaded = (await getActiveCommitment(args.clerkUserId)) ?? c;
    await clearPendingResolution(reloaded.id);

    logSmsPending({
      pending_resolution_sms_state: "confirmed",
      detected_candidate: cand,
      confirmation: "yes",
      mutation_attempted: true,
      mutation_success: true,
      rpc: "v2_apply_overlay_consent_mutation",
      old_commitment_id: c.id,
      new_commitment_id: null,
      message_sid: args.job.message_sid,
      raw_text_preview: rawPreview,
    });

    const tightenProof = buildProofMomentCommitmentTightened();
    const recentTighten = await getRecentV2EventsForAi(reloaded.id);
    const tightenCallout = decideVictoryRoomSmsCallout({
      proofMeta: tightenProof,
      eventsNewestFirst: recentTighten,
    });
    let tightenReply = `Done. New bar: ${normalized}. I’ll hold you to that tomorrow.`;
    const beforeTightenCallout = tightenReply;
    tightenReply = appendSmsParagraphIfUnderCap(tightenReply, tightenCallout.appendToReply);
    const tightenCalloutShown =
      tightenCallout.appendToReply != null && tightenReply !== beforeTightenCallout;
    await insertSmsCommitmentChangeProofEvent({
      commitmentId: reloaded.id,
      clerkUserId: args.clerkUserId,
      messageSid: args.job.message_sid,
      messagePreview: normalized,
      kind: "commitment_tightened",
      victoryCalloutExtras: tightenCalloutShown ? tightenCallout.eventPayloadExtras : undefined,
    });
    return {
      handled: true,
      replyBody: tightenReply,
    };
  }

  const extracted = extractDeterministicDailyBarCandidate(rawFull);
  let candidateRaw = extracted ?? rawFull;
  let deterministicGood =
    !isVagueOrInvalidCandidateBar(candidateRaw) && clampCandidateForKind(kind, candidateRaw) !== null;

  let aiMeta: {
    used: boolean;
    accepted: boolean;
    confidence: number | null;
    rejectedReason: string | null;
    reasoningShort: string | null;
  } | null = null;

  if (!deterministicGood && shouldAttemptAiCandidateExtraction(rawFull)) {
    const aiRes = await tryExtractV2SmsPendingResolutionCandidateAi({
      rawInbound: rawFull,
      pendingKind: kind,
      behaviorStatementPreview: c.behavior_statement?.trim() ?? "",
    });

    if (aiRes.attempted && aiRes.ok) {
      const d = aiRes.data;
      const rs = d.reasoning_short.slice(0, AI_REASONING_STORE_MAX);
      const confidenceOk =
        d.has_candidate &&
        d.confidence >= V2_SMS_PENDING_CANDIDATE_CONFIDENCE_MIN &&
        !d.needs_clarification;
      const aiText = d.candidate_behavior_statement?.trim() ?? "";

      if (confidenceOk && aiText) {
        if (!isVagueOrInvalidCandidateBar(aiText) && clampCandidateForKind(kind, aiText)) {
          candidateRaw = aiText;
          deterministicGood = true;
          aiMeta = {
            used: true,
            accepted: true,
            confidence: d.confidence,
            rejectedReason: null,
            reasoningShort: rs,
          };
        } else {
          aiMeta = {
            used: true,
            accepted: false,
            confidence: d.confidence,
            rejectedReason: "validation_failed",
            reasoningShort: rs,
          };
        }
      } else {
        aiMeta = {
          used: true,
          accepted: false,
          confidence: d.confidence,
          rejectedReason: !d.has_candidate
            ? "no_candidate"
            : d.needs_clarification
              ? "needs_clarification"
              : d.confidence < V2_SMS_PENDING_CANDIDATE_CONFIDENCE_MIN
                ? "low_confidence"
                : "needs_clarification",
          reasoningShort: rs,
        };
      }
    } else if (aiRes.attempted && !aiRes.ok) {
      aiMeta = {
        used: true,
        accepted: false,
        confidence: null,
        rejectedReason: aiRes.reason,
        reasoningShort: null,
      };
    }
  }

  if (!deterministicGood) {
    if (aiMeta?.used) {
      const meta = aiMeta;
      await mergeSmsPendingResolutionPayload({
        commitmentId: c.id,
        merge: (prev) => ({
          ...prev,
          ai_candidate_extraction_used: true,
          ai_candidate_confidence: meta.confidence,
          ai_candidate_accepted: false,
          ai_candidate_rejected_reason: meta.rejectedReason,
          ai_reasoning_short: meta.reasoningShort,
        }),
      });
    }
    logSmsPending({
      pending_resolution_sms_state: "awaiting_candidate",
      detected_candidate: null,
      confirmation: null,
      mutation_attempted: false,
      mutation_success: false,
      rpc: null,
      old_commitment_id: c.id,
      new_commitment_id: null,
      message_sid: args.job.message_sid,
      raw_text_preview: rawPreview,
      vague: true,
      ai_candidate_extraction: aiMeta,
    });
    return {
      handled: true,
      replyBody:
        "I need the new bar to be one clear action. What exactly should I hold you to tomorrow?",
    };
  }

  const clamped = clampCandidateForKind(kind, candidateRaw);
  if (!clamped) {
    return {
      handled: true,
      replyBody:
        kind === "commitment_tighten"
          ? "That’s too long or unclear for a tightened bar here—what’s one shorter honest version?"
          : "That text doesn’t fit as a commitment here—try one clear daily-action sentence.",
    };
  }

  const mergedOk = await mergeSmsPendingResolutionPayload({
    commitmentId: c.id,
    merge: (prev) => ({
      ...prev,
      sms_state: "awaiting_confirmation",
      candidate_behavior_statement: clamped,
      candidate_tightened_bar: kind === "commitment_tighten" ? clamped : prev.candidate_tightened_bar,
      candidate_new_bar: kind === "commitment_replace" ? clamped : prev.candidate_new_bar,
      confirmation_prompt_sent_at: new Date().toISOString(),
      ...(aiMeta?.accepted
        ? {
            ai_candidate_extraction_used: true,
            ai_candidate_confidence: aiMeta.confidence,
            ai_candidate_accepted: true,
            ai_candidate_rejected_reason: null,
            ai_reasoning_short: aiMeta.reasoningShort,
          }
        : {
            ai_candidate_extraction_used: false,
            ai_candidate_confidence: null,
            ai_candidate_accepted: null,
            ai_candidate_rejected_reason: null,
            ai_reasoning_short: null,
          }),
    }),
  });
  if (!mergedOk.ok) {
    return {
      handled: true,
      replyBody: "Something glitched saving that—try your candidate again in one short sentence.",
    };
  }

  logSmsPending({
    pending_resolution_sms_state: "awaiting_confirmation",
    detected_candidate: clamped,
    confirmation: "prompted",
    mutation_attempted: false,
    mutation_success: false,
    rpc: null,
    old_commitment_id: c.id,
    new_commitment_id: null,
    message_sid: args.job.message_sid,
    raw_text_preview: rawPreview,
    ai_candidate_extraction: aiMeta,
  });

  if (kind === "commitment_tighten") {
    return {
      handled: true,
      replyBody: `I can tighten it to: ${clamped}. Should I make that the new daily bar?`,
    };
  }
  return {
    handled: true,
    replyBody: `I can change it to: ${clamped}. Should I make that your new commitment?`,
  };
}
