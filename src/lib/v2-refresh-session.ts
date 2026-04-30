import crypto from "crypto";

import { supabaseServer } from "@/lib/supabase-server";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { isV2PendingProposalValid } from "@/lib/v2-adaptive-contract";
import {
  getPendingResolutionOrNull,
  isPendingResolutionExpired,
} from "@/lib/v2-guided-resolution";
import {
  V2_IDENTITY_REFERENCE_COOLDOWN_MS,
  isIdentityRefreshDue,
  isQuotableIdentitySource,
  parseIsoMs as parseIsoMsFromProfile,
} from "@/lib/v2-identity-anchor";

/** Minimum calendar days before abandoning an unanswered identity step. */
export const V2_REFRESH_IDENTITY_ABANDON_DAYS = 7;

/** Throttle starting a new refresh session after last identity prompt. */
export const V2_REFRESH_SESSION_START_THROTTLE_MS = V2_IDENTITY_REFERENCE_COOLDOWN_MS;

/** Minimum active commitment age (days) before a NEW refresh_session cold start. Override via env. */
export function getV2RefreshMinCommitmentAgeDays(): number {
  const raw = process.env.V2_REFRESH_MIN_COMMITMENT_AGE_DAYS?.trim();
  if (!raw) return 21;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 21;
  return n;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** True when commitment has been active long enough for Wave 1 refresh cold start. */
export function isActiveCommitmentMatureForRefreshColdStart(
  startedAtIso: string | null | undefined,
  nowMs: number
): boolean {
  const t = parseIso(typeof startedAtIso === "string" ? startedAtIso : null);
  if (t == null) return false;
  const minDays = getV2RefreshMinCommitmentAgeDays();
  return nowMs - t >= minDays * MS_PER_DAY;
}

export type V2RefreshSessionStep = "identity" | "commitment";

export type V2RefreshSessionState = {
  session_id: string;
  step: V2RefreshSessionStep;
  started_at: string;
  channel: "sms";
  clarifications_remaining: number;
  /** True after Step B copy was delivered (inbound reply after STILL or daily Step B). */
  commitment_prompt_delivered?: boolean;
};

function parseIso(iso: string | null | undefined): number | null {
  return parseIsoMsFromProfile(iso);
}

export function parseRefreshSession(raw: unknown): V2RefreshSessionState | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const sessionId = typeof o.session_id === "string" ? o.session_id.trim() : "";
  const step = o.step === "identity" || o.step === "commitment" ? o.step : null;
  const startedAt = typeof o.started_at === "string" ? o.started_at.trim() : "";
  const channel = o.channel === "sms" ? "sms" : null;
  const cr =
    typeof o.clarifications_remaining === "number" && Number.isFinite(o.clarifications_remaining)
      ? Math.max(0, Math.floor(o.clarifications_remaining))
      : null;
  if (!sessionId || !step || !startedAt || !channel || cr == null) return null;
  const commitment_prompt_delivered = o.commitment_prompt_delivered === true;
  return {
    session_id: sessionId,
    step,
    started_at: startedAt,
    channel,
    clarifications_remaining: cr,
    commitment_prompt_delivered,
  };
}

export function isRefreshSessionActive(row: ActiveV2CommitmentRow): boolean {
  return parseRefreshSession(row.refresh_session) != null;
}

export type Wave1ColdStartRefreshInput = {
  nowMs: number;
  commitment: ActiveV2CommitmentRow;
  identityAnchorText: string | null | undefined;
  identitySource: string | null | undefined;
  identityRefreshDueAt: string | null | undefined;
  identityRefreshLastPromptedAt: string | null | undefined;
  commitmentRefreshLastPromptedAt: string | null | undefined;
};

export type Wave1ColdStartRefreshResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Wave 1: start identity_first cold refresh only when identity is due, anchor is quotable,
 * commitment is mature, and safety gates pass. Commitment-only refresh is deferred.
 */
export function computeWave1ColdStartRefreshEligible(
  args: Wave1ColdStartRefreshInput
): Wave1ColdStartRefreshResult {
  const anchor =
    typeof args.identityAnchorText === "string" ? args.identityAnchorText.trim() : "";
  if (!anchor) return { ok: false, reason: "no_anchor" };

  if (!isQuotableIdentitySource(args.identitySource)) {
    return { ok: false, reason: "anchor_not_quotable" };
  }

  if (args.commitment.accountability_phase === "low_pressure_reactivation") {
    return { ok: false, reason: "low_pressure_reactivation" };
  }
  if (isV2PendingProposalValid(args.commitment, args.nowMs)) {
    return { ok: false, reason: "pending_adaptive_proposal" };
  }
  if (parseRefreshSession(args.commitment.refresh_session) != null) {
    return { ok: false, reason: "active_refresh_session" };
  }

  const pending = getPendingResolutionOrNull(args.commitment);
  if (pending && !isPendingResolutionExpired(args.commitment, args.nowMs)) {
    return { ok: false, reason: "pending_resolution" };
  }

  if (!isActiveCommitmentMatureForRefreshColdStart(args.commitment.started_at, args.nowMs)) {
    return { ok: false, reason: "below_maturity" };
  }

  if (!isIdentityRefreshDue(args.identityRefreshDueAt, args.nowMs)) {
    return { ok: false, reason: "identity_not_due" };
  }

  const lastIdentityPrompt = parseIso(
    typeof args.identityRefreshLastPromptedAt === "string"
      ? args.identityRefreshLastPromptedAt
      : null
  );
  if (
    lastIdentityPrompt != null &&
    args.nowMs - lastIdentityPrompt < V2_REFRESH_SESSION_START_THROTTLE_MS
  ) {
    return { ok: false, reason: "identity_prompt_throttle" };
  }

  return { ok: true };
}

