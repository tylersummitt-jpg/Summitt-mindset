import "server-only";

import {
  EMAIL_KNOWLEDGE_PROMPT_LIMIT,
  EMAIL_KNOWLEDGE_SCAN_LIMIT,
  prepareInterpreterKnowledge,
  reviewReusableKnowledge,
  type EmailKnowledgeCategory,
  type EmailKnowledgeRecord,
  type EmailKnowledgeScope,
  type InterpreterKnowledge,
  type KnowledgeDraft,
} from "@/lib/acquisition/email-knowledge";
import { supabaseServer } from "@/lib/supabase-server";

const COLUMNS = "id, topic, statement, category, scope, campaign_id, offer_key, status, approved_at, supersedes_id, source_request_id, retired_at, updated_at";

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isMissingKnowledgeTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  const message = error.message ?? "";
  return /acquisition_email_knowledge/i.test(message) && /schema cache|does not exist|could not find/i.test(message);
}

function asRecord(row: Record<string, unknown>): EmailKnowledgeRecord | null {
  if (typeof row.id !== "string" || typeof row.topic !== "string" || typeof row.statement !== "string") return null;
  if (typeof row.approved_at !== "string") return null;
  return {
    id: row.id,
    topic: row.topic,
    statement: row.statement,
    category: typeof row.category === "string" ? row.category : "",
    scope: typeof row.scope === "string" ? row.scope : "",
    campaignId: asText(row.campaign_id),
    offerKey: asText(row.offer_key),
    status: typeof row.status === "string" ? row.status : "",
    approvedAt: row.approved_at,
    supersedesId: asText(row.supersedes_id),
  };
}

export async function loadInterpreterKnowledge(args: {
  campaignId: string | null;
  offerKey: string | null;
}): Promise<{ ok: true; knowledge: InterpreterKnowledge } | { ok: false }> {
  let query = supabaseServer
    .from("acquisition_email_knowledge")
    .select(COLUMNS)
    .eq("status", "active")
    .order("approved_at", { ascending: false })
    .limit(EMAIL_KNOWLEDGE_SCAN_LIMIT);
  const filters = ["scope.eq.general"];
  if (args.campaignId && /^[A-Za-z0-9_-]{1,80}$/.test(args.campaignId)) {
    filters.push(`and(scope.eq.campaign,campaign_id.eq.${args.campaignId})`);
  }
  if (args.offerKey && /^[a-z0-9_]{1,64}$/.test(args.offerKey)) {
    filters.push(`and(scope.eq.offer,offer_key.eq.${args.offerKey})`);
  }
  query = query.or(filters.join(","));
  const { data, error } = await query;
  if (isMissingKnowledgeTable(error)) {
    return { ok: true, knowledge: { statements: [], conflicts: [], allowLeadershipKit: false, incomplete: false } };
  }
  if (error) {
    console.error("[acquisition] approved knowledge was not readable", { reason: error.code ?? "knowledge_unreadable" });
    return { ok: false };
  }
  const rows = data ?? [];
  if (rows.length >= EMAIL_KNOWLEDGE_SCAN_LIMIT) {
    console.error("[acquisition] approved knowledge exceeded the retrieval bound", { limit: EMAIL_KNOWLEDGE_SCAN_LIMIT });
    return { ok: false };
  }
  const parsed = rows.flatMap((row) => {
    const record = asRecord(row as Record<string, unknown>);
    return record ? [record] : [];
  });
  const knowledge = prepareInterpreterKnowledge(parsed, args);
  if (knowledge.incomplete) {
    console.error("[acquisition] approved knowledge exceeded the prompt bound", { limit: EMAIL_KNOWLEDGE_PROMPT_LIMIT });
    return { ok: false };
  }
  return { ok: true, knowledge };
}

export type EmailKnowledgeCard = EmailKnowledgeRecord & {
  sourceRequestId: string | null;
  retiredAt: string | null;
  updatedAt: string | null;
};

export async function listEmailKnowledge(): Promise<{ ok: true; rows: EmailKnowledgeCard[] } | { ok: false; error: string }> {
  const { data, error } = await supabaseServer
    .from("acquisition_email_knowledge")
    .select(COLUMNS)
    .order("approved_at", { ascending: false })
    .limit(50);
  if (isMissingKnowledgeTable(error)) return { ok: false, error: "Knowledge storage is not installed yet." };
  if (error) return { ok: false, error: "Could not load knowledge." };
  const rows = (data ?? []).flatMap((row) => {
    const record = asRecord(row as Record<string, unknown>);
    if (!record) return [];
    const source = row as Record<string, unknown>;
    return [{
      ...record,
      sourceRequestId: asText(source.source_request_id),
      retiredAt: asText(source.retired_at),
      updatedAt: asText(source.updated_at),
    }];
  });
  return { ok: true, rows };
}

