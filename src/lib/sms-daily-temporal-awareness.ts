/**
 * Compact day/time truth for daily outbound — existing facts only; no DB reads.
 */

import type { ProofAndPraisePermissionV2Data } from "@/lib/sms-proof-praise-permission-v2";
import type { RecentExactThread72hMessage } from "@/lib/sms-recent-exact-thread-72h";
import type { RelationshipMemory7dResult } from "@/lib/sms-relationship-memory-7d";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";

const MS_DAY = 24 * 60 * 60 * 1000;
const TIMELINE_MAX_TURNS = 10;
const TIMELINE_BODY_PREVIEW_MAX = 120;

export type DailyTemporalDayRelation =
  | "today"
  | "yesterday"
  | "2_days_ago"
  | "3_days_ago"
  | "earlier"
  | "unknown";

export type DailyCurrentDayOutcomeStatus =
  | "none_recorded"
  | "completed"
  | "missed"
  | "partial"
  | "unknown";

export type DailyTemporalAwarenessSummary = {
  user_timezone: string;
  local_date: string;
  local_weekday: string | null;
  local_time_iso?: string;
  accountability_day_key: string;
  is_new_accountability_day: boolean;
  current_day_outcome_status: DailyCurrentDayOutcomeStatus;
  can_imply_today_completed: boolean;
  can_imply_today_missed: boolean;
  can_imply_today_partial: boolean;
  last_outcome_type?: "user_yes" | "user_no" | "user_partial";
  last_outcome_day_relation?: DailyTemporalDayRelation;
  last_outcome_local_day_key?: string;
};

export type DailyRecentThreadTimelineEntry = {
  role: "coach" | "user";
  local_day_relation: DailyTemporalDayRelation;
  local_time: string;
  local_day_key: string;
  body_preview: string;
};

export function weekdayFromAccountabilityDayKey(dayKey: string): string | null {
  const parts = dayKey.split("-").map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[date.getUTCDay()] ?? null;
}

function dayKeyToUtcMs(dayKey: string): number | null {
  const parts = dayKey.split("-").map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!);
}

export function deriveLocalDayRelation(
  eventDayKey: string | null | undefined,
  accountabilityDayKey: string
): DailyTemporalDayRelation {
  const ev = eventDayKey?.trim();
  const today = accountabilityDayKey.trim();
  if (!ev || !today) return "unknown";
  if (ev === today) return "today";
  const evMs = dayKeyToUtcMs(ev);
  const todayMs = dayKeyToUtcMs(today);
  if (evMs == null || todayMs == null) return "unknown";
  const diffDays = Math.round((todayMs - evMs) / MS_DAY);
  if (diffDays === 1) return "yesterday";
  if (diffDays === 2) return "2_days_ago";
  if (diffDays === 3) return "3_days_ago";
  if (diffDays > 3) return "earlier";
  return "unknown";
}

function deriveDayRelationFromDaysSince(daysSince: number | null | undefined): DailyTemporalDayRelation {
  if (daysSince == null || !Number.isFinite(daysSince)) return "unknown";
  if (daysSince === 0) return "today";
  if (daysSince === 1) return "yesterday";
  if (daysSince === 2) return "2_days_ago";
  if (daysSince === 3) return "3_days_ago";
  if (daysSince > 3) return "earlier";
  return "unknown";
}

export function deriveIsNewAccountabilityDayFromThread(args: {
  accountabilityDayKey: string;
  messages: RecentExactThread72hMessage[] | undefined;
}): boolean {
  const today = args.accountabilityDayKey?.trim();
  if (!today) return true;
  const messages = args.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "coach" && m.delivery_status === "sent" && m.local_day_key?.trim()) {
      return m.local_day_key.trim() !== today;
    }
  }
  return true;
}

type DayScopedOutcomeClaims = {
  completion: boolean;
  miss: boolean;
  partial: boolean;
};

