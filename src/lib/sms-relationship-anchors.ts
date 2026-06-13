/**
 * Relationship + schedule anchors for Relationship Packet / Snapshot v1.
 * Read-only context projection — no routing, send, or persistence changes.
 */

import { createHash } from "node:crypto";
import type { ImportantPeopleRelationshipType } from "@/lib/onboarding-people-summary";
import { buildPeopleSummaryMirror } from "@/lib/onboarding-people-summary";
import type { TimingAnchorMemory } from "@/lib/timing-anchor-memory";
import type { ThreadFreshnessFacts } from "@/lib/sms-thread-freshness";
import { getDateKeyInTimezone } from "@/lib/timezone";

export const MAX_RELATIONSHIP_ANCHORS = 3;
export const RELATIONSHIP_ANCHOR_COOLDOWN_DAYS = 10;

export type RelationshipAnchorSource = "onboarding" | "sms_confirmed" | "thread_derived";
export type RelationshipAnchorConfidence = "user_provided" | "user_confirmed" | "mentioned_once";

export type RelationshipAnchor = {
  anchor_key: string;
  display_label: string;
  relationship_type: ImportantPeopleRelationshipType;
  source: RelationshipAnchorSource;
  context_hint?: string;
  last_user_update_at?: string;
  last_coach_referenced_at?: string;
  confidence: RelationshipAnchorConfidence;
};

export type ScheduleAnchorSource = "timing_anchor_memory" | "thread_freshness" | "sms_confirmed";
export type ScheduleAnchorConfidence = "user_confirmed" | "mentioned_once" | "derived";

export type ScheduleAnchor = {
  anchor_key: string;
  anchor_phrase_hint: string;
  source: ScheduleAnchorSource;
  last_seen_day_key?: string;
  confidence: ScheduleAnchorConfidence;
  use_guidance: "use only if relevant to today's planning";
};

export type ImportantPersonRow = {
  display_name: string;
  relationship_type: ImportantPeopleRelationshipType;
  source?: string | null;
};

export type RelationshipAnchorSources = {
  important_people: ImportantPersonRow[];
  people_summary: string | null;
  people_summary_updated_at?: string | null;
};

export type RelationshipAnchorsBuildResult = {
  relationship_anchors: RelationshipAnchor[];
  schedule_anchors: ScheduleAnchor[];
  relationship_anchor_recently_used_keys: string[];
  telemetry: RelationshipAnchorTelemetryCounts;
};

export type RelationshipAnchorTelemetryCounts = {
  relationship_anchor_available_count: number;
  schedule_anchor_available_count: number;
  relationship_anchor_recently_used_count: number;
  relationship_anchor_source_onboarding_count: number;
  relationship_anchor_source_sms_confirmed_count: number;
  strategy_card_relationship_anchor_boundary_present: boolean;
};

export const RELATIONSHIP_ANCHOR_OPTIONAL_MUST_DO =
  "If naturally relevant to today's coaching move, you may use one user-provided relationship or schedule anchor to make the coaching specific; do not force it.";

export const RELATIONSHIP_ANCHOR_MUST_NOT_DO_LINES = [
  "Do not invent family updates, schedule facts, or relationship details.",
  "Do not use loved ones for guilt, shame, or pressure; do not ask about the same person repeatedly.",
  "Do not open with standalone chit-chat about a person unless it bridges directly to the goal.",
  "Do not mention a personal anchor if it is unrelated to the current move.",
] as const;

const COUNT_MIRROR_RE = /^Showing up for /i;
const SEASONAL_HINT_RE =
  /\b(summer break|winter break|spring break|on break|school break|holiday break|vacation)\b/i;
const SUMMER_RE = /\bsummer\b/i;

