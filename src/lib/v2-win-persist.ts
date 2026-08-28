/**
 * v2_win persistence — idempotent insert of OpenAI-recognized Wins
 * and server-owned accountability (user_yes) Wins.
 * Ownership/source fields are server-supplied; OpenAI never sets them.
 */

import { supabaseServer } from "@/lib/supabase-server";
import {
  WIN_FIELD_LIMITS,
  WIN_RECOGNITION_VERSION,
  type WinCandidateV1,
  type WinRecognitionResultV1,
  type WinRelationshipTypeV1,
} from "@/lib/openai-win-recognition-v1";
import {
  accountabilityActionFactForEquivalence,
  buildAccountabilityWinIdempotencyKey,
  mergeInboundWinsForPersistence,
  type AccountabilityWinPresentation,
} from "@/lib/v2-win-accountability-merge";
import {
  classifyWinCandidatesEquivalenceV1,
  equivalenceMapFromJudgments,
  type WinEquivalenceJudgment,
} from "@/lib/openai-win-candidate-equivalence-v1";
import { normalizeSolTrophyTitle } from "@/lib/inbound-sol-coaching-brief";
import { limitWinDisplayTitleOrFallback } from "@/lib/v2-win-display-title";

export type WinSourceType = "sms_inbound" | "system_event";

export type PersistRecognizedWinsArgs = {
  clerkUserId: string;
  sourceType: WinSourceType;
  sourceMessageSid: string | null;
  sourceMessageId: string | null;
  sourceEventId: string | null;
  /** Active commitment id owned by the same user; may be omitted for whole-life. */
  activeCommitmentId: string | null;
  activeCommitmentClerkUserId: string | null;
  occurredAtIso: string;
  recognition: WinRecognitionResultV1;
};

export type PersistWinCandidateStatus = "inserted" | "existing" | "failed" | "skipped";

export type PersistRecognizedWinsResult = {
  attempted: number;
  persisted: number;
  conflicts: number;
  failed: number;
  allDurable: boolean;
  wins: Array<{
    ordinal: 0 | 1;
    id: string | null;
    status: PersistWinCandidateStatus;
    idempotency_key: string | null;
  }>;
};

export function buildWinIdempotencyKey(args: {
  sourceType: WinSourceType;
  messageSid?: string | null;
  sourceEventId?: string | null;
  ordinal: 0 | 1;
}): string {
  if (args.sourceType === "sms_inbound") {
    const sid = (args.messageSid ?? "").trim();
    if (!sid) throw new Error("win_idempotency_requires_message_sid");
    return `win_v1:${sid}:${args.ordinal}`;
  }
  const eid = (args.sourceEventId ?? "").trim();
  if (!eid) throw new Error("win_idempotency_requires_source_event_id");
  return `win_v1:system:${eid}:${args.ordinal}`;
}

/** Dedicated namespace for confirmed user_yes → Win (distinct from recognition :0/:1). */
export { buildAccountabilityWinIdempotencyKey };

function relationshipAllowsCommitment(rel: WinRelationshipTypeV1): boolean {
  return rel === "goal" || rel === "mixed";
}

function resolveCommitmentIdForCandidate(args: {
  candidate: WinCandidateV1;
  activeCommitmentId: string | null;
  activeCommitmentClerkUserId: string | null;
  clerkUserId: string;
}): string | null {
  if (!relationshipAllowsCommitment(args.candidate.relationship_type)) return null;
  const cid = args.activeCommitmentId?.trim() || null;
  if (!cid) return null;
  const owner = args.activeCommitmentClerkUserId?.trim() || null;
  if (!owner || owner !== args.clerkUserId) return null;
  return cid;
}

