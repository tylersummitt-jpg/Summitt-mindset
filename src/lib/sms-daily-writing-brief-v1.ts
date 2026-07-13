/**
 * DailySmsWritingBriefV1 — compact C1 daily writer payload (consolidation, not another layer).
 */

import {
  buildSuggestedMoveFromDailyC1Card,
  isDailyC1StrategyCardEligible,
  type DailySmsSuggestedMoveV1,
  type StrategyCardV1,
} from "@/lib/coaching-strategy-card-v1";
import type { DailyProofCalibration } from "@/lib/sms-daily-proof-calibration";
import {
  deriveFreshnessAvoidPhrasesForBrief,
  type BriefFreshnessAvoidPhrase,
} from "@/lib/sms-daily-fresh-move";
import type { BriefThreadBuildTelemetry, BriefThreadWindowTelemetry } from "@/lib/sms-recent-exact-thread-72h";
import type { RecentExactThreadForBriefResult } from "@/lib/sms-recent-exact-thread-72h";
import { buildActivePendingStateFromDailyFacts } from "@/lib/sms-active-pending-state";
import type { RelationshipAnchorSources } from "@/lib/sms-relationship-anchors";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { TimingAnchorMemory } from "@/lib/timing-anchor-memory";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";
import {
  isAmbiguousRelatedProgressRelationshipMeaning,
  isAmbiguousRelatedProgressResponseIntent,
  isCoachingFitFeedbackRelationshipMeaning,
  isCoachingFitFeedbackResponseIntent,
} from "@/lib/openai-relationship-turn-understanding-v1";
import type { DailySilenceCadenceFacts, SilenceCadenceRoute } from "@/lib/sms-silence-cadence-v1";
import {
  buildDailySmsRelationshipReadV1,
  compactOpenLoopsForRelationshipRead,
  type DailySmsRelationshipReadV1,
} from "@/lib/sms-daily-relationship-read-v1";
import {
  buildSilenceCadenceRouteCardPromptAppendix,
  SILENCE_CADENCE_ROUTE_CARDS,
  silenceCadenceOverridesOldSilenceRouting,
} from "@/lib/sms-silence-cadence-v1";
import {
  buildSlotCoachingContext,
  type SlotCoachingContextV1,
  type SlotCoachingPreviousOutbound,
} from "@/lib/slot-coaching-context-v1";
import {
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
  type SmsDailySendSlot,
} from "@/lib/tyler-text-overview-types";

const DAILY_BRIEF_MAX_CHARS = 300;
const TIMING_GUIDANCE_MAX = 2;
const RELATIONSHIP_ANCHOR_PEOPLE_MAX = 4;
const DURABLE_MEMORY_MAX_WITH_RELATIONSHIP_READ = 4;

/** Style-only writer microguide — not duplicated in JSON brief payload. */
export const FIRST_TEXT_STYLE_MICROGUIDE_V1 = `FIRST-TEXT STYLE — subordinate to authoritative_truth and current_standard:
• Write one human SMS to someone you know; use their first name naturally when it fits.
• Lead with today's concrete rep tied to the real standard — identity may color it, not replace it.
• Give one specific first move for this morning; warm and direct, never soft or preachy.
• Important people may appear only when they deepen meaning — never guilt, pressure, or "do it for them."
• Avoid generic filler: checking in, you've got this, one honest step, stay committed, make today count.
• No Reply YES/NO, no Pat quotes, no third-person Pat, no daily mini-sermon.`;

export type BriefLocalDaypart = "morning" | "afternoon" | "evening" | "late_night";

export const DAILY_SMS_WRITING_BRIEF_VERSION = "1.0" as const;

export type DailySmsWritingBriefRouteKind =
  | "main_active_accountability"
  | "low_pressure_reactivation";

export const COACHING_SITUATION_AUTHORITY = "semantic_context_not_copy" as const;

export type CoachingSituationKind =
  | "normal_accountability"
  | "fit_in_question"
  | "repair_recent_correction"
  | "ambiguous_related_progress"
  | "close_prior_answer"
  | "proof_check"
  | "plan_check"
  | "silence_reentry";

export type CoachingSituationStandardStatus =
  | "active"
  | "stored_but_fit_in_question"
  | "stored_but_method_open";

export type CoachingSituationWriterPosture =
  | "run_accountability"
  | "repair_fit_before_accountability"
  | "clarify_before_drift"
  | "honor_correction_then_continue"
  | "close_loop_no_new_ask"
  | "ask_for_plan"
  | "ask_for_proof";

export type DailySmsCoachingSituationV1 = {
  authority: typeof COACHING_SITUATION_AUTHORITY;
  kind: CoachingSituationKind;
  current_standard_status: CoachingSituationStandardStatus;
  writer_posture: CoachingSituationWriterPosture;
  basis: string[];
  semantic_notes: string[];
};

export type DailySmsRecentTurnSemanticsV1 = {
  authority: typeof COACHING_SITUATION_AUTHORITY;
  relationship_meaning?: string | null;
  response_intent?: string | null;
  evidence_preview?: string | null;
  last_ask_satisfied?: "yes" | "no" | "unclear" | null;
  satisfied_ask_type?: string | null;
  source?: string | null;
};

export type DailySmsWritingBriefV1 = {
  brief_version: typeof DAILY_SMS_WRITING_BRIEF_VERSION;
  route_kind: DailySmsWritingBriefRouteKind;
  identity: {
    preferred_name: string;
    identity_anchor?: string | null;
    profile_hint?: string | null;
  };
  relationship_read: DailySmsRelationshipReadV1;
  /** Compact semantic situation — not copy, not a route engine. */
  coaching_situation: DailySmsCoachingSituationV1;
  /** Optional pass-through of already-loaded satisfied-ask / TU tokens. */
  recent_turn_semantics?: DailySmsRecentTurnSemanticsV1;
  /** Outbound moment/purpose for this generation (Phase 2A: always morning). Not wall-clock time. */
  current_send_slot: SmsDailySendSlot;
  /** Interpretive slot-to-slot coaching thread guidance — not proof authority. */
  slot_coaching_context: SlotCoachingContextV1;
  current_standard: {
    effective_ask: string;
    behavior_statement?: string | null;
    accountability_phase: string;
    max_chars: number;
  };
  authoritative_truth: {
    local: {
      date: string;
      weekday: string;
      timezone: string;
      local_time_iso: string;
      is_new_accountability_day: boolean;
      local_daypart: BriefLocalDaypart;
      timing_copy_guidance?: string[];
    };
    proof: {
      wins_7d: number;
      misses_7d: number;
      partials_7d: number;
      proof_age_days: number | null;
      last_proof_local_day: string | null;
      yes_streak_14d: number;
      praise_allowed_level: string;
      consistency_claim_allowed: boolean;
      strong_commitment_claim_allowed: boolean;
      summary_line: string;
    };
    claims: {
      can_claim_proof: boolean;
      can_claim_completion: boolean;
      can_claim_miss: boolean;
      can_claim_partial: boolean;
      can_reference_victory_room: boolean;
    };
    posture: string;
  };
  silence_cadence: {
    route: SilenceCadenceRoute;
    silence_day: number;
    send_today: boolean;
  } | null;
  recent_exact_thread: RecentExactThreadForBriefResult["window"] & {
    messages: RecentExactThreadForBriefResult["messages"];
    message_count: number;
    char_count: number;
  };
  freshness: {
    avoid_phrases: BriefFreshnessAvoidPhrase[];
    note?: string;
  };
  open_loops: {
    active_pending_kinds?: string[];
    latest_open_question?: string | null;
    latest_answer?: string | null;
    open_question_pending?: boolean;
    satisfied_do_not_repeat?: string[];
    pending_plan_active?: boolean;
    pending_plan_summary?: string | null;
    goal_evolution_invite?: {
      should_invite: boolean;
      invite_kind?: string | null;
      invite_reason?: string | null;
    } | null;
    thread_freshness_do_not_reask?: string[];
    timing_anchor?: {
      active: boolean;
      confidence_level: string | null;
      anchor_phrase_hint: string | null;
    };
  };
  suggested_move: DailySmsSuggestedMoveV1;
  relationship_anchors: {
    people: Array<{ name: string; role?: string }>;
    authority: "style_hint_only";
    usage: "sparingly_when_it_deepens_meaning_never_guilt";
  };
  durable_relationship_memory: {
    authority: "background_only";
    items: Array<{ kind: string; text: string }>;
  };
};

