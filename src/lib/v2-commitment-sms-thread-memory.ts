/**
 * M2B — Durable SMS thread memory projection (v2_commitment_sms_thread_memory).
 * M2B-2: outbound writes. M2B-3: inbound writes. M2B-4: read via memory packet.
 */

import { supabaseServer } from "@/lib/supabase-server";

export const V2_SMS_THREAD_MEMORY_PROJECTION_VERSION = 1;

export type V2CommitmentSmsThreadMemoryCoachQuestion = {
  text: string;
  asked_at: string;
  source: string;
  message_sid: string | null;
};

export type V2CommitmentSmsThreadMemoryUserAnswer = {
  text: string;
  answered_at: string;
  source: string;
  message_sid: string | null;
};

export type V2CommitmentSmsThreadMemory = {
  commitment_id: string;
  clerk_user_id: string;
  projection_version: number;
  last_outbound_full_body: string | null;
  last_outbound_sent_at: string | null;
  last_outbound_source: string | null;
  last_outbound_message_sid: string | null;
  last_inbound_full_body: string | null;
  last_inbound_at: string | null;
  last_inbound_message_sid: string | null;
  last_5_coach_questions: V2CommitmentSmsThreadMemoryCoachQuestion[];
  last_5_user_answers: V2CommitmentSmsThreadMemoryUserAnswer[];
  open_question_text: string | null;
  open_question_asked_at: string | null;
  open_question_expected_answer_type: string | null;
  open_question_source_message_sid: string | null;
  open_question_answer_text: string | null;
  open_question_answered_at: string | null;
  open_question_pending: boolean;
  do_not_repeat_phrases: string[];
  recent_frustration_corrections: unknown[];
  current_live_thread_summary: string | null;
  last_recomputed_from_spine_at: string | null;
  created_at: string;
  updated_at: string;
};

export type V2CommitmentSmsThreadMemoryOutboundSource =
  | "daily_sms"
  | "inbound_coach_reply"
  | "weekly_sms";

const MAX_COACH_QUESTIONS = 5;
const MAX_USER_ANSWERS = 5;
const MAX_FRUSTRATION_CORRECTIONS = 5;
const MAX_DNR_PHRASES = 16;
const MAX_PHRASE_CHARS = 280;
const MIN_DNR_PHRASE_CHARS = 8;
const MAX_INBOUND_BODY_CHARS = 4000;

export type V2CommitmentSmsThreadMemoryFrustrationCorrection = {
  text: string;
  corrected_at: string;
  message_sid: string | null;
};

const BINDING_EXPECTED_ANSWER_TYPES = new Set(["proposal_yes_no", "contract_yes_no"]);

const BINDING_CONSENT_SAFE_ROUTE_PURPOSES = new Set([
  "open_question_answer",
  "adaptive_proposal_consent_accept",
  "adaptive_proposal_consent_decline",
  "adaptive_proposal_consent_noop_ack",
  "adaptive_proposal_consent_clarification",
]);

const BINDING_CONSENT_SAFE_CLASSIFICATIONS = new Set(["user_yes", "user_no", "user_partial"]);

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function stripComplianceFooter(text: string): string {
  return text
    .replace(/\bReply STOP to opt out[\s\S]*$/i, "")
    .replace(/\bReply HELP for help\.?[\s\S]*$/i, "")
    .trim();
}

function isComplianceOrMetaQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (/\b(reply|text)\s+stop\b/i.test(t)) return true;
  if (/\b(reply|text)\s+help\b/i.test(t)) return true;
  if (/\bhow often\b.*\b(text|sms)\b/i.test(t)) return true;
  if (/\b(unsubscribe|opt out|opt-out)\b/i.test(t)) return true;
  return false;
}

function coachMessageLooksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\?/.test(t)) return true;
  if (/\b(what|when|which|who|how|tell me|give me|pick|choose)\b/i.test(t)) return true;
  return false;
}

