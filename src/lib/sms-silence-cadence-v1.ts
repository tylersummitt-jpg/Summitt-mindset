/**
 * Silence Cadence V1 — single outbound silence/re-entry authority for daily SMS.
 * Based on days since ANY normal user reply (not outcome spine).
 */

import { wholeCalendarDaysBetweenDayKeys } from "@/lib/v2-cadence";
import { getLocalDayKeyForTimestamp } from "@/lib/sms-temporal-contract-v1";

export type SilenceCadenceRoute =
  | "normal_daily"
  | "soft_reentry_day3"
  | "clean_reset_day4"
  | "cant_coach_silence_day5"
  | "find_obstacle_day6"
  | "recommit_or_adjust_day7"
  | "pat_style_challenge_day8"
  | "no_send_space_day9"
  | "relationship_check_day10"
  | "no_send_space_day11"
  | "honest_decision_day12"
  | "no_send_space_day13"
  | "final_daily_mode_day14"
  | "dormant_no_send_days15_20"
  | "weekly_reentry_day21"
  | "weekly_identity_day28"
  | "weekly_value_check_day35"
  | "dormant_no_send_other";

export type SilenceCadenceCurrentStandardRef = "yes" | "light" | "general" | "none";

export type SilenceCadenceRouteCard = {
  route_card_id: string;
  strategy: string;
  tone: string;
  writer_purpose: string;
  max_questions: number;
  allow_goal_adjustment_language: boolean;
  current_standard_reference: SilenceCadenceCurrentStandardRef;
  must_do: string[];
  must_not_do: string[];
  example_shape_id: string | null;
};

export type SilenceCadenceV1Result = {
  route: SilenceCadenceRoute;
  silence_day: number;
  send_today: boolean;
  no_send_reason: string | null;
  route_card_id: string;
};

export type DailySilenceCadenceFacts = {
  route: SilenceCadenceRoute;
  silence_day: number;
  send_today: boolean;
  no_send_reason: string | null;
};

/**
 * Shared hard safety for silence routes — referenced once in the prompt appendix.
 * Style phrase bans live in the daily system voice principle, not on every card.
 */
export const SILENCE_CADENCE_SHARED_HARD_SAFETY = [
  "do not guilt or shame",
  "do not beg",
  "do not insult",
  "do not be sarcastic",
  "do not sound passive aggressive",
  "do not sound customer-servicey",
  "do not mention apps, websites, Victory Room, Change Goal, Update Goal, or menu directions",
  "do not copy example shapes verbatim",
] as const;

