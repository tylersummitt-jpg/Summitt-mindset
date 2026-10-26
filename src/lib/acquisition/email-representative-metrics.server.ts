import "server-only";

import { repeatedKnowledgeTopics } from "@/lib/acquisition/email-knowledge";
import { buildEmailRepresentativeReport, type EmailRepresentativeReport } from "@/lib/acquisition/email-representative-metrics";
import { supabaseServer } from "@/lib/supabase-server";

async function countRows(
  table: string,
  apply: (query: { eq: Function; in: Function; not: Function }) => PromiseLike<{ count: number | null; error: { message?: string } | null }>,
): Promise<number | null> {
  const source = supabaseServer.from(table) as { select?: Function } | null;
  if (!source || typeof source.select !== "function") return null;
  const { count, error } = await apply(source.select("id", { count: "exact", head: true }));
  if (error || count == null) return null;
  return count;
}

function unavailableReport(): EmailRepresentativeReport {
  return buildEmailRepresentativeReport({
    readable: false,
    knowledgeInstalled: false,
    interpretedReplies: null,
    aiDrafts: null,
    needsHuman: null,
    outboundReplies: null,
    manualOpen: null,
    manualSent: null,
    humanHours: [],
    activeKnowledge: null,
    retiredKnowledge: null,
    repeatedTopics: [],
    recordedTrialStarts: null,
    recordedPaidMembers: null,
  });
}

export async function loadEmailRepresentativeReport(): Promise<EmailRepresentativeReport> {
  try {
    return await readEmailRepresentativeReport();
  } catch {
    return unavailableReport();
  }
}

async function readEmailRepresentativeReport(): Promise<EmailRepresentativeReport> {
  const [
    interpretedReplies,
    aiDrafts,
    needsHuman,
    outboundReplies,
    manualOpen,
    manualSent,
    recordedTrialStarts,
    recordedPaidMembers,
  ] = await Promise.all([
    countRows("acquisition_messages", (query) => query.eq("direction", "inbound").eq("processing_status", "interpreted")),
    countRows("acquisition_messages", (query) => query.eq("direction", "inbound").in("ai_outcome", ["ask_question", "accept_offer"]).not("draft_body", "is", null)),
    countRows("acquisition_messages", (query) => query.eq("direction", "inbound").eq("ai_outcome", "needs_human")),
    countRows("acquisition_messages", (query) => query.eq("direction", "outbound").eq("processing_status", "sent")),
    countRows("acquisition_email_answers", (query) => query.eq("status", "open")),
    countRows("acquisition_email_answers", (query) => query.eq("status", "sent")),
    countRows("acquisition_events", (query) => query.eq("event_type", "trial_started")),
    countRows("acquisition_events", (query) => query.eq("event_type", "paid_member")),
  ]);
  const answers = await supabaseServer
    .from("acquisition_email_answers")
    .select("created_at, resolved_at")
    .eq("status", "sent")
    .limit(100);
  const humanHours = (answers.data ?? []).flatMap((row) => {
    if (typeof row.created_at !== "string") return [];
    return [{ startedAt: row.created_at, resolvedAt: typeof row.resolved_at === "string" ? row.resolved_at : null }];
  });
  const knowledge = await supabaseServer
    .from("acquisition_email_knowledge")
    .select("topic, status")
    .limit(50);
  const missing = knowledge.error?.code === "PGRST205" || knowledge.error?.code === "42P01"
    || /acquisition_email_knowledge/i.test(knowledge.error?.message ?? "") && /schema cache|does not exist|could not find/i.test(knowledge.error?.message ?? "");
  const knowledgeRows = missing ? [] : (knowledge.data ?? []).flatMap((row) => {
    if (typeof row.topic !== "string" || typeof row.status !== "string") return [];
    return [{ topic: row.topic, status: row.status }];
  });
  const knowledgeReadable = !missing && !knowledge.error;
  const activeKnowledge = knowledgeReadable ? knowledgeRows.filter((row) => row.status === "active").length : null;
  const retiredKnowledge = knowledgeReadable ? knowledgeRows.filter((row) => row.status === "retired").length : null;
  const readable = interpretedReplies != null && needsHuman != null && manualOpen != null;
  return buildEmailRepresentativeReport({
    readable,
    knowledgeInstalled: knowledgeReadable,
    interpretedReplies,
    aiDrafts,
    needsHuman,
    outboundReplies,
    manualOpen,
    manualSent,
    humanHours: answers.error ? [] : humanHours,
    activeKnowledge,
    retiredKnowledge,
    repeatedTopics: repeatedKnowledgeTopics(knowledgeRows).filter((row) => row.count > 1),
    recordedTrialStarts,
    recordedPaidMembers,
  });
}
