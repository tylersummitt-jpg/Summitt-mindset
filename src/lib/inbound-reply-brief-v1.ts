/**
 * INBOUND_REPLY_BRIEF_V1 — compact resolved-truth brief for inbound SMS writer.
 */

import type {
  InboundPhase1Route,
  InboundRouteAllowedClaims,
  InboundRouteContract,
} from "@/lib/openai-relationship-turn-understanding-v1";
import {
  buildInboundRouteAllowedClaims,
  isPhase1AuthoritativeRouteContract,
  looksLikeRealHelpRequest,
} from "@/lib/openai-relationship-turn-understanding-v1";
import type {
  InboundV3RelationshipFacts,
  InboundRequiredReplyMove,
} from "@/lib/v3-inbound-relationship-lane";
import type { RecentExactThread72hMessage } from "@/lib/sms-recent-exact-thread-72h";

export const INBOUND_REPLY_BRIEF_VERSION = "inbound_reply_brief_v1" as const;

export type InboundReplyBriefTurnType =
  | "completion_proof"
  | "miss"
  | "partial"
  | "answered_prior_question"
  | "thanks_acknowledgment"
  | "help_request"
  | "false_premise_challenge"
  | "repeated_question_complaint"
  | "timing_context"
  | "reflection"
  | "unclear";

export type InboundReplyBriefGoalStatus =
  | "completed"
  | "missed"
  | "partial"
  | "none"
  | "unclear";

export type InboundReplyBriefReplyMove =
  | "acknowledge_completion_and_close_loop"
  | "ask_one_blocker"
  | "acknowledge_partial_and_next_step"
  | "close_acknowledgment"
  | "give_direct_help"
  | "correct_false_premise"
  | "acknowledge_already_answered"
  | "timing_context_forward"
  | "reflect_and_close"
  | "clarify_once";

export type InboundReplyBriefThreadWindowMessage = {
  role: "coach" | "user";
  at_local?: string;
  body: string;
};

export type InboundReplyBriefV1 = {
  brief_version: typeof INBOUND_REPLY_BRIEF_VERSION;
  latest_user_message: string;
  previous_coach_message: string | null;
  current_goal: string | null;
  local_time_iso: string | null;
  local_daypart: string | null;

  turn_type: InboundReplyBriefTurnType;

  resolved_truth: {
    answered_prior_question: boolean;
    goal_status_from_latest_message: InboundReplyBriefGoalStatus;
    explicit_facts: string[];
  };

  question_policy: {
    followup_question_used_today: boolean;
    max_questions: 0 | 1;
    reason: string;
  };

  reply_strategy: {
    move: InboundReplyBriefReplyMove;
    must_not_do: string[];
  };

  thread_window: InboundReplyBriefThreadWindowMessage[];

  route: InboundPhase1Route;
  should_reply: boolean;
  close_loop: boolean;
  outcome_to_persist: "win" | "miss" | "partial" | "proof" | "none";
  allowed_claims: InboundRouteAllowedClaims;
  facts_to_reflect: string[];
  allow_new_assignment: boolean;
  allow_generic_advice: boolean;
  forbidden_moves: string[];
  phase1_authoritative: boolean;
};

export type InboundReplyBriefV1Log = {
  inbound_reply_brief_version: typeof INBOUND_REPLY_BRIEF_VERSION;
  inbound_reply_brief_turn_type: InboundReplyBriefTurnType;
  inbound_reply_brief_move: InboundReplyBriefReplyMove;
  inbound_reply_brief_max_questions: 0 | 1;
  inbound_followup_question_used_today: boolean;
  inbound_answered_prior_question: boolean;
  inbound_goal_status_from_latest_message: InboundReplyBriefGoalStatus;
  inbound_false_premise_challenge_detected: boolean;
  inbound_help_request_detected: boolean;
  inbound_thanks_acknowledgment_detected: boolean;
  inbound_repeated_question_complaint_detected: boolean;
  inbound_time_of_day_forward_only_detected: boolean;
  inbound_route: InboundPhase1Route;
  inbound_should_reply: boolean;
  inbound_close_loop: boolean;
  inbound_phase1_authoritative: boolean;
};

const THREAD_WINDOW_MAX = 6;

function extractQuestionClause(coachMessage: string): string | null {
  const msg = coachMessage.trim();
  if (!msg) return null;
  const parts = msg.match(/[^?!.]+[?]/g);
  if (parts?.length) return parts[parts.length - 1]!.trim();
  if (/\?/.test(msg) || /\b(what|when|which|who|how|tell me|give me)\b/i.test(msg)) return msg;
  return null;
}

function isDeliveredCoachQuestionMessage(m: RecentExactThread72hMessage): boolean {
  if (m.role !== "coach") return false;
  if (!m.body.trim()) return false;
  if (m.is_exact_body === false) return false;
  return m.delivery_status === "sent";
}

function coachBodyHasQuestion(body: string): boolean {
  return Boolean(extractQuestionClause(body));
}