export const SILENCE_CADENCE_ROUTE_CARDS: Record<SilenceCadenceRoute, SilenceCadenceRouteCard> = {
  normal_daily: {
    route_card_id: "normal_daily",
    strategy: "standard_accountability",
    tone: "normal",
    writer_purpose: "hold standard daily coaching",
    max_questions: 1,
    allow_goal_adjustment_language: false,
    current_standard_reference: "yes",
    must_do: ["follow current_standard"],
    must_not_do: [],
    example_shape_id: null,
  },
  soft_reentry_day3: {
    route_card_id: "soft_reentry_day3",
    strategy: "easy_doorway_back",
    tone: "firm_not_heavy",
    writer_purpose: "easy doorway back without lecture",
    max_questions: 1,
    allow_goal_adjustment_language: false,
    current_standard_reference: "light",
    must_do: [
      "acknowledge they do not need a long explanation",
      "ask one honest sentence about where things stand today",
    ],
    must_not_do: ["do not lecture or stack accountability asks"],
    example_shape_id: "shape_day3",
  },
  clean_reset_day4: {
    route_card_id: "clean_reset_day4",
    strategy: "clean_reset_with_standard",
    tone: "direct_dignified",
    writer_purpose: "start fresh with standard, no guilt",
    max_questions: 1,
    allow_goal_adjustment_language: false,
    current_standard_reference: "yes",
    must_do: [
      "remove guilt",
      "remind them they made a commitment",
      "ask one thing they can do today",
    ],
    must_not_do: ["do not say it is okay if you are not ready"],
    example_shape_id: "shape_day4",
  },
  cant_coach_silence_day5: {
    route_card_id: "cant_coach_silence_day5",
    strategy: "name_relationship_cannot_coach_silence",
    tone: "honest_firm_coach_like",
    writer_purpose: "say coaching requires response",
    max_questions: 1,
    allow_goal_adjustment_language: false,
    current_standard_reference: "light",
    must_do: [
      "be honest that coaching requires response",
      "ask what needs to happen to get back on track",
    ],
    must_not_do: ["do not pile on missed-day shame"],
    example_shape_id: "shape_day5",
  },
  find_obstacle_day6: {
    route_card_id: "find_obstacle_day6",
    strategy: "diagnose_blocker",
    tone: "tough_practical",
    writer_purpose: "ask what is actually getting in the way",
    max_questions: 1,
    allow_goal_adjustment_language: false,
    current_standard_reference: "light",
    must_do: ["ask what is actually getting in the way", "ask like a human not a menu"],
    must_not_do: ["do not use multiple choice letters"],
    example_shape_id: "shape_day6",
  },
  recommit_or_adjust_day7: {
    route_card_id: "recommit_or_adjust_day7",
    strategy: "force_clarity_recommit_or_adjust",
    tone: "firm_fair",
    writer_purpose: "honest recommit-or-adjust check",
    max_questions: 1,
    allow_goal_adjustment_language: true,
    current_standard_reference: "yes",
    must_do: [
      "ask one spoken question: recommit to this goal or adjust it",
      "hold the standard without guilt",
    ],
    must_not_do: ["do not turn the ask into an app or menu direction"],
    example_shape_id: "shape_day7",
  },
  pat_style_challenge_day8: {
    route_card_id: "pat_style_challenge_day8",
    strategy: "challenge_drift",
    tone: "tough_clean",
    writer_purpose: "accountability moment before backing off",
    max_questions: 1,
    allow_goal_adjustment_language: false,
    current_standard_reference: "yes",
    must_do: [
      "call out the pattern without attacking the person",
      "ask for the next step they are willing to take today",
    ],
    must_not_do: ["do not say you failed"],
    example_shape_id: "shape_day8",
  },
  no_send_space_day9: {
    route_card_id: "no_send_space_day9",
    strategy: "space_after_challenge",
    tone: "none",
    writer_purpose: "intentional space after challenge",
    max_questions: 0,
    allow_goal_adjustment_language: false,
    current_standard_reference: "none",
    must_do: [],
    must_not_do: [],
    example_shape_id: null,
  },
  relationship_check_day10: {
    route_card_id: "relationship_check_day10",
    strategy: "clarify_relationship",
    tone: "honest_respectful",
    writer_purpose: "honest relationship check",
    max_questions: 1,
    allow_goal_adjustment_language: false,
    current_standard_reference: "light",
    must_do: [
      "be brief and respectful; name the silence briefly",
      "ask one direct whether-they-are-still-in question",
      "hold the standard without guilt",
    ],
    must_not_do: ["do not say unsubscribe if you want"],
    example_shape_id: "shape_day10",
  },
  no_send_space_day11: {
    route_card_id: "no_send_space_day11",
    strategy: "give_space",
    tone: "none",
    writer_purpose: "room to answer relationship check",
    max_questions: 0,
    allow_goal_adjustment_language: false,
    current_standard_reference: "none",
    must_do: [],
    must_not_do: [],
    example_shape_id: null,
  },
  honest_decision_day12: {
    route_card_id: "honest_decision_day12",
    strategy: "decision_point",
    tone: "direct_caring",
    writer_purpose: "decide if coach help still wanted",
    max_questions: 1,
    allow_goal_adjustment_language: true,
    current_standard_reference: "light",
    must_do: [
      "ask one spoken question whether the goal still matters or needs adjusting",
      "hold the standard without guilt",
    ],
    must_not_do: ["do not stack a second accountability ask"],
    example_shape_id: "shape_day12",
  },
  no_send_space_day13: {
    route_card_id: "no_send_space_day13",
    strategy: "let_question_sit",
    tone: "none",
    writer_purpose: "do not cover a real question with another message",
    max_questions: 0,
    allow_goal_adjustment_language: false,
    current_standard_reference: "none",
    must_do: [],
    must_not_do: [],
    example_shape_id: null,
  },
  final_daily_mode_day14: {
    route_card_id: "final_daily_mode_day14",
    strategy: "open_door_with_standard",
    tone: "firm_warm_dignified",
    writer_purpose: "daily chasing stops but relationship stays open",
    max_questions: 0,
    allow_goal_adjustment_language: false,
    current_standard_reference: "general",
    must_do: [
      "say daily chasing is stopping",
      "leave the door open to text when ready for one honest rep",
    ],
    must_not_do: ["do not sound abandoned", "do not say good luck"],
    example_shape_id: "shape_day14",
  },
  dormant_no_send_days15_20: {
    route_card_id: "dormant_no_send_days15_20",
    strategy: "dormant_space",
    tone: "none",
    writer_purpose: "stop throwing the ball",
    max_questions: 0,
    allow_goal_adjustment_language: false,
    current_standard_reference: "none",
    must_do: [],
    must_not_do: [],
    example_shape_id: null,
  },
  weekly_reentry_day21: {
    route_card_id: "weekly_reentry_day21",
    strategy: "warm_accountability",
    tone: "steady",
    writer_purpose: "one honest rep comeback",
    max_questions: 1,
    allow_goal_adjustment_language: false,
    current_standard_reference: "light",
    must_do: ["offer one honest rep", "ask for the next step"],
    must_not_do: ["do not sound needy"],
    example_shape_id: "shape_day21",
  },
  weekly_identity_day28: {
    route_card_id: "weekly_identity_day28",
    strategy: "identity_reminder",
    tone: "firm_encouraging",
    writer_purpose: "next step when life is not easy",
    max_questions: 1,
    allow_goal_adjustment_language: false,
    current_standard_reference: "light",
    must_do: ["remind identity is built in hard moments", "ask if they want to restart today"],
    must_not_do: ["do not lecture about the silent stretch"],
    example_shape_id: "shape_day28",
  },
  weekly_value_check_day35: {
    route_card_id: "weekly_value_check_day35",
    strategy: "final_value_check",
    tone: "honest_respectful",
    writer_purpose: "accountability or change the goal",
    max_questions: 1,
    allow_goal_adjustment_language: true,
    current_standard_reference: "light",
    must_do: ["ask what they want to do about accountability or the goal"],
    must_not_do: ["do not turn the ask into an app or menu direction"],
    example_shape_id: "shape_day35",
  },
  dormant_no_send_other: {
    route_card_id: "dormant_no_send_other",
    strategy: "dormant_space",
    tone: "none",
    writer_purpose: "intentional dormant space",
    max_questions: 0,
    allow_goal_adjustment_language: false,
    current_standard_reference: "none",
    must_do: [],
    must_not_do: [],
    example_shape_id: null,
  },
};

