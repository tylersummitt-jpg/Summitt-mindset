/**
 * Inbound Hallway / Notebook packet — exact-thread truth for Sol interpreter + writer.
 * Does not call Morning TTO loaders (no draft_for_day_key / unsent drafts).
 */

import { createHash } from "node:crypto";
import { supabaseServer } from "@/lib/supabase-server";
import {
  buildRecentExactThread72h,
  capMorningExactThreadMessages,
  timestampFromInboundMessageRow,
  type MorningExactThreadMessage,
  type RecentExactThread72hMessage,
  MORNING_TTO_THREAD_WINDOW_DAYS,
  MORNING_TTO_THREAD_WINDOW_HOURS,
  MORNING_TTO_THREAD_MAX_MESSAGES,
} from "@/lib/sms-recent-exact-thread-72h";
import { getDateKeyInTimezone, resolveUserTimezone } from "@/lib/timezone";
import { weekdayLongFromLocalDayKey } from "@/lib/morning-tto-relationship-packet";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { type ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  getPendingResolutionOrNull,
  isPendingResolutionExpired,
  type V2SmsPendingResolutionPayload,
} from "@/lib/v2-guided-resolution";
import { isQuotableIdentitySource } from "@/lib/v2-identity-anchor-validation";
import { loadV2CommitmentSmsThreadMemory } from "@/lib/v2-commitment-sms-thread-memory";

export const INBOUND_RELATIONSHIP_PACKET_VERSION = "inbound_relationship_v1" as const;

export type InboundRelationshipPacket = {
  version: typeof INBOUND_RELATIONSHIP_PACKET_VERSION;
  message_for: {
    timezone: string;
    local_date: string;
    local_weekday: string;
    daypart: "inbound";
  };
  preferred_name: string | null;
  current_goal: {
    text: string;
  };
  current_identity: {
    text: string | null;
  };
  personal_context: Array<{
    type: string;
    value: string;
  }>;
  hard_state: {
    pending_goal_change: {
      candidate_text: string;
      status: "awaiting_user_confirmation";
    } | null;
    open_coach_question: {
      text: string;
      expected_answer_type: string | null;
      pending: boolean;
      asked_at: string | null;
    } | null;
  };
  latest_inbound_text: string;
  latest_inbound_message_sid: string;
  exact_thread: {
    window_days: 21;
    max_messages: 30;
    messages: MorningExactThreadMessage[];
    omitted_older_turn_count: number;
  };
};

const PERSONAL_CONTEXT_PROFILE_FIELDS = [
  "responsibility",
  "partner_name",
  "children_summary",
  "relationship_status",
  "work_challenge",
  "physical_state",
  "health_goal",
  "energy_obstacles",
  "pressure_summary",
  "proud_of",
  "best_self_trigger",
] as const;

const PERSONAL_CONTEXT_VALUE_MAX = 200;
const IMPORTANT_PEOPLE_MAX = 8;

const PROFILE_SELECT =
  "preferred_name, identity_anchor_text, identity_source, responsibility, partner_name, children_summary, relationship_status, work_challenge, physical_state, health_goal, energy_obstacles, pressure_summary, proud_of, best_self_trigger";

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

function capPersonalContextValue(value: string): string {
  const t = value.trim().replace(/\s+/g, " ");
  if (t.length <= PERSONAL_CONTEXT_VALUE_MAX) return t;
  return `${t.slice(0, PERSONAL_CONTEXT_VALUE_MAX - 1)}…`;
}

function normPersonKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildPersonalContext(args: {
  profile: Record<string, unknown> | null;
  importantPeople: Array<{ display_name: string; relationship_type: string }>;
}): Array<{ type: string; value: string }> {
  const out: Array<{ type: string; value: string }> = [];
  const seenPeople = new Set<string>();

  const partnerName = trimOrNull(args.profile?.partner_name);
  if (partnerName) {
    seenPeople.add(normPersonKey(partnerName));
  }

  for (const field of PERSONAL_CONTEXT_PROFILE_FIELDS) {
    const raw = trimOrNull(args.profile?.[field]);
    if (!raw) continue;
    out.push({ type: field, value: capPersonalContextValue(raw) });
  }

  let peopleAdded = 0;
  for (const person of args.importantPeople) {
    if (peopleAdded >= IMPORTANT_PEOPLE_MAX) break;
    const name = person.display_name.trim();
    if (!name) continue;
    const key = normPersonKey(name);
    if (seenPeople.has(key)) continue;
    seenPeople.add(key);
    const rel = person.relationship_type.trim();
    const value = rel ? `${name} (${rel})` : name;
    out.push({ type: "important_person", value: capPersonalContextValue(value) });
    peopleAdded += 1;
  }

  return out;
}