export function useDailySmsWritingBriefV1(facts: DailyV3RelationshipFacts): boolean {
  if (!isDailyC1StrategyCardEligible(facts)) return false;
  if ((facts.constraints.required_verbatim_substrings?.length ?? 0) > 0) return false;
  return true;
}

function truncateText(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Local send-time bucket for compact writer timing guidance (no new DB reads). */
export function deriveLocalDaypartForBrief(args: {
  timezone: string;
  localTimeIso: string;
}): BriefLocalDaypart {
  const d = new Date(args.localTimeIso);
  if (!Number.isFinite(d.getTime())) return "morning";
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: args.timezone,
    hour: "numeric",
    hour12: false,
  }).format(d);
  const hour = parseInt(hourStr, 10);
  if (!Number.isFinite(hour)) return "morning";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "late_night";
}

/**
 * Writer-facing daypart: current_send_slot wins over generation wall-clock.
 * Explicit slotDaypartOverride still wins (evening preview).
 */
export function resolveWriterFacingDaypartForBrief(args: {
  currentSendSlot: SmsDailySendSlot;
  slotDaypartOverride?: BriefLocalDaypart;
  timezone: string;
  localTimeIso: string;
}): BriefLocalDaypart {
  if (args.slotDaypartOverride) return args.slotDaypartOverride;
  if (args.currentSendSlot === "morning") return "morning";
  if (args.currentSendSlot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT) return "evening";
  return deriveLocalDaypartForBrief({
    timezone: args.timezone,
    localTimeIso: args.localTimeIso,
  });
}

/** Max 2 short timing strings — replaces giant legacy TIMING ANCHOR block on C1 brief path. */
export function buildCompactTimingCopyGuidanceForBrief(args: {
  facts: DailyV3RelationshipFacts;
  proofCalibration: DailyProofCalibration;
  timingAnchor?: TimingAnchorMemory | null;
  /** Slot-aware daypart; when omitted, falls back to wall-clock (legacy callers). */
  daypart?: BriefLocalDaypart;
}): string[] {
  const out: string[] = [];
  const daypart =
    args.daypart ??
    deriveLocalDaypartForBrief({
      timezone: args.facts.user.timezone,
      localTimeIso: args.facts.user.local_time_iso,
    });

  if (daypart === "morning") {
    out.push(
      "Morning send: do not ask as if today's outcome already happened."
    );
  } else if (daypart === "evening" || daypart === "late_night") {
    out.push(
      "Evening send: do not pitch fresh 'today' plans as if the day is wide open — frame tomorrow's move without assuming today is still open."
    );
  }

  const cal = args.proofCalibration;
  if (cal.proof_age_days != null && cal.proof_age_days >= 2) {
    out.push(
      `Last proof was ${cal.proof_age_days} local day(s) ago — do not say recently completed or imply today's outcome without fresh proof.`
    );
  } else if (
    cal.proof_age_days != null &&
    cal.proof_age_days >= 1 &&
    !cal.recent_completion_claim_allowed
  ) {
    out.push("Do not imply the user already completed today's standard unless proof is from today.");
  }

  const timing = args.timingAnchor ?? args.facts.accountability.timing_anchor_memory;
  if (timing?.active && timing.confidence_level === "mentioned_once") {
    const hint = timing.anchor_phrase_hint?.trim();
    out.push(
      hint
        ? `Timing anchor "${truncateText(hint, 60)}" was mentioned once — tentative wording only; do not assume it recurs today.`
        : "Timing anchor was mentioned once — tentative wording only; do not assume a recurring schedule."
    );
  } else if (timing?.active && timing.confidence_level) {
    out.push("Refer to remembered timing tentatively — confirm today's window before assuming it.");
  }

  return out.slice(0, TIMING_GUIDANCE_MAX);
}

const PRAISE_SNIPPET_RE =
  /\b(recently|shown commitment|great commitment|strong commitment|on a roll|consistent)\b/i;

function isDurableTextSafe(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (PRAISE_SNIPPET_RE.test(t)) return false;
  return true;
}

export function buildDurableRelationshipMemoryForBrief(args: {
  facts: DailyV3RelationshipFacts;
  calibration: DailyProofCalibration | null;
  /** When relationship_anchors.people is populated, person list items belong there only. */
  suppressPersonItems?: boolean;
}): DailySmsWritingBriefV1["durable_relationship_memory"] {
  const items: Array<{ kind: string; text: string }> = [];
  const sources: RelationshipAnchorSources | null | undefined = args.facts.relationship_anchor_sources;

  if (!args.suppressPersonItems && sources?.important_people?.length) {
    for (const p of sources.important_people) {
      const name = p.display_name?.trim();
      if (!name) continue;
      const rel = p.relationship_type?.trim();
      const text = truncateText(rel ? `${rel}: ${name}` : name, 100);
      if (isDurableTextSafe(text)) {
        items.push({ kind: "person", text });
      }
      if (items.length >= DURABLE_MEMORY_MAX_WITH_RELATIONSHIP_READ) break;
    }
  }

  if (items.length < DURABLE_MEMORY_MAX_WITH_RELATIONSHIP_READ && sources?.people_summary?.trim()) {
    const text = truncateText(sources.people_summary.trim(), 100);
    if (isDurableTextSafe(text)) {
      items.push({ kind: "people_summary", text });
    }
  }

  if (items.length < DURABLE_MEMORY_MAX_WITH_RELATIONSHIP_READ && args.facts.user.relationship_profile_summary?.trim()) {
    const text = truncateText(args.facts.user.relationship_profile_summary.trim(), 80);
    if (isDurableTextSafe(text)) {
      items.push({ kind: "tone", text });
    }
  }

  const blockers = args.facts.thread_memory.relationship_memory_30d?.recurring_blockers;
  if (items.length < DURABLE_MEMORY_MAX_WITH_RELATIONSHIP_READ && blockers?.length) {
    for (const b of blockers.slice(0, 2)) {
      const theme = b.canonical?.trim();
      if (!theme) continue;
      const text = truncateText(theme, 100);
      if (isDurableTextSafe(text)) {
        items.push({ kind: "blocker_theme", text });
      }
      if (items.length >= DURABLE_MEMORY_MAX_WITH_RELATIONSHIP_READ) break;
    }
  }

  void args.calibration;
  return {
    authority: "background_only",
    items: items.slice(0, DURABLE_MEMORY_MAX_WITH_RELATIONSHIP_READ),
  };
}