function extractQuestionClause(coachMessage: string): string | null {
  const msg = coachMessage.trim();
  if (!msg) return null;
  const parts = msg.match(/[^?!.]+[?]/g);
  if (parts?.length) {
    const q = parts[parts.length - 1]!.trim();
    return isComplianceOrMetaQuestion(q) ? null : q;
  }
  if (coachMessageLooksLikeQuestion(msg) && !isComplianceOrMetaQuestion(msg)) {
    return msg;
  }
  return null;
}

/** Exported for deferred inbound projection policy (Slice 2A+2B). */
export function isBindingYesNoQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!/\?/.test(t) && !/\b(yes|no)\b/i.test(t)) return false;
  if (/\b(reply|text)\s+(yes|no)\b/i.test(t)) return true;
  if (/\b(do you|would you|can you)\s+(accept|agree|confirm|approve)\b/i.test(t)) return true;
  if (/\b(yes|no)\s+(to|for)\s+(this|the)\s+(proposal|overlay|change)\b/i.test(t)) return true;
  return false;
}

/** Exported for unit tests. */
export function extractCoachQuestionFromOutboundBody(args: {
  sentBody: string;
  expectedAnswerType?: string | null;
}): string | null {
  const body = stripComplianceFooter(args.sentBody);
  if (!body) return null;

  const expected = args.expectedAnswerType?.trim().toLowerCase() ?? null;
  const allowBinding = expected === "proposal_yes_no" || expected === "contract_yes_no";

  const q = extractQuestionClause(body);
  if (!q) return null;

  if (isBindingYesNoQuestion(q) && !allowBinding) {
    return null;
  }

  return q.slice(0, MAX_PHRASE_CHARS);
}

function parseUserAnswers(raw: unknown): V2CommitmentSmsThreadMemoryUserAnswer[] {
  if (!Array.isArray(raw)) return [];
  const out: V2CommitmentSmsThreadMemoryUserAnswer[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!text) continue;
    out.push({
      text,
      answered_at: typeof o.answered_at === "string" ? o.answered_at : new Date().toISOString(),
      source: typeof o.source === "string" ? o.source : "unknown",
      message_sid: typeof o.message_sid === "string" ? o.message_sid : null,
    });
  }
  return out;
}

function parseCoachQuestions(raw: unknown): V2CommitmentSmsThreadMemoryCoachQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: V2CommitmentSmsThreadMemoryCoachQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!text) continue;
    out.push({
      text,
      asked_at: typeof o.asked_at === "string" ? o.asked_at : new Date().toISOString(),
      source: typeof o.source === "string" ? o.source : "unknown",
      message_sid: typeof o.message_sid === "string" ? o.message_sid : null,
    });
  }
  return out;
}

function parseStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim());
}

function appendCoachQuestion(
  existing: V2CommitmentSmsThreadMemoryCoachQuestion[],
  entry: V2CommitmentSmsThreadMemoryCoachQuestion
): V2CommitmentSmsThreadMemoryCoachQuestion[] {
  const key = normKey(entry.text);
  const filtered = existing.filter((q) => normKey(q.text) !== key);
  return [...filtered, entry].slice(-MAX_COACH_QUESTIONS);
}

/** Exported for tests — compliance-only inbound (STOP/HELP/START etc.). */
export function isSmsComplianceOnlyInbound(raw: string): boolean {
  const low = raw.trim().toLowerCase();
  return /^(stop|start|help|unstop|cancel)$/i.test(low) && raw.trim().length <= 12;
}

function isEmojiOnlyInbound(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^👍[\u{FE0F}\u{1F3FB}-\u{1F3FF}]*$/u.test(t)) return true;
  if (/^[\p{Extended_Pictographic}\s]+$/u.test(t) && t.length <= 8) return true;
  return false;
}

function isShortAckPhrase(text: string): boolean {
  const core = text.trim().toLowerCase().replace(/[.!?…]+$/g, "");
  if (!core) return false;
  if (["ok", "okay", "k", "got it", "gotit", "sounds good", "👍", "thumbs up", "thumbs-up"].includes(core)) {
    return true;
  }
  return false;
}

