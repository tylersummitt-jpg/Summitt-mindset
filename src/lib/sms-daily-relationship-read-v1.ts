/**
 * DailySmsRelationshipReadV1 — deterministic human-continuity layer for C1 daily brief.
 * Interpretive only — never authorizes proof, state, or goal changes.
 */

import type { RecentExactThreadBriefMessage } from "@/lib/sms-recent-exact-thread-72h";
import type { SilenceCadenceRoute } from "@/lib/sms-silence-cadence-v1";
import { SILENCE_CADENCE_ROUTE_CARDS } from "@/lib/sms-silence-cadence-v1";

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

export const DAILY_RELATIONSHIP_READ_AUTHORITY = "interpretive_hint_not_proof" as const;

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
    const topic = args.avoidCorrections[0]!;
    return clip(
      `Honor their correction — do not repeat or re-ask about ${topic.replace(/^Do not (?:repeat|mention|re-ask)\s*/i, "").slice(0, 60)}.`,
      CAP.what_would_make_user_feel_known
    );
  }
  if (args.callback && MEAL_CALLBACK_RE.test(args.callback)) {
    return clip(
      "Use lunch/meal as a light callback without guilt or re-asking the standard.",
      CAP.what_would_make_user_feel_known
    );
  }
  if (args.callback && LIST_CALLBACK_RE.test(args.callback)) {
    return clip(
      "Acknowledge the list before giving today's rep — they did planning work.",
      CAP.what_would_make_user_feel_known
    );
  }
  if (args.latestUserSignal && CORRECTION_RE.test(args.latestUserSignal)) {
    return clip(
      "Show you heard the correction — adjust wording, do not argue with server standard labels.",
      CAP.what_would_make_user_feel_known
    );
  }
  if (args.openQuestionPending) {
    return clip(
      "Close the open loop naturally — do not stack another unrelated ask.",
      CAP.what_would_make_user_feel_known
    );
  }
  if (args.latestUserSignal) {
    return clip(
      "Reference their latest words briefly so the text feels continuous, not broadcast.",
      CAP.what_would_make_user_feel_known
    );
  }
  return null;
}

const SILENCE_ROUTE_HUMAN_READ: Partial<Record<SilenceCadenceRoute, string>> = {
  soft_reentry_day3:
    "Easy doorway back: one honest sentence about where things stand — no lecture.",
  clean_reset_day4: "Clean reset: remove guilt, hold the standard, one thing for today.",
  cant_coach_silence_day5:
    "Relationship accountability: coaching requires response — do not give generic reflection.",
  find_obstacle_day6: "Ask what is actually getting in the way — human, not a menu.",
  recommit_or_adjust_day7: "Force clarity: recommit or adjust — one honest choice.",
  pat_style_challenge_day8:
    "Challenge drift cleanly without attacking the person — accountability moment.",
  relationship_check_day10:
    "Honest relationship check: not annoying, but participation is required.",
  honest_decision_day12: "Decision point: does this goal still matter right now?",
  final_daily_mode_day14: "Final daily mode: direct, no soft opt-out language.",
  weekly_reentry_day21: "Warm re-entry: one honest rep, not a big comeback speech.",
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
    const human = buildSilenceRouteHumanRead(args.silenceRoute);
    if (human) return clip(human, CAP.today_best_move);
  }

  if (args.weeklyReflectionInThread && args.normalDailyTarget) {
    return clip(
      "This is the daily accountability text — do not turn it into weekly reflection; one concrete rep for today.",
      CAP.today_best_move
    );
  }

  if (args.pendingPlanActive) {
    return clip(
      "Close the pending plan loop before a fresh accountability ask.",
      CAP.today_best_move
    );
  }

  if (args.openQuestionPending && args.maxQuestions === 0) {
    return clip("Close the loop without another question.", CAP.today_best_move);
  }

  const token = move.trim().toLowerCase();
  const reasonTrim = reason.trim();

  if (token === "hold_standard") {
    if (args.praiseLevel === "none" || args.praiseLevel === "capability_only") {
      return clip(
        "Hold the standard without praising consistency or overstating proof.",
        CAP.today_best_move
      );
    }
    return clip("Give one concrete next rep for today tied to the standard.", CAP.today_best_move);
  }
  if (token === "recover_today") {
    return clip("Acknowledge the miss briefly, then one recoverable move for today.", CAP.today_best_move);
  }
  if (token === "clarify") {
    return clip("Ask one clarifying question only if the thread truly needs it.", CAP.today_best_move);
  }
  if (token === "celebrate_proof") {
    return clip("Acknowledge the specific proof — do not inflate into streak hype.", CAP.today_best_move);
  }
  if (token === "invite_goal_evolution") {
    return clip("Soft invitation to evolve the goal — no mutation in this SMS.", CAP.today_best_move);
  }

  if (reasonTrim && !/\bhold_standard\b/i.test(reasonTrim)) {
    return clip(reasonTrim, CAP.today_best_move);
  }

  return clip("One human coaching touch tied to today's standard.", CAP.today_best_move);
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
    push(`Do not repeat: ${m.body.trim()}`);
    if (out.length >= CAP.avoid_max) break;
  }

  for (const item of [...args.satisfiedDoNotRepeat, ...args.threadFreshnessDoNotReask]) {
    if (!item.trim()) continue;
    push(`Do not re-ask: ${item.trim()}`);
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
    goal_evolution_invite: openLoops.goal_evolution_invite ?? null,
    ...(openLoops.thread_freshness_do_not_reask?.length
      ? { thread_freshness_do_not_reask: openLoops.thread_freshness_do_not_reask.slice(0, 2) }
      : {}),
    ...(openLoops.timing_anchor ? { timing_anchor: openLoops.timing_anchor } : {}),
  };
}
