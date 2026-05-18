/**
 * M2A — Unified SMS relationship memory packet from existing tables (read-only, no schema).
 * Recent exact thread outranks coaching summaries for V3 lane facts.
 */

import { supabaseServer } from "@/lib/supabase-server";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getRecentV2EventsForAi, type V2EventRowForAi } from "@/lib/v2-commitment";
import { loadV2CoachingMemoryForPrompt, type V2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory";
import { formatCoachingMemoryPromptBlock } from "@/lib/v2-coaching-memory-prompt";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { loadV2CommitmentSmsThreadMemory } from "@/lib/v2-commitment-sms-thread-memory";
import { deriveDoNotRepeatHintsFromCoachingMemory } from "@/lib/v3-daily-relationship-lane";
import { deriveV3LearningSignalsFromContext } from "@/lib/v3-sms-learning";

export type SmsThreadMemoryProjectionSource = "projection" | "runtime_guess" | "none";

function isAlreadyToldYouCorrection(text: string): boolean {
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

export type SmsRelationshipSpeaker = "coach" | "user";

export type SmsRelationshipMessage = {
  speaker: SmsRelationshipSpeaker;
  body: string;
  source_table: string;
  created_at: string;
  message_kind: string | null;
  is_exact_body: boolean;
  is_preview: boolean;
};

export type SmsRelationshipQuestion = {
  text: string;
  asked_at: string;
  source_table: string;
  is_preview: boolean;
};

export type SmsRelationshipAnswer = {
  text: string;
  answered_at: string;
  source_table: string;
};

export type SmsRelationshipDoNotRepeatHint = {
  kind: string;
  phrase: string;
};

export const MEMORY_PRIORITY_RULES: readonly string[] = [
  "DURABLE_PROJECTION_OPEN_QUESTION_BEATS_RUNTIME_GUESS for coach turn-taking.",
  "RECENT_EXACT_THREAD_BEATS_COACHING_SUMMARY when they conflict.",
  "FINAL_SENT_BODY_BEATS_BODY_PREVIEW for what coach last said.",
  "DO_NOT_REPEAT_PROJECTION_QUESTIONS — honor do_not_repeat_phrases and last_5_coach_questions.",
  "If projection open_question_pending is false and open_question_answer_text exists, move forward from that answer.",
  "LAST_SUBSTANTIVE_USER_MESSAGE overrides older memory summaries.",
  "If uncertain, ask a brief clarifying question — do not repeat the same coach question.",
  "COACHING_MEMORY_IS_BACKGROUND — coaching summary and relationship profile are tone only.",
] as const;

const DEFAULT_MAX_MESSAGES = 25;
const PER_MESSAGE_BODY_CAP = 500;
const RECENT_EXACT_THREAD_TEXT_CAP = 11_000;
const THREAD_LOOKBACK_MS = 45 * 24 * 60 * 60 * 1000;
const DEDUPE_WINDOW_MS = 2500;

const COACHING_OUTBOUND_KINDS = new Set(["coach", "question", "quote", "nudge", "weekly"]);

export type SmsRelationshipMemoryPacket = {
  clerk_user_id: string;
  commitment_id: string | null;
  behavior_statement: string | null;
  effective_ask: string | null;
  accountability_phase: string | null;
  pending_resolution_summary: string | null;
  overlay_active: boolean;
  recent_outcomes_summary: {
    yes_7d: number;
    no_7d: number;
    partial_7d: number;
    blockers_7d: number;
    checks_sent_7d: number;
    latest_blocker_preview: string | null;
    latest_proof_hint: string | null;
  };
  coaching_memory_summary: string | null;
  coaching_memory_is_background_only: true;
  relationship_profile_summary: string | null;
  recent_exact_messages: SmsRelationshipMessage[];
  recent_exact_thread_text: string;
  last_outbound_full_body: string | null;
  last_inbound_full_body: string | null;
  last_substantive_user_message: string | null;
  last_substantive_coach_message: string | null;
  last_5_coach_questions: SmsRelationshipQuestion[];
  last_5_user_answers: SmsRelationshipAnswer[];
  latest_open_question_guess: string | null;
  latest_answer_after_open_question_guess: string | null;
  /** Authoritative when projection row exists (M2B-4). */
  latest_open_question: string | null;
  latest_answer_after_open_question: string | null;
  open_question_pending: boolean;
  open_question_source: SmsThreadMemoryProjectionSource;
  answer_source: SmsThreadMemoryProjectionSource;
  do_not_repeat_phrases: SmsRelationshipDoNotRepeatHint[];
  memory_priority_rules: string[];
  meta: {
    message_count: number;
    thread_text_capped: boolean;
    sources_used: string[];
    built_at: string;
    projection_used: boolean;
    projection_load_failed: boolean;
  };
};

type TimelineEntry = {
  t: number;
  speaker: SmsRelationshipSpeaker;
  body: string;
  source_table: string;
  message_kind: string | null;
  is_exact_body: boolean;
  is_preview: boolean;
  priority: number;
};

function stripComplianceFooter(text: string): string {
  return text
    .replace(/\bReply STOP to opt out[\s\S]*$/i, "")
    .replace(/\bReply HELP for help\.?[\s\S]*$/i, "")
    .trim();
}

function normDedupeKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function capMessageBody(body: string, max: number): string {
  const t = body.trim().replace(/\r?\n/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function isComplianceInbound(raw: string): boolean {
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

function isSubstantiveUserMessage(text: string): boolean {
  const t = text.trim();
  if (!t || isComplianceInbound(t) || isEmojiOnlyInbound(t) || isShortAckPhrase(t)) return false;
  if (isAlreadyToldYouCorrection(t)) return false;
  if (t.length >= 12) return true;
  if (/,/.test(t) && t.length >= 5) return true;
  if (t.split(/\s+/).filter(Boolean).length >= 3) return true;
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
  if (parts?.length) return parts[parts.length - 1]!.trim();
  return coachMessageContainsQuestion(msg) ? msg : null;
}

function coachMessageContainsQuestion(coachMessage: string): boolean {
  return coachMessageLooksLikeQuestion(coachMessage);
}

function dedupeTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  const sorted = [...entries].sort((a, b) => a.t - b.t || b.priority - a.priority);
  const out: TimelineEntry[] = [];
  for (const e of sorted) {
    let replaced = false;
    for (let i = out.length - 1; i >= 0 && i >= out.length - 5; i--) {
      const prev = out[i]!;
      if (prev.speaker !== e.speaker) continue;
      if (Math.abs(e.t - prev.t) > DEDUPE_WINDOW_MS) break;
      if (normDedupeKey(prev.body) !== normDedupeKey(e.body)) continue;
      if (e.priority >= prev.priority) out[i] = e;
      replaced = true;
      break;
    }
    if (!replaced) out.push(e);
  }
  return out.sort((a, b) => a.t - b.t);
}

function bodyFromSendEventRow(row: Record<string, unknown>): string {
  if (typeof row.sms_body === "string" && row.sms_body.trim()) return row.sms_body.trim();
  if (typeof row.body === "string" && row.body.trim()) return row.body.trim();
  if (typeof row.message_body === "string" && row.message_body.trim()) return row.message_body.trim();
  const meta = row.metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const m = meta as Record<string, unknown>;
    if (typeof m.sms_body === "string" && m.sms_body.trim()) return m.sms_body.trim();
  }
  return "";
}

function aggregateSevenDayOutcomes(events: V2EventRowForAi[]): SmsRelationshipMemoryPacket["recent_outcomes_summary"] {
  const nowMs = Date.now();
  const cutoff = nowMs - 7 * 24 * 60 * 60 * 1000;
  let yes = 0;
  let no = 0;
  let partial = 0;
  let blockers = 0;
  let checks = 0;
  let latestBlocker: string | null = null;
  let latestProof: string | null = null;
  for (const e of events) {
    const t = new Date(e.occurred_at).getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;
    switch (e.event_type) {
      case "user_yes":
        yes += 1;
        break;
      case "user_no":
        no += 1;
        break;
      case "user_partial":
        partial += 1;
        break;
      case "blocker_captured": {
        blockers += 1;
        const p = e.payload_json as Record<string, unknown> | undefined;
        const msg = typeof p?.message === "string" ? p.message.trim() : "";
        if (msg) latestBlocker = msg.slice(0, 140);
        break;
      }
      case "check_sent":
        checks += 1;
        break;
      default:
        break;
    }
    const p = e.payload_json as Record<string, unknown> | undefined;
    if (p?.proof_moment === true && !latestProof) {
      latestProof = typeof p.proof_moment_type === "string" ? p.proof_moment_type : "proof";
    }
  }
  return {
    yes_7d: yes,
    no_7d: no,
    partial_7d: partial,
    blockers_7d: blockers,
    checks_sent_7d: checks,
    latest_blocker_preview: latestBlocker,
    latest_proof_hint: latestProof,
  };
}

function deriveOpenQuestionGuesses(messages: SmsRelationshipMessage[]): {
  latest_open_question_guess: string | null;
  latest_answer_after_open_question_guess: string | null;
} {
  let latestQ: { text: string; index: number } | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.speaker !== "coach") continue;
    const q = extractQuestionClause(m.body);
    if (q) {
      latestQ = { text: q, index: i };
      break;
    }
  }
  if (!latestQ) {
    return { latest_open_question_guess: null, latest_answer_after_open_question_guess: null };
  }
  for (let j = latestQ.index + 1; j < messages.length; j++) {
    const m = messages[j]!;
    if (m.speaker === "user" && isSubstantiveUserMessage(m.body)) {
      return {
        latest_open_question_guess: latestQ.text,
        latest_answer_after_open_question_guess: m.body.trim(),
      };
    }
  }
  return { latest_open_question_guess: latestQ.text, latest_answer_after_open_question_guess: null };
}

function buildRecentExactThreadText(messages: SmsRelationshipMessage[]): { text: string; capped: boolean } {
  const lines: string[] = [];
  for (const m of messages) {
    const label = m.speaker === "coach" ? "Coach" : "User";
    const previewTag = m.is_preview ? " [preview]" : "";
    lines.push(`${label}${previewTag}: ${m.body}`);
  }
  let text = lines.join("\n");
  let capped = false;
  if (text.length > RECENT_EXACT_THREAD_TEXT_CAP) {
    text = `${text.slice(0, RECENT_EXACT_THREAD_TEXT_CAP - 1)}…`;
    capped = true;
  }
  return { text, capped };
}

function pushDoNotRepeat(
  out: SmsRelationshipDoNotRepeatHint[],
  seen: Set<string>,
  kind: string,
  phrase: string
): void {
  const p = phrase.trim();
  if (!p || p.length < 8) return;
  const key = normDedupeKey(p);
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ kind, phrase: p.slice(0, 280) });
}