/** Writer-facing proof summary for C1 brief — same calibration facts, neutral phrasing (no generic copy models). */
export function buildBriefProofSummaryLineForWriter(cal: DailyProofCalibration): string {
  const age =
    cal.proof_age_days != null && Number.isFinite(cal.proof_age_days)
      ? `${cal.proof_age_days} local day(s) ago`
      : "unknown recency";

  switch (cal.praise_allowed_level) {
    case "none":
      return "No wins recorded in the last 7 days. Do not praise proof, consistency, or commitment. Hold the current standard without praise.";
    case "capability_only":
      return `Only ${cal.wins_7d} win(s) in the last 7 days; last proof was ${age}. Do not praise consistency or great commitment. Capability acknowledgment allowed; hold today's standard without overstating proof.`;
    case "specific_recent_proof":
      return `${cal.wins_7d} win(s) in 7d with recent proof (${age}). Acknowledge that specific outcome only — do not imply consistency or a streak.`;
    case "measured_progress":
      return `${cal.wins_7d} wins in 7d with fresh proof (${age}). Measured progress praise is allowed; do not exaggerate into domination or habit language.`;
    case "consistency":
      return `Multiple recent wins (${cal.wins_7d} in 7d; proof ${age}). Consistency language is allowed if tied to actual behavior — not generic hype.`;
    case "streak":
    default:
      return `Strong streak signal (${cal.wins_7d} wins in 7d; yes_streak_14d ${cal.yes_streak_14d}). Streak-true praise is allowed when specific.`;
  }
}

export function buildRelationshipAnchorsForBrief(
  sources: RelationshipAnchorSources | null | undefined
): DailySmsWritingBriefV1["relationship_anchors"] {
  const people: Array<{ name: string; role?: string }> = [];
  if (sources?.important_people?.length) {
    for (const p of sources.important_people) {
      const name = p.display_name?.trim();
      if (!name) continue;
      const role = p.relationship_type?.trim();
      people.push(
        role
          ? { name: truncateText(name, 40), role: truncateText(role, 24) }
          : { name: truncateText(name, 40) }
      );
      if (people.length >= RELATIONSHIP_ANCHOR_PEOPLE_MAX) break;
    }
  }
  return {
    people,
    authority: "style_hint_only",
    usage: "sparingly_when_it_deepens_meaning_never_guilt",
  };
}

/** C1 brief only — neutralize generic copy-model phrases in strategy-card move reason. */
export function neutralizeBriefSuggestedMoveReasonForWriter(reason: string): string {
  const t = reason.trim();
  if (!t) return t;

  const genericRe =
    /\bone honest (rep|step|win)\b|\bhonest next step\b|\bfresh opportunity\b|\bstay committed\b|\bmake today count\b/i;
  if (!genericRe.test(t)) return t.slice(0, 120);

  if (/\bweak\b.*\bstale\b.*\bproof\b/i.test(t)) {
    return "Weak or stale proof; hold the current standard without praise.".slice(0, 120);
  }
  if (/\bchoose a different honest next step\b/i.test(t)) {
    return "Same bar is okay; vary the angle.".slice(0, 120);
  }
  if (/\bfresh opportunity\b/i.test(t)) {
    return "Use a fresh angle without overstating proof.".slice(0, 120);
  }
  if (/\bone honest (rep|step|win)\b/i.test(t)) {
    return "Hold the current standard without generic filler.".slice(0, 120);
  }
  if (/\bstay committed\b/i.test(t)) {
    return "Hold the standard without hype.".slice(0, 120);
  }
  if (/\bmake today count\b/i.test(t)) {
    return "Focus on today's standard, not slogans.".slice(0, 120);
  }
  if (/\bhonest next step\b/i.test(t)) {
    return "Same bar is okay; vary the angle.".slice(0, 120);
  }

  return t.slice(0, 120);
}

export function buildSuggestedMoveForDailyWritingBrief(
  card: StrategyCardV1,
  calibration: DailyProofCalibration | null | undefined
): DailySmsSuggestedMoveV1 {
  const move = buildSuggestedMoveFromDailyC1Card(card, calibration);
  return {
    ...move,
    reason: neutralizeBriefSuggestedMoveReasonForWriter(move.reason),
  };
}

function deriveBriefPosture(facts: DailyV3RelationshipFacts): string {
  if (silenceCadenceOverridesOldSilenceRouting(facts.silence_cadence)) return "hold_standard";
  if (facts.accountability.coach_goal_evolution_invite?.should_invite) return "invite_goal_evolution";
  if (facts.accountability.pending_plan_proof?.active) return "plan_today";
  return "hold_standard";
}

function buildOpenLoopsForBrief(args: {
  facts: DailyV3RelationshipFacts;
  commitmentRow?: ActiveV2CommitmentRow | null;
}): DailySmsWritingBriefV1["open_loops"] {
  const f = args.facts;
  const tm = f.thread_memory;
  const pending = buildActivePendingStateFromDailyFacts(f, args.commitmentRow ?? null);
  const activeKinds = pending.state.items.map((i) => i.kind).slice(0, 6);

  const satisfied = [
    ...(f.daily_satisfied_ask_context?.do_not_repeat_asks ?? []),
    ...(tm.do_not_repeat_hints ?? []),
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);

  const threadFreshnessDnR = (f.thread_freshness?.completed_actions ?? [])
    .map((a) => a.text.trim())
    .filter(Boolean)
    .slice(0, 3);

  const invite = f.accountability.coach_goal_evolution_invite;
  const goalEvolutionInvite =
    invite?.should_invite === true
      ? {
          should_invite: true,
          invite_kind: invite.invite_kind ?? null,
          invite_reason: truncateText(
            invite.evidence_summary ?? invite.hold_standard_reason ?? "",
            120
          ) || null,
        }
      : null;

  const pendingPlan = f.accountability.pending_plan_proof;
  const timing = f.accountability.timing_anchor_memory;
  const timingAnchor =
    timing?.active === true
      ? {
          active: true,
          confidence_level: timing.confidence_level ?? null,
          anchor_phrase_hint: timing.anchor_phrase_hint
            ? truncateText(timing.anchor_phrase_hint, 80)
            : null,
        }
      : null;

  return {
    ...(activeKinds.length ? { active_pending_kinds: activeKinds } : {}),
    latest_open_question: tm.latest_open_question
      ? truncateText(tm.latest_open_question, 160)
      : null,
    latest_answer: tm.latest_answer_after_open_question
      ? truncateText(tm.latest_answer_after_open_question, 160)
      : null,
    open_question_pending: tm.open_question_pending ?? false,
    ...(satisfied.length ? { satisfied_do_not_repeat: satisfied } : {}),
    pending_plan_active: pendingPlan?.active === true,
    pending_plan_summary: pendingPlan?.active
      ? truncateText(pendingPlan.plan_summary_hint ?? pendingPlan.source_answer_preview ?? "", 120) ||
        null
      : null,
    goal_evolution_invite: goalEvolutionInvite,
    ...(threadFreshnessDnR.length ? { thread_freshness_do_not_reask: threadFreshnessDnR } : {}),
    ...(timingAnchor ? { timing_anchor: timingAnchor } : {}),
  };
}

function buildAuthoritativeClaims(
  card: StrategyCardV1,
  calibration: DailyProofCalibration
): DailySmsWritingBriefV1["authoritative_truth"]["claims"] {
  return {
    can_claim_proof: card.allowed_claims.proof,
    can_claim_completion: card.allowed_claims.completion,
    can_claim_miss: card.allowed_claims.miss,
    can_claim_partial: card.allowed_claims.partial,
    can_reference_victory_room: card.allowed_claims.victory_room,
  };
}

export type DailySmsWritingBriefOverrides = {
  currentSendSlot?: SmsDailySendSlot;
  slotDaypartOverride?: BriefLocalDaypart;
  previousOutbound?: SlotCoachingPreviousOutbound | null;
  userRepliesSincePreviousOutbound?: string[];
};

export type BuildDailySmsWritingBriefV1Args = {
  facts: DailyV3RelationshipFacts;
  proof_calibration: DailyProofCalibration;
  strategy_card: StrategyCardV1;
  thread: RecentExactThreadForBriefResult;
  freshness_phrases: BriefFreshnessAvoidPhrase[];
  commitmentRow?: ActiveV2CommitmentRow | null;
  writing_brief_overrides?: DailySmsWritingBriefOverrides;
};

const COACHING_SITUATION_BASIS_MAX = 5;
const COACHING_SITUATION_NOTES_MAX = 5;
const COACHING_SITUATION_LABEL_MAX = 48;