export function resolveAccountabilityDayKeyForBrief(
  facts: InboundV3RelationshipFacts
): string | null {
  return (
    facts.inbound_meaning.reported_for_day_key?.trim() ||
    facts.inbound_meaning.spoken_local_day_key?.trim() ||
    facts.temporal_contract?.send_day_key?.trim() ||
    facts.temporal_contract?.today_key?.trim() ||
    null
  );
}

export function countFollowupQuestionsAskedOnDay(
  messages: RecentExactThread72hMessage[],
  accountabilityDayKey: string
): number {
  let count = 0;
  for (const m of messages) {
    if (!isDeliveredCoachQuestionMessage(m)) continue;
    if (m.local_day_key !== accountabilityDayKey) continue;
    if (!coachBodyHasQuestion(m.body)) continue;
    count++;
  }
  return count;
}

export function deriveFollowupQuestionUsedToday(args: {
  facts: InboundV3RelationshipFacts;
  accountabilityDayKey: string | null;
}): boolean {
  const dayKey = args.accountabilityDayKey;
  if (!dayKey) return false;
  const messages = args.facts.thread.memory_packet?.recent_exact_thread_72h?.messages ?? [];
  return countFollowupQuestionsAskedOnDay(messages, dayKey) >= 1;
}

function deriveLocalDaypart(localTimeIso: string | null): string | null {
  if (!localTimeIso?.trim()) return null;
  const d = new Date(localTimeIso);
  if (Number.isNaN(d.getTime())) return null;
  const hour = d.getUTCHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

function normText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function looksLikeRepeatedQuestionComplaint(text: string): boolean {
  return (
    /\balready answered\b/i.test(text) ||
    /\bi already (said|told|gave|shared|listed)\b/i.test(text) ||
    /\byou asked (that|this|again)\b/i.test(text) ||
    /\basked (that|this) (again|already)\b/i.test(text) ||
    /\bfirst reply\b/i.test(text)
  );
}

function looksLikeFalsePremiseChallenge(text: string): boolean {
  return (
    /\bhow do you know\b/i.test(text) ||
    /\bwhy do you (think|assume|say)\b/i.test(text) ||
    /\bi didn'?t (do|complete|finish|accomplish)\b/i.test(text) ||
    /\bthat'?s not (true|right|accurate)\b/i.test(text) ||
    /\bwhere did you get that\b/i.test(text) ||
    /\byou said i (did|accomplished|finished|completed)\b/i.test(text)
  );
}

function looksLikeThanksAcknowledgment(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\bthank you\b/i.test(t) && t.length <= 120) return true;
  if (/\bthanks\b/i.test(t) && t.length <= 80) return true;
  if (/\bneeded that\b/i.test(t)) return true;
  if (/\bi appreciate\b/i.test(t) && t.length <= 120) return true;
  return false;
}