export type V2WinInsertRow = {
  clerk_user_id: string;
  source_type: WinSourceType;
  source_message_sid: string | null;
  source_message_id: string | null;
  source_event_id: string | null;
  commitment_id: string | null;
  occurred_at: string;
  action_fact: string;
  why_meaningful: string | null;
  display_title: string;
  display_body: string;
  supporting_quote: string | null;
  relationship_type: WinRelationshipTypeV1;
  recognition_mode: WinCandidateV1["recognition_mode"];
  user_expressed_pride: boolean;
  identity_related: boolean;
  sensitivity_caution: boolean;
  celebration_appropriate: boolean;
  status: "active";
  candidate_ordinal: 0 | 1;
  idempotency_key: string;
  schema_version: typeof WIN_RECOGNITION_VERSION;
  model_confidence: number | null;
};

export function buildV2WinInsertRow(args: {
  clerkUserId: string;
  sourceType: WinSourceType;
  sourceMessageSid: string | null;
  sourceMessageId: string | null;
  sourceEventId: string | null;
  activeCommitmentId: string | null;
  activeCommitmentClerkUserId: string | null;
  occurredAtIso: string;
  candidate: WinCandidateV1;
}): V2WinInsertRow {
  const clerk = args.clerkUserId.trim();
  if (!clerk) throw new Error("win_persist_requires_clerk_user_id");
  if (args.sourceType === "sms_inbound") {
    const sid = (args.sourceMessageSid ?? "").trim();
    if (!sid) throw new Error("win_persist_sms_requires_message_sid");
  }

  const supportingQuote = args.candidate.sensitivity_caution
    ? null
    : args.candidate.evidence_quote
      ? args.candidate.evidence_quote.slice(0, WIN_FIELD_LIMITS.supporting_quote)
      : null;

  return {
    clerk_user_id: clerk,
    source_type: args.sourceType,
    source_message_sid:
      args.sourceType === "sms_inbound" ? (args.sourceMessageSid ?? "").trim() : args.sourceMessageSid,
    source_message_id: args.sourceMessageId,
    source_event_id: args.sourceEventId,
    commitment_id: resolveCommitmentIdForCandidate({
      candidate: args.candidate,
      activeCommitmentId: args.activeCommitmentId,
      activeCommitmentClerkUserId: args.activeCommitmentClerkUserId,
      clerkUserId: clerk,
    }),
    occurred_at: args.occurredAtIso,
    action_fact: args.candidate.grounded_action.slice(0, WIN_FIELD_LIMITS.action_fact),
    why_meaningful: args.candidate.why_meaningful
      ? args.candidate.why_meaningful.slice(0, WIN_FIELD_LIMITS.why_meaningful)
      : null,
    display_title: limitWinDisplayTitleOrFallback(args.candidate.suggested_title),
    display_body: args.candidate.suggested_body.slice(0, WIN_FIELD_LIMITS.display_body),
    supporting_quote: supportingQuote,
    relationship_type: args.candidate.relationship_type,
    recognition_mode: args.candidate.recognition_mode,
    user_expressed_pride: args.candidate.user_expressed_pride,
    identity_related: args.candidate.identity_related,
    sensitivity_caution: args.candidate.sensitivity_caution,
    celebration_appropriate: args.candidate.celebration_appropriate,
    status: "active",
    candidate_ordinal: args.candidate.ordinal,
    idempotency_key: buildWinIdempotencyKey({
      sourceType: args.sourceType,
      messageSid: args.sourceMessageSid,
      sourceEventId: args.sourceEventId,
      ordinal: args.candidate.ordinal,
    }),
    schema_version: WIN_RECOGNITION_VERSION,
    model_confidence: args.candidate.model_confidence,
  };
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("duplicate key") || msg.includes("unique constraint");
}

async function lookupExistingWinByKey(idempotencyKey: string): Promise<{
  id: string;
  status: string;
} | null> {
  const { data, error } = await supabaseServer
    .from("v2_win")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error || !data?.id) return null;
  return {
    id: typeof data.id === "string" ? data.id : String(data.id),
    status: typeof data.status === "string" ? data.status : "active",
  };
}

