/**
 * Temporal Truth v1 — server-owned calendar contract for SMS Relationship Packet / repair.
 */

import { getDateKeyInTimezone } from "@/lib/timezone";
import type { ThreadFreshnessFacts } from "@/lib/sms-thread-freshness";
import type { RelationshipMemory7dResult } from "@/lib/sms-relationship-memory-7d";
import type { RecentExactThread72hResult } from "@/lib/sms-recent-exact-thread-72h";
import type { PendingPlanProofFact } from "@/lib/pending-plan-proof";
import { looksLikeReportedCompletion } from "@/lib/pending-plan-proof";
import type { InboundTemporalScope } from "@/lib/inbound-relationship-meaning";

export const TEMPORAL_CONTRACT_VERSION = "temporal_contract_v1" as const;

export type TemporalRelativeLabel =
  | "today"
  | "yesterday"
  | "tomorrow"
  | "the_other_day"
  | "none";

export type TemporalReferencedEventV1 = {
  ref_id: string;
  event_type: "user_yes" | "user_no" | "user_partial" | "completion_in_thread" | "plan";
  local_day_key: string | null;
  allowed_relative_label: TemporalRelativeLabel;
  evidence_preview: string;
  occurred_at?: string;
  spoken_local_day_key?: string;
};

export type TemporalContractV1 = {
  version: typeof TEMPORAL_CONTRACT_VERSION;
  user_timezone: string;
  local_now_iso: string;
  today_key: string;
  yesterday_key: string;
  tomorrow_key: string;
  send_day_key: string;
  relative_day_rules: {
    today: string;
    yesterday: string;
    tomorrow: string;
    older_than_yesterday: string;
    unknown_date: string;
    user_said_today: string;
  };
  forbidden_relative_words: ("today" | "yesterday" | "tomorrow")[];
  referenced_events?: TemporalReferencedEventV1[];
};

const MS_DAY = 86400000;

const RELATIVE_DAY_RULES: TemporalContractV1["relative_day_rules"] = {
  today: "event.local_day_key === today_key",
  yesterday: "event.local_day_key === yesterday_key",
  tomorrow: "plan.local_day_key === tomorrow_key",
  older_than_yesterday:
    'use "the other day", "last time you checked in", or no relative date',
  unknown_date: "no today | yesterday | tomorrow",
  user_said_today: "spoken_local_day_key on the message — not send-day today",
};

export function getLocalDayKeyForTimestamp(timestamp: Date | string, timezone: string): string {
  const d = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  return getDateKeyInTimezone(d, timezone);
}