function looksLikeTimingContext(text: string): boolean {
  return (
    (/\bnot yet\b/i.test(text) &&
      (/\b\d{1,2}:\d{2}\b/.test(text) ||
        /\b\d{1,2}\s*(am|pm|a\.m\.|p\.m\.)\b/i.test(text) ||
        /\bat work\b/i.test(text) ||
        /\bonly\b/i.test(text))) ||
    (/\b(it'?s|its) only\b/i.test(text) &&
      (/\b\d{1,2}:\d{2}\b/.test(text) || /\b\d{1,2}\s*(am|pm|a\.m\.|p\.m\.)\b/i.test(text))) ||
    (/\btoo early\b/i.test(text) && /\b(not yet|haven'?t|hasn'?t)\b/i.test(text))
  );
}

function looksLikeHelpRequest(text: string): boolean {
  return looksLikeRealHelpRequest(text);
}

function looksLikeCompletionProofWithDetails(text: string): boolean {
  if (text.length < 24) return false;
  const rt = text.trim();
  if (looksLikeHelpRequest(rt)) return false;
  if (looksLikeFalsePremiseChallenge(rt)) return false;
  const hasNamedDetail =
    /\b(is|are|was|were)\b/i.test(rt) ||
    rt.split(/[,;]/).filter((p) => p.trim().length >= 8).length >= 2 ||
    rt.split(/\s+/).filter(Boolean).length >= 12;
  return (
    hasNamedDetail &&
    (/\b(did|done|finished|completed|gave|said|told|listed|shared)\b/i.test(rt) ||
      /\b(super|grateful|joyful|sweet|hero|avenger)\b/i.test(rt))
  );
}

function looksLikeAnsweredPriorQuestion(args: {
  text: string;
  facts: InboundV3RelationshipFacts;
}): boolean {
  const rt = args.facts.inbound_resolved_truth;
  if (rt?.answered_recent_ask || rt?.satisfied_recent_ask) return true;
  if (args.facts.thread.memory_correction_should_use_prior_user_answer) return true;
  if (args.facts.thread.short_ack_should_not_reask_question) return true;
  if (args.facts.inbound_meaning.relationship_meaning === "answer_to_prior_question") return true;
  if (looksLikeRepeatedQuestionComplaint(args.text)) return true;
  const priorCoachQ =
    args.facts.thread.most_recent_coach_question ??
    args.facts.thread.latest_open_question ??
    null;
  if (!priorCoachQ?.trim()) return false;
  const inbound = args.text.trim();
  if (inbound.length < 12) return false;
  if (looksLikeThanksAcknowledgment(inbound) && inbound.length > 80) {
    return /\b(want|need|would like|lateral|core|workout|exercise)\b/i.test(inbound);
  }
  return inbound.length >= 15 && !looksLikeHelpRequest(inbound);
}

function mapGoalStatus(facts: InboundV3RelationshipFacts): InboundReplyBriefGoalStatus {
  const rt = facts.inbound_resolved_truth;
  if (rt?.resolved_outcome === "completed") return "completed";
  if (rt?.resolved_outcome === "missed") return "missed";
  if (rt?.resolved_outcome === "partial") return "partial";
  if (rt?.resolved_outcome === "none") return "none";
  if (facts.inbound_meaning.relationship_meaning === "reported_completion") return "completed";
  if (facts.inbound_meaning.relationship_meaning === "miss") return "missed";
  if (facts.inbound_meaning.relationship_meaning === "partial_attempt") return "partial";
  return "unclear";
}

function mapRequiredReplyMoveToBriefMove(
  move: InboundRequiredReplyMove | undefined,
  turnType: InboundReplyBriefTurnType
): InboundReplyBriefReplyMove {
  if (turnType === "false_premise_challenge") return "correct_false_premise";
  if (turnType === "repeated_question_complaint" || turnType === "answered_prior_question") {
    return "acknowledge_already_answered";
  }
  if (turnType === "thanks_acknowledgment") return "close_acknowledgment";
  if (turnType === "help_request") return "give_direct_help";
  if (turnType === "timing_context") return "timing_context_forward";
  if (turnType === "reflection") return "reflect_and_close";
  if (turnType === "completion_proof") return "acknowledge_completion_and_close_loop";
  if (turnType === "miss") return "ask_one_blocker";
  if (turnType === "partial") return "acknowledge_partial_and_next_step";

  switch (move) {
    case "acknowledge_completion":
      return "acknowledge_completion_and_close_loop";
    case "close_loop_on_answered_ask":
      return "acknowledge_already_answered";
    case "acknowledge_partial":
      return "acknowledge_partial_and_next_step";
    case "acknowledge_miss_without_shame":
    case "acknowledge_blocker":
      return "ask_one_blocker";
    case "acknowledge_reflection":
      return "reflect_and_close";
    case "clarify_once":
      return "clarify_once";
    default:
      return "clarify_once";
  }
}

function deriveTurnType(args: {
  text: string;
  facts: InboundV3RelationshipFacts;
}): InboundReplyBriefTurnType {
  const text = args.text.trim();
  const rt = args.facts.inbound_resolved_truth;
  const routeContract = args.facts.turn_understanding?.inbound_route_contract;

  if (isPhase1AuthoritativeRouteContract(routeContract)) {
    switch (routeContract!.route) {
      case "acknowledgment_no_reply":
        return "thanks_acknowledgment";
      case "win_close_loop":
        return "completion_proof";
      case "proof_answer_close_loop":
        return "answered_prior_question";
      default:
        break;
    }
  }

  if (looksLikeRepeatedQuestionComplaint(text)) return "repeated_question_complaint";
  if (looksLikeFalsePremiseChallenge(text)) return "false_premise_challenge";
  if (looksLikeTimingContext(text)) return "timing_context";
  if (looksLikeThanksAcknowledgment(text) && !looksLikeHelpRequest(text)) {
    if (text.length <= 120 && !/\b(want|need|would like|lateral|core)\b/i.test(text)) {
      return "thanks_acknowledgment";
    }
  }
  if (looksLikeHelpRequest(text)) return "help_request";

  if (looksLikeAnsweredPriorQuestion({ text, facts: args.facts })) {
    return "answered_prior_question";
  }

  if (
    rt?.required_reply_move === "acknowledge_reflection" ||
    args.facts.inbound_meaning.relationship_meaning === "reflective_share"
  ) {
    return "reflection";
  }

  if (
    rt?.required_reply_move === "acknowledge_completion" ||
    rt?.resolved_outcome === "completed" ||
    args.facts.inbound_meaning.relationship_meaning === "reported_completion"
  ) {
    return "completion_proof";
  }

  if (rt?.resolved_outcome === "partial" || args.facts.inbound_meaning.relationship_meaning === "partial_attempt") {
    return "partial";
  }

  if (
    rt?.resolved_outcome === "missed" ||
    args.facts.inbound_meaning.relationship_meaning === "miss" ||
    args.facts.v2_accountability.miss_signal
  ) {
    return "miss";
  }

  if (looksLikeCompletionProofWithDetails(text)) return "completion_proof";

  return "unclear";
}

function deriveMustNotDo(args: {
  turnType: InboundReplyBriefTurnType;
  facts: InboundV3RelationshipFacts;
  answeredPriorQuestion: boolean;
}): string[] {
  const out: string[] = [];
  const rt = args.facts.inbound_resolved_truth;
  for (const item of rt?.must_not_do ?? []) {
    const t = item?.trim();
    if (t) out.push(t);
  }

  if (
    args.turnType === "completion_proof" ||
    args.turnType === "answered_prior_question" ||
    args.answeredPriorQuestion
  ) {
    out.push("Do not ask what got in the way.");
    out.push("Do not ask for proof or evidence again.");
    out.push("Do not ask Did you do it or any outcome triad question.");
  }

  if (args.turnType === "false_premise_challenge") {
    out.push("Do not invent facts about the user's completion.");
    out.push("Do not double down on a false completion claim.");
    out.push("Do not ask for proof while defending a wrong premise.");
  }

  if (
    args.turnType === "repeated_question_complaint" ||
    args.turnType === "answered_prior_question"
  ) {
    out.push("Do not re-ask the same question.");
    out.push("Do not ask for the same list or evidence again.");
    out.push('Do not use generic "can you share more" worksheet follow-ups.');
  }

  if (args.turnType === "help_request") {
    const route = args.facts.turn_understanding?.inbound_route_contract;
    if (!isPhase1AuthoritativeRouteContract(route)) {
      out.push("Do not respond with clarification questions instead of help.");
      out.push("Do not no-send on a help request.");
    }
  }

  if (args.turnType === "thanks_acknowledgment") {
    out.push("Do not ask a follow-up question after thanks.");
    out.push("Do not accountability-check after gratitude.");
  }

  if (args.turnType === "timing_context") {
    out.push("Do not evaluate the day too early.");
    out.push("Do not ask Did you do it before the user has had a fair window.");
  }

  if (args.turnType === "reflection" || args.turnType === "help_request") {
    out.push('Do not use generic "can you share more" worksheet follow-ups.');
  }

  return [...new Set(out.map((s) => s.trim()).filter(Boolean))].slice(0, 10);
}

function deriveExplicitFacts(args: {
  text: string;
  facts: InboundV3RelationshipFacts;
  turnType: InboundReplyBriefTurnType;
}): string[] {
  const out: string[] = [];
  const rt = args.facts.inbound_resolved_truth;
  if (rt?.plan_detected) out.push("User stated a future plan — not completion proof.");
  if (rt?.blocker_detected) out.push("User named a blocker.");
  if (args.turnType === "timing_context") out.push("User says it is too early to judge today's outcome.");
  if (args.turnType === "false_premise_challenge") {
    out.push("User challenges coach premise about prior completion.");
  }
  if (args.facts.thread.most_recent_coach_question?.trim()) {
    out.push(`Prior coach question: ${args.facts.thread.most_recent_coach_question.trim().slice(0, 120)}`);
  }
  if (args.text.length >= 12) {
    out.push(`Latest inbound preview: ${args.text.slice(0, 160)}`);
  }
  return out.slice(0, 6);
}

export function deriveMaxQuestionsForBrief(args: {
  turnType: InboundReplyBriefTurnType;
  followupQuestionUsedToday: boolean;
  completionHasDetails: boolean;
}): { max_questions: 0 | 1; reason: string } {
  if (args.followupQuestionUsedToday) {
    return {
      max_questions: 0,
      reason: "followup_question_already_used_today",
    };
  }

  switch (args.turnType) {
    case "completion_proof":
      return args.completionHasDetails
        ? { max_questions: 0, reason: "completion_proof_with_details" }
        : { max_questions: 1, reason: "completion_proof_needs_detail" };
    case "miss":
      return { max_questions: 1, reason: "miss_one_blocker_allowed" };
    case "partial":
      return { max_questions: 1, reason: "partial_one_follow_up_allowed" };
    case "thanks_acknowledgment":
      return { max_questions: 0, reason: "thanks_close_loop" };
    case "help_request":
      return { max_questions: 0, reason: "help_request_direct_answer" };
    case "false_premise_challenge":
      return { max_questions: 0, reason: "false_premise_correction" };
    case "repeated_question_complaint":
      return { max_questions: 0, reason: "repeated_question_complaint" };
    case "timing_context":
      return { max_questions: 0, reason: "timing_context_forward_only" };
    case "answered_prior_question":
      return { max_questions: 0, reason: "answered_prior_question_close_loop" };
    case "reflection":
      return { max_questions: 0, reason: "reflection_close_loop" };
    default:
      return { max_questions: 1, reason: "unclear_one_clarify_allowed" };
  }
}

function buildThreadWindow(facts: InboundV3RelationshipFacts): InboundReplyBriefThreadWindowMessage[] {
  const messages = facts.thread.memory_packet?.recent_exact_thread_72h?.messages ?? [];
  const window: InboundReplyBriefThreadWindowMessage[] = [];
  for (let i = messages.length - 1; i >= 0 && window.length < THREAD_WINDOW_MAX; i--) {
    const m = messages[i]!;
    if (m.role === "system_no_send") continue;
    if (m.role !== "coach" && m.role !== "user") continue;
    window.unshift({
      role: m.role,
      ...(m.at_local?.trim() ? { at_local: m.at_local.trim() } : {}),
      body: m.body.slice(0, 280),
    });
  }
  return window;
}

function previousCoachMessage(facts: InboundV3RelationshipFacts): string | null {
  const fromThread =
    facts.thread.latest_outbound_coach_sms ??
    facts.thread.memory_packet?.last_substantive_coach_message ??
    facts.thread.memory_packet?.last_outbound_full_body ??
    null;
  if (fromThread?.trim()) return fromThread.trim().slice(0, 320);

  const messages = facts.thread.memory_packet?.recent_exact_thread_72h?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "coach") continue;
    if (!m.body.trim()) continue;
    return m.body.trim().slice(0, 320);
  }
  return null;
}

