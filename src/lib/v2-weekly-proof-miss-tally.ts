/**
 * Weekly user_no miss-day dedupe — no DB imports (safe for unit tests).
 */

import {
  looksLikeCoachContextCorrectionOrMetaDispute,
} from "@/lib/inbound-short-answer-clauses";
import { getDateKeyInTimezone } from "@/lib/timezone";

export type WeeklyUserNoRow = {
  occurred_at: string;
  payload_json?: Record<string, unknown> | null;
};

export type WeeklyUserNoDayTally = {
  raw_user_no_count: number;
  distinct_user_no_day_count: number;
  false_or_suspect_user_no_count: number;
  unknown_day_user_no_count: number;
  exact_miss_day_count_reliable: boolean;
};

function payloadStringField(pj: Record<string, unknown> | null, key: string): string | null {
  const v = pj?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function nestedPayloadDayKey(pj: Record<string, unknown> | null, path: string[]): string | null {
  let cur: unknown = pj;
  for (const seg of path) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  if (typeof cur !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(cur.trim())) return null;
  return cur.trim();
}

export function extractInboundBodyFromUserNoPayload(
  pj: Record<string, unknown> | null
): string {
  if (!pj) return "";
  return (
    payloadStringField(pj, "message") ??
    payloadStringField(pj, "raw_body_preview") ??
    payloadStringField(pj, "inbound_body_preview") ??
    payloadStringField(pj, "consent_inbound_body_preview") ??
    ""
  );
}

function payloadEvidenceStrings(pj: Record<string, unknown> | null): string[] {
  if (!pj) return [];
  const out: string[] = [];
  const direct = pj.evidence;
  if (Array.isArray(direct)) {
    for (const e of direct) {
      if (typeof e === "string" && e.trim()) out.push(e.trim());
    }
  }
  for (const path of [
    ["inbound_meaning_facts", "evidence"],
    ["meaning_facts", "evidence"],
  ] as const) {
    const nested = pj[path[0]];
    if (nested && typeof nested === "object" && Array.isArray((nested as Record<string, unknown>).evidence)) {
      for (const e of (nested as Record<string, unknown>).evidence as unknown[]) {
        if (typeof e === "string" && e.trim()) out.push(e.trim());
      }
    }
  }
  return out;
}

export function isSuspectFalseUserNoPayload(pj: Record<string, unknown> | null): boolean {
  const body = extractInboundBodyFromUserNoPayload(pj);
  if (body && looksLikeCoachContextCorrectionOrMetaDispute(body)) return true;
  return payloadEvidenceStrings(pj).some(
    (e) =>
      e.includes("coach_context_correction_not_miss") ||
      e.includes("onboarding_process_dispute_not_miss") ||
      e.includes("coach_process_dispute_not_miss")
  );
}

export function deriveUserNoLocalDayKey(
  pj: Record<string, unknown> | null,
  occurredAt: string,
  timezone: string
): { dayKey: string | null; fromPayload: boolean } {
  const fromPayload =
    payloadStringField(pj, "spoken_local_day_key") ??
    payloadStringField(pj, "reported_for_day_key") ??
    payloadStringField(pj, "local_day_key") ??
    nestedPayloadDayKey(pj, ["meaning_facts", "spoken_local_day_key"]) ??
    nestedPayloadDayKey(pj, ["meaning_facts", "reported_for_day_key"]) ??
    nestedPayloadDayKey(pj, ["meaning_facts", "local_day_key"]) ??
    nestedPayloadDayKey(pj, ["inbound_meaning_facts", "spoken_local_day_key"]) ??
    nestedPayloadDayKey(pj, ["inbound_meaning_facts", "reported_for_day_key"]) ??
    nestedPayloadDayKey(pj, ["inbound_meaning_facts", "local_day_key"]);
  if (fromPayload) return { dayKey: fromPayload, fromPayload: true };
  const parsed = new Date(occurredAt);
  if (Number.isNaN(parsed.getTime())) return { dayKey: null, fromPayload: false };
  return { dayKey: getDateKeyInTimezone(parsed, timezone), fromPayload: false };
}

export function tallyWeeklyUserNoDays(args: {
  rows: WeeklyUserNoRow[];
  timezone: string;
}): WeeklyUserNoDayTally {
  const distinctDays = new Set<string>();
  let raw = 0;
  let suspect = 0;
  let unknown = 0;

  for (const row of args.rows) {
    raw += 1;
    const pj = row.payload_json ?? null;
    if (isSuspectFalseUserNoPayload(pj)) {
      suspect += 1;
      continue;
    }
    const { dayKey } = deriveUserNoLocalDayKey(pj, row.occurred_at, args.timezone);
    if (!dayKey) {
      unknown += 1;
      continue;
    }
    distinctDays.add(dayKey);
  }

  return {
    raw_user_no_count: raw,
    distinct_user_no_day_count: distinctDays.size,
    false_or_suspect_user_no_count: suspect,
    unknown_day_user_no_count: unknown,
    exact_miss_day_count_reliable: suspect === 0 && unknown === 0,
  };
}