const NO_SEND_ROUTES = new Set<SilenceCadenceRoute>([
  "no_send_space_day9",
  "no_send_space_day11",
  "no_send_space_day13",
  "dormant_no_send_days15_20",
  "dormant_no_send_other",
]);

const NO_SEND_REASON_BY_ROUTE: Partial<Record<SilenceCadenceRoute, string>> = {
  no_send_space_day9: "silence_cadence_space_day9",
  no_send_space_day11: "silence_cadence_space_day11",
  no_send_space_day13: "silence_cadence_space_day13",
  dormant_no_send_days15_20: "silence_cadence_dormant_15_20",
  dormant_no_send_other: "silence_cadence_dormant_other",
};

export function routeForSilenceDay(silenceDay: number): SilenceCadenceRoute {
  if (silenceDay <= 2) return "normal_daily";
  if (silenceDay === 3) return "soft_reentry_day3";
  if (silenceDay === 4) return "clean_reset_day4";
  if (silenceDay === 5) return "cant_coach_silence_day5";
  if (silenceDay === 6) return "find_obstacle_day6";
  if (silenceDay === 7) return "recommit_or_adjust_day7";
  if (silenceDay === 8) return "pat_style_challenge_day8";
  if (silenceDay === 9) return "no_send_space_day9";
  if (silenceDay === 10) return "relationship_check_day10";
  if (silenceDay === 11) return "no_send_space_day11";
  if (silenceDay === 12) return "honest_decision_day12";
  if (silenceDay === 13) return "no_send_space_day13";
  if (silenceDay === 14) return "final_daily_mode_day14";
  if (silenceDay >= 15 && silenceDay <= 20) return "dormant_no_send_days15_20";
  if (silenceDay === 21) return "weekly_reentry_day21";
  if (silenceDay >= 22 && silenceDay <= 27) return "dormant_no_send_other";
  if (silenceDay === 28) return "weekly_identity_day28";
  if (silenceDay >= 29 && silenceDay <= 34) return "dormant_no_send_other";
  if (silenceDay === 35) return "weekly_value_check_day35";
  return "dormant_no_send_other";
}

