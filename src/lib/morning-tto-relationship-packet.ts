/**
 * Morning TTO relationship packet — six sources for the one-shot Morning writer.
 */

import { supabaseServer } from "@/lib/supabase-server";
import { fetchLastAnyUserReplyAt } from "@/lib/sms-last-any-user-reply";
import {
  buildMorningExactThreadForPacket,
  formatAtLocal,
  type AnsweredUserMessageLink,
} from "@/lib/sms-recent-exact-thread-72h";
import { requireTylerTextOverviewDraftDayKey } from "@/lib/tyler-text-overview-draft-day-key";
import { getDateKeyInTimezone, resolveUserTimezone } from "@/lib/timezone";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import { wholeCalendarDaysBetweenDayKeys } from "@/lib/v2-cadence";
import { getActiveCommitment, type ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import {
  getPendingResolutionOrNull,
  isPendingResolutionExpired,
  type V2SmsPendingResolutionPayload,
} from "@/lib/v2-guided-resolution";
import { isQuotableIdentitySource } from "@/lib/v2-identity-anchor-validation";
import {
  mergeHistoricalEvidenceChronologically,
  type HistoricalEvidenceSlice,
} from "@/lib/historical-evidence";
import {
  fetchActiveDurableUserEvidenceRows,
  projectDurableUserEvidenceCarriers,
} from "@/lib/durable-user-evidence-load";
import {
  fetchHistoricalWinEvidenceSource,
  projectHistoricalWinEvidenceCarriers,
} from "@/lib/historical-win-evidence-load";

/** Intended SMS daypart for shared Sol coaching (Morning wrappers always pass "morning"). */
export type TtoMessageDaypart = "morning" | "evening";

export type MorningRelationshipPacket = {
  version: "morning_relationship_v1";
  /** Authoritative calendar day/daypart this SMS is for (draft_for_day_key). */
  message_for: {
    timezone: string;
    local_date: string;
    local_weekday: string;
    daypart: TtoMessageDaypart;
  };
  last_user_response: {
    at_utc: string | null;
    at_local: string | null;
    days_since: number | null;
    never_replied: boolean;
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
  };
  /**
   * Dated historical evidence (then, not now). Not current state.
   * Live conversation is exact_thread.
   * User-message evidence + bounded Win candidates. One array.
   */
  historical_evidence: HistoricalEvidenceSlice;
  exact_thread: {
    window_days: 21;
    max_messages: 30;
    messages: Array<{
      sender: "coach" | "user";
      sent_at_utc: string;
      sent_at_local: string;
      local_day_key: string;
      local_weekday: string;
      day_relation_to_message: string;
      body: string;
    }>;
    /** Writer-facing turns in-window removed by 30-turn and/or 12k budget caps. */
    omitted_older_turn_count: number;
  };
  /**
   * Deterministic USER inbound → Coach outbound pairings from sent inbound coach jobs.
   * Not inferred from exact_thread wording, adjacency, or timestamps.
   */
  answered_user_message_links: AnsweredUserMessageLink[];
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

/** Long English weekday for a YYYY-MM-DD local day key (calendar date, not generation clock). */
export function weekdayLongFromLocalDayKey(dayKey: string): string {
  const parts = dayKey.trim().split("-").map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return "Monday";
  }
  const [y, m, d] = parts;
  const date = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
}

export function buildMorningMessageFor(args: {
  timezone: string;
  draftForDayKey: string;
  /** Defaults to morning — Evening wrappers pass "evening". */
  daypart?: TtoMessageDaypart;
}): MorningRelationshipPacket["message_for"] {
  const local_date = args.draftForDayKey.trim();
  return {
    timezone: resolveUserTimezone(args.timezone),
    local_date,
    local_weekday: weekdayLongFromLocalDayKey(local_date),
    daypart: args.daypart ?? "morning",
  };
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
): MorningRelationshipPacket["hard_state"]["pending_goal_change"] {
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

export async function loadMorningRelationshipPacket(args: {
  clerkUserId: string;
  timezone: string;
  now?: Date;
  /** Accountability / send day for this draft — required; never inferred from local hour. */
  draftForDayKey: string;
  commitmentId?: string | null;
  /** Defaults to morning — Evening wrappers pass "evening". */
  daypart?: TtoMessageDaypart;
}): Promise<
  | { ok: true; packet: MorningRelationshipPacket; commitmentId: string }
  | { ok: false; error: string }
> {
  const now = args.now ?? new Date();
  const nowMs = now.getTime();
  const tz = resolveUserTimezone(args.timezone);

  let draftForDayKey: string;
  try {
    draftForDayKey = requireTylerTextOverviewDraftDayKey(args.draftForDayKey);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "invalid_draft_for_day_key",
    };
  }

  const message_for = buildMorningMessageFor({
    timezone: tz,
    draftForDayKey,
    daypart: args.daypart ?? "morning",
  });

  let commitment: ActiveV2CommitmentRow | null = null;
  if (args.commitmentId) {
    const { data } = await supabaseServer
      .from("v2_commitment")
      .select("*")
      .eq("id", args.commitmentId)
      .maybeSingle();
    if (data) commitment = data as ActiveV2CommitmentRow;
  } else {
    commitment = await getActiveCommitment(args.clerkUserId);
  }

  if (!commitment?.id) {
    return { ok: false, error: "no_active_commitment" };
  }

  const goalText = getEffectiveCoachingAsk(commitment, nowMs).trim();
  if (!goalText) {
    return { ok: false, error: "missing_current_goal" };
  }

  const [
    { data: profile },
    { data: importantPeopleRows },
    lastReplyAt,
    exactThread,
    evidenceRows,
    winSource,
  ] = await Promise.all([
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
      fetchLastAnyUserReplyAt(args.clerkUserId),
      buildMorningExactThreadForPacket({
        clerkUserId: args.clerkUserId,
        commitmentId: commitment.id,
        timezone: tz,
        messageForLocalDate: message_for.local_date,
        now,
      }),
      fetchActiveDurableUserEvidenceRows(args.clerkUserId),
      fetchHistoricalWinEvidenceSource(args.clerkUserId),
    ]);

  const identityRaw = trimOrNull(profile?.identity_anchor_text);
  const identitySource =
    typeof profile?.identity_source === "string" ? profile.identity_source.trim() : null;
  const identityText =
    identityRaw && isQuotableIdentitySource(identitySource) ? identityRaw : null;

  const importantPeople: Array<{ display_name: string; relationship_type: string }> = [];
  for (const row of importantPeopleRows ?? []) {
    const display_name = typeof row.display_name === "string" ? row.display_name.trim() : "";
    const relationship_type =
      typeof row.relationship_type === "string" ? row.relationship_type.trim() : "";
    if (!display_name) continue;
    importantPeople.push({ display_name, relationship_type });
  }

  let atLocal: string | null = null;
  let daysSince: number | null = null;
  if (lastReplyAt) {
    const replyDate = new Date(lastReplyAt);
    atLocal = formatAtLocal(replyDate, tz);
    const replyDayKey = getDateKeyInTimezone(replyDate, tz);
    // Relative to the Morning message day (not generation clock).
    daysSince = wholeCalendarDaysBetweenDayKeys(replyDayKey, message_for.local_date);
  }

  const packet: MorningRelationshipPacket = {
    version: "morning_relationship_v1",
    message_for,
    last_user_response: {
      at_utc: lastReplyAt,
      at_local: atLocal,
      days_since: daysSince,
      never_replied: lastReplyAt == null,
    },
    preferred_name: trimOrNull(profile?.preferred_name),
    current_goal: { text: goalText },
    current_identity: { text: identityText },
    personal_context: buildPersonalContext({
      profile: (profile as Record<string, unknown> | null) ?? null,
      importantPeople,
    }),
    hard_state: {
      pending_goal_change: pendingGoalChangeFromCommitment(commitment, nowMs),
    },
    historical_evidence: mergeHistoricalEvidenceChronologically(
      projectDurableUserEvidenceCarriers({
        rows: evidenceRows,
        timezone: tz,
        survivingExactThreadMessageSids: exactThread.surviving_message_sids,
      }),
      projectHistoricalWinEvidenceCarriers({
        currentChapter: {
          id: commitment.id,
          behavior_statement: commitment.behavior_statement,
        },
        priorChapters: winSource.priors,
        wins: winSource.wins,
        timezone: tz,
        survivingExactThreadMessageSids: exactThread.surviving_message_sids,
      })
    ),
    exact_thread: {
      window_days: exactThread.window_days,
      max_messages: exactThread.max_messages,
      messages: exactThread.messages,
      omitted_older_turn_count: exactThread.omitted_older_turn_count,
    },
    answered_user_message_links: exactThread.answered_user_message_links,
  };

  return { ok: true, packet, commitmentId: commitment.id };
}