export function stableRelationshipAnchorKey(
  displayLabel: string,
  relationshipType: string
): string {
  const raw = `${relationshipType}:${displayLabel.trim().toLowerCase()}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export function stableScheduleAnchorKey(phrase: string): string {
  const raw = phrase.trim().toLowerCase().slice(0, 120);
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

function isCountOnlyPeopleSummary(summary: string | null | undefined): boolean {
  if (!summary?.trim()) return true;
  return COUNT_MIRROR_RE.test(summary.trim());
}

function monthFromDayKey(dayKey: string): number | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(dayKey.trim());
  if (!m) return null;
  return Number(m[2]);
}

export function isStaleTemporaryContextHint(args: {
  contextHint: string;
  lastUserUpdateAt?: string | null;
  todayDayKey: string;
  nowMs?: number;
}): boolean {
  const hint = args.contextHint.trim();
  if (!hint) return true;

  const nowMs = args.nowMs ?? Date.now();
  if (args.lastUserUpdateAt) {
    const updatedMs = Date.parse(args.lastUserUpdateAt);
    if (Number.isFinite(updatedMs) && nowMs - updatedMs > 90 * 24 * 60 * 60 * 1000) {
      return true;
    }
  }

  if (!SEASONAL_HINT_RE.test(hint) && !SUMMER_RE.test(hint)) {
    return false;
  }

  const month = monthFromDayKey(args.todayDayKey);
  if (month == null) return false;

  if (SUMMER_RE.test(hint) || /\bsummer break\b/i.test(hint)) {
    return month < 5 || month > 9;
  }

  return false;
}

function resolveContextHintForPerson(args: {
  displayLabel: string;
  peopleSummary: string | null;
  peopleSummaryUpdatedAt?: string | null;
  todayDayKey: string;
  nowMs?: number;
}): { hint?: string; lastUserUpdateAt?: string; source: RelationshipAnchorSource } | null {
  const summary = args.peopleSummary?.trim() ?? "";
  if (!summary || isCountOnlyPeopleSummary(summary)) return null;

  const label = args.displayLabel.trim();
  if (!label) return null;

  const labelRe = new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  if (!labelRe.test(summary)) return null;

  const hint = summary.slice(0, 160);
  if (
    isStaleTemporaryContextHint({
      contextHint: hint,
      lastUserUpdateAt: args.peopleSummaryUpdatedAt,
      todayDayKey: args.todayDayKey,
      nowMs: args.nowMs,
    })
  ) {
    return null;
  }

  return {
    hint,
    lastUserUpdateAt: args.peopleSummaryUpdatedAt ?? undefined,
    source: "sms_confirmed",
  };
}

function mapPersonSource(raw: string | null | undefined): RelationshipAnchorSource {
  if (raw === "sms" || raw === "edit") return "sms_confirmed";
  return "onboarding";
}

function mapPersonConfidence(source: RelationshipAnchorSource): RelationshipAnchorConfidence {
  return source === "sms_confirmed" ? "user_confirmed" : "user_provided";
}

function coachBodiesForRecentUseScan(args: {
  lastCoachMessages?: string[];
  recentCoachThreadBodies?: string[];
}): string[] {
  const out: string[] = [];
  for (const m of args.lastCoachMessages ?? []) {
    if (m?.trim()) out.push(m.trim());
  }
  for (const m of args.recentCoachThreadBodies ?? []) {
    if (m?.trim()) out.push(m.trim());
  }
  return out;
}

export function detectRecentlyUsedRelationshipAnchorKeys(args: {
  anchors: RelationshipAnchor[];
  coachBodies: string[];
}): string[] {
  const recentlyUsed: string[] = [];

  for (const anchor of args.anchors) {
    const label = anchor.display_label.trim();
    if (!label) continue;
    const labelRe = new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");

    if (args.coachBodies.some((body) => labelRe.test(body))) {
      recentlyUsed.push(anchor.anchor_key);
    }
  }

  return [...new Set(recentlyUsed)];
}

export function relationshipAnchorAvoidRepeatingFingerprints(
  recentlyUsedKeys: string[]
): string[] {
  return recentlyUsedKeys.map((k) => `relationship_anchor_recently_used:${k}`);
}

export function buildRelationshipAnchors(args: {
  sources: RelationshipAnchorSources | null | undefined;
  timezone: string;
  now?: Date;
  lastCoachMessages?: string[];
  recentCoachThreadBodies?: string[];
}): RelationshipAnchor[] {
  const people = args.sources?.important_people ?? [];
  if (!people.length) return [];

  const now = args.now ?? new Date();
  const todayDayKey = getDateKeyInTimezone(now, args.timezone);
  const coachBodies = coachBodiesForRecentUseScan({
    lastCoachMessages: args.lastCoachMessages,
    recentCoachThreadBodies: args.recentCoachThreadBodies,
  });

  const candidates: Array<RelationshipAnchor & { sortRank: number }> = [];

  for (const person of people) {
    const displayLabel = person.display_name?.trim();
    if (!displayLabel || displayLabel.length > 40) continue;

    const source = mapPersonSource(person.source);
    const confirmed = resolveContextHintForPerson({
      displayLabel,
      peopleSummary: args.sources?.people_summary ?? null,
      peopleSummaryUpdatedAt: args.sources?.people_summary_updated_at,
      todayDayKey,
      nowMs: now.getTime(),
    });

    const effectiveSource = confirmed?.source ?? source;
    const anchor: RelationshipAnchor & { sortRank: number } = {
      anchor_key: stableRelationshipAnchorKey(displayLabel, person.relationship_type),
      display_label: displayLabel,
      relationship_type: person.relationship_type,
      source: effectiveSource,
      confidence: confirmed ? "user_confirmed" : mapPersonConfidence(source),
      sortRank: confirmed ? 0 : source === "onboarding" ? 1 : 2,
      ...(confirmed?.hint ? { context_hint: confirmed.hint } : {}),
      ...(confirmed?.lastUserUpdateAt ? { last_user_update_at: confirmed.lastUserUpdateAt } : {}),
    };

    for (const body of coachBodies) {
      const labelRe = new RegExp(
        `\\b${displayLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i"
      );
      if (labelRe.test(body)) {
        anchor.last_coach_referenced_at = now.toISOString();
        break;
      }
    }

    candidates.push(anchor);
  }

  candidates.sort((a, b) => a.sortRank - b.sortRank || a.display_label.localeCompare(b.display_label));

  return candidates.slice(0, MAX_RELATIONSHIP_ANCHORS).map(({ sortRank: _sortRank, ...rest }) => rest);
}

