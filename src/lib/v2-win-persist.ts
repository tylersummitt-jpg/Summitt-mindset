/**
 * v2_win persistence — idempotent insert of OpenAI-recognized Wins.
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
    display_title: args.candidate.suggested_title.slice(0, WIN_FIELD_LIMITS.display_title),
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

    const { data, error } = await supabaseServer
      .from("v2_win")
      .insert(row)
      .select("id")
      .maybeSingle();

    if (!error && data?.id) {
      result.persisted += 1;
      result.wins.push({
        ordinal: candidate.ordinal,
        id: typeof data.id === "string" ? data.id : String(data.id),
        status: "inserted",
        idempotency_key: row.idempotency_key,
      });
      console.log("[win_persist_inserted]", {
        ordinal: candidate.ordinal,
        relationship_type: candidate.relationship_type,
        schema_version: WIN_RECOGNITION_VERSION,
        message_sid: args.sourceMessageSid ? "(present)" : null,
      });
      continue;
    }

    if (isUniqueViolation(error)) {
      const existing = await lookupExistingWinByKey(row.idempotency_key);
      // Hidden or active — key consumed; do not restore or re-insert.
      result.conflicts += 1;
      result.wins.push({
        ordinal: candidate.ordinal,
        id: existing?.id ?? null,
        status: "existing",
        idempotency_key: row.idempotency_key,
      });
      console.log("[win_persist_existing]", {
        ordinal: candidate.ordinal,
        existing_status: existing?.status ?? "unknown",
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
      idempotency_key: row.idempotency_key,
    });
    console.warn("[win_persist_failed]", {
      ordinal: candidate.ordinal,
      code: error?.code ?? null,
      schema_version: WIN_RECOGNITION_VERSION,
    });
  }

  if (result.failed > 0) result.allDurable = false;
  return result;
}