export function shouldAbandonStaleIdentityStep(
  session: V2RefreshSessionState,
  nowMs: number
): boolean {
  if (session.step !== "identity") return false;
  const t = parseIso(session.started_at);
  if (t == null) return true;
  return nowMs - t >= V2_REFRESH_IDENTITY_ABANDON_DAYS * 24 * 60 * 60 * 1000;
}

export function newRefreshSessionIdentityStep(nowIso: string): V2RefreshSessionState {
  return {
    session_id: crypto.randomUUID(),
    step: "identity",
    started_at: nowIso,
    channel: "sms",
    clarifications_remaining: 1,
    commitment_prompt_delivered: false,
  };
}

export function advanceSessionToCommitment(
  session: V2RefreshSessionState,
  nowIso: string
): V2RefreshSessionState {
  return {
    ...session,
    step: "commitment",
    started_at: nowIso,
    /** Set true only after Step B SMS is successfully sent (daily cron or inbound pipeline). */
    commitment_prompt_delivered: false,
  };
}

export type V2RefreshInboundToken =
  | "STILL"
  | "CHANGE"
  | "KEEP"
  | "TIGHTEN"
  | "NEW"
  | "UNKNOWN";

export type V2RefreshCommitmentResolution =
  | "keep"
  | "tighten"
  | "new"
  | "aborted_unclear";

export type V2RefreshCommitmentResolutionMutationResult =
  | "applied"
  | "already_applied"
  | "state_conflict"
  | "not_found"
  | "error";

export type V2RefreshIdentityResolution =
  | "still"
  | "change"
  | "clarify_identity"
  | "aborted_unclear";

export type V2RefreshIdentityResolutionMutationResult =
  | "applied"
  | "already_applied"
  | "state_conflict"
  | "not_found"
  | "error";

export type V2RefreshPromptedPostSendMutationResult =
  | "applied"
  | "already_applied"
  | "state_conflict"
  | "not_found"
  | "error";

/** Strict token parse — no AI, no fuzzy matching. */
export function parseRefreshInboundToken(raw: string): V2RefreshInboundToken {
  const t = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (t === "STILL") return "STILL";
  if (t === "CHANGE") return "CHANGE";
  if (t === "KEEP") return "KEEP";
  if (t === "TIGHTEN") return "TIGHTEN";
  if (t === "NEW") return "NEW";
  return "UNKNOWN";
}

/** Hedging / complaint phrases — conservative UNKNOWN (prefer clarify over wrong token). */
const REFRESH_NATURAL_LANGUAGE_DOUBT_RE =
  /\b(still not|not sure|same problem|don'?t know|dont know|hard to say|not convinced)\b/i;

/**
 * Deterministic phrase mapping for refresh inbound only. Exact STILL/CHANGE/KEEP/TIGHTEN/NEW always win first.
 * Otherwise only high-confidence short phrases match; doubtful wording → UNKNOWN.
 */
export function parseRefreshInboundWithNaturalLanguage(
  raw: string,
  step: "identity" | "commitment"
): V2RefreshInboundToken {
  const exact = parseRefreshInboundToken(raw);
  if (exact !== "UNKNOWN") return exact;

  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return "UNKNOWN";

  if (/^(ok|okay|k|ya|yep|maybe|idk|\?)$/.test(normalized)) return "UNKNOWN";
  if (/^(yes|no)$/.test(normalized)) return "UNKNOWN";

  if (REFRESH_NATURAL_LANGUAGE_DOUBT_RE.test(normalized)) return "UNKNOWN";

  if (step === "identity") {
    const changeClear =
      /\b(change it|not true anymore|not right anymore|life shifted|that'?s not right|thats not right)\b/.test(
        normalized
      );
    if (changeClear) return "CHANGE";

    const stillClear =
      /^same[.!?]?$/.test(normalized) ||
      /\b(still fits|yes it fits|that still fits|that still fit|that'?s still true|thats still true)\b/.test(
        normalized
      ) ||
      /\b(keep it|keep that|keep the same)\b/.test(normalized);
    if (stillClear) return "STILL";

    return "UNKNOWN";
  }

  if (
    /\b(new goal|different goal|change goal|not this anymore|new commitment)\b/.test(normalized)
  ) {
    return "NEW";
  }
  if (
    /\b(make it smaller|make it easier|tighten|simplify|lower the bar|ease up)\b/.test(normalized)
  ) {
    return "TIGHTEN";
  }

  const keepClear =
    /^same[.!?]?$/.test(normalized) ||
    /\b(keep it|keep the same|same goal|same focus|still the right focus)\b/.test(normalized);
  if (keepClear) return "KEEP";

  return "UNKNOWN";
}

export async function applyRefreshCommitmentStepResolutionMutation(args: {
  commitmentId: string;
  clerkUserId: string;
  inboundMessageSid: string;
  resolution: V2RefreshCommitmentResolution;
  expectedSessionId?: string | null;
  expectedUpdatedAt?: string | null;
}): Promise<
  | {
      ok: true;
      result: V2RefreshCommitmentResolutionMutationResult;
      updatedAt: string | null;
      pendingResolutionKind: string | null;
    }
  | {
      ok: false;
      result?: V2RefreshCommitmentResolutionMutationResult;
      error: string;
      updatedAt?: string | null;
      pendingResolutionKind?: string | null;
    }
> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseServer.rpc(
    "v2_apply_refresh_commitment_step_resolution_mutation",
    {
      p_commitment_id: args.commitmentId,
      p_clerk_user_id: args.clerkUserId,
      p_inbound_message_sid: args.inboundMessageSid,
      p_resolution: args.resolution,
      p_expected_session_id:
        typeof args.expectedSessionId === "string" ? args.expectedSessionId : null,
      p_expected_updated_at:
        typeof args.expectedUpdatedAt === "string" ? args.expectedUpdatedAt : null,
      p_now: nowIso,
    }
  );
  if (error) {
    return {
      ok: false,
      error: `refresh_commitment_resolution_rpc_failed:${error.message}`,
    };
  }

  const row = Array.isArray(data) ? data[0] : null;
  const result =
    typeof row?.result === "string"
      ? (row.result as V2RefreshCommitmentResolutionMutationResult)
      : "error";
  const updatedAt =
    typeof row?.updated_at === "string"
      ? row.updated_at
      : row?.updated_at != null
        ? String(row.updated_at)
        : null;
  const pendingResolutionKind =
    typeof row?.pending_resolution_kind === "string" ? row.pending_resolution_kind : null;

  if (result === "applied") {
    return { ok: true, result, updatedAt, pendingResolutionKind };
  }
  return {
    ok: false,
    result,
    error: `refresh_commitment_resolution_${result}`,
    updatedAt,
    pendingResolutionKind,
  };
}