export function deriveDayScopedOutcomeClaimsFromMemory7d(args: {
  accountabilityDayKey: string;
  memory7d: RelationshipMemory7dResult | null | undefined;
}): DayScopedOutcomeClaims {
  const dayKey = args.accountabilityDayKey?.trim();
  if (!dayKey || !args.memory7d) {
    return { completion: false, miss: false, partial: false };
  }
  const mem = args.memory7d;
  return {
    completion: mem.wins?.[0]?.local_day_key?.trim() === dayKey,
    miss: mem.misses?.[0]?.local_day_key?.trim() === dayKey,
    partial: mem.partials?.[0]?.local_day_key?.trim() === dayKey,
  };
}

function resolveLastKnownOutcomeFromFacts(facts: DailyV3RelationshipFacts): {
  type: "user_yes" | "user_no" | "user_partial";
  local_day_key: string | null;
  at: string | null;
} | null {
  const mem = facts.thread_memory.relationship_memory_7d;
  type Candidate = {
    type: "user_yes" | "user_no" | "user_partial";
    local_day_key: string | null;
    at: string;
  };
  const candidates: Candidate[] = [];
  const win = mem?.wins?.[0];
  if (win?.at) {
    candidates.push({
      type: "user_yes",
      local_day_key: win.local_day_key?.trim() ?? null,
      at: win.at,
    });
  }
  const miss = mem?.misses?.[0];
  if (miss?.at) {
    candidates.push({
      type: "user_no",
      local_day_key: miss.local_day_key?.trim() ?? null,
      at: miss.at,
    });
  }
  const partial = mem?.partials?.[0];
  if (partial?.at) {
    candidates.push({
      type: "user_partial",
      local_day_key: partial.local_day_key?.trim() ?? null,
      at: partial.at,
    });
  }
  candidates.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0));
  if (candidates[0]) return candidates[0];

  const prior = facts.accountability.prior_outcome?.trim();
  if (prior === "user_yes" || prior === "user_no" || prior === "user_partial") {
    return { type: prior, local_day_key: null, at: null };
  }
  return null;
}

export function deriveDailyTemporalAwarenessSummary(args: {
  facts: DailyV3RelationshipFacts;
  proofPermission?: ProofAndPraisePermissionV2Data | null;
  isNewAccountabilityDay?: boolean;
}): DailyTemporalAwarenessSummary {
  const { facts } = args;
  const accountabilityDayKey = facts.accountability_day_key.trim();
  const memory7d = facts.thread_memory.relationship_memory_7d;
  const dayScoped =
    args.proofPermission != null
      ? {
          completion: args.proofPermission.can_claim_completion,
          miss: args.proofPermission.can_claim_miss,
          partial: args.proofPermission.can_claim_partial,
        }
      : deriveDayScopedOutcomeClaimsFromMemory7d({
          accountabilityDayKey,
          memory7d,
        });

  let current_day_outcome_status: DailyCurrentDayOutcomeStatus = "none_recorded";
  if (dayScoped.miss) current_day_outcome_status = "missed";
  else if (dayScoped.partial) current_day_outcome_status = "partial";
  else if (dayScoped.completion) current_day_outcome_status = "completed";
  else if (!memory7d && !facts.accountability.prior_outcome) {
    current_day_outcome_status = "none_recorded";
  }

  const lastOutcome = resolveLastKnownOutcomeFromFacts(facts);
  let last_outcome_day_relation: DailyTemporalDayRelation | undefined;
  let last_outcome_local_day_key: string | undefined;

  if (lastOutcome?.local_day_key) {
    last_outcome_local_day_key = lastOutcome.local_day_key;
    last_outcome_day_relation = deriveLocalDayRelation(lastOutcome.local_day_key, accountabilityDayKey);
  } else if (lastOutcome?.type) {
    last_outcome_day_relation = deriveDayRelationFromDaysSince(
      facts.accountability.days_since_last_user_outcome
    );
  }

  const isNewAccountabilityDay =
    args.isNewAccountabilityDay ??
    deriveIsNewAccountabilityDayFromThread({
      accountabilityDayKey,
      messages: facts.thread_memory.recent_exact_thread_72h?.messages,
    });

  return {
    user_timezone: facts.user.timezone,
    local_date: accountabilityDayKey,
    local_weekday: weekdayFromAccountabilityDayKey(accountabilityDayKey),
    ...(facts.user.local_time_iso?.trim()
      ? { local_time_iso: facts.user.local_time_iso.trim() }
      : {}),
    accountability_day_key: accountabilityDayKey,
    is_new_accountability_day: isNewAccountabilityDay,
    current_day_outcome_status,
    can_imply_today_completed: dayScoped.completion,
    can_imply_today_missed: dayScoped.miss,
    can_imply_today_partial: dayScoped.partial,
    ...(lastOutcome?.type ? { last_outcome_type: lastOutcome.type } : {}),
    ...(last_outcome_day_relation ? { last_outcome_day_relation } : {}),
    ...(last_outcome_local_day_key ? { last_outcome_local_day_key } : {}),
  };
}