async function insertKnowledge(args: {
  draft: KnowledgeDraft;
  sourceRequestId: string | null;
  supersedesId: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string; code?: string }> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseServer.from("acquisition_email_knowledge").insert({
    topic: args.draft.topic,
    statement: args.draft.statement,
    category: args.draft.category,
    scope: args.draft.scope,
    campaign_id: args.draft.campaignId,
    offer_key: args.draft.offerKey,
    status: "active",
    source_request_id: args.sourceRequestId,
    supersedes_id: args.supersedesId,
    approved_by: "tyler",
    approved_at: now,
    updated_at: now,
  }).select("id").maybeSingle();
  if (error) return { ok: false, error: "The knowledge entry was not stored.", code: (error as { code?: string }).code };
  if (!data?.id || typeof data.id !== "string") return { ok: false, error: "The knowledge entry was not stored." };
  return { ok: true, id: data.id };
}

async function linkRequest(requestId: string, knowledgeId: string): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("acquisition_email_answers")
    .update({ knowledge_entry_id: knowledgeId, updated_at: new Date().toISOString() })
    .eq("id", requestId)
    .is("knowledge_entry_id", null)
    .select("id")
    .maybeSingle();
  return !error && Boolean(data?.id);
}

export async function approveReusableKnowledge(args: {
  draft: KnowledgeDraft;
  sourceRequestId?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const reviewed = reviewReusableKnowledge(args.draft);
  if (!reviewed.ok) return reviewed;
  const sourceRequestId = args.sourceRequestId?.trim() || null;
  if (sourceRequestId) {
    const { data, error } = await supabaseServer
      .from("acquisition_email_answers")
      .select("id, status, knowledge_entry_id")
      .eq("id", sourceRequestId)
      .maybeSingle();
    if (error || !data?.id) return { ok: false, error: "That manual answer was not found." };
    if (data.knowledge_entry_id) return { ok: false, error: "This answer is already saved as knowledge." };
    if (data.status !== "sent") return { ok: false, error: "Save a one-off answer as knowledge only after it has been sent." };
  }
  const inserted = await insertKnowledge({ draft: reviewed.draft, sourceRequestId, supersedesId: null });
  if (!inserted.ok && inserted.code === "23505" && sourceRequestId) {
    const existing = await supabaseServer
      .from("acquisition_email_knowledge")
      .select("id, status, statement")
      .eq("source_request_id", sourceRequestId)
      .maybeSingle();
    const sameActiveWording = existing.data?.status === "active"
      && existing.data.statement === reviewed.draft.statement
      && typeof existing.data.id === "string";
    if (!sameActiveWording || typeof existing.data?.id !== "string") {
      return { ok: false, error: "This answer already has a knowledge record, and the new wording was not stored." };
    }
    const linked = await linkRequest(sourceRequestId, existing.data.id);
    if (!linked) return { ok: false, error: "The existing fact could not be linked to this answer." };
    return { ok: true, id: existing.data.id };
  }
  if (!inserted.ok) return { ok: false, error: inserted.error };
  if (sourceRequestId) {
    const linked = await linkRequest(sourceRequestId, inserted.id);
    if (!linked) {
      const now = new Date().toISOString();
      const retired = await supabaseServer.from("acquisition_email_knowledge").update({
        status: "retired",
        retired_at: now,
        source_request_id: null,
        updated_at: now,
      }).eq("id", inserted.id).eq("status", "active").select("id").maybeSingle();
      if (retired.error || !retired.data?.id) {
        return { ok: false, error: "The fact was stored but could not be linked. It is still active and needs to be retired." };
      }
      return { ok: false, error: "The fact was not linked to this answer, so it was not kept active." };
    }
  }
  return inserted;
}

export async function retireEmailKnowledge(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const knowledgeId = id.trim();
  if (!knowledgeId) return { ok: false, error: "Choose a knowledge entry." };
  const now = new Date().toISOString();
  const { data, error } = await supabaseServer
    .from("acquisition_email_knowledge")
    .update({ status: "retired", retired_at: now, updated_at: now })
    .eq("id", knowledgeId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (error || !data?.id) return { ok: false, error: "That active entry was not retired." };
  return { ok: true };
}

export async function replaceEmailKnowledge(args: {
  id: string;
  draft: KnowledgeDraft;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const reviewed = reviewReusableKnowledge(args.draft);
  if (!reviewed.ok) return reviewed;
  const current = await supabaseServer
    .from("acquisition_email_knowledge")
    .select("id, source_request_id, status")
    .eq("id", args.id)
    .eq("status", "active")
    .maybeSingle();
  if (current.error || !current.data?.id) return { ok: false, error: "That active entry was not found." };
  const successor = await supabaseServer
    .from("acquisition_email_knowledge")
    .select("id")
    .eq("supersedes_id", args.id)
    .eq("status", "active")
    .limit(1);
  if (successor.error) return { ok: false, error: "The existing wording could not be checked." };
  if ((successor.data ?? []).length > 0) {
    return { ok: false, error: "An edited version is already active. Retire the older wording before editing again." };
  }
  const inserted = await insertKnowledge({
    draft: reviewed.draft,
    sourceRequestId: null,
    supersedesId: args.id,
  });
  if (!inserted.ok) return { ok: false, error: inserted.error };
  const retired = await retireEmailKnowledge(args.id);
  if (!retired.ok) {
    console.error("[acquisition] replacement knowledge left the previous entry active", { id: args.id });
    return { ok: false, error: "The new wording was stored, and the previous wording is still active. The question will be escalated until the older entry is retired." };
  }
  return inserted;
}

export type { EmailKnowledgeCategory, EmailKnowledgeScope };