export function applyInboundRouteAllowedClaimsToBrief(
  brief: InboundReplyBriefV1,
  args: {
    proofPersistedBeforeWriter?: boolean;
    proofPersistedEventType?: "user_yes" | "user_no" | "user_partial" | null;
  }
): InboundReplyBriefV1 {
  return {
    ...brief,
    allowed_claims: buildInboundRouteAllowedClaims({
      routeContract: {
        route: brief.route,
        phase1_authoritative: brief.phase1_authoritative,
        source: brief.phase1_authoritative ? "turn_understanding" : "none",
        relationship_engagement: true,
        outcome: brief.outcome_to_persist === "win" ? "win" : brief.outcome_to_persist === "proof" ? "proof" : "none",
        answered_prior_ask: brief.resolved_truth.answered_prior_question,
        prior_ask_satisfied: brief.resolved_truth.answered_prior_question,
        should_persist: brief.outcome_to_persist !== "none",
        should_reply: brief.should_reply,
        close_loop: brief.close_loop,
        max_questions: brief.question_policy.max_questions,
        allow_new_assignment: brief.allow_new_assignment,
        allow_generic_advice: brief.allow_generic_advice,
        facts_to_reflect: brief.facts_to_reflect,
        forbidden_moves: brief.forbidden_moves,
        outcome_to_persist: brief.outcome_to_persist,
      },
      proofPersistedBeforeWriter: args.proofPersistedBeforeWriter,
      proofPersistedEventType: args.proofPersistedEventType,
    }),
  };
}

