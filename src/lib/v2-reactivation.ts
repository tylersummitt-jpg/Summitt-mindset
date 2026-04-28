/**
 * V2 low-pressure reactivation: pure entry rules (source of truth remains v2_commitment).
 */

import { isV2PendingProposalValid } from "@/lib/v2-adaptive-contract";
import type { V2AccountabilityPhase } from "@/lib/v2-accountability-phase";
import type { V2CadenceLevel } from "@/lib/v2-cadence";
import type { ActiveV2CommitmentRow, V2EventRowForAi } from "@/lib/v2-commitment";
import type { V2SilenceContext } from "@/lib/v2-ai-outbound";

const MS_HOUR = 60 * 60 * 1000;
const RECENT_SIGNAL_LOOKBACK_MS = 48 * MS_HOUR;
const REACTIVATION_NUDGE_INTERVAL_MS = 7 * 24 * MS_HOUR;

const ACCOUNTABILITY_SIGNAL_TYPES = new Set([
  "user_yes",
  "user_no",
  "user_partial",
  "blocker_captured",
]);

function eventTimeMs(iso: string): number {
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : 0;
}

/** True if any user_yes | user_no | user_partial | blocker_captured occurred within the last 48h. */
export function hasRecentAccountabilityOrBlockerSignal(
  eventsNewestFirst: V2EventRowForAi[],
  nowMs: number
): boolean {
  const cutoff = nowMs - RECENT_SIGNAL_LOOKBACK_MS;
  for (const e of eventsNewestFirst) {
    if (!ACCOUNTABILITY_SIGNAL_TYPES.has(e.event_type)) continue;
    const t = eventTimeMs(e.occurred_at);
    if (t >= cutoff && t <= nowMs) return true;
  }
  return false;
}

/** Parse cadence.level from a successful check_sent payload_json (null if missing/invalid). */
export function parseCadenceLevelFromCheckSentPayload(
  payload: Record<string, unknown> | null | undefined
): V2CadenceLevel | null {
  if (!payload || typeof payload !== "object") return null;
  const c = payload.cadence;
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const level = (c as { level?: unknown }).level;
  if (level === "daily" || level === "every_other_day" || level === "every_3_days") {
    return level;
  }
  return null;
}

/**
 * Enter low-pressure reactivation only if ALL are true:
 * 1. No valid pending adaptive contract proposal awaiting consent.
 * 2. Unanswered checks >= 3 (same spine as deriveV2SilenceContext.unanswered_checks).
 * 3. Days since last user accountability outcome >= 7 (or no outcome but unanswered stream per silence rules).
 * 4. The two most recent check_sent payloads both record cadence level every_3_days.
 * 5. No user_yes | user_no | user_partial | blocker_captured in the last 48 hours.
 * 6. Current stored phase is active_accountability.
 */
export function shouldEnterLowPressureReactivation(args: {
  phase: V2AccountabilityPhase;
  commitment: ActiveV2CommitmentRow;
  nowMs: number;
  silence: V2SilenceContext;
  /** Newest first; at least the two latest check_sent rows' payloads (same order). */
  lastTwoCheckSentCadenceLevels: readonly (V2CadenceLevel | null)[];
  recentEventsNewestFirst: V2EventRowForAi[];
}): boolean {
  if (args.phase !== "active_accountability") return false;
  if (isV2PendingProposalValid(args.commitment, args.nowMs)) return false;
  if (args.silence.unanswered_checks < 3) return false;
  if (args.silence.days_since_last_user_outcome < 7) return false;

  const pair = args.lastTwoCheckSentCadenceLevels;
  if (pair.length < 2) return false;
  if (pair[0] !== "every_3_days" || pair[1] !== "every_3_days") return false;

  if (hasRecentAccountabilityOrBlockerSignal(args.recentEventsNewestFirst, args.nowMs)) {
    return false;
  }

  return true;
}

/**
 * Weekly cap: first nudge eligible 7 days after reactivation_entered_at; thereafter 7 days after each send.
 */
export function isReactivationNudgeDue(args: {
  reactivationEnteredAt: string | null;
  reactivationLastSentAt: string | null;
  nowMs: number;
}): boolean {
  if (!args.reactivationEnteredAt?.trim()) return false;
  const entered = new Date(args.reactivationEnteredAt).getTime();
  if (!Number.isFinite(entered)) return false;

  const anchorMs = (() => {
    if (args.reactivationLastSentAt?.trim()) {
      const t = new Date(args.reactivationLastSentAt).getTime();
      return Number.isFinite(t) ? t : entered;
    }
    return entered;
  })();

  return args.nowMs >= anchorMs + REACTIVATION_NUDGE_INTERVAL_MS;
}

export const V2_REACTIVATION_ENTRY_REASON = "silence_relaxed_cadence_threshold" as const;
