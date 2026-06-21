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
import type { RecentExactThreadForBriefResult } from "@/lib/sms-recent-exact-thread-72h";
import { buildActivePendingStateFromDailyFacts } from "@/lib/sms-active-pending-state";
import type { RelationshipAnchorSources } from "@/lib/sms-relationship-anchors";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { TimingAnchorMemory } from "@/lib/timing-anchor-memory";
import type { DailyV3RelationshipFacts } from "@/lib/v3-daily-relationship-lane";

const DAILY_BRIEF_MAX_CHARS = 300;
const TIMING_GUIDANCE_MAX = 2;

export type BriefLocalDaypart = "morning" | "afternoon" | "evening" | "late_night";

export const DAILY_SMS_WRITING_BRIEF_VERSION = "1.0" as const;

export type DailySmsWritingBriefRouteKind =
  | "main_active_accountability"
  | "low_pressure_reactivation";

export type DailySmsWritingBriefV1 = {
  brief_version: typeof DAILY_SMS_WRITING_BRIEF_VERSION;
  route_kind: DailySmsWritingBriefRouteKind;
  identity: {
    preferred_name: string;
    identity_anchor?: string | null;
    profile_hint?: string | null;
  };
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
    silence_note?: string | null;
  };
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
  durable_relationship_memory: {
    authority: "background_only";
    items: Array<{ kind: string; text: string }>;
  };
  style_guardrails: {
    one_sms: true;
    no_robot_menu: true;
    no_fake_pat_quotes: true;
    no_generic_motivation: true;
    summaries_background_only: true;
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

/** Max 2 short timing strings — replaces giant legacy TIMING ANCHOR block on C1 brief path. */
export function buildCompactTimingCopyGuidanceForBrief(args: {
  facts: DailyV3RelationshipFacts;
  proofCalibration: DailyProofCalibration;
  timingAnchor?: TimingAnchorMemory | null;
}): string[] {
  const out: string[] = [];
  const daypart = deriveLocalDaypartForBrief({
    timezone: args.facts.user.timezone,
    localTimeIso: args.facts.user.local_time_iso,
  });

  if (daypart === "morning") {
    out.push(
      "Morning send: do not ask whether today's goal already happened — protect the first honest rep."
    );
  } else if (daypart === "evening" || daypart === "late_night") {
    out.push(
      "Evening send: do not pitch fresh 'today' plans as if the day is wide open — aim at tomorrow's first honest step."
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
    out.push("Do not imply the user already completed today's rep unless proof is from today.");
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
}): DailySmsWritingBriefV1["durable_relationship_memory"] {
  const items: Array<{ kind: string; text: string }> = [];
  const sources: RelationshipAnchorSources | null | undefined = args.facts.relationship_anchor_sources;

  if (sources?.important_people?.length) {
    for (const p of sources.important_people) {
      const name = p.display_name?.trim();
      if (!name) continue;
      const rel = p.relationship_type?.trim();
      const text = truncateText(rel ? `${rel}: ${name}` : name, 100);
      if (isDurableTextSafe(text)) {
        items.push({ kind: "person", text });
      }
      if (items.length >= 12) break;
    }
  }

  if (items.length < 12 && sources?.people_summary?.trim()) {
    const text = truncateText(sources.people_summary.trim(), 100);
    if (isDurableTextSafe(text)) {
      items.push({ kind: "people_summary", text });
    }
  }

  if (items.length < 12 && args.facts.user.relationship_profile_summary?.trim()) {
    const text = truncateText(args.facts.user.relationship_profile_summary.trim(), 80);
    if (isDurableTextSafe(text)) {
      items.push({ kind: "tone", text });
    }
  }

  const blockers = args.facts.thread_memory.relationship_memory_30d?.recurring_blockers;
  if (items.length < 12 && blockers?.length) {
    for (const b of blockers.slice(0, 2)) {
      const theme = b.canonical?.trim();
      if (!theme) continue;
      const text = truncateText(theme, 100);
      if (isDurableTextSafe(text)) {
        items.push({ kind: "blocker_theme", text });
      }
      if (items.length >= 12) break;
    }
  }

  void args.calibration;
  return { authority: "background_only", items: items.slice(0, 12) };
}

function deriveBriefPosture(facts: DailyV3RelationshipFacts): string {
  if (facts.route_kind === "low_pressure_reactivation") return "reactivation";
  if (facts.accountability.coach_goal_evolution_invite?.should_invite) return "invite_goal_evolution";
  if (facts.accountability.reentry_active) return "recover";
  if (facts.accountability.pending_plan_proof?.active) return "plan_today";
  if (facts.accountability.server_strategy === "reactivation_nudge") return "reactivation";
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

export type BuildDailySmsWritingBriefV1Args = {
  facts: DailyV3RelationshipFacts;
  proof_calibration: DailyProofCalibration;
  strategy_card: StrategyCardV1;
  thread: RecentExactThreadForBriefResult;
  freshness_phrases: BriefFreshnessAvoidPhrase[];
  commitmentRow?: ActiveV2CommitmentRow | null;
};

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
  const localDaypart = deriveLocalDaypartForBrief({
    timezone: f.user.timezone,
    localTimeIso: f.user.local_time_iso,
  });
  const timingCopyGuidance = buildCompactTimingCopyGuidanceForBrief({
    facts: f,
    proofCalibration: cal,
  });

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
    current_standard: {
      effective_ask: truncateText(f.commitment.effective_ask, 200),
      behavior_statement: truncateText(f.commitment.behavior_statement, 200) || null,
      accountability_phase: truncateText(f.commitment.accountability_phase, 40),
      max_chars: f.constraints.max_chars ?? DAILY_BRIEF_MAX_CHARS,
    },
    authoritative_truth: {
      local: {
        date: localDate,
        weekday,
        timezone: f.user.timezone,
        local_time_iso: f.user.local_time_iso,
        is_new_accountability_day:
          args.strategy_card.server_truth_summary.is_new_accountability_day ?? true,
        local_daypart: localDaypart,
        ...(timingCopyGuidance.length ? { timing_copy_guidance: timingCopyGuidance } : {}),
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
        summary_line: truncateText(cal.truth_summary_for_writer, 200),
      },
      claims: buildAuthoritativeClaims(args.strategy_card, cal),
      posture: deriveBriefPosture(f),
      silence_note:
        f.accountability.unanswered_checks > 0
          ? truncateText(
              `${f.accountability.unanswered_checks} recent check(s) without user outcome`,
              120
            )
          : null,
    },
    recent_exact_thread: {
      ...args.thread.window,
      messages: args.thread.messages,
      message_count: args.thread.message_count,
      char_count: args.thread.char_count,
    },
    freshness: {
      avoid_phrases: args.freshness_phrases.slice(0, 3),
      note: "Same goal is fine — choose a different honest next step.",
    },
    open_loops: buildOpenLoopsForBrief({ facts: f, commitmentRow: args.commitmentRow }),
    suggested_move: buildSuggestedMoveFromDailyC1Card(args.strategy_card, cal),
    durable_relationship_memory: buildDurableRelationshipMemoryForBrief({
      facts: f,
      calibration: cal,
    }),
    style_guardrails: {
      one_sms: true,
      no_robot_menu: true,
      no_fake_pat_quotes: true,
      no_generic_motivation: true,
      summaries_background_only: true,
    },
  };
}

export function buildDailySmsBriefSystemPrompt(args: {
  maxChars: number;
  zeroQuestionMode: boolean;
  pendingPlanActive: boolean;
  goalEvolutionInvite: boolean;
}): string {
  const questionLine = args.zeroQuestionMode
    ? "Write one statement-only coaching touch — no question mark, no hidden ask."
    : "At most one question, or one concrete action.";
  const extras: string[] = [];
  if (args.pendingPlanActive) {
    extras.push("- Pending plan proof is active: close the plan loop before a fresh accountability ask.");
  }
  if (args.goalEvolutionInvite) {
    extras.push("- Goal evolution invite is allowed only as a soft invitation — no goal mutation.");
  }

  return `You are Coach Pat writing the next SMS in one long coaching relationship.

Use DAILY_SMS_WRITING_BRIEF_V1 as server truth. Write one human SMS.
Authority order: authoritative_truth + recent_exact_thread > open_loops > suggested_move > durable_relationship_memory.
suggested_move is a hint only — never override proof truth or exact thread.
durable_relationship_memory is background only — never proof.
${questionLine}
One SMS, max ${args.maxChars} characters, no newlines. No robot menu (Reply YES/NO). No fake Pat quotes. No generic motivation filler.
${extras.join("\n")}

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

export function dailyWritingBriefTelemetry(args: {
  brief: DailySmsWritingBriefV1;
  writer_system_chars: number;
  writer_payload_chars: number;
  writer_total_chars: number;
}): Record<string, unknown> {
  return {
    daily_writing_brief_version: DAILY_SMS_WRITING_BRIEF_VERSION,
    daily_writing_brief_used: true,
    writer_prompt_path: "daily_writing_brief_v1",
    writer_system_chars: args.writer_system_chars,
    writer_payload_chars: args.writer_payload_chars,
    writer_total_chars: args.writer_total_chars,
    daily_freshness_avoid_count: args.brief.freshness.avoid_phrases.length,
    daily_brief_thread_message_count: args.brief.recent_exact_thread.message_count,
    daily_brief_thread_char_count: args.brief.recent_exact_thread.char_count,
  };
}