function mapRouteContractToBriefMove(
  routeContract: InboundRouteContract | null | undefined,
  turnType: InboundReplyBriefTurnType,
  requiredMove: InboundRequiredReplyMove | undefined
): InboundReplyBriefReplyMove {
  if (routeContract?.route === "win_close_loop") {
    return "acknowledge_completion_and_close_loop";
  }
  if (routeContract?.route === "proof_answer_close_loop") {
    return "acknowledge_already_answered";
  }
  if (routeContract?.route === "acknowledgment_no_reply") {
    return "close_acknowledgment";
  }
  return mapRequiredReplyMoveToBriefMove(requiredMove, turnType);
}

export function buildInboundReplyBriefV1(args: {
  facts: InboundV3RelationshipFacts;
}): InboundReplyBriefV1 {
  const facts = args.facts;
  const latestUserMessage =
    facts.thread.coalesced_inbound_text?.trim() ||
    facts.thread.latest_inbound_raw?.trim() ||
    "";
  const routeContract = facts.turn_understanding?.inbound_route_contract ?? null;
  const phase1Authoritative = isPhase1AuthoritativeRouteContract(routeContract);
  const accountabilityDayKey = resolveAccountabilityDayKeyForBrief(facts);
  const followupQuestionUsedToday = deriveFollowupQuestionUsedToday({
    facts,
    accountabilityDayKey,
  });
  const turnType = deriveTurnType({ text: latestUserMessage, facts });
  const answeredPriorQuestion =
    turnType === "answered_prior_question" ||
    turnType === "repeated_question_complaint" ||
    Boolean(facts.inbound_resolved_truth?.answered_recent_ask) ||
    Boolean(facts.inbound_resolved_truth?.satisfied_recent_ask) ||
    Boolean(routeContract?.prior_ask_satisfied);
  const completionHasDetails =
    turnType === "completion_proof" &&
    (looksLikeCompletionProofWithDetails(latestUserMessage) || answeredPriorQuestion);
  const questionPolicyBase = phase1Authoritative
    ? {
        max_questions: routeContract!.max_questions,
        reason: `phase1_route_${routeContract!.route}`,
      }
    : deriveMaxQuestionsForBrief({
        turnType,
        followupQuestionUsedToday,
        completionHasDetails,
      });
  const questionPolicy =
    facts.inbound_resolved_truth?.max_questions_override === 0 &&
    questionPolicyBase.max_questions !== 0
      ? {
          max_questions: 0 as const,
          reason: "resolved_truth_max_questions_override_forced_zero",
        }
      : questionPolicyBase;
  const goalStatus = mapGoalStatus(facts);
  const replyMove = mapRouteContractToBriefMove(
    routeContract,
    turnType,
    facts.inbound_resolved_truth?.required_reply_move
  );
  const routeForbidden = routeContract?.forbidden_moves ?? [];
  const mustNotDo = [
    ...deriveMustNotDo({
      turnType,
      facts,
      answeredPriorQuestion,
    }),
    ...routeForbidden,
  ];
  const uniqueMustNotDo = [...new Set(mustNotDo.map((s) => s.trim()).filter(Boolean))].slice(0, 12);
  const route: InboundPhase1Route = routeContract?.route ?? "legacy_other";
  const shouldReply = phase1Authoritative ? routeContract!.should_reply : true;
  const closeLoop = phase1Authoritative ? routeContract!.close_loop : false;
  const outcomeToPersist = phase1Authoritative
    ? routeContract!.outcome_to_persist
    : "none";
  const factsToReflect =
    phase1Authoritative && routeContract!.facts_to_reflect.length > 0
      ? routeContract!.facts_to_reflect
      : deriveExplicitFacts({ text: latestUserMessage, facts, turnType }).slice(0, 2);

  const brief: InboundReplyBriefV1 = {
    brief_version: INBOUND_REPLY_BRIEF_VERSION,
    latest_user_message: latestUserMessage.slice(0, 400),
    previous_coach_message: previousCoachMessage(facts),
    current_goal:
      facts.commitment.effective_ask?.trim() ||
      facts.commitment.behavior_statement?.trim() ||
      null,
    local_time_iso: facts.user.local_time_iso?.trim() || null,
    local_daypart: deriveLocalDaypart(facts.user.local_time_iso?.trim() || null),
    turn_type: turnType,
    resolved_truth: {
      answered_prior_question: answeredPriorQuestion,
      goal_status_from_latest_message: goalStatus,
      explicit_facts: deriveExplicitFacts({ text: latestUserMessage, facts, turnType }),
    },
    question_policy: {
      followup_question_used_today: followupQuestionUsedToday,
      max_questions: questionPolicy.max_questions,
      reason: questionPolicy.reason,
    },
    reply_strategy: {
      move: replyMove,
      must_not_do: uniqueMustNotDo,
    },
    thread_window: buildThreadWindow(facts),
    route,
    should_reply: shouldReply,
    close_loop: closeLoop,
    outcome_to_persist: outcomeToPersist,
    allowed_claims: buildInboundRouteAllowedClaims({ routeContract }),
    facts_to_reflect: factsToReflect,
    allow_new_assignment: phase1Authoritative ? routeContract!.allow_new_assignment : true,
    allow_generic_advice: phase1Authoritative ? routeContract!.allow_generic_advice : true,
    forbidden_moves: uniqueMustNotDo,
    phase1_authoritative: phase1Authoritative,
  };
  return brief;
}

