/**
 * M2A — Unified SMS relationship memory packet from existing tables (read-only, no schema).
 * Recent exact thread outranks coaching summaries for V3 lane facts.
 */

import {
  isImportantPeopleRelationshipType,
  type ImportantPeopleRelationshipType,
} from "@/lib/onboarding-people-summary";
import {
  relationshipAnchorSourcesFromProfileAndPeople,
  type ImportantPersonRow,
  type RelationshipAnchorSources,
} from "@/lib/sms-relationship-anchors";
import { supabaseServer } from "@/lib/supabase-server";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { getRecentV2EventsForAi, type V2EventRowForAi } from "@/lib/v2-commitment";
import { loadV2CoachingMemoryForPrompt, type V2CoachingMemoryForPrompt } from "@/lib/v2-coaching-memory";
import { formatCoachingMemoryPromptBlock } from "@/lib/v2-coaching-memory-prompt";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { loadV2CommitmentSmsThreadMemory } from "@/lib/v2-commitment-sms-thread-memory";
import { deriveDoNotRepeatHintsFromCoachingMemory } from "@/lib/v3-daily-relationship-lane";
import { deriveV3LearningSignalsFromContext } from "@/lib/v3-sms-learning";
import {
  buildRecentExactThread72h,
  recentExactThreadTextFrom72hMessages,
  type BriefThreadBuildTelemetry,
  type ExactThreadWriterPath,
  type RecentExactThread72hResult,
} from "@/lib/sms-recent-exact-thread-72h";
import {
  extractRecentCoachBodiesForAntiRepeat,
  type RecentCoachBodyDoNotRepeat,
} from "@/lib/sms-recent-coach-body-anti-repeat";

export type { RecentCoachBodyDoNotRepeat } from "@/lib/sms-recent-coach-body-anti-repeat";
export {
  extractRecentCoachBodiesForAntiRepeat,
  GUARD_COACH_BODY_ANTI_REPEAT_MAX,
  PROMPT_COACH_BODY_DO_NOT_REPEAT_MAX,
} from "@/lib/sms-recent-coach-body-anti-repeat";
import {
  buildRelationshipMemory7d,
  type RelationshipMemory7dResult,
} from "@/lib/sms-relationship-memory-7d";
import {
  buildRelationshipMemory30d,
  type RelationshipMemory30dResult,
} from "@/lib/sms-relationship-memory-30d";
import { fetchEventsForRelationshipProfile } from "@/lib/v2-sms-relationship-profile";
import {
  loadSmsVictoryBackgroundContext,
  mapSmsVictoryBackgroundToFacts,
} from "@/lib/sms-victory-background-context";

export type { RelationshipMemory7dData, RelationshipMemory7dResult } from "@/lib/sms-relationship-memory-7d";
export type { RelationshipMemory30dData, RelationshipMemory30dResult } from "@/lib/sms-relationship-memory-30d";

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
  "If projection open_question_pending is false and open_question_answer_text exists: move forward from that answer only when it is proof/outcome (they got it done, started it, missed it, or said yes/no to a check) or no pending plan proof is active. A plan-only answer is not proof — if pending plan proof is active, close the prior plan loop first.",
  "LAST_SUBSTANTIVE_USER_MESSAGE overrides older memory summaries.",
  "If uncertain, ask a brief clarifying question — do not repeat the same coach question.",
  "COACHING_MEMORY_IS_BACKGROUND — coaching summary and relationship profile are tone only.",
] as const;

const DEFAULT_MAX_MESSAGES = 25;
const RECENT_EXACT_THREAD_TEXT_CAP = 11_000;

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
  recent_exact_thread_72h: RecentExactThread72hResult;
  recent_coach_body_do_not_repeat: RecentCoachBodyDoNotRepeat[];
  relationship_memory_7d: RelationshipMemory7dResult;
  relationship_memory_30d: RelationshipMemory30dResult;
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
  open_question_answered_at: string | null;
  open_question_pending: boolean;
  open_question_expected_answer_type: string | null;
  open_question_source: SmsThreadMemoryProjectionSource;
  answer_source: SmsThreadMemoryProjectionSource;
  do_not_repeat_phrases: SmsRelationshipDoNotRepeatHint[];
  memory_priority_rules: string[];
  relationship_anchor_sources: RelationshipAnchorSources;
    meta: {
      message_count: number;
      thread_text_capped: boolean;
      sources_used: string[];
      built_at: string;
      projection_used: boolean;
      projection_load_failed: boolean;
      thread_build_telemetry?: BriefThreadBuildTelemetry;
    };
};

function normDedupeKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
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

function recentOutcomesSummaryFromMemory7d(
  memory7d: RelationshipMemory7dResult
): SmsRelationshipMemoryPacket["recent_outcomes_summary"] {
  const c = memory7d.outcome_counts;
  return {
    yes_7d: c.yes,
    no_7d: c.no,
    partial_7d: c.partial,
    blockers_7d: c.blockers,
    checks_sent_7d: c.checks_sent,
    latest_blocker_preview: memory7d.blockers[0]?.evidence ?? null,
    latest_proof_hint: memory7d.proof_moments[0]?.proof_type ?? null,
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
  recent_exact_thread_72h: RecentExactThread72hResult;
  recent_coach_body_do_not_repeat: RecentCoachBodyDoNotRepeat[];
  relationship_memory_7d: RelationshipMemory7dResult;
  relationship_memory_30d: RelationshipMemory30dResult;
  last_outbound_full_body: string | null;
  last_inbound_full_body: string | null;
  last_substantive_user_message: string | null;
  last_substantive_coach_message: string | null;
  last_5_coach_questions: string[];
  last_5_user_answers: string[];
  latest_open_question: string | null;
  latest_answer_after_open_question: string | null;
  open_question_answered_at: string | null;
  open_question_pending: boolean;
  open_question_expected_answer_type: string | null;
  open_question_source: SmsThreadMemoryProjectionSource;
  answer_source: SmsThreadMemoryProjectionSource;
  projection_used: boolean;
  latest_open_question_guess: string | null;
  latest_answer_after_open_question_guess: string | null;
  do_not_repeat_phrases: string[];
  memory_priority_rules: string[];
  coaching_memory_summary: string | null;
  coaching_memory_is_background_only: true;
  relationship_anchor_sources: RelationshipAnchorSources;
};

export function slimMemoryPacketForFacts(packet: SmsRelationshipMemoryPacket): SlimSmsRelationshipMemoryPacketForFacts {
  return {
    recent_exact_thread_text: packet.recent_exact_thread_text,
    recent_exact_message_count: packet.recent_exact_messages.length,
    recent_exact_thread_72h: packet.recent_exact_thread_72h,
    recent_coach_body_do_not_repeat: packet.recent_coach_body_do_not_repeat,
    relationship_memory_7d: packet.relationship_memory_7d,
    relationship_memory_30d: packet.relationship_memory_30d,
    last_outbound_full_body: packet.last_outbound_full_body,
    last_inbound_full_body: packet.last_inbound_full_body,
    last_substantive_user_message: packet.last_substantive_user_message,
    last_substantive_coach_message: packet.last_substantive_coach_message,
    last_5_coach_questions: packet.last_5_coach_questions.map((q) => q.text),
    last_5_user_answers: packet.last_5_user_answers.map((a) => a.text),
    latest_open_question: packet.latest_open_question,
    latest_answer_after_open_question: packet.latest_answer_after_open_question,
    open_question_answered_at: packet.open_question_answered_at,
    open_question_pending: packet.open_question_pending,
    open_question_expected_answer_type: packet.open_question_expected_answer_type,
    open_question_source: packet.open_question_source,
    answer_source: packet.answer_source,
    projection_used: packet.meta.projection_used,
    latest_open_question_guess: packet.latest_open_question_guess,
    latest_answer_after_open_question_guess: packet.latest_answer_after_open_question_guess,
    do_not_repeat_phrases: packet.do_not_repeat_phrases.map((h) => h.phrase),
    memory_priority_rules: [...packet.memory_priority_rules],
    coaching_memory_summary: packet.coaching_memory_summary,
    coaching_memory_is_background_only: true,
    relationship_anchor_sources: packet.relationship_anchor_sources,
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
  open_question_answered_at: string | null;
  open_question_pending: boolean;
  projection_used: boolean;
  open_question_source: SmsThreadMemoryProjectionSource;
  answer_source: SmsThreadMemoryProjectionSource;
  do_not_repeat_hints: string[];
  coaching_memory_snippet: string;
  recent_exact_thread_text: string;
  recent_exact_thread_72h: RecentExactThread72hResult;
  relationship_memory_7d: RelationshipMemory7dResult;
  relationship_memory_30d: RelationshipMemory30dResult;
  last_outbound_full_body: string | null;
  last_inbound_full_body: string | null;
  last_5_coach_questions: string[];
  last_5_user_answers: string[];
  memory_priority_rules: string[];
  recent_coach_body_do_not_repeat: RecentCoachBodyDoNotRepeat[];
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
    open_question_answered_at: packet.open_question_answered_at,
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
    recent_exact_thread_72h: packet.recent_exact_thread_72h,
    relationship_memory_7d: packet.relationship_memory_7d,
    relationship_memory_30d: packet.relationship_memory_30d,
    last_outbound_full_body: packet.last_outbound_full_body,
    last_inbound_full_body: packet.last_inbound_full_body,
    last_5_coach_questions: packet.last_5_coach_questions.map((q) => q.text),
    last_5_user_answers: packet.last_5_user_answers.map((a) => a.text),
    memory_priority_rules: [...packet.memory_priority_rules],
    recent_coach_body_do_not_repeat: packet.recent_coach_body_do_not_repeat,
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
  recent_exact_thread_72h?: SlimSmsRelationshipMemoryPacketForFacts["recent_exact_thread_72h"];
  relationship_memory_7d?: SlimSmsRelationshipMemoryPacketForFacts["relationship_memory_7d"];
  relationship_memory_30d?: SlimSmsRelationshipMemoryPacketForFacts["relationship_memory_30d"];
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
    recent_exact_thread_72h: packet.recent_exact_thread_72h,
    relationship_memory_7d: packet.relationship_memory_7d,
    relationship_memory_30d: packet.relationship_memory_30d,
  };
}

export async function buildSmsRelationshipMemoryPacket(args: {
  clerkUserId: string;
  commitmentId?: string | null;
  timezone?: string;
  maxMessages?: number;
  now?: Date;
  /** Path-specific exact thread window (daily/inbound 7d, weekly 10d). */
  exactThreadPath?: ExactThreadWriterPath;
}): Promise<SmsRelationshipMemoryPacket> {
  const now = args.now ?? new Date();
  const nowMs = now.getTime();
  const maxMessages = args.maxMessages ?? DEFAULT_MAX_MESSAGES;

  let commitment: ActiveV2CommitmentRow | null = null;
  let events: V2EventRowForAi[] = [];
  let events30d: V2EventRowForAi[] = [];
  let coachingMemory: V2CoachingMemoryForPrompt | null = null;

  if (args.commitmentId) {
    const { data: cRow } = await supabaseServer
      .from("v2_commitment")
      .select("*")
      .eq("id", args.commitmentId)
      .maybeSingle();
    if (cRow) commitment = cRow as ActiveV2CommitmentRow;
    events = await getRecentV2EventsForAi(args.commitmentId);
    events30d = await fetchEventsForRelationshipProfile(args.commitmentId);
    coachingMemory = await loadV2CoachingMemoryForPrompt(args.commitmentId);
  }

  const { data: profile } = await supabaseServer
    .from("user_profiles")
    .select("preferred_name, people_summary, identity_anchor_text, identity_source, updated_at")
    .eq("clerk_user_id", args.clerkUserId)
    .maybeSingle();

  const { data: importantPeopleRows } = await supabaseServer
    .from("important_people")
    .select("display_name, relationship_type, source")
    .eq("clerk_user_id", args.clerkUserId)
    .eq("is_active", true)
    .is("removed_at", null);

  const importantPeople: ImportantPersonRow[] = [];
  for (const row of importantPeopleRows ?? []) {
    const name = typeof row.display_name === "string" ? row.display_name.trim() : "";
    if (!name || !isImportantPeopleRelationshipType(row.relationship_type)) continue;
    importantPeople.push({
      display_name: name,
      relationship_type: row.relationship_type as ImportantPeopleRelationshipType,
      source: typeof row.source === "string" ? row.source : null,
    });
  }

  const relationship_anchor_sources = relationshipAnchorSourcesFromProfileAndPeople({
    importantPeople,
    peopleSummary:
      typeof profile?.people_summary === "string" ? profile.people_summary : null,
    peopleSummaryUpdatedAt:
      typeof profile?.updated_at === "string" ? profile.updated_at : null,
  });

  const recent_exact_thread_72h = await buildRecentExactThread72h({
    clerkUserId: args.clerkUserId,
    commitmentId: args.commitmentId,
    timezone: args.timezone ?? "America/New_York",
    now,
    path: args.exactThreadPath ?? "inbound",
    preloadedCheckSentEvents: events,
  });

  const sourcesUsed = new Set<string>(recent_exact_thread_72h.messages.map((m) => m.source_table));

  const recent_exact_messages: SmsRelationshipMessage[] = recent_exact_thread_72h.messages
    .filter((m) => m.role === "coach" || m.role === "user")
    .slice(-maxMessages)
    .map((m) => ({
      speaker: m.role === "coach" ? ("coach" as const) : ("user" as const),
      body: m.body,
      source_table: m.source_table,
      created_at: m.at,
      message_kind: m.message_kind,
      is_exact_body: m.is_exact_body,
      is_preview: m.delivery_status === "preview",
    }));

  const legacyText = recentExactThreadTextFrom72hMessages(recent_exact_thread_72h.messages);
  const thread_text_capped = legacyText.length > RECENT_EXACT_THREAD_TEXT_CAP;
  const recent_exact_thread_text = thread_text_capped
    ? `${legacyText.slice(0, RECENT_EXACT_THREAD_TEXT_CAP - 1)}…`
    : legacyText;

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
  let open_question_answered_at: string | null = null;
  if (projection?.open_question_answer_text?.trim() && projection.open_question_pending === false) {
    latest_answer_after_open_question = projection.open_question_answer_text.trim();
    answer_source = "projection";
    open_question_answered_at = projection.open_question_answered_at?.trim() ?? null;
  } else if (latest_answer_after_open_question_guess) {
    latest_answer_after_open_question = latest_answer_after_open_question_guess;
    answer_source = "runtime_guess";
  }

  const open_question_pending = projection
    ? projection.open_question_pending === true
    : Boolean(latest_open_question_guess && !latest_answer_after_open_question_guess);

  const open_question_expected_answer_type =
    projection?.open_question_expected_answer_type?.trim() ?? null;

  const relationship_memory_7d = buildRelationshipMemory7d({
    clerkUserId: args.clerkUserId,
    commitmentId: args.commitmentId ?? commitment?.id ?? "unknown",
    now,
    timezone: args.timezone,
    preloadedEvents: events,
    preloadedProjection: projection,
  });

  const commitmentIdFor30d = args.commitmentId ?? commitment?.id ?? "unknown";
  let victoryBackgroundFacts = null;
  if (args.commitmentId) {
    try {
      victoryBackgroundFacts = mapSmsVictoryBackgroundToFacts(
        await loadSmsVictoryBackgroundContext({
          clerkUserId: args.clerkUserId,
          commitmentId: args.commitmentId,
          timezone: args.timezone,
        })
      );
    } catch {
      victoryBackgroundFacts = null;
    }
  }

  const relationship_memory_30d = buildRelationshipMemory30d({
    commitmentId: commitmentIdFor30d,
    now,
    timezone: args.timezone,
    preloadedEvents30d: events30d,
    coachingMemory,
    victoryBackground: victoryBackgroundFacts,
    reactivationEnteredAt: commitment?.reactivation_entered_at ?? null,
    accountabilityPhase: commitment?.accountability_phase ?? coachingMemory?.accountability_phase ?? null,
  });

  const recent_coach_body_do_not_repeat = extractRecentCoachBodiesForAntiRepeat(recent_exact_thread_72h);

  return {
    clerk_user_id: args.clerkUserId,
    commitment_id: args.commitmentId ?? commitment?.id ?? null,
    behavior_statement: commitment?.behavior_statement?.trim() ?? null,
    effective_ask: effective_ask?.trim() ?? null,
    accountability_phase: commitment?.accountability_phase ?? coachingMemory?.accountability_phase ?? null,
    pending_resolution_summary,
    overlay_active: Boolean(commitment?.adaptive_proposal_text?.trim()),
    recent_outcomes_summary: recentOutcomesSummaryFromMemory7d(relationship_memory_7d),
    coaching_memory_summary,
    coaching_memory_is_background_only: true,
    relationship_profile_summary: relProfile,
    recent_exact_messages,
    recent_exact_thread_text,
    recent_exact_thread_72h,
    recent_coach_body_do_not_repeat,
    relationship_memory_7d,
    relationship_memory_30d,
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
    open_question_answered_at,
    open_question_pending,
    open_question_expected_answer_type,
    open_question_source,
    answer_source,
    do_not_repeat_phrases,
    relationship_anchor_sources,
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
      thread_build_telemetry: recent_exact_thread_72h.build_telemetry,
    },
  };
}

function parseIsoMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}