export function dayKeyOffset(dayKey: string, deltaDays: number): string {
  const [y, m, d] = dayKey.split("-").map((x) => parseInt(x, 10));
  const utc = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function allowedRelativeLabelForLocalDay(args: {
  eventLocalDayKey: string | null;
  todayKey: string;
  yesterdayKey: string;
  tomorrowKey: string;
}): TemporalRelativeLabel {
  const k = args.eventLocalDayKey?.trim();
  if (!k) return "none";
  if (k === args.todayKey) return "today";
  if (k === args.yesterdayKey) return "yesterday";
  if (k === args.tomorrowKey) return "tomorrow";
  return "the_other_day";
}

export function buildTemporalContractV1(args: {
  timezone: string;
  now: Date;
  sendDayKey: string;
  referencedEvents?: TemporalReferencedEventV1[];
}): TemporalContractV1 {
  const todayKey = getDateKeyInTimezone(args.now, args.timezone);
  const yesterdayKey = dayKeyOffset(todayKey, -1);
  const tomorrowKey = dayKeyOffset(todayKey, 1);
  const localNowIso = new Date(
    args.now.toLocaleString("en-US", { timeZone: args.timezone })
  ).toISOString();

  return {
    version: TEMPORAL_CONTRACT_VERSION,
    user_timezone: args.timezone,
    local_now_iso: localNowIso,
    today_key: todayKey,
    yesterday_key: yesterdayKey,
    tomorrow_key: tomorrowKey,
    send_day_key: args.sendDayKey,
    relative_day_rules: RELATIVE_DAY_RULES,
    forbidden_relative_words: ["today", "yesterday", "tomorrow"],
    referenced_events: args.referencedEvents?.length ? args.referencedEvents : undefined,
  };
}

export function slimTemporalContractForTelemetry(
  contract: TemporalContractV1
): Record<string, unknown> {
  return {
    temporal_contract_version: contract.version,
    user_timezone: contract.user_timezone,
    today_key: contract.today_key,
    yesterday_key: contract.yesterday_key,
    tomorrow_key: contract.tomorrow_key,
    send_day_key: contract.send_day_key,
    referenced_event_count: contract.referenced_events?.length ?? 0,
    referenced_event_labels: (contract.referenced_events ?? []).map((e) => ({
      ref_id: e.ref_id,
      local_day_key: e.local_day_key,
      allowed_relative_label: e.allowed_relative_label,
    })),
  };
}

export function buildTemporalContractPromptGuidance(): string {
  return `
TEMPORAL_CONTRACT (read current_turn.temporal_contract — authoritative for today/yesterday/tomorrow):
- Do not say today, yesterday, or tomorrow unless temporal_contract.referenced_events lists allowed_relative_label for the event you praise or reference.
- User's word "today" in an old message means that message's local_day_key / spoken_local_day_key — not send-day today.
- recent_exact_thread_72h.messages[].local_day_key beats summaries and coaching_memory_snippet for calendar truth.
- If allowed_relative_label is the_other_day or none, use "the other day," "last time you checked in," or omit relative date — never guess yesterday.
- If local_day_key is unknown, do not use today/yesterday/tomorrow.`;
}

export function buildTemporalWordingRepairInstruction(args: {
  contract: TemporalContractV1;
  violationReason: string;
  salientEvent?: TemporalReferencedEventV1 | null;
}): string {
  const label = args.salientEvent?.allowed_relative_label ?? "the_other_day";
  const day = args.salientEvent?.local_day_key ?? "unknown";
  return [
    "TEMPORAL_WORDING_REPAIR: Fix only relative date words (today/yesterday/tomorrow).",
    `Violation: ${args.violationReason}.`,
    `Send calendar: today=${args.contract.today_key}, yesterday=${args.contract.yesterday_key}.`,
    `Salient completion local_day_key=${day}; allowed_relative_label=${label}.`,
    'Prefer "the other day" or "last time you checked in" when label is the_other_day or none.',
    "Preserve route purpose, commitment ask, and one-SMS shape. Do not invent proof or Victory Room.",
  ].join(" ");
}

function truncatePreview(s: string, max = 120): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function buildReferencedEventsFromDailySources(args: {
  timezone: string;
  contract: Pick<TemporalContractV1, "today_key" | "yesterday_key" | "tomorrow_key">;
  threadFreshness?: ThreadFreshnessFacts | null;
  memory7d?: RelationshipMemory7dResult | null;
  recentThread72h?: RecentExactThread72hResult | null;
  pendingPlanProof?: PendingPlanProofFact | null;
}): TemporalReferencedEventV1[] {
  const events: TemporalReferencedEventV1[] = [];
  const keys = args.contract;

  const push = (e: TemporalReferencedEventV1) => {
    if (events.some((x) => x.ref_id === e.ref_id)) return;
    events.push(e);
  };

  const action = args.threadFreshness?.completed_actions?.[0];
  if (action?.local_day_key) {
    push({
      ref_id: "thread_freshness_latest_completion",
      event_type: "completion_in_thread",
      local_day_key: action.local_day_key,
      allowed_relative_label:
        action.allowed_relative_label ??
        allowedRelativeLabelForLocalDay({
          eventLocalDayKey: action.local_day_key,
          todayKey: keys.today_key,
          yesterdayKey: keys.yesterday_key,
          tomorrowKey: keys.tomorrow_key,
        }),
      evidence_preview: truncatePreview(action.evidence || action.text),
    });
  }

  const win = args.memory7d?.wins?.[0];
  if (win?.local_day_key) {
    push({
      ref_id: "memory_7d_latest_win",
      event_type: "user_yes",
      local_day_key: win.local_day_key,
      allowed_relative_label:
        win.allowed_relative_label ??
        allowedRelativeLabelForLocalDay({
          eventLocalDayKey: win.local_day_key,
          todayKey: keys.today_key,
          yesterdayKey: keys.yesterday_key,
          tomorrowKey: keys.tomorrow_key,
        }),
      evidence_preview: truncatePreview(win.evidence),
      occurred_at: win.at,
    });
  }

  const messages = args.recentThread72h?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    if (!looksLikeReportedCompletion(m.body)) continue;
    const localDay = m.local_day_key ?? getLocalDayKeyForTimestamp(m.at, args.timezone);
    push({
      ref_id: `thread_72h_user_completion_${i}`,
      event_type: "completion_in_thread",
      local_day_key: localDay,
      allowed_relative_label: allowedRelativeLabelForLocalDay({
        eventLocalDayKey: localDay,
        todayKey: keys.today_key,
        yesterdayKey: keys.yesterday_key,
        tomorrowKey: keys.tomorrow_key,
      }),
      evidence_preview: truncatePreview(m.body),
      occurred_at: m.at,
    });
    break;
  }

  if (args.pendingPlanProof?.active === true && args.pendingPlanProof.plan_for_day_key) {
    push({
      ref_id: "pending_plan_proof",
      event_type: "plan",
      local_day_key: args.pendingPlanProof.plan_for_day_key,
      allowed_relative_label: allowedRelativeLabelForLocalDay({
        eventLocalDayKey: args.pendingPlanProof.plan_for_day_key,
        todayKey: keys.today_key,
        yesterdayKey: keys.yesterday_key,
        tomorrowKey: keys.tomorrow_key,
      }),
      evidence_preview: truncatePreview(args.pendingPlanProof.plan_summary_hint),
    });
  }

  return events.slice(0, 6);
}