function pendingGoalChangeFromCommitment(
  commitment: ActiveV2CommitmentRow,
  nowMs: number
): InboundRelationshipPacket["hard_state"]["pending_goal_change"] {
  const pending = getPendingResolutionOrNull(commitment);
  if (!pending || isPendingResolutionExpired(commitment, nowMs)) return null;

  const payload = pending.payload;
  if (!payload || typeof payload !== "object") return null;

  const smsPayload = payload as V2SmsPendingResolutionPayload;
  if (smsPayload.sms_state !== "awaiting_confirmation") return null;

  const candidate = trimOrNull(smsPayload.candidate_behavior_statement);
  if (!candidate) return null;

  return {
    candidate_text: candidate,
    status: "awaiting_user_confirmation",
  };
}

function openCoachQuestionFromThreadMemory(
  memory: Awaited<ReturnType<typeof loadV2CommitmentSmsThreadMemory>>
): InboundRelationshipPacket["hard_state"]["open_coach_question"] {
  const text = memory?.open_question_text?.trim() ?? "";
  if (!text) return null;
  return {
    text,
    expected_answer_type: memory?.open_question_expected_answer_type?.trim() || null,
    pending: memory?.open_question_pending === true,
    asked_at: memory?.open_question_asked_at?.trim() || null,
  };
}

export function parseInboundReceivedAtDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value.trim());
    if (Number.isFinite(d.getTime())) return d;
  }
  return null;
}

/**
 * Receive clock for inbound Sol: job.created_at first, then inbound-message timestamps, then now.
 */
export async function resolveInboundReceivedAt(args: {
  receivedAt?: Date | string | null;
  messageSid: string;
  fallbackNow?: Date;
}): Promise<Date> {
  const fromArg = parseInboundReceivedAtDate(args.receivedAt);
  if (fromArg) return fromArg;

  const sid = args.messageSid.trim();
  if (sid) {
    const { data } = await supabaseServer
      .from("sms_inbound_messages")
      .select("received_at, created_at, updated_at, inserted_at, metadata")
      .eq("message_sid", sid)
      .maybeSingle();
    if (data && typeof data === "object") {
      const ms = timestampFromInboundMessageRow(data as Record<string, unknown>);
      if (Number.isFinite(ms) && ms > 0) return new Date(ms);
    }
  }

  const fallback = args.fallbackNow;
  if (fallback instanceof Date && Number.isFinite(fallback.getTime())) return fallback;
  return new Date();
}

/**
 * Drop the current coalesced turn's USER rows from exact thread by SID identity.
 * Do not drop prior identical text from another SID.
 */
export function exactThreadExcludingCurrentTurnSids<
  T extends { role?: string; sender?: string; message_sid?: string | null },
>(messages: T[], currentTurnMessageSids: string[]): T[] {
  const sids = new Set(
    currentTurnMessageSids.map((s) => s.trim()).filter((s) => s.length > 0)
  );
  if (sids.size === 0) return messages;
  return messages.filter((m) => {
    const isUser = m.role === "user" || m.sender === "user";
    if (!isUser) return true;
    const sid = typeof m.message_sid === "string" ? m.message_sid.trim() : "";
    if (!sid) return true;
    return !sids.has(sid);
  });
}

export function hashInboundRelationshipThread(
  messages: MorningExactThreadMessage[]
): string {
  const raw = messages
    .map((m) => `${m.sender}|${m.sent_at_utc}|${m.body}`)
    .join("\n");
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export function previewInboundText(text: string, max = 280): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return t.slice(0, max);
}

export function hashInboundText(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}

export async function loadInboundRelationshipPacket(args: {
  clerkUserId: string;
  timezone: string;
  commitment: ActiveV2CommitmentRow;
  latestInboundText: string;
  latestInboundMessageSid: string;
  /** Webhook enqueue time (job.created_at). Authoritative product day. */
  receivedAt?: Date | string | null;
  /** Current coalesced turn SIDs: split-suppressed + newest claimed job. */
  currentTurnMessageSids?: string[];
  /** Last-resort clock only when receivedAt and inbound-message timestamp are missing. */
  now?: Date;
}): Promise<
  | { ok: true; packet: InboundRelationshipPacket; receivedAt: Date }
  | { ok: false; error: string }