export async function applyRefreshIdentityStepResolutionMutation(args: {
  commitmentId: string;
  clerkUserId: string;
  inboundMessageSid: string;
  resolution: V2RefreshIdentityResolution;
  expectedSessionId?: string | null;
  expectedUpdatedAt?: string | null;
}): Promise<
  | {
      ok: true;
      result: V2RefreshIdentityResolutionMutationResult;
      updatedAt: string | null;
      pendingResolutionKind: string | null;
      refreshSessionStep: string | null;
    }
  | {
      ok: false;
      result?: V2RefreshIdentityResolutionMutationResult;
      error: string;
      updatedAt?: string | null;
      pendingResolutionKind?: string | null;
      refreshSessionStep?: string | null;
    }
> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseServer.rpc(
    "v2_apply_refresh_identity_step_resolution_mutation",
    {
      p_commitment_id: args.commitmentId,
      p_clerk_user_id: args.clerkUserId,
      p_inbound_message_sid: args.inboundMessageSid,
      p_resolution: args.resolution,
      p_expected_session_id:
        typeof args.expectedSessionId === "string" ? args.expectedSessionId : null,
      p_expected_updated_at:
        typeof args.expectedUpdatedAt === "string" ? args.expectedUpdatedAt : null,
      p_now: nowIso,
    }
  );
  if (error) {
    return {
      ok: false,
      error: `refresh_identity_resolution_rpc_failed:${error.message}`,
    };
  }

  const row = Array.isArray(data) ? data[0] : null;
  const result =
    typeof row?.result === "string"
      ? (row.result as V2RefreshIdentityResolutionMutationResult)
      : "error";
  const updatedAt =
    typeof row?.updated_at === "string"
      ? row.updated_at
      : row?.updated_at != null
        ? String(row.updated_at)
        : null;
  const pendingResolutionKind =
    typeof row?.pending_resolution_kind === "string" ? row.pending_resolution_kind : null;
  const refreshSessionStep =
    typeof row?.refresh_session_step === "string" && row.refresh_session_step.trim()
      ? row.refresh_session_step.trim()
      : null;

  if (result === "applied") {
    return { ok: true, result, updatedAt, pendingResolutionKind, refreshSessionStep };
  }
  return {
    ok: false,
    result,
    error: `refresh_identity_resolution_${result}`,
    updatedAt,
    pendingResolutionKind,
    refreshSessionStep,
  };
}

export async function applyRefreshPromptedPostSendBookkeepingMutation(args: {
  commitmentId: string;
  clerkUserId: string;
  messageSid: string;
  promptStep: "identity" | "commitment";
  promptKind: "identity_first" | "identity_reminder" | "commitment_daily";
  bodyPreview: string;
  nextRefreshSession: V2RefreshSessionState;
  expectedSessionId?: string | null;
  expectedUpdatedAt?: string | null;
}): Promise<
  | { ok: true; result: V2RefreshPromptedPostSendMutationResult; updatedAt: string | null }
  | {
      ok: false;
      result?: V2RefreshPromptedPostSendMutationResult;
      error: string;
      updatedAt?: string | null;
    }