export function deriveSilenceCadenceV1(args: {
  lastAnyUserReplyAt: string | null;
  neverRepliedAnchorAt: string | null;
  todayLocalDayKey: string;
  timezone: string;
}): SilenceCadenceV1Result {
  const anchorAt = args.lastAnyUserReplyAt ?? args.neverRepliedAnchorAt;
  let silenceDay = 0;

  if (anchorAt?.trim()) {
    const anchorDayKey = getLocalDayKeyForTimestamp(anchorAt, args.timezone);
    silenceDay = wholeCalendarDaysBetweenDayKeys(anchorDayKey, args.todayLocalDayKey);
  }

  const route = routeForSilenceDay(silenceDay);
  const card = SILENCE_CADENCE_ROUTE_CARDS[route];
  const sendToday = !NO_SEND_ROUTES.has(route);
  const noSendReason = sendToday ? null : (NO_SEND_REASON_BY_ROUTE[route] ?? "silence_cadence_no_send");

  return {
    route,
    silence_day: silenceDay,
    send_today: sendToday,
    no_send_reason: noSendReason,
    route_card_id: card.route_card_id,
  };
}

export function toDailySilenceCadenceFacts(result: SilenceCadenceV1Result): DailySilenceCadenceFacts {
  return {
    route: result.route,
    silence_day: result.silence_day,
    send_today: result.send_today,
    no_send_reason: result.no_send_reason,
  };
}

export async function resolveSilenceCadenceForDailyUser(args: {
  clerkUserId: string;
  commitmentId: string;
  commitmentStartedAt: string | null;
  todayLocalDayKey: string;
  timezone: string;
}): Promise<SilenceCadenceV1Result> {
  const { fetchFirstCheckSentAt, fetchLastAnyUserReplyAt } = await import(
    "@/lib/sms-last-any-user-reply"
  );
  const [lastAnyUserReplyAt, firstCheckSentAt] = await Promise.all([
    fetchLastAnyUserReplyAt(args.clerkUserId),
    fetchFirstCheckSentAt(args.commitmentId),
  ]);

  const neverRepliedAnchorAt = firstCheckSentAt ?? args.commitmentStartedAt;

  return deriveSilenceCadenceV1({
    lastAnyUserReplyAt,
    neverRepliedAnchorAt,
    todayLocalDayKey: args.todayLocalDayKey,
    timezone: args.timezone,
  });
}

export function buildSilenceCadenceRouteCardPromptAppendix(route: SilenceCadenceRoute): string {
  if (route === "normal_daily") return "";

  const card = SILENCE_CADENCE_ROUTE_CARDS[route];
  const lines = [
    "SILENCE_CADENCE_ROUTE_CARD (authoritative for silence/re-entry tone and ask — overrides old silence, reentry, reactivation, silence_note, and silence_nudge hints):",
    `route: ${route}`,
    `strategy: ${card.strategy}`,
    `tone: ${card.tone}`,
    `writer_purpose: ${card.writer_purpose}`,
    `max_questions: ${card.max_questions}`,
    `current_standard_reference: ${card.current_standard_reference}`,
    "shared_hard_safety (once — not route-specific style bans):",
    ...SILENCE_CADENCE_SHARED_HARD_SAFETY.map((m) => `- ${m}`),
    "must_do:",
    ...card.must_do.map((m) => `- ${m}`),
    "must_not_do (route-specific only):",
    ...(card.must_not_do.length
      ? card.must_not_do.map((m) => `- ${m}`)
      : ["- (none beyond shared_hard_safety)"]),
  ];
  if (card.example_shape_id) {
    lines.push(`example_shape_id: ${card.example_shape_id} (do not copy verbatim)`);
  }
  lines.push("current_standard still applies alongside this route card.");
  return lines.join("\n");
}

export function buildSilenceCadenceNoSendLaneMeta(
  cadence: SilenceCadenceV1Result
): Record<string, unknown> {
  return {
    silence_cadence_route: cadence.route,
    silence_day: cadence.silence_day,
    send_today: cadence.send_today,
    intentional_space: true,
    no_send_reason: cadence.no_send_reason,
    skip_source: "silence_cadence_no_send",
    lane_stage: "silence_cadence_no_send",
    daily_writer_invoked: false,
  };
}

export function silenceCadenceOverridesOldSilenceRouting(
  cadence: DailySilenceCadenceFacts | null | undefined
): boolean {
  return cadence != null && cadence.route !== "normal_daily";
}
