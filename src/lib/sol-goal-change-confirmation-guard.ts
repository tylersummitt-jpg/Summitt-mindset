/**
 * Deterministic Goal Change body safety for machine inbound SMS.
 * Prompt law is not enough. Does not create pending. Does not mutate Current Goal.
 *
 * Three mutually exclusive writer states:
 * 1. Pending: confirmation authorized, apply false — ASK only.
 * 2. Applied: apply authorized, confirmation false — ACKNOWLEDGE persisted goal only.
 * 3. Neither: both false — clarify only; no binding ask, no applied claim.
 *
 * Apply authorization requires canonical mutation success AND post-mutation reload proof.
 * Apply=true does not disable this guard: the body still cannot claim a different goal.
 */

export type SolGoalChangeConfirmationAuthorization = {
  goal_change_confirmation_authorized: boolean;
  goal_change_apply_authorized: boolean;
  candidate_behavior_statement: string | null;
  canonical_behavior_statement: string;
  pending_state: "awaiting_confirmation" | "awaiting_candidate" | null;
  previous_behavior_statement: string | null;
  previous_commitment_id: string | null;
  active_commitment_id: string | null;
  pending_cleared: boolean;
};

export const SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED: SolGoalChangeConfirmationAuthorization =
  {
    goal_change_confirmation_authorized: false,
    goal_change_apply_authorized: false,
    candidate_behavior_statement: null,
    canonical_behavior_statement: "",
    pending_state: null,
    previous_behavior_statement: null,
    previous_commitment_id: null,
    active_commitment_id: null,
    pending_cleared: false,
  };

export const UNAUTHORIZED_GOAL_CHANGE_BINDING_CLARIFICATION =
  "Are you talking about tonight only, or changing the goal going forward?";

/** Renders proven awaiting_candidate state. Not English interpretation. */
export const AUTHORIZED_AWAITING_CANDIDATE_ELICITATION_ASK =
  "What do you want your new goal to be?";

const UNAUTHORIZED_BINDING_CONFIRMATION_RES: RegExp[] = [
  /\breplace\b[\s\S]{0,80}\bgoing\s+forward\b/i,
  /\bgoing\s+forward\b[\s\S]{0,80}\breplace\b/i,
  /\bdo\s+you\s+want\b[\s\S]{0,80}\breplace\b/i,
  /\b(?:change|update)\s+(?:your\s+)?(?:saved\s+|current\s+)?goal\s+to\b/i,
  /\bshould\s+i\s+change\s+your\s+saved\s+goal\b/i,
  /\block(?:\s+in)?\b[\s\S]{0,48}\b(?:new\s+)?goal\b/i,
  /\bwant\s+me\s+to\s+lock\s+in\b/i,
  /\bmake\b[\s\S]{0,48}\bthe\s+goal\s+going\s+forward\b/i,
];