async function lookupSmsInboundMessageId(messageSid: string): Promise<string | null> {
  const sid = messageSid.trim();
  if (!sid) return null;
  const { data, error } = await supabaseServer
    .from("sms_inbound_messages")
    .select("id")
    .eq("message_sid", sid)
    .maybeSingle();
  if (error || !data?.id) return null;
  return typeof data.id === "string" ? data.id : String(data.id);
}

async function lookupInboundReceivedAt(messageSid: string): Promise<string | null> {
  const sid = messageSid.trim();
  if (!sid) return null;
  const { data, error } = await supabaseServer
    .from("sms_inbound_messages")
    .select("received_at")
    .eq("message_sid", sid)
    .maybeSingle();
  if (error || !data?.received_at) return null;
  return typeof data.received_at === "string" ? data.received_at : String(data.received_at);
}

export async function resolveSmsInboundWinSource(args: {
  messageSid: string;
  fallbackOccurredAtIso?: string | null;
}): Promise<{ sourceMessageId: string | null; occurredAtIso: string }> {
  const sid = args.messageSid.trim();
  const [sourceMessageId, receivedAt] = await Promise.all([
    lookupSmsInboundMessageId(sid),
    lookupInboundReceivedAt(sid),
  ]);
  return {
    sourceMessageId,
    occurredAtIso:
      receivedAt ??
      args.fallbackOccurredAtIso ??
      new Date().toISOString(),
  };
}

async function insertV2WinRow(
  row: V2WinInsertRow
): Promise<{
  status: PersistWinCandidateStatus;
  id: string | null;
  idempotency_key: string;
}> {
  const { data, error } = await supabaseServer
    .from("v2_win")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (!error && data?.id) {
    return {
      status: "inserted",
      id: typeof data.id === "string" ? data.id : String(data.id),
      idempotency_key: row.idempotency_key,
    };
  }

  if (isUniqueViolation(error)) {
    const existing = await lookupExistingWinByKey(row.idempotency_key);
    return {
      status: "existing",
      id: existing?.id ?? null,
      idempotency_key: row.idempotency_key,
    };
  }

  console.warn("[win_persist_failed]", {
    ordinal: row.candidate_ordinal,
    code: error?.code ?? null,
    schema_version: WIN_RECOGNITION_VERSION,
  });
  return {
    status: "failed",
    id: null,
    idempotency_key: row.idempotency_key,
  };
}

export function buildAccountabilityV2WinInsertRow(args: {
  clerkUserId: string;
  messageSid: string;
  sourceMessageId: string | null;
  sourceEventId: string | null;
  commitmentId: string;
  occurredAtIso: string;
  presentation: AccountabilityWinPresentation;
}): V2WinInsertRow {
  const clerk = args.clerkUserId.trim();
  if (!clerk) throw new Error("win_persist_requires_clerk_user_id");
  const sid = args.messageSid.trim();
  if (!sid) throw new Error("win_persist_sms_requires_message_sid");
  const cid = args.commitmentId.trim();
  if (!cid) throw new Error("acc_yes_win_requires_commitment_id");

  return {
    clerk_user_id: clerk,
    source_type: "sms_inbound",
    source_message_sid: sid,
    source_message_id: args.sourceMessageId,
    source_event_id: args.sourceEventId,
    commitment_id: cid,
    occurred_at: args.occurredAtIso,
    action_fact: args.presentation.action_fact.slice(0, WIN_FIELD_LIMITS.action_fact),
    why_meaningful: args.presentation.why_meaningful
      ? args.presentation.why_meaningful.slice(0, WIN_FIELD_LIMITS.why_meaningful)
      : null,
    display_title: limitWinDisplayTitleOrFallback(args.presentation.display_title),
    display_body: args.presentation.display_body.slice(0, WIN_FIELD_LIMITS.display_body),
    supporting_quote: args.presentation.supporting_quote
      ? args.presentation.supporting_quote.slice(0, WIN_FIELD_LIMITS.supporting_quote)
      : null,
    relationship_type: args.presentation.relationship_type,
    recognition_mode: args.presentation.recognition_mode,
    user_expressed_pride: args.presentation.user_expressed_pride,
    identity_related: args.presentation.identity_related,
    sensitivity_caution: args.presentation.sensitivity_caution,
    celebration_appropriate: args.presentation.celebration_appropriate,
    status: "active",
    candidate_ordinal: 0,
    idempotency_key: buildAccountabilityWinIdempotencyKey(sid),
    schema_version: WIN_RECOGNITION_VERSION,
    model_confidence: args.presentation.model_confidence,
  };
}