export type SlimSmsRelationshipMemoryPacketForFacts = {
  recent_exact_thread_text: string;
  recent_exact_message_count: number;
  last_outbound_full_body: string | null;
  last_inbound_full_body: string | null;
  last_substantive_user_message: string | null;
  last_substantive_coach_message: string | null;
  last_5_coach_questions: string[];
  last_5_user_answers: string[];
  latest_open_question: string | null;
  latest_answer_after_open_question: string | null;
  open_question_pending: boolean;
  open_question_source: SmsThreadMemoryProjectionSource;
  answer_source: SmsThreadMemoryProjectionSource;
  projection_used: boolean;
  latest_open_question_guess: string | null;
  latest_answer_after_open_question_guess: string | null;
  do_not_repeat_phrases: string[];
  memory_priority_rules: string[];
  coaching_memory_summary: string | null;
  coaching_memory_is_background_only: true;
};

export function slimMemoryPacketForFacts(packet: SmsRelationshipMemoryPacket): SlimSmsRelationshipMemoryPacketForFacts {
  return {
    recent_exact_thread_text: packet.recent_exact_thread_text,
    recent_exact_message_count: packet.recent_exact_messages.length,
    last_outbound_full_body: packet.last_outbound_full_body,
    last_inbound_full_body: packet.last_inbound_full_body,
    last_substantive_user_message: packet.last_substantive_user_message,
    last_substantive_coach_message: packet.last_substantive_coach_message,
    last_5_coach_questions: packet.last_5_coach_questions.map((q) => q.text),
    last_5_user_answers: packet.last_5_user_answers.map((a) => a.text),
    latest_open_question: packet.latest_open_question,
    latest_answer_after_open_question: packet.latest_answer_after_open_question,
    open_question_pending: packet.open_question_pending,
    open_question_source: packet.open_question_source,
    answer_source: packet.answer_source,
    projection_used: packet.meta.projection_used,
    latest_open_question_guess: packet.latest_open_question_guess,
    latest_answer_after_open_question_guess: packet.latest_answer_after_open_question_guess,
    do_not_repeat_phrases: packet.do_not_repeat_phrases.map((h) => h.phrase),
    memory_priority_rules: [...packet.memory_priority_rules],
    coaching_memory_summary: packet.coaching_memory_summary,
    coaching_memory_is_background_only: true,
  };
}