export function compactInboundReplyBriefV1ForTelemetry(
  brief: InboundReplyBriefV1
): InboundReplyBriefV1Log {
  return {
    inbound_reply_brief_version: brief.brief_version,
    inbound_reply_brief_turn_type: brief.turn_type,
    inbound_reply_brief_move: brief.reply_strategy.move,
    inbound_reply_brief_max_questions: brief.question_policy.max_questions,
    inbound_followup_question_used_today: brief.question_policy.followup_question_used_today,
    inbound_answered_prior_question: brief.resolved_truth.answered_prior_question,
    inbound_goal_status_from_latest_message: brief.resolved_truth.goal_status_from_latest_message,
    inbound_false_premise_challenge_detected: brief.turn_type === "false_premise_challenge",
    inbound_help_request_detected: brief.turn_type === "help_request",
    inbound_thanks_acknowledgment_detected: brief.turn_type === "thanks_acknowledgment",
    inbound_repeated_question_complaint_detected:
      brief.turn_type === "repeated_question_complaint",
    inbound_time_of_day_forward_only_detected: brief.turn_type === "timing_context",
    inbound_route: brief.route,
    inbound_should_reply: brief.should_reply,
    inbound_close_loop: brief.close_loop,
    inbound_phase1_authoritative: brief.phase1_authoritative,
  };
}

export function attachInboundReplyBriefTelemetryToLaneMetadata(
  laneMetadata: Record<string, unknown>,
  brief: InboundReplyBriefV1
): void {
  Object.assign(laneMetadata, compactInboundReplyBriefV1ForTelemetry(brief));
}

