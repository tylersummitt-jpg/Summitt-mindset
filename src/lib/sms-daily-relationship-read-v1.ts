/**
 * DailySmsRelationshipReadV1 — deterministic human-continuity layer for C1 daily brief.
 * Interpretive only — never authorizes proof, state, or goal changes.
 */

import type { RecentExactThreadBriefMessage } from "@/lib/sms-recent-exact-thread-72h";
import type { SilenceCadenceRoute } from "@/lib/sms-silence-cadence-v1";
import { SILENCE_CADENCE_ROUTE_CARDS } from "@/lib/sms-silence-cadence-v1";
import {
  isAmbiguousRelatedProgressRelationshipMeaning,
  isAmbiguousRelatedProgressResponseIntent,
  isCoachingFitFeedbackRelationshipMeaning,
  isCoachingFitFeedbackResponseIntent,
} from "@/lib/openai-relationship-turn-understanding-v1";

export type RelationshipReadLocalDaypart = "morning" | "afternoon" | "evening" | "late_night";

export type RelationshipReadSuggestedMoveInput = {
  move: string;
  reason: string;
  max_questions: 0 | 1;
};

export type RelationshipReadFreshnessPhrase = {
  phrase: string;
  source_body_preview?: string;
  at_local?: string | null;
};

export const DAILY_RELATIONSHIP_READ_AUTHORITY = "paraphrase_only_not_copy" as const;

export type DailySmsRelationshipReadV1 = {
  authority: typeof DAILY_RELATIONSHIP_READ_AUTHORITY;
  latest_user_signal: string | null;
  callback_worth_using: string | null;
  what_would_make_user_feel_known: string | null;
  today_best_move: string | null;
  avoid_because_user_corrected_us: string[];
  bad_old_coach_copy_warning: string | null;
  possible_current_standard_conflict: string | null;
  silence_route_human_read: string | null;
  send_target_day_context: string | null;
};

const CAP = {
  latest_user_signal: 160,
  callback_worth_using: 80,
  what_would_make_user_feel_known: 120,
  today_best_move: 140,
  avoid_item: 100,
  avoid_max: 2,
  bad_old_coach_copy_warning: 140,
  possible_current_standard_conflict: 160,
  silence_route_human_read: 140,
  send_target_day_context: 120,
} as const;