function pushSituationLabel(list: string[], label: string, max: number): void {
  const t = label.trim().slice(0, COACHING_SITUATION_LABEL_MAX);
  if (!t) return;
  const key = t.toLowerCase();
  if (list.some((x) => x.toLowerCase() === key)) return;
  if (list.length >= max) return;
  list.push(t);
}

function hasCorrectionAvoidToken(avoid: string[]): boolean {
  return avoid.some((a) => a.toLowerCase().includes("correction:"));
}

/** Stale-copy warning from freshness/duplicate coach — not the correction-avoid fallback alone. */
function hasFreshnessOrDuplicateStaleCopyWarning(warning: string | null | undefined): boolean {
  const w = warning?.trim() ?? "";
  if (!w) return false;
  return /stale wording|repeated the same ask/i.test(w);
}

function satisfiedAskIndicatesFitRepair(
  sac: DailyV3RelationshipFacts["daily_satisfied_ask_context"]
): boolean {
  if (!sac) return false;
  const meaning = sac.relationship_meaning?.trim().toLowerCase() ?? "";
  const intent = sac.response_intent?.trim().toLowerCase() ?? "";
  return (
    meaning === "goal_adjustment_request" ||
    intent === "clarify_goal_change" ||
    isCoachingFitFeedbackRelationshipMeaning(meaning) ||
    isCoachingFitFeedbackResponseIntent(intent)
  );
}

function satisfiedAskIndicatesAmbiguousRelatedProgress(
  sac: DailyV3RelationshipFacts["daily_satisfied_ask_context"]
): boolean {
  if (!sac) return false;
  return (
    isAmbiguousRelatedProgressRelationshipMeaning(sac.relationship_meaning) ||
    isAmbiguousRelatedProgressResponseIntent(sac.response_intent)
  );
}

/**
 * Detect fit/correction conflict from already-assembled semantic tokens only.
 * Does not scan raw inbound text or match user phrases.
 */
export function detectFitOrCorrectionConflictFromAssembledSemantics(args: {
  relationship_read: DailySmsRelationshipReadV1;
  daily_satisfied_ask_context?: DailyV3RelationshipFacts["daily_satisfied_ask_context"];
}): boolean {
  const read = args.relationship_read;
  const feel = read.what_would_make_user_feel_known;
  const honor =
    feel === "honor_correction" || feel === "heard_correction";
  const correctionAvoid = hasCorrectionAvoidToken(read.avoid_because_user_corrected_us);
  const standardConflict = Boolean(read.possible_current_standard_conflict?.trim());
  const staleCopy = hasFreshnessOrDuplicateStaleCopyWarning(read.bad_old_coach_copy_warning);
  const tuRepair = satisfiedAskIndicatesFitRepair(args.daily_satisfied_ask_context);

  if (tuRepair) return true;
  if (standardConflict) return true;
  // Mayes-style: correction token(s) plus freshness/duplicate stale-copy warning.
  if ((honor || correctionAvoid) && staleCopy) return true;
  return false;
}

export function buildRecentTurnSemanticsForBrief(
  sac: DailyV3RelationshipFacts["daily_satisfied_ask_context"]
): DailySmsRecentTurnSemanticsV1 | undefined {
  if (!sac) return undefined;
  const coachingFit =
    isCoachingFitFeedbackRelationshipMeaning(sac.relationship_meaning) ||
    isCoachingFitFeedbackResponseIntent(sac.response_intent);
  const ambiguousProgress =
    isAmbiguousRelatedProgressRelationshipMeaning(sac.relationship_meaning) ||
    isAmbiguousRelatedProgressResponseIntent(sac.response_intent);
  if (!sac.has_satisfied_recent_ask && !coachingFit && !ambiguousProgress) return undefined;
  const out: DailySmsRecentTurnSemanticsV1 = {
    authority: COACHING_SITUATION_AUTHORITY,
  };
  if (sac.relationship_meaning?.trim()) {
    out.relationship_meaning = truncateText(sac.relationship_meaning, 80);
  }
  if (sac.response_intent?.trim()) {
    out.response_intent = truncateText(sac.response_intent, 80);
  }
  if (sac.evidence_preview?.trim()) {
    out.evidence_preview = truncateText(sac.evidence_preview, 120);
  }
  if (sac.last_ask_satisfied) {
    out.last_ask_satisfied = sac.last_ask_satisfied;
  }
  if (sac.satisfied_ask_type) {
    out.satisfied_ask_type = sac.satisfied_ask_type;
  }
  if (sac.source) {
    out.source = sac.source;
  }
  return out;
}

export function buildCoachingSituationForBrief(args: {
  relationship_read: DailySmsRelationshipReadV1;
  suggested_move: DailySmsSuggestedMoveV1;
  open_loops: DailySmsWritingBriefV1["open_loops"];
  silence_cadence: DailySmsWritingBriefV1["silence_cadence"];
  daily_satisfied_ask_context?: DailyV3RelationshipFacts["daily_satisfied_ask_context"];
  freshness_avoid_count: number;
}): DailySmsCoachingSituationV1 {
  const basis: string[] = [];
  const semantic_notes: string[] = [];
  const read = args.relationship_read;
  const fitConflict = detectFitOrCorrectionConflictFromAssembledSemantics({
    relationship_read: read,
    daily_satisfied_ask_context: args.daily_satisfied_ask_context,
  });
  const silenceActive =
    Boolean(args.silence_cadence) && args.silence_cadence!.route !== "normal_daily";
  const pendingPlan = args.open_loops.pending_plan_active === true;
  const closeLoopMove = args.suggested_move.move === "close_loop";
  const feel = read.what_would_make_user_feel_known;
  const honor = feel === "honor_correction" || feel === "heard_correction";
  const standardConflict = Boolean(read.possible_current_standard_conflict?.trim());
  const tuRepair = satisfiedAskIndicatesFitRepair(args.daily_satisfied_ask_context);
  const tuAmbiguous = satisfiedAskIndicatesAmbiguousRelatedProgress(
    args.daily_satisfied_ask_context
  );

  if (silenceActive) {
    pushSituationLabel(basis, `silence:${args.silence_cadence!.route}`, COACHING_SITUATION_BASIS_MAX);
    return {
      authority: COACHING_SITUATION_AUTHORITY,
      kind: "silence_reentry",
      current_standard_status: "active",
      writer_posture: "run_accountability",
      basis,
      semantic_notes,
    };
  }

  if (fitConflict) {
    if (feel) pushSituationLabel(basis, `feel_known:${feel}`, COACHING_SITUATION_BASIS_MAX);
    if (hasCorrectionAvoidToken(read.avoid_because_user_corrected_us)) {
      pushSituationLabel(basis, "avoid:correction", COACHING_SITUATION_BASIS_MAX);
    }
    if (hasFreshnessOrDuplicateStaleCopyWarning(read.bad_old_coach_copy_warning)) {
      pushSituationLabel(basis, "stale_coach_copy", COACHING_SITUATION_BASIS_MAX);
    }
    if (standardConflict) {
      pushSituationLabel(basis, "standard_conflict", COACHING_SITUATION_BASIS_MAX);
    }
    if (tuRepair) {
      pushSituationLabel(basis, "tu:coaching_fit", COACHING_SITUATION_BASIS_MAX);
    }
    if (args.freshness_avoid_count > 0) {
      pushSituationLabel(basis, "freshness_avoid", COACHING_SITUATION_BASIS_MAX);
    }
    pushSituationLabel(semantic_notes, "fit_or_relevance_in_question", COACHING_SITUATION_NOTES_MAX);
    pushSituationLabel(semantic_notes, "do_not_coach_standard_as_rep", COACHING_SITUATION_NOTES_MAX);
    const kind: CoachingSituationKind =
      standardConflict || tuRepair ? "fit_in_question" : "repair_recent_correction";
    return {
      authority: COACHING_SITUATION_AUTHORITY,
      kind,
      current_standard_status: "stored_but_fit_in_question",
      writer_posture: "repair_fit_before_accountability",
      basis,
      semantic_notes,
    };
  }

  if (tuAmbiguous) {
    pushSituationLabel(basis, "tu:ambiguous_related_progress", COACHING_SITUATION_BASIS_MAX);
    pushSituationLabel(semantic_notes, "related_effort_completion_unclear", COACHING_SITUATION_NOTES_MAX);
    pushSituationLabel(semantic_notes, "clarify_before_drift", COACHING_SITUATION_NOTES_MAX);
    return {
      authority: COACHING_SITUATION_AUTHORITY,
      kind: "ambiguous_related_progress",
      current_standard_status: "active",
      writer_posture: "clarify_before_drift",
      basis,
      semantic_notes,
    };
  }

  if (pendingPlan) {
    pushSituationLabel(basis, "pending_plan", COACHING_SITUATION_BASIS_MAX);
    return {
      authority: COACHING_SITUATION_AUTHORITY,
      kind: "plan_check",
      current_standard_status: "active",
      writer_posture: "ask_for_plan",
      basis,
      semantic_notes,
    };
  }

  if (closeLoopMove) {
    pushSituationLabel(basis, "suggested_move:close_loop", COACHING_SITUATION_BASIS_MAX);
    if (args.open_loops.satisfied_do_not_repeat?.length) {
      pushSituationLabel(basis, "dnr_present", COACHING_SITUATION_BASIS_MAX);
    }
    return {
      authority: COACHING_SITUATION_AUTHORITY,
      kind: "close_prior_answer",
      current_standard_status: "active",
      writer_posture: "close_loop_no_new_ask",
      basis,
      semantic_notes,
    };
  }

  if (honor) {
    pushSituationLabel(basis, `feel_known:${feel}`, COACHING_SITUATION_BASIS_MAX);
    return {
      authority: COACHING_SITUATION_AUTHORITY,
      kind: "normal_accountability",
      current_standard_status: "active",
      writer_posture: "honor_correction_then_continue",
      basis,
      semantic_notes,
    };
  }

  pushSituationLabel(basis, "default_active", COACHING_SITUATION_BASIS_MAX);
  return {
    authority: COACHING_SITUATION_AUTHORITY,
    kind: "normal_accountability",
    current_standard_status: "active",
    writer_posture: "run_accountability",
    basis,
    semantic_notes,
  };
}