export type DailyThreadMemoryFromPacketArgs = {
  packet: SmsRelationshipMemoryPacket;
  /** Legacy conv pack previews when packet lacks a side. */
  convLatestOutbound?: string | null;
  convLatestInbound?: string | null;
  recentTranscriptOrContextBlock?: string | null;
  coachingMemorySnippet?: string;
  extraDoNotRepeatHints?: string[];
};

/** Maps unified memory packet into daily V3 thread_memory fields. */
export function buildDailyThreadMemoryFromPacket(args: DailyThreadMemoryFromPacketArgs): {
  latest_outbound_sms: string | null;
  latest_inbound_sms: string | null;
  recent_transcript_or_context_block: string | null;
  latest_open_question: string | null;
  latest_answer_after_open_question: string | null;
  open_question_pending: boolean;
  projection_used: boolean;
  open_question_source: SmsThreadMemoryProjectionSource;
  answer_source: SmsThreadMemoryProjectionSource;
  do_not_repeat_hints: string[];
  coaching_memory_snippet: string;
  recent_exact_thread_text: string;
  last_outbound_full_body: string | null;
  last_inbound_full_body: string | null;
  last_5_coach_questions: string[];
  last_5_user_answers: string[];
  memory_priority_rules: string[];
} {
  const { packet } = args;
  const dnr = [
    ...(args.extraDoNotRepeatHints ?? []),
    ...packet.do_not_repeat_phrases.map((h) => h.phrase),
  ].filter(Boolean);
  const uniqueDnr = [...new Set(dnr.map((s) => s.trim()).filter(Boolean))].slice(0, 16);

  return {
    latest_outbound_sms:
      packet.last_outbound_full_body ?? args.convLatestOutbound?.trim() ?? null,
    latest_inbound_sms: packet.last_inbound_full_body ?? args.convLatestInbound?.trim() ?? null,
    recent_transcript_or_context_block:
      packet.recent_exact_thread_text.trim() ||
      args.recentTranscriptOrContextBlock?.trim() ||
      null,
    latest_open_question: packet.latest_open_question ?? packet.latest_open_question_guess,
    latest_answer_after_open_question:
      packet.latest_answer_after_open_question ?? packet.latest_answer_after_open_question_guess,
    open_question_pending: packet.open_question_pending,
    projection_used: packet.meta.projection_used,
    open_question_source: packet.open_question_source,
    answer_source: packet.answer_source,
    do_not_repeat_hints: uniqueDnr,
    coaching_memory_snippet:
      args.coachingMemorySnippet?.trim() ||
      (packet.coaching_memory_summary
        ? `COACHING_MEMORY (background only; RECENT_EXACT_THREAD wins on conflict):\n${packet.coaching_memory_summary}`
        : ""),
    recent_exact_thread_text: packet.recent_exact_thread_text,
    last_outbound_full_body: packet.last_outbound_full_body,
    last_inbound_full_body: packet.last_inbound_full_body,
    last_5_coach_questions: packet.last_5_coach_questions.map((q) => q.text),
    last_5_user_answers: packet.last_5_user_answers.map((a) => a.text),
    memory_priority_rules: [...packet.memory_priority_rules],
  };
}