> {
  const call = async () =>
    supabaseServer.rpc("v2_apply_refresh_prompted_post_send_bookkeeping_mutation", {
      p_commitment_id: args.commitmentId,
      p_clerk_user_id: args.clerkUserId,
      p_message_sid: args.messageSid,
      p_prompt_step: args.promptStep,
      p_prompt_kind: args.promptKind,
      p_body_preview: args.bodyPreview,
      p_next_refresh_session: args.nextRefreshSession,
      p_expected_session_id:
        typeof args.expectedSessionId === "string" ? args.expectedSessionId : null,
      p_expected_updated_at:
        typeof args.expectedUpdatedAt === "string" ? args.expectedUpdatedAt : null,
      p_now: new Date().toISOString(),
    });

  let data: unknown;
  let error: { message: string } | null = null;
  const first = await call();
  data = first.data;
  error = first.error as { message: string } | null;

  // Minimal in-process recovery: one immediate retry for transient DB/network hiccups.
  if (error) {
    const second = await call();
    data = second.data;
    error = second.error as { message: string } | null;
  }

  if (error) {
    return {
      ok: false,
      error: `refresh_prompted_post_send_rpc_failed:${error.message}`,
    };
  }

  const row = Array.isArray(data) ? data[0] : null;
  const result =
    typeof row?.result === "string"
      ? (row.result as V2RefreshPromptedPostSendMutationResult)
      : "error";
  const updatedAt =
    typeof row?.updated_at === "string"
      ? row.updated_at
      : row?.updated_at != null
        ? String(row.updated_at)
        : null;

  if (result === "applied") {
    return { ok: true, result, updatedAt };
  }
  return {
    ok: false,
    result,
    error: `refresh_prompted_post_send_${result}`,
    updatedAt,
  };
}

export async function persistRefreshSession(
  commitmentId: string,
  session: V2RefreshSessionState | null,
  options?: { expectedUpdatedAt?: string | null }
): Promise<string | null> {
  let q = supabaseServer
    .from("v2_commitment")
    .update({
      refresh_session: session,
      updated_at: new Date().toISOString(),
    })
    .eq("id", commitmentId);
  if (typeof options?.expectedUpdatedAt === "string" && options.expectedUpdatedAt.trim()) {
    q = q.eq("updated_at", options.expectedUpdatedAt.trim());
  }
  const { data, error } = await q.select("updated_at").maybeSingle();

  if (error) {
    throw new Error(`[v2-refresh-session] persistRefreshSession failed: ${error.message}`);
  }
  if (typeof options?.expectedUpdatedAt === "string" && options.expectedUpdatedAt.trim() && !data) {
    throw new Error(
      `[v2-refresh-session] persistRefreshSession CAS mismatch for commitment_id=${commitmentId}`
    );
  }
  if (!data) {
    throw new Error(
      `[v2-refresh-session] persistRefreshSession no rows updated for commitment_id=${commitmentId}`
    );
  }
  return typeof data.updated_at === "string" ? data.updated_at : null;
}

export async function insertCoachingRefreshPrompted(args: {
  commitmentId: string;
  clerkUserId: string;
  sessionId: string;
  step: V2RefreshSessionStep;
  messageSid: string;
  bodyPreview: string;
}): Promise<void> {
  const { error } = await supabaseServer.from("v2_commitment_event").insert({
    commitment_id: args.commitmentId,
    clerk_user_id: args.clerkUserId,
    event_type: "coaching_refresh_prompted",
    source: "sms_v2_accountability",
    payload_json: {
      session_id: args.sessionId,
      step: args.step,
      message_sid: args.messageSid,
      body_preview: args.bodyPreview.slice(0, 160),
    },
    idempotency_key: `v2_coaching_refresh_prompted:${args.commitmentId}:${args.sessionId}:${args.step}:${args.messageSid}`,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code !== "23505") {
      console.error("[v2-refresh-session] coaching_refresh_prompted insert failed", {
        commitment_id: args.commitmentId,
        message: error.message,
      });
    }
  }
}

export async function insertCoachingRefreshResolved(args: {
  commitmentId: string;
  clerkUserId: string;
  sessionId: string;
  step: V2RefreshSessionStep;
  resolution: string;
  inboundMessageSid?: string | null;
}): Promise<void> {
  const { error } = await supabaseServer.from("v2_commitment_event").insert({
    commitment_id: args.commitmentId,
    clerk_user_id: args.clerkUserId,
    event_type: "coaching_refresh_resolved",
    source: "sms_v2_accountability",
    payload_json: {
      session_id: args.sessionId,
      step: args.step,
      resolution: args.resolution,
      ...(args.inboundMessageSid ? { inbound_message_sid: args.inboundMessageSid } : {}),
    },
    idempotency_key: `v2_coaching_refresh_resolved:${args.commitmentId}:${args.sessionId}:${args.step}:${args.resolution}:${args.inboundMessageSid ?? "none"}`,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code !== "23505") {
      console.error("[v2-refresh-session] coaching_refresh_resolved insert failed", {
        commitment_id: args.commitmentId,
        message: error.message,
      });
    }
  }
}

/** Step A: trusted identity line appears verbatim in body (caller must ensure quotable source). */
export function buildRefreshStepIdentitySms(args: {
  identityAnchorText: string;
}): { body: string; templateId: number } {
  const a = args.identityAnchorText.trim();
  const body = `Quick alignment—not your daily score. Does this still fit who you’re becoming? “${a}” Same vibe, or life shifted? Say same or change—either works.`;
  return { body, templateId: 81 };
}