export async function lookupUserYesEventIdByMessageSid(
  messageSid: string
): Promise<string | null> {
  const sid = messageSid.trim();
  if (!sid) return null;
  const key = `v2_user_yes:${sid}`;
  const { data, error } = await supabaseServer
    .from("v2_commitment_event")
    .select("id")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (error || !data?.id) return null;
  return typeof data.id === "string" ? data.id : String(data.id);
}

/**
 * Persist zero/one/two recognized Wins. Unique conflicts = existing success.
 * Hidden existing rows are not restored; key remains consumed.
 */
export async function persistRecognizedWins(
  args: PersistRecognizedWinsArgs
): Promise<PersistRecognizedWinsResult> {
  const empty: PersistRecognizedWinsResult = {
    attempted: 0,
    persisted: 0,
    conflicts: 0,
    failed: 0,
    allDurable: true,
    wins: [],
  };

  if (!args.recognition.has_win || args.recognition.wins.length === 0) {
    return empty;
  }

  if (args.sourceType === "sms_inbound") {
    const sid = (args.sourceMessageSid ?? "").trim();
    if (!sid) {
      console.warn("[win_persist_failed]", {
        reason: "missing_source_message_sid",
        schema_version: WIN_RECOGNITION_VERSION,
      });
      return {
        attempted: args.recognition.wins.length,
        persisted: 0,
        conflicts: 0,
        failed: args.recognition.wins.length,
        allDurable: false,
        wins: args.recognition.wins.map((w) => ({
          ordinal: w.ordinal,
          id: null,
          status: "failed" as const,
          idempotency_key: null,
        })),
      };
    }
  }

  const clerk = args.clerkUserId.trim();
  if (!clerk) {
    return {
      attempted: args.recognition.wins.length,
      persisted: 0,
      conflicts: 0,
      failed: args.recognition.wins.length,
      allDurable: false,
      wins: args.recognition.wins.map((w) => ({
        ordinal: w.ordinal,
        id: null,
        status: "failed" as const,
        idempotency_key: null,
      })),
    };
  }

  const result: PersistRecognizedWinsResult = {
    attempted: 0,
    persisted: 0,
    conflicts: 0,
    failed: 0,
    allDurable: true,
    wins: [],
  };

  for (const candidate of args.recognition.wins) {
    result.attempted += 1;
    let row: V2WinInsertRow;
    try {
      row = buildV2WinInsertRow({
        clerkUserId: clerk,
        sourceType: args.sourceType,
        sourceMessageSid: args.sourceMessageSid,
        sourceMessageId: args.sourceMessageId,
        sourceEventId: args.sourceEventId,
        activeCommitmentId: args.activeCommitmentId,
        activeCommitmentClerkUserId: args.activeCommitmentClerkUserId,
        occurredAtIso: args.occurredAtIso,
        candidate,
      });
    } catch (e) {
      result.failed += 1;
      result.allDurable = false;
      result.wins.push({
        ordinal: candidate.ordinal,
        id: null,
        status: "failed",
        idempotency_key: null,
      });
      console.warn("[win_persist_failed]", {
        ordinal: candidate.ordinal,
        reason: e instanceof Error ? e.message.slice(0, 80) : "build_row_failed",
        schema_version: WIN_RECOGNITION_VERSION,
      });
      continue;
    }

    const inserted = await insertV2WinRow(row);
    if (inserted.status === "inserted") {
      result.persisted += 1;
      result.wins.push({
        ordinal: candidate.ordinal,
        id: inserted.id,
        status: "inserted",
        idempotency_key: inserted.idempotency_key,
      });
      console.log("[win_persist_inserted]", {
        ordinal: candidate.ordinal,
        relationship_type: candidate.relationship_type,
        schema_version: WIN_RECOGNITION_VERSION,
        message_sid: args.sourceMessageSid ? "(present)" : null,
      });
      continue;
    }

    if (inserted.status === "existing") {
      result.conflicts += 1;
      result.wins.push({
        ordinal: candidate.ordinal,
        id: inserted.id,
        status: "existing",
        idempotency_key: inserted.idempotency_key,
      });
      console.log("[win_persist_existing]", {
        ordinal: candidate.ordinal,
        schema_version: WIN_RECOGNITION_VERSION,
      });
      continue;
    }

    result.failed += 1;
    result.allDurable = false;
    result.wins.push({
      ordinal: candidate.ordinal,
      id: null,
      status: "failed",
      idempotency_key: inserted.idempotency_key,
    });
  }

  if (result.failed > 0) result.allDurable = false;
  return result;
}