export type WeeklyThreadMemoryFromPacketArgs = {
  packet: SlimSmsRelationshipMemoryPacketForFacts;
  convLatestOutbound?: string | null;
  convLatestInbound?: string | null;
  recentTranscriptLines?: string[];
  coachingMemorySnippet?: string;
  extraDoNotRepeatHints?: string[];
};

/** Maps unified memory packet into weekly V3 thread fields (M2B-6). */
export function buildWeeklyThreadMemoryFromPacket(args: WeeklyThreadMemoryFromPacketArgs): {
  latest_outbound_preview: string | null;
  latest_inbound_preview: string | null;
  recent_transcript_lines: string[];
  recent_exact_thread_text: string | null;
  last_outbound_full_body: string | null;
  last_inbound_full_body: string | null;
  last_5_coach_questions: string[];
  last_5_user_answers: string[];
  latest_open_question: string | null;
  latest_answer_after_open_question: string | null;
  open_question_pending: boolean;
  open_question_source: string | null;
  answer_source: string | null;
  projection_used: boolean;
  memory_packet_used: boolean;
  recent_exact_message_count: number | null;
  do_not_repeat_hints: string[];
  coaching_memory_snippet: string | null;
  memory_priority_rules: string[];
} {
  const { packet } = args;
  const dnr = [
    ...(args.extraDoNotRepeatHints ?? []),
    ...packet.do_not_repeat_phrases,
  ].filter(Boolean);
  const uniqueDnr = [...new Set(dnr.map((s) => s.trim()).filter(Boolean))].slice(0, 16);
  const transcript =
    packet.recent_exact_thread_text.trim() ||
    args.recentTranscriptLines?.join("\n").trim() ||
    "";

  return {
    latest_outbound_preview:
      packet.last_outbound_full_body ?? args.convLatestOutbound?.trim() ?? null,
    latest_inbound_preview: packet.last_inbound_full_body ?? args.convLatestInbound?.trim() ?? null,
    recent_transcript_lines: args.recentTranscriptLines?.slice(-12) ?? [],
    recent_exact_thread_text: transcript || null,
    last_outbound_full_body: packet.last_outbound_full_body,
    last_inbound_full_body: packet.last_inbound_full_body,
    last_5_coach_questions: [...packet.last_5_coach_questions],
    last_5_user_answers: [...packet.last_5_user_answers],
    latest_open_question: packet.latest_open_question ?? packet.latest_open_question_guess,
    latest_answer_after_open_question:
      packet.latest_answer_after_open_question ?? packet.latest_answer_after_open_question_guess,
    open_question_pending: packet.open_question_pending,
    open_question_source: packet.open_question_source,
    answer_source: packet.answer_source,
    projection_used: packet.projection_used,
    memory_packet_used: true,
    recent_exact_message_count: packet.recent_exact_message_count,
    do_not_repeat_hints: uniqueDnr,
    coaching_memory_snippet:
      args.coachingMemorySnippet?.trim() ||
      (packet.coaching_memory_summary
        ? `COACHING_MEMORY (background only; RECENT_EXACT_THREAD wins on conflict):\n${packet.coaching_memory_summary}`
        : null),
    memory_priority_rules: [...packet.memory_priority_rules],
  };
}