/** Step B: effective ask snippet must appear verbatim in body. */
export function buildRefreshStepCommitmentSms(args: { effectiveAsk: string }): { body: string; templateId: number } {
  const ask = args.effectiveAsk.trim();
  const body = `Does this commitment still fit, or does it need to get smaller or change? Today’s bar: ${ask} Tell me keep, smaller, or new goal—in your own words is fine.`;
  return { body, templateId: 82 };
}

export function buildRefreshClarifyIdentitySms(): { body: string; templateId: number } {
  return {
    body: "I may be reading that wrong. Does that identity line still fit, or do you want to change it in the app?",
    templateId: 83,
  };
}

export function buildRefreshClarifyCommitmentSms(): { body: string; templateId: number } {
  return {
    body: "Want to be sure—keep this same focus, make the bar smaller for now, or pick a new focus in the app?",
    templateId: 84,
  };
}

export function buildRefreshChangeFollowupSms(): { body: string; templateId: number } {
  return {
    body: "Got it. Update your identity line in the app when you can—I’ll keep holding you to today’s bar until you do.",
    templateId: 85,
  };
}

export function buildRefreshTightenFollowupSms(): { body: string; templateId: number } {
  return {
    body: "Noted. No change yet—when a smaller window fits, the next daily check may offer a simple yes-or-no on trying a tighter window.",
    templateId: 86,
  };
}

export function buildRefreshNewFollowupSms(): { body: string; templateId: number } {
  return {
    body: "Understood. Pick or update your commitment in the app when you’re ready—same number, no new goals from me here.",
    templateId: 87,
  };
}

export function buildRefreshKeepAckSms(): { body: string; templateId: number } {
  return {
    body: "Got it—keeping this same focus for accountability. Back to normal checks.",
    templateId: 88,
  };
}