/** Exported for tests. */
export function isAlreadyToldYouFrustrationInbound(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\bi\s+already\s+told\s+you\b/i.test(t)) return true;
  if (/\balready\s+told\s+you\b/i.test(t)) return true;
  if (/\bi\s+told\s+you\s+already\b/i.test(t)) return true;
  if (/\btold\s+you\s+already\b/i.test(t)) return true;
  if (/\bi\s+already\s+answered\b/i.test(t)) return true;
  if (/\balready\s+answered\b/i.test(t)) return true;
  if (/\bi\s+said\s+that\b/i.test(t)) return true;
  if (/\bi\s+just\s+told\s+you\b/i.test(t)) return true;
  return false;
}

/** Exported for tests. */
export function isSubstantiveInboundForThreadMemory(text: string): boolean {
  const t = text.trim();
  if (!t || isSmsComplianceOnlyInbound(t) || isEmojiOnlyInbound(t) || isShortAckPhrase(t)) return false;
  if (isAlreadyToldYouFrustrationInbound(t)) return false;
  if (t.length >= 12) return true;
  if (/,/.test(t) && t.length >= 5) return true;
  if (t.split(/\s+/).filter(Boolean).length >= 3) return true;
  return false;
}

const SHORT_CONTEXTUAL_OVERLOADED_REPLIES = new Set([
  "yes",
  "no",
  "maybe",
  "yep",
  "nope",
  "yeah",
  "nah",
  "y",
  "n",
]);

const SHORT_CONTEXTUAL_EXTRA_ACKS = new Set(["thanks", "thank you", "thx"]);

const MAX_SHORT_CONTEXTUAL_OPEN_ANSWER_CHARS = 30;

/**
 * Short human SMS replies that can answer a normal (non-binding) coaching open question.
 * High precision: excludes YES/NO/maybe, acks, compliance, emoji, frustration.
 */
export function isShortContextualOpenQuestionAnswer(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > MAX_SHORT_CONTEXTUAL_OPEN_ANSWER_CHARS) return false;
  if (isSmsComplianceOnlyInbound(t) || isEmojiOnlyInbound(t) || isShortAckPhrase(t)) return false;
  if (isAlreadyToldYouFrustrationInbound(t)) return false;

  const core = t.toLowerCase().replace(/[.!?…]+$/g, "").trim();
  if (!core || SHORT_CONTEXTUAL_OVERLOADED_REPLIES.has(core)) return false;
  if (SHORT_CONTEXTUAL_EXTRA_ACKS.has(core)) return false;
  if (!/[a-zA-Z0-9]/.test(core)) return false;

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 3) return false;

  return true;
}

function parseFrustrationCorrections(raw: unknown): V2CommitmentSmsThreadMemoryFrustrationCorrection[] {
  if (!Array.isArray(raw)) return [];
  const out: V2CommitmentSmsThreadMemoryFrustrationCorrection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!text) continue;
    out.push({
      text: text.slice(0, MAX_PHRASE_CHARS),
      corrected_at: typeof o.corrected_at === "string" ? o.corrected_at : new Date().toISOString(),
      message_sid: typeof o.message_sid === "string" ? o.message_sid : null,
    });
  }
  return out;
}

function appendUserAnswer(
  existing: V2CommitmentSmsThreadMemoryUserAnswer[],
  entry: V2CommitmentSmsThreadMemoryUserAnswer
): V2CommitmentSmsThreadMemoryUserAnswer[] {
  const key = normKey(entry.text);
  const filtered = existing.filter((a) => normKey(a.text) !== key);
  return [...filtered, entry].slice(-MAX_USER_ANSWERS);
}

function appendFrustrationCorrection(
  existing: V2CommitmentSmsThreadMemoryFrustrationCorrection[],
  entry: V2CommitmentSmsThreadMemoryFrustrationCorrection
): V2CommitmentSmsThreadMemoryFrustrationCorrection[] {
  const key = normKey(entry.text);
  const filtered = existing.filter((c) => normKey(c.text) !== key);
  return [...filtered, entry].slice(-MAX_FRUSTRATION_CORRECTIONS);
}