export async function buildSmsRelationshipMemoryPacket(args: {
  clerkUserId: string;
  commitmentId?: string | null;
  maxMessages?: number;
  now?: Date;
}): Promise<SmsRelationshipMemoryPacket> {
  const now = args.now ?? new Date();
  const nowMs = now.getTime();
  const cutoffMs = nowMs - THREAD_LOOKBACK_MS;
  const maxMessages = args.maxMessages ?? DEFAULT_MAX_MESSAGES;

  let commitment: ActiveV2CommitmentRow | null = null;
  let events: V2EventRowForAi[] = [];
  let coachingMemory: V2CoachingMemoryForPrompt | null = null;

  if (args.commitmentId) {
    const { data: cRow } = await supabaseServer
      .from("v2_commitment")
      .select("*")
      .eq("id", args.commitmentId)
      .maybeSingle();
    if (cRow) commitment = cRow as ActiveV2CommitmentRow;
    events = await getRecentV2EventsForAi(args.commitmentId);
    coachingMemory = await loadV2CoachingMemoryForPrompt(args.commitmentId);
  }

  const [
    { data: profile },
    { data: lastCtx },
    { data: inboundMsgRows },
    { data: sendRows },
    { data: coachJobRows },
  ] = await Promise.all([
    supabaseServer
      .from("user_profiles")
      .select("preferred_name, life_desires, people_summary, identity_anchor_text, identity_source")
      .eq("clerk_user_id", args.clerkUserId)
      .maybeSingle(),
    supabaseServer
      .from("sms_last_outbound_context")
      .select("sent_at, full_body, message_kind")
      .eq("clerk_user_id", args.clerkUserId)
      .maybeSingle(),
    supabaseServer
      .from("sms_inbound_messages")
      .select("raw_body, created_at, message_sid")
      .eq("clerk_user_id", args.clerkUserId)
      .order("created_at", { ascending: false })
      .limit(40),
    supabaseServer
      .from("sms_send_events")
      .select("sms_body, body, message_body, created_at, metadata, status")
      .eq("clerk_user_id", args.clerkUserId)
      .order("created_at", { ascending: false })
      .limit(40),
    supabaseServer
      .from("sms_inbound_coach_jobs")
      .select(
        "raw_body, reply_body, sent_at, updated_at, created_at, message_sid, status, outbound_message_sid"
      )
      .eq("clerk_user_id", args.clerkUserId)
      .order("updated_at", { ascending: false })
      .limit(40),
  ]);

  const rich: TimelineEntry[] = [];
  const sourcesUsed = new Set<string>();

  const sendBodiesByTime = new Map<number, string>();

  for (const r of sendRows ?? []) {
    const row = r as Record<string, unknown>;
    const ts = typeof row.created_at === "string" ? new Date(row.created_at).getTime() : 0;
    const body = stripComplianceFooter(bodyFromSendEventRow(row));
    if (!body || !Number.isFinite(ts) || ts < cutoffMs) continue;
    sendBodiesByTime.set(ts, body);
    rich.push({
      t: ts,
      speaker: "coach",
      body: capMessageBody(body, PER_MESSAGE_BODY_CAP),
      source_table: "sms_send_events",
      message_kind: "daily",
      is_exact_body: true,
      is_preview: false,
      priority: 90,
    });
    sourcesUsed.add("sms_send_events");
  }

  for (const r of coachJobRows ?? []) {
    const row = r as {
      raw_body?: string | null;
      reply_body?: string | null;
      sent_at?: string | null;
      updated_at?: string | null;
      created_at?: string | null;
      status?: string | null;
      outbound_message_sid?: string | null;
    };
    const raw = typeof row.raw_body === "string" ? row.raw_body.trim() : "";
    const reply = typeof row.reply_body === "string" ? row.reply_body.trim() : "";
    const sentLike =
      Boolean(row.sent_at?.trim()) ||
      row.status === "sent" ||
      Boolean(row.outbound_message_sid?.trim());

    if (raw) {
      const tsRaw = row.created_at ?? row.updated_at;
      const ts = typeof tsRaw === "string" ? new Date(tsRaw).getTime() : 0;
      if (Number.isFinite(ts) && ts >= cutoffMs && !isComplianceInbound(raw)) {
        rich.push({
          t: ts,
          speaker: "user",
          body: capMessageBody(raw, PER_MESSAGE_BODY_CAP),
          source_table: "sms_inbound_coach_jobs",
          message_kind: null,
          is_exact_body: true,
          is_preview: false,
          priority: 95,
        });
        sourcesUsed.add("sms_inbound_coach_jobs");
      }
    }

    if (reply && sentLike) {
      const tsRaw = row.sent_at ?? row.updated_at ?? row.created_at;
      const ts = typeof tsRaw === "string" ? new Date(tsRaw).getTime() : 0;
      if (Number.isFinite(ts) && ts >= cutoffMs) {
        rich.push({
          t: ts,
          speaker: "coach",
          body: capMessageBody(stripComplianceFooter(reply), PER_MESSAGE_BODY_CAP),
          source_table: "sms_inbound_coach_jobs",
          message_kind: "coach",
          is_exact_body: true,
          is_preview: false,
          priority: 100,
        });
        sourcesUsed.add("sms_inbound_coach_jobs");
      }
    }
  }

  for (const r of inboundMsgRows ?? []) {
    const row = r as { raw_body?: string; created_at?: string };
    const raw = typeof row.raw_body === "string" ? row.raw_body.trim() : "";
    const ts = typeof row.created_at === "string" ? new Date(row.created_at).getTime() : 0;
    if (!raw || !Number.isFinite(ts) || ts < cutoffMs || isComplianceInbound(raw)) continue;
    rich.push({
      t: ts,
      speaker: "user",
      body: capMessageBody(raw, PER_MESSAGE_BODY_CAP),
      source_table: "sms_inbound_messages",
      message_kind: null,
      is_exact_body: true,
      is_preview: false,
      priority: 50,
    });
    sourcesUsed.add("sms_inbound_messages");
  }

  if (commitment && events.length) {
    const eventsAsc = [...events].sort(
      (a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
    );
    for (const e of eventsAsc) {
      if (e.event_type !== "check_sent") continue;
      const raw = e.payload_json as Record<string, unknown> | undefined;
      const preview = typeof raw?.body_preview === "string" ? raw.body_preview.trim() : "";
      if (!preview) continue;
      const ts = new Date(e.occurred_at).getTime();
      if (!Number.isFinite(ts) || ts < cutoffMs) continue;
      const nearSend = [...sendBodiesByTime.keys()].some((st) => Math.abs(st - ts) < 120_000);
      if (nearSend) continue;
      rich.push({
        t: ts,
        speaker: "coach",
        body: capMessageBody(stripComplianceFooter(preview), PER_MESSAGE_BODY_CAP),
        source_table: "v2_commitment_event_check_sent",
        message_kind: "check_sent_preview",
        is_exact_body: false,
        is_preview: true,
        priority: 60,
      });
      sourcesUsed.add("v2_commitment_event_check_sent");
    }
  }

  if (lastCtx && typeof (lastCtx as { sent_at?: string }).sent_at === "string") {
    const row = lastCtx as { sent_at: string; full_body?: string; message_kind?: string };
    const kind = typeof row.message_kind === "string" ? row.message_kind : "transactional";
    if (COACHING_OUTBOUND_KINDS.has(kind)) {
      const raw = typeof row.full_body === "string" ? row.full_body : "";
      const ts = new Date(row.sent_at).getTime();
      if (raw.trim() && Number.isFinite(ts) && ts >= cutoffMs) {
        const alreadyCoach = rich.some(
          (e) =>
            e.speaker === "coach" &&
            e.is_exact_body &&
            Math.abs(e.t - ts) < 120_000 &&
            normDedupeKey(e.body) === normDedupeKey(raw)
        );
        if (!alreadyCoach) {
          rich.push({
            t: ts,
            speaker: "coach",
            body: capMessageBody(stripComplianceFooter(raw), PER_MESSAGE_BODY_CAP),
            source_table: "sms_last_outbound_context",
            message_kind: kind,
            is_exact_body: true,
            is_preview: false,
            priority: 35,
          });
          sourcesUsed.add("sms_last_outbound_context");
        }
      }
    }
  }

  const merged = dedupeTimeline(rich);
  const sliced = merged.slice(-maxMessages);
  const recent_exact_messages: SmsRelationshipMessage[] = sliced.map((e) => ({
    speaker: e.speaker,
    body: e.body,
    source_table: e.source_table,
    created_at: new Date(e.t).toISOString(),
    message_kind: e.message_kind,
    is_exact_body: e.is_exact_body,
    is_preview: e.is_preview,
  }));

  const { text: recent_exact_thread_text, capped: thread_text_capped } =
    buildRecentExactThreadText(recent_exact_messages);

  const lastCoach = [...recent_exact_messages].reverse().find((m) => m.speaker === "coach");
  const lastUser = [...recent_exact_messages].reverse().find((m) => m.speaker === "user");
  let last_outbound_full_body = lastCoach?.is_exact_body ? lastCoach.body : lastCoach?.body ?? null;
  let last_inbound_full_body = lastUser?.body ?? null;

  let last_substantive_user_message: string | null = null;
  let last_substantive_coach_message: string | null = null;
  for (let i = recent_exact_messages.length - 1; i >= 0; i--) {
    const m = recent_exact_messages[i]!;
    if (!last_substantive_user_message && m.speaker === "user" && isSubstantiveUserMessage(m.body)) {
      last_substantive_user_message = m.body;
    }
    if (!last_substantive_coach_message && m.speaker === "coach" && m.body.length >= 12) {
      last_substantive_coach_message = m.body;
    }
    if (last_substantive_user_message && last_substantive_coach_message) break;
  }

  let last_5_coach_questions: SmsRelationshipQuestion[] = [];
  for (let i = recent_exact_messages.length - 1; i >= 0 && last_5_coach_questions.length < 5; i--) {
    const m = recent_exact_messages[i]!;
    if (m.speaker !== "coach") continue;
    const q = extractQuestionClause(m.body);
    if (!q) continue;
    last_5_coach_questions.unshift({
      text: q,
      asked_at: m.created_at,
      source_table: m.source_table,
      is_preview: m.is_preview,
    });
  }

  let last_5_user_answers: SmsRelationshipAnswer[] = [];
  for (let i = recent_exact_messages.length - 1; i >= 0 && last_5_user_answers.length < 5; i--) {
    const m = recent_exact_messages[i]!;
    if (m.speaker !== "user" || !isSubstantiveUserMessage(m.body)) continue;
    last_5_user_answers.unshift({
      text: m.body,
      answered_at: m.created_at,
      source_table: m.source_table,
    });
  }

  const { latest_open_question_guess, latest_answer_after_open_question_guess } =
    deriveOpenQuestionGuesses(recent_exact_messages);

  const do_not_repeat_phrases: SmsRelationshipDoNotRepeatHint[] = [];
  const seenDnr = new Set<string>();

  for (const q of last_5_coach_questions) {
    pushDoNotRepeat(do_not_repeat_phrases, seenDnr, "prior_coach_question", q.text);
  }
  if (latest_open_question_guess) {
    pushDoNotRepeat(do_not_repeat_phrases, seenDnr, "latest_open_question_guess", latest_open_question_guess);
  }

  if (coachingMemory) {
    for (const h of deriveDoNotRepeatHintsFromCoachingMemory(coachingMemory)) {
      pushDoNotRepeat(do_not_repeat_phrases, seenDnr, "coaching_memory_hint", h);
    }
  }

  if (commitment && events.length) {
    const learning = deriveV3LearningSignalsFromContext({
      recentEventsNewestFirst: events,
      coachingMemory,
      latestInbound: last_inbound_full_body ?? "",
    });
    if (learning.doNotRepeat) {
      pushDoNotRepeat(do_not_repeat_phrases, seenDnr, "v3_learning", learning.doNotRepeat);
    }
  }

  const coaching_memory_summary = coachingMemory
    ? formatCoachingMemoryPromptBlock(coachingMemory).slice(0, 1400)
    : null;

  const relProfile =
    coachingMemory?.sms_relationship_profile != null
      ? JSON.stringify(coachingMemory.sms_relationship_profile).slice(0, 240)
      : typeof profile?.preferred_name === "string"
        ? `preferred_name=${profile.preferred_name}`
        : null;

  let pending_resolution_summary: string | null = null;
  if (commitment?.pending_resolution_kind) {
    pending_resolution_summary = `pending_resolution_kind=${commitment.pending_resolution_kind}`;
  }

  const effective_ask =
    commitment != null ? getEffectiveCoachingAsk(commitment, nowMs) : coachingMemory?.effective_ask_text ?? null;

  let projectionUsed = false;
  let projectionLoadFailed = false;
  const projection =
    args.commitmentId != null
      ? await loadV2CommitmentSmsThreadMemory({ commitmentId: args.commitmentId }).catch((e: unknown) => {
          projectionLoadFailed = true;
          console.warn("[sms-relationship-memory-packet] projection_load_failed", {
            commitment_id: args.commitmentId,
            message: e instanceof Error ? e.message : String(e),
          });
          return null;
        })
      : null;

  if (projection) {
    projectionUsed = true;
    const runtimeCoachAt = lastCoach?.created_at ?? null;
    const runtimeUserAt = lastUser?.created_at ?? null;
    const outboundPick =
      projection.last_outbound_full_body?.trim() &&
      parseIsoMs(projection.last_outbound_sent_at) >= parseIsoMs(runtimeCoachAt)
        ? projection.last_outbound_full_body.trim()
        : last_outbound_full_body;
    const inboundPick =
      projection.last_inbound_full_body?.trim() &&
      parseIsoMs(projection.last_inbound_at) >= parseIsoMs(runtimeUserAt)
        ? projection.last_inbound_full_body.trim()
        : last_inbound_full_body;
    if (outboundPick) {
      last_outbound_full_body = outboundPick;
      if (last_substantive_coach_message && outboundPick.length >= 12) {
        last_substantive_coach_message = outboundPick;
      }
    }
    if (inboundPick) {
      last_inbound_full_body = inboundPick;
      if (isSubstantiveUserMessage(inboundPick)) {
        last_substantive_user_message = inboundPick;
      }
    }

    if (projection.last_5_coach_questions.length > 0) {
      last_5_coach_questions = projection.last_5_coach_questions.map((q) => ({
        text: q.text,
        asked_at: q.asked_at,
        source_table: "v2_commitment_sms_thread_memory",
        is_preview: false,
      }));
    }
    if (projection.last_5_user_answers.length > 0) {
      last_5_user_answers = projection.last_5_user_answers.map((a) => ({
        text: a.text,
        answered_at: a.answered_at,
        source_table: "v2_commitment_sms_thread_memory",
      }));
    }

    for (const phrase of projection.do_not_repeat_phrases) {
      pushDoNotRepeat(do_not_repeat_phrases, seenDnr, "projection_dnr", phrase);
    }
  }

  let latest_open_question: string | null = null;
  let open_question_source: SmsThreadMemoryProjectionSource = "none";
  if (projection?.open_question_text?.trim()) {
    latest_open_question = projection.open_question_text.trim();
    open_question_source = "projection";
  } else if (latest_open_question_guess) {
    latest_open_question = latest_open_question_guess;
    open_question_source = "runtime_guess";
  }

  let latest_answer_after_open_question: string | null = null;
  let answer_source: SmsThreadMemoryProjectionSource = "none";
  if (projection?.open_question_answer_text?.trim() && projection.open_question_pending === false) {
    latest_answer_after_open_question = projection.open_question_answer_text.trim();
    answer_source = "projection";
  } else if (latest_answer_after_open_question_guess) {
    latest_answer_after_open_question = latest_answer_after_open_question_guess;
    answer_source = "runtime_guess";
  }

  const open_question_pending = projection
    ? projection.open_question_pending === true
    : Boolean(latest_open_question_guess && !latest_answer_after_open_question_guess);

  return {
    clerk_user_id: args.clerkUserId,
    commitment_id: args.commitmentId ?? commitment?.id ?? null,
    behavior_statement: commitment?.behavior_statement?.trim() ?? null,
    effective_ask: effective_ask?.trim() ?? null,
    accountability_phase: commitment?.accountability_phase ?? coachingMemory?.accountability_phase ?? null,
    pending_resolution_summary,
    overlay_active: Boolean(commitment?.adaptive_proposal_text?.trim()),
    recent_outcomes_summary: aggregateSevenDayOutcomes(events),
    coaching_memory_summary,
    coaching_memory_is_background_only: true,
    relationship_profile_summary: relProfile,
    recent_exact_messages,
    recent_exact_thread_text,
    last_outbound_full_body,
    last_inbound_full_body,
    last_substantive_user_message,
    last_substantive_coach_message,
    last_5_coach_questions,
    last_5_user_answers,
    latest_open_question_guess,
    latest_answer_after_open_question_guess,
    latest_open_question,
    latest_answer_after_open_question,
    open_question_pending,
    open_question_source,
    answer_source,
    do_not_repeat_phrases,
    memory_priority_rules: [...MEMORY_PRIORITY_RULES],
    meta: {
      message_count: recent_exact_messages.length,
      thread_text_capped,
      sources_used: projectionUsed
        ? [...sourcesUsed, "v2_commitment_sms_thread_memory"]
        : [...sourcesUsed],
      built_at: now.toISOString(),
      projection_used: projectionUsed,
      projection_load_failed: projectionLoadFailed,
    },
  };
}

function parseIsoMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}