function normalizeFocusCompare(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function checkinFocusRepeatsStandard(
  checkinFocus: string | null | undefined,
  effectiveAsk: string
): boolean {
  const focus = checkinFocus?.trim() ?? "";
  const ask = effectiveAsk.trim();
  if (!focus || !ask) return false;
  const a = normalizeFocusCompare(focus);
  const b = normalizeFocusCompare(ask);
  if (a === b) return true;
  if (a.length >= 12 && b.includes(a)) return true;
  if (b.length >= 12 && a.includes(b)) return true;
  return false;
}

function pushRepairMustNotDo(list: string[], line: string): void {
  const t = line.trim().slice(0, 120);
  if (!t) return;
  if (list.some((x) => x.toLowerCase() === t.toLowerCase())) return;
  list.push(t);
}

/**
 * Resolve notebook contradictions for repair posture.
 * Does not mutate goals, send/no-send, or classify inbound text.
 */
export function applyCoachingSituationConflicts(args: {
  coaching_situation: DailySmsCoachingSituationV1;
  slot_coaching_context: SlotCoachingContextV1;
  suggested_move: DailySmsSuggestedMoveV1;
  current_standard_effective_ask: string;
}): {
  coaching_situation: DailySmsCoachingSituationV1;
  slot_coaching_context: SlotCoachingContextV1;
  suggested_move: DailySmsSuggestedMoveV1;
} {
  const situation = args.coaching_situation;
  let slot = args.slot_coaching_context;
  let move = args.suggested_move;

  if (situation.writer_posture !== "repair_fit_before_accountability") {
    if (situation.writer_posture === "clarify_before_drift") {
      const must_not_do = [...move.must_not_do];
      pushRepairMustNotDo(must_not_do, "Do not accuse miss or get-back-on-track drift");
      pushRepairMustNotDo(must_not_do, "Do not claim proof or completion for unclear related effort");
      pushRepairMustNotDo(
        must_not_do,
        "Ask one clarifying or concretizing question for a finished task"
      );
      return {
        coaching_situation: situation,
        slot_coaching_context: slot,
        suggested_move: {
          ...move,
          max_questions: 1,
          must_not_do: must_not_do.slice(0, 5),
        },
      };
    }
    return {
      coaching_situation: situation,
      slot_coaching_context: slot,
      suggested_move: move,
    };
  }

  if (slot.slot_role_recommendation === "set_today_rep") {
    slot = { ...slot, slot_role_recommendation: "truth_check" };
  }

  if (checkinFocusRepeatsStandard(slot.checkin_focus, args.current_standard_effective_ask)) {
    slot = { ...slot, checkin_focus: null };
  }

  const must_not_do = [...move.must_not_do];
  pushRepairMustNotDo(
    must_not_do,
    "Do not run normal accountability on current_standard until fit/relevance is repaired"
  );
  pushRepairMustNotDo(must_not_do, "Do not repeat satisfied or stale coach asks");
  pushRepairMustNotDo(must_not_do, "Do not use app or menu navigation");
  pushRepairMustNotDo(must_not_do, "Do not claim the goal changed");
  pushRepairMustNotDo(must_not_do, "Do not claim proof unless authoritative_truth allows it");

  move = {
    ...move,
    max_questions: 1,
    must_not_do: must_not_do.slice(0, 5),
  };

  const basis = [...situation.basis];
  pushSituationLabel(basis, "conflict_demote_set_today_rep", COACHING_SITUATION_BASIS_MAX);
  if (move.max_questions === 1) {
    pushSituationLabel(basis, "repair_allows_one_question", COACHING_SITUATION_BASIS_MAX);
  }

  return {
    coaching_situation: { ...situation, basis: basis.slice(0, COACHING_SITUATION_BASIS_MAX) },
    slot_coaching_context: slot,
    suggested_move: move,
  };
}

export function buildDailySmsWritingBriefV1(
  args: BuildDailySmsWritingBriefV1Args
): DailySmsWritingBriefV1 {
  const f = args.facts;
  const cal = args.proof_calibration;
  const tc = f.temporal_contract;
  const routeKind = f.route_kind as DailySmsWritingBriefRouteKind;
  const localDate = tc?.today_key ?? f.accountability_day_key;
  const localNow = new Date(f.user.local_time_iso);
  const weekday =
    Number.isFinite(localNow.getTime())
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: f.user.timezone,
          weekday: "long",
        }).format(localNow)
      : "";

  const preferredName =
    truncateText(f.user.preferred_name?.trim() || "there", 40) || "there";
  const overrides = args.writing_brief_overrides;
  const current_send_slot: SmsDailySendSlot =
    overrides?.currentSendSlot ?? SMS_DAILY_PRODUCTION_SEND_SLOT;
  const localDaypart = resolveWriterFacingDaypartForBrief({
    currentSendSlot: current_send_slot,
    slotDaypartOverride: overrides?.slotDaypartOverride,
    timezone: f.user.timezone,
    localTimeIso: f.user.local_time_iso,
  });
  const relationship_anchors = buildRelationshipAnchorsForBrief(f.relationship_anchor_sources);
  const open_loops_full = buildOpenLoopsForBrief({ facts: f, commitmentRow: args.commitmentRow });
  const freshnessPhrases = args.freshness_phrases.slice(0, 3);
  const timingCopyGuidanceForRead = buildCompactTimingCopyGuidanceForBrief({
    facts: f,
    proofCalibration: cal,
    daypart: localDaypart,
  });
  const suggested_move = buildSuggestedMoveForDailyWritingBrief(args.strategy_card, cal);

  const relationship_read = buildDailySmsRelationshipReadV1({
    messages: args.thread.messages,
    effectiveAsk: f.commitment.effective_ask,
    behaviorStatement: f.commitment.behavior_statement,
    localDaypart,
    targetDate: localDate,
    isNewAccountabilityDay:
      args.strategy_card.server_truth_summary.is_new_accountability_day ?? true,
    timingCopyGuidance: timingCopyGuidanceForRead,
    silenceRoute: f.silence_cadence?.route ?? null,
    freshnessPhrases,
    openLoops: open_loops_full,
    suggestedMove: suggested_move,
    praiseAllowedLevel: cal.praise_allowed_level,
    anchorNames: relationship_anchors.people.map((p) => p.name),
    routeKind,
    assembledTurnSemantics: f.daily_satisfied_ask_context
      ? {
          relationship_meaning: f.daily_satisfied_ask_context.relationship_meaning,
          response_intent: f.daily_satisfied_ask_context.response_intent,
          evidence_preview: f.daily_satisfied_ask_context.evidence_preview,
        }
      : null,
  });

  const open_loops = compactOpenLoopsForRelationshipRead(
    open_loops_full,
    Boolean(relationship_read.latest_user_signal)
  ) as DailySmsWritingBriefV1["open_loops"];

  const previousOutbound =
    overrides?.previousOutbound ??
    undefined;
  const slot_coaching_context = buildSlotCoachingContext({
    currentSlot: current_send_slot,
    previousOutbound: previousOutbound ?? undefined,
    userRepliesSincePreviousOutbound: overrides?.userRepliesSincePreviousOutbound,
    recentExactThread: args.thread.messages,
    pendingPlanProof: f.accountability.pending_plan_proof ?? null,
    timingAnchorMemory: f.accountability.timing_anchor_memory ?? null,
    silenceCadence: f.silence_cadence ?? null,
    effectiveAsk: f.commitment.effective_ask,
    openQuestionPending: open_loops.open_question_pending === true,
    latestOpenQuestion: open_loops.latest_open_question ?? null,
  });

  const current_standard = {
    effective_ask: truncateText(f.commitment.effective_ask, 200),
    behavior_statement: truncateText(f.commitment.behavior_statement, 200) || null,
    accountability_phase: truncateText(f.commitment.accountability_phase, 40),
    max_chars: f.constraints.max_chars ?? DAILY_BRIEF_MAX_CHARS,
  };

  const silence_cadence = f.silence_cadence
    ? {
        route: f.silence_cadence.route,
        silence_day: f.silence_cadence.silence_day,
        send_today: f.silence_cadence.send_today,
      }
    : null;

  let coaching_situation = buildCoachingSituationForBrief({
    relationship_read,
    suggested_move,
    open_loops,
    silence_cadence,
    daily_satisfied_ask_context: f.daily_satisfied_ask_context,
    freshness_avoid_count: freshnessPhrases.length,
  });

  const conflictResolved = applyCoachingSituationConflicts({
    coaching_situation,
    slot_coaching_context,
    suggested_move,
    current_standard_effective_ask: current_standard.effective_ask,
  });
  coaching_situation = conflictResolved.coaching_situation;

  const recent_turn_semantics = buildRecentTurnSemanticsForBrief(f.daily_satisfied_ask_context);

  return {
    brief_version: DAILY_SMS_WRITING_BRIEF_VERSION,
    route_kind: routeKind,
    identity: {
      preferred_name: preferredName,
      identity_anchor: f.commitment.identity_anchor_allowed
        ? truncateText(f.commitment.identity_anchor_short ?? "", 120) || null
        : null,
      profile_hint: f.user.relationship_profile_summary
        ? truncateText(f.user.relationship_profile_summary, 80)
        : null,
    },
    relationship_read,
    coaching_situation,
    ...(recent_turn_semantics ? { recent_turn_semantics } : {}),
    current_send_slot,
    slot_coaching_context: conflictResolved.slot_coaching_context,
    current_standard,
    authoritative_truth: {
      local: {
        date: localDate,
        weekday,
        timezone: f.user.timezone,
        local_time_iso: f.user.local_time_iso,
        is_new_accountability_day:
          args.strategy_card.server_truth_summary.is_new_accountability_day ?? true,
        local_daypart: localDaypart,
        ...(timingCopyGuidanceForRead.length
          ? { timing_copy_guidance: timingCopyGuidanceForRead }
          : {}),
      },
      proof: {
        wins_7d: cal.wins_7d,
        misses_7d: cal.misses_7d,
        partials_7d: cal.partials_7d,
        proof_age_days: cal.proof_age_days,
        last_proof_local_day: cal.last_user_yes_local_day,
        yes_streak_14d: cal.yes_streak_14d,
        praise_allowed_level: cal.praise_allowed_level,
        consistency_claim_allowed: cal.consistency_claim_allowed,
        strong_commitment_claim_allowed: cal.strong_commitment_claim_allowed,
        summary_line: truncateText(buildBriefProofSummaryLineForWriter(cal), 200),
      },
      claims: buildAuthoritativeClaims(args.strategy_card, cal),
      posture: deriveBriefPosture(f),
    },
    silence_cadence,
    recent_exact_thread: {
      ...args.thread.window,
      messages: args.thread.messages,
      message_count: args.thread.message_count,
      char_count: args.thread.char_count,
    },
    freshness: {
      avoid_phrases: freshnessPhrases,
      note: "Structural guardrail — paraphrase only; do not copy phrases.",
    },
    open_loops,
    suggested_move: conflictResolved.suggested_move,
    relationship_anchors,
    durable_relationship_memory: buildDurableRelationshipMemoryForBrief({
      facts: f,
      calibration: cal,
      suppressPersonItems: relationship_anchors.people.length > 0,
    }),
  };
}