export function deriveInboundTemporalDayKeys(args: {
  temporalScope: InboundTemporalScope;
  receivedAt: Date;
  timezone: string;
}): {
  spoken_local_day_key: string | null;
  reported_for_day_key: string | null;
} {
  const receivedDay = getLocalDayKeyForTimestamp(args.receivedAt, args.timezone);
  switch (args.temporalScope) {
    case "today":
      return {
        spoken_local_day_key: receivedDay,
        reported_for_day_key: receivedDay,
      };
    case "yesterday":
      return {
        spoken_local_day_key: receivedDay,
        reported_for_day_key: dayKeyOffset(receivedDay, -1),
      };
    case "past":
      return {
        spoken_local_day_key: receivedDay,
        reported_for_day_key: null,
      };
    case "future":
      return {
        spoken_local_day_key: receivedDay,
        reported_for_day_key: dayKeyOffset(receivedDay, 1),
      };
    default:
      return {
        spoken_local_day_key: receivedDay,
        reported_for_day_key: null,
      };
  }
}

export function buildTemporalContractForInbound(args: {
  timezone: string;
  receivedAt: Date;
  inboundMeaning: {
    temporal_scope: InboundTemporalScope;
    spoken_local_day_key?: string | null;
    reported_for_day_key?: string | null;
    relationship_meaning?: string;
  };
  referencedEvents?: TemporalReferencedEventV1[];
}): TemporalContractV1 {
  const sendDay =
    args.inboundMeaning.reported_for_day_key ??
    args.inboundMeaning.spoken_local_day_key ??
    getLocalDayKeyForTimestamp(args.receivedAt, args.timezone);

  const events = args.referencedEvents ?? [];
  if (
    args.inboundMeaning.relationship_meaning === "reported_completion" &&
    args.inboundMeaning.reported_for_day_key &&
    !events.some((e) => e.ref_id === "inbound_reported_completion")
  ) {
    events.unshift({
      ref_id: "inbound_reported_completion",
      event_type: "completion_in_thread",
      local_day_key: args.inboundMeaning.reported_for_day_key,
      allowed_relative_label: allowedRelativeLabelForLocalDay({
        eventLocalDayKey: args.inboundMeaning.reported_for_day_key,
        todayKey: getLocalDayKeyForTimestamp(args.receivedAt, args.timezone),
        yesterdayKey: dayKeyOffset(getLocalDayKeyForTimestamp(args.receivedAt, args.timezone), -1),
        tomorrowKey: dayKeyOffset(getLocalDayKeyForTimestamp(args.receivedAt, args.timezone), 1),
      }),
      evidence_preview: "inbound reported completion",
      spoken_local_day_key: args.inboundMeaning.spoken_local_day_key ?? undefined,
    });
  }

  return buildTemporalContractV1({
    timezone: args.timezone,
    now: args.receivedAt,
    sendDayKey: sendDay,
    referencedEvents: events,
  });
}