export type PersistInboundWinsWithAccountabilityArgs = {
  clerkUserId: string;
  messageSid: string;
  sourceMessageId: string | null;
  /** Persisted user_yes event id when known; looked up if null. */
  userYesEventId: string | null;
  commitmentId: string;
  occurredAtIso: string;
  effectiveAsk?: string | null;
  behaviorStatement?: string | null;
  recognition: WinRecognitionResultV1 | null;
  /** Latest inbound text for same/distinct classification. */
  inboundMessage?: string | null;
  /**
   * Optional precomputed equivalence map (tests / injected judgments).
   * When omitted, OpenAI equivalence helper runs (with documented fallback).
   */
  equivalenceByOrdinal?: Record<number, WinEquivalenceJudgment> | null;
  /**
   * Display-only title overlays. Applied after merge. Never creates Wins.
   * Never writes action_fact / display_body / supporting_quote / grounded_action.
   * Mini callers omit this (current titles unchanged).
   */
  displayTitleOverrides?: {
    accountability?: string | null;
    independent?: string | null;
  };
};

/**
 * Narrow partial-job reconciliation:
 * If an older recognition-only path left win_v1:${sid}:0 as an active goal/mixed
 * completion Win for this user+commitment, hide it when ensuring acc_yes so the
 * same MessageSid does not keep two durable completion rows.
 * Never touches whole_life/identity rows or other users/commitments.
 */
export async function hideStaleRecognitionCompletionWinForAccountability(args: {
  messageSid: string;
  clerkUserId: string;
  commitmentId: string;
}): Promise<{ hid: boolean; id: string | null }> {
  const sid = args.messageSid.trim();
  const clerk = args.clerkUserId.trim();
  const cid = args.commitmentId.trim();
  if (!sid || !clerk || !cid) return { hid: false, id: null };

  const key = buildWinIdempotencyKey({
    sourceType: "sms_inbound",
    messageSid: sid,
    ordinal: 0,
  });

  const { data, error } = await supabaseServer
    .from("v2_win")
    .select("id, status, relationship_type, commitment_id, clerk_user_id")
    .eq("idempotency_key", key)
    .maybeSingle();

  if (error || !data?.id) return { hid: false, id: null };
  if (data.status !== "active") return { hid: false, id: null };
  if (data.clerk_user_id !== clerk) return { hid: false, id: null };
  if (data.commitment_id !== cid) return { hid: false, id: null };
  if (data.relationship_type !== "goal" && data.relationship_type !== "mixed") {
    return { hid: false, id: null };
  }

  const now = new Date().toISOString();
  const { error: updErr } = await supabaseServer
    .from("v2_win")
    .update({
      status: "hidden",
      hidden_at: now,
      hidden_reason: "superseded_by_accountability_user_yes_win",
    })
    .eq("id", data.id)
    .eq("status", "active");

  if (updErr) {
    console.warn("[win_persist_stale_recognition_hide_failed]", {
      schema_version: WIN_RECOGNITION_VERSION,
      error: updErr.message.slice(0, 120),
    });
    return { hid: false, id: typeof data.id === "string" ? data.id : String(data.id) };
  }

  console.log("[win_persist_stale_recognition_hidden]", {
    schema_version: WIN_RECOGNITION_VERSION,
    ordinal: 0,
    reason: "superseded_by_accountability_user_yes_win",
  });
  return { hid: true, id: typeof data.id === "string" ? data.id : String(data.id) };
}