export const MORNING_SLOT_WRITER_LINE =
  "Morning slot: write as a start-of-day accountability text for the target day. Ask for today's plan or next action; do not ask the user to reflect on a completed day or whether today's action already happened. Do not say \"tomorrow\" unless the notebook explicitly says the relevant event is tomorrow. Treat past methods in the thread as past context, not today's plan, unless the user restated them.\n";

export const EVENING_SLOT_WRITER_LINE =
  "Evening check-in: continue the thread since morning; use slot_coaching_context for focus, not a generic goal loop.\n";

export function buildDailySmsBriefSystemPrompt(args: {
  maxChars: number;
  zeroQuestionMode: boolean;
  pendingPlanActive: boolean;
  goalEvolutionInvite: boolean;
  silenceCadenceRoute?: SilenceCadenceRoute | null;
  currentSendSlot?: SmsDailySendSlot;
  coachingSituation?: DailySmsCoachingSituationV1 | null;
}): string {
  const scRoute = args.silenceCadenceRoute;
  const scCard = scRoute ? SILENCE_CADENCE_ROUTE_CARDS[scRoute] : null;
  const maxQ = scCard?.max_questions;
  const questionLine =
    maxQ === 0 || args.zeroQuestionMode
      ? "Write one statement-only coaching touch — no question mark, no hidden ask."
      : maxQ === 1
        ? "At most one question, or one concrete action."
        : "At most one question, or one concrete action.";
  const extras: string[] = [];
  if (args.pendingPlanActive) {
    extras.push("- Pending plan proof is active: close the plan loop before a fresh accountability ask.");
  }
  if (args.goalEvolutionInvite) {
    extras.push("- Goal evolution invite is allowed only as a soft invitation — no goal mutation.");
  }
  const cs = args.coachingSituation;
  const repairFit =
    cs?.writer_posture === "repair_fit_before_accountability" ||
    cs?.current_standard_status === "stored_but_fit_in_question";
  const clarifyBeforeDrift = cs?.writer_posture === "clarify_before_drift";
  if (cs) {
    extras.push(
      "- coaching_situation is semantic context, not copy — paraphrase tokens only."
    );
  }
  if (repairFit) {
    extras.push(
      "- stored_but_fit_in_question / repair_fit_before_accountability: do not run normal accountability on current_standard until fit is repaired."
    );
    if (!args.zeroQuestionMode) {
      extras.push("- One direct fit/relevance question when allowed — not a stale goal rep.");
    }
    extras.push("- Do not lead with today's rep on current_standard while fit is in question.");
  }
  if (clarifyBeforeDrift) {
    extras.push(
      "- clarify_before_drift / ambiguous_related_progress: acknowledge possible related progress; do not accuse miss or get-back-on-track."
    );
    if (!args.zeroQuestionMode) {
      extras.push(
        "- Ask one clarifying or concretizing question that turns broad effort into one finished task."
      );
    }
    extras.push("- Do not claim proof or completion while completion is unclear.");
  }
  extras.push(
    "- Outcome standards: if method is open/unclear, do not assume one method is the only way."
  );
  const silenceCadenceBlock =
    scRoute && scRoute !== "normal_daily"
      ? `\n${buildSilenceCadenceRouteCardPromptAppendix(scRoute)}\n`
      : "";

  const authorityOrder =
    scRoute && scRoute !== "normal_daily"
      ? "Truth hierarchy: authoritative_truth.claims and hard safety flags control what you may claim. open_loops, satisfied_do_not_repeat, and freshness control what must not be re-asked. recent_exact_thread is the literal SMS thread — its message bodies and timestamps beat summaries or interpretations. When present, silence_cadence route card controls re-entry posture. coaching_situation, relationship_read, slot_coaching_context, suggested_move, route cards, and durable memory are coaching hints/posture only — paraphrase them; never paste their phrases."
      : "Truth hierarchy: authoritative_truth.claims and hard safety flags control what you may claim. open_loops, satisfied_do_not_repeat, and freshness control what must not be re-asked. recent_exact_thread is the literal SMS thread — its message bodies and timestamps beat summaries or interpretations. coaching_situation, relationship_read, slot_coaching_context, suggested_move, and durable memory are coaching hints/posture only — paraphrase them; never paste their phrases.";

  const eveningSlotLine =
    args.currentSendSlot === SMS_DAILY_EVENING_PREVIEW_SEND_SLOT
      ? EVENING_SLOT_WRITER_LINE
      : "";
  const morningSlotLine =
    !eveningSlotLine &&
    (args.currentSendSlot == null || args.currentSendSlot === SMS_DAILY_PRODUCTION_SEND_SLOT)
      ? MORNING_SLOT_WRITER_LINE
      : "";

  const styleBlock = repairFit
    ? `${FIRST_TEXT_STYLE_MICROGUIDE_V1}\n• Exception when fit is in question: do not lead with a concrete rep on current_standard; repair fit/relevance first.`
    : FIRST_TEXT_STYLE_MICROGUIDE_V1;

  return `You are Coach Pat writing the next SMS in one long coaching relationship.

Use DAILY_SMS_WRITING_BRIEF_V1 for facts and constraints only — not wording. Write one fresh human SMS.
${authorityOrder}
Use recent_exact_thread for continuity, but prioritize the newest messages when deciding what to say next.
${morningSlotLine}${eveningSlotLine}Paraphrase all hints (coaching_situation, relationship_read, slot_coaching_context, suggested_move, silence route cards, durable memory). Do not paste notebook phrases, route-card lines, relationship_read tokens, slot summaries, or prior coach wording. The only exact reuse allowed is the user's own words when useful and not stale.
authoritative_truth.claims never authorize proof, completion, misses, Victory Room, or goal changes unless the boolean is true. Do not claim the user responded when they did not. Do not invent wins, misses, or unsupported temporal claims.
When silence_cadence route card is present, it overrides old silence/reentry hints; current_standard still applies as stored truth. Do not copy example shapes verbatim.
${silenceCadenceBlock}
Write like a real coach who knows this person: direct, warm enough, plainspoken, specific, and willing to hold the standard. Do not sound like software, customer support, a therapist, or a habit tracker.
Best shape: one sentence of continuity, one sentence naming the standard or next move, one direct ask or challenge. Concrete today beats reflection.
Do not say no worries, please respond, or whenever you are ready before final_daily_mode_day14. No app, website, Victory Room, Change Goal, Update Goal, or menu directions unless allow_goal_adjustment_language is true — and then only as a spoken coaching question, never navigation.
${questionLine}
One SMS, max ${args.maxChars} characters, no newlines. No robot menu (Reply YES/NO). No fake Pat quotes. No fake proof. No invented wins/misses/Victory Room claims. No generic motivation filler. Do not repeat stale or satisfied asks.
${extras.join("\n")}

${styleBlock}

OUTPUT: strict JSON only with keys:
should_send (boolean), body (string, empty if should_send false), no_send_reason (string|null),
turn_purpose (string), voice_confidence (number 0-1 or null),
used_facts (string[]), safety_notes (string[])`;
}