> {
  const latestInboundText = args.latestInboundText.trim();
  const latestInboundMessageSid = args.latestInboundMessageSid.trim();

  if (!args.commitment?.id) {
    return { ok: false, error: "no_active_commitment" };
  }
  if (!latestInboundText) {
    return { ok: false, error: "missing_latest_inbound_text" };
  }
  if (!latestInboundMessageSid) {
    return { ok: false, error: "missing_latest_inbound_message_sid" };
  }

  const receivedAt = await resolveInboundReceivedAt({
    receivedAt: args.receivedAt,
    messageSid: latestInboundMessageSid,
    fallbackNow: args.now,
  });
  const receivedAtMs = receivedAt.getTime();
  const tz = resolveUserTimezone(args.timezone);
  const local_date = getDateKeyInTimezone(receivedAt, tz);
  const currentTurnMessageSids = [
    ...(args.currentTurnMessageSids ?? []),
    latestInboundMessageSid,
  ];

  const goalText =
    getEffectiveCoachingAsk(args.commitment, receivedAtMs).trim() ||
    (typeof args.commitment.behavior_statement === "string"
      ? args.commitment.behavior_statement.trim()
      : "");

  const [{ data: profile }, { data: importantPeopleRows }, threadMemory, timeline] =
    await Promise.all([
      supabaseServer
        .from("user_profiles")
        .select(PROFILE_SELECT)
        .eq("clerk_user_id", args.clerkUserId)
        .maybeSingle(),
      supabaseServer
        .from("important_people")
        .select("display_name, relationship_type")
        .eq("clerk_user_id", args.clerkUserId)
        .eq("is_active", true)
        .is("removed_at", null),
      loadV2CommitmentSmsThreadMemory({ commitmentId: args.commitment.id }),
      buildRecentExactThread72h({
        clerkUserId: args.clerkUserId,
        commitmentId: args.commitment.id,
        timezone: tz,
        now: receivedAt,
        windowHours: MORNING_TTO_THREAD_WINDOW_HOURS,
        preserveUserBodyFormatting: true,
      }),
    ]);

  const identityRaw = trimOrNull(profile?.identity_anchor_text);
  const identitySource =
    typeof profile?.identity_source === "string" ? profile.identity_source.trim() : null;
  const identityText =
    identityRaw && isQuotableIdentitySource(identitySource) ? identityRaw : null;

  const importantPeople = Array.isArray(importantPeopleRows)
    ? importantPeopleRows.map((row) => ({
        display_name: typeof row.display_name === "string" ? row.display_name : "",
        relationship_type:
          typeof row.relationship_type === "string" ? row.relationship_type : "",
      }))
    : [];

  const threadWithoutCurrent = exactThreadExcludingCurrentTurnSids(
    timeline.messages as RecentExactThread72hMessage[],
    currentTurnMessageSids
  );
  const exactThread = capMorningExactThreadMessages(threadWithoutCurrent, {
    timezone: tz,
    nowMs: receivedAtMs,
    messageForLocalDate: local_date,
    options: { messageForLocalDate: local_date },
  });

  const packet: InboundRelationshipPacket = {
    version: INBOUND_RELATIONSHIP_PACKET_VERSION,
    message_for: {
      timezone: tz,
      local_date,
      local_weekday: weekdayLongFromLocalDayKey(local_date),
      daypart: "inbound",
    },
    preferred_name: trimOrNull(profile?.preferred_name),
    current_goal: { text: goalText || "(none)" },
    current_identity: { text: identityText },
    personal_context: buildPersonalContext({
      profile: (profile as Record<string, unknown> | null) ?? null,
      importantPeople,
    }),
    hard_state: {
      pending_goal_change: pendingGoalChangeFromCommitment(args.commitment, receivedAtMs),
      open_coach_question: openCoachQuestionFromThreadMemory(threadMemory),
    },
    latest_inbound_text: latestInboundText,
    latest_inbound_message_sid: latestInboundMessageSid,
    exact_thread: {
      window_days: MORNING_TTO_THREAD_WINDOW_DAYS,
      max_messages: MORNING_TTO_THREAD_MAX_MESSAGES,
      messages: exactThread.messages,
      omitted_older_turn_count: exactThread.omitted_older_turn_count,
    },
  };

  return { ok: true, packet, receivedAt };
}