/**
 * After confirmed user_yes: ensure accountability Win + at most one DISTINCT recognized Win.
 * SAME candidates may donate wording; DISTINCT (any relationship_type) may survive as ordinal 1.
 */
export async function persistInboundWinsWithAccountability(
  args: PersistInboundWinsWithAccountabilityArgs
): Promise<PersistRecognizedWinsResult> {
  const sid = args.messageSid.trim();
  const clerk = args.clerkUserId.trim();
  const commitmentId = args.commitmentId.trim();

  const empty: PersistRecognizedWinsResult = {
    attempted: 0,
    persisted: 0,
    conflicts: 0,
    failed: 0,
    allDurable: true,
    wins: [],
  };

  if (!sid || !clerk || !commitmentId) {
    return {
      ...empty,
      allDurable: false,
      failed: 1,
    };
  }

  const recognitionWins =
    args.recognition?.has_win && Array.isArray(args.recognition.wins)
      ? args.recognition.wins
      : [];

  let equivalenceByOrdinal = args.equivalenceByOrdinal ?? null;
  if (!equivalenceByOrdinal && recognitionWins.length > 0) {
    const currentGoal =
      (typeof args.effectiveAsk === "string" && args.effectiveAsk.trim()) ||
      (typeof args.behaviorStatement === "string" && args.behaviorStatement.trim()) ||
      null;
    const batch = await classifyWinCandidatesEquivalenceV1({
      currentGoal,
      inboundMessage: args.inboundMessage ?? "",
      accountabilityActionFact: accountabilityActionFactForEquivalence({
        effectiveAsk: args.effectiveAsk,
        behaviorStatement: args.behaviorStatement,
      }),
      candidates: recognitionWins,
    });
    equivalenceByOrdinal = equivalenceMapFromJudgments(batch.judgments);
  }

  const plan = mergeInboundWinsForPersistence({
    userYesConfirmed: true,
    recognition: args.recognition,
    effectiveAsk: args.effectiveAsk,
    behaviorStatement: args.behaviorStatement,
    equivalenceByOrdinal,
  });

  if (!plan.accountability) {
    return empty;
  }

  const accTitleOverride = normalizeSolTrophyTitle(args.displayTitleOverrides?.accountability);
  const accountability = accTitleOverride
    ? { ...plan.accountability, display_title: accTitleOverride }
    : plan.accountability;

  const independentTitleOverride = normalizeSolTrophyTitle(
    args.displayTitleOverrides?.independent
  );
  const independent =
    plan.independent && independentTitleOverride
      ? { ...plan.independent, suggested_title: independentTitleOverride }
      : plan.independent;

  let sourceEventId = args.userYesEventId?.trim() || null;
  if (!sourceEventId) {
    sourceEventId = await lookupUserYesEventIdByMessageSid(sid);
  }

  // Partial-job: hide stale recognition :0 goal/mixed completion before acc_yes ensure.
  await hideStaleRecognitionCompletionWinForAccountability({
    messageSid: sid,
    clerkUserId: clerk,
    commitmentId,
  });

  const result: PersistRecognizedWinsResult = {
    attempted: 0,
    persisted: 0,
    conflicts: 0,
    failed: 0,
    allDurable: true,
    wins: [],
  };

  // 1) Accountability Win (ordinal 0, dedicated idempotency)
  result.attempted += 1;
  try {
    const accRow = buildAccountabilityV2WinInsertRow({
      clerkUserId: clerk,
      messageSid: sid,
      sourceMessageId: args.sourceMessageId,
      sourceEventId,
      commitmentId,
      occurredAtIso: args.occurredAtIso,
      presentation: accountability,
    });
    const accInsert = await insertV2WinRow(accRow);
    if (accInsert.status === "inserted") {
      result.persisted += 1;
      result.wins.push({
        ordinal: 0,
        id: accInsert.id,
        status: "inserted",
        idempotency_key: accInsert.idempotency_key,
      });
      console.log("[win_persist_inserted]", {
        ordinal: 0,
        kind: "accountability_user_yes",
        presentation_source: accountability.presentation_source,
        suppressed_same_candidates: plan.suppressed_same_candidate_count,
        schema_version: WIN_RECOGNITION_VERSION,
      });
    } else if (accInsert.status === "existing") {
      result.conflicts += 1;
      result.wins.push({
        ordinal: 0,
        id: accInsert.id,
        status: "existing",
        idempotency_key: accInsert.idempotency_key,
      });
    } else {
      result.failed += 1;
      result.allDurable = false;
      result.wins.push({
        ordinal: 0,
        id: null,
        status: "failed",
        idempotency_key: accInsert.idempotency_key,
      });
    }
  } catch (e) {
    result.failed += 1;
    result.allDurable = false;
    result.wins.push({
      ordinal: 0,
      id: null,
      status: "failed",
      idempotency_key: null,
    });
    console.warn("[win_persist_failed]", {
      kind: "accountability_user_yes",
      reason: e instanceof Error ? e.message.slice(0, 80) : "build_row_failed",
      schema_version: WIN_RECOGNITION_VERSION,
    });
  }

  // 2) Distinct recognized Win only (normalized ordinal 1; any relationship_type)
  if (independent) {
    result.attempted += 1;
    try {
      const indRow = buildV2WinInsertRow({
        clerkUserId: clerk,
        sourceType: "sms_inbound",
        sourceMessageSid: sid,
        sourceMessageId: args.sourceMessageId,
        sourceEventId: null,
        activeCommitmentId: commitmentId,
        activeCommitmentClerkUserId: clerk,
        occurredAtIso: args.occurredAtIso,
        candidate: independent,
      });
      const indInsert = await insertV2WinRow(indRow);
      if (indInsert.status === "inserted") {
        result.persisted += 1;
        result.wins.push({
          ordinal: 1,
          id: indInsert.id,
          status: "inserted",
          idempotency_key: indInsert.idempotency_key,
        });
        console.log("[win_persist_inserted]", {
          ordinal: 1,
          kind: "distinct_recognized",
          relationship_type: independent.relationship_type,
          schema_version: WIN_RECOGNITION_VERSION,
        });
      } else if (indInsert.status === "existing") {
        result.conflicts += 1;
        result.wins.push({
          ordinal: 1,
          id: indInsert.id,
          status: "existing",
          idempotency_key: indInsert.idempotency_key,
        });
      } else {
        result.failed += 1;
        result.allDurable = false;
        result.wins.push({
          ordinal: 1,
          id: null,
          status: "failed",
          idempotency_key: indInsert.idempotency_key,
        });
      }
    } catch (e) {
      result.failed += 1;
      result.allDurable = false;
      result.wins.push({
        ordinal: 1,
        id: null,
        status: "failed",
        idempotency_key: null,
      });
      console.warn("[win_persist_failed]", {
        kind: "distinct_recognized",
        reason: e instanceof Error ? e.message.slice(0, 80) : "build_row_failed",
        schema_version: WIN_RECOGNITION_VERSION,
      });
    }
  }

  if (result.failed > 0) result.allDurable = false;
  return result;
}