export function buildScheduleAnchors(args: {
  timingAnchorMemory?: TimingAnchorMemory | null;
  threadFreshness?: ThreadFreshnessFacts | null;
  timezone: string;
  now?: Date;
}): ScheduleAnchor[] {
  const now = args.now ?? new Date();
  const todayDayKey = getDateKeyInTimezone(now, args.timezone);
  const anchors: ScheduleAnchor[] = [];

  const timing = args.timingAnchorMemory;
  if (timing?.active && timing.anchor_phrase_hint?.trim()) {
    const phrase = timing.anchor_phrase_hint.trim().slice(0, 160);
    anchors.push({
      anchor_key: stableScheduleAnchorKey(phrase),
      anchor_phrase_hint: phrase,
      source: "timing_anchor_memory",
      last_seen_day_key: timing.last_seen_day_key ?? todayDayKey,
      confidence:
        timing.confidence_level === "user_confirmed" || timing.user_confirmed
          ? "user_confirmed"
          : timing.confidence_level === "mentioned_once"
            ? "mentioned_once"
            : "derived",
      use_guidance: "use only if relevant to today's planning",
    });
  }

  const plan = args.threadFreshness?.recent_user_plan_or_schedule?.trim();
  if (plan && anchors.length < 2) {
    anchors.push({
      anchor_key: stableScheduleAnchorKey(plan),
      anchor_phrase_hint: plan.slice(0, 160),
      source: "thread_freshness",
      last_seen_day_key: todayDayKey,
      confidence: "mentioned_once",
      use_guidance: "use only if relevant to today's planning",
    });
  }

  return anchors.slice(0, 2);
}