export function buildDailySmsWriterMessagesFromBrief(brief: DailySmsWritingBriefV1): {
  system: string;
  user: string;
  writer_payload_chars: number;
  writer_system_chars: number;
  writer_total_chars: number;
} {
  const system = buildDailySmsBriefSystemPrompt({
    maxChars: brief.current_standard.max_chars,
    zeroQuestionMode: brief.suggested_move.max_questions === 0,
    pendingPlanActive: brief.open_loops.pending_plan_active === true,
    goalEvolutionInvite: brief.open_loops.goal_evolution_invite?.should_invite === true,
    silenceCadenceRoute: brief.silence_cadence?.route ?? null,
    currentSendSlot: brief.current_send_slot,
    coachingSituation: brief.coaching_situation,
  });
  const user = `DAILY_SMS_WRITING_BRIEF_V1 (server truth — not copyable prose):
${JSON.stringify(brief)}

Write JSON only.`;
  return {
    system,
    user,
    writer_system_chars: system.length,
    writer_payload_chars: user.length,
    writer_total_chars: system.length + user.length,
  };
}

export type DailyWritingBriefBuildStatus =
  | "used"
  | "skipped_non_c1_route"
  | "skipped_required_verbatim"
  | "skipped_missing_strategy_card"
  | "skipped_missing_thread"
  | "skipped_missing_proof_calibration"
  | "skipped_error"
  | "legacy_not_applicable";

/** Pipe-separated freshness preview from prior coach CTA/advice only (max 3 × 60 chars). */
export function buildFreshnessAvoidPhrasesPreview(
  phrases: BriefFreshnessAvoidPhrase[]
): string {
  return phrases
    .slice(0, 3)
    .map((p) => truncateText(p.phrase, 60))
    .filter(Boolean)
    .join(" | ");
}

