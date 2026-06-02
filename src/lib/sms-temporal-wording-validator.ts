/**
 * Temporal Truth v1 — conservative post-generation validator for relative date words.
 */

import type {
  TemporalContractV1,
  TemporalReferencedEventV1,
} from "@/lib/sms-temporal-contract-v1";

export type TemporalWordingViolationReason =
  | "invalid_yesterday_reference"
  | "invalid_today_reference"
  | "invalid_tomorrow_reference";

export type TemporalWordingViolation = {
  reason: TemporalWordingViolationReason;
  detail: string;
  salient_ref_id: string | null;
  salient_local_day_key: string | null;
  allowed_relative_label: string | null;
};

export type DetectTemporalWordingContext = {
  temporal_contract: TemporalContractV1;
  referenced_events: TemporalReferencedEventV1[];
  mode: "daily" | "inbound" | "weekly";
  /** Skip when binding verbatim contains relative words */
  skip_validation?: boolean;
};

const COMPLETION_EVENT_TYPES = new Set<TemporalReferencedEventV1["event_type"]>([
  "user_yes",
  "user_partial",
  "completion_in_thread",
]);

const PLAN_EVENT_TYPES = new Set<TemporalReferencedEventV1["event_type"]>(["plan"]);

function wordInBody(body: string, word: "today" | "yesterday" | "tomorrow"): boolean {
  return new RegExp(`\\b${word}\\b`, "i").test(body);
}

function splitBodySentences(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True when a sentence with `word` appears to attribute the salient win/plan to that relative day. */
function sentenceAttributesSalientToRelativeWord(
  sentence: string,
  word: "today" | "yesterday" | "tomorrow",
  salient: TemporalReferencedEventV1
): boolean {
  if (!wordInBody(sentence, word)) return false;
  const lower = sentence.toLowerCase();
  const preview = (salient.evidence_preview ?? "").toLowerCase();
  const relativeDayStop = new Set(["today", "yesterday", "tomorrow"]);
  const previewTokens = preview
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 4 && !relativeDayStop.has(t));
  if (previewTokens.some((t) => lower.includes(t))) return true;
  const completionCue =
    /\b(got it done|did great|great with|hit the bar|follow[- ]?through|manage|distribution|proof|win|done today|done yesterday)\b/i.test(
      lower
    );
  return completionCue && (preview.length > 0 || COMPLETION_EVENT_TYPES.has(salient.event_type));
}

function bodyAttributesSalientToRelativeWord(
  body: string,
  word: "today" | "yesterday" | "tomorrow",
  salient: TemporalReferencedEventV1
): boolean {
  return splitBodySentences(body).some((s) =>
    sentenceAttributesSalientToRelativeWord(s, word, salient)
  );
}

function resolveReferencedEvents(context: DetectTemporalWordingContext): TemporalReferencedEventV1[] {
  if (context.referenced_events !== undefined) {
    return context.referenced_events;
  }
  return context.temporal_contract.referenced_events ?? [];
}

export function pickSalientReferencedEvent(
  events: TemporalReferencedEventV1[]
): TemporalReferencedEventV1 | null {
  const completion = events.find((e) => COMPLETION_EVENT_TYPES.has(e.event_type));
  if (completion) return completion;
  const plan = events.find((e) => PLAN_EVENT_TYPES.has(e.event_type));
  return plan ?? events[0] ?? null;
}

export function detectTemporalWordingViolations(
  body: string,
  context: DetectTemporalWordingContext
): TemporalWordingViolation[] {
  if (context.skip_validation) return [];
  const t = body.trim();
  if (!t) return [];

  const events = resolveReferencedEvents(context);

  const salient = pickSalientReferencedEvent(events);
  if (!salient?.local_day_key) return [];

  const contract = context.temporal_contract;
  const violations: TemporalWordingViolation[] = [];

  const base = {
    salient_ref_id: salient.ref_id,
    salient_local_day_key: salient.local_day_key,
    allowed_relative_label: salient.allowed_relative_label,
  };

  if (
    bodyAttributesSalientToRelativeWord(t, "yesterday", salient) &&
    salient.local_day_key !== contract.yesterday_key &&
    COMPLETION_EVENT_TYPES.has(salient.event_type)
  ) {
    violations.push({
      reason: "invalid_yesterday_reference",
      detail: `Body uses "yesterday" but salient event local_day_key=${salient.local_day_key} !== yesterday_key=${contract.yesterday_key}.`,
      ...base,
    });
  }

  if (
    bodyAttributesSalientToRelativeWord(t, "today", salient) &&
    salient.local_day_key !== contract.today_key &&
    COMPLETION_EVENT_TYPES.has(salient.event_type)
  ) {
    violations.push({
      reason: "invalid_today_reference",
      detail: `Body uses "today" but salient event local_day_key=${salient.local_day_key} !== today_key=${contract.today_key}.`,
      ...base,
    });
  }

  if (
    bodyAttributesSalientToRelativeWord(t, "tomorrow", salient) &&
    PLAN_EVENT_TYPES.has(salient.event_type) &&
    salient.local_day_key !== contract.tomorrow_key
  ) {
    violations.push({
      reason: "invalid_tomorrow_reference",
      detail: `Body uses "tomorrow" but plan local_day_key=${salient.local_day_key} !== tomorrow_key=${contract.tomorrow_key}.`,
      ...base,
    });
  }

  return violations;
}

export function temporalWordingViolationReasons(
  violations: TemporalWordingViolation[]
): string[] {
  return violations.map((v) => v.reason);
}