/** Binding YES/NO open questions — only record answer when consent route or classifier proves it. */
export function bindingOpenQuestionAnswerAllowed(args: {
  expectedAnswerType: string | null | undefined;
  classification: string | null | undefined;
  routePurpose: string | null | undefined;
}): boolean {
  const expected = args.expectedAnswerType?.trim().toLowerCase() ?? "";
  if (!BINDING_EXPECTED_ANSWER_TYPES.has(expected)) return true;
  const route = args.routePurpose?.trim() ?? "";
  if (route && BINDING_CONSENT_SAFE_ROUTE_PURPOSES.has(route)) return true;
  const cls = args.classification?.trim().toLowerCase() ?? "";
  return BINDING_CONSENT_SAFE_CLASSIFICATIONS.has(cls);
}

function mergeDoNotRepeatPhrases(args: {
  existing: string[];
  coachQuestions: V2CommitmentSmsThreadMemoryCoachQuestion[];
  newQuestion: string | null;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (phrase: string) => {
    const p = phrase.trim();
    if (p.length < MIN_DNR_PHRASE_CHARS) return;
    const key = normKey(p);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p.slice(0, MAX_PHRASE_CHARS));
  };

  for (const p of args.existing) push(p);
  for (const q of args.coachQuestions) push(q.text);
  if (args.newQuestion) push(args.newQuestion);

  return out.slice(-MAX_DNR_PHRASES);
}

function rowToMemory(row: Record<string, unknown>): V2CommitmentSmsThreadMemory {
  return {
    commitment_id: String(row.commitment_id),
    clerk_user_id: String(row.clerk_user_id),
    projection_version:
      typeof row.projection_version === "number" ? row.projection_version : V2_SMS_THREAD_MEMORY_PROJECTION_VERSION,
    last_outbound_full_body:
      typeof row.last_outbound_full_body === "string" ? row.last_outbound_full_body : null,
    last_outbound_sent_at: typeof row.last_outbound_sent_at === "string" ? row.last_outbound_sent_at : null,
    last_outbound_source: typeof row.last_outbound_source === "string" ? row.last_outbound_source : null,
    last_outbound_message_sid:
      typeof row.last_outbound_message_sid === "string" ? row.last_outbound_message_sid : null,
    last_inbound_full_body: typeof row.last_inbound_full_body === "string" ? row.last_inbound_full_body : null,
    last_inbound_at: typeof row.last_inbound_at === "string" ? row.last_inbound_at : null,
    last_inbound_message_sid:
      typeof row.last_inbound_message_sid === "string" ? row.last_inbound_message_sid : null,
    last_5_coach_questions: parseCoachQuestions(row.last_5_coach_questions),
    last_5_user_answers: parseUserAnswers(row.last_5_user_answers),
    open_question_text: typeof row.open_question_text === "string" ? row.open_question_text : null,
    open_question_asked_at: typeof row.open_question_asked_at === "string" ? row.open_question_asked_at : null,
    open_question_expected_answer_type:
      typeof row.open_question_expected_answer_type === "string"
        ? row.open_question_expected_answer_type
        : null,
    open_question_source_message_sid:
      typeof row.open_question_source_message_sid === "string"
        ? row.open_question_source_message_sid
        : null,
    open_question_answer_text:
      typeof row.open_question_answer_text === "string" ? row.open_question_answer_text : null,
    open_question_answered_at:
      typeof row.open_question_answered_at === "string" ? row.open_question_answered_at : null,
    open_question_pending: row.open_question_pending === true,
    do_not_repeat_phrases: parseStringList(row.do_not_repeat_phrases),
    recent_frustration_corrections: parseFrustrationCorrections(row.recent_frustration_corrections),
    current_live_thread_summary:
      typeof row.current_live_thread_summary === "string" ? row.current_live_thread_summary : null,
    last_recomputed_from_spine_at:
      typeof row.last_recomputed_from_spine_at === "string" ? row.last_recomputed_from_spine_at : null,
    created_at: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
    updated_at: typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString(),
  };
}