/** Why C1 daily fell back to legacy_packet_v1 (observability only). */
export function deriveDailyWritingBriefFallbackTelemetry(args: {
  facts: DailyV3RelationshipFacts;
  validatedDailyC1Card: StrategyCardV1 | null;
  briefThread: RecentExactThreadForBriefResult | null;
  hasProofCalibration: boolean;
}): Record<string, unknown> {
  if ((args.facts.constraints.required_verbatim_substrings?.length ?? 0) > 0) {
    return {
      daily_writing_brief_build_status: "skipped_required_verbatim" satisfies DailyWritingBriefBuildStatus,
      daily_writing_brief_skip_reason: "skipped_required_verbatim",
    };
  }

  if (!isDailyC1StrategyCardEligible(args.facts)) {
    return {
      daily_writing_brief_build_status: "legacy_not_applicable" satisfies DailyWritingBriefBuildStatus,
      daily_writing_brief_skip_reason: "skipped_non_c1_route",
    };
  }

  if (!args.validatedDailyC1Card) {
    return {
      daily_writing_brief_build_status: "skipped_missing_strategy_card" satisfies DailyWritingBriefBuildStatus,
      daily_writing_brief_skip_reason: "skipped_missing_strategy_card",
    };
  }
  if (!args.briefThread) {
    return {
      daily_writing_brief_build_status: "skipped_missing_thread" satisfies DailyWritingBriefBuildStatus,
      daily_writing_brief_skip_reason: "skipped_missing_thread",
    };
  }
  if (!args.hasProofCalibration) {
    return {
      daily_writing_brief_build_status: "skipped_missing_proof_calibration" satisfies DailyWritingBriefBuildStatus,
      daily_writing_brief_skip_reason: "skipped_missing_proof_calibration",
    };
  }

  return {
    daily_writing_brief_build_status: "skipped_error" satisfies DailyWritingBriefBuildStatus,
    daily_writing_brief_skip_reason: "skipped_error",
  };
}

/** Safe enum reasons for timing guidance (no raw user text or names). */
export function deriveTimingGuidanceReasonForTelemetry(
  brief: DailySmsWritingBriefV1
): string | null {
  const reasons: string[] = [];
  const daypart = brief.authoritative_truth.local.local_daypart;
  const guidance = brief.authoritative_truth.local.timing_copy_guidance ?? [];

  if (daypart === "morning" && guidance.length > 0) {
    reasons.push("morning_no_outcome_ask");
  }
  if ((daypart === "evening" || daypart === "late_night") && guidance.length > 0) {
    reasons.push("evening_no_fresh_today_plan");
  }
  if (
    brief.authoritative_truth.proof.proof_age_days != null &&
    brief.authoritative_truth.proof.proof_age_days >= 1
  ) {
    reasons.push("stale_proof_no_recent_completion");
  }
  const timingAnchor = brief.open_loops.timing_anchor;
  if (timingAnchor?.active) {
    if (timingAnchor.confidence_level === "mentioned_once") {
      reasons.push("timing_anchor_mentioned_once");
    } else if (timingAnchor.confidence_level) {
      reasons.push("timing_anchor_active");
    }
  }
  return reasons.length ? truncateText(reasons.join("|"), 80) : null;
}

export function dailyWritingBriefTimingTelemetry(
  brief: DailySmsWritingBriefV1
): Record<string, unknown> {
  const local = brief.authoritative_truth.local;
  const guidanceCount = local.timing_copy_guidance?.length ?? 0;
  const timingAnchor = brief.open_loops.timing_anchor;
  const anchorActive = timingAnchor?.active === true;
  const anchorConfidence = anchorActive
    ? timingAnchor?.confidence_level ?? "none"
    : "none";

  return {
    daily_local_daypart: local.local_daypart,
    daily_timing_copy_guidance_count: guidanceCount,
    daily_timing_anchor_active: anchorActive,
    daily_timing_anchor_confidence: anchorConfidence,
    daily_timing_guidance_present: guidanceCount > 0,
    daily_timing_guidance_reason: deriveTimingGuidanceReasonForTelemetry(brief),
  };
}

export function dailyWritingBriefDurableMemoryTelemetry(
  brief: DailySmsWritingBriefV1
): Record<string, unknown> {
  const items = brief.durable_relationship_memory.items;
  const peopleCount = items.filter(
    (i) => i.kind === "person" || i.kind === "people_summary"
  ).length;
  const blockerCount = items.filter((i) => i.kind === "blocker_theme").length;

  return {
    daily_durable_memory_item_count: items.length,
    daily_durable_people_count: peopleCount,
    daily_durable_blocker_theme_count: blockerCount,
    daily_durable_memory_background_only:
      brief.durable_relationship_memory.authority === "background_only",
    daily_durable_memory_has_identity_anchor: Boolean(brief.identity.identity_anchor),
    daily_durable_memory_has_profile_hint: Boolean(brief.identity.profile_hint),
  };
}

export function dailyWritingBriefExtendedTelemetry(args: {
  brief: DailySmsWritingBriefV1;
  threadWindow: BriefThreadWindowTelemetry;
}): Record<string, unknown> {
  const sm = args.brief.suggested_move;
  const ol = args.brief.open_loops;
  const preview = buildFreshnessAvoidPhrasesPreview(args.brief.freshness.avoid_phrases);
  const activePendingKinds = ol.active_pending_kinds?.length ?? 0;

  return {
    daily_writing_brief_build_status: "used" satisfies DailyWritingBriefBuildStatus,
    daily_suggested_move: truncateText(sm.move, 40),
    daily_suggested_posture: truncateText(sm.posture, 40),
    daily_suggested_max_questions: sm.max_questions,
    daily_suggested_move_reason_preview:
      truncateText(sm.reason, 120) || null,
    daily_suggested_move_must_not_do_count: sm.must_not_do.length,
    daily_freshness_avoid_phrases_preview: preview || null,
    daily_open_loop_pending_active:
      activePendingKinds > 0 ||
      ol.pending_plan_active === true ||
      ol.goal_evolution_invite?.should_invite === true,
    daily_open_question_pending: ol.open_question_pending ?? false,
    daily_satisfied_do_not_repeat_count: ol.satisfied_do_not_repeat?.length ?? 0,
    daily_goal_evolution_invite_active: ol.goal_evolution_invite?.should_invite === true,
    daily_pending_plan_active: ol.pending_plan_active === true,
    daily_thread_freshness_do_not_reask_count: ol.thread_freshness_do_not_reask?.length ?? 0,
    ...dailyWritingBriefTimingTelemetry(args.brief),
    ...dailyWritingBriefDurableMemoryTelemetry(args.brief),
    ...args.threadWindow,
  };
}

export function dailyWritingBriefTelemetry(args: {
  brief: DailySmsWritingBriefV1;
  writer_system_chars: number;
  writer_payload_chars: number;
  writer_total_chars: number;
  threadWindow?: BriefThreadWindowTelemetry;
  threadBuild?: BriefThreadBuildTelemetry;
}): Record<string, unknown> {
  return {
    daily_writing_brief_version: DAILY_SMS_WRITING_BRIEF_VERSION,
    daily_writing_brief_used: true,
    slot_coaching_context_role: args.brief.slot_coaching_context.slot_role_recommendation,
    slot_coaching_context_send_rec: args.brief.slot_coaching_context.should_send_recommendation,
    current_send_slot: args.brief.current_send_slot,
    writer_prompt_path: "daily_writing_brief_v1",
    writer_system_chars: args.writer_system_chars,
    writer_payload_chars: args.writer_payload_chars,
    writer_total_chars: args.writer_total_chars,
    daily_freshness_avoid_count: args.brief.freshness.avoid_phrases.length,
    daily_brief_thread_message_count: args.brief.recent_exact_thread.message_count,
    daily_brief_thread_char_count: args.brief.recent_exact_thread.char_count,
    daily_brief_thread_window_mode: args.brief.recent_exact_thread.mode,
    ...(args.threadBuild ?? {}),
    ...dailyWritingBriefExtendedTelemetry({
      brief: args.brief,
      threadWindow: args.threadWindow ?? {
        daily_brief_thread_floor_message_count: args.brief.recent_exact_thread.message_count,
        daily_brief_thread_extension_message_count: 0,
        daily_brief_thread_oldest_at_local:
          args.brief.recent_exact_thread.messages[0]?.at_local ?? null,
        daily_brief_thread_newest_at_local:
          args.brief.recent_exact_thread.messages.at(-1)?.at_local ?? null,
      },
    }),
  };
}