export const INBOUND_BRIEF_ZERO_QUESTION_ASK_SHAPED_RE =
  /\b(can you share|tell me more|what got in the way|what held you back|what specific|what are|what kind|what's making|what makes|what did you|how did|did you|do you|have you|will you|what proof|what evidence|what'?s next|what is next|how are you feeling)\b/i;

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/;
const MIN_USABLE_BRIEF_ZERO_QUESTION_REPAIR_CHARS = 24;

export function buildInboundBriefWriterSystemPrompt(args: {
  maxChars: number;
  requiredVerbatimSubstrings?: string[];
  forbiddenSubstrings?: string[];
}): string {
  const constraintLines: string[] = [];
  if (args.requiredVerbatimSubstrings?.length) {
    constraintLines.push(
      "- constraints.required_verbatim_substrings is non-empty: body MUST contain every listed substring exactly."
    );
  }
  if (args.forbiddenSubstrings?.length) {
    constraintLines.push(
      "- constraints.forbidden_substrings is non-empty: body MUST NOT contain any listed substring."
    );
  }
  const constraintBlock = constraintLines.length ? `${constraintLines.join("\n")}\n` : "";

  return `You are writing the NEXT SMS in one long coaching relationship.

Your job is to complete the accountability loop, not keep the conversation going.

Authority order:
1. INBOUND_REPLY_BRIEF_V1.route, should_reply, close_loop, allowed_claims, and facts_to_reflect
2. latest_user_message and resolved_truth
3. reply_strategy.move and reply_strategy.must_not_do / forbidden_moves
4. question_policy

Rules:
- Obey route, should_reply, close_loop, and allowed_claims exactly.
- If should_reply=false, return should_send false with empty body.
- If close_loop=true, do not add a new assignment, new advice, or future planning.
- If allowed_claims.can_reference_victory_room=false, do not mention Victory Room, recorded, logged, or saved.
- If allowed_claims.victory_room_language_mode is metaphor_only, win-column language is ok; do not claim DB persistence.
- For win_close_loop: warmly mark the win and stop — not a flat restatement.
- For proof_answer_close_loop: reflect one specific detail from facts_to_reflect and stop.
- Do not give generic advice after thanks/okay/good/sounds good closers.
- Obey question_policy.max_questions.
- If max_questions = 0, write a statement-only SMS: no question mark and no ask-shaped sentence.
- Do not re-ask answered questions.
- Do not treat completion/proof as a miss.
- Do not ask "what got in the way" unless turn_type is miss or partial and max_questions = 1.
- If turn_type is help_request AND allow_generic_advice=true, give direct coaching help. Do not ask clarifying questions.
- If thanks_acknowledgment or route is acknowledgment_no_reply, close warmly. No question.
- If false_premise_challenge, correct the premise and repair trust. No question.
- If repeated_question_complaint, acknowledge they already answered. No question.
- If timing_context, acknowledge timing and point forward. No question.
- One SMS, max ${args.maxChars} characters, no newlines.
- No robot menu.
- No fake Pat quotes.
- No generic motivation filler.
${constraintBlock}- If unsafe or facts conflict badly, return should_send false.

OUTPUT: strict JSON only with keys:
should_send (boolean), body (string, empty if should_send false), no_send_reason (string|null),
turn_purpose (string), voice_confidence (number 0-1 or null),
used_facts (string[]), safety_notes (string[]),
rejected_times_obeyed (boolean), split_messages_handled (boolean)`;
}

export function serializeInboundReplyBriefForWriterPrompt(brief: InboundReplyBriefV1): string {
  return JSON.stringify(brief);
}

export function buildInboundBriefWriterUserPrompt(brief: InboundReplyBriefV1): string {
  return `INBOUND_REPLY_BRIEF_V1 (server truth — not copyable prose):\n${serializeInboundReplyBriefForWriterPrompt(brief)}\n\nWrite JSON only.`;
}

export function detectInboundBriefMaxQuestionsViolation(
  body: string,
  brief: InboundReplyBriefV1
): { violation: boolean; reason: string | null } {
  if (brief.question_policy.max_questions !== 0) {
    return { violation: false, reason: null };
  }
  const b = body.trim();
  if (!b) return { violation: false, reason: null };
  if (/\?/.test(b)) {
    return { violation: true, reason: "brief_max_questions_zero_question_mark" };
  }
  if (INBOUND_BRIEF_ZERO_QUESTION_ASK_SHAPED_RE.test(b)) {
    return { violation: true, reason: "brief_max_questions_zero_ask_shaped_phrase" };
  }
  return { violation: false, reason: null };
}

function sentenceViolatesBriefZeroQuestionRules(sentence: string): boolean {
  const s = sentence.trim();
  if (!s) return true;
  if (/\?/.test(s)) return true;
  if (INBOUND_BRIEF_ZERO_QUESTION_ASK_SHAPED_RE.test(s)) return true;
  return false;
}