/** Claims the saved Goal Change already happened. Narrow; not a general English parser. */
const FALSE_APPLIED_SAVED_GOAL_CHANGE_RES: RegExp[] = [
  /\byour\s+goal\s+is\s+now\b/i,
  /\byour\s+new\s+goal\s+is\b/i,
  /\byour\s+goal\s+going\s+forward\s+is\b/i,
  /\bwe(?:'ll|\s+will)\s+use\b[\s\S]{0,48}\bgoing\s+forward\b/i,
  /\bfrom\s+now\s+on\s+your\s+goal\b/i,
  /\bis\s+locked\s+in\b/i,
  /\blocked\s+in\s+as\s+(?:your\s+)?(?:the\s+)?(?:new\s+)?goal\b/i,
  /\bi(?:'ve|\s+have)\s+(?:just\s+)?(?:changed|updated)\s+your\s+(?:saved\s+)?goal\b/i,
  /\byour\s+(?:saved\s+)?goal\s+has\s+been\s+(?:changed|updated)\b/i,
  /\bdone\b[\s\S]{0,48}\b(?:saved\s+)?goal\b/i,
  /\b(?:saved\s+)?goal\b[\s\S]{0,48}\bdone\b/i,
];

export function bodyAsksBindingSavedGoalChangeConfirmation(body: string): boolean {
  const t = body.trim();
  if (!t) return false;
  return UNAUTHORIZED_BINDING_CONFIRMATION_RES.some((re) => re.test(t));
}

const POST_APPLY_REASK_RES: RegExp[] = [
  /\bare\s+you\s+sure\b/i,
  /\bshould\s+i\s+lock\s+(?:that|it|this)\s+in\b/i,
  /\bwant\s+(?:me\s+)?to\s+make\s+that\s+your\s+new\s+goal\b/i,
  /\bwant\s+to\s+make\s+that\s+your\s+new\s+goal\b/i,
  /\bmake\s+that\s+your\s+new\s+goal\b/i,
];

export function bodyAsksPostApplyGoalChangeReconfirmation(body: string): boolean {
  const t = body.trim();
  if (!t) return false;
  if (bodyAsksBindingSavedGoalChangeConfirmation(t)) return true;
  return POST_APPLY_REASK_RES.some((re) => re.test(t));
}

const GOAL_CHANGE_INTERNAL_MECHANICS_RES: RegExp[] = [
  /\bdatabase\b/i,
  /\bsupabase\b/i,
  /\brpc\b/i,
  /\bcanonical\b/i,
  /\bpending\s+state\b/i,
  /\bcommitment\s+id\b/i,
  /\bnew\s+chapter\s+id\b/i,
  /\bmutation\b/i,
  /\bserver\s+verification\b/i,
];

export function bodyLeaksGoalChangeInternalMechanics(body: string): boolean {
  const t = body.trim();
  if (!t) return false;
  return GOAL_CHANGE_INTERNAL_MECHANICS_RES.some((re) => re.test(t));
}

export function bodyClaimsSavedGoalChangeAlreadyApplied(body: string): boolean {
  const t = body.trim();
  if (!t) return false;
  return FALSE_APPLIED_SAVED_GOAL_CHANGE_RES.some((re) => re.test(t));
}

/** Written HH:MM tokens only — do not convert am/pm, so "10:30" matches "10:30 pm". */
function clockHmTokens(text: string): string[] {
  const out: string[] = [];
  const re = /\b(\d{1,2}):(\d{2})\b/g;
  for (const m of text.matchAll(re)) {
    out.push(`${parseInt(m[1]!, 10)}:${m[2]}`);
  }
  return out;
}

const WEEKDAY_TOKEN_RE =
  /\b(mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?)\b/gi;

const NUMBER_WORD_TO_DIGIT: Record<string, string> = {
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
};

/**
 * Distinctive applied-goal tokens: clocks, weekdays, and quantities.
 * Skips "one" because Coach often says "make that one real".
 */
export function extractAppliedGoalDistinctiveTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  let rest = text.toLowerCase();
  rest = rest.replace(/\b(\d{1,2}):(\d{2})\b/g, (_m, h: string, m: string) => {
    tokens.add(`clock:${parseInt(h, 10)}:${m}`);
    return " ";
  });
  rest = rest.replace(WEEKDAY_TOKEN_RE, (m) => {
    tokens.add(`day:${m.replace(/s$/i, "").toLowerCase()}`);
    return " ";
  });
  rest = rest.replace(
    /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/gi,
    (m) => {
      const digit = NUMBER_WORD_TO_DIGIT[m.toLowerCase()];
      if (digit) tokens.add(`num:${digit}`);
      return " ";
    }
  );
  rest = rest.replace(/\b(\d+)\b/g, (_m, n: string) => {
    tokens.add(`num:${String(parseInt(n, 10))}`);
    return " ";
  });
  return tokens;
}

export function bodyClockConflictsWithCanonicalActiveGoal(
  body: string,
  canonicalBehaviorStatement: string
): boolean {
  const bodyClocks = clockHmTokens(body);
  const canonClocks = clockHmTokens(canonicalBehaviorStatement);
  if (bodyClocks.length === 0 || canonClocks.length === 0) return false;
  return !bodyClocks.some((c) => canonClocks.includes(c));
}

/**
 * Post-apply wrong-goal seatbelt: distinctive body tokens must appear in the
 * active canonical goal, the previous canonical goal, or both.
 * Tokens in neither are invented and veto. Does not classify historical vs
 * present English — Sol owns that distinction.
 */
export function bodyConflictsWithAuthoritativeAppliedGoal(
  body: string,
  canonicalBehaviorStatement: string,
  previousBehaviorStatement?: string | null
): boolean {
  const bodyTok = extractAppliedGoalDistinctiveTokens(body);
  if (bodyTok.size === 0) return false;
  const allowed = new Set<string>([
    ...extractAppliedGoalDistinctiveTokens(canonicalBehaviorStatement),
    ...extractAppliedGoalDistinctiveTokens(previousBehaviorStatement ?? ""),
  ]);
  if (allowed.size === 0) return false;
  for (const t of bodyTok) {
    if (!allowed.has(t)) return true;
  }
  return false;
}

export function buildAuthorizedAppliedGoalAck(
  authorization: SolGoalChangeConfirmationAuthorization
): string {
  const canon = (authorization.canonical_behavior_statement ?? "").trim().replace(/\.+$/, "");
  if (canon) {
    return `Got it. Your goal going forward is ${canon}.`;
  }
  return "Got it. Your saved goal is updated.";
}

export function buildAppliedGoalChangeAuthorization(args: {
  previousBehaviorStatement: string;
  previousCommitmentId: string;
  activeBehaviorStatement: string;
  activeCommitmentId: string;
}): SolGoalChangeConfirmationAuthorization {
  return {
    goal_change_confirmation_authorized: false,
    goal_change_apply_authorized: true,
    candidate_behavior_statement: null,
    canonical_behavior_statement: args.activeBehaviorStatement.trim(),
    pending_state: null,
    previous_behavior_statement: args.previousBehaviorStatement.trim(),
    previous_commitment_id: args.previousCommitmentId,
    active_commitment_id: args.activeCommitmentId,
    pending_cleared: true,
  };
}

/**
 * Slice 5 correction: Sol relationship writer failed after authoritative
 * Goal Change state exists. Renders proven server state only — not English.
 * Returns null unless reload-proven pending confirmation, awaiting-candidate
 * elicitation, or applied ack.
 * No pending / interpreter-down without proven hallway must not fake a binding ask.
 */
export function tryBuildAuthorizedGoalChangeWriterFailureFallback(
  authorization: SolGoalChangeConfirmationAuthorization
): string | null {
  if (authorization.goal_change_apply_authorized === true) {
    return buildAuthorizedAppliedGoalAck(authorization);
  }
  if (
    authorization.goal_change_confirmation_authorized === true &&
    authorization.pending_state === "awaiting_confirmation" &&
    (authorization.candidate_behavior_statement ?? "").trim() &&
    (authorization.canonical_behavior_statement ?? "").trim()
  ) {
    return buildAuthorizedPendingConfirmationAsk(authorization);
  }
  if (
    authorization.pending_state === "awaiting_candidate" &&
    authorization.goal_change_confirmation_authorized !== true &&
    authorization.goal_change_apply_authorized !== true &&
    !(authorization.candidate_behavior_statement ?? "").trim()
  ) {
    return AUTHORIZED_AWAITING_CANDIDATE_ELICITATION_ASK;
  }
  return null;
}

export function buildAuthorizedPendingConfirmationAsk(
  authorization: SolGoalChangeConfirmationAuthorization
): string {
  const cand = (authorization.candidate_behavior_statement ?? "").trim().replace(/\.+$/, "");
  const canon = (authorization.canonical_behavior_statement ?? "").trim().replace(/\.+$/, "");
  if (cand && canon) {
    return `Do you want ${cand} to replace ${canon} going forward?`;
  }
  if (cand) {
    return `Do you want ${cand} to replace your current saved goal going forward?`;
  }
  return UNAUTHORIZED_GOAL_CHANGE_BINDING_CLARIFICATION;
}

export function applyUnauthorizedGoalChangeBindingConfirmationGuard(args: {
  body: string;
  authorized: boolean;
}): { body: string; blocked: boolean; reason: string | null } {
  const body = args.body.trim();
  if (args.authorized) {
    return { body, blocked: false, reason: null };
  }
  if (!bodyAsksBindingSavedGoalChangeConfirmation(body)) {
    return { body, blocked: false, reason: null };
  }
  return {
    body: UNAUTHORIZED_GOAL_CHANGE_BINDING_CLARIFICATION,
    blocked: true,
    reason: "unauthorized_binding_goal_change_confirmation",
  };
}

export function applyFalseAppliedGoalChangeGuard(args: {
  body: string;
  applyAuthorized: boolean;
  confirmationAuthorization: SolGoalChangeConfirmationAuthorization;
}): { body: string; blocked: boolean; reason: string | null } {
  const body = args.body.trim();
  if (args.applyAuthorized) {
    const canonical = args.confirmationAuthorization.canonical_behavior_statement ?? "";
    const previous = args.confirmationAuthorization.previous_behavior_statement ?? "";
    if (bodyConflictsWithAuthoritativeAppliedGoal(body, canonical, previous)) {
      return {
        body: buildAuthorizedAppliedGoalAck(args.confirmationAuthorization),
        blocked: true,
        reason: "wrong_applied_goal_change_claim",
      };
    }
    return { body, blocked: false, reason: null };
  }
  if (!bodyClaimsSavedGoalChangeAlreadyApplied(body)) {
    return { body, blocked: false, reason: null };
  }
  const pendingAsk =
    args.confirmationAuthorization.goal_change_confirmation_authorized === true &&
    args.confirmationAuthorization.pending_state === "awaiting_confirmation";
  return {
    body: pendingAsk
      ? buildAuthorizedPendingConfirmationAsk(args.confirmationAuthorization)
      : UNAUTHORIZED_GOAL_CHANGE_BINDING_CLARIFICATION,
    blocked: true,
    reason: "false_applied_goal_change_claim",
  };
}

/**
 * Single machine-body safety path for Sol main, V3 main, and Wave4 handoff V3.
 * False-applied veto runs even when confirmation asking is authorized.
 */
export function applyGoalChangeMachineBodySafety(args: {
  body: string;
  authorization: SolGoalChangeConfirmationAuthorization | null | undefined;
}): { body: string; blocked: boolean; reason: string | null } {
  const authorization = args.authorization ?? {
    ...SOL_GOAL_CHANGE_CONFIRMATION_UNAUTHORIZED,
  };
  const applyAuthorized = authorization.goal_change_apply_authorized === true;
  if (applyAuthorized) {
    if (bodyAsksPostApplyGoalChangeReconfirmation(args.body)) {
      return {
        body: buildAuthorizedAppliedGoalAck(authorization),
        blocked: true,
        reason: "post_apply_goal_change_reask",
      };
    }
    if (bodyLeaksGoalChangeInternalMechanics(args.body)) {
      return {
        body: buildAuthorizedAppliedGoalAck(authorization),
        blocked: true,
        reason: "goal_change_internal_mechanics_leak",
      };
    }
  }
  const applied = applyFalseAppliedGoalChangeGuard({
    body: args.body,
    applyAuthorized,
    confirmationAuthorization: authorization,
  });
  if (applied.blocked) return applied;

  if (applyAuthorized) {
    return { body: applied.body, blocked: false, reason: null };
  }

  return applyUnauthorizedGoalChangeBindingConfirmationGuard({
    body: applied.body,
    authorized: authorization.goal_change_confirmation_authorized === true,
  });
}