function clip(s: string, max: number): string {
  const t = s.trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function userMessagesFromThread(
  messages: RecentExactThreadBriefMessage[]
): RecentExactThreadBriefMessage[] {
  return messages.filter((m) => m.role === "user" && m.body.trim());
}

const CORRECTION_RE =
  /\b(?:no more|we changed|not \w+|we finished|remember we changed|that's not|that is not|i said|stop saying|instead of|don't say|do not say|don't mention|do not mention)\b/i;

const MEAL_CALLBACK_RE =
  /\b(?:lunch|breakfast|dinner|eat(?:ing)?|meal|snack|grab (?:a )?bite)\b/i;

const LIST_CALLBACK_RE = /\b(?:made a list|my list|the list|story list|choose the first)\b/i;

const STRESS_CALLBACK_RE = /\b(?:anxious|anxiety|stressed|stress|overwhelm(?:ed)?)\b/i;

const LET_THEM_RE = /\blet them\b/i;

const TRAVEL_CALLBACK_RE = /\b(?:travel(?:ing|led)?|holiday|vacation|trip|flight)\b/i;

const BUSY_CREATING_RE = /\b(?:busy creating|creating content|recording|filming)\b/i;

const PROOF_SIGNAL_RE =
  /\b(?:yes|done|finished|completed|got it in|did it|hit \d|steps|proof)\b/i;

const BLOCKER_SIGNAL_RE =
  /\b(?:can't|cannot|didn't|did not|not yet|stuck|blocked|hard time|struggling)\b/i;

const SILENCE_EXPLAIN_RE =
  /\b(?:sorry|been quiet|haven't replied|didn't reply|traveling|busy week|life got)\b/i;

function scoreUserMessage(body: string): number {
  let score = 0;
  if (CORRECTION_RE.test(body)) score += 100;
  if (PROOF_SIGNAL_RE.test(body)) score += 60;
  if (BLOCKER_SIGNAL_RE.test(body)) score += 50;
  if (MEAL_CALLBACK_RE.test(body)) score += 45;
  if (LIST_CALLBACK_RE.test(body)) score += 45;
  if (STRESS_CALLBACK_RE.test(body)) score += 40;
  if (SILENCE_EXPLAIN_RE.test(body)) score += 35;
  if (BUSY_CREATING_RE.test(body)) score += 30;
  if (TRAVEL_CALLBACK_RE.test(body)) score += 30;
  if (LET_THEM_RE.test(body)) score += 25;
  if (body.length >= 20) score += 10;
  return score;
}

function distillLatestUserSignal(
  messages: RecentExactThreadBriefMessage[],
  openLoopsLatestAnswer: string | null | undefined
): string | null {
  const users = userMessagesFromThread(messages);
  if (users.length === 0) {
    if (openLoopsLatestAnswer?.trim()) {
      return clip(`Prior answer: ${openLoopsLatestAnswer.trim()}`, CAP.latest_user_signal);
    }
    return null;
  }

  const recent = users.slice(-3);
  const ranked = [...recent].sort(
    (a, b) => scoreUserMessage(b.body) - scoreUserMessage(a.body) || b.body.length - a.body.length
  );
  const best = ranked[0]!;
  const body = best.body.trim();

  if (CORRECTION_RE.test(body)) {
    return clip(`User corrected: ${body}`, CAP.latest_user_signal);
  }
  if (PROOF_SIGNAL_RE.test(body) && body.length < 80) {
    return clip(`User reported progress: ${body}`, CAP.latest_user_signal);
  }
  if (BLOCKER_SIGNAL_RE.test(body)) {
    return clip(`User friction: ${body}`, CAP.latest_user_signal);
  }
  if (MEAL_CALLBACK_RE.test(body)) {
    return clip(`User timing/life: ${body}`, CAP.latest_user_signal);
  }
  if (body.length <= 120) {
    return clip(body, CAP.latest_user_signal);
  }
  return clip(body, CAP.latest_user_signal);
}

function extractCallbackWorthUsing(args: {
  messages: RecentExactThreadBriefMessage[];
  anchorNames: string[];
  latestUserSignal: string | null;
}): string | null {
  const scan = [
    ...userMessagesFromThread(args.messages)
      .slice(-3)
      .map((m) => m.body),
    args.latestUserSignal ?? "",
  ]
    .join(" ")
    .trim();

  if (!scan) return null;

  const mealSpecific =
    scan.match(/\b(?:lunch|breakfast|dinner|brunch)\b/i)?.[0] ??
    scan.match(/\b(?:meal|snack)\b/i)?.[0] ??
    scan.match(/\b(?:eating|grab (?:a )?bite)\b/i)?.[0];
  if (mealSpecific) {
    return clip(mealSpecific, CAP.callback_worth_using);
  }
  if (LIST_CALLBACK_RE.test(scan)) {
    return clip("made a list", CAP.callback_worth_using);
  }
  if (LET_THEM_RE.test(scan)) {
    return clip("Let Them", CAP.callback_worth_using);
  }
  if (STRESS_CALLBACK_RE.test(scan)) {
    return clip("stress/anxiety situation", CAP.callback_worth_using);
  }
  if (TRAVEL_CALLBACK_RE.test(scan)) {
    return clip("travel/holiday", CAP.callback_worth_using);
  }
  if (BUSY_CREATING_RE.test(scan)) {
    return clip("busy creating", CAP.callback_worth_using);
  }

  for (const name of args.anchorNames) {
    if (name && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(scan)) {
      return clip(name, CAP.callback_worth_using);
    }
  }

  if (CORRECTION_RE.test(scan)) {
    const phrase = scan.match(/\bno more\s+[^.;!?]{3,40}/i)?.[0];
    if (phrase) return clip(phrase, CAP.callback_worth_using);
  }

  return null;
}

function buildFeelKnownInstruction(args: {
  latestUserSignal: string | null;
  callback: string | null;
  avoidCorrections: string[];
  openQuestionPending: boolean;
}): string | null {
  if (args.avoidCorrections.length > 0) {
    return clip("honor_correction", CAP.what_would_make_user_feel_known);
  }
  if (args.callback && MEAL_CALLBACK_RE.test(args.callback)) {
    return clip("light_meal_callback", CAP.what_would_make_user_feel_known);
  }
  if (args.callback && LIST_CALLBACK_RE.test(args.callback)) {
    return clip("ack_list_then_rep", CAP.what_would_make_user_feel_known);
  }
  if (args.latestUserSignal && CORRECTION_RE.test(args.latestUserSignal)) {
    return clip("heard_correction", CAP.what_would_make_user_feel_known);
  }
  if (args.openQuestionPending) {
    return clip("close_open_loop", CAP.what_would_make_user_feel_known);
  }
  if (args.latestUserSignal) {
    return clip("brief_continuity", CAP.what_would_make_user_feel_known);
  }
  return null;
}

const SILENCE_ROUTE_FOCUS_TOKEN: Partial<Record<SilenceCadenceRoute, string>> = {
  soft_reentry_day3: "doorway_back",
  clean_reset_day4: "reset_after_silence",
  cant_coach_silence_day5: "confirm_still_in",
  find_obstacle_day6: "name_blocker",
  recommit_or_adjust_day7: "recommit_or_adjust",
  pat_style_challenge_day8: "challenge_drift",
  relationship_check_day10: "confirm_still_in",
  honest_decision_day12: "recommit_or_adjust",
  final_daily_mode_day14: "final_daily_mode",
  weekly_reentry_day21: "warm_reentry",
};

const SILENCE_ROUTE_HUMAN_READ: Partial<Record<SilenceCadenceRoute, string>> = {
  soft_reentry_day3: "doorway_back",
  clean_reset_day4: "reset_after_silence",
  cant_coach_silence_day5: "confirm_still_in",
  find_obstacle_day6: "name_blocker",
  recommit_or_adjust_day7: "recommit_or_adjust",
  pat_style_challenge_day8: "challenge_drift",
  relationship_check_day10: "honest_relationship_check",
  honest_decision_day12: "goal_still_matters",
  final_daily_mode_day14: "final_daily_mode",
  weekly_reentry_day21: "warm_reentry",
};

function buildSilenceRouteHumanRead(route: SilenceCadenceRoute | null | undefined): string | null {
  if (!route || route === "normal_daily") return null;
  const mapped = SILENCE_ROUTE_HUMAN_READ[route];
  if (mapped) return clip(mapped, CAP.silence_route_human_read);
  const card = SILENCE_CADENCE_ROUTE_CARDS[route];
  if (card?.writer_purpose) {
    return clip(card.writer_purpose, CAP.silence_route_human_read);
  }
  return null;
}

function moveTokenToPlainEnglish(
  move: string,
  reason: string,
  args: {
    silenceRoute: SilenceCadenceRoute | null | undefined;
    pendingPlanActive: boolean;
    openQuestionPending: boolean;
    praiseLevel: string;
    weeklyReflectionInThread: boolean;
    normalDailyTarget: boolean;
    maxQuestions: 0 | 1;
  }
): string {
  if (args.silenceRoute && args.silenceRoute !== "normal_daily") {
    const token = SILENCE_ROUTE_FOCUS_TOKEN[args.silenceRoute];
    if (token) return clip(token, CAP.today_best_move);
  }

  if (args.weeklyReflectionInThread && args.normalDailyTarget) {
    return clip("daily_not_weekly", CAP.today_best_move);
  }

  if (args.pendingPlanActive) {
    return clip("close_plan_loop", CAP.today_best_move);
  }

  if (args.openQuestionPending && args.maxQuestions === 0) {
    return clip("close_loop", CAP.today_best_move);
  }

  const token = move.trim().toLowerCase();

  if (token === "hold_standard") {
    if (args.praiseLevel === "none" || args.praiseLevel === "capability_only") {
      return clip("hold_standard_no_hype", CAP.today_best_move);
    }
    return clip("ask_first_rep", CAP.today_best_move);
  }
  if (token === "recover_today") {
    return clip("reset_after_miss", CAP.today_best_move);
  }
  if (token === "clarify") {
    return clip("clarify_once", CAP.today_best_move);
  }
  if (token === "celebrate_proof") {
    return clip("proof_not_promise", CAP.today_best_move);
  }
  if (token === "invite_goal_evolution") {
    return clip("soft_goal_invite", CAP.today_best_move);
  }

  return clip("ask_first_rep", CAP.today_best_move);
}

function detectAvoidBecauseUserCorrected(args: {
  messages: RecentExactThreadBriefMessage[];
  satisfiedDoNotRepeat: string[];
  threadFreshnessDoNotReask: string[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (line: string) => {
    const t = clip(line, CAP.avoid_item);
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key) || out.length >= CAP.avoid_max) return;
    seen.add(key);
    out.push(t);
  };

  for (const m of userMessagesFromThread(args.messages).slice(-5)) {
    if (!CORRECTION_RE.test(m.body)) continue;
    push("correction:do_not_repeat");
    if (out.length >= CAP.avoid_max) break;
  }

  for (const item of [...args.satisfiedDoNotRepeat, ...args.threadFreshnessDoNotReask]) {
    if (!item.trim()) continue;
    push("dnr:do_not_reask");
    if (out.length >= CAP.avoid_max) break;
  }

  return out;
}

function detectStandardConflict(args: {
  messages: RecentExactThreadBriefMessage[];
  effectiveAsk: string;
  behaviorStatement: string | null | undefined;
}): string | null {
  const standardBlob = `${args.effectiveAsk} ${args.behaviorStatement ?? ""}`.toLowerCase();
  if (!standardBlob.trim()) return null;

  const users = userMessagesFromThread(args.messages).slice(-5);
  for (const m of users) {
    const body = m.body.trim();
    if (!CORRECTION_RE.test(body) && !/\b(?:finished|we're done|we are done|changed to)\b/i.test(body)) {
      continue;
    }

    const finishedMatch = body.match(/\b(?:no more|finished|we're done with|we are done with)\s+([^.;!?]{3,60})/i);
    if (finishedMatch) {
      const topic = finishedMatch[1]!.trim().toLowerCase();
      const tokens = topic.split(/\s+/).filter((w) => w.length > 3);
      for (const tok of tokens) {
        if (standardBlob.includes(tok)) {
          return clip(
            `User says "${finishedMatch[0]!.trim()}" but current_standard still references that topic — do not pretend the goal changed.`,
            CAP.possible_current_standard_conflict
          );
        }
      }
    }

    const notMatch = body.match(/\bnot\s+([^.;!?]{3,50})/i);
    if (notMatch) {
      const negated = notMatch[1]!.trim().toLowerCase();
      const negTokens = negated.split(/\s+/).filter((w) => w.length > 3);
      for (const tok of negTokens) {
        if (standardBlob.includes(tok)) {
          return clip(
            `User corrected wording around "${tok}" — current_standard label may still say it; honor their words without claiming a goal change.`,
            CAP.possible_current_standard_conflict
          );
        }
      }
    }
  }

  return null;
}

function detectBadOldCoachCopyWarning(args: {
  freshnessPhrases: RelationshipReadFreshnessPhrase[];
  messages: RecentExactThreadBriefMessage[];
  avoidCorrections: string[];
}): string | null {
  if (args.freshnessPhrases.length > 0) {
    const preview = args.freshnessPhrases
      .slice(0, 2)
      .map((p) => p.phrase)
      .filter(Boolean)
      .join("; ");
    return clip(
      preview
        ? `Recent coach messages repeated stale wording (${preview}); use thread for truth, not coach copy style.`
        : "Recent coach messages repeated stale wording; use thread for truth, not coach copy style.",
      CAP.bad_old_coach_copy_warning
    );
  }

  const coachBodies = args.messages.filter((m) => m.role === "coach").map((m) => m.body.trim());
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  for (let i = 0; i < coachBodies.length; i++) {
    for (let j = i + 1; j < coachBodies.length; j++) {
      if (norm(coachBodies[i]!) === norm(coachBodies[j]!)) {
        return clip(
          "Recent coach messages repeated the same ask — do not mirror that wording.",
          CAP.bad_old_coach_copy_warning
        );
      }
    }
  }

  if (args.avoidCorrections.some((a) => /corrected|do not repeat/i.test(a))) {
    return clip(
      "User corrected recent coach wording — do not imitate older coach messages in the thread.",
      CAP.bad_old_coach_copy_warning
    );
  }

  return null;
}

function buildSendTargetDayContext(args: {
  localDaypart: RelationshipReadLocalDaypart;
  isNewAccountabilityDay: boolean;
  targetDate: string;
  timingCopyGuidance: string[];
}): string | null {
  const parts: string[] = [
    `This SMS is for accountability day ${args.targetDate}; do not confuse generation time with the user-facing day.`,
  ];

  if (args.localDaypart === "morning") {
    parts.push("Morning/prospective framing: do not imply today's outcome already happened.");
  } else if (args.localDaypart === "evening" || args.localDaypart === "late_night") {
    parts.push("Evening send: avoid pitching wide-open today plans; prefer tomorrow's move when needed.");
  }

  if (args.isNewAccountabilityDay) {
    parts.push("New accountability day — fresh daily touch, not a recap sermon.");
  }

  if (args.timingCopyGuidance.some((g) => /tomorrow/i.test(g))) {
    parts.push("Avoid tomorrow unless the user's own plan requires it.");
  }

  return clip(parts.join(" "), CAP.send_target_day_context);
}

function detectWeeklyReflectionInThread(messages: RecentExactThreadBriefMessage[]): boolean {
  return messages.some(
    (m) =>
      m.role === "coach" &&
      /\b(?:weekly|this week|week in review|week reflection|pat pause)\b/i.test(m.body)
  );
}

export type AssembledTurnSemanticsForRead = {
  relationship_meaning?: string | null;
  response_intent?: string | null;
  evidence_preview?: string | null;
};

export type BuildDailySmsRelationshipReadV1Args = {
  messages: RecentExactThreadBriefMessage[];
  effectiveAsk: string;
  behaviorStatement?: string | null;
  localDaypart: RelationshipReadLocalDaypart;
  targetDate: string;
  isNewAccountabilityDay: boolean;
  timingCopyGuidance: string[];
  silenceRoute: SilenceCadenceRoute | null | undefined;
  freshnessPhrases: RelationshipReadFreshnessPhrase[];
  openLoops: {
    latest_answer?: string | null;
    open_question_pending?: boolean;
    satisfied_do_not_repeat?: string[];
    thread_freshness_do_not_reask?: string[];
    pending_plan_active?: boolean;
  };
  suggestedMove: RelationshipReadSuggestedMoveInput;
  praiseAllowedLevel: string;
  anchorNames: string[];
  routeKind: string;
  /** Authoritative assembled TU semantics — not raw phrase matching. */
  assembledTurnSemantics?: AssembledTurnSemanticsForRead | null;
};

export function buildDailySmsRelationshipReadV1(
  args: BuildDailySmsRelationshipReadV1Args
): DailySmsRelationshipReadV1 {
  const latest_user_signal = distillLatestUserSignal(
    args.messages,
    args.openLoops.latest_answer
  );

  const avoid_because_user_corrected_us = detectAvoidBecauseUserCorrected({
    messages: args.messages,
    satisfiedDoNotRepeat: args.openLoops.satisfied_do_not_repeat ?? [],
    threadFreshnessDoNotReask: args.openLoops.thread_freshness_do_not_reask ?? [],
  });

  const callback_worth_using = extractCallbackWorthUsing({
    messages: args.messages,
    anchorNames: args.anchorNames,
    latestUserSignal: latest_user_signal,
  });

  const what_would_make_user_feel_known = buildFeelKnownInstruction({
    latestUserSignal: latest_user_signal,
    callback: callback_worth_using,
    avoidCorrections: avoid_because_user_corrected_us,
    openQuestionPending: args.openLoops.open_question_pending === true,
  });

  const normalDailyTarget =
    (!args.silenceRoute || args.silenceRoute === "normal_daily") &&
    args.routeKind === "main_active_accountability";

  const today_best_move = moveTokenToPlainEnglish(
    args.suggestedMove.move,
    args.suggestedMove.reason,
    {
      silenceRoute: args.silenceRoute,
      pendingPlanActive: args.openLoops.pending_plan_active === true,
      openQuestionPending: args.openLoops.open_question_pending === true,
      praiseLevel: args.praiseAllowedLevel,
      weeklyReflectionInThread: detectWeeklyReflectionInThread(args.messages),
      normalDailyTarget,
      maxQuestions: args.suggestedMove.max_questions,
    }
  );

  const bad_old_coach_copy_warning = detectBadOldCoachCopyWarning({
    freshnessPhrases: args.freshnessPhrases,
    messages: args.messages,
    avoidCorrections: avoid_because_user_corrected_us,
  });

  const possible_current_standard_conflict = detectStandardConflict({
    messages: args.messages,
    effectiveAsk: args.effectiveAsk,
    behaviorStatement: args.behaviorStatement,
  });

  const silence_route_human_read = buildSilenceRouteHumanRead(args.silenceRoute);

  const send_target_day_context = buildSendTargetDayContext({
    localDaypart: args.localDaypart,
    isNewAccountabilityDay: args.isNewAccountabilityDay,
    targetDate: args.targetDate,
    timingCopyGuidance: args.timingCopyGuidance,
  });

  const coachingFitUnresolved =
    isCoachingFitFeedbackRelationshipMeaning(args.assembledTurnSemantics?.relationship_meaning) ||
    isCoachingFitFeedbackResponseIntent(args.assembledTurnSemantics?.response_intent);

  if (coachingFitUnresolved) {
    const fitSignal =
      args.assembledTurnSemantics?.evidence_preview?.trim() || latest_user_signal;
    const fitAvoid = [...avoid_because_user_corrected_us];
    const fitToken = clip("coaching_fit:unresolved", CAP.avoid_item);
    if (fitToken && !fitAvoid.some((a) => a.toLowerCase() === fitToken.toLowerCase())) {
      fitAvoid.unshift(fitToken);
    }
    return {
      authority: DAILY_RELATIONSHIP_READ_AUTHORITY,
      latest_user_signal: fitSignal ? clip(fitSignal, CAP.latest_user_signal) : latest_user_signal,
      callback_worth_using,
      what_would_make_user_feel_known: clip("repair_fit", CAP.what_would_make_user_feel_known),
      today_best_move: clip("repair_fit_before_accountability", CAP.today_best_move),
      avoid_because_user_corrected_us: fitAvoid.slice(0, CAP.avoid_max),
      bad_old_coach_copy_warning,
      possible_current_standard_conflict,
      silence_route_human_read,
      send_target_day_context,
    };
  }

  const ambiguousRelatedProgress =
    isAmbiguousRelatedProgressRelationshipMeaning(
      args.assembledTurnSemantics?.relationship_meaning
    ) ||
    isAmbiguousRelatedProgressResponseIntent(args.assembledTurnSemantics?.response_intent);

  if (ambiguousRelatedProgress) {
    const progressSignal =
      args.assembledTurnSemantics?.evidence_preview?.trim() || latest_user_signal;
    return {
      authority: DAILY_RELATIONSHIP_READ_AUTHORITY,
      latest_user_signal: progressSignal
        ? clip(progressSignal, CAP.latest_user_signal)
        : latest_user_signal,
      callback_worth_using,
      what_would_make_user_feel_known: clip(
        "concretize_related_effort",
        CAP.what_would_make_user_feel_known
      ),
      today_best_move: clip("clarify_before_drift", CAP.today_best_move),
      avoid_because_user_corrected_us,
      bad_old_coach_copy_warning,
      possible_current_standard_conflict,
      silence_route_human_read,
      send_target_day_context,
    };
  }

  return {
    authority: DAILY_RELATIONSHIP_READ_AUTHORITY,
    latest_user_signal,
    callback_worth_using,
    what_would_make_user_feel_known,
    today_best_move,
    avoid_because_user_corrected_us,
    bad_old_coach_copy_warning,
    possible_current_standard_conflict,
    silence_route_human_read,
    send_target_day_context,
  };
}

/** Compact open_loops for writer when relationship_read carries human summary. */
export function compactOpenLoopsForRelationshipRead(
  openLoops: BuildDailySmsRelationshipReadV1Args["openLoops"] & {
    active_pending_kinds?: string[];
    latest_open_question?: string | null;
    goal_evolution_invite?: { should_invite: boolean; invite_kind?: string | null; invite_reason?: string | null } | null;
    pending_plan_summary?: string | null;
    pending_plan_for_day_key?: string | null;
    timing_anchor?: {
      active: boolean;
      confidence_level: string | null;
      anchor_phrase_hint: string | null;
    };
  },
  hasLatestUserSignal: boolean
): BuildDailySmsRelationshipReadV1Args["openLoops"] & Record<string, unknown> {
  const activeKinds = openLoops.active_pending_kinds?.slice(0, 3);
  return {
    ...(activeKinds?.length ? { active_pending_kinds: activeKinds } : {}),
    latest_open_question: openLoops.latest_open_question ?? null,
    ...(hasLatestUserSignal ? {} : { latest_answer: openLoops.latest_answer ?? null }),
    open_question_pending: openLoops.open_question_pending ?? false,
    ...(openLoops.satisfied_do_not_repeat?.length
      ? { satisfied_do_not_repeat: openLoops.satisfied_do_not_repeat.slice(0, 2) }
      : {}),
    pending_plan_active: openLoops.pending_plan_active === true,
    ...(openLoops.pending_plan_active && openLoops.pending_plan_summary
      ? { pending_plan_summary: openLoops.pending_plan_summary }
      : {}),
    ...(openLoops.pending_plan_active && openLoops.pending_plan_for_day_key?.trim()
      ? { pending_plan_for_day_key: openLoops.pending_plan_for_day_key.trim() }
      : {}),
    goal_evolution_invite: openLoops.goal_evolution_invite ?? null,
    ...(openLoops.thread_freshness_do_not_reask?.length
      ? { thread_freshness_do_not_reask: openLoops.thread_freshness_do_not_reask.slice(0, 2) }
      : {}),
    ...(openLoops.timing_anchor ? { timing_anchor: openLoops.timing_anchor } : {}),
  };
}