export async function loadV2CommitmentSmsThreadMemory(args: {
  commitmentId: string;
}): Promise<V2CommitmentSmsThreadMemory | null> {
  const { data, error } = await supabaseServer
    .from("v2_commitment_sms_thread_memory")
    .select("*")
    .eq("commitment_id", args.commitmentId)
    .maybeSingle();

  if (error) {
    console.error("[v2-commitment-sms-thread-memory] load failed", {
      commitment_id: args.commitmentId,
      message: error.message,
    });
    return null;
  }

  if (!data) return null;
  return rowToMemory(data as Record<string, unknown>);
}

export async function upsertCommitmentSmsThreadMemoryFromOutbound(args: {
  commitmentId: string;
  clerkUserId: string;
  sentBody: string;
  sentAt: Date;
  messageSid?: string | null;
  source: V2CommitmentSmsThreadMemoryOutboundSource;
  expectedAnswerType?: string | null;
  /** Slice 2A — clear stale proposal_yes_no / contract_yes_no open question before applying new extraction. */
  clearBindingOpenQuestion?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const commitmentId = args.commitmentId.trim();
  const clerkUserId = args.clerkUserId.trim();
  const sentBody = args.sentBody.trim();
  if (!commitmentId || !clerkUserId || !sentBody) {
    return { ok: false, error: "missing_required_fields" };
  }

  const sentAtIso = args.sentAt.toISOString();
  const messageSid = args.messageSid?.trim() || null;

  const existing = await loadV2CommitmentSmsThreadMemory({ commitmentId });

  const extractedQuestion = extractCoachQuestionFromOutboundBody({
    sentBody,
    expectedAnswerType: args.expectedAnswerType ?? null,
  });

  let last5 = existing?.last_5_coach_questions ?? [];
  if (extractedQuestion) {
    last5 = appendCoachQuestion(last5, {
      text: extractedQuestion,
      asked_at: sentAtIso,
      source: args.source,
      message_sid: messageSid,
    });
  }

  const dnr = mergeDoNotRepeatPhrases({
    existing: existing?.do_not_repeat_phrases ?? [],
    coachQuestions: last5,
    newQuestion: extractedQuestion,
  });

  let openQuestionText: string | null = existing?.open_question_text ?? null;
  let openQuestionAskedAt: string | null = existing?.open_question_asked_at ?? null;
  let openQuestionExpectedType: string | null = existing?.open_question_expected_answer_type ?? null;
  let openQuestionSourceSid: string | null = existing?.open_question_source_message_sid ?? null;
  let openQuestionAnswerText: string | null = existing?.open_question_answer_text ?? null;
  let openQuestionAnsweredAt: string | null = existing?.open_question_answered_at ?? null;
  let openQuestionPending = existing?.open_question_pending ?? false;

  if (args.clearBindingOpenQuestion) {
    const priorExpected = openQuestionExpectedType?.trim().toLowerCase() ?? "";
    if (BINDING_EXPECTED_ANSWER_TYPES.has(priorExpected) || openQuestionPending) {
      openQuestionText = null;
      openQuestionAskedAt = null;
      openQuestionExpectedType = null;
      openQuestionSourceSid = null;
      openQuestionAnswerText = null;
      openQuestionAnsweredAt = null;
      openQuestionPending = false;
    }
  }

  if (extractedQuestion) {
    openQuestionText = extractedQuestion;
    openQuestionAskedAt = sentAtIso;
    openQuestionExpectedType = args.expectedAnswerType?.trim() || null;
    openQuestionSourceSid = messageSid;
    openQuestionPending = true;
    openQuestionAnswerText = null;
    openQuestionAnsweredAt = null;
  }

  const row: Record<string, unknown> = {
    commitment_id: commitmentId,
    clerk_user_id: clerkUserId,
    projection_version: V2_SMS_THREAD_MEMORY_PROJECTION_VERSION,
    last_outbound_full_body: sentBody.slice(0, 4000),
    last_outbound_sent_at: sentAtIso,
    last_outbound_source: args.source,
    last_outbound_message_sid: messageSid,
    last_5_coach_questions: last5,
    do_not_repeat_phrases: dnr,
    updated_at: sentAtIso,
    last_inbound_full_body: existing?.last_inbound_full_body ?? null,
    last_inbound_at: existing?.last_inbound_at ?? null,
    last_inbound_message_sid: existing?.last_inbound_message_sid ?? null,
    last_5_user_answers: existing?.last_5_user_answers ?? [],
    recent_frustration_corrections: existing?.recent_frustration_corrections ?? [],
    open_question_text: openQuestionText,
    open_question_asked_at: openQuestionAskedAt,
    open_question_expected_answer_type: openQuestionExpectedType,
    open_question_source_message_sid: openQuestionSourceSid,
    open_question_answer_text: openQuestionAnswerText,
    open_question_answered_at: openQuestionAnsweredAt,
    open_question_pending: openQuestionPending,
    current_live_thread_summary: existing?.current_live_thread_summary ?? null,
    last_recomputed_from_spine_at: existing?.last_recomputed_from_spine_at ?? null,
  };

  if (existing) {
    const { error } = await supabaseServer
      .from("v2_commitment_sms_thread_memory")
      .update(row)
      .eq("commitment_id", commitmentId);

    if (error) {
      console.error("[v2-commitment-sms-thread-memory] outbound upsert update failed", {
        commitment_id: commitmentId,
        message: error.message,
      });
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  const insertRow = {
    ...row,
    last_5_user_answers: [],
    do_not_repeat_phrases: dnr,
    recent_frustration_corrections: [],
    open_question_pending: openQuestionPending,
    created_at: sentAtIso,
  };

  const { error } = await supabaseServer.from("v2_commitment_sms_thread_memory").insert(insertRow);

  if (error) {
    console.error("[v2-commitment-sms-thread-memory] outbound upsert insert failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function upsertCommitmentSmsThreadMemoryFromInbound(args: {
  commitmentId: string;
  clerkUserId: string;
  inboundBody: string;
  inboundAt: Date;
  messageSid?: string | null;
  classification?: string | null;
  routePurpose?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const commitmentId = args.commitmentId.trim();
  const clerkUserId = args.clerkUserId.trim();
  const inboundBody = args.inboundBody.trim().slice(0, MAX_INBOUND_BODY_CHARS);
  if (!commitmentId || !clerkUserId || !inboundBody) {
    return { ok: false, error: "missing_required_fields" };
  }

  if (isSmsComplianceOnlyInbound(inboundBody)) {
    return { ok: true };
  }

  const inboundAtIso = args.inboundAt.toISOString();
  const messageSid = args.messageSid?.trim() || null;
  const substantive = isSubstantiveInboundForThreadMemory(inboundBody);
  const frustration = isAlreadyToldYouFrustrationInbound(inboundBody);
  const shortContextual = isShortContextualOpenQuestionAnswer(inboundBody);

  if (!substantive && !frustration && !shortContextual) {
    return { ok: true };
  }

  const existing = await loadV2CommitmentSmsThreadMemory({ commitmentId });

  let last5Answers = existing?.last_5_user_answers ?? [];
  let frustrationCorrections = parseFrustrationCorrections(existing?.recent_frustration_corrections ?? []);

  let openQuestionText = existing?.open_question_text ?? null;
  let openQuestionAskedAt = existing?.open_question_asked_at ?? null;
  let openQuestionExpectedType = existing?.open_question_expected_answer_type ?? null;
  let openQuestionSourceSid = existing?.open_question_source_message_sid ?? null;
  let openQuestionAnswerText = existing?.open_question_answer_text ?? null;
  let openQuestionAnsweredAt = existing?.open_question_answered_at ?? null;
  let openQuestionPending = existing?.open_question_pending ?? false;

  if (frustration) {
    frustrationCorrections = appendFrustrationCorrection(frustrationCorrections, {
      text: inboundBody.slice(0, MAX_PHRASE_CHARS),
      corrected_at: inboundAtIso,
      message_sid: messageSid,
    });
  }

  const bindingPending =
    openQuestionPending &&
    BINDING_EXPECTED_ANSWER_TYPES.has(openQuestionExpectedType?.trim().toLowerCase() ?? "");

  const bindingAnswerAllowed = bindingOpenQuestionAnswerAllowed({
    expectedAnswerType: openQuestionExpectedType,
    classification: args.classification,
    routePurpose: args.routePurpose,
  });

  const shortAnswerClearsOpen =
    shortContextual &&
    !frustration &&
    openQuestionPending &&
    !bindingPending &&
    bindingAnswerAllowed;

  const mayRecordOpenAnswer =
    !frustration &&
    openQuestionPending &&
    bindingAnswerAllowed &&
    (substantive || shortAnswerClearsOpen);

  if (mayRecordOpenAnswer) {
    openQuestionAnswerText = inboundBody;
    openQuestionAnsweredAt = inboundAtIso;
    openQuestionPending = false;
    last5Answers = appendUserAnswer(last5Answers, {
      text: inboundBody,
      answered_at: inboundAtIso,
      source: args.routePurpose?.trim() || "inbound_sms",
      message_sid: messageSid,
    });
  } else if (substantive && !frustration && !bindingPending) {
    last5Answers = appendUserAnswer(last5Answers, {
      text: inboundBody,
      answered_at: inboundAtIso,
      source: args.routePurpose?.trim() || "inbound_sms",
      message_sid: messageSid,
    });
  }

  const row: Record<string, unknown> = {
    commitment_id: commitmentId,
    clerk_user_id: clerkUserId,
    projection_version: V2_SMS_THREAD_MEMORY_PROJECTION_VERSION,
    last_inbound_full_body: inboundBody,
    last_inbound_at: inboundAtIso,
    last_inbound_message_sid: messageSid,
    last_5_user_answers: last5Answers,
    recent_frustration_corrections: frustrationCorrections,
    open_question_text: openQuestionText,
    open_question_asked_at: openQuestionAskedAt,
    open_question_expected_answer_type: openQuestionExpectedType,
    open_question_source_message_sid: openQuestionSourceSid,
    open_question_answer_text: openQuestionAnswerText,
    open_question_answered_at: openQuestionAnsweredAt,
    open_question_pending: openQuestionPending,
    updated_at: inboundAtIso,
    last_outbound_full_body: existing?.last_outbound_full_body ?? null,
    last_outbound_sent_at: existing?.last_outbound_sent_at ?? null,
    last_outbound_source: existing?.last_outbound_source ?? null,
    last_outbound_message_sid: existing?.last_outbound_message_sid ?? null,
    last_5_coach_questions: existing?.last_5_coach_questions ?? [],
    do_not_repeat_phrases: existing?.do_not_repeat_phrases ?? [],
    current_live_thread_summary: existing?.current_live_thread_summary ?? null,
    last_recomputed_from_spine_at: existing?.last_recomputed_from_spine_at ?? null,
  };

  if (existing) {
    const { error } = await supabaseServer
      .from("v2_commitment_sms_thread_memory")
      .update(row)
      .eq("commitment_id", commitmentId);

    if (error) {
      console.error("[v2-commitment-sms-thread-memory] inbound upsert update failed", {
        commitment_id: commitmentId,
        message: error.message,
      });
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  const insertRow = {
    ...row,
    last_5_coach_questions: [],
    do_not_repeat_phrases: [],
    open_question_pending: false,
    created_at: inboundAtIso,
  };

  const { error } = await supabaseServer.from("v2_commitment_sms_thread_memory").insert(insertRow);

  if (error) {
    console.error("[v2-commitment-sms-thread-memory] inbound upsert insert failed", {
      commitment_id: commitmentId,
      message: error.message,
    });
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