export async function touchCommitmentRefreshPromptedTimestamp(commitmentId: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabaseServer
    .from("v2_commitment")
    .update({
      commitment_refresh_last_prompted_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", commitmentId);
  if (error) {
    console.error("[v2-refresh-session] touchCommitmentRefreshPromptedTimestamp failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
  }
}

export type V2RefreshOutboundKind = "identity_first" | "identity_reminder" | "commitment_daily";

export type V2RefreshOutboundPlan = {
  kind: V2RefreshOutboundKind;
  session: V2RefreshSessionState;
};

/**
 * After Twilio success for a refresh outbound: persist session, throttling timestamps, spine prompted row.
 */
export async function onV2RefreshOutboundSendSuccess(args: {
  commitmentId: string;
  clerkUserId: string;
  messageSid: string;
  smsBody: string;
  plan: V2RefreshOutboundPlan;
}): Promise<void> {
  const applied = await applyRefreshPromptedPostSendBookkeepingMutation({
    commitmentId: args.commitmentId,
    clerkUserId: args.clerkUserId,
    messageSid: args.messageSid,
    promptStep: args.plan.session.step,
    promptKind: args.plan.kind,
    bodyPreview: args.smsBody,
    nextRefreshSession: args.plan.session,
    expectedSessionId: args.plan.session.session_id,
  });
  if (!applied.ok) {
    throw new Error(`refresh_post_send_bookkeeping_failed:${applied.error}`);
  }
}

type RefreshCheckSentCandidate = {
  commitment_id: string;
  occurred_at: string;
  payload_json: Record<string, unknown>;
};

type RefreshReplayCandidate = {
  messageSid: string;
  sessionId: string;
  step: "identity" | "commitment";
  kind: "identity_first" | "identity_reminder" | "commitment_daily";
  bodyPreview: string;
  startedAtIso: string;
  nextRefreshSession: V2RefreshSessionState;
  source: "snapshot" | "heuristic_check_sent";
};

type RefreshOutboundIntentSnapshotRow = {
  commitment_id: string;
  message_sid: string;
  refresh_session_id: string;
  refresh_step: "identity" | "commitment";
  prompt_kind: "identity_first" | "identity_reminder" | "commitment_daily";
  body_preview: string;
  intended_next_refresh_session: unknown;
  expected_session_id: string | null;
  expected_updated_at: string | null;
  source_wrapped_at: string;
};

function parseRefreshReplayCandidateFromCheckSent(row: RefreshCheckSentCandidate): RefreshReplayCandidate | null {
  const payload = row.payload_json ?? {};
  const messageSid =
    typeof payload.message_sid === "string" ? payload.message_sid.trim() : "";
  const coachingRefresh =
    payload.coaching_refresh &&
    typeof payload.coaching_refresh === "object" &&
    !Array.isArray(payload.coaching_refresh)
      ? (payload.coaching_refresh as Record<string, unknown>)
      : null;
  if (!coachingRefresh || !messageSid) return null;

  const sessionId =
    typeof coachingRefresh.session_id === "string" ? coachingRefresh.session_id.trim() : "";
  const step = coachingRefresh.step === "identity" || coachingRefresh.step === "commitment"
    ? coachingRefresh.step
    : null;
  const kind =
    coachingRefresh.outbound_kind === "identity_first" ||
    coachingRefresh.outbound_kind === "identity_reminder" ||
    coachingRefresh.outbound_kind === "commitment_daily"
      ? coachingRefresh.outbound_kind
      : null;
  if (!sessionId || !step || !kind) return null;

  const bodyPreview =
    typeof payload.body_preview === "string" ? payload.body_preview.slice(0, 160) : "";
  const startedAtIso =
    typeof row.occurred_at === "string" && row.occurred_at.trim()
      ? row.occurred_at
      : new Date().toISOString();

  const nextRefreshSession: V2RefreshSessionState =
    step === "identity"
      ? {
          session_id: sessionId,
          step: "identity",
          started_at: startedAtIso,
          channel: "sms",
          clarifications_remaining: 1,
          commitment_prompt_delivered: false,
        }
      : {
          session_id: sessionId,
          step: "commitment",
          started_at: startedAtIso,
          channel: "sms",
          clarifications_remaining: 1,
          commitment_prompt_delivered: true,
        };

  return {
    messageSid,
    sessionId,
    step,
    kind,
    bodyPreview,
    startedAtIso,
    nextRefreshSession,
    source: "heuristic_check_sent",
  };
}

function parseRefreshReplayCandidateFromSnapshot(
  row: RefreshOutboundIntentSnapshotRow
): RefreshReplayCandidate | null {
  const messageSid = typeof row.message_sid === "string" ? row.message_sid.trim() : "";
  const sessionId =
    typeof row.refresh_session_id === "string" ? row.refresh_session_id.trim() : "";
  const step = row.refresh_step === "identity" || row.refresh_step === "commitment"
    ? row.refresh_step
    : null;
  const kind =
    row.prompt_kind === "identity_first" ||
    row.prompt_kind === "identity_reminder" ||
    row.prompt_kind === "commitment_daily"
      ? row.prompt_kind
      : null;
  const startedAtIso =
    typeof row.source_wrapped_at === "string" && row.source_wrapped_at.trim()
      ? row.source_wrapped_at
      : new Date().toISOString();
  const bodyPreview = typeof row.body_preview === "string" ? row.body_preview.slice(0, 160) : "";
  const nextRefreshSession = parseRefreshSession(row.intended_next_refresh_session);

  if (!messageSid || !sessionId || !step || !kind || !nextRefreshSession) return null;

  return {
    messageSid,
    sessionId,
    step,
    kind,
    bodyPreview,
    startedAtIso,
    nextRefreshSession,
    source: "snapshot",
  };
}

async function hasPromptedEventForReplayKey(args: {
  commitmentId: string;
  sessionId: string;
  step: "identity" | "commitment";
  messageSid: string;
}): Promise<boolean> {
  const { data: prompted } = await supabaseServer
    .from("v2_commitment_event")
    .select("id")
    .eq("commitment_id", args.commitmentId)
    .eq("event_type", "coaching_refresh_prompted")
    .contains("payload_json", {
      session_id: args.sessionId,
      step: args.step,
      message_sid: args.messageSid,
    })
    .limit(1)
    .maybeSingle();
  return Boolean(prompted?.id);
}

export async function reconcileRefreshPostSendBookkeepingForCommitment(args: {
  commitmentId: string;
  clerkUserId: string;
  maxCandidates?: number;
}): Promise<{
  attempted: number;
  recovered: number;
  failures: number;
  stateConflicts: number;
  rpcFailures: number;
  repeatedLikely: number;
  snapshotCandidatesFound: number;
  snapshotReplayAttempted: number;
  snapshotReplayApplied: number;
  heuristicFallbackAttempted: number;
  heuristicFallbackApplied: number;
  unresolvedAfterBoth: number;
}> {
  const limit = Math.max(1, Math.min(10, args.maxCandidates ?? 5));
  const snapshotReadLimit = Math.max(limit * 2, 10);
  const { data: snapshotRows, error: snapshotError } = await supabaseServer
    .from("v2_refresh_outbound_intent_snapshot")
    .select(
      "commitment_id,message_sid,refresh_session_id,refresh_step,prompt_kind,body_preview,intended_next_refresh_session,expected_session_id,expected_updated_at,source_wrapped_at"
    )
    .eq("commitment_id", args.commitmentId)
    .order("source_wrapped_at", { ascending: false })
    .limit(snapshotReadLimit);

  const snapshotByReplayKey = new Map<string, RefreshReplayCandidate>();
  if (!snapshotError && snapshotRows?.length) {
    for (const raw of snapshotRows as RefreshOutboundIntentSnapshotRow[]) {
      const parsed = parseRefreshReplayCandidateFromSnapshot(raw);
      if (!parsed) continue;
      const key = `${args.commitmentId}:${parsed.sessionId}:${parsed.step}:${parsed.messageSid}`;
      if (!snapshotByReplayKey.has(key)) {
        snapshotByReplayKey.set(key, parsed);
      }
    }
  }

  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("occurred_at,payload_json")
    .eq("commitment_id", args.commitmentId)
    .eq("event_type", "check_sent")
    .order("occurred_at", { ascending: false })
    .limit(limit);

  const checkSentRows: RefreshCheckSentCandidate[] = !error && data?.length
    ? (data as RefreshCheckSentCandidate[])
    : [];

  let attempted = 0;
  let recovered = 0;
  let failures = 0;
  let stateConflicts = 0;
  let rpcFailures = 0;
  let repeatedLikely = 0;
  const snapshotCandidatesFound = snapshotByReplayKey.size;
  let snapshotReplayAttempted = 0;
  let snapshotReplayApplied = 0;
  let heuristicFallbackAttempted = 0;
  let heuristicFallbackApplied = 0;
  const keySeen = new Map<string, number>();

  for (const row of checkSentRows) {
    const heuristic = parseRefreshReplayCandidateFromCheckSent(row);
    if (!heuristic) continue;
    const replayKey = `${args.commitmentId}:${heuristic.sessionId}:${heuristic.step}:${heuristic.messageSid}`;
    const candidate = snapshotByReplayKey.get(replayKey) ?? heuristic;
    const promptedAlready = await hasPromptedEventForReplayKey({
      commitmentId: args.commitmentId,
      sessionId: candidate.sessionId,
      step: candidate.step,
      messageSid: candidate.messageSid,
    });
    if (promptedAlready) continue;

    const keyForDedup = `${args.commitmentId}:${candidate.sessionId}:${candidate.step}:${candidate.messageSid}`;
    if (keySeen.has(keyForDedup)) continue;
    keySeen.set(keyForDedup, 1);

    const candidateAgeMin = Math.floor(
      Math.max(0, Date.now() - new Date(candidate.startedAtIso).getTime()) / 60000
    );
    attempted += 1;

    const replay = await applyRefreshPromptedPostSendBookkeepingMutation({
      commitmentId: args.commitmentId,
      clerkUserId: args.clerkUserId,
      messageSid: candidate.messageSid,
      promptStep: candidate.step,
      promptKind: candidate.kind,
      bodyPreview: candidate.bodyPreview,
      nextRefreshSession: candidate.nextRefreshSession,
      // Keep legacy guard for missing initial session on identity_first heuristic fallback.
      expectedSessionId:
        candidate.source === "heuristic_check_sent" && candidate.kind === "identity_first"
          ? null
          : candidate.sessionId,
    });
    if (candidate.source === "snapshot") snapshotReplayAttempted += 1;
    else heuristicFallbackAttempted += 1;

    if (replay.ok || replay.result === "already_applied") {
      recovered += 1;
      if (candidate.source === "snapshot") snapshotReplayApplied += 1;
      else heuristicFallbackApplied += 1;
    } else {
      failures += 1;
      const reason =
        replay.result === "state_conflict"
          ? "state_conflict"
          : replay.error.startsWith("refresh_prompted_post_send_rpc_failed:")
            ? "rpc_error"
            : replay.result ?? "unknown_error";
      if (reason === "state_conflict") stateConflicts += 1;
      if (reason === "rpc_error") rpcFailures += 1;
      const repeated = candidateAgeMin >= 30 || (keySeen.get(keyForDedup) ?? 0) > 1;
      if (repeated) repeatedLikely += 1;
      console.error("[v2-refresh-session] refresh post-send reconcile replay failed", {
        commitment_id: args.commitmentId,
        session_id: candidate.sessionId,
        message_sid: candidate.messageSid,
        replay_key: keyForDedup,
        source: candidate.source,
        reason,
        age_minutes: candidateAgeMin,
        repeated_likely: repeated,
        result: replay.result ?? "unknown",
        error: replay.error,
      });
    }

    if (attempted >= limit) break;
  }

  if (attempted < limit && snapshotByReplayKey.size > 0) {
    for (const [replayKey, candidate] of snapshotByReplayKey) {
      if (attempted >= limit) break;
      if (keySeen.has(replayKey)) continue;

      const promptedAlready = await hasPromptedEventForReplayKey({
        commitmentId: args.commitmentId,
        sessionId: candidate.sessionId,
        step: candidate.step,
        messageSid: candidate.messageSid,
      });
      if (promptedAlready) continue;

      keySeen.set(replayKey, 1);
      const candidateAgeMin = Math.floor(
        Math.max(0, Date.now() - new Date(candidate.startedAtIso).getTime()) / 60000
      );
      attempted += 1;

      const replay = await applyRefreshPromptedPostSendBookkeepingMutation({
        commitmentId: args.commitmentId,
        clerkUserId: args.clerkUserId,
        messageSid: candidate.messageSid,
        promptStep: candidate.step,
        promptKind: candidate.kind,
        bodyPreview: candidate.bodyPreview,
        nextRefreshSession: candidate.nextRefreshSession,
        expectedSessionId: candidate.sessionId,
      });
      snapshotReplayAttempted += 1;

      if (replay.ok || replay.result === "already_applied") {
        recovered += 1;
        snapshotReplayApplied += 1;
      } else {
        failures += 1;
        const reason =
          replay.result === "state_conflict"
            ? "state_conflict"
            : replay.error.startsWith("refresh_prompted_post_send_rpc_failed:")
              ? "rpc_error"
              : replay.result ?? "unknown_error";
        if (reason === "state_conflict") stateConflicts += 1;
        if (reason === "rpc_error") rpcFailures += 1;
        const repeated = candidateAgeMin >= 30 || (keySeen.get(replayKey) ?? 0) > 1;
        if (repeated) repeatedLikely += 1;
        console.error("[v2-refresh-session] refresh post-send reconcile replay failed", {
          commitment_id: args.commitmentId,
          session_id: candidate.sessionId,
          message_sid: candidate.messageSid,
          replay_key: replayKey,
          source: candidate.source,
          reason,
          age_minutes: candidateAgeMin,
          repeated_likely: repeated,
          result: replay.result ?? "unknown",
          error: replay.error,
        });
      }
    }
  }

  if (failures > 0) {
    console.warn("[v2-refresh-session] reconcile summary", {
      commitment_id: args.commitmentId,
      attempted,
      recovered,
      failures,
      state_conflicts: stateConflicts,
      rpc_failures: rpcFailures,
      repeated_likely: repeatedLikely,
      snapshot_candidates_found: snapshotCandidatesFound,
      snapshot_replay_attempted: snapshotReplayAttempted,
      snapshot_replay_applied: snapshotReplayApplied,
      heuristic_fallback_attempted: heuristicFallbackAttempted,
      heuristic_fallback_applied: heuristicFallbackApplied,
      unresolved_after_both: failures,
    });
  }

  const unresolvedAfterBoth = failures;
  console.log("[v2-refresh-session] reconcile mode usage", {
    commitment_id: args.commitmentId,
    attempted,
    recovered,
    failures,
    snapshot_candidates_found: snapshotCandidatesFound,
    snapshot_replay_attempted: snapshotReplayAttempted,
    snapshot_replay_applied: snapshotReplayApplied,
    heuristic_fallback_attempted: heuristicFallbackAttempted,
    heuristic_fallback_applied: heuristicFallbackApplied,
    unresolved_after_both: unresolvedAfterBoth,
  });

  return {
    attempted,
    recovered,
    failures,
    stateConflicts,
    rpcFailures,
    repeatedLikely,
    snapshotCandidatesFound,
    snapshotReplayAttempted,
    snapshotReplayApplied,
    heuristicFallbackAttempted,
    heuristicFallbackApplied,
    unresolvedAfterBoth,
  };
}

export type RefreshReconcileUnresolvedCase = {
  replay_key: string;
  commitment_id: string;
  session_id: string;
  step: "identity" | "commitment";
  message_sid: string;
  reason: "missing_prompted_event";
  age_minutes: number;
  repeated_likely: boolean;
  where_seen: "daily-sms";
};

export async function loadRecentUnresolvedRefreshReconcileCases(
  maxCases: number = 40
): Promise<RefreshReconcileUnresolvedCase[]> {
  const readLimit = Math.max(20, Math.min(400, maxCases * 6));
  const { data: snapshotRows } = await supabaseServer
    .from("v2_refresh_outbound_intent_snapshot")
    .select("commitment_id,message_sid,refresh_session_id,refresh_step,prompt_kind,body_preview,intended_next_refresh_session,source_wrapped_at")
    .order("source_wrapped_at", { ascending: false })
    .limit(readLimit);
  const snapshotByReplayKey = new Set<string>();
  for (const raw of (snapshotRows ?? []) as RefreshOutboundIntentSnapshotRow[]) {
    const candidate = parseRefreshReplayCandidateFromSnapshot(raw);
    if (!candidate) continue;
    snapshotByReplayKey.add(
      `${raw.commitment_id ?? ""}:${candidate.sessionId}:${candidate.step}:${candidate.messageSid}`
    );
  }

  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("commitment_id,occurred_at,payload_json")
    .eq("event_type", "check_sent")
    .order("occurred_at", { ascending: false })
    .limit(readLimit);

  if (error || !data?.length) return [];

  const keyCount = new Map<string, number>();
  const unresolved: RefreshReconcileUnresolvedCase[] = [];
  const seen = new Set<string>();

  for (const row of data as RefreshCheckSentCandidate[]) {
    const candidate = parseRefreshReplayCandidateFromCheckSent(row);
    if (!candidate) continue;

    const replayKey = `${row.commitment_id}:${candidate.sessionId}:${candidate.step}:${candidate.messageSid}`;
    keyCount.set(replayKey, (keyCount.get(replayKey) ?? 0) + 1);

    const { data: prompted } = await supabaseServer
      .from("v2_commitment_event")
      .select("id")
      .eq("commitment_id", row.commitment_id)
      .eq("event_type", "coaching_refresh_prompted")
      .contains("payload_json", {
        session_id: candidate.sessionId,
        step: candidate.step,
        message_sid: candidate.messageSid,
      })
      .limit(1)
      .maybeSingle();
    if (prompted?.id) continue;

    if (seen.has(replayKey)) continue;
    seen.add(replayKey);

    const ageMinutes = Math.floor(
      Math.max(0, Date.now() - new Date(candidate.startedAtIso).getTime()) / 60000
    );
    const repeatedLikely = ageMinutes >= 30 || (keyCount.get(replayKey) ?? 0) > 1;

    unresolved.push({
      replay_key: replayKey,
      commitment_id: row.commitment_id,
      session_id: candidate.sessionId,
      step: candidate.step,
      message_sid: candidate.messageSid,
      reason: "missing_prompted_event",
      age_minutes: ageMinutes,
      repeated_likely: repeatedLikely,
      where_seen: "daily-sms",
    });

    if (unresolved.length >= maxCases) break;
  }

  return unresolved.sort((a, b) => b.age_minutes - a.age_minutes);
}

export async function abandonRefreshSessionTimeout(args: {
  commitmentId: string;
  clerkUserId: string;
  session: V2RefreshSessionState;
}): Promise<void> {
  await insertCoachingRefreshResolved({
    commitmentId: args.commitmentId,
    clerkUserId: args.clerkUserId,
    sessionId: args.session.session_id,
    step: "identity",
    resolution: "aborted_timeout",
  });
  await persistRefreshSession(args.commitmentId, null);
}