function repairBriefZeroQuestionStatement(candidate: string): string | null {
  const raw = candidate.trim();
  if (!raw) return null;
  const parts = raw
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  const candidates = parts.length > 0 ? parts : [raw];
  for (const part of candidates) {
    if (sentenceViolatesBriefZeroQuestionRules(part)) continue;
    let statement = part.replace(/\s+/g, " ").trim();
    if (statement.length > 0) {
      statement = statement.charAt(0).toUpperCase() + statement.slice(1);
    }
    statement = statement.replace(/[!]+$/g, ".").replace(/[?]+$/g, "");
    if (!statement.endsWith(".")) statement = `${statement}.`;
    if (statement.length >= MIN_USABLE_BRIEF_ZERO_QUESTION_REPAIR_CHARS) return statement;
  }
  const beforeQuestion = raw.split(/\?/)[0]?.trim();
  if (
    beforeQuestion &&
    beforeQuestion.length >= MIN_USABLE_BRIEF_ZERO_QUESTION_REPAIR_CHARS &&
    !sentenceViolatesBriefZeroQuestionRules(beforeQuestion)
  ) {
    let statement = beforeQuestion.replace(/\s+/g, " ").trim();
    if (!statement.endsWith(".")) statement = `${statement}.`;
    return statement;
  }
  return null;
}

export function inboundBriefMaxQuestionsFallbackForTurnType(
  turnType: InboundReplyBriefTurnType
): string {
  switch (turnType) {
    case "thanks_acknowledgment":
      return "Good. Keep it simple today and let that be enough.";
    case "help_request":
      return "Make the next version smaller. Start with the first two minutes, before you negotiate with yourself.";
    case "false_premise_challenge":
      return "You're right — I shouldn't have assumed that. I'll stay with what you actually tell me.";
    case "repeated_question_complaint":
      return "You're right — you already answered that. I'll stay with what you gave me and leave it there.";
    case "timing_context":
      return "That makes sense. Use the next fair window today instead of judging the day too early.";
    case "completion_proof":
    case "answered_prior_question":
      return "That's it. You answered the work in front of you. Keep that version clear and repeatable.";
    case "reflection":
      return "That's worth noticing. Hold onto that lesson and use it in the next rep.";
    default:
      return "Got it. I'll leave it there for now.";
  }
}

export type InboundBriefMaxQuestionsGuardTelemetry = {
  inbound_brief_max_questions_guard_applied: boolean;
  inbound_brief_max_questions_guard_repaired?: boolean;
  inbound_brief_max_questions_guard_fallback_used?: boolean;
  inbound_brief_max_questions_guard_reason?: string | null;
  inbound_brief_max_questions_guard_original_body_preview?: string;
  inbound_brief_max_questions_guard_final_body_preview?: string;
};

export function applyInboundBriefMaxQuestionsGuard(args: {
  body: string;
  brief: InboundReplyBriefV1;
  validateBody?: (body: string) => boolean;
}): { body: string; telemetry: InboundBriefMaxQuestionsGuardTelemetry } {
  const preview = (s: string) => s.trim().slice(0, 200);
  const noopTelemetry: InboundBriefMaxQuestionsGuardTelemetry = {
    inbound_brief_max_questions_guard_applied: false,
  };
  if (args.brief.question_policy.max_questions !== 0) {
    return { body: args.body, telemetry: noopTelemetry };
  }
  const violation = detectInboundBriefMaxQuestionsViolation(args.body, args.brief);
  if (!violation.violation) {
    return { body: args.body, telemetry: noopTelemetry };
  }
  const validate = args.validateBody ?? ((b: string) => b.trim().length >= 8);
  const baseTelemetry: InboundBriefMaxQuestionsGuardTelemetry = {
    inbound_brief_max_questions_guard_applied: true,
    inbound_brief_max_questions_guard_reason: violation.reason,
    inbound_brief_max_questions_guard_original_body_preview: preview(args.body),
  };
  const repaired = repairBriefZeroQuestionStatement(args.body);
  if (repaired && validate(repaired) && !detectInboundBriefMaxQuestionsViolation(repaired, args.brief).violation) {
    return {
      body: repaired,
      telemetry: {
        ...baseTelemetry,
        inbound_brief_max_questions_guard_repaired: true,
        inbound_brief_max_questions_guard_final_body_preview: preview(repaired),
      },
    };
  }
  const fallback = inboundBriefMaxQuestionsFallbackForTurnType(args.brief.turn_type);
  return {
    body: fallback,
    telemetry: {
      ...baseTelemetry,
      inbound_brief_max_questions_guard_fallback_used: true,
      inbound_brief_max_questions_guard_final_body_preview: preview(fallback),
    },
  };
}

export function inboundBriefWriterPromptTelemetry(args: {
  mode: "brief" | "packet_fallback" | "packet";
  path: string;
  userCharCount: number;
}): Record<string, unknown> {
  return {
    inbound_writer_prompt_mode: args.mode,
    inbound_writer_prompt_path: args.path,
    inbound_relationship_packet_char_count: args.userCharCount,
    ...(args.mode === "brief" ? { inbound_reply_brief_char_count: args.userCharCount } : {}),
  };
}