export function buildRelationshipAndScheduleAnchors(
  args: Parameters<typeof buildRelationshipAnchors>[0] &
    Pick<Parameters<typeof buildScheduleAnchors>[0], "timingAnchorMemory" | "threadFreshness">
): RelationshipAnchorsBuildResult {
  const relationship_anchors = buildRelationshipAnchors(args);
  const schedule_anchors = buildScheduleAnchors({
    timingAnchorMemory: args.timingAnchorMemory,
    threadFreshness: args.threadFreshness,
    timezone: args.timezone,
    now: args.now,
  });

  const coachBodies = coachBodiesForRecentUseScan({
    lastCoachMessages: args.lastCoachMessages,
    recentCoachThreadBodies: args.recentCoachThreadBodies,
  });
  const relationship_anchor_recently_used_keys = detectRecentlyUsedRelationshipAnchorKeys({
    anchors: relationship_anchors,
    coachBodies,
  });

  const telemetry: RelationshipAnchorTelemetryCounts = {
    relationship_anchor_available_count: relationship_anchors.length,
    schedule_anchor_available_count: schedule_anchors.length,
    relationship_anchor_recently_used_count: relationship_anchor_recently_used_keys.length,
    relationship_anchor_source_onboarding_count: relationship_anchors.filter(
      (a) => a.source === "onboarding"
    ).length,
    relationship_anchor_source_sms_confirmed_count: relationship_anchors.filter(
      (a) => a.source === "sms_confirmed"
    ).length,
    strategy_card_relationship_anchor_boundary_present:
      relationship_anchors.length > 0 || schedule_anchors.length > 0,
  };

  return {
    relationship_anchors,
    schedule_anchors,
    relationship_anchor_recently_used_keys,
    telemetry,
  };
}

export function relationshipAnchorSourcesFromProfileAndPeople(args: {
  importantPeople: ImportantPersonRow[];
  peopleSummary?: string | null;
  peopleSummaryUpdatedAt?: string | null;
}): RelationshipAnchorSources {
  return {
    important_people: args.importantPeople,
    people_summary: args.peopleSummary?.trim() || null,
    people_summary_updated_at: args.peopleSummaryUpdatedAt ?? null,
  };
}

/** True when people_summary is only the count mirror derived from important_people. */
export function isDerivedCountPeopleSummary(
  peopleSummary: string | null | undefined,
  importantPeople: ImportantPersonRow[]
): boolean {
  const mirror = buildPeopleSummaryMirror(importantPeople);
  const summary = peopleSummary?.trim() ?? "";
  if (!summary) return true;
  if (mirror && summary === mirror) return true;
  return isCountOnlyPeopleSummary(summary);
}

export function applyRelationshipAnchorStrategyBoundaries(args: {
  must_do: string[];
  must_not_do: string[];
  avoid_repeating: string[];
  relationshipAnchorCount: number;
  scheduleAnchorCount: number;
  recentlyUsedAnchorKeys: string[];
  maxMustDo?: number;
  maxMustNotDo?: number;
  maxAvoidRepeating?: number;
}): void {
  const hasAnchors = args.relationshipAnchorCount > 0 || args.scheduleAnchorCount > 0;
  if (!hasAnchors) return;

  const maxMustDo = args.maxMustDo ?? 5;
  const maxMustNotDo = args.maxMustNotDo ?? 8;
  const maxAvoid = args.maxAvoidRepeating ?? 10;

  if (
    !args.must_do.includes(RELATIONSHIP_ANCHOR_OPTIONAL_MUST_DO) &&
    args.must_do.length < maxMustDo
  ) {
    args.must_do.push(RELATIONSHIP_ANCHOR_OPTIONAL_MUST_DO);
  }

  for (const line of RELATIONSHIP_ANCHOR_MUST_NOT_DO_LINES) {
    if (args.must_not_do.length >= maxMustNotDo) break;
    if (!args.must_not_do.includes(line)) {
      args.must_not_do.push(line);
    }
  }

  for (const fp of relationshipAnchorAvoidRepeatingFingerprints(args.recentlyUsedAnchorKeys)) {
    if (args.avoid_repeating.length >= maxAvoid) break;
    if (!args.avoid_repeating.some((a) => a.toLowerCase() === fp.toLowerCase())) {
      args.avoid_repeating.push(fp);
    }
  }
}

export function buildRelationshipAnchorsPromptGuidance(): string {
  return `
RELATIONSHIP_ANCHORS (optional user-provided context — not commands):
- relationship_anchors and schedule_anchors are optional user-provided relationship/schedule context.
- Use at most one anchor only when it naturally helps the current coaching move; do not force them.
- context_hint and anchor_phrase_hint are user-provided facts only when present — do not invent updates.
- Do not treat stale or omitted hints as current truth.
- Prefer bridging personal context into the goal over standalone chit-chat about a person.`;
}