function localTimeFromAtLocal(atLocal: string | undefined): string {
  const raw = atLocal?.trim() ?? "";
  const match = raw.match(/(\d{1,2}:\d{2})/);
  return match?.[1] ?? "";
}

export function buildRecentThreadTimelineSummary72h(args: {
  messages: RecentExactThread72hMessage[] | undefined;
  accountabilityDayKey: string;
  maxTurns?: number;
}): DailyRecentThreadTimelineEntry[] {
  const messages = args.messages ?? [];
  if (!messages.length) return [];

  const sorted = [...messages].sort((a, b) => {
    const ta = new Date(a.at).getTime();
    const tb = new Date(b.at).getTime();
    return ta - tb;
  });

  const maxTurns = args.maxTurns ?? TIMELINE_MAX_TURNS;
  const slice = sorted.slice(-maxTurns);

  return slice
    .filter((m) => m.role === "coach" || m.role === "user")
    .map((m) => {
      const body = m.body?.trim() ?? "";
      const preview =
        body.length <= TIMELINE_BODY_PREVIEW_MAX
          ? body
          : `${body.slice(0, TIMELINE_BODY_PREVIEW_MAX - 1)}…`;
      const localDayKey = m.local_day_key?.trim() || args.accountabilityDayKey;
      return {
        role: m.role as "coach" | "user",
        local_day_relation: deriveLocalDayRelation(localDayKey, args.accountabilityDayKey),
        local_time: localTimeFromAtLocal(m.at_local),
        local_day_key: localDayKey,
        body_preview: preview,
      };
    });
}

/** Current-day miss authority for daily C1 — day-scoped proof permission wins. */
export function dailyC1CanImplyTodayMissed(args: {
  proofPermission: ProofAndPraisePermissionV2Data;
}): boolean {
  return args.proofPermission.can_claim_miss === true;
}

export function dailyC1IsCurrentDayMiss(args: {
  facts: DailyV3RelationshipFacts;
  proofPermission: ProofAndPraisePermissionV2Data;
}): boolean {
  if (args.proofPermission.can_claim_miss) return true;
  const days = args.facts.accountability.days_since_last_user_outcome;
  const prior = args.facts.accountability.prior_outcome;
  return days === 0 && (prior === "user_no" || prior === "user_partial");
}

export function buildDailyTemporalAwarenessPromptGuidance(): string {
  return `
DAILY_TEMPORAL_AWARENESS (authoritative when present on current_turn or structured_recent_truth):
- Treat temporal_awareness_summary as authoritative for what day/time it is and what is recorded for today.
- Do not imply today already completed, missed, or partial unless can_imply_today_completed / can_imply_today_missed / can_imply_today_partial is true.
- Do not speak about yesterday, two days ago, or an earlier outcome/plan as if it happened today.
- When referencing a prior outcome or plan, use the correct day relation (yesterday, last time) when last_outcome_day_relation or recent_thread_timeline_summary_72h.local_day_relation is known.
- If current_day_outcome_status is none_recorded, frame today prospectively — not as already failed or done.
- recent_thread_timeline_summary_72h is a compact chronology helper; recent_exact_thread_72h remains authoritative on conflict.`;
}
